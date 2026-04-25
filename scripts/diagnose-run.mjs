import { createClient } from '@libsql/client';
import { readFileSync } from 'fs';
const env = readFileSync('.env.local', 'utf-8');
const parsed = Object.fromEntries(env.split('\n').filter(l => l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i+1).replace(/^"(.*)"$/, '$1')]; }));
const db = createClient({ url: parsed.TURSO_DATABASE_URL, authToken: parsed.TURSO_AUTH_TOKEN });

const runs = (await db.execute({ sql: `SELECT id, status, started_at, finished_at, error FROM runs ORDER BY id DESC LIMIT 5`, args: [] })).rows;
console.log('=== RECENT RUNS ===');
for (const r of runs) console.log(`run ${r.id}: status=${r.status} started=${r.started_at} finished=${r.finished_at} err=${r.error ?? 'none'}`);

const latestRun = runs[0];
if (!latestRun) { console.log('No runs found.'); process.exit(0); }
const runId = latestRun.id;
console.log(`\n=== RUN ${runId} DETAIL ===`);

const opps = (await db.execute({ sql: `SELECT COUNT(*) as n FROM run_opportunities WHERE run_id = ?`, args: [runId] })).rows[0];
const matches = (await db.execute({ sql: `SELECT COUNT(*) as n FROM run_matches WHERE run_id = ?`, args: [runId] })).rows[0];
const drafts = (await db.execute({ sql: `SELECT COUNT(*) as n FROM drafted_packages dp JOIN run_matches rm ON rm.id = dp.run_match_id WHERE rm.run_id = ?`, args: [runId] })).rows[0];
console.log(`opportunities discovered: ${opps.n}`);
console.log(`matches scored: ${matches.n}`);
console.log(`packages drafted: ${drafts.n}`);

console.log(`\n=== EVENT TIMELINE (last 50) ===`);
const events = (await db.execute({ sql: `SELECT agent, kind, created_at FROM run_events WHERE run_id = ? ORDER BY id DESC LIMIT 50`, args: [runId] })).rows;
for (const ev of events.reverse()) console.log(`  ${new Date(Number(ev.created_at) * 1000).toISOString()} [${ev.agent}] ${ev.kind}`);

console.log(`\n=== EVENT (agent, kind) COUNTS ===`);
const types = (await db.execute({ sql: `SELECT agent, kind, COUNT(*) as n FROM run_events WHERE run_id = ? GROUP BY agent, kind ORDER BY n DESC`, args: [runId] })).rows;
for (const t of types) console.log(`  ${t.n}× [${t.agent}] ${t.kind}`);
