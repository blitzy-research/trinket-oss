/**
 * Route input validation bridge.
 *
 * Relocated from lib/util/routeParser.js:L516-L541 as part of the hapi API
 * migration. The logic is carried across unchanged; only the enclosing function
 * and the failure hand-off differ, because the shim's synthetic request.fail is
 * gone and the failure responder is now injected.
 *
 * Route declarations in config/routes.js and config/api_routes.js carry
 * PLAIN-OBJECT Joi maps rather than compiled schema instances, so every section
 * is coerced with Joi.object() before it is validated. Measured across both
 * route files: 101 of the 102 declared validation sections are plain objects and
 * exactly one - the payload of POST /api/trinkets/{trinketId}/draft - is an
 * already-compiled schema. The isSchema guard below is therefore load-bearing in
 * both directions and must not be simplified away.
 *
 * The route parser strips the schemas off route.options before handing the route
 * table to hapi, so hapi itself never validates these routes. This module is the
 * entire validation path for them.
 *
 * `language` is passed IN by the caller. lib/util/routeParser.js resolves it from
 * route.config.validate.language and then deletes that key from the validation
 * object, so it is no longer discoverable from `validation` by the time this
 * module runs.
 *
 * This module builds no error response of its own and sets no status code. A
 * validation failure is handed to the injected failure responder, which answers
 * HTTP 200 unless the route declares fail.redirect or fail.html. That is the
 * baseline wire behavior and it is deliberate - see docs/PRESERVED-QUIRKS.md.
 *
 * Usage from the converted route handler:
 *
 *   var response = Validation.validate(request, h, validation, language, reject);
 *   if (response) return response;
 *
 * @param   {Object}   request    - the hapi request; request[section] supplies each validated value
 * @param   {Object}   h          - the hapi response toolkit, forwarded to the failure responder
 * @param   {Object}   validation - route.config.validate, with `language` ALREADY deleted by the caller
 * @param   {Object}   language   - the custom-message map resolved by the caller; defaults to {}
 * @param   {Function} reject     - the failure responder from lib/http/responseContract.js,
 *                                  invoked as reject(request, h, json, err)
 * @returns {*} the rejection response when validation failed, otherwise undefined
 */
var util = require('util'),
    Joi  = require('joi'),
    _    = require('underscore');

function validate(request, h, validation, language, reject) {
  var validationErrors;

  // The caller resolved this before deleting the key off `validation`; normalise
  // a missing map to {} exactly as lib/util/routeParser.js:L257 does.
  language = language || {};

  // Joi 17+ validation
  if (validation) {
    for (var key in validation) {
      var schema = validation[key];
      // Joi 17+: schema.validate() replaces the removed top-level entry point
      // If schema is a plain object (not a Joi schema), wrap it with Joi.object()
      if (!Joi.isSchema(schema)) {
        schema = Joi.object(schema);
      }
      // joi 18.2.3 was measured byte-identical to 17.13.3 across the verdict,
      // details.length, the error path in both array and dotted form, the error
      // type and the exact message string. No option overrides are required, so
      // the option object below is carried across untouched: collecting every
      // error instead of stopping at the first one is baseline behavior.
      var result = schema.validate(request[key], { abortEarly: false });
      if (result.error) {
        validationErrors = validationErrors || {};
        result.error.details.forEach(function(err) {
          var fieldPath = err.path.join('.');
          // PRESERVED QUIRK - this custom-message override NEVER fires, and it
          // must continue never to fire. Catalogued in docs/PRESERVED-QUIRKS.md.
          //
          // _.find invokes its iteratee as (value, key), so `custom` receives the
          // friendly message and `match` receives the literal declaration key,
          // which config/routes.js:L91-L95 and L112-L116 both spell
          // "regular expression". Joi's pattern failure reads
          //   "username" with value "..." fails to match the required pattern: /.../
          // so it says "required pattern" and never contains the phrase
          // "regular expression". The predicate is therefore false for every
          // entry, _.find returns undefined, and `msg || err.message` falls
          // through to the raw technical Joi message. Clients have been served
          // that raw message since 2013; repairing the lookup here would change
          // observable output, which is out of bounds for this migration.
          var msg = _.find(language[fieldPath], function(custom, match) {
            return !!err.message.match(new RegExp(match));
          });
          // Last detail wins when several details share one fieldPath, so a field
          // failing two constraints reports only the final message. Baseline.
          validationErrors[fieldPath] = msg || err.message;
        });
      }
    }
    if (validationErrors) {
      // The third argument is yar's isOverride flag, so the error map is stored
      // whole rather than appended to an array: templates read the 'validation'
      // key as a plain fieldPath -> message object. Written before the responder
      // runs because the responder reads the flash bag back out.
      request.yar.flash('validation', validationErrors, true);
      return reject(request, h, request.payload, util.inspect(validationErrors));
    }
  }
}

module.exports = {
  validate : validate
};
