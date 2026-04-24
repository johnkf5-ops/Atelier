import { describe, it, expect } from 'vitest';
import { compositeScore } from '@/lib/agents/orchestrator';
import type { Opportunity } from '@/lib/schemas/opportunity';
import type { RunConfig } from '@/lib/schemas/run';

const config: RunConfig = {
  window_start: '2026-04-24',
  window_end: '2026-10-24',
  budget_usd: 500,
  max_travel_miles: null,
};

function opp(overrides: Partial<Opportunity> = {}): Opportunity {
  return {
    source: 'test',
    source_id: 'id',
    name: 'Test',
    url: 'https://example.com',
    deadline: new Date(Date.now() + 45 * 86_400_000).toISOString().slice(0, 10), // 45 days
    award: { type: 'grant', prestige_tier: 'flagship' },
    eligibility: {},
    ...overrides,
  };
}

describe('compositeScore', () => {
  it('flagship prestige + mid-window + no fee → fit × 1 × 0.85 × 1.0', () => {
    const score = compositeScore(0.8, opp(), config);
    // 0.8 * 1.0 * 0.85 * 1.0 = 0.68
    expect(score).toBeCloseTo(0.68, 2);
  });

  it('regional prestige reduces weight to 0.55', () => {
    const score = compositeScore(
      1.0,
      opp({ award: { type: 'grant', prestige_tier: 'regional' } }),
      config,
    );
    // 1.0 * 0.55 * 0.85 * 1.0 = 0.4675
    expect(score).toBeCloseTo(0.4675, 3);
  });

  it('deadline within 7 days penalizes to 0.3', () => {
    const near = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
    const score = compositeScore(1.0, opp({ deadline: near }), config);
    // 1.0 * 1.0 * 0.3 * 1.0 = 0.3
    expect(score).toBeCloseTo(0.3, 2);
  });

  it('deadline in sweet-spot (7-30d) boosts urgency to 1.0', () => {
    const sweet = new Date(Date.now() + 15 * 86_400_000).toISOString().slice(0, 10);
    const score = compositeScore(1.0, opp({ deadline: sweet }), config);
    // 1.0 * 1.0 * 1.0 * 1.0 = 1.0
    expect(score).toBeCloseTo(1.0, 2);
  });

  it('fee over budget drops affordability to 0', () => {
    const score = compositeScore(1.0, opp({ entry_fee_usd: 1000 }), config);
    expect(score).toBe(0);
  });

  it('fee at half budget drops affordability to 0.75', () => {
    const score = compositeScore(1.0, opp({ entry_fee_usd: 250 }), config);
    // 1.0 * 1.0 * 0.85 * (1 - 0.5 * 0.5) = 1.0 * 1.0 * 0.85 * 0.75 = 0.6375
    expect(score).toBeCloseTo(0.6375, 3);
  });
});
