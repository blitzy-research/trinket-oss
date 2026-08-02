var model          = require('./model'),
    mongoose       = require('mongoose'),
    ownable        = require('./plugins/ownable'),
    slug           = require('./plugins/slug'),
    schema         = {
      name      : { type: String, required: true },
      isDraft   : { type: Boolean },
      materials : [{ type: mongoose.SchemaTypes.ObjectId, ref: 'Material' }]
    };

function copy(user, materialParser, cb) {
  var lesson = new Lesson({
    name      : this.name,
    isDraft   : this.isDraft,
    materials : [],
    _owner    : user
  }, this);

  var materialPromises = this.materials.map(function(materialId) {
    return Material.findById(materialId);
  });

  function copyMaterial(material) {
    return new Promise(function(resolve, reject) {
      material.copy(user, materialParser, function(err, copy) {
        if (err) return reject(err);
        return resolve(copy.id);
      });
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

      // Deliberately unterminated: a rejection from Material.findById or material.copy never reaches
      // cb. No `return`, and the two-argument .then keeps a throw from cb out of cb. The logging call
      // below is retained.
      lesson.save().then(function(doc) {
        return cb(null, doc);
      }, function(err) {
        err && console.log(err);
        return cb(err);
      });
    });
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
