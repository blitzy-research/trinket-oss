/**
 * Parity guard for the "no response" fate that several converted handlers must preserve.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * At the base commit, lib/util/routeParser.js wrapped every handler and ended with
 * `if (result === undefined) { result = await responsePromise; }`, where `responsePromise` was a
 * deferred settled only by `request.success`, `request.fail`, or one of the synthetic reply builder's
 * resolving terminators. A number of failure branches settled none of those - they fell off the end of a
 * callback, or threw inside a callback no promise chain owned. For those branches the deferred was never
 * settled, the shim's only timer merely logged "still going after 1s", and the server declares no
 * `routes.timeout`, so the client received NO RESPONSE AT ALL.
 *
 * Preserving that is a hard requirement: AAP rule R-4 forbids behavior "improvements" and R-6 makes
 * baseline behavior the tie-breaker. The mechanism the converted handlers use is to return a promise
 * that never settles. This file pins the three distinct outcomes that mechanism depends on, measured
 * against the real @hapi/hapi version the project runs:
 *
 *   1. returning a never-settling promise  -> the request is never answered, and nothing is logged
 *   2. returning `undefined`               -> hapi answers 500 ("handler method did not return a value")
 *   3. returning the old builder's shape   -> hapi answers 200 with body `{}`
 *
 * Outcomes 1 and 2 are the load-bearing pair. If a future hapi upgrade made a never-settling promise
 * time out into a 5xx, or made `undefined` answer something other than 500, every preserved
 * no-response branch in lib/controllers/** would silently change its observable behavior with no other
 * test failing. That is precisely the class of silent regression this file exists to catch, which is why
 * it asserts the framework contract rather than any one controller: the controllers are unreachable
 * without database fixtures, whereas the contract they all rely on is testable in isolation.
 *
 * Outcome 3 is included because it is the distinction that decides two of those branches. Returning the
 * builder from a HANDLER does serialize to 200 `{}` - but at the base commit those sites returned the
 * builder to a Mongoose callback, which discards its callback's return value, so it never reached the
 * shim and the request went unanswered. Pinning outcome 3 keeps that reasoning honest by showing the
 * measured 200 `{}` really does exist, and is simply not the path those branches took.
 *
 * The server here binds port 0 (an ephemeral port) so parallel clones cannot collide, and every request
 * is bounded by an AbortController, so asserting a hang can never hang this suite.
 */

var Hapi      = require('@hapi/hapi')
  , Boom      = require('@hapi/boom')
  , spawnSync = require('child_process').spawnSync
  , expect    = require('chai').expect;

// Long enough that a slow machine cannot mistake a real response for a hang, short enough to keep the
// suite quick. The assertion is one-sided: a response arriving at all fails the no-response test.
var NO_RESPONSE_WAIT_MS = 750;

/**
 * Reproduces the shape the retired synthetic `reply()` handed back for non-Boom, non-Error data: a
 * chainable builder whose every own property is a function. `type()` and `bytes()` returned the builder
 * without settling the deferred, which is why a site that called only those never responded.
 *
 * @returns {Object} A builder-shaped object with no non-function own properties.
 */
function builderShape() {
  var builder = {};

  ['type', 'bytes', 'code', 'header', 'redirect', 'view'].forEach(function (name) {
    builder[name] = function () {
      return builder;
    };
  });

  return builder;
}

describe('Preserved no-response fate', function() {
  var server
    , requestErrors = [];

  before(async function() {
    this.timeout(10000);

    // debug:false silences hapi's own console dump for the deliberate 500 below; the assertions
    // read the captured request events instead, so nothing observable is lost.
    server = Hapi.server({ host : 'localhost', port : 0, debug : false });

    // Captures anything hapi reports about a request, so the no-response case can assert silence
    // rather than merely assert that no body arrived.
    server.events.on({ name : 'request', channels : ['error', 'internal'] },
      function (request, event) {
        requestErrors.push(request.path + ' :: ' + ((event.error && event.error.message) || 'unknown'));
      });

    server.route([
      {
        method  : 'GET',
        path    : '/never-settles',
        handler : async function() {
          return new Promise(function() {});
        }
      },
      {
        method  : 'GET',
        path    : '/returns-undefined',
        handler : async function() {
          return undefined;
        }
      },
      {
        method  : 'GET',
        path    : '/returns-builder',
        handler : async function() {
          return builderShape();
        }
      },
      {
        // The shape several preserved branches actually use: the never-settling promise is not the
        // handler's own return value but the resolution value of a `.then`/`.catch` callback inside a
        // chain the handler returns, so the chain adopts it and never settles either. Pinned
        // separately from /never-settles because promise adoption, not the handler contract, is what
        // carries the no-response outcome through in course.js#userLookup and trinket.js#email.
        method  : 'GET',
        path    : '/chain-never-settles',
        handler : function() {
          return Promise.resolve(1).then(function() {
            return new Promise(function() {});
          });
        }
      },
      {
        // trinket.js#email's surviving arm: a Boom RETURNED (never thrown) from a `.catch` inside a
        // returned chain must keep its status and its client-visible 4xx message.
        method  : 'GET',
        path    : '/chain-returns-boom',
        handler : function() {
          return Promise.reject(new Error('inner'))
            .catch(function() {
              return Boom.forbidden();
            });
        }
      },
      {
        // trinket.js#autosave relies on this: a plain Error returned - not thrown - from inside a
        // returned chain must answer the same scrubbed 500 the retired synthetic responder produced
        // when it mapped an Error through Boom.badImplementation.
        method  : 'GET',
        path    : '/chain-returns-error',
        handler : function() {
          return Promise.resolve(1).then(function() {
            return new Error('a message that must never reach the client');
          });
        }
      }
    ]);

    await server.start();
  });

  after(async function() {
    this.timeout(10000);

    if (server) {
      await server.stop({ timeout : 200 });
    }
  });

  /**
   * Issues a bounded GET and reports either the response or the fact that none arrived.
   *
   * @param {string} routePath Path to request.
   * @returns {Promise.<{answered: boolean, status: (number|undefined), body: (string|undefined)}>}
   */
  async function get(routePath) {
    var controller = new AbortController()
      , timer = setTimeout(function () { controller.abort(); }, NO_RESPONSE_WAIT_MS)
      , response;

    try {
      response = await fetch(server.info.uri + routePath, { signal : controller.signal });
    }
    catch (abortError) {
      return { answered : false };
    }
    finally {
      clearTimeout(timer);
    }

    return { answered : true, status : response.status, body : await response.text() };
  }

  it('leaves the request unanswered when the handler returns a never-settling promise', async function() {
    this.timeout(10000);

    requestErrors.length = 0;

    var result = await get('/never-settles');

    expect(result.answered, 'a never-settling handler must not produce any response').to.equal(false);
    expect(requestErrors, 'the unanswered request must not be reported as an error').to.deep.equal([]);
  });

  it('answers 500 when the handler returns undefined, which is why the idiom is required',
    async function() {
      this.timeout(10000);

      var result = await get('/returns-undefined');

      expect(result.answered, 'returning undefined must produce a response').to.equal(true);
      expect(result.status).to.equal(500);
      // 5xx messages are scrubbed by hapi, so the body must not leak the internal reason.
      expect(result.body).to.contain('An internal server error occurred');
      expect(result.body).to.not.contain('did not return a value');
    });

  it('answers 200 with body {} when a handler returns the retired builder shape', async function() {
    this.timeout(10000);

    var result = await get('/returns-builder');

    expect(result.answered).to.equal(true);
    expect(result.status).to.equal(200);
    expect(result.body).to.equal('{}');
  });

  it('leaves the request unanswered when a never-settling promise is adopted by a returned chain',
    async function() {
      this.timeout(10000);

      requestErrors.length = 0;

      var result = await get('/chain-never-settles');

      expect(result.answered, 'promise adoption must carry the no-response outcome through')
        .to.equal(false);
      expect(requestErrors, 'the unanswered request must not be reported as an error').to.deep.equal([]);
    });

  it('answers a returned Boom with its status and its client-visible 4xx message', async function() {
    this.timeout(10000);

    var result = await get('/chain-returns-boom');

    expect(result.answered).to.equal(true);
    expect(result.status).to.equal(403);
    // 4xx messages pass through, which is why the preserved 403 arm must keep the default text.
    expect(result.body).to.contain('Forbidden');
  });

  it('answers a returned plain Error with a scrubbed 500 that does not leak its message',
    async function() {
      this.timeout(10000);

      var result = await get('/chain-returns-error');

      expect(result.answered).to.equal(true);
      expect(result.status).to.equal(500);
      expect(result.body).to.contain('An internal server error occurred');
      expect(result.body).to.not.contain('must never reach the client');
    });

  /**
   * Not a framework contract but a language one, and it is load-bearing: trinket.js#autosave
   * discriminates its two JSON.parse failure arms on `code instanceof Error`. That discrimination is
   * only faithful to the base commit if feeding an Error to JSON.parse always throws - which is what
   * made the baseline's already-answered 500 path reach the same throw. If this ever stopped throwing,
   * the Error arm would silently start answering 200 instead of the scrubbed 500 it must answer.
   */
  it('always throws when JSON.parse is handed an Error, which the Error arm depends on', function() {
    [new Error('boom'), new Error(''), Boom.badImplementation('x'), new TypeError('t')]
      .forEach(function (candidate) {
        expect(function () { JSON.parse(candidate); },
          'JSON.parse(' + String(candidate) + ') must throw').to.throw(SyntaxError);
      });
  });
});

/**
 * The OTHER half of the preserved no-response fate.
 *
 * Several base-commit branches did not merely fail to settle the deferred - they raised inside a
 * callback whose returned promise the calling API discarded. `lib/controllers/users.js` had four such
 * sites, each an `async function` handed to an API that ignores what its callback returns:
 *
 *   - sendPassReset          -> require('crypto').randomBytes(48, async function (ex, buf) { ... })
 *   - sendEmailVerification  -> require('crypto').randomBytes(48, async function (ex, buf) { ... })
 *   - savePassword           -> user.save(async function (err) { ... })
 *   - activateAccount        -> user.save(...) and request.yar._logIn(user, async function (err) { ... })
 *
 * An `await` rejection inside such a callback becomes an UNHANDLED rejection. No `unhandledRejection`
 * and no `uncaughtException` handler exists anywhere in app.js, config/ or lib/, so under Node 22's
 * default `--unhandled-rejections=throw` the worker died - and the responder sitting after the await
 * never ran, so the client received NO RESPONSE.
 *
 * The converted handlers contain each of those awaits in its own try/catch and return a never-settling
 * promise, which reproduces the client-visible half (the request is never answered) while deliberately
 * NOT reproducing the process death: process lifecycle is outside every one of the five PRESERVE
 * directives, and re-raising to kill the worker matches none of R-1's four sanctioned diff categories.
 *
 * These tests pin BOTH sides of that reasoning, in a child process so nothing can take this suite down
 * with it:
 *
 *   1. the baseline mechanism is real   -> the discarded-callback rejection still kills a Node 22 worker
 *   2. the containment shape works      -> the same rejection, caught locally, leaves the worker alive
 *
 * If a future Node release ever demoted unhandled rejections back to a warning, assertion 1 fails and
 * tells the reader that the preserved no-response branches are documenting a fate that no longer
 * exists - which is exactly when the PRESERVED-QUIRKS entries would need revisiting.
 */
describe('Preserved no-response fate: rejections in discarded callbacks', function() {

  // Generous because it pays for a full Node process start, and one-sided: the assertions read the
  // child's exit status and output, so a slow machine cannot turn a pass into a fail.
  var CHILD_TIMEOUT_MS = 20000;

  /**
   * Runs a one-liner in a fresh Node process with no inherited flags, so the runtime's DEFAULT
   * unhandled-rejection mode is what is measured.
   *
   * @param {string} source Program text to evaluate.
   * @returns {{status: (number|null), stdout: string, stderr: string}} Child outcome.
   */
  function runChild(source) {
    var result = spawnSync(process.execPath, ['-e', source], {
      timeout  : CHILD_TIMEOUT_MS,
      encoding : 'utf8'
    });

    return {
      status : result.status,
      stdout : result.stdout || '',
      stderr : result.stderr || ''
    };
  }

  // Reproduces the base-commit shape exactly: an async callback handed to crypto.randomBytes, awaiting
  // something that rejects, with the responder that followed it standing in as a printed marker.
  var BASELINE_SHAPE = [
    'require("crypto").randomBytes(8, async function (ex, buf) {',
    '  await Promise.reject(new Error("STORE-REJECTED"));',
    '  console.log("RESPONDER-RAN");',
    '});',
    'setTimeout(function () { console.log("STILL-ALIVE"); }, 400);'
  ].join('\n');

  // The same shape for an API that merely invokes its callback and ignores the return value, which is
  // what mongoose's document.save(cb) and yar's _logIn(user, cb) both do.
  var BASELINE_SHAPE_PLAIN_CALLBACK = [
    'function ignoresCallbackReturnValue(cb) { cb(null); }',
    'ignoresCallbackReturnValue(async function (err) {',
    '  await Promise.reject(new Error("STORE-DEL-REJECTED"));',
    '  console.log("RESPONDER-RAN");',
    '});',
    'setTimeout(function () { console.log("STILL-ALIVE"); }, 400);'
  ].join('\n');

  // The converted shape: the await is contained locally, so nothing escapes to the runtime.
  var CONTAINED_SHAPE = [
    'require("crypto").randomBytes(8, async function (ex, buf) {',
    '  try {',
    '    await Promise.reject(new Error("STORE-REJECTED"));',
    '  }',
    '  catch (unownedCallbackError) {',
    '    console.log("CONTAINED");',
    '    return;',
    '  }',
    '  console.log("RESPONDER-RAN");',
    '});',
    'setTimeout(function () { console.log("STILL-ALIVE"); }, 400);'
  ].join('\n');

  it('kills the worker when an async callback handed to crypto.randomBytes rejects', function() {
    this.timeout(CHILD_TIMEOUT_MS + 5000);

    var child = runChild(BASELINE_SHAPE);

    expect(child.status, 'the unhandled rejection must still terminate the process').to.equal(1);
    expect(child.stderr).to.contain('STORE-REJECTED');
    // The two markers are the whole point: the responder never ran, so no response was ever produced,
    // and death happened before the timer, so nothing later in the callback could recover.
    expect(child.stdout, 'the responder after the await must never run').to.not.contain('RESPONDER-RAN');
    expect(child.stdout, 'the process must not outlive the rejection').to.not.contain('STILL-ALIVE');
  });

  it('kills the worker for any API that invokes a callback and discards its return value', function() {
    this.timeout(CHILD_TIMEOUT_MS + 5000);

    var child = runChild(BASELINE_SHAPE_PLAIN_CALLBACK);

    expect(child.status, 'document.save(asyncCb) and _logIn(user, asyncCb) share this fate')
      .to.equal(1);
    expect(child.stderr).to.contain('STORE-DEL-REJECTED');
    expect(child.stdout).to.not.contain('RESPONDER-RAN');
    expect(child.stdout).to.not.contain('STILL-ALIVE');
  });

  it('leaves the worker alive once the same rejection is contained, without running the responder',
    function() {
      this.timeout(CHILD_TIMEOUT_MS + 5000);

      var child = runChild(CONTAINED_SHAPE);

      expect(child.status, 'the containment shape must not terminate the process').to.equal(0);
      expect(child.stdout, 'the catch must be the branch that runs').to.contain('CONTAINED');
      // Still no response: containment changes the process fate, never the client-visible one.
      expect(child.stdout, 'the responder must remain unreached').to.not.contain('RESPONDER-RAN');
      expect(child.stdout, 'the process must survive to its timer').to.contain('STILL-ALIVE');
    });
});
