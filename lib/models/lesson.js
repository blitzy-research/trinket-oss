var model          = require('./model'),
    mongoose       = require('mongoose'),
    ownable        = require('./plugins/ownable'),
    slug           = require('./plugins/slug'),
    schema         = {
      name      : { type: String, required: true },
      isDraft   : { type: Boolean },
      materials : [{ type: mongoose.SchemaTypes.ObjectId, ref: 'Material' }]
    };

// Async conversion. Returns a promise that settles ONLY from the final lesson.save(). A rejection from
// Material.findById or material.copy leaves it PERMANENTLY PENDING, reproducing the base commit's
// deliberately unterminated chain rather than converging it onto a status code that branch never
// carried; see lib/models/material.js#copy, lib/http/responseContract.js#pending and
// docs/PRESERVED-QUIRKS.md.
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
      lesson.materials = ids.map(function(id) { return id });

      // Deliberately unterminated: a rejection from Material.findById or material.copy settles
      // nothing. The logging call below is retained.
      lesson.save().then(settle.resolve, function(err) {
        err && console.log(err);
        settle.reject(err);
      });
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
