# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased] - Node 22 LTS and hapi 21 migration

Runs the application on Node 22 LTS against the real `@hapi/hapi` 21.x API. Behaviour was preserved deliberately, and part of that preservation is gate-backed rather than intended: the route surface is compared entry by entry over all 233 routes, the validation outcomes over all 102 targets, the storage and worker contracts case by case, the boot under `node --pending-deprecation --trace-deprecation` emits one deprecation line, the retained `archiver` 2.1.1's `[DEP0005]`, and the suite registers its full authorized case contract though not every case in it executes or passes — each measured on the delivered tree after `npm ci` from the committed lockfile, because what the gates measure is the installed graph. Of the five `npm run verify:*` gates, the one measured to exit 0 is `verify:routes`. The rest is stated as what it is rather than folded into that: the corpus replay now **runs** on both cookie passes and does not pass — `npm run verify:corpus` exits 1, comparing 367 of 391 driven scenarios as matches against the baseline recording with 23 differences, every one of them attributable to a security remediation this delivery carries, to the baseline application's own mid-capture death, or to the asset build the baseline tree cannot perform; the storage gate fails 5 checks and the export worker gate 17 of 110, the storage and boot failures being the retained-dependency shortfall this delivery is not authorized to remedy and the worker failures the restored `q`/Mongoose bridges recorded under **Dependencies**; the `joi` gate drives all 102 validation targets and reports 60 differing outcomes, all of them the same security remediations; per-path conversion closure is complete at 154 of 154, with 29 site-level rows open because closing them is a measurement rather than a reading; the container and image results were measured at an earlier commit whose image inputs have since changed, so they are recorded rather than re-authenticated here; the suite registers the full 130-case contract the frozen plan set and executes 129 of them, of which 95 pass and 36 fail; and the delivered tree changes 27 paths that plan does not declare. **Not yet proven** at the end of this entry records the gates one by one, **Delivery** carries the path census, and the two approved deviations from preservation are named under **Behaviour**.

### Runtime

- Node 16/18 to **Node 22 LTS**. `package.json` now declares `engines: {"node": ">=22.0.0 <23.0.0", "npm": ">=10.0.0 <11.0.0"}`, and a new `.nvmrc` contains `22`. These bound the majors and float within them, which is what an LTS line taking security patches should do; they are not a reproducibility mechanism. Exact reproducibility is carried by the committed `package-lock.json`, the digest-pinned container image and the exact `pm2` pin.
- All nine Node-bearing Dockerfiles move to Node 22: the root image plus eight under `serverside/**`. The tenth, nginx, carries no Node. The pins sit in the files themselves — the root image on a digest-pinned `node:22-bookworm`, the four managers on `node:22-alpine` or `node:22-slim`, the three shells on `NODE_VERSION 22.23.2`, the pygame worker on NodeSource `setup_22.x` — and the root image installs with `npm ci` instead of `npm install --legacy-peer-deps` and now builds the CSS artifacts it serves, running `node scripts/fetch-components.js`, then `npm ci`, then `npm run build:css`; it previously fetched components and installed dependencies but built neither stylesheet, so a container built from it served no CSS at all. Those are properties of the delivered files, checkable by reading them. The build and boot results are not: the nine `docker build --no-cache` runs, the eight serverside unit boots and the root image run were measured at **evidence commit `0716cd2`** and are recorded per image in [docs/baseline-parity.md](docs/baseline-parity.md) §5.2, and the inputs those builds consume moved afterwards — `git diff --name-only 0716cd2 HEAD -- . ':!docs'` reports 84 changed paths, among them the root `Dockerfile`, five of the eight `serverside/**` Dockerfiles, `.dockerignore`, `package.json`, `package-lock.json` and `scripts/fetch-components.js`. Those results are therefore a recorded measurement of an earlier tree rather than a re-authenticated result for this delivery, and the eight `serverside/**` images and the four manager boots are not re-proven here.

### Framework

- `@hapi/hapi` **20.3.0 to 21.4.10**, with the plugins current.
- The **154 functions hapi invokes** (145 routed handlers, 8 routed pre-handlers and 1 inline pre-handler) moved off the callback idiom onto the framework's lifecycle signature: every one of them now takes `(request, h)`, and responses are returned through the toolkit rather than signalled out of band into the compatibility layer. Most are declared `async`; the rest are plain functions returning a value or a promise, which the contract satisfies equally — among them the two Google handlers in `lib/controllers/auth.js` and the pre-handlers that resolve synchronously. The five functions that are defined but bound to no route keep their old signature, which is the scope this migration set. **The signature move covers all 154 functions hapi invokes, and per-path closure is complete at 154 of 154**: the conversion checklist in [docs/conversion-inventory.md](docs/conversion-inventory.md), regenerated from the delivered tree and re-verified with `--check`, records **145 of 145 routed handlers, 8 of 8 routed pre-handlers and the 1 inline pre-handler with a proven exit on every path**, together with the 188 promise chains and callback boundaries inside them. `reply(` call sites fall from **202 to 6**, and all 6 are inside the three pre-handlers no route binds, each behind a `return`. The checklist closes **350 of its 379 rows**, and the 29 that stay open are exactly the rows whose target IS a measurement — 9 reply chains, 18 stream sites and 2 dead pre-handler redirect branches — which no reading of source can close. `trinket.js` `updateMetrics`, which an earlier revision recorded as a routed handler held open, is closed on the delivered tree: it delivers on every path, with 1 of its 2 signalling calls discarded and none left unreturned.
- The response-emulation compatibility layer in `lib/util/routeParser.js` is **removed**. The route DSL, the 233 registered routes, the hand-rolled validation path, all three error funnels, the missing-controller fallback and the per-request debug logging are carried over unchanged in the code; that the route surface itself did not move is **measured**, by the per-entry route-manifest comparison; the validation *outcomes* are measured too, across all 102 targets. The error-mapping outcomes are **inventoried statically, edge by edge, and not driven**: the inventory compares each edge's disposition as the two trees are written, and the comparison that drives a request into each edge has not run — it waits on the corpus replay named at the end of this entry.
- `lib/auth/passport.js` deleted: 136 unreachable lines whose only binding was an unused `require` in `app.js`.

### Dependencies

- Blocking-only replacements, notably `joi` 18.2.5, `bull` 4.16.5, `mime` 4.1.0, `js-yaml` 4.3.2, `jsonwebtoken` 9.0.2, `bcrypt` 6.0.0 and `nodemailer` 9.1.0. Every replaced or major-bumped package is recorded with its reason and resolved version in [docs/dependency-inventory.md](docs/dependency-inventory.md).
- **19 production and 4 development declarations removed** for having no live consumer in retained source, including all four `passport` packages, `request`, `optimist`, `mkdirp`, `rimraf` and `node-uuid`.
- Unmaintained packages that carry no critical or high advisory are **deliberately left in place** rather than modernized: `aws-sdk` v2, `mongoose` 6, `mongoose-schema-extend`, `highlight.js` 9, `jszip`, `q` and `config`, each with its reasoning in [docs/deferred-dependencies.md](docs/deferred-dependencies.md), which triages them by advisory. Retention is a deferral, not a clean bill of health.
- **`archiver` is retained at 2.1.1**, the frozen disposition, declared `^2.0.0` exactly as at the base commit — and it is the one retained package that is **not** warning-free. It emits a single `[DEP0005] Buffer()` at module load, from `compress-commons` 1.2.2, and its 2.x writer declares `crc32` 0 and uncompressed size 0 for every deflated entry in the local header, the data descriptor and the central directory alike, so the application's own `adm-zip` 0.6.0 cannot read an export archive back through `getData()`. That second defect is **pre-existing at base commit `2f8712a`** and the fields it corrupts are persisted archive bytes, so correcting it is a change to stored output rather than a fix this migration may make. Both are carried as **unresolved shortfalls**, not as approved deviations; the measurement, the three remedies tested, and the separately approved follow-up that would close them are in [docs/deferred-dependencies.md](docs/deferred-dependencies.md) §2.6.

### Behaviour

- **Verified unchanged**: route paths, methods and per-route auth, compared entry by entry against base commit `2f8712a` by the route-manifest gate over all 233 routes, together with the route-table CLI output.
- **Verified unchanged where it is a validation question, and moved only by authorization**: the `joi` matrix drives all **102** validation targets — 306 cases, 462 outcomes and 15 678 compared fields, in both `Accept` modes — and reports **0 schema-level differences** and **0 proof mismatches across all 462 outcomes**, so accept, reject and coercion parity through the `joi` 17 → 18 move is intact and `describe()` parity differs on nothing. **60 differences are reported, and none of them is a validation verdict**: 53 are HTTP drives that the new authorization guards refuse *before* validation is reached — `authBlocked` moving `false` → `true`, with 200 or 500 becoming 403 and the body becoming a Boom payload — and the remaining 7 are the summary and generated-input consequences of those refusals. They are the remediations named under **Security** below, not framework drift. Also compared, and unchanged: persisted data and file formats, whose exact sha1 object key is asserted against seeded **pre-migration** objects rather than only against freshly written ones, since a write-then-read round trip passes under any digest. That second claim carries one exception: the export archive's own bytes are **not** baseline-identical, because the archive writer moved with the `archiver` disposition recorded under **Dependencies** above. The object keys, the persisted records and the archive's internal entry layout are what carry over unchanged; the byte stream the writer emits does not.
- **Captured, replayed and compared**: rendered pages, asset URLs, cookie attributes and login-flow outcomes. The baseline is **392 scenarios covering all 233 routes**, each with a response recorded from base commit `2f8712a`, and the replay drives 391 of them against the delivered tree in both cookie modes: **367 match** and 23 differ in the non-secure pass, 355 match and 35 differ in the secure one. Rendered text, form and input names, `id` and `class` attributes, inline-script digests and `href`/`src` values compare as matches wherever the page is reached, and every difference is accounted for individually in [docs/baseline-parity.md](docs/baseline-parity.md): the security remediations under **Security** below, four scenarios whose baseline recording is a transport failure because the baseline application died mid-capture, and two asset paths the baseline cannot serve because it cannot build a stylesheet. The secure pass carries 12 further cookie-emission differences that are **not** measurements — with no secure-mode baseline recording to compare against, the tool derives the expectation it then reports, and says so. One class is flagged rather than left implicit: the error-edge inventory's static comparison marks **8** rows as answering where the baseline answered nothing, of which **5** sit inside `trinketByOwnerAndSlug`, a pre-handler no route binds and therefore unreachable in the delivered application, and **3** are pre-handler error branches that now reach the `onPreResponse` funnel as a 404 or a 500. No decision authorizing those three has been recorded, and the replay is what establishes whether they are reachable at all. [docs/preserved-quirks.md](docs/preserved-quirks.md) catalogues the 2013-era quirks that were preserved and documented rather than fixed, and [docs/baseline-parity.md](docs/baseline-parity.md) carries the parity method, the gate register and the resolution log against base commit `2f8712a`.
- Two **approved deviations** from that preservation, each recorded with its reasoning rather than presented as a fix:
  - The image-download branch of `lib/controllers/files.js` never settled, so that request hung. It now serves the stream response its sibling branch already produced, without the `Content-Disposition` header that branch adds. An unsettled request is not behaviour a client can depend on, and every route is required to serve. **Measured on both sides**: the corpus records the baseline step as an expected timeout, a replay of the delivered tree records the same step answering, and the run classifies it an approved deviation verified field by field — the single differing field being `outcome: "timed-out" -> "answered"` — while the four header-resolved chains in the same run compare as matches.
  - The private `marked` fork is **retained** despite a high ReDoS advisory, because every replacement tested changes rendered output and emits a deprecation notice on every parse. `npm audit --omit=dev` therefore reports **0 critical, 1 high and 6 moderate** findings rather than a clean pass — the high being direct `marked`, the moderates `aws-sdk`, `bull`, `highlight.js`, `jszip`, `mongoose` and transitive `uuid` — with the single high named and attributed in [docs/deferred-dependencies.md](docs/deferred-dependencies.md).
- A further **shortfall was found by measurement and is carried, not closed**: the zero-deprecation-warning gate reports one remaining warning class — `[DEP0005] Buffer()` from `compress-commons` at module load, reached through the retained `archiver` 2.1.1 — where the baseline emitted four. The decision it awaits is a dependency decision the frozen plan withdrew, so it is not taken here and no deviation status is granted to it; it is therefore **not** among the resolved items above and is recorded with its measured state under **Not yet proven** below. The breadth behind the four-to-one figure is a 466-request sweep across all 233 routes under two identities, plus the export-worker run, rather than the earlier GET-only pass; what a per-branch sweep would add is also recorded under **Not yet proven**.

### Security

The whole-tree security review of this migration found defects that pre-date it, and they were
remediated here rather than carried forward. Every item below therefore **changes observable
behaviour**, which the frozen plan prohibits (R-d) outside the two deviations its §0.7 grants. None of
these is one of those two. They are recorded as **escalated for authorization, not self-approved** —
the reasoning at each site follows §0.7's own precedent, that R-d protects behaviour a *legitimate*
client may depend on, and a cross-tenant read, a guessable transferable credential, a disclosed
address or a process death is not that. **Authorize them or name the ones to reverse**; the per-finding
argument, the measurement behind it and the alternative considered are recorded at each site in source
and in [docs/preserved-quirks.md](docs/preserved-quirks.md).

- **Account enumeration and credential guessing.** Every failing login branch now returns one message
  instead of four that named the account's state, both password-reset outcomes return one message
  unified toward the redirect, failing branches spend equal `bcrypt` time, and attempts are throttled
  per identifier, per resolved account and per source address. Measured in the corpus replay:
  `POST /login` answers `Invalid email or password.` where the baseline answered `Invalid password`,
  and `POST /send-pass-reset` answers 302 to `/forgot-pass` with a message that does not disclose
  whether the address exists, where the baseline answered 200 with none.
- **Reset and activation tokens.** Token expiry is unconditional rather than opt-out, consumption is a
  compare-and-delete whose verdict is the authorization, and the TTL is written with the value. One
  half is deliberately **not** done and is escalated as irreconcilable: the token is not hashed at
  rest, because an existing assertion reads it back verbatim and §0.9.2 forbids changing assertions.
- **Cross-tenant authorization on courses, classes, trinkets and files.** Unauthorized callers are
  refused where they were previously served: measured, the four material routes
  (`acceptSubmission`, `feedback`, `startAssignment`, `submissions`) answer 403 where the baseline
  answered 200, `DELETE /api/courses/{courseId}/invitations/{invitationId}` answers 404 where it
  answered 500, and `POST /api/trinkets/{trinketId}/grant` answers 200 where an authorization test
  wrongly refused the owner. Invitation links are no longer redeemable by a non-invitee and expire
  after 30 days, and their tokens carry 32 hex characters of entropy instead of 8. **Authorized paths
  are unchanged**, which the 367 matching corpus scenarios and the identical 233-entry route manifest
  are the evidence for.
- **Disclosure in responses, logs and mail.** Secrets echoed back through the validation flash are
  redacted — measured on `GET /reset-pass`, `POST /save-pass` and `POST /activate-account`, whose
  `key`, `password` and `password_verify` values now read `[redacted]` — an author's address is no
  longer emitted in comment payloads, an unauthenticated caller no longer obtains an email address
  from `GET /api/users/{userId}/info`, and the administrator alert mail carries a server-derived
  identity with entries capped and fields truncated instead of the raw session and payload.
- **Redirect and archive handling.** The shared `redirect()` helper refuses non-`http(s)` schemes,
  userinfo authorities and salvaged multi-slash authorities, honours a configured allowlist and logs
  cross-origin targets, with legitimate targets — including the avatar route's
  302 to `/img/avatar-default.svg` — unaffected. Archive expansion is bounded, so a malformed upload
  can no longer exhaust the heap, and the draft and autosave paths no longer terminate the process;
  one input class changes observably, a *valid* archive above the cap, which is now refused. Upload
  temporary files are removed on the paths that previously leaked them.

### Developer experience

- The test suite executes again, against the case contract this migration authorized: **130 cases — the 124 baseline `it()` bodies plus 6 new page-surface cases**. Seven harness wiring defects that killed `npm test` during file collection are repaired, and the suite provisions its own MongoDB, so it needs neither a preinstalled database nor Docker. The 124 existing assertions are carried through unweakened, with only stub syntax changed for the maintained `sinon`, and the run asserts that contract mechanically — the number of cases registered, the number executed and the number passing must all equal 130, so an uninvoked spec file or a suppressed `before all` hook fails the run instead of quietly lowering the tally. **The suite does not pass in full: it registers all 130, executes 129, and 95 pass with 36 failing.** The shortfall has two causes and neither is the framework or runtime move. **27** are baseline bodies asserting expectations that production code this migration leaves byte-identical to `2f8712a` has never satisfied — `test/lib/models/trinket.js` expects a short code truncated to 10 characters where `lib/models/trinket.js` cuts 12; the roles plugin expects `hasRole('trinket-code')` where `lib/models/user.js` grants only the `user` role on first save; the unauthenticated `/api/` cases expect a 302 to `/login` where `app.js` classifies an `/api/` path as an API request and answers its 401 as JSON — so they fail on the delivered tree, and making them pass would mean the behaviour change this migration prohibits. The other **9** share a single cause: the API client the suite drives sends the base commit's own `?outline=yes` for a parameter the route validates as a boolean, so the request is answered with a validation flash and no `data`, one `before all` hook is left without the course it was to create — which is why 129 of the 130 execute — and the cases depending on it throw. Both the client value and the spec bodies are held byte-identical to `2f8712a` deliberately, so closing this needs a decision about which of the two to move rather than a repair. That this suite has never had a green baseline is itself recorded in the plan: it died during file collection at `2f8712a`, so the "124 passing" figure was inferred from the registration count and never measured.
- New `npm run fetch-components` performs a digest-verified, idempotent and atomic retrieval of the frontend component bundle, replacing a documented-but-nonexistent `setup-vendor` script and an unverified inline `curl` in the Dockerfile. It is wired ahead of `npm run build`, so `npm ci && npm run build` succeeds on a clean tree, writing both stylesheets — **measured on the delivered tree**: exit 0, the bundle fetched and its SHA-256 verified, `public/css/base.css` at 265 727 bytes and `public/css/embed.css` at 296 352 bytes, with several hundred Sass deprecation notices from the vendored Foundation tree on the way, and a second `npm run fetch-components` exiting 0 in under a second by verifying the installed tree against the recorded manifest instead of downloading it. The image half — a container that carries and serves those two files — is the per-image result recorded at evidence commit `0716cd2` in [docs/baseline-parity.md](docs/baseline-parity.md) §5.2, with the standing under **Runtime** above. Under `docker compose up` the stylesheets come from the mounted checkout rather than from the image, so the CSS build is a documented step there; `GETTING_STARTED.md` covers it.

### Delivery

- The frozen plan for this entry is **88 file operations: 51 updates, 34 creations and 3 deletions**.
- The delivered tree differs from base commit `2f8712a` at **114 tracked paths: 67 modified, 44 added
  and 3 removed**. The plan's 88 operations name **87 distinct paths**, and **every one of the 87 is
  delivered** — nothing the plan asks for is missing, and the 3 removals are exactly the three it names,
  `lib/auth/passport.js`, `test/helpers/catbox-redis.js` and `test/helpers/queue.js`. The remaining
  **27 paths exceed the plan's enumeration**, and rather than being summarized they are grouped and
  counted here, because a path the plan does not declare is the thing a reviewer most needs pointed
  out.
- **8 paths carry the security remediation into files the plan expected to leave untouched**:
  `config/log.js`, `lib/models/user.js`, `lib/models/export.js`, `lib/util/file.js`,
  `lib/util/store.js`, and the three test files that cover them — `test/helpers/store.js`,
  `test/lib/api/course.js` and `test/lib/models/plugins/paginate.js`. These are the sites of the
  findings recorded under **Security** above; five of them were byte-identical to `2f8712a` before that
  work, which is the honest way to describe the cost of it. The plan's §0.9.2 gate had already made
  `lib/util/file.js` and `lib/util/store.js` conditionally in scope.
- **16 paths are container and runtime pinning beyond the four manager manifests the plan enumerates**:
  `scripts/pm2/package.json` and its lockfile, which turn the plan's "exact `pm2` patch" from a
  Dockerfile string into a resolved, lockfile-backed pin; `serverside/docker-compose.yml` and
  `serverside/nginx/nginx.conf`; `serverside/pygame/manager/manager.js`,
  `serverside/pygame/worker/entrypoint.sh` and the three
  `serverside/pygame/worker/supervisor/*.conf` files; and the Node units inside the shell and worker
  images that the plan's Dockerfile rows imply without naming —
  `serverside/{java,python,r}/shell/trinket/package.json` with their three lockfiles, plus
  `serverside/pygame/worker/trinket/package-lock.json`. All of them follow from R-b's unqualified
  prohibition on a container pinned to an old runtime.
- **3 paths are parity-harness files the plan's scope section implies but its table does not list**:
  `test/parity/fixtures/model.js`, the fourth of the four fixture modules and the model-layer fault
  injector without which the auth scheme's lookup-error outcome cannot be driven from any HTTP
  request; `test/parity/warning-policy.js`, the one zero-warning policy the gate tools read rather
  than each restate; and `test/parity/corpus.json.provenance.json`, the corpus provenance sidecar its
  gate verifies before it compares. Every other parity artifact is written where `--out` points it
  rather than committed, and `test/helpers/db.js`, which an earlier revision of this ledger named, is
  **byte-identical to base commit `2f8712a`**.
- The four `serverside/{java,pygame,python,r}/manager/package.json` manifests **are** modified, not
  merely revalidated: each pins `file-type` to a maintained major. An earlier revision of this ledger
  described them as byte-identical validation obligations, which the delivered tree contradicts. Their
  four lockfiles are new; the baseline tree carried none.
- The parity method, the gate register and the R-f resolution log against `2f8712a` are in [docs/baseline-parity.md](docs/baseline-parity.md).

### Not yet proven

Every item below is a gate this migration defined, with its measured state. Nothing here is an
undecided **question**, but one item is an open **shortfall**: the *disposition* of `archiver` is
settled — it is retained at 2.1.1, the frozen version, as recorded under **Dependencies** above — and
what stays open is what that retention carries, namely the boot warning check and a failing check
inside each of three `verify:*` gates, because every remedy measured is a change this delivery is not
authorized to make. The
other decision this section used to be waiting on, whether the class of newly answering edges was
authorized, is settled under **Behaviour** above.
[docs/baseline-parity.md](docs/baseline-parity.md) carries the register, the reason and the command
for each.

- **Passing, measured — each gate run individually on the delivered tree after `npm ci` from the
  committed lockfile, because what these gates measure is the installed dependency graph**: the per-entry route manifest over all 233 routes — the primary parity gate,
  0 differing fields — and the route-table CLI across its three invocation forms, byte-identical to
  the baseline capture. `npm test` registers its full 130-case contract and executes 129 of
  them. Of the five `npm run verify:*` gates, the one measured to exit 0 is `verify:routes`; the other
  four — `verify:joi`, `verify:storage`, `verify:worker` and `verify:corpus` — do not, each for the
  reason stated in the items below.
- **Measured clean on the question it exists to answer, and still exiting non-zero**: the `joi` matrix
  drives all 102 validation targets over 306 cases and 462 outcomes and reports **0 schema-level
  differences** and **0 proof mismatches over all 462 outcomes** — accept, reject and coercion parity
  across the `joi` 17.13.3 → 18.2.5 move is intact, and `describe()` parity differs on nothing — but
  `npm run verify:joi` exits 1. **Not one of its 60 differences is a validation verdict.** 53 are HTTP
  drives the new authorization guards refuse before validation runs, which the matrix records as
  `authBlocked` moving `false` → `true` with the status becoming 403 and the body becoming a Boom
  payload; 4 are the summary counters those refusals move, and 3 are generated-input consequences of
  the same. They belong to the remediations under **Security**, and the decision they need is the
  authorization recorded there, not a validation repair. The gate additionally fails the retained-
  `archiver` `[DEP0005]` warning check, the same shortfall as below, and recorded two 20-second
  timeouts on `POST /api/users/email`.
- **Storage: failing one case, and the case is the retained dependency**: the storage and archive
  contract closes **34 of 35** cases and `npm run verify:storage` exits 1. The one failing case is
  `archive-layout`, and its cause is recorded rather than inferred: the archive that this
  repository's own `archiver` 2.1.1 produces cannot be read back by the `adm-zip` 0.6.0 the
  application reads archives with, because `crc32-stream` 2.0.0 writes `crc32` 0 and uncompressed
  size 0 into the local header, the data descriptor and the central directory alike. The gate reports
  five failures in total — that case, one captured `[DEP0005]`, two warning-gate entries and one
  finding — all of them the same retained-`archiver` shortfall recorded under **Dependencies**, and
  all of them pre-existing at base commit `2f8712a`.
- **Export worker: failing 17 checks, and this is the delivery's largest open shortfall**: the worker
  gate drives 7 real jobs on `bull` 4.16.5 against an isolated queue namespace and **92 of its 109
  checks pass, with 17 failing and a verdict of FAIL**. An earlier revision of this ledger recorded
  the worker as *no longer blocked* and completing an archive end to end; **the delivered tree does not
  do that, and the gate's own first failing check says so** — "the worker's database idiom can complete
  an export" fails. The failures are coherent rather than scattered: the success job does not reach
  `completed`, so the status sequence, the progress updates, the trinket count, the `s3Key` and
  `downloadUrl` strings, the `expiresAt` horizon, the uploaded object, the asset fetch from the
  `userassets` bucket, the archive layout and the single `export-ready` mail all fail together; the
  `missing-user` job reports a different message than the lookup throws; and the late-failure job's
  dereference, its upload-before-throw ordering and its failure mail fail with it. The cause is the
  disposition recorded under **Dependencies**: the `q`-mediated query bridges and the `Query.stream()`
  call this Mongoose line no longer provides were **deliberately restored** to their base-commit form
  rather than modernized, which is preservation working against the worker's ability to run. The
  seventeenth failure is the zero-warning policy, the retained-`archiver` `[DEP0005]` again. Closing
  this needs the separately approved dependency work in
  [docs/deferred-dependencies.md](docs/deferred-dependencies.md) §2.6 and §2.7 — it is not closable
  inside the preservation rules this delivery operates under. Boot under `node --pending-deprecation`
  emits **one** deprecation line, that same `[DEP0005] Buffer()`. The run additionally reports an
  unrelated, pre-existing clean-close shortfall — `nunjucks` 3.2.4 holds a `chokidar` `FSWatcher` in a
  constructor-local under `watch: true`.
- **Corpus replay: now run, on both cookie passes, and failing**: the baseline response corpus is
  captured through the **delivered** generator at base commit `2f8712a` — **392 scenarios, 404
  recorded steps, all 233 routes represented**, with the capture's provenance verified against the
  generator blob and the commit containing it — and `npm run verify:corpus` drives 391 of them against
  the delivered tree twice. **367 match and 23 differ in the non-secure pass; 355 match and 35 differ
  in the secure one.** Every one of the 23 is accounted for individually: the remediations under
  **Security**, four scenarios whose baseline recording is a transport failure because the baseline
  application itself died mid-capture at `POST /api/admin/user/{userId}`, and two asset paths the
  baseline cannot serve because it cannot build a stylesheet. The 12 additional secure-pass
  differences are one shape — a session cookie present in the recording and absent in the run — and
  are **not measurements**: with no secure-mode baseline recording to compare against, the tool
  derives the expectation it then reports, and declares that itself. The gate's non-qualification is
  therefore structural, not a comparison result: it needs a corpus captured against a secure server,
  worker warning evidence gathered inside the same exercise, and the auth-outcome check to pass. **The
  approved deviation is materialized and verified in both passes**, its single differing field being
  `outcome: "timed-out" -> "answered"`.
- **Open only where closure is a measurement, not a reading**: the per-site conversion inventory,
  regenerated from the delivered tree and re-verified with `--check`, closes **350 of its 379 rows**.
  **The conversion set is complete — 154 of 154**: all 145 routed handlers, all 8 routed pre-handlers
  and the inline pre-handler carry a proven exit on every path, and the 188 sites inside them (142
  promise chains and 46 callback boundaries) are closed too. An earlier revision recorded 266 of 382
  with one routed handler held open; the delivered tree closes it. What remains open is **29 rows whose
  target IS a measurement** — the 9 reply chains, whose outcome depended on which builder method ran
  last, the 18 stream sites, where whether a stream still errors after the response has begun is a
  timing question, and 2 dead pre-handler redirect branches. Reading source cannot close any of them;
  only a driven comparison can, and the replay artifact this run linked is non-qualifying, so it
  closes none.
- **Partly measured**: the deprecation sweep covered all 233 routes under two identities across 466
  requests, which exercises each handler's entry and dominant branch rather than every branch within
  it — and it was measured at evidence commit `0716cd2`, not re-run here; what this tree re-measured
  is the boot under both flags, and the one notice each the worker and storage gates now capture —
  the retained-`archiver` `[DEP0005]` in both cases. The cookie-attribute comparison has now run in
  the non-secure overlay pass and compares as matches there; the secure pass still asserts a derived
  differential until a secure-side corpus is captured, and the auth-outcome check fails on the
  fault-injected outcome, both recorded above. The changed-error-edge inventory, regenerated against a
  baseline worktree so that every row is joined to the row measuring the same edge on the other tree,
  accounts for **342 of 342 baseline rows and 373 of 373 target rows** and **closes 293 of its 402
  rows**; **90** are open and **19** carry no mapping either tree can be held to. Of the open rows 47
  carry a baseline edge and 67 a target edge — a row new in the target has no baseline edge, so the
  two sides have their own denominators. The open rows are listed with both outcomes side by side in
  [docs/error-edge-inventory.md](docs/error-edge-inventory.md). This entry publishes **90** as the single open
  total, which is now safe to quote: an earlier revision of that inventory stated the quantity two
  ways — a summary counting 96 unclosed baseline edges against a verdict table totalling 119 open rows
  over a wider population — and the regenerated document states one figure, with its verdict table
  partitioning those same 90 rows and `--closure-gate` counting them by the same predicate.
- **Unmet on two of its three counts**: `npm test`'s gate asserts that the cases registered, the cases
  executed and the cases passing all equal 130. The run registers 130, executes 129 and passes 95, so
  the gate is unmet by 1 on execution and 35 on passing, for the two reasons under **Developer
  experience** — 27 base-commit assertions the production code has never satisfied, and 9 failing
  cases plus 1 unexecuted case behind a single request value that the suite and its client both hold
  byte-identical to `2f8712a`.
- **Recorded at an earlier tree rather than re-authenticated here**: the container and image gate. The
  nine `docker build --no-cache` runs at exit 0, the eight serverside unit boots and the root image
  serving both stylesheets were measured at evidence commit `0716cd2` and are tabulated per image in
  [docs/baseline-parity.md](docs/baseline-parity.md) §5.2. The inputs those builds consume have moved
  since: `git diff --name-only 0716cd2 HEAD -- . ':!docs'` reports 84 changed paths, among them the
  root `Dockerfile`, five of the eight `serverside/**` Dockerfiles, `.dockerignore`, `package.json`,
  `package-lock.json` and `scripts/fetch-components.js`. So no image result here is a current-head
  one, and the eight `serverside/**` images and the four manager boots are not re-proven. What this
  tree does carry, checkable by reading the files, is the Node 22 pin in all nine Node-bearing
  Dockerfiles and the root image's `fetch-components` then `npm ci` then `build:css` sequence.

## [1.0.0] - Initial Open Source Release

First public release of Trinket.
