var errors       = require('@hapi/boom')
  , config       = require('config')
  , Pending      = require('../http/pending')
  , Trinket      = require('../models/trinket')
  , _            = require('underscore');

// `Boom` is declared nowhere in this file - line 1 binds @hapi/boom as `errors`, which is
// never used - so the two `Boom.forbidden()` sites below raise `ReferenceError: Boom is not
// defined` and reach the centralized error map as a scrubbed HTTP 500. The permission and
// ownership denials in `update` and `deleteFolder` have never answered 403. Keep the bare
// identifiers: adding a require, or routing them through the `errors` binding, would change
// the error mapping.
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

    return getUserId()
      .then(function(user) {
        return Folder.findByOwner(user || request.user);
      })
      .then(function(folders) {
        folders.forEach(function(folder) {
          folder.trinketCount = folder.trinkets.length;
        });
        return h.respond({
          data : folders
        });
      })
      .catch(function(err) {
        throw err;
      });
  },
  listView : async function(request, h) {
    return h.respond();
  },
  trinkets : async function(request, h) {
    var folder = request.pre.folder;
    var url = '/api/trinkets' + request.url.search + '&folder=' + folder.id;

    try {
      var response = await request.server.inject({
        url     : url,
        method  : 'get',
        headers : {
          'content-type' : 'application/json',
          'accept'       : 'application/json'
        },
        auth    : {
          strategy    : 'session',
          credentials : request.auth.credentials
        }
      });

      // `response.result.data` is deliberately UNGUARDED. If the injected route resolves to
      // anything without a `data` key this raises a TypeError, which the catch below turns into
      // the same 500 the baseline produced. Adding an `if (response.result)` guard would invent a
      // success response the base commit never sent. See docs/PRESERVED-QUIRKS.md.
      return h.respond({
        data : response.result.data
      });
    } catch (err) {
      // PARITY PROVEN, not merely asserted - and this handler is deliberately NOT a pending
      // site, unlike `create` below. The base commit was ALREADY `async (request, reply)` here
      // and it RETURNED a defined value on both paths, which made the retired shim's deferred
      // capture irrelevant: its wrapper only fell back to the deferral when the handler frame
      // resolved `undefined` (`if (result === undefined) result = await responsePromise;`).
      // On this path the base wrote `return reply(err)`, and for an `err instanceof Error` the
      // synthetic reply returned `Boom.badImplementation(err.message)` - a defined value - so
      // the base answered a scrubbed 500 directly. `throw err` reaches lib/http/errorMap.js and
      // answers the identical scrubbed 500, measured over real HTTP on @hapi/hapi 21.4.10.
      throw err;
    }
  },
  create : async function(request, h) {
    var folder = new Folder(request.payload);
    folder.setOwner(request.user);
    folder.ownerSlug = request.user.username;

    var saved;
    try {
      saved = await folder.save();
    }
    catch (err) {
      if (err.code === 11000) {
        // PRESERVED QUIRK - see docs/PRESERVED-QUIRKS.md section 1.15.
        // `request.catch` has NEVER existed: the shim decorated the request with `success` and
        // `fail` only, and lib/http/responseContract.js deliberately exports no third responder.
        // This line therefore raises `TypeError: request.catch is not a function`, and the
        // TypeError IS the behaviour, so the call site is kept VERBATIM below.
        // R-6 ADJUDICATION, MEASURED over real HTTP on @hapi/hapi 20.3.0 against a verbatim replica
        // of the base-commit wrapper: the TypeError escaped from an unowned Mongoose save callback,
        // so the request received NO RESPONSE AT ALL. That wire outcome is reproducible and is
        // reproduced - the raise still happens here, and its measured effect is answered with a
        // response that never settles. The second, process-level half - nothing in app.js, config/
        // or lib/ installs an uncaughtException handler, so the escaping TypeError killed the
        // process - is deliberately NOT reproduced: deliberately crashing the process would be a
        // new behaviour rather than a preserved one, and no client can depend on it.
        // Changing this to h.reject, or adding a `catch` responder, would answer 200 with a
        // failure flash - a response no baseline request ever produced. Letting the TypeError reach
        // the centralized error map would answer 500 - likewise never produced.
        try {
          return request.catch({
              err     : err
            , message : "You already have a folder with this name. Please choose another."
          });
        }
        catch (noSuchResponder) {
          return Pending.forever();
        }
      }

      // unknown failure
      // PRESERVED QUIRK - see docs/PRESERVED-QUIRKS.md section 1.15. The deleted synthetic responder
      // built its response and then returned a CHAINABLE BUILDER; only `redirect()`, `code()`,
      // `header()` and `view()` settled the deferred capture, while `type()` and `bytes()` handed the
      // builder back - and this site called no terminator at all. The builder was therefore returned
      // into a Mongoose save callback that discarded it, and the capture was never settled.
      // R-6 ADJUDICATION, MEASURED: this branch answered NOTHING at the base commit. It is NOT a
      // 200 `{}` - that shape only appears when the builder itself is returned all the way to hapi,
      // which no branch in this file does - and it is NOT a 500. It is reproduced as measured.
      return Pending.forever();
    }

    await request.user.grant("folder-owner", "folder", { id : saved.id });
    saved._owner = saved._owner.id;
    return h.respond({
        success : true
      , folder  : saved
    });
  },
  update : async function(request, h) {
    var folder = request.pre.folder
      , updatedFolder;

    if (request.user.hasPermission("update-folder-details", "folder", { id : folder.id })) {
      folder.set(request.payload);
      return folder.save()
        .then(function(result) {
          updatedFolder = result;

          // Update trinkets with new folder info (fire-and-forget)
          // This loop is deliberately not awaited and its promises deliberately not collected: the
          // response below goes out without waiting for the trinket updates, and a failing trinket
          // save only reaches the error log. Joining them would delay the response and let a
          // trinket failure change it.
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

          return h.respond({
              success : true
            , folder  : updatedFolder
          });
        })
        .catch(function(err) {
          if (err.code === 11000) {
            // The same non-existent `request.catch` as in `create`, kept verbatim including the
            // `success : false` lead. Raised inside a returned `.catch` callback it becomes a
            // rejection and answers HTTP 500. See docs/PRESERVED-QUIRKS.md section 3.23.
            return request.catch({
                success : false
              , message : "You already have a folder with this name. Please choose another."
            });
          }

          // unknown error
          throw err;
        });
    }
    else {
      throw Boom.forbidden();
    }
  },
  deleteFolder : async function(request, h) {
    var folder = request.pre.folder;

    if (request.user.hasRole("folder-owner", "folder", { id : folder.id })) {
      return folder.deleteFolder()
        .then(function() {
          return h.respond({
            success : true
          });
        })
        .catch(function(err) {
          throw err;
        });
    }
    else {
      throw Boom.forbidden();
    }
  }
};
