import { AutoDiscoverInput } from '@/lib/schemas/discovery';
import { discoverArtist, parseDiscovery, type DiscoveryEvent } from '@/lib/extractor/auto-discover';
import { ensureDbReady, getDb } from '@/lib/db/client';
import { getCurrentUserId } from '@/lib/auth/user';

export const runtime = 'nodejs';
export const maxDuration = 90; // discovery can take 30-60s

export async function POST(req: Request) {
  await ensureDbReady();
  const input = AutoDiscoverInput.parse(await req.json());
  const userId = getCurrentUserId();

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: DiscoveryEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
      };

      try {
        send({ type: 'started' });

        const { rawText, queries, usage, snippetsByUrl } = await discoverArtist(input, send);

        send({ type: 'parsing' });
        const result = await parseDiscovery(rawText, queries, snippetsByUrl);

        // Cost tracking — log to run_events with run_id=NULL (not tied to a Run yet)
        const db = getDb();
        await db.execute({
          sql: `INSERT INTO run_events (run_id, agent, kind, payload_json) VALUES (NULL, ?, ?, ?)`,
          args: [
            'auto-discover',
            'output',
            JSON.stringify({
              user_id: userId,
              input,
              queries,
              usage,
              result_count: result.discovered.length,
            }),
          ],
        });

        send({ type: 'complete', result, usage });
      } catch (e) {
        const err = e as { message?: string };
        send({ type: 'error', message: err?.message ?? String(e) });
      } finally {
        controller.close();
      }
    },
    cancel() {
      // Browser navigated away. The Anthropic call continues server-side and incurs
      // its committed cost; we can't actually cancel the API call mid-flight. Acceptable.
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // disables proxy buffering
    },
  });
}
