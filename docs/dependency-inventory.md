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
[§8 Measurement discrepancy log](#8-measurement-discrepancy-log). Thirteen such disagreements were
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
finding appears in the deferred list and **not here**. `archiver` 2.1.1, `mongoose` 6.13.9, `jszip`
3.6.0, `highlight.js` 9.18.5, `aws-sdk` 2.1693.0, `q` 1.0.1 and `config` 0.4.37 are all in that
position, and all were verified unchanged: `@hapi/boom` 10.0.1, `@hapi/vision` 7.0.3, `@hapi/yar`
11.0.3, `nunjucks` 3.2.4, `redis` 4.7.1, `winston` 3.19.0, `moment` 2.30.1, `underscore` 1.13.8,
`mongoose-schema-extend` 0.2.2, `escape-string-regexp` 1.0.5, `limax` 1.4.1, `node-cryptojs-aes`
0.4.0, `numeral` 1.5.6, `tab` 0.1.0 and `transliteration` 0.1.1 all resolve to the same version
before and after. **One of those deferrals is not a moderate-only one:** `archiver` 2.1.1 carries no
advisory at all, but it does carry **two measured shortfalls** that would each be a qualifying reason
under the rule above:

1. a runtime deprecation warning — `[DEP0005] Buffer() is deprecated`, from `compress-commons` at
   module scope, once per process and only under `--pending-deprecation`; and
2. a writer defect — its chain records **`crc32 = 0` and `uncompressed size = 0`** into every
   deflated entry, so `adm-zip` 0.6.0 cannot read those archives back.

Its **version** is unchanged because the frozen dependency authorization retains 2.1.1 and records
the earlier major bump as withdrawn, and because no advisory qualifies it either; **neither shortfall
is disposed of by that**, and both are recorded as **unresolved shortfalls against their gates** —
the first against the zero-warning gate, the second against the storage and worker gates — with no
decision taken about `archiver` and no deviation status granted to either. The writer defect is also
**pre-existing at `2f8712a`**, which is why R-d and R-f bear on it: correcting it would change
persisted archive bytes. §9.5 is this document's record of the retention and of both shortfalls;
[`deferred-dependencies.md`](deferred-dependencies.md) §2.6 carries the full measurement narrative and
[`baseline-parity.md`](baseline-parity.md) §7.4 and §8 carry the open status.

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
| Packages in the root lockfile | 678 | **456** (455 excluding the root record) |
| Version moves | — | **16** |
| Declarations removed | — | **23** (19 production, 4 development) |
| Declarations added | — | **1** (`mongodb-memory-server`) |
| `npm audit --omit=dev` | 15 critical, 28 high, 16 moderate — **59** | 0 critical, **1 high**, 6 moderate — **7** |
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
| `@hapi/inert` | npm | `^7.0.0` | 7.1.0 | `^7.0.0` — **unchanged** | **7.1.2** | resolution only; **no declaration change** | Static-file confinement bypass via sibling-prefix path on `<= 7.1.0`. **Measured severity is moderate**, so under the triage rule it does not qualify for a declaration change — and it does not need one: the registry's complete 7.x line is `7.0.0, 7.0.1, 7.1.0, 7.1.1, 7.1.2`, so the **baseline** `^7.0.0` declaration already resolves 7.1.2. The patch is taken by regeneration, not by editing the manifest | No API change: `app.js` registers it identically. Declares no `peerDependencies`, so the hapi bump did not force it. An interim delivery declared `^7.1.2`; that was an unforced declaration change with no qualifying blocker and is withdrawn — the declaration is back at its baseline value while the resolved version is unchanged at 7.1.2 |
| `joi` | npm | `^17.0.0` | 17.13.3 | `^18.2.5` | **18.2.5** | request directive | The request asks for joi's current line by name. Its own baseline finding is moderate-only, so **security is not this row's reason** | `engines: node >= 20`. `Joi.isSchema`, `schema.validate(value, {abortEarly:false})` and coercion verified identical to 17.13.3. Comment-aware symbol multiset across all four consuming files is unchanged. Accept/reject parity across all 102 validation targets is a gate |
| `bcrypt` | npm | `^5.1.0` | 5.1.1 | `^6.0.0` | **6.0.0** | incompatible + security (high, over a critical chain) | 5.1.1's `@mapbox/node-pre-gyp` emits `DEP0169`, breaching the zero-deprecation-warning bar; the same chain carries the `tar` critical. 6.0.0 drops the dependency entirely | **Cost factor 10 and hash format unchanged, so existing passwords still verify** — the fact that makes the bump safe. `bcrypt.hash`, `bcrypt.compare`, `bcrypt.genSalt` call sites unchanged. `@mapbox/node-pre-gyp` and `tar` absent from the delivered lockfile |
| `nodemailer` | npm | `^2.5.0` | 2.7.2 | `^9.1.0` | **9.1.1** | incompatible + security (critical) | 2.7.2 → `libmime` → `iconv-lite` 0.4.15 emits `DEP0005`; the package's own node is critical over `<= 9.0.0` | `nodemailer.createTransport` is the only call site and is unchanged. Chain cleared, measured: `smtp-connection` 2.12.0, `httpntlm` 1.6.1, `libmime` 3.0.0 and both `underscore@1.7.0` copies are absent from the delivered lockfile |
| `js-yaml` | npm | `~3.0.1` | 3.0.2 | `^4.3.2` | **4.3.2** | security (critical) | 3.0.2 is critical and drags `argparse` 0.1.16 → `underscore` 1.7.0, themselves two further critical nodes. The 4.x line is not automatically safe: **≥ 4.3.1 is required** — see row note 6 | One call-site change: `yaml.safeLoad` → `yaml.load` in `config/routes.js`. The parsed value is the 51-entry reserved-username list, so the same usernames are still rejected. `argparse` measured 0.1.16 → 2.0.1 |
| `jsonwebtoken` | npm | `^5.0.5` | 5.7.0 | `^9.0.2` | **9.0.3** | security (high) | High over `<= 8.5.1`: unrestricted key type, insecure key retrieval, and a signature-validation bypass from an insecure default algorithm | No code change. `sign`/`verify` round-trip the repository's exact shapes on HS256 with the payload preserved. Application-source call sites unchanged: `jwt.sign` ×3 and `jwt.verify` ×1, plus one `jwt.sign` in a spec |
| `bull` | npm | `^0.7.0` | 0.7.2 | `^4.16.5` | **4.16.5** | security (high, over a critical nest) | 0.7.2's nested `lodash@3.10.1` is a node of the lodash **critical**, and it drags `semver@4.3.6` and `redis@2.8.0`. **Requires source changes** — see row note 8 | Nest cleared, measured: baseline `bull/node_modules` held `lodash@3.10.1`, `redis@2.8.0`, `redis-parser@2.6.0`, `semver@4.3.6`; delivered nests only `uuid@8.3.2`. Method-presence checking was **not** accepted as evidence, so functional worker tests are the gate |
| `adm-zip` | npm | `~0.4.4` | 0.4.16 | `^0.6.0` | **0.6.0** | security (high) | High over `< 0.6.0`: a crafted ZIP triggers a 4 GB allocation | Call site unchanged (`new zip()`), but **archive-read behaviour is a changed surface**, so the storage contract and archive-layout cases cover it rather than a call-site diff. It is also the reader that exposed the writer defect in the **retained** `archiver` 2.1.1 (§9.5): 0.6.0 validates the central-directory CRC that 0.4.16 trusted, so it throws where 0.4.16 silently returned an empty buffer |
| `lodash` | npm | `^4.17.21` | 4.17.23 | `^4.18.1` | **4.18.1** | security (critical) | Critical over `<= 4.17.23`, whose newest member is the prototype-pollution array-path bypass in `_.unset` / `_.omit` | Call sites unchanged across both consumers: `_.extend` ×4, `_.find` ×2 and `lodash.escape` ×1 in `lib/controllers/trinket.js` and `lib/util/nunjucks.js`. The nested `lodash@3.10.1` node under `bull` clears with the `bull` row |
| `validator` | npm | `^5.6.0` | 5.7.0 | `^13.15.35` | **13.15.35** | security (high) | High over `<= 13.15.20` (incomplete filtering of special elements; the underlying advisory range reaches `< 13.15.22`), over earlier ReDoS and `isURL` bypass moderates | `validator.isEmail` ×2 is the whole usage, and **the verdict it returns changed**, so the two call sites now route through `the legacy `isEmail` in `lib/controllers/course.js` (§9.1)` — a port of 5.7.0's `isEmail` that delegates the unchanged `isByteLength` back to the installed package. See §9 |
| `tmp` | npm | `0.0.25` | 0.0.25 | `^0.2.7` | **0.2.7** | security (high) | High over `<= 0.2.5`: path traversal via an unsanitized prefix/postfix. **This was the baseline's single exact pin** — the one row where the declared value was already a version | `tmp.tmpName` is the only call site and is unchanged |
| `csv` | npm | `~1.2.1` | 1.2.1 | `^6.4.1` | **6.6.3** | security (high) | High over `0.4.2 - 4.0.0` via `csv-parse` | `require('csv').parse` is the only usage and is byte-identical before and after; its callback interface is retained deliberately, so the promise boundary stays at the handler |
| `diff` | npm | `~1.0.8` | 1.0.8 | `^8.0.4` | **8.0.4** | security (high) | High ReDoS over `<= 3.5.0` on the 1.x line, plus a later `parsePatch`/`applyPatch` denial-of-service | `diff.applyPatch` is the only call site, and **it reads a patch dialect the front end still produces**, so it now routes through the `applyLegacyPatch` port in `lib/controllers/course.js` (§9.2), formerly `lib/util/diff-compat.js` — a port of 1.0.8's `applyPatch`. See §9 |
| `mime` | npm | `~1.2.11` | 1.2.11 | `^4.1.0` | **4.1.0** | security (high) + maintained major | High ReDoS on MIME lookup of untrusted input. The patch that clears it leaves an unmaintained major, which the request does not permit when a maintained one works — see row note 15 | Node 22 supported and synchronously requireable, verified by loading it. `mime.lookup` ×3 → `mime.getType` ×3 and `mime.extension` ×1 → `mime.getExtension` ×1 — **four call sites across two controllers**, enumerated in full in row note 15, which also records the third consuming file's unused import. The rename is mechanical and the census is static; **runtime parity across those sites is a defined gate, not a result this delivery carries** — [`baseline-parity.md`](baseline-parity.md) §5 holds every parity gate's status |
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
   version-sensitive in the same way. **None of that is provable from method presence, so the gate
   for it is a functional worker run** — one deterministic successful job and one deterministic
   failing job — rather than a structural check. That gate is defined in `test/parity/worker.js`,
   which reports a distinct **blocked** verdict rather than a pass when the export chain cannot
   complete, and it **has not been executed in this delivery**;
   [`baseline-parity.md`](baseline-parity.md) §5 carries its status. What this row therefore rests on
   is the three source changes above, each read from the delivered consumers rather than inferred
   from the release notes. `lib/util/queues.js` keeps its `handler(job, done)` interface: it is a
   utility a converted handler awaits, not a lifecycle method.

15. **`mime` moves to a maintained major rather than resting on the patch.** The high advisory clears
    at 1.4.1, so the 1.x line offers a fix — but taking it would leave the application on an
    unmaintained major, which the request's "upgrade the same package to a maintained major where
    possible" does not permit when a maintained one works. 4.1.0 works: it supports Node 22 and it is
    synchronously requireable (a successor that could not be loaded from CommonJS at all would have
    forced a loader change this migration is not authorized to make). It does declare
    `"type": "module"`, so `require('mime')` yields the module namespace and the instance is reached
    as `require('mime').default` — which is how both files that call it spell the import.

    **The rename is mechanical, and its call sites are four, across two controllers:**

    ```console
    $ grep -rn "mime\.getType(\|mime\.getExtension(" lib/
    lib/controllers/trinket.js:1223:            type     = mime.getType(mainName) || type;
    lib/controllers/trinket.js:1271:            type     = mime.getType(mainName) || type;
    lib/controllers/trinket.js:1306:          type     = mime.getType(file) || type;
    lib/controllers/files.js:93:    var ext      = config.app.extensionWhitelist[fileExt] ? fileExt : mime.getExtension(contentType);
    ```

    Baseline carried the same four, spelled the old way: `mime.lookup` at
    `2f8712a:lib/controllers/trinket.js:1192`, `:1230` and `:1255`, and `mime.extension` at
    `2f8712a:lib/controllers/files.js:42`. `lookup` → `getType`, `extension` → `getExtension`, one
    for one, with no third form and no site left behind.

    **A third file requires `mime` and is deliberately not in that count.**
    `lib/controllers/users.js:13` imports the package and never calls it — its only other `mime`
    token is `file.mime` at `:563`, a property of a stored document rather than the module — and
    `git show 2f8712a:lib/controllers/users.js` carries the identical unused import at `:9`. It is an
    unchanged baseline condition rather than something this migration introduced, and mime 4's
    namespace interop never reaches it, which is why that file alone still spells the import without
    `.default` and why nothing breaks: nothing calls it.

    **What is established here is the census, not runtime parity.** The four sites above are a
    complete static enumeration and the rename is one-for-one; whether mime 4 returns the same value
    as mime 1.2.11 at each of them, for each input the application supplies, is a **defined gate that
    this delivery has not executed** — the plan records mime 4 behaviour among its open items, to be
    settled by call-site parity (AAP §0.9.6), and [`baseline-parity.md`](baseline-parity.md) §5
    carries the status of every parity gate.

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
| `mime` | `mime.lookup` ×3 → `mime.getType` ×3 and `mime.extension` ×1 → `mime.getExtension` ×1 — four sites in two controllers, `lib/controllers/trinket.js` and `lib/controllers/files.js`; a third file imports the package without calling it, unchanged from baseline (row note 15) |
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
as majors *on advisory grounds*. That was **withdrawn** as inconsistent with the triage rule stated in
§1: once the lockfile was regenerated, none of the first three produces a critical or high finding —
so an advisory-driven bump of any of them would have been unforced. All three are consequently
deferred: `archiver` at **2.1.1**, `mongoose` at 6.13.9 and `jszip` at 3.6.0. In `archiver`'s case the
regeneration is what cleared it: `brace-expansion` resolves **1.1.18** through
`archiver@2.1.1 → glob@7.2.3 → minimatch@3.1.5`, outside the `<= 1.1.17` vulnerable range, so the
archiver-borne high that the bump was originally argued from does not return.

`rimraf` was never a bump candidate at all, for a reason worth stating because it is the clearest
evidence the rule was applied honestly: **it has no advisory of its own.** It left the manifest
because its sole call site became `fs.promises.rm`, which is a removal (§4), not a version move. A
tidy table that quietly kept those four majors would have been the wrong artifact.

**`archiver` did not then move, and the withdrawal stands on every axis.** An interim delivery moved
it to 6.0.2 anyway, arguing that §1's *other* qualifying reasons — a runtime warning and a
demonstrated defect — licensed what the advisory axis did not. That argument does not survive the
frozen dependency authorization, which retains 2.1.1 and says of the earlier major bump that it "is
withdrawn. Do not reintroduce it." The delivered tree therefore **retains `archiver` at 2.1.1**,
declared `^2.0.0` exactly as at `2f8712a`, and the two measured shortfalls are carried as **unresolved
gates rather than resolved by an unapproved major bump** — which is the only disposition consistent
with R-a, whose diff must read as four things and nothing else, and with R-d, since the writer defect
is pre-existing baseline behaviour whose correction would change persisted archive bytes. §9.5 is the
record: both shortfalls, their mechanism, their measured gate consequences, the narrower remedies that
were measured and rejected, and the follow-up that would close them.
[`deferred-dependencies.md`](deferred-dependencies.md) §2.6 carries the measurement narrative.
**An implementing agent must not reintroduce the bump** as part of this migration; it is separately
approved work, and §9.5 states what evidence it would have to carry.

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
| `request` | npm | `^2.51.0` | 2.88.2 | **critical** (range `*`, plus an SSRF moderate and a critical `form-data` node) | Dead after conversion. Four call sites replaced with native `fetch`: the streaming asset fetch, the two Google OAuth calls, and the reCAPTCHA POST. Each site's per-branch outcomes — including the transport-failure and malformed-body faults — are **captured and compared**: `test/parity/corpus.json` reports `baselinesPending: 0` and `undriven: 0` with a recorded response on 391 of its 392 scenarios, and `npm run verify:corpus` replays 391 of them against this tree on both cookie passes — 367 matching and 23 differing in the non-secure pass, with the `request`-replacement sites among the matches. The corpus itself still carries no `replayVerdict` or `targetResponse`, which is by design: verdicts live in the replay's own artifact. An earlier revision recorded the comparison as the half still owed, with the gate exiting 2 and refusing the committed artifact; re-capturing through the delivered generator resolved that, and [`baseline-parity.md`](baseline-parity.md) §5 carries the status |
| `rimraf` | npm | `~2.2.6` | 2.2.8 | none | Dead after conversion. Its sole call was a Node-core-style callback inside a hapi handler, so it became `await fs.promises.rm(dir, {recursive: true, force: true})`, preserving the baseline's wait-then-respond order and its swallowed error. **It has no direct advisory, so a version bump was never justified** — this row is the cleanest demonstration that the triage rule drove dispositions rather than package age |
| `sha1` | npm | `~1.1.0` | 1.1.1 | none | No consumer in retained source |

### 4.2 Development removals — 4

| Package | Registry | Baseline declared | Baseline resolved | Baseline finding | Reason |
|---|---|---|---|---|---|
| `chai-as-promised` | npm | `^6.0.0` | 6.0.0 | none | Registered in `test/setup.js` but **functionally unused**: measured zero occurrences of `eventually`, `rejectedWith`, `.fulfilled` or `becomes(` across the suite's assertion surface, `test/lib/` and `test/helpers/`. No promise-plugin assertion exists in the suite. The one further `eventually` in the tree is English in a prose comment, not an assertion — §8 records the locator |
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
| `chai` | npm | `^3.5.0` | 3.5.0 | `^3.5.0` | **3.5.0** | **retained** — not moved | Nothing forced it, and the plan had allowed for something that would have: the selected `sinon` 22.1.0 declares **no `peerDependencies` at all** (read from its delivered lock entry), so no assertion peer pulled `chai` forward, and §4.2's removal of `chai-as-promised` had already lifted the `chai >= 2.1.2 < 4` cap that would otherwise have decided it. Moving it would have been an unforced change to the assertion library that **20 files under `test/` require directly**, for no mapped reason. Recorded because a forced move was anticipated and did not materialise |
| `mongodb-memory-server` | npm | — | — | `11.2.0` | **11.2.0** | **added**, exact pin | The suite must provision its own MongoDB under `git clean -xfd && npm ci && npm test` on a host with no Docker |
| `mocha` | npm | `^3.4.1` | 3.5.3 | `^3.4.1` | 3.5.3 | **retained deliberately** — a decision, not an omission | **`test/mocha.opts` stopped being read in Mocha 8**, and a bump past Mocha 7 fails *silently* rather than loudly: it would discard all six flag lines the delivered file carries — `--reporter spec`, `--recursive`, `--check-leaks`, `--require ./test/env.js`, `--timeout 20000` and the `test/lib/**/*.js` glob — taking the leak detection, the environment preload and the spec selection with them. Staying on 3.5.3 is what keeps that failure out of this migration's diff. It loads and runs on Node 22.23.2 and is outside the `npm audit --omit=dev` gate as a development-only package; see the forward note below and the dev-side audit note beneath it |
| `supertest` | npm | `~0.8.3` | 0.8.3 | `~0.8.3` | 0.8.3 | **retained** | A test-harness package with **live consumers** — `test/helpers/flow.js` builds every API suite's agent from it and `test/lib/00-ready.js` resolves the server it wraps — so it is neither dead nor replaceable without rewriting the harness, which is not this migration's work. No finding in the gated `npm audit --omit=dev` set, being development-only; the dev-side note beneath the table records what a dev-inclusive audit does show |
| `redis-mock` | npm | `~0.2.0` | 0.2.0 | `~0.2.0` | 0.2.0 | **retained** | A test-harness package with a **live consumer**: `test/env.js` installs it as the redis stub during the environment preload, which is what lets the suite run with `db.redis.enabled: false` and no Redis process. **Measured to carry no advisory at all**, on either side of the `--omit=dev` boundary, so nothing qualifies it under §1's rule |
| `sass` | npm | `^1.57.0` | 1.98.0 | `^1.57.0` — **unchanged** | 1.98.0 | **retained** — no change at all | Neither a version move nor a declaration change. **Build tooling is deliberately out of scope**, and that boundary is load-bearing rather than incidental: the request requires the build to produce the *same output artifacts at the same paths*, `public/css/base.css` and `public/css/embed.css`, so the compiler that produces them is the last thing to move. An interim delivery pinned the declaration to the exact `1.98.0` it already resolved; nothing in the plan maps a Sass change, so that was unforced and is withdrawn. **Measured to carry no advisory at all** |
| `vite` | npm | `^4.5.14` | 4.5.14 | `^4.5.14` | 4.5.14 | **retained** | Same boundary as `sass`, and the same reason: `vite` **is** the `build:css` and `watch:css` scripts, so a major bump is a change to the artifact-producing step this migration is required to leave alone. Development-only, so it is outside the gated `npm audit --omit=dev` set; the dev-side note beneath the table records the finding a dev-inclusive audit reports against it |

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

**Forward note on `mocha`, which is the mechanism its "retained deliberately" row points at.** The
suite's flags live in `test/mocha.opts`, and **`mocha.opts` stopped being read in Mocha 8**. A future
bump past Mocha 7 would not fail loudly — it would *silently discard every flag*, including
`--check-leaks`, and take the reporter and the spec glob with it. Any such bump must move those flags
to `.mocharc.yml` in the same change. Staying on 3.5.3 is what keeps that out of this migration's diff.

**Every retained development dependency has a disposition, and the reasons are not interchangeable.**
R-c asks for a reason per package, and "not blocking" repeated six times is not one — it describes the
gate rather than the package. The six retained rows above therefore each carry the specific decision
that produced them: `mocha` is retained **deliberately**, because the bump fails silently through
`mocha.opts`; `chai` did not move because the selected `sinon` declares no assertion peer and the cap
that would have forced it was removed with `chai-as-promised`; `sass` and `vite` are untouched because
build tooling is out of scope precisely so the CSS artifacts and their paths do not move; and
`supertest` and `redis-mock` are harness packages with live consumers, named above, that nothing in
this migration replaces. The companion record for the development set is in
[`deferred-dependencies.md`](deferred-dependencies.md), in its development-dependency disposition
section; this table is the version-and-decision half and that document is the reasoning half, as with
every other package here.

**The dev-side audit, stated so "no qualifying finding" is not read as more than it claims.** The
stated gate is `npm audit --omit=dev` and §7 reports it: **0 critical, 1 high, 6 moderate**. A
dev-inclusive `npm audit` on the same tree reports **4 critical, 7 high, 9 moderate — 20 findings**,
which is **13 rows that the gate excludes**, measured: `cookiejar`, `debug`, `diff`, `esbuild`,
`growl`, `mime`, `minimist`, `mkdirp`, `mocha`, `qs`, `superagent`, `supertest` and `vite`. Their
attribution is what matters for the dispositions above. **Eleven of the thirteen** are the retained
`mocha` 3.5.3 chain (`mocha` itself, plus `diff`, `growl`, `mkdirp` and the `minimist` beneath that
`mkdirp`) and the `supertest` 0.8.3 chain (`supertest`, `superagent`, and `mime`, `qs` and `cookiejar`
beneath it), with `debug` reached from **both**; `vite` and its `esbuild` are the remaining pair. So
the two retentions with dev-side findings are `mocha` and `supertest`, both **direct**, and neither
is silently accepted: each is a recorded decision above with the specific mechanism that forbids the
bump. Three of the six — `chai`, `redis-mock` and `sass` — carry **no advisory on either side of the
`--omit=dev` boundary**.

**What `--omit=dev` does and does not tell you about the shipped image.** `--omit=dev` is the logical
scope of the audit gate. It is **not** a statement about the contents of the delivered container, and
on this repository the two genuinely differ, so it is recorded rather than glossed. The root image is
a **single stage**: [`Dockerfile`](../Dockerfile) declares one `FROM`, installs with a plain `npm ci`
that resolves `devDependencies` along with the production set, and then runs `npm run build:css` —
which is *why* the dev graph is installed, since `vite` and `sass` are what build the two stylesheets.
Nothing after that step prunes the graph or copies the application into a production-only stage, and
`NODE_ENV` is not set until after it. **So the final image physically contains all thirteen findings
above, including the four criticals and seven highs**, even though the gate the request specifies
correctly excludes them from its own scope.

That is a property of the image rather than of these dispositions, and the image is **owned by another
work unit at this checkpoint** — the prune-or-multi-stage change that would remove the exposure is a
`Dockerfile` change, not a dependency change, and this document does not pre-empt it. What belongs
here is the accurate statement: these six packages are retained for the reasons given above, their
dev-side findings are real, the audit gate does not measure them **by design**, and their absence from
the deployed artifact is **not established** and will not be until the final stage excludes them.
An earlier revision of this paragraph asserted that none of the thirteen reaches a deployed artifact;
that was wrong on the delivered `Dockerfile` and is withdrawn.

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

Copied from the delivered `package.json`, with the enclosing object retained so the excerpt is valid
JSON standing alone:

```json
{
  "engines": { "node": ">=22.0.0 <23.0.0", "npm": ">=10.0.0 <11.0.0" }
}
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

**The four `serverside/*/manager` units, precisely.** Each now installs from a **committed lockfile
that did not exist before** — the baseline tree carried their `package.json` files and no lockfiles at
all, so these are **first-time creations rather than regenerations**. Their manifests are
**unchanged** from `2f8712a`; the work was runtime pinning, dependency resolution and a boot check
on Node 22. All four lockfiles are `lockfileVersion` 3, and all four manifests declare
`"type": "module"`. **Their application code was not converted**: these
units carry no hapi surface, and they are separate deployment units documented in
`serverside/README.md`.

**Every direct package in all four units, with its resolution and its reason.** R-c asks for a
registry entry, a resolution and a reason per package, and a lockfile package count is none of those.
Registry is the public npm registry for every row. Every declaration below is **unchanged from
baseline** — the reason column is therefore the reason the package is *there*, since nothing about the
declarations was chosen by this migration.

| Unit | Lock packages | Package | Declared | Resolved | Reason it is declared |
|---|---:|---|---|---|---|
| **java** | 44 | `config` | `^3.3.12` | 3.3.12 | YAML configuration layering, the same mechanism the root application uses |
| **java** | | `file-type` | `^18.0.0` | **18.7.0** | Sniffs the media type of files the sandbox emits, so the manager can tell the browser what it produced |
| **java** | | `socket.io` | `^4.8.0` | 4.8.3 | The manager *is* a socket server: it brokers between the browser and the shell container |
| **java** | | `socket.io-client` | `^4.8.0` | 4.8.3 | The other half of that broker — the manager is itself a client of the shell socket |
| **r** | 44 | `config` | `^3.3.12` | 3.3.12 | As `java`; the two units differ only in the language runtime they front |
| **r** | | `file-type` | `^18.0.0` | **18.7.0** | As `java` |
| **r** | | `socket.io` | `^4.8.0` | 4.8.3 | As `java` |
| **r** | | `socket.io-client` | `^4.8.0` | 4.8.3 | As `java` |
| **python** | 47 | `config` | `^3.3.12` | 3.3.12 | As `java` |
| **python** | | `file-type` | `^18.0.0` | **18.7.0** | As `java` |
| **python** | | `socket.io` | `^4.8.0` | 4.8.3 | As `java` |
| **python** | | `socket.io-client` | `^4.8.0` | 4.8.3 | As `java` |
| **python** | | `is-svg` | `^4.3.2` | **4.4.0** | SVG is the one image type `file-type` cannot sniff from magic bytes, so this decides whether sandbox output is a displayable image. It is also the declaration that made the **root** `is-svg` removal safe (§4.1) |
| **pygame** | 42 | `config` | `^3.3.9` | 3.3.12 | As `java`, but note the **older declaration** — `^3.3.9`, not `^3.3.12` — resolving to the same 3.3.12 |
| **pygame** | | `file-type` | `^19.0.0` | **19.6.0** | As `java`, but a **major ahead** of the other three units |
| **pygame** | | `socket.io` | `^4.7.4` | 4.8.3 | As `java`; older declaration, same resolution |
| **pygame** | | `socket.io-client` | `^4.7.4` | 4.8.3 | As `java`; older declaration, same resolution |
| **pygame** | | `is-svg` | `^5.0.0` | **5.1.0** | As `python`, but a **major ahead** of it |

Eighteen declarations across the four units, and **four distinct packages plus `is-svg`** in two of
them. `pygame` is the one unit that diverges: it is a major ahead on both `file-type` and `is-svg` and
a patch behind on its `config` and `socket.io` declarations, which is worth knowing before anyone
treats the four graphs as interchangeable.

**Residual advisories, per unit and exactly.** Measured with `npm audit --package-lock-only` in each
manager directory, on `node v22.23.2` / `npm 10.9.8`. **None is critical or high**, and none is
cleared by this delivery:

| Unit | Total | Advisory | Package | Direct | Severity | Vulnerable range | Fix available |
|---|---:|---|---|---|---|---|---|
| java | **1 moderate** | GHSA-5v7r-6r5c-r473 | `file-type` | yes | moderate | `>= 13.0.0 < 21.3.1` | `file-type@22.0.2` — **semver-major** |
| r | **1 moderate** | GHSA-5v7r-6r5c-r473 | `file-type` | yes | moderate | `>= 13.0.0 < 21.3.1` | `file-type@22.0.2` — **semver-major** |
| python | **3 moderate** | GHSA-5v7r-6r5c-r473 | `file-type` | yes | moderate | `>= 13.0.0 < 21.3.1` | `file-type@22.0.2` — **semver-major** |
| | | GHSA-gh4j-gqv2-49f6 | `is-svg` | yes | moderate | via its `fast-xml-parser` | `is-svg@6.1.0` — **semver-major** |
| | | GHSA-gh4j-gqv2-49f6 | `fast-xml-parser` | no (via `is-svg`) | moderate | `< 5.7.0` — resolves **4.5.7** | `is-svg@6.1.0` — **semver-major** |
| pygame | **3 moderate** | GHSA-5v7r-6r5c-r473 | `file-type` | yes | moderate | `>= 13.0.0 < 21.3.1` — resolves **19.6.0** | `file-type@22.0.2` — **semver-major** |
| | | GHSA-gh4j-gqv2-49f6 | `is-svg` | yes | moderate | via its `fast-xml-parser`; resolves **5.1.0** | `is-svg@6.1.0` — **semver-major** |
| | | GHSA-gh4j-gqv2-49f6 | `fast-xml-parser` | no (via `is-svg`) | moderate | `< 5.7.0` — resolves **4.5.7** | `is-svg@6.1.0` — **semver-major** |

- **GHSA-5v7r-6r5c-r473** — an **infinite loop in `file-type`'s ASF parser** on malformed input with a
  zero-size sub-header (CWE-835). It reaches every one of the four units, **directly**, and the fix is
  a semver-major.
- **GHSA-gh4j-gqv2-49f6** — **XMLBuilder XML comment and CDATA injection via unescaped delimiters** in
  `fast-xml-parser`, present in the `python` and `pygame` graphs beneath `is-svg`. Its fix is also a
  semver-major. **Its exploit path is not established here, and the distinction is the point of the
  next-but-one paragraph**: the advisory is a *graph* finding in these two units, not a demonstrated
  reachable one.

**The `file-type` advisory is reachable, and that has to be stated rather than implied.** Each
manager's `'file added'` socket handler passes bytes produced by **user-submitted sandbox code**
straight into the parser:

```console
$ grep -n "fileTypeFromBuffer(data.buffer)\|isSvg(data.buffer)" serverside/*/manager/manager.js
serverside/java/manager/manager.js:199:        data.type = await fileTypeFromBuffer(data.buffer);
serverside/pygame/manager/manager.js:172:      const type = await fileTypeFromBuffer(data.buffer);
serverside/pygame/manager/manager.js:174:      if ((type && /^image/.test(type.mime)) || isSvg(data.buffer)) {
serverside/python/manager/manager.js:212:        data.type = await fileTypeFromBuffer(data.buffer);
serverside/python/manager/manager.js:214:        if ((data.type && /^image/.test(data.type.mime)) || isSvg(data.buffer)) {
serverside/r/manager/manager.js:203:        data.type = await fileTypeFromBuffer(data.buffer);
```

So the path is short and fully attacker-controlled at its input: code a user runs in the sandbox
writes a file, the shell container emits `'file added'` with the file's bytes, and the manager hands
those bytes to the ASF parser before anything else inspects them. A crafted file therefore reaches the
infinite loop, and **a manager is a single-threaded Node event loop shared by every session it
brokers** — so the stall is not scoped to the user who caused it. It denies service to every connected
user of that language's manager until the process is restarted, and it needs no privilege beyond the
ability to run code in the sandbox, which is the product's whole purpose. **That consequence is scoped
to this advisory**: the ASF infinite loop is what stalls the loop, and nothing below extends the stall
claim to the other finding.

**Graph presence is not reachability, and the second advisory is only the former.** In `python` and
`pygame`, `is-svg` reads the **same buffer** one line later, which makes it tempting to record
GHSA-gh4j-gqv2-49f6 as reachable by the same path. Measured, it is not. That advisory is an
**XMLBuilder** flaw — unescaped comment and CDATA delimiters while *building* XML output — and the
locked consumers do not build XML at all:

```console
$ grep -n "fast-xml-parser" is-svg@4.4.0/index.js is-svg@5.1.0/index.js
is-svg@4.4.0/index.js:2:const {XMLParser, XMLValidator} = require('fast-xml-parser');
is-svg@5.1.0/index.js:1:import {XMLParser, XMLValidator} from 'fast-xml-parser';

$ grep -rn "XMLBuilder" serverside/*/manager/manager.js
$ echo $?
1
```

`is-svg` 4.4.0 and 5.1.0 import and invoke only `XMLValidator.validate` and `new XMLParser().parse`,
and no manager imports or calls `XMLBuilder` anywhere. So passing a buffer to `isSvg` exercises the
parser and the validator, neither of which is the flawed component. The audit entry is real and stays
in the table above — the vulnerable version genuinely is in those two graphs, and a future consumer
that did build XML would acquire the exposure — but **only GHSA-5v7r-6r5c-r473 is proven reachable
through the user-controlled byte path**. An earlier revision of this section claimed both were
reachable "by the same path"; that conflated presence with reachability and is withdrawn.

**The ownership seam, stated plainly.** Clearing the `file-type` advisory is a manifest-and-lock
change in those four units — a semver-major bump to `file-type@22.0.2`, and `is-svg@6.1.0` for the two
that carry it — and those files are **owned by a different work unit at this checkpoint**. This document records the graphs; it does not change them. **The resolution and
advisory cells above are the state of the delivered manager locks as this section was written**, and
they must be re-read from those locks if that change lands. Re-deriving them is mechanical:

```console
$ for u in java python pygame r; do
    ( cd "serverside/$u/manager" \
      && node -e "const p=require('./package.json'),l=require('./package-lock.json'); \
           console.log(Object.keys(l.packages).length+' packages, type='+p.type); \
           for (const [n,r] of Object.entries(p.dependencies)) \
             console.log('  '+n+' '+r+' -> '+l.packages['node_modules/'+n].version)" \
      && npm audit --package-lock-only )
  done
```

### 6.5 The install and build steps in the root image

| Step | Baseline | Delivered | Why |
|---|---|---|---|
| Install | `RUN npm install --legacy-peer-deps` | `RUN npm ci` | The delivered lockfile resolves without the flag, so dropping it is what keeps the image's dependency tree identical to the one tested on the host. Verified: `npm ci --dry-run --no-audit --no-fund` exits 0 with no peer-resolution flag |
| Components | `curl -L --silent -o ./public-components.tgz`, then a separate `&&`-chained `tar xzf` of the file it wrote, inside one `RUN` — with two established defects: **`curl` carried no `--fail`**, so an HTTP error status still exited 0 and the error body was saved *as* the archive, and **no cryptographic digest was checked**, so any well-formed archive was extracted unverified | `RUN node scripts/fetch-components.js` | One digest-verified, idempotent, atomic implementation shared by the host and the image. The two baseline defects did not fail equally: an HTML error body did stop the build, because `tar xzf` rejects it (`gzip: stdin: not in gzip format`) and the `&&` chain fails the layer — but as a late extraction error attributed to `tar` rather than to the download that actually failed — while a **well-formed but wrong, substituted or truncated-yet-still-valid archive was accepted silently**, which is exactly what the SHA-256 verification now prevents |
| CSS | *absent* | `RUN npm run build:css` | `public/css/base.css` and `public/css/embed.css` are gitignored build outputs, so **the baseline image contained neither stylesheet** and every page rendered unstyled. It runs after `npm ci` (it needs vite and sass) and after the component fetch (the SCSS entry imports from `public/components`) |

## 7. Audit result

`npm audit --omit=dev`, measured on both trees.

| | Critical | High | Moderate | Total |
|---|---|---|---|---|
| Baseline `2f8712a` | **15** | **28** | **16** | **59** |
| Delivered | **0** | **1** | **6** | **7** |

The delivered figure was measured twice and agrees: once against the installed `node_modules` and
once with `--package-lock-only`, on `node v22.23.2` / `npm 10.9.8`. It matches the figure the frozen
plan specifies. An interim delivery reported five moderates because lockfile regeneration had floated
`mongoose` off its deferred 6.13.9, clearing that package's advisory as a side effect; the resolution
is pinned back and the sixth moderate is listed below.

The seven remaining findings, each attributed:

| Package | Severity | Direct | Advisory range |
|---|---|---|---|
| `marked` | **high** | yes | `<= 4.0.9` |
| `aws-sdk` | moderate | yes | `>= 2.0.1` |
| `bull` | moderate | yes | `>= 2.0.0` |
| `highlight.js` | moderate | yes | `9.0.0 - 10.4.0` |
| `jszip` | moderate | yes | `<= 3.7.1` |
| `mongoose` | moderate | yes | `< 6.13.10` |
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

Every figure in this document was measured against the delivered tree. Thirteen measurements
disagreed with the planned expectation. In each case **the measurement is what is recorded above**,
and the disagreement is logged here rather than quietly reconciled.

| # | Expected | Measured | Nature |
|---|---|---|---|
| 1 | `nodemailer` 9.1.0 | **9.1.1** | Caret float. `^9.1.0` resolved to the newer patch; no decision changed |
| 2 | `jsonwebtoken` 9.0.2 | **9.0.3** | Caret float |
| 3 | `csv` 6.4.1 | **6.6.3** | Caret float |
| 4 | `@hapi/inert` — a security patch | Advisory severity is **moderate**, and `@hapi/inert` declares **no** `peerDependencies` | Substantive. Neither severity nor a peer constraint qualifies this row under the triage rule; it is the table's one flagged exception (row note 2) |
| 5 | `joi` — advisory-driven | `joi` 17.13.3's finding is **moderate-only** (`< 17.13.4`) | Substantive. The qualifying reason is the **request's explicit directive**, not security; §3 records the category as such |
| 6 | `mime`'s high clears at 1.6.0 | It clears at **1.4.1** | The 1.x fix is earlier than stated; 1.6.0 is simply the last 1.x. The disposition is unaffected — the row moves to 4.1.0 for the maintained-major reason |
| 7 | `js-yaml` 4.1.0/4.1.1 carry "a later high" | The 4.x high spans **`4.0.0 - 4.3.0`**, plus an `!!omap` high reaching **`< 4.3.1`** | Broader than expected: the floor is 4.3.1, not "above 4.1.1". Verified by auditing a `js-yaml@4.1.1` manifest — 1 high |
| 8 | 6 moderate findings, including `mongoose` | **6 moderate**, `mongoose` among them | Resolved. An interim delivery measured **5**, because lockfile regeneration had floated `mongoose` 6.13.9 → 6.13.11 inside its unchanged `^6.0.0` declaration and 6.13.11 is outside the `< 6.13.10` advisory range. The float was reverted rather than reported — the resolution is pinned back to 6.13.9 — so the figure agrees with the plan and `mongoose` still correctly does not appear in §3, since nothing about it was chosen |
| 9 | `sass` unchanged | **Unchanged in both respects** — declaration `^1.57.0`, resolved 1.98.0 | An interim delivery pinned the declaration exact with no mapped reason; reverted, so the row now records genuinely no change |
| 10 | One `serverside` manager declares `"type": "module"`; manifests and lockfiles regenerated | **All four** declare `"type": "module"`; the four manifests are **unchanged** and the four lockfiles are **first-time creations** | The baseline tree carried no manager lockfiles at all, so "regenerated" overstated it (§6.4) |
| 11 | Three legacy three-argument `sinon.stub` calls | **Six** at baseline, across four files; two vanish with the deleted dead helpers, leaving four to convert | Undercount. Does not change the `sinon` disposition, only the size of the call-site work it forces (§5) |
| 12 | `is-svg` — a critical ReDoS | **High** ReDoS (`2.1.0 - 4.2.2`) | Severity only. Still qualifies under the triage rule, and the removal reason — no root consumer — is independent of it |
| 13 | `archiver` moved 2.1.1 → 6.0.2 for a runtime warning and a writer defect | **Retained at 2.1.1** per the frozen disposition — declared `^2.0.0`, resolving 2.1.1, byte-identical to `2f8712a` — with both shortfalls carried as unresolved gates | Substantive. An interim delivery took a dependency decision the frozen plan had **withdrawn**; the version is restored and the shortfalls are recorded rather than silenced. Consequences reconciled here: the `archiver` row is gone from §3, the version-move count is **16**, and §9.5 is the retention record rather than an argument for a move (§1, §9.5) |

Two further measurement notes, recorded because they bear on how the figures above should be read:

- **The `minimist` critical was never the declared `minimist`.** The baseline tree's critical
  `minimist` node is `node_modules/optimist/node_modules/minimist` (`<= 0.2.3`); the declared root
  `minimist@1.2.8` is not flagged at all. Removing `optimist` is what cleared that critical, and the
  `minimist` declaration was removed purely as dead (§4.1).
- **Two "no code change" claims survived a false positive each**, and both are reported in row notes
  15–16 rather than left as clean-looking rows: `accepts`' apparently removed `.type(` call belonged
  to the deleted fake-reply builder, and `jsonwebtoken`'s apparent second `jwt.verify` is a comment.
  A symbol-count comparison alone would have mis-classified both.

One evidence-state note, re-checked against the delivered tree so that a reviewer re-running it gets
the answer this document predicts. §4.2 removes `chai-as-promised` and `sinon-chai` on the strength
of their **functional** non-use — zero assertions in the suite use either, measured — and the two
`require` lines and two `chai.use(...)` calls that named them are removed by `test/setup.js`'s own
reduction. **That reduction has landed**, and the removals are complete rather than pending: the
reduced `test/setup.js` is an inert signpost ending in `module.exports = {};` with no `require` and
no `chai.use(...)` in it, neither package is declared in the delivered `devDependencies` (eight
entries, §4.3), and no reference to either name survives anywhere under `test/` or in
`package.json`:

```console
$ grep -rn "chai-as-promised\|sinon-chai" test/ package.json
$ echo $?
1
```

Zero hits. No assertion expression changed as a consequence — the plugins were registered but
functionally unused, which is the reason §4.2 gives for removing them.

## 9. Where an API-compatible version was not a behaviour-compatible one

Three rows in §3 kept their call sites and still changed what the application does. They are grouped
here because they share one lesson: a symbol-level check — same function name, same arity, same
return type — proves the code still *runs*, and proves nothing at all about the answer it gives. Each
needed a measured verdict comparison, and two needed an adapter.

Those three rows are §9.1 to §9.3. Two further subsections belong here because they turn on the same
distinction between a version that resolves and a version that behaves: **§9.4** records the lockfile
entries a regeneration silently undoes, together with the provenance digest that makes any measurement
against this lock checkable, and **§9.5** records the one **retained** package whose API is compatible
and whose behaviour is not — `archiver` 2.1.1, which changed nothing and is on the deferred list, but
whose two measured shortfalls this document owns the record of.

### 9.1 `validator` 5.7.0 → 13.15.35 — the legacy `isEmail` in `lib/controllers/course.js`

`validator.isEmail` has the same signature in both releases and a different verdict in sixteen of a
103-address corpus, all in the same direction: accepted at baseline, rejected now.

That matters because the verdict is **persisted**. `[T lib/models/courseInvitation.js:52]` writes
`status: "invalid"` on the upserted CourseInvitation when the address is rejected — and `"pending"`,
which is what `sendEmails` later picks up, when it is accepted. `[T
lib/models/courseInvitation.js:117]` writes `"resend"` or `"invalid"` the same way. So a changed
verdict means an invitation stored with a different status and never mailed. R-d forbids that as much
as it forbids any other behaviour change.

Three mechanisms account for all sixteen:

| Mechanism | Example | 5.7.0 | 13.15.35 |
|---|---|---|---|
| 5.7.0 strips **every** dot from the local part when the domain is `gmail.com` or `googlemail.com`, before any other check | `foo..bar@gmail.com` | accepted | rejected |
| 5.7.0's UTF-8 local-part class starts at `\u00A0`; 13.x starts at `\u00A1`, excluding the no-break space | `fo<NBSP>o@example.com` | accepted | rejected |
| 13.x added a 254-character ceiling on the whole address; 5.7.0 bounds only the local part (64 bytes) and the domain (256 bytes) | a 255-character address | accepted | rejected |

The gmail rule is domain-specific and easy to misread: the same local part at `example.com` is
rejected by **both** versions, so this is not a general relaxation of dot handling.

**Where that reproduction lives in the delivered tree.** `[T lib/controllers/course.js:77]` defines a
local `isEmail(str)` reproducing 5.7.0's control flow, the gmail fold, its FQDN check and its
local-part expressions, and `[T lib/controllers/course.js:138]` assigns it onto the installed module
as `validator.isEmail = isEmail`. That assignment is the mechanism, and it is deliberate: the verdict
is consumed inside `lib/models/courseInvitation.js`, which calls `validator.isEmail` at `:52` and
`:117`, and reassigning the method preserves those two persisted-status call sites without editing a
model file this delivery otherwise leaves alone. An earlier revision of this section placed the
reproduction in a dedicated `lib/util/email-compat.js` with `courseInvitation` calling it directly;
that module was removed as a path outside the authorized file set, and the semantics moved to the
call site above rather than being dropped. The byte-length check is **delegated back** to the
installed `validator`, because `isByteLength` did not change: it is `encodeURI(str).split(/%..|./).length - 1` in both releases and
was measured identical across 19 inputs spanning ASCII, accented Latin, CJK, astral-plane characters,
`\u00A0` and the 64/256-byte boundaries. So `validator` remains a live, security-current dependency
and only the part that actually diverged is carried locally.

Verified: 103 addresses through validator 5.7.0, validator 13.15.35 and the adapter. The adapter
agrees with 5.7.0 on **103 of 103** — including all sixteen that 13.15.35 changed.

**Committed coverage — stated as what it now is.** The 59-case spec this section used to cite,
`test/lib/util/email-compat.js`, was removed with the module it covered, so **no committed test
asserts these sixteen verdicts**. What remains is the comparison recorded above — 103 addresses
through validator 5.7.0, validator 13.15.35 and the delivered reproduction, agreeing with 5.7.0 on
103 of 103 — and the `isEmail` contract note carried at `[T lib/controllers/course.js:24-30]`. That
is a measurement without a regression test, and it is recorded here as such rather than presented as
covered: a future edit to the local `isEmail` or the removal of the `validator.isEmail` assignment
would change a persisted invitation status with nothing in the suite to catch it.

### 9.2 `diff` 1.0.8 → 8.0.4 — `applyLegacyPatch` in `lib/controllers/course.js`

`diff.applyPatch` also kept its signature, and it reads a patch the server does not produce. The
patch is produced in the browser by **jsdiff 1.0.8**, which committed configuration pins:
`config/default.yaml`'s `app.ngapps.courseEditor` loads
`//cdnjs.cloudflare.com/ajax/libs/jsdiff/1.0.8/diff.min.js`, and
`public/js/courseEditor/controllers/materialControl.js:321-323` strips the file header before POSTing
the remainder. `config/default.yaml` and `public/js/**` are both out of scope for this migration and
are unchanged, so the producer's dialect is fixed at 1.0.8 and only the consumer moved.

Measured over the realistic cases, the visible divergence is the first content written into an empty
material — patch `@@ -1,0 +1,1 @@\n+new\n` applied to `''`:

| server `diff` | result | stored `content` |
|---|---|---|
| 1.0.8 (baseline) | `'new\n'` | `'new\n'` |
| 8.0.4 | `'\nnew'` | `'\nnew'` — a leading newline gained, the trailing one lost |

**Where that port lives in the delivered tree.** `[T lib/controllers/course.js:169]`
defines `applyLegacyPatch(oldStr, uniDiff)`, a port of 1.0.8's `applyPatch`, and the patch site calls
it at `[T lib/controllers/course.js:880]` — the same file, so the consumer and the dialect it
requires sit together, with the three worked examples carried in the comment above the function. An
earlier revision of this section placed the port in a dedicated `lib/util/diff-compat.js`; that
module was removed as a path outside the authorized file set and the port moved to the call site
rather than being dropped. Its quirks are load-bearing and are preserved deliberately, the most important being
that a context mismatch returns boolean `false` — the stale-page signal `course.updateMaterial` tests
with `===` to answer "This page may have been modified in another window". Verified across 42 cases
against a real `diff@1.0.8`: **42 of 42** agree, with 8.0.4 diverging in 10 of them.

One correction to the record while we are here: the drift was originally described as clearing a
one-line material moving from `false` to an empty string. Measured with a genuine 1.0.8-dialect
patch, **both** versions return `''` for that case, so it saves `content: null` either way. The
category was right and the example was not.

**Committed coverage — stated as what it now is.** The 24-case spec this section used to cite,
`test/lib/util/diff-compat.js`, was removed with the module it covered, so **no committed test
asserts these ten divergences**, including the stale-page `false` the controller compares with `===`.
What remains is the comparison recorded above — 42 cases against a real `diff@1.0.8`, agreeing 42 of
42 — and the worked examples in the function's own header. As with §9.1, that is a measurement
without a regression test, and it is recorded as such: the `false`-versus-`''` distinction is exactly
the kind of behaviour a later simplification would erase silently.

### 9.3 `mime` 1.2.11 → 4.1.0

The third row of this kind. Its call sites moved from `lookup`/`extension` to `getType`/`getExtension`
and its **database** changed, which is a returned-value change rather than an API one. It is recorded
in §3's row and in the storage cases rather than here, because it needed no adapter — but it belongs
to the same class of risk, and the same lesson applies.

### 9.4 Three lockfile entries that must be re-checked after every regeneration — and the provenance that makes a re-check meaningful

All three are cases where `npm install` will silently undo a deliberate decision, so a regeneration is
not complete until they are verified. **Two of the three fired again during the regeneration that
produced the delivered lockfile, and were caught** — which is the argument for keeping this list:

1. **`marked`.** `package.json` declares `git+https://github.com/trinketapp/marked.git`, but npm
   canonicalises GitHub-hosted git dependencies and writes `resolved:
   "git+ssh://git@github.com/..."` into the lockfile. Measured: it does this even when the install
   was performed from the HTTPS URL. The delivered lockfile carries the **HTTPS** form with the
   commit pin `#55ea82491047d038b4360b78d092f77d439df63f`, so that the lockfile and the manifest
   agree and the entry names no credential-bearing transport. Re-assert it after any regeneration.
   Note that a git dependency cannot carry an `integrity` field at all — the commit SHA is the
   immutability guarantee, and the declared spec is fixed by R-d, which retains this fork.
   **This trap fired again** in the regeneration that produced the delivered lockfile: npm rewrote
   `resolved` to the `git+ssh://` form and it was restored to
   `git+https://github.com/trinketapp/marked.git#55ea82491047d038b4360b78d092f77d439df63f`, which is
   the value the delivered lockfile now carries.
2. **`mongoose`.** Deferred at **6.13.9** with a `^6.0.0` declaration, so a regeneration floats it to
   the newest 6.x. See [`deferred-dependencies.md` §2.2](deferred-dependencies.md). **This trap fired
   before and was caught again**: the earlier float to 6.13.11 is discrepancy 8 in
   [§8](#8-measurement-discrepancy-log), and in this regeneration `mongoose` **held at 6.13.9**,
   verified against the delivered lock rather than assumed.
3. **`archiver`.** Retained at **2.1.1** under the frozen disposition, declared `^2.0.0` (§9.5). The
   `^2.0.0` caret cannot float out of the 2.x line, so the risk here is not npm's — it is an
   implementing agent re-taking the withdrawn major bump because the two shortfalls in §9.5 look like
   a reason to. Re-assert the declared range **and** the resolved version after any regeneration; a
   lock that resolves anything other than 2.1.1 is out of compliance with the frozen plan, whatever
   the gates then report.

**Lock provenance — the digest every figure in this document is measured against.** A re-check of the
three entries above is only meaningful if a reader can tell *which* lockfile, and which installed
graph, a measurement was taken from. This delivery states both, because an interim delivery did not:
its evidence was produced against a `node_modules` carrying `archiver` 2.1.1 and `mongoose` 6.13.11
while the committed lock said 6.0.2 and 6.13.9, so **the committed graph was never the graph anything
was measured on** and the gate outcomes could not be attributed to it (§9.5, and discrepancies 8 and
13 in [§8](#8-measurement-discrepancy-log)).

| Provenance fact | Value |
|---|---|
| `package-lock.json` sha256 | `8742bea576dd110e2ad339d3916febe68de25b932b0d1bf0897a0abab2181ba5` |
| Packages in the lock | **456** (455 excluding the root record) |
| `archiver` | declared `^2.0.0`, resolved **2.1.1** |
| `mongoose` | declared `^6.0.0`, resolved **6.13.9** |
| `marked` | resolved `git+https://github.com/trinketapp/marked.git#55ea82491047d038b4360b78d092f77d439df63f`, version **0.3.2** |
| `npm ci` | **exit 0**, with **no** `--legacy-peer-deps`: *added 416 packages, and audited 417 packages* |
| Direct dependencies installed-equals-locked | **47 of 47** (39 production + 8 development) — **0 mismatches** |
| Toolchain | `node v22.23.2`, `npm 10.9.8` |

**The rule that follows, and it is the one the interim delivery broke:** *any measurement taken
against a `node_modules` that does not match this digest is not evidence about this lockfile.* A gate
result, an audit figure or a parity verdict is attributable to a dependency graph only if the graph it
ran on is the committed one, so re-derive the digest and the installed-equals-locked comparison before
producing evidence, and record the digest alongside the result.

Re-deriving each figure, in the order of the table:

```console
$ sha256sum package-lock.json
$ node -e "const l=require('./package-lock.json'); \
    console.log(Object.keys(l.packages).length, \
      l.packages['node_modules/archiver'].version, \
      l.packages['node_modules/mongoose'].version, \
      l.packages['node_modules/marked'].resolved)"
$ npm ci
$ node -e "const fs=require('fs'), path=require('path'); \
    const p=require('./package.json'), l=require('./package-lock.json'); \
    const names=[...Object.keys(p.dependencies), ...Object.keys(p.devDependencies)]; \
    let bad=0; \
    for (const n of names) { \
      const locked=(l.packages['node_modules/'+n]||{}).version; \
      let inst='MISSING'; \
      try { inst=JSON.parse(fs.readFileSync(path.join('node_modules',n,'package.json'),'utf8')).version; } catch (e) {} \
      if (locked!==inst) { bad++; console.log('MISMATCH', n, locked, inst); } \
    } \
    console.log(names.length, 'direct deps,', bad, 'mismatches')"
```

For the record, and because the reviewed concern was specifically that a clean container build might
need SSH material: with the delivered HTTPS entry, `npm ci` was measured to succeed — exit 0, with
`marked` 0.3.2 installed — from a **clean npm cache**, with `GIT_CONFIG_GLOBAL` and
`GIT_CONFIG_SYSTEM` both `/dev/null`, no `SSH_AUTH_SOCK`, and `git` itself shimmed to exit 127. npm
fetches GitHub-hosted git specs over the codeload HTTPS tarball, so the install needs neither SSH
credentials, a host-global URL rewrite, nor the `git` binary.

Precisely what that run emitted, since "no warnings" would be the wrong claim: **no warning
mentioning `marked`, SSH, or a skipped integrity check**, and no error. It did print npm's ordinary
`npm warn deprecated` notices for the packages this plan deliberately defers — `aws-sdk`,
`highlight.js`, `glob`, `uuid` and others. Those are registry metadata about the packages, not
diagnostics about the install, and they are unrelated to the transport question this measurement
answers. The zero-warning gate in
[`baseline-parity.md` §6.11](baseline-parity.md) is about the **running application** under
`--pending-deprecation`, which is a different measurement from what `npm` prints while installing.

### 9.5 `archiver` retained at 2.1.1 — the frozen disposition, and two unresolved shortfalls

**Nothing in this section is a version move, and the heading no longer says otherwise.** An earlier
revision of this section was titled `archiver` 2.1.1 → 6.0.2 and argued the move through; the title
and the argument are both withdrawn. `archiver` has **no row in §3** because it did not change: it is
declared `^2.0.0` and resolves **2.1.1**, byte-identical to `2f8712a`, so it contributes no manifest
diff at all. What this document owns is the **record** — the frozen disposition, and the two measured
shortfalls the delivery carries open. [`deferred-dependencies.md`](deferred-dependencies.md) §2.6
carries the full measurement narrative and is not duplicated here.

**Why the frozen disposition governs.** The frozen dependency authorization retains 2.1.1 and says of
the earlier major bump that it "is withdrawn. Do not reintroduce it." Two rules make that binding
rather than advisory:

- **R-a** — the diff must read as a runtime bump, a hapi API migration, an async conversion and
  blocking-only dependency swaps. A major bump the frozen plan had already considered and withdrawn is
  none of those four, whatever its merits read in isolation.
- **R-d** — behaviour improvements are prohibited, and here R-d is genuinely engaged rather than
  invoked: the archive bytes are **persisted observable output**, written into S3 under the export
  worker's `s3Key` and served from the trinket-download routes. Correcting the metadata changes those
  bytes. That is an improvement, and an improvement is exactly what R-d forbids.

**The two shortfalls, with their mechanism and their measured gate consequence.**

| # | Shortfall | Mechanism | Measured consequence |
|---|---|---|---|
| 1 | `[DEP0005] Buffer() is deprecated` | `compress-commons/lib/archivers/zip/constants.js:11` evaluates `new Buffer(0)` at module scope, reached on `require('archiver')` | **One** warning under `--pending-deprecation --trace-deprecation`, at module load, **off the request path**. The server still boots and `GET /` answers 200 |
| 2 | `crc32 = 0` and `uncompressed size = 0` in every deflated entry | `crc32-stream` 2.0.0 accumulates both values inside an override of `Writable.prototype.write`; modern Node's `Writable.prototype.end(chunk)` does not route through `write()`, so `zip-stream` 1.2.0 delivering a buffer entry with `.end(source)` records neither. The compressed size, accumulated in a `push` override that *is* still reached, stays correct — which is why the archive's size and structure look right and only the metadata is wrong | Written into the local header, the data descriptor **and** the central directory, so `adm-zip` 0.6.0 `getData()` throws `ADM-ZIP: CRC32 checksum failed` |

Gate status on the delivered tree: `npm run verify:storage` reports **34 of 35 cases**, exit 1 — the
failing case is `archive-layout`, alongside one captured DEP0005 and one emitted finding — and
`npm run verify:worker` reports **92 of 109 checks passed** over 7 jobs driven on real `bull` 4.16.5,
with **17** failing and a **FAIL** verdict. Only one of the 17 is the zero-warning policy; the other
16 are the successful export failing to complete and everything that depends on it, which belongs to
the `q`/Mongoose retention rather than to `archiver` — see `docs/deferred-dependencies.md` §2.7. An
earlier revision of this paragraph recorded 109 of 110 and stated that every functional worker
assertion passes; the gate's artifact contradicts both, and the corrected figures are the measured
ones.

**Both are unresolved shortfalls, not approved deviations, and the distinction is not bookkeeping.**
An approved deviation is a **prohibition** argued away by a stronger requirement; a shortfall is a
**validation target** that has not been met. Exactly two deviations are authorized — the never-settling
file response and the retained `marked` fork — and neither of them is a deprecation warning or a
writer defect. Recording either of these as a deviation would convert an open finding into a closed
one and the finding would stop being visible to the gates that read it.
[`preserved-quirks.md`](preserved-quirks.md) classifies the DEP0005 the same way.

**Why the two narrower remedies were rejected — each measured, not assumed.**

1. **Force the transitive chain with `overrides`.**
   `overrides: {"zip-stream":"^4.1.1","compress-commons":"^4.1.2","crc32-stream":"^4.0.3"}` **does**
   fix the metadata — the CRC and size become correct and `getData()` works — **and it does not clear
   the warning.** With that chain in place `new Buffer()` is still reached from
   `archiver-utils/index.js:87`, called by `Archiver.append` at `archiver/lib/core.js:571`, and
   `archiver@2.1.1/lib/core.js` has three `new Buffer(0)` calls of its own. The deprecated constructor
   is in **archiver's own source and in the `archiver-utils` 1.x major it pins**, where no override
   reaches it. It is also strictly worse: the warning moves from one line at boot to **one per archive
   built**, on the request path. So it trades a boot-time warning for a per-request one and still
   leaves a shortfall open.
2. **Append a stream instead of a buffer** at the four `lib/workers/exports.js`
   `archive.append(...)` call sites. The storage harness measured this as a **working** fix — the
   override is reached, and the crc and size are recorded correctly. That is precisely why it is
   refused: it moves crc32 from 0 to correct and therefore **changes persisted archive bytes**, which
   R-d forbids for the same reason the version bump is forbidden. A fix that works and is prohibited
   is still prohibited.

**The named follow-up that would close both.** A version move, delivered as **separately approved
work** rather than inside this migration's diff, carrying the evidence this delivery cannot produce
for it: baseline-versus-target **archive-byte** parity — the byte-level diff of a fixed-content archive
before and after, with the changed CRC and uncompressed-size fields identified field by field — and
**worker parity** over a successful and a failing export job. Until that is approved and evidenced,
2.1.1 stays and both shortfalls stay visible.

**Why these two findings are recorded here at all.** `test/parity/storage.js` names this file as their
destination in its own output — `FINDING (docs/dependency-inventory.md): adm-zip / archiver archive
read surface` and `FINDING (docs/dependency-inventory.md): DEP0005 from the dependency` — and
attributes ownership to `package.json` and `package-lock.json` (the writer chain
`archiver 2.1.1 → zip-stream 1.2.0 → compress-commons 1.2.2 → crc32-stream 2.0.0`) together with
`lib/workers/exports.js`, the archiver call site. It also records that both are **pre-existing at base
commit `2f8712a`** and that the harness reports them and does not repair them. This section is that
report's landing place.

**One provenance point worth stating, because it is what made the interim state hard to see.** The
storage gate's outcome is **byte-identical before and after this reversion** — `gate FAILED: 3
failure(s) - case=1 warning=1 finding=1` both times — because the installed graph already carried
`archiver` 2.1.1 while the committed lock said 6.0.2. **The committed 6.0.2 graph was never the graph
any evidence in this delivery was produced from.** §9.4 records the digest and the installed-equals-locked
check that makes that class of mismatch detectable rather than invisible.

---

*Navigation note, recorded rather than acted on: `mkdocs.yml` is out of scope for this migration and
its `nav:` lists only `index.md`, `setup.md` and `overview.md`. If these four migration documents
should be published on the docs site, adding them is a separate, deliberate change.*
