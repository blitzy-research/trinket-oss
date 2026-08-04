/**
 * `lib/shared/trinket-markdown.js` — the marked-4 bridge and the HTML sanitizer (review finding M-20).
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * This module is the platform's XSS defence for learner- and author-authored markdown, and it had NO tests
 * at all while carrying the single riskiest dependency swap in the change: the `trinketapp/marked` git fork
 * (0.3.2) was replaced by registry `marked@4.3.0`. The load-bearing deviation of that fork was that it
 * accepted `sanitize` as a FUNCTION and called it for every inline HTML tag the lexer matched. marked 4
 * removed `sanitize` entirely, so the sanitizer is re-attached as `Renderer.prototype.html` instead - a
 * different hook reached by a different code path. Nothing verified that the whitelist still bites.
 *
 * Every expectation below is the MEASURED output of the current tree (R-6). Where an output is surprising,
 * the surprise is documented rather than smoothed over: this module is preserved, not improved.
 *
 * A NOTE ON GLOBAL STATE
 * ----------------------
 * The factory returns a render function that reassigns FIVE `marked.Renderer.prototype` methods on every
 * invocation, and the sanitizer keeps an open-tag stack (`TAGS`) in module scope. Both are base-commit
 * behaviour. The tests below therefore never assume a clean slate between cases beyond what a completed
 * render leaves, which is exactly the guarantee production has.
 */

var chai   = require('chai'),
    should = chai.should(),
    marked = require('marked').marked,
    render = require('../../../lib/shared/trinket-markdown.js')({});

describe('trinket markdown', function() {

  // -------------------------------------------------------------------------------------------
  // The marked-4 bridge
  // -------------------------------------------------------------------------------------------

  describe('the marked 4 bridge', function() {
    it('requires marked as a destructured named export, not a callable module', function() {
      // `require('marked')` on 4.x returns an OBJECT. Calling it throws, which is why
      // lib/shared/trinket-markdown.js:L1 destructures. If that regressed, this module would not load.
      var moduleExport = require('marked');

      moduleExport.should.be.an('object');
      moduleExport.marked.should.be.a('function');
      // Calling the module object itself is what the fork allowed and 4.x does not.
      (function() { moduleExport('# x'); }).should.throw(TypeError);
    });

    it('keeps every monkey-patched Renderer arity identical to the fork', function() {
      // The four patches transfer only because the arities match. A changed arity would silently drop an
      // argument - `escaped` on code, `title` on image and link - and produce wrong markup rather than an
      // error. Measured against marked 4.3.0.
      render('warm up the prototype patches');

      marked.Renderer.prototype.code.length.should.eql(3);
      marked.Renderer.prototype.image.length.should.eql(3);
      marked.Renderer.prototype.link.length.should.eql(3);
      marked.Renderer.prototype.listitem.length.should.eql(1);
      // The fifth patch, which the fork did not need: marked 4 funnels inline HTML through Renderer#html.
      marked.Renderer.prototype.html.length.should.eql(1);
    });

    it('substitutes an empty string for null and undefined input', function() {
      // The `src == null` guard is base-commit code and the only reason a course with no description
      // renders rather than throwing.
      render(null).should.eql('');
      render(undefined).should.eql('');
    });

    it('renders ordinary markdown', function() {
      render('hello **world**').should.eql('<p>hello <strong>world</strong></p>\n');
    });
  });

  // -------------------------------------------------------------------------------------------
  // The sanitizer: disallowed tags
  // -------------------------------------------------------------------------------------------

  describe('the HTML sanitizer', function() {
    describe('a tag that is not on the whitelist', function() {
      it('escapes a script tag rather than emitting it', function() {
        // The single most important assertion in this file: if the sanitizer stopped being reached, this
        // would emit a live <script> into every rendered course page.
        var output = render('before <script>alert(1)</script> after');

        output.should.eql('<p>before &lt;script&gt;alert(1)&lt;/script&gt; after</p>\n');
        output.should.not.contain('<script');
      });

      it('escapes a closing tag whose opening tag was not allowed', function() {
        // The TAGS pop/push statefulness: a close is passed through ONLY when it matches the tag on top of
        // the stack, so a mismatched close is escaped.
        render('<span class="a">x</div>').should.eql('<p><span class="a">x&lt;/div&gt;</p>\n');
      });
    });

    describe('a whitelisted tag', function() {
      it('keeps an attribute whose value matches the whitelist pattern', function() {
        render('<span class="highlight">hi</span>')
          .should.eql('<p><span class="highlight">hi</span></p>\n');
      });

      it('strips an attribute that is not whitelisted for that tag', function() {
        // `style` is whitelisted for iframe and for nothing else, so it is removed from span - the tag
        // itself survives, which is the per-attribute behaviour the whitelist describes.
        render('<span style="color:red">hi</span>').should.eql('<p><span>hi</span></p>\n');
      });

      it('strips an event handler attribute', function() {
        // `onerror` is on no whitelist at all. The img `src` is also dropped here, because img allows only
        // Google Drawings hosts - so a poisoned image collapses to a bare tag.
        var output = render('<img src="x" onerror="alert(1)">');

        output.should.eql('<p><img></p>\n');
        output.should.not.contain('onerror');
      });

      it('keeps nested whitelisted tags', function() {
        render('<span class="a"><b>x</b></span>').should.eql('<p><span class="a"><b>x</b></span></p>\n');
      });
    });

    describe('anchors', function() {
      it('keeps an https href and a target of _blank', function() {
        render('<a href="https://example.com" target="_blank">go</a>')
          .should.eql('<p><a href="https://example.com" target="_blank">go</a></p>\n');
      });

      it('strips a javascript: href, leaving the anchor bare', function() {
        var output = render('<a href="javascript:alert(1)">go</a>');

        output.should.eql('<p><a>go</a></p>\n');
        output.should.not.contain('javascript:');
      });
    });

    describe('images', function() {
      it('keeps a Google Drawings src, the only host img allows', function() {
        render('<img src="https://docs.google.com/drawings/d/abc">')
          .should.eql('<p><img src="https://docs.google.com/drawings/d/abc"></p>\n');
      });

      it('strips a src from any other host', function() {
        render('<img src="https://evil.example/a.png">').should.eql('<p><img></p>\n');
      });
    });

    describe('iframes, which carry the largest allowed-src list', function() {
      it('keeps a YouTube embed with its whitelisted attributes', function() {
        render('<iframe src="https://www.youtube.com/embed/abc" width="560"></iframe>')
          .should.eql('<iframe src="https://www.youtube.com/embed/abc" width="560"></iframe>');
      });

      it('escapes an iframe whose src is on no allowed host', function() {
        // The src is stripped by the attribute pass, which leaves no `src=` - and the iframe branch allows
        // the tag ONLY when a src survived. So the whole tag is escaped rather than emitted src-less.
        var output = render('<iframe src="https://evil.example/x"></iframe>');

        output.should.eql('&lt;iframe src=&quot;https://evil.example/x&quot;&gt;&lt;/iframe&gt;');
        output.should.not.contain('<iframe');
      });

      it('escapes an iframe with no src at all', function() {
        render('<iframe width="100"></iframe>')
          .should.eql('&lt;iframe width=&quot;100&quot;&gt;&lt;/iframe&gt;');
      });
    });
  });

  // -------------------------------------------------------------------------------------------
  // The four renderer patches, through their observable output
  // -------------------------------------------------------------------------------------------

  describe('the renderer patches', function() {
    it('rewrites a markdown link to open in a new window', function() {
      // processLink adds target="_blank" for any href that is not a fragment. Note the attribute ORDER -
      // target precedes href - which is what the string replace produces and therefore what ships.
      render('[text](https://example.com)')
        .should.eql('<p><a target="_blank" href="https://example.com">text</a></p>\n');
    });

    it('emits nothing for a markdown link with a javascript: href', function() {
      // forkRejectsLinkHref reproduces the fork's own refusal: the anchor is dropped entirely rather than
      // rendered with a stripped href.
      var output = render('[text](javascript:alert(1))');

      output.should.eql('<p></p>\n');
      output.should.not.contain('javascript:');
    });

    it('routes a relative .ipynb link through nbviewer', function() {
      // The `title="null"` is measured, not a mistake in the expectation: marked 4 hands the patch a null
      // title and the patch interpolates it. Preserved.
      render('[nb](/u/x/notebook.ipynb)')
        .should.contain('href="http://nbviewer.org/urls/');
      render('[nb](/u/x/notebook.ipynb)').should.contain('/u/x/notebook.ipynb"');
    });

    it('turns a task list into checkbox inputs', function() {
      var output = render('- [x] done\n- [ ] todo');

      output.should.contain('<li class="list-item"><input type="checkbox" class="list-item-checkbox" ' +
                            'checked="checked" />done</li>');
      output.should.contain('<li class="list-item"><input type="checkbox" class="list-item-checkbox" ' +
                            '/>todo</li>');
    });

    it('highlights a fenced code block with the held highlight.js 9 class names', function() {
      // highlight.js is HELD at 9.x precisely because 10 renamed these emitted classes, and they reach
      // client-visible markup. This is that hold, asserted.
      var output = render('```python\nprint(1)\n```');

      output.should.eql('<pre><code class="hljs">print(<span class="hljs-number">1</span>)</code></pre>');
    });
  });

  // -------------------------------------------------------------------------------------------
  // MathJax protection
  // -------------------------------------------------------------------------------------------

  describe('MathJax protection', function() {
    it('leaves the delimiters intact and adds no stray code tags', function() {
      // The module wraps $$ $( )$ in backticks before rendering and strips the resulting code tags after,
      // so the round trip must be invisible.
      var output = render('inline $(x)$ and $$y$$');

      output.should.eql('<p>inline $(x)$ and $$y$$</p>\n');
      output.should.not.contain('<code>');
      output.should.not.contain('`');
    });
  });

  // -------------------------------------------------------------------------------------------
  // Byte parity across repeated renders
  // -------------------------------------------------------------------------------------------

  describe('byte parity', function() {
    it('renders the same input identically twice, despite the module-scope tag stack', function() {
      // The sanitizer's TAGS stack is module state. If a render could leave it unbalanced, a later render
      // of the same input would differ - which would be a client-visible markup change with no code change.
      var source = '<span class="a">x</span> and <script>bad()</script> and ' +
                   '<iframe src="https://www.youtube.com/embed/z"></iframe>';

      render(source).should.eql(render(source));
    });

    it('is unaffected by an unbalanced tag in a previous render', function() {
      var source = '<span class="a">balanced</span>';

      var before = render(source);

      render('<span class="a">unbalanced, never closed');
      render(source).should.eql(before);
    });
  });
});
