/**
 * Minimal repro to test which mount_path patterns actually work for FILE
 * resources in a Managed Agents session. Diagnoses why our /workspace/
 * portfolio/<id>.jpg paths return "File not found or empty".
 *
 * Tests three patterns against the SAME uploaded file:
 *   A) custom mount under /workspace/  (current Atelier convention — failing)
 *   B) custom mount under /mnt/        (alternative)
 *   C) default mount (no mount_path)   (defaults to /mnt/session/uploads/<file_id>)
 *
 * Reports which pattern's path is readable by the agent.
 */
import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'fs';

const env = readFileSync('.env.local', 'utf-8');
const parsed = Object.fromEntries(
  env.split('\n').filter(l => l.includes('=')).map(l => {
    const i = l.indexOf('=');
    return [l.slice(0, i), l.slice(i+1).replace(/^"(.*)"$/, '$1')];
  })
);

const ANTHROPIC_API_KEY = parsed.ANTHROPIC_API_KEY;
const RUBRIC_AGENT_ID = parsed.RUBRIC_AGENT_ID;
const ATELIER_ENV_ID = parsed.ATELIER_ENV_ID;

if (!ANTHROPIC_API_KEY || !RUBRIC_AGENT_ID || !ATELIER_ENV_ID) {
  console.error('Missing env: ANTHROPIC_API_KEY / RUBRIC_AGENT_ID / ATELIER_ENV_ID');
  process.exit(1);
}

const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

// 1×1 white JPEG
const TINY_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP////////////////////////////////////////////////////' +
  '////////////////////////////2wBDAf//////////////////////////////////////////////////' +
  '/////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAr/xAAUEAEAAAAAA' +
  'AAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AKpwH//Z',
  'base64'
);

async function main() {
  console.log('Uploading test JPEG to Files API...');
  const blob = new File([new Uint8Array(TINY_JPEG)], 'probe.jpg', { type: 'image/jpeg' });
  const file = await client.beta.files.upload({ file: blob });
  console.log(`  → file_id=${file.id}`);

  const tests = [
    { label: 'A) /workspace custom', mount_path: '/workspace/probe-A.jpg' },
    { label: 'B) /mnt custom', mount_path: '/mnt/probe-B.jpg' },
    { label: 'C) default (no mount_path)', mount_path: undefined },
  ];

  // Each test uses the SAME file but a different mount_path. Run as 3 parallel
  // sessions so they don't interfere.
  for (const t of tests) {
    console.log(`\n--- TEST ${t.label} ---`);
    const resourceObj = { type: 'file', file_id: file.id };
    if (t.mount_path) resourceObj.mount_path = t.mount_path;

    const session = await client.beta.sessions.create({
      agent: RUBRIC_AGENT_ID,
      environment_id: ATELIER_ENV_ID,
      title: `probe ${t.label}`,
      resources: [resourceObj],
    });
    console.log(`  session.id=${session.id}`);

    const expectedPath = t.mount_path ?? `/mnt/session/uploads/${file.id}`;
    console.log(`  expected path: ${expectedPath}`);

    await client.beta.sessions.events.send(session.id, {
      events: [
        {
          type: 'user.message',
          content: [{ type: 'text', text: `Read the file at ${expectedPath} and tell me whether it exists. Just say "FOUND: <bytes>" or "NOT FOUND: <reason>". Do not do anything else.` }],
        },
      ],
    });

    // Poll for terminal idle
    let done = false;
    const start = Date.now();
    while (!done && Date.now() - start < 60_000) {
      await new Promise(r => setTimeout(r, 3000));
      const status = await client.beta.sessions.retrieve(session.id);
      if (status.status === 'idle') done = true;
    }

    // Read the events to find the agent's text response
    const events = [];
    for await (const ev of client.beta.sessions.events.list(session.id)) {
      events.push(ev);
    }
    const lastMessage = events.reverse().find(e => e.type === 'agent.message');
    if (lastMessage) {
      const text = (lastMessage.content?.[0]?.text || '').slice(0, 200);
      console.log(`  agent reply: ${text}`);
    } else {
      console.log(`  no agent.message event found`);
    }

    // Cleanup
    try { await client.beta.sessions.delete(session.id); } catch { /* fine */ }
  }

  // Cleanup
  try { await client.beta.files.delete(file.id); } catch { /* fine */ }
  console.log('\nDone. Compare which test patterns returned FOUND vs NOT FOUND.');
}

main().catch(e => { console.error(e); process.exit(1); });
