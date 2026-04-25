# §5.1.a Walk-through Notes (open)

Running notes from John's incognito prod walk-through. Each item logged as it surfaces; coder will fix the whole batch in one pass when the walk-through is complete. DO NOT hand off piecemeal.

---

## Note 1 — Auto-discover ingest: no visible status during processing

**Where:** `/interview` page, Auto-discover tab, after clicking submit on the seed form (Name / Medium / City / Affiliations).

**Symptom:** Bottom of the page shows a "Parsing findings…" header with a list of search queries and "Found 60 results." User has no idea what's actually happening — is it stuck? Almost done? Halfway? The query list scrolls past with no time anchor and no context.

**Root cause:** Auto-discover route is a long-running web research call (likely 30–60s). The frontend has no progress channel and no cycling status copy. The page reads as frozen even though work is happening.

**Fix (real, not patch):** Add cycling status messages that rotate every ~5s while the route is in flight. Since we can't actually measure progress on a single async call, the messages are GENERATED to communicate the work the agent is doing at each stage. Example cycle:

  1. "Searching the web for your public record…"
  2. "Reading your gallery sites and bios…"
  3. "Parsing publication mentions…"
  4. "Cross-referencing exhibition records…"
  5. "Identifying affiliations and residencies…"
  6. "Compiling your Knowledge Base…"
  (loop if still running)

Cycle continues until the route resolves OR errors. On resolve: replace with "Done — N facts added to your Knowledge Base." On error: replace with the actual error message via `withApiErrorHandling` / `fetchJson`.

**File(s):** `app/(onboarding)/interview/*` (auto-discover client component); add a small `<CyclingStatus messages={[…]} intervalMs={5000} />` component, reuse on any other long-running route.

**Acceptance:** during a real auto-discover run, the user sees a continuously-updating status line every ~5s that communicates the kind of work happening, and never sees a frozen-looking screen. Same component reusable on other long routes (Style Analyst, Knowledge Extractor interview, run-start, etc.).

---

## Note 2 — Auto-discover ingest step: no visible status during actual ingestion

**Where:** `/interview` page, Auto-discover tab, AFTER the pre-ingest review completes and the user clicks "Ingest selected pages" (the step AFTER Note 1's search-findings step).

**Symptom:** page shows "Ingesting selected pages…" with the yellow disambiguation note persisting above, then… nothing. No progress, no cycling messages, no visible indicator of whether ingest is running, stuck, or done. Same frozen-feel issue as Note 1 but on a DIFFERENT long-running call.

**Root cause:** same class as Note 1 — long-running async call with no progress channel and no cycling status copy.

**Fix:** reuse the `<CyclingStatus />` component from Note 1 with ingest-specific messages:

  1. "Opening your selected pages…"
  2. "Extracting biography, CV, and press mentions…"
  3. "Parsing exhibition history…"
  4. "Reading gallery representation details…"
  5. "Normalizing facts into your Knowledge Base…"
  6. "Saving your updated Knowledge Base…"
  (loop if still running)

On resolve: "Ingest complete — N new facts added. Review below, or start the interview to fill remaining gaps."

**File(s):** `app/(onboarding)/interview/*` (ingest client component).

**Acceptance:** user never sees a frozen screen during ingest. Every ~5s a new status line rotates in. Terminal state (success or error) is unambiguous.

**Note for coder:** both Note 1 (search/parse findings) AND Note 2 (ingest selected pages) are DISTINCT long-running calls. They need separate cycling-message sets because the work being done is different. Share the `<CyclingStatus />` component, not the message list.

---

## Note 3 — Auto-discover product failure: noisy search, brittle fetch, wrong facts ingested

**Where:** `/interview` Auto-discover, after the full ingest cycle completes for John Knopf seed.

**Symptom (this is product-level, not cosmetic):**
- Search returned 60+ links — too many, mostly noise
- Of 16 sources actually attempted, only 6 succeeded; 8 failed
- Of 8 failures: 4 × HTTP 404 (stale URLs the artist no longer hosts), 1 × HTTP 403 (bot protection: thewickedhunt.com podcast), 3 × "no extractable text content" (JS-rendered SPAs: mondoir.com gallery pages, exchange.art, singulart.com)
- Of the 6 that succeeded, only 2 facts were ingested (`intent.influences`, `awards_and_honors`) — and BOTH are wrong (per John, who is the ground truth here)
- Net result: user spent ~60s of compute, paid for 16 web_fetch calls, got 2 wrong facts and an error wall. Product reads as broken.

**Root causes (multiple, all real):**

1. **Search result noisiness — no relevance ranking before fetch.** Returning 60 links and trying to fetch any of them is wrong. Need a search → rank → top-K → fetch pipeline.
2. **Single-strategy fetch is too brittle for the modern artist/gallery web.** Most artist sites and modern gallery sites are JS-rendered React/Next.js apps that Cheerio (server-side HTML parsing) can't see. We're losing 50%+ of the actual content because of this. Bot-blocked sites (Cloudflare, podcast hosts) are another large class.
3. **No fallback for failed fetches.** When `web_fetch` fails (any reason), we silently log "failed" and move on. But `web_search` already returned a snippet for that URL — we have free signal we're throwing away.
4. **Disambiguation is shown to user but not enforced downstream.** The yellow disambiguation note ("Multiple John Knopfs found, only the Las Vegas Emmy-nominated landscape photographer is the real one") is presented as UI text, but the extraction pass per-page doesn't get a structured "ONLY extract facts about [identity_anchor]" constraint. So the model can still ingest a fact that belongs to the wrong John Knopf.
5. **Per-fact provenance not validated against identity anchor.** Every fact ingested should carry a `source_url` and a `confidence` and pass an "is this fact about the right person?" check before write.

**Fix (real, not patches):**

1. **Search → rank → top-K pipeline.** After web_search returns, run a Claude pass to rank results by `(name match × location match × medium match × is-this-actually-the-right-person-confidence)`. Keep top 15. Discard the rest. This eliminates noise BEFORE we burn fetch calls.

2. **Two-tier fetch with snippet fallback.** For each ranked URL, attempt `web_fetch`. If fetch returns 404/403/empty/<200 chars of text, fall back to the `web_search` snippet that already exists for that URL — snippets are JS-rendered content as Google sees it, which is often sufficient for fact extraction. Use the snippet as the source content for that URL. If BOTH fail (no snippet either), drop the URL silently — no user-visible "failed" wall.

3. **Identity-anchor enforcement on extraction.** Pass the disambiguated identity (name + location + medium + confirmed affiliations) as a STRUCTURED constraint into the per-source extraction prompt. Model rule: "If this source describes a different person matching the same name, return zero facts for this source. Only extract facts that are unambiguously about [anchor]."

4. **Per-fact provenance + identity check.** Every fact ingested gets `source_url`, `extracted_quote` (the exact sentence the fact came from), and a `passed_identity_check: bool`. Facts that fail the check are not written. This makes "wrong facts ingested" structurally impossible.

5. **User-facing summary reframed.** Replace "(6 ok, 8 failed)" with: "Read N sources successfully. M sources were unreachable (offline, blocked, or JavaScript-only) — we used search-engine summaries for those instead. Added K verified facts to your Knowledge Base." Then list the K added facts with a one-click "this isn't right" reject button per fact, which removes the fact AND tags the source URL as untrusted for future runs.

6. **Add a `/api/akb/auto-discover/diagnostics` debug view** (gated to dev / single-tenant) that shows: full search result list, ranking scores, fetch status per URL, snippet-fallback usage per URL, extracted facts per source, identity-check pass/fail per fact. Future debugging of this exact class of issue takes seconds, not a fresh user walk-through.

**Acceptance criteria:**
- John reruns auto-discover with same seed inputs. Search returns ≥30 candidates internally; top 15 are kept. ≥10 of the top 15 yield extractable content (via fetch or snippet fallback). ≥8 facts are added to AKB v1. Zero facts about the wrong John Knopf are ingested. User-facing summary reads as a confidence-building product, not an error wall.
- Add an integration test under `tests/integration/auto-discover.test.ts` that uses a fixed seed (say "John Knopf, Landscape, Las Vegas") and asserts: (a) ≥8 facts written to akb_versions, (b) zero facts whose source is the wrong-person disambiguation candidate, (c) user-visible response contains success summary not error wall.

**File(s):** auto-discover route + extractor agent prompt + per-fact write path. Likely `app/api/akb/auto-discover/route.ts`, `lib/agents/knowledge-extractor.ts`, `lib/db/queries/akb.ts`.

**Priority:** high. This is the headline novel-primitive #1 (Knowledge Extractor) and right now it's broken in a way a judge would notice immediately.

---

## Note 4 — Interview asks for "full legal name" but should lead with artist name

**Where:** `/interview` page, after auto-discover, the gap-detection interview's first question.

**Symptom:** Interview opens with "What's your full legal name?" That's the wrong primary identity question for a working artist. Most artist-facing context (bios, exhibition labels, publication credits, social profiles, monograph covers) uses an **artist name** that may or may not equal the legal name. Examples: an artist who married and uses their maiden name professionally; an artist with a pseudonym; an artist who uses initials publicly. Atelier should treat the artist name as primary identity and the legal name as administrative metadata.

**Why it matters for submissions:** application forms ARE split this way. Most grant/residency applications have:
  - "Name (as it should appear in publicity / catalog)" → artist name
  - "Legal name (for contract / W-9 / tax purposes)" → legal name
  - Often a "preferred name" field too

If we only capture legal name, the Package Drafter has to assume legal-name == artist-name and risks mis-crediting John in cover letters, statements, and bio blurbs.

**Fix (real, not patch — schema change):**

1. **Schema:** `identity` AKB fields become:
   - `identity.artist_name` (REQUIRED, primary identity used in all public-facing drafted output)
   - `identity.legal_name` (optional, used only in administrative sections of submission forms)
   - `identity.legal_name_matches_artist_name` (boolean, default true — when true, legal_name is auto-filled from artist_name and the question is skipped)
   - `identity.preferred_pronouns` (separate concern but flag — many submission forms now ask)

2. **Interview flow:**
   - First question: "How should your name appear in your bio, on exhibition labels, and in publication credits?" → writes `artist_name`
   - Second (conditional): "Is your legal name (for contracts, tax forms, application admin) the same as your artist name?" → if yes, copy artist_name to legal_name, skip; if no, ask for legal_name.
   - Same conditional pattern can apply to other split-identity fields.

3. **Drafter behavior:** Package Drafter uses `artist_name` for ALL public-facing drafted text (cover letters, bios, statements, project descriptions). `legal_name` ONLY appears in admin/contract sections of templates that explicitly require it.

4. **Auto-discover identity-anchor (cross-references Note 3):** the disambiguation step should anchor on `artist_name` (the public-facing name that matches search results, gallery sites, press mentions). `legal_name` is rarely useful for web disambiguation.

5. **Migration:** existing AKBs that only have `legal_name` get auto-migrated: `artist_name = legal_name`, `legal_name_matches_artist_name = true`. No data loss; old data assumed coherent until user edits.

**Acceptance:**
- Fresh interview asks for artist name first, then conditionally asks if legal name differs.
- Drafted cover letters, bios, statements use `artist_name` exclusively.
- An AKB where `artist_name = "John Knopf"` and `legal_name = "Jonathan Knopf"` (hypothetical) produces a cover letter signed "John Knopf" with the W-9-equivalent admin block (if any) referencing "Jonathan Knopf."
- Add unit test asserting Package Drafter never uses `legal_name` in any public-facing field.

**File(s):** AKB schema (`lib/schemas/akb.ts` or wherever), interview gap-detection (`lib/agents/extractor-gaps.ts`), interview question generation, Package Drafter prompt + variable substitution.

---

## Note 5 — Interview asks citizenship and city+country in back-to-back questions (feels redundant)

**Where:** `/interview` page, after the name question. Interview asks for citizenship, then in the next question asks for city + country.

**Symptom:** Two questions in sequence both asking about country — feels like the interview is asking the same thing twice. Reads as "broken software" to a user.

**Root cause:** the gap-detection pipeline treats `identity.citizenship` and `identity.home_base.country` as independent unfilled fields and asks them sequentially. They're only redundant when they're equal (which is true for ~90% of users), but the interview asks them as if they're always distinct concepts.

**Why these ARE distinct concepts (don't collapse them):**
- Citizenship = passport identity. Determines eligibility for citizen-only grants (e.g., NEA Fellowships are US-citizen-only; many EU national grants require EU citizenship).
- Country of residence = where you live now. Determines eligibility for residency-based grants (e.g., "Open to artists living in California").
- City / region = within country. Determines eligibility for state/regional grants (Nevada Arts Council requires Nevada residency, full stop).

For Rubric to score eligibility correctly, all three are needed. So we DON'T merge them. We ask them in a way that doesn't feel redundant.

**Fix (real, not patch):**

1. **Collapse home base into ONE structured question:** "Where do you live? (We use this to find regional grants and residency-eligibility programs.)" → structured input with City + State/Region + Country fields side-by-side, not three separate questions. Writes `identity.home_base.{city, region, country}` in one form submission.

2. **Make citizenship conditional + smart:**
   - After home base answered, default `identity.citizenship` to home country (most common case).
   - Ask only ONE follow-up: "Are you a citizen of [home_country]?" with options [Yes / No, my citizenship is different / Multiple citizenships].
   - If Yes (default): skip the citizenship question entirely. `identity.citizenship = [home_country]`.
   - If different: ask "What's your citizenship?" with country select.
   - If multiple: ask for list. Many artists have dual citizenship that opens up more grant eligibility — this is real signal worth capturing.

3. **General principle for the gap-detection pipeline:** when two AKB fields are commonly equal (legal_name vs artist_name in Note 4, citizenship vs home country here), use a "Same as [other field]?" conditional rather than asking them as two independent gaps. Add this as a first-class concept in the gap-detection code: "default-equals" relationships.

**Acceptance:**
- Fresh interview asks home base ONCE as a structured form (city + region + country together).
- Citizenship is auto-defaulted to home country and only re-asked if user indicates difference.
- For John: he answers "Las Vegas, NV, USA" once and "Yes, US citizen" once — done. No redundancy.
- For an artist with a different citizenship: the conditional fires, captures the difference, both fields end up correct.
- Add a unit test that asserts the interview NEVER asks the same conceptual question twice in sequence.

**File(s):** AKB schema (home_base nested object), gap-detection (`lib/agents/extractor-gaps.ts`), interview question generation, "default-equals" relationship table.

---

## Note 6 — Interview submit returns 500 + frontend crashes (defensive wrappers not applied to interview route)

**Where:** `/interview` page, after answering the citizenship question (Note 5's question). User submits answer; UI doesn't advance; console shows:

```
Failed to load resource: the server responded with a status of 500 ()
interview:1 Uncaught (in promise) SyntaxError: Failed to execute 'json' on 'Response': Unexpected end of JSON input
    at N (page-aed0ccdd9c696ec8.js:1:10545)
```

**Symptom:** interview is stuck. User answered the question, no error shown in UI, no next question, no completion screen. Identical failure mode to the upload-page bug we already shipped a fix for (commit 8083ff2 — `withApiErrorHandling` + `fetchJson`). The fix was supposed to be applied across "every API route that returns JSON on success" — clearly the interview submit route was missed.

**Root causes (two layers, both real):**

1. **Backend:** the interview submit route (likely `/api/akb/interview/submit` or similar) is throwing without going through `withApiErrorHandling`, OR the handler is reaching a code path that returns `Response` directly without a JSON body. The throw itself needs root-causing — find the actual error in the dev log (`/tmp/atelier-dev.log`) or Vercel runtime logs and fix it. Likely candidate: the handler tries to write the answer to AKB but hits a schema mismatch (e.g., the answer's target field path doesn't exist in the AKB merge layer), or the gap-detection re-call fails after writing the answer.

2. **Frontend defensive wrapping not universal:** the audit "do a pass on every other API route that returns JSON on success" from the upload-fix hand-off didn't extend `withApiErrorHandling` + `fetchJson` to the interview client. Same bug class, second route. Need to ACTUALLY do the pass this time — not "wherever it manifested" but "every fetch in every client component."

**Fix (real, not patch):**

1. **Root-cause the 500.** Find the actual throw in the interview submit handler. Fix the underlying bug (likely AKB merge or gap-detection re-call failure). Log the error message in the response body so future failures are diagnosable from the console alone.

2. **Wrap interview submit (backend) in `withApiErrorHandling`.** Confirm by reading the file — if not already wrapped, wrap it. Same for every other backend route in the project. Audit `app/api/**/route.ts` and assert every exported handler is wrapped.

3. **Wrap interview client (frontend) in `fetchJson`.** Same pattern as upload-client. Audit every `fetch()` call in `app/**` and `components/**` — every one of them needs to go through `fetchJson` or equivalent SafeResult-returning helper.

4. **Add a regression test in `tests/smoke/api-error-contract.test.ts`** that:
   - Iterates every API route under `app/api/**/route.ts`.
   - For each, fires a deliberately-broken POST (missing required body, invalid JSON, etc.) and asserts the response: (a) has status 4xx or 5xx, (b) has a `Content-Type: application/json` header, (c) parses to a JSON body containing `{error: string}`. NEVER an empty body.
   - This test is the structural guarantee that the upload + interview class of bug never ships again.

5. **Add an ESLint rule (or grep CI check)** that fails the build if any client-side `fetch()` call doesn't go through `fetchJson`. Permanent.

**Acceptance:**
- John resumes the walk-through, answers the citizenship question, the interview advances OR shows a readable error.
- No `Failed to fetch` / `Unexpected end of JSON input` ever again from any route.
- Regression test in (4) passes against every route.

**File(s):** interview submit route handler, all `app/api/**/route.ts` for the audit, interview-client component, all `fetch()` callers for the frontend audit, `tests/smoke/api-error-contract.test.ts` (new).

**Priority:** highest. This is a repeat of a class of bug we already "fixed." It signals the prior fix was scoped too narrowly. The systemic fix is the contract test + ESLint rule, not just patching this one route.

**Update (diagnostic gold):** John repeated the EXACT SAME answer ("Self taught") and the second submit succeeded. The interview advanced to the next question. This means the 500 is INTERMITTENT, not deterministic. The same input that failed once succeeded on retry. That rules out schema mismatch, malformed input, and AKB merge bugs (those would fail every time). Likely root causes:

  - **Race condition** in the interview-submit handler — concurrent writes to AKB (e.g., the answer-write and the gap-detection re-call both trying to mutate `akb_versions` at the same time, with one stomping the other and throwing).
  - **Stale `ensureDbReady()` memoization** — first call hits a connection that's not actually ready yet despite the memoized "ready" flag, throws on the SQL, second call hits a now-warm connection and succeeds.
  - **Unawaited promise in the handler** — handler returns response before an internal write resolves, the throw from the unawaited write surfaces as the route's error.
  - **Anthropic API call timing out on first try** — gap-detection re-call after the answer-write hits a slow Anthropic response that exceeds whatever timeout is in the route.

The coder should reproduce by hammering the interview submit endpoint with the same payload N times and observing the failure rate. Real fix is whichever root cause turns up — but the contract-test + frontend wrapper still apply so the user never sees a crash even on intermittent failures.

---

## Note 7 — `/runs/new` reports 0 portfolio images despite portfolio being uploaded + Style Analyst having run

**Where:** `/runs/new` page, after upload (21+ images), Style Analyst (produced fingerprint v4), and interview (produced AKB v12).

**Symptom:** Run-start preflight panel shows:
- Portfolio: **0 images** (red text)
- Style fingerprint: v4
- Knowledge Base: v12
- Banner: "Finish upload before starting a run." (yellow, blocking)

User cannot start a run. But the portfolio was successfully uploaded earlier in the session — Screenshot 24 showed "PORTFOLIO (21)" with all tiles visible. Style Analyst ran successfully against those images (proven by fingerprint v4 existing). Then suddenly the runs page sees zero.

**Root cause CONFIRMED (Screenshot 33):** the `/upload` page renders all 20+ portfolio images correctly (same DB, same incognito session, same prod URL). The `/runs/new` page reads "0 images" against the same DB. **This is a query mismatch, not data loss.** Two pages, two different queries, disagreeing on the same `portfolio_images` table.

**Plausible specific causes:**
   - `user_id` mismatch (upload page reads where `user_id = 1` or session-derived id, runs/new reads where `user_id = null` or different session-derived id)
   - A `status` or `consumed_at` flag the upload page ignores but the runs page filters on
   - A `keep` boolean that defaults to true but is set to false somewhere
   - Different table aliases pointing at different tables (`portfolio_images` vs `portfolio_v2` migration leftover, etc.)
   - Server Component cache mismatch: runs/new uses cached/stale read while upload uses fresh client query

**Diagnosis the coder must do BEFORE writing any fix:**

1. Run a direct DB query: `SELECT COUNT(*) FROM portfolio_images WHERE user_id = 1` — does the count match what was uploaded?
2. Run: `SELECT id, user_id, blob_pathname, created_at, [any status/keep/consumed_at columns] FROM portfolio_images WHERE user_id = 1 LIMIT 5` — see what's actually stored.
3. Read the count query in the `/runs/new` server component or API route — what's it filtering on?
4. Compare the two. The mismatch is the bug.

**Fix (real, depends on diagnosis):**

- If data loss: find the destructive write, remove it. Portfolio is durable user data — nothing should delete it without explicit user action via Delete button.
- If query mismatch: align the `/runs/new` count query with the upload write. Same WHERE clauses, same column semantics. Add a smoke test that uploads N images then asserts `/runs/new` count = N.

**Cross-cutting fix regardless of which root cause:** every page that displays a "portfolio image count" anywhere in the app must use the SAME canonical query function from `lib/db/queries/portfolio.ts`. No more inline counts in three different places that drift. This is the structural fix that prevents this exact class of bug from recurring (compare to the boot-fix structural pattern in commit 8083ff2).

**Acceptance:**
- After upload of 21 images, `/runs/new` shows "Portfolio: 21 images" and the Start Run button is enabled.
- After Style Analyst runs, portfolio count remains 21 (no destructive consumption).
- After interview/AKB updates, portfolio count remains 21.
- Smoke test asserts the count is consistent across upload → analyst → interview → run-start.

**Priority:** highest. This blocks every demo recording. Without a runnable run, there's no dossier, no submission demo.

**File(s):** `app/(dashboard)/runs/new/page.tsx`, the count query function, possibly `lib/agents/style-analyst.ts` if it's deleting/marking images.

---

## Note 8 — `past_recipients.file_ids` empty on every opportunity → Rubric has no cohort, scores 1 of 12 (CRITICAL, demo-blocking)

**Where:** Run 1 on prod (johnknopf5@gmail.com Vercel deploy), Rubric phase. Diagnosed via direct DB query (see `scripts/diagnose-run.mjs`, `scripts/recipients-check.mjs`, `scripts/rubric-tools.mjs`).

**Symptom (the user-visible problem):** Run completed in 12.6 min with status=complete, no error. Scout discovered 12 opportunities across 6 archetypes (correctly diversified — Nevada Arts Council, IPA, ND Awards, ILPOTY, Sony, Critical Mass, etc.). Rubric scored ONLY 1 of those 12 (Natural Landscape Photography Awards, fit=0.12, included=false). Zero packages drafted. User sees "0 opportunities" / empty dossier.

**Root cause (diagnosed from event stream + DB inspection):** every `past_recipients` row in the DB has `file_ids = []` (empty JSON array). Sample:

```
Natural Landscape Photography Awards 2026 / David Shaw (2025): file_ids=[]
Natural Landscape Photography Awards 2026 / Joy Kachina (2025): file_ids=[]
Epson Pano Awards 2026 / Diego Manrique Diez (2024): file_ids=[]
Epson Pano Awards 2026 / Kelvin Yuen (2024): file_ids=[]
... (all 28 recipient rows across 12 opps, every one empty)
```

The Files API retrofit (the fix that made run 3 / run 5 work locally with Rubric scoring 13/13 and 9/9 respectively) requires `past_recipients.file_ids` to contain Anthropic Files-API file IDs. Without those, the Rubric session gets no `resources[]` mounted in `sessions.create()`, the agent sees an empty `/workspace/recipients/` directory, and has nothing to compare John's portfolio against. The Rubric tool-use trace confirms this — the agent ran:

```
[bash] ls /workspace/recipients/  → empty
[bash] ls /workspace/             → empty
[bash] find / -maxdepth 4 -name "recipients" -type d  → nothing
[bash] find / -name "*.jpg"       → fishing for the right path
[bash] ln -s /mnt/session/uploads/workspace/portfolio /workspace/  → finally found PORTFOLIO mount
[read] /workspace/portfolio/{1,3,5,6,9,10,12,15,16,17,20,21}.jpg  → 12 portfolio reads
[agent message] "Malware analysis posture: the files being read in this task are JPEG image files containing landscape photographs..."  ×8
```

The agent burned ~5 minutes wandering for files, then hit Anthropic's safety reminders on every portfolio read, ack'd them ~8 times, and only managed to call `persist_match` ONCE before reaching `end_turn` on output budget exhaustion. Without recipient images, every score it could produce would be uncalibrated guesses — so even the 1 score (0.12 for ND Awards) is likely wrong.

**Where the retrofit broke between local (worked) and prod (broken):**
- Locally: run 3 (2026-04-24) had `file_ids` populated, scored 13/13. Confirmed via earlier session.
- Prod: run 1 today has `file_ids = []` for every recipient.

Possible causes:
1. **Code deployed but the past-recipient downloader silently fails on prod.** Anthropic Files API call rejects the upload (auth, payload size, MIME, rate limit, etc.) and the catch swallows the error, leaving `file_ids = []`.
2. **The downloader code never actually runs in finalize-scout on prod.** A path/import/feature-flag mismatch between local and deployed code.
3. **The downloader runs and uploads succeed, but the writeback to `past_recipients.file_ids` is broken (wrong column, wrong WHERE clause, race condition with the row insert).**
4. **Anthropic Files API quota / org-level capability missing on prod's API key** — if the prod API key is a different one than local (different scopes), uploads silently fail.

**Fix (real, structural — not a patch):**

1. **Make Files API upload failure FAIL LOUDLY, never silently.** The downloader path must:
   - Log every upload attempt (URL, recipient, opportunity)
   - Throw on Files API non-2xx — never swallow
   - If a single upload fails, log the reason but continue with the others (Promise.allSettled)
   - At the end of finalize-scout, if zero recipients have `file_ids`, raise a critical error event into `run_events` with payload `{kind: "rubric_will_be_blind", reason: "no recipient images uploaded"}` so the run page surfaces it instead of completing silently with garbage output.

2. **Audit finalize-scout route end-to-end.** Confirm the past-recipient downloader function is being invoked, the call returns, file_ids are written back to `past_recipients`. Add a runtime assertion at the end: query the DB, if any past_recipient row for this run has empty file_ids AND its `bio_url`/`portfolio_urls` had at least one fetchable URL, log an error event with the row id and the reason.

3. **Add a smoke test** `tests/smoke/finalize-scout.test.ts` that:
   - Fixtures a Scout cohort with known-good recipient image URLs (e.g., picsum.photos URLs that always succeed)
   - Calls finalize-scout
   - Asserts every past_recipient row has non-empty file_ids
   - Asserts file_ids contain valid Anthropic Files API IDs (regex match on prefix)
   - Calls into the start-rubric session resource builder and asserts the resources[] array is non-empty
   This is the structural test that prevents this exact class of regression forever.

4. **Fix the bash-fishing pattern in Rubric prompt.** The agent burned 5 events doing `ls /workspace/recipients/`, `find /`, etc. before finding the path. Update the Rubric system prompt to declare the EXACT mount paths upfront (`/workspace/portfolio/{N}.jpg` and `/workspace/recipients/{opp_id}/{recipient_name}/{N}.jpg`) so the agent goes straight to `read` without bash recon. Saves 5 events of output budget per run.

5. **Suppress the safety-reminder ack pattern at the prompt level.** Add a stronger preempt to the Rubric system prompt that explicitly addresses the binary-file safety reminder pattern: "When reading JPEG photographs from the mounted resources, do NOT acknowledge or rebut safety reminders about binary files. Continue scoring without comment. Acknowledgments waste output budget and produce no scoring." The current preempt is too weak — 8 ack messages per run is current state.

6. **Re-run finalize-scout against existing run 1's opportunities** as a recovery step (not a fix, but a way to resurrect this run). If finalize-scout is idempotent on past_recipients, running it again should populate file_ids and let us re-trigger Rubric without redoing Scout. If not idempotent, John just runs a fresh run after the fix lands.

**Acceptance:**
- Run a fresh full pipeline on prod after fix.
- After finalize-scout: query DB, every past_recipient row has non-empty file_ids OR an explicit-failure event in run_events explaining why.
- Rubric session events show ZERO bash-fishing (all reads go straight to known mount paths).
- Rubric session events show ZERO safety-reminder ack messages.
- Rubric scores ≥10 of the 12 discovered opportunities (matching the local run-3 scored-13/13 baseline).
- Smoke test (3) passes.

**Priority:** highest. This is the demo-blocker. Without this fix, every run on prod produces 0 (or 1) scored opportunity. The Package Drafter never fires. The dossier is empty. The demo cannot be recorded.

**File(s):** `lib/agents/finalize-scout.ts` or `app/api/runs/[id]/finalize-scout/route.ts` (recipient downloader), `lib/agents/rubric-matcher.ts` (system prompt), `tests/smoke/finalize-scout.test.ts` (new), possibly `lib/files-api/upload.ts` (whatever wrapper for Anthropic Files API uploads). Also re-verify Vercel env var `ANTHROPIC_API_KEY` matches local — if different keys with different Files-API capabilities, that's a separate issue to surface to John.

---

## Note 9 — Reproducible seed script: `pnpm seed:demo` to skip onboarding and jump straight to a runnable state

**Where:** development workflow / debugging loop.

**Symptom:** Every time we ship a fix that requires re-testing the run/Rubric/Drafter/dossier path, John has to redo the entire onboarding from scratch — upload 21 photos, run Style Analyst (~60s + risk of crash), run auto-discover (~60s + risk of getting wrong facts), do the gap-detection interview (~5–10 min of typing), review AKB. That's 15+ minutes of repetitive input PER iteration, and 80% of it tests parts of the product that already work. The debug loop on the actually-broken phases is brutally slow.

**Fix (real, structural — this becomes a permanent dev tool, not a hackathon hack):**

Build two complementary scripts:

### `pnpm seed:export` (run when in a "good" state to lock it in)

Captures the current Turso DB state into fixture files for later re-seeding. Inputs: nothing — reads from whatever DB the local `.env.local` points at. Writes:

- `fixtures/portfolio/*.jpg` — downloads every blob URL referenced by `portfolio_images` for the default user, saves locally
- `fixtures/portfolio.manifest.json` — list of {filename, original_blob_url, file_size, sha256, ordinal, kept} for each image
- `fixtures/akb.json` — the latest `akb_versions` row's data JSON
- `fixtures/style-fingerprint.json` — the latest `style_fingerprints` row's data JSON
- `fixtures/extractor-turns.jsonl` — interview history (optional, for completeness)
- Prints a summary: "Exported N portfolio images, AKB vM (K facts), fingerprint vN, K interview turns. Run `pnpm seed:demo` to restore this state."

### `pnpm seed:demo [--target local|prod]`

Restores the fixture state into a clean DB. Defaults to local. Requires `--target prod` AND a confirmation prompt to seed prod (prevents accidents). Steps:

1. Read fixtures from `fixtures/`. If missing, exit with "Run `pnpm seed:export` first against a known-good state."
2. Run `db:reset` against the target DB (uses existing `ATELIER_IS_RESETTABLE_DB` guardrail — same protection model).
3. Insert the default user row (id=1).
4. For each fixture image: upload to Vercel Blob (target's blob token), capture new blob_url + blob_pathname, insert into `portfolio_images` using the canonical writer (Note 7's `lib/db/queries/portfolio.ts`).
5. Insert `style_fingerprints` row with fixture JSON.
6. Insert `akb_versions` row with fixture JSON.
7. (Optional) Insert `extractor_turns` rows from the JSONL fixture.
8. Verify: query the DB, assert portfolio count matches fixture count, assert AKB version exists, assert fingerprint exists. Report: "Seeded [target]: N portfolio images, AKB vM, fingerprint vN. Visit /runs/new to start a run."

### Fixture file management

- Add `fixtures/portfolio/*.jpg` to `.gitignore` (John's copyrighted photos must not be in the public repo).
- Add `fixtures/portfolio/.gitkeep` so the directory exists.
- Add `fixtures/portfolio/README.md` explaining: "Run `pnpm seed:export` once your local DB has a portfolio you want to lock in. Photos are gitignored — never commit copyrighted work."
- For CI: provide `fixtures/portfolio.ci.json` with picsum.photos URLs as a generic fallback so smoke tests can seed a non-copyrighted demo state.
- Commit `fixtures/akb.example.json` and `fixtures/style-fingerprint.example.json` as schema examples (anonymized — placeholder names/locations/affiliations) so a fresh contributor knows the shape without needing John's real data.

### Cross-target safety

- `seed:demo` without `--target` defaults to local. Logs the target Turso URL host (not token) before proceeding.
- `seed:demo --target prod` requires the env var `ATELIER_IS_RESETTABLE_PROD=true` (separate flag from the local one) AND types a confirmation prompt ("Type the prod Turso host name to confirm reset: ___"). Belt-and-suspenders.
- Never auto-detect target. Explicit only.

### Companion: `pnpm seed:demo:run-only`

Half-step variant: assumes the demo state is already seeded, just kicks off a fresh run via curl/internal call and tails the events. Lets John iterate ONLY on the run/Rubric/Drafter loop without even hitting the UI for the start-run click. Optional but useful.

**Acceptance:**
- John runs `pnpm seed:export` once against his current good local state (post-walkthrough). Fixtures land in `fixtures/`.
- John runs `pnpm seed:demo` against a wiped local DB. ~30 seconds later, /runs/new shows "Portfolio: 21 images, Style fingerprint: vN, Knowledge Base: vM, Start Run enabled."
- John runs `pnpm seed:demo --target prod` (with explicit env var + confirmation). Same result on prod.
- Fixture files are gitignored for the photos, committed for the example/schema versions.
- A new contributor can clone the repo, run `pnpm seed:demo` with the example fixtures, and have a working seeded state without needing John's data.

**Why this is real, not a bandaid:**
- It's a permanent dev tool — every future engineer working on Atelier needs this.
- It accelerates EVERY future debug loop on the run/Rubric/Drafter/dossier path by 10–15 minutes per iteration.
- It enables CI integration tests (smoke tests can seed a known state, run an actual end-to-end pipeline, assert on the dossier output).
- It removes the temptation to skip testing because "it'll take too long to redo the onboarding."
- It separates "is the onboarding flow broken?" from "is the run flow broken?" so we can debug them independently.

**Priority:** high. Should ship between Note 8 and Note 3 — it'll accelerate the verification of every fix that follows.

**File(s):** `scripts/seed-export.ts` (new), `scripts/seed-demo.ts` (new), `package.json` scripts (`seed:export`, `seed:demo`, `seed:demo:run-only`), `fixtures/` (new directory with .gitignore + README + examples), `.env.example` updates for the new `ATELIER_IS_RESETTABLE_PROD` flag.

---

## Note 10 — `/review` cannot delete auto-populated facts (data integrity bug)

**Where:** `/review` page, AKB editor.

**Symptom:** Auto-discover (broken per Note 3) ingested a fabricated fact: `awards_and_honors[0] = {name: "StarCraft competition winner", year: 2011}`. This is a hallucination — wrong person or pure invention. John tried to remove it on `/review` and could not — the UI does not allow deletion of auto-populated array entries. Workaround required a direct DB write (`scripts/fix-akb.mjs`) by Claude to write a new AKB v13 with the entry removed.

**Why this is a critical data-integrity bug:** Atelier's value proposition is "trustworthy career representation." If users cannot remove wrong facts the system invented, the AKB becomes a permanent contamination — every subsequent run scores against and drafts against false claims. Worse, if the user submits a Drafter package containing a fabricated award, that's a real reputational and potentially legal hazard for the artist. The user MUST always be able to delete any fact, regardless of source.

**Root cause(s) likely:**
1. The `/review` form treats array-typed AKB fields as read-only when populated by ingest (only manual additions get a delete button).
2. OR the delete button exists but the underlying `mergeAkbPartial` (RFC-7396 alternative) has an append-only semantic that ignores deletions.
3. OR deletes are sent to the API but the route writes a new AKB version that re-merges from the prior ingested data, restoring the deleted fact.

**Fix (real, structural — not just a delete button):**

1. **Every AKB field, regardless of source, MUST be user-editable AND user-deletable on `/review`.** Array entries get a per-entry delete control. Object fields get a clear "Remove this fact" affordance. Scalar fields get a "Clear" / set-to-null option. Source provenance (manual vs ingested vs interview) is shown as metadata but never gates editing.

2. **Manual edits override ingest forever.** When the user deletes or edits an ingested fact, the new value is recorded with `source: 'manual_override'` and a flag `user_rejected_ingest_at: timestamp`. Future re-ingests check this flag and DO NOT re-add the rejected fact (otherwise the user has to delete it forever every time auto-discover runs).

3. **Source URL untrust tracking.** When the user rejects a fact, surface the source URL (where ingest got the fabrication) and offer: "Mark this source as untrusted for future ingests?" If yes, add the URL to a `untrusted_sources` table. Auto-discover route reads this table and skips those sources.

4. **Bulk reject UI for the auto-discover-just-ingested batch.** After auto-discover runs and writes new facts, surface a per-fact "Looks wrong, remove" affordance specifically for the just-added facts (highlighted differently from existing facts). This catches Note 3-class hallucinations BEFORE they pollute the AKB long-term.

5. **AKB version-history view + revert.** The `/review` page should let the user see prior AKB versions and revert to one ("v12 had the right data, this v13 ingest broke things — revert to v12"). Versions already exist in `akb_versions` table; just need a UI affordance to read/revert. This is the safety net for when the per-fact UX above doesn't catch a bad ingest.

6. **API-level invariant:** `mergeAkbPartial` and any other merge path must respect `user_rejected_ingest_at` and `manual_override` flags. Add a unit test asserting that a rejected fact cannot be re-introduced by any merge operation.

**Acceptance:**
- John deletes any fact on `/review`, regardless of source. Saves. The fact stays gone.
- A subsequent auto-discover run does not re-introduce the deleted fact.
- A "revert to prior version" button in `/review` lets John roll back to any earlier AKB version.
- Bulk-reject affordance appears immediately after a fresh auto-discover ingest, with the just-added facts highlighted.
- Smoke test: insert AKB v1 → user deletes fact F → re-run auto-discover → assert AKB v2 does NOT contain F.

**File(s):** `app/(onboarding)/review/page.tsx` (UI), `lib/db/queries/akb.ts` (merge semantics), `lib/agents/knowledge-extractor.ts` (re-ingest must respect rejection flags), new `untrusted_sources` table + migration, new revert API route.

**Priority:** high — data integrity bug. Auto-discover is broken until Note 3 lands; until then, Note 10 is the safety valve that lets users remove the broken outputs. Should ship alongside or before Note 3.

---

## Note 11 — Anthropic transient errors (529 / 503 / 429) surface as "Failed to fetch" instead of auto-retrying

**Where:** Style Analyst (verified via Vercel runtime log — see below). Likely affects every Anthropic-call route in the app.

**Symptom:** Style Analyst on prod with 62 images returned `Analysis failed: couldn't reach server (Failed to fetch)`. Investigation via `vercel logs` revealed the actual error is upstream:

```
Error: 529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"},"request_id":"req_011CaPbsF1pLtAMHHtRyytyW"}
[style-analyst] 2/4 chunks failed; synthesizing from 2
```

The Style Analyst route is well-designed — it chunks the portfolio into parallel batches and tolerates partial failure. But when 2 of 4 chunks hit Anthropic's transient 529 AND the synthesis call also hits 529, the whole route 500s. The user sees "Failed to fetch" with no actionable signal.

**Root cause:** no retry-with-backoff on Anthropic transient errors. Anthropic explicitly publishes 529 (overloaded), 503 (service unavailable), 429 (rate-limited, with `retry-after` header) as transient — these are MEANT to be retried by the client.

**Fix (real, not patch — applied to every Anthropic call in the codebase):**

1. **Wrap every Anthropic call in a retry helper.** Single shared module `lib/anthropic/retry.ts` exports `withAnthropicRetry(fn, options?)` that:
   - Retries on `status === 529`, `status === 503`, `status === 502`, `status === 429`, and ECONNRESET / ETIMEDOUT network errors.
   - Exponential backoff: 1s, 3s, 9s, 27s — up to 4 retries.
   - Honors `retry-after` header from 429 responses (use that value if present, otherwise backoff schedule).
   - Logs every retry to `console.warn` with `[anthropic-retry] attempt N after Xs delay, last error: ...`.
   - On final failure (all retries exhausted), throws with a user-friendly message: `"Anthropic API is currently overloaded. We retried 4 times. Try again in a minute or two."` — NEVER lets the raw 529 stack trace bubble to the frontend.

2. **Audit every Anthropic SDK call site.** `getAnthropic().messages.create(...)`, `.beta.sessions.create(...)`, `.beta.files.upload(...)`, etc. Wrap each one with `withAnthropicRetry()`. Add an ESLint rule (or grep-based CI check) that fails the build if any direct `.messages.create(...)` call exists without going through the retry wrapper.

3. **For long-running parallel batched calls (Style Analyst, future batched things):** the retry wrapper applies to each individual call. PLUS: at the route level, if N-of-M batches fail after all retries, log clearly which ones failed AND surface a partial result OR a "we couldn't reach the model after retries — please try again in a moment" error that flows through `withApiErrorHandling` so the frontend gets a JSON response with a readable message, not "Failed to fetch."

4. **Add a dev/health probe for Anthropic capacity.** `/api/health` already probes Files-API. Add a probe that fires a tiny `messages.create()` call and reports latency + last-known-overload status. Lets us spot Anthropic-side weather BEFORE running expensive flows.

5. **User-visible "Anthropic is overloaded" affordance.** When the retry wrapper exhausts retries, surface a clear UI banner: "Anthropic's API is currently overloaded — this happens during peak usage. Click Retry, or wait a minute and try again. Your portfolio is saved." Already-friendly Style Analyst error message + auto-Retry button is most of the way there; just upgrade the copy and add an automatic-retry-after-delay option.

**Acceptance:**
- Style Analyst on 62 images on prod with Anthropic at peak load: succeeds (eventually) after silent retries, OR shows a clear "Anthropic overloaded — try again in a minute" message after exhausting retries. Never "Failed to fetch."
- Same behavior for every other Anthropic-call route (Knowledge Extractor, Rubric, Drafter, etc.).
- Smoke test: mock Anthropic returning 529 once then success on second call — assert the retry wrapper succeeds without bubbling the 529.

**File(s):** new `lib/anthropic/retry.ts`, every Anthropic call site (Style Analyst, Knowledge Extractor, Package Drafter, finalize-scout, recipient downloader, anywhere else), `app/api/health/route.ts` (capacity probe), `lib/api/response.ts` (error message mapping).

**Priority:** high. Anthropic 529s are common during hackathon hours (everyone hammering the same API). Without retry, we look like the system is broken when it's actually just transient upstream load. Shipping this makes Atelier resilient to peak-hour weather — which is exactly when judges will be touching it.

---
