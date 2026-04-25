import { createClient } from '@libsql/client';
import { readFileSync } from 'fs';
const env = readFileSync('.env.local', 'utf-8');
const parsed = Object.fromEntries(env.split('\n').filter(l => l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i+1).replace(/^"(.*)"$/, '$1')]; }));
const db = createClient({ url: parsed.TURSO_DATABASE_URL, authToken: parsed.TURSO_AUTH_TOKEN });

const r = await db.execute({ sql: `SELECT * FROM akb_versions LIMIT 1`, args: [] });
console.log('akb_versions columns:', r.columns);

const latest = (await db.execute({ sql: `SELECT id, version, user_id, length(json) as size FROM akb_versions ORDER BY id DESC LIMIT 5`, args: [] })).rows;
console.log('Latest 5 AKBs:');
for (const a of latest) console.log(`  v${a.version} (id=${a.id}, user=${a.user_id}, ${a.size} bytes)`);

const akb = (await db.execute({ sql: `SELECT json FROM akb_versions ORDER BY id DESC LIMIT 1`, args: [] })).rows[0];
const data = JSON.parse(akb.json);
console.log('\n=== Latest AKB structure (top-level keys) ===');
console.log(Object.keys(data));
console.log('\n=== Searching for "starcraft" anywhere ===');
const json = JSON.stringify(data, null, 2);
const idx = json.toLowerCase().indexOf('starcraft');
if (idx >= 0) {
  console.log('FOUND at character', idx);
  console.log(json.slice(Math.max(0, idx - 200), idx + 400));
} else {
  console.log('NOT FOUND in latest AKB');
}

console.log('\n=== awards_and_honors content ===');
console.log(JSON.stringify(data.awards_and_honors ?? data.awards ?? data.honors ?? '(no such key)', null, 2));
