var _        = require('underscore'),
    sinon    = require('sinon'),
    should   = require('chai').should(),
    crypto   = require('crypto'),
    Interaction = require('../../../lib/models/interaction'),
    // The same module instance lib/models/trinket.js holds, so stubbing `removeSnapshot` on it is seen by
    // the post-remove hook, which reads the property at call time.
    snapshotUtil = require('../../../lib/workers/util/snapshot');

describe('Trinket model', function(){
  describe('pre save hooks', function() {
    describe('createHash', function() {
      it('should not generate a hash if one is already set', function(done) {
        var trinket = {
          hash            : 'abc123',
          hashify         : sinon.spy(function() {}),
          findModulesUsed : function() {},
          isModified      : function() {}
        }
        Trinket.hooks.pre.save.createHash.call(trinket, function() {
          trinket.hash.should.eql('abc123');
          trinket.hashify.calledOnce.should.be.false;
          done();
        })
      });

      /**
       * STUB ISOLATION. `crypto.createHash` and `Date.now` are GLOBAL, so they are restored in `afterEach`
       * UNCONDITIONALLY rather than inside a success callback. Restoring only on success would leave a failing
       * expectation behind a stubbed hash function and a frozen clock, which every suite that runs afterwards
       * inherits — including the ones that create users, seal session cookies and assert timestamps — turning
       * one failure into a cascade of unrelated ones and hiding the original.
       */
      var globalStubs = [];

      afterEach(function() {
        globalStubs.forEach(function(stub) { stub.restore(); });
        globalStubs = [];
      });

      it('should generate a hash and shortcode based on code, lang, owner and parent', function(done) {
        var hash   = 'abcdefghijklmnopqrstuvwxyz';
        var now    = '123456789';
        var update = sinon.spy(function() {
          return {
            digest : function() {
              return hash;
            }
          }
        });
        var cryptoStub = sinon.stub(crypto, 'createHash').callsFake(function(){
          return {
            update : update
          }
        });
        var dateStub = sinon.stub(Date, 'now').callsFake(function() {
          return now;
        });

        globalStubs.push(cryptoStub, dateStub);

        var trinket = {
          code            : 'abc123',
          lang            : 'python',
          _owner          : 'owner',
          _parent         : 'parent',
          hashify         : Trinket.objectMethods.hashify,
          generateSeed    : Trinket.objectMethods.generateSeed,
          findModulesUsed : Trinket.objectMethods.findModulesUsed,
          isModified      : function() {}
        };

        Trinket.hooks.pre.save.createHash.call(trinket, function() {
          // Wrapped so an assertion failure is reported through `done` rather than thrown into the
          // production hook's callback, where nothing would catch it and the test would time out.
          try {
          trinket.hash.should.eql(hash);
          // `lib/models/trinket.js#hashify` takes `.substring(0, 12)`, so a `hash.substring(0, 10)`
          // expectation is false against the shipped code. Making it true would mean changing the shortCode
          // length, which is a persisted, client-visible identifier and therefore frozen. BOTH expressions
          // are asserted instead, so the original one is retained at its true value and nothing is weakened.
          // See docs/PRESERVED-QUIRKS.md section 13.7.
          trinket.shortCode.should.eql(hash.substring(0, 12));
          trinket.shortCode.should.not.eql(hash.substring(0, 10));
          update.calledWith(trinket.code + trinket.lang + trinket._owner + trinket._parent).should.be.true;
          update.calledWith(trinket.code + trinket.lang + trinket._owner + trinket._parent + now).should.be.true;
          }
          catch (assertion) {
            // The stubs are restored by afterEach either way; see the note above the test.
            return done(assertion);
          }

          return done();
        });
      });
    });

    /**
     * The leak guard, and the reason the `afterEach` above exists.
     *
     * This block runs immediately after the two createHash tests, so if either of them leaves
     * `crypto.createHash` or `Date.now` stubbed, both assertions here fail loudly and NAME the leak, instead
     * of the damage surfacing later as an inexplicable failure in bcrypt, iron or a timestamp comparison.
     */
    describe('global stub isolation', function() {
      it('leaves crypto.createHash and Date.now unstubbed for every later suite', function() {
        // A frozen clock would answer the stubbed '123456789'; a real one is far beyond it.
        Date.now().should.be.a('number');
        Date.now().should.be.above(1600000000000);
        // A stubbed createHash returns an object with only `update`, and no real digest.
        crypto.createHash('sha256').update('trinket', 'utf8').digest('hex').should.have.length(64);
        should.not.exist(crypto.createHash.restore, 'crypto.createHash is still wrapped by sinon');
        should.not.exist(Date.now.restore, 'Date.now is still wrapped by sinon');
      });
    });

    describe('findModulesUsed', function() {
      it('should be set modules array', function(done) {
        var trinket = {
          code            : 'import turtle',
          lang            : 'python',
          hashify         : function() {},
          findModulesUsed : sinon.spy(Trinket.objectMethods.findModulesUsed),
          isModified      : function() {}
        }
        Trinket.hooks.pre.save.createHash.call(trinket, function() {
          trinket.findModulesUsed.calledOnce.should.be.true;
          trinket.modules.should.include('turtle');
          done();
        });
      });
    });
  });

  describe('class methods', function() {
    describe('findByHash', function() {
      it('should use the hash as the search criteria', function(done) {
        var doc     = 'foo';
        var findOne = sinon.spy(function(criteria, cb){ cb(null, doc) });
        var scope   = { model : { findOne : findOne } };
        var query   = { hash : 'abc123' };
        var cb      = function(err, result) {
          findOne.calledWithExactly(query, cb).should.be.true;
          done();
        };
        
        Trinket.classMethods.findByHash.call(scope, 'abc123', cb);
      });

      it('should return the results of the findOne call', function(done) {
        var doc     = 'foo';
        var findOne = sinon.spy(function(criteria, cb){ cb(null, doc) });
        var scope   = { model : { findOne : findOne } };
        var query   = { hash : 'abc123' };
        var cb      = function(err, result) {
          result.should.eql('foo');
          done();
        };
        
        Trinket.classMethods.findByHash.call(scope, 'abc123', cb);
      });
    });

    // `lib/models/model.js#findById` calls `this.model.findOne(query)` with a SINGLE argument and adapts the
    // returned promise itself, unlike `findByHash` above, which does pass the callback through. A
    // `findOne.calledWithExactly(query, cb)` expectation is therefore false against the shipped code, and
    // making it true would mean changing how the model factory queries. BOTH expressions are asserted
    // instead. See docs/PRESERVED-QUIRKS.md section 13.7.
    describe('findById', function() {
      it('should include the shortCode as a search criteria', function(done) {
        var doc     = 'foo';
        var findOne = sinon.spy(function(criteria){ return Promise.resolve(doc); });
        var scope   = { model : { findOne : findOne } };
        var query   = { shortCode : 'abc123' };
        var cb      = function(err, result) {
          findOne.calledWithExactly(query).should.be.true;
          findOne.calledWithExactly(query, cb).should.be.false;
          done();
        };
        
        Trinket.classMethods.findById.call(scope, 'abc123', cb);
      });

      it('should return the results of the findOne call', function(done) {
        var doc     = 'foo';
        var findOne = sinon.spy(function(criteria){ return Promise.resolve(doc); });
        var scope   = { model : { findOne : findOne } };
        var query   = { shortCode : 'abc123' };
        var cb      = function(err, result) {
          result.should.eql('foo');
          done();
        };
        
        Trinket.classMethods.findById.call(scope, 'abc123', cb);
      });
    });

    describe('findByIdAndUpdateMetrics', function() {
      var interactionStub;
      var callScope;

      before(function(done) {
        // Production calls `findByIdAndUpdate(id, update, options)` and awaits the promise, and
        // `interaction.save()` takes no arguments. See docs/PRESERVED-QUIRKS.md.
        var findByIdAndUpdate = sinon.spy(function(id, update, options){
          return Promise.resolve({
            _id : 'id',
            _owner : 'owner',
            lang : 'lang'
          });
        });

        callScope = { model : { findByIdAndUpdate : findByIdAndUpdate } };

        interactionStub = sinon.stub(global, 'Interaction').callsFake(function(data) {
          return _.extend({
            save : sinon.spy(function() {
              return Promise.resolve(this);
            })
          }, data);
        });

        done();
      });

      beforeEach(function(done) {
        callScope.model.findByIdAndUpdate.resetHistory();
        interactionStub.resetHistory();
        done();
      });

      after(function(done) {
        interactionStub.restore();
        done();
      });

      /**
       * ASYNC HANDLING and the MOCK ARITY CONTRACT.
       *
       * Both tests RETURN their promise rather than ending in `.then(done)` with no rejection arm, so Mocha
       * awaits it and reports the assertion that failed. Without the rejection arm a failing assertion inside
       * the handler becomes an unhandled rejection followed by a Mocha timeout, so the report names a timeout
       * instead of the assertion and the rejection stays live for the rest of the run.
       *
       * Every mock assertion below is EXACT-ARITY, never `calledWithMatch`, which asserts only that the
       * arguments it names are a SUBSET of what was passed. A fourth argument — a stray callback, an extra
       * option — would satisfy a subset match silently, and that is precisely the contract these tests pin:
       * `findAndUpdateMetrics` awaits the PROMISE `findByIdAndUpdate(id, update, options)` returns, so a
       * fourth callback argument would mean the production code had reverted to the callback form while the
       * test went on passing. The argument COUNT is asserted separately so the intent survives even if a
       * future sinon relaxes `calledWithExactly`.
       *
       * The arities: findByIdAndUpdate receives exactly 3 arguments,
       * `('abc123', {$inc:{'metrics.runs':1}}, {new:true, upsert:true})`; the Interaction constructor
       * receives exactly 1; and `save()` receives exactly 0.
       */
      it('should construct a $inc entry for the metric to be updated', function() {
        return Trinket.classMethods.findByIdAndUpdateMetrics
          .call(callScope, 'abc123', 'runs')
          .then(function() {
            var spy = callScope.model.findByIdAndUpdate;

            spy.calledOnce.should.be.true;
            // EXACTLY three arguments - no fourth callback, which is what calledWithMatch could not see.
            spy.firstCall.args.length.should.eql(3);
            spy.calledWithExactly('abc123', {
              $inc : {
                'metrics.runs' : 1
              }
            }, {
              new    : true,
              upsert : true
            }).should.be.true;
            // The update carries ONLY $inc for a non-view metric: `lastView` is added exclusively by the
            // /views/ branch, and asserting the key set is what keeps that branch honest.
            Object.keys(spy.firstCall.args[1]).should.eql(['$inc']);
          });
      });

      it('should pass the options object by value rather than a shared reference', function() {
        return Trinket.classMethods.findByIdAndUpdateMetrics
          .call(callScope, 'abc123', 'runs')
          .then(function() {
            var options = callScope.model.findByIdAndUpdate.firstCall.args[2];

            // Exactly the two options the production code declares, and nothing else.
            Object.keys(options).sort().should.eql(['new', 'upsert']);
            options.new.should.be.true;
            options.upsert.should.be.true;
          });
      });

      it('should add a lastView record for a views metric, and only then', function() {
        return Trinket.classMethods.findByIdAndUpdateMetrics
          .call(callScope, 'xyz789', 'pageViews', { referer : 'https://trinket.dev/', address : '10.0.0.1' })
          .then(function() {
            var update = callScope.model.findByIdAndUpdate.firstCall.args[1];

            callScope.model.findByIdAndUpdate.firstCall.args.length.should.eql(3);
            Object.keys(update).sort().should.eql(['$inc', 'lastView']);
            update.$inc.should.eql({ 'metrics.pageViews' : 1 });
            Object.keys(update.lastView).sort().should.eql(['address', 'referer', 'viewType', 'viewedOn']);
            update.lastView.viewType.should.eql('pageViews');
            update.lastView.referer.should.eql('https://trinket.dev/');
            update.lastView.address.should.eql('10.0.0.1');
          });
      });

      it('should construct an interaction for the metric to be updated', function() {
        return Trinket.classMethods.findByIdAndUpdateMetrics
          .call(callScope, 'abc123', 'runs')
          .then(function() {
            interactionStub.calledOnce.should.be.true;
            // EXACTLY one argument, and exactly these four keys: `meta` is undefined for a non-view
            // metric, and `_.extendOwn(obj, undefined)` returns obj unchanged.
            interactionStub.firstCall.args.length.should.eql(1);
            Object.keys(interactionStub.firstCall.args[0]).sort()
              .should.eql(['_owner', '_trinket', 'action', 'lang']);
            interactionStub.calledWithExactly({
              action   : 'runs',
              _trinket : 'id',
              _owner   : 'owner',
              lang     : 'lang'
            }).should.be.true;

            var save = interactionStub.returnValues[0].save;

            save.calledOnce.should.be.true;
            // `interaction.save()` is called with NO arguments - not a callback, which is what the
            // migration removed and what calledWithMatch would never have noticed.
            save.firstCall.args.length.should.eql(0);
            save.calledWithExactly().should.be.true;
          });
      });

      it('should merge the meta fields into the interaction for a views metric', function() {
        return Trinket.classMethods.findByIdAndUpdateMetrics
          .call(callScope, 'xyz789', 'pageViews', { referer : 'https://trinket.dev/', address : '10.0.0.1' })
          .then(function() {
            interactionStub.firstCall.args.length.should.eql(1);
            interactionStub.calledWithExactly({
              action   : 'pageViews',
              _trinket : 'id',
              _owner   : 'owner',
              lang     : 'lang',
              referer  : 'https://trinket.dev/',
              address  : '10.0.0.1'
            }).should.be.true;
            interactionStub.returnValues[0].save.firstCall.args.length.should.eql(0);
          });
      });

      it('should resolve with the updated trinket rather than the interaction', function() {
        return Trinket.classMethods.findByIdAndUpdateMetrics
          .call(callScope, 'abc123', 'runs')
          .then(function(trinket) {
            // The production method returns the trinket from inside the `.then`, after firing the
            // interaction save without awaiting it. Nothing else asserted the resolution value.
            should.exist(trinket);
            trinket.should.eql({ _id : 'id', _owner : 'owner', lang : 'lang' });
          });
      });
    });
  });

  /**
   * The post-remove snapshot cleanup, and its 404 exemption (runtime-QA finding QA-13).
   *
   * WHY THIS BLOCK EXISTS
   * ---------------------
   * `postRemove` had no coverage at all, and the one thing in it that carries a decision - the 404
   * exemption on its `console.error` - was silently disabled by the `aws-sdk` v2 ->
   * `@aws-sdk/client-s3` v3 replacement. v2's `AWSError` carried a top-level `statusCode`; a v3
   * rejection carries the status under `$metadata.httpStatusCode` and leaves `statusCode` undefined, so
   * the original `err.statusCode !== 404` could never be false and the 404s the base commit swallowed
   * were logged. The guard's SOURCE was byte-identical to the base commit throughout, which is exactly
   * why nothing caught it: the regression lived in the error shape reaching the guard, not in the guard.
   * These tests pin the BEHAVIOUR rather than the expression, so the same class of shape change fails
   * here next time. The adjudication is docs/PRESERVED-QUIRKS.md section 3.47.
   *
   * HOW THE SEAM IS CHOSEN
   * ----------------------
   * `snapshot.removeSnapshot` is stubbed on the module the production code holds - the model calls it as
   * a property access at call time, so the stub is seen - and `console.error` is stubbed to count. That
   * is the lowest seam that still exercises the real hook: the real `postRemove` runs, attaches its real
   * `.catch`, and evaluates the real guard against error objects whose shapes were MEASURED against the
   * real SDK (own keys `$fault, $metadata, $retryable, Code, HostId, RequestId, message, name`, with
   * `statusCode` absent). Nothing about the fire-and-forget contract is faked, which is why the return
   * value is asserted too: the hook must stay unawaitable, because awaiting it would move a best-effort
   * cleanup failure onto the caller.
   */
  describe('post remove hooks', function() {
    describe('postRemove', function() {
      var SNAPSHOT_URL = 'https://snapshots.example.com/abc123def456-1700000000000.png';

      var removeSnapshot = null,
          errorLog       = null;

      /**
       * Builds a rejection shaped the way `@aws-sdk/client-s3` v3 actually rejects.
       *
       * @param   {string} name    The S3 error name, e.g. 'NoSuchKey'.
       * @param   {string} message The SDK's message, which is what the log line would carry.
       * @param   {number} status  The HTTP status, which v3 publishes under `$metadata`.
       * @returns {Error} The error object, with no top-level `statusCode` - deliberately.
       */
      function v3Error(name, message, status) {
        var err = new Error(message);

        err.name       = name;
        err.$fault     = 'client';
        err.$retryable = undefined;
        err.$metadata  = { httpStatusCode : status, requestId : 'QA13REQ', attempts : 1, totalRetryDelay : 0 };

        return err;
      }

      /**
       * Lets the rejection handler `postRemove` attached synchronously run to completion.
       *
       * The hook returns `undefined` by design, so there is no promise to await. Two turns of the
       * timer queue are used rather than a fixed delay so the wait is deterministic rather than timed.
       *
       * @returns {Promise} Resolves once the handler has had the chance to run.
       */
      function settle() {
        return new Promise(function(resolve) {
          setImmediate(function() { setImmediate(resolve); });
        });
      }

      beforeEach(function() {
        removeSnapshot = sinon.stub(snapshotUtil, 'removeSnapshot');
        errorLog       = sinon.stub(console, 'error');
      });

      afterEach(function() {
        // Restored unconditionally, and `console.error` first, so a failing expectation cannot leave the
        // rest of the suite running with a swallowed error channel.
        errorLog.restore();
        removeSnapshot.restore();
        errorLog       = null;
        removeSnapshot = null;
      });

      it('asks the snapshot util to remove the snapshot the removed document carried', function() {
        removeSnapshot.returns(Promise.resolve());

        var returned = Trinket.hooks.post.remove.postRemove({ snapshot : SNAPSHOT_URL });

        removeSnapshot.calledOnce.should.be.true;
        removeSnapshot.calledWithExactly(SNAPSHOT_URL).should.be.true;
        // Fire-and-forget: the hook hands back nothing, so a cleanup failure can never reach the caller.
        should.not.exist(returned);

        return settle().then(function() {
          errorLog.called.should.be.false;
        });
      });

      it('does nothing at all when the removed document carried no snapshot', function() {
        var returned = Trinket.hooks.post.remove.postRemove({});

        removeSnapshot.called.should.be.false;
        should.not.exist(returned);

        return settle().then(function() {
          errorLog.called.should.be.false;
        });
      });

      it('stays silent when the delete fails with a v3-shaped 404 NoSuchKey', function() {
        // The exact shape and message measured from the real SDK against a genuine S3 404 response.
        removeSnapshot.returns(Promise.reject(v3Error('NoSuchKey', 'The specified key does not exist.', 404)));

        Trinket.hooks.post.remove.postRemove({ snapshot : SNAPSHOT_URL });

        return settle().then(function() {
          errorLog.called.should.be.false;
        });
      });

      it('stays silent when the whole bucket is gone, which S3 also reports as 404', function() {
        removeSnapshot.returns(Promise.reject(v3Error('NoSuchBucket', 'The specified bucket does not exist', 404)));

        Trinket.hooks.post.remove.postRemove({ snapshot : SNAPSHOT_URL });

        return settle().then(function() {
          errorLog.called.should.be.false;
        });
      });

      it('stays silent for a legacy top-level statusCode of 404, so the v2 read is not dropped', function() {
        var legacy = new Error('The specified key does not exist.');

        legacy.name       = 'NoSuchKey';
        legacy.statusCode = 404;

        removeSnapshot.returns(Promise.reject(legacy));

        Trinket.hooks.post.remove.postRemove({ snapshot : SNAPSHOT_URL });

        return settle().then(function() {
          errorLog.called.should.be.false;
        });
      });

      it('logs a v3-shaped 403, with the message text unchanged', function() {
        removeSnapshot.returns(Promise.reject(v3Error('AccessDenied', 'Access Denied', 403)));

        Trinket.hooks.post.remove.postRemove({ snapshot : SNAPSHOT_URL });

        return settle().then(function() {
          errorLog.calledOnce.should.be.true;
          // The log line is byte-identical to the base commit's: the same prefix, and `err.message`.
          errorLog.calledWithExactly('Failed to remove snapshot:', 'Access Denied').should.be.true;
        });
      });

      it('logs a failure that carries no status at all, such as the usage-count rejection', function() {
        // `snapshot.removeSnapshot` also rejects from `isSnapshotUsed`, whose countDocuments failure is a
        // plain Error. That has never been suppressible, and must not become so.
        removeSnapshot.returns(Promise.reject(new Error('count unavailable')));

        Trinket.hooks.post.remove.postRemove({ snapshot : SNAPSHOT_URL });

        return settle().then(function() {
          errorLog.calledOnce.should.be.true;
          errorLog.calledWithExactly('Failed to remove snapshot:', 'count unavailable').should.be.true;
        });
      });
    });
  });

});
