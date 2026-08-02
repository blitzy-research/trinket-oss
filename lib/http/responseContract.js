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
 *
 * createResponders() is called once per route at parse time so that the route's
 * own `success` and `fail` declaration objects are closed over: reject() writes
 * the interpolated URL back into `fail`, and that write is observable across
 * requests only because the closure outlives any one of them.
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

  // Closed over once per route, and never copied: reject()'s write-back needs
  // `fail` to be the route's own declaration object.
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
        log.error('unexpected response format', success, json);
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
    if (json) {
      log.info(util.inspect(json) + " " + err);
    }

    if (responseType === 'html' && fail.redirect) {
      // SECURITY REMEDIATION (review finding SEC-4, CWE-601/CWE-362), recorded in
      // docs/PRESERVED-QUIRKS.md section 4.4 - and the reason `target` is a local.
      //
      // The base commit interpolated the template and wrote the RESULT BACK into
      // the route's own `fail` object, which is closed over once at parse time:
      //   fail.redirect = StringUtils.interpolate(fail.redirect, json);
      // Two consequences, both measured. `POST /users` declares
      // `fail : { redirect : '/{formName}' }` (config/routes.js:L75-L77) and
      // `formName` is an unconstrained `Joi.string().required()` payload field,
      // so (a) one failed signup with formName='//evil.example' emitted an
      // off-origin Location, and (b) the placeholder was GONE from the shared
      // declaration afterwards, so every later failure on that route - for every
      // other visitor, until restart - reused the attacker's value.
      //
      // The local `target` removes the cross-request leak: each request now
      // interpolates the declared template exactly as the FIRST request after a
      // restart did, which is the behavior the baseline route declaration
      // describes. confineToOrigin() then keeps a root-relative declaration
      // root-relative, so an interpolated value can no longer promote '/x' to
      // '//evil.example' or '/\evil.example'. Both are no-ops for every
      // legitimate value: '/{formName}' with formName='sign-up' is '/sign-up'
      // before and after.
      var target = fail.redirect;

      if (json) {
        request.yar.flash('failure',  json, true);
        target = StringUtils.interpolate(target, json);

        if (/^\//.test(fail.redirect) && !Redirect.internalDestination(target)) {
          target = Redirect.confineToOrigin(target);
        }
      }
      // yar's isOverride flag persists these so the form can be re-rendered after
      // the redirect. Both fire even when `json` is falsy.
      request.yar.flash('payload', request.payload, true);
      request.yar.flash('query',   request.query,   true);
      response = Redirect.redirect(request, h, target, json);
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

module.exports = {
  createResponders : createResponders,
  addUserContext   : addUserContext,
  isMobile         : isMobile,
  aceOff           : aceOff
};
