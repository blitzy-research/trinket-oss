var _             = require('underscore'),
    config        = require('config'),
    Boom          = require('@hapi/boom'),
    crypto        = require('crypto'),
    userUtil      = require('../util/user');

// Google OAuth sign-in. `google` builds the consent URL; `googleCallback`
// exchanges the code for an access token, reads the profile, finds or creates
// the user, and logs them in.
//
// Both Google calls go through `fetch`, wrapped by legacyJsonRequest below,
// which supplies what googleCallback's two guards depend on: a form-encoded
// body, a JSON body that falls back to raw text, a redirect policy this module
// runs itself rather than leaving to the runtime, and a failure reported
// through a callback argument rather than a rejection.

// Percent-encodes one form field name or value to RFC 3986: the safe set is
// the unreserved set A-Z a-z 0-9 - . _ ~, so the five characters ! ' ( ) *
// that encodeURIComponent leaves alone are escaped here too.
function rfc3986(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, function(character) {
    return '%' + character.charCodeAt(0).toString(16).toUpperCase();
  });
}

// Builds an application/x-www-form-urlencoded body from a flat object. An
// undefined value drops its field entirely while a null value keeps the field
// with an empty value, and that distinction is live here: config/default.yaml
// ships google.clientSecret and google.callbackURL unset, and node-config
// reads an unset key as null, so those fields go out empty rather than as the
// string "null".
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

// Parses a response body as JSON, keeping the raw string when the parse
// throws, so an HTML error page from either endpoint arrives as text instead
// of failing here. A response carrying no body at all becomes `undefined`, and
// a body of `null` parses to null. Those two values are what make the
// `!body.access_token` and `!profile.email` guards below throw rather than
// reject.
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

// The redirect budget for the hop loop below: ten hops are followed, and the
// eleventh is refused before its target is requested and reported through the
// callback as an `Exceeded maxRedirects` error. In googleCallback that error
// rejects the chain, so the visitor gets the generic authentication failure.
// Every hop is issued with `redirect: 'manual'`, so this is the only redirect
// ceiling in force; the runtime's own is never reached.
var MAX_REDIRECTS = 10;

// The methods whose redirects are not followed; every other method is
// followed under the budget above. The token exchange below depends on POST
// being in this set: a 3xx there reaches its callback as the response itself,
// with no parsed body, and reading `access_token` off that throws.
var UNFOLLOWED_METHODS = { PATCH : true, PUT : true, POST : true, DELETE : true };

// Any 3xx carrying a location header counts as a redirect, rather than an
// enumerated list of statuses, so 301, 302, 303, 307 and 308 are covered along
// with the rest of the range.
function isRedirect(status, location) {
  return status >= 300 && status < 400 && !!location;
}

// Returns a mutable copy of a header object, keeping every name exactly as the
// caller spelled it, so nothing is normalised on the way to the wire. Lookups
// therefore go through headerName, because HTTP header names are
// case-insensitive while a plain object's keys are not.
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

// Asks each hop for identity bytes, overwriting any accept-encoding the caller
// set: the runtime offers `gzip, deflate` of its own accord, and the response
// body is read as text and handed to JSON.parse, so a compressed body that
// arrived undecoded would be parsed as garbage. There is no way to send no
// accept-encoding header at all, so identity is stated explicitly.
function applyContentCoding(headers) {
  headers[headerName(headers, 'accept-encoding') || 'accept-encoding'] = 'identity';
}

// Moves any userinfo off the URL and onto an Authorization header, and only
// when the caller has not set one of its own. fetch refuses a
// credential-bearing URL outright -- `Request cannot be constructed from a URL
// that includes credentials` -- so left on the URL it would turn the hop into
// a transport error. Neither Google URL carries userinfo, but a redirect
// target can, so the move is applied on every hop.
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

// Abandons the body of a redirect response so the socket is released rather
// than held until the body has been collected. A cancellation that itself
// fails has nothing to report, because the response is being thrown away
// either way and the hop's outcome is already decided, so the rejection is
// deliberately absorbed rather than left to surface as an unhandled one.
function discard(response) {
  if (response.body && typeof response.body.cancel === 'function') {
    response.body.cancel().then(null, function(uncancellable) {
      return uncancellable;
    });
  }
}

// Issues one request, following redirects itself under the budget and policy
// above, and reports the outcome through a callback taking (err, response,
// body). Nothing is thrown or rejected at the caller: an unparseable URL, a
// transport failure, a body that cannot be read, an unresolvable location and
// an exhausted redirect budget all arrive as `err`, which is what both guards
// below test first.
// Three details are deliberate. `err.cause` is unwrapped, because fetch
// reports a connection failure as a TypeError wrapping the underlying Error,
// and that Error is what reaches log.error. The callback is dispatched on a
// next tick rather than from inside the promise chain, so a throw inside it
// escapes as an uncaught exception; called inside the chain it would surface
// as an unhandled rejection instead, which is a different process-level event.
// And it is dispatched at most once, so no late failure inside the hop loop
// can deliver a second outcome.
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
    // Every hop belongs to this loop, so a 3xx is handed back here rather
    // than chased by the runtime under its own limit.
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
        // A location that will not resolve cannot be chased, so it is
        // reported as an error and never as a response.
        discard(response);
        return dispatch(unresolvable, undefined, undefined);
      }

      if (followed >= MAX_REDIRECTS) {
        // Reported before the hop is taken, so the eleventh redirect target
        // is never requested, and the message names the URL that answered
        // with the excess redirect rather than the one being declined.
        discard(response);
        return dispatch(new Error('Exceeded maxRedirects. Probably stuck in a redirect loop ' + current.href),
                        undefined, undefined);
      }

      nextHeaders = copyHeaders(hopHeaders);

      if (response.status !== 307) {
        // On every followed redirect other than a 307, the body and its
        // framing headers (content-type, content-length) are dropped, and the
        // authorization header goes with them - but only when the HOSTNAME
        // changes, so it survives a hop that changes nothing but the port or
        // the scheme. A 307 carries the whole request forward unchanged,
        // authorization included, which is why all of this sits inside the one
        // status test.
        //
        // The hostname test compares the hop that just answered against the
        // one about to be issued, not the original URL against the current
        // target, and an authorization header once dropped is never restored
        // on a later hop.
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
      // The hop loop reports through the callback and settles once, so a
      // throw escaping the handlers above cannot become an unhandled
      // rejection.
      dispatch((unexpected && unexpected.cause) || unexpected, undefined, undefined);
    });
  }

  try {
    target = new URL(url);
  }
  catch (invalid) {
    // Every failure here is reported through the callback, so the URL
    // constructor's throw becomes an `err` rather than being raised at a
    // caller that does not expect one.
    return dispatch(invalid, undefined, undefined);
  }

  attempt(target, settings.headers, settings.body, 0);
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
          // The body is an already-encoded string, so the content type is
          // stated here rather than left to fetch, which would label it
          // text/plain; `accept` asks for the JSON form of the token
          // response, which legacyJsonBody then parses.
          'content-type': 'application/x-www-form-urlencoded',
          'accept': 'application/json'
        },
        // A 3xx from the token endpoint is not chased: POST is in
        // UNFOLLOWED_METHODS and the hop loop sets `manual` on every request
        // of its own, and it is stated here as well because the guard below
        // depends on it. Left to fetch, a 301, 302 or 303 would be replayed
        // as a GET carrying no body at all.
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
        // `body` undefined or null, so reading access_token off it throws a
        // TypeError out of this callback. The callback runs on a next tick,
        // so that throw escapes as an uncaught exception instead of
        // rejecting: the promise around this call never settles and the
        // request is left unanswered.
        if (err || !body.access_token) {
          return reject(err || new Error('Failed to get access token'));
        }
        resolve(body.access_token);
      });
    })
    .then(function(accessToken) {
      // Get user profile
      return new Promise(function(resolve, reject) {
        // GET is not in UNFOLLOWED_METHODS, so the hop loop follows redirects
        // here: ten at most, with the eleventh arriving as `Exceeded
        // maxRedirects` in the err argument below and landing on the generic
        // failure response through the catch at the end of this chain. The
        // Authorization header is carried across a hop that changes only the
        // port or the scheme, and across a 307, and is dropped when the
        // hostname changes.
        legacyJsonRequest('https://www.googleapis.com/oauth2/v2/userinfo', {
          method: 'GET',
          headers: {
            Authorization: 'Bearer ' + accessToken,
            'accept': 'application/json'
          }
        }, function(err, response, profile) {
          // Same shape as the token guard: an empty or `null` profile body
          // makes this read throw a TypeError out of the callback, which
          // leaves the request unanswered rather than rejecting.
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

          // `opts` is not bound in this scope, so the flash below throws a
          // ReferenceError - after the new user has been written to the
          // database, and after the session has been given `grantDemoTrinkets`
          // and, when no `next` was carried in, '/welcome' as `next`. The
          // chain rejects into the catch at the end, so the `userId` write
          // never runs: a first Google sign-in creates the account, leaves the
          // visitor logged out, and answers with the generic authentication
          // failure, which for a browser request flashes the message and
          // redirects to /signup.
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

      var redirectTo = request.yar.get('next') || '/home';
      request.yar.clear('next');

      var educatorsFormData = request.yar.get('educatorsFormData');
      var registrationPayload = request.yar.get('registration-payload');

      if (educatorsFormData) {
        request.yar.set('educatorsFormData', educatorsFormData, true);
      }
      if (registrationPayload) {
        request.yar.set('registration-payload', registrationPayload);
      }

      // Clearing the flag is all that happens here: no demo trinkets are
      // granted on this path, and the flag does not survive into the next
      // request.
      if (request.yar.get('grantDemoTrinkets')) {
        request.yar.clear('grantDemoTrinkets');
      }

      return request.success({ redirectTo: redirectTo });
    })
    .catch(function(err) {
      log.error('Google OAuth error:', err);
      return request.fail({ message: 'Authentication failed. Please try again.' });
    });
  }
};
