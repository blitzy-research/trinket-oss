# Dependency Inventory

The record of every dependency this migration **changed**: replaced, major-bumped, removed or newly
added, each with its registry, its original and final resolved versions, its reason and the
measurement that verifies it.

- **Base commit (baseline for every "before" value):** `2f8712a`
- **Target runtime:** Node 22 LTS — measured `node v22.23.2`, `npm 10.9.8`
- **Framework move:** `@hapi/hapi` 20.3.0 → 21.4.10, with the 2013 callback idiom converted to
  `async (request, h)` lifecycle methods
- **Repository:** refactored in place; no dependency was vendored, forked or relocated

## Scope of this document, and where the rest lives

This file owns what changed. Three companion documents own the rest, and nothing here is duplicated
from them:

| Document | Owns |
|---|---|
| [`deferred-dependencies.md`](deferred-dependencies.md) | Every package deliberately **left in place** — unmaintained-but-functional, moderate-only, or otherwise not qualifying — with its per-package reasoning, plus the two approved deviations and their precedence arguments |
| [`preserved-quirks.md`](preserved-quirks.md) | Behaviour preserved unchanged, including behaviour that is a defect, with the target disposition that reproduces each |
| [`baseline-parity.md`](baseline-parity.md) | How baseline was captured and compared: worktree provenance, corpus method, coverage accounting and the resolution log |

**Rules governing this record.** `review_rules` reports **no user-specified rules** for this project.
Nothing has been invented in their place. The binding constraints are therefore the request's own
RULES block — **R-a** (the diff reads as four things and nothing else), **R-b** (no vendored dead
packages, no container pinned to an old runtime), **R-c** (this document and its deferred companion
are its two named deliverables), **R-d** (behaviour improvements prohibited) — held to enterprise
practice for a runtime and framework migration: cite the evidence, commit a reproducible lockfile,
pin the runtime, and never state a version that was not read from the delivered tree.

**Evidence discipline.** Every version, count and figure below was measured against the delivered
tree, not carried over from the plan. Resolved versions come from the delivered `package-lock.json`;
baseline resolved versions from `git show 2f8712a:package-lock.json`; declared ranges from the
respective `package.json`; the image digest and `pm2` pin from the delivered `Dockerfile`; audit
figures from `npm audit --omit=dev`. Where a measurement disagreed with the planned expectation, the
**measurement is recorded and the disagreement is logged** in
[§8 Measurement discrepancy log](#8-measurement-discrepancy-log). Twelve such disagreements were
found.

**A declared range is not a resolved version.** The baseline manifest declares ranges throughout —
`@hapi/hapi ^20.0.0`, `joi ^17.0.0`, `mime ~1.2.11`, `js-yaml ~3.0.1` — with `tmp: "0.0.25"` its one
exact pin. Every row below therefore carries four version values, so that a caret that floated
forward is visible as a float rather than as a decision.

## 1. The triage rule

One rule produced every disposition in this migration, and it was applied uniformly:

> A package changes only for a demonstrated **Node 22 or hapi 21 incompatibility**, a **runtime
> deprecation warning**, a **dead declaration**, or a **critical-or-high advisory**. A
> **moderate-only** finding with no incompatibility is **deferred, not bumped**.

**R-c is what makes advisory-driven changes blocking.** The request asks for dependency replacement
"only where blocking" and, separately, for a clean `npm audit --omit=dev`. Those two read as a
contradiction until R-c names *security* as a permitted reason for a replacement. That single word is
the whole reconciliation: it is why fifteen of the sixteen rows in §3 are advisory-driven and still
sit inside a blocking-only scope. Without it a reviewer would be right to read this table as scope
creep.

**Every direct dependency has exactly one disposition** — changed (§3), removed (§4), or deferred
(the companion document). None is listed twice and none is unaccounted for. The corollary matters as
much as the rule: a package that is merely old, merely unmaintained, or carries only a moderate
finding appears in the deferred list and **not here**. `archiver` 2.1.1, `mongoose` 6.x, `jszip`
3.6.0, `highlight.js` 9.18.5, `aws-sdk` 2.1693.0, `q` 1.0.1 and `config` 0.4.37 are all in that
position, and all were verified unchanged: `@hapi/boom` 10.0.1, `@hapi/vision` 7.0.3, `@hapi/yar`
11.0.3, `nunjucks` 3.2.4, `redis` 4.7.1, `winston` 3.19.0, `moment` 2.30.1, `underscore` 1.13.8,
`mongoose-schema-extend` 0.2.2, `escape-string-regexp` 1.0.5, `limax` 1.4.1, `node-cryptojs-aes`
0.4.0, `numeral` 1.5.6, `tab` 0.1.0 and `transliteration` 0.1.1 all resolve to the same version
before and after.

**One row does not satisfy the rule on severity alone, and is flagged rather than smoothed over.**
`@hapi/inert`'s baseline finding is *moderate*, not high, and `@hapi/inert` declares no peer
dependency on `@hapi/hapi`, so nothing forced it. It was taken as a zero-API-surface patch inside the
same major, alongside the hapi bump it accompanies. Row note 2 in §3 states this in full; it is the
only exception in the table and pretending otherwise would misrepresent how uniformly the rule was
applied.

## 2. What changed, at a glance

| | Baseline (`2f8712a`) | Delivered |
|---|---|---|
| Production dependencies declared | 58 | **39** |
| Development dependencies declared | 11 | **8** |
| Packages in the root lockfile | 678 | **456** |
| Version moves | — | **16** |
| Declarations removed | — | **23** (19 production, 4 development) |
| Declarations added | — | **1** (`mongodb-memory-server`) |
| `npm audit --omit=dev` | 15 critical, 28 high, 16 moderate — **59** | 0 critical, **1 high**, 5 moderate — **6** |
| Node-bearing Dockerfiles on a current runtime | 0 of 9 | **9 of 9** |

Counts verified on the delivered manifest:

```console
$ node -e "const p=require('./package.json'); \
    console.log(Object.keys(p.dependencies).length, Object.keys(p.devDependencies).length)"
39 8
```

## 3. Version moves

Sixteen packages moved. Registry is the public npm registry for every row — each `resolved` field in
the delivered lockfile is a `https://registry.npmjs.org/...` URL. No row is a private, vendored or
Git dependency; the repository's one Git dependency, the `marked` fork, is unchanged and is owned by
the deferred list.

| Package | Registry | Baseline declared | Baseline resolved | Target declared | Target resolved | Reason category | Reason | Verification |
|---|---|---|---|---|---|---|---|---|
| `@hapi/hapi` | npm | `^20.0.0` | 20.3.0 | `^21.4.10` | **21.4.10** | incompatible + security (high) | The migration target. Advisory on `<= 20.3.0` via `@hapi/subtext`; 21.x is also the first line whose lifecycle contract the converted handlers are written against | `engines: node >=14.15.0`, satisfied by 22.23.2. Transitive fix measured: `@hapi/subtext` 7.1.0 → 8.1.3. Verified a near-drop-in for this bootstrap by execution against a real listener |
| `@hapi/inert` | npm | `^7.0.0` | 7.1.0 | `^7.1.2` | **7.1.2** | security patch, same major | Static-file confinement bypass via sibling-prefix path on `<= 7.1.0`. **Measured severity is moderate** — see row note 2, this is the table's one exception to the triage rule | No API change: `app.js` registers it identically. Declares no `peerDependencies`, so the hapi bump did not force it |
| `joi` | npm | `^17.0.0` | 17.13.3 | `^18.2.5` | **18.2.5** | request directive | The request asks for joi's current line by name. Its own baseline finding is moderate-only, so **security is not this row's reason** | `engines: node >= 20`. `Joi.isSchema`, `schema.validate(value, {abortEarly:false})` and coercion verified identical to 17.13.3. Comment-aware symbol multiset across all four consuming files is unchanged. Accept/reject parity across all 102 validation targets is a gate |
| `bcrypt` | npm | `^5.1.0` | 5.1.1 | `^6.0.0` | **6.0.0** | incompatible + security (high, over a critical chain) | 5.1.1's `@mapbox/node-pre-gyp` emits `DEP0169`, breaching the zero-deprecation-warning bar; the same chain carries the `tar` critical. 6.0.0 drops the dependency entirely | **Cost factor 10 and hash format unchanged, so existing passwords still verify** — the fact that makes the bump safe. `bcrypt.hash`, `bcrypt.compare`, `bcrypt.genSalt` call sites unchanged. `@mapbox/node-pre-gyp` and `tar` absent from the delivered lockfile |
| `nodemailer` | npm | `^2.5.0` | 2.7.2 | `^9.1.0` | **9.1.1** | incompatible + security (critical) | 2.7.2 → `libmime` → `iconv-lite` 0.4.15 emits `DEP0005`; the package's own node is critical over `<= 9.0.0` | `nodemailer.createTransport` is the only call site and is unchanged. Chain cleared, measured: `smtp-connection` 2.12.0, `httpntlm` 1.6.1, `libmime` 3.0.0 and both `underscore@1.7.0` copies are absent from the delivered lockfile |
| `js-yaml` | npm | `~3.0.1` | 3.0.2 | `^4.3.2` | **4.3.2** | security (critical) | 3.0.2 is critical and drags `argparse` 0.1.16 → `underscore` 1.7.0, themselves two further critical nodes. The 4.x line is not automatically safe: **≥ 4.3.1 is required** — see row note 6 | One call-site change: `yaml.safeLoad` → `yaml.load` in `config/routes.js`. The parsed value is the 51-entry reserved-username list, so the same usernames are still rejected. `argparse` measured 0.1.16 → 2.0.1 |
| `jsonwebtoken` | npm | `^5.0.5` | 5.7.0 | `^9.0.2` | **9.0.3** | security (high) | High over `<= 8.5.1`: unrestricted key type, insecure key retrieval, and a signature-validation bypass from an insecure default algorithm | No code change. `sign`/`verify` round-trip the repository's exact shapes on HS256 with the payload preserved. Application-source call sites unchanged: `jwt.sign` ×3 and `jwt.verify` ×1, plus one `jwt.sign` in a spec |
| `bull` | npm | `^0.7.0` | 0.7.2 | `^4.16.5` | **4.16.5** | security (high, over a critical nest) | 0.7.2's nested `lodash@3.10.1` is a node of the lodash **critical**, and it drags `semver@4.3.6` and `redis@2.8.0`. **Requires source changes** — see row note 8 | Nest cleared, measured: baseline `bull/node_modules` held `lodash@3.10.1`, `redis@2.8.0`, `redis-parser@2.6.0`, `semver@4.3.6`; delivered nests only `uuid@8.3.2`. Method-presence checking was **not** accepted as evidence, so functional worker tests are the gate |
| `adm-zip` | npm | `~0.4.4` | 0.4.16 | `^0.6.0` | **0.6.0** | security (high) | High over `< 0.6.0`: a crafted ZIP triggers a 4 GB allocation | Call site unchanged (`new zip()`), but **archive-read behaviour is a changed surface**, so the storage contract and archive-layout cases cover it rather than a call-site diff |
| `lodash` | npm | `^4.17.21` | 4.17.23 | `^4.18.1` | **4.18.1** | security (critical) | Critical over `<= 4.17.23`, whose newest member is the prototype-pollution array-path bypass in `_.unset` / `_.omit` | Call sites unchanged across both consumers: `_.extend` ×4, `_.find` ×2 and `lodash.escape` ×1 in `lib/controllers/trinket.js` and `lib/util/nunjucks.js`. The nested `lodash@3.10.1` node under `bull` clears with the `bull` row |
| `validator` | npm | `^5.6.0` | 5.7.0 | `^13.15.35` | **13.15.35** | security (high) | High over `<= 13.15.20` (incomplete filtering of special elements; the underlying advisory range reaches `< 13.15.22`), over earlier ReDoS and `isURL` bypass moderates | `validator.isEmail` ×2 is the whole usage and is unchanged |
| `tmp` | npm | `0.0.25` | 0.0.25 | `^0.2.7` | **0.2.7** | security (high) | High over `<= 0.2.5`: path traversal via an unsanitized prefix/postfix. **This was the baseline's single exact pin** — the one row where the declared value was already a version | `tmp.tmpName` is the only call site and is unchanged |
| `csv` | npm | `~1.2.1` | 1.2.1 | `^6.4.1` | **6.6.3** | security (high) | High over `0.4.2 - 4.0.0` via `csv-parse` | `require('csv').parse` is the only usage and is byte-identical before and after; its callback interface is retained deliberately, so the promise boundary stays at the handler |
| `diff` | npm | `~1.0.8` | 1.0.8 | `^8.0.4` | **8.0.4** | security (high) | High ReDoS over `<= 3.5.0` on the 1.x line, plus a later `parsePatch`/`applyPatch` denial-of-service | `diff.applyPatch` is the only call site and is unchanged |
| `mime` | npm | `~1.2.11` | 1.2.11 | `^4.1.0` | **4.1.0** | security (high) + maintained major | High ReDoS on MIME lookup of untrusted input. The patch that clears it leaves an unmaintained major, which the request does not permit when a maintained one works — see row note 15 | Node 22 supported and synchronously requireable, verified by loading it. `mime.lookup` ×3 → `mime.getType` ×3 and `mime.extension` → `mime.getExtension` across three controllers; the call sites are finite and parity-tested |
| `accepts` | npm | `~1.1.0` | 1.1.4 | `^1.3.8` | **1.3.8** | security (high) | High over `<= 1.3.2` via `negotiator` | No code change: `accepts(request).types(['html', 'json'])` in `lib/util/routeParser.js` is unchanged. The one apparent second call site was a false positive — see row note 16 |

### Row notes

Only the rows whose reasoning does not fit a table cell are expanded. Numbering follows the table.

2. **`@hapi/inert` is the table's one exception, and it is flagged rather than dressed up.** Its
   baseline advisory is **moderate** (`@hapi/inert <= 7.1.0`, static-file confinement bypass via
   sibling-prefix path), and the delivered lockfile shows `@hapi/inert` declaring no
   `peerDependencies` at all, so the `@hapi/hapi` 21 bump did not compel it. Under the triage rule as
   stated, a moderate-only finding with no incompatibility is deferred. It was nonetheless taken:
   it is a patch-level move inside a major that was already changing, it clears a direct finding on
   the code path that serves the three static routes, and it has zero API surface to regress — the
   registration in `app.js` is unchanged. A reviewer checking R-a's uniformity should treat this as
   the single deliberate departure in §3 and every other row as rule-driven.

4. **`bcrypt`'s two severities are distinct and both matter.** The `bcrypt` node itself is *high*
   (`5.0.1 - 5.1.1`, reached via `@mapbox/node-pre-gyp`); the *critical* in the baseline tree is
   `tar`, which at baseline is required by `@mapbox/node-pre-gyp` and by nothing else. One bump
   clears both because 6.0.0 drops the pre-gyp dependency, which is also what silences `DEP0169`.
   The safety argument is separate from the security argument and rests on a measurement: the cost
   factor stays at 10 and the hash format is unchanged, so credentials stored before this migration
   still verify afterwards. Had either changed, this bump would have needed a password-rehash path
   and would not have been a dependency change at all.

6. **`js-yaml` 4 is not a safe destination by itself; 4.3.1 is the floor.** The 4.x line carries a
   high over `4.0.0 - 4.3.0` (merge-key chains forcing quadratic CPU) plus an `!!omap` high reaching
   `< 4.3.1`. Measured directly: a throwaway manifest pinning `js-yaml@4.1.1` audits as **1 high**.
   So the target had to be at least 4.3.1, and `^4.3.2` resolves to 4.3.2. This is why the row's
   declared range is not simply `^4.0.0`.

8. **`bull` passed an API-surface check and then failed a closer read — which is why its gate is
   functional.** Checking that the methods still exist was not sufficient evidence, and three
   concrete source changes fell out of reading the consumers:
   - `job.jobId` → `job.id` in the `failed` handler (`lib/workers/exports.js`; Bull 4 renamed it);
   - the **one-argument, promise-returning** processor the worker registers — not `handler(job, done)`
     — whose completion semantics are the version's, not the repository's;
   - the constructor form, the getter factory and `close()` semantics in `lib/util/queues.js`.
   The `completed` / `error` / `failed` payload shapes, `job.remove()` on completion, retry and
   stalled-job behaviour, and the failure-persistence write onto the `Export` document are all
   version-sensitive in the same way. Because none of that is provable from method presence, the
   worker is validated by processing a real successful job and a real failing job rather than by a
   structural check. `lib/util/queues.js` keeps its `handler(job, done)` interface: it is a utility a
   converted handler awaits, not a lifecycle method.

15. **`mime` moves to a maintained major rather than resting on the patch.** The high advisory clears
    at 1.4.1, so the 1.x line offers a fix — but taking it would leave the application on an
    unmaintained major, which the request's "upgrade the same package to a maintained major where
    possible" does not permit when a maintained one works. 4.1.0 works: it supports Node 22, it is
    synchronously requireable (an ESM-only successor would have forced a loader change this migration
    is not authorized to make), and its rename is mechanical and finite —
    `lookup` → `getType`, `extension` → `getExtension` — across `lib/controllers/trinket.js`,
    `lib/controllers/users.js` and `lib/controllers/files.js`.

16. **The `accepts` row's verification needed a second look, and the finding is recorded so nobody
    repeats it.** A naive symbol comparison reports a `.type(` call present at baseline and absent
    afterwards, which looks like an `accepts` API change. It is not: that call belonged to the
    **deleted fake-reply builder** in `lib/util/routeParser.js`, part of the compatibility layer this
    migration removes. The actual `accepts` usage,
    `accepts(request).types(['html', 'json'])`, is unchanged. The same class of false positive
    appeared for `jsonwebtoken`, where an apparent second `jwt.verify` turned out to be a comment.

### Import transparency — measured, not assumed

Every row above was checked by comparing the **symbol multiset** each consuming file uses, baseline
against delivered, rather than by trusting the release notes. The comparison strips comments before
counting, which is not a detail: three of the counts below are inflated by one if it does not, and
the two false positives in row note 16 are the same trap.

**Three moves are not import-transparent**, and each carries its call-site change in the table:

| Package | Call-site change |
|---|---|
| `js-yaml` | `yaml.safeLoad` → `yaml.load`, one site in `config/routes.js` |
| `mime` | `mime.lookup` ×3 → `mime.getType` ×3 and `mime.extension` → `mime.getExtension`, across three controllers |
| `bull` | `job.jobId` → `job.id`, plus the constructor, getter-factory and `close()` surface in `lib/util/queues.js` (row note 8) |

**The other thirteen required no call-site change**, verified rather than asserted. `joi`'s symbol
multiset is identical down to the counts — `Joi.string` ×179, `Joi.boolean` ×30, `Joi.number` ×21,
`Joi.object` ×10, `Joi.array` ×7, `Joi.any` ×4, `Joi.alternatives` ×1 and `Joi.isSchema` ×1, with
**no `Joi.validate` call site on either side** (its one occurrence is a comment, which is correct:
joi 17 removed that function) — and so are `bcrypt` (`compare`, `genSalt`, `hash`, ×1 each), `nodemailer`
(`createTransport` ×1), `lodash` (`_.extend` ×4, `_.find` ×2, `lodash.escape` ×1), `validator`
(`isEmail` ×2), `tmp` (`tmpName` ×1), `csv` (`require('csv').parse`), `diff` (`applyPatch` ×1),
`accepts` (`accepts(request).types([...])`), `jsonwebtoken` (`sign` ×3, `verify` ×1), `adm-zip`
(`new zip()`), `@hapi/hapi` and `@hapi/inert`.

The comparison was taken over **every** consuming file of each package, not a representative one —
`lodash` has two consumers and `diff`, `mime`, `joi` and `jsonwebtoken` have two to four each, and a
single-file check would have understated `lodash`'s surface.

Two of those deserve their qualification stated rather than buried. **`adm-zip`'s call site is
identical but its behaviour is not**: 0.4.16 → 0.6.0 changes archive-read semantics, so it is covered
by the storage contract and archive-layout cases, not by a call-site diff. **`joi`'s transparency is
the point of the row, not an aside**: the hand-rolled validation path in `lib/util/routeParser.js` is
deliberately kept, so the library moves while the response shapes it produces do not. That is a
**preservation-driven decision under R-d**, not an oversight — adopting hapi's native validation
would have turned a baseline 302 redirect into a 400, and preserving the observable outcome is
mandatory.

### One reversal, recorded

An earlier iteration of the dependency plan bumped **`archiver`, `mongoose`, `jszip` and `rimraf`**
as majors. That was **withdrawn** as inconsistent with the triage rule stated in §1: once the
lockfile was regenerated, none of the first three produces a critical or high finding, and none is
incompatible with Node 22 or hapi 21 — so all three belong in the deferred list, where they now are.
`rimraf` was never a bump candidate at all, for a reason worth stating because it is the clearest
evidence the rule was applied honestly: **it has no advisory of its own.** It left the manifest
because its sole call site became `fs.promises.rm`, which is a removal (§4), not a version move. A
tidy table that quietly kept those four majors would have been the wrong artifact.

## 4. Removals

This section is **R-b's deliverable**: R-b prohibits vendored dead packages, and twenty-three
declarations qualified.

### The criterion

> A declared dependency with **no live consumer in retained source** is removed — **and a consumer
> that is itself never invoked does not count as live.**

The second clause is doing real work, and it is the whole justification for one deletion. Judged on
the first clause alone, four `passport` packages had a consumer: `lib/auth/passport.js` requires them
all. But that module is never invoked — its exported `Authentication` binding appears exactly once in
the repository, as an unused `require` in `app.js` — so retaining four packages to satisfy an
importer that nothing calls is circular, and R-b forbids exactly that. The module is deleted, and the
packages go with it.

**A removal is a removal of the declaration.** Some of these packages legitimately remain in the
delivered lockfile as transitives or optional peers of packages the application still uses. That is
not a dead declaration and R-b does not reach it; §4.4 records which, so a reviewer grepping the
lockfile is not misled.

### 4.1 Production removals — 19

Baseline resolved versions from `git show 2f8712a:package-lock.json`; severities from the baseline
`npm audit --omit=dev`.

| Package | Registry | Baseline declared | Baseline resolved | Baseline finding | Reason |
|---|---|---|---|---|---|
| `@hapi/catbox-redis` | npm | `^7.0.0` | 7.0.2 | none | No consumer. The session cache is the Mongoose-backed catbox engine registered in `app.js`, not Redis — the declaration described a topology the application does not use |
| `@hapi/hoek` | npm | `^11.0.0` | 11.0.7 | none | No consumer in any spelling. Retained in the tree as a transitive (§4.4) |
| `chokidar` | npm | `^3.5.3` | 3.6.0 | none | No consumer. Retained in the tree as an optional peer (§4.4) |
| `debug` | npm | `^4.3.0` | 4.4.3 | none | No consumer. Retained in the tree as a transitive (§4.4) |
| `file-type` | npm | `^3.8.0` | 3.9.0 | none | No consumer in retained source. Absent from the delivered lockfile entirely |
| `is-svg` | npm | `^2.1.0` | 2.1.0 | **high** (ReDoS, `2.1.0 - 4.2.2`) | No root consumer. The two `serverside` manager units that do use it declare their own, at `^4.3.2` (python) and `^5.0.0` (pygame), so removing the root declaration deprives nothing |
| `minimist` | npm | `^1.1.1` | 1.2.8 | none at the root | No consumer. The baseline tree's **critical** `minimist` node was `optimist`'s nested `<= 0.2.3` copy, not this declaration — removing `optimist` is what cleared it |
| `mkdirp` | npm | `~0.3.5` | 0.3.5 | none | Replaced by `fs.promises.mkdir(dir, {recursive: true})`. **Removal beat bumping for a mechanical reason:** mkdirp 1+ returns a promise natively, so the `util.promisify` wrapper the call site used would wrap a promise and the callback would never fire — a bump would have hung the request |
| `moment-timezone` | npm | `~0.5.21` | 0.5.48 | none | No consumer in retained source |
| `mongo-migrate` | npm | `^0.1.0` | 0.1.0 | none | No consumer in retained source |
| `node-uuid` | npm | `^1.4.3` | 1.4.8 | none | Imported in `lib/controllers/users.js` and **never referenced**; the import is deleted with the declaration |
| `optimist` | npm | `~0.6.0` | 0.6.1 | **critical** (`>= 0.6.0`), plus a second critical node in its nested `minimist` | Dead after conversion. One import and three uses, all for the route-table CLI, replaced by a plain argv check that **preserves all three invocation forms** — no argument, `-R`, and the `--routes` alias — because the module self-executes unconditionally |
| `passport` | npm | `~0.2.0` | 0.2.2 | **moderate** (session regeneration, `< 0.6.0`) | Sole consumer is the deleted `lib/auth/passport.js`, which is never invoked |
| `passport-google-oauth` | npm | `^0.1.5` | 0.1.5 | **moderate** (`<= 0.1.5`) | Sole consumer is the deleted `lib/auth/passport.js` |
| `passport-local` | npm | `~1.0.0` | 1.0.0 | none | Sole consumer is the deleted `lib/auth/passport.js` |
| `passport-strategy` | npm | `~1.0.0` | 1.0.0 | none | Sole consumer is the deleted `lib/auth/passport.js` |
| `request` | npm | `^2.51.0` | 2.88.2 | **critical** (range `*`, plus an SSRF moderate and a critical `form-data` node) | Dead after conversion. Four call sites replaced with native `fetch`: the streaming asset fetch, the two Google OAuth calls, and the reCAPTCHA POST — each with its per-branch outcomes captured at baseline first, including the transport-failure and malformed-body faults |
| `rimraf` | npm | `~2.2.6` | 2.2.8 | none | Dead after conversion. Its sole call was a Node-core-style callback inside a hapi handler, so it became `await fs.promises.rm(dir, {recursive: true, force: true})`, preserving the baseline's wait-then-respond order and its swallowed error. **It has no direct advisory, so a version bump was never justified** — this row is the cleanest demonstration that the triage rule drove dispositions rather than package age |
| `sha1` | npm | `~1.1.0` | 1.1.1 | none | No consumer in retained source |

### 4.2 Development removals — 4

| Package | Registry | Baseline declared | Baseline resolved | Baseline finding | Reason |
|---|---|---|---|---|---|
| `chai-as-promised` | npm | `^6.0.0` | 6.0.0 | none | Registered in `test/setup.js` but **functionally unused**: measured zero occurrences of `eventually`, `rejectedWith`, `.fulfilled` or `becomes(` across `test/**`. No promise-plugin assertion exists in the suite |
| `cheerio` | npm | `~0.22.0` | 0.22.0 | none | No consumer. Measured zero references across `test/**` |
| `should` | npm | `~3.0.0` | 3.0.1 | none | Never required by any test file. The `should` **getter** the assertions read through comes from Chai's `chai.should()`, not from this package |
| `sinon-chai` | npm | `^2.5.0` | 2.14.0 | none | Registered in `test/setup.js` but **functionally unused**: measured zero occurrences of `have.been.*` or `been.called` across `test/**`. Spy values are read through ordinary Chai assertions |

**Removing these two unused Chai plugins is what unblocked the sinon choice**, and the mechanism is
worth stating precisely because it is easy to describe wrongly. Read from the baseline lockfile:

- `sinon-chai@2.14.0` declares `peerDependencies: {"chai": ">=1.9.2 <5", "sinon": "^1.4.0 || ^2.1.0 || ^3.0.0 || ^4.0.0"}`. It is that **`sinon` peer, capped at 4.x**, that blocked a maintained sinon.
- `chai-as-promised@6.0.0` declares `peerDependencies: {"chai": ">= 2.1.2 < 4"}`. It is that peer which held `chai` below 4.

Removing both plugins lifts both caps at once. The delivered `sinon` 22.1.0 declares no
`peerDependencies` at all, which is why `chai` needed no move (§5). And because **no assertion in the
suite uses either plugin**, dropping them changes no assertion expression — only the two `chai.use(...)`
registrations go with them.

### 4.3 Count reconciliation

| | Baseline | Removed | Added | Delivered | Verified |
|---|---|---|---|---|---|
| Production | 58 | 19 | 0 | **39** | 58 − 19 = 39 ✔ |
| Development | 11 | 4 | 1 | **8** | 11 − 4 + 1 = 8 ✔ |

Both verified against the delivered manifest (`39 8`, §2), and every one of the twenty-three names
was checked individually for absence from the delivered `package.json`.

The removals are genuine rather than merely undeclared — the consuming code is gone too:

```console
$ grep -rn "require('request')\|require('optimist')\|require('mkdirp')\|require('rimraf')\|require('node-uuid')" \
    --include=*.js . --exclude-dir=node_modules
$ echo $?
1
```

Zero hits. `lib/auth/passport.js` — **136 lines**, none of them reachable — is deleted, and no
`Authentication` or `passport` reference remains in `app.js`. Deleting unreachable code changes
nothing observable, which is why **R-d is not engaged by this deletion**; the module's latent
`ReferenceError` and its Express-style `req.session.*` usage are recorded in
[`preserved-quirks.md`](preserved-quirks.md) as evidence that it never ran, not as behaviour anyone
could have depended on.

### 4.4 Removed as a declaration, retained as a transitive

Five of the nineteen production removals still appear somewhere in the delivered lockfile, because a
package the application **does** use depends on them. That is a legitimate transitive, not a dead
declaration, and R-b's prohibition does not reach it. Recorded so that a lockfile grep does not read
as a contradiction:

| Package | Delivered position | Pulled in by |
|---|---|---|
| `@hapi/hoek` | 11.0.7, production transitive | 28 `@hapi/*` packages and `joi` |
| `debug` | 4.4.3, production transitive | `ioredis`, `mquery`, `https-proxy-agent`, and on the dev side `mocha`, `superagent`, `mongodb-memory-server-core`, `new-find-package-json` |
| `chokidar` | 3.6.0, `optional: true`, `peer: true` | An optional peer of the build tooling; `sass` declares `chokidar ^4.0.0` and gets its own nested 4.0.3 |
| `mkdirp` | 0.5.1, development transitive | `mocha` |
| `minimist` | 0.0.8, development transitive | that `mkdirp` |

The other fourteen — `@hapi/catbox-redis`, `file-type`, `is-svg`, `moment-timezone`, `mongo-migrate`,
`node-uuid`, `optimist`, all four `passport*` packages, `request`, `rimraf` and `sha1` — are **absent
from the delivered lockfile entirely**, along with the four development removals.

## 5. Development dependencies

| Package | Registry | Baseline declared | Baseline resolved | Target declared | Target resolved | Disposition | Reason |
|---|---|---|---|---|---|---|---|
| `sinon` | npm | `~1.7.3` | 1.7.3 | `^22.1.0` | **22.1.0** | moved | incompatible **and** warning-emitting — see below |
| `chai` | npm | `^3.5.0` | 3.5.0 | `^3.5.0` | **3.5.0** | **not moved** | Nothing forced it: the selected `sinon` declares no assertion peer. Recorded because the plan allowed for a forced move that did not materialise |
| `mongodb-memory-server` | npm | — | — | `11.2.0` | **11.2.0** | **added**, exact pin | The suite must provision its own MongoDB under `git clean -xfd && npm ci && npm test` on a host with no Docker |
| `mocha` | npm | `^3.4.1` | 3.5.3 | `^3.4.1` | 3.5.3 | unchanged | Not blocking; loads and runs on Node 22.23.2, and in no critical or high set. **See the forward note below — this one is not a free bump later** |
| `supertest` | npm | `~0.8.3` | 0.8.3 | `~0.8.3` | 0.8.3 | unchanged | Not blocking |
| `redis-mock` | npm | `~0.2.0` | 0.2.0 | `~0.2.0` | 0.2.0 | unchanged | Not blocking |
| `sass` | npm | `^1.57.0` | 1.98.0 | `1.98.0` | 1.98.0 | **declaration pinned exact; version unchanged** | Not a version move — the range was pinned to the version it already resolved. Build tooling is deliberately untouched, so its output artifacts and paths are unchanged |
| `vite` | npm | `^4.5.14` | 4.5.14 | `^4.5.14` | 4.5.14 | unchanged | Not blocking; build tooling untouched |

**`sinon` 1.7.3 → 22.1.0.** Two independent reasons, either sufficient. It is **incompatible**:
1.7.3 has no `.callsFake`, which `test/helpers/store.js` calls four times, and those four calls are
what break the seven cases in `test/lib/api/forgot_pass.js`. And it is **warning-emitting** in every
nearby version.

**Why sinon 2.4.1 was rejected**, since it is the version a naive peer-satisfying resolution lands on:
it is npm-deprecated, and it prints a Sinon deprecation notice **whenever the three-argument
`sinon.stub(obj, 'method', fn)` form runs**. The repository uses exactly that form, so 2.4.1 would
have put a deprecation notice on the test run and failed the zero-warning bar it was chosen to
satisfy. It only looked like the only option because of the peer caps §4.2 removed.

The move forces the three-argument form to become `.callsFake()` at every remaining site.
**That is a stub-syntax change, not an assertion change**, and the distinction is the gate: assertion
expressions, their expected values and the passing count are unchanged, while a reviewed stub-syntax
change is permitted and is visible in the diff. Measured census, since the site count is easy to get
wrong: the baseline tree carried **six** three-argument `sinon.stub` calls across four files — one
each in `test/helpers/catbox-redis.js` and `test/helpers/queue.js` (both files deleted as dead), one
in `test/setup.js`, and **three** in `test/lib/models/trinket.js`. Two therefore vanish with the
deleted helpers, leaving four to convert.

**Forward note on `mocha`, which matters more than its "unchanged" row suggests.** The suite's flags
live in `test/mocha.opts`, and **`mocha.opts` stopped being read in Mocha 8**. A future bump past
Mocha 7 would not fail loudly — it would *silently discard every flag*, including `--check-leaks`,
and take the reporter and the spec glob with it. Any such bump must move those flags to
`.mocharc.yml` in the same change. Staying on 3.5.3 is what keeps that out of this migration's diff.

## 6. Runtime pinning

R-b prohibits any container pinned to an old runtime, and the values below are the pins that satisfy
it. **The image digest and the `pm2` patch are deliberately not predetermined anywhere in the
planning** — they are resolved at implementation time, committed into the `Dockerfile`, and recorded
here. Both are copied from the delivered file, not reconstructed.

### 6.1 The root image

```dockerfile
FROM node:22-bookworm@sha256:8a34c4ab3ea2c5cd194f07e317b2a8f09461d3c8b05c4e34c8ccd56d56024c4d
```

Baseline was `FROM node:16-bullseye` — a floating tag on an end-of-life major.

**Why a digest and not a tag.** This is where exact reproducibility lives, alongside the committed
lockfile. It names one immutable image rather than whatever `node:22-bookworm` points at today, and
it is the multi-arch **index** digest rather than a single platform's manifest digest, so
multi-platform builds still resolve. Its failure mode is the right way round: a stale digest fails
the build outright rather than degrading quietly into a different runtime. Refreshing it is therefore
a deliberate edit — resolve the new value, re-run the build-time assertion, and update this row.

Measured contents of the pinned image: **node v22.23.2, npm 10.9.8** — both inside the declared
`engines` ranges. The `Dockerfile` asserts that agreement at build time as its first step, before
`npm ci` and before the `COPY`, failing with the offending version named rather than surfacing later
as a confusing resolution error.

### 6.2 The `pm2` pin

```dockerfile
RUN npm install -g pm2@5.4.3
```

Baseline was `RUN npm install -g pm2@5` — a floating major range, meaning two builds of the same
commit could ship different process managers.

**The constraint the pin has to satisfy:** the image ends with
`CMD ["pm2-docker", "start", "app.js"]`, so the pinned version must still ship the **`pm2-docker`**
executable. `pm2-docker` is the legacy name of what later became `pm2-runtime`, and 5.4.3 provides
both. A missing bin here fails at container **start**, not at build, so any future bump must
re-check it.

### 6.3 `engines` and `.nvmrc` — bounded, and honestly floating

```json
"engines": { "node": ">=22.0.0 <23.0.0", "npm": ">=10.0.0 <11.0.0" }
```

`.nvmrc` contains `22`.

These **bound the majors and float within them.** That is the intended behaviour for an LTS line that
keeps receiving security patches, and **no claim of exact reproducibility is made from them.**
Reproducibility is carried by the three artifacts that can carry it: the committed lockfile, the
digest in §6.1 and the exact `pm2` patch in §6.2.

### 6.4 The nine Node-bearing Dockerfiles

The repository has ten `Dockerfile`s. **Nine carried an old Node runtime and all nine now carry Node
22**; R-b's prohibition is unqualified, so none was exempted — including the four that install Node
inside a non-Node base.

| Dockerfile | Baseline | Delivered |
|---|---|---|
| `Dockerfile` | `node:16-bullseye` | `node:22-bookworm` + digest (§6.1) |
| `serverside/java/manager/Dockerfile` | `node:18-alpine` | `node:22-alpine` |
| `serverside/python/manager/Dockerfile` | `node:18-alpine` | `node:22-alpine` |
| `serverside/r/manager/Dockerfile` | `node:18-alpine` | `node:22-alpine` |
| `serverside/pygame/manager/Dockerfile` | `node:18-slim` | `node:22-slim` |
| `serverside/java/shell/Dockerfile` | `NODE_VERSION 14.21.1` via nvm inside `amazoncorretto:8` | `NODE_VERSION 22.23.2` |
| `serverside/python/shell/Dockerfile` | `NODE_VERSION 14.21.1` via nvm inside `python:3.10-bullseye` | `NODE_VERSION 22.23.2` |
| `serverside/r/shell/Dockerfile` | `NODE_VERSION 18.20.5` via nvm inside `r-base:4.4.2` | `NODE_VERSION 22.23.2` |
| `serverside/pygame/worker/Dockerfile` | NodeSource `setup_18.x` inside `ubuntu:22.04` | NodeSource `setup_22.x` |

The tenth, `serverside/nginx/Dockerfile`, is `nginx:alpine` and carries no Node runtime, so it is
unchanged.

**The four `serverside/*/manager` units, precisely.** Each now installs from a **committed lockfile**
that did not exist before — the baseline tree carried their `package.json` files and no lockfiles at
all, so these are first-time creations rather than regenerations. Their manifests are **unchanged**;
the work was runtime pinning, dependency resolution and a boot check on Node 22. Delivered lockfiles
are `lockfileVersion` 3 with 44 (java), 47 (python), 42 (pygame) and 44 (r) packages. **Their
application code was not converted**: these units carry no hapi surface and all four declare
`"type": "module"`, and they are separate deployment units documented in `serverside/README.md`.

### 6.5 The install and build steps in the root image

| Step | Baseline | Delivered | Why |
|---|---|---|---|
| Install | `RUN npm install --legacy-peer-deps` | `RUN npm ci` | The delivered lockfile resolves without the flag, so dropping it is what keeps the image's dependency tree identical to the one tested on the host. Verified: `npm ci --dry-run --no-audit --no-fund` exits 0 with no peer-resolution flag |
| Components | inline `curl --silent \| tar` that verified nothing | `RUN node scripts/fetch-components.js` | One digest-verified, idempotent, atomic implementation shared by the host and the image; the inline form would have extracted an error page without complaint |
| CSS | *absent* | `RUN npm run build:css` | `public/css/base.css` and `public/css/embed.css` are gitignored build outputs, so **the baseline image contained neither stylesheet** and every page rendered unstyled. It runs after `npm ci` (it needs vite and sass) and after the component fetch (the SCSS entry imports from `public/components`) |

## 7. Audit result

`npm audit --omit=dev`, measured on both trees.

| | Critical | High | Moderate | Total |
|---|---|---|---|---|
| Baseline `2f8712a` | **15** | **28** | **16** | **59** |
| Delivered | **0** | **1** | **5** | **6** |

The delivered figure was measured twice and agrees: once against the installed `node_modules` and
once with `--package-lock-only`, on `node v22.23.2` / `npm 10.9.8`.

The six remaining findings, each attributed:

| Package | Severity | Direct | Advisory range |
|---|---|---|---|
| `marked` | **high** | yes | `<= 4.0.9` |
| `aws-sdk` | moderate | yes | `>= 2.0.1` |
| `bull` | moderate | yes | `>= 2.0.0` |
| `highlight.js` | moderate | yes | `9.0.0 - 10.4.0` |
| `jszip` | moderate | yes | `<= 3.7.1` |
| `uuid` | moderate | no (via `aws-sdk` and `bull`) | `< 11.1.1` |

**The request's stated gate was zero critical and zero high, and this delivery does not meet it.** It
delivers zero critical and exactly one high. The gate is not redefined here and no exception is
granted: the single high is `marked`, a deliberate, named, single-package deviation.
[`deferred-dependencies.md`](deferred-dependencies.md) owns that decision — its reasoning, its
precedence argument, its risk attribution and the follow-up that would close it. Nothing about it is
argued in this document. Every other listed finding is likewise recorded there with its attribution
and risk note. **Any *additional* critical or high finding is a failure**, not a deviation.

### A methodological warning that changed how this list was built

An early iteration of the candidate package list was resolved and audited and **passed**. A later
re-resolution of the **same list** produced **three new highs**, from advisories published in the
interval.

That is why **the gate, not the list, is the contract.** Two consequences follow, and both are
binding on anyone maintaining this record:

1. A version in §3 is a *minimum that cleared a qualifying finding when measured*, not a permanently
   sufficient version. Re-run the audit; do not trust the table's age.
2. A newly implicated package triggers a **mapping revision** — its own compatibility and parity
   analysis before any version moves — and **not** blanket authority to take whatever `fixAvailable`
   names. `bull` is the cautionary example: it passed an API-surface check and then failed a closer
   read of its consumers (row note 8).

## 8. Measurement discrepancy log

Every figure in this document was measured against the delivered tree. Twelve measurements disagreed
with the planned expectation. In each case **the measurement is what is recorded above**, and the
disagreement is logged here rather than quietly reconciled.

| # | Expected | Measured | Nature |
|---|---|---|---|
| 1 | `nodemailer` 9.1.0 | **9.1.1** | Caret float. `^9.1.0` resolved to the newer patch; no decision changed |
| 2 | `jsonwebtoken` 9.0.2 | **9.0.3** | Caret float |
| 3 | `csv` 6.4.1 | **6.6.3** | Caret float |
| 4 | `@hapi/inert` — a security patch | Advisory severity is **moderate**, and `@hapi/inert` declares **no** `peerDependencies` | Substantive. Neither severity nor a peer constraint qualifies this row under the triage rule; it is the table's one flagged exception (row note 2) |
| 5 | `joi` — advisory-driven | `joi` 17.13.3's finding is **moderate-only** (`< 17.13.4`) | Substantive. The qualifying reason is the **request's explicit directive**, not security; §3 records the category as such |
| 6 | `mime`'s high clears at 1.6.0 | It clears at **1.4.1** | The 1.x fix is earlier than stated; 1.6.0 is simply the last 1.x. The disposition is unaffected — the row moves to 4.1.0 for the maintained-major reason |
| 7 | `js-yaml` 4.1.0/4.1.1 carry "a later high" | The 4.x high spans **`4.0.0 - 4.3.0`**, plus an `!!omap` high reaching **`< 4.3.1`** | Broader than expected: the floor is 4.3.1, not "above 4.1.1". Verified by auditing a `js-yaml@4.1.1` manifest — 1 high |
| 8 | 6 moderate findings, including `mongoose` | **5 moderate**; `mongoose` is **not flagged** | Substantive. The advisory range is `< 6.13.10`, and lockfile regeneration floated `mongoose` 6.13.9 → **6.13.11** inside its **unchanged** `^6.0.0` declaration. A moderate cleared with no declared change, so `mongoose` correctly does not appear in §3 — but it explains the count |
| 9 | `sass` unchanged | Resolved version unchanged at 1.98.0, but the **declaration was pinned exact**, `^1.57.0` → `1.98.0` | Declaration-only change with no version move. Recorded in §5 rather than §3, since §3 is for version moves |
| 10 | One `serverside` manager declares `"type": "module"`; manifests and lockfiles regenerated | **All four** declare `"type": "module"`; the four manifests are **unchanged** and the four lockfiles are **first-time creations** | The baseline tree carried no manager lockfiles at all, so "regenerated" overstated it (§6.4) |
| 11 | Three legacy three-argument `sinon.stub` calls | **Six** at baseline, across four files; two vanish with the deleted dead helpers, leaving four to convert | Undercount. Does not change the `sinon` disposition, only the size of the call-site work it forces (§5) |
| 12 | `is-svg` — a critical ReDoS | **High** ReDoS (`2.1.0 - 4.2.2`) | Severity only. Still qualifies under the triage rule, and the removal reason — no root consumer — is independent of it |

Two further measurement notes, recorded because they bear on how the figures above should be read:

- **The `minimist` critical was never the declared `minimist`.** The baseline tree's critical
  `minimist` node is `node_modules/optimist/node_modules/minimist` (`<= 0.2.3`); the declared root
  `minimist@1.2.8` is not flagged at all. Removing `optimist` is what cleared that critical, and the
  `minimist` declaration was removed purely as dead (§4.1).
- **Two "no code change" claims survived a false positive each**, and both are reported in row notes
  15–16 rather than left as clean-looking rows: `accepts`' apparently removed `.type(` call belonged
  to the deleted fake-reply builder, and `jsonwebtoken`'s apparent second `jwt.verify` is a comment.
  A symbol-count comparison alone would have mis-classified both.

One evidence-state note, so that a reviewer re-running the checks is not surprised. §4.2 removes
`chai-as-promised` and `sinon-chai` on the strength of their **functional** non-use — zero assertions
in the suite use either, measured — and the two `require` lines and two `chai.use(...)` calls that
name them are removed by `test/setup.js`'s own reduction, which is a separate change in this same
delivery. At the time these measurements were taken that reduction had not yet landed, so a grep for
the two package names still finds those two lines. That is a pending edit elsewhere in the delivery,
not evidence that the removals were unjustified.

---

*Navigation note, recorded rather than acted on: `mkdocs.yml` is out of scope for this migration and
its `nav:` lists only `index.md`, `setup.md` and `overview.md`. If these four migration documents
should be published on the docs site, adding them is a separate, deliberate change.*
