/**
 * Parity guard for the outbound form encoding of the Google token exchange in
 * `lib/controllers/auth.js#googleCallback`.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * At the base commit that exchange went out through the retired `request` package:
 *
 *     _request.post({ url : 'https://oauth2.googleapis.com/token', form : { … }, json : true }, cb)
 *
 * `request`'s `form` option serialized the field map with `qs.stringify` under default options, which
 * gives three properties the wire depends on: a value of `undefined` OMITS the field, a value of `null`
 * emits a BARE `key=` (`strictNullHandling` is off by default), and every surviving value is
 * percent-encoded so a space is `%20` and never `+`. `request` is gone and `fetch` reproduces none of
 * that on its own - `new URLSearchParams({ a : undefined, b : null })` serializes the literal strings
 * `"undefined"` and `"null"` and encodes a space as `+` - so `encodeForm` at `lib/controllers/auth.js`
 * exists to reproduce the retired serializer exactly. See docs/PRESERVED-QUIRKS.md section 3.37.
 *
 * The first implementation of `encodeForm` filtered on `!== undefined` only, on the assumption that
 * unconfigured OAuth keys arrive as `undefined`. They do not. `config/default.yaml:L326-L328` declares
 * `app.auth.google.clientSecret`, `.clientID` and `.callbackURL` with NO value, and node-config resolves
 * a valueless YAML key to `null`. Because `encodeURIComponent(null) === 'null'`, the shipped code put
 * `client_secret=null&redirect_uri=null` on the wire where the base commit had put
 * `client_secret=&redirect_uri=`, and the `undefined` guard was dead for exactly the two fields it was
 * written to protect. Runtime QA caught it on the wire; R-6 decided the repair, because `qs`'s treatment
 * of `null` is measurable. This file pins all three arms so the regression cannot return silently:
 *
 *   1. FULL configuration       -> every field carries its value, order preserved, space as %20
 *   2. PARTIAL configuration    -> the two `null` fields are emitted as bare `key=`, never as "null"
 *   3. `undefined` values       -> the fields are omitted entirely
 *
 * Arm 2 is the shipped state of the application, which is what makes it the load-bearing one.
 *
 * HOW IT IS MEASURED
 * ------------------
 * `encodeForm` is module-private and must stay that way, so nothing here reaches for it directly.
 * Each arm instead runs the REAL exported handler in a fresh child process with `globalThis.fetch`
 * stubbed, and asserts the body bytes the handler actually handed to `fetch`. The child process is what
 * makes per-arm configuration possible at all: `config.app.auth.google` is a process-wide singleton, so
 * three configurations mean three processes, injected through `NODE_CONFIG`. The pattern - `spawnSync`
 * plus a program passed with `-e` - is the same one test/lib/util/no-response-fate.js uses.
 *
 * The stubbed token endpoint answers `{}`, so `access_token` is falsy and the handler takes its
 * normalized failure path. That is deliberate: it keeps every arm on the shortest route through the
 * handler (no session, no database, no user creation), and it lets each arm also assert that the failure
 * mapping the path has always produced is still the one it produces.
 *
 * The expected byte strings are literals, measured against `qs` 6.15.3 - the version installed in this
 * tree - rather than computed here by requiring `qs`. `qs` is a transitive dependency of the framework
 * and is not declared by this project, so depending on it from a test would couple the suite to
 * another package's dependency graph. Its default `null` and `undefined` handling is unchanged from the
 * 6.5.5 that `request@2.88.2` bundled, which is what makes the literals the base-commit bytes.
 */

var spawnSync = require('child_process').spawnSync
  , path      = require('path')
  , expect    = require('chai').expect;

// test/lib/util/oauth-form-encoding.js -> the repository root.
var REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

// Generous because it pays for a full Node process start plus a config load, and one-sided: the
// assertions read the child's output, so a slow machine cannot turn a pass into a fail.
var CHILD_TIMEOUT_MS = 20000;

// One `code` value carrying both characters that distinguish the two serializers: a space, which qs
// encodes as %20 and URLSearchParams as +, and a plus, which must survive as %2B either way.
var CODE = 'code with space+plus';

/**
 * Program text for the child. It stubs the two ambient dependencies the handler's failure path touches -
 * `globalThis.fetch` and the undeclared `log` global that app.js normally assigns - records the request
 * the handler builds, then prints it as JSON alongside the configuration the child resolved.
 *
 * PARITY_UNDEFINE, when set, names the `app.auth.google` keys to delete from the resolved configuration
 * before the handler runs. Deleting a key is the only way to reach the `undefined` arm: NODE_CONFIG is
 * JSON, so it cannot express `undefined`, and config/default.yaml always supplies the key as `null`.
 */
var CHILD_SOURCE = [
  'var repoRoot = process.env.PARITY_REPO_ROOT;',
  'var recorded = null;',
  'global.log = { error : function () {} };',
  'globalThis.fetch = function (url, init) {',
  '  recorded = { url : String(url), method : init.method, headers : init.headers, body : init.body };',
  '  return Promise.resolve({ status : 200, text : function () { return Promise.resolve("{}"); } });',
  '};',
  'var config = require(repoRoot + "/node_modules/config");',
  'if (process.env.PARITY_UNDEFINE) {',
  '  process.env.PARITY_UNDEFINE.split(",").forEach(function (key) {',
  '    delete config.app.auth.google[key];',
  '  });',
  '}',
  'var auth = require(repoRoot + "/lib/controllers/auth.js");',
  'var request = { query : { code : process.env.PARITY_CODE } };',
  'var h = { reject : function (json) { return json; } };',
  'auth.googleCallback(request, h).then(function (answer) {',
  '  process.stdout.write(JSON.stringify({',
  '    google   : config.app.auth.google,',
  '    recorded : recorded,',
  '    answer   : answer',
  '  }));',
  '});'
].join('\n');

/**
 * Runs the handler once in a fresh process under a given Google configuration.
 *
 * @param {Object} googleConfig The `app.auth.google` values to inject through NODE_CONFIG.
 * @param {Array.<string>} [undefineKeys] `app.auth.google` keys to delete before the handler runs.
 * @returns {{google: Object, recorded: Object, answer: Object}} The child's parsed report.
 */
function recordTokenExchange(googleConfig, undefineKeys) {
  var env = Object.assign({}, process.env, {
    NODE_ENV                     : 'test',
    NODE_CONFIG_PERSIST_ON_CHANGE : 'N',
    NODE_CONFIG                  : JSON.stringify({ app : { auth : { google : googleConfig } } }),
    PARITY_REPO_ROOT             : REPO_ROOT,
    PARITY_CODE                  : CODE
  });

  if (undefineKeys) {
    env.PARITY_UNDEFINE = undefineKeys.join(',');
  }
  else {
    delete env.PARITY_UNDEFINE;
  }

  var child = spawnSync(process.execPath, ['-e', CHILD_SOURCE], {
    cwd      : REPO_ROOT,
    env      : env,
    timeout  : CHILD_TIMEOUT_MS,
    encoding : 'utf8'
  });

  expect(child.status, 'the child must exit cleanly; stderr was: ' + (child.stderr || '')).to.equal(0);

  return JSON.parse(child.stdout);
}

describe('Google OAuth token-exchange form encoding', function() {

  it('sends every field with its value under full configuration', function() {
    this.timeout(CHILD_TIMEOUT_MS + 5000);

    var report = recordTokenExchange({
      clientID     : 'full-client-id',
      clientSecret : 'full-client-secret',
      callbackURL  : 'http://localhost:30003/auth/google/callback'
    });

    expect(report.recorded.url).to.equal('https://oauth2.googleapis.com/token');
    expect(report.recorded.method).to.equal('POST');
    // The bare media type, with no ;charset=UTF-8 - which is what a URLSearchParams body would add.
    expect(report.recorded.headers['content-type']).to.equal('application/x-www-form-urlencoded');
    expect(report.recorded.headers.accept).to.equal('application/json');
    expect(report.recorded.body).to.equal(
      'code=code%20with%20space%2Bplus' +
      '&client_id=full-client-id' +
      '&client_secret=full-client-secret' +
      '&redirect_uri=http%3A%2F%2Flocalhost%3A30003%2Fauth%2Fgoogle%2Fcallback' +
      '&grant_type=authorization_code'
    );
  });

  it('sends a bare key= for a null field, never the string "null", under partial configuration',
    function() {
      this.timeout(CHILD_TIMEOUT_MS + 5000);

      // Only clientID is injected, so clientSecret and callbackURL keep the values
      // config/default.yaml declares for them - which node-config resolves to null. This is the
      // application's shipped state.
      var report = recordTokenExchange({ clientID : 'partial-client-id' });

      expect(report.google.clientSecret, 'the finding turns on this being null, not undefined')
        .to.equal(null);
      expect(report.google.callbackURL).to.equal(null);

      expect(report.recorded.body).to.equal(
        'code=code%20with%20space%2Bplus' +
        '&client_id=partial-client-id' +
        '&client_secret=' +
        '&redirect_uri=' +
        '&grant_type=authorization_code'
      );
      expect(report.recorded.body, 'encodeURIComponent(null) is the four-character string "null"')
        .to.not.contain('null');
    });

  it('omits a field whose value is undefined', function() {
    this.timeout(CHILD_TIMEOUT_MS + 5000);

    var report = recordTokenExchange({ clientID : 'partial-client-id' }, ['clientSecret', 'callbackURL']);

    expect(report.google).to.not.have.property('clientSecret');
    expect(report.google).to.not.have.property('callbackURL');

    expect(report.recorded.body).to.equal(
      'code=code%20with%20space%2Bplus' +
      '&client_id=partial-client-id' +
      '&grant_type=authorization_code'
    );
  });

  it('still answers the normalized provider failure once the token payload carries no access_token',
    function() {
      this.timeout(CHILD_TIMEOUT_MS + 5000);

      var report = recordTokenExchange({ clientID : 'partial-client-id' });

      // The failure mapping this path has always produced, unchanged by the encoding repair: the
      // failure responder's payload, which the route turns into its declared redirect.
      expect(report.answer).to.deep.equal({ message: 'Authentication failed. Please try again.' });
    });
});
