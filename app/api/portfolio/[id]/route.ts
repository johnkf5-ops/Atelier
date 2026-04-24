import { NextRequest } from 'next/server';
import { getDb } from '@/lib/db/client';
import { deleteBlob } from '@/lib/storage/blobs';
import { getCurrentUserId } from '@/lib/auth/user';

export const runtime = 'nodejs';

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const imageId = Number(id);
  if (!Number.isInteger(imageId)) {
    return Response.json({ error: 'invalid id' }, { status: 400 });
  }
  const userId = getCurrentUserId();
  const db = getDb();
  const row = await db.execute({
    sql: 'SELECT blob_pathname, thumb_pathname FROM portfolio_images WHERE id = ? AND user_id = ?',
    args: [imageId, userId],
  });
  if (row.rows.length === 0) {
    return Response.json({ error: 'not found' }, { status: 404 });
  }
  const blobPath = row.rows[0].blob_pathname as string;
  const thumbPath = row.rows[0].thumb_pathname as string;
  await db.execute({
    sql: 'DELETE FROM portfolio_images WHERE id = ? AND user_id = ?',
    args: [imageId, userId],
  });
  // Best-effort blob cleanup; don't fail the request if blob is already gone.
  await Promise.allSettled([deleteBlob(blobPath), deleteBlob(thumbPath)]);
  return Response.json({ deleted: imageId });
}
