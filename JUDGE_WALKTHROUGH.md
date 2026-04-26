# Judge Walkthrough — Atelier

If you're judging this submission and want to verify what's been built without watching the full video, this is the shortest path.

---

## Live demo

**[atelier-hazel.vercel.app](https://atelier-hazel.vercel.app)**

The deploy is single-tenant and runs on the builder's portfolio + Knowledge Base. You can't run a fresh pipeline (rate-limited per IP), but every artifact is browseable. Start at the runs list, then open the dossier — that's where the system's actual output lives.

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
