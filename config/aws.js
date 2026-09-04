var AWS      = require('aws-sdk')
    , config = require('config');

// Suppress the SDK v2 end-of-support NOTE. The flag is read from a `setTimeout(..., 0)`
// the SDK schedules as it loads, so it takes effect only while set synchronously here.
require('aws-sdk/lib/maintenance_mode_message').suppress = true;

AWS.config.update({
  accessKeyId       : config.aws.keyId
  , secretAccessKey : config.aws.key
  , region          : config.aws.region
});

module.exports = AWS;
