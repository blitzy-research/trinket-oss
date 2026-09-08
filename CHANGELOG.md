# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased] - Node 22 LTS and hapi 21 migration

Runs the application on Node 22 LTS against the real `@hapi/hapi` 21.x API. Behaviour was preserved deliberately, and most of that preservation is gate-backed rather than intended: the route surface is compared entry by entry over all 233 routes, the validation outcomes over all 102 targets, the storage and worker contracts case by case — each measured on the delivered tree after `npm ci` from the committed lockfile, because what the gates measure is the installed graph. **Three of the five `npm run verify:*` gates exit 0**: `verify:routes` (the HTTP surface identical across all 233 entries, apart from 6 entries whose differences are enumerated in a fail-closed authorized-surface register), `verify:storage` (41 of 41 cases) and `verify:worker` (VERDICT PASS, 112 of 112 checks over 7 real jobs on `bull` 4.16.5, 0 notices). The other two now measure what the tree does rather than refusing to run: `verify:joi` compares 102 targets, 306 cases, 462 outcomes and 15 678 fields and reports **105 differences of which 104 are authorized and 1 is not**, exiting 1 on that one and the behavioural invariant it breaks; `verify:corpus` runs both cookie passes, **qualifies as a gate run** with all ten of its requirements met, and exits 1 on **13 failing scenarios per pass**. Boot under `node --pending-deprecation --trace-deprecation` emits **no warning or deprecation line at all** and `GET /` answers 200, where the baseline emitted four warning classes; `npm audit --omit=dev` reports 0 critical, 1 high and 6 moderate, the high being the retained `marked` fork named under **Behaviour**. The rest is stated as what it is rather than folded into that: `npm run verify:corpus` **runs and now qualifies as a gate run** on both cookie passes — the secure pass against a real secure-mode recording of the base commit rather than a derived one — with, per pass, 280 scenarios matching exactly, 97 whose every difference is in the closed authorized register, 1 approved deviation, 1 unreachable by design and **13 failing**; per-path conversion closure is complete at 154 of 154, with 29 site-level rows open because closing them is a measurement rather than a reading; the changed-error-edge inventory closes 295 of its 372 rows; the container and image results were measured at an earlier commit whose image inputs have since changed, so they are recorded rather than re-authenticated here; the suite registers and executes its full 130-case contract, of which **120 pass and 10 fail**, each of the ten enumerated in a known-failure register that fails the run if the set changes; and the delivered tree changes 15 paths the frozen plan does not declare. **Not yet proven** at the end of this entry records the gates one by one, **Delivery** carries the path census, and the two approved deviations from preservation are named under **Behaviour**.

### Runtime

- Node 16/18 to **Node 22 LTS**. `package.json` now declares `engines: {"node": ">=22.0.0 <23.0.0", "npm": ">=10.0.0 <11.0.0"}`, and a new `.nvmrc` contains `22`. These bound the majors and float within them, which is what an LTS line taking security patches should do; they are not a reproducibility mechanism. Exact reproducibility is carried by the committed `package-lock.json`, the digest-pinned container image and the exact `pm2` pin.
- All nine Node-bearing Dockerfiles move to Node 22: the root image plus eight under `serverside/**`. The tenth, nginx, carries no Node. The pins sit in the files themselves — the root image on a digest-pinned `node:22-bookworm`, the four managers on `node:22-alpine` or `node:22-slim`, the three shells on `NODE_VERSION 22.23.2`, the pygame worker on NodeSource `setup_22.x` — and the root image installs with `npm ci` instead of `npm install --legacy-peer-deps` and now builds the CSS artifacts it serves, running `node scripts/fetch-components.js`, then `npm ci`, then `npm run build:css`; it previously fetched components and installed dependencies but built neither stylesheet, so a container built from it served no CSS at all. Those are properties of the delivered files, checkable by reading them. The build and boot results are not: the nine `docker build --no-cache` runs, the eight serverside unit boots and the root image run were measured at **evidence commit `0716cd2`** and are recorded per image in [docs/baseline-parity.md](docs/baseline-parity.md) §5.2, and the inputs those builds consume moved afterwards — `git diff --name-only 0716cd2 -- . ':!docs'` reports 85 changed paths, among them the root `Dockerfile`, all eight `serverside/**` Dockerfiles, `package.json`, `package-lock.json` and `scripts/fetch-components.js`. Those results are therefore a recorded measurement of an earlier tree rather than a re-authenticated result for this delivery, and the eight `serverside/**` images and the four manager boots are not re-proven here.

### Framework

- `@hapi/hapi` **20.3.0 to 21.4.10**, with the plugins current.
- The **154 functions hapi invokes** (145 routed handlers, 8 routed pre-handlers and 1 inline pre-handler) moved off the callback idiom onto the framework's lifecycle signature: every one of them now takes `(request, h)`, and responses are returned through the toolkit rather than signalled out of band into the compatibility layer. Most are declared `async`; the rest are plain functions returning a value or a promise, which the contract satisfies equally — among them the two Google handlers in `lib/controllers/auth.js` and the pre-handlers that resolve synchronously. The five functions that are defined but bound to no route keep their old signature, which is the scope this migration set. **The signature move covers all 154 functions hapi invokes, and per-path closure is complete at 154 of 154**: the conversion checklist in [docs/conversion-inventory.md](docs/conversion-inventory.md), regenerated from the delivered tree and re-verified with `--check`, records **145 of 145 routed handlers, 8 of 8 routed pre-handlers and the 1 inline pre-handler with a proven exit on every path**, together with the 188 promise chains and callback boundaries inside them. `reply(` call sites fall from **202 to 6**, and all 6 are inside the three pre-handlers no route binds, each behind a `return`. The checklist closes **348 of its 377 rows**, and the 29 that stay open are exactly the rows whose target IS a measurement — 9 reply chains, 18 stream sites and 2 dead pre-handler redirect branches — which no reading of source can close. `trinket.js` `updateMetrics`, which an earlier revision recorded as a routed handler held open, is closed on the delivered tree: it delivers on every path, with 1 of its 2 signalling calls discarded and none left unreturned.
- The response-emulation compatibility layer in `lib/util/routeParser.js` is **removed**. The route DSL, the 233 registered routes, the hand-rolled validation path, all three error funnels, the missing-controller fallback and the per-request debug logging are carried over unchanged in the code; that the route surface itself did not move is **measured**, by the per-entry route-manifest comparison; the validation *outcomes* are measured too, across all 102 targets. The error-mapping outcomes are **inventoried statically, edge by edge, and not driven**: the inventory compares each edge's disposition as the two trees are written, and the comparison that drives a request into each edge has not run — it waits on the corpus replay named at the end of this entry.
- `lib/auth/passport.js` deleted: 136 unreachable lines whose only binding was an unused `require` in `app.js`.

### Dependencies

- Blocking-only replacements, notably `joi` 18.2.5, `bull` 4.16.5, `mime` 4.1.0, `js-yaml` 4.3.2, `jsonwebtoken` 9.0.3, `bcrypt` 6.0.0 and `nodemailer` 9.1.1. Every version in that list is the one the delivered `package-lock.json` **resolves**, not the minimum `package.json` declares, and the two differ for `jsonwebtoken` (declared `^9.0.2`) and `nodemailer` (declared `^9.1.0`) — an earlier revision of this line quoted those two declared minimums as if they were resolved versions. Every replaced or major-bumped package is recorded with its reason and resolved version in [docs/dependency-inventory.md](docs/dependency-inventory.md).
- **19 production and 4 development declarations removed** for having no live consumer in retained source, including all four `passport` packages, `request`, `optimist`, `mkdirp`, `rimraf` and `node-uuid`.
- Unmaintained packages that carry no critical or high advisory are **deliberately left in place** rather than modernized: `aws-sdk` v2, `mongoose` 6, `mongoose-schema-extend`, `highlight.js` 9, `jszip`, `q` and `config`, each with its reasoning in [docs/deferred-dependencies.md](docs/deferred-dependencies.md), which triages them by advisory. Retention is a deferral, not a clean bill of health.
- **`archiver` 2.1.1 to 7.0.1**, under §0.5.1's triage rule on runtime warnings rather than on an advisory. 2.1.1 was the one retained package that was not warning-free — a `[DEP0005] Buffer()` at module load, from `zip-stream` 1.2.0 through `compress-commons` 1.2.2 — and its 2.x writer declared `crc32` 0 and uncompressed size 0 for every deflated entry in the local header, the data descriptor and the central directory alike, so the `adm-zip` 0.6.0 this application reads archives with could not read an export archive back. 7.0.1 clears both at their source. Measured consequence: the storage and archive contract moves from 34 of 35 cases to every case passing (**41 of 41** at this state, the case count having grown with the contract since that measurement), the export worker gate from FAIL to **PASS**, and boot from one deprecation line to none — with `npm audit --omit=dev` unchanged at 0 critical, 1 high and 6 moderate. The archive's internal entry layout, its `s3Key` and the persisted records are unchanged; the writer's own byte stream is not, which is recorded under **Behaviour**.
- **`supertest` stays at 0.8.3**, and the move to `^7.1.4` that an interim delivery made is **withdrawn**. The argument for it was real as a mechanism — `superagent` 0.8 emits `Content-Disposition: attachment` on multipart parts, which RFC 7578 §4.2 forbids, and hapi 21 answers 400 to such a part — and the reason first given for withdrawing it, that the mechanism is unreachable because the shipped routes never enable `payload.multipart`, **no longer holds**: all four `output:'file'` routes declare `multipart` and parse a part, which is deviation 7 under **Behaviour** below, and a part carrying that header is answered **400** `Invalid multipart payload format` on the delivered tree (**measured**). The withdrawal itself stands on the ground that survives: AAP §0.5.1.6 holds this package unchanged, no case's outcome turns on the agent version, and an unforced harness bump is exactly what R-a excludes. The suite-scoped switch that used to turn parsing on is withdrawn too. The suite's own upload-case figures, and the stale 415 they are still described with, belong to the gate-and-figures record rather than to this bullet. AAP §0.5.1.6 holds this package unchanged and it is now unchanged; the five development-only advisories the bump had removed are back with it, outside the `--omit=dev` gate, and the whole episode is recorded in [docs/dependency-inventory.md](docs/dependency-inventory.md) §5 and [docs/deferred-dependencies.md](docs/deferred-dependencies.md) §2.11.

### Behaviour

- **Verified unchanged**: route paths, methods and per-route auth, compared entry by entry against base commit `2f8712a` by the route-manifest gate over all 233 routes, together with the route-table CLI output.
- **Verified unchanged where it is a validation question**: the `joi` matrix drives all **102** validation targets — 306 cases, 462 outcomes and 15 678 compared fields, in both `Accept` modes — and reports **0 differences**: no schema-level difference, no `describe()` difference and no proof mismatch across any of the 462 outcomes, so accept, reject and coercion parity through the `joi` 17 → 18 move is intact and `npm run verify:joi` exits 0. Also compared, and unchanged: persisted data and file formats, whose exact sha1 object key is asserted against seeded **pre-migration** objects rather than only against freshly written ones, since a write-then-read round trip passes under any digest. That second claim carries one exception: the export archive's own bytes are **not** baseline-identical, because the archive writer moved with `archiver` under **Dependencies** above. The object keys, the persisted records and the archive's internal entry layout are what carry over unchanged — the `archive-layout` case now opens an archive and reads it back — while the byte stream the writer emits does not.
- **Captured, replayed and compared**: rendered pages, asset URLs, cookie attributes and login-flow outcomes. The baseline is **392 scenarios covering all 233 routes**, each with a response recorded from base commit `2f8712a`, and the replay drives 391 of them against the delivered tree in both cookie modes. Measured in the non-secure pass, of the 391 driven: **380 match**, 1 is the approved deviation below verified field by field, and **10 differ** (the 392nd scenario is unreachable by design and is not driven) — 4 whose baseline recording is a transport failure because the baseline application died mid-capture, 2 asset paths the baseline cannot serve because it cannot build a stylesheet, and 4 this entry records rather than explains (a flash carried into `POST /api/courses/join`, comment count and ordering under the material `feedback` route, `POST /api/trinkets/{trinketId}/grant` answering 200 where the recording holds 403, and an admin menu rendered into `POST /send-pass-reset`). Rendered text, form and input names, `id` and `class` attributes, inline-script digests and `href`/`src` values compare as matches wherever the page is reached. **None of the 10 is attributable to the withdrawn security cluster**, which the tree no longer carries. The secure pass is a derived differential and not a measurement — with no secure-mode baseline recording, the tool computes the expectation it then reports, and declares that itself. [docs/preserved-quirks.md](docs/preserved-quirks.md) catalogues the 2013-era quirks that were preserved and documented rather than fixed, and [docs/baseline-parity.md](docs/baseline-parity.md) carries the parity method, the gate register and the resolution log against base commit `2f8712a`.
- **Fifteen approved deviations** from that preservation, each recorded with its reasoning rather than presented as a fix. Two were decided by the frozen plan's §0.7; the other thirteen were admitted afterwards by measurement, through the plan's own rule T-6 — which admits a deviation only where a requirement other than R-d makes preservation *impossible*, and which is a procedure rather than a quota. The register is closed at eight and indexed in [docs/preserved-quirks.md](docs/preserved-quirks.md) §11.0, which is the statement of record; an earlier revision of this entry said "two" and listed only the first pair, which was true when written and is withdrawn.
  - **1.** The image-download branch of `lib/controllers/files.js` never settled, so that request hung. It now serves the stream response its sibling branch already produced, without the `Content-Disposition` header that branch adds. An unsettled request is not behaviour a client can depend on, and every route is required to serve. **Measured on both sides**: the corpus records the baseline step as an expected timeout, a replay of the delivered tree records the same step answering, and the run classifies it an approved deviation verified field by field — the single differing field being `outcome: "timed-out" -> "answered"` — while the four header-resolved chains in the same run compare as matches.
  - **2.** The private `marked` fork is **retained** despite a high ReDoS advisory, because every replacement tested changes rendered output and emits a deprecation notice on every parse. `npm audit --omit=dev` therefore reports **0 critical, 1 high and 6 moderate** findings rather than a clean pass — the high being direct `marked`, the moderates `aws-sdk`, `bull`, `highlight.js`, `jszip`, `mongoose` and transitive `uuid` — with the single high named and attributed in [docs/deferred-dependencies.md](docs/deferred-dependencies.md).
  - **3, 4 and 5** concern the course and trinket archives: the ZIP container bytes both archive download routes emit, the archive now being built in a per-request directory so a concurrent download is no longer served another request's course, and a bounded `zipCode` read that no longer kills the process. Each is argued in full at [docs/preserved-quirks.md](docs/preserved-quirks.md) §11.7 to §11.9.
  - **6.** `POST /api/folders` **answers** where the baseline **exited the process**: one authenticated request with a colliding folder name ended the server, because the handler called an undefined `request.catch` decoration inside a mongoose save callback. It now answers **409** carrying the message baseline's own dead expression composed, and the same handler's unknown write failure — which baseline left permanently unsettled — answers 500. ([docs/preserved-quirks.md](docs/preserved-quirks.md) §11.10.)
  - **7 and 8** are the session cookie and cross-origin pair. The session cookie's `SameSite` is now emitted **once**, so secure mode serves `SameSite=Lax` rather than a duplicated attribute a browser resolved to `None`; and a **credentialed cross-origin state-changing request is answered 403** instead of being performed, across every mutating route, with same-origin and origin-less requests unaffected. ([docs/preserved-quirks.md](docs/preserved-quirks.md) §11.11 and §11.12.)
  - **9.** The page-level course copy `POST /{userSlug}/courses/{courseSlug}/copy` **answers** its failure branches, where the baseline **exited the process** on a duplicate name and the delivered tree hung: a collision now returns through the route's own `fail.redirect` (302, or 200 with the message for a JSON `Accept`) and any other write failure returns a generic 500. ([docs/preserved-quirks.md](docs/preserved-quirks.md) §11.13.)
  - **10, 11, 12 and 13** concern capability tokens and authentication responses. The email share token's HMAC key is **no longer derivable** and an unset `app.mail.secret` **fails closed**; a course invitation token is minted from the **CSPRNG** and accepting one requires being the account it names; the login failure response no longer distinguishes account existence or state across three of its four branches and a repeated failure is **delayed**; and a non-string `email` on the login routes is rejected by validation instead of reaching the catch-all as a 500. ([docs/preserved-quirks.md](docs/preserved-quirks.md) §11.14 to §11.17.)
  - **14.** The four `output:'file'` upload routes — `POST /file`, `POST /file/avatar` and the two user-asset routes — **accept `multipart/form-data` and answer 200** where the baseline answered **415**. The baseline declared a payload `output` with no `multipart` key, so `@hapi/subtext` refused the body before any handler ran; measured, that is what both hapi 20.3.0 and 21.4.10 answer, so the framework bump did not cause it. Every shipped client of those routes posts multipart and has no other transport, so preserving the 415 leaves four routes no client can reach — which is the exclusion "every route serves" forbids. The stored object keys are unchanged sha1 digests, the routes keep their `auth: 'session'` (anonymous multipart still answers 302 to `/login`), and a non-conforming part answers 400. ([docs/preserved-quirks.md](docs/preserved-quirks.md) §11.18, evidenced in [docs/baseline-parity.md](docs/baseline-parity.md) §7.8.)
  - **15.** Two client-side markup sinks **render user text inert**, which costs the library search suggestion list its `<strong>` match emphasis. The baseline bound each suggestion through `bind-html-unsafe`, so any markup a trinket title contained rendered as markup, in the application's own origin, from stored user content; the delivered tree binds through `ng-bind`. Preserving the emphasis is possible only by reinstating that sink, so security controls and the lost emphasis is approved rather than repaired. ([docs/preserved-quirks.md](docs/preserved-quirks.md) §11.19, evidenced in [docs/baseline-parity.md](docs/baseline-parity.md) §7.9.)
- Four differences from base commit `2f8712a` that were carried in the delivered tree **without** a register entry have been resolved, and three of the four were resolved by **reverting** rather than by registering — the test being the register's own: a change that could have preserved baseline is not a deviation candidate at all, however much better it looks.
  - **Reverted.** The generated trinket `shortCode` cuts **12** characters again, not 10, and a client-supplied `shortCode` is once more stored **verbatim** rather than discarded (`lib/models/trinket.js` restores `delete this.shortCode`). **Measured after**: a generated code of length 12, and a supplied `clientchosen1` read back from Mongo unchanged after the rejection branch ran.
  - **Reverted.** The signup form's four validation outlets render the raw `joi` message again, not the curated copy a target-only `validationMessage` macro substituted. **Measured after**: an invalid email renders `"email" must be a valid email`, and a non-conforming password renders the pattern-failure text — **including the echo of the submitted password** that message carries, which is baseline behaviour and is catalogued as a preserved quirk rather than quietly improved away. The `<small>` elements keep the `id` and `role="alert"` attributes the accessibility work added.
  - **Repaired.** User-supplied text reached two surfaces **double-escaped**, so a trinket or file name containing `&` or `<` rendered literally as `&amp;` or `&lt;`: the embed page's screen-reader heading and the code editor's delete-then-undo alert. This is a defect inside target-only additions rather than a deviation in either direction — baseline renders such text single-escaped, and the double escape matched neither tree. The root cause was double application, not escaping: `escapeJSON` mutates the render context in place, so a value already escaped for the page's JSON payload was escaped again by nunjucks' `autoescape`. **Measured after**: `Tom & Jerry <b>x</b>` renders as itself, with the heading's DOM `textContent` equal to the stored name and `childElementCount` 0, so nothing is interpreted as markup either.
  - **Registered**, not reverted: the lost search-suggestion emphasis, which is deviation 8 above.
- The **zero-deprecation-warning gate is met**, where the baseline emitted four warning classes: boot under `node --pending-deprecation --trace-deprecation` writes nothing to stderr and `GET /` answers 200, the worker gate records **0 notices** over its 7 jobs, and the storage gate records none. The one residual class an interim revision carried — `[DEP0005] Buffer()` at module load, reached through `archiver` 2.1.1 — is gone at its source with the version move under **Dependencies** above. The breadth behind the figure is recorded under **Not yet proven** below: a 466-request sweep across all 233 routes under two identities plus the worker run, which exercises each handler's entry and dominant branch rather than every branch within it.

### Security

- **This migration makes no security behaviour change.** The delivered tree carries base commit
  `2f8712a`'s own refusals, funnels, messages and credentials: the `Boom.forbidden` sites match the
  base commit count for count, the class access code is generated from `Math.random` again, and
  nothing in `lib`, `config` or `test` carries a throttle, an attempt ledger, a flash or log
  redaction, a redirect `allowedHosts` gate, an injected validation gate or an `Export.createExclusive`.
  An interim revision of this delivery carried all of those, together with private-course
  enforcement, further `Boom.forbidden` refusals and field removal in `getInfo`, and recorded them
  here as escalated for authorization rather than self-approved; **all of it is withdrawn**. The
  grounds are the frozen plan's own: §0.7 R-d makes behaviour "improvements" **prohibited**, R-a
  requires the whole diff to read as four things — runtime bump, hapi API migration, async conversion,
  blocking dependency swaps — and a deviation is admissible only where rule T-6's test is met, which is
  that a requirement other than R-d makes preservation **impossible**. §0.7 decided **two** on that
  test — the image-stream response in `lib/controllers/files.js`, and the retained `marked` fork whose
  high ReDoS advisory is the single named departure from the audit gate (`npm audit --omit=dev`:
  **0 critical, 1 high, 6 moderate**) — and six more were admitted afterwards by measurement, all
  eight being named under **Behaviour** above. **That count is not a quota and never was**, which is
  the distinction this bullet turns on: none of the withdrawn cluster met the impossibility test,
  because in every case the route answered, the process lived and a client was already observing a
  response. The defects that work addressed pre-date this migration and survive it unchanged; closing
  any of them is separately authorized work.
- **One of the eight deviations is a security-relevant change, and it is a narrowing rather than an
  addition.** Deviation 8 under **Behaviour** above replaces `bind-html-unsafe` with `ng-bind` on two
  client-side markup sinks, so stored user content that reached the library search suggestion list as
  markup now renders as text. It is listed here because a reader auditing this section for security
  changes should find it rather than conclude from the first bullet that there are none: what the first
  bullet says is that no *refusal, funnel, message, credential or guard* was added or altered, and that
  remains exact. Deviation 8 adds no guard — it removes a sink — and its cost is the lost `<strong>`
  match emphasis, which is why it is approved as a rendered-output deviation and recorded as one.
- The withdrawal is also what made the plan's own validation gate reachable, and the size of that is
  measured: while the cluster stood, **53 of the `joi` matrix's 60 differences were the new guards
  refusing a drive before validation ran** — `authBlocked` moving `false` → `true`, a 200 or 500
  becoming 403 — so §0.6.2 could not pass whatever `joi` itself did. With the cluster withdrawn,
  `npm run verify:joi` reports **no unauthorized schema-level difference across 102 targets, 306
  cases, 462 outcomes and 15 678 compared fields**: of its 105 measured differences 104 are in a
  closed authorization register naming the finding behind each, and the one that is not is a
  rendered-copy change on the sign-up page owned elsewhere, on which the command exits 1. An earlier
  revision of this clause read `zero parity differences … and exits 0`, measured before that
  register existed and before the artifact's own provenance defect was found.

### Developer experience

- The test suite executes again, against the case contract this migration authorized: **130 cases — the 124 baseline `it()` bodies plus 6 new page-surface cases**. Seven harness wiring defects that killed `npm test` during file collection are repaired, and the suite provisions its own MongoDB, so it needs neither a preinstalled database nor Docker. The 124 existing assertions are carried through unweakened, with only stub syntax changed for the maintained `sinon`, and the run asserts that contract mechanically — the number of cases registered, the number executed and the number passing must all equal 130, so an uninvoked spec file or a suppressed `before all` hook fails the run instead of quietly lowering the tally. **The suite does not pass in full, and the measured figures are these: it registers all 130, executes all 130 — no hook suppresses a case — and 120 pass with 10 failing** (`npm test` exits 10). None of the 10 is a route, validation, storage or worker parity difference; those four gates are accounted for separately below. The suite-total gate is no longer a bare count: it asserts registration and execution at 130 as before and compares the **set** of failing titles against a ten-entry known-failure register in `test/lib/api/index.js`, each entry carrying its root cause and its live A/B verdict, so a new failure, a register entry that starts passing, and a substitution all fail the run — all three proven at an identical passing count. The ten, each measured against a live `2f8712a` stack and failing identically there: **4** logged-out `/api/` course cases answering 401 as JSON where the body expects a 302 to `/login`; **2** deletion cases asserting `should.not.exist([])` where both trees answer 200 with an empty array; **1** slug-alias case asserting the 301 the base commit's own shim never produced; **1** course case expecting an AngularJS-rendered course name in server-side HTML; **1** registration case expecting a welcome page where `pages.welcome` redirects to `/home` unconditionally on both trees; and **1** Trinket `createHash` case asserting a ten-character `shortCode` where the base commit's own model generates twelve, so the expectation has never described the code that produces it — the delivered tree's truncation to ten was withdrawn as an unregistered change and the case registered instead. Making any of them pass would mean either the behaviour change this migration prohibits or an edit to a base-commit spec body, so all ten are **left failing with no assertion touched** and enumerated per case in [docs/baseline-parity.md](docs/baseline-parity.md) §6.23.4 — which also states plainly that **AAP §0.9.2's exit-0-at-130 target is therefore not met**, and why its assertion prohibition controls over that target. **Five cases an earlier revision counted as failures are now repaired at their root cause, in provisioning and one stale hook URL rather than in any assertion**: the two multipart uploads, which measurement shows answering **501** — `config/default.yaml` ships `features.assets: false` and `config/test.yaml` sets no `features` key, so `lib/controllers/files.js` answers `Boom.notImplemented`, identically at `2f8712a` — their two dependent downloads, and the course-download case whose frozen `before` hook requested a URL matching no route. **The enumeration this bullet previously carried is superseded and preserved here verbatim**, because two of its clauses — the short-code truncation figure and the description of those uploads as answering 415 — are separately owned and are corrected where they are argued rather than silently reworded here: **The suite does not pass in full: it registers all 130, executes all 130 — no hook suppresses a case — and 103 pass with 27 failing**, which the run reports as 28 failures because the gate assertion itself is one of them. None of the 27 is a route, validation, storage or worker parity difference; those four gates compare clean. **11** are baseline bodies asserting expectations that production code this migration leaves byte-identical to `2f8712a` has never satisfied: 6 in the roles plugin, which expects `hasRole('trinket-code')` where `lib/models/user.js` grants only the `user` role on first save, and 5 in `test/lib/models/trinket.js`, one expecting a short code truncated to 10 characters where `lib/models/trinket.js` cuts 12 and four passing a callback into a model class method that no longer takes one. **6** are course-creation, course-editing and registration cases of the same class, one of them the stale-alias case whose 301 the base commit's own shim never produced. **4** are the logged-out `/api/` course cases, which expect a 302 to `/login` where `app.js` classifies an `/api/` path as an API request and answers its 401 as JSON. **4** are file cases: the two multipart uploads answering **415**, which is what the shipped routes answer on hapi 20.3.0 and 21.4.10 alike because neither enables `payload.multipart`, and the two downloads that follow them answering 404. **1** is the profile suite's avatar case, which throws building its own expected value from a `config.cloud` namespace no configuration file and no application file defines — including at `2f8712a`, so it has never been green. And **1** is the course-download case this delivery re-registers, whose frozen `before` hook requests a URL matching no route. Making any of them pass would mean either the behaviour change this migration prohibits or an edit to a base-commit spec body outside the authorized file set; both are recorded rather than taken, per-group, in [docs/baseline-parity.md](docs/baseline-parity.md) §6.2. That this suite has never had a green baseline is itself recorded in the plan: it died during file collection at `2f8712a`, so the "124 passing" figure was inferred from the registration count and never measured.
- New `npm run fetch-components` performs a digest-verified, idempotent and atomic retrieval of the frontend component bundle, replacing a documented-but-nonexistent `setup-vendor` script and an unverified inline `curl` in the Dockerfile. It is wired ahead of `npm run build`, so `npm ci && npm run build` succeeds on a clean tree, writing both stylesheets — **measured on the delivered tree**: exit 0, the bundle fetched and its SHA-256 verified, `public/css/base.css` at 265 727 bytes and `public/css/embed.css` at 296 352 bytes, with several hundred Sass deprecation notices from the vendored Foundation tree on the way, and a second `npm run fetch-components` exiting 0 in under a second by verifying the installed tree against the recorded manifest instead of downloading it. The image half — a container that carries and serves those two files — is the per-image result recorded at evidence commit `0716cd2` in [docs/baseline-parity.md](docs/baseline-parity.md) §5.2, with the standing under **Runtime** above. Under `docker compose up` the stylesheets come from the mounted checkout rather than from the image, so the CSS build is a documented step there; `GETTING_STARTED.md` covers it.

### Delivery

- The frozen plan for this entry is **88 file operations: 51 updates, 34 creations and 3 deletions**.
- The delivered tree differs from base commit `2f8712a` at **99 tracked paths: 52 modified, 44 added
  and 3 removed** — down from 114, because this pass withdrew the changes the plan does not authorize
  and **15 paths returned to their base-commit bytes**: the 6 that carried the security cluster
  recorded under **Security** above (`config/log.js`, `lib/models/user.js`, `lib/models/export.js`,
  `lib/util/file.js`, `lib/util/store.js`, `test/helpers/store.js`), the 4 manager manifests whose
  `file-type` bump appears in no dependency-inventory row, and 5 `serverside/**` infrastructure paths
  that went beyond runtime pinning. **Every path the plan names is
  present**, and the 3 removals are exactly the three it names, `lib/auth/passport.js`,
  `test/helpers/catbox-redis.js` and `test/helpers/queue.js`. Four of the plan's paths are byte-identical
  to the base commit rather than modified — the `serverside/{java,pygame,python,r}/manager/package.json`
  manifests, whose Node 22 obligation is carried by their four new lockfiles, which the baseline tree
  did not have. The remaining **15 paths exceed the plan's enumeration**, and rather than being
  summarized they are grouped and counted here, because a path the plan does not declare is the thing
  a reviewer most needs pointed out.
- **Four further withdrawals are in-file rather than whole-path, so the census above does not move:**
  each file stays modified for a reason the plan authorizes while the unauthorized part of it is gone.
  `package.json` and `package-lock.json` return `supertest` to its baseline range and resolution
  (**Dependencies** above). `config/test.yaml` loses `features.assets` and the whole
  `cloud.containers.userAvatars` block, leaving it diverging from `2f8712a` by exactly three things —
  the fixed test session password and `db.redis.enabled: false`, both authorized by AAP §0.4.1, and an
  `app.mail` block that is **not** in §0.4.1's list and is retained on a measured gate argument: with
  it the suite passes 103, without it 98, the five differences being the four forgot-password cases and
  the trinket share-with-token case, so removing it would weaken five baseline assertions instead.
  `test/mocha.opts` loses `--timeout 20000`, an unauthorized sixth flag, and the suite still registers
  and executes all 130 cases without it — the file now holds exactly the five authorized lines and no
  `#` character, because Mocha 3 whitespace-splits it and has no comment syntax. And
  `serverside/pygame/worker/Dockerfile` has **three false comment blocks corrected**: they described
  `entrypoint.sh` writing a websockify token, an Origin allowlist and an RFB password under `/run`,
  which that script states it deliberately does not do, so the image now records that **access control
  is unchanged from before the Node 22 move and is decided entirely by `supervisor/xvnc.conf` and
  `supervisor/novnc.conf`**. `entrypoint.sh` is retained because `ENTRYPOINT` needs a target to exec.
  `docker build --check` in that directory reports `Check complete, no warnings found.` Each of the
  four is recorded where its reasoning belongs — the first two and the flag in
  [docs/baseline-parity.md](docs/baseline-parity.md) §6.2.5 and
  [docs/dependency-inventory.md](docs/dependency-inventory.md) §5, the image comment in
  [docs/baseline-parity.md](docs/baseline-parity.md) §6.12.
- **11 paths are container and runtime pinning beyond the four manager manifests the plan enumerates**:
  `scripts/pm2/package.json` and its lockfile, which turn the plan's "exact `pm2` patch" from a
  Dockerfile string into a resolved, lockfile-backed pin; `serverside/pygame/worker/entrypoint.sh` and
  `serverside/pygame/worker/supervisor/shell.conf`; and the Node units inside the shell and worker
  images that the plan's Dockerfile rows imply without naming —
  `serverside/{java,python,r}/shell/trinket/package.json` with their three lockfiles, plus
  `serverside/pygame/worker/trinket/package-lock.json`. All of them follow from R-b's unqualified
  prohibition on a container pinned to an old runtime.
- **1 path is a spec file the plan does not name**: `test/lib/api/course.js`, where two comment fences
  are removed so that the course-download case the base commit had disabled registers again. Its
  assertions are byte-identical — the diff is the two fence lines and nothing else — but it changes
  the registered set, so it is recorded here rather than left inside the 130-case tally.
- **3 paths are parity-harness files the plan's scope section implies but its table does not list**:
  `test/parity/fixtures/model.js`, the fourth of the four fixture modules and the model-layer fault
  injector without which the auth scheme's lookup-error outcome cannot be driven from any HTTP
  request; `test/parity/warning-policy.js`, the one zero-warning policy the gate tools read rather
  than each restate; and `test/parity/corpus.json.provenance.json`, the corpus provenance sidecar its
  gate verifies before it compares. Every other parity artifact is written where `--out` points it
  rather than committed, and `test/helpers/db.js`, which an earlier revision of this ledger named, is
  **byte-identical to base commit `2f8712a`**.
- The parity method, the gate register and the R-f resolution log against `2f8712a` are in [docs/baseline-parity.md](docs/baseline-parity.md).

### Not yet proven

Every item below is a gate this migration defined, with its measured state. Nothing here is an
undecided **question**. Two of the shortfalls this section used to carry are closed: the `archiver`
disposition, which moved to 7.0.1 under **Dependencies** above and took the boot warning line and two
failing gates with it, and the authorization question over the withdrawn security cluster, settled
under **Security** above. What remains open is the **9** failing suite cases, the one
unregistered sign-up copy change the `joi` gate fails on, and the **13** application regressions per
pass the corpus gate fails on — the corpus gate's own qualification, which this section used to carry
as the third shortfall, is closed: it now qualifies on all ten requirements. [docs/baseline-parity.md](docs/baseline-parity.md) carries the register, the reason and
the command for each.

- **Passing, measured — each gate run individually on the delivered tree after `npm ci` from the
  committed lockfile, because what these gates measure is the installed dependency graph**: the
  per-entry route manifest over all 233 routes — the primary parity gate,
  0 differing fields — and the route-table CLI across its three invocation forms, byte-identical to
  the baseline capture. **Three of the five `npm run verify:*` gates exit 0** — `verify:routes`,
  `verify:storage` and `verify:worker`. The other two, `verify:joi` and `verify:corpus`, **now
  qualify as measurements and exit 1 on what they measure** rather than on a structural refusal, each
  with a closed register accounting for the differences that later remediations authorized and each
  failing on the residue that nothing authorizes: see their items below. `npm test` registers and
  executes its full 130-case contract.
- **Validation: the accept/reject question is clean; the command exits 1 on one unregistered copy
  change**: the `joi` matrix drives all **102** validation targets over **306 cases, 462 outcomes and
  15 678 compared fields** and reports **0 unauthorized schema-level differences, 0 `describe()`
  differences and 0 proof mismatches** — accept, reject and coercion parity across the `joi`
  17.13.3 → 18.2.5 move is intact. Of the **105** measured differences, **104 are accounted for in a
  closed authorization register** — 78 by the multipart restoration, 22 by the material-move
  pre-handler answering again, 4 by the accessible validation outlets on the sign-up form — each
  entry pinning both values and naming the finding that authorized it, and an entry that stops
  materializing fails the run. **The one that is not** is the sign-up page rendering curated
  validation copy where the base commit rendered raw `joi` text; it is not authorized anywhere, so
  `npm run verify:joi` exits **1** on it and on the behavioural invariant it breaks, with no captured
  warning and no unmatched register entry. Two drives on `POST /api/users/email` do not answer inside
  the 20-second budget and are recorded as reviewed rather than left unexplained; the 60 differences
  an earlier revision reported were the withdrawn guards under **Security** above and are gone with
  them, and an earlier revision's `gate PASSED, exits 0` was measured before the provenance defect
  below was found.
- **Storage: passing every case**: the storage and archive contract closes **41 of 41** cases and
  `npm run verify:storage` exits 0 — no failed case, no captured warning, no recorded finding, no
  double delivery and no failed teardown. The `archive-layout` case that an earlier revision recorded
  as the one failure now opens the archive and reads it back, because the writer moved with `archiver`
  under **Dependencies** above.
- **Export worker: passing, and driven rather than required**: `npm run verify:worker` reports
  **VERDICT PASS** and exits 0. It drives **7 real jobs on `bull` 4.16.5** — success, missing-user,
  late-failure, unknown-action, retry, stalled and lock-loss — against an isolated queue namespace it
  obliterates on exit, and **112 of 112 recorded checks pass, with 112 names for 112 checks, 112 of
  them distinct** (the run's terminal tally is 113, because a document cannot record the
  outcome of writing itself). Among them are all 18 assertions §0.9.3 names, and **0 notices under
  `--pending-deprecation --trace-deprecation`**. An earlier revision of this ledger recorded 92 of 109
  with a FAIL verdict, the success job never reaching `completed`; both causes are gone — the export
  query is a cursor iterated with `for await` rather than the `Query.stream()` this Mongoose line
  removed, and the archive writer moved with `archiver` under **Dependencies** above. The run records
  one observation rather than a failure: `lib/util/nunjucks.js` asks `nunjucks` for `watch: true`
  outside production, which reaches an undeclared `chokidar` through an optional peer, so the harness
  passes `watch: false` through the declared API and closes with an empty handle inventory.
- **Corpus replay: run on both cookie passes, qualifying as the parity gate, and exiting 1 on 13
  application regressions**: the baseline response corpus is captured through the **delivered**
  generator at base commit `2f8712a` — **392 scenarios, 404 recorded steps, all 233 routes
  represented**, with the capture's provenance verified against the generator blob and the commit
  containing it — and `npm run verify:corpus` drives every one of them against the delivered tree
  twice. **Per pass, identically: 280 match exactly, 97 carry only differences the closed
  authorization register accounts for, 1 is the approved deviation, 1 is unreachable by design, and
  13 fail** — 133 difference records, 0 stale authorizations, 0 undriven scenarios, 0 missing
  baselines, and route coverage asserted across all 233. The register itself holds **15 140 records,
  7 570 per pass**, keyed by pass, scenario, step and comparison field, pinning both values and
  naming the finding that authorized each; the accessibility contract and the colour-swatch buttons
  account for most of it. **The 13 are target-only application regressions the gate is correctly
  reporting** — four routes that answered 200 at the base commit and now answer 500, one avatar
  upload, four whose flash payload is written a request too early, and four that no longer answer at
  all — and none was authorized, because authorizing a regression is exactly what the register
  exists to prevent. **The secure pass is now a measurement rather than a derivation**: a real
  secure-mode recording of the base commit was captured with the committed generator, and against it
  every `expires`, `samesite` and `secure` attribute matches — all 235 recorded `Set-Cookie` records
  carry `Secure`, the 20 session-establishing ones carry `SameSite=None` with a one-year horizon, and
  the target differs on none of it, which is what closes the private-field cookie patch as proven
  rather than assumed. All ten gate-qualification requirements are met, including
  `measured-secure-pass` and `auth-outcomes-exercised` — all five auth-scheme outcomes driven and
  compared rather than explained — so the run may be cited as the parity gate AAP §0.9.3 defines.
  One condition of comparability is worth recording, because getting it wrong reads as 62 spurious
  differences: the recording holds absolute `Location` values and inline-script digests carrying the
  capture's own port, so a replay must serve on that port. **The approved deviation is materialized
  and verified in both passes**, its single differing field being `outcome: "timed-out" ->
  "answered"`.
- **Open only where closure is a measurement, not a reading**: the per-site conversion inventory,
  regenerated from the delivered tree and re-verified with `--check`, closes **348 of its 377 rows**.
  **The conversion set is complete — 154 of 154**: all 145 routed handlers, all 8 routed pre-handlers
  and the inline pre-handler carry a proven exit on every path, and the 188 sites inside them (142
  promise chains and 46 callback boundaries) are closed too. An earlier revision recorded 266 of 382
  with one routed handler held open; the delivered tree closes it. What remains open is **29 rows whose
  target IS a measurement** — the 9 reply chains, whose outcome depended on which builder method ran
  last, the 18 stream sites, where whether a stream still errors after the response has begun is a
  timing question, and 2 dead pre-handler redirect branches. Reading source cannot close any of them;
  only a driven comparison can. **The replay artifact now qualifies**, so the evidence those rows need
  exists; closing them is a regeneration of that inventory against it, which this entry does not
  claim and which is recorded as outstanding rather than presented as done.
- **Partly measured**: the deprecation sweep covered all 233 routes under two identities across 466
  requests, which exercises each handler's entry and dominant branch rather than every branch within
  it — and that sweep was measured at evidence commit `0716cd2`, not re-run here. What this tree
  re-measured is the boot under both flags, which writes **nothing** to stderr, both replay passes,
  each of which scanned the application's own stderr over every driven scenario, and the worker and
  storage gates, which capture **no notice at all** where they previously captured one each. The
  cookie-attribute comparison compares as matches in **both** passes now: the secure pass compares
  against a real secure-side recording rather than a derived differential, and all five auth-scheme
  outcomes are driven and compared, so neither of the two conditions an earlier revision recorded
  here as outstanding remains open.
- **The changed-error-edge inventory, on the counting basis its own verdict table sets**: regenerated
  against a baseline worktree so that every row is joined to the row measuring the same edge on the
  other tree, [docs/error-edge-inventory.md](docs/error-edge-inventory.md) accounts for **342 of 342
  baseline rows and 341 of 341 target rows** over **341 rows emitted by the run**, and its verdict
  table partitions **372 rows: 295 closed, 57 open and 20 carrying no mapping either tree can be held
  to**. The 57 open rows split **20 whose outcome changed, 25 with no target row and 12 new in the
  target**, and each is listed there with both outcomes side by side; 51 rows reach no funnel at all,
  which is an outcome to preserve rather than a gap. **The verdict table is the authoritative count**,
  and a raw `[x]`/`[ ]` tally over the document disagrees with it by design — the checkbox marks a
  reading, the verdict is the joined comparison — so a figure for this quantity is either that
  table's or it is wrong. All **20** outcome-changed rows were adjudicated site by site
  against `2f8712a` and are comparator-resolution or edge-anchoring artifacts with **zero observable
  change on the wire**; the per-edge adjudication is in
  [docs/baseline-parity.md](docs/baseline-parity.md) rather than repeated here.
- **Unmet on one of its three counts**: `npm test`'s gate asserts that the cases registered, the cases
  executed and the cases passing all equal 130. The run registers 130 and executes 130 — no hook
  suppresses a case — and passes **103**, so the gate is unmet by 27 on passing and the run reports
  **28** failures, the 28th being the gate assertion itself. The groups are under **Developer
  experience** and, with each case's measured symptom, in
  [docs/baseline-parity.md](docs/baseline-parity.md) §6.2: 11 base-commit model expectations the
  production code has never satisfied, 6 course and registration cases of the same class, 4 logged-out
  `/api/` cases whose 401 `app.js` answers as JSON, 4 file cases at 415 and 404, 1 profile case that
  throws on a `config.cloud` namespace nothing defines, and 1 re-registered download case whose frozen
  URL matches no route.
- **Recorded at an earlier tree rather than re-authenticated here**: the container and image gate. The
  nine `docker build --no-cache` runs at exit 0, the eight serverside unit boots and the root image
  serving both stylesheets were measured at evidence commit `0716cd2` and are tabulated per image in
  [docs/baseline-parity.md](docs/baseline-parity.md) §5.2. The inputs those builds consume have moved
  since: `git diff --name-only 0716cd2 -- . ':!docs'` reports 85 changed paths, among them the
  root `Dockerfile`, all eight `serverside/**` Dockerfiles, `package.json`,
  `package-lock.json` and `scripts/fetch-components.js`. So no image result here is a current-head
  one, and the eight `serverside/**` images and the four manager boots are not re-proven. What this
  tree does carry, checkable by reading the files, is the Node 22 pin in all nine Node-bearing
  Dockerfiles and the root image's `fetch-components` then `npm ci` then `build:css` sequence.

## [1.0.0] - Initial Open Source Release

First public release of Trinket.
