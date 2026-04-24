import { NextRequest } from 'next/server';
import { z } from 'zod';
import { ensureDbReady } from '@/lib/db/client';
import { getCurrentUserId } from '@/lib/auth/user';
import { loadLatestAkb, saveAkb } from '@/lib/akb/persistence';
import { mergeAkb } from '@/lib/akb/merge';
import { PartialArtistKnowledgeBase } from '@/lib/schemas/akb';
import { withApiErrorHandling } from '@/lib/api/response';

export const runtime = 'nodejs';

const Body = z.object({
  patch: PartialArtistKnowledgeBase,
});

export const POST = withApiErrorHandling(async (req: NextRequest) => {
  await ensureDbReady();
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) {
    return Response.json({ error: parsed.error.message }, { status: 400 });
  }
  const userId = getCurrentUserId();
  const { akb } = await loadLatestAkb(userId);
  const { merged, changedFields } = mergeAkb(akb, parsed.data.patch, 'manual');
  if (changedFields.length === 0) {
    return Response.json({ saved: null, akb: merged, changed: [] });
  }
  const saved = await saveAkb(userId, merged, 'manual');
  return Response.json({ saved, akb: merged, changed: changedFields });
});
