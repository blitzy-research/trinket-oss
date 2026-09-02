# Baseline parity

How baseline behaviour was captured, what was compared, and how each ambiguity was resolved.

| | |
|---|---|
| **Base commit** | `2f8712a` — *chore: extend catalog tags (security, web-app)* |
| **Full hash** | `2f8712a112db46f923918c4507c75abc732d83d0` |
| **Role** | The **R-f tie-breaker reference**. Every question this migration raised that the request did not settle was settled against observed behaviour at this commit |
| **Delivered tree** | `9d1edf43439785863f7ce7159e08e17883e56fc6` |
| **This document owns** | The corpus method, the coverage accounting, the comparison rules, the R-f resolution log, the two approved deviations, and the honest list of what is **not** proven |
| **Verified** | `git log --oneline -1 2f8712a` |

## What this document is, and what it is not

Rule **R-f** makes baseline observed behaviour at `2f8712a` the tie-breaker for every ambiguity, and
requires that **each resolution be documented**. This file is that record, and AAP §0.7 names it as
R-f's deliverable. AAP §0.9.5 makes its completeness a gate: the **corpus method**, the **coverage
accounting** and the **resolution log** must all be present.

It is also the migration's parity *evidence* document — what a reviewer reads to decide whether
"identical normalized responses" was a real claim or an assertion. So it is written to be
falsifiable. Every figure below was measured in the delivered tree by a command that is named beside
it, and **every claim that was not measured says so and names the gate that would settle it**
([§8](#8-what-remains-unproven)). A parity document that claims everything is proven is less useful
than one that says precisely what is not.

It deliberately does **not** duplicate the quirk catalogue, the dependency tables or the error-edge
rows. Those have owners ([§9](#9-cross-references)), and a second copy of a fact is a second thing to
keep in step.

## Rules that govern this record

**`review_rules` returns exactly "No user rules provided."** — verified with the tool for this
document, and independently recorded by AAP §0.7 and §0.10.1. **No rules are invented in their
place**, and their absence is not read as licence to lower the bar: enterprise practice governs, and
the two commitments it imposes on a file like this one are that **every validation claim is backed by
an inspectable artifact** and that **what was not proven is recorded as clearly as what was**.

The request's own RULES block is binding and is not that document. Each is cited, not reproduced.

| Rule | What it requires of this file | Where it is honoured |
|---|---|---|
| **R-f** | The base commit, the measurement method, and one resolution-log entry per ambiguity with the measurement that settled it | The whole file; [§6](#6-the-r-f-resolution-log) is the log |
| **R-d** | Behaviour improvements are prohibited, so a difference is a **failure** even when the new behaviour looks better. The one exception is a marked, approved deviation | [§4.5](#45-a-difference-is-a-failure-and-the-one-exception), [§7](#7-the-two-approved-deviations) |
| **R-b** | The application genuinely runs on Node 22 **in full, with no route excluded** — so the coverage accounting is R-b's proof, an unrepresented route **fails** the run, and a genuinely undrivable entry is listed here with its reason | [§3](#3-coverage-accounting) |
| **R-e** | Error-to-response mappings survive unchanged. One minimal request per route exercises **success** paths only, so the failure cases come from the changed-error-edge checklist | [§4.6](#46-failure-paths-run-beside-the-success-sweep) |
| **R-a** | The diff must read as runtime bump, hapi API migration, async conversion and blocking-only dependency swaps — so this file records decisions and adds no scope | Every resolution in [§6](#6-the-r-f-resolution-log) names the rule it serves |
| **R-c** | Replaced and deferred packages recorded with reasons | Owned elsewhere ([§9](#9-cross-references)); referenced, not restated |

### R-d and R-f do not conflict

This is worth stating plainly, because at first reading they look as though they might. R-d prohibits
behaviour *improvements*; R-f makes baseline *observed* behaviour the tie-breaker. The question that
could divide them is what to do where observable behaviour differs from what the code evidently
intended — and on that question **the two rules agree: the observable behaviour wins**. R-d forbids
"fixing" it and R-f points at the same measurement as the authority. There is exactly one class of
case where they cannot both hold, which is where a requirement *other* than R-d makes preservation
impossible; both instances are decided, recorded and evidenced in [§7](#7-the-two-approved-deviations).

The consequence for this file is a division of labour: `docs/preserved-quirks.md` owns **what** each
quirk does, and this file owns the **method** by which it was measured and the deviations approved
against that method.

## Citation convention: two trees

Two trees are cited throughout and they are never conflated:

- **`[B path:lines]`** — the **baseline** tree at `2f8712a`.
- **`[T path:lines]`** — the **delivered** tree at `9d1edf4`.

Line numbers moved during the migration, so a single address would be wrong for one of the two trees.
Where a claim is about a declaration rather than a line, the locator is a key path
(`[T package.json:scripts]`). Three categories take no line locator and none is manufactured for
them: **absence claims**, where the evidence is that a search over a named file set returned nothing
and the prose names the set searched; **measured aggregates**, attributed to the command that produced
them; and **statements about the target design**, which are decisions rather than assertions about an
existing system.

## Evidence legend

| Marker | Meaning |
|---|---|
| **measured** | A command was run in this delivery and its output is the evidence. The command is named. |
| **artifact** | The evidence is a committed file under `test/parity/`, readable without running anything. |
| **read** | The evidence is the delivered source, cited by path and line. |
| **not proven** | No measurement supports it yet. It appears in [§8](#8-what-remains-unproven) with the gate that would settle it. |

---

## 1. Base commit, worktrees and provenance

### 1.1 The base commit

All baseline claims, measurements and captured values are taken at **`2f8712a`**, subject
*chore: extend catalog tags (security, web-app)*, full hash
`2f8712a112db46f923918c4507c75abc732d83d0` (**measured**: `git log --oneline -1 2f8712a`). Where the
request's description of the codebase and the codebase disagree, this commit is the authority. That is
R-f, and it is the reason several of the entries in [§6](#6-the-r-f-resolution-log) resolve *against*
the request's own framing without changing its objective.

### 1.2 Two worktrees, each independently installed

**The parity tooling is created by this migration and does not exist at `2f8712a`.** Everything under
`test/parity/` is new. So a baseline measurement cannot be taken by running a tool that lives in the
baseline tree — there is none — and the architecture follows from that:

1. An **untouched baseline worktree** is created at the base commit and left alone:

   ```console
   $ git worktree add --detach /tmp/blitzy-c1/baseline-2f8712a 2f8712a
   $ git -C /tmp/blitzy-c1/baseline-2f8712a rev-parse HEAD
   2f8712a112db46f923918c4507c75abc732d83d0
   ```

2. It is given its **own `npm ci`, from the baseline lockfile** (**measured**: exit 0, 642 packages).
   It cannot share the delivered tree's `node_modules`: the two dependency graphs differ by design —
   `@hapi/hapi` 20.3.0 against 21.4.10, `joi` 17.13.3 against 18.2.5, and a dozen further moves
   recorded in `docs/dependency-inventory.md` — so a shared install would have measured the baseline
   application against the target's dependencies and proved nothing about either.

3. The **tooling lives in the delivered worktree** and is invoked with `--app <baseline path>`.

### 1.3 What "captured at baseline" means, precisely

The loose phrasing is misleading, so it is spelled out:

> **Captured at baseline** means *captured by delivered-worktree tooling, invoked with
> `--app <baseline path>`, which spawns the application as a **child process** with that path as its
> working directory so that module resolution uses the **baseline's own install**.*

Two properties make it checkable. The tools require **no application source into their own process** —
the application is always a child — so a tool cannot accidentally measure the tree it happens to live
in. And every artifact is written with a **sibling provenance file** recording both trees, so "which
tree did this measure" is answerable from the artifact rather than from a claim.

### 1.4 Tool provenance, per artifact

| Artifact | Analysed tree | Tool | Tool commit | Status |
|---|---|---|---|---|
| `test/parity/joi-baseline.json` | `/tmp/blitzy-c5/baseline-2f8712a` @ `2f8712a112db…` | `test/parity/joi-matrix.js` | `6da0a28adee6…` | **artifact** — sidecar `joi-baseline.json.provenance.json`, `mode: "capture"`, node `v22.23.2`, joi `17.13.3`, hapi `20.3.0` |
| `docs/error-edge-inventory.md` | `/tmp/blitzy-c8/baseline-2f8712a` @ `2f8712a112db…` | `test/parity/error-edges.js` | `d65ad8619598…` | **artifact** — provenance block in the document head; 341 rows over 12 files, `--counts-check=strict` |
| baseline route manifest | `/tmp/blitzy-c1/baseline-2f8712a` @ `2f8712a112db…` | `test/parity/manifest.js` | `9d1edf434397…` | **measured** in this delivery; sidecar `<out>.provenance.json` |
| delivered route manifest | the delivered tree @ `9d1edf434397…` | `test/parity/manifest.js` | `9d1edf434397…` | **measured** in this delivery |
| `test/parity/corpus.json` | — | `test/parity/capture.js` | — | **not proven** — definitions only, no capture has been driven ([§2.8](#28-capture-status--the-honest-position)) |

The three baseline worktree paths differ because each was created by a different working clone; **all
three are the same commit**, which is the property that matters. A per-clone path is not part of the
evidence and is recorded only so a reader can match an artifact to its sidecar.

### 1.5 The execution-order consequence, and the order actually delivered

**The observer must exist before the baseline can be observed.** That single fact fixes the intended
order, and it reads backwards until it is stated:

1. Build and validate the parity harness **first**, in the delivered worktree.
2. **Then** freeze and capture the baseline, through `--app`.
3. **Then** repair the suite and its provisioning, so the existing assertions run.
4. **Then** convert handlers and pre-handlers under the retained compatibility shim.
5. **Then** remove the shim and re-run every gate.

So "baseline first" means *before any behaviour-changing change* — **not** before creating the tools.
This is safely orderable because the shim intercepted only an `undefined` result and passed any
defined result straight through, so a handler converted to return its response already worked
underneath it, and converted and unconverted handlers coexisted.

**The order actually delivered was different, and R-f requires the record to say so** (**measured**:
`git log --oneline 2f8712a..HEAD`, oldest first): the dependency set and runtime pin (`decfd63`), then
support modules (`b97fe4c`), then the controller and pre-handler conversions
(`3dc7bb1`, `ad033e0`, `9350b56`), then **shim removal** (`1680624`), then the fixtures and auth
scheme (`8834214`), and only then the harness and parity tooling
(`d12759b`, `81ccd5e`, `6da0a28`) and the gates and documents.

Two consequences follow, and both are load-bearing for how the rest of this document reads:

- The corpus **could not** be captured in the delivered tree by the time `capture.js` existed, because
  the tree had already been converted. Baseline capture therefore requires the separate worktree in
  [§1.2](#12-two-worktrees-each-independently-installed) for every artifact — which is what the two
  captured artifacts in [§1.4](#14-tool-provenance-per-artifact) did, and what the corpus has not yet
  done ([§2.8](#28-capture-status--the-honest-position)).
- Step 3's intended reassurance — the existing assertions green *before* any conversion — was never
  available, so it cannot be cited as evidence. [§6.2](#62-npm-test-had-no-green-baseline) records what
  is known instead.

---

## 2. The corpus method — a scenario model, not 233 route keys

### 2.1 Why one request per route is not enough

A corpus keyed on the route table would be 233 entries and would miss most of what this migration
could break. Three properties of this application make that so, and each was found by driving the real
surface rather than by reading it:

- **The error funnel branches on `Accept`.** The first `onPreResponse` extension classifies a request
  as API-or-JSON by path prefix or by the `Accept` header, and for a browser HTML request it **returns
  early** on 401, 404, 403 and any status ≥ 500 — before the `Cache-Control` / `Pragma` / `Expires` /
  `X-Frame-Options` assignments (**read**: `[T app.js:177-226]`). The same route therefore answers with
  a different header set depending on the header sent, so HTML and JSON are **separate cases**, never
  one case with a normalized header.
- **Several behaviours exist only for a particular identity.** The two `pages` handlers that answer 500
  are on the `request.auth.isAuthenticated` branch, and an unauthenticated probe of the same paths
  returns 200 — which is why the pre-existing shell smoke check never detected them.
- **Some behaviours require a *repeated* request.** The `fail.redirect` cross-request state leak is
  invisible to any single request: the second request to the same route redirects to the first
  request's interpolated target. A corpus of independent cases cannot express it.

### 2.2 What a case carries

A scenario is a route **plus** the conditions under which it is driven. Each definition carries
(**read**: `test/parity/capture.js`, the scenario builder):

| Field | What it fixes |
|---|---|
| `route` | `{method, path}`, taken from the manifest and joined on the manifest's own `routeKey`, so the two artifacts cannot disagree about what identifies a route |
| `identity` | One of `anonymous`, `user`, `admin`, `disabled`, `missingRecord` |
| `accept` | HTML or JSON, as separate cases — never merged |
| `intent` | `success`, `failure`, `redirect`, `timeout`, `unknown-payload` or `unreachable` |
| `mutating` | Whether the case writes; mutating cases are ordered last |
| `fixtureProfile` | Which external-effect recording is in force |
| `freshSession` | Whether the case needs its own session rather than the shared jar |
| `covers` | The manifest route keys the case accounts for in the coverage table |
| `expectation` | A declared baseline expectation that is **checked** rather than assumed |
| `steps` | An **ordered sequence**, where a quirk needs more than one request |

The identity set is measured rather than nominal. `missingRecord` is **not** a seeded user: it is a
session whose `userId` names a record that has been deleted **through the application's own route**,
which is the only way to reach the "User not found" outcome without reaching into the database from
the harness. The account it sacrifices is a fixed throwaway registration, deliberately distinct from
every seeded identity so that no fixture is consumed.

The composition of the committed definitions (**artifact**: `test/parity/corpus.json`):

| Dimension | Distribution |
|---|---|
| Total scenarios | **383** |
| Groups | `route-sweep` 349 · `auth-outcome` 5 · `quirk.*` 20 · `error-edge.*` 9 |
| `Accept` | JSON 248 · HTML 135 |
| Identity | `anonymous` 243 · `user` 125 · `admin` 13 · `disabled` 1 · `missingRecord` 1 |
| Intent | `success` 337 · `unknown-payload` 21 · `failure` 19 · `redirect` 3 · `timeout` 2 · `unreachable` 1 |
| Mutating | 120 |
| Multi-step | 6 |

The six multi-step sequences are the cases that cannot be expressed as independent requests, and the
sequence is part of the definition precisely so a replay cannot reorder them:
`quirk.fail-redirect-leak.post-users` (the **two consecutive requests** the state leak requires),
`quirk.folders-trinkets.queryless-and-query-bearing`, `quirk.dead-301.course-by-slug-alias`,
`quirk.oauth.new-user-created-then-failed`, `quirk.oauth.existing-user-succeeds`, and
`auth.outcome.user-not-found` (four steps: register, authenticate, delete, then request).

### 2.3 Paths are materialized, and mutations run last

**Wildcard and static path segments are materialized to concrete values from the fixed-`_id` seeds**
(`test/parity/seed.js`), never to an invented identifier. That is a deliberate ordering of two
options: a generated id would have to be added to the volatile set and normalized away, whereas a
seeded id is **compared exactly**. Seeding beats scrubbing, and [§4.4](#44-the-volatile-set-six-categories-taken-from-the-code)
records the cases where seeding was not available.

Two ids that look cosmetic are not. Scenario ids **spell out a trailing slash and preserve the path's
own case**, because `/python` and `/python/` are different routes with different controllers, and both
`/R` and `/r` are registered — so the obvious slug would silently collide two routes onto one id, and
`--only` selects and `--append` merges by that id.

**Mutating routes are driven last**, with minimal payloads that satisfy the declared validation, and
the payload is recorded beside the response so a reviewer can see what was sent rather than inferring
it. Read-only cases run first, so a mutation cannot change what an earlier read observes.

### 2.4 Every case has a finite timeout, and an expected timeout is a result

Each step carries a finite budget — 15 000 ms by default, and 4 000 ms for a case whose baseline
expectation *is* a timeout, so a known hang does not add dead time to every run (**read**:
`test/parity/capture.js`). The driver never rejects: a response, a timeout and a transport failure are
all **recorded outcomes**, because a harness that throws on the interesting case produces a corpus
missing the interesting case.

**An expected timeout is a recordable result.** That is the mechanism by which the never-settling
image-download branch at `[B lib/controllers/files.js:98-100]` is captured without hanging the
harness — and it is what makes the approved deviation in [§7.1](#71-deviation-1--the-never-settling-file-response)
evidenced as a change **from a timeout to a 200** rather than as a failure. A companion case,
`error-edge.asset-from-url.transport-refused`, is also an expected timeout and is **not** a deviation:
that route is left unsettled in the delivered tree too, so its timeout is preserved behaviour.

### 2.5 The isolation architecture — interception at the module boundary

A corpus that depends on the network is not reproducible, so **no external effect is reached over the
network**. Every one is intercepted at the **module boundary**, in fixtures the launcher preloads
**before** the application (**read**: `test/parity/fixtures/`):

| Fixture | What it replaces |
|---|---|
| `fixtures/aws.js` | The S3 client's `putObject`, `getObject`, `deleteObject` and `headObject`, with a filesystem-backed store rooted at a per-run temporary directory |
| `fixtures/mail.js` | `mailer.send`, capturing every call rather than delivering it |
| `fixtures/http.js` | The Google OAuth token and profile endpoints and the reCAPTCHA verify endpoint, with recorded responses covering **every** branch — including transport failure and malformed JSON |
| in-memory queues | Reached through the application's own `db.redis.enabled: false` path, so no Bull or Redis is involved |
| uploads | Rooted at a per-run temporary directory |

`fixtures/http.js` patches `globalThis.fetch` and an endpoint it holds **no recording for rejects**
rather than falling through to the network. That is a correctness property, not a convenience, and it
has one measured consequence the harness had to be built around: a driver built on global `fetch`
would have had **its own** requests to localhost rejected the moment the catalogue loaded, so
`capture.js` and `replay.js` drive through `node:http`/`node:https` and restore the patch in their own
process immediately. The copies that matter run in the **child**.

Two gaps in this arrangement are recorded rather than papered over, because both were closed by
working around a sibling artifact rather than by editing it:

- **The OAuth handlers guard on a configured Google client**, and the server overlay declares none, so
  without one both branches short-circuit and the OAuth quirk is unreachable. `capture.js` injects an
  obviously fake client as an explicit top `NODE_CONFIG` layer. The values are **not credentials**:
  the token and profile endpoints are intercepted, so nothing authenticates against anything.
- **`fixtures/http.js` asks that its `existing` OAuth identity be seeded as a user, and the seeder does
  not seed it.** The fixture's alignment call runs only inside the server process and its environment
  contract carries no identity variable, so neither artifact can be aligned from the other. Rather
  than edit a sibling artifact, the existing-user branch is reached as an ordered two-step sequence in
  which **step 1 takes the new-user branch, which creates the account precisely because of the quirk
  under test**, and step 2 then matches it. The gap is real and is recorded here; closing it in the
  seeder would make the sequence unnecessary but would not change what it captures.

One further reachability limit, measured rather than assumed: **reCAPTCHA's four HTTP-level outcomes
cannot be reached through a route at all.** Under `NODE_ENV=test` the verify helper short-circuits on
its `isTest` flag before any HTTP happens, and adding a secret to the overlay does not help because
the short-circuit is on the environment, not on the secret. They are exercised by direct module-level
invocation in the fixture harness instead, and no secret is added.

**Redirects are not followed.** A `Location` header is part of the surface under comparison, and
following it would replace the measurement with its consequence. Note that both redirect mechanisms
appear in the corpus and they differ: the route parser builds **absolute** locations from the
configured url, while the 401 branch of the error extension emits a **relative** `/login`.

### 2.6 The server overlay, and why one was needed

`config/test.yaml` sets **`app.start: false`** (**read**: `[T config/test.yaml]`), so
`NODE_ENV=test node app.js` starts nothing. That is measured, not assumed, and it is why an external
overlay exists rather than an edit to committed configuration.

`test/parity/server-overlay.json` (**artifact**) supplies exactly what a listening, isolated,
reproducible server needs and nothing else: `app.start: true`, an explicit `127.0.0.1` host and port,
the isolated database, `db.redis.enabled: false`, a fixed non-production session secret, and an
`aws.buckets.exports` entry pointing at the filesystem-backed store. That last one is not a
convenience — committed configuration declares no `exports` bucket although the worker dereferences
its `name` and `host`, so without the overlay the export path is not exercisable at all. The gap
itself is recorded as an existing deployment requirement in `docs/preserved-quirks.md`;
`config/default.yaml` is not changed, because its bucket values are deployment-specific placeholders.

The overlay is passed as **`NODE_CONFIG`**, which is the whole point of its being a file rather than a
patch: it applies to **both worktrees** without editing either, so the baseline is measured with the
same configuration as the delivered tree and neither tree is modified to be measurable.

**It is run twice**, because the cookie contract has two configurations and only one of them exercises
the private-field patch's `SameSite` half:

1. **Non-secure** — `isSecure` unset, yielding Yar's `SameSite=Lax` and no `Secure`.
2. **Secure** — `--secure`, where the patch appends `"; SameSite=None; Secure"`
   (**read**: `[T app.js:254]`).

Each pass runs against its own freshly provisioned database and its own server, and each is reported
separately. **The honest limit of the second pass is stated in the gate's own source and is repeated
here**: the committed corpus definitions were built for the launcher's non-secure default, so there is
no recorded baseline for the secure pass. It therefore replays the **same** scenarios in the **same**
order — a subset would change the cross-request session state some responses embed, which was measured
— and asserts the **documented differential** on the cookie attributes: `Secure` becomes true on every
session cookie, `SameSite` moves `Lax` → `None` on the cookies the patch touched, and the `Expires`
horizon is unchanged. Every other field is compared exactly, because `isSecure` moves nothing else.
**That differential is a derived contract, not a measurement**, and capturing a secure-pass corpus and
passing `--secure-corpus <path>` replaces it with an exact comparison.

### 2.7 Database provisioning

Nothing in the repository at baseline starts MongoDB; the suite simply connected to localhost. The
mechanism selected is **`mongodb-memory-server`, pinned to the exact version `11.2.0`**
(**read**: `[T package.json:devDependencies]`), because it is the only option that works under the
user's own stated sequence — `git clean -xfd && npm ci && npm test` — on a host with no Docker.

`test/parity/mongo.js` starts it, generates a **per-run isolated database name**, publishes the
connection string into `NODE_CONFIG` **before `config` is first loaded**, and stops it on exit, on
failure and on `SIGINT`/`SIGTERM`. The `test` script is `node test/parity/mongo.js -- mocha`
(**read**: `[T package.json:scripts]`), so the user's `npm test` is unchanged; the bare `--` is a
fixed interface that script depends on. The same module backs the corpus and worker harnesses, so the
suite and the parity tooling provision their databases the same way.

One environment note, observed in this delivery and recorded because it changes nothing but looks
alarming: where a host already carries a `mongod` binary and `MONGOMS_SYSTEM_BINARY` points at it,
`mongodb-memory-server` reports a version conflict between the system binary and the version it would
otherwise download, and proceeds with the system binary.

### 2.8 Capture status — the honest position

**The corpus has not been captured.** This is the largest single gap in the parity evidence and it is
stated first rather than buried.

**Measured** (`node test/parity/replay.js --app . --corpus test/parity/corpus.json` → **exit 2**):

> the corpus at `test/parity/corpus.json` carries NO recorded baseline: 382 drivable scenario(s) and
> not one recorded response (its own summary says `captured: false`, `baselinesPending: 383`).

All 383 scenarios are **definitions**: each carries `baseline: null` and each step carries
`response: null`, and `summary.captured` is `false` (**artifact**). The definitions are the authored,
reviewable part — route, identity, `Accept` mode, intent, payload, fixture profile and step order are
design decisions — and they are emitted by `capture.js`'s own builder, so the two artifacts cannot
disagree about the schema. What is absent is the measurement.

The gate behaves correctly about it, which is the one reassuring fact here: `replay.js` validates the
corpus **before** it launches anything and refuses to proceed, on its own stated grounds that
*an invented status would make the parity gate pass against a fiction*. It does not drive a server it
has nothing to compare against, and it names the remedy:

```console
$ node test/parity/capture.js --app <worktree at 2f8712a> --out <corpus> --expect-baseline
$ node test/parity/replay.js  --app . --corpus <corpus> --annotations test/parity/corpus.json
```

The `--annotations` flag is not optional in practice. A capture **replaces the scenario array
wholesale** and `capture.js`'s builder emits neither `expectedDeviation` nor `unreachableReason`, so a
captured corpus arrives **without the one marker that distinguishes an approved change from a
regression**. Rather than defaulting to a marker source — which would make the deviation control
vacuous — the flag joins the markers back on by scenario id and the report says which source supplied
each one. With no `--annotations`, a missing marker makes the difference **fail**.

#### The measured single-pass blocker

A capture of all 383 scenarios in **one** pass does not complete at `2f8712a`, and the cause is in the
application rather than in the tooling (**measured**, recorded in the corpus's own notes and
independently corroborated below).

Route `POST /api/admin/user/{userId}` reaches `admin.updateUser`, whose `User.findById` callback does
`if (err) return request.fail(err)` at `[B lib/controllers/admin.js:158-160]`; `request.fail` hands
the `Error` to `h.response` at `[B lib/util/routeParser.js:510]`; hapi asserts *"Cannot wrap an
error"*; and the resulting **uncaught async exception exits the process**. Measured three times,
including with that one scenario driven alone against a fresh database and a fresh server, where it
records `ECONNRESET` in under 20 ms. Every case driven after it records a transport failure that means
nothing.

Independent corroboration from a tool that *did* complete: the joi matrix recorded **7 application
crashes and 7 restarts** across its 462 drives (**artifact**: `joi-baseline.json`, `summary`), which
is the same failure mode reached from a different direction and is why that tool carries restart
logic at all.

The operational consequences are part of the method and are recorded so a later capture does not
discover them again:

- Capture in **coherent segments** and record that scenario **on its own**.
- Do **not** commit post-crash transport failures as baselines.
- Do **not** merge passes that ran on different **ports** — absolute `Location` values embed the port.
- Do **not** merge passes that ran against differently mutated **databases**; this was measured to lose
  the seeded user session and turn the authenticated `/login` 500 into a 200, which would have
  silently erased one of the preserved quirks.


---

## 3. Coverage accounting

This is R-b's proof. A gate that passes while some routes were never exercised proves nothing, so
coverage is not a report alongside the gate — it **is** part of it.

### 3.1 The route surface, re-derived from the delivered manifest

Every figure below was **re-derived from the `entries` array** of the generated manifest, not read from
its own summary block, so the summary and the entries corroborate each other rather than one restating
the other (**measured**: `node test/parity/manifest.js --out /tmp/target-manifest.json`, then a
reduction over `entries`).

| Measure | Value |
|---|---|
| **Registered routes** | **233** |
| By method | GET **137** · POST **63** · PUT **19** · DELETE **13** · PATCH **1** |
| Effective auth | **126** inherit the default (`{strategy: 'session', mode: 'try'}`, `[T app.js:310]`) · **105** declare `auth: 'session'` · **2** declare `auth: false` |
| Routes with pre-handlers | **161** (288 pre-handler entries in total) |
| Routes retaining `options.validate` after parsing | **0** |
| Routes with a **non-function** handler | **2** — the Inert directory routes, `GET /{path*}` and `GET /cache-prefix-{timestamp}/{assetType}/{path*}` |
| Routes carrying `options.handler` functions | **2** — `GET /about` and `GET /help` |
| Routes answering through the missing-controller fallback | **3** |
| Validation targets, pre-parse | **102** — payload **75** · query **26** · params **1**, across **97** routes |
| Routes with `ext: true` producing a `.json` duplicate | **0** |

The three fallback routes, named so their disposition is visible rather than aggregated away
(**measured**, from the manifest's `handlerKind`):

```text
GET  /api/trinkets/active   -> trinket.risingActive   (not defined)
GET  /api/trinkets/popular  -> trinket.mostActive     (not defined)
POST /api/interest          -> pages.interest         (not defined)
```

The **0** in the `options.validate` row is load-bearing rather than incidental: it proves that the
parser's `delete route.options.validate` executes for every route that declares a validate block, which
is the measurement behind the decision in [§6.6](#66-native-hapi-validation-is-unreachable-here). It is
also why the joi matrix cannot read its schemas from parsed routes — see the same entry.

### 3.2 The 233 reconciliation

The registered total is not the declaration count, and the arithmetic is checkable
(**measured**: `grep -c '^[[:space:]]*route[[:space:]]*:'` on each declaration module, then requiring
each module and reading its exported length):

| Contribution | Count | How it was counted |
|---|---|---|
| Literal `route :` declarations in `config/routes.js` | 62 | grep |
| Literal `route :` declarations in `config/api_routes.js` | 116 | grep |
| **Literal declarations** | **178** | 62 + 116 |
| Per-language expansion loop, `[B config/routes.js:550]` / `[T config/routes.js:551]` | **50** | `config/routes.js` exports 112 objects; 112 − 62 = 50 |
| **Objects the two modules export** | **228** | 178 + 50 — corroborated by requiring both modules: 112 + 116 = 228 |
| Static pages synthesized by `addStaticPages` | **2** | manifest |
| Static routes registered by `addStaticRoutes` | **3** | manifest |
| **Registered routes** | **233** | 228 + 2 + 3 |

So **178 + 50 = 228**, and **228 + 2 + 3 = 233**. No `.json` duplicate contributes: the `ext: true`
path produces **0** routes at this commit, measured in both trees.

### 3.3 The coverage gate

`replay.js` accounts every scenario against every entry in the 233-entry manifest, joined on the
manifest's own route key, and the accounting decides the run (**read**:
`test/parity/replay.js`, `accountCoverage` and `accountCoverageCheck`):

| Condition | Outcome |
|---|---|
| A manifest route with **no** scenario | **FAILS** the run, and the unrepresented keys are named |
| A scenario naming a route key the manifest does not carry | **FAILS** the run — the two artifacts are out of step |
| A route with a success-path scenario but **no failure-path** scenario | **Reported**, not failed — the corpus decides which routes have error edges worth driving ([§4.6](#46-failure-paths-run-beside-the-success-sweep)) |
| A route whose only scenario is marked unreachable | Listed with its stated reason, never silently omitted |
| A narrowed run (`--only`, or a single cookie pass) | Labelled **`gateQualifying: false`** in both artifacts and in the closing line, so a diagnostic cannot be mistaken for the gate |

There is no `--force`, no threshold that lets *N* differences through and no pass-with-warnings mode;
no option in the argument parser can turn a difference into a pass.

**Coverage of the committed definitions** (**artifact**: `corpus.json`, `coverage` and `summary`):

| Measure | Value |
|---|---|
| Manifest routes | **233** |
| Routes represented by at least one scenario | **233** |
| Routes **unrepresented** | **0** |
| Scenario route keys unknown to the manifest | **0** |
| Scenarios unreachable by design | **1** |

So **every one of the 233 routes is represented**, which satisfies the structural half of R-b's
requirement. The measurement half is outstanding until a capture is driven
([§2.8](#28-capture-status--the-honest-position)) — representation proves the corpus addresses every
route, not that every route was compared.

### 3.4 The unreachable list, with reasons

This file is where a genuinely undrivable entry is recorded. **No route is unreachable.** One
*scenario* is, and one further group of *outcomes* is:

| Entry | Kind | Stated reason |
|---|---|---|
| `auth.outcome.lookup-error` | Scenario | The fifth auth-scheme outcome, "Auth error" at `[T app.js:299-300]`, needs the `User` lookup **itself** to fail. No HTTP request can cause that — it takes a database fault injected below the model layer. It is listed with this reason rather than simulated, because anything drivable from here would reach a **different** branch and be captured as though it were this one |
| reCAPTCHA outcomes 3–6 | Outcomes, not routes | Unreachable over HTTP: under `NODE_ENV=test` the verify helper short-circuits on its `isTest` flag before any HTTP happens, so the 200, non-200, transport-failure and malformed-JSON branches cannot be reached through a route however the fixture is configured. Adding a secret does not help — the short-circuit is on the environment. Exercised by direct module-level invocation in the fixture harness instead |

Both entries are refusals to fake a measurement, which is the same discipline as
[§2.8](#28-capture-status--the-honest-position) applied at the level of a single case.

### 3.5 Aggregate counts are a summary, not the gate

**Swapping the auth mode between two routes leaves every figure in [§3.1](#31-the-route-surface-re-derived-from-the-delivered-manifest)
unchanged.** So do a controller rebinding between two routes of the same method, a success template
exchanged between two pages, and a pre-handler list moved from one route to another. Every one of
those is exactly the kind of regression this migration could plausibly introduce, and none is visible
in a total.

The manifest generator says so in its own artifact, at the head of the summary block it emits:

> SUMMARY, NOT THE GATE. Swapping auth between two routes leaves every figure here unchanged; the pass
> condition is the per-entry comparison performed by `--compare`.

**The pass condition is therefore an entry-by-entry comparison, keyed on method and path, with
effective auth compared per entry** — and with the controller binding, handler kind, pre-handler list,
pre-parse validation keys, success and fail templates, reply projection, cookie flag and route options
compared per entry alongside it.

**Measured in this delivery, and it passes.** The baseline manifest was generated by delivered-tree
tooling against the independently installed baseline worktree, and the two were compared:

```console
$ node test/parity/manifest.js --app /tmp/blitzy-c1/baseline-2f8712a \
    --out /tmp/baseline-manifest.json >/dev/null 2>/dev/null
$ node test/parity/manifest.js --out /tmp/target-manifest.json >/dev/null 2>/dev/null
$ node test/parity/manifest.js --compare /tmp/baseline-manifest.json /tmp/target-manifest.json
ROUTE MANIFEST COMPARISON
  baseline entries : 233
  target entries   : 233
  joined on        : method + path
  fields compared  : controller, handlerKind, auth, pre, validate, success, fail,
                     reply, cookie, ext, options

ENTRIES ONLY IN BASELINE (0)
  none
ENTRIES ONLY IN TARGET (0)
  none
ENTRIES WITH DIFFERING FIELDS (0)
  none

PASS - the HTTP surface is identical across all 233 entries
```

Both generation commands discard **both** streams explicitly. "No infrastructure" does not mean no
side effects: parsing the routes dynamically requires every controller, one of which creates the
exports queue at module load and prints on stdout, and a baseline tree additionally prints the AWS
SDK v2 end-of-support notice on stderr. Neither is suppressible from the tool, so the gate reads its
artifact from disk rather than from a stream it does not control.


---

## 4. Comparison rules and the volatile set

### 4.1 The principle: seeding beats scrubbing

Because seeding is **deterministic** — `test/parity/seed.js` creates its fixtures with fixed `_id`
values and pins every fixture date as a literal — comparison is **exact almost everywhere**. Every
field normalized away is a field the migration is no longer checked on, so the governing rule is the
one the gate's own source states:

> **Nothing is normalized away that could be compared exactly.**

That is why paths are materialized from seeds rather than from generated ids
([§2.3](#23-paths-are-materialized-and-mutations-run-last)), and why the volatile set is a closed list
written in one place rather than inline regexes scattered through the comparators: a reviewer must be
able to read the whole weakening on one screen, and an addition to it must show up as a visible diff.

### 4.2 The exactly-compared surface

Taken from the delivered comparator (**read**: `test/parity/replay.js`, the *WHAT IS COMPARED EXACTLY*
contract and the comparators derived from it):

| Surface | Compared |
|---|---|
| Status | Status code **and** status message |
| `content-type` | Exactly, less its `charset` parameter |
| `Location` | Exactly |
| `Content-Disposition` | Exactly |
| `Cache-Control`, `Pragma`, `Expires`, `X-Frame-Options` | Exactly, and **per branch as measured** — see the note below |
| Every remaining response header | Exactly, unless a named volatile-set rule removes it |
| `Set-Cookie` | **Every attribute**: name, `HttpOnly`, `Secure`, `SameSite`, `Path`, `Domain`, `Max-Age`, and the **presence and approximate one-year horizon of `Expires`** |
| HTML bodies | Rendered text; form and input names **and values**; `id` and `class` attributes; `data-` and ARIA attributes; inline-script presence; `href` and `src` values — asset URLs are part of the preserved surface, so they are **compared, not stripped** |
| JSON bodies | Structurally, so key order cannot create a false difference, with every scalar compared exactly **and by type**, and a missing key reported as a difference |
| Binary and stream bodies | Length **and** content digest |

**The four error-page headers are compared per branch as measured, not as the code's shape suggests.**
The first `onPreResponse` extension **returns early** on 401, 404, 403 and any status ≥ 500 for a
browser HTML request — *before* the `Cache-Control` / `Pragma` / `Expires` / `X-Frame-Options`
assignments (**read**: `[T app.js:177-226]`). So those four reach **API-or-JSON error responses and
non-Boom responses only**, and **not** the rendered HTML error pages, while a 400 Boom falls through
and **does** receive them. R-e forced that correction: asserting them uniformly would have been
asserting something the baseline does not do. `X-Frame-Options: deny` additionally applies only to the
five configured paths.

### 4.3 Why the cookie `Expires` assertion exists

A reviewer will otherwise read it as excessive, so the reason is recorded here.

The second `onPreResponse` extension reaches into hapi's **private state**: it wraps
`request.response._header` and appends `"; Expires=" + <one year out>`, plus
`"; SameSite=None; Secure"` in secure mode (**read**: `[T app.js:228-266]`; baseline
`[B app.js:204-240]`). It runs **only while `request.response._header` is a function**
(`[T app.js:232]`).

**If hapi 21 stopped populating that private field, the patch becomes a silent no-op**: cookie expiry
would quietly change, nothing would throw, no status would move, and no test that checks a cookie's
*presence* would notice. AAP §0.9.6 lists this as an open item precisely because its failure mode is
**silence**.

Comparing the `Expires` **horizon in whole days** — the absolute timestamp is volatile, the horizon is
not — is **the only way that no-op is detectable**. It is asserted in both cookie passes
([§2.6](#26-the-server-overlay-and-why-one-was-needed)).

### 4.4 The volatile set: six categories, taken from the code

The volatile set was read from the delivered implementation rather than from a specification, and it
**matches**: six categories, in this declaration order (**measured**: enumerating the frozen
`VOLATILE_SET` entries in `test/parity/replay.js` and comparing the count against the file's own
`VOLATILE_CATEGORY_COUNT`, which is `6` — they agree).

| # | Category | Why seeding could not make it deterministic | What coverage is lost |
|---|---|---|---|
| 1 | **Generated identifiers** not covered by fixed seeds | A document created **during** the run gets a real ObjectId and a share or invitation token gets a fresh signature; the value is minted by the code under test | Only that two runs minted the same id, which is not behaviour. Every id a scenario **reads** is pinned by the seeder and compared exactly, and the **shape** is still compared — a 24-hex id that stopped being emitted, or appeared where none was before, still differs |
| 2 | **Timestamps**, including the rendered cache prefix and recorded timing | Three clock reads: a document written during the run; the asset-URL cache prefix, which the string helper inlines at **render** time rather than reading from configuration, so no overlay or fixture can pin it; and the static handler's `Last-Modified`, which is the file's checkout mtime and so cannot agree across two independently created worktrees | The exact instant a value was produced. The cache-prefix **literal** and the rest of every asset URL are still compared exactly, `Last-Modified` is compared for **presence**, and archive contents are asserted by opening the archive in the storage and worker gates rather than by hashing it |
| 3 | **The `Date` response header** | Node writes the current instant into every response, below the application | Nothing the application decides |
| 4 | **The `ETag` response header** | A validator over a representation rather than part of it; the static handler derives it from a build artifact across two independent installs | The validator value. The body it validates is compared in full |
| 5 | **Per-request correlation identifiers** | A correlation id that repeated would not be one | Nothing measured — this application emits no such header at baseline, so the category is a **declared guard** rather than an active weakening. It is enumerated anyway so that a header appearing silently under the new framework is normalized by a named rule instead of reported as a difference nobody can act on |
| 6 | **Cookie values, and only the values** | A session cookie's value is a server-side session id minted per session; `maxCookieSize` is `0`, so session state lives on the server and a pinned value would be a forged session rather than a fixture | Nothing that could be compared. **Every attribute is still compared exactly**, and `Expires` is asserted for presence and horizon ([§4.3](#43-why-the-cookie-expires-assertion-exists)) |

Three measurements inside those categories are worth surfacing, because each one is a case where the
weakening is narrower than the category name suggests:

- **The rendered cache prefix.** Measured, **20 of 242 read-only responses** differed on this and on
  nothing else between two captures of the identical tree. Only the digits between `/cache-prefix-`
  and the following `/` are normalized; the prefix literal itself is configured and **is** compared.
- **The cookie `Expires` date.** Measured, **8 of 10 differences** between two captures of the
  identical tree. The rule is anchored on the attribute name so it can only fire inside a
  `Set-Cookie`, and the horizon is still compared in whole days.
- **Archive digests.** Measured, two captures of one tree produced two digests for the same **182-byte**
  zip and the same length both times, because a generated archive embeds each entry's modification
  time in fixed-width fields. So for zip, gzip and tar content types the **byte length is compared
  exactly** and the digest is demoted to an observation — and the archive's internal layout, object key
  and download url are asserted by `test/parity/storage.js` and `test/parity/worker.js`, which open the
  archive instead of hashing it.

One trap in category 3 is recorded in the comparator's own source and is repeated here because the two
things share a name: **the `Expires` response *header* is compared exactly** — the application sets it
to the literal `"0"` as one of its four cache headers — and so is the cookie `Expires` **attribute**,
through its own presence-and-horizon assertion. Category 3 covers the **`Date` header only**.

### 4.5 A difference is a failure, and the one exception

Under R-d a difference is a **failure even when the new behaviour looks better**. The sole exception is
a scenario carrying an `expectedDeviation` marker, and that marker is checked against what the
deviation was **approved to be** — so a deviation that did not materialize, or materialized
differently, still fails. Exactly one scenario in the committed corpus carries one
(**artifact**: `quirk.reply-chain.never-settles.image-download`, `approvedBy: "AAP 0.7"`,
`rule: "R-b"`), and it is the deviation in [§7.1](#71-deviation-1--the-never-settling-file-response).

#### This file is the declared home for justifying any addition to the volatile set

**An addition to the six categories is a weakening.** It has to be justified **here**, naming the
field, why seeding could not make it deterministic instead, and what coverage is lost — and the
comparator enforces the shape of that justification mechanically: it asserts its category count at
startup and requires every entry to carry a title, a reason, a seeding alternative and a statement of
lost coverage, so a seventh category added without them fails loudly and immediately.

**No addition was made.** The delivered set is the six categories above, which are the six the
specification names, and the enumeration in this section was taken from the code rather than from the
specification precisely so that a divergence would have shown up here. Where a delivered
normalization rule is narrower than its category — the cache-prefix pattern, the cookie `Expires`
anchor, the archive digest exemption — it is recorded above as part of category 1, 2 or 6 rather than
as a new category, which is the honest classification: each is a *timestamp*, a *cookie value* or a
*generated id* by nature, and none removes a field that seeding could have pinned.

### 4.6 Failure paths run beside the success sweep

**One minimal request per route exercises success paths only.** That is not a limitation to be worked
around; it is the reason a second source of cases exists. R-e is about the error mappings, and
preserving the three shared error funnels is **necessary but not sufficient** — the funnels are reached
from hundreds of local branches, each branch decides *which* funnel its error reaches, and some reach
none.

So the failure cases come from the **changed-error-edge checklist**, `docs/error-edge-inventory.md`,
which carries one row per changed error edge with its current disposition and its target status,
payload, side effects and timing. For each edge the corpus supplies a request that **reaches** it, and
the comparison asserts status, payload or redirect, side effects and timing. The committed definitions
carry a dedicated `error-edge.*` group of 9 scenarios alongside the 19 `failure`-intent and 3
`redirect`-intent cases distributed through the sweep.

Two dispositions are called out in that inventory because a mechanical conversion silently changes
them, and the corpus models both rather than collapsing them: **log-and-continue** branches must keep
continuing rather than become rejections, and **resolve-on-later-callback** branches must not be
collapsed into an earlier `await`, because the response they produce is whichever settles first.

Coverage of the two kinds is accounted **separately**, and a route with a success case but no failure
case is **reported rather than failed** ([§3.3](#33-the-coverage-gate)) — the corpus decides which
routes have error edges worth driving, and the report is what makes that decision visible.

### 4.7 All five auth-scheme outcomes are asserted independently

The auth scheme has five distinct outcomes (**read**: `[T app.js:268-305]`, baseline
`[B app.js:243-281]`), and they are asserted one by one rather than through a single
logged-in/logged-out pair. `mode: 'try'` at `[T app.js:310]` is why guest browsing works at all and
why 126 routes carry no explicit `auth`.

| Outcome | Condition | Response | Corpus |
|---|---|---|---|
| 1 | No `userId` in the session | `h.unauthenticated(Boom.unauthorized('Not logged in'), {credentials: {}})` — `[T app.js:276]` | `anonymous` identity, driven throughout the sweep and as a dedicated `auth-outcome` case |
| 2 | Session user whose record is **missing** | Session cleared, `'User not found'` — `[T app.js:287]` | `auth.outcome.user-not-found`, a **four-step** sequence: register a throwaway, authenticate, delete the record through the application's own route, then request |
| 3 | User is **`disabled`** | Session cleared, `'Account disabled'` — `[T app.js:292]` | The `disabled` seeded identity |
| 4 | Valid user | `h.authenticated({credentials: user})` — `[T app.js:297]` | The `user` and `admin` seeded identities, 138 scenarios between them |
| 5 | The lookup itself **errors** | `Boom.unauthorized('Auth error')` — `[T app.js:299-300]` | **Unreachable over HTTP** — listed with its reason in [§3.4](#34-the-unreachable-list-with-reasons) rather than simulated |

The session and cookie half of the same contract is bound to the cookie-attribute comparison in
[§4.2](#42-the-exactly-compared-surface) and the two overlay passes in
[§2.6](#26-the-server-overlay-and-why-one-was-needed). Three details of it break silently rather than
loudly and are therefore compared rather than assumed: `isSecure` defaults to **secure** and only an
explicit `false` disables it (`[T app.js:229]` — a truthiness check would have inverted the default),
`maxCookieSize: 0` is what forces server-side storage so any non-zero value changes the wire format,
and the private-field patch in [§4.3](#43-why-the-cookie-expires-assertion-exists).


---

## 5. The gate register, and what each gate proves

One line per gate, with its measured status in this delivery. A gate marked **not run** is not a gate
that failed; it is one whose evidence does not yet exist, and it appears again in
[§8](#8-what-remains-unproven) with what would settle it.

| Gate | What it proves | Status |
|---|---|---|
| **Route manifest, per entry** | The HTTP surface survived — method, path, controller binding, handler kind, effective auth, pre-handlers, pre-parse validation keys, templates, reply projection, cookie flag and options, compared entry by entry. **The primary parity gate** | **PASS** (**measured**, [§3.5](#35-aggregate-counts-are-a-summary-not-the-gate)) |
| **Route-table CLI** | The `optimist` replacement preserved all **three** invocation forms, since the module self-executes unconditionally and so bare execution also emits the table | **PASS** (**measured**, below) |
| **Request corpus replay** | Identical normalized responses across the full route inventory | **not run** — the corpus carries no recorded baseline ([§2.8](#28-capture-status--the-honest-position)) |
| **joi matrix, 102 targets** | Accept/reject/coercion outcomes identical across the `joi` bump, response shapes included | **baseline captured**, target side **not run** ([§6.6](#66-native-hapi-validation-is-unreachable-here)) |
| **Storage and archive contract** | The S3 key is a content hash, so a changed digest silently orphans every stored object; the cases assert the exact sha1 key, the suffix and extension branches, the content-type override, avatar gating, bucket selection, the export key and the archive's internal layout | **not run** |
| **Export worker** | Bull 4's changed semantics — processor promise completion, `job.id` in the `failed` handler, `job.remove()` on `completed`, retry and stalled behaviour — plus status and error persistence, the archive layout, the notification mail and cleanup on both paths | **not run** |
| **Existing suite** | The 124 baseline assertions unweakened, plus the 6 new page-surface cases | **90 passing / 39 failing** (**measured**, [§6.2](#62-npm-test-had-no-green-baseline)) |
| **Zero deprecation warnings** | The whole running application, not a subset, under `--pending-deprecation --trace-deprecation` | **1 residual** (**measured**, [§6.11](#611-zero-deprecation-warnings-across-the-entire-running-application)) |
| **Audit** | Zero critical and zero high findings | **0 critical / 1 high / 5 moderate** — one named deviation ([§7.2](#72-deviation-2--the-marked-fork-is-retained)) |

**The route-table CLI check, measured on both trees.** The route parser's module body self-executes
unconditionally, so bare execution emits the table as well as `-R` and its `--routes` alias; an argv
check that tested only for `-R` would silently have changed two of the three. All three were captured
from each tree and compared:

```console
$ node test/parity/manifest.js --cli-table --app /tmp/blitzy-c1/baseline-2f8712a \
    --out /tmp/baseline-cli-table.json >/dev/null 2>/dev/null
route-table CLI: 3 invocation form(s) captured from /tmp/blitzy-c1/baseline-2f8712a
  dash-R:      22209 bytes, 112 data row(s), 1 preamble line(s)
  long-routes: 22209 bytes, 112 data row(s), 1 preamble line(s)
  bare:        22209 bytes, 112 data row(s), 1 preamble line(s)
  all forms byte-identical
```

The delivered tree produced the same three captures, byte for byte — **22 209 bytes and 112 data rows
in every form, in both trees**. The single preamble line is the in-memory-queue notice a controller
prints at module load, which is why it is recorded as a preamble rather than treated as table output.

This is a **supporting** check and not the primary gate, for a reason worth recording: the CLI parses
`config/routes.js` only, so the 116 API routes and the 5 synthesized routes are absent from its 112
rows, and its columns carry no auth at all. It cannot see most of the surface. It is valuable for
exactly one thing — proving the CLI's own output did not move — and the tool's artifact says so in its
own note.

### 5.1 Each PRESERVE clause bound to the gate that proves it

An intention is not evidence, so each clause names a gate rather than a promise. The status column is
the same status as in the register above, repeated so the binding can be read without cross-checking.

| PRESERVE clause | Bound to | Status |
|---|---|---|
| **The HTTP surface** — route paths, methods, per-route auth | The per-entry route manifest comparison, [§3.5](#35-aggregate-counts-are-a-summary-not-the-gate) | **PASS**, measured |
| **Validation accept/reject outcomes** | The joi matrix over all 102 targets, three cases each, response shapes included | Baseline captured; target comparison outstanding |
| **Session and auth behaviour**, same cookie names and outcomes | The five independent auth-outcome assertions, [§4.7](#47-all-five-auth-scheme-outcomes-are-asserted-independently), and the full `Set-Cookie` attribute comparison in both overlay passes, [§4.2](#42-the-exactly-compared-surface) / [§2.6](#26-the-server-overlay-and-why-one-was-needed) | Outcome 5 unreachable by design and listed; the rest await the capture |
| **Client-visible page behaviour and asset URLs** | The HTML comparison in [§4.2](#42-the-exactly-compared-surface) — rendered text, form and input names and values, `id`/`class`, `data-`/ARIA, inline-script presence and `href`/`src`, with asset URLs compared rather than stripped and only the cache-prefix digits normalized | Awaits the capture |
| **Persisted data and file formats** | `test/parity/storage.js` and `test/parity/worker.js`, which assert the exact sha1 object key against pre-migration objects rather than freshly written ones — the only way a changed digest surfaces as a lookup failure instead of passing | **not run** |
| **Existing assertions** | The suite gate, which permits a reviewed **stub-syntax** change and bars an **assertion** change, [§6.2](#62-npm-test-had-no-green-baseline) | Assertion expressions unchanged; the run is not green |
| **Error-to-response mappings** (R-e) | `docs/error-edge-inventory.md` plus the failure-path cases in [§4.6](#46-failure-paths-run-beside-the-success-sweep) | Inventory generated from the baseline tree; the failure-path comparison awaits the capture |

The distinction in the "existing assertions" row is the one the gate is worded around, and it is worth
being exact about: **every assertion expression, its expected value and the passing count are the
protected thing**, not the textual identity of every `it()` body. Three legacy three-argument
`sinon.stub` calls had to become `.callsFake()`, and one of them sits inside a test body. A
stub-syntax change is permitted and is recorded in the diff with its reason; an assertion change is
not. **Measured**: the diff of `test/lib/models/trinket.js` against the baseline is three hunks, all
of them stub syntax — two `sinon.stub(obj, 'm', fn)` → `sinon.stub(obj, 'm').callsFake(fn)` and one
`reset()` → `resetHistory()` pair — with **no assertion expression touched**.


---

## 6. The R-f resolution log

One entry per ambiguity: what was ambiguous, the **measurement** that settled it, and the
**resolution** adopted. No entry says only "resolved". The log is a record of what happened, so the
last six entries are ambiguities the plan did not anticipate and that surfaced during the work.

### 6.1 "Callback-era hapi version" against a manifest already declaring hapi 20

**Ambiguous.** The request describes a 2013-era platform and asks to upgrade hapi "from its
callback-era version", which does not match what the repository declares.

**Measured.** The committed lockfile resolves `@hapi/hapi` **20.3.0**, and the bootstrap is written
**entirely against the hapi 17+ API** — `await server.register([...])` with plugin objects, an
extension returning `h.continue`, an `async (request, h)` error mapper, and an auth scheme using
`h.authenticated` / `h.unauthenticated`. What is genuinely callback-era is the **handler surface**:
145 routed handlers written as `function (request, reply)` that signal out of band and return
`undefined`, kept working by a compatibility layer in the route parser that substituted a deferred
value whenever a handler returned nothing.

**Resolution.** **The symptom is accurate and the version is approximate** — the repository was
half-migrated. Effort was reallocated from a framework rewrite to the **154 hapi-invoked functions**
(145 routed handlers + 8 routed pre-handlers + 1 inline), which is where the callback idiom actually
lived. The objective did not change; only the location of the work did. Under R-f the baseline governs,
so the plan was written against what the code does rather than against how it was described.

### 6.2 `npm test` had no green baseline

**Ambiguous.** The request asks for the "existing suite 100% with assertions unweakened", which
presupposes a suite that runs.

**Measured.** At `2f8712a` the suite **dies during file collection, before a single `it()` runs**.
Mocha 3.5.3's own file lookup was executed: **25 files, sorted, with all seven `test/helpers/*.js`
collected as spec files at positions 1–7 and `test/setup.js` last at position 25**. Seven defects stack
on that ordering:

| # | Defect | Consequence |
|---|---|---|
| 1 | `test/helpers/catbox-redis.js` requires the unscoped `catbox-redis`, which is neither declared nor installed | As collected file #1 it **aborts the whole run** |
| 2 | `mongoose-schema-extend`'s transitive Proxy polyfill **replaces the global `Object.getPrototypeOf`**, after which requiring hapi throws `AssertError: Schema can only contain plain objects` | Any file reaching the database helper before hapi kills the run. **The version bump does not fix it** — 21.4.10 fails identically to 20.3.0 |
| 3 | The same ordering breaks the **export worker in production**: it loads `config/db` before `config/app.config`, so `require('./lib/workers/exports')` throws | A module that cannot be required at all |
| 4 | The Supertest agent is built from `undefined`: the flow helper calls `server(app.listener)` at require time, but `app.js` exports a **Promise** | `agent.get('/')` throws `TypeError: Cannot read properties of undefined (reading 'address')` — breaks **69 of the 124** cases |
| 5 | `NODE_ENV` is set from the **last** collected file, so every module had already loaded under `development` and `config/test.yaml` never applied | The wrong configuration for the entire run |
| 6 | A queue helper calls a queue getter that is not exported — the configured Bull queue list contains only `exports` | Throws on load; and no test ever called it |
| 7 | `sinon` 1.7.3 has no `.callsFake`, which the store helper calls four times | Breaks the 7 cases in the forgot-password suite |

**Resolution.** Repaired as **precondition** work, with the **124 assertions untouched**: the two dead
helpers deleted rather than patched (neither mocked anything the application uses, and no test called
the queue helper), the environment moved into a `--require` preload, readiness moved into a
first-collected spec, the spec glob narrowed so helpers are no longer collected as specs, the flow
helper's agent made lazy, and `sinon` moved to a maintained line with three legacy stub calls
converted. `test/setup.js` was reduced to an inert signpost recording why its content moved.

**And the honest outcome, measured in this delivery.** `CI=true npm test` → **90 passing, 39 failing**.
The gate's target is 130 registered and passing — 124 baseline cases across 17 spec files plus **six**
new cases in `test/lib/api/pages.js`, which required `'pages'` to be inserted into the fixed `sequence`
array in `test/lib/api/index.js` without which a new file in that directory is never invoked
(**measured**: 124 `it(` across the baseline's 17 files under `test/lib`; 130 across the delivered
tree's). **The gate is not met.** Attribution, measured with `git diff 2f8712a HEAD -- <path>` per
file:

- **4 failures are demonstrably not attributable to this migration.** `test/lib/models/trinket.js`
  spies on `findByIdAndUpdate(id, update, options, cb)` and invokes `cb`, but
  `lib/models/trinket.js` calls it with **three** arguments and a `.then()`. That model file is
  **unchanged** from baseline, and the spec's only change is the three stub-syntax hunks in
  [§5.1](#51-each-preserve-clause-bound-to-the-gate-that-proves-it). The test cannot pass against
  baseline application code either.
- **6 further failures are in the same class.** The roles-plugin suite, its subject
  (`lib/models/plugins/roles.js`) and the defaults helper are **all unchanged** from baseline.
- **The remaining failures cannot be cleanly attributed**, and this is the important admission. Their
  specs are unchanged but their controllers were converted, so the difference could be either. One is
  diagnostic: the course-page case asserts the served HTML contains a course name, while the page is an
  AngularJS template that emits `{{ course.name }}` — an assertion that could not pass against this
  template in either tree. Others depend on unconfigured external integrations (mail, S3) in this
  environment.
- **The root of the ambiguity is that there is no baseline pass count to attribute against.** The
  suite never ran at `2f8712a`, so the 124 cases were never *green* — they were never *executed*. The
  planned order would have produced that number before any conversion; the delivered order did not
  ([§1.5](#15-the-execution-order-consequence-and-the-order-actually-delivered)).

**The mechanism that would settle it is the corpus, not the suite** — which is precisely why the corpus
exists, and precisely why its absence ([§2.8](#28-capture-status--the-honest-position)) is the largest
gap in this evidence. Carried into [§8](#8-what-remains-unproven) as an open item rather than
presented as a pass.

### 6.3 No database provisioning

**Ambiguous.** The request's own command sequence is `git clean -xfd && npm ci && npm test`, and it
does not say what provides the database.

**Measured.** Nothing in the repository starts MongoDB. The suite simply connects to
`localhost:27017` through `config/test.yaml`, so on a host without a running instance every
database-backed case fails for a reason unrelated to the migration.

**Resolution.** `mongodb-memory-server`, added as a devDependency at an **exact** pin, wrapped by the
`test` script so the user's `npm test` is unchanged
([§2.7](#27-database-provisioning)). It was selected over a container because it is the only option
that works under the user's own stated sequence on a host with no Docker. The same module backs the
corpus and worker harnesses.

### 6.4 A clean tree cannot boot

**Ambiguous.** The request begins with `git clean -xfd`, and the consequence of that on this
repository is not obvious.

**Measured.** `git clean -xfd` deletes `config/local.yaml`, which is gitignored and is the **only**
source of a session-cookie password; `config/default.yaml` ships that password **empty**; and the
bootstrap calls `process.exit(1)` when it is shorter than 32 characters. A test-only secret does not
settle it either — a plain `node app.js` loads the development configuration and exits, and a
clean-built container has the same problem.

**Resolution.** One mechanism covering all three cases: **a development-and-test-only generated
default**. When the password is unset and the environment is not production, the bootstrap derives an
ephemeral secret and logs one line saying so; **the production fail-fast is retained and is evaluated
first**, so no production process can reach the fallback (**read**: `[T app.js:48-70]`). No production
secret is committed. `config/test.yaml` still carries a fixed test secret so session values are stable
across a capture-and-replay pair, and the container supplies a real secret through its runtime
environment. This is what makes a plain `node --pending-deprecation app.js` possible on a clean tree
at all, which the warning gate in [§6.11](#611-zero-deprecation-warnings-across-the-entire-running-application)
depends on.

### 6.5 The ready boundary could not be a Mocha preload

**Ambiguous.** The obvious repair for defect 4 above is to await the exported promise in a root
`before` hook registered from the environment preload.

**Measured.** **That is impossible.** Mocha 3.5.3 loads `--require` modules **before** it installs the
BDD globals, so inside such a module `typeof before === 'undefined'`. And CommonJS — retained by
decision, see [§6.8](#68-whether-the-framework-upgrade-forces-esm) — has no top-level `await`, so the
promise cannot be resolved at module scope either.

**Resolution.** A **three-file boundary**, each file documenting what it took over: `test/env.js`, the
preload, which sets the environment and registers **no** hooks and asserts that `before` is absent so
the ordering cannot silently regress; `test/lib/00-ready.js`, the **first** file the narrowed
`test/lib/**/*.js` glob collects — the `00-` prefix is an interface, because glob returns its matches
sorted and that is the whole reason its root hooks run first — which awaits the exported promise and
publishes the resolved server; and `test/lib/ready.js`, a one-property mutable holder the flow
helper reads lazily in `createRequest`. No existing spec's `require` changed.

### 6.6 Native hapi validation is unreachable here

**Ambiguous.** The request asks for `joi` on its current line, which reads like an invitation to adopt
hapi's native validation at the same time.

**Measured.** Three things, and they compound. hapi 21 **asserts** on an uncompiled plain-object
validation schema unless a validator has been registered, and `server.validator(` is never called
anywhere in this repository. The route parser executes `delete route.options.validate` for **every**
route, and after parsing `options.validate` survives on **0 of 233** routes — re-measured in this
delivery ([§3.1](#31-the-route-surface-re-derived-from-the-delivered-manifest)). And the behavioural
difference is decisive: the hand-rolled block validates `request[key]` for **arbitrary** keys, which is
a superset of hapi's payload/query/params/headers/state, and on failure it flashes into the session and
routes through the failure funnel — producing a **redirect or a rendered failure page**. A probe against
a real hapi 21.4.10 listener measured the preserved path returning **302** where native validation
returns **400**.

**Resolution.** **Bump `joi`, keep the hand-rolled path.** Both halves of the request are honoured and
they pull in different directions; the response-shape contract wins because it is observable
behaviour. Parity across all **102** targets is a gate rather than an inference, and it carries a trap
worth recording because it looks like a tooling bug later: **the matrix cannot read its schemas from
parsed route objects** — the parser deletes `validate`, so reading parsed routes yields **zero**
targets, measured in an attempt at exactly that shortcut. It therefore requires the declaration modules
directly and reads `config.validate` off a **pre-parse deep copy**, which is the same pre-parse source
the manifest generator uses. `structuredClone` will not do: route objects hold pre-handler **functions**
and joi **schemas**.

**Status.** The baseline side is captured at `joi` 17.13.3 — **artifact**: `joi-baseline.json` in
capture mode, 102 targets, 306 cases, 462 drives, 0 timed out. The target-side comparison at 18.2.5 is
outstanding and is carried into [§8](#8-what-remains-unproven).

### 6.7 The custom validation `language` maps

**Ambiguous.** Two route declarations carry a custom `language` map that keys a friendly username
message on the substring `"regular expression"`. Whether the `joi` bump would break them looked like a
regression risk.

**Measured.** They are **already inert, on both versions**. A regex failure produces
`"username" with value "9bad" fails to match the required pattern: /^[a-z][a-z0-9\-\_]*$/i`, which
contains **no such substring** — measured on **both** 17.13.3 and 18.2.5, and confirmed end to end by
driving the route and observing the raw joi message in the flash
(**artifact**: `joi-baseline.json`, `inertness`).

**Resolution.** **Preserved as inert.** The bump does not change that, and under R-d the inert mapping
is preserved rather than repaired. The consequence for the gate is worth stating in the other
direction: **if the friendly message ever appears, that is a failure**, not an improvement.

### 6.8 Whether the framework upgrade forces ESM

**Ambiguous.** The request keeps CommonJS "unless the framework upgrade strictly forces otherwise",
which required a measurement rather than a judgement.

**Measured.** Node 22.23.2 `require()`s ESM-only packages successfully, so nothing in the upgrade path
forces a module-system change.

**Resolution.** **CommonJS retained by choice, supported by evidence.** This is not a neutral
decision: it is what constrains the harness fix, because the absence of top-level `await` is one of the
two independent reasons the ready boundary cannot be a preload
([§6.5](#65-the-ready-boundary-could-not-be-a-mocha-preload)).

### 6.9 Whether Node-core callback conversions should be filtered by warning emission

**Ambiguous.** The request says Node-core callback APIs on the hapi-facing surface become promise
equivalents, and separately sets a zero-deprecation-warning bar. Reading the first through the second
would convert only the sites that warn.

**Measured.** Several do not warn at all on Node 22: `util.promisify(fs.writeFile)`, callback
`fs.stat`, callback `fs.unlink` and `fs.exists` each emit **nothing**. Filtering by warning emission
would therefore have left three callback `fs` sites **inside route handlers** unconverted.

**Resolution.** **Convert Node-core callbacks inside the hapi-facing surface regardless of whether
they warn**, on the request's own wording; an earlier reading that gated the conversion on warnings was
**wrong**. The conversions preserve timing and error handling rather than tidying them: the
fire-and-forget `fs.unlink` stays fire-and-forget with its error still swallowed, and the recursive
delete still **waits** before the response is returned, because baseline waits for its callback before
the final header resolves.

The complementary rule is the one that keeps the boundary somewhere: the `await` is created **at the
call site inside the converted handler**, not pushed into the utility. Four internal callback modules
therefore keep their callback interfaces, and that exclusion rests on the request's own two tests —
zero warnings **and** the existing suite passing unmodified. The first is measured and none of them
warns; **the second cannot be evidenced until the suite is green**, so the exclusion is provisional and
appears in [§8](#8-what-remains-unproven).

### 6.10 `server.inject` on the live request path

**Ambiguous.** Two controllers call `server.inject` to re-enter one of their own API routes. Whether
that is a deprecation problem or an architectural one was not obvious.

**Measured.** hapi's injection module emits **DEP0169** under injection, and injection is on the
**live request path** at both sites — so this is a handler-time warning that a boot check can never
reveal.

**Resolution.** **Extraction, not substitution.** Both re-entered routes carry their own JSON
negotiation, validation, pre-handler context, response projection and error mapping, so one handler
cannot simply call the other and borrow its contract. The shared logic is lifted into plain async
functions that each caller projects for itself.

**And the extraction surfaced a preserved quirk that a substitution would have silently fixed.** With
no query present, the folder handler builds its injected URL with an `&` where a `?` belongs, so
`folder` is never parsed as a query parameter and the filter **does not apply**; with a query present
the URL is well formed and it does. Both cases are measured, both are preserved, and the corpus drives
them as a two-step sequence. Passing the folder directly in both cases would have accidentally fixed
the queryless path, which R-d forbids.

### 6.11 "Zero deprecation warnings across the ENTIRE running application"

**Ambiguous.** The emphasis is the request's own, and during planning the claim could not be fully
measured: boot terminated at a Mongo selection error before any route served, so the captured warning
set was a **boot floor** — and the two `server.inject` sites in
[§6.10](#610-serverinject-on-the-live-request-path) prove handler-time warnings exist that boot never
reveals.

**Resolution.** The gate exercises the **listening server**, a full replay pass over all 233 routes,
and the standalone worker, under `--pending-deprecation --trace-deprecation`, with stderr captured for
each. Pass condition: **no warning or deprecation notice attributable to the application's own source
or to any dependency this migration retains.** The injection deprecation is **not** excluded — it was
remediation work.

**Measured in this delivery, on a listening server rather than a boot floor.** Both trees were booted
with `node --pending-deprecation --trace-deprecation app.js`:

| Tree | Distinct warning classes | Sources, traced |
|---|---|---|
| Baseline `2f8712a` | **4** | `[MONGOOSE]` strictQuery from `[B config/db.js:35]` · `[DEP0005] Buffer()` traced to `iconv-lite/lib/index.js:139`, reached through `nodemailer` 2.7.2 → `libmime` · `[DEP0169] url.parse` traced to `@mapbox/node-pre-gyp/lib/util/versioning.js:224`, reached through `bcrypt/bcrypt.js:5` · the AWS SDK v2 end-of-support `NOTE` |
| Delivered | **1** | `[DEP0005] Buffer()` traced to `compress-commons/lib/archivers/zip/constants.js:11`, at module load |

The delivered tree reached `Server started`, and the surface was then driven: **all 137 GET routes,
materialized from the manifest and requested unauthenticated. No new warning appeared during that
sweep** — the single class above is emitted once, at module load, and nothing handler-time joined it.
Sanity of the sweep: `/` 200, `/login` 200, `/signup` 200, `/about` 200, `/help` 200, `/python` 200,
`/api/trinkets` 401.

Three of the baseline's four classes are **cleared**, each by the change that was supposed to clear it:
`strictQuery` by the explicit setting in the database configuration, the `iconv-lite` `DEP0005` by the
`nodemailer` bump, and the `node-pre-gyp` `DEP0169` by the `bcrypt` bump. **The AWS notice is absent
from the delivered log entirely**, which settles an item AAP §0.9.6 listed as unproven — see
[§6.17](#617-the-aws-sdk-v2-notice-suppression-was-proven-not-deferred).

**The residual is a shortfall and is named as one.** `npm ls compress-commons` resolves it to
`archiver@2.1.1 → zip-stream@1.2.0 → compress-commons@1.2.2`, and `archiver` is **retained** — deferred
on the grounds that it carries no advisory of its own, which is true of advisories but not of warnings.
So the gate's stated pass condition ("or to any dependency this migration retains") is **not met**, and
the request's deferral rule is worded on the same point: a package is left in place when it is
"functioning correctly **and warning-free**". This is a **second measured shortfall against a stated
target**, alongside the audit deviation in [§7.2](#72-deviation-2--the-marked-fork-is-retained), and it
is recorded here and in [§8](#8-what-remains-unproven) rather than presented as a pass. What it is
**not** is application code or a route-time warning: it is one module-load line from one transitive
dependency of a deferred package, and the remedy is a decision about `archiver` rather than about this
migration's own surface.

**The residual limit of even this measurement**, stated so the number is not over-read: the sweep was
**GET-only and unauthenticated**, so POST/PUT/DELETE/PATCH handlers and every authenticated path were
not exercised. The full 233-route, five-identity pass belongs to the replay gate, which awaits the
capture.

### 6.12 Whether the `serverside/**` plane counts as "the application"

**Ambiguous.** R-b's prohibition on containers pinned to an old runtime does not say whether the
separate `serverside/**` execution plane is part of "the application".

**Measured.** **Nine of the repository's ten Dockerfiles carry an old Node runtime** — the root image,
four manager images, and four more that install Node **inside a non-Node base** (a pinned
`NODE_VERSION`, an nvm install, a second pinned `NODE_VERSION`, and a NodeSource setup script). Only
the nginx image does not.

**Resolution.** **Resolved by inclusion**, because the rule is unqualified and the request grants no
exemption. An earlier reading that narrowed "the application" to the root monolith and asked for
confirmation is **withdrawn**: a scope question left open is not something an implementing agent can
build from. All nine move to Node 22 and the four manager manifests are regenerated and validated
there. **Serverside application code is not converted** — those units carry no hapi surface, one
declares `"type": "module"`, and they are separately deployed — so the work there is runtime pinning,
dependency resolution and a boot check.

### 6.13 An eighth harness defect: the session cache never starts

**Newly discovered.** Not in the plan's list of seven, and the delivered tree records why: it was
**unreachable until the lazy Supertest agent made API requests possible in the first place**.

**Measured.** `config/test.yaml` sets `app.start: false`, so the bootstrap never calls
`server.start()` and hapi stays in its `stopped` phase. In hapi 17+ it is that **phase transition**,
not the listener, that starts catbox clients — initialization awaits `client.start()` for every
provisioned cache. The session store is such a cache. Left unstarted, every request that commits a
session fails inside the session plugin's own `onPreResponse` with `Error: Disconnected`, which hapi
maps to a **500**. Measured through `server.inject`, so with no Supertest involvement at all:
`POST /users` returns **500** without the fix and **302** to `/welcome` with it — the latter being what
the registration suite asserts.

**Resolution.** The readiness hook calls `server.initialize()`, which starts the caches **without
listening**, guarded on `server.info.started` because initialization throws unless the phase is
`stopped` and a configuration that *did* start the server must be left alone. Supertest still wraps the
non-listening listener and starts its own ephemeral one, so the arrangement the harness is written
against is unchanged. Recorded here because it is exactly the kind of defect the ordering in
[§1.5](#15-the-execution-order-consequence-and-the-order-actually-delivered) hides: fixing one defect
is what made the next one observable.

### 6.14 A single-pass capture does not complete

**Newly discovered.** Owned in full by [§2.8](#28-capture-status--the-honest-position), summarized here
so the log is complete: an admin route hands an `Error` to the response toolkit, hapi asserts "Cannot
wrap an error", and the uncaught async exception **exits the process** — measured three times,
including in isolation where it records `ECONNRESET` in under 20 ms, and independently corroborated by
the joi matrix's **7 crashes and 7 restarts** across 462 drives. **Resolution:** capture in coherent
segments, drive that scenario alone, never commit post-crash transport failures, and never merge passes
that ran on different ports or against differently mutated databases.

### 6.15 The delivered order differed from the planned order

**Newly discovered**, and recorded because R-f requires the record to describe what happened rather
than what was intended. **Measured** from `git log --oneline 2f8712a..HEAD`: conversions and shim
removal landed **before** the parity harness existed
([§1.5](#15-the-execution-order-consequence-and-the-order-actually-delivered)).

**Resolution.** The evidence is unaffected **where a baseline worktree was used**, which is why the
two-worktree architecture in [§1.2](#12-two-worktrees-each-independently-installed) is not a
convenience but the thing that rescues the measurement — the route manifest, the CLI tables, the joi
baseline and the error-edge inventory are all genuine baseline measurements taken that way. The
evidence **is** affected in two places, both recorded: the corpus was never captured
([§2.8](#28-capture-status--the-honest-position)), and the "assertions green before conversion"
reassurance was never available ([§6.2](#62-npm-test-had-no-green-baseline)).

### 6.16 A retained dependency emits a deprecation warning

**Newly discovered**, measured in this delivery and owned by
[§6.11](#611-zero-deprecation-warnings-across-the-entire-running-application). The short form: the
deferral rule permits leaving a package in place when it is functioning correctly **and warning-free**,
and the deferral record for `archiver` reasons about **advisories** — correctly concluding it has none —
without addressing **warnings**. Its transitive `compress-commons` calls the deprecated `Buffer()`
constructor at module load. **Resolution:** recorded as a named shortfall against the zero-warning
gate, with the remedy identified as a decision about `archiver` rather than a change to this
migration's own surface, and carried into [§8](#8-what-remains-unproven).

### 6.17 The AWS SDK v2 notice suppression was proven, not deferred

**Newly resolved.** The SDK v2 end-of-support banner prints on **stderr**, and the request permits
deferring a package only when it is warning-free — so leaving it would have contradicted both the gate
and the deferral rule, while migrating eight call sites to v3 is a storage-layer rewrite outside R-a.
The decision was to retain v2 and suppress the notice through the SDK's **own supported
configuration**, with a stated fallback of recording it as a single permitted stderr line matched
literally if the flag proved ineffective on 2.1693.0.

**Measured.** The fallback is **not needed**. The baseline boot prints the notice; the delivered boot
does **not**, and it is absent from the whole log including the 137-route sweep
([§6.11](#611-zero-deprecation-warnings-across-the-entire-running-application)). It also still prints
from a **baseline** tree when the manifest generator loads the controllers there, which is why both
generation commands discard stderr explicitly
([§3.5](#35-aggregate-counts-are-a-summary-not-the-gate)) — the suppression is a delivered-tree
setting, not a property of the environment.

**Resolution.** **Retain the SDK at v2 with the notice suppressed through its own configuration, and
close the open item rather than carry it.** AAP §0.9.6 listed the suppression as unproven with a
literal-match fallback held in reserve; the measurement above discharges it, so the fallback is
withdrawn and no permitted-stderr-line exception is recorded. The suppression changes no call site, no
request behaviour and no stored object, which is what keeps it inside R-a's dependency category, while
migrating the eight call sites to v3 is a storage-layer rewrite that remains deferred.

### 6.18 A fixture identity the seeder does not seed

**Newly discovered**, owned by [§2.5](#25-the-isolation-architecture--interception-at-the-module-boundary).
The short form: the HTTP fixture's seeding contract asks for an `existing` OAuth identity that the
seeder does not create, and neither artifact can be aligned from the other because the fixture's
alignment call runs only inside the server process. **Resolution:** reached as an ordered two-step
sequence in which the new-user branch creates the account first — using the quirk under test as the
mechanism — rather than by editing a sibling artifact. The gap is real, is recorded rather than closed,
and closing it in the seeder would make the sequence unnecessary without changing what it captures.


---

## 7. The two approved deviations

These are the **only** two places in the migration where something is deliberately **not** preserved or
**not** delivered as the request specified. Both are approved, both are argued, and neither is a
placeholder.

**Numbering follows `docs/preserved-quirks.md` §11**, which is the canonical statement of both.
Deviation 1 is owned in full there; deviation 2's full reasoning is owned by
`docs/deferred-dependencies.md` §4.2. **The three records are intended to be consistent, so a
divergence between them is a defect to fix rather than a variation to interpret.** What this file adds
is the third thing neither of them owns: **how each is evidenced by the parity method**.

### 7.1 Deviation 1 — the never-settling file response

`[B lib/controllers/files.js:98-100]` never settles: the image-download branch of `files.download`
calls `reply(stream).type(...).bytes(...)` with no `return` and no resolving call, so the request hangs
indefinitely. **R-d requires that the outcome be preserved. R-b requires that every route serve. Both
cannot hold.**

The decision is that **the target serves the stream response, and R-b controls** — the migrated branch
returns `h.response(stream).type(request.pre.file.mime).bytes(request.pre.file.size)` at
`[T lib/controllers/files.js:171-173]`, with `Content-Disposition` still omitted. Three reasons, which
are also precisely why the same reasoning does **not** transfer to
[§7.2](#72-deviation-2--the-marked-fork-is-retained): an unsettled request is **not a behaviour a
client can depend on** — it is the *absence* of a response, and R-d's protection is for clients that
may rely on observable behaviour; the intended response is **not inferred but present in the same
function**, since the sibling branch four lines below performs the identical chain ending in
`.header(...)` and returns a working stream response, so this is a reconstruction rather than a guess;
and **R-b is unqualified** about routes serving, whereas the `marked` conflict pits a prohibition
against a validation *target* — the opposite balance, resolved the opposite way.

**How the parity method evidences it.** The corpus records the baseline result as an **expected
timeout** and the target result as a **200 stream response**, so the replay diff reports an **approved
change** rather than a failure. The mechanism is the finite per-step budget in
[§2.4](#24-every-case-has-a-finite-timeout-and-an-expected-timeout-is-a-result), which lets a hang be
recorded instead of ending the run. Concretely (**artifact**): scenario
`quirk.reply-chain.never-settles.image-download` is the **only** scenario in the corpus carrying an
`expectedDeviation` marker, attributed to `AAP 0.7` and to rule `R-b`, with the baseline expectation
`timedOut: true`. Because a capture **drops** that marker, the marker must be joined back on with
`--annotations` or the difference **fails** — which is what keeps the deviation control from being
vacuous ([§2.8](#28-capture-status--the-honest-position)).

Two guards belong with it. The **four header-resolved chains** carry no marker and are expected to be
**identical** — they must not become collateral damage of this decision. And
`error-edge.asset-from-url.transport-refused` is **also** an expected timeout but is **not** a
deviation: that route is left unsettled in the delivered tree too, so its timeout is preserved
behaviour and a 200 there would be a failure.

### 7.2 Deviation 2 — the `marked` fork is retained

The private `marked` fork carries a **high** ReDoS advisory and cannot be bumped. It is **retained**, so
the migration delivers zero critical and exactly **one high** finding rather than the zero/zero the
request's audit gate states.

The precedence argument, in one paragraph: **R-d and the PRESERVE directive on client-visible page
behaviour are prohibitions, while the zero-critical/high audit result is a validation target. When a
prohibition and a target collide, the prohibition controls.** The justification for that ordering is a
comparison of what each failure costs. Violating the prohibition means authored course content
rendering differently for every user — silently, with no error and no signal — because upstream
`marked` 4 was tested against this repository's own configuration and its output differs in **heading
`id` attributes**, **task-list `<input disabled type="checkbox">` markup**, **`javascript:` links
reduced to bare text** and **mixed nested-list structure**, in addition to emitting a deprecation
notice on **every parse**. Missing the target means a documented, bounded risk that a reader can
locate, size and act on. A migration whose stated purpose is to change the runtime without changing
behaviour cannot rationally choose the first.

**The full reasoning, the exposure and the named follow-up are owned by
`docs/deferred-dependencies.md` §4.2 and are not duplicated here.**

**How it is evidenced.** By the audit record rather than by the corpus: `docs/deferred-dependencies.md`
§5 carries the measured figures — baseline **15 critical / 28 high / 16 moderate / 59 total** against
delivered **0 critical / 1 high / 5 moderate / 6 total** — with the single high **named** as `marked`
and attributed, and every remaining moderate attributed to a named package with its risk note. §6 of
that document states plainly that the request's stated gate was zero critical and zero high and that
**this delivery does not meet it**; the gate is not redefined and no exception is granted to the
delivery by the delivery. **Any *additional* critical or high finding is a failure**, not a deviation:
the tolerance is exactly one, attributed to exactly one package, and nothing else inherits it.

### 7.3 Why the two resolve in opposite directions

Read as a pair without their reasoning they look inconsistent — R-d loses once and wins once. They are
not, and the distinguishing fact is what is being protected in each case:

> **An absent response is not a behaviour a client can rely on. Rendered output is.**

R-d's protection exists for clients that may depend on observable behaviour. A request that never
settles produces no observable behaviour to depend on, so preserving it protects nobody while violating
R-b's unqualified requirement that routes serve. Authored course content rendering identically for
every reader is the opposite: it is observable, it is depended upon, and it is exactly what the
PRESERVE clause on client-visible page behaviour names. The asymmetry is a consequence of applying one
principle consistently, not of applying two.

### 7.4 A third shortfall, which is not a deviation

Recorded here so the set is not read as complete when it is not.
[§6.11](#611-zero-deprecation-warnings-across-the-entire-running-application) measured **one residual
deprecation warning**, from a transitive dependency of retained `archiver`, against a stated
zero-warning gate. It is **not** presented as a third approved deviation, because it was not argued and
approved in advance the way these two were — it is an **unresolved shortfall**, discovered by
measurement, with a named remedy and no decision yet recorded against it. It appears in
[§8](#8-what-remains-unproven) rather than here. Calling it a deviation would grant it a status it has
not earned.

---

## 8. What remains unproven

Recording this honestly is part of the deliverable. Everything the migration *decided* is decided;
what follows is **unproven rather than undecided**, and each row names the gate that settles it.

| Open item | Why it is unproven | Gate that settles it |
|---|---|---|
| **The request corpus** — identical normalized responses across the 233-route inventory | No capture has been driven; all 383 scenarios carry `baseline: null` and `summary.captured` is `false`. `replay.js` correctly refuses to run ([§2.8](#28-capture-status--the-honest-position)) | `capture.js --app <worktree at 2f8712a> --expect-baseline` in coherent segments around the measured crash, then `replay.js --annotations` — both cookie passes, `gateQualifying: true` |
| **The existing suite** | **Measured 90 passing / 39 failing** against a target of 130. Ten failures are demonstrably not attributable to the migration; the rest cannot be attributed because the suite never ran at baseline ([§6.2](#62-npm-test-had-no-green-baseline)) | `npm test` exiting 0 with 130 registered and passing and no assertion weakened — and, for attribution, the corpus above |
| **The residual deprecation warning** | Measured: one `[DEP0005]` at module load from `compress-commons` under retained `archiver` ([§6.11](#611-zero-deprecation-warnings-across-the-entire-running-application), [§6.16](#616-a-retained-dependency-emits-a-deprecation-warning)) | A recorded decision about `archiver` — bump, replace, or accept as a named deviation with its own precedence argument. Currently none of the three |
| **The full-route deprecation surface** | The sweep run here was **GET-only and unauthenticated** — 137 of 233 routes, one identity. Handler-time warnings on mutating and authenticated paths are unmeasured | A full `replay.js` pass under `--pending-deprecation --trace-deprecation`, plus the standalone worker |
| **The private-field cookie patch on hapi 21** | It mutates a private field and its failure mode is **silence** ([§4.3](#43-why-the-cookie-expires-assertion-exists)). The 137-route sweep did not assert cookie attributes | The cookie-attribute comparison in **both** overlay passes, including the presence and whole-day horizon of `Expires` |
| **The secure cookie pass** | No secure-pass baseline was captured, so the pass asserts a **derived differential** rather than comparing a measurement ([§2.6](#26-the-server-overlay-and-why-one-was-needed)) | A secure-pass capture and `--secure-corpus <path>`, which replaces the derivation with an exact comparison |
| **`joi` 18.2.5 parity across the 102 targets** | Only the **baseline** side is captured, at 17.13.3 ([§6.6](#66-native-hapi-validation-is-unreachable-here)) | The target-side matrix run and a non-zero exit on any difference |
| **`bull` 4, `adm-zip` 0.6 and `mime` 4 runtime semantics** | API-surface checks passed, but event payloads, job properties, retry behaviour and archive-read behaviour are not provable that way | `test/parity/worker.js` with one successful and one failing job; `test/parity/storage.js`; `mime` call-site parity |
| **Storage and archive parity of seeded content** | No existing test asserts either, and the archive library changed. The failure mode is invisible on freshly written data, because a write-then-read round trip passes under any digest | `test/parity/storage.js` against **pre-migration** objects, asserting the exact sha1 key |
| **The four internal callback modules** | Excluded from conversion on the **warning** test alone; the request's second test — the existing suite passing unmodified — cannot be evidenced until the suite is green ([§6.9](#69-whether-node-core-callback-conversions-should-be-filtered-by-warning-emission)) | The repaired suite passing with those four modules unmodified. Any module the suite implicates is converted, and the diff records which test forced it |
| **The nine Dockerfiles on Node 22** | Four install Node inside a non-Node base, and none was built in this session | An image build per Dockerfile plus a boot check per unit, with the root image's bundled npm asserted against `engines` at build time |
| **The four `serverside/*/manager` units on Node 22** | Manifests and lockfiles regenerated; the units were not booted here | Dependency resolution plus a boot check per unit |
| **`npm run build` from a clean tree, and inside a built image** | Not run in this session. The component bundle is gitignored and absent from a fresh checkout, so the build's input has to be fetched first | `npm ci && npm run build` exiting 0 with both CSS artifacts present — and both present inside a clean-built image and served over their routes |
| **The audit figure** | Cited from `docs/deferred-dependencies.md` §5 and attributed there, not re-measured in this session | `npm audit --omit=dev` on the delivered tree, re-run against the current advisory database |

Two things are worth saying about the shape of this table rather than its rows.

**The first row dominates the rest.** Most of the PRESERVE clauses in
[§5.1](#51-each-preserve-clause-bound-to-the-gate-that-proves-it) bind to the corpus, so capturing it
converts a majority of this table at once. The tooling, the definitions, the fixtures, the seeds, the
overlay and the coverage accounting are all delivered and inspectable; what is missing is a driven
measurement, and the exact command that produces it is in
[§2.8](#28-capture-status--the-honest-position) together with the operational constraints that a
first attempt will otherwise rediscover.

**What *is* proven is proven properly.** The primary parity gate — the HTTP surface, per entry, across
all 233 routes, against an independently installed baseline worktree — passes by measurement, not by
inference, and so does the route-table CLI check across all three of its invocation forms. Those are
the two claims in this delivery that rest on a comparison of two trees rather than on a reading of one.

---

## 9. Cross-references

This document owns the **method** and the **resolution log**. It deliberately does not restate what
these own, because a second copy of a fact is a second thing to keep in step:

| Document | Owns |
|---|---|
| `docs/preserved-quirks.md` | Every preserved 2013-era quirk, its measured outcome and its target disposition — and the canonical statement of both approved deviations |
| `docs/error-edge-inventory.md` | One row per changed error edge: source location, current disposition, and target status, payload, side effects and timing |
| `docs/dependency-inventory.md` | Every replaced or major-bumped package, as original → target → reason, with its final resolved version |
| `docs/deferred-dependencies.md` | The deferred-but-functional packages with per-package reasoning, the audit result, and the full argument for deviation 2 |
| `test/parity/corpus.json` | The machine-readable scenario definitions, their coverage table and their own notes |
| `test/parity/joi-baseline.json` + `.provenance.json` | The captured baseline validation outcomes for all 102 targets, and the tree they were measured on |
| `test/parity/replay.js` | The executable comparison contract — the volatile set, the comparators and the coverage gate |

Machine-readable artifacts are **referenced, not restated**: `corpus.json` and `joi-baseline.json` are
the record, and this file is its human-readable companion. Read a corpus together with its provenance
sidecar — a corpus without one does not say which tree it measured, and is not parity evidence.

One note, recorded rather than acted on: `mkdocs.yml`'s `nav:` lists only `index.md`, `setup.md` and
`overview.md`, so this document is not part of the rendered documentation site. Changing that
navigation is outside the scope of this work and **`mkdocs.yml` is not modified**.
