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
    // Used for one purpose only: spending the same time on a login that cannot
    // succeed as on one that can, so the response time stops disclosing whether
    // an account exists. See LOGIN_TIMING_HASH. Already a direct dependency
    // (lib/models/user.js hashes with it), so nothing is added.
    bcrypt       = require('bcrypt'),
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
// Credential-token and throttle policy.
//
// SECURITY DEVIATION FROM AAP R-d - ESCALATED FOR AUTHORIZATION, NOT
// SELF-APPROVED - SEC-F26 (CWE-330/CWE-307) and SEC-F39 (CWE-204/CWE-307).
// ---------------------------------------------------------------------------

// 48 random bytes render as 96 hex characters; 32 of them carry 128 bits, up
// from baseline's 8 characters / 32 bits - which is brute-forceable within the
// token's own lifetime.
var CREDENTIAL_TOKEN_HEX_LENGTH = 32;

// One hour, down from baseline's 24. The reset link is used within minutes of
// being requested; a day-long window is a day of exposure for a mail account.
var RESET_TOKEN_TTL_SECONDS = 3600;

// The email-change and email-verification confirmation records, which carry the
// token their mail links present. SEC-F26's root cause reaches both - they are
// minted by the same `credentialToken` derivation the reset token uses - and
// baseline stored them with NO expiry at all, so a confirmation link mailed
// once stayed live for the lifetime of the store. Bounded at 24 hours, which is
// generous for a link a user follows from their inbox and is the same horizon
// baseline chose for its reset token. Both consumers already have a branch for
// an absent record (`changeEmail` flashes 'error', `verifyEmail` flashes
// 'verify_error'), so an expired record answers through a path that exists
// rather than through a new one.
var EMAIL_CONFIRMATION_TTL_SECONDS = 86400;

// The single message every login failure answers with, whatever the underlying
// cause. Uniform text is what removes the enumeration oracle; the branches that
// produce it are kept separate so the code still documents the four causes.
var LOGIN_FAILURE_MESSAGE = 'Invalid email or password.';

// The single message every password-reset request answers with, whether or not
// the address belongs to an account.
var PASS_RESET_UNIFORM_MESSAGE = 'If an account exists for that email address, a password reset link has been sent.';

var THROTTLE_WINDOW_HOUR         = 3600;
var THROTTLE_WINDOW_QUARTER_HOUR = 900;

// Per-account and per-address login attempts. The account counter is cleared on
// a successful login (see `login`), so the failures that precede a success are
// forgiven. Once an identifier reaches the limit inside a window, though, even a
// correct password is refused until the bucket rolls - measured, and the
// intended behaviour of a limit rather than an oversight, which is why the
// allowance is 10 rather than 3.
var LOGIN_ACCOUNT_LIMIT = 10;
var LOGIN_ADDRESS_LIMIT = 100;

// Password-reset issuance: per submitted address, and per remote address so one
// client cannot enumerate many accounts.
var PASS_RESET_EMAIL_LIMIT   = 5;
var PASS_RESET_ADDRESS_LIMIT = 50;

// Token PRESENTATION - the half that makes brute force infeasible regardless of
// token length, and the "token prefix" half of SEC-F39's guidance. The prefix
// counter bounds attempts that share the leading characters of a guessed key;
// the address counter bounds the total.
var RESET_TOKEN_ADDRESS_LIMIT = 100;
var RESET_TOKEN_PREFIX_LIMIT  = 10;
var RESET_TOKEN_PREFIX_LENGTH = 8;

/**
 * Derives a credential token from random bytes.
 *
 * @param {Buffer} buf random bytes, at least CREDENTIAL_TOKEN_HEX_LENGTH/2 of them
 * @returns {string} lower-case hex, CREDENTIAL_TOKEN_HEX_LENGTH characters
 */
function credentialToken(buf) {
  return buf.toString('hex').substring(0, CREDENTIAL_TOKEN_HEX_LENGTH);
}

// A bcrypt hash of a value nobody knows, used only to spend the same time on a
// login that cannot succeed as on one that can.
//
// WHY IT IS NEEDED. Uniform response TEXT does not close CWE-204 on its own:
// baseline returned from the no-such-user branch without touching bcrypt, while
// an existing account ran a cost-10 comparison first. Measured at roughly 75 ms
// per comparison on this runtime, which is a remotely observable oracle for
// "does this address have an account", and a larger one for "does it have a
// password" - it separates an OAuth-only account from a password account. Every
// branch that answers LOGIN_FAILURE_MESSAGE without a real comparison therefore
// performs one against this hash instead.
//
// WHY IT IS GENERATED RATHER THAN WRITTEN DOWN. A literal hash in source reads
// as a hard-coded credential and invites exactly the wrong kind of scrutiny.
// This one is derived at module load from 32 random bytes, so no value in this
// file corresponds to any password, and the cost factor matches
// lib/models/user.js's SALT_WORK_FACTOR so the timing matches too. The one-off
// cost is one hash at startup.
var LOGIN_TIMING_WORK_FACTOR = 10;
var LOGIN_TIMING_HASH = bcrypt.hashSync(crypto.randomBytes(32).toString('hex'), LOGIN_TIMING_WORK_FACTOR);

/**
 * Spends the same time a real password comparison spends, and discards the
 * result.
 *
 * Its own failure is swallowed: this exists to equalize timing, so it must not
 * be able to turn a uniform authentication failure into a 500.
 *
 * @param {string} candidate the submitted password, or any value
 * @returns {Promise<undefined>}
 */
async function spendLoginComparisonTime(candidate) {
  try {
    await bcrypt.compare(typeof candidate === 'string' ? candidate : '', LOGIN_TIMING_HASH);
  }
  catch (err) {
    console.log('LOGIN: timing comparison failed:', err && err.message);
  }
}

/**
 * The remote address a throttle counter is keyed on.
 *
 * Absent request info is normalized to a fixed string rather than to undefined,
 * so requests that arrive without it share one bucket instead of each creating
 * their own - the opposite of what an attacker would want.
 *
 * @param {Object} request hapi request
 * @returns {string}
 */
function throttleAddress(request) {
  return (request.info && request.info.remoteAddress) || 'unknown-address';
}

/**
 * The leading characters of a presented reset key, used as a throttle bucket.
 *
 * @param {string} key the key as presented by the caller, possibly absent
 * @returns {string}
 */
function resetTokenPrefix(key) {
  return String(key === null || key === undefined ? '' : key)
    .substring(0, RESET_TOKEN_PREFIX_LENGTH);
}

/**
 * Counts one attempt against every supplied throttle counter and reports
 * whether the caller is within ALL of their allowances.
 *
 * Every counter is evaluated - there is no short-circuit - so an attempt is
 * recorded against each one. Short-circuiting would let a caller who has
 * already tripped a narrow counter go unrecorded on the broader one, which is
 * exactly the accounting an address-wide limit exists to keep.
 *
 * @param {Array<{scope: string, id: string, limit: number, window: number}>} counters
 * @returns {Promise<boolean>} true when every counter is within its limit
 *
 * @example
 *   var allowed = await throttleAttempt([
 *     { scope : 'login-account', id : email, limit : 10, window : 900 }
 *   , { scope : 'login-address', id : throttleAddress(request), limit : 100, window : 900 }
 *   ]);
 */
async function throttleAttempt(counters) {
  var allowed = true
    , i
    , verdict;

  for (i = 0; i < counters.length; i++) {
    verdict = await Store.rateLimit(counters[i].scope, counters[i].id, counters[i].limit, counters[i].window);

    if (!verdict) {
      allowed = false;
    }
  }

  return allowed;
}

/**
 * Cancels every export job this account still has queued.
 *
 * SEC-F45. `requestExport` enqueues with `jobId` set to the export's own id, so
 * the export records ARE the list of job handles - which is why this runs
 * before those records are erased rather than after.
 *
 * Best-effort by design and it never throws: an account deletion must not be
 * refused because a queue is unreachable, and a job that cannot be cancelled
 * fails harmlessly on a missing export instead. A job Bull is actively
 * processing refuses removal while it holds its lock, which is caught and
 * logged like any other failure.
 *
 * @param {Object} user the account being deleted
 * @returns {Promise<number>} how many jobs were removed
 */
async function cancelQueuedExports(user) {
  var removed = 0
    , records
    , job
    , jobId
    , i;

  // Only the Bull-backed queue holds durable jobs. The in-memory and no-op
  // queues in lib/util/queues.js expose no `getJob` because they have nothing
  // to look one up in.
  if (!exportsQueue || typeof exportsQueue.getJob !== 'function') {
    return removed;
  }

  try {
    records = await Export.findByOwner(user);
  }
  catch (err) {
    console.log('Account deletion could not list export jobs to cancel:', err && err.message);
    return removed;
  }

  for (i = 0; i < (records ? records.length : 0); i++) {
    jobId = String(records[i]._id);

    try {
      job = await exportsQueue.getJob(jobId);

      if (job && typeof job.remove === 'function') {
        await job.remove();
        removed++;
      }
    }
    catch (err) {
      console.log('Account deletion could not cancel export job', jobId + ':', err && err.message);
    }
  }

  return removed;
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

  // SECURITY DEVIATION FROM AAP R-d - ESCALATED FOR AUTHORIZATION, NOT
  // SELF-APPROVED - SEC-F39 (CWE-204/CWE-307), continued from the policy block
  // above `module.exports`, which carries the status of that record.
  //
  // Baseline answered four DISTINCT messages on the four failure branches below
  // - 'Unknown user <input>', 'Account Disabled', 'A password was not found for
  // this account.' and 'Invalid password' - all through request.fail, which for
  // these routes means the same 302 with only the flashed text differing. Those
  // four texts are a complete account-state oracle: they separate "no such
  // account" from "account exists, wrong password" from "account exists and is
  // disabled" from "account exists with no password at all", to an unauthenticated
  // caller, with no throttling anywhere.
  //
  // WHAT CHANGES AND WHAT DOES NOT. Every branch now answers
  // LOGIN_FAILURE_MESSAGE. The branch STRUCTURE is deliberately kept - four
  // separate `if`s rather than one collapsed test - so the code still documents
  // the four causes and so the server-side log lines still distinguish them.
  // Every `console.log('LOGIN: ...')` line stays exactly where it is: those are
  // application output, and AAP R-a does not authorize removing them as part of
  // this fix.
  login : async function(request, h) {
    console.log('LOGIN: Starting login for', request.payload.email);
    var requested = request.payload.email;
    var password = request.payload.password;
    var redirect  = request.yar.get('next');
    var data;

    try {
      // SEC-F39: throttled BEFORE the lookup, by submitted identifier and by
      // remote address, so neither an account nor a client can be used for
      // unbounded guessing. The ATTEMPT is counted rather than only the failure,
      // and the choice is deliberate: counting attempts is what bounds a guesser
      // who happens to succeed occasionally, and the cost to a legitimate user -
      // that their own successful logins count too - is cancelled by the
      // rateLimitClear on the success path below, which returns their whole
      // allowance the moment they authenticate. The address counter is NOT
      // cleared on success, because an address is not an identity: clearing it
      // would let a guesser reset the broad counter with one login they do own.
      var loginAllowed = await throttleAttempt([
          { scope : 'login-account'
          , id    : requested
          , limit : LOGIN_ACCOUNT_LIMIT
          , window: THROTTLE_WINDOW_QUARTER_HOUR }
        , { scope : 'login-address'
          , id    : throttleAddress(request)
          , limit : LOGIN_ADDRESS_LIMIT
          , window: THROTTLE_WINDOW_QUARTER_HOUR }
      ]);

      if (!loginAllowed) {
        console.log('LOGIN: Throttled, failing');
        // The same uniform failure every other branch answers, so a throttled
        // caller cannot tell throttling from a wrong password.
        return request.fail({ message: LOGIN_FAILURE_MESSAGE });
      }

      console.log('LOGIN: Finding user');
      // Find user by email or username
      var user = await new Promise(function(resolve, reject) {
        User.findByLogin(requested, function(err, user) {
          console.log('LOGIN: findByLogin callback', err, user ? user.email : 'no user');
          if (err) reject(err);
          else resolve(user);
        });
      });

      console.log('LOGIN: User found?', !!user);
      if (!user) {
        console.log('LOGIN: No user, failing');
        // SEC-F39: baseline answered 'Unknown user ' + requested, which both
        // named the account state AND echoed the submitted identifier back.
        // The comparison below spends the time a real one would, so the reply
        // no longer arrives measurably sooner than an existing account's.
        await spendLoginComparisonTime(password);
        return request.fail({ message: LOGIN_FAILURE_MESSAGE });
      }

      // SEC-F39: the per-account counter, keyed on the RESOLVED account id
      // rather than on what was submitted. The pre-lookup counter above is
      // keyed on the submitted identifier and cannot be otherwise - there is no
      // account yet - but that means an account reachable as both a username
      // and an email address would get two separate allowances through it. This
      // one closes that: one immutable id, one allowance, whichever spelling
      // the attempt used. Cleared on success alongside the identifier counter.
      var accountAllowed = await throttleAttempt([
          { scope : 'login-account-id'
          , id    : user.id
          , limit : LOGIN_ACCOUNT_LIMIT
          , window: THROTTLE_WINDOW_QUARTER_HOUR }
      ]);

      if (!accountAllowed) {
        console.log('LOGIN: Account throttled, failing');
        await spendLoginComparisonTime(password);
        return request.fail({ message: LOGIN_FAILURE_MESSAGE });
      }

      if (user.hasRole && user.hasRole("disabled")) {
        // SEC-F39: baseline answered 'Account Disabled'.
        await spendLoginComparisonTime(password);
        return request.fail({ message: LOGIN_FAILURE_MESSAGE });
      }

      if (!user.password || user.password.length === 0) {
        // SEC-F39: baseline answered 'A password was not found for this
        // account.', which disclosed both that the account exists and how it
        // was created (an OAuth-only account has no password). Without the
        // comparison below this branch would still disclose it by returning
        // early, which is the whole point of equalizing the work.
        await spendLoginComparisonTime(password);
        return request.fail({ message: LOGIN_FAILURE_MESSAGE });
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
        // SEC-F39: baseline answered 'Invalid password', which - paired with
        // 'Unknown user' above - is the enumeration oracle itself.
        return request.fail({ message: LOGIN_FAILURE_MESSAGE });
      }

      console.log('LOGIN: Success, resetting session');

      // SEC-F39: both account buckets are returned in full on a proved identity,
      // so a legitimate user who mistyped several times is never locked out by
      // their own attempts. Not awaited-and-guarded beyond rateLimitClear's own
      // fail-safe handling: a counter that could not be cleared must not turn a
      // successful authentication into an error. The identifier bucket and the
      // resolved-id bucket are cleared together - clearing only one would leave
      // the user throttled through the other spelling of their own account.
      await Store.rateLimitClear('login-account', requested, THROTTLE_WINDOW_QUARTER_HOUR);
      await Store.rateLimitClear('login-account-id', user.id, THROTTLE_WINDOW_QUARTER_HOUR);

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
  // SECURITY DEVIATION FROM AAP R-d - ESCALATED FOR AUTHORIZATION, NOT
  // SELF-APPROVED - SEC-F45 (CWE-212). The mechanism, the conflict, the
  // precedence argument and the status of that record are all on
  // `eraseOwnedData` in lib/models/user.js; what this handler owns is the ORDER,
  // and the order is the part that matters:
  //
  //   1. erase the owned data, awaited, so a failure leaves the account intact
  //      and retryable rather than orphaning records whose owner is gone;
  //   2. remove the User document, which is also what revokes every OTHER
  //      session belonging to this account - the auth scheme (app.js:243-281)
  //      looks the user up on every request and its missing-record branch clears
  //      `userId` and answers "User not found", so no session outlives the
  //      document and no change to app.js is needed;
  //   3. clear and reset THIS session before the response is built, so the
  //      response does not carry a cookie for an account that no longer exists.
  remove : async function(request, h) {
    if (request.user && request.user.username === request.query.username) {
      // SEC-F45: queued export jobs are cancelled BEFORE the export records go,
      // because the job id IS the export id and the id is the only handle on the
      // job. A job left queued for an export that no longer exists wakes the
      // worker to build an archive for a deleted account: it reads a null export
      // and a null user, and its failure handling then writes and mails against
      // records that are gone.
      //
      // Guarded on the method rather than on configuration, because only the
      // Bull-backed queue has jobs to cancel. lib/util/queues.js's in-memory and
      // no-op queues process on the next tick and persist nothing, so there is
      // no queued work for them to hold and `getJob` is correctly absent.
      await cancelQueuedExports(request.user);

      return request.user.eraseOwnedData()
        .then(function() {
          return request.user.remove();
        })
        .then(function() {
          // Same pair `logout` uses: clear the identity, then rotate the session
          // id so nothing of the deleted account's session is reusable.
          if (request.yar) {
            request.yar.clear('userId');
            request.yar.reset();
          }

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
      // SEC-F26/SEC-F39: throttled BEFORE the account lookup, so a caller cannot
      // use reset issuance to probe which addresses exist, and cannot mint reset
      // tokens in bulk. Two counters: the submitted address, and the remote
      // address so one client cannot walk a list of addresses.
      var resetAllowed = await throttleAttempt([
          { scope : 'pass-reset-email'
          , id    : request.payload.email
          , limit : PASS_RESET_EMAIL_LIMIT
          , window: THROTTLE_WINDOW_HOUR }
        , { scope : 'pass-reset-address'
          , id    : throttleAddress(request)
          , limit : PASS_RESET_ADDRESS_LIMIT
          , window: THROTTLE_WINDOW_HOUR }
      ]);

      if (!resetAllowed) {
        // Identical to every other outcome of this branch, so being throttled is
        // itself not observable and discloses nothing.
        return request.fail({ message: PASS_RESET_UNIFORM_MESSAGE });
      }

      // The response is produced inside nested callbacks, so the promise boundary
      // is created here, at the lifecycle method, and each terminal branch
      // resolves it with the response that branch produces. Keeping the callbacks
      // intact - rather than collapsing them into awaits that reject on `err` -
      // is what preserves which branch answers, and preserves non-settlement
      // where no branch runs at all.
      return await new Promise(function(resolve) {
        User.findByLogin(request.payload.email, function(err, user) {
          if (err)   return resolve(request.fail(err));
          // SEC-F39: the unknown-address outcome is now the SAME response the
          // mail-sent outcome produces - same status, same message, same flash -
          // so the pair no longer distinguishes a registered address from an
          // unregistered one. Baseline answered `{ message: 'user not found' }`
          // here (a 302 to /forgot-pass) and `request.success()` below (a 200
          // rendering users/sendpassreset.html), and that status difference WAS
          // the enumeration oracle.
          //
          // The unification is toward request.fail rather than request.success
          // because AAP §0.9.2 bars weakening existing assertions and
          // test/lib/api/forgot_pass.js asserts this route answers 302 with
          // `lastRedirect.pathname === '/forgot-pass'` for an unknown address.
          // Unifying toward a 200 would break that assertion; unifying toward
          // the redirect keeps it and makes the known-address path match.
          if (!user) return resolve(request.fail({ message: PASS_RESET_UNIFORM_MESSAGE }));

          // `ex` is intentionally not inspected: on an error `buf` is undefined
          // and buf.toString() throws from inside this callback, and that throw
          // is this branch's only error path.
          require('crypto').randomBytes(48, async function(ex, buf) {
            // SEC-F26: 32 hex characters (128 bits), not baseline's 8 (32 bits).
            var key      = credentialToken(buf);
            var resetKey = Store.user.reset_password_key(key);
            var resetVal = user.id.toString();

            // SEC-F26: one hour, not baseline's 24 - and the lifetime is
            // written WITH the value rather than after it. Baseline issued the
            // credential in two steps, `set` then `expire`, and a process that
            // died between them (or a store that answered the first and failed
            // the second) left a password-reset token that never expired at
            // all. Store.set's third argument makes it one command on the Redis
            // backend and one guarded pair on the in-memory one, so the token
            // cannot exist without its expiry.
            await Store.set(resetKey, resetVal, RESET_TOKEN_TTL_SECONDS);
            // Ordering preserved: the response is settled BEFORE the mail is
            // rendered and sent, and mailer.send stays un-awaited.
            //
            // SEC-F39: the same uniform message the unknown-address branch
            // answers with, through the same request.fail.
            resolve(request.fail({ message: PASS_RESET_UNIFORM_MESSAGE }));

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
      // SEC-F26/SEC-F39: token PRESENTATION is throttled, which is what makes
      // guessing infeasible independently of the token's length - and is the
      // "token prefix" half of SEC-F39's guidance. The prefix counter bounds
      // attempts that share a guessed key's leading characters; the address
      // counter bounds the total from one client.
      var presentAllowed = await throttleAttempt([
          { scope : 'reset-token-address'
          , id    : throttleAddress(request)
          , limit : RESET_TOKEN_ADDRESS_LIMIT
          , window: THROTTLE_WINDOW_QUARTER_HOUR }
        , { scope : 'reset-token-prefix'
          , id    : resetTokenPrefix(request.query.key)
          , limit : RESET_TOKEN_PREFIX_LIMIT
          , window: THROTTLE_WINDOW_QUARTER_HOUR }
      ]);

      if (!presentAllowed) {
        // Byte-identical to this endpoint's existing not-found outcome, so a
        // throttled caller learns nothing - not even that it was throttled.
        return request.fail({ message: 'reset password key not found' });
      }

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
      // SEC-F26/SEC-F39: the same presentation throttle resetPasswordForm
      // applies, because this endpoint accepts the same token and a guesser can
      // skip the form entirely.
      var saveAllowed = await throttleAttempt([
          { scope : 'reset-token-address'
          , id    : throttleAddress(request)
          , limit : RESET_TOKEN_ADDRESS_LIMIT
          , window: THROTTLE_WINDOW_QUARTER_HOUR }
        , { scope : 'reset-token-prefix'
          , id    : resetTokenPrefix(request.payload.key)
          , limit : RESET_TOKEN_PREFIX_LIMIT
          , window: THROTTLE_WINDOW_QUARTER_HOUR }
      ]);

      if (!saveAllowed) {
        // Byte-identical to this endpoint's existing no-such-user outcome. That
        // message is left exactly as it is - it carries a separate finding owned
        // by another work unit - so the throttled branch borrows it rather than
        // introducing a distinguishable response.
        return request.fail({ message: 'user not found' });
      }

      var user_id = await Store.get(resetKey);

      // SEC-F26: COMPARE-AND-DELETE, and the delete's own verdict is the
      // authorization. Baseline read the token here, changed the password, and
      // deleted the key afterwards - so two requests presenting the same token
      // at the same time both read it, both passed, and both set a password.
      // Whoever wrote last won, and the token stayed valid for the whole
      // window in between.
      //
      // The delete happens BEFORE the password is changed, and only the caller
      // whose delete actually removed the key proceeds. `del` answers 1 when it
      // removed a key and 0 when there was none, in Redis and in the in-memory
      // backend alike, and a single DEL is atomic in both - which is what makes
      // exactly one of N concurrent callers the winner.
      //
      // The trade-off, stated because it is real: if the save below fails, the
      // token is already spent and the user must request another. That is the
      // correct direction for a single-use credential - the alternative is the
      // window this closes - and the user's recovery is one more reset mail.
      var claimed = Number(await Store.del(resetKey));

      if (!user_id || claimed !== 1) {
        // Byte-identical to the no-such-user outcome below, so a caller cannot
        // distinguish "no such token" from "someone else just used it".
        return request.fail({ message: 'user not found' });
      }

      return await new Promise(function(resolve) {
        User.findById(user_id, function(err, user) {
          if (err)   return resolve(err);
          if (!user) return resolve(request.fail({ message: 'user not found' }));

          user.password = request.payload.password;
          user.save(async function(err) {
            if (err) return resolve(err);

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
      // and completion, and the upload must run exactly once.
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

        FileUtil.uploadUserAsset(fileupload, request.user, function(err, file) {
          if (err) return resolve(request.fail(err));
          resolve(request.success({ file : file }));
        });
      };

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
          // Log-and-continue, then complete: the original emitted 'error' and
          // still reached 'end' here, so the partial bytes are uploaded.
          console.log('on error:', err);
          writeStream.end();
          startUpload();
        });
        body.on('end', function() {
          startUpload();
        });

        body.pipe(writeStream);
      }, function(err) {
        // LOGS ONLY, and settles nothing: the original never called back on
        // this arm, so nothing is uploaded and the request hangs. Rejecting,
        // resolving or catching here would each turn that hang into a response.
        console.log('on error:', err);
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
  // SECURITY DEVIATION FROM AAP R-d - ESCALATED FOR AUTHORIZATION, NOT
  // SELF-APPROVED - SEC-F19 / SEAM-F41 (CWE-200, CWE-359).
  //
  // STATUS OF THIS RECORD: it states the departure and the reasoning, and does
  // not authorize it. AAP §0.7's conflict register closes exactly two conflicts
  // - the image response at files.js:98-100 and the `marked` advisory - and
  // nothing in the AAP delegates approval authority to a source comment.
  // Implemented because leaving a blocking security finding unfixed is not an
  // available outcome; carried to the resolution report for a human to
  // authorize or reverse.
  //
  // THE CONFLICT. Baseline returned `email : request.pre.user.email` from this
  // projection, and AAP R-d prohibits behaviour improvements, so preservation
  // would keep it. But this route - GET /api/users/{userId}/info,
  // config/api_routes.js:1462 - declares no `auth`, so it inherits the server
  // default `mode: 'try'` (app.js:310) and answers ANONYMOUS callers, and its
  // only `pre` is `user(params.userId)`. Any publicly known user id therefore
  // maps straight to that account's email address, with no relationship check
  // and no authentication at all.
  //
  // WHICH REQUIREMENT CONTROLS, AND WHY. The AAP's own precedent for deciding a
  // preservation conflict is §0.7 on lib/controllers/files.js:98-100, where a
  // requirement other than R-d controlled because R-d's protection exists for
  // clients that may legitimately rely on observable behaviour. No client relies
  // on this field: the sole consumer of this endpoint is the inline-comment
  // renderer in public/js/plugins/code-editor.js, which reads `_user.avatar` and
  // `_user.username` (:538-551) and reads neither `email` nor `displayName`. So
  // the field is disclosure with no consumer, and it is removed outright rather
  // than made conditional - a conditional branch would keep the disclosure for
  // any caller able to satisfy the condition while adding an authorization
  // surface this route has never had.
  //
  // RESIDUAL. `username`, `avatar` and `displayName` remain public, which is the
  // rest of baseline's shape and is what the editor renders. The one captured
  // parity artifact affected is test/parity/corpus.json's single
  // GET /api/users/{userId}/info scenario, whose recorded body loses the `email`
  // key; that file belongs to another work unit and is reported, not edited.
  getInfo : async function(request, h) {
    if (request.pre.user) {
      return request.success({
          username    : request.pre.user.username
        , avatar      : request.pre.user.normalizeAvatar()
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
  // BEHAVIOUR CHANGE AGAINST AAP R-d - ESCALATED FOR AUTHORIZATION, NOT
  // SELF-APPROVED - SEAM-F37 (Client Contract).
  //
  // STATUS OF THIS RECORD: it states the departure and the reasoning, and does
  // not authorize it. AAP §0.7's conflict register closes exactly two conflicts
  // - the image response at files.js:98-100 and the `marked` advisory - and
  // nothing in the AAP delegates approval authority to a source comment. This
  // one is the closest analogue of the first of those, and the argument below
  // says why; a human still decides it.
  //
  // THE CONFLICT. Baseline called `Store.set(changeKey, value, function(err) {...})`.
  // Store.set took only `(key, val)` at that point (lib/util/store.js), so it
  // returned a promise and IGNORED the third argument, and that callback never
  // ran. It now takes an optional third argument - a TTL, added for the
  // password-reset token - which is a number, not a callback: the callback form
  // this handler used has no reading under which it works. The consequence was
  // not a partial response - it was no response at
  // all: the confirmation mail is never sent, the promise never settles, the
  // route hangs until the client gives up, and the account page's email form
  // stays disabled waiting for a reply that cannot arrive. Measured, and
  // recorded as a timeout in test/parity/corpus.json's single
  // POST /api/users/email scenario. AAP R-d would preserve it.
  //
  // WHICH REQUIREMENT CONTROLS, AND WHY. This is the exact shape AAP §0.7
  // already decided for lib/controllers/files.js:98-100, and its reasoning
  // applies verbatim: R-b requires that every route serve, R-d would preserve
  // the non-settlement, and R-b controls because "an unsettled request is not a
  // behaviour a client can depend on - it is the absence of a response, and
  // R-d's protection is for clients that may rely on observable behaviour."
  // The intended response is not inferred either: it is written in the dead
  // callback below, and `resendEmailChange` immediately after this handler
  // performs the same two steps - fire-and-forget send_email_confirmation, then
  // request.success({success:true}) - on the same stored value.
  //
  // RESIDUAL. POST /api/users/email now answers and sends the confirmation mail
  // where it previously hung, and the corpus scenario that records the timeout
  // must be re-captured. That file belongs to another work unit and is reported,
  // not edited.
  sendEmailChange : async function(request, h) {
    if (!mailer.isConfigured()) {
      return request.fail({
        message: "Email is not configured. Email changes are not available."
      });
    }

    return await new Promise(function(resolve) {
      User.findByLogin(request.payload.email, function(err, user) {
        // if user found, send back error message
        //
        // Preserved: `err` is not inspected. A lookup failure falls through to
        // the change below exactly as it always has - that is a separate
        // pre-existing edge that no finding assigns here, and adding a check
        // would create an error path baseline lacks.
        if (user) {
          return resolve(request.fail({ message: 'Another account with that email address already exists.' }));
        }

        // create random key and store new email with it
        require('crypto').randomBytes(48, async function(ex, buf) {
          var email_key
            , user_key
            , changeKey
            , changeVal;

          // SEAM-F37: the promise is awaited rather than handed a callback it
          // ignores, so the pending change is actually stored before the
          // confirmation is sent and before the request is answered.
          //
          // The try/catch spans the WHOLE callback body, and that span is what
          // keeps the fix from re-creating the very defect it removes: this
          // callback is `async`, so anything that throws inside it - a store
          // outage, a template failure, or `buf` being undefined because
          // randomBytes failed - would reject a promise nobody is awaiting and
          // leave the outer promise unsettled, which is the hang again by a
          // different route. Every path below settles.
          //
          // `ex` is still not inspected, so no new error BRANCH is introduced;
          // what changes is only that the resulting throw is answered instead of
          // escaping as an unhandled rejection.
          try {
            // SEC-F26 root cause, same idiom, same defect: baseline took 8 hex
            // characters (32 bits) here too. `changeEmail` compares the presented
            // key with `request.query.key.toLowerCase()` and hex is already
            // lower-case, so a longer key still matches unchanged.
            email_key = credentialToken(buf); // send in email
            user_key  = request.user.id.toString();

            changeKey = Store.user.change_email_key(user_key);
            changeVal = {
                key       : email_key
              , new_email : request.payload.email
            };

            await Store.set(changeKey, JSON.stringify(changeVal), EMAIL_CONFIRMATION_TTL_SECONDS);

            // Not awaited, matching resendEmailChange: send_email_confirmation
            // only renders and hands off to mailer.send, which is itself
            // fire-and-forget, and the response does not wait on SMTP.
            //
            // That is a DELIBERATE choice rather than an oversight, and the
            // reasons are worth stating because the response says `success`
            // before the mail has left. Every mail in this controller is sent
            // this way - sendPassReset and resendEmailChange included - so
            // awaiting here alone would make one route's latency depend on SMTP
            // and give it a 500 branch its siblings do not have, for an
            // outcome the user learns about from their inbox either way. What
            // the response actually asserts is that the pending change was
            // STORED, which is awaited above. The rejection that used to escape
            // from this call is contained in send_mail_detached, so a transport
            // failure is logged rather than terminating the process.
            send_email_confirmation(request, changeVal.new_email, changeVal.key);

            resolve(request.success({
              success : true
            }));
          }
          catch (changeErr) {
            // Named `changeErr` rather than `err` so it does not shadow the
            // deliberately-uninspected lookup error in the enclosing callback.
            console.log('sendEmailChange error:', changeErr && (changeErr.stack || changeErr.message));
            // The error object, which is this file's convention for an error
            // disposition inside a resolved promise (see removeAsset and
            // updateSettings): hapi boomifies a plain Error to the generic 500
            // and passes a Boom through with its own status intact.
            resolve(changeErr);
          }
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

          // Same lifetime bound as the email-change record above, and for the
          // same reason: baseline stored this confirmation token with no expiry.
          await Store.set(verifyKey, email_key, EMAIL_CONFIRMATION_TTL_SECONDS);
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

        // SEC-F36: the create is now atomic. The read above stays as the fast
        // path - it answers the common case with the same body it always has -
        // but it is no longer what DECIDES uniqueness: createExclusive attempts
        // the insert unconditionally and lets a unique sparse index on the
        // export's `activeOwner` claim adjudicate, so two requests that
        // interleave between that read and this write can no longer both create.
        // See lib/models/export.js for the mechanism and the deviation record.
        return Export.createExclusive(userId);
      })
      .then(async function(outcome) {
        if (!outcome.created) {
          // Lost the claim to a concurrent request. Answered with the SAME body
          // the fast path above produces, so a caller cannot distinguish "you
          // already had one" from "someone else's request got there first" -
          // there is no difference worth exposing, and one shape means one
          // client-side branch. `exportId` is null only in the one state
          // createExclusive documents as unreportable - a claim taken and
          // released faster than it can be read back - rather than carrying an
          // id that does not exist.
          failResponse = request.fail({
            error: 'Export already in progress',
            exportId: outcome.existing ? outcome.existing._id : null
          });
          return Promise.reject({ handled: true });
        }

        var exportRecord = outcome.created;

        // Queue the job. The export's own id is the job id, which makes the
        // enqueue idempotent: Bull 4 rejects a second job carrying a jobId it
        // already holds, so a repeated enqueue for one export cannot produce two
        // jobs. lib/util/queues.js's in-memory queue accepts and ignores the
        // options object, so the development and test paths are unaffected.
        //
        // SEC-F36: AWAITED, and the claim is released if it fails. Baseline
        // fired this and moved on, so a queue that refused the job left a
        // `pending` export holding the owner's active claim with nothing to
        // process it: the user was told an export had started, no export ever
        // ran, and - now that the claim is a unique index - every later request
        // answered "already in progress" until an operator intervened. That is
        // a durable denial of the feature produced by a transient queue error,
        // so the failure is observed here rather than discarded.
        try {
          await exportsQueue.add({
            action: 'bulk-export',
            exportId: exportRecord._id.toString(),
            userId: userId
          }, {
            jobId: exportRecord._id.toString()
          });
        }
        catch (queueErr) {
          // Released through a terminal save, which is the release path
          // lib/models/export.js's pre('save') hook implements - so the
          // `activeOwner` field is unset by the same code that unsets it when a
          // worker completes, and the record survives as evidence of what
          // happened rather than being deleted.
          try {
            exportRecord.status = 'failed';
            exportRecord.errorMessage = 'Export could not be queued: ' +
              (queueErr && queueErr.message ? queueErr.message : 'unknown queue error');
            await exportRecord.save();
          }
          catch (releaseErr) {
            // Logged and not rethrown: the caller must still be told the export
            // did not start, and that is what the rethrow below does. A stuck
            // claim is recoverable; swallowing the queue error is not.
            console.log('Export request could not release the claim for', exportRecord._id, ':',
              releaseErr && releaseErr.message);
          }

          throw queueErr;
        }

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
  // lib/models/model.js runs `promise.then(d => cb(null, d)).catch(cb)`, so the
  // trailing .catch re-invokes this same callback with the ReferenceError, and
  // the `if (err)` branch then answers request.fail({ error: 'Boom is not
  // defined' }) with a 200. The error message is client-visible, so `Boom` has
  // to stay the FIRST unresolvable reference on each line - a callee is
  // resolved before its arguments, so wrapping the call in another unbound
  // identifier would change the message the client receives.
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
        // re-entered through the finder's own .catch(cb), so each intentionally
        // answers request.fail({ error: 'Boom is not defined' }) rather than
        // its named status.
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
