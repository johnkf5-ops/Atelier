import { createClient } from '@libsql/client';
import { readFileSync } from 'fs';
const env = readFileSync('.env.local', 'utf-8');
const parsed = Object.fromEntries(env.split('\n').filter(l => l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i+1).replace(/^"(.*)"$/, '$1')]; }));
const db = createClient({ url: parsed.TURSO_DATABASE_URL, authToken: parsed.TURSO_AUTH_TOKEN });

const cur = (await db.execute({ sql: `SELECT id, user_id, version, json FROM akb_versions ORDER BY id DESC LIMIT 1`, args: [] })).rows[0];
const data = JSON.parse(cur.json);

// === IDENTITY: 20-year career, not 15 ===
// (year_of_birth stays — implies the years on its own)

// === EXHIBITIONS — corrections + Mondoir solo ===
data.exhibitions = [
  {
    title: 'Chasing the Light',
    venue: 'Mondoir Gallery',
    location: 'Dubai, UAE',
    year: 2025,
    type: 'solo',
  },
  { title: 'Venice Biennale', venue: 'Venice Biennale', location: 'Venice, Italy', year: 2022, type: 'group' },
  { title: 'Art Basel Miami Beach', venue: 'Art Basel', location: 'Miami Beach, FL', year: 2022, type: 'art-fair' },
  {
    title: 'John Knopf Gallery (Stratosphere) solo program 2012–2017',
    venue: 'John Knopf Gallery (Stratosphere)',
    location: 'Las Vegas, NV',
    year: 2012,
    type: 'solo',
  },
  {
    title: 'John Knopf Gallery (Wayzata) solo program 2015–2017',
    venue: 'John Knopf Gallery (Wayzata)',
    location: 'Minneapolis, MN',
    year: 2015,
    type: 'solo',
  },
];

// === REPRESENTATION — Mondoir Gallery currently represents him ===
data.representation = [
  {
    gallery: 'Mondoir Gallery',
    location: 'Dubai, UAE',
    since_year: 2025,
  },
  // Past galleries kept for historical record but marked closed in name
  { gallery: 'John Knopf Gallery (Stratosphere) — closed 2017', location: 'Las Vegas, NV', since_year: 2012 },
  { gallery: 'John Knopf Gallery (Wayzata) — closed 2017', location: 'Minneapolis, MN', since_year: 2015 },
];

// === PUBLICATIONS — corrected NatGeo year + add books ===
data.publications = [
  {
    publisher: 'National Geographic',
    title: 'First-cohort NFT drop',
    year: 2023,
    url: undefined,
  },
  {
    publisher: 'TIME Magazine',
    title: 'TIMEPieces NFT — Genesis drop',
    year: 2022,
  },
  { publisher: 'Red Bull', year: 2019 },
  { publisher: 'USA Today', year: 2018 },
  { publisher: 'Billboard', year: 2021 },
  { publisher: 'Google', year: 2020 },
  // Two monographs of John's own work
  { publisher: 'Self-published', title: 'John Knopf — Photography Monograph (Volume I)', year: 2018 },
  { publisher: 'Self-published', title: 'John Knopf — Photography Monograph (Volume II)', year: 2021 },
];

// === COLLECTIONS — TIMEPieces is corporate, NatGeo NFT cohort ===
data.collections = [
  { name: 'TIME Magazine TIMEPieces NFT collection', type: 'corporate' },
  { name: 'National Geographic — first NFT cohort', type: 'corporate' },
];

// === AWARDS_AND_HONORS ===
data.awards_and_honors = [
  { name: 'Emmy nomination', year: 2018 },
];

// === CURATORIAL & ORGANIZATIONAL — new field ===
data.curatorial_and_organizational = [
  {
    role: 'Founder',
    organization: 'FOTO',
    project_or_publication: 'FOTO photography community + curated gallery program',
    notes:
      'Founded FOTO, a community of working photographers. Organized and curated multiple FOTO-branded gallery exhibitions in NYC at NFT NYC and Art Basel, displaying work by 1000+ different photographers across multiple events.',
  },
  {
    role: 'Curator + Organizer',
    organization: 'National Geographic',
    project_or_publication: 'Gallery exhibition program',
    notes: 'Organized and curated gallery exhibitions for National Geographic.',
  },
  {
    role: 'Curator + Organizer',
    organization: 'TIME Magazine',
    project_or_publication: 'Gallery exhibition program',
    notes: 'Organized and curated gallery exhibitions for TIME.',
  },
  {
    role: 'Curator',
    organization: 'HUG',
    project_or_publication: 'Photography book / publication',
    notes: 'Curated a photography publication for HUG.',
  },
  {
    role: 'Co-curator',
    organization: 'Independent / collaborative',
    project_or_publication: 'Photography book curated with Mike Yamashita (National Geographic photographer)',
    notes: 'Co-curated a photography publication with National Geographic photographer Mike Yamashita.',
  },
];

// === CAREER STAGE — established (curator/founder credentials reinforce this) ===
data.career_stage = 'established';

// === PROVENANCE ===
data.source_provenance ??= {};
for (const k of [
  'exhibitions',
  'representation',
  'publications',
  'collections',
  'awards_and_honors',
  'curatorial_and_organizational',
  'career_stage',
]) {
  data.source_provenance[k] = 'manual_terminal_correction_2026_04_25';
}

const newVersion = cur.version + 1;
await db.execute({
  sql: `INSERT INTO akb_versions (user_id, version, json, source, created_at) VALUES (?, ?, ?, ?, unixepoch())`,
  args: [cur.user_id, newVersion, JSON.stringify(data), 'manual_terminal_correction_full_career_2026_04_25'],
});

console.log(`Wrote AKB v${newVersion} with full career corrections + additions:`);
console.log('  EXHIBITIONS: Mondoir solo "Chasing the Light" 2025 (Dubai), galleries marked closed');
console.log('  REPRESENTATION: Mondoir Gallery Dubai (current), past galleries marked closed');
console.log('  PUBLICATIONS: NatGeo 2023, TIMEPieces, 2 self-published monographs added');
console.log('  COLLECTIONS: TIMEPieces NFT, NatGeo first NFT cohort');
console.log('  CURATORIAL_AND_ORGANIZATIONAL (new field):');
console.log('    - Founder, FOTO (1000+ photographer exhibitions at NFT NYC + Art Basel)');
console.log('    - Curator/organizer for National Geographic gallery program');
console.log('    - Curator/organizer for TIME gallery program');
console.log('    - Curator, HUG photography publication');
console.log('    - Co-curator with Mike Yamashita (NatGeo)');
