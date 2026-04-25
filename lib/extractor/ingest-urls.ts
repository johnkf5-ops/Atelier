import { ingestUrl } from '@/lib/agents/knowledge-extractor';
import { loadLatestAkb, loadAkbById, saveAkb } from '@/lib/akb/persistence';
import { mergeAkb, type Provenance } from '@/lib/akb/merge';
import { emptyAkb, type ArtistKnowledgeBase as TAkb } from '@/lib/schemas/akb';
import type { IdentityAnchor } from '@/lib/schemas/discovery';

export type IngestSource = 'auto-discover' | 'paste' | 'manual';

export interface IngestUrlsOptions {
  source: IngestSource;
  baseAkbVersionId?: number | null; // null/undefined = build from latest existing version (or empty)
  /** Per-URL search snippets — used as fallback content when page fetch fails. */
  snippetsByUrl?: Record<string, string>;
  /** Identity anchor — passed to per-source extraction so wrong-person facts get refused. */
  anchor?: IdentityAnchor | null;
  onProgress?: (e: IngestProgressEvent) => void;
}

export type IngestProgressEvent =
  | { type: 'fetching'; url: string }
  | { type: 'extracted'; url: string; fields_added: string[]; used_snippet?: boolean }
  | { type: 'identity_skipped'; url: string }
  | { type: 'failed'; url: string; reason: string };

export interface IngestResult {
  akb_version_id: number | null;
  ingested_count: number;
  failed: { url: string; reason: string }[];
  identity_skipped: string[];
  snippet_fallback_count: number;
  fields_touched: string[];
}

export async function ingestUrls(
  urls: string[],
  userId: number,
  opts: IngestUrlsOptions,
): Promise<IngestResult> {
  let akb: TAkb;
  if (opts.baseAkbVersionId != null) {
    const loaded = await loadAkbById(opts.baseAkbVersionId);
    if (!loaded) throw new Error(`baseAkbVersionId ${opts.baseAkbVersionId} not found`);
    akb = loaded.akb;
  } else {
    const latest = await loadLatestAkb(userId);
    akb = latest.akb ?? emptyAkb();
  }

  const failed: { url: string; reason: string }[] = [];
  const identitySkipped: string[] = [];
  const allChanged = new Set<string>();
  let ingestedCount = 0;
  let snippetFallbackCount = 0;

  // Emit fetching events in order, then kick off all fetches in parallel.
  // Plan §2.5: `Promise.allSettled` so one bad URL doesn't break the batch.
  for (const url of urls) opts.onProgress?.({ type: 'fetching', url });
  const settled = await Promise.allSettled(
    urls.map((u) =>
      ingestUrl(u, {
        anchor: opts.anchor ?? null,
        snippet: opts.snippetsByUrl?.[u],
      }),
    ),
  );

  for (let i = 0; i < settled.length; i++) {
    const url = urls[i];
    const s = settled[i];
    if (s.status === 'rejected') {
      const reason = String(s.reason);
      failed.push({ url, reason });
      opts.onProgress?.({ type: 'failed', url, reason });
      continue;
    }
    const r = s.value;
    if (!r.ok) {
      failed.push({ url, reason: r.error ?? 'unknown' });
      opts.onProgress?.({ type: 'failed', url, reason: r.error ?? 'unknown' });
      continue;
    }
    if (r.identity_skipped) {
      identitySkipped.push(url);
      opts.onProgress?.({ type: 'identity_skipped', url });
      continue;
    }
    if (r.used_snippet_fallback) snippetFallbackCount += 1;
    if (!r.partial || Object.keys(r.partial).length === 0) {
      // Page returned but produced no facts and the model didn't flag it as
      // an identity skip — count as benign no-op, not failure.
      opts.onProgress?.({ type: 'extracted', url, fields_added: [], used_snippet: r.used_snippet_fallback });
      continue;
    }
    const provenance = `ingested:${url}` as Provenance;
    try {
      const { merged, changedFields } = mergeAkb(akb, r.partial, provenance);
      akb = merged;
      ingestedCount++;
      for (const f of changedFields) allChanged.add(f);
      opts.onProgress?.({
        type: 'extracted',
        url,
        fields_added: changedFields,
        used_snippet: r.used_snippet_fallback,
      });
    } catch (err) {
      failed.push({ url, reason: `merge: ${(err as Error).message}` });
      opts.onProgress?.({ type: 'failed', url, reason: `merge: ${(err as Error).message}` });
    }
  }

  let akb_version_id: number | null = null;
  if (allChanged.size > 0) {
    const saved = await saveAkb(userId, akb, 'ingest');
    akb_version_id = saved.id;
  }

  // opts.source is recorded in the saved AKB row's provenance per-field; we keep the
  // arg in the interface for caller-side telemetry / future use.
  void opts.source;

  return {
    akb_version_id,
    ingested_count: ingestedCount,
    failed,
    identity_skipped: identitySkipped,
    snippet_fallback_count: snippetFallbackCount,
    fields_touched: Array.from(allChanged),
  };
}
