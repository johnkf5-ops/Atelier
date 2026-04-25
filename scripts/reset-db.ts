/**
 * DESTRUCTIVE: drops every table on the configured Turso DB, then rebuilds
 * the schema + seeds the default user + verifies every expected table exists.
 * Exits non-zero if verification fails so schema drift is caught immediately.
 *
 * Two guardrails required before this proceeds:
 *   1. ATELIER_IS_RESETTABLE_DB=true must be set in env. Only set this in
 *      your LOCAL .env.local — NEVER in Vercel's Production environment.
 *   2. --yes-reset-everything confirmation argv.
 *
 * Run locally:
 *   pnpm tsx scripts/reset-db.ts --yes-reset-everything
 *
 * After this exits successfully the DB is ready — no "rebuild on first HTTP
 * request" dance. Just drop → rebuild → seed → verify, all in one shot.
 */

import { config as dotenvConfig } from 'dotenv';
import { createClient } from '@libsql/client';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

dotenvConfig({ path: '.env.local' });
dotenvConfig({ path: '.env' });

const EXPECTED_TABLES = [
  'users',
  'portfolio_images',
  'style_fingerprints',
  'akb_versions',
  'extractor_turns',
  'opportunities',
  'past_recipients',
  'opportunity_logos',
  'runs',
  'run_events',
  'run_matches',
  'run_event_cursors',
  'drafted_packages',
  'dossiers',
  'run_opportunities',
  'untrusted_sources',
  '_migrations',
];

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
  console.log(`About to drop + rebuild all tables on Turso DB at: ${host}`);
  console.log('Proceeding in 3 seconds — Ctrl-C to abort.');
  await new Promise((r) => setTimeout(r, 3000));

  const db = createClient({
    url,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });

  // 1. DROP every existing table
  const tables = (
    await db.execute(
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`,
    )
  ).rows.map((r) => String((r as unknown as { name: string }).name));
  await db.execute('PRAGMA foreign_keys = OFF');
  for (const t of tables) {
    await db.execute(`DROP TABLE IF EXISTS ${t}`);
  }
  await db.execute('PRAGMA foreign_keys = ON');
  console.log(`[reset] dropped ${tables.length} table${tables.length === 1 ? '' : 's'}`);

  // 2. REBUILD from canonical schema.sql
  const sqlPath = path.join(process.cwd(), 'lib', 'db', 'schema.sql');
  const sql = await readFile(sqlPath, 'utf-8');
  const statements = splitStatements(sql);
  for (const stmt of statements) {
    await db.execute(stmt);
  }
  console.log(`[reset] applied schema.sql (${statements.length} statements)`);

  // 3. SEED default user
  await db.execute({
    sql: 'INSERT OR IGNORE INTO users (id, name) VALUES (?, ?)',
    args: [1, 'Default User'],
  });
  console.log('[reset] seeded users(id=1)');

  // 4. VERIFY every expected table is present — fail loudly if not
  const present = new Set(
    (
      await db.execute(
        `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`,
      )
    ).rows.map((r) => String((r as unknown as { name: string }).name)),
  );
  const missing = EXPECTED_TABLES.filter((t) => !present.has(t));
  if (missing.length > 0) {
    console.error(`[reset] FAILED — missing tables after rebuild: ${missing.join(', ')}`);
    console.error('schema.sql and EXPECTED_TABLES have drifted. Fix schema.sql.');
    process.exit(1);
  }
  console.log(`[reset] verified ${EXPECTED_TABLES.length} tables present`);
  console.log('[reset] DONE — DB is ready. No server restart required.');
}

function splitStatements(sql: string): string[] {
  return sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((s) => s.replace(/^\s*--.*$/gm, '').trim())
    .filter((s) => s.length > 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
