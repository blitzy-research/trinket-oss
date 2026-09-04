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
      // `reply` is not bound in this scope, so this expression throws a
      // ReferenceError and the route intentionally answers 500 through the
      // handler catch-all, which renders 50x.html for a browser request. An
      // authenticated visitor to /login therefore gets a 500, not a redirect.
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
      // Same mechanism as `login` above: the unbound `reply` makes this branch
      // throw, so an authenticated visitor to /signup gets a 500.
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
    // The raw path is deliberate: the toolkit sends it as the Location header
    // verbatim, with no base-URL prefixing.
    return h.redirect('/home');
  },
  home: async function(request, h) {
    // Redirect to login if not authenticated
    if (!request.user) {
      return h.redirect('/login');
    }

    // The chain is returned, so its resolved value is this handler's response:
    // the toolkit response from request.success, or - on a rejection - the one
    // `.catch(request.fail)` resolves with, since a catch resolves with its
    // handler's return value. request.fail's first parameter is the response
    // body, so a bare reference passes the error there rather than as the
    // error argument, and the error object itself becomes the flash and body.
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
