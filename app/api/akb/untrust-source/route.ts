import { NextRequest } from 'next/server';
import { z } from 'zod';
import { ensureDbReady } from '@/lib/db/client';
import { getCurrentUserId } from '@/lib/auth/user';
import { addUntrustedSource, removeUntrustedSource, listUntrustedSources } from '@/lib/db/queries/untrusted-sources';
import { withApiErrorHandling } from '@/lib/api/response';

export const runtime = 'nodejs';

/**
 * Adds (or removes) a URL to/from the user's untrusted-sources list.
 * Auto-discover and the URL ingest path skip any URL on this list.
 *
 *   POST   { url: string, reason?: string }   → add
 *   DELETE { url: string }                    → remove
 *   GET                                        → list current
 *
 * WALKTHROUGH Note 10.
 */

const Body = z.object({
  url: z.string().url(),
  reason: z.string().optional(),
});

export const POST = withApiErrorHandling(async (req: NextRequest) => {
  await ensureDbReady();
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) {
    return Response.json({ error: parsed.error.message }, { status: 400 });
  }
  await addUntrustedSource(getCurrentUserId(), parsed.data.url, parsed.data.reason);
  return Response.json({ untrusted: true, url: parsed.data.url });
});

export const DELETE = withApiErrorHandling(async (req: NextRequest) => {
  await ensureDbReady();
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) {
    return Response.json({ error: parsed.error.message }, { status: 400 });
  }
  await removeUntrustedSource(getCurrentUserId(), parsed.data.url);
  return Response.json({ untrusted: false, url: parsed.data.url });
});

export const GET = withApiErrorHandling(async () => {
  await ensureDbReady();
  const urls = await listUntrustedSources(getCurrentUserId());
  return Response.json({ untrusted_sources: urls });
});
