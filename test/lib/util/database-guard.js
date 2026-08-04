var path      = require('path'),
    should    = require('chai').should(),
    spawnSync = require('child_process').spawnSync;

/**
 * Review finding M1 (CWE-20, data loss) - the test-database fail-closed gate.
 *
 * test/helpers/db.js calls `dropDatabase()` twice: once while it initializes, and once per
 * `db.reset()`. The name it acts on is whatever node-config finally resolved, and that is NOT simply
 * whatever config/test.yaml says - `local.yaml` is layered after it and `NODE_CONFIG` above both, so a
 * misconfigured shell, a stray environment variable or a parallel clone can repoint the target at a
 * development database or at another clone's. The gate must therefore refuse, not delete.
 *
 * This runs in a CHILD PROCESS for two reasons. The guarded code path executes during module load, so it
 * cannot be re-entered inside a suite that has already loaded it; and the whole point is to observe what
 * a DIFFERENT environment does, which means a different process. The pattern matches the existing
 * child-process specs in this directory (no-response-fate.js, oauth-form-encoding.js).
 *
 * The positive half of the contract - that a disposable database really is cleared - is proven by the
 * rest of the suite, which depends on `db.reset()` emptying the database between the outer boundaries of
 * test/lib/api/index.js.
 */
describe('Test database fail-closed gate', function() {
  var REPO_ROOT = path.resolve(__dirname, '../../..');

  function runProbe(databaseName) {
    var script =
      'var mongoose = require("mongoose");' +
      'var config   = require("config");' +
      'var target   = config.db.mongo;' +
      'var uri      = "mongodb://" + target.host + ":" + target.port + "/" + target.database;' +
      'var out      = { database : target.database, sentinelSurvived : null, stderr : "" };' +
      'mongoose.createConnection(uri).asPromise()' +
      '  .then(function(seed) {' +
      '    return seed.collection("m1sentinel").insertOne({ _id : "m1-sentinel" })' +
      '      .then(function() { return seed.close(); });' +
      '  })' +
      '  .then(function() {' +
      // Loading the helper is what triggers the guarded initialize-time dropDatabase().
      '    require("./test/helpers/db.js");' +
      '    return new Promise(function(resolve) { setTimeout(resolve, 1500); });' +
      '  })' +
      '  .then(function() {' +
      '    return mongoose.createConnection(uri).asPromise();' +
      '  })' +
      '  .then(function(check) {' +
      '    return check.collection("m1sentinel").findOne({ _id : "m1-sentinel" })' +
      '      .then(function(doc) {' +
      '        out.sentinelSurvived = !!doc;' +
      '        return check.db.dropDatabase().then(function() { return check.close(); });' +
      '      });' +
      '  })' +
      '  .then(function() {' +
      '    process.stdout.write("PROBE:" + JSON.stringify(out) + ":ENDPROBE");' +
      '    process.exit(0);' +
      '  })' +
      '  .catch(function(err) {' +
      '    out.stderr = err.message;' +
      '    process.stdout.write("PROBE:" + JSON.stringify(out) + ":ENDPROBE");' +
      '    process.exit(1);' +
      '  });';

    var child = spawnSync(process.execPath, ['-e', script], {
      cwd      : REPO_ROOT,
      encoding : 'utf8',
      timeout  : 60000,
      env      : Object.assign({}, process.env, {
        NODE_CONFIG : JSON.stringify({ db : { mongo : { database : databaseName } } }),
        // Explicitly cleared so the child cannot inherit this run's namespace and quietly retarget
        // itself at a disposable database, which would make the assertion below vacuous.
        CLONE_INDEX : ''
      })
    });

    // The refusal is announced on stderr by design - a suite that aborts on its first hook should say
    // why even when the reporter output scrolls past - so both streams are inspected.
    var output   = (child.stdout || '') + (child.stderr || ''),
        delimited = /PROBE:([\s\S]*?):ENDPROBE/.exec(output);

    should.exist(delimited, 'probe produced no verdict; raw output was ' + JSON.stringify(output));

    return {
      verdict : JSON.parse(delimited[1]),
      output  : output
    };
  }

  it('refuses to clear a database whose name is not explicitly disposable', function() {
    this.timeout(90000);

    var probe = runProbe('notatest_m1guard');

    probe.verdict.database.should.eql('notatest_m1guard');
    probe.output.should.contain('db helper refused to initialize the database "notatest_m1guard"');
    probe.output.should.contain('only "test" and "test_<suffix>" are treated as disposable');
    probe.verdict.sentinelSurvived.should.be.true;
  });

  it('refuses a name that merely starts with the disposable prefix', function() {
    this.timeout(90000);

    // `testing` is the shape that makes a bare `startsWith("test")` check unsafe, so the pattern is
    // anchored on a `_`/`-` separator and this must fail closed too.
    var probe = runProbe('testing');

    probe.output.should.contain('db helper refused to initialize the database "testing"');
    probe.verdict.sentinelSurvived.should.be.true;
  });
});
