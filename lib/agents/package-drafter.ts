import { promises as fs } from 'node:fs';
import path from 'node:path';
import pLimit from 'p-limit';
import { getAnthropic, MODEL_OPUS } from '@/lib/anthropic';
import { withAnthropicRetry } from '@/lib/anthropic-retry';
import { getDb } from '@/lib/db/client';
import type { ArtistKnowledgeBase } from '@/lib/schemas/akb';
import type { Opportunity } from '@/lib/schemas/opportunity';
import type { StyleFingerprint } from '@/lib/schemas/style-fingerprint';
import { parseLooseJson, extractText } from './json-parse';

// Used when skills/artist-statement-voice.md etc. haven't landed yet.
// Short but deliberate — prevents silent quality degradation if §4.6 timing slips.
const DEFAULT_VOICE_SKILL = `Voice for institutional artist statements + cover letters:
- Third person, present tense.
- Concrete over abstract — "rust-belt grain elevators at dawn" not "industrial structures in changing light".
- Lead with what the work IS, not what it MEANS. Meaning emerges from material specifics.
- No "explores", "examines", "interrogates", "questions" — overused MFA filler.
- No emotional adjectives ("haunting", "evocative", "powerful"). Let the description do the work.
- Proper nouns when grounding lineage (Adams, Eggleston, Sugimoto, Crewdson). Skip if not load-bearing.
- 2-3 short paragraphs for statements. 2 paragraphs for cover letters.`;

const DEFAULT_PROPOSAL_SKILL = `Generic project proposal structure (use when opportunity-specific requirements unavailable):
1. ONE-LINE THESIS — what is the project, in plain English, no jargon
2. CONTEXT — what existing body of work this extends, what conversation it joins
3. METHOD — concrete materials, locations, timeline (months not vague phases)
4. DELIVERABLES — what the funder gets at the end (number of works, format, scale)
5. BUDGET FRAME — implicit in deliverables; mention only if explicitly asked
6. WHY NOW / WHY YOU — single sentence each, not a sales pitch
Total 400-600 words unless the opportunity specifies a length.`;

const DEFAULT_CV_SKILL = `Generic chronological CV format (use when no institution-specific format known):
NAME (top, large)
b. YEAR, BIRTHPLACE | Lives and works in CITY
EDUCATION (most recent first; degree, institution, year)
SOLO EXHIBITIONS (year, title, venue, city)
GROUP EXHIBITIONS (most recent 8-12; same format; "(curated by NAME)" if notable)
PUBLICATIONS (most recent first; publication, title, year, page if known)
AWARDS AND HONORS (year, name)
COLLECTIONS (institution name only — no descriptions)
REPRESENTATION (gallery, city, since year)

Length: 2 pages max. Skip empty sections.`;

async function readSkill(filename: string, fallback: string): Promise<string> {
  try {
    return await fs.readFile(path.join(process.cwd(), 'skills', filename), 'utf-8');
  } catch {
    return fallback;
  }
}

export type MaterialType = 'artist_statement' | 'project_proposal' | 'cv' | 'cover_letter';

/**
 * WALKTHROUGH Note 20: opportunity-type classifier used to load
 * per-type tailoring guidance into the artist-statement prompt. Pure
 * function — name regex first (most specific), then award.type +
 * prestige_tier as fallback. Order matters; first match wins.
 */
export type OppType =
  | 'state-fellowship'
  | 'landscape-prize'
  | 'photo-book'
  | 'museum-acquisition'
  | 'general-prize';

const STATE_FELLOWSHIP_PATTERNS = [
  /\bstate\b.*\b(arts? council|commission|fellowship|grant)\b/i,
  /\bnyfa\b|\bnysca\b|\bnea\b|\bmaine arts\b|\bnevada arts\b|\bcalifornia arts\b/i,
  /\b(arts council|arts commission)\b.*\b(fellowship|grant|individual artist)\b/i,
];
const LANDSCAPE_PRIZE_PATTERNS = [
  /\b(ilpoty|opoty|nlpa|tpoty|np[oa]ty|critical mass|aperture portfolio prize|landscape photographer of the year|outdoor photographer|nature photographer|hamdan)\b/i,
  /\blandscape\b.*\b(prize|award|competition)\b/i,
];
const PHOTO_BOOK_PATTERNS = [
  /\b(first book|monograph|book prize|book award|aperture.*book|anamorphosis|lucie.*book|photobook)\b/i,
];
const MUSEUM_ACQUISITION_PATTERNS = [
  /\b(museum acquisition|curatorial review|museum collection)\b/i,
];

export function classifyOpportunityType(opp: Opportunity): OppType {
  const name = opp.name ?? '';
  if (STATE_FELLOWSHIP_PATTERNS.some((r) => r.test(name))) return 'state-fellowship';
  if (PHOTO_BOOK_PATTERNS.some((r) => r.test(name))) return 'photo-book';
  if (MUSEUM_ACQUISITION_PATTERNS.some((r) => r.test(name))) return 'museum-acquisition';
  if (LANDSCAPE_PRIZE_PATTERNS.some((r) => r.test(name))) return 'landscape-prize';
  // Fallback by award.type + prestige_tier — coarser, but better than nothing.
  if (/fellowship|grant/i.test(opp.award.type) && /regional|mid|emerging/i.test(opp.award.prestige_tier)) {
    return 'state-fellowship';
  }
  return 'general-prize';
}

const TAILORING_BY_TYPE: Record<OppType, string> = {
  'state-fellowship': `STATE-FELLOWSHIP TAILORING: Lead with the artist's relationship to a specific state, region, or place from their AKB (home_base, bodies_of_work). State arts council panels fund artists committed to working in their state. The "place + threat" pattern (a specific landscape tied to ecological or civic loss) is structural here when the AKB supports it. Avoid international-ambition framing.`,
  'landscape-prize': `LANDSCAPE-PRIZE TAILORING: Lead with PROJECT structure, not biography. These panels want a body of work, not greatest hits. Frame as: "I have been working on X subject for Y years, returning to Z places, because A." Treat the statement as a project description, not a portfolio overview.`,
  'photo-book': `PHOTO-BOOK TAILORING: Emphasize sequencing, editorial through-line, and book-readiness. Reference project arc, scope, working title (if in AKB), approximate image count. Make clear the artist has thought about the work as a book — not a stack of prints.`,
  'museum-acquisition': `MUSEUM-ACQUISITION TAILORING: Emphasize project structure and conceptual through-line. Articulate the through-line in a single sentence. Curators fund the project, not the photographs. Close the gap between "catalogue of beautiful locations" and "sustained, structured body of work."`,
  'general-prize': `GENERAL-PRIZE TAILORING: Lean into the specific prize category. Match ambition to the scale of the opportunity. Avoid grand-vision framing for an open-call competition.`,
};

type DraftCtx = {
  akb: ArtistKnowledgeBase;
  opp: Opportunity;
  fingerprint: StyleFingerprint; // required — constrains all visual claims
  voiceSkill: string;
  proposalSkill: string;
  cvSkill: string;
  examplesSkill: string; // WALKTHROUGH Note 20 — real-statement few-shot
  oppType: OppType;
  oppRequirementsText: string;
};

// Hard constraint applied to every per-material prompt (except CV, which is factual).
// Prevents the Drafter from inventing an institutional-register framing (cool-tonal
// palette, Sugimoto-lineage, durational-conceptual) that doesn't match the actual
// visual work. The fingerprint is ground truth for visual claims.
const FINGERPRINT_CONSTRAINT = `HARD CONSTRAINT — VISUAL CLAIMS MUST MATCH THE STYLE FINGERPRINT:
Every descriptive claim you make about the artist's visual work (palette, lineage, composition, subject register, process) must be supported by the StyleFingerprint below. Do NOT write an aspirational framing that contradicts the fingerprint.

- If the fingerprint says "saturated" palette, do NOT claim "cool-tonal" or "muted."
- If the fingerprint's formal_lineage names commercial precedents (Peter Lik, Trey Ratcliff, Galen Rowell), do NOT pitch the work as "Sugimoto-lineage" or "New Topographics" or any institutional-register lineage the fingerprint does not name.
- If the fingerprint's career_positioning_read names a commercial / destination-gallery register, WRITE FROM THAT register — own it honestly. Panels read the work samples alongside the statement; a statement whose visual claims contradict the attached images reads as overreach and disqualifies.
- You MAY describe aspirations in intent.aspirations terms ("intent to deepen the regional practice") but do NOT describe the CURRENT work as having qualities it does not have.
- Use vocabulary from the fingerprint's own fields when possible.

Read the fingerprint carefully. Write about the work as it actually is. Commercial-register honesty beats institutional-register pretense every time.`;

// WALKTHROUGH Note 4: artist_name is the PRIMARY identity in every public-
// facing draft. Use it for the byline, signature, "by [name]" attributions,
// and any sentence that introduces the artist. legal_name is administrative
// metadata only — reserve it for explicit tax/contract sections in templates
// that ask for "Name (legal, for W-9 / contract)" specifically.
const NAME_PRIMACY_CONSTRAINT = `IDENTITY NAMING:
- The artist's name in every public-facing line (byline, signature, "by [name]", subject-line greetings, third-person bio sentences) MUST be \`identity.artist_name\`.
- \`identity.legal_name\` is for tax / contract sections ONLY, and only when the template explicitly asks for "legal name (for tax/contract)".
- If \`identity.artist_name\` and \`identity.legal_name\` differ, the cover letter's signature is artist_name; the legal name appears (if at all) only in an explicitly-labelled "Name for tax / W-9 purposes:" line.`;

// WALKTHROUGH Note 20: hard voice constraints applied to artist_statement +
// cover_letter (any first-person, voice-bearing prose). Loaded as system text
// so the model sees them BEFORE the few-shot examples.
const STATEMENT_VOICE_CONSTRAINTS = `HARD VOICE CONSTRAINTS — every constraint is non-negotiable. If you find yourself violating any, restructure the sentence:

1. ZERO em-dashes. Hard rule. No "—" anywhere in the output. If you want a pause, use a comma, period, parentheses, or colon. Em-dash rhythm is the single most reliable LLM-prose tell in 2026 — working artists almost never use em-dashes.
2. FIRST PERSON throughout. "I have spent…", "I return to…", "My main tool is…". Never write "Knopf's practice…" or "the artist's work…" except in a clearly-labeled bio paragraph. Opening with the artist's name is fine ONLY if the next clause transitions to first person.
3. OPEN WITH STAKE OR QUESTION OR WORKING PRINCIPLE — never with cameras, formats, locations, or a list of places. The first sentence must land an animating idea.
4. BANNED PHRASES (hard list — do not produce any of these):
   - "sits at the intersection of"
   - "sits in the lineage of"
   - "interrogates the relationship between"
   - "liminal space"
   - "a kind of grammar"
   - "aesthetic signature"
   - "visual vocabulary"
   - "working grammar"
   - "commercial-gallery register"
   - "meditations on"
   - "informed by"
   - "vision" / "visionary"
   - "journey"
   - "passion" / "passionate"
   - "explore" / "exploration"
   - "capture" (use "photograph", "make", "see")
   - "story" / "storytelling" (when used as a generic claim about what the work does)
5. LINEAGE NAME-DROPS: maximum 1–2 names total across the whole statement, and only if they are animating influences (an idea, a method, a stance the artist has absorbed). Never 3+. If you cite Adams + Rowell + Butcher, delete the sentence — that is positioning, not photographing.
6. TECHNICAL DETAIL must be justified by what it enables artistically. Don't list cameras, ND filters, print processes, or Zone System as bare facts. If wet-plate matters, say what it lets the artist see or do.
7. ONE QUOTABLE SENTENCE. Engineer one 5-12-word, present-tense, declarative sentence as the structural anchor. Build the surrounding paragraphs around it. Examples from real winners: "My first thought is always of light." / "You visually organize the chaos." / "I wanted to actively pursue these events."
8. PLACE SPECIFICITY OVER PLACE LISTS. "I have returned to the same canyon every spring for nine years" beats "I have photographed in Arizona, Utah, Wyoming, Montana, and South Dakota." A list of states reads as a travel log; a return reads as a project.
9. NO PUBLICATION CREDITS inside the statement. National Geographic, TIME, etc. belong in a bio paragraph. They are not part of the statement of intent.
10. NO ABSTRACT VIRTUE STACKING (no "reverence, rigor, commitment" trios). Replace with one concrete behavior that demonstrates the virtue.
11. LENGTH: 150-300 words. The panel reads dozens of statements per session; brevity is generosity. If the prompt caps at 500, write 280.

PRE-SUBMIT SELF-CHECK (do this before returning the text — silently revise if any check fails):
- Em-dash count is exactly zero.
- First person throughout (or first-person-after-name-once).
- First sentence does NOT contain a camera brand, print format, lineage name, or place list.
- Lineage names total: 0, 1, or 2 — never 3+.
- One sentence is 5-12 words, present-tense, declarative.
- No banned phrase from constraint #4 appears.
- Word count is 150-300.`;

const PROMPTS: Record<MaterialType, (ctx: DraftCtx) => { system: string; user: string }> = {
  artist_statement: (ctx) => ({
    system:
      // The few-shot examples skill goes FIRST — it's the ground truth the
      // voice constraints + fingerprint guard are pointing at.
      ctx.examplesSkill +
      '\n\n---\n\n' +
      STATEMENT_VOICE_CONSTRAINTS +
      '\n\n---\n\n' +
      FINGERPRINT_CONSTRAINT + '\n\n---\n\n' + NAME_PRIMACY_CONSTRAINT +
      '\n\n---\n\nYou are writing an artist statement for a specific opportunity application. The few-shot examples above are real winning statements — match THEIR voice, not the curatorial-essay or LLM-default register. Pull facts ONLY from the provided AKB — never invent. Visual claims MUST match the StyleFingerprint. No preamble, no markdown. Return plain text only.',
    user: `OPPORTUNITY: ${ctx.opp.name} (${ctx.opp.award.type}, ${ctx.opp.award.prestige_tier}) — ${ctx.opp.url}

OPPORTUNITY_TYPE: ${ctx.oppType}

${TAILORING_BY_TYPE[ctx.oppType]}

STYLE_FINGERPRINT (ground truth for visual claims):
${JSON.stringify(ctx.fingerprint, null, 2)}

ARTIST_AKB (ground truth for biographical + career claims):
${JSON.stringify(ctx.akb, null, 2)}

Write the artist statement now. Describe the work as the fingerprint says it IS. This statement MUST differ meaningfully from a statement written for a different opportunity type — if you find yourself writing the same opening, structure, or closing as you would for any other opportunity, restructure.`,
  }),
  project_proposal: (ctx) => ({
    system:
      ctx.proposalSkill +
      '\n\n---\n\n' +
      FINGERPRINT_CONSTRAINT + "\n\n---\n\n" + NAME_PRIMACY_CONSTRAINT +
      "\n\n---\n\nYou are writing a project proposal for a specific grant/residency application. Pull facts ONLY from the provided AKB — never invent. Visual claims about current work MUST match the StyleFingerprint. Project aspirations MAY extend beyond current work but must be connected to it. If the opportunity's stated requirements are provided, follow their structure and word limits. Otherwise use the generic structure from your loaded skill. 400-800 words. No preamble, no markdown. Return plain text only.",
    user: `OPPORTUNITY: ${ctx.opp.name} — ${ctx.opp.url}

OPPORTUNITY_REQUIREMENTS (from their page, may be partial):
${ctx.oppRequirementsText || '(not available — use generic structure)'}

STYLE_FINGERPRINT:
${JSON.stringify(ctx.fingerprint, null, 2)}

ARTIST_AKB:
${JSON.stringify(ctx.akb, null, 2)}

Write the project proposal now.`,
  }),
  cv: (ctx) => ({
    system:
      ctx.cvSkill +
      "\n\n---\n\nYou are formatting a CV for a specific institution's application. Use the institution-specific format from the loaded skill if one exists for this opportunity; otherwise use the generic chronological format. Pull entries ONLY from the AKB. No invented items. Return plain text, section-delimited (EDUCATION / SOLO EXHIBITIONS / GROUP EXHIBITIONS / PUBLICATIONS / AWARDS / COLLECTIONS / REPRESENTATION). No preamble. (StyleFingerprint not needed here — CV is factual.)",
    user: `OPPORTUNITY: ${ctx.opp.name} — submission format requirements per your skill file.

ARTIST_AKB:
${JSON.stringify(ctx.akb, null, 2)}

Format the CV now.`,
  }),
  cover_letter: (ctx) => ({
    system:
      ctx.voiceSkill +
      '\n\n---\n\n' +
      // WALKTHROUGH Note 20: same zero-em-dash + banned-phrase discipline as
      // the artist statement. Cover letters are first-person voice-bearing
      // prose — the same LLM tells apply.
      STATEMENT_VOICE_CONSTRAINTS +
      '\n\n---\n\n' +
      FINGERPRINT_CONSTRAINT + "\n\n---\n\n" + NAME_PRIMACY_CONSTRAINT +
      "\n\n---\n\nYou are writing a brief cover letter introducing the artist to this specific opportunity's selectors. 200-300 words. Named addressee if the opportunity has a known director; else \"Selection Committee\". Pull facts ONLY from the provided AKB. Visual claims MUST match the StyleFingerprint. No preamble, no markdown. Return plain text only.",
    user: `OPPORTUNITY: ${ctx.opp.name} (${ctx.opp.award.type}) — ${ctx.opp.url}

STYLE_FINGERPRINT:
${JSON.stringify(ctx.fingerprint, null, 2)}

ARTIST_AKB:
${JSON.stringify(ctx.akb, null, 2)}

Write the cover letter now.`,
  }),
};

async function draftMaterial(type: MaterialType, ctx: DraftCtx): Promise<string> {
  const { system, user } = PROMPTS[type](ctx);
  const client = getAnthropic();
  const resp = await withAnthropicRetry(
    () => client.messages.create({
      model: MODEL_OPUS,
      max_tokens: 3000,
      thinking: { type: 'adaptive' },
      system,
      messages: [{ role: 'user', content: user }],
    }),
    { label: `drafter-${type}` },
  );
  const text = resp.content.find((b) => b.type === 'text')?.text ?? '';
  return text.trim();
}

/**
 * WALKTHROUGH Note 20: post-write voice check on the artist statement.
 * If the model emits any em-dash or banned phrase, we ask it to revise once.
 * No infinite loop — bounded to a single retry to keep cost predictable.
 * Soft fallback: if the second attempt still fails, return it anyway (the
 * statement is still readable; we'd rather ship imperfect than nothing).
 */
const STATEMENT_BANNED_PHRASES = [
  'sits at the intersection of',
  'sits in the lineage of',
  'interrogates the relationship between',
  'liminal space',
  'a kind of grammar',
  'aesthetic signature',
  'visual vocabulary',
  'working grammar',
  'commercial-gallery register',
  'meditations on',
  'informed by',
];
const STATEMENT_BANNED_WORDS = [
  'visionary',
  'vision',
  'journey',
  'passion',
  'passionate',
  'explore',
  'exploration',
  'capture',
];

export function checkStatementVoice(text: string): {
  ok: boolean;
  issues: string[];
} {
  const issues: string[] = [];
  if (text.includes('—')) {
    const count = (text.match(/—/g) || []).length;
    issues.push(`${count} em-dash(es) found — use commas, periods, or parentheses instead. Hard rule: zero em-dashes.`);
  }
  const lower = text.toLowerCase();
  for (const phrase of STATEMENT_BANNED_PHRASES) {
    if (lower.includes(phrase)) issues.push(`banned phrase: "${phrase}"`);
  }
  for (const word of STATEMENT_BANNED_WORDS) {
    const re = new RegExp(`\\b${word}\\b`, 'i');
    if (re.test(text)) issues.push(`banned word: "${word}" — use a concrete alternative`);
  }
  return { ok: issues.length === 0, issues };
}

async function draftStatementWithVoiceCheck(ctx: DraftCtx): Promise<string> {
  const first = await draftMaterial('artist_statement', ctx);
  const check = checkStatementVoice(first);
  if (check.ok) return first;

  // One-shot revision pass — feed the violations back as a follow-up turn.
  const { system } = PROMPTS.artist_statement(ctx);
  const client = getAnthropic();
  const resp = await withAnthropicRetry(
    () =>
      client.messages.create({
        model: MODEL_OPUS,
        max_tokens: 3000,
        thinking: { type: 'adaptive' },
        system,
        messages: [
          { role: 'user', content: PROMPTS.artist_statement(ctx).user },
          { role: 'assistant', content: first },
          {
            role: 'user',
            content: `Your draft violated the hard voice constraints. Specific issues:\n${check.issues.map((i) => `- ${i}`).join('\n')}\n\nRewrite the statement now. Same opportunity, same facts, but fix every issue listed above. Return plain text only.`,
          },
        ],
      }),
    { label: `drafter-artist_statement-revise` },
  );
  const revised = resp.content.find((b) => b.type === 'text')?.text?.trim() ?? '';
  // Soft fallback — if the revision still fails, return whichever is closer.
  return revised.length > 0 ? revised : first;
}

export type WorkSample = {
  portfolio_image_id: number;
  thumb_url: string;
  filename: string;
  rationale: string;
};

type PortfolioImage = {
  id: number;
  thumb_url: string;
  filename: string;
  exif_json: string | null;
};

export function selectWorkSamples(
  supportingIds: number[],
  portfolio: PortfolioImage[],
  target: number,
): WorkSample[] {
  const byId = new Map(portfolio.map((p) => [p.id, p]));

  // Priority 1: Rubric-supplied supporting IDs (curated for this opportunity's aesthetic).
  const supportingChosen = supportingIds
    .map((id) => byId.get(id))
    .filter((p): p is PortfolioImage => !!p)
    .slice(0, target);

  if (supportingChosen.length >= target) {
    return supportingChosen.slice(0, target).map((p) => ({
      portfolio_image_id: p.id,
      thumb_url: p.thumb_url,
      filename: p.filename,
      rationale:
        "cited as supporting the institution's aesthetic signature in the Rubric Matcher's reasoning",
    }));
  }

  // Priority 2: backfill with even-spaced sample from remainder.
  const usedIds = new Set(supportingChosen.map((p) => p.id));
  const remaining = portfolio.filter((p) => !usedIds.has(p.id));
  const backfillCount = target - supportingChosen.length;
  const step = remaining.length > 0 ? remaining.length / backfillCount : 0;
  const backfill = Array.from({ length: backfillCount }, (_, i) => remaining[Math.floor(i * step)]).filter(
    (p): p is PortfolioImage => !!p,
  );

  return [
    ...supportingChosen.map((p) => ({
      portfolio_image_id: p.id,
      thumb_url: p.thumb_url,
      filename: p.filename,
      rationale: "cited as supporting the institution's aesthetic signature",
    })),
    ...backfill.map((p) => ({
      portfolio_image_id: p.id,
      thumb_url: p.thumb_url,
      filename: p.filename,
      rationale: "representative of the artist's broader range",
    })),
  ];
}

/**
 * WALKTHROUGH Note 19b: ask the model for one short rationale sentence per
 * image-per-opportunity, grounded in the Rubric reasoning paragraph. Replaces
 * the prior hardcoded placeholder strings ("cited as supporting the
 * institution's aesthetic signature in the Rubric Matcher's reasoning") that
 * appeared identically on every sample across every opportunity.
 *
 * Returns a Map<image_id, sentence>. Soft-failure: on LLM error or invalid
 * shape we return an empty Map and the caller keeps the existing placeholder
 * — the rationale is auxiliary signal, not load-bearing for the rest of the
 * dossier.
 */
const SAMPLE_RATIONALE_SYSTEM = `You are writing one-sentence rationales explaining why each portfolio image fits a specific institutional opportunity.

VOICE:
- Terse and specific. One sentence per image. ≤ 30 words.
- Reference what THIS opportunity values (from the Rubric reasoning) and what's actually visible in the image (from filename or EXIF subject hints).
- No marketing language. No "stunning", "haunting", "powerful", "showcases", "demonstrates". Verb-first concrete claims.
- Each rationale must be DISTINCT — no two sentences should read the same.
- If you have no honest reason for a given image, write "alternate from the same body — included for range" rather than padding.

OUTPUT STRICTLY JSON in this shape, no markdown fence, no preamble:
{ "rationales": [ { "image_id": 1, "rationale": "..." }, { "image_id": 6, "rationale": "..." } ] }
Include EVERY image_id from the input. Order does not matter.`;

export async function generateSampleRationales(
  opp: Opportunity,
  rubricReasoning: string,
  images: Array<{ id: number; filename: string; exif_subject?: string | null }>,
): Promise<Map<number, string>> {
  if (images.length === 0) return new Map();
  const client = getAnthropic();
  const userText = `OPPORTUNITY: ${opp.name} (${opp.award.type}, ${opp.award.prestige_tier})

RUBRIC REASONING (why this opportunity was scored a fit):
${rubricReasoning}

IMAGES TO RATIONALIZE (write one sentence per image, distinct from the others):
${JSON.stringify(
  images.map((i) => ({
    image_id: i.id,
    filename: i.filename,
    exif_subject: i.exif_subject ?? null,
  })),
  null,
  2,
)}

Return JSON only.`;
  try {
    const resp = await withAnthropicRetry(
      () =>
        client.messages.create({
          model: MODEL_OPUS,
          max_tokens: 1500,
          system: [
            { type: 'text', text: SAMPLE_RATIONALE_SYSTEM, cache_control: { type: 'ephemeral' } },
          ],
          messages: [{ role: 'user', content: [{ type: 'text', text: userText }] }],
        }),
      { label: `drafter.sample_rationales(opp=${opp.source_id})` },
    );
    const text = extractText(resp.content as Array<{ type: string; text?: string }>);
    const parsed = parseLooseJson(text) as { rationales?: Array<{ image_id: number; rationale: string }> };
    const out = new Map<number, string>();
    if (Array.isArray(parsed?.rationales)) {
      for (const r of parsed.rationales) {
        if (typeof r?.image_id === 'number' && typeof r?.rationale === 'string' && r.rationale.trim().length > 0) {
          out.set(r.image_id, r.rationale.trim());
        }
      }
    }
    return out;
  } catch {
    // Soft fallback — caller keeps the prior placeholder so the dossier still renders.
    return new Map();
  }
}

export type MatchRow = {
  id: number;
  opportunity_id: number;
  fit_score: number;
  composite_score: number | null;
  reasoning: string;
  supporting_image_ids: string | null;
  raw_json: string;
};

export async function draftPackageForMatch(
  row: MatchRow,
  akb: ArtistKnowledgeBase,
  fingerprint: StyleFingerprint,
  portfolio: PortfolioImage[],
): Promise<void> {
  const db = getDb();
  const opp: Opportunity = JSON.parse(row.raw_json);
  const supportingIds: number[] = row.supporting_image_ids ? JSON.parse(row.supporting_image_ids) : [];

  // Fetch opportunity requirements page (best effort; timeout short, fall back to generic template).
  let oppRequirementsText = '';
  try {
    const res = await fetch(opp.url, {
      signal: AbortSignal.timeout(10_000),
      headers: { 'User-Agent': 'Mozilla/5.0 Atelier/0.1' },
    });
    if (res.ok) {
      const html = await res.text();
      const { load } = await import('cheerio');
      const $ = load(html);
      $('script, style, nav, footer, header').remove();
      oppRequirementsText = $('body').text().replace(/\s+/g, ' ').trim().slice(0, 20_000);
    }
  } catch {
    /* generic template path */
  }

  const workSamples = selectWorkSamples(supportingIds, portfolio, 12);

  // WALKTHROUGH Note 19b: replace the placeholder rationale strings with
  // per-image-per-opportunity reasoning grounded in this match's Rubric
  // paragraph. Soft fallback — on LLM failure the original placeholders stay.
  const rationaleImages = workSamples.map((ws) => {
    const p = portfolio.find((q) => q.id === ws.portfolio_image_id);
    let exifSubject: string | null = null;
    if (p?.exif_json) {
      try {
        const exif = JSON.parse(p.exif_json) as { subject?: string; ImageDescription?: string };
        exifSubject = exif.subject ?? exif.ImageDescription ?? null;
      } catch {
        /* malformed exif — skip */
      }
    }
    return { id: ws.portfolio_image_id, filename: ws.filename, exif_subject: exifSubject };
  });
  const rationaleMap = await generateSampleRationales(opp, row.reasoning, rationaleImages);
  for (const ws of workSamples) {
    const r = rationaleMap.get(ws.portfolio_image_id);
    if (r) ws.rationale = r;
  }

  const [voiceSkill, proposalSkill, cvSkill, examplesSkill] = await Promise.all([
    readSkill('artist-statement-voice.md', DEFAULT_VOICE_SKILL),
    readSkill('project-proposal-structure.md', DEFAULT_PROPOSAL_SKILL),
    readSkill('cv-format-by-institution.md', DEFAULT_CV_SKILL),
    // WALKTHROUGH Note 20: real-statement few-shot reference. Falls back to a
    // brief inline note if the file is missing — but it should always be
    // present (committed).
    readSkill(
      'artist-statement-real-examples.md',
      'Real artist statement examples not loaded — write in plain first-person voice, open with stake/question, zero em-dashes.',
    ),
  ]);

  const oppType = classifyOpportunityType(opp);
  const ctx: DraftCtx = {
    akb,
    opp,
    fingerprint,
    voiceSkill,
    proposalSkill,
    cvSkill,
    examplesSkill,
    oppType,
    oppRequirementsText,
  };

  const artist_statement = await draftStatementWithVoiceCheck(ctx);
  const project_proposal = await draftMaterial('project_proposal', ctx);
  const cv_formatted = await draftMaterial('cv', ctx);
  const cover_letter = await draftMaterial('cover_letter', ctx);

  // INSERT OR REPLACE so re-drafting the same match overwrites instead of
  // violating the implicit PK + error on duplicate.
  await db.execute({
    sql: `INSERT INTO drafted_packages (run_match_id, artist_statement, project_proposal, cv_formatted, cover_letter, work_sample_selection_json)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(run_match_id) DO UPDATE SET
            artist_statement = excluded.artist_statement,
            project_proposal = excluded.project_proposal,
            cv_formatted = excluded.cv_formatted,
            cover_letter = excluded.cover_letter,
            work_sample_selection_json = excluded.work_sample_selection_json`,
    args: [
      row.id,
      artist_statement,
      project_proposal,
      cv_formatted,
      cover_letter,
      JSON.stringify(workSamples),
    ],
  });
}

export async function draftPackages(
  runId: number,
  akb: ArtistKnowledgeBase,
  userId: number,
): Promise<void> {
  const db = getDb();

  // Load StyleFingerprint from runs.style_fingerprint_id — required by the
  // per-material prompts to constrain visual claims. Without this the Drafter
  // invents institutional-register framing that contradicts the work.
  const runRow = (
    await db.execute({
      sql: `SELECT style_fingerprint_id FROM runs WHERE id = ?`,
      args: [runId],
    })
  ).rows[0] as unknown as { style_fingerprint_id: number };
  if (!runRow) throw new Error(`run ${runId} not found`);
  const fpJson = ((
    await db.execute({
      sql: `SELECT json FROM style_fingerprints WHERE id = ?`,
      args: [runRow.style_fingerprint_id],
    })
  ).rows[0] as unknown as { json: string }).json;
  const fingerprint: StyleFingerprint = JSON.parse(fpJson);

  const matchRows = (
    await db.execute({
      sql: `SELECT rm.id, rm.opportunity_id, rm.fit_score, rm.composite_score, rm.reasoning,
                   rm.supporting_image_ids, o.raw_json
            FROM run_matches rm
            JOIN opportunities o ON o.id = rm.opportunity_id
            WHERE rm.run_id = ? AND rm.included = 1
            ORDER BY rm.composite_score DESC NULLS LAST, rm.fit_score DESC
            LIMIT 15`,
      args: [runId],
    })
  ).rows as unknown as MatchRow[];

  if (matchRows.length === 0) {
    await db.execute({
      sql: `UPDATE runs SET status = 'complete', finished_at = unixepoch() WHERE id = ?`,
      args: [runId],
    });
    return;
  }

  const portfolio = (
    await db.execute({
      sql: `SELECT id, thumb_url, filename, exif_json FROM portfolio_images WHERE user_id = ? ORDER BY ordinal ASC`,
      args: [userId],
    })
  ).rows as unknown as PortfolioImage[];

  // p-limit(5) at the match level; within a match the 4 LLM calls run sequentially.
  // Net: 5 concurrent messages.create calls at peak, ~150s for 12 matches × 4 materials.
  const limit = pLimit(5);
  const settled = await Promise.allSettled(
    matchRows.map((row) => limit(() => draftPackageForMatch(row, akb, fingerprint, portfolio))),
  );

  const failures = settled
    .map((r, i) =>
      r.status === 'rejected'
        ? { match_id: matchRows[i].id, reason: (r.reason as Error)?.message ?? String(r.reason) }
        : null,
    )
    .filter((x): x is NonNullable<typeof x> => x !== null);
  if (failures.length > 0) {
    await db.execute({
      sql: `INSERT INTO run_events (run_id, agent, kind, payload_json) VALUES (?, 'package-drafter', 'error', ?)`,
      args: [
        runId,
        JSON.stringify({ failed_matches: failures, succeeded: settled.length - failures.length }),
      ],
    });
    console.warn(
      `[package-drafter] ${failures.length}/${settled.length} matches failed`,
      failures,
    );
  }

  await db.execute({
    sql: `UPDATE runs SET status = 'complete', finished_at = unixepoch() WHERE id = ?`,
    args: [runId],
  });
}
