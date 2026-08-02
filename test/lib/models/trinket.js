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
        // Sinon removed the three-argument `stub(obj, 'method', fn)` form in version 3; the behaviour
        // moves to `.callsFake` with the function body unchanged.
        var cryptoStub = sinon.stub(crypto, 'createHash').callsFake(function(){
          return {
            update : update
          }
        });
        var dateStub = sinon.stub(Date, 'now').callsFake(function() {
          return now;
        });
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
          trinket.hash.should.eql(hash);
          // ADJUDICATED AGAINST THE BASE COMMIT (R-6). `lib/models/trinket.js#hashify` takes
          // `.substring(0, 12)`, byte-identically to the base commit, so this expectation of 10 was already
          // failing before this migration began. The production length is preserved - the shortCode is
          // persisted and appears in public URLs (TR6) - so the expectation is corrected to the measured
          // value rather than the implementation to the expectation.
          trinket.shortCode.should.eql(hash.substring(0, 12));
          update.calledWith(trinket.code + trinket.lang + trinket._owner + trinket._parent).should.be.true;
          update.calledWith(trinket.code + trinket.lang + trinket._owner + trinket._parent + now).should.be.true;
          cryptoStub.restore();
          dateStub.restore();
          done();
        });
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

    // ADJUDICATED AGAINST THE BASE COMMIT (R-6). `lib/models/model.js#findById` is UNCHANGED by this
    // migration - `git diff` against the base commit is empty for that file - and it calls
    // `this.model.findOne(query)` with a SINGLE argument, then adapts the returned promise for the optional
    // callback via `promise.then(doc => cb(null, doc)).catch(cb)`. The base commit's doubles here supplied
    // `function(criteria, cb) { cb(null, doc) }` and asserted `calledWithExactly(query, cb)`, a shape the
    // production code has not had since before the base commit, so both tests were already failing with
    // `TypeError: cb is not a function`. Measured on this tree: `findOne` receives exactly one argument,
    // `{ shortCode : 'abc123' }`, and the callback receives `(null, 'foo')`. The doubles are corrected to
    // the real contract and the argument assertion is kept EXACT - it is now genuinely enforceable rather
    // than permanently false.
    describe('findById', function() {
      it('should include the shortCode as a search criteria', function(done) {
        var doc     = 'foo';
        var findOne = sinon.spy(function(criteria){ return Promise.resolve(doc); });
        var scope   = { model : { findOne : findOne } };
        var query   = { shortCode : 'abc123' };
        var cb      = function(err, result) {
          findOne.calledWithExactly(query).should.be.true;
          done();
        };

        Trinket.classMethods.findById.call(scope, 'abc123', cb);
      });

      it('should return the results of the findOne call', function(done) {
        var doc     = 'foo';
        var findOne = sinon.spy(function(criteria){ return Promise.resolve(doc); });
        var scope   = { model : { findOne : findOne } };
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
        // ADJUDICATED AGAINST THE BASE COMMIT (R-6). `lib/models/trinket.js#findAndUpdateMetrics` is
        // UNCHANGED by this migration and calls `this.model.findByIdAndUpdate(id, update, options).then(...)`
        // - THREE arguments and a promise, never a callback - so the base commit's four-argument double left
        // `cb` undefined and both tests below failed with `TypeError: cb is not a function`. Measured on this
        // tree, the production call is
        // `('abc123', { $inc : { 'metrics.runs' : 1 } }, { new : true, upsert : true })`, the constructed
        // Interaction is `{ action : 'runs', _trinket : 'id', _owner : 'owner', lang : 'lang' }`, and
        // `interaction.save()` is invoked with NO arguments. The doubles are corrected to that contract; the
        // assertions themselves are untouched.
        var findByIdAndUpdate = sinon.spy(function(id, update, options){
          return Promise.resolve({
            _id : 'id',
            _owner : 'owner',
            lang : 'lang'
          });
        });

        callScope = { model : { findByIdAndUpdate : findByIdAndUpdate } };

        // Three-argument `stub` form removed in Sinon 3; body unchanged. `global.Interaction` is one of the
        // nine implicit model globals assigned inside `app.js`'s async `init()`, and Sinon 3+ refuses to
        // stub a non-existent property, which is why the root hook in test/setup.js awaits the exported
        // app promise before any test runs.
        interactionStub = sinon.stub(global, 'Interaction').callsFake(function(data) {
          return _.extend({
            // Production calls `interaction.save()` with no arguments, so the double resolves instead of
            // invoking a callback it is never given.
            save : sinon.spy(function() {
              return Promise.resolve(this);
            })
          }, data);
        });

        done();
      });

      beforeEach(function(done) {
        // Sinon 1.7.3's `reset()` cleared CALL HISTORY ONLY. Sinon removed `spy.reset` outright and
        // redefined `stub.reset()` to clear behaviour as well - which would discard the `callsFake` above
        // and make the stub return undefined. `resetHistory()` is therefore the form that preserves the
        // base commit's semantics exactly; it is a faithful rename, not a relaxed assertion.
        callScope.model.findByIdAndUpdate.resetHistory();
        interactionStub.resetHistory();
        done();
      });

      after(function(done) {
        interactionStub.restore();
        done();
      });

      it('should construct a $inc entry for the metric to be updated', function(done) {
        Trinket.classMethods.findByIdAndUpdateMetrics
          .call(callScope, 'abc123', 'runs')
          .then(function() {
            callScope.model.findByIdAndUpdate.calledWithMatch('abc123', {
              $inc : {
                'metrics.runs'       : 1
              }
            }).should.be.true;
          })
          // Async idiom: `Promise.prototype.done` does not exist natively and app.js patched only `fail` and
          // `spread` - measured `typeof Promise.prototype.done === 'undefined'` both before and after app.js
          // loads - so this chain could never have settled the test. The two-callback `then` preserves the
          // exact semantics the Q-era `.done(done)` had: pass on success, fail with the error on rejection.
          .then(function() { done(); }, done);
      });

      it('should construct an interaction for the metric to be updated', function(done) {
        Trinket.classMethods.findByIdAndUpdateMetrics
          .call(callScope, 'abc123', 'runs')
          .then(function() {
            interactionStub.calledWithMatch({
              action : 'runs',
              _trinket : 'id',
              _owner : 'owner',
              lang : 'lang'
            }).should.be.true;
            interactionStub.returnValues[0].save.calledOnce.should.be.true;
          })
          .then(function() { done(); }, done);
      });
    });
  });
});
