var mailer        = require('../util/mailer'),
    Folder        = require('../models/folder'),
    _             = require('lodash'),
    nunjucks      = require('nunjucks'),
    fs            = require('fs'),
    ErrorEvent    = require('../models/errorEvent'),
    ClientMetric  = require('../models/clientMetric'),
    config        = require('config'),
    Store         = require('../util/store'),
    FileUtil      = require('../util/file'),
    recaptcha     = require('../util/recaptcha'),
    trinketStore  = Store.trinkets(),
    mongoose      = require('mongoose'),
    Draft         = require('../models/draft'),
    jwt           = require('jsonwebtoken'),
    errors        = require('@hapi/boom'),
    ObjectId      = mongoose.Types.ObjectId,
    // `url.parse()` emits DEP0169 on every call under --pending-deprecation. The
    // three asset sites below read `.pathname` off it; `parseLegacy` drives Node's
    // own `Url.prototype.parse` directly, so it is the same implementation without
    // the warning. Verified a drop-in on `.pathname` and `path.basename(.pathname)`
    // for absolute, relative, protocol-relative, data:, escaped and empty inputs,
    // and it throws the identical ERR_INVALID_URL for the malformed authorities.
    parseLegacy   = require('../util/url').parseLegacy,
    path          = require('path'),
    archiver      = require('archiver'),
    // mime 4.x is an ES module, so under CommonJS `require('mime')` resolves to the
    // module namespace and the Mime instance lives on `.default`; mime 1.2.11
    // exported the instance itself. `lookup`/`extension` became `getType`/`getExtension`.
    mime          = require('mime').default,
    sluggify      = require('limax'),
    JSZip         = require("jszip");

(function() {

var supportedDownloadFormats = {
    'json' : downloadJSON
  , 'zip'  : downloadZip
};

// Reproduces, exactly, the response that the legacy `reply(value)` compatibility
// shim produced (lib/util/routeParser.js:360-408 at the base commit). Measured on
// @hapi/hapi 21.4.10, that shim mapped a value to precisely three outcomes:
//
//   * a Boom          -> the Boom itself, so its own status is served (404/403/409/...)
//   * any other Error -> Boom.badImplementation(message): 500 carrying hapi's
//                        generic "An internal server error occurred" payload. The
//                        original message is logged, never echoed to the client.
//   * anything else   -> a chainable builder object. Handed to hapi that object
//                        serialised to `{}`, because JSON.stringify drops its
//                        function-valued properties: 200,
//                        `application/json; charset=utf-8`, content-length 2.
//                        `h.response({})` was verified byte-identical to this on
//                        status, content-type, content-length and body.
//
// Booms are RETURNED, never thrown: the preserved handler catch-all
// (routeParser.js:578-589) rewrites any thrown value to
// `Boom.badImplementation(...)`, which would silently turn every 404, 403 and 409
// in this controller into a 500. Measured: `return Boom.notFound()` -> 404 while
// `throw Boom.notFound()` -> 500.
function legacyReply(value, h) {
  if (value && value.isBoom) {
    return value;
  }

  if (value instanceof Error) {
    return errors.badImplementation(value.message);
  }

  // A non-Error value (a plain object, a string, a Buffer, a stream, undefined):
  // the builder was returned WITHOUT settling the deferred, so the outcome
  // depended entirely on what the call site did with that return value. Where the
  // builder was handed on to hapi it serialised to `{}`, which is what
  // `h.response({})` reproduces byte for byte - and the sites that did hand it on
  // return it explicitly themselves (`snapshot`, `downloadMain`, `downloadFile`,
  // `downloadJSON`). Where the call site discarded it instead, nothing was ever
  // answered, and no return value here can express that, so those branches keep
  // their non-response in place. Every legacyReply call site in this file passes
  // an Error today.
  return h.response({});
}

module.exports = {
  index : async function(request, h) {
    var font              = request.query.font              || "12px";
    var outputOnly        = request.query.outputOnly        || false;
    var toggleCode        = request.query.toggleCode        || false;
    var runOption         = request.query.runOption         || "";
    var runMode           = request.query.runMode           || "";
    var hideGeneratedCode = request.query.hideGeneratedCode || "";
    var showInstructions  = request.query.showInstructions  || "";

    var data = {
      footer            : true,
      font              : font,
      outputOnly        : outputOnly,
      toggleCode        : toggleCode,
      runOption         : runOption,
      runMode           : runMode,
      hideGeneratedCode : hideGeneratedCode,
      showInstructions  : showInstructions,
    };

    if (request.pre && request.pre.featuredTrinkets) {
      data.trinkets = request.pre.featuredTrinkets;
    }

    return request.success(data);
  },
  beta : async function(request, h) {
    return request.success({
      trinkets       : request.pre.featuredTrinkets,
      type           : request.params.type,
      lang           : 'javascript',
      trinket        : {},
      start          : 'result',
      copyingEnabled : false,
      footer         : true
    });
  },
  library : async function(request, h) {
    var path = request.params.path ? request.params.path.split('/') : [];
    var trinketId;

    if (path[0] && path[0] !== 'create' && path[0] !== 'copy') {
      trinketId = path[0];
    }

    // The two lookups below took a callback whose `err` argument was never
    // inspected, so a failed query (a CastError on a malformed id, for instance)
    // simply left `trinket` undefined and fell through to the /login redirect
    // rather than surfacing as a 500. `lookupTrinket` keeps that swallow: measured
    // at baseline, GET /library/trinkets/notavalidobjectid answers 302 -> /login.
    var lookupTrinket = function(id) {
      return Trinket.findById(id).catch(function() { return null; });
    };

    if (request.user) {
      if (trinketId) {
        var trinket = await lookupTrinket(trinketId);

        if (trinket) {
          if (trinket._owner && trinket._owner.toString() === request.user.id) {
            return request.success();
          }

          return h.redirect('/' + trinket.lang + '/' + trinket.shortCode);
        }

        return h.redirect('/login');
      }
      else {
        return request.success();
      }
    }
    else if (trinketId) {
      var anonTrinket = await lookupTrinket(trinketId);

      if (anonTrinket) {
        return h.redirect('/' + anonTrinket.lang + '/' + anonTrinket.shortCode);
      }

      return h.redirect('/login');
    }
    else {
      return h.redirect('/login');
    }
  },
  // Thin wrapper over `listCore`, which holds the listing logic so that
  // folders.trinkets can reach it without re-entering this route through
  // server.inject (@hapi/shot emits DEP0169 under injection). This handler keeps
  // its own `request.success` projection; folders.trinkets applies its own.
  list : async function(request, h) {
    // Called OUTSIDE the try on purpose. listCore builds the match and pipeline
    // synchronously, so a bad input -- `new ObjectId('nonsense')` for the folder,
    // say -- throws synchronously here, just as it did from the handler body at
    // baseline, and propagates to the route catch-all which logs the stack before
    // answering 500. Only the asynchronous failures were caught locally at
    // baseline (`.catch(function(err) { return reply(err); })`), so only those are
    // caught below.
    var pending = listCore({
        sort   : request.query.sort
      , folder : request.query.folder
      , user   : request.query.user
      , from   : request.query.from
      , offset : request.query.offset
      , limit  : request.query.limit
    }, request.user);

    try {
      var trinkets = await pending;

      return request.success({ data : trinkets });
    }
    catch (err) {
      return legacyReply(err, h);
    }
  },
  getById : async function(request, h) {
    var data = request.pre.trinket;

    if (!data._owner) {
      return request.success({ data : data });
    }

    if (request.user && request.pre.trinket._owner && request.user.id.toString() === request.pre.trinket._owner.toString()) {
      data.username = request.user.username;

      return request.success({ data : data });
    }
    else {
      return User.findById( data._owner)
        .then(function(user) {
          if (user) {
            data.username = user.username;
          }

          return request.success({ data : data });
        })
        .catch(function(err) {
          return request.success({ data : data });
        });
    }
  },

  // admin route for creating a copy of a trinket for a user
  grant : async function(request, h) {
    var trinket = request.pre.trinket.copy(request.pre.user.id, {noSnapshot:true});
    return trinket.save()
      .then(request.success)
      .catch(request.fail);
  },

  update : async function(request, h) {
    var trinket = request.pre.trinket;
    trinket.set(request.payload);

    if (request.payload['published']) {
      var address = request.headers['x-forwarded-for'] || '';
      var d = new Date();

      var created = new Date(request.user.created);
      var timeDifference = d - created;
      var daysDifference = Math.floor(timeDifference / (1000 * 60 * 60 * 24));

      console.log('trinket published:', d, trinket.lang, trinket.shortCode, request.user.username, daysDifference, address);
    }

    // note: snapshot isn't passed to queues below.
    // assumption is that this data will be updated
    // via the worker in the snapshot job

    return trinket.save()
      .then(function() {
        if (trinket.folder && trinket.folder.folderId) {
          // Update trinket info in folder (fire-and-forget)
          Folder.findById(trinket.folder.folderId)
            .then(function(folder) {
              if (folder) {
                return folder.updateTrinket({
                    id           : trinket.id
                  , name         : trinket.name
                  , instructions : trinket.description
                });
              }
            })
            .catch(function(err) {
              console.error('Failed to update folder trinket:', err.message);
            });
        }

        return Promise.resolve();
      })
      .then(function() {
        return request.success({
          success : true
        });
      })
      .catch(request.fail);
  },

  create : async function(request, h) {
    var trinket   = new Trinket(request.payload),
        emailSecret, emailToken, sessionKey;

    if (request.user) {
      trinket.set('_creator', request.user._id);
      if (request.query.library) {
        trinket.set('_owner', request.user._id);
      }
    }

    // generated client-side
    if (trinket.shortCode) {
      trinket.verifyShortCode(request.payload._timestamp);
    }

    if (trinket.assets && trinket.assets.length) {
      trinket.assets.forEach(function(asset) {
        if (!asset.id) {
          // likely a data:image url
          if (asset.url.indexOf('data:image') >= 0) {
            asset.url = asset.url.slice( asset.url.indexOf('data:image') );
          }

          asset.id = mongoose.Types.ObjectId();
        }
      });
    }

    return trinket.save()
      .then(function(doc) {
        emailSecret = config.app.mail.secret + doc.shortCode;
        emailToken  = jwt.sign({ shortCode: doc.shortCode }, emailSecret);
        sessionKey  = 'emailToken:' + doc.shortCode;
        request.yar.set(sessionKey, emailToken);

        // `return` added: the value of this chain is now the handler's response.
        // Baseline reached the same response through the removed deferred, so the
        // wire result is unchanged (measured: 200 with the projected {data:...}).
        return request.success({data:doc});
      })
      .catch(function(err) {
        return legacyReply(err, h);
      });
  },

  createFork : async function(request, h) {
    var trinket = new Trinket(request.payload),
        meta = {
          referer : request.headers.referer || '',
          address : request.headers['x-forwarded-for'] || '',
          info    : {
            forkId : trinket._id
          }
        },
        parent = request.pre.trinket,
        emailSecret, emailToken, sessionKey;

    if (request.user) {
      meta._actor = request.user._id;
      trinket.set('_creator', request.user._id);
      if (request.query.library) {
        trinket.set('_owner', request.user._id);
      }
    }

    trinket.set('_parent', parent._id);
    trinket.set('lang', parent.lang);

    // generated client-side
    if (trinket.shortCode) {
      trinket.verifyShortCode(request.payload._timestamp);
    }

    if (parent.description) {
      trinket.set('description', parent.description);
    }

    if (request.payload._remix && parent.name) {
      trinket.set('name', parent.name + ' Remix');
    }

    return Trinket.findByIdAndUpdateMetrics(parent.id, 'forks', meta)
      .then(function() {
        return trinket.save();
      })
      .then(function(savedTrinket) {
        emailSecret = config.app.mail.secret + savedTrinket.shortCode;
        emailToken  = jwt.sign({ shortCode: savedTrinket.shortCode }, emailSecret);
        sessionKey  = 'emailToken:' + savedTrinket.shortCode;
        request.yar.set(sessionKey, emailToken);

        return request.success({ data : savedTrinket });
      })
      .catch(function(err) {
        return legacyReply(err, h);
      });
  },

  updateMetrics : async function(request, h) {
    var meta = {
          referer : request.headers.referer || '',
          address : request.headers['x-forwarded-for'] || ''
        },
        metric = Object.keys(request.payload)[0];

    if (!metric) {
      // if no metric is supplied, just return the current trinket state
      //
      // Left in its callback form deliberately. Passing a callback executes the
      // query, and returning the Query object as well means the framework awaits
      // it and executes it a SECOND time, which Mongoose 6 rejects with
      // "Query was already executed". Measured at baseline: this branch answers
      // 500, not the trinket state its comment intends. Rewriting it to await the
      // query once would turn that 500 into a 200 and change observable
      // behaviour, so the shape is preserved exactly.
      return Trinket.findById(request.params.trinketId, function(err, trinket) {
        return request.success({data:trinket});
      });
    }

    if (request.user) {
      meta._actor = request.user._id;
    }

    return Trinket.findByIdAndUpdateMetrics(request.params.trinketId, metric, meta)
      .then(function(trinket) {
        return request.success({data : trinket});
      })
      .catch(function(err) {
        return legacyReply(err, h);
      });
  },

  remove : async function(request, h) {
    var trinket  = request.pre.trinket
      , promises = [];

    if (trinket.folder && trinket.folder.folderId) {
      promises.push(
        Folder.findById(trinket.folder.folderId)
          .then(function(folder) {
            if (folder) {
              return folder.removeTrinket(trinket.id);
            }
          })
      );
    }

    return Promise.all(promises).then(function() {
      // Use soft delete instead of hard delete
      return trinket.softDelete()
        .then(function() {
          return request.success({data : 1})
        });
    }).catch(function(err) {
      return legacyReply(err, h);
    });
  },

  getByShortCode : async function(request, h) {
    var metric            = request.query.e ? 'emailViews' : 'linkViews';
    var font              = request.query.font              || "12px";
    var outputOnly        = request.query.outputOnly        || false;
    var toggleCode        = request.query.toggleCode        || false;
    var runOption         = request.query.runOption         || "";
    var runMode           = request.query.runMode           || "";
    var hideGeneratedCode = request.query.hideGeneratedCode || "";
    var showInstructions  = request.query.showInstructions  || "";

    var preTrinket = request.pre.trinket,
        extension  = request.pre.extension,
        updateMetrics, displayTrinket;

    var meta       = {
      referer : request.headers.referer || '',
      address : request.headers['x-forwarded-for'] || ''
    };

    if (request.user) {
      meta._actor = request.user._id;
    }

    if (request.user && request.user.id == preTrinket._owner) {
      updateMetrics = function() { return Promise.resolve(); };
    }
    else {
      updateMetrics = function() {
        return Trinket.findByIdAndUpdateMetrics(preTrinket.id, metric, meta);
      }
    }

    if (extension) {
      if (supportedDownloadFormats[extension]) {
        // `h` is forwarded in place of the removed `reply`: downloadJSON and
        // downloadZip are not invoked by the framework directly, but they PRODUCE
        // this route's response, so they need the toolkit and their value is
        // returned straight through.
        return supportedDownloadFormats[extension](request, h);
      }
      else {
        // returned, not thrown: the preserved catch-all rewrites a thrown Boom to
        // badImplementation, which would turn this 404 into a 500
        return errors.notFound();
      }
    }

    return updateMetrics()
      .then(function(trinket) {
        displayTrinket = trinket || preTrinket;
      })
      .then(function() {
        return request.success({
          trinket    : displayTrinket,
          trinkets   : request.pre.featuredTrinkets,
          font       : font,
          footer     : true,
          outputOnly : outputOnly,
          toggleCode : toggleCode,
          runOption  : runOption,
          runMode    : runMode,
          hideGeneratedCode : hideGeneratedCode,
          showInstructions  : showInstructions
        });
      })
      .catch(function(err) {
        return legacyReply(err, h);
      });
  },

  embed : async function(request, h) {
    var runOption      = ''
      , runMode        = ''
      , displayOption  = false
      , outputOnly     = false
      , toggleCode     = false
      , toggleEditor   = false
      , upgradeNeeded  = true
      , configurable   = false
      , downloadable   = false
      , uploadable     = false
      , leftMenu       = false
      , noReset        = false
      , hideGeneratedCode = false
      , hideInstructions  = false
      , showInstructions  = false
      , copyingEnabled    = true
      , sharingEnabled    = true
      , snapshot          = request.query.snapshot || false
      , start             = snapshot ? 'result' : false
      , outputTabs        = 'threeTabs' // only used for blocks
      , query, isOwner, promise, meta, remix, draft
      , emailSecret, emailToken
      , sessionKey, library, serversideUser;

    meta = {
      referer : request.headers.referer || '',
      address : request.headers['x-forwarded-for'] || ''
    };

    if (request.user) {
      meta._actor = request.user._id;
    }

    library = meta.referer.indexOf(config.url + '/library') === 0;

    if (request.pre.trinket) {
      var ownerPromise = User.findById(request.pre.trinket._owner);

      if (request.user) {
        query = {
          trinket     : request.pre.trinket.id,
          user        : request.user.id,
          lastUpdated : request.pre.trinket.codeLastUpdated || request.pre.trinket.lastUpdated
        };

        promise = Trinket.findRemix(request.pre.trinket.id, request.user.id)
          .then(function(trinket) {
            if (trinket) {
              remix             = trinket;
              query.trinket     = remix.id;
              query.lastUpdated = remix.codeLastUpdated || remix.lastUpdated;
            }

            return config.app.nodraft.indexOf(request.params.lang) >= 0
              ? Promise.resolve() : Draft.findOneMoreRecent(query);
          });
      }
      else {
        promise = Promise.resolve();
      }

      promise = promise.then(function(draftFound) {
        if (draftFound) {
          draft = draftFound;
        }

        return ownerPromise
          .then(function(_owner) {
            return (request.query.sharePage || snapshot || (request.user && request.user.id == request.pre.trinket._owner))
              ? Promise.resolve([request.pre.trinket, _owner])
              : Trinket.findByIdAndUpdateMetrics(request.pre.trinket.id, 'embedViews', meta).then(function(t) { return [t, _owner]; });
          });
      });
    }
    else {
      promise = Promise.resolve([{}, undefined]);
    }

    return promise
      .then(function(result) {
        var trinket = result[0], trinketOwner = result[1];
        // if there is a remix, preserve the original as `.original`
        // and serve the remix instead.
        if (remix) {
          remix.original = trinket;
          trinket = remix;
        }

        isOwner = trinket._owner && request.user && trinket._owner == request.user.id;

        if (config.app.outputOnly.indexOf(request.params.lang) >= 0) {
          displayOption = true;
          if (request.query.outputOnly || snapshot) {
            outputOnly = true;
          }
        }
        if (config.app.toggleCode.indexOf(request.params.lang) >= 0) {
          displayOption = true;
          if (request.query.toggleCode) {
            toggleCode = true;
          }
        }
        if (request.query.runOption && typeof(config.app.runOption[request.params.lang]) !== 'undefined') {
          if (config.app.runOption[request.params.lang].indexOf(request.query.runOption) >= 0) {
            runOption = request.query.runOption;
          }
        }
        if (!runOption && request.query.runMode === "console") {
          runMode = runOption = request.query.runMode;
        }
        else if (request.query.runMode) {
          runMode = request.query.runMode;
        }

        // check permissions
        if (request.user && request.user.hasPermission('create-' + request.params.lang + '-trinket')) {
          upgradeNeeded = false;
        }

        if (config.app.configurable.indexOf(request.params.lang) >= 0) {
          // tests permissions check moved to html side
          if (request.user) {
            configurable = true;
          }
        }

        if (config.app.toggleEditor.indexOf(request.params.lang) >= 0) {
          toggleEditor = true;
        }

        if (config.app.downloadable.indexOf(request.params.lang) >= 0 && !outputOnly) {
          downloadable = true;
        }
        if (config.app.uploadable.indexOf(request.params.lang) >= 0 && !outputOnly) {
          uploadable = true;
        }

        // somewhat specific to python console only mode
        if (outputOnly && /python/.test(request.params.lang) && runOption === 'console') {
          noReset = true;
          configurable = false;
        }

        if (request.query.hideGeneratedCode && config.app.hideGeneratedCode.indexOf(request.params.lang) >= 0) {
          hideGeneratedCode = true;
        }

        if (trinket.shortCode) {
          emailSecret = config.app.mail.secret + trinket.shortCode;
          emailToken  = jwt.sign({ shortCode: trinket.shortCode }, emailSecret);
          if (library) {
            sessionKey  = 'emailToken:' + trinket.shortCode;
            request.yar.set(sessionKey, emailToken);
          }
        }

        if (request.query.hideInstructions || outputOnly || snapshot) {
          hideInstructions = true;
        }

        if (!hideInstructions && request.query.showInstructions && trinket.description && trinket.description.length) {
          showInstructions = true;
          start = 'instructions';
        }

        if (!start && request.query.start && config.app.autorun.indexOf(request.params.lang) >= 0) {
          start = request.query.start;
        }

        if (hideGeneratedCode) {
          outputTabs = 'twoTabs';
        }
        if (hideInstructions || (!isOwner && !trinket.description)) {
          outputTabs = outputTabs === 'threeTabs' ? 'twoTabs' : 'noTabs';
        }
        if (snapshot) {
          outputTabs = 'noTabs';
        }

        return Promise.resolve().then(function() {
          return promise;
        }).then(function() {
          if ((request.query.noSharing && request.query.noRemix) || !config.app.embed.enableCopyRemix) {
            copyingEnabled = false;
          }

          if (request.query.noSharing || outputOnly || runMode === 'calculator') {
            sharingEnabled = false;
          }
          // notShareable changed to mean not shareable by anonymous user
          if (config.app.notShareable && config.app.notShareable.indexOf(request.params.lang) >= 0 && !request.user) {
            sharingEnabled = false;
          }

          if (trinketOwner && trinketOwner.hasPermission('visitors-serverside-premium')) {
            serversideUser = trinketOwner;
          }

          return request.success({
            sharingEnabled : sharingEnabled,
            copyingEnabled : copyingEnabled,
            downloadable   : downloadable,
            uploadable     : uploadable,
            configurable   : configurable,
            trinket        : trinket,
            draft          : draft,
            isOwner        : isOwner,
            start          : start,
            category       : request.query.category,
            lang           : request.params.lang,
            outputOnly     : outputOnly,
            leftMenu       : request.query.leftMenu || false,
            noReset        : noReset,
            shareType      : request.query.shareType || request.params.lang,
            internal       : meta.referer.indexOf(config.url) === 0,
            library        : library,
            toggleCode     : toggleCode,
            toggleEditor   : toggleEditor,
            runOption      : runOption,
            runMode        : runMode,
            displayOption  : displayOption,
            upgradeNeeded  : upgradeNeeded,
            emailToken     : emailToken,
            snapshot       : snapshot,
            hideGeneratedCode   : hideGeneratedCode,
            hideInstructions    : hideInstructions,
            showInstructions    : showInstructions,
            outputTabs          : outputTabs,
            serverside          : setServersideApi(request, serversideUser),
            serversideUser      : serversideUser,
            canEnableTests      : request.user && request.user.hasPermission('enable-trinket-tests')
          });
        });
      })
      .catch(function(err) {
        return legacyReply(err, h);
      });
  },
  assignment : async function(request, h) {
    return request.success({
        trinket      : request.pre.trinket
      , lang         : request.params.lang
      , assignment   : true
      , outputTabs   : 'twoTabs'
      , downloadable : config.app.downloadable.indexOf(request.params.lang) >= 0
      , serverside   : setServersideApi(request)
    });
  },
  assignmentFeedback : async function(request, h) {
    var query;

    query = {
      trinket     : request.pre.trinket.id,
      user        : request.user.id,
      lastUpdated : request.pre.trinket.codeLastUpdated || request.pre.trinket.lastUpdated
    };

    return Draft.findOneMoreRecent(query)
      .then(function(draftFound) {
        return request.success({
            trinket      : request.pre.trinket
          , draft        : draftFound
          , lang         : request.params.lang
          , outputTabs   : 'twoTabs'
          , downloadable : config.app.downloadable.indexOf(request.params.lang) >= 0
          , serverside   : setServersideApi(request)
          , assignmentFeedback : true
        });
      });
  },
  viewOnly : async function(request, h) {
    return request.success({
        trinket      : request.pre.trinket
      , lang         : request.params.lang
      , viewOnly     : true
      , assignment   : true
      , outputTabs   : 'twoTabs'
      , downloadable : config.app.downloadable.indexOf(request.params.lang) >= 0
      , serverside   : setServersideApi(request)
    });
  },
  email : async function(request, h) {
    if (!mailer.isConfigured()) {
      return request.fail({
        message: "Email is not configured. Sharing via email is not available."
      });
    }

    // lib/util/recaptcha.js keeps its callback interface -- it is a utility, not a
    // lifecycle method, so the await boundary is created HERE at the call site
    // rather than pushed into the module.
    //
    // THE PROMISE HAS NO REJECT PATH, DELIBERATELY. Two of recaptcha.verify's six
    // outcomes never invoke the callback at all: on a transport failure `response`
    // is undefined and reading `response.statusCode` throws a TypeError, and a 200
    // carrying a non-JSON body throws out of JSON.parse. Both are dispatched on a
    // later tick and surface as uncaught exceptions rather than as a value. At
    // baseline this handler had already returned undefined, so its response was
    // owed to a deferred that those two faults never settled, and the request
    // simply hung. An unsettled promise reproduces that precisely. Giving the
    // promise a reject path -- or a timeout -- would manufacture a response that
    // baseline does not produce.
    var result = await new Promise(function(resolve) {
      recaptcha.verify(request.payload['g-recaptcha-response'], resolve);
    });

    if (result.success) {
        var shareUrl = config.url + '/' + request.pre.trinket.lang + '/' + request.pre.trinket.shortCode + '?e=1';

        var embedUrl = config.url + '/embed/' + request.pre.trinket.lang + '/' + request.pre.trinket.shortCode;
        if (request.payload.start) embedUrl += '?start=' + request.payload.start;

        var embedWidth  = request.payload.width  || 100;
        var embedHeight = request.payload.height || 356;

        var meta     = {
          referer : request.headers.referer || '',
          address : request.headers['x-forwarded-for'] || ''
        };

        var message = nunjucks.render('emails/shareTrinket', {
          name         : request.payload.name,
          snapshot     : request.pre.trinket.snapshot,
          shareUrl     : shareUrl,
          embedUrl     : embedUrl,
          embedWidth   : embedWidth,
          embedHeight  : embedHeight
        });

        var subject = request.payload.name + ' shared their trinket with you!';

        if (request.user) {
          meta._actor = request.user._id;
        }

        var options = {
            html : message
          , type : 'trinket-share'
        };

        if (request.payload.replyTo) {
          options.replyTo = request.payload.replyTo;
        }

        if (meta.address) {
          options.address = meta.address;
        }

        return mailer.send(request.payload.email, subject, options)
          .then(function() {
            return Trinket.findByIdAndUpdateMetrics(request.pre.trinket.id, 'emailShares', meta);
          })
          .then(function(trinket) {
            return request.success();
          })
          .catch(function(err) {
            if (err === "threshold exceeded") {
              // reply(Boom) settled the deferred with the Boom, so this answered
              // 403 -- returning it reproduces that exactly
              return errors.forbidden();
            }

            // PRESERVED DEFECT: the legacy `reply()` -- called with no argument --
            // returned the chainable builder WITHOUT settling the deferred, and the
            // recaptcha callback discarded that return value, so no response was
            // ever produced and the request hung until the client gave up. An
            // unsettled promise is the faithful reproduction. Reachable only when
            // mail IS configured and mailer.send rejects with something other than
            // the string "threshold exceeded". Documented as a preserved quirk;
            // this file carries no approved deviation, so it is not "fixed" into a
            // 500 or a 200 here.
            return new Promise(function() {});
          });
    }
    else {
      return request.success();
    }
  },
  snapshot : async function(request, h) {
    if (request.payload.snapshotData) {
      var img  = request.payload.snapshotData;
      var data = img.replace(/^data:image\/\w+;base64,/, "");
      // Buffer() is deprecated (DEP0005); Buffer.from produces an identical buffer
      var buf  = Buffer.from(data, 'base64');

      var timestamp  = new Date().getTime();
      var imagename  = request.pre.trinket.shortCode + '-' + timestamp + '.png';
      var localfile  = config.workers.trinkets.outputDir + imagename;

      var fileinfo = {
        path : config.workers.trinkets.outputDir,
        name : imagename
      };

      request.pre.trinket.snapshot = config.aws.buckets.snapshots.host + '/' + imagename;

      return new Promise(function(resolve, reject) {
        FileUtil.uploadSnapshotFromBuffer(imagename, buf, function(err) {
          if (err) reject(err);
          else resolve();
        });
      })
        .then(function() {
          return request.pre.trinket.save();
        })
        .then(request.success)
        .catch(request.fail);
    }

    // PRESERVED DEFECT: `reply({status:"success"})` handed back the chainable
    // builder without ever settling the deferred, and the framework serialised the
    // builder itself -- whose only own properties are functions, which
    // JSON.stringify drops. Measured at baseline: 200,
    // `application/json; charset=utf-8`, content-length 2, body `{}`. The declared
    // {status:"success"} payload has never reached a client. `h.response({})` was
    // verified byte-identical to that on all four axes.
    return h.response({});
  },
  interactions : async function(request, h) {
    var trinket = request.pre.trinket;

    return Interaction.findByTrinketId(trinket.id)
      .then(function(result) {
        return request.success({data:result});
      })
      .catch(function(err) {
        return legacyReply(err, h);
      });
  },
  addToList : async function(request, h) {
    trinketStore.unshift(request.pre.trinket.lang, request.query.name, request.pre.trinket.id);
    return request.success({
      trinket : request.pre.trinket
    });
  },
  namedList : async function(request, h) {
    return request.success(request.pre.namedTrinketList || []);
  },
  removeFromList : async function(request, h) {
    trinketStore.remove(request.params.lang, request.query.name, request.pre.trinket.id);
    return request.success();
  },
  logError : async function(request, h) {
    var error = new ErrorEvent(request.payload);

    // The callback never inspected `err`, so a failed save still answered with
    // success. The await keeps the original ordering -- the response was produced
    // from inside the callback, i.e. after the save settled -- and the `.catch`
    // keeps the failure swallowed rather than turning it into a 500.
    await error.save().catch(function() {});

    return request.success();
  },
  logClientMetric : async function(request, h) {
    var values = { /* required parameters */
        event_type : request.payload.event_type
      , lang       : request.payload.lang
      , duration   : request.payload.duration
    }, payload = { /* optional parameters */
        'trinketId' : 'trinket'
      , 'message'   : 'message'
      , 'session'   : 'session'
    }, headers = {
        'x-forwarded-for' : 'address'
      , 'referer'         : 'referer'
      , 'user-agent'      : 'user_agent'
    };

    if (request.user) {
      values.user = request.user.id;
    }

    Object.keys(payload).forEach(function(key) {
      if (request.payload[key]) {
        values[ payload[key] ] = request.payload[key];
      }
    });
    Object.keys(headers).forEach(function(key) {
      if (request.headers[key]) {
        values[ headers[key] ] = request.headers[key];
      }
    });

    return ClientMetric.addMetric(values)
      .then(function(result) {
        return request.success();
      })
      .catch(function(err) {
        return request.success();
      });
  },
  draft : async function(request, h) {
    var query = {
      user    : request.user.id,
      trinket : request.params.trinketId
    };
    var update = {
      user     : request.user.id,
      trinket  : request.params.trinketId
    };
    if (request.payload.code) {
      update.code = request.payload.code;
    }
    if (request.payload.assets) {
      update.assets = request.payload.assets;
    }
    if (request.payload.settings) {
      update.settings = request.payload.settings;
    }
    if (request.payload.zipCode) {
      var zip = new JSZip();

      // PRESERVED BASELINE BEHAVIOUR - the chain is deliberately left DETACHED, as
      // it was at baseline, and the promise boundary is created here at the
      // lifecycle method instead. T-1 is satisfied by returning a promise; it does
      // not require returning THIS chain, and returning it would change two
      // measured outcomes at once.
      //
      // At baseline the handler returned nothing and the shim awaited a deferred
      // that the chain settled from inside itself: `request.success(...)` resolved
      // that deferred and returned the same response object into the chain. Both
      // halves are reproduced here - settling is now `resolve(...)`, because
      // request.success returns the toolkit response (routeParser.js:303), and the
      // one call whose value is read downstream still passes it on.
      //
      // On a malformed zipCode that second half is what mattered: loadAsync rejects,
      // the first onRejected answers the request AND returns the response object
      // into the chain, and the next onFulfilled runs
      // JSON.parse("[object Object]") -- which throws inside a chain with no
      // downstream rejection handler. Under Node 22's default
      // --unhandled-rejections=throw that unhandled rejection TERMINATES THE SERVER
      // PROCESS (measured). Returning the chain, or attaching a `.catch` to it,
      // would swallow that rejection and answer 500 instead; there is no approved
      // deviation for this branch (the one decided deviation in lib/controllers is
      // the files.js image stream, AAP 0.7), so the crash stands.
      return await new Promise(function(resolve) {
        zip.loadAsync(request.payload.zipCode, { base64: true })
          .then(function(content) {
            return content.file("zipCode").async("string");
          }, function(err) {
            // Answers the request AND returns the same value into the chain, which
            // is what request.success did at baseline: the JSON.parse below then
            // throws on that object and its rejection stays unhandled.
            var response = request.success();
            resolve(response);
            return response;
          })
          .then(function(code) {
            update.code = JSON.parse(code);
            return Draft.findOneAndUpdate(query, update)
              .then(function() {
                resolve(request.success({
                  success : true
                }));
              })
              .catch(function() {
                resolve(request.success());
              });
          }, function(err) {
            resolve(request.success());
          });
      });
    }
    else {
      return Draft.findOneAndUpdate(query, update)
        .then(function() {
          return request.success({
            success : true
          });
        })
        .catch(function() {
          return request.success();
        });
    }
  },
  discardDraft : async function(request, h) {
    var query = {
      user    : request.user.id,
      trinket : request.params.trinketId
    };
    return Draft.discard(query)
      .then(function() {
        return request.success({
          success : true
        });
      })
      .catch(function() {
        return request.success();
      });
  },
  autosave : async function(request, h) {
    var trinket = request.pre.trinket;

    if (request.user.id.toString() === request.pre.trinket._creator.toString()) {
      if (request.payload.code) {
        trinket.set('code', request.payload.code);
      }
      if (request.payload.assets) {
        trinket.set('assets', request.payload.assets);
      }
      if (request.payload.settings) {
        trinket.set('settings', request.payload.settings);
      }

      //trinket.set(request.payload);
      trinket.submissionState = "modified";

      if (request.payload.zipCode) {
        var zip = new JSZip();

        // PRESERVED BASELINE BEHAVIOUR, the same shape as trinket.draft above: the
        // chain stays DETACHED and the promise boundary is created here at the
        // lifecycle method. T-1 is satisfied by the returned promise, not by
        // returning the chain.
        //
        // Baseline's `reply(err)` did two things for an Error, and both are kept:
        // it settled the deferred with `Boom.badImplementation(err.message)` - the
        // value `legacyReply` computes - and it returned that same Boom into the
        // chain. So on a malformed zipCode the request answered 500 and the next
        // onFulfilled then ran JSON.parse on the Boom, which threw with no
        // downstream rejection handler: an unhandled rejection that TERMINATES THE
        // SERVER PROCESS under Node 22's default --unhandled-rejections=throw
        // (measured). Returning the chain, or adding a `.catch`, would swallow that
        // rejection; nothing authorizes that here (the one decided deviation in
        // lib/controllers is the files.js image stream, AAP 0.7), so it is kept.
        return await new Promise(function(resolve) {
          zip.loadAsync(request.payload.zipCode, { base64: true })
            .then(function(content) {
              return content.file("zipCode").async("string");
            }, function(err) {
              // Answers the request AND returns the same Boom into the chain, as
              // `reply(err)` did: the JSON.parse below throws on it and that
              // rejection stays unhandled.
              var response = legacyReply(err, h);
              resolve(response);
              return response;
            })
            .then(function(code) {
              trinket.set('code', JSON.parse(code));
              return trinket.save()
                .then(function() {
                  resolve(request.success({
                    success : true
                  }));
                }).catch(function(err) {
                  resolve(legacyReply(err, h));
                });
            }, function(err) {
              resolve(legacyReply(err, h));
            });
        });
      }
      else {
        return trinket.save()
          .then(function() {
            return request.success({
              success : true
            });
          }).catch(function(err) {
            return legacyReply(err, h);
          });
      }
    }
    else {
      return errors.forbidden();
    }
  },
  addToFolder : async function(request, h) {
    var folder  = request.pre.folder
      , trinket = request.pre.trinket
      , checkCurrent;

    if (request.user.hasPermission("add-trinket", "folder", { id : folder.id })) {
      checkCurrent = trinket.folder && trinket.folder.folderId
        ? Folder.findById(trinket.folder.folderId) : Promise.resolve();

      return checkCurrent
        .then(function(inFolder) {
          return inFolder
            ? inFolder.removeTrinket(trinket.id) : Promise.resolve();
        })
        .then(function() {
          return folder.addTrinket(trinket, request.user);
        })
        .then(function() {
          return trinket.addFolder(folder);
        })
        .then(function() {
          return request.success({
            success : true
          });
        })
        .catch(function(err) {
          return legacyReply(err, h);
        });
    }
    else {
      return errors.forbidden();
    }
  },
  removeFromFolder : async function(request, h) {
    var folder  = request.pre.folder
      , trinket = request.pre.trinket;

    if (request.user.hasPermission("add-trinket", "folder", { id : folder.id })) {
      return folder.removeTrinket(trinket.id)
        .then(function() {
          return trinket.removeFolder();
        })
        .then(function() {
          return request.success({
            success : true
          });
        })
        .catch(function(err) {
          return legacyReply(err, h);
        });
    }
    else {
      return errors.forbidden();
    }
  },
  search : async function(request, h) {
    return Trinket.searchForOwner(request.user, request.query.q)
      .then(function(results) {
        return request.success({
          data : results
        });
      })
      .catch(function(err) {
        return legacyReply(err, h);
      });
  },
  downloadMain : async function(request, h) {
    var type = "text/plain"
      , mainName, code;

    return Trinket.findById(request.params.shortCode)
      .then(function(trinket) {
        if (!trinket) {
          throw errors.notFound();
        }

        try {
          code = JSON.parse(trinket.code);
          if (!Array.isArray(code)) {
            throw new Error();
          }
        } catch(e) {
          if (/blocks/.test(trinket.lang)) {
            mainName = "main.xml";
            // mime 1.2.11 `lookup` -> mime 4.x `getType`. Both answer
            // "application/xml" for this exact input, verified by execution.
            type     = mime.getType(mainName) || type;
          }
          else {
            mainName = "main.txt";
          }

          code = [{
              name    : mainName
            , content : trinket.code
          }];
        }

        // PRESERVED DEFECT: `reply(content).type(type)` returned the chainable
        // builder -- `.type()` mutated a Response object that was then discarded and
        // returned the builder rather than settling the deferred -- so the framework
        // serialised the builder itself, whose own properties are all functions.
        // Measured at baseline: 200, `application/json; charset=utf-8`,
        // content-length 2, body `{}`. This route has never served file content, and
        // `type` has never reached the wire. Reproduced byte-identically below.
        // Not "fixed" into a working download: that is exactly the behaviour change
        // R-d prohibits, and no deviation is approved for this file.
        return h.response({});
      })
      .catch(function(err) {
        return legacyReply(err, h);
      });
  },
  downloadFile : async function(request, h) {
    var req_path = request.params.path
      , type     = "text/plain"
      , code, mainName, file
      , assetUrl;

    return Trinket.findById(request.params.shortCode)
      .then(function(trinket) {
        if (!trinket) {
          throw errors.notFound();
        }

        try {
          code = JSON.parse(trinket.code);
          if (!Array.isArray(code)) {
            throw new Error();
          }
        } catch(e) {
          if (/blocks/.test(trinket.lang)) {
            mainName = "main.xml";
            // mime 1.2.11 `lookup` -> mime 4.x `getType`; identical for "main.xml"
            type     = mime.getType(mainName) || type;
          }
          else {
            mainName = "main.txt";
          }

          code = [{
              name    : mainName
            , content : trinket.code
          }];
        }

        // check code for file and reply if found
        file = _.find(code, { name : req_path });

        if (file) {
          // same preserved defect as downloadMain: the builder was returned
          // unsettled, so this answers 200 `{}` and not the file. Measured.
          return h.response({});
        }

        // check assets
        file = _.find(trinket.assets, { name : req_path });

        if (file) {
          // parseLegacy is url.parse without DEP0169 -- same `.pathname`, and the
          // same ERR_INVALID_URL throw for a malformed stored URL, which lands in
          // the `.catch` below exactly as it does today (measured: 500).
          assetUrl = parseLegacy(file.url);
          file     = path.basename(assetUrl.pathname);
          // mime 4's getType returns null for an unknown or absent extension where
          // 1.2.11's lookup returned its truthy "application/octet-stream" default,
          // so `type` can differ here. It is unobservable: the builder returned
          // below discards `type` entirely (measured -- a string body and a Buffer
          // body both emit `application/json`), so no client can see the difference.
          type     = mime.getType(file) || type;

          return FileUtil.downloadUserAsset(file)
            .then(function(stream) {
              // and again: 200 `{}`, never the asset bytes. Measured.
              return h.response({});
            });
        }
        else {
          throw errors.notFound();
        }
      })
      .catch(function(err) {
        return legacyReply(err, h);
      });
  },
  updateSlug : async function(request, h) {
    var trinket  = request.pre.trinket
      , testSlug = sluggify(request.payload.slug, { separateNumbers : false });

    // validate slug format
    if (testSlug.toLowerCase() !== request.payload.slug) {
      // returned, not thrown, so the 400 survives the preserved catch-all
      return errors.badRequest();
    }

    return trinket.updateSlug(request.payload.slug)
      .then(function(result) {
        return result
          ? request.success()
          : errors.conflict();
      })
      .catch(function(err) {
        return legacyReply(err, h);
      });
  },

  // Generate zip from POSTed content (for client-side download with unsaved changes)
  downloadPostedZip : async function(request, h) {
    var archive = archiver('zip', {
      zlib: { level: 9 }
    })
    , files            = JSON.parse(request.payload.files || '{}')
    , assets           = JSON.parse(request.payload.assets || '[]')
    , filename         = request.payload.filename || 'trinket-download'
    , timestamp        = Date.now()
    , zipFile          = "/tmp/download-" + timestamp + ".zip"
    , outputWriteStream  = fs.createWriteStream(zipFile)
    , outputPromise
    , assetPromises      = []
    , assetUrl, assetFile, outputReadStream;

    // Sanitize filename
    var safeFilename = filename.replace(/[^a-zA-Z0-9_\-\s]/g, '').substring(0, 100) || 'trinket-download';

    outputPromise = new Promise(function(resolve, reject) {
      archive.on('error', function(err) {
        reject(err);
      });

      archive.on('warning', function(err) {
        if (err.code !== 'ENOENT') {
          reject(err);
        }
      });

      outputWriteStream.on('close', function() {
        resolve(archive.pointer());
      });

      outputWriteStream.on('error', function(err) {
        reject(err);
      });
    });

    archive.pipe(outputWriteStream);

    // Add code files
    for (var name in files) {
      if (files.hasOwnProperty(name)) {
        archive.append(files[name] || '', { name : name });
      }
    }

    // Download and add assets
    assets.forEach(function(asset) {
      if (!asset.url) return;

      // Handle data URLs directly
      if (/^data:/.test(asset.url)) {
        var matches = asset.url.match(/^data:([^;]+);base64,(.+)$/);
        if (matches) {
          var buffer = Buffer.from(matches[2], 'base64');
          archive.append(buffer, { name : asset.name });
        }
      }
      else {
        // parseLegacy == url.parse minus DEP0169; a malformed stored URL still
        // throws ERR_INVALID_URL synchronously out of this forEach and reaches the
        // route catch-all as a 500, exactly as measured at baseline.
        assetUrl  = parseLegacy(asset.url);
        assetFile = path.basename(assetUrl.pathname);
        assetPromises.push(
          FileUtil.downloadUserAsset(assetFile)
            .then(function(data) {
              return { name: asset.name, data: data };
            })
            .catch(function(err) {
              console.log('Asset download failed:', asset.name, err.message);
              return null;
            })
        );
      }
    });

    return Promise.all(assetPromises)
      .then(function(results) {
        results.forEach(function(result) {
          if (result && result.data) {
            archive.append(result.data, { name : result.name });
          }
        });

        archive.finalize();

        return outputPromise;
      })
      .then(function(bytes) {
        outputReadStream = fs.createReadStream(zipFile);

        // Mark for cleanup after response
        request.params._tmp = zipFile;

        // This chain ended in `.header()`, which DID settle the deferred and
        // returned a real response, so unlike the download routes above it has
        // always worked. Native chaining is order-independent, so the outcome is
        // identical: measured 200, `application/zip`, the archive bytes, and
        // `Content-Disposition: attachment; filename="<name>.zip"` -- note the
        // QUOTED filename here, versus the bare form in downloadZip. The
        // difference is baseline and is deliberately not normalised.
        return h.response(outputReadStream)
          .type('application/zip')
          .bytes(bytes)
          .header('Content-Disposition', 'attachment; filename="' + safeFilename + '.zip"');
      })
      .catch(function(err) {
        // Fire-and-forget, exactly as the empty callback was: the response must not
        // wait for the unlink, and the unlink's own failure must stay invisible.
        // Deliberately NOT awaited.
        fs.promises.unlink(zipFile).catch(function() {});
        return errors.badImplementation(err.message);
      });
  }
}

// The extracted listing core, exported alongside the 34 route handlers above so
// lib/controllers/folders.js can call it instead of re-entering GET /api/trinkets
// through server.inject. Attached after the handler map rather than inside it so
// the map stays a pure route-name -> handler lookup (routeParser resolves handlers
// by property name off this object).
module.exports.listCore = listCore;

// listCore(listOptions, actingUser) -- the trinket listing logic, lifted out of the
// `list` route handler so a second caller can reach it directly.
//
// WHY IT EXISTS
// ---------------------------------------------------------------------------
// lib/controllers/folders.js `trinkets` served its response by calling
// `request.server.inject()` on GET /api/trinkets, i.e. one route re-entering
// another. @hapi/shot emits DEP0169 for every injected request
// (node_modules/@hapi/shot/lib/request.js:30), which put a deprecation warning on
// the live request path. Rather than have one handler call the other -- the API
// route's validation, pre-handlers, replySpec projection and error mapping are
// part of *its* contract and cannot be borrowed -- the shared work lives here as a
// plain async function and each caller applies its own `request.success`.
//
// CONTRACT
// ---------------------------------------------------------------------------
// Takes the listing inputs and the acting user EXPLICITLY: no `request`, no
// `reply`, no `h`. Returns the array of aggregated, mapped trinket documents.
// Rejects on aggregation failure, so each caller keeps its own error mapping.
//
// `listOptions` mirrors the six optional query keys of GET /api/trinkets --
// `sort`, `folder`, `user`, `from`, `offset`, `limit` -- and the PRESENCE of
// `folder` is load-bearing: see the match block below.
function listCore(listOptions, actingUser) {
  var options = listOptions || {};

  var passthroughFields = {
    _id         : 1,
    _owner      : 1,
    lastView    : 1,
    metrics     : 1,
    lang        : 1,
    lastUpdated : 1,
    shortCode   : 1,
    snapshot    : 1,
    assets      : 1,
    description : 1,
    folder      : 1,
    slug        : 1,
    published   : 1
  }

  var project_1 = _.extend({
    emailViews  : { $ifNull : ["$metrics.emailViews", 0] },
    embedViews  : { $ifNull : ["$metrics.embedViews", 0] },
    linkViews   : { $ifNull : ["$metrics.linkViews",  0] },
    name        : { $ifNull : ["$name",               ""] }
  }, passthroughFields);

  var project_2 = _.extend({
    totalViews  : { $add    : ["$emailViews", "$embedViews", "$linkViews"] },
    lastViewed  : { $ifNull : ["$lastView.viewedOn",  new Date("2000-01-01")] },
    lowerName   : { $cond   : [ { $eq : ["$name", ""] }, "~~~", "$name" ] },
    name        : 1
  }, passthroughFields);

  var project_3 = _.extend({
    lowerName   : { $toLower : "$lowerName" },
    totalViews  : 1,
    lastViewed  : 1,
    name        : 1
  }, passthroughFields);

  var sort = options.sort ? options.sort : '-lastView.viewedOn';
  var sortMap = {
    '-lastView.viewedOn'  : [ 'lastViewed',  -1 ],
    '-lastUpdated'        : [ 'lastUpdated', -1 ],
    '-totalViews'         : [ 'totalViews',  -1 ],
    '-metrics.embedViews' : [ 'totalViews',  -1 ],
    'name'                : [ 'lowerName',    1 ]
  };

  var match = {
    _owner : actingUser._id,
    deletedAt : null
  };

  // depending on whether or not the user is looking at a folder
  //
  // NOTE: there is no "unfiltered" mode. Omitting `folder` does not widen the
  // query -- it narrows it to trinkets that are in NO folder, via the else branch.
  // Measured at baseline: GET /api/trinkets with a filed trinket and no `folder`
  // returns an empty array. A caller that wants a folder's contents must pass
  // `folder`; one that passes nothing gets the unfiled set, not everything.
  if (options.folder) {
    match["folder.folderId"] = new ObjectId(options.folder);
  }
  else {
    match.folder = {
      $exists : false
    };
  }

  var getUserId, trinketUsername;
  if (options.user && actingUser.hasRole("admin")) {
    getUserId = function() {
      return new Promise(function(resolve, reject) {
        // `resolve()` is called regardless of `err`, and reject is never used: a
        // failed or empty owner lookup silently leaves the acting user's own
        // trinkets selected instead of erroring. Preserved deliberately --
        // measured at baseline, ?user=<nonexistent id> answers 200 with the
        // acting user's own data rather than a 404 or a 500.
        User.findById(options.user, function(err, user) {
          if (!err && user) {
            match._owner = user._id;
            trinketUsername = user.username;
          }
          resolve();
        });
      });
    }
  } else {
    getUserId = function() { return Promise.resolve(); };
  }

  var pipeline = [
    { $match   : match     },
    { $project : project_1 },
    { $project : project_2 },
    { $project : project_3 }
  ];

  if (options.from) {
    var condition = sortMap[sort][1] < 0 ? '$lte' : '$gte';
    var match_sort = /^-/.test(sort) ? sort.substr(1) : sort;
    var match_2 = {}
    match_2[ sortMap[sort][0] ] = {};

    // lastUpdated or lastView == date condition
    if (/last/.test(sort)) {
      match_2[ sortMap[sort][0] ][condition] = new Date(options.from);
    }
    // views == numerical condition
    else if (/views/i.test(sort)) {
      match_2[ sortMap[sort][0] ][condition] = parseInt(options.from);
    }
    else {
      match_2[ sortMap[sort][0] ][condition] = options.from.toLowerCase();
    }

    pipeline.push({
      $match : match_2
    });
  }

  var sortStage = {};
  sortStage[ sortMap[sort][0] ] = sortMap[sort][1];

  pipeline.push({
    $sort : sortStage
  });

  if (options.offset) {
    pipeline.push({
      $skip : parseInt(options.offset)
    });
  }

  pipeline.push({
    $limit : parseInt(options.limit) || 20
  });

  return getUserId()
    .then(function() {
      return mongoose.model('Snippet').collection.aggregate(pipeline).toArray();
    })
    .then(function(trinkets) {
      // check snapshots
      //
      // The mapping stays here so both callers receive identically shaped
      // documents: `id` mirrored off `_id`, `username` resolved to the looked-up
      // owner or else the acting user, and Trinket.checkSnapshot applied.
      trinkets.map(function(trinket) {
        trinket.id = trinket._id;
        trinket.username = trinketUsername || actingUser.username;
        Trinket.checkSnapshot(trinket);
        return trinket;
      });

      return trinkets;
    });
}

// Dispatch target for the `.json` extension, reached from getByShortCode via
// supportedDownloadFormats. Not invoked by the framework directly, but it produces
// that route's response, so T-1 applies to it through its caller and it takes the
// toolkit in place of the removed `reply`.
function downloadJSON(request, h) {
  var data               = {}
    , trinket            = request.pre.trinket
    , proxyUrl           = config.app.embed.proxy + '/'
    , proxyRegExp        = new RegExp(proxyUrl)
    , includeHiddenFiles = false
    , code, mainName, assetUrl;

  if (request.user && trinket._owner && request.user.id === trinket._owner.toString()) {
    includeHiddenFiles = true;
  }

  // meta
  data.id        = trinket.shortCode;
  data.url       = [config.url, trinket.lang, trinket.shortCode].join("/");
  data.timestamp = (new Date()).toJSON();

  data.name = typeof trinket.name !== "undefined" && trinket.name.length
    ? trinket.name
    : "untitled " + trinket.lang + " trinket";

  try {
    code = JSON.parse(trinket.code);
    if (!Array.isArray(code)) {
      throw new Error();
    }
  } catch(e) {
    mainName = /blocks/.test(trinket.lang) ?  "main.xml" : "main.txt";

    code = [{
        name    : mainName
      , content : trinket.code
    }];
  }

  data.code = code.filter(function(file) {
    // skip hidden files...
    return file.hidden && !includeHiddenFiles ? false : true;
  }).map(function(file) {
    return {
        name    : file.name
      , content : file.content
    };
  });

  data.assets = trinket.assets.map(function(asset) {
    // strip proxy
    assetUrl = asset.url.replace(proxyRegExp, "");

    return {
        url  : assetUrl
      , name : asset.name
    };
  });

  // PRESERVED DEFECT: `reply(data)` returned the chainable builder with no
  // resolving chain call at all, so the framework serialised the builder rather
  // than `data`. Measured at baseline: 200, `application/json; charset=utf-8`,
  // content-length 2, body `{}` -- the assembled metadata, code listing and asset
  // list have never reached a client. `h.response({})` is byte-identical to that.
  return h.response({});
}

// Dispatch target for the `.zip` extension. See downloadJSON above.
function downloadZip(request, h) {
  var archive = archiver('zip', {
    zlib: { level: 9 } // Sets the compression level.
  })
  , trinket            = request.pre.trinket
  , zipFile            = "/tmp/" + trinket.shortCode + ".zip"
  , outputWriteStream  = fs.createWriteStream(zipFile)
  , outputPromise
  , proxyUrl           = config.app.embed.proxy + '/'
  , proxyRegExp        = new RegExp(proxyUrl)
  , includeHiddenFiles = false
  , assetPromises      = []
  , code, mainName, assetUrl, assetFile, outputReadStream, i;

  outputPromise = new Promise(function(resolve, reject) {
    archive.on('err', function(err) {
      reject(err);
    });

    archive.on('warning', function(err) {
      if (err.code === 'ENOENT') {
        console.log(err);
      }
      else {
        reject(err);
      }
    });

    outputWriteStream.on('close', function() {
      // return number of bytes written
      resolve(archive.pointer());
    });

    outputWriteStream.on('error', function(err) {
      reject(err);
    });
  });

  if (request.user && trinket._owner && request.user.id === trinket._owner.toString()) {
    includeHiddenFiles = true;
  }

  archive.pipe(outputWriteStream);

  // TODO? index or manifest or readme

  try {
    code = JSON.parse(trinket.code);
    if (!Array.isArray(code)) {
      throw new Error();
    }
  } catch(e) {
    mainName = /blocks/.test(trinket.lang) ?  "main.xml" : "main.txt";

    code = [{
        name    : mainName
      , content : trinket.code
    }];
  }

  code.filter(function(file) {
    // skip hidden files...
    return file.hidden && !includeHiddenFiles ? false : true;
  }).forEach(function(file) {
    archive.append(file.content, { name : file.name });
  });

  trinket.assets.forEach(function(asset) {
    // parseLegacy == url.parse minus DEP0169. This runs synchronously, before the
    // returned chain exists, so a malformed stored URL still throws
    // ERR_INVALID_URL straight out of downloadZip into getByShortCode's caller and
    // reaches the route catch-all as a 500 -- measured identical at baseline.
    assetUrl  = parseLegacy(asset.url);
    assetFile = path.basename(assetUrl.pathname);

    assetPromises.push(FileUtil.downloadUserAsset(assetFile));
  });

  return Promise.allSettled(assetPromises)
    .then(function(streams) {
      for (i = 0; i < streams.length; i++) {
        if (streams[i].status === "fulfilled") {
          archive.append(streams[i].value, { name : trinket.assets[i].name });
        }
        else {
          throw new Error(streams[i].reason.message);
        }
      }

      archive.finalize();

      return outputPromise;
    })
    .then(function(bytes) {
      outputReadStream = fs.createReadStream(zipFile);

      // data to tell onPreResponse to delete this file once the response is finished
      request.params._tmp = zipFile;

      // Header-resolved chain, so this route has always served a real archive.
      // Measured at baseline: 200, `application/zip`, the archive bytes, and
      // `Content-Disposition: attachment; filename=<shortCode>.zip` -- the filename
      // is UNQUOTED here, where downloadPostedZip quotes it. Both forms are
      // reproduced as-is; normalising either would change the wire.
      return h.response(outputReadStream)
        .type('application/zip')
        .bytes(bytes)
        .header('Content-Disposition', 'attachment; filename=' + trinket.shortCode + '.zip');
    })
    .catch(function(err) {
      return legacyReply(err, h);
    });
}

function setServersideApi(request, altUser) {
  var serverside, serverlang, url;

  if (config.app.serverside.langmap[ request.params.lang ]) {
    serverlang = config.app.serverside.langmap[ request.params.lang ];
    serverside = {};

    if (!serverside[ request.params.lang ]) {
      url = config.app.serverside[ serverlang ].api.default;

      if (request.user || altUser) {
        if (config.app.serverside[ serverlang ].api.connect &&
            ( (request.user && request.user.hasRole('trinket-connect')) ||
              (altUser && altUser.hasRole('trinket-connect')) )) {
          url = config.app.serverside[ serverlang ].api.connect;
        }
        else if (config.app.serverside[ serverlang ].api.codeplus &&
            ( (request.user && request.user.hasRole('trinket-codeplus')) ||
              (altUser && altUser.hasRole('trinket-codeplus')) )) {
          url = config.app.serverside[ serverlang ].api.codeplus;
        }
      }

      serverside[ request.params.lang ] = {
        api : url
      };
    }
  }

  return serverside;
}

})();
