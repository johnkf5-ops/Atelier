import { createClient } from '@libsql/client';
import { readFileSync } from 'fs';
const env = readFileSync('.env.local', 'utf-8');
const parsed = Object.fromEntries(env.split('\n').filter(l => l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i+1).replace(/^"(.*)"$/, '$1')]; }));
const db = createClient({ url: parsed.TURSO_DATABASE_URL, authToken: parsed.TURSO_AUTH_TOKEN });

// Check user.message events — do they contain image content blocks?
const userMsgs = (await db.execute({ sql: `SELECT id, payload_json FROM run_events WHERE run_id = 2 AND kind = 'message' AND payload_json LIKE '%"user"%' ORDER BY id DESC LIMIT 5`, args: [] })).rows;
console.log(`Recent user.message events:`);
for (const ev of userMsgs) {
  const p = JSON.parse(ev.payload_json);
  const content = p.content ?? [];
  const types = content.map(c => c.type).join(',');
  console.log(`  id=${ev.id} types=[${types}]`);
}

// Also check tool_use events from the most recent batch (since the rerun)
const reads = (await db.execute({ sql: `SELECT id, payload_json FROM run_events WHERE run_id = 2 AND kind = 'tool_use' AND payload_json LIKE '%"name":"read"%' ORDER BY id DESC LIMIT 5`, args: [] })).rows;
console.log(`\nRecent read tool_use events:`);
for (const ev of reads) {
  const p = JSON.parse(ev.payload_json);
  console.log(`  id=${ev.id} input=${JSON.stringify(p.input ?? {}).slice(0, 100)}`);
}

// Latest events around the running session to understand what's happening
const latest = (await db.execute({ sql: `SELECT id, agent, kind FROM run_events WHERE run_id = 2 ORDER BY id DESC LIMIT 8`, args: [] })).rows;
console.log(`\nLatest 8 events:`);
for (const ev of latest.reverse()) console.log(`  id=${ev.id} [${ev.agent}/${ev.kind}]`);
