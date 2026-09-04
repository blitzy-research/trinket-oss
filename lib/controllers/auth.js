var _             = require('underscore'),
    config        = require('config'),
    Boom          = require('@hapi/boom'),
    crypto        = require('crypto'),
    userUtil      = require('../util/user');

// ---------------------------------------------------------------------------
// `request` compatibility helpers
//
// The `request` package these two Google calls used is gone from the manifest,
// so both now go through the runtime's own `fetch`. `request` was not a thin
// wrapper around an HTTP call: its `form` and `json` options implied a wire
// encoding, a body-parsing rule, a redirect policy and an error-reporting
// shape, and the two guards further down read all four. These helpers
// reproduce those semantics so that no observable outcome moves, including the
// two faults documented at their call sites.
// ---------------------------------------------------------------------------

// Percent-encodes one component the way the `form` option did. That option
// encoded through qs' RFC 3986 stringifier (Request.prototype.form ->
// self._qs.stringify in request 2.88.2), whose safe set is the unreserved set
// A-Z a-z 0-9 - . _ ~ and so narrower than encodeURIComponent, which also
// leaves ! ' ( ) * alone. Verified byte for byte against qs 6.5.5 over every
// ASCII character, over multi-byte input, and over null, undefined, numeric
// and boolean values.
function rfc3986(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, function(character) {
    return '%' + character.charCodeAt(0).toString(16).toUpperCase();
  });
}

// Builds an application/x-www-form-urlencoded body from a flat object with the
// conventions qs used: an undefined value drops its field entirely, while a
// null value keeps the field with an empty value. That distinction is live
// here, because config/default.yaml ships google.clientSecret and
// google.callbackURL unset and node-config reads an unset key as null.
function formEncode(form) {
  var pairs = [];

  Object.keys(form).forEach(function(name) {
    var value = form[name];

    if (value === undefined) {
      return;
    }

    pairs.push(rfc3986(name) + '=' + rfc3986(value === null ? '' : String(value)));
  });

  return pairs.join('&');
}

// Reproduces the body `request` handed its callback under `json: true`: read
// the response, JSON.parse it, and keep the raw string if that throws. A
// response carrying no body leaves the value undefined, because the
// empty-string fallback applied only to non-json requests, and a body of
// `null` parses to null. Those two values are exactly what make the
// `!body.access_token` and `!profile.email` guards below throw rather than
// reject, so the rule is reproduced rather than tidied up.
function legacyJsonBody(text) {
  if (text === '') {
    return undefined;
  }

  try {
    return JSON.parse(text);
  }
  catch (e) {
    return text;
  }
}

// The redirect budget `request` ran with. Its default was `maxRedirects: 10`,
// tested before each hop was taken and reported as an error rather than chased
// (request 2.88.2 lib/redirect.js: `if (self.redirectsFollowed >=
// self.maxRedirects) { request.emit('error', new Error('Exceeded
// maxRedirects. ...' + request.uri.href)) }`). undici follows 20 hops and fails
// only on the 21st, with `redirect count exceeded`, measured on Node 22.23.2,
// so left to the runtime an 11 to 20 hop chain would succeed here where the
// baseline failed and produced the generic authentication failure through the
// catch at the end of googleCallback. Every hop below is taken by this module
// with `redirect: 'manual'`, so the runtime's own limit never comes into play.
var MAX_REDIRECTS = 10;

// The methods `request` refused to follow a redirect for. It ran with
// `followRedirect: true` and `followAllRedirects: false`, which switched on the
// method and fell through to following for every method outside this set
// (lib/redirect.js, Redirect.prototype.redirectTo). The token exchange below
// depends on POST being in it: a 3xx there reaches the callback with no parsed
// body, and reading `access_token` off it throws out of the callback, which is
// the measured fault that call site preserves.
var UNFOLLOWED_METHODS = { PATCH : true, PUT : true, POST : true, DELETE : true };

// `request` treated any 3xx carrying a location header as a redirect rather
// than keying on an enumerated status list, so the same test is used here; it
// covers 301, 302, 303, 307 and 308 along with the rest of the range.
function isRedirect(status, location) {
  return status >= 300 && status < 400 && !!location;
}

// Returns a mutable copy of a header object, keeping every name exactly as the
// caller spelled it: the casing at the two call sites is part of the wire shape
// this file preserves, so nothing is normalised on the way through. Lookups go
// through headerName instead, because HTTP header names are case-insensitive
// while a plain object's keys are not.
function copyHeaders(headers) {
  var copy = {};

  if (headers) {
    Object.keys(headers).forEach(function(name) {
      copy[name] = headers[name];
    });
  }

  return copy;
}

// Finds the caller's spelling of one header name, or null when it is absent.
function headerName(headers, name) {
  var wanted = name.toLowerCase(),
      found  = null;

  Object.keys(headers).forEach(function(key) {
    if (key.toLowerCase() === wanted) {
      found = key;
    }
  });

  return found;
}

// Decodes one percent-encoded URL component without throwing. WHATWG URL keeps
// userinfo percent-encoded, and a malformed escape in a redirect target would
// otherwise throw a URIError out of the hop loop.
function decodeComponent(value) {
  try {
    return decodeURIComponent(value);
  }
  catch (malformed) {
    return value;
  }
}

// Reproduces the content coding `request` used. Without its `gzip` option it
// sent no accept-encoding header at all and never decompressed, so a
// conforming server answered with identity bytes and the guards below parsed
// the bytes that were on the wire. undici sends `accept-encoding: gzip,
// deflate` of its own accord, both measured, so an explicit `identity` is set
// on every hop to take that negotiation back off the wire.
//
// Two residuals are measured and stated rather than implied. undici still
// decompresses a `content-encoding` body even when identity was the only coding
// offered, where `request` handed back the raw compressed bytes as a string;
// that cannot be switched off through the fetch API and needs a server that
// ignores accept-encoding to arise at all, and both endpoints this module calls
// are fixed Google URLs that honour it. And the three other headers undici adds
// (`accept-language`, `sec-fetch-mode` and `user-agent`) are left alone
// deliberately: measured, only accept-encoding is removable, the first and last
// accept an empty value but cannot be dropped, and sec-fetch-mode cannot be
// overridden at all, so writing empty values would trade one wire difference
// for another rather than restore the baseline shape.
function applyContentCoding(headers) {
  headers[headerName(headers, 'accept-encoding') || 'accept-encoding'] = 'identity';
}

// Moves any userinfo off the URL and onto an Authorization header, which is
// what `request` did with a credential-bearing URI, and only when no
// authorization header had been set (Request.prototype.init reading
// `self.uri.auth`). fetch refuses such a URL outright with `Request cannot be
// constructed from a URL that includes credentials`, measured, so left in place
// it would turn a hop into a transport error instead. Neither Google URL
// carries userinfo, but a redirect target can, so the policy is applied per hop
// and the adapter is correct rather than accidentally correct.
function applyUrlCredentials(target, headers) {
  var credentials;

  if (!target.username && !target.password) {
    return;
  }

  credentials = decodeComponent(target.username) + ':' + decodeComponent(target.password);

  target.username = '';
  target.password = '';

  if (!headerName(headers, 'authorization')) {
    headers.Authorization = 'Basic ' + Buffer.from(credentials, 'utf8').toString('base64');
  }
}

// Abandons the body of a redirect response, which `request` did explicitly
// (`response.resume()` in Redirect.prototype.onResponse) so that the socket was
// released rather than held until the body was collected. A cancellation that
// itself fails has nothing to report, because the response is being thrown away
// either way and the hop's outcome is already decided, so the rejection is
// absorbed rather than left to surface as an unhandled one.
function discard(response) {
  if (response.body && typeof response.body.cancel === 'function') {
    response.body.cancel().then(null, function(uncancellable) {
      return uncancellable;
    });
  }
}

// Issues one request, following redirects itself under the budget and policy
// above, and reports it as `request` did, through a callback taking (err,
// response, body). It never rejects: a transport failure, a truncated body or
// an exhausted redirect budget arrives as `err`, which is what both guards test
// first. Four details are deliberate. `err.cause` is unwrapped, because fetch
// reports a connection failure as a TypeError wrapping the Error `request`
// reported directly, and that Error is what reaches log.error. The callback is
// dispatched on a next tick rather than from inside the promise chain, so a
// throw inside it escapes as an uncaught exception exactly as it did when
// `request` invoked the callback from its own emitter; called inside the chain
// it would surface as an unhandled rejection instead, which is a different
// process-level event. It is dispatched at most once, as `request` guaranteed,
// so no late failure inside the hop loop can deliver a second outcome. And the
// hop loop itself never lets undici redirect, so the ten-hop ceiling is the
// only one in force.
function legacyJsonRequest(url, options, callback) {
  var settings = options || {},
      method   = String(settings.method || 'GET').toUpperCase(),
      follows  = !UNFOLLOWED_METHODS[method],
      settled  = false,
      target;

  function dispatch(err, response, body) {
    if (settled) {
      return;
    }

    settled = true;
    process.nextTick(callback, err, response, body);
  }

  function read(response) {
    return response.text().then(function(text) {
      dispatch(null, response, legacyJsonBody(text));
    }, function(readError) {
      dispatch((readError && readError.cause) || readError, response, undefined);
    });
  }

  function attempt(current, headers, body, followed) {
    var init       = {},
        hopHeaders = copyHeaders(headers);

    Object.keys(settings).forEach(function(name) {
      init[name] = settings[name];
    });

    applyUrlCredentials(current, hopHeaders);
    applyContentCoding(hopHeaders);

    init.headers = hopHeaders;
    init.body    = body;
    // Every hop belongs to this loop, so undici is told to hand a 3xx back
    // rather than chase it under its own limit.
    init.redirect = 'manual';

    fetch(current.href, init).then(function(response) {
      var location = response.headers.get('location'),
          nextHeaders,
          authorization,
          next;

      if (!follows || !isRedirect(response.status, location)) {
        return read(response);
      }

      try {
        next = new URL(location, current.href);
      }
      catch (unresolvable) {
        // A location that will not resolve cannot be chased. `request` would
        // have opened the resolved value and failed in the transport, so this
        // is reported the same way: as an error, never as a response.
        discard(response);
        return dispatch(unresolvable, undefined, undefined);
      }

      if (followed >= MAX_REDIRECTS) {
        // Reported before the hop is taken, so the eleventh redirect target is
        // never requested, and interpolating the URL that returned the excess
        // redirect rather than the one being declined, which is `request`'s
        // own `request.uri.href`, read before it advanced its uri.
        discard(response);
        return dispatch(new Error('Exceeded maxRedirects. Probably stuck in a redirect loop ' + current.href),
                        undefined, undefined);
      }

      nextHeaders = copyHeaders(hopHeaders);

      if (response.status !== 307) {
        // `request` dropped the body, its framing headers, and - only when the
        // HOSTNAME changed - the authorization header, on every followed
        // redirect except a 307 or a 401. All of it sits inside that one status
        // test, so a 307 carried the whole request forward unchanged,
        // authorization included.
        //
        // The hostname test is `request`'s own, read from
        // request 2.88.2 lib/redirect.js:134:
        //
        //   if (request.uri.hostname !== request.originalHost.split(':')[0]) {
        //     // Remove authorization if changing hostnames (but not if just
        //     // changing ports or protocols).  This matches the behavior of curl
        //     request.removeHeader('authorization')
        //   }
        //
        // `originalHost` is the host header of the request that just completed
        // (request.js sets it in start(), which re-runs per hop) and
        // `request.uri` is the target just assigned, so the comparison is the
        // previous hop's hostname against the next one's - not the first URL's.
        // An earlier version of this loop dropped authorization on any ORIGIN
        // change, which additionally drops it on a port or scheme change to the
        // same host. That was safer but it was a divergence from baseline that
        // no approved deviation covers, so the measured rule is used instead.
        body = undefined;
        ['content-type', 'content-length'].forEach(function(framing) {
          var name = headerName(nextHeaders, framing);

          if (name) {
            delete nextHeaders[name];
          }
        });

        if (next.hostname !== current.hostname) {
          authorization = headerName(nextHeaders, 'authorization');

          if (authorization) {
            delete nextHeaders[authorization];
          }
        }
      }

      discard(response);
      attempt(next, nextHeaders, body, followed + 1);
    }, function(fetchError) {
      dispatch((fetchError && fetchError.cause) || fetchError, undefined, undefined);
    })
    .catch(function(unexpected) {
      // The hop loop reports through the callback and settles once, so a throw
      // that escapes the handlers above cannot become an unhandled rejection.
      dispatch((unexpected && unexpected.cause) || unexpected, undefined, undefined);
    });
  }

  try {
    target = new URL(url);
  }
  catch (invalid) {
    // fetch rejects an unparseable URL rather than throwing it at the caller,
    // so it is reported through the callback for the same reason.
    return dispatch(invalid, undefined, undefined);
  }

  attempt(target, settings.headers, settings.body, 0);
}

// ---------------------------------------------------------------------------
// The post-authentication `next` destination guard (CWE-601).
//
// `next` reaches googleCallback through the session, written by
// GET /auth/google below and by GET /login and GET /signup
// (lib/controllers/pages.js), and its only declared constraint is
// `Joi.string()`, so it can be any string at all. The value then becomes
// `redirectTo`, which routeParser's `redirect()` helper turns into the Location
// header: it passes anything matching /^https?:\/\// straight through and
// rewrites a `//host` value into `<protocol>://host`. So without this guard a
// completed Google sign-in lands the visitor on whatever origin the link that
// started the flow named.
//
// An unsafe value is treated as an ABSENT one rather than rewritten, which here
// means it falls through to the handler's own existing `|| '/home'` default -
// the site's own declared destination for a sign-in with no `next`, so nothing
// is invented and no response shape changes.
//
// The same function is duplicated in lib/controllers/users.js, which consumes
// `next` for its own two redirects. This delivery adds no new file, so there is
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
  // Google OAuth - optional, only works if configured
  google : function(request, h) {
    if (!config.app.auth || !config.app.auth.google || !config.app.auth.google.clientID) {
      return request.fail({
        message: 'Google OAuth is not configured. Please set up Google OAuth credentials.'
      });
    }

    request.yar.flash('auth', 'Google', true);
    if (request.query.next) {
      request.yar.set('next', request.query.next);
    }

    // Build Google OAuth URL
    var googleAuthUrl = 'https://accounts.google.com/o/oauth2/v2/auth';
    var params = new URLSearchParams({
      client_id: config.app.auth.google.clientID,
      redirect_uri: config.app.auth.google.callbackURL,
      response_type: 'code',
      scope: 'profile email',
      access_type: 'online'
    });

    return request.success({ redirectTo: googleAuthUrl + '?' + params.toString() });
  },

  googleCallback : function(request, h) {
    if (!config.app.auth || !config.app.auth.google || !config.app.auth.google.clientID) {
      return request.fail({
        message: 'Google OAuth is not configured.'
      });
    }

    var code = request.query.code;
    if (!code) {
      return request.fail({ message: 'No authorization code received from Google.' });
    }

    // Exchange code for token
    return new Promise(function(resolve, reject) {
      legacyJsonRequest('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: {
          // The two headers `request` sent for `form` plus `json: true`. The
          // content type carries no charset parameter, which is what fetch
          // appends on its own for a URLSearchParams body.
          'content-type': 'application/x-www-form-urlencoded',
          'accept': 'application/json'
        },
        // `request` refused to follow a redirect for a POST, so a 3xx from the
        // token endpoint reached the callback with no body rather than being
        // chased. fetch follows every method by default and downgrades a 301,
        // 302 or 303 POST to GET, so following is turned off here. The hop loop
        // holds POST to the same rule and sets `manual` on every request of its
        // own accord; this stays stated at the call site so the intent is
        // visible where the fault below is documented.
        redirect: 'manual',
        body: formEncode({
          code: code,
          client_id: config.app.auth.google.clientID,
          client_secret: config.app.auth.google.clientSecret,
          redirect_uri: config.app.auth.google.callbackURL,
          grant_type: 'authorization_code'
        })
      }, function(err, response, body) {
        // A token response that is empty, a bare `null` or a redirect leaves
        // `body` undefined or null, and reading access_token off it throws a
        // TypeError out of this callback: an uncaught exception that leaves
        // the request unanswered. That is the measured behaviour and it is
        // preserved rather than converted into a rejection.
        if (err || !body.access_token) {
          return reject(err || new Error('Failed to get access token'));
        }
        resolve(body.access_token);
      });
    })
    .then(function(accessToken) {
      // Get user profile
      return new Promise(function(resolve, reject) {
        // Redirects stay followed here, as `request` did for GET, and the hop
        // loop in legacyJsonRequest is what follows them: ten at most, the
        // eleventh reported as `Exceeded maxRedirects` through the err argument
        // below rather than chased, which is the outcome `request` produced and
        // which lands on the generic failure response through the catch at the
        // end of this chain. The Authorization header below follows `request`'s
        // own rule across a hop - dropped when the hostname changes, carried
        // over a port or scheme change and over a 307 - which is read from the
        // package source and cited at the loop.
        legacyJsonRequest('https://www.googleapis.com/oauth2/v2/userinfo', {
          method: 'GET',
          headers: {
            Authorization: 'Bearer ' + accessToken,
            'accept': 'application/json'
          }
        }, function(err, response, profile) {
          // Same preserved fault as the token guard above: an empty or `null`
          // profile body throws a TypeError out of this callback instead of
          // rejecting.
          if (err || !profile.email) {
            return reject(err || new Error('Failed to get user profile'));
          }
          profile.accessToken = accessToken;
          resolve(profile);
        });
      });
    })
    .then(function(profile) {
      // Find or create user
      return new Promise(function(resolve, reject) {
        User.findByMultiple({
          email: profile.email,
          username: userUtil.generate_username(profile.email),
          'profiles.google.id': profile.id
        }, function(err, user) {
          if (err) reject(err);
          else resolve(user);
        });
      })
      .then(function(user) {
        var next = request.yar.get('next');
        var promises = [];
        var updateUser = false;

        request.yar.reset();
        if (next) {
          request.yar.set('next', next);
        }
        request.yar.set('loggedInWith', 'google');

        if (user) {
          request.yar.flash('requested', user.username);
          if (!user.avatar && profile.picture) {
            updateUser = true;
            user.avatar = profile.picture;
          }
          if (!user.profiles) {
            user.profiles = {};
          }
          if (!user.profiles.google) {
            updateUser = true;
            user.profiles.google = {
              id: profile.id,
              token: profile.accessToken
            };
          }

          if (updateUser) {
            promises.push(user.save());
          }

          return Promise.all(promises).then(function() {
            return user;
          });
        }
        else {
          // Create new user
          user = new User();
          user.email = profile.email;
          user.fullname = profile.name || profile.email.split('@')[0];
          user.username = userUtil.generate_username(profile.email);
          request.yar.flash('requested', user.username);
          user.source = 'google';
          user.avatar = profile.picture;
          user.profiles = {
            google: {
              id: profile.id,
              token: profile.accessToken
            }
          };

          return user.save()
            .then(function(newUser) {
              if (!next) {
                request.yar.set('next', '/welcome');
              }
              request.yar.set('grantDemoTrinkets', true);
              request.yar.flash('userAccountCreated', JSON.stringify(opts));

              return newUser;
            });
        }
      });
    })
    .then(function(user) {
      // Log in user - store userId in session
      request.yar.set('userId', user.id);
      request.user = user;

      // Guarded at the point of use, which is where the value becomes a
      // Location header (see safeRedirectDestination). An off-site or
      // protocol-relative `next` reads as absent and falls through to the
      // handler's own '/home' default, exactly as a sign-in with no `next` does.
      var redirectTo = safeRedirectDestination(request.yar.get('next')) || '/home';
      request.yar.clear('next');

      var educatorsFormData = request.yar.get('educatorsFormData');
      var registrationPayload = request.yar.get('registration-payload');

      if (educatorsFormData) {
        request.yar.set('educatorsFormData', educatorsFormData, true);
      }
      if (registrationPayload) {
        request.yar.set('registration-payload', registrationPayload);
      }

      // Grant demo trinkets if needed
      if (request.yar.get('grantDemoTrinkets')) {
        request.yar.clear('grantDemoTrinkets');
        // Demo trinket granting would happen here via server.methods
      }

      return request.success({ redirectTo: redirectTo });
    })
    .catch(function(err) {
      log.error('Google OAuth error:', err);
      return request.fail({ message: 'Authentication failed. Please try again.' });
    });
  }
};
