import Link from 'next/link';
import { getCurrentUserId } from '@/lib/auth/user';
import { listRunsForUser, formatRelative, type RunSummary } from '@/lib/db/queries/runs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function statusLabel(s: string): { label: string; classes: string } {
  if (s === 'complete') return { label: 'complete', classes: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' };
  if (s === 'error') return { label: 'errored', classes: 'bg-rose-500/10 text-rose-300 border-rose-500/30' };
  if (s === 'cancelled') return { label: 'cancelled', classes: 'bg-neutral-700/30 text-neutral-400 border-neutral-600' };
  return { label: 'running', classes: 'bg-amber-500/10 text-amber-300 border-amber-500/30' };
}

function rowHref(r: RunSummary): string {
  return r.status === 'complete' ? `/dossier/${r.id}` : `/runs/${r.id}`;
}

export default async function RunsPage() {
  const userId = getCurrentUserId();
  const runs = await listRunsForUser(userId);

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between">
        <h1 className="font-serif text-3xl">Runs</h1>
        <Link
          href="/runs/new"
          className="px-4 py-2 bg-neutral-100 text-neutral-900 text-sm rounded hover:bg-white"
        >
          New Run
        </Link>
      </div>

      {runs.length === 0 ? (
        <div className="border border-neutral-800 rounded p-8 text-center space-y-3">
          <p className="text-neutral-300">No runs yet.</p>
          <p className="text-neutral-500 text-sm">
            Start a run to let Atelier surface opportunities that fit your portfolio.
          </p>
          <Link
            href="/runs/new"
            className="inline-block px-4 py-2 bg-neutral-100 text-neutral-900 text-sm rounded hover:bg-white"
          >
            Start your first run
          </Link>
        </div>
      ) : (
        <div className="border border-neutral-800 rounded divide-y divide-neutral-800">
          {runs.map((r) => {
            const s = statusLabel(r.status);
            return (
              <Link
                key={r.id}
                href={rowHref(r)}
                className="block px-4 py-3 hover:bg-neutral-900/50 transition-colors"
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-neutral-500 text-sm">#{r.id}</span>
                    <span
                      className={`px-2 py-0.5 text-xs rounded border ${s.classes}`}
                    >
                      {s.label}
                    </span>
                    <span className="text-sm text-neutral-400">{formatRelative(r.started_at)}</span>
                  </div>
                  <div className="text-xs text-neutral-500">
                    {r.discovered_count} discovered · {r.scored_count} scored · {r.included_count} included
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
