'use client';

import { useState } from 'react';

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
  const [filteredOpen, setFilteredOpen] = useState(false);

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

      {/* Deadline strip */}
      {matches.length > 0 && <DeadlineStrip matches={matches} />}

      {/* Top-N matches */}
      <section className="space-y-4">
        <div className="flex items-baseline justify-between">
          <h2 className="font-serif text-2xl">Top opportunities ({matches.length})</h2>
          <div className="text-xs text-neutral-500">ordered by composite score</div>
        </div>
        {matches.length === 0 ? (
          <div className="rounded border border-neutral-800 bg-neutral-950 p-6 text-sm text-neutral-400">
            No included opportunities in this window. Try widening your window or relaxing constraints.
          </div>
        ) : (
          <div className="space-y-3">
            {matches.map((m, i) => {
              const isOpen = expanded === m.id;
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
                        <span>
                          <strong>{m.prestige_tier}</strong> {m.award_type}
                        </span>
                        {m.deadline && <span>deadline: {m.deadline}</span>}
                        {m.award_summary && <span className="truncate max-w-xs">{m.award_summary}</span>}
                        {m.entry_fee_usd != null && m.entry_fee_usd > 0 && <span>fee: ${m.entry_fee_usd}</span>}
                      </div>
                    </div>
                    <div className="flex-shrink-0 text-right">
                      <ScoreBadge composite={m.composite_score ?? 0} fit={m.fit_score} />
                    </div>
                  </button>

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
                          { key: 'samples', label: `Samples (${m.work_samples.length})`, disabled: m.work_samples.length === 0 },
                          { key: 'reasoning', label: 'Why this match' },
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

      {/* Filtered-out */}
      {filteredOut.length > 0 && (
        <section className="space-y-3">
          <button
            onClick={() => setFilteredOpen((v) => !v)}
            className="w-full text-left flex items-center justify-between rounded border border-neutral-800 bg-neutral-950 px-4 py-3 hover:bg-neutral-900"
          >
            <div>
              <h2 className="font-serif text-lg">Filtered out ({filteredOut.length})</h2>
              <div className="text-xs text-neutral-500 mt-1">
                Why you shouldn&apos;t spend an entry fee on these.
              </div>
            </div>
            <span className="text-sm text-neutral-400">{filteredOpen ? '−' : '+'}</span>
          </button>
          {filteredOpen && (
            <div className="space-y-2 pl-2">
              {filteredOut.map((f, i) => (
                <div key={i} className="text-sm text-neutral-300 border-l-2 border-neutral-800 pl-3 py-1">
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

function ScoreBadge({ composite, fit }: { composite: number; fit: number }) {
  const compositeColor = composite >= 0.5 ? 'text-emerald-400' : composite >= 0.3 ? 'text-amber-400' : 'text-rose-400';
  return (
    <div className="flex flex-col items-end">
      <span className={`font-mono text-lg ${compositeColor}`}>{composite.toFixed(2)}</span>
      <span className="text-[10px] text-neutral-500 font-mono">fit {fit.toFixed(2)}</span>
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
        <h4 className="text-xs uppercase tracking-wide text-neutral-500">Rubric Matcher reasoning</h4>
        <div className="text-sm text-neutral-200 leading-relaxed whitespace-pre-wrap">{match.reasoning}</div>
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

function DeadlineStrip({ matches }: { matches: DossierMatch[] }) {
  const withDeadlines = matches.filter((m) => m.deadline).map((m) => ({
    name: m.name,
    date: new Date(m.deadline!),
    url: m.url,
  }));
  if (withDeadlines.length === 0) return null;
  const now = new Date();
  const maxDate = new Date(now);
  maxDate.setMonth(maxDate.getMonth() + 7);

  const totalDays = (maxDate.getTime() - now.getTime()) / 86_400_000;

  return (
    <section className="space-y-2">
      <h2 className="text-xs uppercase tracking-widest text-neutral-500">Deadline timeline</h2>
      <div className="relative h-16 rounded border border-neutral-800 bg-neutral-950">
        <div className="absolute inset-y-0 left-4 right-4">
          {withDeadlines.map((d, i) => {
            const days = (d.date.getTime() - now.getTime()) / 86_400_000;
            const pct = Math.max(0, Math.min(100, (days / totalDays) * 100));
            return (
              <div
                key={i}
                className="absolute top-2 -translate-x-1/2 group"
                style={{ left: `${pct}%` }}
                title={`${d.name} — ${d.date.toISOString().slice(0, 10)}`}
              >
                <div className="w-2 h-2 rounded-full bg-emerald-400" />
                <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-full text-[10px] text-neutral-500 whitespace-nowrap opacity-0 group-hover:opacity-100 transition">
                  {d.name.slice(0, 28)} · {d.date.toISOString().slice(0, 10)}
                </div>
              </div>
            );
          })}
        </div>
        <div className="absolute inset-x-4 bottom-1 flex justify-between text-[10px] text-neutral-600">
          <span>today</span>
          <span>+6 mo</span>
        </div>
      </div>
    </section>
  );
}
