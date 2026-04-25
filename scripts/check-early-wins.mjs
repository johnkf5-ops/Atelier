import { createClient } from '@libsql/client';
import { readFileSync } from 'fs';
const env = readFileSync('.env.local', 'utf-8');
const parsed = Object.fromEntries(env.split('\n').filter(l => l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i+1).replace(/^"(.*)"$/, '$1')]; }));
const db = createClient({ url: parsed.TURSO_DATABASE_URL, authToken: parsed.TURSO_AUTH_TOKEN });
// What kind of tool was called for the early vision-binary tool_results?
const events = (await db.execute({ sql: `SELECT id, kind, payload_json FROM run_events WHERE run_id = 2 AND id BETWEEN 600 AND 800 ORDER BY id`, args: [] })).rows;
let pending = null;
for (const ev of events) {
  const p = JSON.parse(ev.payload_json);
  if (ev.kind === 'tool_use') pending = p.name;
  else if (ev.kind === 'tool_result') {
    const out = JSON.stringify(p.output ?? p.content ?? '');
    if (out.includes('"source":{"data"')) {
      console.log(`id=${ev.id}: vision-binary from tool ${pending}`);
    }
  }
}
