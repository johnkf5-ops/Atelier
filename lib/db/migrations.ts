import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { getDb } from './client';

let _ran = false;

export async function runMigrations(): Promise<void> {
  if (_ran) return;
  _ran = true;
  const db = getDb();
  const sqlPath = path.join(process.cwd(), 'lib', 'db', 'schema.sql');
  const sql = await readFile(sqlPath, 'utf-8');
  const statements = splitStatements(sql);
  for (const stmt of statements) {
    await db.execute(stmt);
  }

  // Post-DDL guarded migrations for column-constraint changes that
  // CREATE TABLE IF NOT EXISTS can't apply to an existing table.
  await ensureRunEventsRunIdNullable();
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
