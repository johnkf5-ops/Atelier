import { NextRequest } from 'next/server';
import { getDb } from '@/lib/db/client';
import { putBlob } from '@/lib/storage/blobs';
import { getCurrentUserId } from '@/lib/auth/user';
import { preprocessImage } from '@/lib/images/preprocess';

export const runtime = 'nodejs';
export const maxDuration = 60;

const MAX_IMAGES = 100;

export async function POST(req: NextRequest) {
  const userId = getCurrentUserId();
  const db = getDb();

  const existing = await db.execute({
    sql: 'SELECT COUNT(*) as n FROM portfolio_images WHERE user_id = ?',
    args: [userId],
  });
  const currentCount = Number(existing.rows[0]?.n ?? 0);

  const formData = await req.formData();
  const files = formData.getAll('files').filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    return Response.json({ error: 'no files in request' }, { status: 400 });
  }

  const remaining = MAX_IMAGES - currentCount;
  if (remaining <= 0) {
    return Response.json(
      { error: `portfolio cap reached (${MAX_IMAGES} images)` },
      { status: 400 },
    );
  }

  const ordinalRow = await db.execute({
    sql: 'SELECT COALESCE(MAX(ordinal), -1) as max_ord FROM portfolio_images WHERE user_id = ?',
    args: [userId],
  });
  let nextOrdinal = Number(ordinalRow.rows[0]?.max_ord ?? -1) + 1;

  const inserted: Array<{ id: number; filename: string; thumb_url: string }> = [];
  const errors: Array<{ filename: string; error: string }> = [];

  for (const file of files.slice(0, remaining)) {
    try {
      const buf = Buffer.from(await file.arrayBuffer());
      const pre = await preprocessImage(buf);
      const originalKey = `originals/${pre.hash}.jpg`;
      const thumbKey = `thumbs/${pre.hash}.jpg`;
      const [origRes, thumbRes] = await Promise.all([
        putBlob(originalKey, pre.original, 'image/jpeg'),
        putBlob(thumbKey, pre.thumb, 'image/jpeg'),
      ]);

      const result = await db.execute({
        sql: `INSERT INTO portfolio_images
              (user_id, filename, blob_pathname, thumb_pathname, blob_url, thumb_url,
               width, height, exif_json, ordinal)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              RETURNING id`,
        args: [
          userId,
          file.name,
          origRes.pathname,
          thumbRes.pathname,
          origRes.url,
          thumbRes.url,
          pre.width,
          pre.height,
          pre.exif ? JSON.stringify(pre.exif) : null,
          nextOrdinal++,
        ],
      });
      const id = Number(result.rows[0]?.id);
      inserted.push({ id, filename: file.name, thumb_url: thumbRes.url });
    } catch (err) {
      errors.push({ filename: file.name, error: (err as Error).message });
    }
  }

  const totalRow = await db.execute({
    sql: 'SELECT COUNT(*) as n FROM portfolio_images WHERE user_id = ?',
    args: [userId],
  });
  const total = Number(totalRow.rows[0]?.n ?? 0);

  return Response.json({ inserted, errors, total });
}

export async function GET() {
  const userId = getCurrentUserId();
  const db = getDb();
  const r = await db.execute({
    sql: `SELECT id, filename, thumb_url, blob_url, width, height, ordinal
          FROM portfolio_images
          WHERE user_id = ?
          ORDER BY ordinal ASC`,
    args: [userId],
  });
  return Response.json({ images: r.rows, total: r.rows.length });
}
