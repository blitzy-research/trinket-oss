/**
 * Snapshot removal: lib/workers/util/snapshot.js.
 *
 * The module is small but it sits on a DESTRUCTIVE path — it deletes objects out of the snapshots bucket
 * when a trinket is removed — so three obligations are pinned below: the delete settles exactly once, a
 * failure REJECTS rather than disappearing, and the function still works when called with no receiver.
 * `fileUtil.removeFile` is promise-native, so nothing bridges a callback here and there is no way for an
 * unfired callback to hang snapshot removal or for an unbound `this` to throw.
 *
 * WHAT IS STUBBED
 *   - `config/aws.js#getS3Client` — a recorder, so the real `DeleteObjectCommand` is constructed by
 *     production code and its bucket and key are assertable. NOTHING is deleted from a real bucket.
 *   - `internals.isSnapshotUsed` — only where a branch has to be forced. That indirection is the module's
 *     own test hatch, exported under `config.isTest`, and the reason `removeFile` reads
 *     `internals.isSnapshotUsed` rather than calling the function directly.
 *   - `Trinket.model.countDocuments` — only in the tests that cover `isSnapshotUsed` itself.
 */

var chai     = require('chai'),
    should   = chai.should(),
    sinon    = require('sinon'),
    fs       = require('fs'),
    path     = require('path'),
    config   = require('config'),
    aws      = require('../../../config/aws'),
    FileUtil = require('../../../lib/util/file'),
    Trinket  = require('../../../lib/models/trinket'),
    snapshot = require('../../../lib/workers/util/snapshot');

describe('Snapshot removal', function() {
  var sent  = [],
      react = null,
      stubs = [];

  /** A recording S3 client. `react` decides what a send resolves or rejects with. */
  function recorder() {
    return {
      send : function(command) {
        var reaction = react && react(command);

        sent.push(command);

        return reaction || Promise.resolve({ DeleteMarker : true });
      }
    };
  }

  /** Registers a stub for unconditional restoration in afterEach. */
  function stub(object, method) {
    var created = sinon.stub(object, method);

    stubs.push(created);

    return created;
  }

  beforeEach(function() {
    sent  = [];
    react = null;
    stubs = [];

    stub(aws, 'getS3Client').callsFake(recorder);
  });

  afterEach(function() {
    // Unconditional: `Trinket.model.countDocuments` and the module's own test hatch are shared with the
    // rest of the run, so a failed expectation must not leave either one replaced.
    stubs.forEach(function(created) {
      created.restore();
    });

    stubs = [];
  });

  describe('the module surface', function() {
    it('exports removeSnapshot, and the internals hatch only because this is the test environment',
      function() {
        config.isTest.should.eql(true);
        Object.keys(snapshot).sort().should.eql(['internals', 'removeSnapshot']);
        snapshot.removeSnapshot.should.be.a('function');
        Object.keys(snapshot.internals).sort().should.eql(['isSnapshotUsed', 'removeFile']);
      });

    it('returns a thenable, which is what lets the trinket model attach a catch to it', function() {
      stub(snapshot.internals, 'isSnapshotUsed').returns(Promise.resolve(true));

      var result = snapshot.removeSnapshot('held.png');

      result.then.should.be.a('function');
      result.catch.should.be.a('function');

      return result;
    });
  });

  describe('isSnapshotUsed', function() {
    it('reports true while any trinket still references the snapshot', function() {
      stub(Trinket.model, 'countDocuments').returns(Promise.resolve(3));

      return snapshot.internals.isSnapshotUsed('shared.png').then(function(used) {
        used.should.eql(true);
        Trinket.model.countDocuments.calledOnce.should.eql(true);
        // Exactly one argument, exactly this filter - a stray second argument would be a different query.
        Trinket.model.countDocuments.firstCall.args.should.eql([{ snapshot : 'shared.png' }]);
      });
    });

    it('reports false, as a boolean rather than a count, when nothing references it', function() {
      stub(Trinket.model, 'countDocuments').returns(Promise.resolve(0));

      return snapshot.internals.isSnapshotUsed('orphan.png').then(function(used) {
        used.should.eql(false);
        used.should.be.a('boolean');
      });
    });

    it('queries the trinket collection under its registered model name', function() {
      // The module resolves the model lazily by name - `mongoose.model('Snippet')` - rather than requiring
      // the model module, which would be a circular require through lib/models/trinket.js.
      Trinket.model.modelName.should.eql('Snippet');
      stub(Trinket.model, 'countDocuments').returns(Promise.resolve(1));

      return snapshot.internals.isSnapshotUsed('x.png').then(function() {
        Trinket.model.countDocuments.calledOnce.should.eql(true);
      });
    });
  });

  describe('removeSnapshot', function() {
    it('deletes the object from the snapshots bucket when nothing references it', function() {
      stub(snapshot.internals, 'isSnapshotUsed').returns(Promise.resolve(false));

      return snapshot.removeSnapshot('a/b/snap.png').then(function() {
        sent.length.should.eql(1);
        sent[0].constructor.name.should.eql('DeleteObjectCommand');
        sent[0].input.should.eql({
          Bucket : config.aws.buckets.snapshots.name,
          // The LAST path segment only - removeFile strips everything before the final slash.
          Key    : 'snap.png'
        });
      });
    });

    it('leaves the object alone while another trinket still references it', function() {
      stub(snapshot.internals, 'isSnapshotUsed').returns(Promise.resolve(true));

      return snapshot.removeSnapshot('a/b/held.png').then(function(result) {
        sent.length.should.eql(0);
        should.not.exist(result);
      });
    });

    it('asks about the snapshot it was given, through the snapshots container', function() {
      var removeFile = stub(snapshot.internals, 'removeFile').returns(Promise.resolve());

      return snapshot.removeSnapshot('a/b/asked.png').then(function() {
        removeFile.calledOnce.should.eql(true);
        removeFile.firstCall.args.should.eql(['snapshots', 'a/b/asked.png']);
      });
    });

    it('does nothing at all for an absent snapshot, without consulting the collection', function() {
      var used = stub(snapshot.internals, 'isSnapshotUsed').returns(Promise.resolve(false));

      return snapshot.removeSnapshot(null).then(function(result) {
        should.not.exist(result);
        used.called.should.eql(false);
        sent.length.should.eql(0);

        return snapshot.removeSnapshot('');
      }).then(function() {
        used.called.should.eql(false);
        sent.length.should.eql(0);
      });
    });

    it('rejects, rather than resolving quietly, when the delete fails', function() {
      stub(snapshot.internals, 'isSnapshotUsed').returns(Promise.resolve(false));
      react = function(command) {
        return command.constructor.name === 'DeleteObjectCommand'
          ? Promise.reject(new Error('S3 delete refused'))
          : null;
      };

      return snapshot.removeSnapshot('doomed.png').then(function() {
        throw new Error('expected the rejection to reach the caller');
      }, function(err) {
        err.message.should.eql('S3 delete refused');
        // The delete WAS attempted, and the rejection is the one the S3 send() promise produced.
        sent.length.should.eql(1);
      });
    });

    it('propagates a failure from the usage check without attempting a delete', function() {
      stub(snapshot.internals, 'isSnapshotUsed').returns(Promise.reject(new Error('count unavailable')));

      return snapshot.removeSnapshot('unknown.png').then(function() {
        throw new Error('expected the usage-check failure to reach the caller');
      }, function(err) {
        err.message.should.eql('count unavailable');
        sent.length.should.eql(0);
      });
    });
  });

  describe('the promise contract this module depends on', function() {
    // `fileUtil.removeFile` is promise-native and nothing wraps it, so the obligations asserted here are
    // stated against that promise directly: the delete settles exactly ONCE, and a failure rejects rather
    // than disappearing.

    it('does not promisify the file utility any more, because it has nothing to bridge', function() {
      var source = fs.readFileSync(
        path.join(__dirname, '..', '..', '..', 'lib', 'workers', 'util', 'snapshot.js'), 'utf8');

      // No promisify CALL exists in the module. The identifier appears only in the comment that records why
      // no wrapper is needed, which is documentation rather than a bridge.
      source.should.not.match(/(?:util\.)?promisify\(/);
      // Returned, not fired and forgotten: that is what keeps a delete failure inside the chain.
      source.should.contain('return fileUtil.removeFile(container, file);');
    });

    it('settles the delete exactly once, resolving the S3 response', function() {
      return FileUtil.removeFile('snapshots', 'promisified.png').then(function(data) {
        should.exist(data);
        sent.length.should.eql(1);
        sent[0].input.Key.should.eql('promisified.png');
      });
    });

    it('works when called unbound, because the module holds no receiver either', function() {
      var detached = FileUtil.removeFile;

      return detached('snapshots', 'unbound.png').then(function() {
        sent.length.should.eql(1);
        sent[0].constructor.name.should.eql('DeleteObjectCommand');
      });
    });

    it('rejects exactly once when the underlying delete fails', function() {
      var settlements = 0;

      react = function() {
        return Promise.reject(new Error('one failure only'));
      };

      return FileUtil.removeFile('snapshots', 'once.png').then(function() {
        throw new Error('expected a rejection');
      }, function(err) {
        settlements++;
        err.message.should.eql('one failure only');
      }).then(function() {
        // A second settlement would be swallowed by the promise, so the count is asserted against the
        // single send that produced it.
        settlements.should.eql(1);
        sent.length.should.eql(1);
      });
    });
  });
});
