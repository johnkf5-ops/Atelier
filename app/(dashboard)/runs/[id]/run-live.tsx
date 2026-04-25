'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { fetchJson } from '@/lib/api/fetch-client';

// Event shape mirrors what the server persists; we pluck a few fields for UI.
type AtelierEvent = {
  _agent?: string;
  _kind?: string;
  _created_at?: number;
  type?: string;
  name?: string;
  input?: Record<string, unknown>;
  stop_reason?: { type?: string };
  content?: Array<{ type: string; text?: string }>;
};

type FeedItem = {
  id: string;
  ts: number;
  title: string;
  detail?: string;
  tone: 'neutral' | 'tool' | 'thinking' | 'status' | 'error' | 'persist';
};

const HIDDEN_TOOLS = new Set(['bash', 'read', 'write', 'edit', 'glob', 'grep']);

function formatStatus(s: string): string {
  switch (s) {
    case 'queued':
      return 'Queued';
    case 'scout_running':
      return 'Opportunity Scout searching sources…';
    case 'scout_complete':
      return 'Scout complete — downloading recipient images…';
    case 'finalizing_scout':
      return 'Downloading recipient portfolios…';
    case 'rubric_running':
      return 'Rubric Matcher scoring opportunities…';
    case 'rubric_complete':
      return 'Rubric complete — drafting materials…';
    case 'finalizing':
      return 'Drafting application packages…';
    case 'complete':
      return 'Run complete — opening your dossier';
    case 'error':
      return 'Run errored';
    default:
      return s;
  }
}

function eventToItem(e: AtelierEvent): FeedItem | null {
  const agent = e._agent ?? (e.type ?? '').split('.')[0];
  const kind = e._kind ?? (e.type ?? '').split('.').slice(1).join('.');
  const ts = (e._created_at ?? 0) * 1000;
  const key = `${agent}.${kind}.${ts}.${Math.random().toString(36).slice(2, 6)}`;

  if (agent === 'agent') {
    if (kind === 'tool_use') {
      const n = e.name ?? 'tool';
      if (HIDDEN_TOOLS.has(n)) return null;
      const q =
        typeof e.input?.query === 'string'
          ? (e.input.query as string)
          : typeof e.input?.url === 'string'
            ? (e.input.url as string)
            : '';
      return { id: key, ts, title: n, detail: q, tone: 'tool' };
    }
    if (kind === 'custom_tool_use') {
      return { id: key, ts, title: `persisted: ${e.name ?? 'custom'}`, tone: 'persist' };
    }
    if (kind === 'thinking') {
      const t = (e.content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '').join(' ');
      return { id: key, ts, title: 'thinking', detail: t.slice(0, 120), tone: 'thinking' };
    }
    if (kind === 'message' || kind === 'text') {
      const t = (e.content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('\n');
      if (!t.trim()) return null;
      return { id: key, ts, title: t, tone: 'neutral' };
    }
  }
  if (agent === 'session') {
    if (kind === 'status_idle') {
      return { id: key, ts, title: `idle (${e.stop_reason?.type ?? '?'})`, tone: 'status' };
    }
    if (kind === 'status_running') {
      return { id: key, ts, title: 'running', tone: 'status' };
    }
    if (kind === 'error') {
      return { id: key, ts, title: 'session error', tone: 'error' };
    }
  }
  return null;
}

export default function RunLive({ runId }: { runId: number }) {
  const router = useRouter();
  const params = useSearchParams();
  const playbackRunId = params.get('playback');
  const speedParam = Number(params.get('speed') ?? '1');
  const speed = Number.isFinite(speedParam) && speedParam > 0 ? speedParam : 1;

  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [status, setStatus] = useState<string>('queued');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const didFinishRef = useRef(false);

  // Live mode poll
  useEffect(() => {
    if (playbackRunId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      const r = await fetchJson<{
        events: AtelierEvent[];
        runStatus: string;
        done: boolean;
        errored: boolean;
      }>(`/api/runs/${runId}/events`, { cache: 'no-store', timeoutMs: 70_000 });
      if (cancelled) return;
      if (!r.ok) {
        // Transient poll failure — log + keep polling, don't abort the loop.
        console.warn('[run-live] poll failed', r.kind, r.error);
      } else {
        setStatus(r.data.runStatus);
        if (r.data.events.length > 0) {
          const items = r.data.events
            .map((e) => eventToItem(e))
            .filter((x): x is FeedItem => x !== null);
          setFeed((cur) => [...cur, ...items]);
        }
        if (r.data.errored) {
          setErrorMsg(r.data.runStatus);
          return;
        }
        if (r.data.done && !didFinishRef.current) {
          didFinishRef.current = true;
          router.push(`/dossier/${runId}`);
          return;
        }
      }
      if (!cancelled) timer = setTimeout(tick, 3000);
    };
    tick();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [runId, playbackRunId, router]);

  // Playback mode
  useEffect(() => {
    if (!playbackRunId) return;
    let cancelled = false;
    (async () => {
      const r = await fetchJson<AtelierEvent[]>(`/api/runs/${playbackRunId}/events-all`);
      if (!r.ok) return;
      const events = r.data;
      for (let i = 0; i < events.length; i++) {
        if (cancelled) return;
        const ev = events[i];
        const next = events[i + 1];
        const item = eventToItem(ev);
        if (item) setFeed((cur) => [...cur, item]);
        const gapMs = next
          ? Math.max(0, ((next._created_at ?? 0) - (ev._created_at ?? 0)) * 1000 / speed)
          : 0;
        if (gapMs > 0) {
          await new Promise((r) => setTimeout(r, Math.min(gapMs, 5000)));
        }
      }
      setStatus('complete');
    })();
    return () => {
      cancelled = true;
    };
  }, [playbackRunId, speed]);

  useEffect(() => {
    scrollerRef.current?.scrollTo({ top: scrollerRef.current.scrollHeight });
  }, [feed]);

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <div className="flex items-center justify-between">
          <h1 className="font-serif text-2xl">Run {runId}{playbackRunId ? ` (playback of ${playbackRunId} @ ${speed}x)` : ''}</h1>
          {status === 'complete' && (
            <a href={`/dossier/${runId}`} className="rounded border border-neutral-700 px-3 py-1.5 text-sm hover:bg-neutral-800">
              Open dossier →
            </a>
          )}
        </div>
        <div className="text-sm text-neutral-400">{formatStatus(status)}</div>
        {errorMsg && <div className="text-rose-400 text-sm mt-2">Error: {errorMsg}</div>}
      </header>

      <section className="rounded border border-neutral-800 bg-neutral-950">
        <div ref={scrollerRef} className="h-[32rem] overflow-y-auto p-4 space-y-2 font-mono text-xs">
          {feed.length === 0 && <div className="text-neutral-500">Waiting for first event…</div>}
          {feed.map((it) => (
            <FeedRow key={it.id} item={it} />
          ))}
        </div>
      </section>
    </div>
  );
}

function FeedRow({ item }: { item: FeedItem }) {
  const color =
    item.tone === 'error'
      ? 'text-rose-400'
      : item.tone === 'persist'
        ? 'text-emerald-400'
        : item.tone === 'tool'
          ? 'text-amber-300'
          : item.tone === 'thinking'
            ? 'text-neutral-500 italic'
            : item.tone === 'status'
              ? 'text-neutral-400'
              : 'text-neutral-200';
  const time = new Date(item.ts || Date.now()).toTimeString().slice(0, 8);
  return (
    <div className={`flex gap-3 ${color}`}>
      <span className="text-neutral-600">{time}</span>
      <div className="flex-1 min-w-0">
        <div className="truncate">{item.title}</div>
        {item.detail && <div className="text-neutral-500 truncate">› {item.detail}</div>}
      </div>
    </div>
  );
}
