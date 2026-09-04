#!/usr/bin/env node
'use strict';

// The joi validation accept/reject parity gate: every validation target the
// route declarations carry, three cases each, driven against a running
// application and compared with a recorded baseline.
//
// A target's accepting, rejecting and coercion case is built from a pre-parse
// copy of the declarations, proved locally against its own schema, driven in
// both `Accept` modes, and compared field for field with the baseline
// recording. What is compared is the OBSERVABLE OUTCOME - the status, redirect
// target and rendered flash of the response `request.fail` produced - never
// joi's return value. That response exists because the hand-rolled block
// validates in hapi's place: `@hapi/hapi` rejects the plain-object shorthand
// unless a validator is registered and the application registers none, so
// `lib/util/routeParser.js`'s block answers a redirect where native validation
// would answer 400.
//
// INVOCATION - artifacts go to `--out`, AND BOTH STREAMS ARE DISCARDED
//   Enumerating the targets calls `parseRoutes`, which dynamically requires
//   every controller: `lib/controllers/users.js` creates the exports queue at
//   module load and prints its queue line on stdout, and the tree under test
//   may print dependency notices on stderr. Neither is suppressible from here,
//   so a caller discards both streams and reads the artifact off disk. `--out`
//   is required in every mode and nothing is replaced without `--overwrite`;
//   USAGE below carries the whole flag set.
//
//   node test/parity/joi-matrix.js --compare test/parity/joi-baseline.json \
//     --out <report>.json --overwrite >/dev/null 2>/dev/null
//
//   `--capture --app <worktree>` records the other side, `--compare <a> <b>
//   --allow-same-tree` compares two recordings offline, and `--schema-only`
//   proves the cases with no database and no socket.
//
// ARTIFACT
//   The matrix at `--out`. Its top-level keys are ARTIFACT_SCHEMA below, which
//   comments each one: the enumeration and its proofs, the run policies, the
//   seeded state driven against, the evidence blocks, and `targets` - one entry
//   per target, with each case's input and the outcome it produced. Provenance
//   is sealed into the SIBLING file `<out>.provenance.json`, never into the
//   artifact, so the artifact stays diffable while the sidecar records which
//   tree, which joi and which configuration wrote it and `--compare` can verify
//   both sides before comparing. A live `--compare` also writes the matrix it
//   drove to `<out>.target.json`, with a sidecar of its own.
//
// PROVENANCE IS EMBEDDED IN THE ARTIFACT, under its own `provenance` key, and
// the artifact is therefore self-authenticating: it names the tree it measured,
// the joi that produced its verdicts and the generator that wrote it, and it is
// hash-linked to all three by a payload digest taken over itself WITHOUT that
// key. `--compare` recomputes that digest and resolves the recorded generator
// blob and commit in THIS repository before it compares anything, and refuses a
// comparison that cannot be evidence - the same file twice, a baseline side
// that was not captured, or two recordings from one application HEAD or one joi
// major.
//
// A sidecar, `<out>.provenance.json`, is still written beside every artifact,
// and it is a RUN OUTPUT rather than part of the delivery: it adds a digest of
// the exact bytes plus the two things that may not be committed - the
// warning-gate verdict, which names the stderr files it read, and this run's
// own addressing. Nothing requires it to exist, and a committed recording has
// none. A live `--compare` writes the matrix it drove to `<out>.target.json`
// and THAT matrix's sidecar to `<out>.target.json.provenance.json`, beside the
// file it describes rather than beside the report.
//
// This is not how the file started. It wrote a sidecar in a vocabulary of its
// own and embedded nothing, so the delivered `joi-baseline.json` carried no
// provenance block - and the validator in this very file, which accepts the
// shared contract's roles and fields, refused it. The committed evidence was
// rejected by its own generator (SEAM-F08, RULE-F06). The record is now built,
// attached and validated through the shared contract in
// test/parity/manifest.js, whose portability guard THROWS on a value the
// repository cannot reproduce - which is what keeps an absolute worktree root,
// a live PID or a wall clock out of a committed artifact (RULE-F21) - and whose
// verified generator identity is what keeps a block from naming a commit whose
// tree does not hold the blob that ran.
//
// A `--capture` run is also a claim about the BASE COMMIT (AAP 0.10.3) and is
// enforced as one: `resolveRole` refuses a capture against another tree, and
// `--allow-nonbaseline` is the only escape - it records the artifact as
// unreviewed, which no gate accepts.
//
// THIS FILE EMITS NO DEPRECATION WARNING OF ITS OWN, and that is measured
// rather than asserted: it uses `new URL` and never `url.parse` (DEP0169), and
// `Buffer.byteLength` and never `new Buffer` (DEP0005). One warning does appear
// under `--pending-deprecation`, and it belongs to neither this file nor the
// framework:
//     DEP0005 at node_modules/compress-commons/lib/archivers/zip/constants.js
// reached because proving the parser deletes `validate` means calling
// `parseRoutes`, which dynamically requires every controller, one of which
// requires `archiver` 2.1.1 - a package AAP §0.5.1.5 defers as unmaintained
// but functional.
//
// THAT IS THIS RUN'S NOTICE TO ANSWER FOR, AND IT FAILS THE RUN. An earlier
// version of this file discarded both streams and reasoned that the notice was
// "owned by AAP §0.9.3's warning gate" - but §0.9.3's gate is not a place, it
// is a condition, and this process is one of the places it is measured. So the
// gate is applied here, by the same policy the three sibling gates apply:
// test/parity/warning-policy.js, no allowances, the required flags as a
// precondition. Two streams are judged - this process, which loads every
// controller, and the application child's captured stderr across every start
// and restart - and a notice in either exits non-zero.
//
// The verdict is recorded in the RUN-OUTPUT sidecar and never in the artifact,
// for two independent reasons. The artifact is diffed field-for-field against
// the baseline recording, and a baseline install legitimately emits the AWS SDK
// v2 notice that only the target's config/aws.js suppresses, so putting the
// warning record inside the artifact would manufacture a validation-parity
// difference out of a warning difference. And the verdict names the absolute
// paths of the stderr files it read, which is exactly the host state the
// embedded block may not carry.
//
// THAT WARNING IS NOW MEASURED AND FATAL, not merely described. This tool had
// no warning gate at all, so the same warning a storage run surfaces passed
// here unseen. Every process warning raised while the matrix is built is now
// captured with its origin frames, recorded in the artifact under `warnings`,
// and folded into the SINGLE exit predicate below. There is no allowance list
// and none may be added: the AAP approves exactly two deviations - the
// lib/controllers/files.js image-stream response (§0.7) and the `marked` audit
// high (§0.5.1.4) - and neither of them is a warning. Under
// `--pending-deprecation` this tool therefore exits non-zero on this tree,
// naming DEP0005 and the compress-commons frame that raises it, which is the
// honest report: the warning is real and its owner is the dependency
// inventory.
//
// ===========================================================================
// THE EXIT PREDICATE - ONE FAILURE SET, ASSEMBLED ONCE, READ ONCE
// ===========================================================================
// The code came from two places - `runCapture` returned success or threw the
// deferred behavioural failure, `runCompare` derived one from the difference
// list - and neither could see a captured warning or an unexplained
// outcome-proof mismatch. Both now feed `buildGate`, and every mode returns
// `deriveExitCode(gate)`:
//
//   warning         a captured process warning
//   proof-mismatch  a recorded `flashMatchesProof: false` that no declared
//                   rule explains
//   rule-unmatched  a declared rule that explained NOTHING, so the rule set
//                   has rotted into a rubber stamp
//   difference      a parity difference, including only-in-baseline and
//                   only-in-target targets
//   invariant       a deferred behavioural assertion that failed
//   operational     the gate could not run - the only kind that answers 2
//
// FORTY RECORDED OUTCOME-PROOF MISMATCHES USED TO AFFECT NOTHING. They are now
// classified against a named, enumerated rule set, the classification is in the
// artifact, and an unclassified one is fatal. The two mechanisms - a path-less
// object-level joi error, and a `payload: {output: 'file'}` route that never
// sees the body the case sent - are documented at PROOF_MISMATCH_RULES with the
// measured evidence for each.
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
// rejecting  One violation. Where the page this target's failure redirects to
//            RENDERS a field the schema lets this tool violate, that field is
//            chosen first - the case then proves the same joi verdict AND that
//            the message reaches the client, which is what R-e asks of it
//            (renderedRedirectFields; it steers exactly one target on this
//            checkout, `POST /courses` from `courseType` to `name`, and never
//            the two `language`-map targets, whose PHASE 5 inertness assertion
//            is measured ON their rejecting message). Otherwise leaves bearing
//            a regex are preferred, because that is where the joi message text
//            was measured; then `.invalid(...)`, which for the two `username`
//            targets is a 51-entry reserved list spread from
//            config/reserved.yaml.
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
// THE MEASURED RESULT - baseline 2f8712a at joi 17.13.3 / hapi 20.3.0 against
// this tree at joi 18.2.5 / hapi 21.4.10, both on node v22.23.2. The target
// commit is deliberately NOT named here: this comment lives in the file whose
// bytes the comparison records, so a hash written into it would be the hash of
// the tree BEFORE the write. The authoritative pair is in the artifact -
// `targetComparison.baseline.head` and `.target.head` - and in the sidecar's
// `tool.head`/`tool.digest`, all of which are sealed after the fact.
// ===========================================================================
// Every figure below is read from the committed artifact, and the artifact was
// produced by the two commands in `notes.reproduce`. `--compare` exited 0.
//
//   102 targets - 75 payload, 26 query, 1 params, plus the 2 `language` maps
//   306 case records, 231 applicable, 75 inapplicable
//       (74 schema-admits-none, 1 transport-admits-none)
//   462 drives, in both Accept modes
//   15678 fields compared, per target, per case and per Accept mode
//
//   case scope             0 differences. Every schema-level verdict is
//                          identical: accepted or rejected, the joi MESSAGES
//                          verbatim, the error PATHS, and the value joi
//                          returned after coercion. THIS IS THE EVIDENCE FOR
//                          THE JOI BUMP, and it is what R-c's "stated reason"
//                          rests on.
//   generated-input scope  0 differences. The recorded inputs were re-generated
//                          against joi 18 and cross-checked against the ones
//                          joi 17 actually drove: 231 replayed, 0 divergent,
//                          0 missing. So the two runs are the same experiment
//                          as well as the same bytes.
//   target scope           0 differences. Same 102 targets, same 75/26/1 split,
//                          same identities, pre-handlers, lookup fixtures and
//                          fail specs.
//   summary scope          0 differences. The `language` maps are byte-identical
//                          and inert on both versions, the crash lists are both
//                          empty, and the validation reach is the same on both.
//   http scope             0 differences. Status, Location, content type,
//                          rendered messages, the validation flash, body shape
//                          and the request actually sent all match.
//
// TOTAL: 0 differences, in every scope. `onlyInBaseline` and `onlyInTarget` are
// both empty.
//
// THE BEHAVIOURAL INVARIANTS EACH SIDE SATISFIED, identical on both:
//   0 application crashes and 0 restarts. The seeded state is restored before
//     each of the 386 non-GET drives (§RESTORE_POLICY), which is what removed
//     the seven crashes an earlier run of this gate recorded: the duplicate
//     `{_owner, slug}` save at `POST /api/folders` and the two `zipCode`
//     rejections at draft/autosave were all consequences of one drive
//     inheriting another's writes.
//   100 of 101 rejecting cases REACH the hand-rolled block, 0 unresolved. The
//     one that does not is `PUT .../materials/{materialId}/move payload`, and it
//     carries a reviewed reason rather than being counted as parity evidence:
//     the declaration passes two arguments to a `findById` factory that reads a
//     two-argument call's second argument as its callback, so every request to
//     that route throws `TypeError: next is not a function` before validation.
//     Measured on BOTH trees, all six drives. It is an application defect in
//     lib/util/helpers.js and config/api_routes.js, outside this file.
//   218 outcomes carry a validation flash, and every one of them MATCHES a
//     proof computed by re-executing the WHOLE validate block on the values
//     that drive presented - 0 mismatches - because the block iterates every
//     declared section, so a `query` drive on a route that also declares
//     `payload` legitimately produces an extra `''` key. 0 accepting or
//     coercion outcomes produced an unexpected flash.
//   3 of 3 applicable cases render a validation message on the page their
//     redirect leads to, across 10 `fail.redirect` candidates:
//       * `POST /login`   -> /login       shows `"email" is required`
//       * `POST /users`   -> /signup      shows `"email" must be a valid email`
//                                         and `"password" length must be at
//                                         least 3 characters long`
//       * `POST /courses` -> /courses/new shows `"name" length must be less
//                                         than or equal to 140 characters long`
//     Applicability is derived from the DECLARATION and the template chain,
//     never from the observation, and a determination is recorded for all 10
//     candidates. Two of the three exist because the rejecting ladder is
//     STEERED toward a field the fail-redirect page renders where the schema
//     admits one (renderedRedirectFields) - and `POST /users` is steered
//     without moving its primary violation, because PHASE 5 measures the inert
//     `username` message on it: `email` and `password` are violated BESIDE
//     `username` and recorded in `additionalViolations`, and `formName` is
//     planted with the value that solves the declared `/{formName}` redirect
//     against the literal GET route table. The 7 remaining candidates cannot
//     render on any input - 5 lead to templates that render
//     `flash.validation` for no field at all (`users/account.html` twice,
//     `users/forgotpass.html` three times), and 2 interpolate `/{redirectTo}`
//     from a key their section does not declare.
//   2 drives time out, both `POST /api/users/email payload accepting`, and
//     identically on both trees: the handler resolves only from a callback it
//     passes to `Store.set` as a third argument, and `Store.set` is an arity-2
//     async function that ignores it, so nothing ever answers. The controller
//     comments this as a preserved defect. A timeout is a RECORDED RESULT here
//     rather than a harness failure - but not a silent one: each is named in
//     the artifact's `timeouts` block with the reviewed reason its route does
//     not answer, the list is compared between the two trees so a timeout that
//     moved would report as a difference, and a timeout with no reviewed reason
//     fails the run (assertEvidence). 0 are unreviewed.
//
// WHAT THIS DOES NOT CLAIM. The gate compares the OBSERVABLE outcome, and the
// fields it deliberately does not compare are named in `summary.notCompared`
// and enforced by assertFieldCoverage - a field that is neither compared nor
// excused with a reason fails the run, so this list cannot quietly grow.

// Node core only, and every one of them is used below.
//   fs           - reading route modules' package metadata and writing artifacts
//   path         - resolving --app and --out against the original cwd
//   http/https   - the request driver at `exchange`, selected per URL protocol
//   querystring  - building `query`-transport inputs and parsing form bodies
//   childProcess - `git rev-parse` for provenance heads
//   crypto       - the sha256 artifact digests every provenance record carries,
//                  and the HMAC of the one signed value this tool generates (see
//                  buildEmailToken)
//   zlib         - `crc32` for the deterministic stored-entry ZIP the two
//                  `zipCode` targets need (see buildZipCode); nothing is
//                  deflated, so no compressor is involved
var fs           = require('fs');
var path         = require('path');
var http         = require('http');
var https        = require('https');
var querystring  = require('querystring');

// THE SHARED PROVENANCE CONTRACT, from the one tool in test/parity/ that is
// Node-core-only at module scope. Requiring it costs nothing and starts
// nothing: test/parity/manifest.js guards its CLI behind
// `require.main === module`, so this require neither generates a manifest nor
// spawns a process nor writes to either stream.
//
// It is required rather than reimplemented so that one definition of these
// guarantees serves every parity tool: a second copy drifts, and the drift
// shows up as sibling artifacts naming different origins for the same fact.
// Every provenance fact this file records goes through `provenance.build`,
// whose portability guard THROWS on a value that cannot be reproduced from the
// repository.
//
// The require is relative to THIS FILE, so it always resolves inside the tool's
// own worktree - it is unaffected by `--app` and by the chdir into the tree
// under test, which is the same property that makes `requireFromApp` the only
// route to an application module.
var provenance   = require('./manifest').provenance;

// The zero-warning gate, stated once for all four parity gates. What counts as
// a notice, which flags the measurement requires, and the fact that there are
// no allowances are decided there and not here. This process is one of the
// places that gate is measured: reaching the schemas loads every controller
// into it, and driving the targets serves real requests.
var warningPolicy = require('./warning-policy');

// Under direct execution the flags come first, before the harvest loads
// anything. A pending deprecation is silent without --pending-deprecation, so a
// run that lacks the flags cannot tell "nothing was emitted" from "nothing was
// asked for" - and the notices this process is most likely to raise come from
// the dependency graph the harvest loads, which is exactly the class of warning
// that flag reveals. A re-execution that still lacks them fails closed.
if (require.main === module) {
  warningPolicy.elevate();
}
var childProcess = require('child_process');
var crypto       = require('crypto');
var zlib         = require('zlib');

// test/parity/server.js, test/parity/mongo.js and test/parity/seed.js are
// required LAZILY, inside the HTTP layer only. Two reasons, both load-bearing:
// `--schema-only` must load nothing that could provision a database, and the
// harvest must be the first thing in this process that touches the npm `config`
// package - which resolves and FREEZES on first require - so that it freezes
// against the tree `--app` selected and the composed NODE_CONFIG.
var lazy = { server: null, mongo: null, seed: null, mongoose: null };

// The zero-warning gate's evidence for this run: the in-process collector and
// every application stderr the run produced. Module-scoped for the same reason
// `lazy` is - the collector must be installed before the harvest loads a single
// controller, and the streams are discovered later, deep inside the HTTP layer,
// so the two ends of one measurement cannot be held in one stack frame.
var warningEvidence = { collector: null, streams: [] };

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

// What an artifact IS, recorded in the artifact AND in its embedded provenance
// block so a comparison cannot mistake one side of the gate for the other
// however the two files were named on disk. See resolveRole and
// assertComparable.
//
// THESE ARE THE SHARED CONTRACT'S WORDS, not this tool's own. They used to be
// `baseline-capture`, `target-replay` and `schema-only` - a private vocabulary
// this file invented - and that is precisely why the recording it wrote could
// not be authenticated by the validator sitting in the same file: `validate`
// accepts the contract's roles, so an artifact labelled `baseline-capture` was
// refused by its own generator. A role is a fact about the TREE that was
// measured, the contract defines the four facts a role can state, and there is
// no version of "which side of the gate is this" that needs a fourth word.
//
//   baseline    measured on a worktree at the base commit
//   target      measured on the migrated tree
//   analysis    derived by reading a tree, with no application executed - which
//               is exactly what --schema-only produces
//   unreviewed  measured on neither, via the explicit escape hatch; every gate
//               declines it
var ROLE_BASELINE   = 'baseline';
var ROLE_TARGET     = 'target';
var ROLE_ANALYSIS   = 'analysis';
var ROLE_UNREVIEWED = 'unreviewed';

// The closed set, so readRecording can reject an unrecognised role rather than
// carry it into a comparison it cannot reason about. Taken FROM the contract
// rather than re-listed here: a second copy is how the two vocabularies drifted
// apart in the first place.
var ROLES = provenance.ROLES;

// This tool's own worktree root, two levels above test/parity/. Used for the
// `--out` default, for `--app`'s default and for this tool's provenance. Only
// the ANALYSED tree moves; the artifact always belongs to this worktree.
var TOOL_ROOT = path.resolve(__dirname, '..', '..');

// The committed baseline recording: the path a CAPTURE is asked to write with
// `--out test/parity/joi-baseline.json`, and the artifact the overwrite guard
// below protects. It is deliberately NOT a default, because a default pointing
// at it means any ordinary run - a schema-only listing, a diagnostic capture
// against the target tree - replaces the one recording the comparison exists
// to compare against, silently and with no way back.
var COMMITTED_BASELINE = path.join(__dirname, 'joi-baseline.json');

// The environment variable that names ONE scratch directory for the default
// artifacts of every test/parity tool.
var ARTIFACT_DIR_ENV = 'PARITY_ARTIFACT_DIR';

// The basenames used when a destination comes from ARTIFACT_DIR_ENV rather
// than from --out.
var ARTIFACT_NAMES = {
  baseline   : 'joi-baseline.json',
  comparison : 'joi-comparison.json'
};

// The flag that permits writing over an existing baseline artifact, and the
// commit the committed baseline was captured at. Both are named here so the
// guard's message can quote them.
var OVERWRITE_FLAG = '--overwrite-baseline';
var BASELINE_COMMIT = '2f8712a';

// Where `--compare` writes its report when the caller names no `--out`. Named
// as a constant because the provenance block records WHICH ARTIFACT it
// describes and a consumer checks that name, so the default the write site uses
// and the default the block records must be the same value and not two copies
// of one string.
var DEFAULT_COMPARISON_OUT = path.join(__dirname, 'joi-comparison.json');

// The validate section that is NOT a schema. `language` is the custom-message
// map; the parser deletes it separately, before the schemas. Excluding it is
// what makes the total come to exactly 102.
var VALIDATE_LANGUAGE_KEY = 'language';

// The figures this tool must reproduce from the route declarations. A mismatch
// is REPORTED AND FATAL rather than corrected: it means either a route module
// changed or the deep copy is reading post-parse state, and both invalidate the
// gate.
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
// is recorded as an explicit N/A: most string-only sections admit no
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
// document, so the pre-handler answers 404 or 500 and the validation block
// never runs, leaving the target with no joi evidence at all. Substituting the
// seeded id is the same materialization `pathValues` already performs for
// `{folderId}` and `{fileId}`, applied where the declaration puts the
// identifier in the payload or the query instead of the path, and it is
// verified against the schema before it is used so it can never turn an
// accepting input into a rejecting one.
//
// `invitation` resolves to a fixture THIS TOOL creates rather than to one of
// the seeder's: test/parity/seed.js has no CourseInvitation group, so without a
// document of its own the two `{invitationId}` targets answer 404 from
// `invitation(params.invitationId)` and never reach the validation block. The
// document is therefore created here, beside the seeded fixtures and in the
// seeder's own reserved-id style; see INVITATION_FIXTURE and
// applyPreconditions.
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

// The CourseInvitation this tool creates, and why it creates one at all.
//
// `PUT /api/courses/{courseId}/invitations/{invitationId}/resend` and
// `.../email` both run `invitation(params.invitationId)` - findById on the
// CourseInvitation model - BEFORE the handler that holds the validation block,
// so without a document to find, both targets answer 404 for every case and
// contribute no joi evidence. That is a missing fixture rather than a fact
// about the schema, so it is supplied.
//
// The shape is exactly the required set the CourseInvitation schema in
// lib/models/courseInvitation.js declares: `courseId` referencing a Course,
// `email` and `token` required, and `status` one of the five values that schema
// enumerates. The `_id` follows the seeder's convention - fixed,
// synthetic, and readable as a fixture at a glance - in the `07` block, which
// test/parity/seed.js does not use: its groups occupy 01 to 06 and it reserves
// `ff` within a block for an id that belongs to no document. The document is
// written through the mongoose connection this process already holds for the
// seeder, into the collection the model registers, so the application under
// test reads it through its own model without knowing where it came from.
//
// It is UPSERTED rather than inserted, and re-upserted after every state
// restore and after every restart, because `resendInvitation` and
// `updateInvitationEmail` mutate `status` - so a drive that reaches the handler
// changes the document the next drive depends on.
var INVITATION_MODEL   = 'CourseInvitation';
var INVITATION_FIXTURE = {
  id     : '000000000000000000000701',
  email  : 'parity-invitation@example.com',
  // 8 hex characters, which is what `addList` produces
  // (`crypto.createHash("md5")...substring(0, 8)`); fixed rather than derived
  // so the document is byte-identical on both trees.
  token  : 'a1b2c3d4',
  status : 'pending'
};

// What an OPAQUE pre-handler needs from the request, keyed by the name it is
// exported under in lib/util/helpers.js.
//
// This closes the gap `preReferences` documents. A STRING pre-handler declares
// what it dereferences - `folder(payload.folderId)` - and the rejecting ladder
// steers around it. A FUNCTION pre-handler declares nothing, so a
// schema-derived value that is valid text but not a valid DOMAIN value makes
// the pre-handler answer first and the validation block never runs. Each entry
// below therefore states what its pre-handler demands of the request:
//   * lib/util/helpers.js's `validLang` reads
//     `params.lang || query.lang || payload.lang` and throws `Boom.notFound`
//     unless the value is in `Trinket.schema.path('lang').enumValues`, so a
//     generated filler such as `aaa` answers 404 rather than reaching the
//     validation block;
//   * lib/util/helpers.js's `trinketTypeEnabled` reads
//     `params.lang || query.lang` and throws `Boom.notFound` for a lang that is
//     not an ENABLED type, so an accepting case needs an enabled one;
//   * lib/util/helpers.js's `verifyEmailToken` calls
//     `jwt.verify(token, config.app.mail.secret + trinket.shortCode)`, which
//     THROWS on a filler token, so the target answers 500 unless the token is
//     signed with the configuration in force.
//
// The pre-handlers are identified by REFERENCE IDENTITY against the tree's own
// `lib/util/helpers.js` exports - see helperResolver - not by a route list, so
// a declaration that starts or stops using one is followed automatically. The
// VALUES come from the tree as well: the lang enum from the model, the token
// from the configuration in force. Nothing here is a literal that can drift.
var FUNCTION_PRE_CONSUMERS = {
  validLang          : [{ key: 'lang',  value: 'lang'  }],
  trinketTypeEnabled : [{ key: 'lang',  value: 'lang'  }],
  verifyEmailToken   : [{ key: 'token', value: 'emailToken' }]
};

// Leaves whose value the HANDLER decodes, and which therefore cannot be filler
// either - but for a reason that sits after validation rather than before it.
//
// `zipCode` is base64 ZIP bytes. `trinket.draft` and `trinket.autosave` both do
// `JSZip().loadAsync(payload.zipCode, {base64:true}).then(...)`, and on the
// baseline the rejection handler's return value flows into the next `.then`,
// where `JSON.parse` throws inside a chain with no downstream handler - an
// unhandled rejection which, under Node 22's default
// `--unhandled-rejections=throw`, KILLED THE APPLICATION. Measured: four of the
// seven baseline crashes were these two targets, in both Accept modes.
//
// So the value is a real ZIP whose single entry is named `zipCode` and whose
// content is valid JSON, built deterministically from Node core (see
// buildZipCode). Preserving the crash was never an option for a gate that has
// to drive 462 requests, and the crash is not a validation outcome: the
// schema's verdict on `Joi.string().optional()` is identical either way, and it
// is the local schema proof that carries that verdict.
var HANDLER_ENCODED_LEAVES = {
  zipCode : 'zipCode'
};

// The single entry inside that ZIP. The NAME is the application's, not this
// tool's choice: both handlers in lib/controllers/trinket.js read
// `content.file("zipCode")`. The CONTENT is a JSON string rather than a JSON
// object, because both handlers then assign `JSON.parse(code)` to the `code`
// field, which lib/models/draft.js declares as a `String` - so a parsed object
// would be a cast error and a parsed string is a clean save, which keeps the
// drive's outcome about the schema and not about mongoose.
var ZIP_ENTRY_NAME    = 'zipCode';
var ZIP_ENTRY_CONTENT = '"parity zip code"';

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

// Targets whose rejecting case CANNOT reach the validation block at all, with
// the application code path that stops it and the measurement behind that
// claim.
//
// The distinction the list draws is what it is for. A rejecting case that does
// not reach the block contributes NO joi evidence, so an unreached target must
// never be counted as parity proof. Every unreached target that is
// NOT named here fails the run - which is what turns the reach figure from a
// note into an assertion - and a target named here fails nothing but is
// reported, per case and in the summary, as resting on the local schema proof
// alone.
//
// Adding to this list is a reviewable diff, and the bar for an entry is that no
// request can reach the block: an entry whose real problem was a filler input
// or a missing fixture belongs in FUNCTION_PRE_CONSUMERS, HANDLER_ENCODED_LEAVES
// or applyPreconditions instead, and six of the seven originally-unreached
// targets moved there.
var REVIEWED_UNREACHED = [
  {
    target : 'PUT /api/courses/{courseId}/lessons/{lessonId}/materials/' +
      '{materialId}/move payload',
    reason : 'The declaration spells the last pre-handler ' +
      '`parent(payload.parent,pre.lesson)` [config/api_routes.js:241], and ' +
      '`parent` is registered as `findById(Lesson)` [lib/util/helpers.js:' +
      '286-303]. That factory returns `function (id, optional, next)` and, ' +
      'when it is called with exactly two arguments and the second is not a ' +
      'boolean, treats the second as the CALLBACK [lib/util/helpers.js:35-38] ' +
      '- so `next` becomes the Lesson DOCUMENT `pre.lesson` resolves to, and ' +
      'the `next(result)` at lib/util/helpers.js:50 throws `TypeError: next ' +
      'is not a function`. The parser\'s string dispatcher applies exactly ' +
      'the declared arguments [lib/util/routeParser.js:173], so the arity is ' +
      'two on every request. Measured on BOTH trees: all six drives of this ' +
      'target answer 500 with `{error, message, statusCode}` and no ' +
      'validation flash, for the accepting, rejecting and coercion inputs ' +
      'alike, and with `parent` present as the seeded Lesson id. Omitting ' +
      '`parent` does not help either: the `if (!id)` branch at ' +
      'lib/util/helpers.js:40-43 calls the same non-function. There is ' +
      'therefore no request that reaches this target\'s validation block, and ' +
      'no input this tool can choose changes that. The fix is in the ' +
      'application - either make the factory ignore a non-function second ' +
      'argument, or spell the declaration `parent(payload.parent)` - and both ' +
      'files are outside this gate.'
  }
];

// The drives whose route NEVER ANSWERS, with the measured reason each one does
// not answer. Same contract as REVIEWED_UNREACHED and for the same reason: a
// drive that produced no response produced no evidence, so it may not sit in
// the artifact as an unexplained figure. An entry here is a REVIEWABLE DIFF -
// removing it makes the run fail - and a timeout with no entry fails the run on
// the spot rather than being counted in `summary.drivesTimedOut` and forgotten.
//
// `case` is null when every case of the target times out; naming the kind
// identifies the input that reaches the non-answering branch, which is what
// makes the entry checkable against the code it names.
var REVIEWED_TIMEOUTS = [
  {
    target : 'POST /api/users/email payload',
    case   : 'accepting',
    reason : '`users.sendEmailChange` [lib/controllers/users.js:845-887] ' +
      'answers only from inside a callback it passes to `Store.set` as a ' +
      'THIRD argument, and `Store.set` is an arity-2 `async function (key, ' +
      'value)` on both trees [lib/util/store.js:16-19 for the in-memory ' +
      'engine, :203-206 for the redis engine], so the third argument is ' +
      'ignored, the callback never runs, the promise the handler returned ' +
      'never settles and the request never receives a response. The target ' +
      'tree comments this as a PRESERVED DEFECT at ' +
      'lib/controllers/users.js:870-876 and the baseline reaches the same ' +
      'non-settlement through the same call. It is the accepting input that ' +
      'gets there: `User.findByLogin` must NOT find an account with the ' +
      'address being claimed, and the rejecting input is not a valid email ' +
      'so the validation block answers before the handler runs at all - ' +
      'measured, that case answers 200 in both Accept modes on both trees. ' +
      'The seeded fixtures deliberately do not own `parity@example.com`, so ' +
      'this is the state every drive of this case observes once the seeded ' +
      'state is restored per drive (see RESTORE_POLICY); an earlier build of ' +
      'this gate recorded a 200 here only because a preceding drive had ' +
      'changed a user\'s address to that value first. A bounded timeout is ' +
      'therefore the measured outcome of this route, identical on both sides ' +
      'of the gate, and is compared as such: `timedOut` is a compared field ' +
      'on every outcome and the timeout list below is compared whole. Fixing ' +
      'it means awaiting the promise, which would start answering and start ' +
      'sending mail - a behaviour change R-d prohibits - so it is preserved ' +
      'and recorded rather than repaired.'
  }
];

// The state-restore rule the drive loop applies, recorded in the artifact so
// the sequence is reconstructible from the artifact alone. See restoreState for
// the reasoning and the measured cost.
var RESTORE_POLICY = 'test/parity/seed.js reset({scope:\'collections\'}) + ' +
  'seed(), followed by this tool\'s own preconditions, before EVERY drive ' +
  'whose method is not GET, and again after every restart. A GET drive is not ' +
  'preceded by a restore because a GET route cannot have mutated the fixtures ' +
  'the next drive depends on, and the GET phase runs first. Measured cost: ' +
  '2-3ms for the reset and 240-320ms for the re-seed, against a 2.9s initial ' +
  'seed.';

// How long any single HTTP exchange is given. Bounded so that a route which
// never settles is a RECORDED RESULT rather than a hung gate - a distinction
// the file-stream branch depends on, since it does not answer at all.
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
// A gate that died with it could never capture the baseline side of the
// comparison at all - so the crash is RECORDED, the application is restarted,
// and the run continues. The bound exists so a tree that crashes on every
// request reports that rather than restarting forever.
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
  '                     modes this is the matrix, and the run-output',
  '                     <out>.provenance.json is',
  '                     sealed beside it. In --compare mode this is the',
  '                     comparison REPORT, and a live replay additionally',
  '                     writes the matrix it drove to <out>.target.json with',
  '                     ITS OWN sidecar at <out>.target.json.provenance.json -',
  '                     the sibling of the matrix it describes. The report',
  '                     hash-links all four.',
  '                     REQUIRED unless ' + ARTIFACT_DIR_ENV + ' names a',
  '                     directory, in which case the artifact is',
  '                     <dir>/' + ARTIFACT_NAMES.baseline + ' or',
  '                     <dir>/' + ARTIFACT_NAMES.comparison + '. There is no',
  '                     repository default: the old one was the committed',
  '                     baseline recording, so an ordinary run replaced it.',
  '  --overwrite        Permit replacing an existing artifact or sidecar.',
  '                     Without it, a run that would clobber any of its output',
  '                     paths refuses before doing anything. Capturing over an',
  '                     existing matrix also requires that the tree named by',
  '                     --app be at the same commit that artifact records in',
  '                     its <out>.provenance.json `app.head`, so a re-capture',
  '                     replaces a baseline with another reading of the same',
  '                     tree, never with a reading of a different one.',
  '                     ' + OVERWRITE_FLAG + ' is accepted as the same flag.',
  '  --record-into <p>  With --compare, write the completed comparison and the',
  '                     replay record back into the baseline recording <p> and',
  '                     re-attach its provenance block and re-seal. Requires',
  '                     --overwrite. This is how',
  '                     test/parity/joi-baseline.json comes to carry two-sided',
  '                     evidence while remaining the baseline recording that',
  '                     --compare replays.',
  '  --allow-same-tree  Waive the same-application-HEAD and same-joi-major',
  '                     refusals, for the offline determinism and perturbation',
  '                     controls. Recorded in the report, which then states it',
  '                     is not two-tree parity evidence. Comparing a file with',
  '                     ITSELF is refused unconditionally and this does not',
  '                     permit it.',
  '  --port <n>         Bind port for the application under test. Defaults to',
  '                     the overlay\'s. Set it per clone to avoid a collision.',
  '  --database <name>  Pin the MongoDB database name.',
  '  --overlay <path>   NODE_CONFIG overlay for the application under test.',
  '                     Defaults to test/parity/server-overlay.json.',
  '  --mongo-uri <uri>  Drive an already-running mongod instead of',
  '                     provisioning one.',
  '',
  'OPTION RULES',
  '  No option is repeatable: a second occurrence of any of them, the mode',
  '  flags included, is a usage error rather than a last-one-wins. A value',
  '  beginning with "-" is a usage error too, so a missing value cannot',
  '  swallow the following option.',
  '',
  'EXIT CODES - derived from ONE failure set, at one place',
  '  0  the failure set is empty: no captured process warning, no',
  '     unexplained outcome-proof mismatch, no mismatch rule that explained',
  '     nothing, no parity difference and no failed invariant',
  '  1  the failure set holds something the gate MEASURED: a comparison',
  '     difference, a captured warning, an outcome-proof mismatch no declared',
  '     rule explains, a declared rule that matched nothing, or an asserted',
  '     invariant that failed (the inert `language` maps stopped being inert,',
  '     or a case reported itself undrivable without a reviewed reason).',
  '     A case whose observed validation flash did not match the local schema',
  '     proof, and an applicable case that rendered no validation message at',
  '     all, are in that measured set too.',
  '     Every artifact is written BEFORE the code is derived',
  '  2  usage or operational failure - the gate could not run, or its',
  '     teardown did not complete and it may have left a live connection, a',
  '     live process or a data directory behind',
  '     Includes a recording whose embedded provenance does not establish',
  '     what it measured, does not hash to its own payload digest, or names a',
  '     generator this repository cannot retrieve, and a comparison that is',
  '     not between the two sides of the gate.',
  '',
  'PROVENANCE Every recording carries its provenance EMBEDDED under its own',
  '     `provenance` key - the shared block from test/parity/manifest.js,',
  '     naming the tree it measured by commit, the generator by its git blob',
  '     and the joi behind its verdicts, hash-linked to the artifact by a',
  '     payload digest over the artifact without that key. --compare validates',
  '     that block for each side through the shared contract before comparing,',
  '     and refuses a self-comparison outright; that is what stops a',
  '     zero-difference report being produced by a file compared with itself.',
  '     A sidecar is also written beside every artifact and is a RUN OUTPUT,',
  '     not part of the delivery: it adds a digest of the exact bytes, the',
  '     warning-gate verdict and this run\'s own addressing. It is not',
  '     required, and a committed recording has none - where one is present,',
  '     its digest is reconciled against the bytes beside it.',
  '',
  'NOTE The zero-warning gate (AAP 0.9.3, no allowances - see',
  '     test/parity/warning-policy.js) is applied to this process AND to the',
  '     application child\'s captured stderr, and a notice in either exits 1.',
  '     Under direct execution this tool re-executes itself with',
  '     --pending-deprecation --trace-deprecation, because a pending',
  '     deprecation is silent without them. The verdict is written to',
  '     <out>.provenance.json and never into the artifact, which is diffed.',
  '',
  'NOTE stdout of the analysed tree must be discarded by the caller: proving',
  '     the parser deletes `validate` loads every controller, which prints the',
  '     in-memory-queue line on stdout. Its stderr is no longer something to',
  '     discard - it is the gate\'s evidence, and a baseline tree\'s AWS SDK v2',
  '     notice is a notice this tool now reports.',
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
 * The write happens inside the warning policy's `harnessOutput` scope. This
 * tool's lines carry no prefix - by design, they are prose for a human - and
 * the zero-warning gate tees this very stream, so without the scope a sentence
 * of ours mentioning a deprecation would be read back as a notice, and with
 * `tee` off instead, a dependency's `console.warn` would escape the gate
 * entirely. The scope changes nothing about WHAT is written or where: only the
 * collector's view of the line.
 *
 * @param {string} message
 * @returns {undefined}
 */
function note(message) {
  warningPolicy.harnessOutput(function() {
    process.stderr.write(String(message) + '\n');
  });
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
 * captured at process start and passed in, so a relative `--out` means what the
 * caller typed however this process's own state changes afterwards. A relative
 * path resolved late is at the mercy of any change to the working directory,
 * and for a baseline capture the cost of getting it wrong is a file written
 * into a tree this tool must not modify.
 *
 * @param {string[]} args process.argv.slice(2)
 * @param {string} originalCwd The working directory at process start.
 * @returns {{mode: string, appRoot: string, out: (string|null),
 *            compare: string[], port: (number|null),
 *            database: (string|null), overlay: (string|null),
 *            mongoUri: (string|null), allowNonBaseline: boolean}}
 * @throws {ToolError} On an unknown flag, a missing value or a mode conflict.
 */
function parseArguments(args, originalCwd) {
  var options = {
    mode          : 'capture',
    appRoot       : TOOL_ROOT,
    out           : null,
    compare       : [],
    port          : null,
    database      : null,
    overlay       : null,
    mongoUri      : null,
    // Write the completed comparison back into this recording and re-seal its
    // sidecar. The only way the committed baseline can carry two-sided
    // evidence, and deliberately a separate flag from --out: it modifies a file
    // that already exists and already has a seal, so it requires --overwrite.
    recordInto    : null,
    // Permit writing over an existing artifact. Off by default, because the
    // default output path is the committed baseline recording.
    overwrite     : false,
    // Waive the same-application-HEAD and same-joi-major refusals, for the
    // offline determinism and perturbation controls. Never waives same-path.
    allowSameTree : false
  };
  var seen = {};
  var i;

  // A DASH-LEADING TOKEN IS NEVER A VALUE. `--out --schema-only` is a missing
  // value, not an artifact path of "--schema-only": this tool writes files and
  // then derives a gate from them, so a path it was not asked for is the one
  // mistake that must not pass quietly.
  function value(flag, index) {
    var next = args[index + 1];

    if (next === undefined || next.charAt(0) === '-') {
      throw new ToolError(flag + ' requires a value' +
        (next === undefined ? '' : ', and ' + JSON.stringify(next) +
        ' is an option'));
    }

    return next;
  }

  // NO OPTION HERE IS REPEATABLE, so a second occurrence of any of them - the
  // mode flags included - is a usage error rather than a last-one-wins. Two
  // `--out` paths would mean the artifact this gate is derived from is not the
  // one the caller named.
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
        // Also `once`: `--capture --capture` passes setMode's conflict test,
        // because the mode it would set is the mode already set, so without
        // this a repeated mode flag was the one duplicate this parser accepted.
        once('--capture');
        setMode('capture', '--capture');
        break;

      case '--schema-only':
        once('--schema-only');
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

      case OVERWRITE_FLAG:
        once(OVERWRITE_FLAG);
        options.overwrite = true;
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

      case '--allow-nonbaseline':
        once('--allow-nonbaseline');
        options.allowNonBaseline = true;
        break;

      case '--record-into':
        once('--record-into');
        options.recordInto = path.resolve(originalCwd,
          value('--record-into', i));
        i += 1;
        break;

      case '--overwrite':
        once('--overwrite');
        options.overwrite = true;
        break;

      case '--allow-same-tree':
        once('--allow-same-tree');
        options.allowSameTree = true;
        break;

      default:
        throw new ToolError('unknown argument: ' + args[i]);
    }
  }

  if (options.recordInto !== null) {
    if (options.mode !== 'compare') {
      throw new ToolError('--record-into is only meaningful with --compare: ' +
        'the block it writes IS the completed comparison, and a capture has ' +
        'not compared itself with anything');
    }

    if (!options.overwrite) {
      throw new ToolError('--record-into ' + options.recordInto + ' modifies ' +
        'an existing sealed recording and re-attaches its provenance block ' +
        'over the new bytes, so it requires --overwrite as well');
    }

    // A relaxed comparison is explicitly NOT two-tree parity evidence - the
    // report says so in `comparability.note` - so it may not become the
    // canonical recording. Refused at parse time rather than at qualification
    // time, because the two flags together are a contradiction in the
    // invocation and not a result to be judged.
    if (options.allowSameTree) {
      throw new ToolError('--record-into and --allow-same-tree contradict ' +
        'each other. --allow-same-tree waives the checks that make a ' +
        'comparison the two sides of this gate, and --record-into writes the ' +
        'result into the committed recording as its evidence. Run the ' +
        'determinism or negative control without --record-into.');
    }

    // The embedded block claims a replay (`crossCheck`) and names the tree it
    // drove. An offline comparison of two recordings replays nothing, so
    // embedding its result would put a claim in the recording that the run
    // cannot support.
    if (options.compare.length === 2) {
      throw new ToolError('--record-into requires the live single-argument ' +
        'form `--compare <baseline.json>`. An offline comparison of two ' +
        'recordings re-generates no inputs and produces no `crossCheck`, so ' +
        'the block it would embed would claim a replay that did not happen.');
    }
  }

  if (options.allowSameTree && options.mode !== 'compare') {
    throw new ToolError('--allow-same-tree only affects --compare, which is ' +
      'the only mode that has two sides to check');
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
 * The destination for an artifact the caller did not name.
 *
 * Resolves inside ARTIFACT_DIR_ENV when it is set, and otherwise fails naming
 * both ways to supply one. It never falls back to a path inside this
 * repository: see the comment on COMMITTED_BASELINE.
 *
 * @param {string} basename One of ARTIFACT_NAMES.
 * @returns {string} An absolute path.
 * @throws {ToolError} If no destination was supplied.
 */
function resolveArtifactPath(basename) {
  var configured = process.env[ARTIFACT_DIR_ENV];

  if (typeof configured === 'string' && configured.trim()) {
    return path.resolve(configured.trim(), basename);
  }

  throw new ToolError('--out is required: this tool has no repository ' +
    'default, because one pointing at the committed baseline would let an ' +
    'ordinary run replace it. Pass --out <path>, or set ' + ARTIFACT_DIR_ENV +
    ' to a scratch directory and the artifact goes to <dir>/' + basename + '. ' +
    'Re-capturing the committed baseline is --out test/parity/' +
    ARTIFACT_NAMES.baseline + ' ' + OVERWRITE_FLAG + ', with --app on a ' +
    'worktree at ' + BASELINE_COMMIT + '.');
}

/**
 * Refuses to overwrite an existing matrix artifact unless it was asked for and
 * the tree being captured is the one the artifact already describes.
 *
 * Two conditions, and both are needed. The FLAG is what makes replacing
 * recorded evidence a decision rather than a side effect of a re-run. The HEAD
 * CHECK is what stops the more damaging mistake: capturing the TARGET tree over
 * a baseline recorded from `2f8712a` leaves a file that still says "baseline"
 * while holding the very outcomes the comparison is supposed to be measured
 * against, and a comparison against it would then pass by construction. The
 * commit the existing artifact was captured from is read from the ARTIFACT'S
 * OWN embedded provenance block, falling back to a sidecar beside it, so the
 * check is against what that file actually records rather than against an
 * assumption about it - and it does not depend on a run output the delivery
 * does not ship.
 *
 * @param {string} target The artifact path about to be written.
 * @param {Object} options Parsed arguments; `overwrite` and `appRoot` are read.
 * @returns {undefined}
 * @throws {ToolError} If the artifact exists and either condition fails.
 */
function assertOverwritable(target, options) {
  var sidecarPath = target + '.provenance.json';
  var text;
  var recordedHead = null;
  var source = null;
  var sidecar;
  var head;

  if (!fs.existsSync(target)) {
    return undefined;
  }

  if (!options.overwrite) {
    throw new ToolError(target + ' already exists and holds a recorded ' +
      'matrix. Writing over it needs ' + OVERWRITE_FLAG + ', so that ' +
      'replacing evidence is deliberate. Capture elsewhere with --out ' +
      '<path>, or pass ' + OVERWRITE_FLAG + ' to replace it.');
  }

  // THE ARTIFACT'S OWN BLOCK FIRST. A recording carries the tree it measured
  // embedded under its `provenance` key, so the check reads what the file
  // itself says rather than depending on a companion file to be present. The
  // sidecar is consulted only as a fallback, which is what lets a recording
  // sealed by an earlier build - one that wrote `app.head` into a sidecar and
  // nothing into the artifact - still be replaced by a re-capture rather than
  // becoming unreplaceable.
  try {
    text = fs.readFileSync(target, 'utf8');
  }
  catch (err) {
    throw new ToolError('cannot read the existing matrix ' + target + ' (' +
      err.message + '), so the commit it was captured from cannot be checked ' +
      'against --app. Capture to a different --out.');
  }

  recordedHead = ((provenance.extract(text) || {}).analysedTree || {}).head ||
    null;

  if (recordedHead !== null) {
    source = 'its own embedded provenance block';
  }
  else if (fs.existsSync(sidecarPath)) {
    try {
      sidecar = JSON.parse(fs.readFileSync(sidecarPath, 'utf8'));
    }
    catch (err) {
      throw new ToolError('cannot read the provenance sidecar ' +
        sidecarPath + ' (' + err.message + '), and ' + target + ' carries no ' +
        'embedded provenance block, so the commit it was captured from ' +
        'cannot be checked against --app. Repair or remove the sidecar, or ' +
        'capture to a different --out.');
    }

    recordedHead = ((sidecar || {}).app || {}).head ||
      (((sidecar || {}).analysedTree || {}).head) || null;
    source = 'the sidecar ' + sidecarPath;
  }

  if (recordedHead === null) {
    throw new ToolError(target + ' records no commit it was captured from - ' +
      'neither an embedded `provenance.analysedTree.head` nor a ' +
      sidecarPath + ' naming one - so ' + OVERWRITE_FLAG + ' cannot be ' +
      'checked. Capture to a different --out, or remove the file first if ' +
      'the recording is genuinely being discarded.');
  }

  head = gitHead(options.appRoot);

  if (head === null) {
    throw new ToolError('cannot determine the HEAD of ' + options.appRoot +
      ', so it cannot be checked against the ' + recordedHead +
      ' recorded in ' + source + '. Capture to a different --out.');
  }

  if (head !== recordedHead) {
    throw new ToolError('refusing to overwrite ' + target + ': ' + source +
      ' records a capture of ' + recordedHead + ' and --app names ' +
      options.appRoot + ', which is at ' + head + '. A matrix captured from ' +
      'one tree must not be replaced by a reading of another - a comparison ' +
      'against it would then pass by construction. Capture to a different ' +
      '--out, or point --app at a worktree at ' + recordedHead + '.');
  }

  return undefined;
}

/**
 * True when `target` is an existing file holding a matrix written by this tool.
 *
 * Keeps a comparison REPORT from being written over a recorded MATRIX. The two
 * are different documents with the same extension, and the mistake -
 * `--compare base.json --out base.json` - destroys the recording the
 * comparison was measuring against.
 *
 * @param {string} target
 * @returns {boolean}
 */
function isMatrixArtifact(target) {
  var parsed;

  if (!fs.existsSync(target)) {
    return false;
  }

  try {
    parsed = JSON.parse(fs.readFileSync(target, 'utf8'));
  }
  catch (err) {
    return false;
  }

  return Boolean(parsed) && Array.isArray(parsed.targets);
}

/**
 * Refuses a comparison destination that would overwrite a recorded matrix.
 *
 * Refused outright rather than behind a flag: in --compare mode the artifact is
 * a REPORT, so a matrix path is never the right destination and forcing it
 * through would only produce a file whose name lies about its contents.
 *
 * @param {string} target The report path about to be written.
 * @param {Object} options Parsed arguments; `compare` is read.
 * @returns {undefined}
 * @throws {ToolError} If the destination is a recorded matrix or an input.
 */
function assertComparisonDestination(target, options) {
  var candidates = [target, target + '.target.json'];
  var index;
  var candidate;

  for (index = 0; index < candidates.length; index += 1) {
    candidate = candidates[index];

    if (options.compare.indexOf(candidate) !== -1) {
      throw new ToolError('--out ' + target + ' would write the comparison ' +
        'over ' + candidate + ', which is one of the matrices being ' +
        'compared. Name a different --out.');
    }

    if (isMatrixArtifact(candidate)) {
      throw new ToolError('--out ' + target + ' would write the comparison ' +
        'report over ' + candidate + ', which already holds a recorded ' +
        'matrix. A report is not a matrix, and replacing one with the other ' +
        'destroys the recording. Name a different --out.');
    }
  }

  return undefined;
}

// Counter behind the temporary filenames below, so two artifacts written in
// the same millisecond by the same process cannot collide.
var artifactSequence = 0;

/**
 * Writes a text artifact atomically, creating its directory if needed.
 *
 * The bytes go to a unique temporary file in the artifact's own directory,
 * which is flushed, closed and then renamed over the target. A same-directory
 * rename is atomic, so a reader sees either the previous matrix or the complete
 * new one - never a half-written file. Writing in place would let an
 * interruption or a full filesystem truncate the recorded baseline, which is
 * the copy the comparison has no way to reconstruct.
 *
 * The temporary file is removed on failure, so a failed run leaves the previous
 * artifact exactly as it found it.
 *
 * @param {string} target Absolute path.
 * @param {string} text
 * @returns {undefined}
 * @throws {ToolError} If the directory cannot be created or the file written.
 */
function writeArtifact(target, text) {
  var temporary;
  var descriptor = null;

  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
  }
  catch (err) {
    throw new ToolError('cannot create directory for ' + target + ': ' +
      err.message);
  }

  artifactSequence += 1;
  temporary = target + '.parity-tmp-' + process.pid + '-' + artifactSequence;

  try {
    // 'wx' rather than 'w': a temporary name that already exists is a
    // collision worth failing on, not a file to overwrite.
    descriptor = fs.openSync(temporary, 'wx');
    fs.writeFileSync(descriptor, text, 'utf8');
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = null;
    fs.renameSync(temporary, target);
  }
  catch (err) {
    if (descriptor !== null) {
      try {
        fs.closeSync(descriptor);
      }
      catch (closeError) {
        // Swallowed deliberately: the write failure below is the reason worth
        // reporting, and a close error while already failing would mask it.
      }
    }

    try {
      fs.unlinkSync(temporary);
    }
    catch (unlinkError) {
      // The temporary file may never have been created. Either way the
      // artifact itself is untouched, which is the guarantee that matters.
    }

    throw new ToolError('cannot write ' + target + ': ' + err.message);
  }
}

/**
 * Reports what a sealed block says, on stderr.
 *
 * Printed at every write site because the two facts a reader needs are the two
 * a filename cannot carry: WHICH TREE was measured, and whether the generator
 * that produced the artifact can be retrieved from this repository. An
 * unverified generator is named as such rather than omitted - an artifact
 * produced from an uncommitted edit records the commit it was run FROM, which
 * does not contain the tool that produced it, and saying so is the difference
 * between provenance and a label.
 *
 * @param {Object} block A block that has been through `provenance.attach`.
 * @returns {undefined}
 */
function noteProvenance(block) {
  note('provenance: role ' + block.role + ', analysed tree ' +
    ((block.analysedTree && block.analysedTree.headShort) || 'none') +
    ', generator ' + block.generator.path + ' blob ' +
    String(block.generator.blob).slice(0, 12) +
    (block.generator.verified
      ? ' verified in commit ' + String(block.generator.commit).slice(0, 7)
      : ' NOT YET COMMITTED (' + block.generator.commitState + ')') +
    ', payload ' + block.payloadDigest.value.slice(0, 12));
}

/**
 * Reads and parses a matrix written by this tool, optionally REFUSING one whose
 * provenance does not establish what it measured.
 *
 * A recorded matrix reaches this tool as the baseline side of the gate, so
 * accepting anything with a `targets` array would accept an artifact whose
 * companion sidecar names a tree nobody can identify, and one whose outcomes
 * were edited after capture. When `expect` is given, the provenance block is
 * extracted and checked, and a failure is an OPERATIONAL failure rather than a
 * parity difference: a comparison against an artifact that cannot say which
 * tree it measured is not a comparison, so it exits 2 and not 1.
 *
 * @param {string} target Absolute path.
 * @param {(Object|undefined)} expect Provenance expectations. `roles` lists the
 *   acceptable roles; `requireBaselineTree` forces the analysed tree to be the
 *   base commit, and defaults to being required of any artifact that CLAIMS
 *   the `baseline` role.
 * @returns {Object}
 * @throws {ToolError} If the file is missing, unreadable, not JSON, not a
 *   matrix of the expected shape, or - with `expect` - not authenticable.
 */
function readMatrix(target, expect) {
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

  if (expect) {
    // A sidecar beside the matrix is reconciled when one is there. It is a run
    // output, so most matrices have none and absence is not a finding; one
    // that exists and disagrees with the bytes beside it is, because the pair
    // would then be read together while describing different files.
    assertMatrixProvenance(target, text, parsed, Object.keys(expect).reduce(
      function (carried, key) {
        carried[key] = expect[key];
        return carried;
      },
      { sidecar: sidecarBeside(target) }
    ));
  }

  return parsed;
}


// ---------------------------------------------------------------------------
// Digests and provenance sidecars
// ---------------------------------------------------------------------------

// The keys `--record-into` writes into an ALREADY-SEALED recording, and
// therefore the keys `payloadDigest` is computed with set to null.
//
// This exists to break a cycle that would otherwise make the committed evidence
// impossible. A comparison report must name the baseline it consumed by a
// digest, or the link is a filename and proves nothing. But the completed
// comparison must then be embedded back INTO that baseline recording, which
// changes the baseline's bytes and so invalidates any digest taken over them.
// The way out is to link the baseline by a digest that is defined to ignore
// exactly the keys the embedding writes: `payloadDigest` covers the whole
// artifact with these two keys nulled, so it is stable across the embedding
// while still covering every target, every case and every recorded outcome.
//
// `crossCheck` is in the set for the same reason as `targetComparison`: the
// replay/divergence record is produced by the comparison rather than by the
// capture, and the committed recording has to carry it as evidence.
var RECORD_INTO_KEYS = ['targetComparison', 'crossCheck'];

/**
 * sha256 of a string of bytes, hex.
 *
 * @param {string} text
 * @returns {string} 64 hex characters.
 */
function artifactDigest(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * Both digests of one artifact, from the exact bytes that were written.
 *
 * `digest` covers the file as it is on disk, which is what an integrity check
 * needs. `payloadDigest` covers the same artifact re-serialized with
 * RECORD_INTO_KEYS nulled AND its embedded `provenance` block removed, which is
 * what a cross-artifact link needs. They are computed from `text` rather than
 * from the object so the recorded `bytes` and `digest` cannot drift from the
 * file: whatever was written is what is hashed.
 *
 * WHY `provenance` IS EXCLUDED, and why that is not a weakening. The embedded
 * block carries its own `payloadDigest` - the contract's, over the artifact
 * without the block - and that is the seal binding the two together; a
 * recording whose outcomes were edited fails it. This digest is a different
 * instrument: a NAME by which a comparison report links the baseline recording
 * it consumed, and it has to survive `--record-into` writing the completed
 * comparison back into that recording. The embedding changes the contract's
 * digest, so the block is re-attached afterwards - and if this digest covered
 * the block, re-attaching it would move this digest too, breaking the one link
 * it exists to hold stable. So each covers what it is for: the contract's
 * digest covers the content including the comparison, and this one covers the
 * content that was captured.
 *
 * @param {string} text The exact serialized bytes.
 * @returns {{digest: string, payloadDigest: string, bytes: number}}
 * @throws {ToolError} If `text` is not a serialized artifact.
 */
function artifactDigests(text) {
  var parsed;
  var payload;

  try {
    parsed = JSON.parse(text);
  }
  catch (err) {
    throw new ToolError('cannot digest an artifact that is not JSON: ' +
      err.message);
  }

  payload = {};

  Object.keys(parsed).forEach(function(key) {
    if (key === 'provenance') {
      return;
    }

    payload[key] = RECORD_INTO_KEYS.indexOf(key) === -1 ? parsed[key] : null;
  });

  return {
    digest       : artifactDigest(text),
    payloadDigest: artifactDigest(serialize(payload)),
    bytes        : Buffer.byteLength(text, 'utf8')
  };
}

/**
 * The sidecar path for an artifact. Always its SIBLING.
 *
 * One function, used by every writer and every reader, because the naming is
 * the whole of the guarantee: a sidecar written to `<report>.provenance.json`
 * while the matrix it describes is at `<report>.target.json` describes a file it
 * does not sit beside, and a reader has no way to tell which of the two it
 * belongs to.
 *
 * @param {string} artifactPath
 * @returns {string}
 */
function sidecarPathFor(artifactPath) {
  return artifactPath + '.provenance.json';
}

/**
 * Writes a recording that AUTHENTICATES ITSELF, and a run-output sidecar beside
 * it.
 *
 * This is the one write path, and it is the shared contract's. Every matrix
 * this tool produces goes through it, in every mode.
 *
 * WHAT WAS WRONG BEFORE, because the shape of the fix follows from it. This
 * file held two write paths: a conforming one that embedded the shared block
 * through `provenance.attach` and had NO call sites, and a hand-rolled one that
 * wrote the artifact plus a sidecar of its own invention and did all the work.
 * So the delivered `joi-baseline.json` carried no `provenance` key at all,
 * while the validator sitting a hundred lines above in the same file refused
 * exactly that - an artifact that "does not say which tree it measured". The
 * committed evidence was rejected by its own generator, and the two paths are
 * now one.
 *
 * THREE FACTS, IN THIS ORDER, because each depends on the one before:
 *
 *   1. the block is EMBEDDED before the bytes exist. `provenance.attach`
 *      computes the contract's `payloadDigest` over the artifact WITHOUT the
 *      block and then sets the block on it, so the digest covers the artifact a
 *      consumer will actually read. Embedding after serialization would seal
 *      bytes nobody has.
 *   2. the artifact is serialized ONCE and those exact bytes are written. The
 *      sidecar's `artifactDigest` and this tool's own `artifact.digest` are
 *      taken from the same string, so neither can describe a second
 *      serialization of an object that has since been mutated.
 *   3. the sidecar is a COPY. `provenance.sidecar` copies the block and adds a
 *      digest of the bytes; the run-output facts are added to that copy. The
 *      embedded block is never mutated afterwards, which is what keeps the
 *      committed record portable - `warningGate` alone carries the absolute
 *      paths of the stderr files it read.
 *
 * The sidecar remains a RUN OUTPUT and is not part of the delivery: the
 * artifact carries the embedded block, so nothing has to be shipped in pairs,
 * and `readRecording` treats an absent sidecar as the normal case. That is the
 * shared contract's own rule, and it is why the committed
 * `joi-baseline.json.provenance.json` - a second file, in a third vocabulary,
 * that a reviewer read as the evidence - is gone.
 *
 * @param {string} artifactPath Absolute path of the artifact.
 * @param {Object} artifact The artifact object, MUTATED to carry its block.
 * @param {Object} block From buildProvenance; mutated by `attach` to carry the
 *   contract's payload digest.
 * @param {(Object|null|undefined)} runOutput From buildRunOutput, or null when
 *   the caller has none.
 * @returns {{artifactPath: string, sidecarPath: string, text: string,
 *            digests: Object}}
 * @throws {ToolError} If the block is not attachable or either file cannot be
 *   written.
 */
function sealRecording(artifactPath, artifact, block, runOutput) {
  var sidecarPath = sidecarPathFor(artifactPath);
  var text;
  var digests;
  var sidecar;

  try {
    provenance.attach(artifact, block);
  }
  catch (err) {
    throw asToolError(err);
  }

  text    = serialize(artifact);
  digests = artifactDigests(text);

  writeArtifact(artifactPath, text);

  sidecar = provenance.sidecar(block, text);

  // This tool's own seal, beside the contract's. `digest` is the exact bytes;
  // `payloadDigest` is the RECORD_INTO-stable link a comparison report uses to
  // name the baseline it consumed. The path is a LABEL, not a path: an
  // absolute one here is what put three sibling clones' worktrees into
  // delivered evidence.
  sidecar.artifact = {
    path         : provenance.pathLabel(artifactPath, { toolRoot: TOOL_ROOT }),
    digest       : digests.digest,
    payloadDigest: digests.payloadDigest,
    bytes        : digests.bytes,
    digestNote   : 'sha256. `digest` covers the exact bytes of the artifact ' +
      'this sidecar sits beside. `payloadDigest` covers that artifact ' +
      're-serialized with ' +
      RECORD_INTO_KEYS.map(function(key) {
        return '`' + key + '`';
      }).join(' and ') + ' set to null and its embedded `provenance` block ' +
      'removed, so it survives both --record-into embedding the completed ' +
      'comparison and the re-attachment of the block afterwards. The block ' +
      'embedded IN the artifact carries the contract\'s own payloadDigest, ' +
      'which is the seal binding it to its content.'
  };

  if (runOutput) {
    Object.keys(runOutput).forEach(function(key) {
      sidecar[key] = runOutput[key];
    });
  }

  writeArtifact(sidecarPath, serialize(sidecar));

  noteProvenance(block);

  return {
    artifactPath: artifactPath,
    sidecarPath : sidecarPath,
    text        : text,
    digests     : digests
  };
}

/**
 * Loads a recorded matrix and REFUSES one that cannot authenticate itself.
 *
 * BE-39: this tool used to read a recording with `readMatrix` and never look at
 * the provenance it had itself written, so nothing established that a file
 * named as the baseline was a baseline, that it had not been edited since it
 * was sealed, or that it came from a different tree than the one it was about
 * to be compared against. It then closed that with checks of its own against a
 * sidecar file - and SEAM-F08 found the flaw in the fix: those checks were a
 * private schema, so the sidecar they accepted carried none of the shared
 * contract's guarantees, and the delivered recording carried no embedded block
 * at all. The validator that would have caught it was already in this file and
 * was never called from here.
 *
 * SO THE AUTHENTICATION IS THE CONTRACT'S, AND IT IS ON THE ARTIFACT. What is
 * checked is `assertMatrixProvenance`, through readMatrix's `expect` path: the
 * schema version, the artifact the block claims to describe, the role, the
 * payload digest recomputed over the artifact WITHOUT its block, the generator
 * blob and commit resolved as objects in THIS repository, that the recorded
 * generator is still the delivered one, and - of anything claiming the baseline
 * role - that the tree it measured was the base commit and was clean. An
 * artifact whose outcomes were edited after capture fails the payload digest;
 * one whose block was copied in from another run fails it too.
 *
 * A SIDECAR IS NOT REQUIRED, and that is a strengthening rather than a
 * relaxation. Under the contract the sidecar is a run output and the delivered
 * artifact carries the embedded block, so demanding a companion file would
 * demand something the delivery does not ship - while a recording with a
 * sidecar and no block, which is what the demand actually admitted, is exactly
 * the artifact this gate must refuse. Where a sidecar IS present its digest
 * over the exact bytes is reconciled, because a pair that disagrees cannot be
 * read together.
 *
 * `payloadDigest` in the return value is this tool's own RECORD_INTO-stable
 * link, for what it is actually for: naming the baseline recording a comparison
 * report consumed, ACROSS a deliberate re-embed. It is a cross-artifact
 * identity link, never an integrity seal - the block's own digest is that.
 *
 * @param {string} target Absolute path of the matrix.
 * @param {string} label 'baseline' or 'target', for the messages.
 * @returns {{path: string, sidecarPath: (string|null), matrix: Object,
 *            provenance: Object, digest: string, payloadDigest: string,
 *            sealedDigest: string, embedded: boolean}} `provenance` is the
 *   AUTHENTICATED block from inside the artifact; `embedded` reports whether a
 *   completed comparison has been written into the recording.
 * @throws {ToolError} On a recording whose provenance does not establish it as
 *   parity evidence, or which does not hash to its own block.
 */
function readRecording(target, label) {
  var matrix;
  var block;
  var sidecarPath = sidecarPathFor(target);
  var sidecar;
  var text;
  var digests;

  // THE VALIDATION IS THE SHARED CONTRACT'S, through readMatrix's `expect`
  // path. It was here all along and this call site passed nothing, so the
  // whole of it - schema, artifact name, role, payload digest, generator blob
  // and commit resolved in THIS repository, and the baseline-tree cross-check
  // - never ran, and the checks that did run were this file's own against a
  // vocabulary the contract does not use.
  //
  // `roles` is the two MEASURED roles. `analysis` is refused because a
  // --schema-only artifact records no HTTP outcome and so cannot be a side of
  // this gate, and `unreviewed` is refused by construction: it is what the
  // --allow-nonbaseline escape hatch records, and declining it is the whole
  // purpose of the label. `requireBaselineTree` is left to its default, which
  // demands the base commit of anything CLAIMING the baseline role - so a
  // recording that says baseline and measured something else is refused here
  // rather than compared.
  matrix = readMatrix(target, { roles: [ROLE_BASELINE, ROLE_TARGET] });
  block  = matrix.provenance;

  // The artifact's own `role` and its block's must agree. The contract checks
  // the block; this checks that the recording a comparison reads the role off
  // is the same recording the block describes.
  if (matrix.role !== block.role) {
    throw new ToolError('the ' + label + ' recording ' + target + ' declares ' +
      'role ' + JSON.stringify(matrix.role) + ' while its embedded ' +
      'provenance declares ' + JSON.stringify(block.role) + '; the two do ' +
      'not describe one run, so the file cannot be read as either');
  }

  text    = fs.readFileSync(target, 'utf8');
  digests = artifactDigests(text);

  // The sidecar is a RUN OUTPUT and most recordings have none: the delivered
  // artifact carries the embedded block, which is what authenticates it.
  // Absence is therefore not a finding. Present-and-disagreeing IS one, and
  // assertMatrixProvenance has already reconciled its digest against these
  // exact bytes - `sidecarBeside` is what readMatrix passed it.
  sidecar = sidecarBeside(target);

  return {
    path         : target,
    sidecarPath  : sidecar === undefined ? null : sidecarPath,
    matrix       : matrix,
    // The AUTHENTICATED block, from inside the artifact. Every consumer -
    // assertComparable, reportComparison, recordComparisonInto - reads the
    // record through this, so there is one description of the run and not a
    // sidecar's and an artifact's.
    provenance   : block,
    digest       : digests.digest,
    payloadDigest: digests.payloadDigest,
    // What the contract's own seal says the artifact hashes to. Equal to
    // `digest` by construction here, because the payload digest check above
    // would have refused any difference; carried so a caller can report the
    // seal it verified against rather than re-deriving it.
    sealedDigest : block.payloadDigest.value,
    // Whether --record-into has written a comparison into this recording. Read
    // off the ARTIFACT rather than off a sidecar that need not exist: the
    // embedded `targetComparison` is the fact, and the sidecar merely
    // described it.
    embedded     : !!(matrix.targetComparison &&
      matrix.targetComparison.performed)
  };
}

/**
 * The analysed HEAD a recording's block names, or null.
 *
 * Three accessors, because the block's shape is the CONTRACT'S and the callers
 * that need these three facts should not each know how to walk it. They also
 * accept the shape this tool used to write - `app.head`, `versions.joi`,
 * `tool` - so a recording sealed by an earlier build is still readable where a
 * fact can be found rather than failing on a missing key. Nothing accepts such
 * a recording as EVIDENCE: readRecording rejects it long before these are
 * called, because it carries no embedded block at all.
 *
 * @param {Object} record From readRecording.
 * @returns {(string|null)}
 */
function analysedHeadOf(record) {
  var block = (record && record.provenance) || {};

  return (block.analysedTree && block.analysedTree.head) ||
    (block.app && block.app.head) || null;
}

/**
 * The joi version a recording was produced at, or null.
 *
 * @param {Object} record From readRecording.
 * @returns {(string|null)}
 */
function joiVersionOf(record) {
  var block = (record && record.provenance) || {};
  var detail = block.detail || {};

  return (detail.versions && detail.versions.joi) ||
    (block.versions && block.versions.joi) ||
    (record && record.matrix && record.matrix.joiVersion) || null;
}

/**
 * The identity of the generator that produced a recording.
 *
 * Reported, never enforced: the substantive risk a differing tool build carries
 * is that the two sides generated different inputs, and the crossCheck measures
 * exactly that per case and fails on it. This is what lets a reader see whether
 * ONE build drove both sides.
 *
 * @param {Object} record From readRecording.
 * @returns {{path: (string|null), blob: (string|null), commit: (string|null),
 *            verified: (boolean|null), head: (string|null)}}
 */
function generatorIdentityOf(record) {
  var block = (record && record.provenance) || {};
  var generator = block.generator || {};

  return {
    path    : generator.path || null,
    blob    : generator.blob || null,
    commit  : generator.commit || null,
    verified: generator.verified === undefined ? null : !!generator.verified,
    head    : (block.delivered && block.delivered.head) ||
      generator.deliveredHead || null
  };
}

/**
 * The major of a semver-ish version string, or null.
 *
 * @param {(string|null)} version
 * @returns {(string|null)}
 */
function majorOf(version) {
  var match = typeof version === 'string' ? /^(\d+)\./.exec(version) : null;

  return match ? match[1] : null;
}

/**
 * Refuses a comparison that is not between the two sides of the gate.
 *
 * The gate's whole claim is "the baseline joi accepted and rejected exactly
 * what the target joi accepts and rejects". A comparison of one recording with
 * itself, or of two recordings from the same tree, cannot support that claim
 * and would report zero differences with total confidence, so it is refused
 * here rather than left to the caller.
 *
 * Three checks, and only two of them can be waived:
 *
 *  - SAME PATH is refused outright, with no opt-out. There is no reading under
 *    which comparing a file with itself is evidence.
 *  - SAME APPLICATION HEAD and SAME JOI MAJOR are refused unless
 *    `--allow-same-tree` is passed, because the offline negative controls -
 *    two recordings from one tree, one of them perturbed - are legitimate and
 *    must stay runnable. Which checks the flag relaxed is recorded in the
 *    report, so a passing report can never be mistaken for a two-tree run.
 *
 * @param {Object} baseline From readRecording.
 * @param {Object} target From readRecording, or a live-run descriptor.
 * @param {boolean} allowSameTree
 * @returns {{relaxed: string[], checked: string[], baselineHead: (string|null),
 *            targetHead: (string|null), baselineJoi: (string|null),
 *            targetJoi: (string|null)}}
 * @throws {ToolError} On a comparison that cannot be evidence.
 */
function assertComparable(baseline, target, allowSameTree) {
  var baselineHead = analysedHeadOf(baseline);
  var targetHead = analysedHeadOf(target);
  var baselineJoi = joiVersionOf(baseline);
  var targetJoi = joiVersionOf(target);
  var relaxed = [];
  var checked = ['same-path', 'baseline-is-a-capture',
    'same-application-head', 'same-joi-major'];

  if (path.resolve(baseline.path) === path.resolve(target.path)) {
    throw new ToolError('refusing to compare ' + baseline.path + ' with ' +
      'itself. A self-comparison reports zero differences by construction and ' +
      'is not evidence of parity; there is no flag that permits it.');
  }

  if (baseline.matrix.role !== ROLE_BASELINE) {
    throw new ToolError('the baseline recording ' + baseline.path + ' has ' +
      'role ' + JSON.stringify(baseline.matrix.role) + ', not ' +
      JSON.stringify(ROLE_BASELINE) + '. The first --compare argument must be ' +
      'a capture of the base commit; a ' + ROLE_TARGET + ' artifact is the ' +
      'other side of a comparison that already ran, an ' + ROLE_ANALYSIS +
      ' artifact records no HTTP outcome, and an ' + ROLE_UNREVIEWED +
      ' artifact measured a tree nobody identified.');
  }

  // THE ROLE IS NOT ENOUGH, now that a role states which TREE was measured
  // rather than which flag ran. A --schema-only run pointed at the base commit
  // measured that tree honestly and records not one HTTP outcome, so the mode
  // is what separates "captured" from "read", and it is checked here because
  // the role deliberately no longer carries it.
  if (baseline.matrix.mode !== 'capture') {
    throw new ToolError('the baseline recording ' + baseline.path + ' was ' +
      'produced in ' + JSON.stringify(baseline.matrix.mode) + ' mode, not ' +
      '`capture`. Only a capture drives the cases against a running ' +
      'application and records their outcomes; comparing against anything ' +
      'else would diff measured responses with absent ones.');
  }

  if (baselineHead !== null && targetHead !== null && baselineHead === targetHead) {
    if (!allowSameTree) {
      throw new ToolError('refusing to compare two recordings taken from the ' +
        'same application HEAD (' + baselineHead.slice(0, 12) + '). The gate ' +
        'compares the base commit against the migrated tree; two recordings ' +
        'from one tree prove only that this tool is deterministic. Pass ' +
        '--allow-same-tree if that determinism check is what you meant - it ' +
        'is how the offline negative controls are run - and the relaxation ' +
        'will be recorded in the report.');
    }
    relaxed.push('same-application-head');
  }

  if (majorOf(baselineJoi) !== null && majorOf(baselineJoi) === majorOf(targetJoi)) {
    if (!allowSameTree) {
      throw new ToolError('refusing to compare two recordings produced by the ' +
        'same joi major (' + baselineJoi + ' and ' + targetJoi + '). AAP ' +
        '§0.6.2 states this gate as 17.13.3 against 18.2.5; a same-major ' +
        'comparison cannot answer it. Pass --allow-same-tree to run it as a ' +
        'determinism or negative control, recorded as such in the report.');
    }
    relaxed.push('same-joi-major');
  }

  return {
    relaxed     : relaxed,
    checked     : checked,
    baselineHead: baselineHead,
    targetHead  : targetHead,
    baselineJoi : baselineJoi,
    targetJoi   : targetJoi,
    // The tool build behind each side. REPORTED, not enforced: the substantive
    // risk a differing tool carries is that the two runs generated different
    // inputs, and the crossCheck already measures exactly that per case and
    // fails on it. The identity is the git BLOB of the generator that ran -
    // the same forty characters in every clone - with the commit it was
    // resolved in and whether that resolution succeeded, which is what a
    // reader needs to retrieve the tool rather than merely read its name.
    baselineTool: generatorIdentityOf(baseline),
    targetTool  : generatorIdentityOf(target)
  };
}

/**
 * The parsed sidecar sitting beside an artifact, or undefined.
 *
 * Absent is the normal case and is not an error. Present-but-unreadable and
 * present-but-unparseable are errors: a file that is there and cannot be used
 * is a broken pair, not an absent one, and silently treating it as absent is
 * how an unchecked digest stayed unchecked.
 *
 * @param {string} target Absolute path of the artifact.
 * @returns {(Object|undefined)}
 */
function sidecarBeside(target) {
  var file = target + '.provenance.json';
  var text;

  try {
    text = fs.readFileSync(file, 'utf8');
  }
  catch (err) {
    if (err && err.code === 'ENOENT') {
      return undefined;
    }

    throw new ToolError('the provenance sidecar ' + file + ' is present and ' +
      'could not be read: ' + err.message);
  }

  try {
    return JSON.parse(text);
  }
  catch (err) {
    throw new ToolError('the provenance sidecar ' + file + ' is present and ' +
      'is not valid JSON, so the pair cannot be reconciled: ' + err.message);
  }
}

/**
 * Refuses a recorded matrix that cannot authenticate itself.
 *
 * Five requirements, each closing a way an artifact can arrive unable to
 * account for itself:
 *
 *   a block at all         Provenance kept only in a separate file means an
 *                          artifact can arrive with none whatever and be
 *                          consumed as baseline evidence. A matrix with no
 *                          embedded block is refused, with the exact command
 *                          that regenerates it.
 *   schema 2               A schema-1 block carries no `generator.blob` and no
 *                          `verified`, so its claim cannot be checked at all;
 *                          accepting one would readmit exactly that.
 *   the artifact name      A block names the artifact it describes, so a block
 *                          copied in from another run is caught rather than
 *                          read as this artifact's own.
 *   the role               `baseline` or `target`. `unreviewed` is refused BY
 *                          CONSTRUCTION - it is what --allow-nonbaseline
 *                          records, and the whole purpose of that role is that
 *                          a gate declines it. `analysis` is refused too: this
 *                          gate compares MEASURED responses, and an artifact
 *                          derived without executing an application has none.
 *   the payload digest     Recomputed over the matrix WITHOUT its `provenance`
 *                          key. This is what binds a block to its artifact: a
 *                          recording whose outcomes were edited after capture,
 *                          or whose block came from a different run, fails here.
 *
 * Plus one cross-check: an artifact CLAIMING the `baseline` role must have
 * measured a tree at BASELINE_COMMIT. A role claim and the tree the block names
 * can disagree, and when they do the artifact reads as a baseline while
 * describing some other checkout.
 *
 * Every failure is listed, not just the first: a reviewer regenerating an
 * artifact wants the whole verdict in one run.
 *
 * @param {string} target Absolute path, for the messages.
 * @param {string} text The exact bytes read.
 * @param {Object} matrix The parsed matrix.
 * @param {Object} expect See readMatrix.
 * @returns {Object} The validated block.
 * @throws {ToolError} On any failure.
 */
function assertMatrixProvenance(target, text, matrix, expect) {
  var block = provenance.extract(text);
  var roles = expect.roles || ['baseline', 'target'];
  var payload = {};
  var requireBaseline;
  var verdict;

  if (!block) {
    throw new ToolError('matrix ' + target + ' carries no provenance block, ' +
      'so it does not say which tree it measured, which joi resolved there or ' +
      'which generator produced it - and a comparison against an artifact ' +
      'that cannot say what it measured is not a comparison. Regenerate it ' +
      'with `node test/parity/joi-matrix.js --capture --app <worktree at ' +
      provenance.BASELINE_HEAD.slice(0, 7) + '> --out ' + target +
      ' >/dev/null 2>/dev/null`, which embeds a schema ' + provenance.SCHEMA +
      ' block under the artifact\'s `provenance` key.');
  }

  Object.keys(matrix).forEach(function(key) {
    if (key !== 'provenance') {
      payload[key] = matrix[key];
    }
  });

  requireBaseline = expect.requireBaselineTree === undefined
    ? block.role === 'baseline'
    : !!expect.requireBaselineTree;

  verdict = provenance.validate(block, {
    artifact           : path.basename(target),
    roles              : roles,
    requireBaselineTree: requireBaseline,
    payload            : payload,
    // The two that make the identity checkable rather than merely present.
    // Without `repositoryRoot` the contract can resolve nothing, so a block
    // naming a random 40-hex generator blob, a generator commit that is not an
    // object and a delivered head from no repository passes as `provenance OK`
    // - every field well-formed and none of them looked up. Without
    // `requireGeneratorVerified`, a block that admits `verified: false` is
    // accepted on its own admission. This is a GATE consumer: it declines an
    // artifact it cannot authenticate, and there is no waiver here, because the
    // generators shipped alongside it are committed.
    repositoryRoot          : TOOL_ROOT,
    requireGeneratorVerified: true,
    // Where a sidecar sits beside the matrix, its digest over the exact bytes
    // is reconciled too. A sidecar is a run output rather than part of the
    // delivery, so its absence is not a finding - but one that exists and
    // disagrees means the pair cannot be read together.
    sidecar            : expect.sidecar,
    artifactText       : expect.sidecar === undefined ? undefined : text
  });

  if (!verdict.ok) {
    throw new ToolError('the provenance of matrix ' + target + ' does not ' +
      'establish it as parity evidence, so it was not consumed:\n  ' +
      verdict.failures.join('\n  ') + '\nRegenerate the artifact with the ' +
      'generator that produced its measurements; a block may not be edited ' +
      'into an artifact by hand.');
  }

  note('provenance OK ' + path.basename(target) + ': role ' + block.role +
    ', analysed tree ' +
    ((block.analysedTree && block.analysedTree.headShort) || 'none') +
    (requireBaseline ? ' (the base commit)' : '') +
    ', generator blob ' +
    String(block.generator && block.generator.blob).slice(0, 12) +
    ', ' + verdict.checks.length + ' check(s) passed');

  return block;
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
 * a capture: the two joi lines a matrix can be captured at are the two sides of
 * this gate, and a reviewer must be able to see which side a recording is
 * without trusting a filename.
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
 * selects the in-memory branch. The overlay is passed identically to both trees
 * so no configuration file is edited to achieve it.
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
 * Everything here must precede it, because `config` freezes its values on first
 * require and the harvest loads the declaration modules immediately afterwards:
 *   NODE_CONFIG_DIR  An ABSOLUTE `<appRoot>/config`. The npm `config` package
 *                    resolves its directory from process.cwd() unless told
 *                    otherwise, so without this a baseline run would read the
 *                    TARGET tree's YAML - and the recaptcha-conditional schema
 *                    in config/api_routes.js is derived FROM configuration, so
 *                    the target set itself would come from the wrong tree.
 *                    An inherited value belonging to another tree is replaced,
 *                    and the replacement is announced.
 *   NODE_CONFIG      The redis overlay described in composeNodeConfig.
 *   the isolation    NODE_CONFIG_PERSIST_ON_CHANGE, NODE_CONFIG_DISABLE_FILE_WATCH
 *                    and NODE_CONFIG_RUNTIME_JSON, from ./mongo's one
 *                    implementation.
 *
 * WHY ALL THREE, AND WHY THERE IS NO `process.chdir` HERE. Persistence alone
 * does not keep config/runtime.json out of the tree under test: the npm
 * `config` package writes '{}' into its runtime JSON whenever that file is
 * missing or empty, and skips the write only when NODE_CONFIG_PERSIST_ON_CHANGE
 * is 'N' AND the file watch is disabled. With the working directory pointed
 * INTO the analysed tree, the default runtime path points there too, so a run
 * creates config/runtime.json inside a tree that is supposed to be untouched -
 * invisibly, because the file is gitignored, and consequentially, because
 * `config` layers runtime.json OVER every other configuration source and the
 * next run would read it.
 *
 * There is no chdir to compensate for, because nothing after this point selects
 * a module or a configuration file by working directory: `requireFromApp`
 * resolves every application module absolutely inside `appRoot`, `mongoose` is
 * required by absolute path, `startInfrastructure` passes `appRoot` to
 * test/parity/server.js explicitly, test/parity/seed.js resolves its models
 * relative to its own file, and every artifact path is resolved against
 * `originalCwd` in `parseArguments` before this runs. NODE_ENV is set to 'test'
 * unless the caller overrode it; whatever value results is recorded in the
 * provenance and passed identically to both trees.
 *
 * @param {string} appRoot Absolute path, already validated.
 * @returns {{nodeEnv: string, nodeConfig: string, nodeConfigDir: string,
 *            runtimeJsonPath: string, originalCwd: string}}
 */
function prepareEnvironment(appRoot) {
  var nodeConfig    = composeNodeConfig(process.env.NODE_CONFIG);
  var originalCwd   = process.cwd();
  var isolation;

  if (!process.env.NODE_ENV) {
    process.env.NODE_ENV = 'test';
  }

  isolation = lazyMongo().isolateRuntimeConfig({
    appRoot   : appRoot,
    configDir : 'set'
  });

  process.env.NODE_CONFIG = nodeConfig;

  return {
    nodeEnv         : process.env.NODE_ENV,
    nodeConfig      : nodeConfig,
    nodeConfigDir   : isolation.configDir,
    runtimeJsonPath : isolation.runtimeJsonPath,
    originalCwd     : originalCwd
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
 * means `joi` itself resolves from <appRoot>/node_modules, which is what puts a
 * different joi on each side of the comparison.
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
  var constants;
  var helpers;

  // BEFORE the route modules: config/constants.js publishes itself onto the
  // `config` object, and config/routes.js reads `config.constants.trinketLangs`
  // at load to run its per-language expansion. Required in the other order it
  // expands nothing or throws.
  constants = requireFromApp(appRoot, 'config/constants');

  pageRoutes  = requireFromApp(appRoot, 'config/routes');
  apiRoutes   = requireFromApp(appRoot, 'config/api_routes');
  routeParser = requireFromApp(appRoot, 'lib/util/routeParser');
  joi         = requireFromApp(appRoot, 'node_modules/joi');
  // Not a new load: config/routes.js imports its pre-handlers from this module,
  // so it is already in the require cache by the line above. It is bound here
  // because FUNCTION_PRE_CONSUMERS identifies an opaque pre-handler by
  // reference identity against these exports, which is the only way to know
  // what a function-form pre-handler reads off the request.
  helpers     = requireFromApp(appRoot, 'lib/util/helpers');

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
    // The tree's own pre-handler module and its `trinketLangs`, which is what
    // the known-value layer derives from rather than from a literal here.
    helpers       : helpers,
    constants     : constants,
    langEnum      : trinketLangEnum(appRoot, constants),
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
// The known-value layer - values a generated one cannot substitute for
// ---------------------------------------------------------------------------

/**
 * The trinket languages the tree under test accepts, in declaration order.
 *
 * Read from the MODEL first, because `Trinket.schema.path('lang').enumValues`
 * is the list lib/util/helpers.js's `validLang` actually tests against, and
 * only then from `config.constants.trinketLangs`, which is where
 * lib/models/trinket.js gets it. Both come from the tree under test, so a tree
 * that added or removed a language moves this list with it rather than
 * diverging from a copy kept here.
 *
 * The model require is not a new load: config/routes.js imports
 * lib/util/helpers.js, which requires the model at its own module scope, so the
 * harvest has already paid for it. It is still guarded, because a tree whose
 * model shape moved must degrade to the constants list rather than fail a run
 * over provenance for a value it can obtain another way.
 *
 * @param {string} appRoot Absolute path.
 * @param {Object} constants The tree's config/constants exports.
 * @returns {string[]} Possibly empty, which the caller reports rather than
 *   silently substituting for.
 */
function trinketLangEnum(appRoot, constants) {
  var model;
  var enumerated;

  try {
    model = requireFromApp(appRoot, 'lib/models/trinket');
    enumerated = model && model.schema && model.schema.path
      ? model.schema.path('lang').enumValues
      : null;
  }
  catch (err) {
    enumerated = null;
  }

  if (Array.isArray(enumerated) && enumerated.length) {
    return enumerated.slice();
  }

  return constants && Array.isArray(constants.trinketLangs)
    ? constants.trinketLangs.slice()
    : [];
}

/**
 * A function -> export-name resolver for the tree's pre-handler module.
 *
 * `preDescriptors` records a function-form pre-handler as `kind: 'function'`
 * with no name, and the reason it gives is sound: a function's own `.name` is
 * empty or property-inferred here, and a source digest would differ between the
 * two trees because converting lib/util/helpers.js to the hapi lifecycle
 * contract is the change this gate must see through. The EXPORT NAME is neither
 * of those things - it is `validLang` on both trees - so it is both stable and
 * comparable, and it is the fact the known-value layer needs.
 *
 * Both spellings are indexed: the bare function (`pre: [helpers.verifyEmailToken]`)
 * and the `{assign, method}` object (`pre: [helpers.validLang]`), whose object
 * identity is what a declaration holds.
 *
 * @param {Object} helpers The tree's lib/util/helpers exports.
 * @returns {function(*): (string|null)} A lookup from a pre entry to its name.
 */
function helperResolver(helpers) {
  var byFunction = new Map();
  var byObject   = new Map();

  Object.keys(helpers || {}).forEach(function(name) {
    var value = helpers[name];

    if (typeof value === 'function') {
      byFunction.set(value, name);
      return;
    }

    if (isPlainObject(value) && typeof value.method === 'function') {
      byObject.set(value, name);
      byFunction.set(value.method, name);
    }
  });

  return function(entry) {
    if (typeof entry === 'function') {
      return byFunction.get(entry) || null;
    }

    if (isPlainObject(entry)) {
      if (byObject.has(entry)) {
        return byObject.get(entry);
      }

      if (typeof entry.method === 'function') {
        return byFunction.get(entry.method) || null;
      }
    }

    return null;
  };
}

/**
 * A base64 ZIP holding one STORED entry, built from Node core.
 *
 * Deterministic to the byte, which is the requirement: the generated inputs of
 * a baseline capture and of a target replay are cross-checked against each
 * other, so a value carrying a timestamp or a compressor's choices would be
 * reported as a divergence that has nothing to do with joi. So the entry is
 * stored rather than deflated - no compressor is involved at all - and the DOS
 * timestamp is the fixed 1980-01-01 that a zero date field encodes, rather than
 * the clock.
 *
 * The 30-byte local header, the 46-byte central directory record and the
 * 22-byte end-of-central-directory record are the format's own fixed layouts;
 * `zlib.crc32` supplies the checksum the reader verifies, and the entry reads
 * back byte-identically through the `jszip` each tree resolves.
 *
 * @param {string} name The single entry's name.
 * @param {string} content Its bytes, as UTF-8 text.
 * @returns {string} base64.
 */
function buildZipCode(name, content) {
  var nameBuffer = Buffer.from(name, 'utf8');
  var data       = Buffer.from(content, 'utf8');
  var checksum   = zlib.crc32(data) >>> 0;
  var local      = Buffer.alloc(30);
  var central    = Buffer.alloc(46);
  var end        = Buffer.alloc(22);
  var localSize;
  var centralSize;

  local.writeUInt32LE(0x04034b50, 0);   // local file header signature
  local.writeUInt16LE(10, 4);           // version needed to extract: 1.0
  local.writeUInt16LE(0, 6);            // general purpose flags
  local.writeUInt16LE(0, 8);            // compression method: stored
  local.writeUInt16LE(0, 10);           // last modified time: 00:00:00
  local.writeUInt16LE(33, 12);          // last modified date: 1980-01-01
  local.writeUInt32LE(checksum, 14);
  local.writeUInt32LE(data.length, 18); // compressed size
  local.writeUInt32LE(data.length, 22); // uncompressed size
  local.writeUInt16LE(nameBuffer.length, 26);
  local.writeUInt16LE(0, 28);           // extra field length

  central.writeUInt32LE(0x02014b50, 0); // central directory signature
  central.writeUInt16LE(20, 4);         // version made by: 2.0
  central.writeUInt16LE(10, 6);         // version needed to extract: 1.0
  central.writeUInt16LE(0, 8);
  central.writeUInt16LE(0, 10);
  central.writeUInt16LE(0, 12);
  central.writeUInt16LE(33, 14);
  central.writeUInt32LE(checksum, 16);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(nameBuffer.length, 28);
  central.writeUInt16LE(0, 30);         // extra field length
  central.writeUInt16LE(0, 32);         // file comment length
  central.writeUInt16LE(0, 34);         // disk number start
  central.writeUInt16LE(0, 36);         // internal attributes
  central.writeUInt32LE(0, 38);         // external attributes
  central.writeUInt32LE(0, 42);         // offset of the local header

  localSize   = local.length + nameBuffer.length + data.length;
  centralSize = central.length + nameBuffer.length;

  end.writeUInt32LE(0x06054b50, 0);     // end of central directory signature
  end.writeUInt16LE(0, 4);              // this disk
  end.writeUInt16LE(0, 6);              // disk with the central directory
  end.writeUInt16LE(1, 8);              // entries on this disk
  end.writeUInt16LE(1, 10);             // entries in total
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(localSize, 16);
  end.writeUInt16LE(0, 20);             // comment length

  return Buffer.concat([
    local, nameBuffer, data, central, nameBuffer, end
  ]).toString('base64');
}

/**
 * The JWT `helpers.verifyEmailToken` will accept for the seeded trinket.
 *
 * The secret and the claim are the application's: lib/util/helpers.js's
 * `verifyEmailToken` calls
 * `jwt.verify(token, config.app.mail.secret + trinket.shortCode)` and then
 * requires `data.shortCode === trinket.shortCode`. The concatenation is
 * reproduced as JavaScript performs it, undefined included -
 * committed configuration declares no `app.mail.secret`, so the secret in force
 * is the string `'undefined' + shortCode`, and a run against a tree that
 * declares one picks that up instead because the value is read from the
 * configuration this process froze against the same overlay the child received.
 *
 * IT IS SIGNED HERE RATHER THAN BY THE TREE'S OWN `jsonwebtoken`, because the
 * two trees resolve different majors of that package and their headers
 * serialize in different key orders - `{"typ","alg"}` against `{"alg","typ"}` -
 * so the same claim signs to different bytes on the two sides. The generated
 * inputs of the two runs are cross-checked against each other, so that
 * difference would be reported as a generated-input divergence
 * and the two runs would no longer be the same experiment. A fixed header order
 * and no `iat` claim make the token byte-identical on both trees; it is then
 * VERIFIED through the tree's own `jsonwebtoken` before it is used, so the
 * value is proven acceptable to the exact library the application will hand it
 * to. If that verification fails the token is not substituted and the target is
 * reported as unreached rather than driven with a value this tool believes in
 * and the application does not.
 *
 * @param {string} appRoot Absolute path.
 * @param {string} shortCode The seeded trinket's shortCode.
 * @returns {{token: (string|null), verified: boolean, reason: (string|null)}}
 */
function buildEmailToken(appRoot, shortCode) {
  var header  = { alg: 'HS256', typ: 'JWT' };
  var claims  = { shortCode: shortCode };
  var configuration;
  var secret;
  var signing;
  var token;
  var jwt;

  function base64url(value) {
    return Buffer.from(value, 'utf8').toString('base64')
      .replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  }

  try {
    configuration = requireFromApp(appRoot, 'node_modules/config');
  }
  catch (err) {
    return {
      token    : null,
      verified : false,
      reason   : 'the tree\'s `config` package could not be read, so the mail ' +
        'secret the application will verify against is unknown'
    };
  }

  secret = (configuration.app && configuration.app.mail
    ? configuration.app.mail.secret
    : undefined) + shortCode;

  signing = base64url(JSON.stringify(header)) + '.' +
    base64url(JSON.stringify(claims));

  token = signing + '.' + crypto.createHmac('sha256', secret)
    .update(signing).digest('base64')
    .replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

  try {
    jwt = requireFromApp(appRoot, 'node_modules/jsonwebtoken');
  }
  catch (err) {
    return {
      token    : null,
      verified : false,
      reason   : 'the tree\'s `jsonwebtoken` could not be read, so the token ' +
        'could not be verified with the library the application uses'
    };
  }

  try {
    if (jwt.verify(token, secret).shortCode !== shortCode) {
      return {
        token    : null,
        verified : false,
        reason   : 'the tree\'s `jsonwebtoken` decoded the token to a ' +
          'different shortCode than it was signed with'
      };
    }
  }
  catch (err) {
    return {
      token    : null,
      verified : false,
      reason   : 'the tree\'s `jsonwebtoken` rejected the token this tool ' +
        'signed: ' + (err && err.message ? err.message : String(err))
    };
  }

  return { token: token, verified: true, reason: null };
}

/**
 * The known values for one run, resolved once and recorded in the artifact.
 *
 * Every entry is derived from the tree under test or from the seeded fixtures,
 * and every entry carries its own `source` so the artifact says where the value
 * came from rather than leaving a reviewer to recognize it. A value that could
 * not be resolved is recorded with its reason and simply not substituted, which
 * leaves the affected target reported as unreached - visible - rather than
 * driven with something misleading.
 *
 * @param {Object} loaded The harvest result.
 * @param {string} appRoot Absolute path.
 * @param {Object} seed The test/parity/seed.js module.
 * @returns {Object} value name -> {value, source, reason}.
 */
function knownValues(loaded, appRoot, seed) {
  var trinket = seed.fixtures.trinkets.trinketPython;
  var lang    = loaded.langEnum.length ? loaded.langEnum[0] : null;
  var email   = buildEmailToken(appRoot, trinket.shortCode);

  return {
    lang : {
      value  : lang,
      source : lang === null
        ? null
        : 'the first entry of Trinket.schema.path(\'lang\').enumValues in the ' +
          'tree under test, which is config.constants.trinketLangs and is the ' +
          'list helpers.validLang tests against; ' + loaded.langEnum.length +
          ' language(s) available',
      reason : lang === null
        ? 'neither the tree\'s Trinket model nor its config/constants exposed ' +
          'a trinket language list, so no lang could be substituted'
        : null
    },
    emailToken : {
      value  : email.token,
      source : email.verified
        ? 'HS256 over {"shortCode":"' + trinket.shortCode + '"} with the ' +
          'secret config.app.mail.secret + shortCode, no `iat` claim, and ' +
          'verified through the tree\'s own jsonwebtoken ' +
          (packageVersion(appRoot, 'jsonwebtoken') || '?')
        : null,
      reason : email.reason
    },
    zipCode : {
      value  : buildZipCode(ZIP_ENTRY_NAME, ZIP_ENTRY_CONTENT),
      source : 'a stored-entry ZIP built from Node core, one entry named `' +
        ZIP_ENTRY_NAME + '` holding the JSON text ' + ZIP_ENTRY_CONTENT +
        ', so JSZip.loadAsync resolves and the JSON.parse the handler applies ' +
        'to the entry succeeds',
      reason : null
    }
  };
}

/**
 * The known values one target's section must carry, by key.
 *
 * Two sources, and both are declaration-driven rather than route-listed:
 *   * a FUNCTION pre-handler this tool can identify by reference against the
 *     tree's helpers module, whose requirements FUNCTION_PRE_CONSUMERS states;
 *   * a leaf whose value the HANDLER decodes, per HANDLER_ENCODED_LEAVES.
 *
 * A key is returned only when the section actually declares a leaf for it, so
 * nothing is invented for a schema that says nothing about it.
 *
 * @param {Object} target A target record.
 * @param {Array.<Object>} leaves From describeLeaves.
 * @param {Object} resolved From knownValues.
 * @returns {Object} key -> {value, name, via}.
 */
function knownValuesFor(target, leaves, resolved) {
  var declared = {};
  var out = {};

  leaves.forEach(function(leaf) {
    declared[leaf.key] = true;
  });

  function take(key, name, via) {
    if (!declared[key] || out[key] !== undefined) {
      return;
    }

    if (!resolved[name] || resolved[name].value === null ||
        resolved[name].value === undefined) {
      return;
    }

    out[key] = { value: resolved[name].value, name: name, via: via };
  }

  target.pre.forEach(function(descriptor) {
    var requirements = descriptor.helper
      ? FUNCTION_PRE_CONSUMERS[descriptor.helper]
      : null;

    if (!requirements) {
      return;
    }

    requirements.forEach(function(requirement) {
      take(requirement.key, requirement.value,
        'pre-handler helpers.' + descriptor.helper);
    });
  });

  Object.keys(HANDLER_ENCODED_LEAVES).forEach(function(key) {
    take(key, HANDLER_ENCODED_LEAVES[key], 'handler-decoded leaf');
  });

  return out;
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
 * A function's SOURCE identity is deliberately not recorded: every pre-handler
 * function here reports an empty or property-inferred `.name`, and a source
 * digest would differ between the two trees for every function-form entry
 * because converting lib/util/helpers.js to the hapi lifecycle contract is the
 * very change this gate must see through.
 *
 * Its EXPORT NAME is recorded, and is neither of those things. Resolved by
 * reference identity against the tree's own lib/util/helpers exports - see
 * helperResolver - it is `validLang` on both trees, so it is comparable, and it
 * is what tells the known-value layer that this route's opaque pre-handler will
 * read `query.lang` and answer 404 for a filler value. `null` for a string form,
 * whose `method` already says everything, and for a function this tool cannot
 * attribute to an export.
 *
 * @param {Object} declaration
 * @param {(function(*): (string|null))} [resolve] From helperResolver.
 * @returns {Array.<{kind: string, method: (string|null), assign: (string|null),
 *                   helper: (string|null)}>}
 */
function preDescriptors(declaration, resolve) {
  var pre = declaration.config && declaration.config.pre;
  var name = typeof resolve === 'function'
    ? resolve
    : function() { return null; };

  if (!Array.isArray(pre)) {
    return [];
  }

  return pre.map(function(entry) {
    if (typeof entry === 'string') {
      return { kind: 'string', method: entry, assign: null, helper: null };
    }

    if (typeof entry === 'function') {
      return {
        kind   : 'function',
        method : null,
        assign : null,
        helper : name(entry)
      };
    }

    if (isPlainObject(entry)) {
      return {
        kind   : typeof entry.method === 'string'
          ? 'object-with-string'
          : 'object-with-function',
        method : typeof entry.method === 'string' ? entry.method : null,
        assign : entry.assign === undefined ? null : entry.assign,
        helper : typeof entry.method === 'string' ? null : name(entry)
      };
    }

    return { kind: 'unclassified', method: null, assign: null, helper: null };
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
 * Applies the known values, keeping only those the schema still accepts.
 *
 * The same verification `applySubstitutions` performs, and for the same reason:
 * a substitution the schema rejected would turn the accepting case into a
 * rejecting one. A known value that the schema will not take is therefore NOT
 * applied and NOT recorded as applied - which leaves the affected target
 * reported as unreached, visible in the artifact and fatal unless it is in
 * REVIEWED_UNREACHED, rather than silently driven with a value the pre-handler
 * will refuse.
 *
 * @param {Object} schema The compiled section schema.
 * @param {Object} input The accepting input, modified in place.
 * @param {Object} wanted From knownValuesFor: key -> {value, name, via}.
 * @param {string} transport From transportFor.
 * @returns {Object} key -> {value, name, via}, for those actually applied.
 */
function applyKnownValues(schema, input, wanted, transport) {
  var applied = {};

  Object.keys(wanted).forEach(function(key) {
    var previous;

    if (!Object.prototype.hasOwnProperty.call(input, key)) {
      // The accepting builder left this key out - it is optional and the
      // section is satisfied without it - so there is nothing to replace. The
      // key is still added, because a pre-handler that reads it needs it
      // PRESENT, and the value is verified below like any other.
      input[key] = wanted[key].value;

      if (validateLocally(schema, serverVisible(transport, input)).accepted) {
        applied[key] = wanted[key];
        return;
      }

      delete input[key];
      return;
    }

    previous = input[key];
    input[key] = wanted[key].value;

    if (validateLocally(schema, serverVisible(transport, input)).accepted) {
      applied[key] = wanted[key];
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
 *     `GET /signup` out of a validation measurement, where it would be noise
 *     rather than a validation outcome.
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
  // The deep copy owns its own plain-object containers, so an `{assign, method}`
  // pre-handler is a COPY and its object identity is gone - but the `method`
  // function inside it passed by reference, which is what helperResolver
  // matches on. See deepCopy.
  var resolve = helperResolver(loaded.helpers);

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
    pre        = preDescriptors(declaration, resolve);
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
    // '9bad' is the violator whose message the inertness record is read from:
    // it produces `"username" with value "9bad" fails to match the required
    // pattern: /.../` on both joi lines, and that string is what the `language`
    // map's substring key is tested against.
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
 * @param {string[]} [excluded] Keys carrying a seeded identifier or a known
 *   value; those leaves are NOT TRIED AT ALL. Violating one answers from the
 *   pre-handler that consumes it, before the validation block runs, so a case
 *   built that way records no joi evidence - which the reach assertion now
 *   fails on. Excluding a key cannot empty the ladder: every transport a
 *   seeded or known value appears on also admits the unknown-key fallback.
 * @param {string[]} [preferred] Keys the page this target's failure redirects
 *   to RENDERS, from renderedRedirectFields; those leaves are tried FIRST so
 *   the rejecting case also evidences the rendered message. A preference only -
 *   a preferred leaf that admits no deliverable violation falls through to the
 *   ordinary order, and an excluded key stays excluded.
 * @param {string[]} [additional] Keys to violate IN ADDITION to the chosen
 *   one, used where the primary violation must not move: a `language`-map
 *   target keeps the violation PHASE 5 measures its inertness on, and gains
 *   the rendered field beside it so one case proves both. Each is applied only
 *   if the resulting input still rejects, and every one applied is reported in
 *   `additionalViolations` so the artifact never hides a second violation.
 * @returns {{ok: boolean, input: *, strategy: (string|null),
 *            field: (string|null), attempts: number, excluded: string[],
 *            determination: (string|null), reason: (string|null)}}
 */
function buildRejectingInput(schema, leaves, accepting, transport, referenced,
  excluded, preferred, additional) {
  var referencedSet = referenced || {};
  var preferredSet = {};
  var excludedSet = {};
  var extras = [];
  var fallbacks = shapeFallbacks(transport);
  var attempts = 0;
  var chosen = null;
  var ordered;
  var unreferenced;
  var steeredAround;

  (excluded || []).forEach(function(key) {
    excludedSet[key] = true;
  });

  // Fields the page this target's failure redirects to actually renders. See
  // renderedRedirectFields: violating one of them yields the same schema
  // verdict AND proves the message reaches the client, so it is tried first. It
  // is a PREFERENCE and nothing else - a preferred leaf that admits no
  // deliverable violation falls through to the ordinary ladder below.
  (preferred || []).forEach(function(key) {
    preferredSet[key] = true;
  });

  leaves = leaves.filter(function(leaf) {
    return !excludedSet[leaf.key];
  });

  ordered = leaves.slice().sort(function(a, b) {
    var steer = (preferredSet[b.key] ? 1 : 0) - (preferredSet[a.key] ? 1 : 0);
    var difference;

    if (steer !== 0) {
      return steer;
    }

    difference = rejectionPriority(a) - rejectionPriority(b);

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
      additionalViolations : [],
      attempts : attempts,
      excluded : Object.keys(excludedSet).sort(),
      determination : fallbacks.unknownKey || fallbacks.nonObject
        ? DETERMINATION_UNRESOLVED
        : DETERMINATION_TRANSPORT,
      reason   : fallbacks.unknownKey || fallbacks.nonObject
        ? 'no input rejected after ' + attempts + ' attempt(s) across every ' +
          'leaf violation and the ' +
          (fallbacks.nonObject ? 'two' : 'one') + ' shape fallback(s) this ' +
          'transport can deliver' +
          (Object.keys(excludedSet).length
            ? ', with ' + Object.keys(excludedSet).sort().join(', ') +
              ' withheld as pre-handler-consumed or seeded'
            : '')
        : 'no leaf of this section can be violated - every non-empty value ' +
          'satisfies it - and the transport is `' + transport + '`, so a ' +
          'client can neither add a key nor make the value anything but an ' +
          'object: hapi assembles request.params from the segments the route ' +
          'declares. There is no request that makes this target reject.'
    };
  }

  // The additional violations, applied on top of the chosen input and kept
  // only while the whole input still rejects. Each is verified through the same
  // local proof the primary went through, so a second violation can never turn
  // a rejecting case into an accepting one or into a case whose rejection is
  // not what it says it is.
  (additional || []).forEach(function(key) {
    var leaf = leaves.filter(function(candidate) {
      return candidate.key === key;
    })[0];

    if (!leaf || key === chosen.field || excludedSet[key] ||
        referencedSet[key]) {
      return;
    }

    violationsFor(leaf).some(function(violation) {
      var candidate;
      var outcome;

      if (!isDeliverable(transport, violation)) {
        return false;
      }

      candidate = deepCopy(chosen.input);

      if (violation.omit) {
        delete candidate[key];
      }
      else {
        candidate[key] = violation.value;
      }

      attempts += 1;
      outcome = validateLocally(schema, projectValue(transport, candidate));

      if (outcome.accepted || outcome.paths.indexOf(chosen.field) === -1 ||
          outcome.paths.indexOf(key) === -1) {
        // Either the input stopped rejecting, or one of the two violations
        // stopped being reported - abortEarly is false, so both paths must be
        // present or this is not the case it claims to be.
        return false;
      }

      chosen.input = candidate;
      extras.push({ field: key, strategy: violation.strategy });

      return true;
    });
  });

  return {
    ok       : true,
    input    : chosen.input,
    strategy : chosen.strategy,
    field    : chosen.field,
    // Empty for every case that carries exactly one violation, which is all of
    // them but the `language`-map targets whose redirect destination renders a
    // different field.
    additionalViolations : extras,
    attempts : attempts,
    excluded : Object.keys(excludedSet).sort(),
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
 * SEGMENT, which is what decides the bytes the schema will see. The four routes
 * declaring `payload.output === 'file'` are
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
 * This is the half of the input record that says what arrived rather than what
 * was meant. A query string and a path segment carry only text, so
 * `request.query.index` is the STRING '42' however
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
 * request can produce, so the reasoning is recorded as a determination instead
 * of an unreachable case being invented.
 *
 * A query parameter has neither constraint: `?page=` delivers '' and leaving it
 * out delivers nothing, and both reach the validation block.
 *
 * @param {string} transport From transportFor.
 * @param {{strategy: string, value: *, omit: boolean}} violation The candidate
 *   violation: how it breaks the leaf, the value it would send, and whether it
 *   works by omitting the key altogether.
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
 * KNOWN VALUES are applied to the accepting input BEFORE the rejecting and
 * coercion ladders run off it, and their keys are then withheld from the
 * rejecting ladder entirely. Both halves are load-bearing. Applying them first
 * is what makes all three cases carry them, including the optional keys a
 * violation would otherwise be free to omit; withholding the keys is what stops
 * the ladder choosing the one leaf whose value a pre-handler consumes, which is
 * how a rejecting case ends up answering 404 from something that ran before the
 * validation block. Withholding cannot empty the ladder: the unknown-key and
 * non-object shape fallbacks are available on every transport a known value
 * appears on.
 *
 * @param {Object} joi The joi from the tree under test.
 * @param {Object} target A target record.
 * @param {(Object|null)} resolved The run's known values, from knownValues.
 * @param {(Object|null)} [steering] `{matchers, appRoot}`, from which
 *   renderedRedirectFields derives the fields this target's fail-redirect page
 *   renders and any value the input must carry to reach it. Every input to
 *   that derivation is a declaration or a template of the tree under test, so
 *   both sides of the gate steer identically.
 * @returns {{cases: Array.<Object>, schema: Object, leaves: Array.<Object>}}
 * @throws {ToolError} If the section cannot be compiled or described.
 */
function buildCases(joi, target, resolved, steering) {
  var schema    = compileSection(joi, target);
  var leaves    = describeLeaves(schema);
  var transport = transportFor(target);
  var accepting = buildAcceptingInput(schema, leaves, transport);
  var seeded    = applySubstitutions(schema, accepting.input,
    target.lookupFixtures, transport);
  // The fail-redirect steering, resolved HERE because it needs this section's
  // leaf keys: a value is only planted for a field the input actually has, and
  // a field is only preferred if the destination page renders it.
  var steer     = steering
    ? renderedRedirectFields(target, steering.matchers, steering.appRoot,
      leaves.map(function(leaf) {
        return leaf.key;
      }))
    : { fields: [], plant: null, destination: null, template: null };
  var wanted    = resolved ? knownValuesFor(target, leaves, resolved) : {};
  var known;
  var excluded;
  var rejecting;
  var coercion;
  var cases     = [];

  // The planted redirect value is a known value like any other: derived from
  // the tree under test, carried by every case of the target so the three are
  // one experiment, and withheld from the rejecting ladder so no case can
  // violate the field that decides where the failure redirects to.
  if (steer.plant && wanted[steer.plant.key] === undefined) {
    wanted[steer.plant.key] = {
      value: steer.plant.value,
      name : 'redirectDestination',
      via  : 'the declared fail.redirect `' + target.fail.redirect +
        '`, solved against the GET route table to `' + steer.destination +
        '`, whose template ' + steer.template + ' renders flash.validation for ' +
        steer.fields.join(', ')
    };
  }

  known    = applyKnownValues(schema, accepting.input, wanted, transport);

  // applyKnownValues keeps a value only while the input still ACCEPTS, so a
  // planted redirect value the section rejects is silently not applied. The
  // steering goes with it: without the plant the failure redirects somewhere
  // else, and steering the ladder at a field that page does not render would
  // record a preference no rendered message follows from.
  if (steer.plant && !known[steer.plant.key]) {
    steer = { fields: [], plant: null, destination: null, template: null };
  }

  // Every key carrying a seeded identifier or a known value: withheld from the
  // rejecting ladder entirely, rather than merely tried last.
  excluded = Object.keys(known).concat(Object.keys(seeded));

  rejecting = buildRejectingInput(schema, leaves, accepting.input, transport,
    referencedKeys(target.preReferences, target.section), excluded,
    // A `language`-map target keeps the violation PHASE 5 measures its
    // inertness on, so the rendered field is added ALONGSIDE it rather than
    // chosen instead of it. Every other target simply prefers it.
    target.languageMap ? [] : steerable(steer.fields),
    target.languageMap ? steerable(steer.fields) : []);

  coercion = buildCoercionInput(schema, leaves, accepting.input, transport);

  /**
   * The steerable subset of a field list: declared, and not already carrying a
   * seeded or known value.
   *
   * @param {string[]} fields
   * @returns {string[]}
   */
  function steerable(fields) {
    return (fields || []).filter(function(key) {
      return excluded.indexOf(key) === -1;
    });
  }

  /**
   * The known values one case's input actually carries.
   *
   * Recorded per case rather than once per target, because carrying them is
   * what makes the case reach the validation block and a case that lost one is
   * a case whose outcome is about a pre-handler. The rejecting ladder cannot
   * drop one by violating its leaf - those keys are withheld from it - but the
   * `not-an-object` fallback replaces the whole value, and that IS visible
   * here as an empty map.
   *
   * @param {*} input
   * @returns {Object}
   */
  function carried(input) {
    var out = {};

    Object.keys(known).forEach(function(key) {
      if (isPlainObject(input) &&
          canonical(input[key]) === canonical(known[key].value)) {
        out[key] = { name: known[key].name, via: known[key].via };
      }
    });

    return out;
  }

  function record(kind, applicable, input, reason, extra) {
    var visible = applicable ? serverVisible(transport, input) : null;
    var entry = {
      kind          : kind,
      applicable    : applicable,
      reason        : reason,
      transport     : transport,
      // Which keys of this case's input hold a value derived from the tree
      // rather than from the schema, and why each one had to.
      knownValues   : applicable ? carried(input) : {},
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
        // Empty for every case carrying exactly one violation. Non-empty only
        // where the primary violation had to stay put - a `language`-map
        // target - and a second field was added so the same case also
        // evidences the rendered message. Recorded so a second violation can
        // never be invisible.
        additionalViolations : rejecting.additionalViolations,
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
      // The reviewed reasoning wins when there is one, so the params target
      // carries the reason a reviewer wrote rather than only the derived one;
      // the derived reason stands behind it for anything new.
      reviewedReason(target.key, CASE_REJECTING) || rejecting.reason,
      {
        strategy         : null,
        field            : null,
        additionalViolations : [],
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
 * TRANSPORT passes, and is recorded as an explicit N/A with that fact: most
 * string-only sections admit no coercion input, and the single `params` target
 * admits no rejecting one. Those are answers.
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
    // The key of the validate block, under both names. `validateKey` says what
    // the value is - the hand-rolled block iterates `for (var key in
    // validation)` and validates `request[key]`, so this is a REQUEST KEY and
    // not one of hapi's four fixed sections - and `section` is kept beside it
    // because it is the name the sibling parity documentation and any earlier
    // reader of this artifact already look for. Both are compared.
    validateKey   : target.section,
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
 * The inert mapping is preserved rather than repaired, so a substitution is a
 * FAILURE here and not an improvement. assertInertness makes that explicit.
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
      // The map keys its message on the substring "regular expression", and
      // joi's pattern message does not contain it - which is what makes the map
      // inert.
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
 * message APPEARING is the failure: the maps are preserved as they are, so a
 * substitution is a behaviour change and not a repair.
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
 * ATTRIBUTES ARE THEMSELVES UNDER TEST in the corpus gate. A jar that silently
 * dropped a cookie for failing its own attribute check would turn a cookie
 * regression into a mysterious lost session.
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
 * A TIMEOUT IS A RESULT, not a throw: a route that never settles is a
 * recordable outcome of the tree under test, and a gate that hung on one would
 * produce no artifact at all. Redirects
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
    var requestOptions;
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

    requestOptions = {
      protocol : address.protocol,
      hostname : address.hostname,
      port     : address.port,
      path     : address.pathname + address.search,
      method   : options.method,
      headers  : headers
    };

    // The source address this drive is sent FROM, when the caller pins one.
    // Only `login` does; see `loginSourceAddress`.
    if (options.localAddress) {
      requestOptions.localAddress = options.localAddress;
    }

    request = transport.request(requestOptions, function(response) {
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
    // The top-level key list is a stable body signal. Full-body comparison
    // belongs to the request corpus in test/parity/{capture,replay}.js, which
    // carries the normalization a whole body needs; here the body is evidence
    // about the validation flash.
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
 * `{invitationId}` is the one value that does not come from the seeder, because
 * the seeder has no CourseInvitation group. It resolves to the document this
 * tool creates instead - see INVITATION_FIXTURE and applyPreconditions - which
 * is what lets the two `PUT /api/courses/{courseId}/invitations/{invitationId}/*`
 * targets reach their validation block at all. Before that document existed
 * both answered 404 from `invitation(params.invitationId)` for every case.
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
    // This tool's own fixture, in the `07` block the seeder does not use.
    invitationId : INVITATION_FIXTURE.id,
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
// Counts the logins this process has sent, so the source address below cycles
// deterministically. 127.0.<0-15>.<2-255> gives 4064 distinct addresses, which
// is more than any matrix drives.
var loginSequence = 0;
var LOGIN_SOURCE_ADDRESS_COUNT = 254 * 16;

/**
 * The loopback source address the next login is sent from.
 *
 * `lib/controllers/users.js` throttles `POST /login` per remote address -
 * `LOGIN_ADDRESS_LIMIT` attempts per quarter-hour bucket - and that counter is
 * deliberately NOT cleared by a successful login, because an address is not an
 * identity. This tool logs in FRESH for every authenticated drive (see the note
 * on `login` for why a shared session would corrupt the flash observation), and
 * a full matrix is several hundred drives, so a single source address exhausts
 * that allowance part-way through a run: measured, the application answered 100
 * logins and throttled the 101st, and every case after it would have recorded
 * an unauthenticated outcome - hundreds of differences produced by this
 * harness's own login pattern rather than by any validation behaviour.
 *
 * So each login is sent from its own address in 127.0.0.0/8, every one of which
 * is local on Linux, which spreads the counter instead of defeating it: the
 * throttle is left exactly as the application implements it and each bucket
 * sees a handful of attempts. Nothing else about the request changes - the
 * target host, the Host header and therefore the cookie jar are unaffected -
 * and the application keys nothing but this counter on the remote address, so
 * no recorded outcome moves. The rotation is index-based rather than random so
 * two runs of the same matrix send the same sequence.
 *
 * @returns {string} An address in 127.0.0.0/8, never 127.0.0.1 itself.
 */
function loginSourceAddress() {
  var offset = loginSequence % LOGIN_SOURCE_ADDRESS_COUNT;

  loginSequence++;

  return '127.0.' + Math.floor(offset / 254) + '.' + ((offset % 254) + 2);
}

async function login(origin, credentials) {
  var jar = new Jar();
  var body = querystring.stringify({
    email    : credentials.email,
    password : credentials.password
  });

  var response = await exchange(origin, {
    method       : 'POST',
    target       : '/login',
    accept       : ACCEPT_HEADER.html,
    jar          : jar,
    body         : body,
    contentType  : 'application/x-www-form-urlencoded',
    localAddress : loginSourceAddress()
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

  // For a rejecting case, whether the observed flash IS the flash that
  // re-executing the whole validation block on the values this drive presented
  // says it must be - keys AND messages, compared as one value. That is the
  // strongest available evidence that the block ran and produced exactly the
  // errors joi produced, and it is a real equality rather than a comparison
  // against one section of a multi-section route. See attachFlashProofs.
  //
  // Null for an accepting or a coercion case, where the equality would be
  // meaningless: those inputs are not built to make the target's own section
  // fail, so any flash they produce comes from a sibling section that the proof
  // legitimately carries and the block legitimately flashes. What is recorded
  // for them instead is `unexpectedFlashKeys` - anything the block's own
  // re-execution cannot account for.
  outcome.flashMatchesProof = null;
  outcome.unexpectedFlashKeys = null;

  // Whether the RESPONSE could carry the flash at all. On the `fail.redirect`
  // branch it cannot: the block flashes into the session and answers 302, and
  // the message reaches a client only on the next request - which is what the
  // flash-follow proof measures instead, over the pages whose templates render
  // it. Recorded as a fact so a null comparison is never read as an absent
  // measurement.
  outcome.flashProofComparable = !!(record.flashProof &&
    record.flashProof.modelled && outcome.validationFlash !== null);

  if (record.flashProof && record.flashProof.modelled) {
    if (record.kind === CASE_REJECTING) {
      outcome.flashMatchesProof = outcome.flashProofComparable
        ? canonical(outcome.validationFlash) ===
          canonical(record.flashProof.errors)
        : null;
    }
    else if (outcome.validationFlash !== null) {
      outcome.unexpectedFlashKeys = Object.keys(outcome.validationFlash)
        .filter(function(key) {
          return !Object.prototype.hasOwnProperty.call(
            record.flashProof.errors, key);
        }).sort();
    }
  }

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
 * The fixtures this gate needs that test/parity/seed.js does not own.
 *
 * One document today: the CourseInvitation two targets look up before their
 * validation block runs. It is written through the mongoose connection this
 * process already holds for the seeder, into the collection the model
 * registers, so the application under test finds it through its own model.
 *
 * UPSERTED, and re-applied after every restore and every restart, because the
 * handlers behind those two routes MUTATE it: `resendInvitation` moves `status`
 * and `updateInvitationEmail` rewrites `email`, so a drive that reaches the
 * handler changes the document the next drive depends on. The seeder's
 * `reset({scope:'collections'})` does not touch this collection - it is not one
 * of the eight the seeder owns - so the upsert restores the fields rather than
 * recreating a deleted document, which is exactly what makes it idempotent.
 *
 * The write is verified by reading the document back, because a silently
 * absent fixture would present later as two unreached targets and cost a
 * reader the same investigation twice.
 *
 * @param {Object} context The infrastructure context.
 * @returns {Promise<Object>} What was applied, for the artifact.
 * @throws {ToolError} If the document cannot be written or read back.
 */
async function applyPreconditions(context) {
  var model = context.invitationModel;
  var document = {
    _id      : new lazy.mongoose.Types.ObjectId(INVITATION_FIXTURE.id),
    courseId : new lazy.mongoose.Types.ObjectId(lazy.seed.ids.course),
    email    : INVITATION_FIXTURE.email,
    token    : INVITATION_FIXTURE.token,
    status   : INVITATION_FIXTURE.status
  };
  var written;

  try {
    await model.collection.replaceOne({ _id: document._id }, document,
      { upsert: true });
    written = await model.collection.findOne({ _id: document._id });
  }
  catch (err) {
    throw new ToolError('cannot write the CourseInvitation fixture ' +
      INVITATION_FIXTURE.id + ' that `invitation(params.invitationId)` looks ' +
      'up before the validation block of the two ' +
      '/api/courses/{courseId}/invitations/{invitationId}/* targets: ' +
      (err && err.message ? err.message : String(err)));
  }

  if (!written || written.status !== INVITATION_FIXTURE.status ||
      written.email !== INVITATION_FIXTURE.email) {
    throw new ToolError('the CourseInvitation fixture ' +
      INVITATION_FIXTURE.id + ' did not read back as written, so the two ' +
      '{invitationId} targets would answer 404 and record no joi evidence');
  }

  return {
    model      : INVITATION_MODEL,
    collection : model.collection.name,
    id         : INVITATION_FIXTURE.id,
    courseId   : lazy.seed.ids.course,
    email      : INVITATION_FIXTURE.email,
    status     : INVITATION_FIXTURE.status
  };
}

/**
 * Restores the seeded state, then this tool's own preconditions.
 *
 * WHY EVERY NON-GET DRIVE GETS ONE. An accepted payload on a mutating route is
 * SUPPOSED to change the database - that is what makes it an acceptance - and
 * the next drive then runs against a database the recorded baseline never
 * described. On the baseline tree that is fatal rather than merely untidy: the
 * html drive of `POST /api/folders` creates the folder `aaa`, the json drive
 * re-sends the same bytes, the unique `{_owner, slug}` index on the Folder
 * schema in lib/models/folder.js rejects the save, and `folders.create` in
 * lib/controllers/folders.js answers the duplicate-key error by calling
 * `request.catch(...)` on the hapi request - a TypeError inside a mongoose
 * callback, an unhandled 'error' event, and a DEAD APPLICATION. Several
 * routes fail the same way.
 *
 * A restore before each such drive makes every drive start from the state the
 * artifact documents, which is what lets `crashes.length === 0` be an assertion
 * rather than a hope, and what makes the two runs the same experiment even
 * though the second one runs against a converted controller.
 *
 * It is cheap enough to be unconditional: measured 2-3ms for the reset and
 * 240-320ms for the re-seed, against the 2.9s of the first seed, because the
 * seeder writes fixed ids into eight collections rather than rebuilding a
 * database. GET drives are not preceded by one - they run first and cannot
 * have mutated anything - so the cost lands on 386 of the 462 drives.
 *
 * @param {Object} context The infrastructure context, updated in place.
 * @returns {Promise<undefined>}
 * @throws {ToolError} If the state cannot be restored.
 */
async function restoreState(context) {
  try {
    await lazy.seed.reset({ scope: 'collections' });
    await lazy.seed.seed();
  }
  catch (err) {
    throw new ToolError('cannot restore the seeded state between drives: ' +
      (err && err.message ? err.message : String(err)));
  }

  await applyPreconditions(context);

  context.restores += 1;
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

  // The crashed process's stderr is kept alongside the new one's: it is the
  // stream most likely to carry something worth reading, and the warning gate
  // judges every stream this run produced rather than the last one standing.
  if (started.stderrPath &&
      context.stderrPaths.indexOf(started.stderrPath) === -1) {
    context.stderrPaths.push(started.stderrPath);
  }

  await lazy.seed.seed();
  await restoreState(context);
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
 * One application behaviour makes that sequence load-bearing rather than merely
 * tidy. `request.fail` ASSIGNS BACK onto the long-lived `fail` object when it
 * interpolates a redirect target, so on `POST /users`, `GET /activate-account`
 * and `POST /activate-account` the first rejection's target leaks into every
 * later one. That is preserved behaviour, and it makes those outcomes
 * order-dependent - identical on both trees only because the order is fixed
 * here and recorded per outcome.
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
 * @returns {Promise<{drives: number, timedOut: number, observed: number,
 *                    timeouts: Array.<Object>, crashes: Array.<Object>}>}
 */
async function driveAll(context, entries) {
  var plan = planDrives(entries);
  var crashes = [];
  var timeouts = [];
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

    // Before the drive, never after: the state the next drive needs is the
    // state the artifact describes. See restoreState and RESTORE_POLICY.
    if (step.entry.method !== 'GET') {
      await restoreState(context);
    }

    outcome = await driveTolerantly(step, index);
    step.record.http[step.mode] = outcome;
    previous = step;

    if (outcome.timedOut) {
      timedOut += 1;
      // Named, not just counted. buildTimeouts turns this into the artifact's
      // `timeouts` block, which the comparison diffs whole and assertEvidence
      // requires a reviewed reason for.
      timeouts.push({
        target: step.entry.key,
        case  : step.record.kind,
        mode  : step.mode
      });
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
    restores : context.restores,
    // Named, not counted. Each entry says which drive discovered the corpse
    // and which drive is the likely cause, both by target and case rather than
    // by run index, so the list is comparable between two trees.
    crashes  : crashes,
    // The drives that received no response at all, by target, case and mode.
    // buildTimeouts pairs each with its reviewed reason; assertEvidence fails
    // the run for any that has none.
    timeouts : timeouts
  };
}

// ---------------------------------------------------------------------------
// The whole-block proof - what the hand-rolled block will flash, per drive
// ---------------------------------------------------------------------------

// What the sections of a route see on a drive that is not theirs, and the label
// each state is recorded under.
//
// This is the model the proof rests on, and every entry of it is measured
// rather than assumed:
//   absent-body    A drive whose target is `query` or `params` sends NO body,
//                  and the block still validates `request.payload`. Measured:
//                  the flash carries the key '' with `"value" must be of type
//                  object`, which is what `Joi.object({...}).validate(null)`
//                  produces - so request.payload is NULL, not `{}` and not
//                  undefined.
//   empty-query    `request.query` is always an object; with no query string it
//                  is `{}`. Measured: a payload-target drive on a route that
//                  also declares `query` flashes only the keys its REQUIRED
//                  query leaves produce, which is what `{}` yields.
//   route-params   `request.params` is assembled by hapi from the segments the
//                  route declares, so it is the materialized path values.
//   file-descriptor With `payload.output: 'file'` hapi REPLACES request.payload
//                  with a descriptor. Measured on all four such routes: the
//                  flash is `{<upload field> is required, "path" is not
//                  allowed, "bytes" is not allowed}` whatever the body was, so
//                  the descriptor hapi builds here carries exactly `path` and
//                  `bytes`. The `path` VALUE is hapi's own temporary filename
//                  and cannot be reproduced - it is a per-request random name -
//                  so a stand-in of the same type is used; no message in the
//                  four sections depends on it, because `path` and `bytes` are
//                  unknown keys to all four schemas and an unknown-key message
//                  names the key and not the value.
var PRESENTED_ABSENT_BODY    = 'absent-body';
var PRESENTED_EMPTY_QUERY    = 'empty-query';
var PRESENTED_ROUTE_PARAMS   = 'route-params';
var PRESENTED_FILE_DESCRIPTOR = 'file-descriptor';
var PRESENTED_DRIVEN         = 'driven-input';

// The stand-in for hapi's `output: 'file'` payload descriptor. `bytes` is the
// real byte length of the body the drive sent, which is deterministic; `path`
// is a fixed stand-in for a value that cannot be, and is labelled as one.
var FILE_DESCRIPTOR_PATH = '/parity/hapi-output-file-descriptor';

/**
 * Every validate section of every route, compiled, in DECLARATION ORDER.
 *
 * The order is part of the model: the block runs `for (var key in validation)`
 * and assigns `validationErrors[fieldPath] = ...` per error detail, so when two
 * sections produce an error on the same path the LAST one wins. Object key
 * order in V8 is insertion order for string keys, and the pristine deep copy
 * preserves it, so iterating the copy reproduces the block's own sequence.
 *
 * `language` is excluded from the schemas and kept beside them, exactly as
 * lib/util/routeParser.js does it: `parseRoutes` executes
 * `delete(validation.language)` on the same object the handler closure later
 * iterates, and the handler's validation block reads the map separately as
 * `language[fieldPath]`.
 *
 * @param {Object} loaded The harvest result.
 * @returns {Object} 'METHOD path' -> {sections: [...], language: Object}
 */
function routeSections(loaded) {
  var out = {};

  loaded.pristine.forEach(function(declaration) {
    var validate;
    var info;
    var key;

    if (!declaration || typeof declaration.route !== 'string' ||
        !isPlainObject(declaration.config)) {
      return;
    }

    validate = declaration.config.validate;

    if (!isPlainObject(validate)) {
      return;
    }

    info = routeInfo(declaration);
    key  = info.method + ' ' + info.path;

    out[key] = {
      language : isPlainObject(validate[VALIDATE_LANGUAGE_KEY])
        ? validate[VALIDATE_LANGUAGE_KEY]
        : {},
      sections : Object.keys(validate)
        .filter(function(section) {
          return section !== VALIDATE_LANGUAGE_KEY;
        })
        .map(function(section) {
          return {
            section : section,
            schema  : compileSection(loaded.joi, {
              section      : section,
              key          : key + ' ' + section,
              schemaSource : validate[section]
            }),
            // Kept so the proof can say whether a section is one this tool
            // models a presented value for.
            output  : declaration.config.payload &&
                      declaration.config.payload.output
              ? String(declaration.config.payload.output)
              : null
          };
        })
    };
  });

  return out;
}

/**
 * What each of a route's sections holds on one particular drive.
 *
 * @param {Object} entry The serialized target being driven.
 * @param {Object} record The case being driven.
 * @param {Object} section One entry of routeSections()[route].sections.
 * @param {Object} values From pathValues.
 * @returns {{value: *, source: string, modelled: boolean}}
 */
function presentedValue(entry, record, section, values) {
  var visible = record.serverVisible === null || record.serverVisible === undefined
    ? record.input
    : record.serverVisible;
  var addressed;

  if (section.section === entry.section) {
    if (section.output === 'file') {
      return {
        value : {
          path  : FILE_DESCRIPTOR_PATH,
          bytes : Buffer.byteLength(requestBody(entry, visible).body || '',
            'utf8')
        },
        source   : PRESENTED_FILE_DESCRIPTOR,
        modelled : true
      };
    }

    return { value: visible, source: PRESENTED_DRIVEN, modelled: true };
  }

  if (section.section === 'payload') {
    // No body is sent for a query or params target, and `output: 'file'` never
    // produces a descriptor from a request that carries no body.
    return { value: null, source: PRESENTED_ABSENT_BODY, modelled: true };
  }

  if (section.section === 'query') {
    return { value: {}, source: PRESENTED_EMPTY_QUERY, modelled: true };
  }

  if (section.section === 'params') {
    addressed = requestTarget(entry, visible, values);

    return {
      value    : addressed.substituted,
      source   : PRESENTED_ROUTE_PARAMS,
      modelled : true
    };
  }

  // The block validates request[key] for ARBITRARY keys, so a section this
  // tool has no model for is reported as unmodelled rather than guessed at -
  // and the proof for that route is then not asserted, with the reason
  // recorded per case.
  return { value: null, source: 'unmodelled', modelled: false };
}

/**
 * Attaches the whole-block flash proof to every applicable case.
 *
 * WHY THE PROOF IS WHOLE-BLOCK. The hand-rolled block in
 * lib/util/routeParser.js does not validate the target's section - it validates
 * EVERY section the route declares, keying each error by `err.path.join('.')`.
 * So driving a `query` target on a route that also declares `payload` produces
 * an extra flash key: the empty string, from the sibling section's `"value"
 * must be of type object` on a null body. A proof of the TARGET section alone
 * would therefore report a mismatch on every multi-section route, which would
 * be a defect in the comparator and not a finding about the application.
 *
 * The proof reproduces the block exactly: each section is validated against the
 * value that section actually holds on this drive, the details are folded into
 * one `path -> message` map in declaration order so a later section overwrites
 * an earlier one on the same path, and the `language` lookup is applied per
 * field through the same emulation PHASE 5 asserts the inertness of. The
 * result is a `flashProof` a reviewer can read beside the observed flash, and
 * `flashMatchesProof` becomes an EQUALITY OF KEYS AND MESSAGES rather than of
 * keys alone.
 *
 * Computed in every mode, `--schema-only` included: it is derived from the
 * inputs and the declarations, so it must be identical on both sides of the
 * gate and is compared per case.
 *
 * @param {Array.<Object>} entries Serialized target entries, modified in place.
 * @param {Object} loaded The harvest result.
 * @param {Object} values From pathValues.
 * @returns {undefined}
 */
function attachFlashProofs(entries, loaded, values) {
  var sections = routeSections(loaded);

  entries.forEach(function(entry) {
    var route = sections[entry.method + ' ' + entry.path];

    entry.cases.forEach(function(record) {
      var errors = {};
      var perSection = [];
      var modelled = true;

      if (!record.applicable) {
        record.flashProof = null;
        return;
      }

      if (!route) {
        record.flashProof = {
          modelled : false,
          reason   : 'the pre-parse copy carries no validate block for this ' +
            'route, which cannot happen for a target enumerated from it',
          sections : [],
          errors   : {},
          keys     : []
        };
        return;
      }

      route.sections.forEach(function(section) {
        var presented = presentedValue(entry, record, section, values);
        var outcome;
        var index;

        if (!presented.modelled) {
          modelled = false;
        }

        outcome = validateLocally(section.schema, presented.value);

        for (index = 0; index < outcome.paths.length; index++) {
          errors[outcome.paths[index]] =
            substituteCustomMessage(route.language[outcome.paths[index]],
              outcome.messages[index]) || outcome.messages[index];
        }

        perSection.push({
          section  : section.section,
          source   : presented.source,
          presented: jsonSafe(presented.value),
          accepted : outcome.accepted,
          paths    : outcome.paths,
          messages : outcome.messages
        });
      });

      record.flashProof = {
        modelled : modelled,
        reason   : modelled
          ? null
          : 'one of this route\'s validate sections is not payload, query or ' +
            'params, so this tool has no model for what it holds on a drive; ' +
            'the flash comparison is not asserted for this case',
        sections : perSection,
        // The `validationErrors` object the block will have built, and
        // therefore the flash it will have set, if it flashes at all.
        errors   : errors,
        keys     : Object.keys(errors).sort()
      };
    });
  });
}

/**
 * The flash-proof outcome of the whole run.
 *
 * Two figures, and they mean different things:
 *   * a MISMATCH is a rejecting drive whose observed flash is not what the
 *     block's own re-execution says it must be. That is either a defect in this
 *     tool's model of what each section holds, or the application flashing
 *     something else - and both must be looked at, so it is fatal.
 *   * an UNEXPECTED FLASH is an accepting or coercion drive that produced a
 *     validation flash carrying a key the proof does not explain. Comparing
 *     equality there would be meaningless - the proof for a multi-section route
 *     legitimately carries the sibling section's error, and the application
 *     legitimately flashes it - so what is checked instead is that nothing
 *     APPEARED that the block cannot account for.
 *
 * @param {Array.<Object>} entries Serialized target entries.
 * @returns {{mismatches: number, unexpected: number,
 *            compared: number, unmodelled: number,
 *            mismatchDetail: Array.<Object>,
 *            unexpectedDetail: Array.<Object>}}
 */
function summarizeFlashProofs(entries) {
  var mismatchDetail = [];
  var unexpectedDetail = [];
  var compared = 0;
  var notComparable = 0;
  var unmodelled = 0;

  entries.forEach(function(entry) {
    entry.cases.forEach(function(record) {
      if (!record.applicable || !record.http || !record.flashProof) {
        return;
      }

      if (!record.flashProof.modelled) {
        unmodelled += 1;
        return;
      }

      MODES.forEach(function(mode) {
        var outcome = record.http[mode];

        if (!outcome) {
          return;
        }

        if (record.kind === CASE_REJECTING) {
          if (outcome.flashMatchesProof === null) {
            // Not comparable: the flash went into the session and the response
            // is the fail.redirect 302. Counted where it belongs, in the
            // flash-follow proof.
            notComparable += 1;
            return;
          }

          compared += 1;

          if (outcome.flashMatchesProof === false) {
            mismatchDetail.push({
              target   : entry.key,
              case     : record.kind,
              mode     : mode,
              status   : outcome.status,
              observed : outcome.validationFlash,
              proof    : record.flashProof.errors
            });
          }

          return;
        }

        if (outcome.unexpectedFlashKeys &&
            outcome.unexpectedFlashKeys.length) {
          unexpectedDetail.push({
            target      : entry.key,
            case        : record.kind,
            mode        : mode,
            status      : outcome.status,
            unexpected  : outcome.unexpectedFlashKeys,
            observed    : outcome.validationFlash,
            proof       : record.flashProof.errors
          });
        }
      });
    });
  });

  return {
    compared         : compared,
    notComparable    : notComparable,
    unmodelled       : unmodelled,
    mismatches       : mismatchDetail.length,
    unexpected       : unexpectedDetail.length,
    mismatchDetail   : mismatchDetail,
    unexpectedDetail : unexpectedDetail
  };
}

/**
 * Asserts the whole-block proof over every driven rejecting case.
 *
 * A mismatch here is FATAL rather than a recorded field that fails nothing,
 * because a recorded field that fails nothing is one nobody reads. The observed
 * flash and the proof are printed side by side, so a reader does not have to
 * re-derive either.
 *
 * @param {Array.<Object>} entries Serialized target entries.
 * @returns {undefined}
 * @throws {ParityError} On any mismatch or unexplained flash.
 */
function assertFlashProofs(entries) {
  var summary = summarizeFlashProofs(entries);
  var failures = [];

  if (summary.mismatches) {
    failures.push(summary.mismatches + ' rejecting drive(s) flashed ' +
      'something other than what re-executing the whole validation block on ' +
      'the values that drive presented says they must:\n  - ' +
      summary.mismatchDetail.map(function(entry) {
        return entry.target + ' ' + entry.case + ' [' + entry.mode + '] ' +
          'status ' + entry.status + '\n      observed ' +
          canonical(entry.observed) + '\n      proof    ' +
          canonical(entry.proof);
      }).join('\n  - '));
  }

  if (summary.unexpected) {
    failures.push(summary.unexpected + ' accepting or coercion drive(s) ' +
      'produced a validation flash key the block\'s own re-execution does ' +
      'not account for:\n  - ' +
      summary.unexpectedDetail.map(function(entry) {
        return entry.target + ' ' + entry.case + ' [' + entry.mode + '] ' +
          'status ' + entry.status + ' unexplained ' +
          canonical(entry.unexpected) + '\n      observed ' +
          canonical(entry.observed) + '\n      proof    ' +
          canonical(entry.proof);
      }).join('\n  - '));
  }

  if (failures.length) {
    throw new ParityError(failures.join('\n\n'));
  }
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
        return descriptor.method || descriptor.helper || descriptor.kind;
      }),
      knownValues : Object.keys(record.knownValues || {}).sort(),
      unseeded : record.http[MODE_JSON]
        ? record.http[MODE_JSON].unseededParams
        : [],
      // The review that accepted this target as unreachable, or null - which
      // is what the assertion turns on. See REVIEWED_UNREACHED.
      reviewed : reviewedUnreachedReason(entry.key)
    });
  });

  return {
    rejectingCases : reached.length + unreached.length,
    reached        : reached.length,
    unreached      : unreached.length,
    // The figure the assertion is about: an unreached target whose reason is
    // NOT reviewed. `unreached` alone cannot be that figure, because one target
    // is unreachable for a measured reason in the application under test and
    // failing every run over it would leave the gate permanently red without
    // saying anything new.
    unresolved     : unreached.filter(function(entry) {
      return !entry.reviewed;
    }).length,
    // Named, not counted: each of these is a target whose joi evidence rests
    // on the local schema proof alone, and a reader is entitled to know which.
    unreachedDetail: unreached
  };
}

/**
 * Runs every assertion and returns one error describing all the failures.
 *
 * A gate that stopped at the first failed assertion would make a reader re-run
 * it once per finding, and each run of this one takes minutes and a database.
 * So each assertion is run in turn, its ParityError is collected rather than
 * propagated, and the assertions are joined into a single ParityError - which
 * keeps the exit code and the caller's deferred-raise contract exactly as they
 * were.
 *
 * A ToolError is NOT collected: it means the tool could not produce a
 * trustworthy artifact, which is a different exit code and a different
 * conversation, so it propagates immediately.
 *
 * @param {Array.<function(): undefined>} assertions
 * @returns {(ParityError|null)}
 * @throws {ToolError} Straight through, from any assertion that raises one.
 */
function collectAssertions(assertions) {
  var failures = [];

  assertions.forEach(function(assertion) {
    try {
      assertion();
    }
    catch (err) {
      if (err instanceof ParityError) {
        failures.push(err.message);
        return;
      }

      throw err;
    }
  });

  if (!failures.length) {
    return null;
  }

  if (failures.length === 1) {
    return new ParityError(failures[0]);
  }

  return new ParityError(failures.length + ' behavioural assertion(s) ' +
    'failed.\n\n' + failures.map(function(message, index) {
      return '[' + (index + 1) + '/' + failures.length + '] ' + message;
    }).join('\n\n'));
}

/**
 * The reviewed reason a target cannot reach its validation block, or null.
 *
 * @param {string} targetKey
 * @returns {(string|null)}
 */
function reviewedUnreachedReason(targetKey) {
  var match = REVIEWED_UNREACHED.filter(function(entry) {
    return entry.target === targetKey;
  })[0];

  return match ? match.reason : null;
}

/**
 * The reviewed reason a drive receives no response at all, or null.
 *
 * Matched on the target and, when the entry names one, on the case kind: the
 * two `POST /api/users/email` drives that never answer are its ACCEPTING case,
 * and its rejecting case answers 200 from the validation block. An entry with a
 * null `case` covers every kind of that target.
 *
 * @param {string} targetKey
 * @param {string} kind One of CASE_KINDS.
 * @returns {(string|null)}
 */
function reviewedTimeoutReason(targetKey, kind) {
  var match = REVIEWED_TIMEOUTS.filter(function(entry) {
    return entry.target === targetKey &&
      (entry.case === null || entry.case === undefined || entry.case === kind);
  })[0];

  return match ? match.reason : null;
}

/**
 * The run's non-answering drives, each with its reviewed reason.
 *
 * Built from the drive list rather than from a counter, because the ASSERTION
 * needs to know WHICH drive timed out and the comparison needs a list it can
 * diff: two trees that both record one timeout, on different routes, have not
 * behaved the same way and a shared count would hide it.
 *
 * @param {Array.<Object>} timeouts From driveAll - {target, case, mode}.
 * @returns {{budgetMs: number, count: number, drives: Array.<Object>,
 *            unresolved: Array.<Object>}}
 */
function buildTimeouts(timeouts) {
  var drives = (timeouts || []).map(function(entry) {
    var reason = reviewedTimeoutReason(entry.target, entry.case);

    return {
      target   : entry.target,
      case     : entry.case,
      mode     : entry.mode,
      reviewed : reason
    };
  });

  return {
    budgetMs   : REQUEST_TIMEOUT_MS,
    count      : drives.length,
    drives     : drives,
    // Named separately so the assertion and the artifact agree about which
    // timeouts are accounted for, in the same shape validationReach uses for
    // its unreached targets.
    unresolved : drives.filter(function(entry) {
      return !entry.reviewed;
    }).map(function(entry) {
      return entry.target + ' ' + entry.case + ' [' + entry.mode + ']';
    })
  };
}

/**
 * Asserts that the run produced evidence rather than casualties.
 *
 * Three conditions, and every one of them was a reported figure before it was
 * an assertion - which is exactly the defect: an artifact recording seven
 * application crashes, seven targets that never reached validation and a bare
 * `drivesTimedOut` count was being offered as parity proof for those targets.
 *
 *   * NO CRASH. A tree that dies mid-run answers `socket hang up` to whichever
 *     drive discovers it, and every outcome after it is measured against a
 *     freshly restarted process. The restart machinery stays - a gate that
 *     died with the tree could capture nothing at all, and a tree that crashes
 *     is worth REPORTING - but a crash now fails the run instead of being
 *     absorbed into a count.
 *   * NO UNRESOLVED UNREACHED TARGET. A rejecting case that never reaches the
 *     block contributes no joi evidence, so it may not be counted as covered.
 *     A target whose blocker is measured, named in REVIEWED_UNREACHED and
 *     outside anything this tool can choose is reported instead of failing the
 *     run; anything else fails it, with the pre-handlers and statuses that
 *     stopped it.
 *   * NO UNREVIEWED TIMEOUT. A drive that received no response within the
 *     budget recorded no status, no header and no flash, so it evidences
 *     nothing about validation on either side. A route measured never to
 *     answer - `POST /api/users/email`, whose handler resolves only from a
 *     callback an arity-2 `Store.set` discards - is named in REVIEWED_TIMEOUTS
 *     with the code that does it and is REPORTED; any other timeout fails the
 *     run, so a new non-answering route cannot arrive silently as a larger
 *     count. The timeout LIST is compared between the two trees as well, so a
 *     timeout that moves to a different route is a difference rather than an
 *     equal count.
 *
 * Raised as a ParityError, and deferred by the caller like the other two
 * behavioural assertions, so the artifact that evidences the failure is on disk
 * before it is thrown.
 *
 * @param {Object} drives From driveAll.
 * @param {Object} reach From buildValidationReach.
 * @param {Object} timeouts From buildTimeouts.
 * @returns {undefined}
 * @throws {ParityError}
 */
function assertEvidence(drives, reach, timeouts) {
  var unresolved;

  if (drives.crashes.length) {
    throw new ParityError('the application under test crashed ' +
      drives.crashes.length + ' time(s) during the run, so every outcome ' +
      'after each crash was measured against a restarted process and the ' +
      'drive that armed it recorded a transport error rather than a ' +
      'response. A matrix captured through a crash is not parity evidence. ' +
      'Crashes, by the drive that discovered them:\n  - ' +
      drives.crashes.map(function(crash) {
        return crash.detectedAt.target + ' ' + crash.detectedAt.case + ' [' +
          crash.detectedAt.mode + '], after ' + (crash.afterDrive
            ? crash.afterDrive.target + ' ' + crash.afterDrive.case + ' [' +
              crash.afterDrive.mode + ']'
            : 'no previous drive');
      }).join('\n  - '));
  }

  unresolved = reach.unreachedDetail.filter(function(entry) {
    return !entry.reviewed;
  });

  if (unresolved.length) {
    throw new ParityError(unresolved.length + ' rejecting case(s) never ' +
      'reached the validation block and have no reviewed reason, so their ' +
      'joi evidence is the local schema proof alone and the matrix may not ' +
      'present them as accept/reject parity. Repair the input, the fixture or ' +
      'the identity, or - if no request can reach the block - add the ' +
      'measured reason to REVIEWED_UNREACHED as a reviewable diff:\n  - ' +
      unresolved.map(function(entry) {
        return entry.target + ' (' + entry.strategy + ' on ' + entry.field +
          '; ' + entry.statuses.join(', ') + '; pre ' +
          (entry.pre.join(' -> ') || 'none') + ')';
      }).join('\n  - '));
  }

  if (timeouts && timeouts.unresolved.length) {
    throw new ParityError(timeouts.unresolved.length + ' drive(s) received no ' +
      'response within ' + timeouts.budgetMs + 'ms and have no reviewed ' +
      'reason. A drive that never answered recorded no status, no header and ' +
      'no validation flash, so it evidences nothing about either side of this ' +
      'gate and may not be presented as one of its outcomes. Find what the ' +
      'route waits for - the measured case is a handler that resolves only ' +
      'from a callback its callee never invokes - and either drive an input ' +
      'that reaches an answering branch or add the measured reason to ' +
      'REVIEWED_TIMEOUTS as a reviewable diff:\n  - ' +
      timeouts.unresolved.join('\n  - '));
  }
}

// Where the templates live, relative to the tree under test. The declared
// value, not a guess: config/default.yaml's `app.templates`. Read as a constant
// rather than off `config` because the flash-follow oracle must resolve the
// same files on both trees whatever a caller's overlay says about anything
// else, and neither tree's committed configuration moves it.
var TEMPLATE_ROOT = 'lib/views';

// How deep the template chain is followed. `{% extends %}` and `{% include %}`
// nest two or three levels here; the bound exists so a cyclic pair reports
// rather than spins.
var TEMPLATE_DEPTH = 6;

/**
 * Every `flash.validation.<field>` a template chain RENDERS, by field.
 *
 * "Renders" is the operative word, and it is why the scan is not a grep. The
 * reference must be in markup the server emits: `users/includes/profile.html`
 * carries `result.flash.validation.username` INSIDE A `<script>` BLOCK, where
 * it is a client-side read of an AJAX response and no server-rendered page ever
 * shows it. Script blocks are therefore stripped before the scan.
 *
 * The chain is followed through `{% extends %}` and `{% include %}` because
 * that is how nunjucks composes these pages: the field may be declared in an
 * included partial rather than in the template the route names.
 *
 * @param {string} appRoot Absolute path.
 * @param {string} template A template path relative to TEMPLATE_ROOT.
 * @returns {{fields: string[], files: string[], missing: string[]}}
 */
function renderedValidationFields(appRoot, template) {
  var pending = [String(template)];
  var seen = {};
  var files = [];
  var missing = [];
  var fields = {};
  var depth = 0;

  while (pending.length && depth < TEMPLATE_DEPTH) {
    pending = pending.reduce(function(next, name) {
      var absolute = path.resolve(appRoot, TEMPLATE_ROOT, name);
      var source;
      var stripped;
      var pattern;
      var match;

      if (seen[name]) {
        return next;
      }

      seen[name] = true;

      try {
        source = fs.readFileSync(absolute, 'utf8');
      }
      catch (err) {
        missing.push(name);
        return next;
      }

      files.push(name);

      // A reference inside a <script> block is a client-side read of an AJAX
      // response, not markup the server emits, so it is not a render.
      stripped = source.replace(/<script[\s\S]*?<\/script>/gi, '');

      pattern = /flash\.validation\.([A-Za-z0-9_$]+)/g;

      while ((match = pattern.exec(stripped)) !== null) {
        fields[match[1]] = true;
      }

      pattern = /\{%\s*(?:extends|include)\s+["']([^"']+)["']/g;

      while ((match = pattern.exec(source)) !== null) {
        next.push(match[1]);
      }

      return next;
    }, []);

    depth += 1;
  }

  return {
    fields  : Object.keys(fields).sort(),
    files   : files.sort(),
    missing : missing.sort()
  };
}

/**
 * The fields the page a target's `fail.redirect` leads to actually RENDERS,
 * and the value that has to be in the input for it to lead there.
 *
 * Used to STEER the rejecting ladder, not to judge it. The flash-follow oracle
 * below decides applicability from what a case turned out to flash, and two
 * consequences of that are worth steering around rather than merely recording:
 *
 *   * A target can declare a `fail.redirect` to a page that renders
 *     `flash.validation.name` while the ladder violates a different leaf, so
 *     the proof that the message reaches the client is lost to an accident of
 *     leaf ordering. `fields` fixes that.
 *   * A target can declare an INTERPOLATED redirect - `POST /users` declares
 *     `/{formName}` - whose destination is chosen by a field of its own
 *     payload. Excluding every interpolated redirect outright would throw away
 *     a reachable render: `formName` is `Joi.string().required()`,
 *     `GET /signup` declares `signup.html`, and that template renders
 *     `flash.validation.email` and `.password`. `plant` handles it by solving
 *     the redirect template against the literal GET routes and naming the value
 *     the input must carry.
 *
 * The destination is resolved by SOLVING the declared template rather than by
 * guessing: each literal GET route path is matched against the template with
 * its placeholders turned into capture groups, so the value is derived from the
 * tree's own routes and is admissible for the leaf that carries it. Only a
 * single-placeholder template is solved, and only when the placeholder is a
 * leaf of THIS target's section - otherwise the value could not be planted in
 * the input at all.
 *
 * One exclusion remains, and it is not about interpolation: a target carrying a
 * `language` map keeps the violation PHASE 5 measures its inertness on, so its
 * mapped leaf is never steered away from. Such a target instead receives the
 * rendered field as an ADDITIONAL violation - see buildRejectingInput's
 * `additional` - which is what lets `POST /users` prove the inert username
 * message AND the rendered email message in one case.
 *
 * @param {Object} target A target record.
 * @param {Array.<Object>} matchers From getRouteMatchers.
 * @param {string} appRoot Absolute path.
 * @param {string[]} leafKeys The keys of this target's section, so a planted
 *   value is only ever proposed for a field the input actually has.
 * @returns {{fields: string[], plant: (Object|null), destination: (string|null),
 *            template: (string|null)}} `fields` is empty when nothing can be
 *   steered; `plant` is `{key, value}` when the destination needs a value in
 *   the input, and null when the redirect is already literal.
 */
function renderedRedirectFields(target, matchers, appRoot, leafKeys) {
  var declared = target.fail && typeof target.fail.redirect === 'string'
    ? target.fail.redirect
    : null;
  var none = { fields: [], plant: null, destination: null, template: null };
  var placeholders;
  var leaves = {};
  var resolved;
  var solved = null;
  var i;

  if (!declared) {
    return none;
  }

  (leafKeys || []).forEach(function(key) {
    leaves[key] = true;
  });

  placeholders = declared.match(/\{[^}]+\}/g) || [];

  if (!placeholders.length) {
    resolved = declared.charAt(0) === '/' ? declared : '/' + declared;

    return rendersFor(resolved, null);
  }

  if (placeholders.length !== 1) {
    // Two placeholders would need two admissible values solved together, and
    // no declaration in this repository has one. Reported as unsteerable
    // rather than guessed at.
    return none;
  }

  // Every destination the template can name, in the route table's own order.
  // The FIRST whose template renders a `flash.validation` field wins; a
  // candidate that renders nothing is passed over rather than ending the
  // search. Stopping at the first MATCH instead would reach
  // `/glowscript-blocks`, whose page renders no flash, and report a steerable
  // target as unsteerable.
  solved = solveRedirect(declared, placeholders[0], matchers);

  for (i = 0; i < solved.length; i++) {
    if (!leaves[solved[i].key]) {
      // The placeholder is not a field of THIS target's section, so no value
      // could be planted in the input. True for every candidate or none.
      return none;
    }

    resolved = rendersFor(solved[i].path,
      { key: solved[i].key, value: solved[i].value });

    if (resolved.fields.length) {
      return resolved;
    }
  }

  return none;

  /**
   * The rendered fields of whatever GET route serves a path.
   *
   * @param {string} path_ The candidate destination, matched against the
   *   literal GET route patterns.
   * @param {(Object|null)} plant The `{key, value}` the input must carry for
   *   the redirect to resolve to `path_`, or null when the template has no
   *   placeholder.
   * @returns {Object} A steering record, or `none` when nothing renders.
   */
  function rendersFor(path_, plant) {
    var route = matchers.filter(function(matcher) {
      return matcher.pattern.test(path_);
    })[0];
    var scan;

    if (!route || !route.html) {
      return none;
    }

    scan = renderedValidationFields(appRoot, route.html);

    return scan.fields.length
      ? {
        fields     : scan.fields,
        plant      : plant,
        destination: path_,
        template   : route.html
      }
      : none;
  }
}

/**
 * Every destination an interpolated redirect template can name, solved against
 * the LITERAL GET routes.
 *
 * `/{formName}` yields `formName = 'glowscript-blocks'` for
 * `/glowscript-blocks`, `'signup'` for `/signup`, and so on for every literal
 * one-segment GET route the tree declares. The caller picks the first whose
 * template renders a `flash.validation` field, so the choice is a property of
 * the tree's own route table and its own templates rather than of this
 * function - and the ORDER is the route table's, which getRouteMatchers has
 * already sorted deterministically.
 *
 * Only PARAMETERLESS routes are solved. A parameterized one would match the
 * template with a value that is itself a placeholder, and the page it serves
 * renders whatever that parameter resolves to rather than a fixed template.
 *
 * @param {string} declared The redirect template.
 * @param {string} placeholder The single `{...}` fragment.
 * @param {Array.<Object>} matchers From getRouteMatchers.
 * @returns {Array.<{key: string, value: string, path: string}>} Possibly empty,
 *   in route-table order.
 */
function solveRedirect(declared, placeholder, matchers) {
  var key = placeholder.slice(1, -1).replace(/[*?]$/, '').replace(/\*\d+$/, '');
  var template = declared.charAt(0) === '/' ? declared : '/' + declared;
  var pattern = new RegExp('^' + template.split(placeholder).map(function(part) {
    return part.replace(/[.*+?^${}()|[\]\\]/g, function(char) {
      return '\\' + char;
    });
  }).join('([^/]+)') + '$');
  var found = [];

  matchers.forEach(function(matcher) {
    var match;

    if (matcher.params !== 0 || !matcher.html) {
      return;
    }

    match = pattern.exec(matcher.path);

    if (!match || !match[1]) {
      return;
    }

    found.push({ key: key, value: match[1], path: matcher.path });
  });

  return found;
}

/**
 * The GET declarations, as matchers, so a redirect target can be resolved to
 * the route that will serve it.
 *
 * A redirect sends the client to a PATH, and which template renders the flash
 * is a property of the route that answers a GET for that path - which may be a
 * parameterized one. That distinction decided a real determination: an
 * unsteered `POST /users` rejection interpolates `/{formName}` from its own
 * payload filler to `/aaa`, which `GET /{userSlug}` serves, and the profile
 * page references `flash.validation.username` only inside a script block - so
 * that case rendered nothing. renderedRedirectFields now solves the same
 * template against the LITERAL GET routes instead and plants `signup`, so the
 * failure follows to `/signup`, whose template renders `flash.validation` for
 * `email` and `password`. The matcher table is what makes both the old
 * determination and the new destination facts about the route table rather
 * than guesses.
 *
 * Specificity is resolved the way a router resolves it: fewer parameters first,
 * then the longer literal prefix, so a literal `/courses/new` wins over
 * `/courses/{courseId}`.
 *
 * @param {Object} loaded The harvest result.
 * @returns {Array.<{path: string, pattern: RegExp, html: (string|null),
 *                   params: number, literal: number}>}
 */
function getRouteMatchers(loaded) {
  var matchers = [];

  loaded.pristine.forEach(function(declaration) {
    var info;
    var params = 0;
    var source;

    if (!declaration || typeof declaration.route !== 'string') {
      return;
    }

    info = routeInfo(declaration);

    if (info.method !== 'GET') {
      return;
    }

    source = '^' + info.path.replace(/[.*+?^${}()|[\]\\]/g, function(char) {
      return '\\' + char;
    }).replace(/\\\{[^}]+\\\}/g, function(all) {
      params += 1;

      // `{x*}` is a multi-segment wildcard; `{x?}` is optional; anything else
      // is exactly one segment.
      if (/\\\*\\\}$/.test(all)) {
        return '.*';
      }

      if (/\?\\\}$/.test(all)) {
        return '[^/]*';
      }

      return '[^/]+';
    }) + '$';

    matchers.push({
      path    : info.path,
      pattern : new RegExp(source),
      html    : typeof declaration.html === 'string' ? declaration.html : null,
      params  : params,
      literal : info.path.replace(/\{[^}]+\}/g, '').length
    });
  });

  return matchers.sort(function(a, b) {
    if (a.params !== b.params) {
      return a.params - b.params;
    }

    return b.literal - a.literal;
  });
}

/**
 * The rendered-validation evidence for the whole run, and the applicable set it
 * is asserted over.
 *
 * THE APPLICABLE SET IS DERIVED FROM THE DECLARATIONS AND THE TEMPLATES, never
 * from what the run happened to render. A rejecting case is APPLICABLE when all
 * four of these hold, and each one is a fact about the tree rather than about
 * the response:
 *   1. its target declares a `fail.redirect`, which is what makes the message
 *      session-held and the follow necessary at all;
 *   2. that redirect template resolves to a concrete path with the values the
 *      case itself carries - `/{formName}` interpolates from the payload, so a
 *      case that carries no `formName` is sent to a path no route declares;
 *   3. a GET route declares that path, and names a template;
 *   4. that template's chain renders `flash.validation.<f>` outside a script
 *      block for at least one field `f` the whole-block proof says this case
 *      will flash.
 *
 * Condition 4 is why this is field-aware, and why the ladder is STEERED rather
 * than left to leaf order. `courses/create.html` renders
 * `flash.validation.name` and `.description` but not `.courseType`, and
 * `signup.html` renders `.email` and `.password` but not `.username` - so a
 * case that violated the field the page does not render would legitimately
 * follow to a page rendering NOTHING, and asserting otherwise would fail the
 * run over preserved baseline behaviour. Both are instead steered into the
 * applicable set, by renderedRedirectFields: `POST /courses` violates `name`
 * outright, and `POST /users` - whose primary violation must stay on
 * `username`, because PHASE 5 measures the inert message on it - violates
 * `email` and `password` BESIDE it and plants the `formName` its interpolated
 * redirect needs.
 *
 * Recording all four conditions per candidate is what makes the applicable set
 * a MEASUREMENT rather than an excuse: every fail.redirect candidate in the run
 * carries its determination, whether it turned out applicable or not.
 *
 * @param {Array.<Object>} entries Serialized target entries.
 * @param {Object} loaded The harvest result.
 * @param {string} appRoot Absolute path.
 * @returns {Object} The flashFollow record.
 */
function buildFlashFollow(entries, loaded, appRoot) {
  var matchers = getRouteMatchers(loaded);
  var templates = {};
  var candidates = [];
  var examples = [];
  var unrendered = [];
  var rendered = 0;
  var applicable = 0;

  function fieldsOf(template) {
    if (templates[template] === undefined) {
      templates[template] = renderedValidationFields(appRoot, template);
    }

    return templates[template];
  }

  entries.forEach(function(entry) {
    entry.cases.forEach(function(record) {
      var proofKeys;
      var resolvedPath;
      var materialized;
      var route;
      var scan;
      var fields;
      var expected;
      var messages;
      var candidate;

      if (record.kind !== CASE_REJECTING || !record.applicable ||
          !record.http || !entry.fail || !entry.fail.redirect) {
        return;
      }

      // MODE_HTML only: `responseType` is what selects the redirect branch of
      // request.fail, and the json branch carries the flash in the body, where
      // the whole-block proof compares it exactly.
      if (!record.http[MODE_HTML]) {
        return;
      }

      proofKeys = record.flashProof && record.flashProof.modelled
        ? record.flashProof.keys
        : [];
      materialized = materializePath(entry.fail.redirect, {},
        isPlainObject(record.input) ? record.input : {});
      resolvedPath = materialized.path.charAt(0) === '/'
        ? materialized.path
        : '/' + materialized.path;

      candidate = {
        target       : entry.key,
        declared     : entry.fail.redirect,
        resolvedPath : resolvedPath,
        // A redirect template whose value the case does not carry: the client
        // is sent somewhere no route declares, so no template can render the
        // message. Named rather than silently excluded.
        interpolated : materialized.unseeded.length === 0,
        unseeded     : materialized.unseeded,
        servedBy     : null,
        template     : null,
        rendersFields: [],
        proofKeys    : proofKeys,
        applicable   : false,
        reason       : null,
        status       : record.http[MODE_HTML].status,
        location     : record.http[MODE_HTML].locationRelative,
        expected     : [],
        observed     : []
      };

      route = materialized.unseeded.length
        ? null
        : matchers.filter(function(matcher) {
          return matcher.pattern.test(resolvedPath);
        })[0];

      if (!candidate.interpolated) {
        candidate.reason = 'the declared redirect `' + entry.fail.redirect +
          '` interpolates ' + materialized.unseeded.join(', ') +
          ', which this case\'s input does not carry, so the client is sent ' +
          'to a path no route declares and no template can render the message';
      }
      else if (!route) {
        candidate.reason = 'no GET route declares `' + resolvedPath + '`, so ' +
          'the followed request cannot render a template at all';
      }
      else {
        candidate.servedBy = 'GET ' + route.path;

        if (!route.html) {
          candidate.reason = 'GET ' + route.path + ' declares no template, so ' +
            'it renders no page for the session-held flash to appear on';
        }
        else {
          candidate.template = route.html;
          scan = fieldsOf(route.html);
          candidate.rendersFields = scan.fields;
          candidate.templateFiles = scan.files;

          fields = proofKeys.filter(function(key) {
            return scan.fields.indexOf(key) !== -1;
          });

          if (!fields.length) {
            candidate.reason = 'the template chain ' + scan.files.join(' <- ') +
              ' renders flash.validation for ' +
              (scan.fields.length ? scan.fields.join(', ') : 'no field') +
              ', and this case flashes ' +
              (proofKeys.length ? proofKeys.join(', ') : 'nothing') +
              ', so the page legitimately shows no message - which is ' +
              'baseline behaviour and is preserved';
          }
          else {
            candidate.applicable = true;
            expected = fields.map(function(field) {
              return record.flashProof.errors[field];
            });
            messages = record.http[MODE_HTML].followed.reduce(
              function(all, hop) {
                return all.concat(hop.renderedMessages);
              }, []);

            candidate.expected = expected;
            candidate.observed = messages;
            candidate.missing  = expected.filter(function(message) {
              return messages.indexOf(message) === -1;
            });

            applicable += 1;

            if (candidate.missing.length) {
              unrendered.push(candidate);
            }
            else {
              rendered += 1;
              examples.push(candidate);
            }
          }
        }
      }

      candidates.push(candidate);
    });
  });

  return {
    applicable : applicable,
    rendered   : rendered,
    // Every fail.redirect rejecting drive, applicable or not, with the reason.
    candidates : candidates.length,
    // EVERY applicable case rather than a leading few, so the artifact carries
    // the whole set a reviewer would otherwise have to reconstruct.
    examples   : examples,
    unrendered : unrendered,
    determinations : candidates,
    oracle : 'A rejecting case is applicable when its target declares a ' +
      'fail.redirect, the redirect template interpolates from the case\'s own ' +
      'input to a path a GET route declares, that route names a template, and ' +
      'the template chain renders flash.validation.<field> outside a <script> ' +
      'block for a field the whole-block proof says the case will flash. Each ' +
      'condition is a fact about the declarations and the templates of the ' +
      'tree under test, so the applicable set is the same on both sides of ' +
      'the gate.'
  };
}

/**
 * Asserts the rendered-validation evidence.
 *
 * Two assertions, the second weaker than the first and kept deliberately:
 *   * EVERY APPLICABLE CASE must render the message the proof says it will.
 *     This is the one that makes the evidence a set rather than an example.
 *   * AT LEAST ONE case must render something at all. This survives as a
 *     separate check because it fails differently: if the follow ever stops
 *     carrying the session cookie, every case becomes inapplicable-looking and
 *     the first assertion would pass vacuously over an empty set.
 *
 * @param {Object} record From buildFlashFollow.
 * @returns {undefined}
 * @throws {ParityError} If an applicable case rendered nothing, or nothing
 *   rendered at all.
 */
function assertFlashFollow(record) {
  if (record.unrendered.length) {
    throw new ParityError(record.unrendered.length + ' applicable case(s) did ' +
      'not render the validation message the whole-block proof says the ' +
      'followed page must show:\n  - ' +
      record.unrendered.map(function(entry) {
        return entry.target + ' -> ' + entry.declared + ' -> ' +
          entry.resolvedPath + ' (' + entry.servedBy + ', ' + entry.template +
          ')\n      expected ' + canonical(entry.expected) +
          '\n      observed ' + canonical(entry.observed);
      }).join('\n  - '));
  }

  if (!record.rendered) {
    throw new ParityError('no rejecting case rendered a validation message on ' +
      'a followed redirect, across ' + record.candidates + ' drive(s) whose ' +
      'target declares a `fail.redirect`. Those targets hold their message IN ' +
      'THE SESSION and render it on the NEXT request, so an empty result ' +
      'means the follow is not carrying the cookie and this gate is comparing ' +
      'statuses only. Measured baseline: `POST /login` with no email answers ' +
      '302 and the followed /login renders `"email" is required`.');
  }
}


// ---------------------------------------------------------------------------
// Infrastructure - the database, the server and the fixtures
// ---------------------------------------------------------------------------

/**
 * ./mongo, in EVERY mode, for the configuration isolation alone.
 *
 * `prepareEnvironment` needs the one implementation of the `config`
 * runtime-layer isolation before the harvest's first application require, and
 * `--schema-only` reaches that path without `loadSiblings`. Requiring ./mongo
 * cannot provision anything and so does not weaken the rule below: at module
 * scope it requires only Node core, resolves no application module, and its
 * `main` runs solely under direct execution. Nothing here starts a database.
 *
 * @returns {Object} The ./mongo module.
 * @throws {ToolError} If it cannot be loaded.
 */
function lazyMongo() {
  if (!lazy.mongo) {
    try {
      lazy.mongo = require('./mongo');
    }
    catch (err) {
      throw new ToolError('cannot load test/parity/mongo.js, which owns the ' +
        'configuration isolation and the database lifecycle this gate depends ' +
        'on: ' + (err && err.message ? err.message : String(err)));
    }
  }

  return lazy.mongo;
}

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
 * The seeder module itself, loaded in EVERY mode.
 *
 * `fixtureIds` documents why loading it is safe before the harvest. This
 * accessor exists because the known-value layer needs more than the ids: the
 * email token is signed for the seeded trinket's `shortCode`, which lives on
 * the fixture rather than in the id map.
 *
 * @returns {Object} The test/parity/seed.js exports.
 * @throws {ToolError} If the seeder cannot be loaded or exposes no fixtures.
 */
function fixtureSeed() {
  fixtureIds();

  if (!lazy.seed.fixtures || !lazy.seed.fixtures.trinkets ||
      !lazy.seed.fixtures.trinkets.trinketPython) {
    throw new ToolError('test/parity/seed.js exposes no ' +
      '`fixtures.trinkets.trinketPython`, whose `shortCode` is what the ' +
      'email token every `verifyEmailToken` route needs is signed for');
  }

  return lazy.seed;
}

/**
 * Publishes the database address into NODE_CONFIG, BEFORE the harvest.
 *
 * The order matters and is not obvious. The npm `config` package resolves and
 * FREEZES on first require, and the harvest is the first require - so whatever
 * NODE_CONFIG holds at that moment is the configuration this whole process
 * sees, including the configuration test/parity/seed.js reads when it resolves
 * `aws.buckets.exports` for the export fixtures. That bucket exists only in the
 * overlay, because committed configuration declares no `exports` entry at all,
 * so composing the address and the overlay first is what lets the seeder run at
 * all.
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
  var nodeConfig;
  var uri;

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
    //
    // THE OVERRIDE MUST BE PASSED. test/parity/server.js's parseMongoUri takes
    // `(raw, override)` and the override WINS over the URI's path, so supplying
    // only `raw` forks the database name three ways under `--mongo-uri .../a
    // --database b`: this process's config and the seeder take `a` from the URI
    // path while the child takes `b`, because startInfrastructure passes
    // `--database` straight through to `server.start`. The application then
    // serves an empty database while the seeder fills a different one, and
    // every pre-handler lookup records a 404 that reads exactly like
    // application behaviour.
    address = lazy.server.parseMongoUri(options.mongoUri, options.database);

    // The URI the SEEDER connects with, rebuilt from the resolved address
    // rather than taken from the raw argument, so it cannot name the URI's
    // database when the override named another. Credentials and query options
    // in the caller's URI are preserved; only the database path is replaced.
    uri = resolvedDatabaseUri(options.mongoUri, address);

    nodeConfig = JSON.stringify(deepMerge(
      deepMerge(
        JSON.parse(composeNodeConfig(process.env.NODE_CONFIG)),
        overlay
      ),
      lazy.mongo.buildRuntimeConfig(address)
    ));
    process.env.NODE_CONFIG = nodeConfig;

    return {
      provisioned : false,
      uri         : uri,
      address     : address,
      overlay     : overlay,
      alignment   : assertDatabaseAlignment(address, uri, nodeConfig,
        'caller-supplied --mongo-uri')
    };
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

  address = {
    host    : started.host,
    port    : started.port,
    database: started.database
  };

  return {
    provisioned : true,
    uri         : started.uri,
    address     : address,
    overlay     : overlay,
    // Aligned by construction on this branch - one address builds both the URI
    // and the runtime config - and checked anyway, because "by construction"
    // is a claim about code that can drift, and the failure it would hide is a
    // silently empty database rather than an error.
    alignment   : assertDatabaseAlignment(address, started.uri,
      started.nodeConfig, 'provisioned mongodb-memory-server')
  };
}

/**
 * Asserts that the application actually connected to the agreed database.
 *
 * The leg of the database agreement that cannot be checked before the child
 * exists. `assertDatabaseAlignment` reconciles three values THIS process
 * computed; this reconciles them with the two the child reports - the address
 * test/parity/server.js's `resolveMongo` settled on, and the `db.mongo` block
 * of the configuration the application booted with. Those are what serve the
 * requests, so an agreement that excluded them would be an agreement about the
 * wrong thing.
 *
 * @param {Object} started From server.start.
 * @param {Object} database From publishDatabaseAddress.
 * @returns {undefined}
 * @throws {ToolError} On any disagreement.
 */
function assertServerDatabase(started, database) {
  var address = (started.mongo || {}).address || null;
  var booted = (((started.config || {}).db) || {}).mongo || null;
  var expected = database.address;
  var mismatches = [];

  function check(label, actual) {
    if (!actual) {
      return;
    }

    ['host', 'port', 'database'].forEach(function(field) {
      if (canonical(actual[field]) !== canonical(expected[field])) {
        mismatches.push(label + ' ' + field + ' is ' +
          canonical(actual[field]) + ', expected ' +
          canonical(expected[field]));
      }
    });
  }

  check('the address the application resolved', address);
  check('the db.mongo block the application booted with', booted);

  if (address === null && booted === null) {
    throw new ToolError('the application under test reported neither a ' +
      'resolved MongoDB address nor a booted db.mongo block, so it cannot be ' +
      'shown to be serving the database the fixtures were seeded into. ' +
      'Refusing to record a matrix whose pre-handler lookups cannot be ' +
      'trusted.');
  }

  if (mismatches.length) {
    throw new ToolError('the application under test is not serving the ' +
      'database this run seeded: ' + mismatches.join('; ') + '. The seeder ' +
      'wrote to ' + redactMongoUri(database.uri) + '. Every pre-handler ' +
      'lookup would 404 ' +
      'against an empty database and the matrix would record it as ' +
      'application behaviour.');
  }

  note('database alignment: ' + expected.host + ':' + expected.port + '/' +
    expected.database + ' agreed across this process\'s NODE_CONFIG, the ' +
    'seeder URI, the address the application resolved and the db.mongo block ' +
    'it booted with');
}

// Query parameters of a MongoDB URI whose VALUE is a credential. `authSource`,
// `replicaSet`, `tls` and the rest name where and how to authenticate and are
// recorded; these carry the secret itself.
var MONGO_SECRET_PARAMS = ['authmechanismproperties', 'password', 'tlscertificatekeyfilepassword',
  'tlscertificatekeyfile', 'proxypassword'];

/**
 * A MongoDB URI with every credential replaced, safe to persist.
 *
 * CWE-532. A `--mongo-uri` may carry `user:password@`, and this tool's outputs
 * are COMMITTED evidence: the artifact, its sidecar, `notes.reproduce` and
 * every diagnostic that names the address. The connection needs the credential
 * and the record does not, so the credential lives in memory only and
 * everything written out goes through here.
 *
 * Host, port, database and the non-secret parameters survive, because they are
 * the facts the alignment record exists to state. A value that does not parse
 * as a URL is returned as the same REDACTED marker rather than verbatim: an
 * unparseable string may still contain a password.
 *
 * @param {*} raw A URI, or anything.
 * @returns {(string|null)} The redacted URI, or null for a null input.
 */
function redactMongoUri(raw) {
  var parsed;
  var text;

  if (raw === null || raw === undefined) {
    return null;
  }

  try {
    parsed = new URL(String(raw));
  }
  catch (err) {
    return REDACTED;
  }

  if (parsed.username || parsed.password) {
    parsed.username = REDACTED;
    parsed.password = '';
  }

  MONGO_SECRET_PARAMS.forEach(function(name) {
    parsed.searchParams.forEach(function(value, key) {
      if (key.toLowerCase() === name) {
        parsed.searchParams.set(key, REDACTED);
      }
    });
  });

  text = parsed.href;

  // `new URL` percent-encodes the marker in the userinfo position; leave the
  // record readable rather than making a reviewer decode it.
  return text.split(encodeURIComponent(REDACTED)).join(REDACTED);
}

/**
 * One argument of the reproduction command, quoted for a POSIX shell.
 *
 * A recorded command is only reproducible if it survives being pasted, and a
 * MongoDB URI routinely carries `?`, `&` and `=` - shell syntax that would
 * silently truncate the argument or run part of it.
 *
 * @param {*} value
 * @returns {string}
 */
function shellArgument(value) {
  var text = String(value);

  return /^[A-Za-z0-9_@%+=:,.\/-]+$/.test(text)
    ? text
    : '\'' + text.split('\'').join('\'\\\'\'') + '\'';
}

/**
 * The connection URI for a resolved address, preserving everything else.
 *
 * Only the database path is replaced. A caller's `--mongo-uri` may carry
 * credentials and driver options, and dropping them while "normalizing" the URI
 * would break the very address the caller asked for; equally, keeping the URI's
 * own database when `--database` overrode it is the fork
 * assertDatabaseAlignment exists to catch. So the URI is rewritten rather than
 * rebuilt.
 *
 * @param {string} raw The caller's `--mongo-uri`, preserved except for its
 *   database path.
 * @param {{database: string}} address The resolved address, whose `database`
 *   replaces that path.
 * @returns {string}
 * @throws {ToolError} If `raw` is not a URL.
 */
function resolvedDatabaseUri(raw, address) {
  var parsed;

  try {
    parsed = new URL(raw);
  }
  catch (err) {
    throw new ToolError('--mongo-uri ' + JSON.stringify(redactMongoUri(raw)) +
      ' is not a URL: ' + (err && err.message ? err.message : String(err)));
  }

  parsed.pathname = '/' + encodeURIComponent(address.database);

  return parsed.href;
}

/**
 * Asserts that all three consumers of the database name agree.
 *
 * The hazard is not that the name is wrong, it is that it can be wrong in only
 * one of three places and produce no error anywhere. The three:
 *
 *  1. THIS PROCESS's composed NODE_CONFIG. npm `config` freezes on first
 *     require, the harvest is that require, and the child inherits this value -
 *     so it decides what the application connects to and what the
 *     recaptcha-conditional schema is derived from.
 *  2. The ADDRESS handed to the child, which `server.start` re-resolves and
 *     which must land on the same database.
 *  3. The SEEDER's connection target, which is where the fixtures every
 *     pre-handler looks up actually get written.
 *
 * A divergence between 1 and 3 gives an application serving an empty database:
 * every seeded-id lookup 404s, most of the matrix never reaches the validation
 * block, and nothing reports a fault. So it is asserted here, naming all three,
 * which is the only way this class of error is distinguishable from real
 * application behaviour.
 *
 * @param {{host: string, port: number, database: string}} address The address
 *   this process resolved, and the one the other two are checked against.
 * @param {string} uri The seeder's connection URI.
 * @param {string} nodeConfig The composed NODE_CONFIG, serialized.
 * @param {string} source How the address was obtained, for the message.
 * @returns {Object} The agreed address, for the provenance record.
 * @throws {ToolError} On any disagreement.
 */
function assertDatabaseAlignment(address, uri, nodeConfig, source) {
  var configured;
  var parsed;
  var fromUri;
  var mismatches = [];

  try {
    configured = ((JSON.parse(nodeConfig).db || {}).mongo) || {};
  }
  catch (err) {
    throw new ToolError('the composed NODE_CONFIG is not JSON, so the ' +
      'database address cannot be verified: ' +
      (err && err.message ? err.message : String(err)));
  }

  try {
    parsed = new URL(uri);
  }
  catch (err) {
    throw new ToolError('the seeder connection URI ' +
      JSON.stringify(redactMongoUri(uri)) +
      ' is not a URL: ' + (err && err.message ? err.message : String(err)));
  }

  fromUri = {
    host    : parsed.hostname,
    port    : parsed.port === '' ? 27017 : Number(parsed.port),
    database: decodeURIComponent(parsed.pathname.replace(/^\//, ''))
  };

  ['host', 'port', 'database'].forEach(function(field) {
    if (canonical(configured[field]) !== canonical(address[field])) {
      mismatches.push('NODE_CONFIG db.mongo.' + field + ' is ' +
        canonical(configured[field]) + ' but the resolved address says ' +
        canonical(address[field]));
    }

    if (canonical(fromUri[field]) !== canonical(address[field])) {
      mismatches.push('the seeder URI\'s ' + field + ' is ' +
        canonical(fromUri[field]) + ' but the resolved address says ' +
        canonical(address[field]));
    }
  });

  if (mismatches.length) {
    throw new ToolError('the database address does not agree across its three ' +
      'consumers (' + source + '): ' + mismatches.join('; ') + '. This ' +
      'process\'s config, the address handed to the application and the ' +
      'seeder\'s connection target must name ONE database, or the ' +
      'application serves a database the fixtures were never written to and ' +
      'every pre-handler lookup 404s while nothing reports a fault.');
  }

  return {
    source      : source,
    host        : address.host,
    port        : address.port,
    database    : address.database,
    // REDACTED, never the live value. See redactMongoUri: this record is
    // written into the artifact and the sidecar, both of which are committed.
    seederUri   : redactMongoUri(uri),
    // Named so the artifact records WHAT was checked, not merely that a check
    // passed.
    agreedAcross: ['this process\'s composed NODE_CONFIG db.mongo.{host,port,' +
      'database}', 'the address handed to the application under test',
      'the URI the seeder connects with']
  };
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
    overlay : options.overlay || lazy.mongo.DEFAULT_OVERLAY,
    // The application child is launched under the same flags the warning policy
    // requires of this process, so that the stderr this run judges can actually
    // carry a pending deprecation. test/parity/server.js already takes the
    // option; it is not modified for this.
    nodeFlags : warningPolicy.REQUIRED_FLAGS.slice()
  };
  var context;
  var started;
  var summary;

  if (options.port !== null) {
    startOptions.port = options.port;
  }

  if (options.mongoUri) {
    // The ALIGNED URI, not the raw argument. publishDatabaseAddress has already
    // resolved the database name once, applying `--database` over the URI's
    // path; handing the child the rewritten URI means it cannot re-derive a
    // different name from the same inputs even if it read the path and ignored
    // the override. Both are still passed, and they agree by construction
    // rather than by luck.
    startOptions.mongoUri = database.uri;
  }

  if (options.database !== null) {
    startOptions.database = options.database;
  }

  started = await lazy.server.start(startOptions);

  // The child re-resolves the address from what it was handed, so what it
  // ACTUALLY connected to is checked against what this process resolved -
  // closing the loop the assertion in publishDatabaseAddress opens. Without
  // this, agreement is asserted over three values this process computed and
  // says nothing about the fourth, which is the one that serves the requests.
  assertServerDatabase(started, database);

  lazy.mongoose.set('strictQuery', true);

  // The ALIGNED URI, with no fallback. `lazy.mongo.uri()` behind it would be a
  // way for the seeder to reach a database nothing had verified: it re-derives
  // an address from the provisioner's own state rather than from the one
  // assertDatabaseAlignment agreed, so on the caller-supplied branch it could
  // name a different database entirely. A missing URI here is a defect in this
  // tool, and it is reported as one.
  if (!database.uri) {
    throw new ToolError('publishDatabaseAddress returned no connection URI, ' +
      'so the seeder has no verified database to write to. This is a defect ' +
      'in this tool: both branches must return an address that ' +
      'assertDatabaseAlignment has agreed.');
  }

  try {
    await lazy.mongoose.connect(database.uri);
  }
  catch (err) {
    // Redacted: a failed connection is exactly when a caller pastes the
    // message into a report, and the URI may carry a password.
    throw new ToolError('cannot connect to ' + redactMongoUri(database.uri) +
      ' to seed the fixtures: ' +
      (err && err.message ? err.message : String(err)));
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
    // The registered model behind INVITATION_FIXTURE. Resolved from THIS
    // worktree for the reason loadSiblings gives about mongoose: the seeder's
    // models and this document must be the same mongoose instance and the same
    // registered schemas. Requiring the module is what registers it.
    invitationModel : invitationModel(),
    // Kept so restartApplication can bring the same server back on the same
    // port against the same database after a crash.
    startOptions: startOptions,
    restarts    : 0,
    // Every stderr this run produced an application into. A restart opens a new
    // capture file, so the LIST is what the warning gate reads - judging only
    // the last one would silently drop the notices of every process that
    // crashed, which are the ones most worth reading.
    stderrPaths : started.stderrPath ? [started.stderrPath] : [],
    restores    : 0
  };

  context.preconditions = await applyPreconditions(context);

  note('preconditions: ' + INVITATION_MODEL + ' ' + INVITATION_FIXTURE.id +
    ' in ' + context.preconditions.collection);

  return context;
}

/**
 * The registered mongoose model behind INVITATION_FIXTURE.
 *
 * Requiring the module is what registers the schema on this process's mongoose;
 * the module itself exports the application's public wrapper, which has no
 * collection handle, so the private model is taken from the registry by the
 * name the module registered it under. Both facts are properties of the shared
 * model helper in lib/models/model.js rather than assumptions made here.
 *
 * @returns {Object} A mongoose model.
 * @throws {ToolError} If the model cannot be loaded or is not registered.
 */
function invitationModel() {
  try {
    require(path.resolve(TOOL_ROOT, 'lib', 'models', 'courseInvitation.js'));

    return lazy.mongoose.model(INVITATION_MODEL);
  }
  catch (err) {
    throw new ToolError('cannot load lib/models/courseInvitation.js from ' +
      TOOL_ROOT + ', which registers the `' + INVITATION_MODEL + '` model ' +
      'this gate writes its own fixture through: ' +
      (err && err.message ? err.message : String(err)));
  }
}

/**
 * The teardown operations of THIS run that did not complete.
 *
 * Module-scoped because `teardown` is called from a `finally` inside the phase
 * the warning capture wraps, while the verdict is assembled several frames
 * later in `runCapture`/`runCompare` - there is no return value that could
 * carry the answer between the two without changing what those functions
 * report.
 */
var teardownFailures = [];

/**
 * Records a teardown operation that did not complete.
 *
 * Does NOT print: every site below already prints the line it always printed,
 * and those lines are the diagnostic evidence. This adds the half that was
 * missing - the observation reaching the verdict.
 *
 * @param {string} operation What was attempted.
 * @param {string} message The measured cause.
 * @returns {undefined}
 */
function recordTeardownFailure(operation, message) {
  // DEDUPLICATED ON THE MESSAGE: ./server adopts ./mongo's records when it
  // stopped a database it provisioned, so one leaked mongod is reachable
  // through both accessors and both are read below. Keying on the measured
  // cause keeps one fault one failure.
  var seen = teardownFailures.some(function (entry) {
    return entry.message === message;
  });

  if (!seen) {
    teardownFailures.push({ operation : operation, message : message });
  }
}

/**
 * Forgets the recorded teardown failures, so a second mode in one process does
 * not inherit the first one's.
 *
 * @returns {undefined}
 */
function resetTeardownFailures() {
  teardownFailures = [];
}

/**
 * Brings everything down, reporting rather than throwing.
 *
 * A teardown that threw would mask the real failure of a run that was already
 * failing, and every step is independently attempted so one stuck component
 * cannot leave the others running.
 *
 * REPORTING IS NOT THE SAME AS TOLERATING. Each of the three steps below is
 * also recorded, and `buildGate` turns every record into an OPERATIONAL
 * failure - so the code is 2, "the gate could not be run cleanly", rather than
 * 1, "the gate found a parity difference". A mongoose connection that would not
 * close, an application that would not stop and a database that would not stop
 * each mean this process may have left something live behind, and a gate that
 * exits 0 in that state is asserting something it did not establish. Two of the
 * three ALSO answer `false` instead of rejecting - ./server's `stop` and
 * ./mongo's `stop` both resolve a boolean - so the fulfilled value and each
 * module's own cleanup record are read as well; a `catch` alone would see
 * neither.
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
      recordTeardownFailure('disconnect mongoose',
        'could not disconnect mongoose: ' + err.message);
    }
  }

  if (lazy.server) {
    await foldStop('stop the application', lazy.server,
      'test/parity/server.js', 'test/parity/server.js');
  }

  if (lazy.mongo) {
    await foldStop('stop the database', lazy.mongo,
      'test/parity/mongo.js', 'test/parity/mongo.js');
  }
}

/**
 * Folds one lifecycle module's stop into the teardown record, counting each
 * fault exactly once.
 *
 * Three channels carry a failure out of ./server's and ./mongo's `stop`, and
 * all three are read here: a REJECTION, a fulfilled `false` - which is the one
 * a `catch` can never see, and the one both modules actually use for an
 * unclean stop - and the module's own named `cleanupFailures()` records, which
 * say WHICH operation leaked. The named records are preferred when they exist,
 * so an unclean stop that named its cause produces one entry rather than two,
 * and the generic entry is written only when nothing else described the fault.
 *
 * @param {string} what The operation, phrased to complete 'could not ...'.
 * @param {Object} target ./server or ./mongo.
 * @param {string} attribution The module its own records come from.
 * @param {string} owner The module, for the generic entry's message.
 * @returns {Promise<undefined>}
 */
async function foldStop(what, target, attribution, owner) {
  var clean = true;
  var threw = false;
  var named;

  try {
    clean = (await target.stop()) !== false;
  }
  catch (err) {
    threw = true;
    clean = false;
    note('WARNING: could not ' + what + ': ' + err.message);
    recordTeardownFailure(what, 'could not ' + what + ': ' + err.message);
  }

  named = typeof target.cleanupFailures === 'function'
    ? target.cleanupFailures()
    : [];

  // The module's records name the operation as a bare phrase, so they are
  // carried through with an attribution rather than a second 'could not'.
  named.forEach(function (entry) {
    recordTeardownFailure(entry.operation + ' (' + attribution + ')',
      entry.message);
  });

  if (!clean && !threw && !named.length) {
    recordTeardownFailure(what, owner + ' reported an unclean stop without ' +
      'naming an operation, so something it started may still be running');
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
  // The artifact's own schema version, and the shape it declares. Both are
  // here because no schema document exists anywhere in this repository - a
  // reviewer's only description of this file's shape is the file itself, so it
  // describes itself. `artifactVersion` is kept beside it and unchanged: it
  // versioned the shape before `version` and `schema` existed, and removing it
  // would break a reader that already looks for it.
  'version',
  'artifactVersion',
  'schema',
  // What this artifact IS, so a comparison cannot mistake a baseline recording
  // for a target replay however it was named on disk.
  'role',
  'mode',
  // The joi that produced it, standalone, so the artifact alone names the
  // version behind its verdicts rather than requiring the sidecar to be
  // present.
  'joiVersion',
  'notes',
  'summary',
  'enumeration',
  'deepCopyProof',
  'orderPolicy',
  'restorePolicy',
  'knownValues',
  'preconditions',
  // The agreed database address and the consumers it was agreed across, in the
  // ARTIFACT as well as the sidecar: a reviewer opening the
  // matrix can see that the application served the database the fixtures were
  // seeded into, which is the precondition for every pre-handler lookup in it.
  'databaseAlignment',
  'languageMaps',
  'inertness',
  'validationReach',
  'crashes',
  // The drives that never answered, each with the reviewed reason its route
  // does not answer. A list rather than the `summary.drivesTimedOut` count,
  // because the comparison diffs it whole: two trees that each time out once,
  // on different routes, have not behaved the same way.
  'timeouts',
  'flashFollow',
  // Every process warning captured while the matrix was built, attributed to
  // this tool or to a dependency. A top-level key added here is
  // comparison-safe: `compareMatrices` compares explicit field whitelists and
  // iterates only the `enumeration` and `deepCopyProof` blocks, so a recording
  // that predates the key cannot present as a difference.
  'warnings',
  // The outcome-proof mismatch audit: every recorded `flashMatchesProof:
  // false`, the rule that explains it, and the rules that explained nothing.
  // Comparison-safe for the same reason.
  'proofMismatches',
  // Null in every mode but `--compare`, where it records how the freshly
  // generated inputs compared with the recorded ones that were actually
  // driven. Always present, so the key order - and therefore a byte diff of
  // two matrices - is stable across modes.
  'crossCheck',
  // The completed target-side comparison, embedded into a BASELINE recording by
  // `--record-into` after the replay it describes has run. Null in a freshly
  // captured matrix, because a capture has not been compared with anything
  // yet. Excluded from `payloadDigest` - see
  // artifactDigests - so embedding it cannot invalidate the digest the
  // comparison report links the baseline by.
  'targetComparison',
  'targets'
];

// The target-level fields `--compare` checks. `key` is the join key and is
// therefore equal by construction; everything else that describes the target is
// compared, because each of them changes what the case MEANS - `identity`
// decides who drove it, `pre` decides whether validation was reachable, `fail`
// decides which branch of request.fail answered.
var COMPARED_TARGET_FIELDS = [
  'method', 'path', 'validateKey', 'section', 'file', 'controller', 'declaredAuth',
  'identity', 'pre', 'preReferences', 'lookupFixtures', 'fail', 'html',
  'success', 'payloadOutput', 'isJoiSchema', 'languageMap', 'leaves'
];

// The per-case fields `--compare` checks: the experiment and its schema-level
// outcome.
var COMPARED_CASE_FIELDS = [
  'kind', 'applicable', 'reason', 'determination', 'transport', 'input',
  'serverVisible', 'schema', 'strategy', 'field', 'additionalViolations',
  'sent', 'coercedTo', 'claimsAcceptance', 'drivePhase', 'knownValues',
  'seededFields', 'flashProof'
];

// The per-outcome fields `--compare` checks: everything observable about the
// response.
var COMPARED_HTTP_FIELDS = [
  'status', 'locationRelative', 'contentType', 'renderedMessages',
  'validationFlash', 'bodyKeys', 'followed', 'timedOut', 'error',
  'authBlocked', 'validationObserved', 'flashMatchesProof',
  'flashProofComparable', 'unexpectedFlashKeys', 'unseededParams',
  'requestTarget', 'requestContentType', 'precededByCrash'
];

// The fields that hold two records together rather than being compared between
// them. `key` is what indexTargets joins on, so comparing it would be
// tautological: two records only meet if their keys are equal.
var JOIN_FIELDS = {
  target : ['key'],
  'case' : [],
  outcome: []
};

// Fields compared ELEMENT BY ELEMENT rather than as one value, because a
// whole-value comparison would report one difference for a container and lose
// the case that caused it.
var ELEMENTWISE_FIELDS = {
  target : ['cases'],
  'case' : ['http'],
  outcome: []
};

// Fields that exist only on a DRIVEN run, measured by diffing a --schema-only
// artifact's records against a captured one: exactly `drivePhase` and `http` at
// case level, and nothing at target level. `http` is element-wise anyway, so
// `drivePhase` is the only field the phantom check must excuse when nothing was
// driven - and it is excused ONLY then, so a captured run that lost it still
// fails.
var DRIVE_DEPENDENT_FIELDS = {
  target : [],
  'case' : ['drivePhase', 'http'],
  outcome: []
};

// Recorded but deliberately NOT compared, each with the reason, per level.
//
// This is a MAP rather than prose because assertFieldCoverage checks it: every
// field present on a serialized record must be compared, or be a join field, or
// be compared element-wise, or appear here with a reason. A field added to the
// artifact later therefore cannot silently stop being compared - the run fails
// until it is either compared or explicitly excused here, which is a guarantee
// a paragraph of prose could not deliver.
var NOT_COMPARED = {
  target : {},
  'case' : {
    leafPlan        : 'generator bookkeeping: HOW the tool searched for an ' +
      'input, not what it sent. The input it arrived at IS compared, which is ' +
      'the part that decides the experiment.',
    refinementRounds: 'generator bookkeeping, as leafPlan',
    generatorNotes  : 'generator bookkeeping, as leafPlan',
    attempts        : 'generator bookkeeping, as leafPlan',
    reviewed        : 'this tool\'s own review annotation for a case it ' +
      'cannot drive; an assertion, not a measurement, and asserted directly ' +
      'by assertEvidence rather than by comparison'
  },
  outcome: {
    location : 'the verbatim header, which carries this run\'s own host and ' +
      'port. `locationRelative` is the comparable form and IS compared; the ' +
      'verbatim value is kept so a reviewer sees exactly what was sent.',
    order    : 'the drive\'s index in the run. Deterministic, but a single ' +
      'case becoming inapplicable would shift every later index and bury the ' +
      'real difference under hundreds of derived ones. The plan is compared ' +
      'as a whole through summary.drives, and `drivePhase` - stable per case - ' +
      'is compared per case.',
    identity : 'already compared at target level; the copy on the outcome is ' +
      'for reading a single record in isolation.'
  }
};

/**
 * The not-compared map as one sentence, for a reader.
 *
 * Derived from NOT_COMPARED rather than written beside it, so the two cannot
 * disagree - which they did before, when the prose omitted `seededFields`
 * entirely while the field was neither compared nor excused.
 *
 * @returns {string}
 */
function notComparedNote() {
  var parts = Object.keys(NOT_COMPARED).map(function(level) {
    var fields = Object.keys(NOT_COMPARED[level]).sort();

    return fields.length
      ? level + ': ' + fields.join(', ')
      : level + ': nothing';
  });

  return 'Every other field on a record IS compared; a field that is neither ' +
    'compared nor listed here fails the run (assertFieldCoverage). Not ' +
    'compared, by level - ' + parts.join('; ') + '. Join fields, which hold ' +
    'two records together rather than being compared: ' +
    JOIN_FIELDS.target.join(', ') + ' (target). Compared element by element ' +
    'rather than as one value: cases (target) and http (case).';
}

var NOT_COMPARED_NOTE = notComparedNote();

/**
 * Asserts that no recorded field is silently uncompared.
 *
 * The three COMPARED_* lists are the whole of what `--compare` checks, and they
 * are hand-maintained - so a field added to a record without being added to a
 * list is recorded, shipped as evidence, and never compared, with nothing
 * anywhere saying so. `seededFields` is the shape of that hazard: it records
 * WHICH leaves carry a seeded fixture id, which makes it part of the generated
 * input, and it sits on every accepting case where a reader would assume the
 * comparison covers it.
 *
 * So the coverage is checked rather than described. Every field present on any
 * serialized record must be in exactly one of four places: the level's
 * COMPARED_* list, its JOIN_FIELDS, its ELEMENTWISE_FIELDS, or NOT_COMPARED
 * with a reason. A field in none of them fails the run; a field claimed as
 * compared that no record carries fails it too, because a list that names a
 * field nothing produces is a list that has drifted from the artifact.
 *
 * @param {Array.<Object>} entries Serialized target entries.
 * @param {boolean} driven True when this run drove HTTP, which decides whether
 *   the drive-dependent fields are expected to be present.
 * @returns {Object} The coverage record, for the artifact.
 * @throws {ParityError} On an unaccounted or phantom field.
 */
function assertFieldCoverage(entries, driven) {
  var levels = {
    target : { compared: COMPARED_TARGET_FIELDS, present: {} },
    'case' : { compared: COMPARED_CASE_FIELDS, present: {} },
    outcome: { compared: COMPARED_HTTP_FIELDS, present: {} }
  };
  var problems = [];
  var coverage = {};

  function record(level, value) {
    if (!value || typeof value !== 'object') {
      return;
    }

    Object.keys(value).forEach(function(field) {
      levels[level].present[field] = true;
    });
  }

  entries.forEach(function(entry) {
    record('target', entry);

    (entry.cases || []).forEach(function(kase) {
      record('case', kase);

      MODES.forEach(function(mode) {
        record('outcome', kase.http ? kase.http[mode] : null);
      });
    });
  });

  Object.keys(levels).forEach(function(level) {
    var compared = levels[level].compared;
    var present = Object.keys(levels[level].present).sort();
    var accounted = compared
      .concat(JOIN_FIELDS[level])
      .concat(ELEMENTWISE_FIELDS[level])
      .concat(Object.keys(NOT_COMPARED[level]));
    var unaccounted = present.filter(function(field) {
      return accounted.indexOf(field) === -1;
    });
    // A level with no records at all cannot have drifted from anything, and
    // `--schema-only` is exactly that case: it records no HTTP outcome by
    // design, so every outcome field would read as a phantom. The level is
    // reported as unpopulated rather than silently skipped, so a DRIVEN run
    // that somehow produced no outcomes is visible rather than excused.
    var phantom = present.length === 0 ? [] : compared.filter(function(field) {
      if (present.indexOf(field) !== -1) {
        return false;
      }

      // A drive-dependent field is absent by design when nothing was driven.
      return driven || DRIVE_DEPENDENT_FIELDS[level].indexOf(field) === -1;
    });

    coverage[level] = {
      populated   : present.length > 0,
      present     : present.length,
      compared    : compared.length,
      joinFields  : JOIN_FIELDS[level],
      elementwise : ELEMENTWISE_FIELDS[level],
      notCompared : Object.keys(NOT_COMPARED[level]).sort(),
      driven      : !!driven,
      phantomCheck: present.length === 0
        ? 'skipped - no record at this level carries any field, which is ' +
          'expected in --schema-only and means there is nothing for the ' +
          'compared list to have drifted from'
        : (driven
          ? 'applied to every compared field'
          : 'applied, excusing the drive-dependent field(s) ' +
            (DRIVE_DEPENDENT_FIELDS[level].join(', ') || '(none)') +
            ' because nothing was driven')
    };

    unaccounted.forEach(function(field) {
      problems.push('the ' + level + ' field `' + field + '` is recorded but ' +
        'is neither compared, nor a join field, nor compared element-wise, ' +
        'nor listed in NOT_COMPARED with a reason. It is shipped as evidence ' +
        'and never checked. Add it to COMPARED_' + level.toUpperCase() +
        '_FIELDS, or to NOT_COMPARED.' + level + ' with the reason it cannot ' +
        'be compared.');
    });

    phantom.forEach(function(field) {
      problems.push('the ' + level + ' field `' + field + '` is in the ' +
        'compared list but appears on no record, so the list has drifted ' +
        'from the artifact it describes');
    });
  });

  if (problems.length) {
    throw new ParityError('the comparison field lists do not cover the ' +
      'artifact:\n  ' + problems.join('\n  '));
  }

  return coverage;
}

// The artifact's schema version, and the shape it declares.
//
// WHY THE SHAPE IS IN THE FILE IT DESCRIBES. This repository holds no schema
// document for these artifacts, so a reviewer's only description of the
// artifact is the artifact. Rather than referring to a document that does not
// exist, every artifact carries its own: the top-level
// keys, the per-target and per-case fields that are part of the contract, and
// the two contracts a reader cannot infer from one record - that `cases` is an
// ORDERED three-element array, one per kind, and which fields `--compare`
// checks.
//
// Version 2 is the first version to carry it. It also renames the per-target
// `section` to `validateKey`, and keeps `section` beside it: the value is the
// KEY OF THE VALIDATE BLOCK - the hand-rolled block iterates `for (var key in
// validation)` and validates `request[key]` for arbitrary keys - so
// `validateKey` says what it is, while `section` is what earlier readers and
// the sibling documentation already look for.
var ARTIFACT_SCHEMA_VERSION = 2;

var ARTIFACT_SCHEMA = {
  version : ARTIFACT_SCHEMA_VERSION,
  describes : 'test/parity/joi-matrix.js validation accept/reject parity matrix',
  // The SHARED contract's roles, from test/parity/manifest.js. A role states
  // which TREE was measured, never which flag ran, so the mode is carried
  // separately and the two together say what an artifact is: a `baseline`
  // artifact in `capture` mode is the recording this gate compares against,
  // and a `baseline` artifact in `schema-only` mode cannot be - it measured
  // the right tree and recorded no HTTP outcome. assertComparable checks both.
  roles : {
    baseline   : 'Measured on a worktree at the base commit (AAP §0.10.3). In ' +
      '`capture` mode this is the recording `--compare` replays the inputs of ' +
      'against another tree, diffing the result against it.',
    target     : 'Measured on the migrated tree. In `compare` mode this is the ' +
      'matrix a live replay drove, having replaced its generated inputs with ' +
      'the ones the recording holds.',
    analysis   : 'Derived by reading a tree, with no application executed - ' +
      'which is what `--schema-only` produces: enumeration, case ' +
      'construction and the local schema proof, with no HTTP outcome. NOT a ' +
      'side of this gate.',
    unreviewed : 'Measured on a tree that is neither, through the explicit ' +
      '--allow-nonbaseline escape. Every gate declines it.'
  },
  topLevel : {
    generator        : 'string - the tool that wrote it',
    version          : 'number - this schema version',
    artifactVersion  : 'number - the pre-schema artifact version, retained',
    schema           : 'object - this block',
    role             : 'string - one of `roles`',
    mode             : 'string - capture | compare | schema-only',
    joiVersion       : 'string - the joi that produced every verdict here',
    notes            : 'object - what the artifact proves, and how to reproduce it',
    summary          : 'object - run shape; a SUMMARY, never the gate',
    enumeration      : 'object - the 102-target split, per file and per section',
    deepCopyProof    : 'object - evidence that the schemas came from a pre-parse copy',
    orderPolicy      : 'string - the drive order, so the sequence is reconstructible',
    restorePolicy    : 'string - when the seeded state was restored mid-run',
    knownValues      : 'object - values derived from the tree, with their source',
    preconditions    : 'object - fixtures this tool created that the seeder does not own',
    databaseAlignment: 'object|null - the one database address this process, ' +
      'the seeder and the application under test all agreed on, and the ' +
      'consumers that were checked. Null in --schema-only, which provisions ' +
      'nothing.',
    languageMaps     : 'array - the two custom-message maps, verbatim',
    inertness        : 'object[] - PHASE 5: whether either map fired',
    validationReach  : 'object - which rejecting cases reached the block',
    crashes          : 'object[] - application crashes, named by the drive that found them',
    timeouts         : 'object|null - the drives that received no response ' +
      'within `budgetMs`, each with the reviewed reason its route never ' +
      'answers; `unresolved` must be empty or the run fails. Null in ' +
      '--schema-only, which drives nothing.',
    flashFollow      : 'object - rendered-validation evidence and its applicable set',
    crossCheck       : 'object|null - replay/divergence record of a --compare run',
    targetComparison : 'object|null - the completed target-side comparison',
    targets          : 'object[] - one per validation target, keyed `<METHOD> <path> <key>`',
    provenance       : 'object - the SHARED provenance block from ' +
      'test/parity/manifest.js, embedded by provenance.attach and hash-linked ' +
      'to everything above it by its own `payloadDigest`, which is taken over ' +
      'this artifact WITHOUT this key. It is what makes the artifact ' +
      'self-authenticating: schema version, the generator identified by its ' +
      'git blob with the commit that holds it, the analysed tree, the ' +
      'delivered head, the base commit, the runtime, and this tool\'s own ' +
      'facts under `detail` - the mode, the joi/hapi/mongoose versions ' +
      'resolved in the tree under test, whether reCAPTCHA was configured, ' +
      'whether the server ran secure, the seed selection, a digest of the ' +
      'composed configuration, and - once --record-into has run - ' +
      '`comparisonEmbedded`, naming the report and target matrix the ' +
      'embedded comparison came from and which keys it wrote. Written last, ' +
      'and outside the compared region by construction: compareMatrices ' +
      'diffs the named summary blocks and the per-target records, so two ' +
      'sides that necessarily describe different trees here cannot produce a ' +
      'difference out of saying so'
  },
  target : {
    key           : 'string - `<METHOD> <path> <validateKey>`, unique',
    validateKey   : 'string - the key of the validate block: payload, query or params',
    section       : 'string - the same value, under its former name',
    identity      : 'string - anonymous | user | admin, chosen by rule',
    pre           : 'object[] - pre-handler descriptors, including the resolved ' +
      'helpers export name for a function form',
    lookupFixtures: 'object - seeded ids the declaration says a pre-handler will look up',
    fail          : 'object|null - the declared fail spec, which decides the branch',
    cases         : 'object[] - EXACTLY three, ORDERED: ' + CASE_KINDS.join(', ')
  },
  'case' : {
    kind          : 'string - one of ' + CASE_KINDS.join(', '),
    applicable    : 'boolean - false carries a `reason` and a `determination`',
    transport     : 'string - json-body | query-string | path-segment',
    input         : 'the value built, or the string "' + NOT_APPLICABLE + '"',
    serverVisible : 'the value as the transport delivers it, when it differs',
    knownValues   : 'object - which keys hold a tree-derived value, and why',
    schema        : 'object - the local proof: accepted, messages, paths, value',
    strategy      : 'string|null - HOW a rejecting or coercion case was built',
    field         : 'string|null - the leaf the primary violation was applied to',
    additionalViolations : 'object[] - fields violated BESIDE `field`, each ' +
      'with its strategy. Empty on every case carrying one violation; ' +
      'non-empty only where the primary violation had to stay put - a ' +
      '`language`-map target, whose inertness is measured on it - and a ' +
      'second field was added so the same case also evidences the rendered ' +
      'message. Compared, so a second violation cannot appear or disappear ' +
      'unnoticed',
    flashProof    : 'object|null - what re-executing the WHOLE validate block ' +
      'on the values this drive presents says the flash must be',
    http          : 'object - one outcome per Accept mode: ' + MODES.join(', ')
  },
  sidecar : {
    what : 'A RUN OUTPUT, written beside every artifact this tool produces ' +
      'and NOT part of the delivery. The artifact carries the provenance ' +
      'block embedded under its own `provenance` key, which is the committed ' +
      'record and what authenticates it; a reader needs no companion file, ' +
      'and readRecording treats an absent sidecar as the normal case. What ' +
      'the sidecar adds is a digest of the exact bytes written plus the ' +
      'facts that may not be committed - see `warningGate` and `run`.',
    path : '<this artifact>.provenance.json - always the SIBLING of the ' +
      'artifact it describes, including the target matrix a --compare run ' +
      'writes to <report>.target.json, whose sidecar is ' +
      '<report>.target.json.provenance.json and not <report>.provenance.json',
    artifactDigest : 'object - the contract\'s digest record over the exact ' +
      'bytes written, from provenance.sidecar',
    'artifact.digest' : 'string - sha256 over the exact bytes of the artifact ' +
      'as sealed',
    'artifact.payloadDigest' : 'string - sha256 over the artifact ' +
      're-serialized with ' + RECORD_INTO_KEYS.join(' and ') + ' set to null ' +
      'and its `provenance` block removed. Stable across --record-into AND ' +
      'across the re-attachment of the block afterwards, which is what lets a ' +
      'comparison report link a baseline by it.',
    'artifact.bytes' : 'number - byte length of the sealed artifact',
    warningGate : 'object|null - the zero-warning gate\'s verdict for this ' +
      'run. Here and never in the artifact: it names the absolute paths of ' +
      'the stderr files it read, and the artifact is diffed field-for-field ' +
      'against a recording whose own install legitimately emits notices this ' +
      'tree suppresses',
    run : 'object - this run\'s own addressing: the tree it read, the ' +
      'server\'s origin, port, pid, run directory and database, and the ' +
      'composed NODE_CONFIG less its secret-labelled values. Every one of ' +
      'them identifies the RUN rather than the experiment, which is why the ' +
      'block records a digest of the configuration and `server.secure` alone'
  },
  contracts : [
    'A recording is compared only if it AUTHENTICATES ITSELF. --compare runs ' +
      'the shared contract\'s validator over the block embedded in the ' +
      'artifact: the schema version, the artifact the block claims to ' +
      'describe, the role, the payload digest recomputed over the artifact ' +
      'without its block, the generator blob and commit resolved as objects ' +
      'in THIS repository, that the delivered generator is still the one that ' +
      'produced it, and - of anything claiming the baseline role - that the ' +
      'tree it measured was the base commit and was clean. A recording whose ' +
      'outcomes were edited after capture fails the payload digest, and one ' +
      'whose block was copied in from another run fails it too. A sidecar is ' +
      'a run output and is not required; where one is present its digest over ' +
      'the exact bytes is reconciled, because a pair that disagrees cannot be ' +
      'read together. The tool\'s own `payloadDigest` links a report to the ' +
      'baseline it compared and is never an integrity seal. --compare also ' +
      'refuses a self-comparison outright, refuses a baseline side that was ' +
      'not produced in `capture` mode, and refuses two recordings from one ' +
      'application HEAD or one joi major unless --allow-same-tree says so and ' +
      'the report records that it did. Without those checks a zero-difference ' +
      'report could be produced by comparing one file with itself.',
    '`cases` is an ordered three-element array - one per kind, in the order ' +
      CASE_KINDS.join(', ') + ' - and assertCaseProofs fails the run if a ' +
      'target carries a different count or a different order. It is an array ' +
      'rather than an object keyed by kind BECAUSE the order is asserted: two ' +
      'artifacts are compared case by case at the same index, so the order is ' +
      'part of the comparison rather than an accident of serialization.',
    'Every target carries three case records even when a kind is inapplicable; ' +
      'an inapplicable case carries a reason and a determination, never an ' +
      'absence.',
    '`--compare` checks the field lists this block names in `compared`, per ' +
      'target, per case and per Accept mode. Nothing else is compared, and ' +
      'what is deliberately not compared is named in `summary.notCompared`.'
  ],
  compared : {
    target  : COMPARED_TARGET_FIELDS,
    'case'  : COMPARED_CASE_FIELDS,
    outcome : COMPARED_HTTP_FIELDS,
    joinFields  : JOIN_FIELDS,
    elementwise : ELEMENTWISE_FIELDS,
    notCompared : NOT_COMPARED,
    driveDependent : DRIVE_DEPENDENT_FIELDS,
    enforcement : 'assertFieldCoverage walks every serialized record and fails ' +
      'the run if any field present is not in exactly one of these four ' +
      'places, or if a compared field appears on no record. So this block ' +
      'cannot drift from what the comparator actually checks, and a field ' +
      'added to the artifact cannot be shipped as evidence without being ' +
      'either compared or excused with a reason. The measured result is in ' +
      '`summary.fieldCoverage`.'
  }
};

/**
 * What the artifact proves and the commands that reproduce it.
 *
 * Written INTO the artifact rather than into a document, because the artifact
 * is what a reviewer opens and because the default output paths belong to
 * another unit. The commands are the ones this run was invoked with, filled in
 * from the resolved options rather than from a template, so a reviewer can
 * re-run the exact thing rather than a generic form of it.
 *
 * @param {Object} options Parsed arguments.
 * @param {string} mode
 * @returns {Object}
 */
function artifactNotes(options, mode) {
  // Every flag this run was actually invoked with, so `reproduce.thisRun` is a
  // command that RUNS rather than a sketch of one. `--overwrite` and
  // `--record-into` in particular: without them the printed command would be
  // refused the moment the artifact it names exists, which is always, since the
  // artifact is what the reader is holding.
  // Every value is shell-quoted, and `--mongo-uri` is REDACTED: a URI may
  // carry `user:password@` and this text is committed inside the artifact
  // (CWE-532). A reader supplies their own credential; everything else about
  // the address is in `databaseAlignment`.
  // Every PATH is a symbolic label rather than the absolute one this run was
  // given (RULE-F33). The delivered artifact recorded
  // `--app /tmp/blitzy/scratch/<uuid>/w-023/baseline-2f8712a --out
  // /tmp/blitzy/trinket-oss/<clone>/test/parity/joi-baseline.json`, which
  // names one agent's clone: a reader outside it cannot run that command and
  // learns only where somebody else's worktree sat. `tool:<relative>` is
  // runnable from the repository root, and `ephemeral:<basename>` says
  // honestly that the rest was scratch. The tree the run MEASURED is not lost
  // by this - it is in the provenance block, by commit.
  var label = function(value) {
    return provenance.pathLabel(value, { toolRoot: TOOL_ROOT });
  };
  var flags = [
    '--app ' + shellArgument(label(options.appRoot)),
    options.port === null ? null : '--port ' + shellArgument(options.port),
    options.database === null
      ? null
      : '--database ' + shellArgument(options.database),
    options.overlay === null
      ? null
      : '--overlay ' + shellArgument(label(options.overlay)),
    options.mongoUri === null
      ? null
      : '--mongo-uri ' + shellArgument(redactMongoUri(options.mongoUri)),
    options.allowSameTree ? '--allow-same-tree' : null,
    options.recordInto === null
      ? null
      : '--record-into ' + shellArgument(label(options.recordInto)),
    options.overwrite ? '--overwrite' : null
  ].filter(function(flag) {
    return flag !== null;
  }).join(' ');

  return {
    proves : mode === 'schema-only'
      ? 'The enumeration, the case set and the local schema proof for all ' +
        EXPECTED.targets + ' targets, at the joi named in `joiVersion`. NO ' +
        'HTTP outcome is recorded, so this artifact is not the parity gate.'
      : 'Every case in this artifact was DRIVEN against a running ' +
        'application at the joi named in `joiVersion`, in both Accept modes, ' +
        'and the response was recorded as measured. A `targetComparison` ' +
        'block, when present, carries the completed comparison against the ' +
        'other side of the gate; when it is null this artifact is one side ' +
        'only.',
    reproduce : {
      thisRun : 'node test/parity/joi-matrix.js ' +
        (mode === 'compare'
          ? '--compare ' + shellArgument(label(options.compare[0]) ||
            '<baseline.json>')
          : '--' + mode) +
        ' ' + flags + ' --out ' +
        shellArgument(label(options.out) || '<out.json>') +
        ' >/dev/null 2>/dev/null',
      // What the labels above mean, because a command a reader cannot resolve
      // is not a reproduction instruction.
      paths : 'Every path in `thisRun` is a symbolic label: `tool:<relative>` ' +
        'is relative to the repository root and `ephemeral:<basename>` was a ' +
        'scratch location whose directory is this run\'s own machine state - ' +
        'substitute your own. The tree that was MEASURED is named by commit ' +
        'in `provenance.analysedTree`, which is the reproducible form of it; ' +
        '`baselineCapture` below is how that tree is created.',
      // Stated because a redacted command is not a runnable one, and a reader
      // who is not told would paste the marker as a password.
      credentials : 'Any credential a `--mongo-uri` carried is REDACTED as "' +
        REDACTED + '" here, in `databaseAlignment.seederUri` and in every ' +
        'diagnostic; supply your own. Host, port, database and the ' +
        'non-secret parameters are recorded in full.',
      baselineCapture : 'node test/parity/joi-matrix.js --capture --app ' +
        '<baseline worktree at the base commit, with its OWN npm ci> ' +
        '--port <free port> --database <isolated name> --out <baseline.json> ' +
        '>/dev/null 2>/dev/null',
      targetComparison : 'node test/parity/joi-matrix.js --compare ' +
        '<baseline.json> --port <free port> --database <isolated name> ' +
        '--out <report.json> >/dev/null 2>/dev/null   # writes ' +
        '<report.json>, <report.json>.target.json and ' +
        '<report.json>.target.json.provenance.json',
      recordComparison : 'add `--record-into <baseline.json> --overwrite` to ' +
        'the comparison above to write the completed `targetComparison` block ' +
        'and the replay `crossCheck` back into the baseline recording, ' +
        're-attach its provenance block over the new bytes and re-seal. ' +
        'Refused unless the report\'s baseline payload digest equals that ' +
        'recording\'s.',
      offlineRecompare : 'node test/parity/joi-matrix.js --compare <a.json> ' +
        '<b.json> --out <report.json> --allow-same-tree   # two recordings, ' +
        'no application. --allow-same-tree is required because both come from ' +
        'one tree, and the report records that it was used. Comparing a file ' +
        'with itself is refused unconditionally.',
      streams : 'BOTH streams must be discarded by the caller and the ' +
        'artifact read from disk: proving the parser deletes `validate` loads ' +
        'every controller, which prints the in-memory-queue line on stdout, ' +
        'and a baseline tree prints the AWS SDK v2 notice on stderr.'
    },
    digests : 'TWO digests cover this file, and they answer different ' +
      'questions. `provenance.payloadDigest`, embedded above, is the shared ' +
      'contract\'s seal: sha256 over the canonical form of this artifact ' +
      'WITHOUT its `provenance` key, so an edited outcome or a block copied ' +
      'in from another run fails it, and `--compare` recomputes it before ' +
      'consuming this file. The run-output sidecar, when one is beside it, ' +
      'additionally records sha256 over the exact bytes (`artifact.digest`) ' +
      'and sha256 over the artifact re-serialized with ' +
      RECORD_INTO_KEYS.map(function(key) {
        return '`' + key + '`';
      }).join(' and ') + ' set to null AND its `provenance` block removed ' +
      '(`artifact.payloadDigest`). A comparison report links a baseline by ' +
      'that second one precisely so that embedding the comparison result back ' +
      'into the recording afterwards - which writes exactly those keys and ' +
      'then re-attaches the block - cannot invalidate the link, and ' +
      '--record-into asserts that invariant before it writes. Recompute it ' +
      'with: node -e "const m=require(\'./<artifact>.json\');' +
      RECORD_INTO_KEYS.map(function(key) {
        return 'm.' + key + '=null;';
      }).join('') + 'delete m.provenance;' +
      'console.log(require(\'crypto\').createHash(\'sha256\')' +
      '.update(JSON.stringify(m,null,2)+String.fromCharCode(10))' +
      '.digest(\'hex\'))". The whole-file digest is sha256sum <artifact>.json.'
  };
}

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
    // Of those, how many carry no reviewed reason. Zero, or assertEvidence
    // fails the run; recorded so the artifact states the compliance rather
    // than leaving it to be inferred from the `timeouts` block.
    timeoutsUnreviewed: input.timeouts === null || input.timeouts === undefined
      ? null
      : input.timeouts.unresolved.length,
    applicationCrashes: input.drives === null ? null : input.drives.crashes.length,
    applicationRestarts: input.drives === null ? null : input.drives.restarts,
    // One per non-GET drive; see RESTORE_POLICY. Recorded so a reader can see
    // that no drive after the first GET phase ran against a database an earlier
    // drive had changed.
    stateRestores     : input.drives === null ? null : input.drives.restores,
    outcomesWithFlash : input.drives === null ? null : input.drives.observed,
    // Of the applicable ones, which is the figure the assertion is about; the
    // candidate and applicable counts are in the flashFollow block.
    renderedFollows   : input.flashFollow === null
      ? null
      : input.flashFollow.rendered,
    applicableFollows : input.flashFollow === null
      ? null
      : input.flashFollow.applicable,
    rejectingReached  : input.validationReach === null
      ? null
      : input.validationReach.reached,
    rejectingUnreached: input.validationReach === null
      ? null
      : input.validationReach.unreached,
    // Unreached WITHOUT a reviewed reason. This is the figure the gate asserts
    // to be zero; `rejectingUnreached` counts the reviewed ones too.
    rejectingUnresolved: input.validationReach === null
      ? null
      : input.validationReach.unresolved,
    flashProofMismatches: input.flashProofs === null ||
      input.flashProofs === undefined
      ? null
      : input.flashProofs.mismatches,
    unexpectedFlashes : input.flashProofs === null ||
      input.flashProofs === undefined
      ? null
      : input.flashProofs.unexpected,
    // Filled in by `annotateMatrix` once the artifact exists, because the audit
    // is a function OF the artifact. Declared here so the summary's key order
    // is fixed in every mode, which is what keeps two matrices byte-comparable.
    proofMismatches   : null,
    proofMismatchesUnclassified : null,
    notCompared       : NOT_COMPARED_NOTE,
    // The machine-checked counterpart of `notCompared`: per level, how many
    // fields the records carry, how many are compared, and which are join,
    // element-wise or excused. assertFieldCoverage fails the run if those four
    // do not account for every field present, so this block is a measurement
    // rather than a claim.
    fieldCoverage     : input.fieldCoverage === undefined
      ? null
      : input.fieldCoverage
  };
}

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

/**
 * Builds this run's provenance record, through the shared contract.
 *
 * THE RECORD IS THE CONTRACT'S, NOT THIS FILE'S. Every field comes from
 * `provenance.build` in test/parity/manifest.js, which composes the schema
 * version, the generator identity, the analysed tree, the delivered head, the
 * base commit and the runtime, and then runs the portability guard over the
 * whole block - so a value that cannot be reproduced from the repository makes
 * the run FAIL rather than reaching an artifact. Everything this tool wants to
 * add rides in `detail`, which the same guard covers.
 *
 * WHAT THIS FUNCTION USED TO DO, AND WHY IT DOES NOT ANY MORE. It hand-built a
 * record of its own: the tool's worktree ROOT and the analysed tree's ROOT as
 * absolute paths, a `capturedAt` wall clock, and - when a server ran - its PID,
 * its port, its working directory, its run directory and its database name.
 * Four independent reviews condemned exactly that record: it named a SIBLING
 * CLONE's worktree and a tool commit whose tree does not contain this
 * generator, so it could neither be reproduced nor authenticate the artifact it
 * accompanied. A fifth then found the deeper fault - this doc block already
 * described the record below while the code went on emitting the one above, and
 * a contract that only the comment obeys is not a contract. The guard is what
 * closes that: it is executable, so the two cannot diverge again.
 *
 * Every one of those facts is now either dropped or replaced by something a
 * reviewer can re-derive from the repository:
 *   tool root, tool head   -> `generator`, which identifies the source by its
 *                             git BLOB - the same 40 characters in every clone
 *                             - and records a commit only after proving that
 *                             commit's tree holds that blob at that path; plus
 *                             `delivered`, the tool worktree's HEAD with no
 *                             path attached.
 *   app root, app head     -> `analysedTree`, a HEAD, a subject and
 *                             `isBaselineCommit`, with no path. Several paths
 *                             can name one commit, and the commit is the fact.
 *   capturedAt             -> nothing. The contract's portability guard throws
 *                             on a wall clock.
 *   server pid/port/       -> `server.secure` alone, which is the only
 *   appRoot/runDir/          semantically meaningful bit, because the cookie
 *   database                 contract is exercised in both secure and
 *                             non-secure passes and which pass produced an
 *                             artifact is a property of the EXPERIMENT.
 *   NODE_CONFIG verbatim   -> a digest of the composed string plus its sorted
 *                             TOP-LEVEL KEYS. Even redacted, the composed
 *                             configuration carries the port and the database
 *                             name, so recording it verbatim readmits
 *                             run-local state through the back door. The
 *                             reproduction source is the committed overlay,
 *                             which the `redaction` prose names.
 *
 * What survives, in `detail`, is what explains the artifact: the mode, the joi
 * / hapi versions resolved INSIDE the tree under test - the single most
 * important fact about a capture, since 17.13.3 on one side and 18.2.5 on the
 * other are the two sides of this gate - the mongoose the driver seeded with,
 * `recaptchaConfigured`, the seed selection, whether the server ran secure, and
 * the normalization and redaction prose.
 *
 * `recaptchaConfigured` is recorded because it CHANGES THE TARGET SET: with
 * `app.recaptcha.secretkey` set, `'g-recaptcha-response'` becomes
 * `Joi.string().required()` instead of `.allow('').optional()`, so a capture
 * taken with a secret and one taken without are not comparable. The overlay
 * leaves it unset on both sides and this is the evidence.
 *
 * The run-local facts a debugger still wants are not thrown away - they move to
 * `buildRunOutput`, whose record goes in the sidecar. See sealRecording.
 *
 * @param {Object} input
 * @param {string} input.mode The mode that produced the artifact.
 * @param {string} input.artifact Basename of the artifact this describes.
 * @param {string} input.role One of the contract's roles, decided by
 *   `resolveRole` from the tree that was measured.
 * @param {string} input.appRoot The tree under test, absolute. USED, not
 *   recorded.
 * @param {Object} input.environment From prepareEnvironment.
 * @param {boolean} input.recaptchaConfigured
 * @param {(Object|null)} input.server The start result, or null.
 * @param {(Object|null)} input.seedSummary
 * @returns {Object} A schema-2 provenance block, portability-checked.
 * @throws {ToolError} If a value in the block is not reproducible, or the role
 *   is unknown. Both are operational failures: an artifact whose provenance
 *   cannot be trusted must not be written.
 */
function buildProvenance(input) {
  var redacted = redactSecrets(input.environment.nodeConfig);
  var composed = parseJsonOrNull(input.environment.nodeConfig);
  var alignment = input.databaseAlignment === undefined ||
    input.databaseAlignment === null
    ? null
    : input.databaseAlignment;

  try {
    return provenance.build({
      artifact      : input.artifact,
      role          : input.role,
      // `__filename`, so the block identifies the generator by the git blob of
      // the bytes that actually ran rather than by a commit somebody hopes
      // contains them.
      generatorFile : __filename,
      toolRoot      : TOOL_ROOT,
      // USED to derive `analysedTree`, never recorded: the contract records the
      // commit, and the path is where that commit happened to sit on one host.
      analysedRoot  : input.appRoot,
      detail        : {
        mode            : input.mode,
        artifactSchema  : ARTIFACT_SCHEMA_VERSION,
        // The joi behind every verdict in the artifact, resolved INSIDE the
        // tree under test. The single most important fact about a capture:
        // 17.13.3 on one side and 18.2.5 on the other ARE the two sides of
        // this gate, and assertComparable refuses a comparison that cannot
        // show they differ.
        versions        : {
          joi      : packageVersion(input.appRoot, 'joi'),
          hapi     : packageVersion(input.appRoot, '@hapi/hapi'),
          mongoose : packageVersion(TOOL_ROOT, 'mongoose')
        },
        // Recorded because it CHANGES THE TARGET SET: with
        // `app.recaptcha.secretkey` set, `'g-recaptcha-response'` becomes
        // `Joi.string().required()` instead of `.allow('').optional()`, so a
        // capture taken with a secret and one taken without are not
        // comparable. The overlay leaves it unset on both sides and this is
        // the evidence.
        recaptchaConfigured : input.recaptchaConfigured,
        // The only semantically meaningful bit of the server that ran: AAP
        // §0.6.1 runs the cookie contract twice, and which pass produced an
        // artifact is a property of the EXPERIMENT. Its pid, its port, its
        // working directory, its run directory and its database name are this
        // run's process table and are deliberately absent.
        server          : input.server === null
          ? null
          : { secure: !!input.server.secure },
        // That one database address was agreed, and WHICH consumers were
        // checked - without the address itself, which is generated per run.
        // Null in --schema-only, which provisions nothing.
        databaseAlignment : alignment === null ? null : {
          source      : alignment.source,
          agreedAcross: alignment.agreedAcross
        },
        seed            : input.seedSummary === null ? null : input.seedSummary,
        // The composed configuration, as a fingerprint rather than as itself.
        // Even redacted, the composed NODE_CONFIG carries the port and the
        // ephemeral database name, so recording the string put run-local state
        // into a committed artifact through the back door.
        // `configurationDigest` redacts every secret-labelled value and drops
        // every address-labelled one BEFORE hashing, so the digest identifies
        // the part of the configuration that describes the tree and cannot
        // confirm a guess at a secret. The reproduction source is the
        // committed overlay, which the `redaction` prose names.
        configuration   : {
          NODE_ENV        : input.environment.nodeEnv,
          nodeConfigKeys  : composed === null
            ? []
            : Object.keys(composed).sort(),
          nodeConfigDigest: provenance.configurationDigest(
            composed === null ? {} : composed),
          nodeConfigDir   : provenance.pathLabel(
            input.environment.nodeConfigDir,
            { toolRoot: TOOL_ROOT, analysedRoot: input.appRoot }),
          redactedKeys    : redacted.redactedKeys
        },
        // The one normalization this gate applies, named in the provenance so
        // it travels with the artifact.
        normalization   : 'Only the ORIGIN of an absolute Location header is ' +
          'removed, into locationRelative; the verbatim header is recorded ' +
          'beside it. Nothing else is normalized.',
        // Declared beside the normalization for the same reason: a record that
        // withholds something without saying so misrepresents itself.
        redaction       : 'The composed NODE_CONFIG is recorded as ' +
          '`configuration.nodeConfigDigest` and not verbatim. Before it is ' +
          'hashed, every secret-labelled value is replaced and every ' +
          'address-labelled value dropped, and `configuration.redactedKeys` ' +
          'lists the paths this tool had already withheld under ' +
          'SECRET_KEY_PATTERN. The child process received the real ' +
          'configuration - the redaction applies to this record only. The ' +
          'values come from the committed overlay ' +
          '(test/parity/server-overlay.json) and any --overlay the caller ' +
          'passed, which are where a reviewer reproduces them from.'
      }
    });
  }
  catch (err) {
    throw asToolError(err);
  }
}

/**
 * The facts about THIS RUN that belong in the sidecar and nowhere else.
 *
 * The block above is portable by construction - the contract's guard throws on
 * a value that is not - and that is what makes it committable. But a run still
 * produces facts a reader wants while debugging one, and two of them cannot go
 * in a committed artifact at all:
 *
 *   the warning-gate verdict  It carries the absolute paths of the stderr
 *                             files it read, and this file's own header
 *                             requires the verdict to stay OUT of the artifact
 *                             for a second reason: the artifact is diffed
 *                             field-for-field against the baseline recording,
 *                             and a baseline install legitimately emits the
 *                             AWS SDK v2 notice that only the target's
 *                             config/aws.js suppresses, so a warning record
 *                             inside it would manufacture a validation-parity
 *                             difference out of a warning difference.
 *   the address that was used A port and an ephemeral database name identify
 *                             the run rather than the experiment.
 *
 * So they live here, on the SIDECAR, which is a run output: written next to the
 * artifact, useful for the next ten minutes, and not committed. See
 * sealRecording.
 *
 * @param {Object} input The same input buildProvenance received.
 * @returns {Object} The sidecar-only run record.
 */
function buildRunOutput(input) {
  var alignment = input.databaseAlignment === undefined
    ? null
    : input.databaseAlignment;

  return {
    mode        : input.mode,
    // Filled in by recordWarningGate, which runs after teardown so the
    // application's stderr is complete. Null when the gate never reported.
    warningGate : null,
    // The run's own addressing, for a reader debugging THIS run.
    run         : {
      appRoot  : input.appRoot,
      server   : input.server === null ? null : {
        origin   : input.server.origin,
        port     : input.server.port,
        secure   : input.server.secure,
        pid      : input.server.pid,
        runDir   : input.server.runDir,
        database : input.server.mongo === null ||
          input.server.mongo === undefined
          ? null
          : input.server.mongo.database
      },
      databaseAlignment : alignment,
      // The composed configuration the child received, less the values
      // SECRET_KEY_PATTERN names. Here rather than in the block for the reason
      // the block's `redaction` prose gives.
      environment : {
        NODE_ENV        : input.environment.nodeEnv,
        NODE_CONFIG     : redactSecrets(input.environment.nodeConfig).nodeConfig,
        NODE_CONFIG_DIR : input.environment.nodeConfigDir
      }
    }
  };
}

/**
 * The role this artifact must carry, decided by the TREE THAT WAS MEASURED.
 *
 * A role is a fact about the tree, never about which flag ran: a sidecar saying
 * `mode: "capture"` reads as "baseline" while identifying no tree at all. So
 * the tree decides, and a `--capture` run - the mode whose artifact IS the
 * recorded baseline this gate compares against - must additionally PROVE it
 * measured BASELINE_COMMIT.
 *
 * `--schema-only` and `--compare` are deliberately not held to that. Both are
 * legitimately run against the migrated tree - the first is the enumeration
 * proof, the second is the target side of the gate.
 *
 * They differ in what they may CLAIM, though, and that is what the contract's
 * fourth role is for. `--schema-only` executes no application: it enumerates,
 * builds and locally proves, and records not one HTTP outcome. Under the
 * contract that is `analysis` - "derived by reading a tree, with no application
 * executed" - whichever tree it read, and labelling it `baseline` because it
 * happened to read the base commit would produce an artifact a comparison could
 * consume as the recorded side of a gate it never measured. `--compare`
 * measures, so its role follows the tree.
 *
 * @param {Object} options Parsed arguments, for the escape hatch.
 * @param {string} mode The mode being run.
 * @param {Object} tree From provenance.treeIdentity.
 * @returns {string} A contract role.
 * @throws {ToolError} When a capture is pointed at a tree that is not the base
 *   commit and no escape was given.
 */
function resolveRole(options, mode, tree) {
  if (mode === 'schema-only') {
    return ROLE_ANALYSIS;
  }

  if (mode !== 'capture') {
    return tree.isBaselineCommit ? ROLE_BASELINE : ROLE_TARGET;
  }

  try {
    return provenance.assertBaseline(tree, {
      allowNonBaseline: options.allowNonBaseline,
      what            : 'the joi baseline matrix'
    });
  }
  catch (err) {
    throw asToolError(err);
  }
}

/**
 * Re-raises a failure from the shared contract as this tool's operational
 * error.
 *
 * The contract throws its own `ToolError`, which is a different constructor
 * from this file's, so `run`'s `instanceof` test would miss it and report a
 * bare stack under UNEXPECTED FAILURE. The message is already complete and is
 * carried through verbatim; only the class changes, so the exit code is 2 - the
 * gate could not run - and the message is the one the contract wrote.
 *
 * @param {*} err
 * @returns {ToolError}
 */
function asToolError(err) {
  if (err instanceof ToolError || err instanceof ParityError) {
    return err;
  }

  return new ToolError(err && err.message ? err.message : String(err));
}

/**
 * JSON.parse that yields null instead of throwing.
 *
 * Used for the NODE_CONFIG key list, which is a nicety in a record: an
 * unparseable value must not be the reason a run fails, and the digest beside
 * it covers the exact string either way.
 *
 * @param {*} text
 * @returns {(Object|null)}
 */
function parseJsonOrNull(text) {
  var parsed;

  try {
    parsed = JSON.parse(String(text));
  }
  catch (err) {
    return null;
  }

  return isPlainObject(parsed) ? parsed : null;
}

/**
 * The basename of the artifact a mode writes.
 *
 * The block records which artifact it describes and a consumer CHECKS it, so
 * this must agree with the path actually written - which is why both write
 * sites and this function read the same defaults.
 *
 * @param {Object} options Parsed arguments.
 * @param {string} mode The mode being run.
 * @returns {string}
 */
function artifactName(options, mode) {
  if (mode === 'compare') {
    return path.basename(options.out || DEFAULT_COMPARISON_OUT) + '.target.json';
  }

  return path.basename(options.out || COMMITTED_BASELINE);
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
// The outcome-proof mismatch audit, and the warning capture
// ---------------------------------------------------------------------------
// `flashMatchesProof` records, per driven outcome, whether the validation flash
// the application produced carries EXACTLY the leaf paths the local schema
// proof predicted. It is null wherever there is nothing to compare - no flash
// or no schema - and false where the two disagree. A false that is recorded and
// not classified is an unexplained mismatch shipped as evidence, so the audit
// below classifies every one of them and fails the run on any it cannot.
//
// A mismatch is not automatically a defect: the two mechanisms below are both
// explainable behaviour of the hand-rolled block. So each mismatch is RESOLVED
// EXPLICITLY - classified against a named rule, with the classification
// recorded in the artifact - and an UNCLASSIFIED mismatch is fatal. A declared
// rule that matches NOTHING is fatal too, so the rule set cannot keep passing
// after the behaviour it describes has gone.
//
// `flashMatchesProof` ITSELF IS NOT RECOMPUTED, and that is a hard constraint
// rather than a preference: it is in COMPARED_HTTP_FIELDS and the committed
// baseline was captured with the current definition, so changing how it is
// derived would make every fresh target run diverge from the baseline on a
// field that had not actually changed. Classification is purely additive and
// reads the same recorded values a reviewer sees.
//
// THE TWO MECHANISMS, each a property of the tree under test:
//
// 1. AN OBJECT-LEVEL JOI ERROR HAS NO PATH. The validation block in
//    lib/util/routeParser.js loops over EVERY declared validate section and
//    merges every error into ONE flash object keyed by `err.path.join('.')`. An
//    error about the value as a whole - `"value" must be of type object` -
//    carries an empty path, so it lands under the key `''`, which no leaf-path
//    proof can predict. Every instance is a `query` target on one of the POST
//    routes that also declare a `payload` schema: driving the query target
//    sends no body, the block validates `request.payload` anyway, and the
//    object-level error from that OTHER section appears in the same flash. It
//    is preserved, not repaired.
//
// 2. A `payload: {output: 'file'}` ROUTE NEVER SEES THE BODY THE CASE SENT.
//    hapi writes the request body to a temporary file and hands the handler its
//    own descriptor - `path` and `bytes` - so the declared schema's own key is
//    reported missing and hapi's two keys are reported as not allowed,
//    regardless of what was sent. Four routes declare it, and they are the only
//    four in the repository that do: `POST /file` and `POST /file/avatar` in
//    config/routes.js, and `POST /api/users/assets` and
//    `POST /api/users/assets/{fileId}` in config/api_routes.js.
//
// WHAT MAKES THESE RULES MORE THAN LABELS. Each carries positive conditions a
// changed behaviour would break: rule 1 requires the mismatch to be the empty
// key ALONE and the route to declare another section; rule 2 requires BOTH of
// hapi's file-output keys to be present in the flash, every extra key to be one
// of those two or a declared leaf of the section under test, and NO missing key
// to be one of hapi's own - because a transport key the flash lost would mean
// the block dropped something it did receive, which is a defect and not this
// mechanism.

// hapi's own payload keys under `payload: {output: 'file'}`: the descriptor it
// substitutes for the parsed body, and what the flash of all four routes below
// reports as not allowed.
var FILE_OUTPUT_PAYLOAD_KEYS = Object.freeze(['path', 'bytes']);

// The only four routes in the repository declaring `payload: {output: 'file'}`.
// Enumerated rather than derived, because classification also runs in
// `--compare a b` mode where no route declaration is loaded at all - the audit
// must be a pure function of an artifact.
var FILE_OUTPUT_ROUTES = Object.freeze([
  'POST /file',                       // config/routes.js
  'POST /file/avatar',                // config/routes.js
  'POST /api/users/assets',           // config/api_routes.js
  'POST /api/users/assets/{fileId}'   // config/api_routes.js
]);

// An error whose `path` is empty joins the flash under this key, because
// lib/util/routeParser.js's validation block computes `err.path.join('.')` and
// assigns the message under whatever that yields.
var OBJECT_LEVEL_FLASH_KEY = '';

// The unknown key the rejecting-input generator injects - see
// buildRejectingInput's `unknownKey` strategy. Named here so a rule can talk
// about it without the reader having to find it.
var INJECTED_UNKNOWN_KEY = 'parityUnknownKey';

/**
 * The rule set. Small, named and enumerated, each with the mechanism it
 * describes and the evidence for it.
 *
 * `matches` receives a mismatch descriptor from `describeMismatch` and returns
 * true only when every condition of its mechanism holds.
 */
var PROOF_MISMATCH_RULES = Object.freeze([
  Object.freeze({
    id     : 'object-level-error-path',
    reason : 'the flash carries the empty key `' + OBJECT_LEVEL_FLASH_KEY +
             '`, which is where lib/util/routeParser.js:412,416 puts a joi ' +
             'error whose path is empty - an object-level error such as ' +
             '`"value" must be of type object`. The block validates every ' +
             'declared section into one flash (:401-418), and the route declares ' +
             'another section besides the one under test, so the error comes ' +
             'from validating that other section with nothing sent for it. A ' +
             'leaf-path proof cannot predict a path-less error.',
    matches : function(record) {
      return record.extra.length === 1 &&
        record.extra[0] === OBJECT_LEVEL_FLASH_KEY &&
        record.missing.length === 0 &&
        record.siblingSections.length > 0;
    }
  }),
  Object.freeze({
    id     : 'file-output-transport-payload',
    reason : 'the route declares `payload: {output: \'file\'}`, so hapi ' +
             'replaces the parsed body with its own descriptor and the ' +
             'handler never sees what the case sent. The flash therefore ' +
             'reports hapi\'s keys (' + FILE_OUTPUT_PAYLOAD_KEYS.join(', ') +
             ') as not allowed and the schema\'s own key as required, while ' +
             'any path the local proof predicted for the undelivered body is ' +
             'absent. Measured on POST /file, POST /file/avatar, ' +
             'POST /api/users/assets and POST /api/users/assets/{fileId}.',
    matches : function(record) {
      var extrasExplained;
      var missingIsTransportKey;

      if (record.section !== 'payload' ||
          FILE_OUTPUT_ROUTES.indexOf(record.route) === -1) {
        return false;
      }

      // Positive evidence that the transport replaced the payload: both of
      // hapi's own keys are in the flash. Without this the rule would label
      // any mismatch on these four routes.
      if (!FILE_OUTPUT_PAYLOAD_KEYS.every(function(key) {
        return record.flashKeys.indexOf(key) !== -1;
      })) {
        return false;
      }

      // Every unexpected key is either one of hapi's or a declared leaf of
      // this section, reported required because the transport did not deliver
      // it.
      extrasExplained = record.extra.every(function(key) {
        return FILE_OUTPUT_PAYLOAD_KEYS.indexOf(key) !== -1 ||
          record.leafKeys.indexOf(key) !== -1;
      });

      // A path the proof predicted for a body that was never delivered is
      // absent, which is this mechanism. A MISSING key that is one of hapi's
      // own would mean the block dropped something it did receive - a defect,
      // and not this mechanism.
      missingIsTransportKey = record.missing.some(function(key) {
        return FILE_OUTPUT_PAYLOAD_KEYS.indexOf(key) !== -1;
      });

      return extrasExplained && !missingIsTransportKey;
    }
  })
]);

/**
 * Builds the descriptor a rule is evaluated against.
 *
 * Everything it holds is read from the artifact, so the audit is a pure
 * function of a recorded matrix and runs identically on a fresh capture and on
 * a matrix read off disk.
 *
 * @param {Object} target The target entry.
 * @param {Object} entry The case.
 * @param {string} mode 'html' or 'json'.
 * @param {Object} outcome The recorded outcome.
 * @param {string[]} siblingSections The other sections this route declares.
 * @returns {Object} The mismatch descriptor.
 */
function describeMismatch(target, entry, mode, outcome, siblingSections) {
  var flashKeys = Object.keys(outcome.validationFlash || {}).sort();
  var proofPaths = ((entry.schema && entry.schema.paths) || []).slice().sort();

  return {
    target     : target.key,
    route      : target.method + ' ' + target.path,
    section    : target.section,
    kind       : entry.kind,
    mode       : mode,
    transport  : entry.transport,
    status     : outcome.status,
    flashKeys  : flashKeys,
    proofPaths : proofPaths,
    // In the flash but not in the proof.
    extra      : flashKeys.filter(function(key) {
      return proofPaths.indexOf(key) === -1;
    }),
    // In the proof but not in the flash.
    missing    : proofPaths.filter(function(key) {
      return flashKeys.indexOf(key) === -1;
    }),
    leafKeys   : ((target.leaves || []).map(function(leaf) {
      return leaf.key;
    })).concat([INJECTED_UNKNOWN_KEY]),
    siblingSections : siblingSections
  };
}

/**
 * Classifies one mismatch, or returns null.
 *
 * The FIRST matching rule wins and the id is recorded, so a reader of the
 * artifact sees which mechanism was claimed rather than that "a rule matched".
 *
 * @param {Object} record From describeMismatch.
 * @returns {(string|null)} The rule id, or null when nothing explains it.
 */
function classifyProofMismatch(record) {
  var i;

  for (i = 0; i < PROOF_MISMATCH_RULES.length; i++) {
    if (PROOF_MISMATCH_RULES[i].matches(record)) {
      return PROOF_MISMATCH_RULES[i].id;
    }
  }

  return null;
}

/**
 * Audits every recorded outcome-proof mismatch in a matrix.
 *
 * A PURE FUNCTION OF THE ARTIFACT. It reads `flashMatchesProof` as recorded and
 * never recomputes it, so it can be run on the committed baseline, on a fresh
 * capture and on a matrix handed to `--compare` offline, and it says the same
 * thing about the same bytes.
 *
 * @param {Object} matrix A matrix written by this tool.
 * @param {string} label Which matrix this is, for the report.
 * @returns {Object} The audit record.
 */
function auditProofMismatches(matrix, label) {
  var sectionsByRoute = {};
  var records = [];
  var outcomes = 0;
  var byRule = {};
  var audit;

  PROOF_MISMATCH_RULES.forEach(function(rule) {
    byRule[rule.id] = 0;
  });

  (matrix.targets || []).forEach(function(target) {
    var route = target.method + ' ' + target.path;

    sectionsByRoute[route] = (sectionsByRoute[route] || []).concat([
      target.section
    ]);
  });

  (matrix.targets || []).forEach(function(target) {
    var route = target.method + ' ' + target.path;
    var siblings = (sectionsByRoute[route] || []).filter(function(section) {
      return section !== target.section;
    });

    (target.cases || []).forEach(function(entry) {
      MODES.forEach(function(mode) {
        var outcome = entry.http && entry.http[mode];
        var record;

        if (!outcome) {
          return;
        }

        outcomes += 1;

        if (outcome.flashMatchesProof !== false) {
          return;
        }

        record = describeMismatch(target, entry, mode, outcome, siblings);
        record.rule = classifyProofMismatch(record);

        if (record.rule) {
          byRule[record.rule] += 1;
        }

        records.push(record);
      });
    });
  });

  audit = {
    matrix              : label,
    outcomesExamined    : outcomes,
    mismatches          : records.length,
    classified          : records.filter(function(record) {
      return !!record.rule;
    }).length,
    unclassified        : records.filter(function(record) {
      return !record.rule;
    }),
    byRule              : PROOF_MISMATCH_RULES.map(function(rule) {
      return { id : rule.id, matched : byRule[rule.id], reason : rule.reason };
    }),
    // A rule that explains nothing is only meaningful once there is something
    // to explain, and the quantity that decides that is the number of
    // MISMATCHES - not the number of outcomes driven.
    //
    // The two come apart whenever the run is clean. Because the matrix follows
    // a `fail.redirect` to the rendered page and reads the validation flash off
    // it, the local proof can match every comparable outcome and leave no
    // mismatch at all - and keyed on `outcomes > 0` a clean matrix would fail
    // this gate with both rules reported as explaining nothing.
    //
    // The safeguard still fires where it is aimed: if a mismatch appears and no
    // declared rule explains it, that rule set is reported. `--schema-only` is
    // covered too, because a run that records no outcome records no mismatch
    // either.
    rulesChecked        : records.length > 0,
    rulesMatchingNothing: records.length > 0
      ? PROOF_MISMATCH_RULES.filter(function(rule) {
          return byRule[rule.id] === 0;
        }).map(function(rule) { return rule.id; })
      : [],
    // Kept so a reader can see the classification per mismatch without
    // re-deriving it, and so a diff of two audits is readable.
    classifications     : records.map(function(record) {
      return {
        target  : record.target,
        kind    : record.kind,
        mode    : record.mode,
        extra   : record.extra,
        missing : record.missing,
        rule    : record.rule
      };
    })
  };

  return audit;
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

  ['reached', 'unreached', 'unresolved', 'rejectingCases'].forEach(function(field) {
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

  // The timeout LIST, not the count. `summary.drivesTimedOut` being equal
  // proves nothing: a timeout that moved from one route to another leaves the
  // count alone, and a route that stopped answering on one side only is a
  // behavioural difference of exactly the kind this gate exists to catch. The
  // reviewed reason travels inside the entry, so a timeout whose review was
  // removed on one side also reports here.
  if (canonical(baseline.timeouts) !== canonical(target.timeouts)) {
    difference('summary', { target: 'timeouts' }, 'timeouts',
      baseline.timeouts, target.timeouts);
  }

  if (canonical(baseline.inertness) !== canonical(target.inertness)) {
    // The whole inertness record, compared as one value. The raw joi message is
    // inside it and is identical on both joi lines, so a difference here is
    // either a changed joi message or a `language` map that started firing, and
    // both must be read in full rather than as one field.
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
 * The symbolic label for an artifact this run consumed or produced.
 *
 * RULE-F33: a delivered artifact recorded `/tmp/blitzy/scratch/<uuid>/w-023/...`
 * for four of its own files, which names one agent's clone and tells a reader
 * outside it nothing. `pathLabel` reduces a path in the tool's own repository
 * to `tool:<relative>` and anything else - a scratch destination, the sibling
 * of a report under /tmp - to `ephemeral:<basename>`, which is the whole of
 * what is reproducible about it.
 *
 * @param {(string|null)} target
 * @returns {(string|null)}
 */
function artifactLabel(target) {
  return provenance.pathLabel(target, { toolRoot: TOOL_ROOT });
}

/**
 * The report's entry for a sidecar, whether or not one exists.
 *
 * A sidecar is a run output: a committed recording carries its provenance
 * embedded and has none beside it. So the link is recorded as absent rather
 * than omitted - an omitted key reads as an oversight, while `path: null` with
 * its reason states the design.
 *
 * @param {(string|null)} target The sidecar path, or null when there is none.
 * @returns {{path: (string|null), digest: (string|null),
 *            note: (string|undefined)}}
 */
function sidecarLink(target) {
  if (!target || !fs.existsSync(target)) {
    return {
      path  : null,
      digest: null,
      note  : 'no sidecar beside this recording. A sidecar is a run output; ' +
        'the recording authenticates itself from the provenance block ' +
        'embedded under its own `provenance` key, whose payload digest this ' +
        'gate recomputed before consuming it.'
    };
  }

  return {
    path  : artifactLabel(target),
    digest: artifactDigest(fs.readFileSync(target, 'utf8'))
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
 * @param {Object} baselineRecord From readRecording.
 * @param {Object} targetRecord From readRecording.
 * @param {Object} comparability From assertComparable.
 * @returns {Object} The report, for writing beside the comparison.
 */
function reportComparison(result, baselineRecord, targetRecord, comparability) {
  var byScope = {};
  var report;

  result.differences.forEach(function(entry) {
    byScope[entry.scope] = (byScope[entry.scope] || 0) + 1;
  });

  report = {
    generator      : 'test/parity/joi-matrix.js',
    comparedAt     : new Date().toISOString(),
    baseline       : artifactLabel(baselineRecord.path),
    target         : artifactLabel(targetRecord.path),
    // Every artifact this comparison consumed or produced, named AND hash-linked
    // (SCR-F50, TST-40). Four files, so a reviewer can establish that the report
    // in front of them describes those exact bytes rather than four files that
    // happened to carry those names: the baseline recording, its sidecar, the
    // target matrix, and the target matrix's own sidecar - which sits beside
    // the matrix, not beside this report.
    //
    // The baseline is linked by `payloadDigest` as well as by `digest` for the
    // reason RECORD_INTO_KEYS gives: embedding this comparison back into the
    // recording changes its bytes, and a link that could not survive that would
    // make the committed two-sided evidence impossible.
    artifacts      : {
      baselineMatrix : {
        path         : artifactLabel(baselineRecord.path),
        role         : baselineRecord.matrix.role,
        digest       : baselineRecord.digest,
        payloadDigest: baselineRecord.payloadDigest,
        sealedDigest : baselineRecord.sealedDigest,
        carriesEmbeddedComparison : baselineRecord.embedded,
        appHead      : comparability.baselineHead,
        joiVersion   : comparability.baselineJoi
      },
      // A run output, so most recordings have none and the entry says so
      // rather than being absent: a reader who finds `path: null` knows the
      // recording authenticated itself from its embedded block, which is the
      // normal case for a committed artifact.
      baselineSidecar : sidecarLink(baselineRecord.sidecarPath),
      baselineTool : comparability.baselineTool,
      targetMatrix : {
        path         : artifactLabel(targetRecord.path),
        role         : targetRecord.matrix.role,
        digest       : targetRecord.digest,
        payloadDigest: targetRecord.payloadDigest,
        appHead      : comparability.targetHead,
        joiVersion   : comparability.targetJoi
      },
      targetSidecar : sidecarLink(targetRecord.sidecarPath),
      targetTool : comparability.targetTool,
      // Stated rather than left to a reader to compare two hex strings. The
      // crossCheck is what would FAIL on a tool whose input generation moved
      // between the two sides; this says whether that risk was even present.
      // Compared on the generator BLOB, which identifies the bytes that ran:
      // two clones at the same commit agree on it, and an uncommitted edit on
      // one side does not.
      oneToolDroveBothSides :
        !!(comparability.baselineTool && comparability.baselineTool.blob) &&
        comparability.baselineTool.blob ===
          (comparability.targetTool || {}).blob
    },
    // Which side-of-the-gate checks ran, and which - if any - were waived. A
    // report with a non-empty `relaxed` list is a determinism or negative
    // control and is not two-tree parity evidence; saying so here is what stops
    // it being read as one.
    comparability  : {
      checked : comparability.checked,
      relaxed : comparability.relaxed,
      note    : comparability.relaxed.length
        ? 'RELAXED by --allow-same-tree: ' + comparability.relaxed.join(', ') +
          '. This report is a determinism or negative control, NOT evidence ' +
          'of 17-against-18 parity.'
        : 'The two sides are distinct files, from distinct application HEADs, ' +
          'produced by distinct joi majors. No check was waived.'
    },
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


/**
 * Collects every process warning raised while `body` runs.
 *
 * The gate this run has to satisfy is that it emits no warning attributable to
 * the application's own source or to a retained dependency, and reading that
 * off a terminal is not evidence. It matters here in particular because
 * proving the parser deletes `validate` loads the whole controller graph, so
 * whatever that graph pulls in can raise a notice inside this process.
 *
 * The listener is ADDED, not substituted: Node's own handler still prints, so
 * nothing is suppressed and a warning stays as visible as it was. It is removed
 * in a `finally` so a caller that requires this module does not inherit it.
 * Origin frames are kept, because the frame that raised a warning is what
 * decides whether it belongs to this file or to a dependency.
 *
 * `--pending-deprecation` matters: a pending deprecation is silent without it,
 * so a run that lacks the flag can capture nothing and still be honest about
 * what it measured - which is why warning-policy.js makes the flags a
 * precondition rather than a preference.
 *
 * @param {function(): Promise<*>} body
 * @returns {Promise<{value: *, warnings: Array<Object>}>}
 */
async function captureProcessWarnings(body) {
  var warnings = [];
  var value;

  function onWarning(warning) {
    var frames = ((warning && warning.stack) || '')
      .split('\n')
      .filter(function(line) { return /^\s+at /.test(line); })
      .map(function(line) { return line.trim(); })
      // Node's own frames are dropped, and not for brevity: a flagged
      // deprecation is RAISED inside node, so keeping those frames would
      // attribute every such warning to Node and hide the module that called
      // the deprecated API.
      .filter(function(line) {
        return !/^at node:/.test(line) && !/\(node:/.test(line);
      });

    warnings.push({
      name    : warning && warning.name,
      code    : warning && warning.code,
      message : warning && warning.message,
      origin  : frames.slice(0, 3)
    });
  }

  process.on('warning', onWarning);

  try {
    value = await body();
  }
  finally {
    // DRAINED BEFORE THE LISTENER COMES OFF. `process.emitWarning` schedules
    // the emission rather than calling listeners synchronously, so a warning
    // raised in the body's final microtask is still queued when the body's
    // promise resolves - and removing the listener in the same turn was
    // measured to lose exactly that one: it printed on stderr while `warnings`
    // came back empty and the gate passed. Two turns, because the first drains
    // what is pending and the second drains whatever that scheduled. Inside
    // the `finally` so a rejecting body's last warning is captured too; the
    // drain cannot change the outcome, because the rejection continues to
    // propagate after it.
    await drainWarningQueue();
    process.removeListener('warning', onWarning);
  }

  return { value : value, warnings : warnings };
}

/**
 * Gives already-scheduled warning events their turn.
 *
 * @returns {Promise<undefined>}
 */
async function drainWarningQueue() {
  await new Promise(function(resolve) { setImmediate(resolve); });
  await new Promise(function(resolve) { setImmediate(resolve); });

  return undefined;
}

// Installed at most once per process, for the same reason the storage harness
// installs one: `run` is exported and a caller may invoke it twice.
var lateWarningGuardInstalled = false;

/**
 * Keeps a warning raised AFTER the capture window from being lost.
 *
 * The capture closes when the matrix is built, and everything after it -
 * comparing, reporting, writing the artifacts - can still raise one. Such a
 * warning cannot be folded into a gate that already exists, so it decides the
 * exit code instead: this tool exits 0 only when nothing it was built to detect
 * was detected, and a warning after finalization was still detected. Additive,
 * so Node's own handler still prints it.
 *
 * @returns {undefined}
 */
function guardLateWarnings() {
  if (lateWarningGuardInstalled) {
    return undefined;
  }

  lateWarningGuardInstalled = true;

  process.on('warning', function(warning) {
    note('GATE FAILURE [warning] (' +
      ((warning && warning.code) || (warning && warning.name) || 'warning') +
      ') ' + (warning && warning.message) + '. It was raised after this run ' +
      'assembled its gate, so it could not be folded into it; the exit code ' +
      'is forced to ' + EXIT_ERROR + ' instead.');

    process.exitCode = EXIT_ERROR;
  });

  return undefined;
}

/**
 * Attributes a captured warning to the code that raised it.
 *
 * A warning from this tool's own source is a defect in this file; one from a
 * dependency is a finding about that dependency. Distinguishing them
 * mechanically is what makes "this tool contributes no warning of its own" an
 * assertion rather than a claim.
 *
 * @param {Object} warning From captureProcessWarnings.
 * @returns {string} 'harness', 'dependency' or 'unknown'
 */
function attributeWarning(warning) {
  var origin = (warning.origin || []).join(' ');

  if (origin.indexOf('node_modules') !== -1) {
    return 'dependency';
  }

  if (/test[\/\\]parity|[\/\\]lib[\/\\]|app\.js/.test(origin)) {
    return 'harness';
  }

  return 'unknown';
}

/**
 * Attributes each captured warning, for the artifact.
 *
 * @param {Array<Object>} warnings
 * @returns {Array<Object>}
 */
function describeWarnings(warnings) {
  return (warnings || []).map(function(warning) {
    warning.attribution = attributeWarning(warning);
    return warning;
  });
}


// ---------------------------------------------------------------------------
// THE EXIT PREDICATE
// ---------------------------------------------------------------------------
// ONE FAILURE SET, ASSEMBLED ONCE, READ ONCE. `runCapture` and `runCompare`
// both feed the same predicate, and every mode derives its code from
// `deriveExitCode(gate)` alone - so a captured process warning and an
// unexplained outcome-proof mismatch reach the exit code by the same route a
// parity difference does. The kinds:
//
//   warning            a process warning was captured. Unconditional: no
//                      warning is approved and there is no allowance list
//   proof-mismatch     a recorded outcome-proof mismatch that no declared rule
//                      explains
//   rule-unmatched     a declared rule that explained NOTHING, so the rule set
//                      is describing behaviour that is no longer there
//   difference         a parity difference from the comparison
//   only-in-baseline / a target present in one matrix and not the other
//   only-in-target
//   invariant          a deferred behavioural assertion: the inert `language`
//                      maps stopped being inert, the flash-follow proof failed,
//                      or a case reported itself undrivable with no reviewed
//                      reason
//   teardown           a stop, disconnect or removal did not complete, so the
//                      run may have left a live connection, a live process or a
//                      leftover behind. OPERATIONAL: a leaked connection is
//                      "the gate could not be run cleanly", not "the gate found
//                      a parity difference", so it answers 2
//   operational        the gate could not run. Together with `teardown` these
//                      are the only kinds that answer 2; everything else
//                      answers 1, so a caller can still tell "the gate found
//                      something" from "the gate could not run"
//
// EVERY ARTIFACT IS WRITTEN BEFORE THE PREDICATE IS READ. The matrix, its
// provenance sidecar and the comparison report are on disk first, and every
// stderr note is kept, so a non-zero code always arrives with the evidence for
// it.

/**
 * Assembles the verdict from everything a mode observed.
 *
 * @param {Object} input
 * @param {Array<Object>} [input.warnings] Attributed captured warnings.
 * @param {Array<Object>} [input.audits] Proof-mismatch audits, one per matrix.
 * @param {Object} [input.comparison] A compareMatrices result.
 * @param {Error} [input.deferred] A deferred behavioural failure.
 * @param {Array<Object>} [input.cleanup] Teardown operations that did not
 *   complete, as `{operation, message}` from `teardownFailures`.
 * @returns {{passed: boolean, failures: Array<Object>, counts: Object}}
 */
function buildGate(input) {
  var failures = [];
  var counts = { total : 0 };

  (input.cleanup || []).forEach(function (entry) {
    failures.push({
      kind        : 'teardown',
      subject     : 'teardown: could not ' + entry.operation,
      detail      : entry.message + '. The artifacts above are complete - the ' +
                    'teardown runs after the matrix is built and before it is ' +
                    'written - but this process may have left a live ' +
                    'connection, a live process or a data directory behind, ' +
                    'so the run cannot be reported as clean.',
      owner       : 'test/parity/joi-matrix.js',
      operational : true
    });
  });

  (input.warnings || []).forEach(function(warning) {
    failures.push({
      kind        : 'warning',
      subject     : (warning.code || warning.name || 'warning') +
                    ' from the ' + warning.attribution,
      detail      : warning.message + ' (' +
                    ((warning.origin && warning.origin[0]) || 'origin unknown') +
                    ')',
      owner       : warning.attribution === 'dependency'
        ? 'docs/dependency-inventory.md'
        : 'test/parity/joi-matrix.js',
      operational : false
    });
  });

  // THE ZERO-WARNING GATE'S OWN VERDICT, folded into this failure set rather
  // than returned separately by `runCapture`/`runCompare`. It can fail for
  // reasons a captured warning cannot express - the measurement flags not in
  // force, or an application stderr that could not be read - and a run with no
  // qualifying evidence must not report a clean stream. Not operational: it is
  // a statement about the tree under test, which is EXIT_DIFFERENCE.
  //
  // A notice raised inside THIS process is also in `input.warnings` above, so
  // `fromWarningGate` marks these for anyone reading the two sets together.
  if (input.warningGate && input.warningGate.ok === false) {
    (input.warningGate.failures || []).forEach(function(failure) {
      failures.push({
        kind            : 'warning-gate',
        subject         : 'the zero-warning gate (' +
                          ((input.warningGate.policy || {}).id || 'policy') +
                          ')',
        detail          : String(failure),
        owner           : 'the tree under test',
        operational     : false,
        fromWarningGate : true
      });
    });

    // ok === false with nothing named would otherwise pass silently.
    if (!(input.warningGate.failures || []).length) {
      failures.push({
        kind            : 'warning-gate',
        subject         : 'the zero-warning gate',
        detail          : 'the gate reported not-ok without naming a failure',
        owner           : 'test/parity/joi-matrix.js',
        operational     : false,
        fromWarningGate : true
      });
    }
  }

  // A --record-into the run REFUSED to honour: the caller asked for the
  // canonical recording to be updated and it was not, which is the gate having
  // run and answered "not evidence".
  (input.recordingRefusals || []).forEach(function(reason) {
    failures.push({
      kind        : 'record-into-refused',
      subject     : 'the canonical recording was not updated',
      detail      : String(reason),
      owner       : 'test/parity/joi-matrix.js',
      operational : false
    });
  });

  (input.audits || []).forEach(function(audit) {
    audit.unclassified.forEach(function(record) {
      failures.push({
        kind        : 'proof-mismatch',
        subject     : audit.matrix + ' ' + record.target + ' ' + record.kind +
                      ' [' + record.mode + ']',
        detail      : 'the validation flash does not carry the paths the local ' +
                      'schema proof reported and no declared rule explains it: ' +
                      'extra ' + JSON.stringify(record.extra) + ', missing ' +
                      JSON.stringify(record.missing) + '. Either the ' +
                      'application changed or a new mechanism is at work; ' +
                      'resolve it explicitly and name it in ' +
                      'PROOF_MISMATCH_RULES.',
        owner       : 'test/parity/joi-matrix.js',
        operational : false
      });
    });

    audit.rulesMatchingNothing.forEach(function(id) {
      failures.push({
        kind        : 'rule-unmatched',
        subject     : audit.matrix + ' rule `' + id + '` matched nothing',
        detail      : 'a declared mismatch rule explained none of the ' +
                      audit.mismatches + ' mismatch(es) in a matrix that ' +
                      'recorded ' + audit.outcomesExamined + ' outcome(s). ' +
                      'Another rule explained them, so the behaviour this one ' +
                      'describes is gone: remove it, or find out what changed.',
        owner       : 'test/parity/joi-matrix.js',
        operational : false
      });
    });
  });

  if (input.comparison) {
    input.comparison.differences.forEach(function(entry) {
      failures.push({
        kind        : 'difference',
        subject     : '[' + entry.scope + '] ' + entry.target +
                      (entry.case ? ' ' + entry.case : '') +
                      (entry.mode ? ' [' + entry.mode + ']' : '') + ' ' +
                      entry.field,
        detail      : 'baseline ' + canonical(entry.baseline) + ' vs target ' +
                      canonical(entry.targetValue),
        owner       : 'the tree under test',
        operational : false
      });
    });

    input.comparison.onlyInBaseline.forEach(function(key) {
      failures.push({
        kind        : 'only-in-baseline',
        subject     : key,
        detail      : 'the target matrix has no such target',
        owner       : 'the tree under test',
        operational : false
      });
    });

    input.comparison.onlyInTarget.forEach(function(key) {
      failures.push({
        kind        : 'only-in-target',
        subject     : key,
        detail      : 'the baseline matrix has no such target',
        owner       : 'the tree under test',
        operational : false
      });
    });
  }

  if (input.deferred) {
    // A ToolError here means the gate could not run; a ParityError means it ran
    // and the invariant failed. The distinction is the whole reason this tool
    // has two non-zero codes.
    failures.push({
      kind        : input.deferred instanceof ToolError
        ? 'operational'
        : 'invariant',
      subject     : input.deferred instanceof ToolError
        ? 'the gate could not complete'
        : 'a behavioural invariant failed',
      detail      : (input.deferred && input.deferred.message) ||
                    String(input.deferred),
      owner       : 'the tree under test',
      operational : input.deferred instanceof ToolError
    });
  }

  failures.forEach(function(entry) {
    counts[entry.kind] = (counts[entry.kind] || 0) + 1;
    counts.total += 1;
  });

  return { passed : failures.length === 0, failures : failures, counts : counts };
}

/**
 * The single derivation of an exit code from a verdict.
 *
 * @param {Object} gate From buildGate.
 * @returns {number} EXIT_OK, EXIT_DIFFERENCE or EXIT_ERROR.
 */
function deriveExitCode(gate) {
  if (gate.passed) {
    return EXIT_OK;
  }

  return gate.failures.some(function(entry) {
    return entry.operational;
  })
    ? EXIT_ERROR
    : EXIT_DIFFERENCE;
}

/**
 * Reports the verdict on stderr. Every failure is named, never counted.
 *
 * @param {Object} gate
 * @returns {undefined}
 */
function reportGate(gate) {
  if (gate.passed) {
    note('gate PASSED: no captured warning, no unexplained outcome-proof ' +
      'mismatch, no unmatched rule, no parity difference, no failed ' +
      'invariant and no failed teardown');
    return undefined;
  }

  gate.failures.forEach(function(entry) {
    note('GATE FAILURE [' + entry.kind + '] (' + entry.owner + ') ' +
      entry.subject + ': ' + entry.detail);
  });

  note('gate FAILED: ' + gate.counts.total + ' failure(s) - ' +
    Object.keys(gate.counts).filter(function(key) {
      return key !== 'total';
    }).sort().map(function(key) {
      return key + '=' + gate.counts[key];
    }).join(' '));

  return undefined;
}

/**
 * A captured warning, reduced to what a committed artifact may carry.
 *
 * A notice's `origin` is a stack, and every frame in it is an absolute path
 * into the node_modules of whichever worktree raised it - so recording the
 * warnings verbatim would put `/tmp/.../w-029/baseline-2f8712a/node_modules/
 * iconv-lite/lib/extend-node.js:10:46` into the delivered evidence, which is
 * one clone's topology and tells a reader outside it nothing (RULE-F33). The
 * MESSAGE is the finding and is kept; each frame goes through the contract's
 * `portableText`, which substitutes a symbolic label for the path and a marker
 * for any instant, leaving a frame that still names the module and the line and
 * is identical on the next run.
 *
 * The live warning objects are NOT modified: the gate's own stderr lines quote
 * the real path, because an operator reading a failure wants the file they can
 * open. Only what is written into the artifact is reduced.
 *
 * @param {Array<Object>} warnings Attributed captured warnings.
 * @param {(string|null)} appRoot The tree under test, for the labels.
 * @returns {Array<Object>} Copies, safe to commit.
 */
function portableWarnings(warnings, appRoot) {
  var bounds = { toolRoot: TOOL_ROOT, analysedRoot: appRoot || undefined };

  return (warnings || []).map(function(warning) {
    var copy = {};

    Object.keys(warning).forEach(function(key) {
      var value = warning[key];

      if (typeof value === 'string') {
        copy[key] = provenance.portableText(value, bounds);
        return;
      }

      if (Array.isArray(value)) {
        copy[key] = value.map(function(entry) {
          return typeof entry === 'string'
            ? provenance.portableText(entry, bounds)
            : entry;
        });
        return;
      }

      copy[key] = value;
    });

    return copy;
  });
}

/**
 * Records the warnings and the proof-mismatch audit onto a matrix, and reports
 * the audit.
 *
 * Called before the matrix is written, so the artifact carries the audit that
 * the verdict is about to be derived from - the evidence and the verdict are
 * never out of step.
 *
 * @param {Object} matrix The artifact.
 * @param {Array<Object>} warnings Attributed captured warnings.
 * @param {string} label Which matrix this is.
 * @param {(string|null|undefined)} appRoot The tree under test, so the
 *   recorded warnings can be reduced to portable frames.
 * @returns {Object} The audit.
 */
function annotateMatrix(matrix, warnings, label, appRoot) {
  var audit = auditProofMismatches(matrix, label);

  matrix.warnings = portableWarnings(warnings, appRoot);
  matrix.proofMismatches = audit;
  matrix.summary.proofMismatches = audit.mismatches;
  matrix.summary.proofMismatchesUnclassified = audit.unclassified.length;

  note('outcome-proof mismatches in the ' + label + ' matrix: ' +
    audit.mismatches + ' of ' + audit.outcomesExamined + ' outcome(s), ' +
    audit.classified + ' classified (' +
    audit.byRule.map(function(rule) {
      return rule.id + '=' + rule.matched;
    }).join(', ') + '), ' + audit.unclassified.length + ' unclassified');

  return audit;
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
 * does the target joi accept and reject exactly what the baseline joi accepted
 * and rejected, given the same bytes.
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
  var resolved = null;
  var crossCheck = null;
  var proofs;
  var context = null;
  var drives = null;
  var flashFollow = null;
  var flashProofs = null;
  var validationReach = null;
  var timeouts = null;
  var inertness;
  var fieldCoverage = null;
  var matchers;
  var deferred = null;
  var tree;
  var role;
  var provenanceInput;

  assertAppRoot(options.appRoot);

  // THE BASELINE CHECK, BEFORE ANYTHING IS LAUNCHED. A capture pointed at the
  // wrong worktree produces an artifact indistinguishable from a baseline
  // capture, and checking it after the run means checking it only once a
  // database has been provisioned, an application started and every case
  // driven. `resolveRole` throws here, before publishDatabaseAddress, so a
  // mis-aimed capture costs nothing and says what to do about it.
  tree = provenance.treeIdentity(options.appRoot);
  role = resolveRole(options, mode, tree);

  note('analysed tree ' + (tree.headShort || 'not a checkout') +
    (tree.subject ? ' (' + tree.subject + ')' : '') + ', worktree ' +
    tree.worktreeState + '; this artifact is recorded as `' + role + '`' +
    (role === 'unreviewed'
      ? ' and DOES NOT QUALIFY as gate evidence (--allow-nonbaseline)'
      : ''));

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
  // Resolved in EVERY mode, `--schema-only` included, for the same reason the
  // fixture ids are: the known values are part of the generated INPUT, so a
  // matrix built without a database must produce byte-identical inputs to one
  // built with it or the two artifacts could not be compared.
  resolved    = knownValues(loaded, options.appRoot, fixtureSeed());

  assertEnumeration(enumeration, maps);

  deepCopyProof = buildDeepCopyProof(loaded, enumeration);

  note('enumerated ' + enumeration.targets + ' target(s): ' +
    enumeration.payload + ' payload, ' + enumeration.query + ' query, ' +
    enumeration.params + ' params, plus ' + enumeration.languageMaps +
    ' language map(s); joi ' + (packageVersion(options.appRoot, 'joi') || '?') +
    ' from ' + options.appRoot);

  // The GET declarations, needed to resolve each target's `fail.redirect` to
  // the template that renders the flash. Built once: the scan reads template
  // files and there are 102 targets. Available in EVERY mode, `--schema-only`
  // included, because the steering it feeds decides the generated inputs and
  // two artifacts whose inputs differ cannot be compared.
  matchers = getRouteMatchers(loaded);

  entries = targets.map(function(target) {
    var built = buildCases(loaded.joi, target, resolved, {
      matchers: matchers,
      appRoot : options.appRoot
    });

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

  // Before the drives, because `driveCase` compares the observed flash against
  // it, and in every mode, because it is derived from the inputs and the
  // declarations and is compared per case.
  attachFlashProofs(entries, loaded, pathValues(fixtureSeed()));

  proofs = assertCaseProofs(entries);

  if (wantsHttp) {
    context = await startInfrastructure(options, database);
    drives  = await driveAll(context, entries);
    validationReach = buildValidationReach(entries);
    timeouts = buildTimeouts(drives.timeouts);

    note('validation reach: ' + validationReach.reached + ' of ' +
      validationReach.rejectingCases + ' rejecting case(s) reached the ' +
      'validation block; ' + validationReach.unresolved +
      ' unresolved, ' + (validationReach.unreached -
        validationReach.unresolved) + ' reviewed as unreachable');
    note('state restores: ' + drives.restores + ' before ' +
      drives.restores + ' non-GET drive(s); crashes: ' +
      drives.crashes.length);
    note('drives that never answered: ' + timeouts.count + ' within ' +
      timeouts.budgetMs + 'ms, ' + timeouts.unresolved.length +
      ' of them unreviewed');
  }

  inertness = buildInertnessRecord(entries, maps);

  if (wantsHttp) {
    flashProofs = summarizeFlashProofs(entries);
    flashFollow = buildFlashFollow(entries, loaded, options.appRoot);

    note('flash-follow proof: ' + flashFollow.rendered + ' of ' +
      flashFollow.applicable + ' applicable case(s) rendered a validation ' +
      'message on a followed page, across ' + flashFollow.candidates +
      ' fail.redirect drive(s)');
  }

  // The BEHAVIOURAL assertions are COMPUTED above and RAISED below, and the
  // artifact is written either way. An assertion failure is a finding about the
  // application, and the artifact is the evidence FOR that finding: a gate that
  // wrote nothing when it failed would leave a reader to re-run it blind. The
  // caller writes the artifact and then raises this.
  //
  // Every assertion runs even when an earlier one has already failed, and the
  // failures are reported together. One run that names all of them is worth
  // three runs that each name the first.
  deferred = collectAssertions([
    function() {
      // First, because it is about the artifact's own integrity as evidence
      // and holds in every mode: a field nothing compares is not evidence,
      // whether or not any HTTP was driven.
      fieldCoverage = assertFieldCoverage(entries, wantsHttp);
    },
    function() {
      if (wantsHttp) {
        assertEvidence(drives, validationReach, timeouts);
      }
    },
    function() {
      if (wantsHttp) {
        assertFlashFollow(flashFollow);
      }
    },
    function() {
      if (wantsHttp) {
        assertFlashProofs(entries);
      }
    },
    function() {
      assertInertness(inertness);

      note('inertness: ' + inertness.map(function(entry) {
        return entry.route + ' -> ' +
          (entry.customSubstituted ? 'SUBSTITUTED' : 'raw joi message');
      }).join('; '));
    }
  ]);

  // Every application stderr this run produced, handed to the warning gate.
  // Recorded here rather than in the HTTP layer so that a run which threw
  // part-way through still accounts the streams it had already opened.
  if (context !== null) {
    recordWarningStreams(context.stderrPaths);
  }

  // ONE description of the run, read twice: once by buildProvenance, which
  // keeps only what the repository can reproduce, and once by buildRunOutput,
  // which keeps the rest for the sidecar. Composed here rather than twice at
  // the two call sites, because two copies of this object drifting apart is
  // how the block and the sidecar came to disagree about which run they
  // described.
  // SCR-F49: `databaseAlignment` carries the agreed address and what it was
  // agreed across, so a reviewer can see that the application, the seeder and
  // this process named ONE database - and not merely that no error was raised.
  // The block keeps the agreement and drops the address; the sidecar keeps
  // both.
  provenanceInput = {
    mode                : mode,
    artifact            : artifactName(options, mode),
    role                : role,
    appRoot             : options.appRoot,
    environment         : environment,
    recaptchaConfigured : recaptchaConfigured(options.appRoot),
    server              : context === null ? null : context.server,
    seedSummary         : context === null ? null : context.seedSummary,
    databaseAlignment   : database.alignment === undefined
      ? null
      : database.alignment
  };

  return {
    deferred : deferred,
    artifact : buildArtifact({
      generator       : 'test/parity/joi-matrix.js',
      version         : ARTIFACT_SCHEMA_VERSION,
      artifactVersion : 1,
      schema          : ARTIFACT_SCHEMA,
      // The role decided by the TREE, above, and not by the flag that ran. It
      // used to come from a `roleFor(mode)` that read the mode alone, so a
      // capture pointed anywhere at all produced an artifact labelled as the
      // recorded baseline; `resolveRole` has already refused that case before
      // a database was provisioned, and this is the same value it returned.
      role            : role,
      mode            : mode,
      joiVersion      : packageVersion(options.appRoot, 'joi'),
      notes           : artifactNotes(options, mode),
      summary         : buildSummary({
        enumeration     : enumeration,
        proofs          : proofs,
        drives          : drives,
        timeouts        : timeouts,
        flashFollow     : flashFollow,
        flashProofs     : flashProofs,
        validationReach : validationReach,
        fieldCoverage   : fieldCoverage
      }),
      enumeration     : enumeration,
      deepCopyProof   : deepCopyProof,
      orderPolicy     : ORDER_POLICY,
      restorePolicy   : wantsHttp ? RESTORE_POLICY : null,
      knownValues     : resolved,
      preconditions   : context === null ? null : context.preconditions,
      databaseAlignment : database.alignment === undefined
        ? null
        : database.alignment,
      languageMaps    : maps,
      inertness       : inertness,
      validationReach : validationReach,
      crashes         : drives === null ? null : drives.crashes,
      timeouts        : timeouts,
      flashFollow     : flashFollow,
      crossCheck      : crossCheck,
      targetComparison: null,
      targets         : entries
    }),
    provenance : buildProvenance(provenanceInput),
    // The sidecar's half: the warning-gate verdict and this run's own
    // addressing, neither of which may reach a committed artifact. See
    // buildRunOutput.
    runOutput  : buildRunOutput(provenanceInput),
    crossCheck : crossCheck
  };
}

// ---------------------------------------------------------------------------
// The zero-warning gate
// ---------------------------------------------------------------------------

/**
 * Installs the in-process notice collector.
 *
 * Called before anything is dispatched, because the harvest requires every
 * controller into THIS process, which is where a dependency's own module-load
 * notices arrive; a collector installed afterwards would miss exactly those.
 *
 * BOTH collectors are used - the process-warning listener AND the stderr tee -
 * because either alone has a hole. The listener never sees a notice printed
 * through `console.warn`, which is how Mongoose emits its deprecations and how
 * a dependency loaded during the harvest would emit its own; the tee sees
 * everything printed, including this file's unprefixed progress prose. That
 * second problem is what `note` solves by writing inside the policy's
 * `harnessOutput` scope, which the tee skips: the output is unchanged, only the
 * collector's view of it is.
 *
 * @returns {undefined}
 */
function beginWarningGate() {
  if (warningEvidence.collector) {
    return undefined;
  }

  warningEvidence.collector = warningPolicy.createCollector({ tee: true });
  warningEvidence.streams   = [];

  return undefined;
}

/**
 * Records the application stderr files a run produced.
 *
 * @param {Array.<string>} paths
 * @returns {undefined}
 */
function recordWarningStreams(paths) {
  (paths || []).forEach(function(entry) {
    if (entry && warningEvidence.streams.indexOf(entry) === -1) {
      warningEvidence.streams.push(entry);
    }
  });

  return undefined;
}

/**
 * Closes the collector, folds in every application stream, and judges the run.
 *
 * Idempotent, and safe when nothing was installed - the two-file offline
 * comparison loads no application code and produces no stream, and it judges
 * clean because there was nothing to emit.
 *
 * A stream that cannot be READ is a failure, not a skip. It was a skip, and
 * that was fail-open: the remaining streams could then judge clean while an
 * unread one held the only notice of the run. So the read failure becomes a
 * requirement this gate cannot meet, named per stream.
 *
 * @param {(string|null)} [appRoot] The tree under test, for the policy's
 *   foreign-tree rule.
 * @returns {Promise<Object>} the check document from the shared policy
 */
async function finishWarningGate(appRoot) {
  var collector = warningEvidence.collector ||
    warningPolicy.createCollector({ tee: false });
  var tree = warningPolicy.gateAppliesTo(appRoot || null);
  var unreadable = [];
  var notices;

  warningEvidence.streams.forEach(function(target) {
    var text;

    try {
      text = fs.readFileSync(target, 'utf8');
    }
    catch (err) {
      unreadable.push(target + ' (' +
        (err && err.message ? err.message : String(err)) + ')');
      return;
    }

    collector.ingest(text, target);
  });

  // Delivered warnings first: Node hands an emitWarning over on a later turn
  // and a dependency can schedule one on a timer - the retained AWS SDK v2
  // emits its NOTE from a zero-delay timer - so closing synchronously here
  // would report a clean run and then let the notice print after the verdict.
  await warningPolicy.drainPendingWarnings();

  notices = collector.close();
  warningEvidence.collector = null;

  return warningPolicy.judge({
    notices     : notices,
    flags       : warningPolicy.processFlagAudit(),
    subject     : 'this harness\'s process and the application child\'s stderr',
    gateApplies : tree.applies,
    treeNote    : tree.treeNote,
    requirements: unreadable.map(function(target, index) {
      return warningPolicy.requirement('readable-stream-' + (index + 1), false,
        'the application stderr at ' + target + ' could not be read, so the ' +
        'notices in it are unaccounted and this run cannot claim a clean ' +
        'stream');
    })
  });
}

/**
 * The gate's record for the run-output sidecar, and its lines on stderr.
 *
 * The record goes in the SIDECAR and never in the artifact, for two
 * independent reasons. The artifact is diffed field-for-field against the
 * baseline recording, and a baseline install legitimately emits the AWS SDK v2
 * notice that only the target's config/aws.js suppresses, so a warning record
 * inside it would manufacture a validation-parity difference out of a warning
 * difference. And `streams` names the absolute paths of the stderr files this
 * run read - precisely the host state a committed block may not carry - so it
 * belongs to `buildRunOutput`'s record and not to the provenance block, whose
 * portability guard would refuse it.
 *
 * @param {Object} runOutput The record `buildRunOutput` produced.
 * @param {Object} judged The check document from `finishWarningGate`.
 * @returns {Object} the same record, with the gate recorded on it
 */
function recordWarningGate(runOutput, judged) {
  judged.failures.forEach(function(failure) {
    note('WARNING GATE: ' + failure);
  });

  // A measurement of another worktree prints what it saw and does not fail on
  // it, because the baseline's notices are the comparison's other half and a
  // measurement nobody reads is not one.
  if (judged.gateApplies === false) {
    note('WARNING GATE: measurement only - ' + judged.notices.length +
      ' notice(s) from the tree under test, which is not this worktree, so ' +
      'they are recorded rather than failed');
    judged.notices.forEach(function(notice) {
      note('  measured: ' + notice.summary);
    });
  }

  if (runOutput) {
    runOutput.warningGate = {
      policy      : judged.policy.id,
      flags       : judged.flags,
      gateApplies : judged.gateApplies,
      ok          : judged.ok,
      qualifying  : judged.qualifying,
      streams     : warningEvidence.streams.slice(),
      requirements: judged.requirements,
      notices     : judged.notices,
      failures    : judged.failures
    };
  }

  return runOutput;
}

/**
 * The destination inside PARITY_ARTIFACT_DIR, or null when none was named.
 *
 * A convenience, never a repository default: the directory has to be set by
 * the caller, and the basenames are the committed artifacts' own so a file in
 * that directory is still recognisable as the same evidence.
 *
 * @param {string} mode The run mode, which decides which artifact this is.
 * @returns {(string|null)}
 */
function artifactDirDestination(mode) {
  var configured = process.env[ARTIFACT_DIR_ENV];

  if (typeof configured !== 'string' || !configured.trim()) {
    return null;
  }

  return path.resolve(configured.trim(), mode === 'compare'
    ? ARTIFACT_NAMES.comparison
    : ARTIFACT_NAMES.baseline);
}

/**
 * Resolves and guards `--out`, and every path derived from it.
 *
 * Two refusals, both about the same hazard. `COMMITTED_BASELINE` is
 * test/parity/joi-baseline.json, the committed baseline recording, so a default
 * output path pointing there means a bare `--capture` overwrites the
 * repository's only copy of the evidence with a run against whatever tree
 * happens to be current. A caller's care cannot fix a destructive default:
 *
 *  - `--out` is REQUIRED. There is no default output path, so no invocation can
 *    write an artifact the caller did not name.
 *  - an existing file is NOT overwritten without `--overwrite`, applied to the
 *    artifact, its sidecar, and - in comparison mode - the target matrix and
 *    its sidecar, because a run that clobbers three of those four and stops is
 *    worse than one that refuses.
 *
 * `COMMITTED_BASELINE` is retained and still names the committed artifact: it is what
 * the refusal message points at, and what `--record-into` is for.
 *
 * @param {Object} options Parsed arguments.
 * @param {string} mode
 * @returns {string} The absolute artifact path.
 * @throws {ToolError} If `--out` is absent, or a target exists without
 *   `--overwrite`.
 */
function resolveOut(options, mode) {
  var out = options.out;
  var derived;

  // The one destination this tool will invent, and it is outside the
  // repository: a caller who named a scratch directory has already said where
  // run artifacts go, and honouring it is what keeps the USAGE text true.
  if (out === null) {
    out = artifactDirDestination(mode);
  }

  if (out === null) {
    throw new ToolError('--out is required. This tool has no default output ' +
      'path on purpose: it used to default to ' + COMMITTED_BASELINE + ', which is ' +
      'the COMMITTED baseline recording named by AAP §0.6.2, so a bare run ' +
      'overwrote the repository\'s evidence. Name the file you mean; to ' +
      'update the committed recording with a completed comparison, use ' +
      '--record-into ' + COMMITTED_BASELINE + ' --overwrite.');
  }

  // In comparison mode `<out>` is the REPORT, which carries its provenance
  // inline in its `artifacts` block and so has no sidecar of its own; the
  // sidecar belongs to the matrix at `<out>.target.json`.
  derived = mode === 'compare'
    ? [out, targetMatrixPathFor(out),
       sidecarPathFor(targetMatrixPathFor(out))]
    : [out, sidecarPathFor(out)];

  if (!options.overwrite) {
    derived.forEach(function(candidate) {
      if (fs.existsSync(candidate)) {
        throw new ToolError('refusing to overwrite the existing file ' +
          candidate + '. This run would write ' + derived.join(', ') +
          '; pass --overwrite to replace them, or choose an --out that does ' +
          'not exist.');
      }
    });
  }

  return out;
}

/**
 * Writes a completed comparison back into the baseline recording it was about.
 *
 * This is what makes the COMMITTED artifact two-sided evidence rather than one
 * side of a gate that was never closed. The committed file stays the baseline
 * recording - `--compare` replays the inputs it records - and gains two things
 * it could not have carried at capture time: `targetComparison`, the completed
 * baseline-against-target result with its counts, its per-scope difference
 * breakdown, its hash links and the target run's own summary figures; and
 * `crossCheck`, the real replay/divergence record, which is produced by the
 * replay and therefore belongs to the comparison rather than to the capture.
 *
 * Three refusals, because an embedding that could attach the wrong comparison
 * would be worse than none:
 *
 *  - the recording must verify against its own sidecar, through the same
 *    readRecording every comparison uses;
 *  - it must have role `baseline-capture`;
 *  - the report's `artifacts.baselineMatrix.payloadDigest` must equal the
 *    recording's payload digest. That is the hash link, and it is what
 *    establishes that this comparison is about THESE bytes.
 *
 * The re-seal then asserts what RECORD_INTO_KEYS promises: the payload digest
 * is unchanged by the embedding. If that ever failed, every report that linked
 * the baseline by payload digest would have been silently invalidated, so it is
 * checked rather than assumed.
 *
 * @param {string} recordingPath Absolute path of the baseline recording.
 * @param {Object} report The comparison report.
 * @param {string} reportText Its exact serialized bytes.
 * @param {string} reportPath Where the report was written.
 * @param {Object} targetRecord From readRecording, for the target's figures.
 * @returns {undefined}
 * @throws {ToolError} On a recording that cannot carry this comparison.
 */
function recordComparisonInto(recordingPath, report, reportText, reportPath,
                              targetRecord) {
  var record = readRecording(recordingPath, 'record-into');
  var matrix = record.matrix;
  var block = record.provenance;
  var targetMatrix = targetRecord.matrix;
  var summary = targetMatrix.summary || {};
  var digests;
  var sealed;

  if (matrix.role !== ROLE_BASELINE || matrix.mode !== 'capture') {
    throw new ToolError('refusing to record a comparison into ' +
      recordingPath + ': its role is ' + JSON.stringify(matrix.role) +
      ' and its mode ' + JSON.stringify(matrix.mode) + ', and only a ' +
      ROLE_BASELINE + ' recording produced in `capture` mode is one side of ' +
      'this gate');
  }

  if (report.artifacts.baselineMatrix.payloadDigest !== record.payloadDigest) {
    throw new ToolError('refusing to record a comparison into ' +
      recordingPath + ': the report links a baseline whose payload digest is ' +
      report.artifacts.baselineMatrix.payloadDigest.slice(0, 16) +
      '..., and this file\'s is ' + record.payloadDigest.slice(0, 16) +
      '.... The comparison is not about this recording.');
  }

  matrix.targetComparison = {
    performed  : true,
    comparedAt : report.comparedAt,
    generator  : 'test/parity/joi-matrix.js',
    verdict    : report.differences.length || report.onlyInBaseline.length ||
      report.onlyInTarget.length
      ? 'DIFFERENCES FOUND - see `differences`; this recording is NOT parity ' +
        'evidence'
      : 'Accept/reject parity HOLDS across every target, every case and both ' +
        'Accept modes. joi ' + report.artifacts.baselineMatrix.joiVersion +
        ' and joi ' + report.artifacts.targetMatrix.joiVersion +
        ' accepted and rejected the same bytes with the same messages, and ' +
        'the application answered identically.',
    // Both sides, named by tree and by version, so the artifact alone says what
    // was compared with what.
    baseline   : {
      role         : report.artifacts.baselineMatrix.role,
      appHead      : report.artifacts.baselineMatrix.appHead,
      joiVersion   : report.artifacts.baselineMatrix.joiVersion,
      path         : report.artifacts.baselineMatrix.path,
      payloadDigest: report.artifacts.baselineMatrix.payloadDigest
    },
    target     : {
      role          : report.artifacts.targetMatrix.role,
      appHead       : report.artifacts.targetMatrix.appHead,
      joiVersion    : report.artifacts.targetMatrix.joiVersion,
      matrixPath    : report.artifacts.targetMatrix.path,
      matrixDigest  : report.artifacts.targetMatrix.digest,
      sidecarPath   : report.artifacts.targetSidecar.path,
      sidecarDigest : report.artifacts.targetSidecar.digest,
      // A label, like every other address this artifact records: the report a
      // comparison was written to is normally a scratch destination, and its
      // directory is the run's own machine state. The DIGEST is what
      // identifies it.
      reportPath    : artifactLabel(reportPath),
      reportDigest  : artifactDigest(reportText)
    },
    comparability : report.comparability,
    // Which tool build drove each side, and whether it was one build. The
    // crossCheck is the substantive guard - a tool whose input generation moved
    // shows up there as a divergence, per case - so this is here to be READ:
    // `dirty: true` on a side means the commit named does not contain the tool
    // that produced it, which is the difference between a provenance record and
    // a label.
    tooling       : {
      baseline : report.artifacts.baselineTool,
      target   : report.artifacts.targetTool,
      oneToolDroveBothSides : report.artifacts.oneToolDroveBothSides
    },
    // Where the top-level `crossCheck` on this recording came from, stated
    // rather than left for a reader to infer from a null. A live `--compare`
    // replays this recording's inputs and so produces one; an offline
    // comparison of two recordings replays nothing and honestly has none.
    replaySource  : targetMatrix.crossCheck === null
      ? 'NONE - the target side of this comparison was a recording, not a ' +
        'live replay, so no inputs were re-generated and `crossCheck` is null. ' +
        'Only a single-argument --compare against a running application ' +
        'produces a replay record.'
      : 'The live --compare replay named in `target`: this recording\'s ' +
        'inputs were re-generated and re-proved against that tree\'s joi, and ' +
        'the result is on this artifact\'s top-level `crossCheck`.',
    compared      : report.compared,
    differencesByScope        : report.differencesByScope,
    schemaLevelDifferences    : report.schemaLevelDifferences,
    generatedInputDifferences : report.generatedInputDifferences,
    differences    : report.differences,
    onlyInBaseline : report.onlyInBaseline,
    onlyInTarget   : report.onlyInTarget,
    // The target run's own behavioural figures. Not a comparison - the
    // comparison above already covers every case - but the evidence that the
    // target side satisfied the same invariants the baseline side did, which is
    // what makes a zero-difference result mean parity rather than two equally
    // contaminated runs.
    targetSummary  : {
      drives              : summary.drives,
      drivesTimedOut      : summary.drivesTimedOut,
      // The count above says how many drives never answered; this says how
      // many of them were unaccounted for, which is the figure the assertion
      // is about. A zero-difference comparison already proves the two lists
      // are the same list, and this makes the target side's compliance
      // readable without opening the target matrix.
      timeoutsUnreviewed  : summary.timeoutsUnreviewed,
      applicationCrashes  : summary.applicationCrashes,
      applicationRestarts : summary.applicationRestarts,
      stateRestores       : summary.stateRestores,
      rejectingReached    : summary.rejectingReached,
      rejectingUnreached  : summary.rejectingUnreached,
      rejectingUnresolved : summary.rejectingUnresolved,
      flashProofMismatches: summary.flashProofMismatches,
      unexpectedFlashes   : summary.unexpectedFlashes,
      applicableFollows   : summary.applicableFollows,
      renderedFollows     : summary.renderedFollows
    },
    notCompared    : report.notCompared
  };

  // The replay record, which is produced BY the comparison and so cannot exist
  // in a fresh capture. Carried here with its origin named, because a reader
  // finding a cross-check on a capture is entitled to ask where it came from.
  matrix.crossCheck = targetMatrix.crossCheck === null ? null : {
    origin      : 'the target replay recorded in `targetComparison`; the ' +
      'recorded inputs of THIS file, re-generated and re-proved against joi ' +
      (report.artifacts.targetMatrix.joiVersion || 'unrecorded') +
      ' in the tree at ' +
      (report.artifacts.targetMatrix.appHead || 'unrecorded'),
    replayed    : targetMatrix.crossCheck.replayed,
    divergences : targetMatrix.crossCheck.divergences,
    missing     : targetMatrix.crossCheck.missing
  };

  // The RECORD_INTO-stable link, checked before anything is written. Computed
  // over the artifact WITHOUT its embedded block, so the re-attachment below
  // cannot move it and this assertion is about the embedding alone.
  digests = artifactDigests(serialize(matrix));

  if (digests.payloadDigest !== record.payloadDigest) {
    throw new ToolError('embedding the comparison changed ' + recordingPath +
      '\'s payload digest, from ' + record.payloadDigest.slice(0, 16) +
      '... to ' + digests.payloadDigest.slice(0, 16) + '.... That must be ' +
      'impossible - payloadDigest is defined over the artifact with ' +
      RECORD_INTO_KEYS.join(' and ') + ' nulled and its `provenance` block ' +
      'removed, and those are the only keys this writes - so either the key ' +
      'set or the digest definition has drifted and every report linking a ' +
      'baseline by payload digest is now unverifiable. Fix RECORD_INTO_KEYS ' +
      'before writing.');
  }

  // What the embedding did, recorded IN the block that travels with the
  // artifact rather than only in a sidecar that need not exist. Portable by
  // construction: the report and the target matrix are named by digest and by
  // symbolic label, and `keys` says exactly which fields were written after
  // the capture - which is the fact a reader of a two-sided recording needs.
  // The wall clock the sidecar used to carry is gone; `comparedAt` on the
  // embedded `targetComparison` beside it is the comparison's own record of
  // when it ran.
  block.detail = block.detail || {};
  block.detail.comparisonEmbedded = {
    keys          : RECORD_INTO_KEYS.slice(),
    report        : artifactLabel(reportPath),
    reportDigest  : artifactDigest(reportText),
    targetMatrix  : report.artifacts.targetMatrix.path,
    targetDigest  : report.artifacts.targetMatrix.digest,
    note          : 'The capture itself is unchanged: the RECORD_INTO-stable ' +
      'payload digest is identical before and after this embedding, and is ' +
      'what a comparison report links this recording by. The block\'s own ' +
      '`payloadDigest` has been recomputed over the artifact as it now ' +
      'stands, so the recording still authenticates itself.'
  };

  try {
    provenance.assertPortable(block, 'provenance');
  }
  catch (err) {
    throw asToolError(err);
  }

  // Re-attach and re-seal over the new bytes. The re-attachment is what keeps
  // the recording self-authenticating: the contract's payload digest covers
  // the artifact INCLUDING the comparison, so leaving the pre-embed digest in
  // place would deliver a recording that fails its own seal.
  sealed = sealRecording(recordingPath, matrix, block, null);

  note('recorded the completed comparison into ' + recordingPath +
    ' (sha256 ' + sealed.digests.digest.slice(0, 16) + '..., ' +
    'RECORD_INTO-stable payload digest unchanged at ' +
    sealed.digests.payloadDigest.slice(0, 16) + '...)');
}

/**
 * The behavioural invariants a RECORDING must satisfy to be parity evidence.
 *
 * assertEvidence enforces these on a run as it happens, from live objects. This
 * enforces the same facts on a recording read back from disk, which is a
 * different question and was not being asked: `--compare` verified the
 * baseline's digest, its role and its tree, and then compared against it
 * without ever checking that the recording itself was a clean run. A baseline
 * captured through a crash, or with an unreviewed reach gap, is not made
 * evidence by matching its sidecar.
 *
 * Reported as a list rather than thrown, so a caller can decide: a comparison
 * still RUNS against a flawed recording and reports what it found, but nothing
 * flawed may become canonical (see qualifyForRecording).
 *
 * @param {Object} matrix A matrix read by readRecording.
 * @param {string} label 'baseline' or 'target'.
 * @returns {string[]} One message per violated invariant; empty when clean.
 */
function recordingEvidenceFaults(matrix, label) {
  var summary = matrix.summary || {};
  var reach = matrix.validationReach || {};
  var flash = matrix.flashFollow || {};
  var faults = [];

  if (Array.isArray(matrix.crashes) && matrix.crashes.length) {
    faults.push(label + ' recording was captured through ' +
      matrix.crashes.length + ' application crash(es)');
  }

  if (reach.unresolved) {
    faults.push(label + ' recording has ' + reach.unresolved +
      ' rejecting case(s) that never reached the validation block with no ' +
      'reviewed reason');
  }

  if (matrix.timeouts && matrix.timeouts.unresolved &&
      matrix.timeouts.unresolved.length) {
    faults.push(label + ' recording has ' +
      matrix.timeouts.unresolved.length + ' unreviewed timeout(s): ' +
      matrix.timeouts.unresolved.join(', '));
  }

  if (summary.flashProofMismatches) {
    faults.push(label + ' recording has ' + summary.flashProofMismatches +
      ' outcome(s) whose validation flash did not match the whole-block proof');
  }

  if (Array.isArray(flash.unrendered) && flash.unrendered.length) {
    faults.push(label + ' recording has ' + flash.unrendered.length +
      ' applicable case(s) that rendered no validation message');
  }

  return faults;
}

/**
 * Whether a completed comparison may be written into the canonical recording.
 *
 * `--record-into` MUTATES the committed baseline, so the question is not "did
 * the comparison run" but "is this result eligible to become the project's
 * evidence". Eligibility is decided BEFORE the write: a run whose target failed
 * a fatal invariant, or one relaxed by --allow-same-tree and therefore not
 * two-tree parity evidence, would otherwise seal a `HOLDS` verdict into the
 * recording and exit non-zero beside it - and the artifact is what outlives the
 * run.
 *
 * @param {Object} input {result, comparability, deferred, baselineRecord,
 *   targetMatrix, live}
 * @returns {string[]} One message per reason it does not qualify; empty when
 *   it does.
 */
function qualifyForRecording(input) {
  var reasons = [];

  if (input.result.differences.length) {
    reasons.push(input.result.differences.length + ' comparison difference(s)');
  }

  if (input.result.onlyInBaseline.length || input.result.onlyInTarget.length) {
    reasons.push((input.result.onlyInBaseline.length +
      input.result.onlyInTarget.length) + ' target(s) present on one side only');
  }

  if (input.comparability.relaxed.length) {
    reasons.push('--allow-same-tree relaxed ' +
      input.comparability.relaxed.join(' and ') + ', so this is a determinism ' +
      'or negative control rather than two-tree parity evidence');
  }

  if (input.deferred) {
    reasons.push('the target run failed a behavioural invariant: ' +
      (input.deferred.message || String(input.deferred)).split('\n')[0]);
  }

  if (!input.live) {
    reasons.push('the target side was a RECORDING rather than a live replay, ' +
      'so no inputs were re-generated and no `crossCheck` exists; the ' +
      'recording would claim a replay it did not have');
  }

  recordingEvidenceFaults(input.baselineRecord.matrix, 'the baseline')
    .forEach(function(fault) {
      reasons.push(fault);
    });

  recordingEvidenceFaults(input.targetMatrix, 'the target')
    .forEach(function(fault) {
      reasons.push(fault);
    });

  return reasons;
}

/**
 * The target matrix path for a comparison report.
 *
 * The matrix a live `--compare` drove is written beside the report as
 * `<out>.target.json`, and its sidecar is `<out>.target.json.provenance.json` -
 * that is, the sibling of the MATRIX and not of the report. A sidecar at
 * `<out>.provenance.json` would sit beside the report while describing the
 * matrix, leaving a reader unable to tell which file the digest, the role and
 * the joi version belong to.
 *
 * @param {string} out The report path.
 * @returns {string}
 */
function targetMatrixPathFor(out) {
  return out + '.target.json';
}

/**
 * `--capture` and `--schema-only`.
 *
 * @param {Object} options Parsed arguments.
 * @returns {Promise<number>} An exit code.
 */
async function runCapture(options) {
  var out = resolveOut(options, options.mode);
  var built;
  var text;
  var judged;
  var sealed;
  var captured;
  var built;
  var audit;
  var warnings;
  var gate;

  resetTeardownFailures();

  // Checked BEFORE the matrix is built, which takes a database and a server:
  // a refusal a caller cannot avoid should arrive in the first second, not
  // after the whole capture has run.
  assertOverwritable(out, options);

  // The warning capture wraps the phase that loads and drives the application,
  // which is the only phase that can raise one: `harvest` requires every
  // controller and the drive runs the server as a child of this process.
  captured = await captureProcessWarnings(async function() {
    try {
      return await buildMatrix(options, options.mode, null);
    }
    finally {
      await teardown();
    }
  });

  // Installed as soon as the capture window closes, so a warning raised while
  // the artifacts are written cannot slip between the two.
  guardLateWarnings();

  built    = captured.value;
  warnings = describeWarnings(captured.warnings);
  audit    = annotateMatrix(built.artifact, warnings, 'target',
    options.appRoot);

  // Judged after teardown, so the application's stderr is complete, and
  // before the artifacts are sealed, so the verdict travels in the sidecar.
  judged = await finishWarningGate(options.appRoot);

  recordWarningGate(built.runOutput, judged);

  sealed = sealRecording(out, built.artifact, built.provenance,
    built.runOutput);

  note('wrote ' + sealed.artifactPath + ' (' + sealed.digests.bytes +
    ' bytes, sha256 ' + sealed.digests.digest.slice(0, 16) +
    '..., provenance embedded)');
  note('wrote ' + sealed.sidecarPath + ' (RUN OUTPUT, not part of the ' +
    'delivery: role ' + built.artifact.role + ', RECORD_INTO-stable payload ' +
    'sha256 ' + sealed.digests.payloadDigest.slice(0, 16) + '...)');

  // THE VERDICT, derived only now - after the artifact that evidences it is on
  // disk. The deferred behavioural failure is folded in rather than thrown, so
  // there is one predicate and not two.
  gate = buildGate({
    warnings : warnings,
    audits   : [audit],
    // OURS' zero-warning verdict, so `deriveExitCode` stays the only place an
    // exit code is derived.
    warningGate : judged,
    deferred : built.deferred,
    // Read after `teardown()` has run - it is in the `finally` of the captured
    // phase above - and after the artifact is on disk, so a failed teardown
    // arrives with its evidence rather than instead of it.
    cleanup  : teardownFailures
  });

  reportGate(gate);

  return deriveExitCode(gate);
}

/**
 * `--compare`.
 *
 * With one path the recorded inputs are replayed against the tree under test
 * and the result is compared with the recording. With two, two recordings are
 * compared offline - which is also how the negative control is run: perturb one
 * recorded outcome and this must exit non-zero naming that case.
 *
 * A perturbed recording must be RE-HASHED before it is fed back in, because a
 * recorded matrix is hash-linked to its own provenance and an artifact that
 * does not match its `payloadDigest` is refused as untrustworthy (exit 2)
 * rather than compared. `provenance.attach(matrix, matrix.provenance)` from
 * test/parity/manifest.js recomputes the link over the perturbed payload,
 * leaving the tree identity intact, and the comparison then reports the
 * perturbed case as a difference (exit 1) - which is what the negative control
 * is asserting.
 *
 * @param {Object} options Parsed arguments.
 * @returns {Promise<number>} An exit code.
 */
async function runCompare(options) {
  var out = resolveOut(options, 'compare');
  assertComparisonDestination(out, options);

  var baselineRecord = readRecording(options.compare[0], 'baseline');
  var baseline = baselineRecord.matrix;
  var targetRecord;
  var targetMatrix;
  var targetPath;
  var sealedTarget;
  var comparability;
  var captured;
  var built;
  var warnings = [];
  var audits;
  var result;
  var report;
  var judged;
  var reportText;
  var baselineFaults;
  var disqualified = [];
  var gate;

  resetTeardownFailures();

  note('baseline ' + baselineRecord.path + ' authenticated against its ' +
    'embedded provenance: role ' + baseline.role + ', joi ' +
    (joiVersionOf(baselineRecord) || 'unrecorded') + ', app HEAD ' +
    ((analysedHeadOf(baselineRecord) || 'unrecorded').slice(0, 12)) +
    ', payload digest matched' + (baselineRecord.embedded
      ? ' (and it carries a completed comparison)'
      : '') + (baselineRecord.sidecarPath === null
      ? ''
      : '; the sidecar beside it was reconciled too'));

  if (options.compare.length === 2) {
    // Offline: both sides are recordings, so both are verified the same way.
    targetRecord = readRecording(options.compare[1], 'target');
    targetMatrix = targetRecord.matrix;
    targetPath   = targetRecord.path;
    judged       = await finishWarningGate(options.appRoot);
  }
  else {
    // As in runCapture: the capture wraps the phase that loads and drives the
    // application. An offline two-matrix comparison loads no application and
    // reads two files, so there is nothing there that could warn.
    captured = await captureProcessWarnings(async function() {
      try {
        return await buildMatrix(options, 'compare', baseline);
      }
      finally {
        await teardown();
      }
    });

    guardLateWarnings();

    built        = captured.value;
    warnings     = describeWarnings(captured.warnings);
    targetMatrix = built.artifact;
    targetPath   = targetMatrixPathFor(out);

    judged = await finishWarningGate(options.appRoot);

    recordWarningGate(built.runOutput, judged);

    // The audit is recorded ON the matrix BEFORE it is sealed, so the sealed
    // bytes carry the evidence the verdict is derived from - and so the live
    // branch's `audits` entry below, which reads `proofMismatches` off this
    // object, exists at all.
    annotateMatrix(targetMatrix, warnings, 'target', options.appRoot);

    // The matrix with its provenance embedded, and ITS OWN sidecar written as
    // its sibling. See targetMatrixPathFor for why the sibling matters.
    sealedTarget = sealRecording(targetPath, targetMatrix, built.provenance,
      built.runOutput);

    note('wrote ' + sealedTarget.artifactPath + ' (' +
      sealedTarget.digests.bytes + ' bytes, sha256 ' +
      sealedTarget.digests.digest.slice(0, 16) + '..., provenance embedded)');
    note('wrote ' + sealedTarget.sidecarPath + ' (RUN OUTPUT, role ' +
      targetMatrix.role + ', beside the matrix it describes)');

    // Re-read through the same verifier the offline path uses, so the live
    // target is held to exactly the checks a recorded one is - including that
    // what reached disk digests to what was sealed.
    targetRecord = readRecording(targetPath, 'target');
  }

  comparability = assertComparable(baselineRecord, targetRecord,
    options.allowSameTree);

  if (comparability.relaxed.length) {
    note('WARNING: --allow-same-tree relaxed ' +
      comparability.relaxed.join(', ') + '; this run is a determinism or ' +
      'negative control, NOT two-tree parity evidence');
  }

  // BOTH matrices are audited, because a recorded mismatch nobody has resolved
  // is unresolved wherever it sits: the baseline this gate consumes as evidence
  // is subject to the same bar as the matrix it produces. The baseline is
  // audited from its recorded values and is never rewritten.
  audits = [
    auditProofMismatches(baseline, 'baseline'),
    // A live replay has already audited and annotated its own matrix; do not
    // audit the same object twice, or every failure would be reported twice.
    options.compare.length === 2
      ? auditProofMismatches(targetMatrix, 'target')
      : targetMatrix.proofMismatches
  ];

  audits.forEach(function(audit) {
    if (audit.matrix === 'baseline' || options.compare.length === 2) {
      note('outcome-proof mismatches in the ' + audit.matrix + ' matrix: ' +
        audit.mismatches + ' of ' + audit.outcomesExamined + ' outcome(s), ' +
        audit.classified + ' classified, ' + audit.unclassified.length +
        ' unclassified');
    }
  });

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

  report = reportComparison(result, baselineRecord, targetRecord,
    comparability);

  // The audits go into the report so the comparison artifact carries the same
  // evidence the verdict is derived from.
  report.proofMismatches = audits;
  report.warnings = warnings;

  reportText = serialize(report);
  writeArtifact(out, reportText);
  note('wrote ' + out + ' (sha256 ' +
    artifactDigest(reportText).slice(0, 16) + '...)');

  // The baseline's own evidence invariants, checked now that it has been read.
  // Reported whether or not --record-into was asked for: a comparison against a
  // recording captured through a crash is worth running and worth flagging.
  baselineFaults = recordingEvidenceFaults(baselineRecord.matrix,
    'the baseline');

  baselineFaults.forEach(function(fault) {
    note('WARNING: ' + fault + ', so it is not clean parity evidence');
  });

  if (options.recordInto !== null) {
    // QUALIFY BEFORE MUTATING. The canonical recording is only written when the
    // result is eligible to become the project's evidence; otherwise it stays
    // byte-identical and the diagnostic report on disk says why. See
    // qualifyForRecording.
    disqualified = qualifyForRecording({
      result        : result,
      comparability : comparability,
      deferred      : built ? built.deferred : null,
      baselineRecord: baselineRecord,
      targetMatrix  : targetMatrix,
      live          : options.compare.length === 1
    });

    if (disqualified.length) {
      note('REFUSING --record-into ' + options.recordInto + ': this ' +
        'comparison does not qualify as canonical evidence -');
      disqualified.forEach(function(reason) {
        note('  - ' + reason);
      });
      note('the recording is unchanged; ' + out + ' and the target matrix ' +
        'beside it record what was measured.');
    }
    else {
      recordComparisonInto(options.recordInto, report, reportText, out,
        targetRecord);
    }
  }

  // THE VERDICT, after the report is on disk. The deferred behavioural failure
  // is folded in rather than thrown: it is still reported on its own terms -
  // its own kind, its own owner - but the code comes from one predicate.
  gate = buildGate({
    warnings   : warnings,
    audits     : audits,
    comparison : result,
    // OURS' two remaining verdicts, in the same failure set: the zero-warning
    // gate, and a --record-into this run refused to honour.
    warningGate : judged || null,
    recordingRefusals : disqualified,
    deferred   : built ? built.deferred : null,
    // Empty for a two-matrix offline comparison, which starts nothing and
    // therefore tears nothing down.
    cleanup    : teardownFailures
  });

  reportGate(gate);

  return deriveExitCode(gate);
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

  // Before either mode is dispatched: the harvest requires every controller
  // into this process, and a collector installed after that would miss the one
  // notice this run is known to produce.
  beginWarningGate();

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
 * runs, so a relative `--out` resolves against where the caller stood whatever
 * this process does to its own state later.
 *
 * @returns {undefined}
 */
function main() {
  var originalCwd = process.cwd();

  run(process.argv.slice(2), originalCwd)
    .then(function(code) {
      // NEVER LOWERED. `guardLateWarnings` may already have raised the code
      // from its own listener, and this assignment runs afterwards - so an
      // unconditional write would discard the observation it exists for.
      if (code !== EXIT_OK || !process.exitCode) {
        process.exitCode = code;
      }
    })
    .catch(function(err) {
      note('UNEXPECTED FAILURE: ' + (err && err.stack ? err.stack : String(err)));
      process.exitCode = EXIT_ERROR;
    });
}

module.exports = {
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

  // Digests and seals, exported because the negative controls need them.
  // Perturbing a recorded outcome invalidates that recording's own payload
  // digest, so a tampered file is refused for INTEGRITY (exit 2) before the
  // comparator ever sees the changed outcome. Both failure modes must be
  // demonstrable, and they are distinct: re-attach the block over the
  // perturbed payload - `provenance.attach(matrix, matrix.provenance)`, or
  // sealRecording, which does it and writes - and the comparator reports the
  // changed case as a DIFFERENCE (exit 1); leave the block as it was and
  // readRecording refuses the file as modified (exit 2).
  RECORD_INTO_KEYS : RECORD_INTO_KEYS,
  ROLES            : ROLES,
  artifactDigest   : artifactDigest,
  artifactDigests  : artifactDigests,
  sidecarPathFor   : sidecarPathFor,
  targetMatrixPathFor : targetMatrixPathFor,
  sealRecording    : sealRecording,
  readRecording    : readRecording,
  majorOf          : majorOf,
  assertComparable : assertComparable,
  resolveOut       : resolveOut,
  recordComparisonInto : recordComparisonInto,
  // The provenance surface, exported so a harness can drive it WITHOUT a
  // database: every guarantee below is checkable by building a block and
  // reading it back, which is how the provenance findings are evidenced.
  provenance            : provenance,
  buildProvenance       : buildProvenance,
  buildRunOutput        : buildRunOutput,
  resolveRole           : resolveRole,
  artifactName          : artifactName,
  artifactLabel         : artifactLabel,
  sidecarLink           : sidecarLink,
  analysedHeadOf        : analysedHeadOf,
  joiVersionOf          : joiVersionOf,
  generatorIdentityOf   : generatorIdentityOf,
  assertMatrixProvenance: assertMatrixProvenance,
  asToolError           : asToolError,
  parseJsonOrNull       : parseJsonOrNull,
  // The outcome-proof mismatch audit and the verdict, exported for the same
  // reason: a rule set that quietly stopped matching, or a predicate that
  // stopped failing, is invisible in a passing run.
  auditProofMismatches   : auditProofMismatches,
  classifyProofMismatch  : classifyProofMismatch,
  describeMismatch       : describeMismatch,
  PROOF_MISMATCH_RULES   : PROOF_MISMATCH_RULES,
  FILE_OUTPUT_ROUTES     : FILE_OUTPUT_ROUTES,
  FILE_OUTPUT_PAYLOAD_KEYS : FILE_OUTPUT_PAYLOAD_KEYS,
  captureProcessWarnings : captureProcessWarnings,
  attributeWarning       : attributeWarning,
  describeWarnings       : describeWarnings,
  annotateMatrix         : annotateMatrix,
  portableWarnings       : portableWarnings,
  buildGate              : buildGate,
  deriveExitCode         : deriveExitCode,
  reportGate             : reportGate,

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
  fixtureSeed             : fixtureSeed,
  trinketLangEnum         : trinketLangEnum,
  helperResolver          : helperResolver,
  buildZipCode            : buildZipCode,
  buildEmailToken         : buildEmailToken,
  knownValues             : knownValues,
  knownValuesFor          : knownValuesFor,
  applyKnownValues        : applyKnownValues,
  routeSections           : routeSections,
  presentedValue          : presentedValue,
  attachFlashProofs       : attachFlashProofs,
  summarizeFlashProofs    : summarizeFlashProofs,
  assertFlashProofs       : assertFlashProofs,
  renderedValidationFields: renderedValidationFields,
  getRouteMatchers        : getRouteMatchers,
  buildFlashFollow        : buildFlashFollow,
  reviewedUnreachedReason : reviewedUnreachedReason,
  reviewedTimeoutReason   : reviewedTimeoutReason,
  redactMongoUri          : redactMongoUri,
  recordingEvidenceFaults : recordingEvidenceFaults,
  qualifyForRecording     : qualifyForRecording,
  shellArgument           : shellArgument,
  buildTimeouts           : buildTimeouts,
  renderedRedirectFields  : renderedRedirectFields,
  solveRedirect           : solveRedirect,
  assertEvidence          : assertEvidence,
  collectAssertions       : collectAssertions,
  applyPreconditions      : applyPreconditions,
  restoreState            : restoreState,
  invitationModel         : invitationModel,
  artifactNotes           : artifactNotes,
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
  redactSecrets           : redactSecrets,
  recaptchaConfigured     : recaptchaConfigured,
  reportComparison        : reportComparison,
  loadSiblings            : loadSiblings,
  beginWarningGate        : beginWarningGate,
  recordWarningStreams    : recordWarningStreams,
  finishWarningGate       : finishWarningGate,
  recordWarningGate       : recordWarningGate,
  publishDatabaseAddress  : publishDatabaseAddress,
  resolvedDatabaseUri     : resolvedDatabaseUri,
  assertDatabaseAlignment : assertDatabaseAlignment,
  assertServerDatabase    : assertServerDatabase,
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
  REVIEWED_UNREACHED      : REVIEWED_UNREACHED,
  FUNCTION_PRE_CONSUMERS  : FUNCTION_PRE_CONSUMERS,
  HANDLER_ENCODED_LEAVES  : HANDLER_ENCODED_LEAVES,
  INVITATION_FIXTURE      : INVITATION_FIXTURE,
  INVITATION_MODEL        : INVITATION_MODEL,
  ARTIFACT_SCHEMA         : ARTIFACT_SCHEMA,
  ARTIFACT_SCHEMA_VERSION : ARTIFACT_SCHEMA_VERSION,
  ROLE_BASELINE           : ROLE_BASELINE,
  ROLE_TARGET             : ROLE_TARGET,
  ROLE_ANALYSIS           : ROLE_ANALYSIS,
  ROLE_UNREVIEWED         : ROLE_UNREVIEWED,
  ORDER_POLICY            : ORDER_POLICY,
  RESTORE_POLICY          : RESTORE_POLICY,
  ARTIFACT_KEY_ORDER      : ARTIFACT_KEY_ORDER,
  JOIN_FIELDS             : JOIN_FIELDS,
  DRIVE_DEPENDENT_FIELDS  : DRIVE_DEPENDENT_FIELDS,
  ELEMENTWISE_FIELDS      : ELEMENTWISE_FIELDS,
  NOT_COMPARED            : NOT_COMPARED,
  notComparedNote         : notComparedNote,
  assertFieldCoverage     : assertFieldCoverage,
  COMPARED_TARGET_FIELDS  : COMPARED_TARGET_FIELDS,
  COMPARED_CASE_FIELDS    : COMPARED_CASE_FIELDS,
  COMPARED_HTTP_FIELDS    : COMPARED_HTTP_FIELDS,
  DEFAULT_COMPARISON_OUT  : DEFAULT_COMPARISON_OUT,

  // The artifact-destination policy. There is no write default; the committed
  // baseline path is exported so a caller names the same file this tool
  // protects rather than rebuilding the path.
  COMMITTED_BASELINE      : COMMITTED_BASELINE,
  ARTIFACT_DIR_ENV        : ARTIFACT_DIR_ENV,
  ARTIFACT_NAMES          : ARTIFACT_NAMES,
  OVERWRITE_FLAG          : OVERWRITE_FLAG,
  BASELINE_COMMIT         : BASELINE_COMMIT,
  resolveArtifactPath     : resolveArtifactPath,
  assertOverwritable      : assertOverwritable,
  assertComparisonDestination: assertComparisonDestination,
  isMatrixArtifact        : isMatrixArtifact,
  writeArtifact           : writeArtifact,
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
