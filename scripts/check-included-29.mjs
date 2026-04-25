import { createClient } from '@libsql/client';
import { readFileSync } from 'fs';
const env = readFileSync('.env.local', 'utf-8');
const parsed = Object.fromEntries(env.split('\n').filter(l => l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i+1).replace(/^"(.*)"$/, '$1')]; }));
const db = createClient({ url: parsed.TURSO_DATABASE_URL, authToken: parsed.TURSO_AUTH_TOKEN });

// All scored matches and their reasoning
const matches = (await db.execute({ sql: `SELECT rm.fit_score, rm.included, rm.reasoning, o.name FROM run_matches rm JOIN opportunities o ON o.id = rm.opportunity_id WHERE rm.run_id = 2 ORDER BY rm.fit_score DESC`, args: [] })).rows;
console.log(`${matches.length} matches scored:\n`);
for (const m of matches) {
  console.log(`  ${m.included ? '[IN ]' : '[OUT]'} fit=${m.fit_score} ${m.name.slice(0, 50)}`);
}
console.log(`\nFull reasoning of TOP match:\n${matches[0].reasoning?.slice(0, 800)}`);

// Check ALL message kind events to see if any are user-side with image content
const allMsgs = (await db.execute({ sql: `SELECT id, kind, payload_json FROM run_events WHERE run_id = 2 AND id > 1016 AND kind = 'message' ORDER BY id LIMIT 5`, args: [] })).rows;
console.log(`\nAll message events since rerun (showing first 5):`);
for (const ev of allMsgs) {
  const p = JSON.parse(ev.payload_json);
  const role = p.role ?? '(unknown)';
  const types = (p.content ?? []).map(c => c.type).join(',');
  console.log(`  id=${ev.id} role=${role} content-types=[${types}]`);
}

// Search for "image" in any payload to confirm image blocks made it in
const imgPayloads = (await db.execute({ sql: `SELECT COUNT(*) as n FROM run_events WHERE run_id = 2 AND id > 1016 AND payload_json LIKE '%"type":"image"%'`, args: [] })).rows[0].n;
console.log(`\nEvents containing image content blocks: ${imgPayloads}`);
