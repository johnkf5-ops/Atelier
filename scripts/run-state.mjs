import { createClient } from '@libsql/client';
import { readFileSync } from 'fs';
const env = readFileSync('.env.local', 'utf-8');
const parsed = Object.fromEntries(env.split('\n').filter(l => l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i+1).replace(/^"(.*)"$/, '$1')]; }));
const db = createClient({ url: parsed.TURSO_DATABASE_URL, authToken: parsed.TURSO_AUTH_TOKEN });

const r = (await db.execute({ sql: `SELECT id, status, started_at, finished_at, error FROM runs ORDER BY id DESC LIMIT 3`, args: [] })).rows;
console.log('=== RUNS ===');
for (const x of r) {
  const dur = x.finished_at ? `${Number(x.finished_at) - Number(x.started_at)}s` : `${Math.floor(Date.now()/1000) - Number(x.started_at)}s ongoing`;
  console.log(`run ${x.id}: ${x.status} (${dur}) err=${x.error ?? 'none'}`);
}

const runId = r[0].id;
const opps = (await db.execute({ sql: `SELECT COUNT(*) as n FROM run_opportunities WHERE run_id = ?`, args: [runId] })).rows[0].n;
const matches = (await db.execute({ sql: `SELECT COUNT(*) as n, SUM(CASE WHEN included = 1 THEN 1 ELSE 0 END) as included FROM run_matches WHERE run_id = ?`, args: [runId] })).rows[0];
const drafts = (await db.execute({ sql: `SELECT COUNT(*) as n FROM drafted_packages dp JOIN run_matches rm ON rm.id = dp.run_match_id WHERE rm.run_id = ?`, args: [runId] })).rows[0].n;
const recipsWithFiles = (await db.execute({ sql: `SELECT SUM(CASE WHEN file_ids IS NOT NULL AND file_ids != '[]' AND file_ids != '' THEN 1 ELSE 0 END) as n_with_files, COUNT(*) as total FROM past_recipients pr JOIN run_opportunities ro ON ro.opportunity_id = pr.opportunity_id WHERE ro.run_id = ?`, args: [runId] })).rows[0];
console.log(`\nrun ${runId}:`);
console.log(`  opps: ${opps}`);
console.log(`  matches: ${matches.n} (${matches.included ?? 0} included)`);
console.log(`  drafts: ${drafts}`);
console.log(`  recipients: ${recipsWithFiles.total} total, ${recipsWithFiles.n_with_files ?? 0} with file_ids`);

console.log('\n=== LAST 12 EVENTS ===');
const events = (await db.execute({ sql: `SELECT id, agent, kind, created_at FROM run_events WHERE run_id = ? ORDER BY id DESC LIMIT 12`, args: [runId] })).rows;
for (const ev of events.reverse()) console.log(`  ${new Date(Number(ev.created_at) * 1000).toISOString()} [${ev.agent}] ${ev.kind}`);
