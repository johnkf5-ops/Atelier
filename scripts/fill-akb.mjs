import { createClient } from '@libsql/client';
import { readFileSync } from 'fs';
const env = readFileSync('.env.local', 'utf-8');
const parsed = Object.fromEntries(env.split('\n').filter(l => l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i+1).replace(/^"(.*)"$/, '$1')]; }));
const db = createClient({ url: parsed.TURSO_DATABASE_URL, authToken: parsed.TURSO_AUTH_TOKEN });

const current = (await db.execute({ sql: `SELECT id, user_id, version, json FROM akb_versions ORDER BY id DESC LIMIT 1`, args: [] })).rows[0];
const data = JSON.parse(current.json);

const filled = {
  identity: {
    legal_name: 'Jonathan Knopf',
    public_name: 'John Knopf',
    citizenship: ['United States'],
    home_base: { city: 'Las Vegas', state: 'Nevada', country: 'United States' },
    year_of_birth: data.identity?.year_of_birth ?? 1983,
  },
  practice: {
    primary_medium: 'Landscape photography',
    secondary_media: ['Fine art print', 'NFT / digital art'],
    process_description: 'John strives to create his image within the camera utilizing minimal post-processing software, maintaining the integrity of the original scene. Once the digital process is complete, the images are printed using high-quality materials and traditional printing methods that have stood the test of time.',
    materials_and_methods: ['Sony camera systems', 'Adobe Lightroom', 'Large-format archival pigment print', 'Long-exposure', 'HDR composite'],
  },
  education: [{ institution: 'Self-taught' }],
  bodies_of_work: [
    { title: 'American West landscapes', years: '2010–present', description: 'Slot canyons (Antelope), arches (Delicate Arch), Palouse rolling hills, Saguaro desert.' },
    { title: 'Pacific waterfalls and tropics', years: '2012–present', description: 'Hawaiian waterfalls and bamboo forest, Bahamas coastal vernacular.' },
    { title: 'Global cityscapes', years: '2015–present', description: 'Amsterdam, Lisbon, Dubai (Burj Khalifa), Mediterranean rooftop blue-hour and light-trail compositions.' },
  ],
  exhibitions: [
    { title: 'Venice Biennale', venue: 'Venice Biennale', location: 'Venice, Italy', year: 2022, type: 'group' },
    { title: 'Art Basel', venue: 'Art Basel', location: 'Miami Beach, FL', year: 2022, type: 'art-fair' },
    { title: 'Dubai exhibition', venue: 'Dubai exhibition', location: 'Dubai, UAE', year: 2023, type: 'group' },
    { title: 'John Knopf Gallery (Stratosphere)', venue: 'John Knopf Gallery', location: 'Las Vegas, NV', year: 2012, type: 'solo' },
    { title: 'John Knopf Gallery (Wayzata)', venue: 'John Knopf Gallery', location: 'Minneapolis, MN', year: 2017, type: 'solo' },
  ],
  publications: [
    { publisher: 'National Geographic', year: 2020 },
    { publisher: 'TIME Magazine', title: 'TIMEPieces NFT collection', year: 2022 },
    { publisher: 'Red Bull', year: 2019 },
    { publisher: 'USA Today', year: 2018 },
    { publisher: 'Billboard', year: 2021 },
    { publisher: 'Google', year: 2020 },
  ],
  awards_and_honors: [
    { name: 'Emmy nomination', year: 2018 },
  ],
  collections: [
    { name: 'TIME Magazine TIMEPieces NFT collection', type: 'corporate' },
  ],
  representation: [
    { gallery: 'John Knopf Gallery (Stratosphere)', location: 'Las Vegas, NV', since_year: 2012 },
    { gallery: 'John Knopf Gallery (Wayzata)', location: 'Minneapolis, MN', since_year: 2017 },
  ],
  career_stage: 'established',
  intent: {
    statement: "The planet is a beautiful place and we can't lose sight of that — we have to do whatever we can to protect it.",
    influences: ['Ansel Adams', 'Peter Lik', 'Galen Rowell', 'Clyde Butcher', 'QT Luong', 'Ian Plant', 'Michael Frye'],
    aspirations: ['Get work into a museum collection', 'Secure a state-level artist fellowship', 'Publish a monograph of the American West work'],
  },
  source_provenance: {
    'identity.legal_name': 'manual',
    'identity.public_name': 'manual',
    'identity.citizenship': 'manual',
    'identity.home_base.city': 'manual',
    'identity.home_base.state': 'manual',
    'identity.home_base.country': 'manual',
    'identity.year_of_birth': 'interview',
    'practice.primary_medium': 'manual',
    'practice.secondary_media': 'manual',
    'practice.process_description': 'manual',
    'practice.materials_and_methods': 'manual',
    'education': 'interview',
    'bodies_of_work': 'manual_terminal_fill',
    'exhibitions': 'manual_terminal_fill',
    'publications': 'manual_terminal_fill',
    'awards_and_honors': 'manual_terminal_fill',
    'collections': 'manual_terminal_fill',
    'representation': 'manual_terminal_fill',
    'career_stage': 'interview',
    'intent.statement': 'interview',
    'intent.influences': 'manual_terminal_fill',
    'intent.aspirations': 'manual_terminal_fill',
  },
};

const newVersion = current.version + 1;
await db.execute({
  sql: `INSERT INTO akb_versions (user_id, version, json, source, created_at) VALUES (?, ?, ?, ?, unixepoch())`,
  args: [current.user_id, newVersion, JSON.stringify(filled), 'manual_bulk_fill_via_terminal_v2'],
});

console.log(`Wrote AKB v${newVersion}.`);
