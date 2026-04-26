'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { fetchJson } from '@/lib/api/fetch-client';
import { Button } from '@/app/_components/ui';
import {
  OPPORTUNITY_TYPES,
  OPPORTUNITY_TYPE_LABELS,
  type OpportunityType,
} from '@/lib/schemas/run';

type Aggressiveness = 'conservative' | 'standard' | 'wide';

const AGGRESSIVENESS: Record<
  Aggressiveness,
  { label: string; count: number; sub: string; time: string; cost: string }
> = {
  conservative: {
    label: 'Conservative',
    count: 15,
    sub: '~15 opportunities — tight slate',
    time: '~20–30 min',
    cost: '~$10–15 in API calls',
  },
  standard: {
    label: 'Standard',
    count: 25,
    sub: '~25 opportunities — recommended',
    time: '~30–45 min',
    cost: '~$20–25 in API calls',
  },
  wide: {
    label: 'Wide net',
    count: 40,
    sub: '~40 opportunities — longer tail to triage',
    time: '~60–90 min',
    cost: '~$40–60 in API calls',
  },
};

export default function NewRunClient() {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aggressiveness, setAggressiveness] = useState<Aggressiveness>('standard');
  // WALKTHROUGH Note 35 — opportunity-type filter. All on by default.
  const [oppTypes, setOppTypes] = useState<Set<OpportunityType>>(
    new Set(OPPORTUNITY_TYPES),
  );
  function toggleType(t: OpportunityType) {
    setOppTypes((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  }

  async function onStart() {
    setStarting(true);
    setError(null);
    const r = await fetchJson<{ run_id: number }>('/api/runs/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        target_opportunity_count: AGGRESSIVENESS[aggressiveness].count,
        opportunity_types: [...oppTypes],
      }),
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
    <div className="space-y-5">
      <div className="space-y-2">
        <div className="text-xs uppercase tracking-wide text-neutral-500">
          Aggressiveness
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {(Object.keys(AGGRESSIVENESS) as Aggressiveness[]).map((k) => {
            const opt = AGGRESSIVENESS[k];
            const selected = aggressiveness === k;
            return (
              <button
                key={k}
                type="button"
                onClick={() => setAggressiveness(k)}
                className={`text-left rounded-lg border p-3 transition space-y-1.5 ${
                  selected
                    ? 'border-neutral-300 bg-neutral-100 text-neutral-900'
                    : 'border-neutral-800 bg-neutral-950 text-neutral-300 hover:border-neutral-700'
                }`}
              >
                <div className="text-sm font-medium">{opt.label}</div>
                <div
                  className={`text-xs ${selected ? 'text-neutral-700' : 'text-neutral-500'}`}
                >
                  {opt.sub}
                </div>
                <div
                  className={`text-xs pt-1 border-t ${
                    selected ? 'border-neutral-300 text-neutral-700' : 'border-neutral-800 text-neutral-400'
                  }`}
                >
                  <div>{opt.time}</div>
                  <div>{opt.cost}</div>
                </div>
              </button>
            );
          })}
        </div>
        <p className="text-xs text-neutral-500">
          Sets how wide a slate Atelier will assemble. Standard fits most artists; choose Wide net
          if you have time to triage more options. Estimates based on actual run timing — your run
          may finish faster or slower depending on how many recipients each opportunity has and
          how the model paces its work.
        </p>
      </div>

      <div className="space-y-2">
        <div className="text-xs uppercase tracking-wide text-neutral-500">
          Opportunity types — pick what you want this run
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {OPPORTUNITY_TYPES.map((t) => {
            const meta = OPPORTUNITY_TYPE_LABELS[t];
            const checked = oppTypes.has(t);
            return (
              <label
                key={t}
                className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition ${
                  checked
                    ? 'border-neutral-300 bg-neutral-100 text-neutral-900'
                    : 'border-neutral-800 bg-neutral-950 text-neutral-300 hover:border-neutral-700'
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleType(t)}
                  className="mt-1 accent-neutral-100"
                />
                <span className="space-y-1">
                  <span className="block text-sm font-medium">{meta.label}</span>
                  <span
                    className={`block text-xs leading-snug ${
                      checked ? 'text-neutral-700' : 'text-neutral-500'
                    }`}
                  >
                    {meta.explainer}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
        <p className="text-xs text-neutral-500">
          Uncheck what doesn&rsquo;t fit your current focus. If you&rsquo;re not interested in
          residencies this cycle, or you&rsquo;re not writing a photo book, drop those — Atelier
          will skip them entirely. At least one type must be selected.
        </p>
        {/* WALKTHROUGH Note 35-fix.2 — honest-ceiling guidance. The realistic
            universe of opportunities is much smaller for narrow type selections;
            warn the user before they discover this in the dossier. Numbers
            below are the per-type honest ceiling for fine-art photographers
            in any given 12-month window, derived from probe-supply-photobooks
            (~22 yes / ~15-20 meaningful) and analogous estimates per type. */}
        {oppTypes.size > 0 && oppTypes.size <= 2 && (
          <p className="text-xs text-amber-400 leading-snug rounded border border-amber-700/50 bg-amber-950/30 px-3 py-2">
            <span className="font-medium">Honest ceiling note:</span> the realistic universe of
            {' '}
            {[...oppTypes].map((t) => OPPORTUNITY_TYPE_LABELS[t].label.toLowerCase()).join(' + ')}{' '}
            for working photographers in a 12-month window is approximately{' '}
            {(() => {
              const ceilings: Record<OpportunityType, number> = {
                competitions: 25,
                grants: 15,
                residencies: 12,
                photo_books: 18,
                portfolio_reviews: 12,
                museum_acquisition: 8,
                commissions: 10,
              };
              const total = [...oppTypes].reduce((s, t) => s + ceilings[t], 0);
              return `${Math.round(total * 0.6)}–${total}`;
            })()}{' '}
            opportunities. Atelier will return what&rsquo;s actually open and a fit; it will not pad
            the slate. If you want a wider dossier, select more types.
          </p>
        )}
      </div>

      <Button
        type="button"
        variant="primary"
        onClick={() => setConfirming(true)}
        disabled={starting || confirming || oppTypes.size === 0}
        size="md"
      >
        Start new run →
      </Button>
      {error && <p className="text-sm text-rose-400">{error}</p>}
      <p className="text-xs text-neutral-500">
        Runs take 20–90 minutes depending on Aggressiveness. You can close this tab and come back.
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
                <span className="text-neutral-100 font-medium">
                  $10–60 in Anthropic API calls
                </span>{' '}
                depending on the Aggressiveness setting you chose.
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
