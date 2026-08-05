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
 * on both the input and the result: the release tag is pinned, the archive bytes are checked
 * against a recorded length and a recorded SHA-256 before anything is unpacked, and the
 * extracted tree is checked against a recorded fingerprint of the ONLY subtree the build
 * imports. Set TRINKET_COMPONENTS_TARBALL to a local copy of the archive to hydrate without
 * network access; every check still applies to it.
 *
 * WHY A COMPLETION MARKER RATHER THAN A SENTINEL FILE (review finding P3-2)
 * ------------------------------------------------------------------------
 * An earlier revision probed for a single `foundation.scss` and returned successfully whenever
 * that one path existed. Three states therefore passed forever, each of them able to change the
 * compiled stylesheets silently:
 *   - an INTERRUPTED extraction that happened to have written that file already;
 *   - a LOCAL MODIFICATION of any imported partial;
 *   - a STALE tree unpacked from a different release than the one pinned here.
 * The fast path is now gated on an atomic completion marker - written only after the archive has
 * been verified AND unpacked AND the result checked, and written by rename so a half-written
 * marker cannot exist - together with a re-measured fingerprint of the imported subtree. Anything
 * that does not match is REHYDRATED rather than accepted.
 *
 * WHY THE CHECK REACHES BEYOND THE STYLESHEET IMPORTS (review finding F4)
 * ----------------------------------------------------------------------
 * An earlier revision gated the fast path on the imported SCSS subtree and three Foundation paths
 * alone, which covers every byte the stylesheet build can read - and nothing else. The same
 * gitignored tree also SERVES the browser: `lib/views/**`, `public/js/**` and `config/default.yaml`
 * reference assets under 31 of its top-level entries, from `skulpt` and `blockly` through
 * `glowscript`, `vexflow` and `src-min-noconflict`. Deleting any of them left the SCSS fingerprint
 * intact, so `inspect()` returned `skip`, `npm run build` no-opped the hydration and
 * scripts/verify-css-artifacts.js still passed - while those assets 404'd at runtime. The build was
 * green and the client was broken, which is the worst shape a gate can fail in.
 *
 * Coverage is therefore two-layered, and the layers catch different damage:
 *   - RUNTIME_ASSET_PATHS names one representative file inside every top-level entry the
 *     application actually references, so a partially deleted or partially extracted component
 *     directory is caught even though the directory itself still exists;
 *   - the TOP-LEVEL LISTING FINGERPRINT records the entry names and their types, so a whole
 *     top-level entry that was removed - or an extra one that does not belong to the pinned
 *     archive - is caught even when it holds no representative path.
 * Both are cheap: the first is 31 `existsSync` calls and the second is one `readdirSync`, so the
 * verified fast path still costs well under a millisecond and still touches neither the network nor
 * the filesystem beyond reading.
 *
 * The step is still idempotent and still costs nothing to re-run: a verified tree exits 0 without
 * touching the network or the filesystem. A tree that is provably the pinned one but carries no
 * marker - the state the documented manual `curl` procedure and the Docker image build both leave -
 * is ADOPTED by writing the marker, because its bytes already satisfy every check a rehydration
 * would perform and re-downloading 166 MB to learn that would be waste, not rigour.
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
var COMPONENTS_DIR = path.join(REPO_ROOT, 'public', 'components');

// THE IMPORTED SUBTREE. `static/scss/**` reaches public/components through exactly two imports -
// `foundation/scss/foundation` and `foundation/scss/foundation/functions` - so these 42 files are
// the whole of what determines public/css/base.css and public/css/embed.css. Fingerprinting them
// rather than the 435 MB tree keeps the check under a millisecond while covering every byte the
// build can read. The digest is over a sorted "<relative path> <bytes> <sha256>" manifest, one
// line per file, joined with "\n".
var IMPORTED_SUBTREE = path.join(COMPONENTS_DIR, 'foundation', 'scss');
var IMPORTED_SUBTREE_LABEL = 'public/components/foundation/scss';
var IMPORTED_SUBTREE_FILES = 42;
var IMPORTED_SUBTREE_SHA256 = 'ec35ad8225786c34be919640ca0504993540d1d7dd79e7f38a727b53f731273d';

// Paths that must exist for the tree to be usable at all. The two SCSS entries are what the build
// imports by name; the manifest is what identifies the fork and its version (foundation-sites
// 5.5.3). A missing one means the tree is partial, whatever else is present.
var REQUIRED_PATHS = [
  path.join('foundation', 'scss', 'foundation.scss'),
  path.join('foundation', 'scss', 'foundation', '_functions.scss'),
  path.join('foundation', 'package.json')
];

// THE SERVED SURFACE. One representative file per top-level entry that lib/views/**, public/js/**,
// public/partials/** or config/default.yaml actually requests over HTTP, censused from the tree
// rather than guessed. These are NOT read by the stylesheet build - they are read by the browser
// through the eight Inert directory routes lib/http/staticRoutes.js mounts - which is exactly why
// the SCSS fingerprint above cannot see them going missing. One file per entry is deliberate: the
// point is to detect a top-level entry that is present but hollow, not to re-checksum 435 MB.
var RUNTIME_ASSET_PATHS = [
  path.join('Mathjax-siunitx', 'siunitx.js'),
  path.join('Processing.js', 'processing.min.js'),
  'angular-notifyjs.js',
  'angular-scrollfix.js',
  'angular-slugify.js',
  path.join('blockly', 'blockly_compressed.js'),
  path.join('detectizr', 'dist', 'detectizr.min.js'),
  path.join('dist', 'lodash.min.js'),
  path.join('foundation', 'js', 'foundation.min.js'),
  path.join('glowscript', 'css', 'ide.css'),
  path.join('glowscript-blocks', 'blockly_uncompressed.js'),
  path.join('janus', '0.4.2', 'janus.js'),
  path.join('jq-console', 'jqconsole.min.js'),
  path.join('json.sk', '__init__.js'),
  path.join('marked', 'lib', 'marked.js'),
  path.join('midi', 'build', 'MIDI.js'),
  'ng-file-upload.min.js',
  path.join('noVNC-dist', 'lib', 'rfb.js'),
  path.join('processing.sk', 'processing-sk-min.js'),
  path.join('pygame.sk', 'pygame.js'),
  path.join('skulpt', 'skulpt-stdlib.js'),
  path.join('skulpt_matplotlib', 'matplotlib', '__init__.js'),
  path.join('skulpt_numpy', 'dist', 'numpy', '__init__.js'),
  path.join('src-min-noconflict', 'ace.js'),
  path.join('systemjs', 'dist', 'system.js'),
  path.join('traqball.js', 'src', 'traqball.js'),
  path.join('vexflow', 'vexflow-min.js'),
  path.join('viewerjs', 'index.html'),
  path.join('vpython-glowscript', 'lib', 'jquery', '2.1', 'jquery-ui.custom.min.js'),
  path.join('webrtc-adapter', 'release', 'adapter.js'),
  path.join('xml.sk', '__init__.js')
];

// THE TOP-LEVEL SHAPE. The pinned archive unpacks to exactly these 44 entries beside the marker.
// The digest is over a sorted "<name> <dir|file|other>" manifest, one line per entry, joined with
// "\n" - names and types only, because hashing their contents would mean hashing the whole 435 MB
// tree on every build. Recording the TYPE as well as the name is what makes a directory replaced by
// a same-named file a mismatch rather than a match.
var TOP_LEVEL_ENTRIES = 44;
var TOP_LEVEL_SHA256 = '417e60c6aced5295cad6be0ca77cc8d123a11a16066e3dffc3795eb3a090c9a8';

// The atomic completion marker. It lives INSIDE the hydrated tree so that `git clean -xfd`, which
// removes the tree, removes the claim about it in the same stroke - a marker that outlived its tree
// would be the exact defect this replaces. `MARKER_VERSION` is bumped whenever the checks below
// change, so a marker written by an older hydrator is treated as unverified rather than trusted.
// It is 2 because review finding F4 widened the checks to the served surface above; a version-1
// marker records a tree that was never measured against RUNTIME_ASSET_PATHS or the top-level shape.
var MARKER_NAME = '.hydrated.json';
var MARKER_PATH = path.join(COMPONENTS_DIR, MARKER_NAME);
var MARKER_VERSION = 2;

// The archive was packed on macOS and carries an AppleDouble sidecar next to `public/components`.
// It is inert, but it is not part of the component tree, so it is removed after extraction.
var APPLE_DOUBLE = path.join(REPO_ROOT, 'public', '._components');

function log(message) {
  console.log('[hydrate-components]', message);
}

function sha256OfFile(filePath) {
  return new Promise(function(resolve, reject) {
    var hash = crypto.createHash('sha256');
    var input = fs.createReadStream(filePath);

    input.on('error', reject);
    input.on('data', function(chunk) {
      hash.update(chunk);
    });
    input.on('end', function() {
      resolve(hash.digest('hex'));
    });
  });
}

/**
 * Measures the imported subtree: how many files it holds and the digest of its sorted manifest.
 *
 * @returns {Object} `{ present, files, sha256 }`. `present` is false when the directory is absent,
 *   in which case `files` is 0 and `sha256` is null.
 */
function measureImportedSubtree() {
  if (!fs.existsSync(IMPORTED_SUBTREE)) {
    return { present: false, files: 0, sha256: null };
  }

  var lines = [];

  (function walk(directory) {
    fs.readdirSync(directory, { withFileTypes: true }).forEach(function(entry) {
      var absolute = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        return walk(absolute);
      }

      if (!entry.isFile()) {
        // A symlink or a device node is not something the pinned archive contains, so it is
        // recorded by name and type rather than hashed - which makes its presence a mismatch.
        lines.push(path.relative(IMPORTED_SUBTREE, absolute).split(path.sep).join('/') +
          ' <not-a-regular-file>');

        return undefined;
      }

      var bytes = fs.readFileSync(absolute);

      lines.push(path.relative(IMPORTED_SUBTREE, absolute).split(path.sep).join('/') + ' ' +
        bytes.length + ' ' + crypto.createHash('sha256').update(bytes).digest('hex'));

      return undefined;
    });
  })(IMPORTED_SUBTREE);

  lines.sort();

  return {
    present: true,
    files: lines.length,
    sha256: crypto.createHash('sha256').update(lines.join('\n')).digest('hex')
  };
}

/**
 * Measures the top-level shape of the component tree: how many entries it holds beside the marker,
 * and the digest of their sorted "<name> <type>" manifest.
 *
 * The marker itself and any staging file left by an interrupted marker write are excluded, because
 * they are this script's own bookkeeping rather than part of the archive - including them would make
 * the fingerprint depend on whether the marker had been written yet.
 *
 * @returns {Object} `{ present, entries, sha256 }`. `present` is false when the directory is absent,
 *   in which case `entries` is 0 and `sha256` is null.
 */
function measureTopLevel() {
  if (!fs.existsSync(COMPONENTS_DIR)) {
    return { present: false, entries: 0, sha256: null };
  }

  var lines = fs.readdirSync(COMPONENTS_DIR, { withFileTypes: true }).filter(function(entry) {
    return entry.name !== MARKER_NAME && entry.name.indexOf(MARKER_NAME + '.staging-') !== 0;
  }).map(function(entry) {
    var type = entry.isDirectory() ? 'dir' : (entry.isFile() ? 'file' : 'other');

    return entry.name + ' ' + type;
  });

  lines.sort();

  return {
    present: true,
    entries: lines.length,
    sha256: crypto.createHash('sha256').update(lines.join('\n')).digest('hex')
  };
}

/** Every required path that is missing, as repository-relative strings. */
function missingRequiredPaths() {
  return REQUIRED_PATHS.filter(function(relative) {
    return !fs.existsSync(path.join(COMPONENTS_DIR, relative));
  }).map(function(relative) {
    return path.join('public', 'components', relative);
  });
}

/**
 * Every representative served asset that is missing, as repository-relative strings.
 *
 * Reported separately from missingRequiredPaths() so the log says which layer failed: a missing
 * REQUIRED_PATH breaks the stylesheet build, while a missing RUNTIME_ASSET_PATH breaks the browser.
 */
function missingRuntimeAssets() {
  return RUNTIME_ASSET_PATHS.filter(function(relative) {
    return !fs.existsSync(path.join(COMPONENTS_DIR, relative));
  }).map(function(relative) {
    return path.join('public', 'components', relative);
  });
}

/** Reads the completion marker, or null when it is absent or unreadable. */
function readMarker() {
  try {
    return JSON.parse(fs.readFileSync(MARKER_PATH, 'utf8'));
  } catch (err) {
    return null;
  }
}

/**
 * Writes the completion marker ATOMICALLY: staged beside its destination and renamed, because a
 * rename within a directory cannot be observed half-done. A marker is a claim that every check
 * passed, so a partially written one must be impossible rather than merely unlikely.
 *
 * @param {Object} subtree  A measureImportedSubtree() result.
 * @param {Object} topLevel A measureTopLevel() result.
 */
function writeMarker(subtree, topLevel) {
  var staged = MARKER_PATH + '.staging-' + process.pid;

  fs.writeFileSync(staged, JSON.stringify({
    markerVersion: MARKER_VERSION,
    releaseTag: RELEASE_TAG,
    tarballBytes: TARBALL_BYTES,
    tarballSha256: TARBALL_SHA256,
    importedSubtree: {
      path: IMPORTED_SUBTREE_LABEL,
      files: subtree.files,
      sha256: subtree.sha256
    },
    topLevel: {
      path: 'public/components',
      entries: topLevel.entries,
      sha256: topLevel.sha256
    },
    runtimeAssetsChecked: RUNTIME_ASSET_PATHS.length,
    hydratedAt: new Date().toISOString(),
    note: 'Written by scripts/hydrate-components.js only after the pinned archive was verified and ' +
      'the extracted tree re-measured. Delete this file to force a full re-verification.'
  }, null, 2) + '\n', { encoding: 'utf8' });

  fs.renameSync(staged, MARKER_PATH);
}

/**
 * Decides what this run has to do, and says why.
 *
 * @returns {Object} `{ action, reasons, subtree, topLevel }` where action is 'skip' (verified),
 *   'adopt' (the tree is provably the pinned one but unmarked or marked by an older hydrator) or
 *   'rehydrate'.
 */
function inspect() {
  var subtree = measureImportedSubtree();
  var topLevel = measureTopLevel();
  var missing = missingRequiredPaths();
  var missingRuntime = missingRuntimeAssets();
  var marker = readMarker();
  var reasons = [];

  if (!fs.existsSync(COMPONENTS_DIR)) {
    return {
      action: 'rehydrate',
      reasons: ['public/components does not exist'],
      subtree: subtree,
      topLevel: topLevel
    };
  }

  missing.forEach(function(relative) {
    reasons.push(relative + ' is missing, so the tree is partial');
  });

  // Reported after the build-critical paths but gated identically: an asset the browser requests is
  // as much a part of a complete tree as a partial the stylesheet imports (review finding F4).
  missingRuntime.forEach(function(relative) {
    reasons.push(relative + ' is missing, so a served component directory is incomplete');
  });

  if (!topLevel.present) {
    reasons.push('public/components cannot be listed');
  } else if (topLevel.entries !== TOP_LEVEL_ENTRIES) {
    reasons.push('public/components holds ' + topLevel.entries + ' top-level entries, not the ' +
      'pinned ' + TOP_LEVEL_ENTRIES);
  } else if (topLevel.sha256 !== TOP_LEVEL_SHA256) {
    reasons.push('the public/components top-level listing fingerprints to ' + topLevel.sha256 +
      ', not the pinned ' + TOP_LEVEL_SHA256 + ' - an entry was removed, renamed, replaced by a ' +
      'different type, or added');
  }

  if (!subtree.present) {
    reasons.push(IMPORTED_SUBTREE_LABEL + ' does not exist');
  } else if (subtree.files !== IMPORTED_SUBTREE_FILES) {
    reasons.push(IMPORTED_SUBTREE_LABEL + ' holds ' + subtree.files + ' files, not the pinned ' +
      IMPORTED_SUBTREE_FILES);
  } else if (subtree.sha256 !== IMPORTED_SUBTREE_SHA256) {
    reasons.push(IMPORTED_SUBTREE_LABEL + ' fingerprint is ' + subtree.sha256 + ', not the pinned ' +
      IMPORTED_SUBTREE_SHA256 + ' - the tree has been modified or came from a different release');
  }

  // A tree that fails any check above is rehydrated whatever the marker says: the marker is a claim
  // about the tree, and the tree is the thing the build reads.
  if (reasons.length) {
    return { action: 'rehydrate', reasons: reasons, subtree: subtree, topLevel: topLevel };
  }

  if (!marker) {
    return {
      action: 'adopt',
      reasons: ['the tree matches the pinned fingerprint but carries no completion marker'],
      subtree: subtree,
      topLevel: topLevel
    };
  }

  var markerProblems = [];

  if (marker.markerVersion !== MARKER_VERSION) {
    markerProblems.push('markerVersion is ' + JSON.stringify(marker.markerVersion) + ', not ' +
      MARKER_VERSION);
  }

  if (marker.releaseTag !== RELEASE_TAG) {
    markerProblems.push('releaseTag is ' + JSON.stringify(marker.releaseTag) + ', not ' + RELEASE_TAG);
  }

  if (marker.tarballBytes !== TARBALL_BYTES || marker.tarballSha256 !== TARBALL_SHA256) {
    markerProblems.push('it records a different archive than the pinned ' + RELEASE_TAG + ' asset');
  }

  if (!marker.importedSubtree || marker.importedSubtree.sha256 !== subtree.sha256) {
    markerProblems.push('it does not record the fingerprint the tree currently has');
  }

  if (!marker.topLevel || marker.topLevel.sha256 !== topLevel.sha256) {
    markerProblems.push('it does not record the top-level listing the tree currently has');
  }

  if (marker.runtimeAssetsChecked !== RUNTIME_ASSET_PATHS.length) {
    markerProblems.push('it records ' + JSON.stringify(marker.runtimeAssetsChecked) + ' checked ' +
      'served assets, not the ' + RUNTIME_ASSET_PATHS.length + ' this hydrator verifies');
  }

  if (markerProblems.length) {
    // The tree itself is correct, so re-verifying costs nothing but a marker rewrite.
    return {
      action: 'adopt',
      reasons: markerProblems.map(function(problem) {
        return 'the completion marker is stale: ' + problem;
      }),
      subtree: subtree,
      topLevel: topLevel
    };
  }

  return { action: 'skip', reasons: [], subtree: subtree, topLevel: topLevel };
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

/**
 * Removes the existing component tree so the archive unpacks onto a clean directory.
 *
 * Called ONLY after the replacement archive has been fetched and verified, so a failed download can
 * never leave the checkout with neither the old tree nor a new one. The two paths removed are the
 * gitignored tree this script owns and the AppleDouble sidecar beside it; nothing else is touched.
 */
function removeExistingTree() {
  if (fs.existsSync(COMPONENTS_DIR)) {
    log('removing the existing public/components tree before unpacking');
    fs.rmSync(COMPONENTS_DIR, { recursive: true, force: true });
  }

  fs.rmSync(APPLE_DOUBLE, { force: true });
}

function extract(filePath) {
  log('unpacking into ' + REPO_ROOT);

  // The archive is rooted at `public/`, so it unpacks straight over the repository root.
  childProcess.execFileSync('tar', ['xzf', filePath, '-C', REPO_ROOT], { stdio: 'inherit' });

  fs.rmSync(APPLE_DOUBLE, { force: true });
}

/**
 * Fails unless the freshly unpacked tree is complete and fingerprints to the pinned value. This is
 * what makes the marker meaningful: it is written on the far side of this check and nowhere else.
 *
 * @returns {Object} `{ subtree, topLevel }` - the two measurements the marker records.
 */
function assertUnpackedTreeIsPinned() {
  var missing = missingRequiredPaths();

  if (missing.length) {
    throw new Error('the archive unpacked but ' + missing.join(', ') + ' is still missing');
  }

  var missingRuntime = missingRuntimeAssets();

  if (missingRuntime.length) {
    throw new Error('the archive unpacked but ' + missingRuntime.join(', ') + ' is still missing, ' +
      'so a served component directory is incomplete');
  }

  var subtree = measureImportedSubtree();

  if (subtree.files !== IMPORTED_SUBTREE_FILES || subtree.sha256 !== IMPORTED_SUBTREE_SHA256) {
    throw new Error('the archive unpacked but ' + IMPORTED_SUBTREE_LABEL + ' fingerprints to ' +
      subtree.files + ' files / ' + subtree.sha256 + ' instead of the pinned ' +
      IMPORTED_SUBTREE_FILES + ' files / ' + IMPORTED_SUBTREE_SHA256);
  }

  var topLevel = measureTopLevel();

  if (topLevel.entries !== TOP_LEVEL_ENTRIES || topLevel.sha256 !== TOP_LEVEL_SHA256) {
    throw new Error('the archive unpacked but public/components fingerprints to ' +
      topLevel.entries + ' top-level entries / ' + topLevel.sha256 + ' instead of the pinned ' +
      TOP_LEVEL_ENTRIES + ' entries / ' + TOP_LEVEL_SHA256);
  }

  return { subtree: subtree, topLevel: topLevel };
}

async function hydrate() {
  var state = inspect();

  if (state.action === 'skip') {
    log('public/components is present and verified (' + IMPORTED_SUBTREE_LABEL + ': ' +
      state.subtree.files + ' files, sha256 ' + state.subtree.sha256.slice(0, 16) +
      '\u2026; top level: ' + state.topLevel.entries + ' entries, sha256 ' +
      state.topLevel.sha256.slice(0, 16) + '\u2026; ' + RUNTIME_ASSET_PATHS.length +
      ' served assets present) - nothing to do');

    return;
  }

  if (state.action === 'adopt') {
    state.reasons.forEach(function(reason) { log(reason); });
    writeMarker(state.subtree, state.topLevel);
    log('the tree matches the pinned fingerprint, so it is adopted and the completion marker is ' +
      'written - no download was needed');

    return;
  }

  state.reasons.forEach(function(reason) { log('rehydrating because ' + reason); });

  var localArchive = process.env.TRINKET_COMPONENTS_TARBALL;

  if (localArchive) {
    localArchive = path.resolve(localArchive);
    if (!fs.existsSync(localArchive)) {
      throw new Error('TRINKET_COMPONENTS_TARBALL points at ' + localArchive + ', which does not exist');
    }

    log('using the local archive ' + localArchive);
    await verify(localArchive);
    removeExistingTree();
    extract(localArchive);
  } else {
    // Download into a private scratch directory so a failed or interrupted fetch can never be
    // mistaken for a good archive on the next run, and so nothing is left inside the repository.
    var scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'trinket-components-'));
    var downloaded = path.join(scratch, TARBALL_NAME);

    try {
      await download(TARBALL_URL, downloaded);
      await verify(downloaded);
      removeExistingTree();
      extract(downloaded);
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  }

  var measured = assertUnpackedTreeIsPinned();

  writeMarker(measured.subtree, measured.topLevel);

  log('hydrated public/components from the ' + RELEASE_TAG + ' release asset and recorded the ' +
    'completion marker');
}

hydrate().catch(function(err) {
  console.error('[hydrate-components] ' + err.message);
  console.error('[hydrate-components] COMPONENTS.md documents the equivalent manual fetch and the ' +
    'TRINKET_COMPONENTS_TARBALL offline alternative');
  process.exit(1);
});
