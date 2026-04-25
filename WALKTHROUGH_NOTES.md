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

## Note 12 — Run-status events UI shows the same timestamp on every event (batched-poll timestamp, not event timestamp)

**Where:** `/runs/[id]` status page during a live run.

**Symptom:** Events stream renders many events in a row all stamped with the same time (e.g., 11 events all showing `18:51:03`) even though the underlying events fired seconds apart. Verified against the DB — the actual `run_events.created_at` values for those events ranged across 01:50:13 → 01:51:36 UTC (about 80 seconds), but the UI rendered them all as the same wall-clock time. This makes the timeline impossible to read — you can't tell whether the agent is making progress (one event per second) or stalled (one event per minute) because every event looks like it just happened.

**Root cause likely:** the polling client is using the timestamp of the POLL FETCH (when the events were pulled from `/api/runs/[id]/events`) instead of the per-event `created_at` value from each event row. So a poll that fetches 11 events at once stamps all 11 with the same fetch time.

**Fix (real, not patch):**

1. **Render each event with its own `_created_at` / `created_at`** from the event row, formatted in the user's local timezone. Do NOT use poll-fetch time.
2. **Add elapsed-since-previous-event indicator** ("+3s", "+22s", "+1m 14s") between adjacent events so the user can see actual cadence at a glance.
3. **Verify** with a smoke test that fetches an artificially-staggered set of events (created_at values at 0s, 5s, 30s) and asserts the UI renders all three distinct timestamps + correct deltas.
4. **Bonus:** when a long gap (>30s) occurs between adjacent events, render a soft "still running…" affordance so the user knows the silence isn't a freeze.

**Acceptance:** during a live run, the events feed shows a true wall-clock timestamp per event, with relative-deltas between them. A glance at the feed answers "how long ago did the last event happen" and "is the agent moving fast or slow."

**File(s):** `app/(dashboard)/runs/[id]/page.tsx` or wherever the events feed renders, the polling hook that fetches events.

**Priority:** medium. Not blocking the run, but makes the live-run UX feel broken (looks like everything happens at once) and undermines the "I can watch the agent work" demo moment.

---

## Note 15 — Full visual design system pass across every user-facing surface (SHIPPED)

**Where:** every page in the app.

**Why:** Earlier scoping was "polish dossier only," which was a bandaid — the dossier would be the polished exception and the rest of the app would drag on the demo. Real fix: every surface a judge touches gets the same level of design care.

**Scope shipped:** design system foundation (typography scale, color palette, spacing scale, shadcn primitives consistently applied), serif/sans typography pair, per-surface visual pass on landing/upload/Style Analyst result/interview/review/runs/runs/new/runs/[id]/dossier/settings/404, dossier-specific extra polish (cover page, drafted package print-style, artist statement serif body), mobile responsive on dossier, polished loading + empty states, Layer-2 internal vocabulary sweep finished.

**Status:** shipped per coder closeout. No regressions.

---

## Note 16 — Single-tenant abuse prevention: Start Run modal + IP rate limit + demo banner (SHIPPED)

**Where:** `/runs/new`, `POST /api/runs/start`, global layout banner.

**Why:** Prod URL has no friction between a visitor and triggering an Anthropic-billable run. Need light protection without building auth (Path B post-hackathon).

**Scope shipped:** Start Run confirmation modal explaining single-tenant demo + cost expectation, IP-based rate limit (1 successful run per IP per 24 hours via `rate_limits_run_start` table) returning 429 with readable JSON body, dismissable demo banner on global layout linking to GitHub repo. Did NOT build auth, per-user accounts, or BYO API key (Path B work).

**Status:** shipped per coder closeout. Verified rate limit fires + clears via `scripts/clear-rate.mjs`.

---

## Note 25 — Sample rationale prompt allows lineage name-drops in 30-word per-image notes (small)

**Where:** `generateSampleRationales()` in `lib/agents/package-drafter.ts` (Note 19 work). Surfaced in the test fixture (`tests/smoke/sample-rationales.test.ts` line 46-47).

**Symptom (test fixture, but realistic shape of model output):**

> `"roadside vernacular signals Stephen Shore lineage the panel has rewarded twice"`

A 30-word per-image rationale should be brief and specific to the image content + cohort fit. Lineage name-drops ("Stephen Shore lineage", "Adams tradition", "Lik register") add curator-essay weight to what should be a short observational note. The existing Note 19 prompt bans "marketing vocabulary" but does not ban lineage-name-drops in rationales.

**What a clean rationale looks like:**

- ✅ "deep-blue palette matches the winners' color register"
- ✅ "vertical orientation echoes the cohort's preferred crop discipline"
- ✅ "boulder repoussoir at the wide-angle near edge — the device this jury has consistently rewarded"
- ❌ "signals Stephen Shore lineage the panel has rewarded twice"
- ❌ "in the Adams tradition that informs this cohort's exposure discipline"
- ❌ "carries the Peter Lik register"

**Fix:**

Extend the `generateSampleRationales()` system prompt with one additional constraint:

> "NO LINEAGE NAME-DROPS in rationales. A per-image rationale is a brief observational note about THIS image's specific qualities and how those qualities map to the cohort's aesthetic signature — not a curator-essay sentence about lineage. Banned: any rationale that names a photographer (Adams, Lik, Rowell, Shore, Eggleston, Sugimoto, etc.) as evidence the image fits. The rationale must describe the image's PROPERTIES (palette, crop, subject, composition, condition) and how they match the cohort, not name a tradition or photographer."

Plus an extension of the existing post-write check: scan each rationale for capitalized-photographer-name patterns (single-word capitalized photographer surnames — Adams / Lik / Shore / Eggleston / Sugimoto / Frye / Butcher / Luong / Plant / Rowell / Wall / Ratcliff / Dobrowner) and flag if any appear inside a per-image rationale. Soft fail with retry.

**Acceptance:** smoke test asserts: across all generated rationales for a fixture, no rationale contains a capitalized photographer surname. Lineage discussion belongs in the artist statement, not in 30-word per-image notes.

**Files:** `lib/agents/package-drafter.ts` (rationale prompt + post-write check extension), `tests/smoke/sample-rationales.test.ts` (extend with no-lineage-name-drop assertion).

**Priority:** low — small extension to existing Note 19. Bundle with Notes 20+21+22+23+24 as part of the same Drafter polish pass.

---

## Note 24 — Drafter is HALLUCINATING facts (invented exhibitions, partnerships, dates) — needs hard AKB-only constraint

**Where:** every Drafter prompt that asks the model to write specific content (artist statement, project proposal, cover letter, work-sample rationale). Surfaced first in the Note 23 cover letter smoke test output.

**Symptom (real example from cover letter smoke test fixture):**

> "The Nevada Arts Council Fellowship would directly support my third monograph in 2026, with a confirmed exhibition at the Boulder City library in October. My founding role at FOTO has kept me close to the Nevada arts ecosystem, and my ongoing partnership with the Walker River Paiute Tribe is the most relevant credential for this fellowship."

Three invented facts in three sentences:
- "confirmed exhibition at the Boulder City library in October" — does not exist in AKB
- "ongoing partnership with the Walker River Paiute Tribe" — does not exist in AKB
- "third monograph in 2026" — AKB has the third monograph as an aspiration but no 2026 date

This is much worse than generic prose. It's the model putting FALSE CLAIMS in writing under John's name. If this lands in a real submitted application, it constitutes misrepresentation to a funding body.

**Root cause:** Notes 20, 21, 23 prompts ask the model to be SPECIFIC about why this opportunity. The model interprets the specificity demand as "include believable-sounding specific details," and fills the gap with invented partnerships, dates, exhibitions, and credentials when the AKB doesn't supply them. The existing `FINGERPRINT_CONSTRAINT` covers VISUAL claims (palette, lineage, register) but does not cover BIOGRAPHICAL claims (exhibitions, partnerships, dates, residencies, awards).

**Fix — single mandatory constraint applied to ALL Drafter prompts:**

### 24-fix.1 — Add AKB_FACTS_ONLY_CONSTRAINT block

```
HARD CONSTRAINT — BIOGRAPHICAL FACTS MUST COME FROM AKB ONLY:

Every claim you make about the artist's exhibitions, publications, awards, collections, representation, residencies, partnerships, commissions, dates, venues, project plans, monographs, or future commitments MUST be verifiable in the provided ARTIST_AKB JSON. Do NOT invent ANY of the following:
- Exhibitions not listed in akb.exhibitions
- Publications not listed in akb.publications
- Awards not listed in akb.awards_and_honors
- Gallery representation not listed in akb.representation
- Collections not listed in akb.collections
- Residencies, fellowships, or grants the artist has NOT received
- Partnerships with named organizations, tribes, councils, or institutions not in akb
- Specific future dates (e.g., "October 2026", "spring 2027 exhibition") UNLESS the AKB explicitly states them
- Confirmed exhibitions, commissions, or publications that are not actually confirmed in the AKB
- Curatorial or organizational credits beyond what's listed in akb.curatorial_and_organizational
- Press, awards, or recognitions not in the AKB

If the prompt asks you to be specific about WHY this opportunity, draw the specificity from:
- akb.bodies_of_work for project subject and scope
- akb.intent.aspirations for forward-looking commitments
- akb.intent.statement for animating principles
- akb.curatorial_and_organizational for community/civic credentials
- The opportunity's own field (geographic alignment, category fit, jury alignment) — these are derivable from the opp data, not invented

If the AKB does not contain a fact that would make a sentence specific, OMIT that sentence rather than invent the fact. A vaguer-but-true sentence beats a specific-but-false sentence every time. The drafted material will be submitted under the artist's name; false claims constitute misrepresentation to the funding body.

When you cite a specific year, venue, partnership, or commitment, the corresponding fact MUST be present in the AKB. If you find yourself writing "[venue] in [year]" or "ongoing [relationship]" or "confirmed [event]" and you cannot point to the AKB field that supports it, delete the claim.
```

### 24-fix.2 — Post-write fact-grounding check

Add a deterministic post-write check that scans the generated text for patterns that suggest invented specificity:
- Specific dates not present in AKB (regex extracts dates like "October 2026", "Spring 2027", "by 2028" → check against AKB content)
- Named venues not present in AKB (extract proper-noun phrases that look like venue names → check against akb.exhibitions venues + akb.representation galleries + known geographic places)
- Named partnerships/institutions not in AKB (extract "partnership with X" / "ongoing X" / "confirmed X" patterns → check against akb)

If the check finds an unverifiable claim, retry with the specific issue fed back ("you wrote 'confirmed exhibition at Boulder City library in October' but the AKB does not contain this — remove or replace with a true claim from the AKB").

This is harder than the regex-based em-dash check because it requires entity extraction. Acceptable approximations:
- Year-range regex: extract `\b(20\d{2})\b` from generated text, assert each year is either "today's year" or appears in the AKB JSON string
- Quoted-phrase check: extract phrases that look like specific commitments ("confirmed [thing]", "ongoing partnership with [name]", "[name] in [year]"), substring-check against AKB JSON

Soft-fallback: if check fails after one retry, log the warning but ship the output (better to show what we have than to crash). The constraint in 24-fix.1 should prevent most cases from reaching the check.

### 24-fix.3 — Apply to all Drafter prompts

Add the AKB_FACTS_ONLY_CONSTRAINT to:
- artist_statement system prompt (alongside FINGERPRINT_CONSTRAINT and NAME_PRIMACY_CONSTRAINT and STATEMENT_VOICE_CONSTRAINTS)
- project_proposal system prompt (alongside the same constraints + PROPOSAL_VOICE_CONSTRAINTS)
- cover_letter system prompt (alongside COVER_LETTER_VOICE_CONSTRAINTS)
- generateSampleRationales (Note 19) — rationales must also not invent claims about the images or the opportunity
- master CV (Note 22) — already structurally safe since it's just rendering AKB fields, but add the constraint as belt-and-suspenders

NOT needed for:
- generateCoverNarrative (orchestrator, already constrained)
- generateRankingNarrative (orchestrator, already constrained)
- Filtered-out blurbs (constrained to Rubric reasoning input)

### Acceptance for Note 24

- A fresh run produces no cover letter / proposal / statement containing a venue, year, partnership, or commitment that is NOT present in the AKB.
- Smoke test asserts: extract all 4-digit years 20XX from each generated material, verify each year appears in the AKB JSON string. Fail the test if any year in generated material is not in AKB.
- Smoke test asserts: scan for patterns "confirmed [X]" / "ongoing partnership with [X]" / "exhibition at [X] in [year]" — fail if the [X] phrase doesn't substring-match against the AKB JSON.
- Manual review: read 3 generated cover letters, verify every specific factual claim (venue, year, partnership, exhibition, monograph date, recognition) maps to a real AKB entry.

**Files:** `lib/agents/package-drafter.ts` (new AKB_FACTS_ONLY_CONSTRAINT block + post-write fact-grounding check + applied to all 4 material prompts), `tests/smoke/drafter-fact-grounding.test.ts` (new — covers the year-regex + entity-substring patterns).

**Priority:** highest. Hallucinated facts in submitted applications constitute misrepresentation to a funding body. This is a SAFETY issue, not a quality issue. Must ship before any real run is sent to a panel.

---

## Note 23 — Cover letters in third-person, missing salutation convention, repeated lineage + full-reel career markers

**Where:** every drafted `cover_letter` in `drafted_packages.cover_letter`.

**Honest baseline:** cover letters are in better shape than statements/proposals on em-dash count (1-3 per letter) and length (~250-270 words, correct for cover letter). Note 20's voice constraints already inherit to cover letters per the coder's closeout. But cover-letter-specific issues remain that the inherited statement rules don't address.

**Real problems:**

**23a — Third-person voice across all cover letters.** "Knopf submits...", "Knopf is a Las Vegas-based landscape photographer...", "Knopf was included in National Geographic's first NFT cohort..." Cover letters are PERSONAL CORRESPONDENCE from the artist to the panel. They must be first-person — "I submit...", "I am a Las Vegas-based...", "I was included in..." A cover letter signed at the bottom by John Knopf with body text in third person reads as ghost-written by an agent or PR firm. Biggest issue. Note 20's first-person rule is already in the inheritance chain but is being defeated for cover letters specifically — the cover letter prompt or the inherited block needs to enforce first-person on cover letters explicitly.

**23b — Wrong salutation convention.** Most cover letters open with bare "Selection Committee" (no "Dear"). One opens with the correct "Dear Selection Committee,". Standard business letter convention is "Dear [Name], / Dear [Title], / Dear Selection Committee,". Bare opening reads as memo or status update, not letter. Letter convention also typically includes a date line and the recipient's address block at the top.

**23c — Same lineage paragraph in every cover letter.** Lik / Rowell / Butcher / QT Luong / Adams roll-call appears across most letters. Note 21 banned this in proposals — same ban must extend to cover letters. Cover letters are brief personal correspondence; they shouldn't carry the lineage paragraph that the artist statement already does. The cover letter's job is "I'm applying, here's a sentence on who I am, here's why your specific opportunity, please consider my work."

**23d — Same career-marker paragraph repeated in every cover letter.** Mondoir 2025 + Venice 2022 + Art Basel 2022 + NFT cohorts + monographs appear verbatim in nearly every cover letter. Cover letters should select the 1-3 MOST RELEVANT career markers for the specific opportunity — not paste the full reel. For HIPA, Mondoir Dubai is the most relevant (geographic fit). For ILPOTY, the Mondoir solo + the named lineage influences are the most relevant (register fit). For state arts council fellowships, the FOTO founder + curator credentials would be the most relevant (community/civic). The model needs to PICK, not list everything.

**23e — No personalization to the SPECIFIC opportunity beyond a "this is the right venue" sentence.** Cover letters should address the panel/jury directly when known, name a specific reason this prize/cycle/year matches the artist's current trajectory, and reference why the artist is applying NOW (recent work, upcoming monograph, geographic fit, prior shortlist, etc.). Generic "this is the right venue for this work" is filler.

**23f — Lineage paragraph + career-marker reel + method paragraph displaces the actual cover-letter content.** A 250-word cover letter that spends 100 words on lineage + 80 words on career markers + 30 words on technique has 40 words for the actual job of a cover letter (introduction, ask, close). The structural fix is to BAN the inherited paragraphs and free up word budget for letter-specific content.

**Root cause:** the Drafter's `cover_letter` system prompt inherits Note 20's voice block (good on em-dashes, banned phrases, banned single words), but does not yet enforce cover-letter-specific structural rules: first-person enforcement, salutation convention, ban on lineage paragraph, ban on full-reel career markers, requirement of opportunity-specific content.

**Fix — single-part:**

### 23-fix.1 — Add COVER_LETTER_VOICE_CONSTRAINTS block to Drafter

Extend the Drafter's cover_letter system prompt with a cover-letter-specific block (in addition to inheriting the Note 20 STATEMENT_VOICE_CONSTRAINTS):

```
COVER LETTER STRUCTURAL RULES (in addition to the voice constraints above):

1. FIRST PERSON THROUGHOUT. Cover letters are personal correspondence from the artist to the panel. Use "I submit...", "I am a Las Vegas-based landscape photographer...", "I was included in...". NEVER "Knopf submits..." or "Knopf is..." This is the artist writing to the panel directly.

2. SALUTATION. Open with "Dear [Panel Name]," or "Dear Selection Committee," — NEVER bare "Selection Committee" without "Dear". If the panel chair or jury member is named in the opportunity record, address them by name: "Dear Dr. [Name]," or "Dear [Name],".

3. NO LINEAGE PARAGRAPH. Lineage lives in the artist statement. The cover letter is brief personal correspondence; the panel will read the statement separately. Banned: any sentence listing two or more named photographers as influences ("Adams, Rowell, Lik, Butcher..."). Banned: the phrase "lineage of" / "the work sits in" / "commercial-gallery register" / "destination-landscape tradition".

4. SELECTIVE CAREER MARKERS. Pick 1-3 career markers MOST RELEVANT to this specific opportunity. Geographic fit → name the geographic-relevant credit (Mondoir for Dubai-region opps; Las Vegas gallery program for Nevada opps). Register fit → name the lineage-aligned credits without listing them all. Community/civic relevance → name FOTO founder + curatorial credits. Do NOT paste the full reel of "Mondoir 2025 + Venice 2022 + Art Basel 2022 + NFT cohorts + monographs" in every letter.

5. SPECIFIC TO THIS OPPORTUNITY. The letter must contain at least one sentence that names a specific reason for THIS opportunity at THIS time — not "this is the right venue for this work." Examples: "I am writing in advance of the upcoming third monograph deadline because [opp] would directly support its publication", "the cohort recognized in [opp]'s last cycle includes work I have studied closely", "the [specific category] is the right home for the [specific body of work]".

6. STRUCTURE: salutation → 1 paragraph self-introduction (who I am, in 1-2 sentences) → 1 paragraph why this specific opportunity (the case for fit) → 1 paragraph the most relevant career markers (selective) → close ("Thank you for your consideration." or similar) → signature ("John Knopf" — the artist_name from AKB).

7. LENGTH 200-350 words. Brevity is generosity to the panel.

8. NO METHOD/GEAR PARAGRAPH. Technique belongs in the artist statement (where it's justified) or the project proposal (where it's load-bearing). The cover letter is correspondence, not technical documentation.

9. NO TAX/ADMIN FOOTER unless the opportunity explicitly asks for legal name + tax info in the cover letter (rare). The artist's legal name belongs in the application form's admin section, not in the cover letter body.

10. NO BANNED PHRASES from Note 20 + Note 21 ("sits in the lineage of", "commercial-gallery register", "aesthetic signature", "the medium has been preparing itself", "quiet authority", "emotional weight").

POST-WRITE CHECK:
- First-person verb in the first sentence after the salutation? (regex: `^[A-Z][a-z]+,?\n+I\b` or similar)
- Salutation includes "Dear"?
- Zero instances of "Knopf" in the body (only as signature)?
- Zero lineage-list sentences (no sentence mentions 2+ named photographers as influences)?
- Length within 200-350 words?
- One sentence specifically references this opportunity by name + a specific reason?

Same retry-with-validation pattern from Note 20's `draftStatementWithVoiceCheck`.
```

**Acceptance:**
- Every cover letter in a fresh run uses first-person voice. Smoke test asserts: zero instances of "Knopf submits" / "Knopf is" / "Knopf was" / "Knopf has" in any cover letter body.
- Every cover letter opens with "Dear" salutation.
- Zero lineage paragraphs in any cover letter (regex check).
- Career markers vary across letters per opportunity type (different opps emphasize different credits).
- Each letter contains a sentence specifically referencing this opportunity by name with a specific reason for this cycle.
- Length 200-350 words.

**Files:** `lib/agents/package-drafter.ts` (cover_letter system prompt + new COVER_LETTER_VOICE_CONSTRAINTS block + post-write check), `tests/smoke/drafter-cover-letter-voice.test.ts` (new).

**Priority:** medium — smaller than Notes 20/21 because Note 20 already covers most voice discipline. Should ship alongside the Notes 20+21+22 batch (same file, same coder pass).

---

## Note 22 — CV is mostly correct but inconsistent across opportunities + ILPOTY CV missing curatorial section + bigger architectural question

**Where:** every drafted `cv_formatted` in `drafted_packages.cv_formatted`.

**Honest baseline (this is much less broken than statements/proposals):** CVs are structurally correct — institutional reverse-chronological format, accurate content per AKB v19 (Mondoir Gallery solo 2025, John Knopf Gallery programs 2012-2017, Emmy nomination 2018, NatGeo first-cohort NFT 2023, TIME TIMEPieces 2022, FOTO founder, Mike Yamashita co-curation). Most CVs include the load-bearing CURATORIAL AND ORGANIZATIONAL section.

**Real problems (in order of severity):**

**22a — ILPOTY CV is missing the CURATORIAL AND ORGANIZATIONAL section entirely** (123 words vs 183-206 in other CVs). The model trimmed John's FOTO founder + curator credentials for ILPOTY because it decided ILPOTY is "just" a competition and curatorial work wasn't relevant. Wrong judgment — curatorial credentials strengthen ANY application. They are evidence of community standing and editorial judgment that panels read positively regardless of opportunity type.

**22b — Section names drift across CVs.** "AWARDS AND HONORS" in some, "AWARDS" in others. Same content, inconsistent labels. Should pick one canonical label per section and use it everywhere.

**22c — Minor formatting variations across CVs.** Ordering of REPRESENTATION vs CURATORIAL section differs. Em-dashes vs commas in publication entries differ. Section content is the same; presentation drifts.

**22d — Em-dash usage in CVs is acceptable here**, unlike statements/proposals. CV em-dashes are INSTITUTIONAL FIELD SEPARATORS ("National Geographic — first-cohort NFT drop"), the convention NEA, MacDowell, and Aperture all use. The Note 20/21 zero-em-dash rule is for PROSE; CVs are different. The model should still apply the rule consistently — pick one separator style (em-dash OR comma) and use it everywhere across the dossier.

**The bigger architectural problem:** every opportunity currently gets a slightly-tweaked CV. That's wrong by design. Most institutions expect a single PDF upload — they don't expect each application to have a custom-rewritten CV. Generating 10 slightly-different CVs is API tokens spent for no real benefit AND introduces the consistency drift documented in 22b/22c. The honest model: one master CV per dossier, with optional per-opp TRIM instructions ("for IPA's 2,000-character limit, drop pre-2018 entries"). Fix is 22-fix.3 below.

**Fix — three parts:**

### 22-fix.1 — ALWAYS include CURATORIAL AND ORGANIZATIONAL section (no trimming)

Update the CV system prompt to explicitly require this section in every CV, regardless of opportunity type. Curatorial work strengthens every application; the model should never trim it. If `akb.curatorial_and_organizational` is non-empty, the section MUST appear in the rendered CV.

### 22-fix.2 — Canonicalize section names + format

Hardcode the section labels and order in the CV template:

```
NAME (top, large)
b. YEAR | Lives and works in CITY, STATE, COUNTRY [single-line bio]

EDUCATION

SOLO EXHIBITIONS

GROUP EXHIBITIONS (selected)

PUBLICATIONS (selected)

AWARDS AND HONORS

COLLECTIONS

REPRESENTATION

CURATORIAL AND ORGANIZATIONAL
```

Always in this order. Always these labels. Skip a section ONLY if the corresponding AKB field is empty (no inventing labels). Within each section, use one consistent separator (recommendation: em-dash for venue/location separation since that's CV convention, comma for sub-attributes within a row).

The DEFAULT_CV_SKILL inline fallback in `package-drafter.ts` already documents this format roughly — extend it to be more prescriptive about section names + ordering, and tighten the prompt to follow it without drift.

### 22-fix.3 — Collapse to one master CV per dossier (THE REAL ARCHITECTURE)

Move CV generation OUT of the per-opportunity drafting loop. Generate ONE CV per run (in the orchestrator phase, after AKB is finalized). Store as `dossiers.master_cv` (new column). Each opportunity package references the master CV with optional per-opp NOTES (e.g., "abbreviated for IPA 2,000-char limit").

Why this is the right fix, not a "future" one:
- Eliminates the consistency-drift class of bugs (22b/22c) by design — there's only ONE CV, so it cannot drift across opps.
- Saves ~9 messages.create calls per run × ~$0.50 = ~$4.50/run cost reduction.
- Mirrors how artists actually use CVs in the real world — they have ONE CV PDF they upload to every application, not 10 custom-rewritten CVs.
- Schema change is small: one new column on `dossiers` (`master_cv TEXT`).
- Dossier UI change is small: render the master CV once at the top of the dossier instead of inside each per-opp package, with per-opp trim notes inline.

Implementation:
1. Schema migration: add `master_cv TEXT` to `dossiers` table.
2. New function `draftMasterCv(akb, fingerprint)` in `package-drafter.ts` (or a new file) that produces the canonical CV per Note 22-fix.2 format. Called once per run from the orchestrator after AKB is finalized, before per-opp drafting starts.
3. Remove `cv_formatted` generation from `draftPackageForMatch()` — that field becomes either deprecated or repurposed as a "per-opp trim note" (1-2 sentences explaining what to trim for that specific opp's char/page limit).
4. Dossier UI: render `dossiers.master_cv` once at the top of the dossier (or in a dedicated section), with each per-opp package showing the trim note instead of a duplicated CV.
5. PDF export: master CV rendered once in the appendix.

### Acceptance for Note 22 (all three sub-fixes)

- Every dossier has exactly ONE CV (master), generated once per run, stored in `dossiers.master_cv`.
- The master CV includes the CURATORIAL AND ORGANIZATIONAL section if `akb.curatorial_and_organizational` is non-empty.
- Section names match the canonical list in the canonical order.
- Each per-opp package references the master CV with an optional per-opp trim note when the opp has a stated CV length cap (e.g., Aperture's "single-page PDF" or IPA's "2,000 character" cap). When the opp has no stated cap, no trim note appears.
- Smoke test asserts: (a) `dossiers.master_cv` is non-empty after run completes, (b) `drafted_packages.cv_formatted` is null/empty (or repurposed as trim note), (c) master CV contains canonical section labels in canonical order, (d) CURATORIAL section is present when AKB has the field non-empty.

**Files:** `lib/agents/package-drafter.ts` (CV system prompt + DEFAULT_CV_SKILL fallback), `tests/smoke/drafter-cv-shape.test.ts` (new).

**Priority:** medium — much less broken than statements/proposals. Ship all three sub-fixes (22-fix.1 + 22-fix.2 + 22-fix.3 master-CV refactor) alongside Notes 20+21. The master-CV architecture change is small (one schema column + one new generation function + remove the per-opp CV call + small dossier UI update) and is the right architecture, not a "future" deferral.

---

## Note 21 — Project proposals are submission letters, not project proposals — and the wrong shape for grant/fellowship/residency types

**Where:** every drafted `project_proposal` in `drafted_packages.project_proposal`, surfaced on the dossier per opportunity.

**Symptom — audited across all 10 packages on a recent run:**

**21a — Em-dash count is brutal across most proposals.** ND Awards: **28 em-dashes**. OPOTY: 12. FAPA: 9. TIFA: 9. ILPOTY: 8. WNPA: 7. APA: 7. IPA: 7. HIPA: 6. The Note 20 zero-em-dash rule needs to extend to proposals — same LLM-prose tell, same panel response.

**21b — Third-person voice everywhere.** "Knopf submits...", "Knopf's working influences are...", "Knopf shoots on Hasselblad..." Only one proposal (FAPA) uses first-person. For grant/fellowship/residency applications, first-person is REQUIRED by panel expectation.

**21c — Identical lineage paragraph in every proposal.** Same Lik / Rowell / Butcher / QT Luong roll-call across all 10. Lineage belongs in the artist statement, not the project proposal. Repeating it across both materials in the same dossier reads as filler.

**21d — Identical method paragraph in every proposal.** Hasselblad / Phase One / Canon / ND grad / Fuji Flex / no HDR / no composites — repeated verbatim 10 times. Once across the dossier (in the artist statement) is enough.

**21e (the structural error) — Proposals don't actually PROPOSE anything.** A real project proposal answers "what would you DO with this fellowship/commission/grant." Most of these just say "I am submitting these existing images." That is a SUBMISSION LETTER, not a project proposal. For state arts council fellowships (which fund work TO BE DONE, not work already done), this is a fundamental mismatch with what panels evaluate against.

**21f — Doesn't distinguish proposal TYPE.** Different opportunities expect structurally different proposals:
- **Competition entry** (ILPOTY, OPOTY, IPA, FAPA, ND, TIFA, HIPA): portfolio submission with curatorial framing of EXISTING work
- **State arts council fellowship** (Nevada, NYSCA, NEA Visual Arts): project plan with timeline + deliverables for NEW work to be made with the fellowship
- **Residency** (MacDowell, Yaddo, regional residencies): proposal of what would be PRODUCED DURING the residency in that specific place
- **Photo book grant** (Aperture First Book, Lucie Foundation Book Prize): monograph plan with sequence, scope, page count, working title
- **Foundation grant** (Aaron Siskind, Pollock-Krasner): narrative about current work + how grant supports continued practice
- **Public art commission / RFQ**: project proposal for the specific commission's site/context

The model currently treats ALL of them as "submission package." For OPOTY (a competition) that's correct. For Nevada Arts Council Fellowship that's panel-rejection-by-the-second-paragraph.

**21g — Epson Pano proposal is TRUNCATED.** 63 words, ends mid-sentence. Hit max_tokens or some prompt issue. Coder needs to investigate alongside the rest of the fix.

**21h — Banned-phrase leakage from artist statement.** Same "the work sits in the commercial-gallery landscape lineage" phrase appears across most proposals. Same banned-phrase list from Note 20 should extend to proposals.

**Root cause:** the Drafter's `project_proposal` system prompt:
1. Doesn't load opportunity-type-specific templates
2. Doesn't distinguish competition vs grant vs residency vs book vs foundation vs commission proposal shapes
3. Defaults to a "submission package" template that fits competition entries but is wrong for everything else
4. Allows the same lineage + method paragraphs that the artist statement already contains
5. Doesn't enforce the same em-dash + first-person discipline as Note 20 will enforce on statements

**Fix — three parts:**

### 21-fix.1 — Build skills/project-proposal-real-examples.md (research-mode-agent task — IN FLIGHT)

A new skill file containing six proposal-type templates derived from real funder guidelines + winning project descriptions, plus 4-6 verbatim/paraphrased examples, 3-4 anti-examples, voice rules specific to proposals (different from artist statement rules), and type-routing logic the classifier uses.

This file is being produced by a research-mode subagent right now. Coder should NOT write this — wait for the file to land, then wire it into the Drafter prompt.

### 21-fix.2 — Rewrite the Drafter project-proposal system prompt

- Load `skills/project-proposal-real-examples.md` via the existing `readSkill()` pattern
- Extend the opportunity-type classifier from Note 20 to map to proposal-type as well: `state-fellowship | competition | residency | book-grant | foundation-grant | commission | general` (might be the same classification function reused in two places, or a separate but related one)
- Inject the type-specific template + voice guidance into the user message for each material call
- Apply the same Note 20 voice constraints: ZERO em-dashes (hard), first-person voice (with exceptions for competition entries that the template explicitly allows otherwise), banned-phrase list, no lineage paragraph (lineage lives in the statement), no method/gear paragraph repeated from the statement
- The proposal MUST include real project commitments where the type calls for it: timeline, deliverables, why-now, why-this-funder, what-will-be-produced
- Pre-write self-check using the verification checklist from the new skill file. Same retry-with-validation pattern from `callWithSchema()`

### 21-fix.3 — Per-proposal-type smoke test

Add `tests/smoke/drafter-proposal-shape.test.ts` that drafts proposals for one of each of the 6 types using the same AKB+fingerprint, then asserts:
- Each proposal contains the structural sections expected for its type (e.g., state-fellowship has a Timeline section, residency has a "what I would produce during the residency" section)
- Em-dash count is exactly zero for every proposal
- No two proposals across the 6 types share the same opening sentence (Jaccard similarity check on opening 30 words)
- No proposal contains the lineage paragraph that lives in the artist statement (regex against banned phrases like "sits in the lineage of")

### Investigation for 21g (separate, urgent)

Find why the Epson Pano proposal was truncated to 63 words. Check `package-drafter.ts` max_tokens for the project_proposal call (probably 1500 or similar; bump to 4000 like the orchestrator cover narrative fix). If max_tokens isn't the issue, check whether the prompt construction is being malformed for that specific opportunity (something in the opp data triggering an early-stop). Add a smoke test that asserts every drafted proposal ends with a complete sentence (regex on terminal punctuation `[.!?"']\s*$`).

### Acceptance for Note 21

- Read 3 generated proposals from a fresh run, one each from a competition / state-fellowship / residency type. Each is structurally distinct (different sections, different scaffolding).
- Em-dash count is ZERO across every proposal.
- First-person voice across grant/fellowship/residency proposals.
- No lineage paragraph in any proposal (lineage only appears in the artist statement).
- No method-and-gear paragraph in any proposal (method only appears in the artist statement, where it's justified).
- State-fellowship-type proposals contain a real project plan with a timeline AND deliverables for work to be DONE with the fellowship — not just "I'm submitting existing images."
- The new `skills/project-proposal-real-examples.md` is loaded at runtime by `package-drafter.ts`.
- Epson Pano (or any single-opportunity truncation) is no longer happening — every proposal ends with terminal punctuation.

**Files:** `lib/agents/package-drafter.ts` (project_proposal prompt rewrite + opportunity-type-to-proposal-type classifier extension + max_tokens bump), `skills/project-proposal-real-examples.md` (new — research subagent producing now), `tests/smoke/drafter-proposal-shape.test.ts` (new).

**Priority:** highest after Note 20. Project proposals are the load-bearing piece for grant/fellowship/residency applications (competition entries care less about the proposal because the work itself does the work). Should ship before §5.2 demo recording.

---

## Note 20 — Drafted artist statements read as third-person curatorial essays, not artist-authored text + 80% identical across opportunities

**Where:** every drafted artist_statement in `drafted_packages.artist_statement`, surfaced on the dossier per opportunity.

**Symptom — three stacked failures audited across all 10 packages on a recent run:**

**20a — Em-dash overuse is an LLM-tell.** Counts: 9, 7, 5, 7, 4, 3, 4, 5, 7, 4 em-dashes per ~360-word statement. Real artist statements use 0–2 em-dashes per ~400 words. The current rhythm (subject — descriptor — descriptor — close) reads as Claude/GPT signature punctuation. A juror who reads applications all day will recognize it instantly.

**20b — 80% identical content across opportunities.** All 10 statements share: the same opening (subject geography list), the same compositional-grammar paragraph, the same lineage paragraph (Lik / Rowell / Butcher / QT Luong), the same career-marker paragraph (Mondoir / Venice / Art Basel / NFT cohorts). Variation is mostly word order + which sentence gets emphasis. Submitting 10 near-identical statements means the artist is functionally submitting the same statement to every panel — defeats the purpose of opportunity-specific drafting.

**20c — Wrong voice entirely.** The statements are written in the third-person curatorial-essay voice ("Knopf photographs landscape on six continents — slot canyons, waterfalls in Hawaii..."), not the artist's first-person voice. Real artist statements are written by the artist about themselves, in first person OR opening with the artist's name and then transitioning to first person. The current output reads like a critic describing the work from outside the room, not the artist talking about why they make it.

Three structural problems inside 20c:
1. **Third-person posture** creates distance. Pure third-person reads as biography or critical essay.
2. **Opens with WHAT and HOW** (cameras, formats, locations) and only mentions WHY in a tossed-off sentence at the end ("The animating intent is conservationist"). Real statements lead with WHY (the question the artist is after, the stakes) and use HOW/WHAT in service.
3. **Lineage name-dropping in the artist's own voice** ("the work sits inside the commercial-gallery landscape register that runs from Peter Lik through Galen Rowell") feels defensive. Artists don't position themselves in lineages in their own statements — that's a critic's job.

**Root cause:** the Drafter system prompt currently tells the model to write "in the institution's voice" and uses the `DEFAULT_VOICE_SKILL` constant which is a generic style instruction without grounded examples. The model defaults to its training-data average artist statement, which skews academic-fine-art (Sugimoto / Crewdson / Wall / MFA-thesis voice) — wrong register for a working commercial-landscape photographer applying to state arts councils and photo prizes.

**Fix (real, structural — three parts):**

### 20-fix.1 — Build skills/artist-statement-real-examples.md (research-mode-agent task — IN FLIGHT)

A new skill file containing 5–7 REAL artist statements pulled from working landscape/commercial-gallery photographers who have actually won state arts council fellowships, regional photography prizes, or place in juried competitions, plus 3–4 anti-examples (third-person, em-dash-heavy, lineage-defensive statements that demonstrate what NOT to write). Plus distilled voice rules and per-opportunity-type tailoring guidance. Loaded into the Drafter's system prompt as ground-truth few-shot.

This file is being produced by a research-mode subagent right now. Coder should NOT write this — wait for the file to land, then wire it into the Drafter prompt.

### 20-fix.2 — Rewrite the Drafter artist-statement system prompt

Replace the current voice instruction with:
- A reference to skills/artist-statement-real-examples.md (loaded inline at runtime)
- Explicit voice constraints derived from the skill file's "Voice rules distilled" section, including:
  - First-person voice (or open with artist name then transition to first-person)
  - Open with the artist's animating question or stake — NEVER with cameras/formats/locations
  - Maximum 1 em-dash per 200 words (hard cap)
  - Banned phrases: "sits in the lineage of", "commercial-gallery register", "aesthetic signature", "working grammar", "the work is built around", any other curator-essay phrasing surfaced in the skill file's anti-examples
  - Technical details (cameras, prints, ND filters, Zone System) must be justified by what they enable artistically, never listed as bare facts
  - Lineage name-drops limited to 1–2 names total, only if they're animating influences (not positioning markers)
- A pre-write self-check: the model writes the statement, then re-reads it against the constraints, and if any are violated, rewrites. This is built into the prompt via the schema-validation retry pattern already used in `callWithSchema()`.

### 20-fix.3 — Per-opportunity differentiation

The current Drafter prompt receives the opportunity name + URL + AKB + fingerprint + Rubric reasoning. Add to the user message:
- The opportunity TYPE classification (state-fellowship / landscape-prize / photo-book / museum-acquisition / general-prize) — derived from `opp.award.type` + `opp.award.prestige_tier` + opportunity name pattern matching
- Tailoring guidance specific to that type, pulled from the skill file's "Per-opportunity tailoring" section
- A constraint at the end: "This statement MUST differ meaningfully from a statement written for a different opportunity type. If you find yourself writing the same opening / structure / closing as you would for any other opportunity, restructure."

Acceptance test: smoke test that drafts a statement for a state-fellowship and a statement for a landscape-prize using the same AKB + fingerprint, then asserts:
- Token-overlap (Jaccard similarity on word-bag) below 0.55 between the two statements
- Em-dash count ≤ ceil(word_count / 200) per statement
- Statement opens with a sentence that does NOT mention any of: a camera brand, a print format, a country, a location list

### Acceptance for Note 20

- Read 3 generated statements from a fresh run. Each is meaningfully different (different opening sentences, different structural arc, different emphasis).
- Em-dash count ≤ 2 per statement.
- First-person voice OR transitions to first-person within the first paragraph.
- Statement opens with stakes/question, not technical inventory.
- A working artist who is not John can read one of the statements and not be sure it was AI-generated (the opposite of the current output, which is obvious within 30 seconds).
- The new `skills/artist-statement-real-examples.md` is loaded at runtime by `package-drafter.ts` (same `readSkill()` pattern used for the existing skills).

**Files:** `lib/agents/package-drafter.ts` (prompt rewrite + skill loader for new file + opportunity-type classifier), `skills/artist-statement-real-examples.md` (new — research subagent producing now), `tests/smoke/drafter-statement-voice.test.ts` (new).

**Priority:** highest. The artist statement is the load-bearing piece of any application — judges read it first. Currently the statements are obviously AI-generated. This must ship before §5.2 demo recording.

---

## Note 19 — Work sample selection is identical across opportunities + rationale is placeholder text

**Where:** dossier work-sample section per drafted package. Both bugs are in the Drafter's work_sample_selection logic (`lib/agents/package-drafter.ts:185-231`).

**Symptom — two stacked bugs:**

**19a:** Across 10 drafted packages on a recent run, 8 of 10 opportunities show the EXACT same 12 portfolio image IDs `[1,6,11,16,21,29,41,2,15,31,48,66]`. Different opportunities should value different images — what Hamdan International Photography Award wants to see is not what Outdoor Photographer of the Year wants to see. The lack of variation is a tell that the system is generating opportunity-agnostic samples.

**19b:** Every single sample across every opportunity has the exact same rationale string: `"cited as supporting the institution's aesthetic signature in the Rubric Matcher's reasoning"` — a hardcoded placeholder, not model-generated per-image-per-opp reasoning. The user gets no insight into WHY each specific image was chosen for THIS specific opportunity.

**Root causes:**

**For 19a (cascading from upstream):** Rubric returns `supporting_image_ids` per match. When Rubric can see the cohort images (Files API mount working), it picks images that match THAT cohort's aesthetic signature → opportunity-specific selection. When Rubric is BLIND (no cohort images), it can only judge against the StyleFingerprint description, which is the same for every opportunity → same supporting_ids everywhere. The blindness was caused by Note-18-era Scout returning homepage URLs instead of direct image URLs, fixed in commit a2eca7e (Scout prompt + server-side filter requiring direct image URLs). The 19a symptom should self-resolve on the next run with the Scout fix in place.

**For 19b (independent bug):** `lib/agents/package-drafter.ts:204` and 222 hardcode the rationale string. The Drafter never asks the model for per-image rationale. It takes Rubric's `supporting_image_ids` array and stamps the same placeholder text on each. No LLM call, no reasoning, no per-opportunity context.

**Fix:**

**19a verification:** after the Scout fix lands and a new run completes, re-query `run_matches.supporting_image_ids` per opportunity. Different opportunities should now show different image_id lists. If they still show identical lists, dig deeper — Rubric prompt may also need work to force per-cohort discrimination.

**19b real fix:** add a per-opportunity LLM call that generates per-image rationale. Spec:

1. After `selectWorkSamples()` returns the 12 images for an opportunity, fire a single `messages.create` call with:
   - System: "You are writing one-sentence rationales explaining why each portfolio image fits a specific institutional opportunity. Reference the Rubric Matcher's reasoning paragraph. Voice: terse, specific, no marketing language. One sentence per image. Output JSON array of `{image_id: number, rationale: string}` matching the input image_ids."
   - User: "OPPORTUNITY: {opp.name}. RUBRIC REASONING: {row.reasoning}. IMAGES TO RATIONALIZE: {array of {image_id, filename, exif_subject_if_known}}. Write one rationale per image."
2. Parse the response, attach rationale to the WorkSample objects before persisting.
3. Wrap with `withAnthropicRetry`. ~$0.30-0.60 per dossier (12 images × ~150 tokens × ~10 opps × Opus 4.7 pricing).
4. Adaptive thinking on for this call — short reasoning helps.

**Acceptance:**
- Different opportunities show different supporting_image_id sets in DB (verifies 19a).
- Every drafted sample has a unique, opportunity-specific 1-sentence rationale grounded in the Rubric reasoning. No two sample rationales are identical across the dossier.
- Smoke test that calls the new per-image-rationale generator with a fixture and asserts the output contains all input image_ids with non-empty distinct rationales.

**Files:** `lib/agents/package-drafter.ts` (selectWorkSamples + new generateSampleRationales function + draftPackageForMatch wiring), possibly new prompt file in `skills/` documenting the rationale voice.

**Priority:** high — this is what makes the demo feel like real curation vs. a wrapper around a 12-image default. Should ship before §5.2 demo recording.

---

## Note 18 — Aggressiveness selector needs time + cost estimates per option (and Note 16 banner needs cost correction)

**Where:** `/runs/new` Aggressiveness selector (the Note 17c selector with Conservative / Standard / Wide net buttons), and the global demo banner from Note 16.

**Symptom:** the three Aggressiveness cards have no time or cost estimates, so the user has no way to know what they're choosing between. The choice feels abstract. SEPARATELY: the Note 16 demo banner currently says "Each run costs ~$3-5 in Anthropic API calls" — actual cost is $10-50 per run depending on Aggressiveness. Off by an order of magnitude.

**Per-card estimates (use these, derived from actual run-2 timing of 12 opps in ~15 min on prod):**

- **Conservative (15 opportunities)** — ~20–30 minutes, ~$10–15
- **Standard (25 opportunities)** — ~30–45 minutes, ~$20–25
- **Wide net (40 opportunities)** — ~60–90 minutes, ~$40–60

These are rough estimates — actual cost varies with opportunity complexity (how many recipients each has → how many Files API uploads), Rubric scoring depth, and Drafter material counts. Use a "~" prefix and mention "your actual time and cost may vary" in fine print under the cards.

**Fix:**

1. Each card on `/runs/new` Aggressiveness selector renders below the option name:
   - Time line: "~20–30 min" (or whatever range)
   - Cost line: "~$10–15 in Anthropic API costs (charged to the demo's API key)"
2. Below all three cards, a fine-print note: "Estimates based on actual run timing. Your run may finish faster or slower depending on how many recipients each opportunity has and how the model decides to pace its work."
3. **Update the Note 16 demo banner copy** from "Each run costs ~$3-5" to "Each run costs ~$10-60 in Anthropic API calls (depending on Aggressiveness setting). Please don't trigger more than one run unless you're testing something specific."
4. Also update the Note 16 Start Run modal copy to match the new cost range.

**Acceptance:** A judge looking at the Aggressiveness selector can see exactly what they're committing to before clicking Start Run. The demo banner cost claim matches reality.

**File(s):** `app/(dashboard)/runs/new/page.tsx` (Aggressiveness card render), wherever the Note 16 demo banner copy lives, wherever the Note 16 Start Run modal lives (probably also `/runs/new`).

**Priority:** medium — this is UX honesty, not a blocker. Should ship before §5.2 demo recording so the demo's first impression is calibrated.

---

## Note 17 — Dossier missing apply links + material explainers + soft opportunity cap

Three distinct dossier UX gaps surfaced together:

### 15a — No "Apply" links on opportunity cards (BUG, demo-blocking)

**Where:** `/dossier/[runId]` Top Opportunities cards.

**Symptom:** every opportunity has an authoritative URL stored in `opportunities.url` and fetched into the dossier component, but it's never rendered as a clickable link. Users can read the dossier reasoning + drafted package but cannot get from the dossier to the actual application page in one click. The whole product premise is "we tell you what to apply to" — without an apply link, users have to copy-paste the opportunity name into Google.

**Fix:** add an "Apply →" button on every opportunity card. `target="_blank"`, `rel="noopener noreferrer"`. Visually prominent — same weight as the tier label. Filtered-out opportunities also get the link (so the user can read the institution's page if they want to verify the "wrong room" call themselves).

**Acceptance:** every opportunity card on the dossier has a one-click "Apply" button linking to the real URL in a new tab. Same for filtered-outs.

### 15b — No explainers on what each drafted material IS or how to use it (UX gap)

**Where:** drafted package view per opportunity (artist statement, project proposal, CV, cover letter, work samples).

**Symptom:** the page shows four blocks of generated text labeled "Artist Statement / Project Proposal / CV / Cover Letter" with no copy explaining what each one is for, where it gets pasted in the actual application, or how the user is meant to use it. A non-academic user (the prototypical artist) does not know that the artist statement goes in the "Statement of Practice" form field, that the CV goes as an attached PDF, that the cover letter goes in a separate field on most applications, etc.

**Fix:** above each material block, render a short explainer (1–2 sentences) covering:
- **Artist Statement**: "Used to describe your practice in your own voice. Most applications ask for 250–500 words. Paste into the 'Statement of Practice' or 'Artist Statement' field. This draft is grounded in your StyleFingerprint and AKB — edit to taste before submitting."
- **Project Proposal**: "Used when the opportunity asks 'what would you do with this funding/residency.' Paste into the 'Project Description' or 'Proposal' field. Edit the dates/locations to match what you can actually commit to."
- **CV**: "Used as your formal exhibition + publication record. Most applications either accept this as a paste OR ask for a PDF upload — use the Download .docx button below for that. Already formatted to the institution's expected style."
- **Cover Letter**: "Used as the email body or letter-style intro. Most applications either include a 'cover letter' field or expect this as the body of your submission email. Lead with this."
- **Work Samples**: "These are the portfolio images Atelier suggests submitting for THIS opportunity, with the per-image rationale. Most applications limit to 10–20 images — these are the ones that best fit this institution's working rubric."

Plus a one-liner above the whole package: "These drafts are starting points. Edit before submitting — your voice matters. Atelier's job is to remove the writing wall, not write under your name."

**Acceptance:** a non-technical artist opens a drafted package and immediately understands what each block is for, where to paste it, and that they're expected to edit before sending.

### 15c — Hard-soft cap of 12–20 opportunities is invisible + low (consider raising)

**Where:** `lib/agents/opportunity-scout.ts:126` — Scout's system prompt instructs "12–20 distinct opportunities total."

**Symptom:** Scout has been returning ~12 every run because the prompt presents 12 as the floor of an acceptable range. For a 20-year-career artist with curatorial credentials and international representation, 12 opportunities is thin. Real working artists can manage 30–50 opportunities in a 6-month application window if the targeting is good.

**Fix:**
1. Bump the prompt range to "20–30 distinct opportunities total" (could go higher but Scout's web_search + persist budget caps practical throughput).
2. Make the range USER-CONFIGURABLE via the `/runs/new` preflight panel — add a "Aggressiveness" selector (Conservative: 15 opps / Standard: 25 / Wide net: 40) that maps to a `target_opportunity_count` in `runs.config_json`. Scout's prompt reads it dynamically.
3. The dossier UI already has Note 14's sort toggle, so increased volume doesn't drown the user — they can always sort by Best fit and ignore the long tail.

**Acceptance:** default fresh run produces 20–30 opportunities. User can opt for fewer or more via the preflight panel. No hard code limit anywhere — the cap is the agent's prompt-level instruction, configurable by the user.

---

**Priority:** 15a is demo-blocking (no apply links is product malpractice for an opportunity-finder product). 15b is high — without explainers the dossier reads as unfinished. 15c is medium — the current 12 is workable for the demo but should ship before any real user uses the product.

**Files:** `app/(dashboard)/dossier/[runId]/page.tsx` and child components for 15a + 15b. `lib/agents/opportunity-scout.ts` (prompt) + `app/(dashboard)/runs/new/page.tsx` + `lib/schemas/run-config.ts` (or wherever config lives) for 15c.

---

## Note 13 — UI-language simplification mandate: drop internal scores + technical jargon from user-facing surfaces

**Where:** dossier opportunity list (primary trigger — verified on `/dossier/2`), and across the app generally.

**Symptom on dossier specifically:** the "Top opportunities" panel renders raw `composite_score` (0.36) and `fit` (0.78) numbers next to each opportunity, plus the heading reads "ordered by composite score." Most users do not know what composite score means. The numerical precision suggests false rigor (why 0.36 not 0.40?) and adds cognitive load without informational value. Users want to know: "Apply to these, and here's why" — the rank order alone communicates "this one first."

**Broader pattern:** the UI throughout the app leaks internal vocabulary that means nothing to a working visual artist. Confirmed offenders so far:
- "composite score" / "fit score" / numerical scores in user-facing surfaces
- "ingest" / "ingested" (vs "imported" or "added")
- "AKB version" / "v15" (vs "Knowledge Base — last updated 2 hours ago")
- "akb_patch" / "manual override" / "source provenance" (any field surfacing the merge semantics)
- "Rubric Matcher" / "Style Analyst" / "Knowledge Extractor" as agent names visible to user (internal architecture vocabulary; user-facing should describe what they DO, not their codenames)
- "fit_score", "composite_score", "filtered_out_blurb" — DB column names leaking into UI
- Any DB id, version number, or path that has no user meaning

**Why this matters for the demo + the product:** Atelier's promise is being a TRUSTED art director for a working artist. An art director doesn't say "your composite_score for this grant is 0.36." They say "this is your strongest fit — your landscape work clearly matches what they've been awarding." The product breaks character every time internal vocabulary surfaces.

**Fix (real, not patch — two layers):**

### Layer 1 — Dossier opportunity list (immediate, demo-critical)

1. **Remove `composite_score` and `fit_score` numbers from the dossier card view.** Keep both in the DB for sorting + debugging.
2. **Replace with a short qualitative tier label.** Map `composite_score` (or `fit_score`) ranges to natural-language tiers. Suggested mapping:
   - ≥ 0.65 → "Strong fit"
   - 0.45 – 0.65 → "Solid fit"
   - 0.25 – 0.45 (still included) → "Worth applying"
   - Filtered-out tier (separate section) → "Wrong room — see why"
   The tier label can be color-coded (existing yellow/red palette is fine, but the meaning shifts from "this number" to "this category").
3. **Add a "Why this fit?" disclosure per opportunity** that expands the Rubric's `reasoning` paragraph. The reasoning is the gold — surface it directly. Default collapsed; one click to read.
4. **Replace "ordered by composite score" caption** with "Ranked by best fit for your work" or similar.
5. **For filtered-out opportunities:** show them in a separate "We considered these but they're not your room" section with the Rubric's `filtered_out_blurb` as the explanation — this is where Atelier earns trust by explaining the no, not just listing the yes.

### Layer 2 — App-wide vocabulary sweep (right after Layer 1)

1. **Build a `lib/ui/copy.ts` constants file** that holds every user-facing string. No more inline strings in components. Centralizing makes the next sweep trivial.
2. **Audit every component under `app/` and `components/` for internal vocabulary.** Specifically grep for: `score`, `composite`, `fit`, `AKB`, `ingest`, `extract`, `patch`, `merge`, `provenance`, `Rubric`, `Scout`, `Style Analyst`, `Knowledge Extractor`, `Drafter`, `_id`, `version`, `null`, `undefined`. Each hit gets a translation:
   - "Style Analyst" → "Atelier (the eye)" or just "the analysis"
   - "Knowledge Extractor / Rubric Matcher / Scout" → describe what's happening, not the agent name ("we're searching for opportunities", "we're matching your work to current open calls", "we're drafting your application materials")
   - "AKB" → "Knowledge Base" (already largely fixed in Note 6 per coder report; verify completeness)
   - "ingest" → "import" / "add"
   - "version" → "last updated [time]"
3. **Add a CI grep guard** that fails the build if any of the banned internal terms appears in `app/**` or `components/**` outside the new `lib/ui/copy.ts` constants file. Permanent.

### Layer 3 — Numerical precision discipline

For ANY number we DO show users (deadline, prize, fee), audit precision:
- Money: round to nearest dollar; never show `$1370` for prize when source data probably says "$1,000-$2,000 range" — show range when known, round number when not.
- Dates: human-friendly ("June 30, 2026" or "in 8 weeks") instead of `2026-06-30`.
- Anything else: if the precision feels false, drop it.

**Acceptance:**
- Open `/dossier/2` (or any dossier). The top opportunities list shows tier labels (e.g., "Strong fit"), not numerical scores. Each opportunity has a "Why this fit?" disclosure that expands the Rubric reasoning.
- Filtered-out opportunities live in a clearly-labeled separate section with the filtered_out_blurb as explanation.
- Grep across `app/` + `components/` finds zero hits for "composite_score", "fit_score", "AKB", "ingest" (etc.) outside `lib/ui/copy.ts`.
- A non-technical user can read the dossier and understand which opportunities to apply to and why, without ever encountering a number that needs context.

**File(s):** dossier components (`app/(dashboard)/dossier/[runId]/page.tsx` or similar), new `lib/ui/copy.ts`, all components under `app/` and `components/` for the sweep, new CI grep check.

**Priority:** high — this is what makes the demo feel like a polished product vs. an internal tool. Should ship before §5.2 demo recording.

---

## Note 14 — "Deadline Timeline" is decorative, not informational — replace with sorted deadline list

**Where:** dossier page (`/dossier/[runId]`) — the "DEADLINE TIMELINE" panel that renders dots on a horizontal line with "today" and "+6 mo" labels.

**Symptom:** the panel shows 4 dots positioned along a 6-month horizontal axis. No labels per dot. No dates per dot. No opportunity names. The user can SEE that there are 4 deadlines spread across 6 months — but cannot tell which dot represents which opportunity, or what the actual date is for any of them. Visualization without information.

**Root cause:** the timeline was designed as a glanceable shape but the implementation strips all the context that would make the shape meaningful. A timeline that doesn't label its points is decoration, not data.

**Fix (real, not patch — delete the timeline, add sort toggle to existing list):**

Updated thinking: the Top Opportunities list ALREADY shows the deadline for each one. The timeline is duplicating data already visible — and doing it worse. Don't build a second list; fix the one that exists.

1. **Delete the Deadline Timeline panel entirely.** It's redundant decoration.
2. **Add a sort toggle to the existing Top Opportunities list:** "Sort by: Best fit | Deadline | Prize amount". Default = Best fit (current behavior). User clicks Deadline → list re-sorts ascending. Single source of truth, user can pivot however they want.
3. Apply Note 13's date discipline to the deadline field: humanize ("Jun 30, 2026 — 9 weeks") instead of `deadline: 2026-06-30`.

**Acceptance:**
- The Deadline Timeline panel is gone from the dossier.
- The Top Opportunities list has a sort selector. Toggling between Best fit / Deadline / Prize re-sorts the list.
- Deadline field on each card reads as a human date with time-until ("Jun 30, 2026 — 9 weeks"), not ISO format.
- A user can answer "what do I need to apply to first" by clicking Sort by Deadline. No second component needed.

**File(s):** dossier page component (delete timeline, add sort toggle), opp-list component, possibly a small client-side state for the sort selection.

**Priority:** high — bundled with Note 13, ships before §5.2 demo recording.

---
