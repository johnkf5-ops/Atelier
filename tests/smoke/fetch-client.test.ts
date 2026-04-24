import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchJson, safeJson } from '@/lib/api/fetch-client';

/**
 * Regression test for the "Failed to fetch" bug — the client had no way
 * to tell whether a request died from a network-level TypeError, an abort,
 * a timeout, a non-JSON body, or a real HTTP error. fetchJson/safeJson now
 * categorise these, and this suite locks the kinds in so the banner copy
 * in upload-client (and every other caller) stays meaningful.
 */

describe('safeJson', () => {
  it('ok=true for a 200 with JSON body', async () => {
    const res = new Response(JSON.stringify({ a: 1 }), { status: 200 });
    const r = await safeJson<{ a: number }>(res);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.a).toBe(1);
  });

  it('kind=empty-body for a 500 with no body', async () => {
    const res = new Response('', { status: 500 });
    const r = await safeJson(res);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.kind).toBe('empty-body');
      expect(r.status).toBe(500);
    }
  });

  it('kind=parse-error for a 200 with a non-JSON body', async () => {
    const res = new Response('<html>nope</html>', { status: 200 });
    const r = await safeJson(res);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.kind).toBe('parse-error');
  });

  it('kind=http-error surfaces {error} from a 4xx body', async () => {
    const res = new Response(JSON.stringify({ error: 'need more images' }), { status: 400 });
    const r = await safeJson(res);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.kind).toBe('http-error');
      expect(r.error).toBe('need more images');
      expect(r.status).toBe(400);
    }
  });
});

describe('fetchJson', () => {
  const originalFetch = global.fetch;
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    global.fetch = originalFetch;
  });

  it('kind=network when fetch() throws TypeError (the "Failed to fetch" case)', async () => {
    global.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const r = await fetchJson('/does-not-matter');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.kind).toBe('network');
      expect(r.error).toMatch(/couldn't reach server/i);
    }
  });

  it('kind=timeout when the client timer elapses', async () => {
    global.fetch = vi.fn().mockImplementation((_input: RequestInfo, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
        );
      });
    });
    const promise = fetchJson('/slow', { timeoutMs: 50 });
    await vi.advanceTimersByTimeAsync(51);
    const r = await promise;
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.kind).toBe('timeout');
      expect(r.error).toMatch(/timed out/i);
    }
  });

  it('kind=abort when an external signal cancels', async () => {
    const externalCtrl = new AbortController();
    global.fetch = vi.fn().mockImplementation((_input: RequestInfo, init?: RequestInit) => {
      return new Promise((_, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
        );
      });
    });
    const promise = fetchJson('/cancellable', { signal: externalCtrl.signal, timeoutMs: 10_000 });
    externalCtrl.abort('user-cancelled');
    const r = await promise;
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.kind).toBe('abort');
  });
});
