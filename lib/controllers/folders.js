var errors       = require('@hapi/boom')
  , config       = require('config')
  , Trinket      = require('../models/trinket')
  , _            = require('underscore');

// `GET /api/trinkets`' listing logic, exported from lib/controllers/trinket.js
// as a plain async function. `trinkets` below calls it directly: re-entering
// that route with `server.inject` would put a deprecated URL parse, and the
// warning it emits, on the live request path.
//
// The module is captured rather than the member, so `listCore` is resolved at
// call time: trinket.js does not require this file, so there is no cycle, and
// reading the member late keeps one appearing later from leaving a stale
// binding here.
var trinketController = require('./trinket');

/**
 * The error-to-response mapping the branches of this file that call it answer
 * through. It maps a value; it does not log, and nothing it returns passes
 * through the route catch-all, because a returned value is not a thrown one.
 *
 *   * a Boom        -> the Boom itself, so its own status is served (403/404/...)
 *   * any Error     -> Boom.badImplementation(message): 500 carrying hapi's generic
 *                      "An internal server error occurred" payload. The message
 *                      stays on the returned Boom as internal detail and never
 *                      reaches the client.
 *   * anything else -> an empty JSON object: 200,
 *                      `application/json; charset=utf-8`, content-length 2.
 *
 * Booms are RETURNED by the callers, never thrown: the route catch-all rewrites
 * any thrown value to Boom.badImplementation, which would turn a 403 into a 500.
 *
 * Not every non-success branch of this file arrives here. Two call sites pass
 * `Boom.forbidden()`, and `Boom` is not a binding in this module -- @hapi/boom is
 * bound as `errors` above -- so, the argument being evaluated before this
 * function is entered, those two throw `ReferenceError: Boom is not defined` and
 * never reach the mapping; `update` and `deleteFolder` record what each answers.
 * `create`'s unknown-failure branch answers nothing at its own site, because no
 * return value from here can express the absence of a response.
 *
 * @param {*} value - the value to map onto a response
 * @param {Object} h - the hapi response toolkit
 * @returns {Object} a Boom, whose own status is served, or a toolkit response
 */
function legacyReply(value, h) {
  if (value && value.isBoom) {
    return value;
  }

  if (value instanceof Error) {
    return errors.badImplementation(value.message);
  }

  // A non-Error value (a plain object, a string, undefined) answers an empty
  // JSON object. No call site in this file reaches this branch: every one passes
  // an Error, and the branch that answers nothing at all -- `create`'s
  // unknown-failure case -- does that at its own site rather than by calling
  // here, because no return value from here can express a non-response.
  return h.response({});
}

// The six query keys `GET /api/trinkets` declares, each Joi.string().optional().
// `injectedTrinketListOptions` below is the gate that holds this route to that
// same schema: an unknown key, a non-string value (which is what a repeated
// query parameter arrives as) and an empty string are each rejected, and a
// rejection means `trinkets` lists nothing rather than listing unfiltered.
// `user` is accepted here and takes effect downstream only for a caller holding
// the admin role.
var INJECTED_QUERY_KEYS = ['limit', 'from', 'sort', 'offset', 'user', 'folder'];

/**
 * Builds the options `listCore` needs, or returns null when the query does not
 * satisfy the key set above.
 *
 * The folder id is appended to whatever the caller already sent: with no
 * `folder` in the query the value stays a string, and with one already present
 * it becomes an array, which the string-only rule above then rejects. So a
 * caller cannot select a second folder through the query.
 *
 * @param {Object} query - the request's own parsed query
 * @param {Object} folder - the folder the `folder(params.folderId)` pre resolved
 * @returns {?Object} the six list options, or null when the query is rejected
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

    // The chain is returned and every branch of it produces a value -- the
    // toolkit response from request.success, or legacyReply's for a rejection --
    // so the resolved value is this handler's response. A null user, which is
    // what a non-admin caller always gets, falls back to the acting user at the
    // findByOwner call.
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

    // The folder filter reaches the listing ONLY for a request that carries a
    // query string. `request.url` is a WHATWG URL, so `search` is '' when no
    // query string is sent, and this route then intentionally answers 200 with
    // an empty `data` instead of the folder's contents.
    //
    // The two cases are not equivalent. Passing the folder for the queryless
    // case would give that request a filtered listing it does not currently
    // have; calling `listCore` with no folder at all differs again, because
    // there is no unfiltered mode -- omitting the folder narrows the query to
    // the trinkets that are in NO folder, so a folder page would then list the
    // user's unfiled trinkets.
    var listOptions = request.url.search
      ? injectedTrinketListOptions(request.query, folder)
      : null;
    var trinkets;

    // The outer try guards `request.success` itself; the inner catch keeps a
    // listing failure away from it.
    try {
      if (listOptions) {
        try {
          trinkets = await trinketController.listCore(listOptions, request.user);
        }
        catch (err) {
          // A listing failure is logged and intentionally swallowed rather than
          // rethrown: `trinkets` stays undefined and the route still answers 200
          // with an empty `data`, which is the same response the queryless case
          // gets. Rethrowing would answer 500 instead.
          console.error('Failed to list folder trinkets:', err.message);
        }
      }

      // request.success applies this route's own 14-field reply projection, so
      // the response carries neither `username` nor `slug` even though
      // `listCore` puts both on every document. An undefined `data` renders as
      // [] under the array spec, which is what the two no-data cases answer.
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
    // so only that path resolves this promise, and the duplicate-name branch rejects
    // it (see below). The lifecycle contract (T-1) is met by returning a promise, and
    // a promise that stays pending is still a returned promise, so the unknown-failure
    // branch keeps producing no response rather than being mapped onto a status.
    return await new Promise(function(resolve, reject) {
      folder.save(function(err, savedFolder) {
        if (err) {
          if (err.code === 11000) {
            // APPROVED DEVIATION - the duplicate settles the request here instead of
            // throwing out of the save callback.
            //
            // `request.catch` is not a decoration this application defines
            // (lib/util/routeParser.js decorates request.success at :311 and
            // request.fail at :376, and hapi's Request carries no `catch` member), so
            // calling it inside `folder.save(callback)` throws a TypeError that
            // Mongoose's Model.$handleCallbackError re-emits as an unlistened 'error'
            // event on the model; with no 'uncaughtException' handler in app.js, lib/
            // or config/, that throw terminates the process - one authenticated
            // duplicate name takes the whole server down and the client is answered
            // with nothing. No route serves after termination, so R-b's requirement
            // that the application run with no route excluded makes that outcome
            // impossible to preserve and R-b controls. This is the conflict AAP 0.7
            // already decides for the never-settling stream at
            // lib/controllers/files.js:98-100, on the same grounds: an absent response
            // is not behaviour a client can depend on, and the intended response is
            // present in this same function. Rejecting reaches the preserved handler
            // catch-all (lib/util/routeParser.js:468-479), which logs the error and
            // returns Boom.badImplementation - the same 500 with hapi's generic
            // payload that this identical call produces in `update` below, which is
            // why the target is that logged 500 rather than a 409 carrying the
            // friendly message to an unchanged client. The message interpolates no
            // payload or key value, so the folder name and owner stay out of the log.
            return reject(new Error('Folder create failed: duplicate name for this owner'));
          }

          // unknown failure
          //
          // Nothing is resolved and nothing is thrown, so the promise this
          // handler returned stays pending and the request is intentionally left
          // unanswered. No status is invented for this branch and the error is
          // deliberately not converted to a Boom.
          return;
        }

        // The grant chain is DETACHED on purpose: its fulfilled path is the only
        // one that answers this request, and a rejection becomes an unhandled
        // rejection with the request left unanswered. Attaching a `.catch` here,
        // or awaiting the chain from the handler, would answer 500 for a failed
        // grant instead. The response is built from the saved document the
        // callback hands back, not from the `folder` above.
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
      // A returned chain whose every branch produces a value, so its resolved
      // value is this handler's response. `folder.save()` is used in its promise
      // form here, so there is no callback boundary to bridge.
      return folder.save()
        .then(function(result) {
          updatedFolder = result;

          // Update trinkets with new folder info (fire-and-forget)
          //
          // Deliberately NOT awaited: the response below is built and returned
          // without waiting for these writes, so the denormalized folder name on
          // each trinket lands after the client has been answered. A failure in
          // one is logged and dropped rather than failing the request.
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
            // `request.catch` is not a member of the request, so this expression
            // throws a TypeError and the friendly message below is dead text.
            // Here the throw happens inside a RETURNED promise chain, so the
            // chain rejects and the route catch-all answers 500; the same
            // expression in `create` sits in a save callback and takes the
            // process down instead.
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
      // Reached by a user who owns the folder but was never granted the
      // folder-owner role; a non-owner is stopped before the handler by the
      // `canEdit` pre-handler with a 403. `Boom` is not a binding in this module
      // (@hapi/boom is bound as `errors`), so evaluating the argument throws
      // `ReferenceError: Boom is not defined` and this branch intentionally
      // answers 500 through the route catch-all rather than 403. Binding Boom or
      // calling errors.forbidden() would change that status.
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
      // Same unbound `Boom` as in `update`: evaluating the argument throws a
      // ReferenceError, so this branch intentionally answers 500, not 403.
      return legacyReply(Boom.forbidden(), h);
    }
  }
};
