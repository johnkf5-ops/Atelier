import { getDb } from '@/lib/db/client';

export const dynamic = 'force-dynamic';

export async function GET() {
  const db = getDb();
  const tables = (
    await db.execute(
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
    )
  ).rows.map((r) => String(r.name));
  const indexes = (
    await db.execute(
      `SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
    )
  ).rows.map((r) => String(r.name));
  let migrations: string[] = [];
  try {
    migrations = (await db.execute(`SELECT name FROM _migrations ORDER BY applied_at`)).rows.map((r) =>
      String(r.name),
    );
  } catch {
    // _migrations may not exist on very old installs
    migrations = [];
  }
  return Response.json({ tables, indexes, migrations });
}
