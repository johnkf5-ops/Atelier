import { createClient } from '@libsql/client';
import { readFileSync } from 'fs';
const env = readFileSync('.env.local', 'utf-8');
const parsed = Object.fromEntries(env.split('\n').filter(l => l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i+1).replace(/^"(.*)"$/, '$1')]; }));
const db = createClient({ url: parsed.TURSO_DATABASE_URL, authToken: parsed.TURSO_AUTH_TOKEN });
const r = (await db.execute({ sql: `SELECT COUNT(*) as n FROM run_events WHERE run_id = 2`, args: [] })).rows[0];
console.log(`total events in run 2: ${r.n}`);
const agents = (await db.execute({ sql: `SELECT DISTINCT agent FROM run_events WHERE run_id = 2`, args: [] })).rows;
console.log(`distinct agent values:`, agents.map(a => a.agent));
const userish = (await db.execute({ sql: `SELECT id, agent, kind FROM run_events WHERE run_id = 2 AND (agent = 'user' OR kind LIKE '%user%' OR payload_json LIKE '%"role":"user"%') LIMIT 5`, args: [] })).rows;
console.log(`\nuser-side events sample:`, userish);
// Check for image content in any payload
const imgs = (await db.execute({ sql: `SELECT id, agent, kind FROM run_events WHERE run_id = 2 AND payload_json LIKE '%"type":"image"%' LIMIT 5`, args: [] })).rows;
console.log(`\nevents with image content blocks (first 5):`, imgs);
