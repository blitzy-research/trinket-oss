// Route-level coverage for the page and error-page surface, driven over real
// HTTP through the same Supertest agent the rest of the suite uses.
//
// Four of the six cases assert outcomes that read like defects and are what the
// application does: an authenticated visit to /login or /signup answers 500
// rather than redirecting, and /api and /library answer 404 because neither
// path has a registered route. Each case explains its cause where it sits. The
// statuses are asserted exactly, rather than as ranges or negations, so that
// making either pair answer more agreeably fails here.

// `should` is bound for its side effect, which every assertion below depends
// on: calling chai's should() installs the getter that `.should` reads through.
var should = require('chai').should(),
    flow   = require('../../helpers/flow');

module.exports = function() {
  describe('Static and Error Pages', function() {
    // The suites run serially against one database, and db.reset fires only
    // around the whole aggregate in index.js - never between suites - so this
    // one has to hand the next suite exactly the state it received.
    // `activeUser` is the only shared thing touched here: nothing is seeded,
    // nothing is removed, no document is created, and flow.logout is
    // deliberately never called, because the logout suite has to be the one
    // that logs out.
    var enteredAs;

    before(function(done) {
      enteredAs = flow.activeUser;

      // The login suite, which runs immediately before this one, has already
      // cached a session for 'user', so this takes switchUser's fast path and
      // simply makes that session the active one. Going through switchUser is
      // also the only sanctioned way for a spec to authenticate.
      flow.switchUser('user', done);
    });

    after(function() {
      // Restoring through switchUser with no callback is the anonymous form:
      // without a `done` argument it only reassigns activeUser, so no
      // credential lookup happens for a key that may have no defaults.
      flow.switchUser(enteredAs);
    });

    describe('When I am logged in and I visit the login page', function() {
      before(function(done) {
        flow.get('/login').end(flow.setLastResponse(function(err, res) {
          done();
        }));
      });

      // The authenticated branch of pages.login evaluates
      // `reply.redirect('/home')`, and `reply` is not a binding in that scope,
      // so the expression throws. The handler catch-all in lib/util/routeParser
      // turns the throw into a badImplementation Boom, and app.js's
      // onPreResponse renders that as 50x.html for a browser request. The exact
      // status is asserted so the throw is not quietly turned into the 302 the
      // surrounding code looks like it intends; a redirect here, or a relaxed
      // "not 500", would hide it.
      it('should answer 500 rather than redirecting me to the home page', function() {
        flow.wasOk.should.be.true;
        flow.lastResponse.statusCode.should.eql(500);
        flow.lastContentType.should.contain('text/html');
        // The rendered error page, not just its status. lib/views/50x.html is
        // what app.js's error extension renders for a >= 500 Boom on a browser
        // request, and these two markers are its title and heading. Without
        // them a 500 carrying an empty body, a stack-trace page, or the login
        // form itself would still pass.
        flow.lastResponse.text.should.contain('<title>Something went wrong</title>');
        flow.lastResponse.text.should.contain('<h1>Something went wrong <span>:(</span></h1>');
      });
    });

    describe('When I am logged in and I visit the signup page', function() {
      before(function(done) {
        flow.get('/signup').end(flow.setLastResponse(function(err, res) {
          done();
        }));
      });

      // The same mechanism as the login page above: the authenticated branch of
      // pages.signup evaluates `reply.redirect('/welcome')` against the same
      // unbound `reply`, throws, and answers through the same funnel.
      //
      // Neither of these two pages sets the 'next' session value on this path.
      // That assignment lives in each handler's `else` branch and so belongs to
      // the unauthenticated request only; it is not reached here.
      it('should answer 500 rather than redirecting me to the welcome page', function() {
        flow.wasOk.should.be.true;
        flow.lastResponse.statusCode.should.eql(500);
        flow.lastContentType.should.contain('text/html');
        flow.lastResponse.text.should.contain('<title>Something went wrong</title>');
        flow.lastResponse.text.should.contain('<h1>Something went wrong <span>:(</span></h1>');
      });
    });

    // /about and /help are not declared in config/routes.js. addStaticPages in
    // lib/util/routeParser synthesizes one route per .html file in the static
    // template directory, which holds exactly about.html and help.html, each
    // answered by a handler that adds the user context and renders the view.
    // That context tolerates an authenticated and an anonymous visitor alike,
    // so these two are 200 either way; they are measured here as authenticated
    // because that is the session this suite holds throughout.
    describe('When I visit the about page', function() {
      before(function(done) {
        flow.get('/about').end(flow.setLastResponse(function(err, res) {
          done();
        }));
      });

      it('should render the about page', function() {
        flow.wasOk.should.be.true;
        flow.lastResponse.statusCode.should.eql(200);
        flow.lastContentType.should.contain('text/html');
        // Three markers, each from a different layer of the render, so that a
        // 200 carrying the wrong page or an empty body cannot pass: the title
        // and body id come from the `title` and `body_id` blocks
        // lib/views/static/about.html overrides in base.html, and the heading
        // comes from its own content block.
        flow.lastResponse.text.should.contain('<title>About Trinket</title>');
        flow.lastResponse.text.should.contain('id="about"');
        flow.lastResponse.text.should.contain('<h2>About Trinket</h2>');
      });
    });

    describe('When I visit the help page', function() {
      before(function(done) {
        flow.get('/help').end(flow.setLastResponse(function(err, res) {
          done();
        }));
      });

      it('should render the help page', function() {
        flow.wasOk.should.be.true;
        flow.lastResponse.statusCode.should.eql(200);
        flow.lastContentType.should.contain('text/html');
        flow.lastResponse.text.should.contain('<title>Help</title>');
        flow.lastResponse.text.should.contain('id="help"');
        flow.lastResponse.text.should.contain('<h2>Help</h2>');
      });
    });

    // Both of the paths below answer 404 with content-type text/html, whether
    // the visitor is authenticated or not, because neither has a route: no
    // literal declaration for either exists in config/, and the only
    // /library-prefixed routes are deeper paths that bare /library does not
    // match. Both fall through to the Inert catch-all, which serves ./public as
    // a directory, and ./public holds no `api` or `library` entry - so Inert
    // resolves neither a file nor a directory index and produces a 404 Boom,
    // which app.js's onPreResponse renders as 404.html. The component fetch
    // populates only public/components and so cannot change this.
    //
    // Adding a route, or creating a public/api or public/library directory to
    // manufacture a 200, would change the route surface.
    describe('When I visit /api', function() {
      before(function(done) {
        flow.get('/api').end(flow.setLastResponse(function(err, res) {
          done();
        }));
      });

      it('should answer 404, because no such route is registered', function() {
        flow.wasOk.should.be.true;
        flow.lastResponse.statusCode.should.eql(404);
        flow.lastContentType.should.contain('text/html');
        // lib/views/404.html, which app.js's error extension renders for a 404
        // Boom on a browser request. Asserting the rendered page distinguishes
        // "no route, error page served" from a 404 with an empty body or one
        // produced by Inert's own directory listing.
        flow.lastResponse.text.should.contain('<title>Page not found</title>');
        flow.lastResponse.text.should.contain('<h1>Page not found</h1>');
      });
    });

    describe('When I visit /library', function() {
      before(function(done) {
        flow.get('/library').end(flow.setLastResponse(function(err, res) {
          done();
        }));
      });

      it('should answer 404, because no such route is registered', function() {
        flow.wasOk.should.be.true;
        flow.lastResponse.statusCode.should.eql(404);
        flow.lastContentType.should.contain('text/html');
        flow.lastResponse.text.should.contain('<title>Page not found</title>');
        flow.lastResponse.text.should.contain('<h1>Page not found</h1>');
      });
    });
  });
};
