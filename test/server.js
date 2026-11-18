// The server module reads its configuration and opens its database connection at load
// time, so the environment and the dependency stubs must be in place before it is
// required. Every statement in this preamble is ordered for that reason.
process.env.NODE_ENV = 'test';

var SESSION_PASSWORD = 'trinket-test-session-password-0123456789';

process.env.NODE_CONFIG = JSON.stringify({
  app: {
    start: false,
    plugins: {
      session: {
        cookieOptions: { password: SESSION_PASSWORD }
      }
    }
  },
  db: {
    redis: { enabled: false }
  }
});

var sinon = require('sinon')
  , mongoose = require('mongoose')
  , CatboxMongoose = require('../lib/util/catbox-mongoose')
  , chai = require('chai')
  , fs = require('fs')
  , http = require('http')
  , path = require('path')
  , spawnSync = require('child_process').spawnSync
  , should = chai.should();

// config/db.js calls connect() while it loads, and no database is reachable here.
sinon.stub(mongoose, 'connect').returns(Promise.resolve(mongoose));

// The session cache provider only settles its start() on the mongoose connection's
// 'open' event, which never fires against a stub, so its lifecycle is stubbed too.
sinon.stub(CatboxMongoose.Engine.prototype, 'start').returns(Promise.resolve());
sinon.stub(CatboxMongoose.Engine.prototype, 'isReady').returns(true);
sinon.stub(CatboxMongoose.Engine.prototype, 'set').returns(Promise.resolve());
sinon.stub(CatboxMongoose.Engine.prototype, 'get').returns(Promise.resolve(null));

// The module exports the promise returned by init(), never the server itself.
var appPromise = require('../app.js');

// Sends one real HTTP request to a listening server, resolving with the status code and
// rejecting with the socket error so a refused connection can be asserted.
var probe = function(port, requestPath) {
  return new Promise(function(resolve, reject) {
    var request = http.get({ host: 'localhost', port: port, path: requestPath }, function(response) {
      response.resume();
      resolve(response.statusCode);
    });

    request.on('error', reject);
  });
};

// Every response the module's pipeline touches carries the same cache trio, and only the
// cache-control value differs by branch: error responses no-cache, the 200 asset no-store.
var assertCacheHeaders = function(response, cacheControlSubstring) {
  response.headers['cache-control'].should.contain(cacheControlSubstring);
  response.headers.pragma.should.equal('no-cache');
  response.headers.expires.should.equal('0');
};

describe('HTTP Server', function() {
  this.timeout(15000);

  var server;
  var configuredPort;
  var listeningAfterInit;

  before(function() {
    return appPromise.then(function(resolved) {
      server = resolved;
      configuredPort = server.info.port;
      listeningAfterInit = server.listener.listening;
    });
  });

  after(function() {
    if (!server) {
      return;
    }

    server.settings.port = configuredPort;

    if (server.listener && server.listener.listening) {
      return server.stop();
    }
  });

  describe('Module export', function() {
    it('should resolve to a Hapi server without binding a port', function() {
      server.should.be.an('object');
      // Chai 3.5 types an async function as 'asyncfunction', so the check is on typeof.
      (typeof server.inject).should.equal('function');
      server.info.port.should.equal(3000);
      listeningAfterInit.should.equal(false);
    });

    it('should publish the models as globals', function() {
      global.User.should.be.a('function');
      global.Trinket.should.be.a('function');
    });
  });

  describe('Configuration guard', function() {
    it('should refuse to start when the session cookie password is too short', function() {
      // The child must override the suite's own 40-character password, or the guard it
      // exists to assert would not trip.
      var child = spawnSync(process.execPath, ['-e', 'require(\'./app.js\');'], {
        cwd: path.join(__dirname, '..'),
        env: Object.assign({}, process.env, {
          NODE_ENV: 'test',
          NODE_CONFIG: JSON.stringify({
            app: {
              start: false,
              plugins: {
                session: {
                  cookieOptions: { password: 'short' }
                }
              }
            },
            db: {
              redis: { enabled: false }
            }
          })
        }),
        encoding: 'utf8',
        timeout: 60000
      });

      child.status.should.equal(1);
      child.stderr.should.contain('Session cookie password not configured');
    });
  });

  describe('Not found responses', function() {
    it('should answer an unknown API path with a 404 JSON error and cache headers', function() {
      return server.inject({
        method: 'GET',
        url: '/api/nothing',
        headers: { accept: 'application/json' }
      }).then(function(response) {
        var body = JSON.parse(response.payload);

        response.statusCode.should.equal(404);
        response.headers['content-type'].should.equal('application/json; charset=utf-8');
        assertCacheHeaders(response, 'no-cache');
        body.statusCode.should.equal(404);
        body.error.should.equal('Not Found');
        body.message.should.equal('Not Found');
      });
    });

    it('should render the 404 view for an unknown HTML path', function() {
      return server.inject({
        method: 'GET',
        url: '/nothing-here-98765',
        headers: { accept: 'text/html' }
      }).then(function(response) {
        response.statusCode.should.equal(404);
        response.headers['content-type'].should.equal('text/html; charset=utf-8');
        response.payload.should.contain('<title>Page not found</title>');
        should.not.exist(response.headers.pragma);
      });
    });

    it('should treat a request without an Accept header as an HTML request', function() {
      return server.inject({
        method: 'GET',
        url: '/nothing-here-98765'
      }).then(function(response) {
        response.statusCode.should.equal(404);
        response.headers['content-type'].should.equal('text/html; charset=utf-8');
        response.payload.should.contain('<title>Page not found</title>');
      });
    });
  });

  describe('Static assets', function() {
    it('should serve a static asset with the no-store cache contract', function() {
      var robots = fs.readFileSync(path.join(__dirname, '..', 'public', 'robots.txt'), 'utf8');

      return server.inject({
        method: 'GET',
        url: '/robots.txt'
      }).then(function(response) {
        response.statusCode.should.equal(200);
        response.headers['content-type'].should.equal('text/plain; charset=utf-8');
        assertCacheHeaders(response, 'no-store');
        should.not.exist(response.headers['x-frame-options']);
        response.payload.should.equal(robots);
      });
    });
  });

  describe('Response headers', function() {
    it('should add X-Frame-Options deny only for paths in app.xframeDeny', function() {
      return server.inject({
        method: 'POST',
        url: '/',
        headers: { accept: 'application/json' }
      }).then(function(response) {
        var body = JSON.parse(response.payload);

        response.statusCode.should.equal(404);
        response.headers['x-frame-options'].should.equal('deny');
        body.error.should.equal('Not Found');

        return server.inject({
          method: 'GET',
          url: '/api/nothing',
          headers: { accept: 'application/json' }
        });
      }).then(function(response) {
        var body = JSON.parse(response.payload);

        response.statusCode.should.equal(404);
        should.not.exist(response.headers['x-frame-options']);
        body.error.should.equal('Not Found');
      });
    });
  });

  describe('Session authentication', function() {
    it('should redirect an unauthenticated HTML request to /login and reject the JSON request with 401',
      function() {
        return server.inject({
          method: 'GET',
          url: '/welcome',
          headers: { accept: 'text/html' }
        }).then(function(response) {
          response.statusCode.should.equal(302);
          response.headers.location.should.equal('/login');
          response.payload.should.equal('');

          return server.inject({
            method: 'GET',
            url: '/welcome',
            headers: { accept: 'application/json' }
          });
        }).then(function(response) {
          var body = JSON.parse(response.payload);

          response.statusCode.should.equal(401);
          response.headers['content-type'].should.equal('application/json; charset=utf-8');
          assertCacheHeaders(response, 'no-cache');
          body.statusCode.should.equal(401);
          body.error.should.equal('Unauthorized');
          body.message.should.equal('Not logged in');
        });
      });
  });

  describe('Edge cases', function() {
    it('should answer a method the route does not declare with a 404 rather than a crash', function() {
      return server.inject({
        method: 'DELETE',
        url: '/login',
        headers: { accept: 'application/json' }
      }).then(function(response) {
        var body = JSON.parse(response.payload);

        response.statusCode.should.equal(404);
        response.headers['x-frame-options'].should.equal('deny');
        body.error.should.equal('Not Found');
      });
    });

    it('should reject a malformed path encoding with 400', function() {
      return server.inject({
        method: 'GET',
        url: '/%E0%A4%A',
        headers: { accept: 'application/json' }
      }).then(function(response) {
        var body = JSON.parse(response.payload);

        response.statusCode.should.equal(400);
        response.headers['content-type'].should.equal('application/json; charset=utf-8');
        assertCacheHeaders(response, 'no-cache');
        body.statusCode.should.equal(400);
        body.error.should.equal('Bad Request');
      });
    });

    it('should reject an oversized payload with 413', function() {
      return server.inject({
        method: 'POST',
        url: '/login',
        payload: 'x'.repeat(1200000),
        headers: { accept: 'application/json' }
      }).then(function(response) {
        var body = JSON.parse(response.payload);

        response.statusCode.should.equal(413);
        response.headers['content-type'].should.equal('application/json; charset=utf-8');
        assertCacheHeaders(response, 'no-cache');
        response.headers['x-frame-options'].should.equal('deny');
        body.statusCode.should.equal(413);
        body.error.should.equal('Request Entity Too Large');
        body.message.should.equal('Payload content length greater than maximum allowed: 1048576');
      });
    });
  });

  describe('Error handling', function() {
    it('should turn a throwing handler into the server error response and stay alive', function() {
      server.route({
        method: 'GET',
        path: '/__boom',
        handler: function() {
          throw new Error('boom');
        }
      });

      return server.inject({
        method: 'GET',
        url: '/__boom',
        headers: { accept: 'application/json' }
      }).then(function(response) {
        var body = JSON.parse(response.payload);

        response.statusCode.should.equal(500);
        assertCacheHeaders(response, 'no-cache');
        body.statusCode.should.equal(500);
        body.error.should.equal('Internal Server Error');

        return server.inject({
          method: 'GET',
          url: '/nothing-here-98765',
          headers: { accept: 'application/json' }
        });
      }).then(function(response) {
        var body = JSON.parse(response.payload);

        response.statusCode.should.equal(404);
        body.error.should.equal('Not Found');
      });
    });
  });

  describe('Session cookie', function() {
    it('should issue the session cookie with HttpOnly, SameSite=Lax and Path=/', function() {
      var loggedInUser;

      server.route({
        method: 'GET',
        path: '/__session',
        handler: function(request, h) {
          // Log in through the session helper the server installs on every request instead
          // of writing the session directly, so the helper the application's own login
          // flows call is the one exercised; it performs the same yar.set internally.
          request.yar._logIn({ _id: 'test-user-id' });
          loggedInUser = request.user;

          return h.response('ok');
        }
      });

      return server.inject({
        method: 'GET',
        url: '/__session'
      }).then(function(response) {
        var cookies = response.headers['set-cookie'];

        response.statusCode.should.equal(200);
        response.payload.should.equal('ok');
        should.exist(loggedInUser);
        loggedInUser._id.should.equal('test-user-id');
        cookies.should.be.an('array');
        cookies[0].should.match(/^session=/);
        cookies[0].should.contain('; HttpOnly');
        cookies[0].should.contain('; SameSite=Lax');
        cookies[0].should.contain('; Path=/');
      });
    });
  });

  describe('Listener lifecycle', function() {
    it('should start on an ephemeral port, serve, close, refuse further requests and stay closable',
      function() {
        var ephemeralPort;

        // Configuration cannot express port 0 (the module falls back to 3000), and the
        // framework reads its port from settings, so port 0 is set immediately before
        // start() to let the OS assign one and avoid colliding with any other process.
        server.settings.port = 0;

        return server.start().then(function() {
          server.info.port.should.be.above(0);
          ephemeralPort = server.info.port;

          return probe(ephemeralPort, '/nothing-here-98765');
        }).then(function(statusCode) {
          statusCode.should.equal(404);

          return server.stop();
        }).then(function() {
          return probe(ephemeralPort, '/nothing-here-98765').then(function() {
            throw new Error('the closed listener accepted a connection');
          }, function(error) {
            error.code.should.equal('ECONNREFUSED');
          });
        }).then(function() {
          return server.stop();
        }).then(function() {
          server.settings.port = configuredPort;
        });
      });

    it('should keep injection answering after the listener is closed', function() {
      return server.inject({
        method: 'GET',
        url: '/api/nothing',
        headers: { accept: 'application/json' }
      }).then(function(response) {
        response.statusCode.should.equal(404);
        JSON.parse(response.payload).error.should.equal('Not Found');
      });
    });
  });
});
