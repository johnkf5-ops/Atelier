'use client';

import { useEffect, useState } from 'react';

const STORAGE_KEY = 'atelier:demo-banner-dismissed-v1';
const REPO_URL = 'https://github.com/johnkf5-ops/Atelier';

/**
 * WALKTHROUGH Note 16: thin banner pinned above the global header so a
 * judge knows from page 1 they're on the builder's API key. Dismissable
 * via localStorage so dismissal sticks across navigations within the
 * same browser without needing a server round-trip.
 */
export default function DemoBanner() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const dismissed = window.localStorage.getItem(STORAGE_KEY) === 'true';
    if (!dismissed) setShow(true);
  }, []);

  function dismiss() {
    setShow(false);
    try {
      window.localStorage.setItem(STORAGE_KEY, 'true');
    } catch {
      // localStorage can throw in private mode — banner just won't persist.
    }
  }

  if (!show) return null;

  return (
    <div className="border-b border-amber-900/50 bg-amber-950/40 text-amber-100 text-xs no-print">
      <div className="max-w-6xl mx-auto px-6 py-2 flex items-center justify-between gap-4">
        <p className="leading-relaxed">
          <span className="font-medium text-amber-200">Demo</span>
          <span className="mx-2 text-amber-700">•</span>
          Built with Opus 4.7 hackathon — running on the builder&rsquo;s portfolio + API key.{' '}
          <a
            href={REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-amber-50"
          >
            View on GitHub
          </a>
          .
        </p>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss banner"
          className="shrink-0 text-amber-300 hover:text-amber-100 px-2 py-0.5 rounded"
        >
          ×
        </button>
      </div>
    </div>
  );
}
