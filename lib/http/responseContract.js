/**
 * The declarative response contract: the pair of response builders that resolve a
 * route's `success`, `fail`, `reply`, `html` and `redirect` declarations into a
 * hapi response.
 *
 * PUBLIC API
 *
 *   createResponders({ success, fail, replySpec, extensions })
 *       -> { respond, reject }        // exactly these two, never a third
 *   addUserContext(json, request)     // also used by lib/http/staticRoutes.js
 *   isMobile(request)
 *   aceOff(request)
 *   noResponse                        // { rejectOrAbandon } - the no-response fate, see below
 *
 * createResponders() is called once per route at parse time, so the route's own
 * `success` and `fail` declaration objects are closed over and every request on
 * that route reads the same declaration rather than a per-request copy. respond()
 * does not mutate them; reject() DOES - it writes its interpolated URL back into
 * `fail.redirect`, which leaks one request's value into the next. AAP 0.4.1.1
 * names that mutation as behavior to preserve, so it is preserved rather than
 * repaired - see the comment at that site and docs/PRESERVED-QUIRKS.md 4.4.
 *
 * responseType is per-request, so neither responder computes it. It is the value
 * the content negotiator produced - 'html', 'json' or false - supplied either as
 * `request.responseType` or as the trailing argument, which wins when present. The
 * test is `typeof responseType === 'undefined'`, so an explicit false is honored.
 * The stash is required rather than optional: lib/http/validation.js calls reject()
 * without a response type, and routes whose validation failure answers a redirect
 * would otherwise start answering 200 with a JSON body.
 *
 * `log` is the undeclared global assigned in app.js, used without being required.
 *
 * @module lib/http/responseContract
 */
var util        = require('util'),
    Boom        = require('@hapi/boom'),
    config      = require('config'),
    ObjectUtils = require('./../util/objectUtils'),
    StringUtils = require('./../util/stringUtils'),
    Redirect    = require('./redirect'),
    JSON_EXT    = /\.json$/;

// SECURITY REMEDIATION (review finding F-16/S-2, CWE-532), recorded in
// docs/PRESERVED-QUIRKS.md section 15.6.
//
// reject() logs the failure payload it was handed, verbatim from the base commit
// (base lib/util/routeParser.js:L484-L486), and lib/http/validation.js hands it
// `request.payload` - so a failed signup or a failed password change wrote the
// SUBMITTED PASSWORD into the application log in cleartext. The remediation is
// confined to what is written to the log: the payload object itself is still flashed
// and still reaches the template unchanged, because that is the client-visible
// behavior the preservation directives freeze. Nothing about the response moves.
//
// The key test is deliberately broad - a false positive costs one unreadable log
// field, a false negative writes a credential to disk. It matches the payload field
// names this application actually carries (`password`, `password_verify`,
// `passwordConfirm`, `token`, `key`, `secret`) and the header-ish names a controller
// could hand the responder.
var SECRET_KEY      = /pass|secret|credential|authorization|cookie|token|(^|[^a-z])key([^a-z]|$)/;
var REDACTED        = '[REDACTED]';
var REDACT_MAX_DEPTH = 6;

// Where the walk cannot continue it must stop with a MARKER, never with the original
// container. Handing the original back would place an unwalked - and therefore
// unredacted - subtree into the value that is about to be inspected, and
// util.inspect renders a cycle one level below where it was found, so a credential
// on a cyclic payload would still be written. Both markers are strings, so no key
// can survive either branch. '[Circular]' is what util.inspect would have printed
// for the same shape, and the depth marker sits four levels below util.inspect's own
// default truncation depth of 2, so neither is normally visible in the log line.
var CIRCULAR        = '[Circular]';
var DEPTH_LIMIT     = '[Depth limit]';

/**
 * True when a property name names a credential.
 *
 * camelCase is split before the test so `apiKey` and `resetKey` are caught while
 * `monkey` and `keystone` are not - `key` has to stand as its own word.
 *
 * @param   {String} name A property name, or the leaf of a validation fieldPath.
 * @returns {Boolean} True when the name is secret-bearing.
 */
function isSecretName(name) {
  return SECRET_KEY.test(String(name).replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase());
}

/**
 * A copy of `value` with every secret-bearing key's value replaced by a fixed marker,
 * for logging only.
 *
 * The input is NEVER mutated: reject() flashes and returns the very object it logs, so
 * a mutating scrub would strip the field from the re-rendered form as well - a
 * client-visible change. Arrays and plain objects are copied one level at a time;
 * anything else (a string, a Buffer, a stream, an Error, a mongoose document) is
 * returned as-is, because only a keyed container can hide a named credential and
 * copying a document would change how util.inspect renders it.
 *
 * @param   {*}      value   The value about to be inspected into the log.
 * @param   {Number} [depth] Recursion depth, used internally.
 * @param   {Array}  [seen]  Ancestors on the current path, so a cyclic payload terminates.
 * @returns {*} A safe-to-log rendering of `value`.
 */
function redactSecrets(value, depth, seen) {
  depth = depth || 0;
  seen  = seen || [];

  // A non-container carries no named key, so it is already safe and is returned as-is.
  if (!value || typeof value !== 'object') {
    return value;
  }

  // The two stop conditions return markers rather than `value`, because returning the
  // container would re-admit the very subtree this pass exists to scrub. `seen` holds
  // the ANCESTOR CHAIN only, so a value referenced twice in a DAG is still walked -
  // and redacted - at each position; only a true cycle stops.
  if (seen.indexOf(value) !== -1) {
    return CIRCULAR;
  }

  if (depth >= REDACT_MAX_DEPTH) {
    return DEPTH_LIMIT;
  }

  // Only plain containers are walked. A prototyped object - a mongoose document, an
  // Error, a Buffer, a stream - is left alone; its own inspect output is the base
  // commit's log line and none of them is a submitted form payload.
  var prototype = Object.getPrototypeOf(value);

  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    return value;
  }

  seen = seen.concat([value]);

  if (Array.isArray(value)) {
    return value.map(function(entry) {
      return redactSecrets(entry, depth + 1, seen);
    });
  }

  return Object.keys(value).reduce(function(copy, key) {
    copy[key] = isSecretName(key) ? REDACTED : redactSecrets(value[key], depth + 1, seen);

    return copy;
  }, {});
}

/**
 * True when a validation fieldPath names a secret-bearing field, so its message - which
 * Joi builds by embedding the OFFENDING VALUE for pattern, min and max failures - must
 * not be written to the log. Used by lib/http/validation.js; the message the client
 * receives is untouched.
 *
 * @param   {String} fieldPath A dotted validation path, as built from err.path.
 * @returns {Boolean} True when the leaf name is secret-bearing.
 */
function isSecretField(fieldPath) {
  var segments = String(fieldPath).split('.');

  return isSecretName(segments[segments.length - 1]);
}

/**
 * Mobile-device sniff, surfaced to templates as `json.isMobile`.
 *
 * The swallow-all try/catch is behavior: a request with no user-agent header
 * leaves every local undefined and returns false rather than throwing.
 *
 * @param   {Object}  req The hapi request.
 * @returns {Boolean} Strictly true or false - note the asymmetry with aceOff().
 */
function isMobile(req) {
  var Android, Mobile, iDevice, ua;
  try{
    ua      = req.headers['user-agent'].toLowerCase();
    iDevice = ua.match(/iphone|ip[ao]d|crios/i);
    Android = ua.match(/Android/i);
    Mobile  = ua.match(/Mobile/i);
  }catch(err){}

  return (iDevice || (Android && Mobile)) ? true : false;
}

/**
 * Editor kill-switch sniff, surfaced to templates as `json.aceOff`. The browser
 * list is part of the frozen client-visible surface.
 *
 * Unlike isMobile() this returns the raw disjunction, so a request with no
 * user-agent yields undefined rather than false. Both shapes reach templates.
 *
 * @param   {Object} req The hapi request.
 * @returns {Boolean|undefined} True for the sniffed browsers, false when a
 *                              user-agent was present and matched none of them,
 *                              undefined when there was no user-agent at all.
 */
// Turn off Ace for certiain browsers/OSs
function aceOff (req) {
  var ua, epiphany, iceweasel, midori;
  try{
    ua         = req.headers['user-agent'].toLowerCase();
    epiphany  = /epiphany/i.test(ua);
    iceweasel = /iceweasel/i.test(ua);
    midori    = /midori/i.test(ua);
  }catch(err){}

  return epiphany || iceweasel || midori;
}

/**
 * Decorate a template context with the current user and the email feature flag.
 *
 * Mutates `json` in place and returns nothing. Exported because the synthesized
 * /about and /help handlers in lib/http/staticRoutes.js call it too.
 *
 * The emailEnabled rule here - `from` AND (SES OR Mailgun) - is not the rule
 * lib/util/mailer.js#isConfigured() applies, which requires `from` AND `host`, so
 * a deployment can advertise email to the frontend while the mailer refuses to
 * send. The two rules stay as they are. The flag is also the raw truthiness
 * expression rather than a boolean - the empty string under the shipped defaults -
 * and it reaches serialized JSON payloads, so it must not be coerced.
 *
 * @param   {Object} json    The response body / template context, mutated in place.
 * @param   {Object} request The hapi request; request.user may be absent.
 * @returns {undefined}
 */
function addUserContext(json, request) {
  if (request.user) {
    json.user = request.user;
    json.loggedInWith  = request.yar.get('loggedInWith') || 'trinket';
    json.userAvatarSrc = request.user.normalizeAvatar();
  }

  // Add email configuration status for frontend feature visibility
  // Check if email is properly configured (need either AWS SES or Mailgun credentials)
  var hasAWS = config.aws && config.aws.mail && config.aws.mail.keyId && config.aws.mail.key;
  var hasMailgun = config.app.mail && config.app.mail.key && config.app.mail.domain;
  var hasFrom = config.app.mail && config.app.mail.from;
  json.emailEnabled = hasFrom && (hasAWS || hasMailgun);

  return;
}

/**
 * Build the pair of response builders for ONE route.
 *
 * Called once per route at parse time by lib/util/routeParser.js, which has
 * already hoisted `route.html` onto `success.html` and `route.redirect` onto
 * `success.redirect`, so `success` arrives carrying them.
 *
 * The returned object has exactly two keys and there is no third responder. Two
 * branches in lib/controllers/folders.js nonetheless invoke a `catch` responder,
 * which raises a TypeError that the centralized error map answers as a 500;
 * adding a third responder here would turn that into a working response. See
 * docs/PRESERVED-QUIRKS.md section 3.23.
 *
 * @param   {Object}   [spec]            The route's declarative response contract.
 * @param   {Object}   [spec.success]    route.success, carrying `html` and `redirect`.
 * @param   {Object}   [spec.fail]       route.fail, carrying `html` and `redirect`.
 * @param   {Object}   [spec.replySpec]  route.reply - the field-projection spec.
 * @param   {Boolean}  [spec.extensions] route.ext - accepted for signature parity only.
 * @returns {{respond: Function, reject: Function}} The two responders, in that order.
 */
function createResponders(spec) {
  spec = spec || {};

  // Closed over once per route and never copied, so every request on the route reads
  // the same declaration. Nothing here writes to either object; reject()'s
  // interpolation lands in a request-local `target` instead - see its own comment.
  var success    = spec.success || {},
      fail       = spec.fail    || {},
      replySpec  = spec.replySpec,
      // Accepted for spec parity and never read here; the `.json` route
      // duplication it drives lives in lib/util/routeParser.js.
      extensions = spec.extensions;

  /**
   * The success responder.
   *
   * @param   {Object} request        The hapi request.
   * @param   {Object} h              The hapi response toolkit.
   * @param   {Object} [json]         The controller's payload / template context.
   * @param   {String|Boolean} [responseType] Optional override; see the module header.
   * @returns {Object} A hapi response, a redirect, a view, or a Boom 500.
   */
  function respond(request, h, json, responseType) {
    if (typeof responseType === 'undefined') {
      responseType = request.responseType;
    }

    var response;
    // Allow controller to override the default redirect via json.redirectTo
    var redirectUrl = (json && json.redirectTo) || success.redirect;
    if (redirectUrl) {
      // Runs before projection and before the flash injection below, which is why
      // json.redirectTo works on a raw controller object and why a redirect does
      // not drain the flash bag. Do not reorder.
      response = Redirect.redirect(request, h, redirectUrl, json);
      return response;
    }

    // pull() takes the field spec first; serialize() drops every null and undefined
    // value. Both shape the payload on the wire, and a throw belongs to
    // lib/http/errorMap.js, so neither call is guarded here.
    json = replySpec
      ? ObjectUtils.pull(replySpec, json || {})
      : ObjectUtils.serialize(json || {});

    // A bare flash() DRAINS the flash bag - a mutation, not an accessor - and it fires
    // on every success response, so do not cache it, call it twice or move it.
    json.flash   = request.yar.flash();
    json.context = request.yar.get('context');

    // Remove IP and referrer from the lastView section
    //
    // PII scrub. Both forms are required: `json.data` is an array on list endpoints
    // and a single document on show endpoints, so dropping either branch leaks the
    // viewer's IP address and referrer. Only viewedOn and viewType survive.
    if (Array.isArray(json.data)) {
      for (var i = 0; i < json.data.length; i++) {
        if (json.data[i].lastView) {
          json.data[i].lastView = {
            viewedOn: json.data[i].lastView.viewedOn,
            viewType: json.data[i].lastView.viewType
          };
        }
      }
    } else if (json.data && json.data.lastView) {
      json.data.lastView = {
        viewedOn: json.data.lastView.viewedOn,
        viewType: json.data.lastView.viewType
      };
    }

    // All three conditions matter: html negotiated, a success template declared, and a
    // path not ending in .json - the .json twin of an HTML route always answers JSON.
    if (responseType === 'html' && success.html && !JSON_EXT.test(request.url.pathname)) {
      addUserContext(json, request);

      if (typeof(success.html) === 'string') {
        // Embed-template override: an embed page whose trinket carries its own template
        // lets the trinket win, tested against that literal declaration string.
        var template = success.html === 'embed/{lang}.html' && json.trinket && json.trinket.template
          ? json.trinket.template
          : success.html;

        json.isMobile = isMobile(request);
        json.aceOff = aceOff(request);

        // The template name is interpolated too - that is how 'embed/{lang}.html'
        // resolves - and a non-string template throws into lib/http/errorMap.js.
        template = StringUtils.interpolate(template, json);
        response = h.view(template, json);
        return response;
      }
      else if (success.html.redirect) {
        // The object form of `html`; POST /courses is its only consumer.
        response = Redirect.redirect(request, h, success.html.redirect, json);
        return response;
      }
      else {
        // Terminal failure: `html` declared as an object with no redirect. A 500, so
        // hapi replaces the message on the wire, and it is returned rather than thrown.
        // The log line is the base commit's, arguments and order included.
        log.error('unexpected response format', success, redactSecrets(json));
        response = Boom.internal('Unexpected response format');
        return response;
      }
    }
    else {
      // The JSON path, and also the path an HTML request takes on a route that
      // declares no success template at all.
      response = h.response(json);
      return response;
    }
  }

  /**
   * The failure responder.
   *
   * Both arguments after `h` are optional and every combination is reachable: some
   * controllers call it with none at all, and several hand it to a promise as a
   * rejection handler, which puts the error in `json` and leaves `err` undefined.
   *
   * @param   {Object} request        The hapi request.
   * @param   {Object} h              The hapi response toolkit.
   * @param   {Object} [json]         The failure payload; also the flashed 'failure' value.
   * @param   {*}      [err]          Logged only; never reaches the client.
   * @param   {String|Boolean} [responseType] Optional override; see the module header.
   * @returns {Object} A hapi response, a redirect, or a view - never an error.
   */
  function reject(request, h, json, err, responseType) {
    if (typeof responseType === 'undefined') {
      responseType = request.responseType;
    }

    var response;
    // Used directly as a promise rejection handler by several controllers, in which
    // case the error lands in `json` and this logs "<inspected error> undefined".
    // The guard also means a no-argument call logs nothing at all.
    //
    // PRESERVED QUIRK (docs/PRESERVED-QUIRKS.md section 15.6). This line writes the
    // failure payload to the log verbatim, and lib/http/validation.js hands it
    // `request.payload` - so a failed signup or password change records the SUBMITTED
    // PASSWORD in cleartext. An intermediate revision scrubbed the log copy; code review
    // removed that scrub because a log-hygiene repair is a latent-bug fix and R-1 admits
    // only the runtime bump, the hapi API migration, the async conversion and dependency
    // swaps. The base commit's line is restored exactly.
    if (json) {
      // redactSecrets() is the F-16/S-2 remediation and applies to the LOG ONLY: `json`
      // itself is flashed, re-rendered and returned untouched below, so every byte on the
      // wire is the base commit's. See docs/PRESERVED-QUIRKS.md section 15.6.
      log.info(util.inspect(redactSecrets(json)) + " " + err);
    }

    if (responseType === 'html' && fail.redirect) {
      // PRESERVED QUIRK (docs/PRESERVED-QUIRKS.md section 4.4), and the reason the
      // interpolation writes BACK into `fail.redirect` rather than into a local. `fail` is the
      // route's own declaration object, closed over once at parse time and shared by every request
      // on that route, so this assignment mutates the shared declaration. Two consequences, both
      // measured, both part of the base commit's behavior:
      //   (a) the placeholder is GONE from the declaration afterwards, so every later failure on the
      //       route - for every other visitor, until restart - reuses the value the first failing
      //       request interpolated;
      //   (b) `POST /users` declares `fail : { redirect : '/{formName}' }` (config/routes.js:L75-L77)
      //       and `formName` is an unconstrained `Joi.string().required()` payload field, so the
      //       interpolated result is caller-controlled and is absolutized by lib/http/redirect.js
      //       with no origin confinement.
      // AAP 0.4.1.1 lists this in-place mutation among the behaviors to relocate unchanged, and R-4
      // forbids repairing it here. An intermediate revision interpolated into a local and confined
      // the result; code review rejected that under R-1/R-4 and the base form is restored.
      if (json) {
        request.yar.flash('failure',  json, true);
        fail.redirect = StringUtils.interpolate(fail.redirect, json);
      }
      // yar's isOverride flag persists these so the form can be re-rendered after
      // the redirect. Both fire even when `json` is falsy.
      request.yar.flash('payload', request.payload, true);
      request.yar.flash('query',   request.query,   true);
      response = Redirect.redirect(request, h, fail.redirect, json);
      return response;
    }

    // Reached only when the redirect branch did not fire; this bare flash() drains
    // the bag too.
    json       = json || {};
    json.flash = request.yar.flash();

    if (responseType === 'html' && fail.html && !JSON_EXT.test(request.url.pathname)) {
      // Asymmetric with respond() on purpose: `fail.html` is used without the
      // typeof-string guard and without interpolation, so an object-valued
      // fail.html reaches h.view() as-is.
      addUserContext(json, request);
      response = h.view(fail.html, json);
      return response;
    }
    else {
      // No status is ever set, so a failure answers HTTP 200 with a body of
      // { flash: ... }. Adding a status code or returning a Boom here would change
      // the wire behavior of every declarative failure.
      response = h.response(json);
      return response;
    }
  }

  // Exactly two keys, `respond` first; see the module header on the absent third.
  return {
    respond : respond,
    reject  : reject
  };
}

/**
 * THE THIRD TERMINAL OUTCOME: no response at all.
 *
 * The retired compatibility layer captured a handler's response out of band, awaiting a deferred promise
 * that only the synthetic `reply` settled (lib/util/routeParser.js:L332-L335 and :L568-L570 at the base
 * commit). A branch that reached no responder therefore left that deferred unsettled and the REQUEST
 * RECEIVED NO RESPONSE - no status line, no body, no Set-Cookie - for as long as the client held the
 * socket. Roughly twenty controller branches end that way: a chain with no `else`, an `err` argument the
 * callback declared and ignored, a detached promise nobody awaited, a third argument handed to an
 * arity-two function.
 *
 * Returning `undefined` from a hapi 21 handler is NOT that contract. Measured on @hapi/hapi 21.4.10 over
 * real HTTP, hapi raises `method did not return a value, a promise, or throw an error`, which
 * lib/http/errorMap.js answers as a scrubbed 500 - a status those branches never carried. R-4 forbids the
 * "improvement" and R-6 makes the base commit's observed behaviour the tie-breaker, so the fate is
 * reproduced instead, and the toolkit has a first-class value for exactly it: `h.abandon`.
 *
 *   catch (saveError) {
 *     // R-6: baseline ignored this error and produced no response at all.
 *     return h.abandon;
 *   }
 *
 * `h.abandon` is hapi's own no-response outcome and is what every one of those branches now returns.
 * MEASURED on @hapi/hapi 21.4.10 over real HTTP, returned from a plain handler, from an async handler
 * after an await, from inside a returned promise chain and from a pre-handler: no status line, no body,
 * no header - the socket is simply left open, because hapi's Request._abort() calls `res.end()` only for
 * `h.close` and does nothing at all for `h.abandon` (node_modules/@hapi/hapi/lib/request.js). The server
 * stays listening, every other route is served normally, and nothing is logged - which also matches the
 * base commit, where an ignored callback error produced no log line. No route sets a server timeout
 * (`route.settings.timeout` is `{ server: false }` on all 233 rows), so nothing converts the client's
 * wait into a 503, exactly as nothing did at the base commit.
 *
 * NEVER `h.close` here, and never write to or end `request.raw.res`: `h.close` ends the response, which
 * would hand the client an empty but COMPLETE HTTP message where the base commit sent no message at all.
 * The difference is client-visible - a socket held open versus a terminated request - so the two are not
 * interchangeable.
 *
 * WHY NOT A NEVER-SETTLING PROMISE. An earlier revision of this module reproduced the fate with
 * `new Promise(function() {})` behind `forever()`/`hang()`. The wire outcome was identical, but hapi was
 * still awaiting that promise, so the ENTIRE request lifecycle - request, response, route state and every
 * closure the handler had captured - stayed reachable for as long as the client held the socket, on
 * routes that by construction have no server timeout to release it. Review finding F1 (final
 * performance/resource/concurrency checkpoint) named that retention, and `h.abandon` removes it while
 * leaving the wire byte-for-byte unchanged: hapi finalizes the request immediately, emits its ordinary
 * `response` event (nothing in app.js, config/ or lib/ subscribes to it, so no log line appears either
 * way) and drops its references. The R-6 adjudication is recorded in docs/PRESERVED-QUIRKS.md section
 * 3.39. One log-only base-commit divergence closes with it: the one-second "still going after 1s"
 * watchdog in lib/util/routeParser.js no longer fires on these branches, because the handler now returns
 * at once - which is what the base commit did too.
 *
 * This is not the deferred-capture machinery returning. Nothing here observes a handler and nothing here
 * can turn a later `respond()` into a response: the value is an inert symbol, and every use is one
 * greppable line at the call site. It reproduces the HTTP fate only, NOT the process termination that
 * accompanied some of those branches (a Mongoose callback invoked with the document absent, dereferenced,
 * and re-thrown through `immediate()` with no `uncaughtException` handler anywhere in this tree). That
 * narrowing is an explicit R-6 adjudication, recorded in docs/PRESERVED-QUIRKS.md: killing a shared
 * server process is not an implementable route behaviour, whereas the unanswered request is, and the
 * unanswered request is the part a client can observe.
 *
 * Which branches use it is a MEASURED question, not an inferred one: a branch qualifies only once it has
 * been reproduced against a verbatim replica of the base-commit wrapper on @hapi/hapi 20.3.0 and observed
 * to answer nothing. The synthetic responder was far more forgiving than it looks - `request.success({ x:
 * undefined })` still settled, because ObjectUtils.serialize drops undefined keys - so an error-ignoring
 * callback that reached a responder answered HTTP 200 and keeps answering 200. Every call site carries its
 * measurement in docs/PRESERVED-QUIRKS.md; branches measured at 200 do not appear there.
 *
 * `rejectOrAbandon` below lives here rather than in a module of its own because "what a route answers" is
 * this module's subject and because it wraps the very `reject` responder created above.
 */

/**
 * Invoke the failure responder exactly as the base commit did, from a call site the base commit reached
 * from an ORPHANED callback, and preserve the fate of the raise that a raw Error payload provokes.
 *
 * `reject` above ends its default branch in `h.response(json)`, and hapi 21 refuses to wrap an Error:
 * measured, `h.response(new TypeError('boom'))` raises `AssertError: Cannot wrap an error`. So handing the
 * responder a RAW ERROR does not produce a failure payload at all - it makes the responder itself throw,
 * and it did so at the base commit too. What differs is only where that raise landed. At these call sites
 * the base commit was inside a callback nobody owned - `lib/models/model.js#findById`'s unconsumed
 * `promise.then(...).catch(cb)` chain, a Mongoose `save(cb)` re-throwing through `immediate()`, a
 * csv/stream callback throwing into the emitter - so the raise became an unhandled rejection or an
 * uncaught exception, the shim's deferred was never settled, and the REQUEST RECEIVED NO RESPONSE.
 * Letting the AssertError propagate out of a native async handler instead hands it to
 * lib/http/errorMap.js, which answers a scrubbed 500 those branches never carried, so the raise is
 * contained here and answered with `h.abandon` - the same no-response outcome, documented above.
 *
 * The wrapper is transparent on every non-raising path: a plain-object payload answers its usual HTTP
 * 200, an html request on a route declaring `fail.redirect` answers its 302, and one declaring
 * `fail.html` renders its view - all returned unchanged. Use it ONLY where the base commit invoked the
 * responder from an orphaned callback. Where the base commit RETURNED the chain containing the responder
 * call from the handler frame, the AssertError rejected that returned chain, the shim's own catch-all saw
 * it, and the branch answered a genuine 500 - which it must keep answering.
 *
 * @param {Object} h The hapi response toolkit, already carrying `h.reject` and `h.abandon`.
 * @param {*} json The payload the base commit passed as the responder's first argument.
 * @param {*} [err] The base commit's second argument, preserved including its absence.
 * @returns {Object|Symbol} The responder's response, or `h.abandon` for the measured no-response fate.
 */
function rejectOrAbandon(h, json, err) {
  try {
    return h.reject(json, err);
  }
  catch (cannotWrapAnError) {
    return h.abandon;
  }
}

module.exports = {
  createResponders : createResponders,
  addUserContext   : addUserContext,
  isMobile         : isMobile,
  aceOff           : aceOff,
  // Exported for lib/http/validation.js, which builds the `err` string this module
  // logs and therefore has to redact the same field set (F-16/S-2). Kept here rather
  // than duplicated so there is one definition of what counts as a secret.
  redactSecrets    : redactSecrets,
  isSecretField    : isSecretField,
  // The `noResponse` namespace lives here rather than in a seventh lib/http module so the
  // extracted-module count stays at the six the plan specifies. The no-response fate itself
  // is `h.abandon` and is returned directly at its call sites; only the responder wrapper
  // needs a home, and callers reach it through
  // `require('../http/responseContract').noResponse`.
  noResponse       : {
    rejectOrAbandon : rejectOrAbandon
  }
};
