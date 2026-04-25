import { NextRequest } from 'next/server';
import { z } from 'zod';
import { ensureDbReady } from '@/lib/db/client';
import { getCurrentUserId } from '@/lib/auth/user';
import { loadLatestAkb } from '@/lib/akb/persistence';
import { ingestUrls } from '@/lib/extractor/ingest-urls';
import { IdentityAnchor } from '@/lib/schemas/discovery';
import { withApiErrorHandling } from '@/lib/api/response';

export const runtime = 'nodejs';
export const maxDuration = 300;

const Body = z.object({
  urls: z.array(z.string().url()).min(1).max(20),
  source: z.enum(['auto-discover', 'paste', 'manual']).default('paste'),
  // WALKTHROUGH Note 3: identity anchor + per-URL snippets from auto-discover.
  // Both are optional so the legacy "paste URL" flow still works.
  anchor: IdentityAnchor.optional(),
  snippets_by_url: z.record(z.string(), z.string()).optional(),
});

export const POST = withApiErrorHandling(async (req: NextRequest) => {
  await ensureDbReady();
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) {
    return Response.json({ error: parsed.error.message }, { status: 400 });
  }
  const userId = getCurrentUserId();

  const perUrl: Array<{
    url: string;
    ok: boolean;
    changed?: string[];
    error?: string;
    used_snippet?: boolean;
    identity_skipped?: boolean;
  }> = [];
  const result = await ingestUrls(parsed.data.urls, userId, {
    source: parsed.data.source,
    anchor: parsed.data.anchor ?? null,
    snippetsByUrl: parsed.data.snippets_by_url,
    onProgress: (e) => {
      if (e.type === 'extracted') {
        perUrl.push({
          url: e.url,
          ok: true,
          changed: e.fields_added,
          used_snippet: e.used_snippet,
        });
      } else if (e.type === 'identity_skipped') {
        perUrl.push({ url: e.url, ok: true, identity_skipped: true });
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
    summary: {
      attempted: parsed.data.urls.length,
      ingested: result.ingested_count,
      identity_skipped: result.identity_skipped.length,
      snippet_fallback: result.snippet_fallback_count,
      failed: result.failed.length,
    },
  });
});
