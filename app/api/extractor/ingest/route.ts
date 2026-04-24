import { NextRequest } from 'next/server';
import { z } from 'zod';
import { ensureDbReady } from '@/lib/db/client';
import { getCurrentUserId } from '@/lib/auth/user';
import { loadLatestAkb } from '@/lib/akb/persistence';
import { ingestUrls } from '@/lib/extractor/ingest-urls';
import { withApiErrorHandling } from '@/lib/api/response';

export const runtime = 'nodejs';
export const maxDuration = 300;

const Body = z.object({
  urls: z.array(z.string().url()).min(1).max(20),
  source: z.enum(['auto-discover', 'paste', 'manual']).default('paste'),
});

export const POST = withApiErrorHandling(async (req: NextRequest) => {
  await ensureDbReady();
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) {
    return Response.json({ error: parsed.error.message }, { status: 400 });
  }
  const userId = getCurrentUserId();

  const perUrl: Array<{ url: string; ok: boolean; changed?: string[]; error?: string }> = [];
  const result = await ingestUrls(parsed.data.urls, userId, {
    source: parsed.data.source,
    onProgress: (e) => {
      if (e.type === 'extracted') {
        perUrl.push({ url: e.url, ok: true, changed: e.fields_added });
      } else if (e.type === 'failed') {
        perUrl.push({ url: e.url, ok: false, error: e.reason });
      }
    },
  });

  const { akb } = await loadLatestAkb(userId);
  return Response.json({
    sources: perUrl,
    changed_fields: result.fields_touched,
    saved: result.akb_version_id != null ? { id: result.akb_version_id } : null,
    akb,
  });
});
