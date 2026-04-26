/**
 * Probe Scout's Step-0 archetype inference under different opportunity-
 * type filter combinations. For each combination, sends ONLY the Step-0
 * prompt to Opus 4.7 and prints the inferred archetype list. No
 * web_search, no Managed Agents, ~5-10 seconds + ~$0.10 per probe.
 *
 * Confirms two things:
 *   (1) When a single type is selected, every emitted archetype is in
 *       that type's lane (e.g., competitions-only → no residencies).
 *   (2) When multiple types are combined, the slate balances across them.
 *
 * Usage: pnpm tsx --env-file=.env.local scripts/probe-scout-types.ts
 */
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@libsql/client';
import { readFileSync } from 'fs';
import { buildScoutPrompt } from '../lib/agents/opportunity-scout';
import type { ArtistKnowledgeBase } from '../lib/schemas/akb';
import type { StyleFingerprint } from '../lib/schemas/style-fingerprint';
import { OPPORTUNITY_TYPES, type OpportunityType, type RunConfig } from '../lib/schemas/run';

async function probe(
  client: Anthropic,
  akb: ArtistKnowledgeBase,
  fingerprint: StyleFingerprint,
  selected: OpportunityType[],
): Promise<void> {
  const config: RunConfig = {
    window_start: '2026-04-26',
    window_end: '2027-04-26',
    budget_usd: 0,
    max_travel_miles: null,
    target_opportunity_count: 12,
    opportunity_types: selected,
  };
  const fullPrompt = buildScoutPrompt(akb, fingerprint, config);
  const step0Only =
    fullPrompt.split('STEP 1 — DISCOVERY')[0] +
    `\n\nIMPORTANT: For this probe, STOP after Step 0. Do NOT run web_search, do NOT emit persist_opportunity calls. Return ONLY your inferred archetype list as a numbered list, with the WHY for each archetype on the next indented line. End with <DONE>.`;

  const resp = await client.messages.create({
    model: 'claude-opus-4-7',
    max_tokens: 8000,
    thinking: { type: 'adaptive' },
    messages: [{ role: 'user', content: step0Only }],
  });
  const text = (resp.content.find((b) => b.type === 'text') as { text?: string })?.text ?? '';

  console.log(`\n${'='.repeat(70)}`);
  console.log(`SELECTED: [${selected.join(', ')}]`);
  console.log('='.repeat(70));
  // Print just the headlines (strip multi-line WHY blocks for compactness).
  const lines = text.split('\n');
  for (const line of lines) {
    const m = line.match(/^\s*(\d+)[\.\)]\s+(.+)/);
    if (m) console.log(`  ${m[1]}. ${m[2]}`);
  }
}

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

  console.log('Probing each opportunity type alone, then combinations.\n');
  console.log('Each probe sends only the Step-0 archetype-inference instruction.');
  console.log('Cost per probe: ~$0.10. Total: ~$1.20.\n');

  // Single-type probes — one for each type.
  for (const t of OPPORTUNITY_TYPES) {
    await probe(client, akb, fingerprint, [t]);
  }

  // Combination probes.
  await probe(client, akb, fingerprint, ['competitions', 'photo_books']);
  await probe(client, akb, fingerprint, ['grants', 'residencies']);
  await probe(client, akb, fingerprint, ['competitions', 'grants', 'museum_acquisition']);

  console.log('\n\nDone. Audit each list above against the SELECTED types — every archetype headline should be in-lane for the selected types.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
