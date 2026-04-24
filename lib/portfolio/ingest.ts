import { getDb } from '@/lib/db/client';
import { putBlob } from '@/lib/storage/blobs';
import { preprocessImage } from '@/lib/images/preprocess';

export type IngestedImage = {
  id: number;
  filename: string;
  thumb_url: string;
  blob_url: string;
  width: number;
  height: number;
  hash: string;
  duplicate: boolean;
};

export type IngestSource = {
  buffer: Buffer;
  filename: string;
};

export const PORTFOLIO_CAP = 100;

export async function getPortfolioCount(userId: number): Promise<number> {
  const db = getDb();
  const r = await db.execute({
    sql: 'SELECT COUNT(*) as n FROM portfolio_images WHERE user_id = ?',
    args: [userId],
  });
  return Number(r.rows[0]?.n ?? 0);
}

export async function getNextOrdinal(userId: number): Promise<number> {
  const db = getDb();
  const r = await db.execute({
    sql: 'SELECT COALESCE(MAX(ordinal), -1) as max_ord FROM portfolio_images WHERE user_id = ?',
    args: [userId],
  });
  return Number(r.rows[0]?.max_ord ?? -1) + 1;
}

export async function existingHashes(userId: number): Promise<Set<string>> {
  const db = getDb();
  const r = await db.execute({
    sql: `SELECT blob_pathname FROM portfolio_images WHERE user_id = ?`,
    args: [userId],
  });
  // blob_pathname is "originals/<hash>.jpg" — extract the hash
  const out = new Set<string>();
  for (const row of r.rows) {
    const m = String(row.blob_pathname).match(/originals\/([0-9a-f]{64})\.jpg/);
    if (m) out.add(m[1]);
  }
  return out;
}

/**
 * Idempotent per-image ingest: preprocesses → uploads both blob variants →
 * inserts row. If an image with the same SHA-256 already exists for this user,
 * returns the existing row marked `duplicate: true` and skips blob/DB writes.
 */
export async function ingestImage(
  userId: number,
  source: IngestSource,
  ordinal: number,
): Promise<IngestedImage> {
  const db = getDb();
  const pre = await preprocessImage(source.buffer);

  // Check duplicate before doing the blob writes — saves bandwidth + Vercel Blob ops
  const dup = await db.execute({
    sql: `SELECT id, filename, thumb_url, blob_url, width, height
          FROM portfolio_images
          WHERE user_id = ? AND blob_pathname = ?`,
    args: [userId, `originals/${pre.hash}.jpg`],
  });
  if (dup.rows.length > 0) {
    const r = dup.rows[0];
    return {
      id: Number(r.id),
      filename: r.filename as string,
      thumb_url: r.thumb_url as string,
      blob_url: r.blob_url as string,
      width: Number(r.width),
      height: Number(r.height),
      hash: pre.hash,
      duplicate: true,
    };
  }

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
      source.filename,
      origRes.pathname,
      thumbRes.pathname,
      origRes.url,
      thumbRes.url,
      pre.width,
      pre.height,
      pre.exif ? JSON.stringify(pre.exif) : null,
      ordinal,
    ],
  });

  return {
    id: Number(result.rows[0]?.id),
    filename: source.filename,
    thumb_url: thumbRes.url,
    blob_url: origRes.url,
    width: pre.width,
    height: pre.height,
    hash: pre.hash,
    duplicate: false,
  };
}
