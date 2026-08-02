# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased] - Node 22 LTS / hapi 21 modernization

Every figure below was measured against this repository, not estimated. The two companion documents carry the full
detail and are part of this release:

- [Dependency Migration Inventory](docs/MIGRATION-DEPENDENCY-INVENTORY.md) — every bump, replacement, removal and
  deliberate hold, with the exact version on both sides and a reason classified as dead, incompatible or security.
- [Preserved Quirks](docs/PRESERVED-QUIRKS.md) — every 2013-era defect and asymmetry that was deliberately carried
  forward unchanged, with the measurement that established it and the regression a well-meaning repair would have
  caused.

**No observable behavior changed.** The route table, response statuses, payload shapes, cookies, asset URLs, and
persisted formats are all unchanged, and that is verified rather than asserted — see *Parity evidence* below.

### Changed — runtime

- Node runtime pinned to 22 LTS. `package.json` gains `engines` (`node >=22.12.0 <23.0.0`, `npm >=10.0.0`), which the
  base commit did not declare at all; new `.nvmrc` (`22`) and `.npmrc` (`engine-strict=true`, `save-exact=true`).
- `Dockerfile` retargeted off its Node 16 base, and its `npm install --legacy-peer-deps` replaced with `npm ci`.
- `package-lock.json` regenerated at `lockfileVersion` 3 and committed, so installs are reproducible.

### Changed — framework

- `@hapi/hapi` 20.3.0 → 21.4.10 and `joi` 17.13.3 → 18.2.3. Validation outcomes are byte-identical: six differential
  cases produced the same verdict, detail count, error path, error type and message string on both versions, so no
  option overrides were needed.
- All **159** legacy `function (request, reply)` handlers converted to native `async (request, h)`; zero bare
  `reply(` call sites remain in `lib/` or `config/`.
- The hand-written hapi-4-to-20 compatibility layer inside `lib/util/routeParser.js` was retired. The behavior it
  carried — as opposed to the emulation it performed — moved into six focused modules: `lib/http/responseContract.js`,
  `redirect.js`, `validation.js`, `preHandlers.js`, `staticRoutes.js` and `errorMap.js`. `routeParser.js` keeps its
  single public `parse` export, so the composition root is unchanged.
- Error-to-response mapping is now centralized in one file, which is what makes mapping parity checkable in one place
  instead of audited across 159 handlers.

### Changed — asynchronous idiom

- Callback and deferred idioms replaced with native `async`/`await`, `Promise.all` and `Promise.allSettled` across
  `lib/`, `config/`, `scripts/` and `test/`.
- The `Promise.prototype.fail` and `Promise.prototype.spread` monkey-patches were removed once every genuine consumer
  had been converted; both are now `undefined` at runtime.

### Removed

- `lib/auth/passport.js` — 136 lines reached by no route. Deletion was **simulated and measured** before it was made:
  both boots produced identical 233-row route tables and an unchanged response corpus.
- `test/mocha.opts` — the mechanism was removed in Mocha 8; its three options are ported to the new `.mocharc.json`.
- 22 runtime and 2 development dependency declarations. The manifest goes from 58 runtime + 11 development to 38 + 9,
  with two runtime additions (`@aws-sdk/client-s3`, `crypto-js`); everything else
  removed was either never required by any source file or replaced by a Node built-in.

### Security

- `npm audit --omit=dev`: **0 critical, 0 high**. Re-measured against the base commit's own lockfile for comparison,
  the same command reported **15 critical, 26 high, 17 moderate** there.
- One moderate finding remains and is **explicitly accepted with evidence** — the `highlight.js` 9.18.5 ReDoS
  advisory, held because the AAP freezes the version and because a bump measurably changes client-visible markup.
  Its reachability path, authentication requirement and sizing measurement are recorded in the Preserved Quirks
  catalogue.
- `assetUploadFromURL` now streams the remote body to disk instead of buffering it. Measured on a 64 MiB body: RSS
  growth fell from 224.6 MiB to 56.6 MiB, with a byte-identical file written. The endpoint's inherited SSRF posture
  is unchanged and is now disclosed explicitly rather than left implicit.
- A transitive `uuid` advisory reaching the production tree through `bull` was cleared with a single `overrides`
  entry, after measuring that the replacement ships a real CommonJS build and that `bull` uses only `uuid.v4()` with
  no arguments.

### Parity evidence

- **Route table**: 233 rows, unchanged. Sorted sha256
  `452116ce74301c61c92efb36fe8ead987b6a9e81d83a28af335c8d08fa1d64a8`.
- **Response corpus**: all 58 unauthenticated and 7 authenticated base-commit entries replay with **zero
  differences** across every compared field, including HTML body digests.
- New `test/baseline/capture.js` and `test/baseline/replay.js` regenerate and re-verify that corpus over real HTTP
  from committed code; `replay.js` exits non-zero on any difference and its detection power was proven by mutation.
- **Build artifacts**: `public/css/base.css` 265,727 bytes and `public/css/embed.css` 296,352 bytes, byte-identical.
- **Test suite**: restored from "exits 1 before any test runs" to **224 passing, 0 failing**, with every pre-existing
  assertion unchanged.
- Boots under `node --pending-deprecation` with **zero** deprecation warnings.

## [1.0.0] - Initial Open Source Release

First public release of Trinket.
