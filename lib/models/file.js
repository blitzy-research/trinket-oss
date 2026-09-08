var model   = require('./model'),
    ownable = require('./plugins/ownable'),
    schema  = {
      hash    : { type: String },
      url     : { type: String },
      type    : { type: String, enum: ['embed', 'download'], default: 'download' },
      name    : { type: String },
      // `isWellFormedMediaType` is declared below the schema and named here:
      // a function declaration is hoisted, so the reference is resolved before
      // this literal is built, and mongoose only calls it on validation.
      mime    : {
        type     : String,
        validate : {
          validator : isWellFormedMediaType,
          message   : 'mime must be a well-formed media type'
        }
      },
      size    : { type: Number },
      thumb   : { type: String },
      hidden  : { type: Boolean, default : false },
      metrics : {
        trinkets : { type: Number, default: 0 }
      }
    };

/*
 * One well-formed media type: `type/subtype` in RFC 2045 token characters,
 * with an optional parameter section of printable ASCII only. No CR, no LF and
 * no other control character can match, and neither can a bare `type` with no
 * subtype.
 */
var MEDIA_TYPE = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}(?:[ \t]*;[\x20-\x7e]*)?$/i;

/**
 * Validates the `mime` path above.
 *
 * WHY THE FIELD IS VALIDATED AT ALL. A stored `mime` becomes a RESPONSE
 * HEADER: both branches of `download` in lib/controllers/files.js type their
 * stream from this field, so a value carrying a CR/LF or a control character
 * is a header-injection shape rather than merely a wrong content type. Before
 * this, `mime` was an unconstrained String while its sibling `type` carried an
 * enum -- the asymmetry QA finding W002-I4 named, where the field that selects
 * the response branch is constrained and the field that decides the headers is
 * not.
 *
 * WHAT IT DELIBERATELY DOES NOT DO: it does not restrict WHICH media types may
 * be stored. A downloadable `text/html` file is a legitimate upload, and the
 * attachment branch of the download already neutralises it; the active-content
 * exposure on the image branch is closed on the RESPONSE side, by the
 * Content-Security-Policy and nosniff headers that branch now sends. An
 * allow-list here would reject legitimate uploads without closing anything.
 *
 * Two consequences, stated because they are easy to misread:
 *
 *   - Mongoose does not run validators for an `undefined` path, and an absent
 *     or empty value is accepted here in any case, so the legacy documents this
 *     exposure came from are unaffected. Reading a document does not validate
 *     it, and nothing in the application re-saves one on read.
 *   - `upload` in lib/controllers/files.js logs a failed `save` and carries on
 *     building its response, so a malformed value now answers 200 WITHOUT
 *     persisting a row, rather than storing a value that would later be served
 *     as a header. No accept/reject outcome of any route changes.
 *
 * @param {*} value the value mongoose has already cast for the `mime` path
 * @returns {boolean} true when the value is absent, empty, or one well-formed
 *   media type
 */
function isWellFormedMediaType(value) {
  if (value === undefined || value === null || value === '') {
    return true;
  }

  return typeof value === 'string' && MEDIA_TYPE.test(value);
}

function hide() {
  this.hidden = true;
  return this.save();
}

function show() {
  this.hidden = false;
  return this.save();
}

function findByIdAndUpdateMetric(fileId, metric, amount) {
  var update = {
    $inc : {}
  };

  update.$inc['metrics.' + metric] = amount;

  var options = { new : true, upsert : true };

  return this.model.findByIdAndUpdate(fileId, update, options).exec();
}

module.exports = model.create('File', {
  schema       : schema,
  alternateIds : ['hash'],
  plugins      : [ ownable ],
  classMethods : {
    findForUser             : true,
    findByIdAndUpdateMetric : findByIdAndUpdateMetric
  },
  objectMethods : {
    hide : hide,
    show : show
  },
  publicSpec   : {
    id          : true,
    url         : true,
    name        : true,
    mime        : true,
    size        : true,
    thumb       : true,
    isDemo      : true,
    lastUpdated : true,
    hidden      : true,
    metrics     : true
  }
}).publicModel;
