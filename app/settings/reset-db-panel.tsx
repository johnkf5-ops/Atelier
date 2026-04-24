'use client';

import { useState } from 'react';
import { fetchJson } from '@/lib/api/fetch-client';

/**
 * Dev-only reset button. The server returns 403 if
 * ATELIER_IS_RESETTABLE_DB isn't true, so in production this renders
 * but clicking does nothing destructive.
 */
export default function ResetDbPanel() {
  const [status, setStatus] = useState<
    | { kind: 'idle' }
    | { kind: 'confirming' }
    | { kind: 'working' }
    | { kind: 'ok'; dropped: number; present: number }
    | { kind: 'err'; error: string }
  >({ kind: 'idle' });

  async function doReset() {
    setStatus({ kind: 'working' });
    const result = await fetchJson<{ reset: boolean; dropped: number; tables_present: number }>(
      '/api/admin/reset',
      { method: 'POST' },
    );
    if (!result.ok) {
      setStatus({ kind: 'err', error: result.error });
      return;
    }
    setStatus({
      kind: 'ok',
      dropped: result.data.dropped,
      present: result.data.tables_present,
    });
  }

  return (
    <section className="space-y-3 border border-rose-500/20 bg-rose-500/5 rounded p-4">
      <div>
        <h2 className="text-sm uppercase tracking-wide text-rose-300">Danger zone</h2>
        <p className="text-xs text-neutral-400 mt-1">
          Drops every table, rebuilds schema, re-seeds the default user, verifies every expected
          table exists. Only enabled when <code className="text-neutral-200">ATELIER_IS_RESETTABLE_DB=true</code>
          {' '}is set in <code className="text-neutral-200">.env.local</code>.
        </p>
      </div>

      {status.kind === 'idle' && (
        <button
          type="button"
          onClick={() => setStatus({ kind: 'confirming' })}
          className="text-sm px-4 py-2 border border-rose-500/40 rounded hover:bg-rose-500/10 text-rose-200"
        >
          Reset database
        </button>
      )}

      {status.kind === 'confirming' && (
        <div className="flex items-center gap-3 text-sm">
          <span className="text-rose-200">Drop all tables + reseed?</span>
          <button
            type="button"
            onClick={doReset}
            className="px-3 py-1.5 bg-rose-600 text-white rounded hover:bg-rose-500"
          >
            Yes, reset
          </button>
          <button
            type="button"
            onClick={() => setStatus({ kind: 'idle' })}
            className="px-3 py-1.5 border border-neutral-700 rounded hover:bg-neutral-800"
          >
            Cancel
          </button>
        </div>
      )}

      {status.kind === 'working' && (
        <p className="text-sm text-neutral-300">Resetting…</p>
      )}

      {status.kind === 'ok' && (
        <p className="text-sm text-emerald-300">
          Reset complete — dropped {status.dropped} table{status.dropped === 1 ? '' : 's'},{' '}
          {status.present} present. DB is ready.
        </p>
      )}

      {status.kind === 'err' && (
        <p className="text-sm text-rose-300">Reset failed: {status.error}</p>
      )}
    </section>
  );
}
