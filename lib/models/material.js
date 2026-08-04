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

// Async conversion. Returns a promise that settles from the final material.save() - resolved with the saved
// document, rejected with the save error - or, when the chain that leads to that save fails, rejected with
// the SILENT-OUTCOME SENTINEL from lib/models/model.js#silentOutcome.
//
// At the base commit the chain below was deliberately unterminated - no `return`, no rejection handler - so a
// rejection from Trinket.findById, trinket.copy or parser.parse never invoked the callback at all, the
// retired shim's deferred was never settled, and the request received no response. That client-visible fate
// is preserved: the sentinel travels up through lib/models/lesson.js#copy and lib/models/course.js#copy to
// the two controllers, which answer it with `h.abandon` - still no response, still no status code.
//
// What is NOT preserved is the ownership defect that came with it (review finding F6): an earlier revision
// left this promise PERMANENTLY PENDING, so the upstream rejection was unhandled - process-fatal under Node
// 22's default rejection mode - and the awaiting HTTP request was retained for the life of the connection.
// Owning the rejection changes nothing a client can observe. See docs/PRESERVED-QUIRKS.md sections 1.15,
// 3.39 and 3.40.
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

        // The final save is the only settle path on the success side, exactly as at the base commit:
        // its document resolves and its error rejects, unwrapped.
        material.save().then(settle.resolve, settle.reject);
      })
      // A rejection from Trinket.findById, trinket.copy or trinketCopy.save answered NOTHING at the base
      // commit. It still answers nothing - but it is owned here and carried as the sentinel rather than
      // left unhandled with this promise pending. The `save()` above cannot reach this handler, because it
      // has already settled `result` by the time it rejects; a second settle attempt would be a no-op in
      // any case.
      .catch(function(upstreamError) {
        settle.reject(model.silentOutcome(upstreamError));
      });
  }
  else {
    parser.parse(materialData.content, user)
      .then(function(parsedContent) {
        materialData.content = parsedContent;

        var material = new Material(materialData, that)

        // As above: the final save is the success-side settle path and keeps its unwrapped error.
        material.save().then(settle.resolve, settle.reject);
      })
      // A rejection from parser.parse answered nothing and still answers nothing, owned and carried as
      // the sentinel.
      .catch(function(upstreamError) {
        settle.reject(model.silentOutcome(upstreamError));
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
