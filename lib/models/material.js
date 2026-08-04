var model    = require('./model'),
    mongoose = require('mongoose'),
    moment   = require('moment'),
    ObjectId = mongoose.SchemaTypes.ObjectId,
    ownable  = require('./plugins/ownable'),
    slug     = require('./plugins/slug'),
    schema   = {
      name:    { type: String, required: true },
      content: { type: String, set: pruneEmpty },
      isDraft: { type: Boolean },
      type:    { type: String, default: "page" }, // page, assignment
      trinket: {
        _id       : false,
        trinketId : { type: ObjectId, ref: 'Snippet' },
        name      : { type: String },
        shortCode : { type: String },
        lang      : { type: String },

        submissionsDue : {
          _id       : false,
          enabled   : { type: Boolean, default: false },
          dateValue : { type: Date }
        },

        submissionsCutoff : {
          _id       : false,
          enabled   : { type: Boolean, default: false },
          dateValue : { type: Date }
        },

        availableOn : {
          _id       : false,
          enabled   : { type: Boolean, default: false },
          dateValue : { type: Date }
        },

        hideAfter : {
          _id       : false,
          enabled   : { type: Boolean, default: false },
          dateValue : { type: Date }
        }
      }
    };


function pruneEmpty(value) {
  if (value==null || value===''){
    return undefined;
  }
  return value;
}

// Async conversion. Returns a promise that settles ONLY from the final material.save(): resolved with
// the saved document, rejected with the save error. A rejection from Trinket.findById, trinket.copy or
// parser.parse leaves it PERMANENTLY PENDING, which is the base commit's fate reproduced rather than
// converged. There, the chain below was deliberately unterminated - no `return`, no rejection handler -
// so an upstream failure never invoked the callback at all, the retired shim's deferred was never
// settled, and the request received no response. Settling on that path would invent a status code the
// branch never carried, which R-4 forbids; see lib/http/responseContract.js#pending and
// docs/PRESERVED-QUIRKS.md.
function copy(user, parser) {
  var that   = this;
  var settle = {};
  var result = new Promise(function(resolve, reject) {
    settle.resolve = resolve;
    settle.reject  = reject;
  });
  var materialData = {
    name    : this.name,
    content : this.content,
    isDraft : this.isDraft,
    _owner  : user,
    type    : this.type,
    trinket : this.trinket
  };

  if (this.type === 'assignment') {
    Trinket.findById(this.trinket.trinketId)
      .then(function(trinket) {
        var trinketCopy = trinket.copy(user);
        return trinketCopy.save();
      })
      .then(function(trinketCopy) {
        materialData.trinket.trinketId = trinketCopy._id;
        materialData.trinket.name = trinketCopy.name;
        materialData.trinket.shortCode = trinketCopy.shortCode;
        materialData.trinket.lang = trinketCopy.lang;

        var material = new Material(materialData, that)

        // Deliberately unterminated: a rejection from Trinket.findById or trinket.copy settles
        // nothing. No `return`, and the returned promise is settled only from here.
        material.save().then(settle.resolve, settle.reject);
      });
  }
  else {
    parser.parse(materialData.content, user)
      .then(function(parsedContent) {
        materialData.content = parsedContent;

        var material = new Material(materialData, that)

        // Deliberately unterminated: a rejection from parser.parse settles nothing.
        material.save().then(settle.resolve, settle.reject);
      });
  }

  return result;
}

function setDates(dates) {
  var self       = this
    , dateFields = ["submissionsDue", "submissionsCutoff", "availableOn", "hideAfter"];

  dateFields.forEach(function(dateField) {
    self.trinket[dateField].enabled = dates[dateField + "Enabled"];
    if (self.trinket[dateField].enabled && dates[dateField]) {
      self.trinket[dateField].dateValue = dates[dateField];
    }
  });
}

function isVisible() {
  if (this.type === 'assignment') {
    if ( (this.trinket.availableOn.enabled && moment().isBefore(this.trinket.availableOn.dateValue))
    ||   (this.trinket.hideAfter.enabled   && moment().isAfter(this.trinket.hideAfter.dateValue)) ) {
      return false;
    }
  }

  return true;
}

var Material = model.create('Material', {
  schema:  schema,
  plugins: [
    ownable,
    [slug, { index: false }]
  ],
  objectMethods: {
    copy      : copy,
    setDates  : setDates,
    isVisible : isVisible
  },
  publicSpec: {
      id               : true
    , name             : true
    , slug             : true
    , content          : true
    , isDraft          : true
    , type             : true
    , trinket          : true
    , lastUpdated      : true
  }
}).publicModel;

module.exports = Material;
