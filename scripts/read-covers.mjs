import { createClient } from '@libsql/client';
import { readFileSync } from 'fs';
const env = readFileSync('.env.local', 'utf-8');
const parsed = Object.fromEntries(env.split('\n').filter(l => l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i+1).replace(/^"(.*)"$/, '$1')]; }));
const db = createClient({ url: parsed.TURSO_DATABASE_URL, authToken: parsed.TURSO_AUTH_TOKEN });
const r = (await db.execute({ sql: `SELECT dp.cover_letter, o.name FROM drafted_packages dp JOIN run_matches rm ON rm.id = dp.run_match_id JOIN opportunities o ON o.id = rm.opportunity_id ORDER BY dp.id`, args: [] })).rows;
console.log(`${r.length} cover letters\n`);
for (const row of r) {
  const cv = row.cover_letter || '';
  const dashes = (cv.match(/—/g) || []).length;
  const words = cv.split(/\s+/).length;
  console.log(`=== ${row.name.slice(0, 60)} ===`);
  console.log(`words=${words}  em-dashes=${dashes}\n${cv}\n`);
}
