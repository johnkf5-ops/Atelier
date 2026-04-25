import { createClient } from '@libsql/client';
import { readFileSync } from 'fs';
const env = readFileSync('.env.local', 'utf-8');
const parsed = Object.fromEntries(env.split('\n').filter(l => l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i+1).replace(/^"(.*)"$/, '$1')]; }));
const db = createClient({ url: parsed.TURSO_DATABASE_URL, authToken: parsed.TURSO_AUTH_TOKEN });

const r = (await db.execute({ sql: `SELECT dp.artist_statement, dp.project_proposal, dp.cover_letter, o.name FROM drafted_packages dp JOIN run_matches rm ON rm.id = dp.run_match_id JOIN opportunities o ON o.id = rm.opportunity_id ORDER BY dp.id`, args: [] })).rows;

function audit(text, label) {
  const dashes = (text.match(/—/g) || []).length;
  const words = text.split(/\s+/).length;
  const knopfThird = (text.match(/\bKnopf\s+(submits|is|was|has|photographs|shoots|works|writes|presents|exhibits|appears|continues|received)\b/g) || []).length;
  const lineageHits = (text.match(/\b(Adams|Lik|Rowell|Shore|Eggleston|Sugimoto|Frye|Butcher|Luong|Plant|Wall|Ratcliff|Dobrowner|Burtynsky|Crewdson|Weston|Porter|Misrach)\b/g) || []);
  const lineageNames = [...new Set(lineageHits)];
  const dearOpens = /^Dear\s/.test(text.trim());
  const opensDirectly = /^(I\b|My\b)/.test(text.trim());
  return { label, words, dashes, knopfThird, lineageNames: lineageNames.length, dearOpens, opensDirectly };
}

for (const row of r) {
  console.log(`\n=== ${row.name.slice(0, 55)} ===`);
  const stmt = audit(row.artist_statement, 'STMT');
  const prop = audit(row.project_proposal, 'PROP');
  const cover = audit(row.cover_letter, 'COVER');
  console.log(`  STMT  ${stmt.words}w em=${stmt.dashes} 3p-knopf=${stmt.knopfThird} lineage=${stmt.lineageNames}/${stmt.lineageNames > 2 ? 'FAIL' : 'ok'} opens-1p=${stmt.opensDirectly}`);
  console.log(`  PROP  ${prop.words}w em=${prop.dashes} 3p-knopf=${prop.knopfThird} lineage=${prop.lineageNames}/${prop.lineageNames > 2 ? 'FAIL' : 'ok'}`);
  console.log(`  COVER ${cover.words}w em=${cover.dashes} 3p-knopf=${cover.knopfThird} dear=${cover.dearOpens} lineage=${cover.lineageNames}/${cover.lineageNames > 2 ? 'FAIL' : 'ok'}`);
}
