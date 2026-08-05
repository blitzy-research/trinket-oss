/**
 * Integrity guards for the baseline harness itself: test/baseline/capture.js and test/baseline/replay.js.
 *
 * The parity corpus is the tie-breaker for every behavioral question this migration raises, so its harness is
 * the instrument the whole migration is judged with. These tests guard the four properties that keep the
 * instrument honest, and each one FAILS if the property is lost:
 *
 *   1. FIXTURE LIFECYCLE. A capture creates up to two throwaway identities. Cleanup is
 *      `capture.cleanupIdentities()` called from ONE terminal `.finally`, so no failure path can skip it; it
 *      ATTEMPTS both identities, COLLECTS failures in CLEANUP_ERRORS rather than raising — so its own error
 *      cannot replace the measurement error the caller needs — and main() turns a non-empty
 *      `cleanupErrors()` into exit 2, so a run cannot report success while fixtures survive in the database.
 *      The aggregation IS the contract; there is no generic cleanup wrapper.
 *   2. GATE INTEGRITY. The documented route-table anchor is MANDATORY: a run must not exit 0 without having
 *      evaluated it. The gate lives in ONE place — `capture.js#documentedAnchorGate`, beside the
 *      `DOCUMENTED_DIGEST` literal — and `replay.js` RE-EXPORTS both rather than declaring a second copy. The
 *      evaluator sits in the harness that OWNS route-table.json because that is the only file that can
 *      REGENERATE the stored verdict `gates.documentedAnchorGateSatisfied` instead of carrying a
 *      hand-authored boolean. capture.js therefore evaluates the gate — turning all eleven clauses and the
 *      verdict into entries of its own gate summary, so a --dry-run exits non-zero and a write is refused —
 *      and still reports the digest STRING through `unreproducibleGate()`, whose verdict is admissible only
 *      while the artifact declares `gates.documentedDigestReproduced === 'none'`. The canonicalizer is shared
 *      the same way, so there is exactly one implementation of every half.
 *   3. EVIDENCE PROVENANCE. The write path is gated by `capture.assertWritable()`, and there is NO forcing
 *      flag: a stale `--force` earns an unknown-option parse error, and the only sanctioned lift is
 *      `--adopt-base-commit`, which renames the baseline on the record. An artifact can therefore never
 *      assert a provenance its numbers do not have.
 *   4. HARNESS CORRECTNESS. Origins are compared with `capture.sameOrigin()` — exact WHATWG origin
 *      equality, never a string-prefix test, which the corpus deliberately carries shapes to defeat — and
 *      preconditioned with `capture.originPrecondition()`. No helper rebases a recorded corpus onto a
 *      different origin, because an injected origin lets a build that emits the wrong one replay clean.
 *
 * WHAT IS DELIBERATELY NOT DONE HERE. Nothing in this file starts a server, issues a request or writes an
 * artifact. capture.js and replay.js are both guarded with `require.main === module`, so requiring them is
 * inert; these tests exercise their pure functions and read their source text. The behavioral half of the
 * harness is proven by RUNNING it — `node test/baseline/capture.js` and `node test/baseline/replay.js` — which
 * is a different job from guarding it against regression, and this file is the guard.
 *
 * The one ambient dependency is `require('config').routes`, which the registrationOrderContract clause walks.
 * It is populated by config/app.config.js, which test/helpers/flow.js requires at load time. Mocha loads every
 * spec file before running any test, so it is always present by the time an `it()` body executes — which is
 * why no gate is ever evaluated at describe-body time below.
 */

var chai    = require('chai'),
    should  = chai.should(),
    fs      = require('fs'),
    path    = require('path'),
    // Used to recompute the route-table digest INDEPENDENTLY of the harness, which is what makes the
    // clause-11 assertions evidence rather than a tautology.
    crypto  = require('crypto'),
    config  = require('config'),
    capture = require('../../baseline/capture'),
    replay  = require('../../baseline/replay');

var BASELINE_DIR = path.join(__dirname, '..', '..', 'baseline'),
    CAPTURE_PATH = path.join(BASELINE_DIR, 'capture.js'),
    REPLAY_PATH  = path.join(BASELINE_DIR, 'replay.js'),
    TABLE_PATH   = path.join(BASELINE_DIR, 'route-table.json'),
    CORPUS_PATH  = path.join(BASELINE_DIR, 'responses.json');

/** Both harness sources, read once. Several guards below are source-text contracts. */
var captureSource  = fs.readFileSync(CAPTURE_PATH, 'utf8'),
    replaySource   = fs.readFileSync(REPLAY_PATH, 'utf8'),
    committedTable = JSON.parse(fs.readFileSync(TABLE_PATH, 'utf8')),
    committedCorpus = JSON.parse(fs.readFileSync(CORPUS_PATH, 'utf8'));

describe('the R-6 baseline harness', function() {

  // Fixture lifecycle

  describe('fixture cleanup (review finding M-6)', function() {
    /**
     * Runs `body` with the nine implicit model globals' `User` replaced by a stub whose every lookup
     * rejects, then restores whatever was there before - including its absence. Forcing BOTH removers to
     * fail is the only way to observe the aggregation contract without a live capture: cleanupIdentities()
     * must still attempt the second identity after the first one blew up, and must resolve rather than
     * reject so that the terminal `.finally` cannot lose the measurement's own error.
     */
    function withFailingUserLookup(body) {
      var had   = Object.prototype.hasOwnProperty.call(global, 'User'),
          saved = global.User;

      function restore() {
        if (had) {
          global.User = saved;
        } else {
          delete global.User;
        }
      }

      global.User = {
        findById : function() {
          return Promise.reject(new Error('forced lookup failure'));
        }
      };

      return Promise.resolve().then(body).then(function(value) {
        restore();

        return value;
      }, function(err) {
        restore();

        throw err;
      });
    }

    beforeEach(function() {
      capture.resetCleanupErrors();
    });

    afterEach(function() {
      capture.resetCleanupErrors();
    });

    it('ATTEMPTS both identities even when the first removal fails', function() {
      return withFailingUserLookup(function() {
        return capture.cleanupIdentities().then(function(failures) {
          // Both attempts ran, in the declared order, and each failure is labelled by identity — a cleanup
          // that stopped at the first failure would leave the second identity behind.
          failures.should.have.length(2);
          failures[0].should.contain('throwaway identity: ');
          failures[1].should.contain('assignment signup identity: ');
        });
      });
    });

    it('RESOLVES rather than rejecting, so a terminal finally cannot lose the real error', function() {
      // cleanupIdentities() is called from `.finally`, so if it rejected its own error would replace the
      // error the caller actually needs to see.
      return withFailingUserLookup(function() {
        return capture.cleanupIdentities().then(function(failures) {
          failures.should.be.an('array');
        }, function(err) {
          throw new Error('cleanupIdentities() rejected instead of collecting: ' +
                          (err && err.message ? err.message : String(err)));
        });
      });
    });

    it('publishes the collected failures through cleanupErrors(), which main() escalates to exit 2',
      function() {
        return withFailingUserLookup(function() {
          return capture.cleanupIdentities().then(function(failures) {
            capture.cleanupErrors().should.eql(failures);
            // A snapshot, not the live array: a caller must not be able to edit the evidence.
            capture.cleanupErrors().should.not.equal(capture.cleanupErrors());
          });
        });
      });

    it('clears the collected failures only when explicitly reset', function() {
      return withFailingUserLookup(function() {
        return capture.cleanupIdentities().then(function() {
          capture.cleanupErrors().should.have.length(2);
          capture.resetCleanupErrors();
          capture.cleanupErrors().should.eql([]);
        });
      });
    });

    it('runs the cleanup from ONE terminal finally, so a rejected measurement still reaches it',
      function() {
        captureSource.should.contain('  }).finally(function() {\n    return cleanupIdentities();\n  });');
      });

    it('registers BOTH identities the capture can create', function() {
      captureSource.should.contain("{ label : 'throwaway identity', run : removeThrowawayUser }");
      captureSource.should.contain(
        "{ label : 'assignment signup identity', run : removeAssignmentSignupUser }");
      captureSource.should.contain('CLEANUP_ERRORS.push(attempt.label');
    });

    it('propagates a removal failure instead of catching it', function() {
      // Both removers used to end in `.catch(function() { return undefined; })`. Swallowing there is
      // what let a run report success with fixtures still in the database.
      captureSource.should.not.contain('.catch(() => undefined)');
      /function removeThrowawayUser\(\)[\s\S]{0,400}?\n\}/.exec(captureSource)[0]
        .should.not.contain('catch');
      /function removeAssignmentSignupUser\(\)[\s\S]{0,400}?\n\}/.exec(captureSource)[0]
        .should.not.contain('catch');
    });

    it('keeps ONE terminal error handler ahead of stopServer, then escalates cleanup failures',
      function() {
        // The two-arm `.then(onOk, onFail)` shape is what skipped stopServer() when the artifact write
        // threw, leaving the process holding a listening socket. The delivered chain is
        // `.catch(...) -> .then(stopServer) -> .then(escalate cleanupErrors())`, in that order.
        var terminalChain = new RegExp('\\}\\)\\.catch\\(function\\(err\\) \\{' +
                                       '[\\s\\S]{0,600}?exitCode = 2;\\s*' +
                                       '\\}\\)\\.then\\(function\\(\\) \\{\\s*return stopServer\\(server\\);');

        captureSource.should.match(terminalChain);
        captureSource.should.contain('var failures = cleanupErrors();');
        captureSource.should.contain('capture.js: UNABLE TO RUN CLEANLY');
      });
  });

  // The documented anchor gate

  describe('the documented route-table anchor gate (review finding M-7)', function() {
    /**
     * A minimal live-table stand-in in canonicalizeLiveTable()'s shape - `{ gates, canonical, byKey }` -
     * seeded from the committed artifact so the gate is satisfied. `byKey` is what
     * capture.registrationOrderRows() resolves config.routes against, so a complete byKey is what makes
     * the registrationOrderContract clause reproduce the committed fingerprint. Mutating one field of the
     * returned object is how each test below proves the corresponding clause actually bites.
     */
    function measuredFromArtifact() {
      var byKey = {};

      committedTable.rows.forEach(function(row) {
        byKey[row.method + ' ' + row.path] = {
          method    : row.method,
          path      : row.path,
          auth      : JSON.parse(JSON.stringify(row.auth)),
          preCount  : row.preCount,
          canonical : row.canonical
        };
      });

      return {
        gates : {
          rowCount            : committedTable.gates.rowCount,
          methods             : JSON.parse(JSON.stringify(committedTable.gates.methods)),
          apiPaths            : committedTable.gates.apiPaths,
          withPreHandlers     : committedTable.gates.withPreHandlers,
          authRequiredSession : committedTable.gates.authRequiredSession,
          authFalse           : committedTable.gates.authFalse,
          authTryInherited    : committedTable.gates.authTryInherited
        },
        canonical : committedTable.rows.map(function(row) { return row.canonical; }),
        byKey     : byKey
      };
    }

    it('is ONE implementation: the gate lives in capture.js and replay.js re-exports it', function() {
      // Two copies of a gate is how a gate rots: one file enforces it while the other reports UNEVALUATED.
      // route-table.json can only name a single honest evaluator if there is a single one, and it names
      // capture.js — the harness that owns the artifact is the only one that can REGENERATE the stored verdict
      // beside the gate rather than carry a hand-authored boolean.
      capture.documentedAnchorGate.should.be.a('function');
      capture.DOCUMENTED_DIGEST.should.be.a('string');
      replay.documentedAnchorGate.should.equal(capture.documentedAnchorGate);
      replay.DOCUMENTED_DIGEST.should.equal(capture.DOCUMENTED_DIGEST);
      replaySource.should.not.contain('function documentedAnchorGate');
      (captureSource.match(/function documentedAnchorGate/g) || []).length.should.eql(1);
    });

    it('shares ONE canonicalizer between the two files rather than re-deriving it', function() {
      // The canonicalizer is the other half that used to exist twice. replay re-exports capture's, so a
      // live table can only ever be described one way.
      replay.canonicalizeLiveTable.should.equal(capture.canonicalizeLiveTable);
      replay.canonicalRow.should.equal(capture.canonicalRow);
      replay.authDescriptor.should.equal(capture.authDescriptor);
      replay.liveServerAuthDefault.should.equal(capture.liveServerAuthDefault);
    });

    it('holds the published literal verbatim, in the verifier rather than in the artifact', function() {
      capture.DOCUMENTED_DIGEST.should.eql('cd2a7e38a39bd84902ac1a0d69f50e2a');
      committedTable.gates.documentedDigest.should.eql(capture.DOCUMENTED_DIGEST);
      captureSource.should.contain("var DOCUMENTED_DIGEST = 'cd2a7e38a39bd84902ac1a0d69f50e2a';");
      // Declared once. replay.js binds the same value through capture's exports, so an edit to the
      // artifact cannot be matched by a quiet edit to a second copy of the literal.
      replaySource.should.not.contain("var DOCUMENTED_DIGEST = 'cd2a7e38a39bd84902ac1a0d69f50e2a';");
      replaySource.should.contain('var DOCUMENTED_DIGEST    = capture.DOCUMENTED_DIGEST;');
    });

    it('evaluates exactly the eleven clauses route-table.json publishes, in that order', function() {
      var verdict   = replay.documentedAnchorGate(measuredFromArtifact(), committedTable),
          published = committedTable.gates.documentedAnchorGate.clauses.map(function(text) {
            return String(text).split(' ')[0];
          });

      verdict.clauses.map(function(clause) { return clause.name; }).should.eql(published);
      verdict.clauses.length.should.eql(11);
      verdict.failures.should.eql([]);
      verdict.satisfied.should.eql(true);
      verdict.documentedDigest.should.eql(replay.DOCUMENTED_DIGEST);
    });

    it('resolves every committed declaration through the shared registration-order derivation',
      function() {
        var order = replay.registrationOrderCanonical(measuredFromArtifact());

        order.missing.should.eql([]);
        order.canonical.length.should.eql(committedTable.gates.rowCount);
      });

    [
      { clause : 'rowCount',            mutate : function(m) { m.gates.rowCount = 232; } },
      { clause : 'methods',             mutate : function(m) { m.gates.methods.GET = 136; } },
      { clause : 'apiPaths',            mutate : function(m) { m.gates.apiPaths = 116; } },
      { clause : 'withPreHandlers',     mutate : function(m) { m.gates.withPreHandlers = 160; } },
      { clause : 'authRequiredSession', mutate : function(m) { m.gates.authRequiredSession = 104; } },
      { clause : 'authFalse',           mutate : function(m) { m.gates.authFalse = 1; } },
      { clause : 'authTryInherited',    mutate : function(m) { m.gates.authTryInherited = 125; } },
      { clause : 'canonicalRowsTheDigestStandsFor',
        mutate : function(m) { m.canonical[0] = 'GET | /injected | false | 0'; } },
      { clause : 'registrationOrderContract',
        mutate : function(m) { delete m.byKey['GET /about']; } }
    ].forEach(function(probe) {
      it('FAILS the ' + probe.clause + ' clause when that value drifts', function() {
        var measured = measuredFromArtifact();

        probe.mutate(measured);

        var verdict = replay.documentedAnchorGate(measured, committedTable);

        verdict.failures.should.contain(probe.clause);
        verdict.satisfied.should.eql(false);
      });
    });

    it('FAILS the retention clause when the artifact overwrites the published literal', function() {
      var tampered = JSON.parse(JSON.stringify(committedTable));

      // Substituting a measurement for the published anchor is the single most consequential way this
      // artifact could be falsified, so clause 1 exists to catch exactly that.
      tampered.gates.documentedDigest = tampered.gates.measuredSha256First32;

      var verdict = replay.documentedAnchorGate(measuredFromArtifact(), tampered);

      verdict.failures.should.contain('documentedDigestRetainedVerbatim');
      verdict.satisfied.should.eql(false);
    });

    // Clause 11 — the digest this gate actually recomputes

    /**
     * The point of clause 11 is that it DERIVES a value rather than comparing two stored ones. Clause 1
     * cannot do that — the published 32-character literal has no published serialization to recompute it
     * from (ADJ-4) — so without clause 11 the gate could report `satisfied` while no digest had been computed
     * from the running server at all. These four tests pin the derivation itself: that the computed side is a
     * real hash of the live rows, that it is not read out of the artifact, that it moves when the rows move,
     * and that it uses the SORTED serialization the artifact publishes rather than registration order.
     */
    it('RECOMPUTES the measured digest from the live rows rather than reading it back', function() {
      var measured = measuredFromArtifact(),
          verdict  = replay.documentedAnchorGate(measured, committedTable),
          clause   = verdict.clauses.filter(function(entry) {
            return entry.name === 'measuredSha256RecomputedFromLiveTable';
          })[0],
          // Computed here, independently, straight from the artifact's published recipe.
          expected = crypto.createHash('sha256')
                       .update(measured.canonical.slice().sort().join('\n'), 'utf8').digest('hex');

      clause.satisfied.should.eql(true);
      clause.measured.measuredSha256.should.eql(expected);
      clause.measured.measuredSha256First32.should.eql(expected.slice(0, 32));

      // The documented side is the artifact's stored digest, so the clause is a comparison of a DERIVED
      // value against a STORED one — which is exactly what clause 1 is not.
      clause.documented.measuredSha256.should.eql(committedTable.gates.measuredSha256);
      clause.documented.measuredSha256First32.should.eql(committedTable.gates.measuredSha256First32);

      // And the derived value is a full-width sha256, unlike the 32-character published literal.
      clause.measured.measuredSha256.length.should.eql(64);
      clause.measured.measuredSha256.should.not.eql(replay.DOCUMENTED_DIGEST);
    });

    it('FAILS the measuredSha256RecomputedFromLiveTable clause when a live row changes', function() {
      var measured = measuredFromArtifact();

      measured.canonical[0] = 'GET | /injected | false | 0';

      var verdict = replay.documentedAnchorGate(measured, committedTable);

      // Both row clauses must fail together. That they cannot be made to disagree is the property being
      // asserted: the digest is a function of the rows, so no row edit can satisfy one and break the other.
      verdict.failures.should.contain('measuredSha256RecomputedFromLiveTable');
      verdict.failures.should.contain('canonicalRowsTheDigestStandsFor');
      verdict.satisfied.should.eql(false);
    });

    it('FAILS the clause when the artifact\'s stored digest is edited to anything else', function() {
      var tampered = JSON.parse(JSON.stringify(committedTable));

      tampered.gates.measuredSha256 = crypto.createHash('sha256').update('not the table').digest('hex');

      var verdict = replay.documentedAnchorGate(measuredFromArtifact(), tampered);

      verdict.failures.should.contain('measuredSha256RecomputedFromLiveTable');
      verdict.satisfied.should.eql(false);
    });

    it('uses the SORTED serialization, so a permutation is caught by the order clause instead',
      function() {
        var measured = measuredFromArtifact(),
            rotated  = measured.canonical.slice(1).concat(measured.canonical.slice(0, 1));

        measured.canonical = rotated;

        var verdict = replay.documentedAnchorGate(measured, committedTable),
            failed  = verdict.failures;

        // A permutation of the same 233 rows sorts to the same list, so the sorted digest is UNCHANGED.
        // This is the artifact's published contract ("sort, join \n"), not an accident, and it is why the
        // registration-order fingerprint is a separate clause rather than being folded into this one.
        failed.should.not.contain('measuredSha256RecomputedFromLiveTable');
        failed.should.not.contain('canonicalRowsTheDigestStandsFor');
      });

    it('is ENFORCED by the replay run, not merely computed', function() {
      // These are what turn the verdict into recorded differences, which is what sets replay's exit code.
      // The artifact's own stored flag is ANDed with the freshly computed verdict, so neither a stale
      // `true` in the file nor a passing computation alone can carry the gate.
      replaySource.should.contain("'gates.documentedAnchorGate (unsatisfied clauses)',");
      replaySource.should.contain('[], anchorGate.failures);');
      replaySource.should.contain("'gates.documentedAnchorGateSatisfied',");
      replaySource.should.contain('committedTable.gates.documentedAnchorGateSatisfied === true &&');
      replaySource.should.contain('anchorGate   = documentedAnchorGate(live, committedTable);');
    });

    it('no longer marks the anchor UNEVALUATED, and reports it as UNREPRODUCIBLE instead', function() {
      // The old revision pushed an UNEVALUATED gate here whose reason interpolated a key that read
      // "undefined", so the run could exit 0 without evaluating the anchor at all. The delivered capture
      // reports the DIGEST as unreproducible - it genuinely is; the artifact says so - and names the gate
      // that does check the 233 rows.
      captureSource.should.not.contain("unevaluatedGate('route-table gates.documentedDigest");
      captureSource.should.contain("gates.push(unreproducibleGate('route-table gates.documentedDigest (' +");
      captureSource.should.contain('capture.js#documentedAnchorGate');
      committedTable.gates.documentedDigestReproduced.should.eql('none');
    });

    it('gates all eleven clauses AND the verdict inside the capture CLI, not only inside the replay',
      function() {
        // route-table.json states that capture.js#routeTableGates turns every clause and the verdict into
        // pass/fail entries; these are the lines that make the statement true. main() sets exit 1 on any FAIL
        // and REFUSES to write over one, so a drifted clause cannot become a baseline.
        captureSource.should.contain('var anchor = documentedAnchorGate(measured, committedTable);');
        captureSource.should.contain("gate('route-table documentedAnchorGate clause ' + clause.name,");
        captureSource.should.contain("gate('route-table documentedAnchorGate unsatisfied clauses', [], " +
                                     'anchor.failures)');
        captureSource.should.contain("gate('route-table gates.documentedAnchorGateSatisfied', true,");
        captureSource.should.contain('committedTable.gates.documentedAnchorGateSatisfied === true && ' +
                                     'anchor.satisfied)');
      });

    it('REGENERATES the stored verdicts on write instead of carrying hand-authored booleans', function() {
      // Both verdict flags the artifact publishes appear in mergeMeasuredRouteTable's `recomputed` list, and
      // both are derived from this run's own evaluation of the MERGED artifact — the one about to be
      // written — rather than copied forward.
      captureSource.should.contain("'registrationOrderFingerprint', 'documentedAnchorGateSatisfied',");
      captureSource.should.contain("'documentedAnchorsExceptDigestAllReproduced']");
      captureSource.should.contain('var mergedVerdict = documentedAnchorGate(measured, merged);');
      captureSource.should.contain('merged.gates.documentedAnchorGateSatisfied = mergedVerdict.satisfied;');
      captureSource.should.contain('merged.gates.documentedAnchorsExceptDigestAllReproduced = ' +
                                   'countableAnchorsReproduced(mergedVerdict);');
      capture.mergeMeasuredRouteTable.should.be.a('function');

      // countableAnchorsReproduced() ignores the retention clause and bites on every other one.
      var verdict = { clauses : [{ name : 'documentedDigestRetainedVerbatim', satisfied : false },
                                 { name : 'rowCount', satisfied : true }] };

      capture.countableAnchorsReproduced(verdict).should.eql(true);
      verdict.clauses[1].satisfied = false;
      capture.countableAnchorsReproduced(verdict).should.eql(false);
    });

    it('regenerates the provenance section counts rather than restating them in prose', function() {
      // A prose sentence naming the reproduced counts inline cannot be recomputed and can therefore drift
      // from the arrays beside it, so the counts are written by the generator and gated against the live run.
      var counts = committedTable.metadata.toolchainReverification.reproducedCounts;

      counts.routeRows.should.eql(committedTable.gates.rowCount);
      counts.unauthenticated.should.eql(committedCorpus.gates.unauthenticatedEntryCount);
      counts.authenticated.should.eql(committedCorpus.gates.authenticatedEntryCount);
      counts.assignmentNext.should.eql(committedCorpus.gates.assignmentNextEntryCount);
      // The two artifacts carry the same block, written by the same run.
      committedCorpus.metadata.toolchainReverification.reproducedCounts.should.eql(counts);
      capture.recordReproducedCounts.should.be.a('function');
      captureSource.should.contain('recordReproducedCounts(table.artifact, counts);');
      captureSource.should.contain('recordReproducedCounts(corpus.artifact, counts);');
    });

    it('admits the UNREPRODUCIBLE verdict only while the artifact declares it', function() {
      // This is the guard that stops "unreproducible" becoming a silent bypass: if the artifact ever
      // claims the digest WAS reproduced, the gate turns into a FAIL rather than a shrug.
      capture.unreproducibleGate('n', 'r', 'none').status.should.eql('UNREPRODUCIBLE');
      capture.unreproducibleGate('n', 'r', 'partial').status.should.eql('FAIL');
      capture.unreproducibleGate('n', 'r', undefined).status.should.eql('FAIL');
      capture.unreproducibleGate('n', 'r', 'none').reason.should.eql('r');
    });

    it('leaves only genuine preconditions UNEVALUATED', function() {
      // The remaining UNEVALUATED gates are the absent CSS artifacts, the corpus skipped under
      // --routes-only, and an artifact that predates the asset-confinement contract. Those are real
      // preconditions (`npm run build` needs public/components hydrated), not bypassed contracts.
      // Nothing for the anchor.
      var unevaluated = captureSource.match(/unevaluatedGate\(/g) || [];

      // One declaration plus four calls: two build-artifact gates, the --routes-only corpus gate, and
      // the assetConfinementContract gate for an artifact generated before that block existed. The last
      // one cannot be reached through replay.js at all - loadArtifacts() lists
      // `assetConfinementContract` among the required blocks, so a missing one is a precondition failure
      // there - and it exists so that capture.js's own gate summary reports the absence rather than
      // silently gating nothing.
      unevaluated.length.should.eql(5);

      // The retired key is COMPARED against, never interpolated into a printed reason. Interpolating it
      // is what produced the literal string "undefined" in a gate nobody evaluated; passing it as the
      // declared value is what makes the verdict falsifiable.
      captureSource.should.contain('committedTable.gates.documentedDigestReproduced));');
    });

    it('names the same clause count the artifact advertises', function() {
      committedTable.gates.documentedAnchorGate.clauses.length.should.eql(11);
      committedTable.gates.documentedAnchorGateSatisfied.should.eql(true);
    });
  });

  // The destructive-operation endpoint gate

  /**
   * capture.js and test/helpers/db.js are the only two modules in this tree that destroy data, and both must
   * check WHICH SERVER they are destroying data on. NODE_ENV, the database name pattern and a forced name are
   * not enough on their own: a remote, credentialed, SRV-resolved, replica-set or TLS endpoint can satisfy all
   * three, because a provisioned deployment may legitimately own a database called `test`.
   *
   * These tests pin two things: that the rule is ONE implementation rather than two lookalikes, and that it
   * refuses every hazardous connection shape. They drive the pure functions with synthetic connection objects
   * and never open a socket — nothing in this repository may point a driver at a non-loopback host to prove a
   * negative.
   */
  describe('the destructive-operation endpoint gate (SV-04)', function() {

    var endpointGate = require('../../helpers/disposable-endpoint');

    /**
     * Builds a synthetic mongoose-connection shape. Only the fields the gate reads are modelled.
     *
     * @param   {Object} spec Any of host, port, user, pass, hosts, credentials, srvHost, replicaSet, tls.
     * @returns {Object} A connection-like object.
     */
    function connection(spec) {
      return {
        host     : spec.host,
        port     : spec.port || 27017,
        user     : spec.user,
        pass     : spec.pass,
        client   : { options : { hosts       : spec.hosts,
                                 credentials : spec.credentials,
                                 srvHost     : spec.srvHost,
                                 replicaSet  : spec.replicaSet,
                                 tls         : spec.tls } }
      };
    }

    /** A credential-free loopback mongod - the only identity the gate accepts. */
    function disposable(extra) {
      var spec = { host : 'localhost', hosts : [{ host : 'localhost', port : 27017 }] };

      Object.keys(extra || {}).forEach(function(key) { spec[key] = extra[key]; });

      return connection(spec);
    }

    it('is one shared implementation, not a copy in each destructive caller', function() {
      var dbSource      = fs.readFileSync(path.join(__dirname, '../../helpers/db.js'), 'utf8'),
          captureSource = fs.readFileSync(capture.__filename || path.join(__dirname,
                            '../../baseline/capture.js'), 'utf8');

      // Both destructive callers require the shared module...
      dbSource.should.contain("require('./disposable-endpoint')");
      captureSource.should.contain("require('../helpers/disposable-endpoint')");

      // ...and NEITHER declares the rule itself. If a later edit re-inlines either copy, this fails rather
      // than silently allowing the two to drift.
      dbSource.should.not.contain('function nonDisposableIdentityReasons(');
      captureSource.should.not.contain('function nonDisposableIdentityReasons(');
      dbSource.should.not.contain('var DISPOSABLE_HOSTS =');
      captureSource.should.not.contain('var DISPOSABLE_HOSTS =');

      // And capture.js re-exports the very object db.js uses, so the two cannot be different functions.
      capture.endpointGate.should.equal(endpointGate);
      capture.endpointGate.nonDisposableIdentityReasons.should.be.a('function');
    });

    it('loads without side effects, which is what lets the CLI share it with the Mocha helper',
      function() {
        var source = fs.readFileSync(path.join(__dirname, '../../helpers/disposable-endpoint.js'),
                       'utf8'),
            // Comments are stripped first: this module's header EXPLAINS why it may not require
            // anything, and naming `require(` in that explanation must not trip the check on itself.
            code   = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

        // The reason this module exists separately at all: test/helpers/db.js opens a connection and
        // pulls in the chai/sinon bootstrap on require, so capture.js - a CLI that runs outside Mocha -
        // could never have required it. A require() creeping in here would recreate that problem.
        code.should.not.contain('require(');
        code.should.not.contain('process.env');
        code.should.not.contain('mongoose');

        // It is pure functions over an argument, so it holds no module-level mutable state either.
        code.should.contain('function nonDisposableIdentityReasons(connection)');
        code.should.contain('module.exports');
      });

    it('accepts every loopback spelling a connection string can carry', function() {
      endpointGate.nonDisposableIdentityReasons(disposable()).should.eql([]);
      endpointGate.nonDisposableIdentityReasons(
        connection({ host : '127.0.0.1', hosts : [{ host : '127.0.0.1', port : 27017 }] })).should.eql([]);
      endpointGate.nonDisposableIdentityReasons(
        connection({ host : '[::1]', hosts : ['[::1]:27017'] })).should.eql([]);
      endpointGate.nonDisposableIdentityReasons(
        connection({ host : '::1', hosts : [{ host : '::1', port : 27017 }] })).should.eql([]);
    });

    it('refuses a non-loopback host, including one that appears only as a second seed', function() {
      var remote = endpointGate.nonDisposableIdentityReasons(
                     connection({ host  : 'db.prod.example.com',
                                  hosts : [{ host : 'db.prod.example.com', port : 27017 }] }));

      remote.length.should.eql(1);
      remote[0].should.contain('non-loopback host');
      remote[0].should.contain('db.prod.example.com:27017');

      // config/db.js appends a SECOND seed whenever db.mongoread.host is set, so a gate that read only
      // mongoose's own `connection.host` would call this loopback and be wrong.
      var second = endpointGate.nonDisposableIdentityReasons(
                     connection({ host  : 'localhost',
                                  hosts : [{ host : 'localhost', port : 27017 },
                                           { host : 'replica.example.com', port : 27017 }] }));

      second.length.should.eql(1);
      second[0].should.contain('replica.example.com:27017');
    });

    it('refuses a credential, from either the driver or mongoose', function() {
      endpointGate.nonDisposableIdentityReasons(disposable({ credentials : { username : 'admin' } }))
        .should.eql(['it authenticates as "admin"']);
      endpointGate.nonDisposableIdentityReasons(disposable({ user : 'root' }))
        .should.eql(['it authenticates as "root"']);
      endpointGate.nonDisposableIdentityReasons(disposable({ pass : 'secret' }))
        .should.eql(['it authenticates as "a user"']);
    });

    it('refuses an SRV cluster, a replica set and TLS', function() {
      endpointGate.nonDisposableIdentityReasons(disposable({ srvHost : 'cluster0.mongodb.net' }))
        .should.eql(['it resolves the SRV cluster "cluster0.mongodb.net"']);
      endpointGate.nonDisposableIdentityReasons(disposable({ replicaSet : 'rs0' }))
        .should.eql(['it targets the replica set "rs0"']);
      endpointGate.nonDisposableIdentityReasons(disposable({ tls : true }))
        .should.eql(['it negotiates TLS']);
    });

    it('fails closed when the connection cannot be identified at all', function() {
      // Neither of these is a loopback server; a gate that returned "no reasons" for an unreadable
      // connection would treat "I could not tell" as "it is safe".
      endpointGate.nonDisposableIdentityReasons({ host : 'localhost', port : 27017 })
        .should.eql(['the driver client exposes no options, so the endpoint cannot be identified']);
      endpointGate.nonDisposableIdentityReasons({ client : { options : {} } })
        .should.eql(['no host could be read from the connection']);
    });

    it('reports every reason at once, so one refusal does not mask the rest', function() {
      var reasons = endpointGate.nonDisposableIdentityReasons(
                      connection({ host        : 'db.example.com',
                                   hosts       : [{ host : 'db.example.com', port : 27017 }],
                                   credentials : { username : 'admin' },
                                   srvHost     : 'cluster0.mongodb.net',
                                   replicaSet  : 'rs0',
                                   tls         : true }));

      reasons.length.should.eql(5);
      endpointGate.refusalTail(reasons).should.contain('db.example.com');
      endpointGate.refusalTail(reasons).should.contain('credential-free loopback mongod');
    });

    it('is wired into the capture CLI\'s destructive gate, after the four name clauses', function() {
      var captureSource = fs.readFileSync(path.join(__dirname, '../../baseline/capture.js'), 'utf8'),
          gateBody      = captureSource.slice(
                            captureSource.indexOf('function assertDisposableDatabase(operation) {'));

      gateBody = gateBody.slice(0, gateBody.indexOf('\n}\n'));

      // The endpoint check must be INSIDE assertDisposableDatabase, not merely imported at the top of
      // the file, and it must read the LIVE connection rather than what configureRuntime() asked for.
      gateBody.should.contain('endpointGate.nonDisposableIdentityReasons(');
      gateBody.should.contain("require('mongoose').connection");
      gateBody.should.contain('endpointGate.refusalTail(');
      // It throws rather than returning, so a refusal cannot be ignored by a caller that drops the value.
      gateBody.should.contain('throw new Error(');
    });
  });

  // The asset-confinement contract

  describe('the asset-confinement contract (SV-40)', function() {

    it('publishes a probe for every shape, with the traversals recorded as refusals', function() {
      var contract = committedCorpus.assetConfinementContract;

      contract.probes.length.should.eql(8);
      contract.refusedStatus.should.eql(404);
      contract.legitimateStatus.should.eql(200);

      var traversals = contract.probes.filter(function(probe) {
        return probe.kind === 'traversal';
      });

      traversals.length.should.be.above(4);
      traversals.forEach(function(probe) {
        probe.expectedStatus.should.eql(contract.refusedStatus);
      });

      // The positive controls are what make this gated in BOTH directions: an over-eager guard that
      // refused a real asset URL would fail the contract too.
      contract.probes.filter(function(probe) {
        return probe.path === contract.servedProbe;
      })[0].expectedStatus.should.eql(contract.legitimateStatus);
    });

    it('keeps the published gate and the contract in agreement, probe for probe', function() {
      // Two copies of the same measurement would be how this rots, so they are asserted equal rather
      // than trusted. The gate is the value replay.js compares; the contract is the prose a reader sees.
      var contract = committedCorpus.assetConfinementContract,
          fromProbes = {};

      contract.probes.forEach(function(probe) {
        fromProbes[probe.path] = probe.expectedStatus;
      });

      committedCorpus.gates.assetConfinementStatuses.should.eql(contract.statuses);
      contract.statuses.should.eql(fromProbes);
    });

    it('recomputes the gate on every write rather than carrying it forward', function() {
      captureSource.should.contain("'assetConfinementStatuses'");
      captureSource.should.contain('merged.gates.assetConfinementStatuses');
      captureSource.should.contain('captureAssetConfinement(server)');
      // Enforced in all three places, exactly as the documented anchor is: the capture CLI's gate
      // summary, the replay CLI's difference list, and a suite that shares no code with either.
      captureSource.should.contain('.concat(assetConfinementGates(committed, measured))');
      replaySource.should.contain("'gates.assetConfinementStatuses'");
      replaySource.should.contain('capture.assetConfinementGates(committedCorpus, measured)');
      replaySource.should.contain("'assetConfinementContract',");
    });

    it('reads the cache prefix from configuration rather than restating it', function() {
      // A hard-coded prefix would stop matching the route the moment config.app.cachePrefix moved, and a
      // probe that reaches no route answers 404 for the wrong reason - which is the one way this gate
      // could pass while the hole was open.
      captureSource.should.contain("require('config').app.cachePrefix");
      committedCorpus.assetConfinementContract.probes.forEach(function(probe) {
        probe.path.indexOf('/' + config.app.cachePrefix).should.eql(0);
      });
    });

    it('allow-lists exactly the eight configured asset prefixes', function() {
      committedCorpus.assetConfinementContract.allowList.slice().sort()
        .should.eql(Object.keys(config.app.prefixes).slice().sort());
    });
  });

  // Evidence provenance

  describe('write-path provenance (review finding M-8)', function() {
    it('rejects --force as an unknown option rather than honouring it', function() {
      // The flag is not declared at all, and the parser is strict, so the shape of the refusal is a
      // parse error. That is stronger than a bespoke message: there is nothing left to honour.
      (function() {
        capture.parseArgv(['--write', '--force']);
      }).should.throw(/Unknown option '--force'/);
    });

    it('rejects --force even on its own', function() {
      (function() {
        capture.parseArgv(['--force']);
      }).should.throw(/Unknown option '--force'/);
    });

    it('no longer declares force as an option or reads it anywhere', function() {
      captureSource.should.not.contain("force         : { type : 'boolean'");
      captureSource.should.not.contain("force : { type : 'boolean'");
      captureSource.should.not.contain('options.force');
      captureSource.should.not.contain('parsed.force');
      captureSource.should.contain('There is no --force.');
    });

    it('parses strictly, with no positionals and no silently ignored flag', function() {
      captureSource.should.contain('strict : true');
      captureSource.should.contain('allowPositionals : false');
      replaySource.should.contain('strict : true');
      replaySource.should.contain('allowPositionals : false');
    });

    it('still parses every legitimate flag', function() {
      // A plain invocation CAPTURES AND WRITES; --dry-run is what suppresses the write. That inversion is
      // deliberate, so the legitimate combination for a route-table-only check names both flags.
      var options = capture.parseArgv(['--dry-run', '--routes-only', '--quiet']);

      options.routesOnly.should.eql(true);
      options.quiet.should.eql(true);
      options.dryRun.should.eql(true);
      options.write.should.eql(false);
      should.equal(options.out, null);
      options.adoptBaseCommit.should.eql(false);

      capture.parseArgv([]).write.should.eql(true);
      capture.parseArgv(['--out', '/tmp/x.json']).out.should.eql('/tmp/x.json');
    });

    it('refuses flag combinations that could produce evidence nobody asked for', function() {
      // --routes-only skips the HTTP corpus, so a writing run built from it would persist half an
      // artifact pair; and --dry-run writes nothing, so --out with it is meaningless.
      (function() {
        capture.parseArgv(['--routes-only']);
      }).should.throw(/--routes-only skips the HTTP corpus/);
      (function() {
        capture.parseArgv(['--dry-run', '--out', '/tmp/x.json']);
      }).should.throw(/--out has no meaning with it/);
      (function() {
        capture.parseArgv(['--dry-run', '--adopt-base-commit']);
      }).should.throw(/--dry-run/);
    });

    it('refuses to write when HEAD is not the recorded base commit, with adoption the only lift',
      function() {
        // Behavioral, not a source contract: this tree is past the recorded baseline, so the refusal is
        // observable. WHICH refusal fires depends on the tree, and all three are correct evidence — a dirty
        // tree at the right commit is not that commit either, and a tree carrying a gitignored configuration
        // layer is not the repository's configuration. What must never happen is a write allowed away from
        // the recorded baseline without adoption.
        //
        // The three classes are enumerated rather than matched loosely, so a FOURTH refusal appearing without
        // being recorded here fails this test instead of passing unnoticed.
        var refusalClasses = [
              'tracked file',                        // a modified tracked file
              committedCorpus.metadata.baseCommit,   // HEAD is not the recorded base commit
              'configuration layer'                  // a gitignored config/local.* layer is present
            ],
            matches = function(reason) {
              return refusalClasses.some(function(marker) {
                return reason.indexOf(marker) !== -1;
              });
            };

        var refused = capture.assertWritable(committedCorpus, { adoptBaseCommit : false });

        refused.allowed.should.eql(false);
        refused.adopting.should.eql(false);
        refused.reason.should.be.a('string');
        matches(refused.reason).should.eql(true);

        // The ONLY thing --adopt-base-commit lifts is the commit condition, and when it does the verdict
        // says so. A dirty tree or a configuration layer still refuses, which is why both arms are
        // asserted rather than one.
        var adopting = capture.assertWritable(committedCorpus, { adoptBaseCommit : true });

        if (adopting.allowed) {
          adopting.adopting.should.eql(true);
        } else {
          matches(adopting.reason).should.eql(true);
          adopting.reason.should.not.contain('Pass --adopt-base-commit');
        }
      });

    it('keeps the off-base refusal free of any escape other than adoption', function() {
      captureSource.should.contain('if (state.head !== recorded && !options.adoptBaseCommit) {');
      captureSource.should.contain('if (!writable.allowed) {');
      captureSource.should.match(/REFUSING to write [\s\S]{0,120}writable\.reason/);
    });

    it('refuses to write over a FAILING gate', function() {
      // A measurement that contradicts the contract the artifacts publish is a regression to report,
      // never a new baseline - and there is no flag that changes that.
      captureSource.should.contain('if (tally.fail) {');
      captureSource.should.contain('to report, not a new baseline.');
      captureSource.should.match(/if \(tally\.fail\) \{[\s\S]{0,400}?exitCode = 1;/);
    });

    it('refuses to write anything unless it can write BOTH artifacts', function() {
      // Half a pair is worse than none: the route table and the corpus cross-reference each other's
      // provenance, so a partial write leaves the two disagreeing about which commit they measure.
      captureSource.should.contain('writeArtifactPair(table.artifact, corpus.artifact);');
      capture.writeArtifactPair.should.be.a('function');
    });

    it('no longer downgrades an off-base write to a warning', function() {
      // A warning that is printed and then written over anyway is not a refusal, so the refusal is asserted
      // on the return value rather than on the message.
      captureSource.should.not.contain('The artifacts will no longer be baseline evidence');
      captureSource.should.not.contain('which is NOT the recorded base commit');
    });

    it('records the provenance of a write it does allow', function() {
      // Adoption is only honest if the artifact then says whose measurement it holds.
      captureSource.should.contain('captureCommit      : writable.state.head');
      captureSource.should.contain('gitStatusClean     : writable.state.trackedModifications.length === 0');
      captureSource.should.contain('adopting           : writable.adopting');
    });
  });

  // Exact origin comparison

  describe('origin classification (review finding M-13)', function() {
    var ORIGIN = 'https://trinket.dev';

    [
      { value : 'https://trinket.dev/u/instructor/classes/algebra-1', local : true },
      { value : 'https://trinket.dev',                               local : true },
      { value : 'https://trinket.dev?a=1',                           local : true },
      { value : 'https://trinket.dev#fragment',                      local : true },
      // The default HTTPS port IS the origin's port, so WHATWG normalizes ":443" away and this really is the
      // same origin: an exact origin comparison must say true here, and one that said false would be
      // rejecting a legitimate self-reference.
      { value : 'https://trinket.dev:443/x',                         local : true },
      { value : 'https://trinket.dev.evil.example/steal',            local : false },
      { value : 'https://trinket.dev@evil.example/steal',            local : false },
      { value : 'https://trinket.devil/steal',                       local : false },
      { value : 'http://trinket.dev/x',                              local : false },
      { value : '//evil.example/steal',                              local : false },
      { value : '/courses/algebra-1',                                local : false },
      { value : 'javascript:alert(1)',                               local : false },
      { value : '',                                                  local : false },
      { value : null,                                                local : false }
    ].forEach(function(probe) {
      it('treats ' + JSON.stringify(probe.value) + ' as ' + (probe.local ? 'local' : 'FOREIGN'),
        function() {
          capture.sameOrigin(probe.value, ORIGIN).should.eql(probe.local);
        });
    });

    it('disagrees with prefix matching on exactly the shapes that defeat it', function() {
      var defeatsPrefixMatching = [
        'https://trinket.dev.evil.example/steal',
        'https://trinket.dev@evil.example/steal',
        'https://trinket.devil/steal'
      ];

      defeatsPrefixMatching.forEach(function(value) {
        // Every one of these begins with the origin, which is why the old prefix test passed them...
        value.indexOf(ORIGIN).should.eql(0, value + ' must begin with the origin for this to be a test');
        // ...and none of them is on it.
        capture.sameOrigin(value, ORIGIN).should.eql(false, value);
      });

      // The prefix test is not merely too permissive; it is simply not an origin test. It happens to get
      // the default-port form right, which is why "it passed the old test" proves nothing either way.
      'https://trinket.dev:443/x'.indexOf(ORIGIN).should.eql(0);
      capture.sameOrigin('https://trinket.dev:443/x', ORIGIN).should.eql(true);

      captureSource.should.not.contain('indexOf(origin) === 0');
    });

    it('has no helper that rebases a recorded corpus onto a different origin', function() {
      // Rebasing was removed as a defect: injecting the replay's own origin into the recorded Locations
      // lets a build that emits the WRONG origin replay clean. The delivered harness refuses the run
      // instead, through originPrecondition().
      should.not.exist(capture.rebaseOrigin);
      should.not.exist(capture.isAbsoluteOnOrigin);
      captureSource.should.not.contain('rebaseOrigin');
      captureSource.should.not.contain('isAbsoluteOnOrigin');
      capture.originPrecondition.should.be.a('function');
    });

    it('refuses a replay whose live origin is not the recorded one, instead of adapting to it',
      function() {
        var live = capture.liveAppUrlOrigin();

        capture.originPrecondition({ metadata : { appUrlOrigin : live } }).satisfied.should.eql(true);

        var missing = capture.originPrecondition({ metadata : {} });

        missing.satisfied.should.eql(false);
        missing.remedy.should.contain('metadata.appUrlOrigin');

        // A lookalike of the recorded origin is not the recorded origin, and the precondition is the
        // place that has to know it - it is the same sameOrigin() the classifier uses.
        var lookalike = capture.originPrecondition({
          metadata : { appUrlOrigin : 'https://trinket.dev.evil.example' }
        });

        lookalike.satisfied.should.eql(false);
        lookalike.recorded.should.eql('https://trinket.dev.evil.example');
        lookalike.remedy.should.contain('captured under');
      });

    it('classifies a lookalike Location as other rather than as a same-origin absolute redirect',
      function() {
        var kinds = capture.redirectLocationKinds([
          { status : 302, location : 'https://trinket.dev/home' },
          { status : 302, location : 'https://trinket.dev.evil.example/steal' },
          { status : 302, location : 'https://trinket.dev@evil.example/steal' },
          { status : 302, location : '/login' },
          { status : 200, location : null }
        ], 'https://trinket.dev');

        kinds.absolute.should.eql(['https://trinket.dev/home']);
        kinds.relative.should.eql(['/login']);
        kinds.other.should.eql(['https://trinket.dev.evil.example/steal',
                                'https://trinket.dev@evil.example/steal']);
      });

    it('no longer resolves a redirect chain onto a lookalike host', function() {
      // classifyHopTarget is what decides whether a hop can be followed inside the process under test.
      // A followable target here would have meant issuing a request derived from an off-origin URL.
      var local  = capture.classifyHopTarget('https://trinket.dev/home', 'https://trinket.dev', null),
          look   = capture.classifyHopTarget('https://trinket.dev.evil.example/steal',
                                             'https://trinket.dev', null),
          userInfo = capture.classifyHopTarget('https://trinket.dev@evil.example/steal',
                                               'https://trinket.dev', null);

      local.target.should.eql('/home');
      local.mappedBy.should.eql('config.url origin');
      should.equal(look.target, null);
      should.equal(look.mappedBy, null);
      should.equal(userInfo.target, null);
      should.equal(userInfo.mappedBy, null);
    });
  });
});
