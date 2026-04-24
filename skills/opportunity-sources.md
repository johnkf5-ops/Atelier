# opportunity-sources

WHEN TO USE: Loaded into the Opportunity Scout agent's system prompt. Each entry is a single, machine-readable YAML block describing a source — its URL, type, eligibility shape, deadline pattern, and (for past-recipient lookup) where the Rubric Matcher should fetch prior selections. Anything marked `# TODO` is awaiting builder audit; do not treat unverified fields as ground truth.

## Federal + private foundation grants

```yaml
- id: grants-gov
  name: Grants.gov
  url: https://www.grants.gov/
  type: aggregator
  category: [grant]
  past_recipients_url: null              # not centralized; per-program
  eligibility_summary: federal eligibility varies per program
  deadline_pattern: rolling
  access_notes: free public listings; opportunity API available
  signal_quality: mid

- id: nea
  name: National Endowment for the Arts
  url: https://www.arts.gov/grants
  type: grant-program
  category: [grant]
  past_recipients_url: https://www.arts.gov/grants/recent-grants     # TODO verify
  eligibility_summary: US citizens / permanent residents; nonprofit pass-through for individuals via Creative Writing & Translation fellowships only
  deadline_pattern: 1-2x/year per program
  access_notes: program-specific guidelines; free
  signal_quality: flagship

- id: creative-capital
  name: Creative Capital
  url: https://creative-capital.org/
  type: grant-program
  category: [grant]
  past_recipients_url: https://creative-capital.org/our-artists/     # TODO verify
  eligibility_summary: US-based artists; project-based
  deadline_pattern: 1x/year (open call usually spring)
  access_notes: deeply curated; small awards but flagship prestige
  signal_quality: flagship

- id: guggenheim-fellowship
  name: Guggenheim Fellowship
  url: https://www.gf.org/
  type: grant-program
  category: [grant]
  past_recipients_url: https://www.gf.org/fellows/                   # TODO verify
  eligibility_summary: mid-career US/Canada/Latin America/Caribbean artists
  deadline_pattern: 1x/year (Sep deadline)
  access_notes: fellows page is searchable, paginated
  signal_quality: flagship

- id: pollock-krasner
  name: Pollock-Krasner Foundation
  url: https://pkf.org/
  type: grant-program
  category: [grant]
  past_recipients_url: null              # # TODO research
  eligibility_summary: visual artists with financial need
  deadline_pattern: rolling
  access_notes: smaller awards; emergency + project funding
  signal_quality: major

- id: joan-mitchell
  name: Joan Mitchell Foundation
  url: https://www.joanmitchellfoundation.org/
  type: grant-program
  category: [grant]
  past_recipients_url: https://www.joanmitchellfoundation.org/grant-program-recipients     # TODO verify
  eligibility_summary: US painters + sculptors; varies by program
  deadline_pattern: 1x/year per program
  access_notes: mid-career focus
  signal_quality: major

- id: united-states-artists
  name: United States Artists Fellows
  url: https://www.unitedstatesartists.org/
  type: grant-program
  category: [grant]
  past_recipients_url: https://www.unitedstatesartists.org/fellows/  # TODO verify
  eligibility_summary: nominated only; US-based across disciplines
  deadline_pattern: 1x/year
  access_notes: nomination-based, but recipients are public
  signal_quality: major

- id: anonymous-was-a-woman
  name: Anonymous Was A Woman
  url: https://www.anonymouswasawoman.org/
  type: grant-program
  category: [grant]
  past_recipients_url: https://www.anonymouswasawoman.org/awardees   # TODO verify
  eligibility_summary: women-identifying artists 40+ at critical career juncture
  deadline_pattern: 1x/year
  access_notes: nomination-based; recipients public
  signal_quality: major

- id: ruth-arts
  name: Ruth Foundation for the Arts
  url: https://ruth.foundation/
  type: grant-program
  category: [grant]
  past_recipients_url: null              # # TODO research
  eligibility_summary: artist-nominated grant model
  deadline_pattern: rolling cohorts
  access_notes: newer foundation; check current cycle
  signal_quality: mid
```

## State arts councils (seed — expandable)

```yaml
- id: california-arts-council
  name: California Arts Council
  url: https://arts.ca.gov/
  type: state-arts-council
  category: [grant]
  past_recipients_url: null              # TODO research
  eligibility_summary: CA residents
  deadline_pattern: 1-2x/year per program
  access_notes: focuses on individual artist fellowships + org grants
  signal_quality: regional

- id: nysca
  name: New York State Council on the Arts
  url: https://arts.ny.gov/
  type: state-arts-council
  category: [grant]
  past_recipients_url: null              # TODO research
  eligibility_summary: NY residents; many programs route through fiscal sponsors
  deadline_pattern: 1x/year per program
  access_notes: large catalogue of programs
  signal_quality: regional

- id: msab
  name: Minnesota State Arts Board
  url: https://www.arts.state.mn.us/
  type: state-arts-council
  category: [grant]
  past_recipients_url: null              # TODO research
  eligibility_summary: MN residents
  deadline_pattern: annual fellowships + project grants
  access_notes: artist initiative grants are well-funded for state
  signal_quality: regional

- id: tcoa
  name: Texas Commission on the Arts
  url: https://www.arts.texas.gov/
  type: state-arts-council
  category: [grant]
  past_recipients_url: null
  eligibility_summary: TX residents
  deadline_pattern: annual
  access_notes: smaller individual artist programs
  signal_quality: regional

- id: illinois-arts-council
  name: Illinois Arts Council Agency
  url: https://arts.illinois.gov/
  type: state-arts-council
  category: [grant]
  past_recipients_url: null
  eligibility_summary: IL residents
  deadline_pattern: annual
  access_notes: artist fellowships + Individual Artist Support
  signal_quality: regional
```

## Residencies

```yaml
- id: macdowell
  name: MacDowell
  url: https://www.macdowell.org/
  type: residency
  category: [residency]
  past_recipients_url: https://www.macdowell.org/artists
  eligibility_summary: working artists across disciplines; US + international
  deadline_pattern: 2x/year (Apr, Sep)
  access_notes: artist directory is paginated; bios link to artist sites
  signal_quality: flagship

- id: yaddo
  name: Yaddo
  url: https://www.yaddo.org/
  type: residency
  category: [residency]
  past_recipients_url: https://www.yaddo.org/artists/                # TODO verify
  eligibility_summary: working artists across disciplines
  deadline_pattern: 2x/year (Jan, Aug)
  access_notes: highly competitive
  signal_quality: flagship

- id: skowhegan
  name: Skowhegan School of Painting & Sculpture
  url: https://www.skowheganart.org/
  type: residency
  category: [residency]
  past_recipients_url: https://www.skowheganart.org/skowhegan-alumni # TODO verify
  eligibility_summary: emerging visual artists; summer program
  deadline_pattern: 1x/year (Feb)
  access_notes: summer-only; transformative for early-career
  signal_quality: flagship

- id: ucross
  name: Ucross Foundation
  url: https://www.ucrossfoundation.org/
  type: residency
  category: [residency]
  past_recipients_url: null              # TODO research
  eligibility_summary: visual artists, writers, composers
  deadline_pattern: 2x/year
  access_notes: rural Wyoming; 2-6 week stays
  signal_quality: major

- id: djerassi
  name: Djerassi Resident Artists Program
  url: https://djerassi.org/
  type: residency
  category: [residency]
  past_recipients_url: null              # TODO research
  eligibility_summary: visual + literary + media + performing arts
  deadline_pattern: 1x/year (Mar)
  access_notes: northern California; 4-5 week residencies
  signal_quality: major

- id: headlands
  name: Headlands Center for the Arts
  url: https://www.headlands.org/
  type: residency
  category: [residency]
  past_recipients_url: null              # TODO research
  eligibility_summary: artist-in-residence + Bay Area-specific tracks
  deadline_pattern: 1x/year (Jun)
  access_notes: Marin Headlands; multiple program types
  signal_quality: major

- id: hambidge
  name: The Hambidge Center
  url: https://www.hambidge.org/
  type: residency
  category: [residency]
  past_recipients_url: null
  eligibility_summary: cross-disciplinary
  deadline_pattern: rolling tri-annual
  access_notes: northern Georgia; 2-week residencies
  signal_quality: mid

- id: vcca
  name: Virginia Center for the Creative Arts
  url: https://www.vcca.com/
  type: residency
  category: [residency]
  past_recipients_url: null
  eligibility_summary: visual + literary + composers
  deadline_pattern: 3x/year
  access_notes: largest residency in US by capacity
  signal_quality: major

- id: vermont-studio-center
  name: Vermont Studio Center
  url: https://vermontstudiocenter.org/
  type: residency
  category: [residency]
  past_recipients_url: null
  eligibility_summary: visual + literary
  deadline_pattern: 3x/year
  access_notes: paid residencies + fellowships available
  signal_quality: major

- id: resartis
  name: Res Artis
  url: https://resartis.org/
  type: aggregator
  category: [residency]
  past_recipients_url: null
  eligibility_summary: varies per residency
  deadline_pattern: continuous
  access_notes: international residency directory; per-residency drill-down
  signal_quality: high

- id: alliance-artists-communities
  name: Alliance of Artists Communities
  url: https://artistcommunities.org/
  type: aggregator
  category: [residency]
  past_recipients_url: null
  eligibility_summary: varies
  deadline_pattern: continuous
  access_notes: US residency directory + advocacy org
  signal_quality: high
```

## Competitions / awards (photography-weighted for v1)

```yaml
- id: cafe
  name: CallForEntry.org (CaFE)
  url: https://www.callforentry.org/
  type: aggregator
  category: [competition, residency]
  past_recipients_url: null              # CaFE aggregates; recipients live per call
  eligibility_summary: varies-per-call
  deadline_pattern: rolling
  access_notes: free public listings; structured HTML scrape feasible
  signal_quality: high

- id: critical-mass
  name: Critical Mass (Photolucida)
  url: https://www.photolucida.org/critical-mass/
  type: competition
  category: [competition]
  past_recipients_url: https://www.photolucida.org/critical-mass-top-50/   # TODO verify
  eligibility_summary: photographers worldwide
  deadline_pattern: 1x/year (Aug)
  access_notes: Top 50 + monograph awards; jurored by curators/editors
  signal_quality: flagship

- id: aperture-portfolio-prize
  name: Aperture Portfolio Prize
  url: https://aperture.org/portfolio-prize/                        # TODO verify
  type: competition
  category: [competition]
  past_recipients_url: null              # TODO research
  eligibility_summary: photographers; emerging-mid
  deadline_pattern: 1x/year
  access_notes: Aperture jurors; cash + Aperture publication
  signal_quality: major

- id: hasselblad-masters
  name: Hasselblad Masters
  url: https://www.hasselblad.com/masters/
  type: competition
  category: [competition]
  past_recipients_url: https://www.hasselblad.com/masters/hasselblad-masters-2023/  # TODO verify
  eligibility_summary: photographers worldwide
  deadline_pattern: 1x/year (Sep deadline)
  access_notes: equipment + book; high-prestige in commercial-tilting photo
  signal_quality: major

- id: sony-world-photography
  name: Sony World Photography Awards
  url: https://www.worldphoto.org/sony-world-photography-awards
  type: competition
  category: [competition]
  past_recipients_url: https://www.worldphoto.org/                   # TODO verify
  eligibility_summary: photographers worldwide
  deadline_pattern: 1x/year (Jan deadline)
  access_notes: largest photo competition by volume
  signal_quality: major

- id: magnum-foundation
  name: Magnum Foundation
  url: https://www.magnumfoundation.org/
  type: grant-program
  category: [grant]
  past_recipients_url: https://www.magnumfoundation.org/grantees     # TODO verify
  eligibility_summary: documentary/social-practice photographers
  deadline_pattern: 1x/year per program
  access_notes: heavily documentary-weighted; aesthetic mismatch with formalist landscape
  signal_quality: flagship

- id: format-photographers-fund
  name: The Photographers' Fund (Format)
  url: https://www.format.com/photographers-fund                     # TODO verify
  type: competition
  category: [grant]
  past_recipients_url: null              # TODO research
  eligibility_summary: photographers; project funding
  deadline_pattern: 1x/year
  access_notes: corporate-backed but legitimate; project-based grants
  signal_quality: mid

- id: natgeo-explorer
  name: National Geographic Society Explorer Grants
  url: https://www.nationalgeographic.org/society/grants-and-investments/
  type: grant-program
  category: [grant]
  past_recipients_url: https://explorers.nationalgeographic.org/directory  # TODO verify
  eligibility_summary: project-based; storytelling/conservation/exploration
  deadline_pattern: 3x/year
  access_notes: project must align with NGS mission pillars
  signal_quality: flagship

- id: artdeadline
  name: ArtDeadline.com
  url: https://artdeadline.com/
  type: aggregator
  category: [competition, residency, grant]
  past_recipients_url: null
  eligibility_summary: varies per call
  deadline_pattern: continuous
  access_notes: deep aggregator with paid + free tiers
  signal_quality: mid

- id: photocontestinsider
  name: Photo Contest Insider
  url: https://www.photocontestinsider.com/
  type: aggregator
  category: [competition]
  past_recipients_url: null
  eligibility_summary: varies per call
  deadline_pattern: continuous
  access_notes: photo-only aggregator
  signal_quality: mid
```

## Public art / commissions

```yaml
- id: codaworx
  name: CODAworx
  url: https://www.codaworx.com/
  type: aggregator
  category: [commission]
  past_recipients_url: null
  eligibility_summary: project-based commissions; varies
  deadline_pattern: continuous
  access_notes: commissioned-art project marketplace + RFPs
  signal_quality: high

- id: public-art-network
  name: Public Art Network (Americans for the Arts)
  url: https://www.americansforthearts.org/by-program/networks-and-councils/public-art-network
  type: aggregator
  category: [commission]
  past_recipients_url: null
  eligibility_summary: municipal + civic commissions
  deadline_pattern: continuous
  access_notes: directory + advocacy; per-municipality drill-down
  signal_quality: high
```

## Gallery open calls (placeholder)

The spec calls for ~20 mid-to-top-tier galleries with public open submissions, derived from the builder's lived knowledge. Per the provenance note, these entries will be authored by John during Phase 3.5 (Gallery Targeter buildout). Format will mirror the residency block but with `roster_url` in place of `past_recipients_url`.

```yaml
# - id: foley-gallery-nyc                # placeholder example — to be filled by builder
#   name: Foley Gallery
#   url: https://www.foleygallery.com/
#   type: gallery
#   category: [representation]
#   roster_url: https://www.foleygallery.com/artists
#   eligibility_summary: open submissions accepted; no fee
#   deadline_pattern: rolling
#   access_notes: roster page lists current represented artists with portfolio links
#   signal_quality: mid
```
