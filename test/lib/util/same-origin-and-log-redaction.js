/**
 * Coverage for the two security remediations that the cumulative review found INSIDE this
 * migration's own code rather than in the base commit:
 *
 *   F-15 / S-1 (CWE-601) - `lib/http/redirect.js#internalDestination` compared the HOST only, so
 *                          `http://<configured-host>/x` was accepted on a deployment that publishes
 *                          `https://<configured-host>`. No Strict-Transport-Security header exists in
 *                          the response contract (app.js:L205-L240), so nothing downstream caught it.
 *                          Complete origins - scheme, host and port - are compared now.
 *   F-16 / S-2 (CWE-532) - `lib/http/responseContract.js#reject` logs the failure payload it is handed
 *                          and `lib/http/validation.js` hands it `request.payload`, so a failed signup
 *                          wrote the submitted password to the application log in cleartext. The
 *                          payload is redacted on the way to the log ONLY; the object that is flashed
 *                          and re-rendered is untouched, because that is the frozen behavior.
 *
 * Both are unit-level on purpose: neither remediation needs a listening server, and keeping them off
 * the HTTP path means they run in milliseconds and cannot disturb the shared database state the serial
 * `test/lib/api` sequence depends on.
 *
 * The origin expectations are DERIVED FROM THE LIVE CONFIGURATION rather than hard-coded, because the
 * shipped configuration disagrees with itself on purpose: `config/default.yaml:L29-L32` declares
 * `https` + `trinket.dev` with no port, while the `config/local.yaml` that `docs/setup.md` tells a
 * developer to create declares `http` + `localhost` + 3000. Deriving them means this file asserts the
 * same invariant under either one.
 */
var should   = require('chai').should(),
    util     = require('util'),
    config   = require('config'),
    Redirect = require('../../../lib/http/redirect'),
    Contract = require('../../../lib/http/responseContract');

/** The scheme the application publishes itself under, exactly as redirect.js derives it. */
function canonicalScheme() {
  return config.app.url.protocol === 'http' ? 'http:' : 'https:';
}

/** The same origin with its scheme flipped - the destination F-15 says must be refused. */
function flippedOrigin() {
  return canonicalScheme() === 'https:'
    ? config.url.replace(/^https:/, 'http:')
    : config.url.replace(/^http:/, 'https:');
}

/**
 * A minimal hapi-request double carrying only what internalDestination reads: the WHATWG
 * `request.url`, `request.info.host` and `request.server.info.protocol`.
 */
function requestDouble(origin) {
  var parsed = new URL(origin);

  return {
    url    : parsed,
    info   : { host : parsed.host },
    server : { info : { protocol : parsed.protocol.replace(/:$/, '') } }
  };
}

describe('same-origin destination filter (F-15)', function() {

  it('returns an in-application path unchanged', function() {
    Redirect.internalDestination('/u/instructor/classes/algebra-1?assignment=7#work')
      .should.eql('/u/instructor/classes/algebra-1?assignment=7#work');
  });

  it('returns an absolute destination on the configured origin unchanged', function() {
    var destination = config.url + '/u/instructor/classes/algebra-1?assignment=7#work';

    Redirect.internalDestination(destination).should.eql(destination);
  });

  it('refuses the configured host on the other scheme', function() {
    // This is the finding: same host, different scheme. Under a https deployment it is the
    // downgrade; under a http development origin it is the mirror case, and both must be refused
    // because neither is the origin this application publishes.
    should.equal(Redirect.internalDestination(flippedOrigin() + '/home'), null);
  });

  it('refuses an off-origin absolute URL, the userinfo disguise and the scheme-relative form', function() {
    should.equal(Redirect.internalDestination('https://evil.example/home'), null);
    should.equal(Redirect.internalDestination(canonicalScheme() + '//' +
      config.app.url.hostname + '@evil.example/home'), null);
    should.equal(Redirect.internalDestination('//evil.example'), null);
    should.equal(Redirect.internalDestination('/\\evil.example'), null);
    should.equal(Redirect.internalDestination('javascript:alert(1)'), null);
    should.equal(Redirect.internalDestination('courses/algebra-1'), null);
  });

  it('honours the origin the client addressed, and never a weaker scheme than the configured one',
    function() {
      // The address in use legitimately differs from config.app.url under supertest, under the R-6
      // harness and in development, which is why the request's own origin counts as this
      // application's. Behind a TLS-terminating proxy, though, hapi sees plain http for a request the
      // browser made over https - so a http request origin is refused whenever configuration says
      // https, which is what keeps the downgrade closed.
      var request = requestDouble('http://127.0.0.1:34567');

      if (canonicalScheme() === 'http:') {
        Redirect.internalDestination('http://127.0.0.1:34567/home', request)
          .should.eql('http://127.0.0.1:34567/home');
      }
      else {
        should.equal(Redirect.internalDestination('http://127.0.0.1:34567/home', request), null);
      }

      // Either way, the request's Host never widens the accepted set to another host.
      should.equal(Redirect.internalDestination('http://evil.example/home', request), null);
    });

  it('keeps confineToOrigin root-relative for every hostile interpolation', function() {
    Redirect.confineToOrigin('/sign-up').should.eql('/sign-up');
    Redirect.confineToOrigin('//evil.example').should.eql('/evil.example');
    Redirect.confineToOrigin('/\\evil.example').should.eql('/evil.example');
    Redirect.confineToOrigin('/re\r\nsponse-split').should.eql('/response-split');
  });
});

describe('failure-log redaction (F-16)', function() {

  it('replaces every secret-bearing key on the way to the log', function() {
    var redacted = Contract.redactSecrets({
      username        : 'instructor',
      password        : 'hunter2',
      password_verify : 'hunter2',
      formName        : 'sign-up',
      nested          : { apiKey : 'abc', token : 'tok', keep : 'yes' },
      list            : [{ secret : 's' }, 'plain']
    });

    redacted.password.should.eql('[REDACTED]');
    redacted.password_verify.should.eql('[REDACTED]');
    redacted.nested.apiKey.should.eql('[REDACTED]');
    redacted.nested.token.should.eql('[REDACTED]');
    redacted.list[0].secret.should.eql('[REDACTED]');

    // Everything that is not a credential still reads exactly as it did, because the log line is
    // how a failed signup is diagnosed.
    redacted.username.should.eql('instructor');
    redacted.formName.should.eql('sign-up');
    redacted.nested.keep.should.eql('yes');
    redacted.list[1].should.eql('plain');
  });

  it('never mutates the object that is flashed and re-rendered', function() {
    var payload = { username : 'instructor', password : 'hunter2' };

    Contract.redactSecrets(payload);

    // The response half of the contract is frozen: reject() flashes and returns this very object.
    payload.password.should.eql('hunter2');
  });

  it('passes non-container values through, so an Error still logs what it always did', function() {
    var error = new Error('boom');

    Contract.redactSecrets(error).should.equal(error);
    Contract.redactSecrets('a string').should.eql('a string');
    should.equal(Contract.redactSecrets(null), null);
    Contract.redactSecrets(7).should.eql(7);
  });

  it('terminates on a cyclic payload without handing the unwalked original back', function() {
    var payload = { password : 'hunter2' };

    payload.self = payload;

    var logged = util.inspect(Contract.redactSecrets(payload));

    logged.should.contain('[REDACTED]');
    logged.should.contain('[Circular]');
    // The stop condition must yield a MARKER, not `payload` itself: util.inspect renders a
    // cycle one level below where it is found, so returning the container would print the
    // plaintext at that level and defeat the whole pass.
    logged.should.not.contain('hunter2');
  });

  it('stops at the depth cap with a marker, so a deeply buried credential cannot slip through',
    function() {
      var leaf = { password : 'hunter2' };
      var payload = { a : { b : { c : { d : { e : { f : leaf } } } } } };

      var logged = util.inspect(Contract.redactSecrets(payload), { depth : 12 });

      logged.should.contain('[Depth limit]');
      logged.should.not.contain('hunter2');
    });

  it('redacts a value that is referenced twice, because only a true cycle stops the walk',
    function() {
      var shared = { token : 'abc123' };
      var payload = { first : shared, second : shared };

      var logged = util.inspect(Contract.redactSecrets(payload), { depth : 6 });

      logged.should.not.contain('abc123');
      logged.should.not.contain('[Circular]');
    });

  it('recognises a secret-bearing validation fieldPath by its leaf, and only when key is a word',
    function() {
      Contract.isSecretField('password').should.be.true;
      Contract.isSecretField('user.password').should.be.true;
      Contract.isSecretField('resetKey').should.be.true;
      Contract.isSecretField('reset_password_key').should.be.true;
      Contract.isSecretField('username').should.be.false;
      Contract.isSecretField('email').should.be.false;
      Contract.isSecretField('monkey').should.be.false;
      Contract.isSecretField('keystone').should.be.false;
    });
});
