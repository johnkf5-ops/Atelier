/**
 * Archive runs 2, 3, 4 to a local JSON file (gitignored), then delete
 * them from Turso so only run 1 remains in the live demo. The archive
 * captures every row across every related table so the data isn't lost
 * — just removed from the live deployment.
 *
 * Run ONCE. Idempotent: re-runs will archive whatever's left under those
 * IDs (typically nothing on a second run) and the deletes are no-ops.
 */
import { createClient } from '@libsql/client';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const RUNS_TO_DELETE = [2, 3, 4];

const env = readFileSync('.env.local', 'utf-8');
const e = Object.fromEntries(
  env.split('\n').filter((l) => l.includes('=')).map((l) => {
    const i = l.indexOf('=');
    return [l.slice(0, i), l.slice(i + 1).replace(/^"(.*)"$/, '$1')];
  }),
);
const db = createClient({ url: e.TURSO_DATABASE_URL, authToken: e.TURSO_AUTH_TOKEN });

async function rows(sql, args = []) {
  return (await db.execute({ sql, args })).rows.map((r) => ({ ...r }));
}

const placeholder = RUNS_TO_DELETE.map(() => '?').join(',');

console.log(`Archiving runs ${RUNS_TO_DELETE.join(', ')}...`);

const archive = {
  archived_at: new Date().toISOString(),
  archived_run_ids: RUNS_TO_DELETE,
  runs: await rows(`SELECT * FROM runs WHERE id IN (${placeholder})`, RUNS_TO_DELETE),
  run_event_cursors: await rows(
    `SELECT * FROM run_event_cursors WHERE run_id IN (${placeholder})`,
    RUNS_TO_DELETE,
  ),
  run_events: await rows(
    `SELECT * FROM run_events WHERE run_id IN (${placeholder})`,
    RUNS_TO_DELETE,
  ),
  run_opportunities: await rows(
    `SELECT * FROM run_opportunities WHERE run_id IN (${placeholder})`,
    RUNS_TO_DELETE,
  ),
  run_matches: await rows(
    `SELECT * FROM run_matches WHERE run_id IN (${placeholder})`,
    RUNS_TO_DELETE,
  ),
  drafted_packages: await rows(
    `SELECT dp.* FROM drafted_packages dp
     JOIN run_matches rm ON rm.id = dp.run_match_id
     WHERE rm.run_id IN (${placeholder})`,
    RUNS_TO_DELETE,
  ),
  dossiers: await rows(`SELECT * FROM dossiers WHERE run_id IN (${placeholder})`, RUNS_TO_DELETE),
};

const counts = Object.fromEntries(
  Object.entries(archive)
    .filter(([k]) => Array.isArray(archive[k]))
    .map(([k, v]) => [k, v.length]),
);
console.log('row counts archived:', counts);

mkdirSync('local-runs-archive', { recursive: true });
const path = join(
  'local-runs-archive',
  `runs-${RUNS_TO_DELETE.join('-')}-archive-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
);
writeFileSync(path, JSON.stringify(archive, null, 2));
console.log(`archive written to ${path} (${(JSON.stringify(archive).length / 1024).toFixed(1)} KB)`);

console.log('\nDeleting from Turso (bottom-up FK order)...');

// Bottom-up: drafted_packages → run_matches → run_opportunities → dossiers
//   → run_events → run_event_cursors → runs.
const deletions = [
  [
    'drafted_packages',
    `DELETE FROM drafted_packages WHERE run_match_id IN (
       SELECT id FROM run_matches WHERE run_id IN (${placeholder})
     )`,
  ],
  ['run_matches', `DELETE FROM run_matches WHERE run_id IN (${placeholder})`],
  ['run_opportunities', `DELETE FROM run_opportunities WHERE run_id IN (${placeholder})`],
  ['dossiers', `DELETE FROM dossiers WHERE run_id IN (${placeholder})`],
  ['run_events', `DELETE FROM run_events WHERE run_id IN (${placeholder})`],
  ['run_event_cursors', `DELETE FROM run_event_cursors WHERE run_id IN (${placeholder})`],
  ['rate_limits_run_start', `DELETE FROM rate_limits_run_start WHERE run_id IN (${placeholder})`],
  ['runs', `DELETE FROM runs WHERE id IN (${placeholder})`],
];

for (const [name, sql] of deletions) {
  const r = await db.execute({ sql, args: RUNS_TO_DELETE });
  console.log(`  ${name}: ${r.rowsAffected} rows deleted`);
}

console.log('\nFinal state:');
const remaining = await rows(`SELECT id, status FROM runs ORDER BY id`);
console.log('runs remaining:', remaining);
