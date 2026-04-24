'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import type { StyleFingerprint } from '@/lib/schemas/style-fingerprint';
import StyleFingerprintCard from './style-fingerprint-card';
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

type Image = {
  id: number;
  filename: string;
  thumb_url: string;
  ordinal: number;
};

type ScrapeEvent =
  | { type: 'page'; url: string; found: number }
  | { type: 'page_error'; url: string; error: string }
  | { type: 'skipped'; src: string; reason: string }
  | { type: 'image'; image: { id: number; filename: string; thumb_url: string; width: number; height: number; src: string; duplicate: boolean } }
  | { type: 'image_error'; src: string; error: string }
  | { type: 'done'; total: number; new_count: number; new_ids: number[] };

const MIN_IMAGES = 20;

export default function UploadClient() {
  const [images, setImages] = useState<Image[]>([]);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [analystFingerprint, setAnalystFingerprint] = useState<StyleFingerprint | null>(null);
  const [analystVersion, setAnalystVersion] = useState<number | undefined>(undefined);
  const [analystError, setAnalystError] = useState<string | null>(null);
  const [analystStage, setAnalystStage] = useState<string>('');
  const stageTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const [scrapeUrls, setScrapeUrls] = useState('');
  const [scraping, setScraping] = useState(false);
  const [scrapeLog, setScrapeLog] = useState<string[]>([]);
  // IDs of images added by the most recent scrape, awaiting Confirm/Discard.
  const [reviewIds, setReviewIds] = useState<Set<number>>(new Set());
  // Subset of reviewIds the user has KEPT checked (to keep). Default all checked.
  const [keepIds, setKeepIds] = useState<Set<number>>(new Set());

  const refresh = useCallback(async () => {
    const res = await fetch('/api/portfolio/upload', { cache: 'no-store' });
    const j = await res.json();
    setImages(j.images ?? []);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Load existing fingerprint on mount so returning users see their card immediately.
  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch('/api/style-analyst/run', { cache: 'no-store' });
        if (!res.ok) return;
        const j = (await res.json()) as {
          fingerprint: StyleFingerprint | null;
          version?: number;
        };
        if (j.fingerprint) {
          setAnalystFingerprint(j.fingerprint);
          setAnalystVersion(j.version);
        }
      } catch {
        // ignore — user just hasn't analyzed yet
      }
    })();
  }, []);

  const onDrop = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      setBusy(true);
      setErrors([]);
      try {
        const fd = new FormData();
        for (const f of files) fd.append('files', f);
        const res = await fetch('/api/portfolio/upload', { method: 'POST', body: fd });
        const j = await res.json();
        if (j.errors?.length) setErrors(j.errors.map((e: { filename: string; error: string }) => `${e.filename}: ${e.error}`));
        await refresh();
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'image/jpeg': [], 'image/png': [], 'image/webp': [], 'image/heic': [], 'image/heif': [] },
    multiple: true,
    disabled: busy,
  });

  async function onDelete(id: number) {
    await fetch(`/api/portfolio/${id}`, { method: 'DELETE' });
    setImages((cur) => cur.filter((i) => i.id !== id));
  }

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  async function onDragEnd(e: DragEndEvent) {
    if (!e.over || e.active.id === e.over.id) return;
    setImages((cur) => {
      const oldIdx = cur.findIndex((i) => i.id === Number(e.active.id));
      const newIdx = cur.findIndex((i) => i.id === Number(e.over!.id));
      const reordered = arrayMove(cur, oldIdx, newIdx);
      fetch('/api/portfolio/reorder', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ order: reordered.map((i) => i.id) }),
      });
      return reordered;
    });
  }

  const ready = images.length >= MIN_IMAGES;

  async function runScrape() {
    const urls = scrapeUrls
      .split(/\s+/)
      .map((s) => s.trim())
      .filter((s) => /^https?:\/\//.test(s));
    if (urls.length === 0) {
      setScrapeLog(['paste at least one URL']);
      return;
    }
    setScraping(true);
    setScrapeLog([`scraping ${urls.length} page(s)…`]);
    const newReview = new Set<number>();
    const newKeep = new Set<number>();

    try {
      const res = await fetch('/api/portfolio/scrape', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ urls }),
      });
      if (!res.body) throw new Error('no stream body');
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split('\n\n');
        buf = parts.pop() ?? '';
        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith('data:')) continue;
          let ev: ScrapeEvent;
          try {
            ev = JSON.parse(line.slice(5).trim());
          } catch {
            continue;
          }
          handleScrapeEvent(ev, newReview, newKeep);
        }
      }
    } catch (err) {
      setScrapeLog((cur) => [...cur, `error: ${(err as Error).message}`]);
    } finally {
      setReviewIds(newReview);
      setKeepIds(newKeep);
      setScraping(false);
      await refresh();
    }
  }

  function handleScrapeEvent(
    ev: ScrapeEvent,
    newReview: Set<number>,
    newKeep: Set<number>,
  ) {
    if (ev.type === 'page') {
      setScrapeLog((cur) => [...cur, `${ev.url} → ${ev.found} candidate(s)`]);
    } else if (ev.type === 'page_error') {
      setScrapeLog((cur) => [...cur, `${ev.url} ✗ ${ev.error}`]);
    } else if (ev.type === 'skipped') {
      setScrapeLog((cur) => [...cur, `skip: ${shortUrl(ev.src)} — ${ev.reason}`]);
    } else if (ev.type === 'image') {
      if (!ev.image.duplicate) {
        newReview.add(ev.image.id);
        newKeep.add(ev.image.id);
      }
      setScrapeLog((cur) => [
        ...cur,
        `+ ${ev.image.filename} (${ev.image.width}×${ev.image.height})${ev.image.duplicate ? ' [dup]' : ''}`,
      ]);
    } else if (ev.type === 'image_error') {
      setScrapeLog((cur) => [...cur, `err: ${shortUrl(ev.src)} — ${ev.error}`]);
    } else if (ev.type === 'done') {
      setScrapeLog((cur) => [...cur, `done · ${ev.new_count} new, ${ev.total} total`]);
    }
  }

  async function commitReview() {
    // Delete any review-batch images the user UNCHECKED.
    const toDelete = [...reviewIds].filter((id) => !keepIds.has(id));
    for (const id of toDelete) {
      await fetch(`/api/portfolio/${id}`, { method: 'DELETE' });
    }
    setReviewIds(new Set());
    setKeepIds(new Set());
    await refresh();
  }

  function discardReview() {
    // Delete the entire review batch.
    void Promise.all(
      [...reviewIds].map((id) => fetch(`/api/portfolio/${id}`, { method: 'DELETE' })),
    ).then(() => {
      setReviewIds(new Set());
      setKeepIds(new Set());
      refresh();
    });
  }

  function toggleKeep(id: number) {
    setKeepIds((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function startStageTimer(imageCount: number) {
    // Staged copy — Style Analyst has no real progress stream, so we cycle
    // through three honest stages on a timer while the API call runs.
    const stages = [
      `Reading ${imageCount} images…`,
      'Identifying aesthetic lineage…',
      'Writing fingerprint…',
    ];
    let idx = 0;
    setAnalystStage(stages[0]);
    stageTimer.current = setInterval(() => {
      idx = Math.min(idx + 1, stages.length - 1);
      setAnalystStage(stages[idx]);
    }, 12_000);
  }

  function stopStageTimer() {
    if (stageTimer.current) {
      clearInterval(stageTimer.current);
      stageTimer.current = null;
    }
    setAnalystStage('');
  }

  async function runAnalyst() {
    setAnalyzing(true);
    setAnalystFingerprint(null);
    setAnalystError(null);
    startStageTimer(images.length);
    try {
      const res = await fetch('/api/style-analyst/run', { method: 'POST' });
      const j = (await res.json()) as {
        fingerprint?: StyleFingerprint;
        version?: number;
        error?: string;
      };
      if (!res.ok || j.error) {
        setAnalystError(j.error ?? `HTTP ${res.status}`);
      } else if (j.fingerprint) {
        setAnalystFingerprint(j.fingerprint);
        setAnalystVersion(j.version);
      }
    } catch (err) {
      setAnalystError((err as Error).message);
    } finally {
      stopStageTimer();
      setAnalyzing(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded border border-neutral-800 p-4 space-y-2">
        <h2 className="text-sm uppercase tracking-wide text-neutral-500">
          Or paste portfolio URLs (one per line)
        </h2>
        <textarea
          value={scrapeUrls}
          onChange={(e) => setScrapeUrls(e.target.value)}
          placeholder={'https://www.your-site.com/gallery\nhttps://www.your-site.com/series-2'}
          rows={3}
          className="w-full bg-neutral-950 border border-neutral-800 rounded p-2 text-sm font-mono"
          disabled={scraping}
        />
        <div className="flex items-center gap-3">
          <button
            onClick={runScrape}
            disabled={scraping}
            className="rounded border border-neutral-700 px-4 py-2 text-sm hover:bg-neutral-800 disabled:opacity-40"
          >
            {scraping ? 'Scraping…' : 'Scrape'}
          </button>
          {reviewIds.size > 0 && !scraping && (
            <>
              <button
                onClick={commitReview}
                className="rounded border border-emerald-700 px-4 py-2 text-sm hover:bg-emerald-950/40"
              >
                Confirm {keepIds.size}/{reviewIds.size}
              </button>
              <button
                onClick={discardReview}
                className="rounded border border-rose-800 px-4 py-2 text-sm hover:bg-rose-950/40 text-rose-300"
              >
                Discard all scraped
              </button>
              <span className="text-xs text-neutral-500">
                Uncheck any false positives, then Confirm.
              </span>
            </>
          )}
        </div>
        {scrapeLog.length > 0 && (
          <pre className="text-[11px] text-neutral-400 bg-neutral-950 border border-neutral-800 rounded p-2 max-h-48 overflow-auto">
{scrapeLog.join('\n')}
          </pre>
        )}
      </section>

      <div
        {...getRootProps()}
        className={`border-2 border-dashed rounded p-10 text-center cursor-pointer transition ${
          isDragActive ? 'border-emerald-500 bg-emerald-950/20' : 'border-neutral-700 hover:border-neutral-500'
        } ${busy ? 'opacity-50' : ''}`}
      >
        <input {...getInputProps()} />
        <p className="text-neutral-300">
          {isDragActive ? 'Drop them.' : busy ? 'Uploading…' : 'Drop images, or click to choose. JPEG / PNG / WebP / HEIC.'}
        </p>
        <p className="text-xs text-neutral-500 mt-2">
          {images.length} / 100 uploaded — minimum {MIN_IMAGES} to run Style Analyst.
        </p>
      </div>

      {errors.length > 0 && (
        <div className="rounded border border-rose-700 bg-rose-950/30 p-3 text-sm text-rose-300">
          {errors.map((e, i) => (
            <div key={i}>{e}</div>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between">
        <h2 className="text-sm uppercase tracking-wide text-neutral-500">
          Portfolio ({images.length})
        </h2>
        <button
          onClick={runAnalyst}
          disabled={!ready || analyzing}
          className="rounded border border-neutral-700 px-4 py-2 text-sm disabled:opacity-40 hover:bg-neutral-800"
          title={ready ? 'Run Style Analyst' : `Need ${MIN_IMAGES - images.length} more image(s)`}
        >
          {analyzing ? 'Analyzing…' : 'Run Style Analyst →'}
        </button>
      </div>

      {analyzing && (
        <div className="rounded border border-neutral-800 bg-neutral-950 p-4 flex items-center gap-3">
          <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" aria-hidden />
          <div className="text-sm">
            <div className="text-neutral-200">Analyzing your portfolio…</div>
            {analystStage && (
              <div className="text-xs text-neutral-500 mt-0.5">{analystStage}</div>
            )}
          </div>
        </div>
      )}

      {analystError && (
        <div className="rounded border border-rose-700 bg-rose-950/30 p-3 text-sm text-rose-300">
          Analysis failed: {analystError}
        </div>
      )}

      {analystFingerprint && !analyzing && (
        <StyleFingerprintCard fingerprint={analystFingerprint} version={analystVersion} />
      )}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={images.map((i) => i.id)} strategy={rectSortingStrategy}>
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3">
            {images.map((img) => (
              <Tile
                key={img.id}
                img={img}
                onDelete={() => onDelete(img.id)}
                inReview={reviewIds.has(img.id)}
                kept={keepIds.has(img.id)}
                onToggleKeep={() => toggleKeep(img.id)}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}

function Tile({
  img,
  onDelete,
  inReview,
  kept,
  onToggleKeep,
}: {
  img: Image;
  onDelete: () => void;
  inReview: boolean;
  kept: boolean;
  onToggleKeep: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: img.id,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };
  const dimmed = inReview && !kept;
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group relative aspect-square overflow-hidden rounded border ${
        inReview ? (kept ? 'border-emerald-600' : 'border-rose-700') : 'border-neutral-800'
      }`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={img.thumb_url}
        alt={img.filename}
        className={`w-full h-full object-cover cursor-grab transition ${dimmed ? 'opacity-30 grayscale' : ''}`}
        {...attributes}
        {...listeners}
      />
      {inReview && (
        <label className="absolute top-1 left-1 flex items-center gap-1 rounded bg-black/70 px-2 py-1 text-xs cursor-pointer">
          <input type="checkbox" checked={kept} onChange={onToggleKeep} />
          keep
        </label>
      )}
      <button
        onClick={onDelete}
        className="absolute top-1 right-1 rounded bg-black/70 px-2 py-1 text-xs text-rose-300 opacity-0 group-hover:opacity-100"
      >
        delete
      </button>
    </div>
  );
}

function shortUrl(u: string): string {
  try {
    const url = new URL(u);
    const path = url.pathname + url.search;
    return path.length > 60 ? `${url.host}${path.slice(0, 57)}…` : `${url.host}${path}`;
  } catch {
    return u;
  }
}
