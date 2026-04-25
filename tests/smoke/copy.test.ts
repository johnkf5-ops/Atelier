import { describe, it, expect } from 'vitest';
import { fitTier, humanizeDeadline, daysUntilDeadline, humanizeMoney } from '@/lib/ui/copy';

/**
 * WALKTHROUGH Note 13 — locks the user-facing copy mappings.
 * If a tier boundary or label changes, every component using these
 * helpers will reflect the change consistently. The tests here just
 * make sure no future "let me tweak these numbers inline" drift.
 */

describe('fitTier', () => {
  it('Strong fit at >= 0.65', () => {
    expect(fitTier(0.65).label).toBe('Strong fit');
    expect(fitTier(0.85).label).toBe('Strong fit');
  });

  it('Solid fit between 0.45 and 0.65', () => {
    expect(fitTier(0.45).label).toBe('Solid fit');
    expect(fitTier(0.6).label).toBe('Solid fit');
  });

  it('Worth applying between 0.25 and 0.45', () => {
    expect(fitTier(0.25).label).toBe('Worth applying');
    expect(fitTier(0.4).label).toBe('Worth applying');
  });

  it('Long shot below 0.25', () => {
    expect(fitTier(0.05).label).toBe('Long shot');
    expect(fitTier(0.0).label).toBe('Long shot');
  });

  it('every tier provides label + description + className', () => {
    for (const c of [0.9, 0.55, 0.3, 0.1]) {
      const t = fitTier(c);
      expect(t.label).toBeTruthy();
      expect(t.description).toBeTruthy();
      expect(t.className).toBeTruthy();
    }
  });
});

describe('humanizeDeadline', () => {
  it('returns "no deadline" for null', () => {
    expect(humanizeDeadline(null)).toBe('no deadline');
    expect(humanizeDeadline(undefined)).toBe('no deadline');
  });

  it('formats a future date with relative time', () => {
    const next = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
    const out = humanizeDeadline(next);
    expect(out).toMatch(/—/);
    expect(out.toLowerCase()).toMatch(/(week|month|day)/);
  });

  it('flags past deadlines', () => {
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    expect(humanizeDeadline(yesterday)).toMatch(/passed/);
  });

  it('returns the raw string on parse failure', () => {
    expect(humanizeDeadline('not-a-date')).toBe('not-a-date');
  });
});

describe('daysUntilDeadline', () => {
  it('returns Infinity for null', () => {
    expect(daysUntilDeadline(null)).toBe(Number.POSITIVE_INFINITY);
  });

  it('returns approximate days for an ISO date', () => {
    const next = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
    const days = daysUntilDeadline(next);
    expect(days).toBeGreaterThan(28);
    expect(days).toBeLessThan(31);
  });
});

describe('humanizeMoney', () => {
  it('returns "unspecified" for null/0', () => {
    expect(humanizeMoney(null)).toBe('unspecified');
    expect(humanizeMoney(0)).toBe('unspecified');
  });

  it('formats integer dollars under $10k with commas', () => {
    expect(humanizeMoney(500)).toBe('$500');
    expect(humanizeMoney(2_500)).toBe('$2,500');
  });

  it('abbreviates thousands at >= $10k', () => {
    expect(humanizeMoney(10_000)).toBe('$10k');
    expect(humanizeMoney(50_000)).toBe('$50k');
  });
});
