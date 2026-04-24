/**
 * Defensive client-side JSON response parser with categorised errors.
 *
 * Problem this solves: calling `await res.json()` on a Response with an
 * empty body throws SyntaxError and takes the UI down. Beyond that, the
 * raw fetch() TypeError "Failed to fetch" leaks into the UI without any
 * hint whether it was a network failure, a timeout, or a user-abort.
 *
 * Returns a `SafeResult<T>` discriminated union:
 *  - `{ ok: true,  data: T, status }` on 2xx with parseable JSON
 *  - `{ ok: false, error: string, kind, status? }` otherwise
 *
 * `kind` categorises the failure so UI layers can distinguish network/abort/
 * timeout/http errors without string-sniffing the message.
 */

export type SafeError =
  | 'network' // fetch() threw — connection reset, DNS, CORS, dev-server bounce, etc.
  | 'abort' // AbortController fired (user navigation, manual cancel, client timeout)
  | 'timeout' // client-side timeout elapsed
  | 'empty-body' // server returned a status with zero bytes
  | 'parse-error' // body returned bytes that weren't JSON
  | 'http-error'; // non-2xx with parseable JSON {error}

export type SafeResult<T> =
  | { ok: true; data: T; status: number }
  | { ok: false; error: string; kind: SafeError; status?: number };

export async function safeJson<T>(res: Response): Promise<SafeResult<T>> {
  const status = res.status;
  let text: string;
  try {
    text = await res.text();
  } catch (err) {
    return {
      ok: false,
      status,
      kind: 'network',
      error: `failed to read response body: ${(err as Error).message}`,
    };
  }
  if (text.length === 0) {
    return {
      ok: false,
      status,
      kind: 'empty-body',
      error: `server returned an empty ${status} response — check server logs`,
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    const snippet = text.length > 120 ? text.slice(0, 120) + '…' : text;
    return {
      ok: false,
      status,
      kind: 'parse-error',
      error: `non-JSON response (${status}): ${snippet}`,
    };
  }
  if (!res.ok) {
    const errFromBody = (parsed as { error?: string } | null)?.error;
    return {
      ok: false,
      status,
      kind: 'http-error',
      error: errFromBody ?? `HTTP ${status}`,
    };
  }
  return { ok: true, data: parsed as T, status };
}

export interface FetchJsonOptions extends RequestInit {
  /** Client-side timeout in milliseconds. Defaults to 120_000 for long vision calls. */
  timeoutMs?: number;
}

/**
 * Fetch with a default 120s client timeout and categorised error reporting.
 * Logs failures via console.warn with the request URL + failure kind so
 * future bugs are diagnosable from a DevTools console screenshot.
 */
export async function fetchJson<T>(
  input: RequestInfo | URL,
  init: FetchJsonOptions = {},
): Promise<SafeResult<T>> {
  const { timeoutMs = 120_000, signal: externalSignal, ...restInit } = init;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort('client-timeout'), timeoutMs);
  const onExternalAbort = () => ctrl.abort(externalSignal?.reason);
  if (externalSignal) {
    if (externalSignal.aborted) ctrl.abort(externalSignal.reason);
    else externalSignal.addEventListener('abort', onExternalAbort, { once: true });
  }

  try {
    let res: Response;
    try {
      res = await fetch(input, { ...restInit, signal: ctrl.signal });
    } catch (err) {
      const e = err as { name?: string; message?: string };
      // AbortController.signal.abort() throws AbortError; distinguish timeout vs. external.
      if (e.name === 'AbortError') {
        const kind: SafeError = ctrl.signal.reason === 'client-timeout' ? 'timeout' : 'abort';
        const message =
          kind === 'timeout'
            ? `request timed out after ${Math.round(timeoutMs / 1000)}s`
            : 'request was aborted';
        console.warn(`[fetchJson] ${kind}: ${String(input)} — ${message}`);
        return { ok: false, kind, error: message };
      }
      const msg = e.message ?? String(err);
      console.warn(`[fetchJson] network: ${String(input)} — ${msg}`);
      return {
        ok: false,
        kind: 'network',
        error: `couldn't reach server (${msg}). Check your connection, then try again.`,
      };
    }
    const result = await safeJson<T>(res);
    if (!result.ok) {
      console.warn(`[fetchJson] ${result.kind} (${result.status ?? '?'}): ${String(input)} — ${result.error}`);
    }
    return result;
  } finally {
    clearTimeout(timer);
    if (externalSignal) externalSignal.removeEventListener('abort', onExternalAbort);
  }
}
