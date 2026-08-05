// THE ENDPOINT HALF OF THE DESTRUCTIVE-OPERATION GATE, extracted so there is exactly ONE of it
// (review finding SV-04).
//
// Two modules in this tree delete data: test/helpers/db.js drops whole databases between suites, and
// test/baseline/capture.js creates and removes throwaway identities while recording the R-6 baseline.
// Both must answer the same question before they act - "is the server I am talking to actually
// disposable?" - and only the first one did. capture.js validated NODE_ENV, the database NAME pattern and
// the name configureRuntime() forced, and its own docblock claimed to be "db.js#assertDisposableDatabase
// applied to a second destructive caller", which was not true: it carried no endpoint check at all, so a
// `local.yaml` or a NODE_CONFIG layer naming a remote, credentialed, SRV, replica-set or TLS endpoint
// whose database happened to be called `test` passed the gate and was written to.
//
// Duplicating the logic into capture.js would have closed the hole and opened a worse one, because two
// copies of a security gate drift and the weaker copy is the one that matters. The logic therefore lives
// here once and both callers require it.
//
// WHY THIS MODULE HAS NO SIDE EFFECTS AND NO DEPENDENCIES. test/helpers/db.js cannot be required by
// capture.js: its first statement is `require('../setup')`, which pulls in chai, chai-as-promised and
// sinon and forces NODE_ENV, and which that file's own header explains is load-bearing for Mocha's file
// ordering. capture.js is a CLI that runs outside Mocha. So the shared gate had to be a module that
// requires nothing, opens nothing, reads no configuration and mutates no environment - it is pure
// functions over a connection object handed to it. That also makes it directly unit-testable against
// synthetic connection shapes, which is how it is verified: review finding SV-04 says in terms
// "Do not runtime-test", and no test in this repository points a driver at a non-loopback host.
//
// Only loopback is disposable. Something that deletes data has no business reaching another machine, and
// every documented way of running this harness - `npm test`, test/setup.js's forced
// `db.mongo.host: localhost`, and capture.js's own configureRuntime() - stays on the loopback interface.
// `::1` is listed in both its bare and its bracketed form because a connection string may carry either.
var DISPOSABLE_HOSTS = ['localhost', '127.0.0.1', '::1', '[::1]'];

/**
 * Reads every host the live connection is addressing, as `host:port` strings.
 *
 * Two sources are consulted and both must agree with the allow-list. `connection.host` is what mongoose
 * recorded, and the driver's own `options.hosts` is the authoritative seed list - it is what exposes a
 * SECOND seed, which `config/db.js:L20-L30` appends whenever `db.mongoread.host` is set.
 *
 * @param   {Object} connection The live mongoose connection.
 * @returns {String[]|null} The addressed endpoints, or `null` when they cannot be determined.
 */
function connectionEndpoints(connection) {
  var client    = connection && (typeof connection.getClient === 'function' ?
                    connection.getClient() : connection.client),
      options   = client && (client.options || (client.s && client.s.options)),
      seeds     = options && options.hosts,
      endpoints = [];

  // De-duplicated, because mongoose's record and the driver's seed list normally describe the same
  // endpoint and naming it twice would only make the refusal message harder to read. Both are still read:
  // a discrepancy between them adds an entry rather than hiding one.
  function record(endpoint) {
    if (endpoints.indexOf(endpoint) === -1) {
      endpoints.push(endpoint);
    }
  }

  if (connection && connection.host) {
    record(String(connection.host) + ':' + connection.port);
  }

  if (Array.isArray(seeds)) {
    seeds.forEach(function(seed) {
      // The driver models a seed as a HostAddress object; older shapes and connection strings can present
      // it as a plain string. Both are accepted, and anything else is reported verbatim so an unrecognised
      // shape fails closed rather than being read as loopback.
      record(seed && typeof seed === 'object' ? String(seed.host) + ':' + seed.port : String(seed));
    });
  }

  return endpoints.length ? endpoints : null;
}

/**
 * Describes any part of the live connection identity that makes the endpoint non-disposable.
 *
 * Returns reasons rather than a boolean so each caller can name what it refused, and so a refusal is
 * actionable instead of merely negative. An empty array is the only affirmative answer.
 *
 * @param   {Object} connection The live mongoose connection.
 * @returns {String[]} Human-readable reasons; empty when the identity is a credential-free loopback
 *   server with no SRV cluster, no replica set and no TLS.
 */
function nonDisposableIdentityReasons(connection) {
  var client  = connection && (typeof connection.getClient === 'function' ?
                  connection.getClient() : connection.client),
      options = client && (client.options || (client.s && client.s.options)),
      reasons = [],
      endpoints;

  if (!options) {
    reasons.push('the driver client exposes no options, so the endpoint cannot be identified');

    return reasons;
  }

  endpoints = connectionEndpoints(connection);

  if (!endpoints) {
    reasons.push('no host could be read from the connection');
  }
  else {
    endpoints.forEach(function(endpoint) {
      var host = endpoint.slice(0, endpoint.lastIndexOf(':'));

      if (DISPOSABLE_HOSTS.indexOf(host) === -1) {
        reasons.push('it addresses the non-loopback host ' + JSON.stringify(endpoint));
      }
    });
  }

  // A credential means somebody provisioned this server for something. Checked on the driver's resolved
  // credentials and on mongoose's own record, because a connection string can carry them either way.
  if (options.credentials || connection.user || connection.pass) {
    reasons.push('it authenticates as ' +
      JSON.stringify((options.credentials && options.credentials.username) || connection.user || 'a user'));
  }

  // An SRV record, a replica set or TLS all describe a provisioned cluster rather than a throwaway local
  // mongod, and none of the three is reachable through the identity test/setup.js and configureRuntime()
  // force.
  if (options.srvHost) {
    reasons.push('it resolves the SRV cluster ' + JSON.stringify(options.srvHost));
  }

  if (options.replicaSet) {
    reasons.push('it targets the replica set ' + JSON.stringify(options.replicaSet));
  }

  if (options.tls) {
    reasons.push('it negotiates TLS');
  }

  return reasons;
}

/**
 * The shared explanation both callers append to their own refusal message.
 *
 * Kept here with the rule it describes so the message cannot drift away from the check. Each caller
 * supplies its own prefix, because the two identify themselves differently and a reader needs to know
 * which one refused.
 *
 * @param   {String[]} reasons The result of nonDisposableIdentityReasons().
 * @returns {String} The reason list and the rule, as one sentence-tail.
 */
function refusalTail(reasons) {
  return 'the live connection is not a disposable endpoint because ' + reasons.join(', ') + '. Only a ' +
    'credential-free loopback mongod (' + DISPOSABLE_HOSTS.join(', ') + ') with no SRV cluster, no ' +
    'replica set and no TLS is treated as disposable.';
}

module.exports = {
  DISPOSABLE_HOSTS               : DISPOSABLE_HOSTS
  , connectionEndpoints          : connectionEndpoints
  , nonDisposableIdentityReasons : nonDisposableIdentityReasons
  , refusalTail                  : refusalTail
};
