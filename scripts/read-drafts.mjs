import { createClient } from '@libsql/client';
import { readFileSync } from 'fs';
const env = readFileSync('.env.local', 'utf-8');
const parsed = Object.fromEntries(env.split('\n').filter(l => l.includes('=')).map(l => {
  const i = l.indexOf('=');
  return [l.slice(0, i), l.slice(i+1).replace(/^"(.*)"$/, '$1')];
}));
const db = createClient({ url: parsed.TURSO_DATABASE_URL, authToken: parsed.TURSO_AUTH_TOKEN });
const r = await db.execute({
  sql: `SELECT o.name, dp.artist_statement, dp.project_proposal, dp.cover_letter
        FROM drafted_packages dp
        JOIN run_matches rm ON rm.id = dp.run_match_id
        JOIN opportunities o ON o.id = rm.opportunity_id
        WHERE rm.run_id = 2 AND rm.included = 1`, args: []
});
for (const row of r.rows) {
  console.log(`=== ${row.name} ===\n`);
  console.log('--- ARTIST STATEMENT ---\n' + (row.artist_statement || '(empty)'));
  console.log('\n--- PROJECT PROPOSAL ---\n' + (row.project_proposal || '(empty)'));
  console.log('\n--- COVER LETTER ---\n' + (row.cover_letter || '(empty)'));
}
