import { NextRequest } from 'next/server';
import { ensureDbReady, getDb } from '@/lib/db/client';
import { EXPECTED_TABLES, resetMigrationsMemo, runMigrations, verifyAllTables } from '@/lib/db/migrations';
import { withApiErrorHandling } from '@/lib/api/response';

export const runtime = 'nodejs';

/**
 * Dev-only DB reset. Guarded by ATELIER_IS_RESETTABLE_DB=true — the same
 * env flag that gates `pnpm tsx scripts/reset-db.ts`. Set this in
 * .env.local NEVER in Vercel Production.
 *
 * Drops every table, re-applies lib/db/schema.sql, re-seeds users(id=1),
 * and verifies every expected table exists before returning. Replaces
 * the "open a terminal, type a command, restart dev, reload incognito"
 * cycle with a single HTTP POST from a dev admin button.
 *
 * Intentionally NOT wrapped in the permissions the rest of the API
 * guards — if the env flag is absent, returns 403 without touching
 * anything. This is the full authorization model.
 */
export const POST = withApiErrorHandling(async (_req: NextRequest) => {
  if (process.env.ATELIER_IS_RESETTABLE_DB !== 'true') {
    return Response.json(
      { error: 'DB reset not enabled — set ATELIER_IS_RESETTABLE_DB=true in .env.local' },
      { status: 403 },
    );
  }

  const db = getDb();

  // DROP every existing table.
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

  // Force the in-memory "migrations already ran" flag to forget.
  resetMigrationsMemo();

  // Re-apply schema. ensureDbReady also seeds the default user + re-verifies.
  await runMigrations();
  await ensureDbReady();

  const missing = await verifyAllTables();
  if (missing.length > 0) {
    return Response.json(
      {
        error: 'reset succeeded but schema verification failed — schema.sql and EXPECTED_TABLES drift',
        missing,
      },
      { status: 500 },
    );
  }

  return Response.json({
    reset: true,
    dropped: tables.length,
    tables_present: EXPECTED_TABLES.length,
  });
});
