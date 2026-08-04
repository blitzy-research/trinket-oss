var model          = require('./model'),
    mongoose       = require('mongoose'),
    ownable        = require('./plugins/ownable'),
    slug           = require('./plugins/slug'),
    schema         = {
      name      : { type: String, required: true },
      isDraft   : { type: Boolean },
      materials : [{ type: mongoose.SchemaTypes.ObjectId, ref: 'Material' }]
    };

// Async conversion. Returns a promise that settles from the final lesson.save(), or - when the chain that
// leads to that save fails - rejects with the SILENT-OUTCOME SENTINEL from lib/models/model.js#silentOutcome.
//
// The base commit's chain was deliberately unterminated, so a rejection from Material.findById or
// material.copy reached no handler and the request received no response. That client-visible fate is
// preserved all the way up: the sentinel travels through lib/models/course.js#copy to the two controllers,
// which answer it with `h.abandon`. What is dropped is the ownership defect an earlier revision carried
// (review finding F6) - a permanently pending promise plus an unhandled upstream rejection, which Node 22
// escalates to a process-fatal fault. See lib/models/material.js#copy and docs/PRESERVED-QUIRKS.md sections
// 1.15, 3.39 and 3.40.
function copy(user, materialParser) {
  var lesson = new Lesson({
    name      : this.name,
    isDraft   : this.isDraft,
    materials : [],
    _owner    : user
  }, this);

  var settle = {};
  var result = new Promise(function(resolve, reject) {
    settle.resolve = resolve;
    settle.reject  = reject;
  });

  var materialPromises = this.materials.map(function(materialId) {
    return Material.findById(materialId);
  });

  function copyMaterial(material) {
    return material.copy(user, materialParser).then(function(copy) {
      return copy.id;
    });
  }

  Promise.all(materialPromises)
    .then(function(materials) {
      var copyPromises = materials.map(function(material) {
        return copyMaterial(material);
      });

      return Promise.all(copyPromises);
    })
    .then(function(ids) {
      // The successful material order is the order Promise.all resolves, which is the declaration order of
      // this lesson's `materials` array - unchanged, because nothing here reorders or filters the ids.
      lesson.materials = ids.map(function(id) { return id });

      // The final save is the only settle path on the success side, exactly as at the base commit: its
      // document resolves and its error is logged and rejected unwrapped. The logging call is retained.
      lesson.save().then(settle.resolve, function(err) {
        err && console.log(err);
        settle.reject(err);
      });
    })
    // A rejection from Material.findById or material.copy answered NOTHING at the base commit and still
    // answers nothing - owned here and carried as the sentinel rather than left unhandled with this promise
    // pending. Materials copied before the failure stay written, exactly as they did at the base commit;
    // nothing is rolled back. The `save()` above cannot reach this handler: it has already settled `result`
    // by the time it rejects.
    .catch(function(upstreamError) {
      settle.reject(model.silentOutcome(upstreamError));
    });

  return result;
}

var Lesson = model.create('Lesson', {
  schema:  schema,
  plugins: [
    ownable,
    [slug, { index: false }]
  ],
  objectMethods: {
    copy: copy
  },
  publicSpec: {
    id:true, name:true, isDraft:true, slug:true, materials:true
  }
}).publicModel;

module.exports = Lesson;
