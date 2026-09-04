# Preserved quirks

The catalogue of 2013-era defects and oddities that the Node 22 / hapi 21 migration **preserves
rather than repairs**. It is the named deliverable of rule **R-d**, which prohibits behaviour
"improvements": a quirk is recorded and left working.

## Why this document has two halves per entry

The compatibility layer that *produced* many of these outcomes is deleted by this migration.
`lib/util/routeParser.js` used to intercept an `undefined` handler return and substitute a deferred
value; handlers now return their responses through the toolkit. **Deleting the mechanism does not
preserve the outcome.** An entry that recorded only what the shim did would leave nothing to build
against.

So every entry below carries:

1. a **measured baseline outcome** — what a client observed at base commit `2f8712a`, with the
   address of the code that produced it and a statement of how it was measured; and
2. a **target disposition** — the construction in the migrated tree that reproduces that same
   observable outcome.

Two entries are the exception and are labelled as such: §11 records the only two **approved
deviations**, where something is deliberately *not* preserved.

## Citation convention: two trees

The migration is applied in this repository, so the shim no longer exists here. Addresses are
therefore qualified, and the two must not be conflated:

| Form | Tree | How to retrieve it |
|---|---|---|
| `[B path:lines]` | **Baseline**, at `2f8712a` | `git show 2f8712a:path` |
| `[T path:lines]` | **Target**, the delivered working tree | `sed -n 'lines p' path` |

Where the AAP's locator was approximate it has been corrected silently against the tree and the
verified value is cited. Three corrections are substantive rather than cosmetic and are called out
where they occur: the pre-handler wrapper in §2, the `success.redirect` reference in §3, and the
reach of the malformed injected URL in §7.

## Evidence legend

| Tag | Meaning |
|---|---|
| **probe** | Executed in this tree and the result read from its output |
| **static** | Read directly from the cited source, with counts obtained by search over a named file set |
| **artifact** | Recorded in a committed parity artifact (`test/parity/*.json`) whose values were produced by a run |
| **scenario defined** | A scenario for this outcome is **committed** in `test/parity/corpus.json` with its steps, identity, fixture profile and expectation — but no response has been recorded into it. It is a specification of what will be compared, not a comparison |
| **pending** | Not verifiable from this tree yet; the gate that settles it is named |

**Two tags used to be one, and separating them is the point.** An earlier revision of this document
tagged several entries "corpus", and defined that tag as "driven by the replay gate". That conflated
three states that are now kept apart: a *committed scenario definition*, a *recorded baseline
measurement*, and a *driven comparison between the two trees*. The corpus now carries the first two
for every scenario; the third is run for one scenario and is otherwise outstanding, and no entry below
claims a comparison that has not been made.

### Capture status, stated once, because every "scenario defined" tag depends on it

Measured in the delivered tree (probe, over `test/parity/corpus.json`):

```text
summary.captured         -> true
summary.scenarios        -> 383
summary.baselinesPending -> 0
scenarios with a recorded baseline -> 383 of 383
summary.recordedSteps    -> 394   (segmentsMerged 2, timedOutSteps 2)
summary.routesRepresented -> 233 of 233
provenance sidecar        -> present (corpus.json.provenance.json, baseline.commit 2f8712a112db…)
expectedDeviation markers present -> 1  (quirk.reply-chain.never-settles.image-download)
```

So the corpus at this commit holds **383 scenario definitions and 383 recorded responses**, driven
against a worktree at the base commit. Every reference below to a corpus scenario is therefore a
reference to a **committed definition, its declared expectation and a recorded baseline value**. What
is not yet run for most scenarios is the **comparison** against the delivered tree: `replay.js`
refuses the committed artifact because its provenance is written in the capturing tool's own
vocabulary and names a generator this repository cannot retrieve, so `verify:corpus` exits 2 until the
corpus is re-captured through the delivered generator. That precondition, and the command that settles
it, are in [`baseline-parity.md`](baseline-parity.md) §2.8; §8's first row carries it as the one open
parity item. Where an entry's *measured* half needed evidence beyond the corpus, it is a **probe** or
a **static** read taken in this tree, and it is tagged as such.

**What this does not weaken.** A scenario definition is not a placeholder: it fixes the route, the
identity, the fixture profile, the step sequence and the expectation, so the measurement it will carry
is already specified and cannot be quietly re-scoped. What it cannot do is stand in for the
measurement, which is why it is no longer labelled as one.

## Rules that govern this catalogue

`review_rules` reports that **no user-specified rules were provided** for this project, which
AAP §0.7 and §0.10.1 independently record. No rules are invented in their place and their absence is
not read as licence to lower the bar — enterprise practice governs, which here means that every
claim carries its evidence and every preserved outcome is bound to a gate rather than to an
intention.

The binding constraints are the request's own RULES block, carried by the AAP. Each is cited by name
and summarised, never reproduced:

- **R-d** — behaviour improvements prohibited. This document is its deliverable. Where observable
  behaviour differs from what the code evidently intended, **the observable behaviour governs**. No
  entry here proposes a repair; the one legitimate follow-up in the whole migration is named in
  `docs/deferred-dependencies.md`.
- **R-f** — baseline observed behaviour at `2f8712a` is the tie-breaker, and each resolution is
  documented. Every "measured" line below is tagged with how it was taken, and — where the tree it was
  taken on could matter — **which tree**: the baseline addresses carry `[B …]`, and the four entries
  measured on the target tree say so in the measurement line itself (§7.1, §9.7, §10.2, §10.3). R-d
  and R-f do not conflict: on whether behaviour or intent governs, they agree. Where a measurement
  contradicts what AAP §0.6.6 assumed, R-f decides it for the measurement, and §10.2 is that case.
- **R-e** — error-to-response mappings survive the async conversion unchanged. Several entries here
  are error edges. This document records the *behavioural* outcome; the per-edge status, payload and
  timing belong to `docs/error-edge-inventory.md`. Cross-referenced, not restated.
- **R-b** — the application genuinely runs, with no route or module excluded. R-b is one side of the
  single conflict in this catalogue, decided in §11.1.
- **R-a** — the diff reads as four things only: runtime bump, hapi API migration, async conversion,
  blocking-only dependency swaps. §9.6 records the corrections **rejected** on that test, so a
  reviewer can see the scope gate was applied rather than assumed.
- **PRESERVE / EXCLUDE** — each PRESERVE clause is bound to a gate. Every entry below names the gate
  that proves it still holds.

## Index

| § | Quirk | Baseline outcome | Gate |
|---|---|---|---|
| [1](#1-three-routes-bound-to-controller-methods-that-do-not-exist) | Three routes name nonexistent controller methods | 200 through the parser's no-controller fallback | Route manifest + 3 corpus scenarios |
| [2](#2-two-live-pre-handler-301-redirects-that-never-fire) | Two pre-handler 301 redirects never fire | Redirect discarded, pre value `null` | 2 corpus scenarios |
| [3](#3-a-cross-request-state-leak-in-failredirect) | `fail.redirect` cross-request state leak | Request #2 redirects to request #1's target | 2-step corpus scenario |
| [4](#4-reply-chain-outcomes-eight-chains-three-categories) | Eight reply chains, three categories | Never-settles / header-resolved / builder returned | 8 corpus scenarios |
| [5](#5-two-pages-handlers-that-answer-500-to-authenticated-visitors) | `/login` and `/signup` answer 500 when logged in | 500, not a redirect | `test/lib/api/pages.js` + 2 corpus scenarios |
| [6](#6-google-oauths-new-user-path-saves-the-user-and-then-reports-failure) | OAuth new user created, then failure reported | Account persisted, generic failure, not logged in | 3 corpus scenarios |
| [7](#7-folderstrinkets-builds-a-malformed-injected-url-when-no-query-is-present) | `folders.trinkets` malformed injected URL | Queryless: 200 `{"data":[]}`, no listing invoked | 2-step corpus scenario |
| [8](#8-the-streaming-asset-fetchs-two-failure-modes-and-recaptchas-faults) | Streaming asset fetch and reCAPTCHA faults | Unsettled request; two uncaught throws | 3 corpus scenarios + fixture profiles |
| [9](#9-the-remaining-preserved-items) | Inert language maps, inert leak detection, retained logging, config gap, dead-code deletion, rejected cosmetics | Various, each recorded below | joi matrix, boot, R-a review |
| [9.7](#97-a-routed-handler-that-answers-500-where-its-author-intended-403) | `courses.download`'s unauthorized branch evaluates an unbound `Boom` | 500, not the 403 the expression names | Route sweep scenario + error-edge inventory |
| [10](#10-additional-measured-findings) | Findings beyond AAP §0.6.6 | In-memory queue events unreachable; inert test-mode mail guard; undeclared `chokidar` | Worker harness |
| [11](#11-the-two-approved-deviations) | **Approved deviations** — not preserved, and the register is **closed at two** | Stream response served; `marked` fork retained | Deviation allowlist in replay; audit |
| [A](#appendix-a--the-quirk-allow-list-for-generated-target-actions) | **Allow-list** — the sites whose governing target action a generator must not override | n/a — a contract, not a quirk | `docs/conversion-inventory.md` regeneration |

---

## 1. Three routes bound to controller methods that do not exist

**Measured** (static, plus probe). Three registered routes name controller methods that are not
defined in their controllers:

| Route | Named binding | Controller |
|---|---|---|
| `POST /api/interest` | `pages.interest` | `lib/controllers/pages.js` |
| `GET /api/trinkets/popular` | `trinket.mostActive` | `lib/controllers/trinket.js` |
| `GET /api/trinkets/active` | `trinket.risingActive` | `lib/controllers/trinket.js` |

The parser resolves a controller method at `[B lib/util/routeParser.js:266]`. When the lookup yields
nothing, the per-request wrapper takes its `else` branch at `[B lib/util/routeParser.js:574-576]`,
which returns `request.success(request.params)` — the request's own path parameters, projected
through the route's reply spec. All three answer **200** on that basis and have never reached a
controller. Generating the route manifest in the delivered tree records all three with
`handlerKind: "missing-controller-fallback"`. Measured (probe —
`NODE_CONFIG='{"db":{"redis":{"enabled":false}}}' NODE_ENV=test node test/parity/manifest.js --out <path>`,
run in this tree, exit 0):

```text
entries      233
handlerKind  function 226 · options.handler 2 · missing-controller-fallback 3 · inert-directory 2
the three    GET /api/trinkets/active · GET /api/trinkets/popular · POST /api/interest
```

**The manifest is generated on demand, not committed**, so this entry is tagged **probe** rather than
**artifact**: `test/parity/route-manifest.json` is absent from the tree by design — the generator
writes only where `--out` points it — and the value above is the output of the command shown, not a
file a reader can open. The two committed artifacts this document does cite as artifacts are
`test/parity/joi-baseline.json` and its provenance sidecar.

**Target disposition.** The fallback branch is preserved verbatim, at
`[T lib/util/routeParser.js:456-458]`. All three routes keep answering exactly as they did.

**The trap, stated explicitly.** That `else` branch sits **four lines below** the response-emulation
block this migration removes:

```javascript
// [B lib/util/routeParser.js:567-576]  — REMOVED and PRESERVED, four lines apart
          // If handler didn't return a value, wait for request.success/fail to be called
          if (result === undefined) {                 // :568  <-- REMOVED with the emulation
            result = await responsePromise;           // :569  <-- REMOVED
          }                                           // :570

          return result;
        }
        else {                                        // :574  <-- PRESERVED
          return request.success(request.params);     // :575  <-- PRESERVED
        }                                             // :576
```

The interception goes; the fallback stays. Removing the second by association with the first is the
single most likely accidental regression in this migration, and it would turn three 200s into 500s
(`handler is not a function`) with nothing in the controllers to explain why.

**Gate.** The route manifest carries the three as `missing-controller-fallback`, so the disposition is
visible rather than inferred. Corpus scenarios, group `quirk.missing-controller-fallback`:
`quirk.fallback.post.api-interest`, `quirk.fallback.get.api-trinkets-popular`,
`quirk.fallback.get.api-trinkets-active` — each expecting 200, and the two `trinket` cases driven as
the seeded admin because those routes carry an `isAdmin` pre-handler that would otherwise forbid the
request before the fallback is reached.

---

## 2. Two live pre-handler 301 redirects that never fire

**Measured** (static). Two named pre-handlers build a permanent redirect and hand it to the shim:

| Pre-handler | Address | Branch |
|---|---|---|
| `findTrinket` | `[B lib/util/helpers.js:182]` | Requested language does not match the trinket's own |
| `courseBySlug` | `[B lib/util/helpers.js:385]` | Requested slug is a stale alias of the course's current slug |

Both call `reply().redirect(location).permanent().takeover()`. Neither redirect has ever been
emitted. The shim's fake `reply` settles its deferred on the *first* call, and calling `reply()` with
no argument is that first call:

```javascript
// [B lib/util/routeParser.js:87-106]  — the object-form pre-handler wrapper
var fakeReply = function(value) {
  if (value && value.isBoom) { reject(value); }
  else { resolve(value === undefined ? null : value); }   // :93  <-- SETTLES WITH null HERE
  return {
    redirect: function(url) {
      var redirectResponse = { _isRedirect: true, url: url, _permanent: false, _takeover: false };
      return {
        permanent: function() { redirectResponse._permanent = true; return this; },   // :100
        takeover:  function() { redirectResponse._takeover  = true;
                                resolve(redirectResponse); return this; }             // :101  <-- too late
      };
    },
    takeover: function() { return this; }
  };
};
```

`reply()` resolves `null` at `:93`; `.redirect(...).permanent().takeover()` then runs and calls
`resolve` again at `:101`, but a promise settles once, so the redirect object is discarded. The
measured result is that the pre value is `null`, no 301 is emitted, and the handler runs on.

**Substantive correction to the AAP's locators.** AAP §0.6.6 cites `:147` and `:154` for this
mechanism. Those lines are in the *second* wrapper — the one for a pre-handler passed as a bare
function — which is a behaviourally identical duplicate of the block above. Neither of these two
pre-handlers traverses it:

- `findTrinket` is exported as an object, `{ assign: 'trinket', method: function(...) }`
  `[B lib/util/helpers.js:143-145]`;
- `courseBySlug` is exported as a bare function `[B lib/util/helpers.js:367]` but every route wraps
  it as `{ method: helpers.courseBySlug, assign: 'course' }`.

Both are therefore objects carrying a function `method`, and both take the object-form wrapper at
`[B lib/util/routeParser.js:79-125]`, settling at `:93` and reaching `:101` too late. The
bare-function duplicate is used by exactly **one** pre entry in the whole route surface —
`helpers.verifyEmailToken` on `POST /api/trinkets/{trinketId}/email` (manifest pre kinds: 139 string,
148 object-with-function, 1 function). The outcome the AAP describes is exact; the copy it cites is
not the one these two traverse.

**Target disposition.** Both pre-handlers **return `null`**, which is the value the shim produced. In
the delivered tree `findTrinket`'s language-mismatch branch is `return null;` at
`[T lib/util/helpers.js:183]`, with the redirect construction removed rather than converted, because
converting it would emit a 301 that baseline never emitted.

The redirect markers are removed with the emulation: `_isRedirect`, `_permanent` and `_takeover`
occur on exactly **six lines**, all of them the lines that define them
(`[B lib/util/routeParser.js:98,100,101,151,153,154]`), and nothing anywhere reads them. The
capability is dead end to end, so there is no consumer to preserve.

**Coverage is counted from the route manifest, not from lexical references.** Counting `require`
sites or call sites understates the affected surface, because the per-language expansion loop
multiplies one declaration into eleven routes. Measured by matching the pre-handler's own function
identity against the 228 pre-parse route objects (probe):

| Pre-handler | Lexical references | **Routes actually affected** | Composition |
|---|---|---|---|
| `findTrinket` | 8 | **18** | 4 literal in `config/routes.js` + 11 from the language loop `[B config/routes.js:584]` + 3 in `config/api_routes.js` (`:1003`, `:1146`, `:1168`) |
| `courseBySlug` | 5 | **5** | 5 literal in `config/routes.js`; none inside the loop |

`config.constants.trinketLangs` holds 11 languages and the loop pushes 5 routes per language, which
is where the multiplication comes from.

**Gate.** Corpus scenarios, group `quirk.dead-pre-handler-301`, both asserting the response is **not**
a 301:

- `quirk.dead-301.find-trinket-language-mismatch` — a `python` trinket addressed through the `/html`
  prefix, which is what selects the language-mismatch branch.
- `quirk.dead-301.course-by-slug-alias` — two steps, because the alias has to be created first: step 1
  renames the seeded course (the model links the old slug to the course id on save), step 2 addresses
  the course by the now-stale slug.

---

## 3. A cross-request state leak in `fail.redirect`

**Measured mechanism** (static, plus probe). The parser captures a route's `fail` specification
**once, at parse time**, and the long-lived handler closure holds it by reference:

| Address | Role |
|---|---|
| `[B lib/util/routeParser.js:261]` | `fail = route.fail \|\| {}` — captured once while parsing the route |
| `[B lib/util/routeParser.js:310]` | `route.handler = async function(request, h) {` — the closure holds `fail` by reference for the life of the process |
| `[B lib/util/routeParser.js:491]` | `fail.redirect = StringUtils.interpolate(fail.redirect, json);` — **assigns the interpolated value back onto that captured object** |

So the first validation failure on such a route consumes the template: the placeholder is replaced by
that request's value, and every later request redirects to the first request's target. Reproduced with
the repository's own `lib/util/stringUtils` (probe):

```text
parse-time template : /courses/{courseId}/edit
after request #1    : /courses/AAA/edit
after request #2    : /courses/AAA/edit   <-- request #2 redirects to request #1's target
```

**Blast radius: exactly three routes.** Twelve routes declare a `fail.redirect`, but only a template
containing a placeholder can be corrupted — interpolating a literal string yields the same string, so
the assignment is idempotent for the other nine (verified by the same probe: `/login` stays `/login`
across two requests with differing payloads). The three templated routes, read from the route
manifest:

| Route | `fail.redirect` template |
|---|---|
| `POST /users` | `/{formName}` |
| `GET /activate-account` | `/{redirectTo}` |
| `POST /activate-account` | `/{redirectTo}` |

**`success.redirect` is unaffected**, and this is a second substantive correction to the AAP's
locator. AAP §0.6.6 cites `[lib/util/routeParser.js:450]` as its "only reference, a comparison"; that
line is a `success.html` comparison and is unrelated. `success.redirect` has two references:

- `[B lib/util/routeParser.js:298]` — `success.redirect = route.redirect;`, an assignment that runs
  **at parse time**, once, not per request;
- `[B lib/util/routeParser.js:415]` — `var redirectUrl = (json && json.redirectTo) || success.redirect;`,
  a **read into a local**. The interpolation then happens inside `redirect()`
  `[B lib/util/routeParser.js:710]` on that local value, and nothing is ever assigned back.

The captured object is therefore never mutated per request, which is exactly the difference from
`fail.redirect` at `:491`. Confirmed by probe: after a request interpolates `/{lang}` to `/python`,
`success.redirect` still reads `/{lang}`.

**Target disposition.** The in-place assignment at `:491` is kept exactly as it is, inside the
preserved `request.fail` funnel. Removing it — for instance by interpolating into a local, the way
`request.success` already does four lines of reasoning away — would silently repair the leak, which
R-d prohibits.

**Gate.** A **two consecutive request** corpus scenario, which is mandatory rather than convenient: a
single request cannot observe this, because the first request's response is correct. Scenario
`quirk.fail-redirect-leak.post-users`, group `quirk.fail-redirect-leak`: step 1 posts
`formName=signup` and step 2 posts `formName=login`, both omitting the required fields so that both
fail validation; both are expected to answer 302 to `/signup`, and the expectation carries a cross-step
assertion that the two `Location` headers are **equal**. If a future change repairs the leak, step 2
redirects to `/login` and that cross-assertion fails.

---

## 4. Reply-chain outcomes: eight chains, three categories

### The mechanism

The shim's `reply(data)` returns a chainable builder `[B lib/util/routeParser.js:375-405]`, and the
builder's methods are **not uniform in whether they settle the deferred**:

| Builder method | Address | Settles the deferred? |
|---|---|---|
| `.type(mimeType)` | `[B lib/util/routeParser.js:386-389]` | **No** — returns `builder` |
| `.bytes(length)` | `[B lib/util/routeParser.js:390-393]` | **No** — returns `builder` |
| `.redirect(url)` | `[B lib/util/routeParser.js:376-380]` | Yes |
| `.code(statusCode)` | `[B lib/util/routeParser.js:381-385]` | Yes |
| `.header(name, value)` | `[B lib/util/routeParser.js:394-399]` | Yes |
| `.view(template, ctx)` | `[B lib/util/routeParser.js:400-404]` | Yes |

So **what a client receives depends on which chain method ran last**, and on whether the handler
returned the builder or nothing at all. Removing the builder removes a mechanism, not a single
outcome: the eight chains fall into three categories with materially different results.

There are **13** `.type()` / `.bytes()` calls across **8** chains, counted by search over
`lib/controllers/*.js` at baseline (static). The categories reconcile exactly:
**1 never-settling + 4 header-resolved + 3 builder-returning = 8**.

### The eight chains, classified

| # | Chain | Enclosing handler | Route | Category |
|---|---|---|---|---|
| 1 | `[B lib/controllers/files.js:98-100]` | `files.download`, image branch | `GET /api/files/{fileId}/{fileName}` | **Never settles** |
| 2 | `[B lib/controllers/files.js:102-105]` | `files.download`, non-image branch | `GET /api/files/{fileId}/{fileName}` | Header-resolved |
| 3 | `[B lib/controllers/courses.js:269-272]` | `courses.download`, `returnZip` callback | `GET /{userSlug}/courses/{courseSlug}/download.zip` | Header-resolved |
| 4 | `[B lib/controllers/trinket.js:1383-1386]` | `downloadPostedZip` `[B :1291]` | `POST /api/trinkets/download` | Header-resolved |
| 5 | `[B lib/controllers/trinket.js:1548-1551]` | `downloadZip` `[B :1453]`, reached through `getByShortCode` `[B :481]` via the format map `[B :29]` | `GET /{lang}/{shortCode}` | Header-resolved |
| 6 | `[B lib/controllers/trinket.js:1204]` | `downloadMain` `[B :1174]` | `GET /{lang}/{shortCode}/` | Builder returned |
| 7 | `[B lib/controllers/trinket.js:1246]` | `downloadFile` `[B :1210]`, code branch | `GET /{lang}/{shortCode}/{path*}` | Builder returned |
| 8 | `[B lib/controllers/trinket.js:1259]` | `downloadFile` `[B :1210]`, asset branch | `GET /{lang}/{shortCode}/{path*}` | Builder returned |

### 4.1 Never settles — one chain

**Measured** (static; scenario defined). Chain 1:

```javascript
// [B lib/controllers/files.js:97-106]
    if (/^image/.test(request.pre.file.type)) {
      reply(stream)
        .type(request.pre.file.mime)
        .bytes(request.pre.file.size);          // no return, no resolving call
    } else {
      reply(stream)
        .type(request.pre.file.mime)
        .bytes(request.pre.file.size)
        .header('Content-Disposition', 'attachment; filename=' + request.pre.file.name);
    }
```

The image branch has **no `return`** and ends on `.bytes()`, which does not settle. The handler
returns `undefined`, the emulation waits on a deferred nothing will ever resolve, and the request
hangs. The branch is selected by the file document's `type` field, so it is reached by records whose
`type` carries a mime-like string such as the legacy literal `image/png`.

**This is the one place in this catalogue where preservation collides with R-b, and it is the subject
of approved deviation 1 — see [§11.1](#111-deviation-1-the-never-settling-file-response).**

### 4.2 Header-resolved and working — four chains

**Measured** (static; scenario defined). Chains 2–5 each continue to `.header(...)`, which settles the
deferred and returns a real hapi response. They produce ordinary, working responses today:

- chain 2 — 200, the file's own content type and byte count, and an unquoted
  `attachment; filename=<name>`;
- chain 3 — a zip archive, produced inside nested callbacks (a `stat`, then a recursive directory
  delete) so that the response is only built after the delete callback fires;
- chains 4 and 5 — zip archives with a `Content-Disposition` attachment name.

**Target disposition: identical responses.** These four are returned through the toolkit with the same
chain and the same header, so status, content type, byte count and `Content-Disposition` are unchanged.

**They must not become collateral damage of the decision in §11.1.** Chain 2 is the sibling four lines
below chain 1 and performs the identical chain; the deviation in §11.1 adopts *chain 2's* response for
chain 1. That reasoning applies to chain 1 alone. Chains 2–5 already answered correctly at baseline
and are preserved exactly, with no header added and none removed.

### 4.3 Builder returned to hapi — three chains

**Measured** (static; scenario defined). Chains 6–8 each do `return reply(...).type(type)`. Because
`.type()` returns the builder rather than a response, the handler hands the wrapper a **plain builder
object**, not a hapi response — and because `.type()` does not settle, what a client receives depends
on whether the deferred had already been settled earlier in the request:

```javascript
// [B lib/controllers/trinket.js:1204]  downloadMain
        return reply(code[0].content).type(type);
// [B lib/controllers/trinket.js:1246]  downloadFile, code branch
          return reply(file.content).type(type);
// [B lib/controllers/trinket.js:1259]  downloadFile, asset branch
              return reply(stream).type(type);
```

**Target disposition: the baseline status, content type and body are to be reproduced**, captured from
the baseline server before conversion rather than reasoned about. This is the one category in this
document whose target disposition **cannot be stated from a static read**: what the builder emits
depends on run-time state, so the specification for these three responses is a measurement that has
to be taken. That is why these three carry the instruction that they be captured at baseline first.

**Gate.** The three `quirk.reply-chain.builder-returned.*` scenarios in the table at the end of this
section. Their step definitions are committed; **their baseline values are not yet recorded**
(`baseline: null`, see [capture status](#capture-status-stated-once-because-every-scenario-defined-tag-depends-on-it)),
so at this commit the gate is a defined comparison rather than a completed one. Until the capture is
driven, no value in this sub-section may be cited as the specification — there is nothing to cite.

### 4.4 One further unreturned reply on an error path

**Measured** (static). `[B lib/controllers/trinket.js:375]` calls `reply(err);` with **no `return`**,
inside a `.catch` handler. Passing an error to the shim's `reply` settles the deferred with a Boom
`[B lib/util/routeParser.js:361-368]`, so the response is produced even though the value is discarded
— the missing `return` is invisible here precisely because the shim settled out of band. The adjacent
`[B lib/controllers/trinket.js:372]` calls `request.success({data:doc})` the same way.

**Target disposition.** Both values are **returned**, which is what makes the same response reach the
client once the deferred is gone. The missing `return` is not preserved as a missing `return`: under
the emulation it was inert, because the shim had already settled out of band, whereas after
conversion an unreturned value means the handler returns `undefined` and the toolkit converts that
into a different error. Preserving the *outcome* therefore requires changing the *statement* — which
is the mechanism-versus-outcome distinction this document exists to make. The resulting status and
payload are unchanged; the per-edge detail belongs to `docs/error-edge-inventory.md`.

**Gate.** The route sweep covers both sites' routes, and `docs/error-edge-inventory.md` carries the
per-edge assertion.

**Gate.** One corpus scenario per chain, eight in total — all eight **defined**, none yet driven. The
"expectation" column is each scenario's committed declared expectation, which is what the comparison
will assert; it is not a recorded result:

| Chain | Corpus scenario | Declared expectation |
|---|---|---|
| 1 | `quirk.reply-chain.never-settles.image-download` | Baseline: expected **timeout**. Target: 200 stream (§11.1) |
| 2 | `quirk.reply-chain.header-resolved.file-download-attachment` | 200 with `content-disposition` present |
| 3 | `quirk.reply-chain.header-resolved.course-download-zip` | A real archive response |
| 4 | `quirk.reply-chain.header-resolved.posted-zip-download` | A real archive response |
| 5 | `quirk.reply-chain.header-resolved.short-code-zip` | A real archive response |
| 6 | `quirk.reply-chain.builder-returned.download-main` | Whatever the builder produced, recorded exactly |
| 7 | `quirk.reply-chain.builder-returned.download-code-file` | Whatever the builder produced, recorded exactly |
| 8 | `quirk.reply-chain.builder-returned.download-asset` | Whatever the builder produced, recorded exactly |

---

## 5. Two `pages` handlers that answer 500 to authenticated visitors

**Measured mechanism** (static, plus probe). The shim declares `reply` as a **bare function**
`[B lib/util/routeParser.js:360]`. Only the object that function *returns* carries `.redirect`,
`.code`, `.type`, `.bytes`, `.header` and `.view` `[B lib/util/routeParser.js:375-405]`. So calling
`reply()` and chaining works, but reading a property **off `reply` itself** finds nothing:

```javascript
// [B lib/util/routeParser.js:360]
        var reply = function(data) {        // <-- a bare function; `.redirect` is not on it
```

Two handlers do exactly that, and they are the **only two `reply.<property>` accesses in the
repository** (search over `lib/**/*.js` and `config/*.js` for `\breply\.[A-Za-z_]` returns 2 hits,
both in `pages.js`):

| Address | Route | Statement |
|---|---|---|
| `[B lib/controllers/pages.js:17]` | `GET /login` | `return reply.redirect('/home');` |
| `[B lib/controllers/pages.js:27]` | `GET /signup` | `return reply.redirect('/welcome');` |

Both sit on the `if (request.auth.isAuthenticated)` branch, so an **authenticated** visitor to the
login or signup page throws `TypeError: reply.redirect is not a function`. The throw reaches the
handler catch-all `[B lib/util/routeParser.js:578-589]`, which returns
`Boom.badImplementation(err.message)` — a **500**. For a browser request the error extension then
renders the 50x page. The contrast that proves the mechanism is four lines further on: `pages.welcome`
uses the *called* form, `reply().redirect('/home')` `[B lib/controllers/pages.js:40]`, and works.

**Why this was never caught.** `test/smoke-test.sh` asserts 200 for `/login` and `/signup`, and that
assertion **is correct** — it probes both paths **anonymously**, which takes the `else` branch and does
answer 200. The authenticated branch simply had no coverage, and it now has some:
`test/lib/api/pages.js` asserts the 500 and the rendered `50x.html` for both paths while holding a
session.

The smoke test **remains unauthenticated by decision** — it has no credential store, no cookie jar and
no fixtures, so inventing identity mechanics in shell would duplicate the database-backed Mocha
harness — but it is not unchanged, and three edits to it are recorded here rather than implied away.
Its default base URL and the usage comment above it moved from port **3001** to **3000**, which is the
port `config/default.yaml` serves on. Its `/api` and `/library` expectations moved from **200** to the
measured **404**, because neither path has a registered route (see the entry for the unrouted page
surface). And every `curl` invocation gained `--connect-timeout` and `--max-time`, `-S` so that curl's own
message survives `-s`, captured transport diagnostics, and — the part that actually closes the hole —
**a non-zero curl exit now fails the check in its own right, before the status or the body is
consulted**. That last rule matters because `-w "%{http_code}"` prints whatever curl managed to
observe: without it, a run in which every request timed out reported eleven passes and exited 0.
Measured with an interposed `curl` that printed a plausible status and exited 28: **0 passed, 11
failed, exit 1**. A wedged endpoint — of which this application has at least one — now fails the
script instead of holding it open or passing quietly. Its `/login` and `/signup` expectations are the part that did not
change.

**Target disposition: reproduce the 500.** The delivered handlers keep the expression rather than
converting it — `[T lib/controllers/pages.js:25]` and `[T lib/controllers/pages.js:37]` still read
`return reply.redirect(...)`. Writing `h.redirect('/home')` would turn a 500 into a working 302, which
is precisely the improvement R-d prohibits.

**A measured nuance that matters, because the thrown error is not the same one.** In the converted
handlers the second parameter is named `h`, so `reply` is not a binding in scope at all and the
expression throws `ReferenceError: reply is not defined` instead of the baseline
`TypeError: reply.redirect is not a function`. The **client-visible response is nevertheless identical**,
because hapi's Boom redacts the message of a 500. Measured with the installed `@hapi/boom` (probe):

```text
Boom.badImplementation('reply.redirect is not a function')
  -> 500 {"statusCode":500,"error":"Internal Server Error","message":"An internal server error occurred"}
Boom.badImplementation('reply is not defined')
  -> 500 {"statusCode":500,"error":"Internal Server Error","message":"An internal server error occurred"}
```

Status, error label and payload are byte-identical; only the server-side log line differs. The
preservation therefore holds at the client boundary, which is the boundary R-d and R-e protect.

**Correction carried explicitly.** An earlier draft of the analysis placed
`request.yar.set('next', …)` before the authenticated throw. It does not. In both handlers the
`yar.set` sits inside the **`else` branch** and is reached only on the unauthenticated path:

| Handler | `else` branch | `yar.set('next', …)` |
|---|---|---|
| `login` | `[B lib/controllers/pages.js:18-23]` | `[B lib/controllers/pages.js:19-21]` |
| `signup` | `[B lib/controllers/pages.js:29-36]` | `[B lib/controllers/pages.js:30-32]` |

So no session mutation precedes the 500; the `next` value is stored on the unauthenticated path only,
and that is where it is preserved.

**Gate.** `test/lib/api/pages.js` asserts status 500 for an authenticated `GET /login`
(`[T test/lib/api/pages.js:66-68]`) and an authenticated `GET /signup`
(`[T test/lib/api/pages.js:88-90]`), driven while logged in. The suite runs because `'pages'` is
inserted into the fixed `sequence` array in `[T test/lib/api/index.js:2-13]`, without which a new file
in `test/lib/api/` is never invoked. Corpus scenarios, group `quirk.authenticated-page-500`:
`quirk.authed-500.get.login` and `quirk.authed-500.get.signup`, both expecting 500; the anonymous 200s
are covered by the route sweep, so the pair together is what pins the branch.

---

## 6. Google OAuth's new-user path saves the user and then reports failure

**Measured** (static; scenarios defined). In `auth.googleCallback` `[B lib/controllers/auth.js:35]` the
existing-user branch `[B lib/controllers/auth.js:105-129]` can succeed. The **new-user** branch
`[B lib/controllers/auth.js:130-156]` does the following, in order:

1. builds the user and **persists it** — `user.save()` at `[B lib/controllers/auth.js:146]`;
2. **mutates session state** in the save's `then` — `yar.set('next', '/welcome')` when no `next` was
   stored, and `yar.set('grantDemoTrinkets', true)`
   `[B lib/controllers/auth.js:148-151]`; earlier in the chain it has already called `yar.reset()`,
   re-set `next`, and set `loggedInWith` to `google` `[B lib/controllers/auth.js:99-103]`;
3. **throws** at `[B lib/controllers/auth.js:152]` — `request.yar.flash('userAccountCreated',
   JSON.stringify(opts))`, where `opts` is undeclared. It is the only occurrence of that identifier in
   the file, so the reference throws `ReferenceError: opts is not defined`;
4. the throw propagates to the chain's `.catch` `[B lib/controllers/auth.js:185-188]`, which returns
   `request.fail({ message: 'Authentication failed. Please try again.' })`.

**So a first-time Google sign-in creates the account and reports failure.** Two further measured
details sharpen it: the `userAccountCreated` flash is never set, because the throw happens while
evaluating its argument; and `request.yar.set('userId', user.id)`
`[B lib/controllers/auth.js:161]` lives in the *next* `.then`, which is never reached — so the new
account is persisted but the visitor is **not logged in**. Signing in a second time takes the
existing-user branch and succeeds.

The identical fault, `JSON.stringify(opts)` against an undeclared `opts`, also existed at
`[B lib/auth/passport.js:124]` in the unreachable passport module (see §9.5) — the same defect,
carried into the live controller.

**Target disposition: reproduce it** — the same persistence, the same session mutations in the same
order, the same generic failure response, and the same absence of a login.

**Gate.** Corpus scenarios, group `quirk.oauth`, driven through the recorded OAuth fixtures in
`test/parity/fixtures/http.js` so that no request reaches the network:

| Scenario | Fixture profile | Expectation |
|---|---|---|
| `quirk.oauth.new-user-created-then-failed` | `oauth:success-new-user` (an unseeded email) | The callback reports failure while having persisted the user |
| `quirk.oauth.existing-user-succeeds` | `oauth:success-existing-user` | An ordered pair of steps whose bodies differ, step 2 taking the existing-user branch |
| `quirk.oauth.no-authorization-code` | none recorded | Refused before any external call, which also proves no path here reaches the network |

The fixture additionally records the provider-side branches this quirk does not cover —
`oauth:token-malformed-body`, `oauth:token-non-object-body`, `oauth:token-transport-failure`,
`oauth:profile-missing-email` and `oauth:profile-transport-failure` — whose per-edge outcomes belong to
`docs/error-edge-inventory.md`.

---

## 7. `folders.trinkets` builds a malformed injected URL when no query is present

**Measured** (static, plus probe; scenario defined). The handler builds a URL by concatenation and
injects it back into the server:

```javascript
// [B lib/controllers/folders.js:38-43]
  trinkets : async function(request, reply) {
    var folder = request.pre.folder;
    var url = '/api/trinkets' + request.url.search + '&folder=' + folder.id;   // :40
    try {
      var response = await request.server.inject({ url : url, ... });          // :43
```

`request.url` is a WHATWG `URL`, so `search` is the empty string when no query string was sent. The
`&` is only a separator when a `?` has already appeared, so the two cases diverge (probe, parsing the
constructed string):

| Request | Constructed URL | Parsed pathname | Parsed query |
|---|---|---|---|
| No query string | `/api/trinkets&folder=FID` | `/api/trinkets&folder=FID` | `{}` — **no `folder`** |
| `?q=abc` | `/api/trinkets?q=abc&folder=FID` | `/api/trinkets` | `{ q: 'abc', folder: 'FID' }` |

**Substantive correction, stronger than the AAP.** AAP §0.6.6 states that `folder` is not parsed as a
query parameter and that `trinket.list` therefore receives no folder filter. The measured behaviour
goes further: because the whole `&folder=…` fragment lands in the **path**, the request does not match
`GET /api/trinkets` at all. It is swallowed by the Inert catch-all `GET /{path*}`, which looks for a
file of that name and answers 404 — so **`trinket.list` is never invoked**. The injected result then
carries no `data`, and the outer handler answers **200 with an empty list**. The delivered
implementation records the same measurement independently, including the evidence that identified the
responder — the injected 404's stack running through `@hapi/inert`'s file and directory handlers —
at `[T lib/controllers/folders.js:162-186]`.

**Target disposition: reproduce both cases.** The extraction that replaces the internal
`server.inject` passes the folder to the shared listing core **only for the query-bearing case**, and
passes nothing for the queryless case:

```javascript
// [T lib/controllers/folders.js:185-187]
    var listOptions = request.url.search
      ? injectedTrinketListOptions(request.query, folder)
      : null;
```

Passing the folder in both cases would hand the queryless request real data for the first time, which
is a behaviour change and is prohibited. The delivered code also records why the queryless case cannot
be served by simply calling the core without a folder: there is no unfiltered mode, and omitting the
folder selects the trinkets that are in **no** folder, so a folder page would list the visitor's
unfiled trinkets instead — a different wrong answer rather than the baseline one.

**Gate.** A two-step corpus scenario, `quirk.folders-trinkets.queryless-and-query-bearing`, group
`quirk.folders-trinkets`, on `GET /api/folders/{folderId}/trinkets`. The two steps carry **different
kinds of clause**, and the difference is the gate rather than an accident of drafting:

| Step | Driven | Declared clause | What the clause is for |
|---|---|---|---|
| 1 | bare, no query string | `status: 200` **and** `bodyIncludes: "data":[]` | This is the quirk. A build that passes the folder through in both cases answers with real data here and the clause is violated |
| 2 | `?published=true` | `status: 200` only | Status is asserted; the body is **observed, not asserted** — for the measured reason in §7.1 |

**Two things about the state of that gate, said rather than implied, because an earlier revision of
this section overstated it.**

*Step 1's `bodyIncludes` clause is declared but not yet executable.* It is committed in the scenario,
and it is the right clause — but `evaluateExpectation` in `test/parity/replay.js` implements
`timedOut`, `status`, `notStatus` and the location forms, and **not** `bodyIncludes`, so at this commit
an unimplemented operator would be ignored rather than evaluated. That gap is a separately-owned
finding against the expectation evaluator, not a property of this quirk, and it is named here because
a clause that cannot be evaluated is not an assertion. It is also not this section's only dependency:
the whole comparison waits on the corpus capture, which
[`baseline-parity.md`](baseline-parity.md) §8 lists as the delivery's largest open item.

*What IS enforced today, in code, is that the difference cannot be waved through.* Both step bodies are
compared between the two trees by the ordinary difference ledger, and after the deviation-approval
contract in [§11.0](#110-the-register-is-closed-and-this-is-the-machine-readable-form-of-that) was made
an allowlist, a marker on this scenario — from the corpus or from an external annotations file — is
**rejected** rather than honoured, because its id is not the one allowlisted id. So a difference here
can only be reported as unapproved. That guarantee is structural and holds now, independently of
whether the capture has been driven, and it is the part of this gate that is real at this commit.

### 7.1 A measured target-tree observation: the query-bearing case also returns an empty list

Promoted into this catalogue because a measurement that lives only in a source comment is neither
recorded nor gated, and this one bears directly on how §7's gate must be read.

**Measured** (target tree, during scenario construction; recorded at
`[T test/parity/capture.js:2331-2336]` and carried in the scenario's own committed notes in
`test/parity/corpus.json`). Driven against the seeded fixtures on the **target** tree, step 2 — the
well-formed, query-bearing case, in which the folder filter *does* apply — **also answered with an
empty `data` list**, even though the folder listing for the same folder reports a trinket in it.

**Why this is recorded rather than asserted.** The emptiness of step 2 is a property of whether the
seeded folder membership is visible to the folder-filtered query, which is a **fixture** property, not
a property of the malformed-URL quirk this section is about. Declaring "the two bodies differ" as the
scenario's expectation would make the case fail for a reason that has nothing to do with the behaviour
under test, and would mask the one clause that does matter — step 1's empty list. So the clause stays
on step 1, and this observation is written down here instead of being asserted there.

**Its provenance, stated exactly, because it changes what may be claimed from it.** This was measured
on the **target** tree only. There is no baseline measurement of it, because no baseline capture has
been driven at this commit, so it is **not** established as a baseline-versus-target divergence — it
may equally be a fixture-visibility property present on both trees. That distinction is the whole
reason it is an observation here and not a deviation in §11.

**What it is not: an approved deviation.** The register in [§11](#11-the-two-approved-deviations) is
**closed at two entries** and this is not one of them. So if a driven replay observes step 2's body
differing between the two trees, that is an **unapproved difference and a failure** — to be reported
through the ordinary difference ledger and investigated, never marked approved. Two things are
required of any build that wants to close this: a baseline capture of the same scenario, and, if the
bodies then differ between trees, an investigation of the folder-membership visibility rather than a
marker.

**Target disposition: none — this is an observation, not a preserved behaviour, and saying so is part
of the entry.** Every other entry in this catalogue pairs a measured baseline outcome with a target
construction that reproduces it. This one has no baseline measurement to pair with, so there is nothing
to reproduce and nothing is asked of the implementation. What is asked is of the *evidence*: keep the
observation visible, keep step 2's body compared, and do not let a marker close it. It is listed in the
Index under §7 rather than as a quirk of its own for that reason.

**Gate.** Step 1's `bodyIncludes` clause, which is the assertion; the ordinary body comparison on step
2, which reports a difference without pre-approving one; and, for the fixture question itself, the
seeded folder membership in `test/parity/seed.js`.

---

## 8. The streaming asset fetch's two failure modes, and reCAPTCHA's faults

### 8.1 The streaming asset fetch

**Measured** (static, plus probe; scenarios defined). `users.assetFromURL` validates the supplied URL, then
streams it to a temporary file and uploads the result:

```javascript
// [B lib/controllers/users.js:588-616]
    var requestUrl = url.parse(request.payload.url);
    if (!requestUrl.protocol) return request.fail();          // :589
    tmp.tmpName(function(err, tmpPath) {
      var contentType = '';
      _request
        .get(request.payload.url)
        .on('error', function(err) { console.log('on error:', err); })   // :596-598
        .on('response', function(response) {
          contentType = response.headers['content-type'];                // :600
        })
        .on('end', function() {                                          // :602
          var fileupload = { path : tmpPath,
                             filename : path.basename(requestUrl.path),  // :605
                             headers  : { 'content-type' : contentType } };
          FileUtil.uploadUserAsset(fileupload, request.user, function(err, file) {
            if (err) return request.fail(err);
            return request.success({ file : file });                     // :613
          });
        })
        .pipe(fs.createWriteStream(tmpPath));
    });
```

The upload is started **only from the `end` handler**, and the `error` handler only writes to the
console. The two failure modes therefore differ observably and are recorded separately:

| Failure mode | Events emitted | Outcome |
|---|---|---|
| **Refused connection** | `error`, and **never** `end` | `uploadUserAsset` is never called. Nothing calls `request.success` or `request.fail`, so **the route is left unsettled** and the request hangs |
| **Mid-stream failure after `response`** | `response`, partial bytes, `error`, then still `end` | The upload **does** start and the partial content is stored, and the route answers |

**Correction carried explicitly.** An earlier draft of the analysis claimed the refused-connection case
uploads partial bytes. That is **wrong**: on a refused connection nothing is uploaded at all, because
`end` never fires, and the request never settles. The partial upload belongs to the *other* mode.

**Target disposition.** Log and do not reject on a transport error; do not start the upload when `end`
never arrives; leave the request unsettled exactly as baseline leaves it. This is a log-and-continue
edge, and its per-edge status and timing belong to `docs/error-edge-inventory.md`.

**An adjacent preserved detail: the query string ends up in the stored filename.** `[B lib/controllers/users.js:605]`
derives the filename as `path.basename(requestUrl.path)`, and `url.parse`'s `path` field **includes the
query string** — unlike `pathname`. Measured (probe):

```text
https://cdn.example.com/a/x.png        -> path "/a/x.png"       -> filename "x.png"
https://cdn.example.com/a/x.png?v=2    -> path "/a/x.png?v=2"    -> filename "x.png?v=2"
```

The shared `lib/util/url.js` helper preserves that field's semantics deliberately, so a query-bearing
source URL keeps producing a filename containing `?v=2`. The same helper also preserves the
`protocol`-is-null behaviour that makes `:589` reject relative, root-relative and protocol-relative
URLs.

**Gate.** Three corpus scenarios in group `error-edge.log-and-continue`, each **defined** with its own
fixture profile. The profiles are recorded responses in `test/parity/fixtures/http.js`; the scenarios
themselves are definitions and are not yet driven:

| Scenario | Fixture profile | Declared expectation |
|---|---|---|
| `error-edge.asset-from-url.transport-refused` | `asset:transport-refused` | The route is left unsettled — recorded as an **expected timeout**, so the harness records the outcome instead of hanging |
| `error-edge.asset-from-url.midstream-failure` | `asset:midstream-failure` | The partial content is uploaded and the route answers |
| `error-edge.asset-from-url.query-bearing-url` | `asset:success` | The asset is stored under a name derived from the query-bearing path |

### 8.2 reCAPTCHA — six outcomes, two of them uncaught throws

**Measured** (static). The whole module is 26 lines:

```javascript
// [B lib/util/recaptcha.js:5-25]
  verify : function(g_recaptcha_response, cb) {
    if (config.isTest || !config.app.recaptcha || !config.app.recaptcha.secretkey) {
      return cb({ success : true });                       // :8
    }
    request.post({ url : "https://www.google.com/recaptcha/api/siteverify", form : { ... } },
      function(err, response, body) {
        if (response.statusCode === 200) {                 // :18
          cb(JSON.parse(response.body));                   // :19
        }
        else {
          cb({ status : false });                          // :22
        }
      });
  }
```

| # | Condition | Outcome |
|---|---|---|
| 1 | `config.isTest` | Short-circuits, `cb({ success : true })` `[B :7-8]` |
| 2 | Not configured — no `recaptcha` block or no `secretkey` | Same short-circuit, `cb({ success : true })` `[B :7-8]` |
| 3 | 200 | `cb(JSON.parse(response.body))` `[B :19]` — the parsed verification body |
| 4 | Non-200 | `cb({ status : false })` `[B :22]` |
| 5 | **Transport failure** | `response` is `undefined`, so reading `response.statusCode` at `[B :18]` throws an uncaught `TypeError`. `err` is never inspected, and **`cb` is never called** |
| 6 | **200 with a malformed body** | `JSON.parse` at `[B :19]` throws an uncaught `SyntaxError`, and **`cb` is never called** |

All six are preserved. A measured detail on outcome 4: it returns the key `status`, while callers read
`.success` — `[B lib/controllers/users.js:33]` tests `!recaptcha_result.success` and
`[B lib/controllers/users.js:805]` tests `recaptcha_result.success`. The property is therefore
`undefined` and falsy, so a non-200 still rejects the submission; the key mismatch is real but benign
in effect, and it is preserved rather than reconciled.

**Target disposition.** The `request` package is replaced by `fetch`, and all six outcomes are
preserved as written — including the two that throw and never call back. Outcomes 5 and 6 remain
faults: nothing catches them and no callback is delivered.

**Evidence, and a reported finding — the weakest-evidenced entry in this catalogue, said plainly.**

What exists (verified in the delivered tree):

- the six outcomes above, read from the 26-line module (**static**);
- **recorded fixture responses** for the four HTTP-reachable outcomes, in
  `test/parity/fixtures/http.js` — `recaptcha:success`, `recaptcha:rejected`, `recaptcha:non-200`,
  `recaptcha:transport-failure` and `recaptcha:malformed-json`. The two short-circuits need no
  recorded response, because they return before any HTTP happens.

What does **not** exist, and an earlier revision of this document wrongly claimed did:

- **there is no driver that invokes `verify()` directly.** A search for a require of
  `lib/util/recaptcha` anywhere under `test/` returns only comment text in
  `test/parity/fixtures/http.js` — no call site, in that file or any other (**static**, over `test/`).
- `[T test/parity/fixtures/http.js:195-204]` is **not** a statement that such invocation happens. It
  sits under the heading `NOTES OWED TO docs/baseline-parity.md` and describes the two
  **preconditions** that would make outcomes 3–6 reachable at all: a direct require of
  `lib/util/recaptcha.js` *without* loading `config/app.config`, so that `config.isTest` is left
  `undefined`, together with a present `config.app.recaptcha.secretkey`. It is a note about what a
  driver would have to do, written by the fixture author for the document that owns the method. An
  earlier revision read it as evidence that the driver exists. It is not, and the difference matters:
  one is a recorded measurement and the other is a design note.

**So the reported finding is larger than "no dedicated corpus scenario", and this is its corrected
statement.** Under `NODE_ENV=test` outcome 1 short-circuits before any HTTP happens and **always
wins**, so no route-driven case can reach outcomes 3–6 at all — which is why there is no corpus
scenario, and that part was correct. But the direct-invocation driver that was named as the substitute
gate has not been delivered, so at this commit **outcomes 3–6 have recorded fixture responses and no
driver that consumes them**. Outcomes 5 and 6 additionally deliver no callback, so even a route-driven
case would hang without distinguishing the fault from any other timeout — which is the reason a direct
driver is the right shape for it.

**Gate, as it actually stands.** Outcomes 1 and 2 are covered by every `NODE_ENV=test` request that
reaches a reCAPTCHA-guarded route, which is the whole existing suite. Outcomes 3–6 are **pending**: the
gate that settles them is a bounded driver that requires `lib/util/recaptcha.js` under the two
preconditions above and asserts each of the four outcomes against its recorded fixture, including the
two that throw and never call back. It is recorded here as a gap with its remedy named, rather than
presented as coverage this catalogue does not have.

---

## 9. The remaining preserved items

### 9.1 Two validation message maps that no longer match

**Measured** (static, plus probe and artifact). Two routes declare a custom validation message map:

```yaml
# [B config/routes.js:91-95]   POST /users
# [B config/routes.js:112-116] PUT /api/users/{userId}
        language : {
          username : {
            "regular expression" : "Usernames must begin with a letter and must only contain
                                    alphanumeric characters and hyphens (-)."
          }
        }
```

The substitution mechanism uses each map **key as a regular expression matched against joi's own error
message** `[B lib/util/routeParser.js:530-532]`. Modern joi does not phrase a pattern failure that
way. Measured against the repository's own username schema on the delivered joi 18.2.5 (probe):

```text
input "9bad" -> "value" with value "9bad" fails to match the required pattern: /^[a-z][a-z0-9\-\_]*$/i
error type   -> string.pattern.base
contains the substring "regular expression" -> false
```

No match, so `_.find` yields nothing and the raw joi message is stored instead
`[B lib/util/routeParser.js:533]`. **The maps are already inert at baseline**, and the joi bump does
not change that: the committed artifact `test/parity/joi-baseline.json` carries a dedicated
`inertness` section recording, for both routes, `containsMatchKey: false`, `observedSubstituted:
false`, the raw joi message actually flashed, and a conclusion stating that the key is absent from
joi's pattern message on **both 17.13.3 and 18.2.5**.

**Target disposition: preserved as inert.** The maps stay declared and stay ineffective.

**This entry inverts the usual test.** The failure condition is the friendly message **appearing**. A
run in which a rejected username produces "Usernames must begin with a letter…" instead of joi's raw
pattern message is a **regression** under R-d, not an improvement.

**Gate.** The joi parity matrix. Note that the map itself is not one of the matrix's 102 validation
targets, and the precise reason is `[B lib/util/routeParser.js:270]` — `delete(validation.language)`
runs before the validation loop iterates the remaining keys, so `language` is never treated as a
schema. It is captured for the substitution attempt at `[B lib/util/routeParser.js:257]`, and the
matrix records it separately in its `languageMaps` and `inertness` sections.

### 9.2 Permanently inert leak detection

**Measured** (static, plus probe). `gleak` is required inside a try/catch with a no-op fallback:

```javascript
// [B app.js:29-36]
// gleak is not compatible with Node 16+ (uses GLOBAL which was removed)
// Use a no-op fallback for now
let gleak;
try { gleak = require('gleak')(); }
catch (e) { gleak = { detectNew: () => [], ignore: () => {} }; }
```

`gleak` is **not a declared dependency** — verified against the baseline `package.json`'s
`dependencies` and `devDependencies` — so the require always throws and the fallback is always
installed. `detectNew()` therefore always returns an empty array, which means `detectLeaks`
`[B app.js:317]` never reports anything, and the 60-second poll
`setInterval(detectLeaks, 60*1000)` `[B app.js:348]` runs forever without effect. The `ignore` calls
at `[B app.js:344-345]` are equally inert.

**Target disposition.** Left exactly as it is, including the timer. The application deliberately
creates ten globals, so the machinery is not load-bearing in any case.

**Gate.** The boot check: the fallback path produces no output and no warning, so the zero-warning boot
gate covers it.

### 9.3 Per-request debug logging

**Measured** (static). Three `console.log` statements run on every request through the parser's
wrapper, and they are **baseline**, not artifacts of the migration:

| Address | Statement |
|---|---|
| `[B lib/util/routeParser.js:311]` | `console.log('ROUTE: Handler start', request.method, request.path);` |
| `[B lib/util/routeParser.js:544]` | `console.log('ROUTE: Calling handler for', request.method, request.path);` |
| `[B lib/util/routeParser.js:550]` | `console.log('ROUTE: Handler returned', typeof result);` |

**Target disposition: retained unchanged**, at `[T lib/util/routeParser.js:259]`,
`[T lib/util/routeParser.js:427]` and `[T lib/util/routeParser.js:437]`, alongside the surrounding
timing block.

**The reason is stated because the omission would look like an oversight.** Performance is explicitly
not a goal of this migration, and no performance requirement was given. Removing per-request logging
to save work would be an unrequested change that R-a excludes from the four categories the diff is
allowed to contain.

**Gate.** The diff, reviewed against this entry: all three statements are still present at the target
addresses above. This is deliberately not a runtime gate, and the reason is worth stating — these
write to the server's stdout, which is not part of the response surface the corpus compares, so no
replay assertion can observe them. They are also not deprecation warnings, so the zero-warning boot
gate does not reject them.

### 9.4 The `aws.buckets.exports` configuration gap

**Measured** (static). The committed `aws.buckets` block spans `[B config/default.yaml:394-418]` and
declares seven buckets — `userassets`, `snapshots`, `cdn`, `materials`, `useravatars`, `appassets`
and `vendorassets`. There is **no `exports` entry**. The export worker nonetheless dereferences one:

- the archive upload reads `config.aws.buckets.exports.name` `[B lib/workers/exports.js:367-368]`;
- the download path dereferences its `name` and `host` in the same way.

On a clean tree the worker therefore throws on its first upload, because `config.aws.buckets.exports`
is `undefined`.

**Target disposition: recorded as an existing deployment requirement, not presented as part of a
complete storage contract.** `config/default.yaml` is **not** changed, because every value in that
block is a deployment-specific placeholder — the committed names read `your-user-assets-bucket`,
`your-snapshots-bucket` and so on, and inventing an eighth placeholder would not make an export
succeed anywhere. Instead `test/parity/server-overlay.json` supplies an `aws.buckets.exports` entry
pointing at the filesystem-backed S3 fixture, so the upload and download paths are exercisable.

**Stated plainly: a real deployment must configure `aws.buckets.exports` (both `name` and `host`)
before any export can complete.** This gap is a precondition of the feature, not a defect introduced
or resolved by this migration.

**Gate.** The worker harness, which runs against the overlay and the filesystem-backed S3 fixture and
asserts the `s3Key` and the archive layout.

### 9.5 One deletion that is not a behaviour change

**Measured** (static). `lib/auth/passport.js` is 136 lines of unreachable code. Its only binding is
`const Authentication = require('./lib/auth/passport.js');` `[B app.js:28]`, and a search for the
identifier `Authentication` across the repository's JavaScript returns **that line only** — nothing
ever calls into the module. It also could not work if it were called: it uses Express-style session
access, `req.session.get` / `.reset` / `.set` / `.flash` `[B lib/auth/passport.js:68-74]`, against a
hapi request that has no such property, and it carries the same latent
`JSON.stringify(opts)` reference error as §6 at `[B lib/auth/passport.js:124]`.

**Target disposition: deleted, together with the `app.js` binding.** Deleting unreachable code changes
nothing observable, so **R-d is not engaged** — there is no behaviour to preserve. Retaining the file
in order to justify four dead `passport*` packages is the circularity R-b forbids. The package
removals are recorded in `docs/dependency-inventory.md`.

**Gate.** The route manifest, which is unchanged by the deletion, and the boot check.

### 9.6 Cosmetic corrections rejected under R-a

Recorded so that a reviewer can see the scope gate was applied rather than assumed. Neither of these
blocks anything, and neither belongs to the four categories the diff is permitted to contain:

| Item | Address | Measured state | Disposition |
|---|---|---|---|
| `package.json` `main` field | `[B package.json:5]` `"main": "app/app.js"` | `app/app.js` **does not exist** — verified absent; the real entry point is `./app.js`, reached by `node app.js` and by the container's process manager | **Left as it is** |
| Legacy Compose `links:` key | `[B docker-compose.yml:14-16]` | `links:` to `redis` and `mongodb`, superseded by Compose's default network | **Left as it is** |

### 9.7 A routed handler that answers 500 where its author intended 403

The one entry in this catalogue that reaches the client as a **status code the surrounding code does
not name**. It is recorded here because the conversion checklist explicitly routes a deliberately
retained `reply(` expression to this document — "if the expression is deliberately unreachable, record
it in `docs/preserved-quirks.md`. Do not change its behaviour."
`[T test/parity/convert-inventory.js:3552-3556]` — and this is that expression. It is also the reason
`courses.download` appears on the allow-list in [Appendix A](#appendix-a--the-quirk-allow-list-for-generated-target-actions):
a generated instruction to make every path return would rewrite it.

**The route is real and routed.** Not an unreachable branch in dead code:

| Property | Value | Address |
|---|---|---|
| Route | `GET /{userSlug}/courses/{courseSlug}/download.zip` | `[B config/routes.js:163]` |
| Binding | `courses.download` | same |
| Auth | `auth: 'session'` — so the visitor is authenticated | `[B config/routes.js:165]` |
| Pre-handlers | `helpers.coursesEnabled`, `'user(params.userSlug)'`, `{method: helpers.courseBySlug, assign: 'course'}` | `[B config/routes.js:166]` |
| Validation | `query.format` required, `valid('md','html')` | `[B config/routes.js:167-171]` |

**Measured** (static, plus probe). The handler's body is one five-clause authorization `if`
`[T lib/controllers/courses.js:226-230]` — the course-owner role, a `public` course type, an `open`
course type, the `create-private-course` permission, or `make-course-copy` on this course. An
authenticated visitor holding none of those takes the `else`:

```javascript
// [B lib/controllers/courses.js:289]  ·  [T lib/controllers/courses.js:435]
      return reply(Boom.forbidden());
```

**`Boom` is not bound in this module, and never has been on either tree.** The module's only
`@hapi/boom` binding is `errors` — `[B lib/controllers/courses.js:14]`, `[T lib/controllers/courses.js:25]`
— and `Boom` is not one of the implicit globals the bootstrap creates. Those are created by undeclared
assignment at `[B app.js:290-298]`, `[T app.js:313-321]`, and are exactly `User`, `Course`, `Lesson`,
`Material`, `File`, `Trinket`, `Interaction`, `Folder` and `CourseInvitation` — the only such
assignments in the file, and there is no `global.` assignment anywhere in it (static, over `app.js`).
So evaluating this
expression throws a `ReferenceError` **before any response is constructed**, the handler rejects, and
the preserved handler catch-all `[B lib/util/routeParser.js:578-589]` maps it to
`Boom.badImplementation(...)` — a **500**, where the expression names a 403.

**A measured detail: the two trees throw on different identifiers, and the outcome is the same
anyway.** Which identifier fails first is decided by evaluation order, and the trees differ because
the second parameter was renamed:

| Tree | Handler signature | `reply` in scope? | Thrown | Why |
|---|---|---|---|---|
| Baseline | `function(request, reply)` | yes | `ReferenceError: Boom is not defined` | the callee resolves, then the argument `Boom.forbidden()` is evaluated and fails |
| Target | `async function(request, h)` | **no** | `ReferenceError: reply is not defined` | a call expression resolves its **callee** before its arguments, so `reply` fails first — measured (probe): evaluating `reply(Boom.forbidden())` with both identifiers unbound reports `reply is not defined` |

The **client-visible response is identical**, because a 500 Boom redacts its message: both produce
`{"statusCode":500,"error":"Internal Server Error","message":"An internal server error occurred"}`.
Only the server-side log line differs. This is the same redaction argument §5 relies on, and it holds
here for the same reason. Recorded because the code comment at `[T lib/controllers/courses.js:419-433]`
and `docs/error-edge-inventory.md` both attribute the throw to `Boom`, which is correct for the
baseline and one identifier short for the target.

**The error-funnel consequence, per branch as measured rather than as the code's shape suggests.**
`onPreResponse` `[T app.js:177-205]` returns **early** for a browser HTML request at any status ≥ 500,
*before* the `Cache-Control` / `Pragma` / `Expires` assignments. It also returns early at 403. So:

| Request kind | Baseline and target (500) | The intended 403, for contrast |
|---|---|---|
| Browser / `*/*` | `50x.html` rendered, `.code(500)`, **no** cache headers | `50x.html` rendered, `.code(403)`, no cache headers — the same body, a different status |
| API / JSON | JSON Boom, `Internal Server Error`, **with** the cache headers | JSON Boom, `Forbidden`, with the cache headers |

That the browser body is the *same template* either way is why this went unnoticed for so long: on the
path a user actually takes, only the status line betrays it.

**Target disposition: preserved exactly, and deliberately not repaired.** The expression is retained
verbatim on the target tree. Binding `Boom`, or rewriting it as `errors.forbidden()`, would convert a
500 into the 403 the author evidently intended — a behaviour change and an error-mapping change, which
R-d and R-e each prohibit independently. This is the mechanism-versus-outcome rule of this document
read in its simplest form: here the *statement* is preserved because preserving the statement is what
preserves the outcome.

**Gate — and a reported gap, because no committed scenario reaches this branch.** Three scenarios
target this route (probe, over `test/parity/corpus.json`):
`route.get.userSlug-courses-courseSlug-download-zip.html`,
`route.get.userSlug-courses-courseSlug-download-zip.json` and
`quirk.reply-chain.header-resolved.course-download-zip`. All three drive
`/testing/courses/test-course/download.zip?format=zip` as the seeded `user`, and **`format=zip` does
not reach the handler at all**:

```text
Joi.string().valid('md','html').required()  on the delivered joi 18.2.5 (probe)
  "zip"  -> REJECT      "md" -> accept      "html" -> accept
```

The route's declared query schema admits only `md` and `html` `[B config/routes.js:168-172]`, and the
parser's hand-rolled validation block runs **before** the handler is called and returns
`request.fail(...)` on failure `[T lib/util/routeParser.js:420-423]` versus the handler invocation at
`[T lib/util/routeParser.js:436]`. So all three scenarios record the validation-failure path, not this
handler — which also means they do not gate the four working chain outcomes they appear to.

**One half of that is now fixed and the other half is blocked on a fixture, so both are stated
exactly.** The `format=zip` default was a defect rather than a choice, and it is corrected: the query
default at `[T test/parity/capture.js:480-490]` and the chain scenario's target at
`[T test/parity/capture.js:2519]` both now use `format=md`, with the measurement recorded inline. That
un-voids the two route-sweep cases **and** `quirk.reply-chain.header-resolved.course-download-zip`,
which exists to prove the archive response and could not reach it.

**What still does not exist is a case that reaches this branch, and the reason is a fixture property I
measured rather than an oversight.** The branch needs an authenticated identity holding **none** of the
five authorization clauses, and no seeded identity can be one:

```text
lib/models/course.js:30   globalSettings.courseType  enum private|public|open|demo  DEFAULT 'public'
test/parity/seed.js       the only seeded Course calls doc.setGlobalSettings({}), i.e. the defaults
                          -> courseType === 'public'
```

The second clause is `course.globalSettings.courseType === "public"`, so it is **true for every
authenticated visitor** — including the seeded admin, whose roles carry `admin` with no permissions and
who therefore satisfies neither `hasPermission` clause. There is no identity that fails all five
against this course.

**So the case is fully specified and needs one new fixture.** What settles this entry is: a second
seeded `Course` whose `courseType` is `private` (or `demo`), owned by the seeded user; plus one
scenario driving `GET /{userSlug}/courses/{courseSlug}/download.zip?format=md` against **that** course
as the seeded **admin** — who is not its owner and holds no permission — asserting **500**, and in the
JSON accept mode the `Internal Server Error` payload rather than `Forbidden`. Both pieces live in
artifacts other sections of the delivery own: the fixture in `test/parity/seed.js`, and the scenario in
`test/parity/capture.js`, whose builders emit the scenario array — `buildQuirkScenarios`,
`buildReplyChainScenarios`, `buildPreHandlerScenarios`, `buildOAuthScenarios`,
`buildAuthOutcomeScenarios` and `buildErrorEdgeScenarios` (**static**). The corpus is that generator's
output rather than a hand-authored plan, so adding this case means adding it to the relevant builder
and re-capturing; editing the artifact alone would be overwritten by the next capture and would carry
no provenance. This entry records the requirement in full so that doing it is mechanical.

Until then the standing gate is the **difference ledger**: whatever these three scenarios do record is
compared between the two trees, and because the register in [§11](#11-the-two-approved-deviations) is
closed at two entries and this is not one of them, any change here is reported as an **unapproved**
difference. The per-edge status and payload belong to `docs/error-edge-inventory.md` §7.6, which must
record this as a **routed 500 edge** rather than as the 403 the expression reads like.

---

## 10. Additional measured findings

Baseline behaviours measured in the delivered tree that AAP §0.6.6 does not enumerate. §0.6.6 is the
mandatory floor for this document, not its ceiling. All three entries below were measured here rather
than inherited from the plan, and §10.2 **contradicts** the premise §0.6.6 carried — which is the case
R-f exists to decide, and it decides it for the measurement.

### 10.1 The in-memory queue silently discards every event handler

**Measured** (probe). When Redis is disabled, `lib/util/queues.js` substitutes an in-memory queue whose
`on` method is a no-op:

```javascript
// [B lib/util/queues.js:65-68]
InMemoryQueue.prototype.on = function(event, handler) {
  // No-op for compatibility - in-memory queue doesn't emit events
  return this;
};
```

Measured against the delivered tree with `db.redis.enabled: false`:

```text
queues export surface        -> ["exports","isRedisEnabled","closeAll"]
isRedisEnabled()             -> false
queue constructor            -> InMemoryQueue
prototype methods            -> ["process","add","_processJob","on","close"]
typeof queue.emit            -> undefined
handler invoked after .on()  -> false
```

There is no emitter at all, so registration is not merely ignored on dispatch — there is no dispatch.
The consequence is that the export worker's **three** event handlers are unreachable on this path:
`on('error')` `[B lib/workers/exports.js:55]`, `on('failed')` `[B lib/workers/exports.js:59]` and
`on('completed')` `[B lib/workers/exports.js:71]`. In particular the failure-persistence branch that
writes `status: 'failed'` onto the `Export` document `[B lib/workers/exports.js:63-68]` never runs
without Redis, and neither does `job.remove()` on completion
`[B lib/workers/exports.js:72]`.

**Target disposition.** The no-op is preserved; the handlers stay registered. Their bodies are still
adapted for Bull 4 — `[B lib/workers/exports.js:60]` reads `job.jobId`, which Bull 4 renames to
`job.id` — because they *are* reached when Redis is enabled, which is the production configuration.
So the handlers must be correct for the Redis path while remaining unreachable on the in-memory path,
exactly as at baseline.

**Gate.** The worker harness, which asserts the Bull semantics the version change alters. It is also
why event-handler behaviour cannot be validated on the in-memory path alone.

### 10.2 The worker's `!config.isTest` template guard is inert: it assigns a variable nothing reads

**This entry replaces an earlier, wrong one, and the correction is the substance.** An earlier revision
recorded this as "the completion mail template is not configured under `NODE_ENV=test`", and concluded
that "any later render through it throws while the job is otherwise succeeding". Measured, that
conclusion is impossible: **nothing renders through it.** AAP §0.6.6's own framing carried the same
premise, and the measurement below is what governs under R-f.

**Measured** (static). The bulk-export processor guards a template-environment assignment:

```javascript
// [B lib/workers/exports.js:106-108]  ·  [T lib/workers/exports.js:128-130]
  if (!config.isTest) {
    env = nunjucks.configure(config.app.templates);
  }
```

`env` occurs at **exactly two places in the file, on both trees**, and neither is a read (static, every
`\benv\b` token in the module):

| Tree | Declaration | Assignment | Reads |
|---|---|---|---|
| Baseline `2f8712a` | `[B lib/workers/exports.js:19]` `, env;` | `[B lib/workers/exports.js:107]` | **none** |
| Target | `[T lib/workers/exports.js:31]` `, env;` | `[T lib/workers/exports.js:129]` | **none** |

Both mail paths call the **module-level global** `nunjucks.render`, not `env.render`:

```javascript
// [T lib/workers/exports.js:419]   var html = nunjucks.render('emails/export-ready', templateData);
// [T lib/workers/exports.js:432]   var html = nunjucks.render('emails/export-failed', templateData);
```

So the guard cannot affect rendering. It assigns a dead variable, and the render resolves against
nunjucks' **global** environment regardless of `NODE_ENV`.

**What configures that global environment is a side effect of the worker's own require graph.**
`lib/util/nunjucks.js` calls `nunjucks.configure(config.app.templates, ...)` at **module scope**
`[T lib/util/nunjucks.js:8]`, which is what sets the global environment `nunjucks.render` uses. The
worker reaches it without asking: `lib/workers/exports.js` → `config/app.config` →
`lib/util/routeParser` → `lib/controllers/courses.js` → `lib/util/nunjucks`. Measured in this tree
under `NODE_ENV=test` with Redis disabled (probe):

```text
before any application require        -> THROWS  "template not found: emails/export-ready"
after require(lib/workers/exports)    -> RENDERS
config.isTest                         -> true
lib/util/nunjucks in the require cache -> true
```

**Deliberately not stated as a byte count, and that is a correction too.** The rendered size is a
property of the context and the template, not of this behaviour: measured 1039 characters with one
complete context and **1066** with the five-key context `sendCompletionEmail` itself passes, against
the 1,020 recorded in `[T test/parity/worker.js:104-115]` from an earlier measurement. All three agree
on the only claim this entry makes — that it renders rather than throwing — so that is the claim, and
no invariant is asserted about the number. A gate written against a specific length would fail on a
template edit that changed nothing about the behaviour.

**Target disposition: the guard is preserved as written, and it stays inert.** Deleting it would be
tidying that R-a excludes; "fixing" it by rendering through `env` would change which environment the
mail path uses, and repairing the dead variable would suggest a defect that has no observable
consequence. Both mail paths keep calling the global `nunjucks.render`.

**What this means for the worker and mail expectations, since they were aligned to the wrong claim.**
The completion notification does **not** fail under `NODE_ENV=test`, and a harness must not configure
nunjucks to make it work — configuring it would mask the very side effect described above, and
requiring `lib/util/nunjucks` from a harness has its own measured cost (see §10.3). The correct shape
is to **assert the resolution as a precondition** and let the require graph supply it, which is what
`[T test/parity/worker.js:1440-1465]` does, recording both the before and after observations. The
captured-mail fixture then asserts a delivered message with rendered HTML on the success path, rather
than a swallowed template error.

**Gate.** The worker harness's template-resolution precondition — the before/after pair above, whose
"after" must be a successful render — together with its captured-mail fixture asserting the delivered
completion message on the successful job and the failure message on the failing one.

### 10.3 The test-mode template watcher runs on an optional peer the root no longer declares

**Measured** (static, plus probe). `lib/util/nunjucks.js` configures the global environment with
watching enabled outside production:

```javascript
// [B lib/util/nunjucks.js:8]  ·  [T lib/util/nunjucks.js:8]  — identical on both trees
    env = nunjucks.configure(config.app.templates,
            {watch: config.isDev || config.isTest ? true : false, autoescape: true}),
```

Under `NODE_ENV=test` that resolves to `watch: true`, and nunjucks 3.2.4's `FileSystemLoader` requires
`chokidar` to implement it. What matters is **which** declaration provides it, and an earlier revision
of this entry got that wrong — it claimed nunjucks does not declare `chokidar`, because the probe
behind it read only `dependencies` and `optionalDependencies`. Corrected, and measured over the
committed metadata:

```text
chokidar in package.json dependencies / devDependencies -> NO   (the ROOT declaration was removed)
chokidar declared by nunjucks 3.2.4                     -> YES  peerDependencies { "chokidar": "^3.3.0" }
                                                                peerDependenciesMeta { chokidar: { optional: true } }
chokidar in package-lock.json                           -> YES  3.6.0, recorded optional: true, peer: true
```

So the provider **is** declared and locked — as nunjucks's own **optional peer** — and the edge is
reproducible from the lockfile rather than incidental. What AAP §0.5.1.3 removed is the **root
project's direct declaration**, on the ground that no retained source consumes `chokidar` itself, and
that reading is correct: nothing in `lib/` or `config/` requires it. Nunjucks does, on this one
configuration.

The consequence worth recording is therefore narrower than the earlier text claimed, and it is an
observation rather than a proposal:

1. **A handle inventory.** The watchers this creates are the `FSEventWrap` handles the worker harness
   reports. They cannot be closed by a caller: nunjucks 3.2.4's `FileSystemLoader` keeps the
   `FSWatcher` in a constructor-local variable and exposes no `watcher` property. They are **not** an
   approved deviation — see [§11.3](#113-what-is-not-a-deviation-and-why-the-register-is-closed) —
   and the worker harness now **fails** on them rather than allowing them.
2. **An optional peer is satisfied by resolution, not by declaration.** npm installs an optional peer
   when the graph happens to satisfy it and omits it silently when it does not, and no root
   declaration pins it here. The committed lockfile does pin 3.6.0, so `npm ci` is deterministic
   today; the observation is only that the *root* no longer states a requirement that one
   configuration of a retained module has, so nothing in this repository's own manifest records the
   dependency that a `NODE_ENV=test` run takes.

**Target disposition: recorded, not changed.** `lib/util/nunjucks.js` is unchanged — AAP §0.3.1 lists
it as unchanged, provisionally, under the §0.9.2 gate — and `package.json`'s dependency set is owned by
`docs/dependency-inventory.md`. Turning the watcher off under test would be the smallest possible fix
and it is still a change to a retained module outside R-a's four categories, so it is not made here.

**Gate.** The `NODE_ENV=test` suite, which exercises this path on every run and would fail at require
time if the optional peer stopped resolving, and the worker harness's **clean-close** check, which is
where the `FSEventWrap` handles surface and which now fails on them — measured: with a live watcher
open, `inspectHandles()` reports `counts {"FSEventWrap":1}`, `allowed []`, `unexpected
["FSEventWrap"]`.

---

## 11. The two approved deviations

These are the **only** two places in the migration where something is deliberately **not** preserved.
Both are recorded as deviations rather than as preservation. Each is stated once, canonically, here;
the handler mapping and the corresponding gate carry the same decision, and a divergence between the
three would itself be a defect.

### 11.0 The register is closed, and this is the machine-readable form of that

**Exactly two deviations are approved. This section is the whole list, and it is not extensible by a
tool.** The reason this needs saying explicitly, rather than being left to a reader's count, is that
two separate tools were found minting their own: a replay verifier that approved any scenario carrying
an "approved-change" marker regardless of its identity, and a worker harness that described a residual
deprecation warning and an unclosable handle inventory as "named deviations". Neither had been argued
or approved. A deviation that a tool can declare for itself is not a deviation — it is drift with a
label, and it defeats the one prohibition (R-d) this whole document exists to enforce.

| # | Deviation | Kind | Replay-visible? | Canonical id | Owner of the full argument |
|---|---|---|---|---|---|
| 1 | The never-settling image-download response is **served** | Response behaviour | **Yes** — one scenario | `quirk.reply-chain.never-settles.image-download` | [§11.1](#111-deviation-1-the-never-settling-file-response) |
| 2 | The `marked` fork is **retained**, leaving one named high advisory | Audit result | **No** — no scenario, no response difference | *none — see below* | [`deferred-dependencies.md`](deferred-dependencies.md) §4.2 |

**Deviation 2 has no scenario id, and that is not an omission.** It changes no response: retaining the
fork is precisely what keeps rendered output identical (§11.2). It is a departure from the audit
*target*, measured by `npm audit`, not by a replay diff. So a replay-visible deviation marker on any
scenario cannot be justified by deviation 2, and a tool that treats "there are two approved
deviations" as "two markers are acceptable" has mis-read this table.

**The consequence for the deviation-approval contract, stated as the rule a verifier implements:**

1. **The allowlist is exactly one scenario id** — deviation 1's, above. It is an allowlist, not a
   pattern.
2. **An unknown id carrying an approved-change marker is a failure, never an approval.** Not
   "approved but unverified": a marker on a scenario this register does not name is unapproved drift,
   and the only correct verdict is that the difference is unapproved. This matters because markers can
   arrive from an external annotations file as well as from the corpus, so "the committed corpus
   currently carries only the canonical marker" is a fact about today's corpus and not a property of
   the tool.
3. **Deviation 1 is approved as one specific response, field by field**, so a scenario that changed
   differently is a failure that happens to carry a marker. The approved shape is: outcome changes
   **from** an expected timeout **to** an answered response; status **200**; content type the file
   document's own mime; body length the file document's own byte size; and `content-disposition`
   **absent**. Those five fields are the contract, and they are derived from the seeded fixture rather
   than restated, so they cannot drift from the object the scenario downloads.
4. **A marker on a scenario that did not change is also a failure.** R-b is why the deviation exists;
   a route that still hangs has not implemented the decision.

### 11.1 Deviation 1: the never-settling file response

**Measured** (static; scenario defined — the full classification is in §4.1).
`[B lib/controllers/files.js:98-100]` never settles: the image-download branch of `files.download`
calls `reply(stream).type(...).bytes(...)` with no `return` and no resolving call, and neither
`.type()` nor `.bytes()` settles the deferred, so the request hangs indefinitely.

**The conflict.** **R-d requires that the outcome be preserved. R-b requires that every route serve.
Both cannot hold.**

**Decision: the target serves the stream response. R-b controls.** Three reasons, recorded because they
are what makes this deviation defensible — and because they are also precisely why the same reasoning
does **not** transfer to the `marked` case in §11.2:

1. **An unsettled request is not a behaviour a client can depend on.** It is the *absence* of a
   response. R-d's protection is for clients that may rely on observable behaviour, and there is no
   observable behaviour here to rely on.
2. **The intended response is not inferred — it is present in the same function.** The sibling branch
   four lines below, `[B lib/controllers/files.js:102-105]`, performs the **identical** chain ending in
   `.header(...)` and returns a working stream response. The target returns that same response for the
   image branch, minus the `Content-Disposition` header the image branch deliberately omits, which is
   the whole purpose of having a separate branch: it renders an image inline rather than downloading
   it. This makes the deviation a reconstruction rather than a guess.
3. **R-b is unqualified about routes serving**, whereas the `marked` conflict pits a prohibition
   against a validation *target* — the opposite balance, resolved the opposite way.

**Target.**

```javascript
// [T lib/controllers/files.js:171-173]
      return h.response(stream)
        .type(request.pre.file.mime)
        .bytes(request.pre.file.size);
```

`Content-Disposition` stays omitted. The four header-resolved chains, including the sibling at
`[T lib/controllers/files.js:179-182]`, are unaffected and are preserved exactly (§4.2).

**Gate — driven, and this is what it produced.** Scenario
`quirk.reply-chain.never-settles.image-download` carries the migration's only `expectedDeviation`
marker, and both halves of the comparison are now measured:

- **baseline**: the step is recorded as an **expected timeout** —
  `{status: null, timedOut: true, transportError: null, contentType: null, location: null,
  bodyLength: null, bodyDigest: null}` in the committed corpus, which is a recordable result in this
  harness rather than a hang, and is the only reason a never-settling branch can be captured at all;
- **target**: the same step replays with `timedOut: false`, so the branch **answers**; the target
  expression returns the stream with the file document's own mime type and byte length and **no**
  `content-disposition`;
- **verdict**: recorded as an **approved change**, not a failure — `status: approved-deviation`,
  `failing: false`, `verified: true`, with the report stating *"the change was checked field by field
  against what was approved"* and the single differing field
  `outcome: "timed-out" -> "answered"`. The verification is against the five-field contract in
  [§11.0](#110-the-register-is-closed-and-this-is-the-machine-readable-form-of-that) rather than
  against the presence of the marker, so a target that still timed out, or that answered differently,
  would be a failure that happens to carry a marker. Both cookie passes report it identically, and the
  four header-resolved chains in the same run compared as **matches**, so the deviation is bounded to
  the branch it was approved for.

Its reach is narrow: the branch is entered only by file documents whose `type` carries a mime-like
string such as `image/png`, which is why the corpus seeds a legacy `File` document with exactly that
value.

### 11.2 Deviation 2 — the `marked` fork is retained, leaving one named high advisory

The private `marked` fork carries a high ReDoS advisory and cannot be bumped. It is **retained**, so
the migration delivers zero critical and exactly **one high** finding rather than the zero/zero the
request's audit gate states. The full reasoning, the precedence argument and the named follow-up are
owned by **`docs/deferred-dependencies.md`** and are not duplicated here.

What is relevant to *this* catalogue is why retaining the fork is what **preserves** behaviour:
upstream `marked` 4 was tested against the repository's own configuration and its rendered output
differs in **heading `id` attributes**, **task-list `<input disabled type="checkbox">` markup**,
**`javascript:` links reduced to bare text**, and **mixed nested-list structure** — in addition to
emitting a deprecation notice on every parse. Retaining the fork is therefore the option that keeps
authored course content rendering identically for every reader, which is what the PRESERVE clause on
client-visible page behaviour requires. As a direct consequence
`lib/shared/trinket-markdown.js` is unchanged and out of scope, and `highlight.js` stays at its
baseline version.

**Gate.** The audit result, with the single high named and attributed, recorded in
`docs/deferred-dependencies.md`.

### 11.3 What is **not** a deviation, and why the register is closed

Recorded here because three items have been described as deviations somewhere in the delivery, and
none of them is one. The distinction is not bookkeeping: an approved deviation is a **prohibition**
(R-d) that was argued away by a stronger requirement, whereas each item below is a **validation target**
that has not been met. §11.1 and §11.2 turn on exactly that difference — a prohibition beats a target,
which is what makes deviation 2 defensible — so re-using the word for an unmet target inverts the
argument it rests on.

| Item | What it is | Correct classification | Where it belongs |
|---|---|---|---|
| `[DEP0005]` `new Buffer()` from `compress-commons`, reached through retained `archiver` 2.1.1 | A residual deprecation warning under `--pending-deprecation`, emitted once at module load | **Unresolved shortfall** against the zero-warning target of AAP §0.8. It was discovered by measurement, not argued and approved in advance, and no decision has been recorded against it | [`baseline-parity.md`](baseline-parity.md) §7.4 and §8, which already state this |
| `FSEventWrap` handles from the test-mode template watcher | An open-handle inventory that prevents self-exit; unclosable by a caller ([§10.3](#103-the-test-mode-template-watcher-runs-on-an-optional-peer-the-root-no-longer-declares)) | **Unresolved shortfall** against the clean-teardown expectation, with a measured reason and a named remedy | §10.3 here, and the worker harness's handle inventory |
| This process's own stdout/stderr `PipeWrap` handles | Not a leak and not an application observation — which of them exist depends only on how the process was invoked | **Invocation plumbing.** Correctly partitioned out of the assertion; it was never a deviation and stays classified as it is | The harness's `stdio` partition |

**So a gate must fail on the first two rather than allow them, and it now does.** An allowance table
that records an attribution and a decision is good discipline for something that *was* approved;
applied to something that was not, it converts an open finding into a closed one and the finding stops
being visible. The worker harness's `WARNING_ALLOWANCES` is therefore **empty** and its
`HANDLE_ALLOWANCES` holds **only** the `stdio` partition, so the DEP0005 block classifies as
unexpected and the watcher handles classify as unexpected — measured, both fail their checks — while
the run still terminates with its own exit code rather than hanging.

**Where each is recorded as open, cited exactly, because the earlier text over-cited this.**
[`baseline-parity.md`](baseline-parity.md) §8 carries a row for **the residual deprecation warning**,
naming the decision it still needs: bump `archiver`, replace it, or argue it into this register with
its own precedence argument. AAP §0.9.6's own open-items table carries **neither** of these two — its
rows are the cookie patch, the full-route deprecation surface, the Bull/`adm-zip`/`mime` semantics, the
four internal callback modules, the AWS notice suppression, the nine Dockerfiles, storage and archive
parity, and the image digest — so an earlier revision of this section was wrong to say §0.9.6 lists
both. The **FSEventWrap** shortfall is recorded in
[§10.3](#103-the-test-mode-template-watcher-runs-on-an-optional-peer-the-root-no-longer-declares)
here and in the harness's own clean-close check, and nowhere else; it was found by measurement during
this work rather than anticipated by the plan, which is exactly why it needed a home. Until a decision
is recorded against either, the honest result is a failing gate, and both shortfalls stay where they
are: named, measured, and unapproved.

**Nothing here is a proposal.** Neither shortfall is repaired by this migration: `archiver` is retained
by AAP §0.5.1.1 and out of scope by §0.2.2, and `lib/util/nunjucks.js` is unchanged by §0.3.1. What
this section fixes is the **classification**, which is a documentation defect rather than a behaviour
one — and the classification is what a gate reads.

---

## Appendix A — the quirk allow-list for generated target actions

**Why this exists.** `docs/conversion-inventory.md` is generated, and its generator composes each
row's target action as a **generic conversion mandate** followed by a quirk pointer into this document.
For most rows that reads correctly. For a row whose preserved outcome requires a handler *not* to
return — to be left unsettled, or to throw — the generic mandate and the quirk pointer say opposite
things in the same cell, and the mandate comes first. Measured on the committed artifact, nine rows
carry both a quirk pointer and a mandate that contradicts it.

**So the allow-list below is a contract, and it is consumed rather than admired.** A generator that
emits a target action for one of these sites must resolve the allow-list **before** composing the
action, and let the governing action here replace or qualify the generic mandate — never append the
quirk note to a mandate that overrides it. This is the mechanism-versus-outcome rule of this document
applied to generated prose: an instruction that contradicts the quirk record is an instruction to
break the quirk.

| Site | Governing target action | Why a generic mandate is wrong here | § |
|---|---|---|---|
| `lib/controllers/pages.js` `login` | Keep `return reply.redirect('/home')` **as the expression it is**, so the authenticated branch throws and reaches the catch-all as a 500 | "return `request.success`/`request.fail` on every path" would replace the throw with a working response | [5](#5-two-pages-handlers-that-answer-500-to-authenticated-visitors) |
| `lib/controllers/pages.js` `signup` | Keep `return reply.redirect('/welcome')` as the expression it is; `yar.set('next', …)` stays in the `else` branch only | as above | [5](#5-two-pages-handlers-that-answer-500-to-authenticated-visitors) |
| `lib/controllers/users.js` `assetUploadFromURL` (handler) | On transport refusal, **log and leave the request unsettled** — one path deliberately returns nothing | "every path returns exactly once" is the direct negation of this quirk | [8.1](#81-the-streaming-asset-fetch) |
| `lib/controllers/users.js:591`, `:611` (its two callback boundaries) | Take the `await` at the call site **without** making the refused-connection path settle | a callback-boundary mandate that settles every path removes the unsettled outcome | [8.1](#81-the-streaming-asset-fetch) |
| `lib/controllers/auth.js` `googleCallback` and its three callback boundaries (`:49`, `:69`, `:85`) | Persist the user, mutate the session, **then** report the generic failure — preserve the order and the absence of a login | a mandate to return a response on every path can silently drop the throw that produces the failure | [6](#6-google-oauths-new-user-path-saves-the-user-and-then-reports-failure) |
| `lib/controllers/folders.js` `trinkets` | Pass **no** folder filter on the queryless path; pass it only when a query is present | "every path returns exactly once" is satisfiable while accidentally fixing the queryless path | [7](#7-folderstrinkets-builds-a-malformed-injected-url-when-no-query-is-present) |
| `lib/controllers/courses.js` `download` | Keep the residual `reply(Boom.forbidden())` in the unauthorized branch, so it throws and answers 500 | "every `reply(...)` becomes a returned toolkit response" would convert the 500 into the 403 the expression names | [9.7](#97-a-routed-handler-that-answers-500-where-its-author-intended-403) |
| `lib/util/helpers.js:182` `findTrinket`, `:385` `courseBySlug` | `return null` — the value the shim produced. The redirect construction is **removed, not converted** | converting the chain would emit a 301 the baseline never emitted | [2](#2-two-live-pre-handler-301-redirects-that-never-fire) |
| `lib/controllers/trinket.js:1204`, `:1246`, `:1259` | Capture the baseline status, content type and body **first**, then reproduce what was captured. The specification is a measurement that has to be taken, not a rewrite rule — and it has **not** been taken yet, so no target value can be stated here | a mandate to return a toolkit response is right in form and silent about which response, which is the whole content of the quirk | [4.3](#43-builder-returned-to-hapi--three-chains) |
| `lib/controllers/trinket.js:375` | **Return** the mapped error — here the statement *must* change to preserve the outcome | the inverse case, listed so the allow-list is not read as "never change a statement": this one is a genuine rewrite | [4.4](#44-one-further-unreturned-reply-on-an-error-path) |

**Two deviations, two different roles — and generated prose must not collapse them to one.** A
generated cross-reference that speaks of "the single approved deviation" is wrong on the count and, more
usefully, wrong about the kind: [deviation 1](#111-deviation-1-the-never-settling-file-response) is a
**response** deviation and is the one a conversion row can be affected by, while
[deviation 2](#112-deviation-2--the-marked-fork-is-retained-leaving-one-named-high-advisory) is an
**audit** deviation that no conversion row touches. Naming the applicable one is what makes the
reference useful; counting them is what makes it correct.

---

## Cross-references

This document records the *behavioural* outcome of each quirk. It deliberately does not restate what
these own:

| Document | Owns |
|---|---|
| `docs/error-edge-inventory.md` | The per-edge status, payload, side effects and timing for every changed error edge |
| `docs/dependency-inventory.md` | Every replaced or major-bumped package, with original → target → reason |
| `docs/deferred-dependencies.md` | The deferred-but-functional packages, and the full reasoning for deviation 2 |
| `docs/baseline-parity.md` | The corpus method, coverage accounting, and the R-f resolution log |

### Verification status of the cross-document alignment — **performed**

The two approved deviations in §11 are required to read identically here, in
`docs/deferred-dependencies.md` §4 and in `docs/baseline-parity.md` §7. All three documents are in the
delivered tree, so that comparison has been **executed** and its result is recorded below
(**static**, by direct reading of the three sections rather than by a generated diff). It found
**two divergences, one on each deviation** — deviation 1's **evidence state**, since RESOLVED by
measurement, and deviation 2's `highlight.js` attribution. Neither changes a decision, a version, a
target expression or a gate; the first is settled below by the driven capture and replay, and the
second is named rather than harmonised, because it lives in a sentence another subsection owns.

**Deviation 1, the never-settling file response — three legs compared, one divergence.** §11.1 above,
`docs/deferred-dependencies.md` §4.1 and `docs/baseline-parity.md` §7.1 carry the same conflict
statement ("R-d requires that the outcome be preserved. R-b requires that every route serve. Both
cannot hold."), the same decision ("the target serves the stream response", "R-b controls"), the same
target expression `h.response(stream).type(request.pre.file.mime).bytes(request.pre.file.size)` at the
same locator `[T lib/controllers/files.js:171-173]`, and the same statement that `Content-Disposition`
stays omitted. The three reasons are enumerated here and restated in the same order in §7.1; §4.1
assigns them to §11.1 instead of restating them, which is the ownership §11 claims. What the three
legs disagree about is the **evidence state** of the gate, immediately below.

**Divergence 1, deviation 1's evidence state — resolved, in favour of the present tense.** §11.1's
**Gate** paragraph above says, in the present tense, that the corpus records the baseline result as an
**expected timeout** and that the target answers; `docs/deferred-dependencies.md` §4.1 carries that
same sentence in that same tense. `docs/baseline-parity.md` §7.1 used to say the opposite — that what
existed was "an **annotation, not a measurement**" — and cited the artifact for it.

**The artifact now supports the carrier sentences.** `test/parity/corpus.json` reports
`captured: true` with `baselinesPending: 0`; all 383 scenarios carry a recorded baseline;
`quirk.reply-chain.never-settles.image-download` is the single scenario bearing an `expectedDeviation`
marker and records `timedOut: true` against the base commit; a
`test/parity/corpus.json.provenance.json` sidecar **does** exist, naming
`baseline.commit 2f8712a112db…`; and a replay of that scenario against the delivered tree records
`timedOut: false`, `status: approved-deviation`, `failing: false` and `verified: true`. Of the two
forms this record offered for settling the divergence — the carrier sentence becomes prospective, or a
capture is driven with its provenance — **the capture was driven**, so all three legs now state the
measured result: `docs/baseline-parity.md` §7.1 gave up its "annotation, not a measurement" reading,
and this document's **Gate** paragraph and §4.1 in `docs/deferred-dependencies.md` were re-stated from
a requirement into a result. Nothing about the deviation itself
moved: the conflict statement, the decision that R-b controls, the target expression at
`[T lib/controllers/files.js:171-173]`, the omitted `Content-Disposition` and the precedence argument
read the same in all three records, as they did throughout the disagreement.

**One residual, stated so the present tense is not over-read.** `verify:corpus` — a replay of the
whole committed corpus — still exits 2, because the corpus's provenance names a generator this
repository cannot retrieve; the evidence above comes from a re-capture of the scenario through the
delivered generator, which is the same mechanism the full gate needs
([`baseline-parity.md`](baseline-parity.md) §2.8).

**Deviation 2, the retained `marked` fork — three legs compared, one divergence.** The decision reads
the same in §11.2 above, in `docs/deferred-dependencies.md` §4.2 and in `docs/baseline-parity.md`
§7.2: the fork is retained, and the residual advisory is a named deviation of exactly one high with
zero critical. The four measured rendering differences — heading `id` attributes, task-list
`<input disabled type="checkbox">` markup, `javascript:` links reduced to bare text, and mixed
nested-list structure — appear as the same four in the same order in all three, each alongside the
deprecation notice emitted on every parse. All three assign the full reasoning, the precedence
argument and the named follow-up to `docs/deferred-dependencies.md` §4.2, which is where the notice's
literal text and the follow-up are stated.

**Divergence 2, deviation 2's `highlight.js` attribution.** §11.2 above says that "as a direct
consequence" of retaining the fork `highlight.js` stays at its baseline version, whereas
`docs/deferred-dependencies.md` §4.2's third consequence says `highlight.js` is deferred on its **own**
moderate-only grounds, is **not** a consequence of this decision, and that the two are decoupled. The
version is not in dispute — both records keep the baseline 9.18.5 — and neither reading changes a
decision, a version or a gate; only the causal attribution differs, and the decoupled one is what the
plan states. Settling it means §11.2 dropping the "direct consequence" framing for `highlight.js`
while keeping the `lib/shared/trinket-markdown.js` consequence, which both documents already state the
same way; that sentence belongs to §11.2 and to §4.2 of the companion document, so it is recorded here
rather than edited from this subsection.

**Numbering agrees.** Deviation 1 then deviation 2, in that order, in all three documents — §11.1 and
§11.2 here, §4.1 and §4.2 there, §7.1 and §7.2 in the parity record — each of which states that its
numbering follows this section.

`docs/error-edge-inventory.md` is not a fourth leg. It states neither deviation, and its ownership
table assigns "the two approved deviations" to this document, which agrees with the canonical role
claimed in §11.

One further note, recorded rather than acted on: `mkdocs.yml`'s `nav:` lists only `index.md`,
`setup.md` and `overview.md`, so this document is not part of the rendered documentation site.
Changing that navigation is outside the scope of this work and `mkdocs.yml` is not modified.
