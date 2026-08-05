var fileUtil     = require('../../util/file'),
    Trinket      = require('../../models/trinket'),
    config       = require('config');

// Exposed for testing through the `internals` hatch at the foot of this module.
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
        // Returning fileUtil.removeFile's promise keeps the delete inside this chain, so a failure
        // rejects to the caller rather than being dropped.
        return fileUtil.removeFile(container, file);
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
