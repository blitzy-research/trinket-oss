#!/usr/bin/env node
/**
 * Fetch the frontend component bundle into public/components/
 * Usage: node scripts/fetch-components.js      (or: npm run fetch-components)
 *
 * public/components/ is gitignored, exactly like node_modules: the bundle is a
 * large external artifact that is downloaded, never committed. Every SCSS entry
 * point under static/scss/ imports from it, so `npm run build` cannot succeed
 * until this script has run. The Dockerfile runs it at image build time too --
 * before `npm ci` -- which is why this script uses Node built-ins ONLY and must
 * never require anything out of node_modules.
 *
 * It replaces the unverified inline `curl -L ... && tar xzf ... && rm ...` that
 * used to live in the Dockerfile. Same release tag, same archive, same
 * repo-root-relative layout -- the same bytes in the same place -- plus the
 * three things build tooling of this kind owes its callers:
 *
 *   1. integrity    the SHA-256 below is checked BEFORE anything is extracted,
 *                   and a failing archive is deleted unopened
 *   2. atomicity    the tree is staged inside the repository and then moved
 *                   into place with rename(2), so public/components/ is only
 *                   ever absent or complete, never half-populated
 *   3. idempotence  a matching stamp file short-circuits the run before any
 *                   network access happens at all
 *
 * Exit codes:
 *   0        bundle published, or already present and verified (no-op)
 *   1        environment or artifact-layout problem, or an unexpected failure
 *   2        download failed: transport error, timeout, or non-2xx HTTP status
 *   3        SHA-256 mismatch -- nothing was extracted
 *   4        extraction failed
 *   5        publish failed -- public/components/ was left untouched
 *   130/143  interrupted by SIGINT / SIGTERM, after removing temporary files
 */

'use strict';

var childProcess = require('node:child_process');
var crypto = require('node:crypto');
var fs = require('node:fs');
var path = require('node:path');
var stream = require('node:stream');
var streamPromises = require('node:stream/promises');

// ---------------------------------------------------------------------------
// The pinned artifact. This file is the authoritative home of both values;
// COMPONENTS.md mirrors them for human readers. The URL is character-for-
// character the one the Dockerfile fetched inline.
//
// Moving the release tag changes the bytes, so the digest has to be recomputed
// (`sha256sum public-components.tgz`) in the same edit, and the component
// versions listed in COMPONENTS.md updated with it. The two must never drift.
// ---------------------------------------------------------------------------
var ARCHIVE_URL = 'https://github.com/trinketapp/trinket-oss/releases/download/v1.1.0/public-components.tgz';
var EXPECTED_SHA256 = '58422c0d0c7d25c1e6fdd1e014ff690f41c899257703e416e85a0fb0a926181f';
var RELEASE_TAG = 'v1.1.0';

// A hung download must not hang a Docker build forever, but the bound has to be
// generous enough that it never turns a healthy-but-slow network into a build
// failure: the archive is ~166 MB, which this allowance covers down to roughly
// 95 KB/s. The inline curl it replaces had no timeout at all.
var DOWNLOAD_TIMEOUT_MS = 30 * 60 * 1000;

// Resolved from __dirname rather than process.cwd() so that both invocation
// forms (`node scripts/fetch-components.js` and `npm run fetch-components`)
// behave identically from any working directory. It is also what mechanically
// guarantees that every path this script writes to is inside the repository.
var REPO_ROOT = path.resolve(__dirname, '..');

// The single repo-relative directory this archive populates, and the one the
// SCSS imports and .gitignore:4 both name.
//
// This is asserted at runtime (assertStagedLayout) rather than inferred from
// the shape of the staged tree, and that is a safety property, not a style
// choice: the archive is rooted at `public/`, so a "publish whatever the top
// level holds" rule would rename the staged `public` directory over the
// repository's own public/ -- css, js, partials, img, fonts -- and destroy
// tracked content. The member list was measured with `tar tzf`: its complete
// set is `public/`, `public/components/**`, and one macOS AppleDouble sibling
// (see isPackagingMetadata). There is no `public/vendor` in this release.
var PRIMARY_DESTINATION = path.join('public', 'components');
var DESTINATIONS = [PRIMARY_DESTINATION];

// Written inside the published tree, so it is covered by .gitignore:4 and can
// never be committed by accident.
var STAMP_NAME = '.fetch-components.json';

// Working paths, all inside the repository tree. Inside, for two independent
// reasons: rename(2) is only atomic within a single filesystem, and a staging
// directory under os.tmpdir() is very likely a different filesystem inside a
// container (rename would fail with EXDEV); and the script must not write
// outside the repository, since the Docker build runs it as an unprivileged
// user. They carry the pid and a distinctive prefix so that a leftover is
// immediately recognisable as a bug in this script -- .gitignore is not in
// scope and is deliberately not touched, so cleanup is guaranteed instead.
var WORK_PREFIX = '.fetch-components';
var DOWNLOAD_PATH = path.join(REPO_ROOT, WORK_PREFIX + '-download-' + process.pid + '.tgz');
var STAGING_PATH = path.join(REPO_ROOT, WORK_PREFIX + '-staging-' + process.pid);

var EXIT_OK = 0;
var EXIT_ENVIRONMENT = 1;
var EXIT_DOWNLOAD = 2;
var EXIT_DIGEST = 3;
var EXIT_EXTRACT = 4;
var EXIT_PUBLISH = 5;
var EXIT_SIGINT = 130;
var EXIT_SIGTERM = 143;

// The `tar` child, while one is running, so a signal handler can stop it before
// removing the directory it is writing into.
var activeChild = null;

/**
 * Build an error carrying the exit code the process should end with. Errors
 * without an `exitCode` are unexpected and reported with their stack.
 */
function failure(exitCode, message) {
  var err = new Error(message);
  err.exitCode = exitCode;
  return err;
}

/**
 * Node's fetch reports transport problems as a bare "fetch failed" and keeps
 * the real errno on `cause`; without the cause the message is not actionable.
 */
function describeError(err) {
  if (!err) {
    return 'unknown error';
  }
  var message = err.message || String(err);
  if (err.cause && err.cause.message) {
    message += ' (' + err.cause.message + ')';
  }
  return message;
}

/**
 * Render DOWNLOAD_TIMEOUT_MS for a human. Minutes are the natural unit at the
 * value above, but the timeout is stated in milliseconds, so this stays correct
 * if that constant is ever lowered rather than reporting "0 minutes".
 */
function describeTimeout() {
  if (DOWNLOAD_TIMEOUT_MS >= 60000) {
    return Math.round(DOWNLOAD_TIMEOUT_MS / 60000) + ' minutes';
  }
  return Math.max(1, Math.round(DOWNLOAD_TIMEOUT_MS / 1000)) + ' seconds';
}

function isDirectory(target) {
  try {
    return fs.statSync(target).isDirectory();
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'ENOTDIR') {
      return false;
    }
    throw err;
  }
}

/**
 * Remove a file or directory tree, reporting rather than throwing. Used from
 * cleanup paths, where a failure to tidy up must not mask the real error.
 */
function removeQuietly(target) {
  try {
    fs.rmSync(target, { recursive: true, force: true });
  } catch (err) {
    console.error('fetch-components: could not remove ' + target + ': ' + err.message);
  }
}

/**
 * Remove the downloaded archive and the staging tree. Synchronous on purpose:
 * it has to be usable from a signal handler as well as from a finally block.
 */
function cleanupWorkspace() {
  removeQuietly(DOWNLOAD_PATH);
  removeQuietly(STAGING_PATH);
}

/**
 * macOS archive tooling leaks AppleDouble resource-fork siblings ("._name") and
 * .DS_Store entries into tarballs, and this release carries one: a 268-byte
 * `public/._components` holding extended-attribute metadata for the components
 * directory. The archive is extracted whole -- no member filter, no
 * --strip-components -- but only real component destinations are published:
 * that file is referenced by no template, asset URL or persisted record, and it
 * is not covered by .gitignore, so publishing it would leave an untracked junk
 * file in every checkout for good. Everything under public/components/** is
 * published byte-identical to what `tar xzf` produced before.
 */
function isPackagingMetadata(name) {
  return name === '.DS_Store' || name.indexOf('._') === 0;
}

/**
 * Stop the extraction child and remove temporary files, then exit. Publishing
 * is a rename(2), so at any point a signal can arrive the destination is either
 * untouched or already complete -- there is no half-populated state to repair.
 */
function installSignalHandlers() {
  [
    { name: 'SIGINT', code: EXIT_SIGINT },
    { name: 'SIGTERM', code: EXIT_SIGTERM }
  ].forEach(function (signal) {
    process.on(signal.name, function () {
      // SIGKILL, not SIGTERM: a killed process runs no further user code, so
      // nothing can write into the staging directory after the removal below
      // has started.
      if (activeChild !== null && activeChild.exitCode === null) {
        try {
          activeChild.kill('SIGKILL');
        } catch (err) {
          console.error('fetch-components: could not stop tar: ' + err.message);
        }
      }
      cleanupWorkspace();

      // Written synchronously, and the process ended immediately afterwards: an
      // in-flight download or extraction has to stop here, so there is no
      // opportunity for an asynchronous stderr write to be flushed first.
      fs.writeSync(2, 'fetch-components: interrupted by ' + signal.name +
        '; temporary files removed.\n');
      process.exit(signal.code);
    });
  });
}

/**
 * The SHA-256 recorded by the last successful run, or null when the destination
 * is absent, carries no stamp, or carries one that cannot be read.
 *
 * A public/components/ that exists without a stamp -- left by the old inline
 * `curl | tar`, or by a bower checkout -- is unverifiable, so it deliberately
 * counts as "does not match": fetching and replacing it is the safe outcome.
 */
function readPublishedDigest() {
  var stampPath = path.join(REPO_ROOT, PRIMARY_DESTINATION, STAMP_NAME);
  var raw;

  try {
    raw = fs.readFileSync(stampPath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'ENOTDIR') {
      return null;
    }
    throw failure(EXIT_ENVIRONMENT, 'could not read ' + stampPath + ': ' + err.message);
  }

  try {
    var stamp = JSON.parse(raw);
    if (stamp && typeof stamp.sha256 === 'string') {
      return stamp.sha256.toLowerCase();
    }
    console.log('fetch-components: ' + STAMP_NAME + ' records no sha256; re-fetching.');
    return null;
  } catch (err) {
    console.log('fetch-components: ' + STAMP_NAME + ' is not readable JSON (' + err.message +
      '); re-fetching.');
    return null;
  }
}

/**
 * True when the bundle already on disk is the one this script pins, in which
 * case the caller returns success without touching the network.
 */
function isAlreadyPublished() {
  var publishedDigest = readPublishedDigest();

  if (publishedDigest === EXPECTED_SHA256.toLowerCase()) {
    return true;
  }

  if (publishedDigest !== null) {
    console.log('fetch-components: ' + PRIMARY_DESTINATION + ' holds a different archive (sha256 ' +
      publishedDigest + '); replacing it.');
  } else if (isDirectory(path.join(REPO_ROOT, PRIMARY_DESTINATION))) {
    console.log('fetch-components: ' + PRIMARY_DESTINATION +
      ' exists but carries no verified stamp; replacing it.');
  }

  return false;
}

/**
 * Download the archive to DOWNLOAD_PATH, hashing it as it streams past.
 * Resolves with the byte count and the lowercase hex SHA-256 of what landed on
 * disk, so verification happens on the actual bytes rather than on the ones the
 * server said it would send.
 */
async function downloadArchive() {
  console.log('fetch-components: downloading ' + ARCHIVE_URL);

  var response;
  try {
    response = await fetch(ARCHIVE_URL, {
      // A GitHub release asset URL answers 302 and points at an object store.
      // This is the `-L` in the `curl -L` this script replaces; without it the
      // redirect body would be saved and the digest would fail for entirely
      // the wrong reason. It is fetch's default, stated here because it is
      // load-bearing.
      redirect: 'follow',
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS)
    });
  } catch (err) {
    if (err && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      throw failure(EXIT_DOWNLOAD, 'the download did not finish within ' + describeTimeout() +
        '; nothing was extracted.\n  ' + ARCHIVE_URL);
    }
    throw failure(EXIT_DOWNLOAD, 'could not reach ' + ARCHIVE_URL + ': ' + describeError(err) + '\n' +
      '  Check network access and any proxy configuration, then run this again.');
  }

  // The inline curl this replaces used --silent without -f, so a 404 body was
  // happily written to disk and only failed later, at tar. Fail here instead,
  // naming the status: the digest check would also catch it, but "HTTP 404" is
  // an actionable message and "sha256 mismatch" on an HTML error page is not.
  if (!response.ok) {
    throw failure(EXIT_DOWNLOAD, 'HTTP ' + response.status + ' ' + response.statusText +
      ' for ' + ARCHIVE_URL + '\n' +
      '  The release asset may have been moved, renamed or unpublished. Nothing was extracted.');
  }

  if (response.body === null) {
    throw failure(EXIT_DOWNLOAD, 'the server returned no response body for ' + ARCHIVE_URL);
  }

  var hash = crypto.createHash('sha256');
  var byteCount = 0;
  var hashingTap = new stream.Transform({
    transform: function (chunk, encoding, callback) {
      hash.update(chunk);
      byteCount += chunk.length;
      callback(null, chunk);
    }
  });

  try {
    await streamPromises.pipeline(
      stream.Readable.fromWeb(response.body),
      hashingTap,
      fs.createWriteStream(DOWNLOAD_PATH)
    );
  } catch (err) {
    if (err && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      throw failure(EXIT_DOWNLOAD, 'the download stalled and was abandoned after ' +
        describeTimeout() + '; nothing was extracted.');
    }
    throw failure(EXIT_DOWNLOAD, 'the download failed after ' + byteCount + ' bytes: ' +
      describeError(err));
  }

  return { bytes: byteCount, digest: hash.digest('hex') };
}

/**
 * The security-critical step, and the reason this script exists: the archive is
 * only ever opened once its digest matches. On a mismatch the bytes are removed
 * by the caller's cleanup and nothing at all is extracted.
 */
function verifyDigest(actualDigest) {
  if (actualDigest !== EXPECTED_SHA256.toLowerCase()) {
    throw failure(EXIT_DIGEST, 'SHA-256 mismatch -- NOTHING was extracted.\n' +
      '  expected: ' + EXPECTED_SHA256.toLowerCase() + '\n' +
      '  actual:   ' + actualDigest + '\n' +
      '  The download may be corrupt or truncated, or the release asset may have been\n' +
      '  replaced. If the archive changed on purpose, update EXPECTED_SHA256 in\n' +
      '  scripts/fetch-components.js and COMPONENTS.md together.');
  }

  console.log('fetch-components: sha256 verified (' + EXPECTED_SHA256.toLowerCase() + ')');
}

/**
 * Extract the whole archive into the staging directory.
 *
 * The system tar is used deliberately: it adds no external requirement, because
 * the Dockerfile step this replaces already depended on it, and it is present
 * in the node:22 images and on any developer host. No member filter and no
 * --strip-components -- `tar xzf` semantics exactly. Nine SCSS files consume
 * this bundle across two import targets, four of them importing the entire
 * foundation tree, so extracting a subset would break the CSS build in ways a
 * smoke test would not notice.
 */
function extractArchive() {
  console.log('fetch-components: extracting into ' + path.relative(REPO_ROOT, STAGING_PATH));

  return new Promise(function (resolve, reject) {
    var child = childProcess.spawn('tar', ['-x', '-z', '-f', DOWNLOAD_PATH, '-C', STAGING_PATH], {
      cwd: REPO_ROOT,
      stdio: ['ignore', 'ignore', 'pipe']
    });
    activeChild = child;

    var stderrChunks = [];
    child.stderr.on('data', function (chunk) {
      stderrChunks.push(chunk);
    });

    child.on('error', function (err) {
      activeChild = null;
      if (err.code === 'ENOENT') {
        reject(failure(EXIT_ENVIRONMENT, '`tar` was not found on PATH.\n' +
          '  This script extracts the component bundle with the system tar, as the Docker\n' +
          '  build step it replaces did. Install tar (Debian/Ubuntu: `apt-get install tar`)\n' +
          '  and run this again.'));
        return;
      }
      reject(failure(EXIT_EXTRACT, 'could not run `tar`: ' + err.message));
    });

    child.on('close', function (code, signal) {
      activeChild = null;

      if (code === 0) {
        resolve();
        return;
      }

      // tar's own stderr is surfaced only when it fails. On success it can
      // carry harmless notices -- this archive was built on macOS, so GNU tar
      // reports "Ignoring unknown extended header keyword
      // 'LIBARCHIVE.xattr.com.apple.provenance'" and still exits 0. Silencing
      // that with --warning=no-unknown-keyword is not an option, because the
      // flag is GNU-only and the BSD tar on macOS hosts rejects it.
      var detail = Buffer.concat(stderrChunks).toString('utf8').trim();
      reject(failure(EXIT_EXTRACT, 'tar ' +
        (signal !== null ? 'was terminated by ' + signal : 'exited with status ' + code) +
        '; nothing was published.' + (detail !== '' ? '\n  ' + detail.split('\n').join('\n  ') : '')));
    });
  });
}

/**
 * Confirm the extracted tree is the layout this script knows how to publish,
 * and refuse to guess when it is not.
 *
 * Every directory on the way to a destination is checked, and every entry the
 * archive placed alongside one is either a known destination, a known container
 * on the way to one, or packaging metadata. Anything else stops the run with a
 * message naming what appeared, because publishing an unrecognised path -- or
 * quietly dropping it -- would be worse than failing. Since the digest above
 * pins the bytes, reaching this failure means the pinned artifact itself was
 * changed without updating DESTINATIONS.
 */
function assertStagedLayout() {
  var expected = Object.create(null);

  DESTINATIONS.forEach(function (destination) {
    expected[destination] = 'destination';

    var container = path.dirname(destination);
    while (container !== '.' && container !== path.sep) {
      if (expected[container] === undefined) {
        expected[container] = 'container';
      }
      container = path.dirname(container);
    }
  });

  Object.keys(expected).forEach(function (relative) {
    if (!isDirectory(path.join(STAGING_PATH, relative))) {
      throw failure(EXIT_ENVIRONMENT, 'the archive does not contain the directory "' + relative + '".\n' +
        '  ' + ARCHIVE_URL + '\n' +
        '  The pinned artifact\'s layout has changed; nothing was published.');
    }
  });

  var containers = ['.'].concat(Object.keys(expected).filter(function (relative) {
    return expected[relative] === 'container';
  }));

  containers.forEach(function (container) {
    fs.readdirSync(path.join(STAGING_PATH, container)).forEach(function (name) {
      if (isPackagingMetadata(name)) {
        return;
      }

      var relative = container === '.' ? name : path.join(container, name);
      if (expected[relative] === undefined) {
        throw failure(EXIT_ENVIRONMENT, 'the archive contains "' + relative +
          '", which this script does not publish.\n' +
          '  Add it to DESTINATIONS in scripts/fetch-components.js if it is now required;\n' +
          '  nothing was published.');
      }
    });
  });
}

/**
 * Record what was published, inside the staged tree so that the content and its
 * stamp become visible in the same rename(2). A stamp written after publishing
 * could be lost to a crash in between, leaving a perfectly good tree that the
 * next run would needlessly re-download.
 */
function writeStamp() {
  var stamp = {
    url: ARCHIVE_URL,
    sha256: EXPECTED_SHA256.toLowerCase(),
    version: RELEASE_TAG,
    fetchedAt: new Date().toISOString()
  };

  fs.writeFileSync(
    path.join(STAGING_PATH, PRIMARY_DESTINATION, STAMP_NAME),
    JSON.stringify(stamp, null, 2) + '\n'
  );
}

/**
 * rename(2) with an error message a reader can act on.
 */
function renameOrFail(from, to, what) {
  try {
    fs.renameSync(from, to);
  } catch (err) {
    // Both paths are named, because a rename can fail in either the set-aside
    // step or the move-into-place step and the useful one differs between them.
    var hint = '\n  while renaming ' + from + '\n  to ' + to;

    if (err.code === 'EXDEV') {
      hint += '\n  Those two paths are on different filesystems, so the tree cannot be moved\n' +
        '  into place atomically. This happens when a container mounts a volume inside\n' +
        '  public/.';
    } else if (err.code === 'EBUSY' || err.code === 'EINVAL' || err.code === 'ENOTEMPTY') {
      hint += '\n  One of those paths is an active mount point. docker-compose mounts a named\n' +
        '  volume at public/components, so run this during the image build or on the host\n' +
        '  rather than through `docker-compose exec`.';
    }

    throw failure(EXIT_PUBLISH, 'could not move ' + what + ' into place: ' +
      (err.code ? err.code + ' ' : '') + err.message + hint);
  }
}

/**
 * Move the staged destinations into the repository, atomically.
 *
 * Three phases, so that a failure at any point leaves every destination exactly
 * as it was rather than half-replaced:
 *
 *   A  move an existing destination aside -- POSIX rename(2) will not replace a
 *      non-empty directory, so it cannot simply be renamed over
 *   B  rename each staged tree into place; on failure, undo B and then A
 *   C  only once every destination is published, remove the set-aside trees
 */
function publishDestinations() {
  var asides = [];
  var published = [];

  try {
    DESTINATIONS.forEach(function (destination) {
      var target = path.join(REPO_ROOT, destination);
      if (!fs.existsSync(target)) {
        return;
      }

      var aside = path.join(
        path.dirname(target),
        WORK_PREFIX + '-old-' + process.pid + '-' + path.basename(target)
      );
      renameOrFail(target, aside, destination);
      asides.push({ target: target, aside: aside });
    });

    DESTINATIONS.forEach(function (destination) {
      var staged = path.join(STAGING_PATH, destination);
      var target = path.join(REPO_ROOT, destination);

      fs.mkdirSync(path.dirname(target), { recursive: true });
      renameOrFail(staged, target, destination);
      published.push({ staged: staged, target: target });
    });
  } catch (err) {
    // The reassurance is folded into the error rather than logged separately,
    // so that one stderr block reads in order: what failed, then what state
    // the destinations were left in.
    if (rollbackPublish(published, asides)) {
      err.message += '\n  Every destination was left exactly as it was.';
    }
    throw err;
  }

  asides.forEach(function (entry) {
    removeQuietly(entry.aside);
  });
}

/**
 * Undo a partial publish: return each published tree to staging, then restore
 * every set-aside tree. Failures here are reported rather than thrown, so that
 * the original error is still what the caller sees, and a destination that
 * could not be restored is called out on its own line, because that is the one
 * case a human has to resolve by hand.
 *
 * Returns true when every destination ended up exactly as it started.
 */
function rollbackPublish(published, asides) {
  var incomplete = false;

  published.slice().reverse().forEach(function (entry) {
    try {
      fs.renameSync(entry.target, entry.staged);
    } catch (err) {
      incomplete = true;
      console.error('fetch-components: could not roll back ' + entry.target + ': ' + err.message);
    }
  });

  asides.slice().reverse().forEach(function (entry) {
    try {
      fs.renameSync(entry.aside, entry.target);
    } catch (err) {
      incomplete = true;
      console.error('fetch-components: could not restore ' + entry.target + ' from ' +
        entry.aside + ': ' + err.message);
      console.error('fetch-components: restore it by hand before building.');
    }
  });

  return !incomplete;
}

async function main() {
  installSignalHandlers();

  if (isAlreadyPublished()) {
    console.log('fetch-components: ' + PRIMARY_DESTINATION + ' is already at ' + RELEASE_TAG +
      ' and verified; nothing to do.');
    return EXIT_OK;
  }

  // Guard against a leftover from an earlier run that was killed hard enough to
  // skip its own cleanup and whose pid has since been reused.
  cleanupWorkspace();

  try {
    var download = await downloadArchive();
    console.log('fetch-components: downloaded ' + download.bytes + ' bytes');

    verifyDigest(download.digest);

    fs.mkdirSync(STAGING_PATH, { recursive: true });
    await extractArchive();
    assertStagedLayout();
    writeStamp();
    publishDestinations();

    console.log('fetch-components: published ' + DESTINATIONS.join(', ') + ' from ' + RELEASE_TAG);
  } finally {
    cleanupWorkspace();
  }

  return EXIT_OK;
}

// process.exitCode rather than process.exit(): stdout and stderr are
// asynchronous when they are pipes, and process.exit() would discard whatever
// has not been written yet -- including the digest-mismatch report, which is
// the one message a caller most needs to read. Nothing else holds the event
// loop open by this point, so the process ends as soon as its output is
// flushed. The signal handlers above are the deliberate exception.
main().then(function (exitCode) {
  process.exitCode = exitCode;
}).catch(function (err) {
  if (err && typeof err.exitCode === 'number') {
    console.error('fetch-components: ' + err.message);
    process.exitCode = err.exitCode;
    return;
  }

  console.error('fetch-components: unexpected failure: ' + describeError(err));
  if (err && err.stack) {
    console.error(err.stack);
  }
  process.exitCode = EXIT_ENVIRONMENT;
});

