import { createClient } from '@libsql/client';
import { readFileSync } from 'fs';
const env = readFileSync('.env.local', 'utf-8');
const parsed = Object.fromEntries(env.split('\n').filter(l => l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i+1).replace(/^"(.*)"$/, '$1')]; }));
const db = createClient({ url: parsed.TURSO_DATABASE_URL, authToken: parsed.TURSO_AUTH_TOKEN });

async function count(t) { return Number((await db.execute({ sql: `SELECT COUNT(*) as n FROM ${t}`, args: [] })).rows[0].n); }

console.log('Before wipe:');
for (const t of ['runs','run_events','run_opportunities','run_matches','drafted_packages','dossiers','opportunities','past_recipients','opportunity_logos']) {
  console.log(`  ${t}: ${await count(t)}`);
}

const stmts = [
  `DELETE FROM dossiers`,
  `DELETE FROM drafted_packages`,
  `DELETE FROM run_matches`,
  `DELETE FROM run_opportunities`,
  `DELETE FROM run_events`,
  `DELETE FROM run_event_cursors`,
  `DELETE FROM runs`,
  `DELETE FROM past_recipients`,
  `DELETE FROM opportunity_logos`,
  `DELETE FROM opportunities`,
];
for (const s of stmts) {
  const r = await db.execute({ sql: s, args: [] });
  console.log(`  ✓ ${s} (${r.rowsAffected} rows)`);
}

console.log('\nAfter wipe:');
for (const t of ['runs','opportunities','past_recipients']) {
  console.log(`  ${t}: ${await count(t)}`);
}
console.log('\nUser data preserved:');
for (const t of ['portfolio_images','akb_versions','style_fingerprints','extractor_turns']) {
  console.log(`  ${t}: ${await count(t)}`);
}
