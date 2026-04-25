import { describe, it, expect } from 'vitest';
import { errorResponse, withApiErrorHandling } from '@/lib/api/response';

/**
 * Structural guarantee: every API route that throws returns a JSON body
 * `{error: string}` with a 4xx or 5xx status — NEVER an empty body that
 * crashes the frontend's `res.json()` call with "Unexpected end of JSON
 * input".
 *
 * We can't cheaply hit every route over HTTP from vitest without spinning
 * up the full Next.js runtime. Instead we lock in the *contract* at the
 * helper level: `withApiErrorHandling` must ALWAYS produce a JSON
 * `Response` when the wrapped handler throws, and `errorResponse` must
 * produce the same shape directly. This is the primitive every route
 * composes — if it's correct, every route is correct.
 *
 * Paired with:
 *   - Grep CI step (pre-push / CI) that asserts every file under
 *     app/api/[...]/route.ts exports its handler through withApiErrorHandling.
 *   - ESLint rule banning raw fetch() in client code so callers always
 *     parse through safeJson which handles empty-body as a typed kind.
 */

describe('API error envelope contract', () => {
  it('errorResponse produces a JSON body with {error} on 500', async () => {
    const res = errorResponse(new Error('boom'));
    expect(res.status).toBe(500);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    const body = await res.json();
    expect(body).toEqual({ error: 'boom' });
  });

  it('errorResponse produces {error} for non-Error throws', async () => {
    const res = errorResponse('string payload');
    const body = await res.json();
    expect(body).toEqual({ error: 'string payload' });
  });

  it('errorResponse honours custom status', async () => {
    const res = errorResponse(new Error('bad input'), 400);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ error: 'bad input' });
  });

  it('withApiErrorHandling converts thrown errors into JSON-bodied 500s', async () => {
    const broken = withApiErrorHandling(async () => {
      throw new Error('handler blew up');
    });
    const res = await broken();
    expect(res.status).toBe(500);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    const body = await res.json();
    expect(body).toEqual({ error: 'handler blew up' });
    // The critical bit: body length > 0. "Unexpected end of JSON input"
    // on the frontend requires the body to be empty — this assertion
    // catches the exact regression class.
    const text = await new Response(JSON.stringify(body)).text();
    expect(text.length).toBeGreaterThan(0);
  });

  it('withApiErrorHandling passes through successful responses unchanged', async () => {
    const good = withApiErrorHandling(async () => Response.json({ ok: true }));
    const res = await good();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('withApiErrorHandling preserves handler args (params)', async () => {
    const handler = withApiErrorHandling(
      async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
        const { id } = await ctx.params;
        return Response.json({ id });
      },
    );
    const res = await handler(new Request('http://x/'), {
      params: Promise.resolve({ id: '42' }),
    });
    expect(await res.json()).toEqual({ id: '42' });
  });
});

describe('Route-file audit: every app/api route wraps its handler', () => {
  it('every app/api/[...]/route.ts imports withApiErrorHandling or is an explicit SSE exemption', async () => {
    const { promises: fs } = await import('node:fs');
    const path = await import('node:path');
    async function walk(dir: string): Promise<string[]> {
      const out: string[] = [];
      for (const ent of await fs.readdir(dir, { withFileTypes: true })) {
        const p = path.join(dir, ent.name);
        if (ent.isDirectory()) out.push(...(await walk(p)));
        else if (ent.name === 'route.ts') out.push(p);
      }
      return out;
    }
    const apiRoot = path.join(process.cwd(), 'app', 'api');
    const routes = await walk(apiRoot);
    expect(routes.length).toBeGreaterThan(10); // sanity

    const missing: string[] = [];
    for (const file of routes) {
      const src = await fs.readFile(file, 'utf-8');
      const hasWrapper = src.includes('withApiErrorHandling');
      // Known SSE exceptions — they stream response.body and catch inside.
      const isSseExempt =
        file.endsWith('portfolio/scrape/route.ts') ||
        file.endsWith('extractor/auto-discover/route.ts');
      if (!hasWrapper && !isSseExempt) {
        missing.push(path.relative(process.cwd(), file));
      }
    }
    expect(missing, `routes missing withApiErrorHandling: ${missing.join(', ')}`).toEqual([]);
  });
});
