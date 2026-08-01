// DEPENDENCY SWAP: `request` 2.88.2 -> the global `fetch` built into Node 22, classified
// `dead` (formally deprecated upstream, unmaintained) in
// docs/MIGRATION-DEPENDENCY-INVENTORY.md. No package replaces it. The two call sites it
// served - the OAuth token exchange and the userinfo read - are converted in
// googleCallback below.
//
// The remaining requires are left exactly as they are. `_`, `Boom` and `crypto` are all
// unreferenced in this file, but removing an unused require is cleanup rather than one of
// the four sanctioned change categories, so all three stay.
var _             = require('underscore'),
    config        = require('config'),
    Boom          = require('@hapi/boom'),
    crypto        = require('crypto'),
    userUtil      = require('../util/user');

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

  googleCallback : async function(request, h) {
    if (!config.app.auth || !config.app.auth.google || !config.app.auth.google.clientID) {
      return request.fail({
        message: 'Google OAuth is not configured.'
      });
    }

    var code = request.query.code;
    if (!code) {
      return request.fail({ message: 'No authorization code received from Google.' });
    }

    // ASYNC CONVERSION: the three hand-rolled promise-constructor wrappers this handler used
    // to be built from - the token exchange, the profile read and the user lookup - are plain
    // awaits now, and the terminal rejection handler that closed the chain is the single
    // `catch` block at the foot of the handler. The set of error-to-response mappings is
    // unchanged: every failure still converges on exactly one place and still answers with
    // the same failure payload it answered with before.
    try {
      // Exchange code for token
      //
      // `request`'s `form` option sent the fields as application/x-www-form-urlencoded;
      // passing a URLSearchParams instance as the fetch body reproduces that encoding, that
      // content type and that field order. Its `json: true` option parsed the RESPONSE,
      // which is what response.json() does here. Deliberately NO response.ok check: the
      // callback-era client did not throw on a non-2xx status and neither does fetch, so a
      // Google error payload still falls through to the access_token test below and yields
      // the identical rejection it always did.
      var tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        body: new URLSearchParams({
          code: code,
          client_id: config.app.auth.google.clientID,
          client_secret: config.app.auth.google.clientSecret,
          redirect_uri: config.app.auth.google.callbackURL,
          grant_type: 'authorization_code'
        })
      });
      var tokenBody = await tokenResponse.json();

      // Mirrors `if (err || !body.access_token) reject(err || new Error(...))` exactly. The
      // `err` half needs no statement of its own any more: fetch rejects on a transport
      // failure, so the await above throws that SAME error object onward, which is what
      // reject(err) did. The `!body.access_token` half throws this identical Error.
      if (!tokenBody.access_token) {
        throw new Error('Failed to get access token');
      }
      var accessToken = tokenBody.access_token;

      // Get user profile
      var profileResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        method: 'GET',
        headers: { Authorization: 'Bearer ' + accessToken }
      });
      var profile = await profileResponse.json();

      if (!profile.email) {
        throw new Error('Failed to get user profile');
      }
      profile.accessToken = accessToken;

      // Find or create user
      //
      // lib/models/user.js#findByMultiple forwards its callback to Mongoose's findOne and
      // returns the query either way, so dropping the callback yields the awaited document
      // directly - null when nothing matched, which is what selects the else branch below.
      // The query object is untouched, including the dotted 'profiles.google.id' key that
      // findByMultiple expands into one $or clause per entry.
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

        // Was `return Promise.all(promises).then(function() { return user; });` - the chain
        // discarded the save results and carried `user` forward, so awaiting the same
        // (possibly empty) array and falling through with `user` is the exact equivalent.
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

        // The chain handed `user.save()`'s resolved document to the next `.then` as
        // `newUser`; rebinding `user` to it here is that same hand-off. The statement order
        // that follows is load-bearing and is preserved exactly: save FIRST, then the two
        // yar writes, and only then the flash that throws.
        user = await user.save();

        if (!next) {
          request.yar.set('next', '/welcome');
        }
        request.yar.set('grantDemoTrinkets', true);
        // PRESERVED QUIRK - see docs/PRESERVED-QUIRKS.md. The identifier handed to
        // JSON.stringify on the line below is declared NOWHERE: not in this file, not in any
        // enclosing scope, and not among the nine model globals app.js:L289-297 assigns (nor in
        // the gleak whitelist at app.js:L340-344). That line is its ONLY occurrence in this
        // file; the other matches for the same name elsewhere in the repository are unrelated
        // locals in lib/util/queues.js and a config property read in config/db.js. It is a
        // copy-paste inheritance of the identical defect at the now-deleted
        // lib/auth/passport.js:L124, whose adjudication in that document records that the line
        // cannot execute without throwing a ReferenceError. That same ReferenceError is raised
        // here, and the catch at the foot of this handler turns it into a failure
        // response - so the MEASURED outcome of a brand-new Google signup is a 302 to /signup
        // (this route declares fail.redirect '/signup' and a browser negotiates 'html'), or,
        // for a JSON-preferring client, HTTP 200 carrying the failure flash. The user document
        // has ALREADY been persisted and the two yar writes above have ALREADY happened by
        // then; only the login is lost. Note also that this flash takes TWO arguments, so
        // unlike the persisted flashes elsewhere it is not written through with yar's
        // isOverride flag.
        // Do NOT declare that identifier, do NOT guard it with a typeof test, do NOT
        // substitute a plausible object and do NOT delete the call: each of those turns a
        // measured baseline failure into a working signup, which is a prohibited behavior
        // change.
        request.yar.flash('userAccountCreated', JSON.stringify(opts));
      }

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
    }
    catch (err) {
      // The single sink for every failure above, carried over verbatim from the chain's
      // terminal `.catch()`: same log call, same message text, same responder. It is the only
      // error handling in this handler on purpose - nothing here renders a page or sets a
      // status of its own, so anything this does not cover propagates to the one
      // onPreResponse extension in app.js that owns error rendering.
      log.error('Google OAuth error:', err);
      return request.fail({ message: 'Authentication failed. Please try again.' });
    }
  }
};
