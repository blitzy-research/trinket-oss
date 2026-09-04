# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased] - Node 22 LTS and hapi 21 migration

Runs the application on Node 22 LTS against the real `@hapi/hapi` 21.x API. Behaviour was preserved deliberately, and most of that preservation is now measured rather than intended: the HTTP surface is verified unchanged entry by entry, the test suite is green, the baseline response corpus is captured, and four of the five parity gates pass on the delivered tree. What is not yet proven is stated as such — the fifth gate, a full replay of the captured corpus, carries one stated precondition, and the comparisons that depend on it (rendered pages, cookie attributes and most error edges) are outstanding. **Not yet proven** at the end of this entry records that, gate by gate; the two approved deviations from preservation are named under **Behaviour**.

### Runtime

- Node 16/18 to **Node 22 LTS**. `package.json` now declares `engines: {"node": ">=22.0.0 <23.0.0", "npm": ">=10.0.0 <11.0.0"}`, and a new `.nvmrc` contains `22`. These bound the majors and float within them, which is what an LTS line taking security patches should do; they are not a reproducibility mechanism. Exact reproducibility is carried by the committed `package-lock.json`, the digest-pinned container image and the exact `pm2` pin.
- All nine Node-bearing Dockerfiles move to Node 22: the root image plus eight under `serverside/**`. The tenth, nginx, carries no Node. The root image is pinned by digest, installs with `npm ci` instead of `npm install --legacy-peer-deps`, and now builds the CSS artifacts it serves — it previously fetched components and installed dependencies but built neither stylesheet, so a container built from it served no CSS at all. All nine images were built from scratch and every unit was booted on Node 22; the per-image results are recorded in [docs/baseline-parity.md](docs/baseline-parity.md) §5.2.

### Framework

- `@hapi/hapi` **20.3.0 to 21.4.10**, with the plugins current.
- The **154 functions hapi invokes** (145 routed handlers, 8 routed pre-handlers and 1 inline pre-handler) moved off the callback idiom onto the framework's lifecycle signature: every one of them now takes `(request, h)`, and responses are returned through the toolkit rather than signalled out of band into the compatibility layer. Most are declared `async`; the rest are plain functions returning a value or a promise, which the contract satisfies equally — among them the two Google handlers in `lib/controllers/auth.js` and the pre-handlers that resolve synchronously. The five functions that are defined but bound to no route keep their old signature, which is the scope this migration set. **The signature move is complete and per-path closure is established for the functions hapi invokes**: the conversion checklist, regenerated from the delivered tree, records **145 of 145 routed handlers and 8 of 8 routed pre-handlers with a proven exit on every path**. `reply(` call sites fall from **202 to 6**, and all 6 are inside the three pre-handlers no route binds, each behind a `return`. The checklist closes **266 of its 382 rows**; the open remainder is dominated by site kinds whose closure needs the replay evidence rather than a code change — callback boundaries, reply chains and stream sites — plus one routed handler, `trinket.js:381 updateMetrics`, held open deliberately because delivering its no-metric branch would turn a baseline 500 into a 200 (the code carries the measurement).
- The response-emulation compatibility layer in `lib/util/routeParser.js` is **removed**. The route DSL, the 233 registered routes, the hand-rolled validation path, all three error funnels, the missing-controller fallback and the per-request debug logging are carried over unchanged in the code; that the route surface itself did not move is **measured**, by the per-entry route-manifest comparison; the validation *outcomes* are measured too, across all 102 targets, and the error-mapping outcomes are inventoried per edge with the driven comparison named at the end of this entry.
- `lib/auth/passport.js` deleted: 136 unreachable lines whose only binding was an unused `require` in `app.js`.

### Dependencies

- Blocking-only replacements, notably `joi` 18.2.5, `bull` 4.16.5, `mime` 4.1.0, `js-yaml` 4.3.2, `jsonwebtoken` 9.0.2, `bcrypt` 6.0.0 and `nodemailer` 9.1.0. Every replaced or major-bumped package is recorded with its reason and resolved version in [docs/dependency-inventory.md](docs/dependency-inventory.md).
- **19 production and 4 development declarations removed** for having no live consumer in retained source, including all four `passport` packages, `request`, `optimist`, `mkdirp`, `rimraf` and `node-uuid`.
- Unmaintained packages that carry no critical or high advisory are **deliberately left in place** rather than modernized: `aws-sdk` v2, `mongoose` 6, `mongoose-schema-extend`, `highlight.js` 9, `jszip`, `q` and `config`, each with its reasoning in [docs/deferred-dependencies.md](docs/deferred-dependencies.md), which triages them by advisory. Retention is a deferral, not a clean bill of health.
- **`archiver` moved 2.1.1 to 6.0.2 rather than being retained**, and it is the one package that moved for something other than an advisory of its own. Retained at 2.1.1 it was the source of the last deprecation warning at boot, and measurement of its archive writer found worse: through `compress-commons` 1.2.2 every deflated entry declared `crc32` 0 and uncompressed size 0 in the local header, the data descriptor and the central directory alike. At 6.0.2 the warning is gone and the write-then-read path is asserted — every entry declares a correct crc32 and length, and `getData()` round-trips byte-exactly.

### Behaviour

- **Verified unchanged**: route paths, methods and per-route auth, compared entry by entry against base commit `2f8712a` by the route-manifest gate over all 233 routes, together with the route-table CLI output.
- **Also verified unchanged**: validation accept/reject outcomes, across all **102** validation targets — 306 cases, 462 outcomes and 15 678 compared fields with **no difference**, in both `Accept` modes — and persisted data and file formats, whose exact sha1 object key is asserted against seeded **pre-migration** objects rather than only against freshly written ones, since a write-then-read round trip passes under any digest.
- **Intended to be preserved, with the comparison still outstanding**: cookie names and attributes, login-flow outcomes, and rendered pages and asset URLs. The baseline for these **is captured** — 383 scenarios covering all 233 routes, each with a recorded response from base commit `2f8712a` — and what has not run is the replay that compares them, for the reason under **Not yet proven**. One class is flagged rather than left implicit: the error-edge inventory's static comparison marks **8** rows as answering where the baseline answered nothing, of which **5** sit inside `trinketByOwnerAndSlug`, a pre-handler no route binds and therefore unreachable in the delivered application, and **3** are pre-handler error branches that now reach the `onPreResponse` funnel as a 404 or a 500. No decision authorizing those three has been recorded, and the replay is what establishes whether they are reachable at all. [docs/preserved-quirks.md](docs/preserved-quirks.md) catalogues the 2013-era quirks that were preserved and documented rather than fixed, and [docs/baseline-parity.md](docs/baseline-parity.md) carries the parity method, the gate register and the resolution log against base commit `2f8712a`.
- Two **approved deviations** from that preservation, each recorded with its reasoning rather than presented as a fix:
  - The image-download branch of `lib/controllers/files.js` never settled, so that request hung. It now serves the stream response its sibling branch already produced, without the `Content-Disposition` header that branch adds. An unsettled request is not behaviour a client can depend on, and every route is required to serve. **Measured on both sides**: the corpus records the baseline step as an expected timeout, a replay of the delivered tree records the same step answering, and the run classifies it an approved deviation verified field by field — the single differing field being `outcome: "timed-out" -> "answered"` — while the four header-resolved chains in the same run compare as matches.
  - The private `marked` fork is **retained** despite a high ReDoS advisory, because every replacement tested changes rendered output and emits a deprecation notice on every parse. `npm audit --omit=dev` therefore reports **0 critical, 1 high and 6 moderate** findings rather than a clean pass — the high being direct `marked`, the moderates `aws-sdk`, `bull`, `highlight.js`, `jszip`, `mongoose` and transitive `uuid` — with the single high named and attributed in [docs/deferred-dependencies.md](docs/deferred-dependencies.md).
- A further **shortfall was found by measurement and then closed**: the zero-deprecation-warning gate reported one remaining warning class — `[DEP0005] Buffer()` from `compress-commons` at module load, reached through `archiver` 2.1.1 — where the baseline emitted four. The decision it was waiting on was taken, `archiver` moved to 6.0.2, and the application now boots under `node --pending-deprecation --trace-deprecation` emitting **no deprecation line at all**. The breadth behind that figure is a 466-request sweep across all 233 routes under two identities, plus the export-worker run, rather than the earlier GET-only pass; what a per-branch sweep would add is recorded under **Not yet proven**.

### Developer experience

- The test suite executes again, and it is green: **234 passing, 0 failing, exit 0**. Seven harness wiring defects that killed `npm test` during file collection are repaired, and the suite provisions its own MongoDB, so it needs neither a preinstalled database nor Docker. The 124 existing assertions are carried through unweakened, with only stub syntax changed for the maintained `sinon`, and the run asserts its own total mechanically — registered, executed and passing must all equal the expected count, so an uninvoked spec file or a suppressed `before all` hook fails the run instead of quietly lowering the tally. The 234 is 124 baseline bodies, all active, plus 6 new page-surface cases, plus 104 cases two conversion-driven sections required: 21 legacy-URL and `mime`-mapping cases, and 59 plus 24 behaviour-port cases that hold `validator` 5.7.0's `isEmail` and `diff` 1.0.8's `applyPatch` semantics while both packages move for high advisories.
- New `npm run fetch-components` performs a digest-verified, idempotent and atomic retrieval of the frontend component bundle, replacing a documented-but-nonexistent `setup-vendor` script and an unverified inline `curl` in the Dockerfile. It is wired ahead of `npm run build`, so `npm ci && npm run build` succeeds on a clean tree, writing both stylesheets — measured, along with the clean image build that carries and serves them, in [docs/baseline-parity.md](docs/baseline-parity.md) §5.2. Under `docker compose up` the stylesheets come from the mounted checkout rather than from the image, so the CSS build is a documented step there; `GETTING_STARTED.md` covers it.

### Delivery

- The frozen plan for this entry is **88 file operations: 51 updates, 34 creations and 3 deletions**.
- The delivered tree differs from base commit `2f8712a` at **113 tracked paths: 56 modified, 54 added and 3 removed**. The three removals are exactly the three the plan names — `lib/auth/passport.js`, `test/helpers/catbox-redis.js` and `test/helpers/queue.js`. The additions run ahead of the plan's 34 because the conversion required test and evidence files the frozen set did not enumerate: 33 under `test/parity/`, the two behaviour-port modules `lib/util/diff-compat.js` and `lib/util/email-compat.js` with a spec file each, the four `serverside/*/manager` lockfiles, and the six documents this entry links.
- Four of the 51 updates produce no tracked path, by design: the `serverside/{java,pygame,python,r}/manager/package.json` manifests are **validation obligations rather than content changes**. Runtime pinning for those four units lives in their `Dockerfile`, so what is asked of the manifests is that each one resolves and each unit boots on Node 22, which all four do with the manifests byte-identical to baseline. The regeneration they are paired with is the four **new** manager lockfiles, counted among the creations; the baseline tree carried none.
- **One path sits outside that authorized operation set**: `test/parity/joi-baseline.json.provenance.json`, a provenance sidecar beside the Joi baseline artifact that the plan did not declare, and that the Joi gate verifies the artifact against before it compares. It is named here so the ledger accounts for it explicitly rather than passing over it in silence. `test/helpers/db.js`, which an earlier revision of this ledger also named, is **byte-identical to base commit `2f8712a`** in the delivered tree and is therefore not a path of this entry at all.
- The parity method, the gate register and the R-f resolution log against `2f8712a` are in [docs/baseline-parity.md](docs/baseline-parity.md).

### Not yet proven

Every item below is a gate this migration defined, with its measured state. Nothing here is an
undecided question: the two decisions this section used to be waiting on — what to do about
`archiver`, and whether the class of newly answering edges was authorized — are both settled under
**Behaviour** above. [docs/baseline-parity.md](docs/baseline-parity.md) carries the register, the
reason and the command for each.

- **Passing, measured**: the per-entry route manifest over all 233 routes — the primary parity gate,
  0 differing fields — and the route-table CLI across its three invocation forms, byte-identical to
  the baseline capture. The `joi` matrix over all 102 validation targets, 462 outcomes with 0
  differences. The storage and archive contract, 35 of 35 cases. The export worker, every check
  passing over 7 jobs driven on real `bull` 4.16.5. `npm test`, 234 passing and 0 failing. The
  zero-deprecation-warning boot, with no warning line under either flag. Four of the five
  `npm run verify:*` gates exit 0.
- **Run, with one stated precondition**: the baseline response corpus **is captured** — 383 scenarios
  covering all 233 routes, 383 recorded responses, 394 recorded steps — and `npm run verify:corpus`
  still exits 2, because that artifact's provenance names a generator this repository cannot retrieve:
  it was written by the capture tool as that tool stood before this delivery rewrote it. Closing the
  gate needs a re-capture through the delivered generator, which one pass cannot produce for reasons
  the corpus's own notes record. **The pair is proven in miniature**: a re-captured segment replays
  with 8 of 8 scenarios driven in both cookie passes, 0 differences, both provenance chains verified,
  and the approved deviation materialized and verified field by field.
- **No longer blocked**: the export worker completes an archive on the delivered stack. An earlier
  revision recorded it as unable to, its archive path calling a `Query.stream()` this Mongoose line no
  longer provides. The worker gate now drives a real bulk export end to end — 6 trinkets processed,
  `status` moving `processing` to `completed`, a download URL persisted, the job removed on
  completion — alongside a deliberately failing job that exercises the failure persistence.
- **Not closed, and it is a checklist rather than a defect**: the per-site conversion inventory closes
  **266 of its 382 rows**. Every function row is closed — 145 routed handlers bar one held open
  deliberately, 8 routed pre-handlers, 1 inline pre-handler — and the open remainder is the site kinds
  whose closure is behavioural rather than textual: 52 callback boundaries, 9 reply chains, 17 stream
  sites and 34 promise chains, each waiting on the replay above rather than on an edit.
- **Partly measured**: the deprecation sweep covered all 233 routes under two identities across 466
  requests, which exercises each handler's entry and dominant branch rather than every branch within
  it; the cookie-attribute comparison in both overlay passes, and the four auth-scheme outcomes other
  than the fault-injected one, depend on the corpus replay above; and the secure cookie pass asserts a
  derived differential until a secure-side corpus is captured. The changed-error-edge inventory
  accounts for 342 of 342 baseline rows and 332 of 332 target rows and closes 245 of them, with the
  rest reached only by the failure-path replay.

## [1.0.0] - Initial Open Source Release

First public release of Trinket.
