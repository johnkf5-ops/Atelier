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

// WALKTHROUGH Note 22-fix.2: canonical CV format. ALWAYS these labels in
// THIS order. Skip a section ONLY if the corresponding AKB field is empty
// (no inventing labels). Within each section, em-dash for venue/location
// separation (CV convention NEA / MacDowell / Aperture all use), comma for
// sub-attributes within a row. Em-dashes are acceptable HERE (institutional
// field separators) — Note 20/21's zero-em-dash rule is for prose.
const DEFAULT_CV_SKILL = `Canonical CV format (one master CV per artist; do not vary across opportunities):

NAME (top, large)
b. YEAR | Lives and works in CITY, STATE, COUNTRY [single-line bio]

EDUCATION
  Most recent first. Format: degree, institution, year.

SOLO EXHIBITIONS
  Most recent first. Format: year — title, venue, city.

GROUP EXHIBITIONS (selected)
  Most recent 8–12. Same format. "(curated by NAME)" only if notable.

PUBLICATIONS (selected)
  Most recent first. Format: publication, title, year (page or URL if relevant).

AWARDS AND HONORS
  Most recent first. Format: year — name (granting body, if not in name).

COLLECTIONS
  Institution name only. No descriptions.

REPRESENTATION
  Format: gallery, city, since year.

CURATORIAL AND ORGANIZATIONAL
  ALWAYS include if AKB has the field non-empty (WALKTHROUGH Note 22-fix.1 —
  curatorial credentials strengthen ANY application; never trim them based
  on opportunity type). Format: year — role, organization (project name if relevant).

Length: 2 pages max. Skip a section heading ONLY when its AKB field is empty.
Use these section labels EXACTLY (no "AWARDS" instead of "AWARDS AND HONORS",
no "ORGANIZATIONAL WORK" instead of "CURATORIAL AND ORGANIZATIONAL"). Use
em-dash as the field separator inside entries; comma for sub-attributes.`;

async function readSkill(filename: string, fallback: string): Promise<string> {
  try {
    return await fs.readFile(path.join(process.cwd(), 'skills', filename), 'utf-8');
  } catch {
    return fallback;
  }
}

// WALKTHROUGH Note 22-fix.3: 'cv' removed. CV is now generated ONCE per run
// at the dossier level (orchestrator → dossiers.master_cv) instead of N
// per-opp copies. The drafted_packages.cv_formatted column is repurposed
// to hold a per-opp trim NOTE (not a full CV) when the opportunity has a
// stated CV cap (Aperture's "single-page PDF", IPA's "2,000 character"
// limit, etc.). Trim notes are deterministic regex-based — no LLM call.
export type MaterialType = 'artist_statement' | 'project_proposal' | 'cover_letter';

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

/**
 * WALKTHROUGH Note 32 (32-fix.1): per-opportunity-type EMPHASIS table.
 *
 * Different from TAILORING_BY_TYPE (which gives general framing): this
 * table tells the model SPECIFICALLY what to LEAD WITH and what to SKIP
 * in the body. Without this, the model defaults to a canonical body
 * (location reel + gear list + same closing line) across every opp,
 * differentiating only at the opening sentence — the audited "one
 * statement reshuffled" symptom.
 *
 * Injected into the artist_statement user message after TAILORING_BY_TYPE.
 */
export const EMPHASIS_BY_OPP_TYPE: Record<OppType, string> = {
  'state-fellowship': `EMPHASIS for state-fellowship: LEAD WITH the artist's specific commitment to one place (a single river, a single canyon, a single county) drawn from akb.home_base + akb.bodies_of_work + akb.intent.aspirations. SKIP international-ambition framing, SKIP gear/technique listing, SKIP catalogue-of-trips locations. The body should make a panel say "this artist will keep working in our state if we fund them."`,
  'landscape-prize': `EMPHASIS for landscape-prize: LEAD WITH the body of work as a project (subject + duration + return-visit cadence) drawn from akb.bodies_of_work. Mention 1-2 representative places, NOT the full canonical location list. SKIP biographical career markers (those go in the bio), SKIP closing lines about "the planet is a beautiful place" — find a close specific to this body of work.`,
  'photo-book': `EMPHASIS for photo-book: LEAD WITH monograph readiness — working title (if in akb.intent.aspirations or akb.bodies_of_work.title), approximate image count, sequencing logic, book-object decisions. SKIP the full gear/technique list entirely (irrelevant to a book proposal). SKIP locations that aren't part of the book's argument. Aspirations belong here when load-bearing for the monograph.`,
  'museum-acquisition': `EMPHASIS for museum-acquisition: LEAD WITH the conceptual through-line in one sentence (the argument the body of work makes). SKIP travelogue location lists, SKIP gear specs. Curators fund the project, not the photographs — articulate the project's intellectual structure.`,
  'general-prize': `EMPHASIS for general-prize: LEAD WITH the formal discipline + working philosophy (one quotable principle from the artist's practice). Pick 2-3 representative places that map to THIS prize's category, not the full canonical reel. SKIP gear/technique listing unless the prize is technique-specific.`,
};

/**
 * WALKTHROUGH Note 21: sibling to classifyOpportunityType, but mapped to the
 * proposal templates from skills/project-proposal-real-examples.md. Distinct
 * from the artist-statement classifier — e.g. Aperture Portfolio Prize is a
 * "landscape-prize" statement-wise but a "competition" proposal-wise (the
 * proposal is curatorial framing of finished work, not a project plan).
 *
 * Order matters; first match wins. Mirrors the skill file's "Type-routing
 * logic" table.
 */
export type ProposalType =
  | 'state-fellowship'
  | 'competition'
  | 'residency'
  | 'book-grant'
  | 'foundation-grant'
  | 'commission'
  | 'guggenheim-major-bespoke';

const PROPOSAL_BESPOKE_PATTERNS = [
  /\b(creative capital|guggenheim|usa fellowship|joan mitchell|macarthur)\b/i,
];
const PROPOSAL_RESIDENCY_PATTERNS = [
  /\b(macdowell|yaddo|headlands|vermont studio|light work|banff|djerassi|skowhegan|ucross)\b/i,
  /\b(artist[- ]in[- ]residence|residency)\b/i,
];
const PROPOSAL_BOOK_PATTERNS = [
  /\b(book prize|book award|photobook|monograph|first photo book)\b/i,
];
const PROPOSAL_COMMISSION_PATTERNS = [
  /\b(public art call|call for artists|rfq|rfp)\b/i,
  /\b(arts commission)\b.*\b(call|rfq|rfp|public art)\b/i,
];
const PROPOSAL_COMPETITION_PATTERNS = [
  /\b(ilpoty|opoty|nlpa|tpoty|np[oa]ty|critical mass|aperture portfolio prize|ipa|fapa|hamdan|sony world|photographer of the year|portfolio prize|awards)\b/i,
];
const PROPOSAL_FOUNDATION_PATTERNS = [
  /\b(pollock[- ]krasner|aaron siskind|vmfa|howard foundation|en foco)\b/i,
];

export function classifyProposalType(opp: Opportunity): ProposalType {
  const name = opp.name ?? '';
  if (PROPOSAL_BESPOKE_PATTERNS.some((r) => r.test(name))) return 'guggenheim-major-bespoke';
  if (PROPOSAL_RESIDENCY_PATTERNS.some((r) => r.test(name))) return 'residency';
  if (PROPOSAL_BOOK_PATTERNS.some((r) => r.test(name))) return 'book-grant';
  if (PROPOSAL_COMMISSION_PATTERNS.some((r) => r.test(name))) return 'commission';
  if (PROPOSAL_FOUNDATION_PATTERNS.some((r) => r.test(name))) return 'foundation-grant';
  if (PROPOSAL_COMPETITION_PATTERNS.some((r) => r.test(name))) return 'competition';
  // State arts council fellowship checks — reuse the artist-statement patterns.
  if (STATE_FELLOWSHIP_PATTERNS.some((r) => r.test(name))) return 'state-fellowship';
  // Coarse fallback by award metadata: project-restricted grants → state-fellowship,
  // unrestricted/foundation → foundation-grant, else competition.
  if (/fellowship|grant/i.test(opp.award.type) && /regional|mid|emerging/i.test(opp.award.prestige_tier)) {
    return 'state-fellowship';
  }
  return 'competition';
}

const PROPOSAL_TAILORING: Record<ProposalType, string> = {
  'state-fellowship': `STATE ARTS COUNCIL FELLOWSHIP PROPOSAL: Funds NEW work by a named artist over a defined period. Required structure: (1) one-sentence project description naming project, medium, geography; (2) what activities take place during the period of performance; (3) why this project, why now; (4) public-benefit / engagement statement (load-bearing for state councils); (5) timeline in MONTHS, not "phases"; (6) deliverables with counts (number of new works, exhibitions, publications); (7) one clause naming the fiscal sponsor relationship if NYSCA. Length: write to the cap (~750 words for NEA). Address each council review criterion explicitly. Specify what is NEW vs prior practice. Common failure: reads as continuation of practice.`,
  'competition': `PHOTOGRAPHY COMPETITION PORTFOLIO STATEMENT: Curatorial framing of an EXISTING, COMPLETED body of work — not a project plan. No timeline, no budget, no deliverables. Required moves: (1) name the body of work as a titled series; (2) one sentence on subject; (3) one sentence on method/approach when load-bearing; (4) one sentence on what unifies the 10 images as a series; (5) one sentence on stakes. Length: ~250 words is the dominant ceiling — every sentence load-bearing. Common failure: generic artist statement that does not frame the specific submitted images.`,
  'residency': `RESIDENCY APPLICATION PROJECT DESCRIPTION: Specify what would be DONE during the residency weeks, not what the larger project is. The grant is for the residency window, not the project lifetime. Required moves: (1) brief context on the larger project; (2) what specifically gets accomplished during the residency weeks (sequenced book dummy, formal portraits of fellows, mockup, etc.); (3) connection to the residency facility when load-bearing (darkroom, studio, place); (4) downstream output if any (publication, exhibition). Length: 250–500 words. Common failure: project so large the residency window cannot meaningfully advance it; project that could happen anywhere.`,
  'book-grant': `PHOTO BOOK STATEMENT: The book itself is the primary submission; the statement is a frame. Required moves: (1) working title; (2) one sentence on subject and concept; (3) one sentence on book-object decisions (page count, trim size, paper, binding, cover, edition size); (4) one sentence on sequencing logic / argument the order of images makes; (5) one sentence on publisher relationship (named publisher, verbal agreement, self-published). Length: ~250 words. Common failure: frames as a portfolio rather than a book object; no mention of sequence, scale, page count.`,
  'foundation-grant': `FOUNDATION GRANT (Pollock-Krasner / Siskind / En Foco): Pollock-Krasner specifically asks for amount requested + specific purposes (e.g., "$25,000: $12,000 toward studio rent for 12 months, $8,000 toward print production for confirmed exhibition at [venue], $5,000 toward unreimbursed medical"). Other foundations want a frame for current work, naming the body of work, subject and approach, personal relevance (En Foco). Not a project plan — supports continued practice. Common failure: vague "to support my practice" with no dollar amount; generic artist statement.`,
  'commission': `PUBLIC ART RFQ LETTER OF INTEREST: Stage-one qualifications submission, NOT a design proposal. Required moves: (1) why this specific project / site; (2) how the practice connects to the brief; (3) reference brief specifics; (4) installation and presentation experience for photography RFQs; (5) site-responsiveness without naming a design. Length: one page. Common failure: jumping to design ideas (stage two), missing budgets in image annotations, gallery prints submitted instead of installed public works.`,
  'guggenheim-major-bespoke': `BESPOKE MAJOR GRANT (Creative Capital, Guggenheim, USA Fellowship, Joan Mitchell, MacArthur): These have published handbooks. Use the generic six-beat structure from project-proposal-structure.md, write to the published cap, address each published review criterion. The Creative Capital and Guggenheim worked examples are the model.`,
};

// WALKTHROUGH Note 21: hard voice constraints applied to project_proposal.
// Inherits the zero-em-dash + banned-phrase discipline from the statement
// constraints, plus proposal-specific bans (no lineage paragraph anywhere,
// no method/gear paragraph unless the technique justifies the project).
const PROPOSAL_VOICE_CONSTRAINTS = `HARD VOICE CONSTRAINTS — every constraint is non-negotiable:

1. ZERO em-dashes. Hard rule. No "—" anywhere. Use commas, periods, parentheses, or colons. Em-dash overuse is the strongest tell of generic AI prose; panels notice.
2. FIRST PERSON for grants, fellowships, residencies, foundation cover letters. Either person for competition statements; first-person reads more direct.
3. NO LINEAGE PARAGRAPH. Lineage belongs in the artist statement only. If you find yourself writing "the proposed work sits in the lineage of Adams / Rowell / Butcher" or "draws on the Zone System tradition" or "in the tradition of [name]", DELETE the sentence. Lineage paragraphs in proposals displace the load-bearing content (project, deliverables, timeline, budget).
4. NO METHOD / GEAR PARAGRAPH carried over from the artist statement. Technique only appears when it JUSTIFIES the project ("I will return to three Maine rivers across freeze-thaw cycles in 4x5 color negative because the format's tonal range is required to register the ice-water-bare-rock contrast at the project's exhibition scale"). A bare gear list is a category error.
5. BANNED PHRASES (hard list — do not produce any of these):
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
   - "the medium has been preparing itself"
   - "quiet authority"
   - "emotional weight"
   - "vision" / "visionary"
   - "journey"
   - "passion" / "passionate"
   - "explore" / "exploration"
   - "capture" (use "photograph", "make", "see")
6. SPECIFICITY OVER GENERALITY. Real project, real timeline in MONTHS, real deliverables with COUNTS, real venues by NAME when known. Not "a series of works" — "twelve large-format prints, 30x40 inches, exhibited at [venue] in October 2026."
7. DELIVERABLES MUST BE COUNTABLE. Number of works, page count for monograph, edition size, exhibition scale in running feet, residency outputs in defined units.
8. WHY NOW answered with a specific reason — closing window, confirmed venue, body of work at the point of needing publication, site that will not be accessible later. Not generic urgency.
9. WHY THIS FUNDER addressed in at least one clause when the funder is named (why MacDowell rather than Yaddo, why NYSCA rather than NEA). Panels notice when the application reads addressed-to-them.
10. WRITE TO THE CAP. If the form allows 750 words, write 700. Do not run under by 40%. Brevity is a virtue but only after the required content is in place.
11. WALKTHROUGH Note 32 — CANONICAL-REEL CAPS (same audit applies to proposals as to statements):
   - Maximum 3 specific location names in any single sentence. Maximum 5 across the proposal body.
   - Maximum 2 pieces of gear / technique in any single sentence. Method only when it justifies the project, never as a separate paragraph.
   - The default close "the planet is a beautiful place" (or any near-paraphrase) is BANNED — find a close specific to THIS proposal's deliverables, timeline, or stake.
   - Same-dossier repetition: the proposal body should not echo the proposal you would write for a different proposal type.

PRE-SUBMIT SELF-CHECK (do this before returning the text — silently revise if any check fails):
- Em-dash count is exactly zero.
- No lineage paragraph anywhere (no "Adams + Rowell + Butcher" name-stack, no "in the tradition of").
- Method/gear only present if it justifies the project, not as a separate section.
- Deliverables are counted (number of works, edition size, page count, etc.).
- Timeline in months, not "phases."
- No banned phrase from list 5 appears.
- No sentence contains 4+ location names. No sentence contains 3+ gear items. The "planet is a beautiful place" close is absent.`;

type DraftCtx = {
  akb: ArtistKnowledgeBase;
  opp: Opportunity;
  fingerprint: StyleFingerprint; // required — constrains all visual claims
  voiceSkill: string;
  proposalSkill: string;
  // cvSkill removed from per-opp ctx (Note 22-fix.3) — CV is now generated
  // once per run via generateMasterCv() called from the orchestrator.
  examplesSkill: string; // WALKTHROUGH Note 20 — real-statement few-shot
  proposalExamplesSkill: string; // WALKTHROUGH Note 21 — real-proposal few-shot
  oppType: OppType;
  proposalType: ProposalType; // WALKTHROUGH Note 21 — proposal template route
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

// WALKTHROUGH Note 24 (CRITICAL — safety): every biographical claim in
// drafted material must be verifiable in the provided ARTIST_AKB JSON.
// Hallucinated venues / dates / partnerships in drafts that go out under
// the artist's name constitute misrepresentation to a funding body.
// Applied to ALL Drafter prompts (statement / proposal / cover_letter /
// rationale / master CV) — alongside FINGERPRINT_CONSTRAINT (visual claims)
// and NAME_PRIMACY_CONSTRAINT (identity).
const AKB_FACTS_ONLY_CONSTRAINT = `HARD CONSTRAINT — BIOGRAPHICAL FACTS MUST COME FROM AKB ONLY:

Every claim you make about the artist's exhibitions, publications, awards, collections, representation, residencies, partnerships, commissions, dates, venues, project plans, monographs, or future commitments MUST be verifiable in the provided ARTIST_AKB JSON. Do NOT invent ANY of the following:
- Exhibitions not listed in akb.exhibitions
- Publications not listed in akb.publications
- Awards not listed in akb.awards_and_honors
- Gallery representation not listed in akb.representation
- Collections not listed in akb.collections
- Residencies, fellowships, or grants the artist has NOT received
- Partnerships with named organizations, tribes, councils, or institutions not in akb
- Specific future dates (e.g., "October 2026", "spring 2027 exhibition") UNLESS the AKB explicitly states them
- Confirmed exhibitions, commissions, or publications that are not actually confirmed in the AKB
- Curatorial or organizational credits beyond what's listed in akb.curatorial_and_organizational
- Press, awards, or recognitions not in the AKB

If the prompt asks you to be specific about WHY this opportunity, draw the specificity from:
- akb.bodies_of_work for project subject and scope
- akb.intent.aspirations for forward-looking commitments
- akb.intent.statement for animating principles
- akb.curatorial_and_organizational for community/civic credentials
- The opportunity's own field (geographic alignment, category fit, jury alignment) — these are derivable from the opp data, not invented

If the AKB does not contain a fact that would make a sentence specific, OMIT that sentence rather than invent the fact. A vaguer-but-true sentence beats a specific-but-false sentence every time. The drafted material will be submitted under the artist's name; false claims constitute misrepresentation to the funding body.

When you cite a specific year, venue, partnership, or commitment, the corresponding fact MUST be present in the AKB. If you find yourself writing "[venue] in [year]" or "ongoing [relationship]" or "confirmed [event]" and you cannot point to the AKB field that supports it, delete the claim.`;

// WALKTHROUGH Note 20: hard voice constraints applied to artist_statement +
// cover_letter (any first-person, voice-bearing prose). Loaded as system text
// so the model sees them BEFORE the few-shot examples.
const STATEMENT_VOICE_CONSTRAINTS = `HARD VOICE CONSTRAINTS — every constraint is non-negotiable. If you find yourself violating any, restructure the sentence:

1. ZERO em-dashes. Hard rule. No "—" anywhere in the output. If you want a pause, use a comma, period, parentheses, or colon. Em-dash rhythm is the single most reliable LLM-prose tell in 2026 — working artists almost never use em-dashes.
2. FIRST PERSON throughout. "I have spent…", "I return to…", "My main tool is…". Never write "[Surname]'s practice…" or "the artist's work…" except in a clearly-labeled bio paragraph. Opening with the photographer's name is fine ONLY if the next clause transitions to first person.
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
12. WALKTHROUGH Note 32 — CANONICAL-REEL CAPS. The audited symptom: every statement repeats the same locations + gear + closing line. Hard caps:
   - Maximum 3 specific location names in any single sentence. Maximum 5 across the whole statement. The full canonical location list is in the AKB; SELECT 2-3 most relevant for THIS opportunity, do not enumerate.
   - Maximum 2 pieces of gear / technique in any single sentence. The full technique inventory belongs in the CV. The statement justifies technique only when it serves THIS opportunity's evaluation criteria.
   - The default close "the planet is a beautiful place" (or any near-paraphrase) is BANNED — it appears in too many statements as a fallback. Find a close specific to THIS opportunity's body of work, type, or stake.
   - Same-dossier closing-line repetition: the close should NOT echo the close you would write for a different opportunity type. State-fellowship closes ground in a place; landscape-prize closes ground in the body of work; book-grant closes ground in the monograph.

PRE-SUBMIT SELF-CHECK (do this before returning the text — silently revise if any check fails):
- Em-dash count is exactly zero.
- First person throughout (or first-person-after-name-once).
- First sentence does NOT contain a camera brand, print format, lineage name, or place list.
- Lineage names total: 0, 1, or 2 — never 3+.
- One sentence is 5-12 words, present-tense, declarative.
- No banned phrase from constraint #4 appears.
- Word count is 150-300.
- No sentence contains 4+ location names. No sentence contains 3+ gear items. The "planet is a beautiful place" close is absent.`;

// WALKTHROUGH Note 23: cover-letter-specific structural rules layered on
// top of STATEMENT_VOICE_CONSTRAINTS. Cover letters are personal corre-
// spondence from the artist to the panel; they need first-person enforce-
// ment, salutation convention, no lineage paragraph, selective career
// markers, and an opportunity-specific "why this, why now" sentence.
const COVER_LETTER_VOICE_CONSTRAINTS = `COVER LETTER STRUCTURAL RULES (in addition to the voice constraints above):

1. FIRST PERSON THROUGHOUT. The cover letter is personal correspondence FROM the photographer TO the panel. Write "I submit…", "I am a [city]-based photographer working in [body of work / register from AKB]…", "I was included in…". NEVER use the photographer's surname plus a verb ("[Surname] submits…", "[Surname] is…", "[Surname] was…"). The surname appears ONLY as the typed signature at the bottom.

2. SALUTATION. Open with "Dear [Name]," or "Dear Selection Committee,". NEVER bare "Selection Committee" or "To Whom It May Concern". If the opportunity record names a juror or panel chair, address them by name and title ("Dear Dr. [Name],").

3. NO LINEAGE PARAGRAPH. Lineage lives in the artist statement. The panel reads the statement separately. Banned: any sentence listing two or more named photographers as influences (Adams + Rowell + Lik + Butcher + Luong rolls). Banned: phrases "lineage of", "in the tradition of", "the work sits in", "commercial-gallery register", "destination-landscape tradition".

4. SELECTIVE CAREER MARKERS. Pick the 1-3 career markers from the AKB MOST RELEVANT to THIS specific opportunity, then drop the rest. Geographic fit → pull a credit from akb.exhibitions whose location overlaps the opportunity's region. Register fit → pull credits from akb.exhibitions / akb.publications whose institutions align with the opportunity's aesthetic register. Civic / community / curatorial relevance → pull from akb.curatorial_and_organizational. Do NOT paste the full career reel into every letter — every letter dumps a different 1-3 markers tuned to the specific opportunity.

5. SPECIFIC TO THIS OPPORTUNITY. The letter MUST contain at least one sentence naming a specific reason for THIS opportunity at THIS time — not generic "this is the right venue for this work." Examples: "I am writing in advance of the upcoming third monograph deadline because [opp] would directly support its publication"; "the cohort recognized in [opp]'s last cycle includes work I have studied closely"; "the [specific category] is the right home for the [specific body of work]".

6. STRUCTURE: salutation → 1 paragraph self-introduction (who I am, in 1-2 sentences) → 1 paragraph why this specific opportunity (the case for fit) → 1 paragraph the most relevant career markers (selective) → close ("Thank you for your consideration.") → signature on its own line (the artist's NAME from identity.artist_name).

7. LENGTH 200-350 words. Brevity is generosity to the panel.

8. NO METHOD/GEAR PARAGRAPH. Technique belongs in the artist statement (where it's justified) or the project proposal (where it's load-bearing). The cover letter is correspondence, not a technical document.

9. NO TAX/ADMIN FOOTER. The artist's legal name belongs in the application form's admin section, not in the cover letter body. Sign with identity.artist_name only.

10. INHERITED BANS still apply: "sits in the lineage of", "commercial-gallery register", "aesthetic signature", "the medium has been preparing itself", "quiet authority", "emotional weight", and the Note 20 banned word list (vision, journey, passion, explore, capture, story-when-generic).

11. WALKTHROUGH Note 32 — CANONICAL-REEL CAPS (same audit applies to cover letters as to statements):
   - Maximum 3 specific location names in any single sentence. Maximum 5 across the body.
   - Maximum 2 pieces of gear / technique in any single sentence (and prefer none — see rule 8).
   - The default close "the planet is a beautiful place" (or any near-paraphrase) is BANNED — sign off with "Thank you for your consideration." or a specific opp-relevant close, not a generic planet/world/place line.

PRE-SUBMIT SELF-CHECK (silently revise if any fails):
- Salutation includes "Dear" and ends with comma.
- Body uses first person throughout. Zero instances of the photographer's surname in any body sentence (signature only).
- No sentence names two or more photographers as influences.
- One sentence specifically references this opportunity by name + a specific reason for this cycle.
- Word count 200-350 (signature line excluded from the count).
- Closes with a sign-off ("Thank you for your consideration." or similar) followed by a signature line.
- No sentence contains 4+ location names. No sentence contains 3+ gear items. The "planet is a beautiful place" close is absent.`;

const PROMPTS: Record<MaterialType, (ctx: DraftCtx) => { system: string; user: string }> = {
  artist_statement: (ctx) => ({
    system:
      // The few-shot examples skill goes FIRST — it's the ground truth the
      // voice constraints + fingerprint guard are pointing at.
      ctx.examplesSkill +
      '\n\n---\n\n' +
      STATEMENT_VOICE_CONSTRAINTS +
      '\n\n---\n\n' +
      FINGERPRINT_CONSTRAINT + '\n\n---\n\n' + NAME_PRIMACY_CONSTRAINT + '\n\n---\n\n' + AKB_FACTS_ONLY_CONSTRAINT +
      '\n\n---\n\nYou are writing an artist statement for a specific opportunity application. The few-shot examples above are real winning statements — match THEIR voice, not the curatorial-essay or LLM-default register. Pull facts ONLY from the provided AKB — never invent. Visual claims MUST match the StyleFingerprint. No preamble, no markdown. Return plain text only.',
    user: `OPPORTUNITY: ${ctx.opp.name} (${ctx.opp.award.type}, ${ctx.opp.award.prestige_tier}) — ${ctx.opp.url}

OPPORTUNITY_TYPE: ${ctx.oppType}

${TAILORING_BY_TYPE[ctx.oppType]}

${EMPHASIS_BY_OPP_TYPE[ctx.oppType]}

STYLE_FINGERPRINT (ground truth for visual claims):
${JSON.stringify(ctx.fingerprint, null, 2)}

ARTIST_AKB (ground truth for biographical + career claims):
${JSON.stringify(ctx.akb, null, 2)}

Write the artist statement now. Describe the work as the fingerprint says it IS. This statement MUST differ meaningfully from a statement written for a different opportunity type — if you find yourself writing the same opening, structure, OR BODY (locations, gear, closing line) as you would for any other opportunity, restructure. The opening + the BODY + the close all need to be opp-specific, not just the opening.`,
  }),
  project_proposal: (ctx) => ({
    system:
      // Real-proposal few-shot FIRST so the model sees verbatim recipient
      // examples (MacDowell project descriptions, Aperture book framings,
      // Pollock-Krasner cover letters) before the constraints. The
      // generic structure file (proposalSkill) is loaded after as the
      // bespoke fallback for Creative Capital / Guggenheim / etc.
      ctx.proposalExamplesSkill +
      '\n\n---\n\n' +
      ctx.proposalSkill +
      '\n\n---\n\n' +
      PROPOSAL_VOICE_CONSTRAINTS +
      '\n\n---\n\n' +
      FINGERPRINT_CONSTRAINT + '\n\n---\n\n' + NAME_PRIMACY_CONSTRAINT + '\n\n---\n\n' + AKB_FACTS_ONLY_CONSTRAINT +
      '\n\n---\n\nYou are writing a project proposal for a specific opportunity. The proposal type is given in the user message — use the matching template from the few-shot examples above (NOT the generic six-beat structure unless the type is "guggenheim-major-bespoke"). Pull facts ONLY from the provided AKB — never invent. Visual claims about current work MUST match the StyleFingerprint. Project aspirations MAY extend beyond current work but must be connected to it. If the opportunity\'s stated requirements are provided, follow their structure and word limits. No preamble, no markdown. Return plain text only.',
    user: `OPPORTUNITY: ${ctx.opp.name} (${ctx.opp.award.type}, ${ctx.opp.award.prestige_tier}) — ${ctx.opp.url}

PROPOSAL_TYPE: ${ctx.proposalType}

${PROPOSAL_TAILORING[ctx.proposalType]}

OPPORTUNITY_REQUIREMENTS (from their page, may be partial):
${ctx.oppRequirementsText || '(not available — use the template above)'}

STYLE_FINGERPRINT:
${JSON.stringify(ctx.fingerprint, null, 2)}

ARTIST_AKB:
${JSON.stringify(ctx.akb, null, 2)}

Write the project proposal now. Match the structural shape of the matching template above — a competition portfolio statement is NOT a residency project description is NOT a state arts council fellowship narrative. This proposal MUST differ meaningfully from a proposal written for a different opportunity type. End with a complete sentence — do not truncate mid-thought.`,
  }),
  // WALKTHROUGH Note 22-fix.3: cv entry removed. Master CV is generated
  // once per run by generateMasterCv() and persisted on dossiers.master_cv.
  cover_letter: (ctx) => ({
    system:
      ctx.voiceSkill +
      '\n\n---\n\n' +
      // WALKTHROUGH Note 20: same zero-em-dash + banned-phrase discipline as
      // the artist statement. Cover letters are first-person voice-bearing
      // prose — the same LLM tells apply.
      STATEMENT_VOICE_CONSTRAINTS +
      '\n\n---\n\n' +
      // WALKTHROUGH Note 23: cover-letter-specific structural rules layered
      // on top of the inherited statement voice block.
      COVER_LETTER_VOICE_CONSTRAINTS +
      '\n\n---\n\n' +
      FINGERPRINT_CONSTRAINT + "\n\n---\n\n" + NAME_PRIMACY_CONSTRAINT + "\n\n---\n\n" + AKB_FACTS_ONLY_CONSTRAINT +
      `\n\n---\n\nYou are writing a brief cover letter from the artist (${ctx.akb.identity.artist_name || 'the artist'}) to this opportunity's selectors. Pull facts ONLY from the provided AKB. Visual claims MUST match the StyleFingerprint. No preamble, no markdown. Return plain text only — start with the salutation line, end with the artist's signed name.`,
    user: `OPPORTUNITY: ${ctx.opp.name} (${ctx.opp.award.type}, ${ctx.opp.award.prestige_tier}) — ${ctx.opp.url}

PROPOSAL_TYPE: ${ctx.proposalType}

STYLE_FINGERPRINT:
${JSON.stringify(ctx.fingerprint, null, 2)}

ARTIST_AKB:
${JSON.stringify(ctx.akb, null, 2)}

Write the cover letter now. First-person throughout. Open with "Dear [name]," or "Dear Selection Committee,". Pick 1-3 career markers MOST RELEVANT to THIS specific opportunity (do not paste the full reel). Include one sentence naming a specific reason for THIS opportunity at THIS time. Sign with the artist's name (${ctx.akb.identity.artist_name || 'the artist'}).`,
  }),
};

// WALKTHROUGH Note 21 truncation fix: project_proposal needs a higher
// max_tokens because (a) state-fellowship + bespoke proposals can run to
// ~750 words ≈ ~1000 output tokens, and (b) adaptive thinking eats into
// the same budget. The Epson Pano regression at 63 words was the symptom.
//
// WALKTHROUGH Note 26: artist_statement bumped 3000 → 4000 to match
// proposal headroom. The ILPOTY redraft regression cut a statement at
// 138 words ending mid-sentence ("I work in the") — adaptive thinking
// consumed enough of the 3000-token budget that the model's prose got
// truncated even at the modest 150-300-word target.
//
// CV is factual and bounded; cover_letter is length-capped in the prompt
// at 200-350 words and has not regressed. 4000 across the prose materials
// keeps the budget consistent.
// WALKTHROUGH Note 33-fix.6 — bumped from 4000/4000/3000 to 8000/8000/6000.
// Empirical: at 4000 max_tokens with adaptive thinking on Opus 4.7, dense
// opportunity-page contexts (Epson Pano's 20K-char page text + full AKB
// JSON + StyleFingerprint JSON) can consume the entire budget in the
// thinking phase and emit zero prose. Note 26 bumped statement 3000→4000
// for the same root cause; this follow-up is the next ceiling. Cost
// impact is bounded — adaptive thinking only spends what it needs and
// the prose targets (150-300 / 250-750 / 200-350 words) are unchanged.
const MAX_TOKENS_BY_TYPE: Record<MaterialType, number> = {
  artist_statement: 8000,
  project_proposal: 8000,
  cover_letter: 6000,
};

async function draftMaterial(type: MaterialType, ctx: DraftCtx): Promise<string> {
  const { system, user } = PROMPTS[type](ctx);
  const client = getAnthropic();
  const resp = await withAnthropicRetry(
    () => client.messages.create({
      model: MODEL_OPUS,
      max_tokens: MAX_TOKENS_BY_TYPE[type],
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
  // WALKTHROUGH Note 32: default closing line that appeared in 6 of 6
  // statements in the audited demo run. Ban the phrase + common variants.
  'the planet is a beautiful place',
  'the world is a beautiful place',
  'the earth is a beautiful place',
  'beautiful place worth',
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

/**
 * WALKTHROUGH Note 24 (CRITICAL — safety): deterministic fact-grounding
 * check. Catches the most common hallucination patterns the model emits
 * when prompted for opportunity-specific specificity:
 *
 * 1. YEARS not in AKB. Extracts every `\b20\d{2}\b` from the generated
 *    text. Each year must either fall in the "near-term reference window"
 *    (CURRENT_YEAR-1 through CURRENT_YEAR+2 — generated text legitimately
 *    references "this cycle" and the upcoming submission window) OR
 *    appear somewhere in the AKB JSON string. Years outside the window
 *    that aren't in the AKB are hallucinations.
 *
 * 2. INVENTED COMMITMENTS / VENUES / PARTNERSHIPS. Extracts phrases that
 *    look like specific commitments — "confirmed [X]", "ongoing partner-
 *    ship with [X]", "exhibition at [X]" — and substring-checks the
 *    captured noun phrase against the lowercased AKB JSON. If the phrase
 *    doesn't appear in the AKB, it's flagged.
 *
 * Returns a list of issue strings (empty when clean). Designed to be
 * appended to the existing voice-check `issues` arrays so the same
 * one-shot revision pass can address voice + fact issues together.
 */
// Patterns capture the proper-noun phrase after the trigger. Optional
// article ("the", "a", "an") is consumed first; the captured entity must
// start with a capital letter and may continue with additional capital-
// led words. Capture naturally terminates when the next word starts with
// a lowercase letter (verb / preposition) — no greedy lookahead pitfalls.
//
// "exhibition at the Boulder City library" → captures "Boulder City"
// "ongoing partnership with the Walker River Paiute Tribe is …" → captures "Walker River Paiute Tribe"
// "exhibition at Mondoir Gallery in Las Vegas" → captures "Mondoir Gallery"
const PROPER_NOUN = String.raw`(?:the\s+|a\s+|an\s+)?[A-Z][A-Za-z0-9']*(?:\s+[A-Z][A-Za-z0-9']*)*`;
const FACT_CHECK_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: new RegExp(String.raw`\bconfirmed\s+(?:exhibition|publication|commission|residency|fellowship|award|acquisition|partnership|grant)\s+(?:at|by|with|for)\s+(${PROPER_NOUN})`, 'gi'), label: 'confirmed [thing] at/by/with/for' },
  { re: new RegExp(String.raw`\bongoing\s+partnership\s+with\s+(${PROPER_NOUN})`, 'gi'), label: 'ongoing partnership with' },
  { re: new RegExp(String.raw`\bexhibition\s+at\s+(${PROPER_NOUN})`, 'gi'), label: 'exhibition at' },
  { re: new RegExp(String.raw`\bcommissioned\s+by\s+(${PROPER_NOUN})`, 'gi'), label: 'commissioned by' },
];

const COMMON_WORDS_AROUND_DATES = new Set([
  'spring', 'summer', 'fall', 'autumn', 'winter',
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
]);

function getCurrentYear(): number {
  return new Date().getUTCFullYear();
}

export function checkFactGrounding(
  text: string,
  akbJsonString: string,
): { ok: boolean; issues: string[] } {
  const issues: string[] = [];
  const akbLower = akbJsonString.toLowerCase();
  const currentYear = getCurrentYear();
  const yearWindowMin = currentYear - 1;
  const yearWindowMax = currentYear + 2;

  // 1. Year check.
  const yearRe = /\b(20\d{2})\b/g;
  const seenYears = new Set<number>();
  let m: RegExpExecArray | null;
  while ((m = yearRe.exec(text)) !== null) {
    const year = Number(m[1]);
    if (seenYears.has(year)) continue;
    seenYears.add(year);
    if (year >= yearWindowMin && year <= yearWindowMax) continue; // near-term reference window
    if (akbJsonString.includes(String(year))) continue;
    issues.push(`year "${year}" appears in the draft but is not in the AKB and falls outside the near-term reference window (${yearWindowMin}-${yearWindowMax}). If you cited a specific past or future year for an exhibition / publication / award / commitment, the AKB must support it.`);
  }

  // 2. Specific-commitment phrase check. For each captured noun phrase,
  // require its HEAD NOUN (first 3+-char token, ignoring stopwords) to
  // appear in the AKB JSON. Substring match against AKB — covers minor
  // case + article differences. A captured "Walker River Paiute Tribe"
  // is flagged because "walker" isn't in AKB; "Mondoir Gallery" is
  // accepted because "mondoir" is.
  const STOPWORDS = new Set(['the', 'and', 'for', 'with', 'from', 'into', 'onto', 'over', 'this', 'that', 'these', 'those', 'their', 'our']);
  for (const { re, label } of FACT_CHECK_PATTERNS) {
    re.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) {
      const phrase = match[1]?.trim();
      if (!phrase || phrase.length < 3) continue;
      const phraseLower = phrase.toLowerCase();
      const tokens = phraseLower
        .split(/\s+/)
        .filter((t) => t.length > 2 && !STOPWORDS.has(t));
      if (tokens.length === 0) continue;
      // Skip generic season-prefix / month-prefix captures that aren't
      // entity claims (e.g. "confirmed Spring 2026 publication cycle").
      if (COMMON_WORDS_AROUND_DATES.has(tokens[0])) continue;
      const headNoun = tokens[0];
      if (!akbLower.includes(headNoun)) {
        issues.push(`"${label} ${phrase}" appears in the draft but no matching entity ("${headNoun}") is in the AKB. Either remove the claim or replace with a true claim from akb.exhibitions / akb.awards_and_honors / akb.curatorial_and_organizational / akb.bodies_of_work / akb.intent.aspirations.`);
      }
    }
  }

  return { ok: issues.length === 0, issues };
}

/**
 * WALKTHROUGH Note 32 (32-fix.2): per-sentence canonical-reel cap helpers.
 * Counted at LINT time so the existing voice-check revision pass picks
 * up overly-long location enumerations and gear stacks.
 *
 * Heuristics (deliberately loose — over-flagging triggers a free retry,
 * under-flagging just keeps prior behavior):
 *   - Location count per sentence: count proper-noun phrases that match
 *     the canonical landscape-photo location list (Antelope Canyon,
 *     Delicate Arch, Palouse, Hawaii, Amsterdam, Lisbon, Dubai, Yosemite,
 *     Sierra Nevada, etc.) AND any other Capitalized proper-noun phrase
 *     when the sentence already contains 2+ commas (typical "I have
 *     photographed in X, Y, Z, A, B" pattern).
 *   - Gear count per sentence: matches against a known-gear lexicon
 *     (Hasselblad, Phase One, Canon, Nikon, Fuji Flex, ND filter, Zone
 *     System, large-format film, drum scan, etc.).
 */
// WALKTHROUGH Note 33 — universal landscape-photo destination canon. Atelier
// is built for working photographers; these are places that recur in
// landscape-photo bodies of work across the field, not one specific
// photographer's travel reel. Augmented at runtime via extractAkbLocations()
// with the locations THIS photographer has actually worked in (from their
// own bodies_of_work / home_base / exhibitions). Match is case-sensitive +
// substring (`includes`), one canonical form per place.
const CANONICAL_PHOTO_DESTINATIONS = [
  'Antelope Canyon',
  'Delicate Arch',
  'Palouse',
  'Hawaii',
  'Yosemite',
  'Sierra Nevada',
  'Death Valley',
  'Arches',
  'Zion',
  'Bryce',
  'Patagonia',
  'Iceland',
  'Norway',
  'Banff',
  'Grand Canyon',
  'Half Dome',
];
// Universal large-format / fine-art photography gear vocabulary. Photo canon,
// not one photographer's specific kit — every working fine-art photographer
// is checking their drafts against this baseline.
const GEAR_LEXICON = [
  'Hasselblad',
  'Phase One',
  'Canon',
  'Nikon',
  'Sony Alpha',
  'Fuji Flex',
  'Fuji film',
  'Fujifilm',
  'large-format film',
  'large format film',
  'Zone System',
  'graduated ND',
  'ND filter',
  'ND grad',
  'tilt-shift',
  'drum scan',
  'archival pigment',
  'cibachrome',
  '4x5',
  '8x10',
  'Linhof',
  'Schneider',
];

/**
 * WALKTHROUGH Note 33: per-photographer location extractor. Pulls
 * Capitalized place tokens from the AKB's bodies_of_work[*].description,
 * home_base.city, and exhibitions[*].location so the canonical-reel cap
 * operates on THIS photographer's actual reel, not just the universal
 * photo-canon baseline. Returns deduped, length-2+ tokens.
 */
export function extractAkbLocations(akb: ArtistKnowledgeBase): string[] {
  const out = new Set<string>();
  const PROPER_PHRASE = /\b[A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)*/g;
  const sources: string[] = [];
  if (akb.identity?.home_base?.city) sources.push(akb.identity.home_base.city);
  for (const b of akb.bodies_of_work ?? []) {
    if (b.description) sources.push(b.description);
    if (b.title) sources.push(b.title);
  }
  for (const e of akb.exhibitions ?? []) {
    if (e.location) sources.push(e.location);
    if (e.venue) sources.push(e.venue);
  }
  for (const text of sources) {
    PROPER_PHRASE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = PROPER_PHRASE.exec(text)) !== null) {
      const phrase = m[0].trim();
      if (phrase.length >= 2) out.add(phrase);
    }
  }
  return [...out];
}

function splitIntoSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function countLocationsInSentence(sentence: string, extraLocations: string[] = []): number {
  let count = 0;
  const seen = new Set<string>();
  for (const loc of [...CANONICAL_PHOTO_DESTINATIONS, ...extraLocations]) {
    if (seen.has(loc)) continue;
    if (sentence.includes(loc)) {
      count++;
      seen.add(loc);
    }
  }
  return count;
}

export function countGearInSentence(sentence: string): number {
  let count = 0;
  for (const gear of GEAR_LEXICON) {
    const re = new RegExp(`\\b${gear.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (re.test(sentence)) count++;
  }
  return count;
}

export function checkCanonicalReelCaps(text: string, extraLocations: string[] = []): string[] {
  const issues: string[] = [];
  for (const s of splitIntoSentences(text)) {
    const locs = countLocationsInSentence(s, extraLocations);
    if (locs > 3) {
      issues.push(
        `sentence has ${locs} location names ("${s.slice(0, 80)}…") — cap is 3 per sentence. Pick the 2-3 most relevant for THIS opportunity.`,
      );
    }
    const gear = countGearInSentence(s);
    if (gear > 2) {
      issues.push(
        `sentence has ${gear} gear/technique items ("${s.slice(0, 80)}…") — cap is 2 per sentence. Technique justifies a project; it is not a list.`,
      );
    }
  }
  return issues;
}

/**
 * WALKTHROUGH Note 32 (32-fix.3): cross-dossier content-variation check.
 *
 * Computes pairwise Jaccard token-bag similarity for a set of same-material
 * drafts (e.g. all 6 artist statements in a dossier). The audited symptom:
 * statements that vary STRUCTURE but repeat BODY CONTENT (same canonical
 * locations, gear list, closing line) read as "one statement reshuffled."
 * Pair similarity > 0.50 is suspicious; > 0.75 is a re-draft candidate.
 *
 * Pure deterministic — runs in the orchestrator after all drafts complete.
 * Returns a list of issue strings (each names the offending pair + their
 * similarity score). Empty array means cross-dossier variation is healthy.
 *
 * Tokenization: lowercase, strip non-alphanumeric, drop short stopwords.
 * Comparison: Jaccard = |A ∩ B| / |A ∪ B|.
 */
const CONTENT_VARIATION_STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'into', 'onto', 'over', 'this', 'that',
  'these', 'those', 'their', 'our', 'are', 'was', 'were', 'has', 'have', 'had',
  'will', 'would', 'could', 'should', 'can', 'may', 'might', 'not', 'but',
  'about', 'than', 'then', 'when', 'where', 'who', 'what', 'which', 'why',
  'how', 'all', 'any', 'some', 'one', 'two', 'they', 'them', 'its', 'his',
  'her', 'him', 'she', 'you', 'your', 'yours', 'mine', 'ours', 'his', 'hers',
]);

function tokenize(text: string): Set<string> {
  const tokens = new Set<string>();
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 4) continue; // drop short stopwords / numbers
    if (CONTENT_VARIATION_STOPWORDS.has(raw)) continue;
    tokens.add(raw);
  }
  return tokens;
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const t of a) if (b.has(t)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export type ContentVariationResult = {
  ok: boolean;
  averageSimilarity: number;
  highPairs: Array<{ i: number; j: number; similarity: number }>;
  redraftCandidates: Array<{ i: number; j: number; similarity: number }>;
  issues: string[];
};

export function checkContentVariation(
  texts: string[],
  thresholds: { warn?: number; redraft?: number } = {},
): ContentVariationResult {
  const warn = thresholds.warn ?? 0.5;
  const redraft = thresholds.redraft ?? 0.75;
  const tokenSets = texts.map(tokenize);
  const pairs: Array<{ i: number; j: number; similarity: number }> = [];
  let total = 0;
  let pairCount = 0;
  for (let i = 0; i < tokenSets.length; i++) {
    for (let j = i + 1; j < tokenSets.length; j++) {
      const sim = jaccardSimilarity(tokenSets[i], tokenSets[j]);
      pairs.push({ i, j, similarity: sim });
      total += sim;
      pairCount++;
    }
  }
  const averageSimilarity = pairCount === 0 ? 0 : total / pairCount;
  const highPairs = pairs.filter((p) => p.similarity > warn);
  const redraftCandidates = pairs.filter((p) => p.similarity > redraft);

  const issues: string[] = [];
  if (averageSimilarity > warn) {
    issues.push(
      `cross-dossier average pairwise Jaccard similarity is ${averageSimilarity.toFixed(3)} (>${warn}). The drafts read as one document reshuffled — body content is too uniform across the set.`,
    );
  }
  for (const p of redraftCandidates) {
    issues.push(
      `drafts ${p.i} and ${p.j} have similarity ${p.similarity.toFixed(3)} (>${redraft}). Re-draft candidate: the per-opp emphasis didn't differentiate the body enough.`,
    );
  }
  return {
    ok: issues.length === 0,
    averageSimilarity,
    highPairs,
    redraftCandidates,
    issues,
  };
}

// WALKTHROUGH Note 33-fix.6 — empty / too-short floor. The terminal-
// punctuation check guards on `text.length > 0`, so when the model
// returns an empty text block (all budget spent on adaptive thinking,
// or the adaptive-thinking phase emitted no prose at all) every other
// check passes vacuously and the empty string ships as a finished
// material into the dossier. Real fix: explicit floor that ALWAYS
// triggers the revise pass when the model returned nothing meaningful.
// 20 chars is the floor — well below any legitimate test fixture
// (smallest is 36 chars) and well above the actual failure case
// (empty string / one-word refusal). The substantive sanity check on
// length is the per-material word-count linter and the prompt's
// stated word target (150-300 / 250-750 / 200-350); this floor only
// guards against zero-byte ship-to-dossier.
const MIN_DRAFT_CHARS = 20;

export function checkStatementVoice(text: string, extraLocations: string[] = []): {
  ok: boolean;
  issues: string[];
} {
  const issues: string[] = [];
  if (text.trim().length < MIN_DRAFT_CHARS) {
    issues.push(
      `statement is empty or too short (${text.trim().length} chars; floor is ${MIN_DRAFT_CHARS}). Likely the model's adaptive-thinking phase consumed the budget and produced no prose. Write a complete 150-300 word artist statement now, in plain text, no preamble.`,
    );
    return { ok: false, issues };
  }
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
  // WALKTHROUGH Note 26: terminal-punctuation check. Mirrors checkProposalVoice.
  // Catches the ILPOTY-style truncation where the model emits "I work in the"
  // and runs out of budget. Allow ., !, ?, ", ', ), ] as terminals.
  if (text.length > 0 && !/[.!?"'\)\]]\s*$/.test(text)) {
    issues.push('statement does not end with terminal punctuation — likely truncated mid-sentence; check max_tokens budget');
  }
  // WALKTHROUGH Note 32 + 33: per-sentence canonical-reel caps. Universal
  // photo-destination canon merged with this photographer's AKB-derived
  // locations so the cap operates on THEIR reel, not a hardcoded list.
  issues.push(...checkCanonicalReelCaps(text, extraLocations));
  return { ok: issues.length === 0, issues };
}

async function draftStatementWithVoiceCheck(ctx: DraftCtx): Promise<string> {
  const first = await draftMaterial('artist_statement', ctx);
  const voice = checkStatementVoice(first, extractAkbLocations(ctx.akb));
  // WALKTHROUGH Note 24: combine voice + fact-grounding issues so the
  // single revision turn addresses them together.
  const facts = checkFactGrounding(first, JSON.stringify(ctx.akb));
  const allIssues = [...voice.issues, ...facts.issues];
  if (allIssues.length === 0) return first;

  // One-shot revision pass — feed the violations back as a follow-up turn.
  const { system } = PROMPTS.artist_statement(ctx);
  const client = getAnthropic();
  const resp = await withAnthropicRetry(
    () =>
      client.messages.create({
        model: MODEL_OPUS,
        // WALKTHROUGH Note 26: read from the table so revision matches the
        // first-draft budget. Previously hardcoded 3000 — that was the
        // truncation regression's enabling factor.
        max_tokens: MAX_TOKENS_BY_TYPE.artist_statement,
        thinking: { type: 'adaptive' },
        system,
        messages: [
          { role: 'user', content: PROMPTS.artist_statement(ctx).user },
          { role: 'assistant', content: first },
          {
            role: 'user',
            content: `Your draft violated the hard constraints. Specific issues:\n${allIssues.map((i) => `- ${i}`).join('\n')}\n\nRewrite the statement now. Same opportunity, same facts, but fix every issue listed above. End with a complete sentence — do not truncate mid-thought. Return plain text only.`,
          },
        ],
      }),
    { label: `drafter-artist_statement-revise` },
  );
  const revised = resp.content.find((b) => b.type === 'text')?.text?.trim() ?? '';
  // Note 33-fix.6 — soft fallback to first ONLY when first is non-empty.
  // If both first and revised are empty, throw so the caller surfaces the
  // failure (run_events row + UI flag) instead of silently shipping a
  // 0-byte material into the dossier.
  if (revised.length >= MIN_DRAFT_CHARS) return revised;
  if (first.length >= MIN_DRAFT_CHARS) return first;
  throw new Error(
    `artist_statement draft + revision both empty/too short (first=${first.length}, revised=${revised.length}). Likely adaptive-thinking-budget exhaustion; check max_tokens.`,
  );
}

/**
 * WALKTHROUGH Note 21: post-write voice check on the project proposal.
 * Mirrors the statement check but adds proposal-specific rules:
 *  - additional banned phrases per skill voice rule #11
 *  - lineage paragraph check ("the proposed work sits in the lineage of",
 *    "draws on the [name] tradition", three lineage names in one paragraph)
 *  - terminal-punctuation check (catches the Epson-Pano-style truncation
 *    regression where the model ran out of tokens mid-sentence)
 */
const PROPOSAL_BANNED_PHRASES = [
  ...STATEMENT_BANNED_PHRASES,
  'the medium has been preparing itself',
  'quiet authority',
  'emotional weight',
  'sits in the lineage of',
  'draws on the zone system tradition',
  'in the tradition of',
];
const PROPOSAL_BANNED_WORDS = STATEMENT_BANNED_WORDS;

const LINEAGE_NAME_PARAGRAPH = /\b(adams|rowell|butcher|luong|frye|burtynsky|sugimoto|eggleston|crewdson|wall|weston|porter|misrach)\b.*\b(adams|rowell|butcher|luong|frye|burtynsky|sugimoto|eggleston|crewdson|wall|weston|porter|misrach)\b.*\b(adams|rowell|butcher|luong|frye|burtynsky|sugimoto|eggleston|crewdson|wall|weston|porter|misrach)\b/i;

export function checkProposalVoice(text: string, extraLocations: string[] = []): {
  ok: boolean;
  issues: string[];
} {
  const issues: string[] = [];
  // Note 33-fix.6 — empty / too-short floor (see MIN_DRAFT_CHARS).
  if (text.trim().length < MIN_DRAFT_CHARS) {
    issues.push(
      `proposal is empty or too short (${text.trim().length} chars; floor is ${MIN_DRAFT_CHARS}). Likely the model's adaptive-thinking phase consumed the budget and produced no prose. Write a complete proposal now per the matching template, in plain text, no preamble.`,
    );
    return { ok: false, issues };
  }
  if (text.includes('—')) {
    const count = (text.match(/—/g) || []).length;
    issues.push(`${count} em-dash(es) found — use commas, periods, or parentheses instead. Hard rule: zero em-dashes.`);
  }
  const lower = text.toLowerCase();
  for (const phrase of PROPOSAL_BANNED_PHRASES) {
    if (lower.includes(phrase)) issues.push(`banned phrase: "${phrase}"`);
  }
  for (const word of PROPOSAL_BANNED_WORDS) {
    const re = new RegExp(`\\b${word}\\b`, 'i');
    if (re.test(text)) issues.push(`banned word: "${word}" — use a concrete alternative`);
  }
  // Lineage-paragraph check: three or more named photographers in a single
  // paragraph anywhere in the text. Lineage paragraphs belong in the artist
  // statement, never in a proposal (skill voice rule #5).
  for (const para of text.split(/\n\s*\n/)) {
    if (LINEAGE_NAME_PARAGRAPH.test(para)) {
      issues.push('lineage paragraph detected — three or more named photographers in one paragraph; lineage belongs in the artist statement, not the proposal');
      break;
    }
  }
  // Truncation check: the proposal must end with a complete sentence, not
  // mid-thought. Catches the Epson-Pano-style 63-word regression where the
  // model ran out of tokens. Allow ., !, ?, ", ', ), ] as terminals.
  if (text.length > 0 && !/[.!?"'\)\]]\s*$/.test(text)) {
    issues.push('proposal does not end with terminal punctuation — likely truncated; check max_tokens budget');
  }
  // WALKTHROUGH Note 32 + 33: per-sentence canonical-reel caps with the
  // AKB-derived per-photographer location list merged into the universal
  // photo-destination canon.
  issues.push(...checkCanonicalReelCaps(text, extraLocations));
  return { ok: issues.length === 0, issues };
}

async function draftProposalWithVoiceCheck(ctx: DraftCtx): Promise<string> {
  const first = await draftMaterial('project_proposal', ctx);
  const voice = checkProposalVoice(first, extractAkbLocations(ctx.akb));
  // WALKTHROUGH Note 24: bundle fact-grounding issues with voice issues.
  const facts = checkFactGrounding(first, JSON.stringify(ctx.akb));
  const allIssues = [...voice.issues, ...facts.issues];
  if (allIssues.length === 0) return first;

  const { system } = PROMPTS.project_proposal(ctx);
  const client = getAnthropic();
  const resp = await withAnthropicRetry(
    () =>
      client.messages.create({
        model: MODEL_OPUS,
        max_tokens: MAX_TOKENS_BY_TYPE.project_proposal,
        thinking: { type: 'adaptive' },
        system,
        messages: [
          { role: 'user', content: PROMPTS.project_proposal(ctx).user },
          { role: 'assistant', content: first },
          {
            role: 'user',
            content: `Your draft violated the hard proposal constraints. Specific issues:\n${allIssues.map((i) => `- ${i}`).join('\n')}\n\nRewrite the proposal now. Same opportunity, same template, but fix every issue listed above. End with a complete sentence. Return plain text only.`,
          },
        ],
      }),
    { label: `drafter-project_proposal-revise` },
  );
  const revised = resp.content.find((b) => b.type === 'text')?.text?.trim() ?? '';
  // Note 33-fix.6 — see draftStatementWithVoiceCheck for rationale.
  if (revised.length >= MIN_DRAFT_CHARS) return revised;
  if (first.length >= MIN_DRAFT_CHARS) return first;
  throw new Error(
    `project_proposal draft + revision both empty/too short (first=${first.length}, revised=${revised.length}). Likely adaptive-thinking-budget exhaustion; check max_tokens.`,
  );
}

/**
 * WALKTHROUGH Note 23: post-write voice check on the cover letter. Mirrors
 * Note 20/21 — deterministic linter + bounded one-shot revision pass.
 * Cover-letter-specific checks layered on top of the inherited statement
 * lints: salutation must include "Dear", body must be first-person (no
 * "[Surname] submits/is/was/has" in the body), no lineage paragraph (3+ named
 * photographers in one paragraph), opportunity name must appear at least
 * once, length 200-350 words excluding the signature line.
 *
 * `lastName` is the artist's surname extracted from identity.artist_name
 * (last whitespace-separated token). Letting the signature line carry the
 * surname is fine — only the body is checked for third-person leakage.
 */
const COVER_LETTER_BANNED_PHRASES = [
  ...PROPOSAL_BANNED_PHRASES,
  'to whom it may concern',
];

export function checkCoverLetterVoice(
  text: string,
  opp: { name: string },
  artistName: string,
  extraLocations: string[] = [],
): { ok: boolean; issues: string[] } {
  const issues: string[] = [];

  // Note 33-fix.6 — empty / too-short floor (see MIN_DRAFT_CHARS).
  if (text.trim().length < MIN_DRAFT_CHARS) {
    issues.push(
      `cover letter is empty or too short (${text.trim().length} chars; floor is ${MIN_DRAFT_CHARS}). Likely the model's adaptive-thinking phase consumed the budget and produced no prose. Write a complete 200-350 word cover letter now, opening with "Dear", first-person throughout, signed with the photographer's name.`,
    );
    return { ok: false, issues };
  }

  // 1. Salutation must include "Dear" and end with comma.
  const firstLine = (text.split(/\r?\n/, 1)[0] || '').trim();
  if (!/^dear\b/i.test(firstLine)) {
    issues.push('salutation must open with "Dear" — e.g. "Dear Selection Committee," or "Dear [Name],"');
  }

  // 2. First-person body — strip the signature line(s) before checking
  // surname leakage. Signature is the trailing block after the close.
  const lines = text.split(/\r?\n/);
  // Heuristic: only treat the trailing line(s) as a signature block if
  // they are SHORT (≤ 6 words). A signed name like "Jane Doe" is 2
  // words; "Yours sincerely, Jane Doe" is 4 words. A truncated body
  // fragment ("the fellowship would underwrite the production phase of")
  // is many more words — we do NOT want to strip that as a "signature"
  // because then the terminal-punctuation check below would falsely pass.
  let bodyEnd = lines.length;
  let stripped = 0;
  for (let i = lines.length - 1; i >= 0 && stripped < 2; i--) {
    const trimmed = lines[i].trim();
    if (trimmed.length === 0) continue;
    const wordCount = trimmed.split(/\s+/).filter((w) => w.length > 0).length;
    if (wordCount > 6) break; // not a signature — stop stripping
    bodyEnd = i;
    stripped++;
  }
  const body = lines.slice(0, bodyEnd).join('\n').trim();

  const surname = (artistName.trim().split(/\s+/).pop() || '').trim();
  if (surname.length > 1) {
    const surnameRe = new RegExp(`\\b${surname}\\b\\s+(submits|is|was|has|photographs|shoots|works|writes|presents|exhibits|appears|continues|received|received\\b)`, 'i');
    if (surnameRe.test(body)) {
      issues.push(`third-person voice detected — body contains "${surname} [verb]". Cover letter must be first-person ("I submit", "I am", "I was"); the surname appears only in the signature line.`);
    }
  }

  // 3. No banned phrases (inherited + cover-letter-specific).
  const lower = text.toLowerCase();
  for (const phrase of COVER_LETTER_BANNED_PHRASES) {
    if (lower.includes(phrase)) issues.push(`banned phrase: "${phrase}"`);
  }
  for (const word of STATEMENT_BANNED_WORDS) {
    const re = new RegExp(`\\b${word}\\b`, 'i');
    if (re.test(text)) issues.push(`banned word: "${word}" — use a concrete alternative`);
  }

  // 4. Em-dash check.
  if (text.includes('—')) {
    const count = (text.match(/—/g) || []).length;
    issues.push(`${count} em-dash(es) found. Hard rule: zero em-dashes.`);
  }

  // 5. Lineage paragraph check (same regex as proposal).
  for (const para of text.split(/\n\s*\n/)) {
    if (LINEAGE_NAME_PARAGRAPH.test(para)) {
      issues.push('lineage paragraph detected — three or more named photographers in one paragraph; lineage belongs in the artist statement, not the cover letter');
      break;
    }
  }

  // 6. Opportunity name must appear at least once (specificity check).
  // Use a relaxed match — strip parentheticals and abbreviation suffixes.
  const oppCore = opp.name.replace(/\s*\(.*?\)\s*/g, '').trim();
  if (oppCore.length > 3 && !text.toLowerCase().includes(oppCore.toLowerCase())) {
    issues.push(`opportunity name "${oppCore}" does not appear anywhere in the letter — cover letter must specifically reference THIS opportunity by name`);
  }

  // 7. Length 200-350 words (body, signature included is fine — close enough).
  const wordCount = text.split(/\s+/).filter((w) => w.length > 0).length;
  if (wordCount < 180 || wordCount > 380) {
    issues.push(`word count is ${wordCount}; target is 200-350 words.`);
  }

  // 8. WALKTHROUGH Note 26: terminal-punctuation check on the BODY only —
  // the signature line (the photographer's typed name) legitimately has no terminal
  // punctuation. We reuse the same body-vs-signature split as the
  // surname check above: the body is everything before the trailing
  // 2-line signature block.
  if (body.length > 0 && !/[.!?"'\)\]]\s*$/.test(body)) {
    issues.push('cover letter body does not end with terminal punctuation before the signature — likely truncated mid-sentence; check max_tokens budget');
  }

  // WALKTHROUGH Note 32 + 33: per-sentence canonical-reel caps run on body,
  // not signature. AKB-derived per-photographer locations merged into the
  // universal photo-destination canon.
  issues.push(...checkCanonicalReelCaps(body, extraLocations));

  return { ok: issues.length === 0, issues };
}

async function draftCoverLetterWithVoiceCheck(ctx: DraftCtx): Promise<string> {
  const first = await draftMaterial('cover_letter', ctx);
  const voice = checkCoverLetterVoice(
    first,
    { name: ctx.opp.name },
    ctx.akb.identity.artist_name || '',
    extractAkbLocations(ctx.akb),
  );
  // WALKTHROUGH Note 24: bundle fact-grounding issues with voice issues.
  const facts = checkFactGrounding(first, JSON.stringify(ctx.akb));
  const allIssues = [...voice.issues, ...facts.issues];
  if (allIssues.length === 0) return first;

  const { system } = PROMPTS.cover_letter(ctx);
  const client = getAnthropic();
  const resp = await withAnthropicRetry(
    () =>
      client.messages.create({
        model: MODEL_OPUS,
        max_tokens: MAX_TOKENS_BY_TYPE.cover_letter,
        thinking: { type: 'adaptive' },
        system,
        messages: [
          { role: 'user', content: PROMPTS.cover_letter(ctx).user },
          { role: 'assistant', content: first },
          {
            role: 'user',
            content: `Your draft violated the hard cover-letter constraints. Specific issues:\n${allIssues.map((i) => `- ${i}`).join('\n')}\n\nRewrite the cover letter now. Same opportunity, same artist, but fix every issue listed above. Open with "Dear", body in first person throughout, name the opportunity by name with a specific reason for THIS cycle, sign with the artist's name only. Return plain text only. Do not invent venues, dates, partnerships, or commitments — every specific factual claim must be in the AKB.`,
          },
        ],
      }),
    { label: `drafter-cover_letter-revise` },
  );
  const revised = resp.content.find((b) => b.type === 'text')?.text?.trim() ?? '';
  // Note 33-fix.6 — see draftStatementWithVoiceCheck for rationale.
  if (revised.length >= MIN_DRAFT_CHARS) return revised;
  if (first.length >= MIN_DRAFT_CHARS) return first;
  throw new Error(
    `cover_letter draft + revision both empty/too short (first=${first.length}, revised=${revised.length}). Likely adaptive-thinking-budget exhaustion; check max_tokens.`,
  );
}

/**
 * WALKTHROUGH Note 22-fix.3: generate ONE master CV per run. Called from the
 * orchestrator after AKB is finalized. Produces canonical sections in
 * canonical order per Note 22-fix.2, ALWAYS includes CURATORIAL AND
 * ORGANIZATIONAL when AKB has the field non-empty (Note 22-fix.1 — never
 * trim curatorial credentials by opportunity type).
 *
 * Pure single-call function — no per-opp variation, no skill-loader chain.
 * Returns the rendered CV plain-text.
 */
const MASTER_CV_SYSTEM = `You are formatting a single canonical CV for a working visual artist. This CV is used as-is across every application — there is no per-opportunity variation. Pull entries ONLY from the AKB; never invent.

Use these section labels EXACTLY, in this order. Skip a section heading ONLY if its AKB field is empty.

NAME (top, large)
b. YEAR | Lives and works in CITY, STATE, COUNTRY [single-line bio]

EDUCATION
SOLO EXHIBITIONS
GROUP EXHIBITIONS (selected)
PUBLICATIONS (selected)
AWARDS AND HONORS
COLLECTIONS
REPRESENTATION
CURATORIAL AND ORGANIZATIONAL

CURATORIAL AND ORGANIZATIONAL is required whenever akb.curatorial_and_organizational has at least one entry. Curatorial credentials strengthen ANY application — do not trim them.

Inside each entry use em-dash for the primary field separator (year — title, venue, city) and comma for sub-attributes within a row. This is CV convention; the prose zero-em-dash rule does not apply here.

Return plain text only. No preamble, no markdown, no commentary.`;

export async function generateMasterCv(
  akb: ArtistKnowledgeBase,
  fingerprint: StyleFingerprint,
): Promise<string> {
  const cvSkill = await readSkill('cv-format-by-institution.md', DEFAULT_CV_SKILL);
  const client = getAnthropic();
  const userText = `ARTIST_AKB:
${JSON.stringify(akb, null, 2)}

FINGERPRINT (for reference only — CV is factual, fingerprint does NOT introduce visual claims here):
${JSON.stringify({ career_positioning_read: fingerprint.career_positioning_read }, null, 2)}

Format the master CV now. Use the canonical section list and order. Always include CURATORIAL AND ORGANIZATIONAL if the AKB has that field with at least one entry.`;
  const resp = await withAnthropicRetry(
    () =>
      client.messages.create({
        model: MODEL_OPUS,
        max_tokens: 4000,
        thinking: { type: 'adaptive' },
        system: cvSkill + '\n\n---\n\n' + MASTER_CV_SYSTEM + '\n\n---\n\n' + AKB_FACTS_ONLY_CONSTRAINT,
        messages: [{ role: 'user', content: userText }],
      }),
    { label: 'drafter.master_cv' },
  );
  return (resp.content.find((b) => b.type === 'text')?.text ?? '').trim();
}

/**
 * WALKTHROUGH Note 22-fix.3: deterministic per-opp trim NOTE (not a CV).
 * Repurposes the drafted_packages.cv_formatted column. Returns null when
 * the opportunity has no stated CV cap; otherwise returns a 1-sentence
 * note describing what to trim. No LLM call — pure regex on the Drafter's
 * already-fetched oppRequirementsText.
 */
const CV_CAP_PATTERNS: Array<{ re: RegExp; render: (m: RegExpMatchArray, oppName: string) => string }> = [
  {
    re: /single[- ]page\s+(pdf|cv|resume)/i,
    render: (_m, oppName) =>
      `For ${oppName}: single-page PDF cap. Trim pre-2018 entries and any non-load-bearing items so the CV fits one page.`,
  },
  {
    re: /one[- ]page\s+(pdf|cv|resume)/i,
    render: (_m, oppName) =>
      `For ${oppName}: one-page PDF cap. Trim pre-2018 entries and any non-load-bearing items so the CV fits one page.`,
  },
  {
    // Allow comma as thousands separator ("2,000 character") and require a
    // word boundary before the digit so "v2.000" or "tag-000" don't trigger.
    re: /\b(\d{1,3}(?:,\d{3})+|\d{2,5})[- ]?character[s]?\s+(limit|max|cap)/i,
    render: (m, oppName) =>
      `For ${oppName}: ${m[1]}-character cap on the CV/resume field. Abbreviate venue names and drop the oldest entries first.`,
  },
  {
    re: /\b(\d{1,3}(?:,\d{3})+|\d{1,4})[- ]?word[s]?\s+(limit|max|cap|maximum)/i,
    render: (m, oppName) =>
      `For ${oppName}: ${m[1]}-word cap on the CV/resume field. Abbreviate venue names and drop the oldest entries first.`,
  },
  {
    re: /\b(2|3|4|5)\s*pages?\s+(max|maximum|cap)/i,
    render: (m, oppName) =>
      `For ${oppName}: ${m[1]}-page CV maximum. Keep current section order; drop the oldest entries that exceed the page count.`,
  },
];

export function computeTrimNote(oppName: string, oppRequirementsText: string): string | null {
  if (!oppRequirementsText || oppRequirementsText.length === 0) return null;
  for (const { re, render } of CV_CAP_PATTERNS) {
    const m = oppRequirementsText.match(re);
    if (m) return render(m, oppName);
  }
  return null;
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

WALKTHROUGH Note 25 — NO LINEAGE NAME-DROPS in rationales. A per-image rationale is a brief observational note about THIS image's specific qualities and how those qualities map to the cohort's aesthetic signature — not a curator-essay sentence about lineage. Banned: any rationale that names a photographer (Adams, Lik, Rowell, Shore, Eggleston, Sugimoto, Frye, Butcher, Luong, Plant, Wall, Ratcliff, Dobrowner, Burtynsky, Crewdson, Weston, Porter, Misrach, etc.) as evidence the image fits. Describe the image's PROPERTIES (palette, crop, subject, composition, condition) and how they match the cohort, not a tradition or photographer.

WALKTHROUGH Note 24 — DO NOT INVENT FACTS. Do not claim the image was published in, shown at, awarded by, or acquired by any institution unless that fact is supplied to you. Stick to observable visual properties + Rubric-cited fit. If you cannot honestly justify an image, use the "alternate from the same body" fallback above.

OUTPUT STRICTLY JSON in this shape, no markdown fence, no preamble:
{ "rationales": [ { "image_id": 1, "rationale": "..." }, { "image_id": 6, "rationale": "..." } ] }
Include EVERY image_id from the input. Order does not matter.`;

// WALKTHROUGH Note 25: post-write check. Capitalized photographer surnames
// inside a per-image rationale are a violation. Single \b word-bounded
// match per surname; case-sensitive (lowercase common nouns like "wall"
// or "porter" don't trigger). Returns the surnames found so the caller
// can decide retry vs drop.
const PHOTOGRAPHER_SURNAMES = [
  'Adams', 'Lik', 'Rowell', 'Shore', 'Eggleston', 'Sugimoto', 'Frye',
  'Butcher', 'Luong', 'Plant', 'Wall', 'Ratcliff', 'Dobrowner',
  'Burtynsky', 'Crewdson', 'Weston', 'Porter', 'Misrach',
];

export function findRationaleLineageNameDrops(rationale: string): string[] {
  const hits: string[] = [];
  for (const name of PHOTOGRAPHER_SURNAMES) {
    const re = new RegExp(`\\b${name}\\b`);
    if (re.test(rationale)) hits.push(name);
  }
  return hits;
}

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
        if (typeof r?.image_id !== 'number') continue;
        if (typeof r?.rationale !== 'string' || r.rationale.trim().length === 0) continue;
        const cleaned = r.rationale.trim();
        // WALKTHROUGH Note 25: drop rationales containing photographer
        // surname name-drops. Caller keeps the existing placeholder string
        // for that image instead of writing a curator-essay rationale.
        if (findRationaleLineageNameDrops(cleaned).length > 0) continue;
        out.set(r.image_id, cleaned);
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

  const [voiceSkill, proposalSkill, examplesSkill, proposalExamplesSkill] = await Promise.all([
    readSkill('artist-statement-voice.md', DEFAULT_VOICE_SKILL),
    readSkill('project-proposal-structure.md', DEFAULT_PROPOSAL_SKILL),
    // WALKTHROUGH Note 20: real-statement few-shot reference. Falls back to a
    // brief inline note if the file is missing — but it should always be
    // present (committed).
    readSkill(
      'artist-statement-real-examples.md',
      'Real artist statement examples not loaded — write in plain first-person voice, open with stake/question, zero em-dashes.',
    ),
    // WALKTHROUGH Note 21: real-proposal few-shot. Six type-specific
    // templates (state-fellowship, competition, residency, book-grant,
    // foundation-grant, commission) plus anti-examples. Always committed;
    // fallback note matches the same structure as Note 20.
    readSkill(
      'project-proposal-real-examples.md',
      'Real proposal examples not loaded — match the proposal type, no lineage paragraphs, zero em-dashes, end with complete sentences.',
    ),
  ]);

  const oppType = classifyOpportunityType(opp);
  const proposalType = classifyProposalType(opp);
  const ctx: DraftCtx = {
    akb,
    opp,
    fingerprint,
    voiceSkill,
    proposalSkill,
    examplesSkill,
    proposalExamplesSkill,
    oppType,
    proposalType,
    oppRequirementsText,
  };

  const artist_statement = await draftStatementWithVoiceCheck(ctx);
  const project_proposal = await draftProposalWithVoiceCheck(ctx);
  const cover_letter = await draftCoverLetterWithVoiceCheck(ctx);
  // WALKTHROUGH Note 22-fix.3: cv_formatted column repurposed as a per-opp
  // trim NOTE (not a CV). Deterministic regex on oppRequirementsText —
  // null when the opportunity has no stated CV cap. Master CV is generated
  // once per run by the orchestrator and persisted on dossiers.master_cv.
  const cv_formatted = computeTrimNote(opp.name, oppRequirementsText);

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

  // WALKTHROUGH Note 32 (32-fix.3): cross-dossier content-variation audit.
  // After all per-match drafts complete, load every successfully-drafted
  // statement / proposal / cover-letter as three same-material sets and
  // run pairwise Jaccard similarity. Log warnings for high pair similarity;
  // a warning here means the per-opp emphasis tables aren't differentiating
  // the body content enough across the dossier and the fix is to enrich
  // EMPHASIS_BY_OPP_TYPE / PROPOSAL_TAILORING / per-letter cues, not to
  // retry the drafts. Persist to run_events so the dossier review surface
  // can flag low-variation runs.
  const draftedRows = (
    await db.execute({
      sql: `SELECT artist_statement, project_proposal, cover_letter
            FROM drafted_packages dp
            JOIN run_matches rm ON rm.id = dp.run_match_id
            WHERE rm.run_id = ? AND rm.included = 1`,
      args: [runId],
    })
  ).rows as unknown as Array<{
    artist_statement: string | null;
    project_proposal: string | null;
    cover_letter: string | null;
  }>;
  const statements = draftedRows.map((r) => r.artist_statement ?? '').filter((t) => t.length > 50);
  const proposals = draftedRows.map((r) => r.project_proposal ?? '').filter((t) => t.length > 50);
  const coverLetters = draftedRows.map((r) => r.cover_letter ?? '').filter((t) => t.length > 50);
  const variationReports = {
    statements: checkContentVariation(statements),
    proposals: checkContentVariation(proposals),
    cover_letters: checkContentVariation(coverLetters),
  };
  for (const [material, report] of Object.entries(variationReports)) {
    if (!report.ok) {
      console.warn(
        `[package-drafter] Note 32 cross-dossier variation warning (${material}): avg=${report.averageSimilarity.toFixed(3)}, ${report.issues.length} issue(s)`,
      );
      for (const issue of report.issues) console.warn(`  - ${issue}`);
    } else {
      console.log(
        `[package-drafter] Note 32 cross-dossier variation OK (${material}): avg=${report.averageSimilarity.toFixed(3)} across ${
          material === 'statements' ? statements.length : material === 'proposals' ? proposals.length : coverLetters.length
        } drafts`,
      );
    }
  }
  if (Object.values(variationReports).some((r) => !r.ok)) {
    await db.execute({
      sql: `INSERT INTO run_events (run_id, agent, kind, payload_json) VALUES (?, 'package-drafter', 'dossier_content_repetition_warning', ?)`,
      args: [
        runId,
        JSON.stringify({
          statements: { avg: variationReports.statements.averageSimilarity, issues: variationReports.statements.issues },
          proposals: { avg: variationReports.proposals.averageSimilarity, issues: variationReports.proposals.issues },
          cover_letters: { avg: variationReports.cover_letters.averageSimilarity, issues: variationReports.cover_letters.issues },
        }),
      ],
    });
  }

  await db.execute({
    sql: `UPDATE runs SET status = 'complete', finished_at = unixepoch() WHERE id = ?`,
    args: [runId],
  });
}
