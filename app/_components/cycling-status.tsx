'use client';

import { useEffect, useState } from 'react';

/**
 * Reusable cycling-status indicator for long-running calls without a real
 * progress channel (Style Analyst, auto-discover, ingest). Rotates through
 * `messages` every `intervalMs` so the screen never looks frozen.
 *
 * Caller controls when to mount/unmount — this component only handles the
 * rotation. On unmount the timer is cleared.
 *
 * WALKTHROUGH Notes 1 + 2.
 */
export default function CyclingStatus({
  messages,
  intervalMs = 5000,
  className,
}: {
  messages: string[];
  intervalMs?: number;
  className?: string;
}) {
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    if (messages.length <= 1) return;
    const timer = setInterval(() => {
      setIdx((i) => (i + 1) % messages.length);
    }, intervalMs);
    return () => clearInterval(timer);
  }, [messages.length, intervalMs]);

  if (messages.length === 0) return null;

  return (
    <div
      className={
        className ??
        'flex items-center gap-3 rounded border border-neutral-800 bg-neutral-950 p-3'
      }
    >
      <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" aria-hidden />
      <span className="text-sm text-neutral-300">{messages[idx]}</span>
    </div>
  );
}
