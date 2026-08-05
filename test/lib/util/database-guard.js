var path      = require('path'),
    config    = require('config'),
    should    = require('chai').should(),
    spawnSync = require('child_process').spawnSync;

/**
 * The test-database FAIL-CLOSED gate.
 *
 * test/helpers/db.js calls `dropDatabase()` twice: once while it initializes, and once per `db.reset()`. The
 * name it acts on is whatever node-config finally resolved, which is NOT simply whatever config/test.yaml
 * says — `local.yaml` layers after it and `NODE_CONFIG` above both — so a misconfigured shell, a stray
 * environment variable or a parallel clone can repoint the target at a development database or at another
 * clone's. The gate must REFUSE, not delete, and that refusal is what these tests pin.
 *
 * They run in a CHILD PROCESS for two reasons: the guarded code path executes during module load, so it
 * cannot be re-entered inside a suite that has already loaded it, and the point is to observe what a
 * DIFFERENT environment does. The positive half of the contract — that a disposable database really is
 * cleared — is proven by the rest of the suite, which depends on `db.reset()` emptying the database between
 * the outer boundaries of test/lib/api/index.js.
 *
 * THIS SPEC IS ITSELF SAFE, by three load-bearing properties:
 *
 *   1. EVERY probe name is unique per clone AND per run — `CLONE_INDEX`, the pid and a monotonic counter are
 *      folded in — so no two processes can address the same probe database. `CLONE_INDEX` is PASSED THROUGH
 *      rather than cleared, so the isolation the rest of the suite relies on survives.
 *   2. NOTHING is ever dropped at database level. The probe creates exactly one collection holding exactly
 *      one sentinel document and removes exactly that, so a database this spec did not create cannot be
 *      reached and one it did create is left holding nothing.
 *   3. The child's exit status and spawn error are ASSERTED, so a probe that died before reaching its verdict
 *      fails this spec instead of being read as agreement.
 *
 * Both probe names must still be refused by `DISPOSABLE_DATABASE` in test/helpers/db.js, and per-run
 * uniqueness does not weaken that: the first does not begin with `test`, and the second is deliberately built
 * as `test` followed immediately by letters and digits with NO `_`/`-` separator — exactly the shape that
 * makes a bare `startsWith("test")` check unsafe and that the anchored pattern must refuse.
 */
describe('Test database fail-closed gate', function() {
  var REPO_ROOT = path.resolve(__dirname, '../../..'),
      // A per-run discriminator: the clone namespace when there is one, then the pid, then a counter for
      // the second probe in the same process. Lower-cased and stripped, because MongoDB database names
      // are case-insensitive on some platforms and reject several punctuation characters outright.
      RUN_TAG   = String(process.env.CLONE_INDEX || 'solo')
                    .replace(/[^A-Za-z0-9]/g, '')
                    .toLowerCase() + 'p' + process.pid,
      probeSeq  = 0;

  /**
   * A probe database name that is unique to this clone, this process and this call, and that
   * test/helpers/db.js must refuse.
   *
   * @param   {string} prefix Either 'notatest_m1guard' (does not begin with `test`) or 'testing' (begins
   *                          with `test` but has no `_`/`-` separator after it).
   * @returns {string} The unique name.
   */
  function probeName(prefix) {
    probeSeq += 1;

    return prefix + RUN_TAG + 'n' + probeSeq;
  }

  /**
   * Runs one probe in a child process and returns its verdict.
   *
   * The child's whole job is to observe what test/helpers/db.js does when node-config resolves a
   * non-disposable database name. It is written to be incapable of destroying anything it did not create:
   * it FAILS CLOSED if the probe database already exists, it never calls `dropDatabase()`, and it removes
   * only the sentinel document and the collections that came into existence inside its own lifetime.
   *
   * @param   {string} databaseName A name unique to this clone, process and call - see probeName().
   * @returns {{verdict: Object, output: string}} The parsed verdict and the raw child output.
   */
  function runProbe(databaseName) {
    var script = [
      'var mongoose = require("mongoose");',
      'var config   = require("config");',
      'var target   = config.db.mongo;',
      'var base     = "mongodb://" + target.host + ":" + target.port + "/";',
      'var uri      = base + target.database;',
      'var out      = {',
      '  database         : target.database,',
      '  preexisting      : null,',
      '  sentinelSurvived : null,',
      '  droppedCollections : [],',
      '  remaining        : null,',
      '  databaseStillPresent : null,',
      '  stderr           : ""',
      '};',
      'function databaseNames(connection) {',
      '  return connection.db.admin().listDatabases().then(function(result) {',
      '    return result.databases.map(function(entry) { return entry.name; });',
      '  });',
      '}',
      'mongoose.createConnection(base + "admin").asPromise()',
      '  .then(function(admin) {',
      '    return databaseNames(admin).then(function(names) {',
      '      out.preexisting = names.indexOf(target.database) !== -1;',
      '      return admin.close();',
      '    });',
      '  })',
      '  .then(function() {',
      // FAIL CLOSED. The probe name is unique per clone, per process and per call, so it cannot already
      // exist; if it somehow does, this process must not touch it - the whole point of the spec is that a
      // database nobody declared disposable is never deleted.
      '    if (out.preexisting) {',
      '      throw new Error("probe database " + JSON.stringify(target.database) + " already exists; " +',
      '        "refusing to seed or clean a database this probe did not create");',
      '    }',
      '    return mongoose.createConnection(uri).asPromise();',
      '  })',
      '  .then(function(seed) {',
      '    return seed.collection("m1sentinel").insertOne({ _id : "m1-sentinel" })',
      '      .then(function() { return seed.close(); });',
      '  })',
      '  .then(function() {',
      // Loading the helper is what triggers the guarded initialize-time dropDatabase().
      '    require("./test/helpers/db.js");',
      '    return new Promise(function(resolve) { setTimeout(resolve, 1500); });',
      '  })',
      '  .then(function() {',
      '    return mongoose.createConnection(uri).asPromise();',
      '  })',
      '  .then(function(check) {',
      '    return check.collection("m1sentinel").findOne({ _id : "m1-sentinel" })',
      '      .then(function(doc) {',
      '        out.sentinelSurvived = !!doc;',
      '        return check.collection("m1sentinel").deleteOne({ _id : "m1-sentinel" });',
      '      })',
      // Only the sentinel document and the collections that appeared inside this process's own lifetime
      // are removed, one at a time. `dropDatabase()` is never called anywhere in this probe, so no
      // invocation of it can ever be pointed at the wrong name.
      '      .then(function() { return check.db.collections(); })',
      '      .then(function(collections) {',
      '        return collections.reduce(function(chain, collection) {',
      '          return chain.then(function() {',
      '            return collection.drop().then(function() {',
      '              out.droppedCollections.push(collection.collectionName);',
      '            });',
      '          });',
      '        }, Promise.resolve());',
      '      })',
      '      .then(function() { return check.db.listCollections().toArray(); })',
      '      .then(function(remaining) {',
      '        out.remaining = remaining.map(function(entry) { return entry.name; });',
      '        return databaseNames(check);',
      '      })',
      '      .then(function(names) {',
      '        out.databaseStillPresent = names.indexOf(target.database) !== -1;',
      '        return check.close();',
      '      });',
      '  })',
      '  .then(function() {',
      '    process.stdout.write("PROBE:" + JSON.stringify(out) + ":ENDPROBE");',
      '    process.exit(0);',
      '  })',
      '  .catch(function(err) {',
      '    out.stderr = err.message;',
      '    process.stdout.write("PROBE:" + JSON.stringify(out) + ":ENDPROBE");',
      '    process.exit(1);',
      '  });'
    ].join('\n');

    var child = spawnSync(process.execPath, ['-e', script], {
      cwd      : REPO_ROOT,
      encoding : 'utf8',
      timeout  : 60000,
      env      : Object.assign({}, process.env, {
        // The child requires `config` BEFORE it requires the db helper, and node-config resolves its
        // whole layered configuration on that first require, so this object - not test/setup.js's later
        // mutation of the same variable - is what the guarded code path sees. Everything the child needs
        // is therefore stated here rather than inherited from a developer's gitignored local.yaml: the
        // mongod this run is already using, the non-disposable probe name, and a session password long
        // enough that requiring app.js does not `process.exit(1)` at app.js:47-62.
        NODE_ENV    : 'test',
        NODE_CONFIG : JSON.stringify({
          app : {
            start   : false,
            plugins : {
              session : {
                cookieOptions : { password : 'trinket-oss-database-guard-probe-password' }
              }
            }
          },
          db  : {
            mongo : {
              host     : config.db.mongo.host,
              port     : config.db.mongo.port,
              database : databaseName
            }
          }
        })
        // CLONE_INDEX is deliberately NOT cleared: it is inherited, it is folded into every probe name
        // above, and the assertion below is about the database name the child actually resolved, which
        // the verdict reports back rather than assuming.
      })
    });

    // A probe that never ran — a spawn failure, a signal, a non-zero exit before its verdict — must fail
    // this spec, not be mistaken for agreement.
    should.not.exist(child.error);
    should.not.exist(child.signal);

    // The refusal is announced on stderr by design - a suite that aborts on its first hook should say
    // why even when the reporter output scrolls past - so both streams are inspected.
    var output    = (child.stdout || '') + (child.stderr || ''),
        delimited = /PROBE:([\s\S]*?):ENDPROBE/.exec(output);

    should.exist(delimited, 'probe produced no verdict; raw output was ' + JSON.stringify(output));

    var verdict = JSON.parse(delimited[1]);

    child.status.should.eql(0, 'probe exited ' + child.status + ' with ' +
      JSON.stringify(verdict.stderr) + '; raw output was ' + JSON.stringify(output));
    verdict.stderr.should.eql('');
    // The probe database did not exist before this process created it, so everything the probe removed
    // was data it had created itself - and it left nothing behind.
    verdict.preexisting.should.be.false;
    verdict.droppedCollections.should.contain('m1sentinel');
    verdict.remaining.should.eql([]);
    verdict.databaseStillPresent.should.be.false;

    return {
      verdict : verdict,
      output  : output
    };
  }

  it('refuses to clear a database whose name is not explicitly disposable', function() {
    this.timeout(90000);

    var name  = probeName('notatest_m1guard'),
        probe = runProbe(name);

    probe.verdict.database.should.eql(name);
    probe.output.should.contain('db helper refused to initialize the database "' + name + '"');
    probe.output.should.contain('only "test" and "test_<suffix>" are treated as disposable');
    probe.verdict.sentinelSurvived.should.be.true;
  });

  it('refuses a name that merely starts with the disposable prefix', function() {
    this.timeout(90000);

    // `testing…` is the shape that makes a bare `startsWith("test")` check unsafe, so the pattern is
    // anchored on a `_`/`-` separator and this must fail closed too. The run tag is appended with no
    // separator precisely so the name keeps that shape while still being unique to this run.
    var name  = probeName('testing'),
        probe = runProbe(name);

    probe.verdict.database.should.eql(name);
    probe.output.should.contain('db helper refused to initialize the database "' + name + '"');
    probe.verdict.sentinelSurvived.should.be.true;
  });
});
