/**
 * Defensive client-side JSON response parser.
 *
 * Problem this solves: calling `await res.json()` on a Response with an
 * empty body (classic Next.js uncaught-500) throws SyntaxError and takes
 * the UI down with an unhandled rejection. The backend is now disciplined
 * enough to always send `{error}` on failure, but clients should still
 * handle network errors, timeouts, and any handler that slips through
 * without JSON.
 *
 * Returns a `SafeResult<T>` discriminated union:
 *  - `{ ok: true,  data: T, status }` on 2xx with parseable JSON
 *  - `{ ok: false, error: string, status? }` otherwise (status may be absent on network error)
 *
 * Reads the response as text first so we can include the raw body in the
 * error message when the parse fails — makes production errors debuggable.
 */

export type SafeResult<T> =
  | { ok: true; data: T; status: number }
  | { ok: false; error: string; status?: number };

export async function safeJson<T>(res: Response): Promise<SafeResult<T>> {
  const status = res.status;
  let text: string;
  try {
    text = await res.text();
  } catch (err) {
    return { ok: false, status, error: `failed to read response body: ${(err as Error).message}` };
  }
  if (text.length === 0) {
    return {
      ok: false,
      status,
      error: `server returned an empty ${status} response — check server logs`,
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    const snippet = text.length > 120 ? text.slice(0, 120) + '…' : text;
    return { ok: false, status, error: `non-JSON response (${status}): ${snippet}` };
  }
  if (!res.ok) {
    const errFromBody = (parsed as { error?: string } | null)?.error;
    return { ok: false, status, error: errFromBody ?? `HTTP ${status}` };
  }
  return { ok: true, data: parsed as T, status };
}

export async function fetchJson<T>(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<SafeResult<T>> {
  let res: Response;
  try {
    res = await fetch(input, init);
  } catch (err) {
    return { ok: false, error: `network error: ${(err as Error).message}` };
  }
  return safeJson<T>(res);
}
