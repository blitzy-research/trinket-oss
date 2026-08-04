// The suite's bootstrap, required explicitly and FIRST. `../../app.js` below is the run's first application
// require, and it must not happen until `NODE_ENV`, the test database, the test session password and the
// `redis.createClient` double are all in place - `app.js:47-62` exits the process outright when the session
// password is missing. `.mocharc.json` carries only `reporter`, `recursive`, `check-leaks` and `exit`, so
// there is no `require` preload to lean on; see the note at the head of test/helpers/db.js.
//
// Its exports are captured rather than discarded because the bootstrap publishes the booted server there;
// `agentFor` below reads it when this file's own capture has not run yet.
var setup = require('../setup');

var _        = require('underscore'),
    server   = require('supertest'),
    querystring = require('querystring'),
    defaults = require('./defaults'),
    config   = require('../../config/app.config'),
    app      = require('../../app.js');

// `app.js` exports a PROMISE, not the server - a direct consequence of its awaited plugin registration and
// awaited start - so `app.listener` is `undefined` and the base commit's eager
// `this.agent = server(app.listener)` produced an agent that threw
// `TypeError: Cannot read properties of undefined (reading 'address')` on its first request. The server is
// captured here as the promise resolves and the agent is built lazily on first use, which is the second of
// the two shapes AAP 0.7.6 sanctions for this repair ("hoisted into a root hook or made lazy inside the
// agent accessor"). The root-suite `before()` in test/setup.js awaits the same promise before any test runs,
// so a request can never outrun it; laziness here is what makes that ordering sufficient rather than
// something the harness has to enforce at require time - top-level `await` is unavailable in CommonJS, and
// CommonJS is not optional for this tree.
var resolvedServer = null;

app.then(function(server) {
  resolvedServer = server;
});

// The single app-readiness barrier is the guarded root-suite `before()` in test/setup.js, which awaits this
// same promise ahead of every test in the run. It is declared there rather than here so that exactly one
// barrier exists, and it deliberately carries no timeout override: Mocha's default is ample because
// requiring `../app.js` starts `init()` during the file-loading phase and, with `app.start : false`,
// `init()` awaits no real I/O.
//
// app.js wraps `init()` in a `.catch()` that logs and calls `process.exit(1)`, so the exported promise
// NEVER REJECTS: on failure it RESOLVES to `undefined`. That is why `agentFor` below throws an explanatory
// error rather than letting a bare `TypeError` surface, which would look exactly like the original defect.

// public interface
var methods = {
  register : function(body, cb) {
    if (typeof body === 'function') {
      cb   = body;
      body = {};
    }

    var data = defaults.extend(body, 'user');
    if (!data.formName) {
      data.formName = 'signup';
    }

    return this.post('/users')
      .send(defaults.extend(data, 'recaptcha'))
      .end(this.setLastResponse(cb));
  },

  index : function(cb) {
    return this.get('/')
      .end(this.setLastResponse(cb));
  },

  login : function(body, cb) {
    if (typeof body === 'function') {
      cb   = body;
      body = {};
    }

    return this.post('/login')
      .send(defaults.extend(body, 'login'))
      .end(this.setLastResponse(cb));
  },

  viewCourse : function(user, course, cb) {
    return this.get('/u/' + user + '/classes/' + course)
      .end(this.setLastResponse(cb));
  },

  logout : function(cb) {
    return this.get('/logout')
      .end(this.setLastResponse(cb));
  },

  welcome : function(cb) {
    return this.get('/welcome')
      .end(this.setLastResponse(cb));
  },

  home : function(cb) {
    return this.get('/home')
      .end(this.setLastResponse(cb));
  },

  admin : function(cb) {
    return this.get('/admin/users')
      .end(this.setLastResponse(cb));
  },

  sendPassReset : function(body, cb) {
    if (typeof body === 'function') {
      cb   = body;
      body = {};
    }

    return this.post('/send-pass-reset')
      .send(defaults.extend(body, 'recaptcha'))
      .end(this.setLastResponse(cb));
  },

  resetPassForm : function(query, cb) {
    return this.get('/reset-pass?key=' + query)
      .end(this.setLastResponse(cb));
  },

  savePass : function(body, cb) {
    if (typeof body === 'function') {
      cb   = body;
      body = {};
    }

    return this.post('/save-pass')
      .send(body)
      .end(this.setLastResponse(cb));
  },

  updateProfile : function(userId, profile, cb) {
    return this.put('/api/users/' + userId)
      .send(profile)
      .end(this.setLastResponse(cb));
  },

  createCourse : function(body, cb) {
    if (typeof body === 'function') {
      cb   = body;
      body = {};
    }

    return this.post('/api/courses')
      .send(defaults.extend(body, 'course'))
      .end(this.setLastResponse(cb));
  },

  deleteCourse : function(courseId, cb) {
    return this.del('/api/courses/' + courseId)
      .end(this.setLastResponse(cb));
  },

  copyCourse : function(courseId, body, cb) {
    return this.post('/api/courses/' + courseId + '/copy')
      .send(body)
      .end(this.setLastResponse(cb));
  },

  updateCourse : function(courseId, body, cb) {
    return this.put('/api/courses/' + courseId + '/metadata')
      .send(body)
      .end(this.setLastResponse(cb));
  },

  updateLesson : function(courseId, lessonId, body, cb) {
    return this.put('/api/courses/' + courseId + '/lessons/' + lessonId + '/name')
      .send(body)
      .end(this.setLastResponse(cb));
  },

  getCourse : function(id, cb) {
    return this.get('/api/courses/' + id)
      .end(this.setLastResponse(cb));
  },

  getCourseBySlug : function(userSlug, courseSlug, cb) {
    return this.get('/u/' + userSlug + '/classes/' + courseSlug)
      .end(this.setLastResponse(cb));
  },

  // PRESERVED VERBATIM. `config/api_routes.js:40` validates this query as `Joi.boolean().optional()`, and
  // `yes` is not a boolean literal Joi has ever coerced: measured against BOTH the base commit's joi
  // 17.13.3 and the target joi 18.2.3, `'yes'` is REJECTED with the byte-identical message
  // `"outline" must be a boolean` while `'true'` is accepted and coerced to `true`. So this request never
  // reached lib/controllers/course.js:76 at the base commit either - the route answered its validation
  // flash instead.
  //
  // The request is left exactly as the base commit wrote it, and its rejection is pinned as a first-class
  // assertion in test/lib/api/course.js rather than papered over. The browser-valid form the frozen
  // AngularJS client sends is covered separately by getCourseWithBooleanOutline below, which is also what
  // the `When I edit an existing course` fixture hook uses - so both readings are asserted, neither
  // replaces the other, and no test is blocked from executing. See docs/PRESERVED-QUIRKS.md section 13.7.
  getCourseWithOutline : function(id, cb) {
    return this.get('/api/courses/' + id + '?outline=yes')
      .end(this.setLastResponse(cb));
  },

  // The form the frozen AngularJS client actually sends: public/js/courseEditor/course.js:15,
  // public/js/courseEditor/controllers/root.js:147,
  // public/js/courseEditor/controllers/materialControl.js:91 and public/js/classPage/app.js:57 all pass
  // `{ outline : true }`, which Angular serializes as `outline=true`. Added coverage (F-05), not a
  // replacement for the helper above.
  getCourseWithBooleanOutline : function(id, cb) {
    return this.get('/api/courses/' + id + '?outline=true')
      .end(this.setLastResponse(cb));
  },

  downloadCourse : function(url, cb) {
    return this.get(url)
      .end(this.setLastResponse(cb));
  },

  addNewLesson : function(courseId, body, cb) {
    if (typeof body === 'function') {
      cb = body;
      body = {};
    }

    return this.post('/api/courses/' + courseId + '/lessons')
      .send(defaults.extend(body, 'lesson'))
      .end(this.setLastResponse(cb));
  },

  getLesson : function(courseId, lessonId, cb) {
    return this.get('/api/courses/' + courseId + '/lessons/' + lessonId)
      .end(this.setLastResponse(cb));
  },

  moveLesson : function(courseId, lessonId, index, cb) {
    return this.put('/api/courses/' + courseId + '/lessons/' + lessonId + '/move')
      .send({ index : index })
      .end(this.setLastResponse(cb));
  },

  deleteLesson : function(courseId, lessonId, cb) {
    return this.del('/api/courses/' + courseId + '/lessons/' + lessonId)
      .end(this.setLastResponse(cb));
  },

  addNewMaterial : function(courseId, lessonId, body, cb) {
    if (typeof body === 'function') {
      cb = body;
      body = {};
    }

    return this.post('/api/courses/' + courseId + '/lessons/' + lessonId + '/materials')
      .send(defaults.extend(body, 'material'))
      .end(this.setLastResponse(cb));
  },

  updateMaterial : function(courseId, lessonId, materialId, body, cb) {
    return this.put('/api/courses/' + courseId + '/lessons/' + lessonId + '/materials/' + materialId + '/name')
      .send(body)
      .end(this.setLastResponse(cb));
  },

  patchMaterialContent : function(courseId, lessonId, materialId, body, cb) {
    return this.put('/api/courses/' + courseId + '/lessons/' + lessonId + '/materials/' + materialId + '/patchContent')
      .send(body)
      .end(this.setLastResponse(cb));
  },

  deleteMaterial : function(courseId, lessonId, materialId, cb) {
    return this.del('/api/courses/' + courseId + '/lessons/' + lessonId + '/materials/' + materialId)
      .end(this.setLastResponse(cb));
  },

  moveMaterial : function(courseId, lessonId, materialId, index, cb) {
    return this.put('/api/courses/' + courseId + '/lessons/' + lessonId + '/materials/' + materialId + '/move')
      .send({ index : index })
      .end(this.setLastResponse(cb));
  },

  getMaterial : function(courseId, lessonId, materialId, cb) {
    return this.get('/api/courses/' + courseId + '/lessons/' + lessonId + '/materials/' + materialId)
      .end(this.setLastResponse(cb));
  },

  markMaterialDraft : function(courseId, lessonId, materialId, cb) {
    return this.put('/api/courses/' + courseId + '/lessons/' + lessonId + '/materials/' + materialId + '/draft')
      .send({ isDraft : true })
      .end(this.setLastResponse(cb));
  },

  uploadFile : function(body, cb) {
    if (typeof body === 'function') {
      cb = body;
      body = {};
    }

    // TODO: create way to override body

    return this.post('/file')
      .field('type', defaults.file.type)
      .attach('upload', defaults.file.upload)
      .end(this.setLastResponse(cb));
  },

  downloadFile : function(fileId, cb) {
    return this.get('/api/files/' + fileId + '/download')
      .end(this.setLastResponse(cb));
  },

  uploadIpynb : function(body, cb) {
    if (typeof body === 'function') {
      cb = body;
      body = {};
    }

    return this.post('/file')
      .field('type', defaults.ipynb.type)
      .attach('upload', defaults.ipynb.upload)
      .end(this.setLastResponse(cb));
  },

  createTrinket : function(body, cb) {
    if (typeof body === 'function') {
      cb = body;
      body = {};
    }

    return this.post('/api/trinkets')
      .send(defaults.trinket)
      .end(this.setLastResponse(cb));
  },

  getTrinket : function(trinketHash, lang, cb) {
    return this.get('/' + lang + '/' + trinketHash)
      .end(this.setLastResponse(cb));
  },

  /**
   * Requests the embed page for a trinket, with an optional query string.
   *
   * Review finding M9 - a false green. The test was `if (query.length)`, and every caller passes an
   * OBJECT (`{ start : 'result' }`), whose `length` is `undefined`. The query was therefore NEVER
   * appended: `test/lib/api/trinket.js`'s "with result showing" case issued exactly the same request as
   * the plain embed case beside it and could not have detected the parameter being dropped, ignored or
   * rejected. The test is now on the object's own key count, and a pre-built string is accepted too so
   * the existing shape of the argument stays free.
   *
   * @param {string}        trinketId The trinket id or short code.
   * @param {string}        lang      The trinket language segment.
   * @param {Object|string} [query]   A query map, or an already-serialized query string.
   * @param {Function}      cb        Called with (err, response).
   * @returns {Object} The supertest request.
   */
  getEmbeddedTrinket : function(trinketId, lang, query, cb) {
    if (typeof query === 'function') {
      cb = query;
      query = {};
    }

    var url = '/embed/' + lang + '/' + trinketId,
        search = typeof query === 'string' ? query : querystring.stringify(query || {});

    if (search.length) {
      url += '?' + search;
    }

    return this.get(url)
      .end(this.setLastResponse(cb));
  },

  emailTrinket : function(trinketId, body, cb) {
    if (typeof body === 'function') {
      cb = body;
      body = {};
    }

    return this.post('/api/trinkets/' + trinketId + '/email')
      .send(defaults.extend(body, 'recaptcha'))
      .end(this.setLastResponse(cb));
  },

  runTrinket : function(trinketId, cb) {
    return this.put('/api/trinkets/' + trinketId + '/metrics')
      .send({ runs : true })
      .end(this.setLastResponse(cb));
  },

  forkTrinket : function(parentTrinketId, trinketData, cb) {
    return this.post('/api/trinkets/' + parentTrinketId + '/forks')
      .send(trinketData)
      .end(this.setLastResponse(cb));
  },

  snapshotTrinket : function(trinketId, cb) {
    return this.post('/api/trinkets/' + trinketId + '/snapshot')
      .end(this.setLastResponse(cb));
  },

  trinketRunError : function(body, cb) {
    if (typeof body === 'function') {
      cb = body;
      body = {};
    }

    return this.post('/api/trinkets/codeerror')
      .send(defaults.trinketRunError)
      .end(this.setLastResponse(cb));
  },

  subscribe : function(list, email, cb) {
    return this.post('/api/subscriptions/' + list)
      .send({email:email})
      .end(this.setLastResponse(cb));
  },

  unsubscribe : function(list, email, cb) {
    return this.del('/api/subscriptions/' + list + '?email=' + email)
      .end(this.setLastResponse(cb));
  },

  getSubscriptions : function(list, cb) {
    return this.get('/api/subscriptions/' + list)
      .end(this.setLastResponse(cb));
  },

  /**
   * Makes `user` the active cookie slot, logging in - and creating the account if necessary - when a
   * callback is supplied and the slot holds no cookie yet.
   *
   * Review finding M14, four defects in the completion handler, all of which turned a broken fixture into
   * a confusing later failure instead of a clear immediate one:
   *
   *   1. `done(err)` did not `return`, so execution continued;
   *   2. `res.statusCode` was then dereferenced - and on a transport error `res` is `undefined`, so the
   *      real error was replaced by `TypeError: Cannot read properties of undefined`;
   *   3. `done` could be called twice or three times on one invocation, which Mocha reports as
   *      "done() called multiple times" attributed to whichever test happened to be running;
   *   4. `userModel.save(function(err) { ... })` DISCARDED its error and logged in regardless, so a
   *      rejected fixture save surfaced as an unexplained failed login.
   *
   * Every error path now returns, the response is only read once an error has been ruled out, and the
   * save error is propagated before the login is attempted.
   *
   * @param {string}     user   A key into test/helpers/defaults.
   * @param {Function}   [done] Called with (err) once the slot is usable; omitted for a bare switch.
   * @returns {*} Whatever the underlying request returns, or the result of `done`.
   */
  switchUser : function(user, done) {
    var self = this;

    self.activeUser = user;

    if (done) {
      if (!self.cookies[user]) {
        var credentials = {
          email: defaults[user].email,
          password: defaults[user].password
        };

        function onLoginComplete(err, res) {
          if (err) {
            return done(err);
          }

          if (!res || res.statusCode != 302) {
            return done(new Error('Failed to log in "' + user + '": expected HTTP 302, got ' +
              (res ? res.statusCode : 'no response')));
          }

          return done();
        };

        return User.findByLogin(credentials.email, function(err, doc) {
          if (err) {
            return done(err);
          }

          if (!doc) {
            var userModel = new User(defaults[user]);
            return userModel.save(function(saveErr) {
              if (saveErr) {
                return done(saveErr);
              }

              return self.login(credentials, onLoginComplete);
            });
          }

          return self.login(credentials, onLoginComplete);
        });
      }

      return done();
    }
  },

  /**
   * Returns the raw `Set-Cookie` array currently held for a user, or undefined when none has been seen.
   *
   * @param {string} [user] A cookie slot; defaults to the active user.
   * @returns {string[]|undefined} The raw header value, exactly as the server sent it.
   */
  currentCookie : function(user) {
    return this.cookies[typeof user === 'undefined' ? this.activeUser : user];
  },

  /**
   * Returns the raw `Set-Cookie` array a user held BEFORE the most recent one replaced it.
   *
   * Review finding M7 (CWE-384 coverage). `setLastResponse` below overwrites the single cookie slot on
   * every response, so the cookie a session held before a security transition - a login, which rotates
   * the session id, or a logout, which revokes it - used to be discarded the instant the transition
   * happened. Without it, no test could replay the old cookie and require that it be refused, which is
   * the only assertion that actually proves rotation and invalidation rather than assuming them.
   *
   * @param {string} [user] A cookie slot; defaults to the active user.
   * @returns {string[]|undefined} The previous raw header value, or undefined if there is only one.
   */
  previousCookie : function(user) {
    var history = this.cookieHistory[typeof user === 'undefined' ? this.activeUser : user] || [];

    return history.length > 1 ? history[history.length - 2] : undefined;
  },

  /**
   * Every raw `Set-Cookie` array a user has been issued, oldest first.
   *
   * @param {string} [user] A cookie slot; defaults to the active user.
   * @returns {string[][]} A copy of the history, safe for a caller to keep.
   */
  cookiesSeen : function(user) {
    return (this.cookieHistory[typeof user === 'undefined' ? this.activeUser : user] || []).slice();
  },

  /**
   * Issues a request carrying an EXPLICIT cookie instead of the slot's current one, and does not record
   * whatever cookie comes back.
   *
   * This is what replays a revoked credential. It deliberately bypasses `setLastResponse`, because
   * recording the replay's response would overwrite the very slot the test is comparing against, and it
   * deliberately bypasses `createRequest`, because that attaches the slot's current cookie.
   *
   * @param {string} method One of 'get', 'post', 'put', 'patch', 'del'.
   * @param {string} url The path to request.
   * @param {string[]|string} cookie The raw cookie to send.
   * @returns {Object} A supertest request, ready for `.end()` or `.send()`.
   */
  replay : function(method, url, cookie) {
    var request = agentFor(this)[method](url);

    request.set('cookie', cookie || []);
    request.set('referer', config.url);

    return request;
  },

  setLastResponse : function(cb) {
    var self = this;

    return function(err, res) {
      if (!err && res.headers['set-cookie']) {
        // Review finding M7. The slot still holds only the CURRENT cookie, because every existing call
        // site reads it that way, but each value is appended to a per-user history first so the
        // pre-transition credential survives for `previousCookie` to replay.
        self.cookieHistory[self.activeUser] = self.cookieHistory[self.activeUser] || [];
        self.cookieHistory[self.activeUser].push(res.headers['set-cookie']);

        self.cookies[self.activeUser] = res.headers['set-cookie'];
      }

      self.lastResponse = res;
      self.lastError    = err;
      self.wasOk        = err ? false : true;
      if (res && res.redirect) {
        // A `Location` header reaches this one line in both forms - relative from app.js's onPreResponse
        // takeover and the controllers' own `h.redirect()`, absolute from lib/http/redirect.js's
        // absolutization - so the base argument is required: it resolves the relative form and is ignored
        // once the header is already absolute. Only `lastRedirect.pathname` is ever read, and for every
        // `Location` the suite emits this form yields the pathname the base commit's legacy parser did.
        // The measurement is in docs/PRESERVED-QUIRKS.md section 3.13.
        self.lastRedirect = URL.parse(res.headers.location, config.url);
      }

      self.lastContentType = res.headers['content-type'];

      cb(err, res);
    }
  }
}

/**
 * Returns the supertest agent, building it on first use from the resolved server's listener.
 *
 * The listener is a plain http.Server that is never `listen`-ed here, because `config/test.yaml` sets
 * `app.start: false` and `app.js` honours it. supertest binds an unlistened server to an ephemeral port
 * itself, which is what keeps parallel clones from colliding - measured on this tree: `GET /about` answers
 * 200 through exactly this path.
 *
 * @param {Object} flow The Flow instance to attach the agent to.
 * @returns {Object} The supertest agent.
 */
function agentFor(flow) {
  if (!flow.agent) {
    // `resolvedServer` is filled in by this file's own `app.then(...)`, and that continuation is a MICROTASK:
    // a consumer that requires this helper AFTER the promise already settled and issues a request in the same
    // synchronous turn finds it still null - measured, the request threw while the identical call one
    // `setImmediate` later answered 200. The bootstrap registered its capture at the very start of the run,
    // so in exactly that window `setup.server` is already populated; it holds the same server instance and is
    // read as the fallback rather than as the primary so that this file keeps standing on its own capture
    // when it is the entry point.
    var booted = resolvedServer || setup.server;

    if (!booted) {
      throw new Error('flow: the promise app.js exports has not resolved yet, so there is no server to ' +
        'bind. A root-suite before() hook in test/setup.js awaits it ahead of every test, so reaching ' +
        'this means the request was made outside the suite or the hook did not run.');
    }

    flow.agent = server(booted.listener);
  }

  return flow.agent;
}

function createRequest(flow, type, url) {
  var request = agentFor(flow)[type](url);
  if (flow.activeUser && flow.cookies[flow.activeUser]) {
    request.set('cookie', flow.cookies[flow.activeUser]);
  }
  request.set('referer', config.url);
  return request;
}

function Flow() {
  // Built lazily by agentFor(); see the note at the top of this file.
  this.agent      = null;
  this.activeUser = 'user';
  this.cookies    = {};
  // Review finding M7 (CWE-384 coverage). `cookies` keeps only the current credential per user, which is
  // what every existing call site expects; this keeps the full sequence so a test can prove that a login
  // rotated the session id and that the pre-transition cookie is refused afterwards. Raw arrays are
  // stored, unparsed, so a replay sends byte-identical bytes back.
  this.cookieHistory = {};

  // bind all of the methods for ease of use in before/after
  // blocks in the test...
  // e.g. before(flow.login)
  _.bindAll.apply(_, [this].concat(Object.keys(methods)));
}

_.extend(Flow.prototype, methods);

// internal methods
_.extend(Flow.prototype, {
  get : function(url) {
    return createRequest(this, 'get', url);
  },

  post : function(url) {
    return createRequest(this, 'post', url);
  },

  put : function(url) {
    return createRequest(this, 'put', url);
  },

  patch : function(url) {
    return createRequest(this, 'patch', url);
  },

  del : function(url) {
    return createRequest(this, 'del', url);
  }
});

module.exports = new Flow();
