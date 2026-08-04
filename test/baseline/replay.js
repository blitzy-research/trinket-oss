/**
 * test/baseline/replay.js — the R-6 baseline replay-and-diff CLI.
 *
 * WHAT THIS IS
 * ------------
 * The falsification tool for the whole modernization. test/baseline/capture.js measured the corpus at
 * the base commit; this file re-measures it against whatever the working tree currently is, diffs the
 * two under the artifact's own normalization contract, evaluates every gate the artifacts publish, and
 * reports every difference. It NEVER writes an artifact: the baseline is evidence, and a replay that
 * "fixes" the evidence proves nothing (responses.json#normalizationContract.prohibition).
 *
 * It is a CLI tool and NOT a mocha suite — it contains no describe, no it and no assertion library.
 * The in-suite half of the same contract lives in test/lib/api/route-parity.js, which encodes its
 * expectations directly rather than reading these artifacts as a source of truth at assertion time.
 *
 * It checks three halves of the R-6 parity contract:
 *
 *   1. THE ROUTE TABLE (TR1). The 233 registered routes are canonicalized with the exact recipe
 *      recorded in route-table.json#canonicalization — "METHOD | path | authDescriptor | preCount",
 *      uppercase method, `false` for auth:false, `mode=<mode> strategies=["s1",...]` otherwise, one
 *      ASCII space around every pipe, default Array.prototype.sort(), joined with "\n" and no
 *      trailing newline — and hashed. Three digests are checked: the sorted sha256
 *      (gates.measuredSha256), its md5 companion (gates.measuredMd5) and the registration-order
 *      fingerprint (gates.registrationOrderFingerprint), the last derived independently from
 *      config.routes, which is the array app.js:L306 hands to server.route(). Every countable gate is
 *      recomputed from the live table, the rows are diffed as a keyed set so a regression names the
 *      row rather than only breaking a hash, and documentedAnchorGate() evaluates the Technical
 *      Specification's own published anchor as a MANDATORY pass/fail gate of ten clauses.
 *
 *   2. THE RESPONSE CORPUS (TR2, TR3, TR4). The 58 parameterless GETs, the 7-entry authenticated
 *      supplement and the 8-entry assignment-`next` supplement are re-issued over real HTTP by
 *      capture.js's own helpers, under capture.js's own normalization, and compared field by field:
 *      status, content-type, Set-Cookie name/seal/attributes, the literal Location, isApiRequest,
 *      body shape and the recorded response headers.
 *
 *   3. THE BUILD ARTIFACTS. public/css/base.css at 265,727 bytes, public/css/embed.css at 296,352
 *      bytes, both digests, and zero .css.map files despite vite.config.mjs asking for source maps.
 *      An unbuilt checkout is reported as an UNEVALUATED PRECONDITION, never as a difference.
 *
 * WHY IT REUSES capture.js
 * ------------------------
 * There is exactly ONE boot procedure and ONE request policy under test/baseline/, and both live in
 * capture.js: configureRuntime(), startServer(), stopServer(), httpRequest() and POLICY. This file
 * imports them rather than restating them, because a replay that booted differently or requested
 * differently would produce a diff that proves nothing about the application.
 *
 * The route-table canonicalization is the one deliberate exception, and it is deliberate in both
 * directions: route-table.json#gates.documentedAnchorGate.evaluator names
 * "test/baseline/replay.js#documentedAnchorGate(live, committedTable)" and replay.js#replayRouteTable
 * as its enforcement points, responses.json records that this file "re-derives the route-table
 * canonicalization and both authoritative digests from the LIVE server", capture.js:L1283 states the
 * mirror-image rationale, and test/lib/api/route-parity.js consumes canonicalizeLiveTable(),
 * registrationOrderCanonical(), documentedAnchorGate(), sha256() and DOCUMENTED_DIGEST from here. Two
 * independent derivations checked against one committed digest is stronger evidence than one shared
 * derivation, and they cannot drift silently: driftGates() below compares this file's rows, digests
 * and gate block against capture.captureRouteTable()'s on every run, so a divergence fails the run
 * instead of hiding.
 *
 * HARD CONSTRAINTS, all of them from AAP 0.7.5 and from the artifacts' own captureNotes
 * -------------------------------------------------------------------------------------
 *   1. REAL HTTP ONLY. Every request goes through capture.httpRequest, which uses node:http against
 *      server.info. This harness NEVER calls the framework's in-process injection entry point:
 *      @hapi/shot/lib/request.js:L30 is the last remaining DEP0169 source in the tree and 6.0.3 is the
 *      latest published, so there is no upstream fix, and the zero-deprecation boot gate forbids
 *      tripping it. That is a rule about the HARNESS: the application's own internal sub-requests at
 *      lib/controllers/courses.js and lib/controllers/folders.js still inject, base-identically — see
 *      PRESERVED-QUIRKS section 7.6.
 *   2. RUNTIME CONFIG OVERRIDE, NEVER A FILE EDIT. config/test.yaml:L3 sets app.start:false, so under
 *      NODE_ENV=test the server is built but never bound. app.start:true, the bind host, the port and
 *      the >=32-character session password app.js:L50-L66 demands are injected through NODE_CONFIG by
 *      capture.configureRuntime() before app.js is required. config/test.yaml is not edited and
 *      config/local.yaml is not created: either would change the behavior of the existing mocha suite.
 *   3. REQUIRING THIS FILE IS INERT. The root .mocharc.json declares reporter, recursive, check-leaks
 *      and exit and deliberately no `spec` and no `ignore` key, so mocha's default recursive glob
 *      loads test/baseline/replay.js on every `npm test` — first, in fact (see the bootstrap-order
 *      anchor in test/helpers/catbox-redis.js). Everything executable therefore sits behind the single
 *      main-module guard at the bottom: requiring this module performs no HTTP, requires no app.js,
 *      opens no datastore connection, reads no artifact, writes no file and never exits.
 *   4. THE RECORDED app.url ORIGIN IS REPRODUCED, NOT NORMALIZED AWAY. The corpus is origin-specific
 *      by construction — ten of its sixteen unauthenticated redirects carry an absolute Location and
 *      every rendered page embeds the site origin — so a diff taken under a different origin reports
 *      configuration instead of behavior. capture.corpusOriginOverride() turns the recorded
 *      metadata.appUrlOrigin back into the config.app.url shape and injects it through NODE_CONFIG,
 *      exactly as the port and the password are injected. Nothing in any response is rewritten.
 *
 * USAGE
 *   node test/baseline/replay.js                     full replay; exits 0 only if nothing differs
 *   node test/baseline/replay.js --route-table-only  the route table and its gates only, no HTTP
 *   node test/baseline/replay.js --corpus-only       the HTTP corpus only, no route table
 *   node test/baseline/replay.js --verbose           add the per-entry comparison detail
 *   node test/baseline/replay.js --quiet             suppress PASS gate lines (differences still print)
 *   node test/baseline/replay.js --report <path>     also write the machine-readable diff to <path>
 *
 * EXIT CODES
 *   0  zero normalized differences, zero report-back findings and every evaluable gate PASSED
 *   1  one or more differences, findings or FAILED gates — a parity regression to report
 *   2  the run could not happen or could not finish: a missing or malformed artifact, a request-policy
 *      divergence, a refused --report path, a failed boot, or an exception mid-run. Kept distinct from
 *      1 so a broken environment is never read as a regression, and so an incomplete run is never read
 *      as evidence of parity.
 */

var crypto   = require('crypto'),
    fs       = require('fs'),
    path     = require('path'),
    nodeUtil = require('node:util'),
    capture  = require('./capture');

/**
 * The literal the Technical Specification publishes for the baseline route table (section 0.1.1.3
 * goal G8, section 0.1.2.3 invariant TR1, section 0.7.5). It is hard-coded HERE, in the verifier, so
 * that the artifact cannot quietly substitute one of its own measurements for it: clause 1 of
 * documentedAnchorGate() compares the artifact's stored value against this constant and fails the gate
 * if they ever diverge. test/lib/api/route-parity.js asserts the same literal against this export.
 */
var DOCUMENTED_DIGEST = 'cd2a7e38a39bd84902ac1a0d69f50e2a';

/** The two structural anchors the Specification publishes, used as load-time artifact preconditions. */
var DOCUMENTED_ROW_COUNT   = 233,
    DOCUMENTED_CORPUS_SIZE = 58;

/**
 * The three outcomes, named. `CANNOT_RUN` is the one that matters: it separates "the environment or an
 * artifact is broken, so nothing was proven" from "the application changed", which is the difference
 * between a chore and a regression.
 */
var EXIT = { CLEAN : 0, DIFFERENT : 1, CANNOT_RUN : 2 };

/** Where a --report file may never be written: this folder is capped at exactly four entries. */
var ARTIFACT_DIRECTORY = __dirname;

// ---------------------------------------------------------------------------------------------
// Preconditions — everything that must hold before a diff can mean anything
// ---------------------------------------------------------------------------------------------

/**
 * A precondition failure, marked so main() can map it onto exit code 2 rather than 1. Every message
 * built with this is written for the operator who has to fix it, not for a stack-trace reader.
 */
function preconditionFailure(message) {
  var failure = new Error(message);

  failure.baselinePrecondition = true;

  return failure;
}

function isPreconditionFailure(err) {
  return !!(err && err.baselinePrecondition);
}

/**
 * Structural validation of the two committed artifacts. This is not a parity check — it is the check
 * that a parity check is even possible. The ordering requirement behind it is non-negotiable: a corpus
 * captured after the migration would prove only self-consistency, so a missing or truncated artifact
 * must stop the run with instructions rather than silently replay against whatever is present.
 */
function validateCommittedArtifacts(committedTable, committedCorpus) {
  var problems = [];

  if (!committedTable || !Array.isArray(committedTable.rows) || !committedTable.gates) {
    problems.push('route-table.json is missing its `rows` array or its `gates` block');
  }
  else {
    if (committedTable.rows.length !== DOCUMENTED_ROW_COUNT) {
      problems.push('route-table.json carries ' + committedTable.rows.length + ' rows, not the ' +
                    DOCUMENTED_ROW_COUNT + ' the Technical Specification publishes');
    }

    if (committedTable.gates.rowCount !== committedTable.rows.length) {
      problems.push('route-table.json#gates.rowCount (' + committedTable.gates.rowCount + ') ' +
                    'disagrees with rows.length (' + committedTable.rows.length + ')');
    }

    if (committedTable.gates.documentedDigest !== DOCUMENTED_DIGEST) {
      problems.push('route-table.json#gates.documentedDigest is "' +
                    committedTable.gates.documentedDigest + '", not the published literal "' +
                    DOCUMENTED_DIGEST + '"');
    }

    if (!committedTable.canonicalization || !committedTable.canonicalization.empiricalAuthShape) {
      problems.push('route-table.json is missing canonicalization.empiricalAuthShape');
    }
  }

  if (!committedCorpus || !Array.isArray(committedCorpus.unauthenticated) || !committedCorpus.gates) {
    problems.push('responses.json is missing its `unauthenticated` array or its `gates` block');
  }
  else {
    if (committedCorpus.unauthenticated.length !== DOCUMENTED_CORPUS_SIZE) {
      problems.push('responses.json carries ' + committedCorpus.unauthenticated.length +
                    ' unauthenticated entries, not the ' + DOCUMENTED_CORPUS_SIZE +
                    ' the reproducible selection rule yields');
    }

    if (!Array.isArray(committedCorpus.authenticated)) {
      problems.push('responses.json is missing its `authenticated` supplement');
    }

    if (!committedCorpus.selectionRule || !Array.isArray(committedCorpus.selectionRule.paths)) {
      problems.push('responses.json is missing selectionRule.paths');
    }

    if (!committedCorpus.requestPolicy) {
      problems.push('responses.json is missing its `requestPolicy` block, so the replay cannot prove ' +
                    'it is requesting under the recorded policy');
    }

    if (!committedCorpus.normalizationContract ||
        !committedCorpus.normalizationContract.htmlBodyNormalization) {
      problems.push('responses.json is missing normalizationContract.htmlBodyNormalization, which is ' +
                    'where the HTML normalization rules are read from');
    }

    if (!committedCorpus.metadata || !committedCorpus.metadata.appUrlOrigin) {
      problems.push('responses.json is missing metadata.appUrlOrigin, so the recorded origin cannot ' +
                    'be reproduced');
    }
  }

  if (problems.length) {
    throw preconditionFailure('replay.js: the committed baseline artifacts cannot be replayed.\n  - ' +
                              problems.join('\n  - ') +
                              '\n  Fix: check out the base commit recorded in ' +
                              'responses.json#metadata.baseCommit and run `node test/baseline/' +
                              'capture.js --write` there. A corpus captured after the migration ' +
                              'proves only self-consistency, so replaying against one is not evidence.');
  }
}

/** Reads both artifacts, turning any I/O or JSON error into an operator-facing precondition failure. */
function loadArtifacts() {
  var committedTable,
      committedCorpus;

  try {
    committedTable = capture.loadCommittedRouteTable();
  }
  catch (err) {
    throw preconditionFailure('replay.js: cannot read test/baseline/route-table.json — ' +
                              (err && err.message ? err.message : String(err)) +
                              '. Run `node test/baseline/capture.js --write` on the base commit first.');
  }

  try {
    committedCorpus = capture.loadCommittedCorpus();
  }
  catch (err) {
    throw preconditionFailure('replay.js: cannot read test/baseline/responses.json — ' +
                              (err && err.message ? err.message : String(err)) +
                              '. Run `node test/baseline/capture.js --write` on the base commit first.');
  }

  validateCommittedArtifacts(committedTable, committedCorpus);

  return { table : committedTable, corpus : committedCorpus };
}

/**
 * Every way this harness could request differently from the way the corpus was recorded, checked
 * against responses.json#requestPolicy rather than against a copy of it kept here.
 *
 * Each row is load-bearing, and each would silently invalidate the diff rather than break it:
 *  - an Accept header containing application/json would make app.js:L159-L168's isApiRequest true for
 *    every path and turn the recorded 7x401 into 12x401;
 *  - a different User-Agent changes isMobile and aceOff (routeParser.js:L29-L52), which reach the
 *    templates and therefore the recorded body digests;
 *  - a different referer is a different config.url claim;
 *  - following the first hop would discard the recorded 3xx and its literal Location;
 *  - a different resolution policy changes the resolved reading the documented distribution is taken
 *    from;
 *  - a different throwaway identity changes recorded content-lengths and, through the rendered
 *    fullname, the recorded /home digest.
 */
function requestPolicyMismatches(committedCorpus) {
  var policy    = committedCorpus.requestPolicy,
      headers   = policy.headersSent || {},
      resolution = policy.redirectPolicy || {},
      identity  = (committedCorpus.metadata && committedCorpus.metadata.throwawayUser) || {},
      mismatches = [];

  function check(subject, recorded, harness) {
    if (capture.stableStringify(recorded) !== capture.stableStringify(harness)) {
      mismatches.push(subject + ': artifact records ' + capture.stableStringify(recorded) +
                      ', this harness would send ' + capture.stableStringify(harness));
    }
  }

  check('requestPolicy.acceptHeader', policy.acceptHeader,
        capture.POLICY.accept === undefined ? null : capture.POLICY.accept);
  check('requestPolicy.refererHeader', policy.refererHeader, capture.POLICY.referer);
  check('requestPolicy.userAgent', policy.userAgent, capture.POLICY.userAgent);
  check('requestPolicy.followRedirects', policy.followRedirects, capture.POLICY.followRedirects);
  check('requestPolicy.timeoutMs', policy.timeoutMs, capture.POLICY.timeoutMs);
  check('requestPolicy.headersSent.everyRequest', headers.everyRequest,
        { referer : capture.POLICY.referer, 'user-agent' : capture.POLICY.userAgent });
  check('requestPolicy.redirectPolicy.follow', resolution.follow, capture.RESOLUTION.follow);
  check('requestPolicy.redirectPolicy.maxHops', resolution.maxHops, capture.RESOLUTION.maxHops);

  if (Array.isArray(headers.notSent) && headers.notSent.indexOf('accept') !== -1 &&
      capture.POLICY.accept !== undefined) {
    mismatches.push('requestPolicy.headersSent.notSent lists "accept", but this harness would send ' +
                    'one: ' + capture.stableStringify(capture.POLICY.accept));
  }

  check('metadata.throwawayUser.email', identity.email, capture.THROWAWAY.email);
  check('metadata.throwawayUser.username', identity.username, capture.THROWAWAY.username);
  check('metadata.throwawayUser.fullname', identity.fullname, capture.THROWAWAY.fullname);
  check('metadata.throwawayUser.passwordLength', identity.passwordLength,
        capture.THROWAWAY.password.length);

  if (typeof identity.passwordLength === 'number' && typeof identity.invalidPasswordSuffix === 'string') {
    check('metadata.throwawayUser invalid-password length',
          identity.passwordLength + identity.invalidPasswordSuffix.length,
          capture.THROWAWAY.wrongPassword.length);
  }

  return mismatches;
}

/** Aborts rather than replaying under a policy the corpus was not recorded under. */
function assertRequestPolicyConformance(committedCorpus) {
  var mismatches = requestPolicyMismatches(committedCorpus);

  if (mismatches.length) {
    throw preconditionFailure('replay.js: this harness would not request the way the corpus was ' +
                              'recorded, so a diff would compare policies rather than behavior.\n  - ' +
                              mismatches.join('\n  - ') +
                              '\n  Fix: reconcile test/baseline/capture.js#POLICY, #RESOLUTION and ' +
                              '#THROWAWAY with responses.json#requestPolicy and ' +
                              '#metadata.throwawayUser. Replaying under a different policy is not an ' +
                              'option.');
  }

  return mismatches;
}

/**
 * Resolves and vets a --report destination. Writing inside test/baseline/ is refused outright: that
 * folder is capped at exactly four entries (capture.js, replay.js, route-table.json, responses.json)
 * and a fifth would breach the diff-surface rule. Everything else is the operator's choice.
 */
function resolveReportPath(requested) {
  if (!requested) {
    return null;
  }

  var absolute = path.resolve(requested),
      relative = path.relative(ARTIFACT_DIRECTORY, absolute);

  if (relative === '' || (relative.slice(0, 2) !== '..' && !path.isAbsolute(relative))) {
    throw preconditionFailure('replay.js: REFUSING to write a report inside test/baseline/ (' +
                              absolute + '). That folder holds exactly four committed files and a ' +
                              'fifth is out of scope. Pass a path outside the repository, or one ' +
                              'that is already gitignored.');
  }

  return absolute;
}

// ---------------------------------------------------------------------------------------------
// Route-table canonicalization — route-table.json#canonicalization, reproduced exactly
//
// This is the deliberate second derivation described in the file header. It is a published API:
// test/lib/api/route-parity.js consumes canonicalizeLiveTable(), registrationOrderCanonical() and
// sha256() from here, and route-table.json#gates.documentedAnchorGate.evaluator names
// documentedAnchorGate() below. driftGates() checks it against capture.js's independent copy on every
// run, so the two cannot diverge without failing the run.
// ---------------------------------------------------------------------------------------------

function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function md5(text) {
  return crypto.createHash('md5').update(text, 'utf8').digest('hex');
}

/**
 * The auth descriptor of one live route row.
 *
 * route-table.json#canonicalization.authResolution pins this to "exactly hapi 21.4.10 lib/auth.js
 * lookup(route)": a route with no auth of its own inherits the server default declared at app.js:L287,
 * `auth : false` is rendered as the literal string "false" — hapi's _setupRoute carries the comment
 * "Preserve the difference between undefined and false" — and anything else is rendered from its own
 * resolved mode and strategy list. The declared string form `auth : 'session'` has already been
 * rewritten by hapi into { strategies : ['session'], mode : 'required' } by the time it reaches
 * server.table(); the singular `auth.strategy` branch is kept because a hand-built route object can
 * still carry that key. The recorded rawSettingsAuthTally — { undefined: 126, object: 105, false: 2 }
 * — is the tally of which of those three branches each of the 233 rows takes, and it is re-derived
 * and compared below.
 */
function authDescriptor(auth, serverDefault) {
  if (auth === false) {
    return 'false';
  }

  var mode       = (auth && auth.mode) || serverDefault.mode,
      strategies = (auth && auth.strategies) ||
                   (auth && auth.strategy ? [auth.strategy] : serverDefault.strategies);

  return 'mode=' + mode + ' strategies=' + JSON.stringify(strategies);
}

/** The canonical row string: "METHOD | path | authDescriptor | preCount". */
function canonicalRow(method, routePath, auth, preCount, serverDefault) {
  return [
    String(method).toUpperCase(),
    routePath,
    authDescriptor(auth, serverDefault),
    String(preCount)
  ].join(' | ');
}

/**
 * The server's default auth strategy, which app.js sets with
 * server.auth.default({ strategy : 'session', mode : 'try' }) and hapi normalizes to
 * { mode : 'try', strategies : ['session'] }. Read from the live server rather than assumed, because
 * it is what each of the 126 rows that declare no auth of their own inherits.
 */
function liveServerAuthDefault(server) {
  var settings = (server.auth && server.auth.settings && server.auth.settings.default) || {};

  return {
    mode       : settings.mode,
    strategies : settings.strategies ? settings.strategies.slice() : undefined
  };
}

/**
 * Canonicalizes the live route table. Everything returned is derived from server.table() and
 * server.auth.settings.default and from nothing else — no committed value is consulted, so the
 * measurement cannot be contaminated by the artifact it is about to be compared against.
 *
 * The second parameter is accepted for call-site symmetry with the committed artifact and is
 * deliberately unused for exactly that reason; test/lib/api/route-parity.js calls this with two
 * arguments.
 *
 * @param   {Object} server         The started hapi server.
 * @param   {Object} committedTable The committed artifact. Accepted, never read.
 * @returns {Object} { byKey, canonical, rawSettingsAuthTally, serverAuthDefault, gates }
 */
function canonicalizeLiveTable(server, committedTable) {
  var serverDefault = liveServerAuthDefault(server),
      byKey         = {},
      canonical     = [],
      tally         = { undefined : 0, object : 0, 'false' : 0 },
      gates         = {
        rowCount            : 0,
        methods             : {},
        apiPaths            : 0,
        withPreHandlers     : 0,
        authRequiredSession : 0,
        authFalse           : 0,
        authTryInherited    : 0
      };

  server.table().forEach(function(row) {
    var method   = String(row.method).toUpperCase(),
        auth     = row.settings.auth,
        preCount = Array.isArray(row.settings.pre) ? row.settings.pre.length : 0,
        text     = canonicalRow(method, row.path, auth, preCount, serverDefault);

    byKey[method + ' ' + row.path] = text;
    canonical.push(text);

    if (auth === false)          { tally['false'] += 1; gates.authFalse += 1; }
    else if (auth === undefined) { tally.undefined += 1; }
    else                         { tally.object += 1; }

    if (auth && auth.mode === 'required' &&
        JSON.stringify(auth.strategies || []) === JSON.stringify(['session'])) {
      gates.authRequiredSession += 1;
    }

    if (auth === undefined && serverDefault.mode === 'try') {
      gates.authTryInherited += 1;
    }

    if (row.path.indexOf('/api/') === 0) {
      gates.apiPaths += 1;
    }

    if (preCount > 0) {
      gates.withPreHandlers += 1;
    }

    gates.methods[method] = (gates.methods[method] || 0) + 1;
    gates.rowCount += 1;
  });

  return {
    byKey                : byKey,
    canonical            : canonical,
    rawSettingsAuthTally : tally,
    serverAuthDefault    : serverDefault,
    gates                : gates
  };
}

/**
 * The registration order, derived independently of the committed row order: config.routes is the array
 * app.js:L306 passes to server.route(), so its order IS the registration order. Each declaration is
 * mapped onto the live canonical string for its (METHOD, path) key, exactly as route-table.json#ADJ-5
 * describes, because server.table() returns ROUTER order rather than registration order.
 *
 * A declaration with no live row is reported through `missing` instead of being skipped quietly: it
 * would mean the router and the declaration list disagree, which is the drift this artifact exists to
 * catch. `require('config')` is called here rather than at module load so that requiring this file
 * stays inert.
 */
function registrationOrderCanonical(live) {
  var order   = [],
      missing = [];

  require('config').routes.forEach(function(route) {
    [].concat(route.method).forEach(function(method) {
      var key = String(method).toUpperCase() + ' ' + route.path;

      if (!live.byKey[key]) {
        missing.push(key);

        return;
      }

      order.push(live.byKey[key]);
    });
  });

  return { canonical : order, missing : missing };
}

// ---------------------------------------------------------------------------------------------
// The documented route-table anchor, as a mandatory gate
// ---------------------------------------------------------------------------------------------

/**
 * Evaluate the documented route-table anchor as a MANDATORY pass/fail gate, computed from the LIVE
 * server on every run rather than read out of a stored flag.
 *
 * Ten clauses, all of them the Specification's own published values for this table, plus the table
 * itself: the frozen digest literal is still stored verbatim; the row count; the method distribution;
 * the /api/ path count; the pre-handler count; the three auth buckets; the 233 canonical rows the
 * digest stands for, compared as a sorted multiset against the base-commit capture; and the
 * registration-order contract, whose fingerprint is re-derived from config.routes. Any drift in any of
 * them lands in `failures` and makes `satisfied` false, so a regression FAILS this gate instead of
 * being recorded as expected.
 *
 * Why the gate is the table and not a recomputed digest string: the Specification publishes its value
 * as 32 hexadecimal characters labelled sha256, where a SHA-256 is 64, and publishes no serialization
 * for it - no field set, no separator, no sort collation, no trailing-newline convention - so no
 * verifier can recompute the string itself from any input (route-table.json#adjudications ADJ-4
 * records the exhaustive search). What the literal names is a specific 233-row table, and THAT is
 * pinned here exactly, clause by clause. Reverse-engineering a serialization to force a string match
 * is forbidden by ADJ-4 and would prove nothing about the table.
 *
 * @param   {Object} live           The canonicalized live table from canonicalizeLiveTable().
 * @param   {Object} committedTable The committed route-table.json artifact.
 * @returns {Object} { documentedDigest, clauses : [...], failures : [...], satisfied : Boolean }
 */
function documentedAnchorGate(live, committedTable) {
  var gates    = committedTable.gates,
      order    = registrationOrderCanonical(live),
      clauses  = [],
      failures = [];

  function clause(name, documented, measured) {
    var satisfied = capture.stableStringify(documented) === capture.stableStringify(measured);

    clauses.push({ name : name, documented : documented, measured : measured, satisfied : satisfied });

    if (!satisfied) {
      failures.push(name);
    }
  }

  clause('documentedDigestRetainedVerbatim', DOCUMENTED_DIGEST, gates.documentedDigest);
  clause('rowCount', gates.rowCount, live.gates.rowCount);
  clause('methods', gates.methods, live.gates.methods);
  clause('apiPaths', gates.apiPaths, live.gates.apiPaths);
  clause('withPreHandlers', gates.withPreHandlers, live.gates.withPreHandlers);
  clause('authRequiredSession', gates.authRequiredSession, live.gates.authRequiredSession);
  clause('authFalse', gates.authFalse, live.gates.authFalse);
  clause('authTryInherited', gates.authTryInherited, live.gates.authTryInherited);
  clause('canonicalRowsTheDigestStandsFor',
         committedTable.rows.map(function(row) { return row.canonical; }).slice().sort(),
         live.canonical.slice().sort());
  clause('registrationOrderContract',
         { unresolvedDeclarations : [], fingerprint : gates.registrationOrderFingerprint },
         { unresolvedDeclarations : order.missing, fingerprint : sha256(order.canonical.join('\n')) });

  return {
    documentedDigest : DOCUMENTED_DIGEST,
    clauses          : clauses,
    failures         : failures,
    satisfied        : failures.length === 0
  };
}


// ---------------------------------------------------------------------------------------------
// Route-table replay
// ---------------------------------------------------------------------------------------------

/** One difference, in the shape capture.compareSection() produces, so every half reports identically. */
function pushDifference(differences, section, subject, expected, actual) {
  if (capture.stableStringify(expected) === capture.stableStringify(actual)) {
    return differences;
  }

  differences.push({
    section  : section,
    entry    : subject,
    field    : subject,
    expected : capture.stableStringify(expected),
    actual   : capture.stableStringify(actual)
  });

  return differences;
}

/** Canonical rows keyed by "METHOD path", which is unique per hapi route table. */
function rowsByRouteKey(canonicalRows) {
  var byKey = {};

  canonicalRows.forEach(function(text) {
    var fields = String(text).split(' | ');

    byKey[fields[0] + ' ' + fields[1]] = text;
  });

  return byKey;
}

/**
 * The row-level set diff. A digest mismatch says only "something moved"; this names the row, so a
 * regression is actionable. Three outcomes are reported separately because they mean different things:
 * a REMOVED row is a route that no longer registers, an ADDED row is a route that did not exist at the
 * base commit — both forbidden outright, since no route may be added or removed — and a CHANGED row is
 * the same route with different auth or a different pre-handler count.
 */
function diffRowSets(differences, committedCanonical, liveCanonical) {
  var committed = rowsByRouteKey(committedCanonical),
      live      = rowsByRouteKey(liveCanonical),
      keys      = Object.keys(committed).concat(Object.keys(live)).filter(function(key, index, all) {
        return all.indexOf(key) === index;
      }).sort();

  keys.forEach(function(key) {
    if (!live[key]) {
      pushDifference(differences, 'route-table', 'rows[' + key + '] REMOVED',
                     committed[key], '<no longer registered>');

      return;
    }

    if (!committed[key]) {
      pushDifference(differences, 'route-table', 'rows[' + key + '] ADDED',
                     '<absent from the baseline table>', live[key]);

      return;
    }

    pushDifference(differences, 'route-table', 'rows[' + key + '] CHANGED', committed[key], live[key]);
  });

  return differences;
}

/**
 * The anti-drift gates for the two independent canonicalizations described in the file header. This
 * file derives the table one way and capture.js derives it another; both are compared against the same
 * committed digests, and these gates compare them against EACH OTHER as well, so "the two
 * implementations agree" is measured on every run rather than assumed.
 */
function driftGates(live, captured) {
  var liveDigests = {
        measuredSha256               : sha256(live.canonical.slice().sort().join('\n')),
        measuredMd5                  : md5(live.canonical.slice().sort().join('\n')),
        registrationOrderFingerprint : sha256(registrationOrderCanonical(live).canonical.join('\n'))
      };

  return [
    capture.gate('canonicalization drift: sorted rows agree with capture.js',
                 captured.routerOrderCanonical.slice().sort(), live.canonical.slice().sort()),
    capture.gate('canonicalization drift: countable gates agree with capture.js',
                 captured.gates, live.gates),
    capture.gate('canonicalization drift: raw auth tally agrees with capture.js',
                 captured.rawSettingsAuthTally, live.rawSettingsAuthTally),
    capture.gate('canonicalization drift: server auth default agrees with capture.js',
                 captured.serverAuthDefault, live.serverAuthDefault),
    capture.gate('canonicalization drift: the three digests agree with capture.js', {
      measuredSha256               : captured.digests.measuredSha256,
      measuredMd5                  : captured.digests.measuredMd5,
      registrationOrderFingerprint : captured.digests.registrationOrderFingerprint
    }, liveDigests)
  ];
}

/**
 * Replays the route table: this file's independent canonicalization against the committed artifact,
 * capture.js's measurement against the same artifact through capture.routeTableGates(), and the two
 * measurements against each other through driftGates().
 *
 * @param   {Object} server         The started hapi server.
 * @param   {Object} committedTable The committed route-table.json artifact.
 * @returns {Object} { differences, gates, live, captured, rowCount, sortedDigest, md5Digest,
 *                     orderDigest, anchorGate }
 */
function replayRouteTable(server, committedTable) {
  var live               = canonicalizeLiveTable(server, committedTable),
      captured           = capture.captureRouteTable(server),
      differences        = [],
      committedCanonical = committedTable.rows.map(function(row) { return row.canonical; }),
      sortedText         = live.canonical.slice().sort().join('\n'),
      sortedDigest       = sha256(sortedText),
      md5Digest          = md5(sortedText),
      order              = registrationOrderCanonical(live),
      orderDigest        = sha256(order.canonical.join('\n')),
      anchorGate         = documentedAnchorGate(live, committedTable);

  // The documented anchor first, because it is the mandatory gate: an unsatisfied clause is a parity
  // failure, and the artifact's own record of the gate has to agree with what was just measured.
  pushDifference(differences, 'route-table', 'gates.documentedAnchorGate (unsatisfied clauses)',
                 [], anchorGate.failures);
  pushDifference(differences, 'route-table', 'gates.documentedAnchorGateSatisfied',
                 true, committedTable.gates.documentedAnchorGateSatisfied === true &&
                       anchorGate.satisfied);

  pushDifference(differences, 'route-table', 'rows (sorted canonical set)',
                 committedCanonical.slice().sort(), live.canonical.slice().sort());
  diffRowSets(differences, committedCanonical, live.canonical);

  pushDifference(differences, 'route-table', 'gates.measuredSha256',
                 committedTable.gates.measuredSha256, sortedDigest);
  pushDifference(differences, 'route-table', 'gates.measuredSha256First32',
                 committedTable.gates.measuredSha256First32, sortedDigest.slice(0, 32));
  pushDifference(differences, 'route-table', 'gates.measuredMd5',
                 committedTable.gates.measuredMd5, md5Digest);
  // A SEPARATE gate from the sorted digest, and it has to be: sorting discards registration order, so
  // an ordering regression that let the /{path*} catch-all shadow real routes would leave the sorted
  // digest intact. addStaticPages must stay first and addStaticRoutes last.
  pushDifference(differences, 'route-table', 'gates.registrationOrderFingerprint',
                 committedTable.gates.registrationOrderFingerprint, orderDigest);
  pushDifference(differences, 'route-table', 'registration order: declarations resolved',
                 [], order.missing);

  ['rowCount', 'methods', 'apiPaths', 'withPreHandlers', 'authRequiredSession', 'authFalse',
   'authTryInherited'].forEach(function(name) {
    pushDifference(differences, 'route-table', 'gates.' + name,
                   committedTable.gates[name], live.gates[name]);
  });

  pushDifference(differences, 'route-table',
                 'canonicalization.empiricalAuthShape.rawSettingsAuthTally',
                 committedTable.canonicalization.empiricalAuthShape.rawSettingsAuthTally,
                 live.rawSettingsAuthTally);
  pushDifference(differences, 'route-table',
                 'canonicalization.empiricalAuthShape.serverAuthSettingsDefault',
                 committedTable.canonicalization.empiricalAuthShape.serverAuthSettingsDefault,
                 live.serverAuthDefault);

  return {
    differences  : differences,
    gates        : capture.routeTableGates(committedTable, captured)
                     .concat(driftGates(live, captured))
                     .concat([
                       capture.gate('route-table documentedAnchorGate (' + anchorGate.clauses.length +
                                    ' clauses, unsatisfied)', [], anchorGate.failures),
                       capture.gate('route-table documentedAnchorGate satisfied', true,
                                    anchorGate.satisfied)
                     ]),
    live         : live,
    captured     : captured,
    rowCount     : live.gates.rowCount,
    sortedDigest : sortedDigest,
    md5Digest    : md5Digest,
    orderDigest  : orderDigest,
    anchorGate   : anchorGate
  };
}


// ---------------------------------------------------------------------------------------------
// Response-corpus replay
// ---------------------------------------------------------------------------------------------

/**
 * One measured section with every origin rebased onto the corpus origin, so anything computed from it
 * is computed from exactly the values capture.compareCorpus() compares. The origin appears both in the
 * Location and, percent-encoded, in the request path of the assignment entries — see
 * capture.js#rebaseEntryOrigin.
 */
function rebaseSection(entries, committedCorpus) {
  var from = capture.liveAppUrlOrigin(),
      to   = (committedCorpus.metadata && committedCorpus.metadata.appUrlOrigin) || null;

  return (entries || []).map(function(entry) {
    return capture.rebaseEntryOrigin(entry, from, to);
  });
}

/** The assignment `next` supplement, rebased. Kept as a named export for call-site clarity. */
function rebaseAssignmentSection(measured, committedCorpus) {
  return rebaseSection(measured.assignmentNext, committedCorpus);
}

/**
 * Re-issues the whole corpus over real HTTP through capture.js's own helpers and compares it to the
 * committed one field by field, then re-derives every published gate from the measurement.
 *
 * The per-entry comparison is capture.compareCorpus(), which walks capture.COMPARED_FIELDS:
 * requestHeaders, status, statusText, headers, contentType, setCookie, setCookieAttributes, location,
 * isApiRequest, bodyShape, redirectChain and resolved. Prose fields (`notes`) are never compared.
 * Normalization is the artifact's own contract, read by capture.htmlNormalizationRules() from
 * responses.json#normalizationContract — nothing is normalized here that the contract does not permit,
 * and no rule is ever added to make a diff pass.
 *
 * @param   {Object} server          The started hapi server.
 * @param   {Object} committedCorpus The committed responses.json artifact.
 * @returns {Promise<Object>} { differences, gates, measured }
 */
function replayResponses(server, committedCorpus) {
  return capture.captureCorpus(server, committedCorpus).then(function(measured) {
    var differences = capture.compareCorpus(committedCorpus, measured),
        published   = committedCorpus.gates,
        assignment  = rebaseAssignmentSection(measured, committedCorpus);

    // gates.measuredDistribution is the RESOLVED reading and is the artifact's declared
    // distributionAuthority; gates.documentedDistribution is the Specification's published 25/7/25/1
    // and the artifact records distributionMatchesDocumented: true. Both are gated, and the committed
    // MEASURED values are what the comparison is against — R-6 puts the observed base-commit behavior
    // above the documented prose whenever the two could disagree.
    pushDifference(differences, 'responses', 'gates.measuredDistribution',
                   published.measuredDistribution,
                   capture.resolvedStatusDistribution(measured.unauthenticated));
    pushDifference(differences, 'responses', 'gates.documentedDistribution',
                   published.documentedDistribution,
                   capture.resolvedStatusDistribution(measured.unauthenticated));
    pushDifference(differences, 'responses', 'gates.firstHopStatusDistribution',
                   published.firstHopStatusDistribution,
                   capture.statusDistribution(measured.unauthenticated));
    pushDifference(differences, 'responses', 'gates.resolvedStatusDistribution',
                   published.resolvedStatusDistribution,
                   capture.resolvedStatusDistribution(measured.unauthenticated));
    pushDifference(differences, 'responses', 'gates.hopCountHistogram',
                   published.hopCountHistogram, capture.hopCountHistogram(measured.unauthenticated));
    pushDifference(differences, 'responses', 'gates.redirectingRouteCount',
                   published.redirectingRouteCount,
                   capture.redirectingEntryPaths(measured.unauthenticated).length);
    pushDifference(differences, 'responses', 'gates.redirectingRoutePaths',
                   published.redirectingRoutePaths,
                   capture.redirectingEntryPaths(measured.unauthenticated));
    pushDifference(differences, 'responses', 'gates.redirectResolution',
                   published.redirectResolution,
                   capture.redirectResolutionDistribution(measured.unauthenticated));
    pushDifference(differences, 'responses', 'gates.authenticatedFirstHopStatuses',
                   published.authenticatedFirstHopStatuses,
                   capture.authenticatedStatusMap(measured.authenticated, 'firstHop'));
    pushDifference(differences, 'responses', 'gates.authenticatedResolvedStatuses',
                   published.authenticatedResolvedStatuses,
                   capture.authenticatedStatusMap(measured.authenticated, 'resolved'));
    pushDifference(differences, 'responses', 'gates.unauthenticatedEntryCount',
                   published.unauthenticatedEntryCount, measured.unauthenticated.length);
    pushDifference(differences, 'responses', 'gates.authenticatedEntryCount',
                   published.authenticatedEntryCount, measured.authenticated.length);
    // The assignment `next` supplement. gates.assignmentNextLocations is the gate a discarded
    // same-origin absolute destination would trip: the two consuming hops carry the destination
    // itself, so a build that dropped it would answer the declared success.redirect instead.
    pushDifference(differences, 'responses', 'gates.assignmentNextEntryCount',
                   published.assignmentNextEntryCount, assignment.length);
    pushDifference(differences, 'responses', 'gates.assignmentNextStatuses',
                   published.assignmentNextStatuses, capture.assignmentNextStatusMap(assignment));
    pushDifference(differences, 'responses', 'gates.assignmentNextLocations',
                   published.assignmentNextLocations, capture.assignmentNextLocationMap(assignment));
    pushDifference(differences, 'responses', 'selectionRule.expectedCount',
                   committedCorpus.selectionRule.expectedCount, measured.unauthenticated.length);
    pushDifference(differences, 'responses', 'selectionRule.paths',
                   committedCorpus.selectionRule.paths,
                   measured.unauthenticated.map(function(entry) { return entry.path; }));

    return {
      differences : differences,
      gates       : capture.corpusGates(committedCorpus, measured, capture.liveAppUrlOrigin())
                      .concat(capture.cookieContractGates(committedCorpus, measured))
                      .concat(errorMappingGates(committedCorpus, measured)),
      measured    : measured
    };
  });
}

/** Every JSON body message observed at one status, de-duplicated, in sorted order. */
function jsonMessagesAtStatus(entries, status) {
  var seen = {};

  (entries || []).forEach(function(entry) {
    if (entry.status !== status || !entry.bodyShape || entry.bodyShape.kind !== 'json') {
      return;
    }

    var scalars = entry.bodyShape.stableScalars || {};

    if (typeof scalars.message === 'string') {
      seen[scalars.message] = true;
    }
  });

  return Object.keys(seen).sort();
}

/**
 * The R-5 evidence, gated explicitly rather than left implicit in the body-shape comparison.
 *
 * responses.json#errorMappingContract.messageComparisonRule states the measured asymmetry: a 4xx
 * message is passed through to the client and must be compared byte for byte, while a 5xx message is
 * replaced by hapi with a fixed string, so internal error text is unobservable and must not be
 * asserted. Both halves are checked here against the artifact's own recorded values — the 401 message
 * every one of the seven unauthorized bodies carries (the no-session branch of the four
 * Boom.unauthorized strings constructed in app.js's auth scheme), and the scrubbed 500 message.
 */
function errorMappingGates(committedCorpus, measured) {
  var contract = committedCorpus.errorMappingContract || {},
      expected401 = contract.unauthorizedMessageMeasuredInEvery401,
      gates       = [
        capture.gate('errorMapping 4xx message passed through (401 bodies)',
                     expected401 === undefined ? [] : [expected401],
                     jsonMessagesAtStatus(measured.unauthenticated, 401)),
        capture.gate('errorMapping 4xx message is one of the four constructed strings',
                     [], jsonMessagesAtStatus(measured.unauthenticated, 401)
                           .filter(function(message) {
                             return (contract.unauthorizedMessages || []).indexOf(message) === -1;
                           }))
      ];

  if (contract.fiveXxScrubsMessage) {
    gates.push(capture.gate('errorMapping 5xx message is scrubbed, so internal text is unobservable',
                            [contract.fiveXxScrubbedMessage],
                            jsonMessagesAtStatus(measured.unauthenticated, 500)));
  }

  return gates;
}

// ---------------------------------------------------------------------------------------------
// Report-back findings — the R-6 obligations, named in the language the finding has to be reported in
// ---------------------------------------------------------------------------------------------

/**
 * How a Location reads: absolute on the corpus origin, absolute somewhere else, root-relative, or
 * absent. Parsing uses the NON-THROWING static URL.parse with the origin as its base — the legacy
 * node:url parse function warns under --pending-deprecation and `new URL('/relative')` throws
 * ERR_INVALID_URL — and its null return is handled, because a Location the parser rejects is itself a
 * finding rather than a crash.
 * The `base` argument is the same choice test/helpers/flow.js makes, which is why an absolute-versus-
 * relative flip here is evidence about the 22 lastRedirect.pathname assertions that ride on it.
 */
function locationKind(location, origin) {
  if (typeof location !== 'string' || location === '') {
    return 'none';
  }

  // The scheme-relative form is checked before anything else and reported as its own kind: it LOOKS
  // relative but resolves to a different host, so folding it into 'relative' would hide exactly the
  // off-origin redirect the recorded Location contract exists to catch.
  if (location.slice(0, 2) === '//') {
    return 'scheme-relative';
  }

  if (location.charAt(0) === '/') {
    return 'relative';
  }

  // Parsed with NO base first: the static form returns null unless the value carries its own scheme,
  // which is what separates a genuinely absolute Location from a base-relative reference. The recorded
  // corpus only ever holds the absolute-same-origin, relative and none forms, so the two remaining
  // kinds exist to name a regression precisely rather than to be reached in a clean run.
  if (URL.parse(location)) {
    return origin && location.indexOf(origin) === 0 ? 'absolute-same-origin' : 'absolute-other-origin';
  }

  return URL.parse(location, origin || undefined) ? 'relative-reference' : 'unparseable';
}

/** One finding, in the shape reportFindings() prints and the --report file records. */
function finding(id, subject, baseline, measured, report) {
  return {
    id       : id,
    subject  : subject,
    baseline : capture.stableStringify(baseline),
    measured : capture.stableStringify(measured),
    report   : report
  };
}

/** The authenticated entry for one page, by the state label capture.js records. */
function authenticatedEntry(entries, method, requestPath) {
  return capture.findEntry(entries, method, requestPath, 'authenticated');
}

/**
 * The flagship R-6 quirk. Authenticated GET /login and GET /signup answer 500, because the property
 * form `reply.redirect('/home')` at lib/controllers/pages.js:L17 and `reply.redirect('/welcome')` at
 * L27 raise — the synthetic reply is a bare function with no `.redirect` property — and the catch-all
 * turns the TypeError into Boom.badImplementation. A converted handler must keep raising the
 * equivalent internal error; issuing h.redirect(...) instead would silently "fix" this into a 302 on a
 * login page, which is a prohibited behavior improvement. The corpus is never adjusted to match.
 */
function pagesQuirkFindings(committedCorpus, measured) {
  var published = committedCorpus.gates,
      findings  = [];

  [
    { path : '/login', baseline : published.authenticatedLoginStatus, line : 'L17 reply.redirect(\'/home\')' },
    { path : '/signup', baseline : published.authenticatedSignupStatus,
      line : 'L27 reply.redirect(\'/welcome\')' }
  ].forEach(function(page) {
    var entry  = authenticatedEntry(measured.authenticated, 'GET', page.path),
        status = entry ? entry.status : null;

    if (status === page.baseline) {
      return;
    }

    findings.push(finding('pages-js-conversion-defect', 'authenticated GET ' + page.path + ' status',
                          page.baseline, status,
                          'lib/controllers/pages.js CONVERSION DEFECT. Authenticated GET ' + page.path +
                          ' answered ' + status + ' where the base commit answers ' + page.baseline +
                          '. ' + (status >= 300 && status < 400
                            ? 'A 3xx means ' + page.line + ' was converted into a working h.redirect(), ' +
                              'which is the prohibited behavior "improvement" R-4 forbids. '
                            : '') +
                          'The converted handler must throw the equivalent internal error so the ' +
                          'measured 500 survives. Report it to the lib/controllers/pages.js owner and ' +
                          'to docs/PRESERVED-QUIRKS.md; do NOT adjust the corpus.'));
  });

  return findings;
}

/**
 * Quirk I14: exactly one 500 in the unauthenticated corpus, at GET /api/users/assets, delivered as
 * Boom JSON rather than a rendered 50x.html because the /api/ prefix makes it an API request.
 * config/api_routes.js declares validate.query.type as optional while the controller calls
 * request.query.type.toLowerCase() unguarded. A 200 or a 400 here means the quirk was repaired.
 */
function serverErrorQuirkFindings(committedCorpus, measured) {
  var published = committedCorpus.gates,
      errors    = measured.unauthenticated.filter(function(entry) { return entry.status === 500; }),
      route     = errors.length === 1 ? errors[0].method + ' ' + errors[0].path : null,
      kind      = errors.length === 1 && errors[0].bodyShape ? errors[0].bodyShape.kind : null,
      findings  = [];

  if (route !== published.singleServerErrorRoute || errors.length !== published.serverErrorEntryCount) {
    findings.push(finding('server-error-quirk-changed', 'the single 500 in the unauthenticated corpus',
                          { route : published.singleServerErrorRoute,
                            count : published.serverErrorEntryCount },
                          { route : route, count : errors.length },
                          'The pre-existing 500 quirk (AAP implicit requirement I14) changed. It must ' +
                          'be preserved, not repaired: config/api_routes.js declares ' +
                          'validate.query.type as optional and lib/controllers/users.js calls ' +
                          'request.query.type.toLowerCase() unguarded. A 200 or a 400 at ' +
                          'GET /api/users/assets is a prohibited behavior change (R-4). Report it to ' +
                          'docs/PRESERVED-QUIRKS.md.'));
  }
  else if (kind !== 'json') {
    findings.push(finding('server-error-delivery-changed', 'GET /api/users/assets body kind',
                          'json', kind,
                          'The 500 at GET /api/users/assets is no longer delivered as Boom JSON. The ' +
                          '/api/ prefix makes it an API request, so app.js must not render 50x.html ' +
                          'for it. Error-payload shape is R-5 evidence and must survive the ' +
                          'conversion unchanged.'));
  }

  return findings;
}

/**
 * The feature-flag 404s. lib/util/features.js#isTrinketTypeEnabled returns trinketFeatures[lang] ===
 * true when the key exists and `false` otherwise, while the comment two lines above claims the
 * opposite ("default to true if not specified"); isKnownTrinketType is a bare hasOwnProperty, and
 * config/default.yaml enables only python. Both the code and the contradictory comment stay.
 */
function featureFlagFindings(committedCorpus, measured) {
  var published = committedCorpus.gates,
      measuredPaths = measured.unauthenticated.filter(function(entry) {
        return entry.status === 404 && entry.bodyShape && entry.bodyShape.kind === 'html';
      }).map(function(entry) { return entry.path; }).sort(),
      expected = (published.languageFlagFourOhFourPaths || []).slice().sort(),
      lost     = expected.filter(function(item) { return measuredPaths.indexOf(item) === -1; }),
      gained   = measuredPaths.filter(function(item) { return expected.indexOf(item) === -1; });

  if (!lost.length && !gained.length) {
    return [];
  }

  return [finding('feature-flag-404s-changed', 'the feature-flag 404 set',
                  { count : expected.length, paths : expected },
                  { count : measuredPaths.length, noLonger404 : lost, newly404 : gained },
                  'The feature-flag 404s changed. Either a config/default.yaml feature flag moved or ' +
                  'the isKnownTrinketType / isTrinketTypeEnabled asymmetry in lib/util/features.js was ' +
                  '"fixed". Both are preserved deliberately, including the contradictory comment that ' +
                  'claims types default to enabled. Report it to docs/PRESERVED-QUIRKS.md.')];
}

/**
 * Location absolute-versus-relative parity, per entry, across all three sections. This is the class of
 * regression the three recorded Location patterns exist to detect: request.success / request.fail
 * absolutize through lib/http/redirect.js, `reply().redirect(x)` stays relative, and the onPreResponse
 * 401 branch redirects to the bare relative '/login'.
 */
function locationFindings(committedCorpus, measured) {
  var origin   = (committedCorpus.metadata && committedCorpus.metadata.appUrlOrigin) || null,
      findings = [];

  [
    { name : 'unauthenticated', committed : committedCorpus.unauthenticated,
      measured : rebaseSection(measured.unauthenticated, committedCorpus) },
    { name : 'authenticated', committed : committedCorpus.authenticated,
      measured : rebaseSection(measured.authenticated, committedCorpus) },
    { name : 'assignmentNext', committed : committedCorpus.assignmentNext || [],
      measured : rebaseAssignmentSection(measured, committedCorpus) }
  ].forEach(function(section) {
    section.committed.forEach(function(committedEntry, index) {
      var measuredEntry = section.measured[index];

      if (!measuredEntry) {
        return;
      }

      var before = locationKind(committedEntry.location, origin),
          after  = locationKind(measuredEntry.location, origin);

      if (before === after) {
        return;
      }

      findings.push(finding('location-kind-flip',
                            section.name + '[' + index + '] ' + committedEntry.method + ' ' +
                            committedEntry.path + ' Location',
                            { kind : before, location : committedEntry.location },
                            { kind : after, location : measuredEntry.location },
                            'The Location flipped from ' + before + ' to ' + after + '. Absolute ' +
                            'versus relative is the whole point of the recorded Location contract: it ' +
                            'is the evidence behind the URL.parse base argument in ' +
                            'test/helpers/flow.js and the 22 lastRedirect.pathname assertions that ' +
                            'ride on it. Report it to docs/PRESERVED-QUIRKS.md.'));
    });
  });

  return findings;
}

/** A row-count regression, with the eight NULL app.prefixes entries named when the count says 241. */
function routeTableFindings(committedTable, table) {
  if (!table || table.rowCount === committedTable.gates.rowCount) {
    return [];
  }

  var prefixes = table.rowCount === 241
    ? ' A count of 241 is the signature of the eight NULL app.prefixes entries in ' +
      'config/default.yaml having been filled in: they contribute ZERO routes at the base commit and ' +
      'the guard in lib/util/routeParser.js skips them. They must stay NULL.'
    : '';

  return [finding('route-table-row-count-changed', 'the registered route count',
                  committedTable.gates.rowCount, table.rowCount,
                  'The route table no longer registers ' + committedTable.gates.rowCount + ' rows. No ' +
                  'route may be added or removed by this change (TR1).' + prefixes +
                  ' The row-level set diff above names every added, removed and changed row. Report it ' +
                  'to docs/PRESERVED-QUIRKS.md.')];
}

/** Build-artifact regressions, including the appearance of a .css.map that vite has never emitted. */
function buildArtifactFindings(committedCorpus, artifacts) {
  var published = committedCorpus.buildArtifacts || {},
      findings  = [];

  capture.BUILD_ARTIFACT_FILES.forEach(function(relative) {
    var measured = artifacts.files[relative];

    if (!measured) {
      return;
    }

    if (capture.stableStringify(published[relative]) === capture.stableStringify(measured)) {
      return;
    }

    findings.push(finding('build-artifact-changed', relative, published[relative], measured,
                          'The compiled stylesheet changed. sass 1.98.0 and vite 4.5.14 are held ' +
                          'precisely so the Foundation 5.5.3 fork keeps compiling to these exact ' +
                          'bytes, and static/scss/** is frozen. Report it to docs/PRESERVED-QUIRKS.md.'));
  });

  if (artifacts.cssMapFilesEmitted !== null &&
      artifacts.cssMapFilesEmitted !== published.cssMapFilesEmitted) {
    findings.push(finding('css-map-emitted', 'public/css *.map files',
                          published.cssMapFilesEmitted,
                          { count : artifacts.cssMapFilesEmitted, files : artifacts.cssMapFiles },
                          'Source maps appeared under public/css. vite.config.mjs sets sourcemap: ' +
                          'true and the build has always emitted none; a .css.map is a NEW asset URL, ' +
                          'which the asset-URL contract forbids. Report it to ' +
                          'docs/PRESERVED-QUIRKS.md.'));
  }

  return findings;
}

/**
 * Every report-back obligation, gathered. A finding is by construction a prohibited change, so a
 * non-empty list is a failing run — it is counted towards the exit code alongside the differences.
 */
function reportBackFindings(committedTable, committedCorpus, table, measured, artifacts) {
  var findings = [];

  if (table) {
    findings = findings.concat(routeTableFindings(committedTable, table));
  }

  if (measured) {
    findings = findings
      .concat(pagesQuirkFindings(committedCorpus, measured))
      .concat(serverErrorQuirkFindings(committedCorpus, measured))
      .concat(featureFlagFindings(committedCorpus, measured))
      .concat(locationFindings(committedCorpus, measured));
  }

  if (artifacts) {
    findings = findings.concat(buildArtifactFindings(committedCorpus, artifacts));
  }

  return findings;
}


// ---------------------------------------------------------------------------------------------
// Build artifacts
// ---------------------------------------------------------------------------------------------

/**
 * Measures the two compiled stylesheets and the source-map count, and gates them against
 * responses.json#buildArtifacts. Absence is a MEASUREMENT, not a difference: `npm run build` fails on
 * a clean checkout until public/components is hydrated from the public-components.tgz asset of release
 * v1.1.0, so a missing file yields an UNEVALUATED gate carrying that precondition. Conflating "not
 * built" with "changed" would let a genuinely changed stylesheet hide behind an unbuilt checkout.
 */
function replayBuildArtifacts(committedCorpus) {
  var artifacts = capture.measureBuildArtifacts();

  if (artifacts.missing.length) {
    console.log('replay.js: PRECONDITION — ' + artifacts.missing.join(', ') + ' absent from this ' +
                'checkout, so the build-artifact gates are UNEVALUATED rather than failed. ' +
                (committedCorpus.buildArtifacts && committedCorpus.buildArtifacts.precondition
                  ? committedCorpus.buildArtifacts.precondition
                  : 'Hydrate public/components, then run `npm run build`.'));
  }

  return {
    artifacts : artifacts,
    gates     : capture.buildArtifactGates(committedCorpus, artifacts)
  };
}

// ---------------------------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------------------------

/**
 * Every difference, always, in full. There is deliberately no flag that hides one: R-6 requires that
 * each difference be reported and each resolution documented, and a summary that says "3 differences"
 * without naming them cannot be acted on. --quiet trims PASS gate lines only.
 */
function reportDifferences(differences) {
  if (!differences.length) {
    console.log('replay.js: 0 differences — the running application replays the R-6 baseline exactly.');

    return;
  }

  console.log('replay.js: ' + differences.length + ' DIFFERENCE(S) against the R-6 baseline. Each one ' +
              'is an application-code defect or a harness defect. It is reported, never normalized ' +
              'away and never written over the baseline.');

  differences.forEach(function(difference) {
    console.log('  [DIFF] ' + difference.section + ' :: ' + difference.entry +
                (difference.field && difference.field !== difference.entry ? ' :: ' + difference.field
                                                                          : ''));
    console.log('    baseline: ' + String(difference.expected).slice(0, 400));
    console.log('    measured: ' + String(difference.actual).slice(0, 400));
  });
}

/** The report-back obligations, each with the language it has to be reported in. */
function reportFindings(findings) {
  if (!findings.length) {
    console.log('replay.js: 0 report-back findings — every catalogued quirk is still in place.');

    return;
  }

  console.log('replay.js: ' + findings.length + ' R-6 REPORT-BACK FINDING(S). Report each to the owning ' +
              'agent and to docs/PRESERVED-QUIRKS.md:');

  findings.forEach(function(item) {
    console.log('  [FINDING ' + item.id + '] ' + item.subject);
    console.log('    baseline: ' + String(item.baseline).slice(0, 400));
    console.log('    measured: ' + String(item.measured).slice(0, 400));
    console.log('    report  : ' + item.report);
  });
}

/** The route-table half of the human-readable summary — the values AAP 0.7.5 names as the anchors. */
function reportRouteTable(table) {
  console.log('replay.js: route table rows=' + table.rowCount +
              ' methods=' + JSON.stringify(table.live.gates.methods) +
              ' api=' + table.live.gates.apiPaths +
              ' withPre=' + table.live.gates.withPreHandlers);
  console.log('replay.js: route table auth required=' + table.live.gates.authRequiredSession +
              ' false=' + table.live.gates.authFalse +
              ' inheritedTry=' + table.live.gates.authTryInherited +
              ' rawTally=' + JSON.stringify(table.live.rawSettingsAuthTally));
  console.log('replay.js: route table sortedSha256=' + table.sortedDigest +
              ' md5=' + table.md5Digest);
  console.log('replay.js: route table registrationOrderFingerprint=' + table.orderDigest);
  console.log('replay.js: documented anchor gate (' + table.anchorGate.documentedDigest + ') ' +
              (table.anchorGate.satisfied
                ? 'SATISFIED — all ' + table.anchorGate.clauses.length + ' clauses hold'
                : 'FAILED — ' + JSON.stringify(table.anchorGate.failures)));
}

/** The corpus half, in both readings the artifact publishes. */
function reportCorpus(measured) {
  console.log('replay.js: responses unauthenticated=' + measured.unauthenticated.length +
              ' authenticated=' + measured.authenticated.length +
              ' assignmentNext=' + (measured.assignmentNext || []).length);
  console.log('replay.js: firstHopDistribution=' +
              JSON.stringify(capture.statusDistribution(measured.unauthenticated)) +
              ' resolvedDistribution=' +
              JSON.stringify(capture.resolvedStatusDistribution(measured.unauthenticated)));
  console.log('replay.js: roles tokens structurally verified before normalization: ' +
              (measured.rolesTokenObservations || []).length);
}

/** One line per corpus entry, under --verbose: the fields the comparison is made of. */
function reportEntryDetail(measured) {
  [
    { name : 'unauthenticated', entries : measured.unauthenticated },
    { name : 'authenticated', entries : measured.authenticated },
    { name : 'assignmentNext', entries : measured.assignmentNext || [] }
  ].forEach(function(section) {
    section.entries.forEach(function(entry, index) {
      var body = entry.bodyShape || {};

      console.log('  [ENTRY] ' + section.name + '[' + index + '] ' + entry.method + ' ' + entry.path +
                  (entry.state ? ' (' + entry.state + ')' : '') +
                  ' -> ' + entry.status +
                  ' type=' + (entry.contentType === null ? '-' : entry.contentType) +
                  ' api=' + entry.isApiRequest +
                  ' location=' + (entry.location === null || entry.location === undefined
                                    ? '-' : entry.location) +
                  ' body=' + (body.kind || '-') +
                  (body.keys ? '[' + body.keys.join(',') + ']' : '') +
                  (body.sha256 ? ' sha256=' + String(body.sha256).slice(0, 16) : '') +
                  ' setCookie=' + JSON.stringify(entry.setCookieAttributes || []) +
                  (entry.resolved ? ' resolved=' + entry.resolved.status + '/' + entry.resolved.hops +
                                    'hops' : ''));
    });
  });
}

/** The greppable one-liner every run ends with. */
function reportSummary(state, tally, exitCode) {
  var sections = state.measured
        ? state.measured.unauthenticated.length + ' unauthenticated + ' +
          state.measured.authenticated.length + ' authenticated + ' +
          (state.measured.assignmentNext || []).length + ' assignment-next entries'
        : 'no corpus entries (route table only)',
      verdict = exitCode === EXIT.CLEAN ? 'PASS' : 'FAIL';

  console.log('BASELINE REPLAY: ' + state.differences.length + ' difference' +
              (state.differences.length === 1 ? '' : 's') + ' across ' + sections + ', ' +
              state.findings.length + ' finding' + (state.findings.length === 1 ? '' : 's') +
              ', gates ' + tally.pass + ' PASS / ' + tally.fail + ' FAIL / ' + tally.unevaluated +
              ' UNEVALUATED — ' + verdict);
}

// ---------------------------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------------------------

/**
 * Flag parsing through node:util's parseArgs — never the dead argv package this change deletes from the
 * manifest, and never a new dependency. strict:true means an unknown flag stops the run rather than
 * being ignored, which matters for a tool whose whole value is that it was run the way it says it was.
 *
 * --routes-only and --json are retained as aliases of --route-table-only and --report so that a command
 * line documented before those names existed keeps working.
 */
function parseArgv(argv) {
  var parsed;

  try {
    parsed = nodeUtil.parseArgs({
      args             : argv,
      strict           : true,
      allowPositionals : false,
      options          : {
        'route-table-only' : { type : 'boolean', default : false },
        'routes-only'      : { type : 'boolean', default : false },
        'corpus-only'      : { type : 'boolean', default : false },
        verbose            : { type : 'boolean', default : false },
        quiet              : { type : 'boolean', default : false },
        report             : { type : 'string' },
        json               : { type : 'string' }
      }
    }).values;
  }
  catch (err) {
    // A usage error, reported as one. It is still exit 2 — the run could not happen — but an operator
    // who mistyped a flag needs the supported set, not a stack trace.
    throw preconditionFailure('replay.js: ' + (err && err.message ? err.message : String(err)) +
                              '\n  Supported flags: --route-table-only (alias --routes-only), ' +
                              '--corpus-only, --verbose, --quiet, --report <path> (alias --json). ' +
                              'This tool never writes an artifact, so there is deliberately no ' +
                              '--write.');
  }

  var routeTableOnly  = parsed['route-table-only'] || parsed['routes-only'],
      requestedReport = parsed.report === undefined ? parsed.json : parsed.report;

  if (routeTableOnly && parsed['corpus-only']) {
    throw preconditionFailure('replay.js: --route-table-only and --corpus-only contradict each other. ' +
                              'Pass one or neither; a run with no flags replays both halves.');
  }

  if (parsed.report !== undefined && parsed.json !== undefined && parsed.report !== parsed.json) {
    throw preconditionFailure('replay.js: --report and --json are aliases and were given different ' +
                              'paths (' + parsed.report + ' vs ' + parsed.json + '). Pass one.');
  }

  return {
    routeTableOnly : routeTableOnly,
    corpusOnly     : parsed['corpus-only'],
    verbose        : parsed.verbose,
    quiet          : parsed.quiet,
    report         : resolveReportPath(requestedReport)
  };
}

/** Boots through capture.js, mapping a boot failure onto the could-not-run outcome. */
function startBaselineServer() {
  return Promise.resolve().then(function() {
    return capture.startServer();
  }).then(function(server) {
    return server;
  }, function(err) {
    throw preconditionFailure('replay.js: the application did not boot into a listening server — ' +
                              (err && err.message ? err.message : String(err)) +
                              '. app.js exports a promise that resolves to the started server and ' +
                              'never rejects (its own catch calls process.exit), so a falsy resolve ' +
                              'means app.start was not honoured. Check that mongod and redis are ' +
                              'reachable and that config carries a session cookie password of at ' +
                              'least 32 characters.');
  });
}

/** Runs one attempt that must never reject, used for the best-effort identity cleanup. */
function attempt(action) {
  try {
    return Promise.resolve(action()).then(function() {
      return undefined;
    }, function() {
      return undefined;
    });
  }
  catch (err) {
    return Promise.resolve();
  }
}

/**
 * Stops the server and removes the two throwaway identities, on every path.
 *
 * capture.js already removes them at the end of each supplement and on its own error paths, so this is
 * belt and braces for an exception between the two — but it is deliberate belt and braces: the corpus
 * is only reproducible from the same datastore state, and a leftover baseline-capture user would
 * change the next run's rendered /home. Each removal is attempted rather than awaited for success,
 * because it reaches the model globals app.js created and those do not exist if the boot failed.
 *
 * The two identities are removed one document at a time through the application's own model. The
 * destructive whole-database reset is never performed here, and neither of the two mocha helpers that
 * would perform it — the one that resets the database at module load and the one that throws at module
 * load — is ever required.
 */
function teardown(server, corpusAttempted) {
  return capture.stopServer(server).then(function() {
    if (!corpusAttempted) {
      return undefined;
    }

    return attempt(function() {
      return capture.removeThrowawayUser();
    }).then(function() {
      return attempt(function() {
        return capture.removeAssignmentSignupUser();
      });
    });
  });
}

/** Announces what this run is measuring, before anything is measured. */
function announce(committedCorpus, options) {
  console.log('replay.js: replaying the R-6 baseline captured at ' +
              (committedCorpus.metadata.baseCommit || 'an unrecorded commit') +
              ' under app.url origin ' + committedCorpus.metadata.appUrlOrigin);
  console.log('replay.js: request policy conformance CONFIRMED against responses.json#requestPolicy ' +
              '(no Accept header, referer ' + capture.POLICY.referer + ', pinned User-Agent, ' +
              'followRedirects=' + capture.POLICY.followRedirects + ', timeout ' +
              capture.POLICY.timeoutMs + 'ms, resolution maxHops ' + capture.RESOLUTION.maxHops + ')');
  console.log('replay.js: scope=' + (options.routeTableOnly ? 'route table only'
                                                            : options.corpusOnly ? 'corpus only'
                                                                                 : 'route table + corpus') +
              ' mode=READ-ONLY (this tool never writes an artifact)');
}

/** Replays whichever halves the flags asked for, accumulating into `state`. */
function replayHalves(server, committedTable, committedCorpus, options, state) {
  return Promise.resolve().then(function() {
    if (options.corpusOnly) {
      state.gates.push(capture.unevaluatedGate('route-table (233 rows)',
                                               '--corpus-only: the route table was deliberately not ' +
                                               'canonicalized'));

      return undefined;
    }

    state.table       = replayRouteTable(server, committedTable);
    state.differences = state.differences.concat(state.table.differences);
    state.gates       = state.gates.concat(state.table.gates);
    reportRouteTable(state.table);

    return undefined;
  }).then(function() {
    if (options.routeTableOnly) {
      state.gates.push(capture.unevaluatedGate('corpus (58 + 7 + 8 entries)',
                                               '--route-table-only: the HTTP corpus was deliberately ' +
                                               'not walked'));

      return undefined;
    }

    state.corpusAttempted = true;

    return replayResponses(server, committedCorpus).then(function(result) {
      state.measured    = result.measured;
      state.differences = state.differences.concat(result.differences);
      state.gates       = state.gates.concat(result.gates);
      reportCorpus(result.measured);

      return undefined;
    });
  }).then(function() {
    var build = replayBuildArtifacts(committedCorpus);

    state.artifacts = build.artifacts;
    state.gates     = state.gates.concat(build.gates);

    return undefined;
  });
}

/** Prints everything, writes the optional report, and returns the exit code. */
function reportRun(committedTable, committedCorpus, options, state) {
  state.findings = reportBackFindings(committedTable, committedCorpus, state.table, state.measured,
                                     state.artifacts);

  if (options.verbose && state.measured) {
    reportEntryDetail(state.measured);
  }

  reportDifferences(state.differences);
  reportFindings(state.findings);
  console.log('replay.js: gate summary — every expectation below is read from the committed artifacts ' +
              'and every measured value is recomputed from this run:');

  // printGateSummary is the shared implementation, so the tally line it prints carries capture.js's
  // prefix — it is naming the module that owns the gate definitions. The BASELINE REPLAY line below
  // repeats the same tally under this tool's own label, which is the line to grep for.
  var tally    = capture.printGateSummary(state.gates, options.quiet),
      exitCode = state.differences.length || state.findings.length || tally.fail
        ? EXIT.DIFFERENT
        : EXIT.CLEAN;

  if (options.report) {
    fs.writeFileSync(options.report, JSON.stringify({
      tool        : 'test/baseline/replay.js',
      generatedAt : new Date().toISOString(),
      exitCode    : exitCode,
      baseCommit  : committedCorpus.metadata.baseCommit,
      appUrlOrigin: committedCorpus.metadata.appUrlOrigin,
      scope       : {
        routeTable : !options.corpusOnly,
        corpus     : !options.routeTableOnly
      },
      routeTable  : state.table ? {
        rowCount                     : state.table.rowCount,
        measuredSha256               : state.table.sortedDigest,
        measuredMd5                  : state.table.md5Digest,
        registrationOrderFingerprint : state.table.orderDigest,
        documentedAnchorGate         : {
          documentedDigest : state.table.anchorGate.documentedDigest,
          clauses          : state.table.anchorGate.clauses,
          failures         : state.table.anchorGate.failures,
          satisfied        : state.table.anchorGate.satisfied
        },
        gates                        : state.table.live.gates
      } : null,
      corpus      : state.measured ? {
        unauthenticated      : state.measured.unauthenticated.length,
        authenticated        : state.measured.authenticated.length,
        assignmentNext       : (state.measured.assignmentNext || []).length,
        firstHopDistribution : capture.statusDistribution(state.measured.unauthenticated),
        resolvedDistribution : capture.resolvedStatusDistribution(state.measured.unauthenticated)
      } : null,
      buildArtifacts : state.artifacts,
      gateTally      : tally,
      gates          : state.gates,
      differences    : state.differences,
      findings       : state.findings
    }, null, 2) + '\n', 'utf8');
    console.log('replay.js: machine-readable report written to ' + options.report);
  }

  reportSummary(state, tally, exitCode);

  if (exitCode !== EXIT.CLEAN) {
    console.log('replay.js: the baseline is the arbiter, never the migrated code. Fix the application ' +
                'or the harness; do not edit test/baseline/route-table.json or ' +
                'test/baseline/responses.json to make this run pass.');
  }

  return exitCode;
}

/**
 * Loads and validates the artifacts, proves the request policy, boots the migrated application,
 * replays both halves, and resolves with the exit code.
 *
 * It resolves rather than exiting so the single process.exit lives in the guarded entry point below,
 * where a synchronous throw from parseArgv or from the artifact loader is caught by the same handler.
 */
function main() {
  var options         = parseArgv(process.argv.slice(2)),
      loaded          = loadArtifacts(),
      committedTable  = loaded.table,
      committedCorpus = loaded.corpus,
      server          = null,
      state           = {
        differences     : [],
        gates           : [],
        findings        : [],
        table           : null,
        measured        : null,
        artifacts       : null,
        corpusAttempted : false
      };

  assertRequestPolicyConformance(committedCorpus);

  // The corpus is origin-specific by construction, so the recorded origin is reproduced through
  // NODE_CONFIG before app.js is required — the same mechanism as the port and the session password,
  // and no YAML is edited. Without it, a checkout carrying the config/local.yaml that docs/setup.md
  // tells a developer to create reports dozens of differences that are two bytes of configuration each
  // and say nothing about behavior. See constraint 4 in the file header.
  capture.configureRuntime(capture.corpusOriginOverride(committedCorpus));
  announce(committedCorpus, options);

  return startBaselineServer().then(function(started) {
    server = started;
    console.log('replay.js: real HTTP against ' + server.info.uri +
                ' (this harness never uses in-process injection; the app still does — ' +
                'PRESERVED-QUIRKS 7.6)');

    return replayHalves(server, committedTable, committedCorpus, options, state);
  }).then(function() {
    return teardown(server, state.corpusAttempted);
  }, function(err) {
    return teardown(server, state.corpusAttempted).then(function() {
      throw err;
    });
  }).then(function() {
    return reportRun(committedTable, committedCorpus, options, state);
  });
}

module.exports = {
  DOCUMENTED_DIGEST           : DOCUMENTED_DIGEST,
  DOCUMENTED_ROW_COUNT        : DOCUMENTED_ROW_COUNT,
  DOCUMENTED_CORPUS_SIZE      : DOCUMENTED_CORPUS_SIZE,
  EXIT                        : EXIT,
  preconditionFailure         : preconditionFailure,
  isPreconditionFailure       : isPreconditionFailure,
  validateCommittedArtifacts  : validateCommittedArtifacts,
  loadArtifacts               : loadArtifacts,
  requestPolicyMismatches     : requestPolicyMismatches,
  assertRequestPolicyConformance : assertRequestPolicyConformance,
  resolveReportPath           : resolveReportPath,
  sha256                      : sha256,
  md5                         : md5,
  authDescriptor              : authDescriptor,
  canonicalRow                : canonicalRow,
  liveServerAuthDefault       : liveServerAuthDefault,
  canonicalizeLiveTable       : canonicalizeLiveTable,
  registrationOrderCanonical  : registrationOrderCanonical,
  documentedAnchorGate        : documentedAnchorGate,
  pushDifference              : pushDifference,
  rowsByRouteKey              : rowsByRouteKey,
  diffRowSets                 : diffRowSets,
  driftGates                  : driftGates,
  replayRouteTable            : replayRouteTable,
  jsonMessagesAtStatus        : jsonMessagesAtStatus,
  errorMappingGates           : errorMappingGates,
  rebaseSection               : rebaseSection,
  rebaseAssignmentSection     : rebaseAssignmentSection,
  replayResponses             : replayResponses,
  locationKind                : locationKind,
  pagesQuirkFindings          : pagesQuirkFindings,
  serverErrorQuirkFindings    : serverErrorQuirkFindings,
  featureFlagFindings         : featureFlagFindings,
  locationFindings            : locationFindings,
  routeTableFindings          : routeTableFindings,
  buildArtifactFindings       : buildArtifactFindings,
  reportBackFindings          : reportBackFindings,
  replayBuildArtifacts        : replayBuildArtifacts,
  reportDifferences           : reportDifferences,
  reportFindings              : reportFindings,
  reportRouteTable            : reportRouteTable,
  reportCorpus                : reportCorpus,
  reportEntryDetail           : reportEntryDetail,
  reportSummary               : reportSummary,
  parseArgv                   : parseArgv,
  startBaselineServer         : startBaselineServer,
  teardown                    : teardown,
  replayHalves                : replayHalves,
  reportRun                   : reportRun,
  main                        : main
};

// AAP 0.7.5: the root .mocharc.json carries no `spec` and no `ignore` key, so mocha's default recursive
// glob loads this file on every `npm test` — first, in fact. Requiring this module must therefore be
// inert, and everything above this line is a declaration: no HTTP, no app.js, no datastore connection,
// no artifact read, no write and no process.exit happens until the guard below runs.
//
// The exit lives here rather than inside main() so that one place owns it, and so that a SYNCHRONOUS
// throw — an unknown flag, a malformed artifact, a --report path inside test/baseline/ — is reported
// and mapped to its exit code instead of surfacing as an unhandled rejection.
// Promise.resolve().then(main) is what converts such a throw into a rejection this chain can see.
//
// Exiting explicitly is mandatory: app.js's un-unref'd 60-second detectLeaks interval, the module-load
// mongoose connection in config/db.js and the eagerly created redis client each keep the event loop
// alive after the server has stopped, which is the same reason .mocharc.json carries "exit": true.
if (require.main === module) {
  Promise.resolve().then(main).then(function(exitCode) {
    process.exit(exitCode);
  }).catch(function(err) {
    if (isPreconditionFailure(err)) {
      console.error(err.message);
      console.error('BASELINE REPLAY: COULD NOT RUN — exit ' + EXIT.CANNOT_RUN + '. This is a ' +
                    'precondition failure, NOT a parity result: nothing about the application was ' +
                    'proven or disproven.');
      process.exit(EXIT.CANNOT_RUN);
    }

    console.error('replay.js: FAILED — ' + (err && err.stack ? err.stack : String(err)));
    console.error('BASELINE REPLAY: COULD NOT FINISH — exit ' + EXIT.CANNOT_RUN + '. The run aborted ' +
                  'partway, so its diff is not evidence of parity. The cause above is either a broken ' +
                  'environment or an application defect severe enough to abort the harness; ' +
                  'investigate it before drawing any conclusion about the baseline.');
    process.exit(EXIT.CANNOT_RUN);
  });
}

