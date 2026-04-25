import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildRubricOppMessage, type OpportunityForRubric } from '@/lib/agents/rubric-matcher';

/**
 * WALKTHROUGH Note 30 (CRITICAL — production-scale vision unlock):
 *
 * Note 29 was architecturally right (image content blocks > resource mounts)
 * but the first-pass implementation batched [setup, ...allOppMessages] into
 * a single events.send call. At production scale (12 portfolio + 5×18
 * recipient ≈ 100+ images) the harness builds a messages.create payload
 * from the event log on every turn — stuffing all images into turn 1 risks
 * blowing the context window OR triggering thread_context_compacted events
 * that replace images with text summaries (the exact "reasoning reads as
 * text-only" symptom we kept seeing).
 *
 * Production-scale probe (scripts/probe-prod-scale.mjs) validated the
 * sequential pattern: setup → idle → opp 1 → persist_match → idle →
 * opp 2 → … Agent returned "VISION ENGAGED:" with specific visible
 * details ("Half Dome with light-particles", "polar bear isolated against
 * blown-out white") that aren't in StyleFingerprint or AKB.
 *
 * This suite locks the sequential contract:
 *   - startRubricSession sends ONLY the setup message (asserted in
 *     rubric-multimodal.test.ts — no opp messages bundled)
 *   - sendNextRubricOpp produces ONE events.send per call, in opp-id
 *     order, until no unscored opps remain
 *   - across the full sequence, events.send is called N+1 times total
 *     (1 setup + N opps) — never N+1 in a single batched call
 *   - per-opp message text contains the describe-before-score instruction
 *     (Note 30 fix.2 — visible details flow into persist_match.reasoning,
 *     proving vision in the dossier text itself)
 */

const { sessionsCreate, eventsSend, dbExecute } = vi.hoisted(() => ({
  sessionsCreate: vi.fn(),
  eventsSend: vi.fn(),
  dbExecute: vi.fn(),
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
  getDb: () => ({ execute: dbExecute }),
}));

vi.mock('@/lib/auth/api-key', () => ({
  getAnthropicKey: () => 'sk-ant-mock',
}));

const opp1Raw = {
  id: 1,
  name: 'Test Award',
  url: 'https://example.com/award',
  raw_json: JSON.stringify({ award: { prestige_tier: 'mid' } }),
};
const opp2Raw = {
  id: 2,
  name: 'Second Award',
  url: 'https://example.com/award2',
  raw_json: JSON.stringify({ award: { prestige_tier: 'flagship' } }),
};

const recipientRows = (oppId: number) => {
  if (oppId === 1) {
    return [
      {
        name: 'Mark Chen',
        year: 2023,
        portfolio_urls: JSON.stringify(['https://blob.vercel-storage.example/x.jpg']),
        file_ids: JSON.stringify(['file_r1', 'file_r2']),
      },
    ];
  }
  if (oppId === 2) {
    return [
      {
        name: 'Solo Recipient',
        year: 2022,
        portfolio_urls: JSON.stringify(['https://blob.vercel-storage.example/y.jpg']),
        file_ids: JSON.stringify(['file_r3']),
      },
    ];
  }
  return [];
};

beforeEach(() => {
  sessionsCreate.mockReset();
  eventsSend.mockReset();
  dbExecute.mockReset();
  sessionsCreate.mockResolvedValue({ id: 'session_mock' });
  eventsSend.mockResolvedValue({});
});

describe('buildRubricOppMessage — Note 30 describe-before-score', () => {
  const opp: OpportunityForRubric = {
    id: 1,
    name: 'Test Award',
    url: 'https://example.com',
    prestige_tier: 'mid',
    past_recipients: [
      {
        name: 'Mark Chen',
        year: 2023,
        image_urls: ['https://example.com/m.jpg'],
        file_ids: ['file_r1', 'file_r2'],
      },
    ],
  };

  it('per-opp message text instructs the agent to note 1-2 visible details before scoring', () => {
    const m = buildRubricOppMessage(opp);
    const text = (m.content[m.content.length - 1] as { type: 'text'; text: string }).text;
    expect(text).toMatch(/Before scoring, briefly note 1-2 specific visible details from the cohort images/);
    expect(text).toMatch(/write these details into persist_match\.reasoning/);
  });

  it('describe-before-score instruction names categories of visible details', () => {
    const m = buildRubricOppMessage(opp);
    const text = (m.content[m.content.length - 1] as { type: 'text'; text: string }).text;
    expect(text).toMatch(/palette/);
    expect(text).toMatch(/composition/);
    expect(text).toMatch(/named visual elements/);
  });
});

describe('sendNextRubricOpp — Note 30 sequential dispatch', () => {
  function mockNextOppQuery(nextOpp: typeof opp1Raw | null) {
    // First execute: SELECT next opportunity (joins LEFT JOIN run_matches).
    // Second execute (only when nextOpp !== null): SELECT past_recipients.
    let call = 0;
    dbExecute.mockImplementation((args: unknown) => {
      call++;
      if (call === 1) {
        return Promise.resolve({ rows: nextOpp ? [nextOpp] : [], rowsAffected: 0 });
      }
      const sql = (args as { sql: string }).sql;
      if (sql.includes('past_recipients')) {
        return Promise.resolve({ rows: recipientRows(nextOpp?.id ?? 0), rowsAffected: 0 });
      }
      return Promise.resolve({ rows: [], rowsAffected: 0 });
    });
  }

  it('sends one events.send per call when an unscored opp is available, returns true', async () => {
    mockNextOppQuery(opp1Raw);
    const { sendNextRubricOpp } = await import('@/lib/agents/rubric-matcher');
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const client = new Anthropic({ apiKey: 'sk-ant-mock' });
    const sent = await sendNextRubricOpp(client, 7, 'session_mock');
    expect(sent).toBe(true);
    expect(eventsSend).toHaveBeenCalledTimes(1);
    const [, body] = eventsSend.mock.calls[0] as [
      string,
      { events: Array<{ type: string; content: Array<{ type: string }> }> },
    ];
    expect(body.events.length).toBe(1);
    expect(body.events[0].type).toBe('user.message');
    // Per-opp message must contain at least one image content block.
    const imageCount = body.events[0].content.filter((c) => c.type === 'image').length;
    expect(imageCount).toBeGreaterThan(0);
  });

  it('returns false (terminal) when every opp already has a run_matches row', async () => {
    mockNextOppQuery(null);
    const { sendNextRubricOpp } = await import('@/lib/agents/rubric-matcher');
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const client = new Anthropic({ apiKey: 'sk-ant-mock' });
    const sent = await sendNextRubricOpp(client, 7, 'session_mock');
    expect(sent).toBe(false);
    expect(eventsSend).not.toHaveBeenCalled();
  });

  it('sequential dispatch produces N+1 events.send calls across the full run (1 setup + N opps)', async () => {
    // Simulate: startRubricSession (1 setup send) + sendNextRubricOpp called
    // until it returns false (one send per opp + one no-op call). The
    // production-scale contract is N+1 sends total across the sequence,
    // NOT a single batched [setup, ...opps] call.
    const { startRubricSession, sendNextRubricOpp } = await import('@/lib/agents/rubric-matcher');
    const Anthropic = (await import('@anthropic-ai/sdk')).default;

    // 1) Setup send. start-rubric calls events.send once.
    dbExecute.mockResolvedValue({ rows: [], rowsAffected: 0 }); // run_event_cursors INSERT
    await startRubricSession(
      7,
      { identity: { artist_name: 'A' } } as never,
      { career_positioning_read: 'r' } as never,
      [{ id: 1, thumb_url: 'https://example.com/p1.jpg', file_id: 'file_p1' }],
      [
        {
          id: 1,
          name: 'A',
          url: 'https://example.com',
          prestige_tier: 'mid',
          past_recipients: [],
        },
        {
          id: 2,
          name: 'B',
          url: 'https://example.com',
          prestige_tier: 'mid',
          past_recipients: [],
        },
      ],
    );
    expect(eventsSend).toHaveBeenCalledTimes(1);

    // 2) Per-opp dispatch. run-poll calls sendNextRubricOpp once per idle.
    const client = new Anthropic({ apiKey: 'sk-ant-mock' });

    // Opp 1 dispatch.
    let dbCall = 0;
    dbExecute.mockReset();
    dbExecute.mockImplementation((args: unknown) => {
      dbCall++;
      if (dbCall === 1) return Promise.resolve({ rows: [opp1Raw], rowsAffected: 0 });
      const sql = (args as { sql: string }).sql;
      if (sql.includes('past_recipients')) {
        return Promise.resolve({ rows: recipientRows(1), rowsAffected: 0 });
      }
      return Promise.resolve({ rows: [], rowsAffected: 0 });
    });
    const sent1 = await sendNextRubricOpp(client, 7, 'session_mock');
    expect(sent1).toBe(true);
    expect(eventsSend).toHaveBeenCalledTimes(2);

    // Opp 2 dispatch.
    dbCall = 0;
    dbExecute.mockReset();
    dbExecute.mockImplementation((args: unknown) => {
      dbCall++;
      if (dbCall === 1) return Promise.resolve({ rows: [opp2Raw], rowsAffected: 0 });
      const sql = (args as { sql: string }).sql;
      if (sql.includes('past_recipients')) {
        return Promise.resolve({ rows: recipientRows(2), rowsAffected: 0 });
      }
      return Promise.resolve({ rows: [], rowsAffected: 0 });
    });
    const sent2 = await sendNextRubricOpp(client, 7, 'session_mock');
    expect(sent2).toBe(true);
    expect(eventsSend).toHaveBeenCalledTimes(3); // 1 setup + 2 opps = 3 = N+1 with N=2

    // Terminal: no more opps left.
    dbExecute.mockReset();
    dbExecute.mockResolvedValueOnce({ rows: [], rowsAffected: 0 });
    const sent3 = await sendNextRubricOpp(client, 7, 'session_mock');
    expect(sent3).toBe(false);
    expect(eventsSend).toHaveBeenCalledTimes(3); // unchanged — no send for terminal
  });

  it('every per-opp send is a single user.message event, never a batch', async () => {
    mockNextOppQuery(opp1Raw);
    const { sendNextRubricOpp } = await import('@/lib/agents/rubric-matcher');
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const client = new Anthropic({ apiKey: 'sk-ant-mock' });
    await sendNextRubricOpp(client, 7, 'session_mock');
    const [, body] = eventsSend.mock.calls[0] as [
      string,
      { events: Array<{ type: string }> },
    ];
    expect(body.events.length).toBe(1);
  });
});
