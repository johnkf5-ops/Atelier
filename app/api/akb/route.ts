import { getCurrentUserId } from '@/lib/auth/user';
import { loadLatestAkb } from '@/lib/akb/persistence';
import { detectGaps } from '@/lib/akb/gaps';

export const dynamic = 'force-dynamic';

export async function GET() {
  const userId = getCurrentUserId();
  const { akb, version, id } = await loadLatestAkb(userId);
  const gaps = detectGaps(akb);
  return Response.json({ akb, version, id, gaps });
}
