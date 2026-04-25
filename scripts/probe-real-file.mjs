/**
 * Test vision against an actual file_id from the live finalize-scout
 * upload. If THIS works, the issue isn't the file or the upload — it's
 * something about how the live Rubric session handles them at scale.
 */
import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'fs';
const env = readFileSync('.env.local', 'utf-8');
const parsed = Object.fromEntries(env.split('\n').filter(l => l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i+1).replace(/^"(.*)"$/, '$1')]; }));
const client = new Anthropic({ apiKey: parsed.ANTHROPIC_API_KEY });

const FILE_ID = 'file_011CaQvZrgePq2tTNwxr6K7Q'; // recipient image from live run

async function pollIdle(sessionId, timeoutMs = 90_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await new Promise(r => setTimeout(r, 3000));
    const status = await client.beta.sessions.retrieve(sessionId);
    if (status.status === 'idle') return status;
  }
}

async function lastAgentMessage(sessionId) {
  const events = [];
  for await (const ev of client.beta.sessions.events.list(sessionId)) events.push(ev);
  const m = events.reverse().find(e => e.type === 'agent.message');
  return m?.content?.[0]?.text ?? '(no agent.message)';
}

async function lastToolResult(sessionId) {
  const events = [];
  for await (const ev of client.beta.sessions.events.list(sessionId)) events.push(ev);
  const tr = events.reverse().find(e => e.type === 'agent.tool_result' || e.type === 'tool_result');
  return tr ? JSON.stringify(tr.content ?? tr.output ?? tr).slice(0, 400) : '(no tool_result)';
}

async function main() {
  // Check if the file still exists (might have been deleted by run cleanup)
  const session = await client.beta.sessions.create({
    agent: parsed.RUBRIC_AGENT_ID,
    environment_id: parsed.ATELIER_ENV_ID,
    title: 'probe-real-file',
    resources: [{ type: 'file', file_id: FILE_ID }],
  });
  console.log(`session=${session.id}, file=${FILE_ID}`);

  await client.beta.sessions.events.send(session.id, {
    events: [{
      type: 'user.message',
      content: [{ type: 'text', text: `Read /mnt/session/uploads/${FILE_ID} and describe what's in the image. If you cannot see it as an image, say "VISION FAILED".` }],
    }],
  });
  await pollIdle(session.id);
  console.log(`\nLast agent message:`);
  console.log((await lastAgentMessage(session.id)).slice(0, 500));
  console.log(`\nLast tool result:`);
  console.log(await lastToolResult(session.id));

  try { await client.beta.sessions.delete(session.id); } catch {}
}
main().catch(e => { console.error(e); process.exit(1); });
