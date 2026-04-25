import { FlatCompat } from '@eslint/eslintrc';

const compat = new FlatCompat({ baseDirectory: import.meta.dirname });

export default [
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    // Ban raw fetch() in client code. Every request must go through
    // `lib/api/fetch-client.ts` (fetchJson / safeJson) so every failure —
    // network TypeError, timeout, non-JSON body, abort, HTTP error —
    // surfaces with a categorised `kind` instead of a swallowed
    // "Failed to fetch" that crashes the UI.
    //
    // Exemptions (intentional):
    //   - SSE streams read response.body as a ReadableStream and must call
    //     raw fetch(). Opt out per-line with
    //     `// eslint-disable-next-line no-restricted-syntax`.
    //   - Server routes in `app/api/**` may call fetch() freely for Blob
    //     downloads, internal cascades, external Anthropic calls, etc.
    //   - `lib/api/fetch-client.ts` is the ONE place fetchJson is built.
    //   - `lib/portfolio/scraper.ts`, `lib/agents/**`, `lib/extractor/**`
    //     are server-only modules that fetch external hosts.
    files: [
      'app/**/*.{ts,tsx}',
      'components/**/*.{ts,tsx}',
    ],
    ignores: [
      'app/api/**',
      'app/**/*.server.{ts,tsx}',
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.name='fetch']",
          message:
            "Use fetchJson() from '@/lib/api/fetch-client' instead of raw fetch(). SSE streams may opt out with an inline // eslint-disable-next-line comment.",
        },
      ],
    },
  },
];
