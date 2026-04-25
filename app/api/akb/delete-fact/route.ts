import { NextRequest } from 'next/server';
import { z } from 'zod';
import { ensureDbReady } from '@/lib/db/client';
import { getCurrentUserId } from '@/lib/auth/user';
import { loadLatestAkb, saveAkb } from '@/lib/akb/persistence';
import { addUntrustedSource } from '@/lib/db/queries/untrusted-sources';
import { withApiErrorHandling } from '@/lib/api/response';

export const runtime = 'nodejs';

/**
 * Delete a single fact from the user's AKB. Supports two shapes:
 *
 *   { path: 'awards_and_honors', index: 0 }
 *     Removes the entry at the given array index.
 *
 *   { path: 'identity.public_name' }
 *     Clears a scalar field (sets to '' or null per type).
 *
 * Optional `untrust_source: true` flag also adds the matching
 * `source_provenance[path]` URL (if any) to the user's untrusted-sources
 * list so future auto-discover runs skip it. WALKTHROUGH Note 10.
 *
 * Writes a new akb_versions row with source='manual'. The new version
 * becomes the latest, beating any future re-ingest attempts at the same
 * field via the existing manual-vs-ingested precedence in mergeAkb.
 */

const Body = z.object({
  path: z.string().min(1),
  index: z.number().int().min(0).optional(),
  untrust_source: z.boolean().optional(),
});

export const POST = withApiErrorHandling(async (req: NextRequest) => {
  await ensureDbReady();
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) {
    return Response.json({ error: parsed.error.message }, { status: 400 });
  }
  const userId = getCurrentUserId();
  const { akb, version } = await loadLatestAkb(userId);
  if (version === 0) {
    return Response.json({ error: 'no Knowledge Base yet' }, { status: 400 });
  }

  // Optionally untrust the source URL recorded for this fact, BEFORE the
  // delete clears the provenance entry.
  if (parsed.data.untrust_source) {
    const provKey =
      parsed.data.index !== undefined
        ? `${parsed.data.path}[${parsed.data.index}]`
        : parsed.data.path;
    const sourceProv = (akb as { source_provenance?: Record<string, string> }).source_provenance;
    const prov = sourceProv?.[provKey] ?? sourceProv?.[parsed.data.path];
    if (prov && prov.startsWith('ingested:')) {
      const url = prov.slice('ingested:'.length);
      await addUntrustedSource(userId, url, `Removed by user from ${provKey}`);
    }
  }

  // Apply the delete to a deep clone of the AKB, then save.
  const next = JSON.parse(JSON.stringify(akb)) as Record<string, unknown>;
  const removed = applyDelete(next, parsed.data.path, parsed.data.index);
  if (!removed) {
    return Response.json({ error: `path ${parsed.data.path} not found` }, { status: 400 });
  }

  const saved = await saveAkb(userId, next as typeof akb, 'manual');
  return Response.json({ saved, akb: next });
});

/**
 * Walks the dot-path on `obj` and either splices out an array index or
 * clears a scalar leaf. Returns true if the operation removed something.
 */
function applyDelete(obj: Record<string, unknown>, path: string, index?: number): boolean {
  const parts = path.split('.');
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const next = cur[parts[i]];
    if (!next || typeof next !== 'object' || Array.isArray(next)) return false;
    cur = next as Record<string, unknown>;
  }
  const leafKey = parts[parts.length - 1];
  const leaf = cur[leafKey];
  if (index !== undefined) {
    if (!Array.isArray(leaf)) return false;
    if (index < 0 || index >= leaf.length) return false;
    leaf.splice(index, 1);
    return true;
  }
  if (leaf === undefined || leaf === null || leaf === '') return false;
  // Scalar — set to empty string (most common case) or null for numbers.
  cur[leafKey] = typeof leaf === 'number' ? null : '';
  return true;
}
