import { getCurrentUserId } from '@/lib/auth/user';
import { loadLatestAkb } from '@/lib/akb/persistence';

export const dynamic = 'force-dynamic';

export async function GET() {
  const userId = getCurrentUserId();
  const { akb, version, id } = await loadLatestAkb(userId);
  if (version === 0) return Response.json({ akb: null, version: 0 });
  return Response.json({ akb, version, id });
}
