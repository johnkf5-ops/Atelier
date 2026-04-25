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
  // WALKTHROUGH Note 22-fix.3: cv_formatted is repurposed as a per-opp
  // TRIM NOTE (1 sentence, deterministic from oppRequirementsText). The
  // full master CV lives at the dossier level, not per match.
  cv_formatted: string | null;
  cover_letter: string | null;
  work_samples: WorkSample[];
  logo_url: string | null;
};

export type DossierFilteredOut = {
  name: string;
  url: string | null;
  blurb: string;
  fit_score: number;
};

// WALKTHROUGH Note 22-fix.3: 'cv' tab removed — CV is now rendered ONCE
// per dossier in a dedicated section (see MasterCvSection), not duplicated
// across every opportunity card.
type Tab = 'statement' | 'proposal' | 'cover' | 'samples' | 'reasoning';
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
  masterCv,
  matches,
  filteredOut,
  artistName,
  portfolioThumbs,
  runDate,
}: {
  runId: number;
  cover: string;
  ranking: string;
  masterCv: string | null;
  matches: DossierMatch[];
  filteredOut: DossierFilteredOut[];
  artistName: string;
  portfolioThumbs: string[];
  runDate: string | null;
}) {
  const [expanded, setExpanded] = useState<number | null>(null);
  const [tabByMatch, setTabByMatch] = useState<Record<number, Tab>>({});
  const [whyOpen, setWhyOpen] = useState<Record<number, boolean>>({});
  const [filteredOpen, setFilteredOpen] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('fit');
  const sorted = useMemo(() => sortMatches(matches, sortKey), [matches, sortKey]);

  return (
    <div className="max-w-5xl mx-auto space-y-16 py-4">
      {/* Cover hero — artist name big in serif, portfolio thumbnail strip,
          run date. Designed to feel like the title page of a printed
          institutional packet. */}
      <header className="space-y-8">
        <div className="flex items-baseline justify-between gap-4 no-print">
          <div className="text-[11px] uppercase tracking-[0.2em] text-neutral-500">
            Career Dossier
          </div>
          <a
            href={`/api/dossier/${runId}/pdf`}
            className="inline-flex items-center gap-2 px-3 py-1.5 text-xs rounded border border-neutral-700 text-neutral-300 hover:bg-neutral-900 hover:border-neutral-600 transition"
          >
            Download PDF
          </a>
        </div>

        <div className="space-y-2">
          <h1 className="font-serif text-6xl leading-[0.95] tracking-tight text-neutral-100">
            {artistName}
          </h1>
          <div className="flex items-baseline gap-3 text-xs text-neutral-500">
            <span className="uppercase tracking-widest">Career Dossier</span>
            {runDate && (
              <>
                <span className="text-neutral-700">·</span>
                <span>
                  {new Date(runDate).toLocaleDateString(undefined, {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  })}
                </span>
              </>
            )}
          </div>
        </div>

        {portfolioThumbs.length > 0 && (
          <div className="grid grid-cols-6 sm:grid-cols-12 gap-1 max-h-32 overflow-hidden">
            {portfolioThumbs.map((t, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={i}
                src={t}
                alt=""
                loading="lazy"
                className="aspect-square w-full object-cover opacity-90"
              />
            ))}
          </div>
        )}

        <div className="space-y-3 pt-4">
          <h2 className="font-serif text-3xl text-neutral-200 tracking-tight">
            Your aesthetic read
          </h2>
          <Prose>{cover}</Prose>
        </div>
      </header>

      {/* Ranking narrative */}
      {matches.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-serif text-2xl">Ranking</h2>
          <Prose>{ranking}</Prose>
        </section>
      )}

      {/* WALKTHROUGH Note 22-fix.3: master CV — one canonical CV per dossier,
          rendered ONCE here and referenced from every per-opp package. */}
      {masterCv && <MasterCvSection runId={runId} masterCv={masterCv} />}

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
                  {/* Header is a div + onClick (not <button>) so the Apply
                      anchor below can be a real <a> without nesting violations.
                      Click anywhere in the header (except Apply) toggles. */}
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => setExpanded(isOpen ? null : m.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setExpanded(isOpen ? null : m.id);
                      }
                    }}
                    className="w-full text-left flex items-start gap-4 px-4 py-4 hover:bg-neutral-900 transition cursor-pointer"
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
                    <div className="flex-shrink-0 flex items-center gap-2">
                      <span
                        className={`inline-block px-2 py-1 text-[11px] uppercase tracking-wide rounded border ${tier.className}`}
                      >
                        {tier.label}
                      </span>
                      {m.url && (
                        <a
                          href={m.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex items-center gap-1 px-3 py-1 text-xs rounded border border-emerald-500/40 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20 hover:border-emerald-400/60 transition no-print"
                        >
                          Apply <span aria-hidden="true">→</span>
                        </a>
                      )}
                    </div>
                  </div>

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
                      <p className="text-xs text-neutral-400 italic leading-relaxed border-l-2 border-neutral-700 pl-3">
                        These drafts are starting points. Edit before submitting — your voice
                        matters. Atelier&rsquo;s job is to remove the writing wall, not write
                        under your name.
                      </p>
                      {m.cv_formatted && (
                        <p className="text-xs text-amber-200/90 leading-relaxed bg-amber-500/10 border border-amber-500/30 rounded px-3 py-2">
                          <span className="font-medium">CV trim note:</span> {m.cv_formatted}{' '}
                          The full master CV is in the &ldquo;Your CV&rdquo; section above the
                          opportunity list — trim it to fit this submission.
                        </p>
                      )}
                      <Tabs
                        value={tabByMatch[m.id] ?? 'statement'}
                        onChange={(t) => setTabByMatch((c) => ({ ...c, [m.id]: t }))}
                        tabs={[
                          { key: 'statement', label: 'Statement', disabled: !m.artist_statement },
                          { key: 'proposal', label: 'Proposal', disabled: !m.project_proposal },
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
                <div
                  key={i}
                  className="text-sm text-neutral-300 border-l-2 border-neutral-800 pl-3 py-1 flex items-baseline gap-2 flex-wrap"
                >
                  <span className="text-neutral-500">{f.name}:</span>
                  <span className="flex-1 min-w-0">{f.blurb}</span>
                  {f.url && (
                    <a
                      href={f.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-emerald-300 hover:text-emerald-200 underline shrink-0 no-print"
                    >
                      Apply →
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

/**
 * WALKTHROUGH Note 22-fix.3: master CV rendered ONCE per dossier above the
 * opportunity list. Each per-opp card may surface a TRIM NOTE (in cv_formatted)
 * pointing back here when that opp has a stated CV cap (single-page PDF,
 * 2,000-character limit, etc.). Mirrors how artists actually use CVs in the
 * real world: one PDF uploaded to every application, not 10 custom rewrites.
 */
function MasterCvSection({ runId, masterCv }: { runId: number; masterCv: string }) {
  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-serif text-2xl">Your CV</h2>
        <div className="flex items-center gap-2 no-print">
          <button
            type="button"
            onClick={() => navigator.clipboard.writeText(masterCv)}
            className="rounded border border-neutral-700 px-3 py-1 text-xs hover:bg-neutral-800"
          >
            Copy
          </button>
          <a
            href={`/api/dossier/${runId}/cv/docx`}
            className="rounded border border-neutral-700 px-3 py-1 text-xs hover:bg-neutral-800"
          >
            Download .docx
          </a>
        </div>
      </div>
      <p className="text-xs text-neutral-400 leading-relaxed bg-neutral-900/60 border border-neutral-800 rounded px-3 py-2">
        One canonical CV used across every application below. If a specific opportunity has a
        word, character, or page cap, you&rsquo;ll see a trim note inside that opportunity&rsquo;s
        package — apply it before submitting.
      </p>
      <div className="rounded border border-neutral-800 bg-[#f7f5f1] text-neutral-900 px-10 py-12 print:p-0 print:border-0">
        <article className="font-serif text-[15px] leading-[1.7] whitespace-pre-wrap mx-auto max-w-[40rem]">
          {masterCv}
        </article>
      </div>
    </section>
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

function MaterialExplainer({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs text-neutral-400 leading-relaxed bg-neutral-900/60 border border-neutral-800 rounded px-3 py-2">
      {children}
    </p>
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
        <MaterialExplainer>
          The portfolio images Atelier suggests submitting for <em>this</em> opportunity, with
          a per-image rationale. Most applications limit to 10–20 images — these are the ones
          that best fit this institution&rsquo;s working rubric.
        </MaterialExplainer>
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
        : 'cover_letter';

  const explainer =
    tab === 'statement' ? (
      <>
        Your practice in your own voice. Most applications ask for 250–500 words — paste into
        the &ldquo;Statement of Practice&rdquo; or &ldquo;Artist Statement&rdquo; field. Grounded
        in your portfolio analysis and Knowledge Base; edit to taste before submitting.
      </>
    ) : tab === 'proposal' ? (
      <>
        Used when an opportunity asks <em>what would you do with this funding or residency.</em>{' '}
        Paste into the &ldquo;Project Description&rdquo; or &ldquo;Proposal&rdquo; field. Edit
        the dates and locations to match what you can actually commit to.
      </>
    ) : (
      <>
        Used as the email body or letter-style intro. Most applications either include a
        &ldquo;cover letter&rdquo; field or expect this as the body of your submission email.
        Lead with this.
      </>
    );

  return (
    <div className="space-y-3">
      <MaterialExplainer>{explainer}</MaterialExplainer>
      <div className="flex items-center gap-3 no-print">
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
        <span className="text-[11px] text-neutral-600 ml-auto">
          {text.split(/\s+/).filter(Boolean).length} words
        </span>
      </div>
      {/* Drafted-document presentation: warm off-white "paper" surface,
          generous serif body, narrow measure (~65 char). Mimics the visual
          weight of a real printed institutional packet so the demo can
          linger on this page without it feeling like a textarea. */}
      <div className="rounded border border-neutral-800 bg-[#f7f5f1] text-neutral-900 px-10 py-12 print:p-0 print:border-0">
        <article className="font-serif text-[15px] leading-[1.7] whitespace-pre-wrap mx-auto max-w-[40rem]">
          {text}
        </article>
      </div>
    </div>
  );
}
