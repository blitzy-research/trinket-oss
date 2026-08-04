/**
 * Recaptcha verification: lib/util/recaptcha.js (review finding M-22).
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * This module was rewritten from `request.post(..., function (err, response, body) {...})` to `fetch`,
 * which is one of the migration's dependency REPLACEMENTS (the `request` package is dead and Node 22
 * carries fetch natively), and nothing tested it. Three things about it are easy to break and impossible
 * to notice: the short-circuit resolves without touching the network, the non-200 branch resolves a key
 * no caller reads, and there is deliberately no transport-error guard.
 *
 * THE CONTRACT UNDER TEST IS PROMISE-NATIVE
 * -----------------------------------------
 * `verify(token)` takes ONE parameter and returns a promise; the callback the base commit accepted is gone
 * with the `request` package that shaped it, and all four call sites in lib/controllers/{users,trinket}.js
 * `await` the result. Every expectation below is written against that shape.
 *
 * PRESERVED QUIRKS PINNED HERE
 * ----------------------------
 *   1. The non-200 branch resolves `{ status : false }` - not `{ success : false }` - while every caller
 *      reads `.success`, so a rejected verification reads as `undefined` rather than false.
 *   2. The status is read with no transport guard and the async block carries no rejection handler, so a
 *      transport failure or a malformed payload leaves the returned promise UNSETTLED FOREVER and escapes
 *      as an unhandled rejection instead of degrading into a result object. That is the promise-native
 *      form of the base commit's uncaught TypeError: the caller is still never told.
 *      docs/PRESERVED-QUIRKS.md section 1.10.
 * Both are asserted rather than fixed. R-4 forbids converging them.
 *
 * HOW THE SEAM IS CHOSEN
 * ----------------------
 * `global.fetch` is stubbed - the outermost possible seam - so the real URL, method and
 * `URLSearchParams` body are all constructed by production code and asserted as issued. `config.isTest`
 * and `config.app.recaptcha` are set per test and restored unconditionally in `afterEach`, because the
 * shipped configuration carries an EMPTY secretkey and therefore never reaches the network at all.
 *
 * Every expectation below was MEASURED against the running module first (R-6).
 */

var chai      = require('chai'),
    should    = chai.should(),
    sinon     = require('sinon'),
    config    = require('config'),
    recaptcha = require('../../../lib/util/recaptcha');

describe('Recaptcha verification', function() {
  var originalIsTest    = config.isTest,
      originalRecaptcha = config.app.recaptcha,
      fetchStub         = null;

  /** Replaces global.fetch for one test. */
  function stubFetch(implementation) {
    fetchStub = sinon.stub(global, 'fetch').callsFake(implementation);

    return fetchStub;
  }

  /** Puts the module on its network path: not a test run, and a secret configured. */
  function configured(secret) {
    config.isTest = false;
    config.app.recaptcha = { sitekey : 'SITE', secretkey : secret };
  }

  /**
   * Runs `body` with Mocha's unhandled-rejection listeners detached, collecting what escapes.
   *
   * The module deliberately attaches no rejection handler to its async block, so the two failure paths
   * below reach the process rather than the caller. Mocha would fail the run on that, which is exactly
   * why the listeners are swapped for the duration and restored unconditionally.
   *
   * @param {Function} body Receives the array that escaped rejections are pushed into.
   * @returns {Promise} Resolves with that array once the microtask queue has drained.
   */
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
      .then(function() {
        return new Promise(function(resolve) {
          setTimeout(resolve, 50);
        });
      })
      .then(function() {
        return escaped;
      })
      .finally(function() {
        process.removeListener('unhandledRejection', collect);
        listeners.forEach(function(listener) {
          process.on('unhandledRejection', listener);
        });
      });
  }

  /** Waits long enough for the module's un-awaited async block to have called back. */
  function settled() {
    return new Promise(function(resolve) {
      setTimeout(resolve, 50);
    });
  }

  afterEach(function() {
    if (fetchStub) {
      fetchStub.restore();
      fetchStub = null;
    }

    // Unconditional: leaving `isTest` false would send every later consumer of this module, and anything
    // else that branches on it, down a path the suite never intends.
    config.isTest        = originalIsTest;
    config.app.recaptcha = originalRecaptcha;
  });

  describe('the short-circuit paths', function() {
    it('takes ONE parameter: the token. There is no callback to pass', function() {
      // The async conversion removed the callback outright rather than accepting both shapes, and every
      // caller in lib/controllers/{users,trinket}.js awaits the returned promise.
      recaptcha.verify.length.should.eql(1);
    });

    it('resolves success WITHOUT any network work under a test run', function() {
      config.isTest.should.eql(true);

      var pending = recaptcha.verify('any-token');

      // The promise is already resolved before it is returned - the short-circuit does no awaiting - so
      // the caller's `await` costs exactly one microtask and never a request.
      pending.should.be.an.instanceOf(Promise);

      return pending.then(function(result) {
        result.should.eql({ success : true });
      });
    });

    it('short-circuits when recaptcha is not configured at all', function() {
      config.isTest = false;
      config.app.recaptcha = undefined;

      return recaptcha.verify('t').then(function(result) {
        result.should.eql({ success : true });
      });
    });

    it('short-circuits on the shipped empty secretkey, which is why nothing calls Google', function() {
      originalRecaptcha.secretkey.should.eql('');
      config.isTest = false;

      return recaptcha.verify('t').then(function(result) {
        result.should.eql({ success : true });
      });
    });

    it('issues no request on any short-circuit path', function() {
      var fetched = stubFetch(function() {
        return Promise.resolve({ status : 200, text : function() { return Promise.resolve('{}'); } });
      });

      return recaptcha.verify('t').then(function() {
        return settled();
      }).then(function() {
        fetched.called.should.eql(false);
      });
    });
  });

  describe('the verification request', function() {
    it('posts the secret and the response token to Google, form-encoded', function() {
      var calls = [];

      configured('SECRET-KEY');
      stubFetch(function(url, options) {
        calls.push([url, options]);

        return Promise.resolve({
          status : 200,
          text   : function() { return Promise.resolve('{"success":true}'); }
        });
      });

      return recaptcha.verify('USER-TOKEN').then(function() {
        calls.length.should.eql(1);
        calls[0][0].should.eql('https://www.google.com/recaptcha/api/siteverify');
        Object.keys(calls[0][1]).sort().should.eql(['body', 'method']);
        calls[0][1].method.should.eql('POST');
        // URLSearchParams is what makes this application/x-www-form-urlencoded without a header.
        calls[0][1].body.should.be.an.instanceOf(URLSearchParams);
        calls[0][1].body.toString().should.eql('secret=SECRET-KEY&response=USER-TOKEN');
      });
    });

    it('is still pending when it returns, and resolves once the request settles', function() {
      var settledYet = false;

      configured('SECRET');
      stubFetch(function() {
        return Promise.resolve({
          status : 200,
          text   : function() { return Promise.resolve('{"success":true}'); }
        });
      });

      var pending = recaptcha.verify('t').then(function(result) {
        settledYet = true;

        return result;
      });

      // Nothing yet: the network path is asynchronous, so the promise the caller awaits is genuinely
      // pending rather than pre-resolved as it is on the short-circuit.
      settledYet.should.eql(false);

      return pending.then(function(result) {
        result.should.eql({ success : true });
      });
    });

    it('hands the parsed payload through verbatim, including the fields callers ignore', function() {
      configured('SECRET');
      stubFetch(function() {
        return Promise.resolve({
          status : 200,
          text   : function() {
            return Promise.resolve('{"success":false,"error-codes":["invalid-input-response"],"hostname":"h"}');
          }
        });
      });

      return recaptcha.verify('t').then(function(result) {
        result.should.eql({
          success        : false,
          'error-codes'  : ['invalid-input-response'],
          hostname       : 'h'
        });
      });
    });

    it('reports a non-200 with a status key that no caller reads, and never a success key', function() {
      configured('SECRET');
      stubFetch(function() {
        return Promise.resolve({
          status : 503,
          text   : function() { return Promise.resolve('service unavailable'); }
        });
      });

      return recaptcha.verify('t').then(function(result) {
        // PRESERVED QUIRK: `status`, not `success`. Every caller tests `.success`, which is undefined
        // here - so a failed verification reads as neither true nor false.
        result.should.eql({ status : false });
        result.should.not.have.property('success');
        should.equal(result.success, undefined);
      });
    });

    it('does not read the body on a non-200', function() {
      var read = 0;

      configured('SECRET');
      stubFetch(function() {
        return Promise.resolve({
          status : 400,
          text   : function() {
            read++;

            return Promise.resolve('{}');
          }
        });
      });

      return recaptcha.verify('t').then(function() {
        read.should.eql(0);
      });
    });
  });

  describe('the unguarded failure paths', function() {
    /**
     * Records how the promise verify() returned settled, WITHOUT ever letting the test await it: the
     * whole point of the two paths below is that it never settles at all. `NEVER` is what the race
     * reports when only the timer fired.
     *
     * @param {Promise} pending The promise verify() returned.
     * @param {Array}   sink    Receives 'resolved', 'rejected' or nothing.
     * @returns {Promise} Resolves with `sink` once the grace period has elapsed.
     */
    function observeSettlement(pending, sink) {
      pending.then(function() {
        sink.push('resolved');
      }, function() {
        sink.push('rejected');
      });

      return settled().then(function() {
        return sink;
      });
    }

    it('lets a malformed payload escape as an unhandled rejection, never settling', function() {
      var fate = [];

      configured('SECRET');
      stubFetch(function() {
        return Promise.resolve({
          status : 200,
          text   : function() { return Promise.resolve('this is not json'); }
        });
      });

      return withEscapedRejections(function() {
        return observeSettlement(recaptcha.verify('t'), fate);
      }).then(function(escaped) {
        // PRESERVED QUIRK - docs/PRESERVED-QUIRKS.md section 1.10. JSON.parse throws inside an async
        // block with no rejection handler, so the promise the caller awaits NEVER settles and the process
        // sees the failure. An awaiting caller therefore hangs exactly where the base commit's unguarded
        // read threw an uncaught TypeError; converging the two would be a behavior change.
        escaped.length.should.eql(1);
        escaped[0].should.be.an.instanceOf(SyntaxError);
        fate.should.eql([]);
      });
    });

    it('lets a transport failure escape the same way, with no degradation to a result object', function() {
      var fate = [];

      configured('SECRET');
      stubFetch(function() {
        return Promise.reject(new Error('ECONNREFUSED'));
      });

      return withEscapedRejections(function() {
        return observeSettlement(recaptcha.verify('t'), fate);
      }).then(function(escaped) {
        escaped.length.should.eql(1);
        escaped[0].message.should.eql('ECONNREFUSED');
        fate.should.eql([]);
      });
    });
  });
});
