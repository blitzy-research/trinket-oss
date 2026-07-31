/**
 * The declarative response contract for the hapi 21 request lifecycle.
 *
 * This module carries the GENUINE APPLICATION BEHAVIOR that the compatibility
 * shim in lib/util/routeParser.js implemented as request.success and
 * request.fail, together with the three helpers those two depend on. Nothing
 * here is new: every branch below is a verbatim relocation, and the relocation
 * is part of the hapi API migration. Behavior MOVES - it is never redesigned,
 * tidied or repaired.
 *
 * PROVENANCE - each block and the source range it came from:
 *
 *   respond()        <- lib/util/routeParser.js:L412-L479  (request.success)
 *   reject()         <- lib/util/routeParser.js:L482-L514  (request.fail)
 *   addUserContext() <- lib/util/routeParser.js:L725-L740
 *   isMobile()       <- lib/util/routeParser.js:L29-L39
 *   aceOff()         <- lib/util/routeParser.js:L41-L52
 *
 * The only differences from those ranges are (a) the deleted deferred-capture
 * calls, which were pure Hapi-4 emulation and are gone rather than relocated -
 * the response IS the return value now - (b) the shim's local redirect helper is
 * reached through lib/http/redirect.js, and (c) the comments.
 *
 * PUBLIC API
 *
 *   createResponders({ success, fail, replySpec, extensions })
 *       -> { respond, reject }        // EXACTLY these two, never a third
 *   addUserContext(json, request)     // also used by lib/http/staticRoutes.js
 *   isMobile(request)
 *   aceOff(request)
 *
 * One createResponders() call per route, made once at parse time so that the
 * per-route `success` and `fail` declaration objects are closed over. That is
 * not an implementation detail: reject() writes back into `fail` (quirk 1
 * below), and the write is observable only because the closure outlives the
 * request.
 *
 * ============================================================================
 * HOW responseType IS SUPPLIED  -  READ THIS BEFORE WIRING THIS MODULE UP
 * ============================================================================
 * responseType is PER-REQUEST, so it is deliberately NOT part of the spec, and
 * neither responder ever computes it. The caller owns it. It must be exactly
 * the value the content-negotiation helper produced in the converted route
 * handler, i.e. `.types(['html', 'json'])` as at lib/util/routeParser.js:L325 -
 * the string 'html', the string 'json', or the boolean false.
 *
 * Two supported wirings, and BOTH work at the same time:
 *
 *   1. Stash it on the request before invoking a responder (primary):
 *          request.responseType = negotiated;
 *          return respond(request, h, json);
 *
 *   2. Pass it as the trailing argument (wins when supplied):
 *          return respond(request, h, json, negotiated);
 *          return reject(request, h, json, err, negotiated);
 *
 * "Supplied" is tested with `typeof responseType === 'undefined'`, so an
 * explicit false - which is what the negotiator yields when the client will
 * take neither type - is honored and is never mistaken for a missing argument.
 *
 * Wiring 1 is REQUIRED, not optional, because lib/http/validation.js:L103
 * already calls the failure responder with four arguments and no response type:
 *     reject(request, h, request.payload, util.inspect(validationErrors))
 * Route declarations such as POST /users (fail.redirect '/{formName}') and
 * POST /courses (fail.redirect '/courses/new') answer a 302 redirect on a
 * validation failure at baseline. If the response type were only ever a
 * trailing argument it would arrive undefined there, the HTML redirect branch
 * would not fire, and those routes would silently start answering 200 with a
 * JSON body instead. Stashing it on the request keeps the baseline intact.
 *
 * ============================================================================
 * PRESERVED QUIRKS  -  every one is deliberate; see docs/PRESERVED-QUIRKS.md
 * ============================================================================
 *   1. reject() interpolates fail.redirect back INTO the closed-over `fail`
 *      object, so the interpolated value persists across later requests.
 *   2. reject() never sets a status: a failure answers HTTP 200.
 *   3. reject()'s log line prints "<inspected value> undefined" whenever it is
 *      used directly as a promise rejection handler.
 *   4. A bare request.yar.flash() DRAINS the flash bag - it is a mutation, not
 *      a read.
 *   5. addUserContext()'s emailEnabled rule disagrees with
 *      lib/util/mailer.js#isConfigured(), and stays disagreeing.
 *   6. There is no third responder. Two controller branches depend on its
 *      absence in order to produce their baseline 500.
 *
 * The `log` global (assigned once in app.js) is used here without being pulled
 * in, exactly as the shim and the rest of lib/ do.
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

/**
 * Mobile-device sniff, relocated verbatim from lib/util/routeParser.js:L29-L39.
 *
 * The swallow-all try/catch is BEHAVIOR, not sloppiness: a request with no
 * user-agent header leaves every local undefined and returns false instead of
 * throwing. Preserved as-is, including the redundant .toLowerCase() paired with
 * case-insensitive patterns. The result is surfaced to templates as
 * `json.isMobile`.
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
 * Editor kill-switch sniff, relocated verbatim from
 * lib/util/routeParser.js:L41-L52.
 *
 * The epiphany / iceweasel / midori sniff is part of the frozen client-visible
 * surface, so the browser list must not be extended, shortened or modernized.
 * Unlike isMobile() this returns the RAW disjunction, which is undefined - not
 * false - when the try block threw for a missing user-agent. Both shapes reach
 * templates as `json.aceOff` and both are preserved.
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
 * Relocated verbatim from lib/util/routeParser.js:L725-L740.
 *
 * Mutates `json` in place and returns nothing. Both callers rely on that: the
 * HTML branches of respond() and reject() below, and the synthesized /about and
 * /help handlers in lib/http/staticRoutes.js, which is why this function is
 * exported rather than kept private. It must NOT be duplicated there.
 *
 * PRESERVED QUIRK 5 - see docs/PRESERVED-QUIRKS.md. The rule applied here is
 * deliberately NOT the rule used by lib/util/mailer.js#isConfigured(), which
 * requires `from` AND `host`. This one requires `from` AND (AWS SES credentials
 * OR Mailgun credentials), so a deployment can advertise email to the frontend
 * while the mailer refuses to send, and vice versa. The inconsistency is 2013-era
 * behavior that templates may depend on; it is documented, not reconciled.
 *
 * PRESERVED QUIRK - `json.emailEnabled` is the RAW truthiness expression, not a
 * boolean. With the shipped defaults `config.app.mail.from` is the empty string,
 * so emailEnabled is '' rather than false; with SES configured it is the secret
 * key STRING. Templates treat all of those alike, but a serialized JSON payload
 * would change on the wire, so it must not be coerced with a double negation or
 * Boolean().
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
 * Called once per route at parse time, from lib/util/routeParser.js, with the
 * declaration fragments it resolves at lib/util/routeParser.js:L256-L263. Note
 * that `route.html` has already been hoisted onto `success.html` and
 * `route.redirect` onto `success.redirect` by then (L293-L300), so `success`
 * arrives carrying them.
 *
 * The returned object has EXACTLY two keys, and that is a hard contract:
 *
 * PRESERVED QUIRK 6 - see docs/PRESERVED-QUIRKS.md. The shim decorated the
 * request with `success` and `fail` and nothing else; a third `catch` responder
 * was never defined anywhere. Yet lib/controllers/folders.js:L71 and :L128 both
 * invoke a `catch` responder on the request, so at baseline those two branches
 * raise a TypeError which the centralized error map turns into a 500 (and at
 * :L71, because the throw happens inside a Mongoose save callback that is never
 * awaited, the response never settles and the connection hangs). Adding a third
 * responder here - or decorating the request with one - would convert that
 * baseline failure into a working response, which is a prohibited behavior
 * improvement. Do not add one.
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

  // Closed over ONCE per route. Deliberately not normalized into a fresh object
  // and never deep-copied: quirk 1 depends on `fail` being the route's own
  // declaration object so that the write-back in reject() survives the request.
  // The `|| {}` guards mirror lib/util/routeParser.js:L259 and L261; the caller
  // already applies them, and applying them again is idempotent.
  var success    = spec.success || {},
      fail       = spec.fail    || {},
      replySpec  = spec.replySpec,
      // Part of the mandated spec shape and intentionally never read here: the
      // `.json` route duplication it drives stays in lib/util/routeParser.js.
      extensions = spec.extensions;

  /**
   * The success responder - today's request.success, relocated from
   * lib/util/routeParser.js:L412-L479. Every branch returns the response
   * instead of pushing it into the deleted deferred capture.
   *
   * @param   {Object} request        The hapi request.
   * @param   {Object} h              The hapi response toolkit.
   * @param   {Object} [json]         The controller's payload / template context.
   * @param   {String|Boolean} [responseType] Optional override; see the module
   *                                          header for how this is supplied.
   * @returns {Object} A hapi response, a redirect, a view, or a Boom 500.
   */
  function respond(request, h, json, responseType) {
    // Never computed here - see the module header. The typeof test keeps an
    // explicit `false` distinguishable from an omitted argument.
    if (typeof responseType === 'undefined') {
      responseType = request.responseType;
    }

    var response;
    // Allow controller to override the default redirect via json.redirectTo
    var redirectUrl = (json && json.redirectTo) || success.redirect;
    if (redirectUrl) {
      // This runs BEFORE projection and before the flash injection below, which
      // is why json.redirectTo works on a raw controller object and why a
      // redirect response does NOT drain the flash bag. Do not reorder.
      response = Redirect.redirect(request, h, redirectUrl, json);
      return response;
    }

    // ObjectUtils.pull takes the FIELD SPEC FIRST, then the source. It throws on
    // a malformed spec and ObjectUtils.serialize silently drops every null and
    // undefined value - both are part of the payload shape on the wire, so
    // neither may be wrapped in a try/catch nor "hardened" here. A throw belongs
    // to lib/http/errorMap.js, which maps it to a 500.
    json = replySpec
      ? ObjectUtils.pull(replySpec, json || {})
      : ObjectUtils.serialize(json || {});

    // PRESERVED QUIRK 4 - see docs/PRESERVED-QUIRKS.md. The bare flash() call
    // DRAINS the flash bag; it is a mutation, not an accessor. It fires on every
    // success response, HTML or JSON. Do not cache it, call it twice or move it.
    json.flash   = request.yar.flash();
    json.context = request.yar.get('context');

    // Remove IP and referrer from the lastView section
    //
    // PII scrub. BOTH forms below are required: `json.data` is an array on list
    // endpoints and a single document on show endpoints. Dropping either branch
    // would leak the viewer's IP address and referrer, and reshaping either one
    // would change the payload on the wire. Only viewedOn and viewType survive.
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

    // The HTML gate. All three conditions matter: the client must have
    // negotiated html, the route must declare a success template, and the
    // request path must not end in .json - the extension-duplicated twin of an
    // HTML route always answers JSON.
    if (responseType === 'html' && success.html && !JSON_EXT.test(request.url.pathname)) {
      addUserContext(json, request);

      if (typeof(success.html) === 'string') {
        // The embed-template override: an embed page whose trinket carries its
        // own template lets the TRINKET win over the declaration. The equality
        // test is against that literal declaration string by design.
        var template = success.html === 'embed/{lang}.html' && json.trinket && json.trinket.template
          ? json.trinket.template
          : success.html;

        json.isMobile = isMobile(request);
        json.aceOff = aceOff(request);

        // The template NAME is interpolated too - that is how 'embed/{lang}.html'
        // resolves. StringUtils.interpolate throws on a non-string template and
        // that throw must propagate to lib/http/errorMap.js.
        template = StringUtils.interpolate(template, json);
        response = h.view(template, json);
        return response;
      }
      else if (success.html.redirect) {
        // The object form of `html`. Sole consumer repo-wide: POST /courses in
        // config/routes.js, html: { redirect: '/{user.username}/courses/{course.slug}' }.
        response = Redirect.redirect(request, h, success.html.redirect, json);
        return response;
      }
      else {
        // Terminal failure: `html` was declared as an object with no redirect.
        // Carried across verbatim. Boom.internal is a 500, so hapi replaces this
        // message with 'An internal server error occurred' on the wire - the text
        // is invisible to clients but is preserved anyway, and it is RETURNED
        // rather than thrown, which was measured wire-equivalent on hapi 21.
        log.error('unexpected response format', success, json);
        response = Boom.internal('Unexpected response format');
        return response;
      }
    }
    else {
      // The JSON path - and also the path taken by an HTML request on a route
      // that declares no success template at all.
      response = h.response(json);
      return response;
    }
  }

  /**
   * The failure responder - today's request.fail, relocated from
   * lib/util/routeParser.js:L482-L514.
   *
   * Both arguments after `h` are optional, and every combination is reachable:
   * lib/controllers/files.js:L110 calls it with none at all, and seven
   * controller sites hand it straight to a promise as a rejection handler, which
   * puts the error in `json` and leaves `err` undefined.
   *
   * @param   {Object} request        The hapi request.
   * @param   {Object} h              The hapi response toolkit.
   * @param   {Object} [json]         The failure payload; also the flashed 'failure' value.
   * @param   {*}      [err]          Logged only; never reaches the client.
   * @param   {String|Boolean} [responseType] Optional override; see the module header.
   * @returns {Object} A hapi response, a redirect, or a view - NEVER an error.
   */
  function reject(request, h, json, err, responseType) {
    // Never computed here - see the module header.
    if (typeof responseType === 'undefined') {
      responseType = request.responseType;
    }

    var response;
    // PRESERVED QUIRK 3 - see docs/PRESERVED-QUIRKS.md. The double-quoted space
    // and the trailing `err` are carried across untouched. Used as a promise
    // rejection handler - .catch(request.fail) at lib/controllers/pages.js:L54,
    // lib/controllers/trinket.js:L285/:L333/:L916 and
    // lib/controllers/course.js:L309/:L495/:L516 - the error lands in `json`, so
    // `err` is undefined and the line logs "<inspected error> undefined". The
    // guard also means a no-argument call logs nothing at all.
    if (json) {
      log.info(util.inspect(json) + " " + err);
    }

    if (responseType === 'html' && fail.redirect) {
      if (json) {
        request.yar.flash('failure',  json, true);
        // PRESERVED QUIRK 1 - see docs/PRESERVED-QUIRKS.md. This writes the
        // interpolated URL back into the route's OWN `fail` object, which is
        // closed over once at parse time. The placeholders are therefore gone
        // for every later request on this route, which reuses the first
        // request's interpolation - a genuine cross-request state leak that
        // clients may depend on. Do NOT introduce a local variable, and do NOT
        // copy `fail` to make this safe.
        fail.redirect = StringUtils.interpolate(fail.redirect, json);
      }
      // Persisted with yar's isOverride flag so the form can be re-rendered
      // after the redirect. Both of these fire even when `json` is falsy.
      request.yar.flash('payload', request.payload, true);
      request.yar.flash('query',   request.query,   true);
      response = Redirect.redirect(request, h, fail.redirect, json);
      return response;
    }

    // Reached only when the redirect branch did not fire. The bare flash() here
    // drains the bag - quirk 4 again.
    json       = json || {};
    json.flash = request.yar.flash();

    if (responseType === 'html' && fail.html && !JSON_EXT.test(request.url.pathname)) {
      // Deliberate asymmetry with respond(): `fail.html` is used WITHOUT the
      // typeof-string guard and WITHOUT interpolation. An object-valued
      // fail.html would reach h.view() as-is. Preserved exactly.
      addUserContext(json, request);
      response = h.view(fail.html, json);
      return response;
    }
    else {
      // PRESERVED QUIRK 2 - see docs/PRESERVED-QUIRKS.md. No status is ever set,
      // so a failure answers HTTP 200 with a body of { flash: ... }. Live proof:
      // lib/controllers/files.js:L108-L111 returns a bare failure for a bad
      // thumbnail secret and the client receives 200. Do not add a status code,
      // do not return a Boom, do not "correct" this.
      response = h.response(json);
      return response;
    }
  }

  // EXACTLY two keys, `respond` first - quirk 6 above.
  return {
    respond : respond,
    reject  : reject
  };
}

module.exports = {
  createResponders : createResponders,
  addUserContext   : addUserContext,
  isMobile         : isMobile,
  aceOff           : aceOff
};

