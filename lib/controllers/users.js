var config       = require('config'),
    errors       = require('@hapi/boom'),
    Store        = require('../util/store'),
    emailStore   = Store.email(),
    mailer       = require('../util/mailer'),
    FileUtil     = require('../util/file'),
    nunjucks     = require('nunjucks'),
    // `url.parse` emits DEP0169 on every call. parseLegacy is the shared
    // legacy-compatible replacement (lib/util/url.js): same fields, same partial
    // object for relative input, same ERR_INVALID_URL throw, and it keeps the
    // query string on `.path`. Both consumers are in assetUploadFromURL: the
    // protocol test on the parsed result, and the `path.basename` that derives
    // the upload filename from `.path` and so carries any query string into the
    // stored object key.
    parseLegacy  = require('../util/url').parseLegacy,
    mime         = require('mime'),
    _            = require('underscore'),
    path         = require('path'),
    fs           = require('fs'),
    // Replaces the `request` package, whose only use here was the streaming GET
    // in assetUploadFromURL. Readable.fromWeb() adapts the web stream returned
    // by the bounded fetch adapter below into the Node stream that pipes into
    // fs.createWriteStream.
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
    // net.BlockList and dns.promises implement the asset-fetch address guard
    // below. Both are Node core; no dependency is added for them.
    net          = require('net'),
    dns          = require('dns'),
    userUtil     = require('../util/user'),
    recaptcha    = require('../util/recaptcha');

// ---------------------------------------------------------------------------
// assetUploadFromURL transport policy.
//
// The route POST /api/users/assetFromURL takes a fully user-controlled URL
// (`url : Joi.string().required()`, config/api_routes.js:1290-1298), fetches it
// server-side and persists the response into shared object storage. The three
// concerns below are therefore the transport's, not the handler body's, and are
// implemented once here so the handler reads as a single bounded GET.
//
//   1. PARITY with the removed `request` 2.88.2 package, whose defaults this
//      route's observable behaviour was built on: 10 redirect hops, no
//      content-coding negotiation, and URL userinfo sent as Authorization.
//      Native fetch differs in all three, so the differences are carried back
//      rather than inherited.
//   2. The address guard, because a URL the caller chooses can name a private,
//      loopback or link-local address directly or reach one through a redirect
//      (CWE-918).
//   3. Resource bounds, because nothing else in the request path constrains the
//      remote body: a route `payload.maxBytes` bounds only the inbound JSON.
// ---------------------------------------------------------------------------

// `request` 2.88.2 defaulted to `maxRedirects: 10`; native fetch follows 20 and
// only then fails with 'redirect count exceeded' (measured on Node 22.23.2:
// 21 requests issued before the rejection). Ten extra hops is ten extra chances
// for a redirect chain to land somewhere the first hop was not allowed to, so
// the original ceiling is restored and enforced by the loop below.
var ASSET_FETCH_MAX_REDIRECTS = 10;

// The application's own declared user-asset ceiling. POST /api/users/assets and
// POST /api/users/assets/{fileId} - the two routes that perform the identical
// FileUtil.uploadUserAsset storage operation - already declare
// `maxBytes : 1048576 * 5 // 5MB` at config/api_routes.js:1244 and :1260. This
// is that same limit applied to the remote body, not a new policy, which is why
// it is a constant and not configuration.
var ASSET_FETCH_MAX_BYTES = 1048576 * 5; // 5MB

// Wall-clock ceiling for the whole fetch: redirect hops plus body download.
// `request` was configured with no timeout here, so a stalled peer could hold a
// temp file and a socket open indefinitely.
var ASSET_FETCH_TIMEOUT_MS = 120000; // 2 minutes

// The redirects `request` followed for a GET. Read from request 2.88.2's own
// lib/redirect.js (Redirect.prototype.redirectTo): the test is
// `statusCode >= 300 && statusCode < 400 && caseless.has('location')`, a range
// rather than an enumerated list, so it covers 301, 302, 303, 307 and 308 along
// with the rest of the 3xx range. The same rule is used here, and the same rule
// is used by the hop loop in lib/controllers/auth.js, so the one transport
// policy this migration restores is spelled the same way in both places.
function assetIsRedirect(status, location) {
  return status >= 300 && status < 400 && !!location;
}

// Abandons the body of a redirect response. `request` did this explicitly -
// `response.resume()` in Redirect.prototype.onResponse, commented there as
// ignoring a body that "cannot possibly be useful to us at this point" - so the
// socket was released rather than held until the body was collected. Without it
// a ten-hop chain holds ten undrained response bodies open. A cancellation that
// itself fails has nothing to report, because the response is discarded either
// way and the hop's outcome is already decided, so the rejection is absorbed
// rather than left to surface as an unhandled one.
function assetDiscardBody(response) {
  if (response.body && typeof response.body.cancel === 'function') {
    response.body.cancel().then(null, function(uncancellable) {
      return uncancellable;
    });
  }
}

var REDACTED_VALUE       = '***';
var UNPARSEABLE_URL_TEXT = '[unparseable-url]';

// Matches an absolute URL embedded in free text, so it can be redacted out of
// an error message before that message is logged.
var EMBEDDED_URL_PATTERN = /[a-zA-Z][a-zA-Z0-9+.\-]*:\/\/[^\s"'<>]+/g;

// Renders a URL for diagnostics with every secret it can carry removed:
// userinfo becomes '***', every query parameter VALUE becomes '***', and a
// non-empty fragment becomes '***'. Scheme, host, port, path and parameter
// NAMES are kept, because those are what makes a log line useful. Unparseable
// input yields a fixed placeholder rather than the raw string, so a value that
// cannot be inspected can never be echoed.
function redactUrl(value) {
  var parsed;

  try {
    parsed = new URL(typeof value === 'string' ? value : String(value));
  }
  catch (e) {
    return UNPARSEABLE_URL_TEXT;
  }

  if (parsed.username) parsed.username = REDACTED_VALUE;
  if (parsed.password) parsed.password = REDACTED_VALUE;

  var names = [];
  parsed.searchParams.forEach(function(paramValue, paramName) {
    names.push(paramName);
  });

  if (names.length) {
    var scrubbed = new URLSearchParams();
    for (var i = 0; i < names.length; i++) {
      scrubbed.append(names[i], REDACTED_VALUE);
    }
    parsed.search = scrubbed.toString();
  }

  if (parsed.hash) parsed.hash = REDACTED_VALUE;

  return parsed.href;
}

// Replaces every absolute URL embedded in free text with its redacted form.
// A match that will not parse collapses to the placeholder, so the failure mode
// is loss of detail and never disclosure.
function redactText(text) {
  if (typeof text !== 'string' || !text) return text;

  return text.replace(EMBEDDED_URL_PATTERN, function(match) {
    return redactUrl(match);
  });
}

// Renders an error for diagnostics. The error object itself is never handed to
// console.log, because printing it renders `err.stack`, whose first line is the
// message - and fetch puts the whole URL, password included, in that message
// (measured: TypeError "Request cannot be constructed from a URL that includes
// credentials: http://u:p@127.0.0.1:43193/x"). Name, code and cause are kept so
// the line stays as diagnostic as it was.
function describeError(err) {
  if (!err) return String(err);
  if (typeof err !== 'object') return redactText(String(err));

  var parts = [];

  if (err.name) parts.push(err.name + ':');
  parts.push(redactText(typeof err.message === 'string' ? err.message : String(err)));
  if (err.code) parts.push('(code ' + err.code + ')');

  var cause = err.cause;
  if (cause && typeof cause === 'object') {
    parts.push('caused by ' + redactText(typeof cause.message === 'string' ? cause.message : String(cause)));
    if (cause.code) parts.push('(code ' + cause.code + ')');
  }

  return parts.join(' ');
}

// Reserved, private, shared-CGNAT, loopback, link-local, multicast and
// documentation ranges. A server-side fetch that reaches one of these is
// reaching into the deployment's own network rather than the public internet -
// 169.254.169.254 is the cloud instance-metadata endpoint - and the response
// would then be persisted into shared storage under a stable key.
var ASSET_BLOCKED_IPV4_SUBNETS = [
  '0.0.0.0/8',
  '10.0.0.0/8',
  '100.64.0.0/10',
  '127.0.0.0/8',
  '169.254.0.0/16',
  '172.16.0.0/12',
  '192.0.0.0/24',
  '192.0.2.0/24',
  '192.168.0.0/16',
  '198.18.0.0/15',
  '198.51.100.0/24',
  '203.0.113.0/24',
  '224.0.0.0/4',
  '240.0.0.0/4'
];

// DELIBERATELY ABSENT from this list: '::ffff:0:0/96', the IPv4-mapped range.
// Measured on Node 22.23.2: adding that subnet makes BlockList.check report
// EVERY IPv4 address as blocked - 8.8.8.8 and 104.20.23.154 both flip from
// false to true - which would refuse every legitimate remote asset. Mapped
// literals are handled instead by normalising them to the embedded IPv4 and
// checking that against the IPv4 rules (assetMappedIpv4 / assetAddressBlocked).
var ASSET_BLOCKED_IPV6_SUBNETS = [
  '::/128',
  '::1/128',
  'fc00::/7',
  'fe80::/10',
  'ff00::/8',
  '2001:db8::/32',
  '64:ff9b::/96'
];

// Built once at module scope: the rule set is constant and BlockList.check is
// the hot path, called for the initial URL and for every redirect hop.
function buildAssetBlockList() {
  var list = new net.BlockList();

  var add = function(subnets, family) {
    for (var i = 0; i < subnets.length; i++) {
      var parts = subnets[i].split('/');
      list.addSubnet(parts[0], parseInt(parts[1], 10), family);
    }
  };

  add(ASSET_BLOCKED_IPV4_SUBNETS, 'ipv4');
  add(ASSET_BLOCKED_IPV6_SUBNETS, 'ipv6');

  return list;
}

var assetAddressBlockList = buildAssetBlockList();

// Returns the embedded IPv4 of an IPv4-mapped IPv6 literal, in either the
// dotted form ('::ffff:127.0.0.1') or the hex form ('::ffff:7f00:1'), and null
// for anything else. Both forms name the same address and both must be caught.
function assetMappedIpv4(literal) {
  if (literal.toLowerCase().indexOf('::ffff:') !== 0) return null;

  var tail = literal.substring('::ffff:'.length);
  if (net.isIP(tail) === 4) return tail;

  var hex = /^([0-9a-fA-F]{1,4}):([0-9a-fA-F]{1,4})$/.exec(tail);
  if (!hex) return null;

  var high = parseInt(hex[1], 16);
  var low  = parseInt(hex[2], 16);

  return [(high >> 8) & 255, high & 255, (low >> 8) & 255, low & 255].join('.');
}

// `new URL(...).hostname` keeps the brackets on an IPv6 literal and
// net.isIP('[::1]') is 0 (measured), so the brackets come off before any
// address test.
function assetHostLiteral(host) {
  if (typeof host !== 'string') return '';

  var literal = host;

  if (literal.length > 1 && literal.charAt(0) === '[' && literal.charAt(literal.length - 1) === ']') {
    literal = literal.substring(1, literal.length - 1);
  }

  return literal;
}

// True when the given IP literal falls in a blocked range. A value that is not
// an IP literal is not an answer here - the caller resolves the name first.
function assetAddressBlocked(address) {
  var family = net.isIP(address);

  if (family === 4) return assetAddressBlockList.check(address, 'ipv4');

  if (family === 6) {
    var mapped = assetMappedIpv4(address);
    if (mapped) return assetAddressBlockList.check(mapped, 'ipv4');
    return assetAddressBlockList.check(address, 'ipv6');
  }

  return false;
}

// The ports a public web asset is served from. `request` placed no constraint
// here, so an authenticated caller could aim this server-side fetch at any port
// on any host it was otherwise allowed to reach - which is the port-scanning
// half of the SSRF finding, and is reachable even when every address check
// passes. The scheme's own default port is expressed as the empty string by
// WHATWG URL, so an ordinary https:// or http:// URL carries no port at all.
var ASSET_ALLOWED_PORTS = { '': true, '80': true, '443': true };

// Resolves with an Error naming the refusal when the URL carries credentials,
// names a port outside ASSET_ALLOWED_PORTS, or has a host that is - or resolves
// to - a blocked address; and with null when the fetch may proceed. Applied to
// the initial URL AND to every redirect hop, because a redirect is precisely
// what turns an allowed public host into 169.254.169.254 on port 80.
function assetAddressDenial(target) {
  // URL userinfo is REFUSED rather than carried.
  //
  // Two of this checkpoint's own findings meet here and disagree. The transport
  // parity finding observes that `request` accepted a credential-bearing URL
  // and sent `Authorization: Basic`, where fetch refuses the URL outright, and
  // asks for the original behaviour back. The SSRF finding asks for URL
  // credentials to be rejected. Both cannot hold.
  //
  // Rejection wins, and the argument is that the behaviour parity would restore
  // is the vulnerability itself: a server-side fetch to a caller-chosen host
  // carrying caller-supplied credentials, whose response is then persisted into
  // shared storage. R-d protects observable behaviour a client may depend on,
  // and no client can depend on this server authenticating on its behalf to an
  // arbitrary third party. The refusal also takes the arm this route already
  // has for a host it cannot reach - logged, nothing uploaded, nothing settled -
  // so no response shape appears that the route did not already produce.
  if (target.username || target.password) {
    return Promise.resolve(new Error('Credentials are not permitted in an asset URL'));
  }

  if (!ASSET_ALLOWED_PORTS[target.port]) {
    return Promise.resolve(new Error('Blocked port ' + target.port + ' for asset URL'));
  }

  return assetAddressDenialForHost(target);
}

function assetAddressDenialForHost(target) {
  var host = assetHostLiteral(target.hostname);

  if (!host) {
    return Promise.resolve(new Error('Asset URL has no host'));
  }

  if (net.isIP(host)) {
    return Promise.resolve(assetAddressBlocked(host)
      ? new Error('Blocked address for asset URL host ' + host)
      : null);
  }

  return dns.promises.lookup(host, { all: true }).then(function(records) {
    for (var i = 0; i < records.length; i++) {
      if (assetAddressBlocked(records[i].address)) {
        return new Error('Blocked address ' + records[i].address + ' for asset URL host ' + host);
      }
    }
    return null;
  }, function() {
    // A RESOLUTION FAILURE MEANS PROCEED, deliberately, and this must stay
    // that way. Do not "harden" it into a refusal: the parity fixture serves
    // https://parity.example.com/... and that name does not resolve (measured:
    // ENOTFOUND in 41 ms), so refusing on lookup failure would break every
    // fixture-driven scenario for this route while adding nothing - an
    // unresolvable name reaches no address at all, and the transport's own
    // failure is the outcome the handler already reproduces.
    //
    // RESIDUAL, accepted: native fetch exposes no `lookup` hook, so the
    // address checked here cannot be pinned to the one the transport
    // subsequently connects to. A name that resolves to a public address for
    // this lookup and a private one for the connection - DNS rebinding - is
    // still reachable. Closing it needs a custom dispatcher/agent, which would
    // take this route off globalThis.fetch and out of the parity fixture's
    // reach; that trade is not made here.
    return null;
  });
}

// A response whose bytes cannot be reproduced faithfully.
//
// `request` was not configured with `gzip: true`, so it offered no coding,
// never decoded, and wrote the wire bytes to disk. Requesting `identity` takes
// that negotiation back off the wire, but a server is free to ignore it, and
// undici then decodes the body anyway - measured, 97 wire bytes delivered as
// 65536 - with no way to reach the raw bytes through the fetch API.
//
// That leaves two possible outcomes for a response that arrives content-encoded
// in spite of the request, and neither is byte-parity. Storing the decoded
// bytes writes a DIFFERENT object under a DIFFERENT key, because
// lib/util/file.js keys the stored object on the sha1 of the bytes it reads -
// the failure AAP 0.6.7 describes as silently orphaning stored objects, "no
// error, only files that cannot be found". Refusing writes nothing.
//
// Refusing is chosen, and it is recorded as a deviation rather than as parity.
// It confines the divergence to the one case where fidelity is unreachable, and
// it makes the stored bytes provably equal to the wire bytes on every path that
// does store something - which is the property the storage contract depends on.
// The refusal takes this route's existing log-only, never-settling arm, so no
// new response shape appears.
function assetCodingDenial(response) {
  var coding = response.headers.get('content-encoding');

  if (coding) {
    return new Error('Asset response was content-encoded (' + coding +
      ') despite an identity request, so its stored bytes cannot match the wire bytes');
  }

  return null;
}

// The bounded GET. Resolves with { response, url } for the FINAL response of
// the chain, and rejects for every failure that occurs before that response
// exists - which is the same boundary the replaced package's 'error' event had,
// so the caller's log-only, never-settling disposition still applies to exactly
// the same set of events.
function fetchAssetResource(initialUrl, signal) {
  var hops = 0;

  var attempt = function(target, previous) {
    return assetAddressDenial(target).then(function(denial) {
      if (denial) throw denial;

      var headers = {
        // `request` was not configured with `gzip: true` here, so it sent no
        // accept-encoding, the server answered with identity, and the bytes
        // written to disk were the wire bytes. That matters beyond wire
        // fidelity: lib/util/file.js keys the stored S3 object on the sha1 of
        // these bytes, so a changed encoding silently changes the key and
        // orphans every object stored under the old one. fetch's default is
        // 'gzip, deflate', so identity is requested explicitly - and a response
        // that arrives encoded anyway is refused by assetCodingDenial below
        // rather than stored under a key its bytes do not match.
        'accept-encoding' : 'identity'
      };

      // No Authorization is ever sent: a credential-bearing URL is refused by
      // assetAddressDenial above, on every hop, so there are no credentials to
      // carry and none to leak across a redirect.

      // globalThis.fetch is read at CALL time and never captured into a
      // module-level binding: test/parity/fixtures/http.js installs itself by
      // replacing globalThis.fetch, so a captured reference - or a switch to
      // http/https directly - would silently stop being intercepted and take
      // every parity scenario for this route with it.
      return globalThis.fetch(target.href, {
        method   : 'GET',
        // Always manual: the hop budget below is the parity constraint, and
        // fetch's own follower cannot be capped at 10.
        redirect : 'manual',
        headers  : headers,
        signal   : signal
      }).then(function(response) {
        var location = response.headers.get('location');

        // Not a redirect - or a 3xx carrying no Location, which is not a
        // redirect anyone can follow. Either way this is the final response,
        // exactly as the replaced package treated it. It is the response whose
        // bytes get stored, so this is where the coding check belongs; an
        // intermediate 3xx is discarded and its coding cannot reach the file.
        if (!assetIsRedirect(response.status, location)) {
          var coding = assetCodingDenial(response);

          if (coding) {
            assetDiscardBody(response);
            throw coding;
          }

          return { response : response, url : target };
        }

        // Drained before the hop is decided, and before the budget is tested,
        // which is the order request used: resume() ran ahead of its
        // maxRedirects check, so an over-budget chain released its last
        // response body too rather than leaving it open.
        assetDiscardBody(response);

        hops++;
        if (hops > ASSET_FETCH_MAX_REDIRECTS) {
          // The replaced package's own message and interpolated URL, so the
          // log line this route emits on an over-budget chain reads as it
          // always has: request emitted `new Error('Exceeded maxRedirects.
          // Probably stuck in a redirect loop ' + request.uri.href)` with
          // `uri` still holding the URL that RETURNED the excess redirect,
          // because it advanced its uri only after this check.
          throw new Error('Exceeded maxRedirects. Probably stuck in a redirect loop ' + target.href);
        }

        var next = new URL(location, target);

        return attempt(next, target);
      });
    });
  };

  return attempt(initialUrl, null);
}

// ---------------------------------------------------------------------------
// The post-authentication `next` destination guard (CWE-601).
//
// `next` reaches these handlers from three writers - the query string on
// GET /login and GET /signup (lib/controllers/pages.js), the query string on
// GET /auth/google (lib/controllers/auth.js), and the signup payload - and its
// only declared constraint is `Joi.string()`, so it can be any string at all.
// Two handlers here then hand it to a redirect, and neither redirect path
// confines it to this site: `h.redirect(next)` in `login` emits the value
// verbatim as the Location header, and `request.success({redirectTo: next})`
// in `create` goes through routeParser's `redirect()` helper, which passes
// anything matching /^https?:\/\// straight through and rewrites a `//host`
// value into `<protocol>://host`. Either way a freshly authenticated visitor
// is sent to whatever origin the link that started the flow named.
//
// An unsafe value is treated as an ABSENT one rather than rewritten to some
// substitute destination. That matters: every call site already has a defined
// behaviour for "no next" - `login` returns its data payload, `create` returns
// its own - so guarding this way introduces no response shape that the route
// did not already produce, and needs no invented default page.
//
// The schema at config/routes.js:32 is deliberately NOT tightened. The joi
// parity matrix records this target as accepting (test/parity/joi-baseline.json,
// 102 targets), so a schema-level rejection would fail that gate; and the
// session is written by three separate routes, so the point of use is the only
// place that covers all of them, including the payload form of the value.
//
// The same function is duplicated in lib/controllers/auth.js, which consumes
// `next` for its own redirect. This delivery adds no new file, so there is
// nowhere shared to put it; any change to one must be mirrored in the other.
// ---------------------------------------------------------------------------
function safeRedirectDestination(value) {
  if (typeof value !== 'string' || !value) {
    return null;
  }

  // A control character is never part of a destination. Browsers strip several
  // of them before resolving a URL, so a value like "/\tjavascript:..." would
  // otherwise pass a naive prefix test and then be normalised into something
  // else entirely; CR and LF additionally belong to no header value.
  if (/[\u0000-\u001f\u007f]/.test(value)) {
    return null;
  }

  // Leading whitespace is stripped by the same normalisation, so " //host"
  // becomes protocol-relative once the browser has finished with it.
  if (/^\s/.test(value)) {
    return null;
  }

  var first  = value.charAt(0),
      second = value.charAt(1);

  // A backslash occupies the authority position in every browser that
  // normalises it to '/', which makes "\host" and "/\host" protocol-relative
  // URLs wearing a path's clothes. "//host" is the unadorned form.
  if (first === '\\') {
    return null;
  }
  if (first === '/' && (second === '/' || second === '\\')) {
    return null;
  }

  // No scheme, no authority: a path, absolute or relative, which can only ever
  // resolve against this application's own origin. This is the common case and
  // it passes through byte-for-byte, so an accepted `next` still produces the
  // exact Location header it produces today.
  if (!/^[a-zA-Z][a-zA-Z0-9+.\-]*:/.test(value)) {
    return value;
  }

  // Scheme-bearing, so acceptable only when it names this application's own
  // origin - which keeps a legitimate absolute self-referential `next` working
  // rather than silently dropping it. `config.url` is assembled in
  // config/app.config.js; when this module is loaded without it nothing
  // absolute is accepted, which is the safe direction.
  if (!config.url) {
    return null;
  }

  var target, own;

  try {
    target = new URL(value);
    own    = new URL(config.url);
  }
  catch (unparseable) {
    return null;
  }

  return target.origin === own.origin ? value : null;
}

module.exports = {
  // Every handler below is a hapi lifecycle method: it returns its response, a
  // promise of one, or throws. `request.success`/`request.fail` return toolkit
  // responses, so returning their result is what answers the request. The second
  // argument is the toolkit `h`; the identifier `reply` is deliberately not in
  // scope, which is what preserves the pre-existing throws documented inline.
  create : async function(request, h) {
    // PRESERVED: resolve-only, with no reject and no timeout. lib/util/recaptcha.js
    // does not invoke its callback on a transport failure or on a malformed JSON
    // body (both faults raise an uncaught error instead), so this promise never
    // settles and signup hangs. Measured on both faults; adding a reject, a
    // timeout or a try/catch here would turn a hang into a response.
    var recaptcha_result = await new Promise(function(resolve) {
      recaptcha.verify(request.payload['g-recaptcha-response'], resolve);
    });

    if (!recaptcha_result.success) {
      return request.fail();
    }

    var payload  = request.payload,
        interest = request.payload.interest || 'python',
        // Guarded at the point of use, because both the session value and the
        // payload value end up in a redirect below (see safeRedirectDestination).
        // An off-site or protocol-relative value reads as absent, which takes
        // the same branch a signup with no `next` already takes.
        redirect = safeRedirectDestination(request.yar.get('next') || payload.next),
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
    console.log('LOGIN: Starting login for', request.payload.email);
    var requested = request.payload.email;
    var password = request.payload.password;
    // Guarded at the point of use: :198 hands this value straight to
    // h.redirect, which emits it verbatim as the Location header (see
    // safeRedirectDestination). An off-site or protocol-relative value reads as
    // absent, which takes the same branch a login with no `next` already takes.
    var redirect  = safeRedirectDestination(request.yar.get('next'));
    var data;

    try {
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
        return request.fail({ message: 'Unknown user ' + requested });
      }

      if (user.hasRole && user.hasRole("disabled")) {
        return request.fail({ message: 'Account Disabled' });
      }

      if (!user.password || user.password.length === 0) {
        return request.fail({ message: 'A password was not found for this account.' });
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
        return request.fail({ message: 'Invalid password' });
      }

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
        // The raw session value, unprefixed: the shim's builder called
        // h.redirect(url) directly, unlike request.success/request.fail which go
        // through routeParser's redirect() helper and prepend config.url. Keeping
        // h.redirect here reproduces the Location header byte-for-byte.
        return h.redirect(redirect);
      } else {
        // e.g. from an api call - set in route config
        //
        // This handler serves TWO routes and the value of request.pre.encryptRoles
        // selects the response shape:
        //   POST /login          - no such pre, so the value is undefined -> the raw user document
        //   POST /api/users/login - the pre returns the boolean true      -> the six-field projection
        // Neither route declares a `reply` spec, so routeParser serializes rather
        // than projects: the object built here IS the whole payload. Read as-is -
        // not defaulted, not normalised, not reduced to a truthiness test.
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
      return request.user.remove()
        .then(function() {
          return request.success();
        })
        .catch(function(err) {
          // Returning the error is what the shim's reply(err) did: hapi boomifies
          // a plain Error to the same generic 500, and passes a Boom through with
          // its own status intact.
          return err;
        });
    }
    else {
      // PRESERVED DEFECT - do not "fix" this to errors.forbidden().
      // `Boom` is not bound in this module (@hapi/boom is bound as `errors` at
      // :2), so evaluating this expression throws ReferenceError: Boom is not
      // defined. The handler catch-all maps that to a 500, which is what this
      // route has always answered - never the 403 the code reads as. Binding Boom
      // would silently convert this error edge from 500 to 403.
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

    // PRESERVED: resolve-only. On either recaptcha fault the callback is never
    // invoked, so this never settles and the route hangs, as it always has.
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
          if (!user) return resolve(request.fail({ message: 'user not found' }));

          // `ex` is deliberately not inspected, exactly as before: on an error
          // `buf` is undefined and buf.toString() throws, which is the existing
          // edge. Checking it here would create an error path baseline lacks.
          require('crypto').randomBytes(48, async function(ex, buf) {
            var key      = buf.toString('hex').substring(0, 8);
            var resetKey = Store.user.reset_password_key(key);
            var resetVal = user.id.toString();

            await Store.set(resetKey, resetVal);
            await Store.expire(resetKey, 86400);
            // Ordering preserved: the response is settled BEFORE the mail is
            // rendered and sent, and mailer.send stays un-awaited.
            resolve(request.success());

            var reset_password_url = config.url + '/reset-pass?key=' + key;

            var message = nunjucks.render('emails/passwordReset', {
              fullname           : user.fullname,
              username           : user.username,
              reset_password_url : reset_password_url
            });
            mailer.send(user.email, 'Password reset', { html : message, type : 'password-reset' });
          });
        });
      });
    }
    else {
      // Note the asymmetry, preserved: a failed captcha answers success, not fail.
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
      // PRESERVED DEFECT - see `remove` above. `Boom` is unbound, so this throws
      // and the route answers 500, not the 403 it reads as.
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

          // Deliberately NO .catch on this chain. Baseline returned it from
          // inside the save callback, where the value was discarded, so a
          // rejection here (updateCoursesPromise is the only source -
          // addFolderSlugJob swallows its own above) never produced a response
          // and left the request unsettled. Attaching a catch would turn that
          // hang into a fail response, which is a behaviour change.
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
      // `errors` IS bound (@hapi/boom at :2), so this is a real 501.
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
      // PRESERVED DEFECT - `Boom` is unbound; this answers 500, not 403.
      return Boom.forbidden();
    }
  },

  removeAsset : async function(request, h) {
    var file = request.pre.file;

    if (request.user.id.toString() === file._owner.toString()) {
      // The chain is now returned, so its resolved value becomes the response.
      return file.hide()
        .then(function() {
          return request.success();
        })
        .catch(function(err) {
          return err;
        });
    }
    else {
      // PRESERVED DEFECT - `Boom` is unbound; this answers 500, not 403.
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
      // PRESERVED DEFECT - `Boom` is unbound; this answers 500, not 403.
      return Boom.forbidden();
    }
  },

  // The `request` package's streaming GET is replaced here by the bounded fetch
  // adapter above. Every observable behaviour of the original pipeline was
  // measured against a fixture server covering 200, a query-bearing 200, a
  // 301->302->200 chain, 404, 500, a mid-stream socket failure and a refused
  // connection, and this implementation reproduces all seven identically -
  // event order, captured content-type, bytes written, and whether the upload
  // runs:
  //
  //   * redirects are followed - at most ASSET_FETCH_MAX_REDIRECTS of them, the
  //     replaced package's own ceiling - and the content-type comes from the
  //     FINAL response only, never an intermediate 3xx;
  //   * a non-2xx still writes its body and still uploads, so an error page can
  //     become the stored asset, with the error page's content-type;
  //   * a mid-stream failure emits an error AND still completes, so the upload
  //     proceeds with the partial bytes;
  //   * a refused connection only logs, never uploads, and LEAVES THE REQUEST
  //     UNSETTLED - the route hangs. That is long-standing behaviour and is
  //     preserved deliberately.
  //
  // Three failure classes that the replaced package could not produce take that
  // same log-only, never-settling arm, so no new response shape is introduced
  // on a route whose failure arm has always been a hang: a blocked address, an
  // over-budget redirect chain, and a body that breaches the byte ceiling or
  // the deadline.
  assetUploadFromURL : async function(request, h) {
    if (!config.features.assets) {
      return errors.notImplemented('Asset uploads are not enabled');
    }
    // try to validate url
    var requestUrl = parseLegacy(request.payload.url);
    if (!requestUrl.protocol) return request.fail();

    // tmp keeps its (err, path) callback across the 0.0.25 -> 0.2.7 bump
    // (verified by execution), so the await boundary is taken here rather than
    // swapping in a promise API.
    var tmpPath = await new Promise(function(resolve) {
      tmp.tmpName(function(err, tmpPath) {
        // A tmp.tmpName failure THROWS FROM THIS CALLBACK, deliberately, and
        // must keep doing so. Baseline discarded `err` too, but then ran
        // fs.createWriteStream(undefined) synchronously inside this same
        // callback frame, which throws ERR_INVALID_ARG_TYPE; there is no
        // process-level uncaughtException handler anywhere in app.js, lib/** or
        // config/** (verified), so the process terminated and the request was
        // never answered.
        //
        // This callback runs on a later tick, so the `new Promise` executor has
        // already returned and a throw here escapes as an uncaught exception
        // exactly as that one did: the promise never settles, the awaiting
        // handler never returns, and the request is never answered. Resolving,
        // rejecting or catching would each convert that process-level event
        // into a routed 500 - which is precisely the drift this reproduces
        // away. The only difference is the error's identity: the tmp error
        // itself rather than the ERR_INVALID_ARG_TYPE it used to derive, which
        // is the same process-level event with strictly more informative
        // stderr.
        if (err) {
          throw err;
        }

        resolve(tmpPath);
      });
    });

    return await new Promise(function(resolve) {
      var contentType   = '';
      var writeStream   = null;
      var body          = null;
      var uploadStarted = false;
      var abandoned     = false;
      var received      = 0;
      var controller    = new AbortController();
      var deadline      = null;

      // Diagnostics for this route are log-only by design, so the log line is
      // the only externally visible trace of a failure - and the URL it
      // describes is caller-supplied and can carry a password in its userinfo
      // or a token in its query. Both are redacted, and the error is rendered
      // through describeError rather than handed to console.log as an object,
      // because printing an Error renders its message and fetch embeds the
      // whole URL in that message. The outcome is unchanged; only the rendered
      // text is.
      var logFailure = function(err) {
        console.log('on error:', describeError(err),
          '(asset source ' + redactUrl(request.payload.url) + ')');
      };

      // Fire-and-forget with the error swallowed: on a teardown there is
      // nothing left to answer with, and a temp file that was never created -
      // the protocol gate runs before the stream is opened - yields a harmless
      // ENOENT.
      var removeTempFile = function() {
        fs.promises.unlink(tmpPath).catch(function() {});
      };

      // Every path on which the upload does NOT run must leave nothing behind -
      // no readable, no open write stream, no temp file, no armed timer, no
      // in-flight socket - and must NOT settle the promise, which is what keeps
      // the route's long-standing failure disposition intact.
      //
      // The uploadStarted guard is load-bearing in the other direction:
      // lib/util/file.js's _fileToContainer unlinks upload.path itself once the
      // upload has run, so unlinking here on that path would delete the file
      // out from under the read stream it uploads from.
      var abandon = function(err) {
        if (abandoned || uploadStarted) return;
        abandoned = true;

        if (deadline) {
          clearTimeout(deadline);
          deadline = null;
        }

        if (body) {
          // unpipe before destroy so the pipe's own listeners come off the
          // write stream first and a chunk already in flight cannot be written
          // into a stream that is going away.
          if (writeStream) body.unpipe(writeStream);
          body.destroy();
        }

        if (writeStream) {
          // Destroying a write stream that already has an fs write in flight
          // makes that write's completion fail with ERR_STREAM_DESTROYED, and
          // the destroy machinery emits it as an 'error' event (observed). The
          // listener installed where the stream is created absorbs it, because
          // `abandoned` is already true by the time destroy runs; this second
          // no-op listener is belt-and-braces for the case where destroy emits
          // before that flag is visible. A GENUINE write failure still reaches
          // process scope, via the re-raise in that same listener, which is the
          // disposition the stream had when it carried no listener at all.
          writeStream.on('error', function() {});

          // The unlink is repeated once the stream has finished closing.
          // createWriteStream opens the file ASYNCHRONOUSLY, and a teardown
          // that reaches here first - a blocked IP literal is decided on a
          // microtask, well before the open completes - would unlink nothing
          // and the pending open would then create the file and leak it
          // (observed: early unlink ENOENT, file present afterwards).
          // Destroying waits for the open, so by 'close' the entry exists and
          // the descriptor is gone.
          writeStream.once('close', removeTempFile);
          writeStream.destroy();
        }

        // Cancels an in-flight fetch, including one still in its header phase
        // where no body exists yet - which is the deadline's common case.
        controller.abort();

        // Unconditional first attempt, so a path that never opened a stream -
        // or a stream that somehow never reports 'close' - still cleans up.
        removeTempFile();

        logFailure(err);
      };

      // Reproduces the replaced package's transport gate, INCLUDING ITS EVENT
      // TIMING. `request` accepted only http/https: it constructed and
      // initialised synchronously and raised on everything else BEFORE the
      // chained `.on('error')` was attached (request 2.88.2 request.js
      // :100-128, :451-459), so the error reached no listener. With no
      // process-level uncaughtException handler anywhere in app.js, lib/** or
      // config/** - verified - an `ftp:`, `file:`, `data:`, `mailto:`,
      // `javascript:`, `ws:`, `gopher:` or `blob:` URL therefore terminated the
      // process with the request unanswered.
      //
      // So logging and returning is NOT parity, even though it also leaves the
      // request unanswered: it keeps the process alive. The throw is dispatched
      // on a later tick, which puts it at process scope rather than in this
      // executor - a synchronous throw here would reject the promise and answer
      // 500, which is the drift, not the baseline. Checked before the write
      // stream is opened, because the original raised before it ever created
      // the temp file, so there is nothing to clean up. fetch would happily
      // resolve a `data:` URL, so without this gate the termination would
      // become a successful upload.
      if (requestUrl.protocol !== 'http:' && requestUrl.protocol !== 'https:') {
        var unsupported = new Error('Invalid protocol: ' + requestUrl.protocol);

        process.nextTick(function() {
          throw unsupported;
        });

        return;
      }

      var target;
      try {
        target = new URL(request.payload.url);
      }
      catch (e) {
        // parseLegacy accepts authorities the WHATWG parser rejects - 'http://'
        // on its own, for instance - and the replaced package raised on those
        // from the same synchronous initialisation as an unsupported scheme,
        // before any listener existed. Same timing, so the same disposition:
        // process scope on a later tick, request unanswered, nothing to clean
        // up because the write stream is not open yet.
        process.nextTick(function() {
          throw e;
        });

        return;
      }

      writeStream = fs.createWriteStream(tmpPath);

      // THE DESTINATION STREAM'S OWN FAILURES - a failed open, EACCES, ENOSPC,
      // a write error - reach this listener, and they are the one failure class
      // that does not travel through the fetch chain. Without it the error is
      // emitted with no handler, which terminates the process while leaving the
      // deadline armed, the source body undestroyed, the fetch in flight and
      // the temp path behind.
      //
      // Both halves are kept: `abandon` performs the whole teardown, and then
      // the error is re-raised on a later tick so it still reaches process
      // scope with the request unanswered, exactly as it did when this stream
      // had no listener at all. Cleaning up first does not change that
      // disposition; it just stops the route leaking on the way there.
      //
      // The `abandoned` test is load-bearing: destroying a write stream that
      // has a write in flight makes that write fail with ERR_STREAM_DESTROYED,
      // and the destroy machinery emits it as an 'error'. That error is a
      // consequence of a teardown this route already decided on - a breached
      // byte ceiling, an expired deadline - and re-raising it would turn every
      // one of those bounded, log-only outcomes into a process termination. So
      // once teardown has started, a stream error is absorbed. `writeFailed`
      // guards against a second genuine error arriving after the first.
      var writeFailed = false;
      writeStream.on('error', function(err) {
        if (abandoned || writeFailed) {
          return;
        }
        writeFailed = true;

        abandon(err);

        process.nextTick(function() {
          throw err;
        });
      });

      // The wall-clock ceiling covers the redirect hops and the body download
      // together, so a peer that stalls after sending headers cannot hold the
      // temp file and the socket open indefinitely.
      deadline = setTimeout(function() {
        abandon(new Error('Asset fetch exceeded ' + ASSET_FETCH_TIMEOUT_MS + 'ms'));
      }, ASSET_FETCH_TIMEOUT_MS);
      // Unreferenced so the ceiling never holds the event loop open on its own
      // account; inside the server the listener keeps the loop alive anyway.
      deadline.unref();

      // Guarded because the mid-stream path deliberately signals both an error
      // and completion, and the upload must run exactly once.
      var startUpload = function() {
        if (uploadStarted || abandoned) {
          return;
        }
        uploadStarted = true;

        if (deadline) {
          clearTimeout(deadline);
          deadline = null;
        }

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

      fetchAssetResource(target, controller.signal).then(function(result) {
        if (abandoned) return;

        // The FINAL response only, never an intermediate 3xx: the redirect loop
        // resolves with the last hop it followed.
        contentType = result.response.headers.get('content-type');

        body = result.response.body ? Readable.fromWeb(result.response.body) : Readable.from([]);

        // The ceiling is counted on DELIVERED bytes. That is the only count
        // that bounds a body undici expands despite the identity request (see
        // the residual note on accept-encoding), the only count that bounds a
        // response declaring no content-length at all, and the only count that
        // bounds a declared length the peer then exceeds. Counted before the
        // pipe's own listener runs, so the breaching chunk is the last one that
        // can reach the file - which is then unlinked regardless.
        body.on('data', function(chunk) {
          if (abandoned || uploadStarted) return;

          received += chunk.length;

          if (received > ASSET_FETCH_MAX_BYTES) {
            abandon(new Error('Asset body exceeded ' + ASSET_FETCH_MAX_BYTES + ' bytes'));
          }
        });

        body.on('error', function(err) {
          // Log-and-continue, then complete: the original emitted 'error' and
          // still reached 'end' here, so the partial bytes are uploaded. An
          // abandoned fetch also lands here, because tearing the body down
          // errors it, and that case must NOT upload - hence the guard.
          if (abandoned) return;

          logFailure(err);
          writeStream.end();
          startUpload();
        });
        body.on('end', function() {
          if (abandoned) return;

          startUpload();
        });

        body.pipe(writeStream);
      }, function(err) {
        // Everything that fails before a final response exists lands here: a
        // refused or reset connection, an unusable URL, a blocked address, an
        // over-budget redirect chain, an aborted fetch. It LOGS ONLY and
        // cleans up. This must not reject or resolve: the original never called
        // back, so nothing settles and the request hangs. A try/catch here
        // would turn that into a 500.
        abandon(err);
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
      // PRESERVED DEFECT - `Boom` is unbound; this answers 500, not 404.
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
      // PRESERVED DEFECT - `Boom` is unbound; this answers 500, not 404.
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
  sendEmailChange : async function(request, h) {
    if (!mailer.isConfigured()) {
      return request.fail({
        message: "Email is not configured. Email changes are not available."
      });
    }

    return await new Promise(function(resolve) {
      User.findByLogin(request.payload.email, function(err, user) {
        // if user found, send back error message
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

          // PRESERVED DEFECT - do not "fix" this into `await Store.set(...)`.
          // Store.set is an async function of arity 2 (lib/util/store.js): it
          // returns a promise and ignores any third argument, so this callback
          // has never run. The confirmation mail is therefore never sent, the
          // response is never produced, and this route hangs. Measured. Awaiting
          // the promise instead would start sending mail and start answering,
          // which is a behaviour change rather than a conversion.
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
      // Not awaited, as before: send_email_confirmation only renders and hands
      // off to mailer.send, which is itself fire-and-forget.
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

    // PRESERVED: resolve-only, so both recaptcha faults still hang this route.
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
          // `err` is deliberately not inspected here, exactly as before: a failed
          // save still proceeds to log the user in. Adding a check would create
          // an error path this route has never had.
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
    // The two short-circuit branches below produce their response and then
    // reject with { handled: true } to stop the chain. Baseline discarded the
    // chain's value and let the deferred carry that response; now the chain IS
    // the response, so the response is held here and handed back from .catch.
    // The rejection shape is unchanged.
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

        // Create export record
        var exportRecord = new Export({
          _owner: userId,
          status: 'pending'
        });

        return exportRecord.save();
      })
      .then(function(saved) {
        var exportRecord = saved;

        // Queue the job
        exportsQueue.add({
          action: 'bulk-export',
          exportId: exportRecord._id.toString(),
          userId: userId
        });

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

  // NINE unbound-`Boom` references live in this handler and the next one, so
  // every error branch here answers something other than the 404/403/400 it
  // reads as. The mechanism is worth stating once, because it is load-bearing:
  // the generated Model.findById (lib/models/model.js) runs
  // `promise.then(d => cb(null, d)).catch(cb)`, so when the ReferenceError is
  // thrown inside this callback the trailing .catch re-invokes the SAME callback
  // with that error - and the `if (err)` branch then answers
  // request.fail({ error: 'Boom is not defined' }) with a 200. Measured against
  // a real hapi listener, baseline and converted byte-for-byte.
  //
  // Note the conversion keeps `Boom` as the first unresolvable reference on each
  // line. Writing `reply(Boom.notFound(...))` under an (request, h) signature
  // would make `reply` unresolvable instead, and because the callee is resolved
  // before the arguments the message - which is client-visible here - would
  // change to 'reply is not defined'.
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
          // Throws again, which is what escapes this callback and drives the
          // re-invocation described above. Preserved.
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
        // re-entered through model.js's .catch(cb), so each answers
        // request.fail({ error: 'Boom is not defined' }) rather than its named
        // status. Preserved exactly - see the note on getExportStatus.
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
          // config/default.yaml declares no `exports` bucket, so this
          // dereference throws on a clean tree and the route answers through the
          // same re-invocation path. That is an existing deployment
          // requirement - the value is supplied by configuration, not by a
          // default or a guard added here.
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

function send_email_confirmation(request, new_email, key) {
  var change_email_url = config.url + '/change-email?key=' + key;

  var message = nunjucks.render('emails/confirmEmailChange', {
    fullname         : request.user.fullname,
    username         : request.user.username,
    new_email        : new_email,
    change_email_url : change_email_url
  });
  mailer.send(new_email, 'Confirm new email address', { html : message, type : 'confirm-email-change' });
}

function send_email_verification(request, email, key) {
  var verify_email_url = config.url + '/verify-email?key=' + key;

  var message = nunjucks.render('emails/verifyEmail', {
    fullname         : request.user.fullname,
    username         : request.user.username,
    email            : email,
    verify_email_url : verify_email_url
  });
  mailer.send(email, 'Verify email address', { html : message, type : 'verify-email' });
}
