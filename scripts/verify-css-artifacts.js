#!/usr/bin/env node
/**
 * Verify the two compiled stylesheets against the committed asset contract.
 * Usage: node scripts/verify-css-artifacts.js   (runs automatically as `npm run build`'s post hook)
 *
 * WHAT IT GATES AND WHY (review finding P3-2)
 * -------------------------------------------
 * AAP 0.7.4 pins the build output byte for byte: `public/css/base.css` at 265,727 bytes,
 * `public/css/embed.css` at 296,352, and ZERO `.css.map` files despite `vite.config.mjs` requesting
 * source maps. `sass` 1.98.0 and `vite` 4.5.14 are held at exactly those versions, and
 * `static/scss/**` is frozen, precisely so the Foundation 5.5.3 fork keeps compiling to those bytes.
 * A stylesheet that changed would be a client-visible change to every page, and a new `.css.map`
 * would be a new asset URL - both of which the asset-URL contract (TR5) forbids.
 *
 * The Docker image build has enforced this since the container work landed; the HOST build had no
 * gate at all, so `npm run build` on a developer machine could emit different CSS and say nothing.
 * This script is that gate, and it is the ONLY implementation of it: `package.json` runs it as the
 * `postbuild` hook and the `Dockerfile` gets it through the same `npm run build`, so the image and
 * the host cannot drift apart. Two copies of a gate is how a gate rots.
 *
 * EXPECTATIONS ARE READ, NEVER RESTATED. Every value comes from
 * `test/baseline/responses.json#buildArtifacts`, which is the R-6 parity evidence the replay harness
 * compares against. Hard-coding the digests here would create a second source of truth that could
 * agree with a changed build while the evidence disagreed.
 *
 * EXIT CODES
 *   0  every artifact matches the committed contract
 *   1  drift, an absent artifact, or an unreadable/incomplete contract - each named on stderr
 */

var crypto = require('crypto');
var fs = require('fs');
var path = require('path');

var REPO_ROOT = path.resolve(__dirname, '..');
var CONTRACT_PATH = path.join(REPO_ROOT, 'test', 'baseline', 'responses.json');
var CSS_DIR = path.join(REPO_ROOT, 'public', 'css');

/** The two artifacts the build emits, in the order the contract lists them. */
var ARTIFACTS = ['public/css/base.css', 'public/css/embed.css'];

function log(message) {
  console.log('[verify-css-artifacts]', message);
}

function fail(message) {
  console.error('[verify-css-artifacts] ' + message);
}

/** Every `.map` file under public/css, recursively, as repository-relative paths. */
function mapFilesUnderCss() {
  if (!fs.existsSync(CSS_DIR)) {
    return null;
  }

  var found = [];

  (function walk(directory) {
    fs.readdirSync(directory, { withFileTypes: true }).forEach(function(entry) {
      var absolute = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        return walk(absolute);
      }

      if (entry.isFile() && path.extname(entry.name) === '.map') {
        found.push(path.relative(REPO_ROOT, absolute).split(path.sep).join('/'));
      }

      return undefined;
    });
  })(CSS_DIR);

  return found.sort();
}

function verify() {
  var contract;

  try {
    contract = JSON.parse(fs.readFileSync(CONTRACT_PATH, 'utf8')).buildArtifacts;
  } catch (err) {
    fail('cannot read the asset contract at test/baseline/responses.json (' + err.message + ')');

    return 1;
  }

  if (!contract) {
    fail('test/baseline/responses.json carries no buildArtifacts block, so there is no contract to ' +
      'verify against');

    return 1;
  }

  var drift = 0;

  ARTIFACTS.forEach(function(relative) {
    var expected = contract[relative];
    var absolute = path.join(REPO_ROOT, relative);

    if (!expected || typeof expected.bytes !== 'number' || typeof expected.sha256 !== 'string') {
      fail('the contract records no bytes/sha256 for ' + relative);
      drift += 1;

      return;
    }

    if (!fs.existsSync(absolute)) {
      fail(relative + ' was not emitted. ' + (contract.precondition ||
        'Hydrate public/components, then run `npm run build`.'));
      drift += 1;

      return;
    }

    var bytes = fs.readFileSync(absolute);
    var digest = crypto.createHash('sha256').update(bytes).digest('hex');

    if (bytes.length !== expected.bytes || digest !== expected.sha256) {
      fail('asset drift: ' + relative + ' is ' + bytes.length + ' bytes sha256 ' + digest +
        ', expected ' + expected.bytes + ' bytes sha256 ' + expected.sha256);
      drift += 1;

      return;
    }

    log('verified ' + relative + ': ' + bytes.length + ' bytes, sha256 ' + digest);
  });

  // The source-map half of the contract. vite.config.mjs sets `sourcemap: true` and the build has
  // always emitted none; a `.css.map` appearing is a NEW asset URL, so it is drift rather than a
  // harmless extra. An absent public/css is already reported per artifact above.
  var maps = mapFilesUnderCss();

  if (maps !== null && typeof contract.cssMapFilesEmitted === 'number') {
    if (maps.length !== contract.cssMapFilesEmitted) {
      fail('asset drift: public/css holds ' + maps.length + ' .map file(s) (' + maps.join(', ') +
        '), expected ' + contract.cssMapFilesEmitted);
      drift += 1;
    } else {
      log('verified public/css .map files: ' + maps.length);
    }
  }

  if (drift) {
    fail(drift + ' artifact(s) do not match test/baseline/responses.json#buildArtifacts. `sass` and ' +
      '`vite` are held at their exact versions and static/scss/** is frozen so that this build stays ' +
      'byte-identical; a difference here is a client-visible asset change (AAP TR5) and must be ' +
      'reported, not re-baselined.');

    return 1;
  }

  log('the compiled stylesheets match the committed asset contract exactly');

  return 0;
}

process.exit(verify());
