import { ensureDbReady } from '@/lib/db/client';
import { getCurrentUserId } from '@/lib/auth/user';
import { loadLatestAkb } from '@/lib/akb/persistence';
import { detectGaps } from '@/lib/akb/gaps';
import { withApiErrorHandling } from '@/lib/api/response';

export const dynamic = 'force-dynamic';

export const GET = withApiErrorHandling(async () => {
  await ensureDbReady();
  const userId = getCurrentUserId();
  const { akb, version, id } = await loadLatestAkb(userId);
  const gaps = detectGaps(akb);
  return Response.json({ akb, version, id, gaps });
});
