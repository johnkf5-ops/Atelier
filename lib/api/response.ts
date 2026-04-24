/**
 * Standard JSON error envelope. ALWAYS use this from API routes instead of
 * letting raw exceptions bubble out of the handler — App Router's default
 * 500 response has an empty body, which crashes frontend `res.json()` with
 * "Unexpected end of JSON input".
 *
 * Use pattern:
 *   export const POST = withApiErrorHandling(async (req) => { ... });
 * or call `errorResponse(err)` directly inside a catch.
 */

export function errorResponse(err: unknown, status = 500): Response {
  const message = err instanceof Error ? err.message : String(err);
  // Log the full stack server-side so prod logs still have it.
  if (err instanceof Error && err.stack) console.error(err.stack);
  else console.error('[api error]', err);
  return Response.json({ error: message }, { status });
}

export function withApiErrorHandling<TArgs extends unknown[]>(
  handler: (...args: TArgs) => Promise<Response>,
): (...args: TArgs) => Promise<Response> {
  return async (...args: TArgs) => {
    try {
      return await handler(...args);
    } catch (err) {
      return errorResponse(err);
    }
  };
}
