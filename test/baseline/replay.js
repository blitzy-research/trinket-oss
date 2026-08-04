/**
 * test/baseline/replay.js — replays the R-6 baseline against the running application and diffs.
 *
 * This is the falsification tool for the whole modernization. capture.js measured the corpus; this
 * file re-measures it against whatever the working tree currently is and reports every difference.
 * It NEVER writes: the baseline is evidence, and a replay that "fixes" the evidence proves nothing.
 *
 * It checks both halves of the R-6 parity contract:
 *
 *   1. THE ROUTE TABLE (TR1). The 233 registered routes are canonicalized with the exact recipe
 *      recorded in route-table.json#canonicalization — "METHOD | path | authDescriptor | preCount",
 *      uppercase method, `false` for auth:false, `mode=<mode> strategies=["s1",...]` otherwise, one
 *      ASCII space around every pipe, default Array.prototype.sort(), joined with "\n" and no
 *      trailing newline — and hashed. Both digests are checked: the sorted sha256
 *      (gates.measuredSha256) and the registration-order fingerprint
 *      (gates.registrationOrderFingerprint), the latter derived independently from config.routes,
 *      which is the array app.js:L304 hands to server.route(). Every countable gate in the artifact
 *      is recomputed from the live table as well. On top of those, documentedAnchorGate() evaluates
 *      the Technical Specification's own published anchor for this table as a MANDATORY pass/fail
 *      gate — ten clauses, computed live, including that the frozen 32-character digest literal is
 *      still stored verbatim and that the 233 canonical rows it names are unchanged.
 *
 *   2. THE RESPONSE CORPUS (TR2, TR3, TR4). All three sections — the 58 parameterless GETs, the 7-entry
 *      authenticated supplement and the 8-entry assignment-`next` supplement — are re-issued over real
 *      HTTP by capture.js's own helpers, under capture.js's own normalization, and compared field by
 *      field. Only the unauthenticated section carries the additive resolved reading, and it is compared
 *      too; the other two are first-hop only, by the policy the artifact records.
 *
 *   3. THE BUILD ARTIFACTS (AAP 0.7.4). The two stylesheets the corpus pins are re-measured here
 *      independently of capture.js — byte length, sha256 and the source-map count — because a replay
 *      that checks the HTTP surface while ignoring the build output has verified half the parity claim
 *      and reported all of it (review finding F4).
 *
 * The comparison deliberately reuses capture.js rather than reimplementing it: one normalization
 * implementation means a replay pass cannot be manufactured by a subtly different normalizer. The
 * artifact's prohibition applies here in full — "Do NOT normalize away a difference in order to make a
 * replay diff pass." A real difference is an application-code defect and must be reported as one. For
 * the same reason this file injects NO configuration of its own: the app.url origin is a precondition
 * checked through capture.js#originPrecondition, and a mismatch is reported as unable-to-run rather than
 * rewritten out of the measurement (review finding F2).
 *
 * USAGE
 *   node test/baseline/replay.js                        full replay; exit 0 only if nothing differs
 *   node test/baseline/replay.js --quiet                summary lines only, no per-difference detail
 *   node test/baseline/replay.js --verbose              every gate and clause, not just the failures
 *   node test/baseline/replay.js --route-table-only     the 233-row table only, no HTTP corpus
 *   node test/baseline/replay.js --corpus-only          the response corpus only, no route table
 *   node test/baseline/replay.js --report <path>        also write a machine-readable JSON report
 *
 * EXIT CODES (review finding F11 — three outcomes, three codes, never conflated)
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

// ---------------------------------------------------------------------------------------------
// Route-table canonicalization — route-table.json#canonicalization, reproduced exactly
// ---------------------------------------------------------------------------------------------

function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * REVIEW FINDING M-7, second half. Canonicalization is DELEGATED to test/baseline/capture.js rather than
 * reimplemented here.
 *
 * An earlier revision carried its own line-for-line copy of authDescriptor, canonicalRow,
 * liveServerAuthDefault and canonicalizeLiveTable, differing from capture.js's only in what `byKey`
 * holds. Two copies of a canonicalizer is exactly how the anchor gate came to be enforced in one file and
 * marked UNEVALUATED in the other, and it is why route-table.json could not name a single honest
 * evaluator. There is now one implementation, in the harness that owns the artifact, and these are its
 * names in this file.
 *
 * The delegation is safe because capture.js#canonicalizeLiveTable consults NOTHING committed - every
 * value it returns is derived from server.table() and server.auth.settings.default - so a replay still
 * cannot be contaminated by the artifact it is about to be compared against. The `committedTable`
 * argument the old signature accepted was never read; it is dropped.
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
function registrationOrderCanonical(live) {
  var order = capture.registrationOrderRows(live);

  return {
    canonical : order.rows.map(function(row) { return row.canonical; }),
    missing   : order.missing
  };
}

// ---------------------------------------------------------------------------------------------
// The documented route-table anchor, as a mandatory gate
// ---------------------------------------------------------------------------------------------

/**
 * The literal the Technical Specification publishes for the baseline route table (§0.1.1.3 goal G8,
 * §0.1.2.3 invariant TR1, §0.7.5). It is hard-coded HERE, in the verifier, so that the artifact cannot
 * quietly substitute one of its own measurements for it: clause 1 of the gate below compares the
 * artifact's stored value against this constant and fails the gate if they ever diverge.
 */
var DOCUMENTED_DIGEST = 'cd2a7e38a39bd84902ac1a0d69f50e2a';

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
 * @returns {Object} { clauses : [...], failures : [...], satisfied : Boolean }
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

function replayRouteTable(server, committedTable) {
  var live        = canonicalizeLiveTable(server, committedTable),
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

  return {
    differences  : differences,
    rowCount     : live.gates.rowCount,
    sortedDigest : sortedDigest,
    orderDigest  : orderDigest,
    anchorGate   : anchorGate,
    gates        : live.gates
  };
}

// ---------------------------------------------------------------------------------------------
// Response-corpus replay
// ---------------------------------------------------------------------------------------------

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
    // The assignment `next` supplement (review finding P3-1). gates.assignmentNextLocations is the gate
    // that finding would have tripped: the two consuming hops carry the destination itself, so a build
    // that discards a same-origin absolute destination answers the declared success.redirect there.
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
    pushDifference(differences, 'responses', 'selectionRule.expectedCount',
                   committedCorpus.selectionRule.expectedCount, measured.unauthenticated.length);
    pushDifference(differences, 'responses', 'selectionRule.paths',
                   committedCorpus.selectionRule.paths,
                   measured.unauthenticated.map(function(entry) { return entry.path; }));

    return { differences : differences, measured : measured };
  });
}

// ---------------------------------------------------------------------------------------------
// Build-artifact replay (AAP 0.7.4) — review finding F4
// ---------------------------------------------------------------------------------------------

/**
 * Re-measures the two stylesheets the corpus pins and compares byte length, sha256 and the source-map
 * count against responses.json#buildArtifacts.
 *
 * This is deliberately its own comparison rather than a call into capture.js's gate builder: the build
 * output is one of the two halves of the parity claim (AAP 0.7.4 pins base.css at 265,727 bytes,
 * embed.css at 296,352 and the emitted .map count at zero), and an earlier revision of this file checked
 * neither. A file that is absent is NOT reported as a difference — the checkout was simply never built,
 * which responses.json#buildArtifacts.precondition describes — but it IS reported as unable-to-run, so a
 * replay cannot announce parity over evidence it never looked at.
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

// ---------------------------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------------------------

/**
 * The command line, parsed strictly with node:util.parseArgs (review finding F12). The hand-rolled loop
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
    // at repository source, through a symlink or over an existing file (review finding F13).
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
 * Rejects an artifact this run cannot honestly replay against, BEFORE booting anything. A missing or
 * malformed artifact, or one lacking the blocks the comparison reads, is unable-to-run (exit 2) rather
 * than a difference: there is no baseline to differ from (review finding F11).
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
    throw new Error('replay.js: the ' + label + ' artifact is missing (' + file + '). There is no ' +
                    'baseline to replay against.');
  }

  try {
    parsed = JSON.parse(raw);
  }
  catch (err) {
    throw new Error('replay.js: the ' + label + ' artifact at ' + file + ' is not valid JSON (' +
                    err.message + ').');
  }

  var missing = requiredKeys.filter(function(key) {
    return parsed[key] === undefined || parsed[key] === null;
  });

  if (missing.length) {
    throw new Error('replay.js: the ' + label + ' artifact at ' + file + ' is missing the block(s) the ' +
                    'comparison reads: ' + missing.join(', ') + '.');
  }

  return parsed;
}

/**
 * Replays both halves of the R-6 baseline and the build artifacts, and resolves with the process exit
 * code rather than exiting itself, so the single process.exit lives in the guarded entry point below
 * where a synchronous throw is also caught.
 *
 * The three outcomes are kept apart deliberately (review finding F11). The earlier revision routed every
 * condition — a missing artifact, a boot failure, a report-write failure, a genuine difference — into
 * exit 1, so a caller could not tell "this build changed behavior" from "this run never checked". A
 * difference is 1. Everything that prevented the check from happening at all is 2.
 */
function main() {
  var options        = parseArgv(process.argv.slice(2)),
      committedTable = loadRequiredArtifact('route-table', capture.ROUTE_TABLE_PATH,
                                            ['metadata', 'gates', 'canonicalization', 'rows']),
      committed      = loadRequiredArtifact('responses', capture.ARTIFACT_PATH,
                                            ['metadata', 'gates', 'selectionRule', 'normalizationContract',
                                             'buildArtifacts', 'unauthenticated', 'authenticated']),
      server         = null,
      differences    = [],
      blockers       = [],
      summary        = {},
      exitCode       = 0;

  // NO configuration of this file's own is injected: capture.js#configureRuntime owns app.start, the bind
  // address, the disposable database and the session password, and nothing else. In particular app.url is
  // NOT overridden (review finding F2) — the corpus is origin-specific, so the origin is a precondition to
  // check, not a value to supply. Rewriting it would let a build that emits the wrong configured origin
  // replay clean, and the literal Location is exactly what R-5 requires be proven.
  capture.configureRuntime();

  var precondition = capture.originPrecondition(committed);

  if (!precondition.satisfied) {
    console.error('replay.js: UNABLE TO RUN — ' + precondition.remedy);

    return Promise.resolve(2);
  }

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

    var table = replayRouteTable(server, committedTable);

    differences  = differences.concat(table.differences);
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
    // The build half of the parity claim, measured here rather than taken on trust (review finding F4).
    var build = replayBuildArtifacts(committed);

    differences       = differences.concat(build.differences);
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

    return undefined;
  }).catch(function(err) {
    // ONE terminal handler for the whole chain, so a throw in any step still reaches the cleanup below
    // (review finding F14). A boot or request failure is unable-to-run, not a parity difference.
    console.error('replay.js: UNABLE TO RUN \u2014 ' + (err && err.stack ? err.stack : err));
    blockers.push('exception: ' + String(err && err.message ? err.message : err));
  }).then(function() {
    return capture.stopServer(server);
  }).then(function() {
    var cleanupFailures = capture.cleanupErrors();

    report(differences, options);

    if (options.routeTableOnly || options.corpusOnly) {
      console.log('replay.js: NARROWED run (' + (options.routeTableOnly ? '--route-table-only'
                                                                       : '--corpus-only') +
                  '), so the other half of the parity contract was not replayed.');
    }

    cleanupFailures.forEach(function(message) { blockers.push('cleanup: ' + message); });

    if (blockers.length) {
      console.error('replay.js: UNABLE TO RUN \u2014 ' + blockers.length + ' blocker(s): ' +
                    blockers.join('; '));
      exitCode = 2;
    }
    else if (differences.length) {
      exitCode = 1;
    }

    if (options.report) {
      try {
        // Exclusive create, onto a path validated before the run started.
        fs.writeFileSync(options.report, JSON.stringify({
          summary     : summary,
          differences : differences,
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
  parseArgv                   : parseArgv,
  loadRequiredArtifact        : loadRequiredArtifact,
  replayBuildArtifacts        : replayBuildArtifacts,
  authDescriptor              : authDescriptor,
  liveServerAuthDefault       : liveServerAuthDefault,
  canonicalRow                : canonicalRow,
  canonicalizeLiveTable       : canonicalizeLiveTable,
  documentedAnchorGate        : documentedAnchorGate,
  registrationOrderCanonical  : registrationOrderCanonical,
  replayRouteTable            : replayRouteTable,
  replayResponses             : replayResponses,
  sha256                      : sha256,
  main                        : main
};

// AAP 0.7.5: the recursive mocha spec glob loads every .js file under test/, so requiring this module
// must be inert. Only an explicit `node test/baseline/replay.js` replays anything.
//
// The exit lives here, in one place, and the chain is TERMINATED by a rejection handler (review finding
// F11). Without it a synchronous throw from parseArgv or loadRequiredArtifact — an unknown flag, an
// unsafe --report path, a missing or malformed artifact — surfaced as an unhandled rejection: a stack
// trace, a warning, and whatever exit code Node chose, rather than the documented unable-to-run 2.
//
// Exiting explicitly is mandatory for the same reason .mocharc.json carries "exit": true — app.js:L348's
// un-unref'd leak-detector interval, the module-load mongoose connection at config/db.js:L35 and the
// eager redis client all keep the event loop alive after the server has stopped.
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
