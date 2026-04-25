import { createClient } from '@libsql/client';
import { readFileSync } from 'fs';
const env = readFileSync('.env.local', 'utf-8');
const parsed = Object.fromEntries(env.split('\n').filter(l => l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i+1).replace(/^"(.*)"$/, '$1')]; }));
const db = createClient({ url: parsed.TURSO_DATABASE_URL, authToken: parsed.TURSO_AUTH_TOKEN });
// Find read/bash tool_use events for run 2 (Rubric phase, after Scout web_search/fetch)
const events = (await db.execute({ sql: `SELECT id, payload_json FROM run_events WHERE run_id = 2 AND kind = 'tool_use' ORDER BY id DESC LIMIT 40`, args: [] })).rows;
console.log(`last 40 tool_use events (most recent first):`);
for (const ev of events) {
  const p = JSON.parse(ev.payload_json);
  const tool = p.name ?? '?';
  let arg = '';
  if (p.input?.file_path) arg = `file=${p.input.file_path}`;
  else if (p.input?.path) arg = `path=${p.input.path}`;
  else if (p.input?.command) arg = `cmd=${p.input.command.slice(0, 100)}`;
  else arg = JSON.stringify(p.input).slice(0, 100);
  console.log(`  id=${ev.id} [${tool}] ${arg}`);
}
