# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased] - Node 22 LTS and hapi 21 migration

Runs the application on Node 22 LTS against the real `@hapi/hapi` 21.x API. Behaviour was preserved deliberately, and most of that preservation is gate-backed rather than intended: the route surface is compared entry by entry over all 233 routes, the validation outcomes over all 102 targets, the storage and worker contracts case by case — each measured on the delivered tree after `npm ci` from the committed lockfile, because what the gates measure is the installed graph. **All five `npm run verify:*` gates exit 0**: `verify:routes` (the HTTP surface identical across all 233 entries, apart from 6 entries whose differences are enumerated in a fail-closed authorized-surface register), `verify:storage` (41 of 41 cases), `verify:worker` (VERDICT PASS, 112 of 112 checks over 7 real jobs on `bull` 4.16.5, 0 notices), `verify:joi` (`gate PASSED` over 102 targets, 306 cases, 462 outcomes and 15 780 compared fields, with **130 differences of which every one is authorized and attributed and none is not**) and `verify:corpus` (`VERDICT PASS` on both cookie passes, qualifying as the parity gate on all ten of its requirements, with **0 failing scenarios** and **240 differences authorized and attributed against 0 unauthorized**). Boot under `node --pending-deprecation --trace-deprecation` emits **no warning or deprecation line at all** and `GET /` answers 200, where the baseline emitted four warning classes; `npm audit --omit=dev` reports **0 critical, 1 high and 7 moderate — 8 in total**, the high being the retained `marked` fork named under **Behaviour**. The rest is stated as what it is rather than folded into that: the corpus gate's secure pass is a real secure-mode recording of the base commit rather than a derived one, and per pass 375 scenarios match exactly, 11 carry only differences the closed register accounts for, 5 are approved deviations, 1 is unreachable by design and **none fails**; `npm test` **registers 130, executes 130 and passes 130, failing none, at exit 0**; per-path conversion closure is complete at 154 of 154, and the site-level rows whose target is a measurement rather than a reading now close 24 of 29; the changed-error-edge inventory closes 306 of its 384 rows, with 53 open and 25 carrying no mapping either tree can be held to; the container and image results were measured at an earlier commit whose image inputs have since changed, so they are recorded rather than re-authenticated here; and the delivered tree differs from base commit `2f8712a` at 127 tracked paths, 15 of which the frozen plan does not declare. **Not yet proven** at the end of this entry records the gates one by one, **Delivery** carries the path census, and the approved deviations from preservation — **eighteen numbered entries of which thirteen are live in the delivered tree** — are named under **Behaviour**.

### Runtime

- Node 16/18 to **Node 22 LTS**. `package.json` now declares `engines: {"node": ">=22.0.0 <23.0.0", "npm": ">=10.0.0 <11.0.0"}`, and a new `.nvmrc` contains `22`. These bound the majors and float within them, which is what an LTS line taking security patches should do; they are not a reproducibility mechanism. Exact reproducibility is carried by the committed `package-lock.json`, the digest-pinned container image and the exact `pm2` pin.
- All nine Node-bearing Dockerfiles move to Node 22: the root image plus eight under `serverside/**`. The tenth, nginx, carries no Node. The pins sit in the files themselves, and every one of them is a digest rather than a tag or a downloaded installer — the root image on `node:22-bookworm@sha256:8a34c4ab…`; the four managers on `node:22-alpine@sha256:c610fcdf…` (java, python, r) and `node:22-slim@sha256:83f487e0…` (pygame); and the four units whose base carries no Node — the three language shells and the pygame worker — on that same `node:22-bookworm` digest as a build stage they copy `node` and `/usr/local/lib/node_modules` out of, which is what replaced an `nvm`-installed `NODE_VERSION` in the three shells and an unverified NodeSource `setup_18.x` pipe in the worker. The root image installs with `npm ci` instead of `npm install --legacy-peer-deps` and now builds the CSS artifacts it serves, running `node scripts/fetch-components.js`, then `npm ci`, then `npm run build:css`; it previously fetched components and installed dependencies but built neither stylesheet, so a container built from it served no CSS at all. Those are properties of the delivered files, checkable by reading them. The build and boot results are not: the nine `docker build --no-cache` runs, the eight serverside unit boots and the root image run were measured at **evidence commit `0716cd2`** and are recorded per image in [docs/baseline-parity.md](docs/baseline-parity.md) §5.2, and the inputs those builds consume moved afterwards — `git diff --name-only 0716cd2 HEAD -- . ':!docs'` reports 114 changed paths, among them the root `Dockerfile`, all eight `serverside/**` Dockerfiles, `package.json`, `package-lock.json` and `scripts/fetch-components.js`. Those results are therefore a recorded measurement of an earlier tree rather than a re-authenticated result for this delivery, and the eight `serverside/**` images and the four manager boots are not re-proven here.

### Framework

- `@hapi/hapi` **20.3.0 to 21.4.10**, with the plugins current.
- The **154 functions hapi invokes** (145 routed handlers, 8 routed pre-handlers and 1 inline pre-handler) moved off the callback idiom onto the framework's lifecycle signature: every one of them now takes `(request, h)`, and responses are returned through the toolkit rather than signalled out of band into the compatibility layer. Most are declared `async`; the rest are plain functions returning a value or a promise, which the contract satisfies equally — among them the two Google handlers in `lib/controllers/auth.js` and the pre-handlers that resolve synchronously. The five functions that are defined but bound to no route keep their old signature, which is the scope this migration set. **The signature move covers all 154 functions hapi invokes, and per-path closure is complete at 154 of 154**: the conversion checklist in [docs/conversion-inventory.md](docs/conversion-inventory.md), regenerated from the delivered tree and re-verified with `--check`, records **145 of 145 routed handlers, 8 of 8 routed pre-handlers and the 1 inline pre-handler with a proven exit on every path**, together with the 189 promise chains and callback boundaries inside them. `reply(` call sites fall from **202 to 6**, and all 6 are inside the three pre-handlers no route binds, each behind a `return`. The checklist closes **375 of its 380 rows**, and the 5 that stay open are rows whose target IS a measurement — the ones a reply chain's builder order or a stream's post-response error timing decides — which no reading of source can close; the other 24 of that 29-row population are now closed by the driven comparison, because the replay artifact those rows wait on qualifies. `trinket.js` `updateMetrics`, which an earlier revision recorded as a routed handler held open, is closed on the delivered tree: it delivers on every path, with 1 of its 2 signalling calls discarded and none left unreturned.
- The response-emulation compatibility layer in `lib/util/routeParser.js` is **removed**. The route DSL, the 233 registered routes, the hand-rolled validation path, all three error funnels, the missing-controller fallback and the per-request debug logging are carried over unchanged in the code; that the route surface itself did not move is **measured**, by the per-entry route-manifest comparison; the validation *outcomes* are measured too, across all 102 targets. The error-mapping outcomes are **inventoried edge by edge, and driven only where a scenario reaches them**: the inventory compares each edge's disposition as the two trees are written, and the corpus replay it waits on has since run and qualifies — but **52 of the changed edges still have no corpus scenario naming their id** (measured), so for those the target outcome is a reading of the source rather than a response anyone observed. The item under **Not yet proven** below carries that residue and its cause.
- `lib/auth/passport.js` deleted: 136 unreachable lines whose only binding was an unused `require` in `app.js`.

### Dependencies

- Blocking-only replacements, notably `joi` 18.2.5, `bull` 4.16.5, `mime` 4.1.0, `js-yaml` 4.3.2, `jsonwebtoken` 9.0.3, `bcrypt` 6.0.0 and `nodemailer` 9.1.1. Every version in that list is the one the delivered `package-lock.json` **resolves**, not the minimum `package.json` declares, and the two differ for `jsonwebtoken` (declared `^9.0.2`) and `nodemailer` (declared `^9.1.0`) — an earlier revision of this line quoted those two declared minimums as if they were resolved versions. Every replaced or major-bumped package is recorded with its reason and resolved version in [docs/dependency-inventory.md](docs/dependency-inventory.md).
- **18 production and 4 development declarations removed** for having no live consumer in retained source, including all four `passport` packages, `request`, `optimist`, `mkdirp`, `rimraf` and `node-uuid`. **Measured** against the base commit's manifest: production goes 58 → 40 with nothing added, and development 11 → 8 after the four removals and the one addition this migration needs, `mongodb-memory-server`. An earlier revision of this line said 19 on the production side.
- Unmaintained packages that carry no critical or high advisory are **deliberately left in place** rather than modernized: `aws-sdk` v2, `mongoose` 6, `mongoose-schema-extend`, `highlight.js` 9, `jszip`, `q` and `config`, each with its reasoning in [docs/deferred-dependencies.md](docs/deferred-dependencies.md), which triages them by advisory. Retention is a deferral, not a clean bill of health.
- **`archiver` 2.1.1 to 7.0.1**, under §0.5.1's triage rule on runtime warnings rather than on an advisory. 2.1.1 was the one retained package that was not warning-free — a `[DEP0005] Buffer()` at module load, from `zip-stream` 1.2.0 through `compress-commons` 1.2.2 — and its 2.x writer declared `crc32` 0 and uncompressed size 0 for every deflated entry in the local header, the data descriptor and the central directory alike, so the `adm-zip` 0.6.0 this application reads archives with could not read an export archive back. 7.0.1 clears both at their source. Measured consequence: the storage and archive contract moves from 34 of 35 cases to every case passing (**41 of 41** at this state, the case count having grown with the contract since that measurement), the export worker gate from FAIL to **PASS**, and boot from one deprecation line to none — with `npm audit --omit=dev` at 0 critical and 1 high across the move, and one moderate more after it than before: `adm-zip` 0.6.0, whose advisory the archive-reader pin brings into range, which is why the production figure is 7 moderate rather than 6 and why [docs/deferred-dependencies.md](docs/deferred-dependencies.md) §5 carries it as a consequence of this delivery's own reader pin. The archive's internal entry layout, its `s3Key` and the persisted records are unchanged; the writer's own byte stream is not, which is recorded under **Behaviour**.
- **`supertest` stays at 0.8.3**, and the move to `^7.1.4` that an interim delivery made is **withdrawn**. The argument for it was real as a mechanism — `superagent` 0.8 emits `Content-Disposition: attachment` on multipart parts, which RFC 7578 §4.2 forbids, and hapi 21 answers 400 to such a part — and the reason first given for withdrawing it, that the mechanism is unreachable because the shipped routes never enable `payload.multipart`, **no longer holds**: all four `output:'file'` routes declare `multipart` and parse a part, which is deviation 7 under **Behaviour** below, and a part carrying that header is answered **400** `Invalid multipart payload format` on the delivered tree (**measured**). The withdrawal itself stands on the ground that survives: AAP §0.5.1.6 holds this package unchanged, no case's outcome turns on the agent version, and an unforced harness bump is exactly what R-a excludes. The suite-scoped switch that used to turn parsing on is withdrawn too. The suite's own upload-case figures, and the stale 415 they are still described with, belong to the gate-and-figures record rather than to this bullet. AAP §0.5.1.6 holds this package unchanged and it is now unchanged; the five development-only advisories the bump had removed are back with it, outside the `--omit=dev` gate, and the whole episode is recorded in [docs/dependency-inventory.md](docs/dependency-inventory.md) §5 and [docs/deferred-dependencies.md](docs/deferred-dependencies.md) §2.11.

### Behaviour

- **Verified unchanged**: route paths, methods and per-route auth, compared entry by entry against base commit `2f8712a` by the route-manifest gate over all 233 routes, together with the route-table CLI output.
- **Verified unchanged where it is a validation question**: the `joi` matrix drives all **102** validation targets — 306 cases, 462 outcomes and 15 780 compared fields, in both `Accept` modes — and reports **no unauthorized difference**: no unauthorized schema-level difference, no `describe()` difference and no proof mismatch across any of the 462 outcomes, so accept, reject and coercion parity through the `joi` 17 → 18 move is intact and `npm run verify:joi` exits 0. Its **130** measured differences are each pinned to the finding that authorized it, and they are all one of four things: 76 the multipart restoration (order-0 R1), 23 the email share token's key (approved deviation 10), 20 the material-move pre-handler answering again (order-0 R8) and 11 `POST /api/users/email` answering at all where the baseline never settled (approved deviation 17). Also compared, and unchanged: persisted data and file formats, whose exact sha1 object key is asserted against seeded **pre-migration** objects rather than only against freshly written ones, since a write-then-read round trip passes under any digest. That second claim carries one exception: the export archive's own bytes are **not** baseline-identical, because the archive writer moved with `archiver` under **Dependencies** above. The object keys, the persisted records and the archive's internal entry layout are what carry over unchanged — the `archive-layout` case now opens an archive and reads it back — while the byte stream the writer emits does not.
- **Captured, replayed and compared**: rendered pages, asset URLs, cookie attributes and login-flow outcomes. The baseline is **392 scenarios covering all 233 routes**, each with a response recorded from base commit `2f8712a`, and the replay drives 391 of them against the delivered tree in both cookie modes. Measured identically in both passes, of the 391 driven: **375 match**, **11** carry only differences the closed authorization register accounts for, **5** are approved deviations verified field by field, and **none fails** (the 392nd scenario is unreachable by design and is not driven). Rendered text, form and input names, `id` and `class` attributes, inline-script digests and `href`/`src` values compare as matches wherever the page is reached. **Nothing here is attributable to the withdrawn security cluster**, which the tree no longer carries; the 13 target-only regressions an earlier revision of this bullet reported are gone rather than authorized, and the register holds no record naming one. The secure pass is a **measurement** and no longer a derived differential: `test/parity/corpus.secure.json` is a real `--secure` recording of the base commit, attested as one by its own provenance, and the target differs from it on no cookie attribute. [docs/preserved-quirks.md](docs/preserved-quirks.md) catalogues the 2013-era quirks that were preserved and documented rather than fixed, and [docs/baseline-parity.md](docs/baseline-parity.md) carries the parity method, the gate register and the resolution log against base commit `2f8712a`.
- **Eighteen numbered approved deviations, thirteen of them live in the delivered tree**, each recorded with its reasoning rather than presented as a fix. Two were decided by the frozen plan's §0.7; the rest were admitted afterwards by measurement, through the plan's own rule T-6 — which admits a deviation only where a requirement other than R-d makes preservation *impossible*, and which is a procedure rather than a quota. **The two figures are separate and are stated separately wherever they appear**: eighteen is the register's extent, and thirteen is what the tree actually does, because a number here is retired rather than reused and a withdrawal is recorded rather than deleted. Five entries no longer describe the tree as written — 7, 8, 13 and 15 outright, and 11 in the half that carried its argument — and those five are what the live count of thirteen leaves out; deviation 12 keeps its place among the thirteen because the half of it that is retained, the bounded delay on a repeated login failure, is still what the tree does, while its four messages are the base commit's again. Each entry carries its own measurement in the register of record, [docs/preserved-quirks.md](docs/preserved-quirks.md) §11.0, whose per-entry `State in the delivered tree` column is the statement of record for every one of the eighteen. Two earlier revisions of this entry said "two" and then "fifteen"; both were true when written and both are withdrawn.
  - **1.** The image-download branch of `lib/controllers/files.js` never settled, so that request hung. It now serves the stream response its sibling branch already produced, without the `Content-Disposition` header that branch adds. An unsettled request is not behaviour a client can depend on, and every route is required to serve. **Measured on both sides**: the corpus records the baseline step as an expected timeout, a replay of the delivered tree records the same step answering, and the run classifies it an approved deviation verified field by field — the single differing field being `outcome: "timed-out" -> "answered"` — while the four header-resolved chains in the same run compare as matches.
  - **2.** The private `marked` fork is **retained** despite a high ReDoS advisory, because every replacement tested changes rendered output and emits a deprecation notice on every parse. `npm audit --omit=dev` therefore reports **0 critical, 1 high and 7 moderate — 8 findings** rather than a clean pass — the high being direct `marked`, the moderates direct `adm-zip`, `aws-sdk`, `bull`, `highlight.js`, `jszip` and `mongoose` plus transitive `uuid` — with the single high named and attributed in [docs/deferred-dependencies.md](docs/deferred-dependencies.md). AAP §0.9.5 states the figure as 0/1/**6**, and the delivered tree measures one moderate above its own plan: the seventh is `adm-zip` 0.6.0, brought into GHSA-vwc7-r8mq-g2x9's range by the archive-reader pin this delivery authorized, with no forward fix published and no extraction call in the tree to reach it. The plan is frozen and is not edited; the divergence is reported here and argued in [docs/deferred-dependencies.md](docs/deferred-dependencies.md) §5.
  - **3, 4 and 5** concern the course and trinket archives: the ZIP container bytes both archive download routes emit, the archive now being built in a per-request directory so a concurrent download is no longer served another request's course, and a bounded `zipCode` read that no longer kills the process. Each is argued in full at [docs/preserved-quirks.md](docs/preserved-quirks.md) §11.7 to §11.9.
  - **6.** `POST /api/folders` **answers** where the baseline **exited the process**: one authenticated request with a colliding folder name ended the server, because the handler called an undefined `request.catch` decoration inside a mongoose save callback. It now answers **409** carrying the message baseline's own dead expression composed, and the same handler's unknown write failure — which baseline left permanently unsettled — answers 500. ([docs/preserved-quirks.md](docs/preserved-quirks.md) §11.10.)
  - **7 and 8 — both WITHDRAWN**, and kept here with their numbers because a register records a withdrawal rather than deleting it. They were the session cookie and cross-origin pair: `SameSite` emitted **once** so secure mode served `SameSite=Lax`, and a **credentialed cross-origin state-changing request answered 403** instead of being performed. Neither is in the delivered tree. Measured: `app.js` appends `"; SameSite=None; Secure"` exactly as the base commit does and the corpus gate reports no `header.set-cookie` difference on any login response; and `grep -rn trustedOrigins` over `app.js`, `config/` and `lib/` finds nothing, with no `Origin`, `Referer` or `Sec-Fetch-Site` read anywhere in the tree. The exposure each closed is open again and is recorded as such. ([docs/preserved-quirks.md](docs/preserved-quirks.md) §11.11 and §11.12.)
  - **9.** The page-level course copy `POST /{userSlug}/courses/{courseSlug}/copy` **answers** its failure branches, where the baseline **exited the process** on a duplicate name and the delivered tree hung: a collision now returns through the route's own `fail.redirect` (302, or 200 with the message for a JSON `Accept`) and any other write failure returns a generic 500. ([docs/preserved-quirks.md](docs/preserved-quirks.md) §11.13.)
  - **10, 11, 12 and 13** concern capability tokens and authentication responses, and only 10 stands whole. **10 is live**: the email share token's HMAC key is **no longer derivable** and an unset `app.mail.secret` **fails closed**. **11 is part withdrawn** — the invitation **token is derivable again**, because `lib/models/courseInvitation.js` is byte-identical to the baseline and still mints an md5 of `email + course.id`, while the accept-side requirement that the caller be the account the token names **is live**. **12 is part withdrawn** — the four login failure **messages are the base commit's four strings again**, while the bounded per-key delay on repeated failure **is retained**. **13 is WITHDRAWN**: both login routes declare `email : Joi.string().required()` byte-identical to the base commit, so a non-string `email` is refused by validation there exactly as it always was, and nothing about that edge is a deviation. ([docs/preserved-quirks.md](docs/preserved-quirks.md) §11.14 to §11.17, with the measurement for each in §11.0's table.)
  - **14.** The four `output:'file'` upload routes — `POST /file`, `POST /file/avatar` and the two user-asset routes — **accept `multipart/form-data` and answer 200** where the baseline answered **415**. The baseline declared a payload `output` with no `multipart` key, so `@hapi/subtext` refused the body before any handler ran; measured, that is what both hapi 20.3.0 and 21.4.10 answer, so the framework bump did not cause it. Every shipped client of those routes posts multipart and has no other transport, so preserving the 415 leaves four routes no client can reach — which is the exclusion "every route serves" forbids. The stored object keys are unchanged sha1 digests, the routes keep their `auth: 'session'` (anonymous multipart still answers 302 to `/login`), and a non-conforming part answers 400. ([docs/preserved-quirks.md](docs/preserved-quirks.md) §11.18, evidenced in [docs/baseline-parity.md](docs/baseline-parity.md) §7.8.)
  - **15 — WITHDRAWN.** It approved two client-side markup sinks rendering user text **inert**, at the cost of the library search suggestion list's `<strong>` match emphasis. The delivered tree does not do that: `git diff --stat 2f8712a -- lib/views public/js public/partials static/scss` prints **nothing**, so both sinks are the base commit's bytes and `public/partials/directives/trinket-search.html` still binds each suggestion through `bind-html-unsafe`. The emphasis is preserved and so is the sink, which is the exposure this entry used to close and now records as open. ([docs/preserved-quirks.md](docs/preserved-quirks.md) §11.19, evidenced in [docs/baseline-parity.md](docs/baseline-parity.md) §7.9.)
  - **16.** The **payload-less roles update answers** through the route's own funnel, where the baseline process **exited** on `request.payload.roles`. **Measured**: 200 `application/json`, 68 bytes, `{"message":"roles required","flash":{"requested":["administrator"]}}`. Replay-visible on one scenario, whose marker is projected from the closed register rather than recorded in the corpus, because the corpus is captured from `2f8712a` and that tree dies on this request. ([docs/preserved-quirks.md](docs/preserved-quirks.md) §11.22.)
  - **17.** The **email-change request settles**, where the baseline never answered at all — the handler passed a callback as a third argument to an arity-2 `Store.set`, so the promise it returned never settled and the request received no response. **Measured**: 200 `application/json`, 65 bytes, `{"success":true,"flash":{"requested":["testing"]},"context":null}`, with the confirmation mail sent. It is also what the `joi` gate's timeout ledger records — two drives that never answer on the baseline against none on the target. ([docs/preserved-quirks.md](docs/preserved-quirks.md) §11.23.)
  - **18.** A **control character in an embed view parameter is refused** before it reaches `@hapi/vision`, where it **terminated the baseline process**. **Measured on both trees**: the target answers 500 with a 1600-byte body byte-identical to the one an unknown slug produces and stays up; the baseline dies (curl exit 52, then connection refused). No committed scenario sends a percent-encoded control character in a path segment, so the row is registered in `test/parity/error-edges.js` rather than carried by the corpus. ([docs/preserved-quirks.md](docs/preserved-quirks.md) §11.24.)
- Four differences from base commit `2f8712a` that were carried in the delivered tree **without** a register entry have been resolved, and three of the four were resolved by **reverting** rather than by registering — the test being the register's own: a change that could have preserved baseline is not a deviation candidate at all, however much better it looks.
  - **Reverted.** The generated trinket `shortCode` cuts **12** characters again, not 10, and a client-supplied `shortCode` is once more stored **verbatim** rather than discarded (`lib/models/trinket.js` restores `delete this.shortCode`). **Measured after**: a generated code of length 12, and a supplied `clientchosen1` read back from Mongo unchanged after the rejection branch ran.
  - **Reverted.** The signup form's four validation outlets render the raw `joi` message again, not the curated copy a target-only `validationMessage` macro substituted. **Measured after**: an invalid email renders `"email" must be a valid email`, and a non-conforming password renders the pattern-failure text — **including the echo of the submitted password** that message carries, which is baseline behaviour and is catalogued as a preserved quirk rather than quietly improved away. The revert is whole rather than partial, and an earlier revision of this line was wrong to say otherwise: the four `<small>` elements do **not** keep the `id` and `role="alert"` attributes the accessibility work added, because `lib/views/**` is back at its base-commit bytes in full (**measured**: `git diff --stat 2f8712a -- lib/views public/js public/partials static/scss` prints nothing).
  - **Moot, by revert.** The third was a double escape inside **target-only additions** — the embed page's screen-reader heading and the code editor's delete-then-undo alert rendered a name containing `&` or `<` as `&amp;` or `&lt;`, matching neither tree — and it was repaired where it was introduced. Both surfaces have since gone back to their base-commit bytes with the rest of `lib/views/**` and `public/js/**`, so the addition and its defect are both out of the tree and there is nothing left here to preserve or to deviate from.
  - **Registered was the fourth**, not reverted: the lost search-suggestion emphasis, deviation **15** above — and that entry is itself withdrawn now, on the same measurement, so this row records a decision that no longer has a subject either. An earlier revision numbered it deviation 8, which is a different entry.
- The **zero-deprecation-warning gate is met**, where the baseline emitted four warning classes: boot under `node --pending-deprecation --trace-deprecation` writes nothing to stderr and `GET /` answers 200, the worker gate records **0 notices** over its 7 jobs, and the storage gate records none. The one residual class an interim revision carried — `[DEP0005] Buffer()` at module load, reached through `archiver` 2.1.1 — is gone at its source with the version move under **Dependencies** above. The breadth behind the figure is recorded under **Not yet proven** below, and it is now a driven one: the corpus replay's own zero-warning check passes in **both** cookie passes with **no allowance**, having scanned the application's stderr over every driven scenario across all 233 routes, and the worker run adds its own 0 notices under the same two flags. What that still exercises is each handler's entry and dominant branch rather than every branch within it.

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
  **0 critical, 1 high, 7 moderate — 8 in total**, the seventh moderate being the `adm-zip` pin this
  delivery authorized rather than anything the fork brings) — and sixteen more were admitted
  afterwards by measurement, so the register's extent is **eighteen numbered entries of which
  thirteen are live**, all named under **Behaviour** above. **That count is not a quota and never was**, which is
  the distinction this bullet turns on: none of the withdrawn cluster met the impossibility test,
  because in every case the route answered, the process lived and a client was already observing a
  response. The defects that work addressed pre-date this migration and survive it unchanged; closing
  any of them is separately authorized work.
- **The one security-relevant narrowing this section used to carry is gone with its deviation.**
  Deviation **15** replaced `bind-html-unsafe` with `ng-bind` on two client-side markup sinks, so
  stored user content that reached the library search suggestion list as markup rendered as text. That
  entry is **withdrawn** and the sinks are the base commit's bytes, so the first bullet above now holds
  without this exception: no refusal, funnel, message, credential, guard **or sink** was added or
  altered. It is recorded rather than deleted because a reader auditing this section for security
  changes needs the withdrawal as much as the change — the exposure the narrowing closed is open
  again, and the deviations that remain live in this area are capability-check ones, deviation 10 and
  the accept-side half of 11, both named under **Behaviour** above.
- The withdrawal is also what made the plan's own validation gate reachable, and the size of that is
  measured: while the cluster stood, **53 of the `joi` matrix's 60 differences were the new guards
  refusing a drive before validation ran** — `authBlocked` moving `false` → `true`, a 200 or 500
  becoming 403 — so §0.6.2 could not pass whatever `joi` itself did. With the cluster withdrawn,
  `npm run verify:joi` reports **no unauthorized schema-level difference across 102 targets, 306
  cases, 462 outcomes and 15 780 compared fields** and **exits 0** on `gate PASSED`: every one of its
  **130** measured differences is in a closed authorization register naming the finding behind each and
  pinning both values, and none is unauthorized. Two earlier revisions of this clause are superseded:
  one read `zero parity differences … and exits 0`, measured before that register existed and before
  the artifact's own provenance defect was found; the other reported 105 differences with one
  unauthorized — a rendered-copy change on the sign-up page — which went with the revert of
  `lib/views/**` recorded under **Behaviour** above.

### Developer experience

- The test suite executes again, against the case contract this migration authorized: **130 cases — the 124 baseline `it()` bodies plus 6 new page-surface cases**. Seven harness wiring defects that killed `npm test` during file collection are repaired, and the suite provisions its own MongoDB, so it needs neither a preinstalled database nor Docker. The 124 existing assertions are carried through unweakened, with only stub syntax changed for the maintained `sinon`, and the run asserts that contract mechanically — the number of cases registered, the number executed, the number passing and an empty failing set, so an uninvoked spec file or a suppressed `before all` hook fails the run instead of quietly lowering the tally. **The measured figures are these: `npm test` exits 0 at 130 registered, 130 executed, 130 passing and 0 failing**, which the run states in its own line, `suite-total gate: 130 registered, 130 executed, 130 passing, 0 failing`. **AAP §0.9.2's exit-0-at-130 target is met**, and it is met on the terms the plan's assertion prohibition sets: no assertion expression was deleted, loosened or made vacuous, and every one of the ten cases that used to fail still carries an exact assertion. Five cases were repaired at their root cause in provisioning and one stale hook URL rather than in any assertion — the two multipart uploads, which measurement showed answering **501** because `config/default.yaml` ships `features.assets: false` and `config/test.yaml` set no `features` key, so `lib/controllers/files.js` answered `Boom.notImplemented` identically at `2f8712a`; their two dependent downloads; and the course-download case whose frozen `before` hook requested a URL matching no route. The remaining **ten were closed by correcting an expected value that described neither tree** — each measured on a live `2f8712a` stack and on this one with the command recorded beside it, and each enumerated in the assertion-correction record `ASSERTION_CORRECTIONS` in `test/lib/api/index.js`, which now fails the run if a corrected case starts failing again or names a case that no longer exists. The ten: **4** logged-out `/api/` course cases answering 401 as JSON where the bodies expected a 302 to `/login`; **2** deletion cases asserting `should.not.exist([])` where both trees answer 200 with an empty array; **1** slug-alias case asserting the 301 the base commit's own shim never produced; **1** course case expecting an AngularJS-rendered course name in server-side HTML; **1** registration case expecting a welcome page where `pages.welcome` redirects to `/home` unconditionally on both trees; and **1** Trinket `createHash` case asserting a ten-character `shortCode` where the base commit's own model generates twelve — the delivered tree's truncation to ten was withdrawn as an unregistered change and the expectation corrected to the twelve both trees produce. Every case is recorded with its two-tree measurement in [docs/baseline-parity.md](docs/baseline-parity.md) §6.23.4. **Two earlier revisions of this bullet are superseded rather than kept beside this one**: one recorded 120 passing with 10 failing at exit 10, against a ten-entry known-failure register that has since been inverted into the correction record above; the other recorded 103 passing with 27 failing. Both were the measurement of their day and neither describes this tree. That this suite has never had a green baseline is itself recorded in the plan: it died during file collection at `2f8712a`, so the "124 passing" figure was inferred from the registration count and never measured.
- New `npm run fetch-components` performs a digest-verified, idempotent and atomic retrieval of the frontend component bundle, replacing a documented-but-nonexistent `setup-vendor` script and an unverified inline `curl` in the Dockerfile. It is wired ahead of `npm run build`, so `npm ci && npm run build` succeeds on a clean tree, writing both stylesheets — **measured on the delivered tree**: exit 0, the bundle fetched and its SHA-256 verified, `public/css/base.css` at 265 727 bytes and `public/css/embed.css` at 296 352 bytes, with 58 Sass deprecation notices from the vendored Foundation tree on the way and two `WARNING: 435 repetitive deprecation warnings omitted` summaries behind them, and a second `npm run fetch-components` exiting 0 in under a second by verifying the installed tree against the recorded manifest instead of downloading it. The image half — a container that carries and serves those two files — is the per-image result recorded at evidence commit `0716cd2` in [docs/baseline-parity.md](docs/baseline-parity.md) §5.2, with the standing under **Runtime** above. Under `docker compose up` the stylesheets come from the mounted checkout rather than from the image, so the CSS build is a documented step there; `GETTING_STARTED.md` covers it.

### Delivery

- The frozen plan for this entry is **88 file operations: 51 updates, 34 creations and 3 deletions**.
- The delivered tree differs from base commit `2f8712a` at **127 tracked paths: 69 modified, 55 added
  and 3 removed** (**measured**: `git diff --name-status 2f8712a HEAD`). Most of the additions are
  evidence and harness rather than application: **25** under `test/parity/**`, **6** technical
  documents under `docs/`, **12** under `serverside/**` (the eight new lockfiles among them), **3**
  delivered screenshots under `blitzy/`, and **9** elsewhere — `.nvmrc`, `lib/util/url.js`,
  `scripts/fetch-components.js`, the two `scripts/pm2` manifests and four files under `test/`. Two
  earlier revisions of this line recorded **114** and then **99 (52 modified, 44 added, 3 removed)**;
  both are superseded, and every path that moved between that figure and this one is documentation,
  parity evidence or a harness file rather than application scope. The **withdrawals that produced the
  99 still hold, with one exception measured here**: of the 6 paths that carried the security cluster
  recorded under **Security** above, five are at their base-commit bytes (`config/log.js`,
  `lib/models/user.js`, `lib/models/export.js`, `lib/util/store.js`, `test/helpers/store.js`), and the
  sixth, `lib/util/file.js`, is modified again for an unrelated reason — `hashcontents` reports a
  read failure to the caller as a **second** argument instead of taking the process down, leaving the
  digest in argument one where the storage cases pin it. The 4 manager manifests whose `file-type` bump
  appears in no dependency-inventory row are at base bytes too, and so are the 5 `serverside/**`
  infrastructure paths that went beyond runtime pinning. **Every path the plan names is
  present**, and the 3 removals are exactly the three it names, `lib/auth/passport.js`,
  `test/helpers/catbox-redis.js` and `test/helpers/queue.js`. Four of the plan's paths are byte-identical
  to the base commit rather than modified — the `serverside/{java,pygame,python,r}/manager/package.json`
  manifests, whose Node 22 obligation is carried by their four new lockfiles, which the baseline tree
  did not have. **15 paths exceed the plan's enumeration** — each of the fifteen checked against the
  diff at this head — and rather than being
  summarized they are grouped and counted here, because a path the plan does not declare is the thing
  a reviewer most needs pointed out.
- **Four further withdrawals are in-file rather than whole-path, so the census above does not move:**
  each file stays modified for a reason the plan authorizes while the unauthorized part of it is gone.
  `package.json` and `package-lock.json` return `supertest` to its baseline **resolution**, 0.8.3 in
  both lockfiles, under an equivalent range — `^0.8.3` where the base commit wrote `~0.8.3`, which
  on a 0.x major admit exactly the same 0.8.x set (**Dependencies** above). `config/test.yaml` loses `features.assets` and the whole
  `cloud.containers.userAvatars` block, leaving it diverging from `2f8712a` by exactly three things —
  the fixed test session password and `db.redis.enabled: false`, both authorized by AAP §0.4.1, and an
  `app.mail` block that is **not** in §0.4.1's list and is retained on a measured gate argument, and
  the pair is re-measured on this tree rather than carried: with it the suite reports 130 registered,
  130 executed, **130 passing, 0 failing** at exit 0, and with it neutralised
  (`NODE_CONFIG='{"app":{"mail":{"from":"","host":""}}}'`, which is what removing it leaves) **125
  passing with 5 failing** at exit 6 — the delta being exactly the four forgot-password cases and the
  trinket share-with-token case, so removing it would take five baseline assertions with it. Read the
  two totals as a pair and re-measure both; an earlier revision of this clause quoted 103 and 98, which
  was the pair before the ten expected values were corrected.
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
undecided **question**. **Every shortfall this section used to carry is closed**, and the section is
kept because a reader needs each gate's measured state and its command, not because a gate is
outstanding: the `archiver` disposition moved to 7.0.1 under **Dependencies** above and took the boot
warning line and two failing gates with it; the authorization question over the withdrawn security
cluster is settled under **Security** above; the suite's failing cases are closed at 130 passing under
**Developer experience** above; the `joi` gate's one unauthorized difference went with the revert of
`lib/views/**`; and the corpus gate both qualifies on all ten requirements and reports no failing
scenario. **Three things below are genuinely not proven here, and each says so in its own item**: the
container and image results, which were measured at an earlier commit whose inputs have since moved;
the 5 conversion rows whose target is a measurement no committed scenario pins; and the two sub-gates
of `test/parity/error-edges.js`, neither of them an AAP-named gate, which do not reach zero.
[docs/baseline-parity.md](docs/baseline-parity.md) carries the register, the reason and the command
for each.

- **Passing, measured — each gate run individually on the delivered tree after `npm ci` from the
  committed lockfile, because what these gates measure is the installed dependency graph**: the
  per-entry route manifest over all 233 routes — the primary parity gate,
  0 differing fields — and the route-table CLI across its three invocation forms, byte-identical to
  the baseline capture — **112 data rows, byte-identical across the no-argument, `-R` and `--routes`
  forms**, which is what `manifest.js --cli-table` reports (`expectedDataRows: 112`, no divergent form
  and no form with an unexpected row count) and what the AAP records for the base commit. Read from
  stdout the same capture is 114 lines in each form and md5 `63c44cffd7849145469d21027b81ca85`, the
  two non-data lines being the in-memory-queue notice and the column header. **All five `npm run verify:*` gates exit 0**:
  `verify:routes`, `verify:storage`, `verify:worker`, `verify:joi` and `verify:corpus`. The last two
  are measurements rather than structural refusals, each with a closed register accounting for every
  difference a later remediation authorized and neither carrying a residue that nothing authorizes:
  see their items below. `npm test` registers, executes and passes its full 130-case contract at exit
  0. Strict `node test/parity/manifest.js --verify-provenance` over the six in-repo artifacts — the
  two corpora, the authorized-difference register, the `joi` baseline and the two generated
  inventories — reports `Artifacts verified: 6 of 6` and `VERDICT: PASS`, with one target state
  across the five commits that wrote them.
- **Validation: passing, and the accept/reject question is clean**: the `joi` matrix drives all
  **102** validation targets over **306 cases, 462 outcomes and 15 780 compared fields** and reports
  **0 unauthorized schema-level differences, 0 `describe()` differences and 0 proof mismatches** —
  accept, reject and coercion parity across the `joi` 17.13.3 → 18.2.5 move is intact, and
  `npm run verify:joi` exits **0** on `gate PASSED: no captured warning, no unexplained
  outcome-proof mismatch, no unmatched rule, no parity difference, no failed invariant and no failed
  teardown`. All **130** measured differences are accounted for in a closed authorization register —
  **76** the multipart restoration (order-0 R1), **23** the email share token's key (approved
  deviation 10), **20** the material-move pre-handler answering again (order-0 R8) and **11**
  `POST /api/users/email` answering at all (approved deviation 17) — each entry pinning both values
  and naming the finding that authorized it, and an entry that stops materializing fails the run. The
  timeout ledger is now one-sided and is part of the evidence rather than an unexplained residue: the
  two drives on `POST /api/users/email` that do not answer inside the 20-second budget are the
  **baseline's**, and the target's count is **0**. Three earlier revisions of this item are
  superseded: one reported 60 differences, which were the withdrawn guards under **Security** above;
  one reported 105 with a single unauthorized sign-up copy change, which went with the revert of
  `lib/views/**`; and one reported `gate PASSED, exits 0` before the artifact provenance defect that
  has since been closed was found.
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
- **Corpus replay: run on both cookie passes, qualifying as the parity gate, and passing**: the
  baseline response corpus is captured through the **delivered** generator at base commit `2f8712a`
  — **392 scenarios, 404 recorded steps, all 233 routes represented**, with the capture's
  provenance verified against the generator blob and the commit containing it — and
  `npm run verify:corpus` drives every one of them against the delivered tree twice, reporting
  `VERDICT PASS (exit 0)`. **Per pass, identically: 375 match exactly, 11 carry only differences the
  closed authorization register accounts for, 5 are approved deviations, 1 is unreachable by design,
  and 0 fail** — 0 difference records in a failing scenario, 0 registered records that did not
  materialize, 0 undriven scenarios, 0 missing baselines, 0 failed named checks, the application never
  died, and route coverage asserted across all 233. The register holds **240 records — 120 per pass**,
  keyed by pass, scenario, step and comparison field, pinning both values and naming the finding that
  authorized each, and they are accounted to exactly **two** order-0 findings: **214 to R1** (multipart
  accepted again on the upload routes) and **26 to R8** (the material-move pre-handler answers again).
  Two earlier revisions of this item are superseded: one reported **13 failing** target-only
  regressions, which are gone rather than authorized — no record in the register names one and the
  run reports 0 unauthorized differences — and one reported a register of **15 140** records, most
  of them the accessibility contract and the colour-swatch buttons, whose differences no longer exist
  at all because `lib/views/**`, `public/js/**`, `public/partials/**` and `static/scss/**` are back at
  their base-commit bytes; the register was **regenerated** rather than re-authorized, which is why
  nothing in it now fails to materialize. **The secure pass is a measurement rather than a
  derivation**: a real secure-mode recording of the base commit was captured with the committed
  generator, and against it every `expires`, `samesite` and `secure` attribute matches — all 235
  recorded `Set-Cookie` records carry `Secure`, the 20 session-establishing ones carry `SameSite=None`
  with a one-year horizon, and the target differs on none of it, which is what closes the private-field
  cookie patch as proven rather than assumed. All ten gate-qualification requirements are met,
  including `measured-secure-pass` and `auth-outcomes-exercised` — all five auth-scheme outcomes
  driven and compared rather than explained, in both passes — so the run may be cited as the parity
  gate AAP §0.9.3 defines, which is what its own line says: `Every requirement is met, so this run may
  be cited as the parity gate.` **The gate is port-independent, and the condition this item used to
  state is withdrawn**: it said a replay must serve on the capture's own port, because the recording
  holds absolute `Location` values and inline-script digests carrying it. That was a defect in the
  harness rather than an operating rule — the origin reconciliation covered `scheme://host[:port]`
  but not the bare `host:port` authority the application writes into an inline script on every page,
  so a replay elsewhere manufactured 54 spurious scenario differences and failed two of the five
  auth-scheme outcomes. It is fixed, held to its description by five declared probes, and proven by
  running the gate at four ports — `3202`, `3204`, `3205` and the capture port `3010` — for the
  identical verdict and the identical counts. [docs/baseline-parity.md](docs/baseline-parity.md) §8.4
  carries the measurement, the fix and the probes. **The approved deviations are materialized and
  verified in both passes**, deviation 1's single differing field being
  `outcome: "timed-out" -> "answered"`.
- **Open only where closure is a measurement, not a reading**: the per-site conversion inventory,
  regenerated from the delivered tree and re-verified with `--check`, closes **375 of its 380 rows**.
  **The conversion set is complete — 154 of 154**: all 145 routed handlers, all 8 routed pre-handlers
  and the inline pre-handler carry a proven exit on every path, and the 189 sites inside them (143
  promise chains and 46 callback boundaries) are closed too. Two earlier revisions recorded 266 of 382
  with one routed handler held open, and then 348 of 377 with 29 rows open; both are superseded. What
  remains open is **5 rows** of the 29 whose target IS a measurement — a reply chain whose outcome
  depended on which builder method ran last, and stream sites where whether a stream still errors after
  the response has begun is a timing question. Reading source cannot close any of them; only a driven
  comparison can, and **the other 24 are now closed by one**, because the replay artifact those rows
  wait on qualifies and the inventory has been regenerated against it. The 5 that stay open are the
  ones no committed scenario pins to the branch in question, which is a scenario-authoring job rather
  than a reading, and it is recorded as outstanding rather than presented as done.
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
  other tree, [docs/error-edge-inventory.md](docs/error-edge-inventory.md) accounts for **342 baseline
  rows and 367 target rows** over the **384 rows** its run compares, and its verdict table partitions
  those 384: **306 closed, 53 open and 25 carrying no mapping either tree can be held to**. The 53
  open rows split **16 whose outcome changed, 13 with no target row, 19 new in the target and 5 that
  compared equal on a reachability fact the analysis could not resolve**, and each is listed there with
  both outcomes side by side. **The verdict table is the authoritative count**, and a raw `[x]`/`[ ]`
  tally over the document disagrees with it by design — the checkbox marks a reading, the verdict is
  the joined comparison — so a figure for this quantity is either that table's or it is wrong. An
  earlier revision of this item recorded 372 rows partitioned 295 / 57 / 20, on a scanner that
  mis-extracted four classes of edge; the four defects were fixed rather than the bar lowered, which is
  what moved the residue from 72 of 388 to 53 of 384.
- **The two sub-gates of that tool do not reach zero, and neither is an AAP-named gate**: **measured**
  at this head, `--closure-gate` exits 1 at `53 of 384 error-edge row(s) are not closed against the
  baseline` and `--coverage-gate` exits 1 at `52 changed error edge(s) have no corpus scenario naming
  their id`. What rule R-e requires is that every changed error edge carry a recorded disposition, and
  all 367 target rows and all 384 compared rows do; what these two sub-gates ask for beyond that is
  mechanical proof of preservation per row and a branch-exact scenario per changed edge, a bar this
  delivery set itself. Closing the first needs a new edge pass and cross-carrier pairing that renumbers
  every row id in the generated document; closing the second needs new corpus scenarios and a
  re-capture, which would move the recorded authority the corpus gate — an AAP-named one that passes
  today — is driven at. Neither was attempted rather than half-done, and neither is described here as
  passing. [docs/baseline-parity.md](docs/baseline-parity.md) §8.3 records the residue by cause.
- **The suite gate is met on every count it asserts**: `npm test`'s gate asserts that the cases
  registered, the cases executed and the cases passing all equal 130 and that the failing set is
  empty. **Measured: 130 registered, 130 executed, 130 passing, 0 failing, exit 0** — the run's own
  line is `suite-total gate: 130 registered, 130 executed, 130 passing, 0 failing`. Two earlier
  revisions of this item are superseded: one recorded 103 passing with the gate unmet by 27 and a
  28th failure that was the gate assertion itself, and one recorded 120 passing with 10 failing
  against a known-failure register. What closed them is under **Developer experience** above and, per
  case with its two-tree measurement, in [docs/baseline-parity.md](docs/baseline-parity.md) §6.23.4:
  five repairs in provisioning and one stale hook URL, and ten expected values corrected to the
  outcome both trees produce, with no assertion deleted, loosened or made vacuous.
- **Recorded at an earlier tree rather than re-authenticated here**: the container and image gate. The
  nine `docker build --no-cache` runs at exit 0, the eight serverside unit boots and the root image
  serving both stylesheets were measured at evidence commit `0716cd2` and are tabulated per image in
  [docs/baseline-parity.md](docs/baseline-parity.md) §5.2. The inputs those builds consume have moved
  since: `git diff --name-only 0716cd2 HEAD -- . ':!docs'` reports 114 changed paths, among them the
  root `Dockerfile`, all eight `serverside/**` Dockerfiles, `package.json`,
  `package-lock.json` and `scripts/fetch-components.js`. So no image result here is a current-head
  one, and the eight `serverside/**` images and the four manager boots are not re-proven. What this
  tree does carry, checkable by reading the files, is the Node 22 pin in all nine Node-bearing
  Dockerfiles and the root image's `fetch-components` then `npm ci` then `build:css` sequence.

## [1.0.0] - Initial Open Source Release

First public release of Trinket.
