import { createClient } from '@libsql/client';
import { readFileSync } from 'fs';
const env = readFileSync('.env.local', 'utf-8');
const parsed = Object.fromEntries(env.split('\n').filter(l => l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i+1).replace(/^"(.*)"$/, '$1')]; }));
const db = createClient({ url: parsed.TURSO_DATABASE_URL, authToken: parsed.TURSO_AUTH_TOKEN });
const r = (await db.execute({ sql: `SELECT rm.opportunity_id, rm.supporting_image_ids, rm.hurting_image_ids, rm.fit_score, rm.included, o.name FROM run_matches rm JOIN opportunities o ON o.id = rm.opportunity_id WHERE rm.included = 1 ORDER BY rm.opportunity_id`, args: [] })).rows;
for (const row of r) {
  const sup = JSON.parse(row.supporting_image_ids || '[]');
  const hurt = JSON.parse(row.hurting_image_ids || '[]');
  console.log(`opp ${row.opportunity_id} fit=${row.fit_score}: supporting=[${sup.join(',') || '(empty)'}] hurting=[${hurt.join(',') || '(empty)'}]  ${row.name.slice(0, 50)}`);
}
