var mongoose   = require('mongoose'),
    util       = require('util'),
    timestamps = require('./plugins/timestamps'),
    ObjectId   = mongoose.Types.ObjectId,
    ID_REGEXP  = /^[0-9a-fA-F]{24}$/;

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
            var stringified = JSON.stringify(this[key]);
            serialized[key] = stringified !== undefined ? JSON.parse(stringified) : null;
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

  // A model-level 'error' listener, because the finders below hand the caller's
  // callback straight to Mongoose.
  //
  // `Model.$wrapCallback` [node_modules/mongoose/lib/model.js:5410-5417] invokes
  // that callback inside a try/catch and turns anything it throws into
  // `model.emit('error', err)`. An 'error' event with no listener is rethrown by
  // EventEmitter, so ONE controller callback that throws terminates the whole
  // process and takes every concurrent in-flight request with it. Measured: a
  // single `GET /api/exports/{exportId}` for an absent document reaches the
  // unbound `Boom` in lib/controllers/users.js, whose ReferenceError escaped the
  // callback and killed the server mid-run; the parity replay stopped there with
  // 131 scenarios never driven.
  //
  // The listener only prevents the termination. It deliberately does NOT answer
  // the request, retry the query or reshape any response: the unbound-`Boom`
  // sites are preserved quirks and repairing them is not authorized here, so the
  // edge that threw still fails - it simply fails without ending the process.
  // Every path that does not throw is untouched, because the event is only ever
  // emitted from that catch.
  model.on('error', function(err) {
    console.error('Model[' + modelName + '] callback error:', (err && err.stack) || err);
  });

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
    // The optional callback is handed to the driver rather than bridged off the
    // query's own promise.
    //
    // AAP 0.9.2 excludes this module from conversion only for as long as "the
    // repaired suite passes with those modules unmodified", and requires that
    // "any module the suite implicates is converted, and the diff records which
    // test forced it". Two cases force it, both in test/lib/models/trinket.js:
    // 'findById should include the shortCode as a search criteria' (:113-124),
    // which asserts `findOne.calledWithExactly(query, cb)`, and 'findById
    // should return the results of the findOne call' (:126-137), whose stub
    // `function (criteria, cb) { cb(null, doc) }` threw `cb is not a function`
    // because the query was built with one argument and the callback was fed
    // from a `.then` afterwards.
    //
    // Mongoose 6 shifts a trailing function to the callback position, so each
    // branch below keeps its projection, and the query object is still RETURNED
    // so promise-style callers (app.js:329's `await User.findById(...)`, and
    // every `.then` consumer) are unaffected. Execution count is unchanged: the
    // old form executed the query from its own `.then`, exactly as the callback
    // form does now.
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
          ? this.model.findOne(query, defaultFields, cb)
          : this.model.findOne(query, cb);
      } else {
        promise = defaultFields
          ? this.model.findById(id, defaultFields, cb)
          : this.model.findById(id, cb);
      }

      // Both patterns are still supported: the callback above is the driver's
      // own, and the query it returns is what a promise-style caller awaits.
      // The one edge that changes is a throw from inside the caller's callback -
      // the removed `.catch(cb)` re-fed it to that same callback, and it now
      // propagates through Mongoose instead. No test and no caller depends on
      // that double invocation.
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

module.exports = {
  create : createModel
};
