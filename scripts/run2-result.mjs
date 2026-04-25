import { createClient } from '@libsql/client';
import { readFileSync } from 'fs';
const env = readFileSync('.env.local', 'utf-8');
const parsed = Object.fromEntries(env.split('\n').filter(l => l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i+1).replace(/^"(.*)"$/, '$1')]; }));
const db = createClient({ url: parsed.TURSO_DATABASE_URL, authToken: parsed.TURSO_AUTH_TOKEN });

const r = (await db.execute({ sql: `SELECT id, status, started_at, finished_at, error FROM runs ORDER BY id DESC LIMIT 3`, args: [] })).rows;
console.log('=== RUNS ===');
for (const x of r) {
  const dur = x.finished_at ? `${Number(x.finished_at) - Number(x.started_at)}s` : `${Math.floor(Date.now()/1000) - Number(x.started_at)}s ongoing`;
  console.log(`run ${x.id}: ${x.status} (${dur}) err=${(x.error ?? 'none').toString().slice(0, 200)}`);
}

const runId = 2;
const opps = (await db.execute({ sql: `SELECT COUNT(*) as n FROM run_opportunities WHERE run_id = ?`, args: [runId] })).rows[0].n;
const matches = (await db.execute({ sql: `SELECT rm.fit_score, rm.composite_score, rm.included, o.name FROM run_matches rm JOIN opportunities o ON o.id = rm.opportunity_id WHERE rm.run_id = ? ORDER BY rm.fit_score DESC`, args: [runId] })).rows;
const drafts = (await db.execute({ sql: `SELECT COUNT(*) as n FROM drafted_packages dp JOIN run_matches rm ON rm.id = dp.run_match_id WHERE rm.run_id = ?`, args: [runId] })).rows[0].n;

console.log(`\nrun ${runId}: ${opps} discovered, ${matches.length} scored, ${drafts} drafted`);
console.log('\n=== ALL MATCHES ===');
for (const m of matches) console.log(`  ${m.included ? '[IN ]' : '[OUT]'} fit=${m.fit_score} composite=${m.composite_score ?? 'null'}  ${m.name}`);
