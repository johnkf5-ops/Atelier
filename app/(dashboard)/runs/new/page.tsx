import Link from 'next/link';
import { ensureDbReady, getDb } from '@/lib/db/client';
import { getCurrentUserId } from '@/lib/auth/user';
import { getPortfolioCount } from '@/lib/db/queries/portfolio';
import NewRunClient from './new-run-client';
import { PageHeader, Card } from '@/app/_components/ui';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function NewRunPage() {
  await ensureDbReady();
  const userId = getCurrentUserId();
  const db = getDb();

  const fpRow = (
    await db.execute({
      sql: `SELECT version, created_at FROM style_fingerprints
            WHERE user_id = ? ORDER BY version DESC LIMIT 1`,
      args: [userId],
    })
  ).rows[0] as unknown as { version: number; created_at: number } | undefined;

  const akbRow = (
    await db.execute({
      sql: `SELECT version, created_at FROM akb_versions
            WHERE user_id = ? ORDER BY version DESC LIMIT 1`,
      args: [userId],
    })
  ).rows[0] as unknown as { version: number; created_at: number } | undefined;

  const portfolioCount = await getPortfolioCount(userId);
  const ready = Boolean(fpRow) && Boolean(akbRow) && portfolioCount > 0;

  return (
    <div className="max-w-2xl">
      <Link
        href="/runs"
        className="text-xs text-neutral-500 hover:text-neutral-300 inline-block mb-4"
      >
        ← Runs
      </Link>
      <PageHeader
        title="Start a new run"
        subtitle="Atelier surfaces opportunities as institutions open new cycles. Re-run every two to four weeks, or whenever you update your portfolio or Knowledge Base."
      />

      <Card className="space-y-0 divide-y divide-neutral-800 p-0">
        <PreflightRow
          label="Portfolio"
          value={`${portfolioCount} image${portfolioCount === 1 ? '' : 's'}`}
          ready={portfolioCount > 0}
        />
        <PreflightRow
          label="Style fingerprint"
          value={fpRow ? `v${fpRow.version}` : 'not yet built'}
          ready={!!fpRow}
        />
        <PreflightRow
          label="Knowledge Base"
          value={akbRow ? `v${akbRow.version}` : 'not yet built'}
          ready={!!akbRow}
        />
      </Card>

      <div className="mt-6">
        {ready ? (
          <NewRunClient />
        ) : (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-amber-200">
            Finish{' '}
            {portfolioCount === 0 && (
              <Link href="/upload" className="underline">
                upload
              </Link>
            )}
            {portfolioCount === 0 && !fpRow && ', '}
            {!fpRow && (
              <Link href="/upload" className="underline">
                style analysis
              </Link>
            )}
            {!akbRow && (fpRow || portfolioCount > 0) && ', '}
            {!akbRow && (
              <Link href="/interview" className="underline">
                Knowledge Base
              </Link>
            )}{' '}
            before starting a run.
          </div>
        )}
      </div>
    </div>
  );
}

function PreflightRow({ label, value, ready }: { label: string; value: string; ready: boolean }) {
  return (
    <div className="px-5 py-3 flex justify-between items-center text-sm">
      <span className="text-neutral-400">{label}</span>
      <span className={`tabular-nums ${ready ? 'text-emerald-300' : 'text-rose-400'}`}>
        {value}
      </span>
    </div>
  );
}
