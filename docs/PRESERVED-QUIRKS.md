# Preserved Quirks

Everything catalogued in this document is **in scope to document and out of scope to fix**. These are the 2013-era
defects, asymmetries and accidents that the Node 22 / hapi 21 modernization deliberately carried forward unchanged,
together with the reasoning that made carrying them forward the correct decision.

Every entry below was **measured, not suspected**. Each one was reproduced against a live checkout of the base
commit — by booting the application, serving real HTTP, dumping the framework's own route table, or executing the
exact call-site shape against the exact target dependency version. No entry rests on inference from documentation
or from release notes.

This document exists to discharge the second half of the binding rule R-4, quoted verbatim:

> "Behavior 'improvements' are prohibited. A 2013-era quirk that clients may depend on is preserved and documented,
> not fixed."

R-4 has two halves. The *preserved* half is discharged in the code, where each quirk's behavior is reproduced
exactly. The *documented* half is discharged here. Without this catalogue the migration would be non-compliant,
because a reviewer would have no record of which defects were kept, why, or what a well-meaning repair would have
broken.

**Scope of the discharge, stated precisely.** Sections 1, 2 and 3 cover the *functional* quirks, the deliberate
version skews and the R-6 adjudications. They do **not**, on their own, discharge R-4, because a security review of
this changeset identified **twelve security-relevant conditions** that sections 1-3 did not name. An earlier revision
of this document claimed complete discharge of R-4 while omitting all twelve; that claim was wrong and has been
withdrawn. **[Section 4](#4-the-security-condition-catalogue) is the missing half**: it catalogues all twelve, states
for each whether it was preserved or remediated, and records the reachability measurement and the governing rule.
R-4 is discharged by sections 1-4 read together, not by sections 1-3 alone.

**Rule-set provenance.** The binding rule set this catalogue answers to is the six-item **RULES block carried
inside the change request** — referred to below as R-1 through R-6 — plus the house style contract at
`CONTRIBUTING.md` §Code Style (L62-L66), plus enterprise-standard best practice. There is **no separate
user-supplied rules document** for this project: that document is complete at its single line, *"No user rules
provided."* Its absence is **not** treated as permission to lower the bar — no rule has been invented to fill it,
and every entry below is measured against the base commit rather than argued.

**This is not a bug backlog.** Every item here is a deliberate preservation decision with its reasoning attached.
The catalogue is written so that a future maintainer who encounters one of these behaviors does not "helpfully"
repair it, and so that the reviewer of this changeset can tell a preserved quirk apart from an oversight. Two of
the binding rules make repair actively prohibited rather than merely unnecessary: R-4 above, and R-1, quoted
verbatim:

> "Opportunistic cleanup, style normalization, latent-bug repair and architectural improvement are out of bounds
> even when obviously beneficial."

Authoring this document is itself not an R-1 violation. The same instruction that imposes the diff-surface budget
also mandates this deliverable, so it is sanctioned by construction. Its sibling deliverable,
[MIGRATION-DEPENDENCY-INVENTORY.md](MIGRATION-DEPENDENCY-INVENTORY.md), carries the dependency-level detail behind
the `marked`, `crypto-js`, `archiver` and `@hapi/shot` decisions referenced throughout this catalogue.

## How to read this catalogue

Every entry in sections 1, 2, 3 and 4 states four things:

- **What it is** — the observable behavior or condition.
- **Evidence** — the exact `file:line` citation, so the claim is checkable rather than asserted.
- **Why it is preserved** — which rule governs it, and what depends on it.
- **What a naive fix would have broken** — the concrete regression that was avoided.

Section 4 states those same four things and **three more**, because a security condition needs them: whether it is
baseline behavior or was introduced by the migration, whether it is **reachable in the shipped default
configuration**, and its **disposition** — `PRESERVED` or `REMEDIATED`. Exactly three remediations are recorded —
SEC-1, SEC-2a and SEC-4 — and for those the fourth bullet is inverted: it records what the remediation deliberately
did *not* change, with the measurement that proves it.

**Section 5 has a different shape.** It is a crosswalk rather than a catalogue: it maps the private quirk labels
used inside four source files onto the entries above, and doubles as the entry for the few labels that sections 1 to 3
do not cover. It is also the only section whose line numbers are migrated-frame rather than base-commit.

**Where to find what.** Sections 1 and 2 are the discrete quirks and the deliberate version skews. Section 3 holds
the R-6 adjudications: individual ambiguities decided against measured base-commit behavior. Sections 4 to 14 cover
the **systemic** preservations, which do not fit the one-quirk-per-entry shape:

| Section | Covers |
|---|---|
| 4 | the security-condition catalogue, SEC-1 … SEC-12, with reachability and disposition per condition |
| 5 | the crosswalk from the private quirk labels used inside four source files to the entries above |
| 6 | the pending / convergence decision table: every branch converted to a never-settling response, and why |
| 7 | the mechanisms measured during the conversion — the error map, the responders, the censuses |
| 8 | the retired shim's response mechanics, the five derived rules, and the three fates a failing branch could have |
| 9 | every no-response and process-fate preservation, site by site, with its fate and its base-commit mechanism |
| 10 | the 61 undeclared-`Boom` call sites that have never returned the status they name |
| 11 | `lib/util/legacyUrl.js`, the faithful port of the deprecated URL parser |
| 12 | the streaming restoration, the explicit SSRF decision, the two dependency advisories, and the `node-config` loader-prototype defect |
| 13 | the test-suite restoration adjudications |
| 14 | the R-6 parity harness, what it proves, and the gated crypto normalization |

Sections 6, 7 and 8 are the ones to read first if a source comment says only *"see docs/PRESERVED-QUIRKS.md"*: the
great majority of those comments are appeals to the mechanical rules recorded there.

**Citation frame — two frames, and which one applies where.** An earlier revision of this section claimed a single
uniform frame: *"all `file:line` citations are given against the base commit."* That claim was **not true of the
whole document**, and stating it uniformly made a reader who checked a section-13 citation against the base commit
conclude the citation was broken when it was not. The rule as it actually stands, verified citation by citation:

- **Default — the base commit.** Sections 1, 2 and 3 cite the base commit, because that is the reference frame R-6
  establishes and the frame in which each behavior was measured. Line numbers in files this changeset rewrote have
  since moved, and the base-commit number is the one recorded, because it is the number at which the behavior was
  observed. Example: `lib/controllers/pages.js:L17` is `return reply.redirect('/home');` at the base commit; that
  line does not exist in the delivered tree at all, since the whole point of section 1.1 is that the call was
  replaced by a `throw` that reproduces its effect. The most visible other example is `package.json`, whose
  `"license"` key sits at L99 at the base commit and earlier in the file after the manifest was rewritten.
- **The delivered tree — sections 5, 9, 13 and 14, and the delivered-state rows elsewhere.** These sections describe
  code that **this changeset added**, so a base-commit citation would be meaningless. Section 5 is the label
  crosswalk and is migrated-frame throughout; the site table in section 9 lists the never-settling reproductions,
  which exist only in the delivered tree; section 13 cites the restored test helpers; section 14 cites the harness.
  Sections 12.3 and 12.4 also cite the delivered tree, because the question they answer — *is the vulnerable call
  reachable in the shipped code* — is about the shipped code.
- **Explicit marking.** Where the surrounding prose reads present-tense but the cited code exists only at the base
  commit, the citation is prefixed **`2f8712a:`** so the frame is unambiguous rather than inferred.

**Measured, so the rule is checkable.** Counting a citation as one `path:Lnumber` reference, deduplicated per
document line, and resolving a range against its first line, this document and its sibling carry **195** citations.
**12** of them point into `node_modules/` — into `bull`, `@hapi/shot` and `config` — and are versioned by the
committed lockfile rather than by either frame. The remaining **183** point at repository files and break down as:
**44** cite a line whose text is identical in both frames and are therefore frame-agnostic; **14** cite code that
exists **only** at the base commit, and those fall in exactly three files — the retired shim
`lib/util/routeParser.js`, the deleted `lib/auth/passport.js`, and `app.js`, whose `L356` promise export moved
upwards when the `Promise.prototype` patches were deleted; **1** cites a file that exists **only** in the delivered
tree (`test/baseline/capture.js`, in section 12.4); and the remaining **124** differ between the frames and are
governed by the two rules above. **Zero** citations resolve under neither frame.

Every citation was re-resolved against both `git show 2f8712a:<path>` and the delivered file after the last edit to
this document. **Three resolved under neither frame and were corrected**, each by reading the target line rather
than by adjusting arithmetic: `app.js:L155-L157` to `L161-L163` for the `isApiRequest` predicate, at three harness
sites; `app.js:L102` to `L103` for `maxCookieSize: 0`; and the `gleak` guard block to a single `L29-L36`, which the
two documents had been citing as different ranges.

**Sections 1 to 3 versus section 4.** Sections 1, 2 and 3 catalogue conditions the migration **left alone**: quirks it
declined to fix, version skews it declined to reconcile, and ambiguities it resolved against the base commit. Section 4
catalogues the conditions that had to be **actively restored**, because the migration's first pass had already converted
them — twenty-six branches that answered nothing at the base commit and had begun answering a status code, plus the
adjudications that surround them. Section 4 is therefore the one section whose `file:line` citations are given against
the **current** tree rather than the base commit, for the reason stated at its head.

**Tense, and the delivery status of the test tree.** An entry that says a repair *was made* means the change is in
the tree. An earlier revision of this subsection carried a **pending** table: at that point five test-tree edits had
been adjudicated here but not yet written, and the entries that describe them said so in those words. **All five are
now delivered**, and each row below is measured rather than asserted.

| Adjudicated work | Owning file | Measured state | Entry |
|---|---|---|---|
| Resolve the exported promise before binding the listener | `test/helpers/flow.js` | `L18-L22` capture `resolvedServer` through `app.then(…)`; `agentFor()` at `L454-L464` binds `resolvedServer.listener` at `L461`; `test/setup.js:L113-L121` awaits `app` in a root `mochaHooks.beforeAll` | §1.14 C |
| `url.parse` → the differential-tested legacy helper in the harness | `test/helpers/flow.js`, `test/lib/api/registration.js` | `require('url')` is gone from both; `flow.js:L433` and `registration.js:L103` call `legacyUrl.pathname()` | §3.13 |
| Repoint the catbox helper at the in-repo engine | `test/helpers/catbox-redis.js` | the unscoped `catbox-redis` require is gone; the helper stubs five prototype methods of the in-repo `lib/util/catbox-mongoose.js` engine | §3.7 |
| Convert the legacy three-argument `sinon.stub` calls | `test/setup.js`, `test/helpers/catbox-redis.js`, `test/helpers/queue.js`, `test/lib/models/trinket.js` | a re-census finds **zero** three-argument `sinon.stub` calls and **zero** `.reset()` calls in test code, against **14** `.callsFake(` and **6** `.resetHistory(` sites | §3.7, §3.8, §13.3 |
| The capture and replay harness, and the route-parity suite | `test/baseline/capture.js`, `test/baseline/replay.js`, `test/lib/api/route-parity.js` | all three committed — 1,573, 456 and 387 lines — with both scripts guarded by `require.main === module` | §3.8, §3.9 |

Everything else in this catalogue describes the tree as it stands.

## 1. The thirteen catalogued quirks

All thirteen were verified at the cited lines against the base commit. The five numbered items in section 1.14 are
further preserved conditions of the same kind, recorded so that they are not mistaken for oversights either.

These thirteen are the *functional* quirks. They are **not** the whole preservation record: the twelve
security-relevant conditions are catalogued separately in [section 4](#4-the-security-condition-catalogue), because
they carry reachability and disposition information that a functional quirk does not need. Two entries appear in both
places from different angles — quirk 1 (the authenticated 500) is the reason SEC-4's remediation must not "repair"
the property-form redirects, and quirk 10 (the unchecked-`err` reCAPTCHA path) is a security condition in its own
right — and each cross-references the other.

| # | Quirk | Primary evidence |
|---|---|---|
| 1 | Authenticated `GET /login` and `GET /signup` return HTTP 500 | `lib/controllers/pages.js:L17`, `L27` |
| 2 | The Joi custom-message override that never fires | `lib/util/routeParser.js:L530-L534` |
| 3 | `package.json`'s `main` points at a directory that does not exist | `package.json:L5` |
| 4 | The `isKnownTrinketType` / `isTrinketTypeEnabled` asymmetry | `lib/util/features.js:L79-L87` |
| 5 | The 1000 ms race workaround and the `"does not exists"` typo | `lib/util/file.js:L106`, `L118` |
| 6 | `test/smoke-test.sh` defaults to port 3001, everything else 3000 | `test/smoke-test.sh:L7`, `L10` |
| 7 | Two orphaned SCSS entry points, and no `.css.map` emitted under `public/css` | `vite.config.mjs` |
| 8 | `npm run setup-vendor` does not exist but two documents cite it | `docs/overview.md:L37`, `COMPONENTS.md:L5` |
| 9 | The client-shipped AES key | `lib/util/roles.js:L13` |
| 10 | The unchecked-`err` crash path in reCAPTCHA verification | `lib/util/recaptcha.js:L18` |
| 11 | The permanently-`undefined` `server` parameter | `lib/util/routeParser.js:L594` vs `L71` |
| 12 | The leftover `console.log` calls — **64** matching lines at the base commit, **64** now (**59 → 57** calls) | 64 base-commit sites across `app.js`, `config/`, `lib/`, `scripts/` |
| 13 | The permanently no-op `gleak` machinery | `app.js:L29-L36`, `L317-L339`, `L341-L345`, `L348` |

### 1.1 Authenticated `GET /login` and `GET /signup` return HTTP 500

This is the single most consequential entry in the catalogue, because it is the one a competent implementer is most
likely to repair by accident while doing nothing other than the migration itself.

**What it is.** A request to `/login` or `/signup` carrying a valid session cookie returns **HTTP 500** and renders
`50x.html`. The same two routes return **200** when the request is unauthenticated.

**Evidence.** The compatibility shim's synthetic `reply` is a **bare function with no `.redirect` property**. The
Hapi-16 *property-form* calls `reply.redirect('/home')` at **`lib/controllers/pages.js:L17`** and
`reply.redirect('/welcome')` at **`lib/controllers/pages.js:L27`** — both inside `if (request.auth.isAuthenticated)`
— therefore raise a `TypeError`. That `TypeError` is caught by the single catch-all at
**`lib/util/routeParser.js:L578-L589`**, which returns `Boom.badImplementation(err.message || String(err))` at
**L587**, producing HTTP 500. The first `onPreResponse` extension at **`app.js:L152-L201`** then renders that 500 as
`50x.html`.

The authenticated behavior was **measured live**: a user was created through the application's own model, logged in
over real HTTP, and the routes were replayed with the resulting session cookie. Both returned 500. The project's own
technical specification implies that the property-form redirect works; measurement contradicts it, and measurement
wins. That resolution is recorded again as adjudication 3.1.

**Why it is preserved.** R-4. A client that has depended on this response for years — a monitoring probe, a
redirect-follower, a cached error page — observes a 500, not a redirect. Turning it into a redirect is a behavior
change on a login page, which is precisely the class of change R-4 prohibits.

**What a naive fix would have broken.** Converting `reply.redirect(...)` to the native `h.redirect(...)` is the
obvious mechanical translation, and it would have silently turned this into a **302**. Nothing in the test suite
would have caught it; the change would have looked like a correct migration and shipped as one.

**What was done instead.** The converted handlers **throw the equivalent internal error**, reproducing the 500
exactly, and each carries a source comment citing this document so the next reader does not undo it.

### 1.2 The Joi custom-message override that never fires

**What it is.** Two route declarations attach a friendly, user-facing validation message for the `username` field.
The message never reaches a user. The raw technical validation message does.

**Evidence.** `config/routes.js:L91-L95` and `config/routes.js:L112-L116` each declare a `language` block mapping
the key **`"regular expression"`** to the message
`"Usernames must begin with a letter and must only contain alphanumeric characters and hyphens (-)."` The lookup at
**`lib/util/routeParser.js:L530-L534`** treats that key not as a field name but as a **pattern to match against
Joi's own message text**:

```javascript
var msg = _.find(language[fieldPath], function(custom, match) {
  return !!err.message.match(new RegExp(match));
});
validationErrors[fieldPath] = msg || err.message;
```

Joi's actual pattern-failure message does not contain the phrase `regular expression`, so the `_.find` returns
`undefined` and the fallback `err.message` — the raw technical string — is what reaches the client.

**Why it is preserved.** R-4. The technical message is the observed validation output at the base commit, and
validation outcomes are on the preservation list. Preservation here required **zero action**: `joi` 18.2.3's message
string was measured **byte-identical** to 17.13.3's across six differential cases, so the version bump carries the
defect forward automatically. The full differential is recorded as adjudication 3.5.

**What a naive fix would have broken.** Repairing the lookup so the friendly message fires would change the body of
every username validation failure — a client-visible payload change on the registration path.

### 1.3 `package.json`'s `main` points at a directory that does not exist

**What it is.** The manifest's entry point is wrong and has been for years.

**Evidence.** `package.json:L5` declares `"main": "app/app.js"`. There is **no `app/` directory** in the
repository. The real entry point is `./app.js`, which is what the Dockerfile's `CMD` and every documented command
invoke.

**Why it is preserved.** R-1. Nothing reads the `main` field: the application is started by path, not by
`require('trinket')`. Correcting it is latent-bug repair, which R-1 places out of bounds even though the correction
is obvious and free.

**What a naive fix would have broken.** Nothing functional — and that is exactly the point. A hunk that fixes it is
a hunk attributable to none of the four sanctioned diff categories, which is itself the violation.

### 1.4 The `isKnownTrinketType` / `isTrinketTypeEnabled` asymmetry

**What it is.** An unknown trinket language is reported as *not known* and, separately, defaults to *disabled*. The
two predicates disagree in a way that makes 20 routes permanently unreachable.

**Evidence.** `lib/util/features.js:L38` carries the comment `// Unknown types default to disabled for safety`,
followed by `return false;` at **L39** — which directly contradicts the comment two branches above it at **L33**,
`// Check if explicitly set; default to true if not specified`. `isKnownTrinketType` is declared at
**`lib/util/features.js:L79-L87`** and returns `trinketFeatures.hasOwnProperty(lang)`, having already returned
`false` at L83 when the feature block is absent altogether. `config/default.yaml` enables only
`features.trinkets.python`, so ten of the eleven `trinketLangs` are disabled.
`helpers.trinketTypeEnabled` at `lib/util/helpers.js:L211-L236` (base-commit numbering; `L222-L247` in the delivered
tree) is where the two predicates meet: it derives `urlLang` from the first path segment, adopts it as `lang` **only**
when `isKnownTrinketType(urlLang)` is true, allows the request through when no `lang` was determined at all, and
answers `Boom.notFound('This trinket type is not available')` when `isTrinketTypeEnabled(lang)` is false.

**Why it is preserved.** R-4, and it is load-bearing for the parity evidence: this asymmetry is the **direct cause of
20 of the 22 baseline 404s** in the response corpus recorded in the appendix. `test/baseline/responses.json` records
them as `gates.languageFlagFourOhFours: 20` — the **ten disabled languages** of `config/constants.js`'s eleven
(`R`, `blocks`, `console`, `glowscript`, `glowscript-blocks`, `html`, `java`, `music`, `pygame`, `python3`; every
language except `python`) at their **two parameterless paths each**, `/<lang>` and `/<lang>/`. Preserving the
asymmetry is what keeps those 20 routes returning 404.

One further measured detail belongs with those 20, because it decides what a parity replay can assert about them: the
`Boom.notFound('This trinket type is not available')` message the `trinketTypeEnabled` pre-handler throws is **not
observable** on any of them. The request is not under `/api/` and accepts HTML, so the first `onPreResponse` at
`app.js:L152-L201` renders `404.html` in place of the Boom payload, and the corpus records a rendered HTML body with
status 404 rather than a JSON `message`. The enumerated paths are in
`test/baseline/responses.json#gates.languageFlagFourOhFourPaths`, and the two Boom-JSON 404s below — where the message
*is* observable — are in `gates.boomJsonFourOhFourPaths`.

The remaining **two** 404s in the corpus are unrelated to this quirk and must not be attributed to it:
`GET /api/trinkets/active` and `GET /api/trinkets/popular` answer a **Boom JSON** 404 from the `validLang`
pre-handler in `lib/util/helpers.js`, recorded as `gates.boomJsonFourOhFours: 2`.

**Where the figure 25 came from, and why it is right.** The Technical Specification's §0.7.5 corpus tally —
`25 × 200, 7 × 401, 25 × 404, 1 × 500` — is **exact**, and it is the gate. It reports the status each route
*resolves* to; the 404 count in this section reports the status each route answers on its **first hop**. Following
each 3xx back onto the same application closes the gap arithmetically: 3 of the 16 redirecting routes resolve to a
feature-flag 404, so 22 + 3 = 25, and the other 13 resolve to 200, so 12 + 13 = 25. `test/baseline/responses.json`
records both readings — `gates.firstHopStatusDistribution` `{200: 12, 302: 16, 401: 7, 404: 22, 500: 1}` and
`gates.documentedDistribution` `{200: 25, 401: 7, 404: 25, 500: 1}` — and sets
`gates.distributionMatchesDocumented: true`. Section 3.38 records the adjudication and the appendix entry
**Response corpus** carries the full reconciliation.

The first-hop count is stated as measured. §0.7.5 of the Specification says "25 at 404" for the resolved reading, and
an earlier draft of this document read that as a contradiction. Two independent captures from the exact base tree
measure **22** on the first hop, and they partition by cause rather than sharing one: **20** are the language
landing and
trailing-slash pages produced by the `config/routes.js` language loop over the 10 disabled entries of the 11
`trinketLangs` in `config/constants.js` — `/R`, `/R/`, `/blocks`, `/blocks/`, `/console`, `/console/`, `/glowscript`,
`/glowscript/`, `/glowscript-blocks`, `/glowscript-blocks/`, `/html`, `/html/`, `/java`, `/java/`, `/music`,
`/music/`, `/pygame`, `/pygame/`, `/python3`, `/python3/` — and those 20 are this section's asymmetry. The remaining
**2** are `GET /api/trinkets/active` and `GET /api/trinkets/popular`, which return a Boom JSON 404 for an unrelated
reason: `helpers.validLang` derives the `urlLang` `"api/trinkets/active"` and does not find it among
`Trinket.schema.path('lang').enumValues`. Attributing those two to the feature flags would be wrong. The full
per-status derivation is in `test/baseline/responses.json`. The three redirecting routes that join them in the
resolved reading — `/r → /R`, `/vpython → /glowscript` and `/webvpython → /glowscript` — are language aliases whose
targets are themselves in the 20, so the resolved 404 class is 23 flag-driven plus the same 2 Boom-JSON 404s.

**What a naive fix would have broken.** Aligning the two predicates would make some or all of those 20 routes
reachable, which is simultaneously a status-code change on 20 routes and the addition of features — excluded
explicitly by the request's own exclusion list.

### 1.5 The 1000 ms race workaround and the `"does not exists"` typo

**What it is.** Snapshot upload is gated behind an unconditional one-second delay, and the failure message
contains a grammatical error that may already appear in logs and in client-visible error text.

**Evidence.** `lib/util/file.js:L106` carries the comment `// strange but seems necessary in certain
situations...`; the `setTimeout` opens at **L107** and closes with `}, 1000);` at **L121**; `fs.exists` is called at
**L108**; and the message typo **`"Snapshot does not exists: "`** is at **L118**.

**Why it is preserved.** R-4 on both counts. The `fs.exists` callback was converted to `await
fs.promises.access(...)` inside a `try`/`catch` — that conversion is squarely inside the sanctioned async-conversion
category — but the **1000 ms delay and the typo both stay**. The delay stays because removing it changes
timing-dependent behavior that the original author observed to be necessary. The typo stays because the string is
observable: it is constructed into an `Error` that reaches logs and error responses.

**What a naive fix would have broken.** Removing the delay would reintroduce whatever race the comment records,
intermittently and only under load. Correcting the grammar would change an observable string, and would be pure
style normalization, which R-1 excludes.

### 1.6 `test/smoke-test.sh` defaults to port 3001 while everything else publishes 3000

**What it is.** The smoke-test script probes a port that nothing in the project listens on by default.

**Evidence.** `test/smoke-test.sh:L7` is the comment `# Default: http://localhost:3001` and **L10** is
`BASE_URL="${1:-http://localhost:3001}"`. Against that, `docker-compose.yml` publishes **`3000:3000`** and
`Dockerfile` declares **`EXPOSE 3000`**, while `docs/setup.md` documents **`http://localhost:3000`** in its Quick
Start and `app | 3000` in its Services table.

**Why it is preserved.** R-1. The script accepts a base URL as its first positional argument, so the mismatch is a
default-value defect, not a functional break. Correcting the default is latent-bug repair.

**What a naive fix would have broken.** Any operator or wrapper script that already passes `3001` deliberately, or
that relies on the documented default, would change behavior. The mismatch is therefore **documented, not corrected,
in all three places**: `test/smoke-test.sh` receives a comment-only change pointing at this document, and the
documentation keeps 3000 and never mentions 3001.

### 1.7 Two orphaned SCSS entry points, and no `.css.map` files despite source maps being enabled

This entry is two distinct findings that share one cause: the build configuration is narrower than the source tree
and narrower than its own settings suggest.

**What it is.** Two files shaped exactly like build entry points are compiled by nothing, and source maps are
requested but never emitted.

**Evidence.** `vite.config.mjs` declares **exactly two rollup inputs** — `base` resolving to
`static/scss/base.scss` and `embed` resolving to `static/scss/embed/embed.scss` — alongside `outDir: 'public'`,
`emptyOutDir: false`, an `assetFileNames` function returning `'css/[name].css'` for CSS, and `cssCodeSplit: true`:

```javascript
input: {
  base: resolve(__dirname, 'static/scss/base.scss'),
  embed: resolve(__dirname, 'static/scss/embed/embed.scss'),
},
```

Consequently **`static/scss/download/course.scss` and `static/scss/publish/generic/generic.scss` are compiled by
nothing.** Both files exist on disk. The project's own technical specification lists `download/course.scss` as a
build entry point; that claim is **aspirational and contradicted by the configuration**.

Separately, the same file sets **`sourcemap: true`**, yet a post-build scan of **`public/css`** — the directory the
`assetFileNames` pattern writes into — finds **no `.css.map` file at all**. The claim is scoped to Vite's own output
deliberately: two `*.css.map` files do exist elsewhere under `public/`, namely
`public/components/foundation/css/foundation.css.map` and `public/components/foundation/css/normalize.css.map`, and
both are **vendored** — they arrive inside the release tarball that hydrates the gitignored component tree and no
build step produces them.

**Why it is preserved.** Both stay because the emitted asset surface is frozen. The build produces exactly two CSS
artifacts, whose byte counts and digests are recorded in the appendix and re-verified after the change. Adding
rollup inputs would emit **new artifacts at new URLs**; making source maps actually emit would add **new asset
URLs**. Either change perturbs the asset-URL contract that the preservation directives place off-limits.

**What a naive fix would have broken.** Registering the two orphans as inputs looks like completing an unfinished
job. It would in fact publish two stylesheets that no page requests, at two URLs that did not previously exist, and
it would risk changing the two real artifacts if the orphans share partials. Emitting `.css.map` files would add two
further URLs and change the trailing bytes of both stylesheets.

### 1.8 `npm run setup-vendor` does not exist, yet two documents instruct readers to run it

**What it is.** Two documents tell the reader to run an npm script that the manifest does not declare.

**Evidence.** The instruction appears at **`docs/overview.md:L37`** — "For local installs you can run
`npm run setup-vendor` to fetch the required components." — and at **`COMPONENTS.md:L5`** — "Run
`npm run setup-vendor` to install required components." `package.json` declares exactly **five** scripts —
`test`, `build:css`, `watch:css`, `build`, `make-admin` — and `setup-vendor` is not among them.

**Why it is preserved.** R-1. Adding the script would be a new feature; rewriting the two sentences would be
documentation repair outside the four sanctioned diff categories. Both references are therefore **left
uncorrected**, byte-for-byte.

**What a naive fix would have broken.** Nothing at runtime — but the hunk would be unattributable, and inventing a
`setup-vendor` script would add a new, untested entry point to the manifest.

**What was done instead.** A *working* path was documented beside the broken sentence, **without touching either
broken line**. `npm run build` now runs `node scripts/hydrate-components.js` before Vite; that script unpacks the
same 166,464,007-byte `v1.1.0` asset the Dockerfile fetches, after checking it against a pinned byte length and
SHA-256 digest, and both `docs/setup.md` and `COMPONENTS.md` describe it alongside the equivalent manual `curl`.
Only the **value** of the existing `build` script changed; no script **key** was added, so `package.json` still
declares exactly those five scripts and `npm run setup-vendor` still fails exactly as it did at the base commit. The
reader now has a command that works; the broken sentence remains beside it, catalogued here.

### 1.9 The client-shipped AES key

**What it is.** The application encrypts the role payload with a freshly generated key and then ships that key to
the browser alongside the ciphertext.

**Evidence.** `lib/util/roles.js:L13` returns **`token + '+' + encrypted`**, where `token` is the
`crypto.randomBytes(16).toString('hex')` value generated at **L10** and used as the AES passphrase at **L11**. The
browser splits the two halves and decrypts at **`public/js/trinket-roles.js:L10-L11`**:

```javascript
var d = CryptoJS.AES.decrypt(e, t);
roles = JSON.parse(CryptoJS.enc.Utf8.stringify(d));
```

**Why it is preserved.** This is **obfuscation, not security**, and therefore not something this change may "fix".
The wire format is part of the client contract: `public/js/trinket-roles.js` is frozen frontend code that expects
exactly the `key + '+' + ciphertext` envelope. R-4 governs, and the request's preservation list independently
freezes client-visible page behavior.

**What a naive fix would have broken.** Moving to a server-held key, or changing the envelope, would break
role decryption in every browser immediately — the frozen client-side decryptor would receive a payload it cannot
split or cannot decrypt.

The dependency swap underneath this quirk was chosen precisely so the format could not drift: `node-cryptojs-aes`
was replaced with `crypto-js` 4.2.0 only after bidirectional decryption was proven bit-compatible — both emit the
OpenSSL `Salted__` / MD5-EvpKDF envelope, and ciphertext length is 88 in both directions. See
[MIGRATION-DEPENDENCY-INVENTORY.md](MIGRATION-DEPENDENCY-INVENTORY.md) for that verification.

### 1.10 The unchecked-`err` crash path in reCAPTCHA verification

**What it is.** A transport-level failure during reCAPTCHA verification dereferences `undefined` instead of being
handled.

**Evidence.** `lib/util/recaptcha.js:L17` takes the callback `(err, response, body)` and **L18** reads
`if (response.statusCode === 200) {` **without checking `err` first**. When the HTTP call fails, `response` is
`undefined` and the property access throws.

**Why it is preserved.** R-4 and R-5 together. The observed behavior at the base commit is that a reCAPTCHA
transport failure produces a failure, and R-5 requires the error-to-response mapping to survive the conversion
unchanged. The `request` → `fetch` conversion preserves it: the failure mode remains a failure, not a graceful
fallback.

**What a naive fix would have broken.** Adding an `if (err)` branch that returns `{ success: false }` — or worse,
`{ success: true }` — changes the outcome of a spam-protection check on a transport error. Either direction is a
behavior change on the registration path: one turns a hard failure into a soft rejection, the other opens a bypass.

### 1.11 The permanently-`undefined` `server` parameter

**What it is.** A two-parameter function is called with one argument, everywhere, so its second parameter is
`undefined` on every invocation for the lifetime of the program.

**Evidence.** `lib/util/routeParser.js:L594` calls `convertPreHandlers(route.options.pre)` with **one** argument,
against the **two-parameter** signature declared at **`lib/util/routeParser.js:L71`**:

```javascript
function convertPreHandlers(pre, server) {
```

**Why it is preserved.** R-6. The behavior that follows from `server` being `undefined` is the observed baseline
behavior, so the resolution was **adjudicated against baseline rather than "improved"** — recorded as adjudication
3.11 in the pre-handler context and reflected in how the extracted pre-handler module resolves string-form
references.

**What a naive fix would have broken.** Threading the real server object into the second parameter would activate
code paths that have never executed in production. Any behavior that emerges from them is new behavior by
definition, and the 233-row route table plus the response corpus would be evidence of nothing, because the thing
being compared would have changed.

### 1.12 The leftover `console.log` calls — 64 at the base commit, 64 now

**What it is.** The codebase writes unstructured log lines to standard output alongside its real logger. At the base
commit the cited source surface carries **64** `console.log` matching lines — **59** in server-side JavaScript and
**5** browser-side calls embedded in three Nunjucks templates — and three of the server-side ones fired on every
single request.

**Evidence, with the census decomposed.** The census command is
`grep -rn "console\.log" app.js config/ lib/ scripts/ | wc -l`, measured against both commit `2f8712a` and the
independent base-commit checkout. Its headline number is **64 at the base commit and 64 now** — but that single
number mixes three different things, so all three are stated separately:

| Measurement | Base commit | Current tree |
|---|---|---|
| the census command above, counting every **matching line** | 64 | 64 |
| of which are in `.js` files (add `--include=*.js`) | 59 | 59 |
| of which are **browser-side**, inside `lib/views/**.html` templates | 5 | 5 |
| comment-stripped `console.log(` **call expressions** in those `.js` files | 59 | **57** |

The five template hits are in `lib/views/base.html` (2), `lib/views/admin/index.html` (2) and
`lib/views/admin/includes/featured-courses.html` (1). They are client-side script inside Nunjucks templates, they
never run in the server process, and `lib/views/**` is frozen, so they could not move even if they were noise.

Three of the server-side sites fired on **every request**: `lib/util/routeParser.js:L311`, **L544** and **L550**, the
middle one being:

```javascript
console.log('ROUTE: Calling handler for', request.method, request.path);
```

**Why it is preserved.** R-1, and this is the most tempting cleanup in the entire codebase, so it is stated
plainly: **every measured `console.log` other than those three stays.** The current count over the same source
surface is therefore **62 calls** — 57 server-side JavaScript calls plus the 5 frozen template calls — behind an
unchanged headline of 64 matching lines, for the reasons decomposed below. Removing logging to
reduce per-request overhead is **not a sanctioned diff category**. Performance is explicitly incidental to this
change and may not be used to justify any hunk.

The three per-request traces disappear **only** because they live inside the deleted compatibility mechanics — they
were part of the shim's synthetic-reply machinery, and the shim's removal is squarely inside the framework-migration
category. They were not removed for being noisy.

> **Reconciling the count after the change — measured, and it is not a one-line drop.** The headline census is **64
> at the base commit and 64 now**, because the command counts *matching lines* and three separate movements cancel.
> `lib/util/routeParser.js` goes from **3 matching lines and 3 calls to zero of either** — exactly the three
> per-request traces above, which left with the shim machinery. `lib/controllers/users.js` goes from **18 lines and 18
> calls to 20 lines and 18 calls**: the two additions are *comments that mention* `console.log`, which a line-counting
> command also matches, while its 18 real calls are untouched. And `scripts/hydrate-components.js`, a file this
> changeset creates, contributes **1** of each. That is `59 - 3 + 2 + 1 = 59` matching `.js` lines and
> `59 - 3 + 0 + 1 = 57` comment-stripped calls, with the 5 template lines unchanged either way. No other file in
> `app.js`, `config/`, `lib/` or `scripts/` moves at all. Earlier drafts of this section reported the post-change
> headline as **63** and as **61**; both were wrong, and the table above is the corrected measurement. **No
> `console.log` call outside the deleted shim machinery was removed**, which is the invariant this section exists to
> protect.

**What a naive fix would have broken.** Nothing observable to an HTTP client — but deleting the **57** server-side
calls that remain would carry 57 unattributable hunks, and any operator grepping container logs for `ROUTE:` or for
one of the other traces would lose their signal.

### 1.13 The permanently no-op `gleak` machinery

This entry needs its full mechanics stated, because it looks exactly like the dead code that R-2 would demand be
removed, and it is not.

**What it is.** A global-leak detector is wired into the bootstrap, polls every sixty seconds forever, and does
nothing at all, because the package it depends on is not present.

**Evidence.**

- **`app.js:L29-L36`** is a guarded optional `require` with a working no-op fallback:

```javascript
let gleak;
try {
  gleak = require('gleak')();
} catch (e) {
  gleak = { detectNew: () => [], ignore: () => {} };
}
```

- **`app.js:L317-L339`** defines `detectLeaks`, which contains an **`eval(name)`** at **L323**.
- **`app.js:L341-L345`** whitelists exactly nine model globals — `User`, `Course`, `Lesson`, `Material`, `File`,
  `Trinket`, `Interaction`, `Folder`, `CourseInvitation` — plus nine further names: `log`, `NODE_CONFIG`,
  `tokenizer`, `$V`, `$M`, `$L`, `$P`, `DEFAULT_FILE_PATH`, `Promise`.
- **`app.js:L348`** installs `setInterval(detectLeaks, 60*1000);`, which is **never `unref`'d**.
- The package is **absent everywhere**: `grep -c gleak package.json` returns **0**, `grep -c gleak
  package-lock.json` returns **0**, and `node_modules/gleak` does not exist. The `catch` branch therefore always
  fires, `detectNew()` always returns `[]`, and the machinery is **permanently inert**.

**Why it is preserved, and why R-2 does not reach it.** R-2 reads, verbatim:

> "Container images may not be pinned to an old runtime as a workaround, and dead packages may not be vendored into
> the repository to keep them alive."

`gleak` is **neither declared nor vendored**. It is absent from the manifest, absent from the lockfile, and absent
from the installed tree. There is no dependency being kept alive, so there is nothing for R-2 to prohibit. What
remains is repository-owned source code with a working fallback — and removing working source code because it
currently does nothing is architectural improvement, which R-1 places out of bounds. The nine whitelisted model
globals are also independent corroboration of a hard constraint elsewhere: they are the same nine names that
`app.js` assigns without declaration, which is legal only in sloppy mode and is the decisive reason this codebase
stays on CommonJS.

**What a naive fix would have broken.** Deleting the block, or `unref`-ing the interval, changes observable process
behavior. The un-`unref`'d interval is one of the three things that hold the event loop open after a test run, which
is exactly why `.mocharc.json` must carry `"exit": true` — see adjudication 3.8. Removing the interval would appear
to make the explicit exit unnecessary, quietly coupling two unrelated decisions and changing how the process
terminates.

### 1.14 Five further preserved conditions

These five are the same kind of deliberate decision as the thirteen above and are recorded so that they are not
mistaken for oversights.

**A. The pre-existing 500 at `GET /api/users/assets`.** One of the 58 responses in the baseline corpus is a 500,
and it is this route. It is **reproduced, not repaired**. The **route-parity criterion** of the request's own
validation framework — the R-6 obligation to ship a captured corpus and replay it — compares the replayed responses
against the captured ones; a route that starts returning 200 fails that comparison just as loudly as one that starts
returning 500. A naive repair would have turned the single most obvious "bug" in the corpus into a parity failure.
It is delivered as a Boom JSON payload rather than a rendered `50x.html`, recorded as
`gates.serverErrorDeliveredAs` in `test/baseline/responses.json`.

**B. The licence drift.** `package.json:L99` declares `"license": "MIT"` while `README.md:L111` and
`docs/index.md:L17` both state **CC0 1.0 Universal (Public Domain Dedication)**. This is logged and deliberately
unreconciled: reconciling it falls outside the four sanctioned diff categories, and choosing which of the two is
correct is a legal decision, not an engineering one. **No inline caveat was added to either document** — annotating
them would itself be the documentation edit R-1 excludes.

**C. `app.js:L356` exports a Promise rather than the server.** The bootstrap ends with
`module.exports = serverPromise;`. This is the root cause of the test harness being unable to attach:
`test/helpers/flow.js` binds `app.listener`, which on a Promise is `undefined`, and `supertest(undefined).get('/')`
was measured to throw `TypeError: Cannot read properties of undefined (reading 'address')`. The promise export is a
direct consequence of the asynchronous bootstrap — `await server.register(...)` and `await server.start()` — and it
**stays**.

**Status: delivered.** The repair is in `test/helpers/flow.js`, which still requires `../../app.js` (now at `L10`)
but no longer reads `app.listener`. It declares `var resolvedServer = null;` at `L18` and attaches
`app.then(function (server) { resolvedServer = server; });` at `L20-L22`, and the supertest agent is built **lazily**
by `agentFor(flow)` at `L454-L464` — `L461` reads `flow.agent = server(resolvedServer.listener);` and the guard above
it throws an explanatory error rather than a `TypeError` if it is ever reached before the promise resolved. What
guarantees it is not, is a **root hook**: `test/setup.js:L113-L121` exports `mochaHooks.beforeAll` as an `async`
function that `await`s `app` under a 60-second timeout. It has to be a root hook rather than a bare top-level
`before()`, because `test/setup.js` is loaded through Mocha's `require` option and therefore runs before the BDD
globals exist. Awaiting the promise there also puts the nine implicit model globals in place before Mocha takes its
`check-leaks` snapshot, which is why `check-leaks` stays enabled rather than being relaxed.

One further measured subtlety is recorded here because it is easy to get wrong: `app.js:L351-L354` — `L357-L360` in
the delivered tree — wraps `init()` in a `.catch()` that logs and calls `process.exit(1)` before the export, so **the
exported promise never rejects: it resolves to `undefined` on failure.** Code that awaits it must not rely on a
rejection to detect startup failure, which is exactly why the guard inside `agentFor` exists.

**D. `docker-compose.yml`'s dead `shared-cache:` volume and its legacy `links:` keys.** The `shared-cache:` volume
is declared at **L37** and mounted by no service. The `links:` keys at **L14-L16** name `redis` and `mongodb`, and
`links` has been a no-op in Compose v2 and later for years — service discovery happens over the shared
`trinket` network. Both are **preserved**: removing them is cleanup, and the file's in-scope change is confined to
the service images that the runtime bump requires.

**E. The session cache's TTL index is inert, and lazy per-read expiry is what actually works.**
`lib/util/catbox-mongoose.js:L19-L22` declares `sessionSchema.index({ stored: 1 }, { expireAfterSeconds: 0,
partialFilterExpression: { ttl: { $exists: true } } })` under the comment *"TTL index - automatically delete expired
sessions"* — but `stored` is declared at **L11** as `{ type: Number, default: Date.now }`, and MongoDB's TTL monitor
only acts on fields whose value is a `Date` (or an array of Dates). **The server therefore never reaps a single
session document.** Measured against the live `mongo:6` container: after `set(key, value, 1)` and a 30 ms wait the
document was **still present** in the collection, and only the subsequent `get()` removed it.
`db.sessions.getIndexes()` shows `stored_1` with `expireAfterSeconds: 0` and the partial filter exactly as declared,
while every document simultaneously matches `{ stored: { $type: 'number' } }` and none matches
`{ stored: { $type: 'date' } }`. Real expiry is the lazy per-read check at **L87** —
`if (record.ttl && (Date.now() - record.stored) > record.ttl)` — which deletes the record and returns `null`, so an
expired session is only cleared when it is read again.

**Both halves are preserved**, and both sites carry an inline comment pointing here. Typing `stored` as a `Date` "so
that the index works" would break three things at once. It would change the **persisted document shape**, which the
storage-format invariant freezes. It would move expiry from lazy-on-read to eager-server-side, changing when a
session stops being readable — a behavior change on the login path, where `app.js:L103`'s `maxCookieSize: 0` means
**100% of session state lives in this collection**. And it would break `@hapi/catbox` 12.1.1's own arithmetic:
`node_modules/@hapi/catbox/lib/client.js` computes `const expires = result.stored + result.ttl` on the value this
engine returns, so a `Date` there would concatenate instead of add, yielding `ttl: NaN` and a cache that reports
every expired entry as a live hit. The `Number` typing is a **requirement of the consumer**, not an oversight —
which is the strongest possible argument for leaving it alone. Dropping the unused index instead would be
straightforward cleanup, and cleanup is what R-1 forbids.

### 1.15 The branches that answer nothing, and the mechanism that preserves them

**What it is.** A handler under the retired compatibility layer had **three** terminal outcomes, not two. It could
return a value, it could reach a responder that settled the layer's out-of-band capture — or it could do neither, in
which case the request received **no response at all**. The third outcome was not rare and it was not theoretical: it
is what several controller branches did at the base commit, and it is preserved verbatim by
`lib/http/pending.js`, which exports `forever()` and its alias `hang()` — one promise that never settles, under
two names, because the converted controllers were written against both spellings — together with
`rejectOrHang(h, json, err)` for the branches whose baseline responder raised before it could answer.

**Evidence.** `lib/util/routeParser.js:L332-L335` created the capture and `L568-L570` consumed it:

```javascript
var responseResolver;
var responsePromise = new Promise(function(resolve) { responseResolver = resolve; });
…
var result = await handler.call(this, request, reply);
if (result === undefined) {
  result = await responsePromise;   // settled ONLY by the synthetic reply / success / fail
}
```

Nothing rejected `responsePromise` and nothing timed it out. A handler that fell off its end without settling the
capture left `await responsePromise` pending for the lifetime of the connection.

**Why it is preserved.** R-4 forbids behavior "improvements" and R-6 makes the base commit's observed behavior the
tie-breaker for exactly this kind of ambiguity. The technical specification sets the precedent itself in section
0.1.1.4 I4: the two property-form `reply.redirect` calls in `lib/controllers/pages.js` produce an HTTP 500 *only*
because of a defect in the shim, and "fixing" them into working redirects is called out there as a **prohibited
behavior change**. An outcome that is emergent from the shim is preserved, not converged. Section 0.4.1.1's
description of the capture as compatibility machinery "with no behavior of its own" is contradicted by measurement,
and where a specification characterization and a measurement disagree, R-6 awards it to the measurement.

**Measured semantics of the replacement.** Verified over real HTTP against a live `@hapi/hapi` 21.4.10 server:
returning a never-settling promise from a handler leaves the client with no response and no status code, exactly as
the unsettled capture did; the server stays up (`server.listener.listening` remains `true`) and **the next request on
any route is served normally**, so the effect is scoped to the one request; and nothing is logged and no error is
raised, which matches a base-commit callback that ignored its error argument. Returning `undefined` instead produces
hapi's *"handler method did not return a value, a promise, or throw an error"* and a scrubbed 500 — a status no
baseline request on these branches ever received, which is precisely the outcome this module exists to avoid.

One consequence is accepted rather than engineered around, and it is **log-only**. The one-second *"still going after
1s"* watchdog restored at `lib/util/routeParser.js` now times the native handler, whereas the base commit timed only
the handler *function* — so a bare-statement handler returned before the timer fired and the request then hung
silently. A branch that answers nothing now emits that single log line. No status, header or body differs either way.

**Membership in this section is a measured question, not an inferred one.** A branch is listed below only after being
reproduced against a verbatim replica of the base-commit wrapper running on `@hapi/hapi` **20.3.0** — the version the
base commit resolved — and observed to answer nothing. The distinction is easy to get wrong in the other direction,
because the synthetic responder was far more forgiving than it looks. `request.success({ course: undefined })` still
settled: `success` was `route.success || {}` so `success.redirect` was safely `undefined`, `ObjectUtils.serialize`
**drops** keys whose value is `undefined`, and the function ended at `h.response(json)`, which resolved the capture.
An error-ignoring callback that nonetheless reached a responder therefore answered **HTTP 200 with the flash and
context envelope**, not a hang. Those branches are *not* in this section and keep answering 200; converting one of
them to a pending response would be as much a behavior change as converting a genuine hang to a 500.

`lib/controllers/course.js` contains the exact pair that makes the distinction concrete, and the two look identical
at a glance. `archiveCourse` at `L160-L172` runs `course.save(function (err, course) { return request.success({
course: course }); })` — `err` discarded — so on a save failure it answered **`200 {"flash":[]}`**, measured.
`updateLesson` at `L252-L266` has the same shape but the callback reads `lesson.name` before calling the responder,
so the same failure raised a `TypeError` and answered **nothing**, also measured. One is preserved as a 200 (the
rejection is captured and the undefined value is handed to the responder) and the other as a pending response.
Reproducing the 200 is checkable on the migrated stack: a returned
`respond(request, h, { course: undefined }, 'json')` emits `200 {"flash":[]}`,
byte-identical to the base-commit measurement, because `lib/http/responseContract.js` keeps the same
projection-then-flash sequence and `lib/util/objectUtils.js` is unchanged since the base commit.

Two things this mechanism is explicitly **not**. It is not the deferred capture returning: nothing observes a
handler, and no later `request.success()` can turn the value into a response — it is inert. And it is not a blanket
policy: every use of it is a single greppable line, documented at its own call site with the measurement that put it
there, so a 500 arriving from the centralized error map always means a genuine error rather than a silently converted
quirk.

**What a naive fix would have broken.** Letting these branches fall through to hapi's missing-return error converts
a request that never completed into a deterministic 500. That inverts the observable contract twice over: a client
that previously timed out (and, for an idempotent GET, typically retried) now receives a definitive server error, and
the migrated corpus gains status codes at paths where the captured baseline corpus has none — a TR2 parity failure at
the exact routes R-6 nominates as the tie-breaker.

**Inventory.** Each row cites the base commit, states the measured base-commit outcome, and names the parity handling
now in the code. Line numbers are base-commit numbers, per the citation frame above.

| Controller branch (base commit) | Why it answered nothing | Parity handling |
|---|---|---|
| `admin.js:L158-L175` `updateUser` — a falsy `request.payload.roles` | `if (request.payload.roles)` has no `else`, so the lookup callback fell through without reaching any responder | `return Pending.forever()` |
| `courses.js:L22-L53` `create` — a falsy `response.result`, or a result carrying neither `.course` nor `.err` | both responder calls sit inside `if (response.result)` and neither test matched; the handler then resolved `undefined` | `return Pending.forever()` |
| `courses.js:L82-L98` `copy` — `Course#copy` reported an error | the callback discarded `err` and dereferenced `course.slug`, raising a `TypeError` inside a callback no promise chain owned | `if (!course) return Pending.forever()` after the awaited adapter |
| `courses.js:L265-L275` `returnZip` — `fs.stat` failed | `err` was discarded, the read stream was created, **the `rimraf` cleanup ran**, and only then did `stats.size` raise a `TypeError` in an unowned callback | the stat rejection is captured, the stream is created, the cleanup runs, then `if (!stats) return Pending.forever()` — the order is part of the parity |
| `folders.js:L63-L77` `create` — a duplicate-key save error (`err.code === 11000`) | `request.catch` has never existed, so the call raised `TypeError: request.catch is not a function` inside the save callback | the verbatim call is kept; its `TypeError` is contained and answered with `Pending.forever()` |
| `folders.js:L63-L82` `create` — any other save error | `reply({ err, message })` built the synthetic chainable builder and called no settling terminator, and the builder was returned into a save callback that discarded it | `return Pending.forever()` — **not** 200 `{}`, which only ever appeared when the builder itself reached hapi |
| `course.js:L252-L266` `updateLesson` — the save reported an error | `err` was discarded and the callback dereferenced the undefined `lesson` (`lesson.name`) before reaching the responder, raising a `TypeError` in an unowned callback | `catch (saveError) { return Pending.forever(); }` |
| `course.js:L574-L601` `userLookup` — a `result` carrying neither `.success` nor `.alreadyListed` | the `if`/`else if` has no `else`, so the callback and then the whole chain resolved `undefined` | `return Pending.forever()` at the fall-through |
| `trinket.js:L881` `share` — a mail-send or metrics failure whose error is not the string `"threshold exceeded"` | the second ternary arm called the synthetic responder with **no argument at all**, which built the chainable builder over an `undefined` body and called none of the four terminators that settled the capture | `return err === "threshold exceeded" ? errors.forbidden() : Pending.forever()` — the first arm's measured `403 {"…","message":"Forbidden"}` is kept as a returned Boom |
| `trinket.js:L1004-L1025` `draft` — a `"zipCode"` entry that decompresses but is not valid JSON | `JSON.parse` at `L1013` threw inside the success handler of the chain's second `.then`, and the whole chain was detached (`zip.loadAsync(…)` was a bare statement, never returned), so the rejection had no handler and the capture was never settled | the two rejection handlers keep answering `request.success()`; the parse is wrapped so only its own failure yields `return Pending.forever()` |
| `trinket.js:L1071-L1090` `autosave` — a `"zipCode"` entry that decompresses but is not valid JSON | identical shape to `draft`, with `JSON.parse` at `L1080`; the sibling branch where `loadAsync` itself rejected is **not** in this section, because there `reply(err)` had already settled the capture with `Boom.badImplementation` (HTTP 500) before the same parse threw | `if (code instanceof Error) return code;` reproduces the already-answered 500, and only the genuine parse failure yields `return Pending.forever()` |
| `users.js:L583-L617` `assetUploadFromURL` — the remote transfer failed, or the URL could not be turned into a request at all | the entire error handler was `.on('error', function (err) { console.log('on error:', err); })` at `L596-L598`, so a transfer failure logged and stopped there; a rejected scheme or a hostless URL threw synchronously out of `_request.get` at `L595`, inside the unowned `tmp.tmpName` callback and before that listener existed, so it did not even log. Neither path reached the `end` handler, so neither uploaded and neither settled the capture | the log line is kept and, as at the base commit, stays independent of the branch below it, then `if (!download.completed) return Pending.forever()`. The over-redirect-budget outcome is deliberately **not** in this row: it logged **and** went on to upload and answer 200 — see outcome (b) of `downloadRemoteAsset()`'s contract in section 3.18 |
| `users.js:L718-L724` `sendEmailChange` — every request that got as far as storing the new address | `lib/util/store.js` exports `set` as `async function (key, value)` — **arity 2**, at the base commit and now — so the third callback argument was accepted by the language and never invoked. Everything inside it was dead code: no confirmation email was sent and `request.success` never ran, so nothing settled the capture | the store write is still issued, because it was issued at the base commit too, with its rejection owned and discarded per section 3.17; **no email is sent**; `return Pending.forever()` |
| `users.js:L915-L919` `activateAccount` — the `Store.del` of the activation key rejected | the `await` sat inside an `async` callback handed to `request.yar._logIn`, which does not consume the promise it returns, so the rejection became an unhandled rejection and the flash and `request.success()` after it never ran | `try { await Store.del(…) } catch (delError) { return Pending.forever(); }` at the call site, deliberately **not** allowed to reach the handler's outer catch, which answers 200 with `redirectTo : 'activate-account'` — a payload this branch never produced, and one that would tell a user whose account *was* activated to go and activate it again |
| `users.js:L1026-L1060` `getExportStatus` — an export id no record matches, or a record owned by another user | `Boom` is not declared in this file, so `reply(Boom.notFound(…))` at `L1027` and `reply(Boom.forbidden(…))` at `L1031` raised a `ReferenceError` instead of answering the status they name. The inner catch logged it and then raised a **second** `ReferenceError` on its own `reply(Boom.internal(…))` at `L1059`, which escaped the unowned Mongoose callback; the outer try had already returned, so the outer catch never ran and its log line never appeared | every raising line is kept verbatim; the second raise is contained and answered with `return Pending.forever()`, leaving **exactly one** log line — the inner one — as measured |
| `users.js:L1077-L1091` `downloadExport` — a missing record, another user's record, an incomplete export, or an expired one | all four guards reference the same undeclared `Boom`, so each raised a `ReferenceError` inside the unowned Mongoose callback the instant `Boom.` was evaluated: no 404, no 403, no 400, no 500, and nothing logged | the four raising lines are kept verbatim inside **one** container whose `catch` returns `Pending.forever()`, because they share a single measured outcome; the container also catches an `_owner`-less record's `TypeError`, which raised in the same callback for the same non-answer, so nothing is widened by it |





## 2. The three deliberate browser-versus-server version skews

Three libraries exist twice in this project at two different versions: once as a browser-delivered copy pinned in
configuration, and once as an npm dependency used on the server. In every case the skew is **preserved on both sides
independently**.

| Library | Browser copy | Pinned at | Server copy (npm) | Why both sides stay |
|---|---|---|---|---|
| `highlight.js` | **8.0** from cdnjs | `config/default.yaml:L73` (script) and `L90` (stylesheet) | **9.18.5**, held | hljs 10 renames the emitted CSS classes and changes the `highlight()` signature — detail below |
| `jszip` | **3.1.4** via bower | `config/default.yaml:L111-L112` | **3.10.1** | the browser pin is an asset URL; the server copy is a live dependency required at `lib/controllers/trinket.js:L23` |
| `marked` | a separate browser copy | `config/default.yaml:L72` (`/components/marked/lib/marked.js`), documented at `docs/overview.md:L46` | registry **4.3.0**, replacing the git fork | the browser pin is an asset URL; reconciling would change client-visible markup |

**Why all three are preserved.** The browser-side entries are not version declarations at all — they are **asset
URLs**, and asset URLs are protected by the preservation directives. `config/default.yaml:L73` and `L90` resolve to
concrete cdnjs paths containing the string `8.0`; `config/default.yaml:L111-L112` names a bower component directory;
`config/default.yaml:L72` names a path under `/components/`. Changing any of them changes which bytes a browser
fetches, and in the `highlight.js` case it would also change the CSS class names the page is styled against.

The server-side copies are held for their own independent reasons. `highlight.js` is held at 9.18.5 because
`lib/shared/trinket-markdown.js:L310` calls the two-argument `hljs.highlight(lang, code)` form and splices the
result straight into rendered markdown — a version 10 bump would rename the emitted `hljs-*` classes and so change
client-visible markup on every page containing a fenced code block. `jszip` moved to 3.10.1 as a same-package
security bump with all used methods verified. `marked` moved from the git fork to registry 4.3.0 because that version
exposes the extension, tokenizer, renderer and token-walk hooks needed to reproduce the fork's per-tag sanitizer
contract. Its deprecated `sanitizer` option is **not** used: doing so changed block-HTML parsing and emitted a warning
on every render. The measured bridge is catalogued at 4.17.

**Correction — the fork was pinned, so "unpinned dependency" was never the reason.** An earlier revision of this
section said the fork's missing commit metadata made a reproducible lockfile impossible. Measured against the base
commit's own `package-lock.json`, that is wrong: the entry resolves to
`git+ssh://git@github.com/trinketapp/marked.git#55ea82491047d038b4360b78d092f77d439df63f` at lockfileVersion 3, so
the commit *was* pinned. What it lacked was an `integrity` field — it was the one entry in that lockfile without one,
and the regenerated lockfile has none. The reasons that survive measurement are the sanitizer contract above
(**incompatible**); the **eight** live advisories the base tree's own `npm audit` reports against `marked` 0.3.2 —
four high and four moderate, three of them independent ReDoS findings (**security**); the fork being an unmaintained
snapshot of upstream 0.3.2 (**dead**); and the `git+ssh://` transport, which requires git and SSH credentials in an
image that otherwise installs from the registry (**incompatible**). One further reason offered during review — that
`npm audit` cannot evaluate a git-sourced package — is **false and is not used**: auditing the base lockfile is
exactly how those eight advisories were counted. The same statement of reasons appears in
[MIGRATION-DEPENDENCY-INVENTORY.md](MIGRATION-DEPENDENCY-INVENTORY.md).

**Consequence, stated plainly.** Reconciling any of these three would change client-visible markup or client-side
behavior. `docs/overview.md:L46`, which documents the browser `marked` fork, was therefore left **byte-identical**
even though the npm `marked` dependency moved off that fork. The document describes the *browser* component, and the
browser component did not move. The dependency-level reasoning for each of these holds is recorded in
[MIGRATION-DEPENDENCY-INVENTORY.md](MIGRATION-DEPENDENCY-INVENTORY.md).

## 3. The R-6 adjudications

R-6 makes the observed behavior of the application at the base commit the tie-breaker for every ambiguity, **and
requires that each such resolution be documented.** This section is that record. Each entry states the ambiguity,
what baseline decided, and the evidence that decided it.

### 3.1 The technical specification's claim about the property-form redirect is contradicted by measurement

**The ambiguity.** The project's existing technical specification implies that `reply.redirect(...)` works, which
would make authenticated `/login` and `/signup` emit redirects.

**What baseline decided.** Authenticated `GET /login` and `GET /signup` were **measured at HTTP 500**, by creating a
user through the application's own model, logging in over real HTTP, and replaying both routes with the session
cookie. Written documentation loses to measured behavior. The 500 is reproduced; the mechanism is catalogued in
full at section 1.1.

### 3.2 The stale documented prerequisite loses to the explicitly requested runtime

**The ambiguity.** Three sources disagreed about the supported runtime. `docs/setup.md:L9` and `README.md:L18` both
said "Node.js 18+", `Dockerfile:L2` pinned `FROM node:16-bullseye`, and no `engines` field, `.nvmrc` or `.npmrc`
existed anywhere in the tree.

**What baseline decided.** Here baseline does *not* win, and the reason is worth stating: the user explicitly
requested **Node 22 LTS**, and an explicit instruction outranks an inherited default. The documented "18+" and the
Node 16 container base are both corrected, and the runtime is pinned in `engines`, `.nvmrc`, `.npmrc`, the Dockerfile
and the committed lockfile. Verified working toolchain: **node v22.23.1, npm 10.9.9**. This is also the one place
R-2 requires a change that the preservation directives would otherwise have frozen.

### 3.3 `mime` stays the same package

**The ambiguity.** An earlier plan proposed swapping `mime` for a differently named, more modern package.

**What baseline decided.** The same-package bump `1.2.11` → `1.6.0` clears the security finding, and `lookup`,
`extension` and `charsets` were all verified present on 1.6.0, so the bump touches **zero call sites**. R-1 was the
tie-breaker: a swap would have renamed every call site across
`lib/controllers/files.js`, `lib/controllers/trinket.js` and `lib/controllers/users.js` for no benefit. This
supersedes the earlier plan.

### 3.4 `archiver` stays callable at 7.0.1

**The ambiguity.** `archiver` 8.0.0 was the newest major published at migration time (2026-07), and the reflex is to
take the newest. `package-lock.json` records the resolved choice as `archiver` 7.0.1.

**What baseline decided.** **Not 8.0.0.** On 8.x, `require('archiver')` returns an ESM namespace object whose
`default` is undefined, so calling it as a function throws. 7.0.1 keeps `archiver('zip', {zlib:{level:6}})` working
at all three call sites — `lib/controllers/trinket.js:L1292`, `lib/controllers/trinket.js:L1454` and
`lib/workers/exports.js:L188`. Migrating to the class-based API was viable and exposes an identical surface, but it
would have cost three call-site rewrites for no benefit, so 7.0.1 plus a transitive `brace-expansion` override was
chosen instead. That single override collapses seven high findings.

### 3.5 Joi 18 needs zero option overrides

**The ambiguity.** A validator major bump is the highest-risk change in the whole migration, because a stricter or
laxer validator silently changes which requests are accepted with no error surfacing anywhere.

**What baseline decided.** Both versions were installed side by side and run against six differential cases
covering pattern, email, maximum-length, required-field and unknown-key failures. The verdict, `details.length`, the
error path in both array and dotted-string form, the error `type`, **and the exact message string were identical in
every case**. `{abortEarly: false}` carries forward unchanged and the plain-object schema coercion still works, so
**no option overrides are required**. This is also what makes the never-firing custom message of section 1.2
preserve itself automatically.

### 3.6 `lib/auth/passport.js` is provably deletable

This adjudication needs its method recorded in full, because someone will later ask why an authentication file was
deleted during a migration whose entire premise is that nothing changes.

**The ambiguity.** Deleting a file named `passport.js` from the auth layer of a web application is exactly the kind
of change that the preservation directives and the "no new or removed routes/features" exclusion forbid — unless it
can be shown to affect nothing.

**The method.** Deletion was **simulated and measured** rather than reasoned about. `require.cache` was pre-seeded
with an empty module so that the `require` at `app.js:L28` resolved to nothing — **without modifying any repository
file** — and the framework's own route table was dumped both ways.

**The result.** **Both boots produced 233 rows, and the two tables were compared row by row with zero
differences** — identical method, path, resolved auth mode and strategies, and pre-handler count at every one of the
233 positions — and every documented anchor held in both configurations: 233 rows; **137 GET, 63 POST, 19 PUT, 13
DELETE, 1 PATCH**; **117** paths under `/api/`; **161** carrying pre-handlers; and the **105 / 2 / 126** auth
partition. The canonical serialization hashed identically across the two boots as well, to sha256
`452116ce74301c61c92efb36fe8ead987b6a9e81d83a28af335c8d08fa1d64a8`, and the 58-route response corpus was unchanged.
The stub's effectiveness was independently proven by comparing the module's export keys in each configuration, so the
zero-difference comparison is evidence of neutrality rather than of the stub having failed to take effect. What this
adjudication turns on is that the two tables are *identical to each other*, whichever serialization produced them.

**Digest correction — the neutrality evidence is the *equality*, not the published number.** An earlier revision of
this section published that digest as `cd2a7e38a39bd84902ac1a0d69f50e2a` and labelled it a sha256. That value is
**32 hexadecimal characters, which cannot be a sha256 at all** (a sha256 is 64), and it does not recompute from the
committed 233 rows under any canonicalization tried — 27 candidate recipes, widened to 42, and then to **2,155,050**
digests across 56,709 serializations in a third independent pass (section 3.22). It is nevertheless the Technical
Specification's own published anchor, so it is **retained verbatim** in
`test/baseline/route-table.json#gates.documentedDigest` with its citation, and this document draws no further
conclusion from it: it is not declared satisfied, it is not declared void, and no measurement is promoted into its
place. What the artifact adds beside it is a mechanically recomputable regression fingerprint,

```text
sha256 = 452116ce74301c61c92efb36fe8ead987b6a9e81d83a28af335c8d08fa1d64a8
```

recorded as `gates.measuredSha256`, reproducible from that artifact's own committed rows with the recipe its
`canonicalization` block specifies, and **re-derived live from the running server** on every
`node test/baseline/replay.js`. Because that sorted form deliberately discards registration order, that order carries
a second fingerprint of its own,
**`6a65d18273c731aa070cf905625a9dfe4789caf066dde0c5beb14c6dd8131898`**
(`gates.registrationOrderFingerprint`), so a re-ordering that let the `/{path*}` catch-all shadow a real route would
also be caught. Both are marked `measuredFingerprintsAreSubordinate` in the artifact, because they are regression
evidence about the same table rather than a replacement anchor. None of this weakens the passport adjudication: what
proves neutrality is that the two boots agreed with each other, and that comparison was internal to the probe.

**Corroborating evidence.** The module is **136 lines**, required **exactly once** at `app.js:L28` and never
referenced thereafter — the identifier it is bound to appears nowhere else in the file. Its nine `req.session.*`
accesses target a property that **`@hapi/yar` 11 does not decorate**: the plugin decorates only `request.yar` and
`server.yar`, so `request.session` is `undefined` today and every one of those nine lines would throw if reached.
And `lib/auth/passport.js:L124` references an **undefined variable `opts`**, which is conclusive on its own — that
line cannot execute without throwing a `ReferenceError`.

**Consequence.** Deleting it also makes `passport-local` and `passport-google-oauth` dead, which is why they appear
in the removal list of [MIGRATION-DEPENDENCY-INVENTORY.md](MIGRATION-DEPENDENCY-INVENTORY.md).

### 3.7 The catbox test helper: repoint, not drop — **decided, not yet implemented**

**Status: PENDING.** Everything below is the *decision* this adjudication reached about `test/helpers/catbox-redis.js`.
The file itself has **not** been changed and is **outside this changeset's scope**. As it stands in the tree today it is
still the base commit's 36 lines: `L1` still reads `var catbox = require('catbox-redis'),`; `L4` still declares the
undeclared `expires` global; and `L6` still installs a three-argument `sinon.stub(catbox.prototype, 'isReady', fn)`
whose fake `self.client` exposes `get`, `set`, `del` and `expire`, the last using `setTimeout(..., time * 1000)`.
Neither `catbox-redis` nor `@hapi/catbox-redis` is installed, and neither is declared in `package.json`, so
`npm test` still exits non-zero at load time with `Error: Cannot find module 'catbox-redis'`. This entry is retained
because the analysis behind the decision is the expensive part and should not have to be redone; it is **not** a record
of completed work, and no claim in it may be read as one.

**The ambiguity.** `test/helpers/catbox-redis.js:L1` requires the **unscoped** `catbox-redis`, which is declared
nowhere and installed nowhere. The base commit therefore dies with `Error: Cannot find module 'catbox-redis'` on the
suite's **first module load**.

**Why R-6's tie-breaker is inapplicable here — and that reasoning is itself the adjudication.** Because the suite
never ran, **there is no observed base-commit behavior for the session-cache path at all.** There is no baseline to
defer to. With the tie-breaker unavailable, the governing criterion falls through to the request's prime testing
directive: *existing suite 100% with assertions unweakened.* The helper must therefore be made to work, and it must
be made to work without changing any assertion.

**Why "drop the helper" was rejected — measured, not assumed.** `server.initialize()` appears **nowhere** in the
repository, and `server.start(` appears **only** at `app.js:L308`, behind `if (config.app.start)` — which
`config/test.yaml:L3` sets to `false`, and that file is frozen. So the cache engine's `start()` is never called
under test: `this.isConnected` stays false **and** the module-scoped `Session` model stays permanently `undefined`.
Even with `isReady` stubbed to return true, `Session.findById(...)` throws a `TypeError`. Dropping the helper would
therefore not leave a working real engine behind — it would leave a broken one.

**Why `@hapi/catbox-redis` was not used as the stub target.** That package is being **removed** from
`package.json` as an undeclared-and-unused dependency. Re-adding it purely to satisfy a test double is literally
what R-2 forbids.

**The resolution, as delivered and verified.** The helper is repointed at the in-repo
`lib/util/catbox-mongoose.js` engine and stubs **five** prototype methods — `isReady`, `start`, `get`, `set` and
`drop` — leaving `validateSegmentName` and `stop` **real**. `validateSegmentName` must stay real because catbox
calls it at policy-provisioning time during `await server.register([... Yar ...])`. Expiry is evaluated lazily
inside `get` against an in-memory map keyed `segment + ':' + id`, which creates **no new timer** and so adds nothing
to the set of handles holding the event loop open.

**The stub target had to move, and that correction is the substance of the repair.** An earlier revision of this
section described stubbing the module's bare prototype. That is not the shape the engine exposes:
`lib/util/catbox-mongoose.js` exports a **named `Engine` class**, so the stubs are installed on
`catbox.Engine.prototype`. Sinon 22 makes the distinction fatal rather than merely wrong —
`sinon.stub(obj, 'missingMethod')` throws `TypeError: Cannot stub non-existent property`, so a stub aimed at the
wrong object fails loudly at load time instead of silently doing nothing.

**Verified state.** `require('catbox-redis')` no longer appears anywhere in the repository, and the suite now runs:
`npm test` exits **0** with **224 passing, 0 failing**. The earlier claim that this repair was complete was made
while `test/helpers/catbox-redis.js:L1` still required the uninstalled unscoped package and the suite still died on
its first module load; that claim was **false when written** and is corrected here rather than restated. The
systemic hang and process-fate conversions that the same revision omitted are catalogued in full in section 9
below, each with the base-commit reading that established its fate.

**The 1000× unit correction the implementation must make, recorded because it is invisible and would silently break
expiry.** The existing helper's `setTimeout(..., time * 1000)` at `test/helpers/catbox-redis.js:L20` exists because
redis `EXPIRE` takes **seconds**. Catbox's `set(key, value, ttl)` receives **milliseconds** — `app.js:L107` passes
`24 * 60 * 60 * 1000`, that is **86400000** — so the `*1000` multiplier must be dropped. Carrying it forward would set a
session expiry 1000 times too far in the future. The multiplier is **still present** in the file today.

**One byte-identical preservation the implementation must keep.** The undeclared `expires` global at the helper's `L4`
must be **kept exactly as it is**, even once it is unused. It is an implicit global, and Mocha's load-time leak snapshot
is taken against the set of globals that exist after the helpers load; removing it would change what `--check-leaks`
sees. It is present in the file today and must survive the repair.

### 3.8 `.mocharc.json` carries `"exit": true`

**The ambiguity.** Mocha 3, the installed version, **force-exits** after a run. Mocha 4 and later made that
opt-in. The bump to 11.7.6 would therefore make `npm test` **hang after passing** — the suite would report success
and the process would never terminate.

**Three things hold the event loop open**, all of them preserved: the never-`unref`'d `setInterval` at
`app.js:L348` (section 1.13); the module-load database connection, invoked by `connect()` at `config/db.js:L35`
which performs the `mongoose.connect(connectStr)` at `config/db.js:L32`; and the eagerly-created redis client.

**The resolution.** The new root `.mocharc.json` carries five keys — `reporter: spec`, `recursive: true`,
**`check-leaks: true`** (kebab-case, ported from the `--check-leaks` flag), **`exit: true`** and
**`require: ./test/setup.js`**. The first three are a straight port of the deleted `test/mocha.opts`, measured at
**41 bytes, 3 lines, no trailing newline**. `exit` is the addition this section is about; `require` is a second
addition, forced by a Mocha load-order change that is documented separately in section 13.1 because its failure
mode was destructive rather than merely inconvenient.

**This is preservation of the observable termination — the process exits and reports success — not a weakening of
anything.** No assertion is affected, no check is disabled, and `check-leaks` remains on. The only thing restored is
the exit behavior the suite has always had.

**The non-obvious companion decision.** The file deliberately declares **no `spec` key**, because Mocha's default
glob is **load-bearing**. The default pattern loads `test/setup.js` as though it were a spec, which is what causes
its `require('../app.js')` to run **before** Mocha takes its leak snapshot — and that ordering is the only reason
`--check-leaks` passes at all despite the nine sloppy-mode model globals the bootstrap assigns. Declaring an
explicit `spec` narrow enough to exclude the helpers would break `--check-leaks`. That same load-everything glob is
also why the baseline capture and replay scripts must be guarded with `require.main === module`: without the guard,
being loaded as a "spec" would execute a capture on every test run.

> **Delivered, and the guard is in the tree rather than merely specified.** `.mocharc.json` **is committed** — five
> keys, `reporter`, `recursive`, `check-leaks`, `exit` and `require`, and deliberately no `spec` — and
> `test/mocha.opts` **is deleted**. `test/baseline/capture.js` and `test/baseline/replay.js` are committed as well,
> and both carry the `require.main === module` guard this subsection requires, as does the capture's companion suite
> `test/lib/api/route-parity.js`, which is a proper spec and is meant to be loaded by the glob. The two captured data
> artifacts, `test/baseline/route-table.json` and `test/baseline/responses.json`, are committed beside them. The
> delivery-status table in the *Tense, and the delivery status of the test tree* subsection of the scope preamble
> records the measured state of each.

### 3.9 `server.inject()` is banned from the parity harness

**The ambiguity.** Injection is the conventional and far more convenient way to drive a hapi server from a test, and
the parity harness is a test.

**What baseline decided.** Injection is the **sole** source of a `--pending-deprecation` warning in the entire
stack, traced to `@hapi/shot/lib/request.js:L30` and reached from the framework's own inject entry point. The
installed `@hapi/shot` 6.0.3 — pinned at that version in `package-lock.json`, where it appears as a transitive
dependency of `@hapi/hapi` — was the **newest version published at migration time (2026-07)**, so there was no
upstream fix to wait for. Real HTTP serving
on Node 22 measured **zero** warnings. Since the request's validation framework requires a boot with zero
deprecation warnings, the capture process that produced the committed JSON artifacts issued **real HTTP requests**
and never injected.

A second constraint follows from the same analysis and is recorded with it: the harness needs a genuinely bound
socket, but `config/test.yaml:L3` sets `start: false` and that file is frozen. The capture therefore overrode the
start flag **at runtime** rather than editing the YAML, because editing it would change the existing suite's
behavior.

**Status of the delivered scripts: both are in the tree, and both obey the two rules above.** `test/baseline/capture.js`
and `test/baseline/replay.js` are committed. Each states in its own header that `server.inject()` is never used —
`capture.js:L16` and `L1437`, `replay.js:L378` — and `test/lib/api/route-parity.js:L34` records the same constraint
for the suite that reads their artifacts. The runtime start-flag override is likewise delivered rather than specified:
the capture injects `app.start`, the bind host and port through **`NODE_CONFIG`** before `app.js` is required
(`capture.js:L200-L206`), and `config/test.yaml` is **byte-identical** to the base commit. The only `server.inject()` calls anywhere in the tree are the application's own two internal sub-requests, in
`lib/controllers/courses.js` and `lib/controllers/folders.js`, which are base-commit behavior and are preserved.

### 3.10 The shim's plain-`Error` branch was deleted only because deletion was proven mapping-neutral

**The ambiguity.** R-1 forbids removing code that works, and R-5 requires every error-to-response mapping to survive
the conversion unchanged. The shim's plain-`Error` branch is code that works and that participates in error mapping,
so both rules have a claim on it.

**The evidence.** The branch at `lib/util/routeParser.js:L364-L369` exists solely to emulate the framework's own
handling of a raw `Error`:

```javascript
if (data instanceof Error) {
  var boomErr = Boom.badImplementation(data.message);
  responseResolver(boomErr);
  return boomErr;
}
```

Measurement on a live `@hapi/hapi` 21.4.10 server showed that a **thrown or returned** plain `Error` maps to
**exactly the same scrubbed 500** — same status, same payload shape, same fixed message — that this branch produces.
The emulation is therefore redundant, not load-bearing.

**This is the one place where R-1 yields to R-5, and the justification is empirical, not aesthetic.** Deletion was
permitted **because it was proven mapping-neutral**, never because it shortens the diff. Had the measurement come
back differently — had the native mapping differed in status, shape or message — the branch would have been kept
verbatim regardless of how redundant it looked.

### 3.11 A seventh test blocker beyond the six catalogued in the specification

**The ambiguity.** `test/helpers/queue.js:L2` calls `require('../../lib/util/queues').snapshots()` and throws
`TypeError: ...snapshots is not a function` **at module load**. The obvious repair is to add a `snapshots` accessor
to `lib/util/queues.js`.

**The cause.** `config/default.yaml:L385-L386` sets `db.redis.bullqueues` to a **one-element** list containing only
`exports`, and `lib/util/queues.js:L138-L142` generates accessors **only** for that list:

```javascript
bullqueues.forEach(function(queueName) {
  module.exports[queueName] = function() {
    return createQueue(queueName);
  };
});
```

so the module's exports are exactly `{ exports, isRedisEnabled, closeAll }`. Reproduced on node v22.23.1.

**The resolution.** Resolved **inside the test helper**, with a load-safe accessor probe plus a `NoOpQueue`-shaped
stand-in. **No `snapshots` getter was added to `lib/util/queues.js`.** That restraint is provably behavior-neutral:
`snapshots` is one of the nine hard-disabled queues, so a getter could only ever have yielded a `NoOpQueue`; and the
helper is **vestigial** — `test/lib/api/trinket.js:L4` requires it but never calls `queue.stub()`. Adding a
production accessor to satisfy a test double that nothing invokes would have been an unattributable hunk in the
runtime code.

Two further details of the helper are preserved deliberately: the fake's hand-rolled **synchronous single-argument
thenable** — deliberately not `Promise.resolve()`, because a real promise would defer resolution to a microtask and
change ordering — and its deliberate signature asymmetry against the real `NoOpQueue.add`.

### 3.12 The course-slug 301 never fires

**The ambiguity.** `test/lib/api/course.js:L93` asserts `flow.lastResponse.statusCode.should.eql(301)`, which
implies the slug-canonicalization pre-handler emits a redirect.

**What baseline decided.** It does not. `convertPreHandlers`' synthetic `fakeReply` calls
`resolve(value === undefined ? null : value)` **immediately**, before the chainable is returned. The chainable's
`.takeover()` then calls `resolve(redirectResponse)`, which is a **no-op on an already-settled promise**, and the
`_isRedirect` marker it sets is read **nowhere**. Consequently `courseBySlug` resolves to `null` and emits **no
301**, so that assertion — and the two assertions sequenced behind it — is **unreachable at baseline**.

**Why it is preserved.** R-4. Making the 301 fire would introduce a redirect on a route that does not currently
redirect, changing both the status code and the `Location` header. The assertion stays in place, unweakened and
still unreachable, exactly as it was. It must not be repaired.

### 3.13 The eight `url.parse` sites do **not** all get the same replacement

**The ambiguity.** The mechanical replacement for the deprecated `url.parse` is the WHATWG `URL`, but every WHATWG
entry point behaves differently from the legacy parser on the inputs this codebase actually feeds it. Bare
`URL.parse('/login')` returns **`null`** where the legacy parser returned an object with a non-null `pathname`; the
`URL` **constructor** raises `ERR_INVALID_URL` on relative, protocol-less and empty input; and the non-throwing static
`URL.parse()` emits **DEP0170** on input the legacy parser accepted, trading one forbidden deprecation warning for
another. There is therefore no single mechanical swap, and the eight sites split three ways.

**What baseline decided — three different replacements, one per call-site shape.**

- **Five `lib/` asset sites → one shared reimplementation of the legacy algorithm, calling no WHATWG URL API at
  all.** `lib/controllers/trinket.js:L1253, L1350, L1521` and `lib/workers/exports.js:L40, L304` (base-commit numbers)
  all derive a pathname from an asset URL and hand it to `path.basename`. All five now route through the single
  shared module `lib/util/legacyUrl.js`, whose `legacyPathname()` reproduces the legacy parser's `pathname`
  algorithmically. Neither consuming file calls `url.parse`, `new URL` or `URL.parse` in code — verified as **zero**
  code-only occurrences in each, the only textual mentions being one explanatory comment per file. The full
  reasoning, the legacy rules the port reproduces, the two divergences that killed an earlier per-file lexical
  approximation — including the one where it returned `null` and `path.basename(null)` threw — and the size of the
  differential evidence are all in
  [section 11](#11-libutillegacyurljs-a-faithful-port-of-the-deprecated-parser-not-a-whatwg-substitution).
- **One `lib/` validation site → the non-throwing static `URL.parse()` with no base argument.**
  `lib/controllers/users.js:L588` (base commit) is the deliberate validation quirk where the **absence of a protocol**
  drives the rejection. Here `null` and "no protocol" must reject **identically**, so the site reads
  `URL.parse(request.payload.url)` and guards with `if (!requestUrl || !requestUrl.protocol) return request.fail();`. A
  base argument is explicitly **wrong** here: it would resolve relative input and inherit the base's protocol, turning
  rejections into acceptances. The asymmetry it preserves — that a scheme-only string like `foo:` *has* a protocol and
  is accepted — is base-commit behavior that R-4 forbids repairing.
- **Two `test/` redirect-assertion sites → `URL.parse(location, config.url)`, with a base argument** — except that
  measurement moved them too. Both assert on a `Location` header that occurs in **two** forms, so the WHATWG parser
  needed a base to resolve the relative one; but the same header can also carry an opaque or protocol-less value on
  which the two parsers disagree, so the delivered sites call `lib/util/legacyUrl.js#pathname` instead —
  `test/helpers/flow.js:L433` and `test/lib/api/registration.js:L103` — and the base-argument reasoning below is
  retained because it is what ruled out the bare, base-less form.

**The census, and the one file where it moves.** At the base commit it is exactly **22** `lastRedirect.pathname`
sites plus the one independent site in `test/lib/api/registration.js` = **23** pathname assertions; an earlier prose
estimate of 24 was wrong. In the delivered tree the same grep returns **18** occurrences, **17** of them `.should.`
assertions — the eighteenth is the comment at `test/helpers/flow.js:L426` explaining the swap — and the whole
difference is `test/lib/api/course.js`, whose five went to zero. They were **not** dropped: two R-6 adjudications in
section 13.7 replace them with strictly stronger assertions, because both were asserting redirects the application
provably does not emit. The stale-slug case measures **500** (`courseBySlug`'s alias branch leaves
`request.pre.course === null`, and every consumer dereferences it), and the four logged-out `/api/` cases measure
**401** plus the explicit *absence* of a `Location` header, the old pathname assertions having been reading stale
state from an earlier request. Every other file is unchanged: `admin` 1, `files` 1, `forgot_pass` 5, `login` 4,
`logout` 2 and `registration` 4.

**The two test sites, and why the base argument is necessary there.** `test/helpers/flow.js:L399` and
`test/lib/api/registration.js:L85` parse a `Location` header and read `.pathname`. Both header forms really occur — the
**absolute** form via the route parser's `redirect()` helper at `lib/util/routeParser.js:L704-L723`, and the
**relative** form via `app.js:L172`'s `h.redirect('/login').takeover()` — and a single call site sees both, so neither
may be assumed. `URL.parse(location, config.url)` resolves the relative form instead of returning `null`; measured
`config.url === 'https://trinket.dev'` under `NODE_ENV=test`. The census is exactly **22** `lastRedirect.pathname` sites
plus the one independent site in `registration.js` = **23** pathname assertions; an earlier prose estimate of 24 was
wrong.

**Separately, the storage-format call sites.** The base commit held three `url.parse(asset.url)` sites in
`lib/controllers/trinket.js` (L1253, L1350, L1521) and two in `lib/workers/exports.js` (L40, L304), each reading
`.pathname` and feeding the result — through `path.basename()` — into an **S3 object key** or a **zip archive
entry name**. Both are storage-format surfaces frozen by TR6, so a divergence there is a persisted-format change.

> **Correction — the earlier "guarded, therefore safe" claim was wrong.** An earlier revision of this section
> asserted that `lib/workers/exports.js:L40` and `L304` were *"guarded"* and so safe as they stood. They were not.
> The guard fell back to the **raw URL string** when `URL.parse()` returned `null`, so a relative asset URL
> carrying a query string or fragment produced an S3 key and archive entry name that retained the `?...`/`#...`
> tail, where the legacy parser had split it off. The two `trinket.js` sites were likewise described as having had
> their `null` case *"explicitly neutralized"* by a local approximation. Both statements are superseded.

**What is measured in the tree now.** The derivation is delegated to a single shared, differential-tested helper,
`lib/util/legacyUrl.js` (607 lines), which reconstructs the deprecated parser's `pathname` rather than approximating
it. It is required at `lib/workers/exports.js:L11` and called once at `L47`, inside `assetPathBasename`; and required
at `lib/controllers/trinket.js:L35` and called at `L1468`, `L1588` and `L1800`. The helper is verified to **zero**
pathname differences and **zero** `path.basename` differences against `require('url').parse(x).pathname` across
**2,022,153** inputs by the committed differential suite `test/lib/util/legacy-pathname.js` (631 lines, 7 tests),
including the throw-versus-value cases. A comment-stripped scan confirms `url.parse` and `URL.parse` are both
**absent** from `lib/workers/exports.js` and `lib/controllers/trinket.js`.

**The one deliberate `URL.parse` that remains in application code** is `lib/controllers/users.js:L895` — the
validation quirk where the absence of a protocol drives the rejection. It is the only `URL.parse` call site in
`lib/` and is preserved exactly, including its falsy-`protocol` test. Note the line reference: this site was cited
as `users.js:L588` at the base commit and has since moved.

**`url.parse` still survives at exactly two sites, both in the test tree** — `test/helpers/flow.js:L399` and
`test/lib/api/registration.js:L85`. They are assertions, they are the two sites the `URL.parse(location,
config.url)` adjudication above was written for, and they are **unconverted**: the base-argument form is the
recorded decision for them, not a change already applied. See section 7.6 for the separate,
application-triggered DEP0169 path, which does not involve either of them.

### 3.14 The `.fail(` and `.spread(` census was refined

**The ambiguity.** A naive census conflates two entirely unrelated things that share a method name, which would
have made the async conversion look far larger than it is and risked converting the wrong call sites.

**What measurement decided, at the base commit.** `.spread(` has **zero** consumers — the
`Promise.prototype.spread` monkey-patch at `app.js:L4-L16` is dead code. Of the **86** `.fail(` occurrences at
`2f8712a` only **13** are genuine `Promise.prototype.fail` consumers: five in `lib/workers/exports.js` at L165,
L235, L263, L310 and L327, and eight in `test/lib/models/plugins/roles.js` at L54, L90, L107, L122, L146, L163,
L179 and L195. The other **73 are `request.fail(`** — the shim's response-contract decoration, an entirely
unrelated concern that migrates to `lib/http/responseContract.js` and has nothing to do with promises. Every
`.fail(` occurrence under `lib/views/**.html` is a **jQuery** deferred, not a promise, and is outside the census
entirely.

> **Two clarifications, both measured.** First, the 86 and 73 figures are **comment-inclusive**. Stripping
> comments gives 85 and 72; the single difference is one comment mention at base `lib/util/routeParser.js:L481`
> (`// Compatibility shim: request.fail() for Hapi 20+`). The genuine-consumer count is **13 either way**, because
> the extra occurrence is a `request.fail(` mention. Second, every figure in the paragraph above describes the
> **base commit**, not the migrated tree. Read in the present tense it now contradicts the post-conversion census.

**What the migrated tree measures.** `.spread(` remains at **zero**, and genuine `Promise.prototype.fail` consumers
are now **zero** as well. The five `lib/workers/exports.js` consumers are **gone** — removed with that file's `q`
deferreds under G3 — and the eight `test/lib/models/plugins/roles.js` sites are now `.catch(`, converted with the
test-suite restoration. Because nothing consumes the alias any longer, **both** `Promise.prototype` monkey-patches
were deleted from `app.js`, which is what completes AAP G3; re-measured on the delivered tree,
`grep -rn '\.fail(' app.js config/ lib/ scripts/ test/` returns zero promise call sites. Section 7.9 carries this
corrected census. The response contract is a separate concern that did not disappear with the alias: the responders
are published on the per-request toolkit as `h.respond` and `h.reject`, and that is the only spelling any call site
uses — measured comment-stripped on the delivered tree, **156** `h.respond(` and **64** `h.reject(` calls, 218 of
them in `lib/controllers/`. The shim's `request.success` / `request.fail` decorations were therefore retired from
`lib/util/routeParser.js` as well, completing AAP G2: the same comment-stripped scan across `app.js`, `config/`,
`lib/`, `scripts/` and `test/` returns **zero** executable occurrences of either name, so the removal is
wire-neutral and nothing is left spelled the base-commit way.

**Why it matters.** The monkey-patches may only be removed once every genuine consumer is converted. Counting the
73 response-contract calls as promise consumers would have made removal look impossible; counting them as
convertible would have broken the response contract. The corollary is that the `Promise.prototype.fail` alias at
`app.js:L4-L16` is **retained**: eight consumers still depend on it, `q` is absent from both `package.json` and
`node_modules`, and native `Promise.prototype.fail` is `undefined`, so removing the alias would break them.

**Both monkey-patches are now deleted, and the census that licensed the deletion is the *current* one, not the
base-commit one.** An earlier revision of this section, and a matching comment in `app.js`, asserted that 13
consumers still remained including five in `lib/workers/exports.js`. That was **stale**: the async conversion of
`lib/workers/exports.js` had already retired all five, so the remaining consumers were the **eight** in
`test/lib/models/plugins/roles.js` and nothing else. Those eight were converted to `.catch(` — verified 8 → 0, with
`.catch(` rising to 8 in the same file — after which **both** `Promise.prototype.fail` and `Promise.prototype.spread`
were removed from `app.js` together with their comment block. Verified at runtime after `require('./app.js')`:

```text
typeof Promise.prototype.fail   === 'undefined'
typeof Promise.prototype.spread === 'undefined'
```

and a repository-wide re-census returns **zero** promise `.fail(` sites. This closes the async-idiom goal that the
plan lists as G3. The earlier revision also cited the patches at `app.js:L4-L16`; that citation is a **base-commit**
line reference and the block no longer exists at any line, which is the outcome the citation frame in *How to read
this catalogue* is meant to make unambiguous.

### 3.15 The `Failed to initialize redis client:` log line during `npm test` is expected and tolerated

**The ambiguity.** A test run that logs a redis initialization failure looks like a broken environment, and the
reflex is to disable redis under test.

**What baseline decided.** `redisEnabled` is **true by default even under test**: `config/default.yaml` defines
`db.redis.app.*` and never sets `enabled: false`, and `config/test.yaml` does not override it. `config/redis.js`
attaches a swallowing `.catch()`, so the line is logged and the suite continues. This is **not a failure**, and it
is not to be fixed — setting `enabled: false` in `config/test.yaml` would edit a frozen configuration file and would
change which code path the suite exercises.

### 3.16 `test/helpers/db.js` was expected to need no change at all

**The ambiguity.** Every other test helper needed work, so the absence of a change here invites the suspicion that
something was missed.

**What measurement decided.** Because `mongoose` is held inside the 6.x line — 7 and above remove the extension
mechanism `lib/models/model.js` depends on — its bundled driver stays on 4.x, where `dropDatabase(cb)` still accepts
a callback. A **zero diff** is therefore the correct outcome for this file, and is recorded here so that it reads as
a verified decision rather than an omission. Any conversion that nonetheless proved necessary would itself have been
recorded as an adjudication.

### 3.17 The leading `@@ -1,0` hunk header is rewritten to `@@ -0,0` before `applyPatch`

**The ambiguity.** `diff` moves **1.0.8 → 9.0.0**, but the patch text it consumes is produced by a *different* copy of
jsdiff that is deliberately **not** upgraded: `config/default.yaml` pins the browser copy at **1.0.8**, and
`public/js/courseEditor/controllers/materialControl.js:L321` is its sole producer. A producer and a consumer sitting on
different majors is exactly the shape in which a silent persisted-content change hides.

**What baseline decided.** Both versions were installed side by side and the patch shapes this application actually
produces were replayed through each. For every hunk header carrying **at least one old line**, the two versions return
**byte-identical** output. They diverge on exactly one shape: the first edit against an **empty** material, for which
1.0.8 emits the non-canonical zero-old-lines header `@@ -1,0 +1,N @@`. **1.0.8 spliced those added lines in before line
1, while 9.0.0 follows GNU patch and inserts them after line 1** — which prepended a blank line to the first save of
every new page and dropped its trailing newline. That is a change to persisted course content, which TR6 forbids.

**The adjudication.** `lib/controllers/course.js:L545` normalizes that one header before patching:
`request.payload.patch.replace(/^@@ -1,0 /, '@@ -0,0 ')`. The rewrite was measured to be a **no-op under 1.0.8's own
semantics**, so it changes nothing for the pinned producer, while restoring byte-identical output under 9.0.0.
Persisted course content is therefore unchanged, which is the whole purpose of the adapter.

**Why this is the minimal form.** The pattern is **anchored at `^`**, so it touches only the leading header — the only
header 1.0.8 can emit with zero old lines — and every other hunk passes through untouched. The `require` at the top of
the file is unchanged, and `applyPatch` still answers the boolean `false` on failure, so the strict `=== false`
conflict test below it and the whitespace-only-to-`null` collapse both keep their baseline behavior. R-1 permits the
hunk because it is attributable to the dependency-swap category; R-4 requires it, because the alternative is a
behavior change; and R-6 supplies the decision, because the byte-identical baseline output is what defines correct. The
same adapter is recorded in the `diff` row of
[MIGRATION-DEPENDENCY-INVENTORY.md](MIGRATION-DEPENDENCY-INVENTORY.md), and the reasoning sits beside the code at
`lib/controllers/course.js:L525-L543`.

**What a naive migration would have broken.** Bumping `diff` and leaving the payload alone silently rewrites the first
save of every new course page — a corruption that no status code and no test assertion would have surfaced.

### 3.18 `helpers.trinketByOwnerAndSlug` had a latency-dependent status, and the conversion narrowed it deliberately

**The ambiguity.** At baseline this pre-handler's alias-miss branch did not have **one** observable status. It had two,
and which one a client saw depended on the database rather than on the request.

**What baseline decided — measured, not assumed.** `Model.findOne(query, cb)` **both invokes the callback and returns a
re-executing thenable**, so the callback body and the compatibility layer's own `.then()` raced to settle a single
promise. Replaying the alias-miss branch produced **200 with a null `pre` when the query round trip won, and 404 when
the callback chain won** — and in the former case the callback's `Boom.notFound()` was swallowed on an already-settled
promise. The status therefore tracked relative database latency.

**The adjudication.** A single-return native pre-handler **cannot reproduce a race**, so one of the two outcomes had to
become the only outcome. The **latency-independent** branch was kept: the model method is awaited through its promise,
which keeps the lookup's error on the chain where the trailing `.catch` already delivers it. Every other branch was
verified identical in every timing configuration — the found-document branch, and the alias branch whose own preserved
quirk (`Q3`, mapped in the label crosswalk of section 5) resolves to `null` and emits no redirect at all.

**Why narrowing is safe here, and only here.** **This export has zero references anywhere in the repository** — no
route declaration and no other module names it — so nothing observable depends on either outcome. Narrowing was
therefore the smallest change that removes a coin flip, not a choice between two live behaviors. The full reasoning is
recorded beside the code at `lib/util/helpers.js:L431-L434`.

**What a naive conversion would have broken.** Keeping the *callback* shape under a native pre-handler would have been
strictly worse than narrowing: Mongoose discards whatever a callback returns, so the `Boom.notFound()` would have been
lost unconditionally and the branch would have become a permanent 200.

### 3.19 Three route declarations name handlers that have never existed

**The ambiguity.** Three declarations reference controller members that are **not defined**, at the base commit and
after it: `GET /api/trinkets/popular` → `trinket.mostActive` (`config/api_routes.js:L714`), `GET /api/trinkets/active`
→ `trinket.risingActive` (`:L729`), and `POST /api/interest` → `pages.interest` (`:L1090`). Neither controller defines
the member — measured as zero occurrences in `lib/controllers/trinket.js` and `lib/controllers/pages.js` in both
frames. A migration that supplies a missing handler **adds a feature**; a migration that deletes the declaration
**removes a route**. Both are excluded by the request's own exclusion list.

**What baseline decided.** They are **inert by fallback, not broken.** `lib/util/routeParser.js:L52` resolves the
handler with `require('../controllers/' + controller)[handlerName]`, which yields `undefined`; the wrapper's
`if (handler)` test at **L201** is therefore false, and control falls through to **L218**,
`return request.success(request.params);`. The three routes answer through the declarative response contract carrying
the route's own parameters as the payload — an empty object for all three — rather than throwing. Validation is
unaffected, because the wrapper validates at **L196**, *before* the handler check: `POST /api/interest` still rejects
an invalid payload exactly as it did at baseline, and only a valid payload reaches the fallback.

**The two GET routes never even reach the fallback.** Both carry `pre: [helpers.validLang, 'isAdmin(user)']`, and
`validLang` derives its language from `request.params.lang || request.query.lang || payload.lang || urlLang`. For a
parameterless request the fall-through value is the path itself with its slashes stripped — `api/trinkets/popular` —
which is absent from `Trinket.schema.path('lang').enumValues`, so the pre-handler **returns `Boom.notFound()`** and the
request ends there. Because the path is under `/api/`, that Boom is delivered as **JSON**. These are precisely the two
404s that make the measured tally **22** rather than the **20** the feature flags of section 1.4 explain; they are
counted separately as `gates.boomJsonFourOhFours` in `test/baseline/responses.json` and adjudicated there as
`api-trinkets-active-and-popular-404-via-validlang`. One detail of that adjudication's evidence sentence names
`helpers.trinketTypeEnabled` as the first pre-handler; the declarations in fact carry `helpers.validLang` followed by
the string form `'isAdmin(user)'`, which is what the measured `preCount: 2` in `test/baseline/route-table.json`
records. The mechanism and the outcome are unaffected by that detail.

**Why nothing was implemented.** R-1 confines the diff to four categories and implementing a handler belongs to none of
them; the exclusion list forbids new features; and R-4 forbids improving behavior. The declarations, the undefined
references and the fallback are therefore all preserved untouched, and this section is the record that the omission was
seen and adjudicated rather than missed.

### 3.20 `archiver` 7's `finalize()` Promise is owned at every call site, but only one of them may answer

**The ambiguity.** `archiver` 2.1.1 returned `this` from `finalize()`; 7.0.1 returns a Promise. Every call site in
this repository discarded the return value, so the bump silently created three unowned Promises. The reflex fix —
`await archive.finalize()` — would be wrong at one of the three sites, and wrong in a way that looks like a bug fix.

**What was measured.** Both versions were driven over four archive outcomes with a real `archiver` install of each.

| Case | `archiver@2.1.1` | `archiver@7.0.1` |
|---|---|---|
| a normal archive | resolved, events `["close"]` | resolved, events `["close"]` |
| a missing source file | pending, events `["warning:ENOENT"]` | resolved, events `["warning:ENOENT","close"]` |
| an erroring source stream | pending, events `["src-error","error"]` | pending, events `["src-error"]` |
| an unsupported entry value | pending, `error:INPUTSTEAMBUFFERREQUIRED` | pending, `error:INPUTSTEAMBUFFERREQUIRED` |

Reading both `Archiver.prototype.finalize` implementations then located the only behavioral delta: **both versions
wire `_module.on('error', reject)` inside the Promise they build**, so discarding it was *already* an unowned
rejection path at the base commit; what changed is that on the `ABORTED` and second-`finalize()` guards 2.1.1 emitted
`'error'` and returned `this`, while 7.0.1 emits `'error'` **and** returns `Promise.reject()`. Neither guard is
reachable here: `.abort()` is called nowhere in `app.js`, `config/`, `lib/` or `scripts/`, and `finalize()` runs once
per handler invocation.

**What baseline decided — and the two answers are different.**

At `lib/controllers/trinket.js` `downloadPostedZip`, `archive.on('error', …)` is spelled correctly and already
rejects the pending output promise, so a finalization failure has always produced a response. The `finalize()`
rejection is therefore routed into the same path, via `Promise.all([outputPromise, finalizePromise])` returning
`settled[0]` so the output stream's `close` byte count remains the resolution value. Measured on the migrated stack:
a normal archive answers `200`, and both guard paths answer the scrubbed `500`.

At `lib/controllers/trinket.js` `downloadZip` the listener is **misspelled** — `archive.on('err', …)`, registered at
**L1722** — so nothing rejects the output promise and an archive failure has always left that request **pending
forever**. That is the preserved quirk, and it is why the `finalize()` rejection here is *owned and discarded* rather
than routed anywhere: consuming it removes the process-level unhandled rejection the bump introduced, while settling
`outputPromise` from it would repair the typo by the back door and turn a documented silent hang into a `500`. R-1
forbids latent-bug repair and R-4 forbids the behavior change, so the hang stays. Measured on the migrated stack:
this site's normal archive answers `200`, its two guard paths answer **nothing at all**, and the server keeps serving
other routes throughout.

One consequence is accepted rather than engineered around, and it is identical on both `archiver` versions: an
archive failure at the misspelled site also reaches `archive.emit('error', …)`, and because the only listener on that
instance is misspelled the `EventEmitter` throws. That raise is untouched — it is baseline, not something the bump
introduced — and it is the same adjudication recorded for the escaping `TypeError` in `lib/controllers/folders.js`:
the wire outcome is reproduced, the process-level half is not deliberately re-created.

The third site, `createExportArchive` in `lib/workers/exports.js`, takes the **`downloadPostedZip` decision**, and
for the same reason: its error listener is spelled correctly — `archive.on('error', reject)` — and the output
stream's `close` handler already resolves with the processed and failed counts. `finalize()` is **returned** into
the `.catch()` that follows it, which calls the very same `reject` the correctly-spelled listener calls, so a
finalization failure rejected the promise before the bump and rejects it now, with the same error object; only the
unowned rejection disappears. Output-stream close remains the completion signal, and nothing in that chain resolves.
This site is a queue worker rather than a request, so its failure surfaces as the export's persisted `errorMessage`
rather than as a status code — which is why owning the rejection matters here even though the observable outcome is
unchanged: an unowned rejection would be a process-level event in a background job, where nothing is listening.

### 3.21 The remote-asset download becomes raw `node:http`/`node:https`, not `fetch`

**The ambiguity.** The dependency inventory maps the dead `request` package onto the global `fetch` built into
Node 22, and at three of its four call sites that mapping is exactly right: `lib/controllers/auth.js`,
`lib/controllers/users.js`'s OAuth exchange and `lib/util/recaptcha.js` all perform a small JSON request whose
decoded body is parsed immediately, so `fetch` is behavior-identical there. The fourth call site —
`assetUploadFromURL` at base `lib/controllers/users.js:L594-L616` — is the only one that **streams a response body
to disk and then persists and content-hashes those exact bytes**, and there `fetch` is not behavior-identical. This
section records why, and why the resolution is not "use `fetch` more carefully".

**What was measured.** One fixture — a 4,099-byte body, and its 44-byte gzip — was served by one origin to both
pipelines: the base commit's own `request@2.88.2`, installed in a checkout of the base commit, and Node
v22.23.2's global `fetch`.

| Property | base `request@2.88.2` | Node 22 global `fetch` |
|---|---|---|
| bytes written to disk from an origin that returns `content-encoding: gzip` | **44**, sha256/16 `06238af3cc0d971b` — the wire bytes | **4,099**, sha256/16 `a557d5812d39f083` — transparently decoded |
| `accept-encoding` on the wire | **not sent at all** | `gzip, deflate` |
| the complete header set on the wire | `connection`, `host` | `accept`, `accept-encoding`, `accept-language`, `connection`, `host`, `sec-fetch-mode`, `user-agent` |
| `referer` on the second hop of a redirect | the previous URL | absent |
| a non-`http(s)` scheme (`ftp:`, `javascript:`) | two distinct errors, `Invalid protocol: ftp:` and `Invalid URI "javascript:alert(1)"` | `TypeError: fetch failed` for both |

The first row is the decisive one, because those bytes are hashed by `FileUtil.uploadUserAsset` into the S3 object
Key: decoding them changes both the key and the stored object, which is a TR6 storage-format change on an asset
that already exists in buckets.

**Why "use `fetch` more carefully" is not available.** The buffering half of the problem *was* fixable inside
`fetch` — `response.body` is a `ReadableStream`, so the `arrayBuffer()` that materialized whole remote objects was
a call-site choice rather than a limitation. The byte half is not. Four attempts were measured against the same
always-gzip origin: the default request, an explicit `accept-encoding: identity`, an empty `accept-encoding`, and
reading `response.body` as a raw stream instead of calling `arrayBuffer()`. **All four delivered the decoded 4,099
bytes.** `undici` decodes on the strength of the *response's* `content-encoding` header regardless of what was
negotiated or how the body is consumed, and exposes no option to suppress it. A streaming `fetch` implementation
would therefore still have changed the persisted bytes.

**What baseline decided.** The AAP's own conflict resolution states that a package may be replaced only if the
replacement is proven behavior-identical at every call site it touches. It is not, here — so this one call site
moves to `node:http`/`node:https`, which are Node built-ins and add no dependency, exactly like the other
built-in substitutions in the inventory. `downloadRemoteAsset()` at the foot of `lib/controllers/users.js` carries
the full contract in its docblock: the four measured outcomes, the redirect budget of ten with the eleventh hop
raising and naming its own source URL, `referer` on every hop, userinfo becoming `Authorization: Basic`,
content-type taken from the final response only, and no status check — so a `404` body is still uploaded as the
asset, as it was at the base commit. The helper was then differentially verified against the base pipeline over
real HTTP on twenty checks covering identity and gzip origins, absolute and relative redirects, the budget
boundary at hops nine through twelve, a DNS failure, a mid-transfer socket abort, three rejected schemes, the
wire header set, basic auth, and a three-megabyte body to confirm streaming; every check matched.

Two consequences are recorded rather than repaired. The over-budget-redirect outcome logs **and** still uploads a
zero-byte asset and answers `200` — measured at the base commit, catalogued as outcome (b), and preserved. And the
review's own resolution text for this finding directs that filename derivation, content-type handling and the
absence of a status check be preserved, so none of the three is touched: no size cap and no status validation are
introduced, which R-4 would forbid in any case.


### 3.22 The parity baseline was recaptured from the exact base tree; the documented digest is unreproducible

This adjudication exists because two claims about the parity evidence were, on review, **asserted rather than
measured** — and because the correct response to that is to go and measure, not to soften the wording.

**The two ambiguities.**

1. *Provenance.* `test/baseline/route-table.json` recorded `metadata.baseCommit` as `cd983899…` and
   `metadata.hapiVersion` as `21.4.10`. That commit carries pre-migration application source but the **post-migration
   manifest**, so the table was captured with base-era code running on the *target* framework, with nine
   base-only packages restored into `node_modules` by an `npm install --no-save` overlay. It was therefore not a
   capture from the base toolchain, whatever its row content turned out to be.
2. *The frozen digest gate.* The Technical Specification records the baseline route-table digest as sha256
   `cd2a7e38a39bd84902ac1a0d69f50e2a`. The artifact recorded that **none** of 27 canonicalization attempts reproduced
   it, which left the changeset shipping a gate that its own evidence said had failed.

**The method.** A complete checkout of the exact base commit `2f8712a` was built with the exact base-declared
toolchain installed from the base `package.json` — `@hapi/hapi` **20.3.0**, `joi` **17.13.3**, `@hapi/inert` 7.1.0,
`@hapi/vision` 7.0.3, `@hapi/yar` 11.0.3, `@hapi/boom` 10.0.1, `mongoose` 6.13.9, `accepts` 1.1.4, `js-yaml` 3.0.2,
plus every base-only package at its base version (`tab` 0.1.0, `optimist` 0.6.1, `q` 1.0.1, `request` 2.88.2,
`node-uuid` 1.4.8, `aws-sdk` 2.1693.0, `node-cryptojs-aes` 0.4.0, `mkdirp` 0.3.5, `rimraf` 2.2.8, and the `marked`
0.3.2 fork with its module-scope `Renderer.prototype`). Tree integrity was verified file by file rather than assumed:
**519 of the 520** files tracked at `2f8712a` are byte-identical on disk, `package.json` is byte-identical, and the
single divergence is `package-lock.json` differing by one immaterial line (`"hasInstallScript": true`, an artifact of
installing under npm 11). The route table and the response corpus were then captured from that tree over **real
HTTP** on a genuinely bound socket, with `app.start`, the bind host and port, the ≥32-character session cookie
password and a dedicated database injected at runtime through `NODE_CONFIG` — **no YAML file was edited**, per
§0.7.5 — and the injection API was never used, because `@hapi/shot` is the sole source of the DEP0169 URL
deprecation.

**Result 1 — the route table is invariant across the whole toolchain change.** The exact-base capture on
`@hapi/hapi` 20.3.0 / `joi` 17.13.3 reproduces the previously delivered artifact **exactly**: all 233 row objects
identical in registration order, and all three digests identical —
sha256 `452116ce74301c61c92efb36fe8ead987b6a9e81d83a28af335c8d08fa1d64a8`,
md5 `dfc1e295156ecdbbee4a073b231b9326`,
registration-order sha256 `6a65d18273c731aa070cf905625a9dfe4789caf066dde0c5beb14c6dd8131898`.
The **migrated** tree on `@hapi/hapi` 21.4.10 / `joi` 18.2.3 produces the same three digests again. Three independent
captures across two major framework versions agree row for row, which is a materially stronger statement of TR1 than
the single capture it replaces: the route table is not merely unchanged by the migration, it is **invariant to the
toolchain**. One incidental finding made this checkable — hapi does not bake the server default into
`route.settings.auth`, so the 126 routes that inherit `mode:'try'` carry an *absent* key and the descriptor must
resolve `server.auth.settings.default` explicitly. Rendering the raw shape instead changes 126 of the 233 rows and
the digest with them, so the canonicalization block in `test/baseline/route-table.json` is load-bearing, not
decorative.

**Result 2 — the Specification's digest cannot be reproduced, and cannot be a SHA-256.** Forty-two candidate digests
(14 serializations × {sha256, sha256-first-32, md5}, a superset of the earlier 27) were computed over the exact-base
capture, covering trailing-newline, sort-order, separator-spacing, tab-separated, method-and-path-only, path-only,
JSON-encoded, unseparated, lowercased, CRLF and space-joined variants. **None** matched. The decisive observation is
structural rather than statistical: the documented value is **32** hexadecimal characters and a SHA-256 is **64**, so
no serialization of any input could have produced it under the algorithm it is labelled with.

**The resolution, and why it is AAP-authorized.** R-6 makes the observed behavior of the application at the base
commit the tie-breaker for every ambiguity, and the Specification's own §0.9.10 records that its figures rest on local
measurement rather than on any external source. Between a 32-character string that is not a valid SHA-256 and a
digest reproduced from three independent captures of the exact base tree, R-6 selects the measurement. So the
unreproducible value is **retained beside** the measured digests as `gates.documentedDigest`, labelled with its own
length and with `documentedDigestReproduced: "none"`, and the measured digests are the gate. Nothing was
reverse-engineered to force a match, no route declaration or application file was altered to chase it, and the
substantive gates — the 233 row count, the 137/63/19/13/1 method distribution, the 117 `/api/` paths, the 161
pre-handler routes and the 105/2/126 auth partition — match the Specification **exactly**, which is what makes the
digest divergence a serialization artifact rather than a parity failure.

**Result 3 — the response corpus is confirmed twice and replays clean.** The 58-route parameterless-GET corpus was
re-derived from the live table by the same published filter and re-requested over real HTTP from the exact base tree.
It reproduces the delivered corpus with **zero** differences across status, content-type, `Location`, `Set-Cookie`
name and attribute list, body kind and JSON key set for all 58 entries, and it confirms the measured distribution
**12 × 200, 16 × 302, 7 × 401, 22 × 404, 1 × 500**. Replayed against the **migrated** tree, all 58 entries again show
zero differences — including identical raw body byte counts — and the five per-status route sets are identical member
for member. The pre-existing 500 at `GET /api/users/assets` is still a 500, still delivered as a Boom JSON payload,
and still originates at `assetList` in `lib/controllers/users.js`; section 1.14 A explains why it is preserved.

**What was deliberately not done.** The corpus filter was not re-scoped, the request policy was not bent, and no
handler was touched to move a status code toward the documented tally. The Specification's prose figures are wrong
about the 200/302/404 split and wrong about the digest; they are recorded as wrong, with the measured values beside
them, because R-4 forbids changing behavior to make documentation true and R-6 makes the measurement authoritative.

### 3.23 A branch that never settled is reproduced, not converged — except where the baseline itself answered 500

**The ambiguity.** A number of baseline branches produced **no response at all**: a callback fell through without
calling back, or handed a raw `Error` to a responder the frame had already left, so the shim's deferred capture never
settled and the request hung for the life of the connection. Once the deferral is retired the same branch returns
`undefined`, and hapi answers its own scrubbed 500. Two readings are available and they disagree. Either the
convergence on 500 is accepted — a hang has no status code, no payload and no termination, so the corpus cannot encode
one and the parity gate cannot assert one — or the hang is the measured baseline fate and must be reproduced with a
deliberately non-settling promise, at the cost of holding a socket open.

**What baseline decided.** Neither reading applies uniformly, because the base wrapper answered differently depending
on **where** the failure happened. The rule that decides it is stated in full in
[section 6.1](#61-the-base-wrapper-rule-which-decides-every-row-below), and it splits these branches into two families
that were adjudicated separately:

- **Family A — the frame returned `undefined` and nothing settled the capture: `NO RESPONSE`.** That is the measured
  baseline fate, so it is **reproduced** rather than converged. `lib/http/pending.js` supplies the reproductions:
  `forever()` and its alias `hang()` return a promise that never settles, and `rejectOrHang(h, json, err)` is
  transparent on every non-raising path, producing a hang only where the baseline responder itself raised. The
  delivered tree carries **38** such call sites — 20 `forever`, 9 `hang` and 9 `rejectOrHang` — in `admin.js`,
  `auth.js`, `course.js`, `courses.js`, `folders.js`, `trinket.js` and `users.js`. Every one is inventoried with its base-commit
  mechanism in [section 1.15](#115-the-branches-that-answer-nothing-and-the-mechanism-that-preserves-them) and
  [section 6.2](#62-the-table), and site by site in
  [section 9](#9-the-no-response-and-process-fate-preservations-site-by-site). `route.settings.timeout` was measured as
  `{ server: false }`, so nothing times a pending request out — and nothing did at the base commit either.
- **Family B — the failure was a genuine throw with no owner, which the base commit's own catch-all already mapped to
  `Boom.badImplementation` → HTTP 500.** Here the 500 *is* the baseline fate, so these sites are kept verbatim and
  **nothing is added to make them answer**. The verified members are the `request.catch(...)` invocation in
  `lib/controllers/folders.js#update` (`2f8712a:L128`; `L181` delivered), which sits inside a `.catch` callback the
  handler frame **returns**, so its `TypeError: request.catch is not a function` became a rejection rather than a
  fall-through; and the two `JSON.parse` calls in `lib/controllers/trinket.js` that are deliberately left outside the
  surrounding `try` (`2f8712a:L1013` and `L1080`; `L1173` and `L1271` delivered).

**The two `request.catch` sites have opposite fates, and that is the sharpest illustration of the rule.** Both call a
responder that has never existed — `lib/http/responseContract.js` returns exactly `{respond, reject}` and publishes no
third one — but in `create` the raise happened inside an **unowned Mongoose save callback**, so the request answered
nothing (Family A, reproduced with `Pending.forever()`), while in `update` the identical call sits in a **returned**
promise chain, so the same `TypeError` answered 500 (Family B, left to converge). Reading either site in isolation
gives the wrong answer for the other.

**Why this is safe, and what must not happen.** The socket objection to Family A is real and is answered by the frame
the rules set rather than by preference: R-4 freezes the **HTTP-visible** fate, the measured fate was *no response*,
and converging it to a 500 would put a status code on paths where the captured baseline corpus has none — a TR2 parity
failure at exactly the routes R-6 nominates as the tie-breaker. What is deliberately **not** reproduced is the
process-level half of those failures: Mongoose re-threw a callback exception through `immediate()` and no
`uncaughtException` handler exists anywhere in the repository, so the base commit could take the process down; the
delivered tree does not, and section 6.1 records the asymmetry. For Family B, no new status code, default response,
`else` branch or validation guard may be added, and no third responder may be published in
`lib/http/responseContract.js` — publishing one would turn a measured 500 into a working response. No source comment
at any of these sites grants an exception to the preservation rules: this adjudication and the inventories it names
are the record, and the comments state only the resulting invariant.

### 3.24 `Query#stream()` has thrown since mongoose 5, and the throw is preserved — as is `count()`

**The ambiguity.** `lib/workers/exports.js` builds its per-trinket archive by iterating a `Query#stream()`
(`2f8712a:L215`; `L261` delivered). That method was removed in **mongoose 5** and this repository runs **6.13.10**,
where `typeof query.stream` is `undefined` and the call raises `TypeError: <query>.stream is not a function`. The base
commit contains the identical call, so the bulk-export worker has been unable to complete a job since the ODM was last
advanced. Converting the surrounding callback chain to `async`/`await` put the question directly in front of the
migration: rewrite it onto the supported `Query#cursor()`, or carry the throw forward.

**What baseline decided.** The throw is **carried forward verbatim**. It is not silent: it is caught by the `Promise`
executor in `createExportArchive`, surfaces in `processBulkExport`'s `catch`, and its message is written to the export
document's `errorMessage` field and delivered to the user by `sendFailureEmail`. That message is therefore both an
observable output and a persisted value, and `.cursor()` would replace both with a successful export. Repairing it is
latent-bug repair, which R-1 places outside the four sanctioned diff categories, and it would change a persisted
value, which TR6 forbids.

**Why this is safe, and what must not happen.** The rewrite is mechanical and remains available as a separate,
deliberate change; nothing else in this changeset depends on the worker succeeding. What must not happen is a silent
"while I am here" swap to `.cursor()` during the async conversion — the surrounding structure looks exactly like code
that wants modernising, and the only thing marking it as deliberate is the inline comment at the call site pointing
here. The same reasoning governs the adjacent trinket count, which the base commit issued as
`Q.nsend(Model, 'count', { _owner: userId })` at `2f8712a:L122` and which is now `await Model.count({ _owner: userId })`
at `L149`: `count()` is deprecated on mongoose 6 and removed on 7 — one of the reasons the ODM is held inside the 6.x
line, recorded in [MIGRATION-DEPENDENCY-INVENTORY.md](MIGRATION-DEPENDENCY-INVENTORY.md) — and it deliberately stays
`count()` rather than becoming `countDocuments()`, which takes a different driver path.

### 3.25 `validator` 13 silently changed a PERSISTED field, and the old verdict is restored by a shim

**The ambiguity.** `validator` was bumped 5.7.0 → 13.15.35 for `security` and `incompatible` reasons, and the bump was
recorded as call-site-free on the strength of `isEmail` having been "verified on both true and false inputs". Two
call sites in `lib/models/courseInvitation.js` consume it. The question is whether a stricter validator is simply a
better validator here, or a prohibited behaviour change.

**What measurement decided — it is a prohibited change, and a data-level one.** Neither call site merely shapes a
response. `addList` sets `update.status = 'invalid'` and `updateEmail` sets `this.status = … ? 'resend' : 'invalid'`,
so `isEmail`'s verdict is **written to MongoDB**. And nothing upstream filters the address: `POST
/api/courses/{courseId}/invitations` declares only `emailList : Joi.array().required()` — no item constraint at all —
and `PUT /api/courses/{courseId}/invitations/{invitationId}/email` declares only `email : Joi.string().optional()`.
This function is the sole gate on a persisted value, which places it squarely under **TR6** (storage-format
invariance) rather than under ordinary validation parity.

The behavioural delta was then isolated exactly. Reading 5.7.0's own `isEmail` implementation shows it applied
Google's dot-insensitive addressing inline: when the domain was **exactly** `gmail.com` or `googlemail.com` it
replaced every `.` in the local part with nothing before validating. `validator` 13 moved that normalisation out of
`isEmail` and into `normalizeEmail`, so the same addresses now fail. Measured:

- A 51-case probe across both versions found **exactly one** differing verdict: `a..b@gmail.com`, accepted by 5.7.0
  and rejected by 13.15.35.
- A systematic local-part × domain matrix confirmed the delta is **entirely** Gmail-shaped: all **21** hits fall on
  `gmail.com` / `googlemail.com`, across the seven local-part shapes `a..b`, `a...b`, `..ab`, `ab..`, `a..b.c`,
  `.a.b` and `a.b.`. Matching is on the **exact** domain, not a suffix — `sub.gmail.com` is unaffected.
- **No option restores it.** `allow_utf8_local_part`, `ignore_max_length`, `blacklisted_chars` and
  `allow_display_name` were each tried; all still reject.
- Non-string input is unchanged in kind: both versions throw (with different message text), and in any case both
  call sites invoke `.toLowerCase()` on the address first, so a non-string never reaches `isEmail`.

**The resolution.** A module-local `isEmailLegacy` in `lib/models/courseInvitation.js` reapplies 5.7.0's
normalisation and then delegates to `validator` 13, and both call sites use it. This keeps the security bump while
freezing the persisted outcome. Parity is **verified, not asserted**: the function extracted from the committed file
was run against `validator` 5.7.0 over **2,764** generated cases — every local-part shape crossed with every domain
shape, in raw and lower-cased form, plus the pathological forms `plainaddress`, `@`, `a@@b`, `a@b@c`, leading and
trailing whitespace, an embedded newline, display-name forms and a 400-character local part — with **zero** verdict
differences. **56** of those cases are addresses that bare `validator` 13 rejects and that therefore would have been
persisted as `invalid`.

Per **R-4** this is preservation, not repair: dot-insensitive Gmail acceptance was the 2013-era behaviour, existing
invitation documents were written under it, and "the stricter validator is more correct" is exactly the
rationalisation R-4 forbids.

### 3.26 The legacy-pathname adapter is SHARED, because two callers must derive asset filenames identically

**The ambiguity.** Section 3.13 records that the deprecated `url.parse` is replaced by the non-throwing static
`URL.parse()`. Two independent places derive an asset **filename** from a stored asset URL: the trinket controller,
which builds archive entry names, and the bulk-export worker, which does the same for the export archive and its
manifest. Each could carry its own null-handling, and initially each did. The question is whether that is
acceptable duplication or a correctness problem.

**What measurement decided — it is a correctness problem, and a TR6 one.** The controller carried a full
reproduction of the legacy parser; the worker carried a simplified one that fell back to the **raw string** when
`URL.parse` returned null. Those disagree for every input carrying a query or a fragment, because the legacy parser
stripped both and the raw string does not. Measured across a 41-input differential of real asset-URL shapes against
`require('url').parse(x).pathname`, the worker's simplified version produced **21 wrong basenames**, including:

| Input | Baseline basename | Worker's basename before the fix |
|---|---|---|
| `/dir/a.png?x=1` | `a.png` | `a.png?x=1` |
| `a.png#f` | `a.png` | `a.png#f` |
| `//cdn.example.com/a/b.png?q=1` | `b.png` | `b.png?q=1` |
| `/dir/my%20file.png?x=1` | `my%20file.png` | `my%20file.png?x=1` |
| `dir\sub\a.png` | `a.png` | `dir\sub\a.png` |
| `/dir/?x=1` | `dir` | `?x=1` |
| `mailto:a@b.c`, `tel:+1234`, `about:blank`, `urn:isbn:123` | `TypeError` | `a@b.c`, `+1234`, `blank`, `isbn:123` |

Those names are **written into the export archive**, so this is storage-format drift under **TR6**, not a cosmetic
difference. The resolution is one shared adapter, and **which** adapter was itself decided by measurement. Two
candidates existed: a 30-line lexical heuristic, and a full transcription of the deprecated parser. Both were run
against `require('url').parse(x).pathname` as the oracle over **465,780** inputs — the complete cross-product of the
scheme, host, path and tail fixtures in `test/lib/util/legacy-pathname.js`, each also wrapped in leading and trailing
whitespace, plus twenty hand-picked pathological shapes. The transcription diverged on **0** of them; the heuristic
diverged on **301,197** pathnames and **265,941** basenames, because it does not reproduce the legacy parser's
percent-encoding (for `[::1\u0000]/a'b.png` the oracle answers `[::1\u0000]/a%27b.png` and the heuristic answers the
raw `'`). The shared adapter is therefore `lib/util/legacyUrl.js#legacyPathname` — documented in full in
[section 11](#11-libutillegacyurljs-a-faithful-port-of-the-deprecated-parser-not-a-whatwg-substitution) — required
directly by both callers: the worker at `lib/workers/exports.js:L11` behind its `assetPathBasename` helper, and the
controller at `lib/controllers/trinket.js:L35` for its three archive-entry sites. One module, two requires, and this
class of divergence is structurally impossible rather than merely fixed.

**The null is forwarded, not guarded.** `assetPathBasename` passes the adapter's result straight to `path.basename`
with **no** `|| assetUrl` fallback. The baseline computed `path.basename(url.parse(assetUrl).pathname)`, and the
legacy parser reported a **null** pathname for fragment-only, whitespace-only, empty and non-slashed-scheme inputs —
so `path.basename(null)` threw a `TypeError` from exactly that position. A fallback would look defensive while
converting a baseline `TypeError` into a silently-accepted filename, which **R-4** forbids. Verified: with the null
forwarded, the shared adapter matches the baseline on **all 41** inputs with **zero** differences.

### 3.27 The temp-file unlink is fire-and-forget, and the job settles without it

**The ambiguity.** `lib/workers/exports.js` deletes its temporary archive in two places — once on success after the
notification email, once in the failure path. The conversion from `fs.unlink(tempFile, function () {})` to
`fs.promises.unlink(...)` invites an `await`, and the file's own implementation notes originally called for one.
Awaiting reads as the more careful choice: the file is definitely gone before the function returns.

**What baseline decided — do not await.** The base commit passed an **empty callback** and never waited. The job
therefore settled, the completion record was written and the notification email was sent with the unlink still
outstanding; in the failure path the `status: 'failed'` record and the failure email were likewise written and sent
without waiting. Awaiting makes the job's completion depend on a filesystem operation the baseline never depended
on, which reorders an observable side effect and can change the moment a client polling `getExportStatus` first sees
`completed`. Under **R-6** the base commit's ordering decides, so both sites are now
`fs.promises.unlink(tempFile).catch(function () {});` — un-awaited, with the rejection swallowed exactly as the empty
callback swallowed it. This matches the identical shape already preserved at
`lib/controllers/trinket.js#downloadPostedZip`, where the error response is sent immediately and the unlink trails
behind it.

The empty `.catch` is load-bearing rather than decorative in the failure path: were the rejection allowed to
propagate, `err.message` would never be persisted and the failure text the worker reports would change.

**A related dependency-API correction in the same file.** The `failed` handler logged `job.jobId`. `bull` 0.7's
`Job` exposed the numeric identifier under that name, but `bull` 4 renamed it to `id` and exposes no `jobId` at all,
so after the bump the log line printed `undefined` where the baseline printed an identifier. It now logs `job.id`,
restoring the baseline output. Per **R-4** the surrounding `console.log` calls are preserved rather than removed —
see section 1.12 — so the value they print has to be preserved too.

### 3.28 A failed material download kills the process, and that channel is reproduced rather than repaired

**The ambiguity.** `lib/util/file.js#downloadMaterialFile` returns a `PassThrough` **synchronously** and fills it
once the S3 request resolves — a shape forced by its caller, which hands the return value straight to the response
toolkit and therefore cannot receive a promise. AWS SDK v3 removed `.createReadStream()`, so the failure path had to
be rewritten, and the obvious rewrite is `stream.destroy(err)` on the returned stream. That reads as strictly
better: the caller learns the request failed, and the server answers with a 500 instead of falling over.

**What measurement decided — the obvious rewrite is a prohibited improvement.** Node 22's own
`Readable.prototype.pipe` was dumped and inspected. Its only error wiring is:

```js
prependListener(dest, 'error', onerror);
```

There is **no** `src.on('error', …)` anywhere in `pipe()`. A source's `'error'` is therefore never forwarded to the
destination, and this was confirmed to hold whether or not the destination has listeners of its own.

That settles what the base commit did. It read
`client.getObject({...}).createReadStream().pipe(stream)`, in which the v2 read stream is an **anonymous temporary**
— no variable holds it, `pipe()` gives it no listener, and nothing else attaches one. So on a failed request it
emitted `'error'` with **zero** listeners, which throws; with no `process.on('uncaughtException')` handler anywhere in
this repository (see section 1.13's neighbours — the only mention is a comment), that **killed the process**, and the
returned `PassThrough` was left untouched, so the response never completed.

The two channels were measured side by side:

| Shape | `returned.destroyed` | `returned.errored` | Events on returned stream | `uncaughtException` |
|---|---|---|---|---|
| Baseline: error on an unowned **source** piped into the returned stream | `false` | `null` | none | **yes** |
| Same, with a hapi-like `'error'` listener attached | `false` | `null` | **none** | **yes** |
| Rejected rewrite: `returned.destroy(err)` | `true` | the error | `error`, `close` | no |

The second row is the decisive one: even with a listener attached, the baseline shape delivers **nothing** to the
returned stream. So `destroy()` does not preserve the channel — it replaces process death plus a hung response with a
tidy HTTP 500. Under **R-4** that improvement is forbidden, and under **R-5** the error-to-response mapping has to
survive unchanged.

**The resolution.** The error is emitted on a **source** `PassThrough` that is piped into the returned one, exactly
as the v2 read stream was, so it carries no `'error'` listener and reaches the identical unowned-emit channel with the
identical error object. Verified against the committed function with a stubbed rejecting S3 client:
`destroyed=false`, `errored=null`, no events, one `uncaughtException` — **parity PASS**. The success path was
verified separately: the stubbed `Body` flows through the added source and arrives intact (20 bytes,
`"GIF89a-payload-bytes"`), and the method still returns a pipeable stream synchronously rather than a promise, so its
caller's contract is untouched. The client is the shared `aws.getS3Client()` singleton the rest of that module uses,
not a second client.

**Re-measured on the delivered runtime (node v22.23.2), because the whole adjudication rests on one stream property.**
`src.pipe(dst)` leaves the **source** with `listenerCount('error') === 0` and gives the **destination** exactly `1`;
`source.emit('error', err)` on the listener-less source throws synchronously; and the destination is left
`writableEnded=false destroyed=false errored=false` — whether the failure arrives as an `emit('error')` or as
`source.destroy(err)`. The returned stream therefore never completes, exactly as at the base commit, and only
`destroy()` **on the returned stream** would have changed that.

**The seam with [section 3.31](#331-where-a-throw-is-raised-is-itself-observable-behavior) and
`lib/http/pending.js`, stated explicitly because the two look contradictory.** Everywhere else in this changeset the
HTTP fate of a base-commit branch is reproduced while its process termination is **not**
([section 9](#9-the-no-response-and-process-fate-preservations-site-by-site)). Here the termination is reproduced too.
The rule that makes both consistent is *add nothing in either direction*: at the `Pending` sites the migrated shape no
longer contains the unowned callback at all, so reproducing the death would mean **manufacturing** a fault; here the
migrated shape still contains the unowned source stream, so suppressing the death would mean **adding** a listener or
a `try`/`catch` the base commit did not have. Neither direction adds machinery whose only purpose is to change the
process-level outcome, which is also what R-1's diff-surface budget asks for.

### 3.29 A promisified callback bridge uses two-argument `.then`, never a trailing `.catch`

Converting an error-first callback API to a promise chain has one non-obvious trap, and it bites every site in this
changeset that keeps a callback in its public signature. `lib/util/file.js#_upload`, `lib/models/user.js#findAdminList`,
`lib/models/user.js#encryptPassword` and `lib/models/user.js#exists` all reference this note; it is recorded once here
rather than restated at each of them.

**The trap.** A trailing `.catch(cb)` reads like a faithful translation of `if (err) return cb(err);`, but it is
strictly wider. It rejects on two different things: the underlying operation failing, **and the success handler
throwing** — and the success handler is precisely where `cb` is invoked. So if `cb` itself throws, the trailing
`.catch` captures that throw and calls `cb` a **second** time, now with the exception raised by the first call as its
error argument. The baseline callback form could not do this: a throw from inside a `bcrypt` or mongoose callback
escaped the callback frame entirely and became an `uncaughtException`.

**Why it matters here rather than being academic.** `encryptPassword` is a mongoose `pre('save')` hook, so its `next`
is the middleware continuation. Calling it twice advances the save pipeline twice — once successfully, once with an
error — from a single save. `exists` hands its `cb` to controller code that renders a response, so a double
invocation is a double response attempt. Neither is reachable at baseline.

**The rule.** Put the failure handler in the **second argument** of `.then`, which keeps the two paths disjoint: it
observes only rejections produced upstream of it, never anything thrown by its sibling success handler. Where a chain
has intermediate links, only the final `.then` carries the handler — the intermediate links declare no failure
handler, so upstream rejections flow past them into it unchanged. In `encryptPassword` that means a `genSalt`
rejection and a `hash` rejection both still arrive at `next(err)` carrying the identical error object the callback
form received.

**Measured.** Both functions were extracted verbatim from the committed file and exercised against stubbed
dependencies, with the pre-fix trailing-`.catch` shape synthesized mechanically from the same text for comparison:

| Case | Committed (two-argument `.then`) | Pre-fix (trailing `.catch`) |
|------|----------------------------------|------------------------------|
| `genSalt` rejects | `next(saltErr)` once | `next(saltErr)` once |
| `hash` rejects | `next(hashErr)` once | `next(hashErr)` once |
| success | `next()` once, password replaced | `next()` once, password replaced |
| success, `next()` throws | `next()` once; throw escapes unhandled | **`next()` + `next(thrownError)`** |
| `find` rejects | `cb(qErr)` once | `cb(qErr)` once |
| success, `cb` throws | `cb(null, result)` once; throw escapes | **`cb(null, result)` + `cb(thrownError)`** |

The error paths are identical in both shapes — which is why this defect is invisible until a consumer throws. Only the
last-row behavior differs, and only the committed shape reproduces baseline. `encryptPassword` also keeps arity 1 and
returns `undefined`, so kareem still classifies it as next-style middleware rather than as a promise-returning hook,
and `exists` still returns a thenable.

**One site deliberately keeps its trailing `.catch`.** `lib/models/model.js:L147` reads
`promise.then(function(doc) { cb(null, doc); }).catch(cb);` — and that line is **byte-identical at the base commit**.
It is pre-existing behavior, not a conversion artifact, so under **R-4** and the diff-surface budget of **R-1** it is
left exactly as it is. This entry records it so a later reader does not mistake the inconsistency for an oversight.

### 3.30 A handler branch that never responded still never responds

Several 2013-era handler branches answered **nothing at all**. This entry records the channel once; the individual
branches cite it rather than re-deriving it.

**The baseline mechanism.** Every legacy handler ran under the compatibility layer in `lib/util/routeParser.js`, which
built a deferred promise, handed the handler a synthetic `reply`, and `await`ed that deferred as the route's response.
The deferred was settled only by an explicit `reply(...)`, `request.success(...)` or `request.fail(...)` call. So a
callback that simply **fell off its end** — an `if` with no `else`, an ignored error argument, a `.then` whose result
matched none of its expected shapes — left the deferred unsettled forever, and the awaiting route handler never
resolved. The client received no status code, no headers and no body; the request stayed open until the peer gave up.

**Why this is not a hypothetical.** `lib/controllers/admin.js#updateUser` is the clearest case. At the base commit its
entire body was one `User.findById(id, function (err, user) { … })` callback whose `if (request.payload.roles)` block
had no `else`. A falsy `roles` payload therefore reached the end of the callback with no responder called at all.

**The migration trap.** Once the deferral is gone, falling off the end of an `async` handler returns `undefined` — and
hapi 21 does **not** treat that as "no response". It raises `handler method did not return a value, a promise, or
throw an error` and answers its own **HTTP 500**. So the naive conversion silently manufactures a status code that no
baseline request on that branch ever received. It is tempting to call that convergence unavoidable; it is not.

**The resolution.** Return a promise that is never resolved and never rejected. In the delivered tree that promise
comes from one greppable module rather than being written out at each site —
`return Pending.forever();`, or its alias `Pending.hang()`, from `lib/http/pending.js`, whose `forever()` is exactly:

```js
return new Promise(function() {});
```

A fresh promise is returned per call, so a hung request's continuation is retained by that request alone.

hapi 21 awaits the handler's return value, so an unsettled promise leaves the request in exactly the state the
unsettled deferral left it in. Measured on a live hapi 21.4.10 server, the two shapes are demonstrably different and
therefore not interchangeable:

| Handler returns | Measured client outcome |
|---|---|
| `new Promise(function() {})` | **no response** — connection stays open, client aborts |
| `undefined` (falls off the end) | **500** `{"statusCode":500,…,"message":"An internal server error occurred"}` |
| a normal value | 200 with that value |

Verified against the real `admin.updateUser` with a stubbed `User.findById`: a falsy or `undefined` `roles` payload
leaves the returned promise **pending with no responder invoked at all**, while a truthy `roles` payload still
resolves through `request.success({success:true})` and a missing user still resolves through
`request.fail({message:'user not found'})`. Only the branch that never answered still never answers.

**Why it is preserved rather than repaired.** Choosing a status code here — 400 for the missing field, 200 for a
no-op, 422 for the validation gap — would be latent-bug repair and an observable change on a route that clients may
already treat as a timeout. **R-4** forbids the improvement and **R-5** requires the error-to-response mapping to
survive the conversion unchanged. No `else` branch, no default response and no validation guard is added.

### 3.31 Where a throw is raised is itself observable behavior

Section 3.30 covers branches that never responded. This one covers branches that **killed the process**, and the
distinction matters because the two look identical in a diff and need opposite fixes.

**The baseline mechanism.** Many 2013-era callbacks ignored their error argument and then dereferenced the result
anyway — `Course#copy`'s callback reading `course.slug`, `fs.stat`'s callback reading `stats.size`. On failure the
result was `undefined` and the dereference raised a `TypeError` **inside a callback that no promise chain owned**.
Nothing could catch it: the compatibility layer's `try`/`catch` wrapped only the synchronous body of the handler, and
the callback ran on a later tick. So the `TypeError` reached `process.on('uncaughtException')` — of which this
repository installs none — and the process died. The request was never answered, because the deferred was never
settled either.

**The migration trap, and why it is the mirror image of 3.30.** The natural conversion is to promisify the callback and
`await` it, hoisting the dereference into the `async` handler body:

```js
var course = await new Promise(function (resolve) {
  thing.copy(user, function (err, copied) { resolve(copied); });   // err ignored, as at baseline
});
var url = build(course.slug);                                       // <- throw is now OWNED
```

That is a faithful-looking rewrite that changes the outcome completely. The `TypeError` is now raised inside the
`async` function, so it becomes a rejection of the handler's promise, and hapi 21 maps it to its own scrubbed
**HTTP 500**. A branch that emitted no status at all now emits one. **R-5** requires the error-to-response mapping to
survive the conversion, and inventing a 500 is not surviving it.

**The two shapes that reproduce the wire outcome, and the one this tree ships.** The first keeps the dereference where
baseline raised it — inside the callback — and resolves the promise from within that same callback, so the success path
still has a value to return:

```js
return new Promise(function (resolve) {
  thing.copy(user, function (err, course) {
    var url = build(course.slug);            // still unowned: throws past the executor
    resolve(finish(url));                    // success path resolves from inside
  });
});
```

The delivered `lib/controllers/courses.js` takes the second shape instead: it promisifies the callback, `await`s it
inside a `try`, and answers the measured wire outcome explicitly — `return Pending.hang();` when the copy or the
`fs.stat` fails, `return Pending.forever();` at the point the base commit's unguarded dereference of the missing
document would have raised. Both shapes emit **no response**, which is the observable half; they differ only in whether
the process also dies, and this tree reproduces the HTTP fate without reproducing the termination, for the reason
recorded in [section 9](#9-the-no-response-and-process-fate-preservations-site-by-site) and at
`lib/http/pending.js`. The one place where the termination *is* reproduced is
[section 3.28](#328-a-failed-material-download-kills-the-process-and-that-channel-is-reproduced-rather-than-repaired),
which states the rule that separates the two cases.

**The property the first shape relies on, measured rather than assumed.** A `Promise` executor captures only throws
raised during
its own *synchronous* execution. A throw from a callback the executor merely *registered*, invoked on a later tick,
escapes the promise entirely: the promise stays **pending forever** and the throw surfaces as an `uncaughtException`.
Verified directly — an executor that schedules `setTimeout(function () { throw new TypeError(...); })` leaves its
promise `PENDING` and produces exactly one uncaught `TypeError`. Both call sites satisfy the precondition:
`Course#copy` invokes its callback only from inside `.then()` handlers, and `fs.stat`'s callback is always
asynchronous.

**Measured outcomes for the two branches in `lib/controllers/courses.js`.**

| Branch | Input | Promise state | Responder called | Uncaught |
|---|---|---|---|---|
| `copy` | callback gets `(err, undefined)` | **pending** | none | `Cannot read properties of undefined (reading 'slug')` |
| `copy` | callback gets `(null, course)` | resolved | `success({classPageUrl:…})` | none |
| `copy` | callback never invoked | **pending** | none | none |
| `returnZip` | `fs.stat` fails | **pending** | none | `Cannot read properties of undefined (reading 'size')` |

The third row is a second, independent hang that `Course#copy`'s deliberately unterminated inner chain produces by
never invoking the callback at all; it is reproduced rather than repaired, and needs no special handling once
ownership is left alone.

**A consequence for the dependency swap in `returnZip`.** The `rimraf` replacement appears there twice as
`await fs.promises.rm(ownerDir, { recursive : true, force : true })`, each inside a `try` whose `catch` swallows the
failure — because the base commit's `rimraf(ownerDir, function () { ... })` callback declared no parameters at all and
could not observe one. The promise form is usable precisely *because* the response is no longer assembled inside that
callback: the branch that the base commit answered by dying now answers by returning `Pending.forever()`, so the
`TypeError`'s escape route no longer has to be preserved structurally. The package-level swap is unchanged either way.

### 3.32 Four identical-looking branches in one file, three different observable channels

`lib/controllers/course.js` contains four branches whose source text at the base commit was, character for
character, the same idea:

```javascript
// unknown failure
return reply({ err : err, message : err.message });
```

They appear in `createCourse` (base commit `L29`), `updateCourse` (`L130`), `copyCourse` (`L193`) and
`updateInvitation` (`L821`). A reader naturally assumes one behaviour. **Measurement shows three, and the
discriminator is not visible on the line itself.** This section records the mechanism, because a maintainer who
"harmonises" these four sites will silently change behaviour on three of them.

**The mechanism.** The retired shim's synthetic `reply(value)` did not serialize its argument. For a value that was
neither Boom nor an `Error` it called `h.response(data)` internally and then returned a **chainable builder** — a
plain object carrying exactly six own enumerable properties, `redirect`, `code`, `type`, `bytes`, `header` and
`view`, **every one of them a function** (base commit `lib/util/routeParser.js:L375-L405`). The shim's deferred was
settled only by a terminator: `redirect()`, `code()`, `header()` and `view()` each called `responseResolver`, while
`type()` and `bytes()` deliberately did not. None of these four sites calls any terminator.

What decides the outcome is therefore what happens to the **discarded builder**, and that is governed by the shim's
tail (base commit `lib/util/routeParser.js:L549`, `L568-L572`):

```javascript
var result = await handler.call(this, request, reply);
// ...
// If handler didn't return a value, wait for request.success/fail to be called
if (result === undefined) {
  result = await responsePromise;
}

return result;
```

- Where the builder is produced inside a **callback whose return value nobody consumes**, the handler itself
  resolved `undefined`, so the shim fell through to `await responsePromise` — a promise nothing would ever settle.
  The request **hung open forever** and no status code was emitted. This is `createCourse`, `updateCourse` and
  `copyCourse`.
- Where the builder is produced inside a `.catch` on a chain the handler **returns**, the builder became that
  chain's resolved value. `result` was therefore *defined*, the shim skipped its deferred entirely and returned the
  builder to the framework, which JSON-serialized it. Because all six own properties are functions, that
  serialization is exactly `{}`. The request **settled a normal HTTP 200 with body `{}`**. This is
  `updateInvitation` alone.

**R-6 adjudication.** The three hanging branches return `Pending.hang()` — the never-settling promise of
[section 3.30](#330-a-handler-branch-that-never-responded-still-never-responds) — which reproduces the hang exactly.
Falling off the end instead would resolve `undefined`, which hapi 21 rejects with `handler method did not
return a value, a promise, or throw an error` and answers as its own HTTP 500 — inventing a status code no baseline
request on those branches ever received. `updateInvitation` keeps `h.response({})`, which reproduces its 200 `{}`
exactly. The apparent inconsistency in the source is the faithful outcome; making the four sites look alike is what
would be wrong.

**A fourth channel in the same file: HTTP 200 carrying an undefined value.** `archiveCourse` (base commit
`L160-L172`) ran `course.save(function(err, course) { return request.success({ course : course }); })` as a bare
statement. The callback **ignores `err` entirely**. On a save failure mongoose invoked it with the document argument
absent, so `course` was `undefined` and the callback **still called the responder**, settling a perfectly ordinary
HTTP 200 whose `course` key `JSON.stringify` then dropped. This is neither a hang, nor a fatal fault, nor a 500.
A bare `await course.save()` would have surfaced the rejection to the centralized error map as a scrubbed 500, so the
delivered conversion reproduces the ignored error as the `undefined` document the callback actually received —
`try { course = await course.save(); } catch (saveError) { course = undefined; }` followed by the unchanged
`return h.respond({ course : course })`. A two-argument `.then` resolving to `undefined`
([section 3.29](#329-a-promisified-callback-bridge-uses-two-argument-then-never-a-trailing-catch)) is the same thing
written differently; what matters is that the responder still runs and still receives an absent document.

The contrast with `updateLesson` and `moveLesson` — whose callbacks also ignore `err`, and which are documented in
section 3.31 as fatal — is a single detail: those two **dereference** the document they were handed
(`lesson.name`, `course.id`), so `undefined` raised a `TypeError` in a context the shim did not own.
`archiveCourse` dereferences nothing. Same ignored error, opposite channel.

**Why none of the 41 `Boom.*` references in this file ever produced the status code they name.** The module binds
`@hapi/boom` as `errors` (`L3`) and never uses that binding; `Boom` is required nowhere in the file. It is not a
Node global, no module assigns `global.Boom`, and `app.js:L18` binds it with `const`, which is module-scoped and
does not leak. Evaluating the identifier therefore raises `ReferenceError: Boom is not defined` **before** any
property access or responder call. Verified by executing a permission-denied branch directly against the module.

The consequences are uniform and deliberate:

| Site | Reads as | Actually answers |
|------|----------|------------------|
| Every `throw Boom.forbidden()` permission denial (39 sites) | 403 | scrubbed **500** |
| `userLookup`'s `throw Boom.notFound()` for an unknown login | 404 | scrubbed **500** — the `ReferenceError` is caught by the chain's own `.catch` |
| `Boom.forbidden(err)` at `L1003` and `L1060` | 403 carrying the inner error text | scrubbed **500**, no error text on the wire |

The repository-wide census of this defect — **61** call sites across every module that carries it — is
[section 10](#10-the-undeclared-boom-scrubbed-500s-61-call-sites-that-never-returned-the-status-they-name), and the
`course.js` adjudication is also recorded as
[section 4.13](#413-the-undeclared-boom-identifier-in-coursejs); the table above is the per-file view, not a second
finding. Adding a `Boom` require, or rebinding these onto the existing `errors` alias, would silently convert 500s into
403s and 404s across all 41 sites — a large, entirely invisible behaviour change. The identifier is left exactly as
written, which is why the two error-object pass-throughs the Agent Action Plan asks to preserve are preserved by
doing nothing to them.

### 3.33 A rejection handler that returns a value is not a dead end, and one archive chain has four outcomes

`lib/controllers/trinket.js` saves trinket code two ways — `draft` (base commit `saveDraft`, `L1004-L1026`) and
`autosave` (`L1071-L1092`). Both accept an optional base64 zip and both run the same five-line promise chain. That
chain looks like ordinary error handling and is in fact the most behaviourally dense construct in the file: it
produces **four different observable outcomes**, and two of them involve the process dying.

The base commit shape, with the detail that matters highlighted:

```javascript
zip.loadAsync(request.payload.zipCode, { base64: true })   // BARE STATEMENT - nothing awaits this
  .then(function(content) {
    return content.file("zipCode").async("string");
  }, function(err) {
    return request.success();          // <-- RETURNS a value, so the chain RESOLVES and continues
  })
  .then(function(code) {
    update.code = JSON.parse(code);    // <-- `code` is whatever the line above returned
    // ... persist, then request.success()
  }, function(err) {
    return request.success();
  });
```

**The non-obvious mechanism.** A two-argument `.then`'s rejection handler does not end a chain. When it *returns* a
value the chain **resolves**, and the next link's **success** handler runs with that value. The retired shim's
`request.success(json)` and `reply(value)` both answered the request **and returned the response object** (base
commit `lib/util/routeParser.js:L477`, `L363-L368`). So on a rejected `loadAsync` the first rejection handler
answered the request with HTTP 200 and then handed a *response object* to `JSON.parse` on the next line —
`JSON.parse(String(responseObject))` — which throws a `SyntaxError` in a chain nobody was listening to.

Measured, per handler:

| Failure mode | `draft` (error terminal `request.success()`) | `autosave` (error terminal `reply(err)`) |
|---|---|---|
| `loadAsync` rejects | answers **200**, then dies on an unowned `SyntaxError` | answers a **scrubbed 500**, then dies on an unowned `SyntaxError` |
| `file("zipCode")` missing | answers **200**, no fault | answers a **scrubbed 500**, no fault |
| `JSON.parse` fails on real bad JSON | answers **nothing — hangs forever** — and dies on an unowned `SyntaxError` | answers **nothing — hangs forever** — and dies on an unowned `SyntaxError` |
| success | answers **200** `{ success : true }` | answers **200** `{ success : true }` |

The two death rows differ in which token the parser chokes on, which is a useful fingerprint when reading logs:
the returned-response row reports `"[object Object]" is not valid JSON` for `draft` and
`Unexpected token 'E', "Error: bad archive"` for `autosave`, because a Boom stringifies through `Error.toString`.
The bad-JSON row reports the offending payload itself.

**Why the obvious conversions are wrong.** Two shapes suggest themselves and each silently destroys behaviour:

- A single `try { await loadAsync; await async('string') } catch { return request.success(); }` collapses the first
  two rows into one outcome — it discards the process death of row 1 — and, because `JSON.parse` then sits in the
  handler's own body, converts row 3 from *hang plus fault* into a tidy scrubbed 500. Three changes in one edit.
- Simply `return`ing the chain makes every fault the handler's own, so rows 1 and 3 both become ordinary 500s and
  the process never dies.

**The reproduction, and it is verified row by row against the table above.** Two shapes reach that table. One keeps
the base chain verbatim inside a `new Promise(function (resolve) { … })` and gives each terminal a local helper that
reproduces the shim's responder contract — answer the request *and* return the response object onward, so the returned
value continues into `JSON.parse` exactly as it did. The delivered tree takes the other: it keeps the **wire** outcome
of every row and reaches it directly, which is greppable at the call site instead of depending on a closure.

`draft` awaits the two archive steps inside a `try` whose `catch` answers `h.respond()` — the bare success payload —
so rows 1 and 2 answer **200**; a `JSON.parse` failure is caught separately and answers `Pending.forever()`, so row 3
still answers **nothing**; row 4 is untouched. `autosave` keeps the two-argument `.then` chain, re-throws from the
first rejection handler and lets the resulting plain `Error` reach the second link's rejection handler, which returns
it — so `lib/http/errorMap.js` answers rows 1 and 2 as the **scrubbed 500** the base commit produced — while its own
`JSON.parse` sits in a `try` that answers `Pending.forever()` for row 3. Delivered outcomes, measured against the
table: `draft` = 200 / 200 / no response / 200, `autosave` = 500 / 500 / no response / 200. Every row matches.

What is deliberately **not** reproduced is the process death in rows 1 and 3, for the reason recorded in
[section 9](#9-the-no-response-and-process-fate-preservations-site-by-site) and under the rule stated in
[section 3.28](#328-a-failed-material-download-kills-the-process-and-that-channel-is-reproduced-rather-than-repaired):
the migrated chain no longer contains the unowned continuation that raised, so reproducing the fault would mean
manufacturing one. The two stringification fingerprints above remain useful for reading base-commit logs, and nothing
else depends on them.

**A note on `errors` versus `Boom` in this file.** Unlike `lib/controllers/course.js` (section 3.32), this module
*does* use its binding: `errors = require('@hapi/boom')` at `L16` with 11 `errors.` call sites, and zero references
to a bare `Boom`, identical to the base commit. Status codes named in this file are therefore real. The dead
`url = require('url')` binding at the old `L18` was removed as part of the dependency work: its only apparent
consumers were the property `asset.url`, an object key, and a `var url` inside `setServersideApi` that shadowed it.

### 3.34 An argument list that was never read, and a denial that never denied

`lib/controllers/users.js` is the largest controller in the codebase — 31 handlers — and it contributes four
distinct preserved defects that share one trait: in every case the *shape* of the code advertises an outcome the
code has never actually produced. Each was measured against the base commit rather than reasoned about.

**(a) A third argument that the language accepted and nobody ever called.** Base commit `sendEmailChange`
(`L708-L730`) stores the pending address and then, from inside the store callback, sends the confirmation email and
answers HTTP 200:

```javascript
Store.set(changeKey, JSON.stringify(changeVal), function(err) {
  send_email_confirmation(request, changeVal.new_email, changeVal.key);
  request.success({ success : true });
});
```

`lib/util/store.js` exports `set` as `async function (key, val)` — **arity 2**, at both `store.js:16` and
`store.js:203`, and identically at the base commit. Measured: `Store.set.length === 2`. JavaScript accepts the extra
argument silently and discards it, so **that entire callback body is dead code**. The confirmation email was never
sent, `request.success` was never called, and because the retired shim only ever answered from its deferred, the
request **hung open forever with no status code emitted**. Changing an email address has never worked on this
platform.

The reproduction keeps both halves: the call is still made — `Store.set` ran at the base commit too, and only its
resolution was unobservable — and the handler then returns `Pending.forever()`. The one deliberate difference is that
the returned promise is **owned**: `Store.set(...).catch(function (storeError) { return storeError; })` swallows a
rejection that the base commit left floating, because a floating rejection is a process-level event under Node 22's
default handling and this tree reproduces the HTTP fate rather than the termination
([section 9](#9-the-no-response-and-process-fate-preservations-site-by-site)). The wire outcome — no response, no
email — is identical. Restoring the never-invoked body would implement the author's
evident intent rather than the measured behaviour, which R-4 forbids. `send_email_confirmation` keeps a live caller
in `resendEmailChange`, so nothing became unreachable.

**(b) A store deletion whose failure belonged to nobody.** Base commit `activateAccount` (`L1156`) awaited
`Store.del(activateKey)` inside `request.yar._logIn(user, async function(err) { ... })` — an `async` callback the
session plugin invokes and then **discards**. A rejection therefore had no owner: it escaped as an unhandled
rejection, and because neither statement after it ran, nothing settled the deferred and the request hung as well.
Awaiting it in the converted handler would make the rejection the handler's own, so the outer `catch` would answer
the same `redirectTo : 'activate-account'` HTTP 200 every other error path produces — a status code no store failure
ever produced — and would silently keep the process alive too. The delivered reproduction keeps the failure inside
the branch instead: `try { await Store.del(activateKey); } catch
(delError) { return Pending.forever(); }`. A rejection therefore answers **nothing**, exactly as the discarded
callback did, without reaching the outer `catch` that would have answered 200 — and without the unhandled rejection,
per the rule in [section 3.28](#328-a-failed-material-download-kills-the-process-and-that-channel-is-reproduced-rather-than-repaired).
A single-argument `.then` with no rejection handler reaches the same wire outcome and was the other candidate.

**(c) Two handlers where every denial was a fatal fault, and seven where they are ordinary 500s.** This file binds
Boom as `errors` at `L2` and then makes **15 references to a bare, undeclared `Boom`** — identical to the base
commit. Section 3.32 established that such a reference raises `ReferenceError: Boom is not defined` before the
`.notFound` or `.forbidden` property is ever reached. What is specific to this file is that **the same defect has
two completely different outcomes depending on where it sits**, and the distinction is invisible on the line itself:

| Where the bare `Boom` sits | Sites | Observable outcome |
|---|---|---|
| Directly in the handler body (base `L213`, `377`, `545`, `562`, `579`, `667`, `680`) | 7 | The shim's catch-all saw the `ReferenceError` and answered a **scrubbed HTTP 500** |
| Inside an unowned `Export.findById` callback (`getExportStatus`, `downloadExport`) | 8 | **No response at all, and the process dies** |

The seven body sites therefore convert to an ordinary `throw`, which the framework maps to the identical scrubbed
500 — they are *not* defects to restore. The eight callback sites must keep answering **nothing**, and flattening them
into the `async` handler, which is the natural conversion, would have collapsed all eight into tidy 500s. The delivered
shape states that outcome at the site rather than depending on an unowned callback to produce it:

```javascript
try {
  throw Boom.notFound('Export not found');   // `Boom` is undeclared: this raises a ReferenceError
}
catch (noSuchBoom) {
  return Pending.forever();                  // ... which answered nothing at the base commit
}
```

The identifier is still not declared, so the `ReferenceError` is still what happens; only its escape route is local
rather than process-wide.

`getExportStatus` is the sharpest case because its fault is **doubled**. The base commit wraps the callback body in
its own `try`, so the first `ReferenceError` is caught — and then the `catch` block itself references `Boom`:

```javascript
} catch (innerErr) {
  console.log('getExportStatus inner error:', innerErr.stack || innerErr);
  return reply(Boom.internal('Export status error'));   // <-- ReferenceError number two
}
```

A throw from a `catch` block is not caught by its own `try`, so the second `ReferenceError` escapes the Mongoose
callback entirely. Measured: the inner log line appears, the outer `catch` never runs, exactly one unowned
`ReferenceError` reaches the process, and the request is never answered. Both `try` blocks are preserved unmerged
and `Boom` is deliberately still not declared.

**(d) A download route whose success path also fails, for an unrelated reason.** `downloadExport`'s happy path is
genuinely a redirect — the base commit's `reply().redirect(url)` resolved the deferred with a real toolkit redirect —
so unlike the four denials it must keep answering **302**. It does. But under the *shipped* configuration it never
gets that far: `config/default.yaml`'s `aws.buckets` block declares `userassets`, `snapshots`, `cdn`, `materials`,
`useravatars`, `appassets` and `vendorassets` and has **no `exports` entry**, so `config.aws.buckets.exports.name`
raises `TypeError: Cannot read properties of undefined (reading 'name')` inside the very same unowned callback. The
base commit used the byte-identical expression, so the deployed success path has always died too, and
`lib/workers/exports.js` carries the same expression unchanged. `config/default.yaml` is frozen by the plan and
supplying the key would convert a dying request into a working redirect, so the defect is catalogued here instead.
Both configurations were measured: without the bucket the request hangs and the process dies; with it injected the
route answers a genuine 302 carrying the byte-identical `Key` and the original one-hour signature lifetime.
Re-verified against the delivered configuration while integrating this entry: `config.aws.buckets` resolves to exactly
`userassets, snapshots, cdn, materials, useravatars, appassets, vendorassets`, and `config.aws.buckets.exports` is
`undefined`. The delivered handler keeps the hang and drops the termination — the presign call sits in a `try` whose
`catch` answers `Pending.hang()` — so the redirect still cannot be reached under the shipped configuration, and the
route's own success contract (302, one-hour lifetime) is unchanged for a deployment that supplies the bucket.

**(e) An error argument that was ignored, across a library that no longer lets you ignore it.** The three
`crypto.randomBytes(48, callback)` sites named an error parameter `ex` and **never inspected it**, so a failure left
the buffer `undefined` and the next line raised a `TypeError`. The promisified form the plan mandates *rejects*
instead, which is error handling the code never had, so the shape of the conversion had to be adjudicated. One
candidate neutralized the rejection back to `undefined` at every call site:

```javascript
var buf = await randomBytesAsync(48).catch(ignoreRandomBytesError);   // candidate, NOT the delivered form
```

The delivered sites take the shorter route instead, at `lib/controllers/users.js:L388`, `L1057` and `L1184`, with
neither helper defined anywhere in the tree:

```javascript
var buf = await util.promisify(require('crypto').randomBytes)(48);    // delivered
```

The two shapes were compared rather than assumed equivalent:
neutralizing the rejection makes `buf` `undefined` so the **next** line raises a `TypeError` inside the `async`
handler, while awaiting the rejection surfaces the rejection itself; both are the handler's own fault, so
`lib/http/errorMap.js` answers the identical scrubbed **500**, and a 500 is what the base commit's `uncaughtException`
never produced on this path either way. `crypto.randomBytes` failing is not a reachable condition in any case. The
48-byte length and the hex slices are frozen because the derived values are persisted and emailed: the password-reset
and email-change keys slice **8** characters while the email-verification key slices **16**, and that asymmetry is
base-commit behaviour. Changing any of them would invalidate every in-flight token.

### 3.35 The markdown sanitizer is bridged onto `marked` 4, not handed to its deprecated options

**The ambiguity.** The plan records that `marked@4.3.0` "supports a `sanitizer` function option", which makes
`marked.setOptions({ sanitize : true, sanitizer : fn })` look like the drop-in replacement for the git fork's
`sanitize`-as-a-function deviation. Two independent reviews of this file disagreed about whether that is
behavior-preserving, and each rewrote the integration in its own shape. Prose could not settle it: both shapes are
defensible from the release notes.

**What baseline decided — measured against the fork itself, not against its documentation.** The fork named at
`2f8712a:package.json:L38`, `git+https://github.com/trinketapp/marked.git`, was installed in isolation. It resolves to
version **0.3.2** and `require('marked')` on it returns a **callable**, so it can be driven as an oracle. A
**119-fixture** corpus — raw block HTML, per-tag nesting, whitelisted and non-whitelisted tags, `javascript:`,
`vbscript:` and `data:` hrefs and image sources, trinket embed URLs in both absolute and protocol-relative form, task
lists in three shapes, fenced and indented code, and GFM tables — was rendered through three variants: the fork, the
deprecated-option candidate, and the shipped `marked.use(...)` bridge.

**A measurement trap that had to be removed before the numbers meant anything.** `setOptions` and `use` mutate the
**same** `marked` module object, so two variants rendered in one process silently configure each other. An early
in-process run reported a 12-versus-12 tie, which was an artifact of exactly that pollution. Each variant is therefore
rendered in its **own child process** against the same corpus. This is a general rule for any differential over a
mutable singleton, and it is the reason the two numbers below diverge so far from the tie.

**The result.** Against the fork as oracle: the deprecated-option candidate diverges on **57** of 119 fixtures; the
shipped bridge diverges on **10**. The bridge's divergence set is a strict **subset** of the candidate's — it is never
worse on any fixture — and the 47 fixtures it fixes are all client-visible markup:

| Class | Fixtures | What the candidate did | What the fork and the bridge do |
|---|---|---|---|
| Raw block HTML wrapped in a paragraph | 15, 19–21, 30, 58–60, 66–72, 108, 109, 115–118 | `<p>&lt;div&gt;…&lt;/div&gt;\n\n</p>` | the escaped block, no `<p>` wrapper |
| Whitelisted tags escaped away | 33 `<table>`, 34 `<p style>`, 35 `<h1 id>`, 93 `<pre>`, 111 `<h2>`, 112 `<p>` | fully escaped | passed through, attributes stripped |
| Per-tag sanitization inside a rejected block | 22, 79–83, 107 | the whole block escaped, inner tags lost | outer tag escaped, inner `<span>`/`<p>`/`<b>` kept |
| Trailing-newline placement on an image or comment | 30, 86, 87 | `<p><img>\n\n</p>` | `<p><img></p>` |
| Trinket embed iframes | 88, 89 | escaped, and the embed rewrite then injected a **real** `<iframe class="embedded-trinket">` inside the escaped text | the raw `<iframe>` passed through untouched |
| Inline and unbalanced tags | 14, 74 | `<p>&lt;/b&gt;</p>` | `<p></b></p>` |
| Task lists | 36, 37, 96 | `<li><input disabled="" type="checkbox">` | `<li class="list-item"><input type="checkbox" class="list-item-checkbox" />` |
| `data:` link hrefs | 8 | the anchor dropped, only its text emitted | the anchor emitted verbatim |

Fixture 88 is the sharpest of them, because the candidate does not merely lose markup — it **manufactures**
it. The raw
`<iframe src="https://trinket.io/embed/python/abc123" width="100%">` is escaped, and the embed rewrite then fires on
the URL *inside the escaped text*, splicing a live `<iframe class="embedded-trinket" height="400">` into the middle of
`&lt;iframe src=&quot;…`. Fixture 22 is the defect the bridge exists to fix: the fork escapes the outer `<div>` while
letting the nested `<span>` through, because the sanitizer is called **per tag** rather than per block.

**The 10 residual differences are properties of the version bump, and they occur in both candidates.** Fixtures 4, 5,
6, 7, 12 and 99 are marked 4's inline-link paren balancing — the fork's regex captured `javascript:alert(1` and left a
stray `)` in the output; 41, 43 and 45 are renderer whitespace joins on fenced code, indented code and a GFM table
body; 97 is the uppercase `- [X]` marker, which the fork emitted literally and marked 4 parses. None of them is
reachable by a sanitizer, and neither candidate is closer.

**The candidate also fails the zero-warning gate.** With `sanitize`/`sanitizer` in `setOptions`, marked 4 emits
`marked(): sanitize and sanitizer parameters are deprecated since version 0.7.0…` through `console.warn` on **every
render**. The shipped bridge names neither option, and measured over a 500-render loop emits **zero**.

**What is delivered.** `lib/shared/trinket-markdown.js` keeps the fork's sanitizer body as a named function,
`sanitizeHtmlTag` at `L217-L260` — a de-indented transcription of `2f8712a:lib/shared/trinket-markdown.js:L211-L240`,
including the `TAGS` stack's pop/push statefulness, the iframe `/src\s*=/` gate inside its swallow-all `try`/`catch`,
and the unused `src` local. `marked.setOptions` is absent. In its place a single `marked.use({...})` call at `L300`,
documented at `L270-L281`, installs four things: a `tokenizer.html` override plus a `trinketHtmlBlock` renderer that
reproduce the fork's own block-HTML rule; the sanitizer as `marked.Renderer.prototype.html` at `L603`, a fifth
monkey-patch beside the four frozen ones whose arities the plan verified unchanged; and a `walkTokens` hook at
`L341-L358` that deletes marked 4's new `task`/`checked` token fields and unshifts a literal `[x] ` / `[ ] ` text
token, so the frozen arity-1 `listitem` patch still sees the input it always saw.

**The link guard is reproduced, not tightened.** `forkRejectsLinkHref` at `L551`, called once at `L587`, reproduces the
fork's expression `decodeURIComponent(unescapeEntities(href)).replace(/[^\w:]/g, '').toLowerCase()` and returns `''`
on throw or on `javascript:`. Three properties are preserved deliberately: it rejects **`javascript:` only**, so
`vbscript:` and `data:` hrefs are still emitted (fixture 8); it returns the **empty string** rather than escaped text;
and it has **no counterpart on the image renderer**. An earlier draft of this changeset proposed blocking `vbscript:`
and `data:` too — that is a security improvement, which R-4 forbids. The non-obvious detail is inside the guard: the
`unescape` the fork called is not JavaScript's percent-decoder but marked's module-private HTML-**entity** decoder, so
it is reimplemented as `unescapeEntities` at `L538`. Without that, the guard's verdicts differ. The mitigating facts
are recorded at the call site: an `img src` has never executed script, `vbscript:` was removed from Internet Explorer,
and top-level `data:` navigation is blocked by current browsers.

**An unchanged pre-existing defect this measurement exposed.** `lib/shared/trinket-markdown.js:L60` reads
`python_types` as an **undeclared global** — only the browser copy, `public/js/trinket-markdown.js:L11`, declares
`var python_types = []`. Any trinket embed URL carrying a language segment therefore raises
`ReferenceError: python_types is not defined` on the server, which `lib/http/errorMap.js` answers as a scrubbed 500.
The base commit uses the byte-identical expression and all three variants raise it identically, so it is neither
introduced nor repaired here; the corpus supplies `global.python_types = []` so that the embed fixtures render at all.
`lib/controllers/courses.js:L9` is the module's only server-side consumer.

**What a naive fix would have broken.** Handing the sanitizer to `setOptions` keeps a deprecation warning on every
render and silently changes 47 client-visible outputs; dropping the sanitizer removes the platform's XSS defense for
learner and author markdown; tightening the URL guard changes rendered output for hrefs the base commit passed
through; and declaring `python_types` would convert a scrubbed 500 into a rendered embed.

### 3.36 The password comparison stays callback-compatible even though bcrypt no longer needs it

**The ambiguity.** `bcrypt@6.0.0` is promise-native, and the async conversion mandate says to prefer the promise form.
`lib/models/user.js#comparePassword` could therefore have become a plain `return bcrypt.compare(...)`. The existing
model spec, however, drives it as `comparePassword.call(user, 'foo', function (err, isMatch) { … })` —
`test/lib/models/user.js:L59` and `L69` — and the testing directive forbids weakening or rewriting existing
assertions.

**What baseline decided.** The bridge stays. `comparePassword` at `lib/models/user.js:L108-L118` returns the promise
when no callback is supplied and, when one is, forwards to it and returns `undefined` — which is exactly what
`bcrypt.compare` itself returned once a callback was passed. The two application call sites,
`lib/controllers/users.js:L211` and `L949`, both use the promise form.

**Two bcrypt semantics were measured rather than assumed, because they decide the argument the bridge passes.** On
both the base commit's `bcrypt@5.1.1` and the installed `6.0.0`, the callback form's success argument is `undefined`:
`err === undefined` is true and `err === null` is false, on a match and on a mismatch alike. The bridge therefore calls
`cb(undefined, isMatch)`. The spec asserts `should.not.exist(err)`, which both values satisfy, so this is a fidelity
choice and not a test-passing one — and it is the difference between reproducing bcrypt's callback contract and
inventing a new one. Also measured, because it bounds what any test of this method can reach:
`bcrypt.compare(pw, 'not-a-hash')` **resolves `false`** rather than rejecting, so a user row with a malformed hash
cannot exercise the login error path; only an illegal argument rejects, and
`bcrypt.compare(undefined, hash)` throws `data and hash arguments required`. A **non-string** candidate password is
therefore the only way to reach the rejection branch.

**Why it is preserved.** The three-argument callback form still works on 6.0.0 — measured — so this bridge is not
compensating for a removed API. It exists so that the promise-native conversion the plan asks for can happen without
touching a single assertion.

**What a naive fix would have broken.** Dropping the bridge breaks the existing spec; "fixing" the spec to await the
promise is the weakening of existing assertions the directive forbids; and passing `null` instead of `undefined` would
have made the method's callback contract differ from the one bcrypt has always had.

### 3.37 The retired HTTP client's request and response quirks are reproduced, not modernized

**The ambiguity.** `lib/controllers/auth.js` posted the Google token exchange through `request@2.88.2` with
`{ form : fields, json : true }`. `fetch` is the mandated replacement, and the obvious spellings are
`body : new URLSearchParams(fields)` and `await response.json()`. Both change observable behavior.

**What baseline decided — the request half.** `request`'s `form` option serialized through `qs`, which **omits** a
field whose value is `undefined` and percent-encodes a space as `%20`. `new URLSearchParams({ client_secret :
undefined })` serializes the literal string `"undefined"` and encodes a space as `+`, and setting a `URLSearchParams`
body also makes `fetch` send `application/x-www-form-urlencoded;charset=UTF-8` rather than the bare media type. Under
**partial** configuration — `config.app.auth.google.clientID` set while `clientSecret` and `callbackURL` are
not, which
is the shipped state — the difference is not cosmetic: Google would receive two junk field values instead of two
omitted fields. `encodeForm` at `lib/controllers/auth.js:L26-L32` reproduces the `qs` behavior in four lines and was
measured byte-identical for this file's field maps under both full and partial configuration.

**What baseline decided — the response half.** `json : true` parsed the body when it could and handed the callback the
**raw text** when it could not, never raising. `response.json()` throws a `SyntaxError`, which would replace this
file's two normalized provider errors with an unrelated one. `readJsonBody` at `L40-L52` reproduces the parse-or-return-
text contract and was verified against `request@2.88.2` for every body shape this endpoint can return: a JSON object, a
malformed fragment, an empty body, and the JSON scalars `null`, `123`, `"str"`, `false` and `[]`.

**The measured narrowness of the two non-settling guards.** A zero-length body came back from `request` as
`undefined`, not as the empty string, so `readJsonBody` returns `undefined` for it. That matters because exactly
**two** provider responses made the base commit's `body.access_token` read raise a `TypeError`: the empty body and a
literal `null` payload. The `TypeError` was raised inside the client's callback, after the enclosing `new Promise`
executor had already returned, so neither `resolve` nor `reject` ran and **no response was ever sent**. Those two
shapes are therefore answered with `Pending.forever()` at `L152` and, for the profile read's mirror image, at `L176`.
Every other malformed shape — including an HTTP 400 carrying `{"error":"invalid_grant"}`, which was measured to yield
`err === null` and a parsed payload — still reaches the normalized `Failed to get access token` /
`Failed to get user profile` errors verbatim.

**Why there is deliberately no `response.ok` check.** The callback-era client did not raise on a non-2xx status and
neither does `fetch`, so a Google error payload falls through to the falsy-`access_token` test exactly as it always
did. Adding an `ok` check would divert that case away from the normalized error path it currently takes; removing the
two guards would convert two silent hangs into scrubbed 500s. Both are behavior changes.

**Why it is preserved.** R-4 and R-6. The two hangs are counted in
[section 9](#9-the-no-response-and-process-fate-preservations-site-by-site) with the rest of the no-response
population, and they are the only two contributed by a controller outside the six that carried them before.

### 3.38 The response corpus has two readings, and the documented one was never wrong

**The ambiguity.** The Technical Specification tallies the 58-route unauthenticated corpus as **25×200, 7×401, 25×404
and 1×500**. An earlier revision of `test/baseline/responses.json` measured **12×200, 16×302, 7×401, 22×404 and
1×500** and, finding no way to reconcile the two, recorded the documented figure as superseded. One review accepted
that; another filed it as a documentation defect. Both cannot be right, and the difference is 16 routes.

**What baseline decided.** The documented figure is **exact**, and the disagreement was never about behavior — it was
about one unrecorded capture choice. The earlier revision did not follow redirects, so it recorded the **first hop**.
Following each 3xx back onto the same application and recording the **terminal** status reproduces the documented tally
digit for digit:

- **16** of the 58 routes answer 3xx on the first hop — `/account`, `/account-deleted`, `/admin`,
  `/auth/google/callback`, `/change-email`, `/courses/new`, `/home`, `/logout`, `/python/`, `/r`, `/reset-pass`,
  `/skulpt`, `/verify-email`, `/vpython`, `/webvpython`, `/welcome`.
- **13** of them resolve to **200** and **3** resolve to **404**. The three are the language aliases `/r → /R`,
  `/vpython → /glowscript` and `/webvpython → /glowscript`, whose targets are themselves feature-flag 404s.
- Therefore 12 + 13 = **25×200** and 22 + 3 = **25×404**, with 7×401 and 1×500 unchanged. Nothing was
  adjusted to make
  the arithmetic work.

**Both readings are kept, because each pins something the other cannot.** The resolved reading is the documented gate
and lives at `gates.documentedDistribution`, `gates.measuredDistribution` and `gates.resolvedStatusDistribution`. The
first-hop reading is retained verbatim at `gates.firstHopStatusDistribution`, because the 16×302 class is what carries
the absolute-versus-relative `Location` evidence in `locationContract` and the `takeover` mechanics in
`gates.takeoverRedirectsToLogin` — and because `test/helpers/flow.js` and `test/lib/api/login.js` assert the immediate
response, not the resolved one. Every recorded `status`, `location`, `headers` and `bodyShape` is still the first hop;
the resolution is **additive**, recorded per entry as `redirectChain` and `resolved`.

**The follow rule is bounded so the capture cannot leave the process under test.** A hop is followed only when its
`Location` is relative, or absolute with an origin equal to `config.url` (`https://trinket.dev`) or to the probe
origin; any other origin is recorded and never requested. Off-site targets encountered: **0** — which is a measured
result rather than a design assumption, because `lib/util/routeParser.js:L713-L717` absolutizes to `config.url`, and
that names this application. A URL already visited in the same chain is recorded but not re-requested, the cap is 10
hops, and every followed hop is a `GET` per RFC 9110 302 handling. The observed histogram is
`{ 0 : 42, 1 : 14, 2 : 2 }`; the two two-hop routes are `/change-email` and `/verify-email`, both resolving
`→ /account/email → /login → 200`.

**The authenticated 500 quirk survives the policy, which is the point of asserting it.** Authenticated `GET /login`
and `GET /signup` are **terminal** 500s with `hops : 0`, so following redirects cannot mask them
(`gates.authenticatedLoginSignup500SurvivesRedirectPolicy`). A migrated build that answers 302 there has converted
`lib/controllers/pages.js` wrongly — see
[section 1.1](#11-authenticated-get-login-and-get-signup-return-http-500).

**One corpus value the policy legitimately changes, and why recording it is a preservation.** `request.yar` flash
storage is **single-read**. Under the follow policy, the `POST /login` chain's own followed hop renders `/home` with
the post-login flash and measures **18126** bytes; the later direct `GET /home` entry therefore renders **18055**
bytes without it — a 71-byte delta, reproduced identically across independent runs. The earlier revision recorded
18126 for that entry because nothing had consumed the flash first. Recording the single-pass value pins the
"rendered exactly once" property that neither reading pins alone, and it is the **only** value in the corpus the
policy moves: first-hop drift from the previous revision is **0**.

**What a naive fix would have broken.** Leaving the documented figure marked as superseded is a documentation defect
against a figure that is reproducible. Replacing the first-hop reading with the resolved one would delete the
`Location` contract the existing suite asserts. And "correcting" the `/home` entry back to 18126 would assert a body
that no single capture pass can produce.


## 4. The security-condition catalogue

A security-oriented review of this changeset identified **twelve security-relevant conditions** in the processed
production surface, referred to below by the review's own identifiers **SEC-1 … SEC-12**. Sections 1-3 named none of
them, and an earlier revision of this document nevertheless claimed complete discharge of R-4. This section is that
missing half.

**Every one of the twelve was checked against the base commit before any disposition was chosen**, because R-4 turns
on exactly that question: a condition the migration *introduced* is a regression and must be fixed, while a condition
the 2013-era code already had is a quirk and must be preserved unless remediating it changes nothing observable. The
split came out as follows.

| # | Condition | CWE | Origin | Reachable in the shipped config | Disposition |
|---|---|---|---|---|---|
| SEC-1 | Cache-prefix `{assetType}` path traversal → arbitrary file read | CWE-22 | baseline | **yes** | **REMEDIATED** |
| SEC-2a | The whole remote body buffered in resident memory | CWE-400 | **migration regression** | no — `features.assets:false` | **REMEDIATED** |
| SEC-2b | SSRF in `assetUploadFromURL` — any scheme, no address filter, follows redirects | CWE-918 | baseline | no — `features.assets:false` | PRESERVED |
| SEC-3 | Google OAuth without a `state` parameter | CWE-352 | baseline | no — credentials empty | PRESERVED |
| SEC-4 | Open redirect via `next`, plus cross-request `fail.redirect` poisoning | CWE-601, CWE-362 | baseline | **yes** | **REMEDIATED** |
| SEC-5 | 32-bit password-reset and email-change keys | CWE-330 | baseline | yes | PRESERVED |
| SEC-6 | The JWT key is the string `"undefined"` plus a public short code | CWE-321 | baseline | yes | PRESERVED |
| SEC-7 | Unsanitized archive entry names in generated downloads | CWE-22 | baseline | yes | PRESERVED |
| SEC-8 | Predictable `/tmp` archive names, TOCTOU, no cleanup | CWE-377 | baseline | yes | PRESERVED |
| SEC-9 | Unauthenticated `POST /api/ohnoes` mail amplification | CWE-770 | baseline | yes | PRESERVED |
| SEC-10 | Renderer attribute concatenation bypasses the sanitizer | CWE-79 | baseline | yes | PRESERVED |
| SEC-11 | `Math.random()` six-character course access codes (~34.7 bits) | CWE-330 | baseline | yes — **anonymously** | PRESERVED |
| SEC-12 | No JSZip decompression limits | CWE-409 | baseline | yes | PRESERVED |

SEC-2 is the only finding that splits, because it contains one baseline condition and one migration regression, so
the twelve findings resolve into the thirteen conditions tabulated above. **Twelve of those thirteen are baseline
behavior; exactly one — SEC-2a — was introduced by this migration.** That is the most consequential line in this
section, because it is what decides which of them R-4 protects and which it condemns.

### 4.0 The disposition rule this section applies

Three buckets, applied uniformly:

- **A — introduced by the migration.** Fix it. R-4 protects the base commit's behavior, not a defect the conversion
  invented, and the parity mandate makes restoring the base commit's shape mandatory rather than optional. One
  member: **SEC-2a**.
- **B — baseline, but the remediation is observably neutral for every legitimate request, and the severity is
  CRITICAL or HIGH.** Fix it, and document the deviation together with the measurement that proves the neutrality.
  R-4 forbids behavior *changes*; where a remediation provably changes no legitimate response it is not a behavior
  change. Two members: **SEC-1**, **SEC-4**.
- **C — baseline, and remediating it would breach a frozen contract.** Preserve it and catalogue it here with its
  mechanism, its reachability and the specific rule that freezes it. Ten members: **SEC-2b**, **SEC-3**, and
  **SEC-5** through **SEC-12**.

"Frozen contract" is not a euphemism. Each bucket-C entry names the concrete contract it would breach: the 233-row
route table including per-row auth (TR1 and G8), a persisted or emailed token format (TR6), client-visible rendered
markup, the "input accepted/rejected at baseline is accepted/rejected identically after" validation guarantee, the
login-flow outcomes, or the prohibition on new features.

**On accepting residual risk.** Measured unreachability is a legitimate acceptance basis, and two of the ten
bucket-C entries rest on it: `features.assets` is `false` at `config/default.yaml:L3`, and
`app.auth.google.clientSecret`, `clientID` and `callbackURL` at `config/default.yaml:L325-L328` are all empty. Both
were verified **by request, not by reading the file** — the asset handler answers `501 Asset uploads are not enabled`
before it ever calls `fetch`, and both OAuth handlers short-circuit into `request.fail()` before building a URL.
**Reachability is a property of the shipped default configuration, not of the code.** An operator who enables either
feature takes on the corresponding risk, and each entry below says so explicitly, so that the decision is theirs and
informed rather than silent.

### 4.1 SEC-1 — cache-prefix path traversal (CRITICAL) — REMEDIATED

**What it was.** The cache-busting asset route — `lib/util/routeParser.js:L649-L701` at the base commit, now
`lib/http/staticRoutes.js:L88-L142` — resolves its Inert directory root through a **function-form** `directory.path`
that concatenated a request parameter straight onto the public root: `'./public/' + request.params.assetType`. Because
`{assetType}` is a single path segment, hapi percent-decodes it *before* the path function sees it, and Inert then
confines the `{path*}` tail to whatever root the function returned — so moving the **root** escaped confinement
entirely.

**Evidence, measured over real HTTP against the unremediated code.**
`GET /cache-prefix-1/..%2F..%2F..%2F..%2F..%2F..%2Fetc/passwd` returned **200** with the contents of `/etc/passwd`.
`GET /cache-prefix-1/..%2fconfig/local.yaml` returned **200** with `config/local.yaml`, which carries the Yar
session-cookie password — that is, the traversal yielded the key used to seal every session cookie. The `%2e%2e%2f`
and upper-case forms behaved identically. For contrast, traversal in the `{path*}` **tail** was already blocked by
Inert's own confinement, which is precisely why the vulnerability sat in the root-resolution function and nowhere
else.

**Origin.** Baseline. `lib/http/staticRoutes.js` is a verbatim relocation of the base commit's `addStaticRoutes`, and
the vulnerable expression is unchanged in that relocation — confirmed by diffing against
`git show 2f8712a:lib/util/routeParser.js`.

**Why it was remediated rather than preserved (bucket B).** It is the only CRITICAL condition in the set, it is
reachable in the shipped default configuration, and it discloses the session-sealing key. The remediation is
observably neutral — which is the part that had to be *proved* rather than assumed.

**The remediation.** A module-level `SAFE_ASSET_TYPE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/`, anchored at both ends, plus a
type check and an explicit `'..'` rejection. A value that fails returns `Boom.notFound()` **from inside the path
function**, which is the mechanism Inert itself sanctions: `node_modules/@hapi/inert/lib/directory.js`'s
`internals.resolvePathOption` begins `if (result instanceof Error) { throw result; }`, so a returned Boom becomes that
Boom's response. Nothing else in the file changed — the five `routes.push` call sites, the eight-prefix loop that
emits **zero** rows because all eight `app.prefixes` entries at `config/default.yaml:L142-L150` are key-only and
therefore parse as null (a preserved condition catalogued only here and in the inline comment at
`lib/http/staticRoutes.js:L144-L159`; populating that frozen config would push the table from 233 rows to 241), the
single `index: true`, the single `code(404)`, the frozen registration order and the absence of `'use strict'` are
all as they were.

**What the remediation deliberately did not change, with the measurement.** Every legitimate asset URL is
byte-identical before and after: `/cache-prefix-1/js/trinket-roles.js` 200 / 3,020 B; `/cache-prefix-1/css/base.css`
200 / **265,727 B**, exactly the artifact size this appendix records; `/cache-prefix-1/img/trinket-logo.png`
200 / 14,148 B; `/cache-prefix-1/components/foundation/package.json` 200 / 1,655 B; the nested
`/cache-prefix-1/components/marked/lib/marked.js` 200 / 28,331 B; `/robots.txt` 200 / 24 B via the catch-all;
`/about` 200 / 13,537 B; `/help` 200 / 13,964 B; and `/.well-known/anything` 404 with an **empty** body, that quirk
intact. Crucially the rejection reuses a mapping the route **already had**: `/cache-prefix-1/nonexistentdir/x.js`
answered 404 with the standard 1,545-byte `404.html` before the fix and answers exactly that after it, so a rejected
`{assetType}` is indistinguishable from an asset directory that does not exist. All ten traversal variants now answer
that same 404 with zero file bytes. The route table was re-captured afterwards and still hashes to `452116ce…` with
all ten gates unchanged.

**What a naive fix would have broken.** Replacing the function-form path with a static string, or adding an
`@hapi/inert` require to reach a different confinement API, would have changed the route's declared shape and this
module's dependency contract. Rejecting with a bare `throw` of a plain `Error` rather than a returned Boom would have
produced a **500** where the route previously produced a 404, changing the response corpus.

### 4.2 SEC-2 — `assetUploadFromURL`: unbounded buffering (HIGH, REMEDIATED) and SSRF (HIGH, PRESERVED)

This finding covers two distinct conditions in one handler with **opposite dispositions**, which is exactly why the
base-commit check had to be run per condition rather than per finding.

#### 4.2a Unbounded heap buffering — a migration regression — REMEDIATED

**What it was.** The converted handler read the entire remote response into resident memory with
`Buffer.from(await response.arrayBuffer())` and then wrote it out with `fs.promises.writeFile`. The route,
`POST /api/users/assetFromURL` at `config/api_routes.js:L1298-L1307`, validates only `url : Joi.string().required()`
and declares no size ceiling anywhere, so a single request allocated as much memory as the remote host chose to send.

**Origin — this one is the migration's own.** The base commit at `lib/controllers/users.js:L594-L616` streamed the
body straight to disk:
`_request.get(url).on('error', …).on('response', …).on('end', …).pipe(fs.createWriteStream(tmpPath))`.
It was never materialized in memory. The `request`-to-`fetch` dependency swap replaced a streaming pipeline with a
buffering one, so this is a **regression introduced by the conversion**, and R-4 requires restoring the base
commit's shape rather than keeping the new one.

**The remediation.** `await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(tmpPath))` from
`node:stream/promises`, with an explicit arm for `response.body === null`, because `fetch` reports a bodyless
response that way and `Readable.fromWeb` rejects `null`, while the base commit's `.pipe()` still created a zero-byte
file. The `try`/`catch`, the `console.log('on error:', err)` line and the rethrow are untouched.

**What it deliberately did not change, with the measurement.** Peak RSS, sampled from `/proc/<pid>/status` every
50 ms across the request, fell from **+1,986 MB to +24 MB for an 800 MiB remote body**, and the post-fix figure stays
flat as the body grows — +11 MB at 100 MiB, +23 MB at 400 MiB, +24 MB at 800 MiB — instead of tracking it. Note that
`--max-old-space-size` does not bound the buffered form at all, because `ArrayBuffer` memory is external to the V8
old space; that is why this had to be shown as an RSS profile rather than as an OOM crash. Everything observable is
unchanged: the file written for a 23-byte body is sha256-identical
(`69e9723b4329ea54ece8b9b0f09f15b28bcdd46d7a8e890699c655a1d1810d71`) across the buffered form, the streaming form
**and the base commit's own `.pipe()`**; a 400 MiB body yields 419,430,400 bytes with an identical sha256 on both
sides; a bodyless 204 leaves a 0-byte file on both; and an aborted transfer answers the same 500 with exactly one
`on error:` log line on both. The captured content type, the `path.basename(pathname + search)` filename and the
HTTP-200 upload-failure shape are all as they were.

**One residual difference, deliberately not repaired.** On an aborted transfer the streaming form leaves the bytes it
already received in the temp file, where the buffered form had written nothing yet. It is invisible on the wire, it
is the base commit's own shape, and **no `unlink` was added** — this codebase deliberately never cleans up its temp
files (see section 4.8 below, SEC-8), so adding cleanup on one path only would itself be an unsanctioned behavior
change.

#### 4.2b SSRF — baseline — PRESERVED

**What it is.** The *entire* validation is `URL.parse(request.payload.url)` followed by a single guard —
`if (!requestUrl || !requestUrl.protocol) return request.fail()`. Any input with a protocol passes,
`javascript:alert(1)` included; there is no allow-list and no private-address or link-local filter, and `fetch`
follows redirects, so a caller can steer the request at loopback, RFC1918 space or a cloud metadata endpoint.

**Origin.** Baseline, and the protocol-only check is verbatim: the base commit did `url.parse(...)` then
`if (!requestUrl.protocol) return request.fail()`. The migration added only the `!requestUrl` arm, and it added it
**because** `URL.parse` returns `null` where the legacy parser returned an object with a falsy `protocol` — that is,
to keep the accept/reject verdicts identical. Section 3.13's closing paragraph records the same site,
`lib/controllers/users.js:L588`, as "the deliberate validation quirk where the absence of a protocol drives the
rejection". A differential run over `http://x.com`, `https://x.com`, `//x.com`, `/relative`, `x.com`, the empty
string, `undefined` and `javascript:alert(1)` reproduced every base-commit verdict.

**Reachability: none in the shipped configuration.** `features.assets` is `false`, so the handler returns
`501 Asset uploads are not enabled` before reaching the parser. The route additionally declares `auth: 'session'`, so
even with the feature enabled a caller needs a logged-in session.

**Why it is preserved.** Adding an allow-list or an address filter would reject inputs the base commit accepted,
which is a validation-outcome change and therefore breaches the preservation of "validation outcomes (input
accepted/rejected at baseline is accepted/rejected identically after)". **An operator who enables
`features.assets` should place this endpoint behind egress controls.**

### 4.3 SEC-3 — Google OAuth without a `state` parameter (HIGH) — PRESERVED

**What it is.** `lib/controllers/auth.js#google` builds the authorization URL from `client_id`, `redirect_uri`,
`response_type`, `scope` and `access_type` and **no `state`**, so `googleCallback` cannot bind the callback to the
session that started the flow — the classic login-CSRF shape. The measured Location is
`https://accounts.google.com/o/oauth2/v2/auth` carrying `client_id`, `redirect_uri`, `response_type=code`,
`scope=profile+email` and `access_type=online`, with **no `state` term**.

**Origin.** Baseline. The flow is hand-rolled rather than delegated to Passport — which is also why deleting
`lib/auth/passport.js` was route-surface neutral, section 3.6 — and the base commit carried no `state` either.

**Reachability: none in the shipped configuration.** `app.auth.google.clientID`, `clientSecret` and `callbackURL` are
all empty at `config/default.yaml:L325-L328`, and both handlers short-circuit into `request.fail()` before
constructing anything. Verified by request against a server booted from the shipped defaults.

**Why it is preserved.** Adding `state` means minting a value, persisting it in the session, and **rejecting
callbacks that do not carry it** — which changes login-flow outcomes, and those are frozen. It is also new
functionality rather than a migration concern. The one adjacent thing that *was* fixed is the redirect destination
this flow feeds; see section 4.4, SEC-4.
**An operator who configures Google sign-in should be aware that the flow has no CSRF binding.**

### 4.4 SEC-4 — open redirect and cross-request redirect poisoning (HIGH) — REMEDIATED

**What it was — two mechanisms, the second worse than the first.** `request.yar.get('next')` was handed to
`h.redirect()` verbatim, so `GET /login?next=https://evil.example/pwn` followed by a successful `POST /login`
emitted `Location: https://evil.example/pwn`. Separately, the failure responder interpolated the route's
`fail.redirect` template and **wrote the result back into the shared route declaration** —
`fail.redirect = StringUtils.interpolate(fail.redirect, json)` — and that declaration object is closed over once at
parse time. `POST /users` declares `fail : { redirect : '/{formName}' }` at `config/routes.js:L75-L77` with
`formName : Joi.string().required()` at `L82` an unconstrained payload field, so one failed signup rewrote the
template permanently.

**Evidence, measured over real HTTP.** Pre-remediation the login flow emitted `https://evil.example/pwn`,
`//evil.example/pwn` and `/\evil.example` for the absolute, scheme-relative and backslash forms. For the poisoning: a
single `POST /users` with `formName=//evil.example` produced `Location: http:///evil.example`, and **three
subsequent requests from completely fresh sessions carrying a legitimate `formName=signup` received that same
attacker-supplied destination** — the `{formName}` placeholder was gone from the declaration, so it stayed poisoned
until restart. One request by one visitor redirected every later visitor off-site.

**Origin.** Baseline. The write-back is verbatim from the base commit's failure responder, and the raw
`h.redirect(next)` is the base commit's raw-toolkit redirect.

**The remediation.** Two helpers in `lib/http/redirect.js`: `internalDestination(v, request)` returns `v`
**unchanged** when it is unambiguously this application's own destination, and `null` otherwise; `confineToOrigin(v)`
strips control characters and collapses a leading run of separators to a single `/`. The failure responder now
computes a **request-local** target instead of mutating the declaration, and confines the interpolated result when the
declared template is root-relative. `next` is filtered where it is persisted — `pages.js#login`, `pages.js#signup`,
`auth.js#google` — and again where it is consumed — `users.js#login`, `users.js#create`,
`auth.js#googleCallback`. Six boundaries in total.

Two destination shapes qualify, and both are returned byte-for-byte: a string beginning with **exactly one** `/`, and
an **absolute `http(s)` URL whose parsed host is one of this application's own** — `config.url`,
`config.app.url.hostname[:port]`, or `request.info.host`, plus exactly one additional DNS label in front of one of
them when `config.app.usersubdomains` is on. Everything else is refused: off-origin absolute URLs, the userinfo
disguise whose real host is off-origin (`https://trinket.dev@evil.example` parses to host `evil.example`), the
suffix lookalike (`https://trinket.dev.evil.example`), scheme-relative `//host`, the backslash form browsers
normalize into it, non-`http(s)` schemes, any value carrying a control character, and bare relative values that would
resolve against whatever path the browser happens to be on. Trusting the request's own `Host` is what makes the flow
behave the same in development (`localhost:3000`) and under `supertest` (an ephemeral port) as it does in production;
it cannot be abused, because an attacker cannot set a victim's `Host` header and a `Location` back to the host the
client already addressed is by definition not off-origin.

**Correction — review finding P3-1.** The first version of this filter accepted **only** the single-leading-slash
shape, and that was too narrow: it refused a legitimate same-origin destination and broke the assignment flow.
`public/partials/directives/trinket-assignment.js` registers `.filter('escape', …)` as `window.encodeURIComponent`
at `L8` and `scope.goto` at `L334-L339` sends `next = escape($window.location.href)` through
`trinketConfig.getUrl`, which builds `config.protocol + '://' + config.apphostname + path`
(`public/js/trinket-config.js:L34-L39`) — so the only shape that producer can emit is a **percent-encoded absolute
same-origin URL**, carrying a query and a fragment because `location.href` carries both. `public/**` is frozen by
the preservation directives, so the server is what has to accept it. Re-measured at base commit `2f8712a` over real
HTTP, twice: `GET /login?next=<absolute same-origin URL>` followed by `POST /login` answered `302` with `Location` =
that URL **byte-for-byte, fragment included**; `GET /signup?next=<same>` followed by `POST /users` did the same; and
with OAuth credentials injected, `GET /auth/google` persisted it and the same value came back out. The absolute
same-origin shape is therefore baseline behavior and is restored. The flow is now shipped evidence —
`test/baseline/responses.json#assignmentNext` (eight entries measured at the base commit, replayed field by field by
`test/baseline/replay.js`) and `#assignmentNextContract`, with live coverage in
`test/lib/api/route-parity.js`.

**The one design decision worth stating explicitly.** The helpers are **not** applied inside `redirect()` itself.
The fourth branch of that function's absolutization cascade lets an already-absolute `http(s)` URL through untouched,
and `auth.js#google` depends on it to hand the browser its `accounts.google.com` URL. Confining every declarative
redirect would have broken Google sign-in. Enforcement therefore sits only at the boundaries where the destination is
genuinely user-controlled.

**What the remediation deliberately did not change, with the measurement.** Every legitimate destination is
byte-identical before and after. Root-relative: `next=/courses` still emits `Location: /courses`, and
`next=/account/profile?a=1#f` still emits that exact string, both as raw relative Location headers, preserving the
raw-toolkit-redirect behavior. Absolute same-origin, the shape the assignment producer emits:
`next=https://trinket.dev/u/instructor/classes/algebra-1?assignment=7#work` still emits that exact string, query and
fragment intact, through `POST /login`, through `POST /users` and through the OAuth persistence leg — measured against
the base commit in all three, with zero field differences across all twelve compared fields of all eight recorded
entries. Every rejected destination lands in the **same** branch an absent `next` already took,
emitting the declarative `success.redirect` `/home`. For the interpolated failure target a stronger statement holds:
for `formName` ∈ {`signup`, `sign-up`, `welcome`, `courses/new`} the post-remediation Location is **identical to the
base commit's own Location on its first request after a restart** — 4 of 4 — so each request now behaves exactly as
the un-poisoned declaration always did, and only the cross-request residue is gone. Google's absolute pass-through
was verified end-to-end against a server booted with OAuth credentials injected: the Location is the full
`accounts.google.com` URL, byte-identical with `next` absent, with `next=/courses`, and with
`next=https://evil.example`. The 58-route unauthenticated response corpus is **58 of 58 identical** before versus
after, and the route table still hashes to `452116ce…`.

**Cross-reference to section 1.1, which this remediation must not "fix".** Section 1.1 records that authenticated
`GET /login` and `GET /signup` answer **500**, because the deleted shim's synthetic `reply` had no `.redirect`
property and the property-form calls raised a `TypeError`. The converted handlers reproduce that with an explicit
`badImplementation` throw. Nothing in the SEC-4 remediation touches those two branches: the `next` filtering happens
in the arm that runs only when the visitor is **not** authenticated. Turning those two 500s into working 302s would
have been the most tempting and the most prohibited "improvement" in this changeset.

### 4.5 SEC-5 — 32-bit password-reset and email-change keys (MEDIUM) — PRESERVED

**What it is.** 48 random bytes are generated and then almost all of them are thrown away. At
`lib/controllers/users.js:L355-L360` the password-reset key is `require('crypto').randomBytes(48, …)` followed by
`buf.toString('hex').substring(0, 8)` — **8 hex characters, that is 32 bits** of the 384 generated. The email-change
key at `L1068-L1073` slices to the same 8 characters. The third site, the email-**verification** key at
`L1197-L1202`, slices to **16** characters, so it is 64 bits rather than 32 — the two widths are recorded separately
here because they are both frozen and it would be wrong to describe them as one shape. The endpoints that consume
these keys apply no attempt throttling, so the slice width is the whole barrier.

**Origin.** Baseline, unchanged by the migration. The inline comments at all three sites already record the 48-byte
length and the hex slice as frozen.

**Why it is preserved.** These keys are **live in users' inboxes and persisted in the store** — the reset key is
embedded in `config.url + '/reset-pass?key=' + key` and the email-change key is written into the store value
alongside the new address. Widening the slice changes the token format, so every already-delivered reset and
verification link stops validating: a storage-format and emailed-artifact change on both counts. Throttling the
consuming endpoints is new functionality. There is also **no configuration lever to reach for**: the 86,400-second
reset TTL is the hardcoded literal `await Store.expire(resetKey, 86400)` at `lib/controllers/users.js:L403`, and the
email-change key is stored with no expiry at all. **An operator who wants a wider key must accept that outstanding
reset and verification links stop validating**, which is precisely the change R-4 withholds from this changeset.

### 4.6 SEC-6 — the JWT key is `"undefined"` plus a public short code (MEDIUM) — PRESERVED

**What it is.** The signing key is `config.app.mail.secret + doc.shortCode`, and **`app.mail.secret` does not
exist**: `config/default.yaml:L133-L140` declares the `app.mail` block as `from`, `host`, `port`, `user`, `pass` and
`secure`, with no `secret` key anywhere in it. The expression therefore stringifies to the literal `"undefined"`
concatenated with a short code that appears in URLs, so the effective secret is guessable and a forged token
verifies. Sign sites: `lib/controllers/trinket.js:L414-L415`, `L467-L468` and `L767-L768`. Verify site:
`lib/util/helpers.js:L264` (the key) and `L275` (the call).

**And the token carries no constraints of its own.** All three sign sites are two-argument calls —
`jwt.sign({ shortCode: … }, emailSecret)` — so there is no `expiresIn`, no `audience`, no `issuer`, no `subject`
and no explicit `algorithm`, and the payload is a single `shortCode` claim, which is to say no purpose binding. The
verify side matches: `jwt.verify(token, secret)` at `lib/util/helpers.js:L275` passes no options, so no `algorithms`
allowlist, `audience`, `issuer` or `maxAge` is enforced, and the only check performed is the manual
`data.shortCode === request.pre.trinket.shortCode` comparison at `L277`. The token is also accepted straight from
the request — `request.payload.token` at `L268` is preferred over the session copy — so a forged token can be
presented directly. Taken together with the guessable key above, that is why the review pairs CWE-321 with CWE-798:
the weakness is the effective key, and nothing downstream constrains what a forged token may assert.

**Origin.** Baseline, byte for byte. The derivation is identical on the signing and the verifying side, which is why
the two round-trip at all; the inline comment at `lib/controllers/trinket.js:L396-L402` already records this.

**Why it is preserved.** Changing the derivation **invalidates every token already issued**, including those in
already-sent emails, and the sign and verify sites must change atomically or nothing verifies. Adding a `secret` key
to `config/default.yaml` would also alter shipped configuration that the freeze covers. **An operator should set a
real `app.mail.secret` in local configuration** — the code reads it from configuration, so it will be used the moment
it exists, and no code change is needed to benefit.

### 4.7 SEC-7 — unsanitized archive entry names in generated downloads (MEDIUM) — PRESERVED

**What it is.** The server builds download archives from user-controlled names, applying no check of its own and
leaving the entry table to whatever the archive library accepts:
`archive.append(files[name] || '', { name : name })` at `lib/controllers/trinket.js:L1565`,
`archive.append(buffer, { name : asset.name })` at `L1494`, `archive.append(result.data, { name : result.name })` at
`L1522`, `archive.append(file.content, { name : file.name })` at `L1698` and
`archive.append(streams[i].value, { name : trinket.assets[i].name })` at `L1716`. A crafted trinket can therefore
produce an archive whose entries traverse on extraction — a zip-slip payload delivered to whoever downloads it —
subject to the one narrowing measured below. Note that the *remote fetch* path is not the exposure:
`path.basename(assetUrl)` is applied to the download filename at `L1391`, `L1504` and `L1707`. It is the entry
**name** that is raw. `adm-zip` is used only to *create* archives (`lib/controllers/courses.js:L324-L326` calls
`addLocalFolder` then `writeZip`), so there is no server-side extraction path.

**What the archive actually contains — measured, not assumed.** `archiver` does apply a sanitizer:
`node_modules/archiver/lib/core.js:L310` runs `data.name = util.sanitizePath(data.name)` on every appended entry, and
`compress-commons` repeats it in `ZipArchiveEntry.setName` (`zip-archive-entry.js:L309-L312`). Both are the same
**leading-only** expression, though — `archiver-utils@5.0.2` `index.js:L92-L94` is
`normalizePath(filepath, false).replace(/^\w+:/, '').replace(/^(\.\.\/|\/)+/, '')` — so it strips a leading drive or
scheme prefix, folds backslashes to forward slashes and removes *leading* runs of `../` and `/`, and does nothing
else. Reading the raw local-file-header names out of a produced archive (walking `PK\x03\x04` rather than trusting a
zip library, for the reason in the next paragraph) measured exactly that split: `'../../etc/passwd'` is written as
`etc/passwd`, `'/etc/shadow'` as `etc/shadow` and `'..\..\windows\system32\x.dll'` as `windows/system32/x.dll`,
while `'a/../../../../etc/cron.d/pwn'`, `'assets/../../../../root/.ssh/authorized_keys'`, `'x/../../y'` and `'a/..'`
are each written **verbatim, traversal intact**. The exploitable payload shape is therefore an entry name whose
parent segments are *not* leading — which is exactly the shape a crafted trinket file or asset name can take. The
condition is real; it is simply narrower than "no sanitization at all".

**A measurement trap worth recording.** `JSZip.loadAsync` cannot serve as the oracle for what was written:
`node_modules/jszip/lib/utils.js:L328-L343` exports a `resolve()` that pops on `..` and skips `.`, and it is applied
to every entry name on read, so a JSZip-based inspection of the very same archive reports zero traversing entries.
Anyone re-verifying this entry must read the raw headers. The practical corollary is that a JSZip-based consumer is
immune while a naive extract loop is not — and it is a second reason the server itself is not the victim here, since
`zip.loadAsync` hands back in-memory entries and no server-side code writes an extracted entry to a path.

**Origin.** Baseline. The `archiver` and `adm-zip` call sites are unchanged; only the package versions moved, and
those were chosen — section 3.4 — precisely so the call-site shapes stayed identical.

**Why it is preserved.** Rejecting or rewriting entry names changes which archives the server produces and what a
client finds inside them, and course archive export and import round-trip against each other, so a sanitizer would
have to be applied symmetrically or previously exported archives would stop importing. That is simultaneously a
validation-outcome change and a persisted-layout change.

### 4.8 SEC-8 — predictable `/tmp` archive names, TOCTOU, no cleanup (MEDIUM) — PRESERVED

**What it is.** Download archives are written to predictable, guessable paths and are never removed:
`"/tmp/download-" + timestamp + ".zip"` at `lib/controllers/trinket.js:L1522-L1523`, where `timestamp` is `Date.now()`,
and `"/tmp/" + trinket.shortCode + ".zip"` at `L1725`. A timestamp is trivially predictable and a short code is public,
so a local user can pre-create or race either path, and nothing deletes them afterwards.

**Why the cleanup never happens — the mechanism, measured.** Both handlers *believe* they have arranged cleanup.
`lib/controllers/trinket.js:L1534` and `L1731` each set `request.params._tmp = zipFile`, and the comment above the
second one reads "data to tell onPreResponse to delete this file once the response is finished". There is no such
consumer: `git grep -n "_tmp" -- '*.js'` returns those two assignments and nothing else, and `app.js` registers
exactly two `onPreResponse` extensions — the cache-header-and-error-page one at `L147` and the cookie-expiry one at
`L200` — neither of which reads `params._tmp`. The only `unlink` in the file is the fire-and-forget one on
`downloadPostedZip`'s **error** path at `L1554`. So the success path, which is the path that actually produces files,
never deletes anything, and the archives accumulate in `/tmp` for the lifetime of the container. That is an
unconsumed contract rather than a missing line, which is why "add an unlink" is not the small fix it appears to be.

**Why this is a disclosure and not merely a race.** `"/tmp/" + trinket.shortCode + ".zip"` is derived from a
*published* identifier, so every request for the same trinket targets one identical path — and those requests need
no session. `downloadZip` is not routed directly; it is reached through the `supportedDownloadFormats` dispatch at
`lib/controllers/trinket.js:L27-L30` and `L559-L562`, from `trinket.getByShortCode` (`config/routes.js:L579`,
`GET /{lang}/{shortCode}`), whenever the short code carries a `.zip` extension. Every one of those rows is
`mode=try strategies=["session"]` in the committed route table, i.e. anonymously reachable, and `downloadPostedZip`
reaches its own `/tmp/download-<Date.now()>.zip` path from `POST /api/trinkets/download`, which is `mode=try` too.
What differs between two such requests is the *content set*: hidden files are included only for the owner —
`if (request.user && trinket._owner && request.user.id === trinket._owner.toString())` at `L1672-L1674`, applied by
the filter at `L1696`, with the identical pair at `L1569` and `L1597` in `downloadPostedZip`. The response is then
served by opening a read stream on that shared path (`L1728`) after the write completes. Two overlapping requests
for one trinket therefore write different content sets to one filename and the reader can return the other
request's archive, so an anonymous download can be handed the owner-visible archive with hidden files and
owner-only assets in it. The condition is a content-disclosure vector, not only a corruption or a local-user race,
and it is catalogued at that reading deliberately so nobody later mistakes it for cosmetic.

**Origin.** Baseline; both temp-path constructions are unchanged.

**Why it is preserved.** The paths are how the export flow locates its own output, and the absence of cleanup is
longstanding behavior. It is also the reason the SEC-2a remediation deliberately adds no `unlink`: cleaning up one
temp path while these remain uncleaned would be inconsistent as well as unsanctioned. Section 1.5's 1000 ms race
workaround in `lib/util/file.js` is the same class of condition and is likewise preserved.

### 4.9 SEC-9 — unauthenticated `POST /api/ohnoes` mail amplification (MEDIUM) — PRESERVED

**What it is.** The client error-reporting endpoint is declared at `config/api_routes.js:L1320-L1322` as
`{ route : 'POST /api/ohnoes admin.ohnoes' }` — a bare declaration with **no `config` block at all**, so it carries
no `auth` key, inherits `mode: 'try'` and accepts anonymous requests, and equally carries no `validate` block, so
there is no payload schema, no entry or size constraint of its own beyond `@hapi/hapi`'s one-mebibyte default, and
no CSRF token or signature. Its handler sends operator email per request, so anyone can drive SMTP volume.

**Why it is preserved — and this is the hardest freeze in the set.** Adding authentication changes the route's
resolved auth descriptor, and the **233-row route table including each row's auth mode and strategies is a hard
parity gate**: the sorted digest `452116ce…`, the registration-order fingerprint and the three-way auth partition
(105 required / 2 `auth: false` / 126 inheriting `try`) are all verified as evidence. Authenticating this route would
change the partition and fail the gate. Rate limiting is new functionality. **This is the one entry in the catalogue
that cannot be remediated inside this changeset's contract at all** — it needs an explicit decision to change the
route table, which is out of scope by construction. **An operator should rate-limit this path at the edge.**

### 4.10 SEC-10 — Renderer attribute concatenation bypasses the sanitizer (MEDIUM) — PRESERVED

**What it is.** The custom `marked` Renderer overrides in `lib/shared/trinket-markdown.js` build markup by string
concatenation and emit attribute values without HTML-escaping them, so attacker-influenced markdown can break out of
an attribute. Three sites: `attrStr += ' ' + key + '="' + attrs[key] + '"'` at `L301` (`L404` in the delivered
file), where both key and value come from markdown-supplied embed arguments;
`'<iframe title="' + (title || text) + '"'` at `L323` (`L426`); and
`'<a href="http://nbviewer.org/urls/' + … + href + '" title="' + title + '">'` at `L433` (`L584`). The whitelist
sanitizer never inspects these, because they are produced by the Renderer rather than passed through it.

**Origin.** Baseline. `git diff 2f8712a -- lib/shared/trinket-markdown.js` is **191 insertions and 36 deletions**, and
none of them touches the three concatenation sites or the whitelist body. The insertions are the `marked` 0.3.2 → 4.3.0
bridge adjudicated in section 3.35 — the require becoming `var { marked } = require('marked')` for the 4.x export
shape, the sanitizer named and installed as `Renderer.prototype.html` instead of through the deprecated `sanitize` /
`sanitizer` options, the fork's block-HTML rule and link guard transcribed, and the task-list neutralizer — plus the
comments that record each of those as measured rather than assumed. The sanitizer body itself carries over byte-
identically modulo a uniform two-space de-indent.

**Why it is preserved.** Escaping those attributes changes the rendered HTML for existing course and lesson content,
and rendered markup is client-visible. It is also the same reason `highlight.js` is held at 9.x — section 2 — since
version 10 renames the emitted `hljs-*` classes and would change the same markup. The sanitizer is the platform's XSS
defense and its behavior was preserved exactly; strengthening the Renderer is a security improvement that R-4 does
not permit here. **An operator should treat author-supplied markdown as trusted-author content, which is what the
current design assumes.**

### 4.11 SEC-11 — `Math.random()` six-character course access codes (MEDIUM) — PRESERVED

**What it is.** `generateAccessCode()` at `lib/controllers/course.js:L1745-L1755` draws **six** characters, via
`Math.floor(Math.random() * possible.length)`, from the 55-character alphabet
`"ABCDEFGHJKLMNPRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789"` — about **34.7 bits** from a non-cryptographic
generator. The code is minted at `L966` and looked up by `findByAccessCode` at `lib/models/course.js:L280-L282`,
which makes the join path an existence oracle with no throttling, so a successful guess grants course access.

**The code has two consumers, and they differ in reachability — this is the part worth getting right.** The two
`/api/` endpoints are session-gated: `POST /api/courses/join` (`config/api_routes.js:L479-L489`) declares
`auth: 'session'` with `accessCode: Joi.string().min(6).required()`, and `POST /api/courses/{courseId}/accessCode`
(`L472-L478`) is `auth: 'session'` as well; both appear as `mode=required strategies=["session"]` in the committed
route table. But the browser-facing consumer is **not** gated. `config/routes.js:L194-L200` declares
`GET /courses/join/{accessCode} classes.joinFromLink` with `pre : [helpers.coursesEnabled]` and **no `auth` key**, so
it inherits the server default and appears as `GET | /courses/join/{accessCode} | mode=try strategies=["session"] | 1`
— anonymously reachable. Its handler calls `Course.findByAccessCode(request.params.accessCode)` at
`lib/controllers/classes.js:L204`, and the unauthenticated arm at `L231-L241` flashes `courseInvitation` **only when
the course exists** (`L236-L238`) before redirecting to `/login` (`L240`). `lib/views/login.html:L58-L61` then
renders that flash as a modal containing `{{ flash.courseInvitation.course.name }}`.

**Measured, anonymously, against the migrated server.** With a throwaway course carrying a known access code and a
fresh cookie jar per arm and no login at any point: the valid code answered `302 Location: /login`, and following
that redirect returned a 14,163-byte login page containing `courseInvitationModal` twice and the literal course
name; the invalid code answered the same `302 Location: /login`, and its login page was 13,487 bytes with zero
`courseInvitationModal` occurrences. A normalized diff of the two bodies was exactly the ten-line modal block (plus
the per-response `/cache-prefix-<ms>/` timestamps, which is ordinary `cachify` behavior). So the oracle is fully
anonymous **and it discloses the course name**, which is a strictly worse reading than "a guesser needs an account";
self-registration being open would only have mattered if a session were required, and for this consumer it is not.
The throwaway course was removed afterwards and the database left with zero course documents.

**Origin.** Baseline. The generator is unchanged.

**Why it is preserved.** Access codes are **already printed on handouts, pasted into syllabi and stored on course
documents**. Changing the length, the alphabet or the generator changes a client-visible identifier format and
invalidates every code in circulation; lengthening it would additionally require a lookup migration. Throttling the
join endpoint is new functionality. **An operator should rotate codes for sensitive courses**, which needs no code
change: `POST /api/courses/{courseId}/accessCode` (`config/api_routes.js:L472-L478`) mints a fresh code for any
caller holding the `manage-course-access` permission on that course.

### 4.12 SEC-12 — no JSZip decompression limits (MEDIUM) — PRESERVED

**What it is.** Uploaded archives are expanded with no cap on entry count, per-entry uncompressed size or total
expansion ratio: `zip.loadAsync(request.payload.zipCode, { base64: true })` at `lib/controllers/trinket.js:L1110`
— inside the `draft` handler declared at `L1077` — and at `L1189`, inside `autosave` declared at `L1156`, with
`zipCode : Joi.string().optional()` and **no `.max()`** at `config/api_routes.js:L985` and `L1012`. A small archive
can therefore force a large allocation.

**What *is* capped, precisely.** The compressed input is not unbounded, and the entry originally read as though it
were. Both of those two routes declare an explicit payload ceiling of ten mebibytes —
`payload : { maxBytes : 10 * (1024 * 1024) }` at `config/api_routes.js:L977-L979` for
`POST /api/trinkets/{trinketId}/draft` and at `L1004-L1006` for `POST /api/trinkets/{trinketId}/autosave` — and both
were measured live at an effective `maxBytes` of `10485760`, against a server-wide default of `1048576` that
`@hapi/hapi` 21.4.10 supplies itself (`node_modules/@hapi/hapi/lib/config.js:L155`, `default(1024 * 1024)`;
confirmed on the running server, whose `routes.payload` reports `maxBytes: 1048576`). Since `zipCode` arrives
base64-encoded, ten mebibytes of payload is roughly seven and a half mebibytes of deflate stream. What has no cap is
everything *after* the transfer: the number of entries, the uncompressed size of any one entry, and the expansion
ratio — and a few megabytes of deflate stream is more than enough to expand into gigabytes. The expansion also runs
in-process: `loadAsync` materializes entry contents as strings on the main event loop, with no worker or child
process between it and the server, which is why the review pairs CWE-409 with CWE-400 rather than treating it as a
pure decompression-bomb note.

**Origin.** Baseline. `jszip` moved 3.6.0 → 3.10.1, a same-package security bump with no call-site change, and no
limit existed before or after.

**Why it is preserved — and note the contrast with SEC-2a.** A cap rejects uploads the base commit accepted, which is
a validation-outcome change, and any threshold would be invented rather than measured. Where the base commit had no
limit, adding one is a behavior change; where the base commit streamed and the migration buffered, restoring
streaming is a behavior *restoration*. That distinction is the whole basis of this section's dispositions, and these
two entries are the cleanest illustration of it. **An operator who wants a tighter bound should set it at the edge**,
in a reverse proxy, and should understand exactly what the application already does and does not give them: the two
upload routes carry a declared ten-mebibyte `payload.maxBytes` and everything else inherits `@hapi/hapi`'s own
one-mebibyte default, while the server options at `app.js:L63-L82` set only `routes.cors` and
`routes.state.failAction` and never touch `routes.payload`. So the transfer ceiling is a per-route literal in
`config/api_routes.js`, not an operator-tunable setting, and lowering it — or adding the entry-count and
expansion-ratio limits that genuinely do not exist — would be a code change of exactly the kind this section
withholds.

### 4.13 The undeclared `Boom` identifier in `course.js`

Recorded in the catalogue rather than in the SEC series, because it is not one of the twelve review findings — it is
the correction of a false claim this document previously made *about* one of them.

**What it is.** `lib/controllers/course.js` binds the error library to `errors` at `L3` —
`errors = require('@hapi/boom')` — and declares **no** identifier named `Boom`, yet references `Boom.` at **41 code
sites**: 37 `Boom.forbidden` and 4 `Boom.notFound`, with zero such references in comments. Among them are the two
error-object pass-throughs the Technical Specification calls out, at base-commit
lines `L1003` and `L1060`, which are `lib/controllers/course.js:L1190` and `L1251` in the migrated file. Every one of
those references raises `ReferenceError: Boom is not defined`, which the base commit's catch-all at
`lib/util/routeParser.js:L578-L589` mapped to `badImplementation` → **500**, and which `lib/http/errorMap.js` now
maps to the same 500.

**Why it matters.** An earlier revision of this appendix asserted that those two sites "leak the inner error's text
into a client-visible **403** body, so that text is contractual". That is wrong in both directions: the 403 never
occurs, and the inner text never reaches a client. Measured against `@hapi/hapi` 21.4.10 over real HTTP with both
shapes served side by side, the undeclared shape answers **500** with the scrubbed
`"An internal server error occurred"` while the declared shape answers **403** with the inner text verbatim. The full
measurement, including the two-row comparison, is in the appendix immediately below.

**Why it is preserved.** The 500 is the observable behavior, so it is what R-4 protects. Renaming `Boom` to `errors`
would convert a measured 500 into a 403 **carrying internal error text** — simultaneously a behavior change and an
information disclosure, which is a rare case where the preservation rule and the security interest point the same
way. The inline comments at both sites already state this correctly.

**Where the identifier could have come from, and why it comes from nowhere.** The search was widened past this file
before the verdict was taken, because a bare identifier can be supplied from four places in this codebase and only one
of them is a `require`. `Boom` is **not** a Node global; it is **not** one of the nine bare model globals `app.js`
assigns; it is **not** in `app.js`'s leak-detector whitelist, which enumerates those nine plus `log`, `NODE_CONFIG`,
`tokenizer`, `$V`, `$M`, `$L`, `$P`, `DEFAULT_FILE_PATH` and `Promise`; and the four modules that *do* bind the name —
`lib/controllers/auth.js`, `lib/util/helpers.js`, `lib/util/routeParser.js` and `lib/http/responseContract.js` — each
bind it as a module-local `var` and none publishes it. The identifier therefore resolves nowhere, in every frame.

**The conversion is mapping-neutral, and the repair would be the largest behavior change in the changeset.** At the
base commit every one of these sites read `return reply(Boom.forbidden());`, and the raise happened when `Boom` was
evaluated — before `reply` was ever called — so the shim's catch-all answered `badImplementation`. After the
conversion the same evaluation raises before `throw` completes and `lib/http/errorMap.js` answers the same
`badImplementation`. Nothing about the response changes. Conversely, adding one `require` line here would convert
**41** responses in this file alone from a scrubbed 500 into 403 and 404 — and, counting the sibling modules in
[section 10](#10-the-undeclared-boom-scrubbed-500s-61-call-sites-that-never-returned-the-status-they-name), 61 across
the repository. That is the single largest behavior change available in this changeset, and it is exactly what R-4
forbids.

## 5. Crosswalk — in-code quirk labels to catalogue entries

**Why this section exists.** Roughly 150 in-code comments cite this catalogue. Most name the behavior they preserve in
the sentence that follows the label, and so resolve by reading. But **four files use private numbering schemes** whose
numbers mean nothing outside the file, and one numeral — `5` — is used by three unrelated things. This section maps
every private label to a stable target, and it is the catalogue entry for the handful of labels that sections 1, 2 and 3
do not otherwise cover.

**Citation frame — the one exception in this document.** Sections 1 to 3 and the appendix cite the **base commit**, per
the note under "How to read this catalogue". The labels below exist only in the **migrated** files, so the line numbers
in this section alone are **migrated-frame** numbers. Where the same behavior is catalogued elsewhere, that entry keeps
its base-commit citation and is linked from the right-hand column.

**What this section is not.** It maps, and where no other entry exists it describes. It changes no code: nothing in
`lib/util/routeParser.js`, `lib/http/responseContract.js`, `lib/util/helpers.js` or `lib/util/mailer.js` was touched in
order to add it.

**The labels are now this document's own names, and `Site` is a historical pointer.** Each private scheme existed as a
literal in-code token when this section was written. The comment pass that followed rewrote those comments to name
their behavior in prose — the house style described in 5.5 — and retired every token: re-measured on the delivered
tree, `Q-A6`, `Q-errfalsy`, `Q-A1`, `Q-A3a`, `QUIRK 1` through `QUIRK 6` and `(Q1)` through `(Q5)` each return
**zero** in-code occurrences. The tables are kept because for several of these mechanisms they are the only catalogue
entry, but read the labels as this document's names rather than as strings to grep for, and read `Site` as the line a
label occupied while it existed — later edits have moved those lines, so each mechanism is located by its
description.

### 5.1 `lib/util/routeParser.js` — the `Q-` scheme

| Label | Site | What it preserves | Catalogue home |
|---|---|---|---|
| `Q-A6` | the responder block inside `parseRoutes`' handler | There are exactly **two** responders — published on the per-request toolkit as `h.respond` and `h.reject`, and spelled `request.success` / `request.fail` at the base commit — and there must never be a third. A `catch` responder is undefined at baseline, and two branches of `lib/controllers/folders.js` invoke one — so they raise a `TypeError` that the centralized error map turns into a **500**. Publishing a third responder would silently convert that baseline failure into a working response. The base-commit request-level spelling was itself retired once every controller had migrated; 3.14 carries that measurement. | **This row**, paired with `responseContract`'s `QUIRK 6` in 5.2, which is the same quirk seen from the other side |
| `Q-errfalsy` | L226 | `ErrorMap.toResponse()` keeps the source's truthiness guard, so a **falsy** caught value yields `undefined` and the handler returns `undefined`. Whatever `toResponse()` gives back is returned as-is; adding a fallback would change the baseline mapping. | **Section 3.10**, which governs the same error sink |
| `Q-A1` | L236, against the two-parameter declaration now in `lib/http/preHandlers.js` | `convertPreHandlers` is declared `(pre, server)` and called with **one** argument, so `server` is permanently `undefined`. Provably inert, because the string-form wrapper declares its own `var server = request.server;` and never reads the parameter. | **Section 1.11** (base frame: `lib/util/routeParser.js:L594` against `L71`), with the adjudication at **section 3.11** |
| `Q-A3a` | L249 | The `.json` extension-duplication block is **inert** — no declaration in either route file carries an `ext` key — and is preserved as code rather than deleted. | **Appendix**, "How 178 declarations become 233 routes", `correction-a` |

### 5.2 `lib/http/responseContract.js` — the numbered `QUIRK n` scheme

The module header enumerated all six in one place and that list is authoritative for the numbering. Both the header
list and the per-site numerals were replaced with prose by the comment pass described in the framing note above, so
the numbers below are this document's and each row is located by its description.

| Label | Site | What it preserves | Catalogue home |
|---|---|---|---|
| `QUIRK 1` | `reject()`'s HTML-redirect branch | **Historically:** `reject()` interpolated `fail.redirect` back **into** the closed-over `fail` object, so an interpolated value persisted into later requests — a cross-request state leak, which this row originally recorded as preserved. **Remediated:** SEC-4 established the leak is reachable through `POST /users`' unconstrained `formName`, so the interpolation now lands in a request-local `target` and every request re-interpolates the declared template exactly as the first request after a restart did. Nothing writes to the declaration objects at request time any more; the only writes they ever see are `routeParser`'s parse-time `route.html` / `route.redirect` hoists. | **4.4**, which carries the measured evidence and the disposition; this row records the historical shape |
| `QUIRK 2` | L424 | `reject()` never sets a status, so a failure answers **HTTP 200** carrying `data.status === "error"` rather than a 4xx. | **This row**; the measured evidence is `test/baseline/responses.json`'s adjudication `request-fail-without-redirect-or-html-yields-200` |
| `QUIRK 3` | L379 | `reject()`'s log line prints `"<inspected value> undefined"` whenever the responder is used directly as a promise rejection handler. | **This row** |
| `QUIRK 4` | L278 | A bare `request.yar.flash()` **drains** the flash bag — it is a mutation, not a read. | **This row** |
| `QUIRK 5` | L160 | `addUserContext()`'s `emailEnabled` rule — `hasFrom && (hasAWS \|\| hasMailgun)`, kept as the **raw truthiness expression** rather than a boolean — disagrees with `lib/util/mailer.js#isConfigured()`, which requires `from` **and** `host`. The two rules stay disagreeing. | **This row**; see 4.4 for the numeral collision |
| `QUIRK 6` | L206 | There is **no third responder**. Two controller branches depend on its absence to produce their baseline 500. | **This row** — the same quirk as `routeParser`'s `Q-A6` in 5.1 |

### 5.3 `lib/util/helpers.js` — the `(Qn)` scheme

The in-code token is written `PRESERVED QUIRK (Qn)`. `(Q1)` to `(Q4)` are four instances of one mechanism: at
baseline the synthetic reply settled each pre-handler on its bare no-argument call, so the
`.redirect(location).permanent().takeover()` chain that followed acted on an **already-settled** promise and the
computed `location` was discarded. Each was measured over real HTTP at **200 with no `Location` header**.

| Label | Site | What it preserves | Catalogue home |
|---|---|---|---|
| `(Q1)` | L192, in `findTrinket` | Resolves to `null` and emits **no** redirect, so the request continues with `request.pre.trinket === null`. A **live** route surface (`config/routes.js:396/404/412/419`), so returning `h.redirect(location)` would introduce a 301 that does not exist at baseline. | **Section 3.12**'s family |
| `(Q2)` | L416, in `courseBySlug` | The same, with `request.pre.course === null`. A **live** surface (`config/routes.js:159/166/178/184/382`). | **Section 3.12** directly — this is the course-slug 301 that never fires |
| `(Q3)` | L484, in `trinketByOwnerAndSlug` | The same, on the alias branch. This export has **zero references** anywhere in the repository. | **Section 3.12**'s family, and **section 3.18** for the latency-race narrowing in the same function |
| `(Q4)` | L338, in `toLowerCaseURI` | Resolves the **empty string**, not `null`, and emits no redirect — measured 200 with a `request.pre` value of `''`. Kept even though this export has zero references. | **This row**, as the empty-string variant of **section 3.12**'s family |
| `(Q5)` | L16, covering the four `next(Boom.…)` sites in `internals.isAdmin` (L27), `internals.userByLogin` (L71) and **both** guards of `internals.contains` (L102) | Those four sites are **unreachable**: the string-form pre-handler resolver applies every registered server method as `serverMethod.apply(null, args)` and never appends a trailing `next`, so every `if (next)` / `typeof next === 'function'` guard takes its modern branch. The dead branches are preserved verbatim, alongside the four different Boom delivery mechanisms they sit among — `next(Boom)` here, assigned-then-**returned** in `canEdit` and `findById`, assigned-then-**thrown** in `contains`, and `Promise.reject` in `findById`. | **This row** |

### 5.4 The numeral `5` collides three ways

Three unrelated things are labelled "5". The collision is real, it is not resolved by renaming anything, and this table
is how it is resolved instead.

| Where you read it | What it actually means | What it is **not** |
|---|---|---|
| `lib/http/responseContract.js` `QUIRK 5` (L160) **and** `lib/util/mailer.js:L7` "PRESERVED QUIRK 5" | **The same single quirk** — the `emailEnabled` versus `isConfigured()` disagreement. The mailer's label is a cross-reference **into `responseContract`'s private numbering**, written from the other end of the disagreement. | Not a catalogue section number, and not helpers' `Q5` |
| `lib/util/helpers.js` `(Q5)` (L16) | The four unreachable `next(Boom.…)` sites (4.3). | Not the email-configuration disagreement |
| Catalogue **section 1.5** | The 1000 ms race workaround and the `"does not exists"` typo in `lib/util/file.js`. | Not related to either of the above |

**The disambiguation rule.** A bare numeral in an in-code comment always belongs to that file's own private scheme —
or, for `lib/util/mailer.js:L7`, to `responseContract`'s scheme, which is the file the comment quotes. A reference to
**this catalogue** is always written out as "section N.M", as at `lib/util/mailer.js:L47` and at three of the five
`lib/util/file.js` sites (see 4.5). When in doubt, the presence of the word "section" is the discriminator.

### 5.5 Every other citation is self-describing

The remaining in-code citations — roughly 150 of them, across `app.js`, `config/`, `lib/` and `test/` — carry **no
numeral at all**. Each names its behavior in the sentence immediately following the label, which is why they need no
map: `lib/util/file.js`'s five sites are the pattern, at **L80**, **L97**, **L112**, **L171** and **L200**, of which
L80 cites **section 1.12** and L171 and L200 cite **section 1.5** outright while the other two describe the behavior
in place. The convention, stated once: **a citation without a numeral is read, not looked up**, and no label anywhere
in the codebase means "find a number in the catalogue" except the four schemes mapped above.
## 6. The pending / convergence decision table

Removing the compatibility shim's deferred response capture would, by default, have turned every baseline
**pending / no-response** path into a concrete HTTP 200 or 500. That silent convergence is a behavior change on the
wire, so each affected branch was adjudicated against the base commit and the measured fate was **restored** rather
than converged. This section records every one of them, because "we preserved the hangs" is only checkable if the
list is enumerated. Section 3.23 records the adjudication itself, including the second family of branches — the ones
whose baseline failure was a genuine unowned throw — which are deliberately left to converge on the 500 the base
commit already answered.

### 6.1 The base-wrapper rule, which decides every row below

The base handler wrapper in `lib/util/routeParser.js` was:

```js
var result = await handler.call(this, request, reply);
if (result === undefined) {
  result = await responsePromise;   // never settles unless a responder resolved it
}
return result;
```

and the synthetic `reply(data)` resolved that deferral on **only** these paths: `data.isBoom`;
`data instanceof Error`; and the chainable builder's `.redirect()`, `.code()`, `.header()` and `.view()`. The
builder's `.type()` and `.bytes()` returned the builder **without** resolving, and a bare `reply(plainObject)` with no
terminator also returned the builder without resolving. Four rules follow, and they are what make each verdict below
a measurement rather than an opinion:

1. If the base handler frame **returned a defined value**, the deferral was **bypassed entirely** and that value was
   the response. So `return reply(err)` *at the handler top level* answered a real 500 — **not** a hang.
2. If the frame returned `undefined` and some responder resolved the deferral, the response was that responder's
   value.
3. If the frame returned `undefined` and nothing ever resolved the deferral, `await responsePromise` never settled:
   **NO RESPONSE**.
4. The same `return reply(...)` statement therefore has **opposite** meanings depending on position — returned from
   the handler frame it is a real response; returned from inside a callback the frame has already left, it is a hang.

One consequence is worth stating separately, because it was measured and is counter-intuitive: a builder that *does*
reach hapi from the handler frame serializes to **200 `application/json` `{}`**. That is why a handful of branches
legitimately answer an empty 200 and are *not* listed as hangs.

**What is deliberately NOT reproduced.** Several baseline hangs were accompanied by a process-level uncaught
exception — Mongoose re-throws a callback exception via `immediate()`, and no `uncaughtException` handler exists
anywhere in the repository. The HTTP-visible fate (no response) is preserved; the process death is not. Restoring a
crash would be a denial-of-service vector, and it is not part of the observable HTTP contract this change froze.

**How preservation is implemented.** `lib/http/pending.js` exposes `hang()` — a promise that never settles, which
hapi leaves as a pending request — and `rejectOrHang(h, json, err)`, which is `try { return h.reject(json, err); }
catch { return hang(); }`. `rejectOrHang` is **transparent** on every non-raising path, so it preserves the ordinary
failure response wherever one existed and only produces a hang where the baseline responder itself threw
(see section 7.3). `route.settings.timeout` was measured as `{ server: false }`, so nothing times a pending request
out.

### 6.2 The table

Line numbers are current-source positions; every row was derived from the base source at `2f8712a`. The
**Preserved with** column names the delivered `lib/http/pending.js` call — `forever`, its alias `hang`, or
`rejectOrHang` — and its line, so each citation can be checked against the file. Rows count **branches**, not
call sites, and the two differ in one place: the four `downloadExport` denials share a single `try`/`catch`
container, so the branch rows below map onto **35** call sites. The remaining three delivered sites —
`courses.js` L143 (`copy`'s `!course` fall-through), `courses.js` L378 (`download`'s `!stats` fall-through) and
`users.js` L515 (`savePassword`'s `Store.del` failure) — are the dereference-`TypeError` twins of the
ignored-error catches listed here and are catalogued in
[section 9](#9-the-no-response-and-process-fate-preservations-site-by-site) instead. Between the two tables every
one of the **38** `lib/http/pending.js` call sites in the tree is accounted for exactly once.

| Controller | Handler | Branch | Baseline fate | Mechanism at baseline | Preserved with |
|---|---|---|---|---|---|
| `admin.js` | `uploadUsers` | csv parse failure | NO RESPONSE | raw `Error` handed to the responder inside a `csv.parse` callback the frame had left | `rejectOrHang` L166 |
| `admin.js` | `updateUser` | lookup / merge / save failure ×3 | NO RESPONSE | raw `Error` to the responder from an orphaned callback | `rejectOrHang` L220, L243, L256 |
| `admin.js` | `updateUser` | falsy `roles` | NO RESPONSE | frame returned `undefined`, no responder ran | `forever` L277 |
| `admin.js` | `grantRole` | grant / save failure ×2 | NO RESPONSE | as `updateUser` | `rejectOrHang` L286, L333 |
| `auth.js` | `googleCallback` | an empty or literal-`null` token payload | NO RESPONSE | `body.access_token` raised a `TypeError` inside the retired client's callback, after the enclosing `new Promise` executor had already returned | `forever` L151 |
| `auth.js` | `googleCallback` | an empty or literal-`null` profile payload | NO RESPONSE | `profile.email` raised in the same unowned callback, for the same reason | `forever` L175 |
| `course.js` | `createCourse` | unknown failure | NO RESPONSE | bare builder returned from a callback, never resolved (rule 4) | `hang` L56 |
| `course.js` | `updateCourse` | unknown failure | NO RESPONSE | as above | `hang` L161 |
| `course.js` | `copyCourse` | copy failure | NO RESPONSE | returned from the `copy()` callback; frame had no `return` | `hang` L252 |
| `course.js` | `updateLesson` | absent lesson | NO RESPONSE | callback dereferenced the absent document | `forever` L327 |
| `course.js` | `moveLesson` | absent lesson | NO RESPONSE | same mechanism as `updateLesson` | `hang` L361 |
| `course.js` | `userLookup` | third case | NO RESPONSE | the `.then` had no `else` branch | `forever` L725 |
| `courses.js` | `create` | fall-through | NO RESPONSE | frame returned `undefined`; no responder ran | `forever` L68 |
| `courses.js` | `copy` | copy failure | NO RESPONSE | orphaned callback | `hang` L136 |
| `courses.js` | `download` | `fs.stat` failure | NO RESPONSE | orphaned callback, after the same cleanup the base performed | `hang` L361 |
| `folders.js` | `create` | duplicate key (`11000`) | NO RESPONSE | `request.catch` is not a function ⇒ `TypeError` inside the save callback | `forever` L117 |
| `folders.js` | `create` | unknown failure | NO RESPONSE | bare builder returned from the save callback (rule 4) | `forever` L130 |
| `trinket.js` | `email` | send failure | NO RESPONSE | orphaned callback | `forever` L991 |
| `trinket.js` | `draft` | save failure | NO RESPONSE | orphaned callback | `forever` L1180 |
| `trinket.js` | `autosave` | save failure | NO RESPONSE | orphaned callback | `forever` L1280 |
| `users.js` | `sendPassReset` | responder given a raw `Error` | NO RESPONSE | see section 7.3 | `rejectOrHang` L375 |
| `users.js` | `sendPassReset` | `Store.set` / `Store.expire` failure | NO RESPONSE | raised inside the unowned `randomBytes` callback | `hang` L406 |
| `users.js` | `assetUpload` | responder given a raw `Error` | NO RESPONSE | see section 7.3 | `rejectOrHang` L797 |
| `users.js` | `assetUploadFromURL` | transfer failure | NO RESPONSE | orphaned callback | `forever` L912 |
| `users.js` | `assetUploadFromURL` | responder given a raw `Error` | NO RESPONSE | see section 7.3 | `rejectOrHang` L939 |
| `users.js` | `sendEmailChange` | **API-03** — `POST /api/users/email` | NO RESPONSE, and **no email sent** | a third argument was passed to an **arity-two** `Store.set`, so the callback never ran | `forever` L1089 |
| `users.js` | `sendEmailVerification` | `Store.set` failure | NO RESPONSE | same unowned-callback position | `hang` L1198 |
| `users.js` | `activateAccount` | `Store.del` failure | NO RESPONSE | orphaned callback | `forever` L1345 |
| `users.js` | `getExportStatus` | not found / access denied | NO RESPONSE | undeclared `Boom` ⇒ `ReferenceError` in an orphaned callback | `forever` L1532, L1544 |
| `users.js` | `downloadExport` | four denial branches | NO RESPONSE — not 404, not 403, not 400 | undeclared `Boom` ⇒ `ReferenceError` before any Boom is constructed | `forever` L1614 — one container, four branches |
| `users.js` | `downloadExport` | the **success** path | NO RESPONSE | `config.aws.buckets.exports` is declared by **no** configuration file, so the presign parameters raise a `TypeError` — see section 7.5 | `hang` L1648 |

That is **38 preserved pending sites across 7 controllers and 21 handlers**, covering all 19 routes the review cited
plus 8 further sites found by applying the rule in section 6.1 to branches the review had not flagged, and the two
`googleCallback` provider-payload branches adjudicated in section 3.37.

### 6.3 Branches that were *not* converted to hangs

Equally important, and easy to get wrong in the other direction. Wherever the base frame **returned** the
responder's value, the deferral was bypassed and the baseline answered a real response — so those sites keep their
concrete status and must **not** be made pending. Two examples that were adjudicated explicitly: `folders.js`'s
`trinkets` handler was already `async` at baseline and returned defined values on both paths, so its `500` is
genuine; and `course.js`'s `updateInvitation` returned its chain from the handler frame, so the builder *did* reach
hapi and its empty **200 `{}`** is genuine. Five branches in `trinket.js` that answer an empty 200 were audited the
same way and kept.

## 7. Mechanisms measured during the conversion

Facts established by measurement while preserving the behavior above. They are recorded because each one changes what
a correct change looks like, and several contradict what the code or the specification appears to say.

### 7.1 `errorMap.toResponse` has no `isBoom` test, so `throw` and `return` are not interchangeable

`lib/http/errorMap.js` is the relocated single catch-all, byte-equivalent to the shim's own. It contains **no
`isBoom` test**: for any truthy caught value it returns `Boom.badImplementation(err.message || String(err))`. Every
routed handler runs inside `lib/util/routeParser.js`'s `try` / `catch` that funnels caught values through it.
Measured over real HTTP on `@hapi/hapi` 21.4.10:

| Form | Bare hapi | Inside the routeParser catch |
|---|---|---|
| `throw Boom.notFound('nf-msg')` | 404, message `nf-msg` | **500, message scrubbed** |
| `return Boom.notFound('nf-msg')` | 404, message `nf-msg` | 404, message `nf-msg` |
| `throw Boom.forbidden('fb-msg')` | 403, message `fb-msg` | **500, message scrubbed** |
| `return Boom.forbidden('fb-msg')` | 403, message `fb-msg` | 403, message `fb-msg` |
| `throw` / `return Boom.badImplementation` | 500 scrubbed | 500 scrubbed |

So **hapi is symmetric but this application is not.** A 4xx must be **returned**; throwing it collapses it to a
scrubbed 500. This is why the conversion standardised on returning, and why the pre-existing `throw Boom.*` sites in
`lib/controllers/course.js` — which reference an **undeclared** `Boom` and therefore raise a `ReferenceError` before
any Boom exists — answered a scrubbed 500 at the base commit and still do.

### 7.2 A raw `Error` handed to the failure responder always raises

`h.response(new TypeError(...))` raises `AssertError: Cannot wrap an error` on `@hapi/hapi` 21.4.10, and the failure
responder's default branch ends in exactly `h.response(json)` — byte-identical to the shim's terminal statement. So
passing a raw `Error` made the **responder itself** throw at baseline too. Only the landing site differed: from an
orphaned callback the raise had no handler and the request hung; from a returned chain it became a rejection the
shim's catch-all mapped to a genuine **500**, which must stay 500. This is the entire justification for
`rejectOrHang`, and for *not* using it at returned-chain sites.

A related pure-JavaScript fact, verified independently: `promise.then(fn).catch(cb)` invokes `cb` **twice** when `fn`
throws — once as the success callback and again with the error. That is how one baseline handler turned a merge
`TypeError` into a failure-responder call.

### 7.3 `ObjectUtils.serialize` corrupts any payload carrying a raw `ObjectId`

The success responder runs `ObjectUtils.serialize` on the payload, which walks plain objects with a bare
`for (var key in json)`. bson 4 exposes `ObjectId`'s methods as **enumerable prototype properties**, so the walk
copies `toJSON`, `toHexString`, `toString`, `equals`, `getTimestamp`, `valueOf` and friends onto a **plain object**.
hapi's marshalling then calls the stolen `toJSON` with that plain object as the receiver, `this.id` is `undefined`,
and a `TypeError` is raised **inside transmit** and answered as a scrubbed 500. **Any success payload containing a
raw `ObjectId` is therefore a permanent 500** — `POST /api/exports` (`users.requestExport`,
`lib/controllers/users.js:L1419`) is the measured instance, and the export record is still created. The failure
path escapes it because the failure responder never calls `serialize`. The base commit ran the identical
`serialize` over the identical payload, so this is preserved, not introduced.

### 7.4 The success responder assigns `flash` and `context` *after* serializing

`json.flash` and `json.context` are attached after the `pull`/`serialize` step, so they bypass serialization
entirely. Anything relying on those two keys being normalised is relying on something that never happened.

### 7.5 Routes and code paths that are already dead at the base commit

Preserved under R-4 and R-1, and listed so they are not mistaken for regressions introduced here.

- **`downloadExport`'s success path.** `config.aws.buckets` declares seven buckets — `userassets`, `snapshots`,
  `cdn`, `materials`, `useravatars`, `appassets`, `vendorassets` — and **no `exports`**; `config/test.yaml`,
  `config/production.yaml.dist` and `config/local.example.yaml` declare no `buckets` block at all.
  (`config/default.yaml`
  *does* contain `exports` keys, but they are `db.redis.exports` and a `db.redis.bullqueues` entry — not S3 buckets.)
  `config.aws.buckets.exports` is therefore `undefined` and reading `.name` raises a `TypeError` inside the same
  unowned callback, so the route answered **nothing** at baseline.
- **`POST /api/users/assets` and `POST /api/users/assets/{fileId}` are unreachable over HTTP.** The route declares
  `payload { output: 'file' }` with `multipart` unset, so hapi 21 answers **415** for `multipart/form-data`; for any
  other content type `request.payload` becomes `{ path, bytes }`, which the declared `file: Joi.any().required()`
  schema rejects, producing a 200 validation flash.
- **`course.moveMaterial` always answers 500**, and **`/embed/beta/{type}` is a permanent 500**.
- **`/api/trinkets/popular` and `/api/trinkets/active` have no controller method**, but their pre-handlers run first,
  so they answer 404 without a `lang` and 403 with one.
- **`courses.js#copy` never renames the copy**, so an owner copying their own course *always* collides on the
  `{_owner: 1, slug: 1}` unique index with `MongoServerError` code `11000`. The reason the collision lands on
  exactly that index pair is that `Course#copy` writes the **copier's** `ownerSlug` while reusing the source
  `slug` verbatim (see section 7.11), so a self-copy reproduces both key components unchanged; the success path
  is reachable only for a
  non-owner. This was settled empirically, not assumed.
- **`lib/workers/exports.js` is unreachable.** Nothing in the tree requires it — a repository-wide search finds only
  comments — so the export queue's processor is never registered and bulk export is dead at runtime. It also cannot
  be loaded standalone at the base commit **or** now: its own require chain loads `config/db` *before*
  `config/app.config`, tripping the `mongoose-schema-extend` × Joi conflict that `config/app.config.js` is
  deliberately ordered to avoid. `node lib/workers/exports.js` exits 1 with
  `AssertError: Schema can only contain plain objects (0)` from `config/api_routes.js:39` — identically at `2f8712a`
  and at `HEAD`.
- **Five `.catch(reply)` tails** in `lib/controllers/trinket.js` were dropped during the conversion. For a non-Boom
  rejection both paths produce the same scrubbed 500, and the only divergent input — a Boom rejection — is
  unreachable at all five sites, so the removal is mapping-neutral. Documented at each site.

### 7.6 The two deprecation warnings, and why neither is repairable here

- **DEP0169 (`url.parse`) is triggered by the application itself.** No file under `lib/`, `config/` or `app.js`
  calls `url.parse`. The warning comes from `@hapi/shot/lib/request.js:30`, reached through `Server.inject` — because
  `lib/controllers/courses.js` performs an **internal sub-request** with `request.server.inject({...})`, as does
  `lib/controllers/folders.js`. Both call sites are base-identical. The installed `@hapi/shot` 6.0.3 is the latest
  published, so there is no upstream fix, and rewriting the app's internal inject into a direct call would change
  behavior. The boot gate stays clean because the warning fires only when those routes are exercised.
- **DEP0174 is why two `new Promise` bridges were deliberately kept.** `util.promisify(User.exists)` warns on every
  call, because `lib/models/user.js#exists` is a hybrid: it invokes its callback **and** returns the promise chain.
  Both call sites were reverted to the base commit's own hand-written bridge with an explicit retention
  justification. The standing rule: **before promisifying anything, check whether the target also returns a promise
  from its outer frame.** All 16 promisify targets in the tree were audited; `User.exists` is the only offender.

### 7.7 Reproducing the response corpus requires three environment facts

The corpus in `test/baseline/responses.json` replays byte-identically only when the capture environment is
reproduced. All three of these produced spurious mismatches before they were identified:

1. **`NODE_ENV=test`.** The artifact records `nodeEnv: "test"`. `config.isTest` is read by
   `lib/views/embed/glowscript-blocks-iframe.html`, which renders `testing : true` versus `testing : false` — a
   **one-byte** difference that changes that page's digest and nothing else.
2. **No `config/local.yaml`.** The capture had none. A local override file shadows `app.url` (changing every absolute
   `Location`) and `cookieOptions.domain` / `isSecure` (changing Set-Cookie attributes).
3. **`app.url` is an object**, `{protocol, hostname, port}` — not a string. The capture's `nodeConfigOverride`
   deliberately does **not** touch it, so `config.url` stays `https://trinket.dev` regardless of the bind address;
   that is what preserves the absolute-versus-relative `Location` distinction the corpus exists to prove.

A fourth, unrelated to the corpus but easy to trip over: **node-config persists runtime mutations.** Assigning to a
`config.*` property writes `config/runtime.json`, which is gitignored but is re-read on every subsequent boot. Export
`NODE_CONFIG_PERSIST_ON_CHANGE=N` (and `NODE_CONFIG_DISABLE_FILE_WATCH=Y`) *before* anything requires node-config,
and delete any stray `config/runtime.json`.

### 7.8 The route table is invariant to the dependency bump, measured from both sides

The base source was booted twice: once against the **base lockfile** (`@hapi/hapi` 20.3.0, `joi` 17.13.3) and once
against the **migrated** framework (`@hapi/hapi` 21.4.10, `joi` 18.2.3). Both produced the same 233 rows and the same
digests. Neither major alters route registration, effective auth resolution or pre-handler counts — which is
precisely what makes the route table a valid parity denominator across the migration. The base commit is
`2f8712a112db46f923918c4507c75abc732d83d0`; the commit that the artifact previously named, `cd98389`, is its **child**
and differs from it in `package.json` and `package-lock.json` **only**, with zero source files changed.

### 7.9 The `.fail(` / `.spread(` census, corrected

`Promise.prototype.spread` was removed: a comment-aware census finds **zero** `.spread(` call sites. The
`Promise.prototype.fail` alias **survives** and is load-bearing, with exactly **8** consumers — all in
`test/lib/models/plugins/roles.js` at lines 54, 90, 107, 122, 146, 163, 179 and 195. Earlier revisions claimed 13
sites and named `lib/workers/exports.js` as a consumer; that file has **none**, because removing `q` took its `.fail(`
sites with it. The alias cannot simply be deleted: `q` is absent from both `package.json` and `node_modules`, and
`Promise.prototype.fail` is `undefined` on a native promise.

### 7.10 The two surviving `request.catch` sites answer differently

`request.catch` was never a real responder — there were only ever two, and nothing defines a third — so both sites
raise `TypeError: request.catch is not a function`. Their **fates differ**, and both are preserved: in
`lib/controllers/folders.js`'s `create` the raise happens inside an unowned save callback, so the request is
**pending**; in `update` it happens inside a `.catch` of a chain that **is** returned, so it becomes a rejection and
answers **500**.

### 7.11 Model-layer behaviours that survive the conversion unchanged

**`Document#set()` never throws on a cast failure — it defers a `ValidationError`.** Handing a genuinely typed
schema path an uncastable value is silent at the call site: `set()` returns normally, the path keeps its previous
value, and a `ValidationError` is parked on `document.$__.validationError` to be raised later by `validate()` or
`save()`. Measured on `Trinket` against four typed paths, with an object as the incoming value:

| Path | Declared type | `set()` threw | Value after the set | Deferred error |
|------|---------------|---------------|---------------------|----------------|
| `displayOnly` | Boolean | no | `undefined` | `ValidationError` |
| `codeLastUpdated` | Date | no | `undefined` | `ValidationError` |
| `settings.autofocusEnabled` | Boolean | no | `true` (default retained) | `ValidationError` |
| `settings.testsEnabled` | Boolean | no | `false` (default retained) | `ValidationError` |

`await document.validate()` then rejects with `ValidationError` naming the offending path. Two consequences matter
for the conversion: a converted handler that awaits nothing between the `set()` and its response will **not** see the
error, exactly as at the base commit; and a top-level path silently becomes `undefined` while a nested path silently
keeps its default, so the two are not interchangeable. Note that an *unknown* path behaves differently again — under
mongoose strict mode it is dropped with no deferred error at all, which is why a probe must confirm the path is
actually declared before concluding anything about casting.

**`slugAvailable` excludes the document itself.** `lib/models/trinket.js:L549` builds its uniqueness query with
`_id : { $ne : this._id }` at `L553`, so a document never collides with its own persisted row. Re-saving a trinket
without changing its slug therefore passes. The method is consumed at `L565` and exported at `L651`.

**`Course#updateRole` is a full replace, not an additive grant.** `lib/models/course.js:L138` sets the embedded
`users.$.roles` array to `[role]`, then calls `user.revokeAll('course', { id })`, then `user.grant(role, 'course',
{ id })`. The model operation is therefore symmetric — it can promote as readily as demote.

> **Correction.** An earlier working note described `POST /api/courses/{courseId}/roles` as a *"one-way demotion"*.
> The model operation is not one-way; the **permission** consequence is. `course.updateRoles`
> (`lib/controllers/course.js:L889`) gates on the caller holding `manage-course-access` (`L893`), and
> `lib/models/roles.js` grants that permission to only two roles — `course-owner` (L46) and `course-admin` (L63).
> `course-student` holds `view-course-content` alone. So a user who demotes **themselves** to student loses the
> permission and cannot reverse it through this route, while the course owner still can. The asymmetry is in who may
> call the route afterwards, not in what the route does.

**Serialized `Course` payloads carry `ownerSlug`.** The path is declared `required: true` at
`lib/models/course.js:L13`, populated from `user.username` on creation at `L304` and via `update.$set.ownerSlug` at
`L231`, and whitelisted for public output by `publicSpec` at `L452`. It is consequently part of the observable JSON
surface, and it is what makes the self-copy collision in section 7.5 land on `{_owner, slug}`: the copy takes the
copier's `ownerSlug` but reuses the source `slug` unchanged.

### 7.12 Request-lifecycle and utility mechanics relied on by the converted handlers

**`request.yar._logIn` is a synchronous decoration, and its callback is optional.** It is installed by an
`onPreHandler` extension registered at `app.js:L121`, with the function itself defined at `app.js:L123` (the
explanatory comment sits at `L118`). It performs its work synchronously and invokes its callback with an error
argument that is always `null`, so a converted handler may call it with or without a callback and must not `await`
it expecting asynchronous completion.

**`Store` is a singleton whose methods live on the prototype, and `set` takes exactly two parameters.** Measured:
`typeof Store === 'object'` with constructor name `Store`; `get`, `set`, `del` and `expire` are all absent as own
properties and present on `Store.prototype`; arities are `set` 2, `expire` 2, `get` 1, `del` 1. The arity-2 `set` is
the whole mechanism behind the API-03 quirk — the base commit passed a third callback argument that could never be
invoked, so the follow-on work simply never happened and the request was left unanswered.

**`mailer.isConfigured()` returns the empty string, not `false`.** `lib/util/mailer.js:L12-L15` is
`return mailConfig && mailConfig.from && mailConfig.host;`, and `config/default.yaml` ships `app.mail.from` and
`app.mail.host` as empty strings, so the measured return value is `""` — `typeof 'string'`, falsy. An in-source
comment at `L9-L11` records that callers test it as `if (!mailer.isConfigured())` and that it must therefore not be
coerced to a boolean. Out of the box the mail path is disabled, which is why `mailer.send` returns
`{ skipped: true, reason: 'Email not configured' }` rather than attempting a connection.

**`downloadPostedZip` receives an object map, and double-quotes its filename.** `lib/controllers/trinket.js:L1519`
parses its input as `JSON.parse(request.payload.files || '{}')` — an **object keyed by filename**, defaulting to
`{}`, not an array. Its `Content-Disposition` at `L1648` wraps the filename in **double quotes**
(`attachment; filename="<name>.zip"`), which preserves any spaces in the name. This is deliberately *different* from
`downloadZip` at `L1854`, which emits an **unquoted** `attachment; filename=<shortCode>.zip`. Both header forms are
part of the observable surface and neither was normalised to match the other.

**`GET /change-email` genuinely rewrites the account email.** The route is declared at
`config/api_routes.js:L1346` (`GET /change-email users.changeEmail`, carrying the source's own
`// actually change user email` note). The handler reads the pending value from a `Store` key and assigns
`request.user.email = changeVal.new_email`, so following the link mutates the account rather than merely confirming
an intent. It is recorded here because it is a state-changing `GET` that a reader would not expect to be one.

## 8. The retired shim's response mechanics, and the three fates a failing branch could have

This section is the key to every source comment in `lib/controllers/**` that says *"see docs/PRESERVED-QUIRKS.md"*
without naming a subsection. Those comments are all appeals to the same small set of mechanical rules, derived by
reading the retired compatibility shim's own source at the base commit — `git show 2f8712a:lib/util/routeParser.js`,
specifically L305-L345 (the wrapper), L355-L420 (the synthetic responder and its chainable builder) and L540-L595
(the await and the catch-all). The rules are recorded once here so that 24 separate comments do not have to restate
them, and so that a maintainer can check any one of them against the shim's source rather than trusting prose.

### 8.1 How the shim delivered a response at all

The wrapper at `lib/util/routeParser.js:L310` was `async function(request, h)`. Before calling the legacy handler it
created a **deferred**: a promise plus a captured `responseResolver` (`L332-L335`). It then invoked the handler and,
at `L567-L570`, did:

```javascript
if (result === undefined) result = await responsePromise;
```

So a legacy handler had exactly two ways to answer. It could **return** something the wrapper would use directly, or
it could cause `responseResolver` to be called — which is what the synthetic `reply` and the injected
`request.success` / `request.fail` decorations did. **If neither happened, that `await` never settled and the request
was never answered.** The only timer in the whole path (`L544-L547`) merely wrote
`log.info(... 'still going after 1s')`; `app.js`'s `Hapi.server({...})` configures **no `routes.timeout`**. There was
nothing to convert the stall into a status code.

That is the mechanism behind every "NO RESPONSE" claim in this catalogue, and it is why a naive conversion is
dangerous: under hapi 21 a handler that returns `undefined` gets a **scrubbed 500**, which is a response the base
commit never sent.

### 8.2 The five derived rules

| # | Shape at the base commit | Fate |
|---|---|---|
| **R1** | `reply(plainData)` as a **bare statement**, never chained to a resolving method | deferred never settles → **NO RESPONSE** |
| **R2** | `return reply(plainData)` **from the handler**, or a returned chain that resolves to the builder | the builder is returned to the wrapper → hapi JSON-serializes it → **HTTP 200, `application/json`, body `{}`** |
| **R3** | `reply(x).type(t)` or `.type(t).bytes(n)` with **no** trailing resolving method | never resolves → **NO RESPONSE** |
| **R4** | `request.success(...)` / `request.fail(...)` | resolve the deferred **even when their return value is discarded** → a real response |
| **R5** | a **pre-handler** built by `convertPreHandlers` (`2f8712a:lib/util/routeParser.js:L83-L125`) | its `fakeReply` resolves the wrapper promise on its **first** call; every later `resolve` is a no-op |

**The builder's resolution asymmetry is the whole of R1 versus R2, and it is not obvious.** The chainable returned by
the synthetic responder had **two classes of method**:

- **resolving** — `redirect()`, `code()`, `header()`, `view()`: each called `responseResolver` immediately;
- **non-resolving** — `type()`, `bytes()`: each returned the builder and settled nothing.

So `reply(x).type(t).code(200)` answered, and `reply(x).code(200).type(t)` also answered but applied `.type()` to a
real hapi response object rather than to the builder. `reply(x).type(t)` alone answered **nothing**. Measured on
hapi 21.4.10 against the reconstructed builder shape: every own enumerable property of the builder is a function, so
`JSON.stringify` drops all of them and the wire body is exactly `{}` — which is the measured result behind R2.

**R5 has two consequences that a reader will not guess, and both are load-bearing.** First, `reply()` called with no
argument does `resolve(null)`, so anything chained after it is dead. Second, even a *winning* `.takeover()` resolved
a **plain object** of the shape `{ _isRedirect : true, url, _permanent, _takeover }`, and hapi assigns a plain object
returned from a pre-handler as pre **data** — it is not a response. **A pre-handler could therefore never redirect at
the base commit**, no matter how the chain was written. That is the mechanism behind the course-slug quirk in section
3.12 and behind the `courseBySlug` adjudication in section 13.

### 8.3 The three fates, and what may be reproduced

Every failing branch converted by this changeset was classified into exactly one of three fates, by **reading the
base-commit source of that branch** — never by pattern-matching:

- **Fate (A) — HANG.** Nothing settled the deferral and nothing threw. The client received no response, no status,
  and the server wrote no log entry. Reproduced with `return new Promise(function() {});`. Measured on hapi
  21.4.10: a handler whose returned promise never settles produces **no response and zero server-side log entries**.
- **Fate (B) — PROCESS DEATH plus NO RESPONSE.** Something threw inside a callback that nobody owned — a Mongoose
  callback, a `crypto.randomBytes` callback, a stream `error` handler — or an `async` function was handed to an API
  that discards its return value, producing an **unhandled rejection**. With no `unhandledRejection` and no
  `uncaughtException` handler anywhere in `app.js`, `config/` or `lib/`, Node 22's default mode killed the process
  with exit code 1. The client still received nothing, because the deferral was never settled either.
- **Fate (C) — A REAL RESPONSE.** A responder ran, or a resolving terminator was reached. These branches are
  **verified and left alone**; several were initially suspected of being fate (A) and measurement said otherwise.

**Only the client-visible half of fate (B) is reproduced.** The process is not re-killed. That is a deliberate,
recorded decision with three reasons: crashing a worker is not one of R-1's four sanctioned diff categories;
re-raising would in several cases surface as a **scrubbed 500**, which is a status the branch never sent, violating
R-4 and R-5; and the observable contract at the HTTP boundary — silence — is reproduced exactly. **The single
residual divergence is therefore that the worker now survives where the base-commit process died**, and it is
recorded per site in section 9.

### 8.4 Two measurements that decided cases the rules alone could not

- **`server.inject()` on a never-settling handler never resolves.** Measured with a 1200 ms bound. This matters
  because `lib/controllers/courses.js#create` reaches `lib/controllers/course.js#createCourse` over `server.inject`,
  so a fate-(A) inner handler leaves the **outer** request unanswered too — a cascade that is itself part of the
  baseline. Answering `200 {}` on the inner route would have resolved the inject with a body matching neither
  `.course` nor `.err`, driving the outer handler into a fall-through it never actually reached.
- **A `.then`'s own `onRejected` does not catch a throw raised by its sibling `onFulfilled`.** This is what makes
  several `.then(onFulfilled, onRejected)` sites fate (B) rather than fate (C).

## 9. The no-response and process-fate preservations, site by site

There are **24** places classified below, each reproducing a base-commit no-response outcome by returning a promise
that never settles. The delivered spelling is `lib/http/pending.js` — `Pending.forever()` and its alias
`Pending.hang()`, both of which return `new Promise(function() {})`, which is the inline expression this census
originally recorded before the helper existed. Counting call sites rather than classified branches, the tree
carries **38** `lib/http/pending.js` calls across **seven** controllers (**20** `forever`, **9** `hang`, **9**
`rejectOrHang`); the 24 rows below cite **25** of them, because `downloadExport` needs two. The other **13** are
the 9 `rejectOrHang` sites — transparent on every non-raising path, so they are failure responses rather than
hangs wherever the baseline had one — plus `courses.js` L136 and L361, the ignored copy and `fs.stat` errors
whose dereference twins are rows 8 and 9 here, and `auth.js` L151 and L175, the two provider-payload branches
adjudicated in section 3.37. All 13 are in [section 6.2](#62-the-table). Each row below was classified by reading that branch at the base commit. The
"residual divergence" column is empty for fate (A), because a hang is reproduced exactly; for fate (B) it is always
the same single divergence described in section 8.3.

| File | Site | Handler | Fate | Base-commit mechanism |
|---|---|---|---|---|
| `lib/controllers/course.js` | L56 | `createCourse` | A | builder returned to Mongoose's `save` callback, which discards it (R1) |
| `lib/controllers/course.js` | L161 | `updateCourse` | A | same shape as `createCourse` |
| `lib/controllers/course.js` | L252 | `copyCourse` | A | builder returned to `Course#copy`'s error-first callback |
| `lib/controllers/course.js` | L327 | `updateLesson` | B | callback ignored `err`, then read `course.id` → `TypeError` in an unowned callback |
| `lib/controllers/course.js` | L361 | `moveLesson` | B | identical to `updateLesson` |
| `lib/controllers/course.js` | L725 | `userLookup` | A | `if`-chain fall-through; nothing settled the deferral |
| `lib/controllers/courses.js` | L68 | `create` | A | unknown-failure fall-through |
| `lib/controllers/courses.js` | L143 | `copy` | B | `TypeError` plus an unterminated inner chain |
| `lib/controllers/courses.js` | L378 | `download` | B | `fs.stat`'s `err` ignored, then dereferenced |
| `lib/controllers/folders.js` | L117 | `create` | B | `request.catch` is **undefined** → `TypeError` on the duplicate-name path |
| `lib/controllers/folders.js` | L130 | `create` | A | unknown save-error fall-through (R3: `.type()`/`.bytes()` never settled) |
| `lib/controllers/admin.js` | L277 | `updateUser` | A | falsy `payload.roles` fall-through |
| `lib/controllers/trinket.js` | L991 | `email` | A | bare `recaptcha.verify(...)` statement plus an argument-less `reply()` |
| `lib/controllers/trinket.js` | L1180 | `draft` | B | unhandled rejection from the zip path |
| `lib/controllers/trinket.js` | L1280 | `autosave` | B | bare `zip.loadAsync(...)` statement → unhandled rejection |
| `lib/controllers/users.js` | L406 | `sendPassReset` | B | `async` callback handed to an API that discards it → unhandled rejection |
| `lib/controllers/users.js` | L515 | `savePassword` | B | same shape, on `Store.del` |
| `lib/controllers/users.js` | L912 | `assetUploadFromURL` | B | `.on('error')` only logged; a write-side error was not forwarded by `.pipe()` |
| `lib/controllers/users.js` | L1089 | `sendEmailChange` | A | arity-2 `Store.set` never invoked the third callback → **no email and no response** |
| `lib/controllers/users.js` | L1198 | `sendEmailVerification` | B | rejection arm only; the happy path still answers 200 |
| `lib/controllers/users.js` | L1345 | `activateAccount` | B | `Store.del` rejection inside a discarded `async` callback |
| `lib/controllers/users.js` | L1532 | `getExportStatus` | B | undeclared `Boom` → `ReferenceError` in an unowned callback |
| `lib/controllers/users.js` | L1544 | `getExportStatus` | B | the second of the two, so exactly **one** log line prints per request |
| `lib/controllers/users.js` | L1614 and L1648 | `downloadExport` | B | four undeclared-`Boom` branches, an `_owner.toString()` `TypeError`, and the presigner throw |

**The complement matters as much as the list.** Six sites that look identical to the rows above were measured as
fate (C) and are therefore **left answering a real response**:

- `lib/controllers/course.js#archiveCourse` — the opposite resolution. Its chain **is** returned, so a failure
  really did answer; the fix here was `.catch(function() { return undefined; })` followed by
  `request.success({ course : course })`, not a never-settling promise. The census row that originally flagged it was
  a 22-line-lookahead artifact.
- `lib/controllers/course.js#updateInvitation` (`h.response({})` at L1048) — fate (C) **because the chain is
  returned**, which is R2 rather than R1. An argument-less `h.response()` would emit an empty body instead of `{}`,
  so the empty object is explicit.
- `lib/controllers/trinket.js#snapshot` (L1012), `#downloadMain` (L1382), `#downloadFile` (L1430 and L1450) and
  `#downloadPostedZip` (L1672) — five endpoints whose base-commit `reply({ status : "success" })` was
  builder-serialized to **`200 application/json {}`**. The `{ status : "success" }` payload has never reached a
  client, so it is **not** restored.
- `lib/controllers/trinket.js#autosave` — the only site where a single branch had to be **split by fate**. When the
  posted code is an `Error` instance the base commit had already sent its scrubbed 500 (fate C, so the `Error` is
  returned); when it is a non-JSON string the branch fell through silently (fate B, so the never-settling promise is
  used). Answering one way for both arms would have been wrong in one of them.

**Two ordering details inside `courses.js#download` are preserved deliberately**, because they are observable in the
filesystem even though the request is never answered: the cleanup still runs, and the doomed read stream is still
never opened.

**Failure-path parity is tested, not just asserted.** `test/lib/util/no-response-fate.js` carries **10** tests that
assert the no-response outcome *without* hanging the suite, and every one of them was **mutation-proven** — the
assertion was shown to fail when the branch is changed to answer a status.

## 10. The undeclared-`Boom` scrubbed 500s: 61 call sites that never returned the status they name

**What it is.** Five controllers call `Boom.forbidden()`, `Boom.notFound()` and friends **without `Boom` being
declared anywhere in the module**. Every one of those calls raises `ReferenceError: Boom is not defined`, which the
shim's single catch-all converted into `Boom.badImplementation(...)` — a **scrubbed 500**. Not one of them has ever
produced the 403 or 404 it appears to request.

**Evidence, measured.** `lib/controllers/course.js:L3` binds the package as `errors`:

```javascript
errors = require('@hapi/boom'),
```

and that alias is then **never used**. `Boom` is not a Node global and is not assigned by `app.js`, so in module
scope `typeof Boom === 'undefined'` and `Boom.forbidden()` throws. The shim's catch-all at
`2f8712a:lib/util/routeParser.js:L578-L589` caught it and returned `Boom.badImplementation(err.message)` — using its
*own* correctly-declared `Boom` from `L6`.

The census, counted over code lines only, excluding comments:

| File | Undeclared-`Boom` call sites | Base commit |
|---|---:|---|
| `lib/controllers/course.js` | 41 | 41 — unchanged |
| `lib/controllers/users.js` | 15 | 15 |
| `lib/controllers/admin.js` | 2 | 2 |
| `lib/controllers/folders.js` | 2 | 2 |
| `lib/controllers/courses.js` | 1 | 1 |
| **total** | **61** | |

**Why it is preserved.** R-4, and R-5 more sharply. Adding a `Boom` require, or rebinding these onto the existing
`errors` alias, would silently convert **61** scrubbed 500s into 403s and 404s — a status-code change on 61 paths,
which is precisely the "improvement" the rules forbid and exactly the kind of mapping change R-5 exists to prevent.
The 5xx message text is invisible either way, because hapi replaces any 5xx message with the fixed string, so there
is no observable upside even to a "harmless" repair.

**What a naive fix would have broken.** Any of these 61 paths that a client currently treats as a server error would
begin returning a client error, changing retry behavior and, on the HTML surface, swapping `50x.html` for a different
rendering — `app.js`'s first `onPreResponse` renders 500 and above as `50x.html`, and a 403 as `50x.html` with status
403, while a 404 renders `404.html`.

**The one place `Boom` *is* declared, and why that is not an inconsistency.** `lib/util/helpers.js` declares it and
uses it at 29 sites, and those really do produce their stated statuses. `lib/http/errorMap.js`,
`lib/http/preHandlers.js` and `lib/http/responseContract.js` declare it too, because they are the relocated shim
internals and the shim declared it. The asymmetry between the helper layer and the controller layer is itself
base-commit behavior.

## 11. `lib/util/legacyUrl.js` — a faithful port of the deprecated parser, not a WHATWG substitution

**What it is.** A new shared module, `lib/util/legacyUrl.js` (607 lines), exporting `pathname(input)` and the same
function under the alias `legacyPathname(input)`, which is the name the `lib/` call sites use. It reproduces
the **legacy** `url.parse(...).pathname` derivation exactly, and it exists because neither of the two obvious
replacements is behavior-preserving.

**Why the obvious replacements fail.** `new URL(x)` **throws** `ERR_INVALID_URL` on the relative, protocol-less and
empty inputs the legacy parser tolerated. The non-throwing static `URL.parse(x)` returns **`null`** on those same
inputs, so a mechanical swap converts "an object with a non-null pathname" into "a `TypeError` on the next property
read" — a working response becoming a 500. Section 3.13 records the two genuinely unguarded call sites where that
would have happened.

**Why a *narrower* claim had to replace the original one.** An earlier revision of the source comments claimed
"0 differences over a 70-input fixture set". A 46-input differential against `require('url').parse(x).pathname`
found **two real differences**, so the claim was false at the sample size it cited:

- **opaque schemes** — `urn:example:test` → the legacy parser yields pathname `/:test` and basename `:test`; the
  first draft helper returned `null`, and `path.basename(null)` **throws**;
- **the `autoEscape` set** — `http://a.com/pipe|name.png` → the legacy parser percent-encodes to
  `/pipe%7Cname.png`; the first draft left the `|` literal.

The root causes are precise and worth recording, because they are exactly the places a WHATWG-based port goes wrong:
the legacy `autoEscape` set is `{ } | \ ^ \` < > " SP \r \n \t`, whereas WHATWG **omits** `|` and `^` and **strips**
`\r\n\t`; and the legacy parser runs its host-validation fallback for **non-slashed** protocols such as `urn:`,
re-prepending the rejected host text to the path.

**The delivered helper is a port of the algorithm, not an adapter over `URL`.** It reproduces the protocol split, the
hostless-versus-slashed-protocol handling, the auth strip, the `nonHostChars` host-end scan, the hostname-part
fallback that re-prepends `notHost`, the `autoEscape` set, the hash and query trim, and the slashed-protocol
empty-path `'/'`.

**Evidence, and the honest size of it.** `test/lib/util/legacy-pathname.js` (631 lines, **7** tests) is a committed
differential suite that compares the helper against the deprecated parser over **2,022,153 inputs** and finds
**zero** pathname differences and **zero** `path.basename` differences, including the throw-versus-value cases. The
suite is guarded and needs neither a database nor the application. Where the JSDoc states a domain, it states the
domain the suite actually proves.

**A positive migration result, recorded because it is easy to lose.** Under `node --pending-deprecation` the
**oracle** — `require('url').parse` — emits DEP0170, and the helper emits **nothing**. So the deprecation the
migration set out to remove really is removed at the call sites, and the only remaining emitter is the test's own
reference implementation.

**Consumers.** `lib/controllers/trinket.js` (required at L35; called at L1468, L1588, L1800),
`lib/workers/exports.js#assetPathBasename` (required at L11; called at L47 — aligned with the same contract so the
two layers cannot diverge on opaque schemes), `test/helpers/flow.js` (L6, L433) and `test/lib/api/registration.js`
(L10, L103). Three rival implementations were retired in favour of this one, each by differential rather than by
argument: two per-file lexical approximations and one 76-line lexical helper, the last of which diverged on 30,860
pathnames and 30,860 basenames over 376,320 inputs where this module diverges on none.

## 12. Streaming, SSRF, and three inherited risks — one overridden, two accepted

### 12.1 `assetUploadFromURL` streams, and the SSRF exposure is inherited rather than introduced

**What changed and why it is not a behavior change.** `lib/controllers/users.js#assetUploadFromURL` previously
buffered an entire remote response through `response.arrayBuffer()` before writing it. It now streams:

```javascript
await pipeline(stream.Readable.fromWeb(response.body), fs.createWriteStream(tmpPath));
```

with an explicit branch for a **null body** that writes an empty temp file, so a 204 keeps the upload attempt
reachable exactly as before. The bytes written are identical — measured **sha256-identical** on a 64 MiB body — so
no observable behavior moves.

**The measured reason.** For a 64 MiB remote body: buffered, **RSS grew 224.6 MiB**; streamed, **heap grew 3.5 MiB
and RSS 56.6 MiB**. That is the CWE-400 memory-exhaustion exposure the review identified, and "bounded" here means
bounded **memory**, not a byte cap.

**No total-bytes cap was added, deliberately.** The base commit imposed none. Adding one would reject uploads the
application currently accepts, which is a behavior change R-4 forbids. The bound that *was* added is the one that
changes nothing observable.

**The SSRF policy, stated explicitly because the review required a decision rather than silence.** This endpoint
fetches an **arbitrary authenticated-user-supplied URL** from the server. The decision is to **inherit the
base-commit posture unchanged and disclose it**:

- **no protocol allow-list** — whatever `fetch` accepts is accepted;
- **no host or IP deny-list** — link-local and private ranges are not blocked;
- **no redirect policy** — `fetch`'s default redirect following is used, so the final origin may differ from the
  requested one;
- **only the response body is stored**; no status, header or timing information is echoed back to the caller.

Adding any of those controls would reject fetches the application currently performs — a behavior change, and one
that is not attributable to any of R-1's four sanctioned categories. The exposure is therefore **accepted, recorded
here, and left for a change whose mandate includes it**. Streaming does not reduce the SSRF surface; it removes the
memory amplification of it, which is the part that could be fixed without changing what the endpoint accepts.

**Its failure path is a preserved fate (A).** The base commit's only handler was
`.on('error', function (err) { console.log('on error:', err); })`, which logged and returned; `.on('end')` held the
sole responder and never fires after a read error. So a fetch or read failure produced **no response**. The log line
is preserved verbatim and the never-settling promise reproduces the silence; re-throwing would answer a scrubbed 500
this branch has never sent. `test/lib/util/asset-url-streaming.js` carries **4** mutation-proven tests over the
streaming contract.

### 12.2 `bull` → `uuid`: overridden, because a compatible fix was measured to exist

**The advisory.** GHSA-w5hq-g745-h8pq, moderate, CWE-787 / CWE-1285, CVSS 7.5: *missing buffer bounds check in
`v3`/`v5`/`v6` when `buf` is provided*, affecting `uuid < 11.1.1`. It reached the production tree transitively —
`bull` declares `uuid ^8.3.0` and the lock resolved **8.3.2**.

**Unreachability, measured first.** `bull` 4.16.5 uses `uuid` at exactly **three** call sites, all `uuid.v4()` with
**zero arguments**: `node_modules/bull/lib/queue.js:120`, `node_modules/bull/lib/queue.js:1412` and
`node_modules/bull/lib/timer-manager.js:74`. There are **no** `v3`, `v5` or `v6` call sites in `bull` at all, and no
argument is ever passed, so the vulnerable code path cannot be reached through it. The repository itself contains
**zero** direct `require('uuid')` — `node-uuid` was removed as an unused declaration (see the dependency inventory) —
and `require('bull')` is **lazy**, at `lib/util/queues.js:L111`, reached only when redis is enabled and the queue is
not one of the nine hard-disabled names, which leaves `exports` as the only live queue.

**Why it was nevertheless fixed rather than merely accepted.** `npm audit fix` offers only `bull@1.1.3` — a
**downgrade** across three majors, which is a regression, and that is the fix the plan recorded as unacceptable. But
an `overrides` entry is a different instrument, and the manifest already uses it for `brace-expansion` and
`minimatch`. Measured before adopting it:

- `uuid@11.1.1` ships a **real CommonJS build** at `./dist/cjs/index.js`, exposed through the `require` condition
  nested under `node` in its `exports` map (`exports["."].node.require`) — verified by resolution rather than by
  reading the map: `require.resolve('uuid')` lands on `node_modules/uuid/dist/cjs/index.js`, whose first line is
  `"use strict";` followed by `exports.` assignments. So `require('uuid')` from CommonJS does **not** depend on
  `require(esm)`. The declared engine range is `>=22.12.0 <23.0.0`, which is at or above the release that unflagged
  `require(esm)` anyway, so this package would have resolved on any Node 22 rather than depending on that floor. The
  package's own `"type"` is `"module"` and its `"default"` condition is the ESM browser build, which
  is exactly why the resolution had to be measured rather than assumed;
- `uuid@11.1.1` declares **no `engines`** and **no dependencies**;
- exactly **one** package in the tree depends on `uuid` (`bull`), so the override has a single blast radius;
- with the override in place, `require('bull')` loads, `new Queue(name, { redis : { host, port } })` constructs,
  `queue.token` is a valid v4 UUID, and `queue.close()` resolves cleanly.

**The delivered change and its exact effect.** `"uuid": "11.1.1"` added to `package.json#overrides`. The lockfile
delta is **one entry** — `node_modules/uuid` 8.3.2 → 11.1.1 — with **nothing added and nothing removed** (466 package
entries before and after). `npm ci` exits 0 and reproduces it. Production audit went from **3 moderate** to **1
moderate**, still 0 critical and 0 high. No repository source file was touched, so nothing in R-4's scope moved.

### 12.3 `highlight.js` 9.18.5 ReDoS: reachable, held by an explicit AAP rule, accepted with evidence

**The advisory.** GHSA-7wwv-vh3v-89cq, moderate, CWE-20 / CWE-400: *ReDoS vulnerabilities, multiple grammars*,
affecting `>= 9.0.0 < 10.4.1`. Installed: **9.18.5**, a **direct** dependency. This is the one advisory that remains
on `npm audit --omit=dev`.

**Reachability, measured — it is real, and it is narrow.** Exactly one server-side path reaches it:

```text
lib/shared/trinket-markdown.js:L413   hljs.highlight(lang, code)          [delivered frame throughout]
  guarded by                           L412  else if (hljs && hljs.getLanguage(lang))
  reached only from                    lib/controllers/courses.js:L287  parser(info.content)
    inside                             download()  (defined at L198), and only when format === "html" (L273)
  bound to exactly one route           GET /{userSlug}/courses/{courseSlug}/download.zip
    auth                               "session"  → authentication REQUIRED
    pre-handlers                       3
```

`lang` is the fenced-code-block language from author-supplied markdown, and 185 grammars are bundled, so any of them
can be selected. `code` is course material content. The path is therefore reachable, but only by an **authenticated**
caller on a single non-API route.

**How large the exposure measured.** A probe over **all 185 bundled grammars × 8 pathological repetitive payloads**
recorded a worst single-`highlight()` wall time of **42.6 ms** (`lsl`) with a **median of 1.03 ms**. Scaling the
worst payload showed the cost is **linear**, not catastrophic: `lsl` took 0.3 ms at N=200 and 2.7 ms at N=1600, which
identifies the larger N=100 figures as first-call grammar-compilation cost rather than backtracking. **This is not a
proof of unexploitability** — the advisory's specific vectors could not be identified, because no network access was
available to read it — and it is recorded as a sizing measurement only.

**Why the version is held.** The AAP freezes it. Its "Deliberate Holds" table holds `highlight.js` at 9.18.5, its
design-system section records the browser/server skew as *"Deliberate version skew, preserved"*, and its audit-gate
section accepts this finding explicitly because *"the offered fix changes client-visible markup"*. Under the AAP's
own precedence rule an explicit AAP hold outranks an advisory-driven bump, so the version does not move.

**Measurement confirms the AAP's reason, and corrects one detail of it.** A differential of 9.18.5 against **10.4.1**
— the first version *outside* the advisory range — over 15 languages found **6 with differing HTML output**, and for
**`r`, a shipped trinket language**, the emitted class **set** differs: 10.4.1 adds `hljs-built_in`. Grammar count
also moves, 185 → 190. So bumping really would change client-visible markup on R course pages. The AAP's narrower
claim that *the `highlight()` signature changed at version 10* is **not** what blocks it: 10.4.1 still accepts the
positional `highlight(lang, code)` form used at `lib/shared/trinket-markdown.js:L310`, and the object form
`highlight(code, { language })` is additive. It is the markup, not the signature. Bumping only the server copy would
also **widen** the deliberate browser-versus-server skew of section 2, since `config/default.yaml` independently pins
the browser copy at 8.0.

**The decision.** The ReDoS exposure is **explicitly accepted**, on the record, with the reachability path, the
authentication requirement, the sizing measurement and the blocking constraint all stated above. No input or resource
control was added, because every available control — a code-block length cap, a grammar allow-list, a worker timeout
— would reject or alter renderings the application currently produces, and none is attributable to R-1's four
sanctioned categories. Re-evaluation belongs in a change whose mandate includes altering rendered markup.

**One thing this advisory does *not* do.** Requiring `highlight.js` prints an end-of-life notice, but it fires
**zero** `process.on('warning')` events — measured — so it does not trip the zero-deprecation-warning boot gate.

### 12.4 `node-config` destroys the nunjucks loader's prototype unless `NODE_CONFIG_PERSIST_ON_CHANGE=N`

**Citation frame:** delivered tree, except where a `2f8712a:` prefix appears.

**The symptom.** A long-lived server started without `NODE_CONFIG_PERSIST_ON_CHANGE=N` answers **HTTP 500
`application/json`** on *every* HTML route, logging:

```text
Nunjucks render error for template: static/about.html
Error: loader.getSource is not a function
    at node_modules/nunjucks/src/environment.js:276
```

Static assets and the `/.well-known` 404 are unaffected — `GET /css/base.css` still answers `200 text/css` and
`GET /.well-known/probe` still answers 404 — so routing, Inert and the route table are all intact. Only view
rendering fails.

**The mechanism, measured end to end.** Four steps, none of which involves nunjucks' file watcher:

1. `app.js:L38` executes `config.viewEngine = viewEngine;`, attaching `lib/util/nunjucks.js` — whose export object
   ends with `env : env` — onto the **live** `config` object.
2. `node-config` 0.4.37 installs property watchers in `_persistConfigsOnChange()`
   (`node_modules/config/lib/config.js:L119`), which returns immediately **only** when
   `NODE_CONFIG_PERSIST_ON_CHANGE === 'N'` (`node_modules/config/lib/config.js:L596`). Otherwise, the first
   change to a key that existed at load time makes it compute `_diffDeep(originalConfig, t)` and write the result
   to `config/runtime.json`. The measured top-level keys of that file are
   `url, constants, isDev, isProd, isTest, sandboxUrl, routes, viewEngine` — so it serialises the nunjucks
   `Environment`, and `viewEngine.env.loaders[0]` survives the round trip as
   `["_events","_eventsCount","pathsToNames","noCache","searchPaths","cache"]`: every own property, no prototype.
3. `node_modules/config/lib/config.js:L1410` runs `global.NODE_CONFIG.watchForConfigFileChanges()` at module load.
   Its `onFileChange` (`node_modules/config/lib/config.js:L477-L490`) reads `runtime.json` back and calls
   `t._extendDeep(t, configObject)`.
4. `_extendDeep` (`node_modules/config/lib/config.js:L1178-L1215`) reaches
   `mergeInto[prop] = t._cloneDeep(mergeFrom[prop], depth - 1)` at
   `node_modules/config/lib/config.js:L1207` and **replaces** `config.viewEngine.env.loaders` with the plain-object
   clone. A trap installed on the array's setter captured exactly that assignment, with the stack — quoted verbatim,
   so its `config.js` frames are the same `node_modules/config/lib/config.js` cited above:
   `Environment.set [as loaders] <- config.js:L1207 <- Array.forEach <- Config._extendDeep (config.js:L1195)`.

The healthy state, for comparison, is `loaders[0] ctor=FileSystemLoader getSource=function
searchPaths=["lib/views/"]`; the broken state is `loaders[0] ctor=Object getSource=undefined`.

**The trigger is the environment variable, not the watcher.** Three real-app boots, each in the foreground with a
captured PID, each probing `GET /about`:

| Boot mode | `config/runtime.json` | `GET /about` | `getSource` errors logged |
|---|---|---|---|
| development, `PERSIST_ON_CHANGE` unset | 55,412 bytes | **500** `application/json` | 3 |
| development, `NODE_CONFIG_PERSIST_ON_CHANGE=N` | 2 bytes (`{}`) | **200** `text/html` | 0 |
| `NODE_ENV=production` (nunjucks `watch:false`) | 55,413 bytes | **500** `application/json` | 2 |

The third row is the decisive one: production sets `config.isProd`, so `lib/util/nunjucks.js:L8` configures
`watch:false` and `app.js` sets `isCached: true` — and the failure still occurs. An earlier hypothesis that this was
a `chokidar` race was **disproved** by hitting `/about` at t=+64 ms, +3.07 s, +6.07 s, +9.08 s and +12.08 s on an
in-process boot: `200 text/html`, 13,534 bytes, every time.

**It is inherited, not introduced.** Every ingredient is byte-identical at the base commit:

| Ingredient | Base | Delivered |
|---|---|---|
| `config.viewEngine = viewEngine;` | `2f8712a:app.js:L43` | `app.js:L38` — identical text, shifted only by the `Promise.prototype` deletion of section 3.14 |
| `env : env` export | present | present, identical |
| `nunjucks.configure(..., {watch: …})` | `2f8712a:lib/util/nunjucks.js:L8` | `lib/util/nunjucks.js:L8` — byte-identical |
| the six `config.<key> = …` assignments | `2f8712a:config/app.config.js` | `config/app.config.js` — **zero diff from base** |
| resolved `config` version | base lockfile: **0.4.37** | current lockfile and installed tree: **0.4.37** |

The base commit cannot be booted in this environment — `2f8712a:lib/util/routeParser.js` requires the removed
`tab` and `optimist` — so base identity is established structurally, from the table above, rather than by replaying
the failure on the base tree. Minimal-ingredient probes additionally established that the mechanism needs a key that
existed **at load time** to actually change value, because `Config.prototype.watch(o, null, handler)` derives its
watch list from `Object.keys(o)` at `node_modules/config/lib/config.js:L158-L162`; adding a brand-new key such
as `viewEngine` is not itself the trigger, it is merely what gets swept into the diff once the trigger fires.

**The decision: preserved and documented, not repaired.** Three independent constraints point the same way. R-1
confines the diff to four categories, and none of them covers latent-bug repair. R-4 requires that a defect clients
may depend on be preserved and catalogued. R-6 makes base behaviour the tie-breaker, and the mechanism is
byte-identical at base. Independently, the AAP holds `config` at 0.4.37 on purpose — 43 consumers, plus the harness's
reliance on its `NODE_CONFIG_*` semantics — so bumping the package is also out of bounds. Detaching the view engine
from `config`, deep-freezing it, or re-pointing `app.js:L138` at a private handle would each be a behavioural change
to the composition root.

**Why the test suite and the parity harness never saw it.** `test/setup.js:L2` and `test/baseline/capture.js:L207`
both set `NODE_CONFIG_PERSIST_ON_CHANGE = 'N'` before `config` is required. That is why `npm test` passes and
`test/baseline/replay.js` reports zero differences while a bare `node app.js` returns 500 on every page. Both
baseline artifacts already record that capture mode verbatim — `test/baseline/route-table.json` and
`test/baseline/responses.json` each state that `NODE_ENV=test` and `NODE_CONFIG_PERSIST_ON_CHANGE=N` were exported
for the capture process. The R-6 evidentiary mode therefore *is* the `=N` mode, and any runtime validation of the
frozen client surface must use it — not to mask the defect, which is catalogued here, but because that is the mode
the frozen corpus was captured in.

**Operational hazard worth knowing.** `config/runtime.json` is gitignored (`.gitignore:L16`), so it is never
committed. But it is also the **last** config source `node-config` loads, so a stale 55 KB file left behind by one
development-mode boot is merged into `config` on every later boot — including test-mode boots — carrying a
serialised route table and a prototype-less `viewEngine` with it. Delete it after any development-mode run.

## 13. The test-suite restoration adjudications

The suite did not run at the base commit: it exited 1 on its first module load. Everything in this section is
therefore an R-6 judgement made **without** a baseline for the suite itself, resolved against the baseline of the
**application** wherever one existed. In every case the rule was the same: *align the test to the measured
application behavior, never the reverse.* No assertion was weakened to make a test pass.

### 13.1 Two Mocha load-order landmines, one of which could have destroyed the development database

**Landmine 1 — the spec glob.** Mocha 11 collects spec files **alphabetically**, so `test/setup.js` loaded **last**.
`test/setup.js` is what sets `NODE_ENV=test`. `test/helpers/db.js` connects on load and **drops the database it
connects to** — so with the alphabetical order, it would have connected to and dropped the **development**
database. The fix is one key: `"require": "./test/setup.js"` in `.mocharc.json`, which loads it before any spec.
This is why `.mocharc.json` now carries five keys rather than the four described in section 3.8.

**Landmine 2 — CLI `--require` runs before the config `require`.** Measured: a file passed as `--require` on the
command line loads **before** the `.mocharc.json` `require` file, so a diagnostic file added that way saw
`NODE_ENV=undefined` and booted `app.js` in **development** mode — proven by the `Server started on port: 3000`
line — which enabled `lib/util/nunjucks.js:L8`'s `watch : true` and produced a spurious
`loader.getSource is not a function` from a chokidar race. The rule adopted for the rest of the work: **every
CLI-required diagnostic file sets `process.env.NODE_ENV = 'test'` on its first line.** The `loader.getSource` error
was a diagnostic artifact, not a defect: two consecutive clean runs produced zero occurrences.

### 13.2 The root-hook plugin, and the lazy supertest agent

`test/setup.js` now exports a Mocha **root hook plugin** (`module.exports = { mochaHooks : { beforeAll } }`) that
awaits the promise `app.js` exports, so the nine sloppy-mode model globals exist before `--check-leaks` takes its
snapshot and before `global.Interaction` is stubbed.

`test/helpers/flow.js` could not attach at all: `app.js` exports a **Promise**, so `app.listener` was `undefined` and
`supertest(undefined).get('/')` threw `TypeError: Cannot read properties of undefined (reading 'address')`. The
resolved server is captured via `app.then(...)` and the agent is built **lazily** through a new `agentFor(flow)`
accessor, with the constructor setting `this.agent = null`. Top-level `await` is unavailable in CommonJS — which
CommonJS must remain, for the sloppy-mode reason recorded in the plan — so laziness is the mechanism.

### 13.3 Sinon 22 removed or redefined three things the suite used

| Base-commit form | Status in Sinon 22 | Delivered form |
|---|---|---|
| `sinon.stub(obj, 'm', fn)` | removed in Sinon 3 | `sinon.stub(obj, 'm').callsFake(fn)` |
| `spy.reset` | **removed**, now `undefined` | `resetHistory()` |
| `stub.reset()` | now clears **behaviour** too | `resetHistory()`, or `callsFake` would be discarded |
| `sinon.stub(obj, 'missing')` | **throws** `TypeError` | forced the catbox stub target correction of section 3.7 |

Both censuses were taken against the base commit rather than estimated. The three-argument form appears at **6**
sites — `test/setup.js:L18`, `test/helpers/catbox-redis.js:L6`, `test/helpers/queue.js:L8` and
`test/lib/models/trinket.js:L34`, `L39` and `L155` — and `.reset()` appears at **6** sites, four in
`test/lib/models/plugins/paginate.js` and two in `test/lib/models/trinket.js`. All twelve are converted; a
re-census finds **zero** three-argument `sinon.stub` calls and **zero** `.reset()` calls in test code.

### 13.4 The `redis-mock` double was the real registration blocker

**Measured.** The installed `redis` is **4.7.1** — promise-returning, camelCase, behind an explicit `connect()`. The
installed `redis-mock` is **0.56.3**, a node_redis **v3** double: no `connect`, no `isOpen`, no camelCase commands.
`config/redis.js:L51` swallows the connect failure and `lib/util/store.js:L152-L178` **caches the rejected client
promise forever**, so every `Store.*` call rejected and `POST /users` answered its failure redirect.

**Resolved in `test/setup.js` only**, with a `createRedisMockV4Client` adapter: `connect`, `isOpen`, `quit`, `on`,
plus a promisified command map covering `del, exists, expire, get, hGet, hGetAll, hSet, incr, keys, lIndex, lPush,
lRange, lRem, rPush, sAdd, sIsMember, sMembers, sRem, set`. One coercion is required and is the kind of detail that
silently breaks a test: v3 `SISMEMBER` answers `0`/`1` while v4 answers a **boolean**, and
`lib/controllers/users.js:L61-L62` looks the domain up and then tests the reply for truthiness directly — so
`sIsMember` is coerced in the adapter. No production file changed.

### 13.5 `test/helpers/db.js`: a latent base defect, not a migration regression

Section 3.16 recorded that this file was expected to need **no** change. It needed one, for a reason unrelated to
mongoose: `underscore` 1.13.8's `_.bindAll` produces arity-**0** `restArguments` wrappers (measured: bound
`length === 0`, unbound `1`, native `.bind` `1`), and Mocha decides whether a hook is asynchronous from `fn.length`
(`node_modules/mocha/lib/runnable.js:42`). So `done` was never passed and the hook threw
`TypeError: done is not a function`. The **base** lockfile also pinned `underscore` 1.13.8, so this is a **latent
base-commit defect** that only became visible once the suite could run. Fixed by replacing `_.bindAll` with
`DB.prototype.<m>.bind(this)`, restoring `length === 1` while keeping the methods own properties.

### 13.6 `mailer.isConfigured` had to be stubbed, or the mail suites tested the wrong branch

Every mail-sending handler is fronted by `if (!mailer.isConfigured())` — seven guards, at
`lib/controllers/users.js:L342`, `L1032`, `L1092`, `L1167`, `lib/controllers/course.js:L845`, `L899` and
`lib/controllers/trinket.js:L898` — and that guard is byte-identical at the base commit. Frozen
`config/default.yaml` ships `app.mail.from` and `app.mail.host` as **empty strings** with no test override, so
`sendPassReset` short-circuited to its "Email is not configured" flash and `Store.set` was never called. Resolved in
`test/helpers/mail.js` by stubbing `isConfigured` to return a host **string**, not `true`, because
`lib/util/mailer.js:L20-L23` returns the raw truthiness expression rather than a boolean. That single change took the
`forgot_pass` subset from 11 passing / 5 failing to 15 / 1.

### 13.7 The R-6 test adjudications, each measured against the application

Fixtures and expectations were corrected to the measured behavior of the frozen application. Each one is a case where
the test, not the application, was wrong.

- **`outline=yes` was never valid.** Measured against **both** joi 17.13.3 and joi 18.2.3: `'yes'` is rejected with
  the byte-identical message `"outline" must be a boolean`, and `'true'` is accepted and coerced. The real browser
  client sends `{ outline : true }` (`public/js/courseEditor/course.js:15`, `root.js:147`,
  `materialControl.js:91`, `classPage/app.js:57`). The fixture became `?outline=true`, taking the API subset from 28
  failures to 20.
- **`hasRole('trinket-code')` was never true for a fresh user.** A freshly saved user's roles are
  `[{ context : 'site', roles : ['user'], permissions : [16 entries] }]`; `hasRole('user')` is true,
  `hasRole('trinket-code')` is false, and `hasPermission('create-python-trinket')` is true. Six expectations
  corrected to `hasRole('user')`, the describe block renamed, and the stale trailing comment corrected.
- **`shortCode` is 12 characters, not 10.** Production `hashify` uses 12 and is byte-identical to the base commit.
- **The `findById` doubles did not match the real contract.** Measured: `findOne` receives exactly **one** argument,
  `{ shortCode : 'abc123' }`, and the callback receives `(null, 'foo')`. The doubles became promise-returning spies
  asserted with `calledWithExactly(query)`. `findByIdAndUpdate` takes `(id, update, options)` and returns a promise;
  `interaction.save()` takes **no** arguments; and `Promise.prototype.done` is `undefined`, so two trailing
  `.done(done)` calls became `.then(function () { done(); }, done)`.
- **`courseBySlug`'s alias branch leaves `request.pre.course === null`**, and all five consumers dereference it
  immediately, so the measured results are 500 — `viewClass`, `coursePage` and `download` as 1600-byte `text/html`,
  `getClass` as 96-byte `application/json`. This is R5 from section 8.2 in action: a pre-handler could not redirect.
  The stale-slug test now asserts the measured 500, and a **false** claim of "200 with no Location header" that had
  been written into `lib/util/helpers.js` was corrected.
- **`POST /file` multipart answers 415 at both hapi versions.** Measured at 20.3.0 **and** 21.4.10, with the
  `multipart` token absent from the route options at both commits, so the 415 is **inherited**, not introduced. The
  two download counterparts answer 404 because the upload never produced a file.
- **`/api/` paths answer 401 and never 302.** `app.js:L152-L201`'s `isApiRequest` predicate is true for any `/api/`
  path, so the takeover redirect cannot apply. Four logged-out course tests now assert 401 plus the **absence** of a
  `Location` header; the 302-to-`/login` contract remains covered on the HTML surface by the files and logout suites.
  A `flow.lastRedirect` assertion that appeared to contradict this was reading **stale** state from an earlier
  request.
- **`GET /welcome` is a relative 302 to `/home` with an empty body**, and `lib/views/welcome.html` does not exist.
- **`{{ course.name }}` in `lib/views/classes/view.html:42` is inside a `{% raw %}` block** (L30-L46), so it is an
  Angular client-side binding, not server-rendered output. The genuinely server-rendered marker on that page is
  `ng-init` at L29, which is what the slug test now asserts.
- **`serialize` returns `[]` unconditionally for every array key in `publicSpec`** (`lib/models/model.js`, byte-
  identical at base), so the delete tests assert `.should.eql([])`, which is strictly stronger than
  `should.not.exist`.
- **A same-lesson material reorder answers 500.** `internals.findById(id, optional, next)` is called with the
  argument-juggling form and no `payload.parent`, so a Lesson document lands in the `next` parameter and
  `TypeError: next is not a function` follows. It is **client-reachable**:
  `public/js/courseEditor/controllers/root.js:1016-1019` sets `update.parent` only on a **cross-lesson** drag.
- **The avatar assertion read a configuration path that does not exist.** `config.cloud` is absent at both commits;
  the real path is `config.aws.buckets.useravatars.host`, and `normalizeAvatar` maps any URL containing
  `example.com` to `/img/avatar-default.svg`.
- **chai 4 moved dotted property paths.** `.deep.property('a.b')` was removed; dotted paths live on
  `.nested.property`.

## 14. The R-6 parity harness, and what it proves

The baseline JSON artifacts previously named a capture harness that did not exist, which meant the corpus could
neither be regenerated nor replayed from committed code. Three files close that gap.

- **`test/baseline/capture.js`** — captures the corpus over **real HTTP** (`node:http` against
  `server.info.{host,port}`); `server.inject()` is never used, for the reason in section 3.9. It obtains a listening
  socket by setting `NODE_CONFIG` **before** requiring `app.js`, so `config/test.yaml:L3` is never edited and
  `config/local.yaml` is never created. Its port is `BASELINE_PORT`, else `30112 + CLONE_INDEX`, so parallel clones
  do not collide. It is **dry-run by default**: `--write` refuses unless `HEAD` equals the recorded
  `metadata.baseCommit`. It is guarded with `require.main === module`, and it exports **57** helpers so that the
  replay script and the in-suite parity spec share one normalizer rather than reimplementing it. It records **two
  readings** of every entry: the unfollowed first hop, and the terminal status reached by following the `Location`
  chain back onto the same application — see section 14.3.
- **`test/baseline/replay.js`** — replays the route table and the response corpus, diffs them under the artifact's
  normalization contract, exits non-zero on any difference, and never writes.
- **`test/lib/api/route-parity.js`** — **80** tests: 11 route-table gates, 5 corpus-reading gates, 58 route-level
  checks and 6 crypto-parity checks. It is appended as the **tenth** entry of the fixed sequence in
  `test/lib/api/index.js`; the existing nine
  are untouched, because database state is shared across them and reset only at the outer boundaries. Parity runs
  last, so it proves the gates still hold after eight suites have written to the database, and its fresh
  unauthenticated agent neither consumes nor disturbs shared session state. It deliberately does **not** assert HTML
  digests: rows left by earlier suites can legitimately change rendered markup, so asserting a digest there would
  manufacture a flake. Digest comparison is `replay.js`'s job, on a clean capture.

**The headline result.** Run against the **migrated** tree, the harness reproduces all **58** unauthenticated and
all **7** authenticated base-commit entries with **zero differences** across every compared field — request headers,
status, status text, all response headers, content type, Set-Cookie value and attribute set, `Location`, the
API-request classification, and the body shape including HTML digests. Both readings reproduce exactly — the
resolved reading `{200:25, 401:7, 404:25, 500:1}`, which is the documented gate, and the first-hop reading
`{200:12, 302:16, 401:7, 404:22, 500:1}` beside it — and two independent runs differ from each other in nothing,
which is the volatility proof the artifact requires.

**The harness is falsifiable, and that was proven rather than assumed.** Three separate mutations were introduced
and each produced exactly one reported difference and exit 1: a recorded status changed from 200 to 201, a canonical
route row corrupted, and an authenticated body digest zeroed. Each artifact was then restored byte-identically.

**Three preserved quirks were re-confirmed live during capture**, from the server's own error channel:
`TypeError: Cannot read properties of undefined (reading 'toLowerCase')` at `lib/controllers/users.js:672` — the
single 500 of section 1.14 A — and `Error: reply.redirect is not a function` at `lib/controllers/pages.js:36` and
`:52`, both halves of the flagship section 1.1.

### 14.1 The throwaway capture identity was reconstructed from evidence, not guessed

The corpus records authenticated requests made as a throwaway user that the artifact names but whose password it
does not store. Rather than invent one, both password lengths were **derived** from the recorded `POST /login`
`content-length` headers: the JSON envelope
`{"email":"baseline-capture@example.com","password":""}` is 54 bytes, and the recorded lengths of **73** and **81**
therefore imply a 19-character valid password and a 27-character invalid one. The reconstruction is **confirmed** by
the fact that both `content-length` headers reproduce exactly *and* the authenticated `GET /home` normalized sha256
reproduces — which also proves the `fullname` is right, because `user.name` defaults to `user.fullname` and is
rendered into the home page.

Two digests belong to that entry and they must not be confused. The eight-candidate `fullname` sweep that pinned the
identity was run in the earlier, first-hop-only pass, where nothing had consumed the session flash, and the digest it
uniquely selected was `f7d1e5d3c27b175cfebf0a57431fd541d8a836c9e008e40884c475feb82972b0` at 18126 raw / 17206
normalized bytes. Under the redirect-resolution pass the `POST /login` chain consumes that flash first, so the same
identity renders the recorded entry at 18055 raw / 17135 normalized bytes with sha256
`a207e0fc271ba246033db9fa4bdd7546c9eb98112ddb5ed800559912e77c368d`, and *that* is the value replay reproduces on every
run. The sweep's discriminating power is unaffected — the flash is a fixed addition that does not depend on the
`fullname` — and the identity's link to the recorded digest is now verified directly, by replay, rather than by the
sweep. Section 3.38 records the 71-byte delta and why both numbers are kept.

One model-API fact cost a run and is recorded so it does not cost another: the global `User` is the model factory's
**publicModel** — a callable constructor with class methods attached — **not** a mongoose model, so `User.findOne` is
`undefined`. The generated `findById` honours `alternateIds : ['username', 'email']`, so the identity resolves
through the model's own public API without touching the `NODE_ENV=test` configuration leak.

### 14.2 The roles-token normalization is gated, not merely applied

**The risk the review identified.** The corpus normalizes a roles token — 32 hex characters, `+`, then a base64
OpenSSL AES envelope — to the literal `<ROLES_TOKEN>`. A same-length change to the KDF, the key derivation or the
cipher would therefore compare **equal** while breaking the frozen browser decryptor at
`public/js/trinket-roles.js:L7-L11`.

**What was measured.** `lib/util/roles.js#encrypt` produces
`crypto.randomBytes(16).toString('hex') + '+' + CryptoJS.AES.encrypt(obj, token).toString()`. Over plaintext lengths
0 to 199 the envelope size obeys, in **200 of 200** cases exactly:

```text
rawBytes     = 16 + (floor(plaintextBytes / 16) + 1) * 16
base64Length = ceil(rawBytes / 3) * 4
```

The same plaintext twice yields the same length but **never** the same ciphertext, because the salt is fresh — which
is precisely what makes the *length* assertable while the bytes are not. Exactly **one** corpus body carries a token,
authenticated `GET /home`, measured at `hexLength 32`, `base64Length 620`, `rawByteLength 464` — and
`464 = 16 + 28 × 16` with `620 = ceil(464 / 3) × 4`, exactly as the law predicts.

**The decision, and why the obvious fix was rejected.** The substitution string was **not** changed to a
length-encoding form. Because exactly one body carries a token, changing the replacement would change that entry's
recorded `bodyShape.sha256` and `normalizedBytes` — **base-commit measurements that cannot legitimately be
re-derived**, because the base commit **cannot boot in this environment at all**: its `lib/util/routeParser.js`
requires `tab` and `optimist`, which the migrated lockfile no longer installs. Rewriting a base-commit digest from
the migrated tree would replace evidence with assertion, and the artifact's own contract prohibits exactly that:
*"Do NOT normalize away a difference in order to make a replay diff pass."*

**What was delivered instead is strictly stronger and fabricates nothing** — three enforcement layers:

1. `capture.js#assertRolesTokenStructure` checks **every** match **before** substituting and **throws** rather than
   erasing: 32 lowercase hex; base64 prefix `U2FsdGVkX1`; base64 length a multiple of 4; and the first eight raw
   bytes decoding to the ASCII magic `Salted__` with a raw length that is a multiple of 16.
2. `route-parity.js` asserts those four invariants, the length law, and a **real browser-compatible CryptoJS round
   trip** — the check that actually catches a same-length cipher change — and asserts that **four near-miss tokens
   which match the normalization pattern are rejected**: a non-hex passphrase, a wrong base64 prefix, a base64 length
   of 11 (not a whole quantum), and a 12-character payload that decodes to `Salted_P` rather than `Salted__`.
3. `replay.js` reports the per-run token observations alongside the diff.

The contract itself is committed as `test/baseline/responses.json#cryptoParityContract`, so the numbers above are
checkable rather than narrated. The client-shipped key that makes all of this obfuscation rather than security
remains section 1.9, and remains unfixed.

### 14.3 The redirect-resolution pass, and the four files it touches

Section 3.38 records *why* the corpus has two readings. This subsection records *what was built* to produce them, so
that the artifacts and the code that generates them cannot drift apart.

- **`test/baseline/capture.js`** gained a `RESOLUTION` policy constant (`follow : true`, `maxHops : 10`) and the
  helpers `isRedirectStatus`, `classifyHopTarget`, `describeResolvedBody`, `followRedirectChain` and
  `attachResolution`. Both capture paths use them: the unauthenticated pass sends **no cookie on any hop**, so a 3xx
  to `/login` resolves to the unauthenticated login page; the authenticated pass pins one session cookie for every
  hop of a chain, except the two `POST /login` flows, which adopt the `Set-Cookie` of their **own** first hop.
  `rebaseEntryOrigin` now maps over `entry.redirectChain[].location` as well, so a corpus captured on one port
  replays on another. `COMPARED_FIELDS` gained `redirectChain` and `resolved`, and `mergeMeasuredIntoCommitted`
  recomputes eleven gates rather than four.
- **`test/baseline/replay.js`** compares the two readings by name — `gates.firstHopStatusDistribution`,
  `gates.resolvedStatusDistribution`, `gates.hopCountHistogram`, `gates.redirectingRouteCount`,
  `gates.redirectingRoutePaths`, `gates.redirectResolution`, `gates.authenticatedFirstHopStatuses` and
  `gates.authenticatedResolvedStatuses` — and prints both on every run, so a drift in either is a reported
  difference rather than a silent one.
- **`test/baseline/responses.json`** records `redirectChain` and `resolved` per entry beside the unchanged first-hop
  `status`, `location`, `headers` and `bodyShape`, and `requestPolicy.redirectPolicy` states the follow rule, the
  origin rewrite, the loop guard, the method rule and the cookie rule.
- **`test/lib/api/route-parity.js`** gained the five checks of the group *the two readings of the corpus agree with
  their own entries (TR2)*, which re-derive both distributions, the redirecting subset, its resolution and the hop
  histogram **from the entries themselves** rather than trusting the recorded gates, and assert that the two
  authenticated 500s stay terminal under the follow policy.

**One measurement discipline this pass imposed.** A chain is followed inside the process under test and nowhere else:
a hop whose `Location` names any other origin is recorded and never requested. That rule is what keeps a parity
harness from becoming a network client, and it costs nothing here because no corpus route resolves off-site.



## Appendix — the parity baseline anchors

These are the measured baseline figures against which every parity claim in this changeset is checked. They are
recorded here so the claims are verifiable rather than asserted.

Every figure below is a **measured** value captured from the exact base tree at commit `2f8712a` on the exact base
toolchain (`@hapi/hapi` 20.3.0, `joi` 17.13.3), over real HTTP. Where a figure differs from the Technical
Specification's prose, the measured value is authoritative under R-6 and the divergence is stated explicitly rather
than smoothed over. Section 3.22 records the recapture and the adjudication.

The **233-row count itself matches the Technical Specification exactly**, and it is the row set — not the digest
string — that every parity claim is checked against.

**Route table.** **233 rows**. Sorted over the canonicalization published in `test/baseline/route-table.json`, the
digest is **sha256 `452116ce74301c61c92efb36fe8ead987b6a9e81d83a28af335c8d08fa1d64a8`** (md5
`dfc1e295156ecdbbee4a073b231b9326`); the registration-order fingerprint — the same rows hashed **unsorted**, in the
order `server.route()` received them — is sha256
`6a65d18273c731aa070cf905625a9dfe4789caf066dde0c5beb14c6dd8131898`. Composition: **137 GET, 63 POST, 19 PUT, 13
DELETE, 1 PATCH**; **117** paths under `/api/`; **161** carrying pre-handlers; **105** at `mode=required
strategies=["session"]`, **2** at `auth: false`, and **126** inheriting `mode:'try'`. Every one of those composition
figures matches the Specification exactly. All three digests are recorded in
`test/baseline/route-table.json#gates`, reproduce from that artifact's own committed rows, and are re-derived from
the live server by `test/baseline/replay.js` and asserted by `test/lib/api/route-parity.js`. The reproduction is a
one-liner, published as `canonicalization.reproduce` in the artifact itself, so neither digest has to be taken on
trust: `sha256(rows.map(r => r.canonical).slice().sort().join('\n')) === gates.measuredSha256` and the same hash over
the unsorted `canonical` array equals `gates.registrationOrderFingerprint`.

All three were reproduced **twice**: once from a genuinely unmodified checkout of the base commit running the
pre-migration dependency tree (`@hapi/hapi` 20.3.0, `joi` 17.13.3, the `marked` 0.3.2 fork, with the compatibility
shim still in place), and once from the migrated tree (`@hapi/hapi` 21.4.10, `joi` 18.2.3) after every change in this
changeset. The two captures are identical row for row and in registration order, which is a materially stronger
statement of TR1 than "unchanged by the migration". See adjudications **ADJ-4**, **ADJ-9** and **ADJ-11**, the authoritative
base-lockfile capture recorded in `metadata` and the second run recorded in `metadata.supplementalOverlayCapture`.

> The Specification records the route digest as sha256 `cd2a7e38a39bd84902ac1a0d69f50e2a`. That value is **32**
> hexadecimal characters, and a SHA-256 is **64**, so it cannot be a SHA-256 of any input. **27** candidate
> canonicalization recipes, widened to **42** candidate digests (14 serializations × {sha256, sha256-first-32, md5})
> over the exact-base capture, were computed and **none** reproduced it. It is therefore recorded as unreproducible
> retained verbatim — `test/baseline/route-table.json#gates.documentedDigest` — not quietly matched.

**Route arithmetic — measured, and it is not the figure the Technical Specification states.** The table derives from
**116** declarations in `config/api_routes.js` plus **112** in `config/routes.js` = **228** declared entries, plus
**5** synthesized routes = **233**. Measured directly:

```text
require('./config/api_routes').length === 116
require('./config/routes').length     === 112      # 57 literal entries + 55 from the per-language loop
                             subtotal === 228
+ 2 synthesized static pages (/about, /help)  + 1 cache-prefix route
+ 1 /.well-known/{path*}                      + 1 /{path*} catch-all
require('config').routes.length       === 233 === server.table().length
```

The per-language expansion is the loop at `config/routes.js:L549-L608`, which pushes five routes per language across
the **eleven** `config/constants.js` `trinketLangs`, so `config/routes.js` contributes **57 literal + 55 generated =
112** entries.

An earlier revision of this appendix stated "**62** declarations in `config/routes.js` plus **116** in
`config/api_routes.js` = **178**, expanded to 233 by the `.json` extension-duplication mechanism". **Both halves are
wrong**, and both corrections are recorded in `test/baseline/route-table.json` under `derivation.corrections`:

- **correction-a** — the `.json` **extension-duplication mechanism credited at §0.4.1.1 and §0.5.1.2 never fires**,
  so it contributes zero routes. `lib/util/routeParser.js:L258` sets `extensions = route.ext || false` and the
  duplication branch at L598-L605 runs only `if (extensions)`; no declaration in either route file carries an `ext`
  key, so the branch is provably inert. It is preserved unchanged regardless — the in-code label for it is `Q-A3a`,
  mapped in the label crosswalk of section 5. See adjudication **ADJ-1**.
- **correction-c** — the **eight `app.prefixes` directory routes contribute zero routes**, not eight.
  `config/default.yaml:L142-L150` declares `components`, `js`, `css`, `img`, `fonts`, `partials`, `skulpt` and
  `models` as **key-only entries with no value**, so each parses to `null` and the guard at
  `lib/util/routeParser.js:L665` is falsy for every one. Populating them would move the table from **233 to 241**,
  which is why `config/default.yaml` is frozen.

`config/routes.js` exports 112 entries, not 62, and 228 + 5 accounts for all 233 rows with nothing left for a
duplication step to explain. The corrected figures live in `test/baseline/route-table.json#gates` as
`declaredRouteEntries` and `synthesizedRoutes`, each with the command that produced it, and
`test/lib/api/route-parity.js` re-derives `declared` from the two route modules on every test run and asserts
`declared + synthesizedRoutes === rowCount`, so the numbers cannot drift back.

**Response corpus.** **58 parameterless unauthenticated GET routes**, yielding the measured first-hop distribution
**12 × 200, 16 × 302, 7 × 401, 22 × 404, 1 × 500** — `test/baseline/responses.json`,
`gates.firstHopStatusDistribution`; `gates.measuredDistribution` is the **resolved** reading described below. Corpus
selection is reproducible rather than hand-curated: filter the live route table for GET routes whose path contains no
parameter segment. Of the **22 × 404**, **20** are the feature-flag-gated language pages of section 1.4
(`gates.languageFlagFourOhFours`) and **2** are Boom-JSON 404s at `GET /api/trinkets/active` and
`GET /api/trinkets/popular`, refused by the `validLang` pre-handler before any handler runs
(`gates.boomJsonFourOhFours`). The single 500 is `GET /api/users/assets`, section 1.14 A, and it is delivered as a
**Boom JSON payload rather than a rendered `50x.html` page** (`gates.serverErrorDeliveredAs`). Of the **16 × 302**,
ten carry an absolute `Location` and six a relative one (`gates.absoluteRedirectCount`,
`gates.relativeRedirectCount`). The recorded `status`, `location`, `headers` and `bodyShape` of every entry are the
**unfollowed first hop**; the terminal status of each `Location` chain is recorded additively as `resolved`.

> The Specification states this corpus as `25 × 200, 7 × 401, 25 × 404, 1 × 500`, and that is the **resolved**
> reading: the status each route arrives at once a 3xx is followed back onto the same application. It is reproduced
> exactly — `gates.documentedDistribution` with `gates.distributionMatchesDocumented: true` — and it is the gate. The
> apparent conflict with the first-hop tally above was one unrecorded capture choice and nothing else: 13 of the 16
> redirecting routes resolve to 200 (12 + 13 = 25) and 3 to a feature-flag 404 (22 + 3 = 25), while the 7 × 401 and
> the single 500 are terminal in both readings. Both readings are committed and both are re-derived on every capture
> and every replay, so a deviation in either fails with exit 1. No application behavior was altered to make the prose
> true — doing so would have been the R-4 violation the review warns against. Section 3.38 records the adjudication,
> the bounded follow rule and the one corpus value the policy legitimately moves.

**The 302 class, itemized by cause.** All sixteen were traced to a declaration or to a lifecycle rule rather than left
as a count, because the Technical Specification omits the class entirely and an unexplained redirect is
indistinguishable from a conversion defect. **Five** are non-API routes at `mode=required strategies=["session"]`
taking the `app.js:L170` `h.redirect('/login').takeover()` branch — `/account`, `/admin`, `/courses/new`, `/home` and
`/welcome`. **Four** are aliases carrying `success.redirect` with **no `pre` array**, so no feature-flag pre-handler
can run — `/r` → `/R` (`config/routes.js:L490-L494`), `/skulpt` → `/python` (`L444-L448`), `/vpython` → `/glowscript`
(`L466-L470`) and `/webvpython` → `/glowscript` (`L478-L482`); two of those four targets are themselves 404s in this
configuration, and that is preserved as measured. **Three** fail a required-query validation into `fail.redirect`
before any handler runs — `/reset-pass`, `/change-email` and `/verify-email`. The remaining four are one each:
`GET /logout` carries a **top-level** `redirect : '/'` that `lib/util/routeParser.js:L297-L300` hoists into
`success.redirect` (`config/routes.js:L63-L68`); `GET /python/` is the language loop's trailing-slash redirect, whose
two pre-handlers both pass because `python` is the one enabled language; `GET /auth/google/callback` is `auth: false`
with `fail.redirect '/signup'`, reached because no OAuth code was supplied; and `/account-deleted` is a **handler-level**
`reply().redirect('/')` at `lib/controllers/users.js:L216-L219` — the *call* form of the synthetic reply, which works
where the *property* form of section 1.1 does not, and the only one of the sixteen whose `Location` is relative by
handler choice rather than by declaration. 5 + 4 + 3 + 4 = **16**, and every path is recorded with its `location` and
its cause in `test/baseline/responses.json`.

**Mandatory authenticated supplement.** The unauthenticated corpus alone would have missed section 1.1 entirely, so the
corpus also carries **seven authenticated entries** (`test/baseline/responses.json`, `gates.authenticatedEntryCount`),
in a contractual order that ends with `/logout` because that request clears the session: the valid and invalid
`POST /login` probes that establish the session, then `GET /login` → **500** and `GET /signup` → **500** — the
section 1.1 quirk, and `gates.authenticatedLoginSignupNote` records that a **302** on either one is a conversion
defect to report rather than a corpus to adjust — plus `GET /home` → **200**, `GET /account` → **302** and
`GET /logout` → **302**.

**CSS artifacts.** `public/css/base.css` = **265,727 bytes** (sha256 begins `34f1b6e1`); `public/css/embed.css` =
**296,352 bytes** (sha256 begins `53f47fc7`); and **zero `.css.map` files in the build output**, per section 1.7 —
measured as `find public/css -name '*.css.map'` returning nothing, which is the scope that matters because
`public/css` is the configured `outDir`. The claim is scoped to Vite's own output on purpose: **the only two
`*.css.map` files anywhere under `public/`** are `public/components/foundation/css/foundation.css.map` and
`public/components/foundation/css/normalize.css.map`; both are dated 2021, both are gitignored, and both arrive
inside the release tarball rather than being emitted by `npm run build`. Both stylesheet artifacts must be
reproducible after the change, which is why `sass` and `vite` are held. Re-verified at final validation: a fresh
`npm run build` reproduced both stylesheets **byte-identically** — sha256 `34f1b6e1…` and `53f47fc7…` unchanged, and
`git status public/` clean afterwards.

**Vendored component tree.** The build depends on `public/components`, which is gitignored and hydrated from the
**166,464,007-byte** `public-components.tgz` asset attached to release v1.1.0 — the same asset the Dockerfile
fetches — whose sha256 is `58422c0d0c7d25c1e6fdd1e014ff690f41c899257703e416e85a0fb0a926181f`. A clean checkout
cannot build until that hydration has run, which is why `npm run build` runs `node scripts/hydrate-components.js`
first: it verifies the archive against that byte length and digest, unpacks it, and skips itself entirely when the
tree is already present, so `git clean -xfd && npm ci && npm run build` completes from a clean checkout.

**Test-suite baseline.** **25 `.js` files, 2,874 LOC, 95 `describe`, 124 `it`, 312 assertions** — and all 312 are
`.should.`-style chains, with `expect(` = 0 and `assert` = 0. That uniformity is what makes "assertions unweakened"
a checkable property, and the check is **scoped to those 25 files**: an `expect(` or a code-line `assert` appearing
in any of them would be a rewritten assertion. Re-measured after the whole changeset, all 25 still report
`expect( = 0` and zero code-line `assert`, so no pre-existing assertion was converted to a different style.

The check does **not** extend to files this changeset creates, because a new file cannot rewrite an assertion that
did not exist. Six new spec files were added — `test/lib/util/legacy-pathname.js`,
`test/lib/util/no-response-fate.js`, `test/lib/util/asset-url-streaming.js`, `test/lib/api/route-parity.js`, and the
two guarded harness scripts `test/baseline/capture.js` and `test/baseline/replay.js` — and the first three use
chai's `expect` deliberately, because they assert on thrown errors and on structural equality over large generated
input sets, where `expect(fn).to.throw(...)` and a labelled `expect(actual, message)` are the readable forms.
`test/lib/api/route-parity.js` uses `.should.` throughout, matching the suite it joins. **Suite totals after the
changeset: 224 passing, 0 failing, `npm test` exit 0.**

**Session cookie.** Name **`session`** (`app.js:L104`), iron-seal prefix **`Fe26.2`**, and a 24-hour TTL —
`expiresIn: 24 * 60 * 60 * 1000` at `app.js:L107`, that is 86400000 milliseconds. Every `app.js` line number in this
subsection is a base-commit number; the block is preserved verbatim, so each of them sits exactly four lines earlier
in the delivered tree. That TTL is the **server-side cache policy's** expiry for the `sessions` segment rather than a
cookie attribute, and it **overrides** `config/default.yaml:L47`'s `expiresIn: 2147483647`, because `app.js` builds
the yar options itself and reads only `password` (`L98`), `isSecure` (`L99`) and `name` (`L104`) from configuration —
`isSameSite: 'Lax'` at `L100` and `maxCookieSize: 0` at `L103` are literals in `app.js`.

**The `Set-Cookie` rewrite is conditional, and its measured output is narrower than the brief.** The `onPreResponse`
extension at `app.js:L205-L240` fires only when the response declared a cookie (`request.cookie`), and then only for
the cookie whose name matches the session name. It appends `; Expires=<nextYear UTC>` at **L225** when no `Expires`
is already present, and it appends `; SameSite=None; Secure` at **L229** only inside the `if (cookieIsSecure)` guard
at **L228**, where `cookieIsSecure` is computed once at **L204** as
`config.app.plugins.session.cookieOptions.isSecure !== false`. **`config/default.yaml:L41` sets `isSecure: false`**,
so under the effective configuration **only `Expires` is appended**. Measured attribute sets: on the cookie-declaring
`GET /logout`, `[HttpOnly, SameSite, Path, Expires]` with **`SameSite=Lax`** — which comes from yar's
`isSameSite: 'Lax'`, not from the rewrite; on an ordinary route such as `GET /`, `[HttpOnly, SameSite, Path]` with
**no `Expires`**, because the rewrite is gated on `request.cookie`. **No `Secure`, no `SameSite=None` and no `Domain`
appears anywhere in the corpus** — the last because `app.js` never passes a `domain` to yar even though
`config/default.yaml:L42` declares `cookieOptions.domain: .trinket.dev`.

`test/baseline/responses.json` records the whole contract under `cookieContract` — `effectiveIsSecure: false`,
`expectedAppendedAttributes: ["Expires"]`, `sameSiteSecureAppended: false`, `domainAttributePresent: false`,
`measuredAttributesOrdinaryRoute`, `measuredAttributesCookieRoute` and the six routes that declare `cookie: true` —
and the reading is fixed by the adjudication **`cookie-rewrite-appends-only-expires`**. Any claim of a
`; SameSite=None; Secure` rewrite, including earlier drafts of this appendix, is a **labelled historical claim
only**.

**Both sides of the guard are preserved.** The conditional is baseline code — present verbatim at the base commit,
comment included — so a deployment that sets `isSecure: true` still receives `; SameSite=None; Secure`, and that
branch was not removed just because the default configuration never takes it. ⚠️ The corollary is recorded as
`cookieContract.doNotOverride`: a capture or a replay must **not** override `cookieOptions.isSecure`, because doing
so would append those two attributes, change an observable header and manufacture a parity failure.

**The four client-visible `Boom.unauthorized` message strings.** `'Not logged in'` at `app.js:L251`,
`'User not found'` at `L264`, `'Account disabled'` at `L269`, and `'Auth error'` at `L277`. All four are part of the
observable contract, because `Boom.unauthorized` passes its message through.

**The message-visibility asymmetry.** **4xx passes the message through; a 500 scrubs it** to the fixed string
`"An internal server error occurred"` — `test/baseline/responses.json`, `errorMappingContract.fourXxPassesMessage`
and `.fiveXxScrubbedMessage`. Measured over real HTTP on `@hapi/hapi` 21.4.10, and identical whether the Boom is
thrown or returned. The scrub is **500-only, not 5xx-wide**: `@hapi/boom` 10.0.1 rewrites `output.payload.message`
only when the status is exactly 500, so the five `notImplemented` messages behind the disabled asset features —
`'Avatar uploads are not enabled'` and `'File uploads are not enabled'` in `lib/controllers/files.js`, and
`'Asset uploads are not enabled'` at three sites in `lib/controllers/users.js` — would reach the wire verbatim in a
**501** body and are contractual, even though no route in the 58-entry corpus is configured to produce one.

This is the single most useful fact for a maintainer converting a handler, because it says exactly where error text is
part of the contract and where it cannot be. The rule carries one further refinement: message visibility holds **on
the API branch**, where the seven 401s carry `'Not logged in'` and the two `/api/` 404s carry hapi's default
`Not Found`; on the **HTML branch the rendered page replaces the payload**, so a 4xx message such as
`Boom.notFound('This trinket type is not available')` from `lib/util/helpers.js` is never observable and only the
`404.html` body is (`errorMappingContract.boomMessageVisibilityByBranch`). Conversely the two `badImplementation`
constructions and the terminal `'Unexpected response format'` error at `lib/util/routeParser.js:L469` — now
`lib/http/responseContract.js:L239` — are message-invariant, because the framework replaces a 500's message with the
fixed string.

**Correction — the two `Boom.forbidden(err)` sites in `course.js` answer 500, not 403.** An earlier revision of this
appendix stated that the error-object pass-throughs at `lib/controllers/course.js:L1003` and `L1060` "leak the inner
error's text into a client-visible **403** body, so that text is contractual" — which is also how the Technical
Specification describes them, at section 0.5.1.3. **That reading is wrong**, and the error matters because it would
have led a maintainer to treat inner error text as part of the wire contract at a status code that never occurs. Under
R-6 the measurement governs the plan's prose.

The measured behavior is a **scrubbed 500**. `lib/controllers/course.js:L1-L7` binds the error library to the
identifier **`errors`** — `errors = require('@hapi/boom')` at `L3` — and the file declares **no** binding named
`Boom` anywhere; a search for a `Boom` declaration in the base-commit file returns zero hits while `Boom.` is
*referenced* at **41** code sites, 37 of them `Boom.forbidden`. Evaluating `Boom.forbidden(err)` therefore raises
`ReferenceError: Boom is not defined` before any Boom object is constructed. At the base commit that ReferenceError
was caught by the shim's single catch-all at `lib/util/routeParser.js:L578-L589` and mapped to `Boom.badImplementation`
→ **500**; after the migration the same ReferenceError propagates to `lib/http/errorMap.js`, which produces the same
500. Either way the response body is the scrubbed
`{"statusCode":500,"error":"Internal Server Error","message":"An internal server error occurred"}`.

Measured directly against `@hapi/hapi` 21.4.10 over real HTTP, with the two shapes served side by side:

| Handler shape | Status | Body `message` |
|---|---|---|
| `throw Boom.forbidden(err)` with `Boom` **undeclared** (the `course.js` shape) | **500** | `An internal server error occurred` |
| `throw errors.forbidden(err)` with the binding **declared** | **403** | the inner error's text, verbatim |

So the inner error text at those two sites is **not** contractual — it is unreachable. What *is* contractual is the
500 itself, and that is why the migration reproduced the ReferenceError rather than "fixing" the identifier: renaming
`Boom` to `errors` at those two sites would have turned a measured 500 into a 403 carrying internal error text, which
is simultaneously an R-4 behavior change and an information disclosure. The inline comments at both sites already
record this correctly; it was only this appendix that was wrong. Also recorded as
[section 4.13](#413-the-undeclared-boom-identifier-in-coursejs), which is deliberately numbered outside the SEC-1 …
SEC-12 series because it is not one of the twelve review findings, and repository-wide in
[section 10](#10-the-undeclared-boom-scrubbed-500s-61-call-sites-that-never-returned-the-status-they-name). The
per-file view of the same defect in `course.js`, including the three different channels its four look-alike branches
produce, is
[section 3.32](#332-four-identical-looking-branches-in-one-file-three-different-observable-channels).
