var mongoose    = require('mongoose'),
    util        = require('util'),
    timestamps  = require('./plugins/timestamps'),
    // The centralized credential scrub, applied in serialize()'s nested-clone branch below - the
    // shared mechanism by which a populated sub-document would otherwise reach the wire whole.
    // See docs/PRESERVED-QUIRKS.md section 4.14.
    Credentials = require('../util/credentials'),
    ObjectId    = mongoose.Types.ObjectId,
    ID_REGEXP   = /^[0-9a-fA-F]{24}$/;

function createModel(modelName, config) {
  //schema, hooks, modelMethods, classMethods
  var schema        = config.schema instanceof mongoose.Schema ? config.schema : mongoose.Schema(config.schema, {strict:true}),
      hooks         = config.hooks,
      objectMethods = config.objectMethods,
      classMethods  = config.classMethods || {},
      publicSpec    = config.publicSpec,
      plugins       = config.plugins,
      index         = config.index,
      alternateIds  = config.alternateIds,
      defaultFields = config.fields,
      expose        = process.env.NODE_ENV === 'test' ? config : {},
      model,
      Model;

  if (plugins) {
    plugins.forEach(function(plugin) {
      if (typeof plugin === 'function') {
        schema.plugin(plugin);
      }
      else if (Array.isArray(plugin)) {
        schema.plugin(plugin[0], plugin[1]);
      }
      else {
        log.error('Unrecognized plugin format:', util.inspect(plugin));
        throw new Error('Unrecognized plugin format');
      }
    });
  }

  // every schema gets the created and lastUpdated fields
  // unless explicitly configured otherwise
  if (config.timestamps !== false) {
    schema.plugin(timestamps);
  }

  if (hooks) {
    for (var hookType in hooks) {
      for (var hookName in hooks[hookType]) {
        for (var hookMethod in hooks[hookType][hookName]) {
          schema[hookType](hookName, hooks[hookType][hookName][hookMethod]);
        }
      }
    }
  }

  if (objectMethods) {
    for (var methodName in objectMethods) {
      schema.methods[methodName] = objectMethods[methodName];
    }
  }

  if (publicSpec) {
    schema.methods['publicSpec'] = function() {
      return publicSpec;
    }

    schema.methods['serialize'] = function() {
      var serialized = {};
      for (var key in publicSpec) {
        if (Array.isArray(this[key])) {
          serialized[key] = [];
          for (var i = 0; i < this[key].length; i++) {
            if (typeof(this[key][i].serialize) === 'function') {
              serialized[key].push( this[key][i].serialize() );
            } else {
              serialized[key].push( this[key][i] );
            }
          }
        }
        else if (typeof(this[key]) === 'object' && this[key] !== null) {
          if (this[key].hasOwnProperty('serialize') && typeof(this[key].serialize) === 'function') {
            serialized[key] = this[key].serialize();
          }
          else {
            // clone object - handle cases where stringify returns undefined
            //
            // THIS BRANCH IS REACHED FOR EVERY POPULATED SUB-DOCUMENT, more often than it looks: the
            // test above is `hasOwnProperty('serialize')`, but mongoose installs `serialize` on the
            // document PROTOTYPE, so it is false and the sub-document is cloned WHOLE. That is why the
            // credential scrub belongs here - `Course.publicSpec` whitelists `_owner`, and a populated
            // User document carries a bcrypt hash and, for a Google-linked owner, a live OAuth bearer
            // credential inside the untyped Mixed `profiles` object.
            //
            // The clone is the payload SHAPE and stays the shape: only values no client may
            // legitimately read are removed, so every other key is byte-identical, and one guard here
            // covers any future model with a populated sub-document. `hasOwnProperty` is deliberately
            // NOT loosened to a `typeof` test - that would project sub-documents through `publicSpec`
            // and drop `roles`, `verified`, `coursesOwned` and `trinketsOwned`, which the admin page
            // and the course response genuinely read. See docs/PRESERVED-QUIRKS.md section 4.14.
            var stringified = JSON.stringify(this[key]);
            serialized[key] = stringified !== undefined
              ? Credentials.redact(JSON.parse(stringified))
              : null;
          }
        }
        else {
          serialized[key] = this[key];
        }
      }
      return serialized;
    }
  }

  if (index) {
    index.forEach(function(index) {
      schema.index(index[0], index[1]);
    });
  }

  model = mongoose.model(modelName, schema);

  if (process.env.NODE_ENV === 'migration' || process.env.NODE_ENV === 'test') {
    expose.model = model;
  }

  if (!classMethods.findByIds) {
    classMethods.findByIds = function(ids, cb) {
      return defaultFields
        ? this.model.find({_id:{$in:ids}}, defaultFields, cb)
        : this.model.find({_id:{$in:ids}}, cb)
    }
  }

  if (!classMethods.findById) {
    classMethods.findById = function(id, cb) {
      var promise;

      if (alternateIds && alternateIds.length) {
        var query = {$or:[]};

        if (ID_REGEXP.test(id)) {
          query.$or.push({_id:new ObjectId(id)});
        }

        for(var i = 0; i < alternateIds.length; i++) {
          var condition = {};
          condition[alternateIds[i]] = id;
          query.$or.push(condition);
        }

        if (query.$or.length === 1) {
          query = query.$or[0];
        }

        promise = defaultFields
          ? this.model.findOne(query, defaultFields)
          : this.model.findOne(query);
      } else {
        promise = defaultFields
          ? this.model.findById(id, defaultFields)
          : this.model.findById(id);
      }

      // Support both callback and promise patterns
      if (cb) {
        promise.then(function(doc) { cb(null, doc); }).catch(cb);
      }
      return promise;
    };
  }

  if (!classMethods.findByIdAndUpdate) {
    classMethods.findByIdAndUpdate = function(id, update, options, cb) {
      if (typeof options === 'function' && typeof cb === 'undefined') {
        cb = options;
        options = {};
      }
      if (!options.select && defaultFields) {
        options.select = defaultFields;
      }

      return this.model.findByIdAndUpdate(id, update, options, cb);
    };
  }

  if (classMethods.findForUser) {
    delete classMethods.findForUser
    classMethods.findForUser = function(userId, cb) {
      return this.model.find({ _owner : userId }, defaultFields, cb);
    }
  }

  if (classMethods) {
    for (var methodName in classMethods) {
      expose[methodName] = classMethods[methodName].bind({model:model});
    }
  }

  Model = function(doc) {
    return new model(doc);
  };

  for (var key in expose) {
    Model[key] = expose[key]
  }

  Model.schema = schema;

  Model.extend = function(name, obj) {
    obj.schema = schema.extend(obj.schema);
    return createModel(name, obj);
  };

  Model.getName = function() {
    return modelName;
  }

  Model.isInstance = function(obj) {
    return obj instanceof model;
  };

  return {
    publicModel  : Model,
    privateModel : model
  }
}

/**
 * THE SILENT-OUTCOME SENTINEL for the course/lesson/material copy chains.
 *
 * A failure inside the inner chain of `lib/models/course.js#copy`, `lib/models/lesson.js#copy` or
 * `lib/models/material.js#copy` - from `Lesson.findById`, `Material.findById`, `Trinket.findById`,
 * `trinket.copy`, `parser.parse` or any of the inner saves - answers NO RESPONSE. Those chains carry that
 * outcome by rejecting with this sentinel, which `lib/controllers/course.js#copyCourse` and
 * `lib/controllers/courses.js#copy` translate into `h.abandon`. Rejecting rather than simply never settling
 * is what keeps the rejection owned and releases the awaiting request.
 *
 * `silentCopyFailure` is a marker PROPERTY rather than an error code, and the sentinel deliberately carries
 * NO `code`: both controllers test `err.code === 11000` to answer the duplicate-name failure with its
 * client-visible 200 payload, so a duplicate-key error raised deep inside a lesson or material copy must not
 * be mistaken for that outer failure. Leaving `code` unset makes the collision impossible by construction.
 * `cause` keeps the original error reachable for diagnosis; nothing reads it.
 *
 * Idempotent: an error that is already the sentinel is returned unchanged, so a rejection travelling
 * material -> lesson -> course is marked once and forwarded.
 * See docs/PRESERVED-QUIRKS.md sections 1.15 and 3.40.
 *
 * @param {*} err The upstream rejection.
 * @returns {Error} The sentinel, marked with `silentCopyFailure` and carrying `err` as its cause.
 */
function silentOutcome(err) {
  if (err && err.silentCopyFailure) {
    return err;
  }

  var sentinel = new Error('copy chain failed without answering', { cause : err });

  sentinel.silentCopyFailure = true;

  return sentinel;
}

module.exports = {
  create        : createModel,
  silentOutcome : silentOutcome
};
