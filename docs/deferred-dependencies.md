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
`node v22.23.2` / `npm 10.9.8` — that being the scope of the request's gate, with the dev-inclusive
scope used only where it is named as such, in
[§2.11](#211-six-development-dependencies-retained-behind-their-current-lines), and the
`--package-lock-only` scope only in
[§2.12](#212-residual-advisories-in-the-four-serversidemanager-graphs); consumer claims from search
over the repository's `*.js` files
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

**"Moderate-only" is a deferral, not an oversight.** Five of the packages below carry a live moderate
advisory — `aws-sdk`, `mongoose`, `highlight.js`, `jszip` and, transitively through two of them,
`uuid`. Under a rule that bumped on any finding they would all have moved majors, and the diff would
no longer read as the four things R-a permits. (`bull` also carries a residual moderate, but it is a
**moved** package with an inventory row, not a deferred one; its finding arrives entirely through
`uuid` and no further bump clears it.)

**The rule has four axes, and a package must pass all four.** A deferral is licensed only when the
package carries no critical or high advisory *and* is compatible *and* is warning-free *and* is
actually consumed. Checking one axis and stopping is the failure mode this list is most prone to, and
[§2.6](#26-archiver-211) is the worked example — of that failure mode, and of what follows from it.
`archiver` was deferred here on a correct reading of its advisory position, and nobody had measured
whether it ran correctly or quietly on Node 22. It does neither. It is therefore the one entry in
this list that **fails an axis of the rule and is retained anyway**: the frozen plan's disposition
governs the package — AAP §0.5.1.2 records the earlier major bump as withdrawn and instructs that it
not be reintroduced — and every remedy measurement identified would have changed **persisted archive
bytes**, which R-d prohibits and R-f resolves in favour of the baseline. Failing an axis is thus not
a licence to move a package on this document's own authority. What it obliges is that the failure be
recorded as an **open shortfall** with its measurement, which is what
[§2.6](#26-archiver-211) does.

**"No runtime deprecation warning" is the clause with teeth.** The request's own wording is that a
package unmaintained but still functioning *correctly and warning-free* is left in place. The words
**"warning-free"** are load-bearing: deferring a package is permitted, but leaving it printing to the
process's warning stream is not, because the same request sets a zero-deprecation-warning gate over
the entire running application. That clause is what forced the `aws-sdk` end-of-support notice to be
addressed rather than tolerated ([§2.1](#21-aws-sdk-216930)), and it is why
[§2.4](#24-highlightjs-9185) reports a notice that a less careful reading would have passed over in
silence.

**That clause is breached by exactly one package, and the breach is carried rather than closed.**
`archiver` 2.1.1 emits a measured **DEP0005** deprecation warning on the warning stream, from
`compress-commons@1.2.2` at module load — one warning, at load, off the request path, from a
transitive dependency, with no package-level suppression hook. The remedy that measurement identified
was "a decision about `archiver`", and that decision is a **dependency change the frozen plan
withdrew**: AAP §0.5.1.2 records the earlier archiver major bump as withdrawn and instructs that it
not be reintroduced, and AAP §0.5.1.4 and §0.7 authorize exactly **two** deviations for this
migration, neither of which is a deprecation warning. So the breach is neither remedied nor excused.
It is recorded here as an **unresolved shortfall against the zero-deprecation-warning gate, with no
deviation status granted** — this document has no authority to grant one, and does not invent one.
The measurement, the chain, the **three** remedies that were tested and why each is unavailable are
in [§2.6](#26-archiver-211).

**So this delivery leaves exactly one warning outstanding, from one retained package, named and
attributed — and it has exactly two approved deviations**
([§4](#4-the-two-approved-deviations)). Both deviations were argued and approved in advance, and the
`archiver` warning is **neither of them**: an outstanding warning with no approved remedy is a
shortfall against a validation target, not an approved departure from behaviour.
[`baseline-parity.md`](baseline-parity.md) owns the shortfall register and is required to record this
one as open; where it still carries the superseded reading in which a version move closed the warning,
the divergence is logged in [§7](#7-measurement-notes) rather than rewritten from here, because that
document is not this one's to edit.

The result is measured on the delivered tree under the gate's own flags, `node
--pending-deprecation --trace-deprecation`: boot emits **exactly one** warning line, the `[DEP0005]`
above, after which the server still starts and `GET /` answers **200**; the storage harness
**captures that same warning** and fails its `archive-layout` case, closing **34 of 35** cases and
emitting one finding; and the worker harness, which drives real jobs through `archiver` itself,
reports **1 notice with 0 allowed** and so fails the zero-warning policy — though that is **not** the
only reason it fails: it closes **92 of 109** checks with **17** failing, and 16 of those 17 belong to
the `q`/Mongoose retention in [§2.7](#27-q-101) rather than to `archiver`. An earlier revision of this
paragraph recorded 109 of 110 with every functional assertion passing, which the gate's own artifact
contradicts. Every other entry in
[§2](#2-the-deferred-but-functional-list) either emits nothing or has had its notice addressed;
[§2.6](#26-archiver-211) is the single exception, and it is the reason this paragraph does not read
as a clean pass.

## 2. The deferred-but-functional list

**Fourteen** production packages are deferred here, across
[§2.1](#21-aws-sdk-216930) to [§2.9](#29-six-small-packages-each-with-a-live-consumer-and-no-qualifying-finding)
— eight recorded individually and six compactly in
[§2.9](#29-six-small-packages-each-with-a-live-consumer-and-no-qualifying-finding). Each entry gives
the resolved version, the live consumer, the reason, and — where one exists — the accommodation made
instead of a version move. [§2.6](#26-archiver-211) is an ordinary member of that list: `archiver` is
retained at 2.1.1, the frozen disposition, and its entry is the one that also records two open
shortfalls, because it is the single deferral that fails an axis of
[§1](#1-the-deferral-rule)'s rule.

Three further sub-sections in this chapter are **not** part of that fourteen, and are numbered here
because they belong to the same "what did not change" question:
[§2.10](#210-verified-unchanged--the-maintained-packages-that-needed-nothing) records maintained
packages that needed nothing at all;
[§2.11](#211-six-development-dependencies-retained-behind-their-current-lines) records the six
**development** dependencies retained behind their current lines; and
[§2.12](#212-residual-advisories-in-the-four-serversidemanager-graphs) records the residual
advisories in the four `serverside/*/manager` graphs, which are deferred in place rather than cleared.

`marked` is a **fifteenth** deferred production package. Because retaining it is an approved deviation
from the request's audit gate rather than an ordinary application of the rule above, it is recorded in
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
`[T lib/workers/exports.js:382]`; `getObject` at `[T lib/util/file.js:83]`,
`[T lib/util/file.js:200]` and `[T lib/workers/exports.js:59]`; `deleteObject` at
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

**One note on the shortened URL in that transcript, recorded outside the quotation because the
quotation is the SDK's own output and is reproduced byte for byte.** An automated link check reports
that URL as a 404, and the 404 is an artifact of how link checks probe rather than a dead link.
Measured (**probe**):

```console
$ curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' https://a.co/cUPnyil
301 https://aws.amazon.com/blogs/developer/announcing-end-of-support-for-aws-sdk-for-javascript-v2/
$ curl -sL -o /dev/null -w '%{http_code} %{url_effective}\n' https://a.co/cUPnyil
200 https://aws.amazon.com/blogs/developer/announcing-end-of-support-for-aws-sdk-for-javascript-v2/
$ curl -s -I -o /dev/null -w '%{http_code}\n' https://a.co/cUPnyil
404
```

The shortener answers a **`GET` with a 301** to the destination and a **`HEAD` with a 404** — and a
`HEAD` is exactly how automated link checking probes — so the short URL resolves for any reader who
follows it, and the destination returns 200 both through the redirect and fetched directly. The
citable authoritative reference, stated here rather than substituted into the quotation, is
`https://aws.amazon.com/blogs/developer/announcing-end-of-support-for-aws-sdk-for-javascript-v2/`.
The short form stays as the SDK printed it: it is quoted output, and rewriting a URL inside it would
misrepresent what the process emitted.

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

### 2.2 `mongoose` 6.13.9

| | |
|---|---|
| **Resolved** | **6.13.9** — identical to baseline; the declaration `^6.0.0` is **unchanged** |
| **Consumer** | The whole model layer: 30 `require('mongoose')` sites, including `[T config/db.js:1]`, `[T lib/models/model.js]` and every model module |
| **Finding** | one **moderate** — prototype pollution in update casting via a `__proto__`-prefixed dotted path, range `< 6.13.10` |
| **Reason** | Moderate-only, so the triage rule defers it; Mongoose 7+ is outside R-a |

**A version float was corrected here, and the correction is the point.** An interim delivery let
lockfile regeneration carry the resolution from 6.13.9 to **6.13.11** inside the unchanged `^6.0.0`
caret. Nothing had been chosen, and nobody had checked what the newer patch changed — but the float
was not harmless in either direction. It silently altered the runtime of the entire model layer
without the compatibility and parity analysis this document requires of any version move, and it
cleared the moderate advisory above, so the delivered audit reported **five** moderates where the
frozen plan specifies six. A cleared advisory is a good thing to want and a bad thing to acquire by
accident: taking it this way would have meant reporting a different audit result from the agreed one
and calling a floated lockfile the authority for changing it.

The resolution is therefore pinned back to **6.13.9** while the declaration stays `^6.0.0`, which
restores both the baseline model runtime and the expected audit figure. The advisory is recorded in
[§5](#5-audit-result) as one of the six, with its risk note. Deferring Mongoose 6 at a version with a
live moderate is exactly what the rule in [§1](#1-the-deferral-rule) prescribes; clearing it belongs
to the Mongoose 7+ migration in [§3.2](#32-mongoose-6--7), where it can be done deliberately.

Note for anyone regenerating the lockfile: `npm install` will float this to the newest 6.x again,
because the declaration is a caret. Re-check `mongoose` in the lockfile after any regeneration, as
[the inventory's §9](dependency-inventory.md) records for the `marked` resolution.

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
holding `@hapi/hapi@20.3.0`, `mongoose@6.13.x` and `mongoose-schema-extend@0.2.2` fails
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
cleanly (**probe**). `[T lib/controllers/courses.js:1-11]` and `[T lib/workers/exports.js:1-12]` carry
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
| **Consumer** | `[T lib/controllers/trinket.js:32]`, with **four** call sites (static, `grep -rn JSZip lib/` and `grep -rn loadAsync lib/`, which between them return that `require`, one comment at `:1019`, and the four calls): archives are **constructed** with `new JSZip()` at `:1015` and `:1094`, and **read** with `zip.loadAsync(request.payload.zipCode, { base64: true })` at `:1028` and `:1102` |
| **Finding** | **moderate** ×2 — GHSA-jg8v-48h5-wgxg (prototype pollution) and GHSA-36fh-84j7-cv5h (path traversal via `loadAsync`), range `<= 3.7.1` |
| **Reason** | Moderate-only, with a fix inside the same major (3.10.1) that the triage rule does not authorise |

**The residual risk is request-reachable, and that is recorded rather than argued away**, because both
advisories concern *reading* archives and this application does read them through `jszip`. Two of the
four call sites call `loadAsync`, and both read a **request payload** — `request.payload.zipCode`, in
`trinket.draft` at `:1028` and `trinket.autosave` at `:1102` — so GHSA-36fh-84j7-cv5h has a
call site reachable from request input, and GHSA-jg8v-48h5-wgxg (prototype pollution) is reached
through the same parse. The `adm-zip` package the inventory moved to 0.6.0 does not bound this: its
single use **writes** an archive (`new zip()`, `addLocalFolder`, `writeZip` at
`[T lib/controllers/courses.js:351-353]`) and it reads none, so `jszip`'s two `loadAsync` calls are
the only archive reads in the delivered tree (static).

**The disposition is unchanged by that.** Both findings are **moderate**, so under
[§1](#1-the-deferral-rule) neither qualifies for a change, and the available fix — 3.10.1, inside the
same major — is not one the triage rule authorises. Reachability strengthens the case for recording
the finding precisely, not for bumping outside the rule: the vulnerable code is installed, the
finding is retained, and it is counted in [§5](#5-audit-result) with a risk note that says the same
thing.

### 2.6 `archiver` 2.1.1

| | |
|---|---|
| **Resolved** | 2.1.1 — **unchanged** from baseline. Declared `^2.0.0`, and that declaration is **byte-identical** to `2f8712a` |
| **Consumer** | `[T lib/controllers/trinket.js:26]` and `[T lib/workers/exports.js:23]`, both invocation sites: `archiver('zip', {zlib:{level:N}})` at `[T lib/workers/exports.js:279]`, `[T lib/controllers/trinket.js:1388]` and `[T lib/controllers/trinket.js:1763]` |
| **Finding** | none of its own at either commit; the transitive `brace-expansion` high is cleared by resolution alone (below) |
| **Reason** | The frozen disposition retains 2.1.1. AAP §0.5.1.2 records the earlier major bump as withdrawn and instructs that it not be reintroduced, and every remedy measured for the two shortfalls below changes **persisted archive bytes** |

This is the one entry in [§2](#2-the-deferred-but-functional-list) that **fails an axis of
[§1](#1-the-deferral-rule)'s rule and is retained anyway**, so it is also the document's fullest
treatment of a single package: [`dependency-inventory.md`](dependency-inventory.md) cross-references
here rather than duplicating, and the measurement lives in this section. Two shortfalls are recorded
below. They are **recorded, not excused**: no deviation status is granted to either, here or
anywhere, and the follow-up that would close them is named at the end.

**What the deferral got right.** `archiver` carries no advisory of its own at either commit. What
baseline carried was a **high** on the shared transitive `brace-expansion` — range `<= 1.1.17`, three
high advisories plus one moderate — reached solely through `archiver`:

```console
$ npm ls brace-expansion --omit=dev --all
trinket@0.0.0
└─┬ archiver@2.1.1
  └─┬ glob@7.2.3
    └─┬ minimatch@3.1.5
      └── brace-expansion@1.1.18
```

Baseline resolved that leaf at **1.1.12**, inside the vulnerable range; regenerating the lockfile
floated it to **1.1.18**, outside it. So the advisory that appeared to force a major bump really was
cleared by resolution alone, and an advisory-driven bump really would have been unforced. That
finding stands.

**What the deferral missed, and what is therefore carried.** Advisories are one of *four* qualifying
reasons in [§1](#1-the-deferral-rule). The other three were never measured for this package when it
was first deferred, and archiver 2.1.1 fails two of them on Node 22. Both failures are measured
below, and both are delivered as **open shortfalls** rather than as reasons this document moved the
package on its own authority — the frozen disposition governs, and the remedies do not fit inside it.

*Shortfall 1 — it is not warning-free.* `require('archiver')` prints a deprecation warning at module
scope, before any archive is built:

```console
$ node --pending-deprecation --trace-deprecation -e "require('archiver')"
(node:406180) [DEP0005] DeprecationWarning: Buffer() is deprecated due to security and usability
    issues. Please use the Buffer.alloc(), Buffer.allocUnsafe(), or Buffer.from() methods instead.
    at new Buffer (node:buffer:275:3)
    at Object.<anonymous> .../node_modules/compress-commons/lib/archivers/zip/constants.js:11:10
```

`constants.js:11` is `EMPTY: new Buffer(0)`. Both consumers — `[T lib/controllers/trinket.js:26]` and
`[T lib/workers/exports.js:23]` — are loaded during boot, so this fires **once per start of the
application**, at module load, off the request path, from a transitive dependency with no
package-level suppression hook. The application still boots and `GET /` still answers **200**; what it
does not do is pass the request's zero-deprecation-warning gate, and the gate is not redefined to
accommodate it. The same warning is what the storage harness captures and what the worker harness
counts as its one notice against zero allowed ([§1](#1-the-deferral-rule) carries those figures).

*Shortfall 2 — it does not write valid archive metadata.* Archiver 2.1.1 writes **`crc32 = 0` and
`uncompressed size = 0`** into the local header, the data descriptor and the central directory of
every deflated entry. The mechanism is the Node stream contract, not a configuration mistake:
`crc32-stream` 2.0.0 accumulates the checksum and the raw byte count inside an override of
`Writable.prototype.write` (`crc32-stream/lib/deflate-crc32-stream.js:42-49`), and modern Node's
`Writable.prototype.end(chunk)` writes the chunk through an internal helper rather than through
`this.write`, so the override never runs for the buffer and string appends `compress-commons`
performs. The compressed size, accumulated in a `push` override at
`crc32-stream/lib/deflate-crc32-stream.js:34-40` that *is* still reached, stays correct — which is
why the defect is invisible in the archive's size and structure and shows up only in the metadata.

The consequence is that the archives the export worker uploads and the trinket-download routes serve
declare no checksum and no length, and the application's own reader cannot read them back:
`adm-zip` 0.4.16 returned an **empty buffer silently** because it trusted the declared size, and the
delivered `adm-zip` 0.6.0 **throws `ADM-ZIP: CRC32 checksum failed`** because it validates the
declared CRC. `[T test/parity/storage.js:134-158]` measured exactly this independently and has to
read through `getCompressedData()` and inflate by hand to recover the bytes at all; it is the reason
that harness's `archive-layout` case (`[T test/parity/storage.js:5685]`) fails and the storage gate
closes 34 of its 35 cases.

**This shortfall is pre-existing at base commit `2f8712a`, which is what settles its disposition.**
The harness says so itself, at `[T test/parity/storage.js:172]` and again in the failure text it
emits at `[T test/parity/storage.js:5853]`: the writer chain and the four
`[T lib/workers/exports.js]` append sites are named as the owners, the defect is recorded as
pre-existing at the base commit, and the harness "reports it and does not repair it". So the zero
crc32 and zero uncompressed size are **baseline behaviour**, and the fields they occupy are
**persisted archive bytes** — bytes written into stored objects that the export document's `s3Key`
points at. Changing them from wrong to right is a change to persisted output, which R-d prohibits as
a behaviour improvement and which R-f resolves in favour of the baseline. That is the second and
independent reason preservation wins on this package: even setting the withdrawn version bump aside,
the correction itself is not a change this migration is authorized to make.

**Three remedies were measured, and none of them is available to this delivery.** They are recorded
in full because the follow-up named at the end of this section has to choose between them, and
because "no remedy" is a claim that has to be evidenced rather than asserted.

*Remedy 1 — force the chain forward with `overrides` while keeping `archiver` at 2.1.1.* This is the
narrow fix that would honour the frozen version, and it does not work. That was tried:
`overrides: {"zip-stream":"^4.1.1","compress-commons":"^4.1.2","crc32-stream":"^4.0.3"}` **does** fix
the metadata — correct crc32 and size, `getData()` works — **and does not clear the warning.** With
that chain in place `new Buffer()` is still reached from `archiver-utils/index.js:87`, called by
`Archiver.append` at `archiver/lib/core.js:571`, and `archiver@2.1.1/lib/core.js` has three
`new Buffer(0)` calls of its own. The deprecated constructor is in **archiver's own source and in the
`archiver-utils` 1.x major it pins**, which no override reaches. It is also strictly worse: the
warning moves from one line at boot to **one per archive built**, on the request path. And it fixes
the metadata, which as established above is itself a change to persisted archive bytes.

*Remedy 2 — append a stream instead of a buffer at the four `[T lib/workers/exports.js]` call sites.*
This is the remedy the storage harness measured and recorded at
`[T test/parity/storage.js:3047-3051]`: appending a stream makes `zip-stream` pipe the entry through
`write()`, so the `crc32-stream` override runs and a valid crc is recorded. It needs no dependency
change at all, and it is **equally unavailable, for exactly the reason remedy 1 is**: it moves crc32
from 0 to correct and the uncompressed size with it, so the persisted archive bytes change just as
they would under a version move. The four sites are `[T lib/workers/exports.js:453]`, `:493`, `:498`
and `:513`.

*Remedy 3 — move `archiver` to a line whose `crc32-stream` writes through `write()`.* This is the
version move, and it is the one the frozen plan withdrew. What it would have to choose from is the
measurement below. It changes the same persisted bytes as remedy 2 and additionally reaches the
warning, which neither of the others does.

**Which version a future approved move would have to choose, and the minimum.** This table is
evidence for the follow-up, **not a selection already made** — the delivered tree resolves 2.1.1 and
none of these versions is installed. Measured on one five-entry fixture at both compression levels
the application uses:

| archiver | DEP0005 | declared crc32 / size | archive bytes | `adm-zip` 0.6.0 `getData()` |
|---|---|---|---|---|
| **2.1.1 — retained, delivered** | **1 warning** | **0 / 0** | 797 | **throws** on all four deflated entries |
| 3.1.1 | 1 warning | 0 / 0 | 797 | throws |
| 4.0.2 | 1 warning | 0 / 0 | 797 | throws on three |
| 5.0.0 · 5.3.2 | 1 warning | correct | 797 | ok |
| **6.0.0 — the minimum that clears both** | **none** | **correct** | **797** | **ok** |
| 6.0.2 | none | correct | 797 | ok, byte-exact on all five |
| 7.0.1 | none | correct | 797 | ok |
| 8.0.0 | none | correct | 797 | ok |

**6.0.0 is the lowest version that clears both shortfalls**, so a move sanctioned as separate work
would take **6.0.2**, the newest patch of that major, on the standard
[§1](#1-the-deferral-rule) applies to every version move. Two further results belong with it: an
earlier analysis selected **7.0.1** and described it as the lowest, having tested 3.1.1 and 5.3.2 but
neither the 4.x nor the 6.x line, which is a major higher than that standard allows; and 8.0.0 also
clears both but adds a restrictive `exports` map that nothing in the two shortfalls requires.

The archive's **layout** is the same across every row: the total byte count is identical, and so is
every entry's compression method and compressed size. The only bytes that differ are the CRC and
uncompressed-size fields — which is precisely why the move is not this delivery's to make, because
those fields are the persisted output R-d protects. The API surface such a move would have to
exercise, unchanged at every call site, is `archiver('zip',{zlib:{level:N}})` ×3,
`.append(string|Buffer,{name})` ×9, `.pipe()` ×3, `.finalize()` ×3, `.pointer()` ×2 and `.on()` ×5
(two `'error'`, two `'warning'`, and one `'err'` at `[T lib/controllers/trinket.js:1777]`).

**On R-a, and on what is actually recorded here.** Bumping `archiver` for the cleared
`brace-expansion` advisory would have been unforced, and that is what AAP §0.5.1.2 withdrew. A bump
for the warning and for the invalid metadata would be a different argument on a different axis — but
it is an argument for *separately approved* work, not authority this delivery holds, because the
frozen disposition names 2.1.1 and because the correction changes stored bytes R-d protects. So the
delivered position is: **retained at 2.1.1, with two shortfalls recorded and neither excused.**

**The follow-up that would close them.** A version move to `archiver` 6.0.2 (remedy 3), delivered as
separately approved work under its own review, carrying two pieces of evidence this delivery
deliberately does not produce: **baseline-versus-target archive-byte parity** for every entry the
export worker and the two download routes write, showing exactly which fields change and that nothing
else does; and a **worker parity** run over the same job set, since the change touches the archive the
worker uploads and the key it persists. Remedy 2 is the cheaper variant of the same approval — no
dependency change, the same persisted-byte change, and it leaves the warning in place, so it closes
one shortfall of the two.

### 2.7 `q` 1.0.1

| | |
|---|---|
| **Resolved** | 1.0.1 — **unchanged** from baseline |
| **Consumer** | **Exactly two** (static, `grep -n "\bQ\." lib/workers/exports.js`): `[T lib/workers/exports.js:18]`, with **14** `Q.` member calls — `Q.defer()` ×4 at `:51`, `:202`, `:291` and `:378`; `Q.nsend(...)` ×8 at `:125`, `:128`, `:137`, `:141`, `:162`, `:186`, `:244` and `:270`; `Q.all(...)` ×1 at `:262`; `Q.allSettled(...)` ×1 at `:335` — and `[T test/helpers/mail.js:2]`, using `Q.resolve()` at `:9` |
| **Finding** | none — no advisory at either commit |
| **Reason** | The **library** is functional and has a live consumer; replacing it with native promises is real work outside R-a — [§3.3](#33-q--native-promises). Separately, the **worker's `Q.nsend` bridge onto Mongoose 6 is measurably broken**, and that defect is in the adaptation rather than in `q` (below) |

A 2013 promise library, and the export worker's control flow is written in its idiom rather than
merely importing it: `Q.defer()` bridges the S3 callbacks and `Q.nsend` is the worker's adapter for
Mongoose's callback methods, so the two are load-bearing rather than decorative.

**The library is functional; the worker's use of it against Mongoose 6 is not. The two facts are kept
apart deliberately, because they have different owners and different fixes.** `Q.defer`, `Q.all`,
`Q.allSettled` and `Q.resolve` all behave as the worker expects, so replacing `q` with native promises
would not by itself fix what is broken here — the defect is in the adaptation between `Q.nsend` and a
Mongoose 6 model. Measured (**probe**, delivered tree, `mongoose` 6.13.9 / `q` 1.0.1 as the lockfile
resolves them, run from the repository root):

```console
$ node -e "var m=require('mongoose'),Q=require('q');var M=m.model('P',new m.Schema({}));
           Q.nsend(M,'findById',new m.Types.ObjectId()).catch(function(e){console.log(e.name+': '+e.message)})"
MongooseError: Query was already executed: P.findOne({ _id: new ObjectId("6a9a03e54b780bf10c5a86fd") })

$ node -e "var m=require('mongoose');console.log('stream:',typeof m.Query.prototype.stream,' cursor:',typeof m.Query.prototype.cursor)"
stream: undefined  cursor: function

$ node -e "var m=require('mongoose');var M=m.model('P',new m.Schema({}));
           try{M.find({}).stream()}catch(e){console.log(e.name+': '+e.message)}"
TypeError: M.find(...).stream is not a function

$ node -e "var Q=require('q');var d=Q.defer();d.resolve('ok');Q.all([d.promise,Q.resolve(2)]).then(function(v){console.log('Q.defer+Q.all ->',v)});
           Q.allSettled([Q.resolve(1),Q.reject(new Error('x'))]).then(function(s){console.log('Q.allSettled ->',s.map(function(x){return x.state}).join(','))})"
Q.defer+Q.all -> [ 'ok', 2 ]
Q.allSettled -> fulfilled,rejected
```

The same rejection was reproduced against a live MongoDB connection with the worker's own call shape,
`Q.nsend(Model, 'findByIdAndUpdate', id, { status: 'processing' })` (**probe**), so it is not an
artifact of an unconnected model.

**Two mechanisms, both properties of the worker source as delivered at the cited lines:**

1. **`Q.nsend` against a Mongoose 6 model rejects.** `Model.findById(id, cb)` and
   `Model.findByIdAndUpdate(id, update, cb)` return a **Query**, and a Mongoose 6 Query is itself a
   thenable. `Q.nsend` calls the callback form and then assimilates the returned thenable, whose
   `.then()` executes the query a **second** time; Mongoose 6 rejects that second execution with
   `MongooseError: Query was already executed`. All eight `Q.nsend` sites have that shape, the first
   being `[T lib/workers/exports.js:125]` — the export job's **first** Mongoose call.
2. **`Query.prototype.stream` no longer exists.** Mongoose 6 removed it in favour of `cursor`
   (measured above), and `[T lib/workers/exports.js:230]` calls `.stream()` on a Query, which throws
   `TypeError: ... .stream is not a function`.

**What the defect costs.** It is not a load-time failure: `require('./lib/workers/exports')` loads
cleanly (**probe**, and [§2.3](#23-mongoose-schema-extend-022) records why that took work). It is a
**job-processing** failure — the export job's first Mongoose call rejects and the trinket-stream call
throws — so the successful export path cannot complete. `npm run verify:worker` reports it rather
than hiding it: the gate measures both idioms and fails with the remedy named — **re-measured on the delivered tree**,
`checks 92/109 passed, 7 job(s) driven on bull 4.16.5 … 1 notice(s)`, `VERDICT FAIL`, 17 checks
failing, whose leading failure reads
*"the worker's database idiom can complete an export … Q.nsend usable=false at 8 call site(s) …
Query.prototype.stream usable=false at 1 call site(s)"* (**probe**). It is recorded here as well
because a reader of this list is entitled to know that "deferred" is a statement about the package and
not a clean bill of health for its consumer, and because the remedy the gate names — converting the
eight bridges to `.exec()` and the stream call to `cursor` — belongs to
[§3.3](#33-q--native-promises) rather than to this migration: the worker's own authorization holds
both idioms as invariants, so the incompatibility stands recorded and unrepaired.

**The conflict that leaves open, and who resolves it.** Two frozen requirements meet at these two
lines and cannot both hold. R-b and AAP §0.9.3 require a worker that completes a real export job;
R-a, R-d and `lib/workers/exports.js`'s own authorization hold `Q.nsend` and the legacy query stream
as invariants, and the conversion that satisfies the first is the one the second forbids. Neither
this document nor the worker's own lane can settle that, and AAP §0.7's approved deviations are two,
neither of them this one — so it needs a project-level disposition: either authorize
[§3.3](#33-q--native-promises)'s conversion inside this migration and record it as a third
deviation, or accept a worker that cannot complete an export until [§3.2](#32-mongoose-6--7) and
[§3.3](#33-q--native-promises) are delivered. Until one of those is chosen the code carries the
frozen call forms and `npm run verify:worker` reports the failure rather than absorbing it.

**Why the `q` deferral itself stands.** `q` carries no advisory, it has a live consumer, and the
breakage is in the adaptation rather than in the library, so none of [§1](#1-the-deferral-rule)'s
clauses is engaged — `require('q')` also emits nothing (**probe**). Converting the worker to native
promises ([§3.3](#33-q--native-promises)) is the work that would rewrite that bridge, and it is
outside R-a. Because the bridge is exactly what that follow-up replaces, the enumeration and the two
locators above are properties of `lib/workers/exports.js` **as delivered**, and if it is corrected they
must be re-derived rather than trusted:

```console
$ grep -n "\bQ\." lib/workers/exports.js
```

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
| `limax` | 1.4.1 | `[T lib/models/plugins/slug.js:4]` called at `:18`; `[T lib/controllers/files.js:9]` called at `:118`; `[T lib/controllers/trinket.js:31]` called at `:1324` — `sluggify(request.payload.slug, { separateNumbers : false })` in `updateSlug` | URL slug generation |
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

### 2.11 Six development dependencies retained behind their current lines

R-c asks for unmaintained-but-functional packages in a separate deferred list **with reasoning**, and
it does not exempt development dependencies. Six are declared in `[T package.json:devDependencies]`
and deliberately left behind their current published lines; the inventory records them as retained,
and this is their companion disposition. Each is measured against the delivered lockfile, and each
consumer below is an invocation site rather than merely an import (**static**, over `test/**`,
`config/**` and the repository's build configuration):

| Package | Resolved | Declared | Live consumer | Why it did not move |
|---|---|---|---|---|
| `mocha` | **3.5.3** | `^3.4.1` | The suite runner itself: `[T package.json:scripts.test]` is `node test/parity/mongo.js -- mocha`, and `[T test/mocha.opts]` carries its six flags | **Retained deliberately, and a bump would break the harness silently.** `test/mocha.opts` stopped being read in Mocha 8, so a move past Mocha 7 would discard every flag in that file — the spec glob, `--require ./test/env.js`, `--recursive`, `--check-leaks`, `--reporter spec` and `--timeout` — without an error. Two further Mocha 3 behaviours are load-bearing: the glob's **sorted** file collection, which is the whole of why `[T test/lib/00-ready.js]` runs first and can publish the resolved server (its own comment records the `0x30` versus `0x61` ordering), and `--require` modules loading **before** the BDD globals exist, which is why `[T test/env.js]` registers no hooks and asserts as much at `[T test/env.js:18-20]` |
| `chai` | **3.5.0** | `^3.5.0` | `[T test/env.js:71-73]` installs the `should` getter; **20** files read assertions through it, 19 under `test/lib/**` plus the preload | **A move the plan allowed for that did not materialise.** The plan permitted a `chai` bump only if the selected `sinon`'s assertion peer forced one. The delivered `sinon` 22.1.0 declares **no** `peerDependencies` at all (**probe** — measured `null`), so nothing forced it. Under [§1](#1-the-deferral-rule) that leaves no qualifying reason, and moving it would put 124 carried-through assertions at risk for no gain |
| `supertest` | **0.8.3** | `~0.8.3` | `[T test/helpers/flow.js:2]`, called at `[T test/helpers/flow.js:504]` — `server(ready.server.listener)`, the agent every API suite drives | Functional on Node 22 and consumed by the **ten** API suites in `[T test/lib/api/index.js]`'s `sequence` array through that one shared helper. Its findings are transitive through `superagent` and sit outside the request's `--omit=dev` gate (below). A move is a harness rewrite — `supertest` 7's agent and promise semantics differ — with no qualifying reason under [§1](#1-the-deferral-rule) |
| `redis-mock` | **0.2.0** | `~0.2.0` | `[T test/env.js:77]`, applied at `[T test/env.js:82]` — `sinon.stub(redis, 'createClient').callsFake(redismock.createClient)`, which keeps the suite off a live Redis | Functional, carries **no** advisory, and it is the mechanism by which `npm test` needs no Redis. The one accommodation made instead of a version move was at the call site, not the package: the legacy three-argument `sinon.stub` form became `.callsFake()` for the current `sinon` — a stub-syntax change with no assertion change |
| `sass` | **1.98.0** | `^1.57.0` | The stylesheet build, through `[T vite.config.mjs]`'s `css.preprocessorOptions.scss` over `static/scss/base.scss` and `static/scss/embed/embed.scss`; invoked by `npm run build:css` | **Build tooling is deliberately out of scope** (AAP §0.2.2), precisely so that the output artifacts and their paths do not move: `public/css/base.css` and `public/css/embed.css`. It carries no advisory. Its ~435 deprecation warnings come from the vendored, gitignored Foundation SCSS under `public/components/**`, which is out of scope for the same reason and is not the application's warning stream |
| `vite` | **4.5.14** | `^4.5.14` | The same build: `[T package.json:scripts.build:css]` is `vite build`, configured by `[T vite.config.mjs]` | Out of scope with `sass`, and for the same reason — the build's inputs, outputs and paths are an invariant of this migration. Its findings are dev-only and outside the `--omit=dev` gate; `npm` offers `vite@8.2.2`, four majors on, which would be a build-tooling replacement rather than a dependency swap |

**The advisory consequence, measured in both scopes rather than implied to be clean.** These packages
are not advisory-free, and saying so is the point of recording them here:

| Scope | Critical | High | Moderate | Total |
|---|---|---|---|---|
| `npm audit --omit=dev` — **the request's gate** | **0** | **1** | **6** | **7** |
| `npm audit`, dev-inclusive | **4** | **7** | **9** | **20** |
| The excess, attributable to the development graph | 4 | 6 | 3 | **13** |

The thirteen excess findings were attributed by reading `npm audit --json` in both scopes and
differencing the vulnerability sets, not by inference. They arrive through **three** of the six
packages, and the attribution is worth stating precisely because a summary that named only `mocha`
would be wrong:

- **`mocha` 3.5.3 carries all four criticals** and one high on its own. Its chain is `mocha` →
  `growl` (critical, command injection), `mkdirp` → `minimist` (critical, prototype pollution) and
  `diff` (high, ReDoS), with `mocha` itself rated critical by inheritance. This is the price of the
  deliberate retention argued above, and it is the largest single component of the excess.
- **`supertest` 0.8.3 carries three highs and two moderates**, all through `superagent`: `qs`, `mime`
  and `superagent` itself at high, `cookiejar` and `supertest` at moderate.
- **`vite` 4.5.14 carries one high** (its own, plus `launch-editor` and `server.fs` advisories) and
  one moderate through `esbuild`.
- **`debug` (high) is reached through both** the `mocha` and the `superagent` chains, which is why
  the two attributions above overlap by one package rather than partitioning cleanly.
- **`chai`, `redis-mock` and `sass` appear in neither audit scope**: they carry no finding at all.

Those four bullets reconcile to the thirteen exactly, which is how the figure can be checked rather
than taken on trust: 5 entries through `mocha` (`mocha`, `growl`, `mkdirp`, `minimist`, `diff`), 5
through `supertest` (`supertest`, `superagent`, `qs`, `mime`, `cookiejar`), 2 through `vite` (`vite`,
`esbuild`), and 1 shared (`debug`).

**The request's audit gate is scoped `--omit=dev`**, so every one of those thirteen sits outside it,
and [§5](#5-audit-result) and [§6](#6-the-stated-gate-is-not-met) are unaffected — re-measured, the
production figure is unchanged at 0 critical, 1 high, 6 moderate. Outside a gate is not the same as
unreal: these packages run on a developer's machine and in whatever CI executes `npm test`, with
`growl` and `minimist` reachable only through Mocha's own reporter and argument handling rather than
through anything this application serves.

**And "outside the gate" is not the same as "absent from the delivered image", which on this
repository is a real difference.** The root image is a **single stage** that installs with a plain
`npm ci` — devDependencies included, deliberately, because `vite` and `sass` are what build the two
stylesheets it serves — and nothing after that step prunes the graph or copies into a production-only
stage. So all thirteen findings above, the four criticals and seven highs among them, are **physically
present in the final image**, even though the gate the request specifies correctly excludes them from
its scope. That is a property of the `Dockerfile`, which is **owned by another work unit at this
checkpoint**; the honest disposition here is that these packages are retained for the reasons above,
their dev-side findings are real, and their absence from the deployed artifact is **not established**
and will not be until a prune or a production-only stage makes it so.

What closes the advisories themselves is a test-harness modernization —
`mocha` past 7 with its flags moved to `.mocharc.yml`, and `supertest` 7 with the agent rewritten —
which is real work outside R-a's four categories and is recorded as such rather than smuggled into
this delivery.

### 2.12 Residual advisories in the four `serverside/*/manager` graphs

The four sandbox managers are separate deployment units with their own manifests and lockfiles. This
migration pinned their runtime to Node 22 and **created their lockfiles for the first time** — the
baseline tree at `2f8712a` carried none, so these are first-time creations rather than regenerations,
and their manifests are unchanged. It did **not** clear their
advisories, so those findings are deferred in place and are recorded here as this document's
companion note. [`dependency-inventory.md`](dependency-inventory.md) carries the per-package table for
those four graphs — registry, resolved version and reason per package — and it is not duplicated
here. What this note adds is the disposition and the **reachability**.

Measured with `npm audit --package-lock-only` in each manager directory:

| Unit | Findings | Direct packages implicated | Transitive packages implicated |
|---|---|---|---|
| `serverside/java/manager` | **1 moderate** | `file-type` 18.7.0 | — |
| `serverside/r/manager` | **1 moderate** | `file-type` 18.7.0 | — |
| `serverside/python/manager` | **3 moderate** | `file-type` 18.7.0, `is-svg` 4.4.0 | `fast-xml-parser` 4.5.7, under `is-svg` |
| `serverside/pygame/manager` | **3 moderate** | `file-type` 19.6.0, `is-svg` 5.1.0 | `fast-xml-parser` 4.5.7, under `is-svg` |

Two advisories account for all eight findings:

- **`GHSA-5v7r-6r5c-r473`** — an infinite loop in `file-type`'s ASF parser on malformed input with a
  zero-size sub-header (CWE-835), moderate, range `>= 13.0.0 < 21.3.1`. `file-type` is a **direct**
  dependency of all four managers. `fixAvailable` is `file-type@22.0.2`, **semver-major**.
- **`GHSA-gh4j-gqv2-49f6`** — XML comment and CDATA injection through `fast-xml-parser`'s XMLBuilder
  on unescaped delimiters, moderate, range `< 5.7.0`, present transitively beneath the direct `is-svg`
  in the python and pygame managers. `fixAvailable` is `is-svg@6.1.0`, **semver-major**. This one is a
  **graph** finding only; the paragraph after next records why its exploit path is not established.

**Reachability of the `file-type` advisory, which is what makes it more than paperwork.** Every
manager's `'file added'` socket handler passes bytes produced by **user-submitted sandbox code**
straight into the type parser, with no size or shape check ahead of it (**static**, read from the four
manager modules):

| Unit | Handler | `file-type` call | `is-svg` call |
|---|---|---|---|
| java | `[T serverside/java/manager/manager.js:195]` | `await fileTypeFromBuffer(data.buffer)` at `:199` | — |
| python | `[T serverside/python/manager/manager.js:209]` | `await fileTypeFromBuffer(data.buffer)` at `:212` | `isSvg(data.buffer)` at `:214` |
| r | `[T serverside/r/manager/manager.js:199]` | `await fileTypeFromBuffer(data.buffer)` at `:203` | — |
| pygame | `[T serverside/pygame/manager/manager.js:169]` | `await fileTypeFromBuffer(data.buffer)` at `:172` | `isSvg(data.buffer)` at `:174` |

A manager is a single-threaded Node process serving every connected user of its language, so a
crafted file written **inside** the sandbox — which is exactly the input this handler exists to
process — can stall that manager's event loop for all of them. **That consequence belongs to the ASF
infinite loop and to nothing else here**: the stall is the `file-type` advisory's mechanism, and it is
not extended to the other finding below.

**The second advisory is present in the graph but its path is not established.** `is-svg` reads the
same buffer one line later in python and pygame, which makes "reachable by the same path" a tempting
thing to write. Measured, it is wrong. GHSA-gh4j-gqv2-49f6 is an **XMLBuilder** flaw — unescaped
comment and CDATA delimiters while *building* XML — and the locked consumers never build XML:

```console
$ grep -n "fast-xml-parser" is-svg@4.4.0/index.js is-svg@5.1.0/index.js
is-svg@4.4.0/index.js:2:const {XMLParser, XMLValidator} = require('fast-xml-parser');
is-svg@5.1.0/index.js:1:import {XMLParser, XMLValidator} from 'fast-xml-parser';

$ grep -rn "XMLBuilder" serverside/*/manager/manager.js
$ echo $?
1
```

`is-svg` 4.4.0 and 5.1.0 import and invoke only `XMLValidator.validate` and `new XMLParser().parse`,
and no manager references `XMLBuilder` at all. Passing a buffer to `isSvg` therefore exercises the
parser and the validator, not the flawed builder. The finding stays in the table above because the
vulnerable version genuinely is in those two graphs and a future consumer that did build XML would
acquire the exposure — but **only `GHSA-5v7r-6r5c-r473` is demonstrated reachable through the
user-controlled byte path**. An earlier revision of this section presented both as reachable through
the cited parse calls and applied the event-loop rationale to the pair; that conflated graph presence
with demonstrated reachability and is withdrawn.

**Clearing them is a manifest-and-lock change in those four units**, both fixes semver-major, and it
is **owned by another work unit at this checkpoint** — the manager manifests and lockfiles are not
this document's to change, and no version was moved to produce the figures above. The disposition
recorded here is therefore: **deferred in place, attributed, and reachability stated per advisory —
proven for the ASF loop, graph-presence only for the builder flaw** — with the per-package detail in
the inventory's manager record.

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

- **Why deferred.** Outside R-a, and the delivered 6.13.9 carries a **moderate-only** finding
  ([§2.2](#22-mongoose-6139)), which the triage rule defers rather than bumps. The one warning it did
  emit is pinned rather than chased. Note that Mongoose 7 is not the smallest thing that would clear
  that advisory — 6.13.10 would — but taking it by caret float is what
  [§2.2](#22-mongoose-6139) records as the thing not to do: it would change the model runtime with no
  compatibility or parity analysis behind it. Clearing it deliberately, at whatever version, belongs
  to this migration.
- **What would need to change.** Mongoose 7 removes callback support from every model and query
  method, which is the idiom this codebase is written in across 30 consumer modules — and it is the
  same idiom `Q.nsend` adapts in the worker, so [§3.3](#33-q--native-promises) is entangled with it.
  `strictQuery` becomes the default and the explicit `mongoose.set('strictQuery', true)` at
  `[T config/db.js:8]` becomes redundant. `mongoose-schema-extend` does not support Mongoose 7, so
  [§3.4](#34-removing-mongoose-schema-extend) is a **prerequisite**, not a parallel task.
- **What would gate it.** The full existing suite, the request corpus over all 233 routes, and the
  storage and worker harnesses — every persistence path in the application is implicated.

### 3.3 `q` → native promises

- **Why deferred.** Outside R-a. The `q` **library** is functional and carries no finding. This item
  is **not** purely modernization, and [§2.7](#27-q-101) records why: the worker's `Q.nsend` bridge
  onto Mongoose 6 rejects on its first call and its `.stream()` call throws, both measured, so this
  conversion is also the fix for a delivered defect on the export path.
- **What would need to change.** The two consumers in [§2.7](#27-q-101) — principally the export
  worker's control flow, where `Q.defer()` bridges S3 callbacks and `Q.nsend` adapts Mongoose's
  callback methods at **eight** sites (`:125`, `:128`, `:137`, `:141`, `:162`, `:186`, `:244`,
  `:270`). `[T lib/workers/exports.js:230]`'s removed `Query.prototype.stream` goes with them, to
  `cursor`. Then the `Promise.prototype` patch at `[T app.js:3-16]` can be
  removed, but **only after** every `.spread(...)` and `.fail(...)` call site on a native promise has
  been converted; removing the patch first breaks them silently, since both would become
  `undefined is not a function` at runtime rather than at load.
- **What would gate it.** The worker harness in `test/parity/worker.js`, which drives one successful
  and one failing export job and asserts status, progress and error persistence onto the `Export`
  document, the archive layout, the `s3Key`, the notification mail and cleanup on both paths. That
  gate is the one whose success half the defect in [§2.7](#27-q-101) blocks, and it names this
  conversion as the remedy while failing on it. The failure path matters most: `Q`'s rejection
  propagation is what currently routes a failed job to its persisted `status: 'failed'`.

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
controls** — an approved three-field contract,
`h.response(<stream>).type(request.pre.file.mime).bytes(request.pre.file.size)`, with
`Content-Disposition` still omitted. The delivered branch at
`[T lib/controllers/files.js:738-742]` satisfies those three fields and is wider than the
abbreviation — it serves `peeked.stream` and adds two hardening headers — which
[`preserved-quirks.md`](preserved-quirks.md) §11.1 quotes in full and owns.

**How replay treats it — driven, and this is the result.** Scenario
`quirk.reply-chain.never-settles.image-download` carries the migration's only `expectedDeviation`
marker, and `test/parity/corpus.json` now reports `baselinesPending: 0` and
`undriven: 0`, with **391 of its 392** scenarios carrying a recorded baseline — the one exception
recorded `unreachableByDesign` — and exactly **one** `expectedDeviation` marker, this scenario's
(**probe**). Both halves of the comparison are measured, now over the full corpus:

- **baseline** — the step is recorded as an **expected timeout** (`status: null`, `timedOut: true`),
  which is a recordable result in this harness rather than a hang, and is the only reason a
  never-settling branch can be captured at all;
- **target** — the step replays with `timedOut: false`, so the branch **answers**, returning the
  stream with the file document's own mime type and byte length and **no** `content-disposition`;
- **verdict** — recorded as an **approved change** rather than a failure: `status:
  approved-deviation`, `failing: false`, `verified: true`, the single differing field
  `outcome: "timed-out" -> "answered"`, and the report stating that the change was checked field by
  field against what was approved — the five-field contract in
  [`preserved-quirks.md`](preserved-quirks.md) §11.0, not the presence of the marker. A target that
  still timed out, or that answered differently, would be a failure that happens to carry a marker.

The result above is now a **full-corpus** measurement: `npm run verify:corpus` drives 391 of the 392
scenarios on both cookie passes and classifies this one `approved-deviation` in each. An earlier
revision recorded the gate as exiting 2 over the committed corpus, whose provenance named a generator
this repository could not retrieve, with the deviation evidenced only on a re-captured segment
([`baseline-parity.md`](baseline-parity.md) §2.8).

**The full argument — the three reasons R-b controls, the sibling branch that supplies the intended
response, and the gate — is owned by [`preserved-quirks.md`](preserved-quirks.md) §11.1 and is not
duplicated here.**

Two things about it do belong here, because they concern this document's subject matter:

**It is not an audit deviation.** It changes no dependency, clears no advisory and appears nowhere in
[§5](#5-audit-result). That separation also bounds the residual above: only the **whole-corpus replay**
waits on a re-capture, and this deviation's own response parity is measured. The audit result in
[§5](#5-audit-result) is a measured `npm audit --omit=dev` result, taken on both trees, and is
unaffected by the corpus capture state either way. This deviation is recorded in this file only so
that the migration's complete set of approved deviations can be read in one place; the single
deviation that affects the audit result is
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
| Delivered | **0** | **1** | **6** | **7** |

This matches the figure the frozen plan specifies — zero critical, one high, six moderate — and it
does so because the resolved dependency state matches the one the plan specifies. An interim delivery
reported **five** moderates, having let lockfile regeneration float `mongoose` off its deferred
6.13.9 to 6.13.11, which cleared that package's advisory as a side effect. Pinning the resolution
back to 6.13.9 ([§2.2](#22-mongoose-6139)) restores both the model runtime and the sixth moderate. A
floated lockfile is not authority to report a different result from the agreed one.

The seven remaining findings, each attributed to a named package with its risk note:

| Package | Severity | Direct | Advisory | Why it is retained | Risk note |
|---|---|---|---|---|---|
| `marked` | **high** | yes | 8 advisories, range `<= 4.0.9`; governing one is ReDoS in the inline-token regexes. `fixAvailable: false` | The approved deviation in [§4.2](#42-deviation-2--the-marked-fork-is-retained) — no upgrade preserves the rendered output | ReDoS over course-creator-authored markdown through one consumer; a successful input stalls the single-threaded process for all users. No fix available |
| `aws-sdk` | moderate | yes | Own advisory is **low** (GHSA-j965-2qgj-vjmq, `region` parameter validation); the moderate rating arrives via `uuid` | v3 is a storage-layer rewrite outside R-a ([§3.1](#31-aws-sdk-v2--v3)) | `region` comes from committed configuration at `[T config/aws.js:11]`, not from request input, so the low advisory has no request-reachable path. The real risk is the absence of future patches for an end-of-support SDK |
| `bull` | moderate | yes | No own advisory; the finding arrives entirely via `uuid` | Already moved to 4.16.5 by the inventory; the residual is transitive and no further bump clears it | Bounded by the `uuid` note below. The queue is internal and not driven by request input |
| `highlight.js` | moderate | yes | GHSA-7wwv-vh3v-89cq, ReDoS across multiple grammars, range `9.0.0 - 10.4.0` | Moderate-only, so the triage rule defers it; an upgrade also changes token classes ([§2.4](#24-highlightjs-9185)) | ReDoS on the same authored-content path as `marked`, reached only for fenced code blocks in a language `hljs` recognises |
| `jszip` | moderate | yes | GHSA-jg8v-48h5-wgxg (prototype pollution) and GHSA-36fh-84j7-cv5h (path traversal via `loadAsync`), range `<= 3.7.1` | Moderate-only ([§2.5](#25-jszip-360)) | Four delivered call sites: two **construct** archives, and two **read** one with `loadAsync` on `request.payload.zipCode` at `[T lib/controllers/trinket.js:1028]` and `[T lib/controllers/trinket.js:1102]`, so both advisories are reachable from request input. The fix is 3.10.1, inside the same major, which the moderate-only triage rule does not authorise |
| `mongoose` | moderate | yes | GHSA prototype pollution in update casting, reached through a `__proto__`-prefixed dotted path in an update document, range `< 6.13.10` | Moderate-only, so the triage rule defers it, and it is pinned at its baseline 6.13.9 rather than floated ([§2.2](#22-mongoose-6139)); clearing it belongs to the Mongoose 7+ migration in [§3.1](#31-aws-sdk-v2--v3)'s companion [§3.2](#32-mongoose-6--7) | Requires an update document whose keys the caller does not control. The application builds its update objects from named fields rather than passing request bodies through, so the dotted-path form has no request-controlled path here; the standing risk is that a future handler passing a payload straight into an update would acquire one |
| `uuid` | moderate | **no** — via `aws-sdk` and `bull` | GHSA-w5hq-g745-h8pq, missing buffer bounds check in v3/v5/v6 when `buf` is provided, range `< 11.1.1` | Transitive to two deferred packages; `npm` offers only a breaking downgrade of `aws-sdk` to 1.18.0 | The advisory requires the caller to pass a `buf` argument to v3/v5/v6. Neither consumer's use is request-controlled, and no application code calls `uuid` directly |

Every finding above is deferred by a decision recorded in this document. None is unaccounted for, and
none is a surprise.

## 6. The stated gate is not met

**The request's stated gate was zero critical and zero high findings. This delivery does not meet it.**

It delivers **zero critical and exactly one high** — re-measured on the delivered tree with
`npm audit --omit=dev`, which reports 0 critical, 1 high and 6 moderate, 7 in total, unchanged by the
`archiver` disposition ([§5](#5-audit-result)). The single high is `marked`.

The gate is **not** redefined here, and **no exception is granted** to this delivery by this delivery.
The shortfall is what it is: a **single named, justified, single-package deviation from a stated
requirement**, whose reasoning and precedence argument are in
[§4.2](#42-deviation-2--the-marked-fork-is-retained) and whose exposure is stated there in terms a
reader can size independently — and it is delivered **together with the follow-up that would close
it**, rather than as an open question.

**Any *additional* critical or high finding is a failure**, not a deviation. The tolerance is exactly
one, it is attributed to exactly one package, and nothing else inherits it.

**This section is about the audit gate, and it is not the delivery's only unmet target.** The
zero-deprecation-warning gate is also unmet: `archiver` 2.1.1 emits one `[DEP0005]` at module load,
and that shortfall is **not** an approved deviation — no status was granted to it and none is granted
here ([§2.6](#26-archiver-211), stated in [§1](#1-the-deferral-rule) where the warning-free clause
lives). The distinction between the two matters. The `marked` high is a departure that was *argued and
approved* in advance, with its precedence argument and its follow-up. The `archiver` warning is a
measured failure carried **because the only remedies available are changes this delivery is not
authorized to make** — a withdrawn version bump, or a rewrite of persisted archive bytes. Reading
this section as the single blemish on an otherwise clean gate sheet would therefore be wrong.

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

Every figure in this document was measured against the delivered tree. Five measurements disagreed
with the plan's projected values, and the five rows below are counted rather than estimated. **Two —
rows 3 and 4 — are locator corrections**, where **the measurement is what is recorded above**.
**Three — rows 1, 2 and 2a — were disagreements the *delivery* was wrong about**, and in each the
delivery was corrected to match the frozen plan rather than the other way round: rows 1 and 2 are one
story, the `mongoose` caret float and the sixth moderate it hid, and row 2a is `archiver`.
[`dependency-inventory.md`](dependency-inventory.md) §8 keeps the corresponding log for the changed
set; these are the five that bear on the deferred set.

| # | Expected | Measured | Nature |
|---|---|---|---|
| 1 | 6 moderate findings, including `mongoose` | **6 moderate**, `mongoose` among them — after the correction below | Resolved, not a disagreement. An interim delivery measured **5** because lockfile regeneration had floated `mongoose` 6.13.9 → 6.13.11 inside its unchanged `^6.0.0` declaration, and 6.13.11 is outside the `< 6.13.10` advisory range. The float was reverted rather than reported: the resolution is pinned back to 6.13.9, the advisory is listed in [§5](#5-audit-result), and the figure agrees with the plan again ([§2.2](#22-mongoose-6139)) |
| 2 | `mongoose` 6.13.9 | **6.13.9** | Was 6.13.11 by caret float in an interim delivery; corrected. The declaration remains `^6.0.0`, so a future `npm install` will float it again unless the lockfile entry is re-checked |
| 2a | `archiver` deferred at 2.1.1 with no residual finding | **retained at 2.1.1, with two shortfalls recorded as unresolved** | Substantive, and the largest correction in this document — in both directions. The deferral was originally measured on the advisory axis alone and was therefore incomplete. Measurement then found two further failures on Node 22: `DEP0005` at module scope, and zero crc32 and zero uncompressed size in every deflated entry, so the deferral satisfies neither the compatibility nor the warning-free clause of [§1](#1-the-deferral-rule). An interim delivery responded by moving the package to **6.0.2** — a change AAP §0.5.1.2 had already withdrawn with the instruction that it not be reintroduced, and one that rewrites persisted archive bytes. The delivered tree is **retained at 2.1.1**, declared `^2.0.0` exactly as at `2f8712a`, and both shortfalls are carried as open gates with no deviation status. [§2.6](#26-archiver-211) keeps the full measurement, the three tested remedies and the named follow-up |
| 3 | `marked`'s sole consumer at `lib/controllers/courses.js:13` | The `require('marked')` is at **`lib/shared/trinket-markdown.js:1`**; `lib/controllers/courses.js` requires *that* module at **`:24`** | Locator correction. Both facts are recorded in [§4.2](#42-deviation-2--the-marked-fork-is-retained) so the two-step chain is visible rather than collapsed |
| 4 | `mongoose-schema-extend` required at `lib/models/model.js:190-191` | The `require` is at **`config/db.js:4`**; `lib/models/model.js:190-191` is where the **capability** is consumed | Locator correction. The distinction matters, because the require site is what determines load order and therefore the hazard in [§2.3](#23-mongoose-schema-extend-022) |

Five further notes, recorded because they bear on how the figures above should be read:

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
- **`archiver` 2.1.1's DEP0005 is the one measured breach of the warning-free clause**, not a clean
  deferral as an earlier reading of this list had it — and the breach is **carried, not closed**. The
  measurement, the chain and the once-at-load scope are in [§2.6](#26-archiver-211), and the breach is
  named in [§1](#1-the-deferral-rule) where the rule is stated. The remedy that measurement identified
  as "a decision about `archiver`" is a dependency change AAP §0.5.1.2 withdrew, so it is **not**
  taken here: the package stays at 2.1.1 and the warning stays outstanding, alongside the invalid
  archive metadata, both as shortfalls with no deviation status granted.
  **A cross-document obligation follows from that, and is recorded rather than acted on:** the same
  position — retained at 2.1.1, both shortfalls open, no deviation status — must read identically in
  [`baseline-parity.md`](baseline-parity.md), which owns the shortfall register (its §5 gate table,
  §6.16 and §7.4), and in [`dependency-inventory.md`](dependency-inventory.md)'s `archiver` rows.
  Where either still carries the superseded reading in which a move to 6.0.2 closed this shortfall —
  as both did when this section was written — that is a divergence to be corrected **in those
  documents**, which are not this one's to edit. **This document's classification is the one measured
  against the delivered `package-lock.json`**, which resolves `archiver` 2.1.1.
- **`q` the library is functional; the worker's `Q.nsend` bridge onto Mongoose 6 is measurably
  broken**, and an earlier reading of this list recorded only the first half. Both halves, with the
  probe output and the two mechanisms, are in [§2.7](#27-q-101); the deferral is unaffected because
  the defect is in the adaptation, and [§3.3](#33-q--native-promises) is the follow-up that fixes it.

**Cross-document alignment.** The two approved deviations in [§4](#4-the-two-approved-deviations) are
required to read identically here, in [`preserved-quirks.md`](preserved-quirks.md) §11 and in
[`baseline-parity.md`](baseline-parity.md) §7. All three documents are in the delivered tree, so all
three legs have been compared (**static**, by direct reading of the three sections). The `archiver`
divergence recorded in the bullet above is **not** one of the divergences counted here: it concerns a
shortfall rather than a deviation, and `archiver` appears in neither document's deviation register.
The comparison found **two divergences, one on each deviation** — deviation 1's **evidence state**, since RESOLVED by
measurement, and deviation 2's `highlight.js` attribution, which is named below rather than
harmonised. **Deviation 1 agrees on
every element that decides it**: the conflict statement, the decision that the target serves the
stream response and that R-b controls, the target expression
`h.response(stream).type(request.pre.file.mime).bytes(request.pre.file.size)` at
`[T lib/controllers/files.js:738-742]`, `Content-Disposition` still omitted, and the assignment of the
three reasons to `preserved-quirks.md` §11.1 — which §11.1 enumerates and `baseline-parity.md` §7.1
restates in the same order. What it does **not** agree on is the state of the evidence behind the
gate. **Deviation 2 agrees** on the decision to retain the fork and on the residual advisory being a
named deviation of exactly one high with zero critical, on the four measured rendering differences in
the same order, on the deprecation notice emitted on every parse, and on the assignment of the full
reasoning, the precedence argument and the named follow-up to
[§4.2](#42-deviation-2--the-marked-fork-is-retained) of this document. **The numbering agrees**:
deviation 1 then deviation 2 in all three — §4.1 and §4.2 here, §11.1 and §11.2 in the quirk
catalogue, §7.1 and §7.2 in the parity record.

**Divergence 1, deviation 1's evidence state — resolved by measurement.** The three legs disagreed
about whether the corpus *records* the baseline timeout and the target answer, or whether that was
still prospective. `baseline-parity.md` §7.1 held the prospective reading and cited the artifact for
it: `captured: false`, `baselinesPending: 383`, every scenario `baseline: null`, and no
`test/parity/corpus.json.provenance.json` sidecar.

**The artifact now settles it the other way.** `test/parity/corpus.json` reports `baselinesPending: 0` and `undriven: 0` with
`baselinesPending: 0`; 391 of the 392 scenarios carry a recorded baseline, the one exception recorded `unreachableByDesign`; the sidecar **does** exist, naming
`baseline.commit 2f8712a112db…`; `quirk.reply-chain.never-settles.image-download` remains the single
scenario bearing an `expectedDeviation` marker and records `timedOut: true` against the base commit;
and a replay against the delivered tree records `timedOut: false` with `status: approved-deviation`,
`failing: false` and `verified: true`. Of the two forms this record offered — the carrier sentence
becomes prospective, or a capture is driven with its provenance — **the capture was driven**, so all
three legs now state the measured result and none is prospective. It was an **evidence-state**
disagreement rather than a disagreement about the deviation throughout: the conflict statement, the
decision that R-b controls, the target expression at `[T lib/controllers/files.js:738-742]`, the
omitted `Content-Disposition` and the precedence argument read the same in all three records before
and after, and it changes no deferral, no version and no figure in [§5](#5-audit-result).

**Divergence 2, deviation 2's `highlight.js` attribution.** `preserved-quirks.md` §11.2 states that "as
a direct consequence" of retaining the fork `highlight.js` stays at its baseline version, while
[§4.2](#42-deviation-2--the-marked-fork-is-retained)'s third consequence records the opposite
attribution: `highlight.js` is deferred on its **own** moderate-only grounds
([§2.4](#24-highlightjs-9185)), is **not** a consequence of this decision, and the two are decoupled.
The version is not in dispute — both records keep 9.18.5 — and the decoupled reading is the one this
document argues and the plan states; what differs is only the causal attribution in that companion
sentence. Settling it means §11.2 dropping the "direct consequence" framing for `highlight.js` while
keeping the `lib/shared/trinket-markdown.js` consequence, which both documents already state the same
way. It changes no deferral, no version and no figure in [§5](#5-audit-result), and the sentence
belongs to §11.2, so it is recorded here rather than rewritten from this document.

`error-edge-inventory.md` is not a fourth leg: it states neither deviation, and its ownership table
assigns both to `preserved-quirks.md` §11 — the same canonical role recorded in
[§4](#4-the-two-approved-deviations) above.

---

*Navigation note, recorded rather than acted on: `mkdocs.yml` is out of scope for this migration and
its `nav:` lists only `index.md`, `setup.md` and `overview.md`, so this document is not part of the
rendered documentation site. If these migration documents should be published there, adding them is a
separate, deliberate change.*
