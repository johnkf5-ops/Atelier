import { createClient } from '@libsql/client';
import { readFileSync } from 'fs';
const env = readFileSync('.env.local', 'utf-8');
const parsed = Object.fromEntries(env.split('\n').filter(l => l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i+1).replace(/^"(.*)"$/, '$1')]; }));
const db = createClient({ url: parsed.TURSO_DATABASE_URL, authToken: parsed.TURSO_AUTH_TOKEN });
// Find when Rubric started — first event after the Scout 'requires_action' triggered start-rubric. Look for 'read'/'bash'/'glob' tool_use after the Scout phase.
const events = (await db.execute({ sql: `SELECT id, agent, kind, payload_json FROM run_events WHERE run_id = 1 AND kind = 'tool_use' ORDER BY id DESC LIMIT 30`, args: [] })).rows;
console.log('Last 30 tool_use events (most recent first):');
for (const ev of events) {
  const p = JSON.parse(ev.payload_json);
  const tool = p.name ?? '?';
  let args = '';
  if (p.input) {
    if (p.input.command) args = `cmd=${p.input.command.slice(0, 120)}`;
    else if (p.input.path) args = `path=${p.input.path}`;
    else if (p.input.file_path) args = `file=${p.input.file_path}`;
    else args = JSON.stringify(p.input).slice(0, 120);
  }
  console.log(`  id=${ev.id} [${tool}] ${args}`);
}
