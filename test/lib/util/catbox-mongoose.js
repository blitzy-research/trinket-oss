/**
 * The REAL Mongo-backed catbox engine: lib/util/catbox-mongoose.js (review finding M-21).
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * test/helpers/catbox-redis.js replaces `isReady`, `get`, `set` and `drop` on
 * `CatboxMongoose.Engine.prototype` with an in-memory fake, for the reason that helper documents: the
 * suite never calls `server.start()`, so the engine is never started and `@hapi/yar` treats a not-ready
 * cache as fatal. That stub is installed at require time and is therefore in force for EVERY test in the
 * run, which means a test that merely constructs `new CatboxMongoose.Engine()` and calls `set`/`get`
 * exercises the FAKE. Mongo persistence, model initialization, lazy expiry and expired-document deletion
 * were consequently never executed by anything - the false green this file closes.
 *
 * HOW THE FAKE IS ESCAPED
 * -----------------------
 * Sinon keeps the replaced function on the stub as `wrappedMethod`. Every engine below is built by
 * `realEngine()`, which copies those four originals onto the INSTANCE as own properties. Property lookup
 * finds the own property before the stubbed prototype method, so the real code runs - and, critically, so
 * do its internal `this.isReady()` calls, which is what makes the not-ready guard reachable. (Calling
 * `prototype.get.wrappedMethod.call(engine, ...)` alone is NOT sufficient: the real `get` asks
 * `this.isReady()`, which would still resolve to the stub returning `true`, and the guard would never
 * fire. That was measured.) This is deliberately preferred over unstubbing the prototype: it needs no
 * ordering guarantee against the helper, and it cannot leave the rest of the run without its fake.
 *
 * The first block below PROVES the escape rather than assuming it - it asserts that the prototype really
 * is stubbed, that `start`/`stop`/`validateSegmentName` really are not, and that the fake and the real
 * engine are observably different stores. Without that proof this file would be indistinguishable from
 * the very false green it exists to fix.
 *
 * SCOPE AND SAFETY
 * ----------------
 * Real Mongo is used. test/setup.js forces the database to `test_<CLONE_INDEX>` and test/helpers/db.js
 * refuses anything else, so nothing here can reach a working database. Every document written carries a
 * segment unique to this process, and `afterEach` removes exactly those documents by that prefix - the
 * `sessions` collection is never dropped, because it is shared with the application.
 *
 * Every expectation was MEASURED against the running engine first (R-6), including the BSON `Date`
 * round-trip, the raw document key set, the expired-read deletion and the zero-TTL quirk.
 */

var chai           = require('chai'),
    should         = chai.should(),
    sinon          = require('sinon'),
    mongoose       = require('mongoose'),
    db             = require('../../helpers/db'),
    CatboxMongoose = require('../../../lib/util/catbox-mongoose');

describe('The real Mongo-backed session cache engine', function() {
  var REAL_METHODS = ['isReady', 'get', 'set', 'drop'],
      SEGMENT      = 'catboxspec-' + process.pid,
      proto        = CatboxMongoose.Engine.prototype,
      engine       = null,
      Session      = null,
      stubs        = [];

  /**
   * Builds an engine that runs the REAL implementations, bypassing the prototype fake by shadowing each
   * stubbed method with the original sinon preserved on `wrappedMethod`.
   *
   * @returns {Object} An unstarted engine whose four cache methods are the production ones.
   */
  function realEngine() {
    var instance = new CatboxMongoose.Engine({ partition : 'catboxspec' });

    REAL_METHODS.forEach(function(name) {
      instance[name] = proto[name].wrappedMethod;
    });

    return instance;
  }

  /** The raw driver collection, so persistence is asserted against Mongo rather than through the engine. */
  function collection() {
    return mongoose.connection.db.collection('sessions');
  }

  /** A key in this process's private segment. */
  function key(id) {
    return { segment : SEGMENT, id : id };
  }

  /**
   * Asserts that a promise rejects with exactly `message`. Written out rather than leaning on a plugin so
   * that a promise which RESOLVES fails loudly instead of passing vacuously.
   *
   * @param {Promise} promise The promise under test.
   * @param {string} message The expected `err.message`.
   * @returns {Promise} Resolves when the rejection matched.
   */
  function rejectsWith(promise, message) {
    return promise.then(function() {
      throw new Error('expected a rejection with "' + message + '" but the promise resolved');
    }, function(err) {
      err.should.be.an.instanceOf(Error);
      err.message.should.eql(message);
    });
  }

  before(function() {
    // Registering the Session model makes mongoose build the collection's indexes, and on a database this
    // suite has just dropped that build is the slowest thing in the file - measured over Mocha's 2000ms
    // default and observed as a timeout on whichever test happened to start first. Paying for it once
    // here, under an explicit allowance, makes every individual test below fast and order-independent.
    this.timeout(30000);

    return new Promise(function(resolve, reject) {
      db.ensureConnection(function(err) {
        return err ? reject(err) : resolve();
      });
    }).then(function() {
      return realEngine().start();
    }).then(function() {
      return mongoose.model('Session').init();
    });
  });

  beforeEach(function() {
    engine = realEngine();
    stubs  = [];
  });

  afterEach(function() {
    // Restored unconditionally, so a failed expectation cannot leave the Session model stubbed for the
    // suites that run afterwards.
    stubs.forEach(function(stub) {
      stub.restore();
    });

    stubs = [];

    if (engine) {
      engine.stop();
      engine = null;
    }

    if (!db.isConnected()) {
      return null;
    }

    // Only this process's own documents, and never a collection or database drop.
    return collection().deleteMany({ _id : new RegExp('^' + SEGMENT + ':') });
  });

  /** Stubs a method of the registered Session model and registers it for restoration. */
  function stubSession(method, error) {
    Session = mongoose.model('Session');
    stubs.push(sinon.stub(Session, method).throws(error));
  }

  // ---------------------------------------------------------------------------------------------
  // The escape from the global prototype fake - the premise every other block in this file rests on
  // ---------------------------------------------------------------------------------------------

  describe('the global prototype fake it bypasses', function() {
    it('confirms test/helpers/catbox-redis.js has replaced exactly the four cache methods', function() {
      REAL_METHODS.forEach(function(name) {
        should.exist(proto[name].wrappedMethod);
        proto[name].wrappedMethod.should.be.a('function');
      });
    });

    it('confirms start, stop and validateSegmentName are NOT stubbed', function() {
      ['start', 'stop', 'validateSegmentName'].forEach(function(name) {
        should.not.exist(proto[name].wrappedMethod);
      });
    });

    it('runs the production implementations, not the fake, on every engine in this file', function() {
      REAL_METHODS.forEach(function(name) {
        engine.hasOwnProperty(name).should.eql(true);
        engine[name].should.equal(proto[name].wrappedMethod);
        should.not.exist(engine[name].wrappedMethod);
      });
    });

    it('is a different store from the fake, so a fake-backed test proves nothing about Mongo', function() {
      var fake = new CatboxMongoose.Engine({}),
          k    = key('fake-vs-real');

      return engine.start().then(function() {
        return engine.set(k, { real : true }, 60000);
      }).then(function() {
        // The in-memory fake cannot see what Mongo now holds.
        return fake.get(k);
      }).then(function(fromFake) {
        should.not.exist(fromFake);

        return fake.set(k, { fake : true }, 60000);
      }).then(function() {
        return engine.get(k);
      }).then(function(fromReal) {
        // ...and a write through the fake cannot shadow the real record either.
        fromReal.item.should.eql({ real : true });

        return fake.drop(k);
      });
    });
  });

  // ---------------------------------------------------------------------------------------------
  // Lifecycle and model initialization
  // ---------------------------------------------------------------------------------------------

  describe('start, stop and isReady', function() {
    it('is constructed unconnected and not ready', function() {
      engine.isConnected.should.eql(false);
      engine.isReady().should.eql(false);
    });

    it('retains the options it was constructed with', function() {
      engine.options.should.eql({ partition : 'catboxspec' });
      new CatboxMongoose.Engine().options.should.eql({});
    });

    it('adopts the existing mongoose connection and becomes ready', function() {
      mongoose.connection.readyState.should.eql(1);

      return engine.start().then(function() {
        engine.isConnected.should.eql(true);
        engine.isReady().should.eql(true);
      });
    });

    it('initializes the Session model against the shared sessions collection', function() {
      return engine.start().then(function() {
        var model = mongoose.model('Session');

        model.collection.name.should.eql('sessions');
        Object.keys(model.schema.paths).sort().should.eql(['__v', '_id', 'stored', 'ttl', 'value']);
        model.schema.path('_id').instance.should.eql('String');
        model.schema.path('stored').instance.should.eql('Number');
        model.schema.path('ttl').instance.should.eql('Number');
      });
    });

    it('is idempotent, so a second start neither throws nor re-registers the model', function() {
      return engine.start().then(function() {
        var first = mongoose.model('Session');

        return engine.start().then(function() {
          mongoose.model('Session').should.equal(first);
          engine.isReady().should.eql(true);
        });
      });
    });

    it('stops synchronously, returning nothing and going not-ready', function() {
      return engine.start().then(function() {
        should.not.exist(engine.stop());
        engine.isConnected.should.eql(false);
        engine.isReady().should.eql(false);
        // The connection itself is untouched - stop() only clears the engine's own flag.
        mongoose.connection.readyState.should.eql(1);
      });
    });
  });

  // ---------------------------------------------------------------------------------------------
  // The not-ready guard - unreachable through the fake, because the fake's isReady always says true
  // ---------------------------------------------------------------------------------------------

  describe('the not-ready guard', function() {
    it('refuses get, set and drop before start', function() {
      return rejectsWith(engine.get(key('guard')), 'Cache not ready').then(function() {
        return rejectsWith(engine.set(key('guard'), { a : 1 }, 60000), 'Cache not ready');
      }).then(function() {
        return rejectsWith(engine.drop(key('guard')), 'Cache not ready');
      });
    });

    it('writes nothing when it refuses', function() {
      return rejectsWith(engine.set(key('guard-write'), { a : 1 }, 60000), 'Cache not ready')
        .then(function() {
          return collection().countDocuments({ _id : SEGMENT + ':guard-write' });
        }).then(function(count) {
          count.should.eql(0);
        });
    });

    it('refuses again after stop', function() {
      return engine.start().then(function() {
        return engine.set(key('guard-after-stop'), { a : 1 }, 60000);
      }).then(function() {
        engine.stop();

        return rejectsWith(engine.get(key('guard-after-stop')), 'Cache not ready');
      });
    });
  });

  // ---------------------------------------------------------------------------------------------
  // The two pure helpers catbox calls outside an operation
  // ---------------------------------------------------------------------------------------------

  describe('validateSegmentName', function() {
    it('accepts a non-empty string by returning null', function() {
      should.equal(engine.validateSegmentName('sessions'), null);
    });

    it('rejects an empty string, a non-string and a missing name', function() {
      ['', null, undefined, 5, {}].forEach(function(value) {
        var result = engine.validateSegmentName(value);

        result.should.be.an.instanceOf(Error);
        result.message.should.eql('Invalid segment name');
      });
    });
  });

  describe('_generateKey', function() {
    it('joins segment and id with a colon, which is the stored _id', function() {
      engine._generateKey({ segment : 'sess', id : 'abc' }).should.eql('sess:abc');
      engine._generateKey(key('k1')).should.eql(SEGMENT + ':k1');
    });
  });

  // ---------------------------------------------------------------------------------------------
  // Real persistence, read-back envelope and the BSON round-trip
  // ---------------------------------------------------------------------------------------------

  describe('set and get against Mongo', function() {
    beforeEach(function() {
      return engine.start();
    });

    it('persists one document whose _id is the composite key', function() {
      return engine.set(key('persist'), { hello : 'world' }, 60000).then(function() {
        return collection().find({ _id : SEGMENT + ':persist' }).toArray();
      }).then(function(docs) {
        docs.length.should.eql(1);
        Object.keys(docs[0]).sort().should.eql(['__v', '_id', 'stored', 'ttl', 'value']);
        docs[0]._id.should.eql(SEGMENT + ':persist');
        docs[0].value.should.eql({ hello : 'world' });
        // `stored` is a NUMBER, not a Date, because catbox computes `stored + ttl`. That typing is also
        // exactly why the declared TTL index never reaps - see the inert-index block below.
        docs[0].stored.should.be.a('number');
        docs[0].ttl.should.eql(60000);
      });
    });

    it('returns the catbox envelope - item, stored and ttl and nothing else', function() {
      return engine.set(key('envelope'), { a : 1 }, 60000).then(function() {
        return engine.get(key('envelope'));
      }).then(function(envelope) {
        Object.keys(envelope).sort().should.eql(['item', 'stored', 'ttl']);
        envelope.item.should.eql({ a : 1 });
        envelope.stored.should.be.a('number');
        envelope.ttl.should.eql(60000);
      });
    });

    it('round-trips a Date through BSON as a Date, which is what a yar session carries', function() {
      var when = new Date(0);

      return engine.set(key('date'), { when : when, n : 5, s : 'x' }, 60000).then(function() {
        return engine.get(key('date'));
      }).then(function(envelope) {
        envelope.item.when.should.be.an.instanceOf(Date);
        envelope.item.when.getTime().should.eql(0);
        envelope.item.n.should.be.a('number');
        envelope.item.s.should.eql('x');

        return collection().findOne({ _id : SEGMENT + ':date' });
      }).then(function(doc) {
        doc.value.when.should.be.an.instanceOf(Date);
      });
    });

    it('upserts in place, so re-setting a key replaces the value without adding a document', function() {
      return engine.set(key('upsert'), { first : true }, 60000).then(function() {
        return engine.set(key('upsert'), { second : true }, 60000);
      }).then(function() {
        return collection().countDocuments({ _id : SEGMENT + ':upsert' });
      }).then(function(count) {
        count.should.eql(1);

        return engine.get(key('upsert'));
      }).then(function(envelope) {
        envelope.item.should.eql({ second : true });
      });
    });

    it('returns null for a key that was never written', function() {
      return engine.get(key('absent')).then(function(envelope) {
        should.not.exist(envelope);
      });
    });
  });

  // ---------------------------------------------------------------------------------------------
  // Lazy expiry - the effective mechanism, per docs/PRESERVED-QUIRKS.md section 1.14 E
  // ---------------------------------------------------------------------------------------------

  describe('expiry', function() {
    beforeEach(function() {
      return engine.start();
    });

    it('reports an expired entry as absent AND deletes the document on that read', function() {
      var id = SEGMENT + ':expired';

      return engine.set(key('expired'), { a : 1 }, 1).then(function() {
        return new Promise(function(resolve) {
          setTimeout(resolve, 25);
        });
      }).then(function() {
        // Still on disk: nothing reaps it in the background.
        return collection().countDocuments({ _id : id });
      }).then(function(before) {
        before.should.eql(1);

        return engine.get(key('expired'));
      }).then(function(envelope) {
        should.not.exist(envelope);

        return collection().countDocuments({ _id : id });
      }).then(function(after) {
        after.should.eql(0);
      });
    });

    it('never expires an entry stored with ttl 0, because the check is `record.ttl &&`', function() {
      return engine.set(key('zero-ttl'), { a : 1 }, 0).then(function() {
        return new Promise(function(resolve) {
          setTimeout(resolve, 25);
        });
      }).then(function() {
        return engine.get(key('zero-ttl'));
      }).then(function(envelope) {
        should.exist(envelope);
        envelope.ttl.should.eql(0);
        envelope.item.should.eql({ a : 1 });
      });
    });

    it('keeps an unexpired entry readable', function() {
      return engine.set(key('fresh'), { a : 1 }, 60000).then(function() {
        return engine.get(key('fresh'));
      }).then(function(envelope) {
        envelope.item.should.eql({ a : 1 });
      });
    });
  });

  // ---------------------------------------------------------------------------------------------
  // drop
  // ---------------------------------------------------------------------------------------------

  describe('drop', function() {
    beforeEach(function() {
      return engine.start();
    });

    it('removes the document, after which get reports absent', function() {
      return engine.set(key('dropped'), { a : 1 }, 60000).then(function() {
        return engine.drop(key('dropped'));
      }).then(function() {
        return collection().countDocuments({ _id : SEGMENT + ':dropped' });
      }).then(function(count) {
        count.should.eql(0);

        return engine.get(key('dropped'));
      }).then(function(envelope) {
        should.not.exist(envelope);
      });
    });

    it('resolves for a key that does not exist', function() {
      return engine.drop(key('never-written'));
    });
  });

  // ---------------------------------------------------------------------------------------------
  // Error propagation - the `catch (err) { throw err; }` blocks must not swallow
  // ---------------------------------------------------------------------------------------------

  describe('driver failures', function() {
    beforeEach(function() {
      return engine.start();
    });

    it('propagates a read failure out of get', function() {
      stubSession('findById', new Error('mongo read exploded'));

      return rejectsWith(engine.get(key('read-fail')), 'mongo read exploded');
    });

    it('propagates a write failure out of set', function() {
      stubSession('findByIdAndUpdate', new Error('mongo write exploded'));

      return rejectsWith(engine.set(key('write-fail'), { a : 1 }, 60000), 'mongo write exploded');
    });

    it('propagates a delete failure out of drop', function() {
      stubSession('deleteOne', new Error('mongo delete exploded'));

      return rejectsWith(engine.drop(key('delete-fail')), 'mongo delete exploded');
    });
  });

  // ---------------------------------------------------------------------------------------------
  // The declared TTL index, and the measured reason it is inert
  // ---------------------------------------------------------------------------------------------

  describe('the declared TTL index', function() {
    it('exists as stored_1 with expireAfterSeconds 0 over a partial filter, yet cannot ever fire',
      function() {
        this.timeout(30000);

        return engine.start().then(function() {
          // Deterministic: init() resolves once autoIndex has finished building, so a fresh database
          // cannot race this assertion.
          return mongoose.model('Session').init();
        }).then(function() {
          return collection().indexes();
        }).then(function(indexes) {
          var ttlIndex = indexes.filter(function(index) {
            return index.name === 'stored_1';
          })[0];

          should.exist(ttlIndex);
          ttlIndex.expireAfterSeconds.should.eql(0);
          ttlIndex.partialFilterExpression.should.eql({ ttl : { $exists : true } });

          return engine.set(key('inert-index'), { a : 1 }, 60000);
        }).then(function() {
          return collection().findOne({ _id : SEGMENT + ':inert-index' });
        }).then(function(doc) {
          // MongoDB's TTL monitor only acts on Date-valued fields. `stored` is a Number, so the index
          // above reaps nothing and the lazy check in get() is the whole of expiry. Preserved
          // deliberately - docs/PRESERVED-QUIRKS.md section 1.14 E.
          doc.stored.should.be.a('number');
          (doc.stored instanceof Date).should.eql(false);
        });
      });
  });
});
