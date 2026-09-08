/**
 * MODIFIED VERSION of the jQuery Lined Textarea Plugin
 *   https://github.com/aw20/JQueryLinedText
 *
 * Copyright (c) 2010 Alan Williamson
 *
 * Version:
 *    $Id: jquery-linedtextarea.js 464 2010-01-08 10:36:33Z alan $
 *
 * Released under the MIT License:
 *    http://www.opensource.org/licenses/mit-license.php
 *
 * Usage:
 *   Displays a line number count column to the left of the textarea
 *
 *   Class up your textarea with a given class, or target it directly
 *   with JQuery Selectors
 *
 *   $(".lined").linedtextarea({
 *    selectedLine: 10,
 *    selectedClass: 'lineselect'
 *   });
 *
 * History:
 *   - 2010.01.08: Fixed a Google Chrome layout problem
 *   - 2010.01.07: Refactored code for speed/readability; Fixed horizontal sizing
 *   - 2010.01.06: Initial Release
 *
 */
(function($, TrinketIO, ace) {
  var template = TrinketIO.import('utils.template');
  var INFO_CACHE        = {};

  /**
   * Keyboard activation for the editor's icon controls.
   *
   * The tab bar is built from anchors and spans that carry no `href`, so a
   * browser will not synthesise a click for them when ENTER or SPACE is
   * pressed. Every control we expose to the keyboard therefore opts in to this
   * helper, which forwards those two keys to the control's existing click
   * handler. Doing it in one place keeps the mouse path (the click handlers
   * registered in `_create`) as the single implementation of each action.
   *
   * @param {jQuery} $scope element to delegate from
   * @param {String} selector controls within $scope that should be activatable
   */
  function enableKeyActivation($scope, selector) {
    $scope.on('keydown.trinket-code-editor.activate', selector, function(event) {
      // 13 = ENTER, 32 = SPACE
      if (event.which !== 13 && event.which !== 32) {
        return;
      }

      // Let the browser handle keys aimed at a real text field.
      if ($(event.target).is('input, textarea, select')) {
        return;
      }

      event.preventDefault();

      // Click handlers run synchronously inside trigger(), so an action can
      // ask whether it was reached from the keyboard and place focus
      // accordingly. try/finally keeps the depth honest if a handler throws.
      keyboardActivationDepth++;
      try {
        $(this).trigger('click');
      }
      finally {
        keyboardActivationDepth--;
      }
    });
  }

  /**
   * Non-zero while a control is being activated by ENTER or SPACE through
   * `enableKeyActivation`, so an action reached that way can move focus onto
   * what it revealed. A pointer user's focus is left where they put it.
   */
  var keyboardActivationDepth = 0;

  function activatedByKeyboard() {
    return keyboardActivationDepth > 0;
  }

  /**
   * Move focus onto the control an action has just revealed.
   *
   * Every control in the comment widget's action set lives either inside a
   * container its own handler then hides, or inside a dropdown the framework
   * closes and marks `aria-hidden`. Leaving focus there sends the document's
   * focus to <body>, so a keyboard user loses their place and starts again at
   * the top of the tab order; the browser also refuses to apply `aria-hidden`
   * while a descendant holds focus, and reports that refusal. Handing focus to
   * the control the action reveals resolves both, and lands the user on
   * whatever a pointer user would look at next.
   *
   * @param {jQuery|String} target the control to focus, or a selector for it
   */
  function focusRevealedControl(target) {
    var $target = $(target).filter(':visible').first();

    if ($target.length && typeof $target[0].focus === 'function') {
      $target[0].focus();
    }
  }

  /**
   * Escape a value for interpolation into markup.
   *
   * `utils.template` compiles a template by concatenating raw strings, so
   * every value it interpolates reaches the document as markup rather than as
   * text. That utility is shared by templates all over the application and
   * cannot be made escaping without changing unrelated rendering, so the
   * escaping is applied here, to the values this widget supplies.
   *
   * `&` is replaced first: doing it later would re-escape the ampersands
   * introduced by the replacements before it and produce `&amp;lt;`.
   *
   * @param {*} value the value to escape; null and undefined become ""
   * @return {String} the value, safe to interpolate into element content, a
   *         double- or single-quoted attribute, or a <textarea> body
   */
  function escapeHtml(value) {
    if (value === null || value === undefined) {
      return "";
    }

    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * Render a comment's text as the markup a comment card displays.
   *
   * Comment bodies keep their line breaks when displayed, which is why the
   * text is turned into markup at all. Escaping has to happen first and the
   * line breaks second: escaping afterwards would turn the `<br />` this
   * function just inserted into visible text, and inserting the breaks first
   * would leave any markup in the comment body live.
   *
   * @param {String} text the comment body as the author typed it
   * @return {String} escaped markup with newlines rendered as line breaks
   */
  function commentTextToHtml(text) {
    return escapeHtml(text).replace(/(?:\r\n|\r|\n)/g, '<br />');
  }

  /**
   * Declare a rendered comment card's options trigger as a popup control.
   *
   * The trigger opens the `f-dropdown` list named by its `data-dropdown`
   * attribute. The template gives it a role, a name and `aria-controls`, but
   * nothing says the control opens a popup and nothing states whether that
   * popup is open, so its accessible node is identical whether the list is
   * showing or not. `aria-haspopup` is fixed for the control's lifetime;
   * `aria-expanded` starts at "false" — the list is closed when the card is
   * rendered — and is kept in step by the framework on open and close and by
   * `closeCommentDropdown` on the paths the framework does not see.
   *
   * @param {Element|jQuery} root the rendered comment card
   */
  function initCommentDropdownTrigger(root) {
    $(root).find('a.comment-actions[data-dropdown]').attr({
        'aria-haspopup' : 'true'
      , 'aria-expanded' : 'false'
    });
  }

  /**
   * Close a comment card's options dropdown and restate its trigger.
   *
   * Two of the dropdown's own items — Edit comment and Remove comment — reveal
   * a panel and hide the trigger, without closing the list: the framework's
   * click-out handler returns early for a click inside the dropdown content,
   * so the list stays open and its trigger stays marked expanded while it is
   * not even displayed. When the trigger comes back it is still marked
   * expanded over a list that is no longer showing. Every close and commit
   * path therefore comes through here.
   *
   * The framework is only asked to close a list that is actually open: calling
   * into it otherwise would initialise the dropdown library as a side effect
   * of a state fix. `aria-expanded` is written directly as well, so the state
   * is correct even where that call is a no-op.
   *
   * @param {String} commentId the comment whose dropdown to close
   */
  function closeCommentDropdown(commentId) {
    var $content = $('#comment-actions-' + commentId);

    if ($content.length && ($content.hasClass('open') || $content.hasClass('f-open-dropdown'))) {
      $(document).foundation('dropdown', 'close', $content);
    }

    $("a[data-dropdown='comment-actions-" + commentId + "']").attr('aria-expanded', 'false');
  }

  /**
   * Keep a comment dropdown's trigger in step when the framework closes the
   * list without us asking it to.
   *
   * Dismissing the list by clicking anywhere else on the page is the framework's
   * own path, not one of ours, and on that path it cannot restate the right
   * trigger: its document-click handler closes every dropdown on the page in a
   * single multi-element call, while its `close()` resolves the trigger from
   * `dropdown[0].id` — the first element of that set — for every element it
   * iterates. The embed page carries four dropdowns, so the brand menu's
   * trigger is marked collapsed four times and a comment's trigger is never
   * touched. It is then left announcing an expanded popup over a list that has
   * been moved off screen and marked hidden.
   *
   * The same loop does announce each element it actually closes, so listening
   * for that gives us the element the framework got wrong and we restate its
   * trigger from the element's own id. This is bound once, at load, delegated
   * from the document: the triggers come and go with their comment cards, and
   * the shared framework file stays untouched.
   *
   * The namespace is ours rather than the framework's, and that is the whole
   * reason this works. The dropdown library begins its own setup with
   * `off('.dropdown')` on the document, and jQuery reads `closed.fndtn.dropdown`
   * as carrying a `dropdown` namespace token — so a listener registered under
   * the framework's own event name is torn off again a few milliseconds after
   * load, before it can ever run, and the setup repeats that several times
   * during initialisation. Its `close()` fires a bare `closed` on the element
   * immediately before the namespaced one, so binding to `closed` under a
   * private namespace catches the same moment and survives the teardown.
   * `closed` is also fired by the modal library, which is why this stays
   * delegated behind a selector no modal can match.
   */
  $(document).on('closed.trinket-comment-aria', "[id^='comment-actions-']", function() {
    if (this.id) {
      $("a[data-dropdown='" + this.id + "']").attr('aria-expanded', 'false');
    }
  });

  /**
   * Cache key for a fetched documentation fragment.
   *
   * Info URLs are built through `trinketConfig.prefix()`, which stamps
   * `Date.now()` into the path whenever no static asset prefix is configured.
   * Keying the cache on the raw URL therefore never hits, so moving the caret
   * back onto the same keyword re-fetches an identical document every time and
   * leaves a dead cache entry behind. Stripping the generated prefix segment
   * gives one stable key per document.
   *
   * @param {String} url the request URL
   * @return {String} a key that is stable across cache-busting prefixes
   */
  function infoCacheKey(url) {
    return String(url).replace(/^.*?\/(?=partials\/)/, '');
  }

  // by id
  var WIDGET_CACHE      = {};
  var COMMENT_COLLAPSED = {};

  // by file and position
  var FILE_WIDGETS      = [];

  // default tabSize
  var DEFAULT_TAB_SIZE  = 2;

  /**
   * Monotonic source of ids for Ace's hidden input, one per editor built in
   * this document. It never decreases and is never derived from a file's
   * position, so an id is not reissued to a second live editor after a file
   * is deleted and another added in its place.
   */
  var ACE_INPUT_SEQUENCE = 0;

  /**
   * Monotonic source of ids for the keyword-documentation region, so the
   * expander's `aria-controls` can point at it. Counted for the same reason
   * as above: more than one editor can live in one document.
   */
  var INFO_REGION_SEQUENCE = 0;

  /*
   * Helper function to make sure the line numbers are always
   * kept up to the current system
   */
  function fillOutLines(codeLines, h, lineNo, selectedLine){
    var max = 100;
    while ( --max > 0 && (codeLines.height() - h ) <= 0 ){
      if ( lineNo == selectedLine )
        codeLines.append("<div class='lineno lineselect _lineno_" + lineNo + "_' role='presentation'>" + lineNo + "</div>");
      else
        codeLines.append("<div class='lineno _lineno_" + lineNo + "_' role='presentation'>" + lineNo + "</div>");

      lineNo++;
    }
    return lineNo;
  };

  var mobileCommands    = {};
  var mobileCommandsMap = {
    'Enter' : {
      keyCodes : [10,13]
    },
    'Ctrl'  : 'ctrlKey',
    'Shift' : 'shiftKey'
  };

  function createMobileAPI(el, opts) {
    var lineNo   = 1;
    var wrapper  = $(el);
    var textarea = $('<textarea class="lined" autocorrect="off" autocapitalize="off" spellcheck="false" tabindex="0" role="textbox" aria-multiline="true" aria-label="Code Editor"></textarea>');

    textarea.on('focus', function() {
      textarea[0].setSelectionRange(0, 0);
    });

    wrapper.append(textarea);

    /* Turn off the wrapping of as we don't want to screw up the line numbers */
    textarea.attr("wrap", "off");
    textarea.css({resize:'none'});

    /* Wrap the text area in the elements we need */
    textarea.wrap("<div class='linedtextarea' role='tabpanel'></div>");
    var linedTextAreaDiv  = textarea.parent().wrap("<div class='linedwrap'></div>");
    var linedWrapDiv      = linedTextAreaDiv.parent();

    linedWrapDiv.prepend("<div class='lines' aria-hidden='true'></div>");

    var linesDiv  = linedWrapDiv.find(".lines");

    /* Draw the number bar; filling it out where necessary */
    linesDiv.append( "<div class='codelines' data-filename='" + opts.name + "' role='presentation'></div>" );
    var codeLinesDiv  = linesDiv.find(".codelines");
    lineNo = fillOutLines( codeLinesDiv, linesDiv.height(), 1, opts.selectedLine );

    /* Move the textarea to the selected line */
    if ( opts.selectedLine != -1 && !isNaN(opts.selectedLine) ){
      var fontSize = parseInt( textarea.height() / (lineNo-2) );
      var position = parseInt( fontSize * opts.selectedLine ) - (textarea.height()/2);
      textarea[0].scrollTop = position;
    }

    var redraw = _.throttle(function(tn){
      var domTextArea   = textarea[0];
      var scrollTop     = domTextArea.scrollTop;
      var clientHeight  = domTextArea.clientHeight;
      codeLinesDiv.css( {'margin-top': (-1*scrollTop) + "px"} );
      lineNo = fillOutLines( codeLinesDiv, scrollTop + clientHeight, lineNo, opts.selectedLine );
    }, 50);

    /* React to the scroll event */
    textarea.scroll(redraw);

    if (opts.onFocus) {
      textarea.on("focus", opts.onFocus);
    }

    if (opts.value) {
      textarea.val(opts.value, -1);
    }

    /* Should the textarea get resized outside of our control */
    $(window).on('resize', redraw);

    return {
      registerPlugin : function(plugin, codeEditor) {
      },
      destroy : function() {
        linedWrapDiv.remove();
        textarea.remove();
        wrapper.empty();
        $(window).off('resize', redraw);
      },
      addCommand : function(name, key, fn) {
        if (typeof mobileCommands[name] === 'undefined') {
          mobileCommands[name] = {
              key : key
            , fn  : fn
          };
        }

        var keyParts = key.win.split('-');

        if (keyParts.length === 2 || keyParts.length === 3) {
          textarea.keydown(function(e) {
            var callFn = false;
            if (keyParts.length === 2) {
              if (mobileCommandsMap[ keyParts[1] ].keyCodes.indexOf( e.keyCode ) >= 0
              &&  e[ mobileCommandsMap[ keyParts[0] ] ]) {
                callFn = true;
              }
            }
            else if (keyParts.length === 3) {
              if (mobileCommandsMap[ keyParts[2] ].keyCodes.indexOf( e.keyCode ) >= 0
              &&  e[ mobileCommandsMap[ keyParts[0] ] ]
              &&  e[ mobileCommandsMap[ keyParts[1] ] ]) {
                callFn = true;
              }
            }

            if (callFn) {
              fn.call();
            }
          });
        }

        return;
      },
      change : function(cb) {
        return textarea.on('input propertychange', cb);
      },
      setValue : function(value) {
        textarea.val(value, -1);
      },
      getValue : function() {
        return textarea.val();
      },
      focus : function(position) {
        if (position !== 'undefined') {
          textarea.focus();
          return textarea[0].setSelectionRange(position, 0);
        }
        else {
          return textarea.focus();
        }
      },
      blur : function() {
        return textarea.blur();
      },
      isFocused : function() {
        return textarea.is(":focus");
      },
      setModeFromName : function(name) {},
      resize: function() {},
      highlight: function(line_num) {
        $('.codelines[data-filename="' + opts.name + '"]').find('._lineno_' + line_num + '_').addClass('lineselect');
        $('textarea.lined').addClass('attention-error');
      },
      addQueueMarkers : function() {}
    };
  }

  /**

   Mostly the same as the ace version with some specific UI elements and internal data synchronization.

   TODO / BUGS:

   -- a comment is removed by nature of a line being removed, need some method to undo

   */
  function updateOnChange(onCommentChange, onCommentRemove, fileIndex, delta) {
    var lineWidgets = this.getSession().lineWidgets
      , startRow    = delta.start.row
      , len         = delta.end.row - startRow
      , startLine, startLineLen;

    if (len === 0) return;

    startLine    = this.getSession().getLine(delta.start.row);
    startLineLen = startLine.length;

    if (lineWidgets) {
      if (delta.action == 'remove') {
        if (!delta.start.column && FILE_WIDGETS[fileIndex][delta.start.row + 1]) {
          startRow--;
        }

        var removedVisible = lineWidgets.splice(startRow + 1, len);
        var removedAll     = FILE_WIDGETS[fileIndex].splice(startRow + 1, len);

        removedVisible.forEach(function(w) {
          if (w) {
            this.removeLineWidget(w);
          }
        }, this.getSession().widgetManager);

        removedAll.forEach(function(w) {
          if (w) {
            delete WIDGET_CACHE[ w._commentId ];
            onCommentRemove({
                _id   : w._commentId
              , index : w._file
            });
            this.removeGutterDecoration(w.row, "trinket-comment");
            this.removeGutterDecoration(w.row, "data-" + w._file + "-" + w._commentId);
            if (COMMENT_COLLAPSED[w._commentId]) {
              this.removeGutterDecoration(w.row, "collapsed");
            }
            else {
              this.removeGutterDecoration(w.row, "open");
            }
          }
        }, this.getSession());
      }
      else {
        // if starting line has content and cursor is at the end of the line,
        // increment startRow so that the comment on this line doesn't move down
        if (startLineLen && startLineLen === delta.start.column) {
          startRow++;
        }

        var args = new Array(len);
        args.unshift(startRow, 0);
        lineWidgets.splice.apply(lineWidgets, args);
        FILE_WIDGETS[fileIndex].splice.apply(FILE_WIDGETS[fileIndex], args);
      }

      var noWidgets = true;
      FILE_WIDGETS[fileIndex].forEach(function(w, i) {
        if (w) {
          noWidgets = false;
          if (w.row !== i) {
            // onCommentChange changes the internal w.row
            onCommentChange(w._file, w._commentId, i, true);
          }
        }
      });
      if (noWidgets) {
        this.getSession().lineWidgets = null;
      }
    } // end if line widgets
    else {
      if (delta.action == 'remove') {
        if (!delta.start.column && FILE_WIDGETS[fileIndex][delta.start.row + 1]) {
          startRow--;
        }

        var removed = FILE_WIDGETS[fileIndex].splice(startRow + 1, len);
        removed.forEach(function(w) {
          if (w) {
            delete WIDGET_CACHE[ w._commentId ];
            onCommentRemove({
                _id   : w._commentId
              , index : w._file
            });
            this.removeGutterDecoration(w.row, "trinket-comment");
            this.removeGutterDecoration(w.row, "data-" + w._file + "-" + w._commentId);
            if (COMMENT_COLLAPSED[w._commentId]) {
              this.removeGutterDecoration(w.row, "collapsed");
            }
            else {
              this.removeGutterDecoration(w.row, "open");
            }
          }
        }, this.getSession());
      }
      else {
        if (startLineLen && startLineLen === delta.start.column) {
          startRow++;
        }

        var args = new Array(len);
        args.unshift(startRow, 0);
        FILE_WIDGETS[fileIndex].splice.apply(FILE_WIDGETS[fileIndex], args);
      }

      FILE_WIDGETS[fileIndex].forEach(function(w, i) {
        if (w && w.row !== i) {
          onCommentChange(w._file, w._commentId, i, true);
        }
      });
    }
  }

  function createDesktopAPI(el, opts) {
    var modes          = ace.require('ace/ext/modelist')
        , mode         = modes.getModeForPath('foo.' + opts.ext)
        , Range        = ace.require('ace/range').Range
        , LineWidgets  = ace.require('ace/line_widgets').LineWidgets
        , dom          = ace.require("ace/lib/dom")
        , e            = ace.edit(el)
        , queueMarkers = []
        , errorMarkers = []
        , userInfo     = {};

    e.$blockScrolling = Infinity;
    e.setTheme("ace/theme/xcode");
    e.getSession().setMode(mode ? mode.mode : "ace/mode/text");
    e.getSession().setUseSoftTabs(true);

    // fail safe
    if (opts.editorOpts) {
      e.getSession().setTabSize(opts.editorOpts.tabSize);
      e.getSession().setUseWrapMode(opts.editorOpts.lineWrapping);
    } else {
      e.getSession().setTabSize(DEFAULT_TAB_SIZE);
    }

    e.setShowPrintMargin(false);
    e.setFontSize('inherit');
    e._fileName = opts.name;
    e._addErrorBorder = false;

    // View-only surfaces (the assignment "view only" variant) must not accept
    // edits. The flag is latched rather than applied once, because the
    // selection handler below toggles read-only for comment protection and
    // would otherwise clear it on the first selection change.
    var viewOnlyLocked = !!(opts.editorOpts && opts.editorOpts.assignmentViewOnly);

    if (viewOnlyLocked) {
      e.setReadOnly(true);
    }

    /**
     * Name the editor for assistive technology and advertise the way out.
     *
     * Ace routes every keystroke through a 1px, transparent textarea. Left as
     * the library creates it, that textarea has no id, no name and no
     * accessible name, so it is announced as an anonymous edit field. TAB is
     * bound to Ace's `indent` command, so the escape route has to be stated in
     * the name itself for the editor not to read as a keyboard trap.
     */
    (function nameEditorForAssistiveTech() {
      var input = e.textInput && e.textInput.getElement ? e.textInput.getElement() : null
        , label = 'Code editor' + (opts.name ? ', ' + opts.name : '')
        // Both exit keys are named, and so is the direction each one takes,
        // because they are not interchangeable: Escape goes back to the file
        // tab and F6 goes on to the next control after the editor. A user who
        // only knew about Escape could never move forwards past the editor.
        , description = viewOnlyLocked
            ? label + ' (read only). Press Escape to go back to the file tab, or F6 to move on past the editor.'
            : label + '. Press Escape to go back to the file tab, or F6 to move on past the editor. Tab inserts indentation.';

      if (input) {
        // A unique id/name per editor keeps the field addressable when
        // several files are open at once. It is counted rather than derived
        // from the file's position in the array: positions are reused after a
        // deletion, so an index-derived id collides with a live editor as
        // soon as one file is removed and another added — two fields sharing
        // an id, with getElementById resolving to the hidden one.
        if (!input.id) {
          input.id = 'ace-editor-input-' + (++ACE_INPUT_SEQUENCE);
        }
        if (!input.name) {
          input.name = input.id;
        }
        input.setAttribute('aria-label', description);
        if (viewOnlyLocked) {
          input.setAttribute('aria-readonly', 'true');
        }
      }

      // `role=group` names the visible editor region without claiming to be
      // the input itself, which remains the textarea above.
      el.setAttribute('role', 'group');
      el.setAttribute('aria-label', label);
    })();

    /**
     * Escape hatch out of the editor.
     *
     * Ace 1.4.14 ships no blur/exit command and does not support the later
     * `enableKeyboardAccessibility` option, so TAB, Shift+TAB, ESCAPE and F6
     * all leave focus inside the editor: TAB and Shift+TAB silently indent and
     * outdent the buffer instead of moving on. Binding ESCAPE and F6 to move
     * focus out of the editor restores a way out by keyboard and leaves the
     * buffer untouched. TAB keeps indenting, which is what a code editor is
     * expected to do and what the accessible name now announces.
     *
     * The two keys leave in opposite directions, and the difference matters.
     * ESCAPE goes back to the file tab, which is the control the user most
     * likely came from. F6 goes forward to the first control after the editor,
     * because the editor sits in the middle of the document: an exit that only
     * ever went backwards would leave everything below it — the instructions
     * tab, the output pane's controls, the page footer — reachable only by
     * tabbing backwards through the whole document and wrapping around.
     *
     * @param {Boolean} forward true to leave forwards, false to go back
     */
    function exitEditor(editor, forward) {
      var $container = $(el).closest('.code-editor')
        , $target    = forward
            ? firstFocusableAfter($container.get(0))
            : $container.find('.tab.active .file-tab-link').first();

      editor.blur();

      if ($target && $target.length && typeof $target[0].focus === 'function') {
        $target[0].focus();
        return;
      }

      if (typeof el.focus === 'function') {
        // Nothing to hand focus to in that direction — no tab bar on this
        // surface, or the editor is the last control on the page. Fall back to
        // the editor region itself, which is focusable only for this purpose,
        // so focus never lands on the document body.
        el.setAttribute('tabindex', '-1');
        el.focus();
      }
    }

    /**
     * The first control a forward TAB would reach if the editor were not
     * swallowing TAB.
     *
     * Walks the document's focusable elements in order and returns the first
     * one that lies after the given container and can actually take focus.
     * Visibility is decided by measurement rather than by the `tabindex`
     * attribute, because several controls on these surfaces are href-less
     * anchors that are off-canvas or hidden until their panel opens.
     *
     * @param {Element} container the region to step past
     * @return {jQuery|null} the control, or null if the container is last
     */
    function firstFocusableAfter(container) {
      var candidates, i, node;

      if (!container || !document.compareDocumentPosition) {
        return null;
      }

      candidates = document.querySelectorAll('a, button, input, select, textarea, [tabindex]');

      for (i = 0; i < candidates.length; i++) {
        node = candidates[i];

        // DOCUMENT_POSITION_FOLLOWING (4) with CONTAINED_BY (16) unset: the
        // node comes after the container and is not inside it.
        if (!(container.compareDocumentPosition(node) & 4)) {
          continue;
        }
        if (container.contains(node)) {
          continue;
        }
        if (node.disabled || node.getAttribute('tabindex') === '-1') {
          continue;
        }
        if (!node.offsetWidth && !node.offsetHeight) {
          continue;
        }
        if ($(node).closest('[aria-hidden="true"]').length) {
          continue;
        }

        return $(node);
      }

      return null;
    }

    e.commands.addCommand({
        name    : 'exitEditor'
      , bindKey : { win : 'Esc', mac : 'Esc' }
      , exec    : function(editor) { exitEditor(editor, false); }
      , readOnly: true
    });

    e.commands.addCommand({
        name    : 'exitEditorRegion'
      , bindKey : { win : 'F6', mac : 'F6' }
      , exec    : function(editor) { exitEditor(editor, true); }
      , readOnly: true
    });

    var deleteCommand     = e.commands.byName.del;
    var backspaceCommand  = e.commands.byName.backspace;
    var removelineCommand = e.commands.byName.removeline;

    function showCommentWarning(message) {
      // make sure any existing alert is closed
      $('.comment-warning').find('.close').click();
      $(el).append(COMMENT_WARNING_TEMPLATE({
        message : message
      }));
      $(document).foundation('alert', 'reflow');
    }

    function keydownHandler(event) {
      // don't show message if keycode between 16 and 20
      // these are various keys such as ctrl, alt, shift, caps lock, etc.
      if (event.which >= 16 && event.which <= 20) {
        return;
      }

      showCommentWarning('Since one or more selected lines has a comment, first remove any comments or move them to other lines.');
    }

    e.commands.addCommand({
        name    : backspaceCommand.name
      , bindKey : backspaceCommand.bindKey
      , exec    : function(editor) {
          var cursor = editor.getSession().selection.getCursor();

          // if comment on this row and previous row or previous row has content, disable backspace
          if (cursor.column === 0 && cursor.row > 0
          && FILE_WIDGETS[opts.index] && FILE_WIDGETS[opts.index][cursor.row]
          && (FILE_WIDGETS[opts.index][cursor.row - 1] || editor.getSession().getLine(cursor.row - 1).length)) {
            showCommentWarning('Since this line has a comment, first remove the comment or move it to another line.');
          }
          else {
            $('.comment-warning').find('.close').click();
            backspaceCommand.exec.call(this, editor);
          }
        }
    });

    e.commands.addCommand({
        name    : deleteCommand.name
      , bindKey : deleteCommand.bindKey
      , exec    : function(editor) {
          var cursor     = editor.getSession().selection.getCursor()
            , lineLength = editor.getSession().getLine(cursor.row).length;

          // if cursor at end of line and comment on this or next line
          if (cursor.column === lineLength && FILE_WIDGETS[opts.index]) {
            if (FILE_WIDGETS[opts.index][cursor.row]) {
              showCommentWarning('Since this line has a comment, first remove the comment or move it to another line.');
            }
            else if (FILE_WIDGETS[opts.index][cursor.row + 1]) {
              showCommentWarning('Since the next line has a comment, first remove the comment or move it to another line.');
            }
          }
          else {
            $('.comment-warning').find('.close').click();
            deleteCommand.exec.call(this, editor);
          }
        }
    });

    e.commands.addCommand({
        name    : removelineCommand.name
      , bindKey : removelineCommand.bindKey
      , exec    : function(editor) {
          var cursor = editor.getSession().selection.getCursor();

          // if comment on this line, disable removeline command (Ctrl-D)
          if (FILE_WIDGETS[opts.index] && FILE_WIDGETS[opts.index][cursor.row]) {
            showCommentWarning('To remove lines with comments, first remove the comment or move it to another line.');
          }
          else {
            $('.comment-warning').find('.close').click();
            removelineCommand.exec.call(this, editor);
          }
        }
    });

    // remove any notifications when the cursor moves
    e.getSession().selection.on("changeCursor", function() {
      $('.comment-warning').find('.close').click();
    });

    // check for comments when lines are selected
    e.getSession().selection.on("changeSelection", function(event) {
      // On a view-only surface the editor is already read-only for every
      // line, so the comment-protection toggle has nothing to add and must not
      // run: its else-branch clears read-only unconditionally.
      if (viewOnlyLocked) {
        return;
      }

      if (FILE_WIDGETS[opts.index] && !e.getSession().selection.isEmpty() && e.getSession().selection.isMultiLine()) {
        var range  = e.getSession().selection.getRange()
          , set_ro = false
          , row;

        for (row = range.start.row; row <= range.end.row; row++) {
          if (FILE_WIDGETS[opts.index][row]) {
            set_ro = true;
          }
        }

        e.setReadOnly(set_ro);

        if (set_ro) {
          // if read only and keydown handler not bound...
          if (!$(e.textInput.getElement()).data('keydown-handler')) {
            $(e.textInput.getElement()).on('keydown.trinket-comment', keydownHandler);
            $(e.textInput.getElement()).data('keydown-handler', true);
          }
        }
        else {
          // else unbind keydown handler if bound
          if ($(e.textInput.getElement()).data('keydown-handler')) {
            $(e.textInput.getElement()).off('keydown.trinket-comment', keydownHandler);
            $(e.textInput.getElement()).removeData('keydown-handler');
          }
          $('.comment-warning').find('.close').click();
        }
      }
      else {
        e.setReadOnly(false);
        if ($(e.textInput.getElement()).data('keydown-handler')) {
          $(e.textInput.getElement()).off('keydown.trinket-comment', keydownHandler);
          $(e.textInput.getElement()).removeData('keydown-handler');
        }
        $('.comment-warning').find('.close').click();
      }
    });

    if (opts.value) {
      e.getSession().setValue(opts.value);
    }

    if (opts.onFocus) {
      e.on("focus", opts.onFocus);
    }

    // apply and render existing comments
    if (opts.comments && opts.comments.length) {
      var getUserInfo = function(userId) {
        if (userInfo[userId]) {
          return $.Deferred().resolve(userInfo[userId]).promise();
        }
        else {
          return $.get("/api/users/" + userId + "/info");
        }
      }

      var session = e.session;
      if (!session.widgetManager) {
        session.widgetManager = new LineWidgets(session, {
          updateOnChange : updateOnChange.bind(e, opts.onCommentChange, opts.onCommentRemove, opts.index)
        });
        session.widgetManager.attach(e);
      }

      var docLength = session.getDocument().getLength();

      function renderComment(comment) {
        var commentText    = comment.text
          // The comment body is authored by another user and is rendered
          // through innerHTML below, so it is escaped before its line breaks
          // are turned into markup.
          , commentHtml    = commentTextToHtml(commentText)
          , commentedOn    = moment(comment.commentedOn).fromNow()
          , row            = comment.row
          , commentId      = comment._id
          , index          = comment.index
          , edited         = comment.edited ? "(edited)" : ""
          , collapsed      = COMMENT_COLLAPSED[commentId] = comment.collapsed || false
          , commentActions, commentActionsTemplate, commentSeed;

        if (opts.editorOpts.canAddInlineComments && opts.editorOpts.userId === comment.userId) {
          commentActionsTemplate = "inlineCommentActions";
        }
        else if (!opts.editorOpts.assignmentViewOnly) {
          commentActionsTemplate = "inlineCommentDismiss";
        }

        commentActions = template(commentActionsTemplate, {
            commentId    : commentId
          , index        : index
        });

        return $.when(getUserInfo(comment.userId)).done(function(_user) {
          // TODO: figure out caching - this doesn't work
          userInfo[comment.userId] = _user;

          // Everything interpolated here reaches the document as markup, so
          // the values that come from a user — the author's name, the avatar
          // URL that is interpolated into an attribute, and the body in both
          // its rendered and its editable form — are escaped. `commentText`
          // is escaped because it is interpolated inside a <textarea>, where
          // a literal `</textarea>` would otherwise break out of the field;
          // the browser decodes the entities again when the value is read.
          var commentTmpl = template('inlineCommentTemplate', {
              comment        : commentHtml
            , avatar         : escapeHtml(_user.avatar)
            , commentedOn    : commentedOn
            , username       : escapeHtml(_user.username)
            , commentId      : commentId
            , edited         : edited
            , commentText    : escapeHtml(commentText)
            , commentActions : commentActions
          });

          var _el = dom.createElement("div");
          _el.innerHTML = commentTmpl;

          // The card's options trigger opens a dropdown; say so, and start it
          // in its closed state.
          initCommentDropdownTrigger(_el);

          var w = {
              row        : row
            , fixedWidth : true
            , el         : _el
            , _file      : index
            , _commentId : commentId
            , _text      : commentText
          };

          w.destroy = function() {
            session.widgetManager.removeLineWidget(w);
            FILE_WIDGETS[index][row] = undefined;
          }

          if (!collapsed) {
            w = e.session.widgetManager.addLineWidget(w);
          }

          WIDGET_CACHE[commentId] = w;
          if (!FILE_WIDGETS[index]) {
            FILE_WIDGETS[index] = [];
          }
          FILE_WIDGETS[index][row] = w;

          // add comment style
          e.session.addGutterDecoration(row, "trinket-comment");

          if (collapsed) {
            e.session.addGutterDecoration(row, "collapsed");
          }
          else {
            e.session.addGutterDecoration(row, "open");
          }

          // adds data for expanding/collapsing
          e.session.addGutterDecoration(row, "data-" + index + "-" + commentId);

          $(w.el).find('.confirm-remove-comment').on('click', function(event) {
            w.destroy();
          });
        });
      } // renderComment

      var promises = [];
      for (var i = 0; i < opts.comments.length; i++) {
        promises.push(renderComment(opts.comments[i]));
      }

      // update move arrows
      $.when.apply($, promises).then(function() {
        updateCommentArrows(session, opts.index);
      });

    } // end if comments

    return {
      actuallySetWrap: function(wrap) {
        e.getSession().setUseWrapMode(wrap)
      },
      actuallySetIndent: function(indent) {
        e.getSession().setTabSize(indent)
      },
      registerPlugin : function(plugin, codeEditor) {
        plugin.initialize(e, codeEditor);
      },
      destroy : function() {
        e.destroy();
        $(el).empty();
      },
      addCommand : function(name, key, fn) {
        e.commands.addCommand({
          name: name,
          bindKey: key,
          exec: fn
        });
      },
      change : function(cb) {
        var self = this;
        return e.getSession().on('change', function() {
          self.removeMarkers();
          cb();
        });
      },
      setValue : function(value) {
        e.setValue(value, -1);
      },
      getValue : function() {
        return e.getValue();
      },
      focus : function(position) {
        if (position === 0) {
          e.navigateFileStart()
        }
        else if (position === -1) {
          e.navigateFileEnd();
        }

        return e.focus();
      },
      blur : function() {
        e.blur();
      },
      isFocused : function() {
        return e.isFocused();
      },
      setModeFromName : function(name) {
        var mode = modes.getModeForPath(name);
        var old  = e._fileName;
        e._fileName = name;
        e._emit("file.rename", {oldName:old, newName:name});
        e.getSession().setMode(mode ? mode.mode : "ace/mode/text");
      },
      resize: function(force) {
        e.resize(force);
      },
      highlight: function(line_num, queue) {
        var line  = e.getSession().getLine(line_num - 1);
        if (queue) {
          queueMarkers.push(line_num);
          e._addErrorBorder = true;
        }
        else {
          var range = new Range(line_num - 1, 0, line_num - 1, line.length);
          errorMarkers.push(e.getSession().addMarker(range, 'highlight-line-error', 'fullLine'));
          $('.ace_content').addClass('attention-error');
        }
      },
      addQueueMarkers : function() {
        for (var i = 0; i < queueMarkers.length; i++) {
          this.highlight(queueMarkers[i]);
        }
        queueMarkers = [];
        if (e._addErrorBorder) {
          $('.ace_content').addClass('attention-error');
          e._addErrorBorder = false;
        }
      },
      removeMarkers : function() {
        for (var i = 0; i < errorMarkers.length; i++) {
          e.getSession().removeMarker(errorMarkers[i]);
        }
        errorMarkers = [];
        queueMarkers = [];
      },
      getSession : function() {
        return e.getSession();
      },
      setReadOnly: function(readOnly) {
        // A view-only surface stays read-only whatever a caller asks for.
        e.setReadOnly(viewOnlyLocked ? true : readOnly);
      },
      scrollToLine : function(line, center, animate, callback) {
        e.scrollToLine(line, center, animate, callback);
      },
      aceInstance: e,
      renderer: e.renderer,
      keyBinding : e.keyBinding,
      addCommentWidget : function() {
        var userId    = this.options.userId
          , avatarSrc = '/api/users/' + userId + '/avatar'
          , username  = $('#whoami').val()
          , userInfo  = '/api/users/' + userId + '/info'
          , index     = opts.index
          , curPos, curWidget, session, _el, w, $textarea;

        curPos    = e.getCursorPosition();
        curWidget = _.findKey(WIDGET_CACHE, function(widget) {
          return widget.row === curPos.row && widget._file === index;
        });

        if (curWidget) {
          // trigger edit of current comment
          if (COMMENT_COLLAPSED[curWidget]) {
            // trigger open first if collapsed
            $("div.ace_gutter-cell.trinket-comment.data-" + index + "-" + curWidget).trigger("click");
          }
          $("a.edit-inline-comment[data-comment-id='" + curWidget + "']").trigger("click");
          return;
        }

        // add new comment
        session = e.session;
        if (!session.widgetManager) {
          session.widgetManager = new LineWidgets(session, {
            updateOnChange : updateOnChange.bind(e, opts.onCommentChange, opts.onCommentRemove, index)
          });
          session.widgetManager.attach(e);
        }

        e.scrollToLine(curPos.row, true, true);

        _el = dom.createElement("div");
        // The avatar URL lands in an attribute and the name in element
        // content, both through a template that concatenates raw strings.
        _el.innerHTML = template('addInlineCommentTemplate', {
            avatar    : escapeHtml(avatarSrc)
          , username  : escapeHtml(username)
          , commentId : index + "_" + curPos.row
          , index     : index
        });

        w = {
            row        : curPos.row
          , fixedWidth : true
          , el         : _el
          , _file      : index
          , _commentId : index + "_" + curPos.row
        };

        w.destroy = function() {
          session.widgetManager.removeLineWidget(w);
          delete WIDGET_CACHE[w._commentId];
          updateCommentArrows(session, w._file);
        }

        w = session.widgetManager.addLineWidget(w);
        WIDGET_CACHE[w._commentId] = w;

        updateCommentArrows(session, index);

        $textarea = $(w.el).find('textarea.inline-comment-text');
        $textarea.focus();

        // Destroying the widget removes the element that holds focus, which
        // otherwise leaves the document focused on <body> and drops a keyboard
        // user back to the start of the tab order. Hand focus back to the
        // control that opened the widget instead.
        function returnFocusToCommentTrigger() {
          var $trigger = $(el).closest('.code-editor').find('.add-inline-comment').first();

          if ($trigger.length && typeof $trigger[0].focus === 'function') {
            $trigger[0].focus();
          }
        }

        $(w.el).find('.cancel-inline-comment').on('click', function(event) {
          // TODO: confirm if some text entered?
          w.destroy();
          returnFocusToCommentTrigger();
        });

        $(w.el).find('.save-inline-comment').on('click', function(event) {
          var commentText  = $textarea.val();
          // Escaped before the line breaks become markup: the text the author
          // just typed is rendered through innerHTML below.
          var commentHtml  = commentTextToHtml(commentText);
          var commentedOn  = moment().subtract(2, 'seconds');
          var commentSeed  = e._fileName + w.row + commentedOn;
          var commentId    = CryptoJS.MD5(commentSeed).toString(CryptoJS.enc.Hex).substring(0, 16)

          var commentActions = template('inlineCommentActions', {
              commentId    : commentId
            , index        : index
          });

          // Same escaping as the render path above: the name and avatar URL
          // are interpolated into markup, and `commentText` is interpolated
          // inside a <textarea> whose value the browser decodes on read.
          var commentTmpl = template('inlineCommentTemplate', {
              comment        : commentHtml
            , avatar         : escapeHtml(avatarSrc)
            , username       : escapeHtml(username)
            , commentedOn    : commentedOn.fromNow()
            , commentText    : escapeHtml(commentText)
            , commentActions : commentActions
            , commentId      : commentId
          });

          var _el = dom.createElement("div");
          _el.innerHTML = commentTmpl;

          // Same declaration as the render path above: the card that has just
          // been saved carries the same options trigger.
          initCommentDropdownTrigger(_el);

          $(document).foundation('dropdown', 'reflow');

          var cw = {
              row        : w.row
            , fixedWidth : true
            , el         : _el
            , _file      : index
            , _commentId : commentId
            , _text      : commentText
          };

          cw.destroy = function() {
            session.widgetManager.removeLineWidget(cw);
            FILE_WIDGETS[index][cw.row] = undefined;
          }

          w.destroy();

          cw = e.session.widgetManager.addLineWidget(cw);

          e.session.addGutterDecoration(cw.row, "trinket-comment");
          e.session.addGutterDecoration(cw.row, "open");
          e.session.addGutterDecoration(cw.row, "data-" + index + "-" + commentId);

          WIDGET_CACHE[commentId]      = cw;
          COMMENT_COLLAPSED[commentId] = false;
          if (!FILE_WIDGETS[index]) {
            FILE_WIDGETS[index] = [];
          }
          FILE_WIDGETS[index][cw.row] = cw;

          updateCommentArrows(session, index);

          $(el).trigger("comment.added", {
              row         : cw.row
            , text        : commentText
            , commentedOn : commentedOn
            , _id         : commentId
            , fileName    : e._fileName
            , index       : opts.index
            , userId      : userId
            , edited      : false
            , collapsed   : false
          });

          $(el).find('.confirm-remove-comment').on('click', function(event) {
            cw.destroy();
          });

          returnFocusToCommentTrigger();
        });
      }
    };
  }

  function createGhostAPI(el, opts) {
    var api = {
      value : opts.value
    };
    return {
      registerPlugin : function(plugin, codeEditor) {
      },
      destroy : function() {
        return;
      },
      addCommand : function(name, key, fn) {
        return;
      },
      change : function(cb) {
        cb();
      },
      setValue : function(value) {
        api.value = value;
        return value;
      },
      getValue : function() {
        return api.value;
      },
      focus : function() {
        return;
      },
      blur : function() {
        return;
      },
      isFocused : function() {
        return false;
      },
      setModeFromName : function(name) {},
      resize : function() {},
      highlight: function(line_num) {},
      addQueueMarkers : function() {}
    };
  }

  function createImageAPI(el, opts) {
    var $img;

    var api = {
      value : opts.value
    };

    // add img tag with opts.value as src to el
    $img = $('<img />', {
      src : opts.value
    });

    $(el).html($img);

    return {
      registerPlugin : function(plugin, codeEditor) {
      },
      destroy : function() {
        return;
      },
      addCommand : function(name, key, fn) {
        return;
      },
      change : function(cb) {
        cb();
      },
      setValue : function(value) {
        api.value = value;
        return value;
      },
      getValue : function() {
        return api.value;
      },
      focus : function() {
        return;
      },
      blur : function() {
        return;
      },
      isFocused : function() {
        return false;
      },
      setModeFromName : function(name) {},
      resize : function() {},
      highlight: function(line_num) {},
      addQueueMarkers : function() {}
    };
  }

  var $PLUGIN_TEMPLATE         = $("<div class=\"code-editor\" data-interface=\"code-editor\"><div class=\"tab-nav\"><dl class=\"left-options\"><dd class=\"tab-button\"><a class=\"tab-scroll-link left-arrow highlight-on-focus\" data-direction=\"-1\" role=\"button\" tabindex=\"0\" aria-label=\"Scroll file tabs left\"><i class=\"fa fa-chevron-left\"></i></a></dd><dd class=\"tab-button\"><a class=\"tab-scroll-link right-arrow highlight-on-focus\" data-direction=\"1\" role=\"button\" tabindex=\"0\" aria-label=\"Scroll file tabs right\"><i class=\"fa fa-chevron-right\"></i></a></dd></dl><dl class=\"scrollable-content\" role=\"tablist\" aria-label=\"File tabs\"></dl><dl class=\"right-options\"></dl><div class=\"clearfix\"></div></div><div class=\"file-content-container\"></div><div class=\"info-area collapsed\"><div class=\"info-quick\"></div><div class=\"scroll-wrap\"><div class=\"info-full\"></div></div><a class=\"expander fa highlight-on-focus\" role=\"button\" tabindex=\"0\" aria-label=\"Show more information about the selected keyword\"></a></div></div>");

  var $CONTENT_TEMPLATE        = $("<div class=\"file-content\"></div>");
  var $BINARY_FILE_TEMPLATE    = $("<div class=\"binary-file\"><div><p>This is a binary file created by your program. It is not viewable and will not be saved with your trinket.</p></div></div>");
  var $TAB_OPTIONS_TEMPLATE    = $("<div class=\"tab-options\" role=\"menu\" aria-label=\"File options\"><ul><li><a class=\"file-remove-link menu-button highlight-on-focus\" data-action=\"file.remove\" role=\"menuitem\" tabindex=\"0\" aria-label=\"Delete this file\" title=\"Delete this file\"><i class=\"fa fa-trash\"></i></a></li><li><a class=\"file-rename-link menu-button highlight-on-focus\" data-action=\"file.rename\" role=\"menuitem\" tabindex=\"0\" aria-label=\"Rename this file\" title=\"Rename this file\"><i class=\"fa fa-pencil\"></i></a></li></ul></div>");

  var TAB_TEMPLATE             = template.compile("<dd class=\"tab\"><a class=\"file-tab-link highlight-on-focus\" aria-label=\"{{name}} tab\" role=\"tab\" tabindex=\"0\" aria-selected=\"false\"><span class=\"file-name\">{{name}}</span><span class=\"tab-options-link menu-button highlight-on-focus\" data-action=\"file.options\" role=\"button\" tabindex=\"0\" aria-label=\"Options for {{name}}\"></span></a></dd>");
  var EDITABLE_TAB_TEMPLATE    = template.compile("<input type=\"text\" class=\"file-name-input\" value=\"{{name}}\" placeholder=\"file name\" aria-label=\"Edit {{name}} filename\">");
  var FILE_NAME_ERROR_TEMPLATE = template.compile("<div data-alert class=\"file-name-error alert-box alert\">{{message}}<a class=\"close\">&times;</a></div>");
  // The alert announces itself, because it appears without the user moving
  // focus and it withdraws itself again after fifteen seconds: a screen-reader
  // user who is not told about it never learns that the deletion can be undone
  // at all. Both anchors carry no href, so they need role and tabindex to be
  // operable, and their names have to say which file they act on because the
  // alert can be one of several on screen. `{{name}}` is a file name the user
  // chose, and this template concatenates raw strings, so it is escaped.
  var UNDO_REMOVE_TEMPLATE     = function(data) {
    var name = escapeHtml(data && data.name);

    return "<div data-alert class=\"file-remove-info alert-box info\" data-interface=\"code-editor\" role=\"alert\" aria-live=\"assertive\">"
         + "The file \"" + name + "\" has been deleted. "
         + "<a class=\"file-restore-link menu-button highlight-on-focus\" data-action=\"file.restore\" role=\"button\" tabindex=\"0\" aria-label=\"Undo deleting " + name + "\">Undo</a>"
         + "<a class=\"close menu-button highlight-on-focus\" data-action=\"file-undo.close\" role=\"button\" tabindex=\"0\" aria-label=\"Dismiss the message about deleting " + name + "\">&times;</a>"
         + "</div>";
  };

  var COMMENT_WARNING_TEMPLATE = template.compile("<div data-alert class=\"comment-warning alert-box info\">{{message}}<a class=\"close\"><i class=\"fa fa-times-circle\"></i></a></div>");

  /**
   * HTML-escape a value that is about to be interpolated into one of the
   * compiled templates above.
   *
   * `utils.template` compiles a template into `new Function('o', 'return "..."')`
   * and substitutes each `{{key}}` with a bare `o["key"]` string concatenation,
   * so the engine never escapes the data it interpolates. That is safe for the
   * templates whose values this file controls, but a file name is authored by
   * whoever uploaded or renamed the file and is then persisted with the trinket
   * and re-rendered for every later viewer - so an unescaped name was live HTML
   * in a third party's browser as soon as the trinket (or its embed URL) was
   * opened.
   *
   * The three file-name sinks call this: TAB_TEMPLATE (element body plus the
   * `aria-label` attribute), EDITABLE_TAB_TEMPLATE (the `value` attribute of the
   * rename input) and UNDO_REMOVE_TEMPLATE (element body of the undo notice).
   * Two of the three are attribute values, which is why both quote characters
   * are escaped as well as the three markup characters. `&` is replaced first so
   * that the ampersands introduced by the later replacements are not re-escaped.
   *
   * Non-strings are returned untouched to preserve the engine's own output
   * exactly: `utils.template` emits `''` for `undefined` and the string `"null"`
   * for `null`, and neither can carry markup.
   *
   * @param   {*} value  the value to interpolate, usually a file name
   * @returns {*}        the escaped string, or `value` unchanged if not a string
   */
  function escapeHtml(value) {
    if (typeof value !== 'string') {
      return value;
    }

    return value.replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
  }

  var TAB_CLICK_EVENT         = "click.trinket-code-editor.tab-select";
  var TAB_SCROLL_START_EVENT  = "mousedown.trinket-code-editor.scroll-tabs-start touchstart.trinket-code-editor.scroll-tabs-start";
  var TAB_SCROLL_STOP_EVENT   = "mouseup.trinket-code-editor.scroll-tabs-stop touchend.trinket-code-editor.scroll-tabs-stop";
  var ADD_FILE_EVENT          = "click.trinket-code-editor.add-file";
  var UPLOAD_FILE_EVENT       = "click.trinket-code-editor.upload-file";
  var VIEW_ASSETS_EVENT       = "click.trinket-code-editor.view-assets";
  var TAB_OPTIONS_OPEN_EVENT  = "click.trinket-code-editor.tab-options-open";
  var TAB_OPTIONS_CLOSE_EVENT = "mousedown.trinket-code-editor.tab-options-close";
  var EDIT_FILE_NAME_EVENT    = "click.trinket-code-editor.edit-file-name";
  var REMOVE_FILE_EVENT       = "click.trinket-code-editor.remove-file";
  var HIDE_FILE_EVENT         = "click.trinket-code-editor.hide-file";
  var INFO_EXPAND_EVENT       = "click.trinket-code-editor.info-expand";

  // Every handler this widget binds carries this namespace, so `_destroy` can
  // take them all off again in one call.
  var WIDGET_EVENT_NAMESPACE  = ".trinket-code-editor";

  var CODE_ERROR_TAB_MARKER   = '.fa.fa-exclamation-circle.warning';
  var CODE_ERROR_TAB_CLASS    = 'fa fa-exclamation-circle warning';

  var add_file_title           = $('body').data('create-text-file-title') || 'Create text file';
  var $ADD_FILE_TEMPLATE       = $("<dd class=\"tab-button\" title='" + add_file_title + "'><a class=\"add-file-link menu-button highlight-on-focus\" data-action=\"file.add\" aria-label=\"" + add_file_title + "\" role=\"button\" tabindex=\"0\"><i class=\"fa fa-plus\"></i></a></dd>");

  var $ADD_COMMENT_TEMPLATE    = $("<dd class=\"tab-button\" title='Add comment to current line'><a class=\"add-inline-comment menu-button highlight-on-focus\" data-action=\"inline-comment.add\" aria-label=\"Add comment to current line\" role=\"button\" tabindex=\"0\"><i class=\"fa fa-comment\"></i></a></dd>");
  var ADD_INLINE_COMMENT_EVENT = "click.trinket-code-editor.add-inline-comment";

  var upload_file_title        = $('body').data('upload-text-file-title') || 'Upload text file';
  var $UPLOAD_FILE_TEMPLATE    = $("<dd class=\"tab-button\" title='" + upload_file_title + "'><a class=\"upload-file-link menu-button highlight-on-focus\" data-action=\"file.upload\" aria-label=\"" + upload_file_title + "\" role=\"button\" tabindex=\"0\"><i class=\"fa fa-upload\"></i></a></dd>");
  var $UPLOAD_FILE_INPUT       = $("<form id='file-upload-form' aria-label='Upload a text file into the editor'><input type='file' name='file-upload' id='file-upload' class='hidden' tabindex='-1' aria-label='Choose a text file to upload'></form>");

  /**
   * Move comment to another line
   */
  function moveCommentTo(fileIndex, commentId, moveTo, skipWidget) {
    var w            = WIDGET_CACHE[commentId]
      , currentRow   = w.row
      , session      = this._files[fileIndex].editor.getSession();

    // remove gutter
    session.removeGutterDecoration(currentRow, "trinket-comment");
    session.removeGutterDecoration(currentRow, "data-" + fileIndex + "-" + commentId);

    session.addGutterDecoration(moveTo, "trinket-comment");
    session.addGutterDecoration(moveTo, "data-" + fileIndex + "-" + commentId);

    if (COMMENT_COLLAPSED[commentId]) {
      session.removeGutterDecoration(currentRow, "collapsed");
      session.addGutterDecoration(moveTo, "collapsed");
    }
    else {
      session.removeGutterDecoration(currentRow, "open");
      session.addGutterDecoration(moveTo, "open");
    }

    // skipWidget is true if lines are being added or removed from the editor
    // otherwise the user is using the arrows and we manage the moving of the widget
    if (!skipWidget) {
      session.widgetManager.removeLineWidget(w);
      w.row = moveTo;
      session.widgetManager.addLineWidget(w);

      if (!FILE_WIDGETS[fileIndex]) {
        FILE_WIDGETS[fileIndex] = [];
      }
      FILE_WIDGETS[fileIndex][currentRow] = undefined;
      FILE_WIDGETS[fileIndex][moveTo] = w;
    }
    else {
      w.row = moveTo;
    }

    updateCommentArrows(session, fileIndex);

    this._updateComment({
        _id    : commentId
      , index  : fileIndex
      , data   : {
          row : moveTo
        }
    });
  }

  /**
   * Is there a comment (line widget) on the given line
   */
  function commentOnLine(fileIndex, row) {
    return _.findKey(WIDGET_CACHE, function(widget) {
      return widget._file === fileIndex && widget.row === row;
    });
  }

  /**
   * Update all arrows after some change
   */
  function updateCommentArrows(session, index) {
    var docLength = session.getDocument().getLength();

    _.each(WIDGET_CACHE, function(val, key) {
      if (val._file === index) {
        // up
        if (!val.row || commentOnLine(val._file, val.row - 1)) {
          $(val.el).find('.move-comment-up').addClass("disabled");
        }
        else {
          $(val.el).find('.move-comment-up').removeClass("disabled");
        }

        // down
        if ( (docLength - 1) === val.row || commentOnLine(val._file, val.row + 1) ) {
          $(val.el).find('.move-comment-down').addClass("disabled");
        }
        else {
          $(val.el).find('.move-comment-down').removeClass("disabled");
        }
      }
    });
  }

  var widget = {
    options : {
      selectedLine: -1,
      selectedClass: 'lineselect',
      noEditor: false,
      state: "",
      defaultFileExt : 'txt',
      mainFileName: "main.py",
      mainEditable: false,
      mainSuffix: null,
      showTabs: false,
      addFiles: true, // sub-option to showTabs
      showInfo: false,
      assets: false,
      assetsHowTo : '',
      acceptedFiles : '',
      onFocus: function() {},
      lang: '',
      owner: false,
      canHideTabs: false,
      canAddInlineComments: false,
      userId: null,
      disableAceEditor: false,
      tabSize: DEFAULT_TAB_SIZE,
      lineWrapping: true,
      assignmentViewOnly: false
    },

    _create : function() {
      var self = this
        , state, classSettings, i
        , LineWidgets = ace ? ace.require('ace/line_widgets').LineWidgets : function() {};

      this._editor;
      this._commands = [];
      this._plugins  = [];
      this._files    = [];

      this.element.empty();
      this.element.append($PLUGIN_TEMPLATE.clone());

      // A view-only surface exposes no editing affordances: the editor itself
      // is read-only (see createDesktopAPI), so the controls that create,
      // upload, rename, delete or annotate files are not rendered either.
      // Suppressing them here rather than hiding them with CSS keeps them out
      // of the tab order and out of the accessibility tree as well.
      if (this.options.assignmentViewOnly) {
        this.options.addFiles            = false;
        this.options.canAddInlineComments = false;
        this.options.canHideTabs         = false;
      }

      // add add file option
      if (this.options.addFiles) {
        this.element.find('dl.right-options').append($ADD_FILE_TEMPLATE);

        // add upload file option if filereader supported
        if (!!window.FileReader) {
          this.element.find('dl.right-options').append($UPLOAD_FILE_TEMPLATE);
          this.element.append($UPLOAD_FILE_INPUT);
          $('#file-upload').change(function() {
            var file = $('#file-upload')[0].files[0];

            // some files seem to have an empty type, e.g. csv
            if (!file.type || file.type.match(/text.*/) || file.type.match(/json/)) {
              var reader = new FileReader();

              reader.onload = function() {
                self.addFile({
                    name    : file.name
                  , content : reader.result
                }, {
                    override : true // override ok? or prompt instead?
                });
                if (self._onChange) {
                  self._onChange();
                }
                self._selectTab(self._files.length - 1);

                // reset file upload form
                $('#file-upload-form').get(0).reset();
              }
              reader.onerror = function() {
                self.element.find('.tab-nav').after(FILE_NAME_ERROR_TEMPLATE({
                  message : "There was a problem reading your file. Please try again."
                }));
                $(document).foundation('alert', 'reflow');

                // reset file upload form
                $('#file-upload-form').get(0).reset();
              }

              reader.readAsText(file);
            }
            else {
              self.element.find('.tab-nav').after(FILE_NAME_ERROR_TEMPLATE({
                message : "Only text files are currently supported."
              }));
              $(document).foundation('alert', 'reflow');
            }
          });
        }
      }

      // add inline comment option
      if (this.options.canAddInlineComments) {
        this.element.find('dl.right-options').append($ADD_COMMENT_TEMPLATE);
      }
      else {
        // TODO: add this for everyone but change it to a modal ad if user does not have permission
      }

      this.$tabOptions = $TAB_OPTIONS_TEMPLATE.clone();

      if (this.options.canHideTabs) {
        // Named and focusable on the same terms as its two siblings in this
        // menu, which are already role=menuitem/tabindex=0: an icon-only
        // control that is neither announced nor reachable is not operable.
        // `aria-pressed` and the name are restated from the bound file every
        // time the menu opens (see `_syncFileHideState`); the values here are
        // the unpressed defaults that hold before the first open. The glyph is
        // empty and purely decorative, so it is kept out of the name.
        this.$tabOptions.find('ul').append("<li><a class=\"file-hide-link menu-button highlight-on-focus\" data-action=\"file.hide\" role=\"menuitem\" tabindex=\"0\" aria-pressed=\"false\" aria-label=\"Hide this file\" title=\"toggle tab visibility\"><i class=\"fa fa-eye\" aria-hidden=\"true\"></i></a></li>");
      }

      // On a view-only surface the menu is kept detached rather than added to
      // the document: nothing renders it, no tab carries the control that
      // opens it, and the rename/delete actions it holds are therefore
      // unreachable. The object itself is retained because the rest of the
      // widget refers to it, and every operation it performs is safe on a
      // detached node.
      if (!this.options.assignmentViewOnly) {
        $('body').append(this.$tabOptions);
      }

      this.$tabBar = this.element.find(".scrollable-content");
      this.$tabBar.on(TAB_CLICK_EVENT, ".tab", function(e) {
        if ($(this).hasClass('active')) {
          return;
        }
        var tabIndex = $(this).index();
        self._files[tabIndex].editor.addQueueMarkers();
        return self._selectTab(tabIndex);
      });

      this.$contentWrapper = this.element.find(".file-content-container");

      this.element.find('.tab-scroll-link').on(TAB_SCROLL_START_EVENT, function() {
        self._scrollTabBar($(this).data('direction'));
      });

      // The tab scrollers auto-repeat while the pointer is held down and stop
      // on mouseup. A keypress has no mouseup, so keyboard activation scrolls
      // by exactly one tab per press instead of running to the end.
      this.element.on('keydown.trinket-code-editor.scroll-tabs-key', '.tab-scroll-link', function(event) {
        if (event.which !== 13 && event.which !== 32) {
          return;
        }
        event.preventDefault();
        self._scrollTabBar($(this).data('direction'), true);
      });

      // Every remaining icon control in the editor is an anchor or span with no
      // href, driven by a click handler. Forward ENTER and SPACE to that
      // handler so the mouse and keyboard paths stay identical. The
      // comment-action selectors cover the controls the inline-comment
      // templates insert into the editor at runtime — reordering, the options
      // dropdown and its items — which are focusable and named but would
      // otherwise do nothing when activated from the keyboard.
      enableKeyActivation(this.element, [
        // Tab bar.
          '.file-tab-link'
        , '.tab-options-link'
        , '.add-file-link'
        , '.upload-file-link'
        , '.add-inline-comment'
        , '.expander'
        // The undo alert this widget inserts after a deletion. Both of its
        // anchors are href-less, and the affordance is time-limited, so
        // without this a keyboard user can focus them and lose the file
        // anyway.
        , '.file-remove-info .file-restore-link'
        , '.file-remove-info .close'
        // Controls the inline-comment templates insert at runtime: reordering,
        // the options dropdown and its items, and the buttons in the compose,
        // edit and remove-confirmation states. Each is an anchor styled as a
        // button and driven by a click handler, so without this they focus and
        // announce correctly but do nothing when activated from the keyboard.
        , '.comment-actions'
        , '.move-comment-up'
        , '.move-comment-down'
        , '.edit-inline-comment'
        , '.confirm-remove-inline-comment'
        , '.save-inline-comment'
        , '.cancel-inline-comment'
        , '.update-comment'
        , '.cancel-update-comment'
        , '.confirm-remove-comment'
        , '.cancel-remove-comment'
      ].join(', '));
      enableKeyActivation(this.$tabOptions, '.file-rename-link, .file-remove-link, .file-hide-link');

      this.element.find('.add-file-link').parent().on(ADD_FILE_EVENT, function() {
        self.addFile("");
        self._selectTab(self.$tabBar.children().length - 1, true);
        self._editFileName();
      });

      this.element.find('.upload-file-link').parent().on(UPLOAD_FILE_EVENT, function() {
        // trigger input file click
        $('#file-upload').trigger('click');
      });

      this.element.find('.add-inline-comment').parent().on(ADD_INLINE_COMMENT_EVENT, function() {
        self._addCommentWidget();
      });

      // Expand and collapse the keyword-documentation pane.
      //
      // Bound once, here, and delegated from this widget's own element. It
      // used to be bound inside `_addFile` with a document-wide selector, so
      // the handler count grew with the file count: with two files open one
      // activation toggled twice and netted nothing, which left the control
      // doing visibly nothing at all, and deleting a file did not unbind.
      // Delegation also means it keeps working for a pane rebuilt at runtime.
      this.element.on(INFO_EXPAND_EVENT, '.info-area .expander', function() {
        var $infoArea = self.element.find('.info-area');

        if ($infoArea.hasClass('expanded')) {
          $infoArea.removeClass('expanded').addClass('collapsed');
        }
        else {
          $infoArea.removeClass('collapsed').addClass('expanded');
        }

        self._syncInfoExpanderState();
      });

      this.element.on(TAB_OPTIONS_OPEN_EVENT, '.tab-options-link', function(e) {
        if (self.$tabOptions.hasClass('open')) {
          self._closeOptionsMenu();
        }
        else {
          var thisTab = $(this).closest('.tab');

          // The menu is a single element shared by every tab, so which file
          // its actions apply to has to be decided here, when it opens, and
          // not when an action runs: resolving the target at action time is
          // what allowed a menu opened on one file to delete another.
          self.$tabOptionsTab     = thisTab;
          self.$tabOptionsTrigger = $(this);
          if ($(thisTab).hasClass('main-editable')) {
            // main file isn't removeable
            self.$tabOptions.find('.file-remove-link').hide();
            if (self.options.canHideTabs) {
              self.$tabOptions.find('.file-hide-link').hide();
            }
          }
          else if ($(thisTab).data('binary')) {
            // hide rename link
            self.$tabOptions.find('.file-rename-link').hide();
            if (self.options.canHideTabs) {
              self.$tabOptions.find('.file-hide-link').hide();
            }
          }
          else {
            self.$tabOptions.find('.file-remove-link').show();
            if (self.options.canHideTabs) {
              self.$tabOptions.find('.file-hide-link').show();
            }
          }

          if (self.options.canHideTabs) {
            // The hide control is one shared element serving every tab, so it
            // holds no state of its own: it is restated here, for the file the
            // menu has just been bound to.
            self._syncFileHideState(thisTab);
          }

          var pos = $(this).offset();
          self.$tabOptions.css('left', (pos.left - 10) + 'px');
          self.$tabOptions.css('top', (pos.top + $(this).height() + 10) + 'px');
          self.$tabOptions.addClass('open');

          // Focus follows the menu. Its items are the only things that can be
          // acted on while it is open, and they sit in a body-level element
          // far from the trigger in the tab order, so leaving focus on the
          // trigger means a keyboard user opens a menu they cannot reach.
          focusRevealedControl(self.$tabOptions.find('[role="menuitem"]'));

          self.element.on(TAB_OPTIONS_CLOSE_EVENT, function(e) {
            if (!$(e.target).hasClass('tab-options-link')) {
              self._closeOptionsMenu();
            }
          });
        }
      });

      // Each action reads its target from the menu's binding before the menu
      // is closed (closing clears it), and does nothing if that binding no
      // longer resolves to a file — the alternative is acting on whichever
      // file happens to be selected, which is the wrong file by definition.
      this.$tabOptions.find('.file-rename-link').on(EDIT_FILE_NAME_EVENT, function() {
        var $tab = self._optionsMenuTab();

        self._closeOptionsMenu();

        if ($tab && !$('.file-name-input').length) {
          self._editFileName($tab);
        }
      });

      this.$tabOptions.find('.file-remove-link').on(REMOVE_FILE_EVENT, function() {
        var $tab = self._optionsMenuTab();

        self._closeOptionsMenu();

        if ($tab) {
          self._removeFile({ undo : true, $tab : $tab });
        }
      });

      this.$tabOptions.find('.file-hide-link').on(HIDE_FILE_EVENT, function() {
        var $tab = self._optionsMenuTab();

        self._closeOptionsMenu();

        if ($tab) {
          self._toggleFile($tab);
        }
      });

      if (this.options.assets) {
        var libraryUrlType = ["image"];
        if (this.options.lang === "pygame") {
          libraryUrlType.push("audio", ".ttf");
        }
        else if (this.options.lang === "python3") {
          libraryUrlType.push("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
          libraryUrlType.push("application/vnd.sqlite3");
          libraryUrlType.push("application/x-sqlite3", ".db");
          libraryUrlType.push(".csv", ".tsv", ".txt");
        }

        this.$assetBrowser = $("<div class=\"file-content fixed-right\"></div>").assetBrowser({
            modalParent  : ".trinket-content-wrapper"
          , libraryUrl   : "/api/users/assets?type=" + libraryUrlType.join(",")
          , assets       : this.options.assets
          , openClass    : "active"
          , assetsHowTo  : this.options.assetsHowTo
          , guest        : this.options.guest
          , lang         : this.options.lang
          , acceptedFiles : this.options.acceptedFiles
        });
        this.element.find('.right-options').append("<dd class=\"tab\" title='Manage images'><a class=\"file-tab-link add-asset-link\" data-action=\"assets.view\" title=\"View and Add Images\"><i class=\"fa fa-file-image-o\"></i></a></dd>");
        this.assetBrowser = this.$assetBrowser.data('trinket-assetBrowser');
        this.assetBrowser.hide();
        this.element.find('.tab-nav').addClass('allow-assets');
        this.$contentWrapper.append(this.$assetBrowser);
        this.element.find('.add-asset-link').parent().on(VIEW_ASSETS_EVENT, function() {
          var $tab = $(this);
          if ($tab.hasClass('active')) {
            return;
          }

          self._selectTab(-1, true);
          $tab.addClass('active');

          self.assetBrowser.show();
        });
      }

      if (!this.options.showTabs) {
        self.element.addClass('tabless');
      }

      if (this.options.showInfo) {
        self.element.addClass('with-info');
      }

      // State the expander's collapsed condition and its controlled region
      // from the outset, rather than only once the pane has been toggled.
      this._syncInfoExpanderState();

      if (this.options.state) {
        this._loadState(this.options.state);
      }

      $(document).on('SkfileWrite', function(e) {
        var i, eventData, filename, filecontent, oldValue, newValue;
        var $content;

        // first element is file name, second is content
        eventData   = e.originalEvent.data.split(':');
        filename    = eventData[0];
        filecontent = eventData.slice(1).join(':');

        for (i = 0; i < self._files.length; i++) {
          if (self._files[i].name === filename) {
            oldValue = self._files[i].editor.getValue();
            newValue = oldValue.length ? oldValue + filecontent : filecontent;
            $('textarea[name="' + self._files[i].name + '"]').val(newValue);
            if (self.$contentWrapper.children().eq(i).hasClass('active')) {
              self._files[i].editor.setValue(newValue);
            } else {
              self._files[i].editor.destroy();
              $content = $CONTENT_TEMPLATE.clone();
              self._files[i].editor = createDesktopAPI($content[0], {
                onFocus : function() {}
                , ext   : self._files[i].name.split(".").pop() || self.options.defaultFileExt
                , index : i
                , editorOpts : self.options
              });
              self._files[i].editor.setValue(newValue);
              self.$contentWrapper.children().eq(i).replaceWith($content);
            }
          }
        }
      });

      $(document).on('SkfileOpen', function(e) {
        var i, $textarea, $content;
        var eventData = e.originalEvent.data.split(':');
        var mode      = eventData[0];
        var filename  = eventData.slice(1).join(':');
        var filemap   = {};

        self._files.map(function(file, index) {
          filemap[file.name] = index;
        });

        if (typeof filemap[filename] === "undefined") {
          self.addFile({ name : filename });
          if (mode === "w") {
            $textarea = $("<textarea>", { id : filename, name : filename });
            $textarea.val('\n');
            $('body').append($textarea);
          }
        }
        else if (mode === "w") {
          i = filemap[filename];

          $('textarea[name="' + self._files[i].name + '"]').val('\n');
          if (self.$contentWrapper.children().eq(i).hasClass('active')) {
            self._files[i].editor.setValue("");
          } else {
            self._files[i].editor.destroy();
            $content = $CONTENT_TEMPLATE.clone();
            self._files[i].editor = createDesktopAPI($content[0], {
              onFocus : function() {}
              , ext   : self._files[i].name.split(".").pop() || self.options.defaultFileExt
              , index : i
              , editorOpts : self.options
            });
            self.$contentWrapper.children().eq(i).replaceWith($content);
          }
        }
      });

      $(document).on('comment.added', '.file-content', function(event, data) {
        self._addComment(data);
      });

      // events
      $(document).on('click', '.edit-inline-comment', function(event) {
        var _commentId  = $(this).data('comment-id')
          , commentText = WIDGET_CACHE[_commentId]._text;

        // hide rendered view, show textarea, set value of textarea
        $('#comment-container-' + _commentId).addClass('hide');
        $('#edit-comment-container-' + _commentId).removeClass('hide');

        $('textarea#edit-inline-comment-' + _commentId).val(commentText);

        // This item lives inside the dropdown, so the framework's click-out
        // handler never sees the click: without closing it here the list stays
        // open behind the edit panel and its trigger stays marked expanded.
        closeCommentDropdown(_commentId);

        // hide dropdown, show buttons
        $("a[data-dropdown='comment-actions-" + _commentId + "']").addClass("hide");
        $("#update-comment-container-" + _commentId).removeClass("hide");

        // The text is what this action exists to change, so focus it.
        focusRevealedControl('textarea#edit-inline-comment-' + _commentId);
      });

      $(document).on('click', '.cancel-update-comment', function(event) {
        var _commentId = $(this).data('comment-id');

        // The trigger is about to be shown again, so its state has to describe
        // the list as it now is: closed.
        closeCommentDropdown(_commentId);

        $("a[data-dropdown='comment-actions-" + _commentId + "']").removeClass("hide");
        $("#update-comment-container-" + _commentId).addClass("hide");

        $('#comment-container-' + _commentId).removeClass('hide');
        $('#edit-comment-container-' + _commentId).addClass('hide');

        focusRevealedControl("a[data-dropdown='comment-actions-" + _commentId + "']");
      });

      $(document).on('click', '.update-comment', function(event) {
        var _commentId = $(this).data('comment-id')
          , _fileIndex = $(this).data('file-index');

        var updatedComment     = $('textarea#edit-inline-comment-' + _commentId).val();
        // Escaped before the line breaks become markup: this string is
        // written into the card with .html() immediately below.
        var updatedCommentHtml = commentTextToHtml(updatedComment)

        // The cached copy stays as the author typed it: it is written back
        // into the edit field with .val(), which does not decode entities.
        WIDGET_CACHE[_commentId]._text = updatedComment;
        $('#comment-container-' + _commentId).html(updatedCommentHtml);

        // Commit path: the trigger comes back, so restate it as closed.
        closeCommentDropdown(_commentId);

        $("a[data-dropdown='comment-actions-" + _commentId + "']").removeClass("hide");
        $("#update-comment-container-" + _commentId).addClass("hide");

        $('#comment-container-' + _commentId).removeClass('hide');
        $('#edit-comment-container-' + _commentId).addClass('hide');

        focusRevealedControl("a[data-dropdown='comment-actions-" + _commentId + "']");

        self._updateComment({
            _id    : _commentId
          , index  : _fileIndex
          , data   : {
                text   : updatedComment
              , edited : true
            }
        });
      });

      $(document).on('click', '.confirm-remove-inline-comment', function(event) {
        var _commentId = $(this).data('comment-id');

        // Also inside the dropdown, and so also invisible to the framework's
        // click-out handler.
        closeCommentDropdown(_commentId);

        $("a[data-dropdown='comment-actions-" + _commentId + "']").addClass("hide");
        $("#confirm-remove-comment-container-" + _commentId).removeClass("hide");

        // This action asks a question, so focus its answer.
        focusRevealedControl("#confirm-remove-comment-container-" + _commentId + " .confirm-remove-comment");
      });

      $(document).on('click', '.cancel-remove-comment', function(event) {
        var _commentId = $(this).data('comment-id');

        // The trigger is about to be shown again; state it as closed.
        closeCommentDropdown(_commentId);

        $("a[data-dropdown='comment-actions-" + _commentId + "']").removeClass("hide");
        $("#confirm-remove-comment-container-" + _commentId).addClass("hide");

        focusRevealedControl("a[data-dropdown='comment-actions-" + _commentId + "']");
      });

      $(document).on('click', '.confirm-remove-comment', function(event) {
        var _commentId = $(this).data('comment-id')
          , _fileIndex = $(this).data('file-index')
          , w          = WIDGET_CACHE[_commentId];

        self._files[_fileIndex].editor.getSession().removeGutterDecoration(w.row, "trinket-comment");
        self._files[_fileIndex].editor.getSession().removeGutterDecoration(w.row, "data-" + _fileIndex + "-" + _commentId);

        if (COMMENT_COLLAPSED[_commentId]) {
          self._files[_fileIndex].editor.getSession().removeGutterDecoration(w.row, "collapsed");
        }
        else {
          self._files[_fileIndex].editor.getSession().removeGutterDecoration(w.row, "open");
        }

        WIDGET_CACHE[_commentId].destroy();
        delete WIDGET_CACHE[_commentId];

        FILE_WIDGETS[_fileIndex][w.row] = undefined;

        updateCommentArrows(self._files[_fileIndex].editor.getSession(), _fileIndex);

        // The comment and every control on it are gone, so the nearest thing
        // the user can still act on is the control that adds a new one.
        focusRevealedControl(self.element.find('.add-inline-comment'));

        self._removeComment({
            _id   : _commentId
          , index : _fileIndex
        });
      });

      $(document).on('click', '.ace_gutter-cell.trinket-comment', function(event) {
        var classes = $(event.target).attr("class").split(" ")
          , commentClass, commentData, fileIndex, commentId, w;

        commentClass = _.find(classes, function(c) { return /^data/.test(c); });
        commentData  = commentClass.split("-");
        fileIndex    = commentData[1];
        commentId    = commentData[2];
        w            = WIDGET_CACHE[commentId];

        // this causes a flicker as the line is highlighted by ace and then quickly unhighlighted
        // instead change ace behavior?
        // self._files[fileIndex].editor.getSession().selection.clearSelection();

        var session = self._files[fileIndex].editor.getSession();

        // Collapsing detaches the card, and with it a trigger the framework
        // can no longer find to restate; re-showing it must not bring back a
        // control that claims an open list. Either way the list is closed
        // once this click has been served, so say so before the card moves.
        closeCommentDropdown(commentId);

        if (COMMENT_COLLAPSED[commentId]) {
          session.widgetManager.addLineWidget( WIDGET_CACHE[commentId] );
          COMMENT_COLLAPSED[commentId] = false;

          session.removeGutterDecoration(w.row, "collapsed");
          session.addGutterDecoration(w.row, "open");
        }
        else {
          session.widgetManager.removeLineWidget( WIDGET_CACHE[commentId] );
          COMMENT_COLLAPSED[commentId] = true;

          session.removeGutterDecoration(w.row, "open");
          session.addGutterDecoration(w.row, "collapsed");
        }

        self._updateComment({
            _id    : commentId
          , index  : fileIndex
          , data   : {
              collapsed : COMMENT_COLLAPSED[commentId]
            }
        });
      });

      $(document).on('click', '.comment-actions.comment-dismiss', function(event) {
        var _commentId = $(this).data('comment-id')
          , _fileIndex = $(this).data('file-index')
          , w          = WIDGET_CACHE[_commentId];

        self._files[_fileIndex].editor.getSession().removeGutterDecoration(w.row, "trinket-comment");
        self._files[_fileIndex].editor.getSession().removeGutterDecoration(w.row, "data-" + _fileIndex + "-" + _commentId);

        if (COMMENT_COLLAPSED[_commentId]) {
          self._files[_fileIndex].editor.getSession().removeGutterDecoration(w.row, "collapsed");
        }
        else {
          self._files[_fileIndex].editor.getSession().removeGutterDecoration(w.row, "open");
        }

        WIDGET_CACHE[_commentId].destroy();
        delete WIDGET_CACHE[_commentId];

        self._removeComment({
            _id   : _commentId
          , index : _fileIndex
        });
      });

      $(document).on('click', '.move-comment-up', function(event) {
        if ($(this).hasClass('disabled')) {
          return;
        }

        var _commentId = $(this).data('comment-id')
          , _fileIndex = $(this).data('file-index')
          , w          = WIDGET_CACHE[_commentId]
          , currentRow = w.row
          , moveTo     = w.row - 1;

        moveCommentTo.call(self, _fileIndex, _commentId, moveTo);
      });

      $(document).on('click', '.move-comment-down', function(event) {
        if ($(this).hasClass('disabled')) {
          return;
        }

        var _commentId = $(this).data('comment-id')
          , _fileIndex = $(this).data('file-index')
          , w          = WIDGET_CACHE[_commentId]
          , currentRow = w.row
          , moveTo     = w.row + 1;

        moveCommentTo.call(self, _fileIndex, _commentId, moveTo);
      });

      // keyboard shortcut (Shift+Tab) to switch focus to editor
      $('#outputContainer').keyup(function(e) {
        if (e.shiftKey && e.keyCode === 9) {
          e.preventDefault();
          self.focus();
        }
      });
    },

    /**
     * Keep the keyword-documentation expander in step with the pane.
     *
     * The control's visible text switches between "more" and "less" purely
     * through the pane's collapsed/expanded class, so its accessible name and
     * `aria-expanded` are restated from that same class rather than tracked
     * separately — otherwise the name says "Show more information" while the
     * control reads "less" and does the opposite. `aria-controls` needs a
     * target with an id, which the pane's body does not have of its own.
     */
    _syncInfoExpanderState : function() {
      var $infoArea = this.element.find('.info-area')
        , $expander = $infoArea.find('.expander')
        , $full     = $infoArea.find('.info-full')
        , expanded  = $infoArea.hasClass('expanded');

      if (!$expander.length) {
        return;
      }

      if ($full.length) {
        if (!$full.attr('id')) {
          $full.attr('id', 'info-full-' + (++INFO_REGION_SEQUENCE));
        }
        $expander.attr('aria-controls', $full.attr('id'));
      }

      $expander.attr('aria-expanded', expanded ? 'true' : 'false');
      $expander.attr('aria-label', expanded
        ? 'Show less information about the selected keyword'
        : 'Show more information about the selected keyword');
    },

    /**
     * Release everything this widget bound outside its own element.
     *
     * jQuery UI removes handlers bound through its own `_on`, and handlers in
     * the widget's `.codeEditor` namespace, but this widget binds in its own
     * `.trinket-code-editor` namespace and appends the file-options menu to
     * `body`, so both outlive a destroy unless they are taken off here.
     */
    _destroy : function() {
      this.element.off(WIDGET_EVENT_NAMESPACE);

      if (this.$tabBar) {
        this.$tabBar.off(WIDGET_EVENT_NAMESPACE);
      }

      if (this.$tabOptions) {
        this.$tabOptions.off(WIDGET_EVENT_NAMESPACE);
        this.$tabOptions.remove();
      }
    },

    _closeOptionsMenu : function() {
      var wasOpen, $trigger;

      if (!this.$tabOptions) {
        return;
      }

      wasOpen  = this.$tabOptions.hasClass('open');
      $trigger = this.$tabOptionsTrigger;

      this.element.off(TAB_OPTIONS_CLOSE_EVENT);
      this.$tabOptions.removeClass('open');

      // The binding is dropped with the menu, so a later action cannot fall
      // back on a tab the user has since navigated away from.
      this.$tabOptionsTab     = undefined;
      this.$tabOptionsTrigger = undefined;

      // Every close path lands here — commit, cancel, dismiss and tab change
      // — so this is where focus goes back to the control that opened the
      // menu. The menu items are gone, and a keyboard user left on a removed
      // element is returned to <body> and to the top of the tab order.
      // Actions that reveal something better to act on (the rename field, the
      // undo link) move focus on from here themselves.
      if (wasOpen && $trigger) {
        focusRevealedControl($trigger);
      }
    },

    /**
     * The tab the currently open options menu was opened for.
     *
     * @return {jQuery|null} the owning tab, or null when the menu's binding
     *         no longer resolves to a live, selected tab
     */
    _optionsMenuTab : function() {
      var $tab = this.$tabOptionsTab;

      // Still in the tab bar, and still the selected file: the menu is closed
      // on every tab selection, so anything else means the tab bar changed
      // under the open menu and there is no target the user can have meant.
      if (!$tab || !$tab.length || !$.contains(this.$tabBar[0], $tab[0]) || !$tab.hasClass('active')) {
        return null;
      }

      return $tab;
    },

    _loadState : function(state) {
      var i;

      try {
        state = JSON.parse(state);
        if (!Array.isArray(state)) {
          // throw generic error to fall into catch below
          throw new Error();
        }
      }
      catch(e) {
        state = [{
          name      : this.options.mainFileName
          , content : state || ""
        }];
      }

      for (i = 0; i < state.length; i++) {
        this.addFile(state[i]);
      }

      this._selectTab(0, true);
    },

    /**
     * Returns the current visible tab from the tab-bar.
     */
    _getCurrentVisibleTab: function() {
      var $activeTab     = this.$tabBar.find('.tab.active').first();
      var $activeContent = this.$contentWrapper.find('.file-content.active').first();
      var tabIndex       = $activeTab.index();
      var fileName       = $activeTab.find('.file-name').text();

      return {
        tabIndex: tabIndex,
        fileName: fileName
      }
    },

    _selectTab : function(tabIndex, noFocus) {
      // Selecting a tab closes the options menu. The menu is one element
      // shared by every tab and is bound to the tab it was opened for, so
      // leaving it open across a tab change leaves a menu standing over a
      // file it does not belong to — which is how Delete came to remove a
      // file the user had navigated away from.
      this._closeOptionsMenu();

      this.element.find('.tab.active, .file-content.active').removeClass('active');
      // Keep the tablist's selected state in sync with the visual one so
      // assistive technology reports the same active file the user sees.
      this.element.find('.tab .file-tab-link').attr('aria-selected', 'false');
      // The stylesheet renders this control's gear only on the selected tab,
      // so on any other tab it is an invisible zero-width focus stop that
      // opens a menu positioned off the tab it belongs to. Take it out of the
      // tab order and out of the accessibility tree until its tab is the one
      // being acted on.
      this.element.find('.tab .tab-options-link').attr({
          'tabindex'    : '-1'
        , 'aria-hidden' : 'true'
      });
      if (this._editor) {
        this._editor.blur();
      }
      if (tabIndex !== undefined && this._files[tabIndex]) {
        this.$tabBar.children().eq(tabIndex).addClass('active');
        this.$tabBar.children().eq(tabIndex).find('.file-tab-link').attr('aria-selected', 'true');
        this.$tabBar.children().eq(tabIndex).find('.tab-options-link')
          .attr('tabindex', '0')
          .removeAttr('aria-hidden');
        this.$contentWrapper.children().eq(tabIndex).addClass('active');
        this._editor = this._files[tabIndex].editor;
        if (!noFocus) {
          this._editor.focus();
        }

        // emit file selected event
        this.element.trigger({type: 'codeeditor.tabChanged', tabIndex: tabIndex});

        if (this._files[tabIndex].binary) {
          this.element.find('.add-inline-comment').addClass('disabled');
        }
        else {
          this.element.find('.add-inline-comment').removeClass('disabled');
        }
      }
      else {
        this.element.find('.add-inline-comment').addClass('disabled');
      }
    },

    /**
     * Re-state a file's accessible names after it is named or renamed.
     *
     * The tab, its options control and the editor region are each named from
     * the file name at the moment they are built — which, for a file added at
     * runtime, is before it has one. Without this the visible label updates on
     * rename while assistive technology keeps announcing the name the file was
     * created with, so a screen-reader user hears "Unnamed file" for the rest
     * of the session no matter what the file is actually called.
     *
     * @param {jQuery} $tab the tab whose file was named
     * @param {String} name the file's new name
     */
    _refreshFileAccessibleNames : function($tab, name) {
      var $editor = this.element.find('.ace_editor.active')
        , label   = 'Code editor' + (name ? ', ' + name : '')
        , $input;

      $tab.find('.file-tab-link').attr('aria-label', name ? name + ' tab' : 'Unnamed file tab');
      $tab.find('.tab-options-link').attr('aria-label', name ? 'Options for ' + name : 'Options for this unnamed file');

      if (!$editor.length) {
        return;
      }

      $editor.attr('aria-label', label);
      $input = $editor.find('textarea.ace_text-input');

      if ($input.length) {
        // Re-state only the file name. The escape-route half of the
        // description is what a keyboard user depends on, so it is rebuilt
        // verbatim, in the read-only or editable form the field already has.
        $input.attr('aria-label', $input.attr('aria-readonly') === 'true'
          ? label + ' (read only). Press Escape to go back to the file tab, or F6 to move on past the editor.'
          : label + '. Press Escape to go back to the file tab, or F6 to move on past the editor. Tab inserts indentation.');
      }
    },

    /**
     * Put a tab's file name into an editable field.
     *
     * @param {jQuery} [$targetTab] the tab to rename; defaults to the
     *        selected tab, which is what the "+" flow means
     */
    _editFileName : function($targetTab) {
      var self      = this
          // A caller that knows which file it means says so: the shared
          // options menu resolves its target when it opens, not now.
          , $tab    = $targetTab && $targetTab.length ? $targetTab : self.$tabBar.find('.tab.active')
          , $name   = $tab.find('.file-name')
          , name    = $name.text()
          , nameLen = name.length
          , $input  = $(EDITABLE_TAB_TEMPLATE({ name : escapeHtml(name) }))
          , width   = $name.outerWidth()
          // Set when the field is dismissed with ENTER or ESCAPE. A blur
          // caused by the user clicking somewhere else must leave focus where
          // they clicked, so only a keyboard dismissal hands focus back.
          , dismissedByKeyboard = false;

      // Interpolating an empty name leaves "Edit  filename" with a doubled
      // space; name the field for what it does instead.
      $input.attr('aria-label', name ? 'Edit ' + name + ' filename' : 'File name');

      if ($tab.hasClass('main-editable')) {
        if (!self.options.mainEditable) {
          return;
        }
        if (self.options.mainSuffix) {
          nameLen -= self.options.mainSuffix.length;
        }
      }

      $name.hide();
      $input.css('width', width + 'px');
      $name.after($input);
      $input.focus();
      $input[0].setSelectionRange(0, nameLen);

      $input.on('blur', function(e) {
        var newName = $input.val().replace(/^\s|\s$/g, "")
            , errorMessage;

        $('.file-name-error').remove();
        if (!newName.length) {
          // The file being named is the one to discard, named explicitly so
          // this cannot fall through to whichever tab is selected.
          self._removeFile({ undo : false, $tab : $tab });
          return;
        }
        else if (newName.length > 50) {
          errorMessage = "File names must be less than 50 characters, please choose a shorter name.";
        }
        else if ( (self.options.lang === "python" || self.options.lang === "python3") && newName.match(/\.py$/) && !newName.match(/^[\w][\w0-9]*(\.[a-z]+)?$/)) {
          errorMessage = "Python file names must start with a letter or underscore followed by zero or more letters, digits and underscores.";
        }
        else if (!newName.match(/^\w[\w\.\-]*$/)) {
          errorMessage = "File names must start with a letter, number, or underscore followed by zero or more letters, numbers, underscores, hyphens, and periods.";
        }
        else if ($('#' + newName).length) {
          errorMessage = "The name '" + newName + "' is reserved, please choose a different name.";
        }
        else if (newName.toLowerCase() !== name.toLowerCase()) {
          self.$tabBar.find(".file-name").each(function() {
            if ($(this).text().toLowerCase() === newName.toLowerCase()) {
              errorMessage = "There is already a file named \"" + newName + "\", please choose a different name.";
              return false;
            }
          });
        }

        if (errorMessage) {
          self.element.find('.tab-nav').after(FILE_NAME_ERROR_TEMPLATE({message:errorMessage}));
          $(document).foundation('alert', 'reflow');
          $(this).focus();
          this.setSelectionRange(0, newName.length);
        }
        else {
          $name.text(newName);
          $name.show();
          $(this).remove();
          self._refreshFileAccessibleNames($tab, newName);
          self._files[$tab.index()].name = newName;
          if (self._onChange) {
            self._onChange();
          }
          self._files[$tab.index()].editor.setModeFromName(newName);
          // emit file renamed event
          self.element.trigger({type: 'codeeditor.fileRenamed', oldFileName: name, newFileName: newName, newFile: self._files[$tab.index()]});

          // The field the user was in has just been removed, so a keyboard
          // dismissal would otherwise drop focus onto <body> and back to the
          // top of the tab order. Return it to the control that opens this
          // file's options — the control the rename was started from — or to
          // the tab itself where that control does not exist.
          if (dismissedByKeyboard) {
            focusRevealedControl($tab.find('.tab-options-link').length
              ? $tab.find('.tab-options-link')
              : $tab.find('.file-tab-link'));
          }
        }
      });

      $input.on('keydown', function(e) {
        // kill focus on ENTER/RETURN
        if(e.keyCode === 10 || e.keyCode === 13) {
          dismissedByKeyboard = true;
          $(this).blur();
        }
        // restore original value on ESCAPE
        else if (e.keyCode === 27) {
          dismissedByKeyboard = true;
          $input.val(name);
          $(this).blur();
        }
      });
    },

    /**
     * Remove a file, offering an undo when asked for one.
     *
     * @param {Object} options
     * @param {Boolean} options.undo show the undo alert even for an empty file
     * @param {jQuery} [options.$tab] the tab to remove; defaults to the
     *        selected tab. The options menu passes the tab it was opened for,
     *        which is the only way this cannot remove the wrong file.
     */
    _removeFile : function(options) {
      var self                    = this
          , $activeTab            = options && options.$tab && options.$tab.length
                                      ? options.$tab.first()
                                      : this.$tabBar.find('.tab.active').first()
          , $activeContent        = this.$contentWrapper.children().eq($activeTab.index()).first()
          , newIndex = origIndex  = $activeTab.index()
          , fileName              = $activeTab.find('.file-name').text()
          // The raw name goes in: `UNDO_REMOVE_TEMPLATE` escapes its own input
          // because it concatenates the name into markup three times, so
          // escaping it here as well showed the user `&amp;` and `&lt;`.
          , $restore              = $(UNDO_REMOVE_TEMPLATE({name : fileName}))
          , fileToRestore         = this._files.splice(origIndex, 1)[0]
          , isLastTab             = origIndex === this._files.length
          , closeUndoAlertTimeout = setTimeout(function() {
              $restore.find('.close').click();
            }, 15000)
          , closeUndoMessage      = function() {
              clearTimeout(closeUndoAlertTimeout);
              fileToRestore = undefined;
              $activeTab = undefined;
              $activeContent = undefined;
              if ($restore) {
                $restore.remove();
                $restore = undefined;
              }
            }
          , byKeyboard;

      $activeTab.detach();
      $activeContent.detach();

      if (isLastTab) {
        newIndex -= 1;
      }

      // Whether this deletion was activated by ENTER or SPACE has to be read
      // here, while the click handler that triggered it is still on the
      // stack; the focus decisions below depend on it.
      byKeyboard = activatedByKeyboard();

      // On the keyboard path the editor is deliberately not focused. Ace's
      // focus() also schedules a deferred re-focus of its hidden textarea, so
      // focusing the editor here would silently take focus back off the undo
      // link a tick after it was given (measured at 12-18ms). The undo
      // affordance is focused below instead.
      this._selectTab(newIndex, byKeyboard ? true : undefined);
      if (this._onChange && !fileToRestore.binary) {
        this._onChange();
      }

      if (options.undo || fileToRestore.editor.getValue().length) {
        // attach undo message
        this.element.find('.tab-nav').after($restore);

        // destroy restore file editor when message is discarded
        $restore.find('.close').on('click', function() {
          // Nothing to discard once the file has been put back: the capture
          // is cleared on restore, and reading through it would throw.
          if (!fileToRestore) {
            return;
          }

          var dismissedByKey = activatedByKeyboard();

          fileToRestore.editor.destroy();
          // emit event when editor is finally destroyed
          self.element.trigger({type: 'codeeditor.fileRemoved', fileName: fileName});

          // Destroying the editor empties its container, so this file cannot
          // be restored any more — its content is gone. Foundation removes
          // the alert a few hundred milliseconds after this handler (measured
          // at ~335ms: it fades the box out and only then fires the `close`
          // event this widget listens for), and the undo link stays live and
          // clickable throughout. Retiring the capture here rather than
          // waiting for that event is what stops a click in that window
          // putting the tab back around an emptied editor — which would then
          // be announced as a change and saved as an empty file.
          clearTimeout(closeUndoAlertTimeout);
          fileToRestore = undefined;

          // Dismissing removes the element that holds focus, which returns a
          // keyboard user to <body> and the top of the tab order. Put them on
          // the file they are now looking at instead.
          if (dismissedByKey) {
            focusRevealedControl(self.$tabBar.find('.tab.active .file-tab-link'));
          }
        });

        // Restore the deleted file. Bound to this alert's own link: a
        // document-wide selector binds a further handler on every deletion,
        // so one activation restores several files, and an older alert's link
        // acts on the newest deletion.
        $restore.find('.file-restore-link').on('click', function() {
          // `closeUndoMessage` clears the capture, so the restore holds its
          // own reference. Reading `fileToRestore` after the close threw a
          // TypeError, which left the tab back on screen with the change
          // never announced and therefore never persisted.
          var restoredFile = fileToRestore;

          if (!restoredFile) {
            return;
          }

          self._files.splice(origIndex, 0, restoredFile);
          if (isLastTab) {
            self.$tabBar.append($activeTab);
            self.$contentWrapper.children().eq(newIndex).after($activeContent);
          }
          else {
            self.$tabBar.children().eq(newIndex).before($activeTab);
            self.$contentWrapper.children().eq(newIndex).before($activeContent);
          }
          self._selectTab(origIndex);
          closeUndoMessage();

          // `_onChange` is the draft-save trigger, so the restored file is
          // only on screen until the next reload without it.
          if (self._onChange && !restoredFile.binary) {
            self._onChange();
          }
        });
        $(document).one('close.fndtn.alert-box', function(event) {
          closeUndoMessage();
        });

        if ($('.file-name-error').length) {
          $('.file-name-error').remove();
        }
        $(document).foundation('alert', 'reflow');

        // A deletion reached from the keyboard leaves focus on a control that
        // has just been detached with its tab. Without this the user lands in
        // the editor, which sits past the alert in the tab order behind a TAB
        // key that indents rather than moves, so they would have to know to
        // go backwards to reach a message that withdraws itself after fifteen
        // seconds. The pointer path is untouched: focus stays where it was
        // clicked.
        if (byKeyboard) {
          focusRevealedControl($restore.find('.file-restore-link'));
        }
      }
      else if (byKeyboard) {
        // Nothing was offered to undo, so the tab bar is where the user was
        // working and where the removed file's neighbour now is.
        focusRevealedControl(this.$tabBar.find('.tab.active .file-tab-link'));
      }
    },

    /**
     * Toggle a file's hidden flag.
     *
     * @param {jQuery} [$targetTab] the tab whose file to toggle; defaults to
     *        the selected tab
     */
    _toggleFile : function($targetTab) {
      var self     = this
          // Named by the caller where it matters: the options menu decides
          // which file it is acting on when it opens, not when it commits.
          , $tab   = $targetTab && $targetTab.length ? $targetTab : self.$tabBar.find('.tab.active');

      if (typeof self._files[$tab.index()].hidden === 'undefined') {
        self._files[$tab.index()].hidden = true;
      }
      else {
        self._files[$tab.index()].hidden = !self._files[$tab.index()].hidden;
      }

      if (self._files[$tab.index()].hidden) {
        $tab.find('.file-name').addClass('hidden-file-indicator');
        $('<i class="fa fa-eye-slash file-icon"></i>').insertBefore( $tab.find('.file-name') );
      } else {
        $tab.find('.file-name').removeClass('hidden-file-indicator');
        $tab.find('.file-name').prev('i').remove();
      }

      // The visible change is a colour and an eye-slash glyph, neither of
      // which reaches assistive technology. Restate the control's own state so
      // it is correct the moment the flag changes, not only at the next open.
      self._syncFileHideState($tab);

      if (self._onChange) {
        self._onChange();
      }
    },

    /**
     * Restate the shared hide control's pressed state and accessible name from
     * the file it is about.
     *
     * The control toggles a file between visible and hidden, but the only
     * feedback baseline gives is a colour change on the tab and an empty
     * eye-slash glyph, so its accessible node was byte-identical in both
     * states. `aria-pressed` carries the state, and the name repeats it
     * because `aria-pressed` is not reliably surfaced on a `menuitem`: without
     * the name a screen-reader user hears the same thing whether the file is
     * visible or hidden, which is the whole of the defect.
     *
     * @param {jQuery} $tab the tab whose file the control will act on
     */
    _syncFileHideState : function($tab) {
      var $link = this.$tabOptions ? this.$tabOptions.find('.file-hide-link') : null
        , file, name, hidden;

      if (!$link || !$link.length || !$tab || !$tab.length) {
        return;
      }

      file   = this._files[$tab.index()];
      name   = $.trim($tab.find('.file-name').text());
      hidden = !!(file && file.hidden);

      $link.attr('aria-pressed', hidden ? 'true' : 'false');
      $link.attr('aria-label', (hidden ? 'Show ' : 'Hide ') + (name || 'this file'));
    },

    /**
     * Scroll the tab bar towards `direction`.
     *
     * @param {Number} direction -1 for left, 1 for right
     * @param {Boolean} [singleStep] advance one tab and stop, for callers with
     *        no pointer-release event to end the auto-repeat (keyboard)
     */
    _scrollTabBar : function(direction, singleStep) {
      var self             = this
          , scrollDelay    = 300
          , delayIncrement = 50
          , easing         = "swing"
          , stopScrolling  = false
          , $tabs          = self.$tabBar.children()
          , nextTabTimeout, scrollTabs;

      if (direction < 0) {
        $tabs = $($tabs.get().reverse());
      }

      if (!singleStep) {
        $(document).one(TAB_SCROLL_STOP_EVENT, function() {
            stopScrolling = true;
            clearTimeout(nextTabTimeout);
        });
      }

      scrollTabs = function() {
        var searching = true;

        $tabs.each(function() {
          var pos = $(this).position().left;

          if (direction > 0) {
            pos += $(this).outerWidth();
          }

          if ((direction > 0 && pos > 10) || (direction < 0 && pos < -10)) {
            self.$tabBar.animate(
              {scrollLeft: "+=" + pos}, 200, easing
              , function() {
                if (stopScrolling) return;

                scrollDelay = Math.max(0, scrollDelay - delayIncrement);
                if (!scrollDelay) {
                  easing = "linear";
                }
                nextTabTimeout = setTimeout(scrollTabs, scrollDelay);
              }
            );
            searching = false;
          }

          return searching;
        });
      };

      scrollTabs();

      // Setting the flag after the first animation is queued lets that step
      // finish and prevents the completion callback scheduling another.
      if (singleStep) {
        stopScrolling = true;
      }
    },

    _addCommentWidget : function() {
      var active = this._getCurrentVisibleTab();
      if (active.tabIndex >= 0) {
        this._files[active.tabIndex].editor.addCommentWidget.call(this);
      }
    },

    _addComment : function(data) {
      this._files[ data.index ].comments.push(data);

      if (this._onChange) {
        this._onChange();
      }
    },
    _removeComment : function(data) {
      this._files[ data.index ].comments = _.filter(this._files[ data.index ].comments, function(comment) {
        return comment._id !== data._id;
      });

      if (this._onChange) {
        this._onChange();
      }
    },
    _updateComment : function(data) {
      _.find(this._files[ data.index ].comments, function(comment) {
        if (comment._id === data._id) {
          comment = _.extend(comment, data.data);
        }
      });

      if (this._onChange) {
        this._onChange();
      }
    },
    _createEditor : function(file, index, canUseAce) {
      var editor;

      var name = file.name;
      var type = file.type || name.split(".").pop();
      var content = file.content || "";
      var comments = file.comments || [];
      var binary = file.binary || false;
      var $content = $CONTENT_TEMPLATE.clone();

      if (this.options.noEditor) {
        editor = createGhostAPI($content[0], {
          value : content
        });
      }
      else if (file.image) {
        editor = createImageAPI($content[0], {
            name  : name
          , value : content
        });
      }
      else if (file.binary) {
        editor = createGhostAPI($content[0], {
          value : content
        });

        $content.html($BINARY_FILE_TEMPLATE);
      }
      else if (!this.options.disableAceEditor && canUseAce && ace) {
        editor = createDesktopAPI($content[0], {
            onFocus         : this.options.onFocus
          , ext             : type || this.options.defaultFileExt
          , name            : name
          , value           : content
          , index           : index
          , comments        : comments
          , editorOpts      : this.options
          , onCommentChange : moveCommentTo.bind(this)
          , onCommentRemove : this._removeComment.bind(this)
        });
      }
      else {
        editor = createMobileAPI($content[0], {
            onFocus      : this.options.onFocus
          , selectedLine : this.options.selectedLine
          , value        : content
          , name         : name
        });

        // add editor commands, if any
        for (var commandKey in mobileCommands) {
          editor.addCommand(
            commandKey,
            mobileCommands[commandKey].key,
            mobileCommands[commandKey].fn
          );
        }
      }

      for (i = 0; i < this._commands.length; i++) {
        editor.addCommand.apply(editor, this._commands[i]);
      }

      for (i = 0; i < this._plugins.length; i++) {
        editor.registerPlugin(this._plugins[i], this);
      }

      if (this._onChange && !binary) {
        editor.change(this._onChange);
      }

      return {
        editor: editor,
        $content: $content
      };
    },

    resize : function(force) {
      for(var i = 0; i < this._files.length; i++) {
        this._files[i].editor.resize(force);
      }
    },

    assets : function(value) {
      return this.options.assets ? this.assetBrowser.assets(value) : [];
    },

    addFile : function(file, options) {
      var self = this
        , content = ""
        , type  = ""
        , index = this._files.length
        , canUseAce = true
        , override = options && options.override ? options.override : false
        , name, $tab, i, $last, hidden, filedata, fileexists
        , comments, binary, tabData;

      // for HTML / IE9
      if (typeof(jQueryXDomainRequest) !== 'undefined' && jQueryXDomainRequest) {
        canUseAce = false;
      }

      if (typeof file === "string") {
        file = {name : file};
      }

      name     = file.name;
      type     = file.type || name.split(".").pop();
      content  = file.content || "";
      hidden   = file.hidden;
      comments = file.comments || [];
      binary   = file.binary || false;

      $tab     = $(TAB_TEMPLATE({name:escapeHtml(name)}));

      // A file created through the "+" control has no name until the user
      // commits one, which would otherwise render as the accessible names
      // " tab" and "Options for ". Fall back to a description of the state.
      if (!name) {
        $tab.find('.file-tab-link').attr('aria-label', 'Unnamed file tab');
        $tab.find('.tab-options-link').attr('aria-label', 'Options for this unnamed file');
      }

      // The per-tab options control opens the rename/delete menu, so a
      // view-only surface does not get one. Stylesheets already hide it for a
      // permanent tab, but hidden is not the same as absent: removing it means
      // there is no editing affordance to reach, by pointer, keyboard,
      // assistive technology or script.
      if (this.options.assignmentViewOnly) {
        $tab.find('.tab-options-link').remove();
      }

      self.$tabBar.find(".file-name").each(function(thisIndex) {
        if ($(this).text().toLowerCase() === name.toLowerCase()) {
          fileexists = true;
          index = thisIndex;
        }
      });

      if (fileexists && override) {
        var $content = $CONTENT_TEMPLATE.clone();
        $('textarea[name="' + self._files[index].name + '"]').val(content);

        if (self.$contentWrapper.children().eq(index).hasClass('active')) {
          self._files[index].editor.setValue(content);
        }
        else if (file.binary) {
          self._files[index].editor = createGhostAPI($content[0], {
            value : content
          });

          $content.html($BINARY_FILE_TEMPLATE);
          self.$contentWrapper.children().eq(index).replaceWith($content);
        }
        else {
          self._files[index].editor.destroy();

          self._files[index].editor = createDesktopAPI($content[0], {
              onFocus : function() {}
            , ext     : self._files[index].name.split(".").pop() || self.options.defaultFileExt
            , name    : name
            , value   : content
            , index   : index
            , editorOpts : self.options
          });

          self._files[index].editor.setValue(content);
          self.$contentWrapper.children().eq(index).replaceWith($content);
        }

        return this._files[index];
      }

      if (hidden) {
        if (self.options.owner && self.options.canHideTabs) {
          $tab.find('.file-name').addClass('hidden-file-indicator');
          $('<i class="fa fa-eye-slash file-icon"></i>').insertBefore( $tab.find('.file-name') );
        }
        else {
          $tab.hide();
        }
      }

      var editor = this._createEditor(file, index, canUseAce);

      tabData = {
        index : index
      };
      if (binary) {
        tabData.binary = true;
      }

      $tab.data(tabData);

      this.$tabBar.append($tab);

      var $last = this.$contentWrapper.find('.fixed-right').first();
      if ($last.length) {
        $last.before(editor.$content);
      }
      else {
        this.$contentWrapper.append(editor.$content);
      }

      if (index === 0) {
        if (this.options.mainEditable) {
          $tab.addClass('main-editable');
        }
        else {
          $tab.addClass('permanent');
          // A permanent file cannot be renamed, deleted or hidden, and the
          // stylesheet hides this control on such a tab. Hidden is not the
          // same as absent: left in the document it still opens the shared
          // menu, whose actions would then apply to the one file that must
          // not change. Removing it is what makes those actions unreachable
          // for this file, by pointer, keyboard, assistive technology or
          // script, and it changes no layout because the control is not
          // rendered on a permanent tab in the first place.
          $tab.find('.tab-options-link').remove();
        }
      }

      filedata = {
          name     : name
        , type     : type
        , $tab     : $tab
        , $content : editor.$content
        , editor   : editor.editor
        , comments : comments
        , binary   : binary
      };

      if (typeof hidden !== 'undefined') {
        filedata.hidden = hidden;
      }

      this._files.push(filedata);

      // emit event
      this.element.trigger({type: 'codeeditor.fileAdded', fileName: name, newFile: this._files[this._files.length - 1]});

      return this._files[this._files.length - 1];
    },

    hasFile : function(fileName) {
      var i;

      for (i = 0; i < this._files.length; i++) {
        if (this._files[i].name === fileName) {
          return true;
        }
      }

      return false;
    },

    getFile : function(fileName) {
      var i;

      for (i = 0; i < this._files.length; i++) {
        if (this._files[i].name === fileName) {
          return this._files[i].editor.getValue();
        }
      }

      return "";
    },

    selectFile : function(fileName) {
      var $tab, i;

      for (i = 0; i < this._files.length; i++) {
        if (this._files[i].name === fileName) {
          $tab = this._files[i].$tab;
          break;
        }
      }

      if (!$tab) {
        $tab = this.addFile(fileName).$tab;
        i    = this._files.length - 1;
      }

      this._selectTab(i);
    },

    serialize : function(opts) {
      var data = []
        , opts = _.extend(opts || { removeComments : false })
        , file, i, filedata;

      for (i = 0; i < this._files.length; i++) {
        if (this._files[i].binary) {
          continue;
        }

        file = this._files[i];
        filedata = {
            name    : file.name
          , content : file.editor.getValue()
        };

        if (typeof file.hidden !== 'undefined') {
          filedata.hidden = file.hidden;
        }

        if (!opts.removeComments && file.comments.length) {
          filedata.comments = file.comments;
        }

        data.push(filedata);
      }

      return JSON.stringify(data);
    },

    getAllFiles : function(options) {
      var files = {}
        , filter, values;

      if (!options || typeof options !== 'object') {
        filter = false;
        values = true;
      }
      else {
        filter = options.filter || false;
        values = options.values === undefined ? true : options.values;
      }

      if (filter && typeof filter !== "regexp") {
        filter = new RegExp(filter);
      }

      for(var i = 0; i < this._files.length; i++) {
        if (!filter || filter.test(this._files[i].name)) {
          if (this._files[i].binary) {
            continue;
          }

          files[this._files[i].name] = values
                                         ? this._files[i].editor.getValue()
                                         : 1;
        }
      }

      return files;
    },

    getAllVisibleFiles : function() {
      var files = {}
        , i;

      for (i = 0; i < this._files.length; i++) {
        if (!this._files[i].hidden && !this._files[i].binary) {
          files[this._files[i].name] = this._files[i].editor.getValue();
        }
      }

      return files;
    },

    addCommand : function(name, key, fn) {
      this._commands.push([name, key, fn]);
      for(var i = 0; i < this._files.length; i++) {
        this._files[i].editor.addCommand(name, key, fn);
      }
    },

    updateInfo : function(data) {
      if (!this.options.showInfo) return;

      this._currentInfo = data;

      $('.info-area .expander').hide();

      if (data) {
        $('.info-area').removeClass('empty').find('.info-quick').html(this._currentInfo.title);
        this.loadFullInfo(this._currentInfo);
      }
      else {
        // Nothing is selected, so nothing is wanted: drop the active key as
        // well as the pane, or a request already in flight would render into
        // a pane the user has moved away from.
        this._activeInfoKey = null;
        $('.info-area').removeClass('expanded').addClass('collapsed empty');
        this._syncInfoExpanderState();
      }
    },

    /**
     * Fetch and show the documentation for the keyword under the caret.
     *
     * Two things have to hold at once. Each document is fetched at most once
     * per session, which is why `INFO_CACHE` holds either the in-flight
     * request or the resolved body under one key per document. And the pane
     * must always show the keyword the caret is actually on, which is why
     * every render is gated on `_activeInfoKey`: the caret can move between
     * a request being made and its response arriving, and with two requests
     * outstanding the one that lands last would otherwise win regardless of
     * where the caret is. Marking a request "cancelled" was not enough,
     * because returning to a keyword whose request was still in flight
     * un-cancelled it while the newer one stayed live.
     *
     * @param {Object} info the token descriptor from the hints plugin
     * @param {String} info.url the document to fetch
     */
    loadFullInfo : function(info) {
      var self = this
          , cached
          // Cache on the document rather than on the request URL: the URL
          // carries a generated cache-busting prefix that differs on every
          // call, so keying on it re-fetches the same fragment each time the
          // caret returns to a keyword and never serves a hit.
          , cacheKey = info && info.url ? infoCacheKey(info.url) : null;

      if (!info || !info.url) return;

      // From here on, this is the only document whose arrival may render.
      this._activeInfoKey = cacheKey;

      cached = INFO_CACHE[cacheKey];

      // Already fetched: render it straight away, including the empty case,
      // which has to clear the previous keyword's body rather than leave it
      // standing under the new keyword's summary.
      if (typeof cached === "string") {
        this._renderFullInfo(cacheKey, cached);
        return;
      }

      // Already in flight for this same document. Its completion handler is
      // gated on the active key set above, so it will render for this caret
      // position; issuing a second request for the same URL would break the
      // one-fetch-per-document guarantee.
      if (cached) {
        return;
      }

      INFO_CACHE[cacheKey] = (function() {
        var req = $.get(info.url, '', 'html');
        req.done(function(data) {
          INFO_CACHE[cacheKey] = data || "";
          self._renderFullInfo(cacheKey, INFO_CACHE[cacheKey]);
        });
        req.fail(function() {
          // Drop the placeholder so a later attempt can retry rather than
          // being served a permanently pending request.
          delete INFO_CACHE[cacheKey];
        });
        return req;
      })();
    },

    /**
     * Show a fetched document, if it is still the one that is wanted.
     *
     * @param {String} cacheKey the document this content belongs to
     * @param {String} html the document body, possibly empty
     */
    _renderFullInfo : function(cacheKey, html) {
      var $infoArea = this.element.find('.info-area');

      // The caret has moved on since this was asked for: rendering now would
      // put one keyword's documentation under another keyword's summary.
      if (cacheKey !== this._activeInfoKey) {
        return;
      }

      if (html && html.length) {
        $infoArea.find('.info-full').html(html);
        $infoArea.find('.expander').show();
      }
      else {
        // This keyword has a summary but no document. Leaving the previous
        // keyword's body in place would attribute it to this keyword, and
        // `updateInfo` has already hidden the expander — so an expanded pane
        // would be stuck open with content that belongs elsewhere and no
        // control to close it. Clear it and collapse.
        $infoArea.find('.info-full').empty();
        $infoArea.find('.expander').hide();
        $infoArea.removeClass('expanded').addClass('collapsed');
      }

      this._syncInfoExpanderState();
    },

    registerPlugin : function(plugin) {
      var self = this;

      // Plugins publish through a single shared event bus, so binding a
      // second listener for a plugin that is already registered makes one
      // token change fan out into as many identical documentation requests as
      // there are listeners. Registration is therefore idempotent.
      if ($.inArray(plugin, this._plugins) !== -1) {
        return;
      }

      if (plugin.on) {
        plugin.on('info.token', function(e, data) {
          self.updateInfo(data);
        });
      }
      this._plugins.push(plugin);
      for(var i = 0; i < this._files.length; i++) {
        this._files[i].editor.registerPlugin(plugin, this);
      }
    },

    change : function(cb) {
      this._onChange = cb;
      for(var i = 0; i < this._files.length; i++) {
        this._files[i].editor.change(cb);
      }
    },

    reset : function(state) {
      var file;

      while(file = this._files.pop()) {
        file.editor.destroy();
        file.$content.remove();
        file.$tab.remove();
      }

      this._loadState(state);
    },

    refresh : function() {
      for (var i = 0; i < this._files.length; i++) {
        var content = this._files[i].editor.getValue();
        this._files[i].editor.destroy();

        var file = {
          name: this._files[i].name,
          type: this._files[i].type || this._files[i].name.split(".").pop(),
          content: content,
          binary: this._files[i].binary,
          image: this._files[i].image,
          comments: this._files[i].comments
        };

        var editor = this._createEditor(file, i, true);

        this._files[i].editor = editor.editor;
        this._files[i].editor.setValue(content);
        this.$contentWrapper.children().eq(i).replaceWith(editor.$content);
      }
      this._selectTab(0, true);
    },

    highlight: function(file_name, line_num) {
      // find index for this file
      var file_index = -1;
      for (var i = 0; i < this._files.length; i++) {
        if (this._files[i].name === file_name) {
          file_index = i;
          break;
        }
      }

      if (file_index >= 0) {
        var queue = this._files[file_index].$tab.hasClass("active") ? false : true;
        this._files[file_index].editor.highlight(line_num, queue);

        // add error icon to tab
        if (!this._files[file_index].$tab.has(CODE_ERROR_TAB_MARKER).length) {
          this._files[file_index].$tab.append(" <i class='" + CODE_ERROR_TAB_CLASS + "'></i>");
        }
      }
    },

    clearTabMarkers: function() {
      for (var i = 0; i < this._files.length; i++) {
        if (this._files[i].$tab.has(CODE_ERROR_TAB_MARKER).length) {
          this._files[i].$tab.find(CODE_ERROR_TAB_MARKER).remove();
        }
      }

      $('.ace_content').removeClass('attention-error');
      $('textarea.lined').removeClass('attention-error');
      $('.lineno').removeClass('lineselect');
    },

    gotoLine: function(line_num) {
      if (this._editor && this._editor.aceInstance) {
        this._editor.aceInstance.gotoLine(line_num);
      }
    },

    removeComments: function() {
      var i, j, commentId, w;

      for (i = 0; i < this._files.length; i++) {
        if (this._files[i].comments) {
          for (j = 0; j < this._files[i].comments.length; j++) {
            commentId = this._files[i].comments[j]._id;
            w = WIDGET_CACHE[commentId];

            this._files[i].editor.getSession().removeGutterDecoration(w.row, "trinket-comment");
            this._files[i].editor.getSession().removeGutterDecoration(w.row, "data-" + i + "-" + commentId);

            if (COMMENT_COLLAPSED[commentId]) {
              this._files[i].editor.getSession().removeGutterDecoration(w.row, "collapsed");
            }
            else {
              this._files[i].editor.getSession().removeGutterDecoration(w.row, "open");
            }

            WIDGET_CACHE[commentId].destroy();
            delete WIDGET_CACHE[commentId];
          }
        }
      }
    },

    activeTab: function() {
      return this._getCurrentVisibleTab();
    },
    setWrap: function(wrap) {
      for (var i = 0; i < this._files.length; i++) {
        this._files[i].editor.actuallySetWrap(wrap);
      };
    },
    setIndent: function(current){
      for (var i = 0; i < this._files.length; i++) {
        this._files[i].editor.actuallySetIndent(current);
      };
    }
  };

  (function(proto) {
    var apiMethods = "setValue getValue focus isFocused".split(" ");
    var wrapAPIMethod = function(methodName) {
      proto[methodName] = function() {
        var args = Array.prototype.slice.call(arguments);
        return this._editor[methodName].apply(this._editor, args);
      }
    };

    for(var i = 0; i < apiMethods.length; i++) {
      wrapAPIMethod(apiMethods[i]);
    }
  })(widget);

  $.widget('trinket.codeEditor', widget);
})(window.jQuery, window.TrinketIO, window.ace);
