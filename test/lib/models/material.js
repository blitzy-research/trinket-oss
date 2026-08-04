/**
 * Material model coverage for review finding M-22.
 *
 * `copy` reproduces the base commit's client-visible fate when either upstream chain rejects: the
 * request is answered with NOTHING. What it does not reproduce is the ownership defect that came with
 * that fate. At the base commit the callback was simply never invoked, the retired shim's deferred was
 * never settled, and an earlier revision of this change carried that forward literally as a promise left
 * PERMANENTLY PENDING - which under Node 22's default rejection mode is process-fatal and which retains
 * the awaiting HTTP request for the life of the connection.
 *
 * The delivered form OWNS the rejection instead: `copy` rejects with the `silentOutcome` sentinel from
 * lib/models/model.js, marked `silentCopyFailure` and carrying the upstream error as its `cause`. The
 * sentinel travels up through lib/models/lesson.js#copy and lib/models/course.js#copy to the two
 * controllers, which answer it with `h.abandon` - still no response, still no status code, so nothing a
 * client can observe has changed. See docs/PRESERVED-QUIRKS.md sections 1.15, 3.39 and 3.40.
 *
 * The two tests below therefore assert BOTH halves: the sentinel rejection, and that NOTHING escapes as
 * an unhandled rejection. They detach Mocha's unhandled-rejection listeners while measuring that second
 * half - so that a regression to the escaping form is reported as an assertion failure rather than as a
 * process-level abort - and restore them unconditionally.
 *
 * A save failure is different, and is unchanged: the returned promise rejects with the original mongoose
 * ValidationError, unwrapped and unmarked.
 */

var mongoose = require('mongoose'),
    sinon    = require('sinon'),
    should   = require('chai').should(),
    Material = require('../../../lib/models/material');

describe('Material model', function() {
  var stubs = [];
  var createdIds = [];

  function remember(document) {
    createdIds.push(document._id);
    return document;
  }

  function delay(ms) {
    return new Promise(function(resolve) {
      setTimeout(resolve, ms);
    });
  }

  function withEscapedRejections(body) {
    var escaped   = [],
        listeners = process.listeners('unhandledRejection'),
        collect   = function(err) {
          escaped.push(err);
        };

    process.removeAllListeners('unhandledRejection');
    process.on('unhandledRejection', collect);

    return Promise.resolve()
      .then(function() {
        return body(escaped);
      })
      .then(function(result) {
        return delay(50).then(function() {
          return { escaped : escaped, result : result };
        });
      })
      .finally(function() {
        process.removeListener('unhandledRejection', collect);
        listeners.forEach(function(listener) {
          process.on('unhandledRejection', listener);
        });
      });
  }

  afterEach(function() {
    stubs.forEach(function(stub) {
      stub.restore();
    });
    stubs = [];

    var ids = createdIds;
    createdIds = [];

    if (!ids.length) return;
    return Material.model.deleteMany({ _id : { $in : ids } });
  });

  describe('the content setter', function() {
    it('prunes omitted, null and empty content while retaining a non-empty string', function() {
      var omitted = new Material({ name : 'omitted' });
      var nullish = new Material({ name : 'nullish', content : null });
      var empty = new Material({ name : 'empty', content : '' });
      var retained = new Material({ name : 'retained', content : 'body' });

      should.not.exist(omitted.content);
      should.not.exist(nullish.content);
      should.not.exist(empty.content);
      retained.content.should.equal('body');
      empty.toObject().should.not.have.property('content');
    });
  });

  describe('setDates', function() {
    it('sets every enabled flag and writes a date only for an enabled field with a supplied value',
      function() {
        var existing = new Date('2020-01-01T00:00:00.000Z');
        var due = new Date('2031-02-03T04:05:06.000Z');
        var material = new Material({
          name    : 'dated',
          type    : 'assignment',
          trinket : {
            availableOn : {
              enabled   : true,
              dateValue : existing
            }
          }
        });

        material.setDates({
          submissionsDueEnabled    : true,
          submissionsDue           : due,
          submissionsCutoffEnabled : false,
          submissionsCutoff        : due,
          availableOnEnabled       : false,
          availableOn              : due,
          hideAfterEnabled         : true
        });

        material.trinket.submissionsDue.enabled.should.be.true;
        material.trinket.submissionsDue.dateValue.should.deep.equal(due);
        material.trinket.submissionsCutoff.enabled.should.be.false;
        should.not.exist(material.trinket.submissionsCutoff.dateValue);
        material.trinket.availableOn.enabled.should.be.false;
        material.trinket.availableOn.dateValue.should.deep.equal(existing);
        material.trinket.hideAfter.enabled.should.be.true;
        should.not.exist(material.trinket.hideAfter.dateValue);
      });
  });

  describe('isVisible', function() {
    it('always shows a non-assignment material', function() {
      new Material({ name : 'page', type : 'page' }).isVisible().should.be.true;
    });

    it('hides an assignment before its available-on date', function() {
      var material = new Material({
        name    : 'future',
        type    : 'assignment',
        trinket : {
          availableOn : {
            enabled   : true,
            dateValue : new Date(Date.now() + 60000)
          }
        }
      });

      material.isVisible().should.be.false;
    });

    it('hides an assignment after its hide-after date', function() {
      var material = new Material({
        name    : 'past',
        type    : 'assignment',
        trinket : {
          hideAfter : {
            enabled   : true,
            dateValue : new Date(Date.now() - 60000)
          }
        }
      });

      material.isVisible().should.be.false;
    });

    it('shows an assignment inside its enabled date window', function() {
      var material = new Material({
        name    : 'window',
        type    : 'assignment',
        trinket : {
          availableOn : {
            enabled   : true,
            dateValue : new Date(Date.now() - 60000)
          },
          hideAfter : {
            enabled   : true,
            dateValue : new Date(Date.now() + 60000)
          }
        }
      });

      material.isVisible().should.be.true;
    });
  });

  describe('copy', function() {
    it('parses page content, saves the copy and assigns the new owner', async function() {
      var owner = new mongoose.Types.ObjectId();
      var parser = {
        parse : sinon.stub().resolves('parsed body')
      };
      var source = new Material({
        name    : 'page source',
        content : 'raw body',
        type    : 'page'
      });

      var copy = remember(await source.copy(owner, parser));

      parser.parse.calledOnce.should.be.true;
      parser.parse.firstCall.args.should.deep.equal(['raw body', owner]);
      copy.name.should.equal('page source');
      copy.content.should.equal('parsed body');
      copy.type.should.equal('page');
      String(copy._owner).should.equal(String(owner));
      should.exist(copy._id);
    });

    it('copies and saves the assignment trinket and mutates the source subdocument in place',
      async function() {
        var owner = new mongoose.Types.ObjectId();
        var originalId = new mongoose.Types.ObjectId();
        var copiedId = new mongoose.Types.ObjectId();
        var copiedTrinket = {
          _id       : copiedId,
          name      : 'copied trinket',
          shortCode : 'copy123',
          lang      : 'python'
        };
        var trinketCopy = {
          save : sinon.stub().resolves(copiedTrinket)
        };
        var sourceTrinket = {
          copy : sinon.stub().returns(trinketCopy)
        };
        var findById = sinon.stub(Trinket, 'findById').resolves(sourceTrinket);
        stubs.push(findById);
        var source = new Material({
          name    : 'assignment source',
          type    : 'assignment',
          trinket : {
            trinketId : originalId,
            name      : 'original trinket',
            shortCode : 'original',
            lang      : 'html'
          }
        });

        var copy = remember(await source.copy(owner, { parse : sinon.spy() }));

        findById.calledOnce.should.be.true;
        findById.firstCall.args.should.deep.equal([originalId]);
        sourceTrinket.copy.calledOnce.should.be.true;
        sourceTrinket.copy.firstCall.args.should.deep.equal([owner]);
        trinketCopy.save.calledOnce.should.be.true;

        String(copy.trinket.trinketId).should.equal(String(copiedId));
        copy.trinket.name.should.equal('copied trinket');
        copy.trinket.shortCode.should.equal('copy123');
        copy.trinket.lang.should.equal('python');

        String(source.trinket.trinketId).should.equal(String(copiedId));
        source.trinket.name.should.equal('copied trinket');
        source.trinket.shortCode.should.equal('copy123');
        source.trinket.lang.should.equal('python');
      });

    it('rejects with the original mongoose ValidationError when the final save fails', async function() {
      var source = new Material({
        type    : 'page',
        content : 'raw body'
      });
      var rejected;

      try {
        await source.copy(new mongoose.Types.ObjectId(), {
          parse : function() {
            return Promise.resolve('parsed body');
          }
        });
      }
      catch (err) {
        rejected = err;
      }

      rejected.name.should.equal('ValidationError');
      rejected.message.should.equal('Material validation failed: name: Path `name` is required.');
      Object.keys(rejected.errors).should.deep.equal(['name']);
    });

    it('rejects with the owned silent sentinel when page parsing rejects, escaping nothing', function() {
      var expected = new Error('parser failed before save');
      var fate;
      var rejection;

      return withEscapedRejections(function() {
        var result = new Material({
          name    : 'pending page',
          type    : 'page',
          content : 'raw body'
        }).copy(new mongoose.Types.ObjectId(), {
          parse : function() {
            return Promise.reject(expected);
          }
        });

        return Promise.race([
          result.then(function() { return 'resolved'; }, function(err) {
            rejection = err;

            return 'rejected';
          }),
          delay(30).then(function() { return 'pending'; })
        ]).then(function(measured) {
          fate = measured;
        });
      }).then(function(observed) {
        // Owned, not pending: the sentinel identifies the "answered nothing" outcome and carries the
        // upstream error, so lib/controllers/course.js can answer it with h.abandon.
        fate.should.equal('rejected');
        rejection.silentCopyFailure.should.equal(true);
        rejection.message.should.equal('copy chain failed without answering');
        should.equal(rejection.cause, expected);
        // The sentinel deliberately carries no `code`, so nothing maps it onto an HTTP status.
        should.equal(rejection.code, undefined);
        // And nothing reaches the process: the permanently-pending form is what made this fatal.
        observed.escaped.should.deep.equal([]);
      });
    });

    it('rejects with the owned silent sentinel when the assignment lookup rejects, escaping nothing',
      function() {
        var expected = new Error('trinket lookup failed before save');
        var fate;
        var rejection;
        var findById = sinon.stub(Trinket, 'findById').rejects(expected);
        stubs.push(findById);

        return withEscapedRejections(function() {
          var result = new Material({
            name    : 'pending assignment',
            type    : 'assignment',
            trinket : {
              trinketId : new mongoose.Types.ObjectId()
            }
          }).copy(new mongoose.Types.ObjectId(), { parse : sinon.spy() });

          return Promise.race([
            result.then(function() { return 'resolved'; }, function(err) {
              rejection = err;

              return 'rejected';
            }),
            delay(30).then(function() { return 'pending'; })
          ]).then(function(measured) {
            fate = measured;
          });
        }).then(function(observed) {
          fate.should.equal('rejected');
          rejection.silentCopyFailure.should.equal(true);
          should.equal(rejection.cause, expected);
          should.equal(rejection.code, undefined);
          observed.escaped.should.deep.equal([]);
        });
      });

    it('collapses a sentinel it is handed rather than wrapping it twice', function() {
      // lesson.js#copy and course.js#copy re-enter silentOutcome as the sentinel travels up, so the
      // marker has to be idempotent or the controllers would have to unwrap an arbitrary depth.
      var model = require('../../../lib/models/model');
      var inner = new Error('the real failure');
      var once  = model.silentOutcome(inner);
      var twice = model.silentOutcome(once);

      twice.should.equal(once);
      should.equal(twice.cause, inner);
    });
  });
});