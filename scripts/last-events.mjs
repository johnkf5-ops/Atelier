import { createClient } from '@libsql/client';
import { readFileSync } from 'fs';
const env = readFileSync('.env.local', 'utf-8');
const parsed = Object.fromEntries(env.split('\n').filter(l => l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i+1).replace(/^"(.*)"$/, '$1')]; }));
const db = createClient({ url: parsed.TURSO_DATABASE_URL, authToken: parsed.TURSO_AUTH_TOKEN });
console.log('total events for run 2:');
const tot = (await db.execute({ sql: `SELECT COUNT(*) as n, MAX(id) as maxid FROM run_events WHERE run_id = 2`, args: [] })).rows[0];
console.log(`  ${tot.n} events, max id=${tot.maxid}`);
const events = (await db.execute({ sql: `SELECT id, kind, payload_json FROM run_events WHERE run_id = 2 ORDER BY id DESC LIMIT 15`, args: [] })).rows;
for (const ev of events) {
  const p = JSON.parse(ev.payload_json);
  let snippet = '';
  if (ev.kind === 'tool_use') snippet = `tool=${p.name} ${p.input?.file_path ?? p.input?.command?.slice(0, 60) ?? JSON.stringify(p.input).slice(0, 80)}`;
  else if (ev.kind === 'tool_result') snippet = `output=${JSON.stringify(p.output ?? p.content ?? p).slice(0, 200)}`;
  else if (ev.kind === 'message') snippet = (p.content?.[0]?.text ?? '').slice(0, 180);
  else snippet = ev.kind;
  console.log(`  id=${ev.id} [${ev.kind}] ${snippet}`);
}
