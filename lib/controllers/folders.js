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
 * `create`'s duplicate-name branch does not arrive here either: it rejects, so the
 * route catch-all in lib/util/routeParser.js maps it -- the same Layer-1 funnel
 * (AAP 0.6.3) that the identical collision on the rename route reaches, and the
 * same 500. Its unknown-failure branch DOES arrive here, from inside a save
 * callback, and takes the Error mapping above.
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
  // an Error -- a rejected chain's reason, or the `err` a save callback was
  // handed -- so this is the mapping's total case rather than a live path, and it
  // keeps the function total so no caller can be handed `undefined` to return.
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
    // The name is taken from the payload VERBATIM: nothing on this path trims,
    // collapses or otherwise normalizes it, and neither does the declared schema
    // (config/api_routes.js, `POST /api/folders`, which carries the full record).
    // So a whitespace-only name that satisfied `min(1)` is stored as submitted
    // and the document that results renders as a nameless folder card under a
    // random slug, the slug being random because the name transliterates to an
    // empty string. Measured identical on baseline 2f8712a; preserved under AAP
    // rule R-d, which is also why no trim is introduced here rather than in the
    // schema -- normalizing the value would change what is persisted and
    // rendered, which is the same behaviour change by a different route.
    var folder = new Folder(request.payload);
    folder.setOwner(request.user);
    folder.ownerSlug = request.user.username;

    // The save keeps its callback, and the promise boundary is created here at the
    // lifecycle method (rule T-3) - the same shape `admin.updateUser` and
    // `users.sendPassReset` use. That is what preserves WHICH branch answers: at
    // baseline only the grant chain's fulfilled path settled the deferred response,
    // so only that path resolves this promise with a success projection. The two
    // failure branches below settle it too - one by rejecting into the route
    // catch-all, one by resolving the Boom its own comment records - so every path
    // the save callback itself takes now answers the request. A promise that stays
    // pending is still a returned promise under T-1, but it answers nothing, and R-b
    // does not permit a route that never serves. The one path that still does not
    // settle is the DETACHED grant chain's rejection, which is baseline's own
    // behaviour and is recorded where it happens below.
    //
    // `reject` exists for exactly one branch, the duplicate name: rejecting is what
    // carries that error out of the save callback - which is not on the handler's
    // own stack, so a throw there would escape the lifecycle entirely - and into the
    // handler catch-all this `await` re-raises it to. Its own comment carries the
    // argument.
    return await new Promise(function(resolve, reject) {
      folder.save(function(err, savedFolder) {
        if (err) {
          if (err.code === 11000) {
            // A duplicate name for the same owner - the `_owner_1_slug_1` unique
            // index this model declares - is REJECTED into the route catch-all,
            // which answers 500.
            //
            // Baseline cannot be preserved, and what it does is worth stating
            // exactly. At 2f8712a this branch calls `request.catch({err, message})`,
            // and `catch` is not a decoration this application defines -
            // lib/util/routeParser.js installs request.success and request.fail, and
            // hapi's Request carries no `catch` member - so the call throws a
            // TypeError from inside `folder.save(callback)`. Mongoose's
            // Model.$handleCallbackError re-emits that as an unlistened 'error'
            // event on the model, and with no 'uncaughtException' handler in app.js,
            // lib/ or config/, the process TERMINATES. MEASURED on a baseline
            // worktree at 2f8712a: a second `POST /api/folders` with the same name
            // answers `curl` exit 52 with an EMPTY REPLY, the server's stderr carries
            // `TypeError: request.catch is not a function at
            // lib/controllers/folders.js:71` under `throw er; // Unhandled 'error'
            // event`, and a following `GET /` cannot connect. One authenticated
            // duplicate name takes the whole server down and no route serves
            // afterwards. AAP R-b requires the application to run with no route
            // excluded, so R-b controls over R-d here, on the precedence AAP 0.7
            // sets for the never-settling stream at lib/controllers/files.js:98-100:
            // an absent response is not behaviour a client can depend on.
            //
            // WHY THE ROUTE CATCH-ALL AND NOT A LOCAL STATUS. R-b decides only that
            // the request must be answered; it does not license a new status class,
            // and R-d and R-e keep the choice as close to the code's own intent as
            // possible. Three things settle it on 500:
            //
            //   * the funnel is the one the surrounding code already reaches. The
            //     IDENTICAL dead `request.catch` expression sits in `update` below,
            //     inside a RETURNED promise chain, where its TypeError rejects the
            //     chain and the catch-all answers 500 - MEASURED on both trees, a
            //     colliding `PUT /api/folders/{folderId}/name` answers 500. Both
            //     duplicate paths in this file therefore answer alike, which is what
            //     baseline's author wrote even though only one of the two survived to
            //     be observed;
            //   * AAP 0.6.3 names that catch-all (lib/util/routeParser.js:578-589 ->
            //     `Boom.badImplementation(err.message || String(err))`) as Layer 1 of
            //     the error-to-response inventory R-e requires to survive unchanged,
            //     so routing an unhandleable write failure into it introduces no
            //     mapping this application did not already have; and
            //   * a 409 with the message baseline's dead argument composes would be a
            //     status and a body no version of this application has ever served,
            //     which is a behaviour improvement R-d prohibits and which AAP 0.7's
            //     register does not authorize - it grants exactly two deviations.
            //
            // Delivered contract: HTTP 500, `application/json; charset=utf-8`, hapi's
            // generic payload {"statusCode":500,"error":"Internal Server Error",
            // "message":"An internal server error occurred"}, the PROCESS ALIVE, and
            // exactly one folder document persisted. The driving error's own message
            // stays on the Boom the catch-all builds and is logged there, so the
            // folder name and the index key never reach the client.
            //
            // REJECTED rather than thrown: this callback is not on the handler's own
            // stack, so a throw here would leave the promise pending and surface as
            // an uncaught exception with the request unanswered - the very outcome
            // being closed. Rejecting settles the promise this handler awaits, the
            // `await` re-raises inside the handler, and the catch-all sees it there.
            return reject(err);
          }

          // Unknown write failure - any save error whose `code` is not 11000.
          //
          // It is ANSWERED here, through this file's own error mapping, which
          // maps a non-Boom Error to Boom.badImplementation(err.message).
          // Delivered contract: HTTP 500 with hapi's generic payload
          // {"statusCode":500,"error":"Internal Server Error","message":"An
          // internal server error occurred"}, the request answered rather than
          // hung, and the driving error's own message retained on the returned
          // Boom as internal detail that never reaches the client.
          //
          // This is a DEVIATION from baseline, and the register entry that
          // approves it is the second clause of docs/preserved-quirks.md §11.10.
          // It is NOT a newly introduced regression, which is worth stating
          // because the shape invites that reading: baseline never answered here
          // either. At 2f8712a this branch is `return reply({err, message})`, and
          // that `reply` is the response-emulation shim's fake reply
          // (2f8712a lib/util/routeParser.js:360-408). For a plain object - not a
          // Boom, not an Error - it only builds a chainable builder, and the
          // deferred response is resolved solely from `.redirect()`, `.code()`,
          // `.header()` and `.view()`. Baseline's branch calls none of those and
          // baseline's handler returns nothing, so the wrapper's
          // `if (result === undefined) { result = await responsePromise; }`
          // (2f8712a lib/util/routeParser.js:568-569) awaited a promise no path
          // settled: the request was never answered and the socket was held open.
          //
          // So preserving the outcome is again impossible under R-b ("every route
          // serves") and T-1 ("any function hapi invokes returns its response
          // value, returns a promise of one, or throws"): a pending promise is a
          // returned promise, but it is not a response. R-b and T-1 control over
          // R-d for the reason AAP 0.7 gives at lib/controllers/files.js:98-100 -
          // an absent response is not behaviour a client can depend on - and 500
          // is the honest classification of an unidentified write failure, so
          // nothing is invented beyond answering at all.
          //
          // Resolved rather than thrown, for the same reason as the branch above:
          // a returned Boom is served as itself. A throw from inside this save
          // callback would not reach the route catch-all at all - the callback is
          // not on the handler's own stack - so it would surface as an uncaught
          // exception with the request still unanswered, which is precisely the
          // outcome being fixed.
          return resolve(legacyReply(err, h));
        }

        // The grant chain is DETACHED on purpose: its fulfilled path is the only
        // path OF THIS CHAIN that answers this request, and a rejection becomes
        // an unhandled rejection with the request left unanswered - the one
        // remaining path in this handler that does not answer, and one whose
        // outcome is baseline's own. Attaching a `.catch` here,
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
            // PRESERVED: `request.catch` is not a member of the request, so this
            // expression throws a TypeError and the friendly message below is
            // dead text. Here the throw happens inside a RETURNED promise chain,
            // so the chain rejects, the route catch-all answers 500, the request
            // IS answered and the process stays alive - which is exactly what
            // baseline does, so R-d and R-e keep it as it is.
            //
            // `create`'s duplicate branch could not be kept AS WRITTEN: the
            // identical expression there sits inside a save CALLBACK, where the
            // same TypeError took the process down instead of answering. It now
            // rejects into this same route catch-all, so BOTH duplicate paths in
            // this file answer 500 with hapi's generic payload and the process
            // survives either one - the difference between them is the mechanism
            // that carries the error out, never the response.
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
      // PRESERVED, deliberately: see docs/preserved-quirks.md §9.13, which is the
      // register entry for this branch and for the identical one in
      // `deleteFolder` below.
      //
      // Reached by a user who owns the folder but was never granted the
      // folder-owner role; a non-owner is stopped before the handler by this
      // route's own `canEdit(pre.folder,user)` pre-handler
      // (config/api_routes.js:691-705) with a 403, which is why the rename route
      // answers 403 for a cross-owner caller and `deleteFolder` - whose only pre
      // is `folder(params.folderId)` - does not.
      //
      // `Boom` is not a binding in this module (@hapi/boom is bound as `errors`
      // at :1), so evaluating the ARGUMENT throws `ReferenceError: Boom is not
      // defined` before `legacyReply` is entered and before any response is
      // built. The throw reaches the route catch-all
      // (lib/util/routeParser.js:554-564), which logs it and answers 500 with
      // hapi's generic payload. The request IS answered and the process stays
      // alive, so this is a status class that misreports a denial, not an
      // authorization hole: the update never runs and nothing is written.
      //
      // Baseline at 2f8712a does exactly the same thing - `return
      // reply(Boom.forbidden())`, the same unbound identifier, the same
      // ReferenceError, the same 500 - so preservation is fully possible here
      // and no requirement other than R-d is engaged. R-d ("behaviour
      // improvements PROHIBITED") and R-e ("same status codes") therefore
      // control, and the register governs the identical construct in
      // `courses.download` at §9.7 with the same disposition. Binding `Boom`,
      // calling `errors.forbidden()` or reordering these arguments would change
      // the status and is not permitted without a register deviation.
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
      // PRESERVED, deliberately: docs/preserved-quirks.md §9.13 is the register
      // entry for this branch and for `update`'s above.
      //
      // Same unbound `Boom` as in `update`: @hapi/boom is bound as `errors` at
      // :1, so evaluating the ARGUMENT throws `ReferenceError: Boom is not
      // defined` before `legacyReply` is entered, the route catch-all
      // (lib/util/routeParser.js:554-564) logs it, and this branch answers 500
      // with hapi's generic payload rather than 403.
      //
      // This route reaches the branch for a CROSS-OWNER caller, where `update`
      // does not: `DELETE /api/folders/{folderId}` declares only
      // `folder(params.folderId)` as a pre (config/api_routes.js:705-712), while
      // the rename route also declares `canEdit(pre.folder,user)`
      // (config/api_routes.js:691-705) and so is refused with a 403 before its
      // handler runs. MEASURED on this tree: a non-owner DELETE answers 500 and
      // a non-owner PUT .../name answers 403.
      //
      // The denial itself HOLDS - `folder.deleteFolder()` is never called and the
      // folder is still listed for its owner afterwards - so what is wrong is the
      // status class, not the authorization. Baseline at 2f8712a answers the same
      // 500 by the same mechanism with the process alive and the request
      // answered, so preservation is possible, nothing but R-d is engaged, and
      // R-d plus R-e ("same status codes") control; §9.7 records the same
      // disposition for the identical construct in `courses.download`. Do not
      // bind `Boom` and do not substitute `errors.forbidden()`: either would
      // change a preserved status.
      return legacyReply(Boom.forbidden(), h);
    }
  }
};
