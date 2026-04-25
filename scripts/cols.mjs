import { createClient } from '@libsql/client';
import { readFileSync } from 'fs';
const env = readFileSync('.env.local', 'utf-8');
const parsed = Object.fromEntries(env.split('\n').filter(l => l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i+1).replace(/^"(.*)"$/, '$1')]; }));
const db = createClient({ url: parsed.TURSO_DATABASE_URL, authToken: parsed.TURSO_AUTH_TOKEN });
for (const t of ['run_opportunities', 'run_matches', 'drafted_packages', 'run_events']) {
  try { const r = await db.execute({ sql: `SELECT * FROM ${t} LIMIT 1`, args: [] }); console.log(t, r.columns); } catch(e) { console.log(t, 'ERR', e.message); }
}
