/**
 * User-facing copy + display helpers. Centralised so future vocabulary
 * sweeps (WALKTHROUGH Note 13) don't have to grep components for inline
 * strings — change the constant here, every surface updates.
 *
 * Mapping rule: never expose internal vocabulary (composite_score,
 * fit_score, AKB, ingest, Rubric Matcher, Style Analyst, Knowledge
 * Extractor) to the user. Translate at the boundary.
 */

/**
 * Maps a 0..1 composite score to a qualitative tier label + colour class.
 * The tier IS the user-facing rank — numerical precision suggests false
 * rigor. We keep the number in the DB for sorting + debug.
 */
export type FitTier = {
  label: string;
  description: string;
  className: string;
};

export function fitTier(composite: number): FitTier {
  if (composite >= 0.65) {
    return {
      label: 'Strong fit',
      description: 'Your work clearly matches what this institution awards.',
      className: 'text-emerald-300 border-emerald-500/40 bg-emerald-500/5',
    };
  }
  if (composite >= 0.45) {
    return {
      label: 'Solid fit',
      description: 'A natural application — write to your strengths here.',
      className: 'text-emerald-200 border-emerald-500/30 bg-emerald-500/5',
    };
  }
  if (composite >= 0.25) {
    return {
      label: 'Worth applying',
      description: 'A real chance, but the room is competitive.',
      className: 'text-amber-200 border-amber-500/30 bg-amber-500/5',
    };
  }
  return {
    label: 'Long shot',
    description: 'Lower fit. Weigh the entry fee against the slim odds.',
    className: 'text-neutral-300 border-neutral-700 bg-neutral-900',
  };
}

/**
 * Humanise an ISO deadline (YYYY-MM-DD) into "Jun 30, 2026 — 9 weeks".
 * Returns just the date string when the time-until is in the past or
 * unparseable.
 */
export function humanizeDeadline(deadline: string | null | undefined): string {
  if (!deadline) return 'no deadline';
  const d = new Date(deadline);
  if (Number.isNaN(d.getTime())) return deadline;
  const formatted = d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
  const days = Math.round((d.getTime() - Date.now()) / 86_400_000);
  if (days < 0) return `${formatted} (passed)`;
  if (days === 0) return `${formatted} — today`;
  if (days === 1) return `${formatted} — tomorrow`;
  if (days < 14) return `${formatted} — ${days} days`;
  if (days < 60) return `${formatted} — ${Math.round(days / 7)} weeks`;
  if (days < 365) return `${formatted} — ${Math.round(days / 30)} months`;
  return formatted;
}

/**
 * Days-from-today as a simple integer (or Infinity for null).
 * Used as a sort key.
 */
export function daysUntilDeadline(deadline: string | null | undefined): number {
  if (!deadline) return Number.POSITIVE_INFINITY;
  const d = new Date(deadline);
  if (Number.isNaN(d.getTime())) return Number.POSITIVE_INFINITY;
  return (d.getTime() - Date.now()) / 86_400_000;
}

/**
 * Money rounded to user-friendly precision: integer dollars under $10k,
 * abbreviated thousands above. Returns 'unspecified' for null/0.
 */
export function humanizeMoney(amount: number | null | undefined): string {
  if (amount == null || amount === 0) return 'unspecified';
  if (amount >= 10_000) return `$${(amount / 1000).toFixed(0)}k`;
  return `$${amount.toLocaleString()}`;
}
