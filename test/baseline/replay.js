/**
 * test/baseline/replay.js — replays the committed baseline against the running application and diffs.
 *
 * This is the falsification tool for the whole modernization. capture.js records the corpus; this file
 * re-issues it against whatever the working tree currently is and reports every difference. It NEVER
 * writes: the baseline is evidence, and a replay that "fixes" the evidence proves nothing.
 *
 * BEFORE IT DIFFS ANYTHING it establishes that a diff can mean something at all. Four preconditions are
 * checked, and each failure is reported as UNABLE TO RUN (exit 2) rather than as a difference, because
 * "this run never checked" and "this build changed behavior" are different facts:
 *
 *   P1. STRUCTURAL. Both artifacts must parse, carry the blocks the comparison reads, and hold the row
 *       and entry counts they declare — validateCommittedArtifacts(). A truncated or half-regenerated
 *       artifact is not a baseline, and replaying against one proves nothing.
 *   P2. REQUEST POLICY. Every header, timeout, redirect rule and throwaway identity this harness would
 *       use is compared against responses.json#requestPolicy and #metadata.throwawayUser —
 *       assertRequestPolicyConformance(). Requesting differently from the way the corpus was recorded
 *       makes a diff compare POLICIES rather than behavior: an Accept containing application/json alone
 *       turns the recorded 7x401 into 12x401, and the User-Agent reaches the templates through isMobile
 *       and aceOff.
 *   P3. ORIGIN. capture.js#originPrecondition — the corpus is origin-specific and nothing is rebased.
 *   P4. BUILD EVIDENCE. An absent stylesheet is unable-to-run, never a silent pass.
 *
 * It then checks both halves of the parity contract:
 *
 *   1. THE ROUTE TABLE. The 233 registered routes are canonicalized with the exact recipe
 *      recorded in route-table.json#canonicalization — "METHOD | path | authDescriptor | preCount",
 *      uppercase method, `false` for auth:false, `mode=<mode> strategies=["s1",...]` otherwise, one
 *      ASCII space around every pipe, default Array.prototype.sort(), joined with "\n" and no
 *      trailing newline — and hashed. Both digests are checked: the sorted sha256
 *      (gates.measuredSha256) and the registration-order fingerprint
 *      (gates.registrationOrderFingerprint), the latter derived independently from config.routes,
 *      which is the array app.js hands to server.route(). Every countable gate in the artifact is
 *      recomputed from the live table as well. On top of those, documentedAnchorGate() evaluates the
 *      published anchor for this table as a MANDATORY pass/fail gate — eleven clauses, computed
 *      live, including that the frozen 32-character digest literal is
 *      still stored verbatim, that the 233 canonical rows it names are unchanged, and that the sorted
 *      sha256 RECOMPUTED from those live rows equals the stored one.
 *      The table is ALSO derived a second, independent way — through capture.js#captureRouteTable,
 *      which walks config.routes and hashes for itself — and driftGates() compares the two derivations
 *      against EACH OTHER as well as against the artifact, so "the two derivations agree" is a
 *      checked result on every run instead of an assumption.
 *
 *   2. THE RESPONSE CORPUS. All three sections — the 58 parameterless GETs, the 7-entry
 *      authenticated supplement and the 8-entry assignment-`next` supplement — are re-issued over real
 *      HTTP by capture.js's own helpers, under capture.js's own normalization, and compared field by
 *      field. Only the unauthenticated section carries the additive resolved reading, and it is compared
 *      too; the other two are first-hop only, by the policy the artifact records.
 *
 *   3. THE BUILD ARTIFACTS. The two stylesheets the corpus pins are re-checked here independently of
 *      capture.js — byte length, sha256 and the source-map count — because a replay that checks the
 *      HTTP surface while ignoring the build output has verified half the parity claim and reported
 *      all of it.
 *
 *   4. THE DECLARED GATES AND THE REPORT-BACK OBLIGATIONS. Every gate the artifacts publish is
 *      re-evaluated through capture.js's own gate builders — corpusGates, cookieContractGates,
 *      buildArtifactGates — plus errorMappingGates() here, which asserts the error-message asymmetry
 *      directly: a 4xx message is client-visible and compared byte for byte, a 5xx message is scrubbed
 *      by hapi and must not be asserted. On top of the gates, reportBackFindings() names the specific
 *      prohibited changes a replay must REPORT rather than merely diff — the authenticated
 *      /login and /signup 500s, the pre-existing 500 at GET /api/users/assets, the feature-flag 404
 *      set, an absolute-versus-relative Location flip, a route-count change and a stylesheet change.
 *      A finding is by construction a prohibited change, so a non-empty list fails the run.
 *
 * The comparison deliberately reuses capture.js rather than reimplementing it: one normalization
 * implementation means a replay pass cannot be manufactured by a subtly different normalizer. The
 * artifact's prohibition applies here in full — "Do NOT normalize away a difference in order to make a
 * replay diff pass." A real difference is an application-code defect and must be reported as one. For
 * the same reason this file injects NO configuration of its own: the app.url origin is a precondition
 * checked through capture.js#originPrecondition, and a mismatch is reported as unable-to-run rather than
 * rewritten out of the comparison.
 *
 * USAGE
 *   node test/baseline/replay.js                        full replay; exit 0 only if nothing differs
 *   node test/baseline/replay.js --quiet                summary lines only, no per-difference detail
 *   node test/baseline/replay.js --verbose              every gate and clause, not just the failures
 *   node test/baseline/replay.js --route-table-only     the 233-row table only, no HTTP corpus
 *   node test/baseline/replay.js --corpus-only          the response corpus only, no route table
 *   node test/baseline/replay.js --report <path>        also write a machine-readable JSON report
 *
 * EXIT CODES
 *   0  parity: nothing differed, and everything this run was asked to check was checked
 *   1  a real difference against the baseline — an application-code defect to report
 *   2  unable to run: bad or conflicting flags, a missing or malformed artifact, an app.url origin that
 *      does not match the one the corpus was captured under, absent required build evidence, a boot or
 *      request failure, an unsafe or unwritable report path, or a failure to remove a throwaway identity
 */

var crypto   = require('crypto'),
    fs       = require('fs'),
    path     = require('path'),
    nodeUtil = require('node:util'),
    capture  = require('./capture');

// Route-table canonicalization — route-table.json#canonicalization, reproduced exactly

function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * Canonicalization AND the documented-anchor evaluator are DELEGATED to test/baseline/capture.js rather
 * than reimplemented here. There is exactly ONE implementation of each, in the harness that OWNS the
 * artifacts — which is also what lets capture.js regenerate gates.documentedAnchorGateSatisfied instead
 * of carrying a hand-authored boolean — and these are its names in this file. Two copies of a
 * canonicalizer, or a gate declared in one file and advertised as living in another, is how a gate rots:
 * it ends up enforced in one file and UNEVALUATED in the other, and the artifact can no longer name a
 * single honest evaluator.
 *
 * The delegation is safe because capture.js#canonicalizeLiveTable consults NOTHING committed — every
 * value it returns is derived from server.table() and server.auth.settings.default — so a replay still
 * cannot be contaminated by the artifact it is about to be compared against.
 *
 * The third verifier, test/lib/api/route-parity.js, shares none of this code and loads neither artifact:
 * it recomputes the same clauses, the same sorted row set and the same three fingerprints from its own
 * in-file literals, so a defect in this shared implementation cannot make that suite pass.
 */
var authDescriptor        = capture.authDescriptor;
var canonicalRow          = capture.canonicalRow;
var liveServerAuthDefault = capture.liveServerAuthDefault;
var canonicalizeLiveTable = capture.canonicalizeLiveTable;

/**
 * The registration order, derived independently of the committed row order: config.routes is the array
 * app.js:L304 passes to server.route(), so its order IS the registration order. Each declaration is
 * mapped onto the live canonical string for its (METHOD, path) key, exactly as route-table.json#ADJ-5
 * describes, because server.table() returns ROUTER order rather than registration order.
 */
var registrationOrderCanonical = capture.registrationOrderCanonical;

/**
 * The published 32-character anchor and its ten-clause evaluator, re-exported from their single home in
 * capture.js. Nothing here declares a second copy of either.
 */
var DOCUMENTED_DIGEST    = capture.DOCUMENTED_DIGEST;
var documentedAnchorGate = capture.documentedAnchorGate;

/** The two counts the Technical Specification publishes, used by the structural precondition below. */
var DOCUMENTED_ROW_COUNT   = 233;
var DOCUMENTED_CORPUS_SIZE = 58;

// Preconditions — everything that must hold before a diff can mean anything

/**
 * A precondition failure, marked so main() maps it onto exit code 2 rather than 1. Every message built
 * with this is written for the operator who has to fix it, not for a stack-trace reader.
 *
 * @param   {string} message The operator-facing explanation, including the remedy.
 * @returns {Error}  The marked error.
 */
function preconditionFailure(message) {
  var failure = new Error(message);

  failure.baselinePrecondition = true;

  return failure;
}

/**
 * @param   {*} err Any thrown value.
 * @returns {Boolean} true when it was built by preconditionFailure().
 */
function isPreconditionFailure(err) {
  return !!(err && err.baselinePrecondition);
}

/**
 * Structural validation of the two committed artifacts. This is not a parity check — it is the check
 * that a parity check is even POSSIBLE.
 *
 * The ordering requirement behind it is non-negotiable: a corpus captured after the migration would
 * prove only self-consistency, so a missing, truncated or half-regenerated artifact must stop the run
 * with instructions rather than silently replay against whatever is present. Every block named below is
 * one the comparison actually reads, so its absence would otherwise turn into a comparison against
 * `undefined` — which passes.
 *
 * @param   {Object} committedTable  route-table.json.
 * @param   {Object} committedCorpus responses.json.
 * @returns {Array}  The (empty) problem list, for callers that want to report rather than throw.
 * @throws  {Error}  A precondition failure listing every problem found.
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

    if (typeof committedTable.gates.registrationOrderFingerprint !== 'string') {
      problems.push('route-table.json#gates.registrationOrderFingerprint is missing, so the ' +
                    'registration order cannot be compared');
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

    if (!Array.isArray(committedCorpus.assignmentNext)) {
      problems.push('responses.json is missing its `assignmentNext` supplement');
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

    if (!committedCorpus.errorMappingContract) {
      problems.push('responses.json is missing its `errorMappingContract` block, so the R-5 message ' +
                    'asymmetry cannot be gated');
    }

    if (!committedCorpus.buildArtifacts) {
      problems.push('responses.json is missing its `buildArtifacts` block, so the compiled ' +
                    'stylesheets cannot be gated');
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

  return problems;
}

/**
 * Every way this harness could request differently from the way the corpus was recorded, checked against
 * responses.json#requestPolicy rather than against a copy of it kept here.
 *
 * Each row is load-bearing, and each would silently INVALIDATE the diff rather than break it:
 *  - an Accept header containing application/json would make app.js's isApiRequest true for every path
 *    and turn the recorded 7x401 into 12x401;
 *  - a different User-Agent changes isMobile and aceOff (responseContract.js), which reach the templates
 *    and therefore the recorded body digests;
 *  - a different referer is a different config.url claim;
 *  - following the first hop would discard the recorded 3xx and its literal Location;
 *  - a different resolution reading changes the resolved tally the documented distribution is taken from;
 *  - a different throwaway identity changes recorded content-lengths and, through the rendered fullname,
 *    the recorded authenticated /home digest.
 *
 * @param   {Object} committedCorpus responses.json.
 * @returns {Array}  Human-readable mismatches; empty when this harness would request identically.
 */
function requestPolicyMismatches(committedCorpus) {
  var policy     = committedCorpus.requestPolicy,
      headers    = policy.headersSent || {},
      resolution = policy.resolutionReading || {},
      identity   = (committedCorpus.metadata && committedCorpus.metadata.throwawayUser) || {},
      mismatches = [];

  function check(subject, recorded, harness) {
    if (capture.stableStringify(recorded) !== capture.stableStringify(harness)) {
      mismatches.push(subject + ': artifact records ' + capture.stableStringify(recorded) +
                      ', this harness would send ' + capture.stableStringify(harness));
    }
  }

  // capture.POLICY carries no `accept` key at all, which is what the recorded null means.
  check('requestPolicy.acceptHeader', policy.acceptHeader,
        capture.POLICY.accept === undefined ? null : capture.POLICY.accept);
  check('requestPolicy.refererHeader', policy.refererHeader, capture.POLICY.referer);
  check('requestPolicy.userAgent', policy.userAgent, capture.POLICY.userAgent);
  check('requestPolicy.followRedirects', policy.followRedirects, capture.POLICY.followRedirects);
  check('requestPolicy.timeoutMs', policy.timeoutMs, capture.POLICY.timeoutMs);
  check('requestPolicy.headersSent.everyRequest', headers.everyRequest,
        { referer : capture.POLICY.referer, 'user-agent' : capture.POLICY.userAgent });
  check('requestPolicy.resolutionReading.appliesTo', resolution.appliesTo, capture.RESOLUTION.sections);
  check('requestPolicy.resolutionReading.sendsCookies', resolution.sendsCookies,
        capture.RESOLUTION.sendsCookies);
  check('requestPolicy.resolutionReading.runsAfter', resolution.runsAfter, capture.RESOLUTION.runsAfter);

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

  // The two recorded POST /login request content-lengths are 54 + passwordLength and
  // 54 + wrongPassword.length, so the wrong password's LENGTH is itself a recorded input even though the
  // text is never rendered. It is read out of the recorded measurement rather than restated here.
  var recordedLengths = ((headers.postLoginAlsoSends || {}).measuredLengths) || {};

  if (typeof recordedLengths.invalidCredentials === 'number' &&
      typeof identity.passwordLength === 'number') {
    check('metadata.throwawayUser invalid-password request length',
          recordedLengths.invalidCredentials,
          recordedLengths.validCredentials - identity.passwordLength +
            capture.THROWAWAY.wrongPassword.length);
  }

  return mismatches;
}

/**
 * Aborts rather than replaying under a policy the corpus was not recorded under.
 *
 * @param   {Object} committedCorpus responses.json.
 * @returns {Array}  The (empty) mismatch list.
 * @throws  {Error}  A precondition failure naming every mismatch and its remedy.
 */
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

// Route-table replay

function pushDifference(differences, section, subject, expected, actual) {
  if (capture.stableStringify(expected) === capture.stableStringify(actual)) {
    return;
  }

  differences.push({
    section  : section,
    entry    : subject,
    field    : subject,
    expected : capture.stableStringify(expected),
    actual   : capture.stableStringify(actual)
  });
}

/**
 * The anti-drift gates for the two independent derivations of the same live table.
 *
 * This file canonicalizes the table one way — canonicalizeLiveTable() plus its own hashing of the sorted
 * set and the registration order — and capture.js#captureRouteTable derives it another, walking
 * config.routes and computing routeTableDigests() for itself. Both are compared against the same
 * committed digests above; these gates compare them against EACH OTHER, so "the two derivations agree"
 * is a checked result on every run rather than an assumption. A replay that agreed with the artifact
 * only because both derivations shared one bug fails here.
 *
 * @param   {Object} live     A canonicalizeLiveTable() result.
 * @param   {Object} captured A capture.captureRouteTable() result for the same server.
 * @returns {Array}  capture.gate() entries.
 */
function driftGates(live, captured) {
  var sortedText  = live.canonical.slice().sort().join('\n'),
      liveDigests = {
        measuredSha256               : sha256(sortedText),
        measuredMd5                  : capture.md5(sortedText),
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
    capture.gate('canonicalization drift: unresolved declarations agree with capture.js',
                 captured.missingDeclarations, registrationOrderCanonical(live).missing),
    capture.gate('canonicalization drift: the three digests agree with capture.js', {
      measuredSha256               : captured.digests.measuredSha256,
      measuredMd5                  : captured.digests.measuredMd5,
      registrationOrderFingerprint : captured.digests.registrationOrderFingerprint
    }, liveDigests)
  ];
}

function replayRouteTable(server, committedTable) {
  var live        = canonicalizeLiveTable(server, committedTable),
      captured    = capture.captureRouteTable(server),
      differences = [],
      committedCanonical = committedTable.rows.map(function(row) { return row.canonical; }),
      sortedDigest = sha256(live.canonical.slice().sort().join('\n')),
      order        = registrationOrderCanonical(live),
      orderDigest  = sha256(order.canonical.join('\n')),
      anchorGate   = documentedAnchorGate(live, committedTable);

  // The documented anchor first, because it is the mandatory gate: an unsatisfied clause is a parity
  // failure, and the artifact's own record of the gate has to agree with what was just measured.
  pushDifference(differences, 'route-table', 'gates.documentedAnchorGate (unsatisfied clauses)',
                 [], anchorGate.failures);
  pushDifference(differences, 'route-table', 'gates.documentedAnchorGateSatisfied',
                 true, committedTable.gates.documentedAnchorGateSatisfied === true &&
                       anchorGate.satisfied);

  pushDifference(differences, 'route-table', 'rows (sorted canonical set)',
                 committedCanonical.slice().sort(), live.canonical.slice().sort());
  pushDifference(differences, 'route-table', 'gates.measuredSha256',
                 committedTable.gates.measuredSha256, sortedDigest);
  pushDifference(differences, 'route-table', 'gates.measuredMd5',
                 committedTable.gates.measuredMd5,
                 crypto.createHash('md5').update(live.canonical.slice().sort().join('\n'), 'utf8')
                   .digest('hex'));
  pushDifference(differences, 'route-table', 'gates.registrationOrderFingerprint',
                 committedTable.gates.registrationOrderFingerprint, orderDigest);
  pushDifference(differences, 'route-table', 'registration order: declarations resolved',
                 [], order.missing);

  ['rowCount', 'methods', 'apiPaths', 'withPreHandlers', 'authRequiredSession', 'authFalse',
   'authTryInherited'].forEach(function(gate) {
    pushDifference(differences, 'route-table', 'gates.' + gate,
                   committedTable.gates[gate], live.gates[gate]);
  });

  pushDifference(differences, 'route-table',
                 'canonicalization.empiricalAuthShape.rawSettingsAuthTally',
                 committedTable.canonicalization.empiricalAuthShape.rawSettingsAuthTally,
                 live.rawSettingsAuthTally);
  pushDifference(differences, 'route-table',
                 'canonicalization.empiricalAuthShape.serverAuthSettingsDefault',
                 committedTable.canonicalization.empiricalAuthShape.serverAuthSettingsDefault,
                 live.serverAuthDefault);

  // The registration order compared ROW BY ROW, not only through its fingerprint. The fingerprint alone
  // names that something moved; this names what moved, which is what an operator needs.
  pushDifference(differences, 'route-table', 'registration order (full row list)',
                 committedTable.rows.map(function(row) { return row.canonical; }), order.canonical);

  return {
    differences  : differences,
    rowCount     : live.gates.rowCount,
    sortedDigest : sortedDigest,
    orderDigest  : orderDigest,
    anchorGate   : anchorGate,
    gates        : live.gates,
    // The artifact's own declared gates, re-evaluated, plus the cross-derivation drift gates.
    gateEntries  : capture.routeTableGates(committedTable, captured).concat(driftGates(live, captured))
  };
}

// Response-corpus replay

function replayResponses(server, committedCorpus) {
  return capture.captureCorpus(server, committedCorpus).then(function(measured) {
    var differences = capture.compareCorpus(committedCorpus, measured);

    pushDifference(differences, 'responses', 'gates.measuredDistribution',
                   committedCorpus.gates.measuredDistribution,
                   capture.resolvedStatusDistribution(measured.unauthenticated));
    // The resolved reading of the same corpus: the terminal status of every recorded Location chain.
    // This is the reading that reproduces the Technical Specification's published 25/7/25/1 tally, so it
    // is gated exactly as hard as the first-hop reading.
    pushDifference(differences, 'responses', 'gates.firstHopStatusDistribution',
                   committedCorpus.gates.firstHopStatusDistribution,
                   capture.statusDistribution(measured.unauthenticated));
    pushDifference(differences, 'responses', 'gates.resolvedStatusDistribution',
                   committedCorpus.gates.resolvedStatusDistribution,
                   capture.resolvedStatusDistribution(measured.unauthenticated));
    pushDifference(differences, 'responses', 'gates.hopCountHistogram',
                   committedCorpus.gates.hopCountHistogram,
                   capture.hopCountHistogram(measured.unauthenticated));
    pushDifference(differences, 'responses', 'gates.redirectingRouteCount',
                   committedCorpus.gates.redirectingRouteCount,
                   capture.redirectingEntryPaths(measured.unauthenticated).length);
    pushDifference(differences, 'responses', 'gates.redirectingRoutePaths',
                   committedCorpus.gates.redirectingRoutePaths,
                   capture.redirectingEntryPaths(measured.unauthenticated));
    pushDifference(differences, 'responses', 'gates.redirectResolution',
                   committedCorpus.gates.redirectResolution,
                   capture.redirectResolutionDistribution(measured.unauthenticated));
    // The authenticated supplement has ONE reading by design: resolving it needs the session cookie and a
    // cookie-bearing hop consumes flash state (capture.js constraint 4). The flagship 500 quirk is
    // unaffected either way, because GET /login and GET /signup authenticated are terminal 500s.
    pushDifference(differences, 'responses', 'gates.authenticatedFirstHopStatuses',
                   committedCorpus.gates.authenticatedFirstHopStatuses,
                   capture.authenticatedStatusMap(measured.authenticated));
    pushDifference(differences, 'responses', 'gates.unauthenticatedEntryCount',
                   committedCorpus.gates.unauthenticatedEntryCount, measured.unauthenticated.length);
    pushDifference(differences, 'responses', 'gates.authenticatedEntryCount',
                   committedCorpus.gates.authenticatedEntryCount, measured.authenticated.length);
    // The assignment `next` supplement. gates.assignmentNextLocations pins the two consuming hops, which
    // carry the destination itself, so a build that discards a same-origin absolute destination answers
    // the declared success.redirect there and fails here.
    // Compared LITERALLY, origin included: originPrecondition() has already established that this process
    // is configured for the origin the corpus was captured under, so there is nothing to rebase.
    pushDifference(differences, 'responses', 'gates.assignmentNextEntryCount',
                   committedCorpus.gates.assignmentNextEntryCount,
                   (measured.assignmentNext || []).length);
    pushDifference(differences, 'responses', 'gates.assignmentNextStatuses',
                   committedCorpus.gates.assignmentNextStatuses,
                   capture.assignmentNextStatusMap(measured.assignmentNext));
    pushDifference(differences, 'responses', 'gates.assignmentNextLocations',
                   committedCorpus.gates.assignmentNextLocations,
                   capture.assignmentNextLocationMap(measured.assignmentNext));
    // The cache-prefix {assetType} confinement probes. Gated in
    // BOTH directions by construction: the traversal rows are recorded at 404 and the legitimate row at
    // 200, so re-opening the escape and over-rejecting a real asset each report a difference here.
    pushDifference(differences, 'responses', 'gates.assetConfinementStatuses',
                   committedCorpus.gates.assetConfinementStatuses,
                   capture.assetConfinementStatusMap(measured.assetConfinement));
    pushDifference(differences, 'responses', 'selectionRule.expectedCount',
                   committedCorpus.selectionRule.expectedCount, measured.unauthenticated.length);
    pushDifference(differences, 'responses', 'selectionRule.paths',
                   committedCorpus.selectionRule.paths,
                   measured.unauthenticated.map(function(entry) { return entry.path; }));

    return {
      differences : differences,
      measured    : measured,
      // Every gate the corpus declares, re-evaluated through capture.js's own builders — so the replay
      // enforces the published contract rather than only the per-entry field comparison — plus the
      // error-message asymmetry, gated explicitly here.
      gateEntries : capture.corpusGates(committedCorpus, measured, capture.liveAppUrlOrigin())
                      .concat(capture.cookieContractGates(committedCorpus, measured))
                      .concat(capture.assetConfinementGates(committedCorpus, measured))
                      .concat(errorMappingGates(committedCorpus, measured))
    };
  });
}

/**
 * Every JSON body message observed at one status, de-duplicated, in sorted order.
 *
 * @param   {Array}  entries A corpus section.
 * @param   {Number} status  The status to collect messages for.
 * @returns {Array}  Sorted unique message strings.
 */
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
 * The error-message asymmetry, gated explicitly rather than left implicit in the body-shape comparison.
 *
 * responses.json#errorMappingContract.messageComparisonRule records the asymmetry: a 4xx message is
 * passed through to the client and must be compared byte for byte, while a 5xx message is replaced by
 * hapi with a fixed string, so internal error text is unobservable and must NOT be asserted. Both halves
 * are checked here against the artifact's own recorded values — the 401 message every one of the seven
 * unauthorized bodies carries (the no-session branch of the four Boom.unauthorized strings constructed in
 * app.js's auth scheme), and the scrubbed 500 message.
 *
 * @param   {Object} committedCorpus responses.json.
 * @param   {Object} measured        A capture.captureCorpus() result.
 * @returns {Array}  capture.gate() entries.
 */
function errorMappingGates(committedCorpus, measured) {
  var contract    = committedCorpus.errorMappingContract || {},
      expected401 = contract.unauthorizedMessageMeasuredInEvery401,
      gates       = [
        capture.gate('errorMapping 4xx message passed through (401 bodies)',
                     expected401 === undefined ? [] : [expected401],
                     jsonMessagesAtStatus(measured.unauthenticated, 401)),
        capture.gate('errorMapping 4xx message is one of the constructed unauthorized strings',
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

// Report-back findings — named in the language the finding has to be reported in

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

/**
 * How a Location reads: absolute on the corpus origin, absolute somewhere else, root-relative, or absent.
 *
 * Parsing uses the NON-THROWING static URL.parse — the legacy node:url parse function warns under
 * --pending-deprecation and `new URL('/relative')` throws ERR_INVALID_URL — and its null return is
 * handled, because a Location the parser rejects is itself a finding rather than a crash. Same-origin is
 * decided by capture.sameOrigin(), which is exact WHATWG origin equality rather than a prefix test: the
 * corpus deliberately carries the lookalike shapes that defeat a prefix match.
 *
 * @param   {*}      location The recorded or measured Location header.
 * @param   {String} origin   The corpus origin.
 * @returns {String} 'none' | 'scheme-relative' | 'relative' | 'absolute-same-origin' |
 *                   'absolute-other-origin' | 'relative-reference' | 'unparseable'.
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
  // which is what separates a genuinely absolute Location from a base-relative reference.
  if (URL.parse(location)) {
    return capture.sameOrigin(location, origin) ? 'absolute-same-origin' : 'absolute-other-origin';
  }

  return URL.parse(location, origin || undefined) ? 'relative-reference' : 'unparseable';
}

/** The authenticated entry for one page, by the state label capture.js records. */
function authenticatedEntry(entries, method, requestPath) {
  return capture.findEntry(entries, method, requestPath, 'authenticated');
}

/**
 * The flagship quirk: authenticated GET /login and GET /signup answer 500 rather than redirecting.
 * lib/controllers/pages.js raises the internal error deliberately; issuing h.redirect(...) instead would
 * silently "fix" this into a 302 on a login page, which is a prohibited behavior improvement. The corpus
 * is never adjusted to match. See docs/PRESERVED-QUIRKS.md section 1.1.
 *
 * @param   {Object} committedCorpus responses.json.
 * @param   {Object} measured        A capture.captureCorpus() result.
 * @returns {Array}  finding() entries.
 */
function pagesQuirkFindings(committedCorpus, measured) {
  var published = committedCorpus.gates,
      findings  = [];

  [
    { path : '/login', baseline : published.authenticatedLoginStatus,
      line : 'the property-form reply.redirect(\'/home\')' },
    { path : '/signup', baseline : published.authenticatedSignupStatus,
      line : 'the property-form reply.redirect(\'/welcome\')' }
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
                          'measured ' + page.baseline + ' survives. Report it to the ' +
                          'lib/controllers/pages.js owner and to docs/PRESERVED-QUIRKS.md; do NOT ' +
                          'adjust the corpus.'));
  });

  return findings;
}

/**
 * Quirk I14: exactly one 500 in the unauthenticated corpus, at GET /api/users/assets, delivered as Boom
 * JSON rather than a rendered 50x.html because the /api/ prefix makes it an API request. A 200 or a 400
 * here means the quirk was repaired.
 *
 * @param   {Object} committedCorpus responses.json.
 * @param   {Object} measured        A capture.captureCorpus() result.
 * @returns {Array}  finding() entries.
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
                          'validate.query.type as optional and lib/controllers/users.js reads ' +
                          'request.query.type unguarded. A 200 or a 400 at GET /api/users/assets is a ' +
                          'prohibited behavior change (R-4). Report it to docs/PRESERVED-QUIRKS.md.'));
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
 * The feature-flag 404s. lib/util/features.js#isTrinketTypeEnabled returns trinketFeatures[lang] === true
 * when the key exists and `false` otherwise, while the comment above it claims the opposite;
 * isKnownTrinketType is a bare hasOwnProperty, and config/default.yaml enables only python. Both the code
 * and the contradictory comment stay.
 *
 * @param   {Object} committedCorpus responses.json.
 * @param   {Object} measured        A capture.captureCorpus() result.
 * @returns {Array}  finding() entries.
 */
function featureFlagFindings(committedCorpus, measured) {
  var published     = committedCorpus.gates,
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
 * Location absolute-versus-relative parity, per entry, across all three sections.
 *
 * This is the class of regression the recorded Location patterns exist to detect: the declarative
 * responders absolutize through lib/http/redirect.js, a raw `h.redirect(x)` stays relative, and the
 * onPreResponse 401 branch redirects to the bare relative '/login'.
 *
 * Entries are compared exactly as observed. No origin rebasing happens here or anywhere in this
 * harness: originPrecondition() has already established that this process is configured for the origin
 * the corpus was captured under, so there is nothing to rebase — and rebasing would let a build that
 * emits the wrong configured origin replay clean.
 *
 * @param   {Object} committedCorpus responses.json.
 * @param   {Object} measured        A capture.captureCorpus() result.
 * @returns {Array}  finding() entries.
 */
function locationFindings(committedCorpus, measured) {
  var origin   = (committedCorpus.metadata && committedCorpus.metadata.appUrlOrigin) || null,
      findings = [];

  [
    { name : 'unauthenticated', committed : committedCorpus.unauthenticated,
      measured : measured.unauthenticated },
    { name : 'authenticated', committed : committedCorpus.authenticated,
      measured : measured.authenticated },
    { name : 'assignmentNext', committed : committedCorpus.assignmentNext || [],
      measured : measured.assignmentNext || [] }
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
                            'test/helpers/flow.js and the lastRedirect.pathname assertions that ride ' +
                            'on it. Report it to docs/PRESERVED-QUIRKS.md.'));
    });
  });

  return findings;
}

/**
 * A row-count regression, with the eight NULL app.prefixes entries named when the count says 241.
 *
 * @param   {Object} committedTable route-table.json.
 * @param   {Object} table          A replayRouteTable() result, or null under --corpus-only.
 * @returns {Array}  finding() entries.
 */
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
                  ' The row-level differences above name every added, removed and changed row. Report ' +
                  'it to docs/PRESERVED-QUIRKS.md.')];
}

/**
 * Build-artifact regressions, including the appearance of a .css.map that vite has never emitted.
 *
 * @param   {Object} committedCorpus responses.json.
 * @param   {Object} artifacts       A capture.measureBuildArtifacts() result.
 * @returns {Array}  finding() entries.
 */
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
 * non-empty list is a FAILING run — it is counted towards the exit code alongside the differences.
 *
 * @param   {Object} committedTable  route-table.json.
 * @param   {Object} committedCorpus responses.json.
 * @param   {Object} table           A replayRouteTable() result, or null.
 * @param   {Object} measured        A capture.captureCorpus() result, or null.
 * @param   {Object} artifacts       A capture.measureBuildArtifacts() result, or null.
 * @returns {Array}  finding() entries.
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

// Build-artifact replay

/**
 * Re-checks the two stylesheets the corpus pins and compares byte length, sha256 and the source-map
 * count against responses.json#buildArtifacts.
 *
 * This is deliberately its own comparison rather than a call into capture.js's gate builder: the build
 * output is one of the two halves of the parity claim — base.css at 265,727 bytes, embed.css at 296,352
 * and an emitted .map count of zero. A file that is absent is NOT reported as a difference — the
 * checkout was simply never built, which responses.json#buildArtifacts.precondition describes — but it
 * IS reported as unable-to-run, so a replay cannot announce parity over evidence it never looked at.
 *
 * @param   {Object} committedCorpus The committed responses.json.
 * @returns {Object} { differences, unevaluated, measured }
 */
function replayBuildArtifacts(committedCorpus) {
  var published   = committedCorpus.buildArtifacts || {},
      measured    = capture.measureBuildArtifacts(),
      differences = [],
      unevaluated = [];

  capture.BUILD_ARTIFACT_FILES.forEach(function(relative) {
    if (!measured.files[relative]) {
      unevaluated.push(relative + ' is absent from this checkout — ' +
                       (published.precondition || 'hydrate public/components, then `npm run build`'));

      return;
    }

    pushDifference(differences, 'build', 'buildArtifacts ' + relative, published[relative],
                   measured.files[relative]);
  });

  if (measured.cssMapFilesEmitted === null) {
    unevaluated.push('public/css does not exist, so the source-map count could not be measured');
  }
  else {
    pushDifference(differences, 'build', 'buildArtifacts cssMapFilesEmitted',
                   published.cssMapFilesEmitted, measured.cssMapFilesEmitted);
  }

  return { differences : differences, unevaluated : unevaluated, measured : measured };
}

// CLI

/**
 * The command line, parsed strictly with node:util.parseArgs. The hand-rolled loop
 * this replaces had three defects that a strict parser makes impossible: an unknown flag was silently
 * ignored, so `--verbsoe` ran a different check than the operator asked for and said nothing;
 * `--json --quiet` consumed `--quiet` as the report FILENAME, writing a file called "--quiet"; and the
 * flags the harness is documented to accept did not all exist.
 *
 * Conflicts are rejected rather than silently ordered: --quiet and --verbose contradict each other, and
 * so do the two narrowing flags.
 */
function parseArgv(argv) {
  var parsed = nodeUtil.parseArgs({
    args   : argv,
    strict : true,
    allowPositionals : false,
    options : {
      quiet               : { type : 'boolean', default : false },
      verbose             : { type : 'boolean', default : false },
      'route-table-only'  : { type : 'boolean', default : false },
      'corpus-only'       : { type : 'boolean', default : false },
      report              : { type : 'string' }
    }
  }).values;

  if (parsed.quiet && parsed.verbose) {
    throw new Error('replay.js: --quiet and --verbose contradict each other. Pass one or neither.');
  }

  if (parsed['route-table-only'] && parsed['corpus-only']) {
    throw new Error('replay.js: --route-table-only and --corpus-only contradict each other. Pass one, ' +
                    'or neither to replay both halves.');
  }

  return {
    quiet          : parsed.quiet,
    verbose        : parsed.verbose,
    routeTableOnly : parsed['route-table-only'],
    corpusOnly     : parsed['corpus-only'],
    // Validated with capture.js's own path guard, so a report cannot be aimed at the committed evidence,
    // at repository source, through a symlink or over an existing file.
    report         : parsed.report === undefined ? null : capture.validateOutPath(parsed.report, '--report')
  };
}

function report(differences, options) {
  if (!differences.length) {
    console.log('replay.js: 0 differences — the running application replays the R-6 baseline exactly.');

    return;
  }

  console.log('replay.js: ' + differences.length + ' DIFFERENCE(S) against the R-6 baseline.');

  if (options.quiet) {
    return;
  }

  differences.forEach(function(difference) {
    console.log('  ' + difference.section + ' :: ' + difference.entry);
    console.log('    baseline: ' + String(difference.expected).slice(0, options.verbose ? 4000 : 400));
    console.log('    current : ' + String(difference.actual).slice(0, options.verbose ? 4000 : 400));
  });
}

/**
 * Prints the report-back obligations. Each one names WHAT to report and WHERE, because these particular
 * changes are a reporting duty rather than a judgement call.
 *
 * @param {Array} findings finding() entries.
 */
function reportFindings(findings) {
  if (!findings.length) {
    console.log('replay.js: 0 report-back findings — every preserved quirk this harness watches held.');

    return;
  }

  console.error('replay.js: ' + findings.length + ' REPORT-BACK FINDING(S). Each is a prohibited ' +
                'change, not a new baseline.');

  findings.forEach(function(entry) {
    console.error('  [' + entry.id + '] ' + entry.subject);
    console.error('    baseline: ' + entry.baseline.slice(0, 400));
    console.error('    measured: ' + entry.measured.slice(0, 400));
    console.error('    report  : ' + entry.report);
  });
}

/**
 * Rejects an artifact this run cannot honestly replay against, BEFORE booting anything. A missing or
 * malformed artifact, or one lacking the blocks the comparison reads, is unable-to-run (exit 2) rather
 * than a difference: there is no baseline to differ from.
 *
 * @param   {string} label      Which artifact, for the message.
 * @param   {string} file       Absolute path.
 * @param   {Array}  requiredKeys Top-level keys the comparison depends on.
 * @returns {Object} The parsed artifact.
 * @throws  {Error}  When it is absent, unparseable or incomplete.
 */
function loadRequiredArtifact(label, file, requiredKeys) {
  var raw, parsed;

  try {
    raw = fs.readFileSync(file, 'utf8');
  }
  catch (err) {
    throw preconditionFailure('replay.js: the ' + label + ' artifact is missing (' + file + '). There ' +
                              'is no baseline to replay against. Run `node test/baseline/capture.js ' +
                              '--write` on the base commit first.');
  }

  try {
    parsed = JSON.parse(raw);
  }
  catch (err) {
    throw preconditionFailure('replay.js: the ' + label + ' artifact at ' + file + ' is not valid ' +
                              'JSON (' + err.message + ').');
  }

  var missing = requiredKeys.filter(function(key) {
    return parsed[key] === undefined || parsed[key] === null;
  });

  if (missing.length) {
    throw preconditionFailure('replay.js: the ' + label + ' artifact at ' + file + ' is missing the ' +
                              'block(s) the comparison reads: ' + missing.join(', ') + '.');
  }

  return parsed;
}

/**
 * Loads BOTH artifacts and validates them structurally, so nothing boots until a diff could mean
 * something.
 *
 * @returns {Object} `{ table, corpus }`.
 * @throws  {Error}  A precondition failure when either artifact is unusable.
 */
function loadArtifacts() {
  var committedTable = loadRequiredArtifact('route-table', capture.ROUTE_TABLE_PATH,
                                            ['metadata', 'gates', 'canonicalization', 'rows']),
      committedCorpus = loadRequiredArtifact('responses', capture.ARTIFACT_PATH,
                                             ['metadata', 'gates', 'selectionRule', 'requestPolicy',
                                              'normalizationContract', 'errorMappingContract',
                                              'assetConfinementContract',
                                              'buildArtifacts', 'unauthenticated', 'authenticated',
                                              'assignmentNext']);

  validateCommittedArtifacts(committedTable, committedCorpus);

  return { table : committedTable, corpus : committedCorpus };
}

/**
 * Replays both halves of the baseline and the build artifacts, and resolves with the process exit code
 * rather than exiting itself, so the single process.exit lives in the guarded entry point below where a
 * synchronous throw is also caught.
 *
 * The three outcomes are kept apart deliberately, so a caller can tell "this build changed behavior"
 * from "this run never checked". A difference is 1. Everything that prevented the check from happening
 * at all — a missing artifact, a boot failure, a report-write failure — is 2.
 */
function main() {
  var options     = parseArgv(process.argv.slice(2)),
      artifacts   = loadArtifacts(),
      committedTable = artifacts.table,
      committed   = artifacts.corpus,
      server      = null,
      differences = [],
      findings    = [],
      gateEntries = [],
      blockers    = [],
      summary     = {},
      table       = null,
      measured    = null,
      exitCode    = 0;

  // PRECONDITION P2. Checked before anything boots: a harness that would not
  // request the way the corpus was recorded compares policies rather than behavior, and its "0
  // differences" would be meaningless. Both P1 (loadArtifacts, above) and P2 throw precondition failures,
  // which the guarded entry point maps onto exit 2.
  assertRequestPolicyConformance(committed);

  // NO configuration of this file's own is injected: capture.js#configureRuntime owns app.start, the bind
  // address, the disposable database and the session password, and nothing else. In particular app.url is
  // NOT overridden — the corpus is origin-specific, so the origin is a precondition to
  // check, not a value to supply. Rewriting it would let a build that emits the wrong configured origin
  // replay clean, and the literal Location is exactly what the redirect-parity evidence rests on.
  capture.configureRuntime();

  var precondition = capture.originPrecondition(committed);

  if (!precondition.satisfied) {
    console.error('replay.js: UNABLE TO RUN — ' + precondition.remedy);

    return Promise.resolve(2);
  }

  console.log('replay.js: preconditions satisfied — both artifacts are structurally complete and this ' +
              'harness requests exactly as responses.json#requestPolicy records.');
  console.log('replay.js: replaying under app.url origin ' + precondition.live +
              ' (recorded ' + precondition.recorded + '), database ' +
              (capture.effectiveNodeConfig() || {}).db.mongo.database);

  return capture.startServer().then(function(started) {
    server = started;
    console.log('replay.js: real HTTP against ' + server.info.uri +
                ' (this harness never calls server.inject(); the app still does — PRESERVED-QUIRKS 7.6)');

    if (options.corpusOnly) {
      return undefined;
    }

    table = replayRouteTable(server, committedTable);

    differences  = differences.concat(table.differences);
    gateEntries  = gateEntries.concat(table.gateEntries);
    summary.routeTable = {
      rowCount                     : table.rowCount,
      measuredSha256               : table.sortedDigest,
      registrationOrderFingerprint : table.orderDigest,
      documentedAnchorGate         : {
        documentedDigest : table.anchorGate.documentedDigest,
        clauses          : table.anchorGate.clauses.length,
        failures         : table.anchorGate.failures,
        satisfied        : table.anchorGate.satisfied
      },
      gates                        : table.gates
    };

    console.log('replay.js: route table rows=' + table.rowCount +
                ' sortedSha256=' + table.sortedDigest.slice(0, 16) + '\u2026' +
                ' orderFingerprint=' + table.orderDigest.slice(0, 16) + '\u2026' +
                ' methods=' + JSON.stringify(table.gates.methods));
    console.log('replay.js: documented anchor gate (' + table.anchorGate.documentedDigest + ') ' +
                (table.anchorGate.satisfied
                  ? 'SATISFIED \u2014 all ' + table.anchorGate.clauses.length + ' clauses hold'
                  : 'FAILED \u2014 ' + JSON.stringify(table.anchorGate.failures)));

    if (options.verbose) {
      table.anchorGate.clauses.forEach(function(clause) {
        console.log('    [' + (clause.satisfied ? 'ok  ' : 'FAIL') + '] ' + clause.name);
      });
    }

    return undefined;
  }).then(function() {
    if (options.routeTableOnly) {
      return undefined;
    }

    return replayResponses(server, committed).then(function(result) {
      differences = differences.concat(result.differences);
      gateEntries = gateEntries.concat(result.gateEntries);
      measured    = result.measured;
      summary.responses = {
        unauthenticated      : result.measured.unauthenticated.length,
        authenticated        : result.measured.authenticated.length,
        assignmentNext       : (result.measured.assignmentNext || []).length,
        measuredDistribution : capture.resolvedStatusDistribution(result.measured.unauthenticated),
        firstHopDistribution : capture.statusDistribution(result.measured.unauthenticated),
        rolesTokens          : result.measured.rolesTokenObservations
      };

      console.log('replay.js: responses unauthenticated=' + summary.responses.unauthenticated +
                  ' authenticated=' + summary.responses.authenticated +
                  ' assignmentNext=' + summary.responses.assignmentNext +
                  ' resolvedDistribution=' + JSON.stringify(summary.responses.measuredDistribution) +
                  ' firstHopDistribution=' + JSON.stringify(summary.responses.firstHopDistribution));

      return undefined;
    });
  }).then(function() {
    // The build half of the parity claim, measured here rather than taken on trust.
    var build = replayBuildArtifacts(committed);

    differences       = differences.concat(build.differences);
    gateEntries       = gateEntries.concat(capture.buildArtifactGates(committed, build.measured));
    summary.buildArtifacts = {
      files              : build.measured.files,
      cssMapFilesEmitted : build.measured.cssMapFilesEmitted,
      unevaluated        : build.unevaluated
    };

    if (build.unevaluated.length) {
      build.unevaluated.forEach(function(reason) { blockers.push('build artifacts: ' + reason); });
    }
    else {
      console.log('replay.js: build artifacts ' +
                  capture.BUILD_ARTIFACT_FILES.map(function(relative) {
                    return relative + '=' + build.measured.files[relative].bytes + 'B';
                  }).join(' ') + ' cssMapFilesEmitted=' + build.measured.cssMapFilesEmitted);
    }

    // THE REPORT-BACK LAYER. Evaluated once, over everything this run measured, so
    // a narrowed run reports only on the halves it actually looked at.
    findings = reportBackFindings(committedTable, committed, table, measured, build.measured);

    return undefined;
  }).catch(function(err) {
    // ONE terminal handler for the whole chain, so a throw in any step still reaches the cleanup below.
    // A boot or request failure is unable-to-run, not a parity difference, and a precondition failure
    // raised mid-run is reported as the precondition it is rather than as a stack.
    if (isPreconditionFailure(err)) {
      console.error(err.message);
    }
    else {
      console.error('replay.js: UNABLE TO RUN \u2014 ' + (err && err.stack ? err.stack : err));
    }

    blockers.push('exception: ' + String(err && err.message ? err.message : err));
  }).then(function() {
    return capture.stopServer(server);
  }).then(function() {
    var cleanupFailures = capture.cleanupErrors();

    report(differences, options);
    reportFindings(findings);

    // THE DECLARED GATES, re-evaluated. Printed through capture.js's own summary so a gate reads the same
    // whether the capture CLI or this one evaluated it.
    console.log('replay.js: gate summary — every expectation is read from the committed artifacts and ' +
                'every measured value is recomputed from this run:');

    var tally = capture.printGateSummary(gateEntries, !options.verbose);

    summary.gates = {
      pass           : tally.pass,
      fail           : tally.fail,
      unevaluated    : tally.unevaluated,
      unreproducible : tally.unreproducible,
      failed         : gateEntries.filter(function(entry) { return entry.status === 'FAIL'; })
                         .map(function(entry) { return entry.name; })
    };
    summary.findings = findings;

    if (options.routeTableOnly || options.corpusOnly) {
      console.log('replay.js: NARROWED run (' + (options.routeTableOnly ? '--route-table-only'
                                                                       : '--corpus-only') +
                  '), so the other half of the parity contract was not replayed.');
    }
    else if (tally.unevaluated) {
      // MISSING EVIDENCE IS NOT A PASS. A full run that could not evaluate a declared gate has not
      // verified what that gate exists to verify, so it is unable-to-run rather than parity.
      blockers.push(tally.unevaluated + ' declared gate(s) could not be evaluated in a full run; each ' +
                    'names its reason above');
    }

    cleanupFailures.forEach(function(message) { blockers.push('cleanup: ' + message); });

    if (blockers.length) {
      console.error('replay.js: UNABLE TO RUN \u2014 ' + blockers.length + ' blocker(s): ' +
                    blockers.join('; '));
      exitCode = 2;
    }
    else if (differences.length || findings.length || tally.fail) {
      // A difference, a failed declared gate and a report-back finding are all the same class of outcome:
      // the running application does not match the baseline. All three set exit 1.
      exitCode = 1;
    }

    if (options.report) {
      try {
        // Exclusive create, onto a path validated before the run started.
        fs.writeFileSync(options.report, JSON.stringify({
          summary     : summary,
          differences : differences,
          findings    : findings,
          gates       : gateEntries,
          blockers    : blockers,
          exitCode    : exitCode
        }, null, 2) + '\n', { encoding : 'utf8', flag : 'wx' });
        console.log('replay.js: report written to ' + options.report);
      }
      catch (err) {
        // A report that could not be written is unable-to-run: the operator asked for evidence and did
        // not get it. It must not be swallowed into a clean exit.
        console.error('replay.js: UNABLE TO RUN \u2014 the report could not be written to ' +
                      options.report + ' (' + err.message + ').');
        exitCode = 2;
      }
    }

    return exitCode;
  });
}

module.exports = {
  DOCUMENTED_DIGEST           : DOCUMENTED_DIGEST,
  DOCUMENTED_ROW_COUNT        : DOCUMENTED_ROW_COUNT,
  DOCUMENTED_CORPUS_SIZE      : DOCUMENTED_CORPUS_SIZE,
  parseArgv                   : parseArgv,
  preconditionFailure         : preconditionFailure,
  isPreconditionFailure       : isPreconditionFailure,
  validateCommittedArtifacts  : validateCommittedArtifacts,
  loadRequiredArtifact        : loadRequiredArtifact,
  loadArtifacts               : loadArtifacts,
  requestPolicyMismatches     : requestPolicyMismatches,
  assertRequestPolicyConformance : assertRequestPolicyConformance,
  driftGates                  : driftGates,
  replayBuildArtifacts        : replayBuildArtifacts,
  authDescriptor              : authDescriptor,
  liveServerAuthDefault       : liveServerAuthDefault,
  canonicalRow                : canonicalRow,
  canonicalizeLiveTable       : canonicalizeLiveTable,
  documentedAnchorGate        : documentedAnchorGate,
  registrationOrderCanonical  : registrationOrderCanonical,
  replayRouteTable            : replayRouteTable,
  replayResponses             : replayResponses,
  jsonMessagesAtStatus        : jsonMessagesAtStatus,
  errorMappingGates           : errorMappingGates,
  finding                     : finding,
  locationKind                : locationKind,
  pagesQuirkFindings          : pagesQuirkFindings,
  serverErrorQuirkFindings    : serverErrorQuirkFindings,
  featureFlagFindings         : featureFlagFindings,
  locationFindings            : locationFindings,
  routeTableFindings          : routeTableFindings,
  buildArtifactFindings       : buildArtifactFindings,
  reportBackFindings          : reportBackFindings,
  reportFindings              : reportFindings,
  sha256                      : sha256,
  main                        : main
};

// The recursive mocha spec glob loads every .js file under test/, so requiring this module must be
// inert. Only an explicit `node test/baseline/replay.js` replays anything.
//
// The exit lives here, in one place, and the chain is TERMINATED by a rejection handler. Without it a
// synchronous throw from parseArgv or loadRequiredArtifact — an unknown flag, an unsafe --report path, a
// missing or malformed artifact — surfaces as an unhandled rejection: a stack trace, a warning, and
// whatever exit code Node chose, rather than the documented unable-to-run 2.
//
// Exiting explicitly is mandatory for the same reason .mocharc.json carries "exit": true — the
// leak-detector interval app.js never unrefs, the module-load mongoose connection in config/db.js and
// the eager redis client all keep the event loop alive after the server has stopped.
if (require.main === module) {
  Promise.resolve().then(main).then(function(exitCode) {
    process.exit(exitCode);
  }).catch(function(err) {
    console.error('replay.js: UNABLE TO RUN — ' + (err && err.message ? err.message : String(err)));

    if (process.env.BASELINE_DEBUG && err && err.stack) {
      console.error(err.stack);
    }

    process.exit(2);
  });
}
