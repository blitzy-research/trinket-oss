var config       = require('config'),
    errors       = require('@hapi/boom'),
    NoResponse   = require('../http/responseContract').noResponse,
    Store        = require('../util/store'),
    emailStore   = Store.email(),
    mailer       = require('../util/mailer'),
    FileUtil     = require('../util/file'),
    nunjucks     = require('nunjucks'),
    // `mime`, `constants`, `StringUtils` and `crypto` below are unreferenced and stay declared.
    // (`crypto` is unreferenced because all three randomBytes sites use the inline require form.)
    mime         = require('mime'),
    _            = require('underscore'),
    path         = require('path'),
    fs           = require('fs'),
    // The remote-asset download in `assetUploadFromURL` is built on the two Node built-ins below
    // rather than on `fetch`, because `fetch` negotiates and transparently decodes compression, which
    // changes the bytes persisted and content-hashed for a compressing origin. It must also stream
    // rather than buffer, so an arbitrarily large remote object is never held in memory. See
    // downloadRemoteAsset() at the foot of this file for the full contract.
    http         = require('http'),
    https        = require('https'),
    tmp          = require('tmp'),
    util         = require('util'),
    StringUtils  = require('../util/stringUtils'),
    Folder       = require('../models/folder'),
    exportsQueue = require('../util/queues').exports(),
    Export       = require('../models/export'),
    aws          = require('../../config/aws'),
    roles        = require('../util/roles'),
    constants    = require('../../config/constants'),
    crypto       = require('crypto'),
    userUtil     = require('../util/user'),
    // The same-origin destination filter applied to the user-controlled `next` value in `create`
    // and `login` below. See lib/http/redirect.js and docs/PRESERVED-QUIRKS.md section 4.4.
    Redirect     = require('../http/redirect'),
    recaptcha    = require('../util/recaptcha');

module.exports = {
  // `Boom` is undeclared in this module: it binds @hapi/boom as `errors`, and `Boom` is neither a
  // Node global nor one of app.js's bare globals. Every `Boom.*` denial below therefore raises
  // ReferenceError and answers a scrubbed HTTP 500 - never a 403, 404 or 400. Keep the identifiers
  // as written; declaring `Boom`, or rerouting through `errors`, would change 15 responses.
  create : async function(request, h) {
    // recaptcha.verify's failure shape is { status : false } - key `status`, never `success` - so the
    // `.success` read below is falsy on a genuine failure by accident rather than by design.
    var recaptcha_result = await recaptcha.verify(request.payload['g-recaptcha-response']);

    if (!recaptcha_result.success) {
      return h.reject();
    }

    // Both halves of this destination are user-controlled: the session value comes from
    // `GET /signup?next=…`, and `payload.next` is a declared payload field a caller may supply even
    // though no shipped template renders it. It reaches the responder below as `redirectTo`, which
    // lib/http/redirect.js absolutizes into a Location header. Only a same-origin destination is
    // honoured - an in-application path and an absolute URL on one of this application's own origins
    // are both returned unchanged - while an off-origin or scheme-relative value takes the no-redirect
    // branch an absent `next` already took. See docs/PRESERVED-QUIRKS.md section 4.4.
    var payload  = request.payload,
        interest = request.payload.interest || 'python',
        redirect = Redirect.internalDestination(request.yar.get('next') || payload.next, request),
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
      // Resolves `{exists, duplicates, users}` and rejects with the mongoose error the surrounding
      // catch already handles. `exists` is pre-bound to its model, so no .call is needed.
      var existsResult = await User.exists(user);

      if (existsResult && existsResult.exists) {
        request.yar.flash('duplicates', existsResult.duplicates, true);
        return h.reject(json);
      }

      // Save user
      var savedUser = await user.save();

      request.yar.flash('requested', request.payload.username);

      // Log in the user
      // A synchronous decoration with no callback (see app.js), called directly so the session write
      // stays ordered ahead of the response.
      request.yar._logIn(savedUser);

      return redirect
        ? h.respond({ redirectTo : redirect, status : 'success', data : savedUser })
        : h.respond({ status : 'success', data : savedUser });

    } catch (err) {
      if (err.code === 11000) {
        request.yar.flash('duplicates', { username : true }, true);
        return h.reject(json);
      }
      return h.reject(json, err);
    }
  },

  login : async function(request, h) {
    console.log('LOGIN: Starting login for', request.payload.email);
    var requested = request.payload.email;
    var password = request.payload.password;
    // The session's `next` originates from the `GET /login?next=…` query string and is emitted
    // VERBATIM as a Location header at the toolkit redirect below. Every same-origin destination is
    // returned unchanged - an in-application path and an absolute URL on one of this application's own
    // origins alike, which is what test/baseline/responses.json#assignmentNext measures - and anything
    // that would leave the origin answers null, routing the handler into the SAME `else` branch an
    // absent `next` already took. See docs/PRESERVED-QUIRKS.md section 4.4.
    var redirect  = Redirect.internalDestination(request.yar.get('next'), request);
    var data;

    try {
      console.log('LOGIN: Finding user');
      // Find user by email or username
      // Both outcomes are captured rather than awaited bare, because the log line below fires on
      // EITHER arm with the same two values and must stay ahead of the re-raise.
      var found = await User.findByLogin(requested).then(
        function(user) { return { err : null, user : user }; },
        function(err)  { return { err : err }; }
      );

      console.log('LOGIN: findByLogin callback', found.err, found.user ? found.user.email : 'no user');
      if (found.err) throw found.err;

      var user = found.user;

      console.log('LOGIN: User found?', !!user);
      if (!user) {
        console.log('LOGIN: No user, failing');
        return h.reject({ message: 'Unknown user ' + requested });
      }

      if (user.hasRole && user.hasRole("disabled")) {
        return h.reject({ message: 'Account Disabled' });
      }

      if (!user.password || user.password.length === 0) {
        return h.reject({ message: 'A password was not found for this account.' });
      }

      console.log('LOGIN: Comparing password');
      // Verify password
      // Both outcomes are captured so the log line below fires on either arm, as it must; on the
      // error arm the match value is undefined.
      var compared = await user.comparePassword(password).then(
        function(match) { return { err : null, match : match }; },
        function(err)   { return { err : err }; }
      );

      console.log('LOGIN: comparePassword callback', compared.err, compared.match);
      if (compared.err) throw compared.err;

      var isMatch = compared.match;

      console.log('LOGIN: Password match?', isMatch);
      if (!isMatch) {
        return h.reject({ message: 'Invalid password' });
      }

      console.log('LOGIN: Success, resetting session');
      // Login successful - save data we want to preserve across session reset
      var educatorsFormData = request.yar.get("educatorsFormData") || null;
      var registrationPayload = request.yar.get("registration-payload") || null;

      // Generate a new session id for security (prevents session fixation)
      request.yar.reset();
      console.log('LOGIN: Session reset done');

      // Session data belongs to the NEW session, so it is written after the reset above.
      request.yar.set('loggedInWith', 'trinket');
      request.yar._logIn(user);
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
        // The raw toolkit redirect is used deliberately: this `next` target is emitted verbatim, while
        // the declared success.redirect for POST /login is absolutized by lib/http/redirect.js - which
        // is why the login flow emits an absolute target and GET /account a relative one. Do not
        // normalize either, and do not add a permanent-redirect override.
        return h.redirect(redirect);
      } else {
        // e.g. from an api call - set in route config
        //
        // The six keys, their order and roles.encrypt(user.roles) are frozen: do not simplify the
        // ternary, project it with ObjectUtils.pull, or add a `password : undefined`. The
        // `encryptRoles` pre declared in config/api_routes.js is this ternary's only consumer, and
        // roles.encrypt's client-shipped key is documented at docs/PRESERVED-QUIRKS.md section 1.9.
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

        return h.respond({
          status : 'success',
          data   : data
        });
      }
    } catch (err) {
      log.error('Login error:', err);
      // PRESERVED QUIRK: the error is the responder's FIRST argument, so it lands in the `json` slot
      // and the `err` slot stays undefined - the log line prints the inspected error followed by the
      // literal string "undefined". Do NOT pass an empty json first and the error second.
      //
      // The two routes bound to this handler answer DIFFERENTLY, and both fates are unchanged.
      // POST /login declares fail.redirect '/login', so the responder answers a genuine 302.
      // POST /api/users/login declares no fail block, so the responder reaches h.response(json), which
      // hapi refuses for an Error, and the raise escapes to the centralized error map as a scrubbed
      // 500. That is why this site is NOT routed through NoResponse.rejectOrAbandon, unlike the
      // orphaned sites in sendPassReset, assetUpload and assetUploadFromURL, whose raises could never
      // reach a response at all. See lib/http/responseContract.js.
      return h.reject(err);
    }
  },
  remove : async function(request, h) {
    if (request.user && request.user.username === request.query.username) {
      return request.user.remove()
        .then(function() {
          return h.respond();
        })
        .catch(function(err) {
          // Returned, never thrown: handlers run inside the route parser's wrapper, whose catch-all hands
          // every thrown value to lib/http/errorMap.js#toResponse, and that map has no isBoom test. A
          // returned Boom keeps its own status; a thrown one would become a scrubbed 500.
          return err;
        });
    }
    else {
      throw Boom.forbidden();
    }
  },
  deleted : async function(request, h) {
    // Two-argument flash: NOT persisted with yar's isOverride flag. Preserved.
    request.yar.flash('siteMessage', 'Your account has been deleted.');
    return h.redirect('/');
  },
  logout : async function(request, h) {
    if (request.yar) {
      // The clear-then-reset order is session behavior, not sequencing noise.
      request.yar.clear('userId');
      request.yar.reset();
    }
    // The response IS the return value now. GET /logout declares a top-level `redirect : '/'`
    // (config/routes.js:L65-L68) which the route parser hoists into success.redirect, so the
    // responder answers the declarative absolutized redirect. Without this `return` the handler
    // would resolve undefined and hapi would raise, turning the redirect into a 500.
    return h.respond();
  },

  sendPassReset : async function(request, h) {
    if (!mailer.isConfigured()) {
      // The failure responder answers HTTP 200 with a failure flash and never a 4xx. The
      // double-quoted message is client-visible and byte-frozen. See docs/PRESERVED-QUIRKS.md.
      return h.reject({
        message: "Email is not configured. Password reset is not available."
      });
    }

    var result = await recaptcha.verify(request.payload['g-recaptcha-response']);

    if (result.success) {
      // Both outcomes are captured so this branch - not an escaping rejection - decides what the
      // route answers, which is what keeps the two failure responses below HTTP 200 rather than 500.
      var lookup = await User.findByLogin(request.payload.email).then(
        function(user) { return { user : user }; },
        function(err)  { return { err : err }; }
      );

      // PRESERVED QUIRK: the error is the responder's FIRST argument, so it lands in `json`, and the
      // responder's default branch reaches h.response(json), which hapi refuses for an Error. This
      // branch therefore answers NOTHING; letting the raise propagate would invent a 500.
      // NoResponse.rejectOrAbandon reproduces that and stays transparent on every non-raising path, so
      // an html request on a route declaring fail.redirect still gets its 302. Argument order is
      // preserved either way. See lib/http/responseContract.js#rejectOrAbandon.
      if (lookup.err)   return NoResponse.rejectOrAbandon(h, lookup.err);
      if (!lookup.user) return h.reject({ message: 'user not found' });

      var user = lookup.user;

      // The INLINE crypto require form, the 48-byte length and the hex slice below are frozen: they
      // mint the password-reset token that is persisted in the store and emailed to the user, so any
      // change invalidates every in-flight token.
      var buf = await util.promisify(require('crypto').randomBytes)(48);

      var key      = buf.toString('hex').substring(0, 8);
      var resetKey = Store.user.reset_password_key(key);
      var resetVal = user.id.toString();

      // PRESERVED QUIRK: a rejection from either write answers NOTHING - no status line, no body -
      // so it is contained here rather than escaping and inventing a 500. A failure of the SECOND
      // write after the first succeeded answers the same way, which is why both share one guard.
      // See docs/PRESERVED-QUIRKS.md section 1.15.
      try {
        await Store.set(resetKey, resetVal);
        await Store.expire(resetKey, 86400);
      }
      catch (storeError) {
        return h.abandon;
      }

      // PRESERVED ORDER - see docs/PRESERVED-QUIRKS.md. Baseline calls the success responder HERE, then
      // composes and sends the email, and the response is only settled afterwards. The order is
      // behavioral twice over: returning that response immediately at this point would skip the
      // email entirely so that no user ever received a password reset, and responding first is also
      // what fixes the flash-drain timing, because the responder DRAINS the session flash store. The
      // built response is therefore captured and returned last.
      var response = h.respond();

      var reset_password_url = config.url + '/reset-pass?key=' + key;

      var message = nunjucks.render('emails/passwordReset', {
        fullname           : user.fullname,
        username           : user.username,
        reset_password_url : reset_password_url
      });
      // Fire-and-forget, deliberately un-awaited: the response above is returned without waiting for
      // SMTP. A reset-mail failure is not reported to the caller; the terminal catch only keeps an
      // unowned rejection from becoming a process-fatal fault under Node 22.
      mailer.send(user.email, 'Password reset', { html : message, type : 'password-reset' })
        .catch(function(mailError) {
          return mailError;
        });

      return response;
    }
    else {
      // PRESERVED QUIRK - see docs/PRESERVED-QUIRKS.md. A FAILED recaptcha answers the SUCCESS
      // responder, not the failure one: a 2013-era quirk clients may depend on. Do not "correct" it.
      return h.respond();
    }
  },

  resetPasswordForm : async function(request, h) {
    var resetKey = Store.user.reset_password_key(request.query.key);

    try {
      var user_id = await Store.get(resetKey);
      if (!user_id) return h.reject({ message: 'reset password key not found' });

      // Both outcomes are captured so this branch, rather than an escaping rejection, decides the
      // response. Omitting the model callback also sidesteps its double-invoke quirk, where a throw
      // inside the success arm reaches `.catch(cb)` and calls the callback a second time.
      var lookup = await User.findById(user_id).then(
        function(user) { return { user : user }; },
        function(err)  { return { err : err }; }
      );

      if (lookup.err)   return lookup.err;
      if (!lookup.user) return h.reject({ message: 'user not found' });

      return h.respond({
        key : request.query.key
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

      var lookup = await User.findById(user_id).then(
        function(user) { return { user : user }; },
        function(err)  { return { err : err }; }
      );

      if (lookup.err)   return lookup.err;
      if (!lookup.user) return h.reject({ message: 'user not found' });

      var user = lookup.user;

      user.password = request.payload.password;

      // The rejection is captured rather than allowed to escape, so the error branch below keeps
      // answering its own response; `null` is falsy for that guard exactly as `undefined` was.
      var saveError = await user.save().then(
        function() { return null; },
        function(err) { return err; }
      );

      if (saveError) return saveError;

      // PRESERVED QUIRK: a failure deleting the reset key answers NO RESPONSE, so it is contained
      // here rather than reaching the outer catch, whose 500 was never on the wire. Only the
      // client-visible half is reproduced - the raise is deliberately not re-thrown, so the process
      // survives. See docs/PRESERVED-QUIRKS.md section 1.15.
      try {
        await Store.del(resetKey);
      }
      catch (unownedCallbackError) {
        return h.abandon;
      }

      return h.respond();
    } catch(err) {
      return err;
    }
  },

  account : async function(request, h) {
    var data = {}
      , promise;

    if (!request.params.accountPage) {
      // This target stays relative - it is emitted verbatim rather than through the declarative
      // absolutization in lib/http/redirect.js, unlike the absolute target a successful login emits.
      return h.redirect('/account/profile');
    }

    if (request.params.accountPage === 'profile') {
      // .exec() rather than a bare Query, so the find runs EAGERLY here instead of waiting for the
      // .then() further down.
      promise = Course.findForUser(request.user.id).exec();
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

      return h.respond({
        page : request.params.accountPage,
        data : data
      });
    })
    // The tail catch swallows the error into an identical success response, so a failed course count
    // or pending-email lookup still renders the account page as though nothing went wrong.
    .catch(function(err) {
      return h.respond({
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
      throw Boom.forbidden();
    }

    if (user.avatar !== request.payload.avatar || user.name !== request.payload.name) {
      updateCourses = true;
    }

    if (user.username !== payload.username.toLowerCase()) {
      // Called HERE rather than inside a later .then so the lookup stays EAGER: the query is issued
      // before the `user.set(...)` below, and only awaited further down.
      usernameCheck = User.exists(user);

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
        return h.reject({
          message : "Sorry, that username is already taken. Please try another."
        });
      }
      else {
        // Both outcomes are captured so the err branch below - not an escaping rejection - decides
        // what the route answers, which is what keeps both duplicate-username failures HTTP 200.
        // `user` is absent on the error path, and the `user` binding below deliberately shadows the
        // outer one.
        return user.save().then(
          function(saved) { return { user : saved }; },
          function(err)   { return { err : err }; }
        )
        .then(function(saved) {
          var err  = saved.err
            , user = saved.user;

          if (err) {
            if (err.code === 11000) {
              return h.reject({
                message : "Sorry, that username is already taken. Please try another."
              });
            }

            return h.reject({
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
              // This catch swallows the failure and recovers with Promise.resolve(), so a folder-slug failure
              // never reaches the client. Keep the log line and do not surface or retry around it;
              // `addFolderSlugJob` is awaited by the chain below and that sequencing matters.
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
              return h.respond({
                success : true,
                user    : user
              });
            });
        });
      }
    })
    // The outer catch converts any rejection - not the resolved failure branches above - into this
    // HTTP 200 failure response, whose message is client-visible.
    .catch(function(err) {
      return h.reject({
        message : "Something went wrong when trying to update your profile. Please try again."
      });
    });
  },

  assetList : async function(request, h) {
    // PRESERVED QUIRK: the `types` initializer below is the mechanism of the single HTTP 500 in the
    // baseline response corpus, at GET /api/users/assets. `type` is validated as optional, so a call
    // with no query string leaves it undefined and `.toLowerCase()` raises synchronously in this
    // initializer list, before the handler body runs; the raise becomes a 500 rendered as 50x.html.
    // The expression must survive BYTE-IDENTICALLY: `(request.query.type || '')`, or any guard,
    // default or required Joi rule, turns that 500 into a 200 and fails the corpus gate. The trailing
    // `|| []` is unreachable - .split(',') always returns an array - and is preserved as well.
    // See docs/PRESERVED-QUIRKS.md section 1.14 A.
    var sortBy = request.query.sortBy || 'name'
      , types  = request.query.type.toLowerCase().split(',') || []
      , getUserFiles;

    if (request.user) {
      // .exec() as in `account`, so the find runs EAGERLY; its rejections still reach the tail
      // .catch below.
      getUserFiles = File.findForUser(request.user._id).exec();
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
        return h.respond({
          files : files
        });
      })
      .catch(function(err) {
        return err;
      });
  },

  assetUpload : async function(request, h) {
    if (!config.features.assets) {
      // Returned rather than thrown, which is load bearing: the route parser's single catch-all hands
      // every thrown value to lib/http/errorMap.js#toResponse, which has no isBoom test, so throwing
      // would turn this 501 into a 500 and scrub the message. hapi sends a 501's message to the client
      // unscrubbed, so the text stays byte-identical.
      return errors.notImplemented('Asset uploads are not enabled');
    }

    // Both outcomes are captured so the branch below keeps the failure at HTTP 200. Note the
    // TWO-argument call: uploadUserAsset accepts this arity and the three-argument replace form used
    // by `replaceAsset`, and each site's arity is preserved.
    var upload = await FileUtil.uploadUserAsset(request.payload.file, request.user).then(
      function(file) { return { file : file }; },
      function(err)  { return { err : err }; }
    );

    // PRESERVED QUIRK: the error is the responder's FIRST argument, so it lands in `json`, and
    // h.response() refuses to wrap an Error - this branch answers NOTHING.
    // NoResponse.rejectOrAbandon preserves that and stays transparent on every non-raising path.
    // Argument order preserved. See lib/http/responseContract.js#rejectOrAbandon.
    if (upload.err) return NoResponse.rejectOrAbandon(h, upload.err);
    return h.respond({ file : upload.file });
  },

  replaceAsset : async function(request, h) {
    if (!config.features.assets) {
      // The same 501 as `assetUpload`, returned rather than thrown for the same reason.
      return errors.notImplemented('Asset uploads are not enabled');
    }
    var origfile = request.pre.file;

    if (request.user.id.toString() === origfile._owner.toString()) {
      // The THREE-argument replace form. Both arities are live in lib/util/file.js, whose
      // `replaceFile != null` test treats the omitted third argument as "no replacement". Async
      // conversion: the promise-native method rejects precisely where the util.promisify bridge
      // rejected, so the tail .catch below is unchanged.
      return FileUtil.uploadUserAsset(request.payload.file, request.user, origfile)
        .then(function(file) {
          return h.respond({ file : file });
        })
        .catch(function(err) {
          return err;
        });
    }
    else {
      throw Boom.forbidden();
    }
  },

  removeAsset : async function(request, h) {
    var file = request.pre.file;

    if (request.user.id.toString() === file._owner.toString()) {
      return file.hide()
        .then(function() {
          return h.respond();
        })
        .catch(function(err) {
          return err;
        });
    }
    else {
      throw Boom.forbidden();
    }
  },

  restoreAsset : async function(request, h) {
    var file = request.pre.file;

    if (request.user.id.toString() === file._owner.toString()) {
      return file.show()
        .then(function() {
          return h.respond();
        })
        .catch(function(err) {
          return err;
        });
    }
    else {
      throw Boom.forbidden();
    }
  },

  assetUploadFromURL : async function(request, h) {
    if (!config.features.assets) {
      // The same 501 as `assetUpload`, returned rather than thrown for the same reason.
      return errors.notImplemented('Asset uploads are not enabled');
    }
    // try to validate url
    //
    // The non-throwing static URL.parse() is used deliberately: `new URL` raises ERR_INVALID_URL on
    // the relative, protocol-less and empty inputs the legacy parser tolerated, and URL.parse returns
    // null where that parser returned an object with a falsy protocol - hence the extra `!requestUrl`
    // arm. No base argument: the rule here is "reject when there is no protocol", and a base would
    // resolve relative inputs into acceptance. The protocol test is deliberately not narrowed to an
    // allow-list. See docs/PRESERVED-QUIRKS.md section 3.13.
    var requestUrl = URL.parse(request.payload.url);
    if (!requestUrl || !requestUrl.protocol) return h.reject();

    // tmpName rejects only when it cannot find an unused name inside its retry budget, which needs a
    // colliding /tmp it does not own.
    var tmpPath = await util.promisify(tmp.tmpName)();

    // downloadRemoteAsset() at the foot of this file carries the full contract: no compression
    // negotiation and no transparent decode, so the persisted, content-hashed bytes are the wire
    // bytes; backpressured streaming straight to `tmpPath`; redirects followed with a fixed budget and
    // a `referer` header; the final response's content-type captured; and NO status check, so a 404
    // body is still uploaded as the asset.
    var download = await downloadRemoteAsset(request.payload.url, tmpPath);

    // Base's `.on('error')` handler did nothing but log, and this is the verbatim line. It is
    // deliberately independent of the branch below, because the over-redirect outcome logged AND
    // went on to upload - see (b) in downloadRemoteAsset()'s contract - while a construction-time
    // failure threw before the listener existed and so logged nothing at all.
    if (download.logError) {
      console.log('on error:', download.logError);
    }

    if (!download.completed) {
      // PRESERVED QUIRK: the log line is the ENTIRE error handler, so a transfer failure - a DNS
      // failure, or a non-http scheme raising while the request is constructed - answers NOTHING AT
      // ALL. Re-throwing so the centralized error map answered a clean 500 would substitute a status
      // this branch never carried. The process-level half of the construction-error case is
      // deliberately not re-created, per the note in lib/controllers/folders.js.
      // See docs/PRESERVED-QUIRKS.md section 1.15.
      return h.abandon;
    }

    var contentType = download.contentType;

    var fileupload = {
      path     : tmpPath,
      // This is the only site that consumed the legacy parser's `.path`, which was pathname + search;
      // a WHATWG URL has no `.path`, so the two parts are recombined explicitly. The query string is
      // part of the persisted asset filename, so pathname alone would silently drop it.
      // See docs/PRESERVED-QUIRKS.md section 3.13.
      filename : path.basename(requestUrl.pathname + requestUrl.search),
      headers  : {
        'content-type' : contentType
      }
    };

    // The TWO-argument upload form, as in `assetUpload`.
    var upload = await FileUtil.uploadUserAsset(fileupload, request.user).then(
      function(file) { return { file : file }; },
      function(err)  { return { err : err }; }
    );

    // PRESERVED QUIRK: the error is the responder's FIRST argument, which makes h.response() refuse
    // to wrap it, so this branch answers NO response. Argument order preserved, and the non-raising
    // paths are untouched. See lib/http/responseContract.js#rejectOrAbandon.
    if (upload.err) return NoResponse.rejectOrAbandon(h, upload.err);
    return h.respond({ file : upload.file });
  },
  changePassword : async function(request, h) {
    if (request.payload.newPassword === request.payload.confirmPassword) {
      // Both outcomes are captured, which keeps every one of the four failure messages an HTTP 200
      // instead of promoting a compare failure to a 500.
      var comparison = await request.user.comparePassword(request.payload.currentPassword).then(
        function(match) { return { match : match }; },
        function(err)   { return { err : err }; }
      );

      if (comparison.err) {
        return h.reject({
          message : "Something went wrong when trying to change your password. Please try again."
        });
      }

      if (comparison.match) {
        request.user.password = request.payload.newPassword;

        // The rejection is captured rather than allowed to escape, for the same reason.
        var saveError = await request.user.save().then(
          function() { return null; },
          function(err) { return err; }
        );

        if (saveError) {
          return h.reject({
            message : "Something went wrong when trying to change your password. Please try again."
          });
        }

        return h.respond({
          success : true
        });
      }
      else {
        return h.reject({
          message : "The password you entered did not match what we have stored. Please try again."
        });
      }
    }
    else {
      return h.reject({
        message : "Your new password entries did not match. Please try again."
      });
    }
  },

  getAvatar : async function(request, h) {
    var avatar;

    if (request.pre.user) {
      avatar = request.pre.user.normalizeAvatar();

      return h.respond({
        src : avatar
      });
    }
    else {
      throw Boom.notFound();
    }
  },
  getInfo : async function(request, h) {
    if (request.pre.user) {
      return h.respond({
          username    : request.pre.user.username
        , avatar      : request.pre.user.normalizeAvatar()
        , email       : request.pre.user.email
        , displayName : request.pre.user.name
      });
    }
    else {
      throw Boom.notFound();
    }
  },
  updateSettings : async function(request, h) {
    return request.user.updateSettings(request.payload)
      .then(function(result) {
        return h.respond({
          success : true
        });
      })
      .catch(function(err) {
        return err;
      });
  },
  sendEmailChange : async function(request, h) {
    if (!mailer.isConfigured()) {
      return h.reject({
        message: "Email is not configured. Email changes are not available."
      });
    }

    // Only `user` is inspected: `lookup.err` is deliberately never read, so a lookup failure falls
    // through to the store write below.
    var lookup = await User.findByLogin(request.payload.email).then(
      function(user) { return { user : user }; },
      function(err)  { return { err : err }; }
    );

    // if user found, send back error message
    if (lookup.user) {
      return h.reject({ message: 'Another account with that email address already exists.' });
    }

    // create random key and store new email with it
    // The INLINE crypto require form is preserved at all three randomBytes sites, and 48 bytes plus
    // the hex slice are frozen because the derived key is stored and emailed.
    var buf = await util.promisify(require('crypto').randomBytes)(48);

    var email_key = buf.toString('hex').substring(0, 8); // send in email
    var user_key  = request.user.id.toString();

    var changeKey = Store.user.change_email_key(user_key);
    var changeVal = {
        key       : email_key
      , new_email : request.payload.email
    };

    // PRESERVED QUIRK: `lib/util/store.js#set` has ARITY 2, so nothing depending on a completion
    // callback here ever runs. This route sends NO confirmation email and answers NOTHING, and both
    // halves are preserved - a client that has never received this email cannot be sent one now. The
    // store write itself still happens; its rejection is OWNED and discarded rather than left
    // floating, because an unowned rejection is a process-level effect this migration does not
    // re-create. See docs/PRESERVED-QUIRKS.md sections 1.15 and 3.20.
    Store.set(changeKey, JSON.stringify(changeVal)).catch(function(storeError) {
      return storeError;
    });

    return h.abandon;
  },
  resendEmailChange : async function(request, h) {
    if (!mailer.isConfigured()) {
      return h.reject({
        message: "Email is not configured. Email changes are not available."
      });
    }

    var user_key  = request.user.id.toString()
      , changeKey = Store.user.change_email_key(user_key);

    try {
      var changeVal = await Store.get(changeKey);
      if (!changeVal) return h.reject({ message: 'change email key not found' });

      changeVal = JSON.parse(changeVal);
      // Fire-and-forget: the confirmation send is not awaited and its outcome never reaches the
      // response.
      send_email_confirmation(request, changeVal.new_email, changeVal.key);

      // Every code path has to return its response, or the centralized error map answers 500.
      return h.respond({
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
      // A raw toolkit redirect: default 302, and the target stays relative.
      return h.redirect('/login');
    }

    var user_key  = request.user.id.toString()
      , changeKey = Store.user.change_email_key(user_key);

    try {
      var changeVal = await Store.get(changeKey);
      if (!changeVal) {
        request.yar.flash('email_result', 'error', true);
        return h.reject();
      }

      changeVal = JSON.parse(changeVal);

      if (changeVal.key !== request.query.key.toLowerCase()) {
        request.yar.flash('email_result', 'key_error', true);
        return h.reject();
      }

      request.user.email = changeVal.new_email;

      // since user must've received the change email
      // it is safe to also verify them
      request.user.verified = true;

      await Store.del(changeKey);
      await request.user.save();
      request.yar.flash('email_result', 'success', true);
      return h.respond();
    } catch(err) {
      if (err.code === 11000) {
        request.yar.flash('email_result', 'duplicate', true);
      }
      else {
        request.yar.flash('email_result', 'error', true);
      }

      return h.reject();
    }
  },
  sendEmailVerification : async function(request, h) {
    if (!mailer.isConfigured()) {
      return h.reject({
        message: "Email is not configured. Email verification is not available."
      });
    }

    // recaptcha.verify resolves the result object; on the test / no-secret path it is an
    // already-resolved promise, so no network work happens here.
    var recaptcha_result = await recaptcha.verify(request.payload['g-recaptcha-response']);

    if (recaptcha_result.success) {
      // create random key and store
      // The INLINE crypto require form is preserved, and 48 bytes plus the 16-character hex slice are
      // frozen because the derived key is stored and emailed.
      var buf = await util.promisify(require('crypto').randomBytes)(48);

      var email_key = buf.toString('hex').substring(0, 16); // send in email
      var user_key  = request.user.id.toString();
      var verifyKey = Store.user.verify_email_key(user_key);

      // PRESERVED QUIRK, as in sendPassReset: a rejection from this write answers NOTHING - neither
      // the send below nor the responder runs - rather than a 500.
      try {
        await Store.set(verifyKey, email_key);
      }
      catch (storeError) {
        return h.abandon;
      }

      // ORDERING IS BEHAVIOUR: this handler sends the verification email BEFORE it responds, the
      // exact opposite of `sendPassReset`, which responds first. Both orderings are frozen, and the
      // send stays fire-and-forget. See docs/PRESERVED-QUIRKS.md.
      send_email_verification(request, request.user.email, email_key);

      return h.respond({
        success : true
      });
    }
    else {
      return h.reject();
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
        return h.reject();
      }

      if (verifyVal !== request.query.key) {
        request.yar.flash('email_result', 'key_error', true);
        return h.reject();
      }

      request.user.verified = true;

      await Store.del(verifyKey);
      await request.user.save();
      request.yar.flash('email_result', 'verified', true);
      return h.respond();
    } catch(err) {
      request.yar.flash('email_result', 'verify_error', true);
      return h.reject();
    }
  },
  activateAccountForm : async function(request, h) {
    // `redirectTo` is the responder's per-call redirect override, honoured by
    // lib/http/responseContract.js before projection and without draining the flash.
    if (request.user) {
      return h.reject({
        redirectTo : 'home'
      });
    }

    var activateKey = Store.user.activate_account_key(request.query.key);

    try {
      var activateVal = await Store.get(activateKey);
      if (!activateVal) {
        return h.respond({
          invalid : true
        });
      }

      activateVal = JSON.parse(activateVal);
      return h.respond({
          key   : request.query.key
        , email : activateVal.email
      });
    } catch(err) {
      return h.respond({
        invalid : true
      });
    }
  },
  activateAccount : async function(request, h) {
    if (request.user) {
      return h.reject({
        redirectTo : 'home'
      });
    }

    var activateKey = Store.user.activate_account_key(request.payload.key);

    try {
      var activateVal = await Store.get(activateKey);
      if (!activateVal) {
        return h.reject({
          redirectTo : 'activate-account'
        });
      }

      // update password, login user
      activateVal = JSON.parse(activateVal);

      // PRESERVED LATENT DEFECT: this is an id lookup fed an EMAIL address. The lookup stays
      // byte-identical, and both outcomes are captured because the guard below reads BOTH `err` and
      // `user`. See docs/PRESERVED-QUIRKS.md.
      var lookup = await User.findById(activateVal.email).then(
        function(user) { return { user : user }; },
        function(err)  { return { err : err }; }
      );

      if (lookup.err || !lookup.user) {
        return h.reject({
          redirectTo : 'activate-account'
        });
      }

      var user = lookup.user;

      user.password = request.payload.password;

      // The save rejection is SWALLOWED, not surfaced: this handler carries on to the login either
      // way, and a bare `await user.save()` would invent an error path it never had.
      await user.save().catch(function() {});

      // Session order is behaviour: loggedInWith is set BEFORE _logIn.
      request.yar._logIn(user);

      // PRESERVED QUIRK: a failure deleting the activation key answers NOTHING, so it is caught HERE
      // rather than reaching the handler's outer catch, which answers HTTP 200 with
      // `redirectTo : 'activate-account'` - a payload this branch never produced, and one that would
      // tell a user whose account WAS activated to activate it again.
      // See docs/PRESERVED-QUIRKS.md section 1.15.
      try {
        await Store.del(activateKey);
      }
      catch (delError) {
        return h.abandon;
      }

      request.yar.flash("info", "<strong>Thank you!</strong> Your account has been activated.");

      return h.respond();
    } catch(err) {
      return h.reject({
        redirectTo : 'activate-account'
      });
    }
  },

  // Bulk export endpoints
  requestExport : async function(request, h) {
    var userId = request.user.id;
    // The `{ handled : true }` sentinel rejection is load bearing: the two early branches build their
    // response, reject with the sentinel to skip the remaining .then steps, and the tail .catch
    // recognises it. Returning the response from inside a .then would resolve the chain and hand the
    // response object to the next step as `recentExport` / `saved`, so it travels in this variable
    // instead. Both branches are h.reject, which answers HTTP 200.
    var earlyResponse;

    // Check for in-flight export
    return Export.findPendingOrProcessing(userId)
      .then(function(existingExport) {
        if (existingExport) {
          earlyResponse = h.reject({
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
          earlyResponse = h.reject({
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
        // Fire-and-forget: `exports` is the only live queue - the other nine are hard-disabled null
        // objects in lib/util/queues.js - and .add() is deliberately not awaited. Awaiting it would put
        // the 200 below behind a Redis round trip, and a queue failure would then change this route's
        // status; neither is this handler's contract.
        //
        // The terminal catch is OWNERSHIP only: add() returns a promise, and an unowned rejection is
        // process-fatal under Node 22. It is empty because the response, the persisted
        // `status: 'pending'` record and the message below must stay exactly as they are - a queue
        // failure leaves the export pending forever.
        exportsQueue.add({
          action: 'bulk-export',
          exportId: exportRecord._id.toString(),
          userId: userId
        }).catch(function(queueError) {
          return queueError;
        });

        return h.respond({
          success: true,
          data: {
            exportId: exportRecord._id,
            status: 'pending',
            message: 'Export started. You will receive an email when ready.'
          }
        });
      })
      .catch(function(err) {
        if (err && err.handled) return earlyResponse;
        console.log('Export request error:', err);
        return h.reject({ error: err.message || 'Failed to start export' });
      });
  },

  listExports : async function(request, h) {
    var limit = request.query.limit || 10;

    // The `exp.expiresAt > new Date()` comparison and the `null` date fallbacks stay as they are:
    // ObjectUtils.serialize drops null-valued keys from the payload.
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
        return h.respond({ success: true, data: data });
      })
      .catch(function(err) {
        return h.reject({ error: err.message });
      });
  },

  getExportStatus : async function(request, h) {
    // The two try blocks are deliberately NOT merged, and `Boom` is NOT declared - so the not-found
    // and access-denied guards below raise a ReferenceError rather than answering the status they
    // name. Where that leads is settled at the inner catch. The outer catch stays in place and is
    // unreachable on this path. See docs/PRESERVED-QUIRKS.md section 1.15.
    try {
      var userId = request.user.id;
      var exportId = request.params.exportId;

      // Both outcomes are captured, because an `err` here answers HTTP 200 through the failure
      // responder rather than raising.
      var lookup = await Export.findById(exportId).then(
        function(exportRecord) { return { exportRecord : exportRecord }; },
        function(err)          { return { err : err }; }
      );

      try {
        var err = lookup.err;
        var exportRecord = lookup.exportRecord;

        if (err) {
          return h.reject({ error: err.message });
        }

        if (!exportRecord) {
          throw Boom.notFound('Export not found');
        }

        if (exportRecord._owner.toString() !== userId) {
          throw Boom.forbidden('Access denied');
        }

        var downloadAvailable = exportRecord.status === 'completed' &&
                                exportRecord.expiresAt &&
                                exportRecord.expiresAt > new Date();

        return h.respond({
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
        // PRESERVED QUIRK: the inner catch ITSELF references the undeclared `Boom`, so it raises a
        // SECOND ReferenceError instead of responding. The raising line is kept verbatim and the
        // raise is CONTAINED, because this path answers NO RESPONSE with EXACTLY ONE log line - the
        // inner one above. Letting it propagate would break parity twice: a scrubbed 500 this path
        // never produced, and a second log line that never existed.
        // See docs/PRESERVED-QUIRKS.md section 1.15.
        try {
          throw Boom.internal('Export status error');
        }
        catch (noSuchBoom) {
          return h.abandon;
        }
      }
    } catch (outerErr) {
      console.log('getExportStatus outer error:', outerErr.stack || outerErr);

      // PRESERVED QUIRK - undeclared `Boom` again, so this catch could not respond either and the
      // synchronous-throw path produced NO RESPONSE. Contained for the same reason as above.
      try {
        throw Boom.internal('Export status error');
      }
      catch (boomReferenceError) {
        return h.abandon;
      }
    }
  },

  downloadExport : async function(request, h) {
    var userId = request.user.id;
    var exportId = request.params.exportId;

    // PRESERVED QUIRK: all four denials below reference the undeclared `Boom`, so each raises a
    // ReferenceError and the request answers NOTHING - not a 404, not a 403, not a 400, and not a 500.
    // The single try/catch container below preserves those four fates while keeping every
    // `throw Boom.x(...)` statement byte-for-byte, and one container rather than four per-branch
    // wrappers is deliberate: it also contains the `_owner`-less record's TypeError, which answers
    // the same way. The redirect further down must be RETURNED, or its working 302 becomes a 500.
    // `lookup.err` is read below and answers HTTP 200 through the failure responder.
    // See docs/PRESERVED-QUIRKS.md.
    var lookup = await Export.findById(exportId).then(
      function(exportRecord) { return { exportRecord : exportRecord }; },
      function(err)          { return { err : err }; }
    );

    var exportRecord = lookup.exportRecord;

    // The ONLY branch of this handler that ever answered an error: `h.reject` sets no status, so a
    // lookup error is an HTTP 200 carrying a failure flash. Deliberately outside the guard below.
    if (lookup.err) {
      return h.reject({ error: lookup.err.message });
    }

    // PRESERVED QUIRK: all four guards below reference the undeclared `Boom`, so none has ever
    // produced the status it names - each raises a ReferenceError the moment `Boom.` is evaluated,
    // and the request answers NOTHING AT ALL, with nothing logged. Every raising line is kept
    // VERBATIM and the four share ONE container, which also catches a `_owner`-less record's
    // TypeError because it answers the same way. The process-level half is deliberately not
    // re-created, per the note in lib/controllers/folders.js.
    // See docs/PRESERVED-QUIRKS.md section 1.15.
    try {
      if (!exportRecord) {
        throw Boom.notFound('Export not found');
      }

      if (exportRecord._owner.toString() !== userId) {
        throw Boom.forbidden('Access denied');
      }

      if (exportRecord.status !== 'completed') {
        throw Boom.badRequest('Export not ready');
      }

      if (!exportRecord.expiresAt || new Date() > exportRecord.expiresAt) {
        throw Boom.badRequest('Export has expired');
      }
    }
    catch (noSuchBoom) {
      return h.abandon;
    }

    // Generate fresh presigned URL
    // getSignedDownloadUrl is a PROMISE - the v3 SDK has no synchronous presigner - so this, the
    // codebase's only presigning call site, must await it. Bucket, Key and the 3600-second expiry are
    // byte-identical, config/aws.js forwarding the second argument as the presigner's expiry option.
    //
    // PRESERVED QUIRK: the SUCCESS path of this route is DEAD. No configuration file declares
    // `config.aws.buckets.exports`, so reading `.name` off `undefined` raises a TypeError while this
    // argument object is being built, on EVERY call, and the request answers NOTHING. The try below is
    // what preserves that: letting the identical TypeError escape would hand it to lib/http/errorMap.js
    // and invent a 500. Declaring an `exports` bucket would turn a permanently dead route into a live
    // one. A presigner rejection is caught by the same guard, which is faithful - a throw here hung
    // too. See docs/PRESERVED-QUIRKS.md.
    var expiresIn = 3600;
    var downloadUrl;
    try {
      downloadUrl = await aws.getSignedDownloadUrl({
        Bucket: config.aws.buckets.exports.name,
        Key: exportRecord.s3Key
      }, expiresIn);
    }
    catch (presignError) {
      return h.abandon;
    }

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
  // Both helpers stay synchronous and both sends stay un-awaited: their callers invoke them for the
  // side effect and answer without waiting, so making either async would move the response behind
  // SMTP. The terminal catch only keeps an unowned rejection from becoming process-fatal under Node
  // 22, and reports nothing.
  mailer.send(new_email, 'Confirm new email address', { html : message, type : 'confirm-email-change' })
    .catch(function(mailError) {
      return mailError;
    });
}

function send_email_verification(request, email, key) {
  var verify_email_url = config.url + '/verify-email?key=' + key;

  var message = nunjucks.render('emails/verifyEmail', {
    fullname         : request.user.fullname,
    username         : request.user.username,
    email            : email,
    verify_email_url : verify_email_url
  });
  // Un-awaited and owned, for the reason given on send_email_confirmation above.
  mailer.send(email, 'Verify email address', { html : message, type : 'verify-email' })
    .catch(function(mailError) {
      return mailError;
    });
}

/**
 * The exact redirect budget `request@2.88.2` applied to a GET: `maxRedirects` defaults to 10, and
 * the eleventh 3xx raises instead of being followed (node_modules/request/lib/redirect.js).
 */
var LEGACY_MAX_REDIRECTS = 10;

/**
 * The only two protocols the dead `request` package could dispatch. Anything else raised
 * `Invalid protocol: <scheme>` from inside its constructor, which is a different observable
 * outcome from a transfer error - see downloadRemoteAsset().
 */
var LEGACY_HTTP_MODULES = {
    'http:'  : http
  , 'https:' : https
};

/**
 * Streams a remote asset to `destPath` and reports which of three observable outcomes occurred.
 *
 * NOT built on `fetch`, for two independent reasons:
 *
 *   1. PERSISTED-BYTE PARITY. `fetch` sends `accept-encoding: gzip, deflate` and transparently
 *      decodes the response, and undici does so on the response's own header regardless of
 *      negotiation or consumption style, with no way to suppress it. These bytes are content-hashed
 *      by `FileUtil.uploadUserAsset` into the S3 object Key and ARE the stored asset, so for an
 *      origin that returns `content-encoding: gzip` decoding them would change both the key and the
 *      object. This pipeline sends no `accept-encoding` at all and writes the wire bytes.
 *   2. BACKPRESSURE. `response.pipe(writeStream)` keeps an arbitrarily large remote object out of
 *      memory. NO size cap and NO status check are added, because there were none.
 *
 * THE THREE OUTCOMES, and why the return value has this shape:
 *
 *   (a) The response ended. `completed: true`, `logError: null`. The content-type is captured from
 *       the FINAL response only, and that response's body is written whatever its status code was,
 *       so a 404 body is uploaded as the asset.
 *   (b) More than `LEGACY_MAX_REDIRECTS` redirects. `completed: true` AND `logError` set - which is
 *       why `logError` is independent of `completed`. The error is reported and the transfer still
 *       ends, with a ZERO-BYTE file on disk, because the offending response's body has already been
 *       drained by the `resume()` that precedes the counter check. The upload therefore still runs
 *       and the request still answers HTTP 200.
 *   (c) A transfer error, or a construction error. `completed: false`. They differ ONLY in whether
 *       anything was logged, which is why `logError` is `null` for the second:
 *         - a transfer error - DNS failure, socket hang up, an unusable redirect target - is logged
 *           and nothing else happens.
 *         - a construction error - an unparseable URL, a URL with no host, or a non-http(s) scheme,
 *           all reachable because this route's only URL rule is "has a protocol" - raises before any
 *           listener exists, so NOTHING is logged.
 *       Neither case answers the request: see docs/PRESERVED-QUIRKS.md section 1.15.
 *
 * Two further wire details matter because an origin can vary its response on them, which would
 * change the persisted bytes: the `referer` header is set to the previous URL on every redirect hop,
 * and userinfo in the URL becomes an `Authorization: Basic` header.
 *
 * The one deliberate divergence: the write stream is closed on the error paths rather than leaked.
 * Those paths never answer, so it is not observable on the wire. The temp file is left on disk.
 *
 * @param   {string} remoteUrl - the user-supplied URL, unsanitized
 * @param   {string} destPath  - the `tmp.tmpName()` path the bytes are streamed to
 * @returns {Promise<{completed: boolean, logError: (Error|null), contentType: (string|undefined)}>}
 *          Never rejects: every outcome above is reported through the resolved value.
 */
function downloadRemoteAsset(remoteUrl, destPath) {
  return new Promise(function(resolve) {
    // Base's own two construction-time guards, in its order: the URI must have a host
    // (request.js checks `!(uri.host || (uri.hostname && uri.port))`), and the scheme must be one
    // it can dispatch. Neither logged anything, so `logError` stays null for both.
    var initial = URL.parse(remoteUrl);

    if (!initial || !initial.host || !LEGACY_HTTP_MODULES[initial.protocol]) {
      return resolve({ completed : false, logError : null, contentType : '' });
    }

    // Created here rather than at the first response so that the file exists on the error paths
    // exactly as base's `.pipe(fs.createWriteStream(...))` created it before any bytes arrived.
    var out               = fs.createWriteStream(destPath);
    var redirectsFollowed = 0;
    var referer           = null;
    // Base initialized its captured content type to the empty string and only ever assigned it
    // from a `response` event, so an outcome with no response reports '' and an outcome whose
    // response carried no `content-type` header reports `undefined`. Both are preserved, because
    // this value becomes the uploaded asset's persisted content type.
    var contentType       = '';
    var settled           = false;

    function settle(result) {
      if (settled) {
        return;
      }
      settled = true;
      resolve(result);
    }

    function transferError(err) {
      out.destroy();
      settle({ completed : false, logError : err, contentType : contentType });
    }

    out.on('error', transferError);

    function attempt(target) {
      var parsed     = URL.parse(target);
      var httpModule = parsed && LEGACY_HTTP_MODULES[parsed.protocol];

      // Only reachable for a redirect target, and base reported it through its `error` handler
      // (its listener is attached by then), so unlike the initial guards above this one logs.
      if (!parsed || !parsed.host || !httpModule) {
        return transferError(new Error('Invalid URI "' + target + '"'));
      }

      var options = { headers : {} };

      if (referer !== null) {
        options.headers.referer = referer;
      }

      var req = httpModule.get(target, options, function(response) {
        var location = response.headers.location;

        if (response.statusCode >= 300 && response.statusCode < 400 && location !== undefined) {
          // Base drained the redirect body BEFORE testing the counter, which is precisely why the
          // over-budget outcome leaves a zero-byte file behind.
          response.resume();

          if (redirectsFollowed >= LEGACY_MAX_REDIRECTS) {
            contentType = response.headers['content-type'];
            out.end();
            return settle({
                completed   : true
              , logError    : new Error('Exceeded maxRedirects. Probably stuck in a redirect loop ' + target)
              , contentType : contentType
            });
          }

          redirectsFollowed += 1;
          referer = target;

          var next = URL.parse(location, target);

          if (!next) {
            return transferError(new Error('Invalid URI "' + location + '"'));
          }

          return attempt(next.href);
        }

        contentType = response.headers['content-type'];

        response.on('error', transferError);
        out.on('finish', function() {
          settle({ completed : true, logError : null, contentType : contentType });
        });

        response.pipe(out);
      });

      req.on('error', transferError);
    }

    attempt(initial.href);
  });
}
