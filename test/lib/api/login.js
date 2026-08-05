var sinon         = require('sinon'),
    should        = require('chai').should(),
    config        = require('config'),
    CryptoJS      = require('crypto-js'),
    flow          = require('../../helpers/flow'),
    defaults      = require('../../helpers/defaults');

/**
 * THE LOGIN API CONTRACT.
 *
 * The block at the end of this file covers `POST /api/users/login` — its `encryptRoles` pre-handler, its
 * reduced six-key projection, its encrypted role token and its success shape — together with all four of
 * `lib/controllers/users.js#login`'s failure branches on BOTH surfaces, including the passwordless-account
 * branch, which needs an account created without a password.
 *
 * The four failure messages are PRESERVED QUIRKS rather than defects to repair: a failed login reports *why*
 * it failed, which makes the form an account-existence oracle, and the unknown-account message echoes the
 * submitted identifier back verbatim. The assertions below therefore pin the exact strings. See
 * docs/PRESERVED-QUIRKS.md section 4.9.
 *
 * These identities are declared HERE rather than in test/helpers/defaults.js because nothing else uses them:
 * they are created and removed by this block alone, driven through cookie slots no other suite touches, and
 * `flow.activeUser` is restored when the block finishes — which is what keeps the shared session state the
 * serial suites depend on untouched.
 */
var API_IDENTITY = {
  fullname : 'api login',
  username : 'apilogin',
  email    : 'api-login@example.com',
  password : 'apiLogin!234'
};

/** An account with NO password at all. `password` is not required by the user schema. */
var NO_PASSWORD_IDENTITY = {
  fullname : 'no password',
  username : 'nopassword',
  email    : 'no-password@example.com'
};

/** An account carrying the `disabled` site role, which login rejects before it compares anything. */
var DISABLED_IDENTITY = {
  fullname : 'disabled account',
  username : 'disabledaccount',
  email    : 'disabled-account@example.com',
  password : 'disabledAccount!234'
};

/** An address no account holds, so login takes the unknown-user branch. */
var UNKNOWN_EMAIL = 'nobody-here-p6b@example.com';

/** The four messages `lib/controllers/users.js#login` hands to the failure responder, verbatim. */
var LOGIN_MESSAGES = {
  unknownUser   : 'Unknown user ' + UNKNOWN_EMAIL,
  disabled      : 'Account Disabled',
  noPassword    : 'A password was not found for this account.',
  wrongPassword : 'Invalid password'
};

var HTML_TYPE = 'text/html; charset=utf-8';
var JSON_TYPE = 'application/json; charset=utf-8';

/** The exact key set `POST /api/users/login` projects on success, sorted. */
var LOGIN_PROJECTION_KEYS = ['email', 'fullname', 'id', 'name', 'roles', 'username'];

module.exports = function() {  
  describe('User Login', function() {
    describe('When I enter an invalid login', function() {
      before(function(done) {
        flow.switchUser('');
        // log in the user with the wrong password
        flow.login({password:'nope'}, function(err, response) {
          done();
        });
      });

      it('should redirect me to the login page', function() {
        flow.wasOk.should.be.true;
        flow.lastResponse.statusCode.should.eql(302);
        flow.lastResponse.redirect.should.be.true;
        flow.lastRedirect.pathname.should.eql('/login');
      });

      it('should not let me visit the welcome page', function(done) {
        flow.welcome(function() {
          flow.wasOk.should.be.true;
          flow.lastResponse.statusCode.should.eql(302);
          flow.lastRedirect.pathname.should.eql('/login');
          done();
        });
      });
    });

    describe('When I enter a valid login', function() {
      before(function(done) {
        flow.switchUser('user');
        done();
      });

      it('should redirect to the home page', function(done) {
        // log in the user
        flow.login(function(err, response) {
          flow.wasOk.should.be.true;
          flow.lastResponse.statusCode.should.eql(302);
          flow.lastResponse.redirect.should.be.true;
          flow.lastRedirect.pathname.should.eql('/home');

          done();
        });
      });

      it('should allow the home page to load', function(done) {
        flow.home(function(err, response) {
          flow.wasOk.should.be.true;
          response.statusCode.should.eql(200);
          done();
        });
      });
    });

    describe('When I enter a valid upper case email address', function() {
      before(function(done) {
        flow.switchUser('');
        flow.login({ email : defaults.login.email.toUpperCase() }, function(err, response) {
          done();
        });
      });

      it('should redirect to the home page', function(done) {
        flow.wasOk.should.be.true;
        flow.lastResponse.statusCode.should.eql(302);
        flow.lastResponse.redirect.should.be.true;
        flow.lastRedirect.pathname.should.eql('/home');

        done();
      });
    });
  });

  // The login API contract and the four failure branches.

  describe('The login API contract (POST /api/users/login)', function() {
    var previousUser = null;

    /**
     * Creates one account through the application's own global User model, exactly as
     * test/helpers/flow.js#switchUser does, and leaves it logged out.
     *
     * @param {Object}   identity The fields to save.
     * @param {Function} done     Called with (err).
     */
    function createIdentity(identity, done) {
      User.findByLogin(identity.email, function(err, existing) {
        if (err) {
          return done(err);
        }

        if (existing) {
          // A previous aborted run left it behind; remove it so this run starts from the same state.
          return existing.remove(function(removeErr) {
            return removeErr ? done(removeErr) : createIdentity(identity, done);
          });
        }

        return new User(identity).save(function(saveErr, saved) {
          return saveErr ? done(saveErr) : done(null, saved);
        });
      });
    }

    /** Removes one account if it exists. Absence is not an error: a failed create leaves nothing. */
    function removeIdentity(identity, done) {
      User.findByLogin(identity.email, function(err, doc) {
        if (err || !doc) {
          return done(err);
        }

        return doc.remove(function(removeErr) {
          return done(removeErr);
        });
      });
    }

    /**
     * One request through a cookie slot of this block's own, with no cookie attached.
     *
     * A fresh slot name means `createRequest` finds no cookie for it, which is what makes every probe
     * below unauthenticated regardless of what the eight suites around this one left in their own slots.
     *
     * @param   {string} slot The slot name to select.
     * @param   {string} path The path to POST to.
     * @param   {Object} body The payload.
     * @returns {Object} A supertest request, ready for `.end()`.
     */
    function postFrom(slot, path, body) {
      flow.switchUser(slot);

      return flow.post(path).send(body).redirects(0);
    }

    before(function(done) {
      this.timeout(60000);
      previousUser = flow.activeUser;

      createIdentity(API_IDENTITY, function(err) {
        if (err) {
          return done(err);
        }

        return createIdentity(NO_PASSWORD_IDENTITY, function(noPassErr) {
          if (noPassErr) {
            return done(noPassErr);
          }

          return createIdentity(DISABLED_IDENTITY, function(disabledErr, disabled) {
            if (disabledErr) {
              return done(disabledErr);
            }

            // `grant` persists the role through findByIdAndUpdate, so the login handler's
            // `user.hasRole("disabled")` check sees it on the next read.
            return disabled.grant('disabled', 'site').then(function() { done(); }, done);
          });
        });
      });
    });

    after(function(done) {
      this.timeout(60000);
      flow.activeUser = previousUser === null ? 'user' : previousUser;

      removeIdentity(API_IDENTITY, function(err) {
        if (err) {
          return done(err);
        }

        return removeIdentity(NO_PASSWORD_IDENTITY, function(noPassErr) {
          if (noPassErr) {
            return done(noPassErr);
          }

          return removeIdentity(DISABLED_IDENTITY, done);
        });
      });
    });

    describe('when the credentials are valid', function() {
      var response = null;

      before(function(done) {
        this.timeout(30000);
        postFrom('p6b-api-ok', '/api/users/login', {
          email    : API_IDENTITY.email,
          password : API_IDENTITY.password
        }).end(function(err, res) {
          response = res;
          done(err);
        });
      });

      it('answers 200 with a JSON success envelope rather than the HTML redirect', function() {
        response.statusCode.should.eql(200);
        String(response.headers['content-type']).should.eql(JSON_TYPE);
        response.body.status.should.eql('success');
        should.not.exist(response.headers.location);
      });

      /**
       * THE SIX-KEY PROJECTION. `lib/controllers/users.js#login` selects it on the strength of
       * `request.pre.encryptRoles`, which `config/api_routes.js` declares as an unconditional `true` on
       * this route and on no other - so this assertion is what holds that pre-handler in place. A seventh
       * key, or a missing one, is a changed API payload shape.
       */
      it('projects exactly the six declared keys, and no password field among them', function() {
        Object.keys(response.body.data).sort().should.eql(LOGIN_PROJECTION_KEYS);
        should.not.exist(response.body.data.password);
        response.body.data.email.should.eql(API_IDENTITY.email);
        response.body.data.username.should.eql(API_IDENTITY.username);
        response.body.data.fullname.should.eql(API_IDENTITY.fullname);
        response.body.data.id.should.be.a('string');
      });

      /**
       * The role token is `lib/util/roles.js#encrypt(user.roles)`: a 32-character hex passphrase, a `+`,
       * and an OpenSSL-envelope AES payload the browser splits and decrypts at
       * public/js/trinket-roles.js:L7-L11. Shipping the key beside the ciphertext is obfuscation rather
       * than security and is a preserved quirk (docs/PRESERVED-QUIRKS.md section 1.9); decrypting it here
       * is what proves the wire value is the real thing and not, say, the raw roles array.
       */
      it('encrypts the roles into a token the browser can decrypt back to the account roles', function() {
        var token = response.body.data.roles,
            parts = String(token).split('+'),
            key   = parts[0],
            body  = parts.slice(1).join('+');

        key.should.match(/^[0-9a-f]{32}$/);
        Buffer.from(body, 'base64').slice(0, 8).toString('latin1').should.eql('Salted__');

        var decrypted = JSON.parse(CryptoJS.enc.Utf8.stringify(CryptoJS.AES.decrypt(body, key)));

        decrypted.should.be.an('array');
        // A new account is granted the default site role by the user model's pre-save hook.
        decrypted[0].context.should.eql('site');
        decrypted[0].roles.should.contain('user');
      });

      it('authenticates the session it hands back, so the cookie reaches a protected page',
        function(done) {
          this.timeout(30000);
          should.exist(response.headers['set-cookie']);

          // The cookie is threaded explicitly because `login` calls `request.yar.reset()` on success:
          // the session id rotates, so only the cookie THIS response carried is live.
          flow.replay('get', '/home', response.headers['set-cookie']).redirects(0)
            .end(function(err, page) {
              if (err) { return done(err); }

              page.statusCode.should.eql(200);
              String(page.headers['content-type']).should.eql(HTML_TYPE);

              return done();
            });
        });
    });

    /**
     * THE FOUR FAILURE BRANCHES, on both surfaces.
     *
     * The JSON surface answers HTTP **200** with `{ message, flash }` and no status field, because the
     * declarative failure responder sets no status code and `POST /api/users/login` declares no
     * `fail.redirect`. That is the wire behavior this suite freezes; answering 401 here instead would be a
     * prohibited behavior improvement, as lib/http/responseContract.js#reject records at that branch.
     */
    [
      { label : 'an unknown account', slot : 'p6b-unknown',
        body : { email : UNKNOWN_EMAIL, password : 'anything-at-all' },
        message : LOGIN_MESSAGES.unknownUser },
      { label : 'a disabled account', slot : 'p6b-disabled',
        body : { email : DISABLED_IDENTITY.email, password : DISABLED_IDENTITY.password },
        message : LOGIN_MESSAGES.disabled },
      { label : 'an account with no password set', slot : 'p6b-nopassword',
        body : { email : NO_PASSWORD_IDENTITY.email, password : 'anything-at-all' },
        message : LOGIN_MESSAGES.noPassword },
      { label : 'a wrong password', slot : 'p6b-wrongpassword',
        body : { email : API_IDENTITY.email, password : 'definitely-not-the-password' },
        message : LOGIN_MESSAGES.wrongPassword }
    ].forEach(function(probe) {
      describe('when the attempt names ' + probe.label, function() {
        it('POST /api/users/login answers 200 JSON carrying the exact message and an empty flash',
          function(done) {
            this.timeout(30000);
            postFrom(probe.slot + '-api', '/api/users/login', probe.body)
              .end(function(err, res) {
                if (err) { return done(err); }

                res.statusCode.should.eql(200);
                String(res.headers['content-type']).should.eql(JSON_TYPE);
                res.body.message.should.eql(probe.message);
                res.body.flash.should.eql({});
                should.not.exist(res.body.status);
                should.not.exist(res.body.data);
                should.not.exist(res.headers.location);

                return done();
              });
          });

        it('POST /api/users/login does NOT authenticate, so a protected page still redirects',
          function(done) {
            this.timeout(30000);
            postFrom(probe.slot + '-api-noauth', '/api/users/login', probe.body)
              .end(function(err, res) {
                if (err) { return done(err); }

                flow.replay('get', '/home', res.headers['set-cookie'] || []).redirects(0)
                  .end(function(pageErr, page) {
                    if (pageErr) { return done(pageErr); }

                    page.statusCode.should.eql(302);
                    String(page.headers.location).should.eql('/login');

                    return done();
                  });
              });
          });

        /**
         * The HTML surface takes the other branch of the same responder: `config/routes.js` declares
         * `fail : { redirect : '/login' }` for `POST /login`, so the message is flashed into the session
         * and the visitor is redirected, and the rendered `/login` page carries the message verbatim.
         * Both hops are asserted because the message is only client-visible on the second one.
         */
        it('POST /login redirects to the login page, which then renders the exact message',
          function(done) {
            this.timeout(30000);
            flow.switchUser(probe.slot + '-html');
            flow.login(probe.body, function(err) {
              if (err) { return done(err); }

              flow.lastResponse.statusCode.should.eql(302);
              // Absolutized by lib/http/redirect.js, so the origin is whatever app.url resolves to.
              String(flow.lastResponse.headers.location).should.eql(config.url + '/login');
              flow.lastRedirect.pathname.should.eql('/login');
              should.not.exist(flow.lastResponse.body.status);

              // The same slot, so the session cookie the redirect handed back is sent back up and the
              // single-read flash is drained by the render rather than by anything else.
              return flow.get('/login').end(function(pageErr, page) {
                if (pageErr) { return done(pageErr); }

                page.statusCode.should.eql(200);
                String(page.headers['content-type']).should.eql(HTML_TYPE);
                page.text.should.contain(probe.message);

                return done();
              });
            });
          });
      });
    });
  });
};
