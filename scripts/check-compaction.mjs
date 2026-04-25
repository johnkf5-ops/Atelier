import { createClient } from '@libsql/client';
import { readFileSync } from 'fs';
const env = readFileSync('.env.local', 'utf-8');
const parsed = Object.fromEntries(env.split('\n').filter(l => l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i+1).replace(/^"(.*)"$/, '$1')]; }));
const db = createClient({ url: parsed.TURSO_DATABASE_URL, authToken: parsed.TURSO_AUTH_TOKEN });
const r = (await db.execute({ sql: `SELECT COUNT(*) as n FROM run_events WHERE run_id = 2 AND payload_json LIKE '%thread_context_compacted%'`, args: [] })).rows[0];
console.log(`agent.thread_context_compacted events in run 2: ${r.n}`);
const samples = (await db.execute({ sql: `SELECT id, payload_json FROM run_events WHERE run_id = 2 AND payload_json LIKE '%compact%' LIMIT 3`, args: [] })).rows;
for (const s of samples) console.log(`id=${s.id}: ${s.payload_json.slice(0, 200)}`);
