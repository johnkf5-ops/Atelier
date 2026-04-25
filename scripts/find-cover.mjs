import { createClient } from '@libsql/client';
import { readFileSync } from 'fs';
const env = readFileSync('.env.local', 'utf-8');
const parsed = Object.fromEntries(env.split('\n').filter(l => l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i+1).replace(/^"(.*)"$/, '$1')]; }));
const db = createClient({ url: parsed.TURSO_DATABASE_URL, authToken: parsed.TURSO_AUTH_TOKEN });
const tables = (await db.execute({ sql: `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_%'`, args: [] })).rows.map(r => r.name);
console.log('tables:', tables.join(', '));
for (const t of tables) {
  const r = await db.execute({ sql: `SELECT * FROM ${t} LIMIT 1`, args: [] });
  if (r.columns.some(c => /cover|narrative|prose|preface|intro|orchestr/i.test(c))) {
    console.log(`\n${t}:`, r.columns);
  }
}
