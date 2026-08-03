var _             = require('underscore'),
    config        = require('config'),
    Boom          = require('@hapi/boom'),
    crypto        = require('crypto'),
    // SECURITY REMEDIATION (review finding SEC-4) - the same-origin destination
    // filter applied to the user-controlled `next` value below. See
    // lib/http/redirect.js and docs/PRESERVED-QUIRKS.md section 4.4.
    Redirect      = require('../http/redirect'),
    // The tree's single mechanism for a branch that answered nothing at the base commit; every
    // non-settling return in lib/controllers/ goes through it. See docs/PRESERVED-QUIRKS.md
    // section 1.15.
    Pending       = require('../http/pending'),
    userUtil      = require('../util/user');

// Serializes a flat field map onto the wire exactly as the retired client's `form` option did through
// qs.stringify. Three properties are reproduced, and all three are load-bearing:
//   1. a field whose value is `undefined` is OMITTED ENTIRELY;
//   2. a field whose value is `null` is emitted as a BARE `key=` - qs leaves strictNullHandling off by
//      default, so it stringifies null to the empty string rather than to the word "null";
//   3. every surviving value is percent-encoded with encodeURIComponent, so a space becomes %20, never +.
// Property 2 is the one this application actually exercises. config/default.yaml:L326-L328 declares
// app.auth.google.clientSecret, .clientID and .callbackURL with NO value, and node-config resolves a
// valueless YAML key to `null`, never to `undefined` - measured: with only clientID injected,
// config.app.auth.google is {clientSecret: null, clientID: '…', callbackURL: null}. So under the partial
// configuration this function exists to protect, the two absent fields arrive as `null`, and the base
// commit put `client_secret=&redirect_uri=` on the wire for them. Encoding them with encodeURIComponent
// alone would send the four-character string "null" instead, which is a behavior change R-4 and R-6 both
// forbid; QA measured exactly that deviation before the null arm below was added.
// None of the three properties is what fetch does with a URLSearchParams body:
//   * `new URLSearchParams({ client_secret : undefined })` serializes the literal string "undefined" and
//     `{ client_secret : null }` the literal string "null", so under partial configuration Google would
//     receive two junk field values where the base commit sent two empty ones;
//   * URLSearchParams encodes a space as +, and sets the Content-Type to
//     'application/x-www-form-urlencoded;charset=UTF-8' rather than the bare media type qs produced.
// Measured byte-identical to request@2.88.2 + qs (verified against the installed 6.15.3, whose default
// null and undefined handling is unchanged from the 6.5.5 request bundled) for this file's field maps
// under full configuration, partial configuration, and every mixed null/undefined shape between them.
// See docs/PRESERVED-QUIRKS.md section 3.37.
function encodeForm(fields) {
  return Object.keys(fields)
    .filter(function(key) { return fields[key] !== undefined; })
    .map(function(key) {
      var value = fields[key] === null ? '' : fields[key];

      return encodeURIComponent(key) + '=' + encodeURIComponent(value);
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
    // SECURITY REMEDIATION (review finding SEC-4, CWE-601), recorded in
    // docs/PRESERVED-QUIRKS.md section 4.4. googleCallback below feeds this value
    // straight into the `redirectTo` it hands the responder, and
    // GET /auth/google/callback declares `success : { redirect : '{redirectTo}' }`
    // (config/routes.js:L537-L539), so it becomes a Location header. Only a
    // same-origin destination is persisted, and it is persisted unchanged - both an
    // in-application path, so '/auth/google?next=/home' behaves exactly as it did,
    // and an absolute URL on one of this application's own origins, which is the
    // assignment flow review finding P3-1 restored.
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

      // ⭐ R-6 ADJUDICATION - see docs/PRESERVED-QUIRKS.md section 3.37, and section 9 for the no-response census
      // this pair joins. Two body shapes make the `body.access_token` read on the next line raise a TypeError:
      // `undefined`, which the retired client produced for a zero-length response, and `null`, which it produced
      // for a literal `null` payload. At the base commit that TypeError was raised inside the client's callback,
      // and the enclosing `new Promise` executor had ALREADY returned by then - so neither resolve nor reject
      // ran, the terminal `.catch` never saw it, and the request received NO RESPONSE. Those two shapes are
      // therefore left unanswered here. Every OTHER body shape still reaches the normalized error below exactly
      // as it always did, which is what the finding asks for: a malformed non-empty fragment arrives as the raw
      // TEXT, and 123, "str", false and [] all arrive as themselves - all measured against request@2.88.2, all
      // yielding a falsy access_token and none of them raising.
      if (tokenBody === undefined || tokenBody === null) {
        return Pending.forever();
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

      // R-6 ADJUDICATION - see docs/PRESERVED-QUIRKS.md section 3.37. The profile read's mirror
      // image of the guard above, for the same measured reason: `profile.email` on an undefined or
      // null body raised inside an unowned callback, so the base commit answered nothing.
      if (profile === undefined || profile === null) {
        return Pending.forever();
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

      // SECURITY REMEDIATION (review finding SEC-4) - defense in depth alongside
      // the filter applied where `next` is persisted in `google` above, because a
      // session minted before this change can still carry an unfiltered value.
      // A same-origin destination is returned unchanged, so the '/welcome' set at
      // L189 above, any '/…' the visitor asked for, and the absolute assignment
      // destination of review finding P3-1 all still win over the '/home' fallback;
      // anything off-origin falls back to '/home', which is exactly what an absent
      // `next` already did.
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
