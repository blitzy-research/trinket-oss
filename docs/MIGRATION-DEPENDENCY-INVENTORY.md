# Dependency Migration Inventory

This is the complete record of every dependency decision taken by the Node 22 LTS / hapi 21 modernization: what was
bumped, what was replaced, what was deleted, and what was deliberately held — each with the reason, the exact version
on both sides, and the verification that made the decision safe.

The document exists to discharge the binding rule R-3, quoted verbatim:

> "Every replaced or major-bumped package must be recorded in a delivered artifact — not merely in a commit message —
> stating the original, the replacement, and a reason classified as dead, incompatible, or security."

R-3 imposes three obligations, and this file is how each is met.

- **Delivered, not buried in a commit message.** This document is registered in the MkDocs navigation in `mkdocs.yml`
  under the title *Dependency Migration Inventory*, so it is published as part of the documentation site rather than
  existing only in the tree; its sibling [PRESERVED-QUIRKS.md](PRESERVED-QUIRKS.md) is registered on the next nav
  line and links back to this file in several places. It is also linked from the modernization entry in
  `CHANGELOG.md`. **The `CHANGELOG.md` half of that claim was false when this document was first written** — the file
  was then still the seven-line initial-release stub, carrying no modernization entry and therefore no link — and it
  is true now because the entry and the link were added, rather than because the sentence was quietly deleted. Both
  halves are one command each: `grep -c 'MIGRATION-DEPENDENCY-INVENTORY' docs/PRESERVED-QUIRKS.md` and
  `grep -n 'MIGRATION-DEPENDENCY-INVENTORY' CHANGELOG.md mkdocs.yml`. Earlier revisions of this sentence hard-coded a
  backlink count and specific line numbers in the other two files; every one of those figures went stale as the
  documents were edited, so the commands are given instead of the numbers.
- **Every replaced or major-bumped package.** Completeness is auditable rather than asserted: the dependency name
  sets of the base-commit `package.json` and the committed `package.json` were extracted and diffed, and every name
  in the symmetric difference appears below. The base commit declared **58 runtime and 11 development**
  dependencies; the committed manifest declares **38 runtime and 10 development** dependencies. Both figures are
  re-derivable in one command —
  `node -e "var p=require('./package.json');console.log(Object.keys(p.dependencies).length, Object.keys(p.devDependencies).length)"` —
  and the rubric tables below agree with them row for row.
- **The mandatory triple.** Every entry states the original, the replacement, and a reason drawn from R-3's
  vocabulary of **`dead`**, **`incompatible`** and **`security`**. No fourth code is used and nothing is left
  unclassified. The contract is **one or more codes, primary first** — not exactly one. Where a single decision is
  genuinely driven by two of the three at once — a major bump that both clears an advisory and is forced by a
  changed calling convention — the row is coded **`security, incompatible`** and both halves are evidenced. That is
  a compound of R-3's own codes rather than an additional code, and it is the form the plan itself uses when it
  labels the major-bump rubric *"security and/or incompatible"*. It is stated openly here rather than collapsed to
  whichever half reads better.

**Rule-set provenance.** There is no separate user-supplied rules document for this project. No rules have been
invented to fill that gap, and its absence is **not** treated as permission to lower the bar. The binding rule set
this inventory answers to is the six-item **RULES block carried inside the change request itself** — referred to
throughout as R-1 through R-6 — plus the house style contract at `CONTRIBUTING.md` §Code Style (L62-L66), plus
enterprise-standard best practice.

**Where the behavioral decisions live.** R-4's documentation obligation is discharged in the sibling deliverable
[PRESERVED-QUIRKS.md](PRESERVED-QUIRKS.md), not here. Every hold recorded in Rubric 5 below, and every accepted
audit finding, has its full behavioral reasoning and its measurement there. A reader who wants to know *why a
tempting upgrade was refused* should read that catalogue; this document records *what the dependency set became*.

**Two conventions about the numbers in this document, stated once.**

- **Lockfile entry counts exclude the root entry.** `package-lock.json`'s `packages` map carries one entry keyed `""`
  for the project itself. Every count below is of the entries *other* than that one, so base = **677** and committed =
  **466**; add one to each for the raw `Object.keys(...).length`. Earlier revisions mixed the two conventions inside a
  single document and consequently contradicted themselves; the rule above is now applied uniformly.
- **Mocha run totals are deliberately not published.** A pass total moves every time this changeset adds a spec, and
  earlier revisions quoted a stale one in four places. The non-volatile form — ***`npm test` exits 0 with zero
  failures*** — is used throughout instead, and the authoritative total is whatever `npm test` prints on the tree in
  front of you. This matches the same convention in
  [PRESERVED-QUIRKS.md](PRESERVED-QUIRKS.md). Counts of *files*, *call sites* and *lockfile entries* are **not**
  covered by this rule and are still stated exactly, because those are properties of the committed tree rather than of
  a run.

## Net manifest shape

| Measure | Base commit | Committed |
|---|---|---|
| Runtime dependencies | 58 | **38** |
| Development dependencies | 11 | **10** |
| `engines` block | **absent entirely** | present — `node >=22.12.0 <23.0.0`, `npm >=10.0.0 <11.0.0` |
| `packageManager` field | **absent entirely** | present — `npm@10.9.9` |
| `overrides` block | **absent entirely** | present, **3** entries: `brace-expansion` 2.1.4, `diff` 9.0.0 and `serialize-javascript` 7.0.7 |
| `package-lock.json` | present, lockfileVersion 3 | regenerated, lockfileVersion 3, committed |

The net runtime reduction of 20 is 23 departures from the runtime block set against 3 additions, and those 23
decompose exactly, with no remainder:

- **11** declared but never required, deleted outright — Rubric 4
- **1** declared but never `require`d directly, still needed at runtime by a kept package in development and test
  only — `chokidar`, **relocated to `devDependencies`** rather than deleted, which is what removes it from the runtime
  block while keeping the environment `npm test` and a non-production boot need. See *Retained despite never being
  required*
- **2** passport strategies made dead by the deletion of `lib/auth/passport.js`, deleted outright — Rubric 4
- **4** replaced by a Node built-in — `request`, `q`, `mkdirp`, `rimraf` — Rubric 3
- **3** removed with no replacement at all, because the only consumer was deleted or the binding was never read —
  `optimist`, `tab`, `node-uuid` — Rubric 3
- **2** replaced by a newly added maintained package — `aws-sdk` and `node-cryptojs-aes` — Rubric 3
- offset by **3 additions**: `@aws-sdk/client-s3` 3.1098.0, `@aws-sdk/s3-request-presigner` 3.1098.0 and
  `crypto-js` 4.2.0

Note that the departure count and the addition count are **not** two views of one number: 2 originals were replaced
but 3 packages were added, because `aws-sdk` v2 was monolithic and its v3 successor is modular, so the one original
is succeeded by **two** scoped packages — the S3 client and the presigner. `node-cryptojs-aes` accounts for the third
addition one-for-one. The one-to-two expansion is the whole of the arithmetic difference, and it is the subject of the
escalation recorded as Item 6 in *Reconciliation against the plan's dependency projections* below.

That is 23 departures against 3 additions: `58 - 23 + 3 = 38`. The development total is the 2 dead development
packages removed and `chokidar` gained: `11 - 2 + 1 = 10`. Both figures were re-measured by diffing the two manifests'
dependency name sets rather than by carrying an estimate forward.

**Three packages were added, where the plan projected two.** The deviation is recorded here rather than buried,
escalated as Item 6 of the reconciliation below, and it has one cause. AWS SDK v3 is modular where v2 was monolithic,
so `aws-sdk`'s presigned-URL capability does not live in `@aws-sdk/client-s3` — an enumeration of that package's
**707** exports found **zero** presign-related symbols. Presigning is therefore a second scoped package by AWS's own
design, and `@aws-sdk/s3-request-presigner` 3.1098.0 is declared at exactly the client's version. An earlier revision
of this changeset instead implemented presigning inside `config/aws.js` against the client's own resolved
configuration — `client.config.endpointProvider(...)` for bucket addressing and `client.config.signer()` for the
signature — specifically to hold the addition count at two. Code review rejected that as hand-rolled
security-sensitive code built on `@internal` members (finding SV-05), and the supported package was adopted. The
measured consequences of the swap, including the proof that the emitted URL is unchanged where callers can observe it,
are in *Presigned download URLs: the second AWS package* under Rubric 3.

**There are no private-registry packages.** Every dependency resolves from the public npm registry, with exactly one
exception at the base commit: `marked`, which was declared as the git URL
`git+https://github.com/trinketapp/marked.git`.

**Correction — that git specifier was *pinned*, and an earlier revision of this document said otherwise.** The claim
that it was unpinned and therefore "the one blocker to a deterministic lockfile" is **false**. Read from the base
commit's own lockfile:

```json
"node_modules/marked": {
  "version": "0.3.2",
  "resolved": "git+ssh://git@github.com/trinketapp/marked.git#55ea82491047d038b4360b78d092f77d439df63f"
}
```

The commit `55ea8249…` is a full 40-character SHA, and a git commit hash is content-addressed, so the *contents*
were pinned: `npm ci` at the base commit resolved `marked` deterministically, to that commit. The real, measured
reasons for moving it to a registry version are the ones below. Each carries the R-3 code it is filed under, and
none of them is reproducibility:

- **Audit — the decisive reason (`security`).** The forked 0.3.2 carries **8 advisories**, **4 high and 4 moderate**,
  aggregate severity **high**. Measured by auditing the base commit's own lockfile with
  `npm audit --package-lock-only`, which reports them as a single `marked` group with 8 `via` entries: two
  *Inefficient Regular Expression Complexity* findings affecting `<4.0.10`, three further ReDoS findings, and — most
  pointedly — three **sanitization** findings (*VBScript Content Injection*, *XSS from data URIs*, and a
  *Sanitization bypass using HTML Entities*). Those three strike at precisely the control the fork exists to
  provide, since the fork's whole purpose is to accept `sanitize` as a function. `marked@4.3.0` carries **zero**
  findings in this tree. An earlier revision of this list said "two further ReDoS findings"; the measured count is
  three, and the 8-advisory total was correct.
- **API — the fork's load-bearing deviation is preserved, and that was verified rather than hoped
  (`incompatible`).** The fork's five deviations across 26 diff lines matter for exactly one reason: it accepts
  `sanitize` as a **function**, which is how the platform's HTML-whitelist XSS defense is supplied. 4.3.0 does
  expose a `sanitizer` function option, but handing the whitelist to it was **measured to change 47 client-visible
  outputs and to emit a deprecation warning on every render**, so the shipped integration does not use it. The
  sanitizer is installed through `marked.use(...)` and as `Renderer.prototype.html` instead — the four-point bridge
  is described in full below and adjudicated in [PRESERVED-QUIRKS.md](PRESERVED-QUIRKS.md) section 3.35. 4.3.0
  preserves every `Renderer.prototype` arity the four frozen monkey-patches depend on — measured on the installed
  copy: `link` 3, `code` 3, `image` 3, `listitem` 1. Two source changes were required, not one: the require form,
  because `require('marked')` on 4.x is **not callable** (measured) while the destructured `{ marked }` is, at
  `lib/shared/trinket-markdown.js:L1`; and the sanitizer's installation shape.
- **Maintainability (`dead`).** The fork is a 0.3.2-era snapshot with no upstream security maintenance; the eight
  advisories above will never be fixed in it. A pinned commit on an abandoned fork is deterministic *and* frozen at
  whatever defects it had.
- **Install-path portability (`incompatible`), stated accurately.** The base lock entry carries **no `integrity`
  field** (measured), so `npm ci` cannot verify the fetched tree against a hash the way it does for a registry
  tarball; and its `resolved` URL is `git+ssh://git@github.com/...`, which requires a git binary and SSH credentials
  reaching `github.com` inside every build environment — including the container image — rather than an anonymous
  HTTPS fetch, and which does not even match the `git+https` form the manifest itself declared. The committed
  replacement closes both, read back from the committed lockfile: `resolved`
  `https://registry.npmjs.org/marked/-/marked-4.3.0.tgz` with a `sha512` `integrity` value.

One candidate reason is **not** supported by measurement and is recorded here so that it is not repeated: *"`npm
audit` cannot evaluate a git-sourced package"* is false. The audit of the base lockfile quoted above is precisely
how the eight advisories were counted, and it names `marked` explicitly with a `high` aggregate severity. A
git-sourced dependency is not an audit blind spot in this repository. None of the frictions above is the same thing
as being unpinned, and none of them on its own is what made the move necessary — the eight advisories did.

The same decision is recorded, in the same terms, in [PRESERVED-QUIRKS.md](PRESERVED-QUIRKS.md) section 2.

## How this inventory was established

**Every version below was established by direct measurement rather than from release notes.** Release-note prose
states what a maintainer believes changed; a behavior-preservation mandate needs to know what a package actually does
when this codebase's own call sites are executed against it. So the method was empirical throughout: npm-registry
interrogation to establish the exact published version tails available at migration time, plus purpose-built runtime
probe harnesses that installed each candidate package in isolation and ran this codebase's real call-site shapes
against it.

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

**Citation frame.** This document follows the same two-frame convention as its sibling, stated in full under *How to
read this catalogue* in [PRESERVED-QUIRKS.md](PRESERVED-QUIRKS.md). In short: a citation that identifies the **call
site a dependency decision was made about** is given against the **base commit**, because that is where the old call
site existed and where its shape was measured — `lib/util/helpers.js:L264` is `data = jwt.verify(token, secret);` at
the base commit, for instance, and `lib/controllers/trinket.js:L1292` is `var archive = archiver('zip', {`. A
citation that identifies **delivered code** — the replacement require form, a guard this changeset added, the
reachability chain of a held package — is given against the delivered tree. Where the prose reads present-tense but
the code exists only at the base commit, the citation is prefixed **`2f8712a:`**. Citations into `node_modules/` are
versioned by the committed lockfile rather than by either frame. Every citation in this document was re-resolved
against both frames after the last edit to it.

## Reconciliation with the plan's projected figures

**The modernization plan is the frozen source of truth for this dependency set, and this document does not amend it.**
That distinction matters and an earlier revision of this section blurred it: a delivered artifact may record that a
specified decision could not be carried out, but it may not restate the specification. Everything below is therefore
written as a **reading of the manifest against the plan**, never as a correction of the plan. Two kinds of entry
appear, and they are labelled:

- **COUNT** — the manifest and the plan agree on every package-level decision, and a reader counting names simply
  arrives at a different total because the plan's arithmetic carried a figure forward. Nothing is in tension; the plan
  itself calls its runtime total "approximately 38 + 11" and asks the implementer to verify and state their own count.
- **ESCALATION** — a literal reading of a §0.6 projection was **measured unsatisfiable**, because honouring the
  literal figure breaks a hard validation gate the same plan mandates. These are raised here for plan adjudication
  rather than resolved by fiat. Each one states the exact measurement, the exact AAP requirement it collides with,
  and the precedence rule in §0.8.7 that governs the collision — an explicit AAP requirement outranks a projected
  literal. If an escalation is adjudicated the other way, the manifest changes; this document does not get the last
  word on any of them.

Two entries that an earlier revision raised as escalations have since been **closed in the plan's favour** and are
recorded as closed below, so that the direction of travel is visible: `engines.npm` now carries the bounded upper limit
§0.6 asks for, and `chokidar` is out of the runtime dependency block.

| # | Kind | Plan's figure | Measured in the committed manifest | The measurement, and the AAP requirement it bears on |
|---|---|---|---|---|
| 1 | **CLOSED** | `engines.npm` as a bounded range with an upper limit below 11 | `"npm": ">=10.0.0 <11.0.0"`, plus `"packageManager": "npm@10.9.9"` | **Now aligned with the plan.** An earlier revision escalated this, because with `engine-strict=true` the bounded range makes npm 11 refuse to install. The resolution is to move the toolchain onto the pinned resolver rather than to widen the range: every gate — `npm ci`, `npm run build`, `npm test` — was re-run under npm 10.9.9 and all three exit 0. *Item 1 in full* below |
| 2 | **ESCALATION** | one `overrides` entry, pinning `brace-expansion` to `5.0.9` | **three** entries: `brace-expansion` **2.1.4**, `diff` 9.0.0, `serialize-javascript` 7.0.7 | Two escalations in one row. The projected literal `5.0.9` **breaks `minimatch` outright** when forced in, so the pinned value is the lowest version that closes the advisory *and* leaves the resolved tree working. The two additional entries close the only HIGH advisories the development toolchain carried, which R-2 requires and which no single-entry block can reach. *Item 2 in full* below |
| 3 | **COUNT** | 11 development dependencies remaining | **10** | The projection carried the base figure forward without subtracting the 2 dead development packages it enumerated itself; `chokidar` is then gained. `11 - 2 + 1 = 10` |
| 4 | **CLOSED** | `chokidar` among the dead **runtime** removals | **out of `dependencies`**, declared in `devDependencies` at 3.6.0 | **Now aligned with the plan's runtime block.** An earlier revision escalated this as a retention, because `nunjucks` resolves `chokidar` for itself at runtime and deleting it breaks the very environment G7 is measured in. Relocating rather than deleting satisfies both: the runtime dependency block no longer names it, and `npm test` and a non-production boot still work. See *`chokidar` deserves its own note* below |
| 5 | **COUNT** | 12 dead runtime removals and 8 replaced-by-built-in | **11** deleted outright, **1** relocated to `devDependencies`, **4** replaced by a Node built-in, **3** removed with no replacement at all, **2** replaced by a newly added package (which between them account for **3** additions, because AWS SDK v3 is modular — Item 6) — plus **2** replaced by a local in-repo module that were never declared | Four arithmetic differences compound. *Item 5 in full* below |
| 6 | **ESCALATION** | 2 packages added — `@aws-sdk/client-s3` and `crypto-js` | **3** — those two plus `@aws-sdk/s3-request-presigner` **3.1098.0**, pinned to the client's exact version | The projected literal is satisfiable only by hand-writing SigV4 presigning against three `@internal` SDK members, which code review rejected as an unsupportable security-sensitive implementation (finding SV-05) and which R-1's four sanctioned categories do not license. AWS ships presigning as a *separate package by design*: an enumeration of `@aws-sdk/client-s3`'s **707** exports found **zero** presign symbols, so the capability cannot be reached from the two-package set at all. Adopting it costs nothing on either gate the plan sets — `npm audit --omit=dev` is **unchanged** at `{critical: 0, high: 0, moderate: 3}`, precisely §0.6.1.7's projection, and the emitted URL is unchanged in origin, path encoding and expiry. *Item 6 in full* below |

**Item 1 in full — closed, and how.** `.npmrc` sets `engine-strict=true`, which turns the `engines` block from advice
into an enforced gate, so an upper bound below npm 11 does not merely warn: it makes every npm command **fail** on a
distribution whose default resolver is npm 11. That was measured, not reasoned about — a probe manifest carrying the
bounded range produced `npm error code EBADENGINE ... Required: {"npm":">=10.0.0 <11.0.0"} Actual: {"npm":"11.18.0"}`
and exited 1 — and an earlier revision of this document treated that as grounds for keeping the constraint unbounded
above, on the reasoning that AAP §0.9.6's `git clean -xfd && npm ci && npm run build && npm test` chain must exit 0.

**That reasoning inverted the requirement, and the constraint is now bounded.** AAP G1 and R-2 do not ask for an npm
that happens to be installed; they ask for **npm 10**, pinned, so the toolchain is reproducible. The right response to
a checkout carrying npm 11 is therefore to move the checkout onto the pinned resolver, which is exactly what
`packageManager: "npm@10.9.9"` names and what the container image has always installed. The bounded form was then
validated end to end under that resolver rather than assumed: with npm 10.9.9, `npm ci` exits 0 (427 packages added),
`npm run build` exits 0 and reproduces both stylesheet artifacts byte-for-byte, and `npm test` exits 0. The EBADENGINE
refusal under npm 11 is the pin working, and `.npmrc`, `README.md` and `docs/setup.md` all now say so and give the two
one-line commands that switch a local toolchain — `corepack prepare npm@10.9.9 --activate`, or
`npm install -g npm@10.9.9`. (`corepack use` is deliberately not recommended: corepack 0.34.6 documents that it also
rewrites the committed `packageManager` value and performs an install of its own.)

The **lower** bound carries real information of its own and is unchanged: `lockfileVersion: 3` is, in npm's own words,
"the lockfile version used by npm v9 and above, backwards compatible to npm v7", and the `overrides` block needs npm 8
or later, so a floor of 10 is comfortably above both while refusing npm 9 and earlier, which cannot read this lockfile
format.

**Item 2 in full.** The block holds three entries where §0.6.1.2 projects one, and every difference is accounted for.

**A `uuid` entry was carried by an earlier revision and has been REMOVED.** §0.6.1.7 states the plan's own measured
target for the production audit as `{critical: 0, high: 0, moderate: 3}`, and names the two `uuid`-in-`bull` findings
among the three it **accepts** on the grounds that the vulnerable API is unreachable. Pinning `uuid` closed them and
took the production audit to 1 moderate — an improvement on the projection, but an improvement the plan did not ask
for, reached by an `overrides` entry the plan does not specify. Under §0.8.7's precedence the specification wins over a
better number, so the entry is gone and the production audit now measures exactly the plan's `{0, 0, 3}`. The
unreachability evidence that made those two findings acceptable in the first place is retained under *The three
accepted moderate findings* below, because it is the reason the plan accepted them.

**Two entries are added, and both are required by R-2 rather than optional.** The development and build toolchain
carried HIGH advisories that no `brace-expansion` pin can reach, and the plan's own §0.6 projection does not model the
development tree at all. `serialize-javascript` is pinned to **7.0.7** — the advisory range is `<=7.0.4`, and `mocha`
11.7.6 asks for `^6.0.2`, so only an override can move it — and `diff` to **9.0.0**, which is the version the runtime
block already declares, so the pin collapses the nested copy `mocha` resolved rather than introducing a new version
into the tree. Both were verified by execution: `serialize-javascript` 7.0.7 round-trips a `RegExp` and a `Date`
exactly as 6.0.2 did, `diff` 9.0.0 exposes every symbol mocha's reporter uses (`createPatch`, `diffLines`,
`diffWordsWithSpace`), and `mocha` renders an actual-versus-expected diff correctly with both pins in place. Together
they take the **full-tree** audit from 2 HIGH and 1 LOW down to the single HIGH discussed under *The one accepted HIGH
finding* below.

**The pinned `brace-expansion` version departs from the projected literal, and that is the escalation.** §0.6.1.2
projects `5.0.9`; the committed value is `2.1.4`.

A fourth entry pinning `minimatch` to 10.2.6 was carried by an earlier revision and then **dropped**. With
`brace-expansion` pinned and no `minimatch` entry, the resolver selects `minimatch` 9.0.9 and the nested 5.1.9, and the
production audit is identical — so the pin closed nothing. It was also the more invasive option: `minimatch` is asked
for by `glob` at `^9.0.4`, `mocha` at `^9.0.5` and `readdir-glob` at `^5.1.0`, none of which can accept a 10.x.

**The `brace-expansion` escalation, measured.** Forced to 5.0.9 in a
scratch resolution, `minimatch` 9.0.9 loads but **throws on the first brace pattern** — `minimatch('abd', 'a{b,c}d')`
raises `(0 , brace_expansion_1.default) is not a function`, because `brace-expansion` 5.x is `"type": "module"` and the
shape of its CommonJS build is not what `minimatch` 9's compiled `default` access expects. Plain patterns still match,
which is exactly why that breakage survives a smoke test. With `2.1.4` — inside both consumer ranges — the same probe
returns `true`, `true`, `false` for `*.js`/`x.js`, `a{b,c}d`/`abd` and `a{b,c}d`/`aXd`. The advisory is closed at
either version — it was fixed in 2.0.2 — so the only difference between them is that one leaves `minimatch` working
and the other does not. Per §0.8.7, G6's requirement that `npm ci && npm run build && npm test` all exit 0 outranks the
projected literal, so `2.1.4` ships and the departure is raised here for adjudication rather than presented as a
correction to the plan.

**Item 5 in full.** Four arithmetic differences compound here. Item 4 accounts for `chokidar`, which is relocated to
`devDependencies` rather than deleted. Two of the replaced originals were succeeded by newly added packages rather
than by built-ins. Three —
`optimist`, `tab` and `node-uuid` — needed **no** replacement: the first two because their only consumer, the `-R`
route-table dumper, was deleted outright, and `node-uuid` because the base commit never read the binding it imported.
And two of the entries the plan counts among the replaced originals were never manifest entries at all: the deprecated
`url.parse()` **API**, replaced by the non-throwing static `URL.parse()`, and the unscoped `catbox-redis`,
replaced by
`lib/util/catbox-mongoose.js` — the latter appears in neither the base `package.json` nor the base
`package-lock.json`, so it cannot be subtracted from a declared count. Measured against the two manifests' dependency
name sets: 11 deleted + 1 relocated + 2 strategies + 4 + 3 + 2 = **23** departures, **3** added, **38** runtime.

**Item 6 in full — why the third addition is unavoidable, and what it cost.** The v3 swap itself is **mandated by AAP
G5 and §0.7.2**, which record it as gate-mandated because requiring the v2 SDK fires a real `process.on('warning')`
event that the zero-warning boot gate forbids. AWS SDK v3 is **modular where v2 was monolithic**: v2 served presigned
URLs *synchronously* through `client.getSignedUrl('getObject', {...})` for the export-download redirect in
`lib/controllers/users.js`, and `@aws-sdk/client-s3` ships **no presigner at all** — an enumeration of its **707**
exports found **zero** presign-related symbols, and v3 offers no synchronous form anywhere. So the projection of two
additions and the mandate to leave v2 collide: one capability the application already had cannot be reached from the
two-package set.

An earlier revision of this changeset resolved that collision in favour of the count. It held the manifest at two
additions and implemented presigning inside `config/aws.js` against the client's own resolved configuration —
`client.config.endpointProvider(...)` for bucket addressing and `client.config.signer().presign(...)` for the
signature — on the reasoning that this is the same machinery the separate package uses internally, and it measured the
result signature-identical to an independent from-scratch SigV4 reference.

**Code review rejected that reading, and it was right to (finding SV-05).** Three objections survive the parity
measurement. First, all three members relied on are `@internal`: `client.config.endpointProvider`,
`client.config.signer` and `signer.presign` carry no semver guarantee, so a patch bump of a package this changeset
pins by range can silently change or remove them — and the drift is already observable, in that the installed client
declares `version = "3.1097.0"` in its own metadata while resolving as 3.1098.0. Second, "no signing is implemented
here" was true only of the HMAC; the *envelope* — canonical query construction, AWS extended URI encoding of path
segments, the `X-Amz-Content-Sha256` spelling, header hoisting — was hand-written, and every one of those is a place
where a security-sensitive detail can be got wrong without any test noticing. Third, a signature comparison proves the
implementation agrees with a reference *today*, on the cases chosen; it cannot prove it will keep agreeing.

The package was therefore adopted. `@aws-sdk/s3-request-presigner` **3.1098.0** is declared with `--save-exact` at
precisely the client's version, and the footprint is as small as an addition gets: all six of its dependencies were
already in the tree transitively, so regenerating the lockfile **added 1 package, removed 0, and changed 0 resolved
versions**, and `lockfileVersion` stays 3. `config/aws.js` now contains **no** signing code and no `@internal` member
access at all — `getSignedDownloadUrl` is one `getSignedUrl(client, new GetObjectCommand(...), { expiresIn })` call.

**What it cost on the plan's own gates: nothing.** `npm audit --omit=dev` after the addition is
`{"info":0,"low":0,"moderate":3,"high":0,"critical":0}` — byte-for-byte the figure published in *The audit gate*
below and exactly the `{critical: 0, high: 0, moderate: 3}` AAP §0.6.1.7 projects, with the same three advisories
(`bull`, `highlight.js`, `uuid`) and no fourth. `npm ci` exits 0. The emitted URL keeps its origin, its path encoding
and its expiry, so nothing a caller reads changes; the two additions to the query string are enumerated and
measured in *Presigned download URLs: the second AWS package* under Rubric 3.

**Why this is an ESCALATION and not a correction.** §0.8.7's precedence rule is that an explicit AAP requirement
outranks a projected literal. Here the projected literal is "2 packages added" in §0.6.1.4; the explicit requirements
it collides with are G5's zero-warning boot gate (which forbids staying on v2) and R-1's closed list of four
sanctioned change categories (which does not license adding a hand-written SigV4 envelope). The literal loses under
that rule, and the manifest reflects it. But this document does not get the last word: if the escalation is
adjudicated the other way, the presigner comes back out and the earlier implementation returns with it.

Both figures were verified by extracting and diffing the two manifests' dependency name sets rather than by
recounting prose: **23** runtime names removed, **3** added, **38** remaining; **2** development names removed, **1**
added, **10** remaining. The diff is re-derivable in one command, which reads the base manifest out of git rather than
relying on any figure in this document:

```
node -e "var c=require('child_process'),b=JSON.parse(c.execSync('git show 2f8712a:package.json')),n=require('./package.json'),d=function(x,y){return{removed:Object.keys(x).filter(function(k){return!(k in y)}),added:Object.keys(y).filter(function(k){return!(k in x)})}};console.log(d(b.dependencies,n.dependencies),d(b.devDependencies,n.devDependencies))"
```

The removed set it prints is the 23 names enumerated in *Net manifest shape* above; the added set is the 3 recorded
there.

**`chokidar` deserves its own note, because it is the one package the plan's removal list gets wrong.** It has
**zero** direct require sites across all 96 scanned JavaScript files, which is why the plan lists it among the dead
runtime removals. But it *is* loaded at runtime: `nunjucks` 3.2.4 declares `chokidar` as an **optional peer
dependency** (`peerDependencies: {"chokidar": "^3.3.0"}` with `peerDependenciesMeta.chokidar.optional: true`) and
`require`s it lazily at `node_modules/nunjucks/src/node-loaders.js:L35` whenever template watching is enabled — and
`lib/util/nunjucks.js:L8` enables watching for the development and test environments, because `config/app.config.js`
sets `config.isDev` and `config.isTest` from `NODE_ENV`. Measured with `node_modules/chokidar` absent,
`NODE_ENV=test` `require('./config/app.config.js')` followed by `require('./lib/util/nunjucks.js')` throws
`Error: watch requires chokidar to be installed`, and `npm test` exits 1 on it, while `NODE_ENV=production` loads
cleanly and registers all 233 routes. The failure is worth recognising by sight, because it does not name chokidar:
Mocha catches the exception from its CommonJS require of `./test/setup.js`, retries the file through the ESM loader,
re-executes `test/setup.js`'s `sinon.stub(redis, 'createClient')` and reports
`TypeError: Attempted to wrap createClient which is already wrapped` instead.

**A declaration is required, because no resolver in the supported range supplies it.** An *optional* peer dependency
is one npm does not install on the dependent's behalf, and that was measured on both resolver majors the `engines`
floor admits rather than assumed of either: a scratch manifest depending only on `nunjucks` 3.2.4 resolves with **no**
`node_modules/chokidar` entry under npm 11.18.0 **and** under npm 10.9.9, and taking the committed manifest, deleting
only the `chokidar` declaration and letting npm update the existing lockfile in place drops the entry as well —
leaving only the dev-only `chokidar` 4.0.3 copies nested under `mocha` and `sass`, which a bare `require('chokidar')`
from `nunjucks` cannot reach. `chokidar` 3.6.0 is therefore **declared directly**, which satisfies `nunjucks`' `^3.3.0`
peer range with no conflict and makes the tree correct under either resolver. It is recorded under *Retained despite
never being required*, not in Rubric 4.

The generalizable lesson is worth stating, since the same scan underpins Rubric 4: **a direct-require scan is
necessary but not sufficient.** It cannot see a dependency that a kept package `require`s dynamically, and it cannot
tell you whether the resolver will supply that dependency by itself. Every entry in Rubric 4 was therefore
additionally checked against the installed tree and against the peer-dependency declarations of the packages that
were kept, and the one candidate that failed both checks — `chokidar` — was kept rather than removed.

## Rubric 1 — Same-package minor or patch bump

**Reason for every row in this rubric: `security`.** Each of these was proven by execution to preserve every method
this codebase calls, so each is a **manifest-only edit with zero call-site change**. Nothing in `lib/`, `config/` or
`test/` was touched for any row below.

| Package | Original (installed) | Target | Reason | Verification and notes |
|---|---|---|---|---|
| `accepts` | 1.1.4 | **1.3.8** | `security` | Clears high findings in `accepts` and in `negotiator`. Verified still callable as a factory whose `.types` function returns `html` and `json`. **Bumped, never dropped**: `accepts(request).types(['html','json'])` — `lib/util/routeParser.js:L325` at the base commit, `L128` in the delivered tree after the shim was retired — is what selects the HTML-versus-JSON response branch, so dropping it would change content negotiation |
| `js-yaml` | 3.0.2 | **3.15.0** | `security` | Clears two critical findings, including the `argparse` advisory. **Deliberately stays on the 3.x line**: `safeLoad` is still present, so `config/routes.js:L7` needs no edit at all. Advancing to 4.x or 5.x would force the `safeLoad` to `load` rename for **zero** additional security benefit |
| `mime` | 1.2.11 | **1.6.0** | `security` | `lookup`, `extension` and `charsets` all verified present. **Chosen over a swap to a differently named package precisely because it touches zero call sites — R-1 was the recorded tie-breaker.** See [PRESERVED-QUIRKS.md](PRESERVED-QUIRKS.md) section 3.3 |
| `lodash` | 4.17.23 | **4.18.1** | `security` | The advisory targets `_.template`, which is unreachable here — only `_.extend`, `_.find` and `lodash.escape` are used — but the bump costs nothing and closes the finding |
| `@hapi/inert` | 7.1.0 | **7.1.2** | `security` | Clears a moderate finding. Verified in the real deployment shape, alongside `@hapi/hapi` 21.4.10, `@hapi/vision` 7.0.3 and `@hapi/yar` 11.0.3 |
| `jszip` | 3.6.0 | **3.10.1** | `security` | Clears a moderate finding. **This package is live**, required at `lib/controllers/trinket.js:L23`; `new JSZip()` plus `file`, `folder` and `generateAsync` all verified |
| `mongoose` | 6.13.9 | **6.13.10** | `security` | Clears a moderate finding **while staying inside the 6.x line**. `Schema.extend` verified present after the extend plugin is loaded. The reason 6.x is a ceiling rather than a waypoint is in Rubric 5 |
| `brace-expansion` *(transitive)* | 1.1.12 as resolved | **2.1.4, pinned via `overrides`** | `security` | **One override collapses seven high findings**, and the pinned literal is *not* the projected `5.0.9`: forced in, 5.0.9 breaks `minimatch` outright. *The `brace-expansion` pin in full* below |
| `uuid` *(transitive)* | 8.3.2 as resolved | **8.3.2 — no override; the pin an earlier revision added was removed** | `security` | **Removed in response to review finding F-01.** The frozen plan accepts the two `uuid` findings by name on measured unreachability, and does not pin them; the pin took the audit from the plan's projected 3 moderate findings to 1, which is a decision the plan does not make. The unreachability measurement is kept below because it is what licenses the acceptance. *The `uuid` finding in full* below |
| `serialize-javascript` *(transitive, development)* | 6.0.2 as resolved | **7.0.7, pinned via `overrides`** | `security` | **Closes the HIGH advisory the test runner carried.** `mocha` 11.7.6 asks for `^6.0.2` and the advisory range is `<=7.0.4`, so only an override can move it. *The development-tree pins in full* below |
| `diff` *(transitive, development)* | 7.0.0 as resolved under `mocha` | **9.0.0, pinned via `overrides`** | `security` | Collapses the nested copy `mocha` resolved onto the version the runtime block already declares, closing the LOW advisory without adding a version to the tree. *The development-tree pins in full* below |

**The `brace-expansion` pin in full.**

**One override collapses seven high findings.** A single denial-of-service advisory fans out through `archiver` to `zip-stream` and `archiver-utils`, then through `glob` to `minimatch`. The pin is deliberately **inside** every consumer's declared range, and the ranges were read from the committed lockfile rather than assumed: the only two consumers in the tree are `minimatch` 9.0.9 at `^2.0.2` and the nested `minimatch` 5.1.9 at `^2.0.1`, and 2.1.4 satisfies both, where the 5.0.9 an earlier revision carried satisfies neither. Brace expansion and `minimatch` pattern matching were verified still correct after the pin, `npm ls --all` exits 0 with **0** problems, and `npm audit --omit=dev` reports the same `{critical: 0, high: 0, moderate: 3}` either way. **The range is not a formality: an override forces its version regardless of the ranges, and 5.0.9 forced in breaks `minimatch` outright.** Measured in a scratch resolution carrying `minimatch` 9.0.9 with `brace-expansion` overridden to 5.0.9, `minimatch('abd', 'a{b,c}d')` raises `(0 , brace_expansion_1.default) is not a function` — 5.x is `"type": "module"` and the shape of its CommonJS build is not what `minimatch` 9's compiled `default` access expects — while `minimatch('x.js', '*.js')` still matches, which is exactly why the breakage survives a smoke test. The same probe at 2.1.4 answers `true`, `true`, `false` for `*.js`/`x.js`, `a{b,c}d`/`abd` and `a{b,c}d`/`aXd`. There is deliberately **no `minimatch` override**: pinning that package to a 10.x would override three consumer ranges that cannot accept it — `glob` at `^9.0.4`, `mocha` at `^9.0.5` and `readdir-glob` at `^5.1.0` — and it was measured to close nothing the `brace-expansion` pin does not already close

**Why there is no `uuid` override, and the evidence that made its finding acceptable.**

An earlier revision carried a third entry pinning `uuid` to 11.1.1. It worked — the production audit went from 3
moderate findings to 1 — but **AAP §0.6.1.7 states the plan's measured target for that audit as
`{critical: 0, high: 0, moderate: 3}` and names the two `uuid`-in-`bull` findings among the three it explicitly
accepts.** Closing them by way of an `overrides` entry the plan does not specify substitutes a better number for the
specification, which §0.8.7's precedence order does not permit, so the entry has been **removed** and the production
audit now measures exactly the `{0, 0, 3}` the plan projected.

The unreachability evidence is kept, because it is *why* the plan accepted those two findings rather than an argument
for repairing them. `uuid` is not a direct dependency and never has been — measured: **zero** `require('uuid')` sites
anywhere in `app.js`, `config/`, `lib/`, `scripts/` or `test/`. Its single dependent in the tree is the kept `bull`
4.16.5 at `^8.3.0`, and the advisory counts **twice** in the audit, once against `uuid` and once against `bull` as its
path. The advisory concerns a missing bounds check on the optional `buf` argument of `v3`/`v5`/`v6`, and `bull` calls
`uuid.v4()` at exactly **3** sites — `node_modules/bull/lib/queue.js:L120`, `node_modules/bull/lib/queue.js:L1412` and
`node_modules/bull/lib/timer-manager.js:L74` — **always with zero arguments**, with no `v3(`, `v5(` or `v6(` anywhere in
`node_modules/bull/lib`.
npm's own `fixAvailable` for it is `bull` 1.1.3, a **semver-major downgrade** of a live dependency, which is why the
plan accepted the finding instead. The removed pin had itself been measured compatible before it was removed — `uuid`
11.1.1 exposes a real CommonJS build at `node_modules/uuid/dist/cjs/index.js`, declares no `engines` and no
dependencies, has exactly one dependent in the tree, and moved exactly one lockfile entry — but **compatibility is not
authorization**, and §0.6.1.7 is what makes the acceptance the frozen decision. See [PRESERVED-QUIRKS.md](PRESERVED-QUIRKS.md) section 12.2

**The development-tree pins in full.**

**Two HIGH advisories and one LOW lived entirely in the test and build toolchain, and no `brace-expansion` pin could
reach them.** R-2 asks for maintained dependencies and the review that raised this asked specifically for
narrowly-targeted safe versions rather than a blind `npm audit fix`, so two entries were added and both were verified
by execution rather than by release notes.

`serialize-javascript` is pinned to **7.0.7**. It reaches the tree only through `mocha` 11.7.6, which asks for
`^6.0.2`, and the advisory range is `<=7.0.4` — two findings, *"Vulnerable to RCE via RegExp.flags and
Date.prototype.toISOString()"* and *"CPU Exhaustion Denial of Service via crafted array-like objects"* — so the range
cannot be satisfied by resolution and only an override moves it. Mocha uses the package to serialize results between
`--parallel` workers, which this suite never enables, but an override is cheaper than an unreachability argument here
because the API is unchanged: measured on 7.0.7, `serialize({a:1,b:/x/g,c:new Date(0)})` emits
`{"a":1,"b":new RegExp("x", "g"),"c":new Date("1970-01-01T00:00:00.000Z")}`, exactly the 6.x shape.

`diff` is pinned to **9.0.0**, which is the version the runtime block already declares for `lib/controllers/course.js`.
`mocha` asks for `^7.0.0` and resolved a **second, nested** copy, which carried the *"Denial of Service in parsePatch
and applyPatch"* advisory at LOW. The pin therefore collapses two versions into one rather than introducing anything:
measured, `diff` 9.0.0 exposes `createPatch`, `diffLines`, `diffWordsWithSpace` and `applyPatch`, and mocha's spec
reporter renders an actual-versus-expected diff correctly with the pin in place.

Both pins were validated together against the real suite, not only in a scratch resolution: `npm ci` exits 0 and
`npm test` reports zero failures, exit 0.

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
| `joi` | 17.13.3 | **18.2.3** | `incompatible` | **Zero option overrides required** — six differential cases produced byte-identical verdicts; detail beneath the table |
| `adm-zip` | 0.4.16 | **0.6.0** | `security` | All seven instance methods this codebase uses verified against 0.6.0 |
| `archiver` | 2.1.1 | **7.0.1** | `security`, `incompatible` | **Deliberately not 8.0.0**, which is not CommonJS-callable; detail beneath the table |
| `bcrypt` | 5.1.1 | **6.0.0** | `security` | Clears a critical `tar` finding plus high findings in `bcrypt` itself and in `@mapbox/node-pre-gyp`, **and removes a DEP0169 deprecation source**. Both the callback triad and the promise triad verified against the call sites at `lib/models/user.js:L53`, `L56` and `L92` |
| `bull` | 0.7.2 | **4.16.5** | `security`, `incompatible` | `new Queue(name, {redis:{host,port}})` plus `on`, `process` and `add` verified against the exact shapes used at `lib/util/queues.js:L105` and `L122` |
| `csv` | 1.2.1 | **6.6.1** | `security`, `incompatible` | `.parse` verified, for the admin CSV import at `lib/controllers/admin.js:L8` and `L116` |
| `diff` | 1.0.8 | **9.0.0** | `security`, `incompatible` | `applyPatch` verified for the course content patching at `lib/controllers/course.js:L568`. **This is the one bump that required a payload adapter**, because the patch *producer* is a separate browser copy pinned at 1.0.8. *The `diff` bump in full* below |
| `jsonwebtoken` | 5.7.0 | **9.0.3** | `security`, `incompatible` | Two-argument `sign` and payload-returning `verify` verified, for the email verification tokens at `lib/controllers/trinket.js:L368`, `L421` and `L693` and the verify at `lib/util/helpers.js:L264` |
| `nodemailer` | 2.7.2 | **9.0.3** | `security` | Clears a large critical cluster **and removes the DEP0005 deprecation source**, which reached the process through `libmime` to an `iconv-lite` 0.4.15. The exact `createTransport` option shape at `lib/util/mailer.js:L15-L23` verified accepted unchanged |
| `tmp` | **`0.0.25`, an exact pin with no range** | **0.2.7** | `security` | `tmpName(cb)` verified against the one call site, at `2f8712a:lib/controllers/users.js:L591` and now at `lib/controllers/users.js:L883`. The callback form is unchanged across the bump, so the call site itself was untouched. The original specifier is quoted because it is materially the point: this was the one dependency already pinned exactly, so the bump is unambiguous rather than a range re-resolution |
| `validator` | 5.7.0 | **13.15.35** | `security`, `incompatible` | `isEmail` verified on both true and false inputs, for the two call sites in the invitation model. **The bump also changes which addresses are accepted**, so the base behaviour is preserved behind a local predicate. *The `validator` bump in full* below |
| `marked` | **0.3.2, declared as `git+https://github.com/trinketapp/marked.git`** | registry **4.3.0** | `security`, `incompatible` | The only non-registry dependency in the project, and the one bump that required a call-site change. Given its own subsection below: the fork carries **8** advisories that will never be fixed in it, three of them attacking the sanitization the fork exists to provide. It was **not** unpinned — the base lock records commit `55ea824…` — so it did not block determinism |

**The `validator` bump in full.**

`isEmail` verified on both true and false inputs, for the two call sites at `2f8712a:lib/models/courseInvitation.js:L52` and `L117`, now `lib/models/courseInvitation.js:L89` and `L154`. **This is the one bump in this rubric that is NOT call-site-free.** 5.7.0's `isEmail` silently applied Google's dot-insensitive normalisation — for an exact `gmail.com` or `googlemail.com` domain it stripped every dot from the local part before validating — and 13.x removed it, so `a..b@gmail.com` flipped from accepted to rejected. Both call sites decide the **persisted** `status` field and neither route validates the address first, so the flip would have rewritten stored documents in breach of TR6. A `isEmailLegacy` shim reapplies 5.7.0's normalisation before delegating; verified over **2,764** generated cases with **zero** verdict differences against 5.7.0, rescuing **56** addresses that bare 13.x rejects. See [PRESERVED-QUIRKS.md](PRESERVED-QUIRKS.md) section 3.25

**The `diff` bump in full.**

`applyPatch` verified, for the course content patching at `2f8712a:lib/controllers/course.js:L440` — now `L568` — and it still answers the boolean `false` on failure, so the strict `=== false` conflict test beside it is unchanged. **This is the one bump that required a payload adapter.** The *producer* of the patch text is a separate jsdiff copy that is deliberately not upgraded: `config/default.yaml` pins the browser copy at **1.0.8** and `public/js/courseEditor/controllers/materialControl.js:L321` is its sole `createPatch` caller. Both versions were installed side by side and replayed against the shapes this application actually produces. For every hunk header carrying **at least one old line** the output is **byte-identical**; they diverge on exactly one shape — the first edit against an **empty** material, for which 1.0.8 emits the non-canonical zero-old-lines header `@@ -1,0 +1,N @@`. 1.0.8 spliced those added lines in **before** line 1, while 9.0.0 follows GNU patch and inserts them **after** line 1, which prepended a blank line to the first save of every new page and dropped its trailing newline. `lib/controllers/course.js:L567` therefore rewrites that one leading header to its canonical `@@ -0,0 ` form — `^`-anchored, so no other hunk is touched — which was measured to be a **no-op under 1.0.8's own semantics** while restoring byte-identical output under 9.0.0. Persisted course content is unchanged (TR6). See [PRESERVED-QUIRKS.md](PRESERVED-QUIRKS.md) section 3.17

One consumer of this package requires nothing from it, and that is **not** grounds for removing either. `lib/controllers/courses.js:L2` declares `var diff = require('diff')` with **zero** `diff.` references anywhere in that file — but the base commit declares the same unused require at `2f8712a:lib/controllers/courses.js:L3`, so it is pre-existing rather than migration debris, and deleting it is dead-code cleanup that R-1 excludes "even when obviously beneficial" (review finding **F12**). The package itself stays declared and pinned regardless, because `lib/controllers/course.js` is a real consumer. Adjudicated in [PRESERVED-QUIRKS.md](PRESERVED-QUIRKS.md) section 3.45

**The `joi` bump in full, because a validator major is the highest-risk change in the whole migration.** A stricter
or laxer validator changes which requests are accepted with no error surfacing anywhere, so parity was measured rather
than trusted: both versions were installed side by side and run against six differential cases covering pattern,
email, maximum-length, required-field and unknown-key failures. The verdict, `details.length`, the error path in both
its array and its dotted-string form, the error `type` **and the exact message string** were identical in every case.
`{abortEarly: false}` therefore carries forward unchanged and the plain-object schema coercion still works, so no
option overrides are required. See [PRESERVED-QUIRKS.md](PRESERVED-QUIRKS.md) section 3.5.

**The `archiver` bump in full, because the newest major was deliberately refused.** On 8.x, `require('archiver')`
returns an ESM namespace object whose `default` is undefined, so calling it as a bare function throws — the CommonJS
ceiling described below. 7.0.1 keeps the factory form `archiver('zip', {zlib: {level: N}})` callable at all three
sites: `lib/controllers/trinket.js:L1292` and `L1454`, both at compression level 9, and `lib/workers/exports.js:L188`
at level 6. R-1 was the recorded tie-breaker — a class-based migration was viable and exposes an identical surface,
but it cost three call-site rewrites for no benefit. The residual advisory chain is closed by the `brace-expansion`
and `minimatch` overrides in Rubric 1 instead. See [PRESERVED-QUIRKS.md](PRESERVED-QUIRKS.md) section 3.4.

### The `marked` fork replacement, in full

The base commit did not depend on a published `marked`. It depended on a **Trinket fork**, declared as a git URL and
identifying itself as version 0.3.2. The fork carried five deviations from upstream across **26 diff lines**, and the
load-bearing one is that it called a `sanitize` **function once per HTML tag**.

That function is not incidental. `lib/shared/trinket-markdown.js:L217-L260` defines the stateful HTML-whitelist
sanitizer — **the platform's XSS defense for learner-authored and instructor-authored markdown** — which the base
commit handed to the fork as its `sanitize` option at `2f8712a:lib/shared/trinket-markdown.js:L211-L240` and which the
shipped bridge installs as `marked.Renderer.prototype.html` at `lib/shared/trinket-markdown.js:L603`. The module is
consumed solely by `lib/controllers/courses.js:L9`, which was `2f8712a:lib/controllers/courses.js:L13` before the dead
imports above it were removed. Replacing `marked` with a version that ignored a function sanitizer — or bridging it
through an option that sanitizes a whole HTML block as one string instead of one tag at a time — would have silently
removed an XSS control.

`marked` 4.3.0 exposes the extension, tokenizer, renderer and token-walk hooks needed to reproduce the fork, but its
deprecated `sanitize` / `sanitizer` options are **not** a drop-in bridge. Passing them changed block-HTML parsing,
coerced the function onto a different code path, and emitted `console.warn` on every render. The shipped integration
therefore:

- uses the 4.x destructuring require;
- names and retains the fork's sanitizer body;
- omits `marked.setOptions` entirely;
- registers a fork-compatible block-HTML extension, HTML tokenizer override and task-list neutralizer through
  `marked.use(...)`;
- installs the sanitizer as `Renderer.prototype.html` and restores the fork's link guard.

**Two call-site changes were required, and both are load-bearing.** An earlier draft of this subsection recorded only
one; that was a documentation inaccuracy, corrected here against a measured base-versus-migrated diff of
`lib/shared/trinket-markdown.js`.

**The bridge was selected on a differential against the real fork, not on reasoning about it.** Two independent runs
agree. A 77-fixture differential recorded in [PRESERVED-QUIRKS.md](PRESERVED-QUIRKS.md) section 3.35 measured the
deprecated-option candidate at **32/77** matches, with 31 unexpected mismatches and 70 deprecation warnings, against
**69/77** for the shipped bridge with 0 unexpected mismatches and 0 warnings. A second, wider differential run during
integration installed the fork itself — `git+https://github.com/trinketapp/marked.git`, which resolves to 0.3.2 and is
directly callable — and rendered a 119-fixture corpus through the fork, the deprecated-option candidate and the
shipped bridge in three separate processes, because both candidates mutate one shared `marked` module and pollute each
other in a single process. Against the fork: the deprecated-option candidate diverged on **57** of 119 fixtures, the
shipped bridge on **10**, and the bridge's divergence set is a strict **subset** of the candidate's — it is never
worse
on any fixture, and it fixes 47, all of them client-visible markup (raw block HTML wrapped in `<p>`, whitelisted
`<table>`/`<p style>`/`<h1 id>`/`<hr>` escaped away, per-tag sanitization of a nested `<span>` inside an escaped
`<div>`, and the task-list markup). The 10 residual differences are properties of the unavoidable version bump — the
inline link rule's paren balancing, two renderer whitespace joins and the uppercase `[X]` task marker — and they occur
in **both** candidates. An isolated audit of 4.3.0 reported **zero vulnerabilities**.

1. **The require shape.** On the 4.x line `require('marked')` returns an **object, not a callable** — measured on
   4.3.0 as `typeof require('marked') === 'object'` with `typeof require('marked').marked === 'function'` — so
   `lib/shared/trinket-markdown.js:L1` becomes a destructuring require, `var { marked } = require('marked')`.
2. **The sanitizer installation shape.** The fork accepted the whitelist sanitizer as the value of **`sanitize`**
   itself. 4.3.0 reads it from a separate **`sanitizer`** option, consults that option **only when `sanitize` is
   truthy**, and treats both as deprecated. The shipped integration therefore takes neither name: it registers the
   sanitizer as `marked.Renderer.prototype.html` at `lib/shared/trinket-markdown.js:L603`, and restores the fork's
   block-HTML rule, task-list shape and link guard through a single `marked.use(...)` call at `L300`.

**Why the deprecated-option path was rejected — measured, not reasoned.** Three separate measurements rule it out.
First, changing only the require and leaving `sanitize` bound to the function leaves `sanitize` truthy — a function is
truthy — while `sanitizer` stays **undefined**, and 4.3.0's truthy-`sanitize` path then escapes every tag: measured on
4.3.0 with exactly that shape, the whitelist function was invoked **zero times** and `<b>bold</b>` came back as
`&lt;b&gt;bold&lt;/b&gt;`. That failure mode is **fail-closed rather than an XSS hole**, but every whitelisted tag —
the embed `iframe` included — would have been escaped into visible text. Second, the corrected form
(`sanitize: true` plus the renamed `sanitizer`) does invoke the whitelist on every tag, but a 119-fixture differential
against the fork itself put it **57** divergences away from the fork where the shipped bridge is **10**, and its
divergence set strictly contains the bridge's. Third, that form emits
`marked(): sanitize and sanitizer parameters are deprecated…` through `console.warn` on **every** render, which the
zero-warning gate forbids; the bridge emits none.

**The whitelist contract itself is unchanged.** The sanitizer body — now the named `sanitizeHtmlTag` at
`lib/shared/trinket-markdown.js:L217-L260` — carries over from `2f8712a:lib/shared/trinket-markdown.js:L211-L240`
modulo a uniform de-indent: the close-tag stack, the `HTML_WHITELIST` lookup, the `iframe`-requires-`src` rule and the
`escape()` fallback are all byte-identical, and `lib/controllers/courses.js:L9` (`2f8712a:L13`) remains its only
consumer. This entry is a **documentation
correction, not a report of a bypass**: the XSS control was live in the shipped code both before and after the swap.
Together with the require, those two edits are the entire code cost of the swap.

**Reason code corrected to `security`.** An earlier revision classified this row `incompatible` on the grounds that
"the fork was not vulnerable, it was unpinnable." **Both halves of that sentence are wrong**, and the correction
matters because the reason code is what R-3 requires this document to get right.

The fork **was** pinned: the base lockfile records
`git+ssh://git@github.com/trinketapp/marked.git#55ea82491047d038b4360b78d092f77d439df63f`, and a commit hash is
content-addressed. And the fork **was** vulnerable: `npm audit --omit=dev` against the base commit's own lockfile
reports `marked` at aggregate severity **high** with **8 advisories** — two "Inefficient Regular Expression
Complexity" (`<4.0.10`), two further ReDoS, and three **sanitization** findings (VBScript content injection, XSS from
data URIs, sanitization bypass using HTML entities). Three of the eight therefore attack the very control the fork
exists to provide. `marked@4.3.0` reports **zero** findings.

So the row is `security`, with the API-compatibility work above as the *enabling condition* rather than the reason:
the swap was necessary because of the advisories, and it was *safe* because 4.3.0 preserves the function sanitizer
and every Renderer arity. Two genuine install-mechanics frictions remain worth recording — the base lock entry has
**no `integrity` field**, so `npm ci` cannot hash-verify the fetched tree, and its `git+ssh://` URL needs a git
binary and SSH credentials rather than an anonymous HTTPS fetch — but neither is a determinism failure, and neither
is what forced the move. The committed replacement closes both, read back from the lockfile: `resolved` `https://registry.npmjs.org/marked/-/marked-4.3.0.tgz` with a `sha512` `integrity` value.

**On the classification itself, because the two defensible readings were both argued.** One reading files this row as
`incompatible` alone, on the ground that the blocking property was the fork's divergent API surface on an abandoned
line rather than a published advisory. Measurement does not support that: the fork has **8 published advisories, 4 of
them high**, and AAP G4 requires zero critical and zero high, so a published advisory is precisely what blocks it. The
committed code is therefore `security, incompatible` — primary first, per the classification contract at the head of
this document — because the swap was *compelled* by the advisories and *required* a source change. A third argument,
that a git-sourced package is invisible to `npm audit`, is measurably false and is disposed of under *Net manifest
shape* above.

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
| `sinon` | 1.7.3 | **22.1.0** | `security`, `incompatible` | **Three removed APIs, and all three were exercised by this suite** — the three-argument `stub` form, `spy.reset`, and stubbing an absent property. All 12 base-commit sites are converted and the suite runs exit 0 with zero failures. *The `sinon` bump in full* below |
| `supertest` | 0.8.3 | **7.2.2** | `security`, `incompatible` | The HTTP test client used by the flow harness. `incompatible` is earned by the attachment, not by the request API: measured on the delivered 7.2.2 / superagent 10.3.0, `agent.del` still exists and **is** `agent.delete`, `res.redirect` is still set on every response and true only for a 3xx, and `.end(cb)` still takes `(err, res)` and passes `err === null` for 302, 404 and 500 — so `flow.del`, the `if (res && res.redirect)` guard and `wasOk = err ? false : true` all needed **no shim**. What did need repair is the promise the bootstrap exports, below |
| `redis-mock` | 0.2.0 | **0.56.3** | `security`, `incompatible` | The Redis double used by `test/setup.js`, and the one bump in this table that **did not preserve its call-site shape** — the constructor and the client surface both moved. *The `redis-mock` bump in full* below |

**The `redis-mock` bump in full.**

The Redis double used by `test/setup.js`, and the one bump in this table that **did not close its own gap**. Measured on the installed copies: the real `redis` is **4.7.1** — explicit `connect()`, an `isOpen` flag, camelCase commands returning promises — while `redis-mock` **0.56.3**, its newest published version, is still a **node_redis v3** double: `client.connect` and `client.isOpen` are `undefined`, `client.sIsMember`, `client.hGetAll` and `client.lPush` are all `undefined` against present lower-case `sismember`, `hgetall` and `lpush`, and `client.get('k')` returns `undefined` rather than a promise. Because `lib/util/store.js` caches its client promise **including a rejection**, an unadapted double made every later `Store.*` call reject for the life of the process. The bump is therefore paired with a v4 adapter confined to `test/setup.js` — `isOpen`, `connect`, `on` and a promisified camelCase-to-lower-case map over the **twelve** commands the application actually issues, with an explicit boolean coercion for `sIsMember` — scoped by census to exactly **fifteen** members so the double is no wider than the contract it stands in for, and **no production file was changed to accommodate it.** The promisification carries one further v4 fidelity guard: a command called short of a required argument would otherwise have the adapter's appended callback consumed as the missing argument and **never settle**, so the adapter checks each command's minimum argument count and rejects with a `TypeError`, which is the shape the real 4.7.1 client was measured to produce for the identical calls. Full adjudication: [PRESERVED-QUIRKS.md](PRESERVED-QUIRKS.md) section 13.4

**The `sinon` bump in full.**

**Three removed APIs, and all three were exercised by this suite.** Measured against the installed 22.1.0: (1) the three-argument form throws `TypeError: stub(obj, 'meth', fn) has been removed, see documentation` — **6** base-commit sites, censused over code lines only at `2f8712a`: `test/setup.js:L18`, `test/helpers/catbox-redis.js:L6`, `test/helpers/queue.js:L8`, `test/lib/models/trinket.js:L34, L39, L155`; (2) `spy.reset` is **`undefined`** where `spy.resetHistory` is a function — **6** further base-commit sites, all on `sinon.spy(...)` doubles: `test/lib/models/plugins/paginate.js:L29-L32` and `test/lib/models/trinket.js:L167, L168`; (3) stubbing an absent property throws `TypeError: Cannot stub non-existent property`, which is what makes the catbox target correction in Rubric 3 load-bearing rather than cosmetic. **Delivered state, re-measured over the 48 tracked test `.js` files, code lines only: 0 three-argument `sinon.stub` calls and 0 `.reset()` calls remain** — 30 `.callsFake(` sites in 11 files and 7 `.resetHistory(` sites in 3 files stand in their place — and the suite runs **exit 0 with zero failures**. The replacement counts exceed the twelve obliged conversions because suites written after the conversion (`test/lib/api/files.js`, `test/lib/api/write-routes.js`, `test/lib/util/db-helper-readiness.js`, `test/lib/util/file-storage.js`, `test/lib/util/recaptcha.js`, `test/lib/workers/exports.js`, `test/lib/workers/snapshot.js`) use the modern forms natively rather than converting anything. All four figures are volatile by nature — every new double moves them — so they are stated with the commands that reproduce them rather than as fixed facts: the file count is `git ls-files | grep -cE '^test/.*\.js$'`, and the four call-site counts are a `grep` for `.callsFake(`, `.resetHistory(`, the three-argument `sinon.stub(obj, 'm', fn)` form and `.reset()` over that same file list, discounting comment lines. The remaining textual match for each removed form is a comment recording the conversion. Full adjudication: [PRESERVED-QUIRKS.md](PRESERVED-QUIRKS.md) section 13.3

**The test-tree call-site edits these bumps oblige are all applied.** The dependency decisions above are committed —
`package.json` and `package-lock.json` carry them, and every version in the table is the resolved version in the
lockfile. An earlier revision of this subsection listed the obliged source edits as mostly outstanding, which was
accurate when it was written and is not accurate now. Measured against the delivered tree:

| Obliged by | Edit | Measured state |
|---|---|---|
| `sinon` 22.1.0 | six `sinon.stub(obj, 'm', fn)` → `.callsFake(fn)` conversions, plus six `.reset()` → `.resetHistory()` | **12 of 12 done.** A re-census over code lines finds **zero** three-argument `sinon.stub` calls and **zero** `.reset()` calls, against **30** executable `.callsFake(` sites and **7** `.resetHistory(` sites across the 48 tracked test files — more than the twelve obliged, because later suites use the modern forms natively |
| `supertest` 7.2.2 | resolve the promise `app.js` exports before binding `server.listener` | **done.** `test/helpers/flow.js` captures `resolvedServer` through its own `app.then(…)` continuation, `agentFor()` binds `resolvedServer.listener` lazily on first use, and `test/setup.js` awaits `app` in a bare top-level `before()` registered on the root suite |
| the unscoped `catbox-redis` removal | repoint `test/helpers/catbox-redis.js` at the in-repo engine | **done.** The unscoped require is gone; the helper stubs the **four** `CatboxMongoose.Engine.prototype` methods the suite reaches — `isReady`, `get`, `set`, `drop` — and leaves `start`, `stop`, `validateSegmentName` and `_generateKey` real |
| `mocha` 11.7.6 | `.mocharc.json` replacing `test/mocha.opts` | **done.** The four-key file is committed — `reporter`, `recursive`, `check-leaks` and `exit`, with no `spec` and no `require` — and `test/mocha.opts` is deleted. Load order, which the deleted `mocha.opts` fixed implicitly, is supplied by `--file ./test/setup.js` in the `test` script instead |

The same list, with the reasoning behind each repair, is in
[PRESERVED-QUIRKS.md](PRESERVED-QUIRKS.md) under *Tense, and the delivery status of the test tree*, and in sections
3.7, 3.8 and 3.13 there. Nothing in the dependency set changed when those edits landed.

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
immediately. It is also why `optimist`'s obvious modern successor was never a candidate here: it is unusable from
CommonJS for the same reason. As it turned out `optimist` needed no replacement at all, because its only consumer was
deleted — but had an argv path survived, the choice would have been a Node built-in rather than another package.

## Rubric 3 — Replaced

**Reason for this rubric: `dead` or `incompatible`.** An entry appears here only when the same package could not be
carried forward at all. The eleven rows below break down as follows, counted from the table itself: **two** were
replaced by a newly added registry package, which is where all **three** of this modernization's package additions
come from — `aws-sdk` alone accounts for two of them, because its v3 successor is modular and splits the client from
the presigner, which is the escalation recorded as Item 6 of the reconciliation above;
**four** were replaced by a Node built-in; **two** were replaced by a local in-repo module; and **three** needed no
replacement at all, because their only consumer was deleted or because the binding was never read in the first place.
One of the eleven is not a package but a deprecated Node built-in **API** — `url.parse()` — recorded here because it
is a replacement in exactly the same sense as the rest, and readers look for it here. One of the ten distinct package
originals, the unscoped `catbox-redis`, was never installed in the first place, so **nine** of the eleven rows
correspond to a manifest removal.

| Original package | Version at base commit | Replacement | Target | Reason | Verification and notes |
|---|---|---|---|---|---|
| `aws-sdk` | 2.1693.0 | **`@aws-sdk/client-s3`** plus **`@aws-sdk/s3-request-presigner`** | **3.1098.0** both, pinned exact | `incompatible` | **Gate-mandated, not discretionary** — requiring the v2 SDK on Node 22 fires a real `process.on('warning')` event with `name === "NOTE"`, which the zero-warning boot gate forbids. v2's global-singleton configuration has no v3 equivalent. **One original, two replacements**, because v3 is modular and presigning is a separate package: `@aws-sdk/client-s3`'s **707** exports contain **zero** presign symbols. *The AWS client replacement in full* below, and *Presigned download URLs: the second AWS package* |
| `request` | 2.88.2 | the global **`fetch`** built into Node 22 | *(no package added)* | `dead` | Formally deprecated upstream and unmaintained. Affects `lib/controllers/auth.js`, `lib/controllers/users.js` and `lib/util/recaptcha.js`, all of which were being converted to async/await anyway. The one place the swap needed more than an await is the OAuth token exchange, where `request`'s `form` option serialized through `qs`: see *The `request` replacement's one serializer detail* below |
| `q` | 1.0.1 | native **`Promise`**, `Promise.all`, `Promise.allSettled` | *(no package added)* | `dead` | Classified `dead` **not because it is vulnerable, but because the language subsumed it.** The async conversion removes its last consumer as a side effect: the four `Q.defer()` sites plus the `Q.all` and `Q.allSettled` calls in `lib/workers/exports.js`, and the usage in `test/helpers/mail.js` |
| `node-uuid` | 1.4.8 | **removed — no replacement required** | *(no package added)* | `dead` | Deprecated by its own author in favour of the `uuid` package, but **no package was needed**: the base commit never read the binding it imported. *The `node-uuid` removal in full* below |
| `node-cryptojs-aes` | 0.4.0 | **`crypto-js`** | **4.2.0** | `dead` | Unmaintained. **Bit-compatibility proven bidirectionally** before the swap was accepted: both emit the OpenSSL `Salted__` and MD5-EvpKDF envelope, and ciphertext length is **88** in both directions. This mattered because `lib/util/roles.js` ships the payload to a browser that decrypts it with a frozen client-side decryptor — see [PRESERVED-QUIRKS.md](PRESERVED-QUIRKS.md) section 1.9 |
| **`node:url`'s `url.parse()`** *(a deprecated built-in API, not a package)* | Node 22's built-in | the **non-throwing static `URL.parse()`**, with the `null` case neutralized | *(no package added)* | `incompatible` | **Gate-mandated** — a single `url.parse()` call fires a real `DEP0169` warning event that the zero-warning boot gate forbids. All 8 base-commit call sites went to the **same** replacement, in two spellings. *The `url.parse()` replacement in full* below |
| `optimist` | 0.6.1 | **removed — no replacement required** | *(no package added)* | `dead` | Deprecated upstream. Its only consumer was the argv parsing for the `-R` route-table dumper in `lib/util/routeParser.js`. Because that dumper is pure Hapi-4 compatibility machinery it was **deleted outright**, so **`node:util`'s `parseArgs` was not required either**. Verified in the shipped file: zero `parseArgs` and zero `node:util` references, and zero `parseArgs` anywhere else in the tree. Had any argv path survived, the built-in would have been the choice, because this package's obvious modern successor is unusable from CommonJS for the reason given above |
| `tab` | 0.1.0 | **removed — no replacement required** | *(no package added)* | `dead` | Unmaintained. Its sole consumer was the same `-R` route-table dumper in `lib/util/routeParser.js`, so deleting the dumper meant **a local column formatter was not required**. Verified in the shipped file: zero `emitTable` references and no formatting helper of any kind |
| `mkdirp` | 0.3.5 | **`fs.promises.mkdir`** with `{recursive: true}` | *(no package added)* | `incompatible` | **Not `dead` — actively maintained.** The problem is the calling convention: `mkdirp` 1 and above is promise-native, which breaks the `util.promisify` wrapper the base commit applied to it at `2f8712a:lib/controllers/courses.js:L7`. Moving to the built-in is simultaneously the smaller diff and one dependency fewer |
| `rimraf` | 2.2.8 | **`fs.promises.rm`** with `{recursive: true, force: true}` | *(no package added)* | `incompatible` | **Not `dead` — actively maintained.** `rimraf` 4 and above dropped the callback form entirely, which is the form the base commit used at `2f8712a:lib/controllers/courses.js:L8` |
| `catbox-redis` *(unscoped)* | **never installed** | the in-repo **`lib/util/catbox-mongoose.js`** engine | *(no package added)* | `dead` | **Declared nowhere and installed nowhere**, yet required at one place — which is why the suite died on its first module load. Two edits were needed, not one, and both are delivered. *The unscoped `catbox-redis` in full* below |

**The `node-uuid` removal in full.**

Deprecated by its own author in favour of the `uuid` package, and then subsumed by the platform's `crypto.randomUUID()`. **But no replacement was needed, because there was never a call site.** The plan projected a swap to `node:crypto`'s `randomUUID()`; the base commit does not support that projection. Measured across every tracked file at `2f8712a` except `public/`, `serverside/` and the lockfile, the token `uuid` occurs on exactly **two** lines: the declaration `uuid = require('node-uuid'),` at `lib/controllers/users.js:L22`, and the manifest entry `"node-uuid": "^1.4.3"`. The binding was **never read** — zero `uuid.v4()`, zero `uuid(`, zero property access of any kind. So this is the removal of a dead require of an unused binding — the same class as the four plan-named dead imports tabulated under "Dead imports deleted with no replacement" below, differing only in that this one also had a manifest entry to delete — and the correct record is a removal with no replacement. Verified in the shipped tree: **zero** `randomUUID` call sites anywhere in `app.js`, `config/`, `lib/`, `scripts/` or `test/`, and zero `node-uuid` or `require('uuid')` references. Adjudicated against baseline per R-6

**The `request` replacement's one serializer detail, and the correction review finding F-09 forced.** `request`'s
`form` option serialized its field map with `qs.stringify`, and `fetch` reproduces none of that, so
`lib/controllers/auth.js` carries a small `encodeForm()` in its place. Three properties had to be reproduced and were:
a field whose value is `undefined` is omitted entirely; a field whose value is `null` is emitted as a bare `key=`
rather than the string `"null"` — which is the shape this application actually exercises, because
`config/default.yaml` declares the three `app.auth.google` keys with no value and node-config resolves those to
`null`; and a space is `%20`, never `+`. **A fourth was missed and is now fixed.** `qs`'s encoder percent-encodes
everything except `A-Za-z0-9`, `-`, `.`, `_` and `~`, while `encodeURIComponent` additionally leaves `!`, `'`, `(`,
`)` and `*` raw — so a provider-issued authorization code containing any of those five went to Google in a different
form than the retired client sent it. `encodeForm()` now post-escapes exactly those five to the same uppercase-hex
form `qs` emits. Verified against the installed **qs 6.15.3** across four differential field maps — space-plus, the
five delta characters with `null` fields, `~ - . _` with unicode and reserved separators, and an omitted field — with
**byte-identical** output in every case. Coverage: `test/lib/util/oauth-form-encoding.js`.

**The AWS client replacement in full.**

**Gate-mandated, not discretionary.** Requiring the v2 SDK on Node 22 fires a **real `process.on('warning')` event with `name === "NOTE"`** — not a plain console write — which the zero-deprecation-warning boot gate forbids. v2's `AWS.config.update` global singleton has **no v3 equivalent**, so `config/aws.js` moves to per-client `S3Client` configuration. The v2 SDK was constructed at **7 call sites in 3 files** — `lib/util/file.js` (4), `lib/workers/exports.js` (2) and `lib/controllers/users.js` (1) — covering `PutObjectCommand`, `GetObjectCommand` and `DeleteObjectCommand`. **Per-client configuration is not per-call construction:** v2's clients carried no agent of their own and every send resolved the same process-global agent singleton, and a v2 client had no `destroy` method at all, so those 7 constructions shared **one** socket pool for the life of the process. Each v3 client owns its own pool, so `config/aws.js` holds **one** lazily-built shared `S3Client`, reached through `getS3Client()` at the 6 surviving command call sites and by the presigner, and released by `destroyS3Client()` on the hapi server's `stop` event in `app.js`. Both halves were measured against the installed SDKs; the reasoning is recorded in that file's `RESOURCE LIFECYCLE` section. Presigning is **not** in this package and is served by a second scoped one, `@aws-sdk/s3-request-presigner`, which is handed this same shared client — see *Presigned download URLs: the second AWS package* below

**The `url.parse()` replacement in full, because it is the one row where the replacement is a language feature rather
than a package.** Measured under `--pending-deprecation`: a single `url.parse()` call fires a real
`process.on('warning')` event, `name === "DeprecationWarning"`, **`code === "DEP0169"`** — the "behavior is not
standardized and prone to errors that have security implications" notice — which the zero-warning boot gate forbids.
Measured on the same probe, the static `URL.parse()` fires **zero** warnings.

There were **8** `url.parse()` call sites at the base commit — `lib/controllers/trinket.js:L1253, L1350, L1521`,
`lib/controllers/users.js:L588`, `lib/workers/exports.js:L40, L304`, `test/helpers/flow.js:L399` and
`test/lib/api/registration.js:L85` — and all eight take the **same** replacement, the non-throwing static
`URL.parse()` that AAP §0.1.1.4 (implicit requirement I5) prescribes. It appears in two spellings, chosen by call-site
shape rather than by preference. **Six `lib/` sites take it with no base argument:** the three in `trinket.js` through
a five-line local `assetPathname()` helper at `L35`, the two in `exports.js` through the same two lines inline in
`assetPathBasename()` at `L45`, and the one in `users.js` at `L875`, where the handler's own `if (!requestUrl.protocol)`
test makes WHATWG semantics the correct reading. **Two test sites take it with `config.url` as the base:**
`test/helpers/flow.js:L437` and `test/lib/api/registration.js:L102`, where the harness reads only `.pathname` off a
`Location` header that arrives in both relative and absolute form — measured byte-identical to the legacy derivation on
all 19 distinct `Location` headers the suite emits, under both configured origins.

The one thing the swap is not is mechanical. `new URL()` **throws** `ERR_INVALID_URL` on the relative and protocol-less
inputs the legacy parser tolerated, which is why it is not a candidate at all; and the static `URL.parse()` returns
**`null`** where the legacy parser returned an object with a usable `pathname`. At the asset sites, which read
`.pathname` immediately inside synchronous code reached from a stream `'data'` handler, an unguarded read of that
`null` would have turned a working response into an uncaught `TypeError`. Both helpers therefore fall back to the **raw
input string**, which is exactly what the legacy parser's `pathname` was for a non-absolute input, so the derived —
and persisted, client-visible — asset filename is unchanged. See
[PRESERVED-QUIRKS.md](PRESERVED-QUIRKS.md) sections 3.13, 3.26 and 11, the last of which records the input classes
where `URL.parse` and the legacy parser genuinely diverge, so that a future call site on untrusted input is not added
on an assumption of parity. Verified in the shipped tree: **zero** `url.parse()` call sites and **zero**
`require('url')` bindings remain anywhere in `app.js`, `config/`, `lib/`, `scripts/` or `test/`.

**The unscoped `catbox-redis` in full, because it is the one row where nothing was ever installed.** Measured at
`2f8712a`: exactly one require of it in the whole tree, at `test/helpers/catbox-redis.js:L1`, and no matching entry in
either `package.json` or `package-lock.json`. That single line was the direct cause of the immediate `npm test`
failure on the suite's first module load, `Cannot find module 'catbox-redis'`.

**Two edits were needed, not one.** The require is repointed at the catbox engine the application actually uses,
`lib/util/catbox-mongoose.js`; and the stub **target** is corrected from the bare `catbox.prototype` to
`catbox.Engine.prototype`, because that module exports a named `Engine` class — without which Sinon 22 throws
`TypeError: Cannot stub non-existent property` rather than silently stubbing nothing as Sinon 1 did. The helper now
installs **four** `.callsFake()` stubs — `isReady`, `get`, `set` and `drop`, the only methods the suite reaches —
over an in-memory map whose keys are built by calling the engine's **own** `_generateKey`, and deliberately leaves
`start`, `stop` and `validateSegmentName` real. An earlier revision of this paragraph said five and named `start`
among them; the delivered helper leaves `start` real, because a full `app.js` boot invokes `Engine.prototype.start()`
**zero** times and stubbing more than is reached would hide a regression in the parts that still run for real
(review finding F-12). `validateSegmentName` must stay real because catbox does call it, at policy-provisioning time
during `await server.register([... Yar ...])`.

**Delivered state, re-measured: zero `require('catbox-redis')` occurrences anywhere in `app.js`, `config/`, `lib/`,
`scripts/` or `test/` code lines** — the one remaining textual match is a comment in the repaired helper recording
what it used to do — and `npm test` exits 0 with zero failures. An earlier revision of this document
described the repoint as still outstanding; it is not, and the test run above is the check. It appears in this rubric
because it is a replacement decision, not because a declaration was removed: there was never one to remove, and the
scoped `@hapi/catbox-redis` that *was* declared is a separate row in Rubric 4. See
[PRESERVED-QUIRKS.md](PRESERVED-QUIRKS.md) section 3.7.

**The `optimist` and `tab` removals in full, because both ended with no replacement of any kind — which the plan did
not anticipate.** AAP §0.5.2.1 maps `optimist` onto `node:util`'s `parseArgs` and `tab` onto "a local column
formatter". Neither was needed. Their sole consumer was the argv parsing and column formatting for the `-R`
route-table dumper in `lib/util/routeParser.js`; that dumper is pure Hapi-4 compatibility machinery, so it was
**deleted outright**. Verified across `app.js`, `config/`, `lib/`, `scripts/` and `test/`: zero `parseArgs`
references, zero `node:util` references, zero `emitTable` references, no formatting helper of any kind, and no
surviving `argv` handling in the 269-line shipped `routeParser.js`. Had any argv path survived, the built-in would
have been the choice rather than another package, because `optimist`'s obvious modern successor is unusable from
CommonJS for the reason given above.

### Presigned download URLs: the second AWS package

v2 generated presigned URLs **synchronously**, via `client.getSignedUrl('getObject', {Bucket, Key, Expires: 3600})`,
for the export-download redirect at `lib/controllers/users.js`. `@aws-sdk/client-s3` contains **no presigner at all**
— zero presign-related symbols among its **707** exports — and v3 offers no synchronous form. AWS publishes
`@aws-sdk/s3-request-presigner` for exactly this, and **it is declared**, at `3.1098.0` with `--save-exact`, matching
the client version rather than floating against it. That makes three package additions where the plan projected two;
the collision and its adjudication are Item 6 of *Reconciliation with the plan's projected figures* above.

`config/aws.js#getSignedDownloadUrl` is now a single delegation — `getSignedUrl(getS3Client(), new
GetObjectCommand({Bucket, Key}), { expiresIn })` — and contains **no signing code of any kind**. It returns a
`Promise<string>`, so the accessor is asynchronous where v2's was synchronous; that remains the one call-site shape
that changed.

**An earlier revision implemented this in-repo, and that implementation is gone.** It presigned against the client's
own resolved configuration — `client.config.endpointProvider({Bucket, Region, …})` for bucket addressing and
`client.config.signer().presign(request, {expiresIn})` for the signature — and its output was measured byte-identical
to an independent from-scratch `node:crypto` SigV4 reference across three fixtures. Code review nonetheless rejected it
(finding SV-05): all three members it reached for are `@internal` and carry no semver guarantee, and the query
envelope around the HMAC — canonical query construction, AWS extended URI encoding, the `X-Amz-Content-Sha256`
spelling, header hoisting — was hand-written security-sensitive code that R-1 does not sanction. The two encoding
facts that revision had to establish by measurement, that path segments need AWS **extended** URI encoding which
escapes `! ' ( ) *` beyond `encodeURIComponent`, and that the unsigned-payload header must be spelled
`X-Amz-Content-Sha256`, are now the SDK's responsibility rather than this repository's. They are recorded here only
because they explain what the delegation bought.

**What the delivered URL looks like, measured.** For a virtual-hosted bucket the emitted URL is
`https://<bucket>.s3.<region>.amazonaws.com/<extended-encoded-key>?…`; for a bucket name containing dots it falls back
to path-style, `https://s3.<region>.amazonaws.com/<bucket>/<key>?…`. Both forms are unchanged from the earlier in-repo
implementation, and both are asserted at `test/lib/util/file-storage.js`. The query carries exactly **nine**
parameters, in this sorted order:

`X-Amz-Algorithm=AWS4-HMAC-SHA256`, `X-Amz-Content-Sha256=UNSIGNED-PAYLOAD`, `X-Amz-Credential`, `X-Amz-Date`,
`X-Amz-Expires`, `X-Amz-Signature`, `X-Amz-SignedHeaders=host`, `x-amz-checksum-mode=ENABLED`, `x-id=GetObject`.

The last two are v3 operation metadata that aws-sdk v2 never emitted and that the earlier in-repo implementation
deliberately omitted. **They are now present**, because they are what the supported presigner emits and suppressing
them would mean reaching back into the request to strip them. They are signed rather than appended, so they cannot be
removed from a generated URL without invalidating it. Nothing in this application reads them: the URL is handed
straight to `h.redirect(...)` and S3 is the only consumer.

**`expiresIn` is the only option passed, and that is a measured decision rather than an omission.** An earlier
revision also passed `signableHeaders: new Set(['host'])` and `unhoistableHeaders: new Set()`, on the reading that
`X-Amz-SignedHeaders=host` and the unsigned-payload spelling had to be requested explicitly. Both are already the
presigner's defaults for `GetObjectCommand`. Pinning `signingDate` to a fixed instant and diffing the full URL with the
two options against the same URL without them, across three key shapes — a key containing a space, a key containing
the five extended-encoding characters `+ ( ) ! ' *`, and a plain key — produced **byte-identical output every time,
including the same `X-Amz-Signature` digest**. Both were therefore removed. Options that provably change nothing are
worse than absent ones: they assert that the defaults are unsuitable, and the next reader has to re-run the
measurement to find out they are not.

**The signature version itself is a REPORTED DEVIATION, not an accepted one, and review finding F-10 is right that the
earlier wording understated it.** R-6 measurement against a scratch install of `aws-sdk` 2.1693.0 shows the true
base-commit output was **SignatureV2** — `?AWSAccessKeyId=…&Expires=<unix>&Signature=…` against
`<bucket>.s3.amazonaws.com`, because v2's S3 client defaults `signatureVersion` to `'s3'` — while the delivered
implementation emits **SigV4**. Origin, path and expiry are preserved; the query parameters are not, so the presigned
URL is **not** wire-identical to the base commit. The deviation is unavoidable within the sanctioned dependency change:
`@aws-sdk/client-s3` has no SigV2 path at all, and `aws-sdk` v2 cannot be kept because requiring it emits a real
`process.on('warning')` event that the zero-warning boot gate forbids. Closing it would take an authorized decision —
either accept the SigV4 shape as the new contract, or re-implement SigV2 query signing on top of the v3 client. Until
that decision exists this row is **open**, it is listed in the changelog's *Deviations and unresolved conflicts*, and
in [PRESERVED-QUIRKS.md](PRESERVED-QUIRKS.md) section 4.16. Practical mitigation of the exposure window: these URLs are
generated per request with a 3,600-second expiry and are never persisted, so no stored artifact carries the old shape.

**Three packages are added to the manifest by this entire modernization: `@aws-sdk/client-s3` 3.1098.0,
`@aws-sdk/s3-request-presigner` 3.1098.0 and `crypto-js` 4.2.0** — one more than the plan projects, for the single
reason set out in Item 6. Everything else in this document is a bump, a removal, or a move to a Node built-in or a
local module. The additions still cover only the two *capabilities* a Node built-in could not supply — S3 access, and
an AES envelope that had to stay byte-compatible with a frozen browser decryptor — and the third package exists
because AWS splits the first of those capabilities across two modules, not because a third capability was introduced.

## Rubric 4 — Removed: declared but never required

**Reason for every entry in this rubric: `dead`.** These packages were declared in `package.json` and required by
nothing. They were **deleted, not pinned**, which is what R-2 demands, quoted verbatim:

> "Container images may not be pinned to an old runtime as a workaround, and dead packages may not be vendored into
> the repository to keep them alive."

Pinning an unused package to an old version to keep an install resolvable is exactly the workaround that rule
forecloses. **Every entry below is gone from `package.json`, and none is vendored anywhere in the tree** — verified by
set intersection against the committed manifest: zero of the 24 removed names appears in `dependencies` or
`devDependencies`.

**Two of them do still appear in `package-lock.json`, and that is correct rather than a leftover.** An earlier revision
of this document claimed none of these names "survives in any form: not in `package.json`, not in `package-lock.json`",
which conflated *removing a direct declaration* with *eliminating a name from the dependency tree*. The measured
reality is that two of the fifteen are legitimately reachable transitively, so the lockfile must still resolve them:

| Name | Still in the lock at | Why it is still there, measured from the lockfile's own dependency edges |
|---|---|---|
| `@hapi/hoek` | 11.0.7, production | **28** packages depend on it, essentially the entire `@hapi/*` surface: `@hapi/hapi` itself at `^11.0.7`, plus `@hapi/accept`, `address`, `ammo`, `b64`, `boom`, `bounce`, `call`, `catbox`, `catbox-memory`, `heavy`, `inert` and 16 more at `^11.0.2`. Removing the **direct declaration** was correct — no repository file requires it — but the framework needs it and always will |
| `debug` | 4.4.3, production | **4** dependents: `ioredis`, `mquery`, `superagent` and `mocha`. Again the direct declaration was dead while the transitive need is real |

The remaining thirteen names are absent from the lockfile as well as the manifest. The distinction matters because R-2
forbids keeping a **dead package alive**, not resolving a **live transitive dependency**: nothing in this repository
requires `@hapi/hoek` or `debug`, and neither is pinned to an old version to keep anything installable.

**Method.** All **96** JavaScript files in the tracked source tree were scanned for **both quote styles** of the
require expression. Each candidate was additionally checked against the installed tree and against the
peer-dependency declarations of the packages being kept, because — as the `chokidar` note above demonstrates — a
direct-require scan alone cannot see a dependency that a kept package loads dynamically at runtime.

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

**What "removed" means here, precisely: removed as a *direct* dependency.** Every row above is deleted from
`package.json`, so nothing in this repository declares it and nothing in this repository requires it. Two of them,
however, are still **present in `node_modules` and in `package-lock.json` as transitive dependencies of packages that
are kept**, and a reader who greps the installed tree will find them:

| Undeclared but still resolved | Still installed at | Pulled in by |
|---|---|---|
| `@hapi/hoek` | 11.0.7 | `@hapi/hapi` and 28 other `@hapi/*` packages that depend on it |
| `debug` | 4.4.3 | `ioredis` (via `bull`), `mquery` (via `mongoose`), `mocha`, and `superagent` (via `supertest`) |

(That table carries no `dead` / `incompatible` / `security` code because it is not a classification table — both
packages are already classified `dead` in the table above it. It records where their installed copies come from.)

That is the correct outcome, not a failed removal. Declaring a package that only a dependency needs is what makes a
manifest lie about its own surface: it invites direct `require` of a module the project does not own, and it pins a
version the real consumer may not want. Deleting the declaration while the dependency tree keeps resolving its own
copy is precisely the intended result. The other nine rows above are gone from the installed tree entirely.

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
was dumped both ways. **Both boots produced 233 rows with zero row-by-row differences**, and the 58-route response
corpus was unchanged.

**What this adjudication turns on is that the two tables are *identical to each other*** — a within-run comparison of
two dumps taken minutes apart on the same tree. That comparison is the proof, it needs no external artifact, and no
later measurement can undo it: had the digest been any other value, the two dumps would still have agreed.

The *absolute* figures beside it are a different kind of claim, and they are now **final rather than provisional**. The
digest `452116ce74301c61c92efb36fe8ead987b6a9e81d83a28af335c8d08fa1d64a8` and the corpus outcome come from
`test/baseline/route-table.json` and `test/baseline/responses.json`, and both artifacts have been replayed against the
delivered tree: `node test/baseline/replay.js` exits 0 reporting **zero differences** over the 233-row route table, the
58 unauthenticated, 7 authenticated and 8 assignment-`next` corpus entries, with the documented route-table anchor
enforced as all **eleven** clauses of `gates.documentedAnchorGate`. The measured status of every gate is tabulated once, with
the command that produced it, in [PRESERVED-QUIRKS.md](PRESERVED-QUIRKS.md) section 0.

That digest is recorded as
`gates.measuredSha256` in `test/baseline/route-table.json` and is re-derivable from that artifact's own rows with the
one-line recipe its `canonicalization.reproduce` field states, so a reader can check it without booting anything. The
recomputable canonical SHA-256, registration-order SHA-256 and MD5 fingerprints are subordinate regression evidence;
the AAP's documented 32-character digest `cd2a7e38a39bd84902ac1a0d69f50e2a` is **not** this value, is retained verbatim
under `gates.documentedDigest`, and is not claimed to have been recomputed — the string is not recomputable by any
verifier, so the anchor is enforced over the 233-row table it names, by the **eleven**-clause `gates.documentedAnchorGate`
that one shared evaluator recomputes live — `capture.js#documentedAnchorGate`, declared in the harness that owns
the artifact and re-exported unchanged by `replay.js` — and that the capture CLI (one PASS/FAIL entry per clause),
the replay CLI (one difference per unsatisfied clause) and `test/lib/api/route-parity.js` (the same clauses plus
the exact sorted 233-row set and all three fingerprints, recomputed from its own literals) each enforce on every
run. The deletion proof is
in [PRESERVED-QUIRKS.md](PRESERVED-QUIRKS.md) section 3.6, and the digest adjudication itself in section 3.22.

One correction belongs with that proof, because this document previously published the wrong digest for it. The value
`cd2a7e38a39bd84902ac1a0d69f50e2a` was carried forward from the plan and labelled a sha256. It **cannot be one**: it
is **32** hexadecimal characters, the width of an md5, where a sha256 is 64. Three progressively wider searches for a
recipe that reproduces it all failed: twenty-seven candidate canonicalizations against the committed route table, then
forty-two over the exact-base capture, and finally an exhaustive sweep that computed **2,155,050** digests across
**56,709** distinct serializations of the same 233 rows — every combination of field set, separator, ordering, casing
and trailing-newline convention — with **no** match under md5, sha1, sha256 or sha512. The two earlier, narrower
searches are subsumed by that one. It is not the md5 of the current
canonical form either — that is `dfc1e295156ecdbbee4a073b231b9326`. The **authoritative** digest, regenerated from the
rows committed in `test/baseline/route-table.json` rather than transcribed, is the sorted sha256
`452116ce74301c61c92efb36fe8ead987b6a9e81d83a28af335c8d08fa1d64a8`, with a registration-order fingerprint of
`6a65d18273c731aa070cf905625a9dfe4789caf066dde0c5beb14c6dd8131898`. The mislabelled digest does not weaken the
passport conclusion, because that conclusion never depended on the digest's *value* — only on the two dumps agreeing.
The full proof, and the same correction, are recorded in [PRESERVED-QUIRKS.md](PRESERVED-QUIRKS.md) sections 3.6
and 3.22.

That is **15 packages deleted outright** — 11 plus 2 plus 2 — on top of the 9 removed in Rubric 3, where 6 were
replaced and 3 needed no replacement, for **24** manifest removals in total.

### Dead imports deleted with no replacement

A require statement can be dead while its package is very much alive. Seven such statements were deleted. **None of
them changes the manifest**, and each is in the dependency-swap diff category exactly as R-1 describes it — import
removal is that category, and no other justification is offered for any of these seven hunks.

Four were dead at the base commit and were named in the plan. Measured at `2f8712a`: each of these files contains
**zero** references to the binding it imports, so nothing but the declaration line went away.

| Deleted import | Site at base commit | Package | Measured references to the binding at base |
|---|---|---|---|
| `require('@hapi/hapi')` as `Hapi` | `lib/controllers/courses.js:L4` | **kept** — it is the framework | 0 occurrences of `Hapi.` |
| `require('@hapi/hapi')` as `Hapi` | `lib/controllers/files.js:L2` | **kept** | 0 occurrences of `Hapi.` |
| `require('@hapi/hapi')` as `Hapi` | `lib/util/helpers.js:L4` | **kept** | 0 occurrences of `Hapi.` |
| `require('joi')` as `Joi` | `lib/controllers/pages.js:L3` | **kept** — still required by `config/routes.js`, `config/api_routes.js`, `lib/http/validation.js` and `lib/util/routeParser.js` | 0 occurrences of `Joi.` |

Three more are bindings on the Node built-in `url` module, left behind by the `url.parse()` replacement recorded in
Rubric 3. Each was verified dead by identifier scan before removal — the declaration was the **only** line in the file
that referenced the name, comments and string literals excluded. Sites are given as they stood immediately before
removal, which is also their `2f8712a` position in every case:

| Deleted import | Site immediately before removal | Dead at base too? |
|---|---|---|
| `require('url').parse` as `parseUrl` | `lib/controllers/courses.js:L2` | **Yes** — declared and never called at `2f8712a` either |
| `require('url')` as `url` | `lib/controllers/users.js:L8` | No — genuinely used at `2f8712a:L588`, which is the one site that moved to the static `URL.parse()` |
| `require('url')` as `url` | `lib/util/routeParser.js:L10` | **Yes** — at `2f8712a` (where it stood at `L13`) the only `url` tokens in that file were the `redirect: function(url)` parameters and `request.url`, never the module |

Removing three lines shifts the lines beneath them, so every line citation in the delivered documentation that points
into these three files was re-derived from the committed source after the removals rather than adjusted by arithmetic.
The route surface was then re-measured to confirm the removals are inert: **233** routes, the same method distribution
of 137 GET, 63 POST, 19 PUT, 13 DELETE and 1 PATCH, and **zero** process warnings under `--pending-deprecation`.

No `require('url')` binding survives anywhere. The static `URL.parse()` that replaced the deprecated function is a
method on the **global** `URL` constructor, so the sites that use it need no module binding at all — which is why
removing the three requires above leaves nothing to re-import. After these removals the shipped tree contains **zero**
`url.parse()` call sites and **zero** `require('url')` bindings across `app.js`, `config/`, `lib/`, `scripts/` and
`test/`, so `DEP0169` and `DEP0170` are both gone from the tree entirely rather than merely from the hot paths.

### Retained despite never being required

Four packages are required by no source file and are nevertheless **kept**. Three are invoked through npm scripts
rather than through `require` — they are tooling, not dead code, and deleting them would break the build and test
commands. The fourth is `require`d dynamically by a package that *is* required, which a static scan cannot see:

| Package | Version | How it is invoked |
|---|---|---|
| `mocha` | 11.7.6 | the `test` script |
| `sass` | 1.98.0 | the stylesheet compilation reached through `build` and `build:css` |
| `vite` | 4.5.14 | the `build:css` and `watch:css` scripts |
| `chokidar` | 3.6.0, **in `devDependencies`** | `require`d lazily by `nunjucks` 3.2.4 at `node_modules/nunjucks/src/node-loaders.js:L35` when template watching is on, which `lib/util/nunjucks.js:L8` enables for the **development and test environments only**. Declared because npm does not install an **optional** peer on the dependent's behalf — measured on npm 10.9.9 and 11.18.0 alike. Without it, `npm test` and any non-production boot fail with `watch requires chokidar to be installed`. It sits in `devDependencies` rather than `dependencies` because that is exactly the scope in which it is needed: a `NODE_ENV=production` boot leaves watching off and never reaches the lazy require, and the lockfile records the entry as `devOptional`, so `npm ci --omit=dev` skips it. The container image is unaffected — its `RUN npm ci` precedes `ENV NODE_ENV=$NODE_ENV`, so development dependencies are installed |

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

**How to read "already current" below.** Several rows record a package that needed no movement because it was already
at the newest release published **at migration time (2026-07)**. That is a statement about a moment, not a permanent
property: npm publishes continuously, so a reader checking later will find newer versions and should not read these
rows as claiming otherwise. What is durable, and what a reader can verify, is the **resolved version in the committed
`package-lock.json`**, which is the version each row's "Held at" column states.

| Package | Held at | Behavioral justification |
|---|---|---|
| `highlight.js` | **9.18.5** | Version 10 renamed the emitted `hljs-*` token classes and changed the `highlight()` signature. `lib/shared/trinket-markdown.js:L413` calls the two-argument `hljs.highlight(lang, code)` form and splices the result straight into rendered markdown, so a bump would change **client-visible markup** on every page containing a fenced code block. See [PRESERVED-QUIRKS.md](PRESERVED-QUIRKS.md) section 2 |
| `limax` | **1.4.1** | Its slug output **is public URLs**. Any change to slug generation changes URLs that already exist in the wild |
| `transliteration` | **0.1.1** | Same reason: it feeds the same slug pipeline at `lib/models/plugins/slug.js`, and its output is part of public URLs |
| `numeral` | **1.5.6** | Formats template-rendered text at `lib/util/nunjucks.js:L6` and `L131`; a formatting change is a visible page change |
| `escape-string-regexp` | **1.0.5** | Version 4 changes which characters are escaped, and version 5 is ESM-only. The consumer at `lib/models/trinket.js:L5` and `L269` builds search patterns, so a change in escaping changes which records match |
| `config` | **0.4.37** | 43 require sites, and the test harness depends on this version's `NODE_CONFIG_*` environment-variable semantics, including `NODE_CONFIG_PERSIST_ON_CHANGE` |
| `mongoose` | **inside the 6.x line** | Version 7 and above remove the discriminator-adjacent behavior that `Model.extend` at `lib/models/model.js:L190-L192` depends on. The patch bump to 6.13.10 in Rubric 1 is the whole of the movement permitted here |
| `mongoose-schema-extend` | **0.2.2** | The sole provider of `Schema.extend`, and **no maintained successor exists**. It is the reason the mongoose 6.x ceiling exists at all |
| `underscore` | **1.13.8** | Already above the vulnerable range, and 31 require sites depend on its exact semantics |
| `moment` | **2.30.1** | Already current at migration time; 6 require sites |
| `nunjucks` | **3.2.4** | The template engine for 79 server-rendered views. It is also the package whose **optional peer dependency** on `chokidar` `^3.3.0` is why `chokidar` 3.6.0 is a declared runtime dependency rather than a Rubric 4 removal — npm does not install an optional peer on the dependent's behalf, measured on both resolver majors, so the declaration is what keeps non-production boots working; the measurement is in *Reconciliation with the plan's projected figures* above |
| `chokidar` | **3.6.0** | **Required, despite zero direct require sites**, which is why the plan lists it among the dead removals. `nunjucks` declares it an **optional peer dependency** and `require`s it lazily whenever template watching is enabled, and `lib/util/nunjucks.js:L8` enables watching for both development and test — so removing it breaks the very environment the suite runs in. Held rather than bumped because the peer range is `^3.3.0`; chokidar 4 would not satisfy it. The measurement is in *Reconciliation with the plan's projected figures* above |
| `winston` | **3.19.0** | Already current at migration time; the log surface assigned to the undeclared `log` global at `app.js:L19` |
| `redis` | **4.7.1** | Already current at migration time, and already the promise-based client API that `config/redis.js` uses |
| `@hapi/boom` | **10.0.1** | Already current at migration time. 95 error constructions across the codebase depend on its exact wire behavior, including the rule that 4xx passes its message and 5xx scrubs it |
| `@hapi/vision` | **7.0.3** | Already current at migration time; wired to the Nunjucks compile function |
| `@hapi/yar` | **11.0.3** | Already current at migration time. It decorates only `request.yar` and `server.yar`, and the cookie name and iron-seal format are part of the preserved session contract |
| `sass` | **1.98.0** | **Advancing it breaks the Foundation 5.5.3 fork's Sass.** It cannot pass the `@import` and legacy-JS-API removals, and the build must keep emitting the same two CSS artifacts at the same paths — `public/css/base.css` at 265,727 bytes and `public/css/embed.css` at 296,352 bytes |
| `vite` | **4.5.14** | The installed version already builds green on Node 22 and emits exactly those two artifacts. Advancing it risks the same stylesheet output for no benefit |
| `@hapi/shot` *(transitive)* | 5.0.5 advanced to **6.0.3** | Not a decision of this change: it moved as a transitive consequence of the `@hapi/hapi` major bump already classified in Rubric 2. It is recorded here because 6.0.3 is the highest version published at migration time, so its inject-only DEP0169 — traced to `node_modules/@hapi/shot/lib/request.js:L30` — has **no upstream fix**. That is why the delivered parity harness issues real HTTP and never calls `server.inject()`, stated in `test/baseline/capture.js` and re-stated in `test/baseline/replay.js` and `test/lib/api/route-parity.js`. The application's own two internal sub-requests do inject, which is why the warning is reachable at all; see [PRESERVED-QUIRKS.md](PRESERVED-QUIRKS.md) sections 3.9 and 7.6 |

Three groups among these holds exist specifically to protect **client-visible output**, and they are the clearest
cases in the whole inventory where a routine-looking upgrade would have been a behavior change: `highlight.js`, whose
emitted CSS class names appear in rendered markup; `limax` with `transliteration`, whose output is public URL slugs;
and `sass` with `vite`, whose output is the two byte-comparable CSS artifacts.

## The audit gate — measured, not asserted

Every figure in this section was **regenerated from the committed artifacts** immediately before being written down,
never transcribed from the plan. Where a regenerated figure differs from the plan's, both are shown and the drift is
explained, because an advisory database is a moving target and a number with no provenance is worse than no number.

**Baseline, at the base commit, re-measured.** The base commit's own `package.json` and `package-lock.json` were
extracted from `2f8712a` into a scratch directory and audited with `--package-lock-only`, so the measurement is of the
base commit's resolution rather than of anything this change installed. That lockfile holds **677** package entries
excluding the root, which npm decomposes as 470 production, 120 development and 126 optional.

| Audit scope, base commit | critical | high | moderate | low | total | distinct vulnerable packages |
|---|---|---|---|---|---|---|
| `npm audit --omit=dev` | **15** | **26** | **17** | 0 | **58** | 58 |
| `npm audit` (full tree) | **18** | **36** | **19** | 0 | **73** | 73 |

The plan recorded 15 / 27 / 17 for 59 production findings and 18 / 37 / 19 for 74 across the whole tree. Each of those
differs from the regenerated figure by **exactly one high finding**, which is what an advisory database moving between
the plan's measurement and this one looks like. The regenerated figures above are authoritative for this document; the
plan's are left visible so the one-finding drift is not mistaken for a discrepancy in the manifest.

**Committed result, re-measured under the pinned resolver.** `npm ci` under npm 10.9.9 against the committed lockfile
exits 0 and installs **427 packages** — npm's own summary line reads `added 427 packages, and audited 428 packages`,
the audited figure being the 427 plus the root project, the same root-exclusion convention the lockfile counts above
use. Two independent measures of the delivered tree agree, and both need one subtraction to be meaningful:

- `npm ls --all --parseable` prints **428** lines, of which one is the project root: **427**.
- A recursive walk of `node_modules` finds **467** `package.json` files, of which **40** are dual-format sub-manifests
  rather than packages — the `dist/commonjs/package.json` and `dist/esm/package.json` shims that `@hapi/tlds`, `diff`,
  `glob`, `foreground-child`, `@redis/client`, `@noble/hashes` and others use to declare `type` per output directory:
  **427**.
- The lockfile's **466** entries reconcile to the same figure from the other direction: **39** of them are never
  installed on this platform, every one of them marked `"optional": true` — the `@esbuild/*` cross-platform binaries,
  the `@msgpackr-extract/*` prebuilds, `fsevents`, `nodejieba` and the `bare-*`/`react-native-b4a` shims — and
  `466 - 39 = 427`. Those same 39 are what `npm ls --all` reports as `UNMET OPTIONAL DEPENDENCY`; it exits **0** and
  reports **zero** invalid, missing or extraneous packages.

An earlier revision published **426** here and in the sibling catalogue, and one before it **428**. Both are
**superseded**: the count moved to 427 when `@aws-sdk/s3-request-presigner` was added, which Item 6 of the
reconciliation records, and that addition is also why the lockfile now holds **466** entries rather than 465. The
`uuid` override whose removal Rubric 1 records is *not* implicated in any of this drift, because reinstating it was
measured to leave the lockfile entry count unchanged, merely hoisting `uuid` to `11.1.1` instead of resolving `8.3.2`
beneath `bull`. `npm audit --omit=dev` reports:

```json
{ "info": 0, "low": 0, "moderate": 3, "high": 0, "critical": 0, "total": 3 }
```

**The zero-critical-and-zero-high result is measured, not aspirational** — 15 critical and 26 high findings closed —
and the residual figure is **exactly the `{critical: 0, high: 0, moderate: 3}` AAP §0.6.1.7 projects for the target
set**, package for package: the `uuid`-in-`bull` pair and the deliberate `highlight.js` hold. An earlier revision
carried a `uuid` override that took this to 1 moderate; it was removed because the plan specifies which three findings
are accepted, and a better number is not a licence to change the specified dependency shape. See *Why there is no
`uuid` override* in Rubric 1.

**Adding `@aws-sdk/s3-request-presigner` did not move this gate.** The production audit was re-run immediately after
the addition and is byte-for-byte the block above — same three advisories, same severities, no fourth. That is a
load-bearing fact for the escalation in Item 6: the third package buys a supported presigner at **zero** cost against
the one dependency gate AAP §0.6.1.7 sets, because all six of its own dependencies were already resolved in the tree
by `@aws-sdk/client-s3`.

### The three accepted moderate findings

All three are the findings AAP §0.6.1.7 names and accepts, and each is accepted for a reason the plan states rather
than for convenience:

- **The `uuid`-in-`bull` pair**, advisory *"Missing buffer bounds check in v3/v5/v6 when buf is provided"*, applying to
  `uuid <11.1.1` and charged twice, once against `uuid` and once against `bull` as its path. Accepted because **the
  vulnerable API is unreachable**: `bull` calls `uuid.v4()` at exactly three sites, always with zero arguments, and no
  `v3(`, `v5(` or `v6(` appears anywhere in `node_modules/bull/lib`. npm's only offered fix is `bull` 1.1.3 — a semver-major
  **downgrade** of a live dependency, which would be a regression. The full measurement is in Rubric 1 under *Why there
  is no `uuid` override*.
- **The deliberate `highlight.js` hold**, advisory *"ReDOS vulnerabities: multiple grammars"*, applying to the range
  `9.0.0 - 10.4.0`. npm's only offered fix is `highlight.js` 11.11.1, a semver-major bump. The acceptance is
  evidence-backed rather than asserted, and the evidence is in
  [PRESERVED-QUIRKS.md](PRESERVED-QUIRKS.md) section 12.3: the reachable surface is **one** server call site,
  `lib/shared/trinket-markdown.js:L413`, guarded by `hljs.getLanguage(lang)` and reached only from
  `lib/controllers/courses.js:L287` inside `download()` when `format === "html"`, which binds it to the single
  session-authenticated route `GET /{userSlug}/courses/{courseSlug}/download.zip`; a sizing run over **all 185**
  bundled grammars against 8 pathological payloads measured a worst case of **42.6 ms** and a median of **1.03 ms**,
  scaling linearly rather than catastrophically; and a 15-language differential against 10.4.1 — the *minimum*
  non-vulnerable version, a gentler move than the 11.x npm proposes — found that **6** languages emit different
  markup and that `r`, a language this platform actually ships, **gains an `hljs-built_in` class**. Changing emitted
  markup is precisely the behavior change R-4 forbids, so the hold stands and the finding is accepted with that
  measurement attached. One correction to the reason the plan gave for this hold: 10.4.1 **still accepts** the
  positional `highlight(lang, code)` form used at that call site, so it is the **markup** that blocks the bump, not the
  signature.


**Development-only findings are recorded separately and are not charged to this change.** Re-measured on the committed
tree with the two development-tree overrides in place, `npm audit` over the whole tree reports
`{info: 0, low: 0, moderate: 4, high: 1, critical: 0, total: 5}` — **`vite` at high**, and `bull`, `esbuild`,
`highlight.js` and `uuid` at moderate. That single high reaches the tree through `vite` alone and is therefore
**development-only**: nothing under `app.js`, `config/`, `lib/` or `scripts/` requires it or `esbuild`. An earlier
revision of this paragraph published the **pre-override** reading (`2` high, `5` moderate, `1` low) and contradicted the
figure the next subsection gives; the numbers above are the delivered tree's, and the two agree. `vite` and `sass` are
held for the stylesheet reason given in Rubric 5, and the gate the plan sets is `npm audit --omit=dev`, which is what
the production table above measures.
### Current advisory status, verified against the live advisory service

An earlier review recorded this as unverifiable: six or more web searches returned nothing and documentation fetching
was blocked, so the dependency set's *current* advisory status was marked unconfirmed and treated as approval-blocking
(finding SV-06). That gap is now closed, and it was closed by querying the **advisory database directly** rather than by
searching for prose about it. `npm audit` is not an offline heuristic — it POSTs the dependency tree to npm's bulk
advisory endpoint and reports what the GitHub Advisory Database says at that moment. The same endpoint can be queried
explicitly, which is what was done:

```
POST https://registry.npmjs.org/-/npm/v1/security/advisories/bulk   ->  HTTP 200
```

Every `name@version` pair in the committed lockfile was submitted — **414 distinct names, 442 name-version pairs** —
and the response named exactly **four** packages carrying any current advisory: `esbuild`, `highlight.js`, `uuid` and
`vite`. That agrees with both audit scopes above, and the one apparent discrepancy is explained rather than left
hanging: the production audit lists **five** names because it reports `bull` as the *path* to the `uuid` advisory
(`bull.via = ["uuid"]`), not as a package with an advisory of its own.

The result that matters for R-2 is the negative one. **Zero current advisories were returned for any package this
modernization introduced or advanced**, each queried at its exact committed version: `@aws-sdk/client-s3` 3.1098.0,
`@aws-sdk/s3-request-presigner` 3.1098.0, `crypto-js` 4.2.0, `@hapi/hapi` 21.4.10, `joi` 18.2.3, `mongoose` 6.13.10,
`bcrypt` 6.0.0, `marked` 4.3.0, `archiver` 7.0.1, `nodemailer` 9.0.3 — and all three `overrides` targets,
`brace-expansion` 2.1.4, `diff` 9.0.0 and `serialize-javascript` 7.0.7. The overrides were additionally confirmed
**effective** rather than merely declared: every instance of each in the lockfile resolves to the pinned version
(`brace-expansion` 2 instances, `diff` 1, `serialize-javascript` 1), so no unpinned copy survives beneath a consumer.

Two of the four findings are examined in the subsections around this one. The `uuid` finding is worth stating here
because its unreachability is now **measured rather than asserted**: advisory GHSA-w5hq-g745-h8pq concerns a missing
buffer bounds check in `v3`/`v5`/`v6` *when a `buf` argument is supplied*, and `bull` calls `uuid` at exactly three
sites — `node_modules/bull/lib/queue.js:120`, `node_modules/bull/lib/queue.js:1412` and
`node_modules/bull/lib/timer-manager.js:74` — every one of them
`uuid.v4()` with **no arguments at all**. The vulnerable path is doubly out of reach: wrong function, and no `buf`.

**And npm's own offered remediation is a strict regression, which is why the finding is accepted rather than fixed.**
`npm audit` proposes `bull@1.1.3` — three majors backwards from the committed 4.16.5 — and that release's declared
dependencies were read from the registry rather than guessed: `redis@^2.6.3`, `node-uuid@^1.4.7`, `bluebird@^3.4.6`,
`semver@^5.3.0`, `debuglog`, `disturbed`. Querying those against the same advisory service returns a **HIGH** on
`redis` in the `>=2.6.0 <3.1.1` range, so the "fix" would move the production audit from **0 high** to **1 high**. It
would also reinstate `node-uuid`, which npm itself marks `deprecated: "Use uuid module instead"` and which is one of
the 23 runtime packages this migration removed as dead (present in the base commit's manifest, absent from the current
one), and `bluebird`, a promise library whose removal is the point of AAP G3. Accepting three unreachable moderates is
the only disposition consistent with the gate G4 actually sets.

### The one accepted HIGH finding, in the development tree

The gate AAP G4 sets is `npm audit --omit=dev`, and the production table above measures it at 0 critical and 0 high.
The **full-tree** audit is reported here as well, because R-2 asks for a maintained dependency set and a HIGH advisory
in the toolchain is not something to leave unstated.

```json
{ "info": 0, "low": 0, "moderate": 4, "high": 1, "critical": 0, "total": 5 }
```

Two HIGH findings and one LOW were **closed** by the two development-tree overrides described in Rubric 1:
`serialize-javascript` (2 advisories, RCE and CPU-exhaustion DoS), `mocha` as their path, and the nested `diff` copy.
The moderates are `bull` and `uuid` (the accepted pair above), `highlight.js` (the accepted hold above) and `esbuild`,
which reaches the tree only through `vite`.

**One HIGH remains, it belongs to `vite`, and it cannot be closed without breaking a frozen layer.** The two advisories
npm charges to `vite <=6.4.2` at HIGH are
[GHSA-fx2h-pf6j-xcff](https://github.com/advisories/GHSA-fx2h-pf6j-xcff) — *"`server.fs.deny` bypass on Windows
alternate paths"* — and [GHSA-c27g-q93r-2cwf](https://github.com/advisories/GHSA-c27g-q93r-2cwf) — *"launch-editor
vulnerable to command injection via the crafted request on Windows"*. Four facts bound the exposure and one bounds the
remedy, and all five are measured on the delivered tree:

- **`vite` is a `devDependencies` entry**, so it is absent from `npm ci --omit=dev` and from the container's runtime
  surface. The production audit does not see it, which is why the G4 gate is clean.
- **Both advisories are dev-server issues.** `server.fs.deny` is a `vite dev` file-serving control and `launch-editor`
  is the dev-server error overlay's click-to-open handler. This project runs `vite build` and nothing else — the only
  two scripts that invoke it are `build:css` and `watch:css`, both `vite build`.
- **Both advisories are Windows-only**, by their own titles.
- **`launch-editor` is not installed at all.** `ls node_modules/launch-editor*` finds nothing: it is a `vite` 5+
  dependency, so that advisory is charged against the version range rather than against anything present here.
- **Every version that closes the range fails the build.** The advisory range is `<=6.4.2`, so no 4.x or 5.x release is
  safe and the smallest candidate is `vite` 6.4.3. Measured on this tree, `vite` **6.4.3** and `vite` **7.3.6** both
  exit 1 with `[vite:css] [sass] Can't find stylesheet to import` at `static/scss/embed/_settings.scss:8`, because from
  vite 5.4 onward the Sass integration moved to the modern compiler API whose resolver does not accept the
  root-relative `@import "public/components/foundation/scss/foundation/functions"` form the settings partials use.
  Fixing it would mean editing `static/scss/**` — the 54-file design-token layer AAP §0.2.2.2 freezes — or editing
  `vite.config.mjs`, which §0.5.1.8 lists as REFERENCE, no change. **AAP I8 holds `vite` at 4.5.14 precisely so the
  vendored Foundation 5.5.3 fork keeps compiling to the same bytes, and that hold is now confirmed by execution rather
  than accepted on the plan's word.** Reverting to 4.5.14 reproduces `public/css/base.css` at 265,727 bytes / sha256
  `34f1b6e1…` and `public/css/embed.css` at 296,352 bytes / sha256 `53f47fc7…`, byte-for-byte.

The finding is therefore **accepted and documented**, on the same footing as the three moderates: unreachable in this
project's build path, absent from the production tree, and unfixable without violating a freeze the plan states
explicitly. `sass` is held for the same stylesheet reason, recorded in Rubric 5.

### Reproducibility, added by this change

**What the base commit did and did not have.** It **did** have a committed `package-lock.json` at lockfileVersion 3,
so dependency *resolution* was already pinned — including the `marked` git dependency, which the lock recorded at a
specific commit SHA. What it lacked was every pin **above** the dependency graph: no `engines` field, so nothing
declared which Node or npm the lockfile was written for; no `.nvmrc`, so nothing told a version manager which
interpreter to select; no `.npmrc`, so neither engine enforcement nor exact-save was in effect; and a container that
installed with `npm install --legacy-peer-deps`, which lets the resolver drift away from the lock it was handed. The
gap this section closes is therefore the **runtime, toolchain and container** layer, not the lockfile. Every item
below is new or changed.

**`package.json` gains an `engines` block**, verified absent at the base commit. The committed value is exactly:

```json
"engines": {
  "node": ">=22.12.0 <23.0.0",
  "npm": ">=10.0.0 <11.0.0"
},
"packageManager": "npm@10.9.9"
```

The node floor is **22.12.0 rather than 22.0.0**, and the extra precision is load-bearing. This migration depends on
the **non-throwing static `URL.parse()`**, which AAP §0.1.1.4 (implicit requirement I5) selects as the correct Node 22
replacement for the deprecated `url.parse()` precisely because it returns `null` instead of throwing. Node's release
notes record that static method as added in **22.1.0**; it is a function on this checkout's v22.23.2 and `undefined`
on a 22.0.x runtime, where **every** site that replaced a `url.parse()` call would raise a `TypeError` at first use.

The census below is regenerated from the delivered tree, and it names the **enclosing symbol** rather than a line
number on purpose: an earlier revision of this paragraph carried fourteen line locators of which the majority had
already drifted, two pointed at `lib/http/redirect.js` — a 69-line file with no `URL.parse` site at all — and one
pointed at `test/lib/api/route-parity.js`, which likewise has none. A symbol name cannot drift the same way, and the
whole census is reproducible at any commit with `git ls-files '*.js' | xargs grep -n 'URL\.parse('` (19 hits: the 14
call sites below plus 5 prose mentions inside comments).

| Layer | Enclosing symbol | What it parses |
|---|---|---|
| production | `lib/controllers/users.js#assetUploadFromURL` | the submitted `request.payload.url`; its missing `protocol` is the preserved rejection quirk |
| production | `lib/controllers/users.js#downloadRemoteAsset` | the remote asset URL, once before the fetch |
| production | `lib/controllers/users.js#downloadRemoteAsset` → inner `attempt` | the redirect target, **twice**: the absolute form, then the `Location`-relative form |
| production | `lib/controllers/trinket.js#assetPathname` | an asset URL, for its `pathname` |
| production | `lib/workers/exports.js#assetPathBasename` | an asset URL, for its last path segment |
| harness | `test/helpers/flow.js#setLastResponse` | every response's `Location`, resolved against `config.url` |
| harness | `test/lib/api/registration.js`, the course-copy redirect assertion | one **absolute** `Location`, where the base is therefore ignored |
| harness | `test/baseline/capture.js#classifyHopTarget` | a hop `Location`, and the candidate origin it is compared against |
| harness | `test/baseline/capture.js#sameOrigin` | both sides of an origin comparison |
| harness | `test/baseline/replay.js#locationKind` | a `Location`, **twice**, to classify it absolute / relative-reference / unparseable |

That is **14 call sites across 7 files** — 6 in production code, 8 in the harness. `test/baseline/replay.js` carries
two of its own again: the remediation that restored its verification layer reinstated `locationKind`. What that file
still does **not** have is an origin-**rewriting** helper; `rebaseOrigin` was deleted and stays deleted, asserted by
`test/lib/util/baseline-harness-integrity.js` and recorded in
[PRESERVED-QUIRKS.md](PRESERVED-QUIRKS.md) section 14.4. A floor of `>=22.0.0` would therefore admit a
runtime on which the application does not work — the opposite of what **AAP G1** asks the `engines` block to
guarantee. `22.12.0` sits well above 22.1.0 and is also the release from which `require(esm)` is unflagged —
`process.features.require_module` measures `true` on v22.23.2 — while `.nvmrc`'s bare `22` resolves to the newest
22.x on any current distribution, which satisfies the floor with no pinning of its own.

**Both constraints are bounded on both sides, and the npm bound is what AAP G1 and R-2 ask for: npm 10, pinned.** The
floor costs nothing to satisfy and the ceiling costs nothing either, because **every** Node 22 release bundles an
npm 10 — the release index at `https://nodejs.org/dist/index.json` records npm 10.9.8 for v22.23.2 and v22.23.1,
npm 10.9.4 for v22.22.0, and across the whole of the Node 22 line the set of bundled npm majors is exactly `{10}`. A
stock Node 22 LTS therefore satisfies `>=10.0.0 <11.0.0` out of the box, with no downgrade step and no extra install.

**`packageManager` names the exact release**, `npm@10.9.9`, which is the same release the container image installs and
the release the committed lockfile was generated by — so the image, CI and a developer checkout all resolve through
one resolver rather than three.

`.npmrc`'s `engine-strict=true` is what gives both bounds teeth, and the consequence is deliberate: on a distribution
whose default resolver has moved to npm 11, every npm command **fails** with
`npm error code EBADENGINE ... Required: {"npm":">=10.0.0 <11.0.0"} Actual: {"npm":"11.18.0"}` rather than warning.
That is the pin refusing an unpinned toolchain, and the remedy is to switch the toolchain, which `.npmrc`, `README.md`
and `docs/setup.md` all state along with the two one-line commands that do it — `corepack enable npm && corepack prepare
npm@10.9.9 --activate`, or `npm install -g npm@10.9.9`. Every gate was then re-run under the pinned resolver rather than assumed:
with npm 10.9.9, `npm ci` exits 0, `npm run build` exits 0 and reproduces both stylesheet artifacts byte-for-byte, and
`npm test` exits 0 with zero failures. `lockfileVersion` 3 is the format npm 7 and later both read and write, so `npm ci`
consumes the committed file without rewriting it.

**`package.json` gains an `overrides` block**, also verified absent at the base commit, pinning the **three**
transitive packages that carried advisories on behalf of dependencies this change keeps — the denial-of-service chain
that reaches `archiver`, and the two HIGH/LOW advisories the test runner brought with it:

```json
"overrides": {
  "brace-expansion": "2.1.4",
  "diff": "9.0.0",
  "serialize-javascript": "7.0.7"
}
```

That block is transcribed from the committed `package.json`, not written by hand: the three keys and three values above
are exactly what the manifest holds. There is deliberately no `minimatch` entry — the pin an earlier revision carried
was measured to close nothing the `brace-expansion` pin does not already close, while overriding three consumer ranges
that cannot accept a 10.x — and deliberately no `uuid` entry, for the specification reason in Rubric 1. The full
reasoning for all three is in Rubric 1.

The remaining items complete the surface:

- **`.nvmrc` is new**, and contains `22`.
- **`.npmrc` is new**, and sets `engine-strict=true` and `save-exact=true`. The second is why the committed manifest
  carries exact versions rather than ranges throughout.
- **`package-lock.json` is regenerated at lockfileVersion 3 and committed**, and `npm ci` consumes it without
  rewriting it — measured: `npm ci` exits 0 and the file's sha256 is byte-identical before and after. That digest is
  `d3d866dfbd767f4e71b3e765cec46815545d1f6f36bea30958407a49c825cda5`, re-derived from the committed file with
  `sha256sum package-lock.json` rather than transcribed; two earlier revisions of this document published
  `db571b90675baa7975cda7fb7ea477a7e71a72130372001836e74f69e70c0525` and then
  `ce48d854a34d48eabe016358c24fe4e538855a15665ff7dd7b15a1fad8d35c5f`, each the digest of an intermediate lockfile that
  had gone stale by the time later dependency work landed. The base commit's lockfile was **also**
  lockfileVersion 3 and **also** pinned every specifier, including the `marked` fork at
  `git+ssh://git@github.com/trinketapp/marked.git#55ea8249…`, so this is
  a regeneration rather than the introduction of determinism. The substantive, measured gains are narrower and
  concrete, and the counts below use the **same convention as the audit section above — package entries excluding the
  root entry**, so that the two sections agree: the base lock had **677** package entries, of which **exactly one**
  carried no `integrity` field and exactly one `resolved` URL was not an anonymous registry tarball — both the
  `marked` fork entry, resolved over `git+ssh://`. The current lock has **466** entries, **zero** without
  `integrity`, and **zero** non-registry
  `resolved` URLs, so every artifact `npm ci` fetches is now hash-verified and reachable without a git binary or SSH
  credentials. Both counts and both zero-checks are re-derivable from the committed files with
  `Object.entries(require('./package-lock.json').packages).filter(([k]) => k !== '')`.
- **The `Dockerfile` moves off its Node 16 base to a Node 22 LTS base, and its install step becomes `npm ci`.** The
  base commit ran `npm install --legacy-peer-deps`; that escape hatch is precisely the pinning-as-workaround R-2
  forbids, because it lets the resolver silently drift away from the lockfile.
- **The `Dockerfile` base images are pinned to an exact patch release, not to the floating `22-bookworm` tag**, because
  a floating tag lets both the interpreter and its bundled npm move between image builds — the opposite of what the pin
  exists to guarantee. It then runs `npm install -g npm@10.9.9`, so the image's package manager is fixed at the exact
  release `packageManager` names, inside the declared `npm >=10.0.0 <11.0.0` range, even if the base tag is ever
  re-pointed. The base image already bundles npm 10.9.8, so this fixes an exact release rather than correcting a
  violation.
- **The `Dockerfile` is a two-stage build, and the runtime stage is `node:22.23.2-bookworm-slim`** (review finding
  SV-41). The builder — on the full `node:22.23.2-bookworm` — installs `python3` and `build-essential`, hydrates and
  digest-verifies the component tarball, runs `npm ci`, and runs `npm run build`; the runtime stage copies the finished
  tree and installs no compiler. The `-slim` choice is not cosmetic and was forced by measurement: the **full** base
  image ships `python3`, `gcc`, `g++`, `make`, `cc` and `curl` *in its own layers* — `dpkg -l build-essential` reports
  nothing installed there, yet all six are on `PATH` — so moving the explicit `apt-get install` into the builder alone
  removes only the meta-package and the apt index, not the compilers. On `-slim` all six are absent. The runtime stage
  was verified end-to-end on this tree: all **38** production dependencies `require` cleanly, `bcrypt` resolves its
  shipped prebuild (`bcrypt/prebuilds/linux-x64/bcrypt.glibc.node` — nothing in this lockfile compiles, so there is no
  build output to lose across the stage boundary) and hashes and verifies correctly, the two stylesheets arrive at
  265,727 and 296,352 bytes with the committed digests and zero `.css.map` files, the application boots and serves
  `GET /` as 200 `text/html; charset=utf-8`, and Docker's own `HEALTHCHECK` evaluator reports the container **healthy**.
  Image size falls from 2.05 GB to 1.15 GB. `pm2` is pinned to `5.4.3` — the release the previous floating `pm2@5`
  already resolved to, so the supervisor does not move — and the `HEALTHCHECK` probes with `node` rather than `curl`,
  because `-slim` carries no `curl` and a probe whose binary is missing reports unhealthy forever while measuring
  nothing.
- **`.dockerignore` excludes `config/local.yaml`, `node_modules` and `public/components`** in addition to `**/.git`.
  The first is a security correction found by inspecting a built image: the build context is not the repository, so
  `COPY . …` copied whatever was on disk, and every image built from a developer's working tree baked that developer's
  gitignored session-seal password into a shipped layer — confirmed present at 3,465 bytes in an image built before the
  exclusion and absent after. The other two are reproduced inside the builder by steps whose whole purpose is to be
  deterministic (`npm ci` from the committed lockfile; the digest-verified release tarball), so letting host copies in
  both slowed every build and let host state influence them. Build context falls from 847 MB to 226 MB, and everything
  the build reads — including `test/baseline/responses.json`, which the `postbuild` stylesheet gate consults — was
  verified still present.
- **Verified working toolchain: node v22.23.2 with npm 10.9.9.** Both sit inside the committed `engines` constraint,
  which is satisfiable by a stock Node 22 LTS as measured above — so a checkout installs without touching its package
  manager, and `engine-strict=true` rejects anything outside the range instead of warning.
- **The documented prerequisites were corrected to match.** `README.md:L18` and `docs/setup.md:L9` stated "Node.js
  18+"; both now state the bounded Node 22 range and the bounded `npm >=10.0.0 <11.0.0` range the manifest actually
  declares, name the exact `packageManager` release, and give the two commands that move a checkout carrying npm 11
  onto it — because with `engine-strict=true` such a checkout is refused rather than warned.

## What is NOT a dependency change

Two things in this repository look like dependency problems and are not. Both are stated here so that no one later
"fixes" them and, in doing so, changes behavior.

### `gleak` is neither declared nor vendored

`app.js:L28-L33` — `L29-L36` at the base commit — contains a guarded optional `require` of `gleak` with a working
no-op fallback. The package appears
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
