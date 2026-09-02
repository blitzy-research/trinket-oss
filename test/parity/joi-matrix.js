#!/usr/bin/env node
'use strict';

// The joi validation parity matrix - the gate that turns a SAMPLE into a CLAIM.
//
// AAP §0.6.2 moves `joi` 17.13.3 -> 18.2.5 while PRESERVING the hand-rolled
// validation block, and the evidence offered for that bump was a sample of the
// repository's usage. This file is the gate that makes it a claim: all 102
// validation targets, three cases each, captured on the baseline worktree and
// replayed against the target, compared on the OBSERVABLE outcome.
//
// ===========================================================================
// RULES
// ===========================================================================
// `review_rules` returns exactly "No user rules provided." for this project,
// which AAP §0.7 and §0.10.1 independently record. NO rule is invented here and
// their absence is not read as licence to lower the bar: enterprise practice
// governs, and two commitments shape this file.
//   * EVERY PARITY CLAIM IS BACKED BY AN INSPECTABLE ARTIFACT. The generated
//     inputs are committed alongside the captured responses, inside
//     joi-baseline.json as a per-case `input` record, so a reviewer sees
//     exactly what was sent rather than having to re-derive it.
//   * NOTHING IS NORMALIZED AWAY THAT COULD BE COMPARED EXACTLY. Status,
//     `Location` and the rendered message are compared as measured. The single
//     exception is the ORIGIN of an absolute `Location`, which is a property of
//     the run and not of the response; the verbatim header is recorded anyway.
//
// The request's own RULES block is binding and is not that document:
//   R-c  A package change needs a stated reason, and the reason for joi
//        17.13.3 -> 18.2.5 is the request's own "joi current line". The sample
//        that justified it is not proof; 102 targets are.
//   R-d  Behaviour improvements are PROHIBITED, which is why the two inert
//        `language` maps stay inert. §PHASE 5 below makes their inertness an
//        ASSERTION: a run in which the friendly message suddenly appears fails,
//        because that is an improvement and not a repair.
//   R-e  Error-to-response mappings must survive unchanged, so what is captured
//        is the response `request.fail` produced - status, redirect target and
//        rendered flash - and never joi's return value.
//   R-f  Baseline behaviour at 2f8712a is the tie-breaker, which is why this
//        tool must run UNMODIFIED against a tree that does not contain it. That
//        is what `--app` is for, and why every application require is resolved
//        absolutely inside the tree under test.
//
// ===========================================================================
// INVOCATION - artifacts go to --out, BOTH STREAMS ARE DISCARDED
// ===========================================================================
// "Static" does not mean "no side effects". Proving that the parser deletes
// `validate` means calling `parseRoutes`, which dynamically requires every
// controller, and `lib/controllers/users.js` creates the exports queue at
// module load and prints its in-memory-queue line on STDOUT. A baseline tree
// additionally prints the AWS SDK v2 end-of-support notice on STDERR. Neither
// is suppressible from here, so a caller discards both streams EXPLICITLY and
// reads the artifact from disk:
//
//   # baseline capture, driven from THIS worktree against a baseline install
//   node test/parity/joi-matrix.js --capture \
//     --app /path/to/baseline-2f8712a \
//     --out /tmp/joi-baseline.json  >/dev/null 2>/dev/null
//
//   # THE GATE: replay the SAME recorded inputs against the target and diff
//   node test/parity/joi-matrix.js --compare /tmp/joi-baseline.json \
//     --out test/parity/joi-baseline.json 2>&1 >/dev/null
//
//   # offline re-comparison of two recordings, and the negative control
//   node test/parity/joi-matrix.js --compare /tmp/a.json /tmp/b.json
//
//   # the enumeration, the case set and the local schema proof, with no
//   # database and no listening socket
//   node test/parity/joi-matrix.js --schema-only --out /tmp/joi-schema.json \
//     >/dev/null 2>/dev/null
//
// Provenance is written to a SIBLING file, `<out>.provenance.json`, and never
// inside the artifact. That is what lets the artifact be diffed directly while
// still recording which tree, which joi and which configuration produced it.
//
// THIS FILE EMITS NO DEPRECATION WARNING OF ITS OWN, and that is measured
// rather than asserted: it uses `new URL` and never `url.parse` (DEP0169), and
// `Buffer.byteLength` and never `new Buffer` (DEP0005). One warning does appear
// on stderr under `--pending-deprecation`, and it belongs to neither this file
// nor the framework:
//     DEP0005 at node_modules/compress-commons/lib/archivers/zip/constants.js
// reached because proving the parser deletes `validate` means calling
// `parseRoutes`, which dynamically requires every controller, one of which
// requires `archiver` 2.1.1 - a package AAP §0.5.1.5 defers as unmaintained
// but functional. The application's own boot loads the same chain, so this is
// an application-and-dependency finding owned by AAP §0.9.3's warning gate,
// and it is one more reason a caller discards both streams here.
//
// ===========================================================================
// PHASE 1 - WHY THE SCHEMAS CANNOT COME FROM PARSED ROUTES
// ===========================================================================
// `parseRoutes` MUTATES ITS INPUT. It executes `delete route.options.validate`
// for every route that carries a validate block, and `delete
// validation.language` before that. Measured on this checkout: 228 declared
// objects parse to 233 registered routes, and `options.validate` survives on
// **0 of 233**. Reading schemas from parsed route objects yields ZERO targets -
// the shortcut does not under-report, it reports nothing.
//
// THEREFORE the declaration modules are required DIRECTLY, a PRISTINE deep copy
// is taken BEFORE any parse, and a SECOND throwaway copy is handed to `parse`.
// The pristine copy supplies all 97 validate blocks, all 102 target schemas and
// both `language` maps; the throwaway copy supplies the deletion proof.
//
// `structuredClone` WILL NOT WORK. Route declarations hold pre-handler
// FUNCTIONS (config/routes.js imports them from lib/util/helpers.js) and JOI
// SCHEMA OBJECTS, and structuredClone throws DataCloneError on a function. The
// deep copy below recurses into PLAIN OBJECTS AND ARRAYS ONLY and passes
// everything else - functions, Joi schemas, RegExp - through BY REFERENCE.
// Nothing in `parseRoutes` mutates a schema or a function, so sharing them is
// safe and necessary: a Joi schema cloned by walking its own properties is no
// longer a schema. What matters is that each copy owns its own plain-object
// containers, so a `delete` on one is invisible to the other.
//
// Two further facts govern the require set:
//   * THE LANGUAGE EXPANSION HAS ALREADY HAPPENED. config/routes.js's loop runs
//     at MODULE LOAD over the 11 `config.constants.trinketLangs`, so the
//     required array already holds all 228 declarations. It is not re-expanded.
//   * config/app.config IS NEVER REQUIRED, directly or transitively. It
//     requires ./db, and config/db.js calls connect() at MODULE SCOPE, exiting
//     non-zero with no database. The require set is exactly config/constants,
//     config/routes, config/api_routes and lib/util/routeParser - and
//     config/constants comes FIRST, because config/constants.js does
//     `module.exports = config.constants = constants` and config/routes.js
//     reads `config.constants.trinketLangs` at load.
//
// NO FLAG HERE MAY BE NAMED `-R` OR `--routes`, and none is. On a baseline tree
// lib/util/routeParser.js builds an `optimist` argv from OUR process.argv and
// aliases `R` to `routes`; on the target tree it reads the same two spellings
// straight off argv. Either spelling would make the parser emit its route table
// into our stdout the moment it is required.
//
// ===========================================================================
// PHASE 2 - THE TARGET SET
// ===========================================================================
// 97 validate blocks yield 102 targets, keyed `<METHOD> <path> <key>`:
//   75 payload   10 in config/routes.js + 65 in config/api_routes.js
//   26 query      5 + 21
//    1 params     `courseId`, on DELETE /api/admin/featured-course/{courseId},
//                 a route that ALSO carries a `query` target - which is exactly
//                 why targets are keyed per KEY and not per route.
// `language` is excluded: there are exactly 2, both in config/routes.js, both
// at the top level of their validate block, both deleted by the parser. They
// are not validation targets - but they ARE reported on; see PHASE 5.
//
// Arbitrary keys are possible at all because the hand-rolled block iterates
// `for (var key in validation)` and validates `request[key]` - a SUPERSET of
// hapi's payload/query/params/headers/state. The enumeration therefore follows
// the DECLARATIONS and not hapi's fixed key set, and a total other than 102
// fails the run loudly rather than being reported as a smaller matrix.
//
// ===========================================================================
// PHASE 3 - THREE CASES PER TARGET
// ===========================================================================
// accepting  Built by WALKING THE SCHEMA and supplying a valid value for EVERY
//            key, so required, cross-field and custom schemas receive COMPLETE
//            objects. A partial object fails for the wrong reason and would
//            record a rejection as an acceptance baseline. Candidates come from
//            `describe()` and are verified per leaf through `schema.extract`,
//            then the assembled object is verified through the SAME
//            `schema.validate(value, {abortEarly:false})` call the application
//            makes - and `Joi.isSchema` is the same check it uses to decide
//            whether a section needs wrapping in `Joi.object`.
// rejecting  One violation. Leaves bearing a regex are preferred, because that
//            is where the joi message text was measured; then `.invalid(...)`,
//            which for the two `username` targets is a 51-entry reserved list
//            spread from config/reserved.yaml.
// coercion   An input whose type differs from the declared type but which
//            joi's default `convert: true` accepts. Measured leaf census: 179
//            string, 30 boolean, 21 number, 9 object, 7 array, 4 any, 1
//            alternatives - so genuine coercion lives on the BOOLEAN and NUMBER
//            leaves ('true', '42'). Everything else records `N/A` WITH A
//            REASON. An honest N/A is required; a silently omitted case is not.
//
// ===========================================================================
// PHASE 4 - WHAT IS CAPTURED, AND WHY THE REDIRECT IS FOLLOWED
// ===========================================================================
// The observable outcome, never joi's return value. On failure the block
// flashes `validation` into yar and calls `request.fail(request.payload, ...)`.
// `request.fail` then, for `responseType === 'html'` with a `fail.redirect`,
// flashes `failure`, `payload` and `query`, INTERPOLATES the redirect target
// and redirects; otherwise it renders `fail.html` after `addUserContext`, or
// returns `h.response(json)` with `json.flash` carrying the errors.
//
// So on 10 of the 102 targets the message is NOT in the response at all - it is
// in the session, and it reaches a client only on the NEXT request. This tool
// therefore FOLLOWS the redirect with the same cookie jar and extracts the
// rendered message from the resulting page. A status-only capture would miss it
// entirely: measured, `POST /login` with no email answers 302 and the followed
// `/login` renders `"email" is required`.
//
// Both `Accept` modes are driven, because `responseType` is what decides which
// branch of `request.fail` runs and therefore whether the outcome is a 302 with
// a session-held message or a 200 with the message in the body.
//
// ===========================================================================
// PHASE 5 - THE MEASUREMENT THAT MUST NOT BE MISTAKEN FOR A REGRESSION
// ===========================================================================
// The two custom `language` maps key their friendly username message on the
// substring "regular expression", and the block's lookup matches `err.message`
// against each key AS A RegExp. Measured on BOTH joi 17.13.3 and 18.2.5, a
// regex failure produces
//     "username" with value "9bad" fails to match the required pattern: /.../
// which contains no such substring. The maps are ALREADY INERT at baseline and
// the bump does not change that.
//
// Both `username` targets therefore carry an explicit inertness record: the raw
// joi message, whether the custom message was substituted, and the conclusion.
// Under R-d the inert mapping is PRESERVED, NOT REPAIRED, so a run in which the
// friendly message appears is a FAILURE and exits non-zero. That assertion is
// explicit rather than implied.
//
// ===========================================================================
// PHASE 6 - WHY --compare REPLAYS THE RECORDED INPUTS
// ===========================================================================
// `--compare <baseline.json>` drives the target using the inputs RECORDED IN
// THE BASELINE, not the inputs it would generate for itself. If joi 18's
// `describe()` differed from joi 17's, regenerating would silently compare two
// different experiments. Instead the tool regenerates anyway and CROSS-CHECKS
// its own inputs against the recorded ones, reporting any divergence as a
// difference in its own right - which is the finding a reviewer wants - while
// the drive itself stays apples-to-apples.
//
// The design decision this gate protects: hapi 21 rejects the plain-object
// shorthand outright unless a validator is registered, and `server.validator(`
// is never called, so the hand-rolled block is what actually validates. Native
// validation would answer 400 where the preserved path answers 302. Keeping the
// block is what lets accept/reject outcomes be identical while joi still moves;
// this harness is the proof. Nothing here registers a validator.
//
// ===========================================================================
// THE MEASURED RESULT, baseline 2f8712a at joi 17.13.3 against this tree at
// joi 18.2.5
// ===========================================================================
// 102 targets, 306 case records, 231 of them applicable, 462 drives, 13427
// fields compared.
//
//   case scope             0 differences. Every schema-level verdict is
//                          identical: accepted or rejected, the joi MESSAGES
//                          verbatim, the error PATHS, and the value joi
//                          returned after coercion. THIS IS THE EVIDENCE FOR
//                          THE JOI BUMP, and it is what R-c's "stated reason"
//                          rests on.
//   generated-input scope  0 differences. joi 18's `describe()` produced the
//                          same inputs joi 17's did, so the two runs are the
//                          same experiment as well as the same bytes.
//   target scope           0 differences. Same 102 targets, same 75/26/1 split,
//                          same identities, pre-handlers and fail specs.
//   summary scope          The `language` maps are byte-identical and inert on
//                          both versions, and the validation reach is the same
//                          94 of 101 rejecting cases.
//
// 28 differences ARE reported, and not one of them is about joi: THE BASELINE
// APPLICATION CRASHES SEVEN TIMES during the run and this tree does not. Each
// crash is named in the artifact with the drive that discovered it and the
// drive that caused it; the clearest is `POST /api/folders`, whose unconverted
// controller answers a duplicate-key save by calling `request.catch({...})` on
// the hapi request. Five outcomes therefore record `socket hang up` on the
// baseline where this tree answers 500.
//
// Those 28 are REPORTED AND NOT SMOOTHED OVER, which is what a comparator is
// for: whether a crash that the async conversion inherently removes is an
// approved deviation under R-d is a decision for whoever reads the report, and
// this tool's job is to put it in front of them rather than to make it. The
// scope breakdown in the report exists so the joi answer cannot be lost among
// them.

// Node core only. Every one of these is referenced below; an import this file
// does not use is an import removed, because a stale require is a claim about
// the tool's dependencies that the code does not honour.
//   fs           - reading route modules' package metadata and writing artifacts
//   path         - resolving --app and --out against the original cwd
//   http/https   - the request driver at `exchange`, selected per URL protocol
//   querystring  - building `query`-transport inputs and parsing form bodies
//   childProcess - `git rev-parse` for provenance heads
var fs           = require('fs');
var path         = require('path');
var http         = require('http');
var https        = require('https');
var querystring  = require('querystring');
var childProcess = require('child_process');

// test/parity/server.js, test/parity/mongo.js and test/parity/seed.js are
// required LAZILY, inside the HTTP layer only. Two reasons, both load-bearing:
// `--schema-only` must load nothing that could provision a database, and the
// harvest must be the first thing in this process that touches the npm `config`
// package - which resolves and FREEZES on first require - so that it freezes
// against the tree `--app` selected and the composed NODE_CONFIG.
var lazy = { server: null, mongo: null, seed: null, mongoose: null };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Exit codes. EXIT_DIFFERENCE is what makes this a gate: a comparison that
// found a difference must fail a shell pipeline, and a comparator that cannot
// fail is not a gate. EXIT_ERROR is reserved for "the gate could not run",
// so a caller can always tell the two apart.
var EXIT_OK         = 0;
var EXIT_DIFFERENCE = 1;
var EXIT_ERROR      = 2;

// This tool's own worktree root, two levels above test/parity/. Used for the
// `--out` default, for `--app`'s default and for this tool's provenance. Only
// the ANALYSED tree moves; the artifact always belongs to this worktree.
var TOOL_ROOT = path.resolve(__dirname, '..', '..');

// AAP §0.6.2 names this exact path for the recorded baseline.
var DEFAULT_OUT = path.join(__dirname, 'joi-baseline.json');

// The validate section that is NOT a schema. `language` is the custom-message
// map; the parser deletes it separately, before the schemas. Excluding it is
// what makes the total come to exactly 102.
var VALIDATE_LANGUAGE_KEY = 'language';

// The figures this tool must reproduce, measured on this checkout and matching
// AAP §0.1.1.1 and §0.9.1. A mismatch is REPORTED AND FATAL rather than
// corrected: it means either a route module changed or the deep copy is reading
// post-parse state, and both invalidate the gate.
var EXPECTED = {
  declared        : 228,
  parsedRoutes    : 233,
  retainedValidate: 0,
  validateBlocks  : 97,
  targets         : 102,
  payload         : 75,
  query           : 26,
  params          : 1,
  languageMaps    : 2,
  byFile          : {
    'config/routes.js'     : { blocks: 15, payload: 10, query: 5, params: 0, language: 2 },
    'config/api_routes.js' : { blocks: 82, payload: 65, query: 21, params: 1, language: 0 }
  }
};

// The two routes carrying a `language` map, by declaration order. Named rather
// than counted, so PHASE 5's inertness record is addressed by identity.
var EXPECTED_LANGUAGE_ROUTES = ['POST /users', 'PUT /api/users/{userId}'];

// The substring both maps key their friendly message on, and the field they key
// it under. Held as data because PHASE 5 asserts on it: the lookup builds
// `new RegExp(key)` from this string and tests it against joi's message.
var LANGUAGE_MATCH_KEY = 'regular expression';
var LANGUAGE_FIELD     = 'username';

// The three case kinds, in the order they are generated and serialized.
var CASE_ACCEPTING = 'accepting';
var CASE_REJECTING = 'rejecting';
var CASE_COERCION  = 'coercion';
var CASE_KINDS     = [CASE_ACCEPTING, CASE_REJECTING, CASE_COERCION];

// The token recorded for a case that is genuinely inapplicable. A STRING and
// not `null`, so it survives JSON and reads unambiguously in the artifact
// beside a real input of `null`.
var NOT_APPLICABLE = 'N/A';

// Why a case is inapplicable, and the distinction the run's exit code turns on.
//
// A DETERMINATION is a measured fact about the schema or the transport, and it
// is the honest N/A the prompt requires: most string-only sections admit no
// coercion input at all, and the single `params` target admits no rejecting one
// because every non-empty path segment satisfies `Joi.string().required()` and
// a client cannot add a route parameter. Those are answers, not gaps, and they
// pass.
//
// UNRESOLVED means this tool failed to construct a case it should have been
// able to construct. That is a gap in the matrix - "102 means 102" - and it
// fails the run until the reason is added to REVIEWED_UNDRIVABLE as a
// reviewable diff.
var DETERMINATION_SCHEMA    = 'schema-admits-none';
var DETERMINATION_TRANSPORT = 'transport-admits-none';
var DETERMINATION_UNRESOLVED = 'unresolved';

// The two `Accept` modes, and the header each sends. `responseType` is derived
// by `accepts(request).types(['html','json'])`, so these two values are what
// select the two branches of `request.fail`.
var MODE_HTML = 'html';
var MODE_JSON = 'json';
var MODES     = [MODE_HTML, MODE_JSON];
var ACCEPT_HEADER = {
  html: 'text/html,application/xhtml+xml',
  json: 'application/json'
};

// The three identities a case can be driven as. Selection is by rule, not by
// route: a route whose pre-handlers include `isAdmin(user)` needs the admin
// whatever it declares, a route declaring `auth: 'session'` needs the seeded
// user, and a route that inherits the server default (`mode: 'try'`) is driven
// ANONYMOUSLY - which is both the faithful default for guest browsing and what
// keeps the authenticated-visitor 500 quirk on `GET /login` out of a
// validation measurement.
var IDENTITY_ANONYMOUS = 'anonymous';
var IDENTITY_USER      = 'user';
var IDENTITY_ADMIN     = 'admin';

// The pre-handler spelling that forces the admin identity.
var ADMIN_PRE = 'isAdmin(';

// The `findById` server methods, mapped to the test/parity/seed.js fixture each
// one looks up. `lib/util/helpers.js` registers them as
// `server.method('folder', internals.findById(Folder))` and the parser's string
// dispatcher resolves their argument off the request, so a declaration spelling
// `folder(payload.folderId)` is TELLING US that `payload.folderId` is a Folder
// identifier.
//
// That matters because PRE-HANDLERS RUN BEFORE THE VALIDATION BLOCK. A
// schema-derived value for such a field is a valid string that is not a
// document, so the pre-handler answers 404 or 500 and validation never runs -
// measured on six targets before this map existed. Substituting the seeded id
// is the same materialization `pathValues` already performs for `{folderId}`
// and `{fileId}`, applied where the declaration puts the identifier in the
// payload or the query instead of the path, and it is verified against the
// schema before it is used so it can never turn an accepting input into a
// rejecting one.
//
// `invitation` is DELIBERATELY ABSENT: the seeder has no CourseInvitation
// fixture, and inventing an id would produce a value that looked seeded and
// still answered 404. The two targets carrying it are recorded as unreached
// instead.
var LOOKUP_FIXTURES = {
  user     : 'user',
  course   : 'course',
  folder   : 'folder',
  file     : 'file',
  lesson   : 'lesson',
  // `parent(payload.parent, pre.lesson)` is registered as findById(Lesson).
  parent   : 'lesson',
  material : 'material',
  trinket  : 'trinketPython'
};

// Cases that CANNOT be constructed, each with the reason it cannot and the
// review that accepted it. Any case that reports itself undrivable and is NOT
// listed here fails the run: "102 means 102", and an unreviewed gap in the
// matrix must never pass silently. This list is data in the file precisely so
// that adding to it is a reviewable diff.
var REVIEWED_UNDRIVABLE = [
  {
    target : 'DELETE /api/admin/featured-course/{courseId} params',
    kind   : CASE_REJECTING,
    reason : 'The section is { courseId: Joi.string().required() } and the ' +
      'value is a PATH SEGMENT, so it is always a non-empty string and always ' +
      'satisfies the schema. An empty segment does not produce a validation ' +
      'failure - it fails to match the route and never reaches the handler ' +
      'that holds the validation block - so there is no input that makes this ' +
      'target reject. Recorded as N/A with this reasoning rather than driven ' +
      'with an invented unreachable case.'
  }
];

// How long any single HTTP exchange is given. Bounded so that a route that
// never settles is a RECORDED RESULT rather than a hung gate; AAP §0.9.3 makes
// exactly that distinction for the file-stream branch.
var REQUEST_TIMEOUT_MS = 20000;

// The safe filler character for a generated string. In `[a-z]`, in `\w`, in
// `[0-9a-f]`, and absent from the 51-entry reserved-username list, so one
// alphabet satisfies every measured pattern.
var FILLER = 'a';

// The default length of a generated string when the schema states no bound. 3
// is the smallest value that satisfies the two `min(3)` username schemas, so
// one default covers the bounded and unbounded cases alike.
var DEFAULT_STRING_LENGTH = 3;

// How many times the application may be restarted mid-run before the run is
// abandoned.
//
// THE TREE UNDER TEST CAN CRASH, and on the baseline it does. Measured:
// `lib/controllers/folders.js` answers a duplicate-key save by calling
// `request.catch({...})` - `request` is the hapi request, not a promise - so
// driving `POST /api/folders` with the same payload twice, which this tool does
// because it drives every case in both Accept modes, raises
// `TypeError: request.catch is not a function` inside a mongoose callback,
// which surfaces as an unhandled 'error' event and KILLS THE PROCESS. The
// converted controller does not.
//
// A gate that died with it could never capture a baseline at all, and R-f makes
// the baseline the tie-breaker - so the crash is RECORDED, the application is
// restarted, and the run continues. The bound exists so a tree that crashes on
// every request reports that rather than restarting forever.
var MAX_RESTARTS = 30;

// The transport failures that mean the application is gone rather than that it
// answered something unexpected.
var UNREACHABLE = /ECONNREFUSED|ECONNRESET|EPIPE|ETIMEDOUT|socket hang up/;

// Keys whose VALUES are redacted out of the NODE_CONFIG recorded in the
// provenance sidecar. The composed configuration carries the harness session
// password from test/parity/server-overlay.json, and it may carry mail or AWS
// credentials if a caller's --overlay supplies them.
//
// Why redact something that is already a self-labelled non-secret. The
// provenance exists so a reviewer can REPRODUCE the run, and the overlay is
// committed, so the value adds nothing reproducible by being repeated here -
// while a password-shaped string sitting in a committed artifact is a finding a
// future reviewer has to triage before they can trust the file. Recording the
// KEY and withholding the VALUE keeps everything the reviewer needs and drops
// the only part they would have to think about.
//
// Two properties make this safe rather than merely tidy. It applies to the
// RECORDED COPY ONLY - `prepareEnvironment` hands the child the real
// configuration, and redaction happens afterwards on a deep copy, so nothing
// about the run changes. And it is DECLARED: `redactedKeys` lists every path
// redacted, because an undeclared redaction is a record that misrepresents
// itself, which is worse than the string it removed.
var SECRET_KEY_PATTERN = /(password|passwd|secret|secretkey|privatekey|credential|api[_-]?key|access[_-]?token|auth[_-]?token|^key$|^keyid$|^pass$|^token$)/i;

// The replacement. Deliberately not a provider-shaped value: it cannot match a
// secret scanner's pattern, and it says what it is.
var REDACTED = '[redacted-by-joi-matrix]';

// How many refinement rounds the accepting-input builder is given. Each round
// consumes joi's own reported error paths, so the ladder converges in one or
// two; the bound exists so a schema this tool cannot satisfy becomes a reported
// undrivable case instead of a spin.
var MAX_REFINEMENT_ROUNDS = 6;

var USAGE = [
  'test/parity/joi-matrix.js - validation accept/reject parity, all 102 targets',
  '',
  'Enumerates every validation target from a PRE-PARSE copy of the route',
  'declarations, builds an accepting, a rejecting and a coercion case for each,',
  'proves each case locally against the schema, drives it against a running',
  'application in both Accept modes, and compares the result with a recorded',
  'baseline. Artifacts go to --out and NEVER to stdout; diagnostics go to',
  'stderr.',
  '',
  'MODES',
  '  --capture                Capture a matrix. The default.',
  '  --compare <base.json>    Replay the inputs recorded in <base.json> against',
  '                           the tree under test and diff every field.',
  '  --compare <a> <b>        Compare two recorded matrices offline.',
  '  --schema-only            Enumerate, build and prove the cases without a',
  '                           database or a listening socket. No HTTP outcome',
  '                           is recorded, so this is NOT the full gate.',
  '  --help                   This text.',
  '',
  'OPTIONS',
  '  --app <path>       Root of the worktree under test. Defaults to this',
  '                     tool\'s own repository root. Point it at a `git',
  '                     worktree` to capture a baseline with tooling that does',
  '                     not exist at that commit.',
  '  --out <path>       Where the artifact goes. In capture and --schema-only',
  '                     modes this is the matrix, defaulting to',
  '                     test/parity/joi-baseline.json, and the sibling',
  '                     <out>.provenance.json is written beside it. In',
  '                     --compare mode this is the comparison REPORT,',
  '                     defaulting to test/parity/joi-comparison.json, and a',
  '                     live replay additionally writes the matrix it drove to',
  '                     <out>.target.json with its own provenance sidecar.',
  '  --port <n>         Bind port for the application under test. Defaults to',
  '                     the overlay\'s. Set it per clone to avoid a collision.',
  '  --database <name>  Pin the MongoDB database name.',
  '  --overlay <path>   NODE_CONFIG overlay for the application under test.',
  '                     Defaults to test/parity/server-overlay.json.',
  '  --mongo-uri <uri>  Drive an already-running mongod instead of',
  '                     provisioning one.',
  '',
  'EXIT CODES',
  '  0  success, or a comparison that found no difference',
  '  1  a comparison found a difference, or an asserted invariant failed',
  '     (the inert `language` maps stopped being inert, or a case reported',
  '     itself undrivable without a reviewed reason)',
  '  2  usage or operational failure - the gate could not run',
  '',
  'NOTE Both output streams of the analysed tree must be discarded by the',
  '     caller: proving the parser deletes `validate` loads every controller,',
  '     which prints the in-memory-queue line on stdout, and a baseline tree',
  '     prints the AWS SDK v2 notice on stderr.',
  '',
  'NOTE No flag is named -R or --routes, and none may be: lib/util/routeParser',
  '     reads both spellings off this process\'s argv and would emit its route',
  '     table into stdout the moment it is required.',
  ''
].join('\n');

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

/**
 * Writes a diagnostic line to stderr.
 *
 * Every human-readable byte this tool produces goes to stderr, so that stdout
 * carries nothing at all and the caller's `>/dev/null` is a statement about the
 * analysed application's output rather than about ours.
 *
 * @param {string} message
 * @returns {undefined}
 */
function note(message) {
  process.stderr.write(String(message) + '\n');
}

/**
 * An operational failure, distinguished from a parity difference.
 *
 * Thrown for a usage error or for any condition that means the tool cannot
 * produce a trustworthy artifact - a wrong `--app`, a route module that no
 * longer yields 102 targets, a database that will not start. It exits 2, never
 * 1, so a caller can tell "the gate ran and found a difference" from "the gate
 * could not run".
 *
 * @param {string} message
 * @constructor
 */
function ToolError(message) {
  Error.call(this, message);
  this.name    = 'ToolError';
  this.message = message;
  this.stack   = (new Error(message)).stack;
}
ToolError.prototype = Object.create(Error.prototype);
ToolError.prototype.constructor = ToolError;

/**
 * A parity difference or a failed invariant, as distinct from an operational
 * failure.
 *
 * Exits 1. Used for the two assertions that are about BEHAVIOUR rather than
 * about the tool's ability to run: an unreviewed undrivable case, and the
 * `language` maps ceasing to be inert.
 *
 * @param {string} message
 * @constructor
 */
function ParityError(message) {
  Error.call(this, message);
  this.name    = 'ParityError';
  this.message = message;
  this.stack   = (new Error(message)).stack;
}
ParityError.prototype = Object.create(Error.prototype);
ParityError.prototype.constructor = ParityError;

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

/**
 * Parses the command line.
 *
 * Output and input paths are resolved against the ORIGINAL working directory,
 * captured before the harvest chdirs into the tree under test. Resolving them
 * afterwards would silently retarget a relative `--out` into the analysed
 * worktree - which, for a baseline capture, would write into a tree this tool
 * must not modify.
 *
 * @param {string[]} args process.argv.slice(2)
 * @param {string} originalCwd The working directory at process start.
 * @returns {{mode: string, appRoot: string, out: (string|null),
 *            compare: string[], port: (number|null),
 *            database: (string|null), overlay: (string|null),
 *            mongoUri: (string|null)}}
 * @throws {ToolError} On an unknown flag, a missing value or a mode conflict.
 */
function parseArguments(args, originalCwd) {
  var options = {
    mode     : 'capture',
    appRoot  : TOOL_ROOT,
    out      : null,
    compare  : [],
    port     : null,
    database : null,
    overlay  : null,
    mongoUri : null
  };
  var seen = {};
  var i;

  function value(flag, index) {
    var next = args[index + 1];

    if (next === undefined || next.charAt(0) === '-') {
      throw new ToolError(flag + ' requires a value');
    }

    return next;
  }

  function once(flag) {
    if (seen[flag]) {
      throw new ToolError(flag + ' given more than once');
    }
    seen[flag] = true;
  }

  function setMode(mode, flag) {
    if (options.mode !== 'capture' && options.mode !== mode) {
      throw new ToolError('--' + options.mode + ' and ' + flag +
        ' are mutually exclusive');
    }
    options.mode = mode;
  }

  for (i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--help':
      case '-h':
        options.mode = 'help';
        return options;

      case '--capture':
        setMode('capture', '--capture');
        break;

      case '--schema-only':
        setMode('schema-only', '--schema-only');
        break;

      case '--compare':
        setMode('compare', '--compare');
        // One value replays the recorded inputs against the tree under test;
        // two compare recordings offline. Read positionally here rather than as
        // loose positionals so the baseline-then-target order is explicit,
        // which is what makes the report's "only in baseline" and "only in
        // target" sections mean what they say.
        once('--compare');
        options.compare.push(path.resolve(originalCwd, value('--compare', i)));
        i += 1;
        if (args[i + 1] !== undefined && args[i + 1].charAt(0) !== '-') {
          options.compare.push(path.resolve(originalCwd, args[i + 1]));
          i += 1;
        }
        break;

      case '--app':
        once('--app');
        options.appRoot = path.resolve(originalCwd, value('--app', i));
        i += 1;
        break;

      case '--out':
        once('--out');
        options.out = path.resolve(originalCwd, value('--out', i));
        i += 1;
        break;

      case '--port':
        once('--port');
        options.port = parsePort(value('--port', i));
        i += 1;
        break;

      case '--database':
        once('--database');
        options.database = value('--database', i);
        i += 1;
        break;

      case '--overlay':
        once('--overlay');
        options.overlay = path.resolve(originalCwd, value('--overlay', i));
        i += 1;
        break;

      case '--mongo-uri':
        once('--mongo-uri');
        options.mongoUri = value('--mongo-uri', i);
        i += 1;
        break;

      default:
        throw new ToolError('unknown argument: ' + args[i]);
    }
  }

  return options;
}

/**
 * Parses a TCP port, rejecting anything that is not one.
 *
 * A silently-NaN port would surface much later as an unreachable server and
 * read as an application fault.
 *
 * @param {string} raw
 * @returns {number}
 * @throws {ToolError} If `raw` is not a port number.
 */
function parsePort(raw) {
  var port = Number(raw);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ToolError('--port must be an integer between 1 and 65535, not ' +
      JSON.stringify(raw));
  }

  return port;
}


// ---------------------------------------------------------------------------
// Deep copy - the mechanism that survives parseRoutes
// ---------------------------------------------------------------------------

/**
 * True for an object literal - the only container the copy recurses into,
 * alongside arrays.
 *
 * A Joi schema, a RegExp, a Date and a Buffer all fail this test and are
 * therefore shared by reference, which is both correct and required: `parse`
 * never mutates one, and a Joi schema cloned by walking its own properties
 * would no longer be a schema - `Joi.isSchema` would reject it and this file's
 * whole measurement would collapse.
 *
 * @param {*} value
 * @returns {boolean}
 */
function isPlainObject(value) {
  if (value === null || typeof value !== 'object') {
    return false;
  }

  var prototype = Object.getPrototypeOf(value);

  return prototype === Object.prototype || prototype === null;
}

/**
 * Deep-copies plain objects and arrays, sharing everything else by reference.
 *
 * `structuredClone` cannot be used: route declarations hold pre-handler
 * FUNCTIONS and JOI SCHEMA OBJECTS, and structuredClone throws DataCloneError
 * on a function. What matters for correctness is only that each copy owns its
 * own plain-object and array containers, so that the parser's `delete
 * route.options.validate` and `delete validation.language` land on the
 * throwaway copy and are invisible to the pristine one.
 *
 * Own enumerable string keys are copied in their own order, so a copy
 * serializes identically to its original.
 *
 * @param {*} value
 * @returns {*}
 */
function deepCopy(value) {
  var copy;
  var keys;
  var i;

  if (Array.isArray(value)) {
    copy = new Array(value.length);
    for (i = 0; i < value.length; i++) {
      copy[i] = deepCopy(value[i]);
    }
    return copy;
  }

  if (isPlainObject(value)) {
    copy = {};
    keys = Object.keys(value);
    for (i = 0; i < keys.length; i++) {
      copy[keys[i]] = deepCopy(value[keys[i]]);
    }
    return copy;
  }

  return value;
}

/**
 * Deep-merges `overlay` over `base`, returning a new plain object.
 *
 * Used only for NODE_CONFIG composition, where the overlay must win: the point
 * of the overlay is to force a value the caller must not be able to defeat.
 *
 * @param {Object} base
 * @param {Object} overlay
 * @returns {Object}
 */
function deepMerge(base, overlay) {
  var out = {};
  var keys;
  var key;
  var i;

  keys = Object.keys(isPlainObject(base) ? base : {});
  for (i = 0; i < keys.length; i++) {
    out[keys[i]] = base[keys[i]];
  }

  keys = Object.keys(isPlainObject(overlay) ? overlay : {});
  for (i = 0; i < keys.length; i++) {
    key = keys[i];
    if (isPlainObject(out[key]) && isPlainObject(overlay[key])) {
      out[key] = deepMerge(out[key], overlay[key]);
    }
    else {
      out[key] = overlay[key];
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

/**
 * Reduces a value to a JSON-safe mirror, recording rather than dropping
 * anything that JSON.stringify would silently discard.
 *
 * Generated inputs are plain data by construction, so this guard normally does
 * nothing. It exists because a leaf this tool did not anticipate - a Buffer for
 * an upload, a Date - must appear in the artifact AS SOMETHING rather than
 * vanish, which would turn a real input difference into an invisible one.
 *
 * Key order is preserved verbatim and deliberately NOT sorted: for a payload it
 * is the order the keys were declared in, and it is the order they are sent.
 *
 * @param {*} value
 * @returns {*}
 */
function jsonSafe(value) {
  var out;
  var keys;
  var i;

  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value === 'function') {
    return '<function>';
  }

  if (typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    // A non-finite number serializes as null, which would read as "absent".
    return isFinite(value) ? value : '<number:' + String(value) + '>';
  }

  if (typeof value !== 'object') {
    return '<' + typeof value + '>';
  }

  if (Array.isArray(value)) {
    out = [];
    for (i = 0; i < value.length; i++) {
      out.push(jsonSafe(value[i]));
    }
    return out;
  }

  if (!isPlainObject(value)) {
    return '<' + ((value.constructor && value.constructor.name) || 'object') + '>';
  }

  out  = {};
  keys = Object.keys(value);
  for (i = 0; i < keys.length; i++) {
    out[keys[i]] = jsonSafe(value[keys[i]]);
  }

  return out;
}

/**
 * Serializes an artifact deterministically.
 *
 * JSON.stringify emits own enumerable string keys in insertion order, and every
 * object in an artifact is built through a fixed key order, so a fixed
 * two-space indent is all that is needed to make a byte diff of two matrices
 * meaningful before the structured comparison runs. A trailing newline is
 * added so the file is a well-formed text file.
 *
 * @param {*} value
 * @returns {string}
 */
function serialize(value) {
  return JSON.stringify(value, null, 2) + '\n';
}

/**
 * Canonical form of one field's value, for equality testing.
 *
 * Order-sensitive, which is the faithful choice: a rendered message list is in
 * document order and a payload's keys are in declaration order, and both are
 * observable.
 *
 * @param {*} value
 * @returns {string}
 */
function canonical(value) {
  return JSON.stringify(value === undefined ? null : value);
}

// ---------------------------------------------------------------------------
// Filesystem helpers
// ---------------------------------------------------------------------------

/**
 * Writes a text artifact, creating its directory if needed.
 *
 * @param {string} target Absolute path.
 * @param {string} text
 * @returns {undefined}
 * @throws {ToolError} If the directory cannot be created or the file written.
 */
function writeArtifact(target, text) {
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
  }
  catch (err) {
    throw new ToolError('cannot create directory for ' + target + ': ' +
      err.message);
  }

  try {
    fs.writeFileSync(target, text, 'utf8');
  }
  catch (err) {
    throw new ToolError('cannot write ' + target + ': ' + err.message);
  }
}

/**
 * Reads and parses a matrix written by this tool.
 *
 * @param {string} target Absolute path.
 * @returns {Object}
 * @throws {ToolError} If the file is missing, unreadable, not JSON, or not a
 *   matrix of the expected shape.
 */
function readMatrix(target) {
  var text;
  var parsed;

  try {
    text = fs.readFileSync(target, 'utf8');
  }
  catch (err) {
    throw new ToolError('cannot read matrix ' + target + ': ' + err.message);
  }

  try {
    parsed = JSON.parse(text);
  }
  catch (err) {
    throw new ToolError('matrix ' + target + ' is not valid JSON: ' +
      err.message);
  }

  if (!parsed || !Array.isArray(parsed.targets)) {
    throw new ToolError('matrix ' + target + ' has no `targets` array; it was ' +
      'not written by test/parity/joi-matrix.js');
  }

  return parsed;
}

/**
 * The HEAD commit of the git worktree containing `directory`, or null.
 *
 * A missing git, a directory outside a repository or any non-zero exit yields
 * null rather than a throw: provenance is evidence about a run, and a run that
 * produced a correct matrix must not be failed for being unable to name its own
 * commit. `execFileSync` takes an argument array, so nothing goes through a
 * shell.
 *
 * @param {string} directory
 * @returns {(string|null)}
 */
function gitHead(directory) {
  var output;

  try {
    output = childProcess.execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd      : directory,
      encoding : 'utf8',
      stdio    : ['ignore', 'pipe', 'ignore']
    });
  }
  catch (err) {
    return null;
  }

  output = String(output).trim();

  return output || null;
}

/**
 * The version a package resolves to inside `appRoot`, or null.
 *
 * Recorded in the provenance because it is the single most important fact about
 * a capture: a matrix captured at joi 17.13.3 and one captured at 18.2.5 are
 * the two sides of this gate, and a reviewer must be able to see which is
 * which without trusting a filename.
 *
 * @param {string} appRoot Absolute path.
 * @param {string} name Package name.
 * @returns {(string|null)}
 */
function packageVersion(appRoot, name) {
  var manifest = path.join(appRoot, 'node_modules', name, 'package.json');

  try {
    return JSON.parse(fs.readFileSync(manifest, 'utf8')).version || null;
  }
  catch (err) {
    return null;
  }
}


// ---------------------------------------------------------------------------
// The tree under test
// ---------------------------------------------------------------------------

/**
 * Verifies that `appRoot` looks like a checkout of this application.
 *
 * Checked before anything is required, because a wrong `--app` otherwise
 * surfaces as a bare MODULE_NOT_FOUND from deep inside a require chain, and on
 * a two-worktree gate the most likely mistake is exactly a mistyped path.
 *
 * @param {string} appRoot Absolute path.
 * @returns {undefined}
 * @throws {ToolError} If a required file is absent.
 */
function assertAppRoot(appRoot) {
  var required = [
    'app.js',
    'config/constants.js',
    'config/routes.js',
    'config/api_routes.js',
    'config/reserved.yaml',
    'lib/util/routeParser.js',
    'node_modules/joi/package.json'
  ];
  var candidate;
  var i;

  if (!fs.existsSync(appRoot) || !fs.statSync(appRoot).isDirectory()) {
    throw new ToolError('--app is not a directory: ' + appRoot);
  }

  for (i = 0; i < required.length; i++) {
    candidate = path.join(appRoot, required[i]);
    if (!fs.existsSync(candidate)) {
      throw new ToolError('--app does not look like an installed trinket ' +
        'checkout: missing ' + required[i] + ' under ' + appRoot +
        (required[i].indexOf('node_modules') === 0
          ? '. A baseline worktree needs its OWN `npm ci` from the baseline ' +
            'lockfile: the two trees resolve different joi versions, which is ' +
            'the whole point of this gate.'
          : ''));
    }
  }
}

/**
 * The NODE_CONFIG overlay every mode applies, as a JSON string.
 *
 * `db.redis.enabled: false` IS NOT OPTIONAL. Proving that the parser deletes
 * `validate` means calling `parseRoutes`, which dynamically requires EVERY
 * controller, and `lib/controllers/users.js` executes
 * `require('../util/queues').exports()` at module load. With `db.redis.enabled`
 * undefined - which is what BOTH trees' committed YAML leaves it as, since no
 * committed file declares the key - `lib/util/queues.js` takes the Bull branch
 * and dials localhost:6379, risking a hang or an unhandled ECONNREFUSED. False
 * selects the in-memory branch. AAP §0.9.1 specifies exactly this overlay, and
 * it is passed identically to both trees so no configuration file is edited to
 * achieve it.
 *
 * An inherited NODE_CONFIG is honoured underneath the overlay. An inherited
 * value that is not valid JSON is a hard failure rather than something to
 * discard silently: node-config would reject it anyway, and quietly dropping a
 * caller's configuration would make a baseline and a target run differ for a
 * reason absent from the provenance.
 *
 * @param {(string|undefined)} inherited process.env.NODE_CONFIG
 * @returns {string} A JSON string.
 * @throws {ToolError} If `inherited` is present but not a JSON object.
 */
function composeNodeConfig(inherited) {
  var base = {};
  var overlay = { db: { redis: { enabled: false } } };

  if (inherited !== undefined && String(inherited).trim() !== '') {
    try {
      base = JSON.parse(inherited);
    }
    catch (err) {
      throw new ToolError('inherited NODE_CONFIG is not valid JSON, refusing ' +
        'to discard it: ' + err.message);
    }

    if (!isPlainObject(base)) {
      throw new ToolError('inherited NODE_CONFIG is not a JSON object');
    }
  }

  return JSON.stringify(deepMerge(base, overlay));
}

/**
 * Prepares the process for the FIRST application require.
 *
 * Four settings, all of which must precede it:
 *   NODE_CONFIG_DIR  The npm `config` package resolves its directory from
 *                    process.cwd(), so without this a baseline run would read
 *                    the TARGET tree's YAML - and the recaptcha-conditional
 *                    schema at config/api_routes.js:6-8 is derived FROM
 *                    configuration, so the target set itself would come from
 *                    the wrong tree.
 *   process.chdir    Same reason, and it makes the analysed tree the resolution
 *                    root for anything read relative to the working directory.
 *   NODE_CONFIG      The redis overlay described in composeNodeConfig.
 *   NODE_CONFIG_PERSIST_ON_CHANGE  'N', so `config` never writes
 *                    config/runtime.json into the tree under test. A baseline
 *                    worktree must come out of this run BYTE-IDENTICAL.
 * NODE_ENV is set to 'test' unless the caller overrode it, matching AAP
 * §0.9.1's gate command; whatever value results is recorded in the provenance
 * and passed identically to both trees.
 *
 * @param {string} appRoot Absolute path, already validated.
 * @returns {{nodeEnv: string, nodeConfig: string, nodeConfigDir: string,
 *            originalCwd: string}}
 * @throws {ToolError} If the working directory cannot be changed.
 */
function prepareEnvironment(appRoot) {
  var nodeConfig    = composeNodeConfig(process.env.NODE_CONFIG);
  var nodeConfigDir = path.join(appRoot, 'config');
  var originalCwd   = process.cwd();

  if (!process.env.NODE_ENV) {
    process.env.NODE_ENV = 'test';
  }

  process.env.NODE_CONFIG_DIR = nodeConfigDir;
  process.env.NODE_CONFIG     = nodeConfig;
  process.env.NODE_CONFIG_PERSIST_ON_CHANGE = 'N';

  try {
    process.chdir(appRoot);
  }
  catch (err) {
    throw new ToolError('cannot chdir to ' + appRoot + ': ' + err.message);
  }

  return {
    nodeEnv       : process.env.NODE_ENV,
    nodeConfig    : nodeConfig,
    nodeConfigDir : nodeConfigDir,
    originalCwd   : originalCwd
  };
}

/**
 * Requires one module from the tree under test.
 *
 * EVERY application require goes through here, resolved ABSOLUTELY inside
 * `appRoot`. Node resolves `require` relative to the requiring FILE, so a
 * relative '../../config/routes' would always load the TARGET tree even while
 * analysing the baseline - the single bug that would make the two-worktree
 * model meaningless, because both matrices would then describe the same tree
 * and the gate would pass unconditionally. Resolving inside `appRoot` also
 * means `joi` itself resolves from <appRoot>/node_modules, which is the whole
 * point: 17.13.3 on one side and 18.2.5 on the other.
 *
 * @param {string} appRoot Absolute path.
 * @param {string} relative Repository-relative module path.
 * @returns {*} The module's exports.
 * @throws {ToolError} If the module cannot be loaded.
 */
function requireFromApp(appRoot, relative) {
  var target = path.resolve(appRoot, relative);

  try {
    return require(target);
  }
  catch (err) {
    throw new ToolError('cannot load ' + relative + ' from ' + appRoot + ': ' +
      (err && err.message ? err.message : String(err)));
  }
}

// ---------------------------------------------------------------------------
// PHASE 1 - the harvest
// ---------------------------------------------------------------------------

/**
 * Loads the declaration modules and the parser, keeps a PRISTINE deep copy and
 * parses a THROWAWAY one.
 *
 * The require order is fixed and load-bearing. config/constants.js does
 * `module.exports = config.constants = constants`, which is what makes
 * `config.constants.trinketLangs` available to config/routes.js, whose
 * language-expansion loop runs at MODULE LOAD. Requiring routes first would
 * expand nothing or throw. config/app.config is never required, directly or
 * transitively.
 *
 * The parse is not decoration: it is the deletion proof. `parseRoutes` is
 * handed the throwaway copy, and afterwards the pristine copy must still carry
 * all 97 validate blocks while the parsed routes carry none.
 *
 * @param {string} appRoot Absolute path.
 * @returns {{joi: Object, pristine: Object[], parsed: Object[],
 *            declaredCount: number, byFile: Object}}
 * @throws {ToolError} If a module cannot be loaded or the parse fails.
 */
function harvest(appRoot) {
  var pageRoutes;
  var apiRoutes;
  var routeParser;
  var joi;
  var declared;
  var pristine;
  var throwaway;
  var parsed;

  // FIRST. See above.
  requireFromApp(appRoot, 'config/constants');

  pageRoutes  = requireFromApp(appRoot, 'config/routes');
  apiRoutes   = requireFromApp(appRoot, 'config/api_routes');
  routeParser = requireFromApp(appRoot, 'lib/util/routeParser');
  joi         = requireFromApp(appRoot, 'node_modules/joi');

  if (!Array.isArray(pageRoutes) || !Array.isArray(apiRoutes)) {
    throw new ToolError('config/routes and config/api_routes must both export ' +
      'arrays');
  }

  if (!routeParser || typeof routeParser.parse !== 'function') {
    throw new ToolError('lib/util/routeParser does not export parse()');
  }

  if (!joi || typeof joi.isSchema !== 'function' ||
      typeof joi.object !== 'function') {
    throw new ToolError('joi did not resolve from ' + appRoot +
      '/node_modules, or does not expose isSchema() and object()');
  }

  // The EXACT concatenation config/app.config.js applies -
  // `routeParser.parse(api_routes.concat(routes))` - reproduced without
  // requiring that module, whose next line loads config/db and connects.
  declared  = apiRoutes.concat(pageRoutes);
  pristine  = deepCopy(declared);
  throwaway = deepCopy(declared);

  try {
    parsed = routeParser.parse(throwaway);
  }
  catch (err) {
    throw new ToolError('routeParser.parse failed: ' +
      (err && err.message ? err.message : String(err)));
  }

  if (!Array.isArray(parsed)) {
    throw new ToolError('routeParser.parse did not return an array');
  }

  return {
    joi           : joi,
    pristine      : pristine,
    parsed        : parsed,
    declaredCount : declared.length,
    byFile        : {
      'config/routes.js'     : pageRoutes.length,
      'config/api_routes.js' : apiRoutes.length
    },
    fileOf        : function(index) {
      // The concatenation put api_routes first, so an index below its length
      // belongs to it. Recorded per target so the 10/65 and 5/21 splits in
      // EXPECTED.byFile can be asserted rather than assumed.
      return index < apiRoutes.length
        ? 'config/api_routes.js'
        : 'config/routes.js';
    }
  };
}


// ---------------------------------------------------------------------------
// PHASE 2 - the target set
// ---------------------------------------------------------------------------

/**
 * The declared method, path and controller binding of one declaration.
 *
 * Derived exactly as the parser derives them: `route.route` split on
 * whitespace, token 0 the method, token 1 the path, token 2 the binding.
 * Splitting it any other way would produce a key that cannot join against
 * test/parity/manifest.js's entries.
 *
 * @param {Object} declaration
 * @returns {{method: string, path: string, controller: (string|null)}}
 */
function routeInfo(declaration) {
  var parts = String(declaration.route).split(/\s+/);

  return {
    method     : parts[0],
    path       : parts[1],
    controller : parts[2] === undefined || parts[2] === '' ? null : parts[2]
  };
}

/**
 * Descriptors for a declaration's pre-handlers - descriptors, NOT the
 * functions.
 *
 * Recorded for two reasons that both matter to this gate. First, PRE-HANDLERS
 * RUN BEFORE THE VALIDATION BLOCK: the block lives inside the route handler,
 * and hapi runs `pre` before the handler, so a pre-handler that fails takes
 * over and validation never executes. Second, the string form
 * `isAdmin(user)` is what selects the admin identity. 62 of the 97 routes
 * carrying a validate block also carry pre-handlers, so this is not an edge
 * case - it is the majority.
 *
 * A function's identity is deliberately not recorded: every pre-handler
 * function here reports an empty or property-inferred `.name`, and a source
 * digest would differ between the two trees for every function-form entry
 * because converting lib/util/helpers.js to the hapi lifecycle contract is the
 * very change this gate must see through.
 *
 * @param {Object} declaration
 * @returns {Array.<{kind: string, method: (string|null), assign: (string|null)}>}
 */
function preDescriptors(declaration) {
  var pre = declaration.config && declaration.config.pre;

  if (!Array.isArray(pre)) {
    return [];
  }

  return pre.map(function(entry) {
    if (typeof entry === 'string') {
      return { kind: 'string', method: entry, assign: null };
    }

    if (typeof entry === 'function') {
      return { kind: 'function', method: null, assign: null };
    }

    if (isPlainObject(entry)) {
      return {
        kind   : typeof entry.method === 'string'
          ? 'object-with-string'
          : 'object-with-function',
        method : typeof entry.method === 'string' ? entry.method : null,
        assign : entry.assign === undefined ? null : entry.assign
      };
    }

    return { kind: 'unclassified', method: null, assign: null };
  });
}

/**
 * The dotted request paths a declaration's string pre-handlers dereference.
 *
 * The parser's string dispatcher resolves an argument like `payload.folderId`
 * or `query.user` off the request before the handler runs, and this matters to
 * the rejecting ladder for a reason that only shows up when the gate is driven:
 * PRE-HANDLERS RUN BEFORE THE VALIDATION BLOCK, so violating a field a
 * pre-handler dereferences means the pre-handler answers first and validation
 * never executes. Measured, before this was accounted for: omitting the
 * required `folderId` on `POST /api/trinkets/{trinketId}/folder` answered 400
 * from `folder(payload.folderId)` and produced no validation flash at all, and
 * five other targets behaved the same way.
 *
 * Only the STRING form can be read this way. A function pre-handler's
 * references are invisible here - `helpers.validLang` reads `query.lang` and
 * nothing in the declaration says so - which is why the ladder PREFERS an
 * unreferenced leaf rather than requiring one, and why the artifact records
 * whether validation was actually observed instead of assuming it.
 *
 * @param {Object} declaration
 * @returns {string[]} Dotted references, deduplicated, in declaration order.
 */
function preReferences(declaration) {
  var pre = declaration.config && declaration.config.pre;
  var out = [];

  if (!Array.isArray(pre)) {
    return out;
  }

  pre.forEach(function(entry) {
    var spelling = typeof entry === 'string'
      ? entry
      : (isPlainObject(entry) && typeof entry.method === 'string'
        ? entry.method
        : null);
    var args;

    if (!spelling) {
      return;
    }

    args = /\(([^)]*)\)/.exec(spelling);

    if (!args) {
      return;
    }

    args[1].split(',').forEach(function(argument) {
      var token = argument.trim();

      if (token && token.indexOf('.') > 0) {
        out.push(token);
      }
    });
  });

  return dedupe(out);
}

/**
 * The keys of one section that a string pre-handler dereferences.
 *
 * @param {string[]} references From preReferences.
 * @param {string} section 'payload', 'query' or 'params'.
 * @returns {Object} A key -> true set.
 */
function referencedKeys(references, section) {
  var out = {};

  references.forEach(function(reference) {
    var parts = reference.split('.');

    if (parts[0] === section && parts[1]) {
      out[parts[1]] = true;
    }
  });

  return out;
}

/**
 * The seeded identifiers a section's fields should carry, by declaration.
 *
 * Read off the pre-handler spellings and LOOKUP_FIXTURES: `folder(payload.folderId)`
 * says `payload.folderId` is a Folder id, so the seeded Folder's id is what
 * belongs there. Nothing is inferred from a field's NAME - only from what the
 * declaration says a pre-handler will do with it - which is why a field called
 * `folderId` that no pre-handler reads is left as the schema describes it.
 *
 * @param {Object} declaration
 * @param {string} section 'payload', 'query' or 'params'.
 * @param {Object} ids The test/parity/seed.js `ids` map.
 * @returns {Object} A key -> seeded identifier map, possibly empty.
 */
function lookupSubstitutions(declaration, section, ids) {
  var pre = declaration.config && declaration.config.pre;
  var out = {};

  if (!Array.isArray(pre) || !ids) {
    return out;
  }

  pre.forEach(function(entry) {
    var spelling = typeof entry === 'string'
      ? entry
      : (isPlainObject(entry) && typeof entry.method === 'string'
        ? entry.method
        : null);
    var parsed;
    var fixture;

    if (!spelling) {
      return;
    }

    parsed = /^(\w+)\(([^)]*)\)$/.exec(spelling);

    if (!parsed) {
      return;
    }

    fixture = LOOKUP_FIXTURES[parsed[1]];

    if (!fixture || ids[fixture] === undefined) {
      return;
    }

    parsed[2].split(',').forEach(function(argument) {
      var parts = argument.trim().split('.');

      if (parts[0] === section && parts[1]) {
        out[parts[1]] = ids[fixture];
      }
    });
  });

  return out;
}

/**
 * Applies the seeded identifiers, keeping only those the schema still accepts.
 *
 * Verified rather than trusted: a substitution that the schema rejected would
 * turn the accepting case into a rejecting one, which is the one thing this
 * file must never record. Each is applied and checked individually, so one
 * field whose schema forbids an ObjectId cannot cost the others.
 *
 * @param {Object} schema The compiled section schema.
 * @param {Object} input The accepting input, modified in place.
 * @param {Object} substitutions From lookupSubstitutions.
 * @param {string} transport From transportFor.
 * @returns {Object} The substitutions that were applied.
 */
function applySubstitutions(schema, input, substitutions, transport) {
  var applied = {};

  Object.keys(substitutions).forEach(function(key) {
    var previous;

    if (!Object.prototype.hasOwnProperty.call(input, key)) {
      // The section does not declare this key; the pre-handler reads something
      // the schema says nothing about, so there is nothing to substitute.
      return;
    }

    previous = input[key];
    input[key] = substitutions[key];

    if (validateLocally(schema, serverVisible(transport, input)).accepted) {
      applied[key] = substitutions[key];
      return;
    }

    input[key] = previous;
  });

  return applied;
}

/**
 * The identity a target's cases are driven as.
 *
 * By rule, not by route, so the choice is reproducible and reviewable:
 *   * any pre-handler spelled `isAdmin(` forces the ADMIN, whatever the route
 *     declares - 9 such uses, several on routes that inherit the default auth;
 *   * a route declaring `auth: 'session'` gets the seeded USER, which owns
 *     every trinket, course, folder and file fixture except the admin-owned
 *     trinket, so the ownership pre-handlers (`canEdit`) succeed;
 *   * anything else is driven ANONYMOUSLY. That is faithful for `mode: 'try'`,
 *     and it keeps the preserved authenticated-visitor 500 on `GET /login` and
 *     `GET /signup` out of a validation measurement - that quirk belongs to
 *     test/lib/api/pages.js, not here.
 *
 * @param {Object} declaration
 * @param {Array.<Object>} pre Descriptors from preDescriptors.
 * @returns {string} One of the IDENTITY_* constants.
 */
function identityFor(declaration, pre) {
  var declaredAuth = declaration.config && declaration.config.auth;
  var i;

  for (i = 0; i < pre.length; i++) {
    if (pre[i].method && pre[i].method.indexOf(ADMIN_PRE) === 0) {
      return IDENTITY_ADMIN;
    }
  }

  if (declaredAuth === 'session' ||
      (isPlainObject(declaredAuth) && declaredAuth.strategy === 'session')) {
    return IDENTITY_USER;
  }

  return IDENTITY_ANONYMOUS;
}

/**
 * Enumerates every validation target from the PRISTINE copy.
 *
 * One target per validate SECTION, not per route: the single `params` target
 * sits on a route that also carries a `query` target, and keying per route
 * would silently drop one of the two. `language` is skipped here and collected
 * separately by languageMaps().
 *
 * The `fail`, `html` and `success` fragments are captured because they decide
 * which branch of `request.fail` a rejection takes, and therefore what this
 * tool must capture: a 302 whose message is held in the session, a rendered
 * `fail.html`, or a JSON body carrying the flash directly.
 *
 * @param {Object} loaded The harvest result.
 * @param {Object} ids The test/parity/seed.js `ids` map, or null.
 * @returns {Array.<Object>} Target records, in declaration order.
 */
function enumerateTargets(loaded, ids) {
  var targets = [];

  loaded.pristine.forEach(function(declaration, index) {
    var validate;
    var info;
    var pre;
    var references;
    var file;

    if (!declaration || typeof declaration.route !== 'string' ||
        !isPlainObject(declaration.config)) {
      return;
    }

    validate = declaration.config.validate;

    if (!isPlainObject(validate)) {
      return;
    }

    info       = routeInfo(declaration);
    pre        = preDescriptors(declaration);
    references = preReferences(declaration);
    file       = loaded.fileOf(index);

    Object.keys(validate).forEach(function(section) {
      if (section === VALIDATE_LANGUAGE_KEY) {
        return;
      }

      targets.push({
        key            : info.method + ' ' + info.path + ' ' + section,
        method         : info.method,
        path           : info.path,
        section        : section,
        file           : file,
        controller     : info.controller,
        declaredAuth   : declaration.config.auth === undefined
          ? null
          : jsonSafe(declaration.config.auth),
        identity       : identityFor(declaration, pre),
        pre            : pre,
        preReferences  : references,
        // The seeded identifiers this section's fields should carry, derived
        // from the pre-handler spellings; see lookupSubstitutions.
        lookupFixtures : lookupSubstitutions(declaration, section, ids),
        fail           : isPlainObject(declaration.fail)
          ? jsonSafe(declaration.fail)
          : null,
        html           : declaration.html === undefined
          ? null
          : jsonSafe(declaration.html),
        success        : isPlainObject(declaration.success)
          ? jsonSafe(declaration.success)
          : null,
        // `payload.output === 'file'` means hapi REPLACES request.payload with
        // a file descriptor, so the DECLARED input cannot reach the schema by
        // any transport. Four routes; see transportFor for the measurement.
        payloadOutput  : declaration.config.payload &&
                         declaration.config.payload.output
          ? String(declaration.config.payload.output)
          : null,
        // The live schema. It is never serialized: it is a Joi object on one
        // section and a plain object on the other 101, and this gate compares
        // real responses rather than descriptions. Every artifact record is
        // assembled through an explicit key list by serializeTarget(), so this
        // field cannot leak into one by accident.
        schemaSource   : validate[section],
        isJoiSchema    : loaded.joi.isSchema(validate[section]),
        languageMap    : isPlainObject(validate[VALIDATE_LANGUAGE_KEY])
          ? jsonSafe(validate[VALIDATE_LANGUAGE_KEY])
          : null
      });
    });
  });

  return targets;
}

/**
 * The `language` maps, collected from the PRISTINE copy.
 *
 * They are not validation targets - the parser deletes them before validating -
 * but PHASE 5 asserts on them, so they are collected by identity and recorded.
 *
 * @param {Object} loaded The harvest result.
 * @returns {Array.<Object>}
 */
function languageMaps(loaded) {
  var maps = [];

  loaded.pristine.forEach(function(declaration, index) {
    var validate;
    var info;

    if (!declaration || typeof declaration.route !== 'string' ||
        !isPlainObject(declaration.config)) {
      return;
    }

    validate = declaration.config.validate;

    if (!isPlainObject(validate) ||
        !isPlainObject(validate[VALIDATE_LANGUAGE_KEY])) {
      return;
    }

    info = routeInfo(declaration);

    maps.push({
      route  : info.method + ' ' + info.path,
      file   : loaded.fileOf(index),
      fields : Object.keys(validate[VALIDATE_LANGUAGE_KEY]),
      map    : jsonSafe(validate[VALIDATE_LANGUAGE_KEY])
    });
  });

  return maps;
}

/**
 * The enumeration split, counted per file and per section.
 *
 * @param {Array.<Object>} targets
 * @param {Array.<Object>} maps
 * @param {Object} loaded
 * @returns {Object}
 */
function buildEnumeration(targets, maps, loaded) {
  var byFile = {};
  var totals = { payload: 0, query: 0, params: 0, other: {} };

  function bucket(file) {
    if (!byFile[file]) {
      byFile[file] = {
        declarations : loaded.byFile[file] || 0,
        blocks       : 0,
        payload      : 0,
        query        : 0,
        params       : 0,
        language     : 0,
        other        : {}
      };
    }
    return byFile[file];
  }

  Object.keys(loaded.byFile).forEach(bucket);

  targets.forEach(function(target) {
    var slot = bucket(target.file);

    if (slot[target.section] === undefined) {
      slot.other[target.section] = (slot.other[target.section] || 0) + 1;
      totals.other[target.section] = (totals.other[target.section] || 0) + 1;
    }
    else {
      slot[target.section] += 1;
      totals[target.section] += 1;
    }
  });

  maps.forEach(function(map) {
    bucket(map.file).language += 1;
  });

  // A block is a route carrying a validate object, counted by distinct
  // method+path so a route with two sections counts once - which is what makes
  // the 15 + 82 = 97 split checkable against a per-section total of 102.
  Object.keys(loaded.byFile).forEach(function(file) {
    var seen = {};

    targets.forEach(function(target) {
      if (target.file !== file) {
        return;
      }
      seen[target.method + ' ' + target.path] = true;
    });

    bucket(file).blocks = Object.keys(seen).length;
  });

  return {
    targets      : targets.length,
    payload      : totals.payload,
    query        : totals.query,
    params       : totals.params,
    otherSections: totals.other,
    languageMaps : maps.length,
    validateBlocks: Object.keys(byFile).reduce(function(sum, file) {
      return sum + byFile[file].blocks;
    }, 0),
    byFile       : byFile
  };
}


/**
 * Fails loudly unless the enumeration is exactly the measured one.
 *
 * The SPLIT is asserted, not just the total: 75 payload, 26 query, 1 params,
 * and the 10/65 and 5/21 per-file distribution beneath it. A total of 102 made
 * up of 76 payload and 25 query would mean a section had moved between routes,
 * which is a change to the HTTP surface that a total alone would conceal.
 *
 * A drift here means either a route module changed or the deep copy is reading
 * post-parse state, and both invalidate the gate - so this is EXIT_ERROR, not a
 * reported difference.
 *
 * @param {Object} enumeration From buildEnumeration.
 * @param {Array.<Object>} maps From languageMaps.
 * @returns {undefined}
 * @throws {ToolError} On any mismatch.
 */
function assertEnumeration(enumeration, maps) {
  var problems = [];

  function check(label, actual, expected) {
    if (actual !== expected) {
      problems.push(label + ': expected ' + expected + ', measured ' + actual);
    }
  }

  check('targets', enumeration.targets, EXPECTED.targets);
  check('payload targets', enumeration.payload, EXPECTED.payload);
  check('query targets', enumeration.query, EXPECTED.query);
  check('params targets', enumeration.params, EXPECTED.params);
  check('validate blocks', enumeration.validateBlocks, EXPECTED.validateBlocks);
  check('language maps', enumeration.languageMaps, EXPECTED.languageMaps);

  Object.keys(enumeration.otherSections).forEach(function(section) {
    problems.push('unexpected validate section `' + section + '` on ' +
      enumeration.otherSections[section] + ' route(s). The hand-rolled block ' +
      'validates request[key] for ARBITRARY keys, so a new section is a real ' +
      'validation target and must be added to EXPECTED deliberately.');
  });

  Object.keys(EXPECTED.byFile).forEach(function(file) {
    var expected = EXPECTED.byFile[file];
    var actual   = enumeration.byFile[file];

    if (!actual) {
      problems.push(file + ': no targets enumerated at all');
      return;
    }

    check(file + ' blocks', actual.blocks, expected.blocks);
    check(file + ' payload', actual.payload, expected.payload);
    check(file + ' query', actual.query, expected.query);
    check(file + ' params', actual.params, expected.params);
    check(file + ' language', actual.language, expected.language);
  });

  maps.forEach(function(map, index) {
    if (map.route !== EXPECTED_LANGUAGE_ROUTES[index]) {
      problems.push('language map ' + index + ' is on ' + map.route +
        ', expected ' + EXPECTED_LANGUAGE_ROUTES[index]);
    }
  });

  if (problems.length) {
    throw new ToolError('the enumeration does not match the measured target ' +
      'set, so the matrix cannot be trusted:\n  - ' + problems.join('\n  - '));
  }
}

/**
 * The deep-copy proof, and the reason this file does not read parsed routes.
 *
 * Asserts BOTH halves. The parsed copy must retain `options.validate` on ZERO
 * routes - which is what makes reading schemas from parsed routes yield nothing
 * - and the pristine copy must still carry all 97 blocks. IF BOTH ARE EMPTY THE
 * PRISTINE COPY IS POST-PARSE STATE: the copy shared a container with the
 * throwaway one, every schema is gone, and a matrix built from it would be
 * empty rather than wrong-looking. The two-sided assertion is the only thing
 * that distinguishes those cases.
 *
 * The `language` deletion is asserted the same way, because the parser deletes
 * it separately and PHASE 5 reads both maps off the pristine copy.
 *
 * @param {Object} loaded The harvest result.
 * @param {Object} enumeration From buildEnumeration.
 * @returns {Object} The proof record, for the artifact.
 * @throws {ToolError} On any mismatch.
 */
function buildDeepCopyProof(loaded, enumeration) {
  var retained = loaded.parsed.filter(function(route) {
    return route && route.options && route.options.validate !== undefined;
  }).length;

  var pristineBlocks = loaded.pristine.filter(function(declaration) {
    return declaration && isPlainObject(declaration.config) &&
      declaration.config.validate !== undefined;
  }).length;

  var pristineLanguage = loaded.pristine.filter(function(declaration) {
    return declaration && isPlainObject(declaration.config) &&
      isPlainObject(declaration.config.validate) &&
      declaration.config.validate[VALIDATE_LANGUAGE_KEY] !== undefined;
  }).length;

  var proof = {
    declaredObjects            : loaded.declaredCount,
    parsedRoutes               : loaded.parsed.length,
    parsedRoutesRetainingValidate: retained,
    pristineValidateBlocks     : pristineBlocks,
    pristineLanguageMaps       : pristineLanguage,
    enumeratedTargets          : enumeration.targets
  };

  if (retained !== EXPECTED.retainedValidate) {
    throw new ToolError('after parsing, ' + retained + ' route(s) still carry ' +
      '`options.validate`; the parser is measured to delete it from every ' +
      'one, so either the parser changed or the throwaway copy was not the ' +
      'object handed to parse().');
  }

  if (pristineBlocks !== EXPECTED.validateBlocks) {
    throw new ToolError('the pristine copy carries ' + pristineBlocks +
      ' validate block(s), expected ' + EXPECTED.validateBlocks + '. ' +
      (pristineBlocks === 0
        ? 'ZERO means the pristine copy IS post-parse state - it shared a ' +
          'container with the copy handed to parse(), so every schema was ' +
          'deleted out from under it.'
        : 'A route module changed.'));
  }

  if (pristineLanguage !== EXPECTED.languageMaps) {
    throw new ToolError('the pristine copy carries ' + pristineLanguage +
      ' `language` map(s), expected ' + EXPECTED.languageMaps +
      '; the parser deletes them separately and PHASE 5 reads both from the ' +
      'pristine copy.');
  }

  if (loaded.declaredCount !== EXPECTED.declared ||
      loaded.parsed.length !== EXPECTED.parsedRoutes) {
    throw new ToolError('the route surface moved: ' + loaded.declaredCount +
      ' declared objects parsing to ' + loaded.parsed.length + ' routes, ' +
      'expected ' + EXPECTED.declared + ' and ' + EXPECTED.parsedRoutes +
      '. test/parity/manifest.js owns that gate; this one cannot run against ' +
      'a surface it does not recognise.');
  }

  return proof;
}

// ---------------------------------------------------------------------------
// PHASE 3 - the schema, and the three cases
// ---------------------------------------------------------------------------

/**
 * The compiled schema for one target's section.
 *
 * Reproduces the application's own decision exactly: `Joi.isSchema(schema)`
 * decides whether the section is already a schema or a plain object that needs
 * `Joi.object(...)` around it. Exactly one of the 102 sections is already a
 * schema - `POST /api/trinkets/{trinketId}/draft payload`, declared as
 * `Joi.object({...}).unknown(true)` - and the other 101 are plain objects. A
 * tool that wrapped unconditionally would produce `Joi.object(<schema>)` for
 * that one and measure something the application never validates.
 *
 * @param {Object} joi The joi resolved from the tree under test.
 * @param {Object} target A target record.
 * @returns {Object} A Joi schema.
 * @throws {ToolError} If the section cannot be compiled.
 */
function compileSection(joi, target) {
  try {
    return joi.isSchema(target.schemaSource)
      ? target.schemaSource
      : joi.object(target.schemaSource);
  }
  catch (err) {
    throw new ToolError('cannot compile the ' + target.section + ' schema of ' +
      target.key + ': ' + (err && err.message ? err.message : String(err)));
  }
}

/**
 * Validates a value the way the application validates it.
 *
 * The SAME call the hand-rolled block makes -
 * `schema.validate(request[key], { abortEarly: false })` - so an "accepting"
 * input this reports as clean is an input the application will also accept, and
 * the error details recorded here are the ones the block would turn into
 * `validationErrors`.
 *
 * @param {Object} schema A Joi schema.
 * @param {*} value
 * @returns {{accepted: boolean, messages: string[], paths: string[],
 *            value: *}}
 */
function validateLocally(schema, value) {
  var result;

  try {
    result = schema.validate(value, { abortEarly: false });
  }
  catch (err) {
    // A throw from validate() is not an accept and not a reject; it is a
    // broken schema, and recording it as a rejection would be a lie.
    return {
      accepted : false,
      messages : ['<validate() threw: ' +
        (err && err.message ? err.message : String(err)) + '>'],
      paths    : [],
      value    : null
    };
  }

  if (!result.error) {
    return {
      accepted : true,
      messages : [],
      paths    : [],
      value    : jsonSafe(result.value)
    };
  }

  return {
    accepted : false,
    messages : result.error.details.map(function(detail) {
      return detail.message;
    }),
    // The dotted paths the block uses as `validationErrors` keys, so a recorded
    // path can be joined against a recorded flash key.
    paths    : result.error.details.map(function(detail) {
      return detail.path.join('.');
    }),
    value    : jsonSafe(result.value)
  };
}

/**
 * The leaf descriptions of a compiled section, in declaration order.
 *
 * Only the top level is walked, because measured over both route modules there
 * is no nested keyed object: the 9 `Joi.object(` leaves carry no keys of their
 * own, and joi's `describe()` reports no `ref`, so there are no cross-field
 * dependencies to satisfy. Each entry carries the live leaf schema, obtained
 * through `schema.extract(key)`, which is what lets a candidate be verified
 * against the REAL schema rather than against this tool's reading of a
 * description.
 *
 * @param {Object} schema A compiled Joi schema.
 * @returns {Array.<{key: string, description: Object, schema: Object,
 *                   required: boolean, type: string}>}
 * @throws {ToolError} If the section is not an object schema.
 */
function describeLeaves(schema) {
  var description;

  try {
    description = schema.describe();
  }
  catch (err) {
    throw new ToolError('schema.describe() failed: ' +
      (err && err.message ? err.message : String(err)));
  }

  if (description.type !== 'object') {
    throw new ToolError('a validate section compiled to a `' +
      description.type + '` schema rather than an object; the hand-rolled ' +
      'block validates request[key], which is always an object, so this tool ' +
      'has no model for that shape.');
  }

  return Object.keys(description.keys || {}).map(function(key) {
    var leafDescription = description.keys[key];
    var leafSchema;

    try {
      leafSchema = schema.extract(key);
    }
    catch (err) {
      throw new ToolError('cannot extract the `' + key + '` leaf: ' +
        (err && err.message ? err.message : String(err)));
    }

    return {
      key         : key,
      description : leafDescription,
      schema      : leafSchema,
      type        : leafDescription.type,
      required    : leafDescription.flags &&
                    leafDescription.flags.presence === 'required'
    };
  });
}

/**
 * The rules of a leaf description, as a name -> args map.
 *
 * @param {Object} description A joi leaf description.
 * @returns {Object}
 */
function rulesOf(description) {
  var out = {};

  (description.rules || []).forEach(function(rule) {
    out[rule.name] = rule.args || {};
  });

  return out;
}

/**
 * The length a generated string should have to satisfy a leaf's bounds.
 *
 * `length` wins outright; otherwise the default is raised to `min` and lowered
 * to `max`. One number covers every measured combination - min(3).max(20),
 * max(140), max(500), length(6) - and the result is verified against the leaf
 * anyway, so a bound this misreads becomes a candidate that fails rather than
 * an input recorded as accepting.
 *
 * @param {Object} rules From rulesOf.
 * @returns {number}
 */
function targetLength(rules) {
  var length = DEFAULT_STRING_LENGTH;

  if (rules.length && typeof rules.length.limit === 'number') {
    return rules.length.limit;
  }

  if (rules.min && typeof rules.min.limit === 'number') {
    length = Math.max(length, rules.min.limit);
  }

  if (rules.max && typeof rules.max.limit === 'number') {
    length = Math.min(length, rules.max.limit);
  }

  return Math.max(length, 1);
}

/**
 * `count` copies of the safe filler character.
 *
 * @param {number} count
 * @returns {string}
 */
function filler(count) {
  return new Array(Math.max(0, count) + 1).join(FILLER);
}


/**
 * Removes duplicates from a candidate list, comparing by JSON form.
 *
 * @param {Array.<*>} values
 * @returns {Array.<*>}
 */
function dedupe(values) {
  var seen = {};

  return values.filter(function(value) {
    var key = canonical(value);

    if (seen[key]) {
      return false;
    }

    seen[key] = true;

    return true;
  });
}

/**
 * An ordered list of candidate values for one joi description.
 *
 * Description-driven and recursive, so it handles the array items and the
 * alternatives branches as well as the top-level leaves. NOTHING here is
 * trusted: every candidate is verified against the REAL leaf schema by the
 * caller, so a rule this misreads costs a candidate and not a wrong answer.
 *
 * `.valid(...)` is absolute - `flags.only` means the allow list IS the domain,
 * and offering a type candidate beside it would only ever produce a rejection
 * recorded as an acceptance attempt. `.allow(...)` extras go LAST, so a real
 * value is preferred over the 27 measured `.allow('')` empty strings: an empty
 * string is a valid input, but an accepting case built entirely from empty
 * strings would exercise nothing downstream.
 *
 * @param {Object} description A joi description.
 * @returns {Array.<*>}
 */
function candidatesFor(description) {
  var flags = description.flags || {};
  var rules = rulesOf(description);
  var allow = Array.isArray(description.allow) ? description.allow : [];
  var invalid = Array.isArray(description.invalid) ? description.invalid : [];
  var out = [];
  var length;
  var inner;

  if (flags.only) {
    return dedupe(allow.filter(function(value) {
      return value !== undefined && value !== null && value !== '';
    }).concat(allow));
  }

  switch (description.type) {
    case 'string':
      length = targetLength(rules);

      if (rules.email) {
        out.push('parity@example.com');
        out.push('a@b.co');
      }
      if (rules.uri) {
        out.push('http://example.com/parity');
      }
      if (rules.guid || rules.uuid) {
        out.push('00000000-0000-4000-8000-000000000000');
      }
      if (rules.hex) {
        out.push(filler(length));
      }

      out.push(filler(length));
      out.push(filler(DEFAULT_STRING_LENGTH));
      out.push('parity');
      out.push(FILLER);
      break;

    case 'number':
      if (rules.min && typeof rules.min.limit === 'number') {
        out.push(rules.min.limit);
      }
      if (rules.max && typeof rules.max.limit === 'number') {
        out.push(rules.max.limit);
      }
      out.push(1);
      out.push(0);
      out.push(42);
      break;

    case 'boolean':
      out.push(true);
      out.push(false);
      break;

    case 'array':
      inner = (description.items || []).length
        ? candidatesFor(description.items[0])
        : [];
      if (inner.length) {
        out.push([inner[0]]);
      }
      out.push([]);
      break;

    case 'object':
      out.push({});
      break;

    case 'alternatives':
      (description.matches || []).forEach(function(match) {
        if (match.schema) {
          out = out.concat(candidatesFor(match.schema));
        }
      });
      break;

    case 'date':
      out.push('2024-01-01T00:00:00.000Z');
      break;

    case 'binary':
      out.push('cGFyaXR5');
      break;

    case 'any':
      // The 4 `Joi.any().required()` upload fields. A non-empty string
      // satisfies the schema, which is what the local proof measures; what
      // reaches the SERVER on those routes is settled by transportFor.
      out.push('parity-any-value');
      break;

    default:
      // No model for this type. Returning nothing makes the leaf report itself
      // unsatisfiable, which is a reviewable undrivable case rather than a
      // silently wrong input.
      break;
  }

  // A value the schema NAMES through `.allow(...)` is a better witness than a
  // generated one, so a non-empty named value goes AHEAD of the type
  // candidates. Measured over both route modules, exactly two leaves are
  // affected - the string and array-item branches of the one
  // `Joi.alternatives()` target, both `.allow('_owner')` - and the effect there
  // is the point: `GET /api/courses/{courseId}` carries the string pre-handler
  // `populate(pre.course, query.with)`, so an arbitrary valid string makes
  // mongoose populate a path that does not exist and the request answers 500
  // BEFORE the validation block runs. '_owner' is a path that does exist.
  //
  // The 27 `.allow('')` leaves are unaffected, because the empty string is
  // excluded here and appended below with the rest: it is a valid input, but an
  // accepting case built out of empty strings exercises nothing downstream.
  out = allow.filter(function(value) {
    return value !== undefined && value !== null && value !== '';
  }).concat(out);

  allow.forEach(function(value) {
    if (value === undefined) {
      return;
    }
    out.push(value);
  });

  return dedupe(out).filter(function(value) {
    // A candidate that the schema explicitly forbids is not a candidate. The
    // two `username` leaves forbid 51 reserved names, and 'aaa' is not among
    // them - but the filter is applied rather than assumed, because the list
    // is read from config/reserved.yaml at load and could grow.
    return invalid.every(function(forbidden) {
      return canonical(forbidden) !== canonical(value);
    });
  });
}

/**
 * The first candidate at or after `from` that the leaf's own schema accepts.
 *
 * Verification is against `schema.extract(key)` - the real leaf - and not
 * against this tool's reading of the description, which is what makes the
 * five measured `.regex(...)` patterns satisfiable without interpreting a
 * regex: '/^[a-z][a-z0-9\-\_]*$/i', the password character class and
 * '/[0-9a-f]/' are all satisfied by a run of the filler character, and joi is
 * asked whether that is true rather than told.
 *
 * @param {Object} leaf From describeLeaves.
 * @param {number} from Index to start from.
 * @param {string} transport From transportFor.
 * @returns {{ok: boolean, value: *, index: number, tried: number}}
 */
function pickCandidate(leaf, from, transport) {
  var candidates = candidatesFor(leaf.description);
  var i;
  var outcome;

  for (i = Math.max(0, from); i < candidates.length; i++) {
    if (candidates[i] === undefined) {
      continue;
    }

    // Verified AS THE TRANSPORT WILL DELIVER IT. On a query string the
    // candidate `1` is validated as '1', which is what request.query holds and
    // therefore what the application's own validate call sees.
    outcome = validateLocally(leaf.schema, projectValue(transport, candidates[i]));

    if (outcome.accepted) {
      return { ok: true, value: candidates[i], index: i, tried: candidates.length };
    }
  }

  return { ok: false, value: undefined, index: candidates.length, tried: candidates.length };
}

/**
 * Builds a COMPLETE accepting input, refining against joi's own error paths.
 *
 * Every key of the section is supplied, optional ones included, because a
 * partial object fails for the wrong reason: a required sibling missing from
 * the payload produces `"x" is required`, and a case recorded as "accepting"
 * that the schema rejects is the most likely silent defect this file could
 * carry. That is why the assembled object is verified through the application's
 * own `schema.validate(value, {abortEarly:false})` call and, if it fails, why
 * the failing keys are advanced to their next candidate and it is verified
 * again.
 *
 * A key whose candidates are exhausted is DROPPED if it is optional and
 * RECORDED either way, so the outcome is an input with a stated shortcoming
 * rather than a quietly rejecting "accepting" case.
 *
 * @param {Object} schema The compiled section schema.
 * @param {Array.<Object>} leaves From describeLeaves.
 * @param {string} transport From transportFor.
 * @returns {{input: Object, rounds: number, notes: string[],
 *            perLeaf: Object, satisfied: boolean}}
 */
function buildAcceptingInput(schema, leaves, transport) {
  var input = {};
  var index = {};
  var perLeaf = {};
  var notes = [];
  var dropped = {};
  var rounds = 0;
  var outcome;
  var advanced;

  leaves.forEach(function(leaf) {
    var picked = pickCandidate(leaf, 0, transport);

    index[leaf.key] = picked.index;
    perLeaf[leaf.key] = {
      type          : leaf.type,
      required      : !!leaf.required,
      candidateIndex: picked.ok ? picked.index : null,
      candidates    : picked.tried
    };

    if (picked.ok) {
      input[leaf.key] = picked.value;
      return;
    }

    dropped[leaf.key] = true;
    notes.push('no candidate value satisfied the `' + leaf.key + '` leaf (' +
      leaf.type + '), so it was omitted from the accepting input');
  });

  outcome = validateLocally(schema, serverVisible(transport, input));

  while (!outcome.accepted && rounds < MAX_REFINEMENT_ROUNDS) {
    rounds += 1;
    advanced = false;

    outcome.paths.forEach(function(dotted) {
      var key = dotted.split('.')[0];
      var leaf;
      var picked;

      if (!key || dropped[key]) {
        return;
      }

      leaf = leaves.filter(function(candidate) {
        return candidate.key === key;
      })[0];

      if (!leaf) {
        // A path outside the declared keys means the object rejected something
        // this tool put there, which can only be an unknown key it did not
        // add. Recorded rather than guessed at.
        notes.push('the schema reported an error on `' + dotted +
          '`, which is not a declared key of this section');
        return;
      }

      picked = pickCandidate(leaf, index[key] + 1, transport);
      index[key] = picked.index;

      if (picked.ok) {
        input[key] = picked.value;
        perLeaf[key].candidateIndex = picked.index;
        advanced = true;
        return;
      }

      if (leaf.required) {
        notes.push('the required `' + key + '` leaf (' + leaf.type + ') has no ' +
          'candidate the schema accepts in combination with its siblings');
        return;
      }

      delete input[key];
      dropped[key] = true;
      perLeaf[key].candidateIndex = null;
      advanced = true;
      notes.push('the optional `' + key + '` leaf was dropped after its ' +
        'candidates were exhausted in combination with its siblings');
    });

    if (!advanced) {
      break;
    }

    outcome = validateLocally(schema, serverVisible(transport, input));
  }

  return {
    input     : input,
    rounds    : rounds,
    notes     : notes,
    perLeaf   : perLeaf,
    satisfied : outcome.accepted
  };
}


/**
 * The order leaves are tried in when looking for a rejection.
 *
 * A regex violation is preferred, because that is where the joi message text
 * was measured and where PHASE 5's inertness assertion lives: the two
 * `username` leaves must reject through their pattern so the recorded message
 * is the one whose absence of the substring "regular expression" proves the
 * `language` maps inert. `.invalid(...)` is next - the 51-entry reserved list -
 * then `.valid(...)`, then `email`, then the bounds, then a type mismatch.
 *
 * @param {Object} leaf
 * @returns {number} Lower sorts first.
 */
function rejectionPriority(leaf) {
  var rules = rulesOf(leaf.description);
  var flags = leaf.description.flags || {};

  if (rules.pattern) {
    return 0;
  }
  if (Array.isArray(leaf.description.invalid) && leaf.description.invalid.length) {
    return 1;
  }
  if (flags.only) {
    return 2;
  }
  if (rules.email) {
    return 3;
  }
  if (rules.max || rules.min || rules.length) {
    return 4;
  }

  return 5;
}

/**
 * Candidate violations for one leaf, most specific first.
 *
 * Each entry names the strategy so the artifact records WHY an input rejects
 * and not merely that it does - which is what lets a reviewer see that the two
 * `username` targets reject through their pattern rather than through a
 * reserved name or a missing sibling.
 *
 * `any` leaves are skipped deliberately: `Joi.any()` accepts every value,
 * including `null` and an object, so there is no violation to construct. The
 * four upload fields are `any`, and their targets reject through a sibling or
 * through an unknown key instead.
 *
 * @param {Object} leaf
 * @returns {Array.<{strategy: string, value: *, omit: boolean}>}
 */
function violationsFor(leaf) {
  var description = leaf.description;
  var rules = rulesOf(description);
  var flags = description.flags || {};
  var allow = Array.isArray(description.allow) ? description.allow : [];
  var invalid = Array.isArray(description.invalid) ? description.invalid : [];
  var out = [];

  function push(strategy, value) {
    out.push({ strategy: strategy, value: value, omit: false });
  }

  if (description.type === 'any' && !flags.only && !invalid.length) {
    return [];
  }

  if (rules.pattern) {
    // '9bad' is the measured violator: it produces
    // `"username" with value "9bad" fails to match the required pattern: /.../`
    // on both joi 17.13.3 and 18.2.5, which is the exact string PHASE 5's
    // inertness assertion is about.
    push('pattern', '9bad');
    push('pattern', '!!!');
    push('pattern', 'ZZ 99 !!');
  }

  if (invalid.length) {
    invalid.slice(0, 3).forEach(function(value) {
      push('invalid-value', value);
    });
  }

  if (flags.only) {
    push('not-a-valid-value', 'parity-not-a-valid-value');
  }

  if (rules.email) {
    push('not-an-email', 'not-an-email');
  }

  if (rules.max && typeof rules.max.limit === 'number') {
    push('over-max', filler(rules.max.limit + 1));
  }

  if (rules.length && typeof rules.length.limit === 'number') {
    push('wrong-length', filler(rules.length.limit + 1));
  }

  if (rules.min && typeof rules.min.limit === 'number' && rules.min.limit > 0) {
    push('under-min', filler(rules.min.limit - 1));
  }

  // OMITTING A REQUIRED LEAF COMES BEFORE THE TYPE MISMATCHES, and the reason
  // is the lifecycle order this whole file turns on: PRE-HANDLERS RUN BEFORE
  // THE VALIDATION BLOCK. `lib/util/helpers.js`'s `lowerUserFields` does
  // `request.payload[field].trim().toLowerCase()` for any TRUTHY email or
  // username, so an object substituted for `email` on `POST /login` throws a
  // TypeError in the pre-handler and the request answers 500 having never
  // reached validation. Measured: with `email` merely ABSENT the same route
  // answers 302 and the followed `/login` renders `"email" is required`.
  //
  // An omission is also the more faithful violation: it is what a real client
  // gets wrong. A type mismatch is kept as the fallback for a leaf that is
  // optional and otherwise unconstrained, where nothing else can violate it.
  if (leaf.required) {
    out.push({ strategy: 'omit-required', value: undefined, omit: true });
  }

  // A type mismatch. An object is used against string, number, boolean and
  // array leaves because joi's `convert: true` cannot coerce one into any of
  // them - measured: `"value" must be a string`, `must be a number`, `must be
  // a boolean`, `must be an array`. Against an object leaf a non-JSON string
  // is used instead, because joi WILL parse a JSON string into an object.
  if (description.type === 'object') {
    push('wrong-type', 'parity-not-json');
  }
  else if (description.type !== 'any') {
    push('wrong-type', { parityWrongType: true });
  }

  if (allow.indexOf(null) === -1 && description.type !== 'any') {
    push('null-value', null);
  }

  return out;
}

/**
 * Builds a rejecting input: the accepting input with exactly one violation.
 *
 * One violation, not several, so the recorded joi message set is attributable
 * to a single cause. Every candidate is verified through the application's own
 * validate call and must produce an error; the first that does is taken, in the
 * leaf order rejectionPriority defines.
 *
 * Two object-level fallbacks follow the per-leaf ladder, for a section whose
 * every leaf is optional and permissive:
 *   * an UNKNOWN KEY, which the 101 plain-object sections reject outright
 *     because `Joi.object({...})` disallows unknown keys by default;
 *   * replacing the whole value with a non-object, which every object schema
 *     rejects.
 * The one section declared `Joi.object({...}).unknown(true)` is immune to the
 * first and answers to the second.
 *
 * @param {Object} schema The compiled section schema.
 * @param {Array.<Object>} leaves From describeLeaves.
 * @param {Object} accepting The accepting input.
 * @param {string} transport From transportFor.
 * @param {Object} referenced Keys a string pre-handler dereferences, from
 *   referencedKeys; those leaves are tried last.
 * @returns {{ok: boolean, input: *, strategy: (string|null),
 *            field: (string|null), attempts: number,
 *            determination: (string|null), reason: (string|null)}}
 */
function buildRejectingInput(schema, leaves, accepting, transport, referenced) {
  var referencedSet = referenced || {};
  var fallbacks = shapeFallbacks(transport);
  var attempts = 0;
  var chosen = null;
  var ordered;
  var unreferenced;
  var steeredAround;

  ordered = leaves.slice().sort(function(a, b) {
    var difference = rejectionPriority(a) - rejectionPriority(b);

    // Declaration order breaks a tie, so the choice is reproducible rather
    // than dependent on the sort's stability.
    return difference !== 0
      ? difference
      : leaves.indexOf(a) - leaves.indexOf(b);
  });

  // A leaf a string pre-handler dereferences is tried LAST, and the unknown-key
  // fallback is tried before it. See preReferences: a pre-handler runs before
  // the validation block, so violating a field it reads answers 400 or 404
  // from the pre-handler and the block never executes. Adding an unknown key
  // instead leaves every declared field valid, so every pre-handler succeeds
  // and the block rejects on the unknown key - which is a real validation
  // outcome on a route that would otherwise contribute none.
  unreferenced  = ordered.filter(function(leaf) {
    return !referencedSet[leaf.key];
  });
  steeredAround = ordered.filter(function(leaf) {
    return !!referencedSet[leaf.key];
  });

  function tryLeaf(leaf) {
    return violationsFor(leaf).some(function(violation) {
      var candidate;
      var outcome;

      // A violation this transport cannot deliver is not a violation. See
      // isDeliverable: an empty or absent path segment fails to match the
      // route rather than reaching the validation block.
      if (!isDeliverable(transport, violation)) {
        return false;
      }

      candidate = deepCopy(accepting);

      if (violation.omit) {
        delete candidate[leaf.key];
      }
      else {
        candidate[leaf.key] = violation.value;
      }

      attempts += 1;
      // Verified AS THE TRANSPORT WILL DELIVER IT, for the reason
      // projectValue states: an object substituted into a query string arrives
      // as a JSON string, which a plain Joi.string() accepts, so a violator
      // verified in the declared-type domain would be recorded as rejecting
      // and would in fact be accepted.
      outcome = validateLocally(schema, serverVisible(transport, candidate));

      if (!outcome.accepted) {
        chosen = {
          input    : candidate,
          strategy : violation.strategy,
          field    : leaf.key
        };
        return true;
      }

      return false;
    });
  }

  function tryFallback(strategy, available, build) {
    var candidate;
    var outcome;

    if (chosen || !available) {
      return;
    }

    candidate = build();

    attempts += 1;
    outcome = validateLocally(schema, serverVisible(transport, candidate));

    if (!outcome.accepted) {
      chosen = {
        input    : candidate,
        strategy : strategy,
        field    : null
      };
    }
  }

  unreferenced.some(tryLeaf);

  // A client can add a query parameter or a body key, but not a route
  // parameter: hapi assembles request.params from the path the route declares.
  tryFallback('unknown-key', fallbacks.unknownKey, function() {
    var candidate = deepCopy(accepting);
    candidate.parityUnknownKey = 'parity';
    return candidate;
  });

  if (!chosen) {
    steeredAround.some(tryLeaf);
  }

  // Only a JSON body can be something other than an object; request.query and
  // request.params always are one.
  tryFallback('not-an-object', fallbacks.nonObject, function() {
    return 'parity-not-an-object';
  });

  if (!chosen) {
    // No leaf violation held, and the shape fallbacks that would have held were
    // not deliverable by this transport. That is a fact about the transport,
    // not a gap: it is the single `params` target, whose section is
    // { courseId: Joi.string().required() } and whose value is a path segment.
    return {
      ok       : false,
      input    : null,
      strategy : null,
      field    : null,
      attempts : attempts,
      determination : fallbacks.unknownKey || fallbacks.nonObject
        ? DETERMINATION_UNRESOLVED
        : DETERMINATION_TRANSPORT,
      reason   : fallbacks.unknownKey || fallbacks.nonObject
        ? 'no input rejected after ' + attempts + ' attempt(s) across every ' +
          'leaf violation and the ' +
          (fallbacks.nonObject ? 'two' : 'one') + ' shape fallback(s) this ' +
          'transport can deliver'
        : 'no leaf of this section can be violated - every non-empty value ' +
          'satisfies it - and the transport is `' + transport + '`, so a ' +
          'client can neither add a key nor make the value anything but an ' +
          'object: hapi assembles request.params from the segments the route ' +
          'declares. There is no request that makes this target reject.'
    };
  }

  return {
    ok       : true,
    input    : chosen.input,
    strategy : chosen.strategy,
    field    : chosen.field,
    attempts : attempts,
    determination : null,
    reason   : null
  };
}

/**
 * Builds a coercion input, or states why the section admits none.
 *
 * Genuine coercion under joi's default `convert: true` lives on the BOOLEAN and
 * NUMBER leaves: measured, `'true'` becomes `true` and `'42'` becomes `42`,
 * while a string leaf given a number is REJECTED rather than converted
 * (`"value" must be a string`). So a section whose leaves are all string, any,
 * array or object admits no coercion, and that is recorded as N/A WITH THE LEAF
 * TYPES THAT MADE IT SO rather than as an absent case.
 *
 * Acceptance alone is not evidence: the case also asserts that the value joi
 * RETURNED differs in type from the value sent, which is what distinguishes a
 * coercion from a schema that simply happens to allow a string.
 *
 * @param {Object} schema The compiled section schema.
 * @param {Array.<Object>} leaves From describeLeaves.
 * @param {Object} accepting The accepting input.
 * @param {string} transport From transportFor.
 * @returns {{ok: boolean, input: *, field: (string|null), sent: *,
 *            coercedTo: *, reason: (string|null),
 *            determination: (string|null)}}
 */
function buildCoercionInput(schema, leaves, accepting, transport) {
  var coercible = leaves.filter(function(leaf) {
    return leaf.type === 'boolean' || leaf.type === 'number';
  });
  var types = {};
  var chosen = null;

  leaves.forEach(function(leaf) {
    types[leaf.type] = (types[leaf.type] || 0) + 1;
  });

  if (!coercible.length) {
    return {
      ok        : false,
      input     : NOT_APPLICABLE,
      field     : null,
      sent      : null,
      coercedTo : null,
      determination: DETERMINATION_SCHEMA,
      reason    : 'the section declares no boolean and no number leaf, and ' +
        'joi\'s convert:true does not coerce into the types it does declare ' +
        '(' + (Object.keys(types).sort().join(', ') || 'no leaves') + '): a ' +
        'string leaf given a number is rejected, not converted. There is no ' +
        'coercion input for this target.'
    };
  }

  coercible.some(function(leaf) {
    var rules = rulesOf(leaf.description);
    var sent;
    var candidate;
    var outcome;

    if (leaf.type === 'boolean') {
      sent = 'true';
    }
    else if (rules.max && typeof rules.max.limit === 'number' &&
             rules.max.limit < 42) {
      sent = String(rules.max.limit);
    }
    else if (rules.min && typeof rules.min.limit === 'number' &&
             rules.min.limit > 42) {
      sent = String(rules.min.limit);
    }
    else {
      sent = '42';
    }

    candidate = deepCopy(accepting);
    candidate[leaf.key] = sent;

    outcome = validateLocally(schema, serverVisible(transport, candidate));

    if (!outcome.accepted) {
      return false;
    }

    if (!isPlainObject(outcome.value) ||
        typeof outcome.value[leaf.key] === 'string') {
      // Accepted but not converted. Recording this as a coercion case would
      // claim something the measurement does not support.
      return false;
    }

    chosen = {
      field     : leaf.key,
      sent      : sent,
      coercedTo : outcome.value[leaf.key],
      input     : candidate
    };

    return true;
  });

  if (!chosen) {
    return {
      ok        : false,
      input     : NOT_APPLICABLE,
      field     : null,
      sent      : null,
      coercedTo : null,
      // The tool had a coercible leaf and still produced nothing, which is a
      // failure of this tool rather than a fact about the schema.
      determination: DETERMINATION_UNRESOLVED,
      reason    : 'the section declares ' + coercible.length + ' boolean or ' +
        'number leaf/leaves, but none of them accepted its string form in ' +
        'combination with its siblings, or the value came back unconverted. ' +
        'No coercion input could be constructed that the schema both accepts ' +
        'and converts.'
    };
  }

  return {
    ok        : true,
    input     : chosen.input,
    field     : chosen.field,
    sent      : chosen.sent,
    coercedTo : chosen.coercedTo,
    determination: null,
    reason    : null
  };
}


// ---------------------------------------------------------------------------
// Transport - how a section's value reaches the schema
// ---------------------------------------------------------------------------

/**
 * The transport a section's value travels by.
 *
 * `payload` becomes a request BODY, `query` a QUERY STRING and `params` a PATH
 * SEGMENT - which is the prompt's requirement and also a fact about what the
 * schema will see. The four routes declaring `payload.output === 'file'` are
 * MULTIPART: with that option hapi replaces `request.payload` with a file
 * descriptor, so a JSON body would never reach the declared schema at all and
 * the recorded outcome would be about hapi's payload processing instead of
 * about joi.
 *
 * @param {Object} target A target record.
 * @returns {string}
 */
function transportFor(target) {
  if (target.section === 'query') {
    return 'query-string';
  }

  if (target.section === 'params') {
    return 'path-segment';
  }

  if (target.section === 'payload') {
    // A JSON body for every payload target, INCLUDING the four routes
    // declaring `payload.output: 'file'`, and that is a measurement rather
    // than a convenience. `route.options.payload.multipart` defaults to FALSE
    // in hapi 19 and later, and none of the four sets it - so a
    // multipart/form-data request to them answers 415 Unsupported Media Type
    // and the validation block never runs. Measured: all 8 drives of those
    // four targets answered 415 when this tool sent multipart.
    //
    // With `output: 'file'` hapi writes the body to a file and replaces
    // request.payload with a DESCRIPTOR - {filename, path, bytes, headers} -
    // so the declared schema cannot be satisfied by any request at all. A JSON
    // body at least reaches the validation block, which then measures the
    // schema against that descriptor; the target's `payloadOutput` field marks
    // the four so a reader is not left to infer it, and the local schema proof
    // remains the evidence about the DECLARED input.
    return 'json-body';
  }

  // The hand-rolled block validates request[key] for arbitrary keys, so a
  // section this tool has no transport for is reported rather than guessed at.
  return 'unsupported';
}

/**
 * True when the transport carries text only, so every value arrives a string.
 *
 * @param {string} transport From transportFor.
 * @returns {boolean}
 */
function isTextTransport(transport) {
  return transport === 'query-string' || transport === 'path-segment';
}

/**
 * One value as the transport will deliver it.
 *
 * The single place the text transports are modelled, used BOTH for the whole
 * input and for one candidate value - which is what keeps the per-leaf search
 * and the whole-object proof measuring the same thing. Getting this wrong in
 * one of the two places is not a cosmetic bug: a violator built in the
 * declared-type domain, say an object where a string belongs, becomes the
 * STRING `{"parityWrongType":true}` in a query string, which a plain
 * `Joi.string()` accepts - so the case would be recorded as rejecting and would
 * in fact be accepted, and the reject half of the matrix would be vacuous for
 * all 26 query targets and the 1 params target.
 *
 * Arrays become repeated keys, which `querystring.parse` returns as an array;
 * a plain object is JSON-encoded, which is the only way a client can put one in
 * a query string and the form joi's `convert: true` parses back; and null
 * becomes '' because that is what `querystring.stringify` emits and
 * `querystring.parse` reads back.
 *
 * @param {string} transport From transportFor.
 * @param {*} value
 * @returns {*}
 */
function projectValue(transport, value) {
  if (!isTextTransport(transport) || value === undefined) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(function(entry) {
      return isPlainObject(entry) || Array.isArray(entry)
        ? JSON.stringify(entry)
        : String(entry);
    });
  }

  if (isPlainObject(value)) {
    return JSON.stringify(value);
  }

  if (value === null) {
    return '';
  }

  return String(value);
}

/**
 * The value the SERVER will see, given the transport.
 *
 * This is the honest half of the input record. A query string and a path
 * segment carry only text, so `request.query.index` is the STRING '42' however
 * the generator spelled it, and the local schema proof therefore runs on the
 * stringified form - because that is what the application validates. A JSON
 * body preserves types, so for a payload target the two forms are identical.
 *
 * @param {string} transport From transportFor.
 * @param {*} input
 * @returns {*}
 */
function serverVisible(transport, input) {
  var out;

  if (!isTextTransport(transport) || !isPlainObject(input)) {
    return input;
  }

  out = {};

  Object.keys(input).forEach(function(key) {
    if (input[key] === undefined) {
      return;
    }

    out[key] = projectValue(transport, input[key]);
  });

  return out;
}

/**
 * What a client of this transport is able to change about the value's SHAPE.
 *
 * The rejecting ladder ends with two object-level fallbacks - an unknown key,
 * and replacing the whole value with a non-object - and neither is available on
 * every transport. `request.params` is assembled by hapi from the route's own
 * declared segments, so a client can neither add a parameter nor make the
 * params anything but an object; `request.query` is always an object but a
 * client CAN add a parameter; a JSON body is entirely the client's. Offering a
 * fallback the transport cannot deliver would record a rejection that no
 * request could ever produce, which is exactly the kind of unreachable case the
 * prompt's "record it with a reason" clause exists to prevent.
 *
 * @param {string} transport From transportFor.
 * @returns {{unknownKey: boolean, nonObject: boolean}}
 */
function shapeFallbacks(transport) {
  return {
    unknownKey : transport !== 'path-segment',
    nonObject  : transport === 'json-body'
  };
}

/**
 * Whether a transport can actually deliver one leaf violation.
 *
 * A path segment is the constrained case, and the constraint is not cosmetic.
 * A segment cannot be OMITTED and cannot be EMPTY: `/x/{id}` with nothing where
 * the id belongs does not reach the handler with an empty `request.params.id`,
 * it FAILS TO MATCH THE ROUTE and answers 404. So an empty string - which is
 * what `Joi.string().required()` rejects, and therefore the one violator the
 * ladder would otherwise find for the single `params` target - is an
 * UNREACHABLE case. Recording it would claim a validation rejection that no
 * request can produce, which is exactly what the prompt's "record that
 * reasoning rather than inventing an unreachable case" clause forbids.
 *
 * A query parameter has neither constraint: `?page=` delivers '' and leaving it
 * out delivers nothing, and both reach the validation block.
 *
 * @param {string} transport From transportFor.
 * @param {{strategy: string, value: *, omit: boolean}} violation
 * @returns {boolean}
 */
function isDeliverable(transport, violation) {
  var projected;

  if (transport !== 'path-segment') {
    return true;
  }

  if (violation.omit) {
    return false;
  }

  projected = projectValue(transport, violation.value);

  return typeof projected === 'string' && projected !== '';
}

// ---------------------------------------------------------------------------
// Case assembly
// ---------------------------------------------------------------------------

/**
 * The reviewed reason a case is undrivable, or null.
 *
 * @param {string} targetKey
 * @param {string} kind
 * @returns {(string|null)}
 */
function reviewedReason(targetKey, kind) {
  var match = REVIEWED_UNDRIVABLE.filter(function(entry) {
    return entry.target === targetKey && entry.kind === kind;
  })[0];

  return match ? match.reason : null;
}

/**
 * Builds the three cases for one target.
 *
 * Every target gets three case records - always three, with `applicable: false`
 * and a REASON where a case is genuinely inapplicable. A silently missing case
 * would make the matrix look complete while proving less than it claims, so the
 * count is asserted downstream rather than trusted here.
 *
 * @param {Object} joi The joi from the tree under test.
 * @param {Object} target A target record.
 * @returns {{cases: Array.<Object>, schema: Object, leaves: Array.<Object>}}
 * @throws {ToolError} If the section cannot be compiled or described.
 */
function buildCases(joi, target) {
  var schema    = compileSection(joi, target);
  var leaves    = describeLeaves(schema);
  var transport = transportFor(target);
  var accepting = buildAcceptingInput(schema, leaves, transport);
  var seeded    = applySubstitutions(schema, accepting.input,
    target.lookupFixtures, transport);
  var rejecting = buildRejectingInput(schema, leaves, accepting.input, transport,
    referencedKeys(target.preReferences, target.section));
  var coercion  = buildCoercionInput(schema, leaves, accepting.input, transport);
  var cases     = [];

  function record(kind, applicable, input, reason, extra) {
    var visible = applicable ? serverVisible(transport, input) : null;
    var entry = {
      kind          : kind,
      applicable    : applicable,
      reason        : reason,
      transport     : transport,
      input         : applicable ? jsonSafe(input) : NOT_APPLICABLE,
      // Recorded only when the transport changed it, so the artifact stays
      // readable and a difference here means the transport model moved.
      serverVisible : applicable && canonical(visible) !== canonical(input)
        ? jsonSafe(visible)
        : null,
      schema        : applicable
        ? validateLocally(schema, visible)
        : null
    };

    Object.keys(extra || {}).forEach(function(key) {
      entry[key] = extra[key];
    });

    cases.push(entry);
  }

  record(
    CASE_ACCEPTING,
    true,
    accepting.input,
    null,
    {
      determination     : null,
      // Which fields carry a seeded identifier rather than a schema-derived
      // value, and what it is. Recorded so a reader can see it in the artifact
      // instead of wondering why one field looks like an ObjectId.
      seededFields      : seeded,
      leafPlan          : accepting.perLeaf,
      refinementRounds  : accepting.rounds,
      generatorNotes    : accepting.notes,
      // The claim this case makes, recorded as a claim so the assertion pass
      // can check it rather than infer it.
      claimsAcceptance  : true
    }
  );

  if (rejecting.ok) {
    record(
      CASE_REJECTING,
      true,
      rejecting.input,
      null,
      {
        strategy         : rejecting.strategy,
        field            : rejecting.field,
        attempts         : rejecting.attempts,
        determination    : null,
        claimsAcceptance : false
      }
    );
  }
  else {
    record(
      CASE_REJECTING,
      false,
      null,
      // The authored reasoning wins when there is one - the prompt asks for
      // the params target's reasoning to be recorded, not merely derived - and
      // the derived reason stands behind it for anything new.
      reviewedReason(target.key, CASE_REJECTING) || rejecting.reason,
      {
        strategy         : null,
        field            : null,
        attempts         : rejecting.attempts,
        determination    : rejecting.determination,
        reviewed         : !!reviewedReason(target.key, CASE_REJECTING),
        claimsAcceptance : false
      }
    );
  }

  if (coercion.ok) {
    record(
      CASE_COERCION,
      true,
      coercion.input,
      isTextTransport(transport)
        ? 'every value in a query string or a path segment is already text, so ' +
          'the accepting case is transported in the same coerced form; this ' +
          'case pins the conversion at the schema level and records what joi ' +
          'returned.'
        : null,
      {
        field            : coercion.field,
        sent             : coercion.sent,
        coercedTo        : jsonSafe(coercion.coercedTo),
        determination    : null,
        claimsAcceptance : true
      }
    );
  }
  else {
    record(
      CASE_COERCION,
      false,
      null,
      reviewedReason(target.key, CASE_COERCION) || coercion.reason,
      {
        field            : null,
        sent             : null,
        coercedTo        : null,
        determination    : coercion.determination,
        reviewed         : !!reviewedReason(target.key, CASE_COERCION),
        claimsAcceptance : true
      }
    );
  }

  return { cases: cases, schema: schema, leaves: leaves };
}

/**
 * Asserts the local schema proof for every case, which is the strongest
 * evidence this file produces.
 *
 * Five separate assertions, because each fails for a different reason:
 *   * an ACCEPTING input the schema rejects - the most likely silent defect in
 *     this file, and one that would record a rejection as the acceptance
 *     baseline;
 *   * a REJECTING input the schema accepts - which would make the reject half
 *     of the matrix vacuous;
 *   * an ACCEPTING case marked inapplicable - there is always an accepting
 *     input, so its absence is a tool failure and never a determination;
 *   * NO applicable coercion case anywhere - which would make the coercion
 *     dimension vacuous across the whole matrix, and cannot be right when the
 *     leaf census counts 30 boolean and 21 number leaves;
 *   * an UNRESOLVED case with no reviewed reason - "102 means 102", so a gap in
 *     the matrix fails the run until its reason is in REVIEWED_UNDRIVABLE.
 *
 * An inapplicable case whose determination is a fact about the SCHEMA or the
 * TRANSPORT passes, and is exactly the honest N/A required: most string-only
 * sections admit no coercion input, and the single `params` target admits no
 * rejecting one. Those are answers.
 *
 * The tool-failure assertions are EXIT_ERROR - the artifact cannot be trusted.
 * The unresolved-case assertion is EXIT_DIFFERENCE: the case set itself moved.
 *
 * @param {Array.<Object>} entries Serialized target entries.
 * @returns {{proved: number, notApplicable: number, reviewed: number,
 *            byDetermination: Object, coercionApplicable: number}}
 * @throws {ToolError|ParityError}
 */
function assertCaseProofs(entries) {
  var badAccepting = [];
  var badRejecting = [];
  var unreviewed = [];
  var byDetermination = {};
  var coercionApplicable = 0;
  var proved = 0;
  var notApplicable = 0;
  var reviewed = 0;

  entries.forEach(function(entry) {
    if (entry.cases.length !== CASE_KINDS.length) {
      throw new ToolError(entry.key + ' has ' + entry.cases.length +
        ' case record(s); every target must carry exactly ' +
        CASE_KINDS.length + ' - one per kind, with an explained N/A where a ' +
        'kind is inapplicable.');
    }

    CASE_KINDS.forEach(function(kind, index) {
      if (entry.cases[index].kind !== kind) {
        throw new ToolError(entry.key + ' case ' + index + ' is `' +
          entry.cases[index].kind + '`, expected `' + kind + '`; the case ' +
          'order is part of the artifact contract.');
      }
    });

    entry.cases.forEach(function(record) {
      if (!record.applicable) {
        notApplicable += 1;
        byDetermination[record.determination || 'unstated'] =
          (byDetermination[record.determination || 'unstated'] || 0) + 1;

        if (!record.reason) {
          throw new ToolError(entry.key + ' ' + record.kind + ' is marked ' +
            'inapplicable with no reason; an honest N/A is required.');
        }

        if (record.kind === CASE_ACCEPTING) {
          throw new ToolError(entry.key + ' has no applicable ACCEPTING case (' +
            record.reason + '). Every section admits an accepting input - it ' +
            'is the input the schema was written for - so this is a failure ' +
            'of the candidate ladder, not a determination about the schema.');
        }

        if (record.reviewed) {
          reviewed += 1;
        }
        else if (record.determination === DETERMINATION_UNRESOLVED ||
                 record.determination === null ||
                 record.determination === undefined) {
          unreviewed.push(entry.key + ' ' + record.kind + ': ' + record.reason);
        }

        return;
      }

      proved += 1;

      if (record.kind === CASE_COERCION) {
        coercionApplicable += 1;
      }

      if (record.claimsAcceptance && !record.schema.accepted) {
        badAccepting.push(entry.key + ' ' + record.kind + ': ' +
          record.schema.messages.join('; '));
      }

      if (!record.claimsAcceptance && record.schema.accepted) {
        badRejecting.push(entry.key + ' ' + record.kind +
          ': the schema accepted an input built to violate it');
      }
    });
  });

  if (badAccepting.length) {
    throw new ToolError('the schema REJECTED ' + badAccepting.length +
      ' input(s) this tool built to be accepted, so those cases would record ' +
      'a rejection as the acceptance baseline:\n  - ' +
      badAccepting.join('\n  - '));
  }

  if (badRejecting.length) {
    throw new ToolError('the schema ACCEPTED ' + badRejecting.length +
      ' input(s) this tool built to be rejected:\n  - ' +
      badRejecting.join('\n  - '));
  }

  if (!coercionApplicable) {
    throw new ParityError('not one target produced an applicable coercion ' +
      'case. The leaf census counts 30 boolean and 21 number leaves across ' +
      'the two route modules, and joi\'s convert:true turns \'true\' into ' +
      'true and \'42\' into 42 on every one of them, so a matrix in which the ' +
      'whole coercion dimension is N/A is measuring nothing.');
  }

  if (unreviewed.length) {
    throw new ParityError(unreviewed.length + ' case(s) are UNRESOLVED - this ' +
      'tool could not construct a case it should have been able to - with no ' +
      'reviewed reason. 102 targets means 102: add the reason to ' +
      'REVIEWED_UNDRIVABLE, as a reviewable diff, or make the case ' +
      'drivable:\n  - ' + unreviewed.join('\n  - '));
  }

  return {
    proved             : proved,
    notApplicable      : notApplicable,
    reviewed           : reviewed,
    byDetermination    : byDetermination,
    coercionApplicable : coercionApplicable
  };
}


/**
 * Serializes one target and its cases into the artifact's shape.
 *
 * Built through an explicit key order so the artifact is byte-stable, and
 * explicitly so the live `schemaSource` - a Joi object on one section - can
 * never leak into it.
 *
 * @param {Object} target A target record.
 * @param {Array.<Object>} cases From buildCases.
 * @param {Array.<Object>} leaves From describeLeaves.
 * @returns {Object}
 */
function serializeTarget(target, cases, leaves) {
  return {
    key           : target.key,
    method        : target.method,
    path          : target.path,
    section       : target.section,
    file          : target.file,
    controller    : target.controller,
    declaredAuth  : target.declaredAuth,
    identity      : target.identity,
    // Pre-handlers run BEFORE the validation block, so a target whose
    // pre-handlers cannot succeed records an outcome that is not about joi.
    // Recorded per target so that is visible rather than inferred, together
    // with the request paths the string forms dereference - which is what the
    // rejecting ladder steers around.
    pre           : target.pre,
    preReferences : target.preReferences,
    lookupFixtures: target.lookupFixtures,
    fail          : target.fail,
    html          : target.html,
    success       : target.success,
    payloadOutput : target.payloadOutput,
    isJoiSchema   : target.isJoiSchema,
    languageMap   : target.languageMap,
    leaves        : leaves.map(function(leaf) {
      return {
        key      : leaf.key,
        type     : leaf.type,
        required : !!leaf.required
      };
    }),
    cases         : cases
  };
}

// ---------------------------------------------------------------------------
// PHASE 5 - the inertness record and its assertion
// ---------------------------------------------------------------------------

/**
 * Emulates the block's custom-message lookup, exactly as it is written.
 *
 * The block does
 *   `_.find(language[fieldPath], function(custom, match) {
 *      return !!err.message.match(new RegExp(match)); })`
 * so the map's KEY is compiled as a RegExp and tested against joi's message,
 * and the map's VALUE is the friendly text that would replace it. Reproducing
 * that here is what lets the inertness conclusion be stated for a run in which
 * no server was driven - and it is why the conclusion is a MEASUREMENT and not
 * a reading of the source.
 *
 * @param {Object} map The `language` map for one field, key -> message.
 * @param {string} message A joi message.
 * @returns {(string|null)} The substituted message, or null for no match.
 */
function substituteCustomMessage(map, message) {
  var keys = Object.keys(isPlainObject(map) ? map : {});
  var i;
  var pattern;

  for (i = 0; i < keys.length; i++) {
    try {
      pattern = new RegExp(keys[i]);
    }
    catch (err) {
      // An unparseable key would make the block throw at request time. Recorded
      // as no match, which is what a reviewer needs to see rather than a crash
      // in the gate.
      continue;
    }

    if (pattern.test(String(message))) {
      return map[keys[i]];
    }
  }

  return null;
}

/**
 * Builds the inertness record for the two `username` targets.
 *
 * Reports, per target: the raw joi message the rejecting case produced, the
 * custom message the map would substitute, whether it WAS substituted, and the
 * conclusion. Both halves are recorded - the local emulation of the block's
 * lookup, which is available in every mode, and the message the SERVER actually
 * flashed, which is available once a case has been driven.
 *
 * Under R-d the inert mapping is preserved, not repaired, so a substitution is
 * a FAILURE and not an improvement. assertInertness makes that explicit.
 *
 * @param {Array.<Object>} entries Serialized target entries.
 * @param {Array.<Object>} maps From languageMaps.
 * @returns {Array.<Object>}
 */
function buildInertnessRecord(entries, maps) {
  return maps.map(function(map) {
    var entry = entries.filter(function(candidate) {
      // The map sits at the top level of a validate block, so its target is
      // that route's schema-bearing section. Both measured maps are on a
      // `payload` section.
      return candidate.method + ' ' + candidate.path === map.route &&
        candidate.languageMap !== null;
    })[0];
    var rejecting = entry && entry.cases.filter(function(record) {
      return record.kind === CASE_REJECTING;
    })[0];
    var field = map.fields.indexOf(LANGUAGE_FIELD) >= 0
      ? LANGUAGE_FIELD
      : map.fields[0];
    var fieldMap = (map.map && map.map[field]) || {};
    var rawMessages = [];
    var index = -1;
    var substituted = null;
    var observed = [];

    if (rejecting && rejecting.applicable && rejecting.schema) {
      index = rejecting.schema.paths.indexOf(field);
      rawMessages = index >= 0
        ? [rejecting.schema.messages[index]]
        : rejecting.schema.messages.slice();
    }

    if (rawMessages.length) {
      substituted = substituteCustomMessage(fieldMap, rawMessages[0]);
    }

    if (rejecting && rejecting.http) {
      MODES.forEach(function(mode) {
        var outcome = rejecting.http[mode];
        var flashed = outcome && outcome.validationFlash &&
          outcome.validationFlash[field];

        if (flashed === undefined || flashed === null) {
          return;
        }

        observed.push({ mode: mode, message: flashed });
      });
    }

    return {
      route              : map.route,
      target             : entry ? entry.key : null,
      field              : field,
      matchKeys          : Object.keys(fieldMap),
      customMessage      : fieldMap[LANGUAGE_MATCH_KEY] === undefined
        ? null
        : fieldMap[LANGUAGE_MATCH_KEY],
      rejectionStrategy  : rejecting ? rejecting.strategy : null,
      rawJoiMessage      : rawMessages.length ? rawMessages[0] : null,
      // The whole point: the map keys its message on the substring
      // "regular expression", and joi's pattern message does not contain it.
      containsMatchKey   : rawMessages.length
        ? String(rawMessages[0]).indexOf(LANGUAGE_MATCH_KEY) >= 0
        : null,
      customSubstituted  : substituted !== null,
      substitutedMessage : substituted,
      observedFlash      : observed,
      observedSubstituted: observed.some(function(record) {
        return String(record.message) === String(fieldMap[LANGUAGE_MATCH_KEY]);
      }),
      conclusion         : substituted === null
        ? 'inert: the map keys its message on "' + LANGUAGE_MATCH_KEY + '", ' +
          'which joi\'s pattern message does not contain on either 17.13.3 ' +
          'or 18.2.5, so the raw joi message reaches the client. Preserved, ' +
          'not repaired (R-d).'
        : 'ACTIVE: the custom message was substituted, which contradicts the ' +
          'measurement on both joi versions.'
    };
  });
}

/**
 * Asserts that the two `language` maps are still inert.
 *
 * Explicit rather than implied, in BOTH modes. In capture mode a substitution
 * means the premise this file is built on is wrong and the recorded baseline
 * would enshrine it; in compare mode it would also show up as a message
 * difference, but naming it here is what tells a reader that the friendly
 * message APPEARING is the failure - an improvement, which R-d prohibits - and
 * not a repair.
 *
 * @param {Array.<Object>} record From buildInertnessRecord.
 * @returns {undefined}
 * @throws {ParityError} If any map substituted its message.
 */
function assertInertness(record) {
  var active = record.filter(function(entry) {
    return entry.customSubstituted || entry.observedSubstituted;
  });

  if (record.length !== EXPECTED.languageMaps) {
    throw new ToolError('the inertness record covers ' + record.length +
      ' language map(s), expected ' + EXPECTED.languageMaps);
  }

  record.forEach(function(entry) {
    if (entry.rawJoiMessage === null) {
      throw new ToolError('no joi message was recorded for the `' + entry.field +
        '` field of ' + entry.route + ', so its inertness cannot be asserted. ' +
        'The rejecting case for that target must reject through the field the ' +
        '`language` map keys on.');
    }
  });

  if (active.length) {
    throw new ParityError('the `language` map(s) on ' +
      active.map(function(entry) { return entry.route; }).join(' and ') +
      ' SUBSTITUTED their custom message. Measured on both joi 17.13.3 and ' +
      '18.2.5 they are inert, because joi\'s pattern message contains no "' +
      LANGUAGE_MATCH_KEY + '" substring. A run in which the friendly message ' +
      'appears is a behaviour IMPROVEMENT, which R-d prohibits - the inert ' +
      'mapping is preserved, not repaired. Observed: ' +
      active.map(function(entry) {
        return entry.route + ' -> ' + JSON.stringify(entry.substitutedMessage ||
          entry.observedFlash);
      }).join('; '));
  }
}


// ---------------------------------------------------------------------------
// PHASE 4 - the HTTP layer
// ---------------------------------------------------------------------------

/**
 * A cookie jar.
 *
 * The session is SERVER-SIDE: `maxCookieSize: 0` forces yar to keep its
 * contents in the cache and put only an identifier in the cookie, so a flash
 * written on one request is readable on the next only if the same cookie comes
 * back. That is the entire mechanism this file exists to observe, and it is why
 * a jar is per DRIVE rather than per identity - see driveCase.
 *
 * @constructor
 */
function Jar() {
  this.map = {};
}

/**
 * Absorbs a response's Set-Cookie headers.
 *
 * Only the name and value are kept. Attributes are not honoured - no Path, no
 * Domain, no Expires - because every request here goes to one origin and the
 * ATTRIBUTES ARE THEMSELVES UNDER TEST elsewhere: AAP §0.9.3 asserts on them,
 * and a jar that silently dropped a cookie for failing its own attribute check
 * would turn a cookie regression into a mysterious lost session.
 *
 * @param {(string[]|undefined)} setCookie
 * @returns {undefined}
 */
Jar.prototype.absorb = function(setCookie) {
  (setCookie || []).forEach(function(header) {
    var pair = String(header).split(';')[0];
    var split = pair.indexOf('=');

    if (split <= 0) {
      return;
    }

    this.map[pair.slice(0, split)] = pair.slice(split + 1);
  }, this);
};

/**
 * The Cookie header value, or '' when the jar is empty.
 *
 * @returns {string}
 */
Jar.prototype.header = function() {
  var map = this.map;

  return Object.keys(map).map(function(name) {
    return name + '=' + map[name];
  }).join('; ');
};

/**
 * Performs one HTTP exchange.
 *
 * A TIMEOUT IS A RESULT, not a throw. AAP §0.9.3 makes exactly that
 * distinction, because a route that never settles is a recordable baseline
 * outcome; a gate that hung on one would produce no artifact at all. Redirects
 * are NOT followed here - following is a deliberate, recorded step in
 * driveCase, because the followed request is what consumes the session-held
 * flash.
 *
 * @param {string} origin e.g. 'http://127.0.0.1:3050'
 * @param {Object} options
 * @param {string} options.method
 * @param {string} options.target Path and query string.
 * @param {string} [options.accept]
 * @param {Jar} [options.jar]
 * @param {(Buffer|string|null)} [options.body]
 * @param {(string|null)} [options.contentType]
 * @returns {Promise<{status: (number|null), headers: Object, body: string,
 *                    timedOut: boolean, error: (string|null)}>}
 */
function exchange(origin, options) {
  return new Promise(function(resolve) {
    var address = new URL(options.target, origin);
    var transport = address.protocol === 'https:' ? https : http;
    var headers = { accept: options.accept || ACCEPT_HEADER.html };
    var cookie = options.jar ? options.jar.header() : '';
    var body = options.body === undefined ? null : options.body;
    var request;
    var settled = false;
    var timer;

    function finish(result) {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(result);
    }

    if (cookie) {
      headers.cookie = cookie;
    }

    if (body !== null) {
      headers['content-type'] = options.contentType || 'application/json';
      headers['content-length'] = Buffer.byteLength(body);
    }

    request = transport.request({
      protocol : address.protocol,
      hostname : address.hostname,
      port     : address.port,
      path     : address.pathname + address.search,
      method   : options.method,
      headers  : headers
    }, function(response) {
      var text = '';

      response.setEncoding('utf8');
      response.on('data', function(chunk) { text += chunk; });
      response.on('end', function() {
        if (options.jar) {
          options.jar.absorb(response.headers['set-cookie']);
        }

        finish({
          status   : response.statusCode,
          headers  : response.headers,
          body     : text,
          timedOut : false,
          error    : null
        });
      });
      response.on('error', function(err) {
        finish({
          status   : response.statusCode || null,
          headers  : response.headers || {},
          body     : text,
          timedOut : false,
          error    : 'response stream error: ' + err.message
        });
      });
    });

    timer = setTimeout(function() {
      request.destroy();
      finish({
        status   : null,
        headers  : {},
        body     : '',
        timedOut : true,
        error    : 'no response within ' + REQUEST_TIMEOUT_MS + 'ms'
      });
    }, REQUEST_TIMEOUT_MS);

    request.on('error', function(err) {
      finish({
        status   : null,
        headers  : {},
        body     : '',
        timedOut : false,
        error    : 'transport error: ' + err.message
      });
    });

    if (body !== null) {
      request.write(body);
    }

    request.end();
  });
}

/**
 * Decodes the HTML entities nunjucks' autoescape produces.
 *
 * Only the five that appear: joi's messages quote the field name, so
 * `&quot;email&quot; is required` is what reaches the page and `"email" is
 * required` is what it means. Decoding is not normalization - it recovers the
 * message that was rendered, which is what a reader of the page sees.
 *
 * @param {string} text
 * @returns {string}
 */
function decodeEntities(text) {
  return String(text)
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, '\'')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

/**
 * The validation messages a rendered page displays, in document order.
 *
 * The three templates that render `flash.validation` - login.html, signup.html
 * and courses/create.html - all wrap it in `<small class="error">`, so that is
 * what is extracted. Measured: `POST /login` with no email answers 302, and the
 * followed `/login` renders `"email" is required` in exactly that element.
 *
 * Note that signup.html renders `flash.validation.email` and
 * `.password` but NOT `.username`, so a username rejection on `POST /users`
 * legitimately renders NOTHING. That is baseline behaviour, it is preserved,
 * and it is why the flash-follow proof is stated over the whole matrix - at
 * least one rejecting case must render a message - rather than per target.
 *
 * @param {string} html
 * @returns {string[]}
 */
function renderedMessages(html) {
  var pattern = /<small[^>]*class="[^"]*\berror\b[^"]*"[^>]*>([\s\S]*?)<\/small>/g;
  var out = [];
  var match;

  while ((match = pattern.exec(String(html))) !== null) {
    out.push(decodeEntities(match[1]).replace(/\s+/g, ' ').trim());
  }

  return out.filter(function(message) {
    return message !== '';
  });
}

/**
 * The `flash.validation` object of a JSON response, or null.
 *
 * This is the non-redirect branch of `request.fail`: it sets
 * `json.flash = request.yar.flash()`, which DRAINS every flash, so the
 * validation errors are in the body itself and no follow is needed. Compared
 * exactly - these are the `validationErrors` the block built, keyed by the
 * dotted field path.
 *
 * @param {string} body
 * @param {string} contentType
 * @returns {{flash: (Object|null), keys: (string[]|null), parsed: boolean}}
 */
function jsonValidationFlash(body, contentType) {
  var parsed;

  if (String(contentType || '').indexOf('json') === -1) {
    return { flash: null, keys: null, parsed: false };
  }

  try {
    parsed = JSON.parse(body);
  }
  catch (err) {
    return { flash: null, keys: null, parsed: false };
  }

  if (!isPlainObject(parsed)) {
    return { flash: null, keys: null, parsed: true };
  }

  return {
    flash  : isPlainObject(parsed.flash) && isPlainObject(parsed.flash.validation)
      ? parsed.flash.validation
      : null,
    // The top-level key list is a stable body signal. Full-body comparison is
    // deliberately NOT this gate's job: AAP §0.9.3 gives that to the request
    // corpus in test/parity/{capture,replay}.js, which owns the normalization a
    // whole body needs. Here the body is evidence about the validation flash.
    keys   : Object.keys(parsed).sort(),
    parsed : true
  };
}


/**
 * The concrete values wildcard path segments are materialized with.
 *
 * Every one comes from test/parity/seed.js, so the id in a URL is the id of a
 * seeded document and the pre-handlers that run BEFORE the validation block
 * succeed. That ordering is the reason this matters at all: 62 of the 97
 * validate-bearing routes carry pre-handlers, and a pre-handler that cannot
 * find its document takes over the request, so the recorded outcome would be a
 * lookup failure and the validation block would never execute.
 *
 * `{invitationId}` is the one exception: the seeder has no CourseInvitation
 * fixture, so the two routes carrying it get a well-formed but absent id. Those
 * targets are still DRIVEN and still COMPARED - nothing is skipped - and they
 * record `validationReached: false` with the pre-handler named, so a reader
 * knows the outcome is not about joi.
 *
 * @param {Object} seed The test/parity/seed.js module.
 * @returns {Object} Parameter name -> value.
 */
function pathValues(seed) {
  var trinket = seed.fixtures.trinkets.trinketPython;

  return {
    userId       : seed.ids.user,
    userSlug     : seed.credentials.user.username,
    courseId     : seed.ids.course,
    courseSlug   : seed.fixtures.slugs.course,
    lessonId     : seed.ids.lesson,
    materialId   : seed.ids.material,
    trinketId    : trinket.id,
    folderId     : seed.ids.folder,
    fileId       : seed.ids.file,
    shortCode    : trinket.shortCode,
    lang         : trinket.lang,
    // No fixture exists. A syntactically valid ObjectId in the seeder's own
    // reserved '7xx' band, so it can never collide with a seeded document.
    invitationId : '0000000000000000000007ff',
    // `{path*}` on /library/trinkets/{path*}; its only pre-handler is the
    // feature gate, so any enabled language is a valid concrete value.
    path         : trinket.lang
  };
}

/**
 * Materializes a declared route path into a concrete one.
 *
 * For a `params` target the segment IS THE CASE INPUT - that is how a params
 * schema is driven at all - so those values come from the input and the rest
 * from the seeded fixtures.
 *
 * @param {string} declaredPath e.g. '/api/courses/{courseId}/lessons/{lessonId}'
 * @param {Object} values From pathValues.
 * @param {(Object|null)} fromInput Values that must come from the case input.
 * @returns {{path: string, unseeded: string[], substituted: Object}}
 */
function materializePath(declaredPath, values, fromInput) {
  var unseeded = [];
  var substituted = {};

  var concrete = String(declaredPath).replace(/\{([^}]+)\}/g, function(all, raw) {
    var name = raw.replace(/[*?]$/, '').replace(/\*\d+$/, '');
    var value;

    if (fromInput && Object.prototype.hasOwnProperty.call(fromInput, name)) {
      value = fromInput[name];
    }
    else if (Object.prototype.hasOwnProperty.call(values, name)) {
      value = values[name];
    }
    else {
      // A parameter this tool has no value for. Named in the record rather
      // than filled with a guess that would read as a seeded id.
      unseeded.push(name);
      value = 'parity';
    }

    substituted[name] = value;

    return encodeURIComponent(String(value));
  });

  return { path: concrete, unseeded: unseeded, substituted: substituted };
}

/**
 * The request target - path plus query string - for one case.
 *
 * @param {Object} target A target record.
 * @param {*} visible The server-visible input.
 * @param {Object} values From pathValues.
 * @returns {{target: string, path: string, query: (string|null),
 *            unseeded: string[], substituted: Object}}
 */
function requestTarget(target, visible, values) {
  var fromInput = target.section === 'params' && isPlainObject(visible)
    ? visible
    : null;
  var materialized = materializePath(target.path, values, fromInput);
  var query = null;

  if (target.section === 'query' && isPlainObject(visible)) {
    query = querystring.stringify(visible);
  }

  return {
    target      : materialized.path + (query ? '?' + query : ''),
    path        : materialized.path,
    query       : query,
    unseeded    : materialized.unseeded,
    substituted : materialized.substituted
  };
}

/**
 * The request body for one case, or null when the section is not a payload.
 *
 * A payload is sent as JSON so the types the generator produced survive the
 * wire and the schema sees exactly what the local proof validated.
 *
 * @param {Object} target A target record.
 * @param {*} visible The server-visible input.
 * @returns {{body: (string|null), contentType: (string|null)}}
 */
function requestBody(target, visible) {
  if (target.section !== 'payload') {
    return { body: null, contentType: null };
  }

  // JSON, so the types the generator produced survive the wire and the schema
  // sees exactly what the local proof validated. See transportFor for why the
  // four `output: 'file'` routes are not sent multipart.
  return {
    body        : JSON.stringify(visible === undefined ? null : visible),
    contentType : 'application/json'
  };
}

/**
 * Logs in and returns a jar holding the resulting session.
 *
 * A FRESH login per drive, not one shared session. The reason is the mechanism
 * under observation: `request.yar.flash('validation', ..., true)` leaves the
 * errors IN THE SESSION on the redirect branch, to be consumed by the next
 * request. A session shared across cases would let one case's uncollected flash
 * surface in another case's response, and the artifact would record a message
 * that the case did not produce. Fresh sessions make every drive independent of
 * every other, which is what makes exact comparison meaningful.
 *
 * @param {string} origin
 * @param {Object} credentials A seed.credentials entry.
 * @returns {Promise<Jar>}
 * @throws {ToolError} If the login does not succeed.
 */
async function login(origin, credentials) {
  var jar = new Jar();
  var body = querystring.stringify({
    email    : credentials.email,
    password : credentials.password
  });

  var response = await exchange(origin, {
    method      : 'POST',
    target      : '/login',
    accept      : ACCEPT_HEADER.html,
    jar         : jar,
    body        : body,
    contentType : 'application/x-www-form-urlencoded'
  });

  if (response.timedOut || response.error) {
    throw new ToolError('cannot log in as ' + credentials.email + ': ' +
      (response.error || 'timed out'));
  }

  // `POST /login` declares `success.redirect: '/home'`, so a successful login
  // is a 302 to /home. Anything else means the seeded identity is absent or the
  // credentials moved, and every authenticated case would then record an
  // unauthenticated outcome - a whole-matrix failure disguised as 105 route
  // differences.
  if (response.status !== 302 ||
      String(response.headers.location || '').indexOf('/home') === -1) {
    throw new ToolError('logging in as ' + credentials.email + ' answered ' +
      response.status + ' -> ' + JSON.stringify(response.headers.location) +
      ', expected 302 to /home. Is test/parity/seed.js seeded into the ' +
      'database this server is using?');
  }

  if (!jar.map.session) {
    throw new ToolError('logging in as ' + credentials.email +
      ' set no `session` cookie, so no case could be driven authenticated');
  }

  return jar;
}

/**
 * Records one HTTP outcome, plus the followed redirect where there is one.
 *
 * The follow is the point. On the 10 targets declaring a `fail.redirect`, an
 * html-mode rejection answers 302 and the message is NOT IN THE RESPONSE - it
 * is in the session, and it reaches a client only on the next request. So the
 * redirect is followed WITH THE SAME JAR and the rendered message is extracted
 * from the resulting page. A status-only capture would compare two 302s and
 * call the messages equal without ever having seen one.
 *
 * @param {string} origin
 * @param {Jar} jar
 * @param {Object} response From exchange.
 * @param {number} hops How many redirects to follow.
 * @returns {Promise<Object>} The outcome record.
 */
async function recordOutcome(origin, jar, response, hops) {
  var outcome = {
    status          : response.status,
    timedOut        : response.timedOut,
    error           : response.error,
    contentType     : response.headers['content-type'] === undefined
      ? null
      : response.headers['content-type'],
    location        : response.headers.location === undefined
      ? null
      : response.headers.location,
    locationRelative: relativeLocation(response.headers.location, origin),
    renderedMessages: renderedMessages(response.body),
    validationFlash : null,
    bodyKeys        : null,
    followed        : []
  };

  var flash = jsonValidationFlash(response.body, outcome.contentType);
  var current = response;
  var next;
  var hop;

  outcome.validationFlash = flash.flash;
  outcome.bodyKeys = flash.keys;

  for (hop = 0; hop < hops; hop++) {
    if (!current.headers || !current.headers.location) {
      break;
    }

    next = await exchange(origin, {
      method : 'GET',
      target : relativeLocation(current.headers.location, origin) ||
        current.headers.location,
      accept : ACCEPT_HEADER.html,
      jar    : jar
    });

    outcome.followed.push({
      target          : relativeLocation(current.headers.location, origin),
      status          : next.status,
      timedOut        : next.timedOut,
      error           : next.error,
      contentType     : next.headers['content-type'] === undefined
        ? null
        : next.headers['content-type'],
      locationRelative: relativeLocation(next.headers.location, origin),
      // What a reader of the page sees. This is where the session-held
      // validation flash becomes observable.
      renderedMessages: renderedMessages(next.body)
    });

    current = next;
  }

  return outcome;
}

/**
 * A `Location` header with this run's own origin removed.
 *
 * The application builds ABSOLUTE redirect targets from `app.url`, so a
 * `Location` carries the host and port the run happened to use. That is a
 * property of the run and not of the response, and it is the ONLY thing this
 * gate normalizes - the verbatim header is recorded beside it, so a reviewer
 * can still see exactly what was sent. Without this, capturing a baseline on
 * one port and a target on another would report 10 spurious differences and
 * hide any real one among them.
 *
 * @param {(string|undefined)} location
 * @param {string} origin
 * @returns {(string|null)}
 */
function relativeLocation(location, origin) {
  var address;

  if (location === undefined || location === null || location === '') {
    return null;
  }

  try {
    address = new URL(String(location), origin);
  }
  catch (err) {
    // Not a URL at all. Recorded verbatim rather than dropped: a malformed
    // Location is a real difference.
    return String(location);
  }

  if (address.origin !== new URL(origin).origin) {
    // A redirect off-origin is not this run's own address and is recorded in
    // full, because where it points is the whole content of the difference.
    return address.href;
  }

  return address.pathname + address.search + address.hash;
}


/**
 * Drives one case in one Accept mode and returns the outcome record.
 *
 * The input driven is the RECORDED one - `serverVisible` when the transport
 * changed it, otherwise `input` - so a `--compare` run replays the baseline's
 * bytes rather than regenerating its own. That is what keeps the comparison
 * apples-to-apples if `describe()` ever differs between the two joi versions;
 * the regenerated inputs are cross-checked separately and any divergence is
 * reported in its own right.
 *
 * @param {Object} context The infrastructure context.
 * @param {Object} entry A serialized target entry.
 * @param {Object} record A case record.
 * @param {string} mode MODE_HTML or MODE_JSON.
 * @param {number} order The position of this drive in the run.
 * @returns {Promise<Object>} The outcome record.
 */
async function driveCase(context, entry, record, mode, order) {
  var visible = record.serverVisible === null || record.serverVisible === undefined
    ? record.input
    : record.serverVisible;
  var addressed = requestTarget(entry, visible, context.pathValues);
  var payload = requestBody(entry, visible);
  var jar;
  var response;
  var outcome;

  if (entry.identity === IDENTITY_ANONYMOUS) {
    jar = new Jar();
  }
  else {
    jar = await login(context.origin, context.credentials[entry.identity]);
  }

  response = await exchange(context.origin, {
    method      : entry.method,
    target      : addressed.target,
    accept      : ACCEPT_HEADER[mode],
    jar         : jar,
    body        : payload.body,
    contentType : payload.contentType
  });

  // Two hops. One reaches the `fail.redirect` target, which is where the
  // session-held validation flash is rendered; the second exists because a
  // redirect target can itself redirect - `/{redirectTo}` on the two
  // activate-account routes interpolates to whatever the payload carried.
  outcome = await recordOutcome(context.origin, jar, response, 2);

  outcome.order = order;
  // Set to true by driveAll when this drive had to restart a crashed
  // application before it could run. Always present, so the field is
  // comparable rather than sometimes absent.
  outcome.precededByCrash = false;
  outcome.requestTarget = addressed.target;
  outcome.requestContentType = payload.contentType;
  outcome.identity = entry.identity;

  // Parameters with no seeded fixture, named so a reader knows why a
  // pre-handler may have taken over before the validation block ran.
  outcome.unseededParams = addressed.unseeded;

  // Authentication and authorization run BEFORE the handler that holds the
  // validation block, so a 401 or 403 means the block never executed. Recorded
  // as a fact rather than inferred from a status by the reader.
  outcome.authBlocked = outcome.status === 401 || outcome.status === 403;

  // Whether the validation flash was actually OBSERVED - either in a JSON body
  // or rendered on a followed page. This is what makes the flash-follow proof
  // checkable over the whole matrix instead of asserted in prose.
  outcome.validationObserved = !!(
    (outcome.validationFlash && Object.keys(outcome.validationFlash).length) ||
    outcome.followed.some(function(hop) {
      return hop.renderedMessages.length > 0;
    }) ||
    outcome.renderedMessages.length > 0
  );

  // For a rejecting case, whether the flash keys are the paths the local schema
  // proof reported. Equality here is the strongest available evidence that the
  // hand-rolled block ran and produced exactly the errors joi produced.
  outcome.flashMatchesProof = record.schema && outcome.validationFlash
    ? canonical(Object.keys(outcome.validationFlash).sort()) ===
      canonical(record.schema.paths.slice().sort())
    : null;

  return outcome;
}

/**
 * True when a failure means the application is gone rather than that it
 * answered something unexpected.
 *
 * @param {*} reason An error, or a recorded outcome's `error` string.
 * @returns {boolean}
 */
function isUnreachable(reason) {
  var text = reason && reason.message ? reason.message : String(reason);

  return UNREACHABLE.test(text);
}

/**
 * Restarts the application after a crash and restores the fixtures.
 *
 * The database is NOT restarted with it. `test/parity/mongo.js` owns the
 * mongod's lifecycle and this tool published its address before the server
 * started, so `server.stop()` leaves it running - which is what lets the
 * mongoose connection this process holds survive the restart, and what makes
 * re-seeding cheap. The seeder is idempotent, so it restores anything a
 * half-completed request removed and creates nothing otherwise.
 *
 * @param {Object} context The infrastructure context, updated in place.
 * @returns {Promise<undefined>}
 * @throws {ToolError} If the restart budget is exhausted or the restart fails.
 */
async function restartApplication(context) {
  var started;

  context.restarts += 1;

  if (context.restarts > MAX_RESTARTS) {
    throw new ToolError('the application has crashed ' + context.restarts +
      ' times, past the ' + MAX_RESTARTS + ' restart budget. A tree that ' +
      'cannot serve a request corpus without dying repeatedly is reporting ' +
      'that fact, not producing a matrix.');
  }

  note('  the application is unreachable; restarting it (' + context.restarts +
    ' of ' + MAX_RESTARTS + ' permitted)');

  await lazy.server.stop();

  started = await lazy.server.start(context.startOptions);

  context.origin  = started.origin;
  context.baseUrl = started.baseUrl;
  context.server  = started;

  await lazy.seed.seed();
}

/**
 * The order every drive runs in, and the reason for it.
 *
 * ACCEPTING INPUTS ON MUTATING ROUTES CREATE AND DESTROY DATA - that is what an
 * accepted payload on `POST /api/courses` or `DELETE /api/drafts/{trinketId}`
 * is for - so the run is phased so that a mutation cannot disturb a case that
 * has not run yet:
 *   phase 0  every case on a GET route: no mutation is possible at all
 *   phase 1  rejecting cases on mutating routes: validation fails, so the
 *            handler never runs and nothing is written
 *   phase 2  coercion cases on mutating routes: these DO reach the handler
 *   phase 3  accepting cases on mutating routes: the most mutating of all, and
 *            therefore last
 * Within a phase the order is the target key, then the case kind, then html
 * before json - fully deterministic, so both captures issue the same requests
 * in the same sequence.
 *
 * One baseline behaviour makes that sequence load-bearing rather than merely
 * tidy. `request.fail` ASSIGNS BACK onto the long-lived `fail` object when it
 * interpolates a redirect target, so on `POST /users`, `GET /activate-account`
 * and `POST /activate-account` the first rejection's target leaks into every
 * later one. AAP §0.6.6 preserves that. It makes those outcomes order-dependent
 * - and identical on both trees, because the order is fixed here and recorded
 * per outcome.
 *
 * @param {Array.<Object>} entries Serialized target entries.
 * @returns {Array.<{entry: Object, record: Object, mode: string,
 *                   phase: number}>}
 */
function planDrives(entries) {
  var plan = [];

  entries.forEach(function(entry) {
    entry.cases.forEach(function(record) {
      if (!record.applicable) {
        return;
      }

      MODES.forEach(function(mode) {
        var phase;

        if (entry.method === 'GET') {
          phase = 0;
        }
        else if (record.kind === CASE_REJECTING) {
          phase = 1;
        }
        else if (record.kind === CASE_COERCION) {
          phase = 2;
        }
        else {
          phase = 3;
        }

        plan.push({
          entry : entry,
          record: record,
          mode  : mode,
          phase : phase
        });
      });
    });
  });

  return plan.sort(function(a, b) {
    if (a.phase !== b.phase) {
      return a.phase - b.phase;
    }
    if (a.entry.key !== b.entry.key) {
      return a.entry.key < b.entry.key ? -1 : 1;
    }
    if (a.record.kind !== b.record.kind) {
      return CASE_KINDS.indexOf(a.record.kind) - CASE_KINDS.indexOf(b.record.kind);
    }
    return MODES.indexOf(a.mode) - MODES.indexOf(b.mode);
  });
}

// The policy planDrives implements, recorded in the artifact so the sequence is
// reconstructible from the artifact alone.
var ORDER_POLICY = 'phase 0 GET routes, phase 1 rejecting on mutating routes, ' +
  'phase 2 coercion on mutating routes, phase 3 accepting on mutating routes; ' +
  'within a phase by target key, then case kind, then html before json. Each ' +
  'outcome records its `order`, which is its index in that sequence.';

/**
 * Drives every applicable case and attaches the outcomes.
 *
 * Sequential by design. Concurrency would make the run faster and the artifact
 * worthless: the `fail.redirect` interpolation leak and the mutations of the
 * accepting phase are both order-sensitive, and two captures that interleaved
 * differently would differ for a reason that has nothing to do with joi.
 *
 * @param {Object} context The infrastructure context.
 * @param {Array.<Object>} entries Serialized target entries.
 * @returns {Promise<{drives: number, timedOut: number, observed: number}>}
 */
async function driveAll(context, entries) {
  var plan = planDrives(entries);
  var crashes = [];
  var timedOut = 0;
  var observed = 0;
  var index;
  var step;
  var previous = null;
  var outcome;

  /**
   * Drives one step, absorbing a crash of the application.
   *
   * The crash is attributed to the PREVIOUS drive, which is where it belongs: a
   * process killed by an unhandled 'error' event from an async callback has
   * usually already answered the request that armed it, so the drive that
   * discovers the corpse is not the drive that caused it. Measured on the
   * baseline: `POST /api/folders` answers, then its mongoose callback throws
   * and the process dies, and the NEXT drive's login is refused.
   *
   * @param {Object} current The plan step.
   * @param {number} order Its index in the run.
   * @returns {Promise<Object>} The outcome record.
   */
  async function driveTolerantly(current, order) {
    var attempt;

    try {
      attempt = await driveCase(context, current.entry, current.record,
        current.mode, order);

      if (!attempt.error || !isUnreachable(attempt.error)) {
        return attempt;
      }
    }
    catch (err) {
      if (!isUnreachable(err)) {
        throw err;
      }
    }

    crashes.push({
      detectedAt : {
        target : current.entry.key,
        case   : current.record.kind,
        mode   : current.mode
      },
      // Null for a crash discovered on the very first drive, which cannot be
      // attributed to a predecessor.
      afterDrive : previous === null ? null : {
        target : previous.entry.key,
        case   : previous.record.kind,
        mode   : previous.mode
      }
    });

    await restartApplication(context);

    attempt = await driveCase(context, current.entry, current.record,
      current.mode, order);
    attempt.precededByCrash = true;

    return attempt;
  }

  note('driving ' + plan.length + ' request(s) across ' + entries.length +
    ' target(s) against ' + context.origin);

  for (index = 0; index < plan.length; index++) {
    step = plan[index];

    if (!step.record.http) {
      step.record.http = {};
      step.record.drivePhase = step.phase;
    }

    outcome = await driveTolerantly(step, index);
    step.record.http[step.mode] = outcome;
    previous = step;

    if (outcome.timedOut) {
      timedOut += 1;
      note('  TIMEOUT after ' + REQUEST_TIMEOUT_MS + 'ms: ' + step.entry.key +
        ' ' + step.record.kind + ' [' + step.mode + ']');
    }

    if (outcome.validationObserved) {
      observed += 1;
    }

    if ((index + 1) % 50 === 0) {
      note('  ' + (index + 1) + '/' + plan.length + ' driven');
    }
  }

  // A case that was planned but carries no outcome would be an invisible hole
  // in the matrix, so the attachment is verified rather than assumed.
  entries.forEach(function(entry) {
    entry.cases.forEach(function(record) {
      if (!record.applicable) {
        return;
      }

      MODES.forEach(function(mode) {
        if (!record.http || !record.http[mode]) {
          throw new ToolError(entry.key + ' ' + record.kind + ' has no ' + mode +
            ' outcome after the drive pass');
        }
      });
    });
  });

  return {
    drives   : plan.length,
    timedOut : timedOut,
    observed : observed,
    restarts : context.restarts,
    // Named, not counted. Each entry says which drive discovered the corpse
    // and which drive is the likely cause, both by target and case rather than
    // by run index, so the list is comparable between two trees.
    crashes  : crashes
  };
}

/**
 * How many rejecting cases actually REACHED the validation block, and which
 * did not.
 *
 * This is the gate's own coverage, recorded rather than assumed. Authentication
 * and every pre-handler run BEFORE the block, so a rejecting case can answer
 * 400, 404, 415 or 500 from something that ran earlier and contribute no joi
 * evidence at all. The ladder steers around the string pre-handlers it can see
 * - see preReferences - but a FUNCTION pre-handler's references are invisible
 * in the declaration: `helpers.validLang` reads `query.lang`, and the schema
 * for that field is `Joi.string().required()`, so a schema-derived accepting
 * value is a valid string that is not a language and the pre-handler answers
 * 404 before validation. Two targets are unreachable for that reason and two
 * more because the seeder has no CourseInvitation fixture.
 *
 * Recording it makes those targets visible and comparable instead of silently
 * counted as covered. A target that stops reaching validation between the two
 * trees shows up per case as well, through its status and flash - this block is
 * the readable summary of the same fact.
 *
 * @param {Array.<Object>} entries Serialized target entries.
 * @returns {Object}
 */
function buildValidationReach(entries) {
  var reached = [];
  var unreached = [];

  entries.forEach(function(entry) {
    var record = entry.cases.filter(function(candidate) {
      return candidate.kind === CASE_REJECTING;
    })[0];
    var observed;

    if (!record || !record.applicable || !record.http) {
      return;
    }

    observed = MODES.some(function(mode) {
      var outcome = record.http[mode];

      // Either the flash was seen in a body or on a followed page, or the
      // response is the `fail.redirect` 302 that only the block produces.
      return outcome &&
        (outcome.validationObserved || outcome.status === 302);
    });

    if (observed) {
      reached.push(entry.key);
      return;
    }

    unreached.push({
      target   : entry.key,
      strategy : record.strategy,
      field    : record.field,
      statuses : MODES.map(function(mode) {
        return mode + ':' + (record.http[mode]
          ? record.http[mode].status
          : 'none');
      }),
      pre      : entry.pre.map(function(descriptor) {
        return descriptor.method || descriptor.kind;
      }),
      unseeded : record.http[MODE_JSON]
        ? record.http[MODE_JSON].unseededParams
        : []
    });
  });

  return {
    rejectingCases : reached.length + unreached.length,
    reached        : reached.length,
    unreached      : unreached.length,
    // Named, not counted: each of these is a target whose joi evidence rests
    // on the local schema proof alone, and a reader is entitled to know which.
    unreachedDetail: unreached
  };
}

/**
 * Asserts the flash-follow proof over the whole matrix.
 *
 * At least one rejecting case must record a NON-EMPTY rendered validation
 * message. If every message is empty the redirect follow is not working and the
 * gate is only comparing statuses - which would still pass, and would prove
 * nothing about the message R-e requires to survive.
 *
 * Stated over the matrix rather than per target because the templates decide:
 * only login.html, signup.html and courses/create.html render
 * `flash.validation` at all, and signup.html renders the email and password
 * fields but not username. A per-target assertion would therefore fail on
 * baseline behaviour that is correct and preserved.
 *
 * @param {Array.<Object>} entries Serialized target entries.
 * @returns {{rendered: number, examples: Array.<Object>}}
 * @throws {ParityError} If no rejecting case rendered a message.
 */
function assertFlashFollow(entries) {
  var examples = [];

  entries.forEach(function(entry) {
    entry.cases.forEach(function(record) {
      if (record.kind !== CASE_REJECTING || !record.applicable || !record.http) {
        return;
      }

      MODES.forEach(function(mode) {
        var outcome = record.http[mode];

        if (!outcome) {
          return;
        }

        outcome.followed.forEach(function(hop) {
          if (!hop.renderedMessages.length) {
            return;
          }

          examples.push({
            target   : entry.key,
            mode     : mode,
            status   : outcome.status,
            followed : hop.target,
            messages : hop.renderedMessages
          });
        });
      });
    });
  });

  if (!examples.length) {
    throw new ParityError('no rejecting case rendered a validation message on ' +
      'a followed redirect. The 10 targets declaring a `fail.redirect` hold ' +
      'their message IN THE SESSION and render it on the NEXT request, so an ' +
      'empty result means the follow is not carrying the cookie and this gate ' +
      'is comparing statuses only. Measured baseline: `POST /login` with no ' +
      'email answers 302 and the followed /login renders `"email" is ' +
      'required`.');
  }

  return { rendered: examples.length, examples: examples.slice(0, 10) };
}


// ---------------------------------------------------------------------------
// Infrastructure - the database, the server and the fixtures
// ---------------------------------------------------------------------------

/**
 * Loads the sibling parity modules, once.
 *
 * Lazily, and only when a mode needs them: `--schema-only` must not be able to
 * provision a database, and the harvest must be the first thing in this process
 * that touches the npm `config` package.
 *
 * @returns {undefined}
 * @throws {ToolError} If a sibling is missing.
 */
function loadSiblings() {
  var required = [
    { name: 'server', file: './server' },
    { name: 'mongo',  file: './mongo' },
    { name: 'seed',   file: './seed' }
  ];

  required.forEach(function(entry) {
    if (lazy[entry.name]) {
      return;
    }

    try {
      lazy[entry.name] = require(entry.file);
    }
    catch (err) {
      throw new ToolError('cannot load test/parity/' + entry.name + '.js, ' +
        'which owns the ' + (entry.name === 'seed' ? 'fixtures' : 'lifecycle') +
        ' this gate depends on: ' +
        (err && err.message ? err.message : String(err)));
    }
  });

  if (!lazy.mongoose) {
    try {
      // Resolved from THIS worktree, not from the tree under test: the
      // connection this process opens is used to seed the fixtures, and
      // test/parity/seed.js resolves its models relative to itself, so both
      // must be the same mongoose instance and the same registered schemas.
      lazy.mongoose = require(path.resolve(TOOL_ROOT, 'node_modules', 'mongoose'));
    }
    catch (err) {
      throw new ToolError('cannot load mongoose from ' + TOOL_ROOT +
        '/node_modules, which is where test/parity/seed.js resolves its ' +
        'models from: ' + (err && err.message ? err.message : String(err)));
    }
  }
}

/**
 * The fixture identifier map, loaded in EVERY mode.
 *
 * `test/parity/seed.js` states that requiring it reads no configuration, opens
 * no socket and registers no schema - its models are resolved lazily - so it is
 * safe to load here, before the harvest, and `--schema-only` loads it too. That
 * is deliberate: the seeded identifiers are part of the generated INPUT, so a
 * matrix built without a database must produce byte-identical inputs to one
 * built with one, or the two artifacts could not be compared.
 *
 * The map is a frozen constant in THIS worktree, which is what makes it the
 * same on both sides of the gate however far apart the two trees are.
 *
 * @returns {Object} The `ids` map.
 * @throws {ToolError} If the seeder cannot be loaded or exposes no ids.
 */
function fixtureIds() {
  if (!lazy.seed) {
    try {
      lazy.seed = require('./seed');
    }
    catch (err) {
      throw new ToolError('cannot load test/parity/seed.js, which owns the ' +
        'fixture identifiers every generated input materializes: ' +
        (err && err.message ? err.message : String(err)));
    }
  }

  if (!lazy.seed.ids || !lazy.seed.ids.user) {
    throw new ToolError('test/parity/seed.js exposes no `ids` map, so no ' +
      'identifier could be materialized into an input or a path');
  }

  return lazy.seed.ids;
}

/**
 * Publishes the database address into NODE_CONFIG, BEFORE the harvest.
 *
 * The order matters and is not obvious. npm `config` 0.4.37 resolves and
 * FREEZES on first require, and the harvest is the first require - so whatever
 * NODE_CONFIG holds at that moment is the configuration this whole process
 * sees, including the configuration test/parity/seed.js reads when it resolves
 * `aws.buckets.exports` for the export fixtures. That bucket exists only in the
 * overlay: committed configuration declares no `exports` entry at all, which
 * AAP §0.6.7 records as an existing deployment gap. Composing the address and
 * the overlay first is therefore what lets the seeder run at all.
 *
 * It also means the recaptcha-conditional schema at config/api_routes.js is
 * derived from the SAME configuration the server under test received, so the
 * target set and the application agree about whether
 * `'g-recaptcha-response'` is required.
 *
 * @param {Object} options Parsed arguments.
 * @returns {Promise<{provisioned: boolean, uri: (string|null),
 *                    overlay: (Object|null)}>}
 * @throws {ToolError} If the database cannot be provisioned.
 */
async function publishDatabaseAddress(options) {
  var overlayPath = options.overlay || lazy.mongo.DEFAULT_OVERLAY;
  var overlay;
  var address;
  var started;

  try {
    overlay = lazy.mongo.readOverlay(overlayPath);
  }
  catch (err) {
    throw new ToolError('cannot read the NODE_CONFIG overlay ' + overlayPath +
      ': ' + (err && err.message ? err.message : String(err)));
  }

  if (options.mongoUri) {
    // An address the caller owns. The layer is composed here so this process's
    // `config` freezes against the same values the child will receive.
    address = lazy.server.parseMongoUri(options.mongoUri);
    process.env.NODE_CONFIG = JSON.stringify(deepMerge(
      deepMerge(
        JSON.parse(composeNodeConfig(process.env.NODE_CONFIG)),
        overlay
      ),
      lazy.mongo.buildRuntimeConfig(address)
    ));

    return { provisioned: false, uri: options.mongoUri, overlay: overlay };
  }

  started = await lazy.mongo.start(
    options.database === null
      ? { overlay: overlay }
      : { database: options.database, overlay: overlay }
  );

  // `mongo.start` returns the fully composed NODE_CONFIG: the inherited value,
  // the overlay above it and the address above that.
  process.env.NODE_CONFIG = started.nodeConfig;
  process.env.NODE_CONFIG_PERSIST_ON_CHANGE = lazy.mongo.PERSIST_ON_CHANGE;

  return { provisioned: true, uri: started.uri, overlay: overlay };
}

/**
 * Starts the application, connects to the database and seeds the fixtures.
 *
 * The seeding is not optional and not cosmetic. Pre-handlers run BEFORE the
 * validation block, and 62 of the 97 validate-bearing routes carry them - so
 * without seeded documents the majority of this matrix would record a
 * pre-handler lookup failure and prove nothing about joi. The identities matter
 * for the same reason: 67 routes declare `auth: 'session'` and authentication
 * runs before the handler, so an unauthenticated drive records a 401 and never
 * reaches validation either.
 *
 * @param {Object} options Parsed arguments.
 * @param {Object} database From publishDatabaseAddress.
 * @returns {Promise<Object>} The infrastructure context.
 * @throws {ToolError} If the server or the fixtures cannot be brought up.
 */
async function startInfrastructure(options, database) {
  var startOptions = {
    appRoot : options.appRoot,
    overlay : options.overlay || lazy.mongo.DEFAULT_OVERLAY
  };
  var context;
  var started;
  var summary;

  if (options.port !== null) {
    startOptions.port = options.port;
  }

  if (options.mongoUri) {
    startOptions.mongoUri = options.mongoUri;
  }

  if (options.database !== null) {
    startOptions.database = options.database;
  }

  started = await lazy.server.start(startOptions);

  lazy.mongoose.set('strictQuery', true);

  try {
    await lazy.mongoose.connect(database.uri || lazy.mongo.uri());
  }
  catch (err) {
    throw new ToolError('cannot connect to ' +
      (database.uri || '(the provisioned database)') + ' to seed the ' +
      'fixtures: ' + (err && err.message ? err.message : String(err)));
  }

  try {
    summary = await lazy.seed.seed();
  }
  catch (err) {
    throw new ToolError('cannot seed the fixtures: ' +
      (err && err.message ? err.message : String(err)));
  }

  note('seeded groups: ' + summary.selected.join(', '));

  context = {
    origin      : started.origin,
    baseUrl     : started.baseUrl,
    server      : started,
    seed        : lazy.seed,
    credentials : lazy.seed.credentials,
    pathValues  : pathValues(lazy.seed),
    seedSummary : {
      selected : summary.selected,
      created  : Object.keys(summary.created || {}).sort()
    },
    // Kept so restartApplication can bring the same server back on the same
    // port against the same database after a crash.
    startOptions: startOptions,
    restarts    : 0
  };

  return context;
}

/**
 * Brings everything down, reporting rather than throwing.
 *
 * A teardown that threw would mask the real failure of a run that was already
 * failing, and every step is independently attempted so one stuck component
 * cannot leave the others running.
 *
 * @returns {Promise<undefined>}
 */
async function teardown() {
  if (lazy.mongoose) {
    try {
      if (lazy.mongoose.connection &&
          lazy.mongoose.connection.readyState !== 0) {
        await lazy.mongoose.disconnect();
      }
    }
    catch (err) {
      note('WARNING: could not disconnect mongoose: ' + err.message);
    }
  }

  if (lazy.server) {
    try {
      await lazy.server.stop();
    }
    catch (err) {
      note('WARNING: could not stop the application: ' + err.message);
    }
  }

  if (lazy.mongo) {
    try {
      await lazy.mongo.stop();
    }
    catch (err) {
      note('WARNING: could not stop the database: ' + err.message);
    }
  }
}


// ---------------------------------------------------------------------------
// The artifact
// ---------------------------------------------------------------------------

// The fixed serialization order of an artifact's top-level keys. Insertion
// order is what JSON.stringify emits, so building every artifact through a
// fixed order is what makes two matrices byte-comparable before the structured
// comparison runs.
var ARTIFACT_KEY_ORDER = [
  'generator',
  'artifactVersion',
  'mode',
  'summary',
  'enumeration',
  'deepCopyProof',
  'orderPolicy',
  'languageMaps',
  'inertness',
  'validationReach',
  'crashes',
  'flashFollow',
  // Null in every mode but `--compare`, where it records how the freshly
  // generated inputs compared with the recorded ones that were actually
  // driven. Always present, so the key order - and therefore a byte diff of
  // two matrices - is stable across modes.
  'crossCheck',
  'targets'
];

// The target-level fields `--compare` checks. `key` is the join key and is
// therefore equal by construction; everything else that describes the target is
// compared, because each of them changes what the case MEANS - `identity`
// decides who drove it, `pre` decides whether validation was reachable, `fail`
// decides which branch of request.fail answered.
var COMPARED_TARGET_FIELDS = [
  'method', 'path', 'section', 'file', 'controller', 'declaredAuth',
  'identity', 'pre', 'preReferences', 'lookupFixtures', 'fail', 'html',
  'success', 'payloadOutput', 'isJoiSchema', 'languageMap', 'leaves'
];

// The per-case fields `--compare` checks: the experiment and its schema-level
// outcome.
var COMPARED_CASE_FIELDS = [
  'kind', 'applicable', 'reason', 'determination', 'transport', 'input',
  'serverVisible', 'schema', 'strategy', 'field', 'sent', 'coercedTo',
  'claimsAcceptance', 'drivePhase'
];

// The per-outcome fields `--compare` checks: everything observable about the
// response.
var COMPARED_HTTP_FIELDS = [
  'status', 'locationRelative', 'contentType', 'renderedMessages',
  'validationFlash', 'bodyKeys', 'followed', 'timedOut', 'error',
  'authBlocked', 'validationObserved', 'flashMatchesProof', 'unseededParams',
  'requestTarget', 'requestContentType', 'precededByCrash'
];

// Recorded but deliberately NOT compared, each for a stated reason:
//   location            The verbatim header, which carries this run's own host
//                       and port. `locationRelative` is the comparable form and
//                       IS compared; the verbatim value is kept so a reviewer
//                       sees exactly what was sent.
//   order               The drive's index in the run. Deterministic, but a
//                       single case becoming inapplicable would shift every
//                       later index and bury the real difference under
//                       hundreds of derived ones. The plan is compared as a
//                       whole through summary.drives instead, and `drivePhase`
//                       - which is stable per case - is compared per case.
//   identity            Already compared at target level; the copy on the
//                       outcome is for reading a single record in isolation.
//   leafPlan,           Generator bookkeeping: HOW the tool searched for an
//   refinementRounds,   input, not what it sent or what came back. The input it
//   generatorNotes,     arrived at is compared, which is the part that decides
//   attempts, reviewed  the experiment.
var NOT_COMPARED_NOTE = 'location (origin-bearing verbatim header; ' +
  'locationRelative is compared), order (drive index; drivePhase is compared ' +
  'instead), identity on the outcome (compared at target level), and the ' +
  'generator bookkeeping fields leafPlan, refinementRounds, generatorNotes, ' +
  'attempts and reviewed.';

/**
 * Assembles the artifact.
 *
 * @param {Object} parts Everything the modes produce.
 * @returns {Object} An object whose keys are in ARTIFACT_KEY_ORDER.
 */
function buildArtifact(parts) {
  var artifact = {};

  ARTIFACT_KEY_ORDER.forEach(function(key) {
    artifact[key] = parts[key] === undefined ? null : parts[key];
  });

  return artifact;
}

/**
 * The run summary.
 *
 * A SUMMARY, NOT THE GATE. Two matrices with identical summaries can differ on
 * a case, which is why `--compare` joins per target and per case and checks
 * every recorded field; these figures exist so a reader can see the shape of a
 * run at a glance and so a mismatch in the shape is reported explicitly.
 *
 * @param {Object} input
 * @returns {Object}
 */
function buildSummary(input) {
  return {
    targets           : input.enumeration.targets,
    payloadTargets    : input.enumeration.payload,
    queryTargets      : input.enumeration.query,
    paramsTargets     : input.enumeration.params,
    languageMaps      : input.enumeration.languageMaps,
    cases             : input.enumeration.targets * CASE_KINDS.length,
    applicableCases   : input.proofs.proved,
    inapplicableCases : input.proofs.notApplicable,
    inapplicableBy    : input.proofs.byDetermination,
    coercionCases     : input.proofs.coercionApplicable,
    reviewedCases     : input.proofs.reviewed,
    drives            : input.drives === null ? null : input.drives.drives,
    drivesTimedOut    : input.drives === null ? null : input.drives.timedOut,
    applicationCrashes: input.drives === null ? null : input.drives.crashes.length,
    applicationRestarts: input.drives === null ? null : input.drives.restarts,
    outcomesWithFlash : input.drives === null ? null : input.drives.observed,
    renderedFollows   : input.flashFollow === null
      ? null
      : input.flashFollow.rendered,
    rejectingReached  : input.validationReach === null
      ? null
      : input.validationReach.reached,
    rejectingUnreached: input.validationReach === null
      ? null
      : input.validationReach.unreached,
    notCompared       : NOT_COMPARED_NOTE
  };
}

/**
 * The provenance sidecar.
 *
 * Kept OUT of the artifact so the artifact stays diff-clean, and written beside
 * it so "captured at baseline" is checkable rather than asserted: it records
 * both tree paths and commits, the joi each side resolved - which is the single
 * most important fact about a capture - the Node version and the effective
 * NODE_CONFIG.
 *
 * `recaptchaConfigured` is recorded because it CHANGES THE TARGET SET: with
 * `app.recaptcha.secretkey` set, `'g-recaptcha-response'` becomes
 * `Joi.string().required()` instead of `.allow('').optional()`, so a capture
 * taken with a secret and one taken without are not comparable. The overlay
 * leaves it unset on both sides and this is the evidence.
 *
 * @param {Object} input
 * @returns {Object}
 */
/**
 * Redacts secret-labelled values out of a serialized NODE_CONFIG, for the
 * provenance record only.
 *
 * Takes the JSON string `prepareEnvironment` composed, parses it, walks it, and
 * replaces the value of every key matching SECRET_KEY_PATTERN with REDACTED.
 * Returns both the re-serialized string and the sorted list of dotted paths it
 * touched, so the caller can declare the redaction alongside the result.
 *
 * A null or empty value is left alone rather than replaced: `db.mongo.pass` is
 * routinely null, and rewriting null to a placeholder would report a credential
 * that was never set. Only a value that actually carries something is redacted,
 * which keeps `redactedKeys` an honest list of what was withheld.
 *
 * Input that will not parse is returned verbatim with an empty path list. This
 * function exists to improve a record, so it must never be the reason a run
 * fails; an unparseable NODE_CONFIG is a problem the server layer surfaces long
 * before provenance is written.
 *
 * @param {string} serialized The composed NODE_CONFIG JSON string.
 * @returns {{nodeConfig: string, redactedKeys: Array<string>}} The redacted
 *   serialization and the dotted paths whose values were withheld.
 */
function redactSecrets(serialized) {
  if (typeof serialized !== 'string' || serialized.length === 0) {
    return { nodeConfig: serialized, redactedKeys: [] };
  }

  var parsed;

  try {
    parsed = JSON.parse(serialized);
  }
  catch (err) {
    return { nodeConfig: serialized, redactedKeys: [] };
  }

  var touched = [];

  function walk(node, trail) {
    if (Array.isArray(node)) {
      node.forEach(function(entry, index) {
        walk(entry, trail.concat('[' + index + ']'));
      });
      return;
    }

    if (!isPlainObject(node)) {
      return;
    }

    Object.keys(node).forEach(function(key) {
      var here  = trail.concat(key);
      var value = node[key];

      if (SECRET_KEY_PATTERN.test(key)) {
        // A key that names a credential but holds nothing is not a credential.
        var empty = value === null || value === undefined || value === '';

        if (!empty && !isPlainObject(value) && !Array.isArray(value)) {
          node[key] = REDACTED;
          touched.push(here.join('.'));
          return;
        }
      }

      walk(value, here);
    });
  }

  walk(parsed, []);

  return {
    nodeConfig  : JSON.stringify(parsed),
    redactedKeys: touched.sort()
  };
}

function buildProvenance(input) {
  var redacted = redactSecrets(input.environment.nodeConfig);

  return {
    generator : 'test/parity/joi-matrix.js',
    capturedAt: new Date().toISOString(),
    mode      : input.mode,
    tool      : {
      root : TOOL_ROOT,
      head : gitHead(TOOL_ROOT)
    },
    app       : {
      root : input.appRoot,
      head : gitHead(input.appRoot)
    },
    versions  : {
      node     : process.version,
      joi      : packageVersion(input.appRoot, 'joi'),
      hapi     : packageVersion(input.appRoot, '@hapi/hapi'),
      mongoose : packageVersion(TOOL_ROOT, 'mongoose')
    },
    environment: {
      NODE_ENV        : input.environment.nodeEnv,
      // The configuration the child actually received, less the values named in
      // redactedKeys. The redaction is applied to this copy only; see
      // SECRET_KEY_PATTERN for why the record is better without them.
      NODE_CONFIG     : redacted.nodeConfig,
      NODE_CONFIG_DIR : input.environment.nodeConfigDir,
      redactedKeys    : redacted.redactedKeys
    },
    recaptchaConfigured : input.recaptchaConfigured,
    server    : input.server === null ? null : {
      origin   : input.server.origin,
      port     : input.server.port,
      secure   : input.server.secure,
      pid      : input.server.pid,
      appRoot  : input.server.appRoot,
      runDir   : input.server.runDir,
      database : input.server.mongo === null || input.server.mongo === undefined
        ? null
        : input.server.mongo.database
    },
    seed      : input.seedSummary === null ? null : input.seedSummary,
    // The one normalization this gate applies, named in the provenance so it
    // travels with the artifact.
    normalization : 'Only the ORIGIN of an absolute Location header is removed, ' +
      'into locationRelative; the verbatim header is recorded beside it. ' +
      'Nothing else is normalized.',
    // Declared beside the normalization for the same reason: a record that
    // withholds something without saying so misrepresents itself.
    redaction : 'environment.NODE_CONFIG has the value of every ' +
      'secret-labelled key replaced with "' + REDACTED + '"; the keys ' +
      'withheld are listed in environment.redactedKeys. The child process ' +
      'received the real configuration - the redaction applies to this ' +
      'record only. The values themselves come from the committed overlay ' +
      '(test/parity/server-overlay.json) and any --overlay the caller passed, ' +
      'which are where a reviewer reproduces them from.'
  };
}

/**
 * Reads `app.recaptcha.secretkey` from the configuration in force.
 *
 * Read through the SAME `config` instance the route modules read, by resolving
 * it inside the tree under test, so this reports what the target set was
 * actually built from and not what a second copy of `config` would say.
 *
 * @param {string} appRoot
 * @returns {boolean}
 */
function recaptchaConfigured(appRoot) {
  var configuration;

  try {
    configuration = requireFromApp(appRoot, 'node_modules/config');
  }
  catch (err) {
    return false;
  }

  return !!(configuration && configuration.app && configuration.app.recaptcha &&
    configuration.app.recaptcha.secretkey);
}


// ---------------------------------------------------------------------------
// PHASE 6 - the comparison
// ---------------------------------------------------------------------------

/**
 * Indexes a matrix's targets by key, rejecting a duplicate.
 *
 * @param {Object} matrix
 * @param {string} label
 * @returns {Object}
 * @throws {ToolError} On a duplicate key.
 */
function indexTargets(matrix, label) {
  var index = {};

  matrix.targets.forEach(function(entry) {
    if (Object.prototype.hasOwnProperty.call(index, entry.key)) {
      throw new ToolError('the ' + label + ' matrix carries two targets keyed `' +
        entry.key + '`; the key is method, path and section, which is unique ' +
        'by construction, so this matrix was not written by this tool.');
    }

    index[entry.key] = entry;
  });

  return index;
}

/**
 * Compares two matrices, target by target and case by case.
 *
 * The pass condition is PER CASE, never aggregate: two matrices with identical
 * summaries can differ on one target's status, and a gate that compared totals
 * would pass. Every field in COMPARED_TARGET_FIELDS, COMPARED_CASE_FIELDS and
 * COMPARED_HTTP_FIELDS is checked for every target, every case and every Accept
 * mode, and each difference is reported with the target key, the case kind, the
 * mode, the input, the baseline value and the target value - which is what a
 * reader needs to decide whether it is a regression.
 *
 * @param {Object} baseline
 * @param {Object} target
 * @returns {{differences: Array.<Object>, onlyInBaseline: string[],
 *            onlyInTarget: string[], compared: Object}}
 */
function compareMatrices(baseline, target) {
  var baselineIndex = indexTargets(baseline, 'baseline');
  var targetIndex = indexTargets(target, 'target');
  var differences = [];
  var onlyInBaseline = [];
  var onlyInTarget = [];
  var compared = { targets: 0, cases: 0, outcomes: 0, fields: 0 };

  function difference(scope, keys, field, left, right) {
    differences.push({
      scope        : scope,
      target       : keys.target === undefined ? null : keys.target,
      case         : keys.kind === undefined ? null : keys.kind,
      mode         : keys.mode === undefined ? null : keys.mode,
      input        : keys.input === undefined ? null : keys.input,
      field        : field,
      baseline     : left === undefined ? null : left,
      targetValue  : right === undefined ? null : right
    });
  }

  function compareFields(scope, keys, fields, left, right) {
    fields.forEach(function(field) {
      compared.fields += 1;

      if (canonical(left[field]) !== canonical(right[field])) {
        difference(scope, keys, field, left[field], right[field]);
      }
    });
  }

  // The summary blocks first. A difference here is not the gate, but it tells a
  // reader immediately whether the two runs were even the same experiment - a
  // baseline captured with --schema-only against a target driven over HTTP
  // would otherwise present as several hundred outcome differences.
  ['enumeration', 'deepCopyProof'].forEach(function(block) {
    var left = baseline[block] || {};
    var right = target[block] || {};

    Object.keys(left).forEach(function(field) {
      compared.fields += 1;

      if (canonical(left[field]) !== canonical(right[field])) {
        difference('summary', { target: block }, field, left[field], right[field]);
      }
    });
  });

  if (canonical(baseline.languageMaps) !== canonical(target.languageMaps)) {
    difference('summary', { target: 'languageMaps' }, 'languageMaps',
      baseline.languageMaps, target.languageMaps);
  }

  ['reached', 'unreached', 'rejectingCases'].forEach(function(field) {
    var left = (baseline.validationReach || {})[field];
    var right = (target.validationReach || {})[field];

    compared.fields += 1;

    if (canonical(left) !== canonical(right)) {
      // The per-target detail is not compared here - every fact behind it is
      // already compared per case, through the status and the flash - but the
      // COUNTS are, because a target that stopped reaching the validation
      // block between the two trees is exactly the kind of change that could
      // otherwise be read as an unrelated status difference.
      difference('summary', { target: 'validationReach' }, field, left, right);
    }
  });

  if (canonical(baseline.crashes) !== canonical(target.crashes)) {
    // A tree that crashes where the other does not is the largest possible
    // behavioural difference, and it is reported as one rather than absorbed
    // by the restart that kept the run going.
    difference('summary', { target: 'crashes' }, 'crashes',
      baseline.crashes, target.crashes);
  }

  if (canonical(baseline.inertness) !== canonical(target.inertness)) {
    // The whole inertness record, compared as one value. The raw joi message is
    // inside it, and it is measured identical on 17.13.3 and 18.2.5 - so a
    // difference here is either a changed joi message or a `language` map that
    // started firing, and both must be read in full rather than as one field.
    difference('summary', { target: 'inertness' }, 'inertness',
      baseline.inertness, target.inertness);
  }

  Object.keys(baselineIndex).sort().forEach(function(key) {
    var left = baselineIndex[key];
    var right = targetIndex[key];
    var index;

    if (!right) {
      onlyInBaseline.push(key);
      return;
    }

    compared.targets += 1;
    compareFields('target', { target: key }, COMPARED_TARGET_FIELDS, left, right);

    if (left.cases.length !== right.cases.length) {
      difference('target', { target: key }, 'cases.length',
        left.cases.length, right.cases.length);
      return;
    }

    for (index = 0; index < left.cases.length; index++) {
      compareCase(key, left.cases[index], right.cases[index]);
    }
  });

  Object.keys(targetIndex).sort().forEach(function(key) {
    if (!baselineIndex[key]) {
      onlyInTarget.push(key);
    }
  });

  function compareCase(key, left, right) {
    var keys = { target: key, kind: left.kind, input: left.input };

    compared.cases += 1;
    compareFields('case', keys, COMPARED_CASE_FIELDS, left, right);

    MODES.forEach(function(mode) {
      var leftOutcome = left.http && left.http[mode];
      var rightOutcome = right.http && right.http[mode];

      if (!leftOutcome && !rightOutcome) {
        return;
      }

      if (!leftOutcome || !rightOutcome) {
        difference('http', { target: key, kind: left.kind, mode: mode,
          input: left.input }, 'outcome',
          leftOutcome ? 'present' : 'absent',
          rightOutcome ? 'present' : 'absent');
        return;
      }

      compared.outcomes += 1;
      compareFields('http',
        { target: key, kind: left.kind, mode: mode, input: left.input },
        COMPARED_HTTP_FIELDS, leftOutcome, rightOutcome);
    });
  }

  return {
    differences    : differences,
    onlyInBaseline : onlyInBaseline,
    onlyInTarget   : onlyInTarget,
    compared       : compared
  };
}

/**
 * Writes the comparison report to stderr and returns it for the artifact.
 *
 * Every difference is named, not counted, and the input is printed with it: a
 * report that said "3 differences" would leave a reader to re-run the gate to
 * find out what they were.
 *
 * @param {Object} result From compareMatrices.
 * @param {string} baselinePath
 * @param {string} targetPath
 * @returns {Object} The report, for writing beside the comparison.
 */
function reportComparison(result, baselinePath, targetPath) {
  var byScope = {};
  var report;

  result.differences.forEach(function(entry) {
    byScope[entry.scope] = (byScope[entry.scope] || 0) + 1;
  });

  report = {
    generator      : 'test/parity/joi-matrix.js',
    baseline       : baselinePath,
    target         : targetPath,
    compared       : result.compared,
    // The scope breakdown, and the one figure a reader wants first.
    // `case`-scope differences are the ONLY ones that are about joi: they are
    // the schema verdicts, messages, paths and coerced values. An `http`-scope
    // difference is about the application's response, which can move for
    // reasons that have nothing to do with validation - a crash, a converted
    // controller - so a run with 28 http differences and 0 case differences is
    // reporting that accept/reject parity HELD and something else changed.
    // Separating them here is what stops the joi answer being lost in the
    // list.
    differencesByScope : byScope,
    schemaLevelDifferences : byScope.case || 0,
    generatedInputDifferences : byScope['generated-input'] || 0,
    differences    : result.differences,
    onlyInBaseline : result.onlyInBaseline,
    onlyInTarget   : result.onlyInTarget,
    notCompared    : NOT_COMPARED_NOTE
  };

  note('compared ' + result.compared.targets + ' target(s), ' +
    result.compared.cases + ' case(s), ' + result.compared.outcomes +
    ' outcome(s), ' + result.compared.fields + ' field(s)');
  note('schema-level differences (the joi accept/reject question): ' +
    report.schemaLevelDifferences);
  note('generated-input differences (describe() parity): ' +
    report.generatedInputDifferences);

  Object.keys(byScope).sort().forEach(function(scope) {
    note('  ' + scope + ' scope: ' + byScope[scope] + ' difference(s)');
  });

  result.onlyInBaseline.forEach(function(key) {
    note('ONLY IN BASELINE  ' + key);
  });

  result.onlyInTarget.forEach(function(key) {
    note('ONLY IN TARGET    ' + key);
  });

  result.differences.forEach(function(entry) {
    note('DIFFERENCE  [' + entry.scope + '] ' + entry.target +
      (entry.case ? ' ' + entry.case : '') +
      (entry.mode ? ' [' + entry.mode + ']' : '') + ' ' + entry.field);
    note('  input     ' + canonical(entry.input));
    note('  baseline  ' + canonical(entry.baseline));
    note('  target    ' + canonical(entry.targetValue));
  });

  if (!result.differences.length && !result.onlyInBaseline.length &&
      !result.onlyInTarget.length) {
    note('no differences: accept/reject parity holds across every target, ' +
      'every case and both Accept modes.');
  }

  return report;
}


// ---------------------------------------------------------------------------
// The modes
// ---------------------------------------------------------------------------

/**
 * Replays a recorded matrix's inputs onto freshly generated cases.
 *
 * This is what makes `--compare` a comparison of ONE experiment run twice. The
 * recorded `input` and `serverVisible` replace the generated ones, and the
 * local schema proof is then RE-RUN on the recorded input against the tree
 * under test's joi - which is precisely the measurement the gate exists for:
 * does joi 18.2.5 accept and reject exactly what joi 17.13.3 accepted and
 * rejected, given the same bytes.
 *
 * The generated inputs are not discarded. They are cross-checked against the
 * recorded ones and every divergence is reported in its own right, because a
 * `describe()` that changed between the two versions is a finding a reviewer
 * wants to see - it just must not be allowed to silently turn the comparison
 * into two different experiments.
 *
 * @param {Array.<Object>} entries Serialized target entries, modified in place.
 * @param {Object} compiled key -> {schema, leaves}.
 * @param {Object} recorded The baseline matrix.
 * @returns {{replayed: number, divergences: Array.<Object>,
 *            missing: string[]}}
 */
function replayRecordedInputs(entries, compiled, recorded) {
  var index = indexTargets(recorded, 'baseline');
  var divergences = [];
  var missing = [];
  var replayed = 0;

  entries.forEach(function(entry) {
    var source = index[entry.key];

    if (!source) {
      missing.push(entry.key);
      return;
    }

    entry.cases.forEach(function(record, position) {
      var recordedCase = source.cases[position];
      var visible;

      if (!recordedCase || recordedCase.kind !== record.kind) {
        divergences.push({
          target   : entry.key,
          case     : record.kind,
          field    : 'case-position',
          baseline : recordedCase ? recordedCase.kind : null,
          target_  : record.kind
        });
        return;
      }

      if (canonical(recordedCase.input) !== canonical(record.input)) {
        divergences.push({
          target   : entry.key,
          case     : record.kind,
          field    : 'input',
          baseline : recordedCase.input,
          target_  : record.input
        });
      }

      if (canonical(recordedCase.serverVisible) !== canonical(record.serverVisible)) {
        divergences.push({
          target   : entry.key,
          case     : record.kind,
          field    : 'serverVisible',
          baseline : recordedCase.serverVisible,
          target_  : record.serverVisible
        });
      }

      if (canonical(recordedCase.applicable) !== canonical(record.applicable)) {
        divergences.push({
          target   : entry.key,
          case     : record.kind,
          field    : 'applicable',
          baseline : recordedCase.applicable,
          target_  : record.applicable
        });
      }

      // The recorded experiment wins from here on.
      record.input         = recordedCase.input;
      record.serverVisible = recordedCase.serverVisible;
      record.transport     = recordedCase.transport;
      record.applicable    = recordedCase.applicable;
      record.reason        = recordedCase.reason;
      record.determination = recordedCase.determination === undefined
        ? record.determination
        : recordedCase.determination;
      record.strategy      = recordedCase.strategy === undefined
        ? record.strategy
        : recordedCase.strategy;
      record.field         = recordedCase.field === undefined
        ? record.field
        : recordedCase.field;
      record.sent          = recordedCase.sent === undefined
        ? record.sent
        : recordedCase.sent;

      if (!record.applicable) {
        record.schema = null;
        return;
      }

      visible = record.serverVisible === null || record.serverVisible === undefined
        ? record.input
        : record.serverVisible;

      // Re-proved against THIS tree's joi, on the recorded bytes.
      record.schema = validateLocally(compiled[entry.key].schema, visible);

      if (record.kind === CASE_COERCION && isPlainObject(record.schema.value) &&
          record.field) {
        record.coercedTo = record.schema.value[record.field];
      }

      replayed += 1;
    });
  });

  return { replayed: replayed, divergences: divergences, missing: missing };
}

/**
 * Builds a matrix for the tree under test.
 *
 * @param {Object} options Parsed arguments.
 * @param {string} mode 'capture', 'schema-only' or 'compare'.
 * @param {(Object|null)} recorded A baseline matrix to replay, or null.
 * @returns {Promise<{artifact: Object, provenance: Object,
 *                    crossCheck: (Object|null), deferred: (Error|null)}>}
 */
async function buildMatrix(options, mode, recorded) {
  var wantsHttp = mode !== 'schema-only';
  var database = { provisioned: false, uri: null, overlay: null };
  var environment;
  var loaded;
  var targets;
  var maps;
  var enumeration;
  var deepCopyProof;
  var compiled = {};
  var entries;
  var crossCheck = null;
  var proofs;
  var context = null;
  var drives = null;
  var flashFollow = null;
  var validationReach = null;
  var inertness;
  var deferred = null;

  assertAppRoot(options.appRoot);

  if (wantsHttp) {
    loadSiblings();
    // BEFORE prepareEnvironment, so `config` freezes against the overlay this
    // run will serve with. See publishDatabaseAddress.
    database = await publishDatabaseAddress(options);
  }

  environment = prepareEnvironment(options.appRoot);
  loaded      = harvest(options.appRoot);
  targets     = enumerateTargets(loaded, fixtureIds());
  maps        = languageMaps(loaded);
  enumeration = buildEnumeration(targets, maps, loaded);

  assertEnumeration(enumeration, maps);

  deepCopyProof = buildDeepCopyProof(loaded, enumeration);

  note('enumerated ' + enumeration.targets + ' target(s): ' +
    enumeration.payload + ' payload, ' + enumeration.query + ' query, ' +
    enumeration.params + ' params, plus ' + enumeration.languageMaps +
    ' language map(s); joi ' + (packageVersion(options.appRoot, 'joi') || '?') +
    ' from ' + options.appRoot);

  entries = targets.map(function(target) {
    var built = buildCases(loaded.joi, target);

    compiled[target.key] = { schema: built.schema, leaves: built.leaves };

    return serializeTarget(target, built.cases, built.leaves);
  });

  if (recorded) {
    crossCheck = replayRecordedInputs(entries, compiled, recorded);

    note('replayed the recorded inputs for ' + crossCheck.replayed + ' case(s)');

    if (crossCheck.divergences.length) {
      note('WARNING: ' + crossCheck.divergences.length + ' generated input(s) ' +
        'diverge from the recorded ones; the recorded ones were driven and ' +
        'every divergence is reported.');
    }
  }

  proofs = assertCaseProofs(entries);

  if (wantsHttp) {
    context = await startInfrastructure(options, database);
    drives  = await driveAll(context, entries);
    validationReach = buildValidationReach(entries);

    note('validation reach: ' + validationReach.reached + ' of ' +
      validationReach.rejectingCases + ' rejecting case(s) reached the ' +
      'validation block');
  }

  inertness = buildInertnessRecord(entries, maps);

  // The two BEHAVIOURAL assertions - the flash-follow proof and the inertness
  // of the `language` maps - are deferred rather than thrown, and the artifact
  // is written either way. An assertion failure is a finding about the
  // application, and the artifact is the evidence FOR that finding: a gate that
  // wrote nothing when it failed would leave a reader to re-run it blind. The
  // caller writes the artifact and then raises this.
  try {
    if (wantsHttp) {
      flashFollow = assertFlashFollow(entries);

      note('flash-follow proof: ' + flashFollow.rendered + ' followed page(s) ' +
        'rendered a validation message');
    }

    assertInertness(inertness);

    note('inertness: ' + inertness.map(function(entry) {
      return entry.route + ' -> ' +
        (entry.customSubstituted ? 'SUBSTITUTED' : 'raw joi message');
    }).join('; '));
  }
  catch (err) {
    deferred = err;
  }

  return {
    deferred : deferred,
    artifact : buildArtifact({
      generator       : 'test/parity/joi-matrix.js',
      artifactVersion : 1,
      mode            : mode,
      summary         : buildSummary({
        enumeration     : enumeration,
        proofs          : proofs,
        drives          : drives,
        flashFollow     : flashFollow,
        validationReach : validationReach
      }),
      enumeration     : enumeration,
      deepCopyProof   : deepCopyProof,
      orderPolicy     : ORDER_POLICY,
      languageMaps    : maps,
      inertness       : inertness,
      validationReach : validationReach,
      crashes         : drives === null ? null : drives.crashes,
      flashFollow     : flashFollow,
      crossCheck      : crossCheck,
      targets         : entries
    }),
    provenance : buildProvenance({
      mode                : mode,
      appRoot             : options.appRoot,
      environment         : environment,
      recaptchaConfigured : recaptchaConfigured(options.appRoot),
      server              : context === null ? null : context.server,
      seedSummary         : context === null ? null : context.seedSummary
    }),
    crossCheck : crossCheck
  };
}

/**
 * `--capture` and `--schema-only`.
 *
 * @param {Object} options Parsed arguments.
 * @returns {Promise<number>} An exit code.
 */
async function runCapture(options) {
  var out = options.out || DEFAULT_OUT;
  var built;

  try {
    built = await buildMatrix(options, options.mode, null);
  }
  finally {
    await teardown();
  }

  writeArtifact(out, serialize(built.artifact));
  writeArtifact(out + '.provenance.json', serialize(built.provenance));

  note('wrote ' + out);
  note('wrote ' + out + '.provenance.json');

  // Raised only now, so the artifact that evidences the failure is on disk.
  if (built.deferred) {
    throw built.deferred;
  }

  return EXIT_OK;
}

/**
 * `--compare`.
 *
 * With one path the recorded inputs are replayed against the tree under test
 * and the result is compared with the recording. With two, two recordings are
 * compared offline - which is also how the negative control is run: perturb one
 * recorded outcome and this must exit non-zero naming that case.
 *
 * @param {Object} options Parsed arguments.
 * @returns {Promise<number>} An exit code.
 */
async function runCompare(options) {
  var out = options.out || path.join(__dirname, 'joi-comparison.json');
  var baseline = readMatrix(options.compare[0]);
  var targetMatrix;
  var targetPath;
  var built;
  var result;
  var report;

  if (options.compare.length === 2) {
    targetMatrix = readMatrix(options.compare[1]);
    targetPath   = options.compare[1];
  }
  else {
    try {
      built = await buildMatrix(options, 'compare', baseline);
    }
    finally {
      await teardown();
    }

    targetMatrix = built.artifact;
    targetPath   = out + '.target.json';

    writeArtifact(targetPath, serialize(targetMatrix));
    writeArtifact(out + '.provenance.json', serialize(built.provenance));
    note('wrote ' + targetPath);
    note('wrote ' + out + '.provenance.json');
  }

  result = compareMatrices(baseline, targetMatrix);

  // A generator divergence is a difference in its own right, folded into the
  // same report so one exit code covers both.
  if (targetMatrix.crossCheck) {
    targetMatrix.crossCheck.divergences.forEach(function(entry) {
      result.differences.push({
        scope       : 'generated-input',
        target      : entry.target,
        case        : entry.case,
        mode        : null,
        input       : null,
        field       : entry.field,
        baseline    : entry.baseline,
        targetValue : entry.target_
      });
    });

    targetMatrix.crossCheck.missing.forEach(function(key) {
      result.onlyInTarget.push(key);
    });
  }

  report = reportComparison(result, options.compare[0], targetPath);

  writeArtifact(out, serialize(report));
  note('wrote ' + out);

  // A deferred behavioural failure on the target is raised after the report is
  // written, for the reason runCapture gives - and it is raised rather than
  // folded into the difference list, because it is an assertion about the tree
  // under test on its own terms and not a comparison with the baseline.
  if (built && built.deferred) {
    throw built.deferred;
  }

  return result.differences.length || result.onlyInBaseline.length ||
    result.onlyInTarget.length
    ? EXIT_DIFFERENCE
    : EXIT_OK;
}


// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Runs the tool and resolves with an exit code.
 *
 * Separated from `main` so a test can drive it without the process exiting, and
 * so the three exit codes are decided in one place: 0 for success, 1 for a
 * parity difference or a failed behavioural invariant, 2 for a usage or
 * operational failure. A caller must be able to tell "the gate found a
 * difference" from "the gate could not run", and a tool that collapsed those
 * into a single non-zero would make a broken database look like a regression.
 *
 * @param {string[]} args process.argv.slice(2)
 * @param {string} originalCwd The working directory at process start.
 * @returns {Promise<number>} An exit code.
 */
async function run(args, originalCwd) {
  var options;

  try {
    options = parseArguments(args, originalCwd);
  }
  catch (err) {
    note('ERROR: ' + err.message);
    process.stderr.write(USAGE + '\n');
    return EXIT_ERROR;
  }

  if (options.mode === 'help') {
    process.stderr.write(USAGE + '\n');
    return EXIT_OK;
  }

  try {
    if (options.mode === 'compare') {
      return await runCompare(options);
    }

    return await runCapture(options);
  }
  catch (err) {
    if (err instanceof ParityError) {
      note('PARITY FAILURE: ' + err.message);
      return EXIT_DIFFERENCE;
    }

    if (err instanceof ToolError) {
      note('ERROR: ' + err.message);
      return EXIT_ERROR;
    }

    // Anything else is a defect in this tool or in the tree under test, and its
    // stack is the only useful thing to say about it.
    note('UNEXPECTED FAILURE: ' + (err && err.stack ? err.stack : String(err)));
    return EXIT_ERROR;
  }
}

/**
 * The CLI.
 *
 * `process.exitCode` is set rather than `process.exit()` being called, so
 * stderr is flushed and any handle the lifecycle owners still hold is released
 * before the process ends. The working directory is captured BEFORE anything
 * runs, because the harvest chdirs into the tree under test and a relative
 * `--out` must still resolve against where the caller stood.
 *
 * @returns {undefined}
 */
function main() {
  var originalCwd = process.cwd();

  run(process.argv.slice(2), originalCwd)
    .then(function(code) {
      process.exitCode = code;
    })
    .catch(function(err) {
      note('UNEXPECTED FAILURE: ' + (err && err.stack ? err.stack : String(err)));
      process.exitCode = EXIT_ERROR;
    });
}

module.exports = {
  // The modes.
  run         : run,
  main        : main,
  buildMatrix : buildMatrix,
  runCapture  : runCapture,
  runCompare  : runCompare,

  // The comparison, exported so the negative control can be driven in process
  // as well as through the CLI.
  compareMatrices : compareMatrices,
  readMatrix      : readMatrix,
  indexTargets    : indexTargets,

  // Building blocks, exported because each has a failure mode worth testing
  // directly rather than through a whole run - a deep copy that shared a
  // container, a candidate ladder that could not satisfy a pattern, a
  // transport that stringified the wrong thing, a `language` lookup that
  // started matching.
  parseArguments          : parseArguments,
  parsePort               : parsePort,
  isPlainObject           : isPlainObject,
  deepCopy                : deepCopy,
  deepMerge               : deepMerge,
  jsonSafe                : jsonSafe,
  serialize               : serialize,
  canonical               : canonical,
  composeNodeConfig       : composeNodeConfig,
  prepareEnvironment      : prepareEnvironment,
  requireFromApp          : requireFromApp,
  assertAppRoot           : assertAppRoot,
  harvest                 : harvest,
  routeInfo               : routeInfo,
  preDescriptors          : preDescriptors,
  preReferences           : preReferences,
  referencedKeys          : referencedKeys,
  lookupSubstitutions     : lookupSubstitutions,
  applySubstitutions      : applySubstitutions,
  identityFor             : identityFor,
  enumerateTargets        : enumerateTargets,
  languageMaps            : languageMaps,
  buildEnumeration        : buildEnumeration,
  assertEnumeration       : assertEnumeration,
  buildDeepCopyProof      : buildDeepCopyProof,
  fixtureIds              : fixtureIds,
  compileSection          : compileSection,
  validateLocally         : validateLocally,
  describeLeaves          : describeLeaves,
  rulesOf                 : rulesOf,
  targetLength            : targetLength,
  filler                  : filler,
  dedupe                  : dedupe,
  candidatesFor           : candidatesFor,
  pickCandidate           : pickCandidate,
  buildAcceptingInput     : buildAcceptingInput,
  rejectionPriority       : rejectionPriority,
  violationsFor           : violationsFor,
  buildRejectingInput     : buildRejectingInput,
  buildCoercionInput      : buildCoercionInput,
  transportFor            : transportFor,
  isTextTransport         : isTextTransport,
  projectValue            : projectValue,
  serverVisible           : serverVisible,
  shapeFallbacks          : shapeFallbacks,
  isDeliverable           : isDeliverable,
  reviewedReason          : reviewedReason,
  buildCases              : buildCases,
  assertCaseProofs        : assertCaseProofs,
  serializeTarget         : serializeTarget,
  substituteCustomMessage : substituteCustomMessage,
  buildInertnessRecord    : buildInertnessRecord,
  assertInertness         : assertInertness,
  Jar                     : Jar,
  exchange                : exchange,
  decodeEntities          : decodeEntities,
  renderedMessages        : renderedMessages,
  jsonValidationFlash     : jsonValidationFlash,
  relativeLocation        : relativeLocation,
  pathValues              : pathValues,
  materializePath         : materializePath,
  requestTarget           : requestTarget,
  requestBody             : requestBody,
  login                   : login,
  recordOutcome           : recordOutcome,
  driveCase               : driveCase,
  planDrives              : planDrives,
  isUnreachable           : isUnreachable,
  restartApplication      : restartApplication,
  driveAll                : driveAll,
  buildValidationReach    : buildValidationReach,
  assertFlashFollow       : assertFlashFollow,
  replayRecordedInputs    : replayRecordedInputs,
  buildArtifact           : buildArtifact,
  buildSummary            : buildSummary,
  buildProvenance         : buildProvenance,
  redactSecrets           : redactSecrets,
  recaptchaConfigured     : recaptchaConfigured,
  reportComparison        : reportComparison,
  loadSiblings            : loadSiblings,
  publishDatabaseAddress  : publishDatabaseAddress,
  startInfrastructure     : startInfrastructure,
  teardown                : teardown,

  // Reference values, so a harness asserts against the same constants this
  // file uses rather than a second copy of them.
  EXPECTED                : EXPECTED,
  EXPECTED_LANGUAGE_ROUTES: EXPECTED_LANGUAGE_ROUTES,
  LANGUAGE_MATCH_KEY      : LANGUAGE_MATCH_KEY,
  LANGUAGE_FIELD          : LANGUAGE_FIELD,
  CASE_KINDS              : CASE_KINDS,
  CASE_ACCEPTING          : CASE_ACCEPTING,
  CASE_REJECTING          : CASE_REJECTING,
  CASE_COERCION           : CASE_COERCION,
  MODES                   : MODES,
  ACCEPT_HEADER           : ACCEPT_HEADER,
  NOT_APPLICABLE          : NOT_APPLICABLE,
  LOOKUP_FIXTURES         : LOOKUP_FIXTURES,
  DETERMINATION_SCHEMA    : DETERMINATION_SCHEMA,
  DETERMINATION_TRANSPORT : DETERMINATION_TRANSPORT,
  DETERMINATION_UNRESOLVED: DETERMINATION_UNRESOLVED,
  REVIEWED_UNDRIVABLE     : REVIEWED_UNDRIVABLE,
  ORDER_POLICY            : ORDER_POLICY,
  ARTIFACT_KEY_ORDER      : ARTIFACT_KEY_ORDER,
  COMPARED_TARGET_FIELDS  : COMPARED_TARGET_FIELDS,
  COMPARED_CASE_FIELDS    : COMPARED_CASE_FIELDS,
  COMPARED_HTTP_FIELDS    : COMPARED_HTTP_FIELDS,
  DEFAULT_OUT             : DEFAULT_OUT,
  TOOL_ROOT               : TOOL_ROOT,
  REQUEST_TIMEOUT_MS      : REQUEST_TIMEOUT_MS,
  MAX_RESTARTS            : MAX_RESTARTS,
  UNREACHABLE             : UNREACHABLE,
  SECRET_KEY_PATTERN      : SECRET_KEY_PATTERN,
  REDACTED                : REDACTED,
  EXIT_OK                 : EXIT_OK,
  EXIT_DIFFERENCE         : EXIT_DIFFERENCE,
  EXIT_ERROR              : EXIT_ERROR,
  ToolError               : ToolError,
  ParityError             : ParityError,
  USAGE                   : USAGE
};

if (require.main === module) {
  main();
}

