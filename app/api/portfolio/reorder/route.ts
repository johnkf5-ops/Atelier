import { NextRequest } from 'next/server';
import { ensureDbReady, getDb } from '@/lib/db/client';
import { getCurrentUserId } from '@/lib/auth/user';
import { withApiErrorHandling } from '@/lib/api/response';
import { z } from 'zod';

export const runtime = 'nodejs';

const Body = z.object({
  order: z.array(z.number().int()).min(1),
});

export const POST = withApiErrorHandling(async (req: NextRequest) => {
  await ensureDbReady();
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) {
    return Response.json({ error: parsed.error.message }, { status: 400 });
  }
  const userId = getCurrentUserId();
  const db = getDb();
  const stmts = parsed.data.order.map((id, idx) => ({
    sql: 'UPDATE portfolio_images SET ordinal = ? WHERE id = ? AND user_id = ?',
    args: [idx, id, userId],
  }));
  await db.batch(stmts, 'write');
  return Response.json({ updated: parsed.data.order.length });
});
