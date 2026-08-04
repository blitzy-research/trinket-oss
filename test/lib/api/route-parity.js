var chai      = require('chai'),
    should    = chai.should(),
    supertest = require('supertest'),
    CryptoJS  = require('crypto-js'),
    capture   = require('../../baseline/capture'),
    replay    = require('../../baseline/replay'),
    roles     = require('../../../lib/util/roles'),
    app       = require('../../../app.js');

/**
 * R-6 baseline route parity.
 *
 * The review recorded that only 16 distinct route paths were asserted against 233 registered routes,
 * 117 of them under /api/, and that the baseline JSON "cannot currently be regenerated or replayed from
 * committed code". This suite closes the second half of that gap from inside the test run: it asserts
 * the route table against the committed baseline gates, and it asserts status, content-type, body shape,
 * Location and Set-Cookie attributes for every one of the 58 parameterless GET routes in the corpus.
 *
 * Division of labour with test/baseline/replay.js, which is deliberate rather than duplication:
 *
 *   - replay.js runs as a CLI against a genuinely listening server on its own port, with the exact
 *     capture request policy (no Accept, no Accept-Encoding, the pinned User-Agent), and therefore
 *     compares EVERY recorded field including the normalized HTML body digests.
 *   - this suite runs inside `npm test`, where config/test.yaml:L3 leaves app.start false and the
 *     database carries whatever the preceding eight API suites left behind. It therefore asserts the
 *     fields that are functions of routing, configuration and templates — status, content-type, body
 *     kind, the exact JSON bodies, the HTML <title> and structural markers, the literal Location and the
 *     Set-Cookie attribute set — and deliberately does NOT assert HTML body digests, because a leftover
 *     course or user from an earlier suite can legitimately change rendered markup without changing any
 *     behavior under test. Asserting a digest here would manufacture a flake; the digests are replay.js's
 *     job, on a clean capture.
 *
 * Transport: supertest binds the hapi listener and issues real HTTP over an ephemeral socket.
 * server.inject() is NOT used anywhere in this suite, for the same reason capture.js avoids it —
 * @hapi/shot/lib/request.js:L30 is the last remaining DEP0169 source in the tree. That is a rule
 * about this suite and not a claim about the application: lib/controllers/courses.js:L24 and
 * lib/controllers/folders.js:L50 both perform internal sub-requests with request.server.inject(),
 * base-identical at both commits, so DEP0169 fires once either route is exercised. Boot stays warning
 * free because nothing injects during boot. See docs/PRESERVED-QUIRKS.md section 7.6.
 */
module.exports = function() {
  describe('R-6 baseline route parity', function() {
    var corpus         = capture.loadCommittedCorpus(),
        committedTable = capture.loadCommittedRouteTable(),
        server         = null,
        live           = null,
        // An absolute Location carries the origin from config.app.url, which is deployment
        // configuration rather than behavior: default.yaml says https://trinket.dev (the origin the
        // corpus was captured under, recorded as metadata.appUrlOrigin) while local.example.yaml -
        // the file docs/setup.md tells a developer to copy, loaded last by node-config - says
        // http://localhost:3000. The measured origin is rebased onto the recorded one before the
        // comparison, which leaves the absolute-versus-relative distinction and the exact path fully
        // asserted while removing a false failure on a correctly configured checkout. See
        // test/baseline/capture.js#rebaseOrigin.
        liveOrigin     = capture.liveAppUrlOrigin(),
        corpusOrigin   = corpus.metadata.appUrlOrigin;

    before(function() {
      this.timeout(60000);

      return Promise.resolve(app).then(function(started) {
        server = started;
        live   = replay.canonicalizeLiveTable(server, committedTable);
      });
    });

    /**
     * One unauthenticated request under the capture policy. Accept is deliberately never set: app.js:L161-L163
     * turns any Accept containing application/json into an API request, which would move five of the
     * seven session-required routes off their measured takeover redirect and onto a raw 401.
     * Accept-Encoding is pinned to identity so no response is compressed, matching the corpus.
     */
    function get(path) {
      return supertest(server.listener)
        .get(path)
        .set('referer', capture.POLICY.referer)
        .set('user-agent', capture.POLICY.userAgent)
        .set('accept-encoding', 'identity')
        .redirects(0);
    }

    describe('the registered route table (TR1)', function() {
      it('registers exactly the row count the baseline recorded', function() {
        live.gates.rowCount.should.eql(committedTable.gates.rowCount);
        live.canonical.length.should.eql(committedTable.rows.length);
      });

      it('produces byte-identical canonical rows for the whole table', function() {
        live.canonical.slice().sort().should.eql(
          committedTable.rows.map(function(row) { return row.canonical; }).sort()
        );
      });

      it('reproduces gates.measuredSha256 from the live table', function() {
        replay.sha256(live.canonical.slice().sort().join('\n'))
          .should.eql(committedTable.gates.measuredSha256);
      });

      it('reproduces gates.registrationOrderFingerprint from config.routes', function() {
        var order = replay.registrationOrderCanonical(live);

        order.missing.should.eql([]);
        order.canonical.length.should.eql(committedTable.rows.length);
        replay.sha256(order.canonical.join('\n'))
          .should.eql(committedTable.gates.registrationOrderFingerprint);
      });

      it('reproduces the method distribution, /api/ path count and pre-handler count', function() {
        live.gates.methods.should.eql(committedTable.gates.methods);
        live.gates.apiPaths.should.eql(committedTable.gates.apiPaths);
        live.gates.withPreHandlers.should.eql(committedTable.gates.withPreHandlers);
      });

      it('reproduces the three auth buckets and the raw settings tally', function() {
        live.gates.authRequiredSession.should.eql(committedTable.gates.authRequiredSession);
        live.gates.authFalse.should.eql(committedTable.gates.authFalse);
        live.gates.authTryInherited.should.eql(committedTable.gates.authTryInherited);
        live.rawSettingsAuthTally
          .should.eql(committedTable.canonicalization.empiricalAuthShape.rawSettingsAuthTally);
      });

      it('keeps the server auth default that 126 rows inherit', function() {
        live.serverAuthDefault
          .should.eql(committedTable.canonicalization.empiricalAuthShape.serverAuthSettingsDefault);
      });

      /**
       * routeParser.js invokes addStaticPages FIRST and addStaticRoutes LAST, which is what keeps the
       * /{path*} catch-all from shadowing every real route. The order is contractual, so it is asserted
       * against the recorded registration order rather than merely assumed from the digest.
       */
      it('preserves the registration order contract: static pages first, catch-all last', function() {
        var order = replay.registrationOrderCanonical(live),
            paths = order.canonical.map(function(row) { return row.split(' | ')[1]; });

        paths.slice(0, 2).should.eql(['/about', '/help']);
        paths[paths.length - 1].should.eql('/{path*}');
        paths[paths.length - 2].should.eql('/.well-known/{path*}');
      });

      it('derives the corpus selection rule from the live table, not from a curated list', function() {
        capture.selectCorpusPaths(server).should.eql(corpus.selectionRule.paths);
      });

      /**
       * The corrected route arithmetic, re-derived from committed code rather than trusted.
       * route-table.json#derivation used to repeat the Technical Specification's claim that 178 declared
       * entries expand to 233; the measured declaration count is 228 (116 + 112) and the remaining 5 rows
       * are synthesized by routeParser.js. Asserting it here means the number cannot drift back.
       */
      it('re-derives the 228 declared entries and the 5 synthesized routes from committed code', function() {
        var declared = require('../../../config/api_routes').length +
                       require('../../../config/routes').length;

        declared.should.eql(committedTable.gates.declaredRouteEntries);
        require('config').routes.length.should.eql(committedTable.gates.rowCount);
        (declared + committedTable.gates.synthesizedRoutes).should.eql(committedTable.gates.rowCount);
        committedTable.gates.regressionDigest.should.eql('measuredSha256');
      });

      /**
       * THE DOCUMENTED ANCHOR, AS A MANDATORY GATE.
       *
       * The Specification's published 32-character digest is the frozen G8/TR1 anchor for this table.
       * It is retained VERBATIM and is never replaced by a measurement - replay.js carries the same
       * literal as its own constant and clause 1 of the gate compares the two, so a later edit that
       * promoted a fingerprint into its place FAILS here rather than passing quietly.
       *
       * The gate itself is COMPUTED from the live server on every run - it is not a stored flag being
       * read back. Its ten clauses are the Specification's own published values (row count, method
       * distribution, /api/ count, pre-handler count, the three auth buckets) plus the substance those
       * values summarize: the 233 canonical rows the digest stands for, compared as a sorted multiset
       * against the base-commit capture, and the registration-order contract. Any drift in any clause
       * lands in `failures` and fails this test, which is what makes it a gate.
       *
       * What is deliberately NOT asserted is an equality between the published literal and a digest
       * recomputed here. That is not a concession: the published value is 32 hexadecimal characters
       * labelled sha256 where a SHA-256 is 64, and the Specification publishes no serialization for it,
       * so no input exists from which any verifier could recompute the string
       * (route-table.json#adjudications ADJ-4 records the exhaustive search). Reverse-engineering a
       * serialization until a string matched would be a fabrication rather than a verification, and it
       * would say nothing about the table - so the table is what is held to byte-identity instead.
       *
       * Review finding history, because this block has been wrong in both directions: F-11 rejected an
       * artifact that called one measured digest subordinate, authoritative and a replacement in the
       * same block; the revision that answered it went too far the other way and asserted
       * documentedDigestReproduced === 'none' and documentedDigestGateSatisfied === false, which made
       * the suite pass BY recording noncompliance and would have failed if the gate were ever met.
       * Neither shape is acceptable, and the computed gate below is neither.
       */
      it('enforces the documented route-table anchor as a mandatory gate', function() {
        var gate = replay.documentedAnchorGate(live, committedTable);

        // The frozen literal, verbatim, from the artifact and from the verifier's own constant.
        committedTable.gates.documentedDigest.should.eql('cd2a7e38a39bd84902ac1a0d69f50e2a');
        replay.DOCUMENTED_DIGEST.should.eql('cd2a7e38a39bd84902ac1a0d69f50e2a');
        committedTable.gates.documentedDigestLabelledAs.should.eql('sha256');

        // The gate, computed live. `failures` first: it names the clause that broke.
        gate.failures.should.eql([]);
        gate.satisfied.should.eql(true);
        gate.clauses.length.should.eql(10);
        gate.clauses[0].name.should.eql('documentedDigestRetainedVerbatim');

        // The artifact's own record of the gate has to agree with what was just measured, and the
        // measured fingerprints stay subordinate to it.
        committedTable.gates.documentedAnchorGateSatisfied.should.eql(true);
        committedTable.gates.measuredFingerprintsAreSubordinate.should.eql(true);
        committedTable.gates.documentedAnchorsExceptDigestAllReproduced.should.eql(true);
      });
    });

    /**
     * The corpus records two readings of every entry: the immediate response, and the terminal response
     * of its Location chain. The resolved reading is the one the Technical Specification publishes
     * (25x200, 7x401, 25x404, 1x500), and the two readings are recomputed here from the committed
     * entries with the same helpers the harness uses, so neither can drift from the entries it summarizes.
     */
    describe('the two readings of the corpus agree with their own entries (TR2)', function() {
      it('reproduces the documented distribution from the resolved reading', function() {
        corpus.gates.documentedDistribution.should.eql({ '200' : 25, '401' : 7, '404' : 25, '500' : 1 });
        corpus.gates.measuredDistribution.should.eql(corpus.gates.documentedDistribution);
        corpus.gates.distributionMatchesDocumented.should.eql(true);
        capture.resolvedStatusDistribution(corpus.unauthenticated)
          .should.eql(corpus.gates.documentedDistribution);
      });

      it('keeps the first-hop reading beside it, unchanged', function() {
        capture.statusDistribution(corpus.unauthenticated)
          .should.eql(corpus.gates.firstHopStatusDistribution);
        corpus.gates.firstHopStatusDistribution
          .should.eql({ '200' : 12, '302' : 16, '401' : 7, '404' : 22, '500' : 1 });
      });

      it('recomputes the redirecting subset, its resolution and the hop histogram', function() {
        capture.redirectingEntryPaths(corpus.unauthenticated)
          .should.eql(corpus.gates.redirectingRoutePaths);
        corpus.gates.redirectingRouteCount.should.eql(16);
        capture.redirectResolutionDistribution(corpus.unauthenticated)
          .should.eql(corpus.gates.redirectResolution);
        capture.hopCountHistogram(corpus.unauthenticated).should.eql(corpus.gates.hopCountHistogram);
      });

      it('records a chain and a resolution for every entry, consistent with the entry itself', function() {
        corpus.unauthenticated.concat(corpus.authenticated).forEach(function(entry) {
          Array.isArray(entry.redirectChain).should.eql(true);
          entry.resolved.hops.should.eql(entry.redirectChain.filter(function(hop) {
            return hop.followed;
          }).length);

          if (entry.resolved.hops === 0) {
            entry.resolved.status.should.eql(entry.status);
            capture.isRedirectStatus(entry.status).should.eql(false);
          }
        });
      });

      it('keeps the authenticated 500 quirk terminal under the follow policy', function() {
        corpus.gates.authenticatedFirstHopStatuses['GET /login (authenticated)'].should.eql(500);
        corpus.gates.authenticatedResolvedStatuses['GET /login (authenticated)'].should.eql(500);
        corpus.gates.authenticatedFirstHopStatuses['GET /signup (authenticated)'].should.eql(500);
        corpus.gates.authenticatedResolvedStatuses['GET /signup (authenticated)'].should.eql(500);
        corpus.gates.authenticatedLoginSignup500SurvivesRedirectPolicy.should.eql(true);
        capture.authenticatedStatusMap(corpus.authenticated, 'firstHop')
          .should.eql(corpus.gates.authenticatedFirstHopStatuses);
        capture.authenticatedStatusMap(corpus.authenticated, 'resolved')
          .should.eql(corpus.gates.authenticatedResolvedStatuses);
      });
    });

    describe('parameterless GET routes replay their baseline status and shape (TR2, TR3, TR4)', function() {
      corpus.unauthenticated.forEach(function(entry) {
        var label = 'GET ' + entry.path + ' answers ' + entry.status + ' with a ' +
                    entry.bodyShape.kind + ' body';

        it(label, function(done) {
          this.timeout(20000);

          get(entry.path).end(function(err, response) {
            if (err) {
              return done(err);
            }

            response.statusCode.should.eql(entry.status);
            String(response.headers['content-type'] || '').should.eql(String(entry.contentType || ''));

            if (entry.location === null) {
              should.not.exist(response.headers.location);
            }
            else {
              capture.rebaseOrigin(response.headers.location, liveOrigin, corpusOrigin)
                .should.eql(entry.location);
            }

            if (entry.setCookieAttributes === null) {
              should.not.exist(response.headers['set-cookie']);
            }
            else {
              [].concat(response.headers['set-cookie'])
                .map(capture.setCookieAttributeNames)
                .should.eql(entry.setCookieAttributes);
            }

            if (entry.bodyShape.kind === 'empty') {
              Buffer.byteLength(response.text || '', 'utf8').should.eql(0);
            }
            else if (entry.bodyShape.kind === 'json') {
              response.body.should.eql(entry.bodyShape.body);
              Object.keys(response.body).sort().should.eql(entry.bodyShape.keys);
            }
            else {
              should.exist(response.text);
              // Two embed pages legitimately render no <title>, so the recorded value is null and the
              // comparison has to go through should.equal rather than off a possibly-null receiver.
              should.equal(capture.extractTitle(response.text), entry.bodyShape.title);
              /^\s*<!doctype html/i.test(response.text).should.eql(entry.bodyShape.markers.hasDoctype);
              /<title>\s*Page not found\s*<\/title>/i.test(response.text)
                .should.eql(entry.bodyShape.markers.notFoundPage);
              /<title>\s*Something went wrong\s*<\/title>/i.test(response.text)
                .should.eql(entry.bodyShape.markers.serverErrorPage);
            }

            done();
          });
        });
      });
    });

    /**
     * F7 — the roles-token crypto parity contract.
     *
     * responses.json normalizes the client-shipped roles token out of HTML bodies, because
     * lib/util/roles.js:L11 produces a fresh OpenSSL salt on every render and it was the last residual
     * run-to-run difference in the corpus. A bare substitution would let a build whose crypto changed
     * shape hide behind the normalizer, so the structure is asserted here and, in capture.js, gated
     * before every substitution. These are the invariants recorded in responses.json#cryptoParityContract.
     */
    describe('the roles-token crypto parity contract (F7)', function() {
      var payload = [{ context : 'site', roles : ['user'], permissions : ['create-python-trinket'] }];

      it('joins a 32-character lowercase hex passphrase to an OpenSSL base64 envelope', function() {
        var token  = roles.encrypt(payload),
            parts  = token.split('+'),
            hex    = parts[0],
            base64 = parts.slice(1).join('+');

        hex.should.match(/^[0-9a-f]{32}$/);
        base64.indexOf(capture.ROLES_TOKEN_INVARIANTS.envelopeBase64Prefix).should.eql(0);
        Buffer.from(base64, 'base64').slice(0, 8).toString('latin1').should.eql('Salted__');
      });

      it('round-trips exactly as public/js/trinket-roles.js:L7-L11 splits and decrypts it', function() {
        var token = roles.encrypt(payload),
            value = token.split('+'),
            key   = value[0],
            body  = value.slice(1).join('+'),
            clear = CryptoJS.enc.Utf8.stringify(CryptoJS.AES.decrypt(body, key));

        JSON.parse(clear).should.eql(payload);
      });

      /**
       * The ciphertext length is a deterministic function of the plaintext length — AES-CBC with PKCS#7
       * padding behind a 16-byte OpenSSL salt header — which is what makes the length safe to assert
       * rather than something that must be normalized away. Measured over plaintext lengths 0..199.
       */
      it('encodes a deterministic ciphertext length for a fixed plaintext length', function() {
        [0, 1, 15, 16, 17, 48, 199].forEach(function(length) {
          var plain    = new Array(length + 1).join('x'),
              base64   = roles.encrypt(plain).split('+').slice(1).join('+'),
              raw      = Buffer.from(base64, 'base64'),
              expected = 16 + (Math.floor(length / 16) + 1) * 16;

          raw.length.should.eql(expected);
          base64.length.should.eql(Math.ceil(expected / 3) * 4);
        });
      });

      it('accepts a real token through the capture-time structural gate', function() {
        var token       = roles.encrypt(payload),
            parts       = token.split('+'),
            measurement = capture.assertRolesTokenStructure(parts[0], parts.slice(1).join('+'), 'test');

        measurement.hexLength.should.eql(32);
        (measurement.rawLength % 16).should.eql(0);
        (measurement.base64Length % 4).should.eql(0);
      });

      /**
       * The gate must REJECT rather than normalize. Every case below matches the normalization pattern
       * (32 hex characters, a '+', then the U2FsdGVkX1 prefix) yet violates the contract, which is
       * exactly the class of change a bare substitution would have erased.
       */
      it('rejects a structurally different token instead of normalizing it away', function() {
        var hex = new Array(33).join('a');

        (function() {
          capture.assertRolesTokenStructure('NOTHEX', 'U2FsdGVkX18AAAAAAAAAAA==', 'test');
        }).should.throw(/not 32 lowercase hex/);

        (function() {
          capture.assertRolesTokenStructure(hex, 'AAAAAAAAAAAAAAAA', 'test');
        }).should.throw(/does not start with the OpenSSL base64 prefix/);

        (function() {
          capture.assertRolesTokenStructure(hex, 'U2FsdGVkX1A', 'test');
        }).should.throw(/not a whole number of base64 quanta/);

        (function() {
          capture.assertRolesTokenStructure(hex, 'U2FsdGVkX1AB', 'test');
        }).should.throw(/"Salted__" magic/);
      });

      it('normalizes a real token to the recorded replacement and to nothing else', function() {
        var token      = roles.encrypt(payload),
            rules      = capture.htmlNormalizationRules(corpus),
            body       = '<!doctype html><html><head><title>Trinket</title></head><body>' +
                         '<input id="roles" value="' + token + '"></body></html>',
            normalized = capture.normalizeHtmlBody(body, rules, 'GET /home-fixture');

        normalized.rolesTokens.length.should.eql(1);
        normalized.rolesTokens[0].hexLength.should.eql(32);
        normalized.normalized.should.contain('<ROLES_TOKEN>');
        normalized.normalized.should.not.contain(token);
        normalized.normalized.should.contain('<title>Trinket</title>');
      });
    });

    /**
     * P3-1 — the assignment `next` destination contract.
     *
     * The frozen assignment UI is the only producer of this flow and it can only produce ONE shape:
     * public/partials/directives/trinket-assignment.js registers `.filter('escape', ...)` as
     * window.encodeURIComponent (L8) and scope.goto (L334-L339) sends
     * next = escape($window.location.href) to trinketConfig.getUrl, which builds
     * config.protocol + '://' + config.apphostname + path (public/js/trinket-config.js:L34-L39). The
     * destination is therefore an ABSOLUTE same-origin URL carrying a query and a fragment, and
     * public/** is out of scope, so the server is what has to accept it.
     *
     * Measured at base commit 2f8712a and recorded in responses.json#assignmentNext, which replay.js
     * compares field by field. This suite drives the same three entry points LIVE — login, signup and
     * the OAuth persistence leg — and adds the off-origin refusals, which by construction do NOT
     * replay and therefore cannot live in the corpus.
     */
    describe('the assignment `next` destination contract (P3-1, TR2, TR4)', function() {
      var absolute      = liveOrigin + capture.ASSIGNMENT.destinationPath,
          rootRelative  = capture.ASSIGNMENT.rootRelative,
          credentials   = {
            email    : capture.THROWAWAY.email,
            password : capture.THROWAWAY.password
          };

      before(function() {
        this.timeout(60000);

        return capture.removeAssignmentSignupUser().then(function() {
          return capture.createThrowawayUser();
        });
      });

      after(function() {
        this.timeout(60000);

        return capture.removeAssignmentSignupUser().then(function() {
          return capture.removeThrowawayUser();
        });
      });

      /** The recorded entry for one hop of the flow, found by the tail of its `state` label. */
      function recordedHop(label) {
        var found = corpus.assignmentNext.filter(function(entry) {
          return String(entry.state).indexOf(label) !== -1;
        });

        found.length.should.eql(1);

        return found[0];
      }

      /** The entry hop, in the frozen producer's exact wire shape, under the capture policy. */
      function entryHop(page, candidate, host) {
        var call = get(capture.assignmentEntryPath(page, candidate));

        return host ? call.set('host', host) : call;
      }

      function postHop(path, body, cookie, host) {
        var call = supertest(server.listener)
          .post(path)
          .set('referer', capture.POLICY.referer)
          .set('user-agent', capture.POLICY.userAgent)
          .set('accept-encoding', 'identity')
          .redirects(0);

        if (cookie) { call = call.set('cookie', cookie); }
        if (host)   { call = call.set('host', host); }

        return call.send(body);
      }

      /**
       * Persist a destination through an entry page, then consume it. Resolves with the consuming
       * hop's response. Both the entry status and the presence of a session cookie are asserted, not
       * assumed: a flow that never reached the persisting branch would silently "agree" with every
       * refusal expectation below and prove nothing. `options.entryStatus` exists because the entry
       * hop is not always a 200 — a CONFIGURED GET /auth/google answers 302 to Google while storing
       * the destination on the way past.
       */
      function driveFlow(page, candidate, action, body, options) {
        var settings = options || {};

        return new Promise(function(resolve, reject) {
          entryHop(page, candidate, settings.host).end(function(err, entry) {
            if (err) { return reject(err); }

            var cookie = capture.extractSessionCookie({ headers : entry.headers });

            try {
              entry.statusCode.should.eql(settings.entryStatus || 200);
              should.exist(cookie);
            }
            catch (assertion) {
              return reject(assertion);
            }

            postHop(action, body, cookie, settings.host).end(function(postErr, consumed) {
              return postErr ? reject(postErr) : resolve(consumed);
            });
          });
        });
      }

      function loginWith(candidate, host) {
        return driveFlow('/login', candidate, '/login', credentials, { host : host });
      }

      function signupWith(candidate) {
        return capture.removeAssignmentSignupUser().then(function() {
          return driveFlow('/signup', candidate, '/users', {
            formName : capture.ASSIGNMENT.signup.formName,
            fullname : capture.ASSIGNMENT.signup.fullname,
            username : capture.ASSIGNMENT.signup.username,
            email    : capture.ASSIGNMENT.signup.email,
            password : capture.ASSIGNMENT.signup.password,
            next     : candidate
          });
        });
      }

      describe('the frozen producer this contract exists for', function() {
        it('still sends an encodeURIComponent-escaped absolute href as ?next=', function() {
          var producer = require('fs').readFileSync(
            require('path').join(__dirname, '..', '..', '..', 'public', 'partials', 'directives',
                                 'trinket-assignment.js'), 'utf8');

          // If any of these three stops being true the producer has changed shape and the contract
          // below has to be re-measured rather than trusted.
          producer.should.contain('window.encodeURIComponent');
          producer.should.contain('?next=');
          producer.should.contain('$window.location.href');
        });
      });

      describe('a same-origin absolute destination survives byte-for-byte', function() {
        it('POST /login answers 302 to the destination, query and fragment included', function() {
          this.timeout(30000);

          return loginWith(absolute).then(function(response) {
            response.statusCode.should.eql(302);
            response.headers.location.should.eql(absolute);
            // Not the declared success.redirect: that is the regression this test exists to catch.
            response.headers.location.should.not.eql(liveOrigin + '/home');
            // TR4 — the cookie contract of this cookie:true route is unchanged by the destination,
            // asserted against the attribute set the corpus recorded for this very hop, which ends
            // in the Expires that the app.js:L205-L240 rewrite appends.
            [].concat(response.headers['set-cookie']).map(capture.setCookieAttributeNames)
              .should.eql(recordedHop('login consumed, absolute same-origin').setCookieAttributes);
          });
        });

        it('POST /users answers 302 to the same destination rather than to /welcome', function() {
          this.timeout(30000);

          return signupWith(absolute).then(function(response) {
            response.statusCode.should.eql(302);
            response.headers.location.should.eql(absolute);
            response.headers.location.should.not.eql(liveOrigin + '/welcome');
          });
        });

        it('accepts an absolute destination on the Host the client itself addressed', function() {
          this.timeout(30000);

          // request.info.host is one of the three allowed origins, which is what makes the flow work
          // when the address in use differs from config.app.url — localhost in development, an
          // ephemeral supertest port here. An attacker cannot set a victim's Host header, and a
          // Location back to the host the client already addressed cannot leave that origin.
          var host    = 'assignment-host.example:1234',
              onHost  = 'http://' + host + capture.ASSIGNMENT.destinationPath;

          return loginWith(onHost, host).then(function(response) {
            response.statusCode.should.eql(302);
            response.headers.location.should.eql(onHost);
          });
        });

        it('POST /login echoes a root-relative destination unchanged, still relative', function() {
          this.timeout(30000);

          return loginWith(rootRelative).then(function(response) {
            response.statusCode.should.eql(302);
            response.headers.location.should.eql(rootRelative);
          });
        });

        it('falls back to the declared success.redirect when nothing was persisted', function(done) {
          this.timeout(30000);

          postHop('/login', credentials, null).end(function(err, response) {
            if (err) { return done(err); }

            response.statusCode.should.eql(302);
            response.headers.location.should.eql(liveOrigin + '/home');
            done();
          });
        });
      });

      /**
       * The SEC-4 refusals. Every candidate here was echoed straight back into a Location at the base
       * commit; responses.json#assignmentNextContract.securityDeviations records the three measured
       * baseline values. They are asserted here rather than in the corpus precisely because they are
       * the cases that must NOT replay.
       */
      describe('an off-origin destination is refused, leaving the declared fallback', function() {
        [
          { label : 'an off-origin absolute URL',        candidate : 'https://evil.example/steal' },
          { label : 'a scheme-relative URL',             candidate : '//evil.example/steal' },
          { label : 'the backslash form of one',         candidate : '/\\evil.example/steal' },
          { label : 'a userinfo disguise',               candidate : 'https://trinket.dev@evil.example/x' },
          { label : 'a subdomain-suffix lookalike',      candidate : 'https://trinket.dev.evil.example/x' },
          { label : 'a javascript: scheme',              candidate : 'javascript:alert(1)' },
          { label : 'a bare relative value',             candidate : 'courses/algebra-1' }
        ].forEach(function(refusal) {
          it('POST /login ignores ' + refusal.label, function() {
            this.timeout(30000);

            return loginWith(refusal.candidate).then(function(response) {
              response.statusCode.should.eql(302);
              response.headers.location.should.eql(liveOrigin + '/home');
              response.headers.location.should.not.contain('evil.example');
            });
          });
        });

        it('POST /users ignores an off-origin absolute URL', function() {
          this.timeout(30000);

          return signupWith('https://evil.example/steal').then(function(response) {
            response.statusCode.should.eql(302);
            response.headers.location.should.eql(liveOrigin + '/welcome');
          });
        });
      });

      /**
       * The OAuth leg. GET /auth/google returns before it reaches `next` when
       * config.app.auth.google.clientID is null, which is why responses.json records only that
       * outcome and why the persistence leg is driven here: the three credential keys are set for the
       * duration of this block and restored afterwards, so no YAML is edited and no other suite sees
       * the change. POST /login reads the same session slot the callback reads
       * (lib/controllers/auth.js#googleCallback -> redirectTo -> success.redirect '{redirectTo}'),
       * which is what makes the persisted value observable without Google credentials.
       */
      describe('the OAuth persistence leg', function() {
        var google   = require('config').app.auth.google,
            original = {};

        before(function() {
          original = {
            clientID     : google.clientID,
            clientSecret : google.clientSecret,
            callbackURL  : google.callbackURL
          };
          google.clientID     = 'route-parity-client-id.apps.googleusercontent.com';
          google.clientSecret = 'route-parity-client-secret';
          google.callbackURL  = liveOrigin + '/auth/google/callback';
        });

        after(function() {
          google.clientID     = original.clientID;
          google.clientSecret = original.clientSecret;
          google.callbackURL  = original.callbackURL;
        });

        it('answers 200 with no Location under the SHIPPED configuration', function(done) {
          this.timeout(30000);

          var saved = google.clientID;

          google.clientID = original.clientID;
          get(capture.assignmentEntryPath('/auth/google', absolute)).end(function(err, response) {
            google.clientID = saved;

            if (err) { return done(err); }

            // The preserved failure-responder quirk: no fail.redirect and no fail.html, so the 200
            // that responses.json#assignmentNext entry [7] records is what comes back.
            response.statusCode.should.eql(200);
            should.not.exist(response.headers.location);
            done();
          });
        });

        it('persists a same-origin absolute destination and hands it back byte-for-byte', function() {
          this.timeout(30000);

          return driveFlow('/auth/google', absolute, '/login', credentials, { entryStatus : 302 })
            .then(function(response) {
              response.statusCode.should.eql(302);
              response.headers.location.should.eql(absolute);
            });
        });

        it('does not persist an off-origin destination', function() {
          this.timeout(30000);

          return driveFlow('/auth/google', 'https://evil.example/steal', '/login', credentials,
                           { entryStatus : 302 })
            .then(function(response) {
              response.statusCode.should.eql(302);
              response.headers.location.should.eql(liveOrigin + '/home');
            });
        });

        it('redirects to Google itself, which is deliberately NOT confined to this origin', function(done) {
          this.timeout(30000);

          get(capture.assignmentEntryPath('/auth/google', absolute)).end(function(err, response) {
            if (err) { return done(err); }

            // lib/http/redirect.js does not confine declarative redirects, precisely so this one
            // still reaches accounts.google.com; only the user-controlled `next` is filtered.
            response.statusCode.should.eql(302);
            response.headers.location.indexOf('https://accounts.google.com/o/oauth2/v2/auth?')
              .should.eql(0);
            done();
          });
        });

        it('answers the declared fail.redirect when the callback arrives with no code', function(done) {
          this.timeout(30000);

          get('/auth/google/callback').end(function(err, response) {
            if (err) { return done(err); }

            response.statusCode.should.eql(302);
            response.headers.location.should.eql(liveOrigin + '/signup');
            done();
          });
        });
      });

      /** The recorded section has to agree with the gates that summarize it, as elsewhere. */
      describe('the recorded evidence agrees with its own gates', function() {
        it('recomputes the entry count, status map and Location map from the entries', function() {
          corpus.assignmentNext.length.should.eql(corpus.gates.assignmentNextEntryCount);
          capture.assignmentNextStatusMap(corpus.assignmentNext)
            .should.eql(corpus.gates.assignmentNextStatuses);
          capture.assignmentNextLocationMap(corpus.assignmentNext)
            .should.eql(corpus.gates.assignmentNextLocations);
        });

        it('records the destination itself on both consuming hops', function() {
          var destination = corpusOrigin + corpus.gates.assignmentNextDestinationPath;

          corpus.gates.assignmentNextConsumedDestination.should.eql(destination);
          corpus.gates.assignmentNextLocations['assignment-next (login consumed, absolute same-origin)']
            .should.eql(destination);
          corpus.gates.assignmentNextLocations['assignment-next (signup consumed, absolute same-origin)']
            .should.eql(destination);
          corpus.gates.assignmentNextLocations['assignment-next (login consumed, root-relative)']
            .should.eql(capture.ASSIGNMENT.rootRelative);
        });

        it('names all three deliberate SEC-4 deviations with both measured values', function() {
          var deviations = corpus.assignmentNextContract.securityDeviations.cases;

          deviations.length.should.eql(3);
          deviations.forEach(function(deviation) {
            deviation.baselineLocation.should.contain('evil.example');
            deviation.currentLocation.should.not.contain('evil.example');
            deviation.currentLocation.indexOf(corpusOrigin).should.eql(0);
          });
        });
      });
    });
  });
};
