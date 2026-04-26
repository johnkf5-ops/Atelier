/**
 * Lightweight probe of the Scout's Step-0 archetype inference using the
 * NEW lane-discipline prompt. Pulls John's real AKB + StyleFingerprint
 * from the DB, sends ONLY the Step-0 instruction to Opus, prints the
 * archetype list. Zero web_search, zero Managed Agents, ~5 seconds, ~$0.10.
 *
 * What we're checking: does every emitted archetype contain a photography
 * keyword (photo / photographic / photography / a known photo-prize name)?
 * If yes, the lane discipline is holding. If no, the prompt still drifts.
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

  // Pull the latest AKB + StyleFingerprint (run 3's basis)
  const akbRow = (
    await db.execute(`SELECT json FROM akb_versions ORDER BY id DESC LIMIT 1`)
  ).rows[0] as unknown as { json: string };
  const fpRow = (
    await db.execute(`SELECT json FROM style_fingerprints ORDER BY id DESC LIMIT 1`)
  ).rows[0] as unknown as { json: string };
  const akb: ArtistKnowledgeBase = JSON.parse(akbRow.json);
  const fingerprint: StyleFingerprint = JSON.parse(fpRow.json);

  // Build the full Scout prompt then trim to just the lane-discipline +
  // Step-0 sections. We don't want the agent to actually execute the web
  // search workflow — we want its archetype list.
  const fullPrompt = buildScoutPrompt(akb, fingerprint, {
    window_start: '2026-04-26',
    window_end: '2027-04-26',
    budget_usd: 0,
    max_travel_miles: 0,
    target_opportunity_count: 12,
  } as RunConfig);

  // Cut at "STEP 1 — DISCOVERY" so Opus only does archetype inference.
  const step0Only =
    fullPrompt.split('STEP 1 — DISCOVERY')[0] +
    `\n\nIMPORTANT: For this probe, STOP after Step 0. Do NOT run web_search, do NOT emit persist_opportunity calls. Return ONLY your inferred archetype list as a numbered list, with the WHY for each archetype on the next indented line. End with a single line: <DONE>.`;

  console.log(`Calling Opus 4.7 with new lane-discipline prompt (Step 0 only)...\n`);
  const resp = await client.messages.create({
    model: 'claude-opus-4-7',
    max_tokens: 8000,
    thinking: { type: 'adaptive' },
    messages: [{ role: 'user', content: step0Only }],
  });

  const text = (resp.content.find((b) => b.type === 'text') as { text?: string })?.text ?? '';
  console.log('=== ARCHETYPE LIST ===\n');
  console.log(text);

  // Audit: does each numbered archetype contain a photography keyword?
  console.log('\n\n=== LANE-DISCIPLINE AUDIT ===');
  const photoKeywords = /\b(photo|photographic|photography|photographer|POTY|ILPOTY|NLPA|FAPA|IPA|NDA|NANPA|Aperture|Lucie|Hariban|MACK|Magnum|en\s+foco|siskind|critical mass|fotofest|filter photo|photolucida|epson pano|hamdan|tpoty|opoty|wnpa|wnpoty|big ?picture|wildlife)\b/i;
  const lines = text.split('\n');
  let archetypeCount = 0;
  let inLanePhoto = 0;
  let outOfLane: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*(\d+)[\.\)]\s+(.+)/);
    if (!m) continue;
    archetypeCount++;
    const headline = m[2];
    const nextLines = lines.slice(i + 1, i + 4).join(' ');
    const blob = headline + ' ' + nextLines;
    if (photoKeywords.test(blob)) {
      inLanePhoto++;
    } else {
      outOfLane.push(`${m[1]}. ${headline}`);
    }
  }
  console.log(`archetypes detected: ${archetypeCount}`);
  console.log(`in-lane (photography): ${inLanePhoto} / ${archetypeCount}`);
  if (outOfLane.length > 0) {
    console.log(`OUT OF LANE:`);
    for (const o of outOfLane) console.log(`  ${o}`);
  } else {
    console.log(`100% in lane ✓`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
