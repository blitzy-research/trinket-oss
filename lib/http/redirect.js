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

// The destination helpers below confine only USER-CONTROLLED destinations to this application's own
// host: the `next` query parameter or payload field, and the values interpolated into a root-relative
// fail.redirect template. They are deliberately NOT applied inside redirect() above, whose fourth
// branch must let an already-absolute http(s) target through - lib/controllers/auth.js#google depends
// on it to hand the browser its accounts.google.com URL.
//
// Control characters are rejected rather than tolerated, because browsers and proxies treat a raw tab,
// CR or LF inside a Location value as a separator. Two constants rather than one, deliberately: a /g
// regex advances lastIndex on every test() and would answer differently on the next call.
// See docs/PRESERVED-QUIRKS.md section 4.4.
var CONTROL_CHARACTER    = /[\u0000-\u001f\u007f]/;
var CONTROL_CHARACTERS_G = /[\u0000-\u001f\u007f]/g;

// One DNS label: what lib/util/nunjucks.js#host prefixes onto config.app.url.hostname
// when config.app.usersubdomains is on ('instructor.trinket.dev'). Anchored and
// dot-free, so 'a.b.trinket.dev' and 'trinket.dev.evil.example' both fail it.
var SINGLE_DNS_LABEL = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

/**
 * Normalize a host[:port] under a given scheme, using the same parser the browser
 * will use on the Location value: case is folded, a default port is dropped, and a
 * percent-encoded or unicode host is resolved. Answers null for anything unparseable.
 *
 * @param   {String} protocol The candidate's protocol, including the trailing colon.
 * @param   {*}      host     A host or host:port, or a full origin.
 * @returns {String|null} The normalized host[:port], else null.
 */
function normalizeHost(protocol, host) {
  if (typeof host !== 'string' || host.length === 0) {
    return null;
  }

  // A full origin is accepted as well as a bare host: config.url is assembled as
  // protocol://hostname[:port] at config/app.config.js:L16-L17.
  var candidate = /^[a-z][a-z0-9+.\-]*:\/\//i.test(host) ? host : protocol + '//' + host,
      parsed    = URL.parse(candidate);

  return parsed && parsed.host ? parsed.host : null;
}

/**
 * Every host[:port] that is this application's own, normalized under `protocol` - the
 * scheme the CANDIDATE carries, which is what makes the comparison scheme-insensitive.
 *
 * The HOST is deliberately the whole of the comparison. Confining by complete origin -
 * scheme, host and port together - would change the emitted Location on a deployment
 * whose configured scheme differs from the scheme in use: it would refuse
 * `http://<configured-host>/x` where configuration publishes `https`, and it would refuse
 * the origin the client itself addressed whenever hapi answers plain HTTP behind a
 * TLS-terminating proxy or an ephemeral test listener. The cross-scheme acceptance that
 * follows is a preserved quirk; tightening it would change emitted Location values.
 * See docs/PRESERVED-QUIRKS.md section 4.4.
 *
 * Three sources, all of them configuration or the request itself - never the candidate:
 *   1. config.url, the origin redirect() absolutizes every declarative redirect onto, so
 *      a target already carrying it is the same destination;
 *   2. config.app.url.hostname[:port], the same origin read straight from configuration,
 *      which also covers a caller that loaded this module without config/app.config.js
 *      having assembled config.url;
 *   3. request.info.host - the Host the client itself addressed. Including it is what
 *      makes a deployment whose config.app.url differs from the address in use
 *      (localhost:3000 in development, an ephemeral port under supertest, 127.0.0.1
 *      under the baseline harness) behave the same as production. It cannot be abused: an
 *      attacker cannot set a victim's Host header, and a Location back to the host the
 *      client already addressed is by definition not an off-origin redirect.
 *
 * @param   {String} protocol  The candidate's protocol, including the trailing colon.
 * @param   {Object} [request] The hapi request, when one is available.
 * @returns {Array} Normalized host[:port] strings; possibly empty.
 */
function applicationHosts(protocol, request) {
  var appUrl = config.app && config.app.url ? config.app.url : {},
      port   = (appUrl.port === 0 || appUrl.port) ? ':' + appUrl.port : '',
      hosts  = [];

  [
    config.url,
    appUrl.hostname ? appUrl.hostname + port : null,
    request && request.info ? request.info.host : null
  ].forEach(function(source) {
    var host = normalizeHost(protocol, source);

    if (host && hosts.indexOf(host) === -1) {
      hosts.push(host);
    }
  });

  return hosts;
}

/**
 * True when `host` is one extra DNS label in front of `applicationHost` on the same
 * port - the user-subdomain shape ('instructor.trinket.dev' against 'trinket.dev').
 *
 * Both arguments arrive already normalized under the candidate's own scheme, so this
 * test is scheme-insensitive for the same behavior-parity reason applicationHosts() is.
 *
 * @param   {String} host            The candidate's normalized host[:port].
 * @param   {String} applicationHost An application host[:port] to test against.
 * @returns {Boolean} True only for exactly one additional label.
 */
function isUserSubdomain(host, applicationHost) {
  var candidate = host.split(':'),
      own       = applicationHost.split(':'),
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
 * Accept a destination only if it is unambiguously on this application's own host.
 *
 * Two shapes qualify, and both are returned BYTE-FOR-BYTE so the emitted Location
 * is the destination the caller asked for:
 *
 *   1. An in-application path: a string beginning with exactly one '/' ('/home',
 *      '/account/profile', '/courses/x?y=1#z').
 *   2. An absolute http(s) URL whose parsed host[:port] is one of this application's own
 *      (see applicationHosts), including a user subdomain when
 *      config.app.usersubdomains is on. This shape is REQUIRED, not a convenience: the
 *      frozen assignment UI sends the learner back to the page they were on by
 *      percent-encoding window.location.href into `next`, and the Location that produces
 *      is recorded in test/baseline/responses.json#assignmentNext.
 *
 * Everything else is refused: off-origin absolute URLs, the userinfo disguise whose real
 * host is off-origin ('https://trinket.dev@evil.example' parses to host evil.example), the
 * suffix lookalike ('https://trinket.dev.evil.example'), scheme-relative URLs, the
 * backslash form browsers normalize into one, non-http(s) schemes, header-splitting
 * payloads, and bare relative values ('courses/x') that would resolve against whatever
 * path the browser is currently on. A same-host target on the other scheme is NOT refused;
 * see applicationHosts and docs/PRESERVED-QUIRKS.md section 4.4.
 *
 * URL.parse() is the static, non-throwing WHATWG parser: it answers null rather than
 * raising on the relative and scheme-less input that reaches here, and it applies the same
 * host normalization the browser will apply to the Location.
 *
 * @param   {*}      value     The candidate destination.
 * @param   {Object} [request] The hapi request, used for its Host; optional, and
 *                             without it only the configured host is allowed.
 * @returns {String|null} The unchanged value when it is on an application host,
 *                        else null.
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

  // The HOST is what confines the destination to this application, so http and https are both
  // accepted on it: a same-host Location cannot leave the origin.
  var hosts = applicationHosts(parsed.protocol, request),
      index;

  for (index = 0; index < hosts.length; index++) {
    if (parsed.host === hosts[index]) {
      return value;
    }

    if (config.app && config.app.usersubdomains && isUserSubdomain(parsed.host, hosts[index])) {
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
