import { NextRequest } from 'next/server';
import { getDb } from '@/lib/db/client';
import { getCurrentUserId } from '@/lib/auth/user';
import {
  ingestImage,
  getPortfolioCount,
  getNextOrdinal,
  PORTFOLIO_CAP,
} from '@/lib/portfolio/ingest';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const userId = getCurrentUserId();

  const currentCount = await getPortfolioCount(userId);
  const remaining = PORTFOLIO_CAP - currentCount;
  if (remaining <= 0) {
    return Response.json(
      { error: `portfolio cap reached (${PORTFOLIO_CAP} images)` },
      { status: 400 },
    );
  }

  const formData = await req.formData();
  const files = formData.getAll('files').filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    return Response.json({ error: 'no files in request' }, { status: 400 });
  }

  let nextOrdinal = await getNextOrdinal(userId);
  const inserted: Array<{ id: number; filename: string; thumb_url: string }> = [];
  const errors: Array<{ filename: string; error: string }> = [];

  for (const file of files.slice(0, remaining)) {
    try {
      const buf = Buffer.from(await file.arrayBuffer());
      const r = await ingestImage(userId, { buffer: buf, filename: file.name }, nextOrdinal);
      if (!r.duplicate) nextOrdinal++;
      inserted.push({ id: r.id, filename: r.filename, thumb_url: r.thumb_url });
    } catch (err) {
      errors.push({ filename: file.name, error: (err as Error).message });
    }
  }

  const total = await getPortfolioCount(userId);
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
