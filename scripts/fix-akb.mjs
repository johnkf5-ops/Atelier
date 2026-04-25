import { createClient } from '@libsql/client';
import { readFileSync } from 'fs';
const env = readFileSync('.env.local', 'utf-8');
const parsed = Object.fromEntries(env.split('\n').filter(l => l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i+1).replace(/^"(.*)"$/, '$1')]; }));
const db = createClient({ url: parsed.TURSO_DATABASE_URL, authToken: parsed.TURSO_AUTH_TOKEN });

const current = (await db.execute({ sql: `SELECT id, user_id, version, json FROM akb_versions ORDER BY id DESC LIMIT 1`, args: [] })).rows[0];
console.log(`Current AKB: v${current.version} (id=${current.id})`);

const data = JSON.parse(current.json);
const before = data.awards_and_honors?.length ?? 0;
data.awards_and_honors = (data.awards_and_honors ?? []).filter(a => !/starcraft/i.test(a.name ?? ''));
const after = data.awards_and_honors.length;

console.log(`awards_and_honors: ${before} -> ${after} entries (removed ${before - after})`);
console.log('Remaining:', JSON.stringify(data.awards_and_honors, null, 2));

const newVersion = current.version + 1;
await db.execute({
  sql: `INSERT INTO akb_versions (user_id, version, json, source, created_at) VALUES (?, ?, ?, ?, unixepoch())`,
  args: [current.user_id, newVersion, JSON.stringify(data), 'manual_correction_starcraft_removal']
});
console.log(`Wrote AKB v${newVersion}.`);
