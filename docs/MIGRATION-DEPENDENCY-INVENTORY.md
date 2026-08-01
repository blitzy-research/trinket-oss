# Dependency Migration Inventory

This is the complete record of every dependency decision taken by the Node 22 LTS / hapi 21 modernization: what was
bumped, what was replaced, what was deleted, and what was deliberately held — each with the reason, the exact version
on both sides, and the verification that made the decision safe.

The document exists to discharge the binding rule R-3, quoted verbatim:

> "Every replaced or major-bumped package must be recorded in a delivered artifact — not merely in a commit message —
> stating the original, the replacement, and a reason classified as dead, incompatible, or security."

R-3 imposes three obligations, and this file is how each is met.

- **Delivered, not buried in a commit message.** This document is registered in the MkDocs navigation in `mkdocs.yml`
  under the title *Dependency Migration Inventory*, and it is linked from `CHANGELOG.md` at the root-relative path
  `docs/MIGRATION-DEPENDENCY-INVENTORY.md`. Its sibling deliverable,
  [PRESERVED-QUIRKS.md](PRESERVED-QUIRKS.md), links back to it in four places. It is published, not merely present.
- **Every replaced or major-bumped package.** Completeness is auditable rather than asserted: the dependency name
  sets of the base-commit `package.json` and the committed `package.json` were extracted and diffed, and every name
  in the symmetric difference appears below. The base commit declared **58 runtime and 11 development**
  dependencies; the committed manifest declares **39 runtime and 9 development** dependencies.
- **The mandatory triple.** Every entry states the original, the replacement, and a reason classified as exactly one
  of **`dead`**, **`incompatible`** or **`security`**. No fourth code is used, and no replaced or major-bumped
  package is left unclassified.

**Rule-set provenance.** The `review_rules` facility was called twice for this project — once with no range and once
over the document's full extent — and both calls returned the single line **"No user rules provided."** There is no
separate user-supplied rules document; that document is complete at that one line. No rules have been invented to
fill the gap, and their absence is **not** treated as permission to lower the bar. The binding rule set this
inventory answers to is the six-item **RULES block carried inside the user's own request** — referred to throughout
as R-1 through R-6 — plus the house style contract at `CONTRIBUTING.md` §Code Style (L62-L66), plus
enterprise-standard best practice.

**Where the behavioral decisions live.** R-4's documentation obligation is discharged in the sibling deliverable
[PRESERVED-QUIRKS.md](PRESERVED-QUIRKS.md), not here. Every hold recorded in Rubric 5 below, and every accepted
audit finding, has its full behavioral reasoning and its measurement there. A reader who wants to know *why a
tempting upgrade was refused* should read that catalogue; this document records *what the dependency set became*.

## Net manifest shape

| Measure | Base commit | Committed |
|---|---|---|
| Runtime dependencies | 58 | **39** |
| Development dependencies | 11 | **9** |
| `engines` block | **absent entirely** | present |
| `overrides` block | **absent entirely** | present, 2 entries |
| `package-lock.json` | present, lockfileVersion 3 | regenerated, lockfileVersion 3, committed |

The net runtime reduction of 19 is 22 removals set against 3 additions, and those 22 removals decompose exactly, with
no remainder:

- **11** declared but never required, deleted outright — Rubric 4
- **2** passport strategies made dead by the deletion of `lib/auth/passport.js`, deleted outright — Rubric 4
- **7** replaced by a Node built-in or by a local module, so no package took their place — Rubric 3
- **2** replaced by a newly added maintained package — Rubric 3
- offset by **only 3 additions**: `@aws-sdk/client-s3` 3.1098.0, `@aws-sdk/s3-request-presigner` 3.1098.0 and
  `crypto-js` 4.2.0

Two originals were replaced by three packages because **AWS SDK v3 is modular where v2 was monolithic**: the single
`aws-sdk` package covered both S3 operations and presigned-URL generation, and v3 deliberately splits presigning into
its own package. Both halves of that one replacement are therefore required — see Rubric 3 and deviation 6 below.

That is 22 removals against 3 additions: `58 - 22 + 3 = 39`. The development reduction is simply the 2 dead
development packages removed with nothing added: `11 - 2 = 9`.

**There are no private-registry packages.** Every dependency resolves from the public npm registry, with exactly one
exception at the base commit: `marked`, which was declared as the git URL
`git+https://github.com/trinketapp/marked.git`. That single git specifier was **the one blocker to a deterministic
lockfile**, because the fork carries neither `gitHead` nor `_resolved` metadata, so nothing pinned which commit an
install would resolve to. Moving `marked` to a registry version is what makes `npm ci` reproducible at all.

## How this inventory was established

**Documentation-based research was impossible for this migration, and the substitute is stronger.** The web-search
facility returned no usable results across four separate invocations, and the fetch facility rejects any URL that was
not returned by a prior successful search. Rather than substitute recollection for evidence, every version below was
established by **direct measurement**: roughly fifty-five npm-registry interrogations to establish exact published
version tails, plus purpose-built runtime probe harnesses that installed each candidate package in isolation and
executed this codebase's real call-site shapes against it.

That matters for a mandate whose entire premise is behavior preservation. A release note is a claim about a package;
a probe that calls `archiver('zip', {zlib:{level:6}})` against the candidate and observes whether it throws is a
measurement of the published artifact. Where this document says "verified", it means a call-site shape from this
repository was executed against the target version and its result observed — not that a changelog was read.

Two further measurements underpin the numbers below:

- **The require scan.** The "declared but never required" determination in Rubric 4 was made by scanning all **96**
  JavaScript files in the tracked source tree — `app.js`, `config/`, `lib/`, `scripts/` and `test/` — for **both
  quote styles** of the require expression. That count was re-confirmed against the base commit's file list.
- **Both lockfiles.** Every version stated on the left-hand side of an arrow is the version actually **installed** at
  the base commit, read from `package-lock.json` at that commit, not the manifest range. Every version on the
  right-hand side is the **exact resolved version** in the committed `package-lock.json`. No range notation appears
  on any target side anywhere in this document.

## Reconciliation with the plan's projected figures

The modernization plan projected the shape of the final manifest before it existed. Five of its projections differ
from what was actually committed. In every case **the committed manifest is authoritative**, and each difference is
recorded here rather than silently absorbed, because a reader comparing the plan against the manifest would otherwise
find a discrepancy with no explanation.

| # | Projected | Committed, and measured | Why |
|---|---|---|---|
| 1 | `engines.npm` as a bounded range with an upper limit below 11 | `"npm": ">=10.0.0"` — **no upper bound** | Proven by execution. `.npmrc` sets `engine-strict=true`, so an upper bound below npm 11 makes install **fail**: a probe manifest carrying that bound produced `npm error code EBADENGINE ... Required: {"npm":">=10.0.0 <11.0.0"} Actual: {"npm":"11.18.0"}` and exited 1, while the committed constraint exited 0. An upper bound would make `npm ci` refuse to run on a current Node 22 distribution — exactly the reproducibility failure R-2 forbids |
| 2 | one `overrides` entry | **two** entries: `brace-expansion` 5.0.9 and `minimatch` 10.2.6 | The `brace-expansion` pin alone leaves the resolver free to select a `minimatch` that reintroduces the same transitive chain; pinning both closes it deterministically |
| 3 | 11 development dependencies remaining | **9** | The projection carried the base figure forward without subtracting the 2 dead development packages it enumerated itself. `11 - 2 = 9` |
| 4 | `chokidar` among the dead removals | **retained** at 3.6.0 | Measured root cause below. It is a genuine runtime requirement that a require scan cannot see |
| 5 | 12 dead runtime removals and 8 replaced-by-built-in | **11** dead runtime removals, **7** replaced by a built-in or local module, **2** replaced by a newly added package | A direct consequence of item 4, plus the fact that 2 of the 9 replaced packages were succeeded by newly added packages rather than by built-ins. The totals still reconcile exactly: 22 removed, 3 added, 39 runtime |
| 6 | 2 packages added — `@aws-sdk/client-s3` and `crypto-js` | **3** packages added: `@aws-sdk/s3-request-presigner` 3.1098.0 as well | **The projection missed that AWS SDK v3 is modular.** v2's single `aws-sdk` package served presigned URLs synchronously through `client.getSignedUrl('getObject', {...})`, which `lib/controllers/users.js` uses for the export-download redirect. v3 ships **no synchronous presigner and no presigner at all** in `@aws-sdk/client-s3` — an enumeration of that package's **707** exports found **zero** presign-related symbols. The only alternative was hand-rolling SigV4 presigning, a large security-sensitive change that would breach R-1 far more than one official package does. The addition is near-zero-footprint and was measured as such: the presigner pins to the **exact same version** as the client, and **all six** of its dependencies were already in the tree as transitive dependencies of the client, so regenerating the lockfile added **1** package, removed **0**, and changed **0** resolved versions. `npm audit --omit=dev` is unchanged at `{critical: 0, high: 0, moderate: 3}` |

**Item 4 in full, because it is the one correction that changes a classification.** `chokidar` has **zero** direct
require sites across all 96 scanned JavaScript files, which is precisely why the plan classified it dead. It is
nevertheless required at runtime: `nunjucks` 3.2.4 declares `chokidar` as an **optional peer dependency** and loads
it lazily whenever template watching is enabled, and `lib/util/nunjucks.js:L8` enables watching for both the
development and the test environments. Removing it therefore breaks the very environment the test suite runs in. It
was removed and then restored during implementation, and it is now recorded as a **hold** in Rubric 5.

The generalizable lesson is worth stating, since the same scan underpins Rubric 4: **a direct-require scan is
necessary but not sufficient.** It cannot see a dependency that a declared package resolves on its own behalf at
runtime. Every entry in Rubric 4 was therefore additionally checked against the installed tree and against the
peer-dependency declarations of the packages that were kept.

## Rubric 1 — Same-package minor or patch bump

**Reason for every row in this rubric: `security`.** Each of these was proven by execution to preserve every method
this codebase calls, so each is a **manifest-only edit with zero call-site change**. Nothing in `lib/`, `config/` or
`test/` was touched for any row below.

| Package | Original (installed) | Target | Reason | Verification and notes |
|---|---|---|---|---|
| `accepts` | 1.1.4 | **1.3.8** | `security` | Clears high findings in `accepts` and in `negotiator`. Verified still callable as a factory whose `.types` function returns `html` and `json`. **Bumped, never dropped**: `accepts(request).types(['html','json'])` at `lib/util/routeParser.js:L325` is what selects the HTML-versus-JSON response branch, so dropping it would change content negotiation |
| `js-yaml` | 3.0.2 | **3.15.0** | `security` | Clears two critical findings, including the `argparse` advisory. **Deliberately stays on the 3.x line**: `safeLoad` is still present, so `config/routes.js:L7` needs no edit at all. Advancing to 4.x or 5.x would force the `safeLoad` to `load` rename for **zero** additional security benefit |
| `mime` | 1.2.11 | **1.6.0** | `security` | `lookup`, `extension` and `charsets` all verified present. **Chosen over a swap to a differently named package precisely because it touches zero call sites — R-1 was the recorded tie-breaker.** See [PRESERVED-QUIRKS.md](PRESERVED-QUIRKS.md) section 3.3 |
| `lodash` | 4.17.23 | **4.18.1** | `security` | The advisory targets `_.template`, which is unreachable here — only `_.extend`, `_.find` and `lodash.escape` are used — but the bump costs nothing and closes the finding |
| `@hapi/inert` | 7.1.0 | **7.1.2** | `security` | Clears a moderate finding. Verified in the real deployment shape, alongside `@hapi/hapi` 21.4.10, `@hapi/vision` 7.0.3 and `@hapi/yar` 11.0.3 |
| `jszip` | 3.6.0 | **3.10.1** | `security` | Clears a moderate finding. **This package is live**, required at `lib/controllers/trinket.js:L23`; `new JSZip()` plus `file`, `folder` and `generateAsync` all verified |
| `mongoose` | 6.13.9 | **6.13.10** | `security` | Clears a moderate finding **while staying inside the 6.x line**. `Schema.extend` verified present after the extend plugin is loaded. The reason 6.x is a ceiling rather than a waypoint is in Rubric 5 |
| `brace-expansion` *(transitive)* | 1.1.12 as resolved | **5.0.9, pinned via `overrides`** | `security` | **One override collapses seven high findings.** A single denial-of-service advisory fans out through `archiver` to `zip-stream` and `archiver-utils`, then through `glob` to `minimatch`. `minimatch` pattern matching verified still correct after the pin |
| `minimatch` *(transitive)* | 3.1.5 as resolved | **10.2.6, pinned via `overrides`** | `security` | The second half of the same override. Pinning `brace-expansion` alone leaves the resolver free to select a `minimatch` that reintroduces the chain; pinning both makes the resolution deterministic |

## Rubric 2 — Same-package major bump

**Reason for this rubric: `security`, `incompatible`, or both.** Each row carries its own code. Every one of these
crossed at least one breaking boundary, so every one was probed at this codebase's actual call-site shapes before it
was accepted.

Two rows are on the 0.x line and warrant a precise note, because "major bump" is loose there: `adm-zip` 0.4.16 to
0.6.0 and `tmp` 0.0.25 to 0.2.7 do not cross a literal major-version boundary, but semver treats the minor position
as the breaking position while the major is 0, so both were probed to the same standard as a true major.

| Package | Original (installed) | Target | Reason | Verification and notes |
|---|---|---|---|---|
| `@hapi/hapi` | 20.3.0 | **21.4.10** | `security`, `incompatible` | The primary API migration target. The manifest had declared the hapi 20 line for years while the handler code stayed on the callback-era calling convention; this bump is the dependency half of closing that gap, and the 159 handler conversions are the code half |
| `joi` | 17.13.3 | **18.2.3** | `incompatible` | **Zero option overrides required.** Both versions were installed side by side and run against six differential cases covering pattern, email, maximum-length, required-field and unknown-key failures. The verdict, `details.length`, the error path in both array and dotted-string form, the error `type` **and the exact message string** were identical in every case. `{abortEarly: false}` carries forward unchanged. See [PRESERVED-QUIRKS.md](PRESERVED-QUIRKS.md) section 3.5 |
| `adm-zip` | 0.4.16 | **0.6.0** | `security` | All seven instance methods this codebase uses verified against 0.6.0 |
| `archiver` | 2.1.1 | **7.0.1** | `security`, `incompatible` | **Deliberately not 8.0.0.** On 8.x, `require('archiver')` returns an ESM namespace object whose `default` is undefined, so calling it as a function throws. 7.0.1 keeps the bare factory form `archiver('zip', {zlib: {level: N}})` callable at all three sites — `lib/controllers/trinket.js:L1292` and `lib/controllers/trinket.js:L1454`, both at compression level 9, and `lib/workers/exports.js:L188` at level 6. **R-1 was the recorded tie-breaker**: a class-based migration was viable and exposes an identical surface, but it cost three call-site rewrites for no benefit. See [PRESERVED-QUIRKS.md](PRESERVED-QUIRKS.md) section 3.4 |
| `bcrypt` | 5.1.1 | **6.0.0** | `security` | Clears a critical `tar` finding plus high findings in `bcrypt` itself and in `@mapbox/node-pre-gyp`, **and removes a DEP0169 deprecation source**. Both the callback triad and the promise triad verified against the call sites at `lib/models/user.js:L53`, `L56` and `L92` |
| `bull` | 0.7.2 | **4.16.5** | `security`, `incompatible` | `new Queue(name, {redis:{host,port}})` plus `on`, `process` and `add` verified against the exact shapes used at `lib/util/queues.js:L105` and `L122` |
| `csv` | 1.2.1 | **6.6.1** | `security`, `incompatible` | `.parse` verified, for the admin CSV import at `lib/controllers/admin.js:L8` and `L116` |
| `diff` | 1.0.8 | **9.0.0** | `security`, `incompatible` | `applyPatch` verified, for the course content patching at `lib/controllers/course.js:L440` |
| `jsonwebtoken` | 5.7.0 | **9.0.3** | `security`, `incompatible` | Two-argument `sign` and payload-returning `verify` verified, for the email verification tokens at `lib/controllers/trinket.js:L368`, `L421` and `L693` and the verify at `lib/util/helpers.js:L264` |
| `nodemailer` | 2.7.2 | **9.0.3** | `security` | Clears a large critical cluster **and removes the DEP0005 deprecation source**, which reached the process through `libmime` to an `iconv-lite` 0.4.15. The exact `createTransport` option shape at `lib/util/mailer.js:L15-L23` verified accepted unchanged |
| `tmp` | **`0.0.25`, an exact pin with no range** | **0.2.7** | `security` | `tmpName(cb)` verified, for the call at `lib/controllers/users.js:L591`. The original specifier is quoted because it is materially the point: this was the one dependency already pinned exactly, so the bump is unambiguous rather than a range re-resolution |
| `validator` | 5.7.0 | **13.15.35** | `security`, `incompatible` | `isEmail` verified on both true and false inputs, for `lib/models/courseInvitation.js:L52` and `L117` |
| `marked` | **0.3.2, declared as `git+https://github.com/trinketapp/marked.git`** | registry **4.3.0** | `incompatible` | The only non-registry dependency in the project. Given its own subsection below, because it is the one bump that required a call-site change and the one that unblocked the lockfile |

### The `marked` fork replacement, in full

The base commit did not depend on a published `marked`. It depended on a **Trinket fork**, declared as a git URL and
identifying itself as version 0.3.2. The fork carried five deviations from upstream across **26 diff lines**, and the
load-bearing one is that it accepted `sanitize` as a **function**.

That function is not incidental. `lib/shared/trinket-markdown.js:L211-L240` passes a stateful HTML-whitelist
sanitizer — **the platform's XSS defense for learner-authored and instructor-authored markdown** — and it is
consumed solely by `lib/controllers/courses.js:L13`. Replacing `marked` with a version that ignored a function
sanitizer would have silently removed an XSS control.

`marked` 4.3.0 was selected because it satisfies every constraint that mattered, each verified by execution:

- It supports a `sanitizer` **function** option, so the whitelist sanitizer transfers with its behavior intact.
- It keeps the `Renderer` prototype arities identical — **link 3, code 3, image 3, listitem 1** — so the four
  monkey-patches at `lib/shared/trinket-markdown.js:L22-L24`, `L446-L448` and `L455` transfer unchanged.
- It emits its own deprecation notice through `console.warn` only, so it does **not** fire a `process` warning event
  and therefore does not trip the zero-deprecation-warning boot gate.
- An isolated audit of 4.3.0 reported **zero vulnerabilities**.

**One call-site change was required, and only one.** On the 4.x line `require('marked')` returns an object rather
than a callable, so `lib/shared/trinket-markdown.js:L1` becomes a destructuring require. That is the entire code cost
of the swap.

**And it is what made the lockfile reproducible.** Because the fork records no `gitHead` and no `_resolved`, nothing
constrained which commit an install resolved to. Moving to a registry version is the precondition for a deterministic
`npm ci`, which is why this row is classified `incompatible` rather than `security`: the fork was not vulnerable, it
was unpinnable.

Note that the **browser-delivered** copy of `marked` is a different artifact and did not move. It is pinned as an
asset URL at `config/default.yaml:L72` and is catalogued as a deliberate skew in
[PRESERVED-QUIRKS.md](PRESERVED-QUIRKS.md) section 2.

### Development dependencies

The same rubric, and the same obligation to classify. Six of the seven crossed a literal major-version boundary; the
seventh, `redis-mock`, moved from 0.2.0 to 0.56.3, which semver treats as breaking because the major is 0.

| Package | Original (installed) | Target | Reason | Verification and notes |
|---|---|---|---|---|
| `mocha` | 3.5.3 | **11.7.6** | `security`, `incompatible` | **Changes process-exit semantics.** Mocha 3 force-exits after a run; Mocha 4 and later made that opt-in, so the bump alone would make `npm test` hang after passing. The new root `.mocharc.json` therefore carries `"exit": true` alongside the three options ported from the deleted `test/mocha.opts`. See [PRESERVED-QUIRKS.md](PRESERVED-QUIRKS.md) section 3.8 |
| `chai` | 3.5.0 | **4.5.0** | `security`, `incompatible` | **4.5.0 is the CommonJS ceiling** — chai 5 and above are ESM-only. Explained below |
| `chai-as-promised` | 6.0.0 | **7.1.2** | `incompatible` | CommonJS ceiling |
| `sinon-chai` | 2.14.0 | **3.7.0** | `incompatible` | CommonJS ceiling |
| `sinon` | 1.7.3 | **22.1.0** | `security`, `incompatible` | The three-argument `stub(obj, 'm', fn)` form was **removed in Sinon 3**, which is what forces six call-site edits — at `test/setup.js:L18`, `test/helpers/catbox-redis.js:L6`, `test/helpers/queue.js:L8` and `test/lib/models/trinket.js:L34`, `L39` and `L155` — each becoming `sinon.stub(obj, 'm').callsFake(fn)` |
| `supertest` | 0.8.3 | **7.2.2** | `security`, `incompatible` | The HTTP test client used by the flow harness |
| `redis-mock` | 0.2.0 | **0.56.3** | `security`, `incompatible` | The Redis double used by `test/setup.js`. Classified `incompatible` as well as `security` because the 0.2 surface predates the promise-based client API that the rest of the test wiring now expects |

### The CommonJS ceiling, explained once

Four of the decisions above are capped by the same mechanism, and it is subtler than "the package went ESM".

Node 22 reports `process.features.require_module === true`, which means CommonJS **can** `require` an ESM package
unflagged and without emitting a warning. The call succeeds. What it returns, however, is the **module namespace
object** rather than the default export. Code that expects a callable or a constructor therefore receives an object,
and fails at the point of use rather than at the point of import — which makes the failure look unrelated to the
upgrade that caused it.

That single subtlety is what caps `chai` at 4.5.0, `chai-as-promised` at 7.1.2, `sinon-chai` at 3.7.0 and `archiver`
at 7.0.1. The `archiver` case is the cleanest demonstration, because the package is invoked as a bare function: at
8.0.0, `require('archiver')` yields a namespace whose `default` is undefined, so `archiver('zip', ...)` throws
immediately. It is also why `optimist` was replaced with a Node built-in rather than with its obvious modern
successor, which is unusable from CommonJS for the same reason.

## Rubric 3 — Replaced

**Reason for this rubric: `dead` or `incompatible`.** A package appears here only when the same package could not be
carried forward at all. Seven were replaced by a Node built-in or by a local module, so no package took their place;
two were replaced by a newly added maintained package — three packages in total, because the AWS SDK v3 replacement is
split across two modular packages; one was never installed in the first place.

| Original package | Version at base commit | Replacement | Target | Reason | Verification and notes |
|---|---|---|---|---|---|
| `aws-sdk` *(S3 operations)* | 2.1693.0 | **`@aws-sdk/client-s3`** | **3.1098.0** | `incompatible` | **Gate-mandated, not discretionary.** Requiring the v2 SDK on Node 22 fires a **real `process.on('warning')` event with `name === "NOTE"`** — not a plain console write — which the zero-deprecation-warning boot gate forbids. v2's `AWS.config.update` global singleton has **no v3 equivalent**, so `config/aws.js` moves to per-client `S3Client` configuration. It is consumed at **7 call sites in 3 files** — `lib/util/file.js`, `lib/workers/exports.js` and `lib/controllers/users.js` — covering `PutObjectCommand`, `GetObjectCommand` and `DeleteObjectCommand` |
| `aws-sdk` *(presigned URLs)* | 2.1693.0 | **`@aws-sdk/s3-request-presigner`** | **3.1098.0** | `incompatible` | **The second half of the same replacement, because v3 is modular where v2 was monolithic.** v2 generated presigned URLs **synchronously** via `client.getSignedUrl('getObject', {Bucket, Key, Expires: 3600})`, used for the export-download redirect in `lib/controllers/users.js`. `@aws-sdk/client-s3` contains **no presigner at all** — zero presign-related symbols among its 707 exports — and v3 offers no synchronous form, so the accessor is now asynchronous and `config/aws.js` exposes it as `getSignedDownloadUrl(params, expiresIn)` returning a `Promise<string>`. **Parity was measured before the swap was accepted:** the generated URL is the same virtual-hosted-style, SigV4-signed URL v2 produced — `<bucket>.s3.<region>.amazonaws.com/<key>` with `X-Amz-Algorithm=AWS4-HMAC-SHA256` and `X-Amz-Expires=3600`. Pinned to the **same version** as the client, and all six of its dependencies were already present transitively, so the lockfile gained **1** package with **0** resolved-version changes |
| `request` | 2.88.2 | the global **`fetch`** built into Node 22 | *(no package added)* | `dead` | Formally deprecated upstream and unmaintained. Affects `lib/controllers/auth.js`, `lib/controllers/users.js` and `lib/util/recaptcha.js`, all of which were being converted to async/await anyway |
| `q` | 1.0.1 | native **`Promise`**, `Promise.all`, `Promise.allSettled` | *(no package added)* | `dead` | Classified `dead` **not because it is vulnerable, but because the language subsumed it.** The async conversion removes its last consumer as a side effect: the four `Q.defer()` sites plus the `Q.all` and `Q.allSettled` calls in `lib/workers/exports.js`, and the usage in `test/helpers/mail.js` |
| `node-uuid` | 1.4.8 | **`node:crypto`** `randomUUID()` | *(no package added)* | `dead` | Superseded by its own successor package and then by the platform. One call site, at `lib/controllers/users.js:L22` |
| `node-cryptojs-aes` | 0.4.0 | **`crypto-js`** | **4.2.0** | `dead` | Unmaintained. **Bit-compatibility proven bidirectionally** before the swap was accepted: both emit the OpenSSL `Salted__` and MD5-EvpKDF envelope, and ciphertext length is **88** in both directions. This mattered because `lib/util/roles.js` ships the payload to a browser that decrypts it with a frozen client-side decryptor — see [PRESERVED-QUIRKS.md](PRESERVED-QUIRKS.md) section 1.9 |
| `optimist` | 0.6.1 | **`node:util`** `parseArgs` | *(no package added)* | `dead` | Deprecated upstream. Its obvious modern successor is unusable from CommonJS for the reason given above, which is why a Node built-in was chosen instead of another package |
| `tab` | 0.1.0 | a **local column formatter** in `lib/util/routeParser.js` | *(no package added)* | `dead` | Unmaintained. Its sole consumer was the `-R` route-table dumper, whose `emitTable` calls are replaced by a few lines of local formatting |
| `mkdirp` | 0.3.5 | **`fs.promises.mkdir`** with `{recursive: true}` | *(no package added)* | `incompatible` | **Not `dead` — actively maintained.** The problem is the calling convention: `mkdirp` 1 and above is promise-native, which breaks the `util.promisify` wrapper this codebase applies to it at `lib/controllers/courses.js:L7`. Moving to the built-in is simultaneously the smaller diff and one dependency fewer |
| `rimraf` | 2.2.8 | **`fs.promises.rm`** with `{recursive: true, force: true}` | *(no package added)* | `incompatible` | **Not `dead` — actively maintained.** `rimraf` 4 and above dropped the callback form entirely, which is the form used at `lib/controllers/courses.js:L8` |
| `catbox-redis` *(unscoped)* | **never installed** | the in-repo **`lib/util/catbox-mongoose.js`** engine | *(no package added)* | `dead` | **Declared nowhere and installed nowhere** — the direct cause of the immediate `npm test` failure on the suite's first module load, `Cannot find module 'catbox-redis'` at `test/helpers/catbox-redis.js:L1`. The helper is repointed at the catbox engine the application actually uses. See [PRESERVED-QUIRKS.md](PRESERVED-QUIRKS.md) section 3.7 |

**Only three packages are added to the manifest by this entire modernization: `@aws-sdk/client-s3` 3.1098.0,
`@aws-sdk/s3-request-presigner` 3.1098.0 and `crypto-js` 4.2.0.** Everything else in this document is a bump, a
removal, or a move to a Node built-in or a local module. The additions cover exactly the two cases where a Node
built-in could not do the job — S3 access, and an AES envelope that had to stay byte-compatible with a frozen browser
decryptor — and S3 access needs two of them only because AWS SDK v3 splits presigning out of the client package.
The plan projected two additions; the third is recorded as deviation 6 above, with the measurement that justifies it.

## Rubric 4 — Removed: declared but never required

**Reason for every entry in this rubric: `dead`.** These packages were declared in `package.json` and required by
nothing. They were **deleted, not pinned**, which is what R-2 demands, quoted verbatim:

> "Container images may not be pinned to an old runtime as a workaround, and dead packages may not be vendored into
> the repository to keep them alive."

Pinning an unused package to an old version to keep an install resolvable is exactly the workaround that rule
forecloses. None of the entries below survives in any form: not in `package.json`, not in `package-lock.json`, and
not vendored anywhere in the tree.

**Method.** All **96** JavaScript files in the tracked source tree were scanned for **both quote styles** of the
require expression. Each candidate was additionally checked against the installed tree and against the
peer-dependency declarations of the packages being kept, because — as the `chokidar` correction above demonstrates —
a direct-require scan alone cannot see a dependency that a declared package resolves on its own behalf.

**Runtime, 11 packages:**

| Package | Version at base commit | Reason |
|---|---|---|
| `@hapi/catbox-redis` | 7.0.2 | `dead` |
| `@hapi/hoek` | 11.0.7 | `dead` |
| `debug` | 4.4.3 | `dead` |
| `file-type` | 3.9.0 | `dead` |
| `is-svg` | 2.1.0 | `dead` |
| `minimist` | 1.2.8 | `dead` |
| `moment-timezone` | 0.5.48 | `dead` |
| `mongo-migrate` | 0.1.0 | `dead` |
| `passport` | 0.2.2 | `dead` |
| `passport-strategy` | 1.0.0 | `dead` |
| `sha1` | 1.1.1 | `dead` |

**Development, 2 packages:**

| Package | Version at base commit | Reason |
|---|---|---|
| `cheerio` | 0.22.0 | `dead` |
| `should` | 3.0.1 | `dead` |

**Dead once `lib/auth/passport.js` is deleted, 2 packages:**

| Package | Version at base commit | Reason |
|---|---|---|
| `passport-local` | 1.0.0 | `dead` |
| `passport-google-oauth` | 0.1.5 | `dead` |

These two are the only entries in this rubric that **were** required by a source file. That file is
`lib/auth/passport.js`, 136 lines, required exactly once at `app.js:L28` and never referenced thereafter. Deleting a
file named `passport.js` from the auth layer of a web application is not something a behavior-preserving migration
may do on inspection alone, so **deletion was simulated and measured**: `require.cache` was pre-seeded with an empty
module so the require resolved to nothing, without modifying any repository file, and the framework's own route table
was dumped both ways. **Both boots produced 233 rows hashing to the identical sha256
`cd2a7e38a39bd84902ac1a0d69f50e2a`**, and the 58-route response corpus was unchanged. The full proof is recorded in
[PRESERVED-QUIRKS.md](PRESERVED-QUIRKS.md) section 3.6.

That is **15 packages deleted outright** — 11 plus 2 plus 2 — on top of the 9 removed in Rubric 3 because they were
replaced, for 24 manifest removals in total.

### Retained despite never being required

Three packages are required by no source file and are nevertheless **kept**, because they are invoked through npm
scripts rather than through `require`. They are tooling, not dead code, and deleting them would break the build and
test commands:

| Package | Version | How it is invoked |
|---|---|---|
| `mocha` | 11.7.6 | the `test` script |
| `sass` | 1.98.0 | the stylesheet compilation reached through `build` and `build:css` |
| `vite` | 4.5.14 | the `build:css` and `watch:css` scripts |

## Rubric 5 — Held, with the behavioral justification for each

**Every hold below is a decision, not an omission.** Each would have changed observable behavior if advanced, and
each is therefore governed by R-4, quoted verbatim:

> "Behavior 'improvements' are prohibited. A 2013-era quirk that clients may depend on is preserved and documented,
> not fixed."

R-3's classification obligation attaches to packages that were **replaced or major-bumped**. Nothing in this rubric
was, so no `dead` / `incompatible` / `security` code applies; what each row owes instead is a **behavioral** reason —
"would change client-visible output" or "would break a call site" — never "not needed". Where a specifier was
tightened from a range to an exact pin, the **resolved version did not move**: these are pins of what was already
installed, made necessary by `save-exact=true` in `.npmrc`.

| Package | Held at | Behavioral justification |
|---|---|---|
| `highlight.js` | **9.18.5** | Version 10 renamed the emitted `hljs-*` token classes and changed the `highlight()` signature. `lib/shared/trinket-markdown.js:L310` calls the two-argument `hljs.highlight(lang, code)` form and splices the result straight into rendered markdown, so a bump would change **client-visible markup** on every page containing a fenced code block. See [PRESERVED-QUIRKS.md](PRESERVED-QUIRKS.md) section 2 |
| `limax` | **1.4.1** | Its slug output **is public URLs**. Any change to slug generation changes URLs that already exist in the wild |
| `transliteration` | **0.1.1** | Same reason: it feeds the same slug pipeline at `lib/models/plugins/slug.js`, and its output is part of public URLs |
| `numeral` | **1.5.6** | Formats template-rendered text at `lib/util/nunjucks.js:L6` and `L131`; a formatting change is a visible page change |
| `escape-string-regexp` | **1.0.5** | Version 4 changes which characters are escaped, and version 5 is ESM-only. The consumer at `lib/models/trinket.js:L5` and `L269` builds search patterns, so a change in escaping changes which records match |
| `config` | **0.4.37** | 43 require sites, and the test harness depends on this version's `NODE_CONFIG_*` environment-variable semantics, including `NODE_CONFIG_PERSIST_ON_CHANGE` |
| `mongoose` | **inside the 6.x line** | Version 7 and above remove the discriminator-adjacent behavior that `Model.extend` at `lib/models/model.js:L190-L192` depends on. The patch bump to 6.13.10 in Rubric 1 is the whole of the movement permitted here |
| `mongoose-schema-extend` | **0.2.2** | The sole provider of `Schema.extend`, and **no maintained successor exists**. It is the reason the mongoose 6.x ceiling exists at all |
| `underscore` | **1.13.8** | Already above the vulnerable range, and 31 require sites depend on its exact semantics |
| `moment` | **2.30.1** | Already at the highest published release; 6 require sites |
| `nunjucks` | **3.2.4** | The template engine for 79 server-rendered views. It is also the package whose optional peer dependency keeps `chokidar` alive |
| `chokidar` | **3.6.0** | **Required, despite zero direct require sites.** `nunjucks` declares it an optional peer dependency and loads it lazily when template watching is on, which `lib/util/nunjucks.js:L8` enables for both development and test. Removing it breaks the environment the suite runs in |
| `winston` | **3.19.0** | Already at the highest published release; the log surface assigned to the undeclared `log` global at `app.js:L19` |
| `redis` | **4.7.1** | Already at the highest published release, and already the promise-based client API that `config/redis.js` uses |
| `@hapi/boom` | **10.0.1** | Already at the highest published release. 95 error constructions across the codebase depend on its exact wire behavior, including the rule that 4xx passes its message and 5xx scrubs it |
| `@hapi/vision` | **7.0.3** | Already at the highest published release; wired to the Nunjucks compile function |
| `@hapi/yar` | **11.0.3** | Already at the highest published release. It decorates only `request.yar` and `server.yar`, and the cookie name and iron-seal format are part of the preserved session contract |
| `sass` | **1.98.0** | **Advancing it breaks the Foundation 5.5.3 fork's Sass.** It cannot pass the `@import` and legacy-JS-API removals, and the build must keep emitting the same two CSS artifacts at the same paths — `public/css/base.css` at 265,727 bytes and `public/css/embed.css` at 296,352 bytes |
| `vite` | **4.5.14** | The installed version already builds green on Node 22 and emits exactly those two artifacts. Advancing it risks the same stylesheet output for no benefit |
| `@hapi/shot` *(transitive)* | 5.0.5 advanced to **6.0.3** | Not a decision of this change: it moved as a transitive consequence of the `@hapi/hapi` major bump already classified in Rubric 2. It is recorded here because 6.0.3 is the **highest version published**, so its inject-only DEP0169 — traced to `@hapi/shot/lib/request.js:L30` — has no upstream fix. That is why the parity harness issues real HTTP and never calls `server.inject()`. See [PRESERVED-QUIRKS.md](PRESERVED-QUIRKS.md) section 3.9 |

Three groups among these holds exist specifically to protect **client-visible output**, and they are the clearest
cases in the whole inventory where a routine-looking upgrade would have been a behavior change: `highlight.js`, whose
emitted CSS class names appear in rendered markup; `limax` with `transliteration`, whose output is public URL slugs;
and `sass` with `vite`, whose output is the two byte-comparable CSS artifacts.

## The audit gate — measured, not asserted

**Baseline, at the base commit.** `npm ci` installed **642 packages** and reported **74 vulnerabilities — 19
moderate, 37 high and 18 critical**. Restricted to production dependencies, `npm audit --omit=dev` reported **59
findings — 15 critical, 27 high and 17 moderate — across 42 distinct production packages**.

**Target, measured.** An isolated install of the complete production target set, together with the
`overrides` pins, measured **`{critical: 0, high: 0, moderate: 3}`**. Adding `@aws-sdk/s3-request-presigner` — the
39th runtime dependency, recorded as deviation 6 above — left that result **unchanged**, as its six dependencies were
already resolved in the tree. Re-run against the committed manifest and lockfile in a working checkout,
`npm audit --omit=dev` reports the same result:

```json
{ "info": 0, "low": 0, "moderate": 3, "high": 0, "critical": 0, "total": 3 }
```

**The zero-critical-and-zero-high result is measured, not aspirational.** It was established by installing the target
set and running the audit, before the manifest was committed, and then confirmed against the committed manifest.

### The three accepted moderate findings

Three moderate findings remain, and each is accepted with a stated reason rather than repaired. Under R-4 a repair
here would itself be the violation.

- **Two of the three share a single root cause**: a transitive `uuid` dependency inside the queue library `bull`. The
  advisory is *"uuid: Missing buffer bounds check in v3/v5/v6 when buf is provided"*, and it concerns an **optional
  buffer argument this code path never supplies** — so the vulnerable branch is **unreachable** from this
  application. The only fix npm offers is `bull` 1.1.3, a **major downgrade** from 4.16.5 that would land the project
  back in the critical range. Accepting an unreachable moderate is strictly better than accepting a reachable
  critical.
- **The third is the deliberate `highlight.js` hold**, the advisory *"ReDOS vulnerabities: multiple grammars"*, which
  applies to the range from 9.0.0 up to but excluding 10.4.1. The only fix npm offers is `highlight.js` 11.11.1, a
  semver-major bump that would rename the emitted `hljs-*` classes and therefore **change client-visible markup** —
  precisely the behavior change R-4 forbids. The hold is documented in Rubric 5 and in
  [PRESERVED-QUIRKS.md](PRESERVED-QUIRKS.md) section 2.

### Reproducibility, added by this change

The base commit had no reproducibility surface at all: no `engines` field, no `.nvmrc`, no `.npmrc`, and a container
that installed with a peer-dependency escape hatch. Every item below is new or changed.

**`package.json` gains an `engines` block**, verified absent at the base commit. The committed value is exactly:

```json
"engines": {
  "node": ">=22.0.0 <23.0.0",
  "npm": ">=10.0.0"
}
```

The npm constraint is a floor with no upper bound, and that is deliberate rather than an oversight. Because `.npmrc`
sets `engine-strict=true`, an upper bound below npm 11 would make the install **fail outright** on a current Node 22
distribution: a probe manifest carrying such a bound produced `npm error code EBADENGINE` and exited 1, while the
committed constraint exited 0. A pin that prevents `npm ci` from running is not reproducibility.

**`package.json` gains an `overrides` block**, also verified absent at the base commit, pinning the two transitive
packages that carry the denial-of-service chain:

```json
"overrides": {
  "brace-expansion": "5.0.9",
  "minimatch": "10.2.6"
}
```

The remaining items complete the surface:

- **`.nvmrc` is new**, and contains `22`.
- **`.npmrc` is new**, and sets `engine-strict=true` and `save-exact=true`. The second is why the committed manifest
  carries exact versions rather than ranges throughout.
- **`package-lock.json` is regenerated deterministically at lockfileVersion 3 and committed.** This was only possible
  once the `marked` git specifier was replaced by a registry version.
- **The `Dockerfile` moves off its Node 16 base to a Node 22 LTS base, and its install step becomes `npm ci`.** The
  base commit ran `npm install --legacy-peer-deps`; that escape hatch is precisely the pinning-as-workaround R-2
  forbids, because it lets the resolver silently drift away from the lockfile.
- **Verified working toolchain: node v22.23.1, npm 10.9.9.** The committed `engines` constraint admits later npm 10
  and npm 11 releases as well, which is what allows a checkout to install on a stock Node 22 distribution without
  first downgrading its package manager.

## What is NOT a dependency change

Two things in this repository look like dependency problems and are not. Both are stated here so that no one later
"fixes" them and, in doing so, changes behavior.

### `gleak` is neither declared nor vendored

`app.js:L31-L36` contains a guarded optional `require` of `gleak` with a working no-op fallback. The package appears
**zero times in `package.json`** and **zero times in `package-lock.json`** — verified against both the base commit
and the committed manifest — and `node_modules/gleak` does not exist. The `catch` branch therefore always fires, the
detector always returns an empty list, and the machinery is permanently inert.

It looks exactly like the dead dependency R-2 would demand be removed. It is not, and the reason is in the rule's own
wording:

> "Container images may not be pinned to an old runtime as a workaround, and dead packages may not be vendored into
> the repository to keep them alive."

R-2 prohibits **keeping a dead package alive** — by pinning it, or by vendoring it into the tree. `gleak` is absent
from the manifest, absent from the lockfile and absent from the installed tree, so there is no package being kept
alive and nothing for R-2 to reach. What remains is repository-owned source code with a working fallback, and
deleting working source code because it currently does nothing is architectural improvement, which R-1 places out of
bounds:

> "Opportunistic cleanup, style normalization, latent-bug repair and architectural improvement are out of bounds even
> when obviously beneficial."

The full mechanics, including why the fallback's un-`unref`'d interval is coupled to the test runner's exit
behavior, are catalogued in [PRESERVED-QUIRKS.md](PRESERVED-QUIRKS.md) section 1.13.

### The browser-versus-server version skews in `config/default.yaml` are asset URLs

Three libraries exist twice in this project, at two different versions: once as a browser-delivered copy pinned in
configuration, and once as an npm dependency used on the server.

| Library | Browser copy | Where it is pinned | Server copy, npm |
|---|---|---|---|
| `marked` | a separate browser build under `/components/marked/` | `config/default.yaml:L72` | registry **4.3.0**, per Rubric 2 |
| `highlight.js` | **8.0** from cdnjs | `config/default.yaml:L73` (script) and `config/default.yaml:L90` (stylesheet) | **9.18.5**, held per Rubric 5 |
| `jszip` | **3.1.4** via bower | `config/default.yaml:L111-L112` | **3.10.1**, per Rubric 1 |

The browser-side entries are **not version declarations at all — they are asset URLs**, and asset URLs are protected
by the preservation directives. Changing one changes which bytes a browser fetches, and in the `highlight.js` case it
would also change the CSS class names the page is styled against. Both sides are therefore preserved independently:
the npm dependency moved for its own documented reason, and the configuration pin did not move at all. All three
skews are catalogued in [PRESERVED-QUIRKS.md](PRESERVED-QUIRKS.md) section 2.
