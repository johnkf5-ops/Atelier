'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import AutoDiscoverPanel from './auto-discover-panel';
import { fetchJson } from '@/lib/api/fetch-client';

type Turn = { role: 'agent' | 'user'; content: string; akb_field_targeted?: string | null };

type IngestMode = 'auto' | 'paste';

type InterviewState = 'empty' | 'ready' | 'in_progress' | 'complete';

function countFacts(akb: Record<string, unknown> | null): number {
  if (!akb) return 0;
  let n = 0;
  const walk = (v: unknown): void => {
    if (v == null || v === '') return;
    if (Array.isArray(v)) {
      for (const x of v) walk(x);
      return;
    }
    if (typeof v === 'object') {
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        if (k === 'source_provenance') continue;
        walk(val);
      }
      return;
    }
    n += 1;
  };
  walk(akb);
  return n;
}

function deriveInterviewState(
  turns: Turn[],
  akb: Record<string, unknown> | null,
): InterviewState {
  if (!akb || Object.keys(akb).length === 0) return 'empty';
  if (turns.length === 0) return 'ready';
  const lastAgent = [...turns].reverse().find((t) => t.role === 'agent');
  if (!lastAgent) return 'ready';
  // next_field_target === null ⇒ interview complete
  return lastAgent.akb_field_targeted === null ? 'complete' : 'in_progress';
}

export default function InterviewClient() {
  const [mode, setMode] = useState<IngestMode>('auto');

  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [akb, setAkb] = useState<Record<string, unknown> | null>(null);
  const [seedUrls, setSeedUrls] = useState('');
  const [ingestStatus, setIngestStatus] = useState<string | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);

  const refreshAkb = useCallback(async () => {
    const r = await fetchJson<{ akb: Record<string, unknown> | null }>('/api/akb');
    if (r.ok) setAkb(r.data.akb);
  }, []);

  useEffect(() => {
    (async () => {
      const [t, a] = await Promise.all([
        fetchJson<{ turns: Turn[] }>('/api/extractor/turn'),
        fetchJson<{ akb: Record<string, unknown> | null }>('/api/akb'),
      ]);
      if (t.ok) setTurns(t.data.turns ?? []);
      if (a.ok) setAkb(a.data.akb);
    })();
  }, []);

  useEffect(() => {
    scrollerRef.current?.scrollTo({ top: scrollerRef.current.scrollHeight });
  }, [turns]);

  type TurnResponse = {
    agent_message: string;
    next_field_target: string | null;
    akb: Record<string, unknown> | null;
  };

  async function startInterview() {
    setBusy(true);
    try {
      const r = await fetchJson<TurnResponse>('/api/extractor/turn', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ user_message: null }),
        timeoutMs: 120_000,
      });
      if (!r.ok) {
        setIngestStatus(`error: ${r.error}`);
        return;
      }
      setTurns((cur) => [
        ...cur,
        { role: 'agent', content: r.data.agent_message, akb_field_targeted: r.data.next_field_target },
      ]);
      setAkb(r.data.akb);
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    if (!draft.trim() || busy) return;
    const message = draft.trim();
    setDraft('');
    setTurns((cur) => [...cur, { role: 'user', content: message }]);
    setBusy(true);
    try {
      const r = await fetchJson<TurnResponse>('/api/extractor/turn', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ user_message: message }),
        timeoutMs: 120_000,
      });
      if (!r.ok) {
        setIngestStatus(`error: ${r.error}`);
        // Drop the optimistic user message we just appended — the request failed.
        setTurns((cur) => cur.slice(0, -1));
        setDraft(message); // restore so user can retry without retyping
        return;
      }
      setTurns((cur) => [
        ...cur,
        { role: 'agent', content: r.data.agent_message, akb_field_targeted: r.data.next_field_target },
      ]);
      setAkb(r.data.akb);
    } finally {
      setBusy(false);
    }
  }

  async function runPasteIngest() {
    const urls = seedUrls
      .split(/\s+/)
      .map((s) => s.trim())
      .filter((s) => /^https?:\/\//.test(s));
    if (urls.length === 0) {
      setIngestStatus('paste at least one URL');
      return;
    }
    setBusy(true);
    setIngestStatus('ingesting…');
    try {
      const r = await fetchJson<{
        sources: Array<{ ok: boolean }>;
        changed_fields: string[];
        akb: Record<string, unknown> | null;
      }>('/api/extractor/ingest', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ urls, source: 'paste' }),
        timeoutMs: 180_000,
      });
      if (!r.ok) {
        setIngestStatus(`error: ${r.error}`);
        return;
      }
      setAkb(r.data.akb);
      const ok = r.data.sources.filter((s) => s.ok).length;
      setIngestStatus(`${ok}/${urls.length} ingested · changed ${r.data.changed_fields.length} fields`);
    } finally {
      setBusy(false);
    }
  }

  const factCount = countFacts(akb);
  const interviewState = deriveInterviewState(turns, akb);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6">
      <div className="space-y-4">
        <StateBanner state={interviewState} factCount={factCount} />

        <div className="flex gap-2 border-b border-neutral-800">
          <TabButton active={mode === 'auto'} onClick={() => setMode('auto')}>
            Auto-discover
          </TabButton>
          <TabButton active={mode === 'paste'} onClick={() => setMode('paste')}>
            Paste URLs
          </TabButton>
        </div>

        {mode === 'auto' && <AutoDiscoverPanel onIngested={refreshAkb} />}

        {mode === 'paste' && (
          <section className="rounded border border-neutral-800 p-4 space-y-2">
            <h2 className="text-sm uppercase tracking-wide text-neutral-500">Seed URLs</h2>
            <textarea
              value={seedUrls}
              onChange={(e) => setSeedUrls(e.target.value)}
              placeholder="Paste URLs (one per line) — personal site, gallery bio, press features..."
              className="w-full h-24 bg-neutral-950 border border-neutral-800 rounded p-2 text-sm font-mono"
              disabled={busy}
            />
            <div className="flex justify-between items-center">
              <button
                onClick={runPasteIngest}
                disabled={busy}
                className="rounded border border-neutral-700 px-3 py-1.5 text-sm hover:bg-neutral-800 disabled:opacity-40"
              >
                Ingest
              </button>
              {ingestStatus && <span className="text-xs text-neutral-400">{ingestStatus}</span>}
            </div>
          </section>
        )}

        <section className="rounded border border-neutral-800">
          <div ref={scrollerRef} className="h-96 overflow-y-auto p-4 space-y-3">
            {turns.length === 0 && (
              <div className="text-sm text-neutral-500">
                <button
                  onClick={startInterview}
                  disabled={busy}
                  className="rounded border border-neutral-700 px-3 py-1.5 hover:bg-neutral-800 disabled:opacity-40"
                >
                  Start interview
                </button>
              </div>
            )}
            {turns.map((t, i) => (
              <div key={i} className={t.role === 'agent' ? 'text-neutral-200' : 'text-emerald-300 pl-6'}>
                <div className="text-xs uppercase tracking-wide text-neutral-500 mb-1">
                  {t.role === 'agent' ? 'Atelier' : 'You'}
                </div>
                <div className="text-sm whitespace-pre-wrap">{t.content}</div>
              </div>
            ))}
            {busy && <div className="text-xs text-neutral-500">…</div>}
          </div>
          <div className="border-t border-neutral-800 p-3 flex gap-2">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder={turns.length === 0 ? 'Click "Start interview" first' : 'Type your answer…'}
              disabled={busy || turns.length === 0}
              className="flex-1 bg-neutral-950 border border-neutral-800 rounded px-3 py-1.5 text-sm"
            />
            <button
              onClick={send}
              disabled={busy || !draft.trim() || turns.length === 0}
              className="rounded border border-neutral-700 px-3 py-1.5 text-sm hover:bg-neutral-800 disabled:opacity-40"
            >
              Send
            </button>
          </div>
        </section>
      </div>

      <aside className="rounded border border-neutral-800 p-4">
        <h2 className="text-sm uppercase tracking-wide text-neutral-500 mb-2">
          Knowledge Base (live)
        </h2>
        <pre className="text-[11px] text-neutral-300 overflow-auto max-h-[36rem] leading-snug">
{akb ? JSON.stringify(akb, null, 2) : 'loading…'}
        </pre>
      </aside>
    </div>
  );
}

function StateBanner({
  state,
  factCount,
}: {
  state: InterviewState;
  factCount: number;
}) {
  if (state === 'empty') {
    return (
      <div className="rounded border border-neutral-800 bg-neutral-900 p-3 text-sm text-neutral-300">
        Your Knowledge Base is empty. Start with Auto-discover below to seed it from the web,
        or paste URLs you want ingested.
      </div>
    );
  }
  if (state === 'ready') {
    return (
      <div className="rounded border border-neutral-800 bg-neutral-900 p-3 text-sm text-neutral-300">
        Your Knowledge Base has {factCount} fact{factCount === 1 ? '' : 's'}.
        <span className="text-neutral-500"> Start the interview to fill remaining gaps.</span>
      </div>
    );
  }
  if (state === 'in_progress') {
    return (
      <div className="rounded border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-100">
        Interview in progress — answer below. {factCount} fact{factCount === 1 ? '' : 's'} captured so far.
      </div>
    );
  }
  // state === 'complete'
  return (
    <div className="rounded border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm text-emerald-100 flex items-center justify-between gap-4">
      <div>
        Knowledge Base complete — {factCount} fact{factCount === 1 ? '' : 's'} captured.
      </div>
      <a
        href="/review"
        className="inline-block px-3 py-1.5 bg-neutral-100 text-neutral-900 text-xs rounded hover:bg-white whitespace-nowrap"
      >
        Review &amp; start your first run →
      </a>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-sm border-b-2 -mb-px transition ${
        active ? 'border-neutral-200 text-neutral-100' : 'border-transparent text-neutral-500 hover:text-neutral-300'
      }`}
    >
      {children}
    </button>
  );
}
