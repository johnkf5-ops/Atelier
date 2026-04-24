import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { getDb } from './client';

let _ran = false;

/**
 * Allows ensureDbReady() to force re-application after it detects the DB
 * has been wiped externally (e.g. `pnpm db:reset` against a running dev
 * server). schema.sql uses CREATE TABLE IF NOT EXISTS and the migration
 * file runner checks the _migrations table, so re-running is idempotent.
 */
export function resetMigrationsMemo(): void {
  _ran = false;
}

export async function runMigrations(): Promise<void> {
  if (_ran) return;
  _ran = true;
  const db = getDb();

  // 1) Apply base schema.sql (idempotent CREATE TABLE IF NOT EXISTS).
  const sqlPath = path.join(process.cwd(), 'lib', 'db', 'schema.sql');
  const sql = await readFile(sqlPath, 'utf-8');
  const statements = splitStatements(sql);
  for (const stmt of statements) {
    await db.execute(stmt);
  }

  // 2) Apply any guarded migrations that CREATE TABLE IF NOT EXISTS can't
  // cover (column drops, constraint relaxations, etc.).
  await ensureRunEventsRunIdNullable();

  // 3) Apply ordered migration files from lib/db/migrations/. Each filename
  // sorted lexicographically (e.g. 001_*.sql, 002_*.sql) runs once and is
  // recorded in the _migrations table.
  await applyMigrationFiles();
}

async function applyMigrationFiles(): Promise<void> {
  const db = getDb();
  const dir = path.join(process.cwd(), 'lib', 'db', 'migrations');
  let files: string[];
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  } catch {
    return;
  }
  if (files.length === 0) return;

  const appliedRows = await db.execute('SELECT name FROM _migrations');
  const applied = new Set(appliedRows.rows.map((r) => String(r.name)));

  for (const name of files) {
    if (applied.has(name)) continue;
    const content = await readFile(path.join(dir, name), 'utf-8');
    const stmts = splitStatements(content);
    for (const stmt of stmts) {
      try {
        await db.execute(stmt);
      } catch (err) {
        // ALTER TABLE ADD COLUMN fails with "duplicate column" if the column
        // already exists from a prior partial run. Swallow that specific case
        // so the migration remains idempotent even on post-failure re-runs.
        const msg = (err as Error).message ?? '';
        if (/duplicate column name/i.test(msg)) continue;
        throw new Error(`migration ${name} failed on: ${stmt.slice(0, 80)} — ${msg}`);
      }
    }
    await db.execute({
      sql: 'INSERT INTO _migrations (name) VALUES (?)',
      args: [name],
    });
    console.log(`[migrations] applied ${name}`);
  }
}

async function ensureRunEventsRunIdNullable(): Promise<void> {
  const db = getDb();
  const cols = await db.execute("PRAGMA table_info('run_events')");
  const runIdCol = cols.rows.find((r) => r.name === 'run_id');
  if (!runIdCol) return; // table will be created fresh by the schema.sql above
  // SQLite PRAGMA: notnull = 1 if NOT NULL, 0 otherwise
  if (Number(runIdCol.notnull) === 0) return; // already nullable

  // Recreate the table with the relaxed constraint, preserving rows.
  await db.execute('ALTER TABLE run_events RENAME TO run_events_old');
  await db.execute(`CREATE TABLE run_events (
    id INTEGER PRIMARY KEY,
    run_id INTEGER REFERENCES runs(id),
    agent TEXT NOT NULL,
    kind TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  )`);
  await db.execute(
    `INSERT INTO run_events (id, run_id, agent, kind, payload_json, created_at)
     SELECT id, run_id, agent, kind, payload_json, created_at FROM run_events_old`,
  );
  await db.execute('DROP TABLE run_events_old');
}

function splitStatements(sql: string): string[] {
  return sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((s) => s.replace(/^\s*--.*$/gm, '').trim())
    .filter((s) => s.length > 0);
}
