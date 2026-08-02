var { marked } = require('marked')
  , hljs   = require('highlight.js')
  , config = require('config');

var browserConfig = {
  'apphostname' : config.app.url.hostname
}
var trinketConfig = {
  get : function(key) {
    return browserConfig[key];
  },
  getUrl : function(path) {
    return config.app.url.protocol + '://' + config.app.url.hostname + path;
  },
  prefix : function(path) {
  }
};

  // save the original implementations of code, image and link handling
  // from the marked library so we can defer to them in cases
  // where our custom features are not relevant
  var originalCode    = marked.Renderer.prototype.code;
  var originalImage   = marked.Renderer.prototype.image;
  var originalLink    = marked.Renderer.prototype.link;

  var trinket_hosts   = [trinketConfig.get('apphostname')];
  var trinket_types   = ['python', 'html', 'music', 'glowscript', 'blocks', 'python3', 'java', 'glowscript-blocks', 'R', 'pygame'];
  var inline_trinkets = ['python', 'python3', 'html', 'glowscript', 'java', 'R', 'pygame'];

  var EMBED_URLS = [
    {
      regex : /^(?:https?\:)?\/\/(?:www\.)?youtu\.?be(?:\.com)?\/(?:watch\?v=|embed\/)?(\S+)$/i,
      attrs : 'width="420" height="315" frameborder="0" allowfullscreen',
      url   : function(match) {
        return '//www.youtube.com/embed/' + match[1];
      }
    },
    {
      regex : /^(?:https?\:)?\/\/(?:www\.)?vimeo(?:\.com)?\/(?:video\/)?(\S+)$/i,
      attrs : 'width="500" height="281" frameborder="0" webkitallowfullscreen mozallowfullscreen allowfullscreen',
      url   : function(match) {
        return '//player.vimeo.com/video/' + match[1];
      }
    },
    {
      regex : /^\/components\/viewerjs\/index\.html#/i,
      attrs : 'width="600" height="400" frameborder="0" scrolling="no" allowfullscreen mozallowfullscreen webkitallowfullscreen',
      url   : function(match) {
        return trinketConfig.getUrl(match.input);
      }
    },
    {
      regex : new RegExp(
                '^(?:https?\\:)?\\/\\/(?:www\\.)?'
                + '(' + trinket_hosts.join('|') + ')'
                + '(?:\\/embed)?\\/(' + trinket_types.join('|') + ')(.*)', 'i'
              ),
      attrs : 'class="embedded-trinket" width="100%" height="400" frameborder="0" scrolling="no"',
      url   : function(match) {
        var type = python_types.indexOf(match[2]) >= 0 ? 'python' : match[2];
        return '//' + match[1] + '/embed/' + type + match[3];
      }
    },
    {
      regex : /^(?:https?\:)?\/\/www\.slideshare\.net\/slideshow\/embed_code\//i,
      attrs : 'width="427" height="356" frameborder="0" marginwidth="0" marginheight="0" scrolling="no" style="border:1px solid #CCC; border-width:1px 1px 0; margin-bottom:5px; max-width: 100%;" allowfullscreen'
    },
    {
      regex : /^(?:https?\:)?\/\/www\.google\.com\/maps\/embed/i,
      attrs : 'width="600" height="450" frameborder="0" style="border:0"'
    },
    {
      regex : /^(?:https?\:)?\/\/phet\.colorado\.edu\/sims\//i,
      attrs : 'width="800" height="600" scrolling="no"'
    },
    {
      regex : /^(?:https?\:)?\/\/parsons\.herokuapp\.com\/puzzle\//i,
      attrs : 'width="600" height="400" frameborder="0"'
    }
  ];

  var HTML_WHITELIST = {
    i: {"class": /^[a-z\-\s]+$/},
    b: {"class": /^[a-z\-\s]+$/},
    u: {"class": /^[a-z\-\s]+$/},
    strong: {"class": /^[a-z\-\s]+$/},
    blockquote: {"class": /^[a-z\-\s]+$/},
    pre: {"class": /^[a-z\-\s]+$/},
    code: {"class": /^[a-z\-\s]+$/},
    h1: {"class": /^[a-z\-\s]+$/},
    h2: {"class": /^[a-z\-\s]+$/},
    h3: {"class": /^[a-z\-\s]+$/},
    h4: {"class": /^[a-z\-\s]+$/},
    h5: {"class": /^[a-z\-\s]+$/},
    h6: {"class": /^[a-z\-\s]+$/},
    sup: {"class": /^[a-z\-\s]+$/},
    sub: {"class": /^[a-z\-\s]+$/},
    dd: {"class": /^[a-z\-\s]+$/},
    dl: {"class": /^[a-z\-\s]+$/},
    dt: {"class": /^[a-z\-\s]+$/},
    ol: {"class": /^[a-z\-\s]+$/, "start": /^[0-9]+$/, "type": /^[ai]$/i},
    ul: {"class": /^[a-z\-\s]+$/},
    li: {"class": /^[a-z\-\s]+$/},
    strike: {"class": /^[a-z\-\s]+$/},
    del: {"class": /^[a-z\-\s]+$/},
    span: {"class": /^[a-z\-\s]+$/},
    hr: {"class": /^[a-z\-\s]+$/},
    a: {"class": /^[a-z\-\s]+$/, "href": /^((https?\:)?\/\/|mailto\:)\S+$/i, "title": /^[^"']+$/, "target": /^_blank$/},
    p: {"class": /^[a-z\-\s]+$/},
    tr: {"class": /^[a-z\-\s]+$/},
    td: {"class": /^[a-z\-\s]+$/},
    th: {"class": /^[a-z\-\s]+$/},
    thead: {"class": /^[a-z\-\s]+$/},
    tbody: {"class": /^[a-z\-\s]+$/},
    tfoot: {"class": /^[a-z\-\s]+$/},
    table: {"class": /^[a-z\-\s]+$/, "width": /^\d+(px|%)?$/},
    img: {"src": /^(https?\:)?\/\/docs\.google\.com\/.*drawings\//i},
    iframe : {
      align                 : /^(left|right|top|middle|bottom)$/i,
      frameborder           : /^(0|1)$/,
      width                 : /^\d+(%|px)?$/,
      height                : /^\d+(%|px)?$/,
      marginwidth           : /^\d+$/,
      marginheight          : /^\d+$/,
      scrolling             : /^(no|yes|auto)$/i,
      seamless              : /^seamless$/i,
      allowfullscreen       : /^(allowfullscreen|true)$/i,
      webkitallowfullscreen : /^(webkitallowfullscreen|true)$/i,
      mozallowfullscreen    : /^(mozallowfullscreen|true)$/i,
      style                 : /^(.(?!expression|javascript|\-moz\-binding))*$/i,
      src                   : [
        /^(https?\:)?\/\/(www\.)?youtu(be\.com|\.be)\/embed\//i,
        /^(https?\:)?\/\/(www\.)?player\.vimeo\.com\/video\//i,
        /^(https?\:)?\/\/(www\.)?google\.com\/maps\/embed/i,
        /^(https?\:)?\/\/(www\.)?slideshare\.net\/slideshow\/embed_code\//i,
        /^(https?\:)?\/\/(www\.)?geogebra(tube)?\.org\//i,
        /^(https?\:)?\/\/(www\.)?pythontutor\.com\/iframe-embed\.html/i,
        /^(https?\:)?\/\/(www\.)?screencast\-o\-matic\.com\/embed/i,
        /^(https?\:)?\/\/(www\.)?plot\.ly\/\~[\w-]+\/\d+\.embed/i,
        /^(https?\:)?\/\/docs\.google\.com\/.*(presentation|document|spreadsheets|forms)\//i,
        /^(https?\:)?\/\/linus\.highpoint\.edu/i,
        /^(https?\:)?\/\/physics\.highpoint\.edu/i,
        /^(https?\:)?\/\/phet\.colorado\.edu\/sims\//i,
        /^(https?\:)?\/\/parsons\.herokuapp\.com\/puzzle\//i,
        /^(https?\:)?\/\/(www\.)?loom\.com\/embed\//i,
        /^(https?\:)?\/\/forms\.office\.com\//i,
        /^(https?\:)?\/\/quizizz\.com\//i,
        /^(https?\:)?\/\/embed\.kahoot\.it\//i,
        new RegExp(
          '^(https?\\:)?\\/\\/(www\\.)?'
          + '(' + trinket_hosts.join('|') + ')'
          + '\\/embed\\/', 'i'
        ),
      ]
    }
  };

  var IPYNB_REGEXP   = /\.ipynb$/i;
  var HTML_ATTR_REGEXP = /(?:\s+(\w+)(?:\s*=\s*(?:"(.*?)"|'(.*?)'|([^'">\s]+)))?)/igm;

  var TAGS = [];

  function escape(html, encode) {
    return html
      .replace(!encode ? /&(?!#?\w+;)/g : /&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function sanitizeTag(tag, whitelist) {
    var attrs, foundMatch, rule;

    if (!whitelist) return escape(tag);

    HTML_ATTR_REGEXP.lastIndex = 0;
    while ((attrs = HTML_ATTR_REGEXP.exec(tag)) !== null) {
      foundMatch = false,
      rule = whitelist[attrs[1].toLowerCase()];
      var value = attrs[2] != null ? attrs[2] :
                  attrs[3] != null ? attrs[3] :
                  attrs[4];
      // allow whitelisted attributes with no value
      if (rule && value == null) {
        foundMatch = true;
      }
      else if (rule instanceof Array) {
        for(var i = 0; i < rule.length; i++) {
          if (rule[i] instanceof RegExp) {
            if (rule[i].exec(value)) {
              foundMatch = true;
              break;
            }
          }
        }
      }
      else if (rule instanceof RegExp && rule.exec(value)) {
        foundMatch = true;
      }

      if (!foundMatch) {
        tag = tag.substr(0, attrs.index) + tag.substr(attrs.index + attrs[0].length);
        HTML_ATTR_REGEXP.lastIndex = attrs.index;
      }
    }

    return tag;
  }

  // The platform's HTML sanitizer. The base commit handed this exact function to marked as its
  // `sanitize` option, which the trinketapp/marked 0.3.2 fork accepted as a per-TAG whitelist
  // filter (`out += this.options.sanitize(cap[0])` for every tag the inline lexer matched). The
  // body below is byte-identical to the base commit's, including the TAGS pop/push statefulness
  // that lets a closing tag through only when its opening tag was allowed, the iframe `src` gate
  // inside its swallow-all try/catch, and the unused `src` local.
  function sanitizeHtmlTag(html) {
    var close = html.match(/^\s*<\/(\w+)\s*>\s*$/),
        allow = false,
        open, src, tagName, cleaned;

    if (close) {
      if (close[1] === TAGS[TAGS.length-1]) {
        TAGS.pop();
        return html;
      }
      else {
        return escape(html);
      }
    }

    open = html.match(/^\s*<(\w+)(?:(?:\s+\w+(?:\s*=\s*(?:".*?"|'.*?'|[^'">\s]+))?)+\s*|\s*)(\/>|>)\s*$/im);
    if (!open) {
      return escape(html);
    }

    tagName = open[1].toLowerCase();

    if (HTML_WHITELIST[tagName]) {
      cleaned = sanitizeTag(html, HTML_WHITELIST[tagName]);
      if (tagName === 'iframe') {
        try {
          if (/src\s*=/.test(cleaned)) {
            allow = true;
            html = cleaned;
          }
        } catch(e) {}
      }
      else {
        allow = true;
        html = cleaned;
      }
    }

    if (allow && open[2] === '>') {
      TAGS.push(open[1]);
    }

    return allow ? html : escape(html);
  }

  // DEPENDENCY SWAP BRIDGE - marked 0.3.2 (the git fork) -> marked 4.3.0 (registry).
  //
  // marked 4 has no option that accepts a function for `sanitize`; passing one coerces to `true`,
  // which selects a WHOLLY different code path (the whole HTML block is sanitized as one string and
  // then wrapped in <p>) and additionally emits a deprecation warning on every single render. The
  // fork's contract is reproduced instead through marked 4's four supported integration points
  // below, and `sanitize`/`sanitizer` are not passed at all - which is what makes renders silent.
  //
  //   1. tokenizer.html  - decides which HTML is a BLOCK. Reproduces the fork's own rule, so
  //                        chunks the fork treated as inline (an <img>, a bare </div>, a <span>)
  //                        still fall through to the paragraph/text rules and still get their <p>.
  //   2. renderers.trinketHtmlBlock
  //                      - renders a block by INLINE-lexing it, which is what the fork's parser did
  //                        (`this.inline.output(this.token.text)`) whenever `pre` was false - and at
  //                        the base commit `pre` was ALWAYS false, because it is computed as
  //                        `!this.options.sanitize && ...` and the whitelist function is truthy.
  //   3. Renderer.prototype.html
  //                      - marked 4 routes every inline HTML token through this method, so pointing
  //                        it at the sanitizer reproduces the fork's per-tag filtering exactly.
  //   4. walkTokens      - marked 4 gained task-list parsing that 0.3.2 did not have; it strips the
  //                        `[ ] ` / `[x] ` marker and renders an <input> in its place. That is undone
  //                        here so the frozen listitem patch below still receives the literal marker
  //                        it has always received, in both the tight and the loose list shapes.
  //
  // Transcribed verbatim from the fork's compiled Lexer.rules.normal.html: a comment, a balanced
  // open/close pair, or a single tag - in every case a tag NOT in HTML's inline set.
  var FORK_INLINE_TAGS = 'a|em|strong|small|s|cite|q|dfn|abbr|data|time|code'
                       + '|var|samp|kbd|sub|sup|i|b|u|mark|ruby|rt|rp|bdi|bdo'
                       + '|span|br|wbr|ins|del|img';
  var FORK_BLOCK_TAG   = '(?!(?:' + FORK_INLINE_TAGS + ')\\b)\\w+(?!:\\/|[^\\w\\s@]*@)\\b';
  var FORK_BLOCK_HTML  = new RegExp(
    '^ *(?:'
    + '<!--[\\s\\S]*?--> *(?:\\n|\\s*$)'
    + '|<(' + FORK_BLOCK_TAG + ')[\\s\\S]+?<\\/\\1> *(?:\\n{2,}|\\s*$)'
    + '|<' + FORK_BLOCK_TAG + '(?:"[^"]*"|\'[^\']*\'|[^\'">])*?> *(?:\\n{2,}|\\s*$)'
    + ')'
  );

  marked.use({
    extensions : [
      {
        name     : 'trinketHtmlBlock',
        renderer : function(token) {
          return this.parser.parseInline(token.tokens);
        }
      }
    ],
    tokenizer : {
      html : function(src) {
        var cap = FORK_BLOCK_HTML.exec(src);

        // Returning undefined - NOT false - is deliberate: false would fall back to marked 4's own
        // block-html rule, which claims markup the fork left to the paragraph rule. Undefined means
        // "no block-level HTML here", which is precisely what the fork's single html rule meant.
        if (!cap) {
          return undefined;
        }

        // Queue the raw block for inline lexing rather than lexing it now, so that link reference
        // definitions declared LATER in the document still resolve inside it - the fork got this
        // for free by inline-lexing at parse time.
        var token = { type : 'trinketHtmlBlock', raw : cap[0], text : cap[0], tokens : [] };
        this.lexer.inline(token.text, token.tokens);
        return token;
      },
      // The fork escaped inline text unconditionally. marked 4 leaves it RAW while the inline lexer
      // is inside a <pre>/<code>/<kbd>/<script> tag unless `sanitize` is set, and `sanitize` is
      // exactly what this bridge exists to avoid - so the fork's unconditional escaping is restored
      // here. Identical to marked's own escape() for every input: same five replacements.
      inlineText : function(src) {
        var cap = this.rules.inline.text.exec(src);

        if (!cap) {
          return undefined;
        }

        return { type : 'text', raw : cap[0], text : escape(cap[0]) };
      }
    },
    walkTokens : function(token) {
      if (token.type !== 'list_item' || !token.task) {
        return;
      }

      var marker = { type : 'text', raw : '', text : token.checked ? '[x] ' : '[ ] ' },
          first  = token.tokens && token.tokens[0];

      delete token.task;
      delete token.checked;

      if (first && first.tokens) {
        first.tokens.unshift(marker);
      }
      else {
        token.tokens.unshift(marker);
      }
    }
  });

  module.exports = function(options) {
    function processCode(code, lang, escaped) {

      var output = code,
          parts  = /^([a-zA-Z0-9]+)\.((?:run|trinket|console))(?:\:(.*))?$/.exec(lang),
          attrs  = {
            width  : '100%',
            height : '400'
          },
          attrStr = '',
          url, arg;

      // if it matched the regex make sure it is an inline-able trinket
      if (parts && inline_trinkets.indexOf(parts[1]) == -1) {
        parts = undefined;
      }

      if (parts) {
        if (parts[3]) {
          // accept arguments of the style x=y,x="y",x='y'
          while (arg = /(\w+)=([^,]+)/.exec(parts[3])) {
            attrs[arg[1]] = arg[2].replace(/^("|')|("|')$/g, '');
            parts[3]      = parts[3].substr(arg[0].length);
          }
        }

        url = trinketConfig.getUrl('/embed/' + parts[1]);
        if (attrs.autorun !== "false") {
          url = url + '?start=result';
        }

        if (parts[1] === 'python' && parts[2] === 'console') {
          url = url + '&runMode=console&outputOnly=true&runOption=console&leftMenu=true';
          code = code + '\n'; // To make sure loops and functions fire
          attrs.height = 300;
        }

        if (parts[1] === 'python3' && parts[2] === 'console') {
          code = code + '\n'; // To make sure loops and functions fire
          url = url + '&runMode=console&outputOnly=true&runOption=console&leftMenu=true';
        }

        for(var key in attrs) {
          attrStr += ' ' + key + '="' + attrs[key] + '"';
        }

        url    = url + '#code=' + encodeURIComponent(code);

        url    = url.replace(/'/g, "%27");
        output = '<iframe class="embedded-trinket" src="' + url + '"' + attrStr + ' frameborder="0" marginwidth="0" marginheight="0" allowfullscreen></iframe>';
      }
      else if (hljs && hljs.getLanguage(lang)) {
        output = '<pre><code class="hljs">' + hljs.highlight(lang, code).value + '</code></pre>';
      }
      else {
        output = originalCode.call(this, code, lang, escaped);
      }

      return output;
    }

    function checkForEmbedUrl(href, title, text) {
      var match;
      for (var i = 0; i < EMBED_URLS.length; i++) {
        if (match = href.match(EMBED_URLS[i].regex)) {
          return '<iframe title="' + (title || text) + '"'
                 + ' src="'
                 + (EMBED_URLS[i].url ? EMBED_URLS[i].url(match) : match.input)
                 + '" ' + EMBED_URLS[i].attrs + '></iframe>';
        }
      }

      return false;
    }

    function processImage(href, title, text) {
      if (text === "plotly") {
        var plotly_parts  = href.split(':')
          , plotly_user   = plotly_parts[0]
          , plotly_id     = plotly_parts[1]
          , plotly_width  = 640
          , plotly_height = 480
          , plotly_attr, plotly_code;

        if (/\s+=\d+(x\d+)?/.test(plotly_id)) {
          plotly_attr = /\s+=(\d+)(x(\d+))?/.exec(plotly_id);
          if (plotly_attr[1]) {
            plotly_width = plotly_attr[1];
          }
          if (plotly_attr[3]) {
            plotly_height = plotly_attr[3];
          }

          plotly_id = plotly_id.replace(/\s+=.+/, '');
        }

        plotly_code = "<iframe "
          + "width='" + plotly_width + "' "
          + "height='" + plotly_height + "' "
          + "frameborder='0' seamless='seamless' scrolling='no' "
          + "src='https://plot.ly/~" + plotly_user + "/" + plotly_id + "/.embed"
          + "?width=" + plotly_width + "&height=" + plotly_height + "'></iframe>";

        return plotly_code;
      }
      else {
        var embedUrl = checkForEmbedUrl(href, title, text);

        if (embedUrl) {
          return embedUrl;
        }

        if (/^\//.test(href)) {
          href = trinketConfig.getUrl(href);
        }

        if (/\s+=\d+x\d*/.test(href)) {
          var attr   = href.match(/\s+=(\d+)x(\d*)/);
          var width  = attr[1] || ""; // ? "width=" + attr[1] : "";
          var height = attr[2] || ""; // ? "height=" + attr[2] : "";
          var style  = "";
          var img;

          href = href.replace(attr[0], "");

          img = '<img src="' + href + '" alt="' + text + '"';

          if (width) {
            img  += ' width="' + width + '"';
            style = 'style="width: ' + width + 'px;';

            if (height) {
              img   += ' height="' + height + '"';
              style += ' height: ' + height + 'px"';
            }
            else {
              style += 'height: auto"';
            }

            img += ' style="' + style + '"';
          }

          if (title) {
            img += ' title="' + title + '"';
          }

          img += '>';

          return img;
        }
        else {
          return originalImage.call(this, href, title, text);
        }
      }
    }

    // marked 0.3.2's own Renderer.prototype.link ran this guard whenever `sanitize` was truthy, and
    // at the base commit it always was, because the whitelist function was passed there. marked 4
    // keeps an equivalent guard in cleanUrl() but reaches it only through that same deprecated flag,
    // so the fork's version is transcribed here and applied where the fork applied it. Note exactly
    // what the fork did NOT do, all of it measured against the fork rather than assumed:
    //   * it rejected `javascript:` ONLY - `vbscript:` and `data:` hrefs were emitted unchanged,
    //     whereas marked 4's cleanUrl rejects all three;
    //   * it returned the EMPTY STRING, whereas marked 4's cleanUrl-null path returns the link text;
    //   * it had NO counterpart on the image renderer, so `![x](javascript:...)` produced a literal
    //     `<img src="javascript:...">`.
    // All three shapes are reproduced rather than tightened: they are the base commit's observable
    // output, and none of them is a live vector in any currently supported browser (`javascript:` in
    // an `img src` has never executed, `vbscript:` was removed from IE, and top-level `data:`
    // navigation is blocked everywhere). The platform's actual XSS defence is the HTML whitelist
    // above, which is preserved byte-for-byte. See docs/PRESERVED-QUIRKS.md.
    //
    // The `unescape` the fork's guard called is NOT JavaScript's global percent-decoder: it is
    // marked's own module-private HTML-ENTITY decoder, transcribed below from the fork verbatim
    // (marked 4 ships the same helper behind a slightly looser regex). Getting this wrong silently
    // widens the guard: `[click](&#106;avascript:void)` is REJECTED at the base commit because the
    // entity decodes to a `j` first, and would sail through if the global function were used.
    function unescapeEntities(html) {
      return html.replace(/&([#\w]+);/g, function(_, n) {
        n = n.toLowerCase();
        if (n === 'colon') return ':';
        if (n.charAt(0) === '#') {
          return n.charAt(1) === 'x'
            ? String.fromCharCode(parseInt(n.substring(2), 16))
            : String.fromCharCode(+n.substring(1));
        }
        return '';
      });
    }

    function forkRejectsLinkHref(href) {
      var prot;

      try {
        prot = decodeURIComponent(unescapeEntities(href))
          .replace(/[^\w:]/g, '')
          .toLowerCase();
      } catch (e) {
        return true;
      }

      return prot.indexOf('javascript:') === 0;
    }

    function processLink(href, title, text) {
      var ipynb, arg, attrs, html;

      var embed = checkForEmbedUrl(href, title, text);
      if (embed) {
        return embed;
      }

      if (/^trinket-widget$/.test(text)) {
        attrs = {};
        // accept arguments of the style x=y,x="y,z",x='y,z'
        while (arg = /(\w+)=(?:("|'|&quot;|&#39;)((?:(?=(\\?))\4.)*?)\2|()([^,]+))/.exec(href)) {
          attrs[arg[1]] = arg[3] || arg[6];
          href          = href.substr(arg[0].length);
        }

      }

      if (ipynb = href.match(IPYNB_REGEXP) && href.charAt(0) == '/') {
        return '<a href="http://nbviewer.org/urls/' + trinketConfig.get('apphostname') + href + '" title="' + title + '">' + text + '</a>';
      }
      else {
        var link = forkRejectsLinkHref(href) ? '' : originalLink.call(this, href, title, text);
        if (href.charAt(0) !== '#') {
          // open links in a new window
          link = link.replace(/^<a\s/, '<a target="_blank" ');
        }
        return link;
      }
    }

    return function(src) {
      marked.Renderer.prototype.code  = processCode;
      marked.Renderer.prototype.image = processImage;
      marked.Renderer.prototype.link  = processLink;
      // The one patch the fork did not need: marked 4 funnels every inline HTML token through
      // Renderer#html, which is where the fork's inline lexer called `sanitize` directly. Re-applied
      // per invocation alongside the others, for the same reason they are.
      marked.Renderer.prototype.html  = sanitizeHtmlTag;

      // src should be a string; replace null and undefined with empty string
      if (typeof src === 'undefined' || src == null) {
        src = "";
      }

      marked.Renderer.prototype.listitem = function(text) {
        if (/^\s*\[[x ]\]\s*/.test(text)) {
          text = text
            .replace(/^\s*\[ \]\s*/, '<input type="checkbox" class="list-item-checkbox" />')
            .replace(/^\s*\[x\]\s*/, '<input type="checkbox" class="list-item-checkbox" checked="checked" />');
          return '<li class="list-item">' + text + '</li>';
        } else {
          return '<li>' + text + '</li>';
        }
      }

      // check for and "protect" MathJax by adding backticks
      src = src.replace(/(\$\$|\$\(|\)\$)/g, '$1`');

      var frameIndex = 0,
          iframes    = [],
          markup     = marked(src);

      // remove any code tags or backticks that were added to protect MathJax
      markup = markup.replace(/(\$\$|\$\(|\)\$)(<(?:\/)?code>|\`)/g, '$1');

      return markup;
    }
  };
