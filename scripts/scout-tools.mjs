import { createClient } from '@libsql/client';
import { readFileSync } from 'fs';
const env = readFileSync('.env.local', 'utf-8');
const parsed = Object.fromEntries(env.split('\n').filter(l => l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i+1).replace(/^"(.*)"$/, '$1')]; }));
const db = createClient({ url: parsed.TURSO_DATABASE_URL, authToken: parsed.TURSO_AUTH_TOKEN });
const events = (await db.execute({ sql: `SELECT id, kind, payload_json FROM run_events WHERE run_id = 1 AND kind IN ('custom_tool_use', 'message') ORDER BY id DESC LIMIT 20`, args: [] })).rows;
console.log('Last 20 custom_tool_use / message events:');
for (const ev of events.reverse()) {
  const p = JSON.parse(ev.payload_json);
  if (ev.kind === 'custom_tool_use') {
    const name = p.name ?? '?';
    const input = JSON.stringify(p.input ?? {}).slice(0, 200);
    console.log(`  id=${ev.id} [tool] ${name}  input=${input}`);
  } else if (ev.kind === 'message') {
    const text = (p.content?.[0]?.text ?? JSON.stringify(p.content)).slice(0, 250);
    console.log(`  id=${ev.id} [msg] ${text}`);
  }
}
