var fileUtil     = require('../../util/file'),
    Trinket      = require('../../models/trinket'),
    config       = require('config'),
    util         = require('util');

// fileUtil.removeFile is error-first callback based and returns nothing at all, so util.promisify
// is what turns it into something awaitable. Awaiting the bare call would resolve to `undefined`
// immediately - before the delete had completed and with any failure silently dropped.
var fileUtil_removeFile = util.promisify(fileUtil.removeFile);

// these functions written and exposed for testing
function isSnapshotUsed(snapshot) {
  var TrinketModel = require('mongoose').model('Snippet');
  return TrinketModel.countDocuments({ snapshot : snapshot })
    .then(function(count) {
      return !!count;
    });
}

function removeFile(container, file) {
  if (!file) return Promise.resolve();
  // This reads `internals` before its `var internals` declaration below, relying on var hoisting.
  // Not reordered: the indirection is what keeps the test hatch stubbable.
  return internals.isSnapshotUsed(file)
    .then(function(isUsed) {
      if (!isUsed) {
        return fileUtil_removeFile(container, file);
      }
    });
}

var internals = {
  removeFile        : removeFile,
  isSnapshotUsed    : isSnapshotUsed
};

module.exports.removeSnapshot = function(snapshot) {
  return internals.removeFile('snapshots', snapshot);
}

if (config.isTest) {
  module.exports.internals = internals;
}
