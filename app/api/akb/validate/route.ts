import { getCurrentUserId } from '@/lib/auth/user';
import { loadLatestAkb } from '@/lib/akb/persistence';
import { ArtistKnowledgeBase } from '@/lib/schemas/akb';

export const dynamic = 'force-dynamic';

/**
 * HARD gate helper for /review and /api/akb/finalize. Runs the strict
 * ArtistKnowledgeBase.safeParse on the latest AKB. /review disables its
 * "Continue to dossier" button when valid=false and surfaces the issues
 * inline at the field paths.
 */
export async function GET() {
  const userId = getCurrentUserId();
  const { akb, version } = await loadLatestAkb(userId);
  if (version === 0) {
    return Response.json({
      valid: false,
      version: 0,
      issues: [{ path: '', message: 'no Knowledge Base yet' }],
    });
  }
  const r = ArtistKnowledgeBase.safeParse(akb);
  if (r.success) {
    return Response.json({ valid: true, version, issues: [] });
  }
  return Response.json({
    valid: false,
    version,
    issues: r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
  });
}
