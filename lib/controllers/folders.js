var errors       = require('@hapi/boom')
  , config       = require('config')
  , Trinket      = require('../models/trinket')
  , _            = require('underscore');

module.exports = {
  list : function(request, h) {
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
        return request.success({
          data : folders
        });
      })
      .catch(function(err) {
        // hapi API migration. The deleted synthetic responder tested `data instanceof Error`
        // and answered Boom.badImplementation - a 500 whose message hapi scrubs. Measured over
        // real HTTP on @hapi/hapi 21.4.10: a thrown and a returned plain Error produce the
        // identical scrubbed 500, so `throw err;` is mapping-neutral here. See
        // docs/PRESERVED-QUIRKS.md. Nothing reaching this catch can be a Boom - Mongoose rejects
        // with plain Errors and request.success only ever throws ObjectUtils.pull's plain Error -
        // so the isBoom pass-through the responder also had is unreachable and cannot regress.
        throw err;
      });
  },
  listView : function(request, h) {
    return request.success();
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
      return request.success({
        data : response.result.data
      });
    } catch (err) {
      // hapi API migration - see the note in `list`. Wire-identical scrubbed 500.
      throw err;
    }
  },
  create : async function(request, h) {
    var folder = new Folder(request.payload);
    folder.setOwner(request.user);
    folder.ownerSlug = request.user.username;

    // async conversion. The base commit called folder.save(callback) as a BARE STATEMENT, so the
    // handler resolved `undefined` and the retired shim recovered the response from its deferred
    // capture. That deferral is gone, so every path below must return its own response. The
    // try/catch (rather than a bare await) is what keeps the duplicate-name branch's error
    // identity reachable, exactly as the error-first callback did.
    var saved;
    try {
      saved = await folder.save();
    }
    catch (err) {
      if (err.code === 11000) {
        // PRESERVED QUIRK - see docs/PRESERVED-QUIRKS.md.
        // `request.catch` has NEVER existed: the shim decorated the request with `success` and
        // `fail` only, and lib/http/responseContract.js deliberately exports no third responder.
        // This line therefore raises `TypeError: request.catch is not a function`, and the
        // TypeError IS the behaviour, so the call site is kept verbatim.
        // R-6 ADJUDICATION, measured over real HTTP against a verbatim replica of the base-commit
        // wrapper: at the base commit the TypeError escaped from an unowned Mongoose save callback,
        // so the request received NO RESPONSE at all - and because nothing in app.js, config/ or
        // lib/ installs an uncaughtException handler, the process itself died. That outcome cannot
        // be reproduced once the deferral is gone; raised inside this async handler the same
        // TypeError now reaches the centralized error map as a clean 500. The hang-to-500
        // convergence is unavoidable and accepted. Changing this to request.fail, or adding a
        // `catch` responder, would answer 200 with a failure flash - a response no baseline request
        // ever produced.
        return request.catch({
            err     : err
          , message : "You already have a folder with this name. Please choose another."
        });
      }

      // unknown failure
      // PRESERVED QUIRK - see docs/PRESERVED-QUIRKS.md. The deleted synthetic responder built its
      // response and then returned a CHAINABLE BUILDER; `type()` and `bytes()` handed the builder
      // back without settling, and this site called no terminator at all, so the object that stood
      // in for the response was the builder itself - every own property a function.
      // R-6 ADJUDICATION, measured: hapi 21 serializes that shape to status 200,
      // content-type application/json, body `{}`, and never to the { err, message } object this
      // code appears to send. At the base commit this branch ALSO returned no response (the
      // builder never reached the wrapper), so the conversion converges it to the `{}` the builder
      // itself serializes to - the value the code plainly intends. A 500 would be equally
      // defensible; the measured builder semantics decide it. `h.response()` would emit an empty
      // body rather than `{}` and is therefore wrong.
      return h.response({});
    }

    await request.user.grant("folder-owner", "folder", { id : saved.id });
    saved._owner = saved._owner.id;
    return request.success({
        success : true
      , folder  : saved
    });
  },
  update : function(request, h) {
    var folder = request.pre.folder
      , updatedFolder;

    if (request.user.hasPermission("update-folder-details", "folder", { id : folder.id })) {
      folder.set(request.payload);
      return folder.save()
        .then(function(result) {
          updatedFolder = result;

          // Update trinkets with new folder info (fire-and-forget)
          // PRESERVED QUIRK - see docs/PRESERVED-QUIRKS.md. This loop is deliberately fired without
          // being waited on and its promises are deliberately not collected: the base commit answered
          // at the return below WITHOUT waiting for the trinket updates, and a failing trinket save
          // only reached the error log below - it never altered the folder-update response. Joining
          // or collecting these promises would delay the response and let a trinket failure change
          // it, so the loop is preserved exactly as the base commit wrote it.
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
            // PRESERVED QUIRK - see docs/PRESERVED-QUIRKS.md.
            // The same non-existent `request.catch` as in `create`, and the call site is likewise
            // kept verbatim - note that this argument leads with `success : false` where create's
            // leads with `err : err`. R-6 ADJUDICATION, measured over real HTTP against a verbatim
            // replica of the base-commit wrapper: here the TypeError is raised inside a `.catch`
            // callback of a chain that IS returned, so it became a rejection and the shim's single
            // catch-all already answered HTTP 500. It still answers 500 after the conversion, so
            // this site is preserved exactly rather than converged.
            return request.catch({
                success : false
              , message : "You already have a folder with this name. Please choose another."
            });
          }

          // unknown error
          // hapi API migration - see the note in `list`. Wire-identical scrubbed 500.
          throw err;
        });
    }
    else {
      // PRESERVED QUIRK - see docs/PRESERVED-QUIRKS.md. `Boom` is NOT declared in this file: line 1
      // binds @hapi/boom as `errors` (never used), `Boom` is not a Node global and is absent from
      // app.js's leak-detector whitelist. Evaluating it therefore raises
      // `ReferenceError: Boom is not defined` before `.forbidden` is ever reached.
      // R-6 ADJUDICATION, measured over real HTTP with `Boom` genuinely undeclared: this branch
      // answers HTTP 500 rendered as 50x.html - it has NEVER answered 403. The bare identifier is
      // kept byte-for-byte; adding a `Boom` require, or routing this through the unused binding on
      // line 1, would turn the 500 into a 403 and change the error mapping.
      throw Boom.forbidden();
    }
  },
  deleteFolder : function(request, h) {
    var folder = request.pre.folder;

    if (request.user.hasRole("folder-owner", "folder", { id : folder.id })) {
      return folder.deleteFolder()
        .then(function() {
          return request.success({
            success : true
          });
        })
        .catch(function(err) {
          // hapi API migration - see the note in `list`. Wire-identical scrubbed 500.
          throw err;
        });
    }
    else {
      // PRESERVED QUIRK - see docs/PRESERVED-QUIRKS.md, and the identical note in `update`. The
      // undeclared `Boom` raises a ReferenceError, so this ownership denial answers a measured
      // HTTP 500 rather than a 403. Bare identifier preserved; add no require.
      throw Boom.forbidden();
    }
  }
};
