import { NextRequest } from 'next/server';
import { getCurrentUserId } from '@/lib/auth/user';
import { ingestUrl, IngestRequest } from '@/lib/agents/knowledge-extractor';
import { loadLatestAkb, saveAkb } from '@/lib/akb/persistence';
import { mergeAkb, type Provenance } from '@/lib/akb/merge';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const parsed = IngestRequest.safeParse(await req.json());
  if (!parsed.success) {
    return Response.json({ error: parsed.error.message }, { status: 400 });
  }
  const userId = getCurrentUserId();
  let { akb } = await loadLatestAkb(userId);
  const totalChanged: string[] = [];
  const perUrl: Array<{ url: string; ok: boolean; changed?: string[]; error?: string }> = [];

  for (const url of parsed.data.urls) {
    const r = await ingestUrl(url);
    if (!r.ok || !r.partial) {
      perUrl.push({ url, ok: false, error: r.error });
      continue;
    }
    const provenance = `ingested:${url}` as Provenance;
    try {
      const { merged, changedFields } = mergeAkb(akb, r.partial, provenance);
      akb = merged;
      perUrl.push({ url, ok: true, changed: changedFields });
      totalChanged.push(...changedFields);
    } catch (err) {
      perUrl.push({ url, ok: false, error: `merge failed: ${(err as Error).message}` });
    }
  }

  let saved: { id: number; version: number } | null = null;
  if (totalChanged.length > 0) {
    saved = await saveAkb(userId, akb, 'ingest');
  }

  return Response.json({
    sources: perUrl,
    changed_fields: Array.from(new Set(totalChanged)),
    saved,
    akb,
  });
}
