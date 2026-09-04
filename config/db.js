var mongoose = require('mongoose'),
    // mongoose-schema-extend is deprecated but still used by lib/models/model.js
    // TODO: Migrate to native mongoose discriminators
    extend   = require('mongoose-schema-extend'),
    dbconfig = require('config').db;

// Pin Mongoose 6's existing `strictQuery` default so mongoose.connect() emits no Mongoose 7 DeprecationWarning; mongoose stays deferred at 6.x.
mongoose.set('strictQuery', true);

var mongo_creds = dbconfig.mongo.user && dbconfig.mongo.pass
  ? dbconfig.mongo.user + ':' + dbconfig.mongo.pass + '@' : '';

var read_creds = dbconfig.mongoread.user && dbconfig.mongoread.pass
  ? dbconfig.mongoread.user + ':' + dbconfig.mongoread.pass + '@' : '';

function connect() {
  var connectStr = 'mongodb://'
    + mongo_creds
    + dbconfig.mongo.host + ':'
    + dbconfig.mongo.port + '/'
    + dbconfig.mongo.database;

  if (dbconfig.mongoread.host) {
    connectStr += ','
    + read_creds
    + dbconfig.mongoread.host + ':'
    + dbconfig.mongoread.port + '/'
    + dbconfig.mongoread.database;

    if (dbconfig.mongoread.opts) {
      connectStr += '?' + dbconfig.mongoread.opts;
    }
  }

  mongoose.connect(connectStr);
}

// Closes the connection this module opened.
//
// It lives here rather than in the bootstrap because this is the module that
// dials MongoDB - `connect()` runs at module scope below - and a connection
// closed by whoever happens to hold a `mongoose` reference is a connection with
// no single owner. app.js's ordered shutdown calls this after the HTTP listener
// has drained, so no in-flight request can be left reaching for a closed
// connection.
//
// `mongoose.disconnect()` resolves whether or not a connection was ever
// established, so calling it after a failed `connect()` - the state a run
// without a reachable database is in - is safe and is not treated as an error.
// The returned promise is handed straight back, unbounded here on purpose: the
// caller owns the timeout, because how long a shutdown may take is the
// bootstrap's decision and not this module's.
function disconnect() {
  return mongoose.disconnect();
}

connect();

module.exports = {
  connect    : connect,
  disconnect : disconnect
};
