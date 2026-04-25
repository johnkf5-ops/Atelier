import { createClient } from '@libsql/client';
import { readFileSync } from 'fs';
const env = readFileSync('.env.local', 'utf-8');
const parsed = Object.fromEntries(env.split('\n').filter(l => l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i+1).replace(/^"(.*)"$/, '$1')]; }));
const db = createClient({ url: parsed.TURSO_DATABASE_URL, authToken: parsed.TURSO_AUTH_TOKEN });

const r = (await db.execute({ sql: `SELECT status FROM runs WHERE id = 2`, args: [] })).rows[0];
const m = (await db.execute({ sql: `SELECT COUNT(*) as n, SUM(CASE WHEN included=1 THEN 1 ELSE 0 END) as inc FROM run_matches WHERE run_id = 2`, args: [] })).rows[0];
const max = (await db.execute({ sql: `SELECT MAX(id) as m FROM run_events WHERE run_id = 2`, args: [] })).rows[0].m;

console.log(`Status: ${r.status} | matches: ${m.n} scored, ${m.inc ?? 0} included | max event id: ${max}`);

// Check for any read-tool calls (should be ZERO with Note 29)
const reads = (await db.execute({ sql: `SELECT COUNT(*) as n FROM run_events WHERE run_id = 2 AND id > 1016 AND kind = 'tool_use' AND payload_json LIKE '%"name":"read"%'`, args: [] })).rows[0].n;
console.log(`read-tool calls since Note 29 deploy: ${reads} (should be 0)`);

// Get the latest persist_match payloads to see reasoning quality
const persists = (await db.execute({ sql: `SELECT id, payload_json FROM run_events WHERE run_id = 2 AND id > 1016 AND kind = 'custom_tool_use' ORDER BY id DESC LIMIT 3`, args: [] })).rows;
console.log(`\n${persists.length} most-recent persist_match calls:`);
for (const ev of persists) {
  const p = JSON.parse(ev.payload_json);
  if (p.name !== 'persist_match') continue;
  const inp = p.input ?? {};
  console.log(`  fit=${inp.fit_score} included=${inp.included} reasoning_preview: ${(inp.reasoning ?? '').slice(0, 350)}`);
}

// Get the latest agent message to see what the agent is "saying" about images
const msg = (await db.execute({ sql: `SELECT payload_json FROM run_events WHERE run_id = 2 AND id > 1016 AND kind = 'message' ORDER BY id DESC LIMIT 1`, args: [] })).rows[0];
if (msg) {
  const p = JSON.parse(msg.payload_json);
  console.log(`\nLatest agent message preview: ${(p.content?.[0]?.text ?? '').slice(0, 350)}`);
}
