import { createClient } from '@libsql/client';
import { readFileSync } from 'fs';
const env = readFileSync('.env.local', 'utf-8');
const parsed = Object.fromEntries(env.split('\n').filter(l => l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i+1).replace(/^"(.*)"$/, '$1')]; }));
const db = createClient({ url: parsed.TURSO_DATABASE_URL, authToken: parsed.TURSO_AUTH_TOKEN });

const r = (await db.execute({ sql: `SELECT status, finished_at FROM runs WHERE id = 2`, args: [] })).rows[0];
const m = (await db.execute({ sql: `SELECT COUNT(*) as n, SUM(CASE WHEN included=1 THEN 1 ELSE 0 END) as inc FROM run_matches WHERE run_id = 2`, args: [] })).rows[0];
console.log(`Status: ${r.status} | matches: ${m.n} scored, ${m.inc ?? 0} included`);

// Did read tool calls happen ONLY at start (legacy path) or throughout?
const readsByBucket = (await db.execute({ sql: `SELECT
  COUNT(*) as n, MIN(id) as min_id, MAX(id) as max_id
  FROM run_events WHERE run_id = 2 AND kind = 'tool_use' AND payload_json LIKE '%"name":"read"%' AND id > 1016`, args: [] })).rows[0];
console.log(`Read tool calls since rerun (id > 1016): ${readsByBucket.n}, range ${readsByBucket.min_id}-${readsByBucket.max_id}`);

// Check what tool_results those reads returned
const readResults = (await db.execute({ sql: `SELECT
  SUM(CASE WHEN payload_json LIKE '%"source":{"data"%' THEN 1 ELSE 0 END) as vision_ok,
  SUM(CASE WHEN payload_json LIKE '%could not be decoded%' THEN 1 ELSE 0 END) as text_only
  FROM run_events WHERE run_id = 2 AND kind = 'tool_result' AND id > 1016`, args: [] })).rows[0];
console.log(`tool_results since rerun: vision-binary=${readResults.vision_ok}, text-only=${readResults.text_only}`);

// Sample a recent persist_match reasoning
const pm = (await db.execute({ sql: `SELECT payload_json FROM run_events WHERE run_id = 2 AND kind = 'custom_tool_use' AND id > 1016 ORDER BY id DESC LIMIT 1`, args: [] })).rows[0];
if (pm) {
  const p = JSON.parse(pm.payload_json);
  console.log(`\nLatest persist_match reasoning:\n${(p.input?.reasoning ?? '').slice(0, 600)}`);
}
