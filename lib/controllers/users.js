var config       = require('config'),
    errors       = require('@hapi/boom'),
    Store        = require('../util/store'),
    emailStore   = Store.email(),
    mailer       = require('../util/mailer'),
    FileUtil     = require('../util/file'),
    nunjucks     = require('nunjucks'),
    url          = require('url'),
    mime         = require('mime'),
    _            = require('underscore'),
    path         = require('path'),
    fs           = require('fs'),
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

module.exports = {
  // hapi API migration: `reply` becomes the response toolkit `h` at all 31 handlers below.
  // The route parser no longer rescues a handler that resolved `undefined` from a deferred
  // capture, so EVERY code path here now has to return its response.
  create : async function(request, h) {
    // PRESERVED QUIRK - see docs/PRESERVED-QUIRKS.md. recaptcha.verify's callback is NOT
    // error-first: it yields a single result object, and its failure branch yields
    // { status : false } - key `status`, never `success` - so the `.success` read below is
    // falsy on a genuine failure by accident rather than by design. Kept exactly.
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
        // hapi API migration: the deleted synthetic `reply` in its CALL form - invoked, then
        // .redirect(url) - resolved with a genuine toolkit redirect, so this is a real 302 rather
        // than the property-form TypeError that keeps pages.js at 500. The raw toolkit
        // redirect is used deliberately - the shim's builder never routed through the
        // declarative absolutization in lib/http/redirect.js, so this `next` target is emitted
        // verbatim. TR4 freezes that: a successful login whose `next` is unset instead falls
        // through to the success responder below, where POST /login's declared
        // success.redirect '/home' (config/routes.js:L48-L50) IS absolutized - which is why the
        // login flow emits an absolute target while GET /account emits a relative one. Never
        // add .code(301) or any permanent-redirect override: baseline declares none.
        return h.redirect(redirect);
      } else {
        // e.g. from an api call - set in route config
        //
        // ⭐ THE encryptRoles PAYLOAD GATE. If the encryptRoles pre value is falsy this returns the
        // ENTIRE user document, bcrypt password hash included. This ternary is the only consumer
        // repo-wide of the `assign : 'encryptRoles'` pre declared at config/api_routes.js:L1104,
        // whose converted body returns literal `true`. The six keys, their order and
        // roles.encrypt(user.roles) are frozen: do NOT simplify the ternary, do NOT project with
        // ObjectUtils.pull, do NOT add a `password : undefined`. roles.encrypt still ships the AES
        // key to the browser as `token + '+' + ciphertext` - obfuscation, not security, and not
        // this change's to repair. See docs/PRESERVED-QUIRKS.md section 1.9.
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
      // `log` is the undeclared global assigned in app.js; it is read here without a require,
      // exactly as the rest of lib/ does.
      log.error('Login error:', err);
      // PRESERVED QUIRK - see docs/PRESERVED-QUIRKS.md. The error is passed as the FIRST argument,
      // so it lands in the responder's `json` slot and its `err` slot stays undefined: the log line
      // prints the inspected error followed by the literal string "undefined", the 'failure' flash
      // is set to the error object, and the response is HTTP 200. Do NOT rewrite this to pass an
      // empty json first and the error second.
      return request.fail(err);
    }
  },
  remove : function(request, h) {
    if (request.user && request.user.username === request.query.username) {
      return request.user.remove()
        .then(function() {
          return request.success();
        })
        .catch(function(err) {
          // Error-mapping preservation (R-5): the deleted synthetic `reply` tested `data.isBoom`
          // FIRST and settled with the Boom untouched, keeping its own status, and only then
          // wrapped a plain Error in a badImplementation Boom - a 500 whose message hapi scrubs.
          // `return err;` reproduces BOTH branches; a bare `throw err;` does not, because converted
          // handlers still run inside routeParser's wrapper whose catch-all hands everything to
          // lib/http/errorMap.js#toResponse, and that map has no isBoom test. Measured over real
          // HTTP against a faithful replica of the target wrapper on @hapi/hapi 21.4.10: a THROWN
          // Boom answered 500 while a RETURNED one kept its 403/404/501. See
          // docs/PRESERVED-QUIRKS.md.
          return err;
        });
    }
    else {
      // PRESERVED QUIRK - see docs/PRESERVED-QUIRKS.md. `Boom` is NOT declared in this file: line 2
      // binds @hapi/boom as `errors`, `Boom` is not a Node global and is absent from app.js's
      // leak-detector whitelist. Evaluating it raises `ReferenceError: Boom is not defined` before
      // `.forbidden` is ever reached, so this ownership denial has always answered HTTP 500 rendered
      // as 50x.html - never 403. R-6 adjudication: the bare identifier is kept byte-for-byte;
      // declaring `Boom`, or routing this through the `errors` binding, would turn the measured 500
      // into a 403 and change the error mapping. The same applies to all 15 bare `Boom` sites here.
      throw Boom.forbidden();
    }
  },
  deleted : function(request, h) {
    // Two-argument flash: NOT persisted with yar's isOverride flag. Preserved.
    request.yar.flash('siteMessage', 'Your account has been deleted.');
    // hapi API migration: CALL-form redirect, a genuine 302 to a relative target. Raw toolkit
    // redirect, no absolutization - see the note in `login`.
    return h.redirect('/');
  },
  logout : function(request, h) {
    if (request.yar) {
      // The clear-then-reset order is session behavior (TR4), not sequencing noise. Preserved.
      request.yar.clear('userId');
      request.yar.reset();
    }
    // The response IS the return value now. GET /logout declares a top-level `redirect : '/'`
    // (config/routes.js:L65-L68) which the route parser hoists into success.redirect, so the
    // responder answers the declarative absolutized redirect. Without this `return` the handler
    // would resolve undefined and hapi would raise, turning the redirect into a 500.
    return request.success();
  },

  sendPassReset : async function(request, h) {
    if (!mailer.isConfigured()) {
      // request.fail answers HTTP 200 with a failure flash - never a 4xx. The double-quoted message
      // is client-visible and byte-frozen. See docs/PRESERVED-QUIRKS.md.
      return request.fail({
        message: "Email is not configured. Password reset is not available."
      });
    }

    // Async conversion: the callback is flattened so that this handler can return its response.
    // recaptcha.verify's callback is non-error-first and, on the no-secret/test path, fires
    // synchronously on the caller's stack, so a resolve-only wrapper reproduces it exactly.
    var result = await new Promise(function(resolve) {
      recaptcha.verify(request.payload['g-recaptcha-response'], resolve);
    });

    if (result.success) {
      // Async conversion: resolving on BOTH outcomes keeps the branch below - not an escaping
      // rejection - in charge of what the route answers, which is what preserves the two
      // request.fail responses as HTTP 200s rather than promoting them to a 500.
      var lookup = await new Promise(function(resolve) {
        User.findByLogin(request.payload.email, function(err, user) {
          resolve({ err : err, user : user });
        });
      });

      // PRESERVED QUIRK - see docs/PRESERVED-QUIRKS.md. The error is passed as the responder's FIRST
      // argument, so it lands in `json`; the response is still HTTP 200. Argument order preserved.
      if (lookup.err)   return request.fail(lookup.err);
      if (!lookup.user) return request.fail({ message: 'user not found' });

      var user = lookup.user;

      // Async conversion: `ex` is IGNORED at baseline and stays ignored - the resolve-only wrapper
      // reproduces that, whereas a rejecting bridge would invent error handling the baseline never
      // had. The INLINE crypto require form, the 48-byte length and the hex slice below are
      // frozen: they mint the password-reset token that is persisted in the store and emailed to the
      // user (TR6), so any change invalidates every in-flight token.
      var buf = await new Promise(function(resolve) {
        require('crypto').randomBytes(48, function(ex, generated) {
          resolve(generated);
        });
      });

      var key      = buf.toString('hex').substring(0, 8);
      var resetKey = Store.user.reset_password_key(key);
      var resetVal = user.id.toString();

      await Store.set(resetKey, resetVal);
      await Store.expire(resetKey, 86400);

      // PRESERVED ORDER - see docs/PRESERVED-QUIRKS.md. Baseline calls the success responder HERE, then
      // composes and sends the email, and the response is only settled afterwards. The order is
      // behavioral twice over: returning that response immediately at this point would skip the
      // email entirely so that no user ever received a password reset, and responding first is also
      // what fixes the flash-drain timing, because the responder DRAINS the session flash store. The
      // built response is therefore captured and returned last.
      var response = request.success();

      var reset_password_url = config.url + '/reset-pass?key=' + key;

      var message = nunjucks.render('emails/passwordReset', {
        fullname           : user.fullname,
        username           : user.username,
        reset_password_url : reset_password_url
      });
      // Fire-and-forget, deliberately un-awaited - preserved exactly.
      mailer.send(user.email, 'Password reset', { html : message, type : 'password-reset' });

      return response;
    }
    else {
      // PRESERVED QUIRK - see docs/PRESERVED-QUIRKS.md. A FAILED recaptcha answers the SUCCESS
      // responder, not the failure one: a 2013-era quirk clients may depend on. Do not "correct" it.
      return request.success();
    }
  },

  resetPasswordForm : async function(request, h) {
    var resetKey = Store.user.reset_password_key(request.query.key);

    try {
      var user_id = await Store.get(resetKey);
      if (!user_id) return request.fail({ message: 'reset password key not found' });

      // Async conversion: flattened so the response below becomes the handler's return value.
      // Resolving on both outcomes keeps this branch, rather than an escaping rejection, in charge.
      var lookup = await new Promise(function(resolve) {
        User.findById(user_id, function(err, user) {
          resolve({ err : err, user : user });
        });
      });

      // Error-mapping preservation (R-5): returned, not thrown - see the note in `remove`.
      if (lookup.err)   return lookup.err;
      if (!lookup.user) return request.fail({ message: 'user not found' });

      // The response IS the return value now; baseline left this call bare and relied on the
      // deleted deferred capture.
      return request.success({
        key : request.query.key
      });
    } catch(err) {
      // Error-mapping preservation (R-5): returned, not thrown - see the note in `remove`.
      return err;
    }
  },

  savePassword : async function(request, h) {
    if (request.payload.password !== request.payload.password_verify)
      // hapi API migration: CALL-form redirect, a genuine 302. Raw toolkit redirect and no
      // absolutization, exactly as the deleted builder emitted it - see the note in `login`.
      return h.redirect('/reset-pass?key=' + request.payload.key);

    var resetKey = Store.user.reset_password_key(request.payload.key);

    try {
      var user_id = await Store.get(resetKey);

      // Async conversion: as in resetPasswordForm.
      var lookup = await new Promise(function(resolve) {
        User.findById(user_id, function(err, user) {
          resolve({ err : err, user : user });
        });
      });

      // Error-mapping preservation (R-5): returned, not thrown - see the note in `remove`.
      if (lookup.err)   return lookup.err;
      if (!lookup.user) return request.fail({ message: 'user not found' });

      var user = lookup.user;

      user.password = request.payload.password;

      // Async conversion: the save callback is flattened. Mongoose 6 still accepts the callback
      // form, and resolving on both outcomes preserves the error branch's own response.
      var saveError = await new Promise(function(resolve) {
        user.save(function(err) {
          resolve(err);
        });
      });

      // Error-mapping preservation (R-5): returned, not thrown - see the note in `remove`.
      if (saveError) return saveError;

      await Store.del(resetKey);
      // The response IS the return value now.
      return request.success();
    } catch(err) {
      // Error-mapping preservation (R-5): returned, not thrown - see the note in `remove`.
      return err;
    }
  },

  account : function(request, h) {
    var data = {}
      , promise;

    if (!request.params.accountPage) {
      // hapi API migration: CALL-form redirect, a genuine 302. TR4 freezes this target as RELATIVE -
      // the deleted builder called the raw toolkit redirect and never routed through the declarative
      // absolutization in lib/http/redirect.js, so `/account/profile` is emitted verbatim while a
      // successful login emits an absolute target. Do not normalize either. See the note in `login`.
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
    // PRESERVED QUIRK - see docs/PRESERVED-QUIRKS.md. The tail catch SWALLOWS the error into an
    // identical success response, so a failed course count or a failed pending-email lookup renders
    // the account page as though nothing went wrong. Preserved, not repaired.
    .catch(function(err) {
      return request.success({
        page : request.params.accountPage,
        data : data
      });
    });
  },

  updateProfile : function(request, h) {
    var user         = request.user,
        payload      = request.payload,
        updateSlugs         = false,
        updateCourses       = false,
        addFolderSlugJob, updateCoursesPromise, usernameCheck;

    if (user.id !== request.params.userId) {
      // PRESERVED QUIRK - see docs/PRESERVED-QUIRKS.md, and the full note in `remove`. The undeclared
      // `Boom` raises a ReferenceError, so this ownership denial answers a measured HTTP 500 rather
      // than a 403. Bare identifier preserved; add no require.
      throw Boom.forbidden();
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
        // Async conversion: baseline left this save callback a BARE STATEMENT, so the whole else
        // branch resolved `undefined` and only the deleted deferred capture rescued its response.
        // Returning the wrapped callback makes the branch's own value the response. The wrapper
        // resolves on BOTH outcomes so the err branch below - not an escaping rejection - still
        // decides what the route answers, which is what keeps both duplicate-username failures HTTP
        // 200. The inner `user` parameter deliberately shadows the outer one, exactly as baseline.
        return new Promise(function(resolve) {
          user.save(function(err, user) {
            resolve({ err : err, user : user });
          });
        })
        .then(function(saved) {
          var err  = saved.err
            , user = saved.user;

          if (err) {
            if (err.code === 11000) {
              return request.fail({
                message : "Sorry, that username is already taken. Please try another."
              });
            }

            return request.fail({
              message : "Something went wrong when trying to update your profile. Please try again."
            });
          }

          if (updateSlugs) {
            // Update folder slugs inline
            addFolderSlugJob = Folder.findByOwner(user)
              .then(function(folders) {
                return Promise.all(folders.map(function(folder) {
                  return folder.updateOwnerSlug(user.username);
                }));
              })
              // PRESERVED QUIRK - see docs/PRESERVED-QUIRKS.md. This catch SWALLOWS the failure and
              // recovers with Promise.resolve(), so a folder-slug failure never reaches the client.
              // The error log stays (it is this file's only one); do not surface, retry or await
              // around it. `addFolderSlugJob` IS awaited by the chain below, so it is genuinely
              // sequenced - the ordering is preserved exactly.
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

          return addFolderSlugJob
            .then(function() { return updateCoursesPromise; })
            .then(function() {
              return request.success({
                success : true,
                user    : user
              });
            });
        });
      }
    })
    // Preserved: the outer catch converts any rejection - not the resolved failure branches above -
    // into this HTTP 200 failure response with its byte-frozen message.
    .catch(function(err) {
      return request.fail({
        message : "Something went wrong when trying to update your profile. Please try again."
      });
    });
  },

  assetList : function(request, h) {
    // ⭐ PRESERVED QUIRK - see docs/PRESERVED-QUIRKS.md section 1.14 A. The `types` initializer below
    // is the mechanism of the SINGLE HTTP 500 in the 58-route baseline response corpus, at
    // GET /api/users/assets. The route validates `type` as Joi.string().OPTIONAL
    // (config/api_routes.js:L1230), so calling it with no query string leaves request.query.type
    // undefined and `.toLowerCase()` raises `TypeError: Cannot read properties of undefined (reading
    // 'toLowerCase')` synchronously, in this var initializer list, before the handler body runs. It
    // propagates to the single catch-all and becomes a 500 rendered as 50x.html.
    // ⛔ This expression must survive BYTE-IDENTICALLY. Writing (request.query.type || '') - or
    // adding any guard, default or required Joi rule - turns the 500 into a 200 and fails the corpus
    // gate, which expects exactly 25x200, 7x401, 25x404 and 1x500.
    // ⛔ The trailing `|| []` is dead code: .split(',') always returns an array, and the author meant
    // to guard the input instead. It is preserved too - removing it is exactly the cleanup R-1 bars.
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
      // Error-mapping preservation (R-5): returned, not thrown - see the note in `remove`.
      .catch(function(err) {
        return err;
      });
  },

  assetUpload : async function(request, h) {
    if (!config.features.assets) {
      // Error-mapping preservation (R-5): baseline reached the deleted synthetic `reply`'s isBoom
      // branch here, which answered a genuine 501 carrying this exact message. The Boom is RETURNED
      // rather than thrown, and that is load bearing: routeParser's single catch-all hands every
      // THROWN value to lib/http/errorMap.js#toResponse, which has no isBoom test, so throwing would
      // turn the measured 501 into a 500 AND scrub the message. Measured over real HTTP on
      // @hapi/hapi 21.4.10. A 4xx-class message is client-visible, so it stays byte-identical.
      return errors.notImplemented('Asset uploads are not enabled');
    }

    // Async conversion: baseline left this a BARE STATEMENT that relied on the deleted deferred
    // capture. The wrapper resolves on both outcomes so the branch below keeps the failure at HTTP
    // 200. Note the THREE-argument call: lib/util/file.js#uploadUserAsset accepts both this arity and
    // the four-argument replace form used by `replaceAsset`, and each site's arity is preserved.
    var upload = await new Promise(function(resolve) {
      FileUtil.uploadUserAsset(request.payload.file, request.user, function(err, file) {
        resolve({ err : err, file : file });
      });
    });

    // PRESERVED QUIRK - see docs/PRESERVED-QUIRKS.md. The error is the responder's FIRST argument, so
    // it lands in `json` and the response is still HTTP 200. Argument order preserved.
    if (upload.err) return request.fail(upload.err);
    return request.success({ file : upload.file });
  },

  replaceAsset : function(request, h) {
    if (!config.features.assets) {
      // Error-mapping preservation (R-5): the same genuine 501 as `assetUpload`, returned rather than
      // thrown for the same reason, with the same byte-identical message.
      return errors.notImplemented('Asset uploads are not enabled');
    }
    var origfile = request.pre.file;

    if (request.user.id.toString() === origfile._owner.toString()) {
      // The FOUR-argument replace form. Both arities are live in lib/util/file.js; this wrapper is
      // already awaited/returned at baseline and is left exactly as it is.
      return new Promise(function(resolve, reject) {
        FileUtil.uploadUserAsset(request.payload.file, request.user, origfile, function(err, file) {
          if (err) reject(err);
          else resolve(file);
        });
      })
        .then(function(file) {
          return request.success({ file : file });
        })
        // Error-mapping preservation (R-5): returned, not thrown - see the note in `remove`.
        .catch(function(err) {
          return err;
        });
    }
    else {
      // PRESERVED QUIRK - see docs/PRESERVED-QUIRKS.md, and the full note in `remove`. Undeclared
      // `Boom` raises a ReferenceError, so this answers a measured HTTP 500, never a 403.
      throw Boom.forbidden();
    }
  },

  removeAsset : function(request, h) {
    var file = request.pre.file;

    if (request.user.id.toString() === file._owner.toString()) {
      // The response IS the return value now: baseline left this chain a BARE STATEMENT and relied on
      // the deleted deferred capture, so the missing `return` is what has to be added.
      return file.hide()
        .then(function() {
          return request.success();
        })
        // Error-mapping preservation (R-5): returned, not thrown - see the note in `remove`.
        .catch(function(err) {
          return err;
        });
    }
    else {
      // PRESERVED QUIRK - see docs/PRESERVED-QUIRKS.md, and the full note in `remove`. Undeclared
      // `Boom` raises a ReferenceError, so this answers a measured HTTP 500, never a 403.
      throw Boom.forbidden();
    }
  },

  restoreAsset : function(request, h) {
    var file = request.pre.file;

    if (request.user.id.toString() === file._owner.toString()) {
      // The response IS the return value now - as in `removeAsset`, baseline left this chain bare.
      return file.show()
        .then(function() {
          return request.success();
        })
        // Error-mapping preservation (R-5): returned, not thrown - see the note in `remove`.
        .catch(function(err) {
          return err;
        });
    }
    else {
      // PRESERVED QUIRK - see docs/PRESERVED-QUIRKS.md, and the full note in `remove`. Undeclared
      // `Boom` raises a ReferenceError, so this answers a measured HTTP 500, never a 403.
      throw Boom.forbidden();
    }
  },

  assetUploadFromURL : async function(request, h) {
    if (!config.features.assets) {
      // Error-mapping preservation (R-5): the same genuine 501 as `assetUpload`, returned rather than
      // thrown for the same reason, with the same byte-identical message.
      return errors.notImplemented('Asset uploads are not enabled');
    }
    // try to validate url
    //
    // Dependency swap: the deprecated url-module parser becomes the NON-THROWING STATIC URL.parse().
    // NEVER the `new URL` constructor - it raises ERR_INVALID_URL on the relative, protocol-less and
    // empty inputs the legacy parser tolerated, turning this clean HTTP 200 failure into a 500.
    // PRESERVED QUIRK - see docs/PRESERVED-QUIRKS.md section 3.13. Two traps, both measured:
    //   (a) URL.parse() returns NULL where the legacy parser returned an object with a falsy
    //       `protocol`, so the null case has to reject IDENTICALLY - hence the extra `!requestUrl`
    //       arm. Deliberately parsed with NO base argument: this site's whole validation rule is
    //       "reject when there is no protocol", and a base would resolve relative inputs and start
    //       accepting them.
    //   (b) The check is NOT tightened to an http/https allow-list: 'javascript:alert(1)' HAS a
    //       protocol and is accepted today. That is baseline, and R-4 forbids repairing it.
    // Differential run over 'http://x.com', 'https://x.com', '//x.com', '/relative', 'x.com', '',
    // undefined and 'javascript:alert(1)': every verdict matches, and `url : Joi.string().required()`
    // (config/api_routes.js:L1294) makes the two empty inputs unreachable in any case.
    var requestUrl = URL.parse(request.payload.url);
    if (!requestUrl || !requestUrl.protocol) return request.fail();

    // Async conversion: baseline IGNORES tmp.tmpName's error argument, so the resolve-only wrapper
    // reproduces it exactly - a rejecting bridge would invent error handling the baseline never had.
    // tmp moves 0.0.25 -> 0.2.7; tmpName(cb) is unchanged and the call site is untouched.
    var tmpPath = await new Promise(function(resolve) {
      tmp.tmpName(function(err, generatedPath) {
        resolve(generatedPath);
      });
    });

    var contentType = '';
    var body;

    // Dependency swap: the dead `request` package becomes Node 22's built-in fetch. Everything the
    // baseline pipeline observed is preserved - a GET, the content-type response header captured into
    // `contentType`, and the body written to the tmp.tmpName path before the upload.
    // ⛔ No response.ok check: baseline never inspected the remote status code, so a 404 from the
    // remote host still produced an upload attempt.
    try {
      var response = await fetch(request.payload.url);
      // fetch's Headers.get() yields null for an absent header where the callback-era
      // response.headers['content-type'] yielded undefined. The distinction is kept because this value
      // becomes the uploaded asset's persisted `mime` field (TR6).
      var fetchedContentType = response.headers.get('content-type');
      contentType = fetchedContentType === null ? undefined : fetchedContentType;
      body = Buffer.from(await response.arrayBuffer());
    } catch (err) {
      // PRESERVED QUIRK - see docs/PRESERVED-QUIRKS.md. Baseline's .on('error') handler ONLY logged,
      // so a transfer failure left the request HANGING with no response at all. R-6 adjudication: the
      // hang is not reproducible once the deferred capture is gone, so it converges on the clean HTTP
      // 500 that the re-thrown error produces through the centralized error map. The log line is
      // preserved verbatim, and NO response is added here to "make the error path deliberate".
      console.log('on error:', err);
      throw err;
    }

    await fs.promises.writeFile(tmpPath, body);

    var fileupload = {
      path     : tmpPath,
      // PRESERVED QUIRK - the second trap of the url-parser migration recorded in
      // docs/PRESERVED-QUIRKS.md section 3.13, and specific to THIS call site because it is the only one
      // in the codebase that read `.path` rather than `.pathname`. The legacy parser's `.path` was
      // `pathname + search`, and a WHATWG URL has no `.path` at all, so the two are reconciled
      // explicitly here. Measured: for 'http://x.com/a/b.png?v=1' baseline produced 'b.png?v=1', QUERY
      // STRING AND ALL, and that value is PERSISTED as the asset's filename (TR6). Using
      // requestUrl.pathname alone would silently drop the query string from every stored filename, and
      // sanitizing the result would change it too.
      filename : path.basename(requestUrl.pathname + requestUrl.search),
      headers  : {
        'content-type' : contentType
      }
    };

    // Async conversion: the THREE-argument upload form, flattened. Resolving on both outcomes keeps
    // the failure below at HTTP 200.
    var upload = await new Promise(function(resolve) {
      FileUtil.uploadUserAsset(fileupload, request.user, function(err, file) {
        resolve({ err : err, file : file });
      });
    });

    // PRESERVED QUIRK - see docs/PRESERVED-QUIRKS.md. Error as the responder's FIRST argument; the
    // response is still HTTP 200. Argument order preserved.
    if (upload.err) return request.fail(upload.err);
    return request.success({ file : upload.file });
  },
  changePassword : async function(request, h) {
    if (request.payload.newPassword === request.payload.confirmPassword) {
      // Async conversion: baseline left this comparePassword callback a BARE STATEMENT and relied on
      // the deleted deferred capture. comparePassword remains an INSTANCE method with an
      // optional-callback bridge (lib/models/user.js), and bcrypt 5.1.1 -> 6.0.0 leaves both the
      // callback and the promise triad intact, so the call site is unchanged apart from the flatten.
      // Resolving on both outcomes keeps every one of the four failure messages an HTTP 200.
      var comparison = await new Promise(function(resolve) {
        request.user.comparePassword(request.payload.currentPassword, function(err, match) {
          resolve({ err : err, match : match });
        });
      });

      if (comparison.err) {
        return request.fail({
          message : "Something went wrong when trying to change your password. Please try again."
        });
      }

      if (comparison.match) {
        request.user.password = request.payload.newPassword;

        // Async conversion: the save callback is flattened for the same reason.
        var saveError = await new Promise(function(resolve) {
          request.user.save(function(err, user) {
            resolve(err);
          });
        });

        if (saveError) {
          return request.fail({
            message : "Something went wrong when trying to change your password. Please try again."
          });
        }

        return request.success({
          success : true
        });
      }
      else {
        return request.fail({
          message : "The password you entered did not match what we have stored. Please try again."
        });
      }
    }
    else {
      return request.fail({
        message : "Your new password entries did not match. Please try again."
      });
    }
  },

  getAvatar : function(request, h) {
    var avatar;

    if (request.pre.user) {
      avatar = request.pre.user.normalizeAvatar();

      return request.success({
        src : avatar
      });
    }
    else {
      // PRESERVED QUIRK - see docs/PRESERVED-QUIRKS.md, and the canonical note in `remove`. `Boom` is
      // an UNDECLARED identifier here (this module binds @hapi/boom as `errors`), so evaluating it
      // raises ReferenceError before .notFound is ever reached. Baseline status is therefore HTTP 500,
      // NOT 404, and R-5 freezes that: the bare identifier and its arguments stay byte-for-byte, no
      // `Boom` require is added, and nothing is rewritten to `errors.`.
      throw Boom.notFound();
    }
  },
  getInfo : function(request, h) {
    if (request.pre.user) {
      return request.success({
          username    : request.pre.user.username
        , avatar      : request.pre.user.normalizeAvatar()
        , email       : request.pre.user.email
        , displayName : request.pre.user.name
      });
    }
    else {
      // PRESERVED QUIRK - undeclared `Boom` => ReferenceError => HTTP 500, not 404. See `remove`.
      throw Boom.notFound();
    }
  },
  updateSettings : function(request, h) {
    return request.user.updateSettings(request.payload)
      .then(function(result) {
        return request.success({
          success : true
        });
      })
      .catch(function(err) {
        // Error-mapping preservation (R-5) - see the canonical note in `remove`: RETURNING the caught
        // value reproduces both of the synthetic reply's branches, the isBoom pass-through and the
        // plain-Error scrubbed 500.
        return err;
      });
  },
  sendEmailChange : async function(request, h) {
    if (!mailer.isConfigured()) {
      return request.fail({
        message: "Email is not configured. Email changes are not available."
      });
    }

    // Async conversion: baseline left this findByLogin callback a BARE STATEMENT and relied on the
    // deleted deferred capture to carry the response out. Resolving on both outcomes preserves the fact
    // that baseline inspects only `user` and IGNORES `err` entirely.
    var lookup = await new Promise(function(resolve) {
      User.findByLogin(request.payload.email, function(err, user) {
        resolve({ err : err, user : user });
      });
    });

    // if user found, send back error message
    if (lookup.user) {
      return request.fail({ message: 'Another account with that email address already exists.' });
    }

    // create random key and store new email with it
    // Async conversion: the INLINE crypto require form is preserved at all three randomBytes sites,
    // 48 bytes and the hex slice are frozen because the derived key is stored and emailed (TR6), and the
    // `ex` argument stays ignored exactly as baseline ignored it.
    var buf = await new Promise(function(resolve) {
      require('crypto').randomBytes(48, function(ex, generated) {
        resolve(generated);
      });
    });

    var email_key = buf.toString('hex').substring(0, 8); // send in email
    var user_key  = request.user.id.toString();

    var changeKey = Store.user.change_email_key(user_key);
    var changeVal = {
        key       : email_key
      , new_email : request.payload.email
    };

    // R-6 ADJUDICATION, measured and documented per docs/PRESERVED-QUIRKS.md: lib/util/store.js exports
    // `set` as `async function (key, val)` - ARITY 2 - so the third callback argument baseline passed
    // here was accepted and NEVER INVOKED. At baseline the confirmation email was therefore never sent
    // and this handler HUNG with no response. The hang is not reproducible once the deferred capture is
    // gone, so it converges on the HTTP 200 the author plainly intended. The IGNORED error is preserved:
    // a bare `await Store.set(...)` would turn a silent store failure into a 500 baseline never produced.
    try {
      await Store.set(changeKey, JSON.stringify(changeVal));
    } catch (storeError) {}

    send_email_confirmation(request, changeVal.new_email, changeVal.key);

    return request.success({
      success : true
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
      // Fire-and-forget, exactly as baseline: the confirmation send is NOT awaited and its outcome
      // never reaches the response.
      send_email_confirmation(request, changeVal.new_email, changeVal.key);

      // Async conversion: this responder was a bare statement and the deleted deferred capture carried
      // it out. With the deferral gone every code path has to return its response, or hapi 21 raises and
      // the catch-all answers 500.
      return request.success({
        success : true
      });
    } catch(err) {
      // Error-mapping preservation (R-5) - see the canonical note in `remove`.
      return err;
    }
  },
  changeEmail : async function(request, h) {
    // if no user, set next and redirect
    if (!request.user) {
      request.yar.set('next', '/change-email?key=' + request.query.key);
      // CALL-form redirect: the deleted builder's .redirect() RESOLVED, so this is a genuine working
      // redirect and becomes a raw toolkit redirect. Default 302 preserved - this file declares no
      // permanent-redirect override anywhere. The target stays RELATIVE (TR4).
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

    // Async conversion: recaptcha.verify's callback is NON-error-first - it is invoked as cb(result),
    // and on the test / no-secret path lib/util/recaptcha.js fires it SYNCHRONOUSLY. Resolving directly
    // into it preserves both properties, and the failure shape stays `{ status : false }` (key `status`,
    // NOT `success`), which is exactly why the check below reads falsy on a genuine failure.
    var recaptcha_result = await new Promise(function(resolve) {
      recaptcha.verify(request.payload['g-recaptcha-response'], resolve);
    });

    if (recaptcha_result.success) {
      // create random key and store
      // Async conversion: the INLINE crypto require form is preserved, 48 bytes and the 16-character
      // hex slice are frozen because the derived key is stored and emailed (TR6), and the `ex` argument
      // stays ignored exactly as baseline ignored it.
      var buf = await new Promise(function(resolve) {
        require('crypto').randomBytes(48, function(ex, generated) {
          resolve(generated);
        });
      });

      var email_key = buf.toString('hex').substring(0, 16); // send in email
      var user_key  = request.user.id.toString();
      var verifyKey = Store.user.verify_email_key(user_key);

      await Store.set(verifyKey, email_key);
      // ⭐ ORDERING IS BEHAVIOUR - see docs/PRESERVED-QUIRKS.md. This handler sends the verification
      // email BEFORE it responds, the exact opposite of `sendPassReset`, which responds first and only
      // then sends. Both orderings are frozen, and the send stays fire-and-forget.
      send_email_verification(request, request.user.email, email_key);

      // Async conversion: this responder was a bare statement carried out by the deleted deferral, so it
      // has to become the handler's return value.
      return request.success({
        success : true
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
      // CALL-form redirect => genuine working redirect => raw toolkit redirect, default 302, RELATIVE
      // target preserved (TR4).
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
    // PRESERVED: the `redirectTo` key is the responder's PER-CALL redirect override, honoured by
    // lib/http/responseContract.js before projection and without draining the flash. Both this payload
    // and the `{ invalid : true }` payloads below are frozen.
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

      // PRESERVED LATENT DEFECT - see docs/PRESERVED-QUIRKS.md: this is an id lookup fed an EMAIL
      // address. R-1 forbids latent-bug repair, so the call stays byte-identical and only its callback is
      // flattened - baseline left it a BARE STATEMENT and leaned on the deleted deferred capture.
      var lookup = await new Promise(function(resolve) {
        User.findById(activateVal.email, function(err, user) {
          resolve({ err : err, user : user });
        });
      });

      if (lookup.err || !lookup.user) {
        return request.fail({
          redirectTo : 'activate-account'
        });
      }

      var user = lookup.user;

      user.password = request.payload.password;

      // Async conversion: baseline IGNORES save's error argument here, so the resolve-only wrapper
      // reproduces that rather than inventing error handling the baseline never had.
      await new Promise(function(resolve) {
        user.save(function(err) {
          resolve();
        });
      });

      // Session order is behaviour (TR4): loggedInWith is set BEFORE _logIn, and _logIn's error argument
      // stays ignored exactly as baseline ignored it.
      request.yar.set('loggedInWith', 'trinket');
      await new Promise(function(resolve) {
        request.yar._logIn(user, function(err) {
          resolve();
        });
      });

      // R-6 ADJUDICATION: at baseline this Store.del was awaited inside an async callback that the
      // session plugin does not own, so a rejection became an unhandled rejection and the request HUNG.
      // Flattened, it reaches the outer catch and answers with the same `redirectTo : 'activate-account'`
      // failure every other error path already produces - a hang -> HTTP 200 convergence, documented in
      // docs/PRESERVED-QUIRKS.md rather than repaired.
      await Store.del(activateKey);
      request.yar.flash("info", "<strong>Thank you!</strong> Your account has been activated.");

      // Async conversion: the innermost responder was a bare statement carried out by the deleted
      // deferral, so it becomes the handler's return value.
      return request.success();
    } catch(err) {
      return request.fail({
        redirectTo : 'activate-account'
      });
    }
  },

  // Bulk export endpoints
  requestExport : function(request, h) {
    var userId = request.user.id;
    // PRESERVED QUIRK - see docs/PRESERVED-QUIRKS.md. The `{ handled : true }` SENTINEL REJECTION is
    // preserved verbatim: the two early branches build their response, then reject with the sentinel so
    // the remaining .then steps are skipped, and the tail .catch recognises the sentinel. Returning the
    // response from inside a .then instead would RESOLVE the chain and hand the response object to the
    // next step as `recentExport` / `saved`, corrupting everything downstream - so the already-built
    // response is carried out through this capture variable and returned from the tail catch. Both
    // branches are request.fail, which responds HTTP 200, never a 4xx.
    var earlyResponse;

    // Check for in-flight export
    return Export.findPendingOrProcessing(userId)
      .then(function(existingExport) {
        if (existingExport) {
          earlyResponse = request.fail({
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
          earlyResponse = request.fail({
            error: 'Please wait 1 hour between exports',
            lastExport: recentExport.created
          });
          return Promise.reject({ handled: true });
        }

        // Create export record
        var exportRecord = new Export({
          _owner: userId,
          status: 'pending'
        });

        return exportRecord.save();
      })
      .then(function(saved) {
        var exportRecord = saved;

        // Queue the job
        // PRESERVED: fire-and-forget. `exports` is the only live queue (the other nine are hard-disabled
        // null objects in lib/util/queues.js, now on bull 4.16.5), and .add() is deliberately NOT awaited.
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
        // Async conversion: the sentinel branch returned `undefined` at baseline and the deleted deferral
        // supplied the already-built response. With the deferral gone it has to be returned here.
        if (err && err.handled) return earlyResponse;
        console.log('Export request error:', err);
        return request.fail({ error: err.message || 'Failed to start export' });
      });
  },

  listExports : function(request, h) {
    var limit = request.query.limit || 10;

    // Async conversion: the whole chain was a BARE STATEMENT; every responder inside it was already
    // returned, so a single leading `return` is the entire fix.
    // PRESERVED: the `exp.expiresAt > new Date()` comparison and the `null` date fallbacks stay as they
    // are - ObjectUtils.serialize drops null-valued keys from the payload, and that is baseline (TR2).
    return Export.findByOwner(request.user)
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

  getExportStatus : async function(request, h) {
    // R-6 ADJUDICATION, documented in docs/PRESERVED-QUIRKS.md. Baseline shape: an outer try wrapping a
    // BARE Export.findById callback, so the handler returned undefined synchronously and the outer catch
    // could only ever observe a synchronous throw, plus an inner try inside the callback. BOTH structures
    // are preserved verbatim, INCLUDING the inner catch whose own undeclared `Boom` reference raises a
    // second ReferenceError. At baseline that second ReferenceError escaped inside a Mongoose callback
    // nobody owned and the request HUNG on the not-found and access-denied paths. The hang is not
    // reproducible once the deferred capture is gone: flattening puts every throw inside the async handler,
    // so it reaches the centralized error map and answers a clean HTTP 500. That hang -> 500 convergence
    // is unavoidable and accepted; the two try blocks are NOT merged and `Boom` is NOT declared.
    try {
      var userId = request.user.id;
      var exportId = request.params.exportId;

      // Async conversion: resolving on both outcomes preserves the fact that an `err` here answers HTTP
      // 200 through request.fail rather than raising.
      var lookup = await new Promise(function(resolve) {
        Export.findById(exportId, function(err, exportRecord) {
          resolve({ err : err, exportRecord : exportRecord });
        });
      });

      try {
        var err = lookup.err;
        var exportRecord = lookup.exportRecord;

        if (err) {
          return request.fail({ error: err.message });
        }

        if (!exportRecord) {
          // PRESERVED QUIRK - undeclared `Boom` => ReferenceError, caught by the inner catch below, whose
          // own `Boom` reference ReferenceErrors again. Baseline status is HTTP 500, NOT 404. See `remove`.
          throw Boom.notFound('Export not found');
        }

        if (exportRecord._owner.toString() !== userId) {
          // PRESERVED QUIRK - undeclared `Boom` => ReferenceError => HTTP 500, NOT 403. See `remove`.
          throw Boom.forbidden('Access denied');
        }

        var downloadAvailable = exportRecord.status === 'completed' &&
                                exportRecord.expiresAt &&
                                exportRecord.expiresAt > new Date();

        return request.success({
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
        });
      } catch (innerErr) {
        console.log('getExportStatus inner error:', innerErr.stack || innerErr);
        // PRESERVED QUIRK - the inner catch ITSELF references the undeclared `Boom`, so it raises a
        // second ReferenceError instead of responding. Preserved exactly; see the note at the top.
        throw Boom.internal('Export status error');
      }
    } catch (outerErr) {
      console.log('getExportStatus outer error:', outerErr.stack || outerErr);
      // PRESERVED QUIRK - undeclared `Boom` again => ReferenceError => HTTP 500 through the error map.
      throw Boom.internal('Export status error');
    }
  },

  downloadExport : async function(request, h) {
    var userId = request.user.id;
    var exportId = request.params.exportId;

    // Async conversion: baseline left this findById callback a BARE STATEMENT, so the handler resolved
    // undefined and the deleted deferred capture carried the redirect out. With the deferral gone the
    // callback MUST be flattened and the redirect MUST be returned, or the working 302 becomes a 500.
    // R-6 ADJUDICATION (docs/PRESERVED-QUIRKS.md): all four error branches below reference the undeclared
    // `Boom`, so at baseline each raised a ReferenceError inside an unowned Mongoose callback and the
    // request HUNG. Flattened, each reaches the centralized error map as a clean HTTP 500 - the same
    // unavoidable hang -> 500 convergence documented in getExportStatus.
    var lookup = await new Promise(function(resolve) {
      Export.findById(exportId, function(err, exportRecord) {
        resolve({ err : err, exportRecord : exportRecord });
      });
    });

    var exportRecord = lookup.exportRecord;

    if (lookup.err) {
      return request.fail({ error: lookup.err.message });
    }

    if (!exportRecord) {
      // PRESERVED QUIRK - undeclared `Boom` => ReferenceError => HTTP 500, NOT 404. See `remove`.
      throw Boom.notFound('Export not found');
    }

    if (exportRecord._owner.toString() !== userId) {
      // PRESERVED QUIRK - undeclared `Boom` => ReferenceError => HTTP 500, NOT 403. See `remove`.
      throw Boom.forbidden('Access denied');
    }

    if (exportRecord.status !== 'completed') {
      // PRESERVED QUIRK - undeclared `Boom` => ReferenceError => HTTP 500, NOT 400. See `remove`.
      throw Boom.badRequest('Export not ready');
    }

    if (!exportRecord.expiresAt || new Date() > exportRecord.expiresAt) {
      // PRESERVED QUIRK - undeclared `Boom` => ReferenceError => HTTP 500, NOT 400. See `remove`.
      throw Boom.badRequest('Export has expired');
    }

    // Generate fresh presigned URL
    // Dependency swap + R-6 adjudication: aws-sdk v2's client.getSignedUrl was SYNCHRONOUS and its result
    // was consumed synchronously right here. The v3 SDK has NO synchronous presigner, so config/aws.js
    // publishes getSignedDownloadUrl(params, seconds) as a PROMISE and this - the codebase's only
    // presigner - MUST await it. Bucket / Key stay byte-identical, and v2's `Expires: 3600` carries
    // through unchanged: config/aws.js forwards this second argument to the v3 presigner as its
    // expiry-seconds option, so the one-hour signature lifetime is frozen exactly as it was.
    var expiresIn = 3600;
    var downloadUrl = await aws.getSignedDownloadUrl({
      Bucket: config.aws.buckets.exports.name,
      Key: exportRecord.s3Key
    }, expiresIn);

    // CALL-form redirect => genuine working redirect => raw toolkit redirect, default 302 preserved.
    return h.redirect(downloadUrl);
  }
};

function send_email_confirmation(request, new_email, key) {
  var change_email_url = config.url + '/change-email?key=' + key;

  var message = nunjucks.render('emails/confirmEmailChange', {
    fullname         : request.user.fullname,
    username         : request.user.username,
    new_email        : new_email,
    change_email_url : change_email_url
  });
  mailer.send(new_email, 'Confirm new email address', { html : message, type : 'confirm-email-change' });
}

function send_email_verification(request, email, key) {
  var verify_email_url = config.url + '/verify-email?key=' + key;

  var message = nunjucks.render('emails/verifyEmail', {
    fullname         : request.user.fullname,
    username         : request.user.username,
    email            : email,
    verify_email_url : verify_email_url
  });
  mailer.send(email, 'Verify email address', { html : message, type : 'verify-email' });
}
