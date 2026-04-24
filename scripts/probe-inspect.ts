import { config } from 'dotenv';
import Anthropic from '@anthropic-ai/sdk';

config({ path: '.env.local' });

const sessionId = process.argv[2];
if (!sessionId) {
  console.error('usage: probe-inspect.ts <session_id>');
  process.exit(1);
}

async function main() {
  const client = new Anthropic();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sess = await (client.beta as any).sessions.retrieve(sessionId);
  console.log('session:', JSON.stringify({ status: sess.status, stop_reason: sess.stop_reason, created_at: sess.created_at }, null, 2));

  console.log('\n--- events ---');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const it = (client.beta as any).sessions.events.list(sessionId, { limit: 200 });
  let n = 0;
  const typeCount: Record<string, number> = {};
  for await (const ev of it) {
    n++;
    const e = ev as { id: string; type: string; content?: unknown; name?: string; stop_reason?: unknown };
    typeCount[e.type] = (typeCount[e.type] ?? 0) + 1;
    if (n <= 20 || /tool_use|custom_tool/.test(e.type) || /status_idle/.test(e.type)) {
      console.log(`${n}. ${e.type}${e.name ? ` name=${e.name}` : ''}${e.stop_reason ? ` stop=${JSON.stringify(e.stop_reason)}` : ''}`);
    }
  }
  console.log(`\nTotal: ${n} events`);
  console.log('By type:', typeCount);
}

main().catch((e) => console.error(e));
