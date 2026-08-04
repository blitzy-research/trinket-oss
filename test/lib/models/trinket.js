var _        = require('underscore'),
    sinon    = require('sinon'),
    should   = require('chai').should(),
    crypto   = require('crypto'),
    Interaction = require('../../../lib/models/interaction');

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
       * STUB ISOLATION (review finding M-16).
       *
       * `crypto.createHash` and `Date.now` are GLOBAL. An earlier revision restored both inside the
       * success callback, so any failing expectation left the process with a stubbed hash function and a
       * frozen clock - which every suite that runs afterwards inherits, including the ones that create
       * users (bcrypt), seal session cookies (iron) and assert timestamps. A leak like that turns one
       * failure into a cascade of unrelated ones and hides the original.
       *
       * They are restored in afterEach instead, unconditionally, so the failure mode is one failing test.
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
          // R-6 ADJUDICATION, review finding M4. `lib/models/trinket.js` is BYTE-IDENTICAL to the base
          // commit (`git diff 2f8712a -- lib/models/trinket.js` is empty) and its `hashify` has always
          // taken `.substring(0, 12)` at L120, so the base commit's `hash.substring(0, 10)` expectation
          // was ALREADY FALSE before this migration - the suite simply never ran, because
          // test/helpers/catbox-redis.js required the unscoped, uninstalled `catbox-redis` and `npm test`
          // exited non-zero on its first module load. Restoring `should.eql(hash.substring(0, 10))` would
          // require changing the shortCode length, which is a persisted, client-visible identifier that
          // R-4 and TR6 both freeze. Both expressions are asserted instead, so the base commit's own
          // expression is retained at its measured value and nothing is weakened. See
          // docs/PRESERVED-QUIRKS.md section 13.7.
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
     * The leak guard for review finding M-16, and the reason the afterEach above exists.
     *
     * This block runs immediately after the two createHash tests, so if either of them leaves
     * `crypto.createHash` or `Date.now` stubbed - which is what happened when the restores lived inside
     * the success callback - both assertions here fail loudly and name the leak, instead of the damage
     * surfacing later as an inexplicable failure in bcrypt, iron or a timestamp comparison.
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

    // R-6 ADJUDICATION, review finding M4. `lib/models/model.js` is BYTE-IDENTICAL to the base commit
    // (`git diff 2f8712a -- lib/models/model.js` is empty). Its `findById` calls
    // `this.model.findOne(query)` with a SINGLE argument at L136-L141 and adapts the returned promise at
    // L145-L149 - the "Support both callback and promise patterns" block, which is base-commit code, not
    // migration work - unlike `findByHash` above, which does pass the callback through. The base commit's
    // `findOne.calledWithExactly(query, cb)` expectation was therefore ALREADY FALSE; making it true would
    // mean changing how the model factory queries, which R-4 forbids. Both expressions are asserted
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
        // R-6: production calls `findByIdAndUpdate(id, update, options)` and awaits the promise, and
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
       * ASYNC HANDLING (review finding M-16) and MOCK CONTRACT (review finding M-23).
       *
       * Both tests below used to end in `.then(done)` with no rejection arm, which is a defect of the TEST
       * harness rather than a behaviour of the application: a failing assertion inside the handler produced
       * an unhandled rejection and then Mocha's 2000 ms timeout, so the report named a timeout instead of
       * the assertion that failed, and the rejection stayed live for the rest of the run. An earlier
       * revision argued this preserved Q's `.done(onFulfilled)` semantics; it does not preserve anything
       * observable about the application, and "the test still fails, just as a timeout" is not a standard
       * worth keeping. The promise is RETURNED now, so Mocha awaits it and reports the assertion.
       *
       * And both used `calledWithMatch`, which asserts only that the arguments it names are a SUBSET of
       * what was passed. A fourth argument - a stray callback, an extra option - satisfied it silently,
       * which is exactly the contract these tests exist to pin: `findAndUpdateMetrics` awaits the PROMISE
       * that `findByIdAndUpdate(id, update, options)` returns, so a fourth callback argument would mean the
       * production code had reverted to the callback form while the test went on passing. Every assertion
       * below is exact-arity, and the argument COUNT is asserted separately so the intent survives even if
       * a future sinon relaxes `calledWithExactly`.
       *
       * Measured against the real class method: findByIdAndUpdate receives exactly 3 arguments,
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
});
