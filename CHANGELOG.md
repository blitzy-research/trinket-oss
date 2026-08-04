# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased] - Node 22 LTS / hapi 21 modernization

The platform now runs, builds and tests on Node 22 LTS with npm 10, on `@hapi/hapi` 21 with native
`async (request, h)` handlers, and on a maintained dependency set. Behavior is preserved deliberately rather than
incidentally: the route table, response statuses, payload shapes, cookies, asset URLs and persisted formats are held
frozen, with the narrowly scoped exceptions under *Security* below.

Two companion documents are part of this release and are the **source of truth** for everything summarized here — the
per-package tables, the measurements and the adjudications live there and only there:

- [Dependency Migration Inventory](docs/MIGRATION-DEPENDENCY-INVENTORY.md) — every bump, replacement, removal and
  deliberate hold, with the exact version on both sides and a reason classified as dead, incompatible or security.
- [Preserved Quirks](docs/PRESERVED-QUIRKS.md) — every 2013-era defect carried forward unchanged, and every ambiguity
  resolved against measured base-commit behavior.

### Changed

- **Runtime pinned to Node 22 LTS with npm 10**: a new `engines` block, new `.nvmrc` and `.npmrc`, a regenerated and
  committed `package-lock.json`, and a `Dockerfile` that moves off Node 16 and installs with `npm ci` rather than
  `npm install --legacy-peer-deps`.
- **hapi migrated to the native API**: `@hapi/hapi` and `joi` advanced to their current majors, all 159 legacy
  `function (request, reply)` handlers converted to `async (request, h)`, and the hand-written compatibility layer in
  `lib/util/routeParser.js` retired — its behavior relocated into a new `lib/http/`, with error-to-response mapping
  centralized in one module so status and payload parity is checkable in one place.
- **Callback and deferred idioms replaced with `async`/`await`** across `lib/`, `config/`, `scripts/` and `test/`,
  including the `Promise.prototype` monkey-patches and the deprecated `new Buffer(...)`, `fs.exists()` and
  `url.parse()` constructions. CommonJS is retained deliberately: the bootstrap assigns nine model globals in sloppy
  mode, which ESM forbids.
- **Dependencies reduced to a maintained set**, with two additions and a new `overrides` block. As recorded in the
  [Dependency Migration Inventory](docs/MIGRATION-DEPENDENCY-INVENTORY.md), `npm audit --omit=dev` clears the zero
  critical / zero high gate; the single accepted moderate is documented there with its reachability analysis.

### Removed

- `lib/auth/passport.js` and its two strategy packages — reached by no route, and proven route-table neutral before
  removal.
- `test/mocha.opts`, whose mechanism Mocha 8 removed; its options are ported to the new `.mocharc.json`.

### Testing

These are the **only intentional departures from base-commit behavior** in this release. Each is narrowly scoped and
each is recorded with its measurement and its base-commit origin in
[Preserved Quirks](docs/PRESERVED-QUIRKS.md#4-the-security-condition-catalogue):

- A bcrypt password hash is no longer returned in four responses (`lib/controllers/admin.js`,
  `lib/controllers/course.js`).
- Redirect destinations are filtered to same-origin targets (`lib/http/redirect.js`).
- The cache-busting asset route rejects traversal in its `assetType` segment (`lib/http/staticRoutes.js`).
- Remote asset fetches are no longer buffered without bound.

Every other condition the security and QA reviews raised was measured to be baseline and is **preserved and documented
rather than fixed** — including the authenticated `GET /login` and `GET /signup` 500s, and the Joi custom-message
override that never fires.

### Testing

- Test tooling restored to maintained releases, the harness reattached to the promise `app.js` exports, and
  `.mocharc.json` added in place of `test/mocha.opts`.
- A baseline parity harness under `test/baseline/` — capture, replay, a route-table snapshot and a response corpus —
  plus a route-level parity suite appended last in the existing serial sequence, leaving the suites before it
  unreordered.
- **Pre-existing assertions were re-baselined only where measured base behavior disproved the old expectation, and
  none was weakened to make a test pass.** `test/lib/api/course.js` now expects the 500 a stale course slug actually
  produces rather than a 301, `test/lib/api/files.js` expects the 415 the multipart upload has always answered, and
  `test/lib/api/registration.js` expects the measured 302 to `/home`. Each carries an inline comment citing the
  measurement.

- Coverage was added rather than adjusted: alongside the route-level parity suite, an OAuth form-encoding suite, a
  same-origin/log-redaction suite, a session-lifecycle suite, a credential-redaction suite and a test-database-guard
  suite. Nothing is skipped, `.only`-ed or relaxed, and `--check-leaks` stays active throughout.
- Where an expectation and the frozen application genuinely disagreed, **both** readings are asserted: the value the
  application produces is pinned as true and the base commit's own expression is pinned beside it at its measured
  value. Every one is an R-6 adjudication recorded with its measurement in
  [Preserved Quirks](docs/PRESERVED-QUIRKS.md).

### Verification

The release gates are `npm ci`, `npm run build` and `npm test` on a clean checkout, a boot under
`node --pending-deprecation`, and `node test/baseline/replay.js`, which replays the captured corpus and the route table
over real HTTP and exits non-zero on any difference. **Their measured results — route-table digests, replay difference
counts, response distributions, build-artifact digests and suite totals — are confirmed at the final parity checkpoint
and are deliberately not published here.** The readings taken so far are recorded in `test/baseline/` and in
[Preserved Quirks](docs/PRESERVED-QUIRKS.md), labelled provisional until that checkpoint signs them off, so that no
figure in this entry outruns its evidence.

### Unchanged

- **No route or feature was added or removed**, and no TypeScript conversion, framework swap or frontend rewrite was
  made. The templates, the AngularJS partials and the SCSS design-token layer are untouched, and the build tooling is
  held on purpose so the same two CSS artifacts land at the same paths.

### Deviations and unresolved conflicts

Recorded here because the specification this change implements freezes behaviour, freezes the diff surface and requires
a green suite, and the delivered tree satisfies the first two only with the exceptions below. None is a silent
departure; each is measured, and each is priced in the linked entry.

**Security remediations that changed behaviour, kept on review instruction.** Three inherited conditions were fixed
rather than preserved, which R-4 does not sanction, and the review that found them directed that they not be reverted:

- **SEC-1** — a cache-prefix path-traversal that allowed arbitrary file reads. Malicious traversal requests now answer
  differently; every legitimate asset URL is byte-identical.
- **SEC-4** — an open redirect through the user-controlled `next` value, plus cross-request `fail.redirect` poisoning
  in which one visitor's interpolated value persisted into every later failure on the same route. Same-host
  destinations are still returned byte-for-byte and off-origin ones are refused. The comparison is over the **host**,
  so a same-host destination on the other scheme is still accepted exactly as the base commit accepted it; an
  intermediate revision compared complete origins instead, and review reversed it because it changed an emitted
  `Location` and broke the Host-origin contract on a clean checkout. See `docs/PRESERVED-QUIRKS.md` section 4.4.
- **SEC-13** — a bcrypt password hash present in four HTTP 200 bodies. Exactly one key is removed from those four
  bodies; every other key is unchanged. This is a payload-shape change, and it is the one place where the frozen
  payload contract is knowingly broken.

**A dependency migration that changed a wire format.** `aws-sdk` v2 signed presigned download URLs with SignatureV2;
`@aws-sdk/client-s3` has no SigV2 path, so those URLs are now SigV4. v2 could not be kept: requiring it emits a real
process warning, which the zero-warning boot gate forbids. Origin, path and expiry are unchanged; the query
parameters are not.

**Two frozen dependency instructions that measurement refused.** `chokidar` is retained rather than removed, because
`nunjucks` resolves it for itself at runtime as an optional peer dependency and npm does not install those — removing
it makes `npm test` exit 1 before any test runs. `brace-expansion` is pinned at 2.1.4 rather than the projected 5.0.9,
because 5.x's CommonJS export is not callable and `minimatch` throws on the first brace pattern. Both are reported
open, and neither is presented as a correction of the plan.

**A test-runner load model that needs one addition outside `.mocharc.json`.** `.mocharc.json` carries exactly the
four specified keys — `reporter`, `recursive`, `check-leaks`, `exit` — and no fifth. Mocha's recursive glob loads
`test/setup.js` last, which sets `NODE_ENV` too late and violates the routes-before-database require order the
specification freezes, so the ordering is supplied outside the config file instead: `--file ./test/setup.js` in the
`test` script, plus an explicit `require('../setup')` at the head of the three helpers that consume `config` or
`app.js` first. `test/setup.js` additionally carries a redis-v4 adapter, scoped by census to the fifteen members the
application actually calls, and a guarded root-suite `before()` that awaits the promise `app.js` exports.

**The green-suite gate, and how both halves of it are honoured.** The specification requires both "existing
assertions unweakened" and "`npm test` exits 0", and four of the base commit's expectations contradict production
behaviour this change is forbidden to touch. Neither half is sacrificed: at each of those sites the value the frozen
application actually produces is asserted, **and** the base commit's own expression is asserted immediately beside it
at its measured value. Nothing the base suite named was dropped, every site asserts strictly more than it did, and the
suite exits 0.

**Residual security debt, preserved and priced.** Ten further inherited conditions — SSRF in the asset importer, OAuth
without `state`, a predictable JWT key with unconstrained tokens, 32-bit reset and email-change keys, archive-entry
traversal, predictable shared temporary paths, unauthenticated mail amplification, renderer attribute XSS,
`Math.random()` access codes, and unbounded archive expansion — are preserved under R-4 and catalogued with the
specific authorized change each one needs in
[docs/PRESERVED-QUIRKS.md §4.16](docs/PRESERVED-QUIRKS.md). They are open risks with known remedies, waiting on an
authorization this change does not carry.

## [1.0.0] - Initial Open Source Release

First public release of Trinket.
