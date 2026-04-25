import { createClient } from '@libsql/client';
import { readFileSync } from 'fs';
const env = readFileSync('.env.local', 'utf-8');
const parsed = Object.fromEntries(env.split('\n').filter(l => l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i+1).replace(/^"(.*)"$/, '$1')]; }));
const db = createClient({ url: parsed.TURSO_DATABASE_URL, authToken: parsed.TURSO_AUTH_TOKEN });
// Audit ALL tool_results in run 2 — any multimodal ones?
const events = (await db.execute({ sql: `SELECT id, payload_json FROM run_events WHERE run_id = 2 AND kind = 'tool_result' ORDER BY id`, args: [] })).rows;
let visionOk = 0, visionFail = 0, other = 0;
for (const ev of events) {
  const out = JSON.stringify(JSON.parse(ev.payload_json).output ?? JSON.parse(ev.payload_json).content ?? '');
  if (out.includes('"source":{"data"')) visionOk++;
  else if (out.includes('Output could not be decoded')) visionFail++;
  else other++;
}
console.log(`run 2 ALL tool_results: vision-binary=${visionOk}, "could not be decoded"=${visionFail}, other=${other}`);
