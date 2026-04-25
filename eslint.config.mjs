import { FlatCompat } from '@eslint/eslintrc';

const compat = new FlatCompat({ baseDirectory: import.meta.dirname });

export default [
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    // Ban raw fetch() in client code. Every request must go through
    // `lib/api/fetch-client.ts` (fetchJson / safeJson) so every failure
    // surfaces with a categorised `kind` instead of "Failed to fetch".
    //
    // SSE streams may opt out per-line with
    // `// eslint-disable-next-line no-restricted-syntax`.
    files: ['app/**/*.{ts,tsx}', 'components/**/*.{ts,tsx}'],
    ignores: ['app/api/**', 'app/**/*.server.{ts,tsx}'],
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
  {
    // Ban DIRECT `await client.<...>.create/upload/send/retrieve(...)`
    // calls. Wrapped form `await withAnthropicRetry(() => client.<...>(...))`
    // is allowed: the create-CallExpression there is parented by an
    // ArrowFunctionExpression, not an AwaitExpression, so it doesn't match
    // these selectors.
    //
    // Why this matters: WALKTHROUGH Note 11. Anthropic returns transient
    // 529/503/429 during peak load — direct calls bubble those as
    // run-killing 500s. The retry wrapper does exponential backoff so
    // a single transient blip doesn't fail the whole route.
    files: ['app/**/*.{ts,tsx}', 'lib/**/*.{ts,tsx}'],
    ignores: ['lib/anthropic-retry.ts', 'lib/anthropic-files.ts', 'tests/**'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "AwaitExpression > CallExpression[callee.property.name='create'][callee.object.property.name='messages']",
          message:
            "Wrap client.messages.create() in withAnthropicRetry() from '@/lib/anthropic-retry'. Direct calls bubble Anthropic 529/503 transient errors as run-killing 500s.",
        },
        {
          selector:
            "AwaitExpression > CallExpression[callee.property.name='create'][callee.object.property.name='sessions']",
          message:
            "Wrap client.beta.sessions.create() in withAnthropicRetry() from '@/lib/anthropic-retry'.",
        },
        {
          selector:
            "AwaitExpression > CallExpression[callee.property.name='retrieve'][callee.object.property.name='sessions']",
          message:
            "Wrap client.beta.sessions.retrieve() in withAnthropicRetry() from '@/lib/anthropic-retry'.",
        },
        {
          selector:
            "AwaitExpression > CallExpression[callee.property.name='send'][callee.object.property.name='events']",
          message:
            "Wrap client.beta.sessions.events.send() in withAnthropicRetry() from '@/lib/anthropic-retry'.",
        },
        {
          selector:
            "AwaitExpression > CallExpression[callee.property.name='upload'][callee.object.property.name='files']",
          message:
            "Wrap client.beta.files.upload() — see lib/anthropic-files.ts uploadToFilesApi for the canonical wrapper.",
        },
      ],
    },
  },
];
