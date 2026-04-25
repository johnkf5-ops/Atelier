import { promises as fs } from 'node:fs';
import path from 'node:path';
import pLimit from 'p-limit';
import { getAnthropic, MODEL_OPUS } from '@/lib/anthropic';
import { withAnthropicRetry } from '@/lib/anthropic-retry';
import { getDb } from '@/lib/db/client';
import type { ArtistKnowledgeBase } from '@/lib/schemas/akb';
import type { Opportunity } from '@/lib/schemas/opportunity';
import type { StyleFingerprint } from '@/lib/schemas/style-fingerprint';

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

type DraftCtx = {
  akb: ArtistKnowledgeBase;
  opp: Opportunity;
  fingerprint: StyleFingerprint; // required — constrains all visual claims
  voiceSkill: string;
  proposalSkill: string;
  cvSkill: string;
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

const PROMPTS: Record<MaterialType, (ctx: DraftCtx) => { system: string; user: string }> = {
  artist_statement: (ctx) => ({
    system:
      ctx.voiceSkill +
      '\n\n---\n\n' +
      FINGERPRINT_CONSTRAINT +
      "\n\n---\n\nYou are writing an artist statement for a specific opportunity application. Use the voice patterns above. Pull facts ONLY from the provided AKB — never invent. Visual claims MUST match the StyleFingerprint. 300-500 words. No preamble, no markdown. Return plain text only.",
    user: `OPPORTUNITY: ${ctx.opp.name} (${ctx.opp.award.type}, ${ctx.opp.award.prestige_tier}) — ${ctx.opp.url}

STYLE_FINGERPRINT (ground truth for visual claims):
${JSON.stringify(ctx.fingerprint, null, 2)}

ARTIST_AKB (ground truth for biographical + career claims):
${JSON.stringify(ctx.akb, null, 2)}

Write the artist statement now. Describe the work as the fingerprint says it IS.`,
  }),
  project_proposal: (ctx) => ({
    system:
      ctx.proposalSkill +
      '\n\n---\n\n' +
      FINGERPRINT_CONSTRAINT +
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
      FINGERPRINT_CONSTRAINT +
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

  const [voiceSkill, proposalSkill, cvSkill] = await Promise.all([
    readSkill('artist-statement-voice.md', DEFAULT_VOICE_SKILL),
    readSkill('project-proposal-structure.md', DEFAULT_PROPOSAL_SKILL),
    readSkill('cv-format-by-institution.md', DEFAULT_CV_SKILL),
  ]);

  const ctx: DraftCtx = { akb, opp, fingerprint, voiceSkill, proposalSkill, cvSkill, oppRequirementsText };

  const artist_statement = await draftMaterial('artist_statement', ctx);
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
