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
| **scenario defined** | A scenario for this outcome is **committed** in `test/parity/corpus.json` with its steps, identity, fixture profile and expectation, **and carries a recorded baseline response** — but no replay result for the target. It is a captured baseline half, not a comparison |
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
summary.captured         -> false  (strict: EVERY scenario carries a baseline)
summary.scenarios        -> 392
summary.capturedScenarios -> 391
summary.baselinesPending -> 0      (nothing outstanding)
summary.unreachableByDesign -> 1   (client-contract.folder-duplicate-name.post-api-folders)
summary.undriven         -> 0
scenarios with a recorded baseline -> 391 of 392
recorded steps           -> 404    (394 with a status, 3 timed out, 7 transport failures)
summary.routesRepresented -> 233 of 233
embedded provenance       -> present and VERIFIED (role baseline, analysed tree 2f8712a,
                             generator test/parity/capture.js blob 93266288728d)
provenance sidecar        -> present (corpus.json.provenance.json)
expectedDeviation markers present -> 1  (quirk.reply-chain.never-settles.image-download)
```

So the corpus at this commit holds **392** scenario definitions and **391** recorded responses — the one exception is `client-contract.folder-duplicate-name.post-api-folders`, recorded `unreachableByDesign` because driving it terminates the application — driven
against a worktree at the base commit. Every reference below to a corpus scenario is therefore a
reference to a **committed definition, its declared expectation and a recorded baseline value**. The **comparison**
against the delivered tree has also run: `npm run verify:corpus` drives 391 of the 392 scenarios on
both cookie passes, with 367 matching and 23 differing in the non-secure pass, every difference
attributed. An earlier revision recorded the comparison as blocked because `replay.js` refused the
committed artifact, whose provenance was written in the capturing tool's own vocabulary and named a
generator this repository could not retrieve; re-capturing through the delivered generator resolved
that, and [`baseline-parity.md`](baseline-parity.md) §2.8 records both the ordering rule and the
same-port rule the capture depends on. Where an entry's *measured* half needed evidence beyond the corpus, it is a **probe** or
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
| [8](#8-the-streaming-asset-fetchs-two-failure-modes-and-recaptchas-faults) | Streaming asset fetch and reCAPTCHA faults | Unsettled request; two uncaught throws | 3 corpus scenarios + fixture profiles + the direct `verify()` driver |
| [9](#9-the-remaining-preserved-items) | Inert language maps, inert leak detection, retained logging, config gap, dead-code deletion, rejected cosmetics | Various, each recorded below | joi matrix, boot, R-a review |
| [9.7](#97-a-routed-handler-that-answers-500-where-its-author-intended-403) | `courses.download`'s unauthorized branch evaluates an unbound `Boom` | 500, not the 403 the expression names | Route sweep scenario + error-edge inventory |
| [9.8](#98-a-routed-handler-whose-metric-free-branch-answers-500-where-its-comment-intends-the-trinket-state) | `trinket.updateMetrics` executes one query twice on its metric-free branch | 500, not the trinket state the comment names | `PUT …/metrics` corpus scenario + a metric-free case still to be captured |
| [9.9](#99-two-routed-handlers-that-answer-200-carrying-the-name-of-a-missing-identifier) | `users.getExportStatus` and `users.downloadExport` evaluate an unbound `Boom`, and the finder re-invokes the throwing callback | **200** carrying `{"error":"Boom is not defined"}` | `error-edge.not-found.missingExport` + the route's success case |
| [10](#10-additional-measured-findings) | Findings beyond AAP §0.6.6 | In-memory queue events unreachable; inert test-mode mail guard; undeclared `chokidar`; the ZIP branch that terminated the process; the search-response seam; what `archiver` does and does not normalise | Worker harness; live probes; corpus digest; canonicaliser truth table |
| [10.4](#104-filessetthumbnail-authenticates-against-an-empty-committed-secret) | `files.setThumbnail` compares against an empty committed secret | Three outcomes; the **mutating** branch is unreachable while the secret is empty, so it fails closed | Route manifest + thumbnail corpus scenario |
| [10.5](#105-a-stored-file-is-downloadable-by-anyone-who-knows-its-id-or-its-content-hash) | File download has no owner or resource authorization | 200 with the bytes, for any identity, by id **or** content hash | Route manifest + 2 download corpus scenarios |
| [10.6](#106-serving-the-approved-image-response-serves-script-capable-legacy-content-inline) | The approved image response serves script-capable legacy content inline | 200 with the document's own `mime`, no CSP or `nosniff` — **open, no gate closes it** | None — stated in §10.6 |
| [10.7](#107-the-zipcode-branch-that-took-the-process-down-and-the-bounds-that-now-hold-it) | The `zipCode` branch that terminated the process, and the bounds that hold it | Bounded rejection replaces the process exit; the one field of the response that costs | `POST …/zip` + archive corpus |
| [10.8](#108-the-search-response-seam-the-client-reads-a-key-the-server-does-not-send) | The search response omits a key the client reads | Client reads an absent key; server shape unchanged | Search corpus |
| [10.9](#109-what-archiver-normalises-in-an-entry-name-and-what-it-passes-through) | What `archiver` normalises in an entry name, and what it passes through | Measured truth table the controller control matches, re-measured on the delivered 7.0.1 | Storage + worker gates |
| [10.10](#1010-the-four-outputfile-upload-routes-answer-415-to-multipartform-data) | The four `output:'file'` upload routes refuse `multipart/form-data` | **415** on all four, on hapi 20.3.0 and 21.4.10 alike | Route-sweep scenarios + the two per-major listener probes |
| [10.11](#1011-requestfailerr-with-an-error-argument-terminates-the-process) | `request.fail(err)` with an `Error` is refused by the toolkit and the process dies | Connection severed, no response, **no process** | `route.post.api-admin-user-userId.json`, which records the baseline's own socket hang up |
| [11](#11-the-two-approved-deviations) | **Approved deviations** — not preserved, and the register is **closed at two** | Stream response served; `marked` fork retained | Deviation allowlist in replay; audit |
| [11.4](#114-an-unapproved-security-policy-that-was-added-and-has-now-been-withdrawn) | **Withdrawn** — ten unapproved policies removed from the two auth/user controllers, the eight exposures preservation leaves open, and the three divergences native `fetch` brings with it | Unfiltered `next`; unguarded asset fetch; no OAuth `state`; plaintext provider token | Route manifest; suite; scenarios handed to the corpus work |
| [11.5](#115-a-second-unapproved-policy-in-the-route-parser-and-the-logger-and-now-withdrawn) | **Withdrawn** — six unapproved policies removed from `lib/util/routeParser.js` and `config/log.js`, with the measured effect on the route surface and the three exposures preservation leaves open | Unredacted failure flash and log line; off-origin `fail.redirect`, frozen for the process; prerequisites still ahead of validation | Route manifest (233/161/288); CLI digest; `quirk.fail-redirect-leak.post-users` |
| [A](#appendix-a--the-quirk-allow-list-for-generated-target-actions) | **Allow-list** — the sites whose governing target action a generator must not override | n/a — a contract, not a quirk | `docs/conversion-inventory.md` regeneration |

---

## 1. Three routes bound to controller methods that do not exist

**Measured** (static, plus probe and artifact). Three registered routes name controller methods that
are not defined in their controllers:

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

**The manifest is generated on demand, and this entry cites it as a probe.** The delivered tree
commits **no** manifest artifact — measured, `git ls-files test/parity/` matches none of
`route-manifest.json`, `route-manifest.baseline.json` or `route-manifest.compare.json`, all of which
an intermediate revision committed and this delivery removed as run outputs. The figures above are
therefore reproduced rather than opened: `npm run verify:routes` writes the manifest where `--out`
points it and reports `routes: 233`, whose 233 entries carry the `handlerKind` distribution and name
the same three fallback routes as the probe (**re-measured on the delivered tree**, exit 0). The generator does still write only where `--out` points it, which
is why the command stays recorded beside the artifact — the artifact is what a reader opens, and the
command is how it is regenerated. Other committed artifacts this document cites as artifacts are
`test/parity/corpus.json` (§4.3, §11.1) and `test/parity/joi-baseline.json` with its provenance
sidecar (§9.1).

**Target disposition.** The fallback branch is preserved verbatim, at
`[T lib/util/routeParser.js:550-552]`. All three routes keep answering exactly as they did.

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
`[T lib/util/helpers.js:202]`, with the redirect construction removed rather than converted, because
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

**Measured** (static, plus artifact; scenario defined). Chains 6–8 each do
`return reply(...).type(type)`. Because `.type()` returns the builder rather than a response, the
handler hands the wrapper a **plain builder object**, not a hapi response — and because `.type()` does
not settle, what a client receives depends on whether the deferred had already been settled earlier in
the request:

```javascript
// [B lib/controllers/trinket.js:1204]  downloadMain
        return reply(code[0].content).type(type);
// [B lib/controllers/trinket.js:1246]  downloadFile, code branch
          return reply(file.content).type(type);
// [B lib/controllers/trinket.js:1259]  downloadFile, asset branch
              return reply(stream).type(type);
```

**Target disposition: the baseline status, content type and body are to be reproduced**, captured from
the baseline server rather than reasoned about. This is the one category in this document whose target
disposition **cannot be stated from a static read**: what the builder emits depends on run-time state,
so the specification for these three responses is a measurement rather than a rewrite rule — and that
measurement **has been taken**, driven against a worktree at the base commit and recorded in the
corpus. The three therefore no longer carry an instruction to capture; they carry a captured value to
reproduce.

**Gate.** The three `quirk.reply-chain.builder-returned.*` scenarios in the table at the end of this
section. Each **carries a captured baseline response, but no replay result for the target** — which is
the same statement `docs/conversion-inventory.md` makes about the same three sites — so the gate is
half-complete rather than undefined: the baseline half is measured, and the target half is not
recorded. The recorded baseline responses are (artifact, `test/parity/corpus.json`, one recorded entry
per scenario, consistent with the
[capture status](#capture-status-stated-once-because-every-scenario-defined-tag-depends-on-it) above).
All three fields this sub-section names as the specification — status, content type and body — are
present on each entry, so all three are published here rather than only the status:

| Chain | Corpus scenario | Status | `contentType` | Body |
|---|---|---|---|---|
| 6 | `quirk.reply-chain.builder-returned.download-main` | **200** | `application/json; charset=utf-8` | `bodyLength` 2, `bodyDigest` `44136fa355b3…` |
| 7 | `quirk.reply-chain.builder-returned.download-code-file` | **404** | `text/html; charset=utf-8` | `bodyLength` 1545, `bodyDigest` `bd3587ea12a4…` |
| 8 | `quirk.reply-chain.builder-returned.download-asset` | **200** | `application/json; charset=utf-8` | `bodyLength` 2, `bodyDigest` `44136fa355b3…` |

Those are the values a client observed at `2f8712a`, and they are what may now be cited as the
specification: a target that answers anything else on one of these three has changed the behaviour,
whatever the builder was doing underneath. Two of the three are worth reading rather than skimming —
chains 6 and 8 recorded a **200 with a two-byte JSON body**, which is what handing hapi an unsettled
builder object produced, and chain 7 recorded a **404 rendered as HTML**. Neither is the file payload
the expression appears to name, and reproducing them means reproducing that. The body is recorded as a
length and a digest rather than inline, which is the corpus's own comparison form for a body;
`bodyDigest` is abbreviated here and is complete on the scenario in the artifact.

**What is still missing, exactly, and the command that records it.** No `replayVerdict` and no
`targetResponse` is recorded against any of the three in the committed corpus, so nothing yet compares
the two trees for these chains. What produces that half is a re-capture through the delivered
`test/parity/capture.js` followed by `npm run verify:corpus`, which today exits **2** and refuses the
committed corpus because that artifact carries no embedded provenance block; the precondition and its
command are in [`baseline-parity.md`](baseline-parity.md) §2.8.

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

**Gate.** One corpus scenario per chain, eight in total — all eight **defined** and all eight carrying
a recorded baseline response, none yet compared against the delivered tree. The "expectation" column
is each scenario's committed declared expectation, which is what the comparison will assert; it is not
the recorded result, and where the recorded result is the specification it is stated in the
sub-section that owns it (§4.3 for chains 6–8, §11.1 for chain 1):

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
converting it — `[T lib/controllers/pages.js:21]` and `[T lib/controllers/pages.js:33]` still read
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
| 2 | `?limit=20`, which is the query the shipped client sends | `status: 200` only | Status is asserted; the body is **observed, not asserted** — for the measured reason in §7.1 |

**Two things about the state of that gate, said rather than implied, because earlier revisions of this
section have been wrong about it in both directions — once overstating what was enforced, once
understating what had been implemented.**

*Step 1's `bodyIncludes` clause is executable.* It is committed in the scenario, it is the right
clause, and the replay tool evaluates it (**static**, read from the delivered source): `bodyIncludes`
is in the operator list at `[T test/parity/replay.js:460]`; it is schema-validated at
`[T test/parity/replay.js:6208-6210]`, where a clause that is not a non-empty string is **rejected**
rather than skipped; and it is evaluated at `[T test/parity/replay.js:6358-6374]`, which fails the step
when the recorded body does not contain the string — and fails it too when the step recorded no text
body to search in. An earlier revision of this section recorded the operator as unimplemented and
therefore silently ignored, and named that as a separately-owned finding against the expectation
evaluator; the operator is implemented, so that finding no longer describes anything and the clause is
an assertion rather than a comment. What this section's comparison still waits on is the **other
half** — a replay result for this scenario against the delivered tree, which
[`baseline-parity.md`](baseline-parity.md) §8 carries as the delivery's largest open item.

*What IS enforced today, in code, is that the difference cannot be waved through.* Both step bodies are
compared between the two trees by the ordinary difference ledger, and after the deviation-approval
contract in [§11.0](#110-the-register-is-closed-and-this-is-the-machine-readable-form-of-that) was made
an allowlist, a marker on this scenario — from the corpus or from an external annotations file — is
**rejected** rather than honoured, because its id is not the one allowlisted id. So a difference here
can only be reported as unapproved. That guarantee is structural and holds now, independently of
whether the comparison has been driven, and it is the part of this gate that is real at this commit.

### 7.1 The query-bearing case's empty list was an artefact of the driven query, and is corrected

**This entry replaces an earlier, wrong one, and the correction is the substance.** An earlier
revision recorded that step 2 — the well-formed, query-bearing case, in which the folder filter *does*
apply — "also answered with an empty `data` list", and reasoned about that emptiness as a
**fixture-visibility** property of the seeded folder membership. It was neither. The emptiness was a
property of the **query key the step was driven with**, and with the key corrected the two halves of
§7's quirk differ observably, which is what makes that section's gate checkable rather than
theoretical.

**Measured** (captured baseline responses, read from the committed corpus rather than from a
construction-time reading of the delivered tree — which is what the earlier revision rested on).
`quirk.folders-trinkets.queryless-and-query-bearing` in `test/parity/corpus.json` carries a captured
response for each step:

```text
step 1  queryless      GET /api/folders/000000000000000000000401/trinkets
                       -> 200, body {"data":[], ...}                        (0 entries)
step 2  query-bearing  GET /api/folders/000000000000000000000401/trinkets?limit=20
                       -> 200, body {"data":[ ...two trinkets... ], ...}    (2 entries:
                          000000000000000000000201 and 000000000000000000000203)
```

Two entries is exactly the seeded folder's membership `[T test/parity/seed.js:788-790]`, so the filter is
genuinely exercised on step 2 and genuinely absent on step 1.

**Why the earlier reading was wrong, stated as the mechanism rather than as an oversight.** Step 2
used to be driven with `?published=true`. `published` is **not a declared query key on
`GET /api/trinkets`**, which is the route the malformed-URL handler injects into, so the *inner* route
failed its own hand-rolled validation and the case recorded a validation refusal while appearing to
measure the folder filter. The empty `data` the earlier revision promoted into this catalogue was that
refusal, not a fixture property. The delivered scenario records the same correction in its own notes,
including the address of the shipped client code the replacement query is taken from —
`public/js/library/trinkets/list/folder-list-controller.js:29-31` builds `{limit: 20}`, its lines 46,
50, 54 and 58 add `from`, `offset`, `sort` and `user`, and line 69 sends the result — every one of
those keys being one `GET /api/trinkets` declares
`[T test/parity/capture.js:3061-3070]`.

**Why step 2's body is still observed rather than asserted, which is the one part of the earlier entry
that survives.** *Which* trinkets the folder-filtered query returns is a property of the seeded
membership, not of the malformed-URL quirk §7 is about. Declaring "the two bodies differ" as the
scenario's expectation would make the case fail for a reason that has nothing to do with the behaviour
under test, and would put the weight on a clause that is not the invariant. So the asserted clause
stays on step 1 — `status: 200` with `bodyIncludes: "data":[]` — and step 2 asserts only its status
`[T test/parity/capture.js:3084-3089]`, while `replay.js` compares both bodies between the two trees
through the ordinary difference ledger.

**What it is not: an approved deviation.** The register in [§11](#11-the-two-approved-deviations) is
**closed at two entries** and this is not one of them. A driven replay observing step 2's body
differing between the two trees is an **unapproved difference and a failure** — reported through the
ordinary difference ledger and investigated, never marked approved. The corrected query does not
change that; it changes only what the recorded baseline body is, from an inner-route validation
refusal to the folder-filtered list.

**Target disposition: none — this is a correction to the evidence, not a preserved behaviour.** §7
carries the preserved behaviour and its target construction; this entry exists to keep the corrected
measurement visible, because the wrong one was published here and a reader who found only the
correction in a source comment would have no way to know which reading governs. It remains listed in
the Index under §7 rather than as a quirk of its own.

**Gate.** Step 1's `bodyIncludes` clause, which is the assertion; the ordinary body comparison on step
2, which reports a difference without pre-approving one; and the seeded folder membership in
`test/parity/seed.js`, which is what makes step 2's two entries the expected count.

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
carry recorded baseline responses like every other scenario
([capture status](#capture-status-stated-once-because-every-scenario-defined-tag-depends-on-it)), and
what is not yet recorded for them is the comparison against the delivered tree:

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

**Evidence: every outcome has a driver, and it invokes `verify()` directly rather than through a
route.**

What exists (verified in the delivered tree):

- the six outcomes above, read from the 26-line module (**static**);
- **recorded fixture responses** for the four HTTP-reachable outcomes, in
  `test/parity/fixtures/http.js` — `recaptcha:success`, `recaptcha:rejected`, `recaptcha:non-200`,
  `recaptcha:transport-failure` and `recaptcha:malformed-json`. The two short-circuits need no
  recorded response, because they return before any HTTP happens;
- **the driver that consumes them, in that same file** (**static**, read from the delivered source).
  `recaptchaCases()` `[T test/parity/fixtures/http.js:3747]` and `childCases()`
  `[T test/parity/fixtures/http.js:4794]`, under the heading `THE SELF-VERIFYING HARNESS`
  `[T test/parity/fixtures/http.js:3183]`, require `lib/util/recaptcha.js` and call `verify()` against
  those recorded responses. The file says so in its own group header — "Group: reCAPTCHA, all six
  outcomes, by DIRECT MODULE-LEVEL INVOCATION of `lib/util/recaptcha.js`'s `verify()`", which goes on
  to record that this is "the group the header promised and nothing performed" and that "direct
  invocation is the only way they are ever exercised"
  `[T test/parity/fixtures/http.js:3734-3746]`. The two preconditions that make outcomes 3–6 reachable
  at all are named and *arranged* at `[T test/parity/fixtures/http.js:5105-5133]`: a present
  `config.app.recaptcha.secretkey` — supplied by `SELFTEST_SECRET_OVERLAY`
  `[T test/parity/fixtures/http.js:3233]` when the tree has none — together with `config.isTest` set
  falsy, both established before the module is required and both put back afterwards. It runs as
  `node test/parity/fixtures/http.js`, which drives every profile in the catalogue and every reCAPTCHA
  outcome and exits non-zero if any case fails or any profile went unselected; `selfTest()`
  `[T test/parity/fixtures/http.js:5025]` is the same thing as a function, exported at
  `[T test/parity/fixtures/http.js:3173]` for a sibling tool that folds the result into its own gate.

**An earlier revision of this document recorded the opposite**, and the correction is worth stating
because the two readings are not close: it said "there is no driver that invokes `verify()` directly",
read the file's notes as a design statement about what such a driver *would* have to do, and concluded
that the five recorded responses were unexecuted. The invocation is in the file, so outcomes 3–6 are
exercised rather than specified, and this entry is no longer the weakest-evidenced one in the
catalogue.

**Why the driver has the shape it has — which is the part of the earlier statement that was right, and
is the reason a route-driven case cannot substitute for it.** Under `NODE_ENV=test` outcome 1
short-circuits before any HTTP happens and **always wins**, so no route-driven case can reach outcomes
3–6 at all; that is why there is no corpus scenario for them and why direct invocation is the only way
they are ever exercised. Outcomes 5 and 6 go further: they deliver **no callback**. They are
process-level signatures — an uncaught throw, and a callback that never arrives — so they can only be
asserted from outside the process they kill `[T test/parity/fixtures/http.js:4833-4863]`, and a route-driven
case would hang without distinguishing either fault from any other timeout.

**Gate, as it stands.** Outcomes 1 and 2 are covered by every `NODE_ENV=test` request that reaches a
reCAPTCHA-guarded route, which is the whole existing suite. All six, those two included, are
additionally driven by the direct driver above, and what each case asserts is recorded rather than
summarised (**static**, read from the delivered source):

| Outcome | How it is driven | What is asserted |
|---|---|---|
| 1 | bounded child process, a secret **configured**, profile `recaptcha:non-200` selected | exit 0; `config.isTest` true; the short-circuit value; and **zero** intercepted HTTP calls — the selected profile would have produced `{status:false}` had the call reached the fixture, so the value proves which branch ran, and the configured secret rules out outcome 2 as the cause |
| 2 | bounded child process, secret **unset**, same profile selected | exit 0; `config.isTest` falsy; `secretkey` empty; the same short-circuit value; zero intercepted calls |
| 3 | in-process, profile `recaptcha:success`, through a 5000 ms-bounded callback wrapper | `verify()` calls back; the parsed body reaches the caller with its `success`, `challenge_ts` and `score` fields; and the outbound call is one `POST` with `content-type: application/x-www-form-urlencoded` carrying both `secret` and `response`, the secret redacted in the evidence |
| 3, rejected variant | in-process, profile `recaptcha:rejected` | `success` reaches the caller as `false`, and the provider's `error-codes` array survives the parse |
| 4 | in-process, profile `recaptcha:non-200` | the callback value is exactly `{"status":false}` and carries **no** `success` key — the shape difference the callers described above branch on |
| 5 | bounded child process, profile `recaptcha:transport-failure` | exit **1**; the callback marker **absent**; stderr carrying a `TypeError` that names `statusCode` — the read of `response.statusCode` on an undefined response |
| 6 | bounded child process, profile `recaptcha:malformed-json` | exit **1**; the callback marker **absent**; stderr carrying a `SyntaxError` out of `JSON.parse` |

Outcomes 1 and 2 are driven in child processes for a different reason from 5 and 6: they need mutually
exclusive configuration states, which one process cannot hold at once.

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

**Target disposition: retained unchanged**, at `[T lib/util/routeParser.js:442]`,
`[T lib/util/routeParser.js:513]` and `[T lib/util/routeParser.js:523]`, alongside the surrounding
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
`[T test/parity/convert-inventory.js:6537-6541]` — and this is that expression. It is also the reason
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
`[T lib/controllers/courses.js:214-218]` — the course-owner role, a `public` course type, an `open`
course type, the `create-private-course` permission, or `make-course-copy` on this course. An
authenticated visitor holding none of those takes the `else`, and the expression it reaches differs
between the trees by the wrapper only:

```javascript
// [B lib/controllers/courses.js:289]
      return reply(Boom.forbidden());
// [T lib/controllers/courses.js:432]
      return Boom.forbidden();
```

**`Boom` is not bound in this module, and never has been on either tree.** The module's only
`@hapi/boom` binding is `errors` — `[B lib/controllers/courses.js:14]`, `[T lib/controllers/courses.js:19]`
— and `Boom` is not one of the implicit globals the bootstrap creates. Those are created by undeclared
assignment at `[B app.js:290-298]`, `[T app.js:367-375]`, and are exactly `User`, `Course`, `Lesson`,
`Material`, `File`, `Trinket`, `Interaction`, `Folder` and `CourseInvitation` — the only such
assignments in the file, and there is no `global.` assignment anywhere in it (static, over `app.js`).
So evaluating this
expression throws a `ReferenceError` **before any response is constructed**, the handler rejects, and
the preserved handler catch-all `[B lib/util/routeParser.js:578-589]` maps it to
`Boom.badImplementation(...)` — a **500**, where the expression names a 403.

**A measured detail: the two trees throw on different identifiers, and the outcome is the same
anyway.** Which identifier fails first is decided by evaluation order, and the trees differ because
the second parameter was renamed:

| Tree | The expression | Thrown | Why |
|---|---|---|---|
| Baseline | `return reply(Boom.forbidden());`, in `function(request, reply)` where `reply` is a parameter | `ReferenceError: Boom is not defined` | the callee `reply` resolves, then the argument `Boom.forbidden()` is evaluated and fails |
| Target | `return Boom.forbidden();`, in `async function(request, h)` | `ReferenceError: Boom is not defined` | the conversion dropped the `reply(...)` wrapper, so `Boom` is the only unbound identifier on the line and it is evaluated first |

The **client-visible response is identical**, because a 500 Boom redacts its message: both produce
`{"statusCode":500,"error":"Internal Server Error","message":"An internal server error occurred"}`.
This is the same redaction argument §5 relies on, and it holds here for the same reason. The delivered
code states the whole chain inline at `[T lib/controllers/courses.js:421-431]` — the missing binding,
the `ReferenceError`, the catch-all's 500 and the header difference below — and
`docs/error-edge-inventory.md` attributes the throw to `Boom` as well, which is now correct for both
trees. An earlier revision of this entry recorded the target as throwing on `reply` instead, from a
draft in which the wrapper was still present; the delivered expression carries no `reply`, and the
thrown identifier is `Boom` on both trees.

**The error-funnel consequence, per branch as measured rather than as the code's shape suggests.**
`onPreResponse` `[T app.js:202-245]` returns **early** for a browser HTML request at any status ≥ 500,
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
`request.fail(...)` on failure `[T lib/util/routeParser.js:506-508]` versus the handler invocation at
`[T lib/util/routeParser.js:522]`. So all three scenarios record the validation-failure path, not this
handler — which also means they do not gate the four working chain outcomes they appear to.

**One half of that is now fixed and the other half is blocked on a fixture, so both are stated
exactly.** The `format=zip` default was a defect rather than a choice, and it is corrected: the query
default at `[T test/parity/capture.js:719-727]` and the chain scenario's target at
`[T test/parity/capture.js:3287-3288]` both now use `format=md`, with the measurement recorded inline. That
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

### 9.8 A routed handler whose metric-free branch answers 500 where its comment intends the trinket state

The second entry in this catalogue that reaches the client as **a status the surrounding code does not
name**, and it is recorded for the same reason as [§9.7](#97-a-routed-handler-that-answers-500-where-its-author-intended-403):
a deliberately retained shape whose preserved outcome a generated conversion mandate would destroy.
`docs/conversion-inventory.md`'s lifecycle row for this handler is
`[T docs/conversion-inventory.md:568]`, and what it records is the reason this entry exists: the site
"delivers on every path, with 1 of 2 signalling calls discarded", and the generated target action says
so plainly — "That is the BASELINE outcome, not an unfinished conversion … Do NOT reroute them to
deliver -- that replaces the value this body returns with a different response, which is a behaviour
change (R-d)." Rerouting it to deliver is precisely what must not happen here, which is why
`updateMetrics` also appears on the [Appendix A](#appendix-a--the-quirk-allow-list-for-generated-target-actions)
allow-list. **An earlier revision of this paragraph cited a different row and quoted it as "RELIES ON
THE INTERCEPTION" with a mandate to "deliver the response on every path".** That was a row from an
earlier rendering of a generated document; regenerated against this tree, the handler's row is closed
and carries the wording above, and the "relies on the interception" phrasing now appears only against
the unrouted pre-handler `trinketByOwnerAndSlug` `[T docs/conversion-inventory.md:1372]`. The
substance is unchanged and is in fact stated more directly: the generated instruction for this site is
to leave it alone.

**The route is real and routed.**

| Property | Value | Address |
|---|---|---|
| Route | `PUT /api/trinkets/{trinketId}/metrics` | `[B config/api_routes.js:948]` |
| Binding | `trinket.updateMetrics` | same |
| Auth | none declared, so it inherits the default `mode: 'try'` `[T app.js:361]` — the branch is reachable **anonymously** | `[B config/api_routes.js:949-957]` |
| Pre-handlers | none | same |
| Validation | `payload` only: `runs`, `linkShares`, `embedShares`, all `Joi.boolean()` and all **optional**, which is what makes a payload carrying none of them valid | `[B config/api_routes.js:950-956]` |
| Reply spec | `{ data : { metrics : 1 } }` | `[B config/api_routes.js:958-962]` |

**Measured** (probe, on the delivered tree, against a live server). `metric` is
`Object.keys(request.payload)[0]` `[T lib/controllers/trinket.js:612]`, so a valid payload with no
metric key takes the `!metric` branch `[T lib/controllers/trinket.js:614-624]`:

```text
PUT /api/trinkets/<id>/metrics   Content-Type: application/x-www-form-urlencoded   body: (empty)

HTTP/1.1 500 Internal Server Error
cache-control: no-cache · Pragma: no-cache · Expires: 0
content-type: application/json; charset=utf-8 · content-length: 96
{"statusCode":500,"error":"Internal Server Error","message":"An internal server error occurred"}
```

Identical in **both** accept modes — `Accept: application/json` and `Accept: text/html` — and, for
contrast, the same request carrying `runs=true` answers **200**. The comment on the branch names "the
current trinket state"; no client has ever received it.

**The mechanism: one query, executed twice.**

```javascript
// [B lib/controllers/trinket.js:441-443]  ·  [T lib/controllers/trinket.js:621-623]
      return Trinket.findById(request.params.trinketId, function(err, trinket) {
        return request.success({data:trinket});
      });
```

Passing a callback to a Mongoose query **executes** it. Returning the same `Query` object hands the
wrapper a thenable, which it awaits — a second execution of an already-executed query, which Mongoose 6
refuses. Measured server-side log line, and the frame it surfaced in:

```text
MongooseError: Query was already executed: Snippet.findOne({ '$or': [ { _id: … } ] })
    at route.handler ([T lib/util/routeParser.js:522])
```

`Snippet` is this model's mongoose name and `findOne({$or:…})` is what the model's own `findById`
issues. Two consequences follow, and both are load-bearing for the target disposition:

1. the `request.success({data:trinket})` built **inside** the callback is a real toolkit response that
   is returned into Mongoose's callback frame and read by nobody — it is the signalling call the
   conversion inventory records as "dropped inside a nested function", one of two whose value "is
   discarded" `[T docs/conversion-inventory.md:568]`; and
2. the response the client receives comes from the **rejection**, through the preserved handler
   catch-all `[T lib/util/routeParser.js:554-565]`, baseline `[B lib/util/routeParser.js:578-589]`,
   which maps it to `Boom.badImplementation(err.message)` — a 500 whose message Boom redacts.

**Why both accept modes answer identically, where §9.7's two modes differ.** `onPreResponse`
`[T app.js:202-245]` classifies a request as API/JSON when the **path** begins `/api/`, before it looks
at `Accept`. This route always matches that test, so it never takes the browser-HTML branch that returns
early at status ≥ 500, and the `Cache-Control` / `Pragma` / `Expires` assignments therefore **do** run —
visible in the measurement above. §9.7's route is a page path and takes the other branch. Same funnel,
opposite side of the same `if`, and only a measurement distinguishes them.

**Target disposition: preserved exactly, and deliberately not repaired.** The callback form **and** the
returned `Query` are both retained, because it is the combination that produces the 500. Awaiting the
query once, or dropping the callback, or returning the callback's response, would each turn this branch
into a **200 carrying the trinket state** — a behaviour change and an error-mapping change, which R-d
and R-e prohibit independently. This is the mechanism-versus-outcome rule of this document in the same
form as §9.7: the statement is preserved because preserving the statement is what preserves the outcome.
It is not a deviation and it is not a shortfall — it is a preserved defect, and the only thing this
migration owes it is a record.

**Gate, stated with the gap it still has.** One scenario targets this route in the committed corpus
(probe, over `test/parity/corpus.json`): `route.put.api-trinkets-trinketId-metrics.json`, driving
`PUT /api/trinkets/000000000000000000000201/metrics` as **anonymous** with
`runs=true&linkShares=false&embedShares=false` and recording **200**, body length 86. That is the
*metric-bearing* branch. **No committed scenario reaches the branch this entry is about**, and the
requirement is fully specified rather than left as an observation: one further scenario driving the same
route and identity with a **payload carrying none of the three declared keys**, asserting **500** and,
in the JSON accept mode, the `Internal Server Error` payload above — plus the `Cache-Control` / `Pragma`
/ `Expires` headers, which are what distinguish this branch's funnel from §9.7's. Like §9.7's missing
case, it belongs in the builder that emits the scenario array in `test/parity/capture.js` followed by a
re-capture: the corpus is that generator's output, so editing the artifact alone would be overwritten by
the next capture and would carry no provenance. Until that case exists, the standing gate is the
difference ledger — this route's recorded 200 is compared between the trees, and because the register in
[§11](#11-the-two-approved-deviations) does not name this site, any change here is reported as an
**unapproved** difference. The per-edge status and payload belong to `docs/error-edge-inventory.md`,
which must carry this as a **routed 500 edge** rather than as the trinket state the comment names.

### 9.9 Two routed handlers that answer 200 carrying the name of a missing identifier

The third entry of the family [§9.7](#97-a-routed-handler-that-answers-500-where-its-author-intended-403)
and [§9.8](#98-a-routed-handler-whose-metric-free-branch-answers-500-where-its-comment-intends-the-trinket-state)
open, and the one that reaches a client furthest from what its code reads like: not a status the
surrounding code does not name, but **a success status whose body is the name of an unbound variable**.
`GET /api/exports/{exportId}` answers **200** with `{"error":"Boom is not defined"}` where the
expression it took reads `Boom.notFound('Export not found')`.

**The routes are real and routed.**

| Property | Value | Address |
|---|---|---|
| Routes | `GET /api/exports/{exportId}` and `GET /api/exports/{exportId}/download` | `[B config/api_routes.js:1521]`, `[B config/api_routes.js:1527]` |
| Bindings | `users.getExportStatus`, `users.downloadExport` | same |
| Auth | `auth: 'session'` — so the visitor is authenticated | `[B config/api_routes.js:1522-1524]`, `[B config/api_routes.js:1528-1530]` |
| Pre-handlers | none | same |
| Validation | none declared, so any `{exportId}` reaches the handler | same |

**`Boom` is not bound in this module, and never has been on either tree** (**static**). The module's
only `@hapi/boom` binding is `errors` — `[B lib/controllers/users.js:2]`, `[T lib/controllers/users.js:2]`
— and `Boom` is not one of the nine implicit globals the bootstrap creates by undeclared assignment
(`User`, `Course`, `Lesson`, `Material`, `File`, `Trinket`, `Interaction`, `Folder`,
`CourseInvitation`; `[B app.js:290-298]`, `[T app.js:367-375]`). Counted over `lib/controllers/users.js`, **15 `Boom.*`
references** stand in executable positions on each tree — baseline lines 213, 377, 545, 562, 579, 667,
680, 1027, 1031, 1059, 1064, 1078, 1082, 1086 and 1090, delivered lines 351, 568, 753, 773, 792, 961,
976, 1387, 1391, 1422, 1430, 1449, 1453, 1457 and 1461 — against exactly **three** live `errors.*`
calls, at `[T lib/controllers/users.js:718]`, `[T lib/controllers/users.js:732]` and
`[T lib/controllers/users.js:811]`. So this is not a typo in one branch; it is the module's whole
error-construction surface.

**Why the outcome is a 200 and not §9.7's 500 — three steps, and the middle one is the interesting
one.**

1. **The `ReferenceError` is thrown before any response is built.** `resolve(Boom.notFound(…))`
   evaluates its argument, which fails, so nothing is ever handed to `resolve`. This is §9.7's step,
   and on its own it would reach the handler catch-all as a 500.
2. **The handler's own inner `catch` throws in turn.** `[T lib/controllers/users.js:1421-1423]`
   answers the caught error with `resolve(Boom.internal('Export status error'))`, on the same unbound
   identifier, so the catch cannot absorb the failure and the throw **escapes the `Export.findById`
   callback**.
3. **The generated finder re-invokes the very callback that threw, with the `ReferenceError` as its
   `err`.** `[T lib/models/model.js:147]` — `promise.then(function(doc) { cb(null, doc); }).catch(cb);`,
   byte-identical to `[B lib/models/model.js:147]` — attaches the caller's callback as the rejection
   handler of the same chain whose fulfilment handler called it. The callback runs a second time, this
   time takes `if (err)` at `[T lib/controllers/users.js:1382-1384]`, and answers
   `request.fail({ error: err.message })`. `request.fail` with a JSON accept mode returns
   `h.response(json)` at `[T lib/util/routeParser.js:316]` — a **200**, because `request.fail` sets no
   status of its own.

**Measured, both halves.**

```text
BASELINE  (artifact) test/parity/corpus.json  scenario error-edge.not-found.missingExport
          GET /api/exports/0000000000000000000006ff   identity user   Accept application/json
          -> 200, content-type application/json; charset=utf-8, content-length 42
             {"error":"Boom is not defined","flash":{}}

TARGET    (probe) through a running server on this tree, same identity and accept mode
          GET /api/exports/000000000000000000000000
          -> 200, content-type application/json; charset=utf-8
             {"error":"Boom is not defined","flash":{...}}
```

The `flash` key is `request.fail`'s own flash attachment `[T lib/util/routeParser.js:308]`, so its
contents are whatever session state the identity carries; the `error` value is the invariant. The
corpus scenario's own note records that an earlier draft of it expected "not 200" and was wrong, which
is the measurement deciding a documented assumption — the case R-f exists for.

**Target disposition: preserved exactly, in three places at once.** The 15 expressions are retained
verbatim; `lib/models/model.js` is kept **byte-identical to baseline** (`git diff 2f8712a -- lib/models/model.js`
is empty, **probe**) precisely because the double invocation is load-bearing rather than incidental;
and the order of identifiers on each line is preserved, because a callee is resolved before its
arguments and `Boom` therefore has to remain the **first** unresolvable name on the line for the
client-visible message to stay `Boom is not defined`. The delivered code states all three constraints
inline at `[T lib/controllers/users.js:1363-1373]` and `[T lib/controllers/users.js:1444-1447]`.
Binding `Boom`, rewriting the calls as `errors.*`, or "repairing" the finder so a throwing callback is
not re-entered would each change a status **and** a body, which R-d and R-e prohibit independently.

**Gate.** `error-edge.not-found.missingExport` carries the baseline value above and is compared between
the trees by the replay; `route.get.api-exports-exportId.json` covers the same route's success branch
(recorded 200 with the export document) so that a change to the not-found branch cannot hide behind an
unexercised route. Because the register in [§11](#11-the-two-approved-deviations) does not name this
site, any difference here is reported as **unapproved**. The per-edge status and payload belong to
`docs/error-edge-inventory.md`; the `getExportStatus` rows there must read as **200 edges carrying an
`error` field**, not as the 404/403/400 the expressions name.

**One consequence worth stating plainly, because it is not a repair.** The same re-invocation makes
`request.fail(err)` reachable with an `Error` argument, and that is a different and harsher outcome —
[§10.11](#1011-requestfailerr-with-an-error-argument-terminates-the-process) records it, and it is the
same `lib/models/model.js:147` bridge doing the work in both entries.

---

## 10. Additional measured findings

Baseline behaviours measured in the delivered tree that AAP §0.6.6 does not enumerate. §0.6.6 is the
mandatory floor for this document, not its ceiling. Every entry below was measured here rather
than inherited from the plan, and §10.2 **contradicts** the premise §0.6.6 carried — which is the case
R-f exists to decide, and it decides it for the measurement.

**§10.4, §10.5 and §10.6 are the security-relevant entries, and they are here rather than in §11 by
the same distinction §11.3 draws.** None is a deviation: nothing about any of them was changed, argued
away or approved. Each is an **open weakness a reviewer correctly identified**, whose repair R-d and
AAP §0.2.2 place outside this migration. §10.4 and §10.5 are preserved baseline behaviours whose root
cause sits in configuration and route declarations this delivery does not touch. §10.6 is different in
kind and is the more important of the three to read: it is a boundary that the migration's own approved
response leaves open, so it is **not** inherited from the baseline in the way the other two are, and
**no gate in this migration closes or even reports it**. Recording all three as open is what keeps them
visible; calling any of them a deviation would claim an approval that does not exist, and repairing any
of them silently in a source file would be the drift §11.1 was corrected for.

Three of them — [§10.7](#107-the-zipcode-branch-that-took-the-process-down-and-the-bounds-that-now-hold-it),
[§10.8](#108-the-search-response-seam-the-client-reads-a-key-the-server-does-not-send) and
[§10.9](#109-what-archiver-normalises-in-an-entry-name-and-what-it-passes-through) — were added
after a code review of the delivered tree rather than during the conversion. §10.7 is the one a reader
should not skim: it is the place in this catalogue where an outcome is deliberately **not** preserved
without being a numbered deviation, and it says exactly which field of which response that costs.
§10.9 is the measured library behaviour that a security control in the same controller is built to
match, and it is here rather than in a code comment because the control has to keep matching it.

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
// [B lib/workers/exports.js:106-108]  ·  [T lib/workers/exports.js:176-178]
  if (!config.isTest) {
    env = nunjucks.configure(config.app.templates);
  }
```

`env` occurs at **exactly two places in the file, on both trees**, and neither is a read (static, every
`\benv\b` token in the module):

| Tree | Declaration | Assignment | Reads |
|---|---|---|---|
| Baseline `2f8712a` | `[B lib/workers/exports.js:19]` `, env;` | `[B lib/workers/exports.js:107]` | **none** |
| Target | `[T lib/workers/exports.js:31]` `, env;` | `[T lib/workers/exports.js:177]` | **none** |

Both mail paths call the **module-level global** `nunjucks.render`, not `env.render`:

```javascript
// [T lib/workers/exports.js:562]   var html = nunjucks.render('emails/export-ready', templateData);
// [T lib/workers/exports.js:575]   var html = nunjucks.render('emails/export-failed', templateData);
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
complete context and **1066** with the five-key context `sendCompletionEmail` itself passes — the
latter being what the harness records today (**artifact**,
`templates.afterWorkerRequire = {rendered: true, bytes: 1066, error: null}`, against
`beforeWorkerRequire = {rendered: false, bytes: null, error: "template not found:
emails/export-ready"}`). Both agree on the only claim this entry makes — that it renders rather than
throwing — so that is the claim, and no invariant is asserted about the number. A gate written against
a specific length would fail on a template edit that changed nothing about the behaviour, which is
also why an earlier third figure carried here from a superseded harness revision is dropped rather
than reconciled: the number was never the claim, and the citation it hung on no longer resolves.

**Target disposition: the guard is preserved as written, and it stays inert.** Deleting it would be
tidying that R-a excludes; "fixing" it by rendering through `env` would change which environment the
mail path uses, and repairing the dead variable would suggest a defect that has no observable
consequence. Both mail paths keep calling the global `nunjucks.render`.

**What this means for the worker and mail expectations, since they were aligned to the wrong claim.**
The completion notification does **not** fail under `NODE_ENV=test`, and a harness must not configure
nunjucks to make it work — configuring it would mask the very side effect described above, and
requiring `lib/util/nunjucks` from a harness has its own measured cost (see §10.3). The correct shape
is to **assert the resolution as a precondition** and let the require graph supply it, which is what
the worker harness does: it measures the resolution **before** the worker is required
`[T test/parity/worker.js:6875-6879]`, measures it again **after**
`[T test/parity/worker.js:6922-6923]`, and asserts the "after" is a successful render
`[T test/parity/worker.js:6934-6943]` — recording both observations either way. The
captured-mail fixture then asserts a delivered message with rendered HTML on the success path, rather
than a swallowed template error.

**Gate.** The worker harness's template-resolution precondition — the before/after pair above, whose
"after" must be a successful render — together with its captured-mail fixture asserting the delivered
completion message on the successful job and the failure message on the failing one.

### 10.3 The test-mode template watcher runs on an optional peer the root no longer declares

**Measured** (static, plus probe and artifact). `lib/util/nunjucks.js` configures the global
environment with watching enabled outside production:

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

1. **A handle inventory, and where it can and cannot arise.** The watchers this configuration
   creates are `FSEventWrap` handles, and they cannot be closed by a caller: nunjucks 3.2.4's
   `FileSystemLoader` keeps the `FSWatcher` in a constructor-local variable and exposes no `watcher`
   property. So they can only be **prevented**, and the worker harness prevents them:
   `installTemplateWatchSuppression` passes `watch: false` through nunjucks' own `configure` API
   before the first application require, so no watcher starts and no `chokidar` enters the require
   cache. Their classification is unchanged and is what that suppression exists to respect: they
   are **not** an approved deviation — see
   [§11.3](#113-what-is-not-a-deviation-and-why-the-register-is-closed) — the harness allow-lists
   nothing but the `stdio` partition, and a surviving watcher handle would be `unexpected` and would
   fail the clean-close check. Measured, with a live watcher open: `inspectHandles()` reports `counts
   {"FSEventWrap":1}`, `allowed []`, `unexpected ["FSEventWrap"]`. In the worker gate that condition
   does not arise.
   What stays recorded here is the **application's own** reliance, which that suppression does not
   remove and is not meant to: `[T lib/util/nunjucks.js:8]` still configures `watch: true` outside
   production, so a `NODE_ENV=test` run of the application itself still starts watchers and still
   reaches `chokidar` through nunjucks' optional peer.
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

**Gate.** Two of them, covering the two different halves of this entry. The `NODE_ENV=test` suite
exercises the application's own watching path on every run and would fail at require time if the
optional peer stopped resolving. The worker harness's **clean-close** check **passes**, because the
watcher never starts there — recorded in the harness's own artifact at the delivered HEAD (artifact):

```text
handles                             -> {"counts":{},"stdio":{},"allowed":[],"unexpected":[]}
templates.watchSuppressed           -> true
dependencies.templateWatch          -> configureCalls 1 · watchRequested 1 · watchApplied 0
dependencies.templateWatch.chokidar -> loaded false · modulesInCache 0 · declared false ·
                                       version 3.6.0 ·
                                       installedAs "nunjucks@3.2.4 optional peer chokidar@^3.3.0"
verdict                             -> PASS   (checks 109/109; 0 notice(s), 0 allowed)
```

`watchRequested 1` alongside `watchApplied 0` is the pair that keeps this entry honest: the
application **asked** for a watcher — which is exactly the reliance recorded above, unchanged and
still true of the application — and the harness declined to apply it before the first application
require. So there is no open handle for a gate to fail on, and equally nothing has been repaired in
`lib/util/nunjucks.js`: the reliance is recorded, not removed. The artifact's `declared false` is the
**root** declaration and says the same thing as the metadata block above, which is why `installedAs`
names the provider alongside it: the root does not declare `chokidar`, nunjucks does, optionally, and
the lockfile pins the 3.6.0 that satisfies it.

### 10.4 `files.setThumbnail` authenticates against an empty committed secret

**Measured** (static, both trees). The thumbnail callback is guarded by a single comparison against a
configuration value that committed configuration ships **empty**:

```javascript
// [B lib/controllers/files.js:109]  ·  [T lib/controllers/files.js:409-411]
    if (request.payload.secret !== config.aws.lambda.createThumbnail.secret) {
      return request.fail();
    }
```

```yaml
# [B config/default.yaml:419-421]  ·  unchanged on the target tree
  lambda:
    createThumbnail:
      secret: ''
```

Four facts compose into the outcome, and all four are identical on both trees:

| Fact | Value | Address |
|---|---|---|
| Route | `POST /api/files/{fileId}/thumbnail` -> `files.setThumbnail` | `[B config/api_routes.js:1300]` |
| Declared auth | **none** — so it inherits the server default `mode: 'try'` and answers anonymously | `[B config/api_routes.js:1301-1309]`, `[B app.js:287]` |
| Committed secret | `''` | `[B config/default.yaml:421]` |
| Payload validation | `bucket` and `secret` both `Joi.string().required()`, enforced by the hand-rolled block | `[B config/api_routes.js:1303-1308]`, `[T lib/util/routeParser.js:503-510]` |

**Measured, and the measurement narrows the finding: while the configured secret is empty the
handler's MUTATING branch is unreachable, so the empty secret fails CLOSED rather than open.** Driven
against the delivered tree with a seeded `File` document and no `aws.lambda.createThumbnail.secret`
configured:

```text
POST /api/files/<id>/thumbnail  bucket=snapshots  secret=          -> 200 {"bucket":"snapshots","secret":"",
                                    "flash":{"validation":{"secret":"\"secret\" is not allowed to be empty"}}}
POST /api/files/<id>/thumbnail  bucket=snapshots  (secret omitted) -> 200 {"bucket":"snapshots",
                                    "flash":{"validation":{"secret":"\"secret\" is required"}}}
POST /api/files/<id>/thumbnail  bucket=snapshots  secret=wrong     -> 200 {"flash":{}}      <- request.fail()
File document after all three                                      -> thumb = undefined     <- never mutated
```

**Three outcomes, and they must not be collapsed into one.** The route answers a
`POST /api/files/{fileId}/thumbnail` in exactly one of three ways, and only the third mutates anything:

| # | Input | Where it is decided | Outcome |
|---|---|---|---|
| 1 | `secret` empty, or absent | the hand-rolled validation block, **before** the handler `[T lib/util/routeParser.js:503-510]` | `request.fail(payload, ...)` carrying a `validation` flash. `setThumbnail` never runs. |
| 2 | `secret` non-empty and ≠ the configured value | **inside** the handler, at `[T lib/controllers/files.js:409-411]` | the handler runs to its own `return request.fail()` and **completes**. Nothing is written. |
| 3 | `secret` non-empty and **=** the configured value | the same comparison, taken the other way | the mutating branch runs: `thumb` is built from the caller's bucket and the document is saved. |

The mechanism that closes the exposure is a composition neither half states on its own. `Joi.string()`
rejects the empty string by default — verified on the delivered joi 18.2.5: `"secret" is not allowed to
be empty` — so every payload that survives validation carries a **non-empty** `secret`, and a non-empty
string can never equal `''`. **Outcome 3 is therefore unreachable while the configured secret is
empty**, and outcome 2 is what a caller gets instead. Outcome 2 does reach and complete the handler,
which is why the claim here is about the mutating branch and not about the handler as a whole. The
seeded document's `thumb` was `undefined` after all three probes.

**What is therefore true, and what is not.** The credential in committed configuration **is** empty
(**CWE-798**) and the route declares no authentication of its own (**CWE-306**) — the shared secret in
the request body is the whole of it. But the consequence usually drawn from those two — that an
anonymous caller can send `secret: ''` and mutate a thumbnail — **does not follow on this codebase**,
and the probe above is why. The residual exposure is a *latent* one: it opens only when a deployment
sets `aws.lambda.createThumbnail.secret` to a value an attacker can guess, and it is then a
non-rotating shared secret compared with `!==` (not constant-time) and sent in a form body. The
caller-chosen bucket becomes reachable at the same moment and not before.

**The caller-chosen bucket is narrower than it looks, and that is measured rather than assumed.**
`config.aws.buckets[bucket].thumbnailHost` `[T lib/controllers/files.js:423]` reaches only
buckets that exist in configuration **and** declare a `thumbnail` string. Anything else — an unknown
name, or an inherited `Object.prototype` key such as `__proto__` or `constructor`, for which the member
access yields an object with no `thumbnail` — throws a `TypeError` that the route wrapper's catch-all
maps onto a 500. The exposure is therefore *selection among configured thumbnail buckets*, not
arbitrary lookup.

**Target disposition: preserved exactly, and NOT repaired here.** Every element of it is byte-identical
to `2f8712a` — verified by `git show 2f8712a` on all three files — so this is baseline behaviour and
not migration drift, and R-d's prohibition attaches to it. Three AAP provisions each independently
forbid the repair in this delivery, and they are cited rather than summarised because declining a
security finding is only defensible with the citation:

1. **The AAP's own directive for this file names these exact lines as preserve-exactly**, twice: *"`:110`
   `return request.fail();` when the payload secret mismatches; keep it"*, and *"Note `:118` will throw
   if `request.payload.bucket` names an unconfigured bucket — **preserve that (do not add a guard)**"*.
   Its R-d ruling repeats it: *"everything except `:98-100` is preserved exactly — … the unguarded
   bucket lookup at `:118`"*.
2. **AAP §0.7 closes the deviation register at exactly two**, and §11.0 above makes an unapproved
   entry drift rather than a deviation. Each of the three controls the finding asks for is a behaviour
   change argued in the delivery rather than in the plan, and the table above says which outcome each
   one moves. A startup assertion changes whether the **process boots** on a configuration that boots
   today. A dedicated authenticated callback scheme changes **outcome 1 and outcome 2** — the status,
   body and flash a caller receives — and the route's effective auth, which §0.9.1 compares per entry.
   A timing-safe comparison changes no outcome at all, which is exactly why it is not a repair: it
   would be an unrequested edit to a line the directive above names preserve-exactly, for no
   observable benefit while outcome 3 stays unreachable. Note what is **not** an argument here: failing
   closed on the empty default would move nothing, because the empty default already fails closed —
   the case for preservation rests on the directive and on the root cause's location, not on a
   behaviour change that does not exist.
3. **The root cause is not in this file.** It is the empty placeholder at `[B config/default.yaml:421]`,
   which AAP §0.2.2 keeps unchanged because those values are deployment-specific, and the absent `auth`
   on the route at `[B config/api_routes.js:1301]`, which AAP §0.9.1 compares per entry against the
   baseline manifest. §0.6.7 sets the precedent for exactly this shape of gap — the missing
   `aws.buckets.exports` entry — recording it as *"an existing deployment requirement"* rather than
   fixing committed configuration.

**Deployment requirement, stated as the thing an operator must do.** Set
`aws.lambda.createThumbnail.secret` to a **high-entropy** value in `config/local.yaml` or the runtime
environment. The measurement above means the empty default is safe-by-accident rather than open, so the
requirement is not "set it or be exposed" but its inverse: **the moment it is set, it becomes the only
control on the route**, and a weak or shared value is what opens it. Setting it to a guessable string
is worse than leaving it empty.

**What closing it properly requires**, so the follow-up is actionable rather than a note: assert a
non-empty `aws.lambda.createThumbnail.secret` at startup beside the existing session-password guard
`[T app.js:49-66]` and fail fast in production exactly as that guard does; compare the payload secret
with `crypto.timingSafeEqual` over equal-length buffers; and give the route its own credential rather
than `mode: 'try'` in `[B config/api_routes.js:1301]`. All three sit in files outside this change and
each moves the route manifest or an observable response, so each needs its own approval against R-d
and its own manifest re-baseline.

**Gate.** Route-manifest equality, which records the route as
`auth {declared: null, inherited: true, strategy: 'session', mode: 'try'}` identically on both trees,
and corpus scenario `route.post.api-files-fileId-thumbnail.json`, which posts anonymously with
`secret: 'parity-absent-lambda-secret'` against a configuration that sets no secret and records the
baseline as `request.fail()`'s 200 `{"flash":[]}` — `bodyLength: 12`. **That scenario drives the
handler's own mismatch branch; the `secret: ''` input is driven by no committed scenario**, which is
why the reachability result above was measured directly against the delivered tree rather than read off
the corpus. Both agree, and on the precise claim: the scenario's recorded 200 `{"flash":[]}` **is**
outcome 2 — the handler running to its own `request.fail()` — and outcome 3, the only branch that
writes, is reached by neither.

### 10.5 A stored file is downloadable by anyone who knows its id or its content hash

**Measured** (static, both trees). The download route carries a lookup pre-handler and no
authorization of any kind:

```javascript
// [B config/routes.js:202-206]  ·  unchanged on the target tree
  {
    route  : 'GET /api/files/{fileId}/{fileName} files.download',
    config : {
      pre : ['file(params.fileId)']
    }
  },
```

`files.download` `[T lib/controllers/files.js:349-407]` reads `request.pre.file` and streams the
object. It consults neither the requesting identity nor the file's owner, and neither does the route:
with no declared `auth` the route inherits `mode: 'try'`, so an anonymous request is served. The
`File` model carries the `ownable` plugin, so an owner **is** recorded — it is simply never consulted
on this path. **CWE-862** (missing authorization).

**Two identifiers reach the same object, which widens the surface.** `alternateIds: ['hash']`
`[T lib/models/file.js:41]` makes the generated `findById` match on `hash` as well as `_id`
`[T lib/models/model.js:119-128]`, and `hash` is the **sha1 of the file's contents**
`[T lib/util/file.js:65-68]`. So knowing either the document id or the content digest is sufficient to
retrieve the bytes.

**Target disposition: preserved exactly, and NOT repaired here.** Byte-identical to `2f8712a`
(`git show 2f8712a:config/routes.js` lines 202-206), so this is baseline behaviour. Beyond R-d, the
suggested repair would **remove a shipped capability**, which is the decisive point:

- `files.upload` returns `path: '/api/files/' + file.id + '/' + <slug>` `[T lib/controllers/files.js:334-341]`
  as the client-visible location of the upload;
- unchanged material-editor code inserts that path into authored Markdown, and the rendered course
  page serves it to **every** reader of the course, not to the uploader;
- so requiring owner authorization would break every embedded image and every material link for every
  student — a functional regression, not a hardening. AAP §0.2.2 puts *"New or removed routes and
  features"* out of scope and makes the route surface an invariant; §0.9.1 compares effective auth per
  entry and §0.9.3 compares responses, so the change would fail two gates as well as R-d.
- AAP §0.4.1 authorizes exactly **one** change to `config/routes.js` — the `js-yaml` call site — and
  the route declaration is where the control belongs.

Dropping `alternateIds: ['hash']` is not an alternative: it would make hash-form URLs 404, which is
itself an observable change, in a model this delivery leaves unchanged.

**What closing it properly requires.** Distinguish public material from private material at the model
or the route, then either gate the route on owner-or-containing-resource membership or issue
short-lived signed URLs for private objects and keep an unauthenticated path for public ones. That is a
feature with its own data model, migration and client changes — it is what AAP §0.2.2 excludes, and it
needs its own approval, not a line in this migration.

**This is the same route and the same missing control as the exposure recorded at the end of
[§11.1](#111-deviation-1-the-never-settling-file-response)** — a legacy document whose `type` and
`mime` disagree being served inline as active content. Both are properties of one anonymous,
unauthorized download path, and both are closed by the same piece of work.

**Gate.** Route-manifest equality records the route as
`auth {declared: null, inherited: true, strategy: 'session', mode: 'try'}` with
`pre: ['file(params.fileId)']`, identically on both trees; corpus scenarios
`quirk.reply-chain.header-resolved.file-download-attachment` and
`quirk.reply-chain.never-settles.image-download` drive it, both as a **seeded, non-owning identity** —
which is the measurement, since they are served.

### 10.6 Serving the approved image response serves script-capable legacy content inline

**This entry exists because closing an unapproved change opened a boundary, and the boundary must be
visible as an open item rather than as a clause inside the deviation it follows from.** It was
previously a paragraph at the end of [§11.1](#111-deviation-1-the-never-settling-file-response); that
made an unresolved security exposure read as a footnote to a resolved deviation, which is the same
mistake [§11.3](#113-what-is-not-a-deviation-and-why-the-register-is-closed) corrects in the other
direction. It is numbered here, with §11.1 pointing at it.

**Measured** (Hapi 21 injection against the delivered tree, with a seeded `File` document carrying
`type: 'image/png'`, `mime: 'text/html'` and HTML bytes):

```text
GET /api/files/<id>/<name>   ->  200
                                 content-type            text/html; charset=utf-8
                                 content-length          <the document's own size>
                                 content-disposition     absent
                                 x-content-type-options  absent
                                 content-security-policy absent
                                 body                    the stored bytes, unchanged
```

**The mechanism is that two independent fields decide two different things.** The branch is selected on
`file.type` `[T lib/controllers/files.js:369]` but the response is typed from `file.mime`
`[T lib/controllers/files.js:396]`. `lib/models/file.js` constrains `type` to the enum
`['embed','download']` and puts **no** validation on `mime` `[T lib/models/file.js:6-9]`, so the branch
is entered only by legacy documents whose `type` carries a mime-like string — and for exactly those
documents the two fields are unrelated. The route inherits `mode: 'try'`
`[B config/routes.js:202-206]`, `[T app.js:361]`, and no application-wide CSP or `nosniff` policy
compensates: the only `X-Frame-Options` is scoped to five paths `[B config/default.yaml:353-358]`.
So such a record executes active content on the application origin. **CWE-79** via stored content.

**It is distinct from [§10.5](#105-a-stored-file-is-downloadable-by-anyone-who-knows-its-id-or-its-content-hash),
and authorization would not close it.** §10.5 is about *who* may fetch the bytes; this is about what the
bytes are permitted to *do* once fetched. An authorized course reader — the identity §10.5 would still
admit — can execute same-origin content, so the two need separate remedies.

**Why there is no source-local fix, stated as the constraint rather than as a preference.** The direct
response **is** the AAP-approved deviation, field for field
([§11.0](#110-the-register-is-closed-and-this-is-the-machine-readable-form-of-that)). A classifier,
a `nosniff` header, a CSP header or an attachment fallback added here is precisely the extension that
was removed from this branch, and re-adding any of it re-opens the four findings that required its
removal. There is no version of this repair that is both effective and inside the closed register, so
it cannot be decided in a source file at all.

**What closing it requires — an explicit security decision, with two viable shapes.** Either serve
user-controlled files from a **separate, cookieless content origin** (or signed storage URLs on a
storage origin), so stored bytes never execute in the application's origin regardless of their declared
type; or **approve a validation rule** that forces script-capable and metadata-mismatched legacy
records to an attachment disposition, which is a deliberate behaviour change to a client-visible
response and needs its own R-d precedence argument. Either way the closed deviation register in §11.0,
the `quirk.reply-chain.never-settles.image-download` corpus scenario and the five-field contract must
be updated **together**, because all three currently encode the response as it stands.

**Reach.** Bounded by the legacy records that exist: only documents whose `type` is a mime-like string
enter this branch at all, and only those whose `mime` is script-capable are dangerous. A census of
`File` documents whose `type` is outside `['embed','download']` is the first step of any remediation,
and no such census is part of this migration.

**Gate.** None closes it. The route-manifest and corpus gates both record the response as approved, so
this exposure passes every gate this migration defines — which is why it is written down here.

---


### 10.7 The `zipCode` branch that took the process down, and the bounds that now hold it

The one entry in this catalogue whose outcome is deliberately **not** preserved without being one of the
two numbered deviations in [§11](#11-the-two-approved-deviations). It is stated field by field for that
reason. The security decision is **made** — it is in the second half of this section, with its
precedence argument — and what the closing paragraph defers is only the register bookkeeping that
[§11.0](#110-the-register-is-closed-and-this-is-the-machine-readable-form-of-that) shares with three
other artifacts.

**The sites.** `trinket.draft` `[T lib/controllers/trinket.js:1209]`, baseline
`[B lib/controllers/trinket.js:986]`, and `trinket.autosave` `[T lib/controllers/trinket.js:1307]`,
baseline `[B lib/controllers/trinket.js:1054]`. Both are authenticated, both accept a base64 ZIP in
`request.payload.zipCode`, and both declare `payload.maxBytes` of 10 MB
`[B config/api_routes.js:977-979,1004-1006]`.

**Measured, defect one — the expansion was unbounded** (probe, on the delivered tree). Neither handler
consulted any size before calling `content.file("zipCode").async("string")`. JSZip 3.6.0 populates
`file(name)._data.uncompressedSize` and `._data.compressedSize` during `loadAsync` **without
decompressing**, and the numbers show the exposure: a **432-byte** base64 payload declares **200 000**
bytes uncompressed, a ratio of ~940:1, so a payload inside the declared 10 MB cap could be made to
expand into gigabytes on an authenticated request.

**Measured, defect one-a — and why a bound built on those declared numbers does not hold.** Recorded
because a first implementation of this fix consulted only the central directory and was defeated. The
declared sizes are **attacker-controlled**: JSZip 3.6.0 compares declared against actual only *after* it
has expanded the entry `[node_modules/jszip/lib/compressedObject.js:27-40]`. Probe: an archive holding
4 MiB of deflated text, with the uncompressed-size field rewritten to **1** in the local header (offset
22 past signature `0x04034b50`), the central directory (offset 24 past `0x02014b50`) and the data
descriptor (offset 12 past `0x08074b50`), reports a one-byte total after `loadAsync` — so a
metadata-only guard admits it — and `async('string')` then grew the heap **+4.08 MiB** before rejecting
with `Bug : uncompressed data size mismatch`. The expansion had already happened. **A declared size is
therefore only ever grounds for rejection, never for admission**, and the bound that holds has to count
bytes as they are emitted.

**Measured, defect two — malformed input terminated the server process** (probe). The chain is
deliberately detached and its first link's `onRejected` both answers the request and returns the answer
into the chain, reproducing what `request.success` and `reply(err)` did under the shim. The next link's
`onFulfilled` then runs `JSON.parse` on that value — `JSON.parse("[object Object]")` in `draft`, and the
same on a Boom in `autosave` — which throws in a chain that had **no downstream rejection handler**.
Under Node 22's default `--unhandled-rejections=throw` that unhandled rejection ended the process: one
malformed `zipCode` from any logged-in user took the whole server down, after that request had already
been answered.

**Target disposition, and R-b is why it is not preservation.** Three changes, all in
`[T lib/controllers/trinket.js]`, and the first two are a deliberate two-layer bound.

*Layer one, an early rejection that reads only metadata and can never admit.*
`assertZipCodeWithinBounds(content)` `[T lib/controllers/trinket.js:98]`, called as the **first
statement** of each first link's `onFulfilled` (`[T lib/controllers/trinket.js:1246]` and
`[T lib/controllers/trinket.js:1341]`). It refuses an entry count above `ZIP_MAX_ENTRIES`, a declared
total above `ZIP_MAX_TOTAL_UNCOMPRESSED_BYTES`, and a declared expansion above
`ZIP_MAX_EXPANSION_RATIO`, throwing a plain `Error` before anything is expanded. Every one of those is a
*rejection* built from numbers the archive asserts about itself, so understating them cannot buy
admission — it only moves the rejection to layer two. It earns its place by cost: an archive that admits
its own amplification is refused at **zero** emitted bytes. Probe, the 650:1 case: caught here at heap
**+0.02 MiB**, against **+2.3 MiB** when layer two had to catch it.

*Layer two, the bound that holds against a forged central directory.*
`readZipCodeWithinBounds(entry, compressedBytes)` `[T lib/controllers/trinket.js:150]`, called
immediately after (`[T lib/controllers/trinket.js:1248]` and `[T lib/controllers/trinket.js:1343]`),
replaces `async('string')` — which no longer appears in the file. It reads the entry through
`entry.internalStream('string')`, the same path `async` itself takes (`async` *is*
`internalStream(type).accumulate()`, so the decoding is unchanged), counts the bytes each chunk actually
**emits**, and the moment the running total passes its cap it calls `stream.pause()` and **rejects**.
Nothing in it reads a declared size. Overshoot is bounded by one chunk, JSZip's 16 KiB read unit. The
cap is `Math.min(ZIP_MAX_TOTAL_UNCOMPRESSED_BYTES, compressedBytes × ZIP_MAX_EXPANSION_RATIO)`, where
`compressedBytes` comes from `base64ByteLength(request.payload.zipCode)`
`[T lib/controllers/trinket.js:205-207]`, called at `[T lib/controllers/trinket.js:1249]` and
`[T lib/controllers/trinket.js:1344]` — the size of what the client actually put on the wire, never a
number the archive declares about itself — so a small payload cannot amplify even while staying under
the absolute limit. It rejects rather than throwing, which is what puts its value on the same path as
every other failure here.

*Layer three, the process fix.* A **terminal `.catch`** on each detached chain
(`[T lib/controllers/trinket.js:1271-1277]` and `[T lib/controllers/trinket.js:1365-1371]`) carrying
that branch's own disposition.

The bounds are `ZIP_MAX_ENTRIES` 16, `ZIP_MAX_TOTAL_UNCOMPRESSED_BYTES` 32 MiB and
`ZIP_MAX_EXPANSION_RATIO` 512 `[T lib/controllers/trinket.js:77-79]`. 32 MiB is deliberately more than
three times the route's own 10 MB payload cap, so the ZIP path stays strictly more permissive than the
plain `code` path it exists to compress; and 512:1 sits two orders of magnitude above what real content
does — probe, realistic multi-file trinket source: **4.3:1** at 8 KB, **6.2:1** at 250 KB, **6.3:1** at
2.5 MB, all accepted. The bound discriminates amplification, not size.

**One measured decoding case that is neither bounded nor changed.** Rewriting the declared size to **0**
rather than to 1 makes JSZip emit *nothing*, so the entry reads as `''`. Probe: byte-identical between
the baseline `async('string')` path and the delivered streamed read, and `JSON.parse('')` throws onto
the same disposition as any other unusable input. No expansion occurs, so there is nothing for a bound
to do; it is recorded here only so the empty read is not later mistaken for the cap misfiring.

The precedence argument is AAP §0.7's, applied to a stronger case than the one it was written for. R-b
is unqualified — the application must genuinely run, with no route or module excluded — and §11.1
decided the comparable conflict on the ground that the absence of a response is not a behaviour a client
can depend on. A process death is that argument at its strongest: the client has **already** received
its response when the process dies, so what the crash destroys is not this branch's behaviour but every
other route's. R-d's protection does not reach it.

**What that costs, field by field, measured rather than asserted.**

| Input | Baseline | Delivered | Changed? |
|---|---|---|---|
| No `zipCode` (the ordinary path) | `draft` 200, `autosave` 200/500 per its own chain | identical | no |
| A legitimate `zipCode` inside the bounds | 200, draft/trinket updated | identical — probe: `{"disposition":"request.success","data":{"success":true}}` | no |
| A malformed `zipCode` | `draft` **200**, `autosave` **500**, then the process died | `draft` **200**, `autosave` **500**, process alive | **the response is byte-identical**; only the death is gone |
| A crafted bomb (measured: 87 KB base64 declaring 64 MiB) | expansion attempted; no dependable response | `draft` **200**, `autosave` **500** — the branch's own malformed-input disposition, refused by layer one with nothing read | the response is one baseline already emits for input it cannot use; no new status code exists anywhere in the file |
| A **forged** archive understating itself (measured: 22 KB base64 declaring 1 byte, holding 16 MiB) | full expansion, then a JSZip mismatch error | `draft` **200**, `autosave` **500**, the read aborted by layer two after emitting **50%** of what the archive held | the response is the same disposition as any unusable input; what changes is that the expansion stops |
| A **valid** archive expanding beyond the cap | 200, and the code stored | `draft` 200 **without storing**, `autosave` 500 | **yes — this is the one input class whose observable outcome changes**, and it is stated here so it is not discovered later |

The response-identity of rows three to five is structural, not incidental, and it holds for two
independent reasons. A promise's first settlement wins, so the terminal `.catch` is a no-op whenever the
request has already been answered; and both bounds surface where the **existing** second-link
`onRejected` already answers — `request.success()` in `draft`, `legacyReply(err, h)` in `autosave` —
so no new status code was introduced anywhere in the file. The chains are still neither returned nor
awaited: returning them would make `draft`'s malformed branch answer 500 instead of 200, which is
exactly the change R-d forbids.

**A stronger statement is available on this route, and it is worth recording because it makes the parity
exact rather than argued.** A bound rejection is *indistinguishable on the wire* from the failure this
branch already had. `code` is declared `{type: String}`, so a legitimate `zipCode` — whose payload is a
JSON **array** — cast-fails in Mongoose and lands on the very same `onRejected`. Live probe, all four
inputs through both handlers: malformed, honest bomb, forged metadata and legitimate content each
answered `draft` **200** with body `{"flash":{},"context":null}` and `autosave` **500** with the generic
Boom message. Sixteen responses, two distinct values, none of them new. Whatever the bound refuses, it
refuses into a response the route was already emitting.

**Gate.** Live probe, recorded because no committed scenario reaches either branch. On a running server:
malformed `zipCode`, the 64 MiB honest bomb and the 16 MiB forged archive each answered `draft` **200**
and `autosave` **500**, with **zero** unhandled-rejection lines in the server log, the process still
answering `GET /` with 200, and no leftover temporary directory. At the unit level, the two bounds were
exercised over nineteen cases: layer one accepts 5:1, 4:1, 32 MiB exactly, 16 entries and absent
declared sizes, and rejects 943:1, 32 MiB + 1 byte, 17 entries and 513:1; layer two stops both forged
archives at ~50% of what they held, refuses the 650:1 token bomb, reads the declared-zero archive as the
empty string described above, and accepts realistic trinket source at 8 KB, 250 KB and 2.5 MB with the
JSON round-trip intact. **The corpus carries no `zipCode` scenario at all** (probe, over
`test/parity/corpus.json`: zero scenarios mention the key), so the branch-specific cases belong in the
builder in `test/parity/capture.js` followed by a re-capture — one malformed-input case per handler
asserting the two statuses above, and one bomb case asserting the same two, which together pin every row
of the table.

**The security decision, made.** Unbounded decompression and process termination on an authenticated
route are **fixed**, not preserved, and R-b is the requirement that decides it. R-b is unqualified — the
application must genuinely run, with no route or module excluded — and
[§11.1](#111-deviation-1-the-never-settling-file-response) decided the one comparable conflict in
`lib/controllers` on the ground that the absence of a response is not a behaviour a client can depend
on. A process death is that argument at its strongest: the client has **already** received its response
when the process dies, so what the crash destroys is not this branch's behaviour but every other
route's, and R-d's protection does not reach it. The bound is the same decision applied to the same
route: an expansion that exhausts the heap ends every other request in flight. Nothing about this is
open, and no future reader needs to re-derive it — the delivered code, its two layers and the nineteen
measured cases above are the decision in force.

**What remains open is bookkeeping, not the decision.** By §11.3's own test — an approved deviation is a
prohibition argued away by a stronger requirement, whereas a shortfall is an unmet target — the *valid
archive beyond the cap* row is a prohibition argued away, which makes it a candidate for the numbered
register. It is deliberately **not** minted here, for a mechanical reason: §11.0's count is a claim
shared by [`baseline-parity.md`](baseline-parity.md), by
[`deferred-dependencies.md`](deferred-dependencies.md) §4.2 and by the allowlist rule that
`test/parity/replay.js` implements, so a third row added in this document alone would leave four
artifacts disagreeing about the size of the register — the precise failure §11.0 exists to prevent.
Those artifacts are owned elsewhere in this delivery, so the count is theirs to move, together, in one
change. What is true today and needs no coordination: the delivered code has **no replay-visible
difference** for this branch — no scenario drives it, and the responses are byte-identical as the table
and the sixteen-response probe above establish — so the allowlist rule, exactly one scenario id, is
untouched and correct as written.

### 10.8 The search-response seam: the client reads a key the server does not send

**Measured** (static, plus artifact). `trinket.search` `[T lib/controllers/trinket.js:1478]`, baseline
`[B lib/controllers/trinket.js:1163]`, answers `request.success({ data : results })`. Its only consumer
in this repository is a raw `$http` call, and that consumer iterates a different key:

```javascript
// [B public/js/courseEditor/controllers/toolbarControl.js:34-41]
      return self.$http.get('/api/trinkets/search', { params : { q : val } })
        .then(function(results) {
          …
          angular.forEach(results.data.results, function(trinket) {
```

`results.data` is the response body, so `results.data.results` is `undefined` where the array is at
`results.data.data`. **Consequence, recorded because it is invisible in operation:**
`angular.forEach(undefined, …)` is a no-op, so the course-editor trinket typeahead lists nothing and
reports no error. No status, header or body is affected — the mismatch is entirely in what the client
does with a body that is exactly what it has always been.

The response is pinned by the corpus, which is how the shape is known rather than inferred: scenario
`route.get.api-trinkets-search.json` records **200**, `application/json; charset=utf-8`, body length
**1305**, sha256 `27e4b051…`, body text beginning `{"data":[`.

**Target disposition: preserved on both sides, and deliberately not aligned.** The handler is
byte-equivalent to base commit `2f8712a` apart from `reply(err)` becoming `legacyReply(err, h)`, so this
is a 2013-era defect rather than migration drift, and R-d preserves it. Neither side can move within
this migration's boundaries, and the two reasons are independent: adding or renaming a key changes a
response the corpus pins by digest, and `public/js/**` is unchanged by AAP §0.2.2, which the delivered
tree honours. The site carries a comment recording all of this so the next reader does not "tidy" one
half of a two-sided contract.

**Gate.** The corpus scenario above: any change to this route's body length or digest is reported as an
unapproved difference, in either direction. Aligning the two keys is a product decision about the
course-editor typeahead, and it belongs with whoever takes that decision rather than with this
migration.

### 10.9 What `archiver` normalises in an entry name, and what it passes through

Recorded here because it is the measurement a security control in
`[T lib/controllers/trinket.js]` was built against, and because the control has to keep matching it: a
future reader who cannot see this table cannot tell which rows of `archiveEntryName`
`[T lib/controllers/trinket.js:268]` are *reproducing* library behaviour and which are *adding*
containment. Both matter — the first keeps a legitimate archive byte-identical, the second is the fix.

The trinket controller builds archives from names the caller supplies, unauthenticated in
`downloadPostedZip` `[T lib/controllers/trinket.js:1629]`, and hands them to `archive.append`. Measured
by building real archives through the **installed** archiver — **7.0.1** in the delivered tree — and
reading the entry names back with the installed `adm-zip` 0.6.0. The table was first measured on the
baseline's `archiver` 2.1.1 and **re-measured on 7.0.1 after the version move** (§9.5 of
[`dependency-inventory.md`](dependency-inventory.md)): **every row is identical on both**, including
the empty-name fault, so nothing in the control below depends on which of the two is installed:

| Input name | archiver emits | Class |
|---|---|---|
| `main.py` | `main.py` | identity |
| `a//b.py` | `a/b.py` | normalised — repeated separators collapsed |
| `/etc/passwd` | `etc/passwd` | normalised — leading separators stripped |
| `//srv/a.py` | `srv/a.py` | normalised |
| `C:\win\x.py` | `win/x.py` | normalised — drive stripped, backslash → slash |
| `back\slash.py` | `back/slash.py` | normalised |
| `foo/../../evil.py` | `foo/../../evil.py` | **passed through verbatim — the traversal** |
| `x/./../y.py` | `x/./../y.py` | **passed through verbatim** |
| `..`, `x/..` | unchanged | **passed through verbatim** |
| `a\0b.py` | `a\0b.py` | **passed through — NUL survives** |
| `a\tb.py` | `a\tb.py` | **passed through — control characters survive** |
| `./a.py`, `dir/./x.py`, `.hidden`, `a b/c.py`, `é.py` | unchanged | identity |
| `` (empty) | an `'error'` **event** carrying `entry name must be a non-empty string value` — emitted at `[node_modules/archiver/lib/core.js:567]` on the installed 7.0.1, with the message text at `[node_modules/archiver/lib/error.js:15]`; the same event at `[node_modules/archiver/lib/core.js:561-563]` on 2.1.1 — not a synchronous throw | fault |

Three consequences the control is shaped by. **The `..` and `.` rows are the vulnerability** — archiver
does not resolve them, so an attacker-chosen name reaches the archive as a relative path that escapes
its root when extracted. **The empty row decides the fallback**: that error event turns
`downloadPostedZip` into a 500 via its `archive.on('error', reject)`, and in `downloadZip` the listener
is registered on the misspelled `'err'` `[T lib/controllers/trinket.js:2074]` so it reaches no handler
at all — which is why a canonicalised name must never come out empty and falls back to the fixed
`ARCHIVE_FALLBACK_ENTRY_NAME` `[T lib/controllers/trinket.js:244]`, a constant rather than anything
random or time-derived so an archive built from the same input stays reproducible. **And none of the
containment is delegated to the library**, which is what makes the control survive the version move:
`package.json` declares `archiver ^7.0.1` and **7.0.1** is what resolves (`zip-stream` 6.0.1,
`compress-commons` 6.0.2), where the baseline declared `^2.0.0` and resolved 2.1.1 — and an interim
delivery declared `^6.0.2`. A control resting on the library's own normalisation would have moved with
each of those; `archiveEntryName` instead reproduces every "normalised" row byte for byte, resolves
the passed-through rows away, and strips control characters, so the only thing the version change
required of this section was re-measuring the table above and finding it unchanged.

**Disposition, and what it costs.** A hostile name is canonicalised and its entry is **kept**, never
rejected, so status, content-type and entry count are unaffected — measured live on
`POST /api/trinkets/download` with seven hostile keys: 200, `application/zip`, entries
`["evil.py","y.py","file","ab.py","file","main.py","win/x.py"]`, none escaping. One input class changes
observably and is recorded rather than left to be discovered: an **empty** entry name previously reached
archiver and produced a 500, and now stores the entry under the fallback name and returns 200. That is
strictly inside the class R-b governs for this route — the alternative is a route that faults on input
it was given — and it is the same reasoning as [§10.7](#107-the-zipcode-branch-that-took-the-process-down-and-the-bounds-that-now-hold-it).

**Gate.** Twenty-eight cases over the extracted canonicaliser: ten identity cases unchanged, eighteen
hostile cases contained — including `foo/../../evil.py` → `evil.py`, `x/./../y.py` → `y.py`,
`../../../../etc/shadow` → `etc/shadow`, `a\0/../../b.py` → `b.py`, and `..`, `.`, `''`, `null`,
`undefined` → the fallback — plus the live seven-key archive above. The same containment is needed on
the worker's archive path in `lib/workers/exports.js`, which is owned elsewhere in this delivery;
`archiveEntryName` delegates nothing to archiver, so it transfers unchanged.

### 10.10 The four `output:'file'` upload routes answer 415 to `multipart/form-data`

**Measured** (**static**, plus two probes). Every upload route in the application declares
`payload : { maxBytes, output : 'file' }` and **no `multipart` key**:

| Route | Binding | Payload declaration |
|---|---|---|
| `POST /file` | `files.upload` | `[B config/routes.js:336-351]` — `maxBytes: 1048576 * 10`, `output : 'file'` |
| `POST /file/avatar` | `files.uploadAvatar` | `[B config/routes.js:352-370]` — `maxBytes: 1048576 * 5`, `output: 'file'` |
| `POST /api/users/assets` | `users.assetUpload` | `[B config/api_routes.js:1238-1252]` — `maxBytes: 1048576 * 5`, `output : 'file'` |
| `POST /api/users/assets/{fileId}` | `users.replaceAsset` | `[B config/api_routes.js:1253-1268]` — `maxBytes: 1048576 * 5`, `output : 'file'` |

Without `payload.multipart`, hapi does not accept a multipart body at all: it refuses the media type
before the handler exists. Driven as an authenticated session against a running server on this tree,
with a real `multipart/form-data` body carrying a file part, **all four answer 415 Unsupported Media
Type** (**probe**). The handlers behind them — which read `request.payload.upload` and
`request.payload.file` — are therefore not reached by a multipart client on either tree.

**This is baseline behaviour and not a framework-major change, which is the half worth measuring
rather than assuming.** The same declaration was driven on a real listener carrying nothing but the
repository's own payload block, once per hapi major, from that major's own installation (**probe**):

```text
hapi 20.3.0   payload{output:'file'}, multipart NOT set, multipart/form-data POST  ->  415
hapi 21.4.10  payload{output:'file'}, multipart NOT set, multipart/form-data POST  ->  415
```

So the migration neither introduced this nor could have removed it; a reader who finds the upload
routes unreachable by a browser form is looking at a 2013-era declaration, not at the framework bump.

**Target disposition: preserved.** Adding `multipart: true` would make four routes accept a body class
they refuse today, which is a behaviour change of exactly the kind R-d prohibits — and a *widening*
one, since it would newly admit a parser and a storage path to unauthenticated-shaped input on
`POST /file`. AAP §0.2.2 also holds the route declarations outside this migration's scope: the two
route files are edited only for the `yaml.load` call site and the inline pre-handler.

**What it means for the other gates, stated so it is not mistaken for a gap.** The corpus drives these
routes without a multipart body, so the 415 is what both trees record and the comparison is exact; and
the storage contract of AAP §0.6.7 — the sha1 content key, the suffix and extension branches, the
content-type override and the avatar gate — is proved by `test/parity/storage.js` against
`lib/util/file.js` directly, which is why the contract can be gated at all while the HTTP paths refuse
multipart.

### 10.11 `request.fail(err)` with an `Error` argument terminates the process

The harshest outcome in this catalogue, and the same `lib/models/model.js:147` bridge that
[§9.9](#99-two-routed-handlers-that-answer-200-carrying-the-name-of-a-missing-identifier) records is
what reaches it. It is a **baseline defect**, it is **not fixed**, and it is recorded here so that
anything driving these routes knows the process can disappear underneath it.

**The mechanism, in one line each.** `request.fail(json, err)` treats its first argument as a body:
`[T lib/util/routeParser.js:316]` calls `h.response(json)`, and hapi's toolkit refuses to wrap an
`Error` —
`Hoek.assert(result instanceof Error === false, 'Cannot wrap an error')`
[`node_modules/@hapi/hapi/lib/toolkit.js:191`]. The throw happens inside a database callback rather
than inside the handler's own frame, so no lifecycle catch is between it and the process:

| Tree | `request.fail`'s `h.response(json)` | The caller that passes an `Error` | Thrown |
|---|---|---|---|
| Baseline | `[B lib/util/routeParser.js:510]` | `[B lib/controllers/admin.js:160]`, `updateUser` — `if (err) return request.fail(err);` | `Error: Cannot wrap an error` |
| Delivered | `[T lib/util/routeParser.js:316]` | `[T lib/controllers/admin.js:265]`, `updateUser` — `if (err) return resolve(request.fail(err));` | `AssertError: Cannot wrap an error` |

Only the assert's constructor name differs between the hapi majors — measured directly:
`h.response(new Error())` reports `Error: Cannot wrap an error` on 20.3.0 and
`AssertError: Cannot wrap an error` on 21.4.10 (**probe**, one listener per major). Both are uncaught,
and both end the process.

**Measured, both halves, and the trigger needs no fault injection.** The route is
`POST /api/admin/user/{userId}` `[B config/api_routes.js:1389-1394]` (`auth: 'session'`,
`pre : ['isAdmin(user)']`), and it declares **no validation**, so a request with no payload reaches the
handler:

```text
TARGET  (probe) POST /api/admin/user/<an existing user id>, admin identity, no payload
  1. request.payload.roles          -> TypeError: Cannot read properties of null (reading 'roles')
                                       [T lib/controllers/admin.js:269], inside the findById callback
  2. lib/models/model.js:147        -> .catch(cb) re-invokes the SAME callback with that TypeError
  3. [T lib/controllers/admin.js:265] -> if (err) resolve(request.fail(err))
  4. [T lib/util/routeParser.js:316]  -> AssertError: Cannot wrap an error, uncaught
  observed: the connection is severed mid-request (curl exit 52) and the port stops answering; no
            process remains

BASELINE (artifact) test/parity/corpus.json scenario route.post.api-admin-user-userId.json, order 273
  identity admin, payloadEncoding "none"
  -> ok: false, "transport failure: socket hang up (ECONNRESET)"

BASELINE (probe, run evidence) a later baseline recapture over the same corpus died mid-run: it
  records "THE APPLICATION DIED while driving route.post.api-comments-trinketId.json (case 276 of
  392)", 115 cases undriven and 115 baselines pending, and the baseline server's own stderr shows
  Error: Cannot wrap an error at Toolkit.response <- request.fail (routeParser.js:510)
  <- admin.js:160
```

**Population.** Nine `request.fail(err)` sites can receive an `Error` on the delivered tree —
`lib/controllers/admin.js:213`, `:265`, `:272`, `:288`, `:337` and `lib/controllers/users.js:328`,
`:391`, `:724`, `:869` — against nine on the baseline (five in `admin.js`, four in `users.js`), so the
population is unchanged by the migration (**static**). §11.4 records one further instance of the same
defect on the asset-upload path, unreachable while `features.assets` ships `false`; this one is
reachable by any admin sending a payload-less POST, and by any of the nine whenever a model callback
yields an error.

**Target disposition: preserved, and deliberately not repaired.** Making `request.fail` map an `Error`
argument — to a Boom, or to the catch-all — would give these nine edges a status and a body they have
never produced, which R-e prohibits per edge and R-d prohibits as an improvement; and the funnel itself
is on T-2's preserved list. What is recorded instead is the operational consequence: a corpus, a smoke
run or a suite that drives one of these edges loses the server, so a harness must expect a transport
failure there and restart rather than read it as a route result. That is exactly what the committed
baseline corpus records at order 273.

**Gate.** `route.post.api-admin-user-userId.json` carries the recorded transport failure above and is
compared between the trees, so a build that answered this route normally would be reported as an
unapproved difference — including one that "fixed" it. The per-edge status belongs to
`docs/error-edge-inventory.md`, whose rows for these nine sites must read as **process-terminating
edges**, not as Layer 2 responses.

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

**Target.** The approved response is a **three-field** contract — the status, the file's own content
type and its byte count — and this is the delivered statement at that address, quoted as it stands
rather than as the contract abbreviates it:

```javascript
// [T lib/controllers/files.js:395-397]
      return h.response(stream)
        .type(request.pre.file.mime)
        .bytes(request.pre.file.size);
```

`Content-Disposition` stays omitted. The four header-resolved chains, including the sibling at
`[T lib/controllers/files.js:402-405]`, are unaffected and are preserved exactly (§4.2).

**The delivered source is that expression and nothing else, and it took a correction to get there.**
Recorded because the correction is the substance, and because a reader comparing this section against
an earlier revision of the tree will find the difference. An earlier delivery implemented the approved
response and then **extended** it with a second, unapproved behaviour change on the same branch:
a bounded read of the object's leading bytes (`peekHead`), a `SAFE_RASTER_SIGNATURES` allowlist and an
`inlineImageDisposition` classifier, `X-Content-Type-Options: nosniff` and a `Content-Security-Policy`
header on both outcomes, substitution of `application/octet-stream` for the file's own mime whenever
the declared type and the bytes disagreed, and a sanitized `Content-Disposition: attachment` header on
that outcome. **All of it has been removed** — 386 deleted lines, leaving the three-call expression
above — and the `inlineImageDisposition` export was removed with it, so the delivered module exports
exactly `uploadAvatar`, `upload`, `download`, `setThumbnail` and `legacyMimeExtension`.

**It was not a third deviation; it was drift.** The argument it carried in-source — that the response
did not exist at baseline, so nothing observable was being changed and the deviation's author was free
to decide what the new response contained — is the one thing [§11.0](#110-the-register-is-closed-and-this-is-the-machine-readable-form-of-that)
rules out: *"A deviation that a tool can declare for itself is not a deviation — it is drift with a
label"*, and a comment in a source file has no more authority to approve one than a tool does. Two of
the five approved fields were breached by it and two headers outside the contract were added: the
content type became `application/octet-stream` for a metadata mismatch rather than the file document's
own mime, `content-disposition` was **present** rather than absent, and `X-Content-Type-Options` and
`Content-Security-Policy` were emitted on every outcome. Status, byte length and the timeout-to-answered
outcome were the three it did keep. The register is closed at two, this is deviation 1, and deviation 1
is the three calls above.

**What that leaves unaddressed, stated rather than absorbed.** The extension was answering a real
exposure: `file.type` and `file.mime` are independent legacy fields with no validation between them
`[T lib/models/file.js:6-9]`, so a legacy document carrying `type: 'image/png'` with
`mime: 'text/html'` is served inline, as active content, on the application origin, from a route that
inherits `mode: 'try'` and is reachable anonymously. **Preserving the approved response preserves that
exposure, and it is an OPEN security item rather than a consequence of a closed decision** — so it has
its own entry, [§10.6](#106-serving-the-approved-image-response-serves-script-capable-legacy-content-inline),
carrying the measurement, why no source-local fix is available inside the closed register, and the two
shapes a real remedy can take. The same route's separate authorization gap is
[§10.5](#105-a-stored-file-is-downloadable-by-anyone-who-knows-its-id-or-its-content-hash); §10.6
explains why authorizing the route would not close §10.6.

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
(R-d) that was argued away by a stronger requirement, whereas each item below is or was a
**validation target** rather than a prohibition. §11.1 and §11.2 turn on exactly that difference — a
prohibition beats a target, which is what makes deviation 2 defensible — so re-using the word for an
unmet target inverts the argument it rests on.

**Two of the three have since stopped being unmet, and that is the point rather than a reason to drop
them.** Neither was closed by being called a deviation: one was closed by the declared dependency
graph moving, the other by the harness ceasing to create the handle. The rows stay so that the
classification, and how each was actually settled, remain readable.

| Item | What it is | Correct classification | Where it belongs |
|---|---|---|---|
| `[DEP0005]` `new Buffer()` from `compress-commons` 1.2.2, reached through the then-retained `archiver` 2.1.1 | A residual deprecation warning under `--pending-deprecation`, emitted once at module load | **Unresolved shortfall** against the zero-warning target of AAP §0.8 — it was discovered by measurement, not argued and approved in advance, and no decision was ever recorded against it. **No longer arises**: the declared graph moved to `archiver` 7.0.1 with `compress-commons` 6.0.2, and boot under `--pending-deprecation --trace-deprecation` emits no warning line at all | [`baseline-parity.md`](baseline-parity.md) §7.4 and §8, which already state this |
| `FSEventWrap` handles from the test-mode template watcher | An open-handle inventory that would prevent self-exit; unclosable by a caller, so it can only be prevented ([§10.3](#103-the-test-mode-template-watcher-runs-on-an-optional-peer-the-root-no-longer-declares)) | **Unresolved shortfall** against the clean-teardown expectation whenever it arises — unexpected, unallowed, failing, with a measured reason and a named remedy. It does not arise in the worker gate, which withholds the watch option before the first application require and measures an empty inventory; what remains recorded is the application's own test-mode reliance | §10.3 here, and the worker harness's handle inventory |
| This process's own stdout/stderr `PipeWrap` handles | Not a leak and not an application observation — which of them exist depends only on how the process was invoked | **Invocation plumbing.** Correctly partitioned out of the assertion; it was never a deviation and stays classified as it is | The harness's `stdio` partition |

**So a gate must fail on the first two rather than allow them, and it now does.** An allowance table
that records an attribution and a decision is good discipline for something that *was* approved;
applied to something that was not, it converts an open finding into a closed one and the finding stops
being visible. The worker harness's `WARNING_ALLOWANCES` is therefore **empty** and its
`HANDLE_ALLOWANCES` holds **only** the `stdio` partition, so the DEP0005 block classifies as
unexpected and a watcher handle classifies as unexpected — neither is absorbed by an allowance, and
each fails its check whenever it arises — while the run still terminates with its own exit code rather
than hanging. For the watcher handles the harness goes one step further and stops the condition
arising at all, by withholding the watch option rather than by allowing the result; that is a
prevention, not an exception, and the classification above is what it defers to.

**Where each is recorded, cited exactly, because the earlier text over-cited this.** The
`compress-commons` warning is recorded on two axes and they must not be conflated: the **dependency**
axis — that the declared graph moved from `archiver` 2.1.1 to 7.0.1, and whether that move is
authorized — belongs to [`deferred-dependencies.md`](deferred-dependencies.md) §2.6, which states the
move and carries its approval status; the **gate** axis belongs to
[`baseline-parity.md`](baseline-parity.md) §7.4 and §8. This section carries neither: its business is
that the warning was never a deviation. AAP §0.9.6's own open-items table carries **neither** of these
two — its rows are the cookie patch, the full-route deprecation surface, the Bull/`adm-zip`/`mime`
semantics, the four internal callback modules, the AWS notice suppression, the nine Dockerfiles,
storage and archive parity, and the image digest — so an earlier revision of this section was wrong to
say §0.9.6 lists both. The **`FSEventWrap`** observation is recorded in
[§10.3](#103-the-test-mode-template-watcher-runs-on-an-optional-peer-the-root-no-longer-declares)
here and in the harness's own clean-close check, and nowhere else; it was found by measurement during
this work rather than anticipated by the plan, which is exactly why it needed a home. The rule that
governs both is unchanged: while a validation target is unmet, the honest result is a **failing gate**
and the item stays named, measured and unapproved — never relabelled a deviation to close it.

**Nothing here is a proposal, and nothing here was repaired to make a gate pass.** The application's
watching path is untouched: `lib/util/nunjucks.js` is unchanged by AAP §0.3.1, and §10.3 records the
reliance rather than removing it. The `archiver` warning stopped occurring because the declared
dependency graph moved, which is a dependency decision recorded and dispositioned in
[`deferred-dependencies.md`](deferred-dependencies.md) §2.6 — this section neither approves nor
disputes it, because classification is not authorization and treating the two as one is how an
unapproved change acquires a label. What this section fixes is the **classification**, which is a
documentation defect rather than a behaviour one — and the classification is what a gate reads.

### 11.4 An unapproved security policy that was added and has now been withdrawn

**Why this is here and not in the table above.** §11.3 catalogues items *described* as deviations that
are really unmet validation targets. This one is different in kind: a body of new security policy was
written into `lib/controllers/users.js` and `lib/controllers/auth.js`, and its own source comments
described it as approved — one of them read, verbatim, "Refusing is chosen, and it is recorded as a
deviation rather than as parity." **It was never in §11.0's register, and §11.0's register is the whole
list.** The policy has been removed and the two handlers returned to the shape AAP §0.4.2 specifies.
This section records what was withdrawn, what preserving baseline therefore leaves exposed, and the
three divergences the withdrawal does not close.

#### What was withdrawn

**Measured** (static, in this tree). Every symbol below is now absent; a search over
`lib/controllers/users.js` and `lib/controllers/auth.js` returns nothing for any of them.

| Withdrawn policy | Mechanism that was added | Why it went |
|---|---|---|
| Private/loopback/link-local address denial | `net.BlockList` over 14 IPv4 and 7 IPv6 subnets, `assetAddressBlocked`, `assetMappedIpv4`, `assetHostLiteral` | Unauthorised. It also decided whether a `File` document and an S3 object were written |
| DNS pre-resolution of the asset host | `dns.promises.lookup(host, {all:true})` in `assetAddressDenialForHost`, applied per redirect hop | Unauthorised, and defective: the vetted answer could not be pinned to the address the transport later connected to, and a lookup failure returned `null` — it failed open |
| Port allow-list | `ASSET_ALLOWED_PORTS = {'':1,'80':1,'443':1}` | Unauthorised. `request` placed no constraint here |
| URL-credential refusal | `if (target.username \|\| target.password) return Error(...)` | Unauthorised, and it inverted `request`'s own behaviour, which moved userinfo onto an `Authorization` header |
| Content-encoding refusal | `assetCodingDenial(response)` | Unauthorised. This is the one whose comment claimed approval it never had |
| Delivered-byte ceiling | `ASSET_FETCH_MAX_BYTES = 1048576 * 5` counted on a `data` listener | Unauthorised. Baseline bounded the remote body not at all |
| Wall-clock deadline | `ASSET_FETCH_TIMEOUT_MS = 120000` plus an `AbortController` and an unref'd timer | Unauthorised. `request` was configured with no timeout here |
| URL and error redaction | `redactUrl`, `redactText`, `describeError`, `EMBEDDED_URL_PATTERN` | Unauthorised. Baseline logged `console.log('on error:', err)`, which is what the line is again |
| Process-scope re-raising | three `process.nextTick(function(){ throw ... })` sites — an unsupported-scheme gate, a `new URL(request.payload.url)` catch, and a write-stream `error` re-raise | Unauthorised, and the most damaging: an authenticated caller could terminate the process with a payload value. The scheme gate and the URL construction are both gone, so the payload string reaches the transport and its failures reach the log-only arm |
| Open-redirect filter | `safeRedirectDestination`, duplicated in both controllers, rejecting off-origin, protocol-relative, backslash, whitespace, control-character, malformed and non-self-scheme destinations | Unauthorised. It changed the `Location` header of successful signup, login and OAuth redirects, which AAP §0.9.3 compares **exactly** |

**What controls, stated once.** `lib/controllers/users.js`'s own delivery directive says, of R-a:
"Requires: async conversion + the `request`→`fetch` replacement + `parseLegacy` + the single
`node-uuid` removal, **and nothing else**. Means: … **do not add guards, timeouts or reject paths
anywhere.**" `lib/util/url.js`'s says "no deviation is authorized here." AAP §0.4.2 specifies the
transport's whole contract — "log and do not reject on transport error, do not start the upload when
`end` never arrives, and leave the request unsettled exactly as baseline does" — and §0.2.2 excludes
behaviour improvements except where §0.7 approves one, which for this migration it does twice and
neither time here.

#### The shape that is delivered instead

**Measured** (static plus probe). `[T lib/controllers/users.js:47]` keeps `ASSET_FETCH_MAX_REDIRECTS =
10`, `[T lib/controllers/users.js:878]` calls `fetchAssetResource(request.payload.url)` with the raw
payload string, and the two `console.log('on error:', err)` arms are baseline's own line. Five pieces
are retained as **parity, not policy** — each reproduces something the removed `request` 2.88.2 did.
That is a statement about *whose* behaviour they are, not a claim that they are inert: the redirect
ceiling and the redirect classification both decide which response is final, and therefore decide
whether a body reaches the upload at all — an over-budget chain stores nothing. They are retained
precisely because those decisions are the ones `request` made, and changing either would move a
storage outcome away from baseline:

| Retained | What it reproduces |
|---|---|
| `ASSET_FETCH_MAX_REDIRECTS = 10` | `request`'s own `maxRedirects` default. Native fetch follows 20, so without it an 11-to-20-hop chain would succeed where baseline failed |
| `assetIsRedirect(status, location)` | `request`'s test was a 3xx range plus a `Location` header, not an enumerated status list |
| `assetDiscardBody(response)` | `request` called `response.resume()` on a redirect response, releasing the socket |
| `accept-encoding: identity` | Baseline sent no `accept-encoding`, so the origin served the identity representation and those were the bytes written to disk — which §0.6.7 keys the stored object on, by their sha1. A request header only; no response is refused for it |
| `globalThis.fetch` read at call time | `test/parity/fixtures/http.js` installs itself by replacing `globalThis.fetch`; a captured reference would silently stop being intercepted |

The three `next` consumers are byte-identical to baseline again, indentation included:
`[T lib/controllers/users.js:153]` `redirect = request.yar.get('next') || payload.next,`
(`[B lib/controllers/users.js:39]`); `[T lib/controllers/users.js:218]`
`var redirect  = request.yar.get('next');` (`[B lib/controllers/users.js:104]`); and
`[T lib/controllers/auth.js:514]` `var redirectTo = request.yar.get('next') || '/home';`
(`[B lib/controllers/auth.js:164]`).

#### What preservation leaves exposed — recorded, not repaired

**This is the cost of R-d, and it is stated plainly rather than implied.** Every row is reachable in the
delivered code. Rows 1 to 7 are baseline behaviour at `2f8712a` rather than anything this migration
introduced. **Row 8 is not, and is marked as such**: baseline logged an error object on the same line,
but native `fetch` — the transport AAP §0.4.2 mandates — puts the whole URL in the error's message,
so the content of that log line changed as a consequence of the required port. It is listed here
rather than among the divergences below because, unlike those, it is closable by a change confined to
the log line and needs no transport decision.

None of the eight is a deviation: a deviation is a prohibition argued away, and nothing here has been
argued away — these are preserved, which is what R-d requires, and the exposure is the consequence.
**Acknowledging an exposure is not settling it**, and no row below should be read as settled; each
carries the follow-up that would close it, and each remains open until that follow-up is separately
approved and implemented.

| # | Exposure | Reachable how | Evidence | What controls preservation | Named follow-up |
|---|---|---|---|---|---|
| 1 | **Open redirect** (CWE-601) through `next` | `next` is written by the query string on `GET /login`, `GET /signup` and `GET /auth/google`, and by the signup payload; its only declared constraint is `Joi.string()`. It becomes the `Location` of a successful signup, login or OAuth sign-in | **static**, three sites cited above | R-d, plus §0.9.3's exact `Location` comparison — a filter changes the header the corpus compares | Constrain the value at its three writers under a separately approved security decision, with the corpus recaptured for the changed `Location` |
| 2 | **Server-side request forgery** (CWE-918) on `POST /api/users/assetFromURL` | An authenticated caller supplies any URL; the server fetches it, follows up to ten redirects, and stores the response body in user-asset storage under a content-hash key. No address, port or credential constraint exists | **static**; the route is gated by `features.assets`, which `config/default.yaml` ships `false` | R-d and §0.4.2, which specify the transport's whole contract and authorise no guard | Approve an address policy explicitly, and implement it bound to the connection — a pre-resolution check cannot be, which is why the withdrawn one was defective as well as unauthorised |
| 3 | **Unsettled request on a transport failure** | A refused connection logs and never settles; the request hangs. This is §8.1's contract, restated here because the withdrawal removed the *other* arms that shared it | **static**, `[T lib/controllers/users.js:899-904]` | §0.4.2 mandates it in those words. §0.7's precedent for serving an unsettled response is confined by name to `files.js:98-100` | Decide it the way §0.7 decided the file stream: a named conflict, a precedence argument, an approved deviation, and a corpus entry recording the change |
| 4 | **Process termination on a `tmp.tmpName` failure** | `[T lib/controllers/users.js:829-831]` throws out of the callback on a later tick, so it reaches process scope and the request is never answered. Baseline reached the same outcome by running `fs.createWriteStream(undefined)` in that same frame | **static**; not caller-controllable — it needs a temporary-name exhaustion, not a payload value | R-d. Distinguished deliberately from the three withdrawn `process.nextTick` sites, which *were* caller-controllable | Settle the promise under an approved deviation, together with row 3 |
| 5 | **OAuth authorization carries no session-bound `state` or nonce** (CWE-352) | `[T lib/controllers/auth.js:333-342]` builds the authorization URL from `client_id`, `redirect_uri`, `response_type`, `scope` and `access_type` and nothing else, and `googleCallback` verifies nothing but the presence of `code`. Login CSRF and account confusion follow | **static**; block **byte-identical** to `[B lib/controllers/auth.js:23-32]`, verified by `diff` | R-d, and §0.4.1's auth.js row, which authorises exactly two changes to this file — `request`→`fetch`, and reproducing the new-user save-then-fail path. A `state` parameter also changes the authorization `Location` §0.9.3 compares exactly | Generate, carry, constant-time verify and consume a CSPRNG `state`, as a separately approved security change with the OAuth corpus recaptured |
| 6 | **Provider access token retained in plaintext** (CWE-312) | `[T lib/controllers/auth.js:459]` and `[T lib/controllers/auth.js:483]` persist `token: profile.accessToken` under `profiles.google` on both the existing-user and new-user branches, with no expiry, no encryption and no retention rule | **static**; both sites **byte-identical** to `[B lib/controllers/auth.js:118,142]`, verified by `diff`. `lib/models/user.js` is byte-identical to baseline in full, so no schema change was made either | R-d. Dropping or encrypting the field changes what is persisted, which §0.2.2 protects as a data-format contract | Stop retaining after linking, or encrypt with access control, rotation and retention — a schema and migration change, separately approved |
| 7 | **Unbounded remote transfer** (CWE-400) | The same route opens a temporary file and pipes the remote body to completion with no delivered-byte ceiling and no body deadline, so an authenticated caller can trickle indefinitely or fill the temporary filesystem. On a transport failure the temp file and its descriptor are also left behind, because the log-only arm cleans nothing up | **static**, `[T lib/controllers/users.js:809-906]`; baseline bounded neither, and `request` was configured with no timeout on this call | R-d, and §0.4.2 — the ceiling and the deadline are two of the ten policies withdrawn above, so restoring them is the change this section exists to undo | Approve a bounded duration and delivered-byte ceiling explicitly, aborting, cleaning up and settling once, with slow-body and oversized-body cases |
| 8 | **Credential-bearing URL echoed into the log** (CWE-532) | `[T lib/controllers/users.js:903]` logs the error object with baseline's own `console.log('on error:', err)`, and printing a fetch error renders a message that embeds the whole URL, userinfo included — measured: `TypeError: Request cannot be constructed from a URL that includes credentials: http://u:p@127.0.0.1:80/x`. Query-string tokens in a source URL reach the log the same way | **probe**, Node 22.23.2 | R-d, and §0.4.2's `console.log('on error:', err)` line. The redaction that would prevent it is one of the ten policies withdrawn above | Approve redaction of userinfo, query and fragment in this one log line, leaving the route's selected response untouched |

#### The three divergences the withdrawal does not close, classified honestly

**None is a deviation**, by §11.3's own rule: nothing has been argued away and no precedence argument
has been made for any of them. All three are recorded rather than coded around, because in each case
the only ways to close them are prohibited — a scheme, credential or port gate is the guard R-a
forbids, and a process-scope re-raise is the defect this section withdrew. Closing any of them needs a
decision of the same kind §0.7 made for the file stream, and until one is recorded these rows are the
honest state.

**All three have the same origin, stated once**: they are properties of native `fetch`, which AAP
§0.4.2 mandates as this route's transport, and not of the withdrawn policy. Withdrawing the policy did
not create them and re-adding it would not have addressed them — the withdrawn code refused a
credential-bearing URL and a non-allow-listed port outright, which is a *different* outcome from
fetch's own refusal, not a repair of it.

| Divergence | Baseline | Delivered | Evidence |
|---|---|---|---|
| A `data:` payload URL is **transported and stored** | `request` raised `Invalid protocol: data:` synchronously, before its `.on('error')` listener existed; with no `uncaughtException` handler in `app.js`, `lib/**` or `config/**` the process terminated with the request unanswered | fetch resolves it, so the body is stored | **probe**, Node 22.23.2: `fetch('data:text/plain,hi')` → **200 `text/plain`** |
| A **credential-bearing** URL is left unsettled | `request` moved URL userinfo onto an `Authorization: Basic` header and fetched the resource | fetch refuses to construct such a request, so the rejection reaches the log-only arm and the request hangs | **probe**, through the running server: `POST /api/users/assetFromURL` with `url=http://u:p@127.0.0.1:8080/x` → no response, process alive, one `on error:` line |
| A URL naming a **Fetch-forbidden port** is left unsettled | `request` placed no constraint on the port and fetched the resource | fetch refuses the request with `bad port` for every port on the Fetch specification's blocked list, so the rejection reaches the log-only arm and the request hangs | **probe**, Node 22.23.2: `fetch('http://127.0.0.1:6000/x')` and `:22` both reject with cause `bad port`; through the running server, `url=http://127.0.0.1:9/x` → no response, process alive |

The second and third rows are deliberately **not** repaired by reproducing what `request` did — which
for the credential case would mean forwarding userinfo as an `Authorization` header, as
`lib/controllers/auth.js`'s own adapter still does for the OAuth hops, and for the port case would mean
opening a connection fetch refuses to open at all. Two reasons. AAP §0.4.2 names redirect following and
non-2xx handling as the transport behaviours to reproduce on this route and names neither credentials
nor ports, so adding either is *added* transport behaviour rather than specified parity. And the
credential forwarding would make the server authenticate to a caller-chosen host with caller-supplied
credentials, which is the exposure row 2 of the table above already records — so reproducing baseline
there would widen the very thing this section is careful not to hide. In all three rows the delivered
outcome takes the route's own long-standing log-only failure arm, so no response shape appears that the
route did not already produce.

**The sibling schemes match baseline in the response and differ in the process state, and the
difference is stated rather than glossed.** Measured through the running server: `ftp:`, `file:` and
`javascript:` payload URLs, an unreachable port and a private address all reject onto the log-only arm
and leave the request unanswered, which is the response baseline produced — but baseline produced it
*by terminating the process*, and here the process stays alive. Nothing observable to the client
changes, and an authenticated caller can no longer take the server down with a payload value, which is
why this direction is not treated as a loss. A WHATWG-malformed value such as `http://[` still throws
`ERR_INVALID_URL` out of `parseLegacy` into the Layer 1 catch-all and answers **500**, the funnel
`[B lib/controllers/users.js:588]` reached.

**One adjacent pre-existing defect, found while measuring this and left where it belongs.** With
`features.assets: true` and an S3 upload that fails, the route **terminates the process**:
`[T lib/controllers/users.js:869]` calls `request.fail(err)` with an `Error` — which is
`[B lib/controllers/users.js:612]`'s own call — and `request.fail` reaches
`[T lib/util/routeParser.js:316]` `h.response(json)`, where hapi throws
`AssertError: Cannot wrap an error` inside the AWS SDK's callback, uncaught. Baseline carried the
identical call and the identical `h.response(json)` at `[B lib/util/routeParser.js:510]`, so this is
neither introduced nor altered by the withdrawal above; it is simply unreachable in the committed
configuration, because `features.assets` ships `false`. It is recorded here because it sits one step
past the transport this section restored: **any handed-over scenario that reaches the upload with a
failing storage fixture will take the process down**, which the corpus work needs to know. The defect
itself belongs to `request.fail`'s error handling in `lib/util/routeParser.js`, not to this route.

#### Scenarios this withdrawal needs, handed over rather than written here

`test/parity/**` belongs to the corpus and overlay work, so these are specified and not committed
here. All of them require `features.assets: true` in the overlay, without which the route answers 501
and none of the branches below is reached:

| Scenario | What it must record |
|---|---|
| Query-bearing 200 | The stored filename keeps `?v=2`, and therefore so does the object key |
| `301 → 302 → 200` | Three transport calls; `content-type` taken from the final hop only |
| Eleven-hop chain | An expected timeout, plus the log line `Exceeded maxRedirects. Probably stuck in a redirect loop <url>` |
| `404` as the final response | The error body is still written and still stored, under the error page's own content-type |
| `302` carrying no `Location` | Treated as a final response and stored, as `request` treated it |
| Mid-stream failure after the response | The partial bytes are stored and the route answers |
| Refused connection | An expected timeout; nothing stored |
| `data:` payload URL | The divergence above: 200 and a stored body, against baseline's process termination |
| Signup, login and OAuth with an off-origin `next` | The unfiltered `Location`, which is row 1 of the exposure table |

Two generated documents also cited symbols this withdrawal deleted and line numbers it shifted, and
needed regenerating against this tree rather than editing: `docs/conversion-inventory.md` rows keyed on
`assetAddressDenial(target)` and `fetchAssetResource(target, controller.signal)`, and
`docs/error-edge-inventory.md` rows describing `users.redactText` and `users.describeError`.
**As delivered, `lib/controllers/users.js` is 1551 lines and `lib/controllers/auth.js` 541**
(**probe**, `wc -l`, this tree) — against 2168 and 541 at the pre-withdrawal commit `7028607` — so every
`<file>:<line>` citation into either has moved and none of them may be carried forward by arithmetic.
`docs/conversion-inventory.md` has since been regenerated from this tree by its own generator, which is
the mechanism its header block requires: `node test/parity/convert-inventory.js --out
docs/conversion-inventory.md`, after which `--check` exits 0. Neither withdrawn symbol survives the
regeneration — `assetAddressDenial` and `controller.signal` now have **zero** occurrences in that
document (**probe**, `grep -c`) — and its provenance moved from the dangling commit `e775cae`, which is
reachable from no branch, to this tree's HEAD. The `error-edge-inventory.md` rows named above are owned
by that document's generator.

### 11.5 A second unapproved policy, in the route parser and the logger, and now withdrawn

**Why this is a second register rather than more rows in the first.** [§11.4](#114-an-unapproved-security-policy-that-was-added-and-has-now-been-withdrawn)
covers the policy added to the two auth/user **controllers**. What follows was added to
`lib/util/routeParser.js` and to `config/log.js` — the response and logging **funnels** every route
passes through — so its blast radius was the route surface rather than one upload path, and its removal
is measurable in the route table rather than in one handler. It was never in
[§11.0](#110-the-register-is-closed-and-this-is-the-machine-readable-form-of-that)'s register either,
and §11.0's register is the whole list. Rule **T-2** is what governs the file: it authorises exactly
three categories of change inside `lib/util/routeParser.js` — removing the response emulation,
replacing `optimist` while preserving all three CLI invocation forms, and reshaping the wrapper and
`convertPreHandlers` — and every mechanism below is in none of them.

#### What was withdrawn

**Measured** (**static**, in this tree). Every symbol below is now absent: a search over `lib/`,
`config/` and `app.js` returns nothing for `redactSensitive`, `describeForLog`, `SENSITIVE_KEY`,
`failRedirectSource`, `PATH_SEGMENT_UNSAFE`, `makeValidationGate`, `nonScalarSubmission`,
`CONTROL_CHARS`, `isSafeRedirectShape`, `confineToOrigin`, `isAllowedRedirectHost`,
`logCrossOriginRedirect` or `redirectHost`.

| Withdrawn policy | Mechanism that was added | Why it went |
|---|---|---|
| Flash-value and log-value redaction | `SENSITIVE_KEY`, a depth-bounded recursive `redactSensitive`, and an allow-list `describeForLog`, applied to `request.fail`'s `log.info` line and to its `failure`, `payload` and `query` flashes | Unauthorised, and it changed **response bodies** rather than only logs. `request.fail` assigns `json.flash = request.yar.flash()` at `[T lib/util/routeParser.js:308]` and returns `h.response(json)` at `[T lib/util/routeParser.js:316]`, so a redacted flash is a changed JSON body on every route whose `fail` is a redirect and whose request negotiates JSON — `GET /reset-pass` `[B config/routes.js:275-288]`, `POST /save-pass` `[B config/routes.js:289-302]` and `POST /activate-account` `[B config/routes.js:319-334]`, all three of which the corpus drives in both accept modes. AAP §0.6.3 makes that body Layer 2's own shape, and §0.9.3 compares it exactly |
| The same redaction in the logger | `config/log.js` grew from 28 lines to 236 — a second, independent redaction layer with global regexes applied to every log string | Unauthorised, duplicated the controller-side layer, and its regexes put unbounded character classes next to alternations on attacker-influenceable strings. **`config/log.js` is now byte-identical to `2f8712a` at 28 lines** (**probe**: `git diff 2f8712a -- config/log.js` is empty), and its only consumer is `[T app.js:21]` `log = require('./config/log')`, as at baseline |
| Five rules added to `redirect()` | Rule 1 stripped `CONTROL_CHARS` from every target; rule 2 resolved the failure path through `confineToOrigin` under a new `sameOriginOnly` option; rule 3 refused any target that was not same-origin-relative or a well-formed `http`/`https` URL via `isSafeRedirectShape`, which also caught an authority carrying userinfo; rule 4 was the allow-list below; rule 5 logged every emitted cross-origin redirect through `logCrossOriginRedirect` | Unauthorised under T-2, and rules 1 to 3 changed the `Location` header of the failure path, which AAP §0.9.3 compares exactly. **`redirect()` is now byte-identical to baseline**: `diff` of `[B lib/util/routeParser.js:703-723]` against `[T lib/util/routeParser.js:679-699]` produces no output (**probe**) |
| `failRedirectSource` | A per-placeholder view of the `request.fail` argument that stripped path structure out of any value the declared `fail.redirect` template interpolates, so that `POST /users`' `/{formName}` could not be planted with a structural value | Unauthorised. It sat on the one line AAP §0.6.6 freezes — the in-place `fail.redirect` assignment — and the quirk that line produces is preserved rather than narrowed. The interpolation at `[T lib/util/routeParser.js:299]` is again `StringUtils.interpolate(fail.redirect, json)` |
| The `config.app.redirect.allowedHosts` gate | `isAllowedRedirectHost(host)`, consulted for every redirect whose target resolved to a host, confining anything outside the list | Unauthorised, and **condemned by measurement**: `allowedHosts` appears in **no** config file, **no** document and **no** parity overlay — 0 occurrences over the whole tree (**static**; the only hit anywhere is a `.git` commit message) — so the gate read an `undefined` value in every deployment, including production. A rule whose input no deployment can supply is not a control; it is a branch that never fires and a key an operator cannot discover |
| The injected validation gate | `makeValidationGate(validation, language, ctx)`, wired as a **first** `pre` entry on every route carrying a validation block, running `nonScalarSubmission` and — on a non-scalar submission — the route's own validation and `request.fail(...).takeover()` before the prerequisites | Unauthorised under T-2 and R-a. It rewrote the prerequisite chain of **97 of 233** routes, **35** of which had no prerequisites at all, and the primary manifest gate could not see it: `test/parity/manifest.js` reads the declaration's `config.pre` from a pre-parse deep copy, so an injected runtime entry is invisible to the comparison that AAP §0.9.1 makes the route surface's proof |

#### The measured effect of the withdrawal

Every figure here is a **probe** taken in this tree, against the pre-withdrawal commit `7028607` where
a comparison is stated. The pre counts were taken by parsing `config/routes.js` and
`config/api_routes.js` through `lib/util/routeParser.js` and counting `route.options.pre` on the
parsed objects — the **runtime** shape, which is the one the injected gate changed and the one the
manifest cannot see.

| Measure | `7028607` | Delivered | What it settles |
|---|---|---|---|
| `lib/util/routeParser.js` | 1623 lines | **751 lines** | The file is 872 lines smaller; what remains is the baseline's 775 lines less the 24 the emulation occupied |
| `config/log.js` | 236 lines | **28 lines**, byte-identical to `2f8712a` | The second redaction layer is gone entirely, not merely unwired |
| Registered routes | 233 | **233** | The withdrawal removed no route and added none |
| Routes carrying prerequisites | 196 | **161** | 35 routes are back to having none, and 161 is the figure AAP §0.9.1 states — the reconciliation is exact, not approximate |
| Runtime `pre` entries | 385 | **288** | 97 injected entries removed, one per route carrying a validation block |
| Route-table CLI | — | byte-identical across all three invocation forms — no argument, `-R` and `--routes` — at sha256 `73432d50d571bbfcfd9dca204cda254507294ab644bab7b23fb8995b598a460f`, 112 data rows | The T-2 obligation on the CLI still holds after the removal |

#### What the withdrawal restores, measured rather than assumed

**The `fail.redirect` cross-request state leak of [§3](#3-a-cross-request-state-leak-in-failredirect) is
preserved, and it was demonstrated after the withdrawal** (**probe**, through a running server on this
tree, three consecutive failing requests to `POST /users` in one process):

```text
POST /users  formName=signup   ->  302  Location: /signup
POST /users  formName=login    ->  302  Location: /signup   <-- request #2 inherits request #1's target
POST /users  formName=zzz      ->  302  Location: /signup
```

That is the outcome AAP §0.6.6 states as the target disposition — "keep the in-place assignment" — and
the code carries the reasoning inline at `[T lib/util/routeParser.js:288-299]`, naming the corpus
scenario `quirk.fail-redirect-leak.post-users`, which compares two consecutive `Location` values **to
each other** precisely so that a build which quietly made this request-local is detected.

#### What preservation leaves exposed — recorded, not repaired

**This is the cost of R-d and T-2, on the same terms as §11.4's table**: each row is reachable in the
delivered code, none is a deviation, and acknowledging an exposure is not settling it. Each stays open
until its follow-up is separately approved.

| # | Exposure | Reachable how | Evidence | What controls preservation | Named follow-up |
|---|---|---|---|---|---|
| 1 | **Off-origin redirect** (CWE-601) through the failure path, frozen for the process | `POST /users` declares `fail.redirect` as `/{formName}` and takes `formName` from the payload. A protocol-relative value matches `redirect()`'s own first branch and is emitted as an absolute off-origin URL — and because the interpolation is written back onto the parse-time object, **every later failing request in that process is sent to the same place** | **probe**, fresh process: `formName=//evil.example` on the first failing request answered `302 Location: http://evil.example/`, and the next failing request, carrying `formName=signup`, answered `http://evil.example/` as well | R-d and AAP §0.6.6, which freeze the in-place assignment; T-2, which does not authorise new rules in `redirect()`; and §0.9.3's exact `Location` comparison | Constrain the interpolated value at the `request.fail` sink under a separately approved security decision, with the corpus recaptured for the changed `Location` — and note that any such fix must keep the freeze itself observable, or it silently repairs §3 |
| 2 | **Submitted values reach the failure flash and the info log unredacted** | `request.fail` logs `util.inspect(json)` at `[T lib/util/routeParser.js:283]` and flashes `failure`, `payload` and `query` verbatim at `[T lib/util/routeParser.js:288]`, `[T lib/util/routeParser.js:301]` and `[T lib/util/routeParser.js:302]`; the flash is read back into the rendered page and into the JSON body, so a failed credential-bearing submission is both logged and echoed | **static**, the four sites above; and the response-body half is what made the withdrawn redaction a body change on the three routes named in the table | R-d, and AAP §0.6.3, which makes the Layer 2 body shape a preserved contract | Approve a redaction whose scope is the **log line only**, leaving the flash — and therefore the compared body — untouched; a body-visible redaction needs the corpus recaptured |
| 3 | **Prerequisites still run before this file's hand-rolled validation** | Every `pre` entry naming a payload-fed lookup — for instance `file(payload.fileId)` on `POST /api/users/assets/restore` `[B config/api_routes.js:1276-1287]` — receives the raw submitted value, because the validation block runs inside the handler and the handler runs after the prerequisites | **probe**: an operator-shaped submission on that route (`fileId[$exists]=true` and `{"fileId":{"$exists":true}}`) answered **400** in both encodings, where a scalar absent id answered 404 — so on this route the lookup itself refuses the shape, and **no arbitrary-document match was observed**. The ordering is real; an exploitable match on this route is not evidenced | R-a and T-2: a pre-handler injected into 97 routes is not one of the three authorised changes, and AAP §0.6.2 fixes the accept/reject outcomes the handler's own block produces | Re-establish the ordering question as its own reviewed change — a validator registered where hapi expects one, or per-route schemas that reject non-scalars before a lookup — with the joi matrix re-driven, since 53 of its differences were this gate refusing drives before validation ran |

#### Why this withdrawal needed no scenario handover

Unlike §11.4, nothing here asks the corpus work for a new case, and every artifact it needs is already
committed. The route surface is proved by the manifest and the CLI digest above. The failure path's
`Location` is driven **three times in one process** by `quirk.fail-redirect-leak.post-users`, whose
recorded baseline steps are `/signup`, `/signup`, `/signup` for `formName=signup`, `formName=login` and
`formName=sign-up` — the same three values, in the same order, that the probe above reproduces on this
tree, and the only shape that can detect a regression of either the freeze or the withdrawn
confinement. The three flash-body routes named in the withdrawal table are each in the corpus in both
accept modes (`route.get.reset-pass.html` / `.json`, `route.post.save-pass.html` / `.json`,
`route.post.activate-account.html` / `.json`).

What the withdrawal changes for a **gate** rather than for a scenario is the joi matrix's input: while
the injected gate was wired, a drive against a route carrying validation could be refused before the
route's own validation ran, so the matrix's differences were partly the gate's own refusals rather than
schema behaviour. With the gate gone — 0 occurrences of `makeValidationGate`, and 288 runtime `pre`
entries where there were 385 — every drive reaches the hand-rolled block AAP §0.6.2 makes the authority.
The matrix's own verdict and difference count belong to [`baseline-parity.md`](baseline-parity.md) and
to the `verify:joi` artifact, which are where a re-driven figure is recorded; this section states only
what was removed from its path.

---


---

## Appendix A — the quirk allow-list for generated target actions

**Why this exists.** `docs/conversion-inventory.md` is generated, and its generator composes each
row's target action as a **generic conversion mandate** followed by a quirk pointer into this document.
For most rows that reads correctly. For a row whose preserved outcome requires a handler *not* to
return — to be left unsettled, or to throw — the generic mandate and the quirk pointer say opposite
things in the same cell, and the mandate comes first. **Measured on the committed artifact, this
contract is honoured: the generator resolves the allow-list before composing an action, and 18 rows
carry a `PRESERVED QUIRK, GOVERNING ACTION` cell instead of a contradicting mandate** (**probe**,
`grep -c 'GOVERNING ACTION' docs/conversion-inventory.md` → 18, the same figure before and after that
document's regeneration against this tree). The generated document states the same contract from its
own side, and names the inverse entry explicitly `[T docs/conversion-inventory.md:228-237]`. An
earlier revision of this paragraph recorded "nine rows carry both a quirk pointer and a mandate that
contradicts it"; that described an artifact rendered before the allow-list was resolved, and the
measurement above supersedes it. The list below therefore remains a live contract for any *future*
generator rather than a description of an outstanding defect.

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
| Its two callback boundaries — `[B lib/controllers/users.js:591]`, `[B lib/controllers/users.js:611]`; delivered at `[T lib/controllers/users.js:820]`, `[T lib/controllers/users.js:868]` | Take the `await` at the call site **without** making the refused-connection path settle | a callback-boundary mandate that settles every path removes the unsettled outcome | [8.1](#81-the-streaming-asset-fetch) |
| `lib/controllers/auth.js` `googleCallback` and its three callback boundaries — `[B lib/controllers/auth.js:49]`, `:69`, `:85`; delivered at `[T lib/controllers/auth.js:359]`, `:405`, `:426` | Persist the user, mutate the session, **then** report the generic failure — preserve the order and the absence of a login | a mandate to return a response on every path can silently drop the throw that produces the failure | [6](#6-google-oauths-new-user-path-saves-the-user-and-then-reports-failure) |
| `lib/controllers/folders.js` `trinkets` | Pass **no** folder filter on the queryless path; pass it only when a query is present | "every path returns exactly once" is satisfiable while accidentally fixing the queryless path | [7](#7-folderstrinkets-builds-a-malformed-injected-url-when-no-query-is-present) |
| `lib/controllers/courses.js` `download` | Keep the residual `reply(Boom.forbidden())` in the unauthorized branch, so it throws and answers 500 | "every `reply(...)` becomes a returned toolkit response" would convert the 500 into the 403 the expression names | [9.7](#97-a-routed-handler-that-answers-500-where-its-author-intended-403) |
| `lib/controllers/users.js` `getExportStatus` and `downloadExport`, all 15 `Boom.*` sites in the module | Keep each expression **as written**, with `Boom` the first unresolvable identifier on its line, and keep `lib/models/model.js` byte-identical so the throwing callback is still re-invoked. The delivered response is a 200 carrying `{"error":"Boom is not defined"}` | Two generic mandates are wrong here at once: "resolve/return a response on every path" is already satisfied — by the *second* invocation — and any tidy-up that binds `Boom`, rewrites the calls as `errors.*`, reorders the identifiers on the line, or stops the finder re-entering a rejected callback changes both the status and the body. The message itself is client-visible, so even the identifier order is part of the contract | [9.9](#99-two-routed-handlers-that-answer-200-carrying-the-name-of-a-missing-identifier) |
| `[T lib/controllers/admin.js:213]`, `:265`, `:272`, `:288`, `:337`; `[T lib/controllers/users.js:328]`, `:391`, `:724`, `:869` | Keep `request.fail(err)` passing the **`Error` itself**, and keep `request.fail`'s `h.response(json)` unchanged. These nine edges terminate the process, and that is the preserved outcome | A mandate to "map the error to a response" or "reach the funnel" would give nine edges a status and a body they have never produced — R-e per edge, R-d as an improvement — and `request.fail` is on T-2's preserved list | [10.11](#1011-requestfailerr-with-an-error-argument-terminates-the-process) |
| `lib/controllers/trinket.js` `updateMetrics`, its metric-free branch | Keep **both** halves of `return Trinket.findById(id, function (err, trinket) { return request.success({data:trinket}); });` — the callback **and** the returned `Query`. The callback's response is meant to go nowhere: it is the double execution that answers, with a 500 | A generic delivery mandate — return the value, settle the promise the method returns with it, or return it from the nested handler of a chain the method returns — is satisfiable in three ways that all turn the 500 into a 200 carrying the trinket state. The generated row is closed rather than open, and it reaches the same conclusion in its own words: the discarded call "is the BASELINE outcome, not an unfinished conversion", and "Do NOT reroute them to deliver" `[T docs/conversion-inventory.md:568]`. That row's diagnosis is correct and is the quirk, not a defect to close | [9.8](#98-a-routed-handler-whose-metric-free-branch-answers-500-where-its-comment-intends-the-trinket-state) |
| `[B lib/util/helpers.js:182]` `findTrinket`, `[B lib/util/helpers.js:385]` `courseBySlug`; delivered at `[T lib/util/helpers.js:202]` and `[T lib/util/helpers.js:443]` | `return null` — the value the shim produced. The redirect construction is **removed, not converted** | converting the chain would emit a 301 the baseline never emitted | [2](#2-two-live-pre-handler-301-redirects-that-never-fire) |
| `[B lib/controllers/trinket.js:1204]`, `:1246`, `:1259` — baseline coordinates, which is how the generated checklist keys these three rows, because the legacy chain is gone from each carrier and the category declares no target shape to locate | Reproduce what was captured at baseline — the specification is a measurement, not a rewrite rule, and it **has been taken**: the three recorded baseline statuses are in [§4.3](#43-builder-returned-to-hapi--three-chains), which is the value to reproduce. What is still absent is the replay result for the target, so the capture is the authority here rather than a re-derivation from the code | a mandate to return a toolkit response is right in form and silent about which response, which is the whole content of the quirk | [4.3](#43-builder-returned-to-hapi--three-chains) |
| `[B lib/controllers/trinket.js:375]` — a baseline coordinate; the legacy construct is no longer in this tree | **Return** the mapped error — here the statement *must* change to preserve the outcome | the inverse case, listed so the allow-list is not read as "never change a statement": this one is a genuine rewrite | [4.4](#44-one-further-unreturned-reply-on-an-error-path) |

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
same locator — `[T lib/controllers/files.js:395-397]` in the delivered tree, which the two sibling
records still address as `171-173` from an earlier revision of the file; the expression they quote is
identical and only the line pin differs — and the same statement that `Content-Disposition`
stays omitted. The three reasons are enumerated here and restated in the same order in §7.1; §4.1
assigns them to §11.1 instead of restating them, which is the ownership §11 claims. What the three
legs disagree about is the **evidence state** of the gate, immediately below.

**Divergence 1, deviation 1's evidence state — resolved, in favour of the present tense.** §11.1's
**Gate** paragraph above says, in the present tense, that the corpus records the baseline result as an
**expected timeout** and that the target answers; `docs/deferred-dependencies.md` §4.1 carries that
same sentence in that same tense. `docs/baseline-parity.md` §7.1 used to say the opposite — that what
existed was "an **annotation, not a measurement**" — and cited the artifact for it.

**The artifact now supports the carrier sentences.** `test/parity/corpus.json` reports
`captured: false` with `baselinesPending: 0` — the strict flag means every scenario carries a baseline, and one is recorded `unreachableByDesign` instead; 391 of the 392 scenarios carry a recorded baseline;
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
`[T lib/controllers/files.js:395-397]`, the omitted `Content-Disposition` and the precedence argument
read the same in all three records, as they did throughout the disagreement.

**The residual is now narrower than a refusal.** `verify:corpus` — a replay of the whole committed
corpus — **runs**: 391 of the 392 scenarios driven on both cookie passes, this deviation classified
`approved-deviation` in each. An earlier revision recorded the gate as exiting 2 because the corpus's
provenance named a generator this repository could not retrieve, with the evidence above coming from a
re-captured segment; the full re-capture through the delivered generator replaced both. What remains
open is the **secure** pass, which derives its expected cookie attributes rather than comparing a
secure-side recording ([`baseline-parity.md`](baseline-parity.md) §2.8).

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
