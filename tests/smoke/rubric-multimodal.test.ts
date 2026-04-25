import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  buildRubricSetupMessage,
  buildRubricOppMessage,
  type PortfolioRef,
  type OpportunityForRubric,
} from '@/lib/agents/rubric-matcher';

/**
 * WALKTHROUGH Note 29 (CRITICAL — production vision unlock):
 *
 * Notes 27 (mount path) and 28 (Sharp normalize) were necessary preconditions
 * but not sufficient. At session scale (95 mounted resources + a large
 * Rubric prompt), the Anthropic read tool silently switches to text-only
 * mode. The fix is architectural: drop session resources entirely, send
 * images as image content blocks in user.message events, work through
 * opportunities one user.message at a time.
 *
 * This suite locks the new multimodal contract structurally:
 *   - startRubricSession does NOT pass `resources` to sessions.create
 *   - the setup message contains portfolio image content blocks +
 *     workflow text (one round-trip; portfolio stays in agent context)
 *   - each per-opp message contains recipient image content blocks +
 *     a per-opp scoring text block (sequential queue)
 *   - the Rubric prompt no longer references /mnt/session/uploads/ paths
 *     or the read tool — vision is in-message, not via mount
 *
 * Live coverage stays in scripts/probe-vision.mjs Path 2 (multi-image
 * variant) for Anthropic-side regression.
 */

const { sessionsCreate, eventsSend } = vi.hoisted(() => ({
  sessionsCreate: vi.fn(),
  eventsSend: vi.fn(),
}));

vi.mock('@/lib/anthropic-retry', () => ({
  withAnthropicRetry: async <T>(fn: () => Promise<T>): Promise<T> => fn(),
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: class FakeAnthropic {
    beta = {
      sessions: {
        create: sessionsCreate,
        events: { send: eventsSend },
      },
    };
  },
}));

vi.mock('@/lib/db/client', () => ({
  getDb: () => ({ execute: vi.fn().mockResolvedValue({ rows: [], rowsAffected: 0 }) }),
}));

vi.mock('@/lib/auth/api-key', () => ({
  getAnthropicKey: () => 'sk-ant-mock',
}));

const portfolio: PortfolioRef[] = [
  { id: 1, thumb_url: 'https://example.com/1.jpg', file_id: 'file_p1' },
  { id: 6, thumb_url: 'https://example.com/6.jpg', file_id: 'file_p6' },
  { id: 11, thumb_url: 'https://example.com/11.jpg', file_id: 'file_p11' },
  // Image without a file_id — must be skipped from content blocks.
  { id: 99, thumb_url: 'https://example.com/99.jpg' },
];

const opp1: OpportunityForRubric = {
  id: 1,
  name: 'Test Award',
  url: 'https://example.com/award',
  prestige_tier: 'mid',
  past_recipients: [
    {
      name: 'Mark Chen',
      year: 2023,
      image_urls: ['https://example.com/mark1.jpg'],
      file_ids: ['file_r1', 'file_r2'],
    },
    {
      name: 'Empty Recipient',
      year: 2024,
      image_urls: [],
      file_ids: [],
    },
  ],
};

const opp2: OpportunityForRubric = {
  id: 2,
  name: 'Second Award',
  url: 'https://example.com/award2',
  prestige_tier: 'flagship',
  past_recipients: [
    {
      name: 'Solo Recipient',
      year: 2022,
      image_urls: ['https://example.com/solo.jpg'],
      file_ids: ['file_r3'],
    },
  ],
};

beforeEach(() => {
  sessionsCreate.mockReset();
  eventsSend.mockReset();
  sessionsCreate.mockResolvedValue({ id: 'session_mock' });
  eventsSend.mockResolvedValue({});
});

describe('buildRubricSetupMessage — Note 29 contract', () => {
  it('returns a user.message with portfolio image content blocks first, then a text block', () => {
    const m = buildRubricSetupMessage(
      { identity: { artist_name: 'A' } } as never,
      { career_positioning_read: 'r' } as never,
      portfolio,
      [opp1, opp2],
    );
    expect(m.type).toBe('user.message');
    // First N entries are image blocks; last is a text block.
    const last = m.content[m.content.length - 1];
    expect(last.type).toBe('text');
    const imageBlocks = m.content.filter((c) => c.type === 'image');
    expect(imageBlocks.length).toBe(3); // id=99 has no file_id → skipped
    for (const b of imageBlocks) {
      expect(b).toEqual({ type: 'image', source: { type: 'file', file_id: expect.any(String) } });
    }
  });

  it('image content blocks reference the correct file_ids in portfolio order', () => {
    const m = buildRubricSetupMessage(
      { identity: { artist_name: 'A' } } as never,
      { career_positioning_read: 'r' } as never,
      portfolio,
      [opp1],
    );
    const ids = m.content
      .filter((c): c is { type: 'image'; source: { type: 'file'; file_id: string } } => c.type === 'image')
      .map((c) => c.source.file_id);
    expect(ids).toEqual(['file_p1', 'file_p6', 'file_p11']);
  });

  it('text block lists portfolio image_ids the agent should reference in persist_match', () => {
    const m = buildRubricSetupMessage(
      { identity: { artist_name: 'A' } } as never,
      { career_positioning_read: 'r' } as never,
      portfolio,
      [opp1],
    );
    const text = (m.content[m.content.length - 1] as { type: 'text'; text: string }).text;
    expect(text).toMatch(/image_ids in order are:\s*\[1, 6, 11\]/);
  });

  it('text block lists each opportunity by id, name, prestige, url', () => {
    const m = buildRubricSetupMessage(
      { identity: { artist_name: 'A' } } as never,
      { career_positioning_read: 'r' } as never,
      portfolio,
      [opp1, opp2],
    );
    const text = (m.content[m.content.length - 1] as { type: 'text'; text: string }).text;
    expect(text).toMatch(/OPPORTUNITY id=1, prestige=mid: "Test Award" \(https:\/\/example\.com\/award\)/);
    expect(text).toMatch(/OPPORTUNITY id=2, prestige=flagship: "Second Award" \(https:\/\/example\.com\/award2\)/);
  });

  it('does NOT reference /mnt/session/uploads or the read tool anywhere', () => {
    const m = buildRubricSetupMessage(
      { identity: { artist_name: 'A' } } as never,
      { career_positioning_read: 'r' } as never,
      portfolio,
      [opp1],
    );
    const text = (m.content[m.content.length - 1] as { type: 'text'; text: string }).text;
    expect(text).not.toMatch(/\/mnt\/session\/uploads\//);
    expect(text).not.toMatch(/\/workspace\//);
    expect(text).not.toMatch(/\bread tool\b/i);
  });
});

describe('buildRubricOppMessage — Note 29 contract', () => {
  it('returns a user.message with recipient image content blocks first, then a text block', () => {
    const m = buildRubricOppMessage(opp1);
    expect(m.type).toBe('user.message');
    const imageBlocks = m.content.filter((c) => c.type === 'image');
    expect(imageBlocks.length).toBe(2); // Mark Chen has 2; Empty Recipient skipped
    expect(m.content[m.content.length - 1].type).toBe('text');
  });

  it('image content blocks reference the correct recipient file_ids', () => {
    const m = buildRubricOppMessage(opp1);
    const ids = m.content
      .filter((c): c is { type: 'image'; source: { type: 'file'; file_id: string } } => c.type === 'image')
      .map((c) => c.source.file_id);
    expect(ids).toEqual(['file_r1', 'file_r2']);
  });

  it('text block names the opportunity_id, recipient names, and image counts', () => {
    const m = buildRubricOppMessage(opp1);
    const text = (m.content[m.content.length - 1] as { type: 'text'; text: string }).text;
    expect(text).toMatch(/OPPORTUNITY id=1, prestige=mid: "Test Award"/);
    expect(text).toMatch(/Mark Chen \(2023\):\s*2 images above/);
    expect(text).toMatch(/Empty Recipient \(2024\):\s*no images available/);
    expect(text).toMatch(/persist_match for opportunity_id=1/);
  });

  it('handles single-recipient single-image opps with the singular "image" wording', () => {
    const m = buildRubricOppMessage(opp2);
    const text = (m.content[m.content.length - 1] as { type: 'text'; text: string }).text;
    expect(text).toMatch(/Solo Recipient \(2022\):\s*1 image above/);
    // No "images above" plural for single-image case.
    expect(text).not.toMatch(/Solo Recipient \(2022\):\s*1 images above/);
  });
});

describe('startRubricSession — Note 29 wire-up', () => {
  it('creates session WITHOUT a resources field (the failure mode that Note 29 fixes)', async () => {
    const { startRubricSession } = await import('@/lib/agents/rubric-matcher');
    await startRubricSession(
      1,
      { identity: { artist_name: 'A' } } as never,
      { career_positioning_read: 'r' } as never,
      portfolio,
      [opp1, opp2],
    );
    expect(sessionsCreate).toHaveBeenCalledTimes(1);
    const arg = sessionsCreate.mock.calls[0]?.[0] as Record<string, unknown> | undefined;
    expect(arg).toBeDefined();
    expect(arg).not.toHaveProperty('resources');
  });

  // WALKTHROUGH Note 30: startRubricSession sends ONLY the setup at session
  // start. Per-opp messages are dispatched sequentially by run-poll's
  // sendNextRubricOpp on each idle. Batched-events (Note 29 first pass)
  // risked compaction at scale; sequential dispatch keeps each turn small.
  it('sends ONLY the setup message at session start (no per-opp messages bundled)', async () => {
    const { startRubricSession } = await import('@/lib/agents/rubric-matcher');
    await startRubricSession(
      1,
      { identity: { artist_name: 'A' } } as never,
      { career_positioning_read: 'r' } as never,
      portfolio,
      [opp1, opp2],
    );
    expect(eventsSend).toHaveBeenCalledTimes(1);
    const [, body] = eventsSend.mock.calls[0] as [
      string,
      { events: Array<{ type: string; content: unknown[] }> },
    ];
    expect(body.events.length).toBe(1); // setup only — opps dispatched by run-poll
    expect(body.events[0].type).toBe('user.message');
  });

  it('the setup event sent contains at least one image content block (portfolio)', async () => {
    const { startRubricSession } = await import('@/lib/agents/rubric-matcher');
    await startRubricSession(
      1,
      { identity: { artist_name: 'A' } } as never,
      { career_positioning_read: 'r' } as never,
      portfolio,
      [opp1, opp2],
    );
    const [, body] = eventsSend.mock.calls[0] as [
      string,
      { events: Array<{ content: Array<{ type: string }> }> },
    ];
    const imageCount = body.events[0].content.filter((c) => c.type === 'image').length;
    expect(imageCount).toBeGreaterThan(0);
  });
});
