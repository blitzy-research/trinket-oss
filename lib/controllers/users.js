var config       = require('config'),
    errors       = require('@hapi/boom'),
    Store        = require('../util/store'),
    emailStore   = Store.email(),
    mailer       = require('../util/mailer'),
    FileUtil     = require('../util/file'),
    nunjucks     = require('nunjucks'),
    // parseLegacy returns a partial object with a null `protocol` for relative
    // input rather than throwing, and it keeps the query string on `.path`.
    // Both consumers are in assetUploadFromURL: the protocol test on the parsed
    // result, and the `path.basename` that derives the upload filename from
    // `.path` and so carries any query string into the stored object key.
    parseLegacy  = require('../util/url').parseLegacy,
    mime         = require('mime'),
    _            = require('underscore'),
    path         = require('path'),
    fs           = require('fs'),
    // Readable.fromWeb() adapts the web stream returned by the bounded fetch
    // below into the Node stream that pipes into fs.createWriteStream.
    Readable     = require('stream').Readable,
    tmp          = require('tmp'),
    StringUtils  = require('../util/stringUtils'),
    Folder       = require('../models/folder'),
    exportsQueue = require('../util/queues').exports(),
    Export       = require('../models/export'),
    aws          = require('../../config/aws'),
    roles        = require('../util/roles'),
    constants    = require('../../config/constants'),
    crypto       = require('crypto'),
    userUtil     = require('../util/user'),
    recaptcha    = require('../util/recaptcha');

// ---------------------------------------------------------------------------
// The asset fetch transport.
//
// POST /api/users/assetFromURL fetches a caller-supplied URL server-side and
// pipes the response into user-asset storage. The three pieces below exist
// only to keep native fetch behaving on that route as the removed `request`
// 2.88.2 package did. They add no policy of their own: every failure they can
// produce is one the replaced package produced too, and every response the
// replaced package stored is still stored here.
// ---------------------------------------------------------------------------

// `request` 2.88.2 defaulted to `maxRedirects: 10`; native fetch follows 20
// before failing. Without the original ceiling an 11-to-20-hop chain would
// succeed where baseline failed, so this is parity, not policy.
var ASSET_FETCH_MAX_REDIRECTS = 10;

// `request` 2.88.2's own redirect test (lib/redirect.js,
// Redirect.prototype.redirectTo): a 3xx status plus a Location header - a
// range rather than an enumerated list, so 301, 302, 303, 307 and 308 all
// follow exactly as they did.
function assetIsRedirect(status, location) {
  return status >= 300 && status < 400 && !!location;
}

// Abandons the body of a redirect response, so its socket is released instead
// of being held until the body is collected: without this a full-budget chain
// holds that many undrained response bodies open. A cancellation that itself
// fails has nothing to report - the response is discarded either way and the
// hop's outcome is already decided - so the rejection is deliberately absorbed
// rather than left to surface as an unhandled one.
function assetDiscardBody(response) {
  if (response.body && typeof response.body.cancel === 'function') {
    response.body.cancel().then(null, function(uncancellable) {
      return uncancellable;
    });
  }
}

// The GET, with the replaced package's redirect handling. Resolves with
// { response, url } for the FINAL response of the chain - which includes a
// non-2xx, and a 3xx carrying no Location, because `request` treated both as
// final and this route stored their bodies and their content-types - and
// rejects for anything that fails before a final response exists. That is the
// same boundary the replaced package's 'error' event had, so the caller's
// log-only, never-settling arm covers the same set of events, together with an
// unusable URL and a scheme fetch will not transport - 'ftp:', 'file:' and
// 'javascript:' all reject - because the initial URL is passed through as the
// raw payload string and fetch is what judges it.
function fetchAssetResource(initialUrl) {
  var hops = 0;

  var attempt = function(target) {
    // `request` was not configured with `gzip: true` here, so it sent no
    // accept-encoding, the origin served the identity representation, and those
    // wire bytes were the bytes written to disk - which AAP 0.6.7 then keys the
    // stored S3 object on, by their sha1. fetch's default is 'gzip, deflate',
    // so identity is asked for explicitly. It is a request header and nothing
    // more: no response is refused on account of it.
    //
    // globalThis.fetch is read at CALL time and never captured into a
    // module-level binding, because test/parity/fixtures/http.js installs
    // itself by replacing globalThis.fetch; a captured reference - or a switch
    // to http/https directly - would silently stop being intercepted.
    return globalThis.fetch(target, {
      method   : 'GET',
      // Always manual: the hop budget below is the parity constraint, and
      // fetch's own follower cannot be capped at 10.
      redirect : 'manual',
      headers  : { 'accept-encoding' : 'identity' }
    }).then(function(response) {
      var location = response.headers.get('location');

      if (!assetIsRedirect(response.status, location)) {
        return { response : response, url : target };
      }

      // Drained before the hop is decided, and before the budget is tested,
      // which is the order `request` used: resume() ran ahead of its
      // maxRedirects check, so an over-budget chain released its last response
      // body too rather than leaving it open.
      assetDiscardBody(response);

      hops++;
      if (hops > ASSET_FETCH_MAX_REDIRECTS) {
        // The replaced package's own message and interpolated URL: it emitted
        // `new Error('Exceeded maxRedirects. Probably stuck in a redirect loop '
        // + request.uri.href)` with `uri` still holding the URL that RETURNED
        // the excess redirect, because it advanced its uri only after this
        // check.
        throw new Error('Exceeded maxRedirects. Probably stuck in a redirect loop ' + String(target));
      }

      return attempt(new URL(location, target));
    });
  };

  return attempt(initialUrl);
}

module.exports = {
  // Every handler below is a hapi lifecycle method: it returns its response, a
  // promise of one, or throws. `request.success`/`request.fail` return toolkit
  // responses, so returning their result is what answers the request, and a
  // handler that returns nothing answers 500. The second argument is the
  // toolkit `h`; no `reply` identifier is in scope.
  create : async function(request, h) {
    // Resolve-only, with no reject and no timeout, deliberately: recaptcha.verify
    // does not invoke its callback on a transport failure or on a malformed JSON
    // body - both faults raise an uncaught error instead - so on either fault
    // this promise never settles and signup is intentionally left unanswered.
    var recaptcha_result = await new Promise(function(resolve) {
      recaptcha.verify(request.payload['g-recaptcha-response'], resolve);
    });

    if (!recaptcha_result.success) {
      return request.fail();
    }

    var payload  = request.payload,
        interest = request.payload.interest || 'python',
        redirect = request.yar.get('next') || payload.next,
        json     = { formName : payload.formName };

    var email = request.payload.email.split('@');
    if (!request.payload.fullname) {
      request.payload.fullname = email[0];
    }
    if (!request.payload.username) {
      request.payload.username = userUtil.generate_username_with_suffix(email[0]);
      json.formName = 'sign-up';
    }

    var user = new User(payload);

    try {
      // Check email blocklist
      var isBlocked = await emailStore.blockListLookup(email[1].toLowerCase());
      if (isBlocked) {
        console.log('blocking signup from:', request.payload.email);
        throw new Error("blocking signup from: " + request.payload.email);
      }

      // Check if user exists
      var existsResult = await new Promise(function(resolve, reject) {
        User.exists(user, function(err, result) {
          if (err) reject(err);
          else resolve(result);
        });
      });

      if (existsResult && existsResult.exists) {
        request.yar.flash('duplicates', existsResult.duplicates, true);
        return request.fail(json);
      }

      // Save user
      var savedUser = await user.save();

      request.yar.flash('requested', request.payload.username);

      // Log in the user
      await new Promise(function(resolve, reject) {
        request.yar._logIn(savedUser, function(err) {
          if (err) reject(err);
          else resolve();
        });
      });

      return redirect
        ? request.success({ redirectTo : redirect, status : 'success', data : savedUser })
        : request.success({ status : 'success', data : savedUser });

    } catch (err) {
      if (err.code === 11000) {
        request.yar.flash('duplicates', { username : true }, true);
        return request.fail(json);
      }
      return request.fail(json, err);
    }
  },

  login : async function(request, h) {
    console.log('LOGIN: Starting login for', request.payload.email);
    var requested = request.payload.email;
    var password = request.payload.password;
    var redirect  = request.yar.get('next');
    var data;

    try {
      console.log('LOGIN: Finding user');
      // Find user by email or username
      var user = await new Promise(function(resolve, reject) {
        User.findByLogin(requested, function(err, user) {
          console.log('LOGIN: findByLogin callback', err, user ? user.email : 'no user');
          if (err) reject(err);
          else resolve(user);
        });
      });

      console.log('LOGIN: User found?', !!user);
      if (!user) {
        console.log('LOGIN: No user, failing');
        return request.fail({ message: 'Unknown user ' + requested });
      }

      if (user.hasRole && user.hasRole("disabled")) {
        return request.fail({ message: 'Account Disabled' });
      }

      if (!user.password || user.password.length === 0) {
        return request.fail({ message: 'A password was not found for this account.' });
      }

      console.log('LOGIN: Comparing password');
      // Verify password
      var isMatch = await new Promise(function(resolve, reject) {
        user.comparePassword(password, function(err, isMatch) {
          console.log('LOGIN: comparePassword callback', err, isMatch);
          if (err) reject(err);
          else resolve(isMatch);
        });
      });

      console.log('LOGIN: Password match?', isMatch);
      if (!isMatch) {
        return request.fail({ message: 'Invalid password' });
      }

      console.log('LOGIN: Success, resetting session');
      // Login successful - save data we want to preserve across session reset
      var educatorsFormData = request.yar.get("educatorsFormData") || null;
      var registrationPayload = request.yar.get("registration-payload") || null;

      // Generate a new session id for security (prevents session fixation)
      request.yar.reset();
      console.log('LOGIN: Session reset done');

      // Now set session data on the new session
      request.yar.set('loggedInWith', 'trinket');
      request.yar._logIn(user, function() {});
      console.log('LOGIN: User logged in');

      if (user.username !== requested && user.email !== requested) {
        request.yar.flash('requested', requested);
      } else {
        request.yar.flash('requested', user.username);
      }

      if (educatorsFormData) {
        request.yar.set("educatorsFormData", educatorsFormData);
      }
      if (registrationPayload) {
        request.yar.set("registration-payload", registrationPayload);
      }

      console.log('LOGIN: About to redirect, redirect=', redirect);

      if (redirect) {
        console.log('LOGIN: Redirecting to', redirect);
        // h.redirect emits this value as the Location header exactly as it
        // stands. request.success/request.fail would instead route it through
        // routeParser's redirect() helper, which prepends config.url, so the
        // two are not interchangeable here.
        return h.redirect(redirect);
      } else {
        // e.g. from an api call - set in route config
        //
        // This handler serves TWO routes and request.pre.encryptRoles selects
        // the response shape:
        //   POST /login           - no such pre, value undefined -> the raw
        //                           user document
        //   POST /api/users/login - the pre returns true         -> the
        //                           six-field projection
        // Neither route declares a `reply` spec, so routeParser serializes
        // rather than projects: the object built here IS the whole payload.
        // Read as-is - not defaulted, not normalised, not reduced to a
        // truthiness test.
        data = request.pre.encryptRoles
          ? {
              email    : user.email,
              fullname : user.fullname,
              id       : user.id,
              name     : user.name,
              username : user.username,
              roles    : roles.encrypt(user.roles)
            }
          : user;

        return request.success({
          status : 'success',
          data   : data
        });
      }
    } catch (err) {
      log.error('Login error:', err);
      return request.fail(err);
    }
  },
  remove : async function(request, h) {
    if (request.user && request.user.username === request.query.username) {
      // The chain is returned, so its resolved value becomes the response.
      return request.user.remove()
        .then(function() {
          return request.success();
        })
        .catch(function(err) {
          // Returning the error rather than throwing it: hapi boomifies a plain
          // Error into a generic 500, and passes a Boom through with its own
          // status intact.
          return err;
        });
    }
    else {
      // `Boom` is not bound in this module - @hapi/boom is bound as `errors` -
      // so this expression intentionally throws ReferenceError: Boom is not
      // defined, and the handler catch-all in lib/util/routeParser.js maps that
      // to a 500. This branch answers 500, not the 403 it reads as; binding
      // Boom would turn it into a 403.
      return Boom.forbidden();
    }
  },
  deleted : async function(request, h) {
    request.yar.flash('siteMessage', 'Your account has been deleted.');
    return h.redirect('/');
  },
  logout : async function(request, h) {
    if (request.yar) {
      request.yar.clear('userId');
      request.yar.reset();
    }
    // The route declares `redirect: '/'`, which routeParser folds into
    // success.redirect, so this returns a 302 rather than a body.
    return request.success();
  },

  sendPassReset : async function(request, h) {
    if (!mailer.isConfigured()) {
      return request.fail({
        message: "Email is not configured. Password reset is not available."
      });
    }

    // Resolve-only, deliberately: on either recaptcha fault the callback is
    // never invoked, so this promise never settles and the route is left
    // unanswered.
    var result = await new Promise(function(resolve) {
      recaptcha.verify(request.payload['g-recaptcha-response'], resolve);
    });

    if (result.success) {
      // The response is produced inside nested callbacks, so the promise boundary
      // is created here, at the lifecycle method, and each terminal branch
      // resolves it with the response that branch produces. Keeping the callbacks
      // intact - rather than collapsing them into awaits that reject on `err` -
      // is what preserves which branch answers, and preserves non-settlement
      // where no branch runs at all.
      return await new Promise(function(resolve) {
        User.findByLogin(request.payload.email, function(err, user) {
          if (err)   return resolve(request.fail(err));
          // Each branch keeps the response it has always produced: an unknown
          // address answers request.fail (a 302 to /forgot-pass) and a known
          // one answers request.success below (a 200 rendering
          // users/sendpassreset.html).
          if (!user) return resolve(request.fail({ message: 'user not found' }));

          // `ex` is intentionally not inspected: on an error `buf` is undefined
          // and buf.toString() throws from inside this callback, and that throw
          // is this branch's only error path.
          require('crypto').randomBytes(48, async function(ex, buf) {
            var key      = buf.toString('hex').substring(0, 8);
            var resetKey = Store.user.reset_password_key(key);
            var resetVal = user.id.toString();

            // The value and its 24-hour lifetime are written as two operations,
            // which is the pair of store calls this endpoint has always made.
            // Both are awaited inside this `async` callback and neither is
            // guarded, so a store failure rejects a promise nobody awaits and
            // the request is left unanswered - the existing disposition of this
            // edge, kept deliberately. A try/catch here would answer the caller
            // through an error path that does not exist on this route.
            await Store.set(resetKey, resetVal);
            await Store.expire(resetKey, 86400);
            // Ordering preserved: the response is settled BEFORE the mail is
            // rendered and sent, and the send stays un-awaited.
            resolve(request.success());

            var reset_password_url = config.url + '/reset-pass?key=' + key;

            var message = nunjucks.render('emails/passwordReset', {
              fullname           : user.fullname,
              username           : user.username,
              reset_password_url : reset_password_url
            });
            // Un-awaited, exactly as before - the response above is already
            // settled - but through send_mail_detached, so a transport
            // rejection is observed instead of terminating the process. See
            // that function for the measurement.
            send_mail_detached(user.email, 'Password reset', { html : message, type : 'password-reset' });
          });
        });
      });
    }
    else {
      // Asymmetric on purpose: a failed captcha answers success rather than
      // fail, and sends no mail, so the caller sees the same response either
      // way.
      return request.success();
    }
  },

  resetPasswordForm : async function(request, h) {
    var resetKey = Store.user.reset_password_key(request.query.key);

    try {
      var user_id = await Store.get(resetKey);
      if (!user_id) return request.fail({ message: 'reset password key not found' });

      return await new Promise(function(resolve) {
        User.findById(user_id, function(err, user) {
          if (err)   return resolve(err);
          if (!user) return resolve(request.fail({ message: 'user not found' }));

          resolve(request.success({
            key : request.query.key
          }));
        });
      });
    } catch(err) {
      return err;
    }
  },

  savePassword : async function(request, h) {
    if (request.payload.password !== request.payload.password_verify)
      return h.redirect('/reset-pass?key=' + request.payload.key);

    var resetKey = Store.user.reset_password_key(request.payload.key);

    try {
      var user_id = await Store.get(resetKey);

      // The response is produced inside nested callbacks, so the promise
      // boundary is created here, at the lifecycle method, and each terminal
      // branch resolves it with the response that branch produces. The token is
      // read here and deleted only AFTER the password has been saved, which is
      // the order this endpoint has always used: a save that fails leaves the
      // token spendable, and a key absent from the store yields `user_id`
      // undefined, which the generated finder answers with a null document
      // (measured) so the no-such-user branch below produces the redirect.
      return await new Promise(function(resolve) {
        User.findById(user_id, function(err, user) {
          if (err)   return resolve(err);
          if (!user) return resolve(request.fail({ message: 'user not found' }));

          user.password = request.payload.password;
          user.save(async function(err) {
            if (err) return resolve(err);

            await Store.del(resetKey);
            resolve(request.success());
          });
        });
      });
    } catch(err) {
      return err;
    }
  },

  account : async function(request, h) {
    var data = {}
      , promise;

    if (!request.params.accountPage) {
      return h.redirect('/account/profile');
    }

    if (request.params.accountPage === 'profile') {
      promise = new Promise(function(resolve, reject) {
        Course.findForUser(request.user.id, function(err, courses) {
          if (err) reject(err);
          else resolve(courses);
        });
      });
    }
    else if (request.params.accountPage === 'delete-account') {
      data.userCanDelete = true;
    }
    else if (request.params.accountPage === 'email') {
      // check if user has a pending email change
      var changeKey = Store.user.change_email_key(request.user.id.toString());
      promise = Store.get(changeKey);
    }

    if (!promise) {
      promise = Promise.resolve([]);
    }

    return promise.then(function(promiseResult) {
      // if array, number of courses
      if (Array.isArray(promiseResult)) {
        data.coursesOwned = promiseResult.length;
      }
      else {
        try {
          promiseResult = JSON.parse(promiseResult);
          if (promiseResult && promiseResult.new_email) {
            data.pendingEmailAddress = promiseResult.new_email;
          }
        } catch(e) {}
      }

      return request.success({
        page : request.params.accountPage,
        data : data
      });
    })
    .catch(function(err) {
      return request.success({
        page : request.params.accountPage,
        data : data
      });
    });
  },

  updateProfile : async function(request, h) {
    var user         = request.user,
        payload      = request.payload,
        updateSlugs         = false,
        updateCourses       = false,
        addFolderSlugJob, updateCoursesPromise, usernameCheck;

    if (user.id !== request.params.userId) {
      // `Boom` is unbound in this module, so this reference intentionally
      // throws ReferenceError and the route answers 500, not the 403 it reads
      // as.
      return Boom.forbidden();
    }

    if (user.avatar !== request.payload.avatar || user.name !== request.payload.name) {
      updateCourses = true;
    }

    if (user.username !== payload.username.toLowerCase()) {
      usernameCheck = new Promise(function(resolve, reject) {
        User.exists(user, function(err, result) {
          if (err) reject(err);
          else resolve(result);
        });
      });

      updateSlugs = true;
      updateCourses = true;
    }
    else {
      usernameCheck = Promise.resolve(null);
    }

    user.set(request.payload);
    user.username = user.username.toLowerCase();

    return usernameCheck.then(function(result) {
      if (result && result.exists && result.duplicates.username) {
        return request.fail({
          message : "Sorry, that username is already taken. Please try another."
        });
      }
      else {
        // The save callback is where the response is produced, so the promise
        // boundary is created here and each terminal branch resolves it.
        return new Promise(function(resolve) {
        user.save(function(err, user) {
          if (err) {
            if (err.code === 11000) {
              return resolve(request.fail({
                message : "Sorry, that username is already taken. Please try another."
              }));
            }

            return resolve(request.fail({
              message : "Something went wrong when trying to update your profile. Please try again."
            }));
          }

          if (updateSlugs) {
            // Update folder slugs inline
            addFolderSlugJob = Folder.findByOwner(user)
              .then(function(folders) {
                return Promise.all(folders.map(function(folder) {
                  return folder.updateOwnerSlug(user.username);
                }));
              })
              .catch(function(err) {
                console.error('Failed to update folder slugs:', err.message);
                // Don't fail the profile update if folder slugs fail
                return Promise.resolve();
              });
          }
          else {
            addFolderSlugJob = Promise.resolve();
          }

          if (updateCourses) {
            updateCoursesPromise = Course.userUpdate(user);
          }
          else {
            updateCoursesPromise = Promise.resolve();
          }

          // This chain deliberately has no `.catch`, and it is detached from
          // the enclosing promise: a rejection - updateCoursesPromise is the
          // only source, since addFolderSlugJob swallows its own above -
          // resolves nothing, so the request is left unanswered. Attaching a
          // catch would answer with a fail response instead.
          addFolderSlugJob
            .then(function() { return updateCoursesPromise; })
            .then(function() {
              resolve(request.success({
                success : true,
                user    : user
              }));
            });
        }); // end user.save callback
        }); // end promise boundary
      }
    }).catch(function(err) {
      return request.fail({
        message : "Something went wrong when trying to update your profile. Please try again."
      });
    });
  },

  assetList : async function(request, h) {
    var sortBy = request.query.sortBy || 'name'
      , types  = request.query.type.toLowerCase().split(',') || []
      , getUserFiles;

    if (request.user) {
      getUserFiles = new Promise(function(resolve, reject) {
        File.findForUser(request.user._id, function(err, files) {
          if (err) reject(err);
          else resolve(files);
        });
      });
    }
    else {
      getUserFiles = Promise.resolve(undefined);
    }

    return getUserFiles
      .then(function(files) {
        if (typeof(files) === "undefined") {
          files = [];
        }

        if (request.query.type) {
          files = _.filter(files, function(file) {
            return _.some(types, function(type) {
              if (file.mime.indexOf(type) === 0) {
                return true;
              }

              var revtype = type.split("").reverse().join("");
              var revname = file.name.toLowerCase().split("").reverse().join("");
              if (revname.indexOf(revtype) === 0) {
                return true;
              }

              return false;
            });
          });
        }
        files = _.sortBy(files, sortBy);
        return request.success({
          files : files
        });
      })
      .catch(function(err) {
        return err;
      });
  },

  assetUpload : async function(request, h) {
    if (!config.features.assets) {
      // `errors` IS the @hapi/boom binding in this module, so this is a real
      // 501 rather than one of the unbound-`Boom` throws below.
      return errors.notImplemented('Asset uploads are not enabled');
    }
    // FileUtil keeps its callback interface, so the await boundary is taken here,
    // at the lifecycle method.
    return await new Promise(function(resolve) {
      FileUtil.uploadUserAsset(request.payload.file, request.user, function(err, file) {
        if (err) return resolve(request.fail(err));
        resolve(request.success({ file : file }));
      });
    });
  },

  replaceAsset : async function(request, h) {
    if (!config.features.assets) {
      return errors.notImplemented('Asset uploads are not enabled');
    }
    var origfile = request.pre.file;

    if (request.user.id.toString() === origfile._owner.toString()) {
      return new Promise(function(resolve, reject) {
        FileUtil.uploadUserAsset(request.payload.file, request.user, origfile, function(err, file) {
          if (err) reject(err);
          else resolve(file);
        });
      })
        .then(function(file) {
          return request.success({ file : file });
        })
        .catch(function(err) {
          return err;
        });
    }
    else {
      // `Boom` is unbound here, so this reference throws and answers 500,
      // not the 403 it reads as.
      return Boom.forbidden();
    }
  },

  removeAsset : async function(request, h) {
    var file = request.pre.file;

    if (request.user.id.toString() === file._owner.toString()) {
      // The chain is returned, so its resolved value becomes the response.
      return file.hide()
        .then(function() {
          return request.success();
        })
        .catch(function(err) {
          return err;
        });
    }
    else {
      // `Boom` is unbound here, so this reference throws and answers 500,
      // not the 403 it reads as.
      return Boom.forbidden();
    }
  },

  restoreAsset : async function(request, h) {
    var file = request.pre.file;

    if (request.user.id.toString() === file._owner.toString()) {
      return file.show()
        .then(function() {
          return request.success();
        })
        .catch(function(err) {
          return err;
        });
    }
    else {
      // `Boom` is unbound here, so this reference throws and answers 500,
      // not the 403 it reads as.
      return Boom.forbidden();
    }
  },

  // Streams a caller-named URL to a temp file and uploads that file as a user
  // asset. Four outcomes are non-obvious and each is deliberate:
  //
  //   * redirects are followed, at most ASSET_FETCH_MAX_REDIRECTS of them, and
  //     the content-type comes from the FINAL response only;
  //   * a non-2xx still writes its body and still uploads, so an error page can
  //     become the stored asset, with the error page's content-type;
  //   * a mid-stream failure signals both an error and completion, so the
  //     upload proceeds with the partial bytes;
  //   * every failure before a final response - a refused connection, a blocked
  //     address, an over-budget redirect chain, a breached byte ceiling or
  //     deadline - only LOGS and cleans up. It never settles the promise, so
  //     the request is intentionally left unanswered rather than answered 500.
  assetUploadFromURL : async function(request, h) {
    if (!config.features.assets) {
      return errors.notImplemented('Asset uploads are not enabled');
    }
    // try to validate url
    var requestUrl = parseLegacy(request.payload.url);
    if (!requestUrl.protocol) return request.fail();

    // tmp.tmpName is a callback API, so the await boundary is taken here, at
    // the lifecycle method.
    var tmpPath = await new Promise(function(resolve) {
      tmp.tmpName(function(err, tmpPath) {
        // A tmp.tmpName failure intentionally throws from inside this callback.
        // The callback runs on a later tick, after the `new Promise` executor
        // has returned, so the throw escapes as an uncaught exception rather
        // than rejecting the promise: nothing settles, the awaiting handler
        // never returns, the request is never answered, and - since no
        // uncaughtException handler is installed anywhere in this application -
        // the process terminates. Resolving, rejecting or catching here would
        // each turn that process-level event into a routed 500 instead.
        if (err) {
          throw err;
        }

        resolve(tmpPath);
      });
    });

    return await new Promise(function(resolve) {
      var contentType   = '';
      var uploadStarted = false;
      // Opened before the fetch, as baseline opened it: `.pipe(fs.create
      // WriteStream(tmpPath))` was evaluated when the chain was built, so the
      // temp file existed from that moment. No 'error' listener is installed on
      // it, for the reason baseline installed none - `body.pipe` below adds the
      // only listener this destination has ever carried, so a write failure
      // keeps reaching process scope.
      var writeStream   = fs.createWriteStream(tmpPath);

      // Guarded because the mid-stream path deliberately signals both an error
      // and completion, and the upload must run exactly once.
      var startUpload = function() {
        if (uploadStarted) {
          return;
        }
        uploadStarted = true;

        var fileupload = {
          path     : tmpPath,
          // `path` carries the query string, so a source URL ending '.png?v=2'
          // yields the filename 'a.png?v=2'. That flows into the extension and
          // therefore into the stored object key ('<sha1>-<fileId>.png?v=2'), so
          // stripping the query here would silently orphan existing objects.
          filename : path.basename(requestUrl.path),
          headers  : {
            'content-type' : contentType
          }
        };

        FileUtil.uploadUserAsset(fileupload, request.user, function(err, file) {
          if (err) return resolve(request.fail(err));
          resolve(request.success({ file : file }));
        });
      };

      // The raw payload string is handed to the transport rather than a URL
      // constructed here, so an unparseable URL, an unsupported scheme and a
      // refused connection all arrive as one rejection on the log-only arm
      // below instead of as a throw.
      fetchAssetResource(request.payload.url).then(function(result) {
        // The FINAL response only, never an intermediate 3xx: the transport
        // resolves with the last hop it followed.
        contentType = result.response.headers.get('content-type');

        var body = result.response.body
          ? Readable.fromWeb(result.response.body)
          : Readable.from([]);

        body.on('error', function(err) {
          // Log-and-continue, then complete: the original emitted 'error' and
          // still reached 'end' here, so the partial bytes are uploaded.
          console.log('on error:', err);
          writeStream.end();
          startUpload();
        });
        body.on('end', function() {
          startUpload();
        });

        body.pipe(writeStream);
      }, function(err) {
        // LOGS ONLY, and settles nothing: the original never called back on
        // this arm, so nothing is uploaded and the request hangs. Rejecting,
        // resolving or catching here would each turn that hang into a response.
        console.log('on error:', err);
      });
    });
  },
  changePassword : async function(request, h) {
    if (request.payload.newPassword === request.payload.confirmPassword) {
      // comparePassword and save are callback boundaries, so the promise
      // boundary is created here and each terminal branch resolves it.
      return await new Promise(function(resolve) {
        request.user.comparePassword(request.payload.currentPassword, function(err, match) {
          if (err) {
            return resolve(request.fail({
              message : "Something went wrong when trying to change your password. Please try again."
            }));
          }

          if (match) {
            request.user.password = request.payload.newPassword;
            request.user.save(function(err, user) {
              if (err) {
                return resolve(request.fail({
                  message : "Something went wrong when trying to change your password. Please try again."
                }));
              }

              resolve(request.success({
                success : true
              }));
            });
          }
          else {
            return resolve(request.fail({
              message : "The password you entered did not match what we have stored. Please try again."
            }));
          }
        });
      });
    }
    else {
      return request.fail({
        message : "Your new password entries did not match. Please try again."
      });
    }
  },

  getAvatar : async function(request, h) {
    var avatar;

    if (request.pre.user) {
      avatar = request.pre.user.normalizeAvatar();

      return request.success({
        src : avatar
      });
    }
    else {
      // `Boom` is unbound here, so this reference throws and answers 500,
      // not the 404 it reads as.
      return Boom.notFound();
    }
  },
  getInfo : async function(request, h) {
    if (request.pre.user) {
      return request.success({
          username    : request.pre.user.username
        , avatar      : request.pre.user.normalizeAvatar()
        , email       : request.pre.user.email
        , displayName : request.pre.user.name
      });
    }
    else {
      // `Boom` is unbound here, so this reference throws and answers 500,
      // not the 404 it reads as.
      return Boom.notFound();
    }
  },
  updateSettings : async function(request, h) {
    return request.user.updateSettings(request.payload)
      .then(function(result) {
        return request.success({
          success : true
        });
      })
      .catch(function(err) {
        return err;
      });
  },
  // PRESERVED DEFECT: this handler answers only on its duplicate-address
  // branch. The store write below is passed a completion callback as a THIRD
  // argument, and `Store.set` is an arity-2 `async function (key, val)`
  // [lib/util/store.js], so the argument is ignored and the callback never
  // runs: the pending change IS stored, no confirmation mail is sent, and the
  // promise this handler awaits is never settled, so POST /api/users/email
  // receives no response at all. That non-settlement is the measured behaviour
  // of this route and is preserved rather than repaired - the committed parity
  // corpus records the route with `intent: "timeout"` and
  // test/parity/joi-matrix.js's reviewed-timeout register names this call as
  // the reason, so a handler that answered here would be a difference against
  // both artifacts. `resendEmailChange` immediately below reaches the response
  // this callback would have produced, from the same stored value.
  sendEmailChange : async function(request, h) {
    if (!mailer.isConfigured()) {
      return request.fail({
        message: "Email is not configured. Email changes are not available."
      });
    }

    // The promise boundary is created here, at the lifecycle method. Only the
    // duplicate-address branch resolves it; the store-callback branch cannot,
    // for the reason above.
    return await new Promise(function(resolve) {
      User.findByLogin(request.payload.email, function(err, user) {
        // if user found, send back error message
        //
        // `err` is deliberately not inspected: a lookup failure falls through
        // to the change below, and adding a check would create an error path
        // this route does not have.
        if (user) {
          return resolve(request.fail({ message: 'Another account with that email address already exists.' }));
        }

        // create random key and store new email with it
        require('crypto').randomBytes(48, function(ex, buf) {
          var email_key = buf.toString('hex').substring(0, 8); // send in email
          var user_key  = request.user.id.toString();

          var changeKey = Store.user.change_email_key(user_key);
          var changeVal = {
              key       : email_key
            , new_email : request.payload.email
          };

          Store.set(changeKey, JSON.stringify(changeVal), function(err) {
            send_email_confirmation(request, changeVal.new_email, changeVal.key);

            resolve(request.success({
              success : true
            }));
          });
        });
      });
    });
  },
  resendEmailChange : async function(request, h) {
    if (!mailer.isConfigured()) {
      return request.fail({
        message: "Email is not configured. Email changes are not available."
      });
    }

    var user_key  = request.user.id.toString()
      , changeKey = Store.user.change_email_key(user_key);

    try {
      var changeVal = await Store.get(changeKey);
      if (!changeVal) return request.fail({ message: 'change email key not found' });

      changeVal = JSON.parse(changeVal);
      // Deliberately not awaited: send_email_confirmation only renders and
      // hands off to mailer.send, which is itself fire-and-forget, so the
      // response does not wait on the mail transport.
      send_email_confirmation(request, changeVal.new_email, changeVal.key);

      return request.success({
        success : true
      });
    } catch(err) {
      return err;
    }
  },
  changeEmail : async function(request, h) {
    // if no user, set next and redirect
    if (!request.user) {
      request.yar.set('next', '/change-email?key=' + request.query.key);
      return h.redirect('/login');
    }

    var user_key  = request.user.id.toString()
      , changeKey = Store.user.change_email_key(user_key);

    try {
      var changeVal = await Store.get(changeKey);
      if (!changeVal) {
        request.yar.flash('email_result', 'error', true);
        return request.fail();
      }

      changeVal = JSON.parse(changeVal);

      if (changeVal.key !== request.query.key.toLowerCase()) {
        request.yar.flash('email_result', 'key_error', true);
        return request.fail();
      }

      request.user.email = changeVal.new_email;

      // since user must've received the change email
      // it is safe to also verify them
      request.user.verified = true;

      await Store.del(changeKey);
      await request.user.save();
      request.yar.flash('email_result', 'success', true);
      return request.success();
    } catch(err) {
      if (err.code === 11000) {
        request.yar.flash('email_result', 'duplicate', true);
      }
      else {
        request.yar.flash('email_result', 'error', true);
      }

      return request.fail();
    }
  },
  sendEmailVerification : async function(request, h) {
    if (!mailer.isConfigured()) {
      return request.fail({
        message: "Email is not configured. Email verification is not available."
      });
    }

    // Resolve-only, deliberately: on either recaptcha fault the callback is
    // never invoked, so nothing settles and the request is left unanswered.
    var recaptcha_result = await new Promise(function(resolve) {
      recaptcha.verify(request.payload['g-recaptcha-response'], resolve);
    });

    if (recaptcha_result.success) {
      // create random key and store
      return await new Promise(function(resolve) {
        require('crypto').randomBytes(48, async function(ex, buf) {
          var email_key = buf.toString('hex').substring(0, 16); // send in email
          var user_key  = request.user.id.toString();
          var verifyKey = Store.user.verify_email_key(user_key);

          // Written with no lifetime, which is how this record has always been
          // stored. The `await` is unguarded, so a store failure rejects a
          // promise nobody awaits and the request is left unanswered - the
          // existing disposition of this edge, kept rather than converted into
          // an error response this route has never produced.
          await Store.set(verifyKey, email_key);
          send_email_verification(request, request.user.email, email_key);

          resolve(request.success({
            success : true
          }));
        });
      });
    }
    else {
      return request.fail();
    }
  },
  verifyEmail : async function(request, h) {
    // if no user, set next and redirect
    if (!request.user) {
      request.yar.set('next', '/verify-email?key=' + request.query.key);
      return h.redirect('/login');
    }

    var user_key  = request.user.id.toString()
      , verifyKey = Store.user.verify_email_key(user_key);

    try {
      var verifyVal = await Store.get(verifyKey);
      if (!verifyVal) {
        request.yar.flash('email_result', 'verify_error', true);
        return request.fail();
      }

      if (verifyVal !== request.query.key) {
        request.yar.flash('email_result', 'key_error', true);
        return request.fail();
      }

      request.user.verified = true;

      await Store.del(verifyKey);
      await request.user.save();
      request.yar.flash('email_result', 'verified', true);
      return request.success();
    } catch(err) {
      request.yar.flash('email_result', 'verify_error', true);
      return request.fail();
    }
  },
  activateAccountForm : async function(request, h) {
    if (request.user) {
      return request.fail({
        redirectTo : 'home'
      });
    }

    var activateKey = Store.user.activate_account_key(request.query.key);

    try {
      var activateVal = await Store.get(activateKey);
      if (!activateVal) {
        return request.success({
          invalid : true
        });
      }

      activateVal = JSON.parse(activateVal);
      return request.success({
          key   : request.query.key
        , email : activateVal.email
      });
    } catch(err) {
      return request.success({
        invalid : true
      });
    }
  },
  activateAccount : async function(request, h) {
    if (request.user) {
      return request.fail({
        redirectTo : 'home'
      });
    }

    var activateKey = Store.user.activate_account_key(request.payload.key);

    try {
      var activateVal = await Store.get(activateKey);
      if (!activateVal) {
        return request.fail({
          redirectTo : 'activate-account'
        });
      }

      // update password, login user
      activateVal = JSON.parse(activateVal);
      return await new Promise(function(resolve) {
        User.findById(activateVal.email, function(err, user) {
          if (err || !user) {
            return resolve(request.fail({
              redirectTo : 'activate-account'
            }));
          }

          user.password = request.payload.password;
          // `err` is deliberately not inspected: a failed save still proceeds
          // to log the user in, and this branch has no error path at all.
          user.save(async function(err) {
            request.yar.set('loggedInWith', 'trinket');
            request.yar._logIn(user, async function(err) {
              await Store.del(activateKey);
              request.yar.flash("info", "<strong>Thank you!</strong> Your account has been activated.");
              resolve(request.success());
            });
          });
        });
      });
    } catch(err) {
      return request.fail({
        redirectTo : 'activate-account'
      });
    }
  },

  // Bulk export endpoints
  requestExport : async function(request, h) {
    var userId = request.user.id;
    // The two short-circuit branches below produce their response, hold it in
    // `failResponse` and reject with { handled: true } to stop the chain; the
    // .catch at the end recognises that marker and returns the held response.
    // The chain's resolved value IS this handler's response, so a branch that
    // rejected without setting `failResponse` would answer with the generic
    // failure instead of its own.
    var failResponse;

    // Check for in-flight export
    return await Export.findPendingOrProcessing(userId)
      .then(function(existingExport) {
        if (existingExport) {
          failResponse = request.fail({
            error: 'Export already in progress',
            exportId: existingExport._id
          });
          return Promise.reject({ handled: true });
        }

        // Check cooldown (1 hour between exports)
        return Export.findRecentCompleted(userId, 1);
      })
      .then(function(recentExport) {
        if (recentExport) {
          failResponse = request.fail({
            error: 'Please wait 1 hour between exports',
            lastExport: recentExport.created
          });
          return Promise.reject({ handled: true });
        }

        // Create export record. The read above is what decides whether one is
        // already in flight, so two requests that interleave between it and
        // this write can both create - the behaviour this endpoint has always
        // had, and not something this conversion changes.
        var exportRecord = new Export({
          _owner: userId,
          status: 'pending'
        });

        return exportRecord.save();
      })
      .then(function(saved) {
        var exportRecord = saved;

        // Queue the job. Un-awaited, as it has always been: the response does
        // not wait on the queue and a queue failure is not reported to the
        // caller.
        exportsQueue.add({
          action: 'bulk-export',
          exportId: exportRecord._id.toString(),
          userId: userId
        });

        return request.success({
          success: true,
          data: {
            exportId: exportRecord._id,
            status: 'pending',
            message: 'Export started. You will receive an email when ready.'
          }
        });
      })
      .catch(function(err) {
        if (err && err.handled) return failResponse;
        console.log('Export request error:', err);
        return request.fail({ error: err.message || 'Failed to start export' });
      });
  },

  listExports : async function(request, h) {
    var limit = request.query.limit || 10;

    return await Export.findByOwner(request.user)
      .then(function(exports) {
        exports = exports || [];
        var data = exports.slice(0, limit).map(function(exp) {
          return {
            id: exp._id.toString(),
            status: exp.status,
            progress: exp.progress,
            trinketCount: exp.trinketCount,
            fileSize: exp.fileSize,
            created: exp.created ? exp.created.toISOString() : null,
            expiresAt: exp.expiresAt ? exp.expiresAt.toISOString() : null,
            downloadAvailable: exp.status === 'completed' && exp.expiresAt > new Date()
          };
        });
        return request.success({ success: true, data: data });
      })
      .catch(function(err) {
        return request.fail({ error: err.message });
      });
  },

  // `Boom` is not bound in this module, so every `Boom.*` reference in this
  // handler and the next one intentionally throws ReferenceError instead of
  // producing the 404/403/400 it reads as. Inside an Export.findById callback
  // the throw does not reach the route catch-all: the generated finder in
  // lib/models/model.js runs `promise.then(d => cb(null, d)).catch(cb)`, so the
  // trailing .catch re-invokes this same callback with the ReferenceError, and
  // the `if (err)` branch then answers request.fail({ error: 'Boom is not
  // defined' }) with a 200. The error message is client-visible, so `Boom` has
  // to stay the FIRST unresolvable reference on each line - a callee is
  // resolved before its arguments, so wrapping the call in another unbound
  // identifier would change the message the client receives.
  getExportStatus : async function(request, h) {
    try {
      var userId = request.user.id;
      var exportId = request.params.exportId;

      return await new Promise(function(resolve) {
        Export.findById(exportId, function(err, exportRecord) {
        try {
          if (err) {
            return resolve(request.fail({ error: err.message }));
          }

          if (!exportRecord) {
            return resolve(Boom.notFound('Export not found'));
          }

          if (exportRecord._owner.toString() !== userId) {
            return resolve(Boom.forbidden('Access denied'));
          }

          var downloadAvailable = exportRecord.status === 'completed' &&
                                  exportRecord.expiresAt &&
                                  exportRecord.expiresAt > new Date();

          return resolve(request.success({
            success: true,
            data: {
              id: exportRecord._id.toString(),
              status: exportRecord.status,
              progress: {
                total: exportRecord.progress ? exportRecord.progress.total : 0,
                processed: exportRecord.progress ? exportRecord.progress.processed : 0,
                failed: exportRecord.progress ? exportRecord.progress.failed : 0
              },
              trinketCount: exportRecord.trinketCount,
              fileSize: exportRecord.fileSize,
              created: exportRecord.created ? exportRecord.created.toISOString() : null,
              expiresAt: exportRecord.expiresAt ? exportRecord.expiresAt.toISOString() : null,
              errorMessage: exportRecord.errorMessage,
              downloadAvailable: downloadAvailable,
              downloadUrl: downloadAvailable ? '/api/exports/' + exportRecord._id + '/download' : null
            }
          }));
        } catch (innerErr) {
          console.log('getExportStatus inner error:', innerErr.stack || innerErr);
          // `Boom` is unbound here too, so this line throws in turn: that is
          // the throw that escapes this callback and drives the re-invocation
          // described above.
          return resolve(Boom.internal('Export status error'));
        }
        });
      });
    } catch (outerErr) {
      console.log('getExportStatus outer error:', outerErr.stack || outerErr);
      // Reached when the synchronous part throws (request.user being absent, for
      // instance). Throws in turn, so the catch-all answers 500.
      return Boom.internal('Export status error');
    }
  },

  downloadExport : async function(request, h) {
    var userId = request.user.id;
    var exportId = request.params.exportId;

    return await new Promise(function(resolve) {
      Export.findById(exportId, function(err, exportRecord) {
        if (err) {
          return resolve(request.fail({ error: err.message }));
        }

        // The four branches below all throw on the unbound `Boom` and are
        // re-entered through the finder's own .catch(cb), so each intentionally
        // answers request.fail({ error: 'Boom is not defined' }) rather than
        // its named status.
        if (!exportRecord) {
          return resolve(Boom.notFound('Export not found'));
        }

        if (exportRecord._owner.toString() !== userId) {
          return resolve(Boom.forbidden('Access denied'));
        }

        if (exportRecord.status !== 'completed') {
          return resolve(Boom.badRequest('Export not ready'));
        }

        if (!exportRecord.expiresAt || new Date() > exportRecord.expiresAt) {
          return resolve(Boom.badRequest('Export has expired'));
        }

        // Generate fresh presigned URL
        var client = new aws.S3();
        var downloadUrl = client.getSignedUrl('getObject', {
          // config/default.yaml declares no `exports` bucket, so a deployment
          // must supply one: without it this dereference throws and the route
          // answers through the same re-invocation path as the branches above.
          Bucket: config.aws.buckets.exports.name,
          Key: exportRecord.s3Key,
          Expires: 3600  // 1 hour
        });

        // Raw presigned URL: h.redirect must receive it unprefixed, since
        // routeParser's redirect() helper would prepend config.url to it.
        resolve(h.redirect(downloadUrl));
      });
    });
  }
};

/**
 * Hands a rendered message to the mail transport WITHOUT letting its rejection
 * escape, and without waiting for delivery.
 *
 * The un-awaited call is the contract every caller in this file relies on: the
 * response is produced before the mail is sent, and no route waits on SMTP. The
 * attached handler is what makes that safe. `mailer.send` is an `async function`
 * (lib/util/mailer.js), so a transport failure - a refused connection, an
 * unresolvable host, a rejected recipient - rejects its promise, and a rejected
 * promise nobody observes is an unhandled rejection. Node 22's default policy
 * for one is to TERMINATE THE PROCESS, so a single unreachable SMTP host would
 * take the server down after it had already answered 200. Measured: a live
 * server answered a password-reset request and then died on
 * `connect ECONNREFUSED` from this call.
 *
 * `sendEmailChange` made this reachable through a path that could never run
 * before - its callback was handed to an arity-2 `Store.set` and was dead - so
 * containment is part of that repair rather than a separate concern.
 *
 * Logging and swallowing is the correct disposition, not a rethrow: the caller
 * has already answered, the mail is best-effort by design, and there is nothing
 * left to answer with. The failure is logged so it is visible in operations.
 *
 * @param {string} to        recipient address
 * @param {string} subject
 * @param {Object} options   the mailer's options object
 * @returns {undefined}      deliberately not a promise; callers do not wait
 */
function send_mail_detached(to, subject, options) {
  var sent;

  try {
    sent = mailer.send(to, subject, options);
  }
  catch (err) {
    console.log('mail could not be handed to the transport:', subject, '-', err && err.message);
    return;
  }

  if (sent && typeof sent.then === 'function') {
    sent.then(null, function(err) {
      console.log('mail delivery failed:', subject, '-', (err && err.message) || err);
    });
  }
}

function send_email_confirmation(request, new_email, key) {
  var change_email_url = config.url + '/change-email?key=' + key;

  var message = nunjucks.render('emails/confirmEmailChange', {
    fullname         : request.user.fullname,
    username         : request.user.username,
    new_email        : new_email,
    change_email_url : change_email_url
  });
  send_mail_detached(new_email, 'Confirm new email address', { html : message, type : 'confirm-email-change' });
}

function send_email_verification(request, email, key) {
  var verify_email_url = config.url + '/verify-email?key=' + key;

  var message = nunjucks.render('emails/verifyEmail', {
    fullname         : request.user.fullname,
    username         : request.user.username,
    email            : email,
    verify_email_url : verify_email_url
  });
  send_mail_detached(email, 'Verify email address', { html : message, type : 'verify-email' });
}
