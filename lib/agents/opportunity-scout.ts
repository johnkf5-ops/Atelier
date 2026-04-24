import Anthropic from '@anthropic-ai/sdk';
import { getAnthropicKey } from '@/lib/auth/api-key';
import { getDb } from '@/lib/db/client';
import { OpportunityWithRecipientUrls } from '@/lib/schemas/opportunity';
import type { ArtistKnowledgeBase } from '@/lib/schemas/akb';
import type { StyleFingerprint } from '@/lib/schemas/style-fingerprint';
import type { RunConfig } from '@/lib/schemas/run';

export async function startScoutSession(
  runId: number,
  akb: ArtistKnowledgeBase,
  fingerprint: StyleFingerprint,
  config: RunConfig,
): Promise<string> {
  const client = new Anthropic({ apiKey: getAnthropicKey() });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const session = await (client.beta as any).sessions.create({
    agent: process.env.SCOUT_AGENT_ID!,
    environment_id: process.env.ATELIER_ENV_ID!,
    title: `Scout run ${runId}`,
  });

  const db = getDb();
  await db.execute({
    sql: `INSERT INTO run_event_cursors (run_id, managed_session_id, phase, last_event_id)
          VALUES (?, ?, 'scout', NULL)
          ON CONFLICT(run_id) DO UPDATE SET
            managed_session_id = excluded.managed_session_id,
            phase = 'scout',
            last_event_id = NULL,
            updated_at = unixepoch()`,
    args: [runId, session.id],
  });
  await db.execute({ sql: `UPDATE runs SET status = 'scout_running' WHERE id = ?`, args: [runId] });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (client.beta as any).sessions.events.send(session.id, {
    events: [
      {
        type: 'user.message',
        content: [{ type: 'text', text: buildScoutPrompt(akb, fingerprint, config) }],
      },
    ],
  });

  return session.id;
}

export function buildScoutPrompt(
  akb: ArtistKnowledgeBase,
  fingerprint: StyleFingerprint,
  config: RunConfig,
): string {
  return `Find institutional opportunities for this artist whose deadlines fall in the configured window.

ARTIST_AKB (career stage, geography, eligibility):
${JSON.stringify(akb, null, 2)}

STYLE_FINGERPRINT (what this artist's work actually looks like and where it belongs):
${JSON.stringify(fingerprint, null, 2)}

RUN_CONFIG:
- window: ${config.window_start} to ${config.window_end}
- budget_usd: ${config.budget_usd} (0 = no fee cap)
- max_travel_miles: ${config.max_travel_miles ?? 'unlimited'}

STEP 0 — ARCHETYPE INFERENCE (do this BEFORE any web_search):
Read the AKB + StyleFingerprint and synthesize a private list of 5–8 opportunity archetypes that genuinely fit this specific artist. An archetype is a category of funding/selection institution (e.g., "state arts council", "nature photography competition", "museum acquisition prize", "public art commission", "book publisher open submission", "conservation-themed editorial grant"). DO NOT use a fixed taxonomy — reason from the artist's:

- primary_medium and materials_and_methods
- aesthetic register (fingerprint.palette, composition_tendencies, formal_lineage, museum_acquisition_signals — pay attention to whether this work reads as fine-art-museum, commercial-gallery, editorial-photojournalism, conservation-advocacy, etc.)
- career_positioning_read (where does this artist currently sit? where could they credibly apply?)
- home_base (state and region — there is ALWAYS a home-state arts council and regional arts federation)
- career_stage and awards_and_honors (don't send an early-career artist to flagship-only; don't send an established one to first-book awards)

Honesty matters: include one or two aspirational elite residencies ONLY if the fingerprint's museum_acquisition_signals or formal_lineage credibly support them. If the work is commercial-gallery-register landscape spectacle, a Yaddo fellowship is a distraction — state the archetype is "aspirational ceiling, likely wrong room" and EITHER skip it OR include exactly one so the Rubric can explicitly filter it out.

State your inferred archetype list in an agent.message (short, 1-2 sentences per archetype explaining WHY it fits THIS artist) BEFORE doing any web searches. This thinking is valuable to the downstream Rubric.

STEP 1 — DISCOVERY
For each inferred archetype, use web_search to find 2–4 candidate institutions/programs. Do NOT restrict yourself to the opportunity-sources.md skill file — use it as a prior, but web_search for state/regional/medium-specific sources that aren't in it. Home-state and regional councils are almost never in the seed list; find them via search.

STEP 2 — FETCH + STRUCTURE
For each candidate: web_fetch the listings page. Find open calls whose deadlines fall in the run_config window. For each open call: web_fetch the detail page, extract structured fields (name, deadline, award type/amount/prestige_tier, eligibility, entry_fee_usd).

STEP 3 — ELIGIBILITY FILTER
Apply hard eligibility filters from the AKB (citizenship, medium, career_stage). Drop opportunities the artist is plainly ineligible for. Note what you filtered and why.

STEP 4 — PAST RECIPIENTS
For each surviving opportunity: locate past recipients (last 3 years). For each recipient, locate their portfolio page (their personal site OR an institutional bio). Extract up to 5 representative portfolio image URLs per recipient (max 3 recipients per opportunity).

STEP 5 — EMIT
Emit one persist_opportunity custom tool call per opportunity. Pass the full structured Opportunity object PLUS a 'past_recipient_image_urls' array of objects: { recipient_name, year, image_urls: string[] }.

STEP 6 — COMPLETE
After all archetypes have been worked, emit a final agent.message with text: "<DONE>".

CALIBRATION of prestige_tier — use HONESTLY across the slate:
- flagship = Guggenheim, MacDowell, NEA, Creative Capital, Critical Mass final cut
- mid-tier = established regional/state programs with ≥10-year track record
- emerging = smaller competitions, first-book awards, local grants
- regional = home-state and nearby-state councils, city arts commissions
- open-call = unknown / TBD when uncertain

DO NOT download recipient images yourself — only collect URLs. The orchestrator handles downloading.

DO NOT use the write tool for binary content. If you need to briefly inspect an image during disambiguation, use bash + curl with a proper Referer header:
\`\`\`
curl -fsSL -e "https://example.com/" -A "Mozilla/5.0" -o /tmp/x.jpg "https://example.com/image.jpg"
\`\`\`
Then \`read /tmp/x.jpg\`.

If web_fetch fails on a source (404, anti-scraping, paywall), skip it and continue.

HARD CAPS for this run:
- 12–20 distinct opportunities total
- At least 4 distinct archetypes represented in the final slate — no single archetype may exceed 40% of the slate
- Stop adding new sources once you reach 20 opportunities`;
}

export async function persistOpportunityFromAgent(runId: number, rawInput: unknown): Promise<string> {
  const parsed = OpportunityWithRecipientUrls.safeParse(rawInput);
  if (!parsed.success) {
    return `validation failed: ${parsed.error.message}`;
  }
  const data = parsed.data;
  const db = getDb();

  const awardSummary = [
    data.award.type,
    data.award.amount_usd ? `$${data.award.amount_usd}` : data.award.in_kind ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  const oppRes = await db.execute({
    sql: `INSERT INTO opportunities (source, source_id, name, url, deadline, award_summary, eligibility_json, raw_json)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(source, source_id) DO UPDATE SET
            name = excluded.name,
            url = excluded.url,
            deadline = excluded.deadline,
            award_summary = excluded.award_summary,
            eligibility_json = excluded.eligibility_json,
            raw_json = excluded.raw_json,
            fetched_at = unixepoch()
          RETURNING id`,
    args: [
      data.source,
      data.source_id,
      data.name,
      data.url,
      data.deadline ?? null,
      awardSummary,
      JSON.stringify(data.eligibility),
      JSON.stringify(data),
    ],
  });
  const opportunityId = Number((oppRes.rows[0] as unknown as { id: number }).id);

  await db.execute({
    sql: `INSERT OR IGNORE INTO run_opportunities (run_id, opportunity_id) VALUES (?, ?)`,
    args: [runId, opportunityId],
  });

  // Filter LLM-incomplete recipient entries (Phase 2.12 lesson): only keep ones with a name + ≥1 url.
  const validRecipients = data.past_recipient_image_urls.filter(
    (rec) => rec.recipient_name && rec.recipient_name.length > 0 && rec.image_urls && rec.image_urls.length > 0,
  );

  for (const rec of validRecipients) {
    // ON CONFLICT: if existing row has Blob URLs (from a prior run), preserve them;
    // otherwise refresh with the latest raw URL list from Scout.
    await db.execute({
      sql: `INSERT INTO past_recipients (opportunity_id, year, name, portfolio_urls)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(opportunity_id, year, name) DO UPDATE SET
              portfolio_urls = CASE
                WHEN portfolio_urls LIKE '%blob.vercel-storage%' THEN portfolio_urls
                ELSE excluded.portfolio_urls
              END,
              fetched_at = unixepoch()`,
      args: [opportunityId, rec.year ?? null, rec.recipient_name, JSON.stringify(rec.image_urls)],
    });
  }

  return `persisted opportunity_id=${opportunityId} recipients=${validRecipients.length}`;
}
