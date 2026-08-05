/**
 * Coverage for the same-origin destination filter in `lib/http/redirect.js#internalDestination`, which
 * confines a user-controlled `next` destination to this application.
 *
 * ACCEPTED: a relative destination, an absolute destination on the configured host, and an absolute
 * destination on the HOST THE REQUEST ITSELF ADDRESSED — which legitimately differs from `config.app.url`
 * under supertest, under the baseline harness and in development. REFUSED: every other host, and the
 * malformed and control-character shapes a Location must never carry.
 *
 * The comparison is over the HOST[:port] and is deliberately scheme-INSENSITIVE, so a same-host destination
 * is accepted whichever scheme it carries. Comparing complete origins instead would change the emitted
 * Location: it would refuse `http://<configured-host>/x` where configuration publishes `https`, and it would
 * refuse the origin the client itself addressed whenever hapi answers plain HTTP behind a TLS-terminating
 * proxy or on an ephemeral test listener. The cross-scheme acceptance is therefore asserted here in the
 * ACCEPTING direction on purpose. See docs/PRESERVED-QUIRKS.md section 4.4.
 *
 * Unit-level on purpose: the filter needs no listening server, so it runs in milliseconds and cannot disturb
 * the shared database state the serial `test/lib/api` sequence depends on. The HTTP-level assertions for the
 * same contract live in test/lib/api/route-parity.js, and the failure-log redaction contract lives in
 * test/lib/util/log-redaction.js.
 *
 * The origin expectations are DERIVED FROM THE LIVE CONFIGURATION rather than hard-coded, because the
 * shipped configuration disagrees with itself on purpose: `config/default.yaml` declares `https` +
 * `trinket.dev` with no port, while the `config/local.yaml` that `docs/setup.md` tells a developer to create
 * declares `http` + `localhost` + 3000. Deriving them means this file asserts the same invariant under either.
 */
var should   = require('chai').should(),
    config   = require('config'),
    Redirect = require('../../../lib/http/redirect');

/** The scheme the application publishes itself under, as config/app.config.js assembles config.url. */
function canonicalScheme() {
  return config.app.url.protocol === 'http' ? 'http:' : 'https:';
}

/** The same origin with its scheme flipped, which the host-only comparison accepts. */
function flippedOrigin() {
  return canonicalScheme() === 'https:'
    ? config.url.replace(/^https:/, 'http:')
    : config.url.replace(/^http:/, 'https:');
}

/**
 * A hapi-request double. `request.info.host` is the field internalDestination reads; the WHATWG
 * `request.url` and `request.server.info.protocol` are carried too, so the double stays the shape a
 * real hapi request has rather than the shape one caller happens to need.
 */
function requestDouble(origin) {
  var parsed = new URL(origin);

  return {
    url    : parsed,
    info   : { host : parsed.host },
    server : { info : { protocol : parsed.protocol.replace(/:$/, '') } }
  };
}

describe('same-origin destination filter (SEC-4)', function() {

  it('returns an in-application path unchanged', function() {
    Redirect.internalDestination('/u/instructor/classes/algebra-1?assignment=7#work')
      .should.eql('/u/instructor/classes/algebra-1?assignment=7#work');
  });

  it('returns an absolute destination on the configured origin unchanged', function() {
    var destination = config.url + '/u/instructor/classes/algebra-1?assignment=7#work';

    Redirect.internalDestination(destination).should.eql(destination);
  });

  it('returns the configured host on the other scheme unchanged, as the base commit did', function() {
    // Same host, other scheme: accepted, because the comparison is over the host and a same-host Location
    // cannot leave the origin. Refusing it would change the emitted Location. See
    // docs/PRESERVED-QUIRKS.md section 4.4.
    var destination = flippedOrigin() + '/home';

    Redirect.internalDestination(destination).should.eql(destination);
  });

  it('refuses an off-origin absolute URL, the userinfo disguise and the scheme-relative form', function() {
    should.equal(Redirect.internalDestination('https://evil.example/home'), null);
    should.equal(Redirect.internalDestination(canonicalScheme() + '//' +
      config.app.url.hostname + '@evil.example/home'), null);
    // The suffix lookalike: host matching is exact, never a suffix test, so the configured hostname
    // appearing as a LABEL of a longer host is off-origin.
    should.equal(Redirect.internalDestination(canonicalScheme() + '//' +
      config.app.url.hostname + '.evil.example/home'), null);
    should.equal(Redirect.internalDestination('//evil.example'), null);
    should.equal(Redirect.internalDestination('/\\evil.example'), null);
    should.equal(Redirect.internalDestination('javascript:alert(1)'), null);
    should.equal(Redirect.internalDestination('courses/algebra-1'), null);
  });

  it('honours the origin the client addressed, whichever scheme that connection carries', function() {
    // The address in use legitimately differs from config.app.url under supertest, under the baseline
    // harness and in development, which is why the request's own Host counts as this application's. It is
    // honoured under either scheme, since hapi answers plain http behind a TLS-terminating proxy and on an
    // ephemeral test listener.
    var request = requestDouble('http://127.0.0.1:34567');

    Redirect.internalDestination('http://127.0.0.1:34567/home', request)
      .should.eql('http://127.0.0.1:34567/home');

    // The request's Host never widens the accepted set to another host.
    should.equal(Redirect.internalDestination('http://evil.example/home', request), null);
  });

  it('keeps confineToOrigin root-relative for every hostile interpolation', function() {
    Redirect.confineToOrigin('/sign-up').should.eql('/sign-up');
    Redirect.confineToOrigin('//evil.example').should.eql('/evil.example');
    Redirect.confineToOrigin('/\\evil.example').should.eql('/evil.example');
    Redirect.confineToOrigin('/re\r\nsponse-split').should.eql('/response-split');
  });
});
