/**
 * Coverage for the same-origin destination filter (SEC-4 / SV-02, CWE-601), the security remediation the
 * cumulative review found INSIDE this migration's own code rather than in the base commit.
 *
 * `lib/http/redirect.js#internalDestination` confines a user-controlled `next` destination to this
 * application. The comparison is over the HOST[:port] and is deliberately scheme-INSENSITIVE, because at
 * the base commit a same-host destination was echoed into the Location whichever scheme it carried. An
 * intermediate revision compared complete origins instead; that changes the emitted Location - it refuses
 * `http://<configured-host>/x` where configuration publishes `https`, and it refuses the origin the client
 * itself addressed whenever hapi answers plain HTTP behind a TLS-terminating proxy or an ephemeral test
 * listener - so the scheme-insensitive comparison is what ships. The cross-scheme acceptance is a
 * preserved quirk (docs/PRESERVED-QUIRKS.md section 4.4), so it is asserted here in the accepting
 * direction on purpose.
 *
 * WHY THIS FILE EXISTS TWICE OVER. A later revision deleted this file together with the helpers it
 * covers, on the argument that an open-redirect repair is not one of R-1's four sanctioned diff
 * categories. The final security review found the hole live and the deletion unmandated: R-1 cannot
 * license removing a control any more than adding one, R-4 conditions preservation on a quirk clients may
 * depend on, and R-6 breaks ambiguities - of which there is none, because every Location in the committed
 * corpus is same-host or relative. Both are restored, and `node test/baseline/replay.js` reports 0
 * differences with them in place.
 *
 * THE F-16 HALF LIVES ELSEWHERE. When this file was deleted its second describe block - the failure-log
 * redaction coverage for `responseContract.redactSecrets` and `isSecretField` - was extracted VERBATIM
 * into test/lib/util/log-redaction.js, which is still present and still runs. It is deliberately NOT
 * duplicated here: two copies of the same eight assertions is how a suite rots. This file therefore
 * carries the SEC-4 half only, and the pair together is the restored suite.
 *
 * Unit-level on purpose: the remediation needs no listening server, so it runs in milliseconds and cannot
 * disturb the shared database state the serial `test/lib/api` sequence depends on. The HTTP-level
 * assertions for the same contract live in test/lib/api/route-parity.js.
 *
 * The origin expectations are DERIVED FROM THE LIVE CONFIGURATION rather than hard-coded, because the
 * shipped configuration disagrees with itself on purpose: `config/default.yaml:L29-L32` declares
 * `https` + `trinket.dev` with no port, while the `config/local.yaml` that `docs/setup.md` tells a
 * developer to create declares `http` + `localhost` + 3000. Deriving them means this file asserts the
 * same invariant under either one.
 */
var should   = require('chai').should(),
    config   = require('config'),
    Redirect = require('../../../lib/http/redirect');

/** The scheme the application publishes itself under, as config/app.config.js assembles config.url. */
function canonicalScheme() {
  return config.app.url.protocol === 'http' ? 'http:' : 'https:';
}

/** The same origin with its scheme flipped - the destination the base commit accepted unchanged. */
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
    // Same host, other scheme. The base commit echoed this destination back byte-for-byte, so it is
    // accepted here too: the comparison is over the host, and a same-host Location cannot leave the
    // origin. Refusing it would change the emitted Location, which R-4 forbids and which code review
    // rejected when an intermediate revision compared complete origins. See
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
    // The address in use legitimately differs from config.app.url under supertest, under the R-6
    // harness and in development, which is why the request's own Host counts as this application's.
    // It is honoured under either scheme - hapi answers plain http behind a TLS-terminating proxy and
    // on an ephemeral test listener, and the base commit echoed those destinations back unchanged.
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
