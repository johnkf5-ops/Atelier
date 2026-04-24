import { pollRun } from '@/lib/agents/run-poll';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const runId = Number(id);
  if (!Number.isInteger(runId)) {
    return Response.json({ error: 'invalid run id' }, { status: 400 });
  }
  return pollRun(req, runId);
}
