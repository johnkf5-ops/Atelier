import { ensureDbReady } from '@/lib/db/client';
import { pollRun } from '@/lib/agents/run-poll';
import { withApiErrorHandling } from '@/lib/api/response';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

export const GET = withApiErrorHandling(
  async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
    await ensureDbReady();
    const { id } = await params;
    const runId = Number(id);
    if (!Number.isInteger(runId)) {
      return Response.json({ error: 'invalid run id' }, { status: 400 });
    }
    return pollRun(req, runId);
  },
);
