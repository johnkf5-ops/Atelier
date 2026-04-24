import { describe, it, expect } from 'vitest';
import { createClient } from '@libsql/client';

describe('health — Turso DB', () => {
  it('SELECT 1 returns 1', async () => {
    const db = createClient({
      url: process.env.TURSO_DATABASE_URL!,
      authToken: process.env.TURSO_AUTH_TOKEN!,
    });
    const r = await db.execute('SELECT 1 as ok');
    expect(r.rows[0].ok).toBe(1);
  });
});

describe('health — Anthropic API', () => {
  it('messages.create one-token round-trip succeeds', async () => {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const resp = await client.messages.create({
      model: 'claude-opus-4-7',
      max_tokens: 8,
      messages: [{ role: 'user', content: 'Say hi.' }],
    });
    expect(resp.usage.input_tokens).toBeGreaterThan(0);
    expect(resp.stop_reason).toBeTruthy();
  });
});
