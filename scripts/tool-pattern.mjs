import { createClient } from '@libsql/client';
import { readFileSync } from 'fs';
const env = readFileSync('.env.local', 'utf-8');
const parsed = Object.fromEntries(env.split('\n').filter(l => l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i+1).replace(/^"(.*)"$/, '$1')]; }));
const db = createClient({ url: parsed.TURSO_DATABASE_URL, authToken: parsed.TURSO_AUTH_TOKEN });
const events = (await db.execute({ sql: `SELECT payload_json FROM run_events WHERE run_id = 1 AND kind = 'tool_use' ORDER BY id LIMIT 25`, args: [] })).rows;
for (const ev of events) {
  const p = JSON.parse(ev.payload_json);
  const tool = p.name ?? p.tool ?? '?';
  let args = '';
  if (p.input) {
    if (p.input.command) args = p.input.command.slice(0, 100);
    else if (p.input.path) args = `path=${p.input.path}`;
    else args = JSON.stringify(p.input).slice(0, 100);
  }
  console.log(`[${tool}] ${args}`);
}
