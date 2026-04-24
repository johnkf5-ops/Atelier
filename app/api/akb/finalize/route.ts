import { ensureDbReady } from '@/lib/db/client';
import { getCurrentUserId } from '@/lib/auth/user';
import { loadLatestAkb, saveAkb } from '@/lib/akb/persistence';
import { ArtistKnowledgeBase } from '@/lib/schemas/akb';
import { withApiErrorHandling } from '@/lib/api/response';

export const runtime = 'nodejs';

/**
 * Strict parse gate — writes a new akb_versions row with source='merge'
 * ONLY if the current AKB passes ArtistKnowledgeBase.parse(). Used as the
 * "Done" action at end of /interview and as the hard boundary before
 * /review's "Continue to dossier" button.
 */
export const POST = withApiErrorHandling(async () => {
  await ensureDbReady();
  const userId = getCurrentUserId();
  const { akb, version } = await loadLatestAkb(userId);
  if (version === 0) {
    return Response.json({ error: 'no Knowledge Base yet' }, { status: 400 });
  }
  const parsed = ArtistKnowledgeBase.safeParse(akb);
  if (!parsed.success) {
    return Response.json(
      {
        error: 'Knowledge Base incomplete — missing required fields',
        issues: parsed.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      },
      { status: 400 },
    );
  }
  const saved = await saveAkb(userId, parsed.data, 'merge');
  return Response.json({ saved, akb: parsed.data });
});
