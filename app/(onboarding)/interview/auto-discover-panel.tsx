'use client';

import { useEffect, useRef, useState } from 'react';

type DiscoveredEntry = {
  url: string;
  page_type:
    | 'personal_site'
    | 'gallery_bio'
    | 'press_feature'
    | 'interview'
    | 'museum_collection'
    | 'exhibition_listing'
    | 'publication'
    | 'award_announcement'
    | 'social_profile'
    | 'other';
  confidence_0_1: number;
  title: string;
  why_relevant: string;
};

type DiscoveryResult = {
  queries_executed: string[];
  discovered: DiscoveredEntry[];
  disambiguation_notes: string | null;
};

type DiscoveryUsage = {
  input_tokens: number;
  output_tokens: number;
  web_search_requests: number;
};

type DiscoveryEvent =
  | { type: 'started' }
  | { type: 'query_running'; query: string }
  | { type: 'results_received'; query: string; count: number }
  | { type: 'continuing_after_pause'; attempt: number }
  | { type: 'parsing' }
  | { type: 'complete'; result: DiscoveryResult; usage: DiscoveryUsage }
  | { type: 'error'; message: string };

type Status = 'idle' | 'searching' | 'parsing' | 'reviewing' | 'ingesting' | 'complete' | 'error';

const PAGE_TYPE_GROUPS: { key: DiscoveredEntry['page_type']; label: string }[] = [
  { key: 'personal_site', label: 'Personal site' },
  { key: 'gallery_bio', label: 'Gallery bios' },
  { key: 'museum_collection', label: 'Museum collections' },
  { key: 'press_feature', label: 'Press features' },
  { key: 'interview', label: 'Interviews' },
  { key: 'exhibition_listing', label: 'Exhibition listings' },
  { key: 'publication', label: 'Publications' },
  { key: 'award_announcement', label: 'Award announcements' },
  { key: 'social_profile', label: 'Social profiles' },
  { key: 'other', label: 'Other' },
];

export default function AutoDiscoverPanel({ onIngested }: { onIngested: () => void }) {
  const [name, setName] = useState('');
  const [medium, setMedium] = useState('');
  const [location, setLocation] = useState('');
  const [affiliations, setAffiliations] = useState('');

  const [status, setStatus] = useState<Status>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [queries, setQueries] = useState<string[]>([]);
  const [resultsCount, setResultsCount] = useState(0);
  const [pauseAttempt, setPauseAttempt] = useState(0);
  const [result, setResult] = useState<DiscoveryResult | null>(null);
  const [usage, setUsage] = useState<DiscoveryUsage | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [ingestSummary, setIngestSummary] = useState<{
    sources: Array<{ url: string; ok: boolean; changed?: string[]; error?: string }>;
    changed_fields: string[];
    saved: { id: number } | null;
  } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  function reset() {
    setStatus('idle');
    setErrorMsg(null);
    setQueries([]);
    setResultsCount(0);
    setPauseAttempt(0);
    setResult(null);
    setUsage(null);
    setChecked(new Set());
    setIngestSummary(null);
  }

  async function startDiscovery() {
    if (!name.trim() || !medium.trim() || !location.trim()) {
      setErrorMsg('Name, medium, and location are required.');
      return;
    }
    reset();
    setStatus('searching');

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const affiliationList = affiliations
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean);

    try {
      // SSE stream — response.body is read as a ReadableStream, not JSON.
      // eslint-disable-next-line no-restricted-syntax
      const res = await fetch('/api/extractor/auto-discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          medium: medium.trim(),
          location: location.trim(),
          affiliations: affiliationList,
        }),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buffer.indexOf('\n\n')) !== -1) {
          const line = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          if (!line.startsWith('data: ')) continue;
          try {
            const ev = JSON.parse(line.slice(6)) as DiscoveryEvent;
            handleEvent(ev);
          } catch {
            /* malformed line, skip */
          }
        }
      }
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError') {
        setStatus('idle');
        return;
      }
      setErrorMsg((err as Error).message);
      setStatus('error');
    }
  }

  function handleEvent(ev: DiscoveryEvent) {
    if (ev.type === 'started') return;
    if (ev.type === 'query_running') {
      setQueries((cur) => [...cur, ev.query]);
    } else if (ev.type === 'results_received') {
      setResultsCount((n) => n + ev.count);
    } else if (ev.type === 'continuing_after_pause') {
      setPauseAttempt(ev.attempt);
    } else if (ev.type === 'parsing') {
      setStatus('parsing');
    } else if (ev.type === 'complete') {
      setResult(ev.result);
      setUsage(ev.usage);
      // Default-check entries with confidence ≥ 0.7
      setChecked(new Set(ev.result.discovered.filter((e) => e.confidence_0_1 >= 0.7).map((e) => e.url)));
      setStatus('reviewing');
    } else if (ev.type === 'error') {
      setErrorMsg(ev.message);
      setStatus('error');
    }
  }

  function cancelDiscovery() {
    abortRef.current?.abort();
    abortRef.current = null;
  }

  function toggle(url: string) {
    setChecked((cur) => {
      const next = new Set(cur);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
  }

  async function confirmAndIngest() {
    if (!result || checked.size === 0) return;
    setStatus('ingesting');
    setErrorMsg(null);
    setIngestSummary(null);
    try {
      const urls = result.discovered.filter((e) => checked.has(e.url)).map((e) => e.url);
      const { fetchJson } = await import('@/lib/api/fetch-client');
      const r = await fetchJson<{
        sources: Array<{ url: string; ok: boolean; changed?: string[]; error?: string }>;
        changed_fields: string[];
        saved: { id: number } | null;
      }>('/api/extractor/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls, source: 'auto-discover' }),
        timeoutMs: 300_000,
      });
      if (!r.ok) {
        setErrorMsg(r.error);
        setStatus('error');
        return;
      }
      setIngestSummary(r.data);
      setStatus('complete');
      onIngested();
    } catch (err) {
      setErrorMsg((err as Error).message);
      setStatus('error');
    }
  }

  const grouped = result
    ? PAGE_TYPE_GROUPS.map((g) => ({
        ...g,
        items: result.discovered.filter((e) => e.page_type === g.key),
      })).filter((g) => g.items.length > 0)
    : [];

  return (
    <section className="rounded border border-neutral-800 p-4 space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Name *" value={name} onChange={setName} placeholder="John Knopf" />
        <Field label="Medium *" value={medium} onChange={setMedium} placeholder="fine art photography" />
        <Field label="City / State *" value={location} onChange={setLocation} placeholder="Las Vegas, NV" />
        <Field
          label="Notable affiliations"
          value={affiliations}
          onChange={setAffiliations}
          placeholder="Emmy-nominated, National Geographic, TIME"
        />
      </div>

      <div className="flex items-center gap-3">
        {status === 'idle' || status === 'complete' || status === 'error' ? (
          <button
            onClick={startDiscovery}
            className="rounded border border-neutral-700 px-4 py-2 text-sm hover:bg-neutral-800"
          >
            Discover my web presence
          </button>
        ) : (status === 'searching' || status === 'parsing') ? (
          <button
            onClick={cancelDiscovery}
            className="rounded border border-rose-700 px-4 py-2 text-sm hover:bg-rose-950/40 text-rose-300"
          >
            Cancel
          </button>
        ) : null}
        {status === 'reviewing' && (
          <button
            onClick={confirmAndIngest}
            disabled={checked.size === 0}
            className="rounded border border-emerald-700 px-4 py-2 text-sm hover:bg-emerald-950/40 disabled:opacity-40"
          >
            Confirm and ingest ({checked.size})
          </button>
        )}
        {status === 'ingesting' && <span className="text-xs text-neutral-500">Ingesting selected pages…</span>}
      </div>

      {errorMsg && (
        <div className="rounded border border-rose-700 bg-rose-950/30 p-3 text-sm text-rose-300">
          {errorMsg}
          {errorMsg.toLowerCase().includes('not enabled') && (
            <div className="mt-1 text-xs">
              Web search not enabled — admin must enable in Claude Console settings.
            </div>
          )}
        </div>
      )}

      {(status === 'searching' || status === 'parsing') && (
        <div className="rounded border border-neutral-800 bg-neutral-950 p-3 text-xs space-y-1">
          <div className="flex items-center justify-between text-neutral-400">
            <span>{status === 'parsing' ? 'Parsing findings…' : 'Searching the web…'}</span>
            <span>{resultsCount > 0 && `Found ${resultsCount} results`}</span>
          </div>
          {queries.map((q, i) => (
            <div key={i} className="text-neutral-300">
              <span className="text-neutral-600">›</span> {q}
            </div>
          ))}
          {pauseAttempt > 0 && (
            <div className="text-amber-400">Continuing after pause (attempt {pauseAttempt})…</div>
          )}
        </div>
      )}

      {result && status !== 'searching' && status !== 'parsing' && (
        <div className="space-y-3">
          {result.disambiguation_notes && (
            <div className="rounded border border-amber-700 bg-amber-950/20 p-3 text-sm text-amber-300">
              ⚠ Multiple people with this name found: {result.disambiguation_notes}
            </div>
          )}
          {result.discovered.length === 0 && (
            <div className="text-sm text-neutral-400">
              No matches found. Try adding more affiliations or refining your medium.
            </div>
          )}
          {grouped.map((g) => (
            <details key={g.key} open className="border border-neutral-800 rounded">
              <summary className="cursor-pointer px-3 py-2 text-xs uppercase tracking-wide text-neutral-500 hover:bg-neutral-900">
                {g.label} · {g.items.length}
              </summary>
              <div className="divide-y divide-neutral-800">
                {g.items.map((e) => (
                  <DiscoveredRow
                    key={e.url}
                    entry={e}
                    checked={checked.has(e.url)}
                    onToggle={() => toggle(e.url)}
                  />
                ))}
              </div>
            </details>
          ))}
          {usage && (
            <div className="text-[11px] text-neutral-600 font-mono">
              {usage.web_search_requests} searches · {usage.input_tokens} in / {usage.output_tokens} out tokens
            </div>
          )}
        </div>
      )}

      {status === 'complete' && ingestSummary && (
        <IngestSummaryPanel summary={ingestSummary} />
      )}
    </section>
  );
}

function IngestSummaryPanel({
  summary,
}: {
  summary: {
    sources: Array<{ url: string; ok: boolean; changed?: string[]; error?: string }>;
    changed_fields: string[];
    saved: { id: number } | null;
  };
}) {
  const okCount = summary.sources.filter((s) => s.ok).length;
  const failCount = summary.sources.length - okCount;
  const nothingChanged = summary.changed_fields.length === 0;

  return (
    <div
      className={`rounded border p-3 text-sm space-y-2 ${
        summary.saved
          ? 'border-emerald-700 bg-emerald-950/20 text-emerald-200'
          : 'border-amber-700 bg-amber-950/20 text-amber-200'
      }`}
    >
      <div>
        {summary.saved ? (
          <>
            Knowledge Base v
            <span className="font-mono">{summary.saved.id}</span> saved —{' '}
            {summary.changed_fields.length} field
            {summary.changed_fields.length === 1 ? '' : 's'} added.
          </>
        ) : nothingChanged ? (
          <>No new facts extracted from the selected pages. Try adding URLs with richer bio / press content.</>
        ) : (
          <>Ingest completed but no Knowledge Base version was saved. Check logs.</>
        )}
        {failCount > 0 && (
          <span className="text-neutral-400 ml-2">
            ({okCount} ok, {failCount} failed)
          </span>
        )}
      </div>

      {summary.changed_fields.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer hover:text-neutral-300">
            Fields added ({summary.changed_fields.length})
          </summary>
          <ul className="mt-1 font-mono text-[11px] pl-4 list-disc">
            {summary.changed_fields.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </details>
      )}

      {failCount > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer hover:text-neutral-300">
            Failed sources ({failCount})
          </summary>
          <ul className="mt-1 text-[11px] pl-4 list-disc space-y-0.5">
            {summary.sources
              .filter((s) => !s.ok)
              .map((s) => (
                <li key={s.url}>
                  <span className="text-neutral-500">{shortUrl(s.url)}</span>
                  <span className="text-rose-300"> — {s.error ?? 'unknown'}</span>
                </li>
              ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <div className="text-xs text-neutral-400">{label}</div>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-neutral-950 border border-neutral-800 rounded px-2 py-1 text-sm mt-1"
      />
    </label>
  );
}

function DiscoveredRow({
  entry,
  checked,
  onToggle,
}: {
  entry: DiscoveredEntry;
  checked: boolean;
  onToggle: () => void;
}) {
  const conf = entry.confidence_0_1;
  const confColor = conf < 0.5 ? 'text-rose-400' : conf < 0.7 ? 'text-amber-400' : 'text-emerald-400';
  return (
    <label className="flex items-start gap-3 px-3 py-2 hover:bg-neutral-900 cursor-pointer">
      <input type="checkbox" checked={checked} onChange={onToggle} className="mt-1" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-medium truncate">{entry.title}</span>
          <span className={`text-[11px] font-mono ${confColor}`}>{conf.toFixed(2)}</span>
        </div>
        <a
          href={entry.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="text-xs text-neutral-500 hover:text-neutral-300 underline-offset-2 hover:underline truncate block"
        >
          {shortUrl(entry.url)}
        </a>
        <div className="text-xs text-neutral-400 mt-1">{entry.why_relevant}</div>
      </div>
    </label>
  );
}

function shortUrl(u: string): string {
  try {
    const url = new URL(u);
    const path = url.pathname + url.search;
    return path.length > 80 ? `${url.host}${path.slice(0, 77)}…` : `${url.host}${path}`;
  } catch {
    return u;
  }
}
