(function () {
"use strict";

var $events   = $({})
  , CONSTANTS = {
      "True"             : 1
      , "False"          : 1
      , "None"           : 1
      , "NotImplemented" : 1
      , "Ellipsis"       : 1
      , "__debug__"      : 1
      , "float"          : 1
      , "int"            : 1
      , "long"           : 1
    }
  , Range
  , $tip        = $("<div class=\"editor-tooltip\"></div>").hide()
  , TOKEN_INFO  = {
      "and"        : "The boolean <code>and</code> operator."
      , "as"       : "Module aliasing: <code>import random as rnd</code>."
      , "assert"   : "Use <code>assert</code> to test assumptions."
      , "break"    : "Use <code>break</code> to stop the (loop) cycle."
      , "class"    : "Use <code>class</code> to create new user defined modules."
      , "continue" : "Use <code>continue</code> to skip to the next (loop) cycle."
      , "def"      : "A <code>def</code> defines a function."
      , "del"      : "Use <code>del</code> to delete an object."
      , "elif"     : "Use <code>elif</code> for else-if conditionals."
      , "else"     : "<code>else</code> is executed unless <code>if</code> is true."
      , "except"   : "Use <code>except</code> to catch an exception."
      , "exec"     : "<code>exec</code> is not yet implemented."
      , "finally"  : "<code>finally</code> blocks are always executed."
      , "for"      : "<code>for</code> iterates over a list in order."
      , "from"     : "Use <code>from</code> to import a specific part of a module."
      , "global"   : "<code>global</code> accesses variables defined outside functions"
      , "if"       : "Use <code>if</code> to conditionally execute statements."
      , "import"   : "Use <code>import</code> to use external modules."
      , "in"       : "<code>in</code> tests if a sequence contains a value."
      , "is"       : "<code>is</code> tests for object identity."
      , "lambda"   : "<code>lambda</code> creates a new anonymous function"
      , "not"      : "The boolean <code>not</code> operator."
      , "or"       : "The boolean <code>or</code> operator."
      , "pass"     : "<code>pass</code> does nothing at all, seriously."
      , "print"    : "Use <code>print</code> to write output."
      , "raise"    : "Use <code>raise</code> to create an exception."
      , "return"   : "Use <code>return</code> to exit a function."
      , "try"      : "Use <code>try</code> to capture exceptions."
      , "while"    : "Use <code>while</code> to loop until a condition is false."
      , "with"     : "<code>with</code> simplifies exception handling."
      , "yield"    : "<code>yield</code> exits a generator with a value."
    };

function oneTimeTipInitialization() {
  if ($tip.__initialized) return;
  $tip.__initialized = true;
  $('body').append($tip);
}

function initializePlugin(editor) {
  var variableMarkers = []
    , posToMarker     = []
    , hasMarkers      = false
    , tipIsVisible    = false
    , _active         = false
    , previousToken   = {}
    , menuHandlers, latestCode, changeTimeout;


  oneTimeTipInitialization();

  function removeAllMarkers() {
    if (hasMarkers) {
      removeMarkers(variableMarkers);
      hasMarkers = false;
    }
  }

  function removeMarkers(markers) {
    var marker, pos, i;
    if (markers && markers.length) {
      while (markers.length) {
        marker = markers.pop();
        pos    = posToMarker[marker.range.start.row][marker.range.start.column];
        for (i = 0; i < pos.length; i++) {
          if (pos[i].id === marker.id) {
            pos.splice(i, 1);
            break;
          }
        }
        editor.getSession().removeMarker(marker.id);
      }
    }
  }

  function addMarker(markers, location, klass, data) {
    var line  = location.line - 1
      , range = new Range(line, location.start, line, location.end)
      , marker = {
        id      : editor.getSession().addMarker(range, (klass || "variable-undefined"))
        , data  : data
        , range : range
      };

    markers.push(marker);
    hasMarkers = true;

    if (!posToMarker[line]) {
      posToMarker[line] = [];
    }
    if (!posToMarker[line][location.start]) {
      posToMarker[line][location.start] = [];
    }

    posToMarker[line][location.start].push(marker);
  }

  function walkAST(ast, visitors) {
    var type = ast && ast._astname
        , i, j, field;

    if (!type) return;

    visitors[type] && visitors[type].enter && visitors[type].enter(ast);
    if (ast._fields) {
      for (i = 0; i < ast._fields.length; i+=2) {
        field = ast._fields[i+1](ast);
        if (!field) continue;

        if (field._astname) {
          walkAST(field, visitors);
        }
        else if (field.constructor === Array && field.length
                 && field[0] && field[0]._astname) {
          for (j = 0; j < field.length; j++) {
            walkAST(field[j], visitors);
          }
        }
      }
    }
    visitors[type] && visitors[type].leave && visitors[type].leave(ast);
  }

  function parseCode() {
    var fileName  = "main.py"
      , code      = editor.getValue()
      , setupCode = window.TrinketApp.getKey("setup-code")
      , scopeVisitors, parse, ast, sym, scopeStack, currentScope;

    if (setupCode) {
      code = setupCode + "\n" + code;
    }

    removeAllMarkers();

    // @TODO: analyze packages imported with * to determine what
    // symbols they contain.
    // For now, if import * is used we just won't show any hints
    // since we don't know what is in the module scope
    if (/import\s+\*/.test(code)) {
      return;
    }

    try {
      parse        = Sk.parse(fileName, code);
      ast          = Sk.astFromParse(parse.cst, fileName, parse.flags);
      sym          = Sk.symboltable(ast, fileName);
    }
    catch(e) {
      // if (!parse) console.log("parse failed");
      // if (!ast) console.log("AST failed");
      // if (!sym) console.log("sym failed");
      // console.log(e);
      // if the code failed to parse, we can exit now
      return;
    }

    scopeStack    = [];
    currentScope  = sym.top;
    scopeVisitors = {
      enter : function(node) {
        scopeStack.push(currentScope);
        currentScope = sym.getStsForAst(node);
      }
      , leave : function(node) {
        currentScope = scopeStack.pop();
      }
    };

    // console.log("AST: ", ast);
    // console.log("SYM: ", sym);

    walkAST(ast, {
      "FunctionDef" : scopeVisitors
      , "ClassDef"  : scopeVisitors
      , "Name"      : {
          enter : function(node) {
            var name   = node.id.v;
            var symbol = currentScope.lookup(name);
            if (symbol.is_global()
                && !Sk.builtins.hasOwnProperty(name)
                && !CONSTANTS.hasOwnProperty(name)
                && (!sym.global.hasOwnProperty(name)
                    || (!sym.top.lookup(name).is_assigned()
                        && !sym.top.lookup(name).is_imported())))
              {
                addMarker(
                  variableMarkers
                  , {
                      line    : node.lineno
                      , start : node.col_offset
                      , end   : node.col_offset + name.length
                    }
                  , false
                  , {
                      message : "<code>" + name + "</code> is not defined. Did you mean something else?"
                    }
                );
            }
          }
      }
    });
  }

  function findTokenAndMarkerForPosition(row, column) {
    var token = editor.session.getTokenAt(row, column);

    if (!token || token.type === "text" && /^\s+$/.test(token.value)) {
      token = editor.session.getTokenAt(row, column+1);
    }

    if (token) {
      token.row = row;
      if (posToMarker[row] && posToMarker[row][token.start]) {
        token.marker = posToMarker[row][token.start][0];
      }
    }

    return token;
  }

  function onChange() {
    removeAllMarkers();

    if (changeTimeout) {
      clearTimeout(changeTimeout);
    }
    changeTimeout = setTimeout(parseCode, 883);
  }

  function onMouseMove(e) {
    var position, token, i;

    if (tipIsVisible) {
      $tip.hide();
      tipIsVisible = false;
    }

    if (!hasMarkers) return;

    position = e.getDocumentPosition();
    token    = findTokenAndMarkerForPosition(position.row, position.column);

    if (token && token.marker && token.marker.data && token.marker.data.message) {
      tipIsVisible = true;
      $tip.css({
        left  : e.domEvent.pageX
        , top : e.domEvent.pageY + 10
      }).html(token.marker.data.message).show();
    }
  }

  function onCursorChange(e, selection) {
    var cursor = selection.getCursor()
      , token  = findTokenAndMarkerForPosition(cursor.row, cursor.column);

    if (!token || (previousToken.row === token.row && previousToken.start === token.start)) {
      return;
    }

    if (token.type === "keyword" && TOKEN_INFO[token.value]) {
      $events.trigger("info.token", {
        token   : token
        , title : TOKEN_INFO[token.value]
        , url   : trinketConfig.prefix('/partials/python-docs/keywords/' + token.value + '.html')
      });
    }
    else if (token.marker) {
      $events.trigger("info.token", {
        token   : token
        , title : token.marker.data.message
      });
    }
    else {
      $events.trigger("info.token", undefined);
    }

    previousToken = token;
  }

  function activate() {
    if (_active) return;
    _active = true;

    if (!Range) {
      Range = ace.require("ace/range").Range
    }

    editor.on('change', onChange);
    editor.on('mousemove', onMouseMove);
    editor.session.selection.on('changeCursor', onCursorChange);

    parseCode();
  }

  function deactivate() {
    if (!_active) return;
    _active = false;
    editor.off('change', onChange);
    editor.off('mousemove', onMouseMove);
    editor.session.selection.off('changeCursor', onCursorChange);
  }

  function checkMode() {
    // this plugin is only active in python mode
    if (/python/.test(editor.session.getMode().$id)) {
      activate();
    }
    else {
      deactivate();
    }
  }

  editor.on('changeMode', function() {
    checkMode();
  });

  checkMode();
}

window.TrinketIO.export("python.editor.hints", {
  initialize : initializePlugin
  , on       : function() { return $events.on.apply($events, arguments); }
  , off      : function() { return $events.off.apply($events, arguments); }
});

})();
