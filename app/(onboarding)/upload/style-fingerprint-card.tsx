'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { StyleFingerprint } from '@/lib/schemas/style-fingerprint';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-[11px] uppercase tracking-wider text-neutral-500">{label}</div>
      <div className="text-sm text-neutral-200 leading-relaxed">{children}</div>
    </div>
  );
}

function prettyTemperature(t: StyleFingerprint['palette']['dominant_temperature']): string {
  return { cool: 'Cool', warm: 'Warm', neutral: 'Neutral', mixed: 'Mixed temperature' }[t];
}

function prettySaturation(s: StyleFingerprint['palette']['saturation_register']): string {
  return { muted: 'Muted', natural: 'Natural', saturated: 'Saturated' }[s];
}

export default function StyleFingerprintCard({
  fingerprint,
  version,
}: {
  fingerprint: StyleFingerprint;
  version?: number;
}) {
  const [showRaw, setShowRaw] = useState(false);

  return (
    <div className="rounded border border-neutral-800 bg-neutral-950 p-6 space-y-6">
      <div className="flex items-baseline justify-between">
        <h2 className="font-serif text-2xl">Your style fingerprint</h2>
        {version !== undefined && (
          <span className="text-xs text-neutral-500">v{version}</span>
        )}
      </div>

      <Field label="Formal lineage">
        {fingerprint.formal_lineage.length > 0 ? fingerprint.formal_lineage.join(', ') : '—'}
      </Field>

      <Field label="Career read">{fingerprint.career_positioning_read}</Field>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        <Field label="Palette">
          {prettyTemperature(fingerprint.palette.dominant_temperature)} ·{' '}
          {prettySaturation(fingerprint.palette.saturation_register)}
          {fingerprint.palette.notable_palette_notes.length > 0 && (
            <span className="block text-neutral-400 text-xs mt-1">
              {fingerprint.palette.notable_palette_notes.join(' · ')}
            </span>
          )}
        </Field>

        <Field label="Subject">
          {fingerprint.subject_categories.length > 0
            ? fingerprint.subject_categories.join(', ')
            : '—'}
        </Field>

        <Field label="Composition">
          {fingerprint.composition_tendencies.length > 0
            ? fingerprint.composition_tendencies.join(' · ')
            : '—'}
        </Field>

        <Field label="Light">
          {fingerprint.light_preferences.length > 0
            ? fingerprint.light_preferences.join(' · ')
            : '—'}
        </Field>
      </div>

      {fingerprint.museum_acquisition_signals.length > 0 && (
        <Field label="Museum-tier signals">
          <ul className="list-disc list-inside space-y-0.5">
            {fingerprint.museum_acquisition_signals.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </Field>
      )}

      {fingerprint.weak_signals.length > 0 && (
        <div className="border border-amber-500/20 bg-amber-500/5 rounded p-4">
          <div className="text-[11px] uppercase tracking-wider text-amber-400 mb-2">
            Weak signals / anti-references
          </div>
          <ul className="text-sm text-amber-100 space-y-1 list-disc list-inside">
            {fingerprint.weak_signals.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="border-t border-neutral-800 pt-4 space-y-3">
        <p className="text-sm text-neutral-400 leading-relaxed">
          Next, we'll research your public record — shows, publications, residencies — so Atelier
          can match you to the right opportunities.
        </p>
        <Link
          href="/interview"
          className="inline-block px-4 py-2 bg-neutral-100 text-neutral-900 text-sm rounded hover:bg-white"
        >
          Next: Build your Knowledge Base →
        </Link>
      </div>

      <details className="text-xs text-neutral-500">
        <summary
          className="cursor-pointer hover:text-neutral-300"
          onClick={(e) => {
            e.preventDefault();
            setShowRaw((v) => !v);
          }}
        >
          {showRaw ? '▼' : '▶'} View raw JSON
        </summary>
        {showRaw && (
          <pre className="mt-2 bg-neutral-900 border border-neutral-800 rounded p-3 overflow-auto text-[11px]">
{JSON.stringify(fingerprint, null, 2)}
          </pre>
        )}
      </details>
    </div>
  );
}
