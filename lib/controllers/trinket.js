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
    // Legacy URL parsing for the three asset sites below, which read `.pathname`
    // off the result and feed it to `path.basename`. It never returns null for a
    // relative or protocol-relative URL, and it throws ERR_INVALID_URL for a
    // malformed authority, so each site's own error path handles that throw.
    parseLegacy   = require('../util/url').parseLegacy,
    path          = require('path'),
    archiver      = require('archiver'),
    // mime is an ES module, so under CommonJS `require('mime')` resolves to the
    // module namespace and the Mime instance sits on `.default`.
    mime          = require('mime').default,
    sluggify      = require('limax'),
    JSZip         = require("jszip");

(function() {

var supportedDownloadFormats = {
    'json' : downloadJSON
  , 'zip'  : downloadZip
};

// Maps a rejected value onto a response, for every error edge in this controller
// that answers through it. Three outcomes, and the order of the tests below is
// load-bearing because a Boom is also an Error:
//
//   * a Boom          -> the Boom itself, so its own status is served (404/403/409/...)
//   * any other Error -> Boom.badImplementation(message): 500 whose payload is
//                        hapi's generic "An internal server error occurred", so
//                        the message stays on the Boom and never reaches the
//                        client.
//   * anything else   -> an empty JSON object: 200 with body `{}`.
//
// The result is RETURNED by every caller, never thrown: the handler catch-all in
// lib/util/routeParser.js rewrites a thrown value to `Boom.badImplementation(...)`,
// which would turn every 404, 403 and 409 in this controller into a 500.
function legacyReply(value, h) {
  if (value && value.isBoom) {
    return value;
  }

  if (value instanceof Error) {
    return errors.badImplementation(value.message);
  }

  // A non-Error value (a plain object, a string, a Buffer, a stream, undefined)
  // answers 200 with `{}` and discards the value. Every call site in this file
  // passes an Error, so this branch is a total-mapping fallback.
  return h.response({});
}

// Bounds on the base64 ZIP that `trinket.draft` and `trinket.autosave` accept in
// `request.payload.zipCode`. The routes' own `payload.maxBytes` of 10 MB bounds the
// COMPRESSED input only, so decompression needs its own limits.
//
// ZIP_MAX_ENTRIES leaves room for the directory and metadata records a client-side zip
// writer adds around the single `zipCode` entry these routes read.
// ZIP_MAX_TOTAL_UNCOMPRESSED_BYTES is over three times the route's own payload cap, so
// the zipCode path stays more permissive than the plain `code` path it mirrors.
// ZIP_MAX_EXPANSION_RATIO is applied to the payload's REAL byte count and sits two
// orders of magnitude above the 4-6:1 that trinket source deflates at (measured).
var ZIP_MAX_ENTRIES                   = 16
  , ZIP_MAX_TOTAL_UNCOMPRESSED_BYTES  = 32 * 1024 * 1024
  , ZIP_MAX_EXPANSION_RATIO           = 512;

// Early rejection from the central directory, before any entry is read.
//
// THE DECLARED SIZES ARE ATTACKER-CONTROLLED AND ARE ONLY EVER GROUNDS FOR REJECTION,
// NEVER FOR ADMISSION: JSZip 3.6.0 compares declared against actual only after it has
// expanded the entry (jszip/lib/compressedObject.js:27-40), so an archive that
// understates its contents passes every check made here. `readZipCodeWithinBounds`
// below is what bounds such an archive. This function rejects an oversized honest one
// without reading a byte, and bounds the entry count.
//
// A breach throws a plain Error rather than building a response. Thrown from the first
// `.then` link's onFulfilled it rejects that link, and the second link's existing
// onRejected answers the request - `request.success()` in `draft`, `legacyReply(err, h)`
// in `autosave` - so bounding the input introduces no new status code in this file.
//
// `content.files` is iterated rather than `content.file(name)`: a directory entry is not
// returned by `file()` and its `_data` sizes are undefined, so a non-finite value has to
// contribute zero rather than NaN.
function assertZipCodeWithinBounds(content) {
  var names = Object.keys(content.files)
    , total = 0
    , packed = 0
    , index, entry, declared, compressed;

  if (names.length > ZIP_MAX_ENTRIES) {
    throw new Error('zipCode archive declares ' + names.length +
      ' entries, above the ' + ZIP_MAX_ENTRIES + '-entry bound');
  }

  for (index = 0; index < names.length; ++index) {
    entry      = content.files[ names[index] ];
    declared   = entry && entry._data ? entry._data.uncompressedSize : 0;
    compressed = entry && entry._data ? entry._data.compressedSize   : 0;
    declared   = typeof declared   === 'number' && isFinite(declared)   && declared   > 0 ? declared   : 0;
    compressed = typeof compressed === 'number' && isFinite(compressed) && compressed > 0 ? compressed : 0;

    total  += declared;
    packed += compressed;

    if (total > ZIP_MAX_TOTAL_UNCOMPRESSED_BYTES) {
      throw new Error('zipCode archive declares more than ' +
        ZIP_MAX_TOTAL_UNCOMPRESSED_BYTES + ' uncompressed bytes in total');
    }
  }

  // An archive that admits its own amplification is refused here, at zero cost,
  // rather than after the streamed read below has emitted its way to the same
  // conclusion. Understating these numbers only moves the rejection to that read.
  if (packed > 0 && total > packed * ZIP_MAX_EXPANSION_RATIO) {
    throw new Error('zipCode archive declares a ' + Math.round(total / packed) +
      ':1 expansion, above the ' + ZIP_MAX_EXPANSION_RATIO + ':1 bound');
  }
}

// Reads one archive entry as a string under a cap on the bytes it actually EMITS, and
// stops the expansion the moment the cap is passed. Nothing here reads a declared size,
// which is what makes it hold against a forged central directory.
//
// `internalStream` is the same public path `async(type)` takes - `async` is
// `internalStream(type).accumulate()` - so the decoding is unchanged; what differs is
// that chunks are counted as they arrive and `pause()` stops the pipeline upstream
// between ticks. Overshoot is bounded by one chunk, JSZip's 16 KiB read unit.
//
// The cap is the lower of the absolute limit and `compressedBytes` times the ratio
// limit, so a small payload cannot amplify even while staying under the absolute limit.
// `compressedBytes` is the size of what the client actually sent, never a number the
// archive declares about itself.
//
// Rejects rather than throwing, so the value reaches the same second-link onRejected -
// and therefore the same response - as every other failure on this path.
function readZipCodeWithinBounds(entry, compressedBytes) {
  var ratioCap = compressedBytes > 0
        ? compressedBytes * ZIP_MAX_EXPANSION_RATIO
        : ZIP_MAX_TOTAL_UNCOMPRESSED_BYTES
    , cap = Math.min(ZIP_MAX_TOTAL_UNCOMPRESSED_BYTES, ratioCap);

  return new Promise(function(resolve, reject) {
    var parts   = []
      , emitted = 0
      , settled = false
      , stream;

    function fail(err) {
      if (settled) {
        return;
      }
      settled = true;
      parts   = null;
      reject(err);
    }

    // A missing `zipCode` entry arrives here as null and its dereference rejects this
    // promise, which is the same disposition the dereference produced before.
    stream = entry.internalStream('string');

    stream.on('data', function(chunk) {
      if (settled) {
        return;
      }

      emitted += chunk.length;

      if (emitted > cap) {
        stream.pause();
        return fail(new Error('zipCode entry emitted more than ' + cap +
          ' units, above the bound for a ' + compressedBytes + '-byte payload'));
      }

      parts.push(chunk);
    })
    .on('error', fail)
    .on('end', function() {
      if (settled) {
        return;
      }
      settled = true;
      resolve(parts.join(''));
    })
    .resume();
  });
}

// The compressed byte count of a base64 payload, for the ratio bound above. Every four
// base64 characters carry three bytes; padding makes this an upper bound by at most two,
// which is immaterial at these magnitudes.
function base64ByteLength(value) {
  return typeof value === 'string' ? Math.floor(value.length * 3 / 4) : 0;
}

// Whether `user` may mutate `resource`, by the SAME predicate the framework's own
// `canEdit` pre-handler applies (lib/util/helpers.js:76-80): the resource's `_owner`
// compared against the acting user's id, taking the populated value when the document
// was populated and the raw ObjectId's string form otherwise.
//
// It is reproduced here rather than required because `canEdit` is registered as a
// server method reached through the route DSL. Six sibling trinket-mutation routes
// carry it in their `pre` list (config/api_routes.js:779, 796, 811, 827, 1065, 1080);
// `POST` and `DELETE /api/trinkets/{trinketId}/folder` do not
// (config/api_routes.js:1036-1057), and neither of their two `pre` entries checks
// ownership, so the handlers below are where that authority has to be applied.
//
// The comparison keeps the same strict `===` against `user.id` that helpers.js uses
// and is NOT loosened with a String() coercion: a coercion would accept a populated
// ObjectId that the authority itself rejects, making this copy more permissive than
// the control it stands in for.
function canEditTrinket(resource, user) {
  var ownerId;

  if (!resource || !user) {
    return false;
  }

  ownerId = resource.populated ? resource.populated('_owner') || "" : "";

  if (!ownerId && resource._owner) {
    ownerId = resource._owner.toString();
  }

  return !!ownerId && ownerId === user.id;
}

// The name used when a canonicalised entry name comes out empty. Fixed rather than
// random or time-derived so an archive built from the same input is reproducible, and
// so it cannot itself become a traversal component.
var ARCHIVE_FALLBACK_ENTRY_NAME = 'file';

// Canonicalises an archive entry name so it cannot escape the archive root, applied to
// every attacker-influenced name this controller hands to `archive.append`.
//
// The contract, and why each half of it is here (the measured archiver 2.1.1 truth
// table this was built against is in docs/preserved-quirks.md section 10.6):
//   - Names archiver already normalises - repeated slashes, leading slashes, a drive
//     letter, backslashes - come out of here byte for byte as archiver would leave
//     them, so a legitimate archive is unchanged.
//   - '..' and '.' segments, which archiver passes through VERBATIM, are resolved
//     away. That is the containment; it is the traversal archiver does not stop.
//   - Control characters, including NUL, are removed; archiver passes those through too.
//   - The result is never empty. An empty name makes archiver emit an 'error' event
//     (core.js:561-563), which turns `downloadPostedZip` into a 500 and in
//     `downloadZip` reaches no handler at all, so it falls back to the fixed name above.
//
// NONE of the containment is delegated to archiver: `package.json` declares
// `archiver ^6.0.2` while 2.1.1 is installed, so a control resting on the library's own
// normalisation would be version-dependent by construction.
//
// A hostile name is canonicalised and the entry is KEPT, not rejected, so status,
// content-type and entry count are unaffected.
function archiveEntryName(value) {
  var raw = (value === null || typeof value === 'undefined') ? '' : String(value)
    , segments
    , resolved = []
    , index
    , segment
    , name;

  // Control characters and NUL survive archiver and can be used to make a stored name
  // read differently from the bytes on disk; the leading drive prefix and backslashes
  // are the Windows-shaped route to the same escape.
  raw = raw.replace(/[\x00-\x1f\x7f]/g, '');
  raw = raw.replace(/\\/g, '/');
  raw = raw.replace(/^[A-Za-z]:/, '');

  segments = raw.split('/');

  for (index = 0; index < segments.length; ++index) {
    segment = segments[index];

    // Empty segments come from leading, trailing and doubled separators; '.' is a
    // no-op component. Both are dropped, which is what archiver does with the first
    // two and what containment requires of the third.
    if (segment === '' || segment === '.') {
      continue;
    }

    if (segment === '..') {
      // Pop, and never below the root: an entry can climb back only over ground it
      // has already covered inside the archive.
      resolved.pop();
      continue;
    }

    resolved.push(segment);
  }

  name = resolved.join('/');

  // POST-CONDITION. Asserted rather than assumed, because this is the security
  // boundary: no leading separator, no '..' component and never empty.
  if (name === '' || name.charAt(0) === '/' || resolved.indexOf('..') !== -1) {
    return ARCHIVE_FALLBACK_ENTRY_NAME;
  }

  return name;
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

    // A lookup failure -- a CastError on a malformed id, for instance -- is
    // intentionally swallowed into `null`, so both branches below take their
    // not-found path and the request answers 302 -> /login rather than 500.
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
  // folders.trinkets can call it directly. Each caller applies its own
  // `request.success` projection to what listCore returns.
  list : async function(request, h) {
    // Called OUTSIDE the try on purpose. listCore builds the match and pipeline
    // synchronously, so a bad input -- `new ObjectId('nonsense')` for the folder,
    // say -- throws from this line and propagates to the route catch-all, which
    // logs the stack and answers 500. Only the aggregation's own failure is
    // mapped locally, by the catch below.
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

        // The chain is returned, so this projection is the handler's response.
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
      // No metric supplied. This branch is written to answer with the current
      // trinket state, and intentionally keeps a shape that cannot: the callback
      // executes the query, and returning the Query from this async function
      // makes it awaited and executed a second time, which Mongoose rejects with
      // "Query was already executed". The route catch-all answers 500, so the
      // projection in the callback never reaches a client.
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
        // downloadJSON and downloadZip are not route handlers, but they produce
        // this route's response, so they are given the toolkit and their value is
        // returned straight through.
        return supportedDownloadFormats[extension](request, h);
      }
      else {
        // Returned, not thrown: the route catch-all rewrites a thrown Boom to
        // badImplementation, which would turn this 404 into a 500.
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

    // recaptcha.verify takes a callback, so the await boundary belongs here at the
    // call site: lib/util/recaptcha.js is a utility, not a lifecycle method.
    //
    // The promise intentionally has no reject path. Two of verify's outcomes never
    // invoke the callback -- a transport failure reads `statusCode` off an
    // undefined response, and a 200 carrying a non-JSON body throws out of
    // JSON.parse -- and both throw from a later tick inside that module, as
    // uncaught exceptions rather than as a value here. On those two the await
    // never settles, so no response is manufactured for a call that produced none.
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
              // Returned, not thrown, so the client gets the 403 rather than the
              // 500 the route catch-all would make of a throw.
              return errors.forbidden();
            }

            // Any other send failure intentionally answers nothing: this promise
            // never settles, so the request is left unanswered until the client
            // gives up. Reachable only when mail is configured and mailer.send
            // rejects with something other than "threshold exceeded".
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

    // A request carrying no snapshotData intentionally answers 200 with an empty
    // JSON object: no status field, and no error to say nothing was stored.
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

    // A failed save is intentionally swallowed: the route answers success either
    // way. The await is what keeps the response behind the save, so the record is
    // persisted -- or has failed -- before the client is told anything.
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

      // The chain below is intentionally not returned: the request is answered
      // from inside it by whichever reaction reaches `resolve` first, and the
      // chain's own tail runs on unobserved.
      //
      // That tail is load-bearing on a malformed zipCode. loadAsync rejects, the
      // onRejected answers the request and passes the response object on into the
      // chain, and the next onFulfilled calls JSON.parse on it, which throws.
      // Nothing downstream handles that rejection and nothing in this application
      // listens for 'unhandledRejection', so the process exits after the client
      // has been answered.
      return await new Promise(function(resolve) {
        zip.loadAsync(request.payload.zipCode, { base64: true })
          .then(function(content) {
            // Reject an oversized honest archive from the central directory, then
            // read the entry under a cap on the bytes it actually emits. Either
            // breach is answered by the second link's onRejected below.
            assertZipCodeWithinBounds(content);

            return readZipCodeWithinBounds(content.file("zipCode"),
              base64ByteLength(request.payload.zipCode));
          }, function(err) {
            // Answers the request and passes the same response object on into the
            // chain, where the JSON.parse below throws on it.
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
          })
          // Terminal handler for the detached chain, carrying this branch's own
          // disposition. Discarded where the request has already been answered, so
          // the wire is unchanged; answers instead of hanging where nothing had. It
          // is what keeps the rejection away from Node's unhandled-rejection handler.
          .catch(function(err) {
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

        // The chain below is intentionally not returned; the request is answered
        // from inside it by whichever reaction reaches `resolve` first.
        //
        // On a malformed zipCode loadAsync rejects, the onRejected answers 500 and
        // passes that same Boom on into the chain, and the next onFulfilled calls
        // JSON.parse on it, which throws. Nothing downstream handles that
        // rejection and nothing in this application listens for
        // 'unhandledRejection', so the process exits after the 500 is sent.
        return await new Promise(function(resolve) {
          zip.loadAsync(request.payload.zipCode, { base64: true })
            .then(function(content) {
              // Same two bounds as `draft` above: the central-directory rejection,
              // then the emitted-byte cap. Either breach is answered by the second
              // link's onRejected below.
              assertZipCodeWithinBounds(content);

              return readZipCodeWithinBounds(content.file("zipCode"),
                base64ByteLength(request.payload.zipCode));
            }, function(err) {
              // Answers the request and passes the same Boom on into the chain,
              // where the JSON.parse below throws on it.
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
            })
            // Terminal handler for the detached chain, carrying this branch's own
            // disposition. Discarded where the request has already been answered, so
            // the wire is unchanged. It is what keeps the rejection away from Node's
            // unhandled-rejection handler.
            .catch(function(err) {
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

    // TWO-SIDED AUTHORIZATION. `hasPermission("add-trinket", "folder", ...)` is a role
    // held on the FOLDER, while every mutation below acts on the TRINKET, which arrives
    // from a separate `trinket(params.trinketId)` pre-handler that performs no ownership
    // check. On the folder permission alone, a user who owns any folder could file
    // somebody else's trinket into it - `folder.addTrinket(trinket, request.user)` and
    // `trinket.addFolder(folder)` both write, and the `checkCurrent` branch below
    // additionally removes the victim's trinket from the victim's OWN current folder.
    //
    // Both rights are therefore required. The deny value is the `errors.forbidden()`
    // this handler's own `else` already returned, so the status and payload of a refusal
    // are unchanged whichever side fails.
    if (request.user.hasPermission("add-trinket", "folder", { id : folder.id }) &&
        canEditTrinket(trinket, request.user)) {
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
      , trinket = request.pre.trinket
      , relatedByTrinket, relatedByFolder;

    // The same two-sided authorization as `addToFolder` above, for the same reason:
    // `folder.removeTrinket(trinket.id)` and `trinket.removeFolder()` mutate a trinket
    // that the folder permission says nothing about.
    //
    // Plus a resource-relationship check, because the two ids arrive from independent
    // pre-handlers and nothing has established that they belong together. The link is
    // recorded on both sides - `trinket.folder.folderId` (lib/models/trinket.js:44-49)
    // and an entry in `folder.trinkets` keyed by `trinketId` (lib/models/folder.js:8-10)
    // - and EITHER side is accepted deliberately: requiring both would refuse an owner
    // the ability to clean up a half-written link, which `addTrinket`/`addFolder` can
    // leave behind because they are two separate writes. Both are ObjectId-valued, so
    // the comparison goes through String().
    relatedByTrinket = !!(trinket.folder && trinket.folder.folderId &&
      String(trinket.folder.folderId) === String(folder.id));

    relatedByFolder = !!(folder.trinkets && folder.trinkets.some(function(entry) {
      return entry && entry.trinketId && String(entry.trinketId) === String(trinket.id);
    }));

    if (request.user.hasPermission("add-trinket", "folder", { id : folder.id }) &&
        canEditTrinket(trinket, request.user) &&
        (relatedByTrinket || relatedByFolder)) {
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
    // PRESERVED SEAM, deliberately not aligned: this route answers `{"data":[...]}`
    // while its only consumer in this repository - the raw `$http` call in
    // public/js/courseEditor/controllers/toolbarControl.js:41 - iterates
    // `results.data.results`. That read is `undefined`, so the course-editor trinket
    // typeahead lists nothing and reports no error. The response body is bound by
    // digest in the parity corpus and `public/js/**` is unchanged by AAP 0.2.2, so
    // neither side can move here. Recorded in docs/preserved-quirks.md section 10.5.
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
            // A blocks trinket stores its program as XML, so the single file is
            // named and typed as XML rather than left at text/plain.
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

        // This route intentionally answers 200 with an empty JSON object: neither
        // the assembled `code` nor the `type` computed above is sent, so the main
        // file download carries no file content and no content type of its own.
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
            // A blocks trinket stores its program as XML; anything else stays at
            // the text/plain default.
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

        // check code for file and answer if found
        file = _.find(code, { name : req_path });

        if (file) {
          // As in downloadMain, this intentionally answers 200 with an empty JSON
          // object rather than the matched file's content.
          return h.response({});
        }

        // check assets
        file = _.find(trinket.assets, { name : req_path });

        if (file) {
          // A malformed stored asset URL throws ERR_INVALID_URL out of parseLegacy
          // and lands in this function's `.catch` below, which answers 500.
          assetUrl = parseLegacy(file.url);
          file     = path.basename(assetUrl.pathname);
          // getType returns null for an unknown or absent extension, so `type`
          // keeps its text/plain default. Nothing sends it: the response below
          // carries an empty JSON object.
          type     = mime.getType(file) || type;

          return FileUtil.downloadUserAsset(file)
            .then(function(stream) {
              // The asset is fetched and then intentionally not sent: 200 `{}`.
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
      // Returned, not thrown, so the client gets the 400 rather than a 500.
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
    // PRIVATE TEMP DIRECTORY, because this route is unauthenticated and its archive
    // path must be neither shared nor guessable: `mkdtempSync` yields a 0700
    // directory nobody else can name, and fails rather than reusing an existing one,
    // so concurrent requests cannot truncate one another's archive. `/tmp` stays the
    // parent so the location matches baseline; the leaf name is fixed because it
    // never reaches the client - the downloaded name comes from the
    // Content-Disposition header built below. Synchronous because it sits in the
    // handler's existing synchronous initialiser block beside the write stream it
    // feeds, and there is no callback form of it for T-5 to convert.
    , zipDir           = fs.mkdtempSync("/tmp/trinket-download-")
    , zipFile          = path.join(zipDir, "download.zip")
    , outputWriteStream  = fs.createWriteStream(zipFile)
    , outputPromise
    , assetPromises      = []
    , assetUrl, assetFile, outputReadStream;

    // Removes the archive and the private directory that holds it, once, on whichever
    // outcome happens first. Deliberately NOT awaited anywhere it is called, exactly
    // as the fire-and-forget unlink this handler already used: the response must not
    // wait for the deletion and the deletion's own failure must stay invisible.
    // `force` covers the case where the file was never created.
    var removeZipDir = function() {
      fs.promises.rm(zipDir, { recursive : true, force : true }).catch(function() {});
    };

    // Sanitize filename
    var safeFilename = filename.replace(/[^a-zA-Z0-9_\-\s]/g, '').substring(0, 100) || 'trinket-download';

    outputPromise = new Promise(function(resolve, reject) {
      archive.on('error', function(err) {
        reject(err);
      });

      // An ENOENT warning is swallowed, so the archive is served without the
      // entry it names; any other warning fails the whole download.
      archive.on('warning', function(err) {
        if (err.code !== 'ENOENT') {
          reject(err);
        }
      });

      // 'close' on the write stream, not 'end' on the archive: the byte count is
      // only final once the file is flushed and closed.
      outputWriteStream.on('close', function() {
        resolve(archive.pointer());
      });

      outputWriteStream.on('error', function(err) {
        reject(err);
      });
    });

    archive.pipe(outputWriteStream);

    // Add code files. The key is a name the caller chose - this route is
    // unauthenticated - so it is canonicalised before it becomes an entry path.
    for (var name in files) {
      if (files.hasOwnProperty(name)) {
        archive.append(files[name] || '', { name : archiveEntryName(name) });
      }
    }

    // Download and add assets.
    //
    // RESIDUAL, stated rather than papered over: a malformed asset URL throws
    // ERR_INVALID_URL synchronously out of this loop. That throw must keep reaching
    // the route catch-all, because the 500 it produces there is this route's measured
    // baseline response - which is why it is not caught locally, and the reason a
    // local `try` is also rejected by the source pin in `test/lib/api/trinket.js`.
    // It leaves the handler before the promise chain below exists, so neither that
    // chain's `.catch` nor the read stream's events run, and the private directory
    // created above survives the request holding whatever had been appended before
    // the throw (measured: 56 bytes for a one-code-file request).
    //
    // Creating the directory after this loop would close the leftover, but it moves
    // the stream setup of a corpus-bound response relative to its `archive.append`
    // calls - a larger behavioural risk than the leftover it removes. Cleaning up in
    // an `onPreResponse` extension would need a request-scoped registry this
    // controller does not have and app.js does not consult.
    //
    // The two named CWE classes are closed either way: the leftover is a uniquely
    // named, unguessable 0700 directory holding only the requester's own bytes, where
    // the old path was shared, predictable, and served across requests.
    assets.forEach(function(asset) {
      if (!asset.url) return;

      // Handle data URLs directly
      if (/^data:/.test(asset.url)) {
        var matches = asset.url.match(/^data:([^;]+);base64,(.+)$/);
        if (matches) {
          var buffer = Buffer.from(matches[2], 'base64');
          // `asset.name` arrives in the same unauthenticated payload as the data URL.
          archive.append(buffer, { name : archiveEntryName(asset.name) });
        }
      }
      else {
        // A malformed asset URL throws ERR_INVALID_URL synchronously out of this
        // forEach, before the chain below exists, so it reaches the route
        // catch-all as a 500 and skips that chain's unlink of the partial archive.
        assetUrl  = parseLegacy(asset.url);
        assetFile = path.basename(assetUrl.pathname);
        assetPromises.push(
          FileUtil.downloadUserAsset(assetFile)
            .then(function(data) {
              return { name: asset.name, data: data };
            })
            // A failed asset download is logged and skipped: the null lands in
            // `results` below and the archive is served without that asset.
            // downloadZip does the opposite and fails the whole request.
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
            // `result.name` is the same payload-supplied `asset.name` carried through
            // the download promise above.
            archive.append(result.data, { name : archiveEntryName(result.name) });
          }
        });

        archive.finalize();

        return outputPromise;
      })
      .then(function(bytes) {
        outputReadStream = fs.createReadStream(zipFile);

        // The archive and its private directory go once the response stream is done
        // with them, on either terminating event. The cleanup hangs off the read
        // stream rather than an `onPreResponse` extension because no such extension
        // exists: `request.params._tmp` is assigned below and read nowhere in this
        // repository. The assignment stays because it is inert.
        outputReadStream.on('close', removeZipDir);
        outputReadStream.on('error', removeZipDir);

        request.params._tmp = zipFile;

        // The response is the read stream over the finished archive, so a read
        // error on it arrives after the headers are on the wire and the client
        // sees a truncated body rather than a status. `Content-Disposition` quotes
        // the filename here; downloadZip emits its own unquoted.
        return h.response(outputReadStream)
          .type('application/zip')
          .bytes(bytes)
          .header('Content-Disposition', 'attachment; filename="' + safeFilename + '.zip"');
      })
      .catch(function(err) {
        // Fire-and-forget, exactly as the empty callback was: the response must not
        // wait for the deletion, and the deletion's own failure must stay invisible.
        // Deliberately NOT awaited. The whole private directory goes, not just the
        // file, so a failed request leaves nothing behind either.
        removeZipDir();
        return errors.badImplementation(err.message);
      });
  }
}

// Attached after the handler map rather than inside it, so the map stays a pure
// route-name -> handler lookup: routeParser resolves route handlers by property
// name off this object.
module.exports.listCore = listCore;

// The trinket listing logic, shared by the `list` route handler above and by
// lib/controllers/folders.js `trinkets`, which calls it directly. It takes its
// inputs explicitly -- no `request` and no toolkit -- so neither caller inherits
// the other's projection or error mapping.
//
// `listOptions` mirrors the optional query keys of GET /api/trinkets: `sort`,
// `folder`, `user`, `from`, `offset`, `limit`. The PRESENCE of `folder` is
// load-bearing; see the match block below. `actingUser` owns the trinkets
// listed, and only an `actingUser` with the admin role can select another owner
// through `listOptions.user`.
//
// Returns a promise for the aggregated, mapped trinket documents. A malformed
// folder id throws synchronously out of `new ObjectId(...)` before any pipeline
// runs, and an aggregation failure rejects, so each caller keeps its own error
// mapping for both.
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
  // There is no "unfiltered" mode: omitting `folder` does not widen the query, it
  // narrows it to trinkets that are in NO folder. A caller that wants a folder's
  // contents must pass `folder`; one that passes nothing gets the unfiled set.
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
        // `resolve()` runs regardless of `err` and reject is never used, so a
        // failed or empty owner lookup intentionally leaves the acting user's own
        // trinkets selected: a `user` naming nobody lists the caller's own
        // trinkets rather than answering 404 or 500.
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
      // Both callers receive the same document shape from here: `id` mirrored off
      // `_id`, `username` resolved to the looked-up owner or else the acting
      // user, and Trinket.checkSnapshot applied.
      trinkets.map(function(trinket) {
        trinket.id = trinket._id;
        trinket.username = trinketUsername || actingUser.username;
        Trinket.checkSnapshot(trinket);
        return trinket;
      });

      return trinkets;
    });
}

// Dispatch target for the `.json` extension, reached from getByShortCode through
// supportedDownloadFormats. It is not a route handler, so it is given the toolkit
// and its return value becomes that route's response.
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

  // `data` is assembled and then intentionally not sent: the `.json` download
  // answers 200 with an empty JSON object, so the metadata, code listing and
  // asset list above never reach a client.
  return h.response({});
}

// Dispatch target for the `.zip` extension, also reached through
// supportedDownloadFormats: it writes the archive to a temporary file and
// answers with a read stream over it.
function downloadZip(request, h) {
  var archive = archiver('zip', {
    zlib: { level: 9 } // Sets the compression level.
  })
  , trinket            = request.pre.trinket
  // Private per-request directory, as in `downloadPostedZip`. It matters at least as
  // much here: the path was keyed on the trinket's PUBLIC shortCode, so it was not
  // per-request at all and two concurrent downloads of one trinket collided on a
  // guessable name.
  , zipDir             = fs.mkdtempSync("/tmp/trinket-download-")
  , zipFile            = path.join(zipDir, "download.zip")
  , outputWriteStream  = fs.createWriteStream(zipFile)
  , outputPromise
  , proxyUrl           = config.app.embed.proxy + '/'
  , proxyRegExp        = new RegExp(proxyUrl)
  , includeHiddenFiles = false
  , assetPromises      = []
  , code, mainName, assetUrl, assetFile, outputReadStream, i;

  // Same contract as the helper of the same name in `downloadPostedZip`: removes the
  // archive and its private directory once, on whichever outcome happens first, and
  // is never awaited so response timing is unchanged.
  var removeZipDir = function() {
    fs.promises.rm(zipDir, { recursive : true, force : true }).catch(function() {});
  };

  outputPromise = new Promise(function(resolve, reject) {
    // archiver emits 'error', not 'err', so this listener never runs: an archive
    // failure is an unhandled 'error' event on the stream, which throws rather
    // than rejecting outputPromise. downloadPostedZip listens for 'error'.
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
    // `file.name` comes from the stored `trinket.code` JSON, which the trinket's own
    // author wrote, so it is attacker-controlled for anyone downloading a shared or
    // embedded trinket.
    archive.append(file.content, { name : archiveEntryName(file.name) });
  });

  // The same residual as the asset loop in `downloadPostedZip`, for the same reason:
  // this throw happens before the returned chain exists, and the call may not be
  // wrapped in a `try` because `test/lib/api/trinket.js` pins it outside one so
  // ERR_INVALID_URL keeps reaching the route catch-all. A malformed STORED asset URL
  // therefore leaves the private directory behind, holding the partial archive built
  // before the throw. The collidable shared path the finding names is gone either way.
  trinket.assets.forEach(function(asset) {
    // This loop runs synchronously, before the chain below exists, so a malformed
    // stored URL throws ERR_INVALID_URL straight out of downloadZip and through
    // getByShortCode to the route catch-all, which answers 500.
    assetUrl  = parseLegacy(asset.url);
    assetFile = path.basename(assetUrl.pathname);

    assetPromises.push(FileUtil.downloadUserAsset(assetFile));
  });

  return Promise.allSettled(assetPromises)
    .then(function(streams) {
      // One failed asset download fails the whole archive: the throw reaches the
      // `.catch` below and answers 500, leaving the partial file in /tmp.
      for (i = 0; i < streams.length; i++) {
        if (streams[i].status === "fulfilled") {
          // Stored asset name, from the same author-controlled document.
          archive.append(streams[i].value, { name : archiveEntryName(trinket.assets[i].name) });
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

      // The archive and its private directory are removed on either terminating event
      // of the response stream. `request.params._tmp` is assigned below for the same
      // reason as in `downloadPostedZip` - it is inert. Nothing in this repository
      // reads it, so the `onPreResponse` deletion the original comment described does
      // not exist and every successful download used to leak its archive.
      outputReadStream.on('close', removeZipDir);
      outputReadStream.on('error', removeZipDir);

      request.params._tmp = zipFile;

      // The response is the read stream over the finished archive, so a read
      // error on it arrives after the headers are on the wire and the client sees
      // a truncated archive rather than a status. `Content-Disposition` leaves the
      // filename unquoted here; downloadPostedZip quotes its own.
      return h.response(outputReadStream)
        .type('application/zip')
        .bytes(bytes)
        .header('Content-Disposition', 'attachment; filename=' + trinket.shortCode + '.zip');
    })
    .catch(function(err) {
      // Fire-and-forget, never awaited: the failing response is built and returned
      // below without waiting for the deletion, and the deletion's own failure stays
      // invisible. `legacyReply` still decides the response, so the status and payload
      // of every failure on this route are unchanged.
      removeZipDir();
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
