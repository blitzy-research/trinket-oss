var fileUtil     = require('../../util/file'),
    Trinket      = require('../../models/trinket'),
    config       = require('config'),
    util         = require('util');

// lib/util/file.js#removeFile deliberately keeps its error-first callback contract, so this promisify stays.
// Awaiting it directly - or that contract moving - would leave snapshot removal unsettled, i.e. hanging forever.
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
  // PRESERVED QUIRK - see docs/PRESERVED-QUIRKS.md. This reads `internals` before its `var internals` declaration
  // below, relying on var hoisting. Preserved, not reordered; the indirection keeps the test hatch stubbable.
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
