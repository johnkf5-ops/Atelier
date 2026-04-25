import { createClient } from '@libsql/client';
import { readFileSync } from 'fs';
const env = readFileSync('.env.local', 'utf-8');
const parsed = Object.fromEntries(env.split('\n').filter(l => l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i+1).replace(/^"(.*)"$/, '$1')]; }));
const db = createClient({ url: parsed.TURSO_DATABASE_URL, authToken: parsed.TURSO_AUTH_TOKEN });
const r = (await db.execute({ sql: `SELECT id, opportunity_id, name, year, portfolio_urls, bio_url, file_ids FROM past_recipients WHERE id IN (SELECT id FROM past_recipients WHERE file_ids = '[]' OR file_ids IS NULL OR file_ids = '' LIMIT 5)`, args: [] })).rows;
console.log('Sample of recipients without file_ids:');
for (const row of r) {
  console.log(`\n  opp=${row.opportunity_id} name=${row.name}`);
  console.log(`    bio_url=${row.bio_url ?? '(none)'}`);
  console.log(`    portfolio_urls=${row.portfolio_urls ?? '(none)'}`);
}
