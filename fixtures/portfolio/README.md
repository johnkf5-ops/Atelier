# Portfolio fixtures

`pnpm seed:export` writes per-image JPEGs here (one per row in
`portfolio_images` for `user_id=1`). `pnpm seed:demo` reads them back to
re-seed a clean DB.

**Photos are gitignored.** Never commit copyrighted artwork. Only the
`portfolio.manifest.json` (no image bytes), `akb.json`, and
`style-fingerprint.json` files in the parent `fixtures/` directory should
be committed — and those should be anonymised before commit if they contain
real personal data.

For CI / fresh-clone smoke testing, drop a `portfolio.ci.json` manifest
that points at picsum.photos URLs as a generic non-copyrighted fallback.
