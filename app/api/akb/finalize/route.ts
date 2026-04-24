import { getCurrentUserId } from '@/lib/auth/user';
import { loadLatestAkb, saveAkb } from '@/lib/akb/persistence';

export const runtime = 'nodejs';

export async function POST() {
  const userId = getCurrentUserId();
  const { akb } = await loadLatestAkb(userId);
  const saved = await saveAkb(userId, akb, 'merge');
  return Response.json({ saved, akb });
}
