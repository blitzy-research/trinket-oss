# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased] - Node 22 LTS / hapi 21 modernization

The platform now genuinely runs, builds and tests on Node 22 LTS with npm 10, on `@hapi/hapi` 21 with native
`async (request, h)` handlers, and on a maintained dependency set. **Application behavior is unchanged** — the route
table, response statuses, payload shapes, cookies, asset URLs and persisted formats are all identical, and that is
verified by a captured-and-replayed parity corpus rather than asserted. See *Parity evidence* below.

Every figure below was measured against this repository, not estimated. Every change belongs to exactly one of four
categories — runtime bump, hapi API migration, async conversion, dependency swap — and the sections are grouped that
way so the entry doubles as an audit aid. Two companion documents carry the full detail and are part of this release:

- [Dependency Migration Inventory](docs/MIGRATION-DEPENDENCY-INVENTORY.md) — every bump, replacement, removal and
  deliberate hold, with the exact version on both sides and a reason classified as dead, incompatible or security.
  The per-package table lives there and only there, so there is a single source of truth for it.
- [Preserved Quirks](docs/PRESERVED-QUIRKS.md) — every 2013-era defect and asymmetry that was deliberately carried
  forward unchanged, with the measurement that established it and the regression a well-meaning repair would have
  caused.

### Changed — runtime bump

- Node runtime pinned to 22 LTS with npm 10. `package.json` gains an `engines` block
  (`node >=22.12.0 <23.0.0`, `npm >=10.0.0`), which the base commit did not declare at all; new `.nvmrc` (`22`) and
  new `.npmrc` (`engine-strict=true`, `save-exact=true`), neither of which existed before.
- `package-lock.json` regenerated at `lockfileVersion` 3 and committed, so `npm ci` resolves the new manifest
  deterministically.
- `Dockerfile` retargeted off its Node 16 base onto an exact Node 22 LTS patch release, and its
  `npm install --legacy-peer-deps` replaced with `npm ci`. Holding the image on an old runtime, or keeping the
  legacy-peer-deps escape hatch, would have hidden precisely the problem this release exists to fix.
- `docker-compose.yml` datastore images pinned alongside it: `mongo:5` to `mongo:6.0`, `redis:latest` to `redis:7.4`.
- **CommonJS is retained, and that is a deliberate constraint rather than an omission.** `app.js` assigns nine model
  globals as bare undeclared identifiers, which is legal only in sloppy mode, and `'use strict'` appears nowhere in
  the application tree. ESM is implicitly strict, so converting any module in the bootstrap's require chain would
  throw `ReferenceError` at boot.

### Changed — hapi API migration

- `@hapi/hapi` 20.3.0 → 21.4.10 and `joi` 17.13.3 → 18.2.3. Validation outcomes are byte-identical: six differential
  cases produced the same verdict, detail count, error path, error type and message string on both versions, so no
  option overrides were needed and no input accepted or rejected at the base commit changes its verdict.
- All **159** legacy `function (request, reply)` handlers converted to native `async (request, h)`; zero bare
  `reply(` call sites remain in `lib/` or `config/`.
- The 775-line hand-written hapi-4-to-20 compatibility layer inside `lib/util/routeParser.js` was retired. The
  behavior it carried — as opposed to the emulation it wrapped around — was relocated rather than deleted, into seven
  focused modules under a new `lib/http/`: `responseContract.js`, `redirect.js`, `validation.js`, `preHandlers.js`,
  `staticRoutes.js`, `errorMap.js` and `pending.js`. `routeParser.js` keeps its single public `parse` export, so the
  composition root is unchanged.
- **Every converted path keeps its error-to-response mapping — same status codes, same error payload shapes.** The
  mapping is now centralized in `lib/http/errorMap.js`, which is what makes that parity checkable in one place
  instead of audited across 159 handlers.

### Changed — async conversion

- Callback and deferred idioms replaced with native `async`/`await`, `Promise.all` and `Promise.allSettled` across
  `lib/`, `config/`, `scripts/` and `test/`. The `q` package is gone: it had two require sites at the base commit and
  has none now.
- The `Promise.prototype.fail` and `Promise.prototype.spread` monkey-patches were removed once every genuine consumer
  had been converted; both are now `undefined` at runtime.
- Node-core callback APIs moved to their promise equivalents, and the two deprecated constructions the application
  owned are gone: `new Buffer(...)` became `Buffer.from(...)`, and `fs.exists()` became an `fs.promises` check.
- The deprecated `url.parse()` call sites were resolved **site by site against measured base behavior**, not by a
  blanket substitution. WHATWG `URL` rejects the relative, protocol-less and empty inputs the legacy parser tolerates,
  so sites whose outcome depended on that tolerance are served by an in-repo faithful port, `lib/util/legacyUrl.js`,
  while sites that map cleanly use the non-throwing static `URL.parse()`.

### Changed — dependency swap

- The manifest goes from 58 runtime + 11 development dependencies to **38 + 9**, and gains two blocks it never had:
  `engines` and `overrides`.
- **22 runtime and 2 development declarations removed** against **only 2 runtime additions**
  (`@aws-sdk/client-s3`, `crypto-js`). The removals are packages no source file required, the two authentication
  strategies made dead by the deletion below, packages whose work a Node built-in now does, and packages whose only
  consumer was itself removed. The exact decomposition, and the original → replacement → reason for every one of
  them, is in the [Dependency Migration Inventory](docs/MIGRATION-DEPENDENCY-INVENTORY.md).
- `npm audit --omit=dev`: **0 critical, 0 high**. Re-measured against the base commit's own lockfile for comparison,
  the same command reports **15 critical and 27 high** there. Only the critical and high figures are quoted, because
  they are the gate and they reproduce; counts below `high` drift as the advisory database changes.
- One moderate finding remains and is **explicitly accepted with evidence** — the `highlight.js` 9.18.5 ReDoS
  advisory, held because the only offered fix changes the CSS class names the library emits into client-visible
  markup. Its reachability path and the reasoning are recorded in [Preserved Quirks](docs/PRESERVED-QUIRKS.md).
- A transitive `uuid` advisory reaching the production tree through `bull` was cleared with a single `overrides`
  entry, after measuring that the replacement ships a real CommonJS build and that `bull` uses only `uuid.v4()` with
  no arguments.

### Removed

- `lib/auth/passport.js` — 136 lines reached by no route. Deletion was **simulated and measured** before it was made:
  both boots produced identical 233-row route tables and an unchanged response corpus.
- `test/mocha.opts` — the mechanism was removed in Mocha 8; its three options are ported to the new `.mocharc.json`.

### Testing

- Test tooling restored to maintained releases: `mocha` 3.5.3 → 11.7.6, `chai` 3.5.0 → 4.5.0, `sinon` 1.7.3 → 22.1.0,
  `supertest` 0.8.3 → 7.2.2, with `chai-as-promised`, `sinon-chai` and `redis-mock` moved in step.
- `.mocharc.json` carries an explicit `"exit": true`. That is **preservation, not a weakening**: Mocha 3 force-exited
  after a run and Mocha 4 made it opt-in, while the application's repeating interval, its module-load database
  connection and its eagerly created cache client all keep the event loop alive. Without it the test command would
  hang after passing, which is an observable change in how the command behaves.
- A baseline parity harness added under `test/baseline/` — `capture.js`, `replay.js`, a 233-route table snapshot and a
  response corpus — plus a route-level parity suite at `test/lib/api/route-parity.js`, appended last in the existing
  serial sequence so the nine suites before it are neither reordered nor disturbed.
- **Every pre-existing test assertion is unchanged.** Only the mechanics around them moved: the three-argument
  `sinon.stub(obj, 'm', fn)` form removed in Sinon 3, the session-cache helper's require, and the harness's
  attachment to the asynchronously created server.

### Unchanged

- **No route or feature was added or removed.** The route table is 233 rows, and the method, path, authentication mode
  and pre-handler count of every one of them is identical to the base commit.
- No TypeScript conversion, no web framework swap, no frontend rewrite. The application remains JavaScript on hapi;
  the server-rendered templates, the AngularJS partials and the SCSS design-token layer are untouched.
- Build tooling held on purpose: `sass` 1.98.0 and `vite` 4.5.14, with the same two inputs producing the same two CSS
  artifacts at the same paths. Advancing either would change the output of the vendored Foundation 5.5.3 fork.
- Thirteen catalogued 2013-era quirks were **preserved and documented rather than fixed**, together with three
  deliberate browser-versus-server version skews (`highlight.js`, `marked`, `jszip`) whose browser pins are asset
  URLs. Among the preserved defects: authenticated `GET /login` and `GET /signup` still answer HTTP 500, and the Joi
  custom-message override still never fires, so the raw technical message still reaches the user. Each entry carries
  its measurement and the regression a repair would have caused in
  [Preserved Quirks](docs/PRESERVED-QUIRKS.md).

### Parity evidence

- **Route table**: 233 rows, unchanged. Sorted sha256
  `452116ce74301c61c92efb36fe8ead987b6a9e81d83a28af335c8d08fa1d64a8`.
- **Response corpus**: all 58 unauthenticated entries, 7 authenticated entries and 8 `next`-destination probes
  captured from the base commit replay with **zero differences** across every compared field, including HTML body
  digests.
- New `test/baseline/capture.js` and `test/baseline/replay.js` regenerate and re-verify that corpus over real HTTP.
  Neither harness ever calls `server.inject()`, because injection is itself the one remaining deprecation source in
  the dependency tree; the application's own two internal sub-requests through it are base-identical and preserved.
  `replay.js` exits non-zero on any difference.
- **Build artifacts**: `public/css/base.css` 265,727 bytes and `public/css/embed.css` 296,352 bytes, byte-identical,
  with no `.css.map` emitted — as before.
- **Test suite**: restored from "exits 1 before any test runs" to a full run with zero failures.
- Boots under `node --pending-deprecation` with **zero** deprecation warnings.

## [1.0.0] - Initial Open Source Release

First public release of Trinket.
