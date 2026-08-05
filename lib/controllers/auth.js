var _             = require('underscore'),
    config        = require('config'),
    Boom          = require('@hapi/boom'),
    crypto        = require('crypto'),
    // The same-origin destination filter applied to the user-controlled `next` value below.
    // See lib/http/redirect.js and docs/PRESERVED-QUIRKS.md section 4.4.
    Redirect      = require('../http/redirect'),
    userUtil      = require('../util/user');

// Serializes a flat field map onto the wire the way qs.stringify does. Three properties are
// load-bearing, because the token endpoint sees these bytes:
//   1. a field whose value is `undefined` is OMITTED ENTIRELY;
//   2. a field whose value is `null` is emitted as a BARE `key=`, not as the word "null" - which is
//      the case this application actually exercises, because a valueless YAML key resolves to `null`
//      and the absent Google credentials go out as `client_secret=&redirect_uri=`;
//   3. every surviving value is percent-encoded as qs encodes it, keeping the bare
//      `application/x-www-form-urlencoded` media type with no charset parameter. `encodeURIComponent`
//      alone leaves `!`, `'`, `(`, `)` and `*` raw where qs escapes them, so those five are
//      post-escaped to the same uppercase-hex form; everything else already matches, `~` included,
//      and a space is `%20`, never `+`.
// A URLSearchParams body cannot stand in: it serializes `null` and `undefined` as the literal strings
// "null" and "undefined", encodes a space as `+`, and appends `;charset=UTF-8` to the media type.
// See docs/PRESERVED-QUIRKS.md section 3.37.
var RFC3986_RESERVED = /[!'()*]/g;

function rfc3986(value) {
  return encodeURIComponent(value).replace(RFC3986_RESERVED, function(character) {
    return '%' + character.charCodeAt(0).toString(16).toUpperCase();
  });
}

function encodeForm(fields) {
  return Object.keys(fields)
    .filter(function(key) { return fields[key] !== undefined; })
    .map(function(key) {
      var value = fields[key] === null ? '' : fields[key];

      return rfc3986(key) + '=' + rfc3986(value);
    })
    .join('&');
}

// Reproduces the RESPONSE half of the retired client's `json : true` option. It parsed the body when it
// could and handed the callback the RAW TEXT when it could not, never raising - whereas fetch's
// response.json() throws a SyntaxError, which would replace this file's two normalized provider errors
// with an unrelated one. A zero-length body came back as `undefined` rather than as the empty string;
// that is measured, not assumed, and it is what the two guards in googleCallback below turn on.
// Verified identical to request@2.88.2 for every body shape this endpoint can return: a JSON object, a
// malformed fragment, an empty body, and the JSON scalars null, 123, "str", false and [].
async function readJsonBody(response) {
  var text = await response.text();

  if (text === '') {
    return undefined;
  }

  try {
    return JSON.parse(text);
  }
  catch (parseError) {
    return text;
  }
}

module.exports = {
  // Google OAuth - optional, only works if configured
  //
  // Declared `async` for the same reason as every other routed handler in this tree: the
  // native lifecycle takes the RETURN VALUE as the response, and hapi awaits it whether it
  // is a response object or a promise for one. This body performs no I/O, so the only effect
  // of the keyword is that the already-returned response travels back wrapped in a resolved
  // promise - wire-identical, and it keeps the handler signature uniform across the module.
  google : async function(request, h) {
    if (!config.app.auth || !config.app.auth.google || !config.app.auth.google.clientID) {
      return h.reject({
        message: 'Google OAuth is not configured. Please set up Google OAuth credentials.'
      });
    }

    request.yar.flash('auth', 'Google', true);
    // googleCallback below feeds this value into the `redirectTo` it hands the responder, and
    // GET /auth/google/callback declares `success : { redirect : '{redirectTo}' }`, so it becomes a
    // Location header. Only a same-origin destination is persisted, and it is persisted UNCHANGED:
    // an in-application path and an absolute URL on one of this application's own origins both
    // round-trip; anything off-origin is simply not stored.
    // See docs/PRESERVED-QUIRKS.md section 4.4.
    var next = Redirect.internalDestination(request.query.next, request);
    if (next) {
      request.yar.set('next', next);
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

    return h.respond({ redirectTo: googleAuthUrl + '?' + params.toString() });
  },

  googleCallback : async function(request, h) {
    if (!config.app.auth || !config.app.auth.google || !config.app.auth.google.clientID) {
      return h.reject({
        message: 'Google OAuth is not configured.'
      });
    }

    var code = request.query.code;
    if (!code) {
      return h.reject({ message: 'No authorization code received from Google.' });
    }

    try {
      // Exchange code for token
      //
      // The retired client's `form` option sent the fields as application/x-www-form-urlencoded
      // and its `json : true` option added `Accept: application/json` to the REQUEST while
      // parsing the RESPONSE. fetch reproduces NONE of that on its own - it sends
      // `Accept: */*` and no Content-Type unless told otherwise - so both headers are set
      // explicitly and the body is built by encodeForm, whose contract is documented above.
      // Measured against request@2.88.2: identical method, identical accept and content-type
      // header values, identical body bytes (field order included) under both full and partial
      // configuration.
      // Deliberately NO response.ok check: the callback-era client did not raise on a non-2xx
      // status and neither does fetch, so a Google error payload still falls through to the
      // access_token test below and yields the identical rejection it always did - measured, a
      // 400 with {"error":"invalid_grant"} produced err === null and the parsed payload.
      var tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/x-www-form-urlencoded'
        },
        body: encodeForm({
          code: code,
          client_id: config.app.auth.google.clientID,
          client_secret: config.app.auth.google.clientSecret,
          redirect_uri: config.app.auth.google.callbackURL,
          grant_type: 'authorization_code'
        })
      });
      var tokenBody = await readJsonBody(tokenResponse);

      // PRESERVED QUIRK: exactly two body shapes make the `body.access_token` read on the next line
      // raise a TypeError - `undefined`, for a zero-length response, and `null`, for a literal `null`
      // payload - and both answer NO RESPONSE, so they are left unanswered here. Every OTHER shape
      // still reaches the normalized error below: a malformed non-empty fragment arrives as raw text,
      // and 123, "str", false and [] arrive as themselves, all with a falsy access_token.
      // See docs/PRESERVED-QUIRKS.md sections 3.37 and 9.
      if (tokenBody === undefined || tokenBody === null) {
        return h.abandon;
      }

      if (!tokenBody.access_token) {
        throw new Error('Failed to get access token');
      }
      var accessToken = tokenBody.access_token;

      // Get user profile. The retired client's `json : true` supplied `Accept: application/json`
      // here too and sent NO Content-Type on a GET; both are reproduced, and the Authorization
      // header keeps its exact 'Bearer ' + token spelling.
      var profileResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        method: 'GET',
        headers: {
          accept: 'application/json',
          Authorization: 'Bearer ' + accessToken
        }
      });
      var profile = await readJsonBody(profileResponse);

      // The profile read's mirror image of the guard above, for the same reason: `profile.email` on
      // an undefined or null body answers nothing. See docs/PRESERVED-QUIRKS.md section 3.37.
      if (profile === undefined || profile === null) {
        return h.abandon;
      }

      if (!profile.email) {
        throw new Error('Failed to get user profile');
      }
      profile.accessToken = accessToken;

      // Find or create user
      //
      // findByMultiple resolves to the matching document or null, and expands each key of
      // this object - including the dotted 'profiles.google.id' - into its own $or clause.
      var user = await User.findByMultiple({
        email: profile.email,
        username: userUtil.generate_username(profile.email),
        'profiles.google.id': profile.id
      });

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

        await Promise.all(promises);
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

        // The statement order here is load-bearing: the save happens FIRST, then the two yar
        // writes, and only then the flash that throws on the undeclared identifier below.
        user = await user.save();

        if (!next) {
          request.yar.set('next', '/welcome');
        }
        request.yar.set('grantDemoTrinkets', true);
        // `opts` is declared nowhere - not here, not in any enclosing scope, and not among the
        // implicit globals app.js assigns - so this line throws a ReferenceError that the catch
        // at the foot of the handler turns into the failure response. A brand-new Google signup
        // therefore ends in that failure with the user document and the two yar writes above
        // already persisted; only the login is lost. Do not declare, guard or remove it.
        request.yar.flash('userAccountCreated', JSON.stringify(opts));
      }

      // Log in user - store userId in session
      request.yar.set('userId', user.id);
      request.user = user;

      // Filtered again on the way out, because a session minted earlier can still carry an
      // unfiltered value. A same-origin destination is returned unchanged, so '/welcome', any
      // in-application path the visitor asked for and an absolute same-origin assignment destination
      // all still win over the '/home' fallback; anything off-origin falls back to '/home', which is
      // what an absent `next` already did. See docs/PRESERVED-QUIRKS.md section 4.4.
      var redirectTo = Redirect.internalDestination(request.yar.get('next'), request) || '/home';
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

      return h.respond({ redirectTo: redirectTo });
    }
    catch (err) {
      // The single sink for every failure above; anything it does not cover propagates to
      // the onPreResponse extension in app.js that owns error rendering.
      log.error('Google OAuth error:', err);
      return h.reject({ message: 'Authentication failed. Please try again.' });
    }
  }
};
