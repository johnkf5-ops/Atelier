import { createClient } from '@libsql/client';
import { readFileSync } from 'fs';
const env = readFileSync('.env.local', 'utf-8');
const parsed = Object.fromEntries(env.split('\n').filter(l => l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i+1).replace(/^"(.*)"$/, '$1')]; }));
const db = createClient({ url: parsed.TURSO_DATABASE_URL, authToken: parsed.TURSO_AUTH_TOKEN });

async function count(t, where = '1=1') { return Number((await db.execute({ sql: `SELECT COUNT(*) as n FROM ${t} WHERE ${where}`, args: [] })).rows[0].n); }

console.log('Before wipe:');
console.log(`  runs: ${await count('runs')}`);
console.log(`  run_events: ${await count('run_events')}`);
console.log(`  run_opportunities: ${await count('run_opportunities')}`);
console.log(`  run_matches: ${await count('run_matches')}`);
console.log(`  drafted_packages: ${await count('drafted_packages')}`);
console.log(`  dossiers: ${await count('dossiers')}`);
console.log(`  opportunities: ${await count('opportunities')}`);
console.log(`  past_recipients: ${await count('past_recipients')}`);

const stmts = [
  `DELETE FROM dossiers WHERE run_id IN (1, 2)`,
  `DELETE FROM drafted_packages WHERE run_match_id IN (SELECT id FROM run_matches WHERE run_id IN (1, 2))`,
  `DELETE FROM run_matches WHERE run_id IN (1, 2)`,
  `DELETE FROM run_opportunities WHERE run_id IN (1, 2)`,
  `DELETE FROM run_events WHERE run_id IN (1, 2)`,
  `DELETE FROM run_event_cursors WHERE run_id IN (1, 2)`,
  `DELETE FROM runs WHERE id IN (1, 2)`,
  // Wipe global opportunity caches so Scout re-discovers from scratch with the new AKB
  `DELETE FROM past_recipients`,
  `DELETE FROM opportunity_logos`,
  `DELETE FROM opportunities`,
];
for (const s of stmts) {
  const r = await db.execute({ sql: s, args: [] });
  console.log(`  ✓ ${s.slice(0, 70)}... (${r.rowsAffected} rows)`);
}

console.log('\nAfter wipe:');
console.log(`  runs: ${await count('runs')}`);
console.log(`  run_events: ${await count('run_events')}`);
console.log(`  opportunities: ${await count('opportunities')}`);
console.log(`  past_recipients: ${await count('past_recipients')}`);

// Sanity: ensure user, portfolio, AKB, fingerprint are all intact
console.log('\nUser data preserved:');
console.log(`  portfolio_images: ${await count('portfolio_images')}`);
console.log(`  akb_versions: ${await count('akb_versions')}`);
console.log(`  style_fingerprints: ${await count('style_fingerprints')}`);
console.log(`  extractor_turns: ${await count('extractor_turns')}`);

console.log('\nClean slate. Trigger a fresh run via POST /api/runs/start.');
