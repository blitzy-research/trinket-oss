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
          // CORRECTED from ten characters to the twelve both trees generate.
          //
          // `hashify` truncates the sha1 with `.substring(0, 12)` - at
          // lib/models/trinket.js:126 on this tree and at
          // lib/models/trinket.js:120 at 2f8712a, the same statement - so a
          // ten-character expectation has never described the code that
          // produces the value. The delivered tree had shortened generation to
          // ten to make this line pass, which is an unregistered behaviour
          // change R-d forbids; that shortening was withdrawn (recorded at
          // docs/preserved-quirks.md 11.21) and the expectation is corrected to
          // the length the application actually produces instead.
          //
          // MEASURED, this case's own fixture and the same two stubs
          // (crypto.createHash and Date.now) driven against EACH tree's own
          // `createHash` pre-save hook, each with its own node_modules:
          // target (this tree) produced shortCode 'abcdefghijkl', length 12,
          // equal to hash.substring(0, 12) and NOT to hash.substring(0, 10);
          // baseline (2f8712a) produced 'abcdefghijkl', length 12, the same two
          // outcomes. IDENTICAL. Still an exact equality against the same
          // `hash` fixture; only the truncation length moved. Its entry in the
          // assertion-correction record is in test/lib/api/index.js.
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

    describe('findById', function() {
      it('should include the shortCode as a search criteria', function(done) {
        var doc     = 'foo';
        var findOne = sinon.spy(function(criteria, cb){ cb(null, doc) });
        var scope   = { model : { findOne : findOne } };
        var query   = { shortCode : 'abc123' };
        var cb      = function(err, result) {
          findOne.calledWithExactly(query, cb).should.be.true;
          done();
        };
        
        Trinket.classMethods.findById.call(scope, 'abc123', cb);
      });

      it('should return the results of the findOne call', function(done) {
        var doc     = 'foo';
        var findOne = sinon.spy(function(criteria, cb){ cb(null, doc) });
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
        var findByIdAndUpdate = sinon.spy(function(id, update, options, cb){
          return cb(null, {
            _id : 'id',
            _owner : 'owner',
            lang : 'lang'
          });
        });

        callScope = { model : { findByIdAndUpdate : findByIdAndUpdate } };

        interactionStub = sinon.stub(global, 'Interaction').callsFake(function(data) {
          return _.extend({
            // Stub shape, not an assertion: the model has always called the
            // promise form `interaction.save()` with no argument, so a stub
            // body that only ever invoked `cb(this)` threw `cb is not a
            // function` on every call. The callback branch is kept for a caller
            // that passes one; a caller that does not gets the resolved promise
            // the real Mongoose document returns. The assertion below -
            // `save.calledOnce` - is unchanged.
            save : sinon.spy(function(cb) {
              return cb ? cb(this) : Promise.resolve(this);
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
          .done(done);
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
          .done(done);
      });
    });
  });
});
