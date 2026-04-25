import { createClient } from '@libsql/client';
import { readFileSync } from 'fs';
const env = readFileSync('.env.local', 'utf-8');
const parsed = Object.fromEntries(env.split('\n').filter(l => l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i+1).replace(/^"(.*)"$/, '$1')]; }));
const db = createClient({ url: parsed.TURSO_DATABASE_URL, authToken: parsed.TURSO_AUTH_TOKEN });
const events = (await db.execute({ sql: `SELECT id, payload_json FROM run_events WHERE run_id = 2 AND kind = 'tool_result' ORDER BY id`, args: [] })).rows;
let lastVisionId = 0, firstFailId = 0;
for (const ev of events) {
  const out = JSON.stringify(JSON.parse(ev.payload_json).output ?? JSON.parse(ev.payload_json).content ?? '');
  if (out.includes('"source":{"data"')) lastVisionId = ev.id;
  else if (out.includes('Output could not be decoded') && firstFailId === 0) firstFailId = ev.id;
}
console.log(`Last vision-binary tool_result id: ${lastVisionId}`);
console.log(`First "could not be decoded" id: ${firstFailId}`);

// Get a count by id range to see WHEN the text-only failures dominate
const buckets = [];
for (let lo = 0; lo <= 1100; lo += 100) {
  const hi = lo + 99;
  const r = (await db.execute({ sql: `SELECT
    SUM(CASE WHEN payload_json LIKE '%"source":{"data"%' THEN 1 ELSE 0 END) as ok,
    SUM(CASE WHEN payload_json LIKE '%Output could not be decoded%' THEN 1 ELSE 0 END) as fail
    FROM run_events WHERE run_id = 2 AND kind = 'tool_result' AND id BETWEEN ? AND ?`,
    args: [lo, hi] })).rows[0];
  if (Number(r.ok) + Number(r.fail) > 0) buckets.push(`  id ${lo}-${hi}: ok=${r.ok}, fail=${r.fail}`);
}
console.log('\nVision per id-bucket:');
for (const b of buckets) console.log(b);
