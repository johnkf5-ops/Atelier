# Judge Walkthrough — Atelier

If you're judging this submission and want to verify what's been built without watching the full video, this is the shortest path.

---

## Time-budget guide

- **60 seconds:** open [`/dossier/1`](https://atelier-hazel.vercel.app/dossier/1), scroll the full page. The Career Dossier IS the system's output.
- **5 minutes:** also click into one match's **Reasoning** tab (note the named past recipients) and read the **Filtered out** section at the bottom (the harsh-truth filtering — saying no with reasons is the differentiator).
- **15 minutes:** also skim the three source files listed below + open `WALKTHROUGH_NOTES.md` to see the engineering wrestled with undocumented platform behaviors.

---

## Live demo

**[atelier-hazel.vercel.app](https://atelier-hazel.vercel.app)**

**Read first — what you can and can't do on this deploy.** This is a single-tenant deployment running on the builder's actual portfolio (60+ landscape photographs), Style Fingerprint, and Artist Knowledge Base. The onboarding flow (portfolio upload + Style Analyst + interview) is **not resettable** — it's permanently populated with John's profile so judges can see what a fully-populated dossier looks like without burning fifteen minutes on cold-start onboarding. What you CAN do live: browse the existing run + dossier (the system's actual output), and start a fresh pipeline run if you want to see Scout + Rubric + Drafter execute end-to-end against the populated profile (~20 minutes, runs on the builder's API key, rate-limited per IP). Multi-tenant deploy with per-user accounts and BYO API key is post-hackathon scope — Atelier is intended as a free product for working photographers and the architecture is pre-wired for the multi-tenant rollout.

Start at the runs list, then open the dossier — that's where the system's actual output lives.

---

## What to look at, in order

### 1. The dossier — `/dossier/1`

This is the artifact the whole system produces. **Open it and scroll the full page.** Specifically verify:

- **Cover narrative** — three honest paragraphs about the work, the career position, and the gap between current standing and stated aspirations. Not marketing copy.
- **Top opportunities (4–6 cards)** — each with a deadline, a fit score, and a per-card reasoning paragraph. Click into one and look at the **Reasoning** tab — note that it names a specific past recipient by name (e.g., a Critical Mass cohort photographer, an Aperture Portfolio Prize winner). This is the harsh-truth scoring working: vision-grounded reasoning, not generic adjective stacking.
- **Statement / Proposal / Cover letter / Samples tabs** — the drafted application materials. Read one statement in full. First-person voice, no em-dashes, opens with stake or working principle (not gear lists), grounded in facts from the AKB. The Samples tab shows 12 portfolio images with a per-image rationale tying each to the opportunity.
- **Filtered out section** — the opportunities Atelier scored against this artist and decided NOT to recommend, with a one-sentence "Why not [program]" each. **This is the product's actual differentiator.** Most application-finder tools recommend everything; saying no with reasons is what makes the dossier useful.

### 2. The runs page — `/runs`

Lists past runs. There's only run 1 visible — earlier exploratory runs were archived to local storage to keep the demo focused on the cleanest production-shape result.

### 3. Source code — pick three files

If you want to verify depth-of-engineering claims:

- **`lib/agents/rubric-matcher.ts`** — the aesthetic-judgment-as-matching primitive. Note the per-opportunity sequential dispatch via image content blocks in `user.message` events (Notes 27–30 in `WALKTHROUGH_NOTES.md` document why this shape was the only one that worked at production scale).
- **`lib/agents/package-drafter.ts`** — the institutional-voice writing primitive with hard linters (zero em-dashes, banned-phrase list, AKB-fact-grounding check, work-sample-grounded prose).
- **`skills/aesthetic-vocabulary.md`** + **`skills/juror-reading.md`** — the two highest-leverage skill files. Both are loaded into the Style Analyst and Rubric Matcher system prompts. Worth skimming to see what photography-domain depth looks like as code.

---

## Documents in the repo

- **[`SUMMARY.md`](./SUMMARY.md)** — the hackathon writeup. Problem, what got built, how it works, what was learned, and the v1-photography-then-expand product framing.
- **[`ARCHITECTURE.md`](./ARCHITECTURE.md)** — full system architecture: six specialist agents, run lifecycle, the Managed Agents poll-pull-on-read pattern, the image-content-block multimodal pipeline.
- **[`BUILD_LOG.md`](./BUILD_LOG.md)** — commit-by-commit narrative of every shipped feature and bug fix.
- **[`WALKTHROUGH_NOTES.md`](./WALKTHROUGH_NOTES.md)** — production-walkthrough notes documenting the architectural pivots forced by behaviors not in the docs (e.g., Files API custom mount paths silently ignored, `read` tool degrading to text-only above session-resource ceilings). Worth reading if you want to see the engineering depth-and-execution that the build required.
- **[`skills/README.md`](./skills/README.md)** — catalog of the 21 skill files that codify the photography-domain knowledge moat.

---

## Things explicitly NOT shipped

In the spirit of honest scope:

- **Multi-tenant deploy.** Currently single-user-per-deploy on the builder's API key. Per-user accounts + BYO-API-key + per-user rate limits are post-hackathon scope (~1.5 days; the auth seam at `lib/auth/` is pre-wired).
- **Auto-Discover (URL ingest from public web presence).** Built and reachable in code, OFF by default. The honest finding from probes: most working fine-art photographers don't have a public web footprint deep enough for the path to be load-bearing. Stays as the fine-tune target as the user corpus grows.
- **Cross-medium support.** v1 is photography-only by design. Lane discipline is enforced in the Scout prompt. Expansion into painting / sculpture / video / international markets happens carefully, with feedback from photographer users — not in the hackathon window.

---

Built by [John Knopf](https://jknopf.com), an Emmy-nominated landscape photographer who has spent fifteen years inside the visual-arts-submission economy and never applied to a single grant because writing about his own work was the wall.
