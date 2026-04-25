'use client';

import { useState } from 'react';
import { fetchJson } from '@/lib/api/fetch-client';

type HealthResult = Record<string, unknown> | null;

export default function HealthPanel() {
  const [result, setResult] = useState<HealthResult>(null);
  const [loading, setLoading] = useState(false);

  async function runCheck() {
    setLoading(true);
    const r = await fetchJson<Record<string, unknown>>('/api/health', { cache: 'no-store' });
    setResult(r.ok ? r.data : { error: r.error, kind: r.kind });
    setLoading(false);
  }

  return (
    <section className="space-y-3">
      <h2 className="text-sm uppercase tracking-wide text-neutral-500">Health check</h2>
      <button
        onClick={runCheck}
        disabled={loading}
        className="rounded border border-neutral-700 bg-neutral-900 px-4 py-2 text-sm hover:bg-neutral-800 disabled:opacity-50"
      >
        {loading ? 'Checking…' : 'Run /api/health'}
      </button>
      {result && (
        <pre className="text-xs bg-neutral-950 border border-neutral-800 rounded p-3 overflow-auto">
{JSON.stringify(result, null, 2)}
        </pre>
      )}
    </section>
  );
}
