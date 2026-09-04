// Legacy-compatible unified-diff patch application (jsdiff 1.0.8 semantics).
//
// WHY THIS MODULE EXISTS
// ---------------------------------------------------------------------------
// Course-material patches are PRODUCED by the browser and APPLIED by the
// server, and only one half of that pair moved during the Node 22 migration.
//
//   * The producer is pinned to jsdiff 1.0.8 by committed configuration:
//     `config/default.yaml:110` declares `'jsdiff': '1.0.8'` and
//     `config/default.yaml:172` loads
//     `//cdnjs.cloudflare.com/ajax/libs/jsdiff/1.0.8/diff.min.js` into the
//     `courseEditor` Angular app. `config/default.yaml` is out of scope for
//     this migration and is unchanged, so the patch dialect arriving at the
//     server is frozen at 1.0.8.
//   * `public/js/courseEditor/controllers/materialControl.js:321-323` calls
//     `JsDiff.createPatch(id, oldContent, newContent)` and then does
//     `patch = patch.substr(patch.indexOf('@'))`, i.e. it STRIPS the file
//     header and PUTs only the hunks to `patchContent`.
//   * The server's `diff` dependency moved 1.0.8 -> 8.0.4
//     (`package.json:27`), so the patch branch of `course.updateMaterial`
//     (`lib/controllers/course.js:545`, routed as
//     `PUT /api/courses/{courseId}/lessons/{lessonId}/materials/{materialId}/patchContent`
//     at `config/api_routes.js:319`) began feeding a 1.0.8-dialect,
//     header-stripped patch to an 8.x parser.
//
// This module is the compatibility layer for that seam: a faithful port of
// jsdiff 1.0.8's own `applyPatch`, used by the material-patching path so the
// applier speaks the same dialect as the pinned producer. The `diff` package
// itself is NOT downgraded - 8.0.4 stays declared and installed, and every
// other consumer keeps using it.
//
// THE MEASURED DIVERGENCE THIS PREVENTS
// ---------------------------------------------------------------------------
// Genuine jsdiff-1.0.8 `createPatch` output, header-stripped exactly as the
// front end strips it, applied to the source string `course.updateMaterial`
// builds at the call site (`material.content ? material.content : ''`):
//
//   case                        old content  patch                                    1.0.8      8.0.4
//   --------------------------  -----------  ---------------------------------------  ---------  ---------
//   clear one line              'hello\n'    '@@ -1,1 +1,0 @@\n-hello\n'              ''         ''
//   clear one line, no EOL      'hello'      '@@ -1,1 +1,0 @@\n-hello\n\\ No new...'  ''         ''
//   clear multi-line            'a\nb\nc\n'  '@@ -1,3 +1,0 @@\n-a\n-b\n-c\n'          ''         ''
//   edit one line               'hello\n'    '@@ -1,1 +1,1 @@\n+goodbye\n-hello\n'    'goodbye\n' 'goodbye\n'
//   append line                 'a\n'        '@@ -1,1 +1,2 @@\n a\n+b\n'              'a\nb\n'   'a\nb\n'
//   first content into EMPTY    ''           '@@ -1,0 +1,1 @@\n+new\n'                'new\n'    '\nnew'   <-- REGRESSION
//   no change                   'same\n'     '\n'                                     'same\n'   'same\n'
//   clear whitespace-only       '   \n'      '@@ -1,1 +1,0 @@\n-   \n'                ''         ''
//
// Seven of the eight agree. The one that does not is the user-visible defect:
// writing the FIRST content into a material whose stored `content` is null or
// empty gained a leading newline and lost the trailing one, so the saved
// material was silently corrupted on an ordinary save. Reproducing 1.0.8
// exactly is what restores `'new\n'`.
//
// Note also that in the 1.0.8 dialect `-` lines may follow `+` lines within a
// hunk (see the "edit one line" row above, `+goodbye` before `-hello`). That
// is a `createPatch` quirk of that version, and the parse loop below tolerates
// it because it collects the two line kinds into separate lists rather than
// relying on their order.
//
// WHY THE `false` RETURN IS LOAD-BEARING
// ---------------------------------------------------------------------------
// 1.0.8 returns the boolean `false` - not a string, not a throw - when a
// context line does not match the source. That is the stale-page detector
// `course.updateMaterial` tests for with `patched === false`: it is how an edit computed
// against content that has since changed in another window is refused instead
// of being applied on top of the newer content. Returning anything else there
// would silently disable a user-facing safeguard, so `false` is propagated
// verbatim.
//
// HOW PARITY IS GUARANTEED
// ---------------------------------------------------------------------------
// The algorithm below is a line-for-line port of `applyPatch` as it is
// published in `diff@1.0.8/diff.js:281-332`, retaining its coercions,
// its index arithmetic and its ordering. Several of those look like defects
// and are deliberately not repaired - each is commented at the line that
// carries it, because "correcting" any of them would change stored material
// content. The only textual departures from the original are the comments,
// CommonJS packaging, and the second loop's index being named `h` (hunks)
// rather than reusing `i`; neither affects behaviour.
//
// Parity is not asserted from reading alone: it was measured case by case
// against a genuine `diff@1.0.8` install over the table above plus multi-hunk,
// non-matching-context, diverged-source, CRLF, missing-trailing-newline,
// empty-patch, `Index:`-header and whitespace-only-result inputs, comparing
// results with `===` so that `false` and `''` cannot be confused.

// applyPatch(oldStr, uniDiff) - jsdiff 1.0.8's `applyPatch`, exactly.
//
// `oldStr` is the current content as a string; `uniDiff` is a unified diff,
// with or without the four-line `Index:` header. Returns the patched string,
// or the boolean `false` when a context line does not match `oldStr`.
//
// It is not defensive, and must not become so: a malformed or non-string
// `uniDiff` throws a TypeError out of this function synchronously, which is
// what the 1.0.8 implementation did, and the material-patching path relies on
// that throw reaching the same error funnel it reaches today (the promise
// `.catch` in `course.patchContent`, which answers through the route
// catch-all). Adding a guard here would convert a 500 into a different
// outcome.
//
// e.g. applyPatch('', '@@ -1,0 +1,1 @@\n+new\n')       -> 'new\n'
//      applyPatch('hello\n', '@@ -1,1 +1,0 @@\n-hello\n') -> ''
//      applyPatch('other\n', '@@ -1,1 +1,0 @@\n-hello\n') -> false
function applyPatch(oldStr, uniDiff) {
  var diffstr = uniDiff.split('\n');
  var diff = [];
  var remEOFNL = false,
      addEOFNL = false;

  // `diffstr[0][0]==='I'` sniffs the 'Index: <file>' header `createPatch`
  // emits and skips its four lines. The front end strips that header before
  // POSTing, so the common case starts at 0; both forms are accepted, as in
  // 1.0.8. Indexing character 0 of an empty first line yields `undefined`
  // rather than throwing, so both an empty patch string and the bare '\n' the
  // editor sends when nothing changed parse to zero hunks and return `oldStr`
  // unchanged - the "no change" row of the table above.
  for (var i = (diffstr[0][0] === 'I' ? 4 : 0); i < diffstr.length; i++) {
    if (diffstr[i][0] === '@') {
      var meh = diffstr[i].split(/@@ -(\d+),(\d+) \+(\d+),(\d+) @@/);

      // Two deliberate oddities, both preserved:
      //
      //   * `start` is capture group 3 - the NEW-file start - while
      //     `oldlength` is group 2, the OLD-file length. The pairing is
      //     mismatched on purpose; it is what makes the empty-material case
      //     splice at the right place, and "fixing" it changes results.
      //   * Both stay STRINGS here. They are coerced at use: `d.start-1`
      //     numerically, `+d.oldlength` explicitly, and `j < d.oldlength`
      //     compares a number against a string. Pre-parsing them to integers
      //     would look tidier but would alter the NaN behaviour for a hunk
      //     header the regex above does not match.
      //
      // `unshift` (not `push`) reverses hunk order, which the apply loop then
      // undoes by counting down - see the comment there.
      diff.unshift({
        start     : meh[3],
        oldlength : meh[2],
        oldlines  : [],
        newlength : meh[4],
        newlines  : []
      });
    }
    // `+` and `-` are collected separately, so a 1.0.8 hunk that emits its
    // additions before its removals is handled the same as the canonical
    // order. `diff[0]` is the hunk most recently unshifted, i.e. the one being
    // read; a patch body preceding any '@@' line throws here, as in 1.0.8.
    else if (diffstr[i][0] === '+') {
      diff[0].newlines.push(diffstr[i].substr(1));
    }
    else if (diffstr[i][0] === '-') {
      diff[0].oldlines.push(diffstr[i].substr(1));
    }
    else if (diffstr[i][0] === ' ') {
      diff[0].newlines.push(diffstr[i].substr(1));
      diff[0].oldlines.push(diffstr[i].substr(1));
    }
    else if (diffstr[i][0] === '\\') {
      // '\ No newline at end of file' is attributed by looking at the
      // PREVIOUS patch line, not at the hunk: after a '+' it means the new
      // file has no trailing newline (strip it), after a '-' it means the old
      // file had none (add one back).
      if (diffstr[i - 1][0] === '+') {
        remEOFNL = true;
      }
      else if (diffstr[i - 1][0] === '-') {
        addEOFNL = true;
      }
    }
  }

  var str = oldStr.split('\n');

  // Because the hunks were unshifted, this descending loop walks them in the
  // ORIGINAL file order, and each hunk is applied against the array as the
  // previous hunk already mutated it - offsets of later hunks are NOT
  // adjusted for earlier edits. That is 1.0.8's behaviour and it is preserved.
  for (var h = diff.length - 1; h >= 0; h--) {
    var d = diff[h];

    // Context/removal verification. `j < d.oldlength` compares a number with
    // a string, and `str[d.start-1+j]` coerces the string `start`; both are
    // intentional.
    for (var j = 0; j < d.oldlength; j++) {
      if (str[d.start - 1 + j] !== d.oldlines[j]) {
        // The stale-page signal. Boolean `false`, tested with `===` by
        // `course.updateMaterial` immediately after this call.
        return false;
      }
    }

    Array.prototype.splice.apply(str, [d.start - 1, +d.oldlength].concat(d.newlines));
  }

  if (remEOFNL) {
    // Pops EVERY falsy trailing element, not just one, so a result whose last
    // lines are empty loses all of them when the new file carries no trailing
    // newline.
    while (!str[str.length - 1]) {
      str.pop();
    }
  }
  else if (addEOFNL) {
    str.push('');
  }

  // `join` adds no trailing newline of its own: the trailing '' element that
  // `split('\n')` produces for newline-terminated content is what restores it.
  return str.join('\n');
}

module.exports = {
  applyPatch : applyPatch
};
