import { createClient } from '@libsql/client';
import { readFileSync } from 'fs';
const env = readFileSync('.env.local', 'utf-8');
const parsed = Object.fromEntries(env.split('\n').filter(l => l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i+1).replace(/^"(.*)"$/, '$1')]; }));
const db = createClient({ url: parsed.TURSO_DATABASE_URL, authToken: parsed.TURSO_AUTH_TOKEN });

const max = (await db.execute({ sql: `SELECT MAX(id) as m FROM run_events WHERE run_id = 2`, args: [] })).rows[0].m;
console.log(`max event id: ${max}`);

const events = (await db.execute({ sql: `SELECT id, kind, payload_json FROM run_events WHERE run_id = 2 AND id > 950 ORDER BY id DESC LIMIT 20`, args: [] })).rows;

let visionOk = 0, visionFail = 0;
for (const ev of events) {
  const p = JSON.parse(ev.payload_json);
  if (ev.kind !== 'tool_result') continue;
  const out = JSON.stringify(p.output ?? p.content ?? p);
  if (out.includes('"source":{"data"')) visionOk++;
  else if (out.includes('Output could not be decoded')) visionFail++;
}
console.log(`Vision tool_results in last 20 events: OK=${visionOk}, FAILED=${visionFail}`);

console.log('\nLast 10 events:');
const last = (await db.execute({ sql: `SELECT id, kind, payload_json FROM run_events WHERE run_id = 2 ORDER BY id DESC LIMIT 10`, args: [] })).rows;
for (const ev of last.reverse()) {
  const p = JSON.parse(ev.payload_json);
  let snippet = '';
  if (ev.kind === 'tool_use') snippet = `tool=${p.name} ${p.input?.file_path ?? ''}`;
  else if (ev.kind === 'tool_result') {
    const out = JSON.stringify(p.output ?? p.content ?? p);
    snippet = out.includes('"source"') ? 'MULTIMODAL BINARY ✓' : out.slice(0, 100);
  }
  else if (ev.kind === 'message') snippet = (p.content?.[0]?.text ?? '').slice(0, 150);
  else snippet = ev.kind;
  console.log(`  id=${ev.id} [${ev.kind}] ${snippet}`);
}

const matches = (await db.execute({ sql: `SELECT COUNT(*) as n, SUM(CASE WHEN included=1 THEN 1 ELSE 0 END) as inc FROM run_matches WHERE run_id = 2`, args: [] })).rows[0];
console.log(`\nMatches: ${matches.n} scored, ${matches.inc ?? 0} included`);
