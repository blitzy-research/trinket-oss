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
var util             = require('util'),
    Joi              = require('joi'),
    _                = require('underscore'),
    // SECURITY REMEDIATION (review finding F-16/S-2, CWE-532): the failure responder
    // logs the `err` string built below, and Joi embeds the OFFENDING VALUE in its
    // pattern, min and max messages - so a rejected password reached the log in
    // cleartext. isSecretField() is the responder's own definition of a secret-bearing
    // field, imported rather than duplicated. Only the log copy is affected; the
    // messages the client sees are untouched.
    ResponseContract = require('./responseContract');

function validate(request, h, validation, language, reject) {
  var validationErrors,
      // The same map with the secret-bearing fields' messages replaced. Built alongside
      // rather than derived afterwards, because err.type is only available here.
      loggableErrors;

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
        loggableErrors   = loggableErrors || {};
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
          // The log copy keeps the field name and the Joi constraint identifier - which
          // is what a log reader needs - and drops the message for a secret-bearing
          // field, because `"password" with value "hunter2" fails to match ...` is a
          // credential. Every other field logs exactly what it always did.
          loggableErrors[fieldPath] = ResponseContract.isSecretField(fieldPath)
            ? '[REDACTED: ' + err.type + ']'
            : validationErrors[fieldPath];
        });
      }
    }
    if (validationErrors) {
      // yar's isOverride flag stores the map whole rather than appending it to an
      // array, so templates read 'validation' as a fieldPath -> message object.
      // It must be written before the responder runs, because the responder
      // drains the flash bag.
      request.yar.flash('validation', validationErrors, true);
      // `request.payload` is still handed over whole - it is flashed as 'failure' and
      // re-rendered, which is the frozen behavior - and the responder redacts it before
      // it reaches the log. Only the second argument, which is log-only, is pre-scrubbed
      // here.
      return reject(request, h, request.payload, util.inspect(loggableErrors));
    }
  }
}

module.exports = {
  validate : validate
};
