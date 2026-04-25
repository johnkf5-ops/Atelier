import Link from 'next/link';
import { getCurrentUserId } from '@/lib/auth/user';
import { ensureDbReady } from '@/lib/db/client';
import { listRunsForUser, formatRelative, type RunSummary } from '@/lib/db/queries/runs';
import { PageHeader, LinkButton, Badge, EmptyState } from '@/app/_components/ui';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function statusBadge(s: string) {
  if (s === 'complete') return <Badge variant="success">complete</Badge>;
  if (s === 'error') return <Badge variant="danger">errored</Badge>;
  if (s === 'cancelled') return <Badge variant="neutral">cancelled</Badge>;
  return <Badge variant="warning">running</Badge>;
}

function rowHref(r: RunSummary): string {
  return r.status === 'complete' ? `/dossier/${r.id}` : `/runs/${r.id}`;
}

export default async function RunsPage() {
  await ensureDbReady();
  const userId = getCurrentUserId();
  const runs = await listRunsForUser(userId);

  return (
    <div>
      <PageHeader
        eyebrow="Step 4"
        title="Runs"
        subtitle="Each run scans for new opportunities, scores them against your work, and drafts application materials for the matches that fit."
        action={
          runs.length > 0 ? (
            <LinkButton href="/runs/new" variant="primary">
              New run
            </LinkButton>
          ) : undefined
        }
      />

      {runs.length === 0 ? (
        <EmptyState
          title="No runs yet"
          body="Start a run to let Atelier surface opportunities that fit your portfolio. A typical run takes 20–30 minutes."
          cta={
            <LinkButton href="/runs/new" variant="primary">
              Start your first run →
            </LinkButton>
          }
        />
      ) : (
        <div className="rounded-lg border border-neutral-800 divide-y divide-neutral-800 overflow-hidden">
          {runs.map((r) => (
            <Link
              key={r.id}
              href={rowHref(r)}
              className="block px-5 py-4 hover:bg-neutral-900/60 transition-colors"
            >
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <span className="font-mono text-neutral-500 text-sm">#{r.id}</span>
                  {statusBadge(r.status)}
                  <span className="text-sm text-neutral-300">{formatRelative(r.started_at)}</span>
                </div>
                <div className="text-xs text-neutral-500 tabular-nums">
                  {r.discovered_count} discovered · {r.scored_count} scored ·{' '}
                  <span className="text-emerald-400">{r.included_count}</span> drafted
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
