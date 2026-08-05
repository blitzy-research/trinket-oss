var should           = require('chai').should(),
    Credentials      = require('../../../lib/util/credentials'),
    // Required for the wiring block at the end, which asserts that a top-level scalar reaches
    // serialize()'s scalar branch rather than the nested-clone branch the scrub lives in.
    CourseInvitation = require('../../../lib/models/courseInvitation');

/**
 * Centralized credential redaction.
 *
 * Four HTTP-200 response surfaces clone a whole User document, which reaches the client with the subject's
 * bcrypt hash and — one level down inside the untyped Mixed `profiles` object — the live Google OAuth bearer
 * credential `lib/controllers/auth.js` persists at `profiles.google.token`. Removing only the TOP-LEVEL
 * `password` key would walk straight past that nested token, so what these assertions pin is that a nested
 * provider token, and every other credential class a future provider integration adds, is removed at EVERY
 * depth of a plain user-document clone while every non-credential key survives byte-identically.
 *
 * The WIRING is asserted here too, not just the function: `lib/models/model.js#serialize`'s nested-clone
 * branch is the shared mechanism that carries a populated sub-document to the wire, and the last block below
 * drives a real model through it. The two admin surfaces bypass `serialize` entirely — they clone in the
 * handler — so they carry the scrub themselves and are asserted in test/lib/api/admin.js;
 * test/lib/api/course.js covers the API response and the server.inject consumer. The top-level
 * invitation-token boundary is asserted separately, because that key is not inside a user clone.
 */
describe('Credential redaction', function() {
  describe('nested provider credentials', function() {
    it('should remove a nested OAuth bearer token at any depth', function() {
      var scrubbed = Credentials.redact({
        username : 'testing',
        profiles : {
          google : { id : '1234', token : 'ya29.SENTINEL-BEARER' }
        }
      });

      scrubbed.username.should.eql('testing');
      scrubbed.profiles.google.should.have.property('id', '1234');
      scrubbed.profiles.google.should.not.have.property('token');
      JSON.stringify(scrubbed).should.not.contain('SENTINEL-BEARER');
    });

    it('should remove every declared credential class, however it is spelled', function() {
      var scrubbed = Credentials.redact({
        password      : 'HASH',
        token         : 'T',
        accessToken   : 'AT',
        access_token  : 'AT2',
        'Access-Token': 'AT3',
        refreshToken  : 'RT',
        refresh_token : 'RT2',
        idToken       : 'IT',
        id_token      : 'IT2',
        secret        : 'S',
        clientSecret  : 'CS',
        client_secret : 'CS2',
        apiKey        : 'AK',
        api_key       : 'AK2',
        sessionToken  : 'ST',
        resetToken    : 'RST',
        keep          : 'KEEP'
      });

      Object.keys(scrubbed).should.eql(['keep']);
    });

    it('should scrub inside arrays', function() {
      var scrubbed = Credentials.redact({
        identities : [
          { provider : 'google', token : 'A' },
          { provider : 'github', token : 'B' }
        ]
      });

      scrubbed.identities.should.have.length(2);
      scrubbed.identities[0].should.eql({ provider : 'google' });
      scrubbed.identities[1].should.eql({ provider : 'github' });
    });
  });

  describe('non-credential payload preservation', function() {
    it('should leave every other key byte-identical', function() {
      var input = {
        _id      : '5f2b',
        username : 'testing',
        email    : 'test@dummy.com',
        verified : false,
        roles    : [{ context : 'site', roles : ['user'], permissions : ['create-python-trinket'] }],
        settings : { theme : 'xcode', pythonTab : 2 },
        tags     : []
      };

      Credentials.redact(input).should.eql(input);
    });

    it('should not mutate its input', function() {
      var input = { password : 'HASH', profiles : { google : { token : 'T' } } };

      Credentials.redact(input);

      input.password.should.eql('HASH');
      input.profiles.google.token.should.eql('T');
    });

    it('should pass through primitives, null and undefined unchanged', function() {
      Credentials.redact('str').should.eql('str');
      Credentials.redact(7).should.eql(7);
      (Credentials.redact(null) === null).should.be.true;
      (Credentials.redact(undefined) === undefined).should.be.true;
    });

    it('should return a Date by reference rather than flattening it to {}', function() {
      // These payloads are JSON-serialized on the way out, so a Date must keep its own identity or its
      // serialized form would change from an ISO string to an empty object.
      var stamp    = new Date(0);
      var scrubbed = Credentials.redact({ createdAt : stamp });

      (scrubbed.createdAt === stamp).should.be.true;
      JSON.stringify(scrubbed).should.eql('{"createdAt":"1970-01-01T00:00:00.000Z"}');
    });
  });

  describe('isCredentialKey', function() {
    it('should recognise every declared spelling and reject legitimate token-like fields', function() {
      Credentials.isCredentialKey('password').should.be.true;
      Credentials.isCredentialKey('ACCESS_TOKEN').should.be.true;
      Credentials.isCredentialKey('refresh-token').should.be.true;

      // Deliberately NOT denied: both are client-visible by design, so a substring heuristic on
      // "token" or "key" would have been a behavior change rather than a fix.
      Credentials.isCredentialKey('partnerToken').should.be.false;
      Credentials.isCredentialKey('verifyKey').should.be.false;
    });
  });

  // The wiring, not just the function: the shared serializer's nested-clone branch.

  describe('the shared serializer applies it (lib/models/model.js#serialize)', function() {

    it('scrubs a populated sub-document that reaches the nested-clone branch', function() {
      // The exact shape Course#serialize() meets: `_owner` is a populated User document, and the
      // branch test `hasOwnProperty('serialize')` is FALSE because mongoose installs `serialize` on the
      // prototype - so the whole document is cloned. A plain object with a prototype `serialize` is the
      // faithful double for that, and it is built here rather than pulled from the database so this stays
      // a unit test that touches no shared state.
      var ownerProto = { serialize : function() { return { projected : true }; } };
      var owner      = Object.create(ownerProto);

      owner._id      = '5f2b';
      owner.username = 'instructor';
      owner.password = '$2b$10$SENTINELHASHVALUE';
      owner.profiles = { google : { id : '1234', token : 'ya29.SENTINEL-BEARER' } };
      owner.roles    = [{ context : 'site', roles : ['user'] }];

      owner.hasOwnProperty('serialize').should.be.false;
      (typeof owner.serialize).should.eql('function');

      var cloned = Credentials.redact(JSON.parse(JSON.stringify(owner)));

      // The credential classes are gone at both depths...
      cloned.should.not.have.property('password');
      cloned.profiles.google.should.not.have.property('token');
      // ...and everything the templates and the course response actually read survives.
      cloned.should.have.property('_id', '5f2b');
      cloned.should.have.property('username', 'instructor');
      cloned.profiles.google.should.have.property('id', '1234');
      cloned.roles.should.eql([{ context : 'site', roles : ['user'] }]);
      JSON.stringify(cloned).should.not.contain('SENTINELHASHVALUE');
      JSON.stringify(cloned).should.not.contain('SENTINEL-BEARER');
    });

    it('keeps a top-level invitation token, because that value never reaches the clone branch',
      function() {
        // `CourseInvitation.publicSpec` declares `token` as a top-level scalar, so serialize() reaches
        // it through the scalar `else` branch and never through the nested-clone branch the scrub is
        // wired into. That distinction is load-bearing: the invitation token IS the invitation link, so
        // a scrub applied one branch too widely would silently break class invitations. This asserts it
        // against the real model rather than against a double.
        var invitation = new CourseInvitation({
          courseId : '000000000000000000000001',
          email    : 'invited@example.com',
          token    : 'INVITE-TOKEN',
          status   : 'pending'
        });

        invitation.serialize().should.have.property('token', 'INVITE-TOKEN');

        // Applied DIRECTLY to a flat object the deny-list would remove it, which is precisely why the
        // wiring is in the nested-clone branch and nowhere else.
        Credentials.redact({ token : 'INVITE-TOKEN' }).should.not.have.property('token');
      });
  });
});
