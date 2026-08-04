/**
 * Declarative redirect helper.
 *
 * Resolves the `redirect` declarations carried by config/routes.js and
 * config/api_routes.js into a concrete Location target: params are merged into
 * `json` when the template carries a {word} placeholder, the template is
 * interpolated, and the result is absolutized. All four declarative forms route
 * through here - success.redirect, json.redirectTo, success.html.redirect and
 * fail.redirect.
 *
 * config.url and config.app.url.protocol are different values: config.url is
 * assembled in config/app.config.js as protocol://hostname[:port].
 */
var _           = require('underscore'),
    config      = require('config'),
    StringUtils = require('./../util/stringUtils');

// Hapi 20+ redirect helper
function redirect(request, h, urlTemplate, json) {
  // for "simple" redirects where params are simply copied to a new location
  if (/{\w+}/.test(urlTemplate)) {
    // Two-argument _.extend MUTATES `json` in place, and the caller observes the
    // merged params: respond()/reject() go on to project and flash this very
    // object. Copying instead (_.extend({}, ...), Object.assign, spread) would
    // change what gets flashed. A falsy `json` is returned unchanged.
    json = _.extend(json, request.params);
  }

  // A falsy `json` skips interpolation and the raw template is used. A non-string
  // template throws out of StringUtils.interpolate into the centralized error map
  // and becomes a 500; that is the mapping, so no type guard or coercion here.
  var redirectURL = json ? StringUtils.interpolate(urlTemplate, json) : urlTemplate;

  // Absolutization order is load-bearing - each branch is reachable from a real
  // route declaration and decides the emitted Location header:
  //   '//cdn.example.com/x' gains the scheme only
  //   '/home'               gains the full origin
  //   'account/email'       gains the origin and a separator
  //   'https://host/x'      falls through untouched
  if (/^\/\//.test(redirectURL)) {
    redirectURL = config.app.url.protocol + ':' + redirectURL;
  }
  else if (/^\//.test(redirectURL)) {
    redirectURL = config.url + redirectURL;
  }
  else if (!/^https?:\/\//.test(redirectURL)) {
    redirectURL = config.url + '/' + redirectURL;
  }

  // Declarative redirects are temporary by contract: h.redirect() defaults to
  // HTTP 302 and no declaration overrides it, so no .permanent(), .code(301) or
  // .takeover() belongs here.
  return h.redirect(redirectURL);
}

// SECURITY REMEDIATION (review finding SEC-4, CWE-601) - the helpers below,
// recorded in docs/PRESERVED-QUIRKS.md section 4.4. They are deliberately NOT
// applied inside redirect() above: branch 4 of that cascade lets an already
// absolute http(s) target through, and lib/controllers/auth.js#google depends on
// it to hand the browser its https://accounts.google.com/o/oauth2/v2/auth URL.
// Confining every declarative redirect would break Google sign-in, so the
// enforcement lives at the two boundaries where the destination is genuinely
// USER-CONTROLLED: the `next` query parameter / payload field, and the values
// interpolated into a root-relative fail.redirect template.
//
// Control characters are stripped rather than tolerated because browsers and
// proxies treat a raw tab, CR or LF inside a Location value as a separator, so
// '/\r\n//evil.example' would otherwise re-open the same hole the leading-slash
// test closes.
// Two constants rather than one, deliberately: a /g regex advances lastIndex on
// every test() and would answer differently on the next call.
var CONTROL_CHARACTER    = /[\u0000-\u001f\u007f]/;
var CONTROL_CHARACTERS_G = /[\u0000-\u001f\u007f]/g;

// One DNS label: what lib/util/nunjucks.js#host prefixes onto config.app.url.hostname
// when config.app.usersubdomains is on ('instructor.trinket.dev'). Anchored and
// dot-free, so 'a.b.trinket.dev' and 'trinket.dev.evil.example' both fail it.
var SINGLE_DNS_LABEL = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

/**
 * Normalize a COMPLETE origin - scheme://host[:port] - using the same parser the
 * browser will use on the Location value: case is folded, a default port is dropped,
 * and a percent-encoded or unicode host is resolved. Answers null for anything
 * unparseable and for anything that is not http(s).
 *
 * `source` may be a full origin - config.url is assembled as protocol://hostname[:port]
 * at config/app.config.js:L16-L17 - or a bare host[:port], in which case `protocol`
 * supplies the scheme.
 *
 * @param   {*}      source   A full origin, or a host[:port].
 * @param   {String} protocol The scheme to assume for a bare host, including the colon.
 * @returns {String|null} The normalized scheme://host[:port], else null.
 */
function normalizeOrigin(source, protocol) {
  if (typeof source !== 'string' || source.length === 0) {
    return null;
  }

  var candidate = /^[a-z][a-z0-9+.\-]*:\/\//i.test(source) ? source : protocol + '//' + source,
      parsed    = URL.parse(candidate);

  if (!parsed || !parsed.host || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) {
    return null;
  }

  return parsed.protocol + '//' + parsed.host;
}

/**
 * The scheme this deployment publishes itself under, from configuration only.
 * config/default.yaml:L30 declares `https`; a development config/local.yaml declares
 * `http`. Never read from the candidate destination, and never from a request header.
 *
 * @returns {String} 'http:' or 'https:'; https when configuration is silent, because
 *                   defaulting to the weaker scheme would license a downgrade.
 */
function canonicalProtocol() {
  var appUrl = config.app && config.app.url ? config.app.url : {};

  return appUrl.protocol === 'http' ? 'http:' : 'https:';
}

/**
 * The origin the client actually addressed, as this server saw it. hapi builds
 * request.url as a WHATWG URL from the listener's protocol and the Host header, so its
 * origin is authoritative for the connection that is being answered; request.info.host
 * plus server.info.protocol is the fallback for a caller that hands us a partial double.
 *
 * @param   {Object} [request] The hapi request, when one is available.
 * @returns {String|null} The normalized origin, else null.
 */
function requestOrigin(request) {
  var protocol;

  if (!request) {
    return null;
  }

  if (request.url && request.url.protocol && request.url.host) {
    return normalizeOrigin(request.url.protocol + '//' + request.url.host, request.url.protocol);
  }

  protocol = request.server && request.server.info && request.server.info.protocol
    ? request.server.info.protocol + ':'
    : null;

  return protocol && request.info ? normalizeOrigin(request.info.host, protocol) : null;
}

/**
 * Every COMPLETE origin that is this application's own - scheme, host and port together.
 *
 * SECURITY REMEDIATION (review finding F-15/S-1, CWE-601). An earlier revision of this
 * module compared the HOST only, normalizing each application host under whichever
 * scheme the candidate carried, so `http://trinket.dev/x` was accepted on a deployment
 * that publishes `https://trinket.dev`. With no HSTS in the response contract
 * (app.js:L205-L240 sets no Strict-Transport-Security header), that let a crafted `next`
 * hand the browser a plaintext hop through the login flow. Origins are compared whole
 * now, so a cross-scheme target on the right host is refused like any other off-origin
 * one.
 *
 * Three sources, all of them configuration or the request itself - never the candidate:
 *   1. config.url, the origin redirect() absolutizes every declarative redirect onto, so
 *      a target already carrying it is the same destination;
 *   2. config.app.url.protocol + hostname[:port], the same origin read straight from
 *      configuration, which also covers a caller that loaded this module without
 *      config/app.config.js having assembled config.url;
 *   3. the origin the client addressed - what makes a deployment whose config.app.url
 *      differs from the address in use (localhost:3000 in development, an ephemeral port
 *      under supertest, 127.0.0.1 under the R-6 harness) behave the same as production.
 *      It cannot be abused to widen the host: an attacker cannot set a victim's Host
 *      header, and a Location back to the host the client already addressed is by
 *      definition not off-origin. It IS refused when it would weaken the scheme, which
 *      is the case that matters behind a TLS-terminating proxy: there hapi sees plain
 *      http even though the browser spoke https, and admitting that origin would put the
 *      downgrade back.
 *
 * @param   {Object} [request] The hapi request, when one is available.
 * @returns {Array} Normalized scheme://host[:port] strings; possibly empty.
 */
function applicationOrigins(request) {
  var appUrl   = config.app && config.app.url ? config.app.url : {},
      port     = (appUrl.port === 0 || appUrl.port) ? ':' + appUrl.port : '',
      protocol = canonicalProtocol(),
      live     = requestOrigin(request),
      origins  = [];

  [
    normalizeOrigin(config.url, protocol),
    normalizeOrigin(appUrl.hostname ? appUrl.hostname + port : null, protocol),
    live && !(protocol === 'https:' && live.indexOf('http://') === 0) ? live : null
  ].forEach(function(origin) {
    if (origin && origins.indexOf(origin) === -1) {
      origins.push(origin);
    }
  });

  return origins;
}

/**
 * True when `origin` is one extra DNS label in front of `applicationOrigin` under the
 * SAME scheme and the same port - the user-subdomain shape
 * ('https://instructor.trinket.dev' against 'https://trinket.dev').
 *
 * The scheme is compared here too, for the same reason applicationOrigins() compares
 * whole origins: a subdomain reached over plaintext is still a downgrade.
 *
 * @param   {String} origin            The candidate's normalized scheme://host[:port].
 * @param   {String} applicationOrigin An application origin to test against.
 * @returns {Boolean} True only for exactly one additional label under the same scheme.
 */
function isUserSubdomain(origin, applicationOrigin) {
  var parts    = origin.split('//'),
      ownParts = applicationOrigin.split('//');

  if (parts[0] !== ownParts[0]) {
    return false;
  }

  var candidate = parts[1].split(':'),
      own       = ownParts[1].split(':'),
      suffix    = '.' + own[0];

  if ((candidate[1] || '') !== (own[1] || '')) {
    return false;
  }

  if (candidate[0].length <= suffix.length || candidate[0].slice(-suffix.length) !== suffix) {
    return false;
  }

  return SINGLE_DNS_LABEL.test(candidate[0].slice(0, candidate[0].length - suffix.length));
}

/**
 * Accept a destination only if it is unambiguously this application's own origin.
 *
 * Two shapes qualify, and both are returned BYTE-FOR-BYTE so the emitted Location
 * is the destination the caller asked for:
 *
 *   1. An in-application path: a string beginning with exactly one '/' ('/home',
 *      '/account/profile', '/courses/x?y=1#z').
 *   2. An absolute http(s) URL whose parsed origin - scheme, host and port together -
 *      is one of this application's own (see applicationOrigins), including a user
 *      subdomain under the same scheme when
 *      config.app.usersubdomains is on. This shape is REQUIRED, not a convenience:
 *      the frozen assignment UI sends the learner back to the page they were on by
 *      percent-encoding window.location.href into `next`
 *      (public/partials/directives/trinket-assignment.js#goto), and at the base
 *      commit login, signup and the OAuth callback all returned them there. Review
 *      finding P3-1; the measured baseline Location is recorded in
 *      test/baseline/responses.json#assignmentNext.
 *
 * Everything else is refused, which keeps the SEC-4 hole closed: off-origin absolute
 * URLs ('https://evil.example'), the userinfo disguise whose real host is off-origin
 * ('https://trinket.dev@evil.example' parses to host evil.example), scheme-relative
 * URLs ('//evil.example'), the backslash form browsers normalize into one
 * ('/\evil.example'), non-http(s) schemes ('javascript:', 'data:'), header-splitting
 * payloads, bare relative values ('courses/x') that would resolve against whatever
 * path the browser is currently on, and - since F-15/S-1 - a right-host target on the
 * wrong scheme ('http://trinket.dev/x' where the deployment publishes https).
 *
 * URL.parse() is the static, non-throwing WHATWG parser Node 22 added; it answers
 * null rather than raising on the relative and scheme-less input that reaches here,
 * and it applies the same host normalization the browser will apply to the Location.
 *
 * @param   {*}      value     The candidate destination.
 * @param   {Object} [request] The hapi request, used for its Host; optional, and
 *                             without it only the configured origin is allowed.
 * @returns {String|null} The unchanged value when it is same-origin, else null.
 */
function internalDestination(value, request) {
  if (typeof value !== 'string' || value.length === 0) {
    return null;
  }

  // First, and for every shape: a backslash is normalized to '/' by browsers, and a
  // raw control character splits the Location header.
  if (value.indexOf('\\') !== -1 || CONTROL_CHARACTER.test(value)) {
    return null;
  }

  if (value.charAt(0) === '/') {
    // Exactly one leading slash is an in-application path; '//host' is scheme-relative.
    return value.charAt(1) === '/' ? null : value;
  }

  var parsed = URL.parse(value);

  if (!parsed || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) {
    return null;
  }

  // The COMPLETE origin - scheme, host and port - is what confines the destination to
  // this application. Comparing only the host would accept 'http://trinket.dev/x' on a
  // deployment that publishes 'https://trinket.dev', which is the downgrade F-15/S-1
  // reported; there is no Strict-Transport-Security header in the response contract to
  // catch it afterwards.
  var origin  = parsed.protocol + '//' + parsed.host,
      origins = applicationOrigins(request),
      index;

  for (index = 0; index < origins.length; index++) {
    if (origin === origins[index]) {
      return value;
    }

    if (config.app && config.app.usersubdomains && isUserSubdomain(origin, origins[index])) {
      return value;
    }
  }

  return null;
}

/**
 * Force a destination onto this application's own origin.
 *
 * Used where a target is mandatory and cannot simply be dropped - the
 * fail.redirect templates in config/routes.js are declared root-relative, so the
 * interpolated result must stay root-relative too. Control characters are
 * removed and a leading run of separators collapses to a single '/', which
 * leaves an ordinary path such as '/sign-up' untouched and turns
 * '//evil.example' into the same-origin '/evil.example'.
 *
 * @param   {String} value       The interpolated destination.
 * @returns {String} A root-relative, same-origin destination.
 */
function confineToOrigin(value) {
  var confined = String(value).replace(CONTROL_CHARACTERS_G, '');

  return '/' + confined.replace(/^[\/\\]+/, '');
}

module.exports = {
  redirect            : redirect,
  internalDestination : internalDestination,
  confineToOrigin     : confineToOrigin
};
