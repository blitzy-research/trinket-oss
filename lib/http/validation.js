/**
 * Route input validation bridge.
 *
 * The route parser strips the schemas off route.options before handing the route
 * table to hapi, so hapi never validates these routes: this module is their
 * entire validation path. Route declarations carry plain-object Joi maps as well
 * as compiled schemas, so the isSchema guard below is load-bearing in both
 * directions.
 *
 * No error response and no status code is built here. A failure is handed to the
 * injected failure responder, which answers HTTP 200 unless the route declares
 * fail.redirect or fail.html.
 *
 * @param   {Object}   request    the hapi request; request[section] supplies each validated value
 * @param   {Object}   h          the hapi response toolkit, forwarded to the failure responder
 * @param   {Object}   validation route.config.validate, with `language` already removed by the caller
 * @param   {Object}   language   the custom-message map resolved by the caller; defaults to {}
 * @param   {Function} reject     the failure responder from lib/http/responseContract.js
 * @returns {*} the rejection response when validation failed, otherwise undefined
 */
var util = require('util'),
    Joi  = require('joi'),
    _    = require('underscore');

function validate(request, h, validation, language, reject) {
  var validationErrors;

  language = language || {};

  // Joi 17+ validation
  if (validation) {
    for (var key in validation) {
      var schema = validation[key];
      // If schema is a plain object (not a Joi schema), wrap it with Joi.object()
      if (!Joi.isSchema(schema)) {
        schema = Joi.object(schema);
      }
      // abortEarly:false collects every error rather than stopping at the first.
      var result = schema.validate(request[key], { abortEarly: false });
      if (result.error) {
        validationErrors = validationErrors || {};
        result.error.details.forEach(function(err) {
          var fieldPath = err.path.join('.');
          // This custom-message lookup never matches, so the raw Joi message is
          // what reaches the client. Preserved, not repaired - see
          // docs/PRESERVED-QUIRKS.md section 1.2. `_.find` passes (value, key),
          // so `match` is the declaration key and is used as a pattern against
          // Joi's own message text.
          var msg = _.find(language[fieldPath], function(custom, match) {
            return !!err.message.match(new RegExp(match));
          });
          // Last detail wins when several details share one fieldPath, so a field
          // failing two constraints reports only the final message.
          validationErrors[fieldPath] = msg || err.message;
        });
      }
    }
    if (validationErrors) {
      // yar's isOverride flag stores the map whole rather than appending it to an
      // array, so templates read 'validation' as a fieldPath -> message object.
      // It must be written before the responder runs, because the responder
      // drains the flash bag.
      request.yar.flash('validation', validationErrors, true);
      return reject(request, h, request.payload, util.inspect(validationErrors));
    }
  }
}

module.exports = {
  validate : validate
};
