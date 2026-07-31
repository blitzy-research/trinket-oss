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

**Rule-set provenance.** The `review_rules` facility was called twice for this project — once with no range and
once over the document's full extent — and both calls returned the single line **"No user rules provided."** There
is no separate user-supplied rules document; that document is complete at that one line. No rules have been
invented to fill the gap, and their absence is **not** treated as permission to lower the bar. The binding rule set
this catalogue answers to is the six-item **RULES block carried inside the user's own request** (referred to below
as R-1 through R-6), plus the house style contract at `CONTRIBUTING.md` §Code Style (L62-L66), plus
enterprise-standard best practice.

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

Every entry in sections 1, 2 and 3 states four things:

- **What it is** — the observable behavior or condition.
- **Evidence** — the exact `file:line` citation, so the claim is checkable rather than asserted.
- **Why it is preserved** — which rule governs it, and what depends on it.
- **What a naive fix would have broken** — the concrete regression that was avoided.

**Citation frame.** All `file:line` citations are given against the **base commit**, which is the reference frame
R-6 establishes for the entire catalogue. Line numbers in files that this changeset rewrote have since moved; the
most visible example is `package.json`, whose `"license"` key sits at L99 at the base commit and earlier in the file
after the manifest was rewritten. Where a line number has shifted, the base-commit number is the one recorded here,
because it is the number at which the behavior was measured.

## 1. The thirteen catalogued quirks

All thirteen were verified at the cited lines against the base commit. The four numbered items in section 1.14 are
further preserved conditions of the same kind, recorded so that they are not mistaken for oversights either.

| # | Quirk | Primary evidence |
|---|---|---|
| 1 | Authenticated `GET /login` and `GET /signup` return HTTP 500 | `lib/controllers/pages.js:L17`, `L27` |
| 2 | The Joi custom-message override that never fires | `lib/util/routeParser.js:L530-L534` |
| 3 | `package.json`'s `main` points at a directory that does not exist | `package.json:L5` |
| 4 | The `isKnownTrinketType` / `isTrinketTypeEnabled` asymmetry | `lib/util/features.js:L79-L87` |
| 5 | The 1000 ms race workaround and the `"does not exists"` typo | `lib/util/file.js:L106`, `L118` |
| 6 | `test/smoke-test.sh` defaults to port 3001, everything else 3000 | `test/smoke-test.sh:L7`, `L10` |
| 7 | Two orphaned SCSS entry points, and zero `.css.map` files | `vite.config.mjs` |
| 8 | `npm run setup-vendor` does not exist but two documents cite it | `docs/overview.md:L37`, `COMPONENTS.md:L5` |
| 9 | The client-shipped AES key | `lib/util/roles.js:L13` |
| 10 | The unchecked-`err` crash path in reCAPTCHA verification | `lib/util/recaptcha.js:L18` |
| 11 | The permanently-`undefined` `server` parameter | `lib/util/routeParser.js:L594` vs `L71` |
| 12 | The 64 leftover `console.log` calls | 64 sites across `app.js`, `config/`, `lib/`, `scripts/` |
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
two predicates disagree in a way that makes 25 routes permanently unreachable.

**Evidence.** `lib/util/features.js:L38` carries the comment `// Unknown types default to disabled for safety`,
followed by `return false;` at **L39**. `isKnownTrinketType` is declared at **`lib/util/features.js:L79-L87`** and
returns `trinketFeatures.hasOwnProperty(lang)`, having already returned `false` at L83 when the feature block is
absent altogether.

**Why it is preserved.** R-4, and it is load-bearing for the parity evidence: this asymmetry is the **direct cause
of the 25 baseline 404s** in the response corpus recorded in the appendix. Preserving it is what keeps those 25
routes returning 404.

**What a naive fix would have broken.** Aligning the two predicates would make some or all of those 25 routes
reachable, which is simultaneously a status-code change on 25 routes and the addition of features — excluded
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

Separately, the same file sets **`sourcemap: true`**, yet a post-build scan of the output tree finds **zero
`.css.map` files**.

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

**What was done instead.** The *working* instruction — the `curl` hydration of `public-components.tgz` from the
tagged release, the same 166,464,007-byte asset the Dockerfile fetches — was added to `docs/setup.md` and
`COMPONENTS.md` **without touching either broken line**. The reader now has a command that works; the broken
sentence remains beside it, catalogued here.

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

### 1.12 The 64 leftover `console.log` calls

**What it is.** The application writes 64 unstructured log lines to standard output alongside its real logger,
three of them on every single request.

**Evidence.** Measured exactly — `grep -rn "console\.log" app.js config/ lib/ scripts/ | wc -l` returns **64**.
Three of those fired on **every request**: `lib/util/routeParser.js:L311`, **L544** and **L550**, the middle one
being:

```javascript
console.log('ROUTE: Calling handler for', request.method, request.path);
```

**Why it is preserved.** R-1, and this is the most tempting cleanup in the entire codebase, so it is stated
plainly: **every `console.log` other than those three stays.** Removing logging to reduce per-request overhead is
**not a sanctioned diff category**. Performance is explicitly incidental to this change and may not be used to
justify any hunk.

The three per-request traces disappear **only** because they live inside the deleted compatibility mechanics — they
were part of the shim's synthetic-reply machinery, and the shim's removal is squarely inside the framework-migration
category. They were not removed for being noisy.

**What a naive fix would have broken.** Nothing observable to an HTTP client — but the diff would carry 61
unattributable hunks, and any operator grepping container logs for `ROUTE:` or for one of the other traces would
lose their signal.

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

### 1.14 Four further preserved conditions

These four are the same kind of deliberate decision as the thirteen above and are recorded so that they are not
mistaken for oversights.

**A. The pre-existing 500 at `GET /api/users/assets`.** One of the 58 responses in the baseline corpus is a 500,
and it is this route. It is **reproduced, not repaired**. R-2 of the request's own validation framework compares the
replayed corpus against the captured one; a route that starts returning 200 fails that comparison just as loudly as
one that starts returning 500. A naive repair would have turned the single most obvious "bug" in the corpus into a
parity failure.

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
**stays**; the repair was made in `test/helpers/flow.js`, which resolves the promise before binding the listener.
One further measured subtlety is recorded here because it is easy to get wrong: `app.js:L351-L354` wraps `init()` in
a `.catch()` that logs and calls `process.exit(1)`, so **the exported promise never rejects — it resolves to
`undefined` on failure.** Code that awaits it must not rely on a rejection to detect startup failure.

**D. `docker-compose.yml`'s dead `shared-cache:` volume and its legacy `links:` keys.** The `shared-cache:` volume
is declared at **L37** and mounted by no service. The `links:` keys at **L14-L16** name `redis` and `mongodb`, and
`links` has been a no-op in Compose v2 and later for years — service discovery happens over the shared
`trinket` network. Both are **preserved**: removing them is cleanup, and the file's in-scope change is confined to
the service images that the runtime bump requires.

## 2. The three deliberate browser-versus-server version skews

Three libraries exist twice in this project at two different versions: once as a browser-delivered copy pinned in
configuration, and once as an npm dependency used on the server. In every case the skew is **preserved on both sides
independently**.

| Library | Browser copy | Pinned at | Server copy (npm) | Why both sides stay |
|---|---|---|---|---|
| `highlight.js` | **8.0** from cdnjs | `config/default.yaml:L73` (script) and `config/default.yaml:L90` (stylesheet) | **9.18.5**, held | hljs 10 renamed the emitted `hljs-*` token classes and changed the `highlight()` signature; `lib/shared/trinket-markdown.js:L310` calls `hljs.highlight(lang, code)` and injects the result into client-visible markup |
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
security bump with all used methods verified. `marked` moved from the git fork to registry 4.3.0 because the fork's
one load-bearing deviation — accepting the sanitizer as a **function** — is available on 4.3.0 as the `sanitizer`
option, and because the fork carried no commit metadata, which made a reproducible lockfile impossible.

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

**The ambiguity.** `archiver` 8.0.0 is the current major, and the reflex is to take the newest.

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

**The result.** **Both boots produced 233 rows hashing to the identical sha256
`cd2a7e38a39bd84902ac1a0d69f50e2a`**, and the 58-route response corpus was unchanged. The stub's effectiveness was
independently proven by comparing the module's export keys in each configuration, so the identical hash is evidence
of neutrality rather than of the stub having failed to take effect.

**Corroborating evidence.** The module is **136 lines**, required **exactly once** at `app.js:L28` and never
referenced thereafter — the identifier it is bound to appears nowhere else in the file. Its nine `req.session.*`
accesses target a property that **`@hapi/yar` 11 does not decorate**: the plugin decorates only `request.yar` and
`server.yar`, so `request.session` is `undefined` today and every one of those nine lines would throw if reached.
And `lib/auth/passport.js:L124` references an **undefined variable `opts`**, which is conclusive on its own — that
line cannot execute without throwing a `ReferenceError`.

**Consequence.** Deleting it also makes `passport-local` and `passport-google-oauth` dead, which is why they appear
in the removal list of [MIGRATION-DEPENDENCY-INVENTORY.md](MIGRATION-DEPENDENCY-INVENTORY.md).

### 3.7 The catbox test helper: repoint, not drop

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

**The resolution.** The helper is repointed at the in-repo `lib/util/catbox-mongoose.js` engine and stubs **four**
prototype methods — `isReady`, `get`, `set` and `drop` — leaving `validateSegmentName` **real**, because catbox
calls it at policy-provisioning time during `await server.register([... Yar ...])`, and leaving `start` and `stop`
unstubbed. Expiry is evaluated lazily inside `get`, which creates **no new timer** and so adds nothing to the set of
handles holding the event loop open.

**The 1000× unit correction, recorded because it is invisible and would have silently broken expiry.** The original
helper's `setTimeout(..., time*1000)` existed because redis `EXPIRE` takes **seconds**. Catbox's
`set(key, value, ttl)` receives **milliseconds** — `app.js:L107` passes `24 * 60 * 60 * 1000`, that is
**86400000** — so the `*1000` multiplier is dropped. Carrying it forward would have set a session expiry 1000 times
too far in the future.

**One byte-identical preservation inside the repair.** The now-unused undeclared `expires` global at the helper's
L4 is **kept exactly as it was**. It is an implicit global, and Mocha's load-time leak snapshot is taken against the
set of globals that exist after the helpers load; removing it would change what `--check-leaks` sees.

### 3.8 `.mocharc.json` carries `"exit": true`

**The ambiguity.** Mocha 3, the installed version, **force-exits** after a run. Mocha 4 and later made that
opt-in. The bump to 11.7.6 would therefore make `npm test` **hang after passing** — the suite would report success
and the process would never terminate.

**Three things hold the event loop open**, all of them preserved: the never-`unref`'d `setInterval` at
`app.js:L348` (section 1.13); the module-load database connection, invoked by `connect()` at `config/db.js:L35`
which performs the `mongoose.connect(connectStr)` at `config/db.js:L32`; and the eagerly-created redis client.

**The resolution.** The new root `.mocharc.json` carries exactly four keys — `reporter: spec`, `recursive: true`,
**`check-leaks: true`** (kebab-case, ported from the `--check-leaks` flag) and **`exit: true`**. The first three are
a straight port of the deleted `test/mocha.opts`, measured at **41 bytes, 3 lines, no trailing newline**. The fourth
is the addition.

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

### 3.9 `server.inject()` is banned from the parity harness

**The ambiguity.** Injection is the conventional and far more convenient way to drive a hapi server from a test, and
the parity harness is a test.

**What baseline decided.** Injection is the **sole** source of a `--pending-deprecation` warning in the entire
stack, traced to `@hapi/shot/lib/request.js:L30` and reached from the framework's own inject entry point. The
installed `@hapi/shot` 6.0.3 is the **latest published**, so there is no upstream fix to wait for. Real HTTP serving
on Node 22 measured **zero** warnings. Since the request's validation framework requires a boot with zero
deprecation warnings, the harness issues **real HTTP requests** and never injects.

A second constraint follows from the same analysis and is recorded with it: the harness needs a genuinely bound
socket, but `config/test.yaml:L3` sets `start: false` and that file is frozen. The harness therefore overrides the
start flag **at runtime** rather than editing the YAML, because editing it would change the existing suite's
behavior.

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

### 3.13 `url.parse` becomes `URL.parse(location, config.url)` with a base argument

**The ambiguity.** The mechanical replacement for the deprecated `url.parse` is the WHATWG `URL`, but bare
`URL.parse('/login')` returns **`null`** where the legacy `url.parse` returned an object with a non-null `pathname`.
A mechanical swap would therefore turn 23 working assertions into null dereferences.

**What baseline decided.** The non-throwing static `URL.parse()` is used **with a base argument** —
`URL.parse(location, config.url)` — so relative locations resolve instead of returning null. Measured
`config.url === 'https://trinket.dev'` under `NODE_ENV=test`.

**The census, stated exactly.** **22** `lastRedirect.pathname` sites plus one independent site at
`test/lib/api/registration.js:L85` = **23** pathname assertions. An earlier prose estimate of 24 was wrong; the
census says 22 + 1.

**Why the base argument is genuinely necessary.** Both `Location` header forms really occur: the **absolute** form
via the shim's `redirect()` at `lib/util/routeParser.js:L704-L723`, and the **relative** form via `app.js:L172`'s
`h.redirect('/login').takeover()`. A single call site sees both, so neither form may be assumed.

**Separately, the two genuinely unguarded call sites.** `lib/controllers/trinket.js:L1350` and
`lib/controllers/trinket.js:L1521` both do `url.parse(asset.url)` and immediately read a property of the result,
with no guard. Their `null` case was **explicitly neutralized**, because a `null` followed by a property access
would have raised a `TypeError` and converted a working response into a 500 — a status-code regression on the asset
path. The other six of the eight `url.parse` sites are safe as they stand: `lib/controllers/trinket.js:L1253` is
caller-guarded, `lib/workers/exports.js:L40` and `L304` are guarded, `lib/controllers/users.js:L588` is the
deliberate validation quirk where the absence of a protocol drives the rejection, and the two test sites are
assertions.

### 3.14 The `.fail(` and `.spread(` census was refined

**The ambiguity.** A naive census conflates two entirely unrelated things that share a method name, which would
have made the async conversion look far larger than it is and risked converting the wrong call sites.

**What measurement decided.** `.spread(` has **zero** consumers — the `Promise.prototype.spread` monkey-patch at
`app.js:L4-L16` is dead code. Of the **86** `.fail(` occurrences only **13** are genuine `Promise.prototype.fail`
consumers: five in `lib/workers/exports.js` at L165, L235, L263, L310 and L327, and eight in
`test/lib/models/plugins/roles.js` at L54, L90, L107, L122, L146, L163, L179 and L195. The other **73 are
`request.fail(`** — the shim's response-contract decoration, an entirely unrelated concern that migrates to
`lib/http/responseContract.js` and has nothing to do with promises.

**Why it matters.** The monkey-patches may only be removed once every genuine consumer is converted. Counting the
73 response-contract calls as promise consumers would have made removal look impossible; counting them as
convertible would have broken the response contract.

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

## Appendix — the parity baseline anchors

These are the measured baseline figures against which every parity claim in this changeset is checked. They are
recorded here so the claims are verifiable rather than asserted.

**Route table.** **233 rows**, sorted, sha256 **`cd2a7e38a39bd84902ac1a0d69f50e2a`**. Composition: **137 GET, 63
POST, 19 PUT, 13 DELETE, 1 PATCH**; **117** paths under `/api/`; **161** carrying pre-handlers; **105** at
`mode=required strategies=["session"]`, **2** at `auth: false`, and **126** inheriting `mode:'try'`. Derived from
**62** declarations in `config/routes.js` plus **116** in `config/api_routes.js` = **178**, expanded to 233 by the
`.json` extension-duplication mechanism plus the synthesized static pages and the asset routes.

**Response corpus.** **58 parameterless unauthenticated GET routes**, yielding **25 × 200, 7 × 401, 25 × 404, 1 ×
500**. Corpus selection is reproducible rather than hand-curated: filter the live route table for GET routes whose
path contains no parameter segment. The 25 × 404 are the feature-flag-gated routes of section 1.4; the single 500 is
`GET /api/users/assets`, section 1.14 A.

**Mandatory authenticated supplement.** The unauthenticated corpus alone would have missed section 1.1 entirely, so
the corpus also covers `/login`, `/signup`, `/home` and `/account` in the authenticated state.

**CSS artifacts.** `public/css/base.css` = **265,727 bytes** (sha256 begins `34f1b6e1`); `public/css/embed.css` =
**296,352 bytes** (sha256 begins `53f47fc7`); **zero `.css.map`** files, per section 1.7. Both artifacts must be
reproducible after the change, which is why `sass` and `vite` are held.

**Vendored component tree.** The build depends on `public/components`, which is gitignored and hydrated from the
**166,464,007-byte** `public-components.tgz` asset attached to release v1.1.0 — the same asset the Dockerfile
fetches. A clean checkout therefore cannot build until that hydration step has run.

**Test-suite baseline.** **25 files, 2,874 LOC, 95 `describe`, 124 `it`, 312 assertions** — and all 312 are
`.should.`-style chains, with `expect(` = 0 and `assert` = 0. That uniformity is what makes "assertions unweakened"
a checkable property: any appearance of `expect(` or `assert` in a diff is a rewritten assertion.

**Session cookie.** Name **`session`**, iron-seal prefix **`Fe26.2`**, the `; Expires=<nextYear UTC>` plus
`; SameSite=None; Secure` header rewrite at `app.js:L205-L240`, and a 24-hour TTL — `expiresIn: 24 * 60 * 60 * 1000`
at `app.js:L107`, that is 86400000 milliseconds.

**The four client-visible `Boom.unauthorized` message strings.** `'Not logged in'` at `app.js:L251`,
`'User not found'` at `L264`, `'Account disabled'` at `L269`, and `'Auth error'` at `L277`. All four are part of the
observable contract, because `Boom.unauthorized` passes its message through.

**The message-visibility asymmetry.** **4xx passes the message through; 5xx scrubs it** to the fixed string
`"An internal server error occurred"`. This is the single most useful fact for a maintainer converting a handler,
because it says exactly where error text is part of the contract and where it cannot be. It is also why the two
`Boom.forbidden(err)` error-object pass-throughs at `lib/controllers/course.js:L1003` and `L1060` matter: they leak
the inner error's text into a client-visible **403** body, so that text is contractual and must survive verbatim.
Conversely the two `badImplementation` constructions and the terminal `'Unexpected response format'` error at
`lib/util/routeParser.js:L469` are message-invariant, because the framework replaces any 5xx message with the fixed
string.
