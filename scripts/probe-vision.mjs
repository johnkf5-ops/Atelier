/**
 * Probe whether mounted Files API images engage the multimodal vision
 * pipeline in a Managed Agents session. Two candidate paths:
 *
 *   PATH 1: text_editor_20250728 with view command on /mnt/session/uploads/
 *   PATH 2: image content block in user.message referencing file_id
 *
 * Uses an actual portfolio image (recognizable content) so we can verify
 * the agent describes what it sees, not just confirms the file exists.
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

const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

// Use a recognizable test image — Antelope Canyon (one of John's actual subjects)
// from a stable CDN. If this fails to fetch, falls back to a known-good 100x100 colored block.
const TEST_IMAGE_URL = 'https://images.unsplash.com/photo-1578326457399-3b34dbbf23b8?w=400';

async function getTestImage() {
  try {
    const res = await fetch(TEST_IMAGE_URL);
    if (!res.ok) throw new Error('fetch failed');
    return Buffer.from(await res.arrayBuffer());
  } catch (e) {
    console.log(`(test image fetch failed, using 100x100 orange PNG)`);
    // Tiny 100x100 solid orange PNG (encoded inline)
    return Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAGQAAABkCAYAAABw4pVUAAAAVUlEQVR4nO3RAQ0AAAjDMO5fNCCDkE6yC1m6vqYAfS6bYDBYsGDBYrFYsWLBgwYIFCxYsWLBgwYLFiwYIFC4MFCxYsWLBgwYLFiwULFi4MFC9bD//8r4XX6WQAAAABJRU5ErkJggg==',
      'base64'
    );
  }
}

async function pollIdle(sessionId, timeoutMs = 90_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await new Promise(r => setTimeout(r, 3000));
    const status = await client.beta.sessions.retrieve(sessionId);
    if (status.status === 'idle') return status;
  }
  return null;
}

async function lastAgentMessage(sessionId) {
  const events = [];
  for await (const ev of client.beta.sessions.events.list(sessionId)) events.push(ev);
  const m = events.reverse().find(e => e.type === 'agent.message');
  return m?.content?.[0]?.text ?? '(no agent.message)';
}

async function main() {
  const buf = await getTestImage();
  console.log(`Test image: ${buf.length} bytes`);

  console.log('\nUploading to Files API...');
  const blob = new File([new Uint8Array(buf)], 'test.jpg', { type: 'image/jpeg' });
  const file = await client.beta.files.upload({ file: blob });
  console.log(`  → file_id=${file.id}`);
  const mountPath = `/mnt/session/uploads/${file.id}`;

  // PATH 1a: explicit "as an image" hint
  console.log('\n--- PATH 1a: read + "as an image" hint ---');
  let session = await client.beta.sessions.create({
    agent: RUBRIC_AGENT_ID,
    environment_id: ATELIER_ENV_ID,
    title: 'probe-vision-path1a',
    resources: [{ type: 'file', file_id: file.id }],
  });
  await client.beta.sessions.events.send(session.id, {
    events: [{
      type: 'user.message',
      content: [{ type: 'text', text: `Read the file at ${mountPath} as an image (it is a JPEG). Describe what you see in the image — colors, shapes, content. If you cannot view it as an image, say "VISION FAILED". Otherwise describe what you see.` }],
    }],
  });
  await pollIdle(session.id);
  console.log(`  agent reply: ${(await lastAgentMessage(session.id)).slice(0, 300)}`);
  try { await client.beta.sessions.delete(session.id); } catch {}

  // PATH 1b: NO "as an image" hint — same as live Rubric prompt
  console.log('\n--- PATH 1b: bare "read /path" instruction (matches live Rubric) ---');
  session = await client.beta.sessions.create({
    agent: RUBRIC_AGENT_ID,
    environment_id: ATELIER_ENV_ID,
    title: 'probe-vision-path1b',
    resources: [{ type: 'file', file_id: file.id }],
  });
  await client.beta.sessions.events.send(session.id, {
    events: [{
      type: 'user.message',
      content: [{ type: 'text', text: `Read /mnt/session/uploads/${file.id} and describe what's in the file. If you cannot describe it, say "VISION FAILED".` }],
    }],
  });
  await pollIdle(session.id);
  console.log(`  agent reply: ${(await lastAgentMessage(session.id)).slice(0, 300)}`);
  try { await client.beta.sessions.delete(session.id); } catch {}

  // PATH 2: send the image as a content block in the user message
  console.log('\n--- PATH 2: image content block in user.message ---');
  session = await client.beta.sessions.create({
    agent: RUBRIC_AGENT_ID,
    environment_id: ATELIER_ENV_ID,
    title: 'probe-vision-path2',
    // No resources needed — image is in the message itself
  });
  await client.beta.sessions.events.send(session.id, {
    events: [{
      type: 'user.message',
      content: [
        { type: 'image', source: { type: 'file', file_id: file.id } },
        { type: 'text', text: 'Describe what you see in this image — colors, shapes, content. If you cannot see an image, say "VISION FAILED".' },
      ],
    }],
  });
  await pollIdle(session.id);
  console.log(`  agent reply: ${(await lastAgentMessage(session.id)).slice(0, 300)}`);
  try { await client.beta.sessions.delete(session.id); } catch {}

  // PATH 3: image content block + RESOURCES (in case image-as-resource is required for stable cross-message access)
  console.log('\n--- PATH 3: image content block AND resources ---');
  session = await client.beta.sessions.create({
    agent: RUBRIC_AGENT_ID,
    environment_id: ATELIER_ENV_ID,
    title: 'probe-vision-path3',
    resources: [{ type: 'file', file_id: file.id }],
  });
  await client.beta.sessions.events.send(session.id, {
    events: [{
      type: 'user.message',
      content: [
        { type: 'image', source: { type: 'file', file_id: file.id } },
        { type: 'text', text: 'Describe what you see in this image — colors, shapes, content. If you cannot see an image, say "VISION FAILED".' },
      ],
    }],
  });
  await pollIdle(session.id);
  console.log(`  agent reply: ${(await lastAgentMessage(session.id)).slice(0, 300)}`);
  try { await client.beta.sessions.delete(session.id); } catch {}

  try { await client.beta.files.delete(file.id); } catch {}
  console.log('\nDone. The path that returned an actual image description is the one Rubric needs.');
}

main().catch(e => { console.error(e); process.exit(1); });
