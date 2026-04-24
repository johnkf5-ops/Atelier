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
}

function splitStatements(sql: string): string[] {
  return sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((s) => s.replace(/^\s*--.*$/gm, '').trim())
    .filter((s) => s.length > 0);
}
