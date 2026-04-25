import { createClient } from '@libsql/client';
import { readFileSync } from 'fs';
const env = readFileSync('.env.local', 'utf-8');
const parsed = Object.fromEntries(env.split('\n').filter(l => l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i+1).replace(/^"(.*)"$/, '$1')]; }));
const db = createClient({ url: parsed.TURSO_DATABASE_URL, authToken: parsed.TURSO_AUTH_TOKEN });
// Find tool_result events around the first portfolio read (id 857 was the first)
const events = (await db.execute({ sql: `SELECT id, kind, payload_json FROM run_events WHERE run_id = 2 AND id BETWEEN 855 AND 870 ORDER BY id`, args: [] })).rows;
for (const ev of events) {
  const p = JSON.parse(ev.payload_json);
  let snippet = '';
  if (ev.kind === 'tool_use') snippet = `tool=${p.name} input=${JSON.stringify(p.input).slice(0, 80)}`;
  else if (ev.kind === 'tool_result') snippet = `output=${JSON.stringify(p.output ?? p.content ?? p).slice(0, 200)}`;
  else if (ev.kind === 'message') snippet = `text=${(p.content?.[0]?.text ?? '').slice(0, 200)}`;
  else snippet = JSON.stringify(p).slice(0, 100);
  console.log(`id=${ev.id} [${ev.kind}] ${snippet}`);
}
