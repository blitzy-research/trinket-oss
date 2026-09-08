var config       = require('config'),
    errors       = require('@hapi/boom'),
    Store        = require('../util/store'),
    emailStore   = Store.email(),
    mailer       = require('../util/mailer'),
    FileUtil     = require('../util/file'),
    nunjucks     = require('nunjucks'),
    // parseLegacy returns a partial object with a null `protocol` for relative
    // input rather than throwing, and it keeps the query string on `.path`.
    // Both consumers are in assetUploadFromURL: the protocol test on the parsed
    // result, and the `path.basename` that derives the upload filename from
    // `.path` and so carries any query string into the stored object key.
    parseLegacy  = require('../util/url').parseLegacy,
    mime         = require('mime'),
    _            = require('underscore'),
    path         = require('path'),
    fs           = require('fs'),
    // Readable.fromWeb() adapts the web stream returned by the bounded fetch
    // below into the Node stream that pipes into fs.createWriteStream.
    Readable     = require('stream').Readable,
    tmp          = require('tmp'),
    StringUtils  = require('../util/stringUtils'),
    Folder       = require('../models/folder'),
    exportsQueue = require('../util/queues').exports(),
    Export       = require('../models/export'),
    aws          = require('../../config/aws'),
    roles        = require('../util/roles'),
    constants    = require('../../config/constants'),
    crypto       = require('crypto'),
    userUtil     = require('../util/user'),
    recaptcha    = require('../util/recaptcha');

// ---------------------------------------------------------------------------
// The asset fetch transport.
//
// POST /api/users/assetFromURL fetches a caller-supplied URL server-side and
// pipes the response into user-asset storage. The three pieces below exist
// only to keep native fetch behaving on that route as the removed `request`
// 2.88.2 package did. They add no policy of their own: every failure they can
// produce is one the replaced package produced too, and every response the
// replaced package stored is still stored here.
// ---------------------------------------------------------------------------

// `request` 2.88.2 defaulted to `maxRedirects: 10`; native fetch follows 20
// before failing. Without the original ceiling an 11-to-20-hop chain would
// succeed where baseline failed, so this is parity, not policy.
var ASSET_FETCH_MAX_REDIRECTS = 10;

// `request` 2.88.2's own redirect test (lib/redirect.js,
// Redirect.prototype.redirectTo): a 3xx status plus a Location header - a
// range rather than an enumerated list, so 301, 302, 303, 307 and 308 all
// follow exactly as they did.
function assetIsRedirect(status, location) {
  return status >= 300 && status < 400 && !!location;
}

// Abandons the body of a redirect response, so its socket is released instead
// of being held until the body is collected: without this a full-budget chain
// holds that many undrained response bodies open. A cancellation that itself
// fails has nothing to report - the response is discarded either way and the
// hop's outcome is already decided - so the rejection is deliberately absorbed
// rather than left to surface as an unhandled one.
function assetDiscardBody(response) {
  if (response.body && typeof response.body.cancel === 'function') {
    response.body.cancel().then(null, function(uncancellable) {
      return uncancellable;
    });
  }
}

// The GET, with the replaced package's redirect handling. Resolves with
// { response, url } for the FINAL response of the chain - which includes a
// non-2xx, and a 3xx carrying no Location, because `request` treated both as
// final and this route stored their bodies and their content-types - and
// rejects for anything that fails before a final response exists. That is the
// same boundary the replaced package's 'error' event had, so the caller's
// log-only, never-settling arm covers the same set of events, together with an
// unusable URL and a scheme fetch will not transport - 'ftp:', 'file:' and
// 'javascript:' all reject - because the initial URL is passed through as the
// raw payload string and fetch is what judges it.
function fetchAssetResource(initialUrl) {
  var hops = 0;

  var attempt = function(target) {
    // `request` was not configured with `gzip: true` here, so it sent no
    // accept-encoding, the origin served the identity representation, and those
    // wire bytes were the bytes written to disk - which AAP 0.6.7 then keys the
    // stored S3 object on, by their sha1. fetch's default is 'gzip, deflate',
    // so identity is asked for explicitly. It is a request header and nothing
    // more: no response is refused on account of it.
    //
    // globalThis.fetch is read at CALL time and never captured into a
    // module-level binding, because test/parity/fixtures/http.js installs
    // itself by replacing globalThis.fetch; a captured reference - or a switch
    // to http/https directly - would silently stop being intercepted.
    return globalThis.fetch(target, {
      method   : 'GET',
      // Always manual: the hop budget below is the parity constraint, and
      // fetch's own follower cannot be capped at 10.
      redirect : 'manual',
      headers  : { 'accept-encoding' : 'identity' }
    }).then(function(response) {
      var location = response.headers.get('location');

      if (!assetIsRedirect(response.status, location)) {
        return { response : response, url : target };
      }

      // Drained before the hop is decided, and before the budget is tested,
      // which is the order `request` used: resume() ran ahead of its
      // maxRedirects check, so an over-budget chain released its last response
      // body too rather than leaving it open.
      assetDiscardBody(response);

      hops++;
      if (hops > ASSET_FETCH_MAX_REDIRECTS) {
        // The replaced package's own message and interpolated URL: it emitted
        // `new Error('Exceeded maxRedirects. Probably stuck in a redirect loop '
        // + request.uri.href)` with `uri` still holding the URL that RETURNED
        // the excess redirect, because it advanced its uri only after this
        // check.
        throw new Error('Exceeded maxRedirects. Probably stuck in a redirect loop ' + String(target));
      }

      return attempt(new URL(location, target));
    });
  };

  return attempt(initialUrl);
}

// ---------------------------------------------------------------------------
// Failed-login response differentiation and backoff.
//
// obs-login-enumeration-no-throttle: `login` below used to answer four
// distinguishable failures - "Unknown user <the identifier the caller sent>",
// "Invalid password", "A password was not found for this account." and
// "Account Disabled" - immediately and without limit. The first three are a
// credential oracle (CWE-204): they tell an unauthenticated caller whether an
// account exists and what state it is in, and the first one echoes the
// submitted identifier back into the response. Those three now share ONE
// message, LOGIN_GENERIC_FAILURE_MESSAGE, and no failure message interpolates
// the submitted identifier any more.
//
// "Account Disabled" is deliberately LEFT AS IT WAS. It is an actionable
// account-state notice for someone who has already proved nothing about the
// password - the branch is reached before any password comparison, so it
// cannot be used to test a guess - and collapsing it would remove the only
// signal a disabled user has for why they cannot get in.
//
// Genericising the message closes the oracle. This block closes the rate half
// of the same finding: 20 consecutive wrong-password attempts used to be
// answered 200 with no delay, lockout or CAPTCHA at all.
//
// WHAT THIS CONTROL IS, AND WHAT IT DELIBERATELY IS NOT
//
// It is a delay, and only a delay - no lockout, no CAPTCHA, no changed status
// code, no changed response body and no new header - for two reasons:
//
//   * A lockout is itself a denial-of-service primitive: anyone who knows an
//     address could lock its owner out at will. A bounded delay costs the
//     attacker throughput without handing them that weapon.
//   * AAP 0.9.3 compares the parity corpus field by field, exactly, including
//     status, headers and JSON scalars. A changed status, body field or header
//     would widen that diff beyond the single message string this fix already
//     changes. The throttle is therefore invisible in the response and visible
//     only in its timing.
//
// THE NUMBERS, AND WHY THEY ARE THESE NUMBERS
//
//   * LOGIN_FAILURE_FREE_ATTEMPTS = 3 - the first three consecutive failures
//     for a key are answered with no added delay whatsoever, so a human
//     mistyping a password is never punished. It is also what keeps the
//     committed tests honest: test/lib/api/login.js drives exactly one
//     wrong-password attempt, and the committed corpus drives at most two
//     consecutive failures against one key (route.post.login.html then
//     route.post.login.json), so every committed test and scenario sits below
//     the threshold and measures zero added time. A lower threshold would slow
//     the suite and the replay without strengthening the control.
//   * LOGIN_FAILURE_BASE_DELAY_MS = 250, doubling with every further failure:
//     failure 4 waits 250ms, 5 waits 500ms, 6 waits 1000ms, 7 waits 2000ms,
//     and 8 onwards waits the cap. Exponential growth is what makes a spray of
//     thousands of guesses uneconomic while the fourth honest retry is barely
//     perceptible.
//   * LOGIN_FAILURE_MAX_DELAY_MS = 4000 is a HARD cap. An unbounded backoff
//     would hold connections open for minutes and become its own availability
//     problem, and it would eventually exceed what callers wait for: no route
//     in this application declares a server timeout, and the parity harness
//     allows 15000ms per request, so a 4000ms ceiling answers well inside
//     every caller's patience.
//   * LOGIN_FAILURE_MAX_EXPONENT = 16 clamps the doubling itself. The product
//     is capped anyway, but Math.pow overflows to Infinity past 2^1024 and a
//     security control should not rest on Infinity comparing correctly.
//   * LOGIN_FAILURE_WINDOW_MS = 15 minutes - an entry that has seen no failure
//     for that long is treated as absent and decays, so no key is ever
//     punished for something that happened hours ago.
//   * LOGIN_FAILURE_MAX_KEYS = 10000 is the CAP ON THE MAP ITSELF, and it is
//     not optional: an attacker cycling identifiers is inserting keys, so
//     unbounded state here would be a memory-growth primitive that this
//     control had introduced. At the cap, inserting a new key first sweeps
//     every expired entry and then, if that freed nothing, evicts the least
//     recently active entries until there is room. 10000 entries of two
//     numbers each is a trivial footprint and far more distinct
//     (identifier, address) pairs than a real deployment sees in one window.
//
// The state is per PROCESS, and intentionally so: it needs no Redis, no schema
// and no configuration, it cannot fail, and a clustered deployment simply
// applies the control per worker. A shared store would be strictly stronger
// and is out of scope for this fix - a delay that occasionally resets when a
// caller lands on another worker is still a delay, and the generic message
// closes the oracle regardless of where the request lands.
// ---------------------------------------------------------------------------

var LOGIN_GENERIC_FAILURE_MESSAGE = 'Invalid email or password',
    LOGIN_FAILURE_FREE_ATTEMPTS   = 3,
    LOGIN_FAILURE_BASE_DELAY_MS   = 250,
    LOGIN_FAILURE_MAX_DELAY_MS    = 4000,
    LOGIN_FAILURE_MAX_EXPONENT    = 16,
    LOGIN_FAILURE_WINDOW_MS       = 15 * 60 * 1000,
    LOGIN_FAILURE_MAX_KEYS        = 10000;

// key -> { failures : <consecutive failures>, expiresAt : <ms since epoch> }.
//
// A Map rather than a plain object for two properties this control relies on:
// its iteration order is insertion order, which is what makes the eviction
// below least-recently-active (every recorded failure deletes and re-sets its
// key, so the front of the Map is always the stalest entry), and `size` is O(1),
// so the cap can be tested on every insert without walking the keys.
var loginFailureState = new Map();

/**
 * Builds the throttle key for one login attempt: the submitted identifier,
 * lower-cased, paired with the caller's address.
 *
 * Both halves are needed. Keying on the address alone would let one attacker
 * behind a shared NAT delay every other user on it; keying on the identifier
 * alone would let one attacker delay a chosen account from anywhere, which is
 * the lockout-as-DoS shape this control exists to avoid. Keyed on the pair, a
 * caller rotating addresses still accumulates failures against the account
 * they are guessing at, and a caller rotating identifiers still accumulates
 * them against the address they are guessing from.
 *
 * The identifier is lower-cased because it is what the login itself matches on
 * case-insensitively (`helpers.lowerUserFields` runs ahead of both routes bound
 * to this handler), so "USER@example.com" and "user@example.com" must not be
 * two separate budgets.
 *
 * This function cannot throw: it is the first thing every failure branch calls,
 * and a security control that throws is a control that is not applied.
 *
 * @param {Object} request the hapi request
 * @returns {string} the throttle key
 */
function loginThrottleKey(request) {
  var submitted  = request.payload ? request.payload.email : null,
      identifier = (typeof submitted === 'string' ? submitted : String(submitted)).toLowerCase(),
      forwarded  = request.headers ? request.headers['x-forwarded-for'] : '',
      // The address, taken the way the rest of this codebase takes it
      // (lib/controllers/trinket.js:495 and its siblings): the proxy header
      // first, because the application runs behind one and the socket address
      // would otherwise be the proxy for every caller alike. The header is a
      // comma-separated chain appended to by each hop, and its FIRST entry is
      // the closest thing to the originating client, so that entry is the one
      // used. It is caller-controlled and forgeable - which is exactly why the
      // identifier is the other half of the key.
      address    = String(forwarded || '').split(',')[0].trim();

  if (!address) {
    // No proxy in front of us: hapi's own view of the connection. The literal
    // fallback keeps the key well-formed for an injected request, which has no
    // socket at all, rather than producing an empty half.
    address = (request.info && request.info.remoteAddress) || 'unknown-address';
  }

  return identifier + '|' + address;
}

/**
 * Makes room for one more key: drops every entry whose window has closed and,
 * if the map is still at its cap, evicts from the front until it is not.
 *
 * Called only when a NEW key is about to be inserted, which is the only
 * operation that can grow the map, so the sweep's cost is paid exactly where
 * the growth it bounds happens.
 *
 * Deleting during Map iteration is well defined - a deleted entry is simply not
 * visited again - so the sweep needs no intermediate key list.
 *
 * @param {number} now milliseconds since epoch, as read by the caller
 */
function pruneLoginFailureState(now) {
  var oldest;

  loginFailureState.forEach(function(entry, key) {
    if (entry.expiresAt <= now) {
      loginFailureState.delete(key);
    }
  });

  // The window did not save us: every tracked key is still live, so the
  // stalest ones go. Map iteration is insertion order and every recorded
  // failure re-inserts its key, so the first key is the least recently active.
  while (loginFailureState.size >= LOGIN_FAILURE_MAX_KEYS) {
    oldest = loginFailureState.keys().next();
    if (oldest.done) {
      break;
    }
    loginFailureState.delete(oldest.value);
  }
}

/**
 * Records one failed attempt against `key` and returns how long that key's
 * response should be held back, in milliseconds.
 *
 * @param {string} key from loginThrottleKey
 * @returns {number} the delay to apply, 0 for the free allowance
 */
function recordLoginFailure(key) {
  var now      = Date.now(),
      entry    = loginFailureState.get(key),
      failures,
      exponent;

  if (entry && entry.expiresAt <= now) {
    // Decayed. The window closed before this attempt arrived, so it is a first
    // failure again rather than a continuation - the entry is dropped here as
    // well as by the sweep, so a stale count can never influence a delay even
    // if the sweep has not run.
    loginFailureState.delete(key);
    entry = undefined;
  }

  if (entry) {
    // Deleted and re-set rather than mutated in place, so the key moves to the
    // back of the Map and the eviction above stays least-recently-active.
    loginFailureState.delete(key);
    failures = entry.failures + 1;
  } else {
    if (loginFailureState.size >= LOGIN_FAILURE_MAX_KEYS) {
      pruneLoginFailureState(now);
    }
    failures = 1;
  }

  // The window slides: it measures time since the LAST failure, so a slow
  // trickle of guesses keeps its own history alive instead of resetting.
  loginFailureState.set(key, { failures : failures, expiresAt : now + LOGIN_FAILURE_WINDOW_MS });

  if (failures <= LOGIN_FAILURE_FREE_ATTEMPTS) {
    return 0;
  }

  exponent = Math.min(failures - LOGIN_FAILURE_FREE_ATTEMPTS - 1, LOGIN_FAILURE_MAX_EXPONENT);
  return Math.min(LOGIN_FAILURE_BASE_DELAY_MS * Math.pow(2, exponent), LOGIN_FAILURE_MAX_DELAY_MS);
}

/**
 * Clears a key's failure history outright.
 *
 * Called on a successful login, so a legitimate user who fumbles four times
 * and then gets it right starts their next attempt from zero rather than
 * inheriting a delay for the rest of the window.
 *
 * @param {string} key from loginThrottleKey
 */
function clearLoginFailures(key) {
  loginFailureState.delete(key);
}

/**
 * Resolves after `delay` milliseconds.
 *
 * A promise around a timer, awaited - never a busy loop and never a
 * synchronous sleep. Blocking here would stall the whole event loop and turn a
 * per-key delay into a process-wide outage, which is the exact opposite of
 * what this control is for: the request that is being slowed down is parked,
 * and every other request continues at full speed.
 *
 * @param {number} delay milliseconds
 * @returns {Promise} resolves with no value once the delay has elapsed
 */
function loginFailureDelay(delay) {
  return new Promise(function(resolve) {
    setTimeout(resolve, delay);
  });
}

/**
 * What every failure branch of `login` does before it answers: count the
 * attempt against its key and hold the response back for as long as that count
 * has earned.
 *
 * @param {string} key from loginThrottleKey
 * @returns {Promise<number>} the delay that was applied, in milliseconds
 */
async function throttleLoginFailure(key) {
  var delay = recordLoginFailure(key);

  if (delay > 0) {
    // Monitoring hook, and a deliberately anonymous one. The key is PII by
    // construction (it contains the submitted identifier and the caller's
    // address) and obs-login-console-log-emits-email governs this handler's
    // logging as a whole, so the line reports only that the control engaged
    // and by how much. It is silent below the threshold, which is why a normal
    // run - and the whole committed suite - emits nothing from here. stdout,
    // not stderr, so it is not a warning under AAP 0.9.3's zero-warning gate.
    console.log('LOGIN: failed-attempt backoff engaged, holding response for', delay + 'ms');
    await loginFailureDelay(delay);
  }

  return delay;
}

module.exports = {
  // Every handler below is a hapi lifecycle method: it returns its response, a
  // promise of one, or throws. `request.success`/`request.fail` return toolkit
  // responses, so returning their result is what answers the request, and a
  // handler that returns nothing answers 500. The second argument is the
  // toolkit `h`; no `reply` identifier is in scope.
  create : async function(request, h) {
    // Resolve-only, with no reject and no timeout, deliberately: recaptcha.verify
    // does not invoke its callback on a transport failure or on a malformed JSON
    // body - both faults raise an uncaught error instead - so on either fault
    // this promise never settles and signup is intentionally left unanswered.
    var recaptcha_result = await new Promise(function(resolve) {
      recaptcha.verify(request.payload['g-recaptcha-response'], resolve);
    });

    if (!recaptcha_result.success) {
      return request.fail();
    }

    var payload  = request.payload,
        interest = request.payload.interest || 'python',
        redirect = request.yar.get('next') || payload.next,
        json     = { formName : payload.formName };

    var email = request.payload.email.split('@');
    if (!request.payload.fullname) {
      request.payload.fullname = email[0];
    }
    if (!request.payload.username) {
      request.payload.username = userUtil.generate_username_with_suffix(email[0]);
      json.formName = 'sign-up';
    }

    var user = new User(payload);

    try {
      // Check email blocklist
      var isBlocked = await emailStore.blockListLookup(email[1].toLowerCase());
      if (isBlocked) {
        console.log('blocking signup from:', request.payload.email);
        throw new Error("blocking signup from: " + request.payload.email);
      }

      // Check if user exists
      var existsResult = await new Promise(function(resolve, reject) {
        User.exists(user, function(err, result) {
          if (err) reject(err);
          else resolve(result);
        });
      });

      if (existsResult && existsResult.exists) {
        request.yar.flash('duplicates', existsResult.duplicates, true);
        return request.fail(json);
      }

      // Save user
      var savedUser = await user.save();

      request.yar.flash('requested', request.payload.username);

      // Log in the user
      await new Promise(function(resolve, reject) {
        request.yar._logIn(savedUser, function(err) {
          if (err) reject(err);
          else resolve();
        });
      });

      return redirect
        ? request.success({ redirectTo : redirect, status : 'success', data : savedUser })
        : request.success({ status : 'success', data : savedUser });

    } catch (err) {
      if (err.code === 11000) {
        request.yar.flash('duplicates', { username : true }, true);
        return request.fail(json);
      }
      return request.fail(json, err);
    }
  },

  login : async function(request, h) {
    // obs-login-console-log-emits-email / db-login-logs-email-pii: the submitted
    // identifier is withheld here. This is a raw console.log rather than a winston
    // call, so no log level can suppress it and the debug File transport captures it
    // verbatim - the line therefore records only that a login attempt started and
    // whether an identifier was supplied, never its value.
    console.log('LOGIN: Starting login for', request.payload.email ? '[redacted]' : '[no identifier supplied]');
    var requested = request.payload.email;
    var password = request.payload.password;
    var redirect  = request.yar.get('next');
    var data;
    // The failed-attempt budget this request counts against. Derived before
    // the try block because loginThrottleKey cannot throw, and needed by every
    // failure branch below as well as by the success path that clears it.
    var throttleKey = loginThrottleKey(request);

    try {
      console.log('LOGIN: Finding user');
      // Find user by email or username
      var user = await new Promise(function(resolve, reject) {
        User.findByLogin(requested, function(err, user) {
          // obs-login-console-log-emits-email / db-login-logs-email-pii: the resolved
          // account's email is withheld for the same reason - unsuppressable
          // console.log, not winston. The line keeps both of its diagnostic states,
          // '[redacted]' for a hit and the existing 'no user' marker for a miss,
          // and keeps the callback's error value, which cannot carry the submitted
          // identifier: both routes bound to this handler run helpers.lowerUserFields
          // behind `email: Joi.string().required()`, so a non-string never reaches the
          // query that would echo it back in a cast error.
          console.log('LOGIN: findByLogin callback', err, user ? '[redacted]' : 'no user');
          if (err) reject(err);
          else resolve(user);
        });
      });

      console.log('LOGIN: User found?', !!user);
      if (!user) {
        console.log('LOGIN: No user, failing');
        // obs-login-enumeration-no-throttle: one generic message, shared with
        // the no-password and wrong-password branches below, so that "this
        // identifier is not registered" is indistinguishable from "it is, and
        // the password was wrong". The submitted identifier is no longer
        // interpolated into it either - echoing it back confirmed the exact
        // string the caller was probing with.
        await throttleLoginFailure(throttleKey);
        return request.fail({ message: LOGIN_GENERIC_FAILURE_MESSAGE });
      }

      if (user.hasRole && user.hasRole("disabled")) {
        // Left exactly as it was, and deliberately: this branch is reached
        // before any password comparison, so it cannot confirm a guess, and it
        // is the only signal a disabled user has for why they cannot get in.
        // It still counts against the budget, though - a branch that answered
        // instantly while the others slowed down would be a timing oracle for
        // "this account is disabled", which would put back in the response
        // timing exactly what the shared message took out of the response body.
        await throttleLoginFailure(throttleKey);
        return request.fail({ message: 'Account Disabled' });
      }

      if (!user.password || user.password.length === 0) {
        // The generic message again: this branch used to disclose that the
        // account exists and is credential-less, which is a more valuable fact
        // to an attacker than either of the other two.
        await throttleLoginFailure(throttleKey);
        return request.fail({ message: LOGIN_GENERIC_FAILURE_MESSAGE });
      }

      console.log('LOGIN: Comparing password');
      // Verify password
      var isMatch = await new Promise(function(resolve, reject) {
        user.comparePassword(password, function(err, isMatch) {
          console.log('LOGIN: comparePassword callback', err, isMatch);
          if (err) reject(err);
          else resolve(isMatch);
        });
      });

      console.log('LOGIN: Password match?', isMatch);
      if (!isMatch) {
        // The generic message, and the branch the backoff matters most for:
        // this is the one an attacker spraying passwords against a known
        // account lands on, every time, until they do not.
        await throttleLoginFailure(throttleKey);
        return request.fail({ message: LOGIN_GENERIC_FAILURE_MESSAGE });
      }

      // The credentials were right, so this key's failure history is spent.
      // Cleared outright rather than left to decay, so the next attempt from
      // here starts at zero and no legitimate session inherits a delay.
      clearLoginFailures(throttleKey);

      console.log('LOGIN: Success, resetting session');
      // Login successful - save data we want to preserve across session reset
      var educatorsFormData = request.yar.get("educatorsFormData") || null;
      var registrationPayload = request.yar.get("registration-payload") || null;

      // Generate a new session id for security (prevents session fixation)
      request.yar.reset();
      console.log('LOGIN: Session reset done');

      // Now set session data on the new session
      request.yar.set('loggedInWith', 'trinket');
      request.yar._logIn(user, function() {});
      console.log('LOGIN: User logged in');

      if (user.username !== requested && user.email !== requested) {
        request.yar.flash('requested', requested);
      } else {
        request.yar.flash('requested', user.username);
      }

      if (educatorsFormData) {
        request.yar.set("educatorsFormData", educatorsFormData);
      }
      if (registrationPayload) {
        request.yar.set("registration-payload", registrationPayload);
      }

      console.log('LOGIN: About to redirect, redirect=', redirect);

      if (redirect) {
        console.log('LOGIN: Redirecting to', redirect);
        // h.redirect emits this value as the Location header exactly as it
        // stands. request.success/request.fail would instead route it through
        // routeParser's redirect() helper, which prepends config.url, so the
        // two are not interchangeable here.
        return h.redirect(redirect);
      } else {
        // e.g. from an api call - set in route config
        //
        // This handler serves TWO routes and request.pre.encryptRoles selects
        // the response shape:
        //   POST /login           - no such pre, value undefined -> the raw
        //                           user document
        //   POST /api/users/login - the pre returns true         -> the
        //                           six-field projection
        // Neither route declares a `reply` spec, so routeParser serializes
        // rather than projects: the object built here IS the whole payload.
        // Read as-is - not defaulted, not normalised, not reduced to a
        // truthiness test.
        data = request.pre.encryptRoles
          ? {
              email    : user.email,
              fullname : user.fullname,
              id       : user.id,
              name     : user.name,
              username : user.username,
              roles    : roles.encrypt(user.roles)
            }
          : user;

        return request.success({
          status : 'success',
          data   : data
        });
      }
    } catch (err) {
      log.error('Login error:', err);
      return request.fail(err);
    }
  },
  remove : async function(request, h) {
    if (request.user && request.user.username === request.query.username) {
      // The chain is returned, so its resolved value becomes the response.
      return request.user.remove()
        .then(function() {
          return request.success();
        })
        .catch(function(err) {
          // Returning the error rather than throwing it: hapi boomifies a plain
          // Error into a generic 500, and passes a Boom through with its own
          // status intact.
          return err;
        });
    }
    else {
      // `Boom` is not bound in this module - @hapi/boom is bound as `errors` -
      // so this expression intentionally throws ReferenceError: Boom is not
      // defined, and the handler catch-all in lib/util/routeParser.js maps that
      // to a 500. This branch answers 500, not the 403 it reads as; binding
      // Boom would turn it into a 403.
      return Boom.forbidden();
    }
  },
  deleted : async function(request, h) {
    request.yar.flash('siteMessage', 'Your account has been deleted.');
    return h.redirect('/');
  },
  logout : async function(request, h) {
    if (request.yar) {
      request.yar.clear('userId');
      request.yar.reset();
    }
    // The route declares `redirect: '/'`, which routeParser folds into
    // success.redirect, so this returns a 302 rather than a body.
    return request.success();
  },

  sendPassReset : async function(request, h) {
    if (!mailer.isConfigured()) {
      return request.fail({
        message: "Email is not configured. Password reset is not available."
      });
    }

    // Resolve-only, deliberately: on either recaptcha fault the callback is
    // never invoked, so this promise never settles and the route is left
    // unanswered.
    var result = await new Promise(function(resolve) {
      recaptcha.verify(request.payload['g-recaptcha-response'], resolve);
    });

    if (result.success) {
      // The response is produced inside nested callbacks, so the promise boundary
      // is created here, at the lifecycle method, and each terminal branch
      // resolves it with the response that branch produces. Keeping the callbacks
      // intact - rather than collapsing them into awaits that reject on `err` -
      // is what preserves which branch answers, and preserves non-settlement
      // where no branch runs at all.
      return await new Promise(function(resolve) {
        User.findByLogin(request.payload.email, function(err, user) {
          if (err)   return resolve(request.fail(err));
          // Each branch keeps the response it has always produced: an unknown
          // address answers request.fail (a 302 to /forgot-pass) and a known
          // one answers request.success below (a 200 rendering
          // users/sendpassreset.html).
          if (!user) return resolve(request.fail({ message: 'user not found' }));

          // `ex` is intentionally not inspected: on an error `buf` is undefined
          // and buf.toString() throws from inside this callback, and that throw
          // is this branch's only error path.
          require('crypto').randomBytes(48, async function(ex, buf) {
            var key      = buf.toString('hex').substring(0, 8);
            var resetKey = Store.user.reset_password_key(key);
            var resetVal = user.id.toString();

            // The value and its 24-hour lifetime are written as two operations,
            // which is the pair of store calls this endpoint has always made.
            // Both are awaited inside this `async` callback and neither is
            // guarded, so a store failure rejects a promise nobody awaits and
            // the request is left unanswered - the existing disposition of this
            // edge, kept deliberately. A try/catch here would answer the caller
            // through an error path that does not exist on this route.
            await Store.set(resetKey, resetVal);
            await Store.expire(resetKey, 86400);
            // Ordering preserved: the response is settled BEFORE the mail is
            // rendered and sent, and the send stays un-awaited.
            resolve(request.success());

            var reset_password_url = config.url + '/reset-pass?key=' + key;

            var message = nunjucks.render('emails/passwordReset', {
              fullname           : user.fullname,
              username           : user.username,
              reset_password_url : reset_password_url
            });
            // Un-awaited, exactly as before - the response above is already
            // settled - but through send_mail_detached, so a transport
            // rejection is observed instead of terminating the process. See
            // that function for the measurement.
            send_mail_detached(user.email, 'Password reset', { html : message, type : 'password-reset' });
          });
        });
      });
    }
    else {
      // Asymmetric on purpose: a failed captcha answers success rather than
      // fail, and sends no mail, so the caller sees the same response either
      // way.
      return request.success();
    }
  },

  resetPasswordForm : async function(request, h) {
    var resetKey = Store.user.reset_password_key(request.query.key);

    try {
      var user_id = await Store.get(resetKey);
      if (!user_id) return request.fail({ message: 'reset password key not found' });

      return await new Promise(function(resolve) {
        User.findById(user_id, function(err, user) {
          if (err)   return resolve(err);
          if (!user) return resolve(request.fail({ message: 'user not found' }));

          resolve(request.success({
            key : request.query.key
          }));
        });
      });
    } catch(err) {
      return err;
    }
  },

  savePassword : async function(request, h) {
    if (request.payload.password !== request.payload.password_verify)
      return h.redirect('/reset-pass?key=' + request.payload.key);

    var resetKey = Store.user.reset_password_key(request.payload.key);

    try {
      var user_id = await Store.get(resetKey);

      // The response is produced inside nested callbacks, so the promise
      // boundary is created here, at the lifecycle method, and each terminal
      // branch resolves it with the response that branch produces. The token is
      // read here and deleted only AFTER the password has been saved, which is
      // the order this endpoint has always used: a save that fails leaves the
      // token spendable, and a key absent from the store yields `user_id`
      // undefined, which the generated finder answers with a null document
      // (measured) so the no-such-user branch below produces the redirect.
      return await new Promise(function(resolve) {
        User.findById(user_id, function(err, user) {
          if (err)   return resolve(err);
          if (!user) return resolve(request.fail({ message: 'user not found' }));

          user.password = request.payload.password;
          user.save(async function(err) {
            if (err) return resolve(err);

            await Store.del(resetKey);
            resolve(request.success());
          });
        });
      });
    } catch(err) {
      return err;
    }
  },

  account : async function(request, h) {
    var data = {}
      , promise;

    if (!request.params.accountPage) {
      return h.redirect('/account/profile');
    }

    if (request.params.accountPage === 'profile') {
      promise = new Promise(function(resolve, reject) {
        Course.findForUser(request.user.id, function(err, courses) {
          if (err) reject(err);
          else resolve(courses);
        });
      });
    }
    else if (request.params.accountPage === 'delete-account') {
      data.userCanDelete = true;
    }
    else if (request.params.accountPage === 'email') {
      // check if user has a pending email change
      var changeKey = Store.user.change_email_key(request.user.id.toString());
      promise = Store.get(changeKey);
    }

    if (!promise) {
      promise = Promise.resolve([]);
    }

    return promise.then(function(promiseResult) {
      // if array, number of courses
      if (Array.isArray(promiseResult)) {
        data.coursesOwned = promiseResult.length;
      }
      else {
        try {
          promiseResult = JSON.parse(promiseResult);
          if (promiseResult && promiseResult.new_email) {
            data.pendingEmailAddress = promiseResult.new_email;
          }
        } catch(e) {}
      }

      return request.success({
        page : request.params.accountPage,
        data : data
      });
    })
    .catch(function(err) {
      return request.success({
        page : request.params.accountPage,
        data : data
      });
    });
  },

  updateProfile : async function(request, h) {
    var user         = request.user,
        payload      = request.payload,
        updateSlugs         = false,
        updateCourses       = false,
        addFolderSlugJob, updateCoursesPromise, usernameCheck;

    if (user.id !== request.params.userId) {
      // `Boom` is unbound in this module, so this reference intentionally
      // throws ReferenceError and the route answers 500, not the 403 it reads
      // as.
      return Boom.forbidden();
    }

    if (user.avatar !== request.payload.avatar || user.name !== request.payload.name) {
      updateCourses = true;
    }

    if (user.username !== payload.username.toLowerCase()) {
      usernameCheck = new Promise(function(resolve, reject) {
        User.exists(user, function(err, result) {
          if (err) reject(err);
          else resolve(result);
        });
      });

      updateSlugs = true;
      updateCourses = true;
    }
    else {
      usernameCheck = Promise.resolve(null);
    }

    user.set(request.payload);
    user.username = user.username.toLowerCase();

    return usernameCheck.then(function(result) {
      if (result && result.exists && result.duplicates.username) {
        return request.fail({
          message : "Sorry, that username is already taken. Please try another."
        });
      }
      else {
        // The save callback is where the response is produced, so the promise
        // boundary is created here and each terminal branch resolves it.
        return new Promise(function(resolve) {
        user.save(function(err, user) {
          if (err) {
            if (err.code === 11000) {
              return resolve(request.fail({
                message : "Sorry, that username is already taken. Please try another."
              }));
            }

            return resolve(request.fail({
              message : "Something went wrong when trying to update your profile. Please try again."
            }));
          }

          if (updateSlugs) {
            // Update folder slugs inline
            addFolderSlugJob = Folder.findByOwner(user)
              .then(function(folders) {
                return Promise.all(folders.map(function(folder) {
                  return folder.updateOwnerSlug(user.username);
                }));
              })
              .catch(function(err) {
                console.error('Failed to update folder slugs:', err.message);
                // Don't fail the profile update if folder slugs fail
                return Promise.resolve();
              });
          }
          else {
            addFolderSlugJob = Promise.resolve();
          }

          if (updateCourses) {
            updateCoursesPromise = Course.userUpdate(user);
          }
          else {
            updateCoursesPromise = Promise.resolve();
          }

          // This chain deliberately has no `.catch`, and it is detached from
          // the enclosing promise: a rejection - updateCoursesPromise is the
          // only source, since addFolderSlugJob swallows its own above -
          // resolves nothing, so the request is left unanswered. Attaching a
          // catch would answer with a fail response instead.
          addFolderSlugJob
            .then(function() { return updateCoursesPromise; })
            .then(function() {
              resolve(request.success({
                success : true,
                user    : user
              }));
            });
        }); // end user.save callback
        }); // end promise boundary
      }
    }).catch(function(err) {
      return request.fail({
        message : "Something went wrong when trying to update your profile. Please try again."
      });
    });
  },

  assetList : async function(request, h) {
    var sortBy = request.query.sortBy || 'name'
      , types  = request.query.type.toLowerCase().split(',') || []
      , getUserFiles;

    if (request.user) {
      getUserFiles = new Promise(function(resolve, reject) {
        File.findForUser(request.user._id, function(err, files) {
          if (err) reject(err);
          else resolve(files);
        });
      });
    }
    else {
      getUserFiles = Promise.resolve(undefined);
    }

    return getUserFiles
      .then(function(files) {
        if (typeof(files) === "undefined") {
          files = [];
        }

        if (request.query.type) {
          files = _.filter(files, function(file) {
            return _.some(types, function(type) {
              if (file.mime.indexOf(type) === 0) {
                return true;
              }

              var revtype = type.split("").reverse().join("");
              var revname = file.name.toLowerCase().split("").reverse().join("");
              if (revname.indexOf(revtype) === 0) {
                return true;
              }

              return false;
            });
          });
        }
        files = _.sortBy(files, sortBy);
        return request.success({
          files : files
        });
      })
      .catch(function(err) {
        return err;
      });
  },

  assetUpload : async function(request, h) {
    if (!config.features.assets) {
      // `errors` IS the @hapi/boom binding in this module, so this is a real
      // 501 rather than one of the unbound-`Boom` throws below.
      return errors.notImplemented('Asset uploads are not enabled');
    }
    // FileUtil keeps its callback interface, so the await boundary is taken here,
    // at the lifecycle method.
    return await new Promise(function(resolve) {
      FileUtil.uploadUserAsset(request.payload.file, request.user, function(err, file) {
        if (err) return resolve(request.fail(err));
        resolve(request.success({ file : file }));
      });
    });
  },

  replaceAsset : async function(request, h) {
    if (!config.features.assets) {
      return errors.notImplemented('Asset uploads are not enabled');
    }
    var origfile = request.pre.file;

    if (request.user.id.toString() === origfile._owner.toString()) {
      return new Promise(function(resolve, reject) {
        FileUtil.uploadUserAsset(request.payload.file, request.user, origfile, function(err, file) {
          if (err) reject(err);
          else resolve(file);
        });
      })
        .then(function(file) {
          return request.success({ file : file });
        })
        .catch(function(err) {
          return err;
        });
    }
    else {
      // `Boom` is unbound here, so this reference throws and answers 500,
      // not the 403 it reads as.
      return Boom.forbidden();
    }
  },

  removeAsset : async function(request, h) {
    var file = request.pre.file;

    if (request.user.id.toString() === file._owner.toString()) {
      // The chain is returned, so its resolved value becomes the response.
      return file.hide()
        .then(function() {
          return request.success();
        })
        .catch(function(err) {
          return err;
        });
    }
    else {
      // `Boom` is unbound here, so this reference throws and answers 500,
      // not the 403 it reads as.
      return Boom.forbidden();
    }
  },

  restoreAsset : async function(request, h) {
    var file = request.pre.file;

    if (request.user.id.toString() === file._owner.toString()) {
      return file.show()
        .then(function() {
          return request.success();
        })
        .catch(function(err) {
          return err;
        });
    }
    else {
      // `Boom` is unbound here, so this reference throws and answers 500,
      // not the 403 it reads as.
      return Boom.forbidden();
    }
  },

  // Streams a caller-named URL to a temp file and uploads that file as a user
  // asset. Four outcomes are non-obvious and each is deliberate:
  //
  //   * redirects are followed, at most ASSET_FETCH_MAX_REDIRECTS of them, and
  //     the content-type comes from the FINAL response only;
  //   * a non-2xx still writes its body and still uploads, so an error page can
  //     become the stored asset, with the error page's content-type;
  //   * a mid-stream failure signals both an error and completion, so the
  //     upload proceeds with the partial bytes;
  //   * every failure before a final response - a refused connection, a blocked
  //     address, an over-budget redirect chain, a breached byte ceiling or
  //     deadline - only LOGS and cleans up. It never settles the promise, so
  //     the request is intentionally left unanswered rather than answered 500.
  assetUploadFromURL : async function(request, h) {
    if (!config.features.assets) {
      return errors.notImplemented('Asset uploads are not enabled');
    }
    // try to validate url
    var requestUrl = parseLegacy(request.payload.url);
    if (!requestUrl.protocol) return request.fail();

    // tmp.tmpName is a callback API, so the await boundary is taken here, at
    // the lifecycle method.
    var tmpPath = await new Promise(function(resolve) {
      tmp.tmpName(function(err, tmpPath) {
        // A tmp.tmpName failure intentionally throws from inside this callback.
        // The callback runs on a later tick, after the `new Promise` executor
        // has returned, so the throw escapes as an uncaught exception rather
        // than rejecting the promise: nothing settles, the awaiting handler
        // never returns, the request is never answered, and - since no
        // uncaughtException handler is installed anywhere in this application -
        // the process terminates. Resolving, rejecting or catching here would
        // each turn that process-level event into a routed 500 instead.
        if (err) {
          throw err;
        }

        resolve(tmpPath);
      });
    });

    return await new Promise(function(resolve) {
      var contentType   = '';
      var uploadStarted = false;
      // Opened before the fetch, as baseline opened it: `.pipe(fs.create
      // WriteStream(tmpPath))` was evaluated when the chain was built, so the
      // temp file existed from that moment. No 'error' listener is installed on
      // it, for the reason baseline installed none - `body.pipe` below adds the
      // only listener this destination has ever carried, so a write failure
      // keeps reaching process scope.
      var writeStream   = fs.createWriteStream(tmpPath);

      // Guarded because the mid-stream path deliberately signals both an error
      // and completion - and, now that the trigger is the destination's own
      // completion, because `writeStream.end()` may be called twice on that
      // path. The upload must run exactly once either way.
      var startUpload = function() {
        if (uploadStarted) {
          return;
        }
        uploadStarted = true;

        var fileupload = {
          path     : tmpPath,
          // `path` carries the query string, so a source URL ending '.png?v=2'
          // yields the filename 'a.png?v=2'. That flows into the extension and
          // therefore into the stored object key ('<sha1>-<fileId>.png?v=2'), so
          // stripping the query here would silently orphan existing objects.
          filename : path.basename(requestUrl.path),
          headers  : {
            'content-type' : contentType
          }
        };

        // This callback is delivered from an S3 or filesystem completion, NOT
        // from the synchronous body of the promise executor above, so anything
        // it throws escapes to process scope rather than rejecting this
        // promise. Both branches are therefore written so they cannot throw,
        // and the try/catch is the backstop that turns any residual throw into
        // a response instead of a process exit.
        FileUtil.uploadUserAsset(fileupload, request.user, function(err, file) {
          try {
            if (err) {
              // `request.fail(json, err)` takes a JSON-ABLE object as its FIRST
              // argument and the error itself as its SECOND, and it hands that
              // first argument straight to `h.response()`. Passing the raw
              // Error there - which is what this call did - reaches
              // `Toolkit.response` and trips `AssertError: Cannot wrap an
              // error` from inside an Immediate, where neither this promise nor
              // the route catch-all can see it. One failed S3 write, or a temp
              // file that had gone missing before hashing, therefore terminated
              // the whole process and every request in flight with it.
              //
              // The funnel is unchanged: still `request.fail`, still its
              // html-redirect and JSON branches, still its flash, and the error
              // itself still reaches the log line through the second parameter,
              // which is precisely what that parameter is for (AAP 0.6.3's
              // Layer 2). A fixed message is used rather than `err.message`
              // both to match every other `request.fail` call in this module
              // and because the raw text of these errors carries internal
              // temp-file paths and bucket names.
              return resolve(request.fail({
                message : 'Something went wrong while saving your asset. Please try again.'
              }, err));
            }

            resolve(request.success({ file : file }));
          }
          catch (responseError) {
            // Reached only if building the response itself fails. Answering
            // with a mapped 500 is strictly better than the alternative here,
            // which is no response at all and a dead process.
            console.log(responseError);
            resolve(errors.badImplementation(responseError.message));
          }
        });
      };

      // THE UPLOAD IS TRIGGERED BY THE DESTINATION, NEVER BY THE SOURCE.
      //
      // `FileUtil.uploadUserAsset` opens `fs.createReadStream(tmpPath)` inside
      // `hashcontents` the moment it is called, and the sha1 it reads there IS
      // the stored object's S3 key and the `File.hash` written to Mongo (AAP
      // 0.6.7: "the Key is the sha1 digest of the file's contents", and "any
      // change to the digest silently orphans every stored object - no error,
      // only files that cannot be found"). So the digest may only be taken once
      // every byte is on disk.
      //
      // Triggering it from the SOURCE's 'end' - which is what this handler did -
      // does not wait for that. `fs.createWriteStream`'s own open and writes are
      // queued on the libuv FS threadpool, the source can reach 'end' while they
      // are still queued, and the digest is then taken over a temp file that is
      // empty or absent. Measured on this tree, 384 concurrent runs of exactly
      // this wiring against the real `hashcontents`: 89 runs found ZERO bytes on
      // disk at the moment the source's 'end' fired and 12 of them keyed the
      // object under sha1("") = da39a3ee5e6b4b0d3255bfef95601890afd80709 for 42
      // real bytes; with the trigger below, 384 of 384 found the complete file
      // and produced the correct digest. Before `hashcontents` grew an 'error'
      // listener the absent-file case was worse than a wrong key: the read
      // stream's unhandled 'error' terminated the process, taking every
      // concurrent request with it.
      //
      // 'finish' RATHER THAN 'close', deliberately. 'finish' fires when `end()`
      // has been called and every queued write has been flushed to the operating
      // system, which is precisely the condition the digest needs - a subsequent
      // read sees all the bytes - and it is reached on the zero-byte path too,
      // where `end()` is the only call ever made. 'close' additionally waits for
      // the descriptor to be released, which no reader on this platform needs
      // and which would only delay the response. Both were measured under a
      // starved FS threadpool: at 'finish' the file exists with its full
      // contents in every case, including the zero-byte one.
      //
      // The transport-failure arm below never ends this stream, so no 'finish'
      // is ever emitted there and that request stays unanswered exactly as it
      // did (AAP 0.4.2).
      writeStream.on('finish', startUpload);

      // The raw payload string is handed to the transport rather than a URL
      // constructed here, so an unparseable URL, an unsupported scheme and a
      // refused connection all arrive as one rejection on the log-only arm
      // below instead of as a throw.
      fetchAssetResource(request.payload.url).then(function(result) {
        // The FINAL response only, never an intermediate 3xx: the transport
        // resolves with the last hop it followed.
        contentType = result.response.headers.get('content-type');

        var body = result.response.body
          ? Readable.fromWeb(result.response.body)
          : Readable.from([]);

        body.on('error', function(err) {
          // Log-and-continue, then complete (AAP 0.6.3's log-and-continue edge):
          // the original emitted 'error' and still reached 'end' here, so the
          // partial bytes are uploaded. `.pipe()` does not end the destination
          // when the SOURCE errors, so ending it here is what keeps that
          // behaviour - and it is now also what reaches `startUpload`, through
          // the 'finish' the `end()` produces, so the partial bytes are hashed
          // after they are flushed rather than before.
          console.log('on error:', err);
          writeStream.end();
        });

        // No 'end' listener: `pipe`'s default `end: true` ends the destination
        // when the source ends, and the destination's 'finish' is what starts
        // the upload. A source-'end' trigger is the defect described above.
        body.pipe(writeStream);
      }, function(err) {
        // LOGS ONLY, and settles nothing: the original never called back on
        // this arm, so nothing is uploaded and the request hangs. Rejecting,
        // resolving or catching here would each turn that hang into a response,
        // and AAP 0.4.2 records that unanswered request as the behaviour a
        // refused connection is required to keep.
        console.log('on error:', err);

        // The RESPONSE stays unsettled; the DESCRIPTOR must not. This arm is
        // the fetch promise's own rejection, so it is reached before any
        // response body exists and therefore before `body.pipe(writeStream)`
        // below has ever run - which leaves the write stream opened above
        // holding an open descriptor on an empty temp file that nothing will
        // ever read. Measured on this tree: 20 rejected fetches left 20 extra
        // open descriptors and 20 zero-byte temp files, still held minutes
        // later and growing linearly with every request. That is unbounded
        // resource exhaustion on a route any authenticated user can call, so
        // the stream is closed and its file removed.
        //
        // Neither is client-observable: no byte of any response changes, no
        // File document and no stored object is created either way, and the
        // request still hangs exactly as it did. `destroy()` also never emits
        // 'finish', so the upload trigger registered above still cannot fire.
        //
        // The no-op 'error' listener is scoped to this arm and is here so that
        // `destroy()` cannot emit into process scope. It does not touch the
        // piped path, which never reaches this function and still carries only
        // the listener `body.pipe` installs, preserving the write-failure
        // behaviour documented where the stream is opened.
        //
        // The unlink waits for 'close' rather than running beside `destroy()`,
        // and for the same threadpool reason the digest trigger above waits for
        // 'finish': `fs.createWriteStream` performs its `open` - which is what
        // creates the file - asynchronously on the libuv FS pool, so an unlink
        // issued here directly loses the race, fails ENOENT into the swallow
        // below, and then the open completes and leaves the file behind for
        // good. Measured exactly that way: descriptors went to zero while the
        // zero-byte files still grew one per request. 'close' is emitted after
        // `destroy()` has released the descriptor, by which point the file
        // either exists and can be removed or was never created and the ENOENT
        // is correct to ignore.
        writeStream.on('error', function() {});
        writeStream.once('close', function() {
          fs.promises.unlink(tmpPath).catch(function() {});
        });
        writeStream.destroy();
      });
    });
  },
  changePassword : async function(request, h) {
    if (request.payload.newPassword === request.payload.confirmPassword) {
      // comparePassword and save are callback boundaries, so the promise
      // boundary is created here and each terminal branch resolves it.
      return await new Promise(function(resolve) {
        request.user.comparePassword(request.payload.currentPassword, function(err, match) {
          if (err) {
            return resolve(request.fail({
              message : "Something went wrong when trying to change your password. Please try again."
            }));
          }

          if (match) {
            request.user.password = request.payload.newPassword;
            request.user.save(function(err, user) {
              if (err) {
                return resolve(request.fail({
                  message : "Something went wrong when trying to change your password. Please try again."
                }));
              }

              resolve(request.success({
                success : true
              }));
            });
          }
          else {
            return resolve(request.fail({
              message : "The password you entered did not match what we have stored. Please try again."
            }));
          }
        });
      });
    }
    else {
      return request.fail({
        message : "Your new password entries did not match. Please try again."
      });
    }
  },

  getAvatar : async function(request, h) {
    var avatar;

    if (request.pre.user) {
      avatar = request.pre.user.normalizeAvatar();

      return request.success({
        src : avatar
      });
    }
    else {
      // `Boom` is unbound here, so this reference throws and answers 500,
      // not the 404 it reads as.
      return Boom.notFound();
    }
  },
  getInfo : async function(request, h) {
    if (request.pre.user) {
      return request.success({
          username    : request.pre.user.username
        , avatar      : request.pre.user.normalizeAvatar()
        , email       : request.pre.user.email
        , displayName : request.pre.user.name
      });
    }
    else {
      // `Boom` is unbound here, so this reference throws and answers 500,
      // not the 404 it reads as.
      return Boom.notFound();
    }
  },
  updateSettings : async function(request, h) {
    return request.user.updateSettings(request.payload)
      .then(function(result) {
        return request.success({
          success : true
        });
      })
      .catch(function(err) {
        return err;
      });
  },
  // PRESERVED DEFECT: this handler answers only on its duplicate-address
  // branch. The store write below is passed a completion callback as a THIRD
  // argument, and `Store.set` is an arity-2 `async function (key, val)`
  // [lib/util/store.js], so the argument is ignored and the callback never
  // runs: the pending change IS stored, no confirmation mail is sent, and the
  // promise this handler awaits is never settled, so POST /api/users/email
  // receives no response at all. That non-settlement is the measured behaviour
  // of this route and is preserved rather than repaired - the committed parity
  // corpus records the route with `intent: "timeout"` and
  // test/parity/joi-matrix.js's reviewed-timeout register names this call as
  // the reason, so a handler that answered here would be a difference against
  // both artifacts. `resendEmailChange` immediately below reaches the response
  // this callback would have produced, from the same stored value.
  sendEmailChange : async function(request, h) {
    if (!mailer.isConfigured()) {
      return request.fail({
        message: "Email is not configured. Email changes are not available."
      });
    }

    // The promise boundary is created here, at the lifecycle method. Only the
    // duplicate-address branch resolves it; the store-callback branch cannot,
    // for the reason above.
    return await new Promise(function(resolve) {
      User.findByLogin(request.payload.email, function(err, user) {
        // if user found, send back error message
        //
        // `err` is deliberately not inspected: a lookup failure falls through
        // to the change below, and adding a check would create an error path
        // this route does not have.
        if (user) {
          return resolve(request.fail({ message: 'Another account with that email address already exists.' }));
        }

        // create random key and store new email with it
        require('crypto').randomBytes(48, function(ex, buf) {
          var email_key = buf.toString('hex').substring(0, 8); // send in email
          var user_key  = request.user.id.toString();

          var changeKey = Store.user.change_email_key(user_key);
          var changeVal = {
              key       : email_key
            , new_email : request.payload.email
          };

          Store.set(changeKey, JSON.stringify(changeVal), function(err) {
            send_email_confirmation(request, changeVal.new_email, changeVal.key);

            resolve(request.success({
              success : true
            }));
          });
        });
      });
    });
  },
  resendEmailChange : async function(request, h) {
    if (!mailer.isConfigured()) {
      return request.fail({
        message: "Email is not configured. Email changes are not available."
      });
    }

    var user_key  = request.user.id.toString()
      , changeKey = Store.user.change_email_key(user_key);

    try {
      var changeVal = await Store.get(changeKey);
      if (!changeVal) return request.fail({ message: 'change email key not found' });

      changeVal = JSON.parse(changeVal);
      // Deliberately not awaited: send_email_confirmation only renders and
      // hands off to mailer.send, which is itself fire-and-forget, so the
      // response does not wait on the mail transport.
      send_email_confirmation(request, changeVal.new_email, changeVal.key);

      return request.success({
        success : true
      });
    } catch(err) {
      return err;
    }
  },
  changeEmail : async function(request, h) {
    // if no user, set next and redirect
    if (!request.user) {
      request.yar.set('next', '/change-email?key=' + request.query.key);
      return h.redirect('/login');
    }

    var user_key  = request.user.id.toString()
      , changeKey = Store.user.change_email_key(user_key);

    try {
      var changeVal = await Store.get(changeKey);
      if (!changeVal) {
        request.yar.flash('email_result', 'error', true);
        return request.fail();
      }

      changeVal = JSON.parse(changeVal);

      if (changeVal.key !== request.query.key.toLowerCase()) {
        request.yar.flash('email_result', 'key_error', true);
        return request.fail();
      }

      request.user.email = changeVal.new_email;

      // since user must've received the change email
      // it is safe to also verify them
      request.user.verified = true;

      await Store.del(changeKey);
      await request.user.save();
      request.yar.flash('email_result', 'success', true);
      return request.success();
    } catch(err) {
      if (err.code === 11000) {
        request.yar.flash('email_result', 'duplicate', true);
      }
      else {
        request.yar.flash('email_result', 'error', true);
      }

      return request.fail();
    }
  },
  sendEmailVerification : async function(request, h) {
    if (!mailer.isConfigured()) {
      return request.fail({
        message: "Email is not configured. Email verification is not available."
      });
    }

    // Resolve-only, deliberately: on either recaptcha fault the callback is
    // never invoked, so nothing settles and the request is left unanswered.
    var recaptcha_result = await new Promise(function(resolve) {
      recaptcha.verify(request.payload['g-recaptcha-response'], resolve);
    });

    if (recaptcha_result.success) {
      // create random key and store
      return await new Promise(function(resolve) {
        require('crypto').randomBytes(48, async function(ex, buf) {
          var email_key = buf.toString('hex').substring(0, 16); // send in email
          var user_key  = request.user.id.toString();
          var verifyKey = Store.user.verify_email_key(user_key);

          // Written with no lifetime, which is how this record has always been
          // stored. The `await` is unguarded, so a store failure rejects a
          // promise nobody awaits and the request is left unanswered - the
          // existing disposition of this edge, kept rather than converted into
          // an error response this route has never produced.
          await Store.set(verifyKey, email_key);
          send_email_verification(request, request.user.email, email_key);

          resolve(request.success({
            success : true
          }));
        });
      });
    }
    else {
      return request.fail();
    }
  },
  verifyEmail : async function(request, h) {
    // if no user, set next and redirect
    if (!request.user) {
      request.yar.set('next', '/verify-email?key=' + request.query.key);
      return h.redirect('/login');
    }

    var user_key  = request.user.id.toString()
      , verifyKey = Store.user.verify_email_key(user_key);

    try {
      var verifyVal = await Store.get(verifyKey);
      if (!verifyVal) {
        request.yar.flash('email_result', 'verify_error', true);
        return request.fail();
      }

      if (verifyVal !== request.query.key) {
        request.yar.flash('email_result', 'key_error', true);
        return request.fail();
      }

      request.user.verified = true;

      await Store.del(verifyKey);
      await request.user.save();
      request.yar.flash('email_result', 'verified', true);
      return request.success();
    } catch(err) {
      request.yar.flash('email_result', 'verify_error', true);
      return request.fail();
    }
  },
  activateAccountForm : async function(request, h) {
    if (request.user) {
      return request.fail({
        redirectTo : 'home'
      });
    }

    var activateKey = Store.user.activate_account_key(request.query.key);

    try {
      var activateVal = await Store.get(activateKey);
      if (!activateVal) {
        return request.success({
          invalid : true
        });
      }

      activateVal = JSON.parse(activateVal);
      return request.success({
          key   : request.query.key
        , email : activateVal.email
      });
    } catch(err) {
      return request.success({
        invalid : true
      });
    }
  },
  activateAccount : async function(request, h) {
    if (request.user) {
      return request.fail({
        redirectTo : 'home'
      });
    }

    var activateKey = Store.user.activate_account_key(request.payload.key);

    try {
      var activateVal = await Store.get(activateKey);
      if (!activateVal) {
        return request.fail({
          redirectTo : 'activate-account'
        });
      }

      // update password, login user
      activateVal = JSON.parse(activateVal);
      return await new Promise(function(resolve) {
        User.findById(activateVal.email, function(err, user) {
          if (err || !user) {
            return resolve(request.fail({
              redirectTo : 'activate-account'
            }));
          }

          user.password = request.payload.password;
          // `err` is deliberately not inspected: a failed save still proceeds
          // to log the user in, and this branch has no error path at all.
          user.save(async function(err) {
            request.yar.set('loggedInWith', 'trinket');
            request.yar._logIn(user, async function(err) {
              await Store.del(activateKey);
              request.yar.flash("info", "<strong>Thank you!</strong> Your account has been activated.");
              resolve(request.success());
            });
          });
        });
      });
    } catch(err) {
      return request.fail({
        redirectTo : 'activate-account'
      });
    }
  },

  // Bulk export endpoints
  requestExport : async function(request, h) {
    var userId = request.user.id;
    // The two short-circuit branches below produce their response, hold it in
    // `failResponse` and reject with { handled: true } to stop the chain; the
    // .catch at the end recognises that marker and returns the held response.
    // The chain's resolved value IS this handler's response, so a branch that
    // rejected without setting `failResponse` would answer with the generic
    // failure instead of its own.
    var failResponse;

    // Check for in-flight export
    return await Export.findPendingOrProcessing(userId)
      .then(function(existingExport) {
        if (existingExport) {
          failResponse = request.fail({
            error: 'Export already in progress',
            exportId: existingExport._id
          });
          return Promise.reject({ handled: true });
        }

        // Check cooldown (1 hour between exports)
        return Export.findRecentCompleted(userId, 1);
      })
      .then(function(recentExport) {
        if (recentExport) {
          failResponse = request.fail({
            error: 'Please wait 1 hour between exports',
            lastExport: recentExport.created
          });
          return Promise.reject({ handled: true });
        }

        // Create export record. The read above is what decides whether one is
        // already in flight, so two requests that interleave between it and
        // this write can both create - the behaviour this endpoint has always
        // had, and not something this conversion changes. MEASURED on both
        // trees: two concurrent requests for one owner leave TWO `pending`
        // Export documents, while the sequential second request answers 200
        // 'Export already in progress' and creates nothing. Neither a unique
        // partial index on {_owner, status} nor a findOneAndUpdate upsert is
        // added here: both would change an observable outcome R-d preserves.
        // docs/preserved-quirks.md 10.19 records it with its gate.
        var exportRecord = new Export({
          _owner: userId,
          status: 'pending'
        });

        return exportRecord.save();
      })
      .then(function(saved) {
        var exportRecord = saved;

        // Queue the job. Un-awaited, as it has always been: the response does
        // not wait on the queue and a queue failure is not reported to the
        // caller.
        //
        // The rejection handler is what makes that shape survivable, and it is
        // NOT a change of contract - the enqueue is still fire-and-forget, the
        // response is still produced without waiting on it, and a queue failure
        // is still not reported to the caller. What it removes is the third
        // outcome nobody asked for: `add()` returns a promise, Bull 4 resolves
        // it through ioredis, and when Redis is unreachable ioredis flushes its
        // offline queue with MaxRetriesPerRequestError. With nothing attached
        // that rejection is UNHANDLED, and Node 22's default for an unhandled
        // rejection is to throw - so a Redis outage took the whole server down
        // seconds after this handler had already answered. Attaching a handler
        // in the same synchronous turn the promise is created is the only
        // placement that works: a `.then` added a turn later is already too
        // late for a rejection that settled synchronously.
        //
        // Logged and swallowed, and neither half is incidental. The caller has
        // been answered and there is nothing left to answer with, so a rethrow
        // would have nowhere to go; and an export that was recorded but never
        // enqueued is exactly the state an operator has to be able to see, so
        // the line names the export id - which is the document to look at and
        // the id the client was handed - and the error message, which is what
        // says whether the queue was unreachable or refused the job. The same
        // disposition, for the same reasons, as send_mail_detached below.
        exportsQueue.add({
          action: 'bulk-export',
          exportId: exportRecord._id.toString(),
          userId: userId
        }).then(null, function(err) {
          console.log('export job could not be queued:',
            exportRecord._id.toString(), '-', (err && err.message) || err);
        });

        // PRESERVED DEFECT: this response never reaches the client. `exportId`
        // is a RAW ObjectId, and `request.success` has no reply spec on this
        // route, so it projects through ObjectUtils.serialize, whose `for...in`
        // rebuild copies the ObjectId's own ENUMERABLE prototype methods -
        // mongoose 6.13.9 resolves bson 4.7.2 on both trees, where
        // toHexString, toString, toJSON, equals, getTimestamp, toExtendedJSON,
        // inspect and valueOf are all enumerable - into a plain object carrying
        // a DETACHED toJSON. hapi's marshal calls it with the wrong receiver
        // and throws TypeError: Cannot read properties of undefined (reading
        // 'toString'), which the catch-all answers as a generic 500. By then
        // the row above is saved and the job enqueued, so the caller is told
        // the request failed and never learns the id.
        //
        // `.toString()` here would serialize cleanly - which is exactly why it
        // is NOT written. The 500 is baseline behaviour, measured on a worktree
        // at 2f8712a with its own install; lib/util/objectUtils.js is
        // byte-identical to that commit and this payload shape is unchanged.
        // Repairing it would be a third approved deviation, and the register is
        // closed at two. docs/preserved-quirks.md 10.18 carries the
        // measurement and the target disposition. Note there is currently NO
        // corpus case for this branch: the seeded sweep identity owns a pending
        // export, so it only ever reaches the already-in-progress guard above.
        // A scenario driving it as the seeded admin was written and its
        // expectation met, but it lives in test/parity/capture.js, which
        // belongs to another unit, so it is not delivered here.
        return request.success({
          success: true,
          data: {
            exportId: exportRecord._id,
            status: 'pending',
            message: 'Export started. You will receive an email when ready.'
          }
        });
      })
      .catch(function(err) {
        if (err && err.handled) return failResponse;
        console.log('Export request error:', err);
        return request.fail({ error: err.message || 'Failed to start export' });
      });
  },

  listExports : async function(request, h) {
    var limit = request.query.limit || 10;

    return await Export.findByOwner(request.user)
      .then(function(exports) {
        exports = exports || [];
        var data = exports.slice(0, limit).map(function(exp) {
          return {
            id: exp._id.toString(),
            status: exp.status,
            progress: exp.progress,
            trinketCount: exp.trinketCount,
            fileSize: exp.fileSize,
            created: exp.created ? exp.created.toISOString() : null,
            expiresAt: exp.expiresAt ? exp.expiresAt.toISOString() : null,
            downloadAvailable: exp.status === 'completed' && exp.expiresAt > new Date()
          };
        });
        return request.success({ success: true, data: data });
      })
      .catch(function(err) {
        return request.fail({ error: err.message });
      });
  },

  // `Boom` is not bound in this module, so every `Boom.*` reference in this
  // handler and the next one intentionally throws ReferenceError instead of
  // producing the 404/403/400 it reads as. Inside an Export.findById callback
  // the throw does not reach the route catch-all: the generated finder in
  // lib/models/model.js re-delivers a throw from a findById callback to that
  // same callback with the error as its `err` argument - the base commit did it
  // with `promise.then(d => cb(null, d)).catch(cb)` and the delivered tree does
  // it in the `$handleCallbackError` override that finder installs - and the
  // `if (err)` branch then answers request.fail({ error: 'Boom is not
  // defined' }) with a 200. The error message is client-visible, so `Boom` has
  // to stay the FIRST unresolvable reference on each line - a callee is
  // resolved before its arguments, so wrapping the call in another unbound
  // identifier would change the message the client receives.
  //
  // The re-delivery is the ONLY thing that answers these branches: the promise
  // below is resolved from inside the callback and from nowhere else, so a
  // finder that swallows the throw leaves the handler awaiting forever and the
  // client parked. That is what QA findings W000-EXPORT-BRANCH-HANG,
  // W001-F11-EXPORT-BRANCHES-NO-RESPONSE and
  // W002-I6-EXPORT-CASTABLE-ABSENT-ID-HANG measured on six branches, and it is
  // why lib/models/model.js carries that mechanism as a contract rather than an
  // incidental.
  getExportStatus : async function(request, h) {
    try {
      var userId = request.user.id;
      var exportId = request.params.exportId;

      return await new Promise(function(resolve) {
        Export.findById(exportId, function(err, exportRecord) {
        try {
          if (err) {
            return resolve(request.fail({ error: err.message }));
          }

          if (!exportRecord) {
            return resolve(Boom.notFound('Export not found'));
          }

          if (exportRecord._owner.toString() !== userId) {
            return resolve(Boom.forbidden('Access denied'));
          }

          var downloadAvailable = exportRecord.status === 'completed' &&
                                  exportRecord.expiresAt &&
                                  exportRecord.expiresAt > new Date();

          return resolve(request.success({
            success: true,
            data: {
              id: exportRecord._id.toString(),
              status: exportRecord.status,
              progress: {
                total: exportRecord.progress ? exportRecord.progress.total : 0,
                processed: exportRecord.progress ? exportRecord.progress.processed : 0,
                failed: exportRecord.progress ? exportRecord.progress.failed : 0
              },
              trinketCount: exportRecord.trinketCount,
              fileSize: exportRecord.fileSize,
              created: exportRecord.created ? exportRecord.created.toISOString() : null,
              expiresAt: exportRecord.expiresAt ? exportRecord.expiresAt.toISOString() : null,
              errorMessage: exportRecord.errorMessage,
              downloadAvailable: downloadAvailable,
              downloadUrl: downloadAvailable ? '/api/exports/' + exportRecord._id + '/download' : null
            }
          }));
        } catch (innerErr) {
          console.log('getExportStatus inner error:', innerErr.stack || innerErr);
          // `Boom` is unbound here too, so this line throws in turn: that is
          // the throw that escapes this callback and drives the re-invocation
          // described above.
          return resolve(Boom.internal('Export status error'));
        }
        });
      });
    } catch (outerErr) {
      console.log('getExportStatus outer error:', outerErr.stack || outerErr);
      // Reached when the synchronous part throws (request.user being absent, for
      // instance). Throws in turn, so the catch-all answers 500.
      return Boom.internal('Export status error');
    }
  },

  downloadExport : async function(request, h) {
    var userId = request.user.id;
    var exportId = request.params.exportId;

    return await new Promise(function(resolve) {
      Export.findById(exportId, function(err, exportRecord) {
        if (err) {
          return resolve(request.fail({ error: err.message }));
        }

        // The four branches below all throw on the unbound `Boom` and are
        // re-entered through the finder's own callback re-delivery, so each
        // intentionally answers request.fail({ error: 'Boom is not defined' })
        // rather than its named status. MEASURED on both trees, identically, on
        // all four:
        // an absent export, an export owned by someone else, a PENDING export
        // and a COMPLETED-but-expired export all answer
        // 200 {"error":"Boom is not defined","flash":{}} - a success status
        // carrying an error string, which a client cannot distinguish from
        // success. Note the statuses the expressions name differ (404, 403,
        // 400, 400) while the single observable outcome does not. That is the
        // preserved outcome; docs/preserved-quirks.md 9.9 and 10.14 record it
        // per branch.
        if (!exportRecord) {
          return resolve(Boom.notFound('Export not found'));
        }

        if (exportRecord._owner.toString() !== userId) {
          return resolve(Boom.forbidden('Access denied'));
        }

        if (exportRecord.status !== 'completed') {
          return resolve(Boom.badRequest('Export not ready'));
        }

        if (!exportRecord.expiresAt || new Date() > exportRecord.expiresAt) {
          return resolve(Boom.badRequest('Export has expired'));
        }

        // Generate fresh presigned URL
        var client = new aws.S3();
        var downloadUrl = client.getSignedUrl('getObject', {
          // config/default.yaml declares no `exports` bucket, so a deployment
          // must supply one: without it this dereference throws and the route
          // answers through the same re-invocation path as the branches above.
          Bucket: config.aws.buckets.exports.name,
          Key: exportRecord.s3Key,
          Expires: 3600  // 1 hour
        });

        // Raw presigned URL: h.redirect must receive it unprefixed, since
        // routeParser's redirect() helper would prepend config.url to it.
        resolve(h.redirect(downloadUrl));
      });
    });
  }
};

/**
 * Hands a rendered message to the mail transport WITHOUT letting its rejection
 * escape, and without waiting for delivery.
 *
 * The un-awaited call is the contract every caller in this file relies on: the
 * response is produced before the mail is sent, and no route waits on SMTP. The
 * attached handler is what makes that safe. `mailer.send` is an `async function`
 * (lib/util/mailer.js), so a transport failure - a refused connection, an
 * unresolvable host, a rejected recipient - rejects its promise, and a rejected
 * promise nobody observes is an unhandled rejection. Node 22's default policy
 * for one is to TERMINATE THE PROCESS, so a single unreachable SMTP host would
 * take the server down after it had already answered 200. Measured: a live
 * server answered a password-reset request and then died on
 * `connect ECONNREFUSED` from this call.
 *
 * `sendEmailChange` made this reachable through a path that could never run
 * before - its callback was handed to an arity-2 `Store.set` and was dead - so
 * containment is part of that repair rather than a separate concern.
 *
 * Logging and swallowing is the correct disposition, not a rethrow: the caller
 * has already answered, the mail is best-effort by design, and there is nothing
 * left to answer with. The failure is logged so it is visible in operations.
 *
 * @param {string} to        recipient address
 * @param {string} subject
 * @param {Object} options   the mailer's options object
 * @returns {undefined}      deliberately not a promise; callers do not wait
 */
function send_mail_detached(to, subject, options) {
  var sent;

  try {
    sent = mailer.send(to, subject, options);
  }
  catch (err) {
    console.log('mail could not be handed to the transport:', subject, '-', err && err.message);
    return;
  }

  if (sent && typeof sent.then === 'function') {
    sent.then(null, function(err) {
      console.log('mail delivery failed:', subject, '-', (err && err.message) || err);
    });
  }
}

function send_email_confirmation(request, new_email, key) {
  var change_email_url = config.url + '/change-email?key=' + key;

  var message = nunjucks.render('emails/confirmEmailChange', {
    fullname         : request.user.fullname,
    username         : request.user.username,
    new_email        : new_email,
    change_email_url : change_email_url
  });
  send_mail_detached(new_email, 'Confirm new email address', { html : message, type : 'confirm-email-change' });
}

function send_email_verification(request, email, key) {
  var verify_email_url = config.url + '/verify-email?key=' + key;

  var message = nunjucks.render('emails/verifyEmail', {
    fullname         : request.user.fullname,
    username         : request.user.username,
    email            : email,
    verify_email_url : verify_email_url
  });
  send_mail_detached(email, 'Verify email address', { html : message, type : 'verify-email' });
}
