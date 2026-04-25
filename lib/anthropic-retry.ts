/**
 * Retry wrapper for Anthropic API calls. Distinguishes transient failures
 * (429 rate-limited, 5xx server-side, network blip, timeout) from real
 * client-side errors (400 bad request, 401 auth, 403, schema mismatch).
 *
 * The intermittent 500s on /api/extractor/turn ("answer the same question
 * twice and the second works") were Anthropic transient throws escaping
 * the agent helpers. The agent loops only retried JSON validation failures
 * — they didn't retry the underlying API call. This wrapper does.
 *
 * Use:
 *   const resp = await withAnthropicRetry(() => client.messages.create({...}));
 */

const TRANSIENT_HTTP_STATUSES = new Set([408, 409, 425, 429, 500, 502, 503, 504, 529]);

export interface RetryOptions {
  maxAttempts?: number; // default 4
  baseMs?: number; // default 500
  maxMs?: number; // default 8_000
  /** Optional label for log lines so callers tag their retries clearly. */
  label?: string;
}

export async function withAnthropicRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? 4;
  const baseMs = opts.baseMs ?? 500;
  const maxMs = opts.maxMs ?? 8_000;
  const label = opts.label ?? 'anthropic';
  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isTransient(err) || attempt === maxAttempts) throw err;
      const jitter = Math.floor(Math.random() * baseMs);
      const delay = Math.min(maxMs, baseMs * 2 ** (attempt - 1)) + jitter;
      console.warn(
        `[${label}] transient failure on attempt ${attempt}/${maxAttempts}: ${describe(err)} — retrying in ${delay}ms`,
      );
      await sleep(delay);
    }
  }
  // Unreachable — the loop either returns or throws inside.
  throw lastErr;
}

function isTransient(err: unknown): boolean {
  const e = err as { status?: number; statusCode?: number; name?: string; code?: string; message?: string };
  const status = e.status ?? e.statusCode;
  if (typeof status === 'number' && TRANSIENT_HTTP_STATUSES.has(status)) return true;
  if (e.name === 'AbortError') return false; // user-initiated, don't retry
  // Network-level errors from undici/fetch
  if (e.code === 'ECONNRESET' || e.code === 'ECONNREFUSED' || e.code === 'ETIMEDOUT') return true;
  if (e.code === 'UND_ERR_SOCKET' || e.code === 'UND_ERR_CONNECT_TIMEOUT') return true;
  const msg = (e.message ?? '').toLowerCase();
  if (msg.includes('socket hang up') || msg.includes('fetch failed') || msg.includes('overloaded')) return true;
  return false;
}

function describe(err: unknown): string {
  const e = err as { status?: number; message?: string };
  const status = e.status ? `HTTP ${e.status} ` : '';
  return `${status}${e.message ?? String(err)}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
