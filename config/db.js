var mongoose = require('mongoose'),
    // mongoose-schema-extend is deprecated but still used by lib/models/model.js
    // TODO: Migrate to native mongoose discriminators
    extend   = require('mongoose-schema-extend'),
    dbconfig = require('config').db;

// `strictQuery` is set explicitly: query filters keep dropping fields the schema does not declare, and connect() warns whenever the option is left undefined.
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

connect();

module.exports = {
  connect : connect
};
