var mailer     = require('../util/mailer'),
    errors     = require('@hapi/boom'),
    Joi        = require('joi'),
    config     = require('config'),
    nunjucks   = require('nunjucks'),
    _          = require('underscore'),
    recaptcha  = require('../util/recaptcha');

module.exports = {
  index: async function(request, h) {
    return request.success({
      footer : true
    });
  },
  login: async function(request, h) {
  	if (request.auth.isAuthenticated) {
      // PRESERVED BASELINE BEHAVIOUR (do not "fix" this to h.redirect):
      // `reply` is not a binding in this scope, so evaluating the expression
      // throws and the route answers 500 through the handler catch-all, which
      // renders 50x.html for a browser request. Baseline threw here for the
      // same reason - the value passed as the second argument was a bare
      // function with no `.redirect` property - so the response a client sees
      // is unchanged. Writing h.redirect('/home') would turn this 500 into a
      // working 302, which is a behaviour change and is prohibited.
      return reply.redirect('/home');
    } else {
      if (request.query.next) {
        request.yar.set('next', request.query.next);
      }
      return request.success();
    }
  },
  signup: async function(request, h) {
    if (request.auth.isAuthenticated) {
      // PRESERVED BASELINE BEHAVIOUR, identical mechanism to `login` above:
      // the unbound `reply` makes this branch throw, and the route answers 500.
      return reply.redirect('/welcome');
    }
    else {
      if (request.query.next) {
        request.yar.set('next', request.query.next);
      }
      return request.success({
        next : request.query.next || ""
      });
    }
  },
  welcome: async function(request, h) {
    request.yar.flash('siteMessage', 'Welcome! Your account has been created.', true);
    // The raw path is deliberate: baseline redirected with this exact string
    // and no base-URL prefixing, so the Location header is unchanged.
    return h.redirect('/home');
  },
  home: async function(request, h) {
    // Redirect to login if not authenticated
    if (!request.user) {
      return h.redirect('/login');
    }

    // The chain is returned, so its resolved value becomes this handler's
    // response: either the toolkit response from request.success, or - for a
    // rejection - the one returned by the bare `.catch(request.fail)`, which
    // resolves with request.fail's own return value. request.fail is called
    // with the error as its first argument, exactly as before.
    return Trinket.findRecentByOwner(request.user._id)
      .then(function(trinkets) {
        return request.success({
          trinkets : trinkets
        });
      })
      .catch(request.fail);
  },
  features : function(request, reply) {
    var data = {
        footer  : true
      , feature : request.params.feature
    };

    if (request.pre.namedTrinketList.length) {
      _.extendOwn(data, {
        examples : request.pre.namedTrinketList
      });
    }

    return request.success(data);
  },
  forgotPasswordForm: async function(request, h) {
  	return request.success();
  }
};
