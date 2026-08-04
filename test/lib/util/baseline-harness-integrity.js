/**
 * Integrity guards for the R-6 baseline harness itself: test/baseline/capture.js and
 * test/baseline/replay.js.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The parity corpus is the tie-breaker for every behavioral question this migration raises (R-6), so its
 * harness is not ordinary test code - it is the instrument the whole migration is measured with. Code
 * review found four ways the instrument could lie, and each one is closed here by a test that FAILS if
 * the defect returns:
 *
 *   M-6  Fixture lifecycle. A capture creates up to two throwaway identities. The rejection arm of a
 *        two-arm `.then(onOk, onFail)` chain used to skip the cleanup that lived in the fulfilment arm,
 *        so a failed capture left one identity behind; and a cleanup failure used to be swallowed, so a
 *        run could report success while fixtures survived in the database.
 *   M-7  Gate integrity. The documented route-table anchor was marked UNEVALUATED and printed a reason
 *        interpolating a key that read "undefined", so a run could exit 0 without ever evaluating the
 *        gate the artifact calls mandatory.
 *   M-8  Evidence provenance. A forcing flag could persist measurements taken away from the base commit,
 *        or over a FAILING gate, while metadata.baseCommit and every hand-authored "measured at 2f8712a"
 *        note stayed behind - leaving the artifact asserting a provenance its numbers no longer had.
 *   M-13 Harness correctness. Origin checks used `location.indexOf(origin) === 0`. A prefix test is not
 *        an origin test, and the corpus deliberately carries the exact shapes that defeat one.
 *
 * WHICH HARNESS THIS FILE GUARDS
 * ------------------------------
 * The delivered harness divides the M-6/M-7/M-8/M-13 remediations between the two files, and this spec
 * is written against that division rather than against any earlier shape of it. Concretely:
 *
 *   - Cleanup is `capture.cleanupIdentities()` called from ONE terminal `.finally`, which ATTEMPTS both
 *     identities, COLLECTS failures in CLEANUP_ERRORS instead of raising, and lets main() turn a
 *     non-empty `cleanupErrors()` into exit 2. There is no generic `runWithCleanup(work, steps)` wrapper;
 *     the aggregation is the contract, and it is what is asserted below.
 *   - The documented anchor gate lives in ONE place, `replay.js#documentedAnchorGate`, together with the
 *     `DOCUMENTED_DIGEST` literal. capture.js owns the artifact but does NOT re-implement the gate: it
 *     reports the digest through `unreproducibleGate()`, whose verdict is admissible only while the
 *     artifact declares `gates.documentedDigestReproduced === 'none'`, and whose reason names replay's
 *     gate as the thing that actually checks the 233-row table. The canonicalizer IS shared - replay
 *     re-exports capture's - so there is exactly one implementation of each half.
 *   - The write path is gated by `capture.assertWritable()`. There is no forcing flag at all: an
 *     unknown-option parse error is what a stale `--force` now earns, and the only sanctioned lift is
 *     `--adopt-base-commit`, which renames the baseline on the record.
 *   - Origins are compared with `capture.sameOrigin()` (exact WHATWG origin equality) and preconditioned
 *     with `capture.originPrecondition()`. No helper rebases a recorded corpus onto a different origin -
 *     rebasing was removed as a defect, because an injected origin lets a build that emits the wrong one
 *     replay clean.
 *
 * WHAT IS DELIBERATELY NOT DONE HERE
 * ----------------------------------
 * Nothing in this file starts a server, issues a request or writes an artifact. capture.js and replay.js
 * are both guarded with `require.main === module`, so requiring them is inert; these tests exercise their
 * pure functions and read their source text. The behavioral half of the harness is proven by running it -
 * `node test/baseline/capture.js` and `node test/baseline/replay.js` - which is a different job from
 * guarding it against regression, and this file is the guard.
 *
 * The one ambient dependency is `require('config').routes`, which the registrationOrderContract clause
 * walks. It is populated by config/app.config.js, which test/helpers/flow.js requires at load time.
 * Mocha loads every spec file before running any test, so it is always present by the time an `it()`
 * body executes - which is why no gate is ever evaluated at describe-body time below.
 */

var chai    = require('chai'),
    should  = chai.should(),
    fs      = require('fs'),
    path    = require('path'),
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

  // -------------------------------------------------------------------------------------------
  // M-6 — fixture lifecycle
  // -------------------------------------------------------------------------------------------

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
          // Both attempts ran, in the recorded order, and each failure is labelled by identity. The
          // earlier revision reached only one of the two, because the second lived in a fulfilment arm.
          failures.should.have.length(2);
          failures[0].should.contain('throwaway identity: ');
          failures[1].should.contain('assignment signup identity: ');
        });
      });
    });

    it('RESOLVES rather than rejecting, so a terminal finally cannot lose the real error', function() {
      // cleanupIdentities() is called from `.finally`. If it rejected, its own error would replace the
      // measurement error the caller needs, which is exactly what review finding F14 was about.
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

  // -------------------------------------------------------------------------------------------
  // M-7 — the documented anchor gate
  // -------------------------------------------------------------------------------------------

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

    it('is ONE implementation: the gate lives in replay.js and capture.js does not copy it', function() {
      // Two copies of a gate is how a gate rots - it was enforced in one file and marked UNEVALUATED in
      // the other. route-table.json can only name a single honest evaluator if there is a single one.
      replay.documentedAnchorGate.should.be.a('function');
      replay.DOCUMENTED_DIGEST.should.be.a('string');
      should.not.exist(capture.documentedAnchorGate);
      should.not.exist(capture.DOCUMENTED_DIGEST);
      captureSource.should.not.contain('function documentedAnchorGate');
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
      replay.DOCUMENTED_DIGEST.should.eql('cd2a7e38a39bd84902ac1a0d69f50e2a');
      committedTable.gates.documentedDigest.should.eql(replay.DOCUMENTED_DIGEST);
      replaySource.should.contain("var DOCUMENTED_DIGEST = 'cd2a7e38a39bd84902ac1a0d69f50e2a';");
    });

    it('evaluates exactly the ten clauses route-table.json publishes, in that order', function() {
      var verdict   = replay.documentedAnchorGate(measuredFromArtifact(), committedTable),
          published = committedTable.gates.documentedAnchorGate.clauses.map(function(text) {
            return String(text).split(' ')[0];
          });

      verdict.clauses.map(function(clause) { return clause.name; }).should.eql(published);
      verdict.clauses.length.should.eql(10);
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

    it('is ENFORCED by the replay run, not merely computed', function() {
      // These are what turn the verdict into recorded differences, which is what sets replay's exit code.
      // The artifact's own stored flag is ANDed with the freshly measured verdict, so neither a stale
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
      captureSource.should.contain('replay.js#documentedAnchorGate');
      committedTable.gates.documentedDigestReproduced.should.eql('none');
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
      // The remaining UNEVALUATED gates are the absent CSS artifacts and the corpus skipped under
      // --routes-only. Those are real preconditions (`npm run build` needs public/components hydrated),
      // not bypassed contracts. Nothing for the anchor.
      var unevaluated = captureSource.match(/unevaluatedGate\(/g) || [];

      // One declaration plus three calls: two build-artifact gates and the --routes-only corpus gate.
      unevaluated.length.should.eql(4);

      // The retired key is COMPARED against, never interpolated into a printed reason. Interpolating it
      // is what produced the literal string "undefined" in a gate nobody evaluated; passing it as the
      // declared value is what makes the verdict falsifiable.
      captureSource.should.contain('committedTable.gates.documentedDigestReproduced));');
    });

    it('names the same clause count the artifact advertises', function() {
      committedTable.gates.documentedAnchorGate.clauses.length.should.eql(10);
      committedTable.gates.documentedAnchorGateSatisfied.should.eql(true);
    });
  });

  // -------------------------------------------------------------------------------------------
  // M-8 — evidence provenance
  // -------------------------------------------------------------------------------------------

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
        // Behavioral, not a source contract: this tree is above the recorded baseline, so the refusal is
        // observable. Which of the two refusals fires depends on whether the tree is also dirty, and both
        // are correct evidence - a dirty tree at the right commit is not that commit either. What must
        // never happen is a write allowed away from the recorded baseline without adoption.
        var refused = capture.assertWritable(committedCorpus, { adoptBaseCommit : false });

        refused.allowed.should.eql(false);
        refused.adopting.should.eql(false);
        refused.reason.should.be.a('string');

        if (refused.reason.indexOf('tracked file') === -1) {
          refused.reason.should.contain(committedCorpus.metadata.baseCommit);
        }

        // The ONLY thing that lifts it is --adopt-base-commit, and when it does the verdict says so. A
        // dirty tree still refuses first, which is why both arms are asserted rather than one.
        var adopting = capture.assertWritable(committedCorpus, { adoptBaseCommit : true });

        if (adopting.allowed) {
          adopting.adopting.should.eql(true);
        } else {
          adopting.reason.should.contain('tracked file');
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
      // The old revision printed "WARNING - writing from <head>, which is NOT the recorded base commit"
      // and then wrote anyway.
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

  // -------------------------------------------------------------------------------------------
  // M-13 — exact origin comparison
  // -------------------------------------------------------------------------------------------

  describe('origin classification (review finding M-13)', function() {
    var ORIGIN = 'https://trinket.dev';

    [
      { value : 'https://trinket.dev/u/instructor/classes/algebra-1', local : true },
      { value : 'https://trinket.dev',                               local : true },
      { value : 'https://trinket.dev?a=1',                           local : true },
      { value : 'https://trinket.dev#fragment',                      local : true },
      // The default HTTPS port IS the origin's port, so WHATWG normalizes ":443" away and this really is
      // the same origin. Measured, not assumed: an exact origin comparison must say true here, and a
      // check that said false would be rejecting a legitimate self-reference.
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
