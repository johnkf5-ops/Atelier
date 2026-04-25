import { createClient } from '@libsql/client';
import { readFileSync } from 'fs';
const env = readFileSync('.env.local', 'utf-8');
const parsed = Object.fromEntries(env.split('\n').filter(l => l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i+1).replace(/^"(.*)"$/, '$1')]; }));
const db = createClient({ url: parsed.TURSO_DATABASE_URL, authToken: parsed.TURSO_AUTH_TOKEN });
const cur = (await db.execute({ sql: `SELECT id, user_id, version, json FROM akb_versions ORDER BY id DESC LIMIT 1`, args: [] })).rows[0];
const data = JSON.parse(cur.json);
console.log('Before:', JSON.stringify({ artist_name: data.identity.artist_name, legal_name: data.identity.legal_name, public_name: data.identity.public_name }));
data.identity.artist_name = 'John Knopf';
data.identity.legal_name = 'Jonathan Knopf';
data.identity.legal_name_matches_artist_name = false;
data.source_provenance ??= {};
data.source_provenance['identity.artist_name'] = 'manual_terminal_correction_2026_04_25';
data.source_provenance['identity.legal_name_matches_artist_name'] = 'manual_terminal_correction_2026_04_25';
const newVersion = cur.version + 1;
await db.execute({
  sql: `INSERT INTO akb_versions (user_id, version, json, source, created_at) VALUES (?, ?, ?, ?, unixepoch())`,
  args: [cur.user_id, newVersion, JSON.stringify(data), 'manual_terminal_set_artist_name'],
});
console.log(`After: artist_name=John Knopf (v${newVersion} written)`);
