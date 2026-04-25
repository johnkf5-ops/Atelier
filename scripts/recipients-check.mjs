import { createClient } from '@libsql/client';
import { readFileSync } from 'fs';
const env = readFileSync('.env.local', 'utf-8');
const parsed = Object.fromEntries(env.split('\n').filter(l => l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i+1).replace(/^"(.*)"$/, '$1')]; }));
const db = createClient({ url: parsed.TURSO_DATABASE_URL, authToken: parsed.TURSO_AUTH_TOKEN });

const r = await db.execute({ sql: `SELECT * FROM past_recipients LIMIT 1`, args: [] });
console.log('past_recipients columns:', r.columns);

const rs = (await db.execute({ sql: `SELECT pr.opportunity_id, o.name, COUNT(*) as n_recips, SUM(CASE WHEN pr.file_ids IS NOT NULL AND pr.file_ids != '[]' AND pr.file_ids != '' THEN 1 ELSE 0 END) as n_with_files
                                       FROM past_recipients pr JOIN opportunities o ON o.id = pr.opportunity_id 
                                       JOIN run_opportunities ro ON ro.opportunity_id = o.id WHERE ro.run_id = 1 GROUP BY pr.opportunity_id ORDER BY pr.opportunity_id`, args: [] })).rows;
console.log('\n=== PAST RECIPIENTS PER OPP (run 1) ===');
for (const x of rs) console.log(`  opp ${x.opportunity_id}: ${x.n_recips} recipients, ${x.n_with_files} with file_ids — ${x.name}`);

const sample = (await db.execute({ sql: `SELECT pr.name, pr.year, pr.file_ids, o.name as opp_name FROM past_recipients pr JOIN opportunities o ON o.id = pr.opportunity_id 
                                       JOIN run_opportunities ro ON ro.opportunity_id = o.id WHERE ro.run_id = 1 LIMIT 5`, args: [] })).rows;
console.log('\n=== SAMPLE PAST RECIPIENT ROWS ===');
for (const s of sample) console.log(`  ${s.opp_name} / ${s.name} (${s.year}): file_ids=${s.file_ids ?? 'null'}`);
