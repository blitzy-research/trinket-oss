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
          // 12, not 10. lib/models/trinket.js:120 derives the shortCode with
          // `.substring(0, 12)`, and that line is byte-identical to base commit
          // 2f8712a - this migration does not touch lib/models/trinket.js at
          // all. The expectation of 10 was stale against production before this
          // work started (lib/models/trinket.js:177 still uses 10, for the
          // unrelated verifyShortCode comparison, which is most likely where the
          // number came from). Corrected to the measured value rather than
          // changing the model, because altering the shortCode length would
          // change every future trinket's public URL.
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

    // `findById` is NOT one of Trinket's own class methods. lib/models/model.js
    // synthesizes it (:115-149) for any model that declares `alternateIds`, and
    // Trinket declares `['shortCode']` (lib/models/trinket.js:586). That
    // synthesized implementation is query-first, not callback-first:
    //
    //     promise = this.model.findOne(query);          // ONE argument
    //     if (cb) { promise.then(d => cb(null, d)).catch(cb); }
    //     return promise;
    //
    // (the two-argument `findOne(query, defaultFields)` form is taken only when
    // the model declares `fields`, and Trinket declares none). So the driver a
    // test must supply is a QUERY-RETURNING stub, not a callback-invoking one:
    // a `function(criteria, cb)` spy receives `cb === undefined` and dies with
    // `TypeError: cb is not a function` before the assertion is reached.
    //
    // lib/models/model.js is byte-identical to base commit 2f8712a, so this is a
    // pre-existing mismatch between the spec and the model layer, not a
    // consequence of the migration. Both stubs below are corrected to the
    // Promise-compatible shape production actually consumes. Note that the
    // sibling `findByHash` cases above are deliberately left alone: that method
    // is Trinket's own (lib/models/trinket.js:218) and really does pass the
    // callback straight through to `findOne`, so a callback-style spy is the
    // right driver there.
    describe('findById', function() {
      it('should include the shortCode as a search criteria', function(done) {
        var doc     = 'foo';
        var findOne = sinon.spy(function(criteria){ return Promise.resolve(doc); });
        var scope   = { model : { findOne : findOne } };
        var query   = { shortCode : 'abc123' };
        var cb      = function(err, result) {
          // Still exact, and still asserting the same thing the title states:
          // findOne saw the shortCode criteria and nothing else. The callback is
          // no longer part of the expected argument list because production does
          // not forward it - it adapts the returned query instead.
          findOne.calledWithExactly(query).should.be.true;
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
        // Promise-compatible drivers, matching what lib/models/trinket.js:204-215
        // actually calls:
        //
        //     return this.model.findByIdAndUpdate(id, update, options)   // 3 args
        //       .then(function(trinket) { ... interaction.save(); return trinket; });
        //
        // Neither call passes a callback, so the previous `(id, update, options, cb)`
        // and `(cb)` spies received `cb === undefined` and threw
        // `TypeError: cb is not a function` synchronously, before either
        // assertion below could run. findAndUpdateMetrics is byte-identical to
        // base commit 2f8712a, so the spec's drivers were stale, not the model.
        var findByIdAndUpdate = sinon.spy(function(id, update, options){
          return Promise.resolve({
            _id : 'id',
            _owner : 'owner',
            lang : 'lang'
          });
        });

        callScope = { model : { findByIdAndUpdate : findByIdAndUpdate } };

        // `Interaction` is resolved from the global scope by
        // lib/models/trinket.js:206 (`new Interaction(...)` with no require in
        // that file), which is why the global is the correct stub target;
        // test/lib/00-ready.js:90 is what binds it.
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
          // `.done()` is a Q/Bluebird method and does not exist on the native
          // promise findAndUpdateMetrics returns, so the previous terminator
          // would itself have thrown once the stubs above stopped throwing
          // first. `.then(pass, fail)` is the equivalent that also surfaces an
          // assertion failure as a test failure instead of swallowing it into an
          // unhandled rejection.
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
