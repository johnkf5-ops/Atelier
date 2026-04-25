import { createClient } from '@libsql/client';
import { readFileSync } from 'fs';
const env = readFileSync('.env.local', 'utf-8');
const parsed = Object.fromEntries(env.split('\n').filter(l => l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i+1).replace(/^"(.*)"$/, '$1')]; }));
const db = createClient({ url: parsed.TURSO_DATABASE_URL, authToken: parsed.TURSO_AUTH_TOKEN });
const r = (await db.execute({ sql: `SELECT * FROM dossiers WHERE run_id = 2`, args: [] })).rows[0];
console.log('dossier columns:', Object.keys(r));
for (const k of Object.keys(r)) {
  const v = r[k];
  if (typeof v === 'string' && v.length > 50) {
    console.log(`\n=== ${k} (${v.length} chars) ===`);
    console.log('LAST 200 chars:', JSON.stringify(v.slice(-200)));
    console.log('ends OK?', /[.!?"]\s*$/.test(v.trim()));
  }
}
