# Deferred dependencies

The record of every dependency this migration deliberately **left in place**, with the reasoning that
justifies each one, plus the migration's **two approved deviations** and the honest statement that one
of the request's stated validation targets is **not met**.

This file owns what did **not** change. Its companion
[`dependency-inventory.md`](dependency-inventory.md) owns what did.

- **Base commit (baseline for every "before" value):** `2f8712a`
- **Migration:** Node 16/18 → Node 22 LTS (measured `node v22.23.2`, `npm 10.9.8`), `@hapi/hapi`
  20.3.0 → 21.4.10, and the 2013 callback idiom converted to `async (request, h)` lifecycle methods
- **Named deliverable of rule R-c**, which requires that unmaintained-but-still-functional packages be
  recorded in a **separate** list with per-package reasoning

## Scope of this document, and where the rest lives

Nothing below is duplicated from the three companion documents:

| Document | Owns |
|---|---|
| [`dependency-inventory.md`](dependency-inventory.md) | Every package **changed** — replaced, major-bumped, removed or added — with original → target → reason, and the 23 removals |
| [`preserved-quirks.md`](preserved-quirks.md) | Behaviour **preserved** unchanged, including behaviour that is a defect, with the target disposition that reproduces each. It is the canonical statement of both approved deviations |
| [`baseline-parity.md`](baseline-parity.md) | How baseline was captured and compared: worktree provenance, corpus method, coverage accounting and the R-f resolution log |

In particular: **a package with no live consumer is not deferred, it is removed**, and it belongs in
the inventory. That boundary is drawn explicitly in [§1](#1-the-deferral-rule) because "deferred but
functional" is exactly where dead declarations would otherwise be hidden.

## Rules that govern this record

`review_rules` reports that **no user-specified rules were provided** for this project — verified with
the tool for this document, and independently recorded by AAP §0.7 and §0.10.1. Nothing has been
invented in their place, and their absence is not read as licence to lower the bar: enterprise
practice for a runtime and framework migration governs, which here means stating the residual risk
honestly and never presenting an unmet target as met.

The binding constraints are the request's own RULES block, carried by the AAP. Each is cited by name
and summarised, never reproduced:

- **R-c** — every replaced or major-bumped package recorded with its reason, and unmaintained-but-
  functional packages recorded in a separate deferred list with reasoning. **This document is one of
  its two named deliverables.** R-c naming *security* as a permitted reason is what makes the
  inventory's advisory-driven bumps legitimate; the mirror consequence lands here, and it is the whole
  of [§1](#1-the-deferral-rule) — a package carrying **only a moderate** finding, with no
  incompatibility and no warning, is **deferred, not bumped**.
- **R-a** — the diff must read as four things and nothing else: runtime bump, hapi API migration, async
  conversion, blocking-only dependency swaps. This document is where the four genuine modernization
  projects that were **not** undertaken are recorded, each one real work outside those four categories
  ([§3](#3-deferred-migrations--the-work-deliberately-not-done)).
- **R-b** — no vendored dead packages. The criterion this document is held to: a deferred package
  **has a live consumer in retained source**, and *a consumer that is itself never invoked does not
  count as live*. Every entry below names its consumer with a file and line, verified by search.
- **R-d**, together with the **PRESERVE** clause on client-visible page behaviour — behaviour
  "improvements" are prohibited. R-d is the reason the `marked` fork is retained, and this document
  carries that precedence argument in full ([§4.2](#42-deviation-2--the-marked-fork-is-retained)).
- **The zero-critical/high audit target.** What it requires of this document is reported in
  [§5](#5-audit-result) and stated plainly in [§6](#6-the-stated-gate-is-not-met). The gate is not
  redefined, no exception is granted, and the shortfall is not softened.

## Evidence discipline

Every version, count and figure below was **measured against the delivered tree**, not carried over
from the plan. Resolved versions come from the delivered `package-lock.json`; baseline resolved
versions from `git show 2f8712a:package-lock.json`; audit figures from `npm audit --omit=dev` on
`node v22.23.2` / `npm 10.9.8`; consumer claims from search over the repository's `*.js` files
excluding `node_modules`, `.git` and `public`. Where a measurement disagreed with the planned
expectation, **the measurement is what is recorded** and the disagreement is logged in
[§7](#7-measurement-notes).

Addresses are qualified by tree, following the convention `preserved-quirks.md` establishes:

| Form | Tree | How to retrieve it |
|---|---|---|
| `[B path:lines]` | **Baseline**, at `2f8712a` | `git show 2f8712a:path` |
| `[T path:lines]` | **Target**, the delivered working tree | `sed -n 'lines p' path` |

| Tag | Meaning |
|---|---|
| **probe** | Executed in this tree (or an isolated sandbox, named where used) and the result read from its output |
| **static** | Read directly from the cited source, with counts obtained by search over a named file set |
| **pending** | Not verifiable from this tree yet; the gate that settles it is named |

## 1. The deferral rule

One rule produced every disposition in this migration. The inventory states it as the condition for
**changing** a package; this document is the same rule read from the other side:

> A package is **deferred** when it is functional, has a **live consumer in retained source**, and
> produces **no** Node 22 or hapi 21 incompatibility, **no** runtime deprecation warning, and **no**
> critical-or-high advisory. A **moderate-only** finding is not a sufficient reason to change it.

Three clauses in that rule did real work, and each is worth isolating because each one decided an
entry below.

**"Live consumer" is what keeps this list honest.** R-b forbids vendored dead packages, so a list of
"packages we chose not to touch" is precisely where a dead declaration would survive review. The
criterion is therefore stricter than "something requires it": a consumer that is itself never invoked
does not count. That distinction is what removed `lib/auth/passport.js` and its four `passport`
packages — recorded in the inventory's removals, not here — and it is why every entry below cites an
invocation site and not merely a `require`.

**"Moderate-only" is a deferral, not an oversight.** Six of the packages below carry a live moderate
advisory. Under a rule that bumped on any finding, `mongoose`, `jszip`, `highlight.js`, `aws-sdk` and
`bull` would all have moved majors, and the diff would no longer read as the four things R-a permits.
`archiver` is the cleanest demonstration that the rule was applied rather than recited: see
[§2.6](#26-archiver-211).

**"No runtime deprecation warning" is the clause with teeth.** The request's own wording is that a
package unmaintained but still functioning *correctly and warning-free* is left in place. The words
**"warning-free"** are load-bearing: deferring a package is permitted, but leaving it printing to the
process's warning stream is not, because the same request sets a zero-deprecation-warning gate over
the entire running application. That clause is what forced the `aws-sdk` end-of-support notice to be
addressed rather than tolerated ([§2.1](#21-aws-sdk-216930)), and it is why
[§2.4](#24-highlightjs-9185) reports a notice that a less careful reading would have passed over in
silence.

## 2. The deferred-but-functional list

Fourteen packages are deferred here. Each entry gives the resolved version, the live consumer, the
reason, and — where one exists — the accommodation made instead of a version move.

`marked` is a **fifteenth** deferred package. Because retaining it is an approved deviation from the
request's audit gate rather than an ordinary application of the rule above, it is recorded in
[§4.2](#42-deviation-2--the-marked-fork-is-retained) instead of in this list — with its consumer, its
version and its reasoning in the same form.

### 2.1 `aws-sdk` 2.1693.0

| | |
|---|---|
| **Resolved** | 2.1693.0 — **unchanged** from baseline |
| **Consumer** | `[T config/aws.js:1]`, the sole `require('aws-sdk')` in the repository. Three modules consume the configured client: `[T lib/util/file.js:4]`, `[T lib/controllers/users.js:26]`, `[T lib/workers/exports.js:24]` |
| **Finding** | moderate |
| **Reason** | Functional. v3 is a storage-layer rewrite, outside R-a's four categories |

**Eight SDK call sites** (static): seven S3 operations — `putObject` at `[T lib/util/file.js:12]` and
`[T lib/workers/exports.js:390]`; `getObject` at `[T lib/util/file.js:83]`,
`[T lib/util/file.js:200]` and `[T lib/workers/exports.js:61]`; `deleteObject` at
`[T lib/util/file.js:143]`; `getSignedUrl` at `[T lib/controllers/users.js:1299]` — plus the one
`AWS.config.update()` at `[T config/aws.js:8]`. Seven `new aws.S3()` client constructions sit across
the same three modules.

**This entry required a decision rather than a deferral, and the reason is the "warning-free" clause
in [§1](#1-the-deferral-rule).** The SDK prints an end-of-support maintenance notice, and it does not
print it to stdout: it uses `process.emitWarning(warning, {type: 'NOTE'})`, so the notice arrives on
**stderr** as a process warning, in exactly the stream the zero-deprecation-warning gate reads.
Measured on the baseline configuration (**probe**):

```console
$ node -e 'require("aws-sdk"); setTimeout(()=>{},50);'
(node:1276293) NOTE: The AWS SDK for JavaScript (v2) has reached end-of-support.
It will no longer receive updates or releases.

Please migrate your code to use AWS SDK for JavaScript (v3).
For more information, check the blog post at https://a.co/cUPnyil
```

Leaving that unaddressed would have contradicted the zero-warning gate **and** the dependency rule
that permits deferring only a warning-free package. Bumping to v3 to silence it would have
contradicted R-a.

**Decision: retain v2 and suppress the notice through the SDK's own supported configuration.** The
suppression is set in `config/aws.js`, where the SDK is constructed:

```javascript
// [T config/aws.js:4-6]
// Suppress the SDK v2 end-of-support NOTE so the application runs warning-free while
// aws-sdk remains deliberately deferred at v2 (see docs/deferred-dependencies.md).
require('aws-sdk/lib/maintenance_mode_message').suppress = true;
```

**Why this is inside R-a's dependency category.** It changes no call site, no request behaviour and no
stored object. The SDK version, the S3 key formats, the bucket selection and every response are
identical with and without it; the only difference is one line on stderr. Migrating eight call sites
to v3 changes the client construction, the operation shapes and the response envelopes at every one of
those sites, and that is not a dependency swap — it is the storage-layer rewrite deferred in
[§3.1](#31-aws-sdk-v2--v3).

**The suppression was verified to work on 2.1693.0** (**probe**), which the plan had flagged as
unproven. Both the flag in isolation and `config/aws.js` as delivered produce **zero** lines of
output where the control produces six. The mechanism, read from
`node_modules/aws-sdk/lib/maintenance_mode_message.js`, is why the ordering in `config/aws.js` is
sound even though the flag is set *after* `require('aws-sdk')` on line 1: the module schedules its
emission on a `setTimeout(..., 0)` guarded on `module.exports.suppress`, so any synchronous assignment
during module load lands before the timer fires. The form used is the one the SDK's own docblock
documents. An `AWS_SDK_JS_SUPPRESS_MAINTENANCE_MODE_MESSAGE` environment variable is an equivalent
hook, not used here because a committed line needs no deployment cooperation.

**The agreed fallback was therefore not needed and is recorded as unused.** Had the flag failed to
suppress the notice on 2.1693.0, the fallback was to record it as the single permitted stderr line
with its exact text, matched literally so the gate stayed mechanical. It is not in force: the gate
asserts the absence of the notice, not an allowance for it.

**Residual risk.** The moderate rating is inherited rather than intrinsic. The SDK's own advisory is
**low** — GHSA-j965-2qgj-vjmq, advising that v2 users validate the `region` parameter value or migrate
to v3 — and `region` here is supplied from committed configuration at `[T config/aws.js:11]`, not from
request input. The moderate comes via the transitive `uuid` finding in
[§5](#5-audit-result). The substantive risk in deferring v2 is not this advisory but the absence of
future security patches, which is what [§3.1](#31-aws-sdk-v2--v3) exists to keep visible.

### 2.2 `mongoose` 6.13.11

| | |
|---|---|
| **Resolved** | **6.13.11** — baseline resolved 6.13.9; the declaration `^6.0.0` is **unchanged** |
| **Consumer** | The whole model layer: 30 `require('mongoose')` sites, including `[T config/db.js:1]`, `[T lib/models/model.js]` and every model module |
| **Finding** | **none** in the delivered tree |
| **Reason** | Functional; Mongoose 7+ is outside R-a |

**The version moved without a decision, and that is worth stating precisely** because it is the reason
this package appears in no table in the inventory. The `^6.0.0` declaration is byte-identical to
baseline; lockfile regeneration floated the resolution from 6.13.9 to 6.13.11 inside that unchanged
caret. Nothing was chosen, so there is no inventory row — but the float has a consequence for
[§5](#5-audit-result): baseline `mongoose` 6.13.9 carried a **moderate** advisory (prototype pollution
in update casting via a `__proto__`-prefixed dotted path, range `< 6.13.10`) and 6.13.11 clears it.
**A moderate cleared itself with no declared change**, which is why the delivered audit shows five
moderates where the plan projected six.

**The one accommodation made instead of a bump.** Mongoose 6 emits a deprecation warning on
`connect()` about the `strictQuery` default changing in Mongoose 7. Under the warning-free clause that
would have disqualified the deferral, so the existing Mongoose 6 behaviour is pinned explicitly:

```javascript
// [T config/db.js:7-8]
// Pin Mongoose 6's existing `strictQuery` default so mongoose.connect() emits no Mongoose 7 DeprecationWarning; mongoose stays deferred at 6.x.
mongoose.set('strictQuery', true);
```

This sets the value Mongoose 6 already used, so it silences the warning without changing any query's
behaviour — the distinction that keeps it a warning fix rather than the behaviour change R-d forbids.

### 2.3 `mongoose-schema-extend` 0.2.2

| | |
|---|---|
| **Resolved** | 0.2.2 — **unchanged** from baseline |
| **Consumer** | `[T config/db.js:4]`, the sole `require`. Its capability is consumed at `[T lib/models/model.js:190-191]`, where `Model.extend` calls `schema.extend(obj.schema)` |
| **Finding** | moderate only, and **not flagged** in the delivered audit |
| **Reason** | **No successor exists.** Removing it means reworking schema inheritance across the model layer — [§3.4](#34-removing-mongoose-schema-extend) |

**This package has a global side effect that is the single most dangerous latent fact in the codebase,
and it is documented here as a constraint on future work rather than as trivia.**

Measured (**probe**, delivered tree):

```console
$ node -e "require('mongoose-schema-extend'); require('@hapi/hapi')"
THREW: AssertError: Schema can only contain plain objects
   at internals.schema (node_modules/@hapi/validate/lib/compile.js:88:5)
   ...
   at Object.<anonymous> (node_modules/@hapi/shot/lib/index.js:17:27)

$ node -e "require('@hapi/hapi'); require('mongoose-schema-extend')"
BOTH LOADED OK
```

The mechanism, isolated by instrumenting the module loader (**probe**): `mongoose-schema-extend`
requires **`harmony-reflect`**, a Proxy polyfill, which **replaces the global
`Object.getPrototypeOf`** with a non-native implementation. Once that has happened, `@hapi/validate`'s
`compile` step no longer recognises a plain object as plain, and any *subsequent* require of
`@hapi/hapi` throws as it initialises `@hapi/shot`. Verified directly:

```console
$ node -e "var b=Object.getPrototypeOf; require('mongoose-schema-extend');
           console.log('replaced:', b!==Object.getPrototypeOf)"
replaced: true
```

**The hapi 21 bump does not fix it.** The plan asserted this; it is now measured. An isolated sandbox
holding `@hapi/hapi@20.3.0`, `mongoose@6.13.11` and `mongoose-schema-extend@0.2.2` fails
**identically** — same message, same origin at `@hapi/shot/lib/index.js:17` — and loads cleanly in the
reverse order. So the framework version is irrelevant to the hazard, and nobody should expect a future
hapi upgrade to remove it.

**The containment, and what it obliges of future work.** Any module that reaches this package must
require `config/app.config` **before** `config/db`. That is why the comment at
`[T config/app.config.js:3]` is load-bearing rather than decorative — it explains why `routes` is
required before `db` in a list where the order otherwise looks arbitrary:

```javascript
// [T config/app.config.js:1-7]
var config      = require('config'),
    constants   = require('./constants'),
    // Load routes BEFORE db because mongoose-schema-extend conflicts with Joi 17
    routes      = require('./routes'),
    api_routes  = require('./api_routes'),
    routeParser = require('../lib/util/routeParser'),
    db          = require('./db'),
```

The same rule is why this migration removed **three unused `require('@hapi/hapi')` bindings** — from
`lib/util/helpers.js`, `lib/controllers/courses.js` and `lib/controllers/files.js`. None was
referenced, so all three read as cosmetic cleanups, and they are not: `config/app.config` requires
those controllers while parsing routes, so any one of them was enough to make
`lib/workers/exports.js` unrequirable. `[T app.js:21]` now holds the only live
`require('@hapi/hapi')` in the repository (static), and `require('./lib/workers/exports')` loads
cleanly (**probe**). `[T lib/controllers/courses.js:1-11]` and `[T lib/workers/exports.js:1-8]` carry
the reasoning in code so that a later reader does not re-introduce an import that looks harmless.

**Warning-free**: `require('mongoose-schema-extend')` on its own emits nothing (**probe**).

### 2.4 `highlight.js` 9.18.5

| | |
|---|---|
| **Resolved** | 9.18.5 — **unchanged** from baseline |
| **Consumer** | `[T lib/shared/trinket-markdown.js:2]`, used at `[T lib/shared/trinket-markdown.js:309-310]` to highlight fenced code blocks in authored course content |
| **Finding** | **moderate** — GHSA-7wwv-vh3v-89cq, ReDoS across multiple grammars, range `9.0.0 - 10.4.0` |
| **Reason** | Moderate-only. Under [§1](#1-the-deferral-rule) it does not qualify for a change |

**This decision is decoupled from the `marked` decision entirely, and the point is worth making
explicitly because the two are constantly assumed to move together.** They are two separate
dispositions reached for two different reasons. `marked` carries a **high** advisory that **cannot be
cleared by any available upgrade** and is retained as a named deviation
([§4.2](#42-deviation-2--the-marked-fork-is-retained)). `highlight.js` carries a **moderate** that
simply **does not qualify** under the triage rule. Neither conclusion depends on the other: if the
`marked` question were reopened tomorrow and resolved differently, `highlight.js` would still be
deferred on its own moderate-only grounds, and if `highlight.js` had carried a high it would have been
bumped regardless of `marked`. The only relationship between them is that both consumers live in the
same file.

**What was measured on 11.11.1** (**probe**, isolated sandbox). The repository calls the two-argument
form `hljs.highlight(lang, code)` at `[T lib/shared/trinket-markdown.js:310]`. On 11.11.1 that call
still functions, and prints:

```text
Deprecated as of 10.7.0. highlight(lang, code, ...args) has been deprecated.
Deprecated as of 10.7.0. Please use highlight(code, options) instead.
https://github.com/highlightjs/highlight.js/issues/2277
```

Token classes and escaping also differ for highlighted languages. Highlighting the same Python
fragment on both versions:

```text
9.18.5   <span class="hljs-function"><span class="hljs-keyword">def</span> <span class="hljs-title">f</span>…
11.11.1  <span class="hljs-keyword">def</span> <span class="hljs-title function_">f</span>(<span class="hljs-params">x</span>):…
```

`hljs-function` wrapping disappears and `hljs-title function_` and `hljs-params` appear. Since the
delivered stylesheets are built from a vendored Foundation fork against the 9.x class names, an
upgrade would change the rendered appearance of every fenced code block in every course — the same
class of client-visible change that decides the `marked` question, reached here without needing to
invoke it.

**One finding recorded against this deferral rather than passed over.** `highlight.js` 9.18.5 is
**not** silent. On the **first** `highlight()` call it prints a one-time end-of-life notice
(**probe**):

```text
Version 9 of Highlight.js has reached EOL and is no longer supported.
Please upgrade or ask whatever dependency you are using to upgrade.
https://github.com/highlightjs/highlight.js/issues/2877
```

Three measured properties determine what this means for the warning-free clause, and they are the
reason it is reported here rather than treated as a second `aws-sdk` case:

1. **It is not on the warning stream.** It is a `console.log` to **stdout**
   (`node_modules/highlight.js/lib/highlight.js:543-545`), not `process.emitWarning`, so it is neither
   a Node deprecation warning nor a line on stderr. The `aws-sdk` notice was the opposite on both
   counts, which is precisely why that one had to be addressed and this one does not breach the
   measured gate.
2. **It is emitted at most once per process**, guarded by a `showedUpgradeWarning` flag, and only on
   the first `highlight()` call — never on `require`.
3. **Suppression hooks exist and were verified to work**:
   `hljs.configure({hideUpgradeWarningAcceptNoSupportOrSecurityUpdates: true})`, or the
   `HLJS_HIDE_UPGRADE_WARNING` environment variable
   (`node_modules/highlight.js/lib/highlight.js:519-526`).

The hook is **not** applied, and the reason is a scope boundary rather than an oversight: its only
`configure()` application point is `lib/shared/trinket-markdown.js`, which the `marked` decision holds
**out of scope and unchanged**. Editing that file to silence a stdout banner would put a change into
the one file this migration undertook not to touch, for a line that the gate does not read. The
honest position is the one recorded here: the notice exists, it is on stdout, it is bounded to one
occurrence, a supported suppression exists, and applying it belongs with the follow-up in
[§4.2](#42-deviation-2--the-marked-fork-is-retained) that revisits this file deliberately.

### 2.5 `jszip` 3.6.0

| | |
|---|---|
| **Resolved** | 3.6.0 — **unchanged** from baseline |
| **Consumer** | `[T lib/controllers/trinket.js:32]`, used at `[T lib/controllers/trinket.js:1015]` and `[T lib/controllers/trinket.js:1094]` to build in-memory ZIP archives of trinket contents |
| **Finding** | **moderate** ×2 — GHSA-jg8v-48h5-wgxg (prototype pollution) and GHSA-36fh-84j7-cv5h (path traversal via `loadAsync`), range `<= 3.7.1` |
| **Reason** | Moderate-only, with a fix inside the same major (3.10.1) that the triage rule does not authorise |

Worth one note on the residual risk, since both advisories concern *reading* untrusted archives: the
two delivered call sites **construct** archives with `new JSZip()` and never call `loadAsync`, so the
path-traversal advisory has no reachable call site here. Archive *reading* in this application goes
through `adm-zip`, which the inventory moved to 0.6.0. That does not clear the advisory — the
vulnerable code is installed — and the finding is retained and counted in [§5](#5-audit-result).

### 2.6 `archiver` 2.1.1

| | |
|---|---|
| **Resolved** | 2.1.1 — **unchanged** from baseline |
| **Consumer** | `[T lib/controllers/trinket.js:26]` and `[T lib/workers/exports.js:23]`, creating the export archives the worker uploads |
| **Finding** | **none** — `archiver` carries no advisory of its own at either commit |
| **Reason** | No qualifying finding. **An earlier decision to bump it as a major is withdrawn** |

**This is the cleanest evidence in the migration that the triage rule was applied rather than
recited, so the measurement is recorded in full.** An earlier iteration of the plan bumped `archiver`
to a new major on the strength of an advisory reachable through its dependency chain. That was
inconsistent with the rule in [§1](#1-the-deferral-rule), and re-measurement showed the bump was
unnecessary as well as unauthorised.

`archiver` never carried an advisory itself. What baseline carried was a **high** on the shared
transitive `brace-expansion` — range `<= 1.1.17`, three high advisories plus one moderate — and in the
delivered production tree `archiver` is the **sole** path that reaches it (**probe**):

```console
$ npm ls brace-expansion --omit=dev --all
trinket@0.0.0
└─┬ archiver@2.1.1
  └─┬ glob@7.2.3
    └─┬ minimatch@3.1.5
      └── brace-expansion@1.1.18
```

Baseline resolved that leaf at **1.1.12**, inside the vulnerable range. Regenerating the lockfile
floated it to **1.1.18**, which is outside it, and the finding disappears from the audit entirely
while `archiver` stays at 2.1.1. So the advisory that appeared to force a major bump was cleared by
resolution alone, and `archiver` is deferred with **no** residual finding of any kind. Bumping it
would have been an unforced major-version change in the diff — exactly what R-a prohibits — justified
by an advisory that no longer existed.

### 2.7 `q` 1.0.1

| | |
|---|---|
| **Resolved** | 1.0.1 — **unchanged** from baseline |
| **Consumer** | **Exactly two** (static): `[T lib/workers/exports.js:18]`, with 14 uses — `Q.defer()` at `:51` and `:209`, and `Q.nsend(...)` at `:132`, `:135`, `:144`, `:148`, `:169` and `:193`; and `[T test/helpers/mail.js:2]`, using `Q.resolve()` at `:9` |
| **Finding** | none |
| **Reason** | Functional. Replacing it with native promises is real work outside R-a — [§3.3](#33-q--native-promises) |

A 2013 promise library, and the export worker's control flow is written in its idiom rather than
merely importing it: `Q.nsend` adapts Mongoose's callback methods and `Q.defer()` bridges the S3
callbacks, so the two are load-bearing rather than decorative.

**One related patch is deliberately kept.** `[T app.js:3-16]` adds Q-compatible `spread` and `fail`
methods to the native `Promise` prototype:

```javascript
// [T app.js:3-16] — abridged: the body of the `spread` implementation is elided
// Add Q-compatible methods to native Promise for Mongoose 6 compatibility
if (!Promise.prototype.spread) { /* … */ }
if (!Promise.prototype.fail) {
  Promise.prototype.fail = Promise.prototype.catch;
}
```

Patching a built-in prototype is not a pattern to imitate, and it is retained unchanged for exactly
the reason R-d exists: code elsewhere calls `.spread(...)` and `.fail(...)` on values that are native
promises, and removing the patch would break those call sites. It is a prerequisite of
[§3.3](#33-q--native-promises), not an independent cleanup.

### 2.8 `config` 0.4.37

| | |
|---|---|
| **Resolved** | 0.4.37 — **unchanged** from baseline |
| **Consumer** | **43** `require('config')` sites (static): **29** under `lib/` — the controllers, models, utilities and the worker — **8** under `config/` including `[T config/app.config.js:1]`, and **6** under `test/`. `app.js` reaches it indirectly, through `[T app.js:26]`'s require of `config/app.config` |
| **Finding** | none |
| **Reason** | Functional, and no qualifying finding. Replacing it would touch all 43 |

The YAML configuration-layering library that provides the `default.yaml` / `{NODE_ENV}.yaml` /
`local.yaml` overlay the whole application and both parity harnesses depend on. It is very old, and
under [§1](#1-the-deferral-rule) age is not a reason: it works on Node 22, it emits nothing, and it
carries no advisory. A replacement would be a 43-site change with a configuration-precedence surface
that every gate in this migration depends on — the overlay mechanism is how the parity harnesses
apply `NODE_CONFIG` to both worktrees without editing either.

### 2.9 Six small packages, each with a live consumer and no qualifying finding

Deferred for the same reason and recorded compactly. Every version is **unchanged** from baseline, and
each consumer below is an invocation site, not merely an import (static):

| Package | Resolved | Live consumer | Purpose |
|---|---|---|---|
| `escape-string-regexp` | 1.0.5 | `[T lib/models/trinket.js:5]`, called at `:269` — `new RegExp(escStrRegexp(term), 'i')` | Escapes user search terms before regex construction |
| `limax` | 1.4.1 | `[T lib/models/plugins/slug.js:4]` called at `:18`; `[T lib/controllers/files.js:9]` called at `:118`; `[T lib/controllers/trinket.js:31]` | URL slug generation |
| `node-cryptojs-aes` | 0.4.0 | `[T lib/util/roles.js:2]`, called at `:11` — `CryptoJS.AES.encrypt(...)` | Role-token encryption |
| `numeral` | 1.5.6 | `[T lib/util/nunjucks.js:6]`, exposed to the template environment at `:131` | Number formatting in rendered views |
| `tab` | 0.1.0 | `[T lib/util/routeParser.js:3]`, called at `:515` — `mod_tab.emitTable(...)` | Renders the route-table CLI output, which is itself a parity gate |
| `transliteration` | 0.1.1 | `[T lib/models/plugins/slug.js:5]`, called at `:21` | Transliterates non-Latin titles before slugging |

`tab` deserves one note: its output is not incidental. The route-table CLI is gated for
**byte-identical** output against baseline across all three invocation forms, so `tab` is a package
whose formatting behaviour a gate depends on — a further reason not to move it.

### 2.10 Verified unchanged — the maintained packages that needed nothing

Not "deferred" in the unmaintained-but-functional sense: these are current, maintained packages that
required no action. They are recorded so that the inventory's silence about them reads as a
measurement rather than an omission. Each resolves to the **same version before and after** (static,
both lockfiles):

| Package | Resolved (both trees) |
|---|---|
| `@hapi/vision` | 7.0.3 |
| `@hapi/yar` | 11.0.3 |
| `@hapi/boom` | 10.0.1 |
| `nunjucks` | 3.2.4 |
| `redis` | 4.7.1 |
| `winston` | 3.19.0 |
| `moment` | 2.30.1 |
| `underscore` | 1.13.8 |

**The committed baseline lockfile already carried current versions for five of the seven `@hapi/*`
packages**, which is why this migration does not describe them as bumps: `@hapi/boom`,
`@hapi/vision`, `@hapi/yar`, `@hapi/hoek` and `@hapi/catbox-redis` were already current at
`2f8712a`. Only `@hapi/hapi` and `@hapi/inert` moved, and both are the inventory's business.

The last two of those five are worth one sentence, because they are the
[§1](#1-the-deferral-rule) criterion doing its job on packages that looked current and harmless:
`@hapi/hoek` and `@hapi/catbox-redis` had **no consumer in retained source** — the session cache is
the Mongoose-backed catbox engine, not Redis — so their **declarations were removed** rather than
deferred. Being current is not a reason to keep a declaration nothing uses. `@hapi/hoek` 11.0.7 is
still present in the tree as a transitive of the `@hapi/*` packages and `joi`, which is a different
thing from being declared.

**None of the retained `@hapi/*` plugins declares a `peerDependencies` entry on `@hapi/hapi`**
(**probe** — measured `null` for `@hapi/vision`, `@hapi/yar`, `@hapi/boom` and `@hapi/inert`). That is
load-bearing in both directions: nothing forced these plugins to move when the framework did, and
equally, npm would not have warned had an incompatible combination been selected. The plugins were
verified to register unchanged on 21.4.10 by execution rather than by trusting a peer range that does
not exist.

## 3. Deferred migrations — the work deliberately not done

Four genuine modernization projects are **not** part of this delivery. Each is real work outside
R-a's four permitted categories, and each is recorded with what would have to change and what would
gate it, so that a future team can pick it up without re-deriving the analysis.

### 3.1 AWS SDK v2 → v3

- **Why deferred.** v3 is a different client: modular packages, a command-object API, and different
  response envelopes. The change is a storage-layer rewrite, not a dependency swap, so it falls
  outside R-a. The residual finding is **moderate** and, as [§2.1](#21-aws-sdk-216930) records,
  inherited from `uuid` rather than intrinsic. The end-of-support notice is addressed through the
  SDK's own supported suppression instead.
- **What would need to change.** The eight call sites enumerated in [§2.1](#21-aws-sdk-216930):
  seven S3 operations across `lib/util/file.js`, `lib/controllers/users.js` and
  `lib/workers/exports.js`, plus the client construction in `config/aws.js`. Each callback-style
  `client.putObject({...}, cb)` becomes an `await client.send(new PutObjectCommand({...}))`, and
  `getSignedUrl` moves to `@aws-sdk/s3-request-presigner`. Streaming bodies change type, which reaches
  the snapshot and export paths.
- **What would gate it.** The storage contract cases in `test/parity/storage.js`, which assert the
  exact sha1 object keys, the suffix and extension branches, the content-type override, avatar
  gating, bucket selection and the export `s3Key`. Because the upload key is a **content hash**, any
  change to how bytes reach the SDK must be proven not to change the digest: a changed key silently
  orphans every stored object with no error. The worker harness additionally covers the export
  upload and download paths.
- **The real reason to do it.** Not the advisory — the absence of future security patches for an
  end-of-support SDK.

### 3.2 Mongoose 6 → 7+

- **Why deferred.** Outside R-a, and the delivered 6.13.11 carries **no** finding at all
  ([§2.2](#22-mongoose-61311)), so nothing qualifies it under the triage rule. The one warning it did
  emit is pinned rather than chased.
- **What would need to change.** Mongoose 7 removes callback support from every model and query
  method, which is the idiom this codebase is written in across 30 consumer modules — and it is the
  same idiom `Q.nsend` adapts in the worker, so [§3.3](#33-q--native-promises) is entangled with it.
  `strictQuery` becomes the default and the explicit `mongoose.set('strictQuery', true)` at
  `[T config/db.js:8]` becomes redundant. `mongoose-schema-extend` does not support Mongoose 7, so
  [§3.4](#34-removing-mongoose-schema-extend) is a **prerequisite**, not a parallel task.
- **What would gate it.** The full existing suite, the request corpus over all 233 routes, and the
  storage and worker harnesses — every persistence path in the application is implicated.

### 3.3 `q` → native promises

- **Why deferred.** Outside R-a. `q` 1.0.1 is functional and carries no finding.
- **What would need to change.** The two consumers in [§2.7](#27-q-101) — principally the export
  worker's control flow, where `Q.defer()` bridges S3 callbacks and `Q.nsend` adapts Mongoose's
  callback methods at seven sites. Then the `Promise.prototype` patch at `[T app.js:3-16]` can be
  removed, but **only after** every `.spread(...)` and `.fail(...)` call site on a native promise has
  been converted; removing the patch first breaks them silently, since both would become
  `undefined is not a function` at runtime rather than at load.
- **What would gate it.** The worker harness in `test/parity/worker.js`, which drives one successful
  and one failing export job and asserts status, progress and error persistence onto the `Export`
  document, the archive layout, the `s3Key`, the notification mail and cleanup on both paths. The
  failure path matters most: `Q`'s rejection propagation is what currently routes a failed job to its
  persisted `status: 'failed'`.

### 3.4 Removing `mongoose-schema-extend`

- **Why deferred.** **No successor exists.** The package is required at `[T config/db.js:4]` and its
  `schema.extend` capability is consumed at `[T lib/models/model.js:190-191]`, where `Model.extend`
  builds the schema-inheritance mechanism the model layer is constructed on. Removing it is not a
  dependency swap; it is a redesign of how models inherit.
- **What would need to change.** `Model.extend` would be rebuilt on Mongoose's native
  **discriminators**, which is the successor concept but not a drop-in: discriminators add a
  discriminator key to stored documents and change how queries scope across the inherited set. That
  makes it a **persisted-data** change, not only a code change — which is why it cannot be done
  casually against an existing database. The `// TODO: Migrate to native mongoose discriminators`
  note at `[T config/db.js:3]` is baseline's own record of the intent and is preserved as it stands.
- **What would gate it.** Model-level tests plus a migration story for existing documents, since the
  stored shape changes. The corpus would need re-capture against seeded pre-migration records.
- **The prize, and it is not the advisory.** Removing this package removes the
  `harmony-reflect` global `Object.getPrototypeOf` replacement documented in
  [§2.3](#23-mongoose-schema-extend-022) — and with it the load-order hazard that currently makes an
  unused `require('@hapi/hapi')` in the wrong file enough to break the export worker. That hazard,
  not the moderate finding, is the reason this item is worth doing.


## 4. The two approved deviations

These are the **only** two places in the migration where something is deliberately **not** preserved
or **not** delivered as the request specified. Both are approved, both are argued, and neither is a
placeholder.

**Numbering follows [`preserved-quirks.md`](preserved-quirks.md) §11**, which is the canonical
statement of both: **deviation 1** is the never-settling file response, **deviation 2** is the
`marked` fork. That document owns deviation 1 in full and assigns the full reasoning for deviation 2
to this one, so the two are recorded here in that order and at those depths. A divergence between the
two documents would itself be a defect, so the wording below is aligned deliberately rather than
paraphrased.

### 4.1 Deviation 1 — the never-settling file response

`[B lib/controllers/files.js:98-100]` never settles: the image-download branch of `files.download`
calls `reply(stream).type(...).bytes(...)` with no `return` and no resolving call, so the request
hangs indefinitely. **R-d requires that the outcome be preserved. R-b requires that every route
serve. Both cannot hold.** The decision is that **the target serves the stream response, and R-b
controls** — the migrated branch returns
`h.response(stream).type(request.pre.file.mime).bytes(request.pre.file.size)` at
`[T lib/controllers/files.js:171-173]`, with `Content-Disposition` still omitted. The corpus records
the baseline result as an expected timeout and the target result as a 200 stream response, so the
replay diff reports an approved change rather than a failure.

**The full argument — the three reasons R-b controls, the sibling branch that supplies the intended
response, and the gate — is owned by [`preserved-quirks.md`](preserved-quirks.md) §11.1 and is not
duplicated here.**

Two things about it do belong here, because they concern this document's subject matter:

**It is not an audit deviation.** It changes no dependency, clears no advisory and appears nowhere in
[§5](#5-audit-result). It is recorded in this file only so that the migration's complete set of
approved deviations can be read in one place; the single deviation that affects the audit result is
[§4.2](#42-deviation-2--the-marked-fork-is-retained).

**The two deviations resolve in opposite directions, and that is deliberate.** In this one, **R-b
overrides a prohibition-shaped preservation**: R-d would have preserved a non-response, and R-b's
requirement that every route serve wins. In [§4.2](#42-deviation-2--the-marked-fork-is-retained), a
**prohibition overrides a validation target**: R-d and the PRESERVE clause win over the zero-
critical/high audit gate. Read as a pair without their reasoning, that looks inconsistent — R-d loses
once and wins once. It is not, and the distinguishing fact is what is being protected in each case:

> **An absent response is not a behaviour a client can rely on. Rendered output is.**

R-d's protection exists for clients that may depend on observable behaviour. A request that never
settles produces no observable behaviour to depend on, so preserving it protects nobody while
violating R-b's unqualified requirement that routes serve. Authored course content rendering
identically for every reader is the opposite: it is observable, it is depended upon, and it is exactly
what the PRESERVE clause on client-visible page behaviour names. The asymmetry is a consequence of
applying one principle consistently, not of applying two.

### 4.2 Deviation 2 — the `marked` fork is retained

**This is the most consequential decision in the dependency work, and this document owns it.**

| | |
|---|---|
| **Package** | `marked`, a **private Git dependency** declared `git+https://github.com/trinketapp/marked.git` at `[T package.json:36]`, resolving to a fork of upstream **0.3.2** at commit `55ea824` |
| **Consumer** | `[T lib/shared/trinket-markdown.js:1]`, the sole `require('marked')`. That module's sole requirer is `[T lib/controllers/courses.js:24]`, which renders authored course content |
| **Finding** | **high** — range `<= 4.0.9`, `fixAvailable: false`. Eight advisories, of which four are high, the governing one being ReDoS in the inline-token regexes |
| **Decision** | **Retained.** The residual high is a named, justified deviation from the request's audit gate |

**Why the fork exists.** Upstream 0.3.2's `sanitize` option is a boolean. The fork makes it accept a
**function**, which is what `[T lib/shared/trinket-markdown.js:211-212]` supplies — a tag-whitelist
sanitizer that inspects each HTML tag as it is emitted. The fork is 70 changed lines against upstream
0.3.2. The repository also uses `marked` in ways that constrain any replacement (static): it calls
**`marked(src)` as a function** at `[T lib/shared/trinket-markdown.js:471]`, and it patches
`marked.Renderer.prototype.code`, `.image` and `.link` at `:22-24` and `:446-448`, plus `.listitem`
at `:455`.

#### The three routes evaluated, and why each failed

**Route 1 — upstream `marked` 4.0.10 with the first-class `sanitizer` option. Tested and rejected.**
4.0.10 is the first release above the vulnerable range, and upstream 4 offers the fork's capability
as a supported `sanitizer` option, so this looked like the clean answer. Measured against the
repository's actual configuration it fails twice over.

First, it emits this on **every parse**:

```text
marked(): sanitize and sanitizer parameters are deprecated since version 0.7.0
```

That breaches the zero-deprecation-warning requirement on the application's most-used content path —
every rendered course page — and it cannot be silenced without abandoning the sanitizer that is the
entire reason for using it.

Second, the rendered output **differs**, in four named ways:

1. **heading `id` attributes**
2. **task-list `<input disabled type="checkbox">` markup**
3. **`javascript:` links reduced to bare text**
4. **mixed nested-list structure**

Each is a client-visible change to already-authored course content. And separately, **`marked` is no
longer callable as a function** in 4.x, so `[T lib/shared/trinket-markdown.js:471]` would have to
change even before any of the above were addressed.

**Route 2 — replacing the sanitization layer with a maintained parser plus a dedicated HTML
sanitizer.** This clears the advisory properly and is the architecturally correct end state. It is
also a **rewrite of the sanitization layer**, outside R-a's four categories, with a rendering surface
**at least as large** as route 1's — a different parser and a different sanitizer means every one of
the four differences above is in play again, plus whatever the new sanitizer does differently with the
tag whitelist.

**Route 3 — a parity-preserving security backport onto the fork.** Not established as feasible. The
advisory is in `marked`'s **own inline-token regexes**, and the fork's 70 changed lines sit in
**exactly that region**. A backport would therefore be a hand-patch of the vulnerable regular
expressions with **no upstream reference to validate against** — the upstream fix applies to a
substantially rewritten lexer that does not exist in this fork. That is security-critical regex work
performed blind, which is a worse risk than the one it would close.

#### The decision and the precedence argument

**Decision: retain the fork.** The precedence argument is explicit, and it is the reason this is a
decision rather than an evasion:

> **R-d** ("behavior improvements PROHIBITED") and the **PRESERVE** directive on client-visible page
> behaviour are **prohibitions**. The zero-critical/high audit result is a **validation target**.
> **When a prohibition and a target collide, the prohibition controls.**

The justification for that ordering is a comparison of what each failure costs. Violating the
prohibition means **authored course content rendering differently for every user** — silently, across
every course in the platform, in the four specific ways measured above, with no error and no signal
that anything changed. Missing the target means **a documented, bounded risk** that a reader can
locate, size and act on. The first is an unbounded, invisible regression in the product's core
content; the second is a known exposure with a named follow-up. A migration whose stated purpose is to
change the runtime without changing behaviour cannot rationally choose the first.

#### The exposure, stated so a reader can judge it independently

The residual risk is **ReDoS** — a crafted input causing catastrophic regex backtracking and consuming
CPU — through the eight advisories on `marked <= 4.0.9`.

What bounds it:

- **The input is authored, not anonymous.** The parse path is course content written by **course
  creators**, reached through a single consumer at `[T lib/controllers/courses.js:24]`. It is not an
  anonymous public submission endpoint, so an attacker needs course-authoring access.
- **The consumer surface is one module.** `[T lib/shared/trinket-markdown.js]` is the only module that
  requires `marked`, so the exposure has exactly one entry point to reason about or to guard.

What does **not** bound it, stated so the risk is not understated:

- Course-authoring access is not equivalent to trusted access. Anyone who can create a course can
  reach the parser.
- ReDoS is a **denial-of-service against the Node process**, which is single-threaded; a successful
  input degrades or stalls the server for **all** users, not only the author's own session.
- There is **no fix available** (`fixAvailable: false`), so this does not resolve by waiting, and it
  will not be cleared by a routine dependency refresh.
- Eight advisories are involved, four of them high. The retained fork predates all of them.

#### The named follow-up that would close this deviation

**Rebase the fork onto a current parser under a rendering-parity review**, as separate work with its
own approval. Concretely: take a maintained parser, reimplement the tag-whitelist sanitizer against
its extension API, and gate the result on a **rendering-parity corpus** built from real authored
course content — the four measured differences above are the minimum the review must cover, and it
must additionally confirm the function-call form and the three renderer-prototype patches are
satisfied by supported extension points. `[T lib/shared/trinket-markdown.js]` and the
`highlight.js` question in [§2.4](#24-highlightjs-9185) belong to that same piece of work, since both
consumers live in that file.

**This is a decision, not a placeholder.** The follow-up is what would close the deviation; the
deviation is not conditional on it being scheduled.

#### Consequences, aligned across the delivery

Retaining the fork has three consequences that are recorded consistently everywhere they appear:

1. **`lib/shared/trinket-markdown.js` is out of scope and unchanged** — verified: `git diff` against
   `2f8712a` for that path is empty.
2. **`highlight.js` stays at 9.18.5** and is deferred on its **own** moderate-only grounds
   ([§2.4](#24-highlightjs-9185)). It is not a consequence of this decision, and the two are decoupled;
   the only thing they share is the file their consumers live in.
3. **The audit result is 1 high, with that high named and attributed** to `marked`
   ([§5](#5-audit-result)), and the gate is reported as **not met** ([§6](#6-the-stated-gate-is-not-met)).

## 5. Audit result

`npm audit --omit=dev`, measured on both trees with `node v22.23.2` / `npm 10.9.8`. The baseline
figure was taken by auditing the baseline manifest and lockfile with `--package-lock-only`; the
delivered figure against the installed tree.

| | Critical | High | Moderate | Total |
|---|---|---|---|---|
| Baseline `2f8712a` | **15** | **28** | **16** | **59** |
| Delivered | **0** | **1** | **5** | **6** |

The six remaining findings, each attributed to a named package with its risk note:

| Package | Severity | Direct | Advisory | Why it is retained | Risk note |
|---|---|---|---|---|---|
| `marked` | **high** | yes | 8 advisories, range `<= 4.0.9`; governing one is ReDoS in the inline-token regexes. `fixAvailable: false` | The approved deviation in [§4.2](#42-deviation-2--the-marked-fork-is-retained) — no upgrade preserves the rendered output | ReDoS over course-creator-authored markdown through one consumer; a successful input stalls the single-threaded process for all users. No fix available |
| `aws-sdk` | moderate | yes | Own advisory is **low** (GHSA-j965-2qgj-vjmq, `region` parameter validation); the moderate rating arrives via `uuid` | v3 is a storage-layer rewrite outside R-a ([§3.1](#31-aws-sdk-v2--v3)) | `region` comes from committed configuration at `[T config/aws.js:11]`, not from request input, so the low advisory has no request-reachable path. The real risk is the absence of future patches for an end-of-support SDK |
| `bull` | moderate | yes | No own advisory; the finding arrives entirely via `uuid` | Already moved to 4.16.5 by the inventory; the residual is transitive and no further bump clears it | Bounded by the `uuid` note below. The queue is internal and not driven by request input |
| `highlight.js` | moderate | yes | GHSA-7wwv-vh3v-89cq, ReDoS across multiple grammars, range `9.0.0 - 10.4.0` | Moderate-only, so the triage rule defers it; an upgrade also changes token classes ([§2.4](#24-highlightjs-9185)) | ReDoS on the same authored-content path as `marked`, reached only for fenced code blocks in a language `hljs` recognises |
| `jszip` | moderate | yes | GHSA-jg8v-48h5-wgxg (prototype pollution) and GHSA-36fh-84j7-cv5h (path traversal via `loadAsync`), range `<= 3.7.1` | Moderate-only ([§2.5](#25-jszip-360)) | Both delivered call sites **construct** archives and never call `loadAsync`, so the path-traversal advisory has no reachable call site here |
| `uuid` | moderate | **no** — via `aws-sdk` and `bull` | GHSA-w5hq-g745-h8pq, missing buffer bounds check in v3/v5/v6 when `buf` is provided, range `< 11.1.1` | Transitive to two deferred packages; `npm` offers only a breaking downgrade of `aws-sdk` to 1.18.0 | The advisory requires the caller to pass a `buf` argument to v3/v5/v6. Neither consumer's use is request-controlled, and no application code calls `uuid` directly |

Every finding above is deferred by a decision recorded in this document. None is unaccounted for, and
none is a surprise.

## 6. The stated gate is not met

**The request's stated gate was zero critical and zero high findings. This delivery does not meet it.**

It delivers **zero critical and exactly one high**. The single high is `marked`.

The gate is **not** redefined here, and **no exception is granted** to this delivery by this delivery.
The shortfall is what it is: a **single named, justified, single-package deviation from a stated
requirement**, whose reasoning and precedence argument are in
[§4.2](#42-deviation-2--the-marked-fork-is-retained) and whose exposure is stated there in terms a
reader can size independently — and it is delivered **together with the follow-up that would close
it**, rather than as an open question.

**Any *additional* critical or high finding is a failure**, not a deviation. The tolerance is exactly
one, it is attributed to exactly one package, and nothing else inherits it.

### A methodological warning that changed how this list was built

An early iteration of the candidate package list was resolved and audited and **passed**. A later
re-resolution of the **same list** produced **three new highs**, from advisories published in the
interval.

That is why **the gate, not the list, is the contract.** Two consequences follow, and both bind anyone
maintaining this record:

1. Re-run `npm audit --omit=dev` rather than trusting the figures in [§5](#5-audit-result) to have
   aged well. A version that cleared a finding when measured is a *minimum that cleared it then*, not
   a permanently sufficient version.
2. A newly implicated package triggers a **mapping revision** — its own compatibility and parity
   analysis before any version moves — and **not** blanket authority to take whatever `fixAvailable`
   names. `npm` currently proposes downgrading `aws-sdk` to **1.18.0** to clear the `uuid` moderate,
   which would be a catastrophic "fix"; that is what following `fixAvailable` blindly looks like.

## 7. Measurement notes

Every figure in this document was measured against the delivered tree. Four measurements disagreed
with the plan's projected values, and in each case **the measurement is what is recorded above**.
[`dependency-inventory.md`](dependency-inventory.md) §8 keeps the corresponding log for the changed
set; these are the four that bear on the deferred set.

| # | Expected | Measured | Nature |
|---|---|---|---|
| 1 | 6 moderate findings, including `mongoose` | **5 moderate**; `mongoose` is **not flagged** | Substantive. The advisory range is `< 6.13.10` and lockfile regeneration floated `mongoose` 6.13.9 → **6.13.11** inside its **unchanged** `^6.0.0` declaration. A moderate cleared itself with no declared change, which is why the total is 6 rather than 7 and why `mongoose` has no inventory row ([§2.2](#22-mongoose-61311)) |
| 2 | `mongoose` 6.13.9 | **6.13.11** | Caret float, as above. No decision changed |
| 3 | `marked`'s sole consumer at `lib/controllers/courses.js:13` | The `require('marked')` is at **`lib/shared/trinket-markdown.js:1`**; `lib/controllers/courses.js` requires *that* module at **`:24`** | Locator correction. Both facts are recorded in [§4.2](#42-deviation-2--the-marked-fork-is-retained) so the two-step chain is visible rather than collapsed |
| 4 | `mongoose-schema-extend` required at `lib/models/model.js:190-191` | The `require` is at **`config/db.js:4`**; `lib/models/model.js:190-191` is where the **capability** is consumed | Locator correction. The distinction matters, because the require site is what determines load order and therefore the hazard in [§2.3](#23-mongoose-schema-extend-022) |

Three further notes, recorded because they bear on how the figures above should be read:

- **The `aws-sdk` maintenance-notice suppression was verified rather than assumed.** The plan listed it
  as unproven on 2.1693.0 with a literal-match fallback held in reserve. It works
  ([§2.1](#21-aws-sdk-216930)), so the fallback is not in force and the gate asserts the notice's
  absence.
- **"The hapi 21 bump does not fix the `mongoose-schema-extend` hazard" is now measured, not
  inherited.** An isolated sandbox at `@hapi/hapi@20.3.0` fails identically to 21.4.10, with the same
  message and the same origin ([§2.3](#23-mongoose-schema-extend-022)).
- **`highlight.js` 9.18.5's stdout end-of-life notice is a finding this document adds.** It is recorded
  in [§2.4](#24-highlightjs-9185) with the three measured properties that determine why it does not
  breach the zero-deprecation-warning gate, and with the suppression hook that exists but has no
  in-scope application point. It appears in neither the plan nor the companion documents.

**Cross-document alignment.** The two approved deviations in [§4](#4-the-two-approved-deviations) are
required to read identically here, in [`preserved-quirks.md`](preserved-quirks.md) §11 and in
[`baseline-parity.md`](baseline-parity.md). The comparison against `preserved-quirks.md` §11 was
**performed** for this document and the two agree, on the numbering, on deviation 1's decision and
target expression, and on deviation 2's decision, the four rendering differences and the assignment of
the full reasoning to this file. `preserved-quirks.md` recorded that check as *pending* because this
file did not yet exist; that leg is now settled. The third leg remains **pending**:
`baseline-parity.md` has not yet been generated, and the check is a direct comparison of the same two
statements against it once it exists.

---

*Navigation note, recorded rather than acted on: `mkdocs.yml` is out of scope for this migration and
its `nav:` lists only `index.md`, `setup.md` and `overview.md`, so this document is not part of the
rendered documentation site. If these migration documents should be published there, adding them is a
separate, deliberate change.*
