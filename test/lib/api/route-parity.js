var should   = require('chai').should(),
    flow     = require('../../helpers/flow'),
    defaults = require('../../helpers/defaults');

/**
 * R-6 ROUTE-LEVEL PARITY.
 *
 * WHY THIS SUITE EXISTS
 * ---------------------
 * R-6 makes the observed behaviour of the application at the base commit the tie-breaker for every
 * ambiguity, and the review measured that the folder asserted only 16 distinct route paths against 233
 * registered routes, 117 of them under /api/. This suite closes part of that gap with route-level tests -
 * status, content-type and body shape - over the surfaces where a migration is most likely to change
 * behaviour without anyone noticing: the session-required cohort, the feature-flag gates, the failure
 * responder, and the two page handlers whose 2013-era defect a naive conversion would silently repair.
 *
 * EVERY EXPECTATION BELOW WAS MEASURED FIRST, THEN ASSERTED. None was predicted from source and then
 * imposed on the application. Where a measurement disagreed with the plan's prediction, the measurement
 * won and the disagreement is recorded as an R-6 adjudication in the comment at that assertion.
 *
 * ⛔ R-4 AND R-5, THE TWO RULES THAT GOVERN HOW A FAILURE HERE IS TO BE READ.
 * R-4 prohibits behaviour improvements: a 2013-era quirk a client may depend on is preserved and
 * documented, never fixed. R-5 requires every error-to-response mapping to survive the conversion
 * unchanged. Several assertions below therefore lock in outcomes that look like defects and ARE defects -
 * an HTTP 500 on an authenticated login page, an HTTP 200 on a rejected credential. THEY ARE THE
 * CONTRACT. If one of them fails, the controller changed and the controller is what must be fixed. Never
 * relax an assertion here to make a run go green.
 *
 * SELF-CONTAINED BY DESIGN. No recorded corpus is read at run time and no artifact from a sibling
 * directory is required. The capture-and-replay harness is a CLI guarded by require.main === module and it
 * owns the whole-corpus comparison; this suite encodes its expectations directly so it stands on its own
 * inside npm test and cannot be coupled to another directory's load order.
 *
 * TRANSPORT: test/helpers/flow only, which issues real HTTP over a bound listener. Its createRequest sets
 * NO Accept header, and that is load-bearing rather than incidental - the isApiRequest predicate in app.js
 * treats any Accept carrying application/json as an API request, which would move the non-API session
 * routes off their measured takeover redirect and onto a raw 401, turning the seven-route 401 cohort below
 * into twelve. The framework's own request-injection API is deliberately never used anywhere here: it is
 * the last remaining DEP0169 source in the tree, and one of the change's gates is a boot with zero warnings
 * under --pending-deprecation.
 *
 * SCOPE: status, content-type and body SHAPE only. test/helpers/db.js resets the database at the outer
 * boundaries of test/lib/api/index.js and nowhere between suites, so by the time this suite runs the
 * database holds everything the preceding suites created. A collection count, an array length or a list
 * of contents would therefore be order-dependent, and is never asserted here.
 */
module.exports = function() {
  describe('Route Parity', function() {
    // The rendered page identity, read from its <title>. Which template answered is the cheapest stable
    // marker of body shape for an HTML route, and it is the marker that distinguishes the error page from
    // any other response carrying the same status.
    function pageTitle(response) {
      var found = /<title>([\s\S]*?)<\/title>/i.exec(String(response.text || ''));

      return found ? found[1].trim() : null;
    }

    describe('As an anonymous visitor', function() {
      // No callback. switchUser only assigns the active slot when it is given none, so this logs nothing
      // in; and because the empty slot is falsy, createRequest's cookie guard never fires and no request
      // in this block carries a credential. The preceding suites leave a cleared cookie in the shared
      // user slot, so switching to the empty slot rather than reusing theirs is what keeps every
      // expectation below genuinely unauthenticated instead of accidentally so.
      before(function() {
        flow.switchUser('');
      });

      describe('the synthesized static pages', function() {
        // routeParser's addStaticPages runs BEFORE the declaration loop, which is why these two survive
        // the /{path*} catch-all registered last. lib/views/static holds exactly about.html and help.html,
        // so exactly these two routes exist.
        it('GET /about answers 200 with the about page', function(done) {
          flow.get('/about').end(flow.setLastResponse(function(err, response) {
            should.not.exist(err);
            response.statusCode.should.eql(200);
            flow.lastContentType.should.contain('text/html');
            pageTitle(response).should.eql('About Trinket');
            // The xframeDeny list names exactly three paths - /, /login and /signup - so a synthesized
            // page carries no framing header. Measured absent.
            should.not.exist(response.headers['x-frame-options']);
            done();
          }));
        });

        it('GET /help answers 200 with the help page', function(done) {
          flow.get('/help').end(flow.setLastResponse(function(err, response) {
            should.not.exist(err);
            response.statusCode.should.eql(200);
            flow.lastContentType.should.contain('text/html');
            pageTitle(response).should.eql('Help');
            done();
          }));
        });
      });

      describe('the session-required /api/ routes', function() {
        // The seven parameterless /api/ routes declared at mode=required strategies=[session]. All seven
        // were measured at 401 with a byte-identical body. The message is the client-visible half of the
        // contract: hapi passes a 4xx message through to the wire untouched, where it scrubs every 5xx
        // message, so THIS string is part of the HTTP surface and the 500 message below is not.
        [
          '/api/courses',
          '/api/exports',
          '/api/featured-courses',
          '/api/folders',
          '/api/trinkets',
          '/api/trinkets/search',
          '/api/users/resendEmailChange'
        ].forEach(function(sessionRoutePath) {
          it('GET ' + sessionRoutePath + ' answers 401 with the Boom unauthorized body', function(done) {
            flow.get(sessionRoutePath).end(flow.setLastResponse(function(err, response) {
              should.not.exist(err);
              response.statusCode.should.eql(401);
              flow.lastContentType.should.contain('application/json');
              response.body.should.have.property('statusCode', 401);
              response.body.should.have.property('error', 'Unauthorized');
              response.body.should.have.property('message', 'Not logged in');
              done();
            }));
          });
        });
      });

      describe('the one route that answers 500 unconditionally', function() {
        /**
         * PRESERVED QUIRK - REPRODUCED, NOT REPAIRED.
         *
         * GET /api/users/assets is declared with an optional query schema, no session requirement and no
         * pre array, so the handler is genuinely reached; it then reads request.query.type and calls
         * toLowerCase on it before the `|| []` fallback can apply. With no query string that is undefined,
         * the synchronous TypeError reaches the centralized error map, and the map answers
         * badImplementation. Measured at 500, with the error text scrubbed to the fixed 5xx string.
         *
         * TWO READINGS TO CORRECT, BOTH MEASURED. It is NOT a 404 - the assets feature flag is off, but no
         * pre-handler anywhere gates this route, so the flag never reaches it. And it does NOT render the
         * error page - the path begins /api/, so isApiRequest is true and the HTML branch of the lifecycle
         * extension is skipped. What comes back is Boom JSON, which is why the key set is asserted exactly.
         */
        it('GET /api/users/assets answers 500 as Boom JSON rather than a rendered page', function(done) {
          flow.get('/api/users/assets').end(flow.setLastResponse(function(err, response) {
            should.not.exist(err);
            response.statusCode.should.eql(500);
            flow.lastContentType.should.contain('application/json');
            response.body.should.have.property('statusCode', 500);
            response.body.should.have.property('error', 'Internal Server Error');
            response.body.should.have.property('message', 'An internal server error occurred');
            // Exactly the three Boom keys and nothing else. This is the assertion that would fail if the
            // response ever became the rendered error page instead.
            Object.keys(response.body).sort().should.eql(['error', 'message', 'statusCode']);
            done();
          }));
        });
      });

      describe('the trinket-type feature-flag gates', function() {
        /**
         * PRESERVED QUIRK - the feature flags enable exactly one trinket type, and the ten disabled types
         * answer 404 rather than 403 or a placeholder page. The gate lives in a pre-handler that derives
         * the language from the first path segment, promotes it only when the type is KNOWN, and then
         * rejects a known-but-disabled type with notFound. Its own asymmetry is part of the quirk: the
         * known-type predicate answers false on absent configuration while the enabled-type predicate
         * answers true, and an unknown type answers false despite the neighbouring comment claiming the
         * opposite default. That self-contradiction is preserved rather than resolved.
         *
         * Every one of these gated declarations is a NON-/api/ path, which is why the response here is the
         * rendered 404 page rather than Boom JSON.
         */
        ['/html', '/java', '/blocks', '/R'].forEach(function(disabledTypePath) {
          it('GET ' + disabledTypePath + ' answers 404 with the not-found page', function(done) {
            flow.get(disabledTypePath).end(flow.setLastResponse(function(err, response) {
              should.not.exist(err);
              response.statusCode.should.eql(404);
              flow.lastContentType.should.contain('text/html');
              pageTitle(response).should.eql('Page not found');
              done();
            }));
          });
        });

        it('GET /python, the one enabled type, answers 200 with an HTML page', function(done) {
          flow.get('/python').end(flow.setLastResponse(function(err, response) {
            should.not.exist(err);
            response.statusCode.should.eql(200);
            flow.lastContentType.should.contain('text/html');
            done();
          }));
        });

        /**
         * PRESERVED QUIRK - THE EMBED IFRAMES BYPASS THE GATE THEIR OWN PAGES ARE BEHIND.
         *
         * /blocks and /glowscript-blocks are both disabled types and both answer 404 above, yet the embed
         * iframe route for each answers 200. The iframe declarations simply carry no trinket-type gate in
         * their pre array, so nothing consults the feature flags on the way in. Measured on both.
         *
         * This is the sharpest available demonstration that the gate is per-declaration rather than
         * per-language, and it is preserved rather than made consistent: adding the gate would take two
         * working pages to 404, and removing it elsewhere would expose ten disabled types.
         */
        ['/embed/blocks-iframe', '/embed/glowscript-blocks-iframe'].forEach(function(embedPath) {
          it('GET ' + embedPath + ' answers 200 though its own type is disabled', function(done) {
            flow.get(embedPath).end(flow.setLastResponse(function(err, response) {
              should.not.exist(err);
              response.statusCode.should.eql(200);
              flow.lastContentType.should.contain('text/html');
              done();
            }));
          });
        });
      });

      describe('the trinket-type alias redirects', function() {
        /**
         * The four aliases, each an absolute 302 onto a canonical type path. They carry NO pre array at
         * all, which is why the trinket-type gate never runs on them - and that has an observable
         * consequence worth locking in: /vpython and /webvpython both redirect onto /glowscript, a type
         * the feature flags DISABLE, so following either alias lands on the 404 asserted above. The
         * redirect is emitted anyway. Measured, and preserved.
         *
         * The Location is ABSOLUTE here, where the takeover redirect asserted below is RELATIVE. Both
         * forms are part of the wire contract, so each is asserted in the form it actually takes: the
         * origin itself is deployment configuration and is deliberately not hard-coded, so absoluteness is
         * asserted structurally - the header carries the path but is not equal to it.
         */
        [
          { alias : '/r',          canonicalPath : '/R' },
          { alias : '/skulpt',     canonicalPath : '/python' },
          { alias : '/vpython',    canonicalPath : '/glowscript' },
          { alias : '/webvpython', canonicalPath : '/glowscript' }
        ].forEach(function(aliasRoute) {
          var label = 'GET ' + aliasRoute.alias + ' answers an absolute 302 to ' + aliasRoute.canonicalPath;

          it(label, function(done) {
            flow.get(aliasRoute.alias).end(flow.setLastResponse(function(err, response) {
              should.not.exist(err);
              response.statusCode.should.eql(302);
              response.redirect.should.be.true;
              flow.lastRedirect.pathname.should.eql(aliasRoute.canonicalPath);
              response.headers.location.should.contain(aliasRoute.canonicalPath);
              response.headers.location.should.not.eql(aliasRoute.canonicalPath);
              done();
            }));
          });
        });
      });

      describe('the HTML takeover of an unauthenticated session route', function() {
        /**
         * The counterpart to the 401 cohort, and the reason no request in this file may set an Accept
         * header. These paths require the same session strategy as the seven /api/ routes above, but
         * because they are not API requests the lifecycle extension converts the unauthorized result into
         * a redirect that takes over the response. Same rejection, two entirely different wire outcomes,
         * selected purely by the isApiRequest predicate.
         *
         * Setting Accept: application/json would move all three onto a raw 401 and this contrast - the
         * single most load-bearing consequence of the request policy - would vanish. The Location is
         * RELATIVE, asserted as the literal header, in contrast to the absolute alias redirects above.
         */
        ['/admin', '/welcome', '/courses/new'].forEach(function(sessionPagePath) {
          it('GET ' + sessionPagePath + ' answers a relative 302 to the login page', function(done) {
            flow.get(sessionPagePath).end(flow.setLastResponse(function(err, response) {
              should.not.exist(err);
              response.statusCode.should.eql(302);
              response.redirect.should.be.true;
              response.headers.location.should.eql('/login');
              flow.lastRedirect.pathname.should.eql('/login');
              done();
            }));
          });
        });
      });

      describe('the routed but unexported trinket listings', function() {
        /**
         * R-6 ADJUDICATION, MEASURED - AND IT REFUTES A WIDELY-REPEATED CLAIM.
         *
         * mostActive and risingActive are routed but exported nowhere, and the claim attached to that fact
         * was that both routes therefore answer 200 through the parser's no-handler fallback. The premise
         * is true; the conclusion is false, and it was measured false.
         *
         * PREDICTED from source: 404. MEASURED: 404, with Boom's default not-found body. The fallback is
         * never reached because both declarations carry a top-level pre array, and top-level pre entries
         * run serially ahead of the handler and short-circuit on rejection. The FIRST of them is the
         * language validator, which derives the language from the whole path - so the candidate here is
         * the literal path, not a language - finds it absent from the trinket language enum, and rejects
         * with notFound carrying NO message. That absent message is exactly why the measured body reads
         * Not Found rather than anything descriptive, and it is the detail that identifies WHICH of the
         * three possible short-circuits fired: the admin check that follows it would have answered 403,
         * and the fallback would have answered 200.
         *
         * ⛔ The repair for this is NOT to add the two missing handlers. That would create behaviour where
         * there is none today and add routes the change explicitly excludes. If these assertions ever fail
         * with a 200, a handler was added and must be removed.
         */
        ['/api/trinkets/popular', '/api/trinkets/active'].forEach(function(unexportedRoutePath) {
          it('GET ' + unexportedRoutePath + ' answers 404 from the language gate', function(done) {
            flow.get(unexportedRoutePath).end(flow.setLastResponse(function(err, response) {
              should.not.exist(err);
              response.statusCode.should.eql(404);
              flow.lastContentType.should.contain('application/json');
              response.body.should.have.property('statusCode', 404);
              response.body.should.have.property('error', 'Not Found');
              response.body.should.have.property('message', 'Not Found');
              done();
            }));
          });
        });
      });

      describe('a rejected request delivered as HTTP 200', function() {
        /**
         * PRESERVED QUIRK, FIRST ORDER - THE FAILURE RESPONDER ANSWERS 200.
         *
         * When a route declares neither a fail redirect nor a fail template, the failure responder falls
         * through to a plain response, and a plain response is an HTTP 200. So a rejected credential, an
         * unconfigured integration and a schema violation all reach the client as 200 carrying a body that
         * describes the failure. Measured on four separate paths, and all four are reproduced: three here,
         * and the rejected password in the authenticated block below.
         *
         * A client written against this application may well branch on the body rather than on the status,
         * which is precisely why R-4 forbids improving it. If one of these becomes a 4xx, the failure
         * responder changed.
         */
        it('GET /auth/google answers 200 carrying its own failure message', function(done) {
          flow.get('/auth/google').end(flow.setLastResponse(function(err, response) {
            should.not.exist(err);
            response.statusCode.should.eql(200);
            flow.lastContentType.should.contain('application/json');
            response.body.should.have.property('message');
            response.body.message.should.contain('Google OAuth is not configured');
            // The responder injects flash unconditionally, after the field projection, on every body it
            // builds. That is why no assertion in this file compares a whole body for equality.
            response.body.should.have.property('flash');
            done();
          }));
        });

        it('POST /api/users/login answers 200 for an unknown account', function(done) {
          flow.post('/api/users/login')
            .send({ email : 'no-such-account@example.com', password : 'irrelevant' })
            .end(flow.setLastResponse(function(err, response) {
              should.not.exist(err);
              response.statusCode.should.eql(200);
              flow.lastContentType.should.contain('application/json');
              response.body.should.have.property('message');
              response.body.message.should.contain('Unknown user');
              response.body.should.have.property('flash');
              // No credential is issued on this path, and no session projection is returned with it.
              response.body.should.not.have.property('data');
              response.body.should.not.have.property('status');
              done();
            }));
        });

        it('POST /api/users/login answers 200 for a schema violation, echoing the payload', function(done) {
          // defaults.recaptcha is a field the login schema does not declare, so it drives BOTH failure
          // modes at once: a required field is missing and an undeclared one is present.
          var undeclaredField = 'g-recaptcha-response';

          flow.post('/api/users/login').send(defaults.recaptcha)
            .end(flow.setLastResponse(function(err, response) {
              should.not.exist(err);
              response.statusCode.should.eql(200);
              flow.lastContentType.should.contain('application/json');
              // The validation bridge hands the RAW submitted payload to the failure responder, so it
              // comes straight back out. Measured.
              response.body.should.have.property(undeclaredField, defaults.recaptcha[undeclaredField]);
              response.body.should.have.nested.property('flash.validation');
              // TWO errors reported for ONE request, which is the observable proof that the bridge still
              // validates with abortEarly off. Losing either entry would be a validation-outcome change.
              response.body.flash.validation.should.have.property('email');
              response.body.flash.validation.should.have.property(undeclaredField);
              // PRESERVED QUIRK - the raw technical validator message reaches the user. The friendly
              // override declared for these forms is looked up by matching its key against the message
              // text, the match never succeeds, and the override never fires. Asserting the substance of
              // the raw message rather than its exact literal keeps this quote-free and still fails the
              // moment a friendly message replaces it.
              response.body.flash.validation.email.should.contain('is required');
              response.body.flash.validation[undeclaredField].should.contain('is not allowed');
              done();
            }));
        });
      });

      describe('the three pages that deny framing', function() {
        // The xframeDeny list names exactly three paths, and all three are asserted here so that the list
        // cannot be extended or trimmed unobserved - every other page in this file is asserted to carry no
        // framing header at all. /login and /signup are also the unauthenticated half of the pair whose
        // authenticated half is the flagship quirk below; both were measured at 200 without a session.
        it('GET / answers 200 with the splash page and denies framing', function(done) {
          flow.get('/').end(flow.setLastResponse(function(err, response) {
            should.not.exist(err);
            response.statusCode.should.eql(200);
            flow.lastContentType.should.contain('text/html');
            pageTitle(response).should.eql('Trinket');
            response.headers['x-frame-options'].should.eql('deny');
            done();
          }));
        });

        it('GET /login answers 200 and denies framing', function(done) {
          flow.get('/login').end(flow.setLastResponse(function(err, response) {
            should.not.exist(err);
            response.statusCode.should.eql(200);
            flow.lastContentType.should.contain('text/html');
            pageTitle(response).should.eql('Trinket');
            response.headers['x-frame-options'].should.eql('deny');
            done();
          }));
        });

        it('GET /signup answers 200 and denies framing', function(done) {
          flow.get('/signup').end(flow.setLastResponse(function(err, response) {
            should.not.exist(err);
            response.statusCode.should.eql(200);
            flow.lastContentType.should.contain('text/html');
            response.headers['x-frame-options'].should.eql('deny');
            done();
          }));
        });
      });
    });

    /**
     * ⛔ STATE ISOLATION, AND WHY THIS BLOCK CREATES ITS OWN ACCOUNT.
     *
     * test/helpers/flow.js exports a SINGLETON whose active slot and cookie map are shared by every suite
     * in the folder, and this suite runs after the others. The shared user slot it inherits holds the
     * CLEARED cookie the logout suite deliberately left there, and the shared account's password is one
     * the forgot-password suite deliberately changed. Worse, switchUser short-circuits when a slot already
     * holds a cookie: handing it a callback for the shared slot would invoke that callback immediately and
     * reuse the logged-out credential, so every assertion below would pass against no session at all.
     * That false green is exactly the failure R-6 exists to prevent.
     *
     * So the pattern is the one the profile suite uses: switch to a slot no other suite touches WITHOUT a
     * callback - which only assigns the slot and never dereferences a defaults entry, and is why no
     * defaults entry is needed or wanted for it - then register a fresh account over real HTTP. The
     * server's Set-Cookie is cached against the new slot as that response is recorded, which is what makes
     * the session genuinely fresh rather than inherited.
     */
    describe('As an authenticated user', function() {
      var PARITY_SLOT = 'parity',
          PARITY_ACCOUNT = {
            fullname : 'parity user',
            username : 'parity',
            email    : 'parity@example.com',
            password : 'parity'
          },
          parityUser;

      before(function(done) {
        flow.switchUser(PARITY_SLOT);
        flow.register(PARITY_ACCOUNT, function(registerError) {
          if (registerError) {
            return done(registerError);
          }

          // The bare sloppy-mode model global, assigned by app.js during boot. It is used here without a
          // require exactly as the profile and registration suites use it; requiring mongoose directly
          // would bypass the plugins and hooks the application registers.
          return User.findByLogin(PARITY_ACCOUNT.email, function(lookupError, doc) {
            if (lookupError) {
              return done(lookupError);
            }

            parityUser = doc;

            return done();
          });
        });
      });

      after(function(done) {
        // The mongoose 6 callback form. mongoose is deliberately held inside the 6.x line, so this is
        // still the supported shape and must not be promisified.
        parityUser.remove(function(removeError) {
          // Hand the singleton back in its anonymous state rather than pointing at an account this hook
          // just deleted. The suite registered after this one restores whatever it inherits, so this is
          // hygiene for state THIS block mutated rather than a dependency of anything else.
          flow.switchUser('');

          return done(removeError);
        });
      });

      it('drives its assertions through an account distinct from the shared fixture', function() {
        // The guard on the isolation above. If a later edit ever pointed this block at the shared
        // fixture, every authenticated assertion would start passing against a cleared session and this
        // is the assertion that would catch it.
        PARITY_ACCOUNT.email.should.not.eql(defaults.user.email);
        PARITY_ACCOUNT.username.should.not.eql(defaults.user.username);
        should.exist(parityUser);
        parityUser.email.should.eql(PARITY_ACCOUNT.email);
      });

      describe('the pages that answer differently once a session exists', function() {
        /**
         * ⛔⛔ THE FLAGSHIP PRESERVED QUIRK. READ THIS BEFORE TOUCHING THE TWO ASSERTIONS BELOW.
         *
         * Authenticated GET /login and GET /signup answer HTTP 500 and render the error page. They have
         * always done so, and they must continue to.
         *
         * The mechanism: both handlers took the PROPERTY form of the legacy redirect on their
         * already-authenticated branch, and the legacy responder was a bare function with no redirect
         * property, so the call raised a TypeError. The centralized error map turned that into
         * badImplementation, and the lifecycle extension rendered it as the error page because these are
         * non-/api/ HTML paths. Measured at the base commit: 500 when a session cookie is present, 200
         * when it is not. Measured on this tree: still 500, still raised from the same two handlers, whose
         * migrated form reproduces the TypeError deliberately.
         *
         * ⛔ A naive conversion of the property form to the toolkit redirect turns both of these into a
         * 302 - a silent behaviour change on a login page, which is exactly what R-4 forbids. If either
         * assertion below fails with a 302, THE CONTROLLER WAS CONVERTED WRONGLY AND THE CONTROLLER IS
         * WHAT MUST BE FIXED. Do not adjust these expectations to match a 302.
         *
         * The two working handlers beside them are asserted in the same block deliberately, so the
         * contrast is visible: they took the CALL form of the same redirect, and they answer 302 and 200
         * correctly. The defect is confined to the property-form pair, and the pair below proves it.
         */
        it('GET /login answers 500 and renders the error page', function(done) {
          flow.get('/login').end(flow.setLastResponse(function(err, response) {
            should.not.exist(err);
            response.statusCode.should.eql(500);
            flow.lastContentType.should.contain('text/html');
            pageTitle(response).should.eql('Something went wrong');
            // The rendered error page returns from the lifecycle extension before the header block, so it
            // carries no framing header - unlike the same path answering 200 without a session, which
            // does. Measured on both.
            should.not.exist(response.headers['x-frame-options']);
            done();
          }));
        });

        it('GET /signup answers 500 and renders the error page', function(done) {
          flow.get('/signup').end(flow.setLastResponse(function(err, response) {
            should.not.exist(err);
            response.statusCode.should.eql(500);
            flow.lastContentType.should.contain('text/html');
            pageTitle(response).should.eql('Something went wrong');
            should.not.exist(response.headers['x-frame-options']);
            done();
          }));
        });

        it('GET /home answers 200 with the signed-in page', function(done) {
          flow.get('/home').end(flow.setLastResponse(function(err, response) {
            should.not.exist(err);
            response.statusCode.should.eql(200);
            flow.lastContentType.should.contain('text/html');
            pageTitle(response).should.eql('Trinket');
            done();
          }));
        });

        it('GET /account answers a relative 302 to the profile page', function(done) {
          flow.get('/account').end(flow.setLastResponse(function(err, response) {
            should.not.exist(err);
            response.statusCode.should.eql(302);
            // RELATIVE, and asserted as the literal header rather than through the parsed form, because
            // the relative-versus-absolute distinction is itself part of the wire contract: the login
            // route below emits an ABSOLUTE Location for the same application.
            response.headers.location.should.eql('/account/profile');
            response.redirect.should.be.true;
            flow.lastRedirect.pathname.should.eql('/account/profile');
            done();
          }));
        });
      });

      /**
       * ORDER IS LOAD-BEARING IN THIS BLOCK. A successful login resets the session and rotates the
       * credential, which the session suite proves invalidates the cookie that preceded it. The rejected
       * attempt therefore runs FIRST, while the registration credential is still current, and the
       * successful one runs LAST so that nothing afterwards depends on a rotated session.
       */
      describe('the JSON login route', function() {
        it('POST /api/users/login answers 200 for a rejected password', function(done) {
          flow.post('/api/users/login')
            .send({ email : PARITY_ACCOUNT.email, password : 'not-the-parity-password' })
            .end(flow.setLastResponse(function(err, response) {
              should.not.exist(err);
              // PRESERVED QUIRK - the failure responder again. A rejected credential is an HTTP 200
              // carrying a message, not a 401. Measured.
              response.statusCode.should.eql(200);
              flow.lastContentType.should.contain('application/json');
              response.body.should.have.property('message', 'Invalid password');
              response.body.should.have.property('flash');
              // Nothing about the account leaks on the rejected path.
              response.body.should.not.have.property('data');
              done();
            }));
        });

        it('POST /api/users/login answers 200 with the reduced projection', function(done) {
          flow.post('/api/users/login')
            .send({ email : PARITY_ACCOUNT.email, password : PARITY_ACCOUNT.password })
            .end(flow.setLastResponse(function(err, response) {
              should.not.exist(err);
              response.statusCode.should.eql(200);
              flow.lastContentType.should.contain('application/json');
              response.body.should.have.property('status', 'success');
              should.exist(response.body.data);
              // EXACTLY the six projected fields. The route's inline pre-handler returns true
              // unconditionally, which is what selects this reduced projection over the whole document, so
              // the key set is the observable proof that the pre-handler still returns a truthy value
              // under its original key name.
              Object.keys(response.body.data).sort()
                .should.eql(['email', 'fullname', 'id', 'name', 'roles', 'username']);
              response.body.data.should.have.property('email', PARITY_ACCOUNT.email);
              response.body.data.should.have.property('username', PARITY_ACCOUNT.username);
              response.body.data.should.have.property('fullname', PARITY_ACCOUNT.fullname);
              // ⛔ THE HASH MUST NEVER APPEAR IN THIS PROJECTION.
              response.body.data.should.not.have.property('password');
              // The encrypted roles token is built over a FRESH random passphrase on every call, so two
              // identical requests return different strings - measured. Presence and type only; asserting
              // a value here would make this suite flaky, and a flaky parity test is worse than none.
              response.body.data.should.have.property('roles');
              response.body.data.roles.should.be.a('string');
              // The unconditional flash injection reaches this body too, carrying the identifier the
              // handler flashed just before responding.
              response.body.should.have.nested.property('flash.requested');
              done();
            }));
        });
      });
    });
  });
};
