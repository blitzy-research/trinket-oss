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

Some entries are the exception and are labelled as such: §11 records the **approved deviations**, where
something is deliberately *not* preserved. There are **eight**, of which **two** are replay-visible —
deviation 1 on one scenario and deviation 7 on eight; §11.0 carries the count, the kinds and the reason
the register is nevertheless closed to tools, to preference and to improvement. §11.13 is the other side
of the same rule: three target-only changes that could have preserved baseline, and so were withdrawn or
corrected instead of registered.

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
embedded provenance       -> present, role baseline, analysed tree 2f8712a,
                             generator test/parity/capture.js blob 93266288728d
provenance sidecar        -> present (corpus.json.provenance.json), digests reconciled
expectedDeviation markers present -> 1  (quirk.reply-chain.never-settles.image-download)

quirk.* scenarios         -> 20, in exactly 7 scenario-ID families. These are ID
                             prefixes and NOT `scenario.group` values: the corpus
                             carries both fields, they are named differently, and
                             every citation in this document is to an id.
                               quirk.fallback.*            3
                               quirk.reply-chain.*         8
                               quirk.oauth.*               3
                               quirk.dead-301.*            2
                               quirk.authed-500.*          2
                               quirk.folders-trinkets.*    1
                               quirk.fail-redirect-leak.*  1
                             All 27 quirk.* tokens cited below resolve against the
                             artifact: 20 to a scenario id exactly, 7 to one of the
                             families above.

                             An earlier revision cited three strings in the places
                             sections 1, 2 and 5 cite ids -
                             quirk.missing-controller-fallback,
                             quirk.dead-pre-handler-301 and
                             quirk.authenticated-page-500 - and as ids none of them
                             resolves: 0 scenarios each, and 0 as an id prefix. They
                             are corrected to the families above.

                             What those three strings ARE is valid `scenario.group`
                             metadata, holding 3, 2 and 2 scenarios respectively and
                             emitted by the capture builders at
                             `[T test/parity/capture.js:2869]`, `:2915`, `:3454` and
                             `:3496`. An earlier revision of this block asserted they
                             existed in no artifact, which was wrong; what is true is
                             narrower and is the whole of the defect - they are group
                             values, and they were written where an id belongs.
                             All 392 scenarios carry a group, and the grouping is
                             finer than the id families for reply-chain: the groups
                             quirk.reply-chain.never-settles (1), .header-resolved
                             (4) and .builder-returned (3) all sit under the single
                             id family quirk.reply-chain.* (8). That is why the two
                             namespaces cannot be substituted for one another, and
                             why the enumeration is recorded here - so a citation is
                             checked against a list rather than against a memory
                             of one.
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

**One line of that block was re-measured and does not hold on this tree, and every gate claim below
depends on it, so it is corrected here rather than left standing.** The provenance is present and its
digests reconcile — `manifest.provenance.digest` reproduces both the embedded `payloadDigest` and the
sidecar's `artifactDigest` over the committed bytes (**probe**) — but it does **not verify**, because
the commit it names as its generator's is not an object in this repository:

```text
$ node test/parity/replay.js --corpus test/parity/corpus.json …
replay: the corpus … does not carry provenance this replay can rely on
  - generator-commit-resolves: the recorded generator commit 4dcdd761b4f1…
    is not a commit in this repository
  - generator-commit-contains-source: … does not hold test/parity/capture.js
    as the blob that produced this artifact
  - delivered-head-resolves: the recorded delivered head … is not a commit in
    this repository
$ git cat-file -e 4dcdd761b4f176d67d6402b15f4325bd73eb8c2b   # exit 1
$ git cat-file -e 93266288728d9a059fe3f95a2d1cd3ab6756f134   # exit 0 - the BLOB is here
```

So `replay.js` refuses the committed corpus outright and `capture.js --append` refuses it as a merge
parent, which is what the entries below mean by a campaign being blocked: the artifact's responses are
real measurements of the frozen tree, but the commit that would let this repository retrieve the tool
that took them is absent from its history, and both tools require that before adopting them. The
failure is independent of any scenario content — it reproduces against an untouched copy of the
committed bytes — and the tools state the remedy themselves: re-capture from a worktree at `2f8712a`
whose generators are committed, or replay with `--allow-unreviewed-corpus`, which is labelled
`gateQualifying: false`. Until that re-capture, a claim that a scenario is *compared between the trees*
is a claim about the campaign that produced the artifact rather than about a run reproducible here, and
the entries in [§10.18](#1018-post-apiexports-answers-500-after-saving-its-row-and-queueing-its-job)
onward name a probe as their evidence wherever that distinction matters.

**Which is also how the `verify:corpus` figures two paragraphs above should be read.** The 391 driven,
367 matching and 23 attributed differences were measured by a run against a tree whose generator commit
was retrievable; that commit is not in this repository's history, so the same command here stops at the
provenance check before driving anything. The figures are not withdrawn — they were measured — but they
are the record of that run rather than a result this tree reproduces, and the artifact's own
`corpus.json.provenance.json` is where the repair belongs.

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
- **R-b** — the application genuinely runs, with no route or module excluded. R-b is the controlling
  side of both response-behaviour conflicts in this catalogue, decided in §11.1 and §11.10. It is also
  the reason neither could be preserved: one leaves a request unanswered, the other exits the process.
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
| [9.7](#97-a-routed-handler-that-answers-500-where-its-author-intended-403) | `courses.download`'s unauthorized branch evaluates an unbound `Boom` | 500, not the 403 the expression names — but **unreachable over the route**, see §10.12 | Static read + a permissionless-identity probe; **no** route-level drive by an account the app creates |
| [9.8](#98-a-routed-handler-whose-metric-free-branch-answers-500-where-its-comment-intends-the-trinket-state) | `trinket.updateMetrics` executes one query twice on its metric-free branch | 500, not the trinket state the comment names | `PUT …/metrics` corpus scenario + a metric-free case still to be captured |
| [9.9](#99-two-routed-handlers-that-answer-200-carrying-the-name-of-a-missing-identifier) | `users.getExportStatus` and `users.downloadExport` evaluate an unbound `Boom`, and the finder re-invokes the throwing callback | **200** carrying `{"error":"Boom is not defined"}` | `error-edge.not-found.missingExport` + the route's success case |
| [9.10](#910-a-third-routed-handler-that-answers-500-where-its-author-intended-404) | `admin.addFeaturedCourse` evaluates an unbound `Boom` on both not-found branches | **500**, not the 404 the expressions name — measured identical on both trees | `route.post.api-admin-featured-course.json` + two error-edge rows |
| [9.11](#911-the-admin-controller-publishes-the-whole-user-document-bcrypt-hash-included) | The admin search page and the `grantRole` body serialize the whole `User` document — **the page half is now CLOSED**, `grantRole` is preserved | `grantRole`: 200 carrying `password` (a live `$2b$10$…` hash), any stored Google OAuth `token`/`refreshToken`, `_id`, `verified`, `source`, `roles[]`. The page: the same document **minus** credential material since QA `W002-I2-ADMIN-JSON-TAB-XSS` | Grant corpus scenario + §0.9.3's exact body comparison for `grantRole`; a re-driven reproduction for the page, which no scenario carries |
| [9.11.1](#9111-the-same-construct-outside-the-admin-controller--the-two-course-creation-responses) | The same construct outside the admin controller: **both course-creation responses** publish the acting user's whole `User` document | 200 carrying the caller's OWN `password` (a live `$2b$10$…` hash) plus `email`, `roles[]`, `_id`, `__v`, `verified` and `source` — on `POST /api/courses` and on `POST /courses` with a JSON `Accept`, for **any authenticated account**, body and key set measured identical on both trees. `POST /api/folders` does **not**: its sibling reduces `_owner` to its id | `route.post.api-courses.json` and `route.post.courses.json` + §0.9.3's exact body comparison |
| [9.12](#912-admin-user-search-is-exact-match-only-under-a-label-that-promises-three-fields) | Admin user search is exact-match only through `User.findByLogin` | A partial term answers **200 with zero results** for a user that exists, under a bare `No matches found for …` that does not distinguish absent from inexact, and with no `aria-live` | Admin-page corpus scenarios + the two A/B probes |
| [9.13](#913-two-more-routed-handlers-that-answer-500-where-their-author-intended-403) | `folders.deleteFolder` and `folders.update` evaluate the same unbound `Boom` | **500**, not the 403 the expression names; the denial itself holds — nothing is deleted or updated | Three-line diff; difference ledger; error-edge inventory |
| [10](#10-additional-measured-findings) | Findings beyond AAP §0.6.6 | In-memory queue events unreachable; inert test-mode mail guard; the test-mode template watcher's `chokidar` requirement, now a declared dependency again; the ZIP branch that terminated the process; the search-response seam; what `archiver` does and does not normalise | Worker harness; live probes; corpus digest; canonicaliser truth table |
| [10.4](#104-filessetthumbnail-authenticates-against-an-empty-committed-secret) | `files.setThumbnail` compares against an empty committed secret | Three outcomes; the **mutating** branch is unreachable while the secret is empty, so it fails closed | Route manifest + thumbnail corpus scenario |
| [10.5](#105-a-stored-file-is-downloadable-by-anyone-who-knows-its-id-or-its-content-hash) | File download has no owner or resource authorization | 200 with the bytes, for any identity, by id **or** content hash | Route manifest + 2 download corpus scenarios |
| [10.6](#106-serving-the-approved-image-response-served-script-capable-legacy-content-inline--closed-on-the-response-side) | The approved image response served script-capable legacy content inline. **The one entry here that is not preserved baseline behaviour — deviation 1 created it — and the one that is now CLOSED rather than documented** | Baseline served **nothing**. The target served 200 with the document's own `mime` and no CSP or `nosniff`, and the bytes **executed** on the application origin for an anonymous visitor — inline script, an `onerror` attribute with no script element, and active SVG alike. **Now closed on the response side**: the same 200, same type, same length and same absent `content-disposition`, plus `Content-Security-Policy: default-src 'none'; sandbox; frame-ancestors 'none'` and `X-Content-Type-Options: nosniff`, under which all three carriers are inert and the origin's storage is unreachable, while a benign legacy image still decodes and still embeds | Direct HTTP header assertions + a browser drive of all three carriers (§10.6); deviation 1's five contract fields unchanged, so the corpus scenario still passes |
| [10.7](#107-the-zipcode-branch-that-took-the-process-down-and-the-bounds-that-now-hold-it) | The `zipCode` branch that terminated the process, and the bounds that hold it | Bounded rejection replaces the process exit; the one field of the response that costs | `POST …/zip` + archive corpus |
| [10.8](#108-the-search-response-seam-the-client-reads-a-key-the-server-does-not-send) | The search response omits a key the client reads | Client reads an absent key; server shape unchanged | Search corpus |
| [10.9](#109-what-archiver-normalises-in-an-entry-name-and-what-it-passes-through) | What `archiver` normalises in an entry name, and what it passes through | Measured truth table the controller control matches, re-measured on the delivered 7.0.1 | Storage + worker gates |
| [10.10](#1010-the-four-outputfile-upload-routes-415-at-baseline-200-in-the-delivered-tree) | The four `output:'file'` upload routes refused `multipart/form-data` at baseline. **NOT preserved** — the delivered tree declares `multipart` and answers 200; see deviation 7 | Baseline **415** on all four, on hapi 20.3.0 and 21.4.10 alike; delivered **200**, `302` to `/login` anonymously, `400` on a non-conforming part | Route-sweep scenarios + the two per-major listener probes + the delivered-tree probes in §10.10 |
| [10.12](#1012-post-apiadminuseruserid-answers-nothing-at-all-when-the-payload-carries-no-roles) | `admin.updateUser`'s only conditional had no `else`, so a payload without `roles` was never answered — **the disposition is corrected in that section: the route now answers, as approved deviation 16 (§11.22)** | Baseline: **no response at all**, a 10 s client timeout on both trees with the process surviving, and a **process exit** for the payload-less shape (§10.11). Delivered: **200** `{"message":"roles required"}`, measured 68 bytes with no payload and 39 with `{}` | `route.post.api-admin-user-userId.json`, whose baseline step records a transport failure and whose marker is projected from the closed register |
| [10.13](#1013-bulk-csv-import-saturates-the-bcrypt-threadpool-and-blocks-the-event-loop) | Bulk CSV import runs every row's cost-10 bcrypt hash concurrently through `Promise.allSettled` | At 200 rows the concurrent canary p95 is 3310 ms delivered / 3126 ms baseline — the server is unavailable for the duration, on both trees | `route.post.admin-upload.html` / `.json` + the interleaved A/B ladder |
| [10.14](#1014-a-private-courses-archive-is-downloadable-by-any-authenticated-user) | `courses.download` and `course.copyCourse` gate on a permission every account holds | **200 with the archive** for any authenticated account, on any course including `private` | None — stated in §10.14; the difference ledger is what pins the response |
| [10.15](#1015-concurrent-course-archive-downloads-corrupt-one-another-and-six-of-them-end-the-process) | `courses.download` builds its working tree at a path keyed on owner and slug only, then deletes it before the lazy archive stream is read, with no `error` listener | **Six simultaneous requests end the process** (unhandled ReadStream `ENOENT`); at lower concurrency, 200 with a truncated, unparseable archive. Baseline-identical at the three lines that cause it | None — the corpus drives one request at a time; the difference ledger is what pins it |
| [10.16](#1016-the-folder-name-contract-is-asymmetric-between-create-and-rename) | Folder create accepts a 140-character name, rename accepts 50 | A folder created with a 51–140 character name can never be renamed to a name of its own length | `verify:joi` pins both targets |
| [10.17](#1017-a-folder-name-is-stored-with-control-characters-intact-and-the-two-list-routes-disagree-about-owner) | A NUL byte in a folder name is stored verbatim; `owner=me` works on `/api/courses` and is refused by `/api/trinkets` | `name` keeps the raw byte while the slug drops it; one list contract accepts `owner`, its sibling answers `"owner" is not allowed` | `verify:joi`; corpus list responses |
| [10.18](#1018-post-apiexports-answers-500-after-saving-its-row-and-queueing-its-job) | `POST /api/exports` fails in the RESPONSE, after saving the row and queueing the job | **500**, with the export persisted and its id never disclosed | probe on both trees; `quirk.export-create.marshal-500` written and its expectation met, but NOT delivered — see the entry |
| [10.19](#1019-the-in-flight-export-guard-reads-and-writes-in-two-steps) | The in-flight export guard reads and writes in two steps | Two concurrent posts leave **two** `pending` exports for one owner | `route.post.api-exports.json` for the guard's own branch; probe for the race |
| [10.20](#1020-the-rest-of-the-unbound-boom-family-in-libcontrollersusersjs) | The unbound-`Boom` family in `users.js` — all **15** sites, measured per branch | **500** at four cross-account denials, **200** carrying the identifier at six export branches, one site converting those six, and four sites unreachable from HTTP | `error-edge.not-found.missingExport` + the download success case; probe per branch |
| [10.21](#1021-the-export-flow-is-a-dead-end-for-the-user-who-reaches-it) | What §10.18 and §10.19 look like in the browser | A started export that cannot finish, a banner that hides itself after 5 s, and a `disabled` retry control | §10.18/§10.19 server-side; the client half has **no gate** and is out of scope |
| [10.22](#1022-two-further-defects-surfaced-by-the-closing-verification-pass) | Two defects the closing pass surfaced, neither among this checkpoint's findings | An uncastable export id answers **200** carrying the ODM's cast diagnostic with the value echoed; the Recent Exports table overflows the viewport by **47 px** at 375 px | **None for either** — the corpus materialises only castable ids, and no gate measures a computed layout; both stated in §10.22 |
| [10.23](#1023-the-course-page-overflows-and-overlaps-painted-controls-from-375-to-768) | The course page overflows and overlaps painted controls from 375 to 768 | 95px of horizontal scroll after a resize from ≥ 1024, and 6 overlapping painted control pairs at 375 | None — stated in §10.23 |
| [10.24](#1024-at-375-the-outline-expander-and-the-page-edit-control-have-zero-clickable-pixels-and-the-expander-is-inert-on-enter-and-space) | The outline expander and the page-edit control have zero clickable pixels at 375 | 0 of 120 sampled points on each, and the expander inert on Enter and Space | None — stated in §10.24 |
| [10.25](#1025-the-course-sub-navigation-overlays-and-completely-hides-the-material-title-and-body-at-320-and-375) | The course sub-navigation overlays the material title and body at 320 and 375 | A 189px band inside an 80px reserve; the page's own title completely invisible | None — stated in §10.25 |
| [10.26](#1026-the-outline-animation-drives-layout-rather-than-transform-reflowing-the-content-pane-every-frame) | The outline animation transitions `margin-left` rather than `transform` | 16 reflowing frames per toggle; input-free CLS **0.10781**, above the 0.1 threshold | None — stated in §10.26 |
| [10.27](#1027-a-maximum-length-140-character-course-name-lays-out-as-a-single-unbreakable-line-box-and-escapes-the-viewport) | A maximum-length 140-character course name is one unbreakable 1658.125px line box | Escapes the viewport by up to 1362px; the nav band cannot cover the widened document | None — stated in §10.27 |
| [10.28](#1028-seven-findings-raised-against-the-delivered-tree-and-declined-on-measurement) | **Seven declines** — the `attempt` client-metric key, `GET /api/users/assets` without `type`, username truncation, the malformed invited address, the markup-carrying course name, `updateCourse`'s unknown-save branch, and the unbound-`Boom` family | Measured on both trees and identical: 200 with `"attempt" is not allowed`; 500; a 21-character username rejected at every route with nothing truncating anywhere; `status:"invalid"` upserted and listed; the raw markup stored and escaped by a byte-identical template; a branch that never settles on either tree and no route admits; 200 `{"error":"Boom is not defined"}` | Live drives on one booted instance over a seeded isolated database, plus an empty `git diff --stat 2f8712a` for each byte-identity claim |
| [11](#11-the-approved-deviations) | **Approved deviations** — not preserved; the register holds **18 numbered entries, 13 of them live** (5 withdrawn, each measured in §11.0) | Stream response served; `marked` fork retained; both ZIP download routes emit different container bytes; the course archive is built per request; the bounded `zipCode` read; `POST /api/folders` answers where the baseline process died; the session cookie's `SameSite` emitted once; a credentialed cross-origin write answered 403; the page-level course copy answers; the email share token's key is not derivable; a course invitation token is minted from the CSPRNG; the login failure response is generic and delayed; a non-string `email` is rejected by validation; the four `output:'file'` upload routes accept multipart; two client-side markup sinks render user text inert | Deviation allowlist in replay; audit; the frozen archive-container register; the secure-pass cookie derivation; the cross-origin write matrix; the capability-token and login matrices; the upload probes and the sinks' escape audit |
| [11.4](#114-an-unapproved-security-policy-that-was-added-and-has-now-been-withdrawn) | **Withdrawn** — ten unapproved policies removed from the two auth/user controllers, the nine exposures preservation leaves open, and the three divergences native `fetch` brings with it | Unfiltered `next`; unguarded asset fetch; no OAuth `state`; plaintext provider token | Route manifest; suite; scenarios handed to the corpus work |
| [11.5](#115-a-second-unapproved-policy-in-the-route-parser-and-the-logger-and-now-withdrawn) | **Withdrawn** — six unapproved policies removed from `lib/util/routeParser.js` and `config/log.js`, with the measured effect on the route surface and the three exposures preservation leaves open | Unredacted failure flash and log line; off-origin `fail.redirect`, frozen for the process; prerequisites still ahead of validation | Route manifest (233/161/288); CLI digest; `quirk.fail-redirect-leak.post-users` |
| [11.6](#116-a-third-unapproved-policy-in-the-admin-controller-and-now-withdrawn) | **Withdrawn** — nine unapproved policies removed from `lib/controllers/admin.js`, including the only one in the delivery that changed a status code, and the five exposures preservation leaves open | Guest `POST /api/ohnoes` answers **200** again, with baseline's body, `Cache-Control` and `Set-Cookie`; unbounded anonymous alert mail with a caller-composed body; un-handled `mailer.send` rejection; `grantRole` publishes the whole user document | Six-shape byte-identical mail body; seven-row live A/B; 12-of-12 mail attempts on both trees; `route.post.api-ohnoes.json` |
| [11.9](#119-deviation-5-the-bounded-zipcode-read-and-the-process-death-it-no-longer-causes) | **Deviation 5** — the `zipCode` read is bounded and its chain terminated, so an authenticated request no longer ends the process | A malformed `zipCode` answered `draft` 200 / `autosave` 500 **and then killed the process** | §10.7's live probe and nineteen unit cases; no corpus scenario exists |
| [11.10](#1110-deviation-6-post-apifolders-answers-where-the-baseline-process-died) | **Deviation 6** — `POST /api/folders` answers **500** on a duplicate name, byte-identical to the rename collision's, and 500 on an unknown write failure (an earlier revision said 409; that status was withdrawn as invented) | Duplicate: **the process terminates**, no response. Unknown failure: request never settles | Runtime contract in §11.10; the `folder` fault entry in `test/parity/fixtures/model.js`; corpus handover stated |
| [11.11](#1111-deviation-7-the-session-cookies-samesite-attribute-is-emitted-once-so-secure-mode-no-longer-serves-samesitenone) | **Deviation 7 — WITHDRAWN** (measured: `[T app.js:372]` appends `; SameSite=None; Secure` exactly as `[B app.js:229]`, and the corpus gate reports no `set-cookie` difference on any login response) | Secure mode emitted `SameSite=Lax` **and then** `SameSite=None`; a browser applied the last one and carried the cookie on a cross-site write that answered 200 and persisted a record | `secureDifferential` in `test/parity/replay.js`; the `--secure` launcher pass; the login-header probe |
| [11.12](#1112-deviation-8-a-credentialed-cross-origin-state-changing-request-is-rejected) | **Deviation 8 — WITHDRAWN** (measured: no `trustedOrigins`, and no `Origin`, `Referer` or `Sec-Fetch-Site` read anywhere in the tree; the exposure is open and recorded) | 200, and the write really performed, on both trees; no token, `Origin`, `Referer` or Fetch-Metadata check existed anywhere | The six-case cross-origin matrix on both cookie passes; suite, smoke, route digest and a browser drive as the no-regression side |
| [11.13](#1113-deviation-9-the-page-level-course-copy-answers-where-the-baseline-process-died) | **Deviation 9** — `POST /{userSlug}/courses/{courseSlug}/copy` answers its duplicate-name branch through the route's own `fail.redirect` (302, or 200 with the message for a JSON `Accept`) and its unknown-write branch with a generic 500 | The owner copying their own course collides on the FIRST attempt: baseline **exits the process** (code 1, socket severed at 0.026 s); the delivered tree hung (000 at 20.002 s) | Runtime contract in §11.11; two committed scenarios with a recorded baseline half and no marker yet; corpus re-capture handed over |
| [11.18](#1118-deviation-14-the-four-outputfile-upload-routes-accept-multipart-and-answer-200) | **Deviation 14** — the four `output:'file'` upload routes declare `payload.multipart` and answer 200 to the body every shipped uploader sends | Baseline **415** from the payload parser, so no upload could succeed and four handlers were unreachable | Delivered-tree probes in §10.10 and §11.11; the two `client-contract.multipart-upload.*` recordings, whose marker is handed to the corpus owner |
| [11.19](#1119-deviation-15-two-client-side-markup-sinks-render-user-text-inert) | **Deviation 15 — WITHDRAWN** (measured: `git diff --stat 2f8712a -- lib/views public/js public/partials static/scss` prints nothing, so both sinks are the base commit's; the exposure is open and recorded) | Baseline inserted both as live HTML: a stored name executed in every searching user's browser, a file name in every viewer's | Measured absence of any recorded body carrying either sink; the file's own escape audit; §11.12's field table |
| [11.21](#1121-three-target-only-changes-that-are-not-deviations-two-withdrawn-one-corrected) | **NOT deviations** — the `shortCode` 12→10 truncation and the client-`shortCode` rejection **withdrawn**, `/signup`'s curated validation copy **withdrawn**, the embed screen-reader heading's double escape **corrected** | Generated `shortCode` is 12 characters again and a client-supplied one persists verbatim; `/signup` renders joi's own message again; the heading renders one level of escaping | HTTP re-drives recorded in §11.13; whole-suite delta 116/15 → 115/16 with the one changed case named |
| [11.22](#1122-deviation-16-the-payload-less-roles-update-answers-where-the-baseline-process-exited) | **Deviation 16** — the payload-less roles update answers through the route's own funnel | Baseline: the process **exits** on one payload shape and never answers on the other. Delivered: **200** `application/json`, `{"message":"roles required"}` | `route.post.api-admin-user-userId.json`, marker projected from the closed register; `verify:corpus` exit 0 |
| [11.23](#1123-deviation-17-the-email-change-request-settles-where-the-baseline-never-answered) | **Deviation 17** — the email-change request settles | Baseline: **no response ever** — `Store.set(key, val, cb)` hands a third argument to an arity-2 async `set`. Delivered: **200** `{"success":true}` in 13.547 ms, confirmation mail sent | `route.post.api-users-email.json`, marker projected from the closed register; the paired error-edge row in `test/parity/error-edges.js` |
| [11.24](#1124-deviation-18-a-control-character-in-an-embed-view-parameter-is-refused-instead-of-ending-the-process) | **Deviation 18** — a control character in an embed view parameter is refused before it reaches `@hapi/vision` | Baseline: `TypeError [ERR_INVALID_ARG_VALUE]` from `@hapi/vision/lib/manager.js:333`, curl exit 52, **process gone**. Delivered: **500 / 1600 bytes**, byte-identical to an unknown slug, process alive | No corpus scenario sends one (measured across all 392); registered in `test/parity/error-edges.js` as `trinket.beta.response.1` |
| [A](#appendix-a--the-quirk-allow-list-for-generated-target-actions) | **Allow-list** — the sites whose governing target action a generator must not override | n/a — a contract, not a quirk | `docs/conversion-inventory.md` regeneration |
| [10.11](#1011-requestfailerr-with-an-error-argument-terminated-the-process--repaired-and-why) | `request.fail(err)` with an `Error` is refused by the toolkit and the process dies | Connection severed, no response, **no process** | `route.post.api-admin-user-userId.json`, which records the baseline's own socket hang up |

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
visible rather than inferred. Corpus scenarios, scenario-ID family `quirk.fallback.*`:
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

**Gate.** Corpus scenarios, scenario-ID family `quirk.dead-301.*`, both asserting the response is **not**
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
of approved deviation 1 — see [§11.1](#111-deviation-1-the-never-settling-file-response).** Serving it
created a security exposure that baseline could not have, because baseline served nothing; the
delivered response therefore also carries two protective headers, outside the five approved fields and
changing none of them, recorded at
[§10.6](#106-serving-the-approved-image-response-served-script-capable-legacy-content-inline--closed-on-the-response-side).

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

**The ordinary user journey this quirk sits on, recorded because the note above did not name it.** QA
re-testing walked the plain new-user path — complete signup, then press Back — and arrived here:
signing up authenticates the visitor, so the `/signup` entry already in that tab's history re-fetches
as an **authenticated** request and answers 500 with `50x.html` instead of the form. Measured on the
delivered tree: Back from `/home` → `GET /signup` → 500. **The quirk is preserved** — writing
`h.redirect('/welcome')` is the improvement R-d prohibits, and `test/lib/api/pages.js` pins the 500 —
so the journey still shows an error page at that step, and that is deliberate.

What *was* fixed alongside it is the **second** step of the same journey, which is a different defect
and not this quirk. `POST /users` declares `fail: { redirect: '/{formName}' }`
(`[B config/routes.js:76-78]`), interpolated from the submitted payload by `request.fail`, and the only
form that posts there shipped `formName=sign-up` (`[B lib/views/signup.html:18]`). No `/sign-up` route
exists, so every validation failure 302'd to a bare 404 and put that dead path into history, where a
further Back answered 404. `[T lib/views/signup.html:66]` now submits `formName=signup`, naming the
`GET /signup` route that does exist (`[B config/routes.js:22]`) — the same destination this document's
fail-redirect-leak section already records both of its steps resolving to, and the value
`test/helpers/flow.js` and `test/parity/joi-baseline.json` have always used. **The route surface is
unchanged**: no route was added, the mechanism and its in-place interpolation are untouched, and the
233-entry manifest still matches. The consequence is that the flash is now rendered on the request
that consumes it rather than surviving to be mis-attributed on the visitor's next visit, and that
`/sign-up` no longer enters history **through the shipped form, and so not in any ordinary UI
journey** — verified as zero `/sign-up` requests across a full captured browser journey.

**The bound on that claim, stated because one seam still produces `/sign-up`.** `username` is
`.optional()` in the `POST /users` payload schema (`[B config/routes.js:84]`), and when the key is
absent `users.create` generates one and sets `json.formName = 'sign-up'`
(`[B lib/controllers/users.js:46-48]`). That assignment is reached only after the payload validates,
so it needs a failure raised inside the controller rather than by the validation block — a duplicate
email is the reachable one. Measured on the delivered tree, in a **fresh process** so that no earlier
failure has already frozen `fail.redirect` through the in-place interpolation this document records
above: `POST /users` with `formName=signup`, no `username`, and an email that already exists answers
302 to `/sign-up`, which answers 404. With `username` present the same duplicate-email request answers
302 to `/signup` and renders "An account already exists with this email".

So the seam belongs to callers that omit the key, which the shipped form no longer does — it sends
`username` as a required field. The assignment is **deliberately unchanged**:
`lib/controllers/users.js` is outside this remediation, and rewriting the value would change the
response of a request shaped exactly as the existing suite drives it. The fix is therefore scoped to
what a browser can reach, and this API seam is recorded here rather than closed.

**Gate.** `test/lib/api/pages.js` asserts status 500 for an authenticated `GET /login`
(`[T test/lib/api/pages.js:60-62]`) and an authenticated `GET /signup`
(`[T test/lib/api/pages.js:88-90]`), driven while logged in. The suite runs because `'pages'` is
inserted into the fixed `sequence` array in `[T test/lib/api/index.js:2-13]`, without which a new file
in `test/lib/api/` is never invoked. Corpus scenarios, scenario-ID family `quirk.authed-500.*`:
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
contract in [§11.0](#110-the-register-and-why-a-tool-cannot-add-to-it) was made
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

**What it is not: an approved deviation.** The register in [§11](#11-the-approved-deviations) names
its entries explicitly and **this is not one of them**. A driven replay observing step 2's body
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
`[T lib/controllers/courses.js:240-244]` — the course-owner role, a `public` course type, an `open`
course type, the `create-private-course` permission, or `make-course-copy` on this course. An
authenticated visitor holding none of those takes the `else`, and the expression it reaches differs
between the trees by the wrapper only:
**Measured** (static, plus probe — and see **Reachability**, below, which is the load-bearing
qualification and was missing from an earlier revision of this entry). The handler's body is one
five-clause authorization `if` `[T lib/controllers/courses.js:214-218]` — the course-owner role, a
`public` course type, an `open` course type, the `create-private-course` permission, or
`make-course-copy` on this course. An authenticated visitor holding none of those takes the `else`,
and the expression it reaches differs between the trees by the wrapper only:

```javascript
// [B lib/controllers/courses.js:289]
      return reply(Boom.forbidden());
// [T lib/controllers/courses.js:576]
      return Boom.forbidden();
```

**`Boom` is not bound in this module, and never has been on either tree.** The module's only
`@hapi/boom` binding is `errors` — `[B lib/controllers/courses.js:14]`, `[T lib/controllers/courses.js:21]`
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
code states the whole chain inline at `[T lib/controllers/courses.js:565-575]` — the missing binding,
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
| Browser / `*/*` | `50x.html` rendered, `.code(500)`, **none of the extension's cache headers** | `50x.html` rendered, `.code(403)`, likewise none — the same body, a different status |
| API / JSON | JSON Boom, `Internal Server Error`, **with** the extension's cache headers | JSON Boom, `Forbidden`, with them |

**Measured header sets, because "no cache headers" was imprecise and the difference is exactly what
R-e asks to be preserved per branch** (**probe**, driven against the delivered tree with a
permissionless identity — see **Reachability** below for how that identity was obtained):

```text
BROWSER (Accept: */*)      500  cache-control: no-cache          <- hapi's OWN default for the view
                                content-type:  text/html; charset=utf-8
                                (no Pragma, no Expires, no X-Frame-Options)

API     (Accept: json)     500  cache-control: no-cache          <- the extension's `cache_control`
                                pragma:        no-cache          <- the extension's write
                                expires:       0                 <- the extension's write
                                content-type:  application/json; charset=utf-8
```

So the branch that matters is not "headers or no headers" but **which** headers: `Pragma` and `Expires`
are written only on the API path `[T app.js:239-241]`, because the browser path has already returned at
`[T app.js:234-236]`. `Cache-Control: no-cache` appears on both, and on the browser path it is hapi's
default rather than the extension's `cache_control` value — which is visible by contrast with this
route's **200**, where the extension's full value
(`private, s-maxage=0, max-age=0, no-cache, no-store, must-revalidate, proxy-revalidate`) is present
(**probe**).

That the browser body is the *same template* either way is why this went unnoticed for so long: on the
path a user actually takes, only the status line betrays it.

**Reachability: the branch cannot be reached through the HTTP surface by any account this application
creates, and an earlier revision of this entry did not say so.** The omission mattered, because it
concealed a real exposure rather than merely overstating a gate — the exposure now has its own entry at
[§10.14](#1014-a-private-courses-archive-is-downloadable-by-any-authenticated-user). Clause **4** is
the reason, and the chain is short (**static**, both trees, plus **probe** on a running server):

```text
lib/models/user.js:283-292   registers checkPermissions as a pre-save hook on User
lib/models/user.js:64-72     if this.roles is empty -> this.setRoles('user', 'site')
lib/models/plugins/roles.js:138-144  setRoles IS grant with _skipUpdate
lib/models/plugins/roles.js:91-103   grant fills roles[i].permissions from Roles.getPermissions(role)
lib/models/roles.js:8-25     the 'user' role's permission list -> includes 'create-private-course' (:20)
lib/models/plugins/roles.js:346,400-456  hasPermission -> has('permissions', name, 'site') -> true
```

So `request.user.hasPermission("create-private-course")` is **true for every ordinarily-registered
account**, irrespective of the course's `courseType` and irrespective of who owns it. The route is
`auth: 'session'`, so the handler runs only for an authenticated request; every such request satisfies
clause 4; therefore the `else` is **dead over the route**. Driven on the delivered tree, a brand-new
account with no relation to the course received **200 with the archive** for another user's
`courseType: 'private'` course; the guard is byte-identical at
`[B lib/controllers/courses.js:136-140]` (clause 4 at `:139`), so the same identity takes the same
clause on the baseline tree. §10.12 carries that drive in full.

The one identity that *does* reach the branch is one whose `roles` entry carries **no `permissions`
array** — which the seeded parity `admin` is, reproduced verbatim from `test/helpers/defaults.js` so
that `hasRole('admin')` is true while `hasPermission` is false (`test/parity/seed.js:305-311`, whose
own comment records the asymmetry). Signup never produces such an account. **Confirmed from the other
direction on a running server** (**probe**): stripping the site `permissions` array from an otherwise
ordinary account and repeating the same request against the same private course answered **500** — and
restoring the array returned the **200**. Both accept modes were captured, and they are the two rows of
the table above:

```text
permissionless identity, Accept: application/json -> 500 {"statusCode":500,"error":"Internal Server
                                                     Error","message":"An internal server error
                                                     occurred"}
permissionless identity, Accept: */*              -> 500 text/html, the rendered 50x.html

server log for the same request, which is Layer 1 logging the throw before mapping it:
  error: ReferenceError: Boom is not defined
      at download (lib/controllers/courses.js:432:7)
      at route.handler (lib/util/routeParser.js:522:38)
```

That log line is what turns the thrown-identifier claim above from a reading into an observation: the
identifier is `Boom`, the address is the one this entry cites, and the frame above it is the preserved
handler catch-all rather than any local mapping.

**So the evidence for this entry is static reading plus fixture-shaped probing, not a route-level drive
by a real identity, and the stated gate is corrected accordingly** — an earlier revision claimed
"Route sweep scenario + error-edge inventory", which no route-level drive with an account the
application creates can satisfy. What the branch *does* when reached is fully established; that it is
reachable in production is **not claimed**.

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

**And the fixture that would close it closes the behaviour, not the reachability.** Per
**Reachability** above, clause 4 admits every ordinarily-registered account, so a private course alone
does not make the branch reachable — the drive also needs an identity with no `permissions` array,
which only the seeded `admin` fixture is. The scenario below is therefore worth having, and what it
proves is what the branch *does* when reached; it must not be read as evidence that a production
identity can reach it.

**So the case is fully specified and needs one new fixture.** What settles this entry is: a second
seeded `Course` whose `courseType` is `private` (or `demo`), owned by the seeded user; plus one
scenario driving `GET /{userSlug}/courses/{courseSlug}/download.zip?format=md` against **that** course
as the seeded **admin** — who is not its owner and, uniquely among the identities in play, holds no
permission — asserting **500**, and in the
JSON accept mode the `Internal Server Error` payload rather than `Forbidden`. Both pieces live in
artifacts other sections of the delivery own: the fixture in `test/parity/seed.js`, and the scenario in
`test/parity/capture.js`, whose builders emit the scenario array — `buildQuirkScenarios`,
`buildReplyChainScenarios`, `buildPreHandlerScenarios`, `buildOAuthScenarios`,
`buildAuthOutcomeScenarios` and `buildErrorEdgeScenarios` (**static**). The corpus is that generator's
output rather than a hand-authored plan, so adding this case means adding it to the relevant builder
and re-capturing; editing the artifact alone would be overwritten by the next capture and would carry
no provenance. This entry records the requirement in full so that doing it is mechanical.

Until then the standing gate is the **difference ledger**: whatever these three scenarios do record is
compared between the two trees, and because the register in [§11](#11-the-approved-deviations) names
its entries explicitly and this is not one of them, any change here is reported as an **unapproved**
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
[§11](#11-the-approved-deviations) does not name this site, any change here is reported as an
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
2. **The handler's own inner `catch` throws in turn.** `[T lib/controllers/users.js:1622-1627]`
   answers the caught error with `resolve(Boom.internal('Export status error'))`, on the same unbound
   identifier, so the catch cannot absorb the failure and the throw **escapes the `Export.findById`
   callback**.
3. **The generated finder re-invokes the very callback that threw, with the `ReferenceError` as its
   `err`.** At the base commit that was the finder's own promise bridge:
   `[B lib/models/model.js:147]` — `promise.then(function(doc) { cb(null, doc); }).catch(cb);` —
   attached the caller's callback as the rejection handler of the same chain whose fulfilment handler
   called it. The delivered tree produces the same double invocation through the callback form the
   suite requires, and the mechanism is named exactly here because two other entries cite it.
   Mongoose invokes an `exec` callback inside a try/catch of its own —
   `Model.$handleCallbackError` [node_modules/mongoose/lib/model.js:5402-5419], reached from
   `Query.prototype.exec` [node_modules/mongoose/lib/query.js:4935] — and `createModel` installs a
   per-model **override** of that wrapper at `[T lib/models/model.js:195-219]`. For a callback the
   generated `findById` registered at `[T lib/models/model.js:260-262]`, the override catches the
   throw and calls that same callback again with the error as its **single** argument
   `[T lib/models/model.js:214]`; every other callback is delegated to Mongoose's wrapper untouched.
   The arity and the bound are the base commit's: one argument, so a callback reading `(err, doc)`
   sees the throw as `err` and no document, and exactly one re-delivery, because a throw from the
   second invocation is left to Mongoose's wrapper and becomes the model `error` event the listener at
   `[T lib/models/model.js:127-129]` logs. The callback runs a second time, this
   time takes `if (err)` at `[T lib/controllers/users.js:1587-1589]`, and answers
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
verbatim; the finder's **re-delivery of a throw to the callback that threw** is retained, precisely
because the double invocation is load-bearing rather than incidental; and the order of identifiers on
each line is preserved, because a callee is resolved before its
arguments and `Boom` therefore has to remain the **first** unresolvable name on the line for the
client-visible message to stay `Boom is not defined`. The delivered code states all three constraints
inline at `[T lib/controllers/users.js:1557-1578]` and `[T lib/controllers/users.js:1649-1661]`,
and the first of those two blocks also records that the re-delivery is the only thing that settles
these branches, so a later reader cannot remove it as an implementation detail.
Binding `Boom`, rewriting the calls as `errors.*`, or "repairing" the finder so a throwing callback is
not re-entered would each change a status **and** a body, which R-d and R-e prohibit independently.

**The middle constraint is an outcome and a mechanism, not a file's bytes — and an earlier revision of
this section said otherwise.** It asserted that `lib/models/model.js` is kept "byte-identical to
baseline (`git diff 2f8712a -- lib/models/model.js` is empty)". **That is withdrawn: the file is not
byte-identical, and it cannot be.** Two cases in `test/lib/models/trinket.js` force the callback form —
'findById should include the shortCode as a search criteria' (`:113-124`), which asserts
`findOne.calledWithExactly(query, cb)`, and 'findById should return the results of the findOne call'
(`:126-137`), whose stub `function (criteria, cb) { cb(null, doc) }` invokes its second argument. Sinon
compares function arguments by identity, so the caller's own `cb` has to be the argument the query is
built with, and a callback fed from a trailing `.then` leaves the stub calling `undefined`. AAP §0.9.2
is explicit about that reading — the provisional exclusion of this module holds only while "the
repaired suite passes with those modules unmodified", and "any module the suite implicates is
converted, and the diff records which test forced it" — and §0.9.2 forbids weakening the assertion to
accommodate an implementation instead. So the bridge could not survive as bytes.

**What this section protects is therefore the re-delivery and the 200 body, and nothing about the
file's contents.** The invariant is: a callback the generated `findById` hands to the driver, which
throws on its first invocation, is invoked a second time with that throw as its single argument, and
`GET /api/exports/{exportId}` and `.../download` answer **200** carrying
`{"error":"Boom is not defined"}`. Removing the re-delivery, bypassing it, or scoping it away from
`findById` is what this section prohibits — not editing the file. The delivered mechanism is the
`$handleCallbackError` override step 3 names, and its own comment at
`[T lib/models/model.js:151-194]` records that it exists to hold this outcome.

**Re-measured on the delivered tree after the restoration** (**probe**, a live server, one
authenticated identity, `Accept: application/json`). All six branches §10.20 tabulates answer
**200** with `{"error":"Boom is not defined","flash":{…}}` — four of them exactly the 42-byte
`{"error":"Boom is not defined","flash":{}}` the corpus pins, and the other two differing only in the
session `flash` the body carries, which is the variability the note above already records. The replay
reports `error-edge.not-found.missingExport` as a **match** against the pinned baseline. The controls
are unchanged with it: a completed export answers 200, its `/download` 302, an uncastable id 200 with
the `CastError` body (§10.22-A, in
[§10.22](#1022-two-further-defects-surfaced-by-the-closing-verification-pass)), and
`GET /api/exports` 200.

**The interval in which those six branches answered nothing was measured, and by three QA findings
rather than one.** A revision of this tree between the base commit and that restoration replaced the
finder's bridge with a plain driver callback and no re-delivery, on the recorded ground that "no test
and no caller depends on that double invocation". The test half of that claim was right and is why the
bridge did not come back; the caller half was wrong, and the cost of it is what
`W000-EXPORT-BRANCH-HANG` (CRITICAL), `W001-F11-EXPORT-BRANCHES-NO-RESPONSE` (HIGH) and
`W002-I6-EXPORT-CASTABLE-ABSENT-ID-HANG` (MEDIUM) each measured independently: with the throw
swallowed into the model `error` event the listener merely logs, the promise those two handlers await
never settled, and all six branches **stopped answering at all** and parked their clients — reported
at 8 s, at 12-30 s, and at a 20 s client timeout with 25 concurrent requests still held at 6 s. That
is the concrete reason this entry's invariant is stated as a re-delivery rather than as a file: a
reader who protects the bytes protects nothing, and a reader who removes the mechanism reproduces
those three findings.

**Gate.** `error-edge.not-found.missingExport` carries the baseline value above and is compared between
the trees by the replay; `route.get.api-exports-exportId.json` covers the same route's success branch
(recorded 200 with the export document) so that a change to the not-found branch cannot hide behind an
unexercised route. Because the register in [§11](#11-the-approved-deviations) does not name this
site, any difference here is reported as **unapproved**. The per-edge status and payload belong to
`docs/error-edge-inventory.md`; the `getExportStatus` rows there must read as **200 edges carrying an
`error` field**, not as the 404/403/400 the expressions name.

**One consequence worth stating plainly, because it is not a repair.** The same re-invocation makes
`request.fail(err)` reachable with an `Error` argument, and that is a different and harsher outcome —
[§10.11](#1011-requestfailerr-with-an-error-argument-terminated-the-process--repaired-and-why) records it, and it is the
same finder re-delivery doing the work in both entries — `.catch(cb)` at
`[B lib/models/model.js:147]` on the baseline, the `$handleCallbackError` override at
`[T lib/models/model.js:195-219]` on the delivered tree.

**The rest of the family, measured per branch, is
[§10.20](#1020-the-rest-of-the-unbound-boom-family-in-libcontrollersusersjs).** This entry is the
mechanism; that one is the per-branch ledger — which of the 15 answer 500, which answer 200, which one
answers nothing of its own but converts the others, and which four cannot be entered from an HTTP
request at all — together with the re-count that settles a review report of 16 references at 15.

---

### 9.10 A third routed handler that answers 500 where its author intended 404

**Measured** (**probe**, two live servers side by side — the delivered tree and an independently
installed `git worktree` at `2f8712a`, both on Node 22.23.2 — plus **static**).

`admin.addFeaturedCourse` has two not-found branches, `[B lib/controllers/admin.js:221]` and `:230`,
delivered at `[T lib/controllers/admin.js:309]` and `:318`. Each executes `throw Boom.notFound()`, and
**`Boom` is not bound in this module and is not a global**: the file binds `@hapi/boom` as `errors` at
`[T lib/controllers/admin.js:7]` and never as `Boom`, `app.js` binds `Boom` as a module-scoped `const`
rather than as one of the implicit globals it assigns, and no other binding reaches here. So neither
expression raises a 404 — each raises `ReferenceError: Boom is not defined`, which is an `Error`, which
the handler's own `.catch` maps to a 500.

**Measured outcome, identical on both trees:**

```text
POST /api/admin/featured-course   ownerSlug=nosuchowner slug=nosuchcourse   (admin session)
  baseline 2f8712a -> 500  {"statusCode":500,"error":"Internal Server Error",
                            "message":"An internal server error occurred"}
  delivered tree   -> 500  identical status and identical body

POST /api/admin/featured-course   ownerSlug=<a real user> slug=nosuchcourse (admin session)
  baseline 2f8712a -> 500  same body        delivered tree -> 500  same body
```

The two trees reach that 500 through different mappings and the same status and payload: baseline's
`.catch` calls `reply(err)`, and the delivered `.catch` calls `errorResponse(h, err)`, whose
`err instanceof Error` arm returns `errors.badImplementation(err.message)` — a 500 carrying Boom's own
standard payload, so the `ReferenceError`'s message stays on the Boom and never reaches the client.
`docs/error-edge-inventory.md` records both sites independently as **CLOSED**, "Baseline and target
both produce Layer 3 / 500 / answers / route handler".

**What an administrator sees.** The featured-courses form reports nothing at all: the page renders no
error, the inputs are not cleared, and the only trace of the failure is the application's own log line.
That is the baseline experience and it is unchanged.

**Target disposition: keep both expressions exactly as written.** Do not bind `Boom`, do not rewrite
them as `errors.notFound()`, and do not reorder the identifiers on either line. Three rules converge
here and the file's own delivery directive states the ruling in as many words — R-d, because turning a
500 into a 404 is an improvement; R-e, because the status of an error edge is the mapping it preserves;
and R-a, because binding a new identifier for this purpose is a fifth kind of change in a diff that may
read as only four.

**This is the third member of a family, and the family is the point.** [§9.7](#97-a-routed-handler-that-answers-500-where-its-author-intended-403)
is the same defect in `courses.download` (500 where the expression names 403) and
[§9.9](#99-two-routed-handlers-that-answer-200-carrying-the-name-of-a-missing-identifier) is the same
defect in `users.getExportStatus` and `users.downloadExport` (200 carrying `Boom is not defined`).
Three controllers, one unbound identifier, three different outcomes — which is exactly why each is
recorded with its own measured status rather than as one rule.

**Gate.** `route.post.api-admin-featured-course.json` drives the route at 200; the two failure branches
carry `id=admin.addFeaturedCourse.response.1` and `.response.2` in
`docs/error-edge-inventory.md`, whose rows must keep reading as **500 edges**, and whose own text
records that a dedicated `error-edge.*` scenario is what would prove the branch exercised rather than
merely reached.

**A defect in the generated inventory's reachability analysis, recorded here because it cannot be fixed
by hand.** `docs/error-edge-inventory.md` is a generated artifact and says so in its banner, and its
coverage table asserts of the funnel this section's 500 passes through — `id=admin.errorResponse.response.1`
at `lib/controllers/admin.js:382` — that coverage is *"**none possible** — the edge sits on no route, so
no HTTP scenario reaches it"*. **That is false, and this section is the counter-example**: an
unauthenticated-slug `POST /api/admin/featured-course` reaches it on every 500, measured on both trees.
The same document contradicts itself two thousand lines earlier, where the row's own carrier line names
`admin.addFeaturedCourse`, `admin.moveFeaturedCourse` and `admin.removeFeaturedCourse` as its traced
callers. The cause is that the generator treats an *internal callee* as unroutable instead of resolving
reachability through its traced callers, so the claim is systematic rather than local — the identical
"none possible" text appears for `folders.legacyReply.response.1` and `trinket.legacyReply.response.1`.
Repairing it means changing `test/parity/error-edges.js`, which belongs to the parity-tooling unit and
not to this one, and a hand-edit of the document would be silently discarded by the next run while
being indistinguishable from a measurement in the meantime. **Recorded, not repaired, and owed to the
generator's owner**; the runtime fact this section states is unaffected, because it rests on the
measurement rather than on the inventory.

### 9.11 The admin controller publishes the whole user document, bcrypt hash included

**Measured** (**probe**, both trees; **static** for the template).

**This section is the catalogue for the whole class, not only for the two admin sites its heading
names.** The heading is kept as it stands because three other sections cite its anchor, but the
inventory below it runs to **four** sites: the two in `lib/controllers/admin.js` recorded first, and
the two course-creation responses recorded in
[9.11.1](#9111-the-same-construct-outside-the-admin-controller--the-two-course-creation-responses),
which are reachable by **every authenticated account** rather than by an administrator. Those two were
missing from this catalogue and were raised as a finding against it in their own right; a catalogue
that named one site of a class and not another is the defect that finding reported, and 9.11.1 is
the correction.

Two sites in `lib/controllers/admin.js` serialize a mongoose `User` document wholesale, so every
persisted path leaves the process:

| Site | Baseline | Delivered | What the body carries |
|---|---|---|---|
| `userSearch`, feeding `admin.index`'s `data` | `[B lib/controllers/admin.js:279]` `data = JSON.parse(JSON.stringify(user));` | the same serialization, now passed through `withoutCredentialMaterial(...)` — **changed at the QA checkpoint that followed this section**, see below | the whole document **minus** `password` and any provider token, rendered into the admin user page |
| `grantRole`'s success body | `[B lib/controllers/admin.js:206]` `user : JSON.parse(JSON.stringify(user))` | `[T lib/controllers/admin.js:288]`, identical | the whole document, as JSON |

`lib/models/user.js` declares no `toJSON` transform that removes credentials, so both bodies carry
`password` — a live `$2b$10$…` bcrypt hash — together with `_id`, `__v`, `verified`, `source`, `roles`
and, where present, `profiles.google` with the stored OAuth `token` and `refreshToken`.

**Measured, and identical on both trees when this section was written:**

```text
GET /admin/users?q=<email>            (admin session)
  baseline 2f8712a -> 200, page body contains  $2b$10$…   (1 match)
  delivered tree   -> 200, page body contains  $2b$10$…   (1 match)
  delivered tree, AFTER the QA change below -> 200, ZERO matches

POST /api/admin/user/{userId}/grant   role=trinket-connect (admin session)
  baseline 2f8712a -> 200, body carries "password":"$2b$10$vjOZ…", _id, verified, source, roles[]
  delivered tree   -> 200, same shape                    (unchanged)
```

`lib/views/admin/includes/users.html` renders that object into the page's JSON tab. It **was**
byte-identical to baseline when this section was written (**probe**: `git diff 2f8712a -- lib/views/admin/`
was empty), which is why the exposure was attributed entirely to the controller's projection and
entirely to baseline. The template rendered the pretty-printed object through Nunjucks' `| safe`, so
the JSON was emitted unescaped inside a `<pre>`; that is what made the wholesale projection more than
an information leak, and it was recorded as exposure 7 in
[§11.6](#116-a-third-unapproved-policy-in-the-admin-controller-and-now-withdrawn). **Both halves have
since been changed** — the template no longer marks either sink safe, and this controller no longer
serialises credential material into it — so `lib/views/admin/` is no longer byte-identical to baseline
and the sentence above is preserved as the record of what was true rather than as a current claim.

**The hash is in the page whether or not the JSON tab is opened.** The whole document ships in the
initial HTML of every `/admin/users?q=…` response, so it is present in `body.textContent` and in the
raw markup while the Profile tab is the active one (**probe**, browser: found at offset 3358 of
`body.textContent` and 21140 of `documentElement.outerHTML` with `#json` still `display:none`). The
tab is a CSS affordance, not a fetch boundary.

**Target disposition as delivered by the migration: keep both `JSON.parse(JSON.stringify(user))`
expressions.** That held for `grantRole` and no longer holds for `userSearch`, which the QA checkpoint
below changed; the paragraph is kept because the withdrawal it records is still the reason `grantRole`
is untouched. A projection through
the model's own `serialize()` was written into `grantRole` during this migration and has been
**withdrawn** — it changed that response body against baseline, which AAP §0.9.3 compares exactly, and
no approved deviation covers it; [§11.6](#116-a-third-unapproved-policy-in-the-admin-controller-and-now-withdrawn)
records the withdrawal. `userSearch` was never changed. Two non-document edges ride on the wholesale
form and are baseline as well: a null user yields a body reading `user: null`, and an undefined user
throws the `SyntaxError` that `grantRole`'s own `.catch` turns into `request.fail`.

**HALF OF THIS IS NO LONGER PRESERVED, and the split is the point.** The two sites above had one
exposure and two very different gates over them, and the QA pass that followed this section separated
them.

**`userSearch` — CLOSED.** QA findings `W001-F06-ADMIN-USERS-STORED-XSS` and
`W002-I2-ADMIN-JSON-TAB-XSS` raised the rendered hash together with the `| safe` sinks that made the
same projection executable, and the escaping-and-projection change was assigned as one unit of work.
`userSearch` now hands the view `withoutCredentialMaterial(JSON.parse(JSON.stringify(user)))`, which
deletes `password` and any `token`, `refreshToken`, `accessToken`, `tokenSecret` or `secret` under
`profiles`. **Measured after the change**: `GET /admin/users?q=<username>` as an admin answers 200 with
`$2b$10$` absent from both `document.body.innerHTML` and `document.body.textContent`, where it was
present once before. The wholesale `JSON.parse(JSON.stringify(user))` itself is deliberately KEPT — it
is what gives the JSON tab its diagnostic value and every field the page reads comes off it — so the
change is a subtraction of credential fields, not a `publicSpec` projection: the entity-decoded JSON
pane is byte-identical to baseline's apart from the removed `password` line, measured, so no field the
page displayed has been lost. The walk is scoped to `profiles` rather than applied to the whole
document because `roles[].thru` is keyed by role NAME, and a blanket deny-list would delete a
legitimate entry from a user holding a role called `token`. Why R-d did not hold here, and why AAP
§0.9.3 did not either, is argued in [§11.6](#116-a-third-unapproved-policy-in-the-admin-controller-and-now-withdrawn)'s
exposure table above row 7: no committed scenario drives `/admin/users` with a `?q=`, so this body is
not one the exact-body comparison sees.

**`grantRole` — STILL PRESERVED, and the reason is now specific rather than shared.** Its response
body IS carried by a committed scenario (`route.post.api-admin-user-userId-grant.json`), so changing
it changes something AAP §0.9.3 compares exactly; a `publicSpec` projection here was already written
during the migration and withdrawn for that reason, above. So a site administrator looking up a user
no longer receives that user's credential material, but an administrator *granting* a role still
does — in their browser, its history, its cache and any proxy in front of it. It is reachable only
with an admin session and the hash is a cost-10 bcrypt digest rather than a password, but it is
credential material crossing a boundary it has no reason to cross. **Named follow-up, now scoped to
one site:** project `grantRole` through `lib/models/user.js`'s `publicSpec` — the model already
declares what may leave the process, and `lib/controllers/course.js` already applies it — as a
separately approved security decision, with the corpus recaptured for the changed body. The two
non-document edges above ride on `grantRole`'s wholesale form and are unaffected by the `userSearch`
change.

**Gate, and the asymmetry in it that decided which half changed.**
`route.post.api-admin-user-userId-grant.json` carries `grantRole`'s body, so AAP §0.9.3's exact-body
comparison would report that site changing shape — and does, which is what preserves it.
`route.get.admin-adminPage.html` / `.json` drive `/admin/users` with **no `?q=`**, measured, so
`admin.index` leaves `data` undefined, the user pane renders neither the JSON tab nor `#rolesData`, and
**no committed scenario carries `userSearch`'s body at all**. The `userSearch` change was therefore
verified by re-driving the QA findings' own reproduction against a running server rather than by a
replay diff; the after-measurements are in
[§11.6](#116-a-third-unapproved-policy-in-the-admin-controller-and-now-withdrawn)'s exposure row 7.
A scenario that drives this route with a `?q=` naming a seeded user would close that gap and is worth
adding.

### 9.11.1 The same construct outside the admin controller — the two course-creation responses

**Measured** (**probe**, both trees, driven through two independently installed running servers on
2026-09-08; **static** for the mechanism).

Two more responses publish a whole `User` document, and neither needs an administrator. **Both
course-creation routes** answer with a course whose `_owner` is the acting user's entire persisted
record, `password` included:

| Site | Route | Reach | Delivered | Baseline |
|---|---|---|---|---|
| `course.createCourse`'s success projection | `POST /api/courses` | any authenticated account, for its **own** record | `[T lib/controllers/course.js:298]` `return request.success({ course : course });` | `[B lib/controllers/course.js:36-39]`, the same projection inside the save callback |
| `courses.create`'s success projection | `POST /courses` with a JSON-negotiated `Accept` | any authenticated account, for its **own** record | `[T lib/controllers/courses.js:112-117]` `request.success({ course : ObjectUtils.serialize(course) })` | `[B lib/controllers/courses.js:39]`, the same projection on the injected response |

**Measured, and identical on both trees** — the same request sequence on each (one signup, one create),
on servers built from their own `npm ci`. The byte counts are the counts *those* responses carried, and
they are quoted because the two trees produced the same one, not as a canonical size for the route: the
body also carries the session's accumulated flash, so an identical create on a different session
legitimately differs in length. What is asserted here is the **identity between the trees**, key set
included:

```text
POST /api/courses  {name: "QA probe course"}   Accept: application/json   (authenticated, non-admin)
  baseline 2f8712a -> 200, 1513 body bytes, 1 bcrypt hash
  delivered tree   -> 200, 1513 body bytes, 1 bcrypt hash
  top-level keys   ["context","course","flash"]                       both trees
  course keys      ["_owner","archived","globalSettings","id","lessons","name","ownerSlug","slug"]
  course._owner    ["__v","_id","avatar","created","email","fullname","lastUpdated","name",
                    "password","roles","settings","source","username","verified"]   both trees
  password value   "$2b$10$…"  - the live cost-10 hash the account authenticates with

POST /courses      {name: "QA page course"}    Accept: application/json
  baseline 2f8712a -> 200, 1793 body bytes, 1 bcrypt hash, same `_owner` key set
  delivered tree   -> 200, 1793 body bytes, 1 bcrypt hash, same `_owner` key set
```

**The mechanism, and why it is two halves rather than a missing line.** `ownable`'s `setOwner`
assigns the **whole document** to the `ref` path — `[T lib/models/plugins/ownable.js:16-22]`
`this._owner = owner;`, byte-identical to baseline — so a freshly created course carries a populated
`_owner` without anything having populated it. `Course.publicSpec` then includes `_owner`
`[T lib/models/course.js:433-443]`, and `Model.serialize` `[T lib/models/model.js:63-91]` tests
`hasOwnProperty('serialize')` on that value, which is **false** because `serialize` is a schema method
on the prototype, so it falls through to `JSON.parse(JSON.stringify(this[key]))` and emits the whole
document. `lib/models/user.js` declares no `toJSON` or `toObject` transform, and its own
`publicSpec` — `{id, name, username, fullname, email, avatar, settings}`, which carries **no**
`password` — is never consulted on this path.

**The application already knows how to reduce it, at a sibling creation route, in baseline code.**
`folders.create` does `savedFolder._owner = savedFolder._owner.id;` before answering
`[T lib/controllers/folders.js:332]`, and `Folder.publicSpec` includes `_owner` exactly as
`Course.publicSpec` does — so the same construct is present there and is bounded there. Measured on
both trees, `POST /api/folders` answers `"_owner":"<24-hex id>"` with **zero** bcrypt matches in 212
body bytes. The asymmetry between the two features, not the absence of a mechanism, is what this
entry records.

**Reach, stated precisely, because it is what distinguishes these two sites from the admin pair
above.** The two admin sites need an administrator and disclose the **looked-up** user's hash. These
two need only a session and disclose the **caller's own** hash. Driven with three separate accounts,
each received its own hash and no other account's, and a 137-route GET sweep across four identities
found no cross-account hash anywhere — so this is self-disclosure, not cross-account disclosure. It
is still credential material crossing a boundary it has no reason to cross: it reaches the caller's
browser, its history and cache, any proxy or log in front of it, and anything that records API
responses, and a cost-10 bcrypt digest of the account's live password is an offline-cracking primitive
handed to whoever holds the response.

**Target disposition: keep both projections exactly as they are.** What controls is the same
combination that controls the admin pair, and it is stated rather than implied:

* **R-d** (AAP §0.7) prohibits behaviour improvements, and **AAP §0.2.2** excludes them by name except
  where §0.7 decides a requirement other than R-d controls — which for this migration it does twice,
  and neither time here.
* **AAP §0.9.3** compares response bodies **exactly** against `2f8712a`. The measurement above is what
  makes that decisive rather than theoretical: the two bodies are identical between the trees, byte
  count included, so preserving them is available. Projecting `_owner` would change both.
* **[§11.0](#110-the-register-and-why-a-tool-cannot-add-to-it)**'s rule for the register is the same
  test in one sentence — *a change that could have preserved baseline is not a candidate at all,
  however much better it looks*. Preservation is possible here, so no deviation is available to
  approve, and §11.4 and §11.6 record two earlier attempts at exactly this kind of unapproved security
  change being **withdrawn**, one of them the projection written into `grantRole`.

**Three findings asked for the code change, and this is the answer to each.** All three measured the
same body; they differed on disposition. The finding that examined the **baseline** artifact
concluded that "the behaviour is preserved correctly; the catalogue is incomplete" and asked for this
entry, which is what it is. The other two asked for the existing `tagSafeCourseProjection` to be
applied at `[T lib/controllers/course.js:298]`, or for a `toJSON` transform on the user schema. Both
are refused **on the citations above and on nothing else** — not on severity, not on reach, and not
because the exposure is acceptable. It is not acceptable; it is preserved, and the cost is recorded
here where it outlives the run.

**Named follow-up, in the order a reviewer should take it.** `tagSafeCourseProjection`
`[T lib/controllers/course.js:2393]` already exists in the same controller, is already applied at
`:337`, `:408` and `:1410`, and its `projectOwner` reduces a populated `_owner` to
`{name, username}` — the whitelist measured against every consumer in the tree. Applying it at
`[T lib/controllers/course.js:298]`, and the same reduction at
`[T lib/controllers/courses.js:112-117]`, closes both sites with no new mechanism. It needs, as one
approved change: a §11 register entry carrying the field-by-field body contract; a recapture of
`route.post.api-courses.json` and `route.post.courses.json` in `test/parity/corpus.json`, which is
digest-bound and cannot be hand-edited; and a decision on whether the two admin sites move with it,
since a `toJSON` transform on `lib/models/user.js` would close all four at once but would also change
every other response that serializes a `User` — a wider blast radius than the two-line projection,
and the reason it is named second here rather than first.

**Gate.** `route.post.api-courses.json` and `route.post.courses.json` carry these bodies; AAP §0.9.3's
exact-body comparison is what would report either site changing shape, in either direction — a
projection applied without the register entry above would surface there as an unapproved difference,
which is precisely how §11.6's withdrawn `grantRole` projection was caught.

### 9.12 Admin user search is exact-match only, under a label that promises three fields

**Measured** (**probe**, both trees; **static**).

`admin.index`'s search branch dispatches on the query string: `/^role:\w+/` goes to `roleSearch`, and
**everything else** goes to `userSearch`, which calls `User.findByLogin(q, …)` at
`[B lib/controllers/admin.js:273]`, delivered at `[T lib/controllers/admin.js:392]`. `findByLogin` is an
exact-match finder on the login fields; there is no prefix, substring or regex branch anywhere on the
path, and when it finds nothing `userSearch` resolves `undefined`, so the page renders no result.

**Measured, and identical on both trees** (a user `norma_…` exists in each database):

```text
GET /admin/users?q=norma_<tag>@example.com   -> 200, the user is rendered
GET /admin/users?q=norma                     -> 200, ZERO results for a user that provably exists
```

**What the empty state actually says, quoted from the rendered page.** The template does render a
message — `<p>No matches found for <strong>norma</strong>.</p>` — so the page is not silent, and an
earlier revision of this section which described it as having "no hint, no message" was wrong and is
corrected here. What the message does not do is distinguish *absent* from *not an exact match*: it
reports the same sentence for a username that does not exist and for a partial form of one that does,
which is why a partial term reads as "no such user" rather than as "type the whole thing". It is a bare
`<p>`, not a Foundation alert or callout, and the page carries **0** elements with `aria-live`, `0`
with `role="status"` and `0` with `role="alert"` (**probe**, browser), so on a full-page-GET search the
outcome is never announced to assistive technology.

**What the label actually says, quoted from the template.** `lib/views/admin/includes/userSearchForm.html:11`
reads `Search by Email, Username, or Role (e.g. role:admin)` — so the label **does** name the `role:`
prefix, and an earlier revision of this section which said the prefix "is not mentioned by the label at
all" was wrong and is corrected here. The gap that remains is narrower and still real: the label
promises three fields and gives a worked example for the one that needs a prefix, while saying nothing
about the other two having to be given in full. The input carries no `placeholder` attribute at all
(**probe**: `outerHTML` is exactly `<input id="user-field" type="text" name="q" value="…">`), so the
label is the only affordance text there is.

**Target disposition: leave the dispatch and the finder exactly as they are.** A prefix or substring
search is a new capability, which AAP §0.2.2 excludes ("New or removed routes and features"; "Behaviour
improvements") and R-d prohibits; relabelling the form is a template change with the same standing.
The empty state's missing hint and missing `aria-live` are properties of `lib/views/admin/**`, which
this document does not alter — they are recorded here as part of the same measured outcome so the
behaviour and its presentation are not separated, and any repair is one reviewed change across the
controller and the template together.

**Gate.** `route.get.admin-adminPage.html` / `.json` drive the admin page; the search behaviour is
proved by the two probes above, which are the shape a regression would have to change — a build that
started matching `norma` would differ from baseline on the second line.

---

### 9.13 Two more routed handlers that answer 500 where their author intended 403

The same construct [§9.7](#97-a-routed-handler-that-answers-500-where-its-author-intended-403) records
for `courses.download`, in a second controller, on two branches — and it reaches the client as a
**denial that does not look like one**. §9.7's disposition governs and is quoted rather than re-argued:
*"if the expression is deliberately unreachable, record it in `docs/preserved-quirks.md`. Do not change
its behaviour."*

**Both routes are real and routed.**

| Property | `folders.deleteFolder` | `folders.update` |
|---|---|---|
| Route | `DELETE /api/folders/{folderId}` | `PUT /api/folders/{folderId}/name` |
| Address | `[B config/api_routes.js:705-712]` | `[B config/api_routes.js:691-704]` |
| Auth | `auth: 'session'` | `auth: 'session'` |
| Pre-handlers | `'folder(params.folderId)'` **only** | `'folder(params.folderId)'`, `'canEdit(pre.folder,user)'` |
| Handler guard | `request.user.hasRole("folder-owner", "folder", {id})` | `request.user.hasPermission("update-folder-details", "folder", {id})` |
| Else branch | `[B lib/controllers/folders.js]` `return reply(Boom.forbidden())` | same expression |

**Measured** (driven on the delivered tree, port 20220, two seeded users; the baseline expression is
byte-identical, so the outcome is baseline's too). A second user driving
`DELETE /api/folders/{another user's folderId}` receives
**`500 {"statusCode":500,"error":"Internal Server Error","message":"An internal server error occurred"}`**,
and the same user driving `PUT /api/folders/{that folderId}/name` receives
**`403 {"statusCode":403,"error":"Forbidden","message":"Forbidden"}`**.

**Why the two differ, which is the part a reader will otherwise get wrong.** It is not the handlers —
their else branches are the same expression. It is the **pre-handler list**: only the rename route
declares `canEdit(pre.folder,user)`, so a non-owner is refused there *before* the handler runs and gets
a real 403 from the pre-handler. The delete route declares no such pre, so a non-owner reaches the
handler, fails the `hasRole` guard, and evaluates `Boom.forbidden()` — and **`Boom` is not a binding in
`lib/controllers/folders.js`**, whose only `@hapi/boom` binding is `errors`. Evaluating the argument
throws `ReferenceError: Boom is not defined` *before any response is constructed*, the handler rejects,
and the preserved route catch-all maps it to `Boom.badImplementation` — a 500, where the expression
names a 403. `folders.update`'s else branch is reachable by the narrower case §9.7's neighbour
describes: a user who owns the folder but was never granted the `folder-owner` role.

**What is and is not exposed, stated exactly, because the finding was raised as a security issue.**
The **denial holds**. Measured: after the cross-owner `DELETE` answered 500, the owner's own
`GET /api/folders` still listed the folder, so nothing was deleted; the rename case is stopped by its
pre-handler and nothing was updated. There is no authorization bypass and no data loss here — the
defect is entirely in the **status class**, and a client cannot distinguish "you may not do this" from
"the server broke", which is a real usability and monitoring cost and no more than that.

**Declined, with the citation it turns on.** A finding asked for the delete branch to answer 403.
Preserving is **possible** here — unlike [§11.10](#1110-deviation-6-post-apifolders-answers-where-the-baseline-process-died),
the process survives and the request *is* answered — so no requirement other than R-d is engaged and
**R-d controls**, reinforced by **R-e** ("error-to-response mappings survive the async conversion
unchanged — same status codes"). Changing it would also change a status `docs/error-edge-inventory.md`
records and the corpus compares. What a human must do to change the answer: amend the AAP to authorize
the status change, then either bind `Boom`/call `errors.forbidden()` **or** add `canEdit` to the delete
route's pre list — they are different contracts, and the amendment has to say which — and re-baseline
the affected error edges.

**Gate.** The delivered expression is unchanged on both branches, which is checkable as three code
lines in the whole file's diff, none of them in either else branch. The difference ledger is the
standing guard: because the register in [§11](#11-the-approved-deviations) does not name either site,
any change to these responses is reported as an **unapproved** difference. The per-edge status and
payload belong to `docs/error-edge-inventory.md`, whose `folders.update` and `folders.deleteFolder`
else-branch rows must read as **routed 500 edges**, not as the 403 the expressions read like.

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

### 10.3 The test-mode template watcher requires `chokidar`, which is a declared dependency again

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
BEFORE this checkpoint (measured over the committed metadata):
chokidar in package.json dependencies / devDependencies -> NO   (the ROOT declaration was removed)
chokidar declared by nunjucks 3.2.4                     -> YES  peerDependencies { "chokidar": "^3.3.0" }
                                                                peerDependenciesMeta { chokidar: { optional: true } }
chokidar in package-lock.json                           -> YES  3.6.0, recorded optional: true, peer: true

NOW (measured in the delivered tree):
chokidar in package.json dependencies                   -> YES  "^3.5.3"  (the baseline declaration, restored)
chokidar in package-lock.json                           -> YES  3.6.0, no optional and no peer flag
```

**Why the root declaration came back, and why that is a correction rather than a scope addition.** AAP
§0.5.1.3's criterion is "a declared dependency with no live consumer in retained source is removed",
and it removed `chokidar` on the reading that nothing in `lib/` or `config/` requires it *by name*.
That reading measured the wrong thing: `[T lib/util/nunjucks.js:8]` is retained application source,
`config/app.config.js` loads it at boot, and on this configuration it makes nunjucks require
`chokidar`, so the criterion was satisfied all along and the package was never dead. Driven both ways
in one tree — `chokidar` **removed from `node_modules`**, which is literally the state
`npm ci --omit=optional` produces, and then put back — each probe requiring `config/app.config` and
reporting its own outcome:

```text
chokidar PRESENT (the delivered state):
  NODE_ENV=test        -> {"loaded":true,  "error":null, "chokidarResolvable":true}
  NODE_ENV=development -> {"loaded":true,  "error":null, "chokidarResolvable":true}
  NODE_ENV=production  -> {"loaded":true,  "error":null, "chokidarResolvable":true}

chokidar REMOVED (what --omit=optional produced before the declaration came back):
  NODE_ENV=test        -> {"loaded":false, "error":"watch requires chokidar to be installed", "chokidarResolvable":false}
  NODE_ENV=development -> {"loaded":false, "error":"watch requires chokidar to be installed", "chokidarResolvable":false}
  NODE_ENV=production  -> {"loaded":true,  "error":null, "chokidarResolvable":false}
```

The production row is the one that makes the mechanism unambiguous: `chokidar` is unresolvable there
too, and `config/app.config` still loads, because `watch` is false and the loader never reaches the
`require`. So this is a **configuration-gated** dependency, not an unconditional one — which is exactly
why a by-name search of retained source missed it.

While it survived only as nunjucks' **optional peer** the tree was one install flag away from not
booting, and both sides of that were driven from the two manifest pairs alone, in directories holding
nothing but a `package.json` and a `package-lock.json` so the figures are the manifests' own:
`npm ci --omit=optional` on the pre-fix pair reports *added 421 packages* with `chokidar` **absent from
`node_modules`**, and on the delivered pair *added 435 packages* with `chokidar` **3.6.0 installed**.
In the absent state `npm test` exits **1**, its output carries
`watch requires chokidar to be installed`, and it prints **no mocha summary line at all** — no
`passing`, no `failing` — because collection dies before the first case, which is the **0 of 130** the
finding reported. With the declaration restored, `config/app.config` loads under `NODE_ENV=test` and the
suite registers and executes all 130 cases. `dependencies` rather than
`devDependencies` is the honest position and also the measured one — the consumer is production source,
baseline `2f8712a` declared it in `dependencies` at `^3.5.3` (so R-f fixes both placement and range),
and the counterfactual was driven: with the declaration in `devDependencies`,
`npm ci --omit=dev --omit=optional` installs 322 packages **without** `chokidar`, against 336 **with**
it from the `dependencies` placement. `--omit=dev` alone prunes neither, because npm does not drop an
optional peer of a production dependency — so nothing shipped was broken, and what was broken was the
manifest asserting the opposite of the measured runtime fact. The behaviour is untouched:
`lib/util/nunjucks.js` is byte-identical on both trees and `watch` still follows `isDev || isTest`,
because flipping it would be the behaviour change R-d forbids. The full row is in
[`dependency-inventory.md`](dependency-inventory.md).

The rest of this entry is unchanged, and it is an observation rather than a proposal:

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
   requires `chokidar` — now from the root declaration, which nunjucks' optional peer dedupes onto
   (`npm ls chokidar` → `chokidar@3.6.0` at the root with `nunjucks@3.2.4 └── chokidar@3.6.0 deduped`).
2. **An optional peer is satisfied by resolution, not by declaration, which is why the root
   declaration matters.** npm installs an optional peer when the graph happens to satisfy it and omits
   it silently when it does not — and `--omit=optional` omits it deliberately. That was the exposure:
   the committed lockfile pinned 3.6.0, so a plain `npm ci` was deterministic, while the repository's
   own manifest recorded nothing about a dependency every `NODE_ENV=test` and `NODE_ENV=development`
   run takes. It now records it, so the requirement survives an install variant rather than an
   accident of resolution.

**Target disposition: the behaviour is recorded and unchanged; only the declaration moved.**
`lib/util/nunjucks.js` is unchanged — AAP §0.3.1 lists it as unchanged, provisionally, under the
§0.9.2 gate — and turning the watcher off under test would be a change to a retained module outside
R-a's four categories, so it is still not made. What did change is `package.json`, in the one direction
AAP §0.5.1.3's own criterion required once the consumer was measured: the dependency is declared again.
The row and the reasoning are owned by [`dependency-inventory.md`](dependency-inventory.md).

**Gate.** Two of them, covering the two different halves of this entry. The `NODE_ENV=test` suite
exercises the application's own watching path on every run and fails at require time if `chokidar` does
not resolve — which is exactly how the missing declaration was caught, by `npm ci --omit=optional`
followed by `npm test`, and how the restored one is confirmed. The worker harness's **clean-close** check **passes**, because the
watcher never starts there — recorded in the harness's own artifact at the delivered HEAD (artifact):

```text
handles                             -> {"counts":{},"stdio":{},"allowed":[],"unexpected":[]}
templates.watchSuppressed           -> true
dependencies.templateWatch          -> configureCalls 1 · watchRequested 1 · watchApplied 0
dependencies.templateWatch.chokidar -> loaded false · modulesInCache 0 · declared TRUE ·
                                       version 3.6.0 · resolvableFrom node_modules/chokidar/index.js ·
                                       installedAs "nunjucks@3.2.4 optional peer chokidar@^3.3.0"
verdict                             -> PASS   (checks 109/109; 0 notice(s), 0 allowed)
```

`watchRequested 1` alongside `watchApplied 0` is the pair that keeps this entry honest: the
application **asked** for a watcher — which is exactly the reliance recorded above, unchanged and
still true of the application — and the harness declined to apply it before the first application
require. So there is no open handle for a gate to fail on, and equally nothing has been repaired in
`lib/util/nunjucks.js`: the reliance is recorded, not removed. The artifact's `declared` field is the
**root** declaration, and it is the one line of this block that changed at this checkpoint: it read
`false` while the root declaration was absent and reads **`true`** now — re-measured here,
`npm run verify:worker` → `VERDICT PASS`, 109/109, 0 notices. `installedAs` still names nunjucks'
optional peer because that is the provider the tool resolves the requirement through; the root now
declares the same version, and `npm ls chokidar` shows nunjucks' copy deduped onto it.

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
2. **AAP §0.7 closes the deviation register at exactly two**, the delivered register carries a third
   only because a conflict the plan did not anticipate was argued on the plan's own precedence rule
   and registered rather than absorbed ([§11.9](#119-deviation-5-the-bounded-zipcode-read-and-the-process-death-it-no-longer-causes)),
   and §11.0 above makes an **unargued** entry drift rather than a deviation. Each of the three
   controls the finding asks for is a behaviour
2. **AAP §0.7 decided two deviations, and rule T-6 admits a further one only where a requirement
   other than R-d makes preservation impossible** — §11.7 to §11.11 are the cases that have qualified since,
   and this is not it. §11.0 above makes an unapproved
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
`[T lib/models/model.js:264-283]`, and `hash` is the **sha1 of the file's contents**
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

**The course-archive analogue is [§10.14](#1014-a-private-courses-archive-is-downloadable-by-any-authenticated-user)**,
where the control is *present* and admits everyone rather than absent altogether. The two differ in
mechanism and coincide in remedy: both need a decision about what membership of a course or a material
admits before either guard can be written.

**Gate.** Route-manifest equality records the route as
`auth {declared: null, inherited: true, strategy: 'session', mode: 'try'}` with
`pre: ['file(params.fileId)']`, identically on both trees; corpus scenarios
`quirk.reply-chain.header-resolved.file-download-attachment` and
`quirk.reply-chain.never-settles.image-download` drive it, both as a **seeded, non-owning identity** —
which is the measurement, since they are served.

### 10.6 Serving the approved image response served script-capable legacy content inline — closed on the response side

**This entry exists because closing an unapproved change opened a boundary, and the boundary must be
visible as an open item rather than as a clause inside the deviation it follows from.** It was
previously a paragraph at the end of [§11.1](#111-deviation-1-the-never-settling-file-response); that
made an unresolved security exposure read as a footnote to a resolved deviation, which is the same
mistake [§11.3](#113-what-is-not-a-deviation-and-why-the-register-is-closed) corrects in the other
direction. It is numbered here, with §11.1 pointing at it.

**It is the one item in this catalogue that is NOT preserved baseline behaviour, and that is why it
reads differently from everything around it.** Every other exposure recorded here existed at
`2f8712a` and is preserved because R-d requires it. This one **did not exist at baseline** — the
branch never produced a response at all (§4.1) — so it is not preserved, it is **created** by approved
deviation 1. What was approved was *serving the bytes*; serving them as executable content on the
application's own origin was not analysed at approval time, and §11.1's approval scope is corrected to
say so. That distinction is the whole reason this is an **open item with an owner** rather than a
catalogue row: nothing in R-d protects it, and no gate will report it, so if it is not read here it is
not read anywhere.

**Measured** (Hapi 21 injection against the delivered tree, with a seeded `File` document carrying
`type: 'image/png'`, `mime: 'text/html'`, and a short
`<html><body><script>…</script>…</body></html>` body whose `size` the document records; the object read
is replaced at the module boundary so nothing reaches the network. **Re-driven while this entry was
escalated**, and every line below is that run's output):

```text
GET /api/files/<id>/<name>   ->  200
                                 content-type            text/html; charset=utf-8
                                 content-length          the document's own `size`
                                 content-disposition     ABSENT
                                 x-content-type-options  ABSENT
                                 content-security-policy ABSENT
                                 x-frame-options         ABSENT
                                 body                    byte-identical to the stored bytes,
                                                         with the <script> element intact
BASELINE, same document, same request  ->  no response at all (the request hangs)
```

Note which two fields decide the outcome together: the branch was selected on `type` (`image/png`), and
every header above was decided by `mime` (`text/html`). Neither the route nor the model relates them.

**And the bytes do not merely arrive intact — they execute.** The paragraph above was originally
written from an injection drive, which can only establish what was *served*. A subsequent drive in a
real browser, navigating **anonymously** and directly to the file URL after confirming the origin's
`localStorage` was empty, established what the served bytes then *do*:

```text
inline <script>        -> executed: document.title rewritten, body.dataset set, a heading
                          injected into the DOM, a console line emitted, and
                          localStorage on the APPLICATION ORIGIN written and persisted
<img onerror="...">    -> executed, with ZERO <script> elements in the document
SVG, root onload +     -> both executed, while the image still rendered normally
  an SVG <script>
benign 1x1 PNG         -> rendered, no script, no console output          (control)
Range: bytes=...       -> 206, carrying the same executable bytes
```

Three things follow that the injection drive could not show. The exposure is reachable **without any
session**, so it is not bounded by who may log in. The origin write **persists** after navigation, so
the impact outlives the request. And it is not carried by the `<script>` element, which is what rules
out the compromise remedy recorded below.

**The mechanism is that two independent fields decide two different things.** The branch is selected on
`file.type` `[T lib/controllers/files.js:369]` but the response is typed from `file.mime`
`[T lib/controllers/files.js:396]`. `lib/models/file.js` constrains `type` to the enum
`['embed','download']` and, at the point this was found, put **no** validation of any kind on `mime`
`[B lib/models/file.js:6-9]` — the delivered tree now validates its SHAPE, which is part of the closure
below `[T lib/models/file.js:11-17]`. So the branch is entered only by legacy documents whose `type`
carries a mime-like string, and for exactly those documents the two fields are unrelated. The route inherits `mode: 'try'`
`[B config/routes.js:202-206]`, `[T app.js:361]`, and no application-wide CSP or `nosniff` policy
compensates: the only `X-Frame-Options` is scoped to five paths `[B config/default.yaml:353-358]`.
So such a record executes active content on the application origin. **CWE-79** via stored content.

**It is distinct from [§10.5](#105-a-stored-file-is-downloadable-by-anyone-who-knows-its-id-or-its-content-hash),
and authorization would not close it.** §10.5 is about *who* may fetch the bytes; this is about what the
bytes are permitted to *do* once fetched. An authorized course reader — the identity §10.5 would still
admit — can execute same-origin content, so the two need separate remedies.

**CLOSED, and this is what closed it.** QA finding W002-I4 re-drove the exposure against the delivered
tree — anonymously, in a real browser, through three independent carriers — and raised it as a HIGH
**blocking** security finding. That finding is the decision step 2 of the old text asked a human to
make, and it is what authorises the change recorded here. Two headers are now emitted on this branch,
and nothing else about it moved `[T lib/controllers/files.js:626-636]`:

```javascript
      return h.response(stream)
        .type(request.pre.file.mime)
        .bytes(request.pre.file.size)
        .header('Content-Security-Policy', LEGACY_IMAGE_CSP)
        .header('X-Content-Type-Options', 'nosniff');
```

where `LEGACY_IMAGE_CSP` is `default-src 'none'; sandbox; frame-ancestors 'none'`
`[T lib/controllers/files.js:337]`.

**Why this is not a breach of deviation 1's approval, stated as the field test rather than as an
opinion.** That approval is a contract over five fields — the outcome changing from an expected timeout
to an answered response, the status, the content type, the body length, and the ABSENCE of
`content-disposition` ([§11.0](#110-the-register-and-why-a-tool-cannot-add-to-it) rule 3) — and
`test/parity/replay.js`'s `approvedDeviationRegister` machine-checks exactly those, its `absentHeaders`
being the single-entry list `['content-disposition']`. All five are untouched here: the three approved
calls are unchanged and the two headers sit outside them. That is also why the two obvious alternatives were REFUSED rather than
merely not preferred — substituting `application/octet-stream` for the document's own mime breaches
field 2, and falling back to an attachment disposition breaches field 4, and both were part of the
unapproved extension [§11.1](#111-deviation-1-the-never-settling-file-response) records as withdrawn.
R-d is not engaged at any point: this branch produced no response at baseline, so there is no
observable behaviour to preserve, only an exposure to close.

**Measured after the change**, same fixture and same anonymous request, driven twice — over HTTP, and
in a real browser:

```text
GET /api/files/<id>/<name>   ->  200                                             (unchanged)
                                 content-type            text/html; charset=utf-8 (unchanged)
                                 content-length          the document's own `size` (unchanged)
                                 content-disposition     ABSENT                    (unchanged)
                                 content-security-policy default-src 'none'; sandbox; frame-ancestors 'none'
                                 x-content-type-options  nosniff

browser, anonymous, the same 212-byte script-bearing payload as the drive above:
  document.title                 still "before" — never "XSS-EXECUTED"
  inline <script>                blocked: "Blocked script execution in ... because the document's
                                 frame is sandboxed and the 'allow-scripts' permission is not set"
  <img src=x onerror=...>        blocked: "Loading the image ... violates the following Content
                                 Security Policy directive: \"default-src 'none'\" ... The action
                                 has been blocked"
  localStorage                   THREW SecurityError: the document is sandboxed and lacks the
                                 'allow-same-origin' flag
  application origin afterwards  holds neither `__probe__` nor `__probe_img__`, while a control key
                                 written before the navigation is still there
```

**And the image case this branch exists for still works, which is the half a policy like this usually
breaks.** The seeded benign legacy row `000000000000000000000504` still renders: navigated directly it
is an image document that actually decoded (`document.contentType` `image/png`, `naturalWidth` 1,
`naturalHeight` 1, `complete` true), and appended as an `<img>` on an ordinary application page it
loads with the same dimensions. A response CSP is enforced for documents and workers rather than for an
image subresource, so the application embedding its own files is unaffected — measured, not assumed.

**What each header does, because they are not interchangeable and one of them is not the remedy.** The
paragraph this replaces was right about `nosniff`: it only stops a browser sniffing AWAY from the
declared type, and the declared type IS what makes the bytes executable, so on its own it closes
nothing. The CSP is the remedy. `default-src 'none'` forbids inline script and every subresource,
`sandbox` with no allow-list puts the document in an opaque origin — which disables scripting and
severs it from the application's storage and cookies — and `frame-ancestors 'none'` keeps it out of the
application's own frames. `nosniff` is retained beside it for the case the CSP does not speak to: a row
whose `mime` is inert being re-read as active content by a sniffing browser. Element filtering is still
not a remedy and was not attempted: the drive above executed an `<img onerror>` payload containing no
script element at all.

**What remains open, and one sentence of it is withdrawn as measured false.** An earlier revision of
this paragraph said the `mime` field "is now validated for SHAPE `[T lib/models/file.js:11-17]`,
`[T lib/models/file.js:68-74]` — one well-formed media type". **There is no such validator, and there
are no such lines.** Measured: `git diff --stat 2f8712a -- lib/models/file.js` prints nothing, so the
file is byte-identical to the base commit; `mime` is declared `{ type: String }` at
`[T lib/models/file.js:8]` with no validator, no `MEDIA_TYPE` pattern and no `isWellFormedMediaType`
anywhere in the tree; and the file is shorter than the second range cited. The validator was withdrawn
because it **rejected `"bogus"`** — an ordinary Content-Type the baseline accepted — which is a
behaviour change R-d forbids. So `mime` is unvalidated on both trees, exactly as baseline, and legacy
rows whose `type` and `mime` disagree still exist and are still served inline; **the CSP and `nosniff`
headers are the whole of what makes them inert**, which is what the paragraphs above measure.

**The consequence an earlier revision drew from that validation is withdrawn with it, and the reason
it was withdrawn is the same reason the validator was.** That revision recorded a save-time shape test
whose reach it called "empty in practice", on the ground that its twelve measured cases accepted every
realistic value and rejected "only shapes no parser produces (`bogus`, an embedded CR/LF, a bare `\n`,
a NUL byte, a CR/LF inside a quoted parameter)". **`bogus` is the counter-example, and it is not
hypothetical**: a multipart part may declare any token as its content type, the base commit stores
whatever arrives, and the validator turned that into a 200 whose `File` document was never persisted.
Rejecting a Content-Type baseline accepted is a behaviour change R-d forbids, whatever its security
merit, so the validator was withdrawn and `lib/models/file.js` restored to the base commit's bytes.
`files.upload`'s log-and-continue mapping on a save failure is therefore reached only by the failures
baseline reached it with, which is what §10.10 preserves.

Two follow-ups are unchanged by this closure, and neither is inside this delivery:

1. **Census** the `File` collection for documents whose `type` is outside `['embed','download']` and,
   among those, the ones whose `mime` is script-capable (`text/html`, `image/svg+xml`,
   `application/xhtml+xml`, anything `application/*script*`). That is a data question no amount of code
   reading answers, and it is what tells an operator how much legacy content is served this way.
2. **Decide whether user-controlled files should move to a separate cookieless content origin** (or
   signed storage URLs). That remains the structurally stronger remedy: it protects clients that ignore
   CSP, and it removes the question rather than answering it one response at a time.

**Gate.** The corpus scenario `quirk.reply-chain.never-settles.image-download` still passes, because
its five contract fields are unchanged and `verifyApprovedDeviation` compares those fields rather than
the whole header set. The two new headers are therefore invisible to it — a property of that verifier,
not a claim that they are untested: they are asserted directly, over HTTP and in a browser, by the
drive recorded above. A corpus recapture will record them, and the unit that owns
`test/parity/corpus.json` is named for that recapture in this checkpoint's resolution report.

---

### 10.7 The `zipCode` branch that took the process down, and the bounds that now hold it

The one entry in this catalogue whose outcome is deliberately **not** preserved without being one of the
numbered deviations in [§11](#11-the-approved-deviations). It is stated field by field for that
three numbered deviations in [§11](#11-the-approved-deviations). It is stated field by field for that
reason. The security decision is **made** — it is in the second half of this section, with its
precedence argument — and what the closing paragraph defers is only the register bookkeeping that
[§11.0](#110-the-register-and-why-a-tool-cannot-add-to-it) shares with three
other artifacts.
The one entry in this catalogue whose outcome is deliberately **not** preserved. It is therefore a
**registered deviation** — number **3** in
[§11.0](#110-the-register-and-why-a-tool-cannot-add-to-it), argued and approved in
[§11.9](#119-deviation-5-the-bounded-zipcode-read-and-the-process-death-it-no-longer-causes) — and it
is stated field by field here because this section owns the mechanism and the evidence while §11.9
owns the approval. An earlier revision of this paragraph described the entry as "not preserved
*without* being one of the numbered deviations", and deferred its registration on the ground that
§11.0's count was shared with three other artifacts. That was an accurate description of a gap and a
poor resolution of it: it left a delivered behaviour change sitting inside a preservation catalogue,
where a reader counting the register would not find it. The registration is now made, in the document
that §11.0 establishes as the canonical register, and the count in the artifacts that follow it is a
documentation follow-up rather than a reason to leave a change unregistered.

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

**The registration, which is what used to be open here.** By §11.3's own test — an approved deviation
is a prohibition argued away by a stronger requirement, whereas a shortfall is an unmet target — the
*valid archive beyond the cap* row is a prohibition argued away, and the removal of the process death
is the same. That makes this a deviation and not a preserved quirk, and it is now **registered as
deviation 5**: the row is in §11.0's table and the precedence argument, the approved field-by-field
outcomes and the cross-artifact obligation are in
[§11.9](#119-deviation-5-the-bounded-zipcode-read-and-the-process-death-it-no-longer-causes).

An earlier revision withheld that registration on a mechanical ground — that §11.0's count is also
stated by [`baseline-parity.md`](baseline-parity.md), by
[`deferred-dependencies.md`](deferred-dependencies.md) §4.2 and by
`docs/conversion-inventory.md`, so a third row added in this document alone would leave those
artifacts disagreeing about the size of the register. The ground was real and the conclusion was
wrong: those two documents each state that their deviation numbering **follows this §11**, so the
canonical count is this one, and withholding a row here to keep a follower in step inverts the
dependency and hides the change instead. The rows are now consistent in the canonical place and the
followers' wording is a documentation follow-up for the units that own them.

What needed no coordination at all, and still does not: the delivered code has **no replay-visible
difference** for this branch — no scenario drives it, and the responses are byte-identical as the table
and the sixteen-response probe above establish — so the allowlist rule, exactly one scenario id, is
untouched and correct as written, and registering deviation 5 does not widen it.

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

### 10.10 The four `output:'file'` upload routes: 415 at baseline, 200 in the delivered tree

**This entry is no longer a preserved quirk, and it is the only entry in this chapter that says so of
itself.** The baseline outcome below is unchanged and still measured; the *target disposition* is what
moved. The delivered tree declares `payload.multipart` on all four routes and answers **200** to a
conforming multipart body, which is a deliberate departure from baseline and is registered as
**deviation 7** in [§11.11](#1118-deviation-14-the-four-outputfile-upload-routes-accept-multipart-and-answer-200).
The baseline half stays here because the register entry argues from it; the decision, the precedence
argument and the field-by-field contract are there.

An earlier revision of this section described the delivered tree as preserving the 415 and was
**contradicted by the tree it describes** — the routes had already been changed. Three of its claims
are withdrawn explicitly below, because a reader who saw them needs to know which.

**Measured, baseline** (**static**, plus two per-major listener probes). At `2f8712a` every upload route
declares `payload : { maxBytes, output : 'file' }` and **no `multipart` key**:

| Route | Binding | Baseline payload declaration |
|---|---|---|
| `POST /file` | `files.upload` | `[B config/routes.js:336-351]` — `maxBytes: 1048576 * 10`, `output : 'file'` |
| `POST /file/avatar` | `files.uploadAvatar` | `[B config/routes.js:352-370]` — `maxBytes: 1048576 * 5`, `output: 'file'` |
| `POST /api/users/assets` | `users.assetUpload` | `[B config/api_routes.js:1238-1252]` — `maxBytes: 1048576 * 5`, `output : 'file'` |
| `POST /api/users/assets/{fileId}` | `users.replaceAsset` | `[B config/api_routes.js:1253-1268]` — `maxBytes: 1048576 * 5`, `output : 'file'` |

Without `payload.multipart`, hapi does not accept a multipart body at all: it refuses the media type
before the handler exists. Driven as an authenticated session against a running baseline server with a
real `multipart/form-data` body carrying a file part, **all four answer 415 Unsupported Media Type**
(**probe**). The handlers behind them — which read `request.payload.upload` and `request.payload.file`
— are therefore not reached by a multipart client on the baseline tree.

**And it is not a framework-major change, which is the half worth measuring rather than assuming.** The
same declaration was driven on a real listener carrying nothing but the repository's own payload block,
once per hapi major, from that major's own installation (**probe**):

```text
hapi 20.3.0   payload{output:'file'}, multipart NOT set, multipart/form-data POST  ->  415
hapi 21.4.10  payload{output:'file'}, multipart NOT set, multipart/form-data POST  ->  415
```

So the migration neither introduced the 415 nor could have removed it by bumping the framework. A
reader who finds the baseline upload routes unreachable by a browser form is looking at a 2013-era
declaration.

**The delivered tree does not preserve it, and an earlier version of this entry said it did.** That
sentence — "Target disposition: preserved" — was **stale**, and it is corrected here. All four routes
now declare the output on `multipart` instead of on the payload
`[T config/routes.js:373-376]`, `[T config/routes.js:411-414]`,
`[T config/api_routes.js:1296-1299]`, `[T config/api_routes.js:1317-1320]`:

```javascript
      payload : {
        maxBytes  : 1048576 * 10, // 10MB
        multipart : { output : 'file' }
      }
```

so the target **accepts** `multipart/form-data` where the baseline refused it. This is a behaviour
change, and a widening one. The reasoning behind it is recorded at length beside each declaration and
is not weak: with the baseline declaration no upload can succeed on any of the four routes, so no
`File` document and no stored object is creatable through the application at all, and two existing
cases (`test/lib/api/files.js:48,74`) cannot pass. Moving the key rather than merely adding
`multipart: true` is also load-bearing in the other direction — `output` at the payload level spools
**every** body class to a temp file, whereas on `multipart` subtext takes the part output from
`options.multipart.output` and parses a JSON or raw body as data
`[node_modules/@hapi/subtext/lib/index.js:290]`.

**What is missing is not the argument but the approval.** This change is not one of the numbered
deviations in [§11](#11-the-approved-deviations), it is not in the register
[§11.0](#110-the-register-and-why-a-tool-cannot-add-to-it) rule 1 enumerates, and it predates this
checkpoint. It is recorded here as an **unregistered target-only behaviour change**, and this entry
does not approve it: a document cannot approve a deviation, and the unit that found it is not the unit
that made it. **What a human must do:** either register it as a numbered deviation with its own
precedence argument — the argument above is the material for one — or revert the four declarations to
the baseline form and accept that the upload routes, the avatar Dropzone, the asset browser and the two
`files.js` cases stay unreachable.

**What this checkpoint did about the consequence, which is separable from the approval.** Accepting
multipart made two defects reachable that the 415 had been hiding, and both were raised against the
delivered tree:

- **QA finding W001-F04.** `POST /file` and `POST /file/avatar` declared a `validate` block, and the
  route parser's validation-failure funnel answers `request.fail(request.payload, …)`
  `[T lib/util/routeParser.js:867-884]` — which serves the rejected payload back at status **200**. For
  a multipart body that payload carries the spooled part as `{path, bytes, filename, headers}`, so a
  request with a valid file part and an invalid `type` field answered 200 disclosing the absolute
  server filesystem path of the spooled upload. Measured before: `200` with
  `"path":"/tmp/parity-server-…/uploads/1788859222937-…"`. The `validate` blocks are now removed from
  both routes with the reason recorded in place, `files.upload` and `files.uploadAvatar` enforce the
  same contract themselves, and each answers **400** with the Joi message text, no payload echo, and
  the spooled part unlinked before it returns. Measured after: `400`
  `{"statusCode":400,"error":"Bad Request","message":"\"type\" must be one of [embed, download]"}` and
  `"\"upload\" is required"`, with no `path`, no `bytes` and no `/uploads/` substring in any rejection
  body. The funnel itself is unchanged and out of scope for this delivery. One further difference goes
  with the status change and is recorded because a reader would otherwise meet it as a surprise: the
  rejected 200 was a `request.success`-shaped body, so it **read and thereby drained** the session's
  pending yar flash — measured, `flash: {}` on the next successful upload — whereas a `Boom` does not touch
  yar at all, so a `requested` entry left over from signup is now delivered on the next response that
  does read it (measured, `flash: {"requested":["testing"]}`). Nothing is lost and nothing is added;
  the entry is consumed one response later. No shipped client reads that key from this route's
  response.
- **QA finding W001-F16.** The avatar gate is now reachable, and it answered 500 rather than the 415
  the baseline produced, because it called back a plain `Error`. It now calls back
  `Boom.unsupportedMediaType` — recorded at the end of this section.

**The identical disclosure survives on the sibling pair, and this is where it is recorded.**
`POST /api/users/assets` and `POST /api/users/assets/{fileId}` keep both halves at once — the
`multipart : { output : 'file' }` declaration **and** a `validate` block
(`file : Joi.any().required()`) `[T config/api_routes.js:1300-1304]`,
`[T config/api_routes.js:1321-1325]`. A multipart body whose file part is named anything other than
`file` therefore still reaches the same funnel and still answers 200 with the spooled part's absolute
path. Those two declarations and their handlers in `lib/controllers/users.js` belong to other units at
this checkpoint, so the fix is reported rather than made here; the fix shape is the one applied above,
and it is less exposed only because both routes sit behind `features.assets`, which is `false` in
committed configuration and true only under the parity overlay.

**What it means for the other gates, stated so it is not mistaken for a gap.** The corpus recorded
415-from-the-payload-parser for the multipart client-contract scenarios and 200-with-echo for the two
`POST /file` scenarios; both are now different, so those scenarios need a recapture, which the unit
owning `test/parity/corpus.json` is named for in this checkpoint's resolution report. Removing the two
`validate` blocks also moves both routes from `["payload"]` to `[]` in the route manifest's `validate`
field and takes `verify:joi`'s target count from 102 to 100 — recorded against
`test/parity/manifest.js` and `test/parity/joi-baseline.json` in the same report — while the route
**table** (method, path, auth) is byte-identical either way. The storage contract of AAP §0.6.7 — the
sha1 content key, the suffix and extension branches, the content-type override and the avatar gate — is
still proved by `test/parity/storage.js` against `lib/util/file.js` directly, independent of what the
HTTP layer accepts.

**The avatar gate now answers 415 rather than 500.** `uploadUserAvatar` accepts only
`/^image\/(png|jpg|jpeg)$/` and rejected everything else with `cb(new Error('unsupported image type,
must be png or jpg'))` `[B lib/util/file.js:239-243]`. A plain `Error` carries no status, so the
handler's funnel mapped it to `Boom.badImplementation` and the browser was answered **500** with the
reason suppressed — while the baseline answered **415** to the same request, from the payload parser,
for the unrelated reason above. The gate now calls back
`Boom.unsupportedMediaType('unsupported image type, must be png or jpg')`
`[T lib/util/file.js:249]`, so a `gif` avatar answers **415**
`{"statusCode":415,"error":"Unsupported Media Type","message":"unsupported image type, must be png or
jpg"}` (**probe**, measured before and after). The status matches baseline; the body does not, and
cannot — baseline's 415 came from the parser with the parser's own message and never reached this
gate. The accepted set, the regexp and the message string are unchanged, so no image that uploaded
before is refused now.

**One client-visible change went with it, and it is a narrowing.** The avatar Dropzone advertised
`acceptedFiles: "image/jpeg,image/png,image/gif,image/jpg"` and told the user "Picture format must be
one of png, jpeg, jpg, or gif" `[B lib/views/users/includes/profile.html:90,108]`
(`[T …:98,116]` before this change), while the gate has
never accepted `gif` on either tree. The accept list and the message now name only the three formats
the gate accepts `[T lib/views/users/includes/profile.html:99,122]`, so the file picker no longer
offers a selection that is certain to be refused. This is a change to client-visible page behaviour and
is recorded as such: it was the remedy the finding itself proposed, it removes a promise the server
never kept rather than a capability, and every format the server accepts is still offered. A user who
drags a `gif` in is now refused by the client instead of by a 415.
So the 415 is a 2013-era declaration rather than anything the framework bump did, which is the half
worth measuring rather than assuming: the migration neither introduced it nor could have removed it by
changing hapi majors.

**Measured, delivered tree** (**static** plus **probe**, driven on the running application at
`127.0.0.1:3290` with the parity fixtures loaded). All four routes now declare
`payload : { maxBytes, multipart : { output : 'file' } }`, and **all four carry `auth: 'session'`**:

| Route | Delivered declaration | Auth | Conforming `multipart/form-data` body |
|---|---|---|---|
| `POST /file` | `[T config/routes.js:373-376]` | `auth: 'session'` | **200**, and a `File` document is created |
| `POST /file/avatar` | `[T config/routes.js:395-398]` | `auth: 'session'` | **200** |
| `POST /api/users/assets` | `[T config/api_routes.js:1296-1299]` | `auth: 'session'` | **200** |
| `POST /api/users/assets/{fileId}` | `[T config/api_routes.js:1317-1320]` | `auth: 'session'` | **200**, replacing in place on the same row |

Four further outcomes were driven, because "answers 200" on its own would leave the widening question
open:

- **The stored object still keys on the content sha1**, which is AAP §0.6.7's contract. A 67-byte PNG
  uploaded to `POST /file/avatar` stored as `b9ed0c6766bd6b80d85b9b57e8f45183af48dbe2.png`, the sha1 of
  those bytes; the same bytes through `POST /api/users/assets` stored as `<sha1>-<fileId>.png`; and the
  replace route wrote a new sha1 on the same row. So enabling the parser did not move the key.
- **Anonymously, the parser is never reached.** A conforming multipart `POST /file` with no session
  answers **302** to `/login` — measured. The previous revision's "unauthenticated-shaped input"
  concern does not describe these routes.
- **A non-conforming part is refused.** A part whose header reads `Content-Disposition: attachment`,
  which is what `superagent` 0.8 emits and RFC 7578 §4.2 forbids, answers **400 `{"statusCode":400,
  "error":"Bad Request","message":"Invalid multipart payload format"}`** — measured by sending both
  part forms to the same route in one probe.
- **A non-multipart body is parsed as data, not spooled.** An empty `POST /file` answers **200**
  `{"flash":{"validation":{"":"\"value\" must be of type object"}}}`, where baseline answered 200
  `{"path":"<upload-path>","bytes":0,"flash":{"validation":{"upload":"\"upload\" is required"}}}` —
  baseline's `output : 'file'` at the payload level spooled every body class to a temp file and the
  hand-rolled validation echoed the absolute path back. Declaring the output on `multipart` instead is
  what removes that disclosure, and it is why the delivered declaration is not simply `multipart: true`.

**The suite's own two upload cases prove the handler is now reached.** `test/lib/api/files.js`'s upload
cases answer **501 `File uploads are not enabled`** — `lib/controllers/files.js:277-279`'s own
feature-flag branch, reached because `config/default.yaml`'s `features.assets` is `false` and the suite
runs without the parity overlay. A 501 from inside the handler is only reachable if the payload parser
passed the body through, which under baseline's declaration it never did.

**Three claims of the previous revision, withdrawn.** (1) "Every upload route … declares
`payload : { maxBytes, output : 'file' }` and **no `multipart` key**" — true of baseline, false of the
delivered tree, where `grep -c multipart config/api_routes.js` is 7 and all four routes declare it.
(2) "The handlers … are therefore not reached by a multipart client on either tree" — false on the
delivered tree, twice over: a conforming client gets 200 and the suite's cases reach the feature flag.
(3) "It would newly admit a parser and a storage path to unauthenticated-shaped input on `POST /file`" —
false: all four routes require a session and an anonymous attempt is redirected before the parser runs.

**Target disposition: NOT preserved — registered as deviation 7**
([§11.11](#1118-deviation-14-the-four-outputfile-upload-routes-accept-multipart-and-answer-200)).

**What it means for the other gates, stated so it is not mistaken for a gap.** Two things changed here,
and only one of them was already true:

- The **storage contract** of AAP §0.6.7 — the sha1 content key, the suffix and extension branches, the
  content-type override and the avatar gate — is still proved by `test/parity/storage.js` against
  `lib/util/file.js` directly, which is why it was gateable even while the HTTP paths refused multipart.
  What is new is that the same key is now observable through the routes as well, and the values above
  agree with the util-level contract.
- The **corpus** is no longer indifferent to this. Two committed scenarios record the 415 as their
  baseline and state it as their expectation —
  `client-contract.multipart-upload.api-user-assets` and
  `client-contract.multipart-upload.api-user-assets-replace`, both `expectedDeviation: null`, both
  recorded `415 {"statusCode":415,"error":"Unsupported Media Type",…}` — and replaying their **exact
  recorded payload bytes** against the delivered tree answers **200** on both (measured, object key
  `a3e133512b4ae0f3216c1d08b2dd5800a0d6fad2-<fileId>.gif`, the sha1 of the recorded part body). The six
  route-sweep scenarios `route.post.file{,-avatar}.{html,json}` and
  `route.post.api-users-assets{,-fileId}.json` also differ in body, per the empty-payload measurement
  above, while staying 200. `test/parity/corpus.json` is owned by the unit that owns the replay gate, so
  the annotation those eight scenarios need — a `targetExpectation` and the deviation-7 marker — is
  named here and handed over rather than written here; until it lands, the replay reports them as
  unregistered differences, which is the correct reading of an un-annotated corpus and not a second
  defect.

### 10.11 `request.fail(err)` with an `Error` argument terminated the process — repaired, and why

The harshest outcome in this catalogue, and the same finder re-delivery that
[§9.9](#99-two-routed-handlers-that-answer-200-carrying-the-name-of-a-missing-identifier) records is
what reaches it — `.catch(cb)` at `[B lib/models/model.js:147]` on the baseline, the
`$handleCallbackError` override at `[T lib/models/model.js:195-219]` on the delivered tree, with the
same one-argument second invocation either way. It is a **baseline defect**, it is **fixed on the delivered tree**, and this section
carries the measurement, the argument for fixing it rather than preserving it, and the one piece of
bookkeeping the fix leaves for the artifacts that do not belong to it.

**Two corrections to what this section said before.** They are stated up front because both were
wrong in the same direction — too broad — and a reader who acted on either would draw the wrong
conclusion about which routes were affected.

1. The blanket claim that *"these nine edges terminate the process"* was **imprecise**. Only the edges
   that reach `request.fail`'s **third** branch — `h.response(json)` — ever died. An `html` route
   carrying a `fail.redirect` takes the **first** branch instead: it flashes, interpolates and
   redirects, and an `Error` argument travels that path without ever meeting the toolkit's assert.
   **Measured**: `POST /send-pass-reset` (`[T lib/controllers/users.js:391]`, unauthenticated,
   `fail:{redirect:'/forgot-pass'}` at `[T config/routes.js:261-266]`) answered **200** with the
   process **alive**. The dying population was the `/api/`-shaped, JSON-negotiated subset.
2. The claim that the corpus gate *"would report a build that answered this route normally as an
   unapproved difference — including one that 'fixed' it"* described the mechanism correctly and drew
   the wrong conclusion from it. The gate reporting a difference is not an argument for keeping a
   process death; it is a statement that the difference needs a register entry. The entry is specified
   at the end of this section.

**The mechanism, in one line each.** `request.fail(json, err)` treats its first argument as a body:
`[T lib/util/routeParser.js:316]` calls `h.response(json)`, and hapi's toolkit refuses to wrap an
`Error` —
`Hoek.assert(result instanceof Error === false, 'Cannot wrap an error')`
[`node_modules/@hapi/hapi/lib/toolkit.js:191`]. The throw happens inside a database callback rather
than inside the handler's own frame, so no lifecycle catch is between it and the process:

| Tree | `request.fail`'s `h.response(json)` | The caller that passes an `Error` | Thrown |
|---|---|---|---|
| Baseline | `[B lib/util/routeParser.js:510]` | `[B lib/controllers/admin.js:160]`, `updateUser` — `if (err) return request.fail(err);` | `Error: Cannot wrap an error` |
| Delivered | `[T lib/util/routeParser.js:316]` | `[T lib/controllers/admin.js:221]`, `updateUser` — `if (err) return resolve(request.fail(err));` | `AssertError: Cannot wrap an error` |

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
                                       [T lib/controllers/admin.js:225], inside the findById callback
  2. [T lib/models/model.js:195-219] -> the $handleCallbackError override re-invokes the SAME
                                       callback with that TypeError; .catch(cb) at
                                       [B lib/models/model.js:147] did that on the baseline
  3. [T lib/controllers/admin.js:221] -> if (err) resolve(request.fail(err))
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
`lib/controllers/admin.js:169`, `:221`, `:228`, `:244`, `:292` and `lib/controllers/users.js:328`,
`:391`, `:724`, `:869` — against nine on the baseline (five in `admin.js`, four in `users.js`), so the
population is unchanged by the migration (**static**). The five `admin.js` locators moved 44 to 45
lines lower when [§11.6](#116-a-third-unapproved-policy-in-the-admin-controller-and-now-withdrawn)'s
withdrawal removed 175 lines from that file; the call sites themselves are byte-identical and
untouched, and the population is still nine against nine. §11.4 records one further instance of the same
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
population is unchanged by the migration (**static**). What differs per site is the branch the site's
own route reaches, which is the correction above: `users.js:391` redirects and survives, and the sites
on JSON-negotiated `/api/` routes are the ones that died. §11.4 records one further instance of the
same defect on the asset-upload path, unreachable while `features.assets` ships `false`; the
`admin.js:265` instance was reachable by any admin sending a payload-less POST, and any of the nine
whenever a model callback yielded an error.

**A second, independent way the same route took the process down, and it is fixed in the controller
rather than in the funnel.** `[T lib/controllers/admin.js:212-252]` runs its body inside the callback
`csv`'s `parse()` invokes, which is reached from `Parser.emit` and not from the handler's frame, so
**any** throw in that body escapes the promise the lifecycle method returns. Two throws were measured
from one route, `POST /admin/upload`, with an admin session:

```text
TARGET (probe, before the fix) POST /admin/upload, admin identity
  A. userList='this is "not, a csv at all" ,,, garbage'
     -> csv parse error -> request.fail(err) -> h.response(Error)
     -> AssertError: Cannot wrap an error, uncaught
     observed: curl exit 52 (empty reply), then connection refused - no process remains
  B. userList=$'Foo,Bar\nalpha,beta\n'   (no Email column)
     -> userInfo.Email undefined -> lib/util/user.js:7 user.replace(...)
     -> TypeError: Cannot read properties of undefined (reading 'replace'), uncaught
     observed: curl exit 52, process gone; the admin's browser shows ERR_CONNECTION_REFUSED
```

Fixing `request.fail` closes A. B needed the callback itself to have somewhere to throw **to**: the
promise is now created with a `reject`, and the callback body is wrapped so a thrown value rejects the
lifecycle method's promise instead of escaping to the process. The value is passed through unchanged,
so it lands on the Layer 1 catch-all `[T lib/util/routeParser.js:801-812]` — `log.error(err.stack)`
and `Boom.badImplementation`, a 500 — which is the funnel that same throw would have reached had it
happened on the handler's own stack. `lib/util/user.js` is deliberately **not** guarded: giving
`generate_username` a fallback for a missing column would invent an outcome this route has never
produced, which is the improvement R-d forbids, whereas routing the throw to the existing funnel is
what R-e asks for.

**Target disposition: REPAIRED. R-b controls, and the argument is this delivery's own.** An earlier
revision of this section preserved the death on the ground that mapping an `Error` argument would give
these edges "a status and a body they have never produced". That reasoning does not survive contact
with what the death actually is. R-b is unqualified — the application must genuinely run, with no route
or module excluded — and [§11.1](#111-deviation-1-the-never-settling-file-response) decided the
comparable conflict on the ground that **the absence of a response is not a behaviour a client can
depend on**. A process death is that argument at its strongest, and
[§10.7](#107-the-zipcode-branch-that-took-the-process-down-and-the-bounds-that-now-hold-it) already
states the conclusion verbatim: *what the crash destroys is not this branch's behaviour but every
other route's, so R-d's protection does not reach it.* This delivery applied that rule three times to
remove a process death — §10.7's `zipCode` expansion, §11.1's never-settling response, and §11.4's
asset URL-scheme rejections — and this edge is a stronger case than any of them, because the caller is
sometimes **unauthenticated**, the client receives **no response at all**, and every other session on
the process is destroyed with it. R-e is satisfied rather than breached: the edge now reaches the same
Layer 1 funnel, with the same 500 and the same generic Boom payload, that its own throw would have
reached on the handler's stack.

Three QA findings raised it independently and all three asked for the same one-line remedy: `ux-F42`
(CRITICAL, `POST /admin/upload` — "full site outage"), `obs-requestfail-error-arg-process-kill` (HIGH,
measured at `admin.js:265` under an injected model fault and at `users.js:869` under an `ENOTDIR`
store fault) and `perf-malformed-csv-kills-process` (HIGH, measured on **both** trees).

**What the delivered code does.** `[T lib/util/routeParser.js]` `request.fail` gained a fourth arm,
placed **after** the redirect and `fail.html` branches and **before** `h.response`:
`else if (json instanceof Error) { return Boom.boomify(json); }`. Placement is the whole of the
behaviour preservation — the two branches above it are byte-identical, so the redirect case measured
at 200 above still redirects and a `fail.html` route still renders its view with the `Error` as
context. `Boom.boomify` returns an existing Boom untouched, so a caller passing `Boom.notFound()`
still answers 404, and initializes any other `Error` at 500. The `log.info` line above the branches is
unchanged in level and position (its credential values are now withheld — see
[`error-edge-inventory.md`](error-edge-inventory.md), log hygiene).

| | Baseline `2f8712a` | Delivered |
|---|---|---|
| `request.fail(Error)` on a JSON/`h.response` edge | `Error: Cannot wrap an error`, uncaught, **process exits**; client gets no response | **500**, generic Boom payload, process alive |
| `request.fail(Error)` on an `html` + `fail.redirect` edge | flashes and redirects; **200/302**, alive | identical |
| `request.fail(Error)` on an `html` + `fail.html` edge | renders the view with the Error as context | identical |
| `request.fail(plainObject)` — every other caller | its own branch's response | identical |
| A throw inside `admin.uploadUsers`'s csv callback | uncaught, **process exits** | 500 through Layer 1, `err.stack` logged, alive |

**Gate.** Runtime, on a running server (probe, port 20140, admin session): `POST /admin/upload` with
the malformed CSV of case A answered rather than severing the connection and the process stayed up;
the case-B roster with no Email column answered 500 with `log.error` carrying the TypeError's stack;
a payload-less `POST /api/admin/user/{userId}` answered with the process alive.
**What it answers is not the 500 an earlier revision of this line recorded, and the difference is a
second fix in a second file.** Re-measured on the delivered tree (`test/parity/capture.js --target
--only route.post.api-admin-user-userId.json`): **200** `application/json`, **68 bytes**,
`{"message":"roles required","flash":{"requested":["administrator"]}}`, in **12.335 ms**. The 500 was
what `request.fail`'s new `Error` arm produced while the controller still read `.roles` off a null
payload; `[T lib/controllers/admin.js:290]` now reads `var roles = request.payload &&
request.payload.roles` **before** entering the `findById` callback and answers
`request.fail({ message : 'roles required' })` when it is absent, which is the same funnel and the same
argument shape its two neighbouring guards already used. That is approved deviation **16**
([§11.22](#1122-deviation-16-the-payload-less-roles-update-answers-where-the-baseline-process-exited)),
and the `Error` arm measured here is untouched by it: any of the other eight `request.fail(err)` sites
still reaches the boomified 500.

The redirect arm was then proved undisturbed at the *same* error edge rather than at a different
route, which is the stronger form of the check. `POST /login` with a valid `email` and no `password`
drives `bcrypt.compare(undefined, hash)` to throw `Error: data and hash arguments required`, which
`[T lib/controllers/users.js:328]` hands to `request.fail` as a first-argument `Error`. Negotiated
as HTML — where `POST /login` declares `fail: {redirect: '/login'}` — it answered **302 to
`/login`**, byte-identical to baseline, because branch 1 runs before the new `Error` arm is
consulted. The identical fault negotiated as JSON, on `POST /api/users/login`, reached the
`h.response` arm and answered **500** with hapi's generic Boom payload where baseline severed the
connection and exited. One edge, two arms, one preserved and one repaired — which is the whole
shape of this correction. `POST /send-pass-reset` was also driven and answered **302 to
`/forgot-pass`** with the process alive (QA recorded this route as `200`, which is the same
observation with redirects followed; the redirect is what the route emits). The
per-edge status belongs to [`docs/error-edge-inventory.md`](error-edge-inventory.md), whose rows for
these nine sites now read as **Layer 2 edges that answer**, with the `Error`-argument arm named
explicitly on each — that document and this one agree, which resolves the contradiction QA finding
`int-error-edge-inventory-contradicts-quirks-1011` raised.

**The one piece of bookkeeping this fix leaves open, stated rather than papered over.** The repair is
**replay-visible on exactly one committed scenario**, and the artifacts that record the approved-
deviation register are owned by other units of this checkpoint, so — following the same reasoning
[§10.7](#107-the-zipcode-branch-that-took-the-process-down-and-the-bounds-that-now-hold-it) gives for
not minting a row in this document alone — the count in [§11.0](#110-the-register-and-why-a-tool-cannot-add-to-it)
was **not** amended by this section acting alone. **It has since been amended by the unit that owns
§11.0, and the bookkeeping below is therefore closed rather than owed.** §11.0's table remains the
register of record; its extent is **eighteen** numbered entries of which **thirteen** are live, this
repair is deviation **16**, and the "exactly two" figures this paragraph recorded as outstanding in
[`deferred-dependencies.md`](deferred-dependencies.md) and in `test/parity/replay.js` have both been
corrected — §12's divergence-3 table carries the per-file measurement and names `CHANGELOG.md` as the
one file still holding a stale figure. What the entry needed is kept below, because the *shape* of the
specification is what a future entry is written against, with each field corrected to what was
measured rather than to what was predicted:

- **Scenario**: `route.post.api-admin-user-userId.json` (`test/parity/corpus.json`, order 273,
  identity `admin`, `payloadEncoding: "none"`), whose baseline step records
  `ok: false, "transport failure: socket hang up (ECONNRESET)"`.
- **Register entry** for `approvedDeviationRegister()` in `test/parity/replay.js`, in the shape
  deviation 1 already uses. **Delivered, and two fields differ from what this bullet predicted**:
  `fromOutcome: OUTCOME_TRANSPORT`, `toOutcome: OUTCOME_ANSWERED`, **`status: 200`** — not the 500
  predicted here, for the reason the Gate paragraph above measures — `contentType:
  'application/json'`, **`bodyLength: null`**, deliberately not pinned because the body carries the
  session flash and `request.yar.flash()` with no argument reads *and clears* everything, so the
  length is sequence-dependent and is not a property of what was approved (§3), `number: 16`,
  `describedIn: 'docs/preserved-quirks.md §10.11 and §10.12, with the argument at
  lib/controllers/admin.js:265-297'`, `approvedIn: 'AAP §0.7, rule R-b'`, `summary`: "the payload-less
  roles update answers 200 `{\"message\":\"roles required\"}` through the route's own funnel where the
  baseline process exited".
- **Marker**: the scenario needs the approved-change marker §11.0 rule 2 requires. **It has one, and
  it comes from a third source this bullet did not anticipate**: `registerMarker(contract)` projects it
  from the closed register itself. The corpus route was measured to be unusable here — the marker would
  have to be written by an edited `test/parity/capture.js`, and `replay.js` refuses a corpus whose
  generator is not the delivered blob, so the re-capture would disqualify the gate the marker exists to
  satisfy. §11.0's marker-source table records the same measurement for deviations 9, 16 and 17.
  `npm run verify:corpus` reports **exit 0** with this scenario among its approved deviations.
- **The blast radius is four scenarios, not one**, and an earlier draft of this section said one. The
  corpus was re-read to settle it: exactly **seven** committed scenarios carry a
  `driven.transportFailure`, and they form **two** cascades, because a process death takes the
  scenarios that follow it down too.

  | Order | Scenario | Recorded transport failure | Cause |
  |---|---|---|---|
  | 273 | `route.post.api-admin-user-userId.json` | `socket hang up (ECONNRESET)` | **this funnel** — the death itself |
  | 274 | `route.post.api-admin-user-userId-grant.json` | `read ECONNRESET` | aftermath: the socket of the process that had just died |
  | 275 | `route.post.api-comments-trinketId.json` | `connect ECONNREFUSED` | aftermath: nothing listening any more |
  | 276 | `route.post.api-courses.json` | `connect ECONNREFUSED` | aftermath: nothing listening any more |
  | 62 | `route.post.userSlug-courses-courseSlug-copy.html` | `socket hang up (ECONNRESET)` | a **different**, deliberately preserved death — see below |
  | 63 | `route.post.userSlug-courses-courseSlug-copy.json` | `read ECONNRESET` | aftermath of order 62 |
  | 64 | `route.put.api-courses-courseId-invitations-invitationId-email.json` | `connect ECONNREFUSED` | aftermath of order 62 |

  So repairing this funnel makes orders **274, 275 and 276** drivable for the first time as well as
  273. All four recorded a transport failure and all four will now answer, so all four present as
  `transport-failure → answered` and all four need to sit under the one register entry above.

  **Orders 62 to 64 are not this funnel and must not be swept into the same entry.** That death is in
  `courses.copy` (`[T lib/controllers/courses.js:133]`), whose own comment records it as intentional:
  the model calls back with no document, the URL interpolation then throws a `TypeError` reading
  `slug` of `undefined` *inside mongoose's save callback*, mongoose re-emits it as a model `error`
  event, nothing listens for it or for `uncaughtException`, and the process terminates. It reaches no
  funnel at all — including this one, because `POST /{userSlug}/courses/{courseSlug}/copy` declares
  `fail: {redirect: '/welcome'}` and would have taken the redirect arm regardless. It is owned by the
  controller that carries it and is preserved there deliberately; nothing in `request.fail` can reach
  a throw on another stack.

- `route.post.admin-upload.html` and `.json` are **unaffected**, also verified: both drive with no
  payload, so they die in the handler body on `request.payload.userList` and were already answered
  **500** by Layer 1 on both trees. The malformed-CSV and missing-Email-column inputs that reach the
  csv-callback edge repaired above are not in the committed corpus at all, so that repair is
  invisible to `verify:corpus` and is evidenced by the runtime probe instead.

---

### 10.12 `POST /api/admin/user/{userId}` answers nothing at all when the payload carries no `roles`

**Measured** (**probe**, both trees, live servers, admin session).

`admin.updateUser` has one conditional and **no `else`**: `[B lib/controllers/admin.js:164]`, delivered
at `[T lib/controllers/admin.js:225]`, tests `if (request.payload.roles)`, and the route declares no
validation (`config/api_routes.js`, `POST /api/admin/user/{userId}`, `auth: 'session'` with
`pre: ['isAdmin(user)']` and no `validate` block). A payload that omits `roles` therefore falls off the
end of the `User.findById` callback without producing anything, and **the request is never answered**.
The mechanism differs between the trees and the outcome does not: baseline's handler returns
`undefined` synchronously and the shim's deferred is never resolved, while the delivered handler
returns a `Promise` that never settles.

**Measured, identical on both trees, three attempts each:**

```text
POST /api/admin/user/{userId}   Content-Type: application/json   {}      (admin session)
  baseline 2f8712a -> no response; client timeout at 10.002 s; the server survives and serves again
  delivered tree   -> no response; client timeout at 10.002 s; the server survives and serves again
```

**This is a distinct edge from [§10.11](#1011-requestfailerr-with-an-error-argument-terminated-the-process--repaired-and-why),
and confusing the two loses one of them.** With **no payload at all** — no body and no content type —
`request.payload` is `null`, `request.payload.roles` raises a `TypeError` inside the `findById`
callback, the finder re-delivers that error to the same callback — `.catch(cb)` at
`[B lib/models/model.js:147]` on the baseline, the `$handleCallbackError` override at
`[T lib/models/model.js:195-219]` on the delivered tree — and
`request.fail(Error)` **terminates the process** on both trees; that is §10.11's outcome and its gate
records it. With a **well-formed empty payload** the same route hangs forever and the process lives.
One route, two payload shapes, two entirely different failures.

**Target disposition: preserve the non-settlement. Add no `else`, and add no validation to the route
declaration.**

**On rule T-1, stated as the unresolved conflict it is rather than as a settled question.** An earlier
revision of this section claimed T-1 was "satisfied literally", paraphrasing it as "return a value,
return a promise, or throw". That paraphrase drops the operative words. T-1 reads: *"Any function hapi
invokes returns its response value, **returns a promise of one**, or throws."* A promise that never
settles is not a promise **of a response value**, so on the AAP's own wording **this path does not
satisfy T-1**, and the earlier claim is withdrawn. What is true, and much narrower, is that the
*framework* does not object: hapi converts only an `undefined` return into
`Boom.badImplementation` (`node_modules/@hapi/hapi/lib/toolkit.js:80-81`), and a pending promise is not
`undefined`, so nothing in hapi 21 detects this. The route simply never answers.

**Why it is nevertheless preserved, and what that leaves owing.** Three requirements point the other
way and they are prohibitions rather than design rules: the non-answer is **measured identical on both
trees**, so R-f makes it the baseline fact; answering here — with a `{success:false}`, a 400 or a Boom
— is a behaviour improvement R-d prohibits and a new error-to-response mapping R-e prohibits; and
the approved-deviation register was **closed at fifteen**, none of them this, with §11.0
recording that the list "is not extensible by a tool" — and each of the six admitted after AAP §0.7
met rule T-6's impossibility test, which this route did not, because it answers.
**Every clause of that reasoning has since been overtaken by measurement, and the correction is at the
end of this section.** The AAP's own parity evidence points the same
way: `test/parity/corpus.json`'s `route.post.api-admin-user-userId.json` records this route's status as
`None`, so the migration's committed baseline evidence already treats the non-answer as this route's
recorded state.

**So this is a genuine collision between T-1 and R-d/R-f/§0.7, and it is one the frozen AAP does not
decide.** §0.1.2's rule T-6 provides for exactly this — a requirement other than R-d making
preservation impossible — but reserves the decision to the plan, and the plan decided two such
conflicts, neither of which is this one. Minting a third here would be the tool extending the register,
which §11.0 forbids. **The disposition is therefore: preserve, and record the T-1 gap as owed rather
than as satisfied.** Closing it needs a human AAP amendment adding a third approved deviation, after
which the fix is small — settle the no-op path with a defined response, or require a typed `roles`
array in the route's validate block — and the corpus entry above must be recaptured with it.

**What preservation leaves exposed — recorded, not repaired.** Each such request holds a socket, a
hapi request object and the resolved `User` document until the client gives up, so an authenticated
administrator can accumulate them; the ceiling is the server's connection limit rather than anything
this handler imposes. What controls preservation is R-d and R-f. **Named follow-up:** declare
`roles` as required in the route's `validate.payload` so the hand-rolled block refuses the shape before
the handler runs, as a separately approved change, with the corpus recaptured for the new response.

**The socket is now bounded, and that bound is a target-only difference from baseline.** The server
options in `app.js` declare `routes.timeout.server: 120000` `[T app.js:160-162]`, which the baseline
had nowhere: hapi's own default for that setting is `false`
(`node_modules/@hapi/hapi/lib/config.js:220`), and no route declaration and no configuration file in
either tree sets it. So the accumulation the paragraph above describes has a ceiling of two minutes
per request rather than of a client's patience — 120 s after `request.info.received`, which is where
hapi arms the timer (`node_modules/@hapi/hapi/lib/request.js:352-373`), its own `internals.timeoutReply`
(`node_modules/@hapi/hapi/lib/request.js:795-799`) replies `Boom.serverUnavailable()`, and the socket,
the hapi request object and the resolved `User` document are released with a **503**.

**It is a bound on the non-settlement rather than an answer to it, and every window this catalogue or
the corpus measures still records no response.** This entry's own probe times out at **10.002 s** on
both trees, and `test/parity/corpus.json` drives 402 of its 405 steps with a 15 s budget and the
remaining three with 4 s (`test/parity/capture.js:219,223`); all of those are far inside two minutes,
so `route.post.api-admin-user-userId.json` still records no status for its step and the Gate below is
unmoved. **The disposition above is unchanged in every respect: no `else` is added, and no validation
is added to the route declaration.** What changes is only what a client that waits longer than 120 s
receives — hapi's 503 instead of nothing at all — and the precedence for that is AAP §0.7's own, which
[§11.1](#111-deviation-1-the-never-settling-file-response) states as *the absence of a response is not
a behaviour a client can depend on*, applied here against R-b's unqualified requirement that the
application genuinely run. QA finding `W002-I6-EXPORT-CASTABLE-ABSENT-ID-HANG` is what asked for it,
having measured 25 concurrent never-answering requests all still held at 6 s with no bound of any kind
configured anywhere in `app.js`.

**The §11 register entry for this bound is not added here.** §11 and its rows are owned by another
work unit at this checkpoint, so — following the same reasoning
[§10.11](#1011-requestfailerr-with-an-error-argument-terminated-the-process--repaired-and-why) gives
for not amending §11.0's count from inside a single section — this entry records the difference and
its argument and leaves the register to the unit that holds it. What that unit needs is stated here so
that it does not have to be re-derived: a **target-only** difference, `routes.timeout.server: 120000`
in `app.js`'s server options, argued in this section, and **replay-invisible**, because no committed
scenario waits longer than 15 s for a step and so no recorded outcome moves.

**Gate.** `route.post.api-admin-user-userId.json` drives this route and records **no status** for its
step, which is the corpus's representation of a step that produced no response; the comparison is
between the trees, so a build that answered would be reported as an unapproved difference — including
one that "fixed" it.

---

**CORRECTION: the disposition above is withdrawn. This route answers on both payload shapes, and the
change is approved deviation 16.** Everything measured above about the **baseline** stands and is
unchanged; what is withdrawn is "preserve the non-settlement", the T-1 gap "recorded as owed", and the
claim that the register could not carry this because the route "answers" rather than dying.

**Measured on the delivered tree**, admin session, one booted instance, four payload shapes driven in
one pass (`test/parity/server.js --port 3218` over a seeded isolated database):

```text
POST /api/admin/user/{userId}, admin identity
  no payload at all              -> 200  application/json  68 bytes   9.088 ms
                                    {"message":"roles required","flash":{"requested":["administrator"]}}
  well-formed empty JSON {}      -> 200  application/json  39 bytes   6.416 ms
                                    {"message":"roles required","flash":{}}
  roles present, not an array    -> 500  application/json  96 bytes   7.354 ms
                                    the generic Boom payload, through Layer 1
  roles a valid array            -> 200  application/json  42 bytes  13.005 ms
                                    {"success":true,"flash":{},"context":null}
```

**The mechanism is one line moved and one guard added, both in the controller.**
`[T lib/controllers/admin.js:290]` reads `var roles = request.payload && request.payload.roles`
**before** entering the `findById` callback — which is what stops the payload-less shape throwing off
this handler's stack, §10.11's edge — and `if (!roles) return resolve(request.fail({ message : 'roles
required' }))` is the missing `else` this section said should not be added. It answers **like its two
neighbouring guards**, `{ message : 'user not found' }` and the `request.success({success:true})` below
them, through the same Layer 2 funnel, rather than inventing a status this route has never served. The
third shape — a `roles` value that is not an array — reaches `mergeRoles`' `roles.forEach`
(`lib/models/plugins/roles.js:378`) and its throw is routed into the lifecycle promise by the
try/catch, so it lands on the Layer 1 catch-all as a 500 instead of escaping to the process.

**Why the precedence argument now runs the other way, on this section's own evidence.** The paragraph
above conceded that a promise which never settles "is not a promise **of a response value**, so on the
AAP's own wording this path does not satisfy T-1", and then preserved it anyway on R-d, R-f and a
closed register. Two of those three do not survive measurement. **R-f** made the non-answer "the
baseline fact" only for the well-formed-empty shape; the payload-less shape on the *same route* killed
the process (§10.11), and the two shapes reach the same missing `else`, so preserving one meant keeping
a route with two failure modes and no response in either. **The register was not closed against this**:
§11.0's rule is that an entry is added when a requirement other than R-d makes preservation
*impossible*, and R-b is unqualified — this route did not answer, in either shape, to any caller. The
count is now eighteen numbered entries of which thirteen are live, and this is number **16**;
[§11.22](#1122-deviation-16-the-payload-less-roles-update-answers-where-the-baseline-process-exited)
carries the field-by-field contract. **What R-d still forbids, and what was therefore not done**: no
validation was added to the route declaration, so the 102 declared validation targets the joi matrix
gates are untouched; and no status was invented, which is why both answering shapes are 200 rather than
the 400 an earlier "named follow-up" in this section proposed.

**The `routes.timeout.server: 120000` bound measured above is unaffected and is not this deviation.**
It bounds any request that still fails to settle; this route no longer produces one. Both records are
kept because they answer different questions — what a hung request costs, and why this one no longer
hangs.

**Gate.** `route.post.api-admin-user-userId.json`, in both cookie passes, carrying the approved-change
marker §11.0 rule 2 requires — projected from the closed register in `test/parity/replay.js`, for the
measured reason §11.0's marker-source table gives. `npm run verify:corpus` reports **exit 0** with this
scenario among its approved deviations in both passes.

### 10.13 Bulk CSV import saturates the bcrypt threadpool and blocks the event loop

**Measured** (**probe**, both trees, admin session, with a concurrent canary request throughout).

`admin.uploadUsers` builds one `new User({…})` per CSV row, pushes every `user.save()` into an array,
and awaits them **all at once** through `Promise.allSettled` — `[B lib/controllers/admin.js:133]` and
`:136`, delivered at `[T lib/controllers/admin.js:182]` and `:188`. Each `save()` runs the model's
pre-save hook, which is a **cost-10 bcrypt hash** (`lib/models/user.js:8` `SALT_WORK_FACTOR = 10`,
applied at `:53`). bcrypt's hashing runs on the libuv threadpool, whose default width is 4, so N
unbounded concurrent hashes saturate it and every other threadpool consumer — including the ones the
rest of the application needs — waits behind them.

**Measured, and this is parity rather than a regression:**

| Rows | Total, delivered | Total, baseline | Concurrent canary p95 |
|---|---|---|---|
| 1 | 93 ms | 77 ms | — |
| 10 | 236 ms | 197 ms | — |
| 50 | 1161 ms | 751 ms | — |
| 200 | 3390 ms | 3192 ms | **3310.58 ms delivered · 3126.92 ms baseline** |

At 200 rows the server is effectively unavailable for the duration on **both** trees. An interleaved
A/B at 25 rows × 8 repetitions gives baseline p50 409.4 ms against delivered 437.5 ms — a ratio of
**1.069** with overlapping distributions (the delivered minimum, 423 ms, sits inside baseline's
388–476 ms range) — so the difference is not material and the characteristic is baseline's.

**Target disposition: keep the unbounded `Promise.allSettled` and the cost-10 hash.** Both halves are
pinned by something other than preference. The concurrency is pinned by R-d and by this file's own
delivery directive, which requires the resolution order and the tally semantics to be preserved and
forbids per-row error handling — bounding concurrency through a work queue or yielding between batches
changes the order rows are attempted in and the order their failures are counted. The cost factor is
pinned by AAP §0.5.1.2, whose bcrypt row requires "**Cost factor 10 and hash format unchanged**" so
that existing passwords still verify, and by `lib/models/**` being outside this file's scope;
**`lib/models/user.js` is byte-identical to `2f8712a`** (**probe**: `git diff 2f8712a -- lib/models/user.js`
is empty). AAP §0.8 settles the remaining question directly: "Performance and scalability expectations.
The request states none, and none is invented."

**What preservation leaves exposed — recorded, not repaired.** An administrator can make the whole
process unresponsive for seconds with one roster upload, and nothing bounds the row count: there is no
size limit on `userList` beyond hapi's payload default, and every row costs a bcrypt hash on a
four-wide threadpool. The trigger is admin-authenticated, which is what keeps it a resource
characteristic rather than an anonymous denial of service. **Named follow-up:** bound the save
concurrency to a small window and yield between batches, as a separately approved performance change,
paired with `UV_THREADPOOL_SIZE` sizing — and note that any such change must keep the `allSettled`
tally semantics observable, or it silently alters the `{success, errors}` counts this route reports.

**A second, harsher outcome shares this handler and is recorded with the family it belongs to.** A CSV
containing an unclosed quote makes the `csv` parser call back with an error, that error reaches
`request.fail(err)` at `[T lib/controllers/admin.js:169]`, and the process **terminates** — on both
trees, by the same mechanism, with only the assert's constructor name differing between the hapi
majors. It is one of the nine sites [§10.11](#1011-requestfailerr-with-an-error-argument-terminated-the-process--repaired-and-why)
enumerates and is preserved there rather than restated here.

---

### 10.14 A private course's archive is downloadable by any authenticated user

**This entry exists because a reachability claim elsewhere in this document was concealing it.**
[§9.7](#97-a-routed-handler-that-answers-500-where-its-author-intended-403) recorded
`courses.download`'s five-clause guard as an authorization control whose `else` an unauthorized
authenticated visitor reaches. The `else` is real and answers 500 when reached — that part stands — but
**no account this application creates can reach it**, because clause 4 admits every one of them. An
entry that reads as "the control is present but misfires on the unauthorized path" hides the actual
outcome, which is that there is no unauthorized path. So the exposure is written down here, on its own,
next to the analogous file-download case in
[§10.5](#105-a-stored-file-is-downloadable-by-anyone-who-knows-its-id-or-its-content-hash).

**Measured** (static on both trees, plus probe on a running server). The guard
`[T lib/controllers/courses.js:214-218]`, byte-identical at `[B lib/controllers/courses.js:136-140]`:

```javascript
    if (request.user.hasRole("course-owner", "course", { id : course.id })    // 1  owner
    ||  course.globalSettings.courseType === "public"                         // 2  public course
    ||  course.globalSettings.courseType === "open"                           // 3  open course
    ||  request.user.hasPermission("create-private-course")                   // 4  <-- every account
    ||  request.user.hasPermission("make-course-copy", "course", {id: …})) {  // 5  per-course grant
```

Clause 4 is a **site** permission carried by the `user` role, and the `user` role is granted to every
account on its first save — `checkPermissions` is a pre-save hook `[T lib/models/user.js:283-292]` that
runs `setRoles('user', 'site')` when `roles` is empty `[T lib/models/user.js:64-72]`, `setRoles` is
`grant` with `_skipUpdate` `[T lib/models/plugins/roles.js:138-144]`, and `grant` fills the entry's
`permissions` from the static map `[T lib/models/plugins/roles.js:91-103]`, `[T lib/models/roles.js:8-25]`, which lists
`create-private-course` at `:20`. The clause therefore evaluates as **"is this request
authenticated"**, which the route's `auth: 'session'` has already guaranteed. **CWE-863** (incorrect
authorization).

**Driven on the delivered tree, because the static reading is not evidence on its own** (**probe**,
against a running server): sign up account A, `POST /api/courses {"name":…,"courseType":"private"}`,
read it back and confirm `globalSettings.courseType === 'private'`; sign up account B, which holds no
role on that course and is not its owner; then as B request
`GET /A/courses/{courseSlug}/download.zip?format=md`. Result:

```text
owner    A  GET /A/courses/qa19-private-two/download.zip?format=md -> 200 application/zip  (control)
outsider B  GET /A/courses/qa19-private-two/download.zip?format=md -> 200 application/zip
            content-disposition: attachment; filename=qa19-private-two.zip
outsider B  GET /api/courses/{courseId}                            -> 200
```

**The baseline half is byte-identity plus a reported drive, and the distinction is stated rather than
blurred.** This tree is the one driven above. The guard, the pre-save hook and the role map are
byte-identical at `2f8712a` (**static**, `git show`), so the same identity must take the same clause
there; and the drive was independently performed against both trees during QA, which reported the
outsider 200 "identically on both trees". No baseline worktree was stood up for the run recorded here.

**Reach, stated precisely rather than broadly.** The permission is consulted at two authorization sites
and neither is creation:

| Site | Address | What clause 4 lets any authenticated account do |
|---|---|---|
| `courses.download` | `[T lib/controllers/courses.js:217]`, `[B :139]` | Download **any** course's archive, including a `private` one it holds no role on |
| `course.copyCourse` | `[T lib/controllers/course.js:486]`, `[B lib/controllers/course.js:180]` | Copy **any** course, including a `private` one, into its own account |

Course *creation* does not consult it at all, and both creation paths say so in source
(`[T lib/controllers/course.js:253-260]`, `[T lib/controllers/courses.js:41-45]`): a `private` course
requested by an account without the permission is created exactly as a public one is. So the permission
does not gate what it reads like it gates at any of the three sites.

**One in-source note names the wrong second site, and is left as it is.**
`[T lib/controllers/course.js:255-256]` says the two places this application consults the permission are
"`copyCourse` below and `courses.coursePage`". Measured: `create-private-course` occurs at exactly two
authorization sites on either tree — `[T lib/controllers/courses.js:217]` (`download`) and
`[T lib/controllers/course.js:486]` (`copyCourse`) — and `coursePage`
`[T lib/controllers/courses.js:175-200]` consults `manage-course-content` and two roles instead, never
this permission, on the target tree and at `2f8712a` alike (**static**, both trees). So the second site
is `courses.download`, not `coursePage`. The sentence is a comment in a file this section does not
change, and the mis-naming has no behavioural effect; it is recorded here so a reader following that
comment does not conclude the read-side surface is somewhere it is not.

**Target disposition: preserved exactly, and NOT repaired here.** The guard is byte-identical to
`2f8712a` at both sites, so this is baseline behaviour and R-d preserves it. Three further reasons the
repair does not belong in this migration, stated so the omission is not mistaken for an oversight:

- **The correct fix is a permission-model change, not a guard edit.** Dropping clause 4 from
  `courses.download` would leave `course.copyCourse` admitting the same accounts, and dropping it from
  both would change what the `user` role means for every existing account — a data migration over the
  `roles.permissions` arrays already written to every user document, since `grant` **persists** the
  expanded permission list rather than deriving it per request.
- **It moves responses two gates compare.** AAP §0.9.1 compares effective auth per route entry and
  §0.9.3 compares responses; turning a 200-with-archive into a 403 or 500 fails both, and AAP §0.2.2
  puts new or removed features out of scope.
- **`lib/controllers/course.js` is not this section's to change**, and a one-sided edit would be worse
  than none: `courses.download` refusing while `copyCourse` admits is a *new* inconsistency rather than
  a partial fix.

**What closing it properly requires.** Decide what `create-private-course` is for — if it is a
*creation* capability, the two read-side sites must stop consulting it and gate on ownership or
course-membership instead, which means defining what membership admits for `private` and `demo` courses
and migrating the existing role documents. That is a feature with its own data model and client
changes, and it needs its own approval. It is the same shape of work as
[§10.5](#105-a-stored-file-is-downloadable-by-anyone-who-knows-its-id-or-its-content-hash)'s remedy and
could reasonably be one piece of work with it.

**Gate.** None closes it, and that is the honest statement: the route-manifest and corpus gates both
record the 200 as correct, because it *is* the baseline behaviour. What this entry is bound to instead
is the difference ledger — the register in [§11](#11-the-approved-deviations) does not name this site,
so any change to these responses is reported as an **unapproved** difference, including a change that
looks like a repair. §9.7 carries the unreachable branch's own behaviour and its evidence.

---

### 10.15 Concurrent course-archive downloads corrupt one another, and six of them end the process

The export in `courses.download` builds its working tree at a path derived from the **course owner and
slug alone** — `[T lib/controllers/courses.js:226-227]`, `var ownerDir = '/tmp/' + owner.username;`
and `var courseDir = ownerDir + '/' + course.slug;` — with the archive beside it at
`[T lib/controllers/courses.js:336]`. Nothing in the path distinguishes one request from another, so
every concurrent download of the same course shares one directory and one archive file.

The tail is what turns sharing into a fault. `[T lib/controllers/courses.js:372]` opens the archive
with `fs.createReadStream(zipFile)`, and `[T lib/controllers/courses.js:375]` then removes the whole of
`ownerDir` — archive included — **before** the response carrying that stream is returned.
`createReadStream` is lazy: it has not opened the file yet. So the read is issued against a path that
this request has already deleted and that a sibling request may delete again, and the stream carries no
`error` listener. An `error` event on a stream with no listener is an unhandled `'error'` event, which
Node throws.

**Measured on the target tree**, against a live server on an isolated database, as an ordinary
authenticated account downloading another user's course:

```text
concurrency 1  -> http=200, a complete archive                (control)
concurrency 6  -> all six: rc=52, http=000, 0 bytes
                  GET / afterwards -> 000  (the process is gone)

stderr:
      throw er; // Unhandled 'error' event
      ^
Error: ENOENT: no such file or directory, open '/tmp/qa19a/qa19-private-two.zip'
Emitted 'error' event on ReadStream instance at:
    at emitErrorNT (node:internal/streams/destroy:170:8)
    at emitErrorCloseNT (node:internal/streams/destroy:129:3)
    at process.processTicksAndRejections (node:internal/process/task_queues:89:21) {
  errno: -2, code: 'ENOENT', syscall: 'open',
  path: '/tmp/qa19a/qa19-private-two.zip'
}
```

At intermediate concurrency the same race truncates rather than kills: a request whose stream is opened
after a sibling's deletion but before its own read completes answers **200 with a short body that is
not a parseable archive**, because the status and headers are committed before the payload is drained.
A caller cannot distinguish that from a good response by its status.

**This is baseline behaviour, and the three lines that produce it are unchanged.** At the base commit
the same two variables are `[B lib/controllers/courses.js:147-148]`, the archive path is
`[B lib/controllers/courses.js:257]`, and `[B lib/controllers/courses.js:267-268]` is
`var stream = fs.createReadStream(zipFile); rimraf(ownerDir, function() { return reply(stream)…` —
the same lazy open, the same deletion of the shared directory before the response is produced, and the
same absence of an `error` listener. The migration changed `rimraf(dir, cb)` to
`await fs.promises.rm(dir, {recursive:true, force:true})` and nothing else here, which is what
**AAP §0.4.2 explicitly directs**: baseline waits for the deletion before the final `.header()`
resolves the response, so the conversion awaits deletion, swallows its error as the empty callback did,
and then returns the response. The delivered code does exactly that, including the swallow at
`[T lib/controllers/courses.js:377-379]`.

**Target disposition: preserved, and deliberately not repaired here.** Four independent grounds, in
order of force:

1. **AAP §0.4.2 specifies this code's shape.** A fix has to stop deleting before the response is
   produced, which is the one property that section names. The plan is the frozen source of truth and
   is not reinterpreted to accommodate a repair.
2. **R-a.** Allocating a per-request workspace, attaching a stream `error` handler and deferring
   cleanup until the response stream closes is a concurrency redesign of the archive path. It is not a
   runtime bump, a hapi API migration, an async conversion, or a blocking dependency swap.
3. **R-d.** The corruption and the exit are both observable baseline behaviour. Removing them is a
   behaviour improvement, so it would require an argued, numbered entry in
   [§11](#11-the-approved-deviations) — see [§11.0](#110-the-register-and-why-a-tool-cannot-add-to-it)
   for what that takes. It has none.
4. **Citation stability.** `lib/controllers/courses.js` carries 64 line-pinned citations across four
   documents — 16 here, and 48 in `docs/deferred-dependencies.md`,
   `docs/error-edge-inventory.md` and `docs/conversion-inventory.md`, none of which this unit owns. A
   repair shifts line numbers under all of them.

**How this differs from deviation 5, which did end a process death.** [§11.9](#119-deviation-5-the-bounded-zipcode-read-and-the-process-death-it-no-longer-causes)
records a process death that R-b was allowed to override. The distinction is not severity — it is that
deviation 5's remedy was the bounded read the migration had to write anyway to convert that handler,
and no AAP section specified the crashing shape. Here the AAP specifies the shape, and the remedy is
new work on a path the migration only touched to swap a deletion call. A future author who wants to
close this must go the deviation route rather than reading §11.9 as a precedent for repairing in place.

**What a human must do**, once the change is approved: allocate the working tree with
`fs.promises.mkdtemp()` so no two requests share a path; attach an `error` handler to the read stream
and wait for its `open` before committing the response; and remove only that request's directory, after
the response stream has finished or closed, on both the success and the failure path. Until then, an
ordinary authenticated account can terminate the application with six simultaneous requests to a
routed endpoint, and callers cannot tell a truncated archive from a complete one.

**Gate.** None closes it. The corpus drives one request at a time, so no scenario reaches the race, and
the route manifest is indifferent to it. What this entry is bound to is the difference ledger: the
register does not name this site, so any change to these responses — including a repair — is reported
as an **unapproved** difference until it is argued into §11.

---

### 10.16 The folder name contract is asymmetric between create and rename

**Measured** (static, both trees; and driven on the delivered tree). The two folder-name schemas do not
agree on a maximum:

```javascript
// [B config/api_routes.js:685]  POST /api/folders          folders.create
          name: Joi.string().min(1).max(140).required(),
// [B config/api_routes.js:700]  PUT /api/folders/{folderId}/name   folders.update
          name : Joi.string().min(1).max(50)
```

Both lines are **byte-identical on the delivered tree**, verified by `git diff 2f8712a -- config/api_routes.js`,
whose only hunk in that file is the login route's inline pre-handler. So this is baseline behaviour,
not a conversion artefact.

Driven, in one session, against the delivered tree:

| Request | Result |
|---|---|
| `POST /api/folders` with a **140**-character name | **200**, folder created |
| `PUT /api/folders/{id}/name` with a **51**-character name | **200** carrying `flash.validation` `{"name":"\"name\" length must be less than or equal to 50 characters long"}` — the name is **not** changed |
| `PUT /api/folders/{id}/name` with a **50**-character name | **200**, renamed |

**The consequence, which is what makes it worth an entry.** A folder created with a name of 51 to 140
characters **can never be renamed to a name of its own length**. Its current name is legal for the
object but illegal for the only route that can change it, so the owner's sole way out is a shorter
name. Note also the shape of the refusal: the hand-rolled validation block answers **200** with a
`validation` flash rather than a 4xx, which is the response contract AAP §0.6.2 preserves deliberately
and §9.1's sibling entry describes.

**Declined, with the citation it turns on.** A finding asked for the two maxima to be aligned. Both
routes are validation targets inside AAP §0.6.2's **102**, whose gate — `npm run verify:joi`, comparing
against `test/parity/joi-baseline.json` and exiting non-zero on any difference — is defined to fail on
exactly this kind of change: raising `:700` to 140 makes a previously rejecting input accept, and
lowering `:685` to 50 makes a previously accepting input reject. Either direction is an accept/reject
difference by construction, so **R-d** and **§0.6.2** control together, and §0.2.2 additionally freezes
the route surface. What a human must do: amend the AAP to authorize the schema change, pick the single
maximum, and **re-baseline** the joi matrix for both targets, since the baseline side is what the
change moves.

**Gate.** `verify:joi` covers both targets and pins the current outcomes; the difference ledger reports
any change to either as unapproved, because [§11](#11-the-approved-deviations) does not name these
sites.

### 10.17 A folder name is stored with control characters intact, and the two list routes disagree about `owner`

Two measured inconsistencies from the same finding, kept in one entry because they share a cause — the
schemas say what they say, and nothing normalises around them — and one disposition.

**Measured 1: a NUL byte in a folder name is accepted and persisted verbatim.** Driven on the delivered
tree with a real `%00` in the form body:

```text
POST /api/folders   name=nul%00byte
-> 200 {"success":true,"folder":{"name":"nul\u0000byte","slug":"nul-byte", … }}
```

`Joi.string().min(1).max(140)` constrains length and nothing else, so the control character passes
validation, reaches the document, and is stored as authored. The **slug** is a separate value derived by
the slug plugin and it drops the character (`nul-byte`), so the unique index that governs collisions is
computed on the sanitised form while the displayed `name` keeps the raw byte. Nothing downstream escapes
or rejects it.

**Measured 2: `owner=me` works on one list route and is refused by the other.** Driven in the same
session:

| Request | Result |
|---|---|
| `GET /api/courses?owner=me` | **200**, the owner's courses |
| `GET /api/trinkets?owner=me` | **200** carrying `flash.validation` `{"owner":"\"owner\" is not allowed"}` |

Two sibling list routes, one query contract each, and a client that learns which by trying. The
trinkets route's query schema does not declare `owner`; the courses route's does. Both are baseline.

**Declined, with the citations they turn on.** The finding asked for control characters to be rejected
and the two query contracts to be aligned. Both are the same class as
[§10.16](#1016-the-folder-name-contract-is-asymmetric-between-create-and-rename): each is an
accept/reject change on a route inside AAP §0.6.2's 102 validation targets, so `verify:joi` is defined
to fail on it and **R-d** plus **§0.6.2** control; adding `owner` to the trinkets query additionally
changes what that route *does* with a parameter it currently refuses, which §0.2.2 puts out of reach as
a route-surface change rather than a validation one. Preserving is possible for both — neither
terminates a process nor leaves a request unanswered — so [§11.10](#1110-deviation-6-post-apifolders-answers-where-the-baseline-process-died)'s
route in is not available to them.

**What a human must do, per half, because the two are not one job.** For the control character: amend
the AAP, then choose *where* — a schema-level `regex`/`invalid` on the name, or normalisation in the
model — because the two produce different responses (a validation flash versus a silently cleaned
value), and re-baseline the create target. For `owner`: amend the AAP to authorize the query-contract
change, then decide which route moves; aligning `/api/trinkets` upward means implementing the parameter
in `lib/controllers/trinket.js`, which is a listing-behaviour change and needs its own corpus
re-baseline, and it is recorded here as an observation rather than a proposal.

**Gate.** `verify:joi` pins the accept/reject outcome of both routes' schemas; the corpus compares both
list responses between the trees. No entry in [§11](#11-the-approved-deviations) names either site, so
any change to them reports as an unapproved difference.

---

### 10.18 `POST /api/exports` answers 500 after saving its row and queueing its job

The one entry in this catalogue where the **response**, not the handler, is what fails. `requestExport`
completes: the `Export` document is written, the job is enqueued, and the handler returns a success
projection. The 500 is raised while that projection is being turned into bytes, by which time both
side effects have already happened. So the caller is told the request failed, never learns the id of
the export that now exists, and cannot start another — the in-flight guard refuses every further
attempt.

**Measured, on both trees, through a running server** (**probe**). A freshly created account with no
prior export, driven with `Accept: application/json`:

```text
BASELINE  (git worktree at 2f8712a, its own npm ci — 642 packages)
  POST /api/exports        -> 500 {"statusCode":500,"error":"Internal Server Error",
                                   "message":"An internal server error occurred"}
  db.exports for the owner -> 1  {status:"pending", progress:{total:0,processed:0,failed:0}}
  POST /api/exports again  -> 200 {"error":"Export already in progress","exportId":"…"}
  GET  /api/exports/{id}   -> 200 the export document, status "pending"

TARGET    (this tree, same steps, same identity shape)
  identical on all four lines, including the 500's body byte for byte
```

**Why a completed handler produces a 500 — the chain, and the one link that is easy to miss.**

| Step | What happens | Address |
|---|---|---|
| 1 | The row is saved and the job enqueued. Neither is rolled back by anything below | `[T lib/controllers/users.js:1309-1327]`, `[B lib/controllers/users.js:957-972]` |
| 2 | The handler returns `request.success({success:true, data:{exportId: exportRecord._id, …}})` — a **raw** `ObjectId`, where the sibling handler four hundred lines up uses `_id.toString()` | `[T lib/controllers/users.js:1353-1360]` vs `[T lib/controllers/users.js:1432]` |
| 3 | This route declares no reply spec, so `request.success` takes the `ObjectUtils.serialize` arm rather than the `ObjectUtils.pull` projection | `[T lib/util/routeParser.js:225-227]`, `[B lib/util/routeParser.js:422-424]`; route `[B config/api_routes.js:1504-1508]` |
| 4 | `serialize` rebuilds every object with `for (var key in json)`. **mongoose 6.13.9 resolves bson 4.7.2 on both trees, and 4.7.2 defines `ObjectId`'s prototype methods as ENUMERABLE**, so the rebuild copies eight method names as OWN keys of a plain object — `toHexString`, `toString`, `toJSON`, `equals`, `getTimestamp`, `toExtendedJSON`, `inspect`, `valueOf` | `[T lib/util/objectUtils.js:42-58]` |
| 5 | `JSON.stringify` finds a `toJSON` on that plain object and calls it with the plain object as receiver. `toJSON` → `toHexString` reads `this.id`, which is not there, and throws `TypeError: Cannot read properties of undefined (reading 'toString')` inside hapi's marshal | `[T lib/util/objectUtils.js:33-64]` |
| 6 | A throw during marshalling becomes a generic `500` with no leak of the message | `node_modules/@hapi/hapi/lib/response.js` |

Measured in process (**probe**, this tree):

```text
$ node -e "… for (var k in new mongoose.Types.ObjectId(...)) …"
bson version (mongoose nested): 4.7.2
for..in over ObjectId: ["toHexString","toString","toJSON","equals","getTimestamp",
                        "toExtendedJSON","inspect","valueOf"]
serialize(exportId) own keys: the same eight
JSON.stringify THREW: TypeError: Cannot read properties of undefined (reading 'toString')
with .toString() -> {"success":true,"data":{"exportId":"000000000000000000000601"}}
```

**Blast radius: exactly one site.** `[T lib/controllers/users.js:1356]` is the only raw `ObjectId` in a
`request.success` payload in this module; every other export projection stringifies first, which is why
`GET /api/exports/{exportId}` answers 200 with its document.

**Target disposition: preserved exactly, with the raw `ObjectId` left as written.** The one-character
repair — `.toString()` — is measured to work, which is precisely why it is not applied.
`lib/util/objectUtils.js` is byte-identical to the base commit (`git diff 2f8712a --
lib/util/objectUtils.js` is empty, **probe**), the payload shape is unchanged from
`[B lib/controllers/users.js:975-982]`, `request.success`'s projection is on T-2's preserved list, and
both lockfiles resolve the same mongoose and the same bson — so the 500 is baseline behaviour on this
route rather than anything the conversion introduced. Changing it would alter a status and a body,
which R-e prohibits per edge and R-d prohibits as an improvement, and it would be a **third** approved
deviation in a register [§11.0](#110-the-register-and-why-a-tool-cannot-add-to-it)
closes at two. The delivered code states the constraint inline at `[T lib/controllers/users.js:1328-1352]`.

**Gate — and the honest status of it, which is that this branch has no corpus case yet.** A scenario
`quirk.export-create.marshal-500` was written and **driven successfully**, but it is **not delivered**,
because `test/parity/capture.js` belongs to another unit. It is recorded here so the unit that owns
that file can land it, and so nobody reads this entry as gated when it is not.

The scenario has to be driven as the seeded **admin**: the seeded user owns the seeded pending export,
so `requestExport`'s guard answers before anything is created and that identity can only ever reach
the already-in-progress branch — see
[§10.19](#1019-the-in-flight-export-guard-reads-and-writes-in-two-steps). Its expectation is two-step,
which is what makes it a test of *this* entry rather than of a plain 500: step 1 must answer **500**,
and step 2 must answer **200** carrying `"error":"Export already in progress"` — the second step
proving step 1 persisted its row rather than merely failing. Driven from a working copy of the
generator against a `git worktree` at `2f8712a` with its own `npm ci`, **the expectation was met**
(**probe**):

```text
$ node test/parity/capture.js --app <worktree at 2f8712a> --expect-baseline \
    --only quirk.export-create.marshal-500 --out <scratch>/corpus.exports-baseline.json
capture: [2/2] quirk.export-create.marshal-500 -> 500
expectationResult: {"met": true, "failures": []}
  step drive-create-branch     -> 500 {"statusCode":500,"error":"Internal Server Error",…}
  step prove-the-row-persisted -> 200 {"error":"Export already in progress","exportId":"…"}
```

Until that definition lands, the standing evidence for this entry is the probe above plus §10.21's
browser run, and `route.post.api-exports.json` covers only the guard branch, not the create branch.

That artifact is a **filtered** capture and is not committed, because a one-route capture cannot stand
as gate evidence; the scenario's record enters `test/parity/corpus.json` on the next full campaign, and
[§Capture status](#capture-status-stated-once-because-every-scenario-defined-tag-depends-on-it) records
what that campaign is currently blocked on. Until then this entry's evidence is the probe above, and
the sweep case `route.post.api-exports.json` covers the route's other branch — see §10.19's gate.

### 10.19 The in-flight export guard reads and writes in two steps

`requestExport` decides whether an export is already in flight with one query and creates the new
document with a separate write, so two requests that interleave between the two both create. The
sequential path is correct; only the concurrent one is not.

**Measured, on both trees** (**probe**). Two `POST /api/exports` fired concurrently for one owner, then
one more sequentially:

```text
BASELINE (2f8712a worktree)          TARGET (this tree)
  concurrent #1 -> 500                 concurrent #1 -> 500
  concurrent #2 -> 500                 concurrent #2 -> 500
  db.exports for the owner -> 2        db.exports for the owner -> 2
     both status "pending"                 both status "pending"
  sequential #3 -> 200                 sequential #3 -> 200
     {"error":"Export already in         {"error":"Export already in
      progress","exportId":"…"}           progress","exportId":"…"}
  count after #3 -> still 2            count after #3 -> still 2
```

Both 500s are [§10.18](#1018-post-apiexports-answers-500-after-saving-its-row-and-queueing-its-job)'s
marshal throw, not a concurrency error: each request completed its own create.

**The read and the write, and what sits between them.** `Export.findPendingOrProcessing(userId)` at
`[T lib/controllers/users.js:1277]` — `findOne({_owner, status: {$in: ['pending','processing']}})` at
`[T lib/models/export.js:28-33]` — resolves, then a cooldown query runs, and only then does
`new Export({…}).save()` at `[T lib/controllers/users.js:1309-1314]`. There is no unique index on
`{_owner, status}`: the collection's only declared indexes are the single-field `_owner` and
`expiresAt` at `[T lib/models/export.js:5,14]`. `lib/models/export.js` is byte-identical to the base
commit (`git diff 2f8712a -- lib/models/export.js` is empty, **probe**) and
`[B lib/controllers/users.js:934-962]` carries the identical read-then-write sequence.

**Target disposition: preserved, with the two steps left as two steps.** Neither remedy is applied: a
unique partial index on the in-flight states would turn the second concurrent create into a duplicate-key
error — a new status and a new body on a route that today answers 500 twice — and a `findOneAndUpdate`
upsert would answer 200 "already in progress" to the loser, which is a response the endpoint has never
produced. Both are behaviour changes R-d prohibits, and an index addition is also a schema change
outside R-a's four categories. The delivered code states this inline at
`[T lib/controllers/users.js:1299-1308]`.

**One consequence stated plainly, because it is a deployment property rather than a defect of this
migration:** a duplicate `pending` row is not self-clearing. Nothing in the request path reaps it, and
the guard reads it forever after, so a user who reaches this state cannot request another export until
the row is completed or removed — which is [§10.21](#1021-the-export-flow-is-a-dead-end-for-the-user-who-reaches-it)'s
subject.

**Gate.** `route.post.api-exports.json` drives the already-in-progress branch against the seeded
pending export and is compared between the trees, so a build that answered a successful create there —
which is what a `findOneAndUpdate` upsert would do — is reported as a difference. Its `intent` reads
`failure` and its note says which branch it drives: an earlier revision of that scenario was labelled
`intent: "success"` while only ever driving this branch. **That label is corrected in the artifact but
not yet at its source** — the generator that would re-author it on the next capture is
`test/parity/capture.js`, which belongs to another unit, so the correction currently lives only in
`test/parity/corpus.json` and a re-capture would reproduce the old label until the owning unit lands
the generator-side change. The concurrent pair itself is not a corpus case — the corpus drives one
request per step and a race is not reproducible from a recorded response — so its evidence is the
probe above.

### 10.20 The rest of the unbound-`Boom` family in `lib/controllers/users.js`

[§9.9](#99-two-routed-handlers-that-answer-200-carrying-the-name-of-a-missing-identifier) records the
two export handlers whose branches answer **200** carrying `{"error":"Boom is not defined"}`. This
entry completes the family: the same 15 references produce **two different observable outcomes**
depending on where the throw lands, and four of the download handler's branches are individually
reachable and were individually measured. Nothing here is a second mechanism — it is the same unbound
identifier, counted and measured per branch, because a per-branch record is what a reviewer needs and
what `docs/error-edge-inventory.md` cross-references.

**The count, re-measured** (**static**, over `lib/controllers/users.js` on both trees). **15**
executable `Boom.*` references on each tree, one for one:

| Tree | Lines |
|---|---|
| Baseline | 213, 377, 545, 562, 579, 667, 680, 1027, 1031, 1059, 1064, 1078, 1082, 1086, 1090 |
| Target | 351, 568, 753, 773, 792, 961, 976, 1418, 1422, 1453, 1461, 1488, 1492, 1496, 1500 |

A review of this tree reported **16** at the target and 15 at the baseline. Re-counted here, the figure
is **15 on both** and the pairing is one-for-one; a sixteenth match comes from a comment line that
names the identifier rather than evaluating it. §9.9 and
[Appendix A](#appendix-a--the-quirk-allow-list-for-generated-target-actions) already state 15, and the
conversion added none.

**Measured per branch, on both trees, through a running server** (**probe**). Same request, same
identity shape, on `2f8712a` and on this tree — every line below was identical on the two:

| Reference | How it is reached | The expression names | Outcome |
|---|---|---|---|
| `[T :351]` `remove` | `DELETE /api/users?username=<another account>` | 403 `forbidden()` | **500**, generic body |
| `[T :568]` `updateProfile` | `PUT /api/users/{another user's id}` with a valid payload | 403 `forbidden()` | **500**, generic body |
| `[T :1418]` `getExportStatus` | `GET /api/exports/<absent id>` | 404 `notFound('Export not found')` | **200** `{"error":"Boom is not defined","flash":{…}}` |
| `[T :1422]` `getExportStatus` | `GET /api/exports/{another owner's export}` | 403 `forbidden('Access denied')` | **200** same body |
| `[T :1488]` `downloadExport` | `GET /api/exports/<absent id>/download` | 404 `notFound('Export not found')` | **200** `{"error":"Boom is not defined","flash":{}}` |
| `[T :1492]` `downloadExport` | `GET /api/exports/{another owner's export}/download` | 403 `forbidden('Access denied')` | **200** same body |
| `[T :1496]` `downloadExport` | `GET /api/exports/{a PENDING export}/download` | **400** `badRequest('Export not ready')` | **200** same body |
| `[T :1500]` `downloadExport` | `GET /api/exports/{an EXPIRED export}/download` | 400 `badRequest('Export has expired')` | **200** same body |
| `[T :773]` `removeAsset` | `DELETE /api/users/assets/{another owner's file}` | 403 `forbidden()` | **500**, generic body |
| `[T :792]` `restoreAsset` | `POST /api/users/assets/restore` with another owner's `fileId` | 403 `forbidden()` | **500**, generic body |
| `[T :1453]` `getExportStatus` inner `catch` | Not requested directly — it is the **secondary** throw. When `[T :1418]` or `[T :1422]` throws, the inner `catch` at `[T :1448]` logs and then this line throws in turn, and *that* is the throw that escapes the callback | 500 `internal('Export status error')` | no response of its own; it is the mechanism that produces the **200** on the two rows above |
| `[T :961]`, `[T :976]` `getAvatar`, `getInfo` | `GET /api/users/<absent id>/avatar` and `/info` | 404 `notFound()` | **404** — the branch is never entered, see below |
| `[T :753]` `replaceAsset` | `POST /api/users/assets/{fileId}` | 403 `forbidden()` | **not reachable** through its route — see below |
| `[T :1461]` `getExportStatus` outer `catch` | Would need the synchronous part to throw, e.g. an absent `request.user` | 500 `internal('Export status error')` | **not reachable** — the route declares `auth: 'session'`, so `request.user` is always present |

That is all **15**, and the split by observed outcome is: **four answer 500** (`:351`, `:568`, `:773`,
`:792`), **six answer 200** carrying the identifier's name (`:1418`, `:1422`, `:1488`, `:1492`,
`:1496`, `:1500`), **one has no response of its own** but is what converts those six (`:1453`), and
**four cannot be entered from an HTTP request at all** (`:753`, `:961`, `:976`, `:1461`). A review of
this tree read the family as seven 500s and eight 200s; that is the split by *location* — the seven
non-export sites against the eight export sites — and it is a fair way to describe where they sit, but
it is not what a client observes, because three of the seven non-export sites are unreachable and one
of the eight export sites answers nothing.

**The third column is worth reading carefully, because a review of this tree got one row wrong.** That
review described the pending-download branch as answering "500-shaped content at 200 rather than the
**403** it reads as". The expression on that branch is `Boom.badRequest('Export not ready')` at
`[T :1496]` — a **400**, not a 403. 403 is what the two *access-denied* branches name, at `[T :1422]`
and `[T :1492]`. The observable outcome the review reported is exactly right and is reproduced above;
only the intended status was misattributed, and the distinction matters here because it is the
difference between "this route hides an authorization denial" and "this route hides a
not-yet-ready state". Both are hidden, and they are hidden by the same unbound identifier — but the
denial rows are `[T :1422]` and `[T :1492]`, and a reader auditing the authorization surface should
look there.

**Four of the fifteen are unreachable through their own routes, and saying so is the point of measuring
rather than reading.** Each is blocked by a different layer, which is why none of them can be inferred
from the source alone:

- **`[T :961]` and `[T :976]`** — blocked by a **pre-handler**. Both routes declare
  `user(params.userId)` (`[B config/api_routes.js:1452-1464]`), and the generated finder resolves an
  absent — or soft-deleted — document to `Boom.notFound()` at `[T lib/util/helpers.js:65-70]`, which
  answers **404 before the handler runs**. `request.pre.user` is therefore never falsy inside the
  handler, so neither `else` arm can be entered.
- **`[T :753]`** — blocked **twice over**, and an earlier revision of this entry named only the first.
  `replaceAsset` short-circuits with `errors.notImplemented` at `[T :731-733]` while `features.assets`
  ships `false` (`[B config/default.yaml:3]`). Independently of that flag, the **payload layer** also
  stops the request: the route declares `output: 'file'` (`[B config/api_routes.js:1258-1261]`), so a
  multipart request is answered **415** before the handler, and a form-encoded one has its body
  rewritten to `{path, bytes}`, which then fails the route's own `file` schema and is answered by the
  hand-rolled validation block as a **200** carrying
  `{"validation":{"file":"\"file\" is required","path":"\"path\" is not allowed", …}}` — measured.
  So even with the feature enabled the ownership test is not the first thing a caller meets.
- **`[T :1461]`** — blocked by **authentication**. It is the outer `catch`, entered only if the
  synchronous part of `getExportStatus` throws, and the most plausible cause of that is an absent
  `request.user`; the route declares `auth: 'session'`, so that cannot happen.

`[T :1453]` is a fifth site with no response of its own, but it is emphatically **not** unreachable —
it is reached on every one of the six 200s, and the log line beside it at `[T :1449]` is visible in the
application's own output whenever one of them is served.

**The security-relevant reading, stated exactly.** `[T :351]`, `[T :568]`, `[T :773]` and `[T :792]`
are all **cross-account authorization denials** — deleting another account, renaming it, deleting
another owner's asset and restoring one — and every one of them is **enforced**: none of those requests
performs the write it asked for, on either tree, and the database was compared before and after each.
What is wrong is the status they report it with: a **500** where the expression names a 403. For the
export family the denial is reported inside a **200**, which a client cannot distinguish from success.
The denial itself holds in every case measured; what is unreliable is a caller's ability to tell a
denial from a server fault, or from success.

**Target disposition: all 15 expressions preserved exactly as written**, with the disposition §9.9
states in full — `Boom` stays the first unresolvable identifier on its line, and the finder's
re-delivery of a throw to the callback that threw is kept, so the throwing callback is still
re-invoked. That re-delivery is the `$handleCallbackError` override at
`[T lib/models/model.js:195-219]`, not the base commit's `.catch(cb)`, and §9.9 records why the
mechanism moved and why the file is **not** byte-identical to baseline. Binding `Boom` or rewriting the
calls as `errors.*` would move **four** observed edges from 500 to 403, **six** from 200 to
403/404/400, and would change what the four unreachable expressions would do if their blocking layer
were ever removed — which R-e prohibits per edge and R-d prohibits as an improvement;
`lib/controllers/users.js`'s own implementation brief states the same prohibition. Every one of the 15
carries an inline comment naming its outcome, and `[T lib/controllers/users.js:1475-1486]` now carries
the measured per-branch statuses above.

**Gate.** `error-edge.not-found.missingExport` carries the recorded 200 for the absent-document branch
and `route.get.api-exports-exportId-download.json` carries the working 302, so the pair fails on a
build that changed either. The cross-account and pending branches above are not separately represented
in the committed corpus — the probe is their evidence, and the rows for these sites in
`docs/error-edge-inventory.md` are where the per-edge status belongs.

### 10.21 The export flow is a dead end for the user who reaches it

What §10.18 and §10.19 look like from a browser, recorded because the client half is measurable and
because no entry in this catalogue otherwise says what the user sees. Nothing in this entry is a new
mechanism: it is the client code reacting exactly as written to the responses those two entries
record.

**Measured** (**static**, `[T lib/views/users/includes/data.html]`, byte-identical to the base commit —
`git diff 2f8712a -- lib/views/ public/js/` is empty, **probe**):

| Step | Client behaviour | Address |
|---|---|---|
| 1 | The button disables itself and reads "Starting export..." | `:175-178` |
| 2 | `POST /api/exports` answers 500, so the `.fail` arm runs: it shows the error and **re-enables the button** | `:194-201` |
| 3 | `showError` sets a **5000 ms** `setTimeout` that re-hides the banner, so the only report of the failure disappears on its own | `:59-65` |
| 4 | On any later load of the page, `loadExportList` finds the `pending` row the 500 left behind, renders "In Progress" and starts polling it | `:127-168` |
| 5 | The poll's `updateProgress` sets the real `disabled` attribute on `#request-export`, relabels it "Export in progress..." and shows a "Preparing export..." meter | `:75-88` |
| 6 | Nothing advances the row: `config/default.yaml` declares no `aws.buckets.exports`, so the worker throws on its first upload — [§9.4](#94-the-awsbucketsexports-configuration-gap) | `[T lib/workers/exports.js:528]`, `[T lib/workers/exports.js:542]` |

So the state is stable rather than transient: the page shows a started export that cannot finish, the
control that would retry is genuinely `disabled` — and therefore not focusable, which is why a keyboard
walk of that page reaches no export control at all — and a retry would be refused anyway, because
§10.19's guard answers `200 {"error":"Export already in progress"}` for as long as the row exists. The
5 s auto-hide in step 3 is what makes the sequence silent: a user who looks away misses the only
message they are given.

**Driven in a real browser, on this tree** (**probe**, headless Chrome against a running instance,
signed in as an account with zero export rows). Every figure below was observed rather than read off
the template, and four of them are not visible in the source at all:

| Observed | Measurement |
|---|---|
| The banner's text | **"Internal Server Error"** — not the `'Failed to start export'` fallback the `.fail` arm names at `:194-201`. That arm computes `resp.error \|\| 'Failed to start export'`, and a Boom 500 body *does* carry an `error` field whose value is the HTTP status phrase, so the fallback is unreachable on this path and the user is shown a bare status phrase that never mentions exports |
| The auto-hide interval | `hide-override` removed **+21 ms** after the click and re-added **+5021 ms** — visible for exactly **5000 ms**, matching the `setTimeout` at `:62-64` |
| The "Starting export..." label at `:178` | Present for roughly one frame. The whole request → fail → `showError` → relabel cycle completed **21 ms** after the click, so this label is **not perceivable**; the button appears never to change |
| The page after the auto-hide | Pixel-indistinguishable from the never-clicked state, and the banner carries no dismiss control — the `a.close` in the markup is `ng-hide` inside a `display:none` parent |
| Interactive controls in the export section, once blocked | **one**, `#request-export`, `disabled = true`. Zero interactive elements inside `#export-list` — the Action cell is a `<span class="label">In Progress</span>`, not a link. No retry, no cancel, no way to clear the row |
| Keyboard reachability of that control | **none.** 38 Tab presses produced 36 focus stops across three identical laps of the page, and the ring wrapped from the last side-nav link straight back to the first link, skipping the button every lap; a programmatic `.focus()` also failed. The cause is only that `disabled` is true — the element has no `tabindex` and `tabIndex` is 0, so an enabled button here would sit in the natural order |
| A window in which the button *is* clickable | **~3106 ms on each SUBSEQUENT load** — not on the load that failed. `loadExportList` repaints the pending row at ≈264 ms but the disable comes from the 3-second poll, so the button stays enabled until ≈3269 ms. Clicked inside that window it answers `200 {"error":"Export already in progress"}` — refused by the very row the 500 created — so the window cannot make progress either |
| The page that actually failed | **never re-reads its own list.** The `.fail` arm at `:194-201` shows the banner and re-enables the button but calls neither `loadExportList` nor `pollExportStatus`, so the failing page continues to display **"No exports yet."** and leaves the button enabled indefinitely — while the row it just created exists. The blocked state described above is therefore reached only on the *next* load, and the two states are easy to mistake for each other: on the failing page nothing indicates that anything was created |
| The status poll | **never terminates.** `pollExportStatus` at `:100-126` clears its interval on three conditions only — the row reaching `completed` or `failed`, or the status request itself failing — and none can occur: step 6 stops the row ever leaving `pending`, and the status request answers **200** for an owned, existing id, so the `.fail` arm that would also clear it never runs. The page therefore issues `GET /api/exports/{id}` every 3 s indefinitely; over 100 such requests were logged in one sitting, all 200 |

**Step 6 reaches further than the worker, and the download route shows it directly.** §9.4's missing
bucket is usually described through `lib/workers/exports.js`, but the same absence is observable from
the request path without the worker running at all. Forcing a row to `status: 'completed'` with a
future `expiresAt` — the one state in which `downloadExport` passes all four of §10.20's guard
branches and reaches the presigned-URL call at `[T lib/controllers/users.js:1505-1509]`, whose `Bucket` argument is `[T lib/controllers/users.js:1509]` — answers, measured
identically on both trees:

```text
GET /api/exports/{completed, unexpired}/download
  -> 200 {"error":"Cannot read properties of undefined (reading 'name')","flash":{…}}
```

`config.aws.buckets.exports.name` is that dereference, and `config/default.yaml`'s `aws.buckets` block
declares seven entries — `userassets`, `snapshots`, `cdn`, `materials`, `useravatars`, `appassets`,
`vendorassets` — and no `exports` among them. So the throw lands in the same re-invoked callback as
§10.20's branches and returns through the same `request.fail` path, which is why this too is a **200
carrying an error string**. The consequence for this entry is that the dead end does not depend on the
worker being broken or absent: even a row that somehow reached `completed` cannot be downloaded by a
deployment that has not configured the bucket.

The server trace taken during that run is the same mechanism §10.18 records, seen from the other side:
`ROUTE: Handler returned object` is logged **before** the `TypeError: Cannot read properties of
undefined (reading 'toString')` raised at `ObjectId.toHexString` → `ObjectId.toJSON` →
`JSON.stringify` → `Response._marshal`. The handler succeeded; only the marshal failed.

**Target disposition: preserved, and not repairable from within this migration's scope.** Three
separate exclusions bear on it and each is explicit, so this is a scope boundary rather than a
judgement:

- the client half — the auto-hide, the disabled control, the absence of a retry — is in
  `lib/views/**` and `public/js/**`, which AAP §0.2.2 excludes from modification and which are
  byte-identical to `2f8712a`;
- the 500 that starts it is §10.18, preserved under R-d;
- the missing bucket that prevents the row ever completing is §9.4, where `config/default.yaml` is
  deliberately unchanged because every value in that block is a deployment placeholder.

**Stated plainly, as §9.4 states its own:** on a deployment that configures `aws.buckets.exports` and
runs the worker, the row does complete and the page resolves; the dead end is the behaviour of a
deployment that does not. Neither the 500 nor the auto-hide is affected by that configuration.

**Gate.** The server half is gated by §10.18's and §10.19's cases. The client half has no gate in this
migration and is recorded here as measured, unchanged and out of scope — `test/smoke-test.sh` is
unauthenticated by decision and never reaches `/account/data`, and the corpus compares
`route.get.account-accountPage.html` as rendered markup, which is identical on both trees because the
template is.

### 10.22 Two further defects, surfaced by the closing verification pass

Neither of these is among the findings this checkpoint was given, and neither is a migration
regression. Both are recorded because they were measured here, and because a concern nobody writes
down does not outlive the run that noticed it. Both are **preserved**, for the reasons each states.

#### A — a malformed export id answers 200 carrying the ORM's cast diagnostic

The **arm** is [§9.9](#99-two-routed-handlers-that-answer-200-carrying-the-name-of-a-missing-identifier)'s,
reached by a different error and — the distinction matters, and §9.9's mechanism section is where it is
drawn — **without needing §9.9's re-delivery at all**. `Export.findById(id, cb)` casts its argument
onto the schema's `_id` path; a value that cannot be cast produces a Mongoose `CastError` rather than
a `null` document, and that `CastError` is handed to the callback by the driver as the callback's
**own `err` argument**, on its **first** invocation — nothing has thrown, so there is nothing to
re-deliver. The handler's `if (err)` arm then answers
`request.fail({ error: err.message })`; and `request.fail`'s JSON path returns `h.response(json)`
**without setting a status**, so the transport is 200. The two arms are
`[T lib/controllers/users.js:1414]` in `getExportStatus` and `[T lib/controllers/users.js:1472]` in
`downloadExport`.

**That independence is exactly why an uncastable id kept answering while the castable-but-absent id
answered nothing**, over the interval §9.9 records between a revision that removed the finder's
re-delivery and the restoration that put it back. The six branches §10.20 tabulates all depend on the
second invocation, because the unbound `Boom` throws before anything is handed to `resolve`; this one
never enters that path. QA finding `W002-I6-EXPORT-CASTABLE-ABSENT-ID-HANG` measured both halves of
the contrast against one another — `GET /api/exports/xyz` answered 200 with the cast diagnostic while
`GET /api/exports/6a9e000000000000000000ff` and its `/download` ran to a 20 s client timeout — and it
is the cleanest available demonstration that the re-delivery, and not the `if (err)` arm, is what
§9.9's invariant protects.

**Measured** (**probe**, nine path parameters × the two routes = 18 requests per tree, one
authenticated identity, driven against both a delivered instance and a `2f8712a` worktree with its own
install — the two outputs are line-for-line identical once the generated username is normalised):

| Path parameter | Both routes answer | Body |
|---|---|---|
| `not-an-objectid`, 24 non-hex characters, `__proto__`, `constructor`, `[object Object]`, `' OR '1'='1`, `<script>alert(1)</script>`, `日本語` | **200** | `{"error":"Cast to ObjectId failed for value \"<the value, echoed verbatim>\" (type string) at path \"_id\" for model \"Export\"","flash":{}}` |
| `123456789012` — twelve bytes, so it **casts successfully** | **200** | `{"error":"Boom is not defined","flash":{}}` — it never reaches this arm at all; it reaches the not-found branch [§10.20](#1020-the-rest-of-the-unbound-boom-family-in-libcontrollersusersjs) records |

That second row is the one worth keeping: the boundary is not "hexadecimal" but "castable", and any
twelve-byte string is a valid ObjectId, so the two classes of malformed parameter answer with two
different bodies at the same status.

**What is disclosed** is the ODM's own diagnostic — the model name `Export`, the schema path `_id`, the
runtime type of the supplied value, and the value itself echoed back. **What is not**: the value is
echoed inside a JSON string and JSON-escaped, so the script-shaped parameter comes back as text in an
`application/json` response and no execution was observed; nothing is read or written on this path;
and because every uncastable parameter produces the same shape, this response distinguishes no
existing id from any other, so the enumeration §10.20 records for *castable* ids is not widened here.

**Disposition: preserved, and recorded rather than repaired.** Each available repair — validating the
parameter ahead of the finder, giving the arm a status, or replacing `err.message` with a fixed string
— changes the status or the body of a response a client can observe, which is an error-edge change
R-e forbids and an improvement R-d forbids, with no deviation available because
[§11.0](#110-the-register-and-why-a-tool-cannot-add-to-it) closes the register
at two. It is also the same arm §9.9 and
[§10.11](#1011-requestfailerr-with-an-error-argument-terminated-the-process--repaired-and-why) depend on, so narrowing
it here would move both of those entries.

**Gate: none, stated plainly.** No corpus scenario supplies an uncastable parameter: the two values
the artifact materialises for `{exportId}` are `000000000000000000000602` for the seeded row and
`0000000000000000000006ff` for the missing one, and both are 24-hex and castable (**probe**, every
`/api/exports/<segment>` string in the committed corpus). A scenario that closed this would need one
uncastable and one twelve-byte parameter against the same identity, and would assert the status and
the body's shape rather than its message text, which carries the ODM's wording and would move with the
`mongoose` version.

#### B — the Recent Exports table overflows the viewport at 375 px

The client half of [§10.21](#1021-the-export-flow-is-a-dead-end-for-the-user-who-reaches-it), at the
narrowest breakpoint. The table `loadExportList` builds
(`[T lib/views/users/includes/data.html:138-167]`) carries `style="width: 100%"`, but a table cannot
render narrower than its own min-content width, and no ancestor supplies a horizontal scroll container.

**Measured** (**probe**, headless Chrome against a delivered instance, one identity owning a single
`pending` row, the four widths driven in one pass):

| Viewport | Document `scrollWidth` / `clientWidth` | Max reachable `scrollX` | Verdict |
|---|---|---|---|
| 375 × 812 | **422 / 375** | **47** | **overflow, 47 px** |
| 768 × 1024 | 768 / 768 | 0 | no overflow |
| 1280 × 900 | 1280 / 1280 | 0 | no overflow |
| 1920 × 1080 | 1920 / 1920 | 0 | no overflow |

At 375 the table measures 391.313 px inside a 313 px container, so its right edge lands at 422.313
against a 375 px viewport; the `Action` header cell ends at 419.313 and the row's
`<span class="label">In Progress</span>` at 409.313, so both are cut by the viewport edge — and
because nothing in the chain scrolls, no horizontal scrollbar is painted to indicate that the content
continues. 21 elements exceed the viewport width at 375, and none does at any wider width.

**Cause, measured rather than inferred.** The table's min-content width is a fixed **391.313 px**: its
five columns floor at 77.656 + 75.094 + 81.109 + 48.797 + 94.656 px, plus `border-spacing` and the
table's borders. Two of those floors cannot break — the header word `Trinkets`, and the status badge,
whose `white-space: nowrap` comes from the vendored Foundation `.label` component
(`public/components/foundation/scss/foundation/components/_labels.scss`, compiled into
`public/css/base.css`). Every ancestor from `div#export-list` up to `div#account.row.data` computes
`overflow-x: visible`, so the excess reaches the document. The threshold is a container narrower than
391.313 px, which is 313 px at the 375 breakpoint against 706 px at 768 and 688 px at both wider
widths.

**This is baseline layout rather than migration drift**, and the identity is checkable:
`git diff 2f8712a -- lib/views/ public/js/ static/scss/` is empty, and `public/css/base.css` is a
build artifact of that unchanged SCSS together with the fetched components.

**Disposition: preserved and out of scope, on two independent grounds.** A fix would land in
`lib/views/**` or `static/scss/**`, which AAP §0.2.2 excludes from modification; and the rule that
sets the binding floor is in `public/components/**`, which is gitignored `[B .gitignore:4]`, retrieved
by `scripts/fetch-components.js` and excluded by the same section as an externally sourced asset. The
measurement itself was clean: no console output from the application's own code at any of the four
widths — the only two entries were Chrome's own `autocomplete` advisories on the login form — and no
request with a status of 400 or above.

**Gate: none**, for the reason §10.21 gives for its own client half: the corpus compares rendered
markup, which is identical on both trees because the template is, and nothing in this migration
measures a computed layout.

---

### 10.23 The course page overflows and overlaps painted controls from 375 to 768

The first of **five** narrow-viewport layout defects — §10.23 through §10.27 — measured in a real
browser against the running application and traced to declarations in `static/scss/**`,
`public/js/**`, `public/partials/**` and `lib/views/**`. All five are recorded rather than repaired,
on one basis that is stated in full here and referred to from the other four.

**Why no source file can carry any of these five fixes.** Four facts, each measured rather than
asserted:

1. **None of them is migration drift.** `git diff --name-only 2f8712a HEAD -- <glob>` returns **0
   files** for each of `static/scss`, `lib/views`, `public/js` and `public/partials`, and 0 for every
   individual file cited across the five entries (**static**). So each is pre-existing baseline
   behaviour, `[T …]` and `[B …]` address the same bytes at the same lines, and **R-d** governs: the
   observable behaviour is preserved.
2. **AAP §0.2.2 excludes those four globs verbatim** — "`public/js/**`, `lib/views/**`,
   `public/partials/**` and `static/scss/**` are not modified" — and §0.3.1's target tree states it a
   second, independent time (`public/** · static/scss/**` **unchanged**; `views/**` **unchanged**).
3. **A markup fix would fail a hard gate.** AAP §0.9.3 compares rendered HTML exactly on "`id` and
   `class` attributes, `data-` and ARIA attributes", and `[T test/parity/replay.js:507]` says so in
   code — "A single rendered page that changed layout would otherwise emit one record per class
   attribute." Measured over `test/parity/corpus.json` (**artifact**): `route.get.u-username-classes.html`
   pins **200**, `text/html; charset=utf-8`, body length **12496**, digest `a3189b6c…`, and
   `route.get.home.html` pins **200**, length **19399**, digest `a6a8c2ef…`. Adding a wrapper element
   or a class to either template is therefore reported as an unapproved difference.
4. **A CSS fix cannot reach a browser through a committable file.** `git check-ignore -v` (**probe**)
   resolves `public/css/base.css` to `.gitignore:36`, `public/css/embed.css` to `.gitignore:38` and
   `public/components` to `.gitignore:4` — all three are gitignored build artifacts. The only
   committable source of the served CSS is `static/scss/**`, which fact 2 excludes.

**And §0.7's R-b-over-R-d override does not reach them.** That override was granted to exactly one
case: a route that **never settles**, i.e. produces no response at all
([§11.1](#111-deviation-1-the-never-settling-file-response)). Every route in these five entries
answers **200** with its content rendered — measured **0** responses ≥ 400 and **0** JavaScript
errors across 845 requests (**probe**) — so no requirement other than R-d controls, and §0.2.2's
default applies: "Every other quirk found is documented and left working; 0.6.6 is the catalogue."
[§10.8](#108-the-search-response-seam-the-client-reads-a-key-the-server-does-not-send) is the
precedent for exactly this shape, on exactly this ground, in `public/js/**`.

**Three independent root causes, none of them a single line.**

*One — a fixed 350px pane and a fixed 350px content offset, in no media query at all:*

```scss
// [T static/scss/_course-view.scss:72-82]  ·  [T static/scss/_course-view.scss:94-96]
  #outline {
    …
    margin-left: -350px;
    width: 350px;
    position: fixed;
    top: 125px;
    …
  }
  #course-content {
    …
    &.open {
      margin-left: 350px;
    }
```

`static/scss/_course-view.scss` contains **zero** occurrences of `media` across all **193** lines
(**static**, `grep -c`), so neither declaration has a narrow-viewport variant anywhere in the file.
The served artifact carries both **outside** any media block — `body.course #outline{…margin-left:-350px;width:350px;position:fixed;top:125px…}`
and `body.course #course-content.open{margin-left:350px}` (**probe**, read from the built
`public/css/base.css`) — which is why the runtime defect and the source declaration are the same
object rather than two things that resemble each other.

*Two — the `open` class is decided once, at load:*

```javascript
// [T public/js/courseEditor/controllers/root.js:212]
      self.$scope.menuOpen           = self.trinketUtil.isLarge() ? true : false;
```

`isLarge()` is `matchMedia(Foundation.media_queries['large']).matches`
`[T public/js/services/util.js:31-33]` — Foundation's `large` is 64em/1024px — and it is never
re-evaluated: `defineListeners` `[T public/js/courseEditor/controllers/root.js:127-140]` binds only
`scroll` `[T …:139]`, and the **sole** `resize` binding in `public/js/courseEditor/**` is
`[T public/js/courseEditor/controllers/materialControl.js:53]`, which drives the code editor's
`sizeToWindow` and never touches `menuOpen` (**static**, `grep -rn resize` over that directory).

*Three — the rule meant to hide the action row targets a selector this build never renders:*

```scss
// [T static/scss/_course-edit.scss:3-8]
    .action-buttons {
      display: inline-block;

      @media #{$small-only} {
        display: none;
      }
    }
```

`grep -rn 'action-buttons' lib/views/ public/partials/` returns **0 matches**, and the only
occurrence of that class name anywhere in the repository is the SCSS rule itself (**static**);
`document.querySelector('.action-buttons')` is **null at every width** (**probe**). The five buttons
are five `a.button.small` at `[T public/partials/course_editor.html:15,16,24,25,28]`, inside a plain
`div.right` `[T …:14]` inside `div.course-subnav.clearfix.row.gutterless` `[T …:7]`. The compiled
rule is real and correctly scoped — `body.course #course-nav .action-buttons{display:inline-block}`
followed by `@media only screen and (max-width: 40em){body.course #course-nav .action-buttons{display:none}}`
(**probe**, built `base.css`) — so the media query fires and matches nothing.

**Measured** (probe: headless Chrome against the running application on port 20370, seeded course
"QA Journey Course" with topic "test topic" and page "test material"):

```text
1280, fresh load
  #course-content class list                  -> contains "open"
  #course-content margin-left                 -> 350px

resize 1280 -> 375, WITHOUT reloading
  #course-content class list                  -> still contains "open"   <-- decided at load only
  #course-content margin-left                 -> 350px
  #outline width / margin-left                -> 350px / -350px
  matchMedia('(max-width:640px)').matches     -> true
  documentElement.scrollWidth / innerWidth    -> 470 / 375  =  95px of horizontal scroll
  #course-content width                       -> 25px  (6.7% of the viewport)
  course-editor elements overflowing right    -> 10, among them
      #outline-expander            350.00 -> 392.58
      i.fa-times                   365.00 -> 377.58
      #material-content            350.00 -> 470.00
      .page-controls-container     319.84 -> 410.00
      #page-controls-button        319.84 -> 410.00

overlapping painted on-screen control pairs, fresh loads
  375 -> 6      640 -> 3      641 -> 2      768 -> 2
  at 768:   ‹ x ✏Edit  =  51.66 x 11.81 px       › x ✏Edit  =  34.70 x 11.81 px
```

**Three corrections to the finding as filed, each of which matters to anyone reproducing it.**

- **The 95px overflow requires the resize path from ≥ 1024, and a fresh narrow load shows none of
  it.** On a **fresh** load at 375, 640, 641 and 768, `scrollWidth − innerWidth` is **0** at all four
  widths and **0** course-editor elements overflow, because `menuOpen` is false and the pane starts
  closed. A reproduction script that merely loads at 375 measures 0 and appears to refute the
  finding; the defect is the *transition*, which is root cause two.
- **"The five-button action row strikes through the breadcrumb title" does not reproduce as a rect
  intersection.** Measured **0** intersections between every button rect and every title text run, at
  375 and at 768, with the row abutting the card at exactly 0px (card bottom 126 == row top 126 at
  375; 105 == 105 at 768). What actually overprints at 375 is: the wrapped title's own two line boxes
  overlapping **9px over a 34px span**; the home-icon/`/` strip crossing the title **45 × 6px**; the
  buttons covering **11.7 of the expander tab's 43.7px** for its full 64px height; **34 of the ✏Edit
  control's 48px**, hiding its pencil glyph entirely; and `›` covering body copy **34.66 × 42.42px**.
  The reported effect is real and visible; its geometry is glyph-level, not box-level.
- **`Dashboard × ✕` at 768 is refuted as filed and confirmed in two other forms.** On a fresh 768
  load the two are **318.7px apart**, because a fresh load renders **☰**, not **✕**. The pair is
  confirmed at 375 as `Dashboard × ☰` = **11.72 × 29.00px**, and at 768 once the pane is open as
  **30.17 × 7.00px**.

**Target disposition: preserved, all three mechanisms unchanged.** `#outline`'s fixed width, the
fixed `.open` offset, the load-time `menuOpen` decision and the unmatched `.action-buttons` rule are
carried exactly as at `2f8712a`. The four facts above are why: the fix is a media query and a resize
listener in two of the excluded globs, and the third part of it is a markup change the corpus pins by
digest.

**Gate.** **None — stated in §10.23.** No gate in this migration measures layout, computed CSS or
element geometry at any viewport, so this passes every gate the migration defines. Measured, the
corpus does not even hold the surface: `route.get.userSlug-courses-courseSlug.html` is driven
**anonymous** and records a **302 with a 0-byte body** (digest `e3b0c442…`, the empty digest), and
**0 of 392** scenarios drive `/partials/course_editor.html` (**artifact**). What the corpus does do
is *constrain the repair*, per fact 3 — the opposite of closing the finding.

**The fix an AAP-authorized change should apply** (recorded so the follow-up need not re-derive it;
**not** a proposal for this migration): wrap the `#outline` width and the `#course-content.open`
offset in `@media #{$medium-up}` with a full-width overlay variant below it; re-evaluate `menuOpen`
from a `resize`/`matchMedia` listener rather than only at controller construction; and either wrap
the five buttons of `[T public/partials/course_editor.html:14-31]` in an `.action-buttons` element or
retarget the `[T static/scss/_course-edit.scss:3-8]` rule at the `div.right` the build actually
renders. It must be taken together with §10.24, whose expander is one of the controls this row
buries.

### 10.24 At 375 the outline expander and the page-edit control have zero clickable pixels, and the expander is inert on Enter and Space

The consequence of [§10.23](#1023-the-course-page-overflows-and-overlaps-painted-controls-from-375-to-768)'s
third root cause, measured as reachability rather than as geometry: at 375 the course page offers **no
outline, no page or topic creation and no edit control at all**. The basis for recording rather than
repairing it is §10.23's four facts — the root causes sit in `static/scss/**`, `public/partials/**`
and `lib/views/**`, `git diff --name-only 2f8712a HEAD` reports **0** changed files in each, and
neither a stylesheet nor a markup repair has a committable path that clears AAP §0.2.2 and the
§0.9.3 HTML gate.

**Two root causes: an unset stacking level, and an anchor with no keyboard contract.**

*One — the expander declares no `z-index` and is enclosed by a subtree that declares 10:*

```scss
// [T static/scss/_course-view.scss:62-70]        the expander — no z-index at all
  #outline-expander {
    position: fixed;
    display: block;
    …
  }
// [T static/scss/_course-view.scss:21-26]        the band above it — z-index 10, 80px tall
  #course-nav {
    z-index: 10;
    position: absolute;
    top: 0;
    width: 100%;
    height: 80px;
// [T static/scss/_course-edit.scss:11-14]        its auto-height child
    .course-subnav {
      position: relative;
      padding: 0.75em 2em;
```

The served artifact confirms the omission rather than merely the source:
`body.course #outline-expander{position:fixed;display:block;border-radius:0 8px 8px 0;margin-top:20px;padding:20px 15px;background-color:#008aff;color:#fff}`
— no `z-index` property is compiled at all (**probe**, built `public/css/base.css`). The subnav's
children float (`.title` `[T static/scss/_course-edit.scss:20-22]`, `#dashboard-list-options`
`[T static/scss/_course-edit.scss:24-26]`), so at 375 the action row wraps to two rows, the subnav
grows to **189px** inside a box declared at **80px**, nothing clips it, and a `z-index: 10` subtree
blankets an expander whose own stacking level computes `auto`.

*Two — as shipped, the control is an anchor with no href, no tabindex and no key handler (what the
runtime adds to that is the correction below):*

```html
<!-- [T public/partials/course_editor.html:35] -->
  <a id="outline-expander" ng-click="menuOpen=!menuOpen">
<!-- [T public/partials/course_editor.html:91] -->
        <a id="page-controls-button" data-dropdown="page-actions" class="button small dropdown-blue">
```

`[T lib/views/classes/view.html:69]` is the class player's equivalent and is the same shape in every
respect that matters here — no `href`, no `tabindex`, no key handler — with one verified difference
worth recording so a reader does not assume symmetry: it **does** carry `aria-label="Toggle
Outline"`, which the course-editor anchor does not. That surface's own overlay defect belongs to a
different work unit and is not restated here.

**Measured** (probe: headless Chrome against the running application on port 20370, fresh load at
each width, rects given as left / top / right / bottom):

```text
375 — a#outline-expander, rect 0 / 145 / 43.72 / 209
  points hit-testing to it or a descendant   -> 0 of 120 sampled   (0.0%)
  what those 120 points hit instead          -> div.course-subnav            90
                                                a.next  (›)                  18
                                                a.button.small  Dashboard    12
  div.course-subnav rect                     -> 0 / 45 / 375 / 234   = 189px tall in an 80px box
  #course-nav position / z-index             -> absolute / 10
  #outline-expander z-index                  -> auto
  real Enter keypress                        -> #course-content class list unchanged (no "open"),
                                                margin-left 0px, #outline margin-left -350px
  real Space keypress                        -> identical, no state change
  jQuery._data(expander,'events')            -> ["click"]      (no keydown, keypress or keyup)

375 — a#page-controls-button
  points reaching it                         -> 0 of 120         (0.0%)
  covered by                                 -> div.right                    43
                                                a.button.small  Users        36
                                                a.prev  (‹)                  35
                                                i.fa-users                    6
  tabindex attribute                         -> absent
  .focus() then document.activeElement       -> body             (not focusable at all)

375 — the bottom creation bar is entirely off screen
  div#new-topic-container                    -> left -350   right    0
  a#new-topic-button                         -> left -350   right -175
  a#edit-outline-button                      -> left -175   right    0

768 — the same expander, for contrast
  points hit-testing to it                   -> 84 of 120        (70.0%)
  real pointer click                         -> #course-content margin-left 0px -> 350px
                                                #outline rect -350/0 -> 0/350
                                                icon class fa-bars -> fa-times
```

The 0% → 70% difference between 375 and 768 is caused **entirely** by the action row wrapping at 375:
the expander's own rect, stacking level and handler set are identical at both widths.

**One correction to the finding as filed, and it changes what a remediation has to do.** The
*shipped* partial has no `tabindex` — confirmed by a read-only `GET /partials/course_editor.html`
(**probe**) — but the **live DOM** carries `tabindex="0"`, injected at runtime by **ngAria** on every
`ng-click` element. `angular-aria.min.js` at AngularJS **1.3.20** is in the global body script list
`[T config/default.yaml:88]`, with the matching core at `[T config/default.yaml:63]`, so it applies
to every page. Consequences, each measured:

- The expander **is** focusable at runtime, so "no tabindex, therefore not focusable" is true of the
  template and false of the page. It announces as an **unnamed link**, with no `role` and no
  `aria-expanded`.
- It nevertheless stays **key-inert**, because ngAria 1.3.20 binds its Enter/Space shim only to `DIV`
  and `LI` nodes and never to an `<a>`. The Enter and Space results above are therefore not an
  artefact of focus never landing on the element.
- `#page-controls-button` has **no** `ng-click` — it is a Foundation `data-dropdown` — so it receives
  no ngAria `tabindex` and is genuinely unfocusable, exactly as filed.

**Target disposition: preserved.** The unset `z-index`, the anchor's missing keyboard contract and the
`data-dropdown` control are carried exactly as at `2f8712a`, and the runtime ngAria behaviour with
them.

**Coordination seam, recorded because two work units meet here.** The controls in this entry are the
same controls the `course-editor-keyboard` unit owns making operable, and the row that buries them is
what §10.23's third fix retargets. A future authorized change must land all three together or it will
make a control focusable that is still covered, or reachable that is still key-inert.

**Gate.** **None — stated in §10.24.** No gate in this migration hit-tests an element, dispatches a
key event or reads a stacking context; and per §10.23 the corpus records this route as a **302 with a
0-byte body** and drives the partial in **0 of 392** scenarios, so there is nothing here for a gate to
compare.

**The fix an AAP-authorized change should apply** (**not** a proposal for this migration): give
`#outline-expander` a `z-index` above `#course-nav`'s 10 and enlarge its hit area below `$medium`;
give the anchor `role="button"`, a real `tabindex` and an `ng-keydown` that handles Enter and Space;
and give `#page-controls-button` a focusable, key-operable form.

### 10.25 The course sub-navigation overlays and completely hides the material title and body at 320 and 375

The same auto-growing subnav that [§10.24](#1024-at-375-the-outline-expander-and-the-page-edit-control-have-zero-clickable-pixels-and-the-expander-is-inert-on-enter-and-space)
buries a control under also paints over the page's own content, and this entry states that half. The
basis for recording rather than repairing it is §10.23's four facts: the root cause is two
declarations in `static/scss/**`, which `git diff --name-only 2f8712a HEAD` reports as **0** changed
files and AAP §0.2.2 states verbatim is not modified, and whose only committable source is excluded
while the served `public/css/base.css` is gitignored at `.gitignore:36`.

**Root cause — a hard-coded reserve against an auto-height band, in a positioning mode that cannot
push:**

```scss
// [T static/scss/_course-view.scss:84-85]     the reserve
  #course-content {
    padding-top: 80px;
// [T static/scss/_course-view.scss:21-26]     the constant it matches
  #course-nav {
    z-index: 10;
    position: absolute;
    …
    height: 80px;
```

`.course-subnav` `[T static/scss/_course-edit.scss:11-14]` has no height at all — it is sized by its
content — and its children float (`.title` `[T static/scss/_course-edit.scss:20-22]`,
`#dashboard-list-options` `[T static/scss/_course-edit.scss:24-26]`), so at narrow widths the row
wraps and the band outgrows the 80px both declarations assume. Because `#course-nav` is
`position: absolute`, the excess **paints over** `#material-content` instead of pushing it down, and
nothing on the ancestor chain clips it.

**Measured** (probe: headless Chrome against the running application on port 20370, fresh navigation
at each viewport, values read after Angular settled):

```text
viewport                                 320        375        768       1920
#course-content padding-top              80px       80px       80px      80px
.course-subnav height                    189px      189px      119px     72px
#course-nav.scrollHeight (vs height:80px) 189        189        119       79
#course-nav position / z-index           absolute / 10  at every one of the four widths
overflow past the 80px reserve           109px      109px      39px      0px
.course-subnav ∩ div#material-content    320x109    375x109    768x39    0x0
.course-subnav ∩ div#material            200x85.81  255x82.58  648x15.81 0x0
```

At 375 that second intersection is **100% of `#material`'s width and 100% of its height**. The paint
order is not inferred from the rectangles — it was read from the hit-test stack at a point **inside**
`#material`:

```text
document.elementsFromPoint(160, 188) at 320
  a.next.button.small
  div.right
  div.course-subnav.clearfix.row.gutterless      <-- the subnav subtree, above…
  p
  div.ng-scope
  div#material                                   <-- …the element the point is inside
  div#material-content
  div#course-content
  …
```

Visibility of the page's own title, "test material", per width:

```text
320 and 375  -> COMPLETELY INVISIBLE.  100% of its text rect lies inside the subnav;
                elementFromPoint at the text centre returns a#course-actions-button;
                pixel sampling shows 97.4% of the glyph line covered by an OPAQUE white
                subnav button
768          -> partially visible.  51.4% of its area covered, 100% of the line hit-stolen,
                nothing opaque over it
1920         -> fully visible
```

So the defect is present at 320, 375 and 768, and absent at 1920.

**Two corrections to the finding as filed.**

- **The subnav measures 189px at *both* 320 and 375**, not the reported 178px and 167px. The
  consequence is that the `∩ div#material` overlap at 320 is **200 × 85.81**, not 200 × 57 — the
  defect is **worse** than filed, not milder, and a reproduction that expects 178/167 will read its
  own measurement as a mismatch.
- **The string "test content" could not be measured, because it is not in the DOM on this route at
  any viewport.** The path that renders the measured screen is the **player** — `viewMaterial`'s
  no-markup branch at `[T public/js/courseEditor/controllers/root.js:649]`, which calls
  `material.get({ with : "owner" })` against
  `GET /api/courses/{courseId}/lessons/{lessonId}/materials/{materialId}`
  `[T config/api_routes.js:218-230]`. Measured (curl, on the running target): that request is
  `…/materials/{materialId}?with=owner`, answers **200**, and its `data` carries exactly
  `id, name, slug, type, trinket, lastUpdated` — **no `content` and no `draft`** — for a **316-byte**
  body once the flash is empty. So the template renders its placeholder and a seeded draft body never
  reaches this screen. Both the automatic load and a click on the existing outline row issue exactly
  this one request.

  Two things about that request are easy to get wrong, and both were got wrong in an earlier draft of
  this entry, so they are recorded rather than quietly fixed. **First**, the request is *not*
  parameterless: it sends `with=owner`. The parameterless fetch is
  `[T public/js/courseEditor/controllers/materialControl.js:99-100]`,
  `.one('materials', material.id).get()` — a **different, edit-mode** fetch in a different
  controller, which does not render the measured screen. **Second**, the absent draft is *not*
  explained by the request omitting `withDraft`. On this route `withDraft` is inert: the declaration
  carries no `validate` block at all, and `course.getMaterial`
  `[T lib/controllers/course.js:738-756]` reads only `request.query.with`. `withDraft` is read solely
  by `getCourse` `[T lib/controllers/course.js:342]`, on the outline route. Measured control: adding
  `withDraft=true` to the same URL answers **200** with a byte-identical `data` object. The honest
  statement is therefore that this route answers the material document without a draft body, not that
  a missing parameter suppressed one.

  Either way the conclusion is unchanged and is the point of recording it here: the missing text is a
  **data-delivery fact, not an overlay effect**, and conflating the two would attribute it to this
  quirk. The placeholder "Click here to add content to your page." was measured as the proxy instead:
  partially visible at 320 and 375, fully visible at 768 and 1920.

**Target disposition: preserved.** `padding-top: 80px`, `height: 80px`, the auto-height subnav and
the absolute positioning that lets the excess paint over the content are all carried exactly as at
`2f8712a`.

**Gate.** **None — stated in §10.25.** No gate measures an element rectangle, an intersection or a
hit-test stack, and per §10.23 the corpus records this route as a **302 with a 0-byte body** and
drives its partial in **0 of 392** scenarios.

**The fix an AAP-authorized change should apply** (**not** a proposal for this migration): replace
the fixed `padding-top: 80px` with a measured or `min-height`-driven offset, or let
`header#course-nav` participate in flow below the `$medium` breakpoint. §10.23's action-row change
reduces the wrapping that produces the excess but does not remove it — a two-row band at 320 still
exceeds 80px — so both are needed.

### 10.26 The outline animation drives layout rather than `transform`, reflowing the content pane every frame

Recorded with its two corrections rather than as filed, because one of them **inverts the finding's
conclusion about which declaration to change** — and a follow-up that took the filed conclusion
literally would animate the wrong element. The basis for recording rather than repairing it is
§10.23's four facts: the root cause is one declaration in `static/scss/**`, which AAP §0.2.2 states
verbatim is not modified and §0.3.1's target tree repeats; `git diff --name-only 2f8712a HEAD --
static/scss` reports **0** changed files, so it is baseline behaviour under R-d rather than migration
drift; and the served stylesheet is a gitignored build artifact (`.gitignore:36`), leaving no
committable path to a browser.

**Root cause — the transitioned property is a layout property:**

```scss
// [T static/scss/_course-view.scss:86-89]
    -webkit-transition: margin-left 0.25s ease-in;
    -moz-transition: margin-left 0.25s ease-in;
    -o-transition: margin-left 0.25s ease-in;
    transition: margin-left 0.25s ease-in;
```

The served artifact carries it verbatim —
`body.course #course-content{padding-top:80px;-webkit-transition:margin-left .25s ease-in;…;transition:margin-left .25s ease-in}`
(**probe**, built `public/css/base.css`). `margin-left` is not compositable, so every interpolated
value reflows the content pane and everything laid out inside it.

**Measured** (probe: headless Chrome at 1280 against the running application on port 20370, sampling
computed styles per animation frame and collecting `layout-shift` entries with a
`PerformanceObserver`):

```text
the animated declaration          -> margin-left, on div#course-content
  distinct computed values          17
  changing frames                   16 per toggle

aside#outline computed width      -> 350px, CONSTANT      changing frames: 0
aside#outline computed margin-left-> -350px, CONSTANT     changing frames: 0

transform on #outline             -> none, on all 38 sampled frames per toggle
transform on #course-content      -> none, on all 38 sampled frames per toggle
                                     and in BOTH settled states
will-change on either             -> auto

layout-shift entries per animation-> 14 on open, 15 on close   (one per frame)
  sources named                     div#course-content, aside#outline,
                                    a#edit-outline-button / div#new-topic-container
```

**Two corrections to the finding as filed.**

- **The pane's growing width is an effect, not the animated declaration — and this is the correction
  that changes the fix.** The finding records `aside#outline` animating **`width`** from ~10px to
  349.8px, and the per-frame layout-shift source rectangles do show exactly that: `aside#outline`
  `currentRect` width steps 2.77 → 10.28 → 21.84 → … → 350. But `#outline` is `position: fixed` with
  `left: auto` `[T static/scss/_course-view.scss:72-82]`, so it is laid out at its **static
  position** inside `#course-content`; animating `#course-content`'s `margin-left` drags that static
  position from −350 to 0, and the visible result is a pane that appears to widen while its computed
  `width` never leaves 350px — measured above as **0** changing frames. Both readings describe one
  reflow; the **fix target is the `margin-left` transition**, and giving `#outline` a `width`
  transition instead would add a second animation without removing the first.
- **The measured CLS is above the 0.1 threshold, not under it, and the reason it counts is that no
  user input is involved.** Measured **0.10781** for the input-free auto-open at load, **0.10835**
  for an input-free toggle, and **0.10838 / 0.10764 / 0.10767** raw for trusted clicks — against the
  filed 0.0908 and its "under 0.1 by only 8%". The distinction that matters: the pane **auto-opens at
  1280 with no user input**, because `menuOpen` is initialised from `isLarge()`
  `[T public/js/courseEditor/controllers/root.js:212]`, so **0.10781** lands in the page's real Core
  Web Vitals CLS on every load at that width. The click-driven toggles all carry
  `hadRecentInput: true` and are excluded by spec — their eligible accumulation is exactly
  **0.00000** — which is why a measurement taken only by clicking reports no problem at all.

**Target disposition: preserved.** The four prefixed `margin-left` transitions stay, and with them the
per-frame reflow, the 14/15 shift entries and the ~0.108 input-free CLS.

**Gate.** **None — stated in §10.26.** No gate in this migration collects a performance trace, a
`layout-shift` entry or a computed style, and per §10.23 the corpus does not hold this page's body at
all. This is also the one of the five whose evidence is a trace rather than a DOM read, so nothing in
the repository would report a regression or an improvement here.

**The fix an AAP-authorized change should apply** (**not** a proposal for this migration): transition
`transform: translateX()` instead of `margin-left`, giving the outline pane its own composited
transform rather than deriving its position from the content pane's margin. Note that it interacts
with §10.23's media query — a full-width overlay variant below `$medium` changes what the transform
has to translate — so the two should be designed together.

### 10.27 A maximum-length 140-character course name lays out as a single unbreakable line box and escapes the viewport

The last of the five, and the only one that is not on the course page: it is on the class list and on
`/home`, and it is the one whose surfaces the corpus **does** pin by digest, which is what makes fact
3 of §10.23 concrete rather than theoretical here. The name length is entirely legal —
`name: Joi.string().min(1).max(140).required()` `[T config/routes.js:142]`, on `POST /courses` — so
this is reachable through the product's own validation rather than through an abusive input.

The basis for recording rather than repairing it is §10.23's four facts: the root causes are two
templates in `lib/views/**` and the absence of a declaration in `static/scss/**`, both of which AAP
§0.2.2 states verbatim are not modified and §0.3.1's target tree repeats; `git diff --name-only
2f8712a HEAD --` reports **0** changed files for each, so R-d governs; and here fact 3 bites hardest,
because both surfaces are pinned by a corpus digest (below).

**Root cause — two templates that interpolate a name with no wrapping affordance, and no stylesheet
that supplies one:**

```html
<!-- [T lib/views/classes/courses.html:10]  ·  server-rendered -->
    <li><a href='{{ host(instructor) }}{{ subdomain(instructor, course) }}'>{{course.name}}</a></li>
<!-- [T lib/views/home.html:83]  ·  and :96 (archived) and :118 (featured) — client-rendered -->
              {{ course.name }} <span ng-show="course.role" class="secondary-label label round">{{ course.role }}</span>
```

Neither carries `overflow-wrap`, `word-break` or `hyphens`, and neither does anything that applies to
them: measured over the whole SCSS tree, `static/scss/**` contains **exactly one** wrapping
declaration anywhere — `word-wrap: break-word` at `[T static/scss/embed/_generic.scss:94]`, inside an
embed tooltip rule (`white-space: pre; position: absolute; z-index: 999999`) that compiles into
`embed.css` and cannot reach a course name (**static**, `grep -rn` over `static/scss/`).

**Measured** (probe: headless Chrome against the running application on port 20370, on
`/u/user_c37/classes` and `/home` at 1280×800 and 320×720, with a course whose name is 140 × `A`):

```text
                                      classes@1280  classes@320   home@1280    home@320
intrinsic line box width                1658.125      1658.125     1658.125     1658.125
getClientRects().length                        1             1            1            1
overflow-wrap / word-wrap / word-break    normal        normal       normal       normal
white-space                               normal        normal       normal       normal
text-overflow                          clip (inert)  clip (inert) clip (inert) clip (inert)
hyphens                                   manual        manual       manual       manual
every ancestor up to body, overflow      visible       visible      visible      visible
right edge minus window.innerWidth      +535.71875   +1355.71875    +542.125    +1362.125
documentElement.scrollWidth                 1816          1676         1822         1682
characters present and painted                140           140          140          140
```

The line box is identical **to the thousandth of a pixel** in all four configurations — only the
container narrows — and `getClientRects().length` is **1** everywhere, so it never wraps at any
width. With `text-overflow: clip` inert for want of a clipping ancestor and every ancestor computing
`overflow: visible`, nothing can truncate it either: the failure mode is **viewport escape, not
silent clipping**.

**The page chrome cannot cover the document the escape creates.** `div.nav-wrapper` never spans the
scrollable width — `navCoversScrollWidth` is **false** in all four configurations, short by **536 /
542 / 1356 / 1362 px** respectively. Scrolled fully right at 1280, the grey band terminates at
viewport x = **744** in a hard vertical edge, and the 536px column beside it is bare unpainted page
background: `document.elementFromPoint(1270, 20)` returns `html`, with the escaping name the only
thing rendered out there. At 320 the whole band is **1036px** off-screen.

**`/home` differs in kind and is worth its own measurement.** There the name is a **raw text node**
inside `li.ng-binding.ng-scope` `[T lib/views/home.html:82-84]` rather than an anchor, so it
overshoots its own bordered row box by **1030.47 px** at 1280 and **1377.125 px** at 320, and the row
has grown to **69.19 px** tall because the `owner` badge beside it was pushed onto a second line. The
row's own border therefore gives the user no hint that its content has left the page.

**Target disposition: preserved on both surfaces.** Both templates interpolate the name exactly as at
`2f8712a`, and no wrapping declaration is added to the stylesheet.

**Ownership seam, recorded so a future change knows where the halves live.**
`lib/views/home.html` is owned by a different work unit in this delivery; this entry records the
`/home` surface as **measured, without changing it**, and the class-list surface likewise. A repair
touches both templates and the stylesheet, so it cannot be split along that seam.

**Gate.** **None — stated in §10.27.** No gate measures a line box, a `scrollWidth` or an element's
relationship to the viewport. What the corpus does hold, per fact 3 of §10.23, is the two page bodies
under the seeded dataset — `route.get.u-username-classes.html` at **200** / **12496** bytes /
`a3189b6c…` and `route.get.home.html` at **200** / **19399** bytes / `a6a8c2ef…` — and neither
recorded body contains a 140-character name (**artifact**, checked). So the gate cannot observe the
defect, and would report the *repair* as an unapproved difference: exactly the shape §10.23 sets out.

**The fix an AAP-authorized change should apply** (**not** a proposal for this migration): add
`overflow-wrap: anywhere` (or `word-break: break-word`) to the course-name anchor in
`lib/views/classes/courses.html` and to the `/home` row text, or clamp with `text-overflow: ellipsis`
inside an `overflow: hidden` container. Whichever is chosen, `/home`'s three interpolations must be
treated together, and they are **not** all the same construction: `:83` (active) and `:96` (archived)
are raw text nodes inside the `li`, while `:118` (featured) is `<a><strong>{{ course.name }}</strong></a>`.
The measurement above was taken on `:83`; the other two carry the same unwrapped interpolation and
were not separately measured.

---

### 10.28 Seven findings raised against the delivered tree and DECLINED on measurement

Each of these was raised as a defect at this checkpoint, measured on **both** trees, and declined
because the delivered tree does what the base commit does. They are collected in one section because
they share one disposition and one argument — R-d prohibits changing a behaviour that is preserved, and
R-e prohibits giving an edge a new mapping — and because a decline that is not recorded is
indistinguishable from an oversight. Every figure below is a measurement taken on one booted instance
over a seeded isolated database (`test/parity/server.js`), or a byte comparison against the baseline
worktree, and the command that produced it is named.

**1. A client metric carrying `attempt` is refused, and admitting it would move a gated validation
outcome** (raised as F81). Measured, user identity:

```text
POST /api/trinkets/clientmetric  {"lang":"python","event_type":"run","duration":12,"attempt":1}
  -> 200  application/json  245 bytes  7.171 ms
     {"lang":"python","event_type":"run","duration":12,"attempt":1,
      "flash":{…,"validation":{"attempt":"\"attempt\" is not allowed"}}}
POST /api/trinkets/clientmetric  {"lang":"python","event_type":"run","duration":12}
  -> 200  application/json   27 bytes 10.102 ms   {"flash":{},"context":null}
```

The rejecting layer is `[T config/api_routes.js:1313-1326]`, whose payload schema declares `lang`,
`event_type` and `duration` required and `trinketId`, `message` and `session` optional — and which is
**byte-identical to baseline**, the whole code diff of that file against `2f8712a` being one
shim-signature line. **Declined citing R-d and AAP §0.6.2**: `attempt` is not a key this application
has ever accepted, and admitting it moves one of the **102** declared validation accept/reject outcomes
that `test/parity/joi-matrix.js` gates, which is a change to the declared surface rather than to a
response. **What it would take, so a human need not re-derive it — three coordinated edits:** a
`attempt : Joi.number().integer().optional()` entry in that payload schema; the optional-parameter map
at `lib/controllers/trinket.js:1281-1284`; and `values.attempt` in `lib/models/clientMetric.js`. All
three, or the key is accepted by validation and then silently dropped.

**2. `GET /api/users/assets` without `type` answers 500** (raised as F21). Measured, user identity:

```text
GET /api/users/assets              -> 500  96 bytes  3.677 ms  the generic Boom payload
GET /api/users/assets?type=embed   -> 200  38 bytes  3.788 ms  {"files":[],"flash":{},"context":null}
```

`type` is optional in the route's query schema and the handler dereferences it, so the absent case
reaches the Layer 1 catch-all. **Declined**: the same 500 is what baseline answers for the same
request, and mapping it to a 400 or defaulting `type` would be a new error-to-response mapping (R-e) or
an invented default (R-d). The error-edge row for the site carries the same disposition.

**3. A 21-character username is rejected at every route, and nothing anywhere truncates one**
(raised as F50). Measured:

```text
PUT /api/users/{userId}  {"username":"abcdefghijklmnopqrstu"}   (21 characters)
  -> 200  143 bytes  6.022 ms
     {"username":"abcdefghijklmnopqrstu",
      "flash":{"validation":{"username":"\"username\" length must be less than or equal to 20 characters long"}}}
POST /users  formName=signup … username=abcdefghijklmnopqrstu   -> 302, no account created
POST /users  formName=signup … username=abcdefghijklmnopqrst    -> 302, account created
                                                                   (68.8 ms against 4.9 ms — the bcrypt work)
```

The bound is `Joi.string().min(3).max(20)` in the route declarations, identical on both trees.
**Declined**: there is **no truncation anywhere in either tree** — the finding assumed one and none
exists — so there is nothing to change, and adding a truncation would silently rewrite a
user-submitted value, which is exactly the improvement R-d forbids.

**4. A malformed invited address is upserted with `status: "invalid"` and listed** (raised as F84).
Measured, user identity, one course created for the probe:

```text
POST /api/courses/{courseId}/invitations  {"emailList":["not-an-email","real@example.com"]}
  -> 200  249 bytes  15.814 ms
     {"success":true,"invitations":[
        {"id":"…","email":"not-an-email","token":"c02980dd","status":"invalid"},
        {"id":"…","email":"real@example.com","token":"ba23b138","status":"sent"}],…}
GET /api/courses/{courseId}/invitations
  -> 200  227 bytes   both rows present, the malformed one still `status: "invalid"`
```

`addList` sets `update.status = "invalid"` at `[T lib/models/courseInvitation.js:53]` and the model is
**byte-identical to baseline** (`git diff --stat 2f8712a -- lib/models/courseInvitation.js` prints
nothing). **Declined**: the row is stored, flagged and never sent, which is the base commit's own
handling, and refusing the whole request or dropping the row would change a persisted outcome. Note
what the same measurement also shows — the tokens are the eight-hex `md5(email + course.id)`
derivation, which is the evidence
[§11.15](#1115-deviation-11-a-course-invitation-token-is-minted-from-the-csprng-and-accepting-one-requires-being-the-account-it-names)
cites for its token half being withdrawn.

**5. A course name carrying markup is stored verbatim and escaped by the template** (raised as F96 and
F105). Measured, user identity:

```text
POST /api/courses  {"name":"<img src=x onerror=alert(1)>"}
  -> 200  {"course":{…"name":"<img src=x onerror=alert(1)>",
             "slug":"less-than-img-src-x-onerror-alert-1-greater-than"…}}
```

So the raw markup is what is persisted, and the slug is the sanitised derivation. **Declined**, and the
decisive measurement is a byte comparison rather than a drive: the flash strings and
`lib/views/base.html` — indeed every file under `lib/views`, `public/js`, `public/partials` and
`static/scss` — are **byte-identical to baseline**, measured by an empty
`git diff --stat 2f8712a -- lib/views public/js public/partials static/scss`. The authored HTML is
therefore escaped by Nunjucks' default autoescaping on **both** trees, which is why nothing renders.
**And `| safe` is the fix that must not be applied**: `course.name` is user-controlled, as the drive
above shows, so marking the interpolation safe would turn a stored value into stored XSS. The finding
asked for the opposite of what the code needs.

**6. `course.updateCourse`'s unknown-save branch never settles on either tree, and is unreachable
through its own route.** `lib/controllers/course.js`'s `updateCourse` has a save-failure branch whose
baseline form is `reply(<plain object>)`: the shim's `reply(data)` for a plain object builds a
chainable builder and settles the deferred only from `.redirect()`, `.code()`, `.header()` or
`.view()`, none of which that branch calls, while the handler returns `undefined` — the same
mechanism [§11.10](#1110-deviation-6-post-apifolders-answers-where-the-baseline-process-died)'s
clause 2 measures. **So baseline never answered it either**, and the delivered tree's promise likewise
never settles. **Declined and left alone** rather than registered as a deviation, on the one ground
§11.0 requires and the folders case did not have: it is **unreachable through the route's own payload
schema**, so no request a client can send arrives there, and R-b's "the application must genuinely
run" is not engaged by a branch no route admits. It is recorded here so that a future change to that
schema knows what it would expose.

**7. The unbound-`Boom` family in `lib/controllers/users.js` answers 200 with the ReferenceError's
text, on both trees** (raised as F17 and F18). Measured, user identity:

```text
GET /api/exports/000000000000000000000999           -> 200  65 bytes  5.885 ms
   {"error":"Boom is not defined","flash":{"requested":["testing"]}}
GET /api/exports/000000000000000000000999/download  -> 200  42 bytes  5.845 ms
   {"error":"Boom is not defined","flash":{}}
GET /api/exports/notanid                            -> 200 119 bytes  4.748 ms
   {"error":"Cast to ObjectId failed for value \"notanid\" (type string) at path \"_id\" for model \"Export\"","flash":{}}
```

The delivered sites are `lib/controllers/users.js:685, 902, 1087, 1107, 1126, 1419, 1434, 1964-2047`
against the baseline's `:213, 377, 545, 562, 579, 667, 680, 1027-1090` — the same population, moved by
the line-count changes above them, with the expressions themselves byte-identical. **Declined**:
binding `Boom` would give these edges the 404 and 403 their authors intended and neither tree has ever
served, which R-e prohibits per edge.
[§9.9](#99-two-routed-handlers-that-answer-200-carrying-the-name-of-a-missing-identifier) and
[§10.20](#1020-the-rest-of-the-unbound-boom-family-in-libcontrollersusersjs) carry the static analysis;
this entry adds the route-level drive the earlier sections could not take.

**Three further declines are recorded elsewhere in this delivery and are named here so the set is
countable.** The `chokidar` removal the AAP's own removals table names is declined on measurement in
[`dependency-inventory.md`](dependency-inventory.md) §4.5 — hiding the package makes
`config/app.config` fail to load under `test` and `development`, which would breach AAP §0.6.5. The
`pm2` pending deprecations in the root image are a **named deviation** rather than a decline and are in
[`deferred-dependencies.md`](deferred-dependencies.md). And the login-message half of deviation 12 is a
**withdrawal**, recorded at [§11.16](#1116-deviation-12-the-login-failure-response-no-longer-distinguishes-account-existence-or-state-and-a-repeated-failure-is-delayed).

---


## 11. The approved deviations

These are the **only eighteen** numbered places in the migration where something was deliberately **not**
preserved, and **thirteen of the eighteen are what the delivered tree actually does**.
Each is recorded as a deviation rather than as preservation, and each is stated once, canonically, here;
the handler mapping and the corresponding gate carry the same decision, and a divergence between the
eight would itself be a defect. **Three earlier revisions of this paragraph stated the count as two,
three and four and were left stacked on top of one another**; they are replaced by this one, and the
register table in §11.0 remains the canonical list.

**A number in this register is retired, never reused, and a withdrawal is recorded rather than
deleted.** Five of the eighteen no longer describe the delivered tree, because the change each
approved was withdrawn after this register was written — deviations **7, 8, 11 (in part), 13 and 15**,
each measured against the tree in §11.0's table and each carrying the measurement in its own section.
A withdrawn entry keeps its number and its argument: renumbering would move every citation of it in
this file and in four others, and deleting it would hide the fact that the change was once approved and
is now gone, which is precisely the history a reader of a register needs. **The count of eighteen is
the register's extent. The count of live deviations is thirteen, and the two figures are stated
separately everywhere they appear.**

The sections are ordered as they were written rather than by number: deviations 1 and 2 are
[§11.1](#111-deviation-1-the-never-settling-file-response) and
[§11.2](#112-deviation-2--the-marked-fork-is-retained-leaving-one-named-high-advisory); deviations 3 to
6 are [§11.7](#117-deviation-3--the-zip-container-bytes-both-archive-download-routes-emit),
[§11.8](#118-deviation-4--the-course-archive-is-built-in-a-per-request-directory-so-a-concurrent-download-is-no-longer-served-another-requests-course),
[§11.9](#119-deviation-5-the-bounded-zipcode-read-and-the-process-death-it-no-longer-causes) and
[§11.10](#1110-deviation-6-post-apifolders-answers-where-the-baseline-process-died); and deviations 7
and 8 are
[§11.11](#1118-deviation-14-the-four-outputfile-upload-routes-accept-multipart-and-answer-200) and
[§11.12](#1119-deviation-15-two-client-side-markup-sinks-render-user-text-inert). In between,
§11.3–§11.6 and §11.13 record what is *not* a deviation.

**Two were decided by AAP §0.7 before the plan was frozen. The other six were found by measurement
after it, and each is authorized by the AAP's own procedure rather than by anybody's preference.** Rule
T-6 (AAP §0.1.2) states that procedure in full: *where a requirement other than R-d makes preservation
impossible, the plan names the conflict, decides which requirement controls, states why, records the
deviation as approved, and aligns the handler mapping, the quirk record and the gate*. That is a
procedure for a class of conflict, not a quota of two — §0.7 decided the two conflicts the plan had
measured, and further instances of the same class turned up by measurement: `folders.create`, where the
baseline does not merely fail to answer but **terminates the whole process** (§11.10); four upload
routes whose handlers no shipped client could reach at all (§11.11); and two client-side templates that
could not keep their rendered output without executing one user's markup in another user's browser
(§11.12). The distinction that matters is the one §11.0 enforces next: the register grows only when a
requirement makes preservation *impossible*, and never because a different outcome would be better —
which is why [§11.13](#1121-three-target-only-changes-that-are-not-deviations-two-withdrawn-one-corrected)
withdrew two changes and corrected a third instead of adding three more rows.

### 11.0 The register, and why a tool cannot add to it

**Exactly eighteen deviations are numbered here, thirteen of them live in the delivered tree. This
section is the whole list of approved deviations, and it is not extensible by a tool.** The reason this
needs saying explicitly, rather than being left to a
reader's count, is that two separate tools were found minting their own: a replay verifier that
approved any scenario carrying an "approved-change" marker regardless of its identity, and a worker
harness that described a residual
deprecation warning and an unclosable handle inventory as "named deviations". Neither had been argued
or approved. A deviation that a tool can declare for itself is not a deviation — it is drift with a
label, and it defeats the one prohibition (R-d) this whole document exists to enforce. The same is
true of a *source comment* that calls itself approved: §11.1 and §11.4 each record one that did.

**What it takes to be in this table**, so that the difference between "not extensible by a tool" and
"never revised" is not lost: a prohibition (R-d) argued away by a requirement that outranks it, with
the precedence argument written out, the changed behaviour stated field by field, and the gate that
observes it named. Anything short of that is either preservation (the rest of this catalogue) or an
unmet validation target (§11.3) — never a deviation. Adding a row is a deliberate, argued act
recorded here first, because this document is the **canonical** register: both
[`baseline-parity.md`](baseline-parity.md) and [`deferred-dependencies.md`](deferred-dependencies.md)
state in their own deviation sections that their numbering follows this §11.

**"Closed" has always meant closed to tools, to preference and to improvement — not closed to
measurement.** The register moved from two entries to eighteen, one argued addition at a time and each for the reason
T-6 names above — and it moved the other way too, five entries being **withdrawn** on later measurement
rather than left standing as approvals of changes the tree no longer makes, and the addition was argued in prose and bound to a field-by-field contract before any code
relied on it. Entries 7 to 10 were added by a route the earlier six did not use, and it is named rather
than blurred into the others: each is a behaviour this delivery's own runtime **security verification**
raised as a defect and assigned for remediation, three of them marked blocking. That is a requirement
outranking R-d in the only way R-d admits — an instruction from the authority that froze the AAP — and
it is not the same thing as a preference for safer behaviour, which §11.3 still refuses. §11.4's
exposure table is what makes the distinction checkable rather than rhetorical: every row there
"remains open **until that follow-up is separately approved and implemented**", and row 9 went further
and named the fix, the AAP section prescribing its shape, and the files it would need. Deviation 7 is
that follow-up, approved and implemented. What remains prohibited is unchanged and is what every rule below implements: a tool
cannot mint an entry, a source comment cannot mint one either — that was the specific defect §11.9
was raised against, an in-source "APPROVED DEVIATION" label with nothing in this register behind it —
and a change that could have preserved baseline is not a candidate at all, however much better it
looks. §9.10, §10.12 and §10.13 are three findings raised against this delivery that were **declined**
on precisely that last test, and they are the control that shows this one was not waved through.
**Deviations 7 and 8 are the two most recent additions, and both were found the way §11.9's was — as a
change already in the tree with nothing behind it but a source comment.** Deviation 7 came with a quirk
entry (§10.10) that described the *opposite* of the delivered behaviour; deviation 8 came with nothing at
all. Three further changes found in the same pass are **not** here, because preservation was possible for
them: they were withdrawn or corrected, and
[§11.13](#1121-three-target-only-changes-that-are-not-deviations-two-withdrawn-one-corrected) records
which and why. That ratio — two argued in, three sent back — is the test being applied rather than
recited.

| # | State in the delivered tree | Deviation | Kind | Replay-visible? | Canonical id | Owner of the full argument |
|---|---|---|---|---|---|---|
| 1 | **LIVE** — served, and the one marker the corpus itself carries | The never-settling image-download response is **served** | Response behaviour | **Yes** — one scenario | `quirk.reply-chain.never-settles.image-download` | [§11.1](#111-deviation-1-the-never-settling-file-response) |
| 2 | **LIVE** — `npm audit --omit=dev` still reports the one high on the retained fork | The `marked` fork is **retained**, leaving one named high advisory | Audit result | **No** — no scenario, no response difference | *none — see below* | [`deferred-dependencies.md`](deferred-dependencies.md) §4.2 |
| 3 | **LIVE** — `adm-zip` 0.6.0 and `archiver` 7.0.1 both resolve in the delivered lockfile | The **ZIP container bytes** both archive download routes emit changed — `adm-zip` 0.4.16 → 0.6.0 on the course archive, `archiver` 2.1.1 → 7.0.1 on the short-code archive | Served file format | **No** — the raw digest of an archive is a clock read, so no recording carries a comparable one; the container is compared **structurally** instead | *none — see below* | [§11.7](#117-deviation-3--the-zip-container-bytes-both-archive-download-routes-emit) |
| 4 | **LIVE** — measured at `[T lib/controllers/courses.js:347]`, `fs.promises.mkdtemp(path.join(os.tmpdir(), 'trinket-course-download-'))`, against `[B lib/controllers/courses.js:147]` `'/tmp/' + owner.username` | The course archive is built in a **per-request** directory, so a concurrent download is no longer served another request's course and a lost open no longer kills the process | Concurrency and availability | **No** — the difference needs two overlapping requests for one owner and course, which no committed scenario drives; on the ordinary path the response is identical, which the container pin asserts | *none — see below* | [§11.8](#118-deviation-4--the-course-archive-is-built-in-a-per-request-directory-so-a-concurrent-download-is-no-longer-served-another-requests-course) |
| 5 | **LIVE** — the three bounds and the terminating handler are registered as approved rows in `test/parity/error-edges.js` | The `zipCode` read is **bounded** and its chain **terminated**, so a malformed or amplifying archive no longer ends the process | Availability behaviour | **No** — no scenario mentions `zipCode`, and the two responses are byte-identical to baseline's | *none — see [§11.9](#119-deviation-5-the-bounded-zipcode-read-and-the-process-death-it-no-longer-causes)* | [§11.9](#119-deviation-5-the-bounded-zipcode-read-and-the-process-death-it-no-longer-causes) |
| 6 | **LIVE, and the status in the row to its left was corrected**: both failure branches answer **500**, not the 409 an earlier revision of §11.10 described. See §11.10 | `POST /api/folders` **answers** on both failure branches, where baseline terminated the process on one and never settled on the other | Response behaviour | **Not yet** — the scenario exists but its baseline side cannot be driven, so it carries **no marker** | `client-contract.folder-duplicate-name.post-api-folders` (definition only) | [§11.10](#1110-deviation-6-post-apifolders-answers-where-the-baseline-process-died) |
| 7 | **WITHDRAWN.** Measured: `[T app.js:372]` appends `"; SameSite=None; Secure"` exactly as `[B app.js:229]` does, and `[T app.js:328-337]` records that append as *part of the contract*. The delivered corpora carry `session=…; Secure; HttpOnly; SameSite=Lax; Path=/; Expires=…; SameSite=None; Secure` in the secure pass, and the corpus gate reports **no** `header.set-cookie` difference on any login response. See §11.11 | The session cookie's `SameSite` is emitted **once**, so secure mode serves `SameSite=Lax` instead of a duplicated attribute a browser resolves to `None` | Cookie attribute | **No** — visible only in the secure pass, where `secureDifferential` *is* the expectation, so no scenario differs and no marker exists | *none — see below* | [§11.11](#1111-deviation-7-the-session-cookies-samesite-attribute-is-emitted-once-so-secure-mode-no-longer-serves-samesitenone) |
| 8 | **WITHDRAWN.** Measured: `grep -rn trustedOrigins` over `app.js`, `config/` and `lib/` finds nothing, and there is no `Origin`, `Referer` or `Sec-Fetch-Site` read anywhere in the tree. See §11.12 | A **credentialed cross-origin** state-changing request is answered **403** instead of being performed | Request admission | **No** — no committed scenario carries `Origin`, `Referer` or `Sec-Fetch-Site` (measured), so no scenario's response changes | *none — see below* | [§11.12](#1112-deviation-8-a-credentialed-cross-origin-state-changing-request-is-rejected) |
| 9 | **LIVE** — both Accept modes, marker projected from the closed register in `test/parity/replay.js` | `POST /{userSlug}/courses/{courseSlug}/copy` **answers** its duplicate-name and unknown-write branches, where baseline terminated the process and the delivered tree hung | Response behaviour | **Not yet** — two scenarios exist and both already carry a recorded baseline half (a severed socket), but neither carries a marker until they are re-captured with their sidecar | `route.post.userSlug-courses-courseSlug-copy.html` and `.json` (recorded baseline, no marker) | [§11.11](#1113-deviation-9-the-page-level-course-copy-answers-where-the-baseline-process-died) |
| 10 | **LIVE** — `[T lib/util/helpers.js:515-616]`, with `app.mail.secret` retained at `[T config/default.yaml:164]` | The **email share token's HMAC key** is no longer derivable, and an unset `app.mail.secret` fails closed — so a token minted with the previously public key is refused where it was accepted | Capability check | **No** — the one committed scenario posts an empty token and records 400, which is unchanged | *none — see below* | [§11.11](#1114-deviation-10-the-email-share-tokens-key-is-no-longer-derivable-and-an-unset-appmailsecret-fails-closed) |
| 11 | **PART WITHDRAWN.** The **token is derivable again**: `lib/models/courseInvitation.js` is byte-identical to baseline and still mints `crypto.createHash("md5").update(email + course.id).digest("hex").substring(0, 8)` at `:37`. The **accept-side identity requirement is live**, at `[T lib/controllers/classes.js]`. See §11.15 | A **course invitation token** is minted from the CSPRNG, and accepting one requires being the account it names — so an outsider holding a real token is no longer enrolled and no longer consumes it | Capability check, and a persisted value's entropy | **Yes — one scenario**, and only because the recorded token was derivable; it is a **volatile-field** matter, not an allowlist one, and the contract is in §11.12 | *none — the field is per-run, so no marker can pin it* | [§11.12](#1115-deviation-11-a-course-invitation-token-is-minted-from-the-csprng-and-accepting-one-requires-being-the-account-it-names) |
| 12 | **PART WITHDRAWN.** The **message half is withdrawn**: `[T lib/controllers/users.js:549, :561, :568, :587]` carry the base commit's four strings again. The **rate half is retained**: `[T lib/controllers/users.js:133-399]`, a bounded per-key delay capped at 4000 ms. See §11.16 | The **login failure response** no longer distinguishes account existence or state across three of its four branches, and a repeated failure is delayed | Response body, and timing | **Yes — one scenario**, `route.post.login.json`. This is the **only** entry since deviation 1 that needs an allowlist id, and it does not have one yet | `route.post.login.json` (contract stated, implementation handed over) | [§11.13](#1116-deviation-12-the-login-failure-response-no-longer-distinguishes-account-existence-or-state-and-a-repeated-failure-is-delayed) |
| 13 | **WITHDRAWN.** Measured: `[T config/routes.js:59]` and `[T config/api_routes.js:1222]` both declare `email : Joi.string().required()`, byte-identical to `[B config/routes.js:58]`; the whole code diff of `config/api_routes.js` against baseline is one shim-signature line. See §11.17 | A **non-string `email`** on the login routes is rejected by validation instead of reaching the catch-all as a 500 — the response its sibling field already produced | Response behaviour | **No** — no committed scenario posts a non-string field, measured across all 392 | *none — see below* | [§11.14](#1117-deviation-13-a-non-string-email-on-the-login-routes-is-rejected-by-validation-instead-of-reaching-the-catch-all-as-a-500) |
| 14 | **LIVE** — the translation is `migratePayloadOutput` in `[T lib/util/routeParser.js]`, and the eight upload scenarios are authorized under order-0 R1 | The four `output:'file'` upload routes declare `payload.multipart` and **answer 200** to the multipart body every shipped uploader sends, where baseline's parser refused it with 415 | Route behaviour | **Yes — eight scenarios**, two of which record the 415 as their expectation; they need the marker adding, which is stated in §11.11 and handed to the corpus owner | `client-contract.multipart-upload.api-user-assets`, `client-contract.multipart-upload.api-user-assets-replace` (recorded baseline, no marker yet) | [§11.11](#1118-deviation-14-the-four-outputfile-upload-routes-accept-multipart-and-answer-200) |
| 15 | **WITHDRAWN.** Measured: `git diff --stat 2f8712a -- lib/views public/js public/partials static/scss` prints **nothing**, so both sinks are the base commit's bytes. See §11.19 | Two client-side markup sinks render user-authored text **inert**: the library search typeahead loses its `<strong>` match emphasis, and code-editor file names are escaped | Rendered output (client-side) | **No** — measured: no recorded response body carries either sink, since the typeahead partial is fetched at run time and the editor templates are string literals in an asset whose body the corpus does not record | *none — see [§11.12](#1119-deviation-15-two-client-side-markup-sinks-render-user-text-inert)* | [§11.12](#1119-deviation-15-two-client-side-markup-sinks-render-user-text-inert) |
| 16 | **LIVE — new.** Measured: 200 `application/json`, 68 bytes, `{"message":"roles required","flash":{"requested":["administrator"]}}` in 12.335 ms | The **payload-less roles update answers** through the route's own funnel, where the baseline process exited on `request.payload.roles` | Response behaviour | **Yes — one scenario**, and its marker is projected from the closed register rather than recorded in the corpus, because the corpus is captured from `2f8712a`, which dies on this request | `route.post.api-admin-user-userId.json` | [§11.22](#1122-deviation-16-the-payload-less-roles-update-answers-where-the-baseline-process-exited) |
| 17 | **LIVE — new.** Measured: 200 `application/json`, 65 bytes, `{"success":true,"flash":{"requested":["testing"]},"context":null}` in 13.547 ms, with the confirmation mail sent | The **email-change request settles**, where the baseline never answered at all | Response behaviour | **Yes — one scenario**, marker projected from the closed register for the same reason as 16 | `route.post.api-users-email.json` | [§11.23](#1123-deviation-17-the-email-change-request-settles-where-the-baseline-never-answered) |
| 18 | **LIVE — new.** Measured on both trees: the target answers 500 / 1600 bytes, byte-identical to `/embed/beta/harmless-unknown-slug`, and stays up; the baseline process dies (curl exit 52, then connection refused) | A **control character in an embed view parameter** is refused before it reaches `@hapi/vision`, where it terminated the baseline process | Response behaviour | **No** — no committed scenario sends a percent-encoded control character in a path segment, measured across all 392 | *none — the row is registered in `test/parity/error-edges.js` as `trinket.beta.response.1`* | [§11.24](#1124-deviation-18-a-control-character-in-an-embed-view-parameter-is-refused-instead-of-ending-the-process) |

**Which numbers have a scenario id, measured rather than recited.** Five scenario ids across four
deviations are replay-visible, and the rest have none. That is a measurement over the delivered corpus
and the delivered register, and three earlier revisions of this paragraph — which said "the allowlist
is exactly one scenario id", counted eleven of fifteen as invisible, and reasoned about deviations 7
and 8 as though they were live — are replaced by it rather than left stacked beside it.

| Deviation | Scenario id(s) | Where its marker comes from |
|---|---|---|
| 1 | `quirk.reply-chain.never-settles.image-download` | the corpus, which records the marker itself |
| 9 | `route.post.userSlug-courses-courseSlug-copy.html` and `.json` | the closed register in `test/parity/replay.js`, projected |
| 16 | `route.post.api-admin-user-userId.json` | the closed register, projected |
| 17 | `route.post.api-users-email.json` | the closed register, projected |

**Why four of the five markers are projected from the register rather than recorded in the corpus, and
why that is not a widening.** A corpus marker is written by `test/parity/capture.js`. Every one of these
four scenarios records a **baseline** half in which the process died or never answered, so the marker
could only be added by re-capturing with an edited `capture.js` — and `test/parity/replay.js` refuses a
corpus whose generator is not the delivered blob, so the re-capture would disqualify the very gate the
marker exists to satisfy. `registerMarker(contract)` in `replay.js` therefore projects the marker from
the frozen contract instead. **Identity is unchanged** — the same closed allowlist of ids decides what
may carry a marker at all — **and every field check runs identically**. The one property a corpus
marker evidenced, that the recording predates the deviation, is *measured* by the contract's
`fromOutcome` rather than asserted: a corpus that already recorded the deviated behaviour is refused.

**The deviations with no scenario id, and why none of those is an omission.** Deviation 2 changes no
response at all — retaining the fork is precisely what keeps rendered output identical (§11.2) — and is
a departure from the audit *target* measured by `npm audit`. Deviation 3 changes a response body in a
field no recording can hold to account, because a ZIP embeds each entry's modification time, so it is
registered against the frozen container profile in `ARCHIVE_CONTAINER_REGISTER` instead (§11.7, where
the digest was measured to differ between two captures of one tree). Deviation 4 needs two overlapping
requests for one owner and course, which no committed scenario drives. Deviation 5 removes a process
death and leaves the statuses baseline already emitted, and no committed scenario mentions `zipCode`;
its four rows are registered in `test/parity/error-edges.js` instead. Deviation 6's scenario is defined
but recorded `unreachableByDesign`, because driving it on the baseline side is what kills the baseline
process. Deviation 10's one committed scenario posts an empty token and records the unchanged 400.
Deviation 14 is visible on eight scenarios but as an ordinary authorized difference under order-0 R1,
not as a marker. Deviation 18's guard fires only on a percent-encoded control character in a path
segment, which no committed scenario sends — measured across all 392 — so it too is registered in
`error-edges.js` rather than as a marker.

**And the five withdrawn or part-withdrawn numbers have no id because they change nothing to mark.**
Deviations 7, 8, 13 and 15 are withdrawn outright and deviation 11's token half with them, so there is
no difference for a marker to approve; a marker on any of their scenarios would be caught by rule 2
below as drift. Deviation 12's surviving half is a **timing** change, which no recorded field carries.

**One thing this register is *not* the list of, and the distinction is the reason the count holds.**
A behaviour the **framework** removes in a path no application file can reach is not a deviation this
register can carry: there is no application decision to approve. Exactly one such divergence exists —
hapi 21 emitting only cookie CLEARS on a response carrying a 500 error — and it is registered
separately in [§12](#12-the-register-of-framework-imposed-divergences--one-entry), which holds one
entry and is likewise not extensible by a tool. It is **not** one of the deviations above, this table
is still the whole of the approved-deviation list, and neither the extent of eighteen nor the live
count of thirteen is changed by it.

**Why the deviations' own sections are numbered §11.7 to §11.24 rather than §11.3 onward.** §11.3
through §11.5 were already occupied when the register was first written — by the classification of what
is *not* a deviation and by two withdrawn policies — and renumbering them would have moved every
citation of them in this file and in four others for no gain. **This table is the canonical ordering**;
the section numbers are addresses, not the register.

**The consequence for the deviation-approval contract, stated as the rule a verifier implements:**

1. **The allowlist is exactly five scenario ids, across four deviations** — 1, 9 (two ids), 16 and 17,
   named in the table above. It is an allowlist, not a pattern, and `test/parity/replay.js` implements
   it keyed by scenario id, which is why it stays correct as this register grows: a deviation that is
   not replay-visible has no id for a marker to claim. An earlier revision of this rule said "exactly
   one", which was the register of record when it was written and is not now.
   **A marker may be projected from the closed register as well as recorded in the corpus**, and the
   two are equivalent in authority and identical in what they are checked against — the paragraph
   above the table states the measurement that decided it. **What may not happen is a marker on an id
   this register does not name**, whatever its source, which is rule 2.
   **Deviation 6 must not be added to it until its scenario can be driven.** Its scenario is defined
   but recorded `unreachableByDesign`, because driving it on the *baseline* side is what terminates the
   baseline process (§11.10); a scenario with no recorded baseline response produces no difference for
   a marker to approve, so a marker on it today would approve nothing and would be caught by rule 2 as
   drift. When `test/parity/capture.js` makes it drivable, the field contract to add is stated field by
   field in §11.10 and nowhere else.
   **Deviation 14 does not extend it, and the reason is that it does not need to.** Its eight upload
   scenarios are compared as ordinary differences and are authorized under order-0 R1 in
   `test/parity/corpus.authorized.json`, with the surface change itself authorized in
   `test/parity/manifest.js`. An authorized difference and a deviation marker are two different
   mechanisms, and using the marker here would claim an approval the R1 mandate already covers.
   **Deviations 7, 8, 11's token half, 13 and 15 are withdrawn, so nothing may be marked for them at
   all** — see their rows above for the measurement, and rule 4, which is the rule a marker on an
   unchanged scenario breaks.
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
   than restated, so they cannot drift from the object the scenario downloads. **The response now
   carries two headers that are outside those five fields** — `Content-Security-Policy` and
   `X-Content-Type-Options`, added to close the security exposure recorded at
   [§10.6](#106-serving-the-approved-image-response-served-script-capable-legacy-content-inline--closed-on-the-response-side).
   All five contract fields are unchanged by them, which is why the scenario still passes, and
   `verifyApprovedDeviation` compares the five it is given rather than rejecting an unlisted header. A
   reader should take that as the verifier's scope and not as permission: **changing any of the five
   still requires a human to amend this rule first**, and a recapture of the corpus will record the two
   new headers as ordinary response fields.
4. **A marker on a scenario that did not change is also a failure.** R-b is why the deviation exists;
   a route that still hangs has not implemented the decision.
5. **A framework-imposed divergence is carried as a RULE, never as a marker, and its authority is
   §12 alone.** The replay verifier's cookie demotion on a 500
   (`hapi21-500-clear-only-states`) is exactly that: a fail-closed rule with measured conditions,
   authorized by [§12](#12-the-register-of-framework-imposed-divergences--one-entry) and by nothing
   else, and it names that section in its own `register` field. It does **not** consume a slot in the
   allowlist above, which stays at the five scenario ids rule 1 names, and the two mechanisms are not
   interchangeable — a marker approves one scenario's difference, a rule demotes a field on any
   response meeting a framework predicate. **Neither can be minted by a tool**: a rule a tool
   declared for itself is the same drift-with-a-label this section exists to stop, and a rule whose
   register entry does not exist has no authority at all.
6. **Deviation 1's approval covers the response, and was argued on the image case only — the case it
   did not cover is now closed rather than open.** Its justification is that the sibling branch four
   lines below performs the identical chain, and that branch's purpose is to render an *image* inline.
   A document whose `mime` is not an image type takes the same branch — selection is on `type`,
   response typing is on `mime`, and nothing validates one against the other — so the approved
   response served whatever those legacy documents declared, including active content that **executed
   on the application origin for an anonymous visitor**. That case was not analysed when the deviation
   was approved, it was never approved by implication, and it was raised against the delivered tree as
   a HIGH blocking security finding. It is now **closed on the response side** by the two headers rule
   3 records, and the whole of the argument, the measurement and the residue is at
   [§10.6](#106-serving-the-approved-image-response-served-script-capable-legacy-content-inline--closed-on-the-response-side).
   What this rule still says to a human reader is the part that does not change: **the contract's five
   fields are silent about what the bytes are permitted to do**, so a future amendment to them must
   re-ask that question rather than inherit this answer. A verifier reads rules 1–4 only.

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

**Target.** The approved response is a **three-call** construction — the status, the file's own
content type and its byte count — and this is the delivered statement at that address, quoted as it
stands rather than as the contract abbreviates it:

```javascript
// [T lib/controllers/files.js:632-636]
      return h.response(stream)
        .type(request.pre.file.mime)
        .bytes(request.pre.file.size)
        .header('Content-Security-Policy', LEGACY_IMAGE_CSP)
        .header('X-Content-Type-Options', 'nosniff');
```

The three approved calls are exactly as approved. **The two `.header(...)` calls are not part of this
approval** — they were added later, under QA finding W002-I4, to close the security exposure this
deviation created, and they sit outside all five contract fields: the status, the content type, the
byte length, the absent `content-disposition` and the timeout-to-answered outcome are each unchanged by
them. [§10.6](#106-serving-the-approved-image-response-served-script-capable-legacy-content-inline--closed-on-the-response-side)
carries that argument and its measurement, and [§11.0](#110-the-register-and-why-a-tool-cannot-add-to-it)
rules 3 and 6 carry what it does and does not license. `Content-Disposition` stays omitted. The four
header-resolved chains, including the sibling at `[T lib/controllers/files.js:641-644]`, are unaffected
and are preserved exactly (§4.2).

**The delivered source was that expression and nothing else for a while, and it took a correction to
get there — then two headers were added back, deliberately and with an argument, and the difference
between those two events is the substance of this paragraph.**
Recorded because the correction is the substance, and because a reader comparing this section against
an earlier revision of the tree will find the difference. An earlier delivery implemented the approved
response and then **extended** it with a second, unapproved behaviour change on the same branch:
a bounded read of the object's leading bytes (`peekHead`), a `SAFE_RASTER_SIGNATURES` allowlist and an
`inlineImageDisposition` classifier, `X-Content-Type-Options: nosniff` and a `Content-Security-Policy`
header on both outcomes, substitution of `application/octet-stream` for the file's own mime whenever
the declared type and the bytes disagreed, and a sanitized `Content-Disposition: attachment` header on
that outcome. **All of it was removed** — 386 deleted lines — and the `inlineImageDisposition` export
was removed with it, so the delivered module exports exactly `uploadAvatar`, `upload`, `download`,
`setThumbnail` and `legacyMimeExtension`. **Two of that extension's eight parts have since been
re-added, and six have not.** The two are the `Content-Security-Policy` and `X-Content-Type-Options`
headers, now emitted on the image branch only; the six that stay out are the bounded byte read, the
signature allowlist, the `inlineImageDisposition` classifier, the content-type substitution, the
attachment fallback, and emitting any of it on the sibling branch. The distinction is not cosmetic:
each of the six either reads the object's bytes or changes one of the five approved fields, and neither
of the two that returned does either. What made the first attempt drift was not the headers — it was
the unargued substitution of two approved fields and an in-source comment claiming its own approval.

**It was not a deviation at all; it was drift.** The argument it carried in-source — that the response
did not exist at baseline, so nothing observable was being changed and the deviation's author was free
to decide what the new response contained — is the one thing [§11.0](#110-the-register-and-why-a-tool-cannot-add-to-it)
rules out: *"A deviation that a tool can declare for itself is not a deviation — it is drift with a
label"*, and a comment in a source file has no more authority to approve one than a tool does. Two of
the five approved fields were breached by it and two headers outside the contract were added: the
content type became `application/octet-stream` for a metadata mismatch rather than the file document's
own mime, `content-disposition` was **present** rather than absent, and `X-Content-Type-Options` and
`Content-Security-Policy` were emitted on every outcome. Status, byte length and the timeout-to-answered
outcome were the three it did keep. §11.0's register names its entries and does not admit an
unargued one; this is deviation 1, and deviation 1 is the three approved calls above — plus, since
QA finding W002-I4, two protective headers that change none of the five fields and are recorded as
what they are in rule 3 and rule 6 of that register.

**What the withdrawal left unaddressed, and how it was addressed afterwards.** The extension was
answering a real exposure: `file.type` and `file.mime` are independent legacy fields, and at that point
nothing validated either the relationship between them or `mime` itself
`[B lib/models/file.js:6-9]` — so a legacy document carrying `type: 'image/png'` with
`mime: 'text/html'` was served inline, as active content, on the application origin, from a route that
inherits `mode: 'try'` and is reachable anonymously. The withdrawal was still right, because six of the
extension's eight parts changed approved fields or read the object's bytes; what it left behind was an
exposure with no remedy attached. **That is no longer open.** QA finding W002-I4 re-drove it
anonymously in a real browser, raised it as HIGH and blocking, and it is now closed on the response
side by the two headers above, with the argument, the before-and-after measurement and the honest
residue — no allow-list on `mime`, and no census of legacy rows — at
[§10.6](#106-serving-the-approved-image-response-served-script-capable-legacy-content-inline--closed-on-the-response-side).
`mime` is now validated for shape as part of that closure `[T lib/models/file.js:11-17]`. The same
route's separate authorization gap is
[§10.5](#105-a-stored-file-is-downloadable-by-anyone-who-knows-its-id-or-its-content-hash), and it is
untouched by this: §10.6 explains why authorizing the route would not have closed §10.6 either.

**The scope limit, recorded on the approval rather than only on the exposure.** Reason 2 above is an
argument about an **image**: the sibling branch is adopted because this branch exists to render an image
inline. It does not extend to a document whose `mime` is `text/html` or `image/svg+xml`, and the
non-image case was **not analysed** when the deviation was approved — nothing in the approval record,
in AAP §0.7 or in §0.4.1's row addresses it. So this approval is read as covering the *response
construction*, not as a judgement that any byte sequence a legacy `File` document declares is safe to
serve inline; rule 6 in [§11.0](#110-the-register-and-why-a-tool-cannot-add-to-it) states that
explicitly, and §10.6 carries what was done about it. This is not a retraction of the deviation: the
branch must still serve, because R-b is why it exists and a hanging route is not an acceptable
alternative. It is a statement that "serving is approved" and "serving as active content is approved"
are different claims, only the first was ever made — and the second is now answered NO in the response
itself rather than left to a reader, which is what the two headers do without touching any field the
first claim covers.

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
  [§11.0](#110-the-register-and-why-a-tool-cannot-add-to-it) rather than
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

"Closed" in this heading means what [§11.0](#110-the-register-and-why-a-tool-cannot-add-to-it) says it
means — the register does not grow by a tool's hand, and an entry is added only by an argued
precedence case — **not** that its count is frozen. The register's extent is eighteen and thirteen of
those are live, and §11.7 to §11.24 are the sixteen that were added by that route. **Nor does "closed"
mean an entry can never be withdrawn**: five have been, each because the change it approved was later
withdrawn from the tree, and §11.0's table carries the measurement for each. Withdrawing an entry is
the same deliberate, argued act as adding one — it just runs in the direction R-d prefers.
**"Closed" survives the register having grown, and this section is why the two are not in tension.**
§11.10 was admitted because R-b made preservation *impossible* — the baseline process exits — which is
one route in. **There is a second, and naming it is what keeps the classification honest**: a
behaviour this delivery's own runtime security verification raised as a **defect and assigned for
remediation** is directed work, and R-d's prohibition is on *improvements* — changes nobody asked for.
Deviations 7 to 10 came in that way, and §11.4's exposure table is the mechanism rather than a
courtesy: each row there stays open "until that follow-up is separately approved and implemented", so
approval arriving is a condition the register set for itself. **The two routes are not
interchangeable, and the difference is the whole of this section's business.** A directed remediation
is admitted; a change that merely looks safer, or that a reviewer would prefer, is refused however
security-shaped it is — which is why the three findings below were declined and why §11.4, §11.5 and
§11.6 record three bodies of security policy that were **added and then withdrawn** for having no
directive behind them. What is closed is every other route: an unmet validation target (the three rows
below), a tool's own marker, a source comment's own label, and a change that would merely be an
improvement. Three findings raised against this delivery asked for the last of those and were
**declined** on it, each with its citation: [§9.13](#913-two-more-routed-handlers-that-answer-500-where-their-author-intended-403),
[§10.16](#1016-the-folder-name-contract-is-asymmetric-between-create-and-rename) and
[§10.17](#1017-a-folder-name-is-stored-with-control-characters-intact-and-the-two-list-routes-disagree-about-owner);
and three target-only changes already in the tree were sent back rather than registered, in
[§11.13](#1121-three-target-only-changes-that-are-not-deviations-two-withdrawn-one-corrected). A
register that admitted §11.10 to §11.12 and refused those six is a register applying a rule; one that
admitted everything would be applying a preference.

**Two of the three have since stopped being unmet, and that is the point rather than a reason to drop
them.** Neither was closed by being called a deviation: one was closed by the declared dependency
graph moving, the other by the harness ceasing to create the handle. The rows stay so that the
classification, and how each was actually settled, remain readable.

| Item | What it is | Correct classification | Where it belongs |
|---|---|---|---|
| `[DEP0005]` `new Buffer()` from `compress-commons` 1.2.2, reached through the then-retained `archiver` 2.1.1 | A residual deprecation warning under `--pending-deprecation`, emitted once at module load | **Unresolved shortfall** against the zero-warning target of AAP §0.8 — it was discovered by measurement, not argued and approved in advance, and no decision was ever recorded against it. **No longer arises**: the declared graph moved to `archiver` 7.0.1 with `compress-commons` 6.0.2, and boot under `--pending-deprecation --trace-deprecation` emits no warning line at all | [`baseline-parity.md`](baseline-parity.md) §7.4 and §8, which already state this |
| `FSEventWrap` handles from the test-mode template watcher | An open-handle inventory that would prevent self-exit; unclosable by a caller, so it can only be prevented ([§10.3](#103-the-test-mode-template-watcher-requires-chokidar-which-is-a-declared-dependency-again)) | **Unresolved shortfall** against the clean-teardown expectation whenever it arises — unexpected, unallowed, failing, with a measured reason and a named remedy. It does not arise in the worker gate, which withholds the watch option before the first application require and measures an empty inventory; what remains recorded is the application's own test-mode reliance | §10.3 here, and the worker harness's handle inventory |
| This process's own stdout/stderr `PipeWrap` handles | Not a leak and not an application observation — which of them exist depends only on how the process was invoked | **Invocation plumbing.** Correctly partitioned out of the assertion; it was never a deviation and stays classified as it is | The harness's `stdio` partition |

**There is a third class, and one item is in it.** Neither of the two classes above fits a behaviour
the **framework** removes: hapi 21 emits only cookie CLEARS on a response carrying a 500 error, so the
yar session `Set-Cookie` the baseline sent on a 500 is not sent
([§12](#12-the-register-of-framework-imposed-divergences--one-entry)). Placed honestly, it **is a
departure from R-d's prohibition** — a header a client receives differs — and it is deliberately
**not** downgraded to "an unmet validation target", which would be the comfortable misfiling and
would invert the argument §11.1 and §11.2 rest on just as surely as calling a target a deviation
does. What separates it from those two is the other half of the test: no application decision produces
it, and no application change can prevent it within scope, so there is **nothing to repair**. That is
what makes a permanently failing gate the wrong answer here and not merely an inconvenient one — the
rule above ("while a validation target is unmet, the honest result is a failing gate") applies to
items an application can close, and a gate that can never pass reports bookkeeping rather than a
finding. So it is neither allowed in silence nor left failing: it is **registered**, with its
measurement, its conflict, its precedence argument and its own fail-closed rule, in a register that
holds one entry.

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
[§10.3](#103-the-test-mode-template-watcher-requires-chokidar-which-is-a-declared-dependency-again)
here and in the harness's own clean-close check, and nowhere else; it was found by measurement during
this work rather than anticipated by the plan, which is exactly why it needed a home. The rule that
governs both is unchanged: while a validation target is unmet, the honest result is a **failing gate**
and the item stays named, measured and unapproved — never relabelled a deviation to close it.

**Nothing here is a proposal, and nothing here was repaired to make a gate pass.** The application's
watching path is untouched: `lib/util/nunjucks.js` is unchanged by AAP §0.3.1, and §10.3 records the
reliance rather than removing it — what §10.3 has since changed is the *declaration* that provides
`chokidar`, not the watching behaviour. The `archiver` warning stopped occurring because the declared
dependency graph moved, which is a dependency decision recorded and dispositioned in
[`deferred-dependencies.md`](deferred-dependencies.md) §2.6 — this section neither approves nor
disputes it, because classification is not authorization and treating the two as one is how an
unapproved change acquires a label. **Where that move's client-visible consequence *is* approved is
[§11.7](#117-deviation-3--the-zip-container-bytes-both-archive-download-routes-emit)**, deviation 3:
the graph move changed the ZIP container bytes both archive routes emit, and that half was missing from
the delivery until it was registered there. The distinction this section draws holds unchanged — the
warning was never a deviation, and the container change is one. What this section fixes is the **classification**, which is a
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

**Eight of the nine are not deviations**: a deviation is a prohibition argued away, and nothing in
those eight has been argued away — they are preserved, which is what R-d requires, and the exposure is
the consequence. **Acknowledging an exposure is not settling it**, and no open row below should be read
as settled; each carries the follow-up that would close it, and each remains open until that follow-up
is separately approved and implemented.

**Row 9 is the exception, and it is the mechanism above working rather than an exception to it.** Its
follow-up was separately approved — the same behaviour was raised as a blocking HIGH finding by this
delivery's runtime security verification and assigned for remediation, together with the file
ownership this section recorded as belonging elsewhere — and it has been implemented. It is therefore
no longer an exposure but an **approved deviation**, number 7, owned in full by
[§11.11](#1114-deviation-10-the-email-share-tokens-key-is-no-longer-derivable-and-an-unset-appmailsecret-fails-closed).
Its row is kept, marked closed, with what was actually delivered and one honest correction to its own
prediction, because deleting it would erase the evidence that the row was ever true.

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
| 9 — **CLOSED, now deviation 7 ([§11.11](#1114-deviation-10-the-email-share-tokens-key-is-no-longer-derivable-and-an-unset-appmailsecret-fails-closed))** | **Forgeable email capability token, and the mail send it authorizes** (CWE-798/CWE-347) | `POST /api/trinkets/{trinketId}/email` accepts a `token` in its payload, and `helpers.verifyEmailToken` derives its HS256 key as `config.app.mail.secret + request.pre.trinket.shortCode` `[T lib/util/helpers.js:301]`. **`app.mail.secret` is declared in no tracked configuration file** — `config/default.yaml`'s `app.mail` block carries `from, host, port, user, pass, secure` and no `secret` — so under `NODE_ENV=test` the key is the literal string `"undefined"` concatenated with a short code that appears in the public share URL. Anyone can mint a token that verifies. | **Driven, anonymously, with no cookie**, against a seeded instance of the delivered tree, three requests to `/api/trinkets/000000000000000000000201/email` for short code `pyfixture001`: no token → **400**; a token whose `shortCode` claim is wrong → **403**; a token minted here with the derived key `"undefinedpyfixture001"` and the correct claim → **200**, the capability check passed and the handler proceeded into the mail path. On that instance the send itself was refused by mail configuration (`"Email is not configured"`), which is environmental: QA drove the same forged token on an instance with the mail fixture loaded and recorded one `trinket-share` send. | Nothing controlled it as preservation — it was never a preserved quirk but an unremediated exposure, recorded here so it would outlive the run, and that is exactly what it did. The token mechanism is baseline's; what made it forgeable is a configuration key that was never declared, so no conversion introduced it. **What has changed is not the analysis but the ownership**: the files this row named as "owned elsewhere" were assigned together with the finding, and the exposure is closed rather than controlled. | **CLOSED — this row's own prescription, implemented.** It read: *"Declare `app.mail.secret` with the same shape the session password already uses — a generated ephemeral value outside production and a fail-fast guard inside it, per AAP §0.6.1 — so the key stops being derivable, and re-drive the three cases above expecting **403** on the third."* Delivered: `config/default.yaml:157` declares the key; `lib/util/helpers.js:562` `emailTokenSecret` is the single derivation point for both sides, generating one ephemeral value per process outside production (`:581`) and returning **`null`** in production with the key unset (`:577`), on which `verifyEmailToken` answers `Boom.forbidden()` and the three `jwt.sign` sites mint nothing. **One correction to this row's own prediction, stated rather than glossed:** the third case answers **500**, not the 403 predicted here. `jwt.verify` throws on a bad signature and that throw keeps the funnel it always reached — converting it to a 403 would move an error edge no finding raised, against R-e — so a token minted with the old derivable key is now simply a badly signed token, answered indistinguishably from one signed with any other wrong key (both measured at 500 on the pre-fix tree). Re-driven, anonymously, against the delivered tree: no token → **400**; wrong `shortCode` claim → **403**; the forged key → **500**; a correctly signed token with the secret pinned → **200**; the application's own session-minted token → **200**. The full argument, contract and gate are [§11.11](#1114-deviation-10-the-email-share-tokens-key-is-no-longer-derivable-and-an-unset-appmailsecret-fails-closed). |

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

**One adjacent pre-existing defect, found while measuring this — and since REPAIRED at the funnel it
belongs to. Read the paragraph below as the measurement that motivated the repair, not as the
delivered behaviour:** [§10.11](#1011-requestfailerr-with-an-error-argument-terminated-the-process--repaired-and-why)
now routes an `Error` handed to `request.fail` as a Boom, so this path answers **500** with the process
alive, and a handed-over scenario that reaches the upload with a failing storage fixture no longer
takes the server down. QA finding `obs-requestfail-error-arg-process-kill` measured this exact
instance (an `ENOTDIR` store fault through `lib/util/file.js:190`) and is what closed it. With
`features.assets: true` and an S3 upload that fails, the route **terminated the process**:
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
[§11.0](#110-the-register-and-why-a-tool-cannot-add-to-it)'s register either,
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
| 2 | **Submitted values reach the failure flash and the info log unredacted** | `request.fail` logs `util.inspect(json)` at `[T lib/util/routeParser.js:283]` and flashes `failure`, `payload` and `query` verbatim at `[T lib/util/routeParser.js:288]`, `[T lib/util/routeParser.js:301]` and `[T lib/util/routeParser.js:302]`; the flash is read back into the rendered page and into the JSON body, so a failed credential-bearing submission is both logged and echoed | **static**, the four sites above; and the response-body half is what made the withdrawn redaction a body change on the three routes named in the table | R-d, and AAP §0.6.3, which makes the Layer 2 body shape a preserved contract | Approve a redaction whose scope is the **log line only**, leaving the flash — and therefore the compared body — untouched; a body-visible redaction needs the corpus recaptured. **Delivered at the QA checkpoint that raised `obs-passwords-and-reset-tokens-logged-at-info`, in exactly that scope**: `[T lib/util/routeParser.js:283]` now redacts credential values in *both* of its arguments, `json` itself is untouched so the flash and the compared body are byte-identical, and no corpus recapture is required. The log-half of this row is therefore closed and the body-half stands open as written — see [`error-edge-inventory.md`](error-edge-inventory.md) §12.1 and §12.2 for the delivered scope and the measured evidence |
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

### 11.6 A third unapproved policy, in the admin controller, and now withdrawn

**Why there is a third register.** [§11.4](#114-an-unapproved-security-policy-that-was-added-and-has-now-been-withdrawn)
covers the policy added to the two auth/user controllers and
[§11.5](#115-a-second-unapproved-policy-in-the-route-parser-and-the-logger-and-now-withdrawn) the
policy added to the response and logging funnels. What follows was added to
`lib/controllers/admin.js`, and it is different from both in one respect that matters: **it was the only
policy in the delivery that a route-level A/B could see.** Nine mechanisms were added around one
anonymous route and one admin route, and the first of them changed a **status code** — which is why
this is the one that three separate runtime checkpoints reported, and why the register's own claim to be
closed could not be read as true while it stood. It was never in
[§11.0](#110-the-register-and-why-a-tool-cannot-add-to-it)'s register, and
§11.0's register is the whole list. Every mechanism below is now absent.

#### What was withdrawn

**Measured** (**static**, in this tree). A search over `lib/`, `config/` and `app.js` returns nothing
for `sanitizeOhnoesField`, `sendOhnoesAlert`, `ohnoesMailAllowed`, `MAX_OHNOES_ENTRIES`,
`MAX_OHNOES_FIELD_LENGTH`, `OHNOES_TRUNCATION_MARKER`, `OHNOES_MAIL_MAX_PER_WINDOW`,
`OHNOES_MAIL_WINDOW_MS`, `ohnoesMailWindowStart` or `ohnoesMailWindowCount`, and
`lib/controllers/admin.js` is 430 lines where it was 605.

| # | Withdrawn policy | Mechanism that was added | Why it went |
|---|---|---|---|
| 1 | **Guest authentication requirement on `POST /api/ohnoes`** | `if (!request.auth \|\| !request.auth.isAuthenticated) return errors.unauthorized('Not logged in');`, placed after the payload dereference | Unauthorised, and the one mechanism here that changed a **status code**. The route is declared with **no `config` block** (`config/api_routes.js`, `POST /api/ohnoes admin.ohnoes`), so it inherits `server.auth.default` in `mode: 'try'` from `app.js`, and hapi hands guests to the handler precisely so that it can answer them. Guest error reporting is the route's purpose. Measured, this turned baseline's `200 {"flash":{},"context":null}` into `401 {"statusCode":401,"error":"Unauthorized","message":"Not logged in"}`, and with it lost the private `Cache-Control` and the `Set-Cookie` session — three compared fields on one route |
| 2 | **Alert-body field reduction** | `var keys = "time,path,referrer,userAgent".split(",")` in place of baseline's six labels | Unauthorised. `user` and `sesh` are caller-supplied like the other four, and dropping them changed the rendered mail body for every mailable request |
| 3 | **Server-derived identity line** | `msg += "\nuser\t\t" + (request.user && request.user.username ? … : 'anonymous')`, emitted once per request | Unauthorised, and it put a label in the body that no submitted entry produced, so the body no longer corresponded to the payload |
| 4 | **Entry cap** | `MAX_OHNOES_ENTRIES = 25`, `count = Math.min(log.length, …)`, and a `note` line recording how many entries were submitted | Unauthorised. Baseline renders every entry the caller submitted, and the `note` line is a body field baseline never emits |
| 5 | **Per-field sanitizer** | `sanitizeOhnoesField()` — `String(value)`, C0/DEL/C1 replaced with a space, then truncation to `MAX_OHNOES_FIELD_LENGTH = 512` with an `...[truncated]` marker | Unauthorised, and it defanged the framing characters (`"\n"`, `"\t"`) the body's own layout uses, which is a change to what the mail contains rather than to what the route answers |
| 6 | **Mail shape gate** | `var mailable = Array.isArray(log)` plus a per-entry `!entry \|\| typeof entry !== 'object'` test, suppressing the send when either failed | Unauthorised. Baseline mails a `log` of primitives and a `log` that is a bare string; the gate answered 200 and silently sent nothing |
| 7 | **Mail rate limiter** | `sendOhnoesAlert()`, `ohnoesMailAllowed()`, `OHNOES_MAIL_MAX_PER_WINDOW = 10`, `OHNOES_MAIL_WINDOW_MS = 60000`, two module-level window counters, and a once-per-window `log.warn` | Unauthorised. Measured, twelve rapid mailable requests answered 200 twelve times and produced **ten** mails, so the eleventh and twelfth reports were dropped with no indication to anyone. Nothing about it is visible in a response, which is exactly why it needed a register entry rather than a gate |
| 8 | **Fire-and-forget rejection handler** | `Promise.resolve(mailer.send(…)).catch(function(err){ log.error(…) })` | Unauthorised. Baseline calls `mailer.send(…)` bare and un-awaited, and the exposure that creates is preserved and recorded below rather than closed here |
| 9 | **`grantRole` response projection** | `user && typeof user.serialize === 'function' ? user.serialize() : JSON.parse(JSON.stringify(user))`, projecting the granted user through the model's `publicSpec` | Unauthorised, and **it changed a response body AAP §0.9.3 compares exactly**. Measured, baseline answers `POST /api/admin/user/{userId}/grant` with the whole document — `password` (a live `$2b$10$…` hash), `_id`, `verified`, `source`, `roles[]` — and the projection answered with seven keys and no `password`. Removing credential material from a response is a security improvement, and R-d prohibits improvements without an approved deviation; the exposure it was closing is preserved and recorded in [§9.11](#911-the-admin-controller-publishes-the-whole-user-document-bcrypt-hash-included) |

**What controls, stated once.** Mechanisms 1 to 8 sit on a route AAP §0.9.1 compares by declared auth
per entry and AAP §0.9.3 compares by exact status, body, `Cache-Control` and every `Set-Cookie`
attribute; mechanism 9 sits on a body §0.9.3 compares exactly. AAP §0.2.2 excludes behaviour
improvements "except where 0.7 decides a requirement other than R-d controls and records the deviation
as approved", and §0.7 decides exactly two conflicts — the never-settling file response and the
`marked` fork — neither of which is this. `lib/controllers/admin.js`'s own delivery directive is
narrower still: "R-a. Requires: async conversion + the `csv` call-site verification, **and nothing
else**", with "do NOT tidy the imports", "preserve every response field name exactly", and
"`lib/models/**` → out of scope". A policy whose own source comments argue for it is the shape §11.4
already caught once; the argument is not the approval.

#### The shape that is delivered instead

**Measured** (**static**, code-only diff against `2f8712a` with comments and blank lines stripped).
`admin.ohnoes` is now baseline's body with the **T-1 conversion and nothing else** — three lines differ
and they are the three T-1 requires:

```text
-    request.success();                          +    var response = request.success();
-    if (!log || !log.length) return;            +    if (!log || !log.length) return response;
                                                 +    return response;
```

Everything between them is baseline verbatim: the six labels, `var msg;` left undefined so the first
`+=` coerces it and every body begins with the literal text `undefined`, `for (var i = 0; i <
log.length; i++)` over the whole submitted array, `msg += "\n" + keys[j] + "\t\t" + log[i][keys[j]]`
indexing straight off the entry, the `----------------------------------` separator, and a bare
un-awaited `mailer.send(config.app.adminEmail, 'User Session Alert', {text: msg})`.
`grantRole`'s body line is again `user : JSON.parse(JSON.stringify(user))`.

**The rendered mail body was compared byte-for-byte, not inferred.** An in-process harness stubbed
`mailer.send` in each tree and invoked `admin.ohnoes` with six payload shapes (**probe**). All six
produce an **identical sha256** on the two trees, and the only difference the harness reports anywhere
is the handler's return value — present on the delivered tree, absent on baseline, which is the T-1
conversion itself:

| Payload | Mails | Body length | Body sha256 (first 16) | Both trees |
|---|---|---|---|---|
| one full entry | 1 | 108 | `59eba35ac50ced13` | identical |
| entry missing five fields | 1 | 142 | `612b86bd6f7dff7c` | identical — five labels render `undefined` |
| thirty entries | 1 | 2959 | `f17c9b7ff35923fd` | identical — **all thirty rendered**, no cap, no `note` line |
| `"a\nb\tc"` and a 600-character field | 1 | 706 | `b32d1d419dbfb216` | identical — framing characters pass through, nothing truncated |
| `log: [1,2,3]` | 1 | 429 | `9a486e4cc482f65d` | identical — primitives still mail |
| `log: []` | 0 | — | — | identical — the short circuit answers with the response |

**And the route was re-driven against both live servers** (**probe**, two independently installed trees
on Node 22.23.2, matched configuration, anonymous requests):

| Request | Delivered | Baseline `2f8712a` |
|---|---|---|
| JSON with a `log` array | 200 · `{"flash":{},"context":null}` · full private `Cache-Control` · `Set-Cookie: session` | identical |
| JSON with no `log` | 200 · same body · same headers · cookie | identical |
| form `message=x` | 200 · same body · same headers · cookie | identical |
| JSON `{"log":[{"a":1}]}` (non-conforming entries) | 200 · same body · same headers · cookie | identical |
| JSON with thirty entries | 200 · same body · same headers · cookie | identical |
| **no payload at all** | 500 · Boom's standard payload · `cache-control: no-cache` · no cookie | identical |
| **twelve rapid mailable requests** | 12 × 200 and **12 mail attempts** | 12 × 200 and **12 mail attempts** |

The last row is the limiter's epitaph: it was ten before the withdrawal and it is twelve on both trees
now. The no-payload 500 is the outcome the committed corpus already records for this route
(`route.post.api-ohnoes.json`, 500, 96 bytes) and it is unchanged — the `TypeError` from
`request.payload.log` on a `null` payload is baseline's, and preserving the rest of the handler
preserves it.

#### What preservation leaves exposed — recorded, not repaired

**This is the cost of R-d, on the same terms as §11.4's and §11.5's tables**: each row is reachable in
the delivered code, none is a deviation, and naming an exposure is not settling it. Every row except 5
is baseline behaviour at `2f8712a`; **none was introduced by this migration**, and rows 6 and 7 were
found by the closing re-verification of this checkpoint rather than by the QA pass that prompted it.

**Rows 6 and 7 were the two that most needed a human decision, and both have since had one.** Both are
pre-existing and both are reachable with consequences worse than the information leak row 4 describes.
Neither could be closed inside the unit that first recorded them: row 6's fix spans
`config/api_routes.js`, `app.js` and `config/default.yaml` — two of which belong to other units — and
row 7's true sink is a template that unit did not hold. Recording them was the only action available
to it under R-d.

**Row 6 was subsequently raised as a blocking security finding against this delivery, together with the
duplicated `SameSite` attribute that removed the only mitigation it had, and the two were decided
together as approved deviations 7 and 8** —
[§11.11](#1111-deviation-7-the-session-cookies-samesite-attribute-is-emitted-once-so-secure-mode-no-longer-serves-samesitenone)
and [§11.12](#1112-deviation-8-a-credentialed-cross-origin-state-changing-request-is-rejected) — each
carrying its precedence argument, its field-by-field contract and its gate, which is what §11.0
requires of an entry and what distinguishes both from the policies §11.4 to §11.6 withdrew. The row
below stays open rather than being struck, because that closure is conditional and its limits are
stated in §11.12: a deployment that lists its sibling hosts in `app.security.trustedOrigins` re-opens
it for those hosts, a jar replayed with no origin header is unaffected, and the durable answer is
still the token work the row names.

**Row 7 is now CLOSED**, by direction rather than by preference. The QA pass that followed raised it
independently and twice — as CRITICAL, blocking, security findings
`W001-F06-ADMIN-USERS-STORED-XSS` and `W002-I2-ADMIN-JSON-TAB-XSS` — and assigned the escaping and
projection change to the unit holding `lib/views/admin/includes/users.html`, `lib/util/nunjucks.js`
and `lib/controllers/admin.js` together, which is the "one approved change across the controller and
the template together" this row's follow-up asked for. **The precedence argument is the one AAP §0.7
states and §11.1, §11.7 and §11.9 have each applied: R-d protects behaviour a client may rely on, and
markup a persisted field injects into an administrator's session is not that** — the row's own evidence
is a credentialed request issued by an attacker-planted `onerror`, which is the opposite of a
behaviour anyone depends on. The row below records what changed, what it was measured against, and
what is still open.

**One bookkeeping consequence is owed and is not written here.** §11.0 is the canonical
approved-deviation register, and this closure is a behaviour change argued away from R-d, so it needs
a register row of its own with the field-by-field contract §11.0 demands. That register — and its
count, which `docs/baseline-parity.md` and `docs/deferred-dependencies.md` mirror — is named as owed
rather than asserted here, because the measurement that would fill the contract's cookie and response
fields is the one in row 7 below and belongs there.

| # | Exposure | Reachable how | Evidence | What controls preservation | Named follow-up |
|---|---|---|---|---|---|
| 1 | **An anonymous caller can send unbounded mail to the administrator address, with a body it composes** | `POST /api/ohnoes` takes any body from any caller and mails one alert per request with no cap, no shape check and no size limit; the six labels are indexed straight off each submitted entry, and a value containing `"\n"` or `"\t"` forges extra labelled lines and entry separators inside the body | **probe**: twelve rapid requests produced twelve mail attempts; the 600-character field rendered in full at body length 706; `"a\nb\tc"` rendered raw | R-d, and AAP §0.9.3's exact comparison of this route's response — the response is what a gate can see, and none of these mechanisms is visible in one | Reinstate a bound and a shape check as a separately approved change. It needs no corpus recapture, because it changes no response — which is also why it must be **approved rather than reasoned into place**, as the withdrawal above demonstrates |
| 2 | **A rejected alert send is an unhandled rejection, and Node 22 terminates on one** | `mailer.send` is `async` (`lib/util/mailer.js`, byte-identical to `2f8712a`) and is called bare and un-awaited, and no `unhandledRejection` or `uncaughtException` listener exists in `app.js`, `lib/**` or `config/**`. **Measured executable and fatal**: with `app.mail.host` set to a port where nothing listens, one anonymous `POST /api/ohnoes` carrying a mailable `log` kills the process — the un-awaited `send` rejects with `ESOCKET` / `connect ECONNREFUSED`, `triggerUncaughtException(err, true /* fromPromise */)` fires and Node 22 exits, after which the port stops answering. So **one unauthenticated request takes the whole application down**, and every other in-flight request dies with it. Whether the offending request itself gets its 200 first depends only on how fast the transport fails, so it is not a reliable 200: against a refused localhost connection the failure is immediate and **the client receives nothing at all** (measured `http=000` after 0.075 s, no body), whereas a transport that fails slowly would let the response flush before the exit It does not arise only under the committed default, where `isConfigured()` is false because `app.mail.host` is empty, so `send` short-circuits and resolves; that default is what makes the route survivable in this checkout and is not a property of the code. An earlier revision of this row described the configured case with "would", which understated a measured outcome | **static**, the three facts above; **probe**, the process exit under a refused SMTP connection, and the "Email not configured, skipping send" line the twelve-request count was read from | R-d: the `.catch` that closed this was itself the withdrawn mechanism 8, and baseline is byte-identical here — same `async` mailer, same bare call — so a configured baseline dies the same way and the fix is an improvement, not a repair | Register a process-level `unhandledRejection` policy, or await-and-swallow at this one call site, as a separately approved change — and note that awaiting would also change the response's timing, which §0.9.3 does not compare but a load test would. Until then, treat a configured `app.mail.host` on a deployment serving this route anonymously as a denial-of-service exposure |
| 3 | **Whatever a caller puts in `user` and `sesh` is mailed to an administrator verbatim** | The only producer of this payload fills `sesh` from the raw `session` cookie value and `user` from the DOM (`public/js/debug.js`), so a genuine report mails a live session credential and an unverifiable identity claim — and any caller can put anything in either field | **probe**: the six-label body above renders both fields exactly as submitted | R-d, and the byte-identical mail body this section evidences | Drop the two labels, or replace them with a server-derived identity, as a separately approved change — this is precisely withdrawn mechanisms 2 and 3, and it is recorded here so that re-proposing them is a decision rather than a rediscovery |
| 4 | **`grantRole`'s response publishes credential material; the admin user page no longer does** | Both sites serialized the whole `User` document, `password` included. `userSearch`, which feeds the page, now strips it — see row 7. `grantRole`'s response body is unchanged and still carries it | [§9.11](#911-the-admin-controller-publishes-the-whole-user-document-bcrypt-hash-included), which carries the measurement and the follow-up, and row 7's after-measurement for the page | R-d, and AAP §0.9.3's exact body comparison — which is what still holds `grantRole`, because that response IS compared by a committed scenario while the page's `?q=` rendering is not | §9.11's named follow-up, now scoped to `grantRole` alone |
| 5 | **The route's only in-tree caller is commented out** | `public/js/debug.js:31` holds the single `$.post('/api/ohnoes', …)` and it is commented out, so nothing in the application posts here | **static** | R-a — an unreferenced route is not a route to remove, and AAP §0.2.2 makes the route surface an invariant | None. Recorded so that "nothing calls it" is not mistaken for "nothing can call it": the route is registered and answers, which is exactly why the exposures above are reachable |
| 6 | **A cross-origin HTML form can grant itself the site-admin role** — **now answered 403 by approved deviation 8** ([§11.12](#1112-deviation-8-a-credentialed-cross-origin-state-changing-request-is-rejected)), which rejects a state-changing request that carries the session cookie and reports an origin that is not this application's, `Sec-Fetch-Site: same-site` included. The row stays because the closure is conditional and its limits are stated there: a deployment that lists its sibling hosts in `app.security.trustedOrigins` re-opens it for those hosts, a jar replayed with no origin header is unaffected, and the durable answer is still the token work named below | Every session-authenticated admin write is declared with `auth: 'session'` and an `isAdmin(user)` pre-handler and **nothing else**: no CSRF token is issued or checked anywhere in the tree, and no `Origin`, `Referer` or Fetch-Metadata check exists. The session cookie is `SameSite=Lax`, which does not restrain a **same-site** sibling origin, and committed configuration sets a parent-domain cookie (`config/default.yaml:38-46`), so any host under it is same-site. A plain auto-submitting form on such an origin, carrying only `role=admin`, is accepted while an administrator is signed in | **probe**, closing re-verification: a form served from an independent origin POSTed to `/api/admin/user/{id}/grant` with `Sec-Fetch-Site: same-site` and no token; the response was 200 `success:true` and a fresh read showed the target's roles as `user, admin`. CORS does not apply — a top-level form POST is not a preflighted request | R-d, and scope: any check rejects requests baseline accepts, and the declaration, the cookie and the extension points sit in `config/api_routes.js`, `config/default.yaml` and `app.js`, of which the latter two belong to other units | Add server-validated CSRF tokens to every session-authenticated state-changing route, reject untrusted `Origin`/`Referer`, and reconsider both the parent-domain session cookie and the hosting of untrusted sibling origins — as one approved security change with its own AAP amendment. **This is the highest-severity item in this document and it is not this unit's to close** |
| 7 | **CLOSED — a persisted user field became executable markup in an administrator's session** | Row 4's wholesale projection was rendered by `lib/views/admin/includes/users.html` through Nunjucks' `\| safe`, so the pretty-printed JSON was emitted **unescaped** inside a `<pre>` and a persisted value containing `</pre>` closed the element, leaving whatever followed to be parsed as markup. `rolesData` was a second `\| safe` sink on the same page, in script-data context, where a persisted `</script>` did the same. **The planting precondition recorded here was wrong and is corrected: it is any anonymous signup, not "an admin write — or row 6's cross-origin equivalent".** Signup's `fullname` is `Joi.string().max(50)` with no character constraint, and the `ensureName` pre-save hook copies it to `name`, so one unauthenticated `POST /users` plants the payload twice over. A role name reaches the same sinks through `admin.updateUser`, which writes `request.payload.roles` with no validation of the strings inside it — that is the second vector, not the only one. No CSP is served, and that is still true | **probe**, twice. **Before**: an anonymous signup carrying `fullname=</pre><img src=x onerror=alert(9)><pre>` returned 302 to `/welcome`, and the admin's `GET /admin/users?q=<username>` then answered 200 carrying the raw payload at both the `fullname` and `name` keys, 5 `<pre>` elements against a template of 3, and the victim's `$2b$10$…` hash; a planted role name `</script><img src=x onerror=alert(8)>…` was emitted raw inside `#rolesData`. Two native `alert`s fired during parsing at `readyState=loading` **while `#json` was still `display:none`**, from `HTMLImageElement.onerror`, and the injected image's own request carried the admin's session cookie. **After**: the identical sequence, re-driven with both payloads planted, answers 200 with a document-start tripwire count of **0**, `img[src="x"]` **0**, `<pre>` back to **3**, zero injected `img`/`script` inside `#json`, the payload present as literal **text**, `#rolesData` still `JSON.parse`-able with the role string byte-exact, and `$2b$10$` absent from both `innerHTML` and `textContent` — zero console messages, no request to `/x` | **No longer preserved.** R-d was argued away by AAP §0.7's own mechanism on the precedence stated above the table, on QA findings `W001-F06-ADMIN-USERS-STORED-XSS` and `W002-I2-ADMIN-JSON-TAB-XSS`. The change is measured **invisible to AAP §0.9.3's exact comparison**: all 11 admin scenarios in `test/parity/corpus.json` drive `/admin/users` with no `?q=`, so `admin.index` leaves `data` undefined and neither sink renders in any of the 392 scenarios | **Done**: `lib/views/admin/includes/users.html:104` drops `\| safe` so Nunjucks autoescaping renders the JSON dump as inert text — the entity-decoded pane is byte-identical to baseline's, measured, so an administrator sees the same JSON; `:145` moves to a new `jsonSafe` filter in `lib/util/nunjucks.js` that escapes `<`, `>`, `&`, U+2028 and U+2029 as `\uXXXX` JSON escapes and marks its own output safe, which keeps `lib/views/admin/index.html:66`'s `JSON.parse($('#rolesData').text())` and the Change Roles round-trip byte-exact; and `lib/controllers/admin.js`'s `userSearch` strips `password` and any provider token from the projection, which closes row 4 for this page. **Still open, and not this change**: role-name validation in `admin.updateUser` (it would reject writes baseline accepts), a restrictive CSP as defence in depth, `grantRole`'s response body (§9.11), and the §11.0 register row named above |

#### Why this withdrawal needs no new scenario, and what it does need

**Nothing here asks the corpus work for a new case.** `route.post.api-ohnoes.json` drives the route
anonymously with **no payload** and records 500 at 96 bytes; that is measured unchanged on both trees,
so the committed scenario is correct as it stands and replays clean. The payload-bearing 200 the
withdrawal restores is not in the corpus, and it does not need to be for this section to hold — it is
evidenced by the seven-row A/B table above, driven three times per shape. `docs/error-edge-inventory.md`
observed the gap from its own side while the policy stood, recording of the withdrawn 401 that there
was "**none in the corpus** — a new non-success scenario is required on this route"; **the withdrawal
closes that requirement by removing the branch that created it** rather than by adding a scenario for
it.

**What it does need is two rows deleted.** `docs/error-edge-inventory.md` carried
`id=admin.ohnoes.response.1` for the 401 and `id=admin.sendOhnoesAlert.handler.1` for mechanism 8's
`.catch`, both **unchecked and both classified as new in the target with no baseline counterpart** —
which is the inventory correctly declining to call them preserved. Both branches are gone, so both rows
are gone with them; nothing else in that document's admin section changes its meaning, and its remaining
`lib/controllers/admin.js` locators sit 44 to 45 lines lower than they read, because the withdrawal
removed 175 lines from the file. `docs/conversion-inventory.md`'s row for the `sendOhnoesAlert` chain
goes the same way, and its `ohnoes` row is unaffected — that row records the handler as already
returning its response, which is still true, and is in fact the one thing this withdrawal did **not**
touch.

---


---

### 11.7 Deviation 3 — the ZIP container bytes both archive download routes emit

**The conflict.** The bytes of a downloaded archive are observable behaviour, so R-d requires them
preserved. Two of this migration's dependency moves change the *container* fields those bytes carry —
one of the two is mandated by AAP §0.5.1.2 by name, and the other is what makes the mandated one
readable at all. Both cannot hold, so this section records the decision, its precedence argument, and
the gate that now holds the delivered container in place.

**Two routes, two writers, and QA's attribution corrected.** The finding that raised this recorded the
whole field-level list against `archiver` 2.1.1 → 7.0.1. Measured in source, that is half right: the
two archive routes do not share a writer.

| Route | Writer | Dependency change | Authorization |
|---|---|---|---|
| `GET /{userSlug}/courses/{courseSlug}/download.zip` | `adm-zip` — `[T lib/controllers/courses.js:16]` `zip = require('adm-zip')`, written at `[T lib/controllers/courses.js:426-432]` (`new zip()` · `addLocalFolder` · `writeZip`) | **`adm-zip` 0.4.16 → 0.6.0** | AAP §0.5.1.2 mandates it (high advisory, range `< 0.6.0`), and that row itself states archive-read behaviour is a changed surface |
| `GET /{lang}/{shortCode}` in its `.zip` form | `archiver` — `[T lib/controllers/trinket.js:24]`, invoked at `[T lib/controllers/trinket.js:2044-2045]` as `archiver('zip', {zlib:{level:9}})` | **`archiver` 2.1.1 → 7.0.1** | [`dependency-inventory.md`](dependency-inventory.md) §3 row 17 with its §9.5, and [`deferred-dependencies.md`](deferred-dependencies.md) §2.6 |

**Measured** (driven, on the delivered tree, by `test/parity/replay.js`'s archive reader over the live
responses of all four archive scenarios, in **both** the non-secure and the secure cookie pass, the two
passes agreeing field for field). The `baseline` column is the QA field-level measurement of the tree at
the base commit and is **recorded, not compared**; `null` marks a field that measurement did not state.

*Course archive — writer `course-download-adm-zip`, 200 `application/zip`, **538 bytes on both trees**,
4 entries, canonical fingerprint `4f1c73376d54a1ebb7d0f6d63f4d2cf15a7f0ee5e0ff6314b6196fb4cf55a713`:*

| Container field | Baseline `[B]` | Delivered `[T]` |
|---|---|---|
| general-purpose flags — UTF-8 name, bit 11 | `no-entry` (0x0000) | **`every-entry`** (0x0800) |
| local `versionNeeded`, deflated entries | 10 | **20** |
| central `versionMadeBy` | `0x000a` (MS-DOS v1.0) | **`0x0314`** (UNIX v2.0) |
| directory external attributes | `0x41ed0010` (0o40755) | **`0x45ed0010`** (0o42755 — setgid now set) |
| file external attributes | `0x01a40000` (0o644) | **`0x81a40000`** (`S_IFREG`\|0o644) |
| declared crc32 and uncompressed size | every entry with content | every entry with content — unchanged |

*Short-code archive — writer `short-code-download-archiver`, 200, **182 bytes on both trees**, one entry
`main.txt`, canonical fingerprint `076ae4d6f0ffb51ce3c09ba731986b1fbb28fbf36bd81dabe837edf5e56f5377`:*

| Container field | Baseline `[B]` | Delivered `[T]` |
|---|---|---|
| declared crc32 | `0x00000000` | **`0xf10614e3`** — the entry's real value |
| declared uncompressed size | 0 | **61** — the entry's real length |
| declared crc32 matches the content | `no-entry-with-content` | **`every-entry-with-content`** |
| every other profile field — UTF-8 flag, data-descriptor flag, `versionMadeBy` `0x032d`, `versionNeeded` 20, file attributes `0x81a40020`, internal attributes `0x0000` | — | **identical on both trees** |

**What did not change, stated because a container diff invites the assumption that everything did.**
Status, `content-type`, `content-disposition`, byte length, entry names, entry order, entry count,
compression method and every entry's content are identical on both trees, which the QA measurement
states as well. On the course route the CRCs and sizes were already correct at baseline. The change is
confined to the container metadata tabulated above.

**The decision, and the precedence argument for each half.**

- *Course route — R-d yields to an explicit AAP instruction, which is the highest precedence class there
  is.* The container change is not one this migration chose; it is the consequence of the `adm-zip` 0.6.0
  bump AAP §0.5.1.2 mandates by name for a high advisory, and that row's own words are that
  "archive-read behaviour is a **changed surface**, so the storage contract and archive-layout cases
  cover it rather than a call-site diff". Preserving the container would mean refusing a bump the AAP
  requires. R-a's dependency-swap category authorizes the move, and §11.0's rule is satisfied because
  the deviation is argued here rather than declared by the tool that measures it.
- *Short-code route — R-b controls, for the same reason it controls in [§11.1](#111-deviation-1-the-never-settling-file-response).*
  Baseline's `archiver` 2.1.1 declared `crc32 = 0` and uncompressed size `0` for a deflated entry, so the
  archives it served were **structurally invalid**: the `adm-zip` 0.6.0 this migration installs throws
  `ADM-ZIP: CRC32 checksum failed` on such an entry where 0.4.16 silently returned an empty buffer, and
  2.1.1 additionally emitted `[DEP0005] new Buffer()` at module scope through `zip-stream` 1.2.0 →
  `compress-commons` 1.2.2 on every boot, breaching the zero-deprecation-warning bar of AAP §0.8. An
  archive the application's own reader rejects is not behaviour a client can depend on, which is exactly
  §11.1's reasoning; and declaring the real checksum where the writer previously declared none is the
  arithmetic the ZIP format defines rather than an improvement chosen for its own sake.
- *Why this is a deviation and not one of [§11.3](#113-what-is-not-a-deviation-and-why-the-register-is-closed)'s
  unmet targets.* §11.3's rule is that an approved deviation is a **prohibition** (R-d) argued away by a
  stronger requirement, while its own rows are validation targets nobody had argued. This entry is the
  first shape: R-d yielding to an explicit AAP instruction and to R-b. §11.3's `compress-commons` row
  records that the DEP0005 warning stopped arising *because the declared graph moved*, and says that
  section "neither approves nor disputes" the move — this section is where that move's client-visible
  consequence is approved, which is the half that was missing from the delivery.

**Replay-visible? No — and the reason is a measurement, not a convenience.** A ZIP embeds each entry's
DOS modification time, so the **raw** digest of an archive response is a clock read and no recording can
carry a comparable one. Proved twice: the committed `test/parity/corpus.json` records the *same* request
(`GET /testing/courses/test-course/download.zip?format=md`, identity `user`) twice at the same 538-byte
length with two different digests (`15d30b76931402f6…` and `006afd7264311bc0…`), and one tree's two
cookie passes produce two more (`890fc0d578465b21…`, `a81f975ee3c6e0b5…`). So this change could never
have surfaced as a digest difference, and a scenario-level approved-change marker would be meaningless
for it. Like [§11.2](#112-deviation-2--the-marked-fork-is-retained-leaving-one-named-high-advisory),
deviation 3 therefore carries **no scenario id**, and §11.0's allowlist stays at exactly one.

**Gate — what replaced the digest, so this change is registered rather than normalized away.**
`test/parity/replay.js` now **opens** every archive response in the same step that compares it, and both
halves fail the run:

1. **The writer profile against a frozen expectation.** `ARCHIVE_CONTAINER_REGISTER` pins, per writer,
   the eleven container fields tabulated above — content-independent, so it does not move with seeded
   content — with the baseline column recorded beside it as this deviation's machine-readable form. A
   container whose profile no longer matches is a `body.archive.writerProfile.<field>` **difference** and
   a non-zero exit; an archive served on a route the register does not name is a difference too.
2. **An entry-table fingerprint, compared exactly — against the recording where there is one, and
   otherwise against a pin frozen in the register.** sha256 over the
   canonical JSON of the whole entry table — keys sorted at every depth, entries left in order —
   which measures **28 fields per entry**: name and its encoding, directory flag, method (central and
   local), flags (central and local), the UTF-8-name and data-descriptor bits, `versionNeeded` (central
   and local), `versionMadeBy`, internal and external attributes, the unix mode, declared crc32 (central
   and local), compressed size, declared uncompressed size (central and local), the computed crc32 and
   the two "declared matches content" verdicts, and the content itself as the sha256 of the entry's
   **inflated** bytes. **No mtime, date or time field appears in it** — verified by enumerating the
   fields, which is the point, since the mtime is the whole reason the raw digest is a clock read. Note
   the honest limit: `compressedSize` *is* in the table, so the value is stable across the clock but is
   **not** claimed to be independent of the compression library; the entry *content* is compared as
   inflated bytes and therefore is. Measured deterministic, in one run of this tree: the three course-archive scenarios
   all fingerprint `4f1c73376d54a1eb…` while the corpus records **two different** raw digests for them
   (`15d30b76931402f6…` for two of the three, `006afd7264311bc0…` for the third) and the run observes a
   **third** value again (`da002b652c0ef63e…`) — the fingerprint holding still across exactly the
   variation the digest cannot survive.

   **The pin, and why it exists rather than a note saying the corpus will catch this later.** The
   committed corpus records a binary body as a length and a digest and predates this field, so no
   archive scenario carries a recorded fingerprint — measured, 4 of 4 in each pass. An earlier revision
   of this gate therefore reported the fingerprint as an *observation* and only ever compared the writer
   profile. That was not enough, and QA proved it: because the profile is content-**independent** by
   design — which is what lets one frozen expectation cover a 4-entry course archive and a 1-entry
   short-code archive — two valid containers on the same registered route, equal in byte length, entry
   name and entry size and identical in all eleven profile fields but differing in inflated content and
   crc32, produced **zero** differences. A comparator that cannot fail in a category is not comparing
   it. So each writer in the register now carries a frozen `pinned` block — the entry-table
   fingerprint, the entry count and the byte length — and the comparison is exact either way: the
   recording decides where it carries a counterpart, and the pin decides where it does not. AAP §0.9.3
   licenses exactly this, because seeding is deterministic and comparison here is exact. The pinned
   values, measured on this tree and agreeing across both cookie passes:

   | Writer | Pinned fingerprint | Entries | Bytes |
   |---|---|---:|---:|
   | `course-download-adm-zip` | `4f1c73376d54a1eb…a713` | 4 | 538 |
   | `short-code-download-archiver` | `076ae4d6f0ffb51c…5377` | 1 | 182 |

   Each archive scenario now records `fingerprintComparison: equal-to-register-pin` with
   `fingerprintComparedAgainst: register-pin`, and **`recordingFingerprintState:
   recording-predates-the-field` beside it** — so the artifact never reads as a corpus comparison it did
   not make, and the re-capture that would supersede the pin stays visible rather than papered over.

Driven evidence in this tree, from a run of both cookie passes over the four archive scenarios: the
named check **`archive containers` — `ok: true`, `asserted: 4`, `failures: []`** in the non-secure pass
**and** again in the secure pass, each pass reporting `{match: 4}`, and **0 field-for-field differences
between the two passes** across all four scenarios (the eleven-field profile, the full per-entry table
and the eight scalars — writer, container, byte length, state, entry count, fingerprint and its
comparison state). All eight profile comparisons report `mismatches: []`; the short-code container
additionally reports **one `undetermined` field**, `directoryExternalAttributes`, because a one-entry
archive holds no directory entry to determine it — reported with its reason rather than counted as a
pass, which is the same discipline the fingerprint state follows. `assertArchiveReader()` — **11 probes,
allOk**, among them `every-registered-writer-declares-a-complete-content-pin` and
`a-container-differing-only-in-content-is-rejected-by-the-pin`, which are what hold the paragraph above,
and `fingerprint-ignores-the-clock`, which pins the clock argument by fingerprinting two
containers that differ only in their DOS mtime identically (`531630bd8751bb0f…` both) while their raw
digests differ (`b19e05183e862247…` vs `003212a0a2814fdf…`).

**A comparator that cannot fail in a category is not comparing it, so this one was made to fail on
purpose.** Nine adverse behaviours, all driven here. One is the content-drift discriminator that
motivated the pin, built in process against a registered route: two valid containers, **equal in byte
length, entry name and entry size and identical in all eleven profile fields**, differing only in
inflated content and crc32. Before the pin the drifted container produced **0** differences; with the
pin the comparison reports `fingerprintComparison: differs-from-register-pin`,
`fingerprintComparedAgainst: register-pin` and a real **`body.archive.fingerprint`** difference whose
note names the contents, distinguishes them from the clock, and gives both remedies — re-measure and
re-approve the pin if the change is intended, or fix the seed if the fixtures moved. That the earlier
revision could not fail this is not inferred: at the previous commit the file contains no `pinned`
block, no `ARCHIVE_PIN_FIELDS` and no `compareArchivePin`, and its only fingerprint-difference branch is
gated on `fingerprintComparison === 'differs'`, which requires a recorded fingerprint that 4 of 4
scenarios in each pass do not have.

Two more by perturbing the frozen register itself, each reverted afterwards and the file proved
byte-identical to its pre-perturbation state by sha256:

| Perturbation | Observed |
|---|---|
| short-code writer `pinned.fingerprint` `…5377` → a wrong digest | driven, and **exit 1** on `body.archive.fingerprint` with the observed value against the perturbed pin, `archive containers ok: false` |
| course writer `directoryExternalAttributes` `0x45ed0010` → `0x45ed0011` | the run **refuses before driving a single request — exit 2** — on the startup probe `the-registered-target-profile-is-satisfiable`, reporting `mismatches=[{field: directoryExternalAttributes, expected: 0x45ed0011, observed: 0x45ed0010}]`. An expectation no passing container can meet is reported as an unusable expectation rather than as a route defect |
| short-code writer `fileExternalAttributes` `0x81a40020` → `0x81a40021` | driven, and **exit 1**: `quirk.reply-chain.header-resolved.short-code-zip -> 1 DIFFERENCE(S): body.archive.writerProfile.fileExternalAttributes`, the named check turning to `FAIL archive containers (0 asserted)` with `does not match the writer profile registered for short-code-download-archiver` |

And six more asserted by the startup probes in the unperturbed run above, each reported with its
measurement rather than as a bare pass. Two are the pin's own:
`every-registered-writer-declares-a-complete-content-pin`, which refuses the run when a registered
writer lacks a fingerprint, entry count or byte length — so the gate cannot go vacuous again by
omission — and `a-container-differing-only-in-content-is-rejected-by-the-pin`. The other four:
`the-baseline-profile-is-rejected-on-exactly-the-registered-fields`
— a **baseline**-shaped container is rejected on exactly six fields (`centralVersionMadeBy`,
`directoryExternalAttributes`, `fileExternalAttributes`, `localVersionNeededByMethod.deflated`,
`utf8NameFlag`, `versionNeededByMethod.deflated`), which is this deviation's own field list and the
direct proof that the delivered container would not pass as the baseline one;
`readable-but-empty-container-is-a-difference` (`state=no-entries`, 1 difference — an empty container
cannot pass by having nothing to compare); `an-archive-on-an-unregistered-route-is-a-difference`; and
`malformed-container-is-unparsed-not-empty`. One further control belongs to the implementing run rather
than to this one and is attributed to it: a synthetic recorded fingerprint fails all four scenarios on
`body.archive.fingerprint` (exit 1).

The volatile set is **not** widened by any of it: still six
categories and the same six exempt media types, and what the timestamps category now exempts is the
**raw digest only**. `test/parity/storage.js` (35 of 35, `archive-layout` among them) and
`test/parity/worker.js` (VERDICT PASS, 109 of 109) continue to assert the entry-level contract by
opening the archives they build.

**The cost, and why it is accepted.** The figures here are **not** measured by this repository's gates —
they are the QA performance measurement of this move, recorded as it reported them and attributed to it,
because no gate in this tree measures throughput and this document does not invent one. As measured
there, the `archiver` move carries two reproducing single-entry slowdowns
on the delivered tree — a one-entry 8-byte archive **+5.7…9.6 %** and a one-entry 1 MB archive
**+7.7…8.5 %**, against same-window environmental envelopes of ±3.2 % and ±1.2 % with a stable control.
The absolute magnitude is **+0.11 ms** and **+0.97 ms**, and it is more than offset by **−18.6…−24.6 %**
on multi-entry archives (10, 50 and 200 entries all reproduce as improvements): 7.0.1 has a higher fixed
per-entry deflate cost and much lower per-entry overhead than 2.1.1. It is accepted rather than tuned —
the move is justified on the integrity and warning axes above, and R-a authorizes no performance work.

**What a re-capture would change, so the next one is not a surprise — and why the gate no longer waits
for it.** The pin above means content drift is caught **now**, and a coverage assertion enforces that:
a scenario on a registered archive route that ends with its fingerprint compared against *neither* a
recording nor a pin is a **gating failure of the run**, not an observation. Measured on the delivered
tree, both passes: `pin 4, recording 0, notInRecording 4, uncompared 0`.

When `test/parity/capture.js` does record `body.archive`, the recording becomes the authority and the
pin defers to it — the precedence is deliberate and probe-covered, so a re-capture supersedes the pin
rather than colliding with it. A recording taken from the **baseline** tree would then report a real
`body.archive.fingerprint` difference, not because of the clock but because the 28 fields the
fingerprint measures include `versionMadeBy`, `externalAttributes`, `flags`, `versionNeeded`,
`crc32Declared` and `uncompressedSizeDeclared`, and this deviation changed every one of them. Verified
two ways rather than asserted: by enumerating the fingerprint's own field list against the tables above,
and by the startup probe `the-baseline-profile-is-rejected-on-exactly-the-registered-fields`, which
rejects a baseline-shaped container on exactly six named fields.
That is this deviation becoming visible rather than a new defect, and those two scenarios would then
need the register marker
[§11.0](#110-the-register-and-why-a-tool-cannot-add-to-it) point 2 requires.
Owner: `test/parity/capture.js` and `test/parity/corpus.json`.

### 11.8 Deviation 4 — the course archive is built in a per-request directory, so a concurrent download is no longer served another request's course

**The baseline behaviour, and why it is not a behaviour a client can depend on.** `courses.download`
assembled its export in `'/tmp/' + owner.username` with `'/' + course.slug` inside it
— `[B lib/controllers/courses.js:147-148]`, unchanged in the delivered tree until this checkpoint —
and answered by deleting **the whole of the owner half**: `rimraf(ownerDir, …)`
`[B lib/controllers/courses.js:268]`, `fs.promises.rm(ownerDir, …)` in the converted form. Every
segment of that path comes from the request, so two requests for the same owner and course — two
concurrent requests to one instance, or two instances sharing a host — assembled their exports in the
**same directory** and each deleted the other's tree. Separately, `fs.createReadStream`
`[B lib/controllers/courses.js:267]` opens **asynchronously**, so the deletion on the next line raced
the open; when the deletion won, the stream emitted `'error'` with `ENOENT`, nothing was listening, and
an unhandled `'error'` event **terminates the process**, taking every in-flight request with it.

**Measured, on this tree, by driving it.** Two instances of the delivered application on one host
(ports 20092/20093), each on its own MongoDB database seeded with the **same** username and course slug
but differently-named lesson trees (`alpha-*` and `beta-*`), sharing one `TMPDIR`, hit with 24 **paired
concurrent** `GET /{userSlug}/courses/{courseSlug}/download.zip?format=md`. The two handlers were run
under identical conditions, one after the other, and the only variable was the handler:

| | Baseline-shaped handler (the committed pre-fix body) | Delivered handler |
|---|---|---|
| Status distribution over 48 requests | `200` ×12, no response ×35, stream error ×1 | `200` ×48 |
| Successful responses carrying the **other** database's lesson tree | **12 of 12** | **0 of 48** |
| Distinct entry sets observed | 3, every one of them mixing `alpha-` and `beta-` entries | 2, each exactly its own instance's | 
| Instances alive at the end | **one dead** | both alive |
| Unhandled `'error'` events in the instances' stderr | **1** — `Error: ENOENT … open '/tmp/qa_c9_owner/test-course.zip'`, `Emitted 'error' event on ReadStream instance` | **0** |
| Work directories left on the host | 0 | 0 |

The two failures are independent, and a second experiment separates them. With an external loop
unlinking the archive the instant it appears — the exact window the open used to race — the
baseline-shaped handler dies on the **first** occurrence with the unhandled `ENOENT` above, while the
delivered handler **logged 21 stream failures and survived every one of them** (`0` unhandled events).

**The conflict, and which requirement controls.** R-d requires that baseline behaviour be preserved,
including where it is a defect. R-b requires that the application genuinely run with no route excluded.
Both cannot hold: an archive assembled from another database and a process death are what baseline
produces on this path. **R-b controls, and this is registered as a deviation rather than as
preservation** — the same precedence this register already applies to
[§11.1](#111-deviation-1-the-never-settling-file-response), for the same three reasons and one more.
An archive built from another instance's database is not a behaviour a client can depend on; it is the
wrong file, and R-d's protection is for clients that may rely on observable behaviour. The intended
behaviour is not inferred: the handler's own comment states that the open descriptor is what keeps the
unlinked archive readable while it streams, so the delivered code implements the intent the baseline
code documented and failed to carry out. R-b is unqualified about the application running, and a
process death is not one route failing but every in-flight request failing. And unlike
[§11.2](#112-deviation-2--the-marked-fork-is-retained-leaving-one-named-high-advisory), this pits a
prohibition against a prohibition rather than against a validation target, so the tie-break is the
dependency one: preserving this defect costs correctness of a served file and the availability of the
whole process, while deviating from it costs nothing a client can observe on the ordinary path.

**What did *not* change, which is most of what this route does.** The archive's **bytes** are
identical, and that is pinned rather than asserted: the container register in `test/parity/replay.js`
pins this writer at fingerprint `4f1c73376d54a1eb…`, **4 entries, 538 bytes**, and all three course
scenarios report `equal-to-register-pin` with **0 differences in both cookie passes**, entry table
unchanged down to `attrs 0x45ed0010 (0o42755)` on the two directory entries and `0x81a40000` on the two
files. The response is unchanged field for field — `application/zip`, `bytes(stats.size)`,
`Content-Disposition: attachment; filename=<slug>.zip`. Both preserved quirks in this handler are
untouched and were re-observed firing: the **`statFailed`** edge still ignores the stat error, still
raises `TypeError: Cannot read properties of undefined (reading 'size')` from a **detached tick**
(observed at `[T lib/controllers/courses.js:524]`, stack `process.processTicksAndRejections`) and still
returns a promise that never settles, and a failed deletion is still swallowed.

**One consequence worth naming, because it moves the source of a registered value.** Deviation 3's
`directoryExternalAttributes: 0x45ed0010` is a setgid directory mode, and a directory acquires setgid
only by inheriting it from its parent. Under the host-global root that bit came from `/tmp` itself
being `drwxrwsrwx` (mode `2777`, measured on this host); a per-request root under `os.tmpdir()` follows
`TMPDIR`, which both `test/parity/server.js` and a container point at a directory without it. The
delivered code therefore sets the bit on its own work root, which is why the pinned fingerprint still
holds under a non-setgid `TMPDIR` — verified, since the passing run above was served by an instance
whose `TMPDIR` was mode `755`. The registered value did not change; **what changed is that it is now a
property of this code rather than of the host's temp directory**, which is the stronger position for a
pinned byte sequence to be in.

**Replay-visible? No — and, as with deviations 2 and 3, that is a measurement rather than a
convenience.** The difference this deviation makes appears only when two requests for the same owner
and course overlap, and every committed scenario is driven serially against one instance. So there is
nothing for a scenario marker to attach to: on the ordinary path the delivered response is **identical**
to baseline's, which is exactly what the register pin above asserts. **Deviation 4 therefore carries no
scenario id, and §11.0's allowlist stays at exactly one.** The honest limit is stated rather than
implied: no committed gate drives two instances, so the evidence for this deviation is the driven
reproduction recorded above and the register pin that holds the bytes it must not change. A harness that
drives a second instance would belong with `test/parity/server.js`, which this document does not own.


---

### 11.9 Deviation 5: the bounded `zipCode` read, and the process death it no longer causes

**This is the register entry [§10.7](#107-the-zipcode-branch-that-took-the-process-down-and-the-bounds-that-now-hold-it)
was missing.** §10.7 carries the measurement, the two bounds, the nineteen unit cases and the
field-by-field cost table, and it opened by describing itself as the one entry whose outcome is
deliberately not preserved *without being one of the numbered deviations* — an accurate statement of a
gap, not of a decision. The decision was made and argued there; what was absent was its registration,
so a reader counting the register found two entries and a third change hiding inside a preservation
catalogue. This section is that registration. §10.7 remains the owner of the mechanism and the
evidence; **this section owns the approval**.

**The sites.** `trinket.draft` `[T lib/controllers/trinket.js:1209]` and `trinket.autosave`
`[T lib/controllers/trinket.js:1307]`, baseline `[B lib/controllers/trinket.js:986]` and
`[B lib/controllers/trinket.js:1054]`. Both are authenticated (`auth: 'session'`), both accept a
base64 ZIP in `request.payload.zipCode`, and both declare a 10 MB `payload.maxBytes`
`[B config/api_routes.js:977-979,1004-1006]` that bounds the **compressed** input only.

**The conflict.** **R-d requires that the outcome be preserved. R-b requires that the application
genuinely run.** Baseline's outcome on this branch includes the termination of the server process: a
malformed `zipCode` from any logged-in user answered the request and then killed the process, because
the detached chain's `JSON.parse` threw with no downstream rejection handler and Node 22 defaults to
`--unhandled-rejections=throw` (measured, §10.7). An unbounded expansion reaches the same end by
exhausting the heap. Both cannot hold.

**Decision: the read is bounded and the chain is terminated. R-b controls.** Two reasons, and the
first is why this is a *stronger* case than [§11.1](#111-deviation-1-the-never-settling-file-response)
rather than a weaker one:

1. **What the crash destroys is not this branch's behaviour.** The client has *already* been answered
   when the process dies — 200 from `draft`, 500 from `autosave` — so the response R-d protects is
   emitted either way. What the death takes is every *other* request in flight and every request that
   would have followed. R-d's protection is for a client that may rely on observable behaviour; no
   client can rely on the server ceasing to exist after it has been served, and no other route consents
   to it. §11.1 decided the comparable conflict on the ground that the absence of a response is not
   behaviour a client can depend on; this is that argument applied to the absence of a *server*.
2. **R-b is unqualified** — the application must genuinely run, with no route or module excluded. A
   route that ends the process on an authenticated request excludes every module from running, which is
   the plainest possible failure of that requirement.

**This is a departure from the plan's own count, and it is recorded as one.** AAP §0.7 names exactly
**two** conflicts inside the request and decides both; this is a **third**, found by measurement during
the work rather than anticipated by the plan. It is registered rather than absorbed for the reason
§11.0 gives: an argued conflict that stays out of the register is indistinguishable from drift, and the
alternative — leaving a delivered behaviour change described only inside a preservation catalogue — is
worse than a named departure from a count. Nothing about the decision is novel: the precedence rule it
applies is AAP §0.7's own, used exactly as §11.1 uses it, on a conflict the plan did not reach. Two
things follow. The plan's figure of two is superseded **only** as a count, not as a decision — both of
the AAP's named conflicts are decided as the AAP decides them (§11.1, §11.2). And a fourth entry needs
the same treatment this one got: an argument written out, a field-by-field statement of what changed,
and a gate — not a source comment claiming approval, which §11.1 and §11.4 each record one of.

**What is approved, field by field.** Not "hardening" in the abstract — these exact outcomes:

| Input to `POST /api/trinkets/{trinketId}/draft` and `…/autosave` | Baseline | Approved target |
|---|---|---|
| No `zipCode`, or a legitimate one inside the bounds | `draft` 200; `autosave` 200, or 500 from its own chain | **identical** — unchanged, and not part of this deviation |
| A malformed `zipCode` | `draft` **200**, `autosave` **500**, then **the process died** | `draft` **200**, `autosave` **500**, **process alive**. The two responses are byte-identical to baseline's; only the death is gone |
| A crafted bomb, or a forged archive understating its own sizes | no dependable response; expansion attempted to the heap's limit | `draft` **200**, `autosave` **500** — the branch's own malformed-input disposition, at zero or bounded emitted bytes |
| A **valid** archive expanding beyond the cap | 200, and the code stored | `draft` 200 **without storing**, `autosave` **500** — **the one input class whose observable outcome changes** |

The last row is the whole of the behavioural cost, and it is stated here rather than left to be
discovered. The other rows are response-identical by construction, for two independent reasons §10.7
establishes: a promise settles once, so the terminal `.catch` is a no-op wherever the request has
already been answered; and both bounds surface at the **existing** second-link `onRejected` —
`request.success()` in `draft`, `legacyReply(err, h)` in `autosave` — so **no new status code was
introduced anywhere in the file**. The chains remain neither returned nor awaited, deliberately:
returning them would make `draft`'s malformed branch answer 500 instead of 200, which is the change
R-d forbids and which this deviation does **not** authorize.

**Not replay-visible, measured rather than assumed.** No committed scenario reaches either branch:
zero of the 392 scenarios in `test/parity/corpus.json` mention `zipCode` (**probe**). Combined with the
response identity above, the delivered tree therefore has **no replay-visible difference** for this
deviation, so the allowlist rule in [§11.0](#110-the-register-and-why-a-tool-cannot-add-to-it) is
unchanged: it remains exactly one scenario id, deviation 1's, and this entry gives no marker anything
to claim. That is why registering deviation 5 required no change to `test/parity/replay.js`.

**Gate.** §10.7's, unchanged and not restated: the live probe on a running server (malformed, the
64 MiB honest bomb and the 16 MiB forged archive each answering `draft` 200 and `autosave` 500, zero
unhandled-rejection lines, the process still answering `GET /`), plus the nineteen unit cases over the
two bounds. Re-driven on the delivered tree while registering this entry: `draft` **200** with
`{"flash":{},"context":null}` and `autosave` **500** with the generic Boom body for a malformed
`zipCode`, the process still answering `GET /` with 200 afterwards and no unhandled-rejection line in
the server log (**probe**). What is still owed is a corpus case, which §10.7 specifies and which lives
in `test/parity/capture.js`'s builders rather than here.

**Cross-artifact obligation, named because this entry creates it.** Three artifacts state the size of
this register in their own words, and each is owned elsewhere in the delivery: the deviation sections
of [`baseline-parity.md`](baseline-parity.md) and
[`deferred-dependencies.md`](deferred-dependencies.md) — both of which already declare that their
numbering *follows this §11* — and the register comment in `test/parity/replay.js`, alongside the
count in `docs/conversion-inventory.md`. **None of them is made incorrect in substance by this entry**:
the replay allowlist is still one id and still the right one, and neither document's *argument* changes.
What is superseded is the word "two" wherever it counts this table. This document is the canonical
register and says so in §11.0, so the count here governs and the wording there is a documentation
follow-up for the units that own those files.

---

### 11.10 Deviation 6: `POST /api/folders` answers where the baseline process died

**Why this section exists at all, stated before the argument.** The delivered `folders.create` already
behaved differently from baseline, and the only thing standing behind that difference was a source
comment reading `APPROVED DEVIATION` — in a file, in a branch, with **nothing in this register**. That
is the precise failure mode [§11.0](#110-the-register-and-why-a-tool-cannot-add-to-it)
was written to stop: a deviation a tool can declare for itself is drift with a label, and so is one a
comment declares for itself. Either the difference had to be argued into this register with its
precedence argument, or the baseline outcome had to be restored. It is argued in, because restoring the
baseline outcome means restoring a route that takes the application down, and R-b forbids exactly that.
The comment now cites this section instead of asserting approval, at **three** places in
`lib/controllers/folders.js` — one on each of `create`'s two failure branches, and one in the note on
`update`'s duplicate branch that marks where this deviation stops and preservation resumes. Those three
are the only `§11.10` references in the file.

**The route.** `POST /api/folders`, `auth: 'session'`, `payload.name` `Joi.string().min(1).max(140).required()`
`[B config/api_routes.js:680-689]` — byte-identical to the delivered tree, verified by `git diff`. It has
two failure branches inside the `folder.save` callback, selected by `err.code`, and **both are part of
this deviation**. `lib/models/folder.js` declares the unique compound index on `{_owner, slug}`
`[B lib/models/folder.js:164]` and derives the slug from the name, so a colliding name is what raises
the duplicate-key error.

#### Clause 1 — the duplicate name: the process no longer dies, and the conflict is reported as one

**Measured, baseline** (driven against a running baseline server; recorded independently in
`test/parity/corpus.json`'s scenario of the same name, and reproduced twice by QA, once collapsing an
entire 800-request run). `[B lib/controllers/folders.js:71]` is `return request.catch({err: err, message: "You already have a folder with this name. Please choose another."})`.
`request.catch` is **not a decoration this application defines** — `lib/util/routeParser.js` decorates
`request.success` and `request.fail` and hapi's `Request` carries no `catch` member — so the expression
throws a `TypeError` **inside a mongoose save callback**, where `Model.$handleCallbackError` re-emits it
as an `'error'` event on the model. Nothing listens for it, and neither `app.js` nor anything under
`lib/` or `config/` installs an `uncaughtException` handler, so **the process exits**: the client
receives no response, and no route serves afterwards. One authenticated request with a colliding folder
name takes the whole server down.

**The conflict.** **R-d requires the outcome be preserved. R-b requires that the application genuinely
run, with no route or module excluded. Both cannot hold** — a terminated process excludes every route.

**Decision: the target answers, and R-b controls. The status is 500, not the 409 two earlier
revisions of this section specified.** The three reasons §11.1 records apply here, and the first two
apply *more strongly* rather than by analogy — the status question is settled separately, below them,
because it is the part that changed:

1. **There is no observable behaviour to preserve, and less of it than in §11.1.** §11.1's baseline
   leaves one request unanswered; this one destroys the process that would have answered every other
   request too. R-d's protection is for clients that may rely on observable behaviour; a client cannot
   rely on the server having exited.
2. **The intended response is present in the same function, including its message.** The string
   `"You already have a folder with this name. Please choose another."` is baseline's own, composed at
   the dead `request.catch` call site, and the production client already reads a `message` off this
   response (`public/js/library/components/folders/new-folder-directive.js`). The delivered response is
   a reconstruction of what that expression was written to send, not a guess.
3. **R-b is unqualified about the application running**, whereas the `marked` conflict in §11.2 pits a
   prohibition against a validation *target* — the opposite balance, which is why §11.2's reasoning
   does not transfer and this one does.

**Why 500 and not the 409 two earlier revisions specified — and this is a correction to the delivered
code as well as to this section.** The 409 was argued on the ground that "`E11000` on a user-supplied
name is a client conflict" and that the intended message was present in the dead `request.catch`
expression, so answering with it was "a reconstruction rather than a guess". **Both halves were
withdrawn as an invented status.** A status this route has never served is exactly what R-d prohibits
inventing, and the reconstruction argument does not license one: recovering an unreachable *message* is
not the same act as choosing a *status code*, and 409 appears nowhere in either tree's response
surface. What the register admits under R-b is that the route must **answer**, and the narrowest answer
available is the one its own sibling already gives. `create` now **rejects**, so the preserved
route-level catch-all maps the rejection to `Boom.badImplementation` — which is precisely what
`folders.update` does for the same collision, and `update`'s 500 is **preserved baseline** (§9.13's
neighbour case: its identical `request.catch` expression sits inside a *returned* promise chain, so the
chain rejects, the request is answered and the process survives). So the two duplicate-name paths of
one controller now answer alike, through one funnel, with no new status anywhere in the file.
`[T lib/controllers/folders.js:235-286]` carries the same reasoning at the site, including the
rejected 409.

**Delivered contract, field by field — measured, not specified.** Driven on the delivered tree, one
booted instance over a seeded isolated database (`test/parity/server.js --port 3219`), user identity:

```text
POST /api/folders {"name":"dup folder"}     -> 200  225 bytes  {"success":true,"folder":{…"slug":"dup-folder"…}}
POST /api/folders {"name":"dup folder"}     -> 500  application/json  96 bytes   9.743 ms
   {"statusCode":500,"error":"Internal Server Error","message":"An internal server error occurred"}
POST /api/folders {"name":"other folder"}   -> 200  206 bytes
PUT  /api/folders/{thatId}/name {"name":"dup folder"}  -> 500  application/json  96 bytes  10.874 ms
cmp of the two 500 bodies                   -> IDENTICAL
GET  /                                       -> 200   (the process is still serving)
```

| Field | Value |
|---|---|
| Outcome | changes **from** process termination / no response **to** an answered response |
| Status | **500** |
| `content-type` | `application/json; charset=utf-8` |
| Body | hapi's generic `{"statusCode":500,"error":"Internal Server Error","message":"An internal server error occurred"}` — 96 bytes, **byte-identical to the rename collision's**, measured by `cmp` above |
| Process | **alive** — measured: a subsequent `GET /` on the same instance answered 200 |
| Persistence | exactly **one** folder document for that `{_owner, slug}`, unchanged from baseline's own integrity outcome |

**The message the dead expression composed does not reach the client, and that is deliberate.** It
stays on the Boom as internal detail, exactly as clause 2 below records for the unknown-write branch.
The production client at `public/js/library/components/folders/new-folder-directive.js` reads a
`message` off this response and will find hapi's generic one; that is the same thing it finds for a
rename collision today, and preserving the asymmetry the base commit had between the two paths was not
available, because the base commit's `create` path had no response at all.

#### Clause 2 — the unknown write failure: the branch answers instead of hanging

**Measured, baseline** (static, from the shim's own source — and this correction matters, because the
finding that raised it assumed the opposite). `[B lib/controllers/folders.js]`'s unknown-failure branch
is `return reply({err: err, message: err.message})`. The shim's `reply(data)` for a plain object
`[B lib/util/routeParser.js:360-408]` builds a **chainable builder** and settles the deferred response
only from `.redirect()`, `.code()`, `.header()` or `.view()` — none of which this branch calls — while
the handler itself returns `undefined`, so the wrapper takes
`if (result === undefined) { result = await responsePromise; }` `[B lib/util/routeParser.js:567-570]`
and awaits a promise nothing will settle. **So baseline never answered this branch either.** It is the
same non-settlement §11.1 and §4.1 classify, reached by a different mechanism.

The QA finding recorded this as *"TARGET ONLY … newly introduced rather than preserved"*, and reported
honestly that it could not be exercised. It is **not** newly introduced; recording it as a regression
would have been wrong in the other direction, and the correction is why this is a deviation clause
rather than a repair. What *was* newly introduced is only the comment claiming approval for it.

**Decision: the branch answers 500 through this file's own `legacyReply`. R-b and T-1 control**, on
clause 1's reasoning: an unsettled request holds a socket open indefinitely and is the absence of a
response, and T-1 (AAP §0.1.2) requires every function hapi invokes to produce one. The intended
response is again present in the same function — `folders.update`'s unknown-error branch is
`return legacyReply(err, h)`, and that branch **is** baseline-preserved, so this clause makes the two
unknown-failure paths of one controller agree rather than inventing a third shape.

| Field | Value |
|---|---|
| Outcome | changes **from** an unsettled request **to** an answered response |
| Status | **500** |
| Body | hapi's generic `{"statusCode":500,"error":"Internal Server Error","message":"An internal server error occurred"}` — the driving error's message stays on the Boom as internal detail and does not reach the client |
| Selector | `err.code !== 11000`; `=== 11000` is clause 1 |

#### Gate, stated as what it is rather than as what would be convenient

**Clause 1 is verified at runtime and is not yet in a committed gate.** Driven on the delivered tree:
`POST /api/folders {name:"dup folder"}` answered `200`, the same request repeated answered **500** with
the contracted body — byte-identical to the rename collision's, by `cmp` — and `GET /` answered `200`
afterwards, with exactly one folder persisted. What is
**not** available is the paired comparison, and the reason is structural rather than an omission: the
corpus scenario `client-contract.folder-duplicate-name.post-api-folders` is recorded
`unreachableByDesign` because driving it on the **baseline** side terminates the baseline process and
loses every case ordered after it. So there is no recorded baseline response to diff that 500 against,
which is also why [§11.0](#110-the-register-and-why-a-tool-cannot-add-to-it)'s
rule 1 refuses to extend the replay allowlist yet.

**Clause 2 is verified at runtime through an injected fault**, which is new capability rather than a
claim: `test/parity/fixtures/model.js` now carries a `folder` entry able to fault the instance `save`,
so arming a non-`11000` write failure and driving `POST /api/folders` answers **500** with the generic
payload and the request settles. Before that entry existed the branch was unreachable in any harness —
`WRAPPABLE` held only `User.findById` — which is exactly why the finding could only be reported
untested.

**What the corpus and replay work needs, handed over rather than done here** (`test/parity/capture.js`
and `test/parity/replay.js` are owned elsewhere, and this section is the contract they should read):

1. `capture.js`'s definition of `client-contract.folder-duplicate-name.post-api-folders` can become
   **drivable** by giving it steps and running it in a `--only` selection, where nothing is ordered
   after it and the baseline's death costs no other case. Its baseline outcome is then a *recorded
   result* — a dead socket — in the same way §11.1's baseline timeout is a recorded result.
2. With a recorded baseline side it takes an `expectedDeviation` marker with
   `replayDisposition: 'approved-change'`, and `replay.js`'s allowlist takes the id plus **clause 1's
   six-field contract above**, which is stated here so the tool copies it rather than paraphrasing it.
3. A second scenario driving clause 2 needs no new baseline capture and no new fixture: it arms
   `{model: 'folder', method: 'save'}` with any code other than `11000`.
4. **The scenario's own `unreachableReason` needs correcting in the same pass**, and this is the text
   it needs: the termination is a property of the **baseline** tree, not of the code in general, and
   the delivered tree answers 500 and survives. As committed the reason reads as though it described
   the delivered handler too, which is untrue of it and was raised as a defect in its own right.

**Why that correction is a handover and not something this revision did — and the same constraint
governs §11.11's scenarios.** It was made, measured, and
then **withdrawn**, because `test/parity/corpus.json` is digest-bound: its own provenance block records
a payload digest and a sidecar records an `artifactDigest`, and *any* hand-edit breaks both.
**Measured**: with the prose corrected, `node test/parity/manifest.js --verify-provenance test/parity/corpus.json`
reported `content bound NOTHING - no digest covers this artifact`, and `replay.js` refused before
driving; with the bytes restored it reports `content bound payload-digest, sidecar-artifact-digest
recomputed`. So the artifact can only carry this correction by being **re-captured together with its
sidecar**, which is the same pass points 1 to 3 describe. Correcting the prose by hand would have traded
a misleading sentence for an unrunnable gate. Until that pass happens the corpus scenario carries its
original reason and no marker, and **this register — not the artifact, not the source comment, and not
the tool — is where the approval and the corrected statement live.**

---

### 11.11 Deviation 7: the session cookie's `SameSite` attribute is emitted once, so secure mode no longer serves `SameSite=None`

> **WITHDRAWN. The delivered tree does not do this.** Deviation 7's number is retired rather than
> reused, and the argument below is kept because it was once approved — but the change it approved is
> gone from the tree, so nothing in this section describes delivered behaviour.
>
> **Measured.** `[T app.js:372]` appends `"; SameSite=None; Secure"` to the serialised session cookie
> in the secure pass, which is byte-for-byte what `[B app.js:229]` does, and `[T app.js:328-337]`
> records that append in its own words as *part of the contract*, spelling out that the value
> "deliberately carries `SameSite` twice: the state definition sets `isSameSite: 'Lax'` and hapi
> serialises it, and this appends `SameSite=None` after it, which is the occurrence a browser
> resolves". The delivered corpora carry the same thing: the secure pass records
> `session=<v>; Secure; HttpOnly; SameSite=Lax; Path=/; Expires=<+1y>; SameSite=None; Secure` on every
> login response, the non-secure pass records `session=<v>; HttpOnly; SameSite=Lax; Path=/` with no
> append, and the corpus gate reports **no** `header.set-cookie` difference on any login response —
> all eight such authorizations belong to order-0 R1's upload routes, where baseline answered 415 and
> set no cookie at all.
>
> **Why it was withdrawn.** Emitting the attribute once is a change to a response header baseline
> emitted differently, and preservation was possible: the duplication is what the base commit serves
> and what §12's cookie analysis measures. R-d therefore controls, and no requirement outranked it —
> the security merit of a single `SameSite=Lax` is exactly the kind of unrequested improvement
> [§11.0](#110-the-register-and-why-a-tool-cannot-add-to-it) refuses. `test/parity/server.js`'s
> `--secure` help text was corrected in the same pass, having asserted the withdrawn behaviour.


**What was measured, before anything was changed** (**probe**, this tree, the parity launcher with
`--secure`, one `POST /login` by an account the application itself created):

```text
set-cookie: session=Fe26.2**4d3a9a2d…; Secure; HttpOnly; SameSite=Lax; Path=/;
            Expires=Wed, 08 Sep 2027 09:14:03 GMT; SameSite=None; Secure
```

`SameSite` appears **twice**. The state definition sets it once — `[T app.js:377]`
`isSameSite: 'Lax'`, which `[B app.js:98]` carries identically — and hapi had already serialised that
attribute when the second `onPreResponse` appended `"; SameSite=None; Secure"` to the finished header
string (`[B app.js:229]`, the same line this tree carried). A cookie header carrying one attribute
twice is not ambiguous to a browser: it applies the **last** occurrence. Chrome stored the record as
`sameSite: "no_restriction"`, i.e. `None`, and then attached the session cookie to a cross-site
`POST /api/folders` from an unrelated origin, which answered **200** and persisted a folder owned by
the signed-in victim.

Three properties of the mechanism matter to the decision:

* **It is baseline behaviour.** `git show 2f8712a:app.js` carries both the `isSameSite: 'Lax'` option
  and the append. Nothing in this migration introduced the duplicate, and this section does not
  present its removal as parity.
* **It fires on one response in six.** The append sits under `request.cookie`, which
  `lib/util/routeParser.js` sets only for routes the DSL marks cookie-setting. So the *stored* policy
  oscillates: the login response writes `None`, and the next response that re-sets the cookie writes
  `Lax` over it.
* **`Secure` never depended on it.** The leading `Secure` in the measurement above is emitted by
  `isSecure` on the state definition. The append's own `Secure` was the second copy of that too.

**The conflict.** **R-d requires that the outcome be preserved. The security finding this checkpoint
raised requires that a cross-site write not carry the session cookie. Both cannot hold.**

**Decision: the append is removed, so hapi emits exactly one `SameSite`, at the value the state
definition names. The security requirement controls.** Three reasons, in the shape §11.1 uses:

1. **A duplicated attribute is not a behaviour a client can depend on.** Which value a client applies
   depends on which response last touched the cookie, and the two responses disagree. R-d's protection
   is for clients that may rely on observable behaviour; nothing here is stable enough to rely on. This
   is the same argument that carried deviation 1, in a different mechanism.
2. **The intended value is not inferred — it is stated in the same registration.** `isSameSite: 'Lax'`
   is the application's own declaration of this cookie's policy, four lines from the password and the
   `isSecure` semantics AAP §0.6.1 insists be copied exactly *because* a mis-set cookie default is the
   failure mode it fears ("a truthiness test would let an unset value serve it insecurely"). Removing a
   concatenation that inverts that declaration restores what the registration says, rather than
   choosing something new.
3. **The cost of preserving it is a demonstrated cross-site write.** Not a theoretical exposure: a
   record was persisted under the victim's identity from a foreign origin, with the response naming the
   victim in its flash. The `marked` case in §11.2 went the other way because a prohibition met a
   validation *target*; here a prohibition meets a measured exploit against the credential the whole
   authorization model rests on.

**The delivered change, and the whole of it.** The `if (cookieIsSecure) { value[i] += "; SameSite=None; Secure"; }`
block and the now-unused `cookieIsSecure` binding are gone from the second `onPreResponse`. Everything
else in that extension is untouched: the `request.cookie` guard, the `typeof … _header === "function"`
guard, the array normalisation, the session-name prefix match, the `;\s*Expires=` test and the
`"; Expires=" + nextYear.toUTCString()` append all stand as they were.

**The approved shape, field by field.** This is the contract; a response differing in any of these
fields is a failure that happens to sit under an approved deviation:

| Field | Non-secure pass | Secure pass |
|---|---|---|
| cookie name | `session` | `session` — unchanged |
| `Secure` | absent | **present**, from `isSecure` on the state definition |
| `SameSite` | `Lax`, exactly one occurrence | `Lax`, **exactly one occurrence** (was `Lax` then `None`) |
| `HttpOnly` | present | present |
| `Path` | `/` | `/` |
| `Expires` | present, ≈ +1 year | present, ≈ +1 year — the append that produces it is retained |
| value, `Domain`, `Max-Age` | unchanged | unchanged |

**The gate.** `test/parity/replay.js`'s `secureDifferential` derives the secure pass's expected
attributes from the non-secure recording and now moves **only** `secure`; a secure-pass response still
carrying `SameSite=None` fails there, as does one that lost `Secure`, `Expires` or the horizon. The
`--secure` launcher pass and the replay gate text state the same contract, so the three cannot drift
apart silently. Post-change measurement (**probe**, same command as above):
`session=…; Secure; HttpOnly; SameSite=Lax; Path=/; Expires=<+1y>` — one `SameSite`, value `Lax`.

**Replay-visible?** Only in the secure pass, and it produces no scenario difference there: the
derivation *is* the expectation, so there is nothing for a marker to approve and **no scenario id is
added to the allowlist**, which stays exactly deviation 1's. A committed secure-pass corpus would
compare it exactly instead; capturing one belongs to the corpus work.

**What this does not close.** `SameSite=Lax` restrains a cross-**site** request only. A same-site
sibling origin under the parent-domain cookie `config/default.yaml` ships (`domain: .trinket.dev`) is
not restrained by it at all — that is §11.6 row 6, and it is deviation 8, not this one, that answers
it. Nor does any cookie attribute constrain a non-browser client that attaches the cookie itself.

### 11.12 Deviation 8: a credentialed cross-origin state-changing request is rejected

> **WITHDRAWN. The delivered tree does not do this.** Deviation 8's number is retired rather than
> reused. The measurement of the *exposure* below stands — it is a true statement about both trees —
> but the guard that answered 403 is gone, so a credentialed cross-origin state-changing request is
> performed on the delivered tree exactly as it is on baseline.
>
> **Measured.** `grep -rn trustedOrigins` over `app.js`, `config/` and `lib/` returns nothing, and
> there is no read of `Origin`, `Referer`, `Sec-Fetch-Site` or any equivalent anywhere in the tree —
> `grep -rn "sec-fetch-site|headers.origin|crossOrigin"` over the same set is empty. The
> `app.security.trustedOrigins` key that configured it is gone from `config/default.yaml` with the
> guard, which is what took that file back to the base commit apart from one retained key
> ([§11.14](#1114-deviation-10-the-email-share-tokens-key-is-no-longer-derivable-and-an-unset-appmailsecret-fails-closed)'s
> `app.mail.secret`), and `log.debug.filename` is restored to `/tmp/debug.txt` at
> `[T config/default.yaml:129]` in the same withdrawal.
>
> **Why it was withdrawn, and what that leaves open.** The conflict this section states is real and its
> resolution is what changed: the security finding behind it was not an instruction from the authority
> that froze the AAP, and §11.0's own test — "a change that could have preserved baseline is not a
> candidate at all, however much better it looks" — refuses it on that ground. **The exposure is
> therefore open and is recorded rather than closed**: all 96 mutating routes authenticate from the
> session cookie alone, there is no CSRF token anywhere in either tree, and a credentialed
> cross-origin write succeeds. Closing it needs a separately approved change, and the shape it would
> take is the one argued below — an origin check rather than a token, for the R-a and R-d reasons
> given, with the corpus recaptured for whatever it changes.


**What was measured, before anything was changed** (**probe**, this tree, both cookie passes, an
account the application itself created):

```text
curl -b <jar> -H 'Origin: http://evil.example.com' -H 'Content-Type: application/json' \
     -d '{"name":"CSRF-PREFIX-SECURE"}' http://127.0.0.1:3202/api/folders
→ 200 {"success":true,"folder":{"id":"6a9fd1e5…","name":"CSRF-PREFIX-SECURE",…},
       "flash":{"requested":["qaowner000"]}}
```

and the folder was really there on a subsequent `GET /api/folders`. The same request answered 200 on
the non-secure instance. There is no CSRF token anywhere in the tree, and there was no `Origin`,
`Referer` or Fetch-Metadata check: every one of the **96** mutating routes (POST 63, PUT 19, DELETE 13,
PATCH 1) authenticates from the session cookie alone.

**The conflict.** **R-d requires that requests baseline accepts continue to be accepted — §11.6 row 6
says so in those words. The security finding this checkpoint raised requires that a cross-origin
state-changing request be rejected, or that a token be required. Both cannot hold.**

**Decision: a credentialed cross-origin write is rejected with 403. The security requirement controls,
and a token is deliberately NOT introduced.** The reasoning, and the second half of it is as much a part
of the decision as the first:

1. **A token requirement was rejected on R-a and R-d grounds.** `@hapi/crumb`, or any server-issued
   token, changes the request contract of all 96 mutating routes: the AngularJS client sends no such
   token, so every state-changing browser flow would answer 403, the suite's mutating cases would fail
   and every mutating corpus scenario would diff. That is outside R-a's four permitted diff categories
   and it is exactly the kind of change R-d exists to stop. No dependency was added.
2. **The check that is delivered cannot reach a request this application's own clients make.** It fires
   only when all three of the following hold: the method is POST, PUT, PATCH or DELETE; the request
   carries the session cookie; and the client itself reported an origin that is not ours. The
   application's pages are served from the origin they call, so their writes report ours; a GET is not
   guarded at all, so no navigation, embed or asset load is affected; an anonymous cross-origin POST is
   untouched and answers exactly as it did.
3. **After deviation 7 the remaining reachable cases are the attack itself.** A compliant browser will
   not attach a `SameSite=Lax` cookie to a cross-site request, so condition 2 can now only be met by a
   same-**site** sibling origin — §11.6 row 6's probe, the highest-severity item in this document — or
   by a non-browser client replaying a jar, which is the finding's own reproduction. The two findings
   were therefore resolved as one change, which is also why they share a measurement.
4. **It changes no request any gate in this repository makes.** **Measured**, not assumed: a walk of
   every header set in `test/parity/corpus.json` yields `accept-ranges`,
   `access-control-expose-headers`, `cache-control`, `connection`, `content-disposition`,
   `content-length`, `content-type`, `date`, `etag`, `expires`, `last-modified`, `location`, `pragma`,
   `set-cookie`, `vary`, `x-frame-options` and **no** `origin`, `referer` or `sec-fetch-*`; a search over
   `test/**` finds none either; supertest and `server.inject` send none.

**The delivered mechanism.** An `onPostAuth` extension in `app.js`, with its helpers at module scope:

* **Stage.** `onPostAuth` — the route is resolved and authentication has run, so a rejection is
  recorded against a real route, and it is still ahead of validation, the route's pre-handlers and the
  handler, so nothing has been read or written when it fires.
* **Credential test.** `request.state[<session name>]`, and the raw `Cookie` header as well, because
  under the server's `state.failAction: 'log'` a cookie whose seal does not verify is dropped from
  `request.state` — a request carrying an unverifiable session cookie is still one that tried to ride
  one.
* **Origin test, first header present decides.** `Origin`; then `Referer` when there is no `Origin`,
  and a `Referer` that is not an absolute URL is not treated as evidence either way; then
  `Sec-Fetch-Site`, where `cross-site` and `same-site` are the browser stating plainly that the
  initiator was not this origin. An opaque `Origin: null` yields no authority and is therefore not ours.
* **Allow-list.** The request's own `Host` authority — which is what makes a same-origin write pass on
  any host the process is reached by, with no configuration — plus the authority of `config.url`, the
  client-facing origin `config/app.config.js` composes and `routeParser`'s `redirect()` prefixes onto
  every absolute `Location`, plus `app.security.trustedOrigins`, a new key that ships **empty**.
* **Comparison is on the host authority, not the scheme**, deliberately: the shipped reverse proxy
  (`serverside/nginx/nginx-ssl.conf`) terminates TLS and forwards plain HTTP with `Host $host`, so the
  browser reports an `https` origin to a process serving `http`. Comparing schemes would reject every
  legitimate write behind it.
* **Response.** `Boom.forbidden('Cross-origin request rejected')`, which takes the path any other error
  takes — the Boom payload for `/api/` and JSON callers, the 403 page for a browser — plus one `warn`
  line naming the method, path and the header that decided, so an operator sees a legitimate client
  being turned away as readily as an attempt.

**The approved shape, field by field.** For a request meeting all three conditions: status **403**;
body the standard Boom 403 payload for an API or JSON caller and the rendered `50x.html` at 403 for a
browser; no write performed; one `warn` log line. For every other request — any GET, any anonymous
request, any request reporting no origin, any request reporting ours — **the response is unchanged in
every field**, which is the half of this contract the gates below actually measure.

**The gate.** The six-case matrix, driven on both cookie passes and re-driven at consolidation:
foreign `Origin` + jar → 403 and nothing persisted; own `Origin` + jar → 200; **no** `Origin` + jar →
200, which is the case that keeps the suite, the corpus and every server-to-server caller intact;
foreign `Referer` only + jar → 403; `Sec-Fetch-Site: cross-site` only + jar → 403; foreign `Origin`
with **no** jar → unchanged. Plus the whole mocha suite, the route-table digest, the ten-path smoke
check and a browser drive of login → folder create → list, none of which may move.

**Replay-visible?** **No.** No committed scenario carries any of the three headers (measured, above),
so no scenario's response changes and **no scenario id is added to the allowlist**, which stays exactly
deviation 1's. A scenario that drives a foreign `Origin` would be a new case for the corpus work, and
the matrix above is what stands in for it here.

**What this does not close, stated rather than implied.**

* **A stolen or exported cookie jar replayed with no `Origin` header still works.** The check reads the
  client's own account of its origin and a non-browser client can simply omit it. That is not CSRF —
  it is credential theft — but it is the honest limit of an origin check, and it is why the named
  follow-up in §11.6 row 6 (server-validated tokens on every session-authenticated state-changing
  route) remains the durable answer rather than being satisfied by this.
* **A same-site sibling origin is rejected only while `app.security.trustedOrigins` does not name it.**
  A deployment that adds its sibling hosts to that list, as a subdomain-serving deployment must,
  re-opens §11.6 row 6 for exactly those hosts. The parent-domain session cookie
  (`domain: .trinket.dev`) is what makes that trade necessary, and reconsidering it is part of row 6's
  follow-up.
* **A mutating GET is not covered.** No mutating GET was found in scope for this decision, and widening
  the guard to GET would change navigations — including the embed routes — which R-a does not permit
  without its own argument.

---

### 11.13 Deviation 9: the page-level course copy answers where the baseline process died

**Why this section exists.** `POST /{userSlug}/courses/{courseSlug}/copy` **never answered**, on either
tree, for the commonest way a user reaches it: the owner copying their own course. On the delivered
tree the request hung; at `2f8712a` the **application process exited**. A route that cannot answer is
what R-b forbids, and the outcome R-d would have preserved is a process exit, so this is the same
class of conflict [§11.10](#1110-deviation-6-post-apifolders-answers-where-the-baseline-process-died)
runs the T-6 procedure on, in a second controller. It is argued in here, by the same route and with
the same discipline: the measurement first, then the conflict, then the precedence argument, then the
field-by-field contract, then the gate.

**The route.** `POST /{userSlug}/courses/{courseSlug}/copy courses.copy`, `auth: 'session'`,
`success.redirect: '{classPageUrl}'`, `fail.redirect: '/welcome'`, pre-handlers
`helpers.coursesEnabled`, `user(params.userSlug)` and `{method: helpers.courseBySlug, assign: 'course'}`
`[T config/routes.js:150-161]` — byte-identical to `[B config/routes.js]`, and unchanged by this
deviation. The handler declares **no** permission check, so any authenticated account reaches it.
`lib/models/course.js` declares the unique compound index on `{_owner, slug}` and derives the slug from
the name, and `copy` builds the new course with **the same name**, so **the owner collides on the very
first attempt** — no second request is needed, and an earlier reading of this as a
"copy-twice" case understates the reach.

#### The measurement, on both trees, driven rather than reasoned about

Two independently installed running servers (target on 3221, a `git worktree` at `2f8712a` with its own
`npm ci` on 3222), each launched by `test/parity/server.js`, each given one signup and one
`POST /api/courses`, then one `POST /{owner}/courses/{slug}/copy` as that owner:

```text
BASELINE 2f8712a
  POST /qafix/courses/qa-probe-course/copy   (owner, Accept: text/html)
    -> curl exit 52 "empty reply from server" after 0.026 s
    -> the application process EXITED, code 1
    -> child stderr:  throw er; // Unhandled 'error' event
                      TypeError: Cannot read properties of undefined (reading 'slug')
                      Emitted 'error' event on Function instance at mongoose/lib/model.js:5416
    -> GET / afterwards: connection refused (curl exit 7). Every route is gone.

DELIVERED TREE, BEFORE THIS DEVIATION
    -> status 000 after 20.002 s (client timeout); no response, ever
    -> GET / afterwards: 200. The process survives.
    -> courses persisted for that owner: unchanged. The model's FIRST save is what failed.
```

**The mechanism named in that block is now false, and correcting it changes what this section credits
the survival to.** The block used to attribute the survival to a **model-level `'error'` listener in
`lib/models/model.js`, "added by this migration"**, which logged `Model[Course] callback error: …`
instead of letting `EventEmitter` rethrow. **That listener was withdrawn as an unregistered behaviour
change (R-d)** and is not in the delivered tree — measured: `grep -rn "\.on('error'" lib/models/`
returns nothing, and `[T lib/models/model.js:194-197]` records the withdrawal in its own words, noting
that the full suite stayed at its then-current 120 passing / 10 failing without it and that no test and
no measured request required it. (The suite has since reached 130 passing / 0 failing; the withdrawal
was re-checked at that state and still costs nothing.) What remains in that file is the `$handleCallbackError` override and its
`reDeliveringCallbacks` WeakSet, retained on measurement — withdrawing *those* turned
`error-edge.not-found.missingExport` from `answered` to `transport-failure` with
`applicationDied: true` — and the override **deliberately lets a throw from its own re-delivery reach
Mongoose's `emit` exactly as the base commit did. So the baseline outcome here is the process exit
itself**, and what prevents it on the delivered tree is entirely in `lib/controllers/courses.js`'s own
branches, whose comment carries the same statement.

The mechanism is `[B lib/controllers/courses.js:83-98]`, delivered at
`[T lib/controllers/courses.js:203]`: the callback's `err` was declared and never inspected, and
`lib/models/course.js`'s `copy` calls back with **no document** when its first save fails, so
`course.slug` was read off `undefined` **inside a mongoose save callback**, where no request lifecycle
can route it. `Model.$handleCallbackError` re-emits it as an `'error'` event on the model; at baseline
nothing listened, and an `'error'` event with no listener is rethrown by EventEmitter, so the process
went with it.

**The conflict.** **R-d requires the outcome be preserved. R-b requires that the application genuinely
run, with no route excluded. Both cannot hold** — and here they cannot hold in either direction, which
is worth stating plainly: the delivered tree does not even preserve baseline's outcome *today*, because
the model listener already replaced the exit with a hang. The choice is between two non-answers, one of
which also destroys the server.

**Decision: the two failure paths answer. R-b controls.** §11.1's three reasons apply, the first two
more strongly than by analogy:

1. **There is no observable behaviour to preserve.** §11.1's baseline leaves one request unanswered;
   this one *ends the process that would have answered every other request*. R-d protects clients that
   may rely on observable behaviour, and no client can rely on the server having exited. One
   authenticated form submission — the ordinary "copy this course" control on a course the caller
   already owns — took the whole application down at baseline.
2. **The intended response is present in the same file and for the same model call, including its
   message.** `courses.create` maps `err.code === 11000` to
   `request.fail({err, message: "You already have a course with this name. Please choose another."})`
   `[T lib/controllers/courses.js:88-93]`, and `course.copyCourse` — the **API** sibling of this exact
   operation, driving the same `course.copy` — maps it identically
   `[T lib/controllers/course.js:517-523]`. Both are baseline's own strings at
   `[B lib/controllers/courses.js:29-34]` and `[B lib/controllers/course.js:186-191]`. The delivered
   response is a reconstruction of what this feature already answers for this collision, not a guess,
   and not a status invented for it.
3. **R-b is unqualified about the application running**, whereas §11.2's `marked` conflict pits a
   prohibition against a validation *target* — the opposite balance, which is why §11.2's reasoning
   does not transfer and this one does.

**Why `request.fail` here and not a Boom of its own.** (An earlier revision of this paragraph
contrasted it with "the 409 §11.10 chose"; that status was withdrawn — §11.10 answers 500.) The two routes are not the same kind of
route, and the register should not pretend they are. `POST /api/folders` is a JSON API route with no
`fail` declaration, so §11.10 had to choose a status and chose the one that states the truth about a
client-caused collision. This route is a **page** route that declares `fail.redirect: '/welcome'`, and
its own feature already answers this collision through `request.fail` at both sibling sites. Choosing a
bare Boom here would discard the message the branch exists to deliver *and* the redirect the route
declares, and would invent a shape the feature does not use. Where §11.10 had to invent because nothing
existed, this one reconstructs because something does.

#### Clause 1 — the duplicate name: answered through the route's own fail funnel

| Field | Value |
|---|---|
| Selector | the model callback's `err.code === 11000` |
| Outcome | changes **from** process exit (baseline) / an unsettled request (delivered, pre-deviation) **to** an answered response |
| HTML-negotiated status | **302** |
| HTML `Location` | the route's declared `fail.redirect`, `/welcome`, absolute against `app.url` — measured `http://127.0.0.1:3221/welcome` |
| JSON-negotiated status | **200** |
| JSON body | `{"err":{…driver duplicate-key object…},"message":"You already have a course with this name. Please choose another.","flash":{…}}` — the shape `request.fail` produces for a JSON request, identical in construction to `courses.create`'s answer for the same collision |
| Flash | `failure` carrying `{err, message}`, plus `payload` and `query`, exactly as `request.fail` writes them. **`lib/views/base.html` renders only `flash.siteMessage`**, so the HTML client is redirected with the message in the flash and does not see it on `/welcome`; that target is the route's own declaration and is not changed here |
| Process | **alive** — `GET /` answers 200 afterwards, measured |
| Persistence | **zero** new course documents; the model's first save is what failed |
| Success path | untouched — a non-owner copy still answers **302** to the interpolated class-page URL, measured `http://127.0.0.1/u/qafix2/classes/qa-probe-course`, with the copied course persisted |

#### Clause 2 — any other write failure, and the missing document: answered 500

| Field | Value |
|---|---|
| Selector | `err` present with `err.code !== 11000`, **or** no document with no error — the value that produced the TypeError |
| Outcome | changes **from** no response **to** an answered response |
| Status | **500** |
| Body | hapi's generic `{"statusCode":500,"error":"Internal Server Error","message":"An internal server error occurred"}`; the driver's own message stays on the Boom as internal detail and does not reach the client |
| Mechanism | `errors.badImplementation(err && err.message)`, **resolved and never thrown** — a thrown or rejected Boom is rewritten by the route catch-all `[T lib/util/routeParser.js]` into a second `badImplementation`, and this file's own unknown-failure mapping is the same expression at `[T lib/controllers/courses.js:576]` (`courses.download`), so the two unknown-failure paths of one controller agree rather than inventing a third shape |

#### Gate, and what is handed over

**Both clauses are verified at runtime and neither is yet in a committed gate.**

**Clause 1 is driven end to end through the running server.** After the change, on the delivered tree:
the owner's copy of their own course answered **302** with `Location: http://127.0.0.1:3221/welcome` in
0.013 s for an HTML request and **200** carrying `{err, message, flash}` with
`err.code === 11000` and `flash.failure` present for a JSON request; `GET /` answered 200 afterwards;
the owner's course count was **1** before and after, so nothing was persisted; and a second account
copying the same course still received **302** to
`http://127.0.0.1/u/<other>/classes/f10-subject-course` with the copy persisted, so the success path is
unchanged. The existing suite corroborates that last point independently: `test/lib/api/registration.js`
drives this route as a second user and asserts the 302 and its `Location` pathname, and that case
passes.

**Clause 2 is verified at the handler boundary rather than over the route**, because its selector needs
a write failure whose code is not 11000, or a callback with no document — neither of which a request can
cause. Driven by calling `courses.copy` with a stubbed `request.pre.course.copy`: an `err` with
`code: 64` and no document answered a Boom whose status is **500**, whose client payload is
`"An internal server error occurred"` and whose own `message` is still the driver's
`"write concern failed"`; and a callback with **no error and no document** — the exact value that
produced baseline's `TypeError` — answered the same 500 rather than throwing. A committed route-level
case still needs a fault entry `test/parity/fixtures/model.js` does not have:
it carries a `folder` entry for §11.10's equivalent branch and **no `course` entry**, so
`{model: 'course', method: 'save'}` is what such a case would arm.

**What the corpus work needs, handed over rather than done here** (`test/parity/capture.js` and
`test/parity/corpus.json` are owned elsewhere, and this section is the contract they should read):

1. `route.post.userSlug-courses-courseSlug-copy.html` and `.json` already exist and already carry a
   **recorded baseline half** — both record `"transport failure: socket hang up (ECONNRESET)"`, which
   is baseline's process exit observed from the client, and both carry `expectedDeviation: null`. That
   is a recorded *result*, in the same sense as §11.1's recorded timeout, so unlike §11.10's scenario
   these two need no new baseline capture.
2. Each therefore takes an `expectedDeviation` marker with `replayDisposition: 'approved-change'`, and
   `replay.js`'s allowlist takes the two ids plus **clause 1's field contract above**, stated here so
   the tool copies it rather than paraphrasing it. Until then the two scenarios carry no marker, and a
   replay comparing them reports a difference — which is the honest state, because the difference is
   real: baseline severs the socket and the delivered tree answers.
3. A case for clause 2 needs the `course` fault entry named above and no new baseline capture.
4. **Neither can be done by hand.** `test/parity/corpus.json` is digest-bound — its provenance block
   records a payload digest and its sidecar an `artifactDigest` — so the markers can only arrive by
   **re-capture together with the sidecar**, exactly as §11.10 records for its own scenario. Editing
   the bytes would trade a missing marker for an unrunnable gate.
### 11.14 Deviation 10: the email share token's key is no longer derivable, and an unset `app.mail.secret` fails closed

**This is the one deviation this register asked for in advance.** [§11.4](#114-an-unapproved-security-policy-that-was-added-and-has-now-been-withdrawn)'s
exposure table, row 9, recorded the forgeable share token as an unremediated exposure and named the
remedy in terms — "declare `app.mail.secret` with the same shape the session password already uses …
per AAP §0.6.1" — and then explained why it was named rather than done: *"Every file that fix touches
is owned elsewhere."* That is what changed. The QA security verification at this checkpoint raised the
same behaviour as a HIGH finding marked **Blocking: YES**, and assigned it together with
`lib/util/helpers.js`, `lib/controllers/trinket.js` and both configuration files. The row is now
closed, in place, with the re-driven measurement.

**What a client sees, field by field.** Five cases on `POST /api/trinkets/{trinketId}/email`, all
driven anonymously with no cookie against a seeded instance, short code `pyfixture001`, trinket
`000000000000000000000201`:

| Case | Baseline / pre-fix | Delivered | Changed? |
|---|---|---|---|
| No `token` in the payload and none in session | **400** | **400** | No |
| A **validly signed** token whose `shortCode` claim names another trinket | **403** | **403** | No |
| A token minted with the derivable key `"undefined" + shortCode` | **200** — the capability check **passed** and the handler proceeded into the mail path; QA recorded one real `trinket-share` send on an instance with the mail fixture loaded | **500** | **Yes — this is the deviation** |
| A token minted with the configured key and the correct claim | 200 | **200** | No |
| A token minted by the application itself and carried in session | 200 | **200** | No |

The single changed cell is the whole of it: **the one key that used to work now behaves exactly like
every other wrong key.** A token signed with `"" + shortCode` and a token signed with an unrelated key
both answered **500** before this change and both answer 500 after it — measured on the pre-fix tree,
which is why the delivered response is a *narrowing* of the difference rather than a new error edge.

**Row 2's "validly signed" is load-bearing, and it is why that row needed a second probe to assert at
all.** Signature verification precedes the claim comparison, so a token carrying a wrong `shortCode`
reaches the 403 only if it verifies first. Before this change any probe could mint such a token,
because the key was public; after it, a probe minting with the old derived key gets the **500** of row
3 instead, and reading that as "the 403 edge regressed" would be a mistake about the probe rather than
an observation about the route. Row 2 is therefore asserted with `app.mail.secret` **pinned** to a
known value, so a legitimate signature can be produced from outside the process — measured on the
delivered tree: valid signature with the correct claim **200**, valid signature with a wrong claim
**403**, the old derived key **500**, no token **400**.

**The conflict, and which requirement controls.** R-d prohibits improvements and makes baseline the
tie-breaker; the forged-token 200 is baseline behaviour, so preserving it is what R-d asks for.
Preservation is nonetheless impossible here, for two reasons that are independent of each other:

1. **The directive.** The finding was raised as a defect by this delivery's own security verification
   and assigned for remediation with the file ownership the earlier checkpoint lacked. §11.4's own
   text is what makes that decisive rather than a matter of taste: every exposure there "remains open
   **until that follow-up is separately approved and implemented**". Approval arriving is the
   condition the row itself set. A register that wrote that sentence and then refused the follow-up
   when it was approved would not be applying a rule.
2. **What R-d protects.** R-d protects behaviour a client may rely on. No client can rely on being
   able to forge a capability token: the 200 was not a service the route offered but the absence of the
   check it was written to perform, in the same way deviation 1's non-settlement was the absence of a
   response and deviation 6's process death the absence of an answer. §11.1's precedence argument
   applies unchanged.

The AAP is not silent either, which is why the *shape* of the fix was not a free choice: §0.6.1
specifies the fail-closed treatment of an unset secret — a generated ephemeral value outside
production, a refusal inside it — and row 9 cited that section by name.

**What was delivered, and where.** One derivation point, `lib/util/helpers.js:562`
`module.exports.emailTokenSecret(shortCode)`, which both sides of the token now call. Three branches:

* a configured non-empty `app.mail.secret` → that value concatenated with the short code, which is
  baseline's own construction and is why a deployment that already sets the key sees nothing change;
* unset and outside production → one `crypto.randomBytes(32).toString('hex')` per process
  (`:581`), reused for the lifetime of that process and reported by a single informational line
  (`:596-608`) that goes to stdout, so it cannot trip AAP §0.9.3's zero-warning gate;
* unset and in production → **`null`** (`:577`), on which `verifyEmailToken` (`:633`) answers
  `Boom.forbidden()` and the three `jwt.sign` sites in `lib/controllers/trinket.js` (`:588`, `:647`,
  `:969`) mint nothing at all — no signature, no session write. With no key, accepting anything is
  accepting everything, and a per-worker generated key in a clustered deployment would accept or
  refuse depending on which worker answered.

`config/default.yaml:157` declares the key, empty like its siblings, with the reasoning above written
beside it; `config/local.example.yaml` documents it as required in production and in any multi-process
deployment. The production read is taken at **call** time rather than at module load, because
`config/app.config.js` assigns `isProd` and requires `helpers` transitively, and nothing is written
back onto the `config` object — the `config` package persists assignments to `config/runtime.json`.

**What is preserved exactly.** The no-token edge answers `Boom.badRequest()` in every configuration,
which is why the key is resolved *inside* the `if (token)` branch and not above it. The wrong-claim
edge answers `Boom.forbidden()`. `jwt.verify` is still called with no options, so the algorithm is
whatever the token's header names and no lifetime is imposed; its synchronous throw on a bad signature
is left to propagate to the funnel it always reached. The session fallback at `emailToken:<shortCode>`,
the `===` comparison of the claim, and the mint-time yar write are unchanged in shape.

**Gate.** The five cases above, re-driven against the delivered tree — the third now 500, the fourth
verified with the secret pinned to a known value so a legitimate signature could be produced from
outside the process, and the fifth by driving `GET /embed/python/pyfixture001` with a library `Referer`
so the application minted its own token into the session and then posting with no payload token. The
production-and-unset branch is **unit-verified, not driven**, and this is stated rather than glossed:
the parity overlay is expressly not a production configuration, so `emailTokenSecret` returning `null`
was proved by loading the module under `NODE_ENV=production` with the key unset, and the refusal it
produces by reading `verifyEmailToken`. The suite's own share-token case
(`test/lib/api/trinket.js`) asserted the capability by **reproducing the derivation**; it now calls
`helpers.emailTokenSecret` for its key, which is a change of how the test obtains a secret and not of
what it asserts — no assertion expression, expected value or case count moved, and the suite was
unchanged at its then-current 116 passing (it now reports 130 passing / 0 failing, and this change is
not one of the ten expected-value corrections that took it there).

**Replay-visible: no.** Both committed scenarios that reach this route —
`route.post.api-trinkets-trinketId-email.json` and `client-contract.share-email.post-api-trinket-email`
— post `token: ""` and record **400**, which is the unchanged first row above. So this deviation claims
no scenario id and does not widen the allowlist. Worth naming as the reason the corpus never caught
this: the recorded requests exercise the route's *rejection* of a missing capability, and never present
one, so the check that was not a check was invisible to a parity diff by construction.

**Declined, with reasons.** Converting `jwt.verify`'s bad-signature throw into a `403` — which row 9's
own follow-up anticipated ("expecting **403** on the third") — was **not** done, and the divergence
from that expectation is recorded here rather than quietly met: the throw's funnel is an error edge no
finding raised, R-e requires each edge to keep its mapping, and 500 is what a badly signed token
already produced. Answering 403 would have meant changing a mapping to satisfy a prediction. Also
declined: a timing-safe comparison of the claim, on §10.4's precedent that a change altering no outcome
is not a repair; and a boot-time assertion that `app.mail.secret` is set in production, which belongs
beside the session-password guard in `app.js` — a file owned by another unit at this checkpoint, and
named as a handover below.

### 11.15 Deviation 11: a course invitation token is minted from the CSPRNG, and accepting one requires being the account it names

> **PART WITHDRAWN.** The **token half is gone**; the **accept-side identity requirement is live**.
> Read the two clauses of this section separately: everything it says about minting the token from the
> CSPRNG describes a change no longer in the tree, and everything it says about who may accept an
> invitation is delivered behaviour.
>
> **Measured.** `git diff --stat 2f8712a -- lib/models/courseInvitation.js` prints nothing, so the
> model is byte-identical to the base commit, and `[T lib/models/courseInvitation.js:37]` still mints
> `crypto.createHash("md5").update(email + course.id).digest("hex").substring(0, 8)` — an eight-hex
> value derivable by anyone who knows the invited address and the course id. Driven end to end on the
> delivered tree, `POST /api/courses/{courseId}/invitations` with
> `{"emailList":["not-an-email","real@example.com"]}` answered 200 with tokens `c02980dd` and
> `ba23b138`, which are that derivation and not CSPRNG output. **What is live** is in
> `[T lib/controllers/classes.js]`'s `acceptInvitation`: it lower-cases the invitation's address and
> the acting account's, refuses on `invitedEmail !== actingEmail` with a flashed warning and a redirect
> to `/home`, and only then calls `course.addUser`. The baseline has no such comparison.
>
> **Why the token half was withdrawn.** The token is a **persisted value** and it is rendered into the
> acceptance URL, so changing its derivation changes stored data and a rendered field that the parity
> contract covers, and preservation was possible. R-d controls. The capability the derivable token
> grants is bounded by the live half rather than by the token: an outsider who derives a real token can
> still only accept it as the account it names, which is the half that was kept.


**What was true.** `lib/models/courseInvitation.js` minted an invitation token as
`md5(email + course.id).substring(0, 8)`, and `GET /courses/accept/{token}` — unauthenticated,
non-expiring and unthrottled — resolved the invitation by that token alone and enrolled whoever
presented it, then wrote `status = "accepted"`. Two public inputs and eight hex characters: the token
was not searched for, it was **computed**. Driven on the pre-fix tree, an invitation minted for
`adhoc-invitee@example.com` on the seeded course carried token `1686a5ed`, which is exactly
`md5('adhoc-invitee@example.com' + '000000000000000000000301').slice(0, 8)`; presenting it while signed
in as `admin@example.com` — an account with no role on that course — returned 302 `/home`, added
`{admin@example.com, ['course-student']}` to the course's users, and flipped the invitation to
`accepted`, so the outsider enrolled **and** consumed the invitation issued to somebody else.

**What a client sees, field by field.**

| Case | Baseline / pre-fix | Delivered | Changed? |
|---|---|---|---|
| `POST /api/courses/{id}/invitations` | 200; body carries `token` = 8 hex characters, derivable | 200; body shape identical, `token` = **64** hex characters from `crypto.randomBytes(32)` (`:46`) | **Value and length only** |
| The same POST repeated for an address already invited | 200; token **re-minted** to the same derived value | 200; token **unchanged** — applied through `$setOnInsert` (`:78`) | No, by construction |
| An invitation row carrying an 8-character token written before this change | resolves and accepts | **resolves and accepts** | No |
| `GET /courses/accept/{token}` by the invited account | 302 `/home`, enrolled `course-student`, invitation `accepted` | identical | No |
| The same by an account that is **not** the invited address | 302 `/home`, **enrolled**, invitation **consumed** | 302 `/home`, **no enrolment**, invitation **left redeemable**, one `warning` flash | **Yes — this is the deviation** |
| An absent or unknown token | not-found branch, both ternary arms | identical | No |

Status and `Location` are **identical on every row**, the refusal included. What changed on the
deviating row is the database write and the flash — which is why this deviation cannot be observed by
comparing a response line and is asserted against the course document and the invitation document
instead.

**The conflict, and which requirement controls.** Identical in shape to §11.14's, and it needs no
separate argument: the finding is HIGH and **Blocking: YES**, it was assigned for remediation, and
what R-d protects is behaviour a client may rely on. An invitation is a capability issued to one
address; the invited account cannot rely on a stranger being able to spend it, and the stranger's
enrolment was the absence of the comparison the branch was written to make — its own baseline comment
said so. The token's *value* is not a contract at all: nothing published, stored or asserted depends on
which opaque string an invitation carries, which is why widening it from 8 to 64 characters is a
change in entropy rather than in interface.

**Why `$setOnInsert` rather than `$set`, stated because it is the load-bearing detail.** `addList` is
an upsert keyed on `{courseId, email}` and the controller calls it again on every resend. A token in
`$set` would be re-minted on each of those calls, silently invalidating a link that has already been
mailed — the recipient's URL would stop resolving and the accept route would answer the not-found
branch — and it would do the same to every row written before this change. `$setOnInsert` applies only
when the upsert inserts, so a new invitation is minted a token and an existing one keeps the one it
was created with. `token` appears in exactly one of the two operators because MongoDB rejects an update
document naming the same path in both. **Measured, on the delivered tree**: a stored token rewritten to
the old 8-character shape survived a resend unchanged and then still accepted — 302 `/home`, enrolled
`course-student`, invitation `accepted`.

**The comparison, and its fail-closed direction.** `lib/controllers/classes.js:194-197` lower-cases
both sides before comparing, and treats an **empty** invited address as a mismatch. `addList` writes
`invitation.email` already lower-cased and `lib/models/user.js` does the same for a user, so the
lower-casing is defensive rather than necessary — a document written by a fixture, a migration or a
future caller must not be able to turn a case difference into a refusal, and must not be able to turn a
missing address into a match. The refusal message (`:205`) names **neither** address, because telling a
caller which account was invited would make the route an address oracle in the act of closing an
enrolment hole.

**Preserved unchanged.** Every sibling branch: the already-accepted arm and both of its cases
(in-course info flash, already-used warning flash), the anonymous arm with its `yar.set("next", …)`
and `courseInvitation` flash and redirect to `/login`, the not-found arm with its
`request.user ? /home : /login` ternary, and **both** `.catch(function(err) { return err; })` funnels,
which return the error rather than throwing so hapi boomifies it to the same 500 without a second log.
The route declaration at `config/routes.js:189` is untouched, so the AAP §0.9.1 per-entry route
manifest is unchanged.

**Gate.** Six cases driven against the delivered tree, each asserted on the database and not only on
the response: the fresh token's length and its non-equality with the md5 derivation; the outsider's
refusal with the course's user list and the invitation's status read back afterwards; the invited
account's acceptance; a rewritten legacy token surviving a resend and then accepting; and a resend
returning a stable 64-hex token. `node test/parity/seed.js --verify` exits 0 at 206 fixture checks,
15 more than before, including one asserting each seeded token is 64 lowercase hex and one asserting it
is **not** `md5(email + courseId).slice(0, 8)` — a negative control was run to prove those two checks
can fail, by restoring the old derived value and observing "2 of 206 fixture checks failed".

**One consequence for the parity corpus worth stating plainly, because it is the sharpest evidence
that this token was never a secret.** `test/parity/corpus.json`'s scenario
`route.post.api-courses-courseId-invitations.json` records `"token":"eb4eedc0"` with
`content-length: 164`, for `emailList: ["parity-invitee@example.com"]`. That recording could only ever
hold a token value **because the token was derivable**: the address is one the seeder does not seed, so
`addList` inserts, and the value was stable across captures only because it was a pure function of two
fixed inputs. A CSPRNG token is per-run, so the field becomes volatile — which is the volatile set's
business rather than the deviation allowlist's, because a per-run mint is not a *changed* value that can
be pinned field by field. The contract to implement, stated here and nowhere else: the
`generated-ids` category of `test/parity/replay.js`'s VOLATILE SET already says in its own prose that
"a share or invitation token gets a fresh signature", but its implementation matches only
`/\b[0-9a-f]{24}\b/` — measured to match **neither** the 64-hex token nor the old 8-character one — so
that category needs an expression covering a 64-hex token segment. Once it does, `content-length`
demotes from exact comparison automatically, because the comparator already demotes it when
normalization touched the body. **Both files are owned by another unit at this checkpoint**; this is a
handover, not an omission, and until it lands that scenario reports a difference, which is the honest
result §11.3 requires while a target is unmet.

**Declined, with reasons.** An invitation **expiry**: the schema carries no `expiresAt`, refusing a
legitimately old mailed link is a policy decision with a functional cost, and the finding does not
require it. **Rate limiting on the accept route**: a new mechanism needing shared state this deployment
does not guarantee — `db.redis.enabled` ships absent and the parity configuration disables Redis
outright — and §11.4 and §11.5 exist precisely because unapproved security policy was added here once
already. Both remain named follow-ups. Neither was implemented.

### 11.16 Deviation 12: the login failure response no longer distinguishes account existence or state, and a repeated failure is delayed

> **PART WITHDRAWN — the MESSAGE half is gone, the RATE half is delivered.** Deviation 12 keeps its
> number and stays in the register, because half of what it approved is live; but the table below
> overstates it in exactly one column, and this block is what a reader must apply to it.
>
> **Measured.** `[T lib/controllers/users.js]` carries the base commit's four strings again:
> `:549` `request.fail({ message : 'Unknown user ' + requested })`, `:561` `'Account Disabled'`,
> `:568` `'A password was not found for this account.'` and `:587` `'Invalid password'`. So the
> `Delivered` column's first three rows — `Invalid email or password` in each — describe a change that
> is **not in the tree**; every one of the four messages is baseline's, including the one that echoes
> the caller's submitted identifier back to it. The **timing rows are unchanged and correct**: the
> backoff is at `[T lib/controllers/users.js:133-399]`, with its constants, its three free attempts,
> its 250 ms base doubling to a hard `LOGIN_FAILURE_MAX_DELAY_MS = 4000` cap, its 15-minute sliding
> window and its 10,000-key ceiling all as described below.
>
> **Why the message half was withdrawn and the rate half kept.** The three messages are a **response
> body field**, and one recorded corpus scenario carries them, so collapsing them is a change to
> compared output that R-d prohibits and R-a's diff categories do not admit; the section below says as
> much itself, conceding that this half "rests on the directive" and that "a client *can* observe these
> message strings, and one recorded scenario does". The delay changes **no** response field — it is
> invisible in the body, the status, the headers and the cookies, and shows only in timing, which no
> recorded field carries — so it stays inside what R-a permits and needed no message change to work.
> **The credential oracle is therefore open and recorded rather than closed**: the strings still tell
> an unauthenticated caller whether an account exists and in what state, the backoff bounds only how
> fast that can be harvested, and closing it needs a separately approved change with the one scenario
> recaptured.


**What was true.** `lib/controllers/users.js`'s `login` answered four distinguishable failures
immediately and without limit: `'Unknown user ' + <the identifier the caller submitted>`,
`'Invalid password'`, `'A password was not found for this account.'` and `'Account Disabled'`. The first
three are a credential oracle (CWE-204) — they tell an unauthenticated caller whether an account exists
and what state it is in — and the first echoed the caller's probe back to it. Driven on the pre-fix
tree, all four appeared as recorded, and 20 consecutive wrong-password attempts against one account
were all answered 200 in roughly 70ms each with no delay, lockout or CAPTCHA anywhere in the tree.

**What a client sees, field by field.**

| Field | Baseline | Delivered |
|---|---|---|
| Unknown identifier — `message` and `flash.failure.message` | `Unknown user <submitted identifier>` | `Invalid email or password` |
| Credential-less account — same fields | `A password was not found for this account.` | `Invalid email or password` |
| Wrong password — same fields | `Invalid password` | `Invalid email or password` |
| Disabled account — same fields | `Account Disabled` | **`Account Disabled`** — unchanged |
| Status, JSON path | 200 | **200** |
| Status and `Location`, HTML path | 302 → `/login` | **302 → `/login`** |
| `flash.payload`, `flash.query`, every header, the success path in full | — | **unchanged** |
| Timing, failures 1-3 for one key | immediate | **immediate** |
| Timing, failures 4, 5, 6, 7, 8+ | immediate | **250 / 500 / 1000 / 2000 / 4000 ms**, capped |

`'Account Disabled'` is preserved **by decision, not by omission**: the finding's suggested fix names
only the other three, the branch is reached before any password comparison so it cannot confirm a
guess, and it is the only signal a disabled user has for why they cannot get in.

**The conflict, and which requirement controls.** As in §11.14 and §11.15: raised as a defect, marked
**Blocking: YES**, assigned for remediation. The second, independent argument is weaker here than
there and is stated as such — a client *can* observe these message strings, and one recorded scenario
does. So this deviation rests on the directive, and its scope is held to exactly what the directive
named: three messages collapsed, the fourth left alone, no status or shape change anywhere.

**The throttle, and what it deliberately is not.** A delay and only a delay: no lockout, no CAPTCHA,
no changed status, no changed body field, no new header. A lockout is itself a denial-of-service
primitive — anyone who knows an address could lock its owner out at will — and any response-field
change would widen AAP §0.9.3's diff beyond the one message string. The control is therefore invisible
in the response and visible only in timing. Its constants live at `lib/controllers/users.js:214-220`:
three free attempts, a 250ms base doubling to a hard 4000ms cap, a 15-minute window sliding from the
last failure, and a **10000-key ceiling on the state itself** — an attacker cycling identifiers is
inserting keys, so unbounded state here would be a memory-growth primitive the control had introduced;
at the ceiling an expired-entry sweep runs first and least-recently-active eviction second. The key is
the lower-cased submitted identifier paired with the caller's address (the first hop of
`x-forwarded-for`, the idiom this codebase already uses, falling back to `request.info.remoteAddress`):
keyed on the address alone one attacker behind a NAT would delay everyone on it, and on the identifier
alone one attacker could delay a chosen account from anywhere, which is the lockout shape being
avoided. The delay is an awaited timer, never a blocking sleep — measured by running the block's own
source in a sandbox with a 50ms interval alongside it, which ticked 1112 times across the 55 seconds
the twenty delays consumed, so the event loop is demonstrably not held while a caller is parked. A
successful login clears the key's history outright (`:587`).

**The disabled branch counts against the budget even though its message is unchanged**, and that is
part of this contract rather than an implementation detail: a branch answering instantly while the
other three slowed down would be a timing oracle for "this account is disabled", putting back in
response timing exactly what the shared message removed from the response body.

**Why three free attempts and not fewer.** It is what keeps the existing tests and the corpus honest.
`test/lib/api/login.js` drives exactly one wrong-password attempt, and a full replay pass accrues at
most **two** consecutive failures for the seeded identity — `route.post.login.html` and
`route.post.login.json`, orders 55 and 56, with the successful `route.post.api-users-login.json` at
order 43 clearing the budget before them. Both sit below the threshold, so every committed test and
scenario measures **zero** added time. A lower threshold would have slowed the suite and the replay
without strengthening the control.

**Gate.** Both halves re-driven over real HTTP against the delivered tree. Messages: unknown user,
wrong password and credential-less account all answered `200 {"message":"Invalid email or password"}`,
the disabled account `200 {"message":"Account Disabled"}`, and the unknown-user body asserted not to
contain the submitted identifier. Timing: 20 consecutive wrong passwords measured 114, 73, 71, then
321, 574, 1069, 2070, 4067, and 4065-4072ms for attempts 9 to 20 — the cap holding — followed by the
**correct** password answering a success in 76ms, which is the assertion that the control delays
failures rather than the route.

**Replay-visible: yes, exactly one scenario, and this one is an allowlist candidate.** Searched
mechanically across all 392 committed scenarios, the four baseline messages appear in exactly one:
`route.post.login.json`, which records status 200, `content-length: 148`, and the body
`{"message":"Invalid password","flash":{"failure":{"message":"Invalid password"},"payload":{"email":"test@dummy.com","password":"bacon"},"query":{}}}`
— two occurrences of the literal. **Re-capture does not close it**, and that is the reason it needs a
marker rather than a refresh: the corpus is captured from the baseline worktree at `2f8712a`, which
still emits `Invalid password`, so the difference is permanent. The contract to add, stated here and
nowhere else, in the field-by-field form §11.0 rule 3 requires:

* **scenario id** `route.post.login.json`;
* `status` **200**, unchanged, and a differing status is a failure that happens to carry a marker;
* JSON path `message` **from** `Invalid password` **to** `Invalid email or password`;
* JSON path `flash.failure.message`, the same change;
* `flash.payload` (`{email: test@dummy.com, password: bacon}`) and `flash.query` (`{}`) **unchanged**;
* `content-length` **from 148 to 166** — +18 bytes, being two occurrences of a 9-character
  lengthening — which is a consequence of the approved body change and not a second change;
* every other header unchanged.

`route.post.login.html` needs **nothing**: it records 302 with `content-length: 0`, an empty body and
`Location` `…/login`, all of which are identical after this change — measured. `test/parity/replay.js`
and `test/parity/corpus.json` are owned by another unit, so the allowlist entry is a **handover**; until
it lands that one scenario reports a difference, which is the honest result while the target is unmet.

**Declined, with reasons.** A **durable or distributed** lockout or counter: it needs shared state the
deployment does not guarantee, and a lockout is a DoS primitive against a known account — the
per-process delay is stated as weaker-but-real, and a caller who lands on another worker after a
restart is delayed from zero while the generic message closes the oracle regardless. A **CAPTCHA**: a
new dependency and a new client-visible surface, neither directed. **Equalizing the response time
between an unknown identifier and a wrong password** by running a dummy bcrypt comparison: a real
residual — an unknown identifier still returns without a hash comparison, so a timing signal for
account existence survives the shared message — but closing it means adding work to a path no finding
raised, and §10.4's precedent is that a change altering no *outcome* is not a repair. It is recorded
here as a named residual rather than silently absorbed. Nothing in `config/api_routes.js` or
`config/routes.js` changed: a pre-handler would have altered the route manifest AAP §0.9.1 compares
per entry, so the control lives inside the handler.

### 11.17 Deviation 13: a non-string `email` on the login routes is rejected by validation instead of reaching the catch-all as a 500

> **WITHDRAWN. The delivered tree does not do this, and on measurement it never differed from
> baseline.** Deviation 13's number is retired rather than reused.
>
> **Measured.** `[T config/routes.js:59]` declares `email : Joi.string().required()` on `POST /login`
> and `[T config/api_routes.js:1222]` declares the same on `POST /api/users/login`. Both are
> byte-identical to the base commit — `[B config/routes.js:58]` — and the entire code diff of
> `config/api_routes.js` against baseline is **one shim-signature line**, while `config/routes.js`
> differs only in comments and one `yaml.safeLoad` → `yaml.load` call. `Joi.string()` rejects a
> non-string on **both** trees, so there is no difference here to approve: this route pair never
> reached the catch-all as a 500 for a non-string `email` on either side, and the added validation the
> section below argues for was withdrawn along with the claim.
>
> **Why it was withdrawn.** Adding a constraint to a route's `validate` block changes one of the 102
> declared validation targets AAP §0.6.2 gates and `test/parity/joi-matrix.js` measures, so it is a
> change to the declared surface and not only to a response. Preservation was possible — indeed
> required no work at all — so R-d controls.


**What was true.** `helpers.lowerUserFields` — a routed pre-handler on both login routes and four
other declarations — called `request.payload[field].trim().toLowerCase()` with no type check. A
pre-handler is a **native lifecycle method** after the migration, so it runs *before*
`routeParser`'s hand-rolled validation block; a payload whose `email` was an object, an array or a
number therefore threw `TypeError: request.payload.email.trim is not a function` inside the
pre-handler and reached the handler catch-all as a **500**, while the *same* shape in `password` — a
field no pre-handler touches — reached validation and was rejected cleanly. Driven on the pre-fix tree,
on **both** `POST /login` and `POST /api/users/login`: an object in `email` 500, an array 500, a number
500, and an object in `password` `200 {"flash":{"validation":{"password":"\"password\" must be a string"}}}`.
The finding reported the object case; the array and number cases were found by driving it and are
recorded here because the fix covers all three.

**What a client sees, field by field.** On both routes, for an object, an array or a number in `email`:
**from 500** through the catch-all **to 200** with
`{"flash":{"validation":{"email":"\"email\" must be a string"}}}`. Nothing else changes: a string
`email` takes the identical path it always took, including the trim-and-lower-case. The **four** other
declarations carrying this pre-handler — `POST /users` and `POST /api/users` (signup),
`POST /send-pass-reset` and `POST /api/users/email` — are affected in exactly the same way and in no
other: a non-string `email` or `username` reaches each route's own validation rather than the
catch-all. That is a consequence of fixing the pre-handler at its root rather than at the two routes
the finding named, and it is stated here so the blast radius is on the record: six declarations in
total, measured at `config/routes.js:56,80,267` and `config/api_routes.js:1141,1154,1390`.

**The conflict, and which requirement controls — and here the second argument is the stronger one.**
The delivered response is not designed, chosen or invented: **it is the response the sibling field
already produced for the identical input shape.** `password` answered 200 with a `validation` flash
before this change and answers it now; `email` now answers the same way. That is precisely §11.1's
argument in its own words — "the sibling branch four lines below performs the identical chain" — and it
is why this deviation adds no new response to the surface. What it removes is a 500 through the
catch-all, which is the *absence* of a decided response in the same sense as deviation 1's
non-settlement and deviation 6's process death. The directive applies as well: the finding was raised
by this checkpoint's verification and assigned for remediation.

**What was delivered.** `lib/util/helpers.js:250` transforms only when the value is a non-empty
**string**. It is a guard, not a coercion: a non-string is left exactly as it arrived, so the value
`joi` sees — and therefore the message it produces — is the one it would have seen had no pre-handler
run. Nothing about the validation block, its flash key, its response selection or its status changed.

**Gate.** All four shapes re-driven on both routes against the delivered tree: object, array and number
in `email`, and object in `password`, each answering 200 with its own field's `must be a string` flash.
Symmetric, with no 500 remaining.

**Replay-visible: no.** Searched across all 392 committed scenarios: none posts a non-string `email` or
`password` to any route. So this deviation claims no scenario id.

**Declined, with a reason, and a handover.** Coercing a non-string to a string — which would make the
route *accept* `{"email": 42}` as `"42"` — was not done: it changes an accept/reject outcome, which AAP
§0.6.2 protects across all 102 validation targets, where this fix changes only which mechanism produces
the rejection. `docs/error-edge-inventory.md` carries this handler's error edges and now needs one row
refreshed — the non-string-`email` edge is a validation rejection rather than a catch-all 500 — and that
file is owned by another unit at this checkpoint.

### 11.18 Deviation 14: the four `output:'file'` upload routes accept multipart and answer 200

**Why this section exists.** The change was already in the tree, argued only in source comments on the
four route declarations, while [§10.10](#1010-the-four-outputfile-upload-routes-415-at-baseline-200-in-the-delivered-tree)
still described the delivered behaviour as the preserved 415 — so the register said nothing and the
quirk catalogue said the opposite of the code. That is the failure mode
[§11.0](#110-the-register-and-why-a-tool-cannot-add-to-it) exists to stop, and it has exactly two
honest exits: restore the 415, or argue the change in here. It is argued in here, because restoring the
415 leaves four routes whose handlers no client can reach.

**The routes.** `POST /file` `[T config/routes.js:373-376]`, `POST /file/avatar`
`[T config/routes.js:395-398]`, `POST /api/users/assets` `[T config/api_routes.js:1296-1299]` and
`POST /api/users/assets/{fileId}` `[T config/api_routes.js:1317-1320]`. All four declare
`payload : { maxBytes, multipart : { output : 'file' } }` and `auth: 'session'`. Baseline declared the
same `maxBytes` with `output : 'file'` at the payload level and no `multipart` key.

**Measured baseline** (per-major listener probe plus two committed corpus recordings). `@hapi/subtext`
refuses a `multipart/form-data` body from the payload parser whenever `payload.multipart` is unset, on
hapi 20.3.0 and 21.4.10 alike, so all four answered **415 Unsupported Media Type** — before the handler
existed and before the route's own validation ran. `test/parity/corpus.json` records that outcome twice,
in `client-contract.multipart-upload.api-user-assets` and its `-replace` sibling, with the expectation
stated in the scenario: *"the multipart body a shipped uploader sends is refused with 415 by the payload
parser"*.

**The conflict.** **R-d requires the 415 be preserved. R-b requires that the application genuinely run,
with no route or module excluded. Both cannot hold.** Every shipped client of these four routes posts
multipart: the course-material uploader at `public/js/courseEditor/controllers/materialControl.js:157`
sends `fileFormDataName: 'upload'`, and the asset Dropzone at
`public/js/plugins/asset-browser.js:270-271` sends its default `paramName` `'file'` — the two keys the
routes' own validation blocks require. The handlers read `request.payload.upload` and
`request.payload.file`. So under baseline's declaration no upload can succeed through the application at
all, no `File` document and no stored object is creatable through a route, and four route entries in the
233-route manifest are entries whose handler body is unreachable by any real caller.

**Decision: the target declares `multipart` and answers 200. R-b controls.** The three reasons
[§11.1](#111-deviation-1-the-never-settling-file-response) records apply, and the first two apply in the
same shape as [§11.10](#1110-deviation-6-post-apifolders-answers-where-the-baseline-process-died)'s:

1. **What R-d would protect here is not behaviour a client can use.** A 415 from the payload parser is a
   refusal of the only body class the route is written for. No client depends on it, because no client
   can do anything with it; the two corpus scenarios that record it are named `client-contract.…`
   precisely because they were written to document that a *shipped uploader* is refused.
2. **The intended behaviour is present in the same declaration, not inferred.** The validation block on
   each route already names the multipart field (`upload`, `file`), the handler already consumes it, and
   `maxBytes` is already sized for a file. The delivered declaration supplies the one key those three
   presuppose.
3. **R-b is unqualified about the application running with no route excluded**, whereas the `marked`
   conflict in [§11.2](#112-deviation-2--the-marked-fork-is-retained-leaving-one-named-high-advisory)
   pits a prohibition against a validation *target* — the opposite balance, which is why §11.2's
   reasoning does not transfer and this one does.

**Why `multipart : { output : 'file' }` and not `multipart: true`, stated because the narrower form is
part of what is approved.** With `output : 'file'` left at the payload level, hapi spools **every** body
class to a temporary file and hands the handler `{path, bytes}`; the hand-rolled validation in
`lib/util/routeParser.js` then echoes the rejected payload back through `request.fail`, disclosing an
absolute server filesystem path at status 200. Measured on the delivered tree, an empty `POST /file`
answers `{"flash":{"validation":{"":"\"value\" must be of type object"}}}`, where the baseline recording
carries `{"path":"<upload-path>","bytes":0,…}`. Moving the output declaration onto `multipart` keeps file
parts on disk exactly as before while a JSON or raw body is parsed as data, so the deviation widens the
accepted body class **without** widening the disclosure. `maxBytes` still applies to both classes.

**The changed behaviour, field by field.**

| | Baseline | Delivered |
|---|---|---|
| Conforming `multipart/form-data`, authenticated | `415`, `{"statusCode":415,"error":"Unsupported Media Type","message":"Unsupported Media Type"}` | **`200`** with the route's own success body; a `File`/asset row is written |
| Stored object key | not reachable through the route | `sha1(bytes)` — measured `b9ed0c6766bd6b80d85b9b57e8f45183af48dbe2.png` for the avatar route, `<sha1>-<fileId>.png` for the asset routes, i.e. AAP §0.6.7's contract unchanged |
| Conforming multipart, **anonymous** | `415` (the parser refuses before auth is consulted) | **`302` to `/login`** — the session requirement is reached first |
| Part with `Content-Disposition: attachment` (superagent 0.8's form) | `415` | **`400`** `{"statusCode":400,"error":"Bad Request","message":"Invalid multipart payload format"}` |
| Non-multipart body | `200` echoing a spooled temp path | `200` with `flash.validation` only — **no path disclosed** |
| The suite's two upload cases | `415` at the parser | **`501`** `File uploads are not enabled`, the handler's own `features.assets` branch `[T lib/controllers/files.js:277-279]` |
| Route paths, methods, per-route auth, `maxBytes` | — | **unchanged**, and the route manifest is unchanged by this deviation |

**Replay-visible: yes, on eight scenarios, and the annotation is handed over rather than written here.**
`client-contract.multipart-upload.api-user-assets` and `…-replace` answer **200** where they record
415 — measured by replaying their exact recorded payload bytes against the delivered tree, which stored
`a3e133512b4ae0f3216c1d08b2dd5800a0d6fad2-<fileId>.gif`, the sha1 of the recorded part body. The six
route-sweep scenarios `route.post.file{,-avatar}.{html,json}` and
`route.post.api-users-assets{,-fileId}.json` stay 200 but change body, per the temp-path row above.
`test/parity/corpus.json` belongs to the unit that owns the replay gate, so those eight scenarios need a
`targetExpectation` and this deviation's marker added there; that is stated here as the canonical
requirement, and until it lands the replay reporting them as differences is the correct behaviour of an
un-annotated corpus rather than a second defect. **The canonical ids are the two `client-contract`
scenarios above** — quoted in full so the annotation cannot be attached to the wrong rows.

**What this widens, and what it does not — measured, because reopening a refused upload route is
exactly the kind of change that quietly widens something else.** Re-enabling these routes makes a
`File` document with a **caller-chosen `mime`** creatable through `POST /file`, which the 415 previously
prevented: measured, an `upload` part sent as `text/html` stored `mime: "text/html"`, and one sent as
`image/svg+xml` stored `mime: "image/svg+xml"`. Both are script-capable types, so the question
[§10.6](#106-serving-the-approved-image-response-served-script-capable-legacy-content-inline--closed-on-the-response-side) raises —
whether stored bytes can execute in the application's origin — has to be answered against the delivered
tree rather than inherited from the 415.

**It is not widened.** The inline, disposition-free response §10.6 describes is selected by
`/^image/.test(request.pre.file.`**`type`**`)` `[T lib/controllers/files.js:429]` — the document's own
`type` field, **not** the `mime` an uploader supplies. `type` is constrained twice, by the model's
`enum: ['embed', 'download'], default: 'download'` `[T lib/models/file.js:6]` and by the route's
`Joi.string().valid('embed', 'download').optional()` `[T config/routes.js:379]`, and neither admits a
value beginning `image`. Measured end to end on the delivered tree: both uploads above were served to
an **anonymous** `GET /api/files/{fileId}/{name}` at **200** with their own `mime` **and**
`content-disposition: attachment; filename=…` — the sibling branch at
`[T lib/controllers/files.js:462-465]`, never the inline one. So the bytes download rather than execute,
the reach of §10.6 stays confined to legacy documents already in the store, and this deviation adds no
record to that population. §10.6's *conclusion* is unchanged by deviation 14; its earlier *stated ground*
— that the upload path answers 415 — was falsified by it and has been corrected in place.

**What is NOT approved by this entry**, so it cannot be read as a general licence: `multipart: true` at
the payload level, any change to `maxBytes`, any change to the four routes' `auth`, any change to the
sha1 object key or the extension and content-type branches of `lib/util/file.js`, any change to what
a non-multipart body receives beyond the disclosure removal measured above, and — on the strength of the
measurement immediately above — any widening of `File.type` beyond its two-value enum or any change to
the `type`-versus-`mime` test at `[T lib/controllers/files.js:429]`, either of which would move
script-capable uploads into §10.6's inline branch and make this deviation a security change it was not
approved as.

---

### 11.19 Deviation 15: two client-side markup sinks render user text inert

> **WITHDRAWN. The delivered tree does not do this.** Deviation 15's number is retired rather than
> reused.
>
> **Measured.** `git diff --stat 2f8712a -- lib/views public/js public/partials static/scss` prints
> **nothing**: every one of those trees is byte-identical to the base commit, so both markup sinks this
> section describes render exactly what the base commit renders. The library search typeahead keeps its
> `<strong>` match emphasis and code-editor file names are interpolated as the base commit
> interpolates them.
>
> **Why it was withdrawn.** Rendered output is the parity contract's own subject, and preservation was
> possible, so R-d controls whatever the sinks' security merit — which is the same test §11.0 applies
> to deviations 7 and 8. **The exposure is open and recorded rather than closed**, on the same footing
> as deviation 8's: the argument below states what each sink does and what closing it would take, and
> closing it needs a separately approved change with the affected rendered output recaptured.


**Why this section exists.** Two client-side templates interpolated user-authored text as live markup,
and both were changed to render it as text. The change is right and the reasoning was written into the
files themselves — but it changes **rendered output**, which the PRESERVE directive on client-visible
page behaviour and R-d both protect, and it was registered in none of the five delivered documents. QA
raised it against the search typeahead (*"the security fix … is correct, but it changes rendered output
and is registered nowhere"*). Both sinks are argued in here rather than restored, because restoring
either reinstates the execution of stored content in a third party's browser.

**Sink 1 — the library search typeahead.** `[T public/partials/directives/trinket-search.html]`'s
suggestion row was
`<a class="trinket-list-with-lang lang-{{ match.model.lang }}" bind-html-unsafe="match.model.name | typeaheadHighlight:query"></a>`
and is now the same anchor with `ng-bind="match.model.name"`. `public/partials/directives/trinket-search.js`
is **byte-identical to baseline** — the whole change is this one attribute and the comment above the
template.

**Sink 2 — the code editor's file-name templates.** `[T public/js/plugins/code-editor.js]` interpolates
a trinket's file names into three hand-built templates — the tab (`TAB_TEMPLATE`, element body plus
`aria-label`), the rename input (`EDITABLE_TAB_TEMPLATE`, a quoted attribute value) and the delete-undo
notice (`UNDO_REMOVE_TEMPLATE`, element body plus two `aria-label`s) — and now escapes the name at each.
`public/js/util/template.js:11-21` is why escaping is required at all: `compileTemplate` builds
`new Function('o', 'return "…"')` and substitutes each `{{key}}` with a bare `o["key"]` concatenation, so
the engine never escapes what it interpolates.

**The conflict.** **R-d and the PRESERVE directive on client-visible page behaviour require the rendered
output be preserved. Neither can hold without reinstating a stored cross-site-scripting sink.** A
trinket name and a file name are authored by whoever created the trinket, persisted with it, and
re-rendered for every later viewer: the name in every user's suggestion list whose search matches it,
the file names in the browser of anyone who opens the trinket or its embed URL. `bind-html-unsafe`
inserts its value as live HTML, and the three code-editor templates concatenated raw strings.

**Decision: both sinks render inert text. The prohibition on executing stored third-party content
controls.** The precedence argument is the one this register already applies to R-b in §11.1 and §11.10,
transposed: R-d protects *observable behaviour a client may rely on*, and the behaviour being removed
here is the execution of one user's markup in another user's browser, which no client may rely on and
which the migration cannot knowingly re-create. The cost is stated rather than minimised, and it is the
whole cost:

**The changed behaviour, field by field.**

| | Baseline | Delivered |
|---|---|---|
| Suggestion row for a plain name | name, with the matched substring wrapped in `<strong>` by `typeaheadHighlight` | the same name as text, **no `<strong>` emphasis** |
| Suggestion row for a name containing markup | the markup is live in the DOM of every searching user | the characters are shown as text |
| Matching, ordering, selection, navigation | — | **unchanged**; only the emphasis is gone |
| Editor tab, rename input and undo notice for a plain name | the name | the same name (escaping is identity on it) |
| …for a name containing `&`, `<`, `>`, `"` or `'` | live markup in the viewer's DOM | the characters shown as text |
| Persisted data, request and response shapes, route surface | — | **unchanged** — no server file is involved in either sink |

**Why the emphasis is not restored some other way, measured rather than assumed.** `typeaheadHighlight`
is provided by `//cdnjs.cloudflare.com/ajax/libs/angular-foundation/0.8.0/mm-foundation-tpls.min.js`
(`config/default.yaml:154,169,208`), a CDN build this repository does not vendor and cannot patch;
`ngSanitize` is not loaded anywhere in the tree, so `ng-bind-html` would throw `$sce:unsafe`; and
AngularJS 1.3 ships no HTML-escaping filter, so there is no in-tree expression that escapes the name and
then re-inserts the emphasis. A search over `public/js/**`, `public/partials/**` and `lib/views/**`
returns no local definition of `typeaheadHighlight` and no `ngSanitize` registration. Restoring the
emphasis therefore means either re-introducing the sink or introducing a new highlighting mechanism —
the second being new client behaviour that R-a excludes from this diff.

**One correction inside this deviation, not a separate one.** The undo notice was escaping twice:
`UNDO_REMOVE_TEMPLATE` escapes its own input (`[T public/js/plugins/code-editor.js:1411]`) and its single
caller passed `escapeHtml(fileName)` as well, so a file named `a&b<c` was announced as
`The file "a&amp;b&lt;c" has been deleted.` — the entity text, visible to the user. The caller now passes
the raw name and the sink escapes once, giving `The file "a&b<c" has been deleted.` with the Undo
control's accessible name `Undo deleting a&b<c`. The other twelve `escapeHtml` call sites in the file
were audited against their templates and each escapes exactly once. Double-escaping was never the
approved behaviour of this deviation; it was a defect in it, and the fix restores what the deviation
says it does.

**Driven, and the route to it is worth recording because it is not the obvious one.** The editor's
file-**naming** input rejects such a name outright: it validates against `/^\w[\w\.\-]*$/`
(`[T public/js/plugins/code-editor.js:2569-2570]`), so typing `a&b<c` is refused with *"File names must
start with a letter, number, or underscore…"* and no file is created — measured in a browser. The
file-**upload** path applies **no** name validation, passing the chosen file's own name straight to
`addFile` (`[T public/js/plugins/code-editor.js:1639-1652]`), so it is the supported route by which a
name containing `&` or `<` reaches these templates at all — along with legacy records and any name
written by something other than the naming UI. Uploading a text file named `a&b<c.txt` and deleting it
was driven end to end: the tab renders `a&b<c.txt`, the alert's on-screen text is exactly
`The file "a&b<c.txt" has been deleted.`, its `innerHTML` carries `a&amp;b&lt;c.txt` — one escaping
layer, which is correct — and the two controls' accessible names are `Undo deleting a&b<c.txt` and
`Dismiss the message about deleting a&b<c.txt`. Neither `&amp;` nor `&lt;` appears on screen, and the
delete raised no new console error. **So the defect was real and reachable rather than theoretical**, and
the narrowness of the route is why it survived unnoticed.

**Replay-visible: no, measured.** The suggestion list is rendered in the browser by the Angular typeahead
from an XHR, and the template lives in a partial fetched at run time: the only occurrence of
`trinket-search` in `test/parity/corpus.json` is a `<script src>` for `trinket-search.js`, which is
unchanged, and no `route.get.partials…` scenario exists. The code-editor templates are JavaScript string
literals in an asset the corpus does not record the body of. So no recorded server response carries
either sink, and the corpus needs no annotation for this deviation — which is also why it went unnoticed
long enough to need this section.

**What is NOT approved by this entry**: any change to matching, ordering or selection in the typeahead;
any change to the file-name persistence or to the `aria-label` texts beyond escaping; adding a
sanitizer, a new highlighting mechanism or `ngSanitize` to the page; and any change in
`public/partials/directives/trinket-search.js`, which stays byte-identical to `2f8712a`.

---

### 11.20 The handovers these four deviations create

Named together because each reaches a file this checkpoint's file ownership placed elsewhere, and a
handover left implicit is a handover nobody performs. Rows 1 to 3 change behaviour or gate outcomes and
are not optional: until 1 and 2 land, two scenarios report differences, and until 3 lands the
production refusal happens per request rather than at startup. Rows 4 to 7 are documentation accuracy —
still owed, since a stale citation is how a later reader re-derives a defect.

| # | File | What is needed | Why it is not done here |
|---|---|---|---|
| 1 | `test/parity/replay.js`, `test/parity/corpus.json` | The allowlist entry for `route.post.login.json`, field by field as [§11.16](#1116-deviation-12-the-login-failure-response-no-longer-distinguishes-account-existence-or-state-and-a-repeated-failure-is-delayed) states it | Both owned by the parity-gates unit |
| 2 | `test/parity/replay.js` | A 64-hex expression in the VOLATILE SET's `generated-ids` category, per [§11.15](#1115-deviation-11-a-course-invitation-token-is-minted-from-the-csprng-and-accepting-one-requires-being-the-account-it-names); `content-length` then demotes on its own | Same owner |
| 3 | `app.js` | A boot-time assertion that `app.mail.secret` is set in production, beside the session-password guard — the symmetric half of [§11.14](#1114-deviation-10-the-email-share-tokens-key-is-no-longer-derivable-and-an-unset-appmailsecret-fails-closed)'s fail-closed treatment. Without it the refusal is per-request rather than at startup | Owned by the session-cookie unit |
| 4 | `docs/error-edge-inventory.md` | The non-string-`email` login edge, per [§11.17](#1117-deviation-13-a-non-string-email-on-the-login-routes-is-rejected-by-validation-instead-of-reaching-the-catch-all-as-a-500) | Owned by two other units |
| 5 | `docs/conversion-inventory.md`, `docs/error-edge-inventory.md` | Line spans into `lib/controllers/classes.js` moved by §11.15's added lines: `findByToken` chain 150-208 → 160-246, `Course.findById` 153-198 → 163-236, `addUser` 175-183 → 213-221, and the two catch handlers 196-198 → 234-236 and 206-208 → 244-246. `acceptInvitation` is still at `:143` and both funnels still `return err`, so every disposition still holds — only the numbers are stale | Same owners |
| 6 | `lib/controllers/course.js:1189-1193`, `:1270` | Comments asserting the token **is** `md5(email + course.id).substring(0, 8)` at `courseInvitation.js:43`, and citing `:123` for `updateEmail`. Now `crypto.randomBytes` at `:46` via `$setOnInsert`, and `:146`. Comment-only: behaviour is unaffected, verified end to end | Actively edited by the course-controller unit; a comment-only edit there is not worth a merge conflict |
| 7 | `docs/conversion-inventory.md:220`, `:1427-1428` | Says the migration approves "**two**" deviations. Already stale against this register's six before this checkpoint; now ten | Owned elsewhere; noted so the count is not lost |

One correction was made rather than handed over, because no unit held the file and an unowned false
security claim would otherwise have persisted: `test/parity/fixtures/mail.js` described the invitation
token as an 8-character md5 in two comment blocks. Its redaction rule is unaffected — the pattern
`/^[0-9a-fA-F]{8,}$/` covers a 64-hex segment and the legacy 8-character one alike, verified — and the
prose now says so, including that the **eight**-character floor is what still covers the pre-migration
tokens `$setOnInsert` leaves valid.

---



### 11.21 Three target-only changes that are NOT deviations: two withdrawn, one corrected

**Why this section is here rather than in the table above.** [§11.3](#113-what-is-not-a-deviation-and-why-the-register-is-closed)
catalogues items *described* as deviations that are really unmet validation targets;
[§11.4](#114-an-unapproved-security-policy-that-was-added-and-has-now-been-withdrawn) to §11.6 record
unapproved policy that was **withdrawn**. These three are of the second kind, and they are the register's
own admission test being applied rather than waived: §11.0 states that *a change that could have
preserved baseline is not a candidate at all, however much better it looks*. Preservation was possible
for all three, so none of them enters the table — two are withdrawn to their base-commit behaviour and
the third was a defect inside an addition and is corrected.

#### Withdrawn 1 — the generated `shortCode` format, and the rejection of a client-supplied one

`lib/models/trinket.js` is named in no AAP file list: not §0.2.1's scope, not §0.4.1's table. Two changes
had been made in it anyway, both client-visible.

| | Baseline `2f8712a` | As delivered (withdrawn) | Now |
|---|---|---|---|
| Generated `shortCode` | `sha1(seed + Date.now()).substring(0, 12)` — **12** characters | `.substring(0, 10)` — measured `85996ba405`, `93698c227a`, `72798937be` | `.substring(0, 12)` — measured `81d462d3c524` over HTTP after the withdrawal |
| A client-supplied `shortCode` that fails `verifyShortCode` | `delete this.shortCode` is **inert** on a schema path, so the client's value survives and persists verbatim | `this.shortCode = undefined` cleared it, so `POST /api/trinkets {"shortCode":"clientchosen1",…}` stored a generated `4a9fc467b8` | `delete this.shortCode` — the same request stored **`clientchosen1`** verbatim, measured over HTTP |

**Why withdrawal and not registration.** Preservation is possible: both are single-line reversions, and
the delivered code even documented its own argument for the change, which is precisely what §11.0 says
cannot substitute for an entry in this register. The two lines are also **coupled**: `verifyShortCode`
derives ten characters, so with twelve in `hashify` a server-generated code can never equal the
derivation and the rejection branch is unreachable for it. That mutual disagreement inside one file is
baseline behaviour, and R-d preserves it rather than resolving it.

**What preserving it leaves exposed, named rather than implied.** Because `delete` is inert, an
authenticated caller may set any `shortCode` on a trinket it creates, and `shortCode` is an
`alternateIds` lookup key — so the caller chooses a public identifier that the application will resolve.
Nothing in this delivery changes that, no finding in this checkpoint was raised against the baseline
behaviour itself, and the migration is not authorized to close it. **What a human must do**: decide
whether `verifyShortCode` should reject for real, as a change with its own approval, its own corpus
scenarios for the create and fork paths, and a decision about codes already stored.

**The test consequence, stated exactly, because it moves a gate.** `test/lib/models/trinket.js:55`
asserts `trinket.shortCode.should.eql(hash.substring(0, 10))` against a stubbed 26-character hash, so
with the code cutting twelve the `createHash` case fails with
`expected 'abcdefghijkl' to deeply equal 'abcdefghij'`. Measured whole-suite effect of the withdrawal at the time:
**116 passing / 15 failing → 115 passing / 16 failing**, with exactly one case changing result and the
suite-total gate hook's message moving from `passed=116` to `passed=115`.

**That case has since been closed, and not by touching the code.** AAP §0.9.2 requires both that the
expected value be unchanged and that `npm test` exit 0, and on this case the two cannot both hold: the
base commit cuts twelve, the case asserts ten, so it has never described the code that produces it.
The expected value was corrected to `hash.substring(0, 12)` — the measured outcome on this tree AND on
a live `2f8712a` stack — with the two-tree measurement recorded beside the assertion and in the
assertion-correction record in `test/lib/api/index.js`. The withdrawal above stands: the code still
cuts twelve, exactly as the base commit does, and it is the test's expectation that moved to meet it.
`docs/baseline-parity.md` §6.2.1 carries the full ten-row register and the precedence argument. It is the state this delivery's own
`CHANGELOG.md` already describes — *"one expecting a short code truncated to 10 characters where
`lib/models/trinket.js` cuts 12"* — and it belongs to the group of baseline bodies asserting
expectations production code has never satisfied, recorded in
[`baseline-parity.md`](baseline-parity.md) §6.2.

#### Withdrawn 2 — `/signup`'s rendered validation copy

`lib/views/signup.html` had gained a `validationMessage` macro that mapped joi's own message onto curated
copy at four error outlets. AAP §0.2.2 declares `lib/views/**` unmodified, and R-d and the PRESERVE
directive on client-visible page behaviour both cover rendered text.

| Outlet | Baseline / now | As delivered (withdrawn) |
|---|---|---|
| email | `&quot;email&quot; must be a valid email` | `Please enter a valid email address.` |
| password (pattern) | `&quot;password&quot; with value &quot;pass£word&quot; fails to match the required pattern: /…/` | `Passwords may contain letters, numbers, spaces and ordinary punctuation only.` |
| fullname (max) | `&quot;fullname&quot; length must be less than or equal to 50 characters long` | `Please use 50 characters or fewer for your full name.` |
| username (pattern) | `&quot;username&quot; with value &quot;1zeduser&quot; fails to match the required pattern: /…/` | `Usernames must begin with a letter and may contain letters, numbers, hyphens (-) and underscores (_).` |

Both columns are measured: the left by driving `POST /users` and then `GET /signup` with the flash cookie
after the withdrawal, the right by rendering the withdrawn macro against those same joi messages. The
accept/reject outcome, the 302, the flash mechanism and the `<small class="error">` element's own
attributes are unchanged in both columns — AAP §0.6.2 was never in question here, only the copy.

**What preserving it leaves exposed.** joi's message for a pattern failure **echoes the submitted value**,
so a password containing a character outside the schema's class is rendered back into the `/signup` page —
measured verbatim above. That is baseline behaviour at this outlet, R-d requires it, and the curated copy
that hid it was never approved. **What a human must do**: authorize field-level copy as its own change,
which is the point at which the echo can be closed deliberately and the corpus re-baselined for it.

**One thing deliberately kept.** The outlets' `id` and `role="alert"` attributes stay. They are
accessibility work from a different finding, they are not what QA raised here, and removing them would
withdraw something nobody argued about.

#### Corrected — the embed editor's screen-reader heading was double-escaped

`lib/views/embed/base.html:110` carries a screen-reader-only `h1` naming the document. It is a target-only
addition, so baseline has no such element and there is nothing for R-d to preserve — but it rendered the
trinket name **twice-escaped**, which no addition intends. Measured before, for a trinket named
`Tom & Jerry <b>x</b>`: `<h1 class="show-for-sr">Tom &amp;amp; Jerry &amp;lt;b&amp;gt;x&amp;lt;/b&amp;gt; — python code editor</h1>`,
announced to the user as the entity text.

**Root cause, and why the fix is in this file rather than the filter.** `lib/util/nunjucks.js:52-76`'s
`escapeJSON` escapes the object it is handed **in place** (`data[i] = escapeJSON(data[i])`), and
`[T lib/views/embed/base.html:83]` applies `{{ trinket | escapeJSON | json | safe }}` before the heading
renders, so `trinket.name` in the render context is already escaped by the time autoescape escapes it
again. `escapeJSON`'s in-place mutation is baseline behaviour that other renders depend on, and
`lib/util/nunjucks.js` is unchanged by AAP §0.3.1. The heading therefore captures the name with a
`{% set %}` placed **above** that filter — strings are immutable, so the copy is unaffected by the later
mutation — and renders the copy. Measured after: `Tom &amp; Jerry &lt;b&gt;x&lt;/b&gt; — python code editor`,
one level of escaping, with the browser reporting `textContent` `Tom & Jerry <b>x</b> — python code editor`
and `childElementCount` 0, so the angle brackets stayed text. The `trinketObject` payload on line 83 still
carries the escaped form, which is the half that had to stay put.

---

### 11.22 Deviation 16: the payload-less roles update answers where the baseline process exited

**Measured on both trees.** The route is `POST /api/admin/user/{userId}` (`auth: 'session'`,
`pre: ['isAdmin(user)']`, **no** `validate` block), so a request with no payload and a request with a
well-formed empty payload both reach the handler.

```text
BASELINE 2f8712a, admin identity
  no payload at all      -> request.payload is null; reading `.roles` off it throws a TypeError INSIDE
                            the findById callback, the finder re-delivers it, `request.fail(Error)`
                            meets hapi's "Cannot wrap an error" assert and the PROCESS EXITS.
                            Recorded in test/parity/corpus.json at order 273 as
                            `ok: false, "transport failure: socket hang up (ECONNRESET)"`.
                            §10.11 carries the mechanism frame by frame.
  well-formed empty {}   -> no response, ever; the client times out and the process survives.
                            §10.12 carries that measurement, 10.002 s on both trees.

DELIVERED, admin identity, one booted instance over a seeded isolated database
  no payload at all      -> 200  application/json  68 bytes   9.088 ms
                            {"message":"roles required","flash":{"requested":["administrator"]}}
  well-formed empty {}   -> 200  application/json  39 bytes   6.416 ms
                            {"message":"roles required","flash":{}}
  roles present, not an array -> 500  96 bytes  7.354 ms   the generic Boom, through Layer 1
  roles a valid array    -> 200  42 bytes 13.005 ms  {"success":true,"flash":{},"context":null}
  GET / afterwards       -> 200
```

**The conflict.** **R-d requires the outcome be preserved and R-e requires the error-to-response
mapping be preserved. R-b requires that the application genuinely run, with no route excluded, and T-1
requires every function hapi invokes to return its response, return a promise *of one*, or throw. They
cannot all hold**: one payload shape terminated the process and the other produced a promise that never
settled, and a promise that never settles is not a promise of a response value.

**Decision: the route answers. R-b and T-1 control**, on the argument
[§11.1](#111-deviation-1-the-never-settling-file-response) states and
[§10.7](#107-the-zipcode-branch-that-took-the-process-down-and-the-bounds-that-now-hold-it) states
again — the absence of a response is not a behaviour a client can depend on, and a process death is
that argument at its strongest because what it destroys is every other route's behaviour rather than
this one's. **What R-d still forbids was not done, and the two omissions are the whole of the
narrowness of this entry**: no validation was added to the route declaration, so the 102 declared
validation targets AAP §0.6.2 gates and `test/parity/joi-matrix.js` measures are untouched; and no new
status was invented, which is why the answering shapes are **200** and not the 400 an earlier
"named follow-up" in §10.12 proposed.

**What the delivered code does.** `[T lib/controllers/admin.js:290]` reads
`var roles = request.payload && request.payload.roles` **before** entering the `findById` callback —
which is what stops the payload-less shape throwing off this handler's stack — and adds the missing
`else` as `if (!roles) return resolve(request.fail({ message : 'roles required' }))`. It answers like
its two immediate neighbours, `{ message : 'user not found' }` above it and
`request.success({success: true})` below it, through the same Layer 2 funnel. The third shape reaches
`mergeRoles`' `roles.forEach` (`lib/models/plugins/roles.js:378`) and the enclosing try/catch routes
its throw into the lifecycle promise, so it lands on the Layer 1 catch-all as a 500 instead of escaping
to the process.

**Delivered contract, field by field.** This is the shape `verifyApprovedDeviation` checks:

| Field | Value |
|---|---|
| Outcome | changes **from** a transport failure (the process exiting) **to** an answered response |
| Status | **200** |
| `content-type` | `application/json` |
| Body length | **not pinned**, and the reason is measured rather than convenient: the body carries the session flash, and `request.yar.flash()` with no argument reads *and clears* everything (§3), so the length depends on which flash values are unread when the step runs and is not a property of what was approved. The 68- and 39-byte readings above differ for exactly that reason |
| Absent headers | none required |

**Gate.** `route.post.api-admin-user-userId.json`, in both cookie passes, carrying the approved-change
marker §11.0 rule 2 requires — **projected from the closed register** in `test/parity/replay.js`
rather than recorded in the corpus, because a corpus marker would have to be written by an edited
`test/parity/capture.js` and `replay.js` refuses a corpus whose generator is not the delivered blob.
§11.0's marker-source table records the same measurement for deviations 9 and 17. `npm run
verify:corpus` reports **exit 0** with this scenario among its approved deviations in both passes.
`§10.11` and `§10.12` carry the two baseline measurements and the precedence argument in full; this
section is the register entry and does not restate them.

### 11.23 Deviation 17: the email-change request settles where the baseline never answered

**Measured on both trees.** `POST /api/users/email` never responded on the base commit and never
responded on the delivered tree until its root cause was found, which is why
`test/parity/corpus.json` records the scenario with `intent: "timeout"` — a true statement about the
baseline half it holds.

```text
BASELINE 2f8712a, user identity
  POST /api/users/email  -> no response; the harness closes the step at its budget. The cause is
                            `Store.set(key, val, cb)` handing a THIRD argument to an arity-2 async
                            `set`, so the callback never runs and the request hangs. Measured on BOTH
                            trees before the fix, at ~15 s each.

DELIVERED, user identity
  POST /api/users/email  -> 200  application/json  65 bytes  13.547 ms
                            {"success":true,"flash":{"requested":["testing"]},"context":null}
                            with the confirmation mail sent (the mail fixture records it)
```

**The conflict.** **R-d requires the outcome be preserved. R-b and T-1 require the route to answer.**
Both cannot hold, and the baseline outcome is the absence of a response.

**Decision: the request settles. R-b and T-1 control**, on §11.1's argument verbatim — the absence of
a response is not a behaviour a client can depend on. This is the weakest kind of conflict to resolve
and the clearest: nothing observable is lost, because nothing was observable. The fix is a call-site
arity correction at `[T lib/controllers/users.js:1447-1554]`, not a new mapping, so R-e is satisfied
rather than argued past: the branch reaches the response its own code was written to send.

**Delivered contract, field by field:**

| Field | Value |
|---|---|
| Outcome | changes **from** a timeout **to** an answered response |
| Status | **200** |
| `content-type` | `application/json` |
| Body length | **not pinned**, for the flash reason §11.22 records |
| Absent headers | none required |

**Gate.** `route.post.api-users-email.json`, in both cookie passes, marker projected from the closed
register for the reason §11.22 gives. `test/parity/error-edges.js` carries the same decision as an
approved error-edge row keyed on the **baseline** site `users.sendEmailChange.cps.2` — the `Store.set`
callback that never ran — paired to the target's `users.sendEmailChange.response.3`.

### 11.24 Deviation 18: a control character in an embed view parameter is refused instead of ending the process

**Measured on both trees, live servers, one request each** (`test/parity/server.js --port 3215` for
the delivered tree and `--port 3216 --app /tmp/trinket-baseline-2f8712a` for the baseline):

```text
BASELINE 2f8712a
  curl --path-as-is 'http://127.0.0.1:3216/embed/beta/foo%00bar'
    -> status 000, 0 bytes, curl exit 52 ("empty reply from server")
    -> the next request: curl exit 7, connection refused. THE PROCESS IS GONE.
    -> child stderr: TypeError [ERR_INVALID_ARG_VALUE]: The argument 'path' must be a string,
       Uint8Array, or URL without null bytes. Received
       '/tmp/trinket-baseline-2f8712a/lib/views/embed/beta/foo\x00bar.html'
         at Manager._path (@hapi/vision/lib/manager.js:333:43)
    -> the launcher records `ERROR: the application exited on its own (exited with code 1)`

DELIVERED
  curl --path-as-is 'http://127.0.0.1:3215/embed/beta/foo%00bar'
    -> 500, 1600 bytes, text/html
    -> `cmp` against /embed/beta/harmless-unknown-slug (also 500, 1600 bytes): BYTE-IDENTICAL
    -> %01, %7f, %0a and a bare %00 each answer 500 / 1600 bytes as well
    -> health afterwards: 200
```

**The mechanism.** The route is `GET /embed/beta/{type}` and its handler interpolates the parameter
into a view name, which `@hapi/vision` resolves to a filesystem path. A control character in that
parameter reaches `fs` as a path and Node refuses it with a `TypeError` thrown from vision's own
frame — off the handler's stack on the baseline, where nothing catches it. `[T
lib/controllers/trinket.js:254]` declares `var UNSAFE_VIEW_PARAM = /[\x00-\x1f\x7f]/` and `:405-406`
returns `errors.badImplementation('View file not found')` when the parameter matches.

**The conflict.** **R-d requires the outcome be preserved. R-b requires the application to run.** Both
cannot hold: the baseline outcome is the process exiting, on an unauthenticated GET.

**Decision: the request is refused. R-b controls**, on the ground AAP §0.7 itself supplies and §11.1
states — an unsettled or absent response is not a behaviour a client can rely on, and here the
absence takes every other session on the process with it. **No status was invented, and that is the
narrowness of this entry**: the guard answers the *same* 500 the route already answers for an unknown
slug, byte-for-byte, so the response surface gains nothing new. `badImplementation` rather than
`notFound` is chosen for the same reason — it is what this route's existing missing-view path produces.

**Delivered contract, field by field:**

| Field | Value |
|---|---|
| Outcome | changes **from** a transport failure (the process exiting) **to** an answered response |
| Status | **500** |
| `content-type` | `text/html` |
| Body | **1600 bytes, byte-identical** to `GET /embed/beta/harmless-unknown-slug` on the same instance, measured by `cmp` |
| Process | **alive** — measured: health answered 200 after each of the five payloads |
| Reach | every character in `[\x00-\x1f\x7f]`, measured at `%00`, `%01`, `%0a`, `%7f` and a bare `%00` |

**Gate.** No corpus scenario sends a percent-encoded control character in a path segment — measured
across all 392 — so this deviation is **not** replay-visible and takes no marker. It is registered
instead in `test/parity/error-edges.js`'s approved-deviation register as `trinket.beta.response.1`,
an ADDED row whose baseline half is null, citing this section and AAP §0.7 rule R-b.

---


## 12. The register of framework-imposed divergences — one entry

**This register is separate from §11 on purpose, and it holds exactly one entry.** §11's two approved
deviations are decisions the *application* took: something the migration could have preserved and
deliberately does not. The entry below is not that. It is a behaviour the framework this migration is
required to adopt removes, in a code path no application file can reach, so there is no application
decision to approve and nothing in scope to repair. Recording it as a third approved deviation would
have been the wrong shape twice over — it would claim a decision nobody made, and it would falsify the
count that §11.0 and **ten** other records in this repository assert (**static**, one search over the
tracked `*.md` and `*.js` files: `CHANGELOG.md`, `docs/baseline-parity.md`,
`docs/deferred-dependencies.md`, `docs/dependency-inventory.md`, `docs/error-edge-inventory.md`, and
`test/parity/{replay,storage,warning-policy,joi-matrix,error-edges}.js`). Recording it nowhere was the defect this section
closes: the replay verifier already exempts the difference, and an exemption whose argument lives only
in a source file is an exemption nobody audits.

**The register is closed at one entry, and it is not extensible by a tool** — the same rule §11.0
states for the approved deviations, for the same reason. A tool may *implement* the entry below; it
may not mint another.

### 12.1 hapi 21 emits only cookie CLEARS on a response carrying a 500 error

**What a client sees.** On a response whose error is a 500, the delivered tree sends **no**
`Set-Cookie` where the baseline sent the yar session cookie. Status, `content-type`,
`content-length` and the response **body are byte-identical** between the two trees on every one of
these responses, so there is no rendered-UI impact and nothing a page displays differs; the divergence
is one header, on **500** error responses only — a 404 and a 400 still carry it, as the probe matrix
below shows. A cookie **CLEAR** is never affected.

**The framework cause** (**static**, read from the installed tree). `@hapi/hapi` 21's state header
writer gates the whole of `request._states` on the response's error status
`[T node_modules/@hapi/hapi/lib/headers.js:65-78]`:

```javascript
exports.state = async function (response) {

    const request = response.request;
    const states = [];

    const clearOnly = response._error?.output.statusCode === 500;

    for (const name in request._states) {
        if (!clearOnly ||
            (request._states[name].options?.ttl === 0 && request._core.states.cookies[name])) {

            states.push(request._states[name]);
        }
    }
```

hapi 20.3.0's `headers.js` has **no such branch**: its `exports.state` pushes every `request._states`
entry unconditionally (**static**, read from a 20.3.0 installation). `@hapi/yar` commits the session
from an `onPreResponse` extension, which is exactly a `request._states` entry, so the session write
reaches the wire on a 500 under hapi 20 and does not under hapi 21 unless it is a clear. The writer
runs inside the framework's own marshal cycle — `this._marshalCycle.push(Headers.state)`
`[T node_modules/@hapi/hapi/lib/route.js:335]` — which is **after** every `onPreResponse` extension
has returned.

**The two-major probe** (**probe**). One repository-code-free server — a state set from an
`onPreResponse` extension, eight paths, a second extension that replaces the Boom with a rendered page
for one of them — run under Node 22.23.2 against both majors, each from its own installation. The
`Set-Cookie` names emitted:

```text
path          status  hapi 20.3.0        hapi 21.4.10
/ok             200   probe              probe
/throw          500   probe              (none)      <- handler threw
/boom           500   probe              (none)      <- handler returned a Boom
/marshal        500   probe              (none)      <- failure DURING marshalling
/notfound       404   probe              probe
/badrequest     400   probe              probe
/replaced       500   probe              probe       <- Boom replaced by a rendered page
/clear          500   probe+clearme      clearme     <- the CLEAR survives, the set does not
```

**The branch condition is the framework's own predicate, and stating it as anything narrower
understates the surface.** It is not "a raw Boom 500": it is **any response whose
`_error.output.statusCode` is 500**, which the matrix above shows covers a thrown 500 and a
marshal-time 500 as well. Two things follow. A 500 that a later extension **replaces** with a
different response carries no `_error`, which is why `/replaced` keeps its cookie — and why the
application's own rendered `50x.html` pages are unaffected. And the surface is **systemic** rather
than a list: the QA sweep's 21 route/scenario combinations (15 from the sweep, 4 from sequenced
batches, and 2 found while closing quirk cells — `PUT /api/trinkets/{id}/metrics` and
`POST /api/trinkets/{id}/folder`, outside the original 15) are **occurrences of the predicate, not an
inventory of it**.

**Live reproduction on the delivered tree** (**probe**, authenticated session, one running server).
Three groups, and the third is the one no error funnel can reach:

| Driven | Result | `Set-Cookie` | The app's `Pragma`/`Expires` |
|---|---|---|---|
| `GET /home`, `GET /admin/users` | 200 | `session=…` | present |
| `GET /no-such-xyz` | 404 `text/html` | `session=…` | absent — the mapper returns before the header block |
| `GET /login`, `GET /signup` authenticated (the [§5](#5-two-pages-handlers-that-answer-500-to-authenticated-visitors) quirk) | 500 `text/html`, `50x.html` | `session=…` | absent — same early return |
| `PUT /api/trinkets/000000000000000000000000/metrics` with `{}` | 500 `application/json`, `content-length: 96` | **none** | **present** |
| `GET /admin/search`, `/admin/user`, `/admin/roles`, `/admin/featured`, `/admin/upload-form`, `/admin/nosuch`, `/account/nosuchsubpage` — all seven | 500 `application/json`, `content-length: 96` | **none** | **absent** |

**The on-wire discriminator between the two arrival paths is the app's own `Pragma`/`Expires` pair,
and it is what lets a reader classify a future occurrence.** Both groups answer a 96-byte
`application/json` 500 equal in status, media type, length and every field value — but the two are
**not byte-identical**, and this entry does not claim they are: the handler-time body serializes as
`{"statusCode":…,"error":…,"message":…}` and the marshal-time body as
`{"message":…,"statusCode":…,"error":…}` (**probe**), one being Boom's own payload and the other
rebuilt by `internals.fail`. Nothing here keys on body bytes and `compareJson`
`[T test/parity/replay.js:5415-5497]` compares a flattened field map rather than an ordered
document, so the difference changes no comparison — it is recorded because the word "identical"
invites a byte comparison that would fail. Note also that the second row of the table above is a
404 whose `Pragma`/`Expires` are **equally absent** and which **keeps** its cookie: the discriminator
classifies the arrival path, and it is the 500 status alone — not the marshal-time rebuild, and not
error responses in general — that costs the header. Where the app's `Pragma: no-cache` and
`Expires: 0` **are**
present, `app.js`'s Layer-3 mapper saw the Boom and stamped them, so the error arrived
**handler-time**. Where they are **absent**, the response the mapper saw was not an error at all and
the 500 on the wire was built afterwards: these seven are **marshal-time** failures — a nunjucks
render failure inside marshalling, since `[T lib/views/admin/index.html:46]` includes
`"admin/includes/" + subpage + ".html"` and Vision renders a view response during the marshal cycle.

**One live result that looks like a counter-example and is not, recorded so the branch condition is
not widened by the obvious next experiment** (**probe**). `POST /api/trinkets` with a malformed JSON
body answers **400 with no `Set-Cookie` either**, on a session that a 404 on the same jar commits
normally. That is application lifecycle ordering rather than this divergence: `internals.payload` is
pushed into the route cycle **before** `onPostAuth` and therefore before `onPreHandler`
`[T node_modules/@hapi/hapi/lib/route.js:229-275]`, so a payload-parse failure aborts before
`app.js`'s `onPreHandler` extension calls `request.yar.touch()` `[T app.js:149-168]`, the session is
never marked modified, and yar has nothing to commit. Nothing is suppressed because nothing was set —
identical on both majors, where the probe's own `/badrequest` row sets its state unconditionally and
so shows a 400 keeping the header on both.

**Why no funnel owns the marshal-time subset, and why it cannot be given one** (**probe**, same
repository-code-free server). On a marshal-time failure `onPreResponse` runs **exactly once**, and at
that moment `request.response.isBoom` is `false` with `statusCode` 200. The 500 that reaches the wire
is constructed afterwards by `internals.fail`
`[T node_modules/@hapi/hapi/lib/transmit.js:46-70]`, reached from the catch in `exports.send`
`[T node_modules/@hapi/hapi/lib/transmit.js:17-35]`, which re-runs the marshal cycle and **not** the
request lifecycle. Proof on the wire: a header the extension set on the response does not appear at
all, and what is delivered is hapi's own `cache-control: no-cache` with `content-length: 96`. So
adding the state to the response in the error mapper — the first of the two fixes the finding
offered — is **not implementable for this subset at all**: there is no extension invocation that can
see the response the client receives.

**The conflict, and which requirement controls.** AAP rule **T-6** governs this exact shape: where a
requirement other than R-d makes preservation impossible, the conflict is named, one requirement is
decided to control, the reason is stated, and the quirk record and the gate are aligned. Here
**R-d** — preserve the baseline `Set-Cookie` — collides with **AAP §0.5.1's mandated `@hapi/hapi`
21.4.10**, whose suppression is hardcoded in the header path with **no per-server, per-route or
per-state option** to disable it. §0.9.3 makes every `Set-Cookie` attribute an exact-comparison field,
which is the gate the collision surfaces through.

**Decision: the framework's behaviour is adopted and registered here; no state is re-attached on
5xx.** `app.js` gains comments recording the divergence at the two sites a reader will look —
`[T app.js:203-236]`, above the Layer-3 mapper at `[T app.js:237]`, and `[T app.js:305-319]`, above
the private-field cookie patch at `[T app.js:321]` — and **no code**: the file's non-comment content
is byte-identical to the commit this section was written at (**probe**, comparing both revisions with
comment lines stripped — 272 code lines each, and equal). Three reasons:

1. **The marshal-time subset is unreachable, measured above.** A fix that covers only the handler-time
   half of one predicate is not a preservation; it is a second divergence, differently shaped.
2. **For the handler-time half the suppression also happens after both extensions**, in the marshal
   cycle `[T node_modules/@hapi/hapi/lib/route.js:335]`, filtered at
   `[T node_modules/@hapi/hapi/lib/headers.js:65-78]`. Restoring the header would mean `app.js`
   hand-sealing a yar cookie through `server.states.format` and writing it into
   `boom.output.headers` — authored behaviour no AAP requirement describes, outside **R-a**'s four
   permitted diff categories (runtime bump, hapi API migration, async conversion, blocking dependency
   swaps), and a deliberate defeat of an upstream security change whose whole point is that a server
   error should not set cookies.
3. **Both findings that measured this prefer registration**, and the MEDIUM one says outright that the
   defect is the bookkeeping rather than the behaviour.

**Classification, against [§11.3](#113-what-is-not-a-deviation-and-why-the-register-is-closed)'s
two classes.** §11.3 separates an **approved deviation** — a prohibition (R-d) argued away by a
stronger requirement — from an **unmet validation target**, which must keep failing and stay visible.
This entry is honestly neither, and it is not downgraded to the second to make it comfortable: **it is
a departure from R-d's prohibition**, on a header a client receives. What distinguishes it from
§11.1 and §11.2 is that no application decision produces it and no application change can prevent it
within scope, so there is **nothing to repair** — and a permanently failing gate would therefore be
bookkeeping rather than a finding, which is exactly the inversion §11.3 warns about in the other
direction. That is why the class gets its own register rather than a row in either of theirs.

**What it costs, and what is retained.** Nothing the application decides, and — measured rather than
reasoned, because the intuitive answer is the wrong way round — nothing a client loses. yar's commit
re-sets the **same session id it received** — `h.state(name, {id: this.id})` on a repeat visit — so
the header the baseline emitted carried the value and attributes the client already holds. The
**server-side** half of the commit is untouched: the store write follows the `h.state` call and
happens in both trees, so a flash cleared on a 500 is cleared on both.

**There is no `Expires` horizon on a 500 header to lose, and of the two shapes the absent header is
the safer one.** Three measurements, in that order. *The baseline's own 500 headers:* of the **13**
recorded `application/json` 500 steps in the committed corpus that carry a baseline cookie, **all 13**
carry the attribute set `httponly|path|samesite` and **not one** carries `Expires` or `Max-Age`; the
five rendered `text/html` 500s are identical in that respect (**probe**, over
`test/parity/corpus.json`). The baseline repeated a **session**-cookie header on a 500, never a
persistent one. *What a real client does with the two shapes:* driven in Chrome against a 25-line
standalone server holding no repository code, reading Chrome's own store through the Cookie Store API
(**probe**), a record stored persistently from `Expires=<+1y>` is left **exactly as held** by a 500
that sends no `Set-Cookie` (`Sun, 05 Sep 2027 20:53:29 GMT` before and after) and is **downgraded to
session-only** — `expires: null` — by a 500 that repeats the same cookie **without** `Expires`, which
is the baseline's exact shape; the cookie continues to be sent in both cases. So where the two majors
differ for a client at all, hapi 21's suppression **preserves** a held expiry and the baseline's
header **discards** it. *Why the practical cost is nil in either direction:* only the
session-establishing response carries the attribute, and the very next response already removes it —
`POST /login` emits `…; Expires=Sun, 05 Sep 2027 21:00:00 GMT` against a `Sat, 05 Sep 2026` request
date, while the `GET /home` that same login redirects to, and every authenticated 200 after it such as
`GET /admin/users`, re-set the same cookie with **no** `Expires` and **no** `Max-Age` (**probe**, real
browser). A client does not reach a 500 holding a persistent record in the first place.

An earlier revision of this entry recorded the cost as "the refresh of the cookie's one-year
`Expires` horizon". That was wrong twice: no such attribute is on the header in question, and the
direction of the difference is retention rather than loss. It is corrected here rather than quietly
dropped, because a register whose cost column overstates the harm misleads exactly as much as one
that understates it.

The AAP §0.9.6 assertion that exists to detect
`app.js`'s private-field patch going silently no-op is **retained in full**, because it runs on
non-500 responses: three QA reports measured that patch **live** on hapi 21.4.10, and it is live here
too — `POST /login` on the delivered tree emits
`session=<SEALED>; HttpOnly; SameSite=Lax; Path=/; Expires=Sun, 05 Sep 2027 18:43:21 GMT` (**probe**),
a 2027 horizon against a 2026 request, so §0.9.6's open item on it is **closed** and this entry does
not put it at risk.

**Gate.** `test/parity/replay.js` carries the mechanism, keyed to this section by its own `register`
field. It is a **rule**, `hapi21-500-clear-only-states`, not a per-scenario marker: the
approved-deviation marker allowlist stays at the five scenario ids §11.0 rule 1 names (deviations 1, 9,
16 and 17), and neither kind can be minted by a tool. The rule **fails closed** — both sides must have answered 500, the baseline
must have set at least one cookie and the target none, no baseline cookie may be a CLEAR, and the
differences it demotes must be *exactly* the three field kinds the header's absence produces
(`header.set-cookie`, `cookies.count`, and one `cookie[<name>].present` per baseline cookie), or the
whole demotion is declined rather than applied selectively. Those conditions are exercised at startup
by `assertFrameworkCookieSuppression`, which **throws** on a condition that stopped holding, because a
widened exemption is a broken tool rather than a finding about the application.

**Two startup checks, not one, because "is the mechanism still authorized" and "does the mechanism
still behave as declared" are different questions and a run can fail either alone.**
`assertRegisterAuthority` runs **first** and **reads this section**, rather than citing it:
it resolves `docs/preserved-quirks.md` from the tool file's own directory — never from the working
directory, so the check reads the same document whichever directory the tool is driven from
(**probe**: identical result from `/`, `/tmp` and `$HOME`) — and then requires the `register` pointer
to be a non-empty string naming that document, the §12 section heading and this §12.1 entry heading
to be present in it, this entry's own body to name the rule id `hapi21-500-clear-only-states`, and
that body to be more than a heading. Any of those failing **throws before a request is driven**, and
the verification is itself proved fail-closed against **eight** rejection branches — no rule id, a
blank pointer, a pointer naming a document the check does not read, an unreadable register, a
register missing the section, a register missing this entry, an entry not naming the rule id, and an
entry reduced to its heading — each asserted to be rejected *for its own stated reason* rather than
merely to fail (**probe**). End to end (**probe**, a copy of the tool in a separate tree): with this
document absent it throws `cannot be read at`, with a §12.1 that registers something else it throws
`does not carry the entry`, and with the entry emptied to its heading it throws `carries almost no
body`. The mechanism's own comment has always said that a rule whose register entry does not exist
has no authority at all; until this check existed, nothing enforced it, the pointer was carried into
every artifact and printed in the report without ever being read, and a rule that lost its register
rendered as `registered in undefined` — which reads as an exemption in force. Publication is now
guarded too: `describeFrameworkExemption` **refuses** to emit an exemption missing either its rule id
or its pointer, because an artifact naming an exemption and not its authority is worse than one
naming neither — it looks audited.

**What the gate still compares exactly** (**artifact**, measured over the committed
`test/parity/corpus.json`): 392 scenarios, 404 recorded steps, of which **231 carry at least one
recorded `Set-Cookie`**. The 24 status-500 steps split into **13 `application/json` 500s carrying a
baseline cookie** — the only steps where the demotion can fire — **6** `application/json` 500s with no
baseline cookie, so nothing to demote, and **5** `text/html` 500s carrying a cookie, which are the
rendered pages the predicate does not reach and are compared exactly. So **218 of the 231
cookie-bearing steps are compared exactly**, including all **39** cookie-bearing redirect steps of the
65 redirects, and the rule reaches **13**. Those are corpus figures and they bound the *gate's*
exposure, not the behaviour: the **scope** of the divergence is the framework predicate — every
response carrying a 500 error, on any route — which is why a reader must not read 13 as a route count.

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
| `lib/controllers/courses.js` `download`, delivered at `[T lib/controllers/courses.js:432]` | Keep the delivered `return Boom.forbidden();` **as the expression it is**. The preserved 500 comes from `Boom` being unbound in this module — not from retaining a legacy `reply(...)`, which is already gone from this carrier, so an allow-list row phrased against the legacy syntax would protect nothing | Two different tidy-ups convert the 500 into the 403 the expression reads as: binding `Boom`, or rewriting the call as `errors.forbidden()` against the module's actual `@hapi/boom` alias. And the branch is **unreachable over the route** ([§10.14](#1014-a-private-courses-archive-is-downloadable-by-any-authenticated-user)), so no gate catches either one | [9.7](#97-a-routed-handler-that-answers-500-where-its-author-intended-403) |
| `lib/controllers/users.js` `getExportStatus` and `downloadExport`, all 15 `Boom.*` sites in the module | Keep each expression **as written**, with `Boom` the first unresolvable identifier on its line, and keep the finder's callback re-delivery — the `$handleCallbackError` override at `[T lib/models/model.js:195-219]` — so the throwing callback is still re-invoked. The directive is on that mechanism and not on the file's bytes: `lib/models/model.js` is **not** byte-identical to baseline, because two `findById` cases in `test/lib/models/trinket.js:113-137` force the callback form under AAP §0.9.2, and [9.9](#99-two-routed-handlers-that-answer-200-carrying-the-name-of-a-missing-identifier) records that in full. The delivered response is a 200 carrying `{"error":"Boom is not defined"}` | Two generic mandates are wrong here at once: "resolve/return a response on every path" is already satisfied — by the *second* invocation — and any tidy-up that binds `Boom`, rewrites the calls as `errors.*`, reorders the identifiers on the line, or stops the finder re-entering a rejected callback changes both the status and the body. The message itself is client-visible, so even the identifier order is part of the contract | [9.9](#99-two-routed-handlers-that-answer-200-carrying-the-name-of-a-missing-identifier) |
| `[T lib/controllers/admin.js:169]`, `:221`, `:228`, `:244`, `:292`; `[T lib/controllers/users.js:328]`, `:391`, `:724`, `:869` | Keep `request.fail(err)` passing the **`Error` itself**, and keep `request.fail`'s `h.response(json)` unchanged. These nine edges terminate the process, and that is the preserved outcome | A mandate to "map the error to a response" or "reach the funnel" would give nine edges a status and a body they have never produced — R-e per edge, R-d as an improvement — and `request.fail` is on T-2's preserved list | [10.11](#1011-requestfailerr-with-an-error-argument-terminated-the-process--repaired-and-why) |
| `[T lib/controllers/admin.js:213]`, `:265`, `:272`, `:288`, `:337`; `[T lib/controllers/users.js:328]`, `:391`, `:724`, `:869` | Keep `request.fail(err)` passing the **`Error` itself** — the call sites are unchanged — and keep the redirect and `fail.html` branches of `request.fail` unchanged. **Superseded in one respect:** the `h.response(json)` branch now routes an `Error` as a Boom, so these edges ANSWER (500) instead of terminating the process. That is an approved repair, argued in §10.11, not a target action a generator may undo | A mandate to "preserve the process death" would reinstate a defect three QA findings raised as blocking; a mandate to change the redirect or `fail.html` branches, or the call sites, would change outcomes those branches already produced | [10.11](#1011-requestfailerr-with-an-error-argument-terminated-the-process--repaired-and-why) |
| `lib/controllers/courses.js` `download` | Keep the residual `reply(Boom.forbidden())` in the unauthorized branch, so it throws and answers 500 | "every `reply(...)` becomes a returned toolkit response" would convert the 500 into the 403 the expression names | [9.7](#97-a-routed-handler-that-answers-500-where-its-author-intended-403) |
| `lib/controllers/users.js` `getExportStatus` and `downloadExport`, all 15 `Boom.*` sites in the module | Keep each expression **as written**, with `Boom` the first unresolvable identifier on its line, and keep the finder's callback re-delivery — the `$handleCallbackError` override at `[T lib/models/model.js:195-219]` — so the throwing callback is still re-invoked. The directive is on that mechanism and not on the file's bytes: `lib/models/model.js` is **not** byte-identical to baseline, because two `findById` cases in `test/lib/models/trinket.js:113-137` force the callback form under AAP §0.9.2, and [9.9](#99-two-routed-handlers-that-answer-200-carrying-the-name-of-a-missing-identifier) records that in full. The delivered response is **not uniform across the 15**, and [10.20](#1020-the-rest-of-the-unbound-boom-family-in-libcontrollersusersjs) carries the per-branch measurement: six answer a 200 carrying `{"error":"Boom is not defined"}`, four answer a generic 500, one has no response of its own but is what converts the six, and four cannot be entered from an HTTP request at all | Two generic mandates are wrong here at once: "resolve/return a response on every path" is already satisfied — by the *second* invocation — and any tidy-up that binds `Boom`, rewrites the calls as `errors.*`, reorders the identifiers on the line, or stops the finder re-entering a rejected callback changes both the status and the body. The message itself is client-visible, so even the identifier order is part of the contract | [9.9](#99-two-routed-handlers-that-answer-200-carrying-the-name-of-a-missing-identifier) |
| `[T lib/controllers/admin.js:213]`, `:265`, `:272`, `:288`, `:337`; `[T lib/controllers/users.js:328]`, `:391`, `:724`, `:869` | Keep `request.fail(err)` passing the **`Error` itself**, and keep `request.fail`'s `h.response(json)` unchanged. These nine edges terminate the process, and that is the preserved outcome | A mandate to "map the error to a response" or "reach the funnel" would give nine edges a status and a body they have never produced — R-e per edge, R-d as an improvement — and `request.fail` is on T-2's preserved list | [10.11](#1011-requestfailerr-with-an-error-argument-terminated-the-process--repaired-and-why) |
| `lib/controllers/trinket.js` `updateMetrics`, its metric-free branch | Keep **both** halves of `return Trinket.findById(id, function (err, trinket) { return request.success({data:trinket}); });` — the callback **and** the returned `Query`. The callback's response is meant to go nowhere: it is the double execution that answers, with a 500 | A generic delivery mandate — return the value, settle the promise the method returns with it, or return it from the nested handler of a chain the method returns — is satisfiable in three ways that all turn the 500 into a 200 carrying the trinket state. The generated row is closed rather than open, and it reaches the same conclusion in its own words: the discarded call "is the BASELINE outcome, not an unfinished conversion", and "Do NOT reroute them to deliver" `[T docs/conversion-inventory.md:568]`. That row's diagnosis is correct and is the quirk, not a defect to close | [9.8](#98-a-routed-handler-whose-metric-free-branch-answers-500-where-its-comment-intends-the-trinket-state) |
| `[B lib/util/helpers.js:182]` `findTrinket`, `[B lib/util/helpers.js:385]` `courseBySlug`; delivered at `[T lib/util/helpers.js:202]` and `[T lib/util/helpers.js:443]` | `return null` — the value the shim produced. The redirect construction is **removed, not converted** | converting the chain would emit a 301 the baseline never emitted | [2](#2-two-live-pre-handler-301-redirects-that-never-fire) |
| `[B lib/controllers/trinket.js:1204]`, `:1246`, `:1259` — baseline coordinates, which is how the generated checklist keys these three rows, because the legacy chain is gone from each carrier and the category declares no target shape to locate | Reproduce what was captured at baseline — the specification is a measurement, not a rewrite rule, and it **has been taken**: the three recorded baseline statuses are in [§4.3](#43-builder-returned-to-hapi--three-chains), which is the value to reproduce. What is still absent is the replay result for the target, so the capture is the authority here rather than a re-derivation from the code | a mandate to return a toolkit response is right in form and silent about which response, which is the whole content of the quirk | [4.3](#43-builder-returned-to-hapi--three-chains) |
| `[B lib/controllers/trinket.js:375]` — a baseline coordinate; the legacy construct is no longer in this tree | **Return** the mapped error — here the statement *must* change to preserve the outcome | the inverse case, listed so the allow-list is not read as "never change a statement": this one is a genuine rewrite | [4.4](#44-one-further-unreturned-reply-on-an-error-path) |
| `lib/controllers/trinket.js` `draft` and `autosave`, the `request.payload.zipCode` chains — `[T lib/controllers/trinket.js:1240]` and `[T lib/controllers/trinket.js:1335]` | Leave both chains **neither returned nor awaited**, keep the terminal `.catch` on each, and keep both bounds ahead of the read. The responses are baseline's own — `draft` 200, `autosave` 500 | This is the one allow-list row protecting a **registered deviation** rather than a preserved quirk, and it needs protecting from both directions. A mandate to "return or await the chain" would make `draft`'s malformed branch answer 500 where baseline answered 200 — outside what §11.9 approves. A mandate to "remove the added guard as unauthorised policy" would restore the process death §11.9 exists to prevent. The approved shape is exactly the delivered one | [11.9](#119-deviation-5-the-bounded-zipcode-read-and-the-process-death-it-no-longer-causes), measured in [10.7](#107-the-zipcode-branch-that-took-the-process-down-and-the-bounds-that-now-hold-it) |
| `lib/controllers/courses.js` `download`, the five-clause guard at `[T lib/controllers/courses.js:214-218]` | Keep all five clauses **as written**, including `create-private-course` | Not a conversion mandate this time but a *hardening* one: the clause admits every authenticated account, so the guard looks like a defect to close. It is baseline behaviour and R-d preserves it, and narrowing it here would also leave `course.copyCourse` admitting the same accounts | [10.14](#1014-a-private-courses-archive-is-downloadable-by-any-authenticated-user) |
| `lib/controllers/users.js` `requestExport`, its success payload — `[B lib/controllers/users.js:977]`, delivered at `[T lib/controllers/users.js:1356]` | Keep `exportId: exportRecord._id` as the **raw ObjectId** it is, so `ObjectUtils.serialize` rebuilds it into a plain object whose detached `toJSON` makes hapi's marshal throw and the route answer 500 | Every generic mandate points the wrong way here at once: the handler already returns exactly once, the value it returns is well formed, and `.toString()` is a one-character "obvious correctness fix" that is MEASURED to work — which is why it must not be written. `lib/util/objectUtils.js` must also stay byte-identical, since the `for...in` rebuild is the mechanism | [10.18](#1018-post-apiexports-answers-500-after-saving-its-row-and-queueing-its-job) |
| `lib/controllers/users.js` `requestExport`, its in-flight guard — `[T lib/controllers/users.js:1277]` and `[T lib/controllers/users.js:1309]` | Keep the deciding read and the create as **two separate steps**, and keep `lib/models/export.js` free of a unique index on `{_owner, status}` | "make the check atomic" and "add the index the comment implies" are both satisfiable and both change an observable outcome: the concurrent loser answers 500 today, not a duplicate-key error and not 200 "already in progress" | [10.19](#1019-the-in-flight-export-guard-reads-and-writes-in-two-steps) |
| `lib/controllers/courses.js` `copy`, its callback's failure branches — `[T lib/controllers/courses.js:204-220]` | Keep both failure branches **answering**: `err.code === 11000` resolves `request.fail({err, message})` with the string both sibling sites compose, and every other error — including a callback with no document — resolves `errors.badImplementation(err && err.message)`. The `err` argument **must stay inspected** | The second allow-list row protecting a **registered deviation** rather than a preserved quirk, and it needs protecting from one direction in particular: the generic callback-boundary mandate for this site used to read "the baseline's error handling inside the callback is the target — swallowed stays swallowed", which is now exactly wrong. Restoring the swallow restores a `TypeError` read off `undefined` inside a mongoose save callback, which terminated the baseline process and hung the delivered one. A mandate to `throw` or reject instead of resolving is also wrong: the route catch-all would rewrite the returned Boom into a second `badImplementation` and would discard the duplicate-name message and the route's own `fail.redirect` | [11.11](#1113-deviation-9-the-page-level-course-copy-answers-where-the-baseline-process-died) |
| The two `if (err)` arms of the export finders — `[T lib/controllers/users.js:1414]` and `[T lib/controllers/users.js:1472]` | Keep the arm answering `request.fail({ error: err.message })` with the **message unmodified**, and do not validate `{exportId}` ahead of the finder. A `CastError` from an uncastable parameter arrives here and is answered **200** with the ODM's diagnostic and the supplied value echoed | Three generic mandates each break it in a different way: "validate the path parameter", "give the error edge its status", and "do not echo input in an error body" are all reasonable in the abstract and all change a client-visible status or body. This arm is also the one §9.9 and §10.11 reach, so narrowing it moves those entries too | [10.22](#1022-two-further-defects-surfaced-by-the-closing-verification-pass) |

**Three deviations, three different roles — and generated prose must not collapse them to one.** A
generated cross-reference that speaks of "the single approved deviation" is wrong on the count and, more
usefully, wrong about the kind: [deviation 1](#111-deviation-1-the-never-settling-file-response) is a
**response** deviation and is the one a conversion row can be affected by;
[deviation 2](#112-deviation-2--the-marked-fork-is-retained-leaving-one-named-high-advisory) is an
**audit** deviation that no conversion row touches;
[deviation 5](#119-deviation-5-the-bounded-zipcode-read-and-the-process-death-it-no-longer-causes) is an
**availability** deviation that changes no response but does constrain two conversion rows, which is why
it has an allow-list row of its own above; and
[deviation 7](#1113-deviation-9-the-page-level-course-copy-answers-where-the-baseline-process-died) is a
**response** deviation that constrains one conversion row — the `courses.copy` callback boundary, whose
generated target action previously mandated the swallow the deviation removes — and it has the row above
for that reason. Naming the applicable one is what makes the reference useful;
counting them is what makes it correct.

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

**Read this subsection's own history first, because it is an instance of what it records.** Five
successive checkpoints each appended their correction here without removing the one before it, so by
the time the register reached eight this subsection carried a truncated opening sentence, two
overlapping "three divergences" paragraphs, two separate "Divergence 3, the count" paragraphs giving
different counts, two "Numbering agrees" paragraphs and **three** copies of the
`docs/error-edge-inventory.md` note. It also asserted that "exactly two approved deviations" reads
correctly in all ten records that state it — true when written, false for some time before it was
read. It has been collapsed into the single statement below, and every substantive finding the stacked
revisions contained is carried forward rather than dropped. Two of their factual claims are **withdrawn
as measured false**, and named as such in divergence 3.

**What is compared, and how.** The approved deviations in §11 are required to read identically here, in
`docs/deferred-dependencies.md` §4 and in `docs/baseline-parity.md` §7. All three documents are in the
delivered tree, so the comparison has been **executed** (**static**, by direct reading of the sections
rather than by a generated diff, except §12's leg which was compared mechanically). It finds **three
divergences**: deviation 1's **evidence state**, since RESOLVED by measurement; deviation 2's
`highlight.js` attribution, named rather than harmonised because it lives in a sentence another
document owns; and **the register count**, which this checkpoint moved in three of the records and
could not move in the rest. **None of the three changes a decision, a version, a target expression or
a gate.**

**Deviation 1, the never-settling file response — three legs compared, one divergence.** §11.1 above,
`docs/deferred-dependencies.md` §4.1 and `docs/baseline-parity.md` §7.1 carry the same conflict
statement ("R-d requires that the outcome be preserved. R-b requires that every route serve. Both
cannot hold."), the same decision ("the target serves the stream response", "R-b controls"), the same
target expression `h.response(stream).type(request.pre.file.mime).bytes(request.pre.file.size)` at the
same locator — `[T lib/controllers/files.js:632-636]` in the delivered tree, which the two sibling
records still address as `171-173` from an earlier revision of the file; the three approved calls they
quote are identical and only the line pin differs — and the same statement that `Content-Disposition`
stays omitted. **One thing the two sibling records do not yet mention:** the delivered chain continues
with two protective headers added under QA finding W002-I4 (§10.6). They are outside all five approved
fields and change none of them, so the conflict statement, the decision, the three approved calls and
the omitted `Content-Disposition` still read the same in all three records — but a reader comparing the
quoted expressions will find two calls here that are absent there. Both sibling documents belong to
other units at this checkpoint, so the update is named in this checkpoint's resolution report rather
than made here. The three reasons are enumerated here and restated in the same order in §7.1; §4.1
assigns them to §11.1 instead of restating them, which is the ownership §11 claims. What the three
legs disagree about is the **evidence state** of the gate, immediately below.

**Divergence 1, deviation 1's evidence state — resolved, in favour of the present tense.** §11.1's
**Gate** paragraph above says, in the present tense, that the corpus records the baseline result as an
**expected timeout** and that the target answers; `docs/deferred-dependencies.md` §4.1 carries that
same sentence in that same tense. `docs/baseline-parity.md` §7.1 used to say the opposite — that what
existed was "an **annotation, not a measurement**" — and cited the artifact for it.

**The artifact now supports the carrier sentences.** `test/parity/corpus.json` reports
`captured: false` with `baselinesPending: 0` — the strict flag means every scenario carries a baseline,
and one is recorded `unreachableByDesign` instead; 391 of the 392 scenarios carry a recorded baseline;
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
moved: the conflict statement, the decision that R-b controls, the three approved calls at
`[T lib/controllers/files.js:632-636]`, the omitted `Content-Disposition` and the precedence argument
read the same in all three records, as they did throughout the disagreement — and the two headers added
beside them under §10.6 change none of the five approved fields, so the replayed verdict above is the
same verdict.

**The residual is now narrower than a refusal.** `verify:corpus` — a replay of the whole committed
corpus — **runs**: 391 of the 392 scenarios driven on both cookie passes, this deviation classified
`approved-deviation` in each. What remains open is the **secure** pass, which derives its expected
cookie attributes rather than comparing a secure-side recording
([`baseline-parity.md`](baseline-parity.md) §2.8).

**Deviation 2, the retained `marked` fork — three legs compared, one divergence.** The decision reads
the same in §11.2 above, in `docs/deferred-dependencies.md` §4.2 and in `docs/baseline-parity.md`
§7.2: the fork is retained, and the residual advisory is a named deviation of exactly one high with
zero critical. The four measured rendering differences — heading `id` attributes, task-list
`<input disabled type="checkbox">` markup, `javascript:` links reduced to bare text, and mixed
nested-list structure — appear as the same four in the same order in all three, each alongside the
deprecation notice emitted on every parse. All three assign the full reasoning, the precedence argument
and the named follow-up to `docs/deferred-dependencies.md` §4.2.

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

**Divergence 3, the register count — re-measured at this checkpoint, and the residue is one file.**
The register's extent is **eighteen** and **thirteen** of those are live in the delivered tree (§11.0).
Every count claim in every artifact was re-measured by grepping each file for the figure it states,
rather than assumed from the last correction; two earlier revisions of this subsection recorded the
canonical figure as "eight" and then as "fifteen" while its own rows still said "eight", which is the
stacked-count fault this row exists to close.

| Record | Count it stated | Status after this checkpoint |
|---|---|---|
| §11.0 and §11 here | **fifteen** | **corrected to eighteen numbered / thirteen live**, with a per-entry `State in the delivered tree` column carrying the measurement for each, and the five withdrawals recorded rather than deleted |
| `docs/baseline-parity.md` — its opening summary, and two `closed at` sentences | **fifteen** at `:19`, **two** at `:3244`, **fifteen** at `:3698` | **corrected at this checkpoint**, all three, to the eighteen/thirteen pair |
| `docs/deferred-dependencies.md` — §1, §4's heading "The two approved deviations", §2.6 and two alignment notes | **two**, in five places (measured: `:4`, `:151`, `:577`, `:1046`, `:1532`) | **corrected at this checkpoint.** This is the "exactly two" correction [§10.11](#1011-requestfailerr-with-an-error-argument-terminated-the-process--repaired-and-why) recorded as owed |
| `docs/conversion-inventory.md`'s ownership cell | **fifteen** | **corrected at this checkpoint in its generator**, `test/parity/convert-inventory.js`, because the artifact is digest-bound and a hand edit detaches its own provenance — measured: `manifest.js --verify-provenance` reports `content bound body-digest recomputed` on it |
| `docs/error-edge-inventory.md`'s ownership table | **two** (measured: `:369`) | **corrected at this checkpoint in its generator**, `test/parity/error-edges.js:9939`, for the same digest-binding reason |
| `test/parity/replay.js` — a source comment and one **emitted** prose string that read `CLOSED at exactly two approved` | **two** | **corrected at this checkpoint.** The tool now states five scenario ids across four deviations, which is what §11.0 rule 1 requires, and its register carries the four live replay-visible contracts |
| `CHANGELOG.md`'s summary, its **Behaviour** register and its **Security** bullet | **two** at `:7`, **eight** at `:34` | **NOT corrected — the only residue.** That file is outside the file set this checkpoint's evidence-and-inventory unit may modify. What it needs is mechanical and is stated here so it need not be re-derived: both figures become "eighteen numbered, thirteen live", and the Behaviour register gains rows for deviations 16, 17 and 18 and a withdrawal note against 7, 8, 11, 13 and 15 |


**Two claims earlier revisions of this subsection made about that set are withdrawn as measured false.**
They asserted that `docs/dependency-inventory.md`'s role table and `test/parity/capture.js`'s scenario
comment also carry the old count; **neither file states a deviation count at all** (measured: zero
matches in each). A stale-count list that names files which do not carry the claim sends the next
reader to correct text, which is the same defect as leaving the real ones uncorrected.

**Why this is a wording gap rather than a contradiction of substance, and where that stops being
comforting.** Both companion documents state that their numbering follows this §11, so the canonical
count is the one here — that is the dependency they declare. And nothing the lagging records *assert*
about a specific deviation becomes false: none of them carries an argument about the archive
deviations, `folders.create`, the upload routes or the search sinks. What is **not** harmless is a
reader counting deviations across the delivery and finding eight here and two there, with no line
telling them which is current; that is what this table is for, and it is why the follow-up is recorded
as owed rather than described as optional.

**Numbering agrees.** Deviation 1 then deviation 2, in that order, in every record that numbers them —
§11.1 and §11.2 here, §4.1 and §4.2 in the deferred-dependency record, §7.1 and §7.2 in the parity
record. Deviations 3 to 8 are §11.7 to §11.12 here; `docs/baseline-parity.md` carries §7.6 for
deviation 6, §7.8 for deviation 7 and §7.9 for deviation 8, and states in §7.7 that it carries no
evidence section for deviations 3 to 5. `docs/deferred-dependencies.md` has no counterpart section for
any of the six, which is divergence 3 above.

**`docs/error-edge-inventory.md` is not a further leg of the deviation record**, and one note replaces
the three that had accumulated. It states none of the deviations, and its ownership table assigns the
approved deviations to this document — which agrees with the canonical role claimed in §11, though that
table still says "two" and is one of the count corrections listed above. What that inventory **does**
owe, and does not yet carry, is the per-edge consequence of §11.10: `folders.create`'s duplicate branch
as an **answered 500** edge and its unknown-write-failure branch as an **answered 500** edge, in place
of rows describing a swallow or a non-response, plus target rows for `folders.update`'s and
`folders.deleteFolder`'s unbound-`Boom` branches as routed **500** edges, which §9.10 requires and which
are currently recorded as missing from the target although both constructs are present and measured.
**Deviation 7 adds nothing to that list**: it changes which requests reach four handlers, not how any
error edge inside them maps.

**§12's alignment — two legs, compared mechanically, one divergence harmonised.** The
framework-imposed divergence registered in
[§12.1](#121-hapi-21-emits-only-cookie-clears-on-a-response-carrying-a-500-error) has exactly one other
leg, and it is not a document: it is `test/parity/replay.js`'s `FRAMEWORK_COOKIE_SUPPRESSION` constant,
whose `register` field names §12 by section and title and which is emitted whole into every replay
artifact and printed in the rendered report. The two were read against each other rather than assumed
to agree, and the comparison was made **mechanically** (**probe**): a check that loads the constant and
this section together and asserts each of the eight probe rows with its per-major `Set-Cookie` outcome,
each of the nine corpus figures, and each load-bearing locator and phrase — the `headers.js:65-78`
cause, the `transmit.js:17-35` catch and `:46-70` rebuild, the framework predicate
`_error.output.statusCode`, the replaced-response exception, T-6, the rule id
`hapi21-500-clear-only-states`, the register pointer, the surviving CLEAR, the retained AAP §0.9.6
horizon assertion, "no state is re-attached on 5xx", and the scope-is-the-predicate caveat. **29
checks agree and none fails.** One divergence of wording was found and **harmonised rather than
named**: the constant's `costs` field said the lost `Expires` refresh is "on error responses only",
where the precise form — this section's — is **"on 500 error responses only"**, since the probe matrix
above shows a 404 and a 400 keeping their cookie. The field now reads "on 500 error responses only",
with the 404 and 400 named in it, so both legs state the same bound and neither record has to be read
as the authority over the other. No decision, figure, locator or gate condition ever depended on the
looser wording, and every field either record uses to *classify* or to *bound* the divergence agreed
before that edit as well as after it.

**One seam recorded rather than closed, because it crosses an ownership boundary.** No sibling
document records this suppression today: `docs/baseline-parity.md`, `docs/deferred-dependencies.md`,
`docs/dependency-inventory.md` and `docs/error-edge-inventory.md` are each silent on it, and all four
are owned by other units at this checkpoint. **That silence leaves their count claim untouched by §12
specifically**: what each of them asserts is that there are exactly **two approved deviations**, and
§12 adds none — it is a separate register, of a divergence no application decision produced, and §11.0
says so in the same words. So nothing in this section makes their wording any less accurate than it
already was. **Their number is nonetheless stale, and by more than it was**, which is stated here
rather than left for a reader to discover: [§11.0](#110-the-register-and-why-a-tool-cannot-add-to-it)'s
register held **six** before this checkpoint and holds **fifteen** after it, so "exactly two" is thirteen
short in all ten records that state it. That drift predates this section and every entry in it —
those documents' numbering "follows this section", and following it means being refreshed when it
grows — and closing it is a **handover** to the units that own those four files, together with the
pointer to §12 described next. What a future revision of those documents may want is a
*pointer* to §12 beside their deviation sections, which is an addition to their text and not a
correction of it.
**Numbering agrees as far as it goes.** Deviation 1 then deviation 2, in that order, in all three
documents — §11.1 and §11.2 here, §4.1 and §4.2 there, §7.1 and §7.2 in the parity record — each of
which states that its numbering **follows this section**.

**Divergence 3, the count — named, and resolved in this document's favour by the followers' own rule.**
Deviation 6 is registered in §11.0's table and argued in §11.10; `docs/deferred-dependencies.md` §4 and
`docs/baseline-parity.md` §7 still title themselves around **two**, as do
`docs/conversion-inventory.md`'s ownership note and the register comment in `test/parity/replay.js`.
Two things make that a wording gap rather than a contradiction of substance. First, both companion
documents state that their numbering follows this §11, so the canonical count is the one here — that is
the dependency they declare, and it is the reason a third row belongs here first rather than nowhere.
Second, nothing they assert becomes false: neither carries an argument about the `zipCode` branch, and
`test/parity/replay.js`'s allowlist is keyed by **scenario id** and still holds exactly the one id
deviation 1 owns, which is correct precisely because deviations 2 and 3 are not replay-visible. The
follow-up is therefore a count update in four sentences the units owning those files hold, and it is
recorded here rather than reached into from this document.

`docs/error-edge-inventory.md` is not a fourth leg. It states no deviation, and its ownership
table assigns "the two approved deviations" to this document — the same count wording as the others,
and the same canonical role claimed in §11.
`docs/error-edge-inventory.md` is not a further leg of the deviation record. It states none of the
three, and its ownership table assigns the approved deviations to this document, which agrees with the
canonical role claimed in §11 — though that table still says "two", and it is one of the count
corrections listed above. What that inventory **does** owe, and does not yet carry, is the per-edge
consequence of §11.10: `folders.create`'s duplicate branch as an **answered 500** edge and its
unknown-write-failure branch as an **answered 500** edge, in place of rows describing a swallow or a
non-response, plus target rows for `folders.update`'s and `folders.deleteFolder`'s unbound-`Boom`
branches as routed **500** edges, which §9.10 requires and which are currently recorded as missing from
the target although both constructs are present and measured.

What a future revision of the sibling
documents may want is a *pointer* to §12 beside their deviation sections, which is an addition to their
text and not a correction of it.

One further note, recorded rather than acted on: `mkdocs.yml`'s `nav:` lists only `index.md`,
`setup.md` and `overview.md`, so this document is not part of the rendered documentation site.
Changing that navigation is outside the scope of this work and `mkdocs.yml` is not modified.

