var errors       = require('@hapi/boom')
  , config       = require('config')
  , Trinket      = require('../models/trinket')
  , _            = require('underscore');

// `GET /api/trinkets`' listing logic, lifted into a plain async function by
// lib/controllers/trinket.js. `trinkets` below reaches it directly instead of
// re-entering that route through server.inject: @hapi/shot calls url.parse() on
// every injected request (node_modules/@hapi/shot/lib/request.js:30), which emits
// DEP0169, and this controller had injection on the live request path.
//
// The module is captured rather than the function, so `listCore` is resolved at
// call time. trinket.js does not require this file, so there is no cycle today;
// reading the member late means one appearing later cannot leave a stale binding.
var trinketController = require('./trinket');

/**
 * Reproduces, exactly, the response the legacy `reply(value)` compatibility shim
 * produced (lib/util/routeParser.js:391-439). Measured on @hapi/hapi 21.4.10 that
 * shim mapped a value to three outcomes:
 *
 *   * a Boom        -> the Boom itself, so its own status is served (403/404/...)
 *   * any Error     -> Boom.badImplementation(message): 500 carrying hapi's generic
 *                      "An internal server error occurred" payload. The original
 *                      message is logged by the route catch-all, never echoed.
 *   * anything else -> the chainable builder, returned WITHOUT resolving the
 *                      deferred. `.type()`/`.bytes()` did not resolve it either,
 *                      so a plain object left the request unanswered; where hapi
 *                      did receive such a builder it serialised to `{}`, because
 *                      JSON.stringify drops function-valued properties.
 *
 * Booms are RETURNED, never thrown: the preserved handler catch-all
 * (lib/util/routeParser.js:613-624) rewrites any thrown value to
 * Boom.badImplementation, which would turn a 403 into a 500.
 *
 * Every `reply(...)` call site in this file becomes `legacyReply(..., h)`, and the
 * substitution is deliberately uniform. Two of those sites pass `Boom.forbidden()`
 * where `Boom` is not a binding in this module (see `update` and `deleteFolder`);
 * because the callee here IS bound, the argument is still evaluated first and still
 * throws the identical `ReferenceError: Boom is not defined`. Renaming the second
 * parameter to `h` while leaving `reply(Boom.forbidden())` in place would have
 * thrown "reply is not defined" instead - the same 500 to the client, but a
 * different error in the log.
 */
function legacyReply(value, h) {
  if (value && value.isBoom) {
    return value;
  }

  if (value instanceof Error) {
    return errors.badImplementation(value.message);
  }

  // A non-Error value (a plain object, a string, undefined): the builder was
  // returned WITHOUT settling the deferred, so the outcome depended entirely on
  // what the call site did with that return value. Where the builder was handed on
  // to hapi it serialised to `{}` - 200, `application/json; charset=utf-8`,
  // content-length 2 - because JSON.stringify drops function-valued properties,
  // and `h.response({})` is byte-identical to that. Where the call site discarded
  // it instead, nothing was ever answered, and no return value here can express
  // that, so those branches keep their non-response in place: `create`'s
  // unknown-failure branch resolves nothing at its own site. Every legacyReply
  // call site in this file passes an Error today.
  return h.response({});
}

// The query keys `GET /api/trinkets` declares, each Joi.string().optional()
// [config/api_routes.js:853-861]. The injected request had to satisfy that schema
// before trinket.list ran, and the hand-rolled validation block
// (lib/util/routeParser.js:552-576) rejects an unknown key, a non-string value and
// an empty string alike; on failure it answers through request.fail, whose payload
// carries a validation flash and no `data`. Measured on this route at baseline:
//
//     ?bogus=1                 -> 200 {"data":[]}   ("bogus" is not allowed)
//     ?limit=5&bogus=2         -> 200 {"data":[]}   same
//     ?limit=                  -> 200 {"data":[]}   ("limit" is not allowed to be empty)
//     ?folder=<another id>     -> 200 {"data":[]}   two folder values arrive as an array
//     ?limit=5 / ?sort=name    -> 200 with the folder's trinkets
//     ?user=<id>               -> 200 with data (allowed key; ignored for non-admins)
//
// Extracting the core keeps that gate rather than dropping it, so this route stays
// exactly as strict as the injected request made it.
var INJECTED_QUERY_KEYS = ['limit', 'from', 'sort', 'offset', 'user', 'folder'];

/**
 * Builds the options `listCore` needs for the query-bearing case, or returns null
 * when the injected request could not have reached trinket.list at all.
 *
 * `folder` is appended to whatever the caller already sent, exactly as the injected
 * URL appended it: one occurrence stays a string, a second turns the value into an
 * array, and an array is what fails Joi.string() above.
 */
function injectedTrinketListOptions(query, folder) {
  var merged = {}
    , key, value;

  for (key in query) {
    if (Object.prototype.hasOwnProperty.call(query, key)) {
      merged[key] = query[key];
    }
  }

  merged.folder = merged.folder === undefined
    ? folder.id
    : [].concat(merged.folder, folder.id);

  for (key in merged) {
    if (!Object.prototype.hasOwnProperty.call(merged, key)) {
      continue;
    }

    value = merged[key];

    // unknown key, non-string (an array of repeated values), or empty string
    if (INJECTED_QUERY_KEYS.indexOf(key) < 0 || typeof value !== 'string' || !value.length) {
      return null;
    }
  }

  return {
      sort   : merged.sort
    , folder : merged.folder
    , user   : merged.user
    , from   : merged.from
    , offset : merged.offset
    , limit  : merged.limit
  };
}

module.exports = {
  list : async function(request, h) {
    var getUserId;

    if (request.query.user && request.user.hasRole("admin")) {
      getUserId = function() {
        return User.findById(request.query.user);
      }
    }
    else {
      getUserId = function() { return Promise.resolve(null); };
    }

    // The chain was already returned at baseline and every branch of it produces a
    // value, so it satisfies the lifecycle contract as it stands: its resolved
    // value - the toolkit response from request.success, or the one legacyReply
    // returns for a rejection - becomes this handler's response. A null user falls
    // back to the acting user inside Folder.findByOwner, as before.
    return getUserId()
      .then(function(user) {
        return Folder.findByOwner(user || request.user);
      })
      .then(function(folders) {
        folders.forEach(function(folder) {
          folder.trinketCount = folder.trinkets.length;
        });
        return request.success({
          data : folders
        });
      })
      .catch(function(err) {
        return legacyReply(err, h);
      });
  },
  listView : async function(request, h) {
    return request.success();
  },
  trinkets : async function(request, h) {
    var folder = request.pre.folder;

    // PRESERVED BASELINE BEHAVIOUR - the queryless case must keep returning no data.
    //
    // Baseline built the injected URL as
    //     '/api/trinkets' + request.url.search + '&folder=' + folder.id
    // and that '&' is only a separator when `search` has already supplied the '?'.
    // request.url is a WHATWG URL, so `search` is '' when no query string is sent
    // and the URL becomes '/api/trinkets&folder=<id>' - one PATH, no query at all.
    // Measured against a folder holding a matching owned trinket:
    //
    //   * no query string: the path misses `GET /api/trinkets` entirely and is
    //     served by the Inert catch-all `GET /{path*}` (proven from the injected
    //     404's stack: @hapi/inert/lib/fs.js:38 through directory.js:164). The
    //     result has no `data`, so the route answered 200 {"data":[]} and
    //     trinket.list was NEVER invoked - the nested handler log line is absent.
    //   * with a query string: the URL is well formed, the API route matched, and
    //     the folder filter applied - 200 with the folder's trinkets.
    //
    // So the folder is passed to the core ONLY for the query-bearing case. Passing
    // it in both would hand the queryless request real data for the first time,
    // which is a behaviour change and is prohibited. It also cannot be papered over
    // by calling the core without a folder: there is no unfiltered mode, and
    // omitting the folder selects the trinkets that are in NO folder, so a folder
    // page would list the user's unfiled trinkets instead.
    var listOptions = request.url.search
      ? injectedTrinketListOptions(request.query, folder)
      : null;
    var trinkets;

    // The try is baseline's own and still guards request.success itself. The
    // catch-per-call below is what preserves the injected route's error behaviour.
    try {
      if (listOptions) {
        try {
          trinkets = await trinketController.listCore(listOptions, request.user);
        }
        catch (err) {
          // server.inject RESOLVES with an error response instead of throwing, so a
          // failure inside trinket.list never reached this handler at baseline: it
          // became a response whose payload carries no `data`, and this route still
          // answered 200 {"data":[]}. Leaving `trinkets` undefined keeps that exact
          // outcome. It is logged because the injected request used to be reported
          // by the framework's own error handling, which the extraction removes;
          // the response is unchanged either way.
          console.error('Failed to list folder trinkets:', err.message);
        }
      }

      // This route's own reply projection is applied here - 14 fields
      // [config/api_routes.js:660-677]. Baseline projected twice, first through
      // `GET /api/trinkets`' 16-field spec and then through this one; this set is a
      // strict subset of that one, so the single projection is identical. Measured:
      // the query-bearing response carries the same fields as before, with no
      // `username` and no `slug`. `data` stays undefined for the no-data cases,
      // which the array spec renders as [] exactly as the injected 404 did.
      return request.success({
        data : trinkets
      });
    } catch (err) {
      return legacyReply(err, h);
    }
  },
  create : async function(request, h) {
    var folder = new Folder(request.payload);
    folder.setOwner(request.user);
    folder.ownerSlug = request.user.username;

    // The save keeps its callback, and the promise boundary is created here at the
    // lifecycle method (rule T-3) - the same shape `admin.updateUser` and
    // `users.sendPassReset` use. That is what preserves WHICH branch answers: at
    // baseline only the grant chain's fulfilled path settled the deferred response,
    // so only that path resolves this promise. The lifecycle contract (T-1) is met
    // by returning a promise, and a promise that stays pending is still a returned
    // promise, so the branches that produced no response keep producing none rather
    // than being mapped onto a status.
    return await new Promise(function(resolve) {
      folder.save(function(err, savedFolder) {
        if (err) {
          if (err.code === 11000) {
            // PRESERVED BASELINE BEHAVIOUR - do NOT "correct" this to request.fail,
            // and do NOT lift it out of this callback.
            //
            // `request.catch` is not defined anywhere in this application: the
            // request decorations are request.success and request.fail
            // (lib/util/routeParser.js:303 and :368), nothing assigns a `catch`
            // member, and hapi's Request has none. This file holds the only two
            // references to it. So the call throws `TypeError: request.catch is not
            // a function` and the friendly duplicate-name message below is dead text.
            //
            // Measured at baseline, that identical error produced two different
            // outcomes purely because of the frame it was thrown in:
            //   * here, inside the `folder.save(callback)` callback. Mongoose wraps
            //     a save callback in `Model.$handleCallbackError`
            //     (node_modules/mongoose/lib/model.js:5402-5419, applied at :524),
            //     which catches whatever the callback throws and re-emits it as an
            //     'error' event on the model. Nothing registers an 'error' listener
            //     on it, so Node's EventEmitter rethrows ("Unhandled 'error'
            //     event"), and nothing in app.js, lib/ or config/ listens for
            //     'uncaughtException' either - so the throw terminated the process:
            //     a duplicate folder name took the whole server down and the client
            //     got no response at all. Confirmed against the running server:
            //     `POST /api/folders` with a name that already exists returns no
            //     response (curl exit 52) and the process exits with
            //     `TypeError: request.catch is not a function` raised from this line
            //     through mongoose/lib/model.js:5414.
            //   * in `update` below, the same call sits inside a RETURNED promise
            //     chain, so it rejects there and the route catch-all answers 500.
            // Keeping the call in this frame keeps the first outcome - the throw
            // leaves through mongoose, this promise is never settled - and keeps the
            // two sites as different as baseline measured them.
            return request.catch({
                err     : err
              , message : "You already have a folder with this name. Please choose another."
            });
          }

          // unknown failure
          //
          // PRESERVED MEASURED NON-RESPONSE. Baseline handed this plain object to
          // the legacy `reply()`, which returned its chainable builder WITHOUT
          // settling the deferred, and the save callback discarded that return
          // value - so the request was never answered. Resolving nothing here
          // reproduces that exactly: the promise above stays pending and the
          // request hangs as it did. The value is deliberately not converted to a
          // Boom and no status is invented; the only approved deviation in
          // lib/controllers is the files.js image stream (AAP 0.7, decided on
          // grounds specific to that function), and it does not reach this branch.
          return;
        }

        // The grant chain stays DETACHED, as it was at baseline: it was returned
        // into the discarded save callback, so only its fulfilled path settled the
        // deferred and a rejection became an unhandled rejection with the request
        // left unanswered. Awaiting it, or attaching a `.catch`, would route a
        // failed grant to the handler catch-all as a 500 - a new outcome, which is
        // prohibited. The saved document is used for the response exactly as the
        // callback parameter that shadowed `folder` was.
        return request.user.grant("folder-owner", "folder", { id : savedFolder.id })
          .then(function() {
            savedFolder._owner = savedFolder._owner.id;
            resolve(request.success({
                success : true
              , folder  : savedFolder
            }));
          });
      });
    });
  },
  update : async function(request, h) {
    var folder = request.pre.folder
      , updatedFolder;

    if (request.user.hasPermission("update-folder-details", "folder", { id : folder.id })) {
      folder.set(request.payload);
      // Already a returned chain whose every branch produces a value, so it is left
      // as one; there is no callback boundary here to move.
      return folder.save()
        .then(function(result) {
          updatedFolder = result;

          // Update trinkets with new folder info (fire-and-forget)
          //
          // Deliberately NOT awaited: the response must not wait for these writes,
          // and a failure in one logs and is dropped rather than failing the
          // request. Measured at baseline, the response returns first and the
          // trinket metadata lands shortly after; both are preserved.
          if (updatedFolder.trinkets && updatedFolder.trinkets.length) {
            updatedFolder.trinkets.forEach(function(folderTrinket) {
              Trinket.findById(folderTrinket.trinketId)
                .then(function(trinket) {
                  if (trinket && trinket.folder) {
                    trinket.folder.name       = updatedFolder.name;
                    trinket.folder.folderSlug = updatedFolder.slug;
                    return trinket.save();
                  }
                })
                .catch(function(err) {
                  console.error('Failed to update trinket folder info:', err.message);
                });
            });
          }

          return request.success({
              success : true
            , folder  : updatedFolder
          });
        })
        .catch(function(err) {
          if (err.code === 11000) {
            // PRESERVED BASELINE BEHAVIOUR - see the note in `create` for why
            // `request.catch` does not exist. Here it throws TypeError inside a
            // RETURNED promise chain, so the chain rejects and the route catch-all
            // answers 500 - which is exactly what baseline measured at this site.
            // `create`'s copy sits in a discarded callback instead and therefore
            // keeps its own, different outcome; the two are not interchangeable.
            return request.catch({
                success : false
              , message : "You already have a folder with this name. Please choose another."
            });
          }

          // unknown error
          return legacyReply(err, h);
        });
    }
    else {
      // PRESERVED BASELINE BEHAVIOUR - reachable for a user who owns the folder but
      // was never granted the folder-owner role; a non-owner is stopped earlier by
      // the canEdit pre-handler with a 403. `Boom` is not a binding in this module
      // (@hapi/boom is bound as `errors` above), so evaluating the argument throws
      // `ReferenceError: Boom is not defined` and the catch-all answers 500 -
      // measured, with the cache headers that Layer 3 applies to /api/ paths.
      // Binding Boom, or switching to errors.forbidden(), would turn this edge into
      // a 403: a behaviour change, an error-mapping change, and out of scope.
      return legacyReply(Boom.forbidden(), h);
    }
  },
  deleteFolder : async function(request, h) {
    var folder = request.pre.folder;

    if (request.user.hasRole("folder-owner", "folder", { id : folder.id })) {
      return folder.deleteFolder()
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
      // PRESERVED BASELINE BEHAVIOUR, identical mechanism to `update` above: the
      // unbound `Boom` makes this branch throw and the route answers 500, not 403.
      return legacyReply(Boom.forbidden(), h);
    }
  }
};
