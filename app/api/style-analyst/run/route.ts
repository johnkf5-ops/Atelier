import { ensureDbReady, getDb } from '@/lib/db/client';
import { getCurrentUserId } from '@/lib/auth/user';
import { analyzePortfolio } from '@/lib/agents/style-analyst';
import { withApiErrorHandling } from '@/lib/api/response';

export const runtime = 'nodejs';
export const maxDuration = 300;

export const POST = withApiErrorHandling(async () => {
  await ensureDbReady();
  const userId = getCurrentUserId();
  const db = getDb();

  const imgs = await db.execute({
    sql: `SELECT id, thumb_url FROM portfolio_images WHERE user_id = ? ORDER BY ordinal ASC`,
    args: [userId],
  });
  const images = imgs.rows.map((r) => ({
    id: Number(r.id),
    thumb_url: r.thumb_url as string,
  }));
  if (images.length < 20) {
    return Response.json(
      { error: `need at least 20 images; have ${images.length}` },
      { status: 400 },
    );
  }

  const t0 = Date.now();
  const fingerprint = await analyzePortfolio(images);
  const elapsed_ms = Date.now() - t0;

  const versionRow = await db.execute({
    sql: `SELECT COALESCE(MAX(version), 0) as v FROM style_fingerprints WHERE user_id = ?`,
    args: [userId],
  });
  const version = Number(versionRow.rows[0]?.v ?? 0) + 1;

  const inserted = await db.execute({
    sql: `INSERT INTO style_fingerprints (user_id, version, json) VALUES (?, ?, ?) RETURNING id`,
    args: [userId, version, JSON.stringify(fingerprint)],
  });

  return Response.json({
    id: Number(inserted.rows[0]?.id),
    version,
    fingerprint,
    elapsed_ms,
  });
});

export const GET = withApiErrorHandling(async () => {
  await ensureDbReady();
  const userId = getCurrentUserId();
  const db = getDb();
  const r = await db.execute({
    sql: `SELECT id, version, json, created_at FROM style_fingerprints
          WHERE user_id = ? ORDER BY version DESC LIMIT 1`,
    args: [userId],
  });
  if (r.rows.length === 0) return Response.json({ fingerprint: null });
  const row = r.rows[0];
  return Response.json({
    id: Number(row.id),
    version: Number(row.version),
    fingerprint: JSON.parse(row.json as string),
    created_at: Number(row.created_at),
  });
});
