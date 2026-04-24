'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function NewRunClient() {
  const router = useRouter();
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onStart() {
    setStarting(true);
    setError(null);
    try {
      const res = await fetch('/api/runs/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { run_id: number };
      router.push(`/runs/${data.run_id}`);
    } catch (e) {
      setError((e as Error).message);
      setStarting(false);
    }
  }

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={onStart}
        disabled={starting}
        className="px-6 py-3 bg-neutral-100 text-neutral-900 rounded hover:bg-white disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {starting ? 'Starting run…' : 'Start new run'}
      </button>
      {error && <p className="text-sm text-rose-400">{error}</p>}
      <p className="text-xs text-neutral-500">
        A typical run takes 20–30 minutes. You can close this tab and come back.
      </p>
    </div>
  );
}
