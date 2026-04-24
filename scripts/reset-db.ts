/**
 * DESTRUCTIVE: drops every table on the configured Turso DB.
 * Two guardrails required before this proceeds:
 *   1. ATELIER_IS_RESETTABLE_DB=true must be set in env. Only set this in
 *      your LOCAL .env.local — NEVER in Vercel's Production environment.
 *      A prod env containing this var + a mistaken run against the prod
 *      URL = data loss.
 *   2. --yes-reset-everything confirmation argv.
 *
 * Run locally:
 *   pnpm tsx scripts/reset-db.ts --yes-reset-everything
 *
 * On the next server boot, runMigrations() rebuilds the schema fresh.
 */

import { config as dotenvConfig } from 'dotenv';
import { createClient } from '@libsql/client';

dotenvConfig({ path: '.env.local' });
dotenvConfig({ path: '.env' });

async function main() {
  if (process.env.ATELIER_IS_RESETTABLE_DB !== 'true') {
    console.error('Refusing to reset: ATELIER_IS_RESETTABLE_DB is not set to "true".');
    console.error('This guard is ONLY set in your local .env.local — NEVER in Vercel.');
    console.error('If you are SURE you want to reset this DB, edit .env.local to add:');
    console.error('  ATELIER_IS_RESETTABLE_DB=true');
    process.exit(1);
  }

  const confirmArg = process.argv[2];
  if (confirmArg !== '--yes-reset-everything') {
    console.error('Pass --yes-reset-everything to confirm. This DROPS all tables.');
    process.exit(1);
  }

  const url = process.env.TURSO_DATABASE_URL;
  if (!url) {
    console.error('TURSO_DATABASE_URL is not set.');
    process.exit(1);
  }
  const host = new URL(url.replace(/^libsql:/, 'https:')).host;
  console.log(`About to drop all tables on Turso DB at: ${host}`);
  console.log('Proceeding in 3 seconds — Ctrl-C to abort.');
  await new Promise((r) => setTimeout(r, 3000));

  const db = createClient({
    url,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });

  // Pull table names; drop all non-sqlite_* tables.
  const tables = (
    await db.execute(
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`,
    )
  ).rows.map((r) => String((r as unknown as { name: string }).name));

  // Disable FK checks so we can DROP in any order without FK failures.
  await db.execute('PRAGMA foreign_keys = OFF');
  for (const t of tables) {
    await db.execute(`DROP TABLE IF EXISTS ${t}`);
  }
  await db.execute('PRAGMA foreign_keys = ON');
  console.log(`Dropped ${tables.length} tables.`);
  console.log('Next server boot will rebuild via runMigrations().');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
