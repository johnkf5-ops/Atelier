import Anthropic from '@anthropic-ai/sdk';
import { getAnthropicKey } from '@/lib/auth/api-key';
import { getDb } from '@/lib/db/client';
import { OpportunityWithRecipientUrls } from '@/lib/schemas/opportunity';
import type { ArtistKnowledgeBase } from '@/lib/schemas/akb';
import type { RunConfig } from '@/lib/schemas/run';

export async function startScoutSession(
  runId: number,
  akb: ArtistKnowledgeBase,
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
        content: [{ type: 'text', text: buildScoutPrompt(akb, config) }],
      },
    ],
  });

  return session.id;
}

export function buildScoutPrompt(akb: ArtistKnowledgeBase, config: RunConfig): string {
  return `Find institutional opportunities for this artist whose deadlines fall in the configured window.

ARTIST_AKB:
${JSON.stringify(akb, null, 2)}

RUN_CONFIG:
- window: ${config.window_start} to ${config.window_end}
- budget_usd: ${config.budget_usd} (0 = no fee cap)
- max_travel_miles: ${config.max_travel_miles ?? 'unlimited'}

YOUR TASK:
1. Traverse every source listed in your loaded skill file (opportunity-sources.md). Use web_fetch on each source's listings page.
2. For each open call in the window: web_fetch the call's detail page, extract structured fields (name, deadline, award type/amount/prestige_tier, eligibility, entry_fee_usd).
3. Apply hard eligibility filters from the AKB (citizenship, medium, career_stage). Drop opportunities the artist is plainly ineligible for.
4. For each surviving opportunity: visit the source's past_recipients_url. Identify the last 3 years of recipients. For each recipient, locate their portfolio page (their personal site OR an institutional bio page). Extract up to 5 representative portfolio image URLs per recipient (max 3 recipients per opportunity).
5. Emit one persist_opportunity custom tool call per opportunity. Pass the full structured Opportunity object PLUS a 'past_recipient_image_urls' array of objects: { recipient_name, year, image_urls: string[] }.
6. After all sources are processed, emit a final agent.message with text: "<DONE>".

DO NOT download recipient images yourself — only collect URLs. The orchestrator handles downloading.

DO NOT use the write tool for binary content. If you need to inspect any image briefly during disambiguation, use bash + curl with a proper Referer header to defeat hotlink protection:
\`\`\`
curl -fsSL -e "https://example.com/" -A "Mozilla/5.0" -o /tmp/x.jpg "https://example.com/image.jpg"
\`\`\`
Then \`read /tmp/x.jpg\`.

If web_fetch fails on a source (404, anti-scraping, paywall), skip it and continue. Note skipped sources at the end.

To respect time and cost budgets for this run: cap yourself at 15 distinct opportunities total, and stop adding new sources once you reach that count. Prioritize flagship-tier sources first (grants.gov/NEA, Guggenheim Fellowship, MacDowell, Creative Capital, Critical Mass).`;
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
      args: [opportunityId, rec.year, rec.recipient_name, JSON.stringify(rec.image_urls)],
    });
  }

  return `persisted opportunity_id=${opportunityId} recipients=${validRecipients.length}`;
}
