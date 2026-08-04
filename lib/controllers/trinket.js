var mailer        = require('../util/mailer'),
    Folder        = require('../models/folder'),
    _             = require('lodash'),
    nunjucks      = require('nunjucks'),
    util          = require('util'),
    Pending       = require('../http/responseContract').pending,
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
    path          = require('path'),
    archiver      = require('archiver'),
    mime          = require('mime'),
    sluggify      = require('limax'),
    JSZip         = require("jszip");

// Dependency swap: the deprecated `url.parse()` is replaced by the non-throwing static
// `URL.parse()`, the Node 22 form the AAP prescribes. `URL.parse()` answers null - rather than
// throwing ERR_INVALID_URL the way `new URL()` does - for the protocol-less, relative and empty
// input the legacy parser tolerated, and that null MUST be neutralised: two of the three call
// sites below are unguarded, and an unguarded `.pathname` read would turn a working 200 into a
// TypeError. Falling back to the raw string reproduces the legacy result, whose pathname for a
// non-absolute input was the input itself. The derived value is a PERSISTED, CLIENT-VISIBLE
// asset filename inside a downloaded or posted zip archive, so it is a TR6 surface.
// See docs/PRESERVED-QUIRKS.md section 3.26.
function assetPathname(assetUrl) {
  var parsed = URL.parse(assetUrl);

  return parsed ? parsed.pathname : assetUrl;
}

(function() {

var supportedDownloadFormats = {
    'json' : downloadJSON
  , 'zip'  : downloadZip
};

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

    return h.respond(data);
  },
  beta : async function(request, h) {
    return h.respond({
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
        // The error-first callback this replaces ignored its `err`, so a cast error on a
        // malformed id - or any database failure - falls through to the redirect below
        // instead of surfacing as a 500. The swallowing .catch keeps that mapping.
        trinket = await Trinket.findById(trinketId).catch(function() {});

        if (trinket) {
          if (trinket._owner && trinket._owner.toString() === request.user.id) {
            return h.respond();
          }

          return h.redirect('/' + trinket.lang + '/' + trinket.shortCode);
        }

        return h.redirect('/login');
      }
      else {
        return h.respond();
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
  list : async function(request, h) {
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
        // The `!err &&` guard of the error-first callback this replaces is carried by the
        // swallowing .catch: a lookup failure leaves the match untouched and resolves anyway.
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
        return h.respond({ data : trinkets });
      })
      .catch(function(err) {
        return err;
      });
  },
  getById : async function(request, h) {
    var data = request.pre.trinket;

    if (!data._owner) {
      return h.respond({ data : data });
    }

    if (request.user && request.pre.trinket._owner && request.user.id.toString() === request.pre.trinket._owner.toString()) {
      data.username = request.user.username;

      return h.respond({ data : data });
    }
    else {
      return User.findById( data._owner)
        .then(function(user) {
          if (user) {
            data.username = user.username;
          }

          return h.respond({ data : data });
        })
        .catch(function(err) {
          return h.respond({ data : data });
        });
    }
  },

  // admin route for creating a copy of a trinket for a user
  grant : async function(request, h) {
    var trinket = request.pre.trinket.copy(request.pre.user.id, {noSnapshot:true});
    return trinket.save()
      // PRESERVED QUIRKS - see docs/PRESERVED-QUIRKS.md. Both responders are passed as BARE
      // FUNCTION REFERENCES, exactly as at the base commit, where the same two closures were
      // spelled request.success and request.fail. That is load bearing in two ways.
      //
      // On success, .then hands the saved document straight in as `json`, so
      // ObjectUtils.serialize invokes doc.serialize().
      //
      // On failure, .catch hands the ERROR in as `json` rather than as `err`, leaving the
      // failure responder's second parameter undefined - which is why its log line ends with
      // the literal string "undefined". This route declares neither `html` nor `fail`, so the
      // responder falls through to its plain-response branch and calls h.response() on the
      // Error itself, which hapi 21 REFUSES with AssertError "Cannot wrap an error"
      // (measured). That raise rejects this returned chain, routeParser's catch-all maps it,
      // and the wire result is a scrubbed HTTP 500. The base commit behaved identically: its
      // responder ended in the byte-identical h.response(json) statement, and the raise
      // rejected the same returned chain into the shim's own catch-all. It is NOT an HTTP 200.
      //
      // Do NOT rewrite either as .catch(function (err) { return h.reject({}, err); }): moving
      // the error into the `err` parameter would answer 200 with an empty body instead.
      .then(h.respond)
      .catch(h.reject);
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
        return h.respond({
          success : true
        });
      })
      // PRESERVED QUIRK - see docs/PRESERVED-QUIRKS.md. Bare responder reference, exactly as
      // at the base commit where the same closure was spelled request.fail: the error lands in
      // the responder's `json` parameter, not its `err` parameter. The argument order is part
      // of the observable behaviour and must not be "corrected". As in `grant` above, this
      // route declares neither `html` nor `fail`, so the responder calls h.response() on the
      // Error, hapi 21 raises AssertError "Cannot wrap an error", and the wire result is a
      // scrubbed HTTP 500 - identical to the base commit, whose responder ended in the same
      // statement and whose raise rejected the same returned chain.
      .catch(h.reject);
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
        // The mail `secret` config key does not exist in config/default.yaml, so this
        // expression evaluates to the literal string "undefined" + shortCode.
        // lib/util/helpers.js#verifyEmailToken builds the verification secret with the
        // IDENTICAL expression, so tokens round-trip; adding a fallback or a config key here
        // would invalidate every email-verification token already in the wild.
        emailSecret = config.app.mail.secret + doc.shortCode;
        emailToken  = jwt.sign({ shortCode: doc.shortCode }, emailSecret);
        sessionKey  = 'emailToken:' + doc.shortCode;
        request.yar.set(sessionKey, emailToken);

        return h.respond({data:doc});
      })
      .catch(function(err) {
        return err;
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

        return h.respond({ data : savedTrinket });
      })
      .catch(function(err) {
        return err;
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
      // Model.findById(id, callback) hands back the mongoose Query object itself - measured
      // constructor `Query`, and thenable - already executed by the callback form. A returned
      // thenable is assimilated at the first boundary it meets, so this async handler's
      // implicit promise adopts the Query, mongoose re-executes it, and it rejects with
      // `MongooseError: Query was already executed: Snippet.findOne(...)`. routeParser's
      // `await handler.call(...)` rethrows, its single catch hands the rejection to
      // lib/http/errorMap.js, and the branch answers HTTP 500 with the message scrubbed to
      // "An internal server error occurred" - measured over real HTTP on
      // PUT /api/trinkets/{trinketId}/metrics with an empty payload. Whatever the inner
      // callback builds is discarded; no h.respond() response reaches the wire.
      //
      // The `async` keyword is NOT what produces this and removing it would repair nothing.
      // Measured both ways against routeParser's own await/catch pair, an async handler and a
      // non-async twin yield the identical MongooseError and the identical scrubbed 500,
      // because the assimilation merely moves from the async boundary to routeParser's await.
      // Keep the statement, keep the `async` declaration that matches every other handler,
      // and do not "repair" this branch into a 200.
      return Trinket.findById(request.params.trinketId, function(err, trinket) {
        return h.respond({data:trinket});
      });
    }

    if (request.user) {
      meta._actor = request.user._id;
    }

    // Dropped-`.catch(reply)` derivation - referenced by the four other sites in this file
    // that shed the same tail (`remove`, `getByShortCode`, `embed`, `interactions`).
    //
    // The base commit ended this chain with `.catch(reply)`, where `reply` was the shim's
    // synthetic responder. For a NON-Boom rejection it built Boom.badImplementation from the
    // message and RETURNED it, and because the handler frame returned the chain that Boom
    // became the response: a 500 with the message scrubbed. Dropping the tail sends the same
    // rejection to routeParser's catch-all instead, which is byte-identical to the shim's own
    // catch-all (both are the block now living in lib/http/errorMap.js) and produces the same
    // scrubbed 500. Wire-equivalent, so the tail is not reconstructed.
    //
    // The one input that WOULD differ is a Boom rejection: the synthetic responder passed a
    // Boom through untouched, whereas the catch-all has no isBoom test and collapses it to a
    // 500 - the same asymmetry documented at the `errors.notFound()` return in
    // `getByShortCode`. That input is unreachable in all five chains: none of them throws a
    // Boom, and every value they can reject with (mongoose and model errors, and anything the
    // response contract raises) is a plain Error or an AssertError. Audited per chain rather
    // than assumed.
    return Trinket.findByIdAndUpdateMetrics(request.params.trinketId, metric, meta)
      .then(function(trinket) {
        return h.respond({data : trinket});
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

    // Shed a base `.catch(reply)` tail; see the derivation in `updateMetrics` above.
    return Promise.all(promises).then(function() {
      // Use soft delete instead of hard delete
      return trinket.softDelete()
        .then(function() {
          return h.respond({data : 1})
        });
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
        return supportedDownloadFormats[extension](request, h);
      }
      else {
        // Returned, never thrown - see the note at the top of this file. A thrown Boom would
        // become a 500 instead of this route's 404.
        return errors.notFound();
      }
    }

    // Shed a base `.catch(reply)` tail; see the derivation in `updateMetrics` above.
    return updateMetrics()
      .then(function(trinket) {
        displayTrinket = trinket || preTrinket;
      })
      .then(function() {
        return h.respond({
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

    // Shed a base `.catch(reply)` tail; see the derivation in `updateMetrics` above.
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

          return h.respond({
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
  assignment : async function(request, h) {
    return h.respond({
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
        return h.respond({
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
    return h.respond({
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
      // PRESERVED QUIRK - see docs/PRESERVED-QUIRKS.md. The failure responder - h.reject
      // here, spelled request.fail at the base commit - never sets a status, and this
      // route declares neither `html` nor `fail`, so the call falls through to the plain
      // h.response(json) branch and a mailer-not-configured share answers HTTP 200 with
      // this message carried in the 'failure' flash. It is NOT a 503 and must not become
      // one. The payload is a plain object, so h.response accepts it: this branch is
      // unaffected by the AssertError that a raw Error would raise (see `grant`).
      return h.reject({
        message: "Email is not configured. Sharing via email is not available."
      });
    }

    // recaptcha.verify is NOT error-first: its callback receives a single result object,
    // and with no secret key configured - the default, and always under test - it invokes
    // that callback SYNCHRONOUSLY with { success : true }. A Promise executor also runs
    // synchronously, so wrapping preserves that ordering, and the wrapper only ever
    // resolves because verify never reports a transport error to the callback.
    var result = await new Promise(function(resolve) {
      recaptcha.verify(request.payload['g-recaptcha-response'], function(verifyResult) {
        resolve(verifyResult);
      });
    });

    // On an HTTP failure verify reports { status : false }, so `result.success` is undefined
    // and this falls to the else branch. Do not normalize the key or add a `result.status` test.
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
          return h.respond();
        })
        .catch(function(err) {
          // PRESERVED QUIRK - see docs/PRESERVED-QUIRKS.md section 1.15. At the base commit
          // this ternary handed a `forbidden` Boom to the synthetic responder on the first
          // arm and called that responder with NO ARGUMENT AT ALL on the second.
          //
          // R-6 ADJUDICATION, MEASURED over real HTTP on @hapi/hapi 20.3.0 against a
          // verbatim replica of the base-commit wrapper: the first arm answered
          // HTTP 403 {"statusCode":403,"error":"Forbidden","message":"Forbidden"} - so that
          // message IS client visible, and the Boom must be RETURNED rather than thrown, per
          // the R-5/R-6 adjudication in `list`. The second arm answered NOTHING: the
          // no-argument call built the deleted shim's response builder, which only settled
          // the deferred capture from `redirect()`, `code()`, `header()` or `view()`, and no
          // terminator followed.
          //
          // That non-completion is the measured outcome and is reproduced rather than
          // replaced. An earlier revision answered 200 with `{}` on the reasoning that "a
          // hang is not a reproducible wire outcome"; it is, it was measured, and inventing a
          // 200 for a mail-send failure is exactly the substitution R-4 and TR2 forbid.
          return err === "threshold exceeded" ? errors.forbidden() : Pending.forever();
        });
    }
    else {
      return h.respond();
    }
  },
  snapshot : async function(request, h) {
    if (request.payload.snapshotData) {
      var img  = request.payload.snapshotData;
      var data = img.replace(/^data:image\/\w+;base64,/, "");
      var buf  = Buffer.from(data, 'base64');

      var timestamp  = new Date().getTime();
      var imagename  = request.pre.trinket.shortCode + '-' + timestamp + '.png';
      var localfile  = config.workers.trinkets.outputDir + imagename;

      var fileinfo = {
        path : config.workers.trinkets.outputDir,
        name : imagename
      };

      request.pre.trinket.snapshot = config.aws.buckets.snapshots.host + '/' + imagename;

      // Async conversion: FileUtil.uploadSnapshotFromBuffer (lib/util/file.js:L190) forwards
      // straight to FileUtil._upload (lib/util/file.js:L10), whose two-argument .then calls
      // `cb(null, data)` on success and `cb(err)` on failure - exactly once on every path,
      // as its own comment records. That is a genuine error-first callback, so util.promisify
      // is behavior-equivalent and replaces the hand-written bridge this handler carried.
      // Two details make it safe to call the method UNBOUND, the way promisify does: the
      // method body references the module-scope `self`, never `this`, and the next link in
      // the chain ignores its argument, so promisify resolving with the SDK's `data` where
      // the bridge resolved with `undefined` is unobservable.
      return util.promisify(FileUtil.uploadSnapshotFromBuffer)(imagename, buf)
        .then(function() {
          return request.pre.trinket.save();
        })
        // PRESERVED QUIRKS - see docs/PRESERVED-QUIRKS.md. Bare responder references again,
        // exactly as at the base commit where the same two closures were spelled
        // request.success and request.fail. On success .then hands the saved document
        // straight in as the success responder's `json`, so ObjectUtils.serialize invokes
        // doc.serialize(). On failure .catch hands the ERROR in as the failure responder's
        // `json` rather than as its `err`, so that second parameter is undefined and the log
        // line ends with the literal string "undefined".
        //
        // As in `grant` and `update` above, this route declares neither `html` nor `fail`,
        // so the failure responder reaches its plain-response branch and calls h.response()
        // on the Error itself, which hapi 21 REFUSES with AssertError "Cannot wrap an error"
        // (measured). That raise rejects this returned chain, routeParser's catch-all maps
        // it, and the wire result is a scrubbed HTTP 500 - identical to the base commit,
        // whose responder ended in the byte-identical h.response(json) statement. It is NOT
        // an HTTP 200, and neither responder may be rewritten to move the error into `err`.
        .then(h.respond)
        .catch(h.reject);
    }

    // This answers HTTP 200, application/json, body `{}`. The `{ status : "success" }`
    // payload it appears to send has never reached a client, because the responder it was
    // handed to returned a builder whose own enumerable properties are all functions.
    return h.response({});
  },
  interactions : async function(request, h) {
    var trinket = request.pre.trinket;

    // Shed a base `.catch(reply)` tail; see the derivation in `updateMetrics` above. This is
    // the one of the five whose base handler frame did NOT return its chain, so the shim's
    // responder settled the deferred capture rather than supplying a return value - the same
    // scrubbed 500 by a different route.
    return Interaction.findByTrinketId(trinket.id)
      .then(function(result) {
        return h.respond({data:result});
      });
  },
  addToList : async function(request, h) {
    trinketStore.unshift(request.pre.trinket.lang, request.query.name, request.pre.trinket.id);
    return h.respond({
      trinket : request.pre.trinket
    });
  },
  namedList : async function(request, h) {
    return h.respond(request.pre.namedTrinketList || []);
  },
  removeFromList : async function(request, h) {
    trinketStore.remove(request.params.lang, request.query.name, request.pre.trinket.id);
    return h.respond();
  },
  logError : async function(request, h) {
    var error = new ErrorEvent(request.payload);

    // The error-first callback this replaces ignored its `err` argument and answered
    // success either way, so the swallowing .catch keeps a failed save answering as before.
    await error.save().catch(function() {});

    return h.respond();
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
        return h.respond();
      })
      .catch(function(err) {
        return h.respond();
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

      // Both rejection handlers of the two-argument .then chain this replaces answered with a bare
      // request.success(), so an unreadable archive - a rejected loadAsync, a missing "zipCode" entry,
      // or a failed decompression - has always produced a plain success response rather than an error.
      // The single try/catch reproduces that shared outcome. JSON.parse below is kept OUTSIDE this
      // shared try because at the base commit it sat outside every rejection handler too -
      // `.then(onFulfilled, onRejected)` never routes onFulfilled's own throw into its sibling - and it
      // carries its own guard for the separate fate recorded there. See docs/PRESERVED-QUIRKS.md
      // sections 3.23 and 1.15.
      try {
        content = await zip.loadAsync(request.payload.zipCode, { base64: true });
        code    = await content.file("zipCode").async("string");
      }
      catch (err) {
        return h.respond();
      }

      // PRESERVED QUIRK - see docs/PRESERVED-QUIRKS.md section 1.15. At the base commit this
      // JSON.parse sat in the SUCCESS handler of the chain's second `.then`, and that whole chain
      // was DETACHED - `zip.loadAsync(...)` was a bare statement that was never returned - so the
      // rejection a bad parse produced had no handler downstream of it and nothing settled the
      // shim's deferred capture. Both of this branch's responders are the two rejection handlers
      // reproduced above, and the parse only runs once they have both been passed.
      // R-6 ADJUDICATION, MEASURED over real HTTP on @hapi/hapi 20.3.0 against a verbatim replica
      // of the base-commit wrapper: a "zipCode" entry whose decompressed text is not valid JSON
      // produced NO RESPONSE AT ALL. That wire outcome is reproduced below. The second,
      // process-level half - the unhandled rejection - is deliberately NOT reproduced, for the
      // same reason recorded at lib/controllers/folders.js: deliberately destabilising the process
      // would be a new behaviour rather than a preserved one, and no client can depend on it.
      // An earlier revision left the throw unhandled so the centralized error map answered a
      // scrubbed 500, on the reasoning that "a hang is not a reproducible wire outcome". It is, it
      // was measured, and a 500 here is exactly the substitution R-4 and TR2 forbid.
      try {
        update.code = JSON.parse(code);
      }
      catch (unparseableCode) {
        return Pending.forever();
      }

      return Draft.findOneAndUpdate(query, update)
        .then(function() {
          return h.respond({
            success : true
          });
        })
        .catch(function() {
          return h.respond();
        });
    }
    else {
      return Draft.findOneAndUpdate(query, update)
        .then(function() {
          return h.respond({
            success : true
          });
        })
        .catch(function() {
          return h.respond();
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
        return h.respond({
          success : true
        });
      })
      .catch(function() {
        return h.respond();
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

        // The two structurally redundant onRejected handlers are deliberately kept - R-1 forbids
        // opportunistic cleanup - and each hands its plain Error onward, which the retired responder
        // mapped to `badImplementation`: a 500 whose message the framework scrubs. Returning the Error
        // reproduces that exactly, which is why the guard below tests `code instanceof Error` FIRST and
        // returns it. A decompressed string that is not valid JSON is a DIFFERENT base-commit fate and
        // is handled separately below. See docs/PRESERVED-QUIRKS.md sections 3.23 and 1.15.
        return zip.loadAsync(request.payload.zipCode, { base64: true })
          .then(function(content) {
            return content.file("zipCode").async("string");
          }, function(err) {
            throw err;
          })
          .then(function(code) {
            // PRESERVED QUIRK - see docs/PRESERVED-QUIRKS.md section 1.15. Two different base
            // branches reach this point, and they answered differently.
            // (a) loadAsync rejected: the handler above ran `reply(err)`, which settled the
            //     deferred capture with `Boom.badImplementation` - an HTTP 500 whose message the
            //     framework scrubs - and then returned that Boom, which base carried straight into
            //     the JSON.parse below and which threw there. The throw rejected a chain nobody
            //     owned (`zip.loadAsync(...)` was a bare statement, never returned), so it changed
            //     nothing: the request had already been answered. JSZip rejects loadAsync with
            //     Error instances, which is why Error-ness is the discriminator here.
            // (b) the entry decompressed but its text is not valid JSON: JSON.parse threw with the
            //     deferred capture still unsettled, and the detached rejection had no handler.
            // R-6 ADJUDICATION, MEASURED over real HTTP on @hapi/hapi 20.3.0 against a verbatim
            // replica of the base-commit wrapper: (a) answered 500, (b) answered NOTHING AT ALL.
            // Both are reproduced. The process-level half of (b) - the unhandled rejection - is
            // deliberately NOT reproduced, for the reason recorded at lib/controllers/folders.js.
            // An earlier revision let (b) fall through to the centralized error map so it too
            // answered a scrubbed 500, on the reasoning that "a hang is not a reproducible wire
            // outcome". It is, it was measured, and collapsing (b) onto (a) is exactly the
            // substitution R-4 and TR2 forbid.
            if (code instanceof Error) {
              return code;
            }

            try {
              trinket.set('code', JSON.parse(code));
            }
            catch (unparseableCode) {
              return Pending.forever();
            }

            return trinket.save()
              .then(function() {
                return h.respond({
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
            return h.respond({
              success : true
            });
          }).catch(function(err) {
            return err;
          });
      }
    }
    else {
      // Returned, never thrown - see the note at the top of this file.
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
          return h.respond({
            success : true
          });
        })
        .catch(function(err) {
          return err;
        });
    }
    else {
      // Returned, never thrown - see the note at the top of this file.
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
          return h.respond({
            success : true
          });
        })
        .catch(function(err) {
          return err;
        });
    }
    else {
      // Returned, never thrown - see the note at the top of this file.
      return errors.forbidden();
    }
  },
  search : async function(request, h) {
    return Trinket.searchForOwner(request.user, request.query.q)
      .then(function(results) {
        return h.respond({
          data : results
        });
      })
      .catch(function(err) {
        return err;
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

        // This endpoint has never returned the main file's content: it answers HTTP 200,
        // content-type application/json; charset=utf-8, body {}. The mime.lookup() call above
        // and the `type` computation are kept because they are part of that response path.
        return h.response({});
      })
      // `return err;` - NOT `throw err;` - because the `notFound` Boom thrown above arrives
      // here and must keep its 404. See the note at the top of this file.
      .catch(function(err) {
        return err;
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
          // This branch answers HTTP 200, content-type application/json; charset=utf-8,
          // body {} - never the file's payload.
          return h.response({});
        }

        // check assets
        file = _.find(trinket.assets, { name : req_path });

        if (file) {
          // assetPathname() is the non-throwing URL.parse adapter defined at the head of this file;
          // see docs/PRESERVED-QUIRKS.md section 3.26.
          assetUrl = assetPathname(file.url);
          file     = path.basename(assetUrl);
          type     = mime.lookup(file) || type;

          return FileUtil.downloadUserAsset(file)
            .then(function(stream) {
              // Same as above: this asset branch answers HTTP 200 with body {} rather than the
              // asset bytes. FileUtil.downloadUserAsset resolves a Buffer, so the local name
              // `stream` is a misnomer that is left as-is.
              return h.response({});
            });
        }
        else {
          throw errors.notFound();
        }
      })
      // `return err;` - NOT `throw err;` - because both `notFound` Booms thrown above arrive
      // here and must keep their 404. See the note at the top of this file.
      .catch(function(err) {
        return err;
      });
  },
  updateSlug : async function(request, h) {
    var trinket  = request.pre.trinket
      , testSlug = sluggify(request.payload.slug, { separateNumbers : false });

    // validate slug format
    if (testSlug.toLowerCase() !== request.payload.slug) {
      // Returned, never thrown - see the note at the top of this file. This keeps the 400
      // "Bad Request".
      return errors.badRequest();
    }

    return trinket.updateSlug(request.payload.slug)
      .then(function(result) {
        return result
          ? h.respond()
          // A Boom RETURNED from a .then fulfils the chain and becomes the handler's
          // return value, so this keeps the baseline 409 "Conflict".
          : errors.conflict();
      })
      .catch(function(err) {
        return err;
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
    , finalizePromise
    , assetPromises      = []
    , assetUrl, assetFile, outputReadStream;

    // Sanitize filename
    var safeFilename = filename.replace(/[^a-zA-Z0-9_\-\s]/g, '').substring(0, 100) || 'trinket-download';

    // Async conversion: this hand-written bridge is RETAINED deliberately. It adapts an
    // EventEmitter, not an error-first callback: it must settle on whichever of FOUR
    // independent events fires first - archive 'error', archive 'warning' (unless the code
    // is ENOENT), outputWriteStream 'close', or outputWriteStream 'error'. util.promisify
    // adapts a single error-first callback and events.once awaits a single named event, so
    // neither expresses this first-past-the-post race or the ENOENT filter. The sibling
    // bridge in downloadZip below is retained for the same reason.
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
        // This call site is UNGUARDED - only `if (!asset.url) return;` and the /^data:/ test precede
        // it - so assetPathname()'s null fallback is what keeps a protocol-less or relative asset URL
        // from becoming a TypeError here (docs/PRESERVED-QUIRKS.md section 3.26).
        assetUrl  = assetPathname(asset.url);
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

        // archiver's finalize() has returned a rejectable Promise since well before this bump -
        // MEASURED: 2.1.1 and 7.0.1 both wire `_module.on('error', reject)` inside it - so
        // discarding it was already an unhandled-rejection path at the base commit, and nothing in
        // app.js, config/ or lib/ installs an unhandledRejection handler to absorb one. What the
        // bump DID change is the two guard paths: on ABORTED, and on a second finalize() call,
        // 2.1.1 emitted 'error' and returned `this` - not a promise at all - while 7.0.1 emits
        // 'error' AND returns Promise.reject(). Neither guard is reachable from this file (abort()
        // is never called and finalize() runs once per invocation), so this is ownership rather
        // than a live repair, but the promise must be owned either way.
        //
        // Awaiting it alongside outputPromise hands any rejection to the tail .catch() below - the
        // same place the 'error' listener above already routes it - so the status and payload are
        // unchanged; only the process-level death by unhandled rejection goes away, which is the
        // adjudication already recorded for the escaping TypeError in lib/controllers/folders.js.
        // The output stream's 'close' stays the completion signal, so `bytes` is still
        // archive.pointer() read after the file is fully written, and on the measured
        // non-completing shape - a source stream that errors, where neither 'error' nor 'close'
        // fires - both promises stay pending and the request goes on hanging exactly as it did.
        finalizePromise = archive.finalize();

        return Promise.all([outputPromise, finalizePromise])
          .then(function(settled) {
            return settled[0];
          });
      })
      .then(function(bytes) {
        outputReadStream = fs.createReadStream(zipFile);

        // Mark for cleanup after response
        request.params._tmp = zipFile;

        // Content-Disposition carries the filename in DOUBLE quotes here and UNQUOTED in
        // downloadZip below; both are client-visible and each is preserved verbatim.
        // fs.createReadStream stays synchronous and is deliberately not awaited.
        return h.response(outputReadStream)
          .type('application/zip')
          .bytes(bytes)
          .header('Content-Disposition', 'attachment; filename="' + safeFilename + '.zip"');
      })
      .catch(function(err) {
        // The unlink is FIRE-AND-FORGET: the error response is sent without waiting for it and
        // its rejection is swallowed, so a failed cleanup never changes the response.
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

  // This endpoint has never returned the assembled trinket JSON: it answers HTTP 200,
  // content-type application/json; charset=utf-8, body {}. The whole `data` assembly above
  // is retained because it is part of that response path.
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

  // Async conversion: this hand-written bridge is RETAINED for the same reason as its sibling
  // in downloadPostedZip above - it settles on the first of four independent EventEmitter
  // events, which no native promise API expresses. The misspelled listener below is a
  // separate, deliberately preserved defect and is not the reason for the retention.
  outputPromise = new Promise(function(resolve, reject) {
    // The event name below is MISSPELLED: archiver emits 'error', never 'err', so this
    // listener never fires - reject(err) is unreachable and an archive failure leaves
    // outputPromise pending forever. Repairing the spelling would turn a silent hang into a
    // 500. The typo is kept byte-for-byte; the adjacent 'warning' listener is correctly named.
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
    // The second UNGUARDED call site; assetPathname()'s null fallback carries it, exactly as above
    // (docs/PRESERVED-QUIRKS.md section 3.26).
    assetUrl  = assetPathname(asset.url);
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

      // Same finalize() promise as in downloadPostedZip above, and the same archiver 7 delta on the
      // ABORTED and second-finalize guards - but it MUST be handled differently here, and that
      // difference is the whole point.
      //
      // PRESERVED QUIRK. The rejection is deliberately NOT routed into outputPromise. The
      // misspelled `archive.on('err')` listener above is the reason an archive failure leaves this
      // request pending forever at the base commit; settling outputPromise from the finalize
      // rejection would repair that typo by the back door and turn a documented silent hang into a
      // 500 (R-1 forbids latent-bug repair, R-4 forbids behaviour changes). So the rejection is
      // OWNED and discarded instead: the request goes on hanging exactly as it did, while the
      // process-level death by unhandled rejection goes away. Not reproducing a process-level crash
      // is the same adjudication already recorded for the escaping TypeError in
      // lib/controllers/folders.js. Note that an archive failure here still raises separately, and
      // that raise is untouched: `archive.emit('error', ...)` has no listener at all on this
      // instance because the only one is misspelled, so the EventEmitter throws - on archiver 2.1.1
      // exactly as on 7.0.1.
      // See docs/PRESERVED-QUIRKS.md.
      archive.finalize().catch(function(finalizeError) {
        // Deliberately not acted on - see above. Returning the error rather than ignoring it keeps
        // this an explicit discard rather than an accidentally empty handler.
        return finalizeError;
      });

      return outputPromise;
    })
    .then(function(bytes) {
      outputReadStream = fs.createReadStream(zipFile);

      // data to tell onPreResponse to delete this file once the response is finished
      request.params._tmp = zipFile;

      // Content-Disposition carries the filename UNQUOTED here and double-quoted in
      // downloadPostedZip above; both are client-visible and each is preserved verbatim.
      // fs.createReadStream stays synchronous and is deliberately not awaited.
      return h.response(outputReadStream)
        .type('application/zip')
        .bytes(bytes)
        .header('Content-Disposition', 'attachment; filename=' + trinket.shortCode + '.zip');
    })
    .catch(function(err) {
      return err;
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
