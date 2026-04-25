/**
 * Test if vision still works when MANY files are mounted simultaneously
 * (mimics the live Rubric session's 95 mounted resources).
 */
import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'fs';
const env = readFileSync('.env.local', 'utf-8');
const parsed = Object.fromEntries(env.split('\n').filter(l => l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i+1).replace(/^"(.*)"$/, '$1')]; }));
const client = new Anthropic({ apiKey: parsed.ANTHROPIC_API_KEY });

// All recipient file_ids from the live run that we know exist
const FILE_IDS = [
  'file_011CaQvZrgePq2tTNwxr6K7Q','file_011CaQvZxBntw4iytuyhLZEe','file_011CaQva3gRtPG3CioshRTzN',
  'file_011CaQvZnGUseXfrdPyjf9DT','file_011CaQvZrn6gtgviHE8VmgW8','file_011CaQvZtZzbGrrZ9wTP3gNQ',
  'file_011CaQvZwXc1qYSBQnfEgxGW','file_011CaQva2ieKVtqgt7G3PsoJ','file_011CaQvZppWyJPRBuJ1bQA3n',
  'file_011CaQva2cSDFqnzrhQnB4qz','file_011CaQva552TVdDD5bErR3WL','file_011CaQvZpkp1xHpaCDSpkr8T',
  'file_011CaQvZrHasz1opH2yiKzW2','file_011CaQvZvA1AQhkQz7dX1chH','file_011CaQva2YDcwGpuBDmRLnB2',
  'file_011CaQva7MgeSi7zE1MfovcQ','file_011CaQvaBZhLL8hDYJckVKQh','file_011CaQvZt1mTiAVXDZA7gziw',
  'file_011CaQva13SMQHpmRPdXHcVy','file_011CaQvZrJpoYbfcmdaBc8RH','file_011CaQvZrn6Z5Mz3BLwrq6uV',
];

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

async function main() {
  console.log(`Mounting ${FILE_IDS.length} files...`);
  const session = await client.beta.sessions.create({
    agent: parsed.RUBRIC_AGENT_ID,
    environment_id: parsed.ATELIER_ENV_ID,
    title: 'probe-many-files',
    resources: FILE_IDS.map((file_id) => ({ type: 'file', file_id })),
  });
  console.log(`session=${session.id}`);

  const firstId = FILE_IDS[0];
  await client.beta.sessions.events.send(session.id, {
    events: [{
      type: 'user.message',
      content: [{ type: 'text', text: `Read /mnt/session/uploads/${firstId} and describe what's in the image. If you cannot see it as an image, say "VISION FAILED". Then read /mnt/session/uploads/${FILE_IDS[1]} and describe that one too.` }],
    }],
  });
  await pollIdle(session.id);
  console.log(`\nAgent reply:`);
  console.log((await lastAgentMessage(session.id)).slice(0, 600));

  try { await client.beta.sessions.delete(session.id); } catch {}
}
main().catch(e => { console.error(e); process.exit(1); });
