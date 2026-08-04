var should      = require('chai').should(),
    Credentials = require('../../../lib/util/credentials');

/**
 * Review finding M6 (CWE-200 / CWE-522) - centralized credential redaction.
 *
 * The defect these tests pin: three response surfaces cloned a whole User document and removed only the
 * TOP-LEVEL `password` key, so the live Google OAuth bearer credential that lib/controllers/auth.js
 * persists at `profiles.google.token` - one level down inside the untyped Mixed `profiles` object
 * declared at lib/models/user.js:L18 - still reached the client. The point of these assertions is that a
 * nested provider token, and every other credential class a future provider integration would add, is
 * removed at EVERY depth while every non-credential key survives byte-identically.
 *
 * The surface-level counterparts live in test/lib/api/admin.js (both admin surfaces) and
 * test/lib/api/course.js (the API response and the server.inject consumer).
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
});
