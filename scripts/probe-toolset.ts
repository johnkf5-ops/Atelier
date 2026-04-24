/**
 * §3.0.b.0 capability probe. Run: pnpm tsx scripts/probe-toolset.ts
 *
 * Step 1 — agent_toolset_20260401 bundle test (web_search + web_fetch + read).
 * Step 2 — individual-tool fallback (only triggered if Step 1 fails).
 * Step 3 — REQUIRED vision smoke via text_editor_20250728 view
 *          (only triggered in the Step-2 fallback branch).
 *
 * At least one path MUST be green before §3.0.b.
 *
 * Cleanup: archives the temp agent + deletes the session at the end.
 */

import { config as dotenvConfig } from 'dotenv';
import Anthropic from '@anthropic-ai/sdk';

// Script runs outside Next — load .env.local explicitly so ANTHROPIC_API_KEY is available.
dotenvConfig({ path: '.env.local' });
dotenvConfig({ path: '.env' });

const ENV_NAME = 'atelier-probe';
const AGENT_NAME = 'Atelier Probe Agent';

const PROBE_MESSAGE = `1) web_search for 'anthropic claude' and return one URL.
2) web_fetch https://example.com and return the page title.
3) bash curl -fsSL -o /tmp/probe.jpg https://upload.wikimedia.org/wikipedia/commons/thumb/4/47/PNG_transparency_demonstration_1.png/120px-PNG_transparency_demonstration_1.png && read /tmp/probe.jpg and tell me what you see.

After each: report 'OK: <evidence>' or 'FAIL: <error>' on ONE LINE, then move to the next.`;

const SYSTEM = `You are a tool capability checker. When the user asks, perform the requested operation. After each operation, report ONE LINE 'OK: <evidence>' or 'FAIL: <error>'. Continue past failures to test all three. When all three are attempted, emit '<DONE>' on the last line and stop.`;

async function createEnv(client: Anthropic) {
  // Reuse existing atelier-probe env if present
  for await (const e of client.beta.environments.list()) {
    if ((e as { name: string }).name === ENV_NAME) {
      return e;
    }
  }
  return await client.beta.environments.create({
    name: ENV_NAME,
    config: { type: 'cloud', networking: { type: 'unrestricted' } },
  } as unknown as Parameters<typeof client.beta.environments.create>[0]);
}

async function createAgent(client: Anthropic, tools: unknown[]) {
  for await (const a of client.beta.agents.list()) {
    if ((a as { name: string }).name === AGENT_NAME) {
      // Archive stale instance so we can recreate with new config
      try {
        await (client.beta.agents as unknown as { archive: (id: string) => Promise<unknown> }).archive((a as { id: string }).id);
      } catch {
        /* archive may not be supported on this version; continue */
      }
      break;
    }
  }
  return await client.beta.agents.create({
    name: AGENT_NAME,
    model: 'claude-opus-4-7',
    system: SYSTEM,
    tools,
  } as unknown as Parameters<typeof client.beta.agents.create>[0]);
}

async function runProbe(label: string, tools: unknown[]) {
  console.log(`\n=== ${label} ===`);
  const client = new Anthropic();
  const env = (await createEnv(client)) as { id: string };
  console.log(`env_id=${env.id}`);
  const agent = (await createAgent(client, tools)) as { id: string };
  console.log(`agent_id=${agent.id}`);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const session = (await (client.beta as any).sessions.create({
    agent: agent.id,
    environment_id: env.id,
    title: `Probe ${label}`,
  })) as { id: string };
  console.log(`session_id=${session.id}`);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (client.beta as any).sessions.events.send(session.id, {
    events: [
      {
        type: 'user.message',
        content: [{ type: 'text', text: PROBE_MESSAGE }],
      },
    ],
  });

  const finalText = await pollUntilIdle(client, session.id, 300_000);
  console.log(`\n--- FINAL TEXT ---\n${finalText}\n`);

  // Cleanup session
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (client.beta as any).sessions.delete(session.id);
    console.log(`deleted session ${session.id}`);
  } catch (err) {
    console.warn(`session cleanup warning: ${(err as Error).message}`);
  }

  return finalText;
}

async function pollUntilIdle(client: Anthropic, sessionId: string, timeoutMs: number): Promise<string> {
  const t0 = Date.now();
  const textChunks: string[] = [];
  const seenIds = new Set<string>();
  const toolCalls: string[] = [];
  let lastIdleStopReason: string | null = null;

  while (Date.now() - t0 < timeoutMs) {
    // Iterate all events each poll; dedupe via seenIds. SDK's async iteration
    // auto-paginates pages.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for await (const ev of (client.beta as any).sessions.events.list(sessionId, { limit: 200 })) {
      const e = ev as {
        id: string;
        type: string;
        content?: Array<{ type: string; text?: string; name?: string }>;
        name?: string;
        stop_reason?: { type?: string };
      };
      if (seenIds.has(e.id)) continue;
      seenIds.add(e.id);
      if (e.type === 'agent.message' || e.type === 'agent.text') {
        const texts = (e.content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '');
        textChunks.push(...texts);
      }
      if (e.type === 'agent.tool_use') {
        toolCalls.push(`tool_use: ${e.name ?? 'unknown'}`);
      }
      if (e.type === 'session.status_idle' && e.stop_reason?.type) {
        lastIdleStopReason = e.stop_reason.type;
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sess = (await (client.beta as any).sessions.retrieve(sessionId)) as { status: string };
    if (sess.status === 'terminated') {
      if (toolCalls.length) textChunks.push(`\n[tool-calls observed: ${toolCalls.join(', ')}]`);
      return textChunks.join('\n');
    }
    // Only treat idle as terminal once we've observed a session.status_idle
    // event with a stop_reason (i.e., the agent actually finished a turn).
    // Sessions can briefly show status=idle right after creation, before
    // the first user.message triggers running.
    if (sess.status === 'idle' && lastIdleStopReason !== null) {
      if (lastIdleStopReason === 'requires_action') {
        return textChunks.join('\n') + `\n[warning: session idle with requires_action]`;
      }
      if (toolCalls.length) textChunks.push(`\n[tool-calls observed: ${toolCalls.join(', ')}]`);
      textChunks.push(`[session idle, stop=${lastIdleStopReason}]`);
      return textChunks.join('\n');
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`poll timeout after ${timeoutMs}ms`);
}

async function main() {
  const args = process.argv.slice(2);
  const mode = args[0] ?? 'all';

  try {
    if (mode === 'step1' || mode === 'all') {
      const out1 = await runProbe('Step 1 — agent_toolset_20260401 bundle', [
        { type: 'agent_toolset_20260401' },
      ]);
      const step1Pass = /OK:\s+.*anthropic|OK:\s+.*example\.com|OK:\s+.*image/i.test(out1);
      console.log(`Step 1 overall: ${step1Pass ? 'AT LEAST ONE OK' : 'NO OK OBSERVED'}`);
      if (mode === 'step1') return;
    }

    if (mode === 'step2' || mode === 'all') {
      await runProbe('Step 2 — individual tool fallback', [
        { type: 'bash_20250124', name: 'bash' },
        { type: 'text_editor_20250728', name: 'str_replace_based_edit_tool' },
        { type: 'web_search_20250305', name: 'web_search', max_uses: 3 },
        { type: 'web_fetch_20250910', name: 'web_fetch' },
      ]);
    }

    if (mode === 'step3' || mode === 'all') {
      // Vision smoke with the same fallback tools — asks the agent to use `view`
      const out3 = await runProbe('Step 3 — vision smoke via text_editor view', [
        { type: 'bash_20250124', name: 'bash' },
        { type: 'text_editor_20250728', name: 'str_replace_based_edit_tool' },
      ]);
      const hasVision =
        /transparenc|dice|cube|geometric|png|squares?|colors?|checker/i.test(out3);
      console.log(`Step 3 vision smoke: ${hasVision ? 'PASS (image described)' : 'FAIL (no description)'}`);
    }
  } catch (err) {
    console.error(`probe error: ${(err as Error).message}`);
    process.exitCode = 1;
  }
}

main();
