# akb-disambiguation-patterns

WHEN TO USE: Loaded into the §2.12 auto-discover system prompt. The agent searches the open web for an artist's name and is routinely served pages about other people who share the name — a journalist, a musician, a deceased academic, a college student with a Behance. This file is the playbook for deciding which pages to ingest into the AKB and which to discard. The cost of the wrong call is asymmetric: a false-positive ingest pollutes every downstream prompt for the rest of the session; a false-negative miss means a smaller AKB that the interview can fill in. When in doubt, discard and flag for human confirmation.

---

## 1. The five disambiguation axes

For every candidate page the agent surfaces, score against these five before deciding whether the page is the target artist.

### 1.1 Medium mismatch

The fastest filter. If the artist's primary medium is photography and the surfaced page describes a musician, novelist, or NPR journalist of the same name, it's a different person. Confirm by reading the page's bio paragraph and the navigation labels — a personal site whose nav says "Discography" or "Books" or "Reporting" is not a photographer's site, regardless of name match.

**Hard rule.** If `akb.practice.primary_medium` is locked from the §1.5 Style Analyst pass, any page whose declared discipline does not overlap is discarded. Borderline case: the same person genuinely works across two media (photographer + filmmaker, painter + sculptor). Resolve by checking whether *either* declared medium matches; if neither does, discard.

### 1.2 Location mismatch

If the applicant's `identity.home_base.city` is Las Vegas and the surfaced gallery bio says the artist lives in Berlin, suspect a different person. Confirm by checking activity year — if the Berlin bio is dated 2008 and the artist may have moved, treat as ambiguous and flag rather than discard.

**Soft rule.** Geographic moves are common. A location mismatch alone is not disqualifying; combine with at least one other axis before discarding.

### 1.3 Era mismatch

If activity timestamps cluster in a different era than the applicant's known career window, suspect a different person. A 2024 page describing exhibitions from 1978-92 with no later activity probably belongs to a different artist (or to the target's deceased namesake). Conversely, a page documenting a current MFA student when the target is mid-career with two-decade exhibition history is a different person.

**Tells.**

- Last exhibition listed >10 years ago with no later activity → either retired, deceased, or a different person.
- "Recently graduated from [program]" when the target finished their MFA in 2008 → different person.
- Wikipedia date ranges that don't overlap the target's lifespan → different person.

### 1.4 Career-stage mismatch

If the applicant has gallery representation and a museum acquisition, and the surfaced page describes a college student with a Behance portfolio, it's a different person. Career stage is a stronger signal than name match because two artists at the same stage rarely share a name and an aesthetic; two artists at very different stages routinely share just a name.

**Tells.**

- Personal site with "available for hire / portrait sessions / book a session" copy → likely a different commercial photographer than your fine-art target.
- LinkedIn-style résumé with no exhibition section → different person, or your target maintaining a separate professional identity (rare but real, see 1.5).
- A page whose only credit is a juried local-camera-club show → not the same person as a target with Aperture publication and Yossi Milo representation.

### 1.5 Real-name vs stage-name divergence

Some artists publish under names that diverge from their legal names. The auto-discover should treat stage-names as canonical for art-context searches, and legal names as canonical only for grant-application filings.

**Worked precedents.**

- **Cindy Sherman** — born Cynthia Morris Sherman; publishes and exhibits as Cindy Sherman exclusively.
- **Mr. Brainwash** — Thierry Guetta; the only name on the gallery wall.
- **Banksy** — pseudonymous; legal name not in public record.
- **JR** — single-letter pseudonym, French.
- **Vivian Maier** — exhibited under birth name posthumously.

If the artist confirms in the §2.7 interview that their publishing name differs from their legal name, the auto-discover should run TWO passes (one per name) and merge results, deduplicating by URL. If the publishing name returns dominant traffic and the legal name returns nothing, keep both fields populated but mark publishing-name as `practice.byline_name` and legal-name as `identity.legal_name`.

---

## 2. Worked example: "John Knopf"

**The candidates a search for "John Knopf" surfaces.**

1. **John Knopf, photographer (target).** Las Vegas-based landscape photographer, two-gallery representation (Vegas + LA), NatGeo and TIME publication credits, Emmy nomination for cinematography.
2. **John Knopf, NPR journalist.** Different person; reports on regional news, no visual-art context.
3. **Knopf publishing house.** Borzoi imprint of Penguin Random House; not a person; trivial to filter out by surface form (entity is an organization).
4. **John Knopf, retired academic.** Possibly the same person as a 1990s-era CV, but likely a third party with no gallery presence.

**Disambiguation steps the agent runs.**

1. Pull the §1.5 Style Analyst output: primary medium = photography. Filter axis 1.1 immediately discards the NPR journalist and the publishing house.
2. Pull `identity.home_base.city = Las Vegas` from the partial AKB. Any candidate page whose bio places them outside the US Southwest gets soft-flagged for axis 1.2.
3. Pull the photographer's gallery-bio URLs (already in the §1.5 fingerprint pass). Cross-check that surfaced pages mention either gallery name; pages that mention neither and have no other photographic-context anchor are deprioritized.
4. Confirm the era: surfaced pages should reference exhibitions or publications dated within the last 10 years. The retired academic's pre-2000 CV is filtered on axis 1.3.
5. Output: ingest the photographer's personal site, gallery bios, NatGeo/TIME credit pages, and any interview/podcast that names the same gallery or affiliation. Flag the NPR journalist's bio in a "discarded — different person" log so the human reviewer in §2.7 can confirm.

---

## 3. The agent's required behavior

- **Always ingest URL provenance.** Every page the agent ingests gets logged with the surface form that produced it ("found via search query 'John Knopf photographer Las Vegas'"). This lets the §2.7 reviewer audit and reverse mistakes.
- **Always flag, never silently discard.** A surfaced page that fails disambiguation goes into a `discarded_candidates` array attached to the auto-discover run record, with the failing axis named. The §2.7 interview UI surfaces these for human override ("we discarded this Berlin gallery bio because location mismatched — was that wrong?").
- **Never merge across names without explicit user confirmation.** If the agent finds strong evidence that two candidate identities are the same person (publishing name + legal name), it surfaces the merge proposal to the §2.7 review step rather than executing it. Identity merges are too high-stakes for unsupervised action.
- **Stop on three confirmed pages.** Diminishing returns past about three high-confidence sources for the same fact (gallery bio + personal site + Wikipedia all confirm the home base). Additional surfacing should focus on filling AKB gaps (bodies of work, exhibition list, education) rather than re-confirming what's known.

---

## 4. Failure modes to watch for

- **Composite identity construction.** The agent stitches partial info from two same-name people into one AKB entry. Symptom: the resulting bio reads internally inconsistent (photographer in Las Vegas with a 1992 PhD in musicology). Mitigation: require every claim in the AKB to cite at least one URL, and have the §2.7 interview surface the citation when the artist confirms the field.
- **Stage-name traffic asymmetry.** Legal name returns nothing, stage name returns thousands of hits. The agent must not assume "no results" means "no public footprint" — it may mean "wrong query." Always re-run with the publishing name once it's known.
- **Posthumous-namesake confusion.** Common with traditional/historic-sounding names. A search for "Robert Adams" returns the New Topographics photographer, the Anglican bishop, the Boston-based painter — three separate Wikipedia pages. Era + medium filters resolve this almost always.
- **Non-Latin-script names.** When the artist's name is transliterated, the auto-discover should also try the native-script form (or ask for it in §2.7). Single-script searches systematically miss the non-English-language press footprint, which for many international artists is where the substantive criticism lives.
