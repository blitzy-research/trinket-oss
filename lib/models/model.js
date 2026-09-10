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

  // The callbacks `findById` hands to the driver, held weakly so a callback
  // closure - and through it a request, a session and a response - is
  // collectable the moment the request that created it is over.
  //
  // Membership is what scopes the re-delivery below to the one finder the base
  // commit bridged, and to nothing else: `findByIds`, `findByIdAndUpdate`,
  // `findForUser` and every direct `this.model.*` call in a model definition
  // handed their callbacks straight to Mongoose at `2f8712a` too, so a throw
  // from one of those was never re-delivered and still is not. A callback
  // function object reused across calls is registered once and stays
  // registered, which is the intended reading of "a callback `findById`
  // delivers to".
  var reDeliveringCallbacks = new WeakSet();

  // Mongoose's own wrapper, captured before it is shadowed. Everything this
  // factory does not deliberately change still goes through it, so the
  // deferral, the non-function guard and the emit-on-throw are Mongoose's and
  // are not reimplemented here.
  var handleCallbackError = model.$handleCallbackError;

  // RESTORES THE FINDER'S DOUBLE INVOCATION, which is load-bearing and was
  // measured to be so - measured again by WITHDRAWAL, when every change in
  // `lib/models/**` was re-examined against the base commit: with this override
  // taken out and the callback form below left in place, the parity replay of
  // `error-edge.not-found.missingExport` went from `answered` to
  // `transport-failure`, the application process died mid-run and the next
  // scenario could not be driven at all. It is retained on that measurement.
  //
  // At `2f8712a` `findById` executed its query and bridged the result with
  // `promise.then(function(doc) { cb(null, doc); }).catch(cb)`. The trailing
  // `.catch(cb)` attached the caller's own callback as the rejection handler of
  // the same chain whose fulfilment handler had just called it, so a callback
  // that THREW was re-invoked with its own error as the `err` argument. Two
  // routed handlers answer from that second invocation and from nothing else:
  // `users.getExportStatus` and `users.downloadExport` build their response
  // inside an `Export.findById` callback whose branches evaluate an unbound
  // `Boom`, so the first invocation throws before `resolve` is reached and the
  // `if (err)` arm of the second invocation is what answers - 200 carrying
  // `{"error":"Boom is not defined"}`, the outcome
  // `test/parity/corpus.json`'s `error-edge.not-found.missingExport` pins and
  // docs/preserved-quirks.md 9.9 records per branch.
  //
  // An earlier revision of this file removed the bridge with the comment "No
  // test and no caller depends on that double invocation". That was wrong on
  // the caller half: six export branches - an absent export, one owned by
  // someone else, a pending one and an expired one, over both routes - stopped
  // answering at all and parked their clients, because the promise those
  // handlers await is only ever settled from inside the callback (QA findings
  // W000-EXPORT-BRANCH-HANG, W001-F11-EXPORT-BRANCHES-NO-RESPONSE,
  // W002-I6-EXPORT-CASTABLE-ABSENT-ID-HANG).
  //
  // The bridge itself cannot come back, and that is the test half of the same
  // comment, which was right. Two cases in test/lib/models/trinket.js -
  // 'findById should include the shortCode as a search criteria' (:113-124) and
  // 'findById should return the results of the findOne call' (:126-137) - stub
  // `model.findOne` as `function(criteria, cb) { cb(null, doc) }` and assert
  // `findOne.calledWithExactly(query, cb)`. Sinon compares function arguments
  // by identity, so the caller's own `cb` has to be the second argument of the
  // query call; a `.then`-fed callback leaves the stub calling `undefined`.
  // AAP 0.9.2 requires exactly that reading - "any module the suite implicates
  // is converted, and the diff records which test forced it" - and forbids
  // weakening the assertion to accommodate an implementation.
  //
  // So the outcome is restored where the mechanism lives now: Mongoose invokes
  // the callback, and this override re-delivers a throw from it to that same
  // callback. Delivery on every non-throwing path, the argument identity the
  // two tests assert, the returned Query every promise-style caller awaits
  // (`await User.findById(...)` in app.js's auth scheme, and every `.then`
  // consumer) and the single query execution are all unchanged.
  model.$handleCallbackError = function(callback) {
    var self = this;
    var reDelivering;

    if (typeof callback !== 'function' || !reDeliveringCallbacks.has(callback)) {
      return handleCallbackError.call(self, callback);
    }

    reDelivering = function() {
      try {
        callback.apply(null, arguments);
      }
      catch (thrown) {
        // The base commit's `.catch(cb)`, and its arity: one argument, the
        // error, so a callback reading `(err, doc)` sees the throw as `err` and
        // no document. A throw from THIS invocation is deliberately not caught
        // here - it propagates into Mongoose's wrapper, which emits it as a
        // model 'error' event. Nothing listens for that event, which is the
        // BASE COMMIT'S outcome and not an oversight: there, a throw from the
        // `.catch(cb)` invocation rejected the finder's own promise chain with
        // no handler attached and ended the process under Node 22's unhandled
        // rejection policy, and an unlistened 'error' event ends it the same
        // way. A model-level 'error' listener that logged instead was withdrawn
        // as an unregistered behaviour change (R-d): the full suite stayed at
        // 120 passing / 10 failing without it and the export error edge above
        // still answered, so no test and no measured request required it.
        // Either way the re-delivery is bounded at one and cannot loop.
        callback(thrown);
      }
    };

    return handleCallbackError.call(self, reDelivering);
  };

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

      // Registered before the query is built, so the override above sees this
      // callback as one of its own by the time Mongoose wraps it. A
      // promise-style caller passes nothing and registers nothing.
      if (typeof cb === 'function') {
        reDeliveringCallbacks.add(cb);
      }

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
      // A throw from inside the caller's callback is re-delivered to that same
      // callback by the `$handleCallbackError` override above, which is the
      // base commit's `.catch(cb)` outcome preserved through the callback form
      // the two findById cases in test/lib/models/trinket.js require. Callers
      // do depend on it: see the comment on that override.
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
