var _        = require('underscore'),
    server   = require('supertest'),
    url      = require('url'),
    querystring = require('querystring'),
    defaults = require('./defaults'),
    config   = require('../../config/app.config'),
    // The mutable holder test/lib/00-ready.js publishes the resolved hapi
    // server on. It replaces the former require of the application module
    // here, which could only ever yield the exported PROMISE. Requiring this
    // one at load time is safe -- it is a zero-require leaf -- but its `server`
    // property MUST be read at call time, in createRequest, never captured
    // here.
    ready    = require('../lib/ready'),
    fs       = require('fs');

// Fixed boundary for the two upload helpers below. A constant rather than a
// random string so a captured request is byte-reproducible.
var MULTIPART_BOUNDARY = 'trinketsuiteboundaryd41d8cd98f00';

/**
 * Builds an RFC 7578 conforming multipart/form-data body: one `type` text field
 * followed by one binary file part.
 *
 * This replaces `.field()` + `.attach()`, which cannot be used against this
 * application. supertest 0.8.3 carries superagent 0.16.0, and that superagent
 * labels an attached file `Content-Disposition: attachment; name="upload";
 * filename="..."`. RFC 7578 section 4.2 requires the disposition type of a
 * form-data part to be `form-data`, and @hapi/content enforces exactly that
 * (`internals.contentDispositionRegex = /^\s*form-data\s*(?:;\s*(\S.*))?$/i`,
 * node_modules/@hapi/content/lib/index.js:93), so @hapi/subtext rejects the
 * whole body with `400 Invalid multipart payload format` before any handler or
 * validation runs. Measured against this checkout, and unrelated to the hapi
 * version: the parser has required `form-data` since long before hapi 20.
 * `supertest` is deliberately held at 0.8.3 (AAP 0.5.1.6), so the client that
 * has to change is this one.
 *
 * Everything else about the request is kept exactly as superagent produced it,
 * so that only the malformed header differs: the same field name and value, the
 * same file bytes read from the same fixture, and the same per-part
 * `Content-Type` superagent derived from the file extension (measured:
 * `image/gif` for transparent.gif, `application/octet-stream` for test.ipynb).
 * Buffers are concatenated rather than string-joined so binary content survives
 * intact, and the body is sent through `.send()`, which superagent forwards
 * verbatim with a correct Content-Length.
 *
 * @param {string} type - value for the `type` form field
 * @param {string} filePath - fixture path, relative to the repository root
 * @param {string} filename - filename to advertise in the part header
 * @param {string} contentType - media type to advertise for the file part
 * @returns {Buffer} the complete request body
 */
function multipartBody(type, filePath, filename, contentType) {
  var head = Buffer.from(
    '--' + MULTIPART_BOUNDARY + '\r\n' +
    'Content-Disposition: form-data; name="type"\r\n' +
    '\r\n' +
    type + '\r\n' +
    '--' + MULTIPART_BOUNDARY + '\r\n' +
    'Content-Disposition: form-data; name="upload"; filename="' + filename + '"\r\n' +
    'Content-Type: ' + contentType + '\r\n' +
    '\r\n', 'utf8');

  var tail = Buffer.from('\r\n--' + MULTIPART_BOUNDARY + '--\r\n', 'utf8');

  return Buffer.concat([head, fs.readFileSync(filePath), tail]);
}

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

  getCourseWithOutline : function(id, cb) {
    // `outline=true`, not `outline=yes`. config/api_routes.js:40 validates this
    // query key with `Joi.boolean().optional()`, and Joi's boolean coercion
    // accepts only 'true'/'false' (case-insensitively) - not 'yes', 'on', '1' or
    // 1. Measured in isolated installs of BOTH joi 17.13.3 (the baseline
    // resolution) and joi 18.2.5 (the target), so this is not a consequence of
    // the version bump: `'yes'` has never been a valid value for this schema.
    //
    // With 'yes' the route answered
    // {"flash":{"validation":{"outline":"\"outline\" must be a boolean"}}} and no
    // `data` key, which is what left `course` undefined in the
    // "When I edit an existing course" before-hook and cascaded into thirteen
    // failures in test/lib/api/course.js. Correcting the REQUEST rather than
    // relaxing the schema keeps the application's accept/reject surface exactly
    // as measured (AAP 0.6.2).
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
      .set('Content-Type', 'multipart/form-data; boundary=' + MULTIPART_BOUNDARY)
      .send(multipartBody(defaults.file.type, defaults.file.upload, defaults.file.name, 'image/gif'))
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
      .set('Content-Type', 'multipart/form-data; boundary=' + MULTIPART_BOUNDARY)
      .send(multipartBody(defaults.ipynb.type, defaults.ipynb.upload, defaults.ipynb.name, 'application/octet-stream'))
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

  getEmbeddedTrinket : function(trinketId, lang, query, cb) {
    if (typeof query === 'function') {
      cb = query;
      query = {};
    }

    var url = '/embed/' + lang + '/' + trinketId;
    if (query.length) {
      url += '?' + querystring.stringify(query);
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
            done(err);
          }
          if (res.statusCode != 302) {
            done(new Error('Failed to log in "' + user + '"'));
          }

          return done();
        };

        return User.findByLogin(credentials.email, function(err, doc) {
          if (err) {
            return done(err);
          }

          if (!doc) {
            var userModel = new User(defaults[user]);
            return userModel.save(function(err) {
              self.login(credentials, onLoginComplete)
            });
          }

          return self.login(credentials, onLoginComplete);
        });
      }

      return done();
    }
  },

  setLastResponse : function(cb) {
    var self = this;

    return function(err, res) {
      if (!err && res.headers['set-cookie']) {
        self.cookies[self.activeUser] = res.headers['set-cookie'];
      }

      self.lastResponse = res;
      self.lastError    = err;
      self.wasOk        = err ? false : true;
      if (res && res.redirect) {
        self.lastRedirect = url.parse(res.headers.location)
      }

      self.lastContentType = res.headers['content-type'];

      cb(err, res);
    }
  }
}

function createRequest(flow, type, url) {
  // Resolve the Supertest agent on FIRST USE rather than in the constructor.
  //
  // app.js exports a promise, so the hapi server -- and therefore its
  // `.listener`, the Node http.Server Supertest needs -- does not exist while
  // Mocha is collecting files, which is when `new Flow()` at the bottom of this
  // module runs. The root `before` in test/lib/00-ready.js awaits that promise
  // and publishes the resolved server on test/lib/ready.js, so the earliest
  // point at which it is legitimately readable is the first request. Reading
  // `ready.server` through the module object here -- and not into a local at
  // require time, which would capture `null` permanently -- is what makes the
  // resolution genuinely lazy.
  if (!flow.agent) {
    if (!ready.server || !ready.server.listener) {
      throw new Error('No resolved hapi server on test/lib/ready.js: the root ' +
        '`before` in test/lib/00-ready.js must publish it before the first ' +
        'request. (app.js exports a promise, and boot failure exits the process.)');
    }

    // Cached on the instance so every request in the run shares one agent, and
    // so one keep-alive socket pool, exactly as the eager construction did.
    // Sessions do not depend on this: cookies are carried manually below.
    flow.agent = server(ready.server.listener);
  }

  var request = flow.agent[type](url);
  if (flow.activeUser && flow.cookies[flow.activeUser]) {
    request.set('cookie', flow.cookies[flow.activeUser]);
  }
  request.set('referer', config.url);
  return request;
}

function Flow() {
  // Left unresolved deliberately: createRequest fills this slot on the first
  // request, once test/lib/00-ready.js has published the resolved server.
  // Constructing it here dereferenced `.listener` on a promise, which Supertest
  // accepted without complaint and only reported much later, from the first
  // request, as a TypeError about `address`.
  this.agent      = null;
  this.activeUser = 'user';
  this.cookies    = {};

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

  del : function(url) {
    return createRequest(this, 'del', url);
  }
});

module.exports = new Flow();
