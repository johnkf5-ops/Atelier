import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { withAnthropicRetry } from '@/lib/anthropic-retry';

/**
 * WALKTHROUGH Note 11 contract: every Anthropic SDK call goes through
 * `withAnthropicRetry`. This suite locks in the retry behaviour so future
 * edits can't accidentally turn the wrapper into a no-op.
 */

describe('withAnthropicRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns immediately on success — no retry', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await withAnthropicRetry(fn);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on 529 overloaded then succeeds', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('Overloaded'), { status: 529 }))
      .mockResolvedValue('ok-after-retry');
    const promise = withAnthropicRetry(fn, { baseMs: 10 });
    await vi.advanceTimersByTimeAsync(2000);
    const result = await promise;
    expect(result).toBe('ok-after-retry');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('retries on 503 then 502 then succeeds (handles cascading transient)', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('Service Unavailable'), { status: 503 }))
      .mockRejectedValueOnce(Object.assign(new Error('Bad Gateway'), { status: 502 }))
      .mockResolvedValue('ok');
    const promise = withAnthropicRetry(fn, { baseMs: 10 });
    await vi.advanceTimersByTimeAsync(5000);
    const result = await promise;
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('retries on 429 rate-limited', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('Too Many Requests'), { status: 429 }))
      .mockResolvedValue('ok');
    const promise = withAnthropicRetry(fn, { baseMs: 10 });
    await vi.advanceTimersByTimeAsync(2000);
    expect(await promise).toBe('ok');
  });

  it('retries on network ECONNRESET', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }))
      .mockResolvedValue('ok');
    const promise = withAnthropicRetry(fn, { baseMs: 10 });
    await vi.advanceTimersByTimeAsync(2000);
    expect(await promise).toBe('ok');
  });

  it('does NOT retry on 400 bad-request (real client error)', async () => {
    const err = Object.assign(new Error('Invalid model'), { status: 400 });
    const fn = vi.fn().mockRejectedValue(err);
    await expect(withAnthropicRetry(fn)).rejects.toThrow('Invalid model');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry on 401 auth (real client error)', async () => {
    const err = Object.assign(new Error('Bad API key'), { status: 401 });
    const fn = vi.fn().mockRejectedValue(err);
    await expect(withAnthropicRetry(fn)).rejects.toThrow('Bad API key');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry on AbortError (user cancel)', async () => {
    const err = Object.assign(new Error('aborted'), { name: 'AbortError' });
    const fn = vi.fn().mockRejectedValue(err);
    await expect(withAnthropicRetry(fn)).rejects.toThrow('aborted');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('throws after maxAttempts when transient errors persist', async () => {
    const err = Object.assign(new Error('Overloaded'), { status: 529 });
    const fn = vi.fn().mockRejectedValue(err);
    const promise = withAnthropicRetry(fn, { baseMs: 10, maxAttempts: 3 });
    // Attach the catch BEFORE draining timers so vitest doesn't flag the
    // not-yet-awaited rejection as "unhandled" while the timers fire.
    const assertion = expect(promise).rejects.toThrow('Overloaded');
    await vi.runAllTimersAsync();
    await assertion;
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
