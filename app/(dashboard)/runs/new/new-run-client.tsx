'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { fetchJson } from '@/lib/api/fetch-client';
import { Button } from '@/app/_components/ui';

export default function NewRunClient() {
  const router = useRouter();
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onStart() {
    setStarting(true);
    setError(null);
    const r = await fetchJson<{ run_id: number }>('/api/runs/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
      timeoutMs: 60_000,
    });
    if (!r.ok) {
      setError(r.error);
      setStarting(false);
      return;
    }
    router.push(`/runs/${r.data.run_id}`);
  }

  return (
    <div className="space-y-3">
      <Button type="button" variant="primary" onClick={onStart} disabled={starting} size="md">
        {starting ? 'Starting run…' : 'Start new run →'}
      </Button>
      {error && <p className="text-sm text-rose-400">{error}</p>}
      <p className="text-xs text-neutral-500">
        A typical run takes 20–30 minutes. You can close this tab and come back.
      </p>
    </div>
  );
}
