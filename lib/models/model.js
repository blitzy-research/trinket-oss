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
      var query;

      if (alternateIds && alternateIds.length) {
        query = {$or:[]};

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
      }

      // Support both callback and promise patterns.
      //
      // A supplied callback is handed to the Mongoose call itself rather than
      // bridged afterwards with `.then(function(doc){cb(null,doc)}).catch(cb)`.
      // Mongoose 6 accepts the trailing-callback forms — `Model.findOne(conditions,
      // [projection,] callback)` and `Model.findById(id, [projection,] callback)`
      // (node_modules/mongoose/lib/model.js:2317-2381) — and `Query#findOne` with a
      // callback runs `this.exec(callback); return this;`
      // (node_modules/mongoose/lib/query.js:2623-2630), so the return value is the
      // same Mongoose Query the callback-less path returns, the query is still
      // executed exactly once here, and errors reach `cb(err)` without producing an
      // unhandled rejection. The `.then(...)` bridge is deliberately NOT also run on
      // this branch: doing both would invoke `cb` twice.
      //
      // Forced by two cases in test/lib/models/trinket.js, which stub the Mongoose
      // layer as `sinon.spy(function (criteria, cb) { cb(null, doc) })` and assert
      // `findOne.calledWithExactly(query, cb)`:
      //   - "class methods findById should include the shortCode as a search criteria"
      //   - "class methods findById should return the results of the findOne call"
      // Under the bridged shape the stub was called with one argument, so its own `cb`
      // parameter was `undefined` and it threw `TypeError: cb is not a function`.
      // lib/models/model.js is one of the four modules AAP 0.2.2 excludes from
      // conversion *provisionally*; AAP 0.9.2 makes that exclusion a gate with an
      // explicit escape hatch — "Any module the suite implicates is converted, and the
      // diff records which test forced it" — which is what authorizes this change and
      // why the forcing cases are named here.
      if (cb) {
        if (query) {
          return defaultFields
            ? this.model.findOne(query, defaultFields, cb)
            : this.model.findOne(query, cb);
        }

        return defaultFields
          ? this.model.findById(id, defaultFields, cb)
          : this.model.findById(id, cb);
      }

      if (query) {
        return defaultFields
          ? this.model.findOne(query, defaultFields)
          : this.model.findOne(query);
      }

      return defaultFields
        ? this.model.findById(id, defaultFields)
        : this.model.findById(id);
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
