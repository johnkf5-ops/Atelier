import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { getDb } from './client';

let _ran = false;

/**
 * Canonical list of tables the app expects to exist after bootstrap.
 * Exported so `pnpm db:reset` (scripts/reset-db.ts) can verify every
 * table is present after rebuild and fail loudly if one is missing.
 *
 * When you add a table to lib/db/schema.sql, append it here — or the
 * tests/smoke/db-bootstrap.test.ts assertions will fail on CI.
 */
export const EXPECTED_TABLES = [
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
  '_migrations',
] as const;

/**
 * Allows `ensureDbReady()` to force re-application after it detects the DB
 * has been wiped externally (e.g. `pnpm db:reset` against a running dev
 * server). schema.sql is entirely CREATE TABLE / CREATE INDEX IF NOT EXISTS,
 * so re-running is a no-op on a healthy DB and a full rebuild on a wiped one.
 */
export function resetMigrationsMemo(): void {
  _ran = false;
}

/**
 * ONE source of truth: apply lib/db/schema.sql. Every statement is
 * idempotent. No file-glob migration runner, no separate .sql files to
 * forget — schema.sql is the whole story (see lib/db/CHANGELOG.md for
 * the history of what changed when).
 *
 * Logs every statement count + a sample of the first statement for
 * visibility on boot.
 */
export async function runMigrations(): Promise<void> {
  if (_ran) return;
  _ran = true;
  const db = getDb();

  const sqlPath = path.join(process.cwd(), 'lib', 'db', 'schema.sql');
  const sql = await readFile(sqlPath, 'utf-8');
  const statements = splitStatements(sql);
  console.log(`[migrations] applying schema.sql — ${statements.length} statements`);
  for (const stmt of statements) {
    try {
      await db.execute(stmt);
    } catch (err) {
      const msg = (err as Error).message ?? '';
      // Historical runs of this DB may have had an unsupported ADD COLUMN
      // that now matches the canonical schema — swallow the duplicate-column
      // case so re-applying stays idempotent.
      if (/duplicate column name/i.test(msg)) continue;
      throw new Error(
        `schema statement failed: ${stmt.slice(0, 120)} — ${msg}`,
      );
    }
  }
  console.log('[migrations] schema.sql applied');
}

/**
 * Verify every expected table exists. Used after bootstrap to fail-fast
 * instead of surfacing as a 500 on the first route that hits a missing table.
 * Returns the list of missing tables (empty array = healthy).
 */
export async function verifyAllTables(): Promise<string[]> {
  const db = getDb();
  const r = await db.execute(
    `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`,
  );
  const present = new Set(r.rows.map((row) => String((row as unknown as { name: string }).name)));
  return EXPECTED_TABLES.filter((t) => !present.has(t));
}

function splitStatements(sql: string): string[] {
  return sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((s) => s.replace(/^\s*--.*$/gm, '').trim())
    .filter((s) => s.length > 0);
}
