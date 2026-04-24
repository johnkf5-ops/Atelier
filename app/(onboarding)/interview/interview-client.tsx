'use client';

import { useEffect, useRef, useState } from 'react';

type Turn = { role: 'agent' | 'user'; content: string; akb_field_targeted?: string | null };

export default function InterviewClient() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [akb, setAkb] = useState<Record<string, unknown> | null>(null);
  const [seedUrls, setSeedUrls] = useState('');
  const [ingestStatus, setIngestStatus] = useState<string | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    (async () => {
      const [t, a] = await Promise.all([
        fetch('/api/extractor/turn').then((r) => r.json()),
        fetch('/api/akb').then((r) => r.json()),
      ]);
      setTurns(t.turns ?? []);
      setAkb(a.akb);
    })();
  }, []);

  useEffect(() => {
    scrollerRef.current?.scrollTo({ top: scrollerRef.current.scrollHeight });
  }, [turns]);

  async function startInterview() {
    setBusy(true);
    try {
      const res = await fetch('/api/extractor/turn', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ user_message: null }),
      });
      const j = await res.json();
      setTurns((cur) => [...cur, { role: 'agent', content: j.agent_message, akb_field_targeted: j.next_field_target }]);
      setAkb(j.akb);
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
      const res = await fetch('/api/extractor/turn', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ user_message: message }),
      });
      const j = await res.json();
      setTurns((cur) => [...cur, { role: 'agent', content: j.agent_message, akb_field_targeted: j.next_field_target }]);
      setAkb(j.akb);
    } finally {
      setBusy(false);
    }
  }

  async function runIngest() {
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
      const res = await fetch('/api/extractor/ingest', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ urls }),
      });
      const j = await res.json();
      setAkb(j.akb);
      const ok = j.sources.filter((s: { ok: boolean }) => s.ok).length;
      setIngestStatus(`${ok}/${urls.length} ingested · changed ${j.changed_fields.length} fields`);
    } catch (err) {
      setIngestStatus(`error: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6">
      <div className="space-y-4">
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
              onClick={runIngest}
              disabled={busy}
              className="rounded border border-neutral-700 px-3 py-1.5 text-sm hover:bg-neutral-800 disabled:opacity-40"
            >
              Ingest
            </button>
            {ingestStatus && <span className="text-xs text-neutral-400">{ingestStatus}</span>}
          </div>
        </section>

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
                  {t.role}
                  {t.akb_field_targeted && ` → ${t.akb_field_targeted}`}
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
        <h2 className="text-sm uppercase tracking-wide text-neutral-500 mb-2">AKB (live)</h2>
        <pre className="text-[11px] text-neutral-300 overflow-auto max-h-[36rem] leading-snug">
{akb ? JSON.stringify(akb, null, 2) : 'loading…'}
        </pre>
      </aside>
    </div>
  );
}
