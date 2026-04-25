import { createClient } from '@libsql/client';
import { readFileSync } from 'fs';
const env = readFileSync('.env.local', 'utf-8');
const parsed = Object.fromEntries(env.split('\n').filter(l => l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i+1).replace(/^"(.*)"$/, '$1')]; }));
const db = createClient({ url: parsed.TURSO_DATABASE_URL, authToken: parsed.TURSO_AUTH_TOKEN });
const r = (await db.execute({ sql: `SELECT dp.work_sample_selection_json, o.name as opp_name FROM drafted_packages dp JOIN run_matches rm ON rm.id = dp.run_match_id JOIN opportunities o ON o.id = rm.opportunity_id ORDER BY dp.id`, args: [] })).rows;
console.log(`${r.length} drafted packages`);
for (const row of r) {
  const samples = JSON.parse(row.work_sample_selection_json || '[]');
  const ids = samples.map(s => s.portfolio_image_id ?? s.id ?? '?').join(',');
  console.log(`\n=== ${row.opp_name} (${samples.length} samples) ===`);
  console.log(`  image_ids: ${ids}`);
  for (const s of samples.slice(0, 3)) {
    console.log(`  id=${s.portfolio_image_id ?? s.id}: ${(s.rationale ?? '').slice(0, 120)}`);
  }
}
