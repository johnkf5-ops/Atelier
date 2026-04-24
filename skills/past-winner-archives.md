# past-winner-archives

WHEN TO USE: Loaded into the §3.2 Opportunity Scout system prompt and referenced by the Rubric Matcher's past-recipient fetcher. For each major opportunity, this file records where the institution publishes its past-recipient list, what schema each recipient page exposes, and what scrape-gotchas to plan around. Cuts Scout's discovery time when traversing known sources — without this, every cycle re-discovers the same URL patterns by trial and error. Augments the `past_recipients_url` field in `opportunity-sources.md` with operational structural notes.

The rule from `juror-reading.md` carries through here: pull the *full* cohort, not the press-release subset. Every opportunity below has a public list; use it.

---

## 1. Guggenheim Fellowship

**Directory URL.** [gf.org/fellows](https://www.gf.org/fellows). Searchable by year, discipline, and name. Each fellow has a dedicated bio page at the pattern `gf.org/fellows/{slug}/` (e.g., `/fellows/tarrah-krajnak/`). ([Guggenheim fellows directory](https://www.gf.org/fellows))

**Pagination.** The directory is filterable but paginated; URL parameters change as you filter. Pull by discipline to get a tractable per-cycle list — Photography typically returns ~12 fellows per year.

**Per-recipient page metadata.** Name, fellowship year, discipline, institutional affiliation (if academic), bio paragraph, often-but-not-always a personal website link in the body or footer. Some entries link to gf.org's announcement post for that year ([2024 announcement](https://www.gf.org/stories/announcing-the-2024-guggenheim-fellows)) which lists every fellow inline.

**Gotchas.** No public API. Fellow pages do not expose a structured project description — only the bio paragraph. Personal-website URLs are inconsistent (some embedded, some absent); fall back to the StyleAnalyst's separate web search by name when missing. Rate-limit polite (>1 second between requests).

---

## 2. MacDowell

**Directory URL.** [macdowell.org/artists](https://www.macdowell.org/artists). Sortable by recent fellowship year. URL pattern for sorting: `/artists?sort=residentYear`. ([MacDowell Meet Our Fellows](https://www.macdowell.org/artists))

**Pagination.** Alphabetical or by-year, paginated — pages indexed as `/p2`, `/p3`, etc. (see [search results pattern](https://www.macdowell.org/search/results/p11)). Per-page count ~24 artists.

**Per-recipient page metadata.** Artist name, discipline (visual arts / literature / film / etc.), residency year(s) (an artist can be a Fellow multiple times), short bio, often a link to personal website. Project descriptions for what was made *during* the residency are sometimes included as separate `/news/artist-profiles` posts ([artist profiles index](https://www.macdowell.org/news/artist-profiles)).

**Gotchas.** ~9,500 fellows since 1907; only filter by *recent* year for Rubric Matcher work (last 3 cycles per `juror-reading.md` Heuristic H1). Disciplines listed include "Visual Art" but not "Photography" specifically — photographers are inside Visual Art, requires reading bios to filter further. No CloudFlare; standard polite scraping.

---

## 3. Creative Capital

**Directory URL.** [creative-capital.org/award/awardees/](https://creative-capital.org/award/awardees/). Filterable by discipline (visual arts, performing arts, film, literature, technology, multidisciplinary, socially engaged). ([Creative Capital awardees](https://creative-capital.org/award/awardees/))

**Per-recipient page metadata.** Artist name, award year, discipline tag, project title and short description (Creative Capital funds *projects*, not artists, so the project description is the load-bearing field). Most pages link to the artist's personal site.

**Gotchas.** Award announcement is annual but project pages stay live — don't confuse "page exists" with "currently in production." Cross-reference the year. The 2026 cohort announcement page ([Creative Capital 2026 announcement](https://creative-capital.org/press/announcing-2026-creative-capital-awards-state-of-the-art-prize-artists/)) lists all 109 artists in one document, often more efficient than walking the directory.

---

## 4. United States Artists Fellowship

**Directory URL.** Per-year landing pages — [2024 cohort](https://www.unitedstatesartists.org/programs/usa-fellowship/2024), [2025 cohort](https://www.unitedstatesartists.org/programs/usa-fellowship/2025), [2026 cohort](https://www.unitedstatesartists.org/perspectives/2026-usa-fellowship). The main program page is [unitedstatesartists.org/programs/usa-fellowship](https://www.unitedstatesartists.org/programs/usa-fellowship). 50 fellows per year across ten disciplines including Visual Art and Craft.

**Per-recipient page metadata.** Each fellow has a profile with discipline, state, short bio, and frequently a personal-site link. Cohort pages list all 50 inline with thumbnails.

**Gotchas.** URL pattern for the year-page is inconsistent (some years live under `/programs/usa-fellowship/{year}`, some under `/perspectives/{year}-usa-fellowship`). Resolve by following the link from the main program page rather than guessing the URL.

---

## 5. Joan Mitchell Foundation

**Directory URLs.** Current Fellowship: [joanmitchellfoundation.org/joan-mitchell-fellowship](https://www.joanmitchellfoundation.org/joan-mitchell-fellowship). Historical Painters & Sculptors grants (1994-2020): [supported-artists/program/painters-and-sculptors-grants](https://www.joanmitchellfoundation.org/supported-artists/program/painters-and-sculptors-grants). Per-year announcement journal posts (e.g., [2020 recipients](https://www.joanmitchellfoundation.org/journal/announcing-2020-recipients-of-painters-sculptors-grants)).

**Per-recipient page metadata.** Painters and sculptors only — disciplines explicit. Bio paragraph, fellowship year, often a project description and a link to artist site.

**Gotchas.** The 2021 program restructure — Painters & Sculptors Grant became the Joan Mitchell Fellowship — changed both the URL structure and the cohort size (down to 15/year from larger numbers). Pull both pre-2021 and post-2021 lists if scoring against the institution's longitudinal pattern.

---

## 6. Pollock-Krasner Foundation

**Directory URL.** No comprehensive public list. The foundation does not publish a recipient directory comparable to Guggenheim's. Awards are confidential to applicant.

**Workaround.** Foundation newsletters and press releases occasionally name recipients. Search press archives and recipient-self-disclosed bios ("Pollock-Krasner Foundation Grant, 2019" appears on artist CVs). The Rubric Matcher should treat Pollock-Krasner cohort signature as inferable only from artist-volunteered information, not from foundation publication. Lower confidence in cohort coherence claims accordingly.

**Gotcha.** Do not try to scrape pkf.org for a recipient list — none exists. Skip and rely on artist-CV mining for comp set construction.

---

## 7. Critical Mass (Photolucida)

**Directory URL.** [photolucida.org/critical-mass/top-50/](https://www.photolucida.org/critical-mass/top-50/). Annual Top-50 photography list since 2004; each artist links to a dedicated portfolio page. ([Photolucida Top 50](https://www.photolucida.org/critical-mass/top-50/); [Critical Mass Top 50 category index](https://www.photolucida.org/category/critical-mass-top-50/))

**Pagination.** Per-year landing page lists all 50 winners with thumbnail links to project pages. Older years use a different URL pattern: `photolucida.org/cm_winners.php?CMYear={year}&aID={artist_id}&event_id={event}` (see [2013 winners](http://www.photolucida.org/cm_winners.php?CMYear=2013&aID=5494&event_id=16)).

**Per-recipient page metadata.** Artist name, year, project title, short statement, multiple work-sample images, link to personal website. The richest per-recipient metadata of any source on this list — Photolucida built the directory for editorial use.

**Gotchas.** Top-50 ≠ Book Award winner. The annual Book Award and Solo Show Award are higher-prestige sub-categories selected from the Top 50; treat as a separate cohort when scoring. ([Critical Mass awards page](https://www.photolucida.org/critical-mass/awards/))

---

## 8. National Endowment for the Arts

**Directory URLs.** Recent grants browse: [arts.gov/grants/recent-grants](https://www.arts.gov/grants/recent-grants). Full searchable database back to 1998: [apps.nea.gov/grantsearch/](https://apps.nea.gov/grantsearch/). ([NEA Recent Grants](https://www.arts.gov/grants/recent-grants); [NEA Grant Search](https://apps.nea.gov/grantsearch/))

**Search filters.** Year, discipline (NEA's discipline taxonomy: Dance, Design, Folk & Traditional Arts, Literary Arts, Local Arts Agencies, Media Arts, Museums, Music, Musical Theater, Opera, Presenting & Multidisciplinary Works, Theater, Visual Arts), state, and free-text keyword. For artistic disciplines NEA does not list as a taxonomy term (jazz, photography), use the keyword field.

**Per-recipient page metadata.** Grant amount, year, recipient organization (NEA grants are mostly to organizations, not individuals — Individual Fellowships exist only for Literature and Jazz under current rules), project description, congressional district. Photography-only individual fellowships were discontinued after 1995; modern photographers receive NEA support via grants made to their galleries, presses, or fiscal sponsors.

**Gotchas.** NEA database is the most structured of the lot — exposes JSON-ish endpoints behind the search UI. Most NEA "recipients" are organizations; an individual artist appearing as a beneficiary requires reading the project description. Do not score "NEA recipient" the same way you'd score "Guggenheim Fellow" — the comparison is structurally different.

---

## 9. Cross-source aggregation note

When the Scout assembles a cohort signature for the Rubric Matcher, it should pull from at least three of the above sources for each medium. Single-source cohort signatures over-fit to that institution's idiosyncrasies. Three-source signatures expose the cohort overlap (the artists appearing across Guggenheim + USA + Critical Mass) which is the strongest predictor of which way the institutional rubric is currently drifting.
