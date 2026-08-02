#!/usr/bin/env node
/**
 * Hydrate the gitignored public/components tree that the stylesheet build imports.
 * Usage: node scripts/hydrate-components.js
 *
 * `npm run build` runs this first, which is what makes the required clean chain
 * `git clean -xfd && npm ci && npm run build` succeed. `static/scss/base.scss` and
 * `static/scss/embed/embed.scss` both `@import "public/components/foundation/scss/foundation"`,
 * and `public/components` is gitignored, so without this step Sass aborts the build with
 * `Can't find stylesheet to import.` on any freshly cleaned checkout.
 *
 * The tree is distributed as `public-components.tgz`, the asset attached to the pinned v1.1.0
 * GitHub release - the same archive the Docker image build downloads. Determinism is enforced
 * three ways: the release tag is pinned, and the bytes are checked against both a recorded
 * length and a recorded SHA-256 digest before anything is unpacked. Set
 * TRINKET_COMPONENTS_TARBALL to a local copy of the archive to hydrate without network access;
 * both checks still apply to it.
 *
 * The step is idempotent: when the tree is already present it exits 0 without touching the
 * network or the filesystem, so re-running `npm run build` costs nothing.
 */

var childProcess = require('child_process');
var crypto = require('crypto');
var fs = require('fs');
var os = require('os');
var path = require('path');
var stream = require('stream');

// Pinned release asset. The tag, the byte length and the digest are all recorded here so that a
// re-cut release, a proxy error page or a truncated download fails loudly instead of silently
// producing different stylesheets.
var RELEASE_TAG = 'v1.1.0';
var TARBALL_NAME = 'public-components.tgz';
var TARBALL_URL = 'https://github.com/trinketapp/trinket-oss/releases/download/' +
  RELEASE_TAG + '/' + TARBALL_NAME;
var TARBALL_BYTES = 166464007;
var TARBALL_SHA256 = '58422c0d0c7d25c1e6fdd1e014ff690f41c899257703e416e85a0fb0a926181f';

var REPO_ROOT = path.resolve(__dirname, '..');

// The exact file both SCSS entry points resolve through their Foundation import. Probing for it
// rather than for the directory means a half-extracted tree counts as missing rather than as
// already hydrated.
var SENTINEL = path.join(REPO_ROOT, 'public', 'components', 'foundation', 'scss', 'foundation.scss');

// The archive was packed on macOS and carries an AppleDouble sidecar next to `public/components`.
// It is inert, but it is not part of the component tree, so it is removed after extraction.
var APPLE_DOUBLE = path.join(REPO_ROOT, 'public', '._components');

function log(message) {
  console.log('[hydrate-components]', message);
}

function sha256OfFile(filePath) {
  return new Promise(function (resolve, reject) {
    var hash = crypto.createHash('sha256');
    var input = fs.createReadStream(filePath);

    input.on('error', reject);
    input.on('data', function (chunk) {
      hash.update(chunk);
    });
    input.on('end', function () {
      resolve(hash.digest('hex'));
    });
  });
}

async function download(url, destination) {
  log('downloading ' + url);

  var response = await fetch(url);
  if (!response.ok) {
    throw new Error('download failed with HTTP ' + response.status + ' ' + response.statusText);
  }

  var body = stream.Readable.fromWeb(response.body);
  await stream.promises.pipeline(body, fs.createWriteStream(destination));
}

async function verify(filePath) {
  var size = fs.statSync(filePath).size;
  if (size !== TARBALL_BYTES) {
    throw new Error('expected ' + TARBALL_BYTES + ' bytes but read ' + size +
      ' - this is not the pinned ' + RELEASE_TAG + ' asset');
  }

  var digest = await sha256OfFile(filePath);
  if (digest !== TARBALL_SHA256) {
    throw new Error('expected sha256 ' + TARBALL_SHA256 + ' but computed ' + digest +
      ' - this is not the pinned ' + RELEASE_TAG + ' asset');
  }

  log('verified ' + size + ' bytes, sha256 ' + digest);
}

function extract(filePath) {
  log('unpacking into ' + REPO_ROOT);

  // The archive is rooted at `public/`, so it unpacks straight over the repository root.
  childProcess.execFileSync('tar', ['xzf', filePath, '-C', REPO_ROOT], { stdio: 'inherit' });

  if (fs.existsSync(APPLE_DOUBLE)) {
    fs.rmSync(APPLE_DOUBLE, { force: true });
  }
}

async function hydrate() {
  if (fs.existsSync(SENTINEL)) {
    log('public/components is already present - nothing to do');
    return;
  }

  var localArchive = process.env.TRINKET_COMPONENTS_TARBALL;

  if (localArchive) {
    localArchive = path.resolve(localArchive);
    if (!fs.existsSync(localArchive)) {
      throw new Error('TRINKET_COMPONENTS_TARBALL points at ' + localArchive + ', which does not exist');
    }

    log('using the local archive ' + localArchive);
    await verify(localArchive);
    extract(localArchive);
  } else {
    // Download into a private scratch directory so a failed or interrupted fetch can never be
    // mistaken for a good archive on the next run, and so nothing is left inside the repository.
    var scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'trinket-components-'));
    var downloaded = path.join(scratch, TARBALL_NAME);

    try {
      await download(TARBALL_URL, downloaded);
      await verify(downloaded);
      extract(downloaded);
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  }

  if (!fs.existsSync(SENTINEL)) {
    throw new Error('the archive unpacked but ' + path.relative(REPO_ROOT, SENTINEL) + ' is still missing');
  }

  log('hydrated public/components from the ' + RELEASE_TAG + ' release asset');
}

hydrate().catch(function (err) {
  console.error('[hydrate-components] ' + err.message);
  console.error('[hydrate-components] COMPONENTS.md documents the equivalent manual fetch and the ' +
    'TRINKET_COMPONENTS_TARBALL offline alternative');
  process.exit(1);
});
