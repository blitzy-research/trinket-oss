var AWS      = require('aws-sdk')
    , config = require('config');

// Suppress the SDK v2 end-of-support NOTE so the application runs warning-free while
// aws-sdk remains deliberately deferred at v2 (see docs/deferred-dependencies.md).
require('aws-sdk/lib/maintenance_mode_message').suppress = true;

AWS.config.update({
  accessKeyId       : config.aws.keyId
  , secretAccessKey : config.aws.key
  , region          : config.aws.region
});

module.exports = AWS;
