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
 *      is recomputed from the live table as well.
 *
 *   2. THE RESPONSE CORPUS (TR2, TR3, TR4). The 58 parameterless GETs plus the 7-entry authenticated
 *      supplement are re-issued over real HTTP by capture.js's own helpers, under capture.js's own
 *      normalization, and compared field by field.
 *
 * The comparison deliberately reuses capture.js rather than reimplementing it: one normalization
 * implementation means a replay pass cannot be manufactured by a subtly different normalizer. The
 * artifact's prohibition applies here in full — "Do NOT normalize away a difference in order to make a
 * replay diff pass." A real difference is an application-code defect and must be reported as one.
 *
 * USAGE
 *   node test/baseline/replay.js                 full replay; exit 0 only if nothing differs
 *   node test/baseline/replay.js --quiet         summary only
 *   node test/baseline/replay.js --routes-only   route table only (no HTTP corpus)
 *   node test/baseline/replay.js --json <path>   also write a machine-readable report
 */

var crypto  = require('crypto'),
    fs      = require('fs'),
    capture = require('./capture');

// ---------------------------------------------------------------------------------------------
// Route-table canonicalization — route-table.json#canonicalization, reproduced exactly
// ---------------------------------------------------------------------------------------------

function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * The auth descriptor of one live route row.
 *
 * route-table.json#canonicalization.authResolution pins this to "exactly hapi 21.4.10 lib/auth.js
 * lookup(route)": a route with no auth of its own inherits the server default declared at app.js:L287,
 * `auth : false` is rendered as the literal string "false", and anything else is rendered from its own
 * resolved mode and strategy list. The recorded rawSettingsAuthTally — { undefined: 126, object: 105,
 * false: 2 } — is the tally of which of those three branches each of the 233 rows takes, and it is
 * re-derived and compared below.
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
function canonicalRow(method, path, auth, preCount, serverDefault) {
  return [
    String(method).toUpperCase(),
    path,
    authDescriptor(auth, serverDefault),
    String(preCount)
  ].join(' | ');
}

/**
 * Canonicalizes the live route table. Returns the rows keyed by "METHOD path" plus the sorted
 * canonical list, the raw auth tally and the countable gate values, all derived from the live server
 * and nothing else.
 */
function liveServerAuthDefault(server) {
  var settings = (server.auth && server.auth.settings && server.auth.settings.default) || {};

  return {
    mode       : settings.mode,
    strategies : settings.strategies ? settings.strategies.slice() : undefined
  };
}

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
 * app.js:L304 passes to server.route(), so its order IS the registration order. Each declaration is
 * mapped onto the live canonical string for its (METHOD, path) key, exactly as route-table.json#ADJ-5
 * describes, because server.table() returns ROUTER order rather than registration order.
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
      orderDigest  = sha256(order.canonical.join('\n'));

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
    gates        : live.gates
  };
}

// ---------------------------------------------------------------------------------------------
// Response-corpus replay
// ---------------------------------------------------------------------------------------------

/**
 * The measured assignment entries with their origin rebased onto the corpus origin, so the two gate
 * maps are computed from exactly the values compareCorpus() compares. The origin appears both in the
 * Location and, percent-encoded, in the request path — see capture.js#rebaseEntryOrigin.
 */
function rebaseAssignmentSection(measured, committedCorpus) {
  var from = capture.liveAppUrlOrigin(),
      to   = (committedCorpus.metadata && committedCorpus.metadata.appUrlOrigin) || null;

  return (measured.assignmentNext || []).map(function(entry) {
    return capture.rebaseEntryOrigin(entry, from, to);
  });
}

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
    pushDifference(differences, 'responses', 'gates.authenticatedFirstHopStatuses',
                   committedCorpus.gates.authenticatedFirstHopStatuses,
                   capture.authenticatedStatusMap(measured.authenticated, 'firstHop'));
    pushDifference(differences, 'responses', 'gates.authenticatedResolvedStatuses',
                   committedCorpus.gates.authenticatedResolvedStatuses,
                   capture.authenticatedStatusMap(measured.authenticated, 'resolved'));
    pushDifference(differences, 'responses', 'gates.unauthenticatedEntryCount',
                   committedCorpus.gates.unauthenticatedEntryCount, measured.unauthenticated.length);
    pushDifference(differences, 'responses', 'gates.authenticatedEntryCount',
                   committedCorpus.gates.authenticatedEntryCount, measured.authenticated.length);
    // The assignment `next` supplement (review finding P3-1). gates.assignmentNextLocations is the gate
    // that finding would have tripped: the two consuming hops carry the destination itself, so a build
    // that discards a same-origin absolute destination answers the declared success.redirect there.
    // Rebased onto the corpus origin first, exactly as the entries themselves are.
    pushDifference(differences, 'responses', 'gates.assignmentNextEntryCount',
                   committedCorpus.gates.assignmentNextEntryCount,
                   (measured.assignmentNext || []).length);
    pushDifference(differences, 'responses', 'gates.assignmentNextStatuses',
                   committedCorpus.gates.assignmentNextStatuses,
                   capture.assignmentNextStatusMap(rebaseAssignmentSection(measured, committedCorpus)));
    pushDifference(differences, 'responses', 'gates.assignmentNextLocations',
                   committedCorpus.gates.assignmentNextLocations,
                   capture.assignmentNextLocationMap(rebaseAssignmentSection(measured,
                                                                            committedCorpus)));
    pushDifference(differences, 'responses', 'selectionRule.expectedCount',
                   committedCorpus.selectionRule.expectedCount, measured.unauthenticated.length);
    pushDifference(differences, 'responses', 'selectionRule.paths',
                   committedCorpus.selectionRule.paths,
                   measured.unauthenticated.map(function(entry) { return entry.path; }));

    return { differences : differences, measured : measured };
  });
}

// ---------------------------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------------------------

function parseArgv(argv) {
  var options = { quiet : false, routesOnly : false, json : null };

  for (var index = 0; index < argv.length; index++) {
    if (argv[index] === '--quiet')            { options.quiet = true; }
    else if (argv[index] === '--routes-only') { options.routesOnly = true; }
    else if (argv[index] === '--json')        { options.json = argv[++index]; }
  }

  return options;
}

function report(differences, quiet) {
  if (!differences.length) {
    console.log('replay.js: 0 differences — the running application replays the R-6 baseline exactly.');

    return;
  }

  console.log('replay.js: ' + differences.length + ' DIFFERENCE(S) against the R-6 baseline.');

  if (quiet) {
    return;
  }

  differences.forEach(function(difference) {
    console.log('  ' + difference.section + ' :: ' + difference.entry);
    console.log('    baseline: ' + String(difference.expected).slice(0, 400));
    console.log('    current : ' + String(difference.actual).slice(0, 400));
  });
}

/**
 * Turns the corpus's recorded `metadata.appUrlOrigin` back into the `config.app.url` shape that
 * lib/http/redirect.js and the view layer read. Returns an empty override when the corpus predates the
 * key, so an older artifact still replays exactly as it did before.
 */
function replayOriginOverride(committed) {
  var origin = committed.metadata && committed.metadata.appUrlOrigin,
      parsed = origin ? URL.parse(origin) : null;

  if (!parsed) {
    return {};
  }

  return {
    app : {
      url : {
        protocol : parsed.protocol.replace(/:$/, ''),
        hostname : parsed.hostname,
        port     : parsed.port === '' ? null : Number(parsed.port)
      }
    }
  };
}

function main() {
  var options        = parseArgv(process.argv.slice(2)),
      committedTable = capture.loadCommittedRouteTable(),
      committed      = capture.loadCommittedCorpus(),
      server         = null,
      differences    = [],
      summary        = {};

  // The corpus is origin-specific by construction: ten of its sixteen redirects carry an absolute
  // Location, and every rendered page embeds the site origin in its markup, so the recorded body
  // digests are only meaningful against the origin the capture ran under. That origin is recorded as
  // metadata.appUrlOrigin ("https://trinket.dev", from config/default.yaml) and is injected here so the
  // replay measures the same surface. Without it, a checkout carrying the config/local.yaml that
  // docs/setup.md tells a developer to create - which points app.url at http://localhost:3000 - reports
  // twenty differences that are two bytes of configuration each and nothing about behavior. Injecting
  // it is a runtime override through NODE_CONFIG, exactly as the session password and the port are; no
  // YAML is edited.
  capture.configureRuntime(replayOriginOverride(committed));
  console.log('replay.js: replaying under app.url origin ' +
              (committed.metadata && committed.metadata.appUrlOrigin));

  return capture.startServer().then(function(started) {
    server = started;
    console.log('replay.js: real HTTP against ' + server.info.uri +
                ' (server.inject() is never used — @hapi/shot is the only DEP0169 source left)');

    var table = replayRouteTable(server, committedTable);

    differences  = differences.concat(table.differences);
    summary.routeTable = {
      rowCount                     : table.rowCount,
      measuredSha256               : table.sortedDigest,
      registrationOrderFingerprint : table.orderDigest,
      gates                        : table.gates
    };

    console.log('replay.js: route table rows=' + table.rowCount +
                ' sortedSha256=' + table.sortedDigest.slice(0, 16) + '…' +
                ' orderFingerprint=' + table.orderDigest.slice(0, 16) + '…' +
                ' methods=' + JSON.stringify(table.gates.methods));

    if (options.routesOnly) {
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
    report(differences, options.quiet);

    if (options.json) {
      fs.writeFileSync(options.json,
                       JSON.stringify({ summary : summary, differences : differences }, null, 2) + '\n',
                       'utf8');
      console.log('replay.js: report written to ' + options.json);
    }

    return capture.stopServer(server);
  }, function(err) {
    console.error('replay.js: FAILED — ' + (err && err.stack ? err.stack : err));
    differences.push({ section : 'harness', entry : 'exception', expected : 'no exception',
                       actual : String(err && err.message ? err.message : err) });

    return capture.stopServer(server);
  }).then(function() {
    // Same three unref'd handles as capture.js: the app.js:L348 leak-detector interval, the
    // module-load mongoose connection at config/db.js:L35 and the eager redis client.
    process.exit(differences.length ? 1 : 0);
  });
}

module.exports = {
  authDescriptor              : authDescriptor,
  liveServerAuthDefault       : liveServerAuthDefault,
  canonicalRow                : canonicalRow,
  canonicalizeLiveTable       : canonicalizeLiveTable,
  registrationOrderCanonical  : registrationOrderCanonical,
  rebaseAssignmentSection     : rebaseAssignmentSection,
  replayRouteTable            : replayRouteTable,
  replayResponses             : replayResponses,
  sha256                      : sha256,
  main                        : main
};

// AAP 0.7.5: the recursive mocha spec glob loads every .js file under test/, so requiring this module
// must be inert. Only an explicit `node test/baseline/replay.js` replays anything.
if (require.main === module) {
  main();
}
