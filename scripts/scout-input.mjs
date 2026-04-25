import { createClient } from '@libsql/client';
import { readFileSync } from 'fs';
const env = readFileSync('.env.local', 'utf-8');
const parsed = Object.fromEntries(env.split('\n').filter(l => l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i+1).replace(/^"(.*)"$/, '$1')]; }));
const db = createClient({ url: parsed.TURSO_DATABASE_URL, authToken: parsed.TURSO_AUTH_TOKEN });
// Find a persist_opportunity event from run 1
const events = (await db.execute({ sql: `SELECT id, payload_json FROM run_events WHERE run_id = 1 AND kind = 'custom_tool_use' ORDER BY id LIMIT 3`, args: [] })).rows;
for (const ev of events) {
  const p = JSON.parse(ev.payload_json);
  if (p.name !== 'persist_opportunity') continue;
  const opp = p.input;
  console.log(`\n=== Opp: ${opp.name} ===`);
  console.log('past_recipient_image_urls:');
  for (const rec of (opp.past_recipient_image_urls || [])) {
    console.log(`  - ${rec.recipient_name} (year=${rec.year ?? '?'}): ${(rec.image_urls || []).length} URLs`);
    if (rec.image_urls && rec.image_urls.length > 0) {
      for (const u of rec.image_urls.slice(0, 2)) console.log(`      ${u}`);
    }
  }
}
