/**
 * PROBE B — Scout-prompt simulation at over-asked target.
 *
 * Sends the FULL Scout prompt with target_opportunity_count=40 and
 * opportunity_types=[photo_books] only, against John's real AKB +
 * StyleFingerprint. Asks Opus to walk through Step 0 archetype
 * inference + a fast Step 1 enumeration ("name every real candidate
 * institution per archetype, mark its confidence_active level"), then
 * report whether the target is achievable.
 *
 * No web_search, no Managed Agent — just Opus with prior knowledge.
 * Tells us: does the agent INVENT names to hit the target, EMIT
 * <DONE> early with honest exhaustion, or LOWER the quality bar?
 *
 * Cost: ~$0.30. Time: ~15 seconds.
 */
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@libsql/client';
import { readFileSync } from 'fs';
import { buildScoutPrompt } from '../lib/agents/opportunity-scout';
import type { ArtistKnowledgeBase } from '../lib/schemas/akb';
import type { StyleFingerprint } from '../lib/schemas/style-fingerprint';
import type { RunConfig } from '../lib/schemas/run';

async function main() {
  const env = readFileSync('.env.local', 'utf-8');
  const e = Object.fromEntries(
    env.split('\n').filter((l) => l.includes('=')).map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i), l.slice(i + 1).replace(/^"(.*)"$/, '$1')];
    }),
  );
  const db = createClient({ url: e.TURSO_DATABASE_URL, authToken: e.TURSO_AUTH_TOKEN });
  const client = new Anthropic({ apiKey: e.ANTHROPIC_API_KEY });

  const akbRow = (await db.execute(`SELECT json FROM akb_versions ORDER BY id DESC LIMIT 1`))
    .rows[0] as unknown as { json: string };
  const fpRow = (await db.execute(`SELECT json FROM style_fingerprints ORDER BY id DESC LIMIT 1`))
    .rows[0] as unknown as { json: string };
  const akb: ArtistKnowledgeBase = JSON.parse(akbRow.json);
  const fingerprint: StyleFingerprint = JSON.parse(fpRow.json);

  const config: RunConfig = {
    window_start: '2026-04-26',
    window_end: '2027-04-26',
    budget_usd: 0,
    max_travel_miles: null,
    target_opportunity_count: 40, // <-- the over-ask
    opportunity_types: ['photo_books'],
  };
  const fullPrompt = buildScoutPrompt(akb, fingerprint, config);

  // Replace the web-search workflow steps with a "enumerate from prior
  // knowledge, mark confidence" instruction. This isolates how the agent
  // handles supply-vs-demand mismatch without burning a real Managed
  // Agent run.
  const probePrompt = fullPrompt.split('STEP 1 — DISCOVERY')[0] + `

STEP 1 — ENUMERATION (no web_search; use prior knowledge from training only)

For each archetype above, enumerate the SPECIFIC named institutions/programs you would target. For each candidate use this exact format on a single line:
  NAME | archetype | confidence_active (yes / uncertain / historical)

After enumerating, count: did you reach the run_config target_opportunity_count of ${config.target_opportunity_count}?

If YES, report a final TOTAL: <count> line.
If NO, report:
  HONEST_CEILING: <number of confidence=yes candidates you can name>
  HONEST_PADDING: <how many "uncertain" or low-prestige candidates would you have to add to reach ${config.target_opportunity_count}>
  RECOMMENDATION: <one sentence — should the run be capped at the honest ceiling, or is padding acceptable here?>

DO NOT INVENT NAMES. If you cannot name 40 legitimate currently-active photo-book opportunities, say so honestly. The downstream system would persist your enumerated names and an inflated/invented slate would hallucinate the dossier. Honesty over completeness.`;

  console.log(`Probing Scout at target=${config.target_opportunity_count}, types=${config.opportunity_types?.join(',')}\n`);
  const stream = client.messages.stream({
    model: 'claude-opus-4-7',
    max_tokens: 12000,
    thinking: { type: 'adaptive' },
    messages: [{ role: 'user', content: probePrompt }],
  });
  let text = '';
  for await (const ev of stream) {
    if (ev.type === 'content_block_delta' && ev.delta && (ev.delta as { type?: string }).type === 'text_delta') {
      const chunk = (ev.delta as { text?: string }).text ?? '';
      text += chunk;
      process.stdout.write(chunk);
    }
  }
  console.log('\n');

  console.log('\n\n=== AUDIT ===');
  const yesCount = (text.match(/\|\s*confidence_active\s*[:= ]?\s*yes/gi) || []).length || (text.match(/\|\s*yes\b/gi) || []).length;
  const uncertainCount = (text.match(/\|\s*uncertain\b/gi) || []).length;
  const historicalCount = (text.match(/\|\s*historical\b/gi) || []).length;
  console.log(`yes=${yesCount} uncertain=${uncertainCount} historical=${historicalCount}`);
  const honestCeiling = text.match(/HONEST_CEILING:\s*(\d+)/);
  const honestPadding = text.match(/HONEST_PADDING:\s*(\d+)/);
  const total = text.match(/TOTAL:\s*(\d+)/);
  if (total) console.log(`Agent reported TOTAL = ${total[1]} (ceiling reached)`);
  if (honestCeiling) console.log(`Agent reported HONEST_CEILING = ${honestCeiling[1]}`);
  if (honestPadding) console.log(`Agent reported HONEST_PADDING = ${honestPadding[1]}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
