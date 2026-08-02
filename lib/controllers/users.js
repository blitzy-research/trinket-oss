var config       = require('config'),
    errors       = require('@hapi/boom'),
    Pending      = require('../http/pending'),
    Store        = require('../util/store'),
    emailStore   = Store.email(),
    mailer       = require('../util/mailer'),
    FileUtil     = require('../util/file'),
    nunjucks     = require('nunjucks'),
    // Dependency swap: the deprecated url module's last consumer in this file was the
    // url.parse() call in assetUploadFromURL, which is now the non-throwing static
    // URL.parse(). The require is therefore gone rather than left dangling. The
    // baseline-dead `mime`, `constants`, `StringUtils` and `crypto` requires below are
    // NOT touched - each was already unreferenced at the base commit, so removing them
    // would be the opportunistic cleanup R-1 bars. (`crypto` is dead because all three
    // randomBytes sites use the inline require form, which is preserved.)
    mime         = require('mime'),
    _            = require('underscore'),
    path         = require('path'),
    fs           = require('fs'),
    // Async conversion (review finding SEC-2, CWE-400) - the baseline pipeline in
    // `assetUploadFromURL` streamed the remote body straight to disk with
    // `.pipe(fs.createWriteStream(tmpPath))` and never held it in memory, so the replacement has to
    // stream too rather than buffer the body.
    //
    // Dependency swap: the dead `request` package's only streaming consumer in this file is the
    // remote-asset download in `assetUploadFromURL`. It is rebuilt on the two Node built-ins below
    // rather than on `fetch`, because `fetch` negotiates and transparently decodes compression -
    // which changes the bytes persisted and content-hashed for a compressing origin. See
    // downloadRemoteAsset() at the foot of this file for the measured parity contract; it pipes
    // `httpModule.get(...)`'s response straight into `fs.createWriteStream(tmpPath)`, so no
    // stream adapter is needed.
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
    // SECURITY REMEDIATION (review finding SEC-4) - the same-origin destination
    // filter applied to the user-controlled `next` value in `create` and `login`
    // below. See lib/http/redirect.js and docs/PRESERVED-QUIRKS.md section 4.4.
    Redirect     = require('../http/redirect'),
    recaptcha    = require('../util/recaptcha');

module.exports = {
  // `Boom` is undeclared in this module: it binds @hapi/boom as `errors`, and `Boom` is neither a
  // Node global nor one of app.js's bare globals. Every `Boom.*` denial below therefore raises
  // ReferenceError and answers a scrubbed HTTP 500 - never a 403, 404 or 400. Keep the identifiers
  // as written; declaring `Boom`, or rerouting through `errors`, would change 15 responses.
  create : async function(request, h) {
    // recaptcha.verify's callback is not error-first: it yields a single result object whose failure
    // shape is { status : false }, key `status` and never `success`, so the `.success` read below is
    // falsy on a genuine failure by accident rather than by design.
    var recaptcha_result = await new Promise(function(resolve) {
      recaptcha.verify(request.payload['g-recaptcha-response'], resolve);
    });

    if (!recaptcha_result.success) {
      return h.reject();
    }

    // SECURITY REMEDIATION (review finding SEC-4, CWE-601), recorded in
    // docs/PRESERVED-QUIRKS.md section 4.4. Both halves of this destination are
    // user-controlled: the session value is set by `GET /signup?next=…` and
    // `payload.next` is a declared payload field - config/routes.js:L88 accepts it
    // as `Joi.string().allow('').optional()`, so a caller may supply it even
    // though no shipped template renders it. It reaches the responder below as
    // `redirectTo`, which lib/http/redirect.js absolutizes into a Location header.
    // Only a same-origin root-relative destination is honoured;
    // Redirect.internalDestination returns every in-application path unchanged, so
    // a legitimate '/courses/x' still redirects exactly as before, while an
    // absolute or scheme-relative value now takes the no-redirect branch that an
    // absent `next` already took.
    var payload  = request.payload,
        interest = request.payload.interest || 'python',
        redirect = Redirect.internalDestination(request.yar.get('next') || payload.next),
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
      // Async conversion: this hand-written bridge is RETAINED, and it is a BASELINE construct -
      // the base commit already awaited exactly this shape here (base lib/controllers/users.js:L62).
      // lib/models/user.js#exists is a hybrid that both invokes an error-first callback AND returns
      // the underlying promise chain, whose value is whatever the callback RETURNED. Neither native
      // form works on it:
      //   - `await User.exists(user, cb)` resolves with the callback's return value, not the result.
      //   - `util.promisify(User.exists)` is DEPRECATED for it: Node 22 raises DEP0174 ("Calling
      //     promisify on a function that returns a Promise is likely a mistake") on every call, and
      //     the zero-deprecation-warning gate forbids introducing that.
      // The bridge is therefore the only adapter that keeps the callback contract and stays warning
      // free. `exists` is pre-bound to its model by lib/models/model.js:L176, so no .call is needed.
      var existsResult = await new Promise(function(resolve, reject) {
        User.exists(user, function(err, result) {
          if (err) reject(err);
          else resolve(result);
        });
      });

      if (existsResult && existsResult.exists) {
        request.yar.flash('duplicates', existsResult.duplicates, true);
        return h.reject(json);
      }

      // Save user
      var savedUser = await user.save();

      request.yar.flash('requested', request.payload.username);

      // Log in the user
      // Async conversion: app.js:L113-L119 defines _logIn as a SYNCHRONOUS decoration that ends
      // in `if (cb) cb(null)` - the callback is optional and the error argument is always null -
      // so the baseline bridge's reject arm was unreachable and its await never yielded. A direct
      // call is exactly equivalent, and it keeps the session write ordered ahead of the response
      // exactly as before (TR4).
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
    // SECURITY REMEDIATION (review finding SEC-4, CWE-601), recorded in
    // docs/PRESERVED-QUIRKS.md section 4.4. The session's `next` originates from the
    // `GET /login?next=…` query string and is emitted verbatim as a Location header
    // at the toolkit redirect below, so an off-origin value turned this login form
    // into an open redirect. Redirect.internalDestination returns every same-origin
    // root-relative path unchanged - '/courses/x' still redirects exactly as it did
    // at baseline - and answers null for anything that would leave the origin,
    // which routes the handler into the SAME `else` branch an absent `next` already
    // took (the declarative success.redirect '/home').
    var redirect  = Redirect.internalDestination(request.yar.get('next'));
    var data;

    try {
      console.log('LOGIN: Finding user');
      // Find user by email or username
      // Async conversion: lib/models/user.js#findByLogin forwards to model.findOne(query, cb) and
      // is pre-bound by lib/models/model.js:L176, so with the callback omitted it hands back the
      // mongoose Query, which is awaitable. The two-handler .then reproduces the bridge exactly:
      // the resolve arm carried the document through and the reject arm re-raised, and the
      // callback's console.log fired on BOTH arms with `err` and the email-or-'no user' string.
      // Capturing the outcome first keeps that single log line, with the same two values, ahead of
      // the re-raise - a bare `await` would have dropped it.
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
      // Async conversion: lib/models/user.js#comparePassword is `bcrypt.compare(candidate,
      // this.password, cb)`, and bcrypt 6.0.0 returns a promise when the callback is omitted, so
      // the instance method is directly awaitable. The two-handler .then preserves the bridge's
      // resolve/reject split AND the callback's console.log, which fired on both arms - on the
      // error arm `isMatch` was undefined, which `compared.match` reproduces.
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
      // PRESERVED QUIRK - see docs/PRESERVED-QUIRKS.md. The error is passed as the FIRST argument, so
      // it lands in the responder's `json` slot and its `err` slot stays undefined: the log line prints
      // the inspected error followed by the literal string "undefined". Do NOT rewrite this to pass an
      // empty json first and the error second.
      //
      // R-6 ADJUDICATION - the two routes bound to this handler answer DIFFERENTLY here, and both fates
      // are unchanged. POST /login is html and declares fail.redirect '/login' (config/routes.js:L51),
      // so the responder takes its redirect branch and answers a genuine 302. POST /api/users/login
      // declares no fail block, so the responder falls through to h.response(json) - which hapi 21.4.10
      // REFUSES for an Error ("AssertError: Cannot wrap an error") - and the raise escapes to
      // routeParser's single catch-all, answering a scrubbed HTTP 500. The base commit did exactly the
      // same on both routes: it RETURNED request.fail(err) from the handler frame, so the wrapper used
      // that defined value rather than its deferred capture and the AssertError escaped identically.
      // This is why the site is NOT routed through Pending.rejectOrHang - unlike the three orphaned
      // request.fail(<Error>) sites in sendPassReset, assetUpload and assetUploadFromURL, whose raises
      // could never reach a response at all. See lib/http/pending.js.
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
      // The failure responder - spelled request.fail at the base commit, h.reject here - answers
      // HTTP 200 with a failure flash and never a 4xx. The double-quoted message is client-visible
      // and byte-frozen. See docs/PRESERVED-QUIRKS.md.
      return h.reject({
        message: "Email is not configured. Password reset is not available."
      });
    }

    var result = await new Promise(function(resolve) {
      recaptcha.verify(request.payload['g-recaptcha-response'], resolve);
    });

    if (result.success) {
      // Async conversion: the two-handler .then replaces the bridge and keeps this branch - not an
      // escaping rejection - in charge of what the route answers, which is what preserves the two
      // failure responses below as HTTP 200s rather than promoting them to a 500. findByLogin is
      // pre-bound (lib/models/model.js:L176) and returns the awaitable mongoose Query when its
      // callback is omitted.
      var lookup = await User.findByLogin(request.payload.email).then(
        function(user) { return { user : user }; },
        function(err)  { return { err : err }; }
      );

      // PRESERVED QUIRK - see docs/PRESERVED-QUIRKS.md, and the derivation in lib/http/pending.js.
      // The error is passed as the responder's FIRST argument, so it lands in `json` - and the
      // responder's default branch ends in h.response(json), which hapi 21 REFUSES for an Error
      // ("AssertError: Cannot wrap an error", measured on 21.4.10). The base commit reached this
      // call from an ORPHANED mongoose callback, so that raise could not become a response at all
      // and the request answered NOTHING; letting it propagate out of this async handler would
      // invent a 500 instead. Pending.rejectOrHang reproduces the measured fate and is transparent
      // on every non-raising path, so an html request on a route declaring fail.redirect still gets
      // its 302. Argument order is preserved either way.
      if (lookup.err)   return Pending.rejectOrHang(h, lookup.err);
      if (!lookup.user) return h.reject({ message: 'user not found' });

      var user = lookup.user;

      // Async conversion: util.promisify replaces the resolve-only bridge. Baseline IGNORED
      // randomBytes' error argument, which would have left `buf` undefined and raised a TypeError
      // on the next line; promisify rejects instead. That divergence is unreachable - randomBytes
      // fails only when the OS entropy source fails, at which point the process cannot serve
      // requests at all - so the two forms agree in every reachable state. The INLINE crypto
      // require form, the 48-byte length and the hex slice below are frozen: they mint the
      // password-reset token that is persisted in the store and emailed to the user (TR6), so any
      // change invalidates every in-flight token.
      var buf = await util.promisify(require('crypto').randomBytes)(48);

      var key      = buf.toString('hex').substring(0, 8);
      var resetKey = Store.user.reset_password_key(key);
      var resetVal = user.id.toString();

      // R-6 ADJUDICATION: at the base commit these two writes were awaited inside an UNOWNED async
      // randomBytes callback (base lib/controllers/users.js:L241-L247), so a rejection from either
      // became an unhandled rejection, the success responder below never ran, and the request
      // answered NOTHING - no status line, no body. Letting the rejection escape this handler would
      // invent an HTTP 500 on a branch that never carried a status, so the measured pending fate is
      // reproduced instead. See lib/http/pending.js for the derivation. A failure of the SECOND write
      // after the first succeeded hung at baseline too, which is why both share one guard.
      try {
        await Store.set(resetKey, resetVal);
        await Store.expire(resetKey, 86400);
      }
      catch (storeError) {
        return Pending.hang();
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
      // Fire-and-forget, deliberately un-awaited.
      mailer.send(user.email, 'Password reset', { html : message, type : 'password-reset' });

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

      // Async conversion: the two-handler .then replaces the bridge and keeps this branch, rather
      // than an escaping rejection, in charge of the response. lib/models/model.js:L116-L149 returns
      // its underlying promise whether or not a callback is supplied, so omitting the callback also
      // sidesteps that method's double-invoke quirk (a throw inside the success arm reaches
      // `.catch(cb)` and calls the callback a second time).
      var lookup = await User.findById(user_id).then(
        function(user) { return { user : user }; },
        function(err)  { return { err : err }; }
      );

      if (lookup.err)   return lookup.err;
      if (!lookup.user) return h.reject({ message: 'user not found' });

      // The response IS the return value now; baseline left this call bare and relied on the
      // deleted deferred capture.
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

      // Async conversion: as in resetPasswordForm.
      var lookup = await User.findById(user_id).then(
        function(user) { return { user : user }; },
        function(err)  { return { err : err }; }
      );

      if (lookup.err)   return lookup.err;
      if (!lookup.user) return h.reject({ message: 'user not found' });

      var user = lookup.user;

      user.password = request.payload.password;

      // Async conversion: document.save() returns a promise, so the callback and its bridge both
      // go. Capturing the rejection instead of letting it escape preserves the error branch's own
      // response: baseline resolved with `err`, which was undefined on success, and `null` is
      // falsy in exactly the same way for the guard below.
      var saveError = await user.save().then(
        function() { return null; },
        function(err) { return err; }
      );

      if (saveError) return saveError;

      // PRESERVED QUIRK (R-6, R-4) - see docs/PRESERVED-QUIRKS.md. At baseline this await sat INSIDE
      // `user.save(async function(err) { ... await Store.del(resetKey); request.success(); })`, and
      // Mongoose DISCARDS that callback's returned promise - measured against mongoose 6.13.10 with a
      // live mongod: `doc.save(asyncCb)` returns `undefined` and the rejection surfaces out of
      // mongoose/lib/model.js as an UNHANDLED rejection. Because no `unhandledRejection` and no
      // `uncaughtException` handler exists anywhere in app.js, config/ or lib/, Node 22's default
      // `throw` mode then killed the process with exit code 1 - measured - so `request.success()` never
      // ran and the request received NO RESPONSE. The 500 that the outer catch below would answer was
      // never on the wire at baseline, so the failure has to be contained here instead. Reproducing the
      // client-visible half means never answering; this deliberately does NOT re-raise, because process
      // lifecycle is outside every one of the five PRESERVE directives and re-raising matches none of
      // R-1's four sanctioned diff categories. RESIDUAL DIVERGENCE: the process now survives.
      try {
        await Store.del(resetKey);
      }
      catch (unownedCallbackError) {
        return Pending.forever();
      }

      // The response IS the return value now.
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
      // Async conversion: lib/models/model.js:L167-L172 rewrites findForUser to
      // `model.find({ _owner : userId }, defaultFields, cb)` and pre-binds it, so with the callback
      // omitted it hands back a mongoose Query. .exec() is used rather than a bare Query so the
      // find still runs EAGERLY here, exactly as the baseline bridge's executor did, instead of
      // waiting for the .then() further down.
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
      // Async conversion: RETAINED for the reason set out in `create` above - lib/models/user.js#exists
      // both takes an error-first callback and returns a promise resolving to that callback's return
      // value, so awaiting it directly yields the wrong value and util.promisify raises DEP0174 on
      // Node 22. This is the base commit's own bridge (base lib/controllers/users.js:L385), and
      // constructing it here rather than inside a .then keeps the lookup EAGER exactly as baseline.
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
        return h.reject({
          message : "Sorry, that username is already taken. Please try another."
        });
      }
      else {
        // Async conversion: baseline left this save callback a BARE STATEMENT, so the whole else
        // branch resolved `undefined` and only the deleted deferred capture rescued its response.
        // Returning the chain makes the branch's own value the response. document.save() returns a
        // promise, so the bridge goes; the two-handler .then still captures BOTH outcomes so the err
        // branch below - not an escaping rejection - decides what the route answers, which is what
        // keeps both duplicate-username failures HTTP 200. Mongoose resolves with the saved
        // document and rejects with the error alone, so `user` is absent on the error path exactly
        // as the callback's second argument was. The `user` binding below deliberately shadows the
        // outer one, exactly as baseline.
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
    // ⭐ PRESERVED QUIRK - see docs/PRESERVED-QUIRKS.md section 1.14 A. The `types` initializer below
    // is the mechanism of the SINGLE HTTP 500 in the 58-route baseline response corpus, at
    // GET /api/users/assets. The route validates `type` as Joi.string().OPTIONAL
    // (config/api_routes.js:L1241), so calling it with no query string leaves request.query.type
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
      // Async conversion: as in `account` - findForUser is pre-bound and hands back a mongoose Query
      // when its callback is omitted, and .exec() keeps the find EAGER exactly as the baseline
      // executor made it. A Query rejects on the same errors the bridge rejected on, so the tail
      // .catch below still sees them.
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

    // Async conversion: baseline left this a BARE STATEMENT that relied on the deleted deferred
    // capture. util.promisify replaces the bridge - lib/util/file.js#uploadUserAsset reads the
    // module-scope `self` and never `this`, so the unbound call promisify makes is safe, and every
    // one of its exits is error-first. The two-handler .then still captures both outcomes so the
    // branch below keeps the failure at HTTP 200. Note the THREE-argument call: uploadUserAsset
    // accepts both this arity and the four-argument replace form used by `replaceAsset`, and each
    // site's arity is preserved. The error path DOES also carry a `file` (its innermost callback is
    // `cb(err, file)`), but no branch here reads it, so promisify discarding it is unobservable -
    // unlike lib/controllers/files.js, where the second argument of an error-first-looking callback
    // IS read and the bridges therefore had to stay.
    var upload = await util.promisify(FileUtil.uploadUserAsset)(request.payload.file, request.user).then(
      function(file) { return { file : file }; },
      function(err)  { return { err : err }; }
    );

    // PRESERVED QUIRK - see docs/PRESERVED-QUIRKS.md and the derivation in lib/http/pending.js. The
    // error is the responder's FIRST argument, so it lands in `json`, and h.response() refuses to
    // wrap an Error. The base commit reached this call from an ORPHANED FileUtil callback, so that
    // raise never became a response and the request answered NOTHING; Pending.rejectOrHang preserves
    // that and stays transparent on every non-raising path. Argument order preserved.
    if (upload.err) return Pending.rejectOrHang(h, upload.err);
    return h.respond({ file : upload.file });
  },

  replaceAsset : async function(request, h) {
    if (!config.features.assets) {
      // The same 501 as `assetUpload`, returned rather than thrown for the same reason.
      return errors.notImplemented('Asset uploads are not enabled');
    }
    var origfile = request.pre.file;

    if (request.user.id.toString() === origfile._owner.toString()) {
      // The FOUR-argument replace form. Both arities are live in lib/util/file.js, which shifts its
      // own arguments when the third is a function. Async conversion: util.promisify appends the
      // callback as the fourth argument, so the replace arity is preserved exactly, and it rejects
      // precisely where the bridge rejected - the tail .catch below is unchanged.
      return util.promisify(FileUtil.uploadUserAsset)(request.payload.file, request.user, origfile)
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

    // Async conversion: util.promisify replaces the resolve-only bridge. Baseline IGNORED
    // tmp.tmpName's error argument, which would have left `tmpPath` undefined and raised one line
    // later; promisify rejects instead. tmpName fails only when it cannot find an unused name after
    // its retry budget, which needs a colliding /tmp it does not own, so the two forms agree in every
    // reachable state. tmp moves 0.0.25 -> 0.2.7; the tmpName(cb) contract is unchanged.
    var tmpPath = await util.promisify(tmp.tmpName)();

    // Dependency swap: the dead `request` package becomes the two Node built-ins, NOT `fetch`.
    // downloadRemoteAsset() at the foot of this file carries the full measured parity contract -
    // no compression negotiation and no transparent decode (so the persisted, content-hashed bytes
    // are the wire bytes), backpressured streaming straight to `tmpPath`, redirects followed with
    // the same budget and the same `referer` header, the final response's content-type captured, and
    // NO status check, so a 404 body is still uploaded as the asset exactly as it was.
    var download = await downloadRemoteAsset(request.payload.url, tmpPath);

    // Base's `.on('error')` handler did nothing but log, and this is the verbatim line. It is
    // deliberately independent of the branch below, because the over-redirect outcome logged AND
    // went on to upload - see (b) in downloadRemoteAsset()'s contract - while a construction-time
    // failure threw before the listener existed and so logged nothing at all.
    if (download.logError) {
      console.log('on error:', download.logError);
    }

    if (!download.completed) {
      // PRESERVED QUIRK - see docs/PRESERVED-QUIRKS.md section 1.15. Because that log line was the
      // ENTIRE error handler, a transfer failure never reached the `end` handler, nothing settled
      // the deleted shim's deferred capture, and the request answered NOTHING AT ALL.
      // R-6 ADJUDICATION, MEASURED over real HTTP against the base commit's own `request@2.88.2`:
      // a DNS failure produced the event sequence `["error"]` and no response; a non-http scheme
      // produced a synchronous `Error: Invalid protocol:` inside the unowned `tmp.tmpName` callback
      // and no response. Both are reproduced. An earlier revision re-threw so the centralized error
      // map answered a clean 500, on the reasoning that "the hang is not reproducible once the
      // deferred capture is gone"; it is reproducible - `lib/http/pending.js` is exactly that - and
      // a 500 here is the substitution R-4 and TR2 forbid. The process-level half of the
      // construction-error case is deliberately not re-created, per the note in
      // lib/controllers/folders.js.
      return Pending.forever();
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

    // Async conversion: the THREE-argument upload form, promisified exactly as in `assetUpload`.
    var upload = await util.promisify(FileUtil.uploadUserAsset)(fileupload, request.user).then(
      function(file) { return { file : file }; },
      function(err)  { return { err : err }; }
    );

    // PRESERVED QUIRK - see docs/PRESERVED-QUIRKS.md and lib/http/pending.js. Error as the
    // responder's FIRST argument, which makes h.response() refuse to wrap it; the base commit reached
    // this from an ORPHANED FileUtil callback, so the raise produced NO response. Argument order
    // preserved, and the non-raising paths are untouched.
    if (upload.err) return Pending.rejectOrHang(h, upload.err);
    return h.respond({ file : upload.file });
  },
  changePassword : async function(request, h) {
    if (request.payload.newPassword === request.payload.confirmPassword) {
      // Async conversion: baseline left this comparePassword callback a BARE STATEMENT and relied on
      // the deleted deferred capture. lib/models/user.js#comparePassword forwards straight to
      // bcrypt.compare, and bcrypt 6.0.0 returns a promise when the callback is omitted, so the
      // instance method is awaited directly. Capturing both outcomes keeps every one of the four
      // failure messages an HTTP 200 instead of promoting a compare failure to a 500.
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

        // Async conversion: document.save() returns a promise, so the callback and its bridge both
        // go; the rejection is captured rather than allowed to escape, for the same reason.
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

    // Async conversion: baseline left this findByLogin callback a BARE STATEMENT and relied on the
    // deleted deferred capture to carry the response out. Capturing both outcomes preserves the fact
    // that baseline inspects only `user` and IGNORES `err` entirely - `lookup.err` is deliberately
    // never read below, so a lookup failure still falls through to the store write exactly as it did.
    var lookup = await User.findByLogin(request.payload.email).then(
      function(user) { return { user : user }; },
      function(err)  { return { err : err }; }
    );

    // if user found, send back error message
    if (lookup.user) {
      return h.reject({ message: 'Another account with that email address already exists.' });
    }

    // create random key and store new email with it
    // Async conversion: util.promisify replaces the bridge, on the same unreachable-error-path
    // reasoning as sendPassReset. The INLINE crypto require form is preserved at all three
    // randomBytes sites, and 48 bytes plus the hex slice are frozen because the derived key is
    // stored and emailed (TR6).
    var buf = await util.promisify(require('crypto').randomBytes)(48);

    var email_key = buf.toString('hex').substring(0, 8); // send in email
    var user_key  = request.user.id.toString();

    var changeKey = Store.user.change_email_key(user_key);
    var changeVal = {
        key       : email_key
      , new_email : request.payload.email
    };

    // PRESERVED QUIRK - see docs/PRESERVED-QUIRKS.md section 1.15. `lib/util/store.js` exports `set`
    // as `async function (key, value)` - ARITY 2, both at the base commit and now - so the third
    // callback argument the base commit passed here was accepted by the language and NEVER INVOKED.
    // Everything inside that callback was therefore dead code: the confirmation email was never sent,
    // `request.success` never ran, nothing settled the deleted shim's deferred capture, and the
    // request answered nothing.
    // R-6 ADJUDICATION, MEASURED over real HTTP on @hapi/hapi 20.3.0 against a verbatim replica of
    // the base-commit wrapper: NO RESPONSE, and NO EMAIL. Both halves are reproduced. An earlier
    // revision awaited the write, sent the email and answered HTTP 200 "the author plainly intended";
    // intent is not the contract - R-4 forbids the behavior change and R-6 makes the measured
    // baseline the tie-breaker, and a client that has never once received this confirmation email
    // cannot be sent one now on the strength of a code comment.
    // The store write itself still happens, because it happened at the base commit too - `Store.set`
    // was called and its promise ran; only its resolution was unobservable. Its rejection is OWNED
    // and discarded rather than left floating, for the reason recorded in
    // docs/PRESERVED-QUIRKS.md section 3.20: the base commit discarded the promise, and an unowned
    // rejection is a process-level effect this migration does not re-create.
    Store.set(changeKey, JSON.stringify(changeVal)).catch(function(storeError) {
      return storeError;
    });

    return Pending.forever();
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

      // Async conversion: this responder was a bare statement and the deleted deferred capture carried
      // it out. With the deferral gone every code path has to return its response, or hapi 21 raises and
      // the catch-all answers 500.
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

    // recaptcha.verify is invoked as cb(result), and on the test / no-secret path
    // lib/util/recaptcha.js fires it synchronously; resolving directly into it keeps both properties.
    var recaptcha_result = await new Promise(function(resolve) {
      recaptcha.verify(request.payload['g-recaptcha-response'], resolve);
    });

    if (recaptcha_result.success) {
      // create random key and store
      // Async conversion: util.promisify replaces the bridge, on the same unreachable-error-path
      // reasoning as sendPassReset. The INLINE crypto require form is preserved, and 48 bytes plus
      // the 16-character hex slice are frozen because the derived key is stored and emailed (TR6).
      var buf = await util.promisify(require('crypto').randomBytes)(48);

      var email_key = buf.toString('hex').substring(0, 16); // send in email
      var user_key  = request.user.id.toString();
      var verifyKey = Store.user.verify_email_key(user_key);

      // R-6 ADJUDICATION: as in sendPassReset, the base commit awaited this write inside an UNOWNED
      // async randomBytes callback (base lib/controllers/users.js:L807-L812), so a rejection became an
      // unhandled rejection and neither the send below nor the responder ran - the request answered
      // NOTHING. The pending fate is reproduced rather than converged onto a 500.
      try {
        await Store.set(verifyKey, email_key);
      }
      catch (storeError) {
        return Pending.hang();
      }

      // ⭐ ORDERING IS BEHAVIOUR - see docs/PRESERVED-QUIRKS.md. This handler sends the verification
      // email BEFORE it responds, the exact opposite of `sendPassReset`, which responds first and only
      // then sends. Both orderings are frozen, and the send stays fire-and-forget.
      send_email_verification(request, request.user.email, email_key);

      // Async conversion: this responder was a bare statement carried out by the deleted deferral, so it
      // has to become the handler's return value.
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

      // PRESERVED LATENT DEFECT - see docs/PRESERVED-QUIRKS.md: this is an id lookup fed an EMAIL
      // address. R-1 forbids latent-bug repair, so the lookup stays byte-identical and only its
      // callback is retired - baseline left it a BARE STATEMENT and leaned on the deleted deferred
      // capture. Both outcomes are captured because the guard below reads BOTH `err` and `user`.
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

      // Async conversion: document.save() returns a promise, so the callback and its bridge both go.
      // Baseline IGNORED save's error argument and carried straight on to the login, so the rejection
      // is swallowed rather than surfaced - a bare `await user.save()` would invent an error path this
      // handler never had, and an unsaved password would then answer differently.
      await user.save().catch(function() {});

      // Session order is behaviour (TR4): loggedInWith is set BEFORE _logIn. Async conversion: _logIn
      // is a SYNCHRONOUS decoration whose callback is optional and whose error argument is always null
      // (app.js:L113-L119), so the bridge is replaced by a direct call - which also keeps baseline's
      // ignoring of that argument.
      request.yar._logIn(user);

      // PRESERVED QUIRK - see docs/PRESERVED-QUIRKS.md section 1.15. At the base commit this `await`
      // sat inside an `async` callback handed to `request.yar._logIn` (base
      // lib/controllers/users.js:L915-L919), which does not consume the
      // promise it returns, so a rejection here became an unhandled rejection: the flash below and
      // `request.success()` never ran and nothing settled the deleted shim's deferred capture.
      // R-6 ADJUDICATION, MEASURED over real HTTP on @hapi/hapi 20.3.0 against a verbatim replica of
      // the base-commit wrapper: NO RESPONSE. The rejection is therefore caught HERE rather than
      // being allowed to reach the handler's outer catch. An earlier revision let it fall through to
      // that catch, which answers HTTP 200 with `redirectTo : 'activate-account'` - a payload this
      // branch has never produced, on an account-activation path where it would tell a user whose
      // account WAS activated to go and activate it again.
      try {
        await Store.del(activateKey);
      }
      catch (delError) {
        return Pending.forever();
      }

      request.yar.flash("info", "<strong>Thank you!</strong> Your account has been activated.");

      // Async conversion: the innermost responder was a bare statement carried out by the deleted
      // deferral, so it becomes the handler's return value.
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
    // instead. Both branches are request.fail, which answers HTTP 200.
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
        // objects in lib/util/queues.js - and .add() is deliberately not awaited.
        exportsQueue.add({
          action: 'bulk-export',
          exportId: exportRecord._id.toString(),
          userId: userId
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
    // Baseline shape: an outer try wrapping a BARE Export.findById callback, so the handler returned
    // undefined synchronously and the outer catch could only ever observe a synchronous throw, plus an
    // inner try inside the callback. BOTH structures are preserved verbatim, the two try blocks are NOT
    // merged, and `Boom` is NOT declared - so the not-found and access-denied guards below still raise
    // a ReferenceError rather than answering the status they name. Where that leads is settled at the
    // inner catch: see the measured R-6 adjudication there, and section 1.15 of
    // docs/PRESERVED-QUIRKS.md. The outer catch is left in place and, on the callback path, remains as
    // unreachable as it was at the base commit.
    try {
      var userId = request.user.id;
      var exportId = request.params.exportId;

      // Async conversion: lib/models/model.js:L116-L149 hands back its underlying promise whether or
      // not a callback is supplied, so the bridge goes. Capturing both outcomes preserves the fact
      // that an `err` here answers HTTP 200 through the failure responder rather than raising.
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
        // PRESERVED QUIRK - see docs/PRESERVED-QUIRKS.md section 1.15. The inner catch ITSELF
        // references the undeclared `Boom`, so it raises a SECOND ReferenceError instead of
        // responding. The raising line is kept verbatim and the raise is CONTAINED, because at the
        // base commit that second ReferenceError escaped an unowned Mongoose callback: the outer
        // catch never saw it - its own try block had already returned - so the outer log line never
        // appeared on this path and nothing settled the deferred capture.
        // R-6 ADJUDICATION, MEASURED over real HTTP on @hapi/hapi 20.3.0 against a verbatim replica
        // of the base-commit wrapper: NO RESPONSE, with EXACTLY ONE log line - the inner one above.
        // Letting the raise propagate instead breaks parity twice: the outer catch answers a scrubbed
        // HTTP 500 that this path never produced, and it emits a second log line that never existed.
        try {
          throw Boom.internal('Export status error');
        }
        catch (noSuchBoom) {
          return Pending.forever();
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
        return Pending.forever();
      }
    }
  },

  downloadExport : async function(request, h) {
    var userId = request.user.id;
    var exportId = request.params.exportId;

    // ⭐ R-6 ADJUDICATION (docs/PRESERVED-QUIRKS.md). Baseline left this findById callback a BARE
    // STATEMENT, so the handler resolved undefined and the deleted deferred capture carried the
    // redirect out; the redirect therefore has to be RETURNED now, or the working 302 becomes a 500.
    // Unlike getExportStatus this handler has NO try of its own, and all four denials below reference
    // the undeclared `Boom`. Each ReferenceError was raised inside the unowned Mongoose callback frame
    // with no catch between it and the process, so the deferred capture never settled and the request
    // answered NOTHING - not a 404, not a 403, not a 400, and not a 500 either. Those four measured
    // no-response fates are preserved by the SINGLE try/catch container below, which keeps each
    // `throw Boom.x(...)` statement byte-for-byte and answers with Pending.forever() from one catch.
    // One container rather than four per-branch wrappers is deliberate: it also contains the
    // `_owner`-less record's TypeError, which raised in the same unowned callback for the same
    // non-answer, so nothing is widened and nothing extra is invented.
    //
    // Async conversion: lib/models/model.js:L116-L149 hands back its underlying promise whether or not
    // a callback is supplied, so the bridge goes; both outcomes are captured because `lookup.err` is
    // read below and answers HTTP 200 through the failure responder, exactly as at baseline.
    var lookup = await Export.findById(exportId).then(
      function(exportRecord) { return { exportRecord : exportRecord }; },
      function(err)          { return { err : err }; }
    );

    var exportRecord = lookup.exportRecord;

    // The ONLY branch of this handler that ever answered an error: `request.fail` sets no status, so a
    // lookup error is an HTTP 200 carrying a failure flash. Deliberately outside the guard below.
    if (lookup.err) {
      return h.reject({ error: lookup.err.message });
    }

    // PRESERVED QUIRK - see docs/PRESERVED-QUIRKS.md section 1.15. All four guards below reference
    // the undeclared `Boom`, so none of them has ever produced the status it names: each raises a
    // ReferenceError the moment `Boom.` is evaluated. Every raising line is kept VERBATIM, and the
    // four are wrapped in ONE container because they share a single measured outcome.
    // R-6 ADJUDICATION, MEASURED over real HTTP on @hapi/hapi 20.3.0 against a verbatim replica of
    // the base-commit wrapper: at the base commit each of these raised inside an unowned Mongoose
    // callback, so the request answered NOTHING AT ALL - not 404, not 403, not 400, and not 500 - and
    // nothing was logged. That is reproduced. An earlier revision let each raise reach the
    // centralized error map and answer a scrubbed HTTP 500, on the reasoning that the hang was
    // "unavoidable"; it is avoidable, `lib/http/pending.js` is exactly that, and R-4 forbids the
    // substitution. The process-level half - the escaping ReferenceError - is deliberately not
    // re-created, per the note in lib/controllers/folders.js.
    // The container also catches a `_owner`-less record's TypeError, which at the base commit raised
    // in the same unowned callback for the same non-answer, so nothing is widened by it.
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
      return Pending.forever();
    }

    // Generate fresh presigned URL
    // Dependency swap + R-6 adjudication: aws-sdk v2's client.getSignedUrl was SYNCHRONOUS and its result
    // was consumed synchronously right here. The v3 SDK has NO synchronous presigner, so config/aws.js
    // publishes getSignedDownloadUrl(params, seconds) as a PROMISE and this - the codebase's only
    // presigner - MUST await it. Bucket / Key stay byte-identical, and v2's `Expires: 3600` carries
    // through unchanged: config/aws.js forwards this second argument to the v3 presigner as its
    // expiry-seconds option, so the one-hour signature lifetime is frozen exactly as it was.
    //
    // ⭐ R-6 ADJUDICATION - the SUCCESS path of this route is DEAD AT BASELINE, measured, and the try
    // below is what preserves that. `config.aws.buckets.exports` is not declared by ANY configuration
    // file in the tree - config/default.yaml declares seven buckets (userassets, snapshots, cdn,
    // materials, useravatars, appassets, vendorassets) and no `exports` one, and neither test.yaml,
    // production.yaml.dist nor local.example.yaml adds it - so reading `.name` off `undefined` raises a
    // TypeError while this argument object is being built, on EVERY call, before any presigner runs. At
    // the base commit that happened inside the same unowned Mongoose callback as the four denials
    // above, with no catch between it and the process, so the deferred capture never settled and the
    // request answered NOTHING. Letting the identical TypeError escape a native async handler instead
    // hands it to lib/http/errorMap.js and invents an HTTP 500 this branch never carried, so it is
    // contained here. The bucket lookup and the Key stay byte-identical: config/default.yaml is frozen,
    // and declaring an `exports` bucket would turn a permanently dead route into a live one (R-1/R-4).
    // A presigner REJECTION is caught by the same guard, which is faithful - v2's presigner was
    // synchronous, so its only failure mode was a throw, and a throw here hung at baseline too.
    var expiresIn = 3600;
    var downloadUrl;
    try {
      downloadUrl = await aws.getSignedDownloadUrl({
        Bucket: config.aws.buckets.exports.name,
        Key: exportRecord.s3Key
      }, expiresIn);
    }
    catch (presignError) {
      return Pending.hang();
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
 * Streams a remote asset to `destPath` with the byte-for-byte behavior of the base commit's
 * `request.get(url).on(...).pipe(fs.createWriteStream(destPath))` pipeline, and reports which of
 * that pipeline's three observable outcomes occurred.
 *
 * WHY THIS EXISTS RATHER THAN `fetch`. Two independent reasons, both measured; the full
 * adjudication is docs/PRESERVED-QUIRKS.md section 3.21.
 *
 *   1. PERSISTED-BYTE PARITY (TR6). `fetch` sends `accept-encoding: gzip, deflate` and
 *      transparently decodes the response, whereas `request` sent NO `accept-encoding` at all
 *      unless `gzip: true` was passed - and this call site never passed it. Measured against a
 *      checkout of the base commit with `request@2.88.2` installed: the request headers on the wire
 *      were exactly `{host, connection}`, and for an origin that returns `content-encoding: gzip`
 *      regardless of negotiation the base pipeline wrote the **44 compressed bytes**
 *      (sha256/16 `06238af3cc0d971b`) to disk, not the 4099 decoded bytes
 *      (sha256/16 `a557d5812d39f083`). Those bytes are content-hashed by
 *      `FileUtil.uploadUserAsset` -> `hashcontents` into the S3 object Key and are the stored asset,
 *      so decoding them would change both the key and the object.
 *   2. BACKPRESSURE. The pipeline it replaces materialized the whole remote body with
 *      `arrayBuffer()` before writing, so an authenticated caller could name an arbitrarily large
 *      remote object and hold all of it in memory. `response.pipe(writeStream)` restores the
 *      base commit's streaming shape. NO size cap and NO status check are added: base had neither,
 *      and R-4 forbids introducing them here.
 *
 * Reason 2 alone would NOT have justified leaving `fetch`, because `fetch`'s `response.body` is a
 * `ReadableStream` and could have been piped. Reason 1 is what makes it insufficient, and it was
 * measured to be unavoidable: against an origin that returns `content-encoding: gzip`, the default
 * request, an explicit `accept-encoding: identity`, an empty `accept-encoding` and reading
 * `response.body` as a raw stream ALL delivered the decoded 4099 bytes rather than the 44 wire
 * bytes. `undici` decodes on the response's own header regardless of negotiation or consumption
 * style and exposes no way to suppress it, so no `fetch` shape preserves the persisted bytes.
 *
 * THE THREE MEASURED OUTCOMES, and why the return value has the shape it does. Each row was
 * reproduced against the base commit's own `request@2.88.2` install over real HTTP.
 *
 *   (a) The response ended. `completed: true`, `logError: null`. Base captured
 *       `response.headers['content-type']` from the FINAL response only - intermediate 3xx
 *       responses never reached its `response` handler - and piped that response's body to disk
 *       whatever the status code was. A 404 body is therefore uploaded as the asset, measured.
 *   (b) More than `LEGACY_MAX_REDIRECTS` redirects. `completed: true` **and** `logError` set. This
 *       is the surprising one and it is why `logError` is independent of `completed`: base emitted
 *       the error - so its handler logged - and then went on to run its `end` handler anyway, with
 *       a ZERO-BYTE file on disk, because the offending response's body had already been drained by
 *       the `resume()` that precedes the counter check. Measured event order:
 *       `["error","response:302","end"]`, file size 0. The upload therefore still ran and the
 *       request still answered HTTP 200.
 *   (c) A transfer error, or a construction error. `completed: false`. These differ ONLY in whether
 *       anything was logged, which is why `logError` is `null` for the second:
 *         - transfer error (DNS failure, socket hang up, an unusable redirect target) reached base's
 *           `error` handler, which logged and did nothing else. Measured: `["error"]`, nothing else.
 *         - construction error (an unparseable URL, a URL with no host such as `http://`, or a
 *           non-http(s) scheme such as `javascript:alert(1)` or `ftp://host/a.png` - all reachable,
 *           because this route's only URL rule is "has a protocol") THREW synchronously out of
 *           `new Request()`, before the caller's `error` listener existed, so **nothing was logged**.
 *           Measured: `Error: Invalid URI "javascript:alert(1)"` and `Error: Invalid protocol: ftp:`,
 *           with empty event and log arrays.
 *       In both cases the base request never answered - see docs/PRESERVED-QUIRKS.md section 1.15.
 *
 * Two further wire details are reproduced because an origin can vary its response on them, which
 * would change the persisted bytes: the `referer` header is set to the previous URL on every
 * redirect hop (base did this unless `removeRefererHeader` was passed, and it never was), and
 * userinfo in the URL becomes an `Authorization: Basic` header - measured
 * `authorization: "Basic YWxpY2U6czNjcjN0"` for `http://alice:s3cr3t@host/a.png`, which Node's own
 * URL-to-options conversion produces identically.
 *
 * The one deliberate divergence: base left its write stream open on the error paths, leaking a file
 * descriptor. Those paths now never answer, so the descriptor is closed instead of leaked - it is
 * not observable on the wire, and reproducing an unbounded leak on a path that hangs by design
 * would be indefensible. The temp file itself is left on disk exactly as base left it.
 *
 * @param   {string} remoteUrl - the user-supplied URL, unsanitized, exactly as base received it
 * @param   {string} destPath  - the `tmp.tmpName()` path the bytes are streamed to
 * @returns {Promise<{completed: boolean, logError: (Error|null), contentType: (string|undefined)}>}
 *          Never rejects: every outcome above is reported through the resolved value, because base
 *          reported them through three separate event handlers rather than through a throw.
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
