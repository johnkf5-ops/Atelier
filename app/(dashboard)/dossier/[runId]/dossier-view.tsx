'use client';

import { useMemo, useState } from 'react';
import { fitTier, humanizeDeadline, daysUntilDeadline, humanizeMoney } from '@/lib/ui/copy';

export type WorkSample = {
  portfolio_image_id: number;
  thumb_url: string;
  filename: string;
  rationale: string;
};

export type DossierMatch = {
  id: number;
  opportunity_id: number;
  name: string;
  url: string;
  deadline: string | null;
  award_summary: string | null;
  award_type: string;
  prestige_tier: string;
  amount_usd: number | null;
  in_kind: string | null;
  entry_fee_usd: number | null;
  fit_score: number;
  composite_score: number | null;
  reasoning: string;
  supporting_image_ids: number[];
  hurting_image_ids: number[];
  artist_statement: string | null;
  project_proposal: string | null;
  cv_formatted: string | null;
  cover_letter: string | null;
  work_samples: WorkSample[];
  logo_url: string | null;
};

export type DossierFilteredOut = {
  name: string;
  blurb: string;
  fit_score: number;
};

type Tab = 'statement' | 'proposal' | 'cv' | 'cover' | 'samples' | 'reasoning';
type SortKey = 'fit' | 'deadline' | 'prize';

const SORT_LABELS: Record<SortKey, string> = {
  fit: 'Best fit',
  deadline: 'Deadline',
  prize: 'Prize amount',
};

function sortMatches(matches: DossierMatch[], key: SortKey): DossierMatch[] {
  const sorted = [...matches];
  if (key === 'fit') {
    sorted.sort((a, b) => (b.composite_score ?? 0) - (a.composite_score ?? 0));
  } else if (key === 'deadline') {
    sorted.sort((a, b) => daysUntilDeadline(a.deadline) - daysUntilDeadline(b.deadline));
  } else {
    sorted.sort((a, b) => (b.amount_usd ?? 0) - (a.amount_usd ?? 0));
  }
  return sorted;
}

export default function DossierView({
  runId,
  cover,
  ranking,
  matches,
  filteredOut,
}: {
  runId: number;
  cover: string;
  ranking: string;
  matches: DossierMatch[];
  filteredOut: DossierFilteredOut[];
}) {
  const [expanded, setExpanded] = useState<number | null>(null);
  const [tabByMatch, setTabByMatch] = useState<Record<number, Tab>>({});
  const [whyOpen, setWhyOpen] = useState<Record<number, boolean>>({});
  const [filteredOpen, setFilteredOpen] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('fit');
  const sorted = useMemo(() => sortMatches(matches, sortKey), [matches, sortKey]);

  return (
    <div className="max-w-5xl mx-auto space-y-12 py-4">
      {/* Cover */}
      <header className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="text-xs uppercase tracking-widest text-neutral-500">Career Dossier</div>
          <div className="flex gap-2 text-xs">
            <a
              href={`/api/dossier/${runId}/pdf`}
              className="rounded border border-neutral-700 px-3 py-1.5 hover:bg-neutral-800"
            >
              Download PDF
            </a>
          </div>
        </div>
        <h1 className="font-serif text-4xl leading-tight">Your aesthetic read</h1>
        <Prose>{cover}</Prose>
      </header>

      {/* Ranking narrative */}
      {matches.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-serif text-2xl">Ranking</h2>
          <Prose>{ranking}</Prose>
        </section>
      )}

      {/* Top-N matches */}
      <section className="space-y-4">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <h2 className="font-serif text-2xl">Top opportunities ({matches.length})</h2>
          {matches.length > 1 && (
            <div className="flex items-center gap-2 text-xs text-neutral-400">
              <span>Sort by:</span>
              <div className="flex gap-1 rounded border border-neutral-800 overflow-hidden">
                {(['fit', 'deadline', 'prize'] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setSortKey(k)}
                    className={`px-2 py-1 ${
                      sortKey === k
                        ? 'bg-neutral-200 text-neutral-900'
                        : 'text-neutral-400 hover:text-neutral-200'
                    }`}
                  >
                    {SORT_LABELS[k]}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        {matches.length === 0 ? (
          <div className="rounded border border-neutral-800 bg-neutral-950 p-6 text-sm text-neutral-400">
            No included opportunities in this window. Try widening your window or relaxing constraints.
          </div>
        ) : (
          <div className="space-y-3">
            {sorted.map((m, i) => {
              const isOpen = expanded === m.id;
              const tier = fitTier(m.composite_score ?? m.fit_score);
              const whyExpanded = !!whyOpen[m.id];
              return (
                <article
                  key={m.id}
                  className={`rounded border ${isOpen ? 'border-neutral-600' : 'border-neutral-800'} bg-neutral-950 overflow-hidden`}
                >
                  <button
                    onClick={() => setExpanded(isOpen ? null : m.id)}
                    className="w-full text-left flex items-start gap-4 px-4 py-4 hover:bg-neutral-900 transition"
                  >
                    <div className="flex-shrink-0 w-12 h-12 rounded overflow-hidden bg-neutral-800 flex items-center justify-center">
                      {m.logo_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={m.logo_url} alt="" className="w-full h-full object-contain" />
                      ) : (
                        <span className="text-lg font-serif text-neutral-500">{m.name[0]}</span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-3">
                        <span className="text-xs text-neutral-500 font-mono">#{i + 1}</span>
                        <h3 className="font-medium text-neutral-100">{m.name}</h3>
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-400 mt-1">
                        <span className="capitalize">
                          <strong>{m.prestige_tier}</strong> {m.award_type}
                        </span>
                        {m.deadline && <span>{humanizeDeadline(m.deadline)}</span>}
                        {m.amount_usd != null && m.amount_usd > 0 && (
                          <span>prize {humanizeMoney(m.amount_usd)}</span>
                        )}
                        {m.entry_fee_usd != null && m.entry_fee_usd > 0 && (
                          <span>fee {humanizeMoney(m.entry_fee_usd)}</span>
                        )}
                      </div>
                    </div>
                    <div className="flex-shrink-0">
                      <span
                        className={`inline-block px-2 py-1 text-[11px] uppercase tracking-wide rounded border ${tier.className}`}
                      >
                        {tier.label}
                      </span>
                    </div>
                  </button>

                  {/* "Why this fit?" disclosure on the COLLAPSED card so users
                      can read the Rubric reasoning without expanding into the
                      full materials view. WALKTHROUGH Note 13. */}
                  {!isOpen && (
                    <div className="px-4 pb-3 -mt-2">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setWhyOpen((c) => ({ ...c, [m.id]: !whyExpanded }));
                        }}
                        className="text-xs text-neutral-500 hover:text-neutral-300"
                      >
                        {whyExpanded ? '− Why this fit?' : '+ Why this fit?'}
                      </button>
                      {whyExpanded && (
                        <p className="mt-2 text-sm text-neutral-300 leading-relaxed border-l-2 border-neutral-800 pl-3">
                          {m.reasoning}
                        </p>
                      )}
                    </div>
                  )}

                  {isOpen && (
                    <div className="border-t border-neutral-800 px-4 py-4 space-y-4">
                      <Tabs
                        value={tabByMatch[m.id] ?? 'statement'}
                        onChange={(t) => setTabByMatch((c) => ({ ...c, [m.id]: t }))}
                        tabs={[
                          { key: 'statement', label: 'Statement', disabled: !m.artist_statement },
                          { key: 'proposal', label: 'Proposal', disabled: !m.project_proposal },
                          { key: 'cv', label: 'CV', disabled: !m.cv_formatted },
                          { key: 'cover', label: 'Cover', disabled: !m.cover_letter },
                          {
                            key: 'samples',
                            label: `Samples (${m.work_samples.length})`,
                            disabled: m.work_samples.length === 0,
                          },
                          { key: 'reasoning', label: 'Why this fit' },
                        ]}
                      />
                      <MatchBody match={m} tab={tabByMatch[m.id] ?? 'statement'} runId={runId} />
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* Filtered-out — reframed as "we considered these but they're not your room" */}
      {filteredOut.length > 0 && (
        <section className="space-y-3">
          <button
            onClick={() => setFilteredOpen((v) => !v)}
            className="w-full text-left flex items-center justify-between rounded border border-neutral-800 bg-neutral-950 px-4 py-3 hover:bg-neutral-900"
          >
            <div>
              <h2 className="font-serif text-lg">
                We considered these but they&apos;re not your room ({filteredOut.length})
              </h2>
              <div className="text-xs text-neutral-500 mt-1">
                Why your entry fee is better spent elsewhere.
              </div>
            </div>
            <span className="text-sm text-neutral-400">{filteredOpen ? '−' : '+'}</span>
          </button>
          {filteredOpen && (
            <div className="space-y-2 pl-2">
              {filteredOut.map((f, i) => (
                <div key={i} className="text-sm text-neutral-300 border-l-2 border-neutral-800 pl-3 py-1">
                  <span className="text-neutral-500 mr-2">{f.name}:</span>
                  {f.blurb}
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function Prose({ children }: { children: string }) {
  return (
    <div className="font-serif text-neutral-200 leading-relaxed text-lg space-y-4">
      {children.split(/\n{2,}/).map((p, i) => (
        <p key={i}>{p}</p>
      ))}
    </div>
  );
}

function Tabs({
  value,
  onChange,
  tabs,
}: {
  value: Tab;
  onChange: (t: Tab) => void;
  tabs: Array<{ key: Tab; label: string; disabled?: boolean }>;
}) {
  return (
    <div className="flex gap-1 flex-wrap border-b border-neutral-800">
      {tabs.map((t) => (
        <button
          key={t.key}
          onClick={() => !t.disabled && onChange(t.key)}
          disabled={t.disabled}
          className={`px-3 py-1.5 text-xs border-b-2 -mb-px transition ${
            value === t.key
              ? 'border-neutral-200 text-neutral-100'
              : t.disabled
                ? 'border-transparent text-neutral-700 cursor-not-allowed'
                : 'border-transparent text-neutral-500 hover:text-neutral-300'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

function MatchBody({ match, tab, runId }: { match: DossierMatch; tab: Tab; runId: number }) {
  if (tab === 'reasoning') {
    return (
      <div className="space-y-2">
        <h4 className="text-xs uppercase tracking-wide text-neutral-500">Why this fit</h4>
        <div className="text-sm text-neutral-200 leading-relaxed whitespace-pre-wrap">
          {match.reasoning}
        </div>
      </div>
    );
  }

  if (tab === 'samples') {
    return (
      <div className="space-y-3">
        <h4 className="text-xs uppercase tracking-wide text-neutral-500">
          Work sample selection — {match.work_samples.length} images
        </h4>
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
          {match.work_samples.map((s, i) => (
            <div
              key={i}
              className="relative aspect-square overflow-hidden rounded border border-neutral-800 group"
              title={`#${s.portfolio_image_id}: ${s.rationale}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={s.thumb_url} alt={s.filename} className="w-full h-full object-cover" />
              <div className="absolute inset-x-0 bottom-0 bg-black/75 text-[10px] text-neutral-300 p-1 opacity-0 group-hover:opacity-100 transition">
                #{s.portfolio_image_id}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const text =
    tab === 'statement'
      ? match.artist_statement
      : tab === 'proposal'
        ? match.project_proposal
        : tab === 'cv'
          ? match.cv_formatted
          : tab === 'cover'
            ? match.cover_letter
            : null;

  if (!text) {
    return <div className="text-sm text-neutral-500 italic">Not drafted for this match.</div>;
  }

  const materialType =
    tab === 'statement'
      ? 'artist_statement'
      : tab === 'proposal'
        ? 'project_proposal'
        : tab === 'cv'
          ? 'cv_formatted'
          : 'cover_letter';

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigator.clipboard.writeText(text)}
          className="rounded border border-neutral-700 px-3 py-1 text-xs hover:bg-neutral-800"
        >
          Copy
        </button>
        <a
          href={`/api/dossier/${runId}/match/${match.id}/${materialType}/docx`}
          className="rounded border border-neutral-700 px-3 py-1 text-xs hover:bg-neutral-800"
        >
          Download .docx
        </a>
      </div>
      <div className="text-sm text-neutral-200 leading-relaxed whitespace-pre-wrap font-serif bg-neutral-950 border border-neutral-800 rounded p-4">
        {text}
      </div>
    </div>
  );
}
