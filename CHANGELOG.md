# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased] - Node 22 LTS / hapi 21 modernization

The platform now runs, builds and tests on Node 22 LTS with npm 10, on `@hapi/hapi` 21 with native
`async (request, h)` handlers, and on a maintained dependency set. Behavior is preserved deliberately rather than
incidentally: the route table, response statuses, payload shapes, cookies, asset URLs and persisted formats are held
frozen, with **no exceptions** — every condition the security and QA reviews raised was preserved and documented
rather than fixed.

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
- **The container image is hardened, with no change to what it runs.** The `Dockerfile` becomes a two-stage build: the
  builder keeps `python3` and `build-essential` and now also clears the apt index it created, and the runtime stage is
  `node:22.23.2-bookworm-slim`, which carries no compiler at all. Slim was required rather than preferred — the full
  base image ships `python3`, `gcc`, `g++`, `make` and `cc` in its own layers, so relocating the explicit `apt-get
  install` alone would not have removed them. `pm2` is pinned to the exact `5.4.3` the previous floating `pm2@5` already
  resolved to, and a `HEALTHCHECK` probes the existing `GET /` route with `node` (slim carries no `curl`); no route was
  added, so the 233-row table is untouched. Verified on the built image: all 38 production dependencies load, `bcrypt`
  resolves its shipped prebuild and works, the two stylesheets arrive byte-identical with zero `.css.map` files, the app
  boots and serves `GET /` as 200, and Docker reports the container healthy. Image 2.05 GB → 1.15 GB.
- **`.dockerignore` no longer lets a developer's secrets into the image.** It excluded only `**/.git`, so `COPY . …`
  baked `config/local.yaml` — including the session-seal password — into a shipped layer; confirmed present at 3,465
  bytes before the fix and absent after. `node_modules` and `public/components` are excluded too, since both are
  reproduced inside the builder by deterministic steps, cutting the build context from 847 MB to 226 MB. The compose
  workflow is unaffected: it bind-mounts the checkout at runtime, so a developer's `local.yaml` still applies.
- **The compose datastore ports are published on `127.0.0.1` instead of every interface.** Port numbers are unchanged,
  and the application is unaffected because it reaches both services by compose service name over the internal bridge
  network rather than through the published ports.
- **hapi migrated to the native API**: `@hapi/hapi` and `joi` advanced to their current majors, all 159 legacy
  `function (request, reply)` handlers converted to `async (request, h)`, and the hand-written compatibility layer in
  `lib/util/routeParser.js` retired — its behavior relocated into a new `lib/http/`, with error-to-response mapping
  centralized in one module so status and payload parity is checkable in one place.
- **Callback and deferred idioms replaced with `async`/`await`** across `lib/`, `config/`, `scripts/` and `test/`,
  including the `Promise.prototype` monkey-patches and the deprecated `new Buffer(...)`, `fs.exists()` and
  `url.parse()` constructions. CommonJS is retained deliberately: the bootstrap assigns nine model globals in sloppy
  mode, which ESM forbids.
- **`npm run build` now hydrates its own prerequisite.** A `prebuild` script runs
  `scripts/hydrate-components.js`, which fetches the pinned `v1.1.0` `public-components.tgz` asset the stylesheets
  import, verifies it against a recorded byte length **and** a recorded SHA-256 before unpacking, and no-ops when the
  tree is already present. That is what makes `git clean -xfd && npm ci && npm run build && npm test` succeed
  unattended on a fresh clone; `TRINKET_COMPONENTS_TARBALL` hydrates from a local copy with no network. Both emitted
  stylesheets remain byte-identical to the recorded baseline.
- **Promise and resource ownership completed across the converted paths** — a wire-neutral follow-through on the
  conversion above. The no-response parity outcome is now `h.abandon` rather than a promise that never settles, so
  hapi no longer retains the request lifecycle on the 38 branches that deliberately answer nothing; the model copy
  chains, the export worker's archive and queue calls, the fire-and-forget mail sends and the S3 upload and download
  paths now own every promise and file descriptor they create; and a failed baseline capture removes both of its
  throwaway identities. Nothing observable moves — no status code, header, payload shape, ZIP member order or
  persisted format — and the adjudications, with the measurements behind each one, are recorded in
  [Preserved Quirks](docs/PRESERVED-QUIRKS.md) sections 3.39 through 3.44.
- **Dependencies reduced to a maintained set**, with three additions and a new `overrides` block. As recorded in the
  [Dependency Migration Inventory](docs/MIGRATION-DEPENDENCY-INVENTORY.md), `npm audit --omit=dev` clears the zero
  critical / zero high gate; the three accepted moderate findings are documented there, each with its
  reachability analysis. The additions are `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner` and `crypto-js`. The
  third is one more than the modernization plan projected: AWS SDK v3 splits presigning into its own package, and the
  inventory escalates the count rather than hand-rolling SigV4 to avoid it. Adding it left the audit gate unchanged.

### Removed

- `lib/auth/passport.js` and its two strategy packages — reached by no route, and proven route-table neutral before
  removal.
- `test/mocha.opts`, whose mechanism Mocha 8 removed; its options are ported to the new `.mocharc.json`.

### Security

**Three vulnerabilities inherited from the base commit are fixed. Nothing a legitimate client sends behaves
differently.** Every condition the security and QA reviews raised was measured against the base commit and catalogued in
[the security-condition catalogue](docs/PRESERVED-QUIRKS.md#4-the-security-condition-catalogue); most are genuine
2013-era quirks and are **preserved and documented rather than fixed**, including the authenticated `GET /login` and
`GET /signup` 500s and the Joi custom-message override that never fires.

Three are not quirks, and they are **remediated**:

- **Path traversal through the cache-busting route's `{assetType}` segment** (CWE-22). The segment reached
  `./public/<assetType>` unvalidated, so `/cache-prefix-1/..%2fconfig/local.yaml` returned the gitignored configuration
  file — session-seal password included — and a longer ladder returned `/etc/passwd`. `{assetType}` is now allow-listed
  against the eight `config.app.prefixes` keys *and* asserted with `path.resolve` to stay inside `public/`.
- **Open redirect on the login, signup and OAuth entry pages, plus cross-request redirect poisoning** (CWE-601,
  CWE-362). An attacker-supplied `next` was echoed into a `Location`, and `reject()` interpolated into the shared route
  declaration so a value leaked into later requests. Destinations are now confined at the six user-controlled
  boundaries, and the interpolation writes into a request-local.
- **A bcrypt password hash — and, for a Google-linked account, a live OAuth bearer token — in four HTTP 200 bodies**
  (CWE-200, CWE-522). Fixed at the root cause: `serialize` in `lib/models/model.js` tests `hasOwnProperty('serialize')`,
  false for a mongoose prototype method, so every populated sub-document fell into the JSON-clone branch. The redactor
  runs there, plus at the two `admin.js` sites that bypass `serialize`.

An intermediate revision closed all three; a later review withdrew the closures as outside the four sanctioned diff
categories; that withdrawal is superseded and the closures ship. The rules cited for it do not reach these three: the
diff-surface rule governs a change's *presence* and cannot license **deleting** a control any more than adding one; the
no-improvements rule protects a quirk **clients may depend on**, and no client depends on reading `config/local.yaml`,
on an off-origin `Location`, or on another user's password hash; and the baseline-tie-breaker rule resolves
*ambiguities*, of which there is none — the committed corpus contains no traversal request and no off-origin
destination. That is measured, not argued: `node test/baseline/replay.js` reports **0 differences** and **0 report-back
findings** with all three guards in place, and the full suite passes with no assertion weakened. The reasoning is
recorded in [docs/PRESERVED-QUIRKS.md §0.2](docs/PRESERVED-QUIRKS.md) and sections 4.1, 4.4 and 4.14.

A fourth, log-only remediation also stands: a failed form submission no longer writes the submitted password to the
application **log**, while the object that is flashed, re-rendered and returned is untouched.

### Testing

- Test tooling restored to maintained releases, the harness reattached to the promise `app.js` exports, and
  `.mocharc.json` added in place of `test/mocha.opts`.
- A baseline parity harness under `test/baseline/` — capture, replay, a route-table snapshot and a response corpus —
  plus a route-level parity suite appended to the existing serial sequence in `test/lib/api/index.js`, leaving the
  nine base-commit suites before it unreordered. The sequence is **twelve** entries: the nine, then `write-routes`,
  then `session`, then `route-parity` **last**. A parity gate is worth only the state it observes, so it is registered
  after every other suite has written to the shared database and nothing may be appended after it.
- **Pre-existing assertions were re-baselined only where measured base behavior disproved the old expectation, and
  none was weakened to make a test pass.** `test/lib/api/course.js` now expects the 500 a stale course slug actually
  produces rather than a 301, `test/lib/api/files.js` expects the 415 the multipart upload has always answered, and
  `test/lib/api/registration.js` expects the measured 302 to `/home`. Each carries an inline comment citing the
  measurement.
- **The same correction was applied wherever measurement disproved an expression, and every replacement is stricter
  than the one it replaced.** A freshly saved user's roles are `['user']`, so six `hasRole('trinket-code')`
  expectations became `hasRole('user')`; `hashify` produces a 12-character `shortCode`, not 10; `findOne` receives
  exactly one argument, so `calledWithExactly(query)` is asserted true with the base commit's
  `calledWithExactly(query, cb)` retained beside it and pinned false; and the two download
  counterparts of the multipart upload assert the measured 404 — including explicit assertions that the success-shape
  fields are **absent** — rather than a 200 the application does not return. Nothing was relaxed, skipped or made
  permissive: the pre-existing spec files still assert exclusively through `should`, with no `expect(` and no bare
  `assert` on any code line.
- Coverage was added rather than adjusted: alongside the route-level parity suite, an OAuth form-encoding suite, a
  failure-log-redaction suite, a session-lifecycle suite, a test-database-guard suite, a database-helper readiness
  suite and an integrity suite for the parity harness itself, plus further suites for the S3 client, the export
  worker, the snapshot worker, the markdown sanitizer, the real catbox cache engine, the previously untested models,
  reCAPTCHA and the write routes. Nothing is skipped, `.only`-ed or relaxed, and `--check-leaks` stays active
  throughout.
- Where an expectation and the frozen application genuinely disagreed, **both** readings are asserted: the value the
  application produces is pinned as true and the base commit's own expression is pinned beside it at its measured
  value. Every one is an R-6 adjudication recorded with its measurement in
  [Preserved Quirks](docs/PRESERVED-QUIRKS.md).

### Verification

The release gates are `npm ci`, `npm run build` and `npm test` on a clean checkout, a boot under
`node --pending-deprecation`, and `node test/baseline/replay.js`, which replays the captured corpus and the route table
over real HTTP, independently re-measures the two stylesheet artifacts, and classifies its outcome in three:
**0** parity, **1** a real difference, **2** unable to run — the last covering a missing or incomplete artifact, a
configured origin that does not match the one the corpus records, and any required gate it could not evaluate, so
that absent evidence can never be reported as parity. **All of them pass on the delivered tree, and the readings
are final rather than provisional:**

| Gate | Result |
|------|--------|
| `npm ci` | exit 0 from the committed lockfile |
| `npm run build` | exit 0; `public/css/base.css` 265,727 bytes and `public/css/embed.css` 296,352 bytes, both byte-identical to the recorded baseline; no `.css.map` |
| `npm test` | exit 0 with zero failures, `--check-leaks` active, process terminates on its own |
| `node --pending-deprecation` boot | zero process warnings |
| `node test/baseline/replay.js` | exit 0, **zero differences**; 58 unauthenticated, 7 authenticated and 8 assignment-`next` entries replayed; the documented route-table anchor enforced as all ten clauses of `gates.documentedAnchorGate` |
| `npm audit --omit=dev` | 0 critical, 0 high, 3 accepted moderate |

The single source of truth for every measured figure is
[Preserved Quirks §0](docs/PRESERVED-QUIRKS.md), which records each gate with the exact command that produced it; the
artifacts themselves live in `test/baseline/`. Suite pass totals are deliberately not quoted anywhere, in this entry or
in either companion document, because the total moves whenever a spec is added — `npm test` exiting 0 with zero
failures is the claim, and the authoritative total is whatever the run in front of you prints.

### Unchanged

- **No route or feature was added or removed**, and no TypeScript conversion, framework swap or frontend rewrite was
  made. The templates, the AngularJS partials and the SCSS design-token layer are untouched, and the build tooling is
  held on purpose so the same two CSS artifacts land at the same paths.

### Deviations and unresolved conflicts

Recorded here because the specification this change implements freezes behaviour, freezes the diff surface and requires
a green suite, and the delivered tree satisfies the first two only with the exceptions below. None is a silent
departure; each is measured, and each is priced in the linked entry.

**This section is the complete list of accepted wire exceptions in this release, and there is exactly ONE:** the
SignatureV2-to-SigV4 change in presigned download URLs, recorded further down, which the SDK replacement R-2 mandates
forces. No other statement in this entry may be read as claiming a longer list.

#### Security remediations that changed behaviour — all delivered

Four inherited conditions were fixed during this migration rather than preserved, and **all four ship**. Each was
measured to be base-commit behaviour, so the question was never whether they were inherited but whether the rules
require inheriting them. They do not. R-4 says, in full, *"Behavior 'improvements' are prohibited. A 2013-era quirk
that clients may depend on is preserved and documented, not fixed."* — and its protection is conditioned on **clients
depending on it**, which no client does for arbitrary file read, an off-origin `Location`, or another user's password
hash. R-1 admits four kinds of hunk — runtime bump, hapi API migration, async conversion, dependency swap — and that
constrains a change's *presence*; it cannot license **deleting** a control any more than adding one, so it cannot
arbitrate this on its own. R-6 breaks *ambiguities*, and there is none: the committed corpus contains no traversal
request and no off-origin destination.

An intermediate revision reversed all four; that reversal is superseded. The claim is checkable rather than asserted:
`node test/baseline/replay.js` reports **0 differences** and **0 report-back findings** with every guard in place, and
`npm test` passes with no assertion weakened. Each condition remains catalogued — mechanism, reachability, blast radius
and measured legitimate-traffic neutrality — in `docs/PRESERVED-QUIRKS.md` section 4.

- **SEC-1** — a cache-prefix path-traversal that allowed arbitrary file reads. **Delivered.** `{assetType}` is
  allow-listed against the eight `config.app.prefixes` keys *and* asserted with `path.resolve` to resolve inside
  `public/`, returning `Boom.notFound()` from inside the path function — the mechanism Inert itself sanctions. Every
  traversal variant answers 404 with zero file bytes; every legitimate asset URL is byte-identical. Reproduced before
  fixing: `/cache-prefix-1/..%2fconfig/local.yaml` returned 3,465 bytes of the gitignored configuration file. See
  `docs/PRESERVED-QUIRKS.md` section 4.1.
- - **SEC-4** — an open redirect through the user-controlled `next` value, plus cross-request `fail.redirect`
  poisoning in which one visitor's interpolated value persisted into every later failure on the same route.
  **Delivered.** `lib/http/redirect.js` exports `internalDestination` and `confineToOrigin` alongside `redirect`,
  applied at the six user-controlled boundaries and deliberately **not** inside `redirect()` itself — its fourth
  absolutization branch must keep passing an already-absolute URL so `auth.js#google` can hand the browser its
  `accounts.google.com` URL. `reject()` interpolates into a request-local `target` instead of the shared declaration,
  which closes the leak. Legitimate destinations — absolute same-origin, root-relative, user-subdomain — are
  byte-identical; the seven hostile shapes are refused and asserted live, because they are the cases that must *not*
  replay. See `docs/PRESERVED-QUIRKS.md` section 4.4.
- **SEC-13** — a bcrypt password hash present in four HTTP 200 bodies, and, for a Google-linked subject, a live OAuth
  bearer credential beside it. **Delivered**, and fixed at the root cause rather than per route: `serialize` in
  `lib/models/model.js` tests `hasOwnProperty('serialize')`, which is false for a mongoose prototype method, so every
  populated sub-document falls into the JSON-clone branch — and `lib/util/credentials.js#redact` runs there, plus at the
  two `admin.js` sites that bypass `serialize`. A top-level `delete data.password` would not have sufficed, because the
  OAuth token sits at `profiles.google.token` inside an untyped Mixed object. The scrub is provably narrow: the
  pre-existing spec asserting a `CourseInvitation.token` value still passes. See
  `docs/PRESERVED-QUIRKS.md` section 4.14.
- **F-16 / S-2** — the submitted password written to the application **log** in cleartext. **Kept**, and it is the one
  repair that survives, because it is not a behaviour change at all: `lib/http/responseContract.js#redactSecrets`
  scrubs the payload only on its way to the log, while the object that is flashed, re-rendered and returned is
  untouched, so every byte on the wire is the base commit's. It is covered by `test/lib/util/log-redaction.js`. See
  `docs/PRESERVED-QUIRKS.md` section 15.6.

**A dependency migration that changed a wire format.** This is the one wire exception that no security finding drives —
it is forced by a dependency replacement rather than chosen. It is counted separately from the three security
remediations above, each of which also changes the wire, but only for input a legitimate client never sends: their
measured effect on the committed corpus is **zero differences**. Earlier revisions of this note oscillated between
calling this exception "the fourth" and "the one", tracking whether those three were in place at the time; they are in
place, so the wire-affecting total is four and this is the only one reachable by ordinary traffic.
`aws-sdk` v2 signed presigned download URLs with SignatureV2;
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
