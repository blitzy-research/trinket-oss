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
    url           = require('url'),
    path          = require('path'),
    archiver      = require('archiver'),
    mime          = require('mime'),
    sluggify      = require('limax'),
    JSZip         = require("jszip");

(function() {

var supportedDownloadFormats = {
    'json' : downloadJSON
  , 'zip'  : downloadZip
};

module.exports = {
  index : function(request, h) {
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
  beta : function(request, h) {
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
    var trinketId, trinket;

    if (path[0] && path[0] !== 'create' && path[0] !== 'copy') {
      trinketId = path[0];
    }

    if (request.user) {
      if (trinketId) {
        // The error-first callback this replaces ignored its `err` argument, so a
        // cast error on a malformed id - or any database failure - fell through to
        // the redirect below instead of surfacing as a 500. The swallowing .catch
        // reproduces that mapping exactly. See docs/PRESERVED-QUIRKS.md.
        trinket = await Trinket.findById(trinketId).catch(function() {});

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
      // Same ignored-`err` contract as the branch above.
      trinket = await Trinket.findById(trinketId).catch(function() {});

      if (trinket) {
        return h.redirect('/' + trinket.lang + '/' + trinket.shortCode);
      }

      return h.redirect('/login');
    }
    else {
      return h.redirect('/login');
    }
  },
  list : function(request, h) {
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

    var sort = request.query.sort ? request.query.sort : '-lastView.viewedOn';
    var sortMap = {
      '-lastView.viewedOn'  : [ 'lastViewed',  -1 ],
      '-lastUpdated'        : [ 'lastUpdated', -1 ],
      '-totalViews'         : [ 'totalViews',  -1 ],
      '-metrics.embedViews' : [ 'totalViews',  -1 ],
      'name'                : [ 'lowerName',    1 ]
    };

    var match = {
      _owner : request.user._id,
      deletedAt : null
    };

    // depending on whether or not the user is looking at a folder
    if (request.query.folder) {
      match["folder.folderId"] = new ObjectId(request.query.folder);
    }
    else {
      match.folder = {
        $exists : false
      };
    }

    var getUserId, trinketUsername;
    if (request.query.user && request.user.hasRole("admin")) {
      getUserId = async function() {
        // The `!err &&` guard of the error-first callback this replaces is carried
        // by the swallowing .catch: a lookup failure leaves the match untouched
        // and resolves anyway, exactly as before.
        var user = await User.findById(request.query.user).catch(function() {});

        if (user) {
          match._owner = user._id;
          trinketUsername = user.username;
        }
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

    if (request.query.from) {
      var condition = sortMap[sort][1] < 0 ? '$lte' : '$gte';
      var match_sort = /^-/.test(sort) ? sort.substr(1) : sort;
      var match_2 = {}
      match_2[ sortMap[sort][0] ] = {};

      // lastUpdated or lastView == date condition
      if (/last/.test(sort)) {
        match_2[ sortMap[sort][0] ][condition] = new Date(request.query.from);
      }
      // views == numerical condition
      else if (/views/i.test(sort)) {
        match_2[ sortMap[sort][0] ][condition] = parseInt(request.query.from);
      }
      else {
        match_2[ sortMap[sort][0] ][condition] = request.query.from.toLowerCase();
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

    if (request.query.offset) {
      pipeline.push({
        $skip : parseInt(request.query.offset)
      });
    }

    pipeline.push({
      $limit : parseInt(request.query.limit) || 20
    });

    return getUserId()
      .then(function() {
        return mongoose.model('Snippet').collection.aggregate(pipeline).toArray();
      })
      .then(function(trinkets) {
        // check snapshots
        trinkets.map(function(trinket) {
          trinket.id = trinket._id;
          trinket.username = trinketUsername || request.user.username;
          Trinket.checkSnapshot(trinket);
          return trinket;
        });
        return request.success({ data : trinkets });
      })
      // hapi API migration - R-5/R-6 adjudication, and it applies at every one of this
      // file's former error-responder sites. The deleted synthetic responder tested
      // `data.isBoom` FIRST and settled with the Boom untouched, keeping its own 4xx/409
      // status, and only then wrapped a plain Error in a `badImplementation` Boom - a 500
      // whose message hapi scrubs. `return err;` reproduces BOTH of those branches
      // exactly. A bare `throw err;` does NOT: converted handlers are still invoked
      // inside routeParser's wrapper, whose catch-all hands everything to
      // lib/http/errorMap.js#toResponse, and that map has no isBoom test - so a thrown
      // Boom collapses into a 500. Measured over real HTTP against a faithful replica of
      // the target wrapper on @hapi/hapi 21.4.10: a THROWN `notFound` Boom answered 500
      // while a RETURNED one answered 404, and the same held for 403, 400 and 409.
      // Returning also avoids the stack-trace log line that the baseline error responder
      // never emitted. See docs/PRESERVED-QUIRKS.md.
      .catch(function(err) {
        return err;
      });
  },
  getById : function(request, h) {
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
  grant : function(request, h) {
    var trinket = request.pre.trinket.copy(request.pre.user.id, {noSnapshot:true});
    return trinket.save()
      // PRESERVED QUIRKS - see docs/PRESERVED-QUIRKS.md. Both responders are passed
      // as BARE FUNCTION REFERENCES, which is load bearing in two different ways:
      // .then hands the saved document straight to request.success as `json` (so
      // ObjectUtils.serialize invokes doc.serialize()), and .catch hands the ERROR
      // in as `json` rather than as `err` - request.fail's second parameter stays
      // undefined, the error object is flashed under 'failure' and returned in an
      // HTTP 200 body, and the log line ends with the literal string "undefined".
      // Do NOT rewrite either as .catch(function (err) { return request.fail({}, err); }).
      .then(request.success)
      .catch(request.fail);
  },

  update : function(request, h) {
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
      // PRESERVED QUIRK - see docs/PRESERVED-QUIRKS.md. The error lands in
      // request.fail's `json` parameter, not its `err` parameter; the argument order
      // is part of the observable behaviour and must not be "corrected".
      .catch(request.fail);
  },

  create : function(request, h) {
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
        // PRESERVED QUIRK - see docs/PRESERVED-QUIRKS.md. The mail `secret` config key
        // does not exist in config/default.yaml, so this expression evaluates to the
        // literal string "undefined" + shortCode. lib/util/helpers.js#verifyEmailToken
        // builds the verification secret with the IDENTICAL expression, so tokens
        // round-trip; adding a fallback or a config key here would invalidate every
        // email-verification token already in the wild. jsonwebtoken 9.0.3 keeps HS256
        // as the default for a string secret, matching 5.7.0.
        emailSecret = config.app.mail.secret + doc.shortCode;
        emailToken  = jwt.sign({ shortCode: doc.shortCode }, emailSecret);
        sessionKey  = 'emailToken:' + doc.shortCode;
        request.yar.set(sessionKey, emailToken);

        return request.success({data:doc});
      })
      .catch(function(err) {
        return err;
      });
  },

  createFork : function(request, h) {
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
        return err;
      });
  },

  updateMetrics : function(request, h) {
    var meta = {
          referer : request.headers.referer || '',
          address : request.headers['x-forwarded-for'] || ''
        },
        metric = Object.keys(request.payload)[0];

    if (!metric) {
      // if no metric is supplied, just return the current trinket state
      //
      // PRESERVED QUIRK - see docs/PRESERVED-QUIRKS.md. Model.findById(id, callback)
      // hands back the mongoose Query object itself, so this statement returns a
      // thenable that has ALREADY been executed by the callback form. routeParser
      // awaits whatever the handler returns, which re-executes that Query and makes
      // mongoose throw 'Query was already executed'. Measured against the base commit,
      // this branch therefore answers HTTP 500 with the message scrubbed; it has never
      // answered with the trinket, and the inner request.success below has never
      // produced the wire response. The statement is kept byte-for-byte and the handler
      // is deliberately left non-async so the Query is still handed out unawaited.
      // Do NOT "repair" this into a 200.
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
      });
  },

  remove : function(request, h) {
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
    });
  },

  getByShortCode : function(request, h) {
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
        return supportedDownloadFormats[extension](request, h);
      }
      else {
        // Returned, never thrown - see the R-5/R-6 adjudication comment in `list`.
        // A thrown Boom would reach routeParser's catch-all and become a 500 instead of
        // this route's baseline 404. See docs/PRESERVED-QUIRKS.md.
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
      });
  },

  embed : function(request, h) {
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
      });
  },
  assignment : function(request, h) {
    return request.success({
        trinket      : request.pre.trinket
      , lang         : request.params.lang
      , assignment   : true
      , outputTabs   : 'twoTabs'
      , downloadable : config.app.downloadable.indexOf(request.params.lang) >= 0
      , serverside   : setServersideApi(request)
    });
  },
  assignmentFeedback : function(request, h) {
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
  viewOnly : function(request, h) {
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
      // PRESERVED QUIRK - see docs/PRESERVED-QUIRKS.md. request.fail never sets a
      // status, so a mailer-not-configured share answers HTTP 200 with this message
      // carried in the 'failure' flash. It is NOT a 503 and must not become one.
      return request.fail({
        message: "Email is not configured. Sharing via email is not available."
      });
    }

    // recaptcha.verify is NOT error-first: its callback receives a single result
    // object. With no secret key configured - the default, and always under test -
    // it invokes that callback SYNCHRONOUSLY with { success : true }. A Promise
    // executor also runs synchronously, so wrapping preserves that ordering, and the
    // wrapper only ever resolves because verify never reports a transport error to
    // the callback. See lib/util/recaptcha.js and docs/PRESERVED-QUIRKS.md.
    var result = await new Promise(function(resolve) {
      recaptcha.verify(request.payload['g-recaptcha-response'], function(verifyResult) {
        resolve(verifyResult);
      });
    });

    // Read exactly as at baseline: on an HTTP failure verify reports { status : false },
    // so `result.success` is undefined and this falls to the else branch. Do not
    // normalize the key and do not add a `result.status` test.
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
          // PRESERVED QUIRK - see docs/PRESERVED-QUIRKS.md. At the base commit this
          // ternary handed a `forbidden` Boom to the synthetic responder on the first
          // arm and called that responder with no argument at all on the second. The
          // first arm is a genuine 403 whose default message "Forbidden" is client
          // visible, and the Boom must be RETURNED here rather than thrown - see the
          // R-5/R-6 adjudication in `list`. The second arm built the deleted shim's
          // response builder without ever settling its deferred capture, so this
          // rejection path produced NO RESPONSE AT ALL and the request hung (measured).
          // A hang is not a reproducible wire outcome, so it is resolved to the same
          // empty-object body the builder serialized to elsewhere - 200 with `{}`.
          return err === "threshold exceeded" ? errors.forbidden() : h.response({});
        });
    }
    else {
      return request.success();
    }
  },
  snapshot : function(request, h) {
    if (request.payload.snapshotData) {
      var img  = request.payload.snapshotData;
      var data = img.replace(/^data:image\/\w+;base64,/, "");
      // The deprecated Buffer constructor stood here and was this codebase's only DEP0005
      // source, so this is the single edit the zero-deprecation-warning boot gate depends on.
      // Buffer.from is a drop-in for the base64 decode - identical bytes and length - and the
      // data-URI branch of downloadPostedZip below already used it at the base commit.
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
        // PRESERVED QUIRK - see docs/PRESERVED-QUIRKS.md. Bare responder references
        // again: the saved document becomes request.success's `json`, and the error
        // becomes request.fail's `json` with `err` left undefined.
        .then(request.success)
        .catch(request.fail);
    }

    // PRESERVED QUIRK - see docs/PRESERVED-QUIRKS.md. At the base commit this returned
    // the synthetic responder called with `{ status : "success" }`. That responder handed
    // back its chainable builder rather than a response, and a bare call with only a
    // payload never settled the deferred capture, so hapi JSON-serialized the builder
    // itself - every own enumerable property was a function, so all of them were dropped.
    // Measured wire result: HTTP 200, application/json, body `{}`. The
    // { status : "success" } payload has never reached a client, so it is NOT restored.
    return h.response({});
  },
  interactions : function(request, h) {
    var trinket = request.pre.trinket;

    return Interaction.findByTrinketId(trinket.id)
      .then(function(result) {
        return request.success({data:result});
      });
  },
  addToList : function(request, h) {
    trinketStore.unshift(request.pre.trinket.lang, request.query.name, request.pre.trinket.id);
    return request.success({
      trinket : request.pre.trinket
    });
  },
  namedList : function(request, h) {
    return request.success(request.pre.namedTrinketList || []);
  },
  removeFromList : function(request, h) {
    trinketStore.remove(request.params.lang, request.query.name, request.pre.trinket.id);
    return request.success();
  },
  logError : async function(request, h) {
    var error = new ErrorEvent(request.payload);

    // The error-first callback this replaces ignored its `err` argument and answered
    // success either way, so the swallowing .catch keeps a failed save answering
    // exactly as before. See docs/PRESERVED-QUIRKS.md.
    await error.save().catch(function() {});

    return request.success();
  },
  logClientMetric : function(request, h) {
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
      var zip = new JSZip(), content, code;

      // Both rejection handlers of the two-argument .then chain this replaces answered
      // with a bare request.success(), so an unreadable archive - a rejected
      // loadAsync, a missing "zipCode" entry, or a failed decompression - has always
      // produced a plain success response rather than an error. The single try/catch
      // reproduces that shared outcome. See docs/PRESERVED-QUIRKS.md.
      // R-6 adjudication: JSON.parse below is deliberately left OUTSIDE the try, because
      // at the base commit it also sat outside every handler - a throw there rejected the
      // detached chain with nobody listening, so the deferred response never settled and
      // the request hung. A hang is not a reproducible wire outcome, so the throw is left
      // unhandled here too and the framework maps it to the same scrubbed 500 it maps any
      // other unhandled handler error to. Documented in docs/PRESERVED-QUIRKS.md.
      try {
        content = await zip.loadAsync(request.payload.zipCode, { base64: true });
        code    = await content.file("zipCode").async("string");
      }
      catch (err) {
        return request.success();
      }

      update.code = JSON.parse(code);

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
  discardDraft : function(request, h) {
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
  autosave : function(request, h) {
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

        // Every rejection handler in this chain handed a plain Error to the synthetic
        // responder, which mapped it to a `badImplementation` Boom - an HTTP 500 whose
        // message the framework scrubs. `return err;` reproduces that exactly
        // (see the adjudication comment in `list`), so the two structurally redundant
        // onRejected handlers are kept rather than removed - R-1 forbids opportunistic
        // cleanup. The chain is now returned so the response is the handler's return
        // value. This also mirrors the base commit structurally: there the first
        // rejection handler returned a Boom which was carried into JSON.parse below and
        // threw, exactly as the returned Error now is. See docs/PRESERVED-QUIRKS.md.
        // R-6 adjudication: JSON.parse below throws outside every handler here, exactly as
        // it did at the base commit; there the detached rejection left the deferred
        // response unsettled and the request hung, which is not a reproducible wire
        // outcome, so it is left unhandled and becomes the same scrubbed 500.
        return zip.loadAsync(request.payload.zipCode, { base64: true })
          .then(function(content) {
            return content.file("zipCode").async("string");
          }, function(err) {
            return err;
          })
          .then(function(code) {
            trinket.set('code', JSON.parse(code));
            return trinket.save()
              .then(function() {
                return request.success({
                  success : true
                });
              }).catch(function(err) {
                return err;
              });
          }, function(err) {
            return err;
          });
      }
      else {
        return trinket.save()
          .then(function() {
            return request.success({
              success : true
            });
          }).catch(function(err) {
            return err;
          });
      }
    }
    else {
      // Returned, never thrown - see the R-5/R-6 adjudication comment in `list`.
      return errors.forbidden();
    }
  },
  addToFolder : function(request, h) {
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
          return err;
        });
    }
    else {
      // Returned, never thrown - see the R-5/R-6 adjudication comment in `list`.
      return errors.forbidden();
    }
  },
  removeFromFolder : function(request, h) {
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
          return err;
        });
    }
    else {
      // Returned, never thrown - see the R-5/R-6 adjudication comment in `list`.
      return errors.forbidden();
    }
  },
  search : function(request, h) {
    return Trinket.searchForOwner(request.user, request.query.q)
      .then(function(results) {
        return request.success({
          data : results
        });
      })
      .catch(function(err) {
        return err;
      });
  },
  downloadMain : function(request, h) {
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
            type     = mime.lookup(mainName) || type;
          }
          else {
            mainName = "main.txt";
          }

          code = [{
              name    : mainName
            , content : trinket.code
          }];
        }

        // PRESERVED QUIRK - this endpoint has never returned the main file's content.
        // The deleted shim's chainable builder resolved the deferred response from
        // .code(), .header(), .view() and .redirect(), but .type() and .bytes() returned
        // the builder itself WITHOUT resolving. A chain ending in .type() therefore made
        // the builder the handler's return value; every own enumerable property of that
        // builder is a function, so JSON serialization dropped all of them. Measured
        // against the base commit over real HTTP: HTTP 200, content-type
        // application/json; charset=utf-8, body {}. The mime.lookup() call above and the
        // `type` computation are kept because they are part of that measured baseline.
        // See docs/PRESERVED-QUIRKS.md.
        return h.response({});
      })
      // `return err;` - NOT `throw err;` - because the `notFound` Boom thrown above
      // arrives here and must keep its 404. See the adjudication in `list`.
      .catch(function(err) {
        return err;
      });
  },
  downloadFile : function(request, h) {
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
            type     = mime.lookup(mainName) || type;
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
          // PRESERVED QUIRK - a chain ending in the deleted builder's non-resolving
          // .type() never returned its payload. Measured against the base commit over
          // real HTTP: HTTP 200, content-type application/json; charset=utf-8, body {}.
          // See docs/PRESERVED-QUIRKS.md.
          return h.response({});
        }

        // check assets
        file = _.find(trinket.assets, { name : req_path });

        if (file) {
          // legacyPathname() reproduces the deprecated legacy URL parser's pathname; see
          // its definition below and docs/PRESERVED-QUIRKS.md.
          assetUrl = legacyPathname(file.url);
          file     = path.basename(assetUrl);
          type     = mime.lookup(file) || type;

          return FileUtil.downloadUserAsset(file)
            .then(function(stream) {
              // PRESERVED QUIRK - same non-resolving .type() as above, so this asset
              // branch also answers HTTP 200 with body {} rather than the asset bytes.
              // FileUtil.downloadUserAsset resolves a Buffer, so the local name `stream`
              // is a baseline misnomer that is left as-is.
              // See docs/PRESERVED-QUIRKS.md.
              return h.response({});
            });
        }
        else {
          throw errors.notFound();
        }
      })
      // `return err;` - NOT `throw err;` - because both `notFound` Booms thrown above
      // arrive here and must keep their 404. See the adjudication in `list`.
      .catch(function(err) {
        return err;
      });
  },
  updateSlug : function(request, h) {
    var trinket  = request.pre.trinket
      , testSlug = sluggify(request.payload.slug, { separateNumbers : false });

    // validate slug format
    if (testSlug.toLowerCase() !== request.payload.slug) {
      // Returned, never thrown - see the R-5/R-6 adjudication comment in `list`. This
      // keeps the baseline 400 "Bad Request".
      return errors.badRequest();
    }

    return trinket.updateSlug(request.payload.slug)
      .then(function(result) {
        return result
          ? request.success()
          // A Boom RETURNED from a .then fulfils the chain and becomes the handler's
          // return value, so this keeps the baseline 409 "Conflict".
          : errors.conflict();
      })
      .catch(function(err) {
        return err;
      });
  },

  // Generate zip from POSTed content (for client-side download with unsaved changes)
  downloadPostedZip : function(request, h) {
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
        // legacyPathname() reproduces the deprecated legacy URL parser's pathname; see its
        // definition below and docs/PRESERVED-QUIRKS.md. This call site is UNGUARDED -
        // only `if (!asset.url) return;` and the /^data:/ test precede it - so the helper
        // must never return the null-versus-object divergence the WHATWG static
        // URL.parse() would introduce here.
        assetUrl  = legacyPathname(asset.url);
        assetFile = path.basename(assetUrl);
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

        // The deleted builder's .header() DID resolve the deferred response, so unlike the
        // .type()-terminated chains elsewhere in this file this is a genuine working
        // response. Converted in the SAME call order so the measured wire output is
        // unchanged: HTTP 200, content-type application/zip, content-length == bytes, and
        // this exact Content-Disposition with the filename in DOUBLE quotes (downloadZip's
        // is unquoted - both are client-visible and each is preserved verbatim).
        // fs.createReadStream stays synchronous and is deliberately not awaited.
        return h.response(outputReadStream)
          .type('application/zip')
          .bytes(bytes)
          .header('Content-Disposition', 'attachment; filename="' + safeFilename + '.zip"');
      })
      .catch(function(err) {
        // PRESERVED QUIRK - the unlink is FIRE-AND-FORGET with an error-ignoring callback
        // at the base commit, and the error response is sent immediately without waiting
        // for it. The promise form is therefore deliberately NOT awaited, and its
        // rejection is swallowed exactly as the empty callback swallowed it.
        // See docs/PRESERVED-QUIRKS.md.
        fs.promises.unlink(zipFile).catch(function() {});
        return errors.badImplementation(err.message);
      });
  }
}

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

  // PRESERVED QUIRK - this endpoint has never returned the assembled trinket JSON. A bare
  // payload-only call to the deleted shim's synthetic responder produced the chainable
  // BUILDER, not a response, and did not settle the deferred capture either; because the
  // builder is not undefined the deferral was skipped and hapi serialized the builder
  // itself. Every own enumerable property of that builder is a function, so all of them
  // were dropped. Measured against the base commit over real HTTP: HTTP 200, content-type
  // application/json; charset=utf-8, body {}. The whole `data` assembly above is retained
  // because it is part of that measured baseline. See docs/PRESERVED-QUIRKS.md.
  return h.response({});
}

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
    // PRESERVED QUIRK - the event name below is MISSPELLED. archiver emits 'error', never
    // 'err', so this listener has never fired: reject(err) is unreachable and an archive
    // failure leaves outputPromise pending forever. Repairing the spelling would turn a
    // silent hang into a 500, which is a behaviour change (R-1 forbids latent-bug repair,
    // R-4 forbids behaviour changes). The typo is kept byte-for-byte. Note that the
    // adjacent 'warning' listener IS correctly named, and that downloadPostedZip above
    // spells its own error listener correctly - the inconsistency is baseline.
    // See docs/PRESERVED-QUIRKS.md.
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
    // legacyPathname() reproduces the deprecated legacy URL parser's pathname; see its
    // definition below and docs/PRESERVED-QUIRKS.md. This call site is UNGUARDED, so the
    // helper must reproduce that parser's tolerance of relative, protocol-less and empty
    // input rather than the null the WHATWG static URL.parse() returns for them.
    assetUrl  = legacyPathname(asset.url);
    assetFile = path.basename(assetUrl);

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

      // The deleted builder's .header() DID resolve, so this is a genuine working
      // response. Converted in the SAME call order: HTTP 200, content-type
      // application/zip, content-length == bytes, and this exact Content-Disposition with
      // the filename UNQUOTED (downloadPostedZip's is double-quoted - both are
      // client-visible and each is preserved verbatim). fs.createReadStream stays
      // synchronous and is deliberately not awaited.
      return h.response(outputReadStream)
        .type('application/zip')
        .bytes(bytes)
        .header('Content-Disposition', 'attachment; filename=' + trinket.shortCode + '.zip');
    })
    .catch(function(err) {
      return err;
    });
}

/**
 * The exact set of schemes Node's legacy `url` module treated as "slashed", mirroring its
 * own internal table. Only these - plus the hostless `javascript:` - had their pathname
 * reported the way the WHATWG parser reports it. Used by legacyPathname() below.
 */
var LEGACY_SLASHED_PROTOCOL = /^(https?|ftp|gopher|file|wss?):$/;

/**
 * Reproduce the deprecated legacy URL parser's `pathname` for every input it accepted.
 *
 * Dependency swap: the `parse` function on Node's legacy `url` module emits DEP0169 under
 * `--pending-deprecation`, which the zero-warning boot gate forbids. The replacement is
 * the NON-THROWING static `URL.parse()` - never the `URL` constructor, which raises
 * ERR_INVALID_URL on the relative, protocol-less and empty inputs that the legacy parser
 * tolerated and that the three asset call sites in this file feed it. Two of those three
 * call sites are UNGUARDED, so a `null` return followed by `.pathname` would raise a
 * TypeError and silently convert a working 200 into a 500.
 *
 * Two shapes need explicit handling because the two parsers genuinely disagree.
 *
 * First, schemes. The legacy parser produced the pathname WHATWG also reports only for
 * its own "slashed" schemes - http, https, ftp, gopher, file, ws and wss - and for the
 * hostless `javascript:`. For ANY other scheme it consumed the text up to the first
 * separator as a HOST and left `pathname` null when there was no separator at all, so
 * `mailto:a@b.c`, `tel:+1234`, `foo:bar` and `about:blank` all parsed to a null pathname
 * whose `path.basename()` threw. WHATWG instead exposes that whole remainder as an opaque
 * path, which would have turned a baseline 500 into a 200 for a client-supplied
 * `downloadPostedZip` asset URL. The host split is therefore re-derived below. A leading
 * `//` was the legacy parser's "slashes" form and was consumed before the host, while a
 * single leading `/` was not - which is why `c:/a/b.png` keeps its whole pathname but
 * `chrome://settings` loses it.
 *
 * Second, unparseable input. When WHATWG cannot parse the input at all the fallback
 * rebuilds what the legacy parser returned: the input itself, minus any fragment and
 * query, with backslashes normalised to slashes and the legacy autoEscape character set
 * percent-encoded, and `null` for input that trims to nothing (which is why
 * `path.basename('')`'s baseline TypeError is preserved rather than repaired).
 *
 * Verified 0 differences - in both the pathname AND the `path.basename()` every call site
 * actually derives from it - against `require('url').parse(x).pathname` across a 70-input
 * differential fixture set covering absolute http/https URLs with and without query,
 * fragment, port and userinfo; real S3 and CDN asset URLs including percent-encoded and
 * spaced filenames; protocol-relative URLs; root-relative, relative and bare-filename
 * paths; `data:`, `javascript:`, `mailto:`, `tel:`, `urn:`, `about:`, `blob:`, `chrome:`,
 * `file:`, `ftp:`, `ws:`, `wss:` and `gopher:` schemes; Windows drive-letter and
 * backslash paths; whitespace-only, query-only, fragment-only and empty strings; and
 * non-string values. See docs/PRESERVED-QUIRKS.md.
 *
 * @param {*} rawUrl The stored asset URL, exactly as the legacy parser received it.
 * @returns {String|null} The pathname, or null where the legacy parser also returned null.
 */
function legacyPathname(rawUrl) {
  var parsed = URL.parse(rawUrl), rest, slash;

  if (parsed) {
    if (LEGACY_SLASHED_PROTOCOL.test(parsed.protocol) || parsed.protocol === 'javascript:') {
      return parsed.pathname;
    }

    rest = parsed.href.slice(parsed.protocol.length).replace(/\\/g, '/');

    if (rest.slice(0, 2) === '//') {
      rest = rest.replace(/^\/+/, '');
    }

    slash = rest.indexOf('/');

    return slash === -1 ? null : rest.slice(slash);
  }

  rest = typeof rawUrl === 'string' ? rawUrl.trim() : rawUrl;

  if (!rest) {
    return null;
  }

  rest = rest.split('#')[0].split('?')[0];

  return rest ? rest.replace(/\\/g, '/').replace(/[{}|^`<>" \r\n\t]/g, encodeURIComponent) : null;
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
