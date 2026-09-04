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
 *   3. idempotence  a stamp that matches the pinned archive AND an installed
 *                   tree that still matches the manifest recorded with it
 *                   short-circuit the run before any network access at all
 *   4. no litter    work paths left by an interrupted earlier run are swept
 *                   before that short-circuit is even considered, and a
 *                   survivor ends the run non-zero rather than quietly
 *
 * Exit codes:
 *   0        bundle published, or already present and verified (no-op)
 *   1        environment or artifact-layout problem, or an unexpected failure
 *   2        download failed: transport error, timeout, or non-2xx HTTP status
 *   3        SHA-256 mismatch -- nothing was extracted
 *   4        extraction failed
 *   5        publish failed -- public/components/ was left untouched
 *   6        the work this script owns was done, but a temporary path it
 *            created could not be removed and is still in the repository
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

// The stamp carries a digest of the extracted tree as well as of the archive
// (see computeTreeManifest), and this string names the format that digest was
// produced by. It is compared exactly before the fast path is taken, so any
// future change to the manifest's entry set, field order or separators must
// come with a new value here: the alternative is a silent digest mismatch that
// reads to a caller as a corrupted bundle rather than as a format change.
var TREE_MANIFEST_ALGORITHM = 'sha256-tree-v1';

// Files are hashed through one reusable buffer of this size rather than read
// whole, so peak memory stays at a megabyte no matter how large a single
// member is -- this release ships a 22 MB member, and nothing should depend on
// that staying the biggest.
var MANIFEST_CHUNK_BYTES = 1024 * 1024;

// Working paths, all inside the repository tree. Inside, for two independent
// reasons: rename(2) is only atomic within a single filesystem, and a staging
// directory under os.tmpdir() is very likely a different filesystem inside a
// container (rename would fail with EXDEV); and the script must not write
// outside the repository, since the Docker build runs it as an unprivileged
// user. They carry the pid and a distinctive prefix so that a leftover is
// immediately recognisable as a bug in this script -- .gitignore is not in
// scope and is deliberately not touched, so cleanup is instead confirmed on
// the filesystem and a path that survives it ends the run non-zero (see
// cleanupWorkspace and main).
var WORK_PREFIX = '.fetch-components';
var DOWNLOAD_PATH = path.join(REPO_ROOT, WORK_PREFIX + '-download-' + process.pid + '.tgz');
var STAGING_PATH = path.join(REPO_ROOT, WORK_PREFIX + '-staging-' + process.pid);

var EXIT_OK = 0;
var EXIT_ENVIRONMENT = 1;
var EXIT_DOWNLOAD = 2;
var EXIT_DIGEST = 3;
var EXIT_EXTRACT = 4;
var EXIT_PUBLISH = 5;
var EXIT_CLEANUP = 6;
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
 * Name what is actually at a path, for messages and for the layout checks.
 *
 * lstat, not stat, and that is the entire point of having it alongside
 * isDirectory(): a symbolic link pointing at some other directory answers
 * "symbolic link" here, where stat() would happily report a swapped link as a
 * perfectly good directory and a verification built on it would pass.
 */
function describePathType(target) {
  var stats;

  try {
    stats = fs.lstatSync(target);
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'ENOTDIR') {
      return 'missing';
    }
    throw failure(EXIT_ENVIRONMENT, 'could not inspect ' + target + ': ' + err.message);
  }

  if (stats.isDirectory()) {
    return 'directory';
  }
  if (stats.isSymbolicLink()) {
    return 'symbolic link';
  }
  if (stats.isFile()) {
    return 'file';
  }
  return 'special file';
}

/**
 * Remove a file or directory tree, reporting rather than throwing, and return
 * whether the path is gone.
 *
 * It still does not throw, because a failure to tidy up must never mask the
 * real error a caller is already handling -- but it no longer ends the story
 * there. rmSync stops at the first child it cannot unlink (a read-only parent
 * directory, an immutable file, a busy mount), so the answer is taken from the
 * filesystem afterwards rather than from the absence of an exception, and it is
 * taken with lstat so a dangling symbolic link counts as present.
 */
function removeQuietly(target) {
  try {
    fs.rmSync(target, { recursive: true, force: true });
  } catch (err) {
    console.error('fetch-components: could not remove ' + target + ': ' + err.message);
  }

  try {
    return describePathType(target) === 'missing';
  } catch (err) {
    // Cleanup must not throw -- it runs from the signal handler too -- so a
    // path that cannot even be inspected counts as still there, which is the
    // conservative answer and the one that gets it reported.
    console.error('fetch-components: could not confirm ' + target + ' is gone: ' + err.message);
    return false;
  }
}

/**
 * Remove the downloaded archive and the staging tree, and return the ones that
 * are still there. Synchronous on purpose: it has to be usable from a signal
 * handler as well as from the outcome logic in main().
 *
 * Both paths are created by this script, inside the repository, and named after
 * its own pid -- so anything still here afterwards is this script's litter in
 * somebody's checkout, and main() is what decides that this is not a success.
 */
function cleanupWorkspace() {
  var surviving = [];

  [DOWNLOAD_PATH, STAGING_PATH].forEach(function (target) {
    if (!removeQuietly(target)) {
      surviving.push(target);
    }
  });

  return surviving;
}

/**
 * One stderr block naming every script-owned path that is still in the
 * repository, with the one instruction that resolves it. Each path on its own
 * line, because the names carry a pid and run together unreadably otherwise.
 */
function describeSurvivors(surviving) {
  return 'these paths were created by this script and could not be removed:\n' +
    surviving.map(function (target) {
      return '    ' + path.relative(REPO_ROOT, target);
    }).join('\n') +
    '\n  Remove them by hand before building; they are inside the repository.';
}

// ---------------------------------------------------------------------------
// Work paths left by EARLIER runs.
//
// The paths above carry this process's pid, so cleaning them up only ever
// settles the run that is happening now. A run that was killed between
// creating a workspace and removing it -- SIGKILL, a lost container, a build
// agent that went away -- leaves a `.fetch-components-*` path behind under
// somebody else's pid, and nothing in a later run would look at it: the
// verified fast path returns before any cleanup at all, so the script would
// report "nothing to do", exit 0, and leave a partial download or a
// several-hundred-megabyte replaced bundle sitting in the repository
// indefinitely. That is the same silent-litter outcome as an unremovable path
// in the current run, reached by a different route, so it gets the same
// verdict: swept before anything else is decided, and non-zero if a survivor
// remains.
//
// The shapes are recognised rather than guessed at, and the pid in the name is
// what makes the sweep safe: a path belonging to a process that is still
// running is another run's workspace, and deleting it would corrupt that run,
// so it is reported and left exactly where it is.
// ---------------------------------------------------------------------------

var WORK_PATH_SHAPES = [
  { pattern: /^\.fetch-components-download-(\d+)\.tgz$/, what: 'a partial download' },
  { pattern: /^\.fetch-components-staging-(\d+)$/, what: 'an extraction workspace' },
  { pattern: /^\.fetch-components-old-(\d+)-/, what: 'a replaced bundle' }
];

/**
 * Whether a pid parsed out of a work path belongs to a process that is still
 * running, in which case the path is in use and must not be touched.
 *
 * Two tests, because the cheap one is ambiguous in exactly the environment
 * this script runs in most often. `/proc/<pid>/cmdline` is read first where it
 * exists: inside a container this script is pid 1, so a leftover named `-1`
 * copied out of one (through a bind mount, say) would otherwise look like a
 * live init process on the host and block every later build. Requiring the
 * command line to name this script removes that whole class of false
 * positive. Where /proc is absent -- macOS -- it falls back to signal 0, whose
 * EPERM means "exists but is not ours", and a pid that has since been reused
 * is then reported rather than deleted. Conservative in the direction that
 * cannot destroy another run's work.
 */
function isWorkPathInUse(pid) {
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) {
    return false;
  }

  try {
    var commandLine = fs.readFileSync('/proc/' + pid + '/cmdline', 'utf8');
    return commandLine.indexOf('fetch-components') !== -1;
  } catch (err) {
    if (err.code !== 'ENOENT' && err.code !== 'ENOTDIR' && err.code !== 'EACCES') {
      throw failure(EXIT_ENVIRONMENT, 'could not inspect process ' + pid + ': ' + err.message);
    }
    if (err.code === 'EACCES') {
      // The process exists and belongs to another user; that is enough.
      return true;
    }
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

/**
 * Every `.fetch-components-*` work path in the two directories this script
 * writes to, excluding the ones belonging to this run.
 *
 * Only names beginning with `WORK_PREFIX + '-'` are considered, which is what
 * keeps the published stamp -- `.fetch-components.json`, a dot where these
 * have a hyphen -- out of the sweep. A name that starts with the prefix but
 * matches none of the known shapes still counts: it is this script's litter by
 * construction, and since no pid can be read from it there is no run to
 * protect.
 */
function findEarlierWorkPaths() {
  var directories = [REPO_ROOT];

  DESTINATIONS.forEach(function (destination) {
    var parent = path.dirname(path.join(REPO_ROOT, destination));
    if (directories.indexOf(parent) === -1) {
      directories.push(parent);
    }
  });

  var found = [];

  directories.forEach(function (directory) {
    var names;

    try {
      names = fs.readdirSync(directory);
    } catch (err) {
      if (err.code === 'ENOENT' || err.code === 'ENOTDIR') {
        return;
      }
      throw failure(EXIT_ENVIRONMENT, 'could not read ' + directory + ': ' + err.message);
    }

    names.forEach(function (name) {
      if (name.indexOf(WORK_PREFIX + '-') !== 0) {
        return;
      }

      var target = path.join(directory, name);
      if (target === DOWNLOAD_PATH || target === STAGING_PATH) {
        // This run's own paths. cleanupWorkspace() owns them.
        return;
      }

      var pid = null;
      var what = 'a work path';

      WORK_PATH_SHAPES.some(function (shape) {
        var match = shape.pattern.exec(name);
        if (match === null) {
          return false;
        }
        pid = Number(match[1]);
        what = shape.what;
        return true;
      });

      found.push({ target: target, pid: pid, what: what });
    });
  });

  return found;
}

/**
 * Remove the work paths earlier runs abandoned, and return the ones still
 * there afterwards -- whether because removal failed or because another run is
 * using them.
 */
function sweepEarlierWorkPaths() {
  var surviving = [];

  findEarlierWorkPaths().forEach(function (entry) {
    var relative = path.relative(REPO_ROOT, entry.target);
    var owner = entry.pid === null ? '' : ' (process ' + entry.pid + ')';

    if (isWorkPathInUse(entry.pid)) {
      console.error('fetch-components: ' + relative + ' is ' + entry.what +
        ' belonging to process ' + entry.pid + ', which is still running; leaving it untouched.');
      surviving.push(entry.target);
      return;
    }

    console.log('fetch-components: removing ' + relative + ' -- ' + entry.what +
      ' left behind by an earlier run' + owner + '.');

    if (!removeQuietly(entry.target)) {
      surviving.push(entry.target);
    }
  });

  return surviving;
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
      var surviving = cleanupWorkspace();

      // Written synchronously, and the process ended immediately afterwards: an
      // in-flight download or extraction has to stop here, so there is no
      // opportunity for an asynchronous stderr write to be flushed first.
      //
      // The exit code stays the signal's -- a caller reading it wants to know
      // it interrupted the run, not how tidy the exit was -- but the message
      // has to say what is left, because the human who pressed Ctrl-C is
      // watching this line and nothing else will tell them.
      if (surviving.length === 0) {
        fs.writeSync(2, 'fetch-components: interrupted by ' + signal.name +
          '; temporary files removed.\n');
      } else {
        fs.writeSync(2, 'fetch-components: interrupted by ' + signal.name + '; ' +
          describeSurvivors(surviving) + '\n');
      }

      process.exit(signal.code);
    });
  });
}

// ---------------------------------------------------------------------------
// The extracted-tree manifest.
//
// The archive digest proves what was downloaded; on a repeat run it proves
// nothing about what is still on disk. Between two runs a component file can be
// deleted, truncated, edited, or replaced by a symbolic link pointing somewhere
// else entirely, and the stamp beside it stays valid -- so a stamp-only fast
// path trusts that tree and hands it straight to `npm run build` and into the
// image, with nothing having looked at a single installed byte.
//
// So a successful publish records a manifest of what it published, and a repeat
// run recomputes that manifest over the installed tree and compares digests.
// Both sides walk the same relative paths with the same code, so the comparison
// is of content, not of the walker.
//
// Full content hashing, not a stat-only check on size and mtime: an in-place
// edit that preserves the byte count is precisely the tampering a stat check
// cannot see, and mtime is not preserved across a `cp -a`-style copy of a
// checkout or a container layer in any way worth relying on. Measured on this
// release -- 6722 files, 435 MB -- the whole check costs about half a second
// with the page cache warm, against the ~166 MB download it avoids, and each
// run reports its own figure so the cost is never a guess. That is the right
// trade for a build step, and it is why the fast path stays worth taking.
// ---------------------------------------------------------------------------

/**
 * Hash one file in fixed-size chunks through a caller-supplied buffer.
 *
 * Synchronous like everything around it -- the layout assertion, the stamp
 * writer, the signal handler's cleanup -- because 6722 promises buy nothing
 * here, and chunked rather than readFileSync so that memory does not scale with
 * the largest member of the bundle.
 */
function hashFileContents(absolute, buffer) {
  var hash = crypto.createHash('sha256');
  var descriptor = fs.openSync(absolute, 'r');

  try {
    for (;;) {
      var read = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (read === 0) {
        break;
      }
      hash.update(buffer.subarray(0, read));
    }
  } finally {
    fs.closeSync(descriptor);
  }

  return hash.digest('hex');
}

/**
 * Convert a platform path to the manifest's own separator, so a manifest
 * recorded on one platform compares byte-for-byte with one recomputed on
 * another. The archive's own member names use '/', which settles the choice.
 */
function toManifestPath(relative) {
  return relative.split(path.sep).join('/');
}

/**
 * Collect one directory's entries into `records`, recursing depth-first.
 *
 * lstatSync throughout: a symbolic link is recorded as a link with its target,
 * never followed. Following one would both hide a swapped link -- the tree
 * would hash as whatever it points at -- and risk walking out of the repository
 * or around a cycle.
 *
 * An entry that vanishes mid-walk (ENOENT, or ENOTDIR because a parent was
 * replaced under us) is simply left out of the manifest. The verdict that
 * follows is then a mismatch, which is the correct one: the tree is being
 * modified while it is being verified, so it is not the tree that was recorded.
 */
function collectTreeEntries(rootDirectory, relativeDirectory, excludedPath, buffer, records) {
  var names;

  try {
    names = fs.readdirSync(path.join(rootDirectory, relativeDirectory));
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'ENOTDIR') {
      return;
    }
    throw failure(EXIT_ENVIRONMENT, 'could not read ' +
      path.join(rootDirectory, relativeDirectory) + ': ' + err.message);
  }

  names.forEach(function (name) {
    var relative = path.join(relativeDirectory, name);
    var absolute = path.join(rootDirectory, relative);
    var manifestPath = toManifestPath(relative);

    // The one exclusion, and it has to be exactly one: the stamp holds the
    // digest of this manifest, so a manifest that covered the stamp could
    // never be reproduced. Everything else the archive placed under a
    // destination is covered.
    if (manifestPath === excludedPath) {
      return;
    }

    var stats;
    try {
      stats = fs.lstatSync(absolute);
    } catch (err) {
      if (err.code === 'ENOENT' || err.code === 'ENOTDIR') {
        return;
      }
      throw failure(EXIT_ENVIRONMENT, 'could not inspect ' + absolute + ': ' + err.message);
    }

    if (stats.isDirectory()) {
      records.push({ path: manifestPath, line: 'directory\u0000' + manifestPath });
      collectTreeEntries(rootDirectory, relative, excludedPath, buffer, records);
      return;
    }

    if (stats.isSymbolicLink()) {
      var target;
      try {
        target = fs.readlinkSync(absolute);
      } catch (err) {
        if (err.code === 'ENOENT') {
          return;
        }
        throw failure(EXIT_ENVIRONMENT, 'could not read the link ' + absolute + ': ' + err.message);
      }
      records.push({
        path: manifestPath,
        symlink: true,
        line: 'symlink\u0000' + manifestPath + '\u0000' + toManifestPath(target)
      });
      return;
    }

    if (!stats.isFile()) {
      // A socket, fifo or device node cannot be hashed without blocking, and
      // this archive contains none. Recording the type alone still makes one
      // appearing a mismatch rather than an invisible addition.
      records.push({ path: manifestPath, line: 'special\u0000' + manifestPath });
      return;
    }

    var digest;
    try {
      digest = hashFileContents(absolute, buffer);
    } catch (err) {
      if (err.code === 'ENOENT' || err.code === 'ENOTDIR') {
        return;
      }
      throw failure(EXIT_ENVIRONMENT, 'could not read ' + absolute + ': ' + err.message);
    }

    records.push({
      path: manifestPath,
      file: true,
      bytes: stats.size,
      line: 'file\u0000' + manifestPath + '\u0000' + stats.size + '\u0000' + digest
    });
  });
}

/**
 * Reduce a tree to one digest plus the cheap counts that make a mismatch
 * reportable in specific terms.
 *
 * Determinism comes from two decisions. Entries are sorted by their manifest
 * path as raw bytes -- readdir order is a filesystem detail, and a locale-aware
 * comparison would make the digest depend on the environment. And the fields
 * within a line are separated by NUL, which is the one byte a POSIX path cannot
 * contain, so no member name can forge a field or line boundary.
 *
 * `rootDirectory` is the staging tree at publish time and the repository root
 * on the verification path; DESTINATIONS are walked in declaration order and
 * the relative paths are identical either side of the publishing rename, which
 * is what makes the two digests comparable at all.
 */
function computeTreeManifest(rootDirectory) {
  var buffer = Buffer.allocUnsafe(MANIFEST_CHUNK_BYTES);
  var excludedPath = toManifestPath(path.join(PRIMARY_DESTINATION, STAMP_NAME));
  var records = [];

  DESTINATIONS.forEach(function (destination) {
    records.push({
      path: toManifestPath(destination),
      line: 'directory\u0000' + toManifestPath(destination)
    });
    collectTreeEntries(rootDirectory, destination, excludedPath, buffer, records);
  });

  records.sort(function (left, right) {
    return Buffer.compare(Buffer.from(left.path, 'utf8'), Buffer.from(right.path, 'utf8'));
  });

  var hash = crypto.createHash('sha256');
  var files = 0;
  var symlinks = 0;
  var bytes = 0;

  records.forEach(function (record) {
    hash.update(record.line + '\n');
    if (record.file) {
      files += 1;
      bytes += record.bytes;
    } else if (record.symlink) {
      symlinks += 1;
    }
  });

  return {
    algorithm: TREE_MANIFEST_ALGORITHM,
    digest: hash.digest('hex'),
    entries: records.length,
    files: files,
    directories: records.length - files - symlinks,
    symlinks: symlinks,
    bytes: bytes
  };
}

/**
 * Say what changed, in the most specific terms the recorded counts support.
 *
 * The counts exist for this message alone: "3 files missing" or "total size
 * differs" tells a reader whether they are looking at a half-deleted tree or at
 * edited content, where a bare digest mismatch tells them nothing. When the
 * counts and the total size all agree the difference is in file content or in a
 * path, and the message says so rather than guessing which.
 */
function describeTreeDifference(recorded, actual) {
  var differences = [];

  [
    { singular: 'file', plural: 'files', recorded: recorded.files, actual: actual.files },
    {
      singular: 'directory',
      plural: 'directories',
      recorded: recorded.directories,
      actual: actual.directories
    },
    {
      singular: 'symbolic link',
      plural: 'symbolic links',
      recorded: recorded.symlinks,
      actual: actual.symlinks
    }
  ].forEach(function (count) {
    if (typeof count.recorded !== 'number' || count.recorded === count.actual) {
      return;
    }

    var difference = Math.abs(count.recorded - count.actual);
    var noun = difference === 1 ? count.singular : count.plural;

    if (count.actual < count.recorded) {
      differences.push(difference + ' ' + noun + ' missing');
    } else {
      differences.push(difference + ' unrecorded ' + noun + ' present');
    }
  });

  if (typeof recorded.bytes === 'number' && recorded.bytes !== actual.bytes) {
    differences.push('total size differs (recorded ' + recorded.bytes + ' bytes, found ' +
      actual.bytes + ')');
  }

  if (differences.length === 0) {
    return 'content differs (' + actual.files + ' files, ' + actual.directories +
      ' directories and ' + actual.bytes + ' bytes as recorded, but the content or a path changed)';
  }

  return differences.join('; ');
}

/**
 * Check the installed tree against the manifest the stamp recorded, returning
 * null when it matches and otherwise the reason it does not.
 *
 * A reason, not an exception: a tree that fails to verify is handled exactly as
 * a stamp that records the wrong archive has always been handled -- log what is
 * wrong and re-fetch -- rather than through a new failure mode that would stop
 * a build a download can fix. An I/O error of a different kind, an unreadable
 * file or a permission problem, does still throw from the walk below: that is
 * not a stale bundle and re-downloading it would not help.
 *
 * The layout check comes first and is the installed-side counterpart of
 * assertStagedLayout: public/components can be a regular file or a symbolic
 * link to somewhere else, and a stamp read through it would still parse.
 */
function verifyPublishedTree(recorded) {
  if (recorded === null || typeof recorded !== 'object') {
    return 'it records no tree manifest';
  }

  if (recorded.algorithm !== TREE_MANIFEST_ALGORITHM) {
    return 'it records tree manifest format "' + String(recorded.algorithm) + '", not "' +
      TREE_MANIFEST_ALGORITHM + '"';
  }

  if (typeof recorded.digest !== 'string' || recorded.digest === '') {
    return 'its tree manifest records no digest';
  }

  var layoutProblem = null;
  DESTINATIONS.forEach(function (destination) {
    if (layoutProblem !== null) {
      return;
    }
    var type = describePathType(path.join(REPO_ROOT, destination));
    if (type !== 'directory') {
      layoutProblem = '"' + destination + '" is ' +
        (type === 'missing' ? 'missing' : 'a ' + type + ', not a directory');
    }
  });
  if (layoutProblem !== null) {
    return layoutProblem;
  }

  var startedAt = Date.now();
  var actual = computeTreeManifest(REPO_ROOT);

  if (actual.digest !== recorded.digest.toLowerCase()) {
    return describeTreeDifference(recorded, actual);
  }

  // Logged rather than silent, because this is the one cost the fast path adds
  // and a reader watching a slow build is owed the number.
  console.log('fetch-components: verified ' + actual.files + ' files and ' + actual.directories +
    ' directories (' + actual.bytes + ' bytes) against the recorded tree manifest in ' +
    (Date.now() - startedAt) + ' ms');

  return null;
}

/**
 * The stamp written by the last successful run, or null when the destination is
 * absent, carries no stamp, or carries one that cannot be read or records no
 * archive digest.
 *
 * A public/components/ that exists without a usable stamp -- left by the old
 * inline `curl | tar`, or by a bower checkout -- is unverifiable, so it
 * deliberately counts as "does not match": fetching and replacing it is the
 * safe outcome.
 */
function readPublishedStamp() {
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
      return {
        sha256: stamp.sha256.toLowerCase(),
        // Absent on a stamp written before the tree manifest existed, which
        // verifyPublishedTree treats as unverifiable -- the same verdict a
        // stamp without a sha256 gets here.
        tree: stamp.tree === undefined ? null : stamp.tree
      };
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
 * True when the bundle already on disk is the one this script pins AND the
 * files themselves still match what was published, in which case the caller
 * returns success without touching the network.
 *
 * Both halves are required. The archive digest answers "which release is this
 * meant to be"; the tree manifest answers "is that what is actually here". On
 * the first alone, a deleted, truncated, edited or symlink-swapped component
 * tree with an intact stamp beside it is trusted on every repeat run, and flows
 * from there into the CSS build and into the image.
 */
function isAlreadyPublished() {
  var stamp = readPublishedStamp();

  if (stamp === null) {
    // A missing destination is the ordinary first run and says nothing worth
    // printing. Anything else present under that name is worth naming, because
    // a regular file or a link there is why the stamp could not be read.
    var type = describePathType(path.join(REPO_ROOT, PRIMARY_DESTINATION));
    if (type === 'directory') {
      console.log('fetch-components: ' + PRIMARY_DESTINATION +
        ' exists but carries no verified stamp; replacing it.');
    } else if (type !== 'missing') {
      console.log('fetch-components: ' + PRIMARY_DESTINATION + ' is a ' + type +
        ', not a directory; replacing it.');
    }
    return false;
  }

  if (stamp.sha256 !== EXPECTED_SHA256.toLowerCase()) {
    console.log('fetch-components: ' + PRIMARY_DESTINATION + ' holds a different archive (sha256 ' +
      stamp.sha256 + '); replacing it.');
    return false;
  }

  var treeProblem = verifyPublishedTree(stamp.tree);
  if (treeProblem !== null) {
    console.log('fetch-components: ' + PRIMARY_DESTINATION +
      ' does not match the tree manifest in ' + STAMP_NAME + ' -- ' + treeProblem +
      '; replacing it.');
    return false;
  }

  return true;
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
 *
 * The manifest is taken over the STAGED tree, which is the last moment the
 * published content is known-good: it came out of an archive whose digest was
 * verified and it has passed assertStagedLayout, and the walk happens before
 * this function writes the stamp into it. The stamp path is excluded from the
 * manifest in any case, so the digest recorded here is the one a later run
 * recomputes over the installed tree.
 */
function writeStamp() {
  var tree = computeTreeManifest(STAGING_PATH);
  var stamp = {
    url: ARCHIVE_URL,
    sha256: EXPECTED_SHA256.toLowerCase(),
    version: RELEASE_TAG,
    fetchedAt: new Date().toISOString(),
    tree: tree
  };

  fs.writeFileSync(
    path.join(STAGING_PATH, PRIMARY_DESTINATION, STAMP_NAME),
    JSON.stringify(stamp, null, 2) + '\n'
  );

  console.log('fetch-components: recorded a tree manifest of ' + tree.files + ' files and ' +
    tree.directories + ' directories (' + tree.bytes + ' bytes)');
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
 *
 * Returns the set-aside trees that phase C could not remove. They hold the
 * previous bundle, so leaving one behind loses nothing -- but it leaves a
 * multi-hundred-megabyte `.fetch-components-old-*` directory in a checkout, and
 * the caller is what turns that into a non-zero exit rather than a log line
 * nobody reads.
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

  var surviving = [];
  asides.forEach(function (entry) {
    if (!removeQuietly(entry.aside)) {
      surviving.push(entry.aside);
    }
  });

  return surviving;
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

  // Nothing is decided before the repository is clear of this script's own
  // litter, and that ordering is the point: the verified fast path below
  // returns success without touching anything, so a sweep placed after it
  // would let a run report "nothing to do", exit 0, and leave an earlier run's
  // partial download or replaced bundle in the tree for good.
  //
  // Two sources, one verdict. Paths from earlier runs are recognised by name
  // and removed unless the pid they carry is still running; paths from this
  // run's own pid mean a hard-killed predecessor whose pid has since been
  // reused. A survivor from either is fatal here rather than reported at the
  // end, and it is fatal before any network access: the archive would
  // otherwise be extracted INTO a staging directory that already holds someone
  // else's content, and a foreign public/components/ inside it would satisfy
  // assertStagedLayout and be published as if it had come out of the verified
  // archive. Refusing costs a 166 MB download that would have been unsafe.
  var leftovers = sweepEarlierWorkPaths().concat(cleanupWorkspace());
  if (leftovers.length > 0) {
    throw failure(EXIT_ENVIRONMENT, 'work from another run of this script is in the way and ' +
      describeSurvivors(leftovers) + '\n' +
      '  If a message above says one of them belongs to a running process, wait for that\n' +
      '  run to finish instead. Nothing was downloaded: extracting into a staging tree\n' +
      '  that already has content in it could publish files this script never verified.');
  }

  if (isAlreadyPublished()) {
    console.log('fetch-components: ' + PRIMARY_DESTINATION + ' is already at ' + RELEASE_TAG +
      ' and verified; nothing to do.');
    return EXIT_OK;
  }

  // The outcome is computed rather than returned from a `finally`, and that is
  // load-bearing: a `return` or a `throw` inside a finally block replaces
  // whatever the body was already reporting, which is precisely how a cleanup
  // failure would come to mask a download or publish error. So the body's
  // error is captured, cleanup runs unconditionally, and then one place decides
  // -- the primary error always wins, and cleanup can only add to its message.
  var primaryError = null;
  var surviving = [];

  try {
    var download = await downloadArchive();
    console.log('fetch-components: downloaded ' + download.bytes + ' bytes');

    verifyDigest(download.digest);

    fs.mkdirSync(STAGING_PATH, { recursive: true });
    await extractArchive();
    assertStagedLayout();
    writeStamp();
    surviving = publishDestinations();

    console.log('fetch-components: published ' + DESTINATIONS.join(', ') + ' from ' + RELEASE_TAG);
  } catch (err) {
    primaryError = err;
  }

  surviving = surviving.concat(cleanupWorkspace());

  if (primaryError !== null) {
    if (surviving.length > 0) {
      primaryError.message += '\n  Additionally, ' + describeSurvivors(surviving);
    }
    throw primaryError;
  }

  if (surviving.length > 0) {
    // The bundle is published and correct, so this is not a publish failure --
    // but the run is not a success either, because it ends with this script's
    // own temporary paths sitting in the repository, and a build that reads
    // exit codes must not be told everything is fine.
    throw failure(EXIT_CLEANUP, 'the bundle was published from ' + RELEASE_TAG + ', but ' +
      describeSurvivors(surviving));
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
