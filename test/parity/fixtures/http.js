// Recorded OAuth, reCAPTCHA and asset-fetch responses.
//
// One of the three external-effect interceptors in test/parity/fixtures/. It is
// loaded as a preload - `node --require <abs path>/test/parity/fixtures/http.js
// app.js` - by test/parity/server.js, before the application, and it installs
// itself on first require. Node core only, CommonJS, no CLI arguments.
//
// ===========================================================================
// WHY THIS FILE EXISTS
// ===========================================================================
// Four call sites reach a third-party HTTP endpoint from inside the request
// path, and none of them can be exercised by the corpus without a substitute:
//
//   1. reCAPTCHA siteverify   lib/util/recaptcha.js
//   2. Google token exchange  lib/controllers/auth.js  (googleCallback)
//   3. Google profile fetch   lib/controllers/auth.js  (googleCallback)
//   4. The streaming asset    lib/controllers/users.js (assetUploadFromURL)
//
// Substitution happens at the MODULE BOUNDARY, not over the network: there is
// no proxy, no listening socket and no DNS, so the corpus is reproducible on
// any host. Every served value is a frozen literal, so test/parity/replay.js
// can compare exactly instead of normalizing (AAP 0.9.3).
//
// ===========================================================================
// USER-SPECIFIED RULES
// ===========================================================================
// `review_rules` reports that NO user-specified rules were provided for this
// project, which AAP 0.7 and 0.10.1 independently record. None are invented
// here, and their absence is not treated as licence to lower the bar:
// enterprise-standard practice governs, and the binding constraints are the
// request's own RULES block as interpreted in AAP 0.7, cited by name below.
//
//   R-a  Single purpose. Recorded responses for the endpoints the application
//        actually calls, under named profiles - not a general HTTP recorder, a
//        proxy or a cassette format. Every profile here maps to an outcome one
//        of the four call sites can actually receive and branch on.
//   R-b  Runs on Node 22, no route or module excluded. The OAuth, reCAPTCHA
//        and asset-upload routes belong to the 233-route surface replay.js
//        must cover, and they are unreachable without this file.
//   R-c  Node core only. Nothing is required except `fs` and `stream`, plus
//        the runtime's own globals (URL, Response, ReadableStream, Uint8Array,
//        Buffer, Promise). No `nock`, no `sinon`, no HTTP-mocking package:
//        this preload also runs inside the BASELINE worktree's process, which
//        has none of the target's devDependencies. The one dynamic require is
//        the application's own `request` package, resolved from the worktree
//        under test purely so that its export can be swapped and retained.
//   R-d  Behaviour "improvements" are prohibited; a quirk is preserved and
//        documented, not fixed. Three rulings are implemented literally:
//          (1) reCAPTCHA outcomes 5 and 6 deliver NO callback to verify()'s
//              caller. Their contract is a process-level failure signature, so
//              a "safe" fallback would repair a documented defect.
//          (2) `asset:transport-refused` emits 'error' and NEVER 'end'. The
//              upload does not start and the route is left UNSETTLED. No 'end'
//              is synthesized and no partial byte is uploaded.
//          (3) `oauth:success-new-user` serves an unseeded email so the
//              controller reaches its save-then-throw: the account IS created
//              and a generic authentication failure IS reported (AAP 0.6.6).
//   R-e  Error-to-response mappings survive unchanged, so each failure is
//        delivered in the exact shape its mechanism uses - the shape decides
//        which funnel the edge reaches:
//          `request` callback form -> cb(err, undefined, undefined) with a real
//            Error carrying code 'ECONNREFUSED'. That is precisely what leaves
//            `response` undefined at lib/util/recaptcha.js and makes reading
//            `response.statusCode` throw.
//          `request` stream form   -> an 'error' event on the returned stream.
//          `fetch`                 -> a rejected TypeError('fetch failed')
//            carrying `cause`, which is undici's shape on Node 22.
//   R-f  Baseline observed behaviour is the tie-breaker. ONE implementation is
//        loaded into BOTH worktrees, so any difference the corpus reports is
//        the application's and never the harness's. Everything the real
//        library did that is not self-evident was MEASURED and is recorded
//        under "BASELINE RECORD" below rather than assumed.
//   AAP 0.8  Zero-warning bar. No `url.parse` (DEP0169 - endpoint matching uses
//        `new URL`), no `new Buffer`, no deprecated stream or fs form, and no
//        console output of any kind: evidence goes to PARITY_HTTP_LOG. The
//        application's own log at lib/controllers/users.js (the asset 'error'
//        handler) is application output and is left alone.
//   AAP 0.9.3  Exact comparison. The OAuth access token is persisted onto
//        user.profiles.google.token and the profile picture becomes
//        user.avatar, which is rendered into HTML, so both are frozen
//        constants. No timestamp, id or token is generated anywhere.
//
// Folder prohibitions, all absolute and all honoured: no network access on any
// code path (the originals are retained solely so restore() can put them
// back, and are never invoked - proved rather than asserted, see THE
// SELF-VERIFYING HARNESS); an unrecorded endpoint fails deterministically
// through its own mechanism's failure shape plus a log entry, never falling
// through to the network; nothing from test/helpers/** or test/lib/** is
// required (test/helpers/defaults.js informed the record style only); no
// `url.parse`; no nondeterministic value in anything a response can expose;
// no application, config or baseline-worktree file is written.
//
// AS A PRELOAD, NO CLI ARGUMENT IS READ: every path and profile arrives
// through a PARITY_* variable, nothing is printed, and `require.main` is never
// this module. The file has a second mode - executed directly, `node
// test/parity/fixtures/http.js`, it verifies every recorded outcome and exits
// non-zero on any failure. That mode reads argv and prints, as every tool in
// test/parity/ does; the two modes are separated by `require.main === module`
// at the foot of the file, so no consumer of this module can reach it.
//
// ===========================================================================
// WHAT THIS FILE GUARANTEES, AND HOW EACH GUARANTEE IS CHECKED
// ===========================================================================
// Four properties, each of which was previously a statement in this comment
// block with nothing behind it:
//
//   1. NO CALL REACHES THE NETWORK. Enforced by matching every URL against a
//      registry and refusing anything absent from it (see ASSET REGISTRY,
//      FAIL CLOSED), and checked by driving the recorded originals through a
//      tripwire that counts any invocation.
//   2. EVERY RECORDED OUTCOME IS EXERCISED. A response nothing requests is not
//      evidence, and defining a profile is not the same as driving it. The
//      harness drives all of them and fails when any profile in the catalogue
//      was not selected.
//   3. WHAT WAS SENT IS RECORDED AND CHECKED. Each call's method, headers,
//      body encoding, body fields and redirect mode are recorded - with
//      credentials redacted - and verified against the endpoint's contract, so
//      a drifted wire encoding is refused rather than served a recorded
//      success (see REQUEST CONTRACTS). A profile counts as EXERCISED only
//      when the fixture served or refused a call under it; selecting one
//      writes a note and proves nothing.
//   4. THE FIXTURE IS WHOLLY IN FORCE, OR THE PROCESS DOES NOT SERVE. A
//      mechanism this tree provides and the fixture could not intercept is
//      terminal, as is an app root the caller DECLARED that does not hold the
//      application - `request` is resolved against it, so a wrong root
//      silently decides which mechanisms exist. The install publishes a
//      handshake naming the implementation and the tree (see THE HANDSHAKE).
//   5. NO CREDENTIAL REACHES THE EVIDENCE. Records and error messages are
//      files and strings, so every one of them is redacted (see REDACTION).
//
// ===========================================================================
// REDACTION
// ===========================================================================
// Evidence is written to a JSONL file and quoted into errors, so nothing that
// reaches either may carry a credential:
//
//   Only `authorization` and `proxy-authorization` keep anything, and only
//   their SCHEME - `Bearer <redacted>` - because a contract asserts on the
//   scheme. `cookie`, `set-cookie`, API-key, token and signature headers are
//   redacted WHOLE. An earlier version kept everything before the first space
//   for every sensitive header, which wrote `session=<secret>;` and the first
//   word of an API key into the evidence.
//   Query and form values are redacted by name against an explicit list AND a
//   pattern, so a signed-query parameter this file has never seen - the AWS
//   credential and security-token pair, for instance - is redacted without the
//   list being edited first.
//   Userinfo is removed from a URL and the removal is MARKED, because a URL
//   that carried credentials in its authority is itself a finding.
//   Input that is not a URL is reduced to `unparseable-url:sha1:<12>` rather
//   than written out: a malformed string still carries whatever was in it, and
//   the digest keeps two runs comparable without carrying the value.
//   The contract needs one fact redaction hides - whether a scheme-bearing
//   header carried a NON-EMPTY credential - so that is computed before
//   redaction and recorded as a boolean.
//
// A credential-bearing URL is also a BEHAVIOUR, not only a logging problem.
// Measured on Node v22.23.2, native fetch refuses one before any request with
// `TypeError('Request cannot be constructed from a URL that includes
// credentials: <url>')` and no `cause`, while the replaced library accepted
// it. That refusal is reproduced on the fetch mechanism, so the difference the
// migration introduced at the asset call site is visible instead of masked by
// a fixture that quietly stripped the credentials and served a 200.
//
// ===========================================================================
// ASSET REGISTRY, FAIL CLOSED
// ===========================================================================
// The three JSON endpoints match on origin plus pathname. An asset fetch
// matches only when its (origin, pathname) appears in the registry built from
// `ASSET_URLS`, from the redirect-hop chain, and from PARITY_HTTP_ASSET_URLS.
// Everything else is unrecorded and fails.
//
// This is a deliberate reversal. `classify()` used to return the asset class
// for ANY parseable http(s) URL, so a call to an endpoint no profile described
// - a new outbound integration, or an SSRF payload reaching a host the
// application was never meant to contact - was served the active profile's
// asset bytes and read as a success. The no-network guarantee was therefore
// unfalsifiable: nothing could tell "recorded and served" from "unknown and
// served anyway". A corpus that needs a further asset URL declares it, which
// is one line of environment rather than a silent default.
//
// ===========================================================================
// REQUEST CONTRACTS
// ===========================================================================
// `REQUEST_CONTRACTS` states, per endpoint and per mechanism, the shape the
// call must have: method, required headers and their exact values, the bearer
// scheme AND a non-empty credential behind it, the absence of a query string
// on the three JSON endpoints - matching is on (origin, pathname), so an
// unexpected query would otherwise be served the recorded response as though
// it had not been sent - the redirect mode where it is load-bearing, the body
// encoding, EVERY required form field, and, for the token exchange, that the
// body is RFC 3986 encoded rather than '+'-encoded. A breach is REFUSED with a
// transport-shaped PARITY_CONTRACT error and recorded as a violation.
//
// "Every required form field" is deliberate rather than "the fields that
// decide the outcome": `formEncode` drops only an `undefined` value and
// node-config reads an unset key as null, so `client_secret` and
// `redirect_uri` are always PRESENT on the wire - with an empty value where
// the deployment leaves them unset - and a body without them is a changed
// body.
//
// The reason is that the migration rewrote the wire encoding of three of these
// four call sites by hand - the private rfc3986/formEncode/legacyJsonRequest
// helpers in lib/controllers/auth.js and the URLSearchParams body in
// lib/util/recaptcha.js - and nothing checked the result. A dropped header, a
// renamed field or '+' for %20 would have been served the same recorded
// response and produced an identical corpus. Recording a violation and serving
// the response anyway would leave that state intact, which is why a breach
// fails the call.
//
// ===========================================================================
// THE HANDSHAKE
// ===========================================================================
// install() publishes what it patched, in which tree, from which file:
// `PARITY_HTTP_STATUS` receives the document, and an `install` record carries
// it in the evidence log for every run. It names this module's path and a
// digest of its contents - which is how "ONE implementation was loaded into
// both worktrees" (R-f) becomes provable rather than asserted - together with
// the app root and whether it verified, the required and active mechanisms,
// and the identity contract's state.
//
// `assertReady()` is the assertion a driver makes before trusting a run: it
// throws unless every required mechanism is active, the app root is the tree it
// claims to be, the identity contract holds - INCLUDING that the existing
// identity is one the seeder creates, which is required by default rather than
// on request - and no request contract has been breached.
//
// What this file cannot do is make another file call it. `capture.js`,
// `replay.js` and `server.js` belong to sibling work units and do not consume
// `PARITY_HTTP_STATUS`, `handshake()` or `assertReady()`, so nothing yet
// proves to a PARENT that the fixture it meant to attach is the one that
// attached. Two thirds of that gap is closed structurally rather than by
// agreement: an unprotected install and a declared-but-wrong app root
// TERMINATE the child, so a parent polling readiness cannot proceed past
// either. What remains is identity - a parent should read the handshake and
// require `installed`, every `required` mechanism active, `appRootVerified`,
// and the module path, digest and pid of the child it started - and that
// requires a change in those files.
//
// Load-order safety (AAP 0.6.5 defect 2): this module requires nothing from
// config/**, lib/models/** or lib/controllers/**. Reaching
// `mongoose-schema-extend` from a preload would replace the global
// Object.getPrototypeOf and make @hapi/hapi unloadable for the rest of the
// process.
//
// ===========================================================================
// ENVIRONMENT CONTRACT - the authoritative list. These are every variable this
// file reads, so test/parity/server.js can match it exactly. No unset or
// malformed value causes a throw.
//
// The first four are the ones a preload needs; the last four were added with
// the guarantees above and are all optional.
// ===========================================================================
//   PARITY_APP_ROOT          Absolute path of the worktree under test, used to
//                            resolve the application's own `request` package.
//                            FALLBACK: process.cwd(). The fallback is correct
//                            because test/parity/server.js spawns the
//                            application with the worktree under test as its
//                            working directory, while this file lives in the
//                            TARGET worktree - so `__dirname` would resolve
//                            the wrong tree's node_modules and is deliberately
//                            not used for resolution.
//   PARITY_HTTP_PROFILE      Name of the initial profile. Unset selects
//                            'default'. An unknown name also leaves 'default'
//                            in force and is logged - loading must not throw,
//                            because a throwing preload kills the server
//                            before app.js loads.
//   PARITY_HTTP_PROFILE_FILE Optional absolute path of a JSON file shaped
//                            {"profile": "<name>"}, RE-READ SYNCHRONOUSLY at
//                            the start of every intercepted call. This is how
//                            profiles switch WITHOUT restarting the server:
//                            test/parity/corpus.json carries a per-case
//                            `fixtureProfile`, and a single capture.js run
//                            drives the success, non-2xx, malformed-body,
//                            transport-failure and missing-field OAuth cases
//                            plus both streaming failure modes. No control
//                            socket and no network are involved. A missing,
//                            unreadable, malformed or unknown-name file leaves
//                            the previous profile in force and is logged,
//                            never thrown.
//   PARITY_HTTP_LOG          Optional evidence file. A strict no-op when
//                            unset. When set, one JSON record per intercepted
//                            call is appended synchronously - mechanism,
//                            endpoint, url, method, active profile, the
//                            outcome served, and the full description of what
//                            was SENT (method, redacted headers, body
//                            encoding, body field names, byte count, digest
//                            and redirect mode), with NO timestamp. Appending
//                            per call rather than only on flush() is
//                            deliberate: several profiles deliberately end in
//                            an uncaught throw or an unsettled request, and
//                            evidence has to survive that - it is also what
//                            lets the harness read a fatal child's evidence.
//                            Every write is guarded, so a logging fault can
//                            never propagate into the application.
//   PARITY_HTTP_STATUS       Optional path for the install handshake, written
//                            once at install and again on re-install. See THE
//                            HANDSHAKE. The same document always reaches the
//                            evidence log as an `install` record, so a run
//                            that sets nothing still carries it.
//   PARITY_HTTP_IDENTITIES   Optional JSON, {"existing": "...", "new": "..."},
//                            applied through setIdentityEmails() at load. This
//                            is how the seeder and this fixture stay aligned
//                            without either editing the other; a malformed or
//                            rejected value leaves the declared identities in
//                            force and is logged. See the SEEDING CONTRACT.
//   PARITY_HTTP_ASSET_URLS   Optional JSON array of additional absolute
//                            http(s) asset URLs to REGISTER. The registry
//                            fails closed, so a corpus that fetches an asset
//                            URL this file does not enumerate declares it
//                            here. A malformed entry is logged and ignored,
//                            which leaves it unregistered - that is, it still
//                            fails closed.
//   PARITY_HTTP_SELFTEST_CHILD
//                            Set by the harness on the children it spawns, and
//                            read ONLY when this file is executed directly.
//                            Never set by a preload and never read by one.
//
// ===========================================================================
// BASELINE RECORD (R-f) - measured, not assumed. Real `request` 2.88.2 driven
// against a loopback http server on Node v22.23.2, in a scratch directory
// outside the repository. Each line is a result, not an expectation.
// ===========================================================================
// Callback form:
//   json:true + JSON body  -> the callback's `body` argument is the PARSED
//                             object and `response.body` is the SAME reference.
//   no json  + JSON body   -> both are the raw STRING. This is the shape
//                             lib/util/recaptcha.js depends on: it parses
//                             `response.body`, not the `body` argument, so a
//                             parsed object there would change the outcome.
//   json:true + non-JSON   -> both stay the raw string; the guard
//                             `!body.access_token` does NOT throw.
//   json:true + 'null'     -> body === null, and the guard THROWS a TypeError.
//   json:true + empty body -> body === undefined, and the guard THROWS.
//   json:true + 404        -> err is NULL and the body is delivered normally.
//                             A non-2xx is not a transport error.
// Stream form (`.on()` returns self for every event; `.pipe()` returns the
// destination):
//   200            -> ['response:200', 'data', 'end']
//   query-bearing  -> identical sequence for '.../pic.png?v=2'
//   404            -> ['response:404', 'data', 'end'] - 'end' DOES fire, so the
//                     error page IS piped and uploaded, with the 404's own
//                     content-type. No 'error' event. This answers the
//                     non-2xx question the plan left open, by measurement.
//   302            -> ['redirect:302->/final', 'response:200', 'data', 'end'] -
//                     redirects ARE followed for GET, and the consumer's
//                     'response' handler observes ONLY the FINAL response, so
//                     the content-type it reads is the final response's and
//                     never the 302's. This answers the redirect question.
//   mid-stream cut -> ['response:200', 'data', 'error:ECONNRESET', 'end'] with
//                     the partial bytes on disk: 'error' AND 'end' both fire,
//                     so the upload proceeds with partial content.
//   refused        -> ['error:ECONNREFUSED'] alone. No 'response', no 'end',
//                     empty file, upload never starts, request unsettled.
//   refused Error  -> name 'Error', message 'connect ECONNREFUSED <host>:<port>',
//                     code 'ECONNREFUSED', errno -111, syscall 'connect'.
// Export surface: the module is itself callable and carries Request, cookie,
//   debug, defaults, del, delete, forever, get, head, initParams, jar,
//   options, patch, post, put - which is why every request-issuing entry point
//   is routed into one dispatcher instead of patching `get`/`post` alone.
// Node 22 fetch: a transport failure rejects with TypeError('fetch failed')
//   carrying a populated `cause`; lib/controllers/auth.js unwraps that cause,
//   so the cause must be the ECONNREFUSED Error itself.
// Web streams: enqueue-then-error inside a ReadableStream's `start()` DISCARDS
//   the queued chunk, so the mid-stream fetch profile uses a `pull()`-driven
//   stream that enqueues on the first pull and errors on the second. Measured
//   result: 'data' with the partial bytes, then 'error'.
//
// ===========================================================================
// NOTES OWED TO docs/baseline-parity.md (owned elsewhere)
// ===========================================================================
//   1. reCAPTCHA outcomes 3-6 are exercised by DIRECT MODULE-LEVEL INVOCATION
//      of lib/util/recaptcha.js's verify(), not through routes. Under
//      NODE_ENV=test, config.isTest is true (config/app.config.js sets
//      `config.isTest = node_env === 'test'`), so outcome 1 short-circuits
//      before any HTTP happens and always wins. What makes 3-6 reachable is a
//      direct require of lib/util/recaptcha.js WITHOUT loading
//      config/app.config - which leaves config.isTest undefined - together
//      with a present config.app.recaptcha.secretkey.
//
//      THAT INVOCATION LIVES IN THIS FILE, in recaptchaCases() and
//      childCases() under THE SELF-VERIFYING HARNESS, and it runs with
//      `node test/parity/fixtures/http.js`. It was previously described here
//      as though it happened somewhere, and it happened nowhere: no delivered
//      file required lib/util/recaptcha.js or called verify(), so all five
//      recorded siteverify responses were unexecuted code and the callback,
//      throw and no-callback behaviours could regress without a single
//      artifact changing. Outcomes 3 and 4 and the rejected variant of 3 run
//      in-process; outcomes 1 and 2 need mutually exclusive configuration
//      states and 5 and 6 kill the process without calling back, so those four
//      run in bounded child processes and are asserted by exit code, error
//      type, the absence of the callback marker, and the evidence the child
//      appended before it died.
//   2. The OAuth profiles have a configuration precondition. Both handlers
//      guard on config.app.auth && config.app.auth.google &&
//      config.app.auth.google.clientID and short-circuit to request.fail when
//      it is absent, and test/parity/server-overlay.json's declared contract
//      does not include app.auth.google. So clientID, clientSecret and
//      callbackURL MUST be present in the composed NODE_CONFIG for these
//      profiles to be reached through routes; the overlay owner or capture.js
//      supplies them. This module stays fully usable by direct invocation
//      either way.
//   3. The asset redirect and non-2xx behaviours encoded here were RECORDED
//      from the real library (see BASELINE RECORD above), not assumed: a
//      non-2xx still reaches 'end' and therefore uploads the error page, and a
//      redirect is followed for GET with only the final response observable.
//   4. The two redirect LIMITS this file enforces - 10 for the `request`
//      mechanism and 20 for native fetch - are DECLARED, not measured: the
//      package is not installed on the target tree and the runtime's limit is
//      not reachable without twenty real hops. They are exported as
//      `redirectLimits` so a caller asserts against the same numbers the
//      fixture used, and the 10-hop and 11-hop chains exist so the boundary
//      between them can be driven at all.
//
// ===========================================================================
// THE SELF-VERIFYING HARNESS, AND WHAT IT DOES NOT COVER
// ===========================================================================
// `node test/parity/fixtures/http.js` drives every profile in the catalogue
// and every reCAPTCHA outcome, and exits non-zero if any case fails or any
// profile went unselected. `selfTest()` is the same thing as a function, for a
// sibling tool that wants to fold the result into its own gate, and
// `--out <file>` writes the JSON report - there is no default output path, so
// running it never writes into the worktree.
//
// Called as a function it leaves the calling process EXACTLY as it found it,
// and proves it in its own last case: ownership of the genuine fetch is
// reclaimed before the tripwire is installed, and the installed state, the
// evidence and violation lists, the served counts, the active profile, the
// mutated node-config values and the presence as well as the value of every
// environment key it touched are all snapshotted and put back. The collections
// are restored as COPIES and after the re-install, because assigning the
// snapshot itself would alias it and the re-install's own handshake notes
// would grow the list this restore is measured against.
//
// It covers what this file can reach on its own. Three things it deliberately
// does NOT evidence, each of which belongs to another artifact:
//
//   The OAuth handlers themselves. lib/controllers/auth.js needs a hapi
//   request, a live database and the `log` and `User` globals app.js installs,
//   so the harness drives the two provider calls with the exact shapes the
//   controller sends and pins those shapes to the controller's own source
//   text (see the `sources` group). The controller's OUTCOMES - including the
//   preserved new-user save-then-fail - belong to test/parity/corpus.json,
//   which drives the real route.
//
//   The fifth auth-scheme outcome (app.js's `Auth error`, reached when
//   User.findById rejects). It needs a model-level fault injected into the
//   running application, not an HTTP response, and a preload may not require
//   lib/models/** at all - mongoose-schema-extend replaces the global
//   Object.getPrototypeOf and makes @hapi/hapi unloadable for the rest of the
//   process (AAP 0.6.5 defect 2). It belongs to the harness that owns app.js.
//
//   The worker's completion mail. That is test/parity/fixtures/mail.js's
//   record and test/parity/worker.js's assertion; nothing about it passes
//   through this file.
//
// ===========================================================================
// SEEDING CONTRACT
// ===========================================================================
// Which database branch googleCallback takes is decided by the EMAIL this
// fixture serves - there is no separate switch. User.findByMultiple queries an
// $or over the email, the derived username and profiles.google.id
// (lib/models/user.js:105-115), so:
//   identities.existing  MUST be an account test/parity/seed.js creates.
//   identities.new       MUST miss all three criteria - not a seeded email,
//                        not a seeded username, not a seeded Google id.
//
// `existing` is therefore the SEEDED DEFAULT USER, test@dummy.com, which
// test/parity/seed.js creates as IDENTITIES.user from the same literals
// test/helpers/defaults.js has always used. It used to be
// 'parity-existing@example.com', an address the seeder has never created - so
// the profile named `oauth:success-existing-user` actually drove the NEW-user
// branch, both OAuth scenarios exercised the same branch, and the
// existing-user branch went unexercised while appearing to be covered. The
// inversion is fixed here, in the artifact that decides it, rather than by
// waiting on a change to the seeder.
//
// A seeder that wants its own addresses supplies them through
// PARITY_HTTP_IDENTITIES or setIdentityEmails() rather than editing this file,
// so the two artifacts cannot drift. Either way the contract is CHECKED, not
// merely stated: checkIdentityContract() refuses a `new` identity that is a
// seeded email or derives a seeded username, refuses two identities that are
// equal, and reports an `existing` identity it cannot see in the seeded set -
// which assertReady({requireSeededIdentity: true}) turns into a hard failure
// for any driver that depends on the branch. The derived username is
// email.replace(/\W+/g, '-').toLowerCase(), exported as
// identities.existingUsername / identities.newUsername for the seeder's use.

'use strict';

var fs = require('fs');

// Node core, for the digest that lets two runs be compared byte-for-byte over
// bodies whose credential-bearing fields are redacted out of the evidence, and
// for the asset digests the storage contract keys on (AAP 0.6.7).
var crypto = require('crypto');

// Node core. Used ONLY by the self-verifying harness below, which runs when
// this file is executed directly: the two reCAPTCHA faults are process-level
// signatures - an uncaught throw and no callback - so they can only be asserted
// from outside the process they kill. Never touched on the preload path.
var childProcess = require('child_process');
var os = require('os');
var pathModule = require('path');

// The LEGACY stream base class, deliberately. The replaced library's Request
// object extends this class, so its `.pipe()` is Stream.prototype.pipe rather
// than Readable.prototype.pipe, and the two differ in how an 'error' on the
// source is propagated to the destination. Building the stream form on the
// same base as the original removes a whole class of difference that would
// otherwise belong to the harness rather than to the application (R-f).
var Stream = require('stream').Stream;

// ---------------------------------------------------------------------------
// Frozen constants. Everything a response can expose is a literal, because
// every one of these values reaches somewhere the corpus compares exactly:
// the access token is persisted onto user.profiles.google.token, the picture
// becomes user.avatar and is rendered into HTML, and the asset bytes decide
// the sha1 that becomes the stored S3 object key (AAP 0.6.7).
// ---------------------------------------------------------------------------

// Obviously synthetic, and deliberately unable to match any provider's token
// format so that secret scanners cannot mistake it for a credential.
var ACCESS_TOKEN = 'PARITY-FIXED-GOOGLE-ACCESS-TOKEN';

// Rendered into HTML as an avatar src. Never fetched by anything.
var PICTURE_URL = 'https://parity.example.com/avatars/google-fixed.png';

// Fixed Google account ids: stored on profiles.google.id and matched by
// findByMultiple.
var GOOGLE_ID_EXISTING = '100000000000000000001';
var GOOGLE_ID_NEW      = '100000000000000000002';

// A 42-byte 1x1 transparent GIF - the same shape of fixture the suite already
// uses for uploads. sha1 d5fceb6532643d0d84ffe09c40c481ecdf59e15a, which is
// the object key a successful asset upload must produce.
var ASSET_GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

// The first 21 bytes of that GIF: a truncated file, which is what the
// mid-stream failure uploads. sha1 8885cfafb2d7b043d78a4913bb5f3b0f405b0109.
var ASSET_GIF_PARTIAL = ASSET_GIF.subarray(0, 21);

// A 70-byte 1x1 PNG served as the FINAL response of the redirect profile, so
// that "the consumer observed the final response, not the 302" is provable
// from the stored bytes alone. sha1 9fb285daedf99a4dad5de09770de5fadf688d3ee.
var ASSET_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64'
);

// The body a 404 serves. Because a non-2xx still reaches 'end' (measured),
// these bytes really are uploaded, under content-type text/html.
// sha1 6196b3f53dcab9801e387f9e327228a3aaa9385a.
var ASSET_ERROR_PAGE = Buffer.from(
  '<html><head><title>404 Not Found</title></head><body>Not Found</body></html>',
  'utf8'
);

// The body a 500 serves. Kept DISTINCT from the 404 page: a 404 and a 500 are
// the same event to this call site - neither is a transport error, so both
// still reach 'end' and both are uploaded - but they store different bytes
// under different keys, and one record cannot evidence two statuses. sha1
// c6a3fa0e0b8b34a56a83b8e5e9f2c1eae4a4b3f2 is NOT asserted from a literal here;
// the digest is computed by the harness from these bytes, which is what makes
// the two cases separable in the evidence.
var ASSET_SERVER_ERROR_PAGE = Buffer.from(
  '<html><head><title>500 Internal Server Error</title></head><body>Internal Server Error</body></html>',
  'utf8'
);

// The three endpoints the application calls. Compared by origin + pathname
// through `new URL`, so a query string or a trailing difference in the
// caller's spelling cannot break matching.
var ENDPOINT_URLS = {
  recaptcha : 'https://www.google.com/recaptcha/api/siteverify',
  token     : 'https://oauth2.googleapis.com/token',
  userinfo  : 'https://www.googleapis.com/oauth2/v2/userinfo'
};

// The asset URLs the corpus should request. Exported so capture.js does not
// hard-code them. `query` exists because the upload filename is derived with
// path.basename() over a legacy `path` field that RETAINS the query string, so
// '?v=2' ends up inside the stored filename - behaviour lib/util/url.js
// preserves on the target tree and the corpus must exercise.
//
// This object is also the REGISTRY the asset endpoint matches against. An
// asset fetch is recognized by (origin, pathname) drawn from these entries and
// from the redirect-hop chain below - never by "it parsed and it was not one
// of the three JSON endpoints". See ASSET REGISTRY, FAIL CLOSED in the header.
var ASSET_URLS = {
  plain       : 'https://parity.example.com/assets/fixture.gif',
  query       : 'https://parity.example.com/assets/fixture.gif?v=2',
  redirect    : 'https://parity.example.com/assets/redirected.png',
  missing     : 'https://parity.example.com/assets/missing.gif',
  serverError : 'https://parity.example.com/assets/server-error.gif'
};

// Redirect hops. A redirect record is a CHAIN, and every hop has its own URL so
// that a caller which follows redirects itself - one fetch per hop with
// `redirect: 'manual'`, which is the only way to enforce a limit below the
// runtime's own - is served the same chain a following caller is. Hop n
// redirects to hop n+1, and the last hop redirects to the chain's destination.
var ASSET_HOP_PREFIX = 'https://parity.example.com/assets/redirect-hop/';

// The number of hops the two boundary profiles serve. `request` 2.88.2 allowed
// 10 redirects and native fetch allows 20, so a chain of 10 is inside both
// limits and a chain of 11 is inside fetch's and outside the replaced
// library's. Those two values are the boundary any redirect-limit claim about
// the asset call site has to be pinned against, so the fixture can serve it.
var ASSET_HOPS_WITHIN_LEGACY_LIMIT = 10;
var ASSET_HOPS_BEYOND_LEGACY_LIMIT = 11;

// The redirect limits each mechanism enforces. LEGACY is the replaced library's
// documented `maxRedirects` default; FETCH is the WHATWG/undici limit. Neither
// is measured here - `request` is not installed on the target tree and the
// runtime's limit is not reachable without 20 real hops - so both are declared
// as the contract the fixture enforces and are exported so a caller can assert
// against the same number the fixture used (R-f: declared, not passed off as
// measured).
var LEGACY_MAX_REDIRECTS = 10;
var FETCH_MAX_REDIRECTS   = 20;

// A URL no profile records, kept here so the no-escape-to-the-network path can
// be exercised by name instead of by inventing a string at the call site. It is
// deliberately on the SAME origin as the recorded asset URLs, so that it proves
// path-level registration rather than merely origin-level rejection.
var UNRECORDED_URL = 'https://parity.example.com/unrecorded/never-recorded';

// A URL on an origin nothing records at all. The asset endpoint used to accept
// any parseable http(s) URL, so an outbound call to an endpoint no profile
// describes - a new integration, or an SSRF payload reaching a host the
// application was never meant to contact - was served plausible asset bytes and
// looked like a success. That is the fail-open behaviour this fixture no longer
// has, and this constant is the control that proves it.
var UNREGISTERED_ORIGIN_URL = 'https://unregistered.invalid/some/path';

// ---------------------------------------------------------------------------
// Identities. The email decides the database branch, so these two values and
// the seeder must agree - see the SEEDING CONTRACT above.
// ---------------------------------------------------------------------------

// The transform lib/util/user.js applies to derive a username from an email.
// Replicated rather than required: this module imports no application source,
// and the expression is one line whose behaviour is fixed by the corpus.
function derivedUsername(email) {
  return String(email).replace(/\W+/g, '-').toLowerCase();
}

// The accounts test/parity/seed.js actually creates, as (email, username)
// pairs. Declared locally with their provenance rather than imported, because
// requiring test/helpers/** is prohibited in this folder and requiring
// test/parity/seed.js would pull lib/models/** - and therefore
// mongoose-schema-extend - into a preload, which is the load-order fault AAP
// 0.6.5 defect 2 describes. The values are copied verbatim from
// test/parity/seed.js's IDENTITIES block, which copies them in turn from
// test/helpers/defaults.js, so the three artifacts state one set of accounts.
//
// This list is what makes the identity contract CHECKABLE from inside the
// fixture: `existing` must be one of these, and `new` must be none of them.
var SEEDED_ACCOUNTS = [
  { email: 'test@dummy.com',        username: 'testing' },
  { email: 'admin@example.com',     username: 'administrator' },
  { email: 'disabled@example.com',  username: 'disableduser' }
];

// Which database branch googleCallback takes is decided by the EMAIL served
// here, matched by User.findByMultiple, whose query is an $or over the email,
// the derived username and profiles.google.id (lib/models/user.js:105-115). So
// `existing` has to be an address the seeder really creates and `new` has to
// miss all three criteria.
//
// `existing` is the SEEDED DEFAULT USER. It was 'parity-existing@example.com',
// which test/parity/seed.js has never seeded, so the profile named
// oauth:success-existing-user actually drove the NEW-user branch and the two
// OAuth database branches were inverted - both scenarios exercising one branch
// while the other went unexercised. Pointing the existing identity at the
// account the seeder does create removes the inversion here rather than by
// waiting on a second artifact, and assertIdentityContract() below refuses any
// configuration that could reintroduce it.
var identities = {
  existing         : SEEDED_ACCOUNTS[0].email,
  new              : 'parity-newcomer@example.com',
  existingUsername : derivedUsername(SEEDED_ACCOUNTS[0].email),
  newUsername      : derivedUsername('parity-newcomer@example.com')
};

// Applies an alignment, validating each address. Exposed as setIdentityEmails()
// and called at load time from PARITY_HTTP_IDENTITIES, so the documented hook
// has a caller in every process that loads this file instead of only in
// principle.
function applyIdentityEmails(next) {
  if (!next || typeof next !== 'object') {
    throw new Error('test/parity/fixtures/http.js: setIdentityEmails requires an object with `existing` and/or `new`');
  }

  ['existing', 'new'].forEach(function(key) {
    if (next[key] === undefined) {
      return;
    }

    if (typeof next[key] !== 'string' || next[key].indexOf('@') === -1) {
      throw new Error('test/parity/fixtures/http.js: setIdentityEmails `' + key +
        '` must be an email address');
    }
  });

  if (next.existing !== undefined) {
    identities.existing = next.existing;
    identities.existingUsername = derivedUsername(next.existing);
  }

  if (next.new !== undefined) {
    identities.new = next.new;
    identities.newUsername = derivedUsername(next.new);
  }

  return {
    existing         : identities.existing,
    new              : identities.new,
    existingUsername : identities.existingUsername,
    newUsername      : identities.newUsername
  };
}

// Checks the two identities against the seeded set and against each other, and
// reports every violation rather than the first. The check is deliberately
// conservative about `existing`: an address the fixture cannot see in
// SEEDED_ACCOUNTS is not necessarily unseeded - a seeder may have been extended
// - so it is reported as UNVERIFIED and only becomes a violation when
// `requireSeeded` is set, which is what a harness driving the OAuth branches
// passes. `new` is different: an address that IS in the seeded set, or whose
// derived username collides with a seeded username, provably inverts the
// new-user branch, so it is always a violation.
function checkIdentityContract(options) {
  var opts = options || {};
  var violations = [];
  var unverified = [];

  var existingSeeded = SEEDED_ACCOUNTS.some(function(account) {
    return account.email === identities.existing;
  });

  if (!existingSeeded) {
    var message = 'identities.existing ' + JSON.stringify(identities.existing) +
      ' is not one of the accounts this fixture knows test/parity/seed.js to ' +
      'create (' + SEEDED_ACCOUNTS.map(function(a) { return a.email; }).join(', ') +
      '). The OAuth existing-user branch is only exercised when the served ' +
      'email matches a seeded account, so either seed this address or align ' +
      'through setIdentityEmails()/PARITY_HTTP_IDENTITIES.';

    if (opts.requireSeeded) {
      violations.push(message);
    }
    else {
      unverified.push(message);
    }
  }

  SEEDED_ACCOUNTS.forEach(function(account) {
    if (account.email === identities.new) {
      violations.push('identities.new ' + JSON.stringify(identities.new) +
        ' is a SEEDED account, so the OAuth new-user branch cannot be reached: ' +
        'User.findByMultiple would match it and the existing-user branch would ' +
        'run instead');
    }

    if (account.username === identities.newUsername) {
      violations.push('identities.new ' + JSON.stringify(identities.new) +
        ' derives the username ' + JSON.stringify(identities.newUsername) +
        ', which is the seeded username of ' + JSON.stringify(account.email) +
        '. User.findByMultiple matches on the derived username as well as the ' +
        'email, so the new-user branch cannot be reached.');
    }
  });

  if (identities.existing === identities.new) {
    violations.push('identities.existing and identities.new are the same ' +
      'address, so the two OAuth database branches cannot be distinguished');
  }

  if (GOOGLE_ID_EXISTING === GOOGLE_ID_NEW) {
    violations.push('the two Google account ids are equal, so ' +
      'profiles.google.id would match the seeded user on the new-user branch');
  }

  return {
    existing         : identities.existing,
    existingUsername : identities.existingUsername,
    existingSeeded   : existingSeeded,
    new              : identities.new,
    newUsername      : identities.newUsername,
    seededAccounts   : SEEDED_ACCOUNTS.map(function(a) { return a.email; }),
    unverified       : unverified,
    violations       : violations,
    ok               : !violations.length
  };
}

// ---------------------------------------------------------------------------
// Response records.
//
// A record for one of the three JSON endpoints is exactly one of:
//   {outcome, status, headers, json}  - the body is JSON.stringify(json), so
//                                       the served bytes are a stable literal.
//   {outcome, status, headers, body}  - a raw body string, used where the
//                                       point of the case is that the body is
//                                       NOT valid JSON.
//   {outcome, transport: {...}}       - a transport failure, delivered in each
//                                       mechanism's own failure shape.
//   {outcome, recorded: false}        - nothing recorded; deterministic
//                                       failure, never a network call.
//
// An asset record is {outcome, mode, status, contentType, bytes, ...} where
// mode is one of 'complete', 'non-2xx', 'redirect', 'refused' or 'midstream'.
// Modes exist because the four failure shapes are not variations on a status
// code - they differ in which EVENTS fire, and the events are what the
// controller branches on.
//
// A record may be a function returning a record, which is how the two OAuth
// profile bodies pick up a later setIdentityEmails() call.
// ---------------------------------------------------------------------------

var JSON_HEADERS = { 'content-type': 'application/json; charset=UTF-8' };
var HTML_HEADERS = { 'content-type': 'text/html; charset=UTF-8' };

// reCAPTCHA outcome 3: a 200 whose body is a realistic siteverify payload.
// `challenge_ts` is a FROZEN literal, not a generated timestamp.
var RECAPTCHA_SUCCESS = {
  outcome : 'recaptcha-200-success',
  status  : 200,
  headers : JSON_HEADERS,
  json    : {
    success      : true,
    challenge_ts : '2015-06-15T12:00:00Z',
    hostname     : 'localhost',
    score        : 0.9,
    action       : 'submit'
  }
};

// Also outcome 3 structurally - a 200 the module parses successfully - but the
// provider says no. It is recorded separately because it is the only way to
// reach the request.fail edges that branch on `recaptcha_result.success` in
// lib/controllers/users.js (create and sendEmailVerification), which the
// error-edge inventory needs (AAP 0.6.3).
var RECAPTCHA_REJECTED = {
  outcome : 'recaptcha-200-rejected',
  status  : 200,
  headers : JSON_HEADERS,
  json    : {
    success        : false,
    challenge_ts   : '2015-06-15T12:00:00Z',
    hostname       : 'localhost',
    'error-codes'  : ['invalid-input-response']
  }
};

// reCAPTCHA outcome 4: any non-200 makes verify() call back with the
// differently shaped {status: false}. That key is `status`, not `success`, and
// the two shapes are deliberately NOT unified: callers test `success`, so a
// non-200 is not merely a falsy success but a different object (R-d).
var RECAPTCHA_NON_200 = {
  outcome : 'recaptcha-503',
  status  : 503,
  headers : HTML_HEADERS,
  body    : '<html><body>Service Unavailable</body></html>'
};

// reCAPTCHA outcome 5: a transport failure. `err` is never inspected, so
// `response` stays undefined and reading `response.statusCode` throws an
// uncaught TypeError. verify()'s callback is NEVER invoked.
var RECAPTCHA_TRANSPORT_FAILURE = {
  outcome   : 'recaptcha-transport-failure',
  transport : { code: 'ECONNREFUSED', host: 'www.google.com', port: 443 }
};

// reCAPTCHA outcome 6: a 200 whose body is not JSON. JSON.parse throws an
// uncaught SyntaxError and verify()'s callback is NEVER invoked.
var RECAPTCHA_MALFORMED_JSON = {
  outcome : 'recaptcha-200-malformed-json',
  status  : 200,
  headers : HTML_HEADERS,
  body    : '<html><body>not json</body></html>'
};

// Google token exchange: the success case. `access_token` is the frozen
// constant because it is persisted onto user.profiles.google.token.
var TOKEN_SUCCESS = {
  outcome : 'token-200-success',
  status  : 200,
  headers : JSON_HEADERS,
  json    : {
    access_token : ACCESS_TOKEN,
    expires_in   : 3599,
    scope        : 'https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile',
    token_type   : 'Bearer'
  }
};

// A non-2xx from the token endpoint. Measured: `err` is null and the JSON body
// is still parsed, so the guard sees an object with no access_token and
// rejects - reaching the generic authentication failure, not a throw.
var TOKEN_NON_2XX = {
  outcome : 'token-400-invalid-grant',
  status  : 400,
  headers : JSON_HEADERS,
  json    : { error: 'invalid_grant', error_description: 'Bad Request' }
};

// A 200 carrying an object that simply has no access_token: same reject, same
// generic failure, different provider fault.
var TOKEN_MALFORMED_BODY = {
  outcome : 'token-200-no-access-token',
  status  : 200,
  headers : JSON_HEADERS,
  json    : { token_type: 'Bearer', expires_in: 3599 }
};

// A 200 whose body parses to a NON-OBJECT. Measured on the real library: a
// body of 'null' arrives as null, and `!body.access_token` then throws a
// TypeError out of the callback - an uncaught exception that leaves the
// request unanswered rather than producing the generic failure. Recorded as a
// separate profile because the outcome differs from the case above, and
// preserved rather than tidied (R-d).
var TOKEN_NON_OBJECT_BODY = {
  outcome : 'token-200-null-body',
  status  : 200,
  headers : JSON_HEADERS,
  body    : 'null'
};

var TOKEN_TRANSPORT_FAILURE = {
  outcome   : 'token-transport-failure',
  transport : { code: 'ECONNREFUSED', host: 'oauth2.googleapis.com', port: 443 }
};

// Google profile fetch. `picture` is the frozen constant because it becomes
// user.avatar and is rendered into HTML. Built through a function so that a
// setIdentityEmails() call is picked up.
function userinfoExisting() {
  return {
    outcome : 'userinfo-200-existing-user',
    status  : 200,
    headers : JSON_HEADERS,
    json    : {
      id             : GOOGLE_ID_EXISTING,
      email          : identities.existing,
      verified_email : true,
      name           : 'Parity Existing User',
      given_name     : 'Parity',
      family_name    : 'Existing User',
      picture        : PICTURE_URL,
      locale         : 'en'
    }
  };
}

// The same shape with an UNSEEDED email, which is the whole mechanism for
// selecting the new-user branch. The controller then saves the user, sets the
// yar `next` and `grantDemoTrinkets` values, and throws a ReferenceError on an
// undefined `opts` - so the account is created and a generic failure is
// reported. That outcome is reproduced deliberately (R-d ruling 3, AAP 0.6.6).
function userinfoNew() {
  return {
    outcome : 'userinfo-200-new-user',
    status  : 200,
    headers : JSON_HEADERS,
    json    : {
      id             : GOOGLE_ID_NEW,
      email          : identities.new,
      verified_email : true,
      name           : 'Parity Newcomer',
      given_name     : 'Parity',
      family_name    : 'Newcomer',
      picture        : PICTURE_URL,
      locale         : 'en'
    }
  };
}

// A 200 profile with no email at all: the guard rejects and the chain answers
// with the generic authentication failure.
var USERINFO_MISSING_EMAIL = {
  outcome : 'userinfo-200-missing-email',
  status  : 200,
  headers : JSON_HEADERS,
  json    : {
    id          : GOOGLE_ID_EXISTING,
    name        : 'Parity No Email',
    given_name  : 'Parity',
    family_name : 'No Email',
    picture     : PICTURE_URL,
    locale      : 'en'
  }
};

var USERINFO_TRANSPORT_FAILURE = {
  outcome   : 'userinfo-transport-failure',
  transport : { code: 'ECONNREFUSED', host: 'www.googleapis.com', port: 443 }
};

// Asset records. `mode` selects the event sequence, which is the observable
// that matters - see BASELINE RECORD above for the measured sequences.
var ASSET_COMPLETE = {
  outcome     : 'asset-200-complete',
  mode        : 'complete',
  status      : 200,
  contentType : 'image/gif',
  bytes       : ASSET_GIF
};

// A 404 still reaches 'end' (measured), so the error page really is uploaded,
// with the 404's own content-type. Preserved exactly: this is the recorded
// baseline, not a convenience.
var ASSET_NON_2XX = {
  outcome     : 'asset-404-uploaded',
  mode        : 'non-2xx',
  status      : 404,
  contentType : 'text/html; charset=UTF-8',
  bytes       : ASSET_ERROR_PAGE
};

// A 500 is the same EVENT as the 404 - not a transport error, so it still
// reaches 'end' and its body is uploaded - but a different status, different
// bytes and therefore a different stored key. Recorded separately because one
// record cannot evidence two statuses, and because a status-class test that
// only ever sees 404 says nothing about 5xx.
var ASSET_SERVER_ERROR = {
  outcome     : 'asset-500-uploaded',
  mode        : 'non-2xx',
  status      : 500,
  contentType : 'text/html; charset=UTF-8',
  bytes       : ASSET_SERVER_ERROR_PAGE
};

// A 302 is followed for GET and only the FINAL response is observable, so the
// record carries the final status, the final content-type and the final bytes,
// with the intermediate hops carried separately.
//
// `hops` is the chain, one entry per intermediate response, and it is what
// makes redirect behaviour testable in three directions at once: a caller that
// follows (the asset call site) observes only the final response; a caller that
// asks for 'manual' observes the FIRST hop, status and Location intact, which
// is the only shape a hop-counting loop can work from; and a chain longer than
// the mechanism's limit fails instead of succeeding. `redirectStatus` and
// `redirectLocation` are retained because the `request` stream form announces
// the first hop through its own 'redirect' event.
function redirectChain(hopCount, destination) {
  var hops = [];

  for (var i = 1; i <= hopCount; i++) {
    hops.push({
      status   : 302,
      // Hop i points at hop i+1, and the last hop points at the destination.
      location : (i === hopCount ? destination : ASSET_HOP_PREFIX + (i + 1))
    });
  }

  return hops;
}

var ASSET_REDIRECT = {
  outcome            : 'asset-302-followed',
  mode               : 'redirect',
  status             : 200,
  contentType        : 'image/png',
  bytes              : ASSET_PNG,
  hops               : redirectChain(1, ASSET_URLS.redirect),
  redirectStatus     : 302,
  redirectLocation   : ASSET_URLS.redirect
};

// A chain of exactly 10 hops: inside both the replaced library's limit and the
// runtime's, so it must still deliver the final response on either mechanism.
var ASSET_REDIRECT_WITHIN_LIMIT = {
  outcome            : 'asset-302-chain-within-legacy-limit',
  mode               : 'redirect',
  status             : 200,
  contentType        : 'image/png',
  bytes              : ASSET_PNG,
  hops               : redirectChain(ASSET_HOPS_WITHIN_LEGACY_LIMIT, ASSET_URLS.redirect),
  redirectStatus     : 302,
  redirectLocation   : ASSET_HOP_PREFIX + '2'
};

// A chain of 11 hops: outside the replaced library's 10 and inside the
// runtime's 20. This is the boundary where the two mechanisms disagree, and
// serving it is how a claim about which limit the call site now enforces stops
// being an assertion in a comment. On the `request` mechanism the fixture
// enforces LEGACY_MAX_REDIRECTS and the chain fails; through native fetch it is
// followed, which is exactly the drift the migration has to be able to see.
var ASSET_REDIRECT_BEYOND_LIMIT = {
  outcome            : 'asset-302-chain-beyond-legacy-limit',
  mode               : 'redirect',
  status             : 200,
  contentType        : 'image/png',
  bytes              : ASSET_PNG,
  hops               : redirectChain(ASSET_HOPS_BEYOND_LEGACY_LIMIT, ASSET_URLS.redirect),
  redirectStatus     : 302,
  redirectLocation   : ASSET_HOP_PREFIX + '2'
};

// 'error' only, and NEVER 'end': the upload does not start and the route is
// left unsettled (R-d ruling 2).
var ASSET_REFUSED = {
  outcome   : 'asset-transport-refused',
  mode      : 'refused',
  transport : { code: 'ECONNREFUSED', host: 'parity.example.com', port: 443 }
};

// 'response', partial bytes, 'error', and then 'end' as well, so the upload
// proceeds with partial content. Kept strictly separate from the refused case
// because the two outcomes must stay distinguishable.
var ASSET_MIDSTREAM = {
  outcome     : 'asset-midstream-failure',
  mode        : 'midstream',
  status      : 200,
  contentType : 'image/gif',
  bytes       : ASSET_GIF_PARTIAL,
  transport   : { code: 'ECONNRESET', message: 'socket hang up' }
};

// Nothing recorded for this endpoint under this profile.
var NOT_RECORDED = { outcome: 'unrecorded', recorded: false };

// ---------------------------------------------------------------------------
// The profile catalogue. Every profile is layered over 'default', so a profile
// declares only the endpoint it is about and no call can land on a hole by
// accident. 'none' is the deliberate exception: it records nothing, and exists
// so the no-escape-to-the-network path can be exercised for every endpoint.
// ---------------------------------------------------------------------------

var DEFAULT_PROFILE = {
  description : 'Every endpoint succeeds; OAuth resolves to the seeded existing user.',
  recaptcha   : RECAPTCHA_SUCCESS,
  token       : TOKEN_SUCCESS,
  userinfo    : userinfoExisting,
  asset       : ASSET_COMPLETE
};

var PROFILES = {
  'default' : DEFAULT_PROFILE,

  'recaptcha:success'           : { description: 'siteverify 200, success true.', recaptcha: RECAPTCHA_SUCCESS },
  'recaptcha:rejected'          : { description: 'siteverify 200, success false - reaches the request.fail edges.', recaptcha: RECAPTCHA_REJECTED },
  'recaptcha:non-200'           : { description: 'siteverify 503 - verify() calls back with {status:false}.', recaptcha: RECAPTCHA_NON_200 },
  'recaptcha:transport-failure' : { description: 'siteverify transport failure - uncaught TypeError, no callback.', recaptcha: RECAPTCHA_TRANSPORT_FAILURE },
  'recaptcha:malformed-json'    : { description: 'siteverify 200 with a non-JSON body - uncaught SyntaxError, no callback.', recaptcha: RECAPTCHA_MALFORMED_JSON },

  'oauth:success-existing-user'    : { description: 'Token and profile succeed; the email is the seeded user.', token: TOKEN_SUCCESS, userinfo: userinfoExisting },
  'oauth:success-new-user'         : { description: 'Token and profile succeed; the email is unseeded, so the account is created and a generic failure is reported.', token: TOKEN_SUCCESS, userinfo: userinfoNew },
  'oauth:token-non-2xx'            : { description: 'Token endpoint 400 - generic authentication failure.', token: TOKEN_NON_2XX },
  'oauth:token-malformed-body'     : { description: 'Token endpoint 200 with no access_token - generic authentication failure.', token: TOKEN_MALFORMED_BODY },
  'oauth:token-non-object-body'    : { description: 'Token endpoint 200 whose body parses to null - uncaught TypeError, request unanswered.', token: TOKEN_NON_OBJECT_BODY },
  'oauth:token-transport-failure'  : { description: 'Token endpoint transport failure - generic authentication failure.', token: TOKEN_TRANSPORT_FAILURE },
  'oauth:profile-missing-email'    : { description: 'Profile 200 with no email - generic authentication failure.', token: TOKEN_SUCCESS, userinfo: USERINFO_MISSING_EMAIL },
  'oauth:profile-transport-failure': { description: 'Profile endpoint transport failure - generic authentication failure.', token: TOKEN_SUCCESS, userinfo: USERINFO_TRANSPORT_FAILURE },

  'asset:success'           : { description: 'response, fixed bytes, end - the upload stores sha1 d5fceb6532643d0d84ffe09c40c481ecdf59e15a.', asset: ASSET_COMPLETE },
  'asset:non-2xx'           : { description: '404 that still reaches end, so the error page is uploaded as text/html.', asset: ASSET_NON_2XX },
  'asset:server-error'      : { description: '500 that still reaches end, so the error page is uploaded - a distinct status and distinct stored bytes from the 404.', asset: ASSET_SERVER_ERROR },
  'asset:redirect'          : { description: '302 followed for GET; only the final 200 is observable.', asset: ASSET_REDIRECT },
  'asset:redirect-within-limit' : { description: 'A 10-hop chain: inside both the legacy 10-redirect limit and the runtime\'s 20, so the final response is still delivered.', asset: ASSET_REDIRECT_WITHIN_LIMIT },
  'asset:redirect-beyond-limit' : { description: 'An 11-hop chain: outside the legacy limit and inside the runtime\'s, which is the boundary where the two mechanisms disagree.', asset: ASSET_REDIRECT_BEYOND_LIMIT },
  'asset:transport-refused' : { description: 'error only, never end - the upload never starts and the route is unsettled.', asset: ASSET_REFUSED },
  'asset:midstream-failure' : { description: 'response, partial bytes, error, then end - the partial content is uploaded.', asset: ASSET_MIDSTREAM },

  'none' : {
    description : 'Nothing recorded. Every endpoint fails deterministically in its own mechanism\'s failure shape, proving no path reaches the network.',
    recaptcha   : NOT_RECORDED,
    token       : NOT_RECORDED,
    userinfo    : NOT_RECORDED,
    asset       : NOT_RECORDED
  }
};

var DEFAULT_PROFILE_NAME = 'default';

// ---------------------------------------------------------------------------
// Exit codes. The first three are the convention every tool in test/parity/
// uses; the fourth is this file's own, and it is deliberately distinguishable
// from a failing assertion because the two mean different things: a failed
// case is a result, whereas an unprotected process is a run that must not
// produce evidence at all.
// ---------------------------------------------------------------------------
var EXIT_OK          = 0;
var EXIT_ERROR       = 1;
var EXIT_USAGE       = 2;
var EXIT_UNPROTECTED = 4;

// ---------------------------------------------------------------------------
// Module state. Held in one object so install()/restore() can be idempotent
// and so a second require() of this file - which returns the same cached
// exports - cannot double-patch anything.
// ---------------------------------------------------------------------------
var state = {
  installed        : false,
  activeProfile    : DEFAULT_PROFILE_NAME,
  requestPatched   : false,
  fetchPatched     : false,
  requestRequired  : false,  // `request` resolves from appRoot, so it MUST be patched
  requestModule    : null,   // the Module record whose exports were swapped
  originalRequest  : null,   // the genuine `request` export, for restore()
  originalFetch    : null,   // the genuine globalThis.fetch, for restore()
  resolveDiagnostic: null,   // why the `request` mechanism is inactive, if it is
  profileFileState : null,   // last value read from PARITY_HTTP_PROFILE_FILE
  calls            : [],
  // Every breach of a request contract, kept separately from the log so
  // assertRequestContract() can answer without re-reading the evidence file.
  contractViolations : [],
  // One counter per (endpoint, profile, outcome) actually served. A fixture
  // profile check that cannot see whether a call happened at all can pass on an
  // empty run, so the counts are part of the evidence rather than derived from
  // it after the fact.
  served           : {},
  // The install handshake: what was patched, in which tree, by which file.
  handshake        : null
};

// The digest used for body evidence and for the asset-byte digests the storage
// contract keys on. sha1 rather than something stronger deliberately:
// lib/util/file.js derives the stored S3 object key from the sha1 of the
// uploaded bytes, so this is the value a storage assertion has to compare
// against (AAP 0.6.7).
function sha1(value) {
  return crypto.createHash('sha1')
    .update(Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8'))
    .digest('hex');
}

// ---------------------------------------------------------------------------
// Evidence log. Nothing here may ever throw into the application, and nothing
// here may emit to stdout or stderr: the zero-warning gate captures both
// streams for the whole run (AAP 0.8).
// ---------------------------------------------------------------------------

// Appends one record and, when PARITY_HTTP_LOG is set, writes it through
// immediately. Writing per call rather than only on flush() is deliberate:
// `recaptcha:transport-failure`, `recaptcha:malformed-json` and
// `oauth:token-non-object-body` end in an uncaught throw and
// `asset:transport-refused` never settles, so evidence buffered in memory
// would be lost exactly where it is most needed.
function record(entry) {
  state.calls.push(entry);

  var target = process.env.PARITY_HTTP_LOG;
  if (!target) {
    return;                                  // strict no-op when unset
  }

  try {
    fs.appendFileSync(target, JSON.stringify(entry) + '\n');
  }
  catch (e) {
    // A logging fault is not the application's problem. It is retained in
    // memory and surfaced by calls(), which is where a harness looks.
    state.calls.push({ event: 'log-write-failed', error: e.message });
  }
}

// Records something about the fixture itself rather than about an intercepted
// call - an unknown profile name, an unreadable profile file, a mechanism that
// could not be patched. Same guarantees, same destination.
//
// Every record written through here carries an `event` key, and every record
// written through recordCall() does not. That is not a style choice:
// test/parity/replay.js classifies the fixture's log by exactly that key, so an
// `event`-bearing record is counted as a fixture note and an `event`-free one
// as an intercepted call served under the profile named at its top level.
function note(event, detail) {
  record({ event: event, detail: detail === undefined ? null : detail });
}

// Records one intercepted call: the endpoint, the mechanism, the outcome
// served, and the full description of what was sent. The five original fields
// keep their names and their position at the top level, so every existing
// consumer reads it unchanged; `request` and `registration` are additions.
function recordCall(classified, mechanism, description, outcome) {
  var endpoint = classified.endpoint || 'unknown';
  var key = endpoint + '|' + state.activeProfile + '|' + outcome;

  state.served[key] = (state.served[key] || 0) + 1;

  record({
    mechanism    : mechanism,
    endpoint     : endpoint,
    url          : redactUrl(classified.url),
    method       : description ? description.method : null,
    profile      : state.activeProfile,
    outcome      : outcome,
    registration : classified.registration || null,
    reason       : classified.reason || null,
    request      : description || null
  });
}

// Rewrites PARITY_HTTP_LOG with the complete set of records held in memory.
// Exposed for a harness that wants one self-contained artifact rather than the
// append stream; a strict no-op when the variable is unset, and it never
// throws. Returns the path written, or null.
function flush() {
  var target = process.env.PARITY_HTTP_LOG;
  if (!target) {
    return null;
  }

  try {
    var lines = state.calls.map(function(entry) {
      return JSON.stringify(entry);
    });

    // The directory is NOT created here. The harness owns the log path, the
    // per-call append does not create directories either - so the two paths
    // stay consistent - and a recursive mkdir is not a safe operation to run
    // blind from inside a request: measured on this host,
    // fs.mkdirSync('/proc/<missing>/<missing>', {recursive: true}) BLOCKS
    // indefinitely where appendFileSync on the same path returns ENOENT at
    // once. A fixture must never be able to stall the process it is loaded
    // into.
    fs.writeFileSync(target, lines.length ? lines.join('\n') + '\n' : '');
    return target;
  }
  catch (e) {
    state.calls.push({ event: 'log-flush-failed', error: e.message });
    return null;
  }
}

// ---------------------------------------------------------------------------
// Profile selection.
// ---------------------------------------------------------------------------

// Resolves the record for one endpoint under the active profile, layering the
// profile over 'default' so that a profile which says nothing about an
// endpoint still serves a recorded response rather than a hole.
function recordFor(endpoint) {
  var profile = PROFILES[state.activeProfile] || DEFAULT_PROFILE;
  var entry = Object.prototype.hasOwnProperty.call(profile, endpoint)
    ? profile[endpoint]
    : DEFAULT_PROFILE[endpoint];

  return typeof entry === 'function' ? entry() : entry;
}

// Re-reads PARITY_HTTP_PROFILE_FILE synchronously. Called at the start of
// every intercepted call, which is what lets capture.js switch profiles
// between corpus cases without restarting the server. Every failure mode -
// unset, absent, unreadable, malformed, unknown name - leaves the profile
// already in force untouched, is logged, and never throws.
function refreshProfileFromFile() {
  var file = process.env.PARITY_HTTP_PROFILE_FILE;
  if (!file) {
    return;
  }

  var raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  }
  catch (e) {
    if (state.profileFileState !== 'unreadable') {
      state.profileFileState = 'unreadable';
      note('profile-file-unreadable', { file: file, error: e.code || e.message, keeping: state.activeProfile });
    }
    return;
  }

  var parsed;
  try {
    parsed = JSON.parse(raw);
  }
  catch (e) {
    if (state.profileFileState !== 'malformed') {
      state.profileFileState = 'malformed';
      note('profile-file-malformed', { file: file, keeping: state.activeProfile });
    }
    return;
  }

  var name = parsed && parsed.profile;
  if (typeof name !== 'string' || !name) {
    if (state.profileFileState !== 'no-profile-key') {
      state.profileFileState = 'no-profile-key';
      note('profile-file-missing-key', { file: file, keeping: state.activeProfile });
    }
    return;
  }

  if (!Object.prototype.hasOwnProperty.call(PROFILES, name)) {
    if (state.profileFileState !== 'unknown:' + name) {
      state.profileFileState = 'unknown:' + name;
      note('profile-file-unknown-name', { file: file, requested: name, keeping: state.activeProfile });
    }
    return;
  }

  state.profileFileState = 'ok:' + name;
  if (state.activeProfile !== name) {
    state.activeProfile = name;
    note('profile-changed', { via: 'file', profile: name });
  }
}

// Selects a profile directly. Unlike the file, an unknown name here is a
// programming error at the point of selection and is rejected loudly, which is
// what the exported catalogue exists to prevent.
function setProfile(name) {
  if (!Object.prototype.hasOwnProperty.call(PROFILES, name)) {
    throw new Error(
      'test/parity/fixtures/http.js: unknown profile ' + JSON.stringify(name) +
      '. Valid profiles: ' + Object.keys(PROFILES).join(', ')
    );
  }

  if (state.activeProfile !== name) {
    state.activeProfile = name;
    note('profile-changed', { via: 'setProfile', profile: name });
  }

  return name;
}

// ---------------------------------------------------------------------------
// Endpoint classification. `new URL` only - never url.parse, which emits
// DEP0169 on every call (AAP 0.8).
// ---------------------------------------------------------------------------

// Extracts the URL from either accepted call shape: a bare string, a WHATWG
// URL, or the options object the application passes ({url: ...}). `uri` is
// accepted as well because the replaced library treated the two as synonyms
// and a future call site might use either.
function urlFrom(target) {
  if (typeof target === 'string') {
    return target;
  }

  if (target instanceof URL) {
    return target.href;
  }

  if (target && typeof target === 'object') {
    if (typeof target.url === 'string') return target.url;
    if (target.url instanceof URL) return target.url.href;
    if (typeof target.uri === 'string') return target.uri;
    if (target.uri instanceof URL) return target.uri.href;
    // A WHATWG Request, which is what a `fetch(new Request(...))` call passes.
    if (typeof target.href === 'string') return target.href;
  }

  return null;
}

// ---------------------------------------------------------------------------
// The registry every URL is matched against. Both halves are (origin,
// pathname) keys built with `new URL`, so a query string, a port spelled
// explicitly or a caller's trailing-slash habit cannot break matching, while an
// origin or a path nothing records cannot slip through either.
// ---------------------------------------------------------------------------

// origin + pathname, the key form used on both sides of the match.
function endpointKey(parsed) {
  return parsed.origin + parsed.pathname;
}

// Builds the asset half of the registry: the enumerated asset URLs plus every
// redirect hop any profile can serve. Hops are registered because a caller
// following a chain itself requests each hop URL in turn, and an unregistered
// hop would fail as an unrecorded endpoint half way through its own chain.
//
// Memoized on the declared-URL variable rather than built per call, because
// classify() runs several times per intercepted request. The key is the
// variable's own value, so a corpus that registers a URL mid-run still takes
// effect on its next call - the registry is re-derived exactly when its input
// changes and not otherwise.
var assetRegistryCache = { key: null, registry: null };

function buildAssetRegistry() {
  var declaredKey = process.env.PARITY_HTTP_ASSET_URLS || '';
  if (assetRegistryCache.registry && assetRegistryCache.key === declaredKey) {
    return assetRegistryCache.registry;
  }

  var registry = {};
  var maxHops = Math.max(ASSET_HOPS_WITHIN_LEGACY_LIMIT, ASSET_HOPS_BEYOND_LEGACY_LIMIT);

  Object.keys(ASSET_URLS).forEach(function(name) {
    registry[endpointKey(new URL(ASSET_URLS[name]))] = 'asset:' + name;
  });

  for (var hop = 1; hop <= maxHops; hop++) {
    registry[endpointKey(new URL(ASSET_HOP_PREFIX + hop))] = 'asset:hop-' + hop;
  }

  // Additional asset URLs a corpus may need, declared through the environment
  // rather than by editing this file - which is the supported way to extend the
  // registry, precisely because extending it has to be a deliberate act. Each
  // entry must be an absolute http(s) URL; anything else is logged and ignored,
  // and ignoring it means the URL stays unrecorded, which fails closed.
  var declared = process.env.PARITY_HTTP_ASSET_URLS;
  if (declared) {
    var parsedList = null;
    try {
      parsedList = JSON.parse(declared);
    }
    catch (e) {
      note('asset-registry-malformed', { value: declared });
    }

    if (parsedList && Array.isArray(parsedList)) {
      parsedList.forEach(function(entry) {
        try {
          var url = new URL(String(entry));
          if (url.protocol !== 'http:' && url.protocol !== 'https:') {
            note('asset-registry-rejected', { entry: String(entry), reason: 'unsupported-protocol:' + url.protocol });
            return;
          }
          registry[endpointKey(url)] = 'asset:declared';
        }
        catch (e) {
          note('asset-registry-rejected', { entry: String(entry), reason: 'unparseable-url' });
        }
      });
    }
    else if (parsedList) {
      note('asset-registry-rejected', { value: declared, reason: 'not-an-array' });
    }
  }

  assetRegistryCache.key = declaredKey;
  assetRegistryCache.registry = registry;

  return registry;
}

// Maps a URL onto one of the four endpoint classes, FAILING CLOSED.
//
// The three JSON endpoints match on origin plus pathname. An asset fetch
// matches only when its (origin, pathname) is in the asset registry above.
// EVERYTHING ELSE IS UNRECORDED - a non-http scheme, an unparseable string, a
// missing URL, and, the case that matters, a perfectly parseable https URL on
// an origin or a path no profile describes.
//
// That last clause is the whole point. This function used to end by returning
// the asset class for any parseable http(s) URL, so a call to an endpoint
// nothing had recorded - a new outbound integration, or an SSRF payload
// reaching a host the application was never meant to contact - was served the
// active profile's asset bytes and read as a success. The fixture's own
// no-network guarantee was therefore unfalsifiable: nothing could distinguish
// "recorded and served" from "unknown and served anyway". Unrecorded now fails
// through the calling mechanism's own failure shape with code
// PARITY_UNRECORDED, which is visible, deterministic, and still never a socket.
function classify(rawUrl) {
  if (typeof rawUrl !== 'string' || !rawUrl) {
    return { endpoint: null, url: rawUrl === null || rawUrl === undefined ? '' : String(rawUrl), reason: 'no-url' };
  }

  var parsed;
  try {
    parsed = new URL(rawUrl);
  }
  catch (e) {
    return { endpoint: null, url: rawUrl, reason: 'unparseable-url' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { endpoint: null, url: rawUrl, reason: 'unsupported-protocol:' + parsed.protocol };
  }

  var key = endpointKey(parsed);
  var names = Object.keys(ENDPOINT_URLS);
  for (var i = 0; i < names.length; i++) {
    if (endpointKey(new URL(ENDPOINT_URLS[names[i]])) === key) {
      return { endpoint: names[i], url: rawUrl };
    }
  }

  var assetRegistry = buildAssetRegistry();
  if (Object.prototype.hasOwnProperty.call(assetRegistry, key)) {
    return {
      endpoint     : 'asset',
      url          : rawUrl,
      registration : assetRegistry[key],
      // Which hop of a chain was asked for, when the caller is following the
      // chain itself. `0` means the chain's entry point.
      hop          : hopNumberOf(parsed)
    };
  }

  return {
    endpoint : null,
    url      : rawUrl,
    reason   : 'unregistered-endpoint',
    registry : Object.keys(assetRegistry).length
  };
}

// The hop number encoded in a hop URL, or 0 for any other asset URL.
function hopNumberOf(parsed) {
  var prefix = new URL(ASSET_HOP_PREFIX);
  if (parsed.origin !== prefix.origin || parsed.pathname.indexOf(prefix.pathname) !== 0) {
    return 0;
  }

  var suffix = parsed.pathname.slice(prefix.pathname.length);
  var value = parseInt(suffix, 10);
  return isNaN(value) ? 0 : value;
}

// ---------------------------------------------------------------------------
// Failure construction.
// ---------------------------------------------------------------------------

// The Error a refused or reset connection produced, reproduced field for
// field from the measured original: name 'Error', a message naming the host
// and port, and code/errno/syscall. Deterministic - the host and port come
// from the record, never from a live socket (R-e).
function transportError(spec) {
  var message = spec.message ||
    ('connect ' + spec.code + ' ' + (spec.host || 'parity.example.com') + ':' + (spec.port || 443));

  var err = new Error(message);
  err.code = spec.code;
  err.errno = spec.errno === undefined ? -111 : spec.errno;
  err.syscall = spec.syscall || 'connect';

  if (spec.host) err.hostname = spec.host;
  if (spec.port) err.port = spec.port;

  return err;
}

// The error an unrecorded endpoint produces. It is a transport-shaped Error so
// that it travels through exactly the same funnel a real connection failure
// would, but its code and message say plainly that the fixture, not the
// network, refused - which is what makes an accidental omission in the corpus
// obvious instead of silent.
function unrecordedError(classified, mechanism) {
  var err = new Error(
    'test/parity/fixtures/http.js: no response recorded for ' +
    JSON.stringify(redactUrl(classified.url)) + ' under profile ' + JSON.stringify(state.activeProfile) +
    (classified.reason ? ' (' + classified.reason + ')' : '') +
    '. The fixture never reaches the network, so this request cannot be served.'
  );

  err.code = 'PARITY_UNRECORDED';
  err.syscall = 'connect';
  err.parityMechanism = mechanism;
  err.parityProfile = state.activeProfile;

  return err;
}

// The rejection `fetch` produces for a transport failure on Node 22: a
// TypeError whose message is exactly 'fetch failed', carrying the underlying
// Error as `cause`. lib/controllers/auth.js unwraps that cause, so the cause
// must be the Error the replaced library reported directly (R-e).
function fetchFailure(cause) {
  var err = new TypeError('fetch failed');
  err.cause = cause;
  return err;
}

// The error a call that breached its endpoint's request contract produces.
// Transport-shaped for the same reason unrecordedError is - it has to travel
// the funnel the call site already handles - but with its own code, so a
// contract breach can never be read as a network event or as a missing
// recording.
function contractError(classified, mechanism, violations) {
  var err = new Error(
    'test/parity/fixtures/http.js: the request to ' + JSON.stringify(redactUrl(classified.url)) +
    ' does not satisfy the recorded contract for the ' + classified.endpoint +
    ' endpoint on the ' + mechanism + ' mechanism, so no recorded response ' +
    'applies to it: ' + violations.join('; ')
  );

  err.code = 'PARITY_CONTRACT';
  err.syscall = 'connect';
  err.parityMechanism = mechanism;
  err.parityProfile = state.activeProfile;
  err.parityViolations = violations.slice();

  return err;
}

// ---------------------------------------------------------------------------
// Request description: what was sent, recorded exactly, with credentials
// redacted.
//
// The evidence log used to carry the mechanism, the endpoint, the URL, the
// method, the profile and the outcome - and nothing about the request itself.
// So the wire encoding of the two OAuth calls and of reCAPTCHA, which the
// migration rewrote by hand (the private rfc3986/formEncode/legacyJsonRequest
// helpers in lib/controllers/auth.js and the URLSearchParams body in
// lib/util/recaptcha.js), had no oracle at all: a header dropped, a form field
// renamed or `+` substituted for %20 would have served the same recorded
// response and produced an identical corpus.
//
// Everything below is therefore recorded per call - method, header names and
// values, body encoding, body field names, byte length and digest, and the
// redirect mode - and then checked against the endpoint's contract.
//
// Redaction is not optional and not cosmetic. A URL can carry userinfo and a
// signed query, an Authorization header carries a bearer token, and a form body
// carries the reCAPTCHA secret, the OAuth client secret and the authorization
// code. Evidence is written to a file and quoted into error messages, so each of
// those is replaced by a marker that preserves its SHAPE - which is what the
// contract asserts on - and never its value.
// ---------------------------------------------------------------------------

var REDACTED = '<redacted>';

// Headers whose value is a credential and whose SCHEME is part of the contract.
// Only these two keep anything: the scheme is what `userinfo`'s contract
// asserts on, and it is not itself a secret.
var SCHEME_BEARING_HEADERS = ['authorization', 'proxy-authorization'];

// Headers whose value is a credential with nothing worth keeping. Redacted
// WHOLE - an earlier version of this function preserved everything before the
// first space for every sensitive header, which turned `session=SECRET; Path=/`
// into evidence carrying `session=SECRET;` and an API key with a space in it
// into evidence carrying its first word.
var OPAQUE_CREDENTIAL_HEADERS = [
  'cookie', 'set-cookie', 'x-api-key', 'x-goog-api-key', 'x-auth-token',
  'x-amz-security-token', 'x-amz-credential', 'x-csrf-token', 'x-xsrf-token'
];

// Body and query field names whose values are credentials or one-time secrets.
// The named list carries the fields these four call sites actually send; the
// pattern catches the rest, because a field this file has never seen is
// exactly the one whose value must not be written down. Both are consulted, so
// a new signed-query parameter is redacted without this list being edited.
var SENSITIVE_FIELDS = [
  'secret', 'client_secret', 'code', 'response', 'access_token', 'refresh_token',
  'id_token', 'password', 'token', 'signature', 'sig', 'session'
];

var SENSITIVE_FIELD_PATTERN = /(secret|token|password|passwd|signature|credential|api[-_]?key|auth|session|cookie|sig|nonce)/i;

function isSensitiveHeader(name) {
  var lower = String(name).toLowerCase();
  return SCHEME_BEARING_HEADERS.indexOf(lower) !== -1 ||
    OPAQUE_CREDENTIAL_HEADERS.indexOf(lower) !== -1 ||
    SENSITIVE_FIELD_PATTERN.test(lower);
}

function isSensitiveField(name) {
  var lower = String(name).toLowerCase();
  return SENSITIVE_FIELDS.indexOf(lower) !== -1 || SENSITIVE_FIELD_PATTERN.test(lower);
}

// A URL safe to write down. Evidence is a file and error messages are strings,
// so nothing that reaches either may carry a credential.
//
// Userinfo is removed and the removal is marked, because "this URL carried
// credentials in its authority" is itself evidence. Sensitive query values are
// replaced. Input that is not a URL is reduced to a DIGEST rather than written
// out verbatim: a malformed string can still carry a signed query, and an
// earlier version returned it unchanged on the reasoning that a non-URL has no
// credential structure - which is true of its structure and false of its
// bytes. The digest keeps two runs comparable without carrying the value.
// Never throws.
function redactUrl(rawUrl) {
  if (rawUrl === null || rawUrl === undefined || rawUrl === '') {
    return '';
  }

  if (typeof rawUrl !== 'string') {
    return 'non-string-url:sha1:' + sha1(String(rawUrl)).slice(0, 12);
  }

  var parsed;
  try {
    parsed = new URL(rawUrl);
  }
  catch (e) {
    return 'unparseable-url:sha1:' + sha1(rawUrl).slice(0, 12);
  }

  var hadUserinfo = !!(parsed.username || parsed.password);
  parsed.username = '';
  parsed.password = '';

  var keys = [];
  parsed.searchParams.forEach(function(value, name) {
    if (isSensitiveField(name)) {
      keys.push(name);
    }
  });
  keys.forEach(function(name) {
    parsed.searchParams.set(name, REDACTED);
  });

  return (hadUserinfo ? 'userinfo-stripped:' : '') + parsed.href;
}

// Header names and redacted values, lowercased. Accepts the three shapes a
// caller can pass: a plain object, a Headers instance, and an array of pairs.
function redactHeaders(source) {
  var out = {};

  headerPairs(source).forEach(function(pair) {
    var name = String(pair[0]).toLowerCase();
    var value = pair[1];
    var text = value === undefined || value === null ? '' : String(value);

    if (SCHEME_BEARING_HEADERS.indexOf(name) !== -1) {
      // The scheme is kept and the credential dropped: `userinfo`'s contract
      // asserts on the scheme, and the token must never reach the corpus.
      var space = text.indexOf(' ');
      out[name] = space > 0 ? text.slice(0, space + 1) + REDACTED : REDACTED;
      return;
    }

    if (isSensitiveHeader(name)) {
      out[name] = REDACTED;
      return;
    }

    out[name] = text;
  });

  return out;
}

// The header pairs a caller supplied, in whichever of the three shapes.
function headerPairs(source) {
  if (!source) {
    return [];
  }

  if (typeof source.forEach === 'function' && typeof source.get === 'function') {
    var collected = [];
    source.forEach(function(value, name) { collected.push([name, value]); });
    return collected;
  }

  if (Array.isArray(source)) {
    return source.slice();
  }

  if (typeof source === 'object') {
    return Object.keys(source).map(function(name) { return [name, source[name]]; });
  }

  return [];
}

// What a scheme-bearing header carried, WITHOUT carrying it: the scheme, and
// whether a non-empty credential followed it. The contract needs the second
// fact - an `Authorization: Bearer ` with nothing after the space is a
// different request from one with a token, and the redacted value cannot tell
// them apart - so it is computed here, before redaction, and recorded as a
// boolean.
function credentialShapes(source) {
  var shapes = {};

  headerPairs(source).forEach(function(pair) {
    var name = String(pair[0]).toLowerCase();
    if (SCHEME_BEARING_HEADERS.indexOf(name) === -1) {
      return;
    }

    var text = pair[1] === undefined || pair[1] === null ? '' : String(pair[1]);
    var space = text.indexOf(' ');

    shapes[name] = {
      scheme              : space > 0 ? text.slice(0, space) : null,
      credentialPresent   : space > 0 && text.slice(space + 1).trim().length > 0
    };
  });

  return shapes;
}

// Reads the header value a caller supplied, before redaction, so the contract
// can assert on it. Same three accepted shapes.
function headerValue(source, wanted) {
  if (!source) {
    return undefined;
  }

  var target = String(wanted).toLowerCase();
  var found;

  if (typeof source.get === 'function') {
    found = source.get(target);
    return found === null ? undefined : found;
  }

  var pairs = Array.isArray(source)
    ? source
    : Object.keys(source).map(function(name) { return [name, source[name]]; });

  pairs.forEach(function(pair) {
    if (String(pair[0]).toLowerCase() === target) {
      found = pair[1];
    }
  });

  return found === undefined || found === null ? undefined : String(found);
}

// The bytes a body amounts to, as a string, for the shapes these four call
// sites can produce: a string, URLSearchParams, a Buffer or a Uint8Array.
// Anything else is reported by its type rather than guessed at.
function bodyTextOf(body) {
  if (body === undefined || body === null) {
    return { text: '', kind: 'none' };
  }

  if (typeof body === 'string') {
    return { text: body, kind: 'string' };
  }

  if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) {
    return { text: body.toString(), kind: 'urlsearchparams' };
  }

  if (Buffer.isBuffer(body)) {
    return { text: body.toString('utf8'), kind: 'buffer' };
  }

  if (body instanceof Uint8Array) {
    return { text: Buffer.from(body).toString('utf8'), kind: 'uint8array' };
  }

  return { text: '', kind: 'unsupported:' + typeof body };
}

// Splits an application/x-www-form-urlencoded body into field names and
// redacted values WITHOUT URLSearchParams, because URLSearchParams decodes '+'
// as a space and would erase the very distinction the token contract asserts:
// the replaced library's qs encoder never emitted a raw '+', so one appearing
// in the body is a changed encoding rather than a value containing a plus.
function parseFormBody(text) {
  var fields = [];
  var values = {};

  if (!text) {
    return { fields: fields, values: values };
  }

  text.split('&').forEach(function(pair) {
    if (!pair) {
      return;
    }

    var split = pair.indexOf('=');
    var rawName = split === -1 ? pair : pair.slice(0, split);
    var rawValue = split === -1 ? '' : pair.slice(split + 1);
    var name;

    try {
      name = decodeURIComponent(rawName);
    }
    catch (e) {
      name = rawName;
    }

    fields.push(name);

    if (isSensitiveField(name)) {
      values[name] = rawValue === '' ? '' : REDACTED;
      return;
    }

    try {
      values[name] = decodeURIComponent(rawValue);
    }
    catch (e) {
      values[name] = rawValue;
    }
  });

  return { fields: fields, values: values };
}

// The full description of one outbound request: what a reviewer needs to see
// and what the contract check reads. `digest` is over the RAW bytes, including
// the parts redaction hides, so two runs can be compared byte-for-byte without
// the evidence carrying a single credential.
function describeRequest(input) {
  // The `request` mechanism carries the body as a `form` OBJECT rather than as
  // encoded bytes, so it is described from the object: the field names are the
  // same evidence, and inventing an encoding the library would have produced
  // would be an assumption rather than a record.
  if (input.form && typeof input.form === 'object') {
    var formValues = {};
    Object.keys(input.form).forEach(function(name) {
      formValues[name] = isSensitiveField(name)
        ? REDACTED
        : (input.form[name] === undefined || input.form[name] === null
            ? String(input.form[name])
            : String(input.form[name]));
    });

    return {
      method       : input.method,
      headers      : redactHeaders(input.headers),
      credentials  : credentialShapes(input.headers),
      redirect     : input.redirect === undefined ? null : input.redirect,
      bodyKind     : 'form-option',
      bodyBytes    : null,
      bodyDigest   : null,
      bodyEncoding : 'form',
      bodyFields   : Object.keys(input.form).sort(),
      bodyValues   : formValues,
      rawPlus      : false
    };
  }

  var body = bodyTextOf(input.body);
  var contentType = headerValue(input.headers, 'content-type') || '';
  var isForm = contentType.indexOf('application/x-www-form-urlencoded') === 0 ||
    body.kind === 'urlsearchparams';
  var description = {
    method       : input.method,
    headers      : redactHeaders(input.headers),
    credentials  : credentialShapes(input.headers),
    redirect     : input.redirect === undefined ? null : input.redirect,
    bodyKind     : body.kind,
    bodyBytes    : Buffer.byteLength(body.text, 'utf8'),
    bodyDigest   : body.kind === 'none' ? null : sha1(body.text),
    bodyEncoding : body.kind === 'none' ? 'none' : (isForm ? 'form' : 'other'),
    bodyFields   : null,
    bodyValues   : null,
    rawPlus      : body.kind === 'none' ? false : body.text.indexOf('+') !== -1
  };

  if (isForm && body.kind !== 'none') {
    var parsed = parseFormBody(body.text);
    description.bodyFields = parsed.fields.slice().sort();
    description.bodyValues = parsed.values;
  }

  return description;
}

// ---------------------------------------------------------------------------
// Request contracts: the shape each endpoint must be called with.
//
// Measured from the call sites, one entry per (endpoint, mechanism), because
// the two mechanisms encode the same call differently - `request` carried the
// encoding in its `form` and `json` options while fetch carries it in headers
// and a body string - and a contract that ignored the difference could only
// check the weaker of the two.
//
// A breach is not a warning. The call is REFUSED through contractError above,
// so a drifted encoding cannot be handed a recorded success: an oracle that
// records a violation and serves the response anyway leaves the corpus
// identical and the drift invisible, which is the state this replaces.
// ---------------------------------------------------------------------------

var REQUEST_CONTRACTS = {
  recaptcha : {
    // lib/util/recaptcha.js: fetch(url, {method:'POST', headers:{content-type},
    // body: new URLSearchParams({secret, response})}).
    fetch : {
      method         : 'POST',
      noQuery        : true,
      headers        : { 'content-type': 'application/x-www-form-urlencoded' },
      bodyEncoding   : 'form',
      requiredFields : ['response', 'secret']
    },
    // At 2f8712a: request.post({url, form:{secret, response}}, cb) with `json`
    // NOT set - which is load-bearing, because verify() parses response.body
    // itself and a parsed object there changes the outcome.
    request : {
      method         : 'POST',
      noQuery        : true,
      requiredForm   : ['response', 'secret'],
      json           : false
    }
  },

  token : {
    // lib/controllers/auth.js googleCallback, token exchange. All FIVE fields
    // are required, not the three that decide the outcome: `formEncode` drops
    // only an `undefined` value and node-config reads an unset key as null, so
    // client_secret and redirect_uri are always PRESENT - with an empty value
    // where the deployment leaves them unset. A request missing either is a
    // changed body, and a contract that ignored them accepted one.
    fetch : {
      method         : 'POST',
      noQuery        : true,
      headers        : {
        'content-type' : 'application/x-www-form-urlencoded',
        'accept'       : 'application/json'
      },
      redirect       : 'manual',
      bodyEncoding   : 'form',
      requiredFields : ['client_id', 'client_secret', 'code', 'grant_type', 'redirect_uri'],
      fieldValues    : { grant_type: 'authorization_code' },
      // qs' RFC 3986 stringifier never emitted a raw '+': a space arrives as
      // %20. A '+' in the body means the encoder changed.
      rfc3986        : true
    },
    request : {
      method         : 'POST',
      noQuery        : true,
      requiredForm   : ['client_id', 'client_secret', 'code', 'grant_type', 'redirect_uri'],
      json           : true
    }
  },

  userinfo : {
    // lib/controllers/auth.js googleCallback, profile fetch. The redirect mode
    // is deliberately NOT constrained: following is the baseline behaviour, and
    // a caller that follows the chain itself in order to enforce a hop limit
    // sends 'manual' for the same observable outcome.
    fetch : {
      method        : 'GET',
      noQuery       : true,
      headers       : { 'accept': 'application/json' },
      // The scheme AND a non-empty credential. `Bearer ` with nothing after it
      // is a different request from one carrying a token, and the redacted
      // header cannot tell them apart - which is why the check reads the
      // credential SHAPE computed before redaction.
      credential    : { 'authorization': 'Bearer' },
      bodyEncoding  : 'none'
    },
    request : {
      method        : 'GET',
      noQuery       : true,
      credential    : { 'authorization': 'Bearer' },
      json          : true
    }
  },

  asset : {
    // lib/controllers/users.js assetUploadFromURL: fetch(url) with no init, so
    // GET and no body. Headers are unconstrained - the call site sends none -
    // and so is the redirect mode.
    fetch : {
      method       : 'GET',
      bodyEncoding : 'none'
    },
    request : {
      method       : 'GET'
    }
  }
};

// Checks one described request against its contract and returns every
// violation, each naming the expectation and what arrived, so a contract that
// is itself wrong is as easy to correct as a call site that drifted.
function contractViolations(endpoint, mechanism, description, options, classified) {
  var byEndpoint = REQUEST_CONTRACTS[endpoint];
  var contract = byEndpoint ? byEndpoint[mechanism] : null;
  var violations = [];

  if (!contract) {
    return violations;
  }

  if (contract.method && description.method !== contract.method) {
    violations.push('method must be ' + contract.method + ', received ' +
      JSON.stringify(description.method));
  }

  Object.keys(contract.headers || {}).forEach(function(name) {
    var actual = description.headers[name];
    if (actual !== contract.headers[name]) {
      violations.push('header ' + name + ' must be ' +
        JSON.stringify(contract.headers[name]) + ', received ' +
        (actual === undefined ? 'no such header' : JSON.stringify(actual)));
    }
  });

  Object.keys(contract.credential || {}).forEach(function(name) {
    var shape = (description.credentials || {})[name];
    var scheme = contract.credential[name];

    if (!shape) {
      violations.push('header ' + name + ' must be present and carry the ' +
        JSON.stringify(scheme) + ' scheme, and no such header arrived');
      return;
    }

    if (shape.scheme !== scheme) {
      violations.push('header ' + name + ' must start with ' +
        JSON.stringify(scheme + ' ') + ', and its scheme is ' +
        JSON.stringify(shape.scheme));
      return;
    }

    if (!shape.credentialPresent) {
      violations.push('header ' + name + ' carries the ' + JSON.stringify(scheme) +
        ' scheme with an EMPTY credential, which is a different request from one ' +
        'carrying a token');
    }
  });

  if (contract.noQuery && classified && classified.url) {
    var search = null;
    try {
      search = new URL(classified.url).search;
    }
    catch (e) {
      search = null;
    }

    if (search) {
      violations.push('this endpoint is called with no query string, and this ' +
        'request carries one (' + search.length + ' characters). Endpoint ' +
        'matching ignores the query, so an unexpected one would otherwise be ' +
        'served the recorded response as though it had not been sent');
    }
  }

  if (contract.redirect !== undefined && description.redirect !== contract.redirect) {
    violations.push('the redirect mode must be ' + JSON.stringify(contract.redirect) +
      ', received ' + JSON.stringify(description.redirect) +
      ' (following a redirect on this call would change the method and the outcome)');
  }

  if (contract.bodyEncoding && description.bodyEncoding !== contract.bodyEncoding) {
    violations.push('the body must be ' + contract.bodyEncoding + '-encoded, received ' +
      description.bodyEncoding + ' (' + description.bodyKind + ')');
  }

  (contract.requiredFields || []).forEach(function(field) {
    if (!description.bodyFields || description.bodyFields.indexOf(field) === -1) {
      violations.push('the body must carry the field ' + JSON.stringify(field) +
        ', and carries ' + JSON.stringify(description.bodyFields || []));
    }
  });

  Object.keys(contract.fieldValues || {}).forEach(function(field) {
    var actual = description.bodyValues ? description.bodyValues[field] : undefined;
    if (actual !== contract.fieldValues[field]) {
      violations.push('the body field ' + JSON.stringify(field) + ' must be ' +
        JSON.stringify(contract.fieldValues[field]) + ', received ' +
        JSON.stringify(actual === undefined ? null : actual));
    }
  });

  if (contract.rfc3986 && description.rawPlus) {
    violations.push('the body contains a raw "+", so it is not RFC 3986 encoded: ' +
      'the encoder this call site reproduces percent-encodes a space as %20 and ' +
      'never as "+"');
  }

  // `request`-mechanism options, which carry the encoding rather than headers.
  var opts = options || {};

  (contract.requiredForm || []).forEach(function(field) {
    var form = opts.form;
    if (!form || typeof form !== 'object' || !Object.prototype.hasOwnProperty.call(form, field)) {
      violations.push('the `form` option must carry the field ' + JSON.stringify(field) +
        ', and carries ' + JSON.stringify(form && typeof form === 'object' ? Object.keys(form).sort() : null));
    }
  });

  if (contract.json !== undefined && !!opts.json !== contract.json) {
    violations.push('the `json` option must be ' + contract.json + ', received ' +
      JSON.stringify(opts.json === undefined ? null : opts.json) +
      (contract.json === false
        ? ' (this call site parses response.body itself, so a parsed body changes the outcome)'
        : ' (this call site reads the parsed body, so a raw string changes the outcome)'));
  }

  return violations;
}

// Records a breach and hands back the violations, so each caller can refuse in
// its own mechanism's shape. The entry carries an `event` key, which is what
// keeps test/parity/replay.js counting it as a fixture note rather than as an
// intercepted call.
function noteContractViolation(classified, mechanism, description, violations) {
  state.contractViolations.push({
    mechanism  : mechanism,
    endpoint   : classified.endpoint,
    url        : redactUrl(classified.url),
    profile    : state.activeProfile,
    violations : violations.slice()
  });

  note('contract-violation', {
    mechanism  : mechanism,
    endpoint   : classified.endpoint,
    url        : redactUrl(classified.url),
    profile    : state.activeProfile,
    request    : description,
    violations : violations.slice()
  });
}

// ---------------------------------------------------------------------------
// Response construction shared by both mechanisms.
// ---------------------------------------------------------------------------

// Only the statuses this fixture serves need a reason phrase.
var STATUS_TEXT = {
  200 : 'OK',
  302 : 'Found',
  400 : 'Bad Request',
  404 : 'Not Found',
  503 : 'Service Unavailable'
};

// The exact bytes a record serves, as a string. A record carries either a
// `json` object - stringified here so the served bytes are a stable literal
// with a fixed key order - or a raw `body` string, or `bytes` for the asset
// records.
function bodyStringFor(rec) {
  if (rec.json !== undefined) {
    return JSON.stringify(rec.json);
  }

  if (typeof rec.body === 'string') {
    return rec.body;
  }

  if (rec.bytes) {
    return rec.bytes.toString('utf8');
  }

  return '';
}

// The body-parsing rule `json: true` applied, reproduced from measurement
// rather than from documentation: an empty body becomes undefined, a parseable
// body becomes the parsed value INCLUDING null, and an unparseable body stays
// the raw string. The first two are what make the application's
// `!body.access_token` and `!profile.email` guards throw a TypeError instead
// of rejecting, and that fault is preserved (R-d).
function legacyJsonBody(text) {
  if (text === '') {
    return undefined;
  }

  try {
    return JSON.parse(text);
  }
  catch (e) {
    return text;
  }
}

// Builds the response object the callback form receives. `response.body` and
// the callback's `body` argument are the SAME value, which is measured
// behaviour and is load-bearing: lib/util/recaptcha.js parses
// `response.body`, so under `json: true` both are the parsed object and
// without it both are the raw string.
function buildCallbackResponse(rec, classified, method, wantsJson) {
  var text = bodyStringFor(rec);
  var body = wantsJson ? legacyJsonBody(text) : text;
  var headers = {};

  Object.keys(rec.headers || {}).forEach(function(name) {
    headers[name.toLowerCase()] = rec.headers[name];
  });

  if (rec.contentType && !headers['content-type']) {
    headers['content-type'] = rec.contentType;
  }

  return {
    statusCode    : rec.status,
    statusMessage : STATUS_TEXT[rec.status] || '',
    httpVersion   : '1.1',
    headers       : headers,
    body          : body,
    url           : classified.url,
    method        : method
  };
}

// ---------------------------------------------------------------------------
// Mechanism 1: the `request` module.
//
// The whole export is replaced with one dispatcher, so every request-issuing
// entry point the module exposes - the callable form included - lands here and
// nothing can escape to the network. Two call shapes are served from that one
// dispatcher, selected by whether a callback was supplied: the callback form
// the two OAuth calls and reCAPTCHA use, and the no-callback stream form the
// asset upload uses.
// ---------------------------------------------------------------------------

// Normalizes the argument shapes the library accepted: (url), (url, cb),
// (url, options, cb), (options), (options, cb). `uri` is honoured as a synonym
// for `url`, as the original did.
function normalizeArgs(defaultMethod, args) {
  var list = Array.prototype.slice.call(args);
  var callback = null;

  if (list.length && typeof list[list.length - 1] === 'function') {
    callback = list.pop();
  }

  var options = {};
  var i;
  for (i = 0; i < list.length; i++) {
    if (list[i] && typeof list[i] === 'object' && !(list[i] instanceof URL)) {
      options = list[i];
      break;
    }
  }

  var url = null;
  for (i = 0; i < list.length && url === null; i++) {
    url = urlFrom(list[i]);
  }
  if (url === null) {
    url = urlFrom(options);
  }

  return {
    url      : url,
    method   : (options && typeof options.method === 'string' ? options.method.toUpperCase() : defaultMethod),
    options  : options,
    callback : callback
  };
}

// Delivers a callback-form response. The callback is dispatched on a next tick
// rather than synchronously, which is what the original did from its own
// emitter: a throw inside the callback then escapes as an uncaught exception,
// which is the documented contract of reCAPTCHA outcomes 5 and 6 and of the
// null-body token case (R-d, R-e).
function serveRequestCallback(call) {
  var classified = classify(call.url);
  var rec = classified.endpoint ? recordFor(classified.endpoint) : null;
  var wantsJson = !!(call.options && call.options.json);
  var description = describeRequest({
    method   : call.method,
    headers  : call.options && call.options.headers,
    body     : call.options && call.options.body,
    form     : call.options && call.options.form,
    redirect : undefined
  });

  if (!rec || rec.recorded === false) {
    recordCall(classified, 'request', description, 'unrecorded');
    process.nextTick(call.callback, unrecordedError(classified, 'request'), undefined, undefined);
    return;
  }

  var violations = contractViolations(classified.endpoint, 'request', description, call.options, classified);
  if (violations.length) {
    noteContractViolation(classified, 'request', description, violations);
    recordCall(classified, 'request', description, 'contract-violation');
    process.nextTick(call.callback, contractError(classified, 'request', violations), undefined, undefined);
    return;
  }

  recordCall(classified, 'request', description, rec.outcome);

  if (rec.transport) {
    // (err, undefined, undefined) - the shape that leaves `response`
    // undefined at the reCAPTCHA call site and throws there.
    process.nextTick(call.callback, transportError(rec.transport), undefined, undefined);
    return;
  }

  var response = buildCallbackResponse(rec, classified, call.method, wantsJson);
  process.nextTick(call.callback, null, response, response.body);
}

// The hops still ahead of a request, so a caller that follows a chain itself -
// one request per hop - is served the same chain a following caller is.
//
// A request for the chain's entry point has every hop ahead of it. A request
// for hop N has the hops from N onwards, which is what makes a hop-counting
// loop terminate at the same destination as a single following request. A
// record with no chain has no hops, and a non-redirect record never reaches
// here.
function hopsFrom(rec, classified) {
  if (!rec || rec.mode !== 'redirect') {
    return [];
  }

  var chain = Array.isArray(rec.hops)
    ? rec.hops
    : (rec.redirectLocation
        ? [{ status: rec.redirectStatus || 302, location: rec.redirectLocation }]
        : []);

  if (!chain.length) {
    return [];
  }

  // A request for the chain's DESTINATION has no hops ahead of it, or a
  // hop-counting caller would arrive and be redirected round the chain again -
  // measured, as a walk that never terminated.
  var destination = chain[chain.length - 1].location;
  if (classified && classified.url && sameEndpoint(classified.url, destination)) {
    return [];
  }

  var hop = classified && classified.hop ? classified.hop : 0;
  return chain.slice(Math.max(0, hop - 1));
}

// Whether two URLs name the same recorded endpoint, on the same (origin,
// pathname) basis the registry uses.
function sameEndpoint(left, right) {
  try {
    return endpointKey(new URL(left)) === endpointKey(new URL(right));
  }
  catch (e) {
    return false;
  }
}

// Builds the object the stream form returns: a legacy Stream carrying the
// no-op control surface the original exposed, so a consumer that pauses,
// resumes or aborts it behaves as before.
function newRequestStream(call, classified) {
  var stream = new Stream();

  stream.readable = true;
  stream.method = call.method;
  stream.href = classified.url;
  stream.pause = function() { return stream; };
  stream.resume = function() { return stream; };
  stream.abort = function() { return stream; };
  stream.end = function() { return stream; };

  return stream;
}

// Delivers the stream form. Emission is deferred to setImmediate so that the
// caller's whole synchronous chain - three .on() calls and the .pipe() - is
// attached first, which is what the original's real I/O guaranteed. The event
// sequences below are the measured baseline sequences, one per mode.
function serveRequestStream(call) {
  var classified = classify(call.url);
  var rec = classified.endpoint ? recordFor(classified.endpoint) : null;
  var stream = newRequestStream(call, classified);
  var description = describeRequest({
    method   : call.method,
    headers  : call.options && call.options.headers,
    body     : call.options && call.options.body,
    form     : call.options && call.options.form,
    redirect : undefined
  });

  if (!rec || rec.recorded === false) {
    recordCall(classified, 'request', description, 'unrecorded');
    setImmediate(function() {
      stream.emit('error', unrecordedError(classified, 'request'));
    });
    return stream;
  }

  var violations = contractViolations(classified.endpoint, 'request', description, call.options, classified);
  if (violations.length) {
    noteContractViolation(classified, 'request', description, violations);
    recordCall(classified, 'request', description, 'contract-violation');
    setImmediate(function() {
      stream.emit('error', contractError(classified, 'request', violations));
    });
    return stream;
  }

  recordCall(classified, 'request', description, rec.outcome);

  // A JSON endpoint asked for without a callback still has to answer, and it
  // answers as a stream: response, body, end.
  var mode = rec.mode || 'complete';
  var hops = hopsFrom(rec, classified);

  setImmediate(function() {
    if (mode === 'refused') {
      // 'error' and nothing else, ever: no 'response', no 'data', no 'end'.
      // The upload never starts and the request is left unsettled (R-d).
      stream.emit('error', transportError(rec.transport));
      return;
    }

    if (mode === 'redirect' && hops.length > LEGACY_MAX_REDIRECTS) {
      // The chain is longer than this mechanism's own maxRedirects, so it
      // fails instead of arriving: 'error' with the library's own message
      // shape, and no 'response' and no 'end'. Declared rather than measured
      // (see LEGACY_MAX_REDIRECTS), and served identically on every run so the
      // boundary is testable at all.
      var exceeded = new Error('Exceeded maxRedirects. Probably stuck in a redirect loop ' +
        redactUrl(classified.url));
      exceeded.code = 'PARITY_REDIRECT_LIMIT';
      exceeded.parityHops = hops.length;
      exceeded.parityLimit = LEGACY_MAX_REDIRECTS;
      stream.emit('error', exceeded);
      return;
    }

    if (mode === 'redirect') {
      // Each intermediate response is announced through 'redirect' - the event
      // the original emitted, and one no application handler listens for - and
      // then only the FINAL response is delivered, which is what a consumer of
      // the original could observe.
      hops.forEach(function(hop) {
        stream.response = {
          statusCode : hop.status,
          headers    : { location: hop.location }
        };
        stream.emit('redirect');
      });
    }

    var response = buildCallbackResponse(rec, classified, call.method, false);
    delete response.body;              // the stream form carries no body field
    stream.response = response;
    stream.emit('response', response);

    var bytes = rec.bytes || Buffer.from(bodyStringFor(rec), 'utf8');
    if (bytes.length) {
      stream.emit('data', bytes);
    }

    if (mode === 'midstream') {
      // 'error' AFTER the partial bytes and 'end' AFTER the error: both fire,
      // so the upload proceeds with partial content. Deferred one tick so the
      // bytes are through the pipe before the error unwires it, which is the
      // order the measured baseline produced.
      setImmediate(function() {
        stream.emit('error', transportError(rec.transport));
        stream.emit('end');
      });
      return;
    }

    // 'complete' and 'non-2xx' both end normally: a non-2xx is not a
    // transport error, so its body really is piped and uploaded.
    stream.emit('end');
  });

  return stream;
}

// The single entry point every patched `request` export routes into.
function dispatchRequest(defaultMethod, args) {
  refreshProfileFromFile();

  var call = normalizeArgs(defaultMethod, args);

  if (call.callback) {
    serveRequestCallback(call);
    // The original returned its Request object from the callback form too.
    // An inert stream is returned here for shape only: the response travels
    // through the callback, and emitting on both would serve it twice. No
    // call site reads this value.
    return newRequestStream(call, classify(call.url));
  }

  return serveRequestStream(call);
}

// Builds the replacement export: callable, and carrying every entry point the
// measured export surface exposed. `defaults()` and `forever()` return the
// dispatcher itself rather than a configured client, because a configured
// client would be one more way to reach the network. `Request` is a throwing
// shim for the same reason - nothing in the application constructs it, and if
// something ever does, failing loudly beats opening a socket.
function buildRequestReplacement() {
  var dispatcher = function() {
    return dispatchRequest('GET', arguments);
  };

  ['get', 'post', 'put', 'patch', 'head', 'del', 'delete', 'options'].forEach(function(name) {
    var method = (name === 'del' ? 'DELETE' : name.toUpperCase());
    dispatcher[name] = function() {
      return dispatchRequest(method, arguments);
    };
  });

  // Both hand out a configured client in the original, so both must hand out
  // the dispatcher here: a configured client would be one more way to reach
  // the network.
  dispatcher.defaults = function() { return dispatcher; };
  dispatcher.forever = function() { return dispatcher; };

  // The remaining members of the measured export surface - Request,
  // initParams, jar and cookie - are declared UNAVAILABLE rather than faked.
  // None is referenced anywhere in the application, at the base commit or on
  // the target tree, and none issues an HTTP request, so their absence cannot
  // open a route to the network. Declaring them loudly is the honest option:
  // a hollow cookie jar that silently stores nothing, or an initParams that
  // returns a differently shaped object, would turn a missing capability into
  // a subtle wrong answer.
  ['Request', 'initParams', 'jar', 'cookie'].forEach(function(name) {
    dispatcher[name] = function() {
      throw new Error(
        'test/parity/fixtures/http.js: request.' + name + ' is not available under the parity fixture. ' +
        'Every HTTP call must go through a recorded profile, and the fixture never reaches the network. ' +
        'If a call site ever needs this member, record its behaviour and implement it here rather than ' +
        'restoring the real module.'
      );
    };
  });

  // A data property on the original, carrying no behaviour.
  dispatcher.debug = false;

  // The marker install() uses to recognize its own patch, which is what keeps
  // a repeated install() to a single layer.
  dispatcher.parityFixture = true;

  return dispatcher;
}

// ---------------------------------------------------------------------------
// Mechanism 2: `globalThis.fetch`.
//
// Patched unconditionally, because on the target tree all four call sites are
// native fetch. The served shapes are real WHATWG Response objects built by
// the runtime's own constructor, so `.status`, `.headers.get()`, `.text()` and
// a `.body` that Readable.fromWeb() can consume all behave exactly as they do
// against a live server - which matters, because the application reads all
// four.
// ---------------------------------------------------------------------------

// A web ReadableStream delivering the whole payload and closing.
function completeWebStream(bytes) {
  return new ReadableStream({
    start : function(controller) {
      if (bytes.length) {
        controller.enqueue(new Uint8Array(bytes));
      }
      controller.close();
    }
  });
}

// A web ReadableStream delivering the partial payload and THEN failing.
//
// Two details are measured rather than chosen. It is pull-driven because
// enqueueing and erroring inside start() DISCARDS the queued chunk, which
// would turn the mid-stream case into a zero-byte failure instead of a
// partial-content upload. And the error is deferred by one setImmediate,
// because the consumer pipes this stream into a write stream and a failure in
// the same turn as the chunk tears the pipe down before the write is issued -
// measured: the partial bytes never reached the file. One immediate of
// separation is the same separation the stream form gives the `request`
// mechanism, so both mechanisms deliver partial content and then fail.
function partialThenErrorWebStream(bytes, err) {
  var delivered = false;

  return new ReadableStream({
    pull : function(controller) {
      if (!delivered) {
        delivered = true;
        if (bytes.length) {
          controller.enqueue(new Uint8Array(bytes));
        }
        return;
      }

      return new Promise(function(resolve) {
        setImmediate(function() {
          controller.error(err);
          resolve();
        });
      });
    }
  });
}

// The 3xx a caller asking for `redirect: 'manual'` receives: the status the
// chain records, the Location it points at, and no body - which is what a real
// redirect response carries.
function buildRedirectResponse(hop) {
  return new Response(null, {
    status     : hop.status,
    statusText : STATUS_TEXT[hop.status] || '',
    headers    : { location: hop.location }
  });
}

// Builds the Response for one record.
//
// `hops` is the chain that was followed to reach it, used only to mark the
// response as redirected. `Response.prototype.redirected` and `.url` are
// prototype getters that the constructor cannot set, so they are shadowed with
// own properties: no application path reads either, and a corpus reviewer
// looking at a followed chain should not have to infer it from the log.
function buildFetchResponse(rec, classified, hops) {
  var headers = {};

  Object.keys(rec.headers || {}).forEach(function(name) {
    headers[name.toLowerCase()] = rec.headers[name];
  });

  if (rec.contentType && !headers['content-type']) {
    headers['content-type'] = rec.contentType;
  }

  var init = {
    status     : rec.status,
    statusText : STATUS_TEXT[rec.status] || '',
    headers    : headers
  };

  var response;

  if (rec.mode === 'midstream') {
    // The stream form emits 'error' and then 'end', because both are events
    // the fixture controls. A Node Readable adapted from a web stream cannot
    // do that - a Readable that errors never emits 'end' - so on this
    // mechanism the fixture's contract stops at "partial bytes, then error".
    // That is a property of the runtime's own stream adapter, not a gap here,
    // and the application accounts for it: its 'error' handler starts the
    // upload itself, which is how the partial content still gets uploaded on
    // both mechanisms. Measured on both.
    response = new Response(
      partialThenErrorWebStream(rec.bytes, transportError(rec.transport)),
      init
    );
  }
  else if (rec.bytes) {
    response = new Response(completeWebStream(rec.bytes), init);
  }
  else {
    // The JSON endpoints. The body is handed over as the same string the
    // callback form serves, so both mechanisms parse identical bytes and the
    // `json: true` semantics are reproduced by the application's own reader.
    response = new Response(bodyStringFor(rec), init);
  }

  if (hops && hops.length) {
    try {
      Object.defineProperty(response, 'redirected', { value: true, configurable: true });
      Object.defineProperty(response, 'url', {
        value        : rec.redirectLocation || (classified && classified.url) || '',
        configurable : true
      });
    }
    catch (e) {
      // Shadowing is presentation only. A runtime that refuses it changes
      // nothing the application reads, so the failure is recorded and the
      // response is served.
      note('fetch-redirect-marking-failed', { error: e.message });
    }
  }

  return response;
}

// The replacement for globalThis.fetch. It never calls the original and never
// opens a socket.
function parityFetch(input, init) {
  refreshProfileFromFile();

  var rawUrl = urlFrom(input);
  var classified = classify(rawUrl);
  var method = 'GET';

  if (init && typeof init.method === 'string') {
    method = init.method.toUpperCase();
  }
  else if (input && typeof input === 'object' && typeof input.method === 'string') {
    method = input.method.toUpperCase();
  }

  var rec = classified.endpoint ? recordFor(classified.endpoint) : null;

  // Native fetch REFUSES a URL carrying credentials in its authority, and it
  // refuses it before any request is made. Measured on Node v22.23.2:
  //   TypeError('Request cannot be constructed from a URL that includes
  //   credentials: <url>'), with no `cause`.
  //
  // Reproducing it matters because the replaced library ACCEPTED such a URL, so
  // this is one of the measured behavioural differences the migration
  // introduced at lib/controllers/users.js's asset upload - and a fixture that
  // quietly stripped the credentials and served a 200 would report parity
  // across exactly that difference. The URL is recorded redacted; the message
  // must carry the URL as fetch does, so it carries the redacted form.
  if (typeof rawUrl === 'string' && rawUrl) {
    var authority = null;
    try {
      authority = new URL(rawUrl);
    }
    catch (e) {
      authority = null;
    }

    if (authority && (authority.username || authority.password)) {
      recordCall(classified, 'fetch',
        describeRequest({ method: method, headers: (init && init.headers) || null, body: init ? init.body : undefined, redirect: init && init.redirect }),
        'credential-url-refused');

      return Promise.reject(new TypeError(
        'Request cannot be constructed from a URL that includes credentials: ' +
        redactUrl(rawUrl)
      ));
    }
  }

  // The redirect mode the caller asked for, defaulted the way fetch defaults
  // it. Read from `init` first and then from a Request-shaped input, which is
  // the same order the method is read in.
  var redirectMode = 'follow';
  if (init && typeof init.redirect === 'string') {
    redirectMode = init.redirect;
  }
  else if (input && typeof input === 'object' && typeof input.redirect === 'string') {
    redirectMode = input.redirect;
  }

  var description = describeRequest({
    method   : method,
    headers  : (init && init.headers) || (input && typeof input === 'object' ? input.headers : null),
    body     : init ? init.body : undefined,
    redirect : redirectMode
  });

  if (!rec || rec.recorded === false) {
    recordCall(classified, 'fetch', description, 'unrecorded');
    // fetch's own failure shape, so the caller's rejection handling is
    // reached exactly as a real transport failure would reach it (R-e).
    return Promise.reject(fetchFailure(unrecordedError(classified, 'fetch')));
  }

  var violations = contractViolations(classified.endpoint, 'fetch', description, null, classified);
  if (violations.length) {
    noteContractViolation(classified, 'fetch', description, violations);
    recordCall(classified, 'fetch', description, 'contract-violation');
    return Promise.reject(fetchFailure(contractError(classified, 'fetch', violations)));
  }

  recordCall(classified, 'fetch', description, rec.outcome);

  // A transport failure on a JSON endpoint, and the refused asset, are the
  // same event to fetch: the promise rejects and no Response ever exists.
  if (rec.transport && rec.mode !== 'midstream') {
    return Promise.reject(fetchFailure(transportError(rec.transport)));
  }

  // `init.redirect` decides what a recorded redirect chain serves, because the
  // three modes are three different observable outcomes and the token exchange
  // depends on one of them: it sends 'manual' precisely so that a 3xx is NOT
  // chased, since fetch follows every method and downgrades a redirected POST
  // to GET. Ignoring the mode - which this function used to do - made that
  // dependency untestable and made a hop limit inexpressible.
  var hops = hopsFrom(rec, classified);

  if (hops.length) {
    if (redirectMode === 'error') {
      // fetch rejects rather than delivering anything.
      var refused = new Error('unexpected redirect, redirect mode is set to error');
      refused.code = 'PARITY_REDIRECT_MODE';
      return Promise.reject(fetchFailure(refused));
    }

    if (redirectMode === 'manual') {
      // The 3xx ITSELF, Location intact and body empty. This is the only shape
      // a caller counting hops for itself can work from, and it is what a
      // bounded follower needs in order to stop at its own limit rather than
      // the runtime's.
      try {
        return Promise.resolve(buildRedirectResponse(hops[0]));
      }
      catch (e) {
        note('fetch-redirect-build-failed', { url: redactUrl(classified.url), profile: state.activeProfile, error: e.message });
        return Promise.reject(fetchFailure(e));
      }
    }

    if (hops.length > FETCH_MAX_REDIRECTS) {
      // Longer than the runtime's own limit, so following it fails. Declared
      // rather than measured (see FETCH_MAX_REDIRECTS) and served identically
      // every run.
      var tooMany = new Error('redirect count exceeded');
      tooMany.code = 'PARITY_REDIRECT_LIMIT';
      tooMany.parityHops = hops.length;
      tooMany.parityLimit = FETCH_MAX_REDIRECTS;
      return Promise.reject(fetchFailure(tooMany));
    }
  }

  try {
    return Promise.resolve(buildFetchResponse(rec, classified, hops));
  }
  catch (e) {
    // A malformed record is a fixture fault, not a network event. It is
    // reported through fetch's own failure shape so it cannot be mistaken for
    // a successful response, and it is logged for the harness.
    note('fetch-response-build-failed', { url: redactUrl(classified.url), profile: state.activeProfile, error: e.message });
    return Promise.reject(fetchFailure(e));
  }
}

// ---------------------------------------------------------------------------
// Installation.
// ---------------------------------------------------------------------------

var requestReplacement = buildRequestReplacement();

// Resolves the application's own `request` package from the worktree under
// test. On the target tree the package is removed from the manifest, so
// MODULE_NOT_FOUND is an expected, silent outcome - not an error - and only
// the fetch mechanism is installed.
function patchRequestModule(appRoot) {
  var resolved;

  try {
    resolved = require.resolve('request', { paths: [appRoot] });
  }
  catch (e) {
    state.resolveDiagnostic = 'request is not resolvable from ' + appRoot +
      ' (' + (e.code || e.message) + '); only the fetch mechanism is active, which is the expected state on the target tree';
    return false;
  }

  // From here on the mechanism is REQUIRED. The package exists in this tree, so
  // the application can require it and reach a real socket; failing to patch it
  // is not the benign "target tree has no request" case but a live escape from
  // the fixture, and install() treats it as terminal rather than as a note.
  state.requestRequired = true;

  try {
    // Loading the module performs no network I/O; it is loaded so that the
    // genuine export can be retained for restore() and so that the cache
    // entry the application will hit is the one being replaced.
    require(resolved);

    var mod = require.cache[resolved];
    if (!mod) {
      state.resolveDiagnostic = 'request resolved to ' + resolved + ' but left no cache entry to patch';
      return false;
    }

    if (mod.exports && mod.exports.parityFixture) {
      // Already patched by an earlier install(); one layer only.
      state.requestModule = mod;
      return true;
    }

    state.requestModule = mod;
    state.originalRequest = mod.exports;
    mod.exports = requestReplacement;
    return true;
  }
  catch (e) {
    state.resolveDiagnostic = 'request resolved to ' + resolved + ' but could not be patched: ' + e.message;
    return false;
  }
}

// Replaces globalThis.fetch, retaining the genuine original exactly once so
// that a repeated install() cannot make the fixture its own "original".
function patchFetch() {
  if (globalThis.fetch === parityFetch) {
    return true;
  }

  state.originalFetch = globalThis.fetch;
  globalThis.fetch = parityFetch;
  return true;
}

// Verifies that PARITY_APP_ROOT names the tree it claims to. The `request`
// mechanism is resolved against this path, so a wrong root silently decides
// which mechanisms exist - the exact failure a handshake is supposed to catch.
function verifyAppRoot(appRoot) {
  var missing = ['app.js', 'package.json'].filter(function(name) {
    try {
      return !fs.statSync(pathModule.join(appRoot, name)).isFile();
    }
    catch (e) {
      return true;
    }
  });

  return {
    verified : !missing.length,
    missing  : missing
  };
}

// Installs both mechanisms and publishes the handshake.
//
// Idempotent: a second call is a no-op returning the same status. It still does
// not THROW - a preload that throws kills the server before app.js loads, and
// the diagnosis would be a stack trace from a require - but it no longer treats
// an unprotected process as installed either.
//
// Two things changed, and both are the difference between a fixture and a
// fixture that can be trusted:
//
//   `installed` was `requestPatched || fetchPatched`, so one working mechanism
//   reported success while the other stayed live. It is now every REQUIRED
//   mechanism: fetch always, and `request` exactly when the tree provides it.
//   A tree without the package is the target tree's expected state and is not a
//   failure; a tree with the package that could not be patched is a live socket
//   path and is.
//
//   A required mechanism that is inactive is TERMINAL. The alternative is what
//   this replaces: a diagnostic in a log nobody reads while the child serves
//   traffic to the real internet and produces a corpus that looks like
//   evidence. The process exits with EXIT_UNPROTECTED after writing the reason
//   into the handshake and the evidence log, which is what makes readiness fail
//   for a parent that polls it - test/parity/server.js reports the child's exit,
//   and neither capture.js nor replay.js can proceed past a dead child.
//   Nothing is printed: stdout and stderr belong to the zero-warning gate
//   (AAP 0.8), and the exit code plus the handshake are the signal.
function install() {
  if (state.installed) {
    return status();
  }

  var appRoot = process.env.PARITY_APP_ROOT || process.cwd();

  try {
    state.requestPatched = patchRequestModule(appRoot);
  }
  catch (e) {
    state.requestPatched = false;
    state.resolveDiagnostic = 'request patch failed: ' + e.message;
  }

  try {
    state.fetchPatched = patchFetch();
  }
  catch (e) {
    state.fetchPatched = false;
    note('fetch-patch-failed', { error: e.message });
  }

  // fetch is always required: all four call sites are native fetch on the
  // target tree. `request` is required only where it resolves.
  var inactive = [];
  if (!state.fetchPatched) {
    inactive.push('fetch');
  }
  if (state.requestRequired && !state.requestPatched) {
    inactive.push('request');
  }

  // An app root the caller DECLARED and that does not hold the application is
  // the same class of fault: `request` is resolved against it, so a wrong root
  // silently decides which mechanisms exist and a baseline capture could run
  // with the legacy mechanism absent and never notice. An explicit wrong claim
  // is terminal; the implicit process.cwd() fallback is not - it is reported,
  // and assertReady() refuses on it - because a fallback is not a claim.
  var declaredRoot = !!process.env.PARITY_APP_ROOT;
  var rootCheck = verifyAppRoot(appRoot);
  if (declaredRoot && !rootCheck.verified) {
    inactive.push('app-root');
    state.resolveDiagnostic = 'PARITY_APP_ROOT ' + appRoot + ' does not hold the ' +
      'application (' + rootCheck.missing.join(' and ') + ' missing), so `request` was ' +
      'resolved against the wrong worktree';
  }

  state.installed = !inactive.length;

  if (state.resolveDiagnostic) {
    note('request-mechanism-inactive', state.resolveDiagnostic);
  }

  var current = status();
  publishHandshake(current);

  if (inactive.length) {
    note('install-unprotected', {
      inactive : inactive,
      reason   : 'a mechanism this tree provides could not be intercepted, so an ' +
                 'HTTP call could reach the network and the corpus would not be ' +
                 'reproducible',
      diagnostic : state.resolveDiagnostic
    });
    flush();
    process.exit(EXIT_UNPROTECTED);
  }

  return current;
}

// Writes the handshake where a parent can read it, and records it in the
// evidence log as well so it travels with the corpus in every run - including
// runs that set no handshake path.
//
// The handshake answers the question a parent could not previously ask: is the
// fixture that installed the one I meant, in the tree I meant, with every
// mechanism active? It carries the module's own path and a digest of its
// contents, the app root and whether it verified, the pid, the active profile
// and the mechanism table.
function publishHandshake(current) {
  state.handshake = current;

  note('install', current);

  var target = process.env.PARITY_HTTP_STATUS;
  if (!target) {
    return null;
  }

  try {
    fs.writeFileSync(target, JSON.stringify(current, null, 2) + '\n');
    return target;
  }
  catch (e) {
    note('handshake-write-failed', { file: target, error: e.code || e.message });
    return null;
  }
}

// A digest of this file, so a handshake identifies the implementation and not
// merely its path: both worktrees load ONE implementation (R-f), and this is
// what lets a run prove it rather than assert it. Computed once, and a failure
// to read is reported rather than thrown.
var fixtureDigest = (function() {
  try {
    return sha1(fs.readFileSync(__filename));
  }
  catch (e) {
    return null;
  }
})();

// Puts back the genuine `request` export and the genuine globalThis.fetch. The
// retained originals are used here and nowhere else: no code path in this file
// ever calls them.
function restore() {
  if (state.requestModule && state.originalRequest) {
    state.requestModule.exports = state.originalRequest;
  }

  if (state.fetchPatched && globalThis.fetch === parityFetch) {
    globalThis.fetch = state.originalFetch;
  }

  state.requestModule = null;
  state.originalRequest = null;
  state.originalFetch = null;
  state.requestPatched = false;
  state.fetchPatched = false;
  state.requestRequired = false;
  state.installed = false;
  state.handshake = null;

  return status();
}

// What is patched, what is not, and why - plus the identity a parent checks the
// handshake against. Returned by install() and available on its own so a
// harness can report the active mechanisms rather than guess at them.
function status() {
  var appRoot = process.env.PARITY_APP_ROOT || process.cwd();
  var rootCheck = verifyAppRoot(appRoot);
  var identityCheck = checkIdentityContract();

  return {
    schema     : 'parity-http-fixture-status/1',
    installed  : state.installed,
    appRoot    : appRoot,
    appRootVerified : rootCheck.verified,
    appRootMissing  : rootCheck.missing,
    profile    : state.activeProfile,
    mechanisms : {
      request : state.requestPatched,
      fetch   : state.fetchPatched
    },
    // Which mechanisms this tree obliges the fixture to hold. `request` is
    // required only where the package resolves; fetch always is.
    required   : {
      request : state.requestRequired,
      fetch   : true
    },
    identity   : {
      module   : __filename,
      digest   : fixtureDigest,
      pid      : process.pid,
      node     : process.version,
      existing : identityCheck.existing,
      new      : identityCheck.new,
      identityOk : identityCheck.ok,
      identityViolations : identityCheck.violations,
      identityUnverified : identityCheck.unverified
    },
    diagnostic : state.resolveDiagnostic
  };
}

// Throws unless the fixture is fully in force: every required mechanism active,
// the app root verified, the identity contract satisfied, and no request
// contract breached so far. This is the assertion a driver makes BEFORE it
// trusts a run - the check whose absence let a partially installed fixture, a
// wrong app root or an unexercised profile pass unnoticed.
//
// It throws rather than returning a flag because every caller is a gate: a
// boolean would be checked in one place and forgotten in the next.
function assertReady(options) {
  var opts = options || {};
  var current = status();
  var problems = [];

  if (!current.installed) {
    problems.push('the fixture is not installed: ' +
      Object.keys(current.required).filter(function(name) {
        return current.required[name] && !current.mechanisms[name];
      }).join(', ') + ' inactive');
  }

  if (!current.appRootVerified) {
    problems.push('PARITY_APP_ROOT ' + JSON.stringify(current.appRoot) +
      ' does not look like the application tree - ' +
      current.appRootMissing.join(' and ') + ' missing - so `request` was ' +
      'resolved against the wrong worktree and the active mechanism set is ' +
      'not the one this run assumes');
  }

  // Required by DEFAULT, opt-out rather than opt-in: an existing identity the
  // fixture cannot see in the seeded set means the OAuth existing-user branch
  // is not being exercised, and a driver that has to remember to ask for that
  // check is a driver that will not.
  var identityCheck = checkIdentityContract({
    requireSeeded : opts.requireSeededIdentity !== false
  });
  identityCheck.violations.forEach(function(violation) {
    problems.push(violation);
  });

  if (opts.mechanisms) {
    opts.mechanisms.forEach(function(name) {
      if (!current.mechanisms[name]) {
        problems.push('the ' + name + ' mechanism is required by this driver and is not active' +
          (name === 'request' && current.diagnostic ? ': ' + current.diagnostic : ''));
      }
    });
  }

  if (state.contractViolations.length) {
    problems.push(state.contractViolations.length + ' request contract violation(s) recorded: ' +
      state.contractViolations.map(function(entry) {
        return entry.endpoint + ' (' + entry.mechanism + '): ' + entry.violations.join('; ');
      }).join(' | '));
  }

  if (problems.length) {
    throw new Error('test/parity/fixtures/http.js: the fixture is not ready - ' +
      problems.join('; '));
  }

  return current;
}

// Every contract breach recorded so far, so a driver can assert on them
// without re-reading the evidence file.
function requestContractReport() {
  return {
    violations : state.contractViolations.map(function(entry) {
      return {
        mechanism  : entry.mechanism,
        endpoint   : entry.endpoint,
        url        : entry.url,
        profile    : entry.profile,
        violations : entry.violations.slice()
      };
    }),
    ok : !state.contractViolations.length
  };
}

// How many calls were served per (endpoint, profile, outcome). This is what
// turns "the profile was in force" into "the profile was USED": a check that
// counts nothing cannot tell an exercised branch from an unexercised one, which
// is how thirteen profiles came to be defined and never selected.
function servedCounts() {
  var out = {};
  Object.keys(state.served).forEach(function(key) {
    out[key] = state.served[key];
  });
  return out;
}

// ---------------------------------------------------------------------------
// Initial profile, from PARITY_HTTP_PROFILE and then from
// PARITY_HTTP_PROFILE_FILE. An unknown name is logged and ignored rather than
// thrown, because this runs at load time.
// ---------------------------------------------------------------------------
// Applies PARITY_HTTP_IDENTITIES, which is how the documented alignment hook
// acquires a caller in every process that loads this file. Before this existed,
// setIdentityEmails() was the sanctioned way to keep the fixture and the seeder
// from drifting and NOTHING called it, so the drift it exists to prevent was
// the state of the tree. A malformed value is logged and ignored - the declared
// identities stay in force and the contract check reports on them - because a
// throw here would kill the server before app.js loaded.
function alignIdentitiesFromEnvironment() {
  var declared = process.env.PARITY_HTTP_IDENTITIES;
  if (!declared) {
    return;
  }

  var parsed;
  try {
    parsed = JSON.parse(declared);
  }
  catch (e) {
    note('identities-malformed', { value: declared, keeping: identities.existing });
    return;
  }

  try {
    note('identities-aligned', applyIdentityEmails(parsed));
  }
  catch (e) {
    note('identities-rejected', { error: e.message, keeping: identities.existing });
  }
}

function selectInitialProfile() {
  var requested = process.env.PARITY_HTTP_PROFILE;

  if (requested) {
    if (Object.prototype.hasOwnProperty.call(PROFILES, requested)) {
      state.activeProfile = requested;
    }
    else {
      note('initial-profile-unknown', { requested: requested, keeping: state.activeProfile });
    }
  }

  refreshProfileFromFile();
}

// ---------------------------------------------------------------------------
// Public API. Consumed by test/parity/server.js (install), capture.js
// (profiles, setProfile, identities, endpoints, assetUrls) and replay.js
// (calls, reset, flush).
// ---------------------------------------------------------------------------
module.exports = {
  install : install,
  restore : restore,
  status  : status,

  // Readiness and evidence about the fixture itself. `assertReady` throws
  // unless every required mechanism is active, the app root is the tree it
  // claims to be, the identity contract holds and no request contract has been
  // breached; `handshake` is the same document install() published.
  assertReady   : assertReady,
  handshake     : function() { return state.handshake; },
  contractReport: requestContractReport,
  servedCounts  : servedCounts,
  identityReport: checkIdentityContract,

  // Profile selection. `profiles` is the catalogue, so capture.js enumerates
  // valid `fixtureProfile` values instead of hard-coding strings.
  profiles     : PROFILES,
  profileNames : function() { return Object.keys(PROFILES); },
  setProfile   : setProfile,
  getProfile   : function() { return state.activeProfile; },

  // Evidence.
  calls : function() { return state.calls.slice(); },
  reset : function() {
    // Clears the evidence log only. The active profile is deliberately left
    // alone, because a corpus run selects it per case through setProfile or
    // the profile file.
    state.calls = [];
    state.profileFileState = null;
    return null;
  },
  flush : flush,

  // Identities. See the SEEDING CONTRACT in the header: `existing` must be an
  // account test/parity/seed.js creates, `new` must be an account it does not,
  // and alignment goes through this function - or through
  // PARITY_HTTP_IDENTITIES, which calls it at load time - rather than by
  // editing either file.
  identities        : identities,
  seededAccounts    : SEEDED_ACCOUNTS,
  setIdentityEmails : applyIdentityEmails,

  // The frozen values a corpus assertion needs to name. `assetDigests` are the
  // sha1 hex digests of the corresponding buffers, which is what
  // lib/util/file.js turns into the stored S3 object key, so a storage
  // assertion can reference them without recomputing.
  endpoints     : ENDPOINT_URLS,
  assetUrls     : ASSET_URLS,
  unrecordedUrl : UNRECORDED_URL,
  unregisteredOriginUrl : UNREGISTERED_ORIGIN_URL,
  accessToken   : ACCESS_TOKEN,
  pictureUrl    : PICTURE_URL,
  googleIds     : { existing: GOOGLE_ID_EXISTING, new: GOOGLE_ID_NEW },
  assetBytes    : {
    complete   : ASSET_GIF,
    partial    : ASSET_GIF_PARTIAL,
    redirected : ASSET_PNG,
    errorPage  : ASSET_ERROR_PAGE,
    serverError: ASSET_SERVER_ERROR_PAGE
  },
  assetDigests  : {
    complete   : 'd5fceb6532643d0d84ffe09c40c481ecdf59e15a',
    partial    : '8885cfafb2d7b043d78a4913bb5f3b0f405b0109',
    redirected : '9fb285daedf99a4dad5de09770de5fadf688d3ee',
    errorPage  : '6196b3f53dcab9801e387f9e327228a3aaa9385a',
    // Computed rather than transcribed: a literal digest that nothing derives
    // is a claim, and this one has no measurement behind it in a document.
    serverError: sha1(ASSET_SERVER_ERROR_PAGE)
  },

  // The registry and the redirect contract, exported so a caller asserts
  // against the same numbers the fixture enforced instead of a second copy.
  registeredUrls  : function() { return Object.keys(buildAssetRegistry()); },
  redirectLimits  : {
    legacy : LEGACY_MAX_REDIRECTS,
    fetch  : FETCH_MAX_REDIRECTS,
    withinLegacyLimitHops : ASSET_HOPS_WITHIN_LEGACY_LIMIT,
    beyondLegacyLimitHops : ASSET_HOPS_BEYOND_LEGACY_LIMIT
  },
  hopUrl          : function(n) { return ASSET_HOP_PREFIX + n; },
  requestContracts: REQUEST_CONTRACTS,

  // The self-verifying harness. `selfTest()` drives every profile in the
  // catalogue and every reCAPTCHA outcome and returns a report; `main()` is the
  // same thing as a gate, which is what runs when this file is executed
  // directly. See THE SELF-VERIFYING HARNESS in the header.
  selfTest : selfTest,
  main     : main,

  EXIT_OK          : EXIT_OK,
  EXIT_ERROR       : EXIT_ERROR,
  EXIT_USAGE       : EXIT_USAGE,
  EXIT_UNPROTECTED : EXIT_UNPROTECTED
};

// ===========================================================================
// THE SELF-VERIFYING HARNESS
//
// Runs ONLY when this file is executed directly, and is inert on the preload
// path: nothing below is reached by a `require`, and no argv is read unless
// main() is called.
//
// It exists because a recorded response nothing requests is not evidence. The
// catalogue above describes twenty-two outcomes across four call sites, and a
// corpus that drives six of them leaves sixteen recordings that could be wrong
// in any way at all without a single artifact changing - which is exactly the
// state the reCAPTCHA faults, the OAuth failures and the asset status and
// redirect cases were in. Nor is "the profile was in force" the same claim as
// "the branch ran": a check that counts no calls passes on an empty run.
//
// So the harness drives every profile itself, through the same mechanisms and
// with the same call shapes the application uses, and asserts on what came
// back. Three groups can only be asserted from outside the process:
//
//   reCAPTCHA outcome 1 (the isTest short-circuit) and outcome 2 (the
//   unconfigured short-circuit) each need their own configuration state, and
//   they must be distinguishable from one another - so each runs in a child
//   with a configuration that makes only one of the two branches possible.
//
//   reCAPTCHA outcomes 5 and 6 do not deliver a callback at all. Their whole
//   contract is a process-level signature - an uncaught TypeError and an
//   uncaught SyntaxError, each killing the process - so they are asserted by
//   exit code and error type in a child, which is the only place a fatal throw
//   can be observed rather than suffered.
//
//   An unprotected install must terminate the process, which cannot be
//   asserted in the process doing the asserting.
//
// Everything else runs in-process. Every wait is bounded, every child is
// bounded, every temporary directory is removed, and the active profile and the
// identity table are restored afterwards, so a run leaves no state behind.
// ===========================================================================

// The environment variable the parent sets to tell a child which single case to
// run. A PARITY_* variable rather than an argument, because that is how every
// other input to this file arrives.
var SELFTEST_CHILD_VAR = 'PARITY_HTTP_SELFTEST_CHILD';

// Printed by a child when the reCAPTCHA callback fires. Its ABSENCE is the
// assertion for outcomes 5 and 6, so it is a marker rather than prose.
var CHILD_CALLBACK_MARKER = 'PARITY-CHILD-CALLBACK ';
var CHILD_RESULT_MARKER   = 'PARITY-CHILD-RESULT ';

// A configuration overlay carrying a reCAPTCHA secret, which is what makes
// outcomes 3-6 reachable: verify() short-circuits without one. Not a
// credential - it authenticates against this fixture and nothing else.
var SELFTEST_SECRET_OVERLAY = JSON.stringify({ app: { recaptcha: { secretkey: 'parity-fixture-secret' } } });

function expect(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function expectEqual(actual, expected, what) {
  if (actual !== expected) {
    throw new Error(what + ': expected ' + JSON.stringify(expected) +
      ', received ' + JSON.stringify(actual));
  }
}

// Resolves to the rejection a promise produced, and fails if it resolved
// instead. Used wherever the contract is a failure: a case that quietly
// tolerated a success would assert nothing.
function expectRejection(promise, what) {
  return promise.then(
    function(value) {
      throw new Error(what + ': expected a rejection, received a resolved value' +
        (value && value.status ? ' (status ' + value.status + ')' : ''));
    },
    function(error) { return error; }
  );
}

// Runs one case, records the result, and never lets a failure stop the run: a
// harness that stops at the first failure reports one finding per run.
async function runCase(report, group, name, fn) {
  var entry = { group: group, name: name, ok: true, detail: null, error: null };

  try {
    entry.detail = (await fn()) || null;
    report.passed++;
  }
  catch (error) {
    entry.ok = false;
    entry.error = error && error.message ? error.message : String(error);
    report.failed++;
  }

  report.cases.push(entry);
  return entry;
}

// The calls this fixture served since the last mark, as the evidence records
// them. Every driver asserts on this rather than on its own bookkeeping,
// because the record is what a reviewer reads.
function callsSince(mark) {
  return state.calls.slice(mark).filter(function(entry) {
    return entry.event === undefined;
  });
}

// Selects a profile, drives one thing, and returns the calls it produced.
// Wrapping selection and driving together is what makes "exactly one call, to
// this endpoint, under this profile, with this outcome" a single assertion.
async function underProfile(profile, driver) {
  var mark = state.calls.length;
  setProfile(profile);

  var value;
  var failure = null;
  try {
    value = await driver();
  }
  catch (error) {
    failure = error;
  }

  return { value: value, failure: failure, calls: callsSince(mark) };
}

// Asserts that a driver produced exactly one intercepted call with the
// expected endpoint and outcome - the check whose absence let a profile "pass"
// with nothing intercepted at all.
function expectOneCall(result, endpoint, outcome, mechanism) {
  expectEqual(result.calls.length, 1, 'exactly one call should have been intercepted');
  expectEqual(result.calls[0].endpoint, endpoint, 'the endpoint served');
  expectEqual(result.calls[0].outcome, outcome, 'the outcome served');

  if (mechanism) {
    expectEqual(result.calls[0].mechanism, mechanism, 'the mechanism that served it');
  }

  return result.calls[0];
}

// ---------------------------------------------------------------------------
// The request shapes the application sends, replicated exactly so the contract
// oracle is exercised against the real thing rather than against a convenient
// approximation.
//
// They are declared here, next to the drivers, and asserted against the call
// sites' own source text by the `sources` group below - which is what keeps
// this copy honest without importing a controller into a preload.
// ---------------------------------------------------------------------------

function tokenRequestInit(code) {
  return {
    method  : 'POST',
    headers : {
      'content-type' : 'application/x-www-form-urlencoded',
      'accept'       : 'application/json'
    },
    redirect : 'manual',
    body     : 'code=' + encodeURIComponent(code) +
               '&client_id=parity-client-id' +
               '&client_secret=parity-client-secret' +
               '&redirect_uri=' + encodeURIComponent('https://parity.example.com/auth/google/callback') +
               '&grant_type=authorization_code'
  };
}

function userinfoRequestInit(accessToken) {
  return {
    method  : 'GET',
    headers : {
      Authorization : 'Bearer ' + accessToken,
      'accept'      : 'application/json'
    }
  };
}

function recaptchaRequestInit(token) {
  return {
    method  : 'POST',
    headers : { 'content-type': 'application/x-www-form-urlencoded' },
    body    : new URLSearchParams({ secret: 'parity-fixture-secret', response: token })
  };
}

// ---------------------------------------------------------------------------
// Group: identities. The contract that decides which OAuth database branch
// runs, checked rather than described.
// ---------------------------------------------------------------------------
async function identityCases(report) {
  await runCase(report, 'identity', 'the existing identity is an account the seeder creates', async function() {
    var check = checkIdentityContract({ requireSeeded: true });
    expect(check.existingSeeded, 'identities.existing ' + JSON.stringify(check.existing) +
      ' is not among the seeded accounts ' + JSON.stringify(check.seededAccounts) +
      ', so the OAuth existing-user branch would take the new-user path instead');
    expectEqual(check.violations.length, 0, 'identity contract violations');
    return { existing: check.existing, existingUsername: check.existingUsername };
  });

  await runCase(report, 'identity', 'the new identity misses every seeded email and username', async function() {
    var check = checkIdentityContract();
    check.seededAccounts.forEach(function(email) {
      expect(email !== check.new, 'identities.new must not be the seeded address ' + email);
    });
    expect(check.new !== check.existing, 'the two identities must differ');
    expect(check.newUsername !== check.existingUsername, 'the two derived usernames must differ');
    return { new: check.new, newUsername: check.newUsername };
  });

  await runCase(report, 'identity', 'the alignment hook applies and refuses drift', async function() {
    var original = { existing: identities.existing, new: identities.new };

    try {
      var applied = applyIdentityEmails({ existing: 'admin@example.com' });
      expectEqual(applied.existing, 'admin@example.com', 'the aligned existing address');
      expectEqual(applied.existingUsername, 'admin-example-com', 'the derived username');
      expect(checkIdentityContract({ requireSeeded: true }).ok,
        'admin@example.com is seeded, so aligning to it must satisfy the contract');

      applyIdentityEmails({ new: 'test@dummy.com' });
      var drifted = checkIdentityContract();
      expect(!drifted.ok, 'a `new` identity that is seeded must be a violation');
      expect(drifted.violations.join(' ').indexOf('SEEDED') !== -1,
        'the violation must say the address is seeded, and says: ' + drifted.violations.join(' | '));

      var rejected = null;
      try {
        applyIdentityEmails({ existing: 'not-an-email' });
      }
      catch (error) {
        rejected = error;
      }
      expect(rejected, 'a value that is not an email address must be rejected');

      return { violations: drifted.violations.length };
    }
    finally {
      applyIdentityEmails(original);
    }
  });
}

// ---------------------------------------------------------------------------
// Group: the registry, and the proof that nothing escapes.
//
// This is the negative control the fixture claimed and never exercised. It runs
// against BOTH mechanisms and every endpoint class, and it includes the case
// that used to fail open: a perfectly parseable https URL on an origin no
// profile records.
// ---------------------------------------------------------------------------
async function registryCases(report, context) {
  await runCase(report, 'registry', 'an unregistered path on a recorded origin is refused', async function() {
    var result = await underProfile('default', function() {
      return expectRejection(fetch(UNRECORDED_URL), 'the unrecorded URL');
    });

    expectEqual(result.value.constructor.name, 'TypeError', 'the rejection type');
    expectEqual(result.value.message, 'fetch failed', 'the rejection message');
    expectEqual(result.value.cause.code, 'PARITY_UNRECORDED', 'the cause code');
    var call = expectOneCall(result, 'unknown', 'unrecorded', 'fetch');
    expectEqual(call.reason, 'unregistered-endpoint', 'the recorded reason');
    return { code: result.value.cause.code };
  });

  await runCase(report, 'registry', 'an unregistered ORIGIN is refused rather than served asset bytes', async function() {
    var result = await underProfile('default', function() {
      return expectRejection(fetch(UNREGISTERED_ORIGIN_URL), 'the unregistered origin');
    });

    expectEqual(result.value.cause.code, 'PARITY_UNRECORDED', 'the cause code');
    expectOneCall(result, 'unknown', 'unrecorded', 'fetch');

    // The regression this guards: the same call used to resolve 200 with the
    // active profile's asset bytes, so a new outbound endpoint - or an SSRF
    // payload - looked like a successful fetch.
    return { url: UNREGISTERED_ORIGIN_URL };
  });

  await runCase(report, 'registry', 'every enumerated asset URL and redirect hop is registered', async function() {
    var registered = Object.keys(buildAssetRegistry());
    Object.keys(ASSET_URLS).forEach(function(name) {
      var parsed = new URL(ASSET_URLS[name]);
      expect(registered.indexOf(parsed.origin + parsed.pathname) !== -1,
        'the asset URL ' + name + ' must be registered');
    });

    for (var hop = 1; hop <= ASSET_HOPS_BEYOND_LEGACY_LIMIT; hop++) {
      var hopUrl = new URL(ASSET_HOP_PREFIX + hop);
      expect(registered.indexOf(hopUrl.origin + hopUrl.pathname) !== -1,
        'redirect hop ' + hop + ' must be registered, or a caller following the ' +
        'chain itself would fail half way through it');
    }

    return { registered: registered.length };
  });

  await runCase(report, 'registry', 'a non-http scheme and an unparseable URL are refused', async function() {
    var scheme = classify('data:image/gif;base64,R0lGODlhAQABAAAAACw=');
    expectEqual(scheme.endpoint, null, 'a data: URL must not classify');
    expect(scheme.reason.indexOf('unsupported-protocol') === 0, 'the reason: ' + scheme.reason);

    var broken = classify('http://[not-a-host]/x');
    expectEqual(broken.endpoint, null, 'an unparseable URL must not classify');
    expectEqual(broken.reason, 'unparseable-url', 'the reason');

    expectEqual(classify('').endpoint, null, 'an empty URL must not classify');
    expectEqual(classify(null).endpoint, null, 'a missing URL must not classify');
    return { reasons: [scheme.reason, broken.reason] };
  });

  await runCase(report, 'registry', 'the `none` profile records nothing for any endpoint', async function() {
    var endpoints = [
      ['recaptcha', ENDPOINT_URLS.recaptcha, recaptchaRequestInit('t')],
      ['token', ENDPOINT_URLS.token, tokenRequestInit('c')],
      ['userinfo', ENDPOINT_URLS.userinfo, userinfoRequestInit(ACCESS_TOKEN)],
      ['asset', ASSET_URLS.plain, undefined]
    ];

    var codes = [];
    for (var i = 0; i < endpoints.length; i++) {
      var entry = endpoints[i];
      var result = await underProfile('none', function() {
        return expectRejection(fetch(entry[1], entry[2]), 'the ' + entry[0] + ' endpoint under `none`');
      });

      expectEqual(result.value.cause.code, 'PARITY_UNRECORDED', entry[0] + ': the cause code');
      expectOneCall(result, entry[0], 'unrecorded', 'fetch');
      codes.push(entry[0]);
    }

    return { endpoints: codes };
  });

  await runCase(report, 'registry', 'a credential-bearing URL is refused exactly as native fetch refuses it', async function() {
    // Measured on Node v22.23.2: fetch rejects a URL with userinfo before any
    // request, with a TypeError naming the URL and no `cause`. The replaced
    // library ACCEPTED such a URL, so this is one of the differences the
    // migration introduced at the asset call site - and a fixture that stripped
    // the credentials and served a 200 would report parity across it.
    var result = await underProfile('asset:success', function() {
      return expectRejection(fetch('https://user:pass@parity.example.com/assets/fixture.gif'),
        'a credential-bearing URL');
    });

    expectEqual(result.value.constructor.name, 'TypeError', 'the rejection type');
    expect(result.value.message.indexOf('Request cannot be constructed from a URL that includes credentials') === 0,
      'the message must be the runtime\'s own, and is: ' + result.value.message);
    expectEqual(result.value.cause, undefined, 'native fetch attaches no cause to this refusal');
    expect(result.value.message.indexOf('user:pass@') === -1,
      'and the message must not carry the credentials it is refusing');

    var call = expectOneCall(result, 'asset', 'credential-url-refused', 'fetch');
    expect(call.url.indexOf('userinfo-stripped:') === 0,
      'the record must mark the stripped authority, and carries: ' + call.url);
    expect(call.url.indexOf('pass') === -1, 'and must not carry the credential');
    return { message: result.value.message };
  });

  await runCase(report, 'registry', 'no credential reaches the evidence, from a header, a query or an authority', async function() {
    var mark = state.calls.length;
    setProfile('recaptcha:success');

    var secrets = ['COOKIE-SECRET-VALUE', 'APIKEY-SECRET-VALUE', 'QUERY-SECRET-VALUE', 'AUTHORITY-SECRET'];

    // Served: extra credential-bearing headers alongside a conforming request.
    var init = recaptchaRequestInit('probe-token');
    init.headers = {
      'content-type'  : 'application/x-www-form-urlencoded',
      'cookie'        : 'session=' + secrets[0] + '; Path=/',
      'x-api-key'     : secrets[1] + ' trailing',
      'authorization' : 'Bearer ' + secrets[1]
    };
    await fetch(ENDPOINT_URLS.recaptcha, init);

    // Refused: a signed query, which the contract now rejects - and whose
    // values must be redacted in the violation as well as in the record. The
    // refusal is deliberate, so it is counted: the accounting case at the end
    // of the run requires every recorded violation to be one a case drove on
    // purpose, and it caught this one when it was not.
    context.deliberateBreaches++;
    try {
      await fetch(ENDPOINT_URLS.recaptcha + '?X-Amz-Credential=' + secrets[2] +
        '&X-Amz-Security-Token=' + secrets[2], recaptchaRequestInit('probe-token'));
    }
    catch (ignored) { /* the refusal is the point; the evidence is what is asserted */ }

    // Unparseable, and carrying a secret in what would have been its query.
    try {
      await fetch('https://[broken]/x?access_token=' + secrets[3]);
    }
    catch (ignored) { /* likewise */ }

    var evidence = JSON.stringify(state.calls.slice(mark));
    secrets.forEach(function(secret) {
      expect(evidence.indexOf(secret) === -1,
        'the evidence must not carry ' + secret + '; it appears in: ' +
        evidence.slice(Math.max(0, evidence.indexOf(secret) - 80), evidence.indexOf(secret) + 40));
    });

    expect(evidence.indexOf('unparseable-url:sha1:') !== -1,
      'an unparseable URL must be reduced to a digest rather than written out');
    return { probed: secrets.length };
  });

  await runCase(report, 'registry', 'the retained originals were never invoked', async function() {
    expectEqual(context.tripwire.fetchCalls, 0,
      'the genuine fetch must never be called, and was called ' + context.tripwire.fetchCalls + ' time(s)');
    expectEqual(context.tripwire.requestCalls, 0,
      'the genuine request export must never be called, and was called ' + context.tripwire.requestCalls + ' time(s)');
    return { fetchCalls: 0, requestCalls: 0 };
  });
}

// ---------------------------------------------------------------------------
// Group: readiness. The assertion a driver makes before trusting a run, and
// the states it has to refuse.
// ---------------------------------------------------------------------------
async function readinessCases(report) {
  await runCase(report, 'install', 'assertReady() passes when the fixture is wholly in force', async function() {
    var current = assertReady({ requireSeededIdentity: true });
    expectEqual(current.installed, true, 'the fixture must be installed');
    expectEqual(current.mechanisms.fetch, true, 'fetch must be active');
    expectEqual(current.appRootVerified, true, 'the app root must verify');
    expectEqual(current.identity.identityOk, true, 'the identity contract must hold');
    return { mechanisms: current.mechanisms };
  });

  await runCase(report, 'install', 'assertReady() refuses a mechanism this driver needs and does not have', async function() {
    var threw = null;
    try {
      // `request` is absent from the target manifest, so a driver that needs
      // the legacy mechanism must be told so rather than run against fetch and
      // report a baseline it never exercised.
      assertReady({ mechanisms: ['request'] });
    }
    catch (error) {
      threw = error;
    }

    expect(threw, 'a driver requiring the request mechanism must be refused on this tree');
    expect(threw.message.indexOf('request mechanism is required') !== -1,
      'the refusal must name the mechanism, and says: ' + threw.message);
    return { refused: true };
  });

  await runCase(report, 'install', 'assertReady() requires the seeded identity BY DEFAULT', async function() {
    var original = { existing: identities.existing, new: identities.new };
    var threw = null;

    try {
      // An address no seeded account holds: the OAuth existing-user branch
      // would silently take the new-user path, which is the inversion the
      // identity contract exists to prevent. A driver must not have to ask for
      // that check.
      applyIdentityEmails({ existing: 'nobody-seeded-this@example.com' });

      try {
        assertReady();
      }
      catch (error) {
        threw = error;
      }
    }
    finally {
      applyIdentityEmails(original);
    }

    expect(threw, 'an unseeded existing identity must fail default readiness');
    expect(threw.message.indexOf('not one of the accounts') !== -1,
      'the refusal must say the address is not seeded, and says: ' + threw.message);
    assertReady();                     // and the restored identity passes again
    return { refused: true };
  });

  await runCase(report, 'install', 'assertReady() refuses an uninstalled fixture', async function() {
    var threw = null;
    restore();

    try {
      assertReady();
    }
    catch (error) {
      threw = error;
    }
    finally {
      install();
    }

    expect(threw, 'a restored fixture is not ready, and must say so');
    expect(threw.message.indexOf('not installed') !== -1,
      'the refusal must say the fixture is not installed, and says: ' + threw.message);
    expectEqual(status().installed, true, 'and the fixture must be back in force afterwards');
    return { refused: true };
  });

  await runCase(report, 'install', 'the handshake is recorded in the evidence log of every run', async function() {
    var installRecords = state.calls.filter(function(entry) { return entry.event === 'install'; });
    expect(installRecords.length >= 1,
      'install() must record its handshake, so a run that sets no PARITY_HTTP_STATUS still carries it');

    var recorded = installRecords[installRecords.length - 1].detail;
    expectEqual(recorded.identity.module, __filename, 'the handshake names this implementation');
    expectEqual(recorded.identity.digest, fixtureDigest, 'and carries its digest');
    return { records: installRecords.length };
  });
}

// ---------------------------------------------------------------------------
// Group: reCAPTCHA, all six outcomes, by DIRECT MODULE-LEVEL INVOCATION of
// lib/util/recaptcha.js's verify().
//
// This is the group the header promised and nothing performed. It matters more
// than its size suggests: under NODE_ENV=test `config.isTest` is true and
// outcome 1 short-circuits before any HTTP, so these five recorded responses
// are unreachable through any route in the suite. Direct invocation is the only
// way they are ever exercised, and until it existed the five records were
// unexecuted code.
//
// Outcomes 3, 4 and the rejected variant run here. Outcomes 1, 2, 5 and 6 need
// their own process, and childCases() drives them.
// ---------------------------------------------------------------------------
async function recaptchaCases(report, context) {
  var recaptcha = context.recaptcha;

  if (!recaptcha) {
    await runCase(report, 'recaptcha', 'lib/util/recaptcha.js is loadable', async function() {
      throw new Error('lib/util/recaptcha.js could not be required from ' +
        context.appRoot + ': ' + context.recaptchaError +
        '. Every reCAPTCHA outcome is unexercised without it.');
    });
    return;
  }

  // verify() takes a callback and returns nothing, so each outcome is bounded
  // here rather than left to resolve whenever.
  function verifyOnce(token) {
    return new Promise(function(resolve, reject) {
      var settled = false;
      var timer = setTimeout(function() {
        if (!settled) {
          settled = true;
          reject(new Error('verify() did not call back within 5000ms'));
        }
      }, 5000);

      recaptcha.verify(token, function(result) {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolve(result);
      });
    });
  }

  await runCase(report, 'recaptcha', 'outcome 3: a 200 delivers the body parsed from response.body', async function() {
    var result = await underProfile('recaptcha:success', function() { return verifyOnce('parity-token'); });
    expect(!result.failure, 'verify() should have called back: ' + (result.failure && result.failure.message));
    expectEqual(result.value.success, true, 'the parsed `success` field');
    expectEqual(result.value.challenge_ts, '2015-06-15T12:00:00Z', 'the frozen challenge_ts');
    expectEqual(result.value.score, 0.9, 'the parsed score');

    var call = expectOneCall(result, 'recaptcha', 'recaptcha-200-success', 'fetch');
    expectEqual(call.request.method, 'POST', 'the outbound method');
    expectEqual(call.request.headers['content-type'], 'application/x-www-form-urlencoded',
      'the outbound content-type');
    expect(call.request.bodyFields.indexOf('secret') !== -1, 'the body must carry `secret`');
    expect(call.request.bodyFields.indexOf('response') !== -1, 'the body must carry `response`');
    expectEqual(call.request.bodyValues.secret, REDACTED, 'the secret must be redacted in the evidence');
    return { fields: call.request.bodyFields };
  });

  await runCase(report, 'recaptcha', 'outcome 3 (rejected): success false reaches the caller as false', async function() {
    var result = await underProfile('recaptcha:rejected', function() { return verifyOnce('parity-token'); });
    expectEqual(result.value.success, false, 'the parsed `success` field');
    expect(Array.isArray(result.value['error-codes']), 'the provider error codes must survive');
    expectOneCall(result, 'recaptcha', 'recaptcha-200-rejected', 'fetch');
    return { errorCodes: result.value['error-codes'] };
  });

  await runCase(report, 'recaptcha', 'outcome 4: a non-200 delivers {status:false}, a DIFFERENT shape', async function() {
    var result = await underProfile('recaptcha:non-200', function() { return verifyOnce('parity-token'); });
    expectEqual(JSON.stringify(result.value), '{"status":false}', 'the callback value');
    expectEqual(result.value.success, undefined,
      'the non-200 shape must NOT carry `success`: callers branch on `success`, so a ' +
      'non-200 is a differently shaped object rather than a falsy success');
    expectOneCall(result, 'recaptcha', 'recaptcha-503', 'fetch');
    return { value: result.value };
  });
}

// ---------------------------------------------------------------------------
// Group: Google OAuth. Every provider outcome, driven with the exact call
// shapes lib/controllers/auth.js sends.
//
// The controller itself cannot be driven from here - its handlers need a hapi
// request, a live database and the `log` and `User` globals app.js installs -
// so the two calls are replicated and the replication is pinned to the
// controller's own source text by the `sources` group. What that buys is the
// oracle the encoding helpers had none of: the outbound method, headers, form
// fields, encoding and redirect mode are asserted per outcome, on the record
// the evidence log carries.
// ---------------------------------------------------------------------------
async function oauthCases(report) {
  // The token exchange, as the controller issues it.
  function exchangeToken() {
    return fetch(ENDPOINT_URLS.token, tokenRequestInit('parity-authorization-code'))
      .then(function(response) {
        return response.text().then(function(text) {
          return { status: response.status, body: legacyJsonBody(text) };
        });
      });
  }

  function fetchProfile() {
    return fetch(ENDPOINT_URLS.userinfo, userinfoRequestInit(ACCESS_TOKEN))
      .then(function(response) {
        return response.text().then(function(text) {
          return { status: response.status, body: legacyJsonBody(text) };
        });
      });
  }

  await runCase(report, 'oauth', 'success (existing user): the token and the seeded email', async function() {
    var token = await underProfile('oauth:success-existing-user', exchangeToken);
    expectEqual(token.value.status, 200, 'the token status');
    expectEqual(token.value.body.access_token, ACCESS_TOKEN, 'the frozen access token');
    var tokenCall = expectOneCall(token, 'token', 'token-200-success', 'fetch');
    expectEqual(tokenCall.request.redirect, 'manual',
      'the token exchange must not follow redirects: fetch downgrades a redirected POST to GET');
    expectEqual(tokenCall.request.bodyValues.grant_type, 'authorization_code', 'the grant type');
    expectEqual(tokenCall.request.bodyValues.code, REDACTED,
      'the authorization code must be redacted in the evidence');

    var profile = await underProfile('oauth:success-existing-user', fetchProfile);
    expectEqual(profile.value.body.email, identities.existing,
      'the profile email must be the SEEDED identity, or this profile drives the new-user branch');
    expectEqual(profile.value.body.picture, PICTURE_URL, 'the frozen picture URL');
    expectEqual(profile.value.body.id, GOOGLE_ID_EXISTING, 'the frozen Google id');
    var profileCall = expectOneCall(profile, 'userinfo', 'userinfo-200-existing-user', 'fetch');
    expectEqual(profileCall.request.headers.authorization, 'Bearer ' + REDACTED,
      'the bearer token must be redacted in the evidence, with its scheme intact');
    return { email: profile.value.body.email };
  });

  await runCase(report, 'oauth', 'success (new user): an email no seeded account holds', async function() {
    var profile = await underProfile('oauth:success-new-user', fetchProfile);
    expectEqual(profile.value.body.email, identities.new, 'the profile email');
    expectEqual(profile.value.body.id, GOOGLE_ID_NEW, 'the frozen Google id');
    checkIdentityContract().seededAccounts.forEach(function(seeded) {
      expect(profile.value.body.email !== seeded,
        'the new-user email must not be the seeded address ' + seeded);
    });
    expectOneCall(profile, 'userinfo', 'userinfo-200-new-user', 'fetch');

    // The branch this feeds is the preserved save-then-fail: the account IS
    // created and a generic authentication failure IS reported (AAP 0.6.6).
    // What is asserted here is the input that selects it - the outcome itself
    // belongs to the corpus, which drives the controller.
    return { email: profile.value.body.email, selects: 'new-user branch' };
  });

  await runCase(report, 'oauth', 'token 400: err is null and the body is still parsed', async function() {
    var token = await underProfile('oauth:token-non-2xx', exchangeToken);
    expectEqual(token.value.status, 400, 'the token status');
    expectEqual(token.value.body.error, 'invalid_grant', 'the provider error');
    expectEqual(token.value.body.access_token, undefined,
      'no access token, so the guard rejects and the generic failure is reported');
    expectOneCall(token, 'token', 'token-400-invalid-grant', 'fetch');
    return { status: 400 };
  });

  await runCase(report, 'oauth', 'token 200 with no access_token', async function() {
    var token = await underProfile('oauth:token-malformed-body', exchangeToken);
    expectEqual(token.value.status, 200, 'the token status');
    expectEqual(token.value.body.access_token, undefined, 'the missing access token');
    expectEqual(token.value.body.token_type, 'Bearer', 'the rest of the body survives');
    expectOneCall(token, 'token', 'token-200-no-access-token', 'fetch');
    return { status: 200 };
  });

  await runCase(report, 'oauth', 'token 200 whose body parses to null: the guard THROWS', async function() {
    var token = await underProfile('oauth:token-non-object-body', exchangeToken);
    expectEqual(token.value.status, 200, 'the token status');
    expectEqual(token.value.body, null,
      'a body of `null` must arrive as null - reading access_token off it is what throws a ' +
      'TypeError out of the callback and leaves the request unanswered (preserved, R-d)');

    var threw = null;
    try {
      // The guard the controller runs, on the value the fixture delivered.
      void (!token.value.body.access_token);
    }
    catch (error) {
      threw = error;
    }
    expect(threw && threw.constructor.name === 'TypeError',
      'the preserved fault is a TypeError, and was ' + (threw ? threw.constructor.name : 'no throw'));
    expectOneCall(token, 'token', 'token-200-null-body', 'fetch');
    return { body: null, fault: 'TypeError' };
  });

  await runCase(report, 'oauth', 'token transport failure: TypeError(fetch failed) with a cause', async function() {
    var token = await underProfile('oauth:token-transport-failure', function() {
      return expectRejection(exchangeToken(), 'the token exchange');
    });

    expectEqual(token.value.constructor.name, 'TypeError', 'the rejection type');
    expectEqual(token.value.message, 'fetch failed', 'the rejection message');
    expectEqual(token.value.cause.code, 'ECONNREFUSED',
      'the cause must be the Error the replaced library reported directly - the controller unwraps it');
    expectEqual(token.value.cause.syscall, 'connect', 'the cause syscall');
    expectOneCall(token, 'token', 'token-transport-failure', 'fetch');
    return { code: token.value.cause.code };
  });

  await runCase(report, 'oauth', 'profile 200 with no email', async function() {
    var profile = await underProfile('oauth:profile-missing-email', fetchProfile);
    expectEqual(profile.value.status, 200, 'the profile status');
    expectEqual(profile.value.body.email, undefined, 'the missing email');
    expectEqual(profile.value.body.id, GOOGLE_ID_EXISTING, 'the rest of the profile survives');
    expectOneCall(profile, 'userinfo', 'userinfo-200-missing-email', 'fetch');
    return { status: 200 };
  });

  await runCase(report, 'oauth', 'profile transport failure', async function() {
    var profile = await underProfile('oauth:profile-transport-failure', function() {
      return expectRejection(fetchProfile(), 'the profile fetch');
    });

    expectEqual(profile.value.cause.code, 'ECONNREFUSED', 'the cause code');
    expectEqual(profile.value.cause.hostname, 'www.googleapis.com', 'the host named in the cause');
    expectOneCall(profile, 'userinfo', 'userinfo-transport-failure', 'fetch');
    return { code: profile.value.cause.code };
  });

  await runCase(report, 'oauth', 'the token exchange under `oauth:profile-*` still succeeds', async function() {
    // The layering the catalogue promises: a profile that speaks only about the
    // userinfo endpoint still serves the recorded token response, so the chain
    // reaches the branch the profile is about instead of failing earlier.
    var token = await underProfile('oauth:profile-missing-email', exchangeToken);
    expectEqual(token.value.body.access_token, ACCESS_TOKEN, 'the layered token response');
    expectOneCall(token, 'token', 'token-200-success', 'fetch');
    return { layered: true };
  });
}

// ---------------------------------------------------------------------------
// Group: the streaming asset fetch. Every mode, including the two the corpus
// never drove - a non-2xx and a followed redirect - the 500 that had no record
// at all, and the redirect modes and limits that were previously ignored.
//
// The consumer is replicated from lib/controllers/users.js: content-type off
// the response headers, and the body read through the same web-stream path.
// ---------------------------------------------------------------------------
async function assetCases(report) {
  // What the call site does with a response: read the content type, then drain
  // the body. Errors during the drain are returned rather than thrown, because
  // for two of these modes the drain failing IS the outcome.
  async function drain(response) {
    var contentType = response.headers.get('content-type');
    var chunks = [];
    var failure = null;

    try {
      var reader = response.body.getReader();
      for (;;) {
        var step = await reader.read();
        if (step.done) {
          break;
        }
        chunks.push(Buffer.from(step.value));
      }
    }
    catch (error) {
      failure = error;
    }

    return {
      status      : response.status,
      contentType : contentType,
      bytes       : Buffer.concat(chunks),
      failure     : failure
    };
  }

  await runCase(report, 'asset', 'success: the exact bytes, and therefore the exact stored key', async function() {
    var result = await underProfile('asset:success', function() { return fetch(ASSET_URLS.plain); });
    var body = await drain(result.value);
    expectEqual(body.status, 200, 'the status');
    expectEqual(body.contentType, 'image/gif', 'the content type the upload will store');
    expectEqual(sha1(body.bytes), module.exports.assetDigests.complete,
      'the sha1 of the delivered bytes IS the S3 object key lib/util/file.js derives, so it is ' +
      'compared rather than the length');
    expect(!body.failure, 'the drain must not fail');
    expectOneCall(result, 'asset', 'asset-200-complete', 'fetch');
    return { digest: sha1(body.bytes) };
  });

  await runCase(report, 'asset', 'the query-bearing URL is served identically', async function() {
    var result = await underProfile('asset:success', function() { return fetch(ASSET_URLS.query); });
    var body = await drain(result.value);
    expectEqual(sha1(body.bytes), module.exports.assetDigests.complete, 'the delivered digest');
    expectOneCall(result, 'asset', 'asset-200-complete', 'fetch');

    // The query survives into the stored filename, which is why the corpus
    // drives this URL: path.basename over a legacy `path` that retains '?v=2'.
    expect(ASSET_URLS.query.indexOf('?v=2') !== -1, 'the query must be part of the URL under test');
    return { url: ASSET_URLS.query };
  });

  await runCase(report, 'asset', '404: not a transport error, so the error page is uploaded', async function() {
    var result = await underProfile('asset:non-2xx', function() { return fetch(ASSET_URLS.missing); });
    var body = await drain(result.value);
    expectEqual(body.status, 404, 'the status');
    expectEqual(body.contentType, 'text/html; charset=UTF-8', 'the content type the upload will store');
    expectEqual(sha1(body.bytes), module.exports.assetDigests.errorPage, 'the delivered digest');
    expect(!body.failure, 'a non-2xx must still complete: the bytes really are uploaded');
    expectOneCall(result, 'asset', 'asset-404-uploaded', 'fetch');
    return { status: 404, digest: sha1(body.bytes) };
  });

  await runCase(report, 'asset', '500: a distinct status and distinct stored bytes from the 404', async function() {
    var result = await underProfile('asset:server-error', function() { return fetch(ASSET_URLS.serverError); });
    var body = await drain(result.value);
    expectEqual(body.status, 500, 'the status');
    expectEqual(sha1(body.bytes), module.exports.assetDigests.serverError, 'the delivered digest');
    expect(sha1(body.bytes) !== module.exports.assetDigests.errorPage,
      'the 500 must store different bytes from the 404, or one record could not evidence both');
    expect(!body.failure, 'a 5xx must still complete, exactly as the 404 does');
    expectOneCall(result, 'asset', 'asset-500-uploaded', 'fetch');
    return { status: 500, digest: sha1(body.bytes) };
  });

  await runCase(report, 'asset', 'redirect, followed: only the FINAL response is observable', async function() {
    // Driven from the chain's ENTRY point, which is the URL a caller supplies.
    // The destination is a different URL, and requesting IT directly serves the
    // final response with no hop - which is what makes a hop-counting walk
    // terminate instead of circling the chain (asserted below).
    var result = await underProfile('asset:redirect', function() { return fetch(ASSET_URLS.plain); });
    var body = await drain(result.value);
    expectEqual(body.status, 200, 'the final status');
    expectEqual(body.contentType, 'image/png', 'the FINAL response content type, never the 302\'s');
    expectEqual(sha1(body.bytes), module.exports.assetDigests.redirected,
      'the final bytes - which is how "the consumer observed the final response" is provable');
    expectEqual(result.value.redirected, true, 'the response is marked as redirected');
    expectOneCall(result, 'asset', 'asset-302-followed', 'fetch');
    return { digest: sha1(body.bytes) };
  });

  await runCase(report, 'asset', 'redirect, manual: the 3xx itself, with its Location', async function() {
    var result = await underProfile('asset:redirect', function() {
      return fetch(ASSET_URLS.plain, { redirect: 'manual' });
    });

    expectEqual(result.value.status, 302, 'the status a manual caller receives');
    expectEqual(result.value.headers.get('location'), ASSET_URLS.redirect, 'the Location header');
    var call = expectOneCall(result, 'asset', 'asset-302-followed', 'fetch');
    expectEqual(call.request.redirect, 'manual', 'the recorded redirect mode');
    return { status: 302 };
  });

  await runCase(report, 'asset', 'redirect, error mode: the promise rejects', async function() {
    var result = await underProfile('asset:redirect', function() {
      return expectRejection(fetch(ASSET_URLS.plain, { redirect: 'error' }), 'redirect mode error');
    });

    expectEqual(result.value.constructor.name, 'TypeError', 'the rejection type');
    expectEqual(result.value.cause.code, 'PARITY_REDIRECT_MODE', 'the cause code');
    return { code: result.value.cause.code };
  });

  await runCase(report, 'asset', 'requesting the destination directly serves the final response', async function() {
    var result = await underProfile('asset:redirect', function() {
      return fetch(ASSET_URLS.redirect, { redirect: 'manual' });
    });

    expectEqual(result.value.status, 200,
      'the chain\'s destination is not itself a hop, or a caller counting hops would be ' +
      'redirected round the chain again and never terminate');
    expectEqual(sha1(Buffer.from(await result.value.arrayBuffer())), module.exports.assetDigests.redirected,
      'the destination bytes');
    return { status: 200 };
  });

  await runCase(report, 'asset', 'a 10-hop chain is inside both limits and still arrives', async function() {
    var result = await underProfile('asset:redirect-within-limit', function() {
      return fetch(ASSET_URLS.plain);
    });

    var body = await drain(result.value);
    expectEqual(body.status, 200, 'the final status');
    expectEqual(sha1(body.bytes), module.exports.assetDigests.redirected, 'the final bytes');
    expectEqual(ASSET_HOPS_WITHIN_LEGACY_LIMIT, LEGACY_MAX_REDIRECTS,
      'the within-limit chain must be exactly at the legacy limit to be a boundary case');
    return { hops: ASSET_HOPS_WITHIN_LEGACY_LIMIT };
  });

  await runCase(report, 'asset', 'a manual hop-walk terminates at the destination', async function() {
    // What a caller enforcing its OWN redirect limit does: one request per hop
    // with redirect:'manual', counting as it goes. It is the only shape a limit
    // below the runtime's can be implemented in, and the fixture has to serve
    // it hop by hop for that to be testable at all.
    var mark = state.calls.length;
    setProfile('asset:redirect-within-limit');

    var target = ASSET_URLS.plain;
    var hops = 0;
    var final = null;

    while (hops <= LEGACY_MAX_REDIRECTS + 1) {
      var response = await fetch(target, { redirect: 'manual' });
      if (response.status < 300 || response.status > 399) {
        final = response;
        break;
      }
      hops++;
      target = response.headers.get('location');
      expect(target, 'every hop must carry a Location header');
    }

    expect(final, 'the walk must reach a non-redirect response');
    expectEqual(hops, ASSET_HOPS_WITHIN_LEGACY_LIMIT, 'the number of hops walked');
    expectEqual(final.status, 200, 'the destination status');
    expectEqual(sha1(Buffer.from(await final.arrayBuffer())), module.exports.assetDigests.redirected,
      'the destination bytes');
    expectEqual(callsSince(mark).length, ASSET_HOPS_WITHIN_LEGACY_LIMIT + 1,
      'one intercepted call per hop plus the destination');
    return { hops: hops };
  });

  await runCase(report, 'asset', 'an 11-hop chain is where the two mechanisms disagree', async function() {
    // Inside fetch's limit of 20, so following it succeeds - and outside the
    // replaced library's 10, which the request-mechanism group asserts on the
    // other side. Serving both is what makes a claim about which limit the call
    // site now enforces checkable rather than asserted in a comment.
    var result = await underProfile('asset:redirect-beyond-limit', function() {
      return fetch(ASSET_URLS.plain);
    });

    var body = await drain(result.value);
    expectEqual(body.status, 200, 'fetch follows 11 hops, being inside its own limit of ' + FETCH_MAX_REDIRECTS);
    expect(ASSET_HOPS_BEYOND_LEGACY_LIMIT > LEGACY_MAX_REDIRECTS,
      'the chain must exceed the legacy limit to be the boundary case');
    expect(ASSET_HOPS_BEYOND_LEGACY_LIMIT <= FETCH_MAX_REDIRECTS,
      'and must stay inside the runtime limit');
    return { hops: ASSET_HOPS_BEYOND_LEGACY_LIMIT, followedBy: 'fetch' };
  });

  await runCase(report, 'asset', 'refused: rejects, and NOTHING is delivered', async function() {
    var result = await underProfile('asset:transport-refused', function() {
      return expectRejection(fetch(ASSET_URLS.plain), 'the refused asset');
    });

    expectEqual(result.value.message, 'fetch failed', 'the rejection message');
    expectEqual(result.value.cause.code, 'ECONNREFUSED', 'the cause code');
    expectOneCall(result, 'asset', 'asset-transport-refused', 'fetch');

    // The preserved consequence (R-d): no response means the upload never
    // starts and the route is left UNSETTLED. Nothing here may synthesize a
    // completion.
    return { code: result.value.cause.code, consequence: 'route left unsettled' };
  });

  await runCase(report, 'asset', 'mid-stream: the partial bytes arrive, THEN the failure', async function() {
    var result = await underProfile('asset:midstream-failure', function() { return fetch(ASSET_URLS.plain); });
    var body = await drain(result.value);

    expectEqual(body.status, 200, 'the status - the response itself succeeded');
    expectEqual(body.contentType, 'image/gif', 'the content type');
    expectEqual(sha1(body.bytes), module.exports.assetDigests.partial,
      'the PARTIAL bytes, which is what the upload stores');
    expect(body.failure, 'the drain must fail after the partial bytes');
    expectEqual(body.failure.code, 'ECONNRESET', 'the failure code');
    expect(body.bytes.length < ASSET_GIF.length, 'the partial content must be shorter than the whole');
    expectOneCall(result, 'asset', 'asset-midstream-failure', 'fetch');
    return { bytes: body.bytes.length, digest: sha1(body.bytes) };
  });
}

// ---------------------------------------------------------------------------
// Group: the request-contract oracle itself.
//
// A drifted encoding used to be served a recorded success, so the corpus stayed
// identical and the drift was invisible. Each case here breaches one clause and
// asserts the call is REFUSED - which is what makes the oracle load-bearing
// rather than decorative - and the last case asserts a conforming call is not.
// ---------------------------------------------------------------------------
async function contractCases(report, context) {
  async function expectRefusal(url, init, expected) {
    var before = state.contractViolations.length;
    var error = await expectRejection(fetch(url, init), expected);
    context.deliberateBreaches++;

    expectEqual(error.cause.code, 'PARITY_CONTRACT',
      'a contract breach must be refused with PARITY_CONTRACT, and produced ' +
      (error.cause && error.cause.code));
    expectEqual(state.contractViolations.length, before + 1, 'one violation recorded');

    var recorded = state.contractViolations[state.contractViolations.length - 1];
    expect(recorded.violations.join(' ').indexOf(expected) !== -1,
      'the violation must name ' + JSON.stringify(expected) + ', and says: ' +
      recorded.violations.join(' | '));

    return recorded;
  }

  await runCase(report, 'contract', 'a wrong method is refused', async function() {
    setProfile('default');
    var recorded = await expectRefusal(ENDPOINT_URLS.token,
      Object.assign(tokenRequestInit('c'), { method: 'GET' }), 'method must be POST');
    return { violations: recorded.violations };
  });

  await runCase(report, 'contract', 'a missing accept header is refused', async function() {
    setProfile('default');
    var init = tokenRequestInit('c');
    delete init.headers.accept;
    var recorded = await expectRefusal(ENDPOINT_URLS.token, init, 'header accept must be');
    return { violations: recorded.violations };
  });

  await runCase(report, 'contract', 'a followed token POST is refused', async function() {
    setProfile('default');
    var init = tokenRequestInit('c');
    init.redirect = 'follow';
    var recorded = await expectRefusal(ENDPOINT_URLS.token, init, 'the redirect mode must be');
    return { violations: recorded.violations };
  });

  await runCase(report, 'contract', 'a "+"-encoded space in the token body is refused', async function() {
    setProfile('default');
    var init = tokenRequestInit('c');
    // What URLSearchParams would produce and what qs never did: a space as '+'.
    init.body = 'code=a+b&client_id=x&grant_type=authorization_code';
    var recorded = await expectRefusal(ENDPOINT_URLS.token, init, 'not RFC 3986 encoded');
    return { violations: recorded.violations };
  });

  await runCase(report, 'contract', 'a missing form field is refused', async function() {
    setProfile('default');
    var init = tokenRequestInit('c');
    init.body = 'client_id=x&grant_type=authorization_code';
    var recorded = await expectRefusal(ENDPOINT_URLS.token, init, 'must carry the field "code"');
    return { violations: recorded.violations };
  });

  await runCase(report, 'contract', 'a wrong grant_type is refused', async function() {
    setProfile('default');
    var init = tokenRequestInit('c');
    init.body = 'code=a&client_id=x&grant_type=refresh_token';
    var recorded = await expectRefusal(ENDPOINT_URLS.token, init, 'must be "authorization_code"');
    return { violations: recorded.violations };
  });

  await runCase(report, 'contract', 'a profile fetch with no bearer scheme is refused', async function() {
    setProfile('default');
    var recorded = await expectRefusal(ENDPOINT_URLS.userinfo, {
      method  : 'GET',
      headers : { Authorization: ACCESS_TOKEN, 'accept': 'application/json' }
    }, 'must start with "Bearer "');
    return { violations: recorded.violations };
  });

  await runCase(report, 'contract', 'a siteverify call with no secret is refused', async function() {
    setProfile('default');
    var recorded = await expectRefusal(ENDPOINT_URLS.recaptcha, {
      method  : 'POST',
      headers : { 'content-type': 'application/x-www-form-urlencoded' },
      body    : new URLSearchParams({ response: 'token-only' })
    }, 'must carry the field "secret"');
    return { violations: recorded.violations };
  });

  await runCase(report, 'contract', 'an unexpected query string on a JSON endpoint is refused', async function() {
    setProfile('default');
    // Endpoint matching is on (origin, pathname), so a query the call site
    // never sends would otherwise be served the recorded response as though it
    // had not been sent - including a signed or credential-bearing one.
    var recorded = await expectRefusal(
      ENDPOINT_URLS.token + '?X-Amz-Credential=probe&sig=probe',
      tokenRequestInit('parity-authorization-code'),
      'called with no query string');
    return { violations: recorded.violations };
  });

  await runCase(report, 'contract', 'a token body missing client_secret or redirect_uri is refused', async function() {
    setProfile('default');
    var init = tokenRequestInit('c');
    // `formEncode` drops only an undefined value and node-config reads an unset
    // key as null, so both fields are always PRESENT on the wire, with an empty
    // value where the deployment leaves them unset. A body without them is a
    // changed body.
    init.body = 'code=a&client_id=x&grant_type=authorization_code';
    var recorded = await expectRefusal(ENDPOINT_URLS.token, init, 'must carry the field "client_secret"');
    expect(recorded.violations.join(' ').indexOf('"redirect_uri"') !== -1,
      'and the missing redirect_uri must be reported too, and the violations are: ' +
      recorded.violations.join(' | '));
    return { violations: recorded.violations };
  });

  await runCase(report, 'contract', 'an EMPTY bearer credential is refused', async function() {
    setProfile('default');
    var recorded = await expectRefusal(ENDPOINT_URLS.userinfo, {
      method  : 'GET',
      headers : { Authorization: 'Bearer ', 'accept': 'application/json' }
    }, 'EMPTY credential');
    return { violations: recorded.violations };
  });

  await runCase(report, 'contract', 'a conforming call is not refused, and leaves no violation', async function() {
    var before = state.contractViolations.length;
    var result = await underProfile('default', function() {
      return fetch(ENDPOINT_URLS.token, tokenRequestInit('parity-authorization-code'));
    });

    expectEqual(result.value.status, 200, 'a conforming token exchange must be served');
    expectEqual(state.contractViolations.length, before, 'no violation may be recorded');
    return { violations: 0 };
  });
}

// ---------------------------------------------------------------------------
// Group: the source pins.
//
// The two OAuth call shapes are replicated above because their controller
// cannot be driven from a preload. A replication is only an oracle while it
// still matches the call site, so the call sites' own source text is checked
// for the values this file pins. If one of these fails the call site changed:
// re-derive the shape from it, then re-run. That is a deliberate coupling - it
// is the whole reason the encoding is checkable at all - and it costs one
// readFileSync per case.
// ---------------------------------------------------------------------------
async function sourceCases(report, context) {
  function sourceOf(relative) {
    return fs.readFileSync(pathModule.join(context.appRoot, relative), 'utf8');
  }

  await runCase(report, 'sources', 'lib/util/recaptcha.js still sends the shape this fixture pins', async function() {
    var text = sourceOf('lib/util/recaptcha.js');
    expect(text.indexOf(ENDPOINT_URLS.recaptcha) !== -1,
      'the siteverify URL ' + ENDPOINT_URLS.recaptcha + ' must appear in the call site');
    expect(/method\s*:\s*["']POST["']/.test(text), 'the call must still be a POST');
    expect(text.indexOf('application/x-www-form-urlencoded') !== -1,
      'the form content type must still be set explicitly');
    // The body is built by the call site's own `formEncode`, NOT by a
    // search-params serializer, and that is a measured decision rather than a
    // style choice: `request`'s `form` option implied qs' RFC 3986 encoding and
    // qs' undefined/null conventions - an `undefined` value drops its field, a
    // `null` value keeps the field with an empty value - while a search-params
    // serializer sends the literal strings "undefined" and "null". Both
    // distinctions are live here, since an omitted g-recaptcha-response is
    // `undefined` and node-config reads an unset recaptcha key as `null`. So
    // this pin asserts the encoder that reproduces the baseline bytes is in use
    // AND that the serializer which does not has not come back.
    expect(/body\s*:\s*formEncode\(/.test(text),
      'the body must still be built by the call site\'s formEncode');
    expect(text.indexOf('URLSearchParams') === -1,
      'a search-params serializer must not be reintroduced: it sends "undefined" ' +
      'and "null" as literal values where qs dropped the field or emptied it');
    expect(/secret\s*:/.test(text) && /response\s*:/.test(text),
      'the body must still carry `secret` and `response`');
    return { pinned: 6 };
  });

  await runCase(report, 'sources', 'lib/controllers/auth.js still sends the shapes this fixture pins', async function() {
    var text = sourceOf('lib/controllers/auth.js');
    expect(text.indexOf(ENDPOINT_URLS.token) !== -1, 'the token endpoint must appear in the call site');
    expect(text.indexOf(ENDPOINT_URLS.userinfo) !== -1, 'the userinfo endpoint must appear in the call site');
    expect(/redirect\s*:\s*['"]manual['"]/.test(text),
      'the token exchange must still ask for redirect:\'manual\' - following it would downgrade the POST to GET');
    expect(text.indexOf('application/x-www-form-urlencoded') !== -1, 'the form content type must still be set');
    expect(text.indexOf('grant_type') !== -1, 'the grant_type field must still be sent');
    expect(text.indexOf("'Bearer '") !== -1 || text.indexOf('"Bearer "') !== -1,
      'the profile fetch must still send a Bearer authorization header');
    return { pinned: 6 };
  });

  await runCase(report, 'sources', 'lib/controllers/users.js still fetches the payload URL and reads its content type', async function() {
    var text = sourceOf('lib/controllers/users.js');
    // The call site parses the payload URL into a WHATWG `URL` and fetches
    // `target.href`, because it follows redirects itself under a hop budget
    // fetch's own follower cannot be capped at. So the pin is in two parts: the
    // target still comes from `request.payload.url`, and the request still goes
    // out through it.
    expect(/new URL\(\s*request\.payload\.url/.test(text),
      'the asset upload must still take its target from request.payload.url');
    expect(/globalThis\.fetch\(\s*target\.href/.test(text),
      'the fetch must still go to that target through globalThis.fetch, read at ' +
      'call time - a captured reference stops being interceptable and takes ' +
      'every parity scenario for this route with it');
    expect(text.indexOf("headers.get('content-type')") !== -1 ||
           text.indexOf('headers.get("content-type")') !== -1,
      'the stored content type must still come from the response headers');
    return { pinned: 3 };
  });
}

// ---------------------------------------------------------------------------
// Group: the `request` mechanism.
//
// The package is gone from the target manifest, so this mechanism is dormant
// here and live on the baseline worktree - which means it is the half of the
// fixture a target-tree run never touches, and the half a baseline capture
// depends on entirely. It is exercised against a synthetic application root
// carrying a TRIPWIRE `request` package: the fixture must replace its export
// and never call it, which is how "no path reaches the network" is proved for
// this mechanism rather than asserted.
// ---------------------------------------------------------------------------
async function requestMechanismCases(report, context) {
  var root = null;
  var patched = null;
  var previousRoot = process.env.PARITY_APP_ROOT;

  try {
    root = fs.mkdtempSync(pathModule.join(os.tmpdir(), 'parity-http-selftest-'));
    fs.mkdirSync(pathModule.join(root, 'node_modules', 'request'), { recursive: true });
    fs.writeFileSync(pathModule.join(root, 'app.js'), '// synthetic application root\n');
    fs.writeFileSync(pathModule.join(root, 'package.json'), JSON.stringify({ name: 'parity-selftest-root', version: '0.0.0' }) + '\n');
    fs.writeFileSync(pathModule.join(root, 'node_modules', 'request', 'package.json'),
      JSON.stringify({ name: 'request', version: '2.88.2', main: 'index.js' }) + '\n');

    // The tripwire. Every entry point counts an invocation into the harness's
    // own counter, so an escape is a failed case rather than a silent socket.
    fs.writeFileSync(pathModule.join(root, 'node_modules', 'request', 'index.js'), [
      '// Synthetic `request` package, written by the http fixture self-test.',
      '// Every entry point is a tripwire: the fixture must replace this export',
      '// and must never invoke it.',
      'function tripwire() {',
      '  if (globalThis.__parityHttpTripwire) { globalThis.__parityHttpTripwire.requestCalls++; }',
      '  throw new Error("the genuine request export was invoked");',
      '}',
      "['get','post','put','patch','head','del','delete','options','defaults','forever','jar','cookie','initParams'].forEach(function(name) {",
      '  tripwire[name] = tripwire;',
      '});',
      'tripwire.Request = tripwire;',
      'tripwire.debug = false;',
      'module.exports = tripwire;',
      ''
    ].join('\n'));

    restore();
    process.env.PARITY_APP_ROOT = root;
    var installed = install();
    patched = require(require.resolve('request', { paths: [root] }));

    await runCase(report, 'request-mechanism', 'the mechanism activates and is reported as required', async function() {
      expectEqual(installed.mechanisms.request, true, 'the request mechanism must be patched');
      expectEqual(installed.required.request, true,
        'a tree that provides the package makes the mechanism REQUIRED, so a failure to patch it is terminal');
      expectEqual(installed.installed, true, 'the fixture must report itself installed');
      expectEqual(installed.appRootVerified, true, 'the synthetic root must verify');
      expectEqual(patched.parityFixture, true, 'the export in the cache must be the replacement');
      return { mechanisms: installed.mechanisms };
    });

    // The callback form, bounded.
    function callbackForm(method, options) {
      return new Promise(function(resolve, reject) {
        var timer = setTimeout(function() { reject(new Error('the callback never fired within 5000ms')); }, 5000);
        patched[method](options, function(err, response, body) {
          clearTimeout(timer);
          resolve({ err: err, response: response, body: body });
        });
      });
    }

    await runCase(report, 'request-mechanism', 'reCAPTCHA without `json` delivers response.body as a STRING', async function() {
      var result = await underProfile('recaptcha:success', function() {
        return callbackForm('post', { url: ENDPOINT_URLS.recaptcha, form: { secret: 's', response: 'r' } });
      });

      expectEqual(result.value.err, null, 'no transport error');
      expectEqual(typeof result.value.response.body, 'string',
        'lib/util/recaptcha.js parses response.body itself, so a parsed object here would change the outcome');
      expectEqual(result.value.response.body, result.value.body, 'both must be the same value');
      expectEqual(JSON.parse(result.value.response.body).success, true, 'and it must parse');
      expectOneCall(result, 'recaptcha', 'recaptcha-200-success', 'request');
      return { type: typeof result.value.response.body };
    });

    await runCase(report, 'request-mechanism', 'reCAPTCHA with `json: true` is refused as a contract breach', async function() {
      var before = state.contractViolations.length;
      var result = await underProfile('recaptcha:success', function() {
        return callbackForm('post', { url: ENDPOINT_URLS.recaptcha, form: { secret: 's', response: 'r' }, json: true });
      });

      expect(result.value.err, 'the call must fail');
      expectEqual(result.value.err.code, 'PARITY_CONTRACT', 'the refusal code');
      expectEqual(state.contractViolations.length, before + 1, 'one violation recorded');
      context.deliberateBreaches++;
      return { code: result.value.err.code };
    });

    await runCase(report, 'request-mechanism', 'reCAPTCHA transport failure delivers (err, undefined, undefined)', async function() {
      var result = await underProfile('recaptcha:transport-failure', function() {
        return callbackForm('post', { url: ENDPOINT_URLS.recaptcha, form: { secret: 's', response: 'r' } });
      });

      expectEqual(result.value.response, undefined,
        'response must be undefined - that is what makes reading response.statusCode throw');
      expectEqual(result.value.body, undefined, 'body must be undefined');
      expectEqual(result.value.err.code, 'ECONNREFUSED', 'the error code');
      expectOneCall(result, 'recaptcha', 'recaptcha-transport-failure', 'request');
      return { code: result.value.err.code };
    });

    await runCase(report, 'request-mechanism', 'the token exchange with `json: true` delivers the PARSED body', async function() {
      var result = await underProfile('oauth:success-existing-user', function() {
        return callbackForm('post', {
          url  : ENDPOINT_URLS.token,
          form : { code: 'c', client_id: 'id', client_secret: 's', redirect_uri: 'u', grant_type: 'authorization_code' },
          json : true
        });
      });

      expectEqual(result.value.err, null, 'no transport error');
      expectEqual(typeof result.value.body, 'object', 'the body must be parsed under json:true');
      expectEqual(result.value.body.access_token, ACCESS_TOKEN, 'the frozen access token');
      expectEqual(result.value.response.body, result.value.body,
        'response.body and the body argument are the same value under json:true (measured)');
      var call = expectOneCall(result, 'token', 'token-200-success', 'request');
      expectEqual(call.request.bodyEncoding, 'form', 'the recorded encoding');
      expectEqual(call.request.bodyValues.client_secret, REDACTED, 'the client secret must be redacted');
      return { fields: call.request.bodyFields };
    });

    await runCase(report, 'request-mechanism', 'the profile fetch with `json: true` and a Bearer header', async function() {
      var result = await underProfile('oauth:success-existing-user', function() {
        return callbackForm('get', {
          url     : ENDPOINT_URLS.userinfo,
          headers : { Authorization: 'Bearer ' + ACCESS_TOKEN, 'accept': 'application/json' },
          json    : true
        });
      });

      expectEqual(result.value.body.email, identities.existing, 'the seeded identity');
      expectOneCall(result, 'userinfo', 'userinfo-200-existing-user', 'request');
      return { email: result.value.body.email };
    });

    // The stream form, bounded, recording the event sequence - which is the
    // observable the asset call site branches on.
    function streamForm(url, waitMs) {
      return new Promise(function(resolve) {
        var events = [];
        var chunks = [];
        var stream = patched.get(url);

        stream.on('error', function(err) { events.push('error:' + (err.code || err.message)); });
        stream.on('response', function(response) { events.push('response:' + response.statusCode); });
        stream.on('redirect', function() { events.push('redirect:' + (stream.response && stream.response.statusCode)); });
        stream.on('data', function(chunk) { chunks.push(chunk); events.push('data'); });
        stream.on('end', function() { events.push('end'); });

        setTimeout(function() {
          resolve({ events: events, bytes: Buffer.concat(chunks), stream: stream });
        }, waitMs === undefined ? 200 : waitMs);
      });
    }

    await runCase(report, 'request-mechanism', 'the asset stream: response, data, end', async function() {
      var result = await underProfile('asset:success', function() { return streamForm(ASSET_URLS.plain); });
      expectEqual(result.value.events.join(','), 'response:200,data,end', 'the event sequence');
      expectEqual(sha1(result.value.bytes), module.exports.assetDigests.complete, 'the delivered digest');
      expectOneCall(result, 'asset', 'asset-200-complete', 'request');
      return { events: result.value.events };
    });

    await runCase(report, 'request-mechanism', 'a 404 still reaches end, so the error page is uploaded', async function() {
      var result = await underProfile('asset:non-2xx', function() { return streamForm(ASSET_URLS.missing); });
      expectEqual(result.value.events.join(','), 'response:404,data,end', 'the event sequence');
      expectEqual(sha1(result.value.bytes), module.exports.assetDigests.errorPage, 'the delivered digest');
      return { events: result.value.events };
    });

    await runCase(report, 'request-mechanism', 'a 500 behaves as the 404 does, with its own bytes', async function() {
      var result = await underProfile('asset:server-error', function() { return streamForm(ASSET_URLS.serverError); });
      expectEqual(result.value.events.join(','), 'response:500,data,end', 'the event sequence');
      expectEqual(sha1(result.value.bytes), module.exports.assetDigests.serverError, 'the delivered digest');
      return { events: result.value.events };
    });

    await runCase(report, 'request-mechanism', 'a refused connection emits error and NEVER end', async function() {
      var result = await underProfile('asset:transport-refused', function() { return streamForm(ASSET_URLS.plain, 300); });
      expectEqual(result.value.events.join(','), 'error:ECONNREFUSED', 'the event sequence');
      expectEqual(result.value.events.indexOf('end'), -1,
        'no `end` may be synthesized: the upload never starts and the route is left unsettled (R-d)');
      expectEqual(result.value.bytes.length, 0, 'no bytes may be delivered');
      return { events: result.value.events };
    });

    await runCase(report, 'request-mechanism', 'a mid-stream failure delivers partial bytes, then error, THEN end', async function() {
      var result = await underProfile('asset:midstream-failure', function() { return streamForm(ASSET_URLS.plain, 300); });
      expectEqual(result.value.events.join(','), 'response:200,data,error:ECONNRESET,end', 'the event sequence');
      expectEqual(sha1(result.value.bytes), module.exports.assetDigests.partial, 'the partial digest');
      return { events: result.value.events };
    });

    await runCase(report, 'request-mechanism', 'a followed redirect announces each hop and delivers the final response', async function() {
      var result = await underProfile('asset:redirect', function() { return streamForm(ASSET_URLS.plain, 300); });
      expectEqual(result.value.events.join(','), 'redirect:302,response:200,data,end', 'the event sequence');
      expectEqual(sha1(result.value.bytes), module.exports.assetDigests.redirected, 'the final digest');
      return { events: result.value.events };
    });

    await runCase(report, 'request-mechanism', 'a chain at the legacy limit still arrives', async function() {
      var result = await underProfile('asset:redirect-within-limit', function() { return streamForm(ASSET_URLS.plain, 300); });
      var redirects = result.value.events.filter(function(name) { return name.indexOf('redirect:') === 0; });
      expectEqual(redirects.length, LEGACY_MAX_REDIRECTS, 'one redirect event per hop');
      expect(result.value.events.indexOf('end') !== -1, 'the chain must complete');
      expectEqual(sha1(result.value.bytes), module.exports.assetDigests.redirected, 'the final digest');
      return { hops: redirects.length };
    });

    await runCase(report, 'request-mechanism', 'a chain beyond the legacy limit fails instead of arriving', async function() {
      var result = await underProfile('asset:redirect-beyond-limit', function() { return streamForm(ASSET_URLS.plain, 300); });
      expectEqual(result.value.events.join(','), 'error:PARITY_REDIRECT_LIMIT', 'the event sequence');
      expectEqual(result.value.events.indexOf('end'), -1, 'no completion');
      expectEqual(result.value.bytes.length, 0, 'no bytes');

      // The other side of the boundary: through native fetch the same chain is
      // followed, because 11 is inside the runtime's limit of 20. The two
      // mechanisms disagree here, deliberately, and both are served.
      return { hops: ASSET_HOPS_BEYOND_LEGACY_LIMIT, legacyLimit: LEGACY_MAX_REDIRECTS };
    });

    await runCase(report, 'request-mechanism', 'an unrecorded URL fails on both call forms', async function() {
      var stream = await underProfile('default', function() { return streamForm(UNRECORDED_URL, 200); });
      expectEqual(stream.value.events.join(','), 'error:PARITY_UNRECORDED', 'the stream form');

      var callback = await underProfile('default', function() {
        return callbackForm('post', { url: UNREGISTERED_ORIGIN_URL, form: { secret: 's', response: 'r' } });
      });
      expectEqual(callback.value.err.code, 'PARITY_UNRECORDED', 'the callback form');
      expectEqual(callback.value.response, undefined, 'no response');
      return { forms: 2 };
    });

    await runCase(report, 'request-mechanism', 'restore() puts the genuine export back', async function() {
      var before = require(require.resolve('request', { paths: [root] }));
      expectEqual(before.parityFixture, true, 'the replacement must be in force before restore');
      restore();
      var after = require(require.resolve('request', { paths: [root] }));
      expectEqual(after.parityFixture, undefined, 'the genuine export must be back');
      expectEqual(after.name, 'tripwire', 'and it must be the genuine export this tree provides');
      return { restored: true };
    });

    await runCase(report, 'request-mechanism', 'the tripwire never fired', async function() {
      expectEqual(context.tripwire.requestCalls, 0,
        'the genuine request export must never be invoked, and was invoked ' +
        context.tripwire.requestCalls + ' time(s)');
      return { requestCalls: 0 };
    });
  }
  finally {
    // Put this process back the way the harness found it, whatever happened:
    // the fixture reinstalled against the real app root, the synthetic tree
    // gone, and the environment variable restored.
    try { restore(); } catch (ignored) { /* reported by the cases above */ }

    if (previousRoot === undefined) {
      delete process.env.PARITY_APP_ROOT;
    }
    else {
      process.env.PARITY_APP_ROOT = previousRoot;
    }

    install();

    if (root) {
      try { fs.rmSync(root, { recursive: true, force: true }); }
      catch (ignored) { note('selftest-cleanup-failed', { root: root }); }
    }
  }
}

// ---------------------------------------------------------------------------
// Group: the cases that can only be asserted from outside the process.
//
// Four of them, and each is a process-level signature rather than a value: two
// reCAPTCHA short-circuits that need mutually exclusive configuration states,
// two reCAPTCHA faults that KILL the process without ever calling back, and an
// unprotected install that must terminate rather than serve.
// ---------------------------------------------------------------------------

// Spawns this file with one case selected, bounded, and never inheriting the
// parent's configuration: NODE_ENV and NODE_CONFIG are set explicitly, so a
// child's outcome is decided by its case and not by the shell that started the
// harness. NODE_CONFIG_PERSIST_ON_CHANGE stops node-config writing
// config/runtime.json into the worktree.
function spawnChild(context, caseName, overrides) {
  // Each child writes its own evidence log, and the parent folds it in. That
  // is what makes a child's intercepted call countable: two of these children
  // die from an uncaught throw, and the per-call append - rather than a flush
  // at exit - is why their evidence survives it.
  var logPath = pathModule.join(context.scratch,
    'child-' + caseName.replace(/[^a-z0-9]+/gi, '-') + '-' + (context.childIndex = (context.childIndex || 0) + 1) + '.log');

  var env = {
    PATH     : process.env.PATH,
    HOME     : process.env.HOME,
    NODE_ENV : 'development',
    NODE_CONFIG_PERSIST_ON_CHANGE : 'N',
    PARITY_HTTP_LOG : logPath,
    PARITY_APP_ROOT : (overrides && overrides.appRoot) || process.env.PARITY_APP_ROOT || process.cwd()
  };

  env[SELFTEST_CHILD_VAR] = caseName;

  Object.keys(overrides || {}).forEach(function(name) {
    if (name !== 'appRoot') {
      env[name] = overrides[name];
    }
  });

  var result = childProcess.spawnSync(process.execPath, [__filename], {
    cwd      : env.PARITY_APP_ROOT,
    env      : env,
    encoding : 'utf8',
    timeout  : 30000
  });

  var stdout = result.stdout || '';
  var parsed = null;

  stdout.split('\n').forEach(function(line) {
    if (line.indexOf(CHILD_RESULT_MARKER) === 0) {
      try { parsed = JSON.parse(line.slice(CHILD_RESULT_MARKER.length)); }
      catch (e) { parsed = null; }
    }
  });

  var records = [];
  try {
    fs.readFileSync(logPath, 'utf8').split('\n').forEach(function(line) {
      if (!line) {
        return;
      }
      try { records.push(JSON.parse(line)); }
      catch (e) { /* a truncated final line is not evidence of anything */ }
    });
  }
  catch (e) {
    // A child that intercepted nothing writes no file, which several of these
    // cases assert on rather than treat as a fault.
  }

  context.childRecords = (context.childRecords || []).concat(records);

  return {
    status     : result.status,
    signal     : result.signal,
    stdout     : stdout,
    stderr     : result.stderr || '',
    calledBack : stdout.indexOf(CHILD_CALLBACK_MARKER) !== -1,
    result     : parsed,
    records    : records,
    calls      : records.filter(function(entry) { return entry.event === undefined; }),
    spawnError : result.error ? (result.error.message || String(result.error)) : null
  };
}

async function childCases(report, context) {
  await runCase(report, 'recaptcha', 'outcome 1: the isTest short-circuit answers with NO HTTP at all', async function() {
    var child = spawnChild(context, 'recaptcha:short-circuit-istest', {
      NODE_CONFIG         : SELFTEST_SECRET_OVERLAY,
      PARITY_HTTP_PROFILE : 'recaptcha:non-200'
    });

    expect(!child.spawnError, 'the child must start: ' + child.spawnError);
    expectEqual(child.status, EXIT_OK, 'the child exit code (stderr: ' + child.stderr.trim() + ')');
    expect(child.result, 'the child must report a result, and printed: ' + child.stdout.trim());
    expectEqual(child.result.isTest, true,
      'config.isTest must have been set, or this case proves nothing');
    expectEqual(child.result.value.success, true, 'the short-circuit value');
    expectEqual(child.result.interceptedCalls, 0,
      'the short-circuit happens BEFORE any HTTP - and a secret WAS configured, so the ' +
      'unconfigured branch cannot be the cause');

    // The selected profile would have produced {status:false} had the call
    // reached the fixture, so the value proves which branch ran.
    expectEqual(child.result.value.status, undefined, 'the value must be the short-circuit shape');
    return { calls: 0, value: child.result.value };
  });

  await runCase(report, 'recaptcha', 'outcome 2: the unconfigured short-circuit shares that branch', async function() {
    var child = spawnChild(context, 'recaptcha:short-circuit-unconfigured', {
      PARITY_HTTP_PROFILE : 'recaptcha:non-200'
    });

    expect(!child.spawnError, 'the child must start: ' + child.spawnError);
    expectEqual(child.status, EXIT_OK, 'the child exit code (stderr: ' + child.stderr.trim() + ')');
    expect(child.result, 'the child must report a result, and printed: ' + child.stdout.trim());
    expect(!child.result.isTest, 'config.isTest must be falsy, or this is outcome 1 again');
    expectEqual(child.result.secretkey, '',
      'the secret must be unset, which is what selects this branch');
    expectEqual(child.result.value.success, true, 'the same value outcome 1 produces');
    expectEqual(child.result.interceptedCalls, 0, 'no HTTP may happen');
    return { calls: 0, value: child.result.value };
  });

  await runCase(report, 'recaptcha', 'outcome 5: a transport failure throws a TypeError and NEVER calls back', async function() {
    var child = spawnChild(context, 'recaptcha:verify', {
      NODE_CONFIG         : SELFTEST_SECRET_OVERLAY,
      PARITY_HTTP_PROFILE : 'recaptcha:transport-failure'
    });

    expect(!child.spawnError, 'the child must start: ' + child.spawnError);
    expectEqual(child.status, 1, 'an uncaught exception exits 1');
    expect(!child.calledBack,
      'the callback must NEVER be invoked - that is the whole contract of this outcome (R-d)');
    expect(child.stderr.indexOf('TypeError') !== -1,
      'the fault must be a TypeError, and stderr says: ' + child.stderr.trim());
    expect(child.stderr.indexOf('statusCode') !== -1,
      'it must be the read of response.statusCode on an undefined response, and stderr says: ' +
      child.stderr.trim());
    return { exit: child.status, fault: 'TypeError' };
  });

  await runCase(report, 'recaptcha', 'outcome 6: a malformed body throws a SyntaxError and NEVER calls back', async function() {
    var child = spawnChild(context, 'recaptcha:verify', {
      NODE_CONFIG         : SELFTEST_SECRET_OVERLAY,
      PARITY_HTTP_PROFILE : 'recaptcha:malformed-json'
    });

    expect(!child.spawnError, 'the child must start: ' + child.spawnError);
    expectEqual(child.status, 1, 'an uncaught exception exits 1');
    expect(!child.calledBack, 'the callback must NEVER be invoked (R-d)');
    expect(child.stderr.indexOf('SyntaxError') !== -1,
      'the fault must be a SyntaxError out of JSON.parse, and stderr says: ' + child.stderr.trim());
    return { exit: child.status, fault: 'SyntaxError' };
  });

  await runCase(report, 'install', 'a mechanism that cannot be intercepted terminates the process', async function() {
    // The escape this guards: the package resolves, so the application can
    // require it and reach a socket, but patching it failed. That used to be a
    // diagnostic in a log while the child went on serving traffic.
    var root = fs.mkdtempSync(pathModule.join(os.tmpdir(), 'parity-http-unprotected-'));

    try {
      fs.mkdirSync(pathModule.join(root, 'node_modules', 'request'), { recursive: true });
      fs.writeFileSync(pathModule.join(root, 'app.js'), '// synthetic application root\n');
      fs.writeFileSync(pathModule.join(root, 'package.json'),
        JSON.stringify({ name: 'parity-selftest-unprotected', version: '0.0.0' }) + '\n');
      fs.writeFileSync(pathModule.join(root, 'node_modules', 'request', 'package.json'),
        JSON.stringify({ name: 'request', version: '2.88.2', main: 'index.js' }) + '\n');
      // Resolvable and un-patchable: loading it throws, so the fixture cannot
      // reach its exports to replace them.
      fs.writeFileSync(pathModule.join(root, 'node_modules', 'request', 'index.js'),
        'throw new Error("this request package cannot be loaded");\n');

      var statusFile = pathModule.join(root, 'handshake.json');
      var child = spawnChild(context, 'status', {
        appRoot            : root,
        PARITY_HTTP_STATUS : statusFile
      });

      expectEqual(child.status, EXIT_UNPROTECTED,
        'an unprotected install must exit ' + EXIT_UNPROTECTED + ' rather than serve (stdout: ' +
        child.stdout.trim() + ', stderr: ' + child.stderr.trim() + ')');
      expectEqual(child.stdout, '', 'nothing may be printed: stdout belongs to the zero-warning gate');
      expectEqual(child.stderr, '', 'and nothing may reach stderr either');

      var handshake = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
      expectEqual(handshake.installed, false, 'the handshake must say the fixture is NOT installed');
      expectEqual(handshake.required.request, true, 'and that the request mechanism was required');
      expectEqual(handshake.mechanisms.request, false, 'and that it is inactive');
      expect(handshake.diagnostic && handshake.diagnostic.indexOf('could not be patched') !== -1,
        'the handshake must carry the reason, and carries: ' + handshake.diagnostic);
      return { exit: child.status, handshake: 'published' };
    }
    finally {
      try { fs.rmSync(root, { recursive: true, force: true }); }
      catch (ignored) { note('selftest-cleanup-failed', { root: root }); }
    }
  });

  await runCase(report, 'install', 'a declared app root that does not hold the application terminates the process', async function() {
    // `request` is resolved against PARITY_APP_ROOT, so a wrong root silently
    // decides which mechanisms exist: a baseline capture could run with the
    // legacy mechanism absent and report a parity it never exercised. An
    // explicit wrong claim is therefore terminal, exactly as an
    // un-interceptable mechanism is.
    var root = fs.mkdtempSync(pathModule.join(os.tmpdir(), 'parity-http-badroot-'));

    try {
      var statusFile = pathModule.join(root, 'handshake.json');
      var child = spawnChild(context, 'status', {
        appRoot            : root,          // empty: no app.js, no package.json
        PARITY_HTTP_STATUS : statusFile
      });

      expectEqual(child.status, EXIT_UNPROTECTED,
        'a declared app root that does not verify must exit ' + EXIT_UNPROTECTED +
        ' (stdout: ' + child.stdout.trim() + ', stderr: ' + child.stderr.trim() + ')');
      expectEqual(child.stdout, '', 'nothing may be printed');

      var handshake = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
      expectEqual(handshake.appRootVerified, false, 'the handshake must say the root did not verify');
      expectEqual(handshake.installed, false, 'and that the fixture is not installed');
      expect(handshake.appRootMissing.indexOf('app.js') !== -1,
        'and name what was missing, and names: ' + JSON.stringify(handshake.appRootMissing));
      return { exit: child.status };
    }
    finally {
      try { fs.rmSync(root, { recursive: true, force: true }); }
      catch (ignored) { note('selftest-cleanup-failed', { root: root }); }
    }
  });

  await runCase(report, 'install', 'the handshake identifies the implementation and the tree', async function() {
    var statusFile = pathModule.join(context.scratch, 'handshake.json');
    var child = spawnChild(context, 'status', { PARITY_HTTP_STATUS: statusFile });

    expectEqual(child.status, EXIT_OK, 'the child exit code (stderr: ' + child.stderr.trim() + ')');
    var handshake = JSON.parse(fs.readFileSync(statusFile, 'utf8'));

    expectEqual(handshake.schema, 'parity-http-fixture-status/1', 'the handshake schema');
    expectEqual(handshake.installed, true, 'the fixture must report itself installed');
    expectEqual(handshake.mechanisms.fetch, true, 'fetch must be active');
    expectEqual(handshake.appRootVerified, true, 'the app root must verify');
    expectEqual(handshake.identity.module, __filename, 'the handshake must name this implementation');
    expectEqual(handshake.identity.digest, fixtureDigest,
      'and carry its digest, so a run can prove ONE implementation was loaded in both worktrees');
    expectEqual(handshake.identity.identityOk, true,
      'the identity contract must hold in a process that loaded this file fresh');
    return { digest: handshake.identity.digest };
  });
}

// ---------------------------------------------------------------------------
// The child entry point. Runs exactly one case and reports through markers on
// stdout, because two of the cases end in a fatal throw and a return value
// would never arrive.
// ---------------------------------------------------------------------------
function runChildCase(name) {
  var appRoot = process.env.PARITY_APP_ROOT || process.cwd();

  // The handshake case. The module auto-installed before this ran, so there is
  // nothing to do but report - and an unprotected install has already exited.
  if (name === 'status') {
    process.stdout.write(CHILD_RESULT_MARKER + JSON.stringify(status()) + '\n');
    return;
  }

  var config = require(require.resolve('config', { paths: [appRoot] }));

  if (name === 'recaptcha:short-circuit-istest') {
    // The assignment config/app.config.js itself makes, reproduced without
    // requiring app.config - which would load config/db and mongoose, and with
    // it the prototype patch that makes @hapi/hapi unloadable (AAP 0.6.5).
    config.isTest = true;
  }

  var verify = require(pathModule.join(appRoot, 'lib', 'util', 'recaptcha.js')).verify;
  var settled = false;

  function interceptedCalls() {
    return state.calls.filter(function(entry) { return entry.event === undefined; }).length;
  }

  verify('parity-selftest-token', function(result) {
    settled = true;
    process.stdout.write(CHILD_CALLBACK_MARKER + JSON.stringify(result) + '\n');
    process.stdout.write(CHILD_RESULT_MARKER + JSON.stringify({
      value            : result,
      isTest           : !!config.isTest,
      secretkey        : (config.app.recaptcha && config.app.recaptcha.secretkey) || '',
      interceptedCalls : interceptedCalls()
    }) + '\n');
  });

  // A bounded wait, so a child that is never called back exits rather than
  // hanging the harness. Outcomes 5 and 6 never reach it: their uncaught throw
  // ends the process first, which is exactly what they assert.
  setTimeout(function() {
    if (!settled) {
      process.stdout.write(CHILD_RESULT_MARKER + JSON.stringify({
        value            : null,
        noCallback       : true,
        isTest           : !!config.isTest,
        interceptedCalls : interceptedCalls()
      }) + '\n');
    }
  }, 3000);
}

// ---------------------------------------------------------------------------
// The run.
// ---------------------------------------------------------------------------

// Drives every group and reports. Returns the report rather than exiting, so a
// sibling tool can call it and fold the result into its own gate.
async function selfTest(options) {
  var opts = options || {};
  var report = {
    schema  : 'parity-http-fixture-selftest/1',
    module  : __filename,
    digest  : fixtureDigest,
    node    : process.version,
    appRoot : process.env.PARITY_APP_ROOT || process.cwd(),
    passed  : 0,
    failed  : 0,
    cases   : [],
    profilesDeclared   : Object.keys(PROFILES).length,
    profilesConsumed   : [],
    profilesUnconsumed : [],
    contract  : null,
    // Every violation a self-test run records is a breach the contract group
    // drove deliberately, one per case, and the count is asserted.
    contractViolationsDeliberate : 0,
    handshake : null,
    ok        : false
  };

  // ------------------------------------------------------------------------
  // The caller's state, snapshotted so it can be put back byte for byte.
  //
  // selfTest() is exported for a sibling tool to call in its own process, so
  // it may not leave that process altered. An earlier version snapshotted
  // `globalThis.fetch` AFTER the load-time auto-install - capturing the
  // fixture's own replacement as though it were the genuine function - and
  // restored only some of what it changed, so a caller was left with the
  // patch installed, `installed` false, the deliberate contract violations
  // retained and a fabricated NODE_CONFIG still in the environment. Ownership
  // of the genuine fetch is therefore reclaimed FIRST, through restore(), and
  // every mutated key is recorded with its presence as well as its value.
  // ------------------------------------------------------------------------
  var callerState = {
    installed : state.installed,
    profile   : state.activeProfile,
    calls     : state.calls.slice(),
    violations: state.contractViolations.slice(),
    served    : Object.assign({}, state.served),
    fileState : state.profileFileState,
    handshake : state.handshake,
    diagnostic: state.resolveDiagnostic,
    env       : {}
  };

  ['NODE_CONFIG', 'NODE_CONFIG_PERSIST_ON_CHANGE'].forEach(function(name) {
    callerState.env[name] = Object.prototype.hasOwnProperty.call(process.env, name)
      ? { present: true, value: process.env[name] }
      : { present: false, value: null };
  });

  // restore() first, so the value captured next is the GENUINE fetch and not
  // this fixture's replacement.
  restore();
  var genuineFetch = globalThis.fetch;

  var startProfile = callerState.profile;
  var context = {
    appRoot        : report.appRoot,
    scratch        : fs.mkdtempSync(pathModule.join(os.tmpdir(), 'parity-http-report-')),
    tripwire       : { fetchCalls: 0, requestCalls: 0 },
    recaptcha      : null,
    recaptchaError : null,
    // Every refusal the contract group drives ON PURPOSE. The count is what
    // lets the run assert that no driver which was supposed to CONFORM
    // produced a violation - the difference between an oracle that works and
    // one that fires at random.
    deliberateBreaches : 0
  };

  // The tripwire becomes the "original" the fixture retains, so an escape to
  // the real network is a counted, failing case rather than a socket.
  globalThis.__parityHttpTripwire = context.tripwire;
  globalThis.fetch = function tripwireFetch() {
    context.tripwire.fetchCalls++;
    return Promise.reject(new Error('the genuine fetch was invoked'));
  };
  install();

  // reCAPTCHA outcomes 3-6 are only reachable with a secret configured and
  // `config.isTest` falsy: without both, verify() short-circuits at its first
  // line and the four recorded responses are unreachable. Both are arranged
  // here, before the module is required, and both are put back afterwards.
  //
  // NODE_CONFIG_PERSIST_ON_CHANGE is set for a second reason: node-config
  // writes config/runtime.json into the worktree on change, and a verification
  // run must not touch the tree it is verifying.
  if (!process.env.NODE_CONFIG_PERSIST_ON_CHANGE) {
    process.env.NODE_CONFIG_PERSIST_ON_CHANGE = 'N';
  }
  if (!process.env.NODE_CONFIG) {
    process.env.NODE_CONFIG = SELFTEST_SECRET_OVERLAY;
  }

  try {
    context.config = require(require.resolve('config', { paths: [context.appRoot] }));

    if (!context.config.app.recaptcha) {
      context.config.app.recaptcha = {};
    }

    context.secretkeyAtStart = context.config.app.recaptcha.secretkey;
    if (!context.config.app.recaptcha.secretkey) {
      context.config.app.recaptcha.secretkey = 'parity-fixture-secret';
    }

    context.isTestAtStart = context.config.isTest;
    context.config.isTest = false;

    context.recaptcha = require(pathModule.join(context.appRoot, 'lib', 'util', 'recaptcha.js'));
  }
  catch (error) {
    context.recaptchaError = error && error.message ? error.message : String(error);
  }

  try {
    await identityCases(report);
    await sourceCases(report, context);
    await readinessCases(report);
    await registryCases(report, context);
    await recaptchaCases(report, context);
    await oauthCases(report);
    await assetCases(report);
    await contractCases(report, context);
    await requestMechanismCases(report, context);
    await childCases(report, context);

    // The coverage assertion. Declaring a profile and never selecting it is the
    // failure this harness exists to make impossible, so it is a case in its
    // own right rather than a statistic at the foot of a report.
    var consumed = {};

    // Counted ONLY from records the fixture wrote for a call it actually served
    // or refused - the `event`-free ones. Selecting a profile is not driving
    // it: an earlier version of this count also credited the
    // `profile-changed` and `install` notes, so a probe that selected a
    // profile and issued no request was reported as having exercised it, which
    // is the same vacuous pass this harness exists to prevent.
    //
    // This process's evidence plus every child's: four outcomes can only be
    // driven in a child, and two of those children die from the throw that IS
    // their contract, so their evidence is read from the log they appended to
    // per call rather than from a value they never got to return.
    state.calls.concat(context.childRecords || []).forEach(function(entry) {
      if (entry.event === undefined && entry.profile) {
        consumed[entry.profile] = true;
      }
    });

    report.profilesConsumed = Object.keys(consumed).sort();
    report.profilesUnconsumed = Object.keys(PROFILES).filter(function(name) {
      return !consumed[name];
    }).sort();

    await runCase(report, 'coverage', 'every declared profile was driven by this run', async function() {
      expectEqual(report.profilesUnconsumed.length, 0,
        'these profiles are declared and were never selected: ' + report.profilesUnconsumed.join(', ') +
        '. A recorded response nothing requests is not evidence.');
      return { declared: report.profilesDeclared, consumed: report.profilesConsumed.length };
    });

    await runCase(report, 'coverage', 'a profile counts as driven only from a call the fixture served', async function() {
      // The property, checked against the evidence rather than trusted: for
      // every profile the run reports as consumed there is at least one
      // `event`-free record - a call served or refused - carrying that profile.
      // Selecting a profile writes a `profile-changed` note and nothing else,
      // so a probe that switched profiles and issued no request used to be
      // credited with driving it.
      var records = state.calls.concat(context.childRecords || []);

      report.profilesConsumed.forEach(function(profile) {
        var served = records.filter(function(entry) {
          return entry.event === undefined && entry.profile === profile;
        });

        expect(served.length >= 1, 'the profile ' + JSON.stringify(profile) +
          ' is reported as driven with no intercepted call to show for it');
      });

      var notesOnly = records.filter(function(entry) {
        return entry.event === 'profile-changed' || entry.event === 'install';
      });
      expect(notesOnly.length > 0,
        'the run must have produced selection notes, or this case is not testing anything');

      return { consumed: report.profilesConsumed.length, notesIgnored: notesOnly.length };
    });

    await runCase(report, 'coverage', 'every recorded contract violation was a deliberate breach', async function() {
      expectEqual(state.contractViolations.length, context.deliberateBreaches,
        'the only violations may be the ones the contract cases drove on purpose (' +
        context.deliberateBreaches + '); anything else is a driver that was supposed to ' +
        'conform and did not: ' + JSON.stringify(requestContractReport().violations));
      return { deliberate: context.deliberateBreaches };
    });

    await runCase(report, 'coverage', 'all six reCAPTCHA outcomes were exercised', async function() {
      var cases = report.cases.filter(function(entry) { return entry.group === 'recaptcha'; });

      // Six documented outcomes, each named in the case that drives it. The
      // count of CASES is larger, because outcome 3 has a second, rejected
      // variant - the only way to reach the request.fail edges that branch on
      // `success` - so the six are checked by name rather than by tally.
      [1, 2, 3, 4, 5, 6].forEach(function(outcome) {
        var driver = cases.filter(function(entry) {
          return entry.name.indexOf('outcome ' + outcome + ':') === 0;
        });

        expect(driver.length >= 1, 'reCAPTCHA outcome ' + outcome +
          ' has no case driving it, and the cases present are: ' +
          cases.map(function(entry) { return entry.name; }).join(' | '));
      });

      cases.forEach(function(entry) {
        expect(entry.ok, 'the reCAPTCHA case ' + JSON.stringify(entry.name) + ' failed: ' + entry.error);
      });
      return { outcomes: 6, cases: cases.length };
    });
  }
  finally {
    report.contract = requestContractReport();
    report.contractViolationsDeliberate = context.deliberateBreaches;
    report.handshake = state.handshake;

    restoreCallerState(callerState, genuineFetch, context);
  }

  // Proved after the restore rather than asserted before it, because the claim
  // is about the state a CALLER is left in.
  await runCase(report, 'lifecycle', 'the run leaves the caller\'s process as it found it', async function() {
    expectEqual(state.activeProfile, callerState.profile, 'the active profile');
    expectEqual(state.contractViolations.length, callerState.violations.length,
      'the caller\'s violation list must not carry this run\'s deliberate breaches');
    expectEqual(state.calls.length, callerState.calls.length, 'the caller\'s evidence list');
    expectEqual(state.installed, callerState.installed, 'the caller\'s installed state');
    expectEqual(globalThis.__parityHttpTripwire, undefined, 'the tripwire must be gone');

    Object.keys(callerState.env).forEach(function(name) {
      var before = callerState.env[name];
      expectEqual(Object.prototype.hasOwnProperty.call(process.env, name), before.present,
        'the presence of ' + name);
      if (before.present) {
        expectEqual(process.env[name], before.value, 'the value of ' + name);
      }
    });

    if (callerState.installed) {
      // The invariant a caller depends on: the fixture patched, holding the
      // GENUINE fetch as the value restore() would put back - not its own
      // replacement, which is what an earlier version left behind.
      expect(globalThis.fetch !== genuineFetch, 'the fixture must be installed again');
      expectEqual(state.originalFetch, genuineFetch,
        'and it must own the genuine fetch, or a later restore() would install the wrong value');
      assertReady();
    }

    return { restored: true };
  });

  report.ok = report.failed === 0;

  if (opts.out) {
    fs.writeFileSync(opts.out, JSON.stringify(report, null, 2) + '\n');
  }

  return report;
}

// Puts the caller's process back exactly as selfTest() found it. Idempotent,
// so the finally block and an early return cannot double-apply it, and it never
// throws: a restore fault must not replace the report with a stack trace.
function restoreCallerState(callerState, genuineFetch, context) {
  if (callerState.restored) {
    return;
  }
  callerState.restored = true;

  // Ownership first: unpatch, put the genuine fetch back, then re-install so
  // the fixture holds the genuine function as its retained original.
  try { restore(); } catch (ignored) { /* there is nothing left to report to */ }
  globalThis.fetch = genuineFetch;
  delete globalThis.__parityHttpTripwire;

  // The configuration this run had to move, including whether the variable was
  // set at all - an added key is as much a mutation as a changed one.
  if (context && context.config) {
    context.config.isTest = context.isTestAtStart;

    if (context.secretkeyAtStart !== undefined && context.config.app.recaptcha) {
      context.config.app.recaptcha.secretkey = context.secretkeyAtStart;
    }
  }

  Object.keys(callerState.env).forEach(function(name) {
    if (callerState.env[name].present) {
      process.env[name] = callerState.env[name].value;
    }
    else {
      delete process.env[name];
    }
  });

  // Re-installed BEFORE the collections are put back, because install() records
  // its own handshake and diagnostic notes: restoring the evidence first would
  // leave the caller's list two records longer than it started, which is the
  // mutation this function exists to prevent.
  if (callerState.installed) {
    install();
  }

  // The fixture's own collections, so a caller's evidence does not acquire this
  // run's calls or its deliberate contract breaches. COPIES, not the captured
  // arrays: assigning the snapshot itself would alias it, and a later push
  // would silently grow the very record this restore is measured against.
  state.calls = callerState.calls.slice();
  state.contractViolations = callerState.violations.slice();
  state.served = Object.assign({}, callerState.served);
  state.profileFileState = callerState.fileState;
  state.activeProfile = callerState.profile;
  state.resolveDiagnostic = callerState.diagnostic;
  state.handshake = callerState.handshake;

  if (context && context.scratch) {
    try { fs.rmSync(context.scratch, { recursive: true, force: true }); }
    catch (ignored) { /* a leftover temporary directory is not worth a failure */ }
  }
}

var USAGE = [
  'test/parity/fixtures/http.js - recorded OAuth, reCAPTCHA and asset responses.',
  '',
  'As a PRELOAD it takes no arguments and reads only PARITY_* variables:',
  '  node --require <abs path>/test/parity/fixtures/http.js app.js',
  '',
  'Executed DIRECTLY it verifies every recorded outcome against the call sites:',
  '  node test/parity/fixtures/http.js [--out <file>] [--quiet]',
  '',
  '  --out <file>   write the JSON report to <file>. No file is written by',
  '                 default and no path inside the worktree is implied.',
  '  --quiet        report the summary and any failures only.',
  '  --help         this text.',
  '',
  'Exit codes: ' + EXIT_OK + ' every case passed, ' + EXIT_ERROR + ' a case failed, ' +
    EXIT_USAGE + ' bad usage, ' + EXIT_UNPROTECTED,
  'the fixture could not intercept a mechanism this tree provides.'
].join('\n');

// The gate. Reads argv, which the preload path never does.
async function main(argv) {
  var args = (argv || []).slice(2);
  var options = { out: null, quiet: false };
  var i;

  for (i = 0; i < args.length; i++) {
    if (args[i] === '--help' || args[i] === '-h') {
      process.stdout.write(USAGE + '\n');
      return EXIT_OK;
    }
    else if (args[i] === '--quiet') {
      options.quiet = true;
    }
    else if (args[i] === '--out') {
      options.out = args[++i];
      if (!options.out) {
        process.stderr.write('http fixture: --out requires a path\n');
        return EXIT_USAGE;
      }
    }
    else {
      process.stderr.write('http fixture: unknown argument ' + JSON.stringify(args[i]) + '\n' +
        USAGE + '\n');
      return EXIT_USAGE;
    }
  }

  var report;
  try {
    report = await selfTest(options);
  }
  catch (error) {
    process.stderr.write('http fixture: the self-test could not run: ' +
      (error && error.stack ? error.stack : String(error)) + '\n');
    return EXIT_ERROR;
  }

  report.cases.forEach(function(entry) {
    if (entry.ok && options.quiet) {
      return;
    }
    process.stdout.write((entry.ok ? '  ok   ' : '  FAIL ') + entry.group + ': ' + entry.name +
      (entry.ok ? '' : '\n         ' + entry.error) + '\n');
  });

  process.stdout.write('\n' + (report.ok ? 'PASS' : 'FAIL') + ': ' + report.passed +
    ' passed, ' + report.failed + ' failed, ' + report.profilesConsumed.length + ' of ' +
    report.profilesDeclared + ' profiles driven' +
    (report.profilesUnconsumed.length ? ', undriven: ' + report.profilesUnconsumed.join(', ') : '') +
    '\n');

  if (options.out) {
    process.stdout.write('wrote ' + options.out + '\n');
  }

  return report.ok ? EXIT_OK : EXIT_ERROR;
}

// ---------------------------------------------------------------------------
// Auto-install on first require, so a preload needs no argument and no call.
// Wrapped so that nothing here can throw out of the load: this module is
// required before app.js, and a throw at this point would take the server down
// before it ever started.
// ---------------------------------------------------------------------------
try {
  alignIdentitiesFromEnvironment();

  // The identity contract, checked at load and recorded rather than merely
  // documented. A violation is fatal to the OAuth branches' meaning but not to
  // the server, so it is published in the handshake and the log where a driver
  // - or assertReady() - can refuse to proceed on it.
  var identityAtLoad = checkIdentityContract();
  if (!identityAtLoad.ok) {
    note('identity-contract-violated', identityAtLoad);
  }
  else if (identityAtLoad.unverified.length) {
    note('identity-contract-unverified', identityAtLoad);
  }

  selectInitialProfile();
  install();
}
catch (e) {
  try {
    note('install-failed', { error: e.message });
  }
  catch (ignored) {
    // The evidence log itself is unavailable, so the failure is kept on the
    // state object instead, where status().diagnostic surfaces it. A plain
    // assignment cannot throw, which is what makes this the last layer.
    state.resolveDiagnostic = 'install failed and could not be logged: ' +
      (e && e.message ? e.message : String(e)) +
      ' (secondary failure: ' + (ignored && ignored.message ? ignored.message : String(ignored)) + ')';
  }
}

// ---------------------------------------------------------------------------
// Direct execution: either one child case, or the whole self-test.
//
// Neither branch is reachable through `require`, so the preload contract is
// unchanged - no argv is read, nothing is printed, and every input still
// arrives through a PARITY_* variable. `require.main === module` is what
// separates the two, and it is false for every consumer of this file.
// ---------------------------------------------------------------------------
if (require.main === module) {
  if (process.env[SELFTEST_CHILD_VAR]) {
    runChildCase(process.env[SELFTEST_CHILD_VAR]);
  }
  else {
    main(process.argv).then(function(code) {
      process.exitCode = code;
    }, function(error) {
      process.stderr.write('http fixture: ' +
        (error && error.stack ? error.stack : String(error)) + '\n');
      process.exitCode = EXIT_ERROR;
    });
  }
}
