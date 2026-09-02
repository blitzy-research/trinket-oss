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

// Issues one request and reports it as `request` did, through a callback taking
// (err, response, body). It never rejects: a transport failure or a truncated
// body arrives as `err`, which is what both guards test first. Two details are
// deliberate. `err.cause` is unwrapped, because fetch reports a connection
// failure as a TypeError wrapping the Error `request` reported directly, and
// that Error is what reaches log.error. And the callback is dispatched on a
// next tick rather than from inside the promise chain, so a throw inside it
// escapes as an uncaught exception exactly as it did when `request` invoked the
// callback from its own emitter; called inside the chain it would surface as an
// unhandled rejection instead, which is a different process-level event.
function legacyJsonRequest(url, options, callback) {
  fetch(url, options).then(function(response) {
    return response.text().then(function(text) {
      return [null, response, legacyJsonBody(text)];
    }, function(readError) {
      return [(readError && readError.cause) || readError, response, undefined];
    });
  }, function(fetchError) {
    return [(fetchError && fetchError.cause) || fetchError, undefined, undefined];
  }).then(function(reported) {
    process.nextTick(callback, reported[0], reported[1], reported[2]);
  });
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
        // `request` followed redirects for GET only, so a 3xx from the token
        // endpoint reached the callback with no body rather than being chased.
        // fetch follows every method by default and downgrades a 301, 302 or
        // 303 POST to GET, so following is turned off here.
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
        // Redirects stay followed here, as `request` did for GET. Two limits
        // differ and neither is reachable from this endpoint: fetch allows 20
        // hops where `request` allowed 10, and fetch drops the Authorization
        // header across an origin change. Both land on the same generic
        // failure response through the catch at the end of this chain.
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
