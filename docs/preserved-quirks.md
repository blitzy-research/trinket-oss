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
| **artifact** | Recorded in a committed parity artifact (`test/parity/*.json`) |
| **corpus** | Carried as a scenario in `test/parity/corpus.json`, driven by the replay gate |
| **pending** | Not verifiable from this tree yet; the gate that settles it is named |

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
  documented. Every "measured" line below is a measurement against that commit, tagged with how it
  was taken. R-d and R-f do not conflict: on whether behaviour or intent governs, they agree.
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
| [10](#10-additional-measured-findings) | Findings beyond AAP §0.6.6 | In-memory queue events unreachable; test-mode mail template | Worker harness |
| [11](#11-the-two-approved-deviations) | **Approved deviations** — not preserved | Stream response served; `marked` fork retained | Corpus diff; audit |

---

## 1. Three routes bound to controller methods that do not exist

**Measured** (static, plus artifact). Three registered routes name controller methods that are not
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
controller. Regenerating the route manifest in the delivered tree records all three with
`handlerKind: "missing-controller-fallback"`, and the aggregate is exactly 3 of 233.

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

**Measured** (static, plus corpus). Chain 1:

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

**Measured** (static, plus corpus). Chains 2–5 each continue to `.header(...)`, which settles the
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

**Measured** (static, plus corpus). Chains 6–8 each do `return reply(...).type(type)`. Because
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

**Target disposition: the measured status, content type and body are reproduced**, captured from the
baseline server before conversion rather than reasoned about. The corpus records each of the three
verbatim, which is why these three carry the instruction that they be captured at baseline first.

**Gate.** The three `quirk.reply-chain.builder-returned.*` scenarios in the table at the end of this
section, whose recorded baseline values are the specification for these three responses.

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

**Gate.** One corpus scenario per chain, eight in total:

| Chain | Corpus scenario | Expectation |
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
answer 200. The smoke test is not wrong and is not changed; it stays unauthenticated by decision. The
authenticated branch simply had no coverage.

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

**Measured** (static, plus corpus). In `auth.googleCallback` `[B lib/controllers/auth.js:35]` the
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

**Measured** (static, plus probe and corpus). The handler builds a URL by concatenation and injects
it back into the server:

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
`quirk.folders-trinkets`, on `GET /api/folders/{folderId}/trinkets`: step 1 is driven bare and expects
200 with a body containing `"data":[]`; step 2 carries a query and expects 200 with the folder's
trinkets.

---

## 8. The streaming asset fetch's two failure modes, and reCAPTCHA's faults

### 8.1 The streaming asset fetch

**Measured** (static, plus probe and corpus). `users.assetFromURL` validates the supplied URL, then
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

**Gate.** Three corpus scenarios in group `error-edge.log-and-continue`, each with its own recorded
fixture profile:

| Scenario | Fixture profile | Expectation |
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

**Gate, and a reported finding.** All six outcomes exist as recorded fixture profiles in
`test/parity/fixtures/http.js` — `recaptcha:success`, `recaptcha:rejected`, `recaptcha:non-200`,
`recaptcha:transport-failure`, `recaptcha:malformed-json`, plus the two short-circuits, which need no
recorded response.

**Reported finding: reCAPTCHA is the one quirk in this catalogue with no dedicated corpus scenario.**
This is by design and the fixture states the reason at `[T test/parity/fixtures/http.js:197-204]`:
outcomes 3–6 are exercised by **direct module-level invocation** of `verify()` rather than through a
route, because outcomes 5 and 6 deliver no callback at all, so a route-driven case would hang without
distinguishing the fault from any other timeout. The gate for this entry is therefore the fixture
profiles plus that direct invocation, not the replay corpus. It is recorded here as a finding rather
than presented as corpus coverage it does not have.

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

---

## 10. Additional measured findings

Baseline behaviours measured in the delivered tree that AAP §0.6.6 does not enumerate. §0.6.6 is the
mandatory floor for this document, not its ceiling. Both entries below were measured here rather than
inherited from the plan.

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

### 10.2 The completion mail template is not configured under `NODE_ENV=test`

**Measured** (static). The bulk-export processor configures the template environment only when not
running as a test:

```javascript
// [B lib/workers/exports.js:106-108]
  if (!config.isTest) {
    env = nunjucks.configure(config.app.templates);
  }
```

Under `NODE_ENV=test` the local `env` therefore stays `undefined`, so any later render through it
throws while the job is otherwise succeeding — the completion notification is the consumer.

**Target disposition.** The guard is preserved as written. The worker harness supplies the mail fixture
and drives one successful and one failing job, so the path is exercised without the guard being
removed; removing it would change what a test-mode run does, which is a behaviour change in the
direction R-d prohibits even though it looks like a repair.

**Gate.** The worker harness's captured-mail fixture.

---

## 11. The two approved deviations

These are the **only** two places in the migration where something is deliberately **not** preserved.
Both are recorded as deviations rather than as preservation. Each is stated once, canonically, here;
the handler mapping and the corresponding gate carry the same decision, and a divergence between the
three would itself be a defect.

### 11.1 Deviation 1: the never-settling file response

**Measured** (static, plus corpus; the full classification is in §4.1).
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

**Gate.** The corpus records the baseline result as an **expected timeout** and the target result as a
200 stream response, so the replay diff reports an **approved change** rather than a failure. Scenario
`quirk.reply-chain.never-settles.image-download`, whose baseline expectation is `timedOut: true` and
whose reach is narrow — the branch is entered only by file documents whose `type` carries a mime-like
string such as `image/png`.

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

### Verification status of the cross-document alignment

The two approved deviations in §11 are required to read identically here, in `docs/baseline-parity.md`
and in the gate. At the time this document was written `docs/baseline-parity.md`,
`docs/deferred-dependencies.md` and `docs/error-edge-inventory.md` **had not yet been generated**, so
that three-way comparison could not be executed and is recorded as **pending** rather than as
performed. The alignment contract is fixed by the canonical statements above: deviation 1 is "the
target serves the stream response; R-b controls", with the three reasons and the exact target
expression in §11.1; deviation 2 is "the fork is retained, one named high, reasoning owned by
`docs/deferred-dependencies.md`". The settling check is a direct comparison of those two statements
against the same two in `docs/baseline-parity.md` once it exists.

One further note, recorded rather than acted on: `mkdocs.yml`'s `nav:` lists only `index.md`,
`setup.md` and `overview.md`, so this document is not part of the rendered documentation site.
Changing that navigation is outside the scope of this work and `mkdocs.yml` is not modified.
