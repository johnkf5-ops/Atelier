import { createClient } from '@libsql/client';
import { readFileSync } from 'fs';
const env = readFileSync('.env.local', 'utf-8');
const parsed = Object.fromEntries(env.split('\n').filter(l => l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i+1).replace(/^"(.*)"$/, '$1')]; }));
const db = createClient({ url: parsed.TURSO_DATABASE_URL, authToken: parsed.TURSO_AUTH_TOKEN });

const cur = (await db.execute({ sql: `SELECT id, user_id, version, json FROM akb_versions ORDER BY id DESC LIMIT 1`, args: [] })).rows[0];
const data = JSON.parse(cur.json);

// PRACTICE — corrections per John 2026-04-25
data.practice.primary_medium = 'Landscape photography';
data.practice.secondary_media = ['Fine art print', 'NFT / digital art'];
data.practice.materials_and_methods = [
  'Hasselblad medium-format',
  'Phase One medium-format',
  'Canon DSLR',
  'Zone System exposure',
  'ND graduated filters',
  'In-camera capture (minimal post-processing)',
  'Fuji Flex print (Fujicolor Crystal Archive Maxima)',
];
data.practice.process_description = 'Twenty-year career working in the Ansel Adams Zone System tradition. Shot on Hasselblad and Phase One medium-format cameras and Canon DSLRs with ND graduated filters at exposure to balance scene dynamic range in-camera. Minimal post-processing — no HDR, no composites, no AI. Final prints are Fuji Flex (Fujicolor Crystal Archive Maxima) at gallery scale.';

// REPRESENTATION — both galleries CLOSED per John 2026-04-25
data.representation = [
  { gallery: 'John Knopf Gallery (Stratosphere) — closed 2017', location: 'Las Vegas, NV', since_year: 2012 },
  { gallery: 'John Knopf Gallery (Wayzata) — closed 2017', location: 'Minneapolis, MN', since_year: 2015 },
];

// EXHIBITIONS — gallery dates corrected
data.exhibitions = [
  { title: 'Venice Biennale', venue: 'Venice Biennale', location: 'Venice, Italy', year: 2022, type: 'group' },
  { title: 'Art Basel', venue: 'Art Basel', location: 'Miami Beach, FL', year: 2022, type: 'art-fair' },
  { title: 'Dubai exhibition', venue: 'Dubai exhibition', location: 'Dubai, UAE', year: 2023, type: 'group' },
  { title: 'John Knopf Gallery (Stratosphere) solo program 2012–2017', venue: 'John Knopf Gallery (Stratosphere)', location: 'Las Vegas, NV', year: 2012, type: 'solo' },
  { title: 'John Knopf Gallery (Wayzata) solo program 2015–2017', venue: 'John Knopf Gallery (Wayzata)', location: 'Minneapolis, MN', year: 2015, type: 'solo' },
];

// Provenance — mark these as manual_terminal_correction
data.source_provenance ??= {};
for (const k of ['practice.primary_medium','practice.secondary_media','practice.materials_and_methods','practice.process_description','representation','exhibitions']) {
  data.source_provenance[k] = 'manual_terminal_correction_2026_04_25';
}

const newVersion = cur.version + 1;
await db.execute({
  sql: `INSERT INTO akb_versions (user_id, version, json, source, created_at) VALUES (?, ?, ?, ?, unixepoch())`,
  args: [cur.user_id, newVersion, JSON.stringify(data), 'manual_terminal_correction_practice_galleries'],
});
console.log(`Wrote AKB v${newVersion} with corrections:`);
console.log('  practice.materials_and_methods: Hasselblad, Phase One, Canon, Zone System, ND grad, in-camera, Fuji Flex');
console.log('  representation: both galleries marked closed (Vegas 2012-2017, Minneapolis 2015-2017)');
console.log('  exhibitions: gallery dates corrected to closed range');
console.log('  process_description: rewritten — Zone System, no HDR, no composites');
