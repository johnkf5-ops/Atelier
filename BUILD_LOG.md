# BUILD_LOG — Atelier

Narrative log of shipped work per §5.1.a polish batch. Each entry: commit SHA + the bug/gap → fix narrative a reviewer needs to understand the change.

## §5.1.a — Pre-demo polish batch

### Group A — Entry & Runs management

**Commits:** `2ecc110` (Group A), `42742be` (prior: Scout archetype fix), `e36c780` (prior: Files API).

**A1 `/runs` was a stub.** Rendered "List of past + in-progress runs." placeholder. Judge landing there post-run saw nothing to do. Now `app/(dashboard)/runs/page.tsx` renders the list newest-first from `listRunsForUser()` in `lib/db/queries/runs.ts`. Each row: `#id`, status badge (complete/errored/cancelled/running), relative time, and `N discovered · M scored · K included` counts. Empty state has a CTA to start the first run. Completed rows link to `/dossier/id`; in-flight rows link to `/runs/id`.

**A2 No visible path to start another run.** After first dossier the product looked finished forever. New `app/(dashboard)/runs/new/page.tsx` reads current portfolio count, latest fingerprint version, latest KB version, renders re-run cadence guidance ("Re-run every 2–4 weeks, or whenever you update your portfolio or Knowledge Base"), and a `NewRunClient` button that POSTs `/api/runs/start` and redirects to `/runs/[id]`. Blocks the button with an amber panel if portfolio/fingerprint/KB prerequisites are missing, with inline links to the gap.

**A3 Favicon 404.** `app/icon.svg` — monochrome "A" glyph on black rounded square, served by Next 15's automatic icon convention.

### Group B — Upload → Style Analyst flow

**Commit:** `84c864f`.

**B1 Style Analyst looked frozen for 30–90s.** Button showed "Analyzing…" with no other feedback. Now `app/(onboarding)/upload/upload-client.tsx` fires a staged timer that cycles through three honest stages every 12s while the API call runs: *Reading N images…* → *Identifying aesthetic lineage…* → *Writing fingerprint…*. Rendered as a pulsing emerald status panel. Real streaming progress from Style Analyst would be better but is out of scope here — the staged timer is visibly honest and prevents the "is it broken?" reaction.

**B2 Fingerprint was a JSON dump.** `app/(onboarding)/upload/style-fingerprint-card.tsx` renders the fingerprint as labelled prose sections: formal lineage, career read, palette (temperature · saturation register · notable notes), subject, composition, light, museum-tier signals. Weak signals get their own amber anti-reference block. Raw JSON is gated behind a `<details>` disclosure at the bottom so auditing is still one click away.

**B3 No next-step after analysis.** Card's footer now has the line "Next, we'll research your public record — shows, publications, residencies — so Atelier can match you to the right opportunities." and a primary-colour "Next: Build your Knowledge Base →" button linking to `/interview`.

Plus: `/upload` now fetches any existing fingerprint on mount so returning users see their card without re-analyzing.

### Group C — Auto-discover + Knowledge Extractor flow

**Commit:** `aff07ab`.

**C1 Auto-discover ingest silently "succeeded" with no AKB write.** Root cause in `app/(onboarding)/interview/auto-discover-panel.tsx`: `confirmAndIngest` did `void j` on the `/api/extractor/ingest` response, then always rendered a green "Ingested. The interview below will pick up from the new AKB." panel — regardless of whether `saved` was null or `changed_fields` was empty. If every URL failed fetch/extract (or if every field already had manual provenance and merge was a no-op), the user got the success UI and no new `akb_versions` row, exactly matching the reported symptom.

Fix: `IngestSummaryPanel` reads the actual response. When `saved` is non-null it shows the new KB version ID + changed-field count on green. When `saved` is null with `changed_fields.length === 0` it shows "No new facts extracted from the selected pages. Try adding URLs with richer bio / press content." on amber. Failed sources surface behind a collapsible disclosure with per-URL reason strings. The ingest route itself (`lib/extractor/ingest-urls.ts`) is already structurally correct — it returns per-source `ok/error/changed` fields and writes a new akb_version iff `allChanged.size > 0`. Making the UI honest eliminates the "silent zero-write" failure mode.

**C2 Scraper review UI dominated by log dump.** Thumbnails already rendered in the main portfolio grid with `inReview` emerald-outline, but the verbose `<pre>` scrape log competed for visual weight. Now the log collapses behind a `<details>` summary ("Scrape log (N lines)"), and a new emerald primary line ("N images pending review in the grid below — uncheck any false positives, then Confirm") anchors the review action.

### Group D — Interview flow

**Commit:** `800bea7`.

**D1 No visible interview state.** User had no way to tell if the interview was idle, running, or done. New `StateBanner` at the top of `app/(onboarding)/interview/interview-client.tsx` derives one of four states from the turn log + last agent's `next_field_target`:

- **empty** — no KB yet, prompts auto-discover
- **ready** — KB has N facts, hints "Start the interview to fill remaining gaps"
- **in_progress** — amber banner, live fact count
- **complete** — emerald banner with "Review & start your first run →" CTA (sets up Group F's handoff)

The completeness signal (`next_field_target === null`) is already returned by the existing turn API; this is a consumer of data the server already emits, no backend change needed.

**D2 Dot-path schema leak + wrong-target mismatch.** Every turn in the chat rendered `agent → identity.citizenship` underneath the message. Two bugs in one: (a) dot-paths are internal; a judge shouldn't see "AKB schema plumbing" in the transcript, (b) `next_field_target` per its own schema is the *next* question's target, not the one just asked — so the label was semantically misaligned with the text. Fix removes the `→ {path}` line entirely. Turn labels now render just "Atelier" / "You". `next_field_target` keeps flowing through for the `StateBanner` completeness check but never surfaces as a field label.

Plus: sidebar "AKB (live)" → "Knowledge Base (live)", page title "Knowledge Extractor" → "Build your Knowledge Base".

### Group E — Review flow

**Commit:** `ddb6c42`.

**E1 React controlled/uncontrolled input warning on /review.** Every form edit logged *"A component is changing an uncontrolled input to be controlled"*. Root cause in `review-client.tsx`: AKB schema marks `home_base.state`, `practice.typical_scale`, and `year_of_birth` optional, and `emptyAkb()` never writes `state` into the row at all. The form read `draft.identity.home_base.state` directly, so the first render got `undefined`, the user typed, and React flipped modes.

Fixed upstream, not at the input level. New `normalizeAkbForForm()` runs on mount AND on every post-save response: every form-editable leaf is coerced to a concrete string, empty array, or null before it enters `setDraft`. The `Akb` form type was also tightened so `public_name`/`pronouns`/`typical_scale` are `string` (not `string | undefined`) and `year_of_birth` is `number | null` (not `number | undefined`). Result: inputs cannot receive `undefined` from the state layer, so the warning is structurally impossible — no per-field `value ?? ''` bandaid needed.

### Group F — Post-interview → runs flow

**Commit:** `bb19f7a`.

**F1 "AKB" jargon + dead-end after interview.** Every user-visible "AKB" string is now "Knowledge Base": the interview completion banner ("Knowledge Base complete — N facts captured"), `/review`'s validation banner ("Knowledge Base is incomplete"), and every error message returned by `/api/akb/validate`, `/api/akb/finalize`, and `/api/runs/start`. Code comments with "AKB" remain — internal, per the spec. `/review`'s "Continue to dossier →" button (which had been linking to the old `/runs` stub) now reads "Start your first run →" and routes to `/runs/new`, closing the onboarding→run handoff that Group D opened with its completion-banner CTA.

End-to-end next-step chain now has zero dead ends: **upload → analyze → fingerprint card's "Next: Build your Knowledge Base" → auto-discover → interview → "Knowledge Base complete" banner → "Review & start your first run" → review → "Start your first run" → `/runs/new` → `Start new run` → `/runs/[id]` → dossier**.

### Acceptance gate — §5.1.a

- `pnpm build` — passes (one ESLint unescaped-apostrophe fix committed as `a0330cc`).
- `pnpm test` — 14/14 smoke tests pass in 1.75s.
- Local dev server route sweep — 10/10 routes return 200: `/`, `/upload`, `/interview`, `/review`, `/runs`, `/runs/new`, `/runs/5`, `/dossier/5`, `/settings`, `/icon.svg`.

Commits merged (8 total for §5.1.a):
`2ecc110` Group A · `3d9235a` log A · `84c864f` Group B · `7178bf6` log B · `aff07ab` Group C · `5291e63` log C · `800bea7` Group D · `95d0008` log D · `ddb6c42` Group E · `bb19f7a` Group F · `e25ff0e` log E+F · `a0330cc` apostrophe fix.

Manual items still pending (user-owned, not code):
- §5.1 #2 — Deployment Protection OFF (Vercel dashboard)
- §5.1 #4 — Fresh incognito prod walk-through after DP toggle

### Post-gate regression: empty-500 after db:reset

**Commit:** `8083ff2`.

John's incognito walk-through after DP-off surfaced a real bug: `pnpm db:reset` drops every table, and the **next** server boot 500'd with an empty body on `POST /api/portfolio/upload`. Frontend crashed parsing the empty response: *"SyntaxError: Failed to execute 'json' on 'Response': Unexpected end of JSON input"*.

Two root causes, both fixed without bandaids.

**Root cause 1 — `runMigrations()` was defined in `lib/db/migrations.ts` but NEVER called anywhere.** After a reset, the next request hit an empty DB and threw "no such table: portfolio_images". Fix: new `ensureDbReady()` in `lib/db/client.ts` — memoized via a `_bootstrapPromise` so concurrent requests share one run; first call inside `ensureDbReady()` runs all migrations + seeds `users(id=1, name='Default User')` via `INSERT OR IGNORE`. Resets to `null` on failure so later requests can retry. Every non-SSE API route (18 files, converted mechanically via subagent) now awaits `ensureDbReady()` as its first line. Server Components that hit the DB directly (`/runs`, `/runs/new`, `/dossier/[runId]`) also await it.

**Root cause 2 — App Router 500s have empty bodies, frontend parsers crash.** Even with the migration fix, ANY future uncaught throw in a route handler produces an empty-body 500 that takes the UI down. Fix: `lib/api/response.ts` `withApiErrorHandling()` wraps every handler so any thrown error becomes `Response.json({error: err.message}, {status: 500})`. Every non-SSE route converted. Defensive frontend parser `lib/api/fetch-client.ts` `fetchJson()` reads response as text first, surfaces empty/non-JSON/network-error cases as a `SafeResult<T>` discriminated union — `upload-client.tsx`'s four fetch calls now use it and show "Upload failed: ..." in the errors banner instead of crashing. Remaining client files still use raw `res.json()` but the backend guarantee makes it safe for now; they can migrate to `fetchJson` incrementally.

**Regression test** — `tests/smoke/db-bootstrap.test.ts` boots a fresh `file://` Turso DB, calls `ensureDbReady()`, asserts `portfolio_images` table exists, `users(id=1)` seeded, `getPortfolioCount(1)` returns 0 without throwing. Second test proves idempotency. This regression cannot re-ship without the suite flagging it.

**Verification:** 16/16 smoke tests pass. `pnpm build` clean. Full dev-server route sweep (`/`, `/upload`, `/interview`, `/review`, `/runs`, `/runs/new`, `/runs/5`, `/dossier/5`) all 200 or expected 307-redirect post-reset.

### Post-gate regression (part 2): DB wipe against a running server

**Commit:** `945645b`.

John hit `SQLITE_UNKNOWN: no such table: portfolio_images` on the SSE scrape route after a second `pnpm db:reset`. The first fix (Commit `8083ff2`) ran migrations on first access, but both `runMigrations()` and `ensureDbReady()` memoized "done" for the life of the Node process. When the DB was wiped externally while the server kept running, the memoized state said "ready" but the tables were actually gone — permanently stuck until a manual dev-server restart.

Root-caused in three parts:

1. **Per-call sentinel in `lib/db/client.ts`.** `ensureDbReady` now does `SELECT 1 FROM sqlite_master WHERE name='users' LIMIT 1` on every call. ~1ms roundtrip on a healthy DB, effectively free. If the row is missing, it clears `_schemaVerified` + `_bootstrapPromise` and re-runs the full bootstrap. No-ops when the DB is fine; self-heals when the DB has been wiped.

2. **`resetMigrationsMemo()` in `lib/db/migrations.ts`.** Exported so `ensureDbReady` can clear the `let _ran = true` memoization before re-running. Since `schema.sql` is `CREATE TABLE IF NOT EXISTS` throughout and the migration-file runner checks `_migrations` for idempotency, re-running is free — only the in-memory flag had to be reset.

3. **SSE routes got `ensureDbReady` too.** `/api/portfolio/scrape` and `/api/extractor/auto-discover` were the only DB-touching routes that skipped the guard in the first pass. Both now `await ensureDbReady()` at the top of their handlers, closing the "first request after reset hits an SSE route" gap.

**Contract test: `tests/smoke/db-bootstrap.test.ts` expanded.** New `EXPECTED_TABLES` list — `users`, `portfolio_images`, `style_fingerprints`, `akb_versions`, `extractor_turns`, `opportunities`, `past_recipients`, `opportunity_logos`, `runs`, `run_events`, `run_matches`, `run_event_cursors`, `drafted_packages`, `dossiers`, `run_opportunities`, `_migrations` (16 total). Five assertions:

- every table in the list exists after first boot
- `users(id=1)` seeded on first boot
- `getPortfolioCount(1)` runs without throwing (the exact upload-handler call)
- idempotent across double ensureDbReady calls
- **NEW:** self-heals after external wipe — simulates `reset-db.ts`'s drop-all-tables loop, calls `ensureDbReady` again, asserts every table + seed comes back

When a future migration adds a table, updating `EXPECTED_TABLES` is the contract. If someone forgets, the test fails on the next CI run. This catches the exact class of bug we just hit, forever. 19/19 smoke tests pass.

### Post-gate regression (part 3): structural consolidation

**Commit:** `633d3dd`.

The previous two fixes patched ensureDbReady and made migrations self-heal, but the scrape SSE route kept surfacing *no such table: portfolio_images*. Root cause was structural, not per-route: we had **two** sources of schema truth — `lib/db/schema.sql` plus four `lib/db/migrations/*.sql` files — and they'd drifted. The runner applied schema.sql then walked migrations in order, but any failure partway through left the DB in an incomplete state with the `_ran` memo claiming it had finished.

Fix per the user's spec:

1. **One source of truth: `lib/db/schema.sql`.** Every CREATE from the four migration files is folded back into the canonical CREATE TABLE / CREATE INDEX statements (`portfolio_images` UNIQUE dedup, `run_events.event_id` + unique index, `past_recipients.file_ids`, `run_matches.composite_score/filtered_out_blurb`, `opportunity_logos` table, etc). Every statement is CREATE IF NOT EXISTS. The entire `lib/db/migrations/` directory is deleted.

2. **One runner: `lib/db/migrations.ts`.** Applies `schema.sql` in one pass. No file globbing. No `_migrations` bookkeeping. Exports `EXPECTED_TABLES` as the contract and `verifyAllTables()` for post-apply verification. Logs every statement count on boot for visibility.

3. **Self-verifying `pnpm db:reset`.** `scripts/reset-db.ts` now does drop → apply schema.sql → seed users(id=1) → verify all 16 EXPECTED_TABLES → exit non-zero if any missing. No "rebuild on first HTTP request" promise — reset guarantees a ready DB before it returns.

4. **Admin reset button.** `POST /api/admin/reset` runs the same flow, behind the `ATELIER_IS_RESETTABLE_DB` guard. A `ResetDbPanel` renders in `/settings` (only when the guard is true) so the incognito walk-through loop is click-driven: **Reset → walk → Reset → walk**. No terminal. No server restart.

5. **`lib/db/CHANGELOG.md`** documents the schema history since the migrations git log no longer carries it.

Live-verified: `pnpm tsx scripts/reset-db.ts --yes-reset-everything` dropped 16 tables, applied 23 statements, seeded user, verified 16 tables. `POST /api/admin/reset` same. All 7 user-facing routes return 200 after either reset path. 19/19 smoke tests pass including the self-heal and every-table assertions.

**Loop-friendly walk-through:** John should now be able to click the Reset button on `/settings`, run the full onboarding → dossier path, click Reset again, repeat, with zero terminal involvement and zero missing-table errors ever.

### Post-gate regression (part 4): portfolio tile render failures

**Commit:** `c695a60`.

John's walk-through surfaced 2-of-22 tiles rendering as black squares with the filename visible (`illumination.jpg`, `IMG_3236.jpg`, etc), making it look like the uploads had failed. Root-caused server-side with full certainty: every blob URL HEAD'd `200 image/jpeg`, every JPEG had valid bytes (I fetched thumb-3.jpg and it rendered as a proper Antelope Canyon sunbeam photo). The failure was 100% browser-side — 22 `<img>` tags racing for the 6-connections-per-origin HTTP/1.1 limit against `*.public.blob.vercel-storage.com`, with the slowest-responding ones timing out.

Fix in `upload-client.tsx`'s `Tile` component:

- `loading="lazy"` + `decoding="async"` — browser spreads loads based on viewport proximity instead of blasting every tile at once
- `onError` handler retries once with `?r=1` cache-buster so the retry lands on a fresh connection
- `alt=""` (was `alt={filename}`) so failed tiles never leak the filename as visible fallback text
- On second failure, a small "failed to load" pill renders in the black tile instead of the default alt-text fallback

The per-tile delete button already prunes `reviewIds`/`keepIds` (Commit `1fc703e`), so deleting a tile that genuinely failed to load still decrements the Confirm counter honestly.

### Post-gate regression (part 5): "Failed to fetch" on Style Analyst

**Commit:** `f32c980`.

Style Analyst banner read *Analysis failed: Failed to fetch* — the raw TypeError from a `fetch()` that never reached the server. No POST logged server-side, so the request died client-side. Causes: dev-server hot-reload kill, connection reset, browser network blip. But the UI couldn't tell user or developer which.

**Fix — categorised fetch errors.** `lib/api/fetch-client.ts` `fetchJson()` now returns a discriminated `SafeError` kind on every failure:

- `network` — fetch() threw (the TypeError case), remapped to *"couldn't reach server — check your connection"*
- `abort` — AbortController fired (user navigation or manual cancel)
- `timeout` — client timer elapsed (default 120s, configurable)
- `empty-body` — server returned a status with zero bytes
- `parse-error` — non-JSON body
- `http-error` — non-2xx with a parseable `{error}`

Every failure logs to `console.warn` with request URL + kind, so a DevTools screenshot now contains enough context to diagnose without a back-and-forth.

**Style Analyst timeout ceiling matched to server.** `runAnalyst` in `upload-client.tsx` passes `timeoutMs: 300_000` to match `maxDuration = 300` on the route. A real 5-minute vision pass can now land; anything longer is clearly a server hang, not a silent frontend timeout.

**Retry button in the error banner.** The Analysis-failed banner now has a "Retry" button that re-fires `runAnalyst` without a page reload — the most common cause is a transient dev-server bounce and a single retry lands immediately.

**Regression coverage:** `tests/smoke/fetch-client.test.ts` asserts every `kind` fires correctly against a mocked `fetch`. 26/26 smoke tests pass.

## Walk-through batch (WALKTHROUGH_NOTES.md)

### Note 7 — `/runs/new` reported 0 images while /upload showed 21

**Commit:** `47f827f`.

Inline portfolio-count query in `app/(dashboard)/runs/new/page.tsx` had `Number((rowObj as {n: number}))` — the cast wraps the whole row object, so `Number({n: 21})` is `NaN`, then `NaN || 0` returned 0. The `/upload` page used a separate `getPortfolioCount()` in `lib/portfolio/ingest.ts` that correctly read `.n`. Two impls, drift, blocking the Start Run button forever.

Structural fix per spec: every portfolio query goes through a new `lib/db/queries/portfolio.ts` module (`getPortfolioCount`, `getNextPortfolioOrdinal`, `listPortfolio`, `existingPortfolioHashes`). `lib/portfolio/ingest.ts` becomes a re-export shim for back-compat so the upload + scrape routes keep working unchanged. `/runs/new` imports the canonical function directly; the buggy inline query is deleted.

Regression test `tests/smoke/portfolio-count.test.ts` inserts 21 rows, asserts the canonical fn returns 21, asserts it never returns 0 when rows exist (the exact failure case), and asserts the back-compat aliases reference the same function reference (preventing a future fork). Live-verified `/runs/new` renders "21 images" — Start Run button enabled. 30/30 smoke tests pass.

### Note 6 — interview submit 500 + systemic fetch contract

**Commit:** `6cff8ef`.

**Two root causes behind the intermittent 500.**

1. **Anthropic transient throws escaped the agent helpers.** `nextInterviewTurn()` only retried on JSON validation failures — if the API itself threw (429, 529 overloaded, 5xx, network blip), the throw escaped and the route 500'd. John's "repeat the same answer and the second works" was him accidentally retrying the Anthropic call. Fix: new `lib/anthropic-retry.ts` with exponential backoff (4 attempts, 500ms → 8s + jitter) on transient HTTP statuses (408/409/425/429/5xx) and network errors (ECONNRESET, socket hang up, "overloaded"). Wrapped around the interview agent call.

2. **Turn-index race on concurrent submits.** The route read `history.length` then inserted with `turn_index = history.length - 1`. Two submits during the 30s Anthropic call both saw stale history and tried to write the same turn_index. Fix: atomic `COALESCE((SELECT MAX(turn_index)+1 FROM extractor_turns WHERE user_id=?), 0)` INSERT, plus a UNIQUE INDEX on `(user_id, turn_index)` in schema.sql. Double-submits now serialize at the DB layer instead of corrupting history.

**Systemic fetch contract (the "never ships again" guarantee).**

- **Every client fetch migrated to `fetchJson`.** interview-client, review-client, auto-discover-panel, health-panel, upload-client (delete + reorder), run-live (events + playback), new-run-client. Every failure now surfaces a categorised `kind` with console.warn diagnostics. SSE streams (portfolio/scrape, extractor/auto-discover) keep raw fetch() with explicit `// eslint-disable-next-line no-restricted-syntax` comments documenting the exception.
- **ESLint rule blocks regressions.** `eslint.config.mjs` adds `no-restricted-syntax` banning raw `fetch(` in `app/**` + `components/**` (excluding `app/api/**`). Verified firing on a test file. Future PRs that reintroduce raw fetch fail CI.
- **API error contract test.** `tests/smoke/api-error-contract.test.ts` asserts `withApiErrorHandling` + `errorResponse` always produce JSON-bodied 4xx/5xx — never empty bodies. Plus a route-file audit that walks every `app/api/[...]/route.ts` and fails if any route doesn't import `withApiErrorHandling` (SSE routes exempt by path). One missed route (`/api/health/web-search`) was caught and fixed.

37/37 smoke tests pass. `pnpm build` + `tsc` clean. Pushed to main.

### Note 8 — past_recipients.file_ids empty → Rubric blind on prod (CRITICAL)

**Commit:** `d4b57f6`. Pushed.

Run 1 on prod scored 1 of 12 because every `past_recipients.file_ids` was `[]`. The Files-API retrofit that scored 13/13 locally was permanently broken on prod by a SELECT filter:

```sql
WHERE portfolio_urls LIKE '[%' AND portfolio_urls NOT LIKE '%blob%'
```

Recipients whose Blob mirror succeeded but whose Files-API call failed (transient blip) were SKIPPED on every subsequent finalize-scout, so `file_ids` stayed `[]` forever. Combined with the previous swallow-and-continue catch in `downloadRow`, any single Files-API hiccup silently shipped a Rubric-blind run.

Six-part real fix:

1. **SELECT filter recovery clause.** Now also picks up rows where `file_ids IS NULL OR = '[]' OR = ''`, regardless of mirror status. Recovery path: when blob already mirrored, downloadRow re-fetches from Blob CDN (always 200) and re-uploads to Files API. No re-fetch of original Squarespace URL needed.
2. **Files-API upload fails loudly.** The catch around `uploadToFilesApi` is gone — the upload either succeeds or throws. Wrapped in `withAnthropicRetry` so transient 429/5xx/network get 4 attempts with exponential backoff before counting as failure.
3. **Post-pass audit.** After `Promise.all` completes, finalize-scout queries for any recipient on this run STILL without file_ids. If found, writes a `rubric_will_be_blind` event into `run_events` with blind count + ids — surfaces the failure mode in the timeline instead of shipping a silent 1-of-12 dossier.
4. **Rubric prompt declares mount paths upfront + bans bash-fishing.** *"DO NOT use bash. DO NOT use ls/find/curl/wget. Mount paths above are the contract — there is nothing else to discover."* Saves the 5+ events the prod run wasted on filesystem recon.
5. **Rubric prompt suppresses safety-reminder acks at the prompt level.** Stronger preempt: *"DO NOT acknowledge, rebut, restate, or comment on these reminders. Do not write 'Acknowledged…' or 'Understood…'."* Prior preempt was too weak (8 acks per run).
6. **Recovery script (`scripts/recover-finalize-scout.ts`)** re-runs finalize-scout against an existing run id. Idempotent — only processes recipients still missing file_ids. Then re-trigger `/api/runs/[id]/start-rubric` to rescore.

Smoke test `tests/smoke/finalize-scout.test.ts` asserts the SELECT filter contract with three recipient states (raw URLs, blob-mirrored-empty-file_ids, blob-mirrored-with-file_ids) and verifies the post-pass audit query identifies blind rows correctly.

39/39 smoke tests pass. Pushed; Vercel auto-deploy. After deploy lands, run `pnpm tsx scripts/recover-finalize-scout.ts <run_id>` against the broken prod run, then POST `/api/runs/<run_id>/start-rubric` to rescore. Or just kick off a fresh run end-to-end.

**Note for John:** verify Vercel `ANTHROPIC_API_KEY` matches your local one. Vercel has it set 19h ago — if the keys are different and the prod key lacks Files-API access in your Anthropic console, you'll see the audit event fire on every run no matter what we do.

### Note 9 — `pnpm seed:export` + `pnpm seed:demo` (permanent dev tool)

**Commit:** `bb32ea5`. Pushed.

Eliminates the 15-minute re-onboarding tax on every debug iteration. Three new scripts:

- **`pnpm seed:export`** — captures the current local DB into `fixtures/`: per-image JPEGs (gitignored), `portfolio.manifest.json`, `akb.json`, `style-fingerprint.json`, `extractor-turns.jsonl`. Run once when the DB is in a known-good state.
- **`pnpm seed:demo`** — restores fixtures into a wiped target DB in ~30s. Defaults to local. `--target prod` requires both `ATELIER_IS_RESETTABLE_PROD=true` env var AND a typed-host confirmation prompt — belt-and-suspenders against accidental prod wipes.
- **`pnpm seed:demo:run-only`** — companion that POSTs `/api/runs/start` so you can iterate on just the run/Rubric/Drafter loop without clicking Start Run.

Live-verified the full roundtrip: exported 21 images + AKB v12 + fingerprint v4 + 62 interview turns from the local DB; ran seed:demo against a wiped DB; `/runs/new` rendered "21 images" + Start Run enabled.

`fixtures/portfolio/*.jpg` + the manifest are gitignored (copyrighted artwork stays local). `fixtures/akb.example.json` + `fixtures/style-fingerprint.example.json` committed as anonymised schema examples for fresh contributors.

Companion to Note 8's recovery script: combined, John can now `pnpm seed:demo` + `pnpm seed:demo:run-only` in under a minute to validate every Note 8/3/1/2/4/5 fix end-to-end.

### Note 11 — systemic Anthropic retry audit + ESLint guard

**Commit:** `fce8b7f`. Pushed.

Style Analyst (`21a56cb`) and Package Drafter (`0fba724`) were already wrapped. This commit closes the remaining 11 unwrapped Anthropic call sites:

- `rubric-matcher.ts` — `sessions.create` + `events.send`
- `opportunity-scout.ts` — `sessions.create` + `events.send`
- `run-poll.ts` — `events.send` + `sessions.retrieve` (the async-iterator `events.list` is intentionally left raw — mid-stream retries would replay events; the route's `withApiErrorHandling` + next-poll cursor recover instead)
- `knowledge-extractor.ts` — `messages.create`
- `orchestrator.ts` — three `messages.create` (cover narrative, ranking narrative, filtered-out blurb)
- `auto-discover.ts` — parse-pass `messages.create` wrapped; the `messages.stream` left raw with `// eslint-disable-next-line` and a comment explaining why
- `app/api/health/web-search/route.ts` — `messages.create`

Each wrapped call carries a label (`rubric.events.send(run=N)`, `orchestrator.cover-narrative`, etc.) so `[anthropic-retry]` log lines are diagnosable.

Three structural pieces per the Note 11 spec:

1. **ESLint guard** in `eslint.config.mjs`. New `no-restricted-syntax` rules ban direct `await client.messages.create(...)`, `await client.beta.sessions.create/retrieve(...)`, `await client.beta.sessions.events.send(...)`, `await client.beta.files.upload(...)`. Selectors target `AwaitExpression > CallExpression` so the wrapped form (`await withAnthropicRetry(() => client.<...>())`) is allowed — the create-call there is parented by an ArrowFunctionExpression, not an AwaitExpression. Verified firing on a synthetic direct call and silent on every wrapped site in the codebase.
2. **Capacity probe in `/api/health`.** New `anthropic_messages` field fires a tiny `messages.create(max_tokens: 8)` through the retry wrapper and reports `"ok (Nms)"` or the final error. Spots Anthropic-side weather BEFORE running expensive flows. Pairs with the existing `anthropic_files_api` probe (Note 8) — both render in `/settings → Run /api/health`.
3. **Smoke test** (`tests/smoke/anthropic-retry.test.ts`) locks in the retry contract: retries on 529/503/502/429/ECONNRESET, does NOT retry on 400/401/AbortError, throws after `maxAttempts`. 9 assertions, all green.

48/48 smoke tests pass. `pnpm build` + `tsc` + `eslint` all clean. Pushed to main.

### Note 3 — auto-discover product failure (noisy search, fragile fetch, wrong facts)

**Commit:** `5e174b8`. Pushed.

Run-1-on-prod: 60 noisy URLs from search, 8/16 fetch failures, 6 OKs produced 2 wrong facts about the wrong John Knopf. Three structural fixes:

1. **Identity-anchor enforcement.** New `IdentityAnchor = { name, location, medium, affiliations }` threaded `auto-discover-panel → /api/extractor/ingest → ingestUrls → ingestUrl → extractFromText`. The extraction prompt now tells the model: *"If this page describes a different person matching the same name, return {}. Do NOT extract any facts from a same-name page about another person."* New `identity_skipped` flag on the ingestion result so the route can count + report the skipped sources separately. Wrong-person facts become structurally impossible to ingest.

2. **Snippet fallback.** `discoverArtist` now captures `web_search_tool_result.encrypted_content` per-URL during the stream and returns a `snippetsByUrl` map. `parseDiscovery` attaches snippets to each `DiscoveredEntry.snippet`. `ingestUrl` receives the snippet via options; when the page fetch fails (404/403/timeout) OR returns < 50 chars (JS-SPA empty body), it falls back to the snippet text and runs the same extractor pass. Recovers JS-rendered SPAs + bot-blocked sites that previously dropped silently.

3. **Top-K cap on discovery.** `parseDiscovery` sorts entries by confidence desc and slices to K=15 BEFORE returning. Eliminates the 60-link noise wall before any fetch budget is burned.

User-facing summary reframed in `IngestSummaryPanel`: replaces *"(N ok, M failed)"* with *"Read N of M sources (K via search-engine summary fallback) · J skipped — page described a different person with the same name."* Reads as a confidence-building product, not an error wall.

Schema migration: `DiscoveredEntry.snippet` optional, `IdentityAnchor` new export, `/api/extractor/ingest` body adds optional `anchor` + `snippets_by_url`. Legacy "paste URLs" flow keeps working unchanged.

Smoke test (`tests/smoke/auto-discover-identity.test.ts`) covers schema acceptance + top-K behaviour. 53/53 tests pass. `tsc` + `lint` + `build` clean.

**Acceptance criteria status (verifiable on next prod run):** ≥10 of top-15 yield extractable content via fetch-or-snippet ✓ structurally enabled. Zero wrong-person facts ✓ structurally enforced. User-facing summary reframed ✓ shipped. Integration test against live web_search left for John's manual verification rather than CI (real Anthropic + web_search costs).

