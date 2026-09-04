/**
 * Baseline-derived coverage for lib/util/diff-compat.js.
 *
 * WHY THESE CASES EXIST AND WHERE THEIR EXPECTATIONS COME FROM
 * -----------------------------------------------------------
 * The migration moved the server's `diff` from 1.0.8 to 8.0.4 for a high
 * advisory. The patch it applies is not produced by the server: committed
 * configuration pins the browser to jsdiff 1.0.8 -
 * `config/default.yaml`'s `app.ngapps.courseEditor` loads
 * `//cdnjs.cloudflare.com/ajax/libs/jsdiff/1.0.8/diff.min.js` - and
 * `public/js/courseEditor/controllers/materialControl.js:321-323` strips the
 * file header before POSTing the remainder. Both of those files are out of
 * scope for this migration and unchanged, so only the consumer moved and the
 * server must keep reading the 1.0.8 dialect.
 *
 * Every expectation below is the value **diff 1.0.8 returns**, measured on
 * Node 22.23.2 by installing that release and running it against the same
 * inputs. Cases where 8.0.4 disagrees are marked; those are what the adapter
 * exists for.
 *
 * The patches are written out literally rather than generated, because
 * generating them would need the 1.0.8 producer this repository no longer
 * installs - and because the literal form is what a reader has to be able to
 * check. Note the `+` lines coming BEFORE the `-` lines in an edit hunk: that
 * is 1.0.8's `createPatch` output order, and an implementation that assumed
 * the modern order would fail here.
 */

var should     = require('chai').should()
  , diffCompat = require('../../../lib/util/diff-compat');

describe('Diff Compatibility (jsdiff 1.0.8 applyPatch semantics)', function() {
  describe('the case validator-style version drift actually broke', function() {
    it('inserts the first content into an empty material as "new\\n", not "\\nnew"',
    function(done) {
      // THE REGRESSION. diff 8.0.4 returns '\nnew' here: a leading newline
      // gained and the trailing one lost, i.e. corrupted stored content on a
      // page-visible save. `course.updateMaterial` passes '' when
      // `material.content` is null, which is exactly this input.
      diffCompat.applyPatch('', '@@ -1,0 +1,1 @@\n+new\n').should.equal('new\n');
      done();
    });

    it('inserts multi-line first content in document order', function(done) {
      // diff 8.0.4 returns '\nx\ny\nz'.
      diffCompat.applyPatch('', '@@ -1,0 +1,3 @@\n+x\n+y\n+z\n')
        .should.equal('x\ny\nz\n');
      done();
    });
  });

  describe('cases both diff releases agree on', function() {
    it('clears a one-line material to the empty string', function(done) {
      // Worth pinning precisely because the review finding claimed this case
      // returned `false` on 1.0.8. It does not, on either release: it returns
      // '', which `course.updateMaterial` then stores as null.
      diffCompat.applyPatch('hello\n', '@@ -1,1 +1,0 @@\n-hello\n')
        .should.equal('');
      done();
    });

    it('clears a one-line material that has no trailing newline', function(done) {
      diffCompat.applyPatch(
        'hello',
        '@@ -1,1 +1,0 @@\n-hello\n\\ No newline at end of file\n'
      ).should.equal('');
      done();
    });

    it('clears a multi-line material', function(done) {
      diffCompat.applyPatch('a\nb\nc\n', '@@ -1,3 +1,0 @@\n-a\n-b\n-c\n')
        .should.equal('');
      done();
    });

    it('clears a whitespace-only material', function(done) {
      // The result is '', which the caller's /^\s*$/ test also collapses to
      // null - so this and the case above reach the same stored value by two
      // different routes.
      diffCompat.applyPatch('   \n', '@@ -1,1 +1,0 @@\n-   \n')
        .should.equal('');
      done();
    });

    it('applies an edit hunk whose additions precede its removals',
    function(done) {
      // 1.0.8's own createPatch emits '+' before '-'. Collecting the two line
      // kinds into separate arrays is what makes the order irrelevant.
      diffCompat.applyPatch('hello\n', '@@ -1,1 +1,1 @@\n+goodbye\n-hello\n')
        .should.equal('goodbye\n');
      done();
    });

    it('appends a line, keeping the context line', function(done) {
      diffCompat.applyPatch('a\n', '@@ -1,1 +1,2 @@\n a\n+b\n')
        .should.equal('a\nb\n');
      done();
    });

    it('returns the source unchanged for the bare newline the editor sends when nothing changed',
    function(done) {
      diffCompat.applyPatch('same\n', '\n').should.equal('same\n');
      done();
    });

    it('returns the source unchanged for an empty patch string', function(done) {
      diffCompat.applyPatch('same\n', '').should.equal('same\n');
      done();
    });

    it('skips the four-line Index: header when it has not been stripped',
    function(done) {
      diffCompat.applyPatch(
        'hello\n',
        'Index: mid\n===================================================================\n' +
        '--- mid\n+++ mid\n@@ -1,1 +1,1 @@\n+goodbye\n-hello\n'
      ).should.equal('goodbye\n');
      done();
    });

    it('applies a multi-hunk patch', function(done) {
      diffCompat.applyPatch(
        'a\nb\nc\nd\ne\n',
        '@@ -1,1 +1,1 @@\n+A\n-a\n@@ -5,1 +5,1 @@\n+E\n-e\n'
      ).should.equal('A\nb\nc\nd\nE\n');
      done();
    });
  });

  describe('the stale-page signal', function() {
    // THE LOAD-BEARING RETURN VALUE. `course.updateMaterial` tests
    // `patched === false` with strict equality and answers "This page may have
    // been modified in another window" - so an implementation that returned
    // null, undefined, '' or threw here would silently disable a user-facing
    // safeguard while every other case above still passed.
    it('returns boolean false when a removal line does not match the source',
    function(done) {
      var result = diffCompat.applyPatch('other\n', '@@ -1,1 +1,0 @@\n-hello\n');

      result.should.equal(false);
      (result === false).should.equal(true);
      done();
    });

    it('returns boolean false when a context line does not match the source',
    function(done) {
      diffCompat.applyPatch('z\n', '@@ -1,1 +1,2 @@\n a\n+b\n')
        .should.equal(false);
      done();
    });

    it('returns boolean false when the source has diverged mid-document',
    function(done) {
      diffCompat.applyPatch('a\nCHANGED\nc\n', '@@ -1,3 +1,0 @@\n-a\n-b\n-c\n')
        .should.equal(false);
      done();
    });

    it('returns boolean false when only a later hunk mismatches', function(done) {
      diffCompat.applyPatch(
        'a\nb\nc\nd\nZZZ\n',
        '@@ -1,1 +1,1 @@\n+A\n-a\n@@ -5,1 +5,1 @@\n+E\n-e\n'
      ).should.equal(false);
      done();
    });

    it('does not confuse the false return with an empty result', function(done) {
      // Both outcomes are falsy in JavaScript and mean opposite things: '' is
      // a successful clear that stores null, and false is a refusal to save.
      var cleared = diffCompat.applyPatch('hello\n', '@@ -1,1 +1,0 @@\n-hello\n');
      var refused = diffCompat.applyPatch('other\n', '@@ -1,1 +1,0 @@\n-hello\n');

      cleared.should.equal('');
      refused.should.equal(false);
      (cleared === false).should.equal(false);
      (typeof cleared).should.equal('string');
      (typeof refused).should.equal('boolean');
      done();
    });
  });

  describe('malformed and degenerate input', function() {
    it('leaves the source unchanged for a hunk header the regex does not match',
    function(done) {
      // 1.0.8's split produces a single-element array here, so `start` and
      // `oldlength` are undefined; the coercions then apply nothing. Measured,
      // not reasoned about.
      diffCompat.applyPatch('a\nb\n', '@@ malformed @@\n-a\n')
        .should.equal('a\nb\n');
      done();
    });

    it('throws when a patch body precedes any hunk header', function(done) {
      // `diff[0]` is undefined at that point. 1.0.8 throws, so this does too;
      // the throw reaches the same `.catch` in `course.updateMaterial` that
      // any other handler error does. diff 8.0.4 returns the content instead.
      (function() { diffCompat.applyPatch('a\n', '-a\n'); })
        .should.throw(TypeError);
      done();
    });

    it('throws when the patch is not a string', function(done) {
      // No defensive guard was added: `uniDiff.split` throws exactly as it did
      // at baseline rather than being converted into a `false` return, which
      // would have been read as a stale page.
      (function() { diffCompat.applyPatch('a\n', undefined); }).should.throw(TypeError);
      (function() { diffCompat.applyPatch('a\n', null); }).should.throw(TypeError);
      (function() { diffCompat.applyPatch('a\n', 42); }).should.throw(TypeError);
      done();
    });
  });

  describe('the disposition course.updateMaterial derives from each result',
  function() {
    // The adapter's return value is not the point on its own - what the
    // controller does with it is. These mirror the exact expressions at
    // lib/controllers/course.js so the mapping from result to stored content
    // is covered, not just the result.
    function store(source, patch) {
      var patched = diffCompat.applyPatch(source, patch);

      if (patched === false) {
        return 'stale-page failure, no save';
      }

      return patched.match(/^\s*$/) ? null : patched;
    }

    it('saves the first content of an empty material as "new\\n"',
    function(done) {
      should.equal(store('', '@@ -1,0 +1,1 @@\n+new\n'), 'new\n');
      done();
    });

    it('saves null when a material is cleared', function(done) {
      should.equal(store('hello\n', '@@ -1,1 +1,0 @@\n-hello\n'), null);
      done();
    });

    it('saves null when a material is reduced to whitespace', function(done) {
      should.equal(store('   \n', '@@ -1,1 +1,0 @@\n-   \n'), null);
      done();
    });

    it('refuses to save when the page is stale', function(done) {
      should.equal(
        store('other\n', '@@ -1,1 +1,0 @@\n-hello\n'),
        'stale-page failure, no save'
      );
      done();
    });
  });
});
