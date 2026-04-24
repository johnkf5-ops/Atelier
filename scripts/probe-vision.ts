/**
 * Targeted vision smoke: confirms `read` can view an image file the agent downloaded.
 * Uses picsum.photos which doesn't 403 on curl user-agents like wikipedia does.
 */

import { config } from 'dotenv';
import Anthropic from '@anthropic-ai/sdk';

config({ path: '.env.local' });

const SYSTEM = `You are a vision test agent. When asked, download the image with bash, then view it with the read tool and describe what you see in one sentence. Emit '<DONE>' on the last line.`;

const MSG = `bash: curl -fsSL -o /tmp/vision-probe.jpg "https://picsum.photos/seed/atelier/512/384" && ls -la /tmp/vision-probe.jpg. Then use read to view /tmp/vision-probe.jpg and describe the image in one sentence.`;

async function main() {
  const client = new Anthropic();

  // reuse existing env
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let env: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for await (const e of (client.beta as any).environments.list()) {
    if (e.name === 'atelier-probe') {
      env = e;
      break;
    }
  }
  if (!env) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    env = await (client.beta as any).environments.create({
      name: 'atelier-probe',
      config: { type: 'cloud', networking: { type: 'unrestricted' } },
    });
  }

  // Clean agent
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for await (const a of (client.beta as any).agents.list()) {
    if (a.name === 'Atelier Vision Probe') {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (client.beta as any).agents.archive(a.id);
      } catch { /* ignore */ }
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const agent = await (client.beta as any).agents.create({
    name: 'Atelier Vision Probe',
    model: 'claude-opus-4-7',
    system: SYSTEM,
    tools: [{ type: 'agent_toolset_20260401' }],
  });
  console.log(`agent_id=${agent.id}`);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const session = await (client.beta as any).sessions.create({
    agent: agent.id,
    environment_id: env.id,
    title: 'Vision smoke',
  });
  console.log(`session_id=${session.id}`);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (client.beta as any).sessions.events.send(session.id, {
    events: [{ type: 'user.message', content: [{ type: 'text', text: MSG }] }],
  });

  // Poll until a session.status_idle event arrives
  const t0 = Date.now();
  const seen = new Set<string>();
  const textChunks: string[] = [];
  const toolCalls: string[] = [];
  let stopReason: string | null = null;

  while (Date.now() - t0 < 300_000) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for await (const ev of (client.beta as any).sessions.events.list(session.id, { limit: 200 })) {
      const e = ev as {
        id: string;
        type: string;
        name?: string;
        content?: Array<{ type: string; text?: string }>;
        stop_reason?: { type?: string };
      };
      if (seen.has(e.id)) continue;
      seen.add(e.id);
      if (e.type === 'agent.message' || e.type === 'agent.text') {
        const texts = (e.content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '');
        textChunks.push(...texts);
      }
      if (e.type === 'agent.tool_use') toolCalls.push(e.name ?? '?');
      if (e.type === 'session.status_idle' && e.stop_reason?.type) {
        stopReason = e.stop_reason.type;
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sess = await (client.beta as any).sessions.retrieve(session.id);
    if (sess.status === 'terminated') break;
    if (sess.status === 'idle' && stopReason !== null) break;
    await new Promise((r) => setTimeout(r, 2000));
  }

  console.log('--- TEXT ---');
  console.log(textChunks.join('\n'));
  console.log('\n--- TOOL CALLS ---');
  console.log(toolCalls.join(', '));
  console.log('\nstopReason:', stopReason);

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (client.beta as any).sessions.delete(session.id);
  } catch { /* ignore */ }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
