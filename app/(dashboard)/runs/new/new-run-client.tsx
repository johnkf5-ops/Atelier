'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { fetchJson } from '@/lib/api/fetch-client';
import { Button } from '@/app/_components/ui';

export default function NewRunClient() {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
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
      <Button
        type="button"
        variant="primary"
        onClick={() => setConfirming(true)}
        disabled={starting || confirming}
        size="md"
      >
        Start new run →
      </Button>
      {error && <p className="text-sm text-rose-400">{error}</p>}
      <p className="text-xs text-neutral-500">
        A typical run takes 20–30 minutes. You can close this tab and come back.
      </p>

      {confirming && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-6"
          role="dialog"
          aria-modal="true"
          onClick={() => !starting && setConfirming(false)}
        >
          <div
            className="max-w-lg w-full rounded-lg border border-neutral-700 bg-[#171717] p-6 space-y-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="font-serif text-2xl text-neutral-100">Before you start</h2>
            <div className="space-y-3 text-sm text-neutral-300 leading-relaxed">
              <p>
                This is a single-tenant demo running on the builder&rsquo;s API key for the{' '}
                <span className="text-neutral-100">Built with Opus 4.7</span> hackathon.
                Each run costs roughly{' '}
                <span className="text-neutral-100 font-medium">$3–5 in Anthropic API calls</span>.
              </p>
              <p>
                Please don&rsquo;t start more than one run unless you&rsquo;re testing
                something specific. Multi-tenant deploy with per-user accounts and BYO API
                key is post-hackathon scope.
              </p>
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <Button
                variant="ghost"
                onClick={() => setConfirming(false)}
                disabled={starting}
                size="md"
              >
                Cancel
              </Button>
              <Button variant="primary" onClick={onStart} disabled={starting} size="md">
                {starting ? 'Starting run…' : 'Start the run'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
