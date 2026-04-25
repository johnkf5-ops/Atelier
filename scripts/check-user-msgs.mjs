import { createClient } from '@libsql/client';
import { readFileSync } from 'fs';
const env = readFileSync('.env.local', 'utf-8');
const parsed = Object.fromEntries(env.split('\n').filter(l => l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i+1).replace(/^"(.*)"$/, '$1')]; }));
const db = createClient({ url: parsed.TURSO_DATABASE_URL, authToken: parsed.TURSO_AUTH_TOKEN });
// Look at all distinct (agent, kind) combinations in run 2
const kinds = (await db.execute({ sql: `SELECT agent, kind, COUNT(*) as n FROM run_events WHERE run_id = 2 GROUP BY agent, kind ORDER BY n DESC`, args: [] })).rows;
console.log('Event types in run 2:');
for (const k of kinds) console.log(`  ${k.n}× [${k.agent}/${k.kind}]`);
// Specifically look for user message events
const userMsgs = (await db.execute({ sql: `SELECT id, agent, kind, payload_json FROM run_events WHERE run_id = 2 AND agent = 'user' ORDER BY id LIMIT 5`, args: [] })).rows;
console.log(`\nFirst 5 user-side events:`);
for (const ev of userMsgs) {
  const p = JSON.parse(ev.payload_json);
  const types = (p.content ?? []).map(c => c.type).join(',');
  console.log(`  id=${ev.id} [${ev.kind}] content-types=[${types}]`);
}
