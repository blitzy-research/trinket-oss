var errors       = require('@hapi/boom')
  , config       = require('config')
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

      // `response.result.data` is deliberately UNGUARDED. If the injected route resolves to anything
      // without a `data` key this raises a TypeError, which the catch below turns into a 500; an
      // `if (response.result)` guard would invent a success response instead.
      // See docs/PRESERVED-QUIRKS.md.
      return h.respond({
        data : response.result.data
      });
    } catch (err) {
      // This handler answers a scrubbed 500 here, and is deliberately NOT a no-response site, unlike
      // `create` below: `throw err` reaches lib/http/errorMap.js, which is what produces that 500.
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
        // PRESERVED QUIRK: `request.catch` does not exist - lib/http/responseContract.js exports
        // exactly two responders and no third - so this call raises a TypeError, and the TypeError
        // IS the behaviour. The call site is kept VERBATIM and its effect answered with `h.abandon`,
        // because this branch answers NO RESPONSE AT ALL. Changing it to h.reject or adding a
        // `catch` responder would answer 200 with a failure flash, and letting the TypeError reach
        // the centralized error map would answer 500; neither status was ever produced here.
        // See docs/PRESERVED-QUIRKS.md section 1.15.
        try {
          return request.catch({
              err     : err
            , message : "You already have a folder with this name. Please choose another."
          });
        }
        catch (noSuchResponder) {
          return h.abandon;
        }
      }

      // unknown failure
      // PRESERVED QUIRK: a non-duplicate save failure answers NOTHING - neither a 200 `{}` nor a
      // 500 - so it is reproduced with `h.abandon`. See docs/PRESERVED-QUIRKS.md section 1.15.
      return h.abandon;
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
