// config/app.config MUST be required before config/db. config/db pulls in
// mongoose-schema-extend, whose transitive Proxy polyfill replaces the global
// Object.getPrototypeOf; once that has happened the schema libraries reached
// through app.config (joi, and @hapi/validate under @hapi/hapi) throw
// "Schema can only contain plain objects" and this module cannot be required at
// all. app.config requires ./db itself, after ./routes and ./routeParser, so
// loading it first establishes the correct relative order and the `db` require
// below resolves from cache. See config/app.config.js:3 for the same note.
//
// `db` is intentionally unused as an identifier: config/db.js calls connect() at
// module scope, and this require is what opens the worker's Mongo connection.
// Removing it as an "unused variable" would silently disconnect the worker.
var exportsQueue = require('../util/queues').exports()
  , config       = require('../../config/app.config')
  , db           = require('../../config/db')
  , nunjucks     = require('nunjucks')
  , moment       = require('moment')
  , Q            = require('q')
  , fs           = require('fs')
  , path         = require('path')
  , parseLegacy  = require('../util/url').parseLegacy
  , crypto       = require('crypto')
  , archiver     = require('archiver')
  , aws          = require('../../config/aws')
  , mailer       = require('../util/mailer')
  , FileUtil     = require('../util/file')
  , Export       = require('../models/export')
  , User         = require('../models/user')
  , Trinket      = require('../models/trinket')
  , mongoose     = require('mongoose')
  , env;

var EXPORT_EXPIRY_DAYS = 3;

var langExtensions = {
  'python'     : '.py',
  'python3'    : '.py',
  'pygame'     : '.py',
  'html'       : '.html',
  'java'       : '.java',
  'R'          : '.R',
  'glowscript' : '.py',
  'blocks'     : '.xml',
  'console'    : '.py',
  'music'      : '.py',
  'skulpt'     : '.py'
};

// Download asset from S3
function downloadAsset(assetUrl) {
  var deferred = Q.defer();
  // parseLegacy is url.parse's own implementation without DEP0169, so `pathname`
  // is byte-identical here. That matters: `filename` becomes the S3 Key below, and
  // the object is already stored under it, so any divergence would silently orphan
  // stored assets rather than error. A malformed URL still throws synchronously,
  // before deferred.promise is returned, reaching the same handler as before.
  var parsed = parseLegacy(assetUrl);
  var filename = path.basename(parsed.pathname);

  var client = new aws.S3();
  client.getObject({
    Bucket: config.aws.buckets.userassets.name,
    Key: filename
  }, function(err, data) {
    if (err) return deferred.reject(err);
    deferred.resolve(data.Body);
  });

  return deferred.promise;
}

exportsQueue.on('error', function(err) {
  console.log('exports queue error:', err);
});

exportsQueue.on('failed', function(job, err) {
  // Bull 4 names the job identifier `id`; Bull 0.7's `job.jobId` no longer exists
  // on the Job instance, so reading it here would log undefined on every failure.
  // The local 'failed' event carries the Job object (queue.js emits
  // 'failed', job, error), unlike 'global:failed', which carries a raw id string.
  // lib/util/queues.js's InMemoryQueue job is likewise {id, data, opts, attempts}.
  console.log('exports failed job:', job.id, job.data);
  console.log('exports failed err:', err);

  if (job.data.exportId) {
    Export.findByIdAndUpdate(job.data.exportId, {
      status: 'failed',
      errorMessage: err.message || 'Unknown error'
    }, function() {});
  }
});

exportsQueue.on('completed', function(job, result) {
  // `result` is Bull's second 'completed' argument and part of this handler's
  // signature; removing the finished job is all this worker does with one.
  //
  // The removal runs exactly once and its promise is attached, not discarded.
  // Bull 4's Job#remove() (bull/lib/job.js) resolves queue.isReady() and then
  // runs removeJob's Lua script, which returns 0 whenever the job's `lock` key
  // is still held; remove() turns that into a rejection reading
  // "Could not remove job <id>". Discarded, that is an unhandled rejection, and
  // Node 22's default policy terminates the process - so a SUCCESSFUL export
  // could kill the worker (measured against a real Bull 4 queue: exit 1).
  // Logging and swallowing is the correct disposition rather than a rethrow: the
  // export has completed and been persisted, and a job left in the completed set
  // is a housekeeping matter, not a failed export.
  //
  // The thenable guard covers the in-memory queue in lib/util/queues.js, and any
  // other queue implementation whose remove() returns nothing: reading .then off
  // a non-object would throw here, inside an event handler, which is the failure
  // mode this guard exists to prevent.
  var removal = job.remove();

  if (removal && typeof removal.then === 'function') {
    removal.then(null, function(err) {
      console.log('exports completed job remove failed:', job.id,
        (err && err.message) || err);
    });
  }
});

exportsQueue.process(function(job) {
  var action = job.data.action;

  if (action === 'bulk-export') {
    return processBulkExport(job);
  }
  else {
    return Promise.reject(new Error('Unknown action: ' + action));
  }
});

function processBulkExport(job) {
  var exportId = job.data.exportId
    , userId   = job.data.userId
    , exportRecord
    , user
    , tempFile
    , s3Key
    , filename;

  // Generate unique filename
  var timestamp = Date.now();
  var hash = crypto.createHash('sha1')
    .update(userId + timestamp.toString())
    .digest('hex')
    .substring(0, 12);

  filename = 'trinket-export-' + hash + '.zip';
  tempFile = '/tmp/' + filename;
  s3Key = 'exports/' + userId + '/' + filename;

  if (!config.isTest) {
    env = nunjucks.configure(config.app.templates);
  }

  // Every model call below executes its query ONCE, explicitly, through .exec().
  //
  // WHY: q 1.0.1's node-callback dispatch (Q.nsend / Q.ninvoke) runs
  // Q(object).dispatch('post', [name, nodeArgs]) - it hands the method a node
  // callback AND assimilates the value the method RETURNS whenever that value is
  // a thenable, calling its .then() exactly once. A mongoose 6 Query IS a
  // thenable, so every one of this file's model edges executed its query a
  // second time and mongoose 6.13.x threw "Query was already executed: ...".
  // The `processing` update below is the first edge, so no export - successful
  // or failing - could get past it, which is why the archive, the upload and
  // both mails were unreachable. Measured for findByIdAndUpdate, findById and
  // count.
  //
  // AUTHORITY: AAP R-b ("no route or module excluded") and AAP 0.9.3, which
  // requires a functionally validated successful AND failing export job. This is
  // NOT the wholesale `q` -> native migration AAP 0.2.2 defers: q remains a
  // declared dependency and is still used here for Q(), Q.defer, Q.all,
  // Q.allSettled, .fail and .finally, and mongoose stays on 6.13.x. Only the
  // query execution boundary moved. lib/models/user.js:174 carries the same
  // correction, with the same reasoning, for the same mongoose 6 incompatibility.
  //
  // Two details are load-bearing. The `X.model || mongoose.model('Y')` idiom is
  // kept verbatim at every site - `.model` is only populated under the migration
  // and test environments, so the fallback is what resolves the model in a
  // normal worker process. And the Q() wrap on this chain's head is required,
  // not decorative: the chain terminates in .fail, which exists on a Q promise
  // and not on a native one, so the head must be a Q promise. The six
  // inner edges are returned from inside a Q .then handler, which assimilates
  // the already-executing native promise harmlessly, so they need no wrap.
  // `count` stays `count` rather than becoming `countDocuments`: it emits no
  // warning on 6.13.x and returns the same value, and the counted value feeds
  // `progress.total`/`trinketCount`, which are asserted parity fields.
  return Q((Export.model || mongoose.model('Export'))
    .findByIdAndUpdate(exportId, { status: 'processing' }).exec())
    .then(function(record) {
      exportRecord = record;
      return (User.model || mongoose.model('User')).findById(userId).exec();
    })
    .then(function(foundUser) {
      user = foundUser;
      if (!user) {
        throw new Error('User not found');
      }

      // Count total trinkets
      return (Trinket.model || mongoose.model('Snippet'))
        .count({ _owner: userId }).exec();
    })
    .then(function(count) {
      // Update total count
      return (Export.model || mongoose.model('Export')).findByIdAndUpdate(exportId, {
        'progress.total': count,
        trinketCount: count
      }).exec();
    })
    .then(function() {
      // Create the archive
      return createExportArchive(userId, exportId, tempFile);
    })
    .then(function(result) {
      // Upload to S3
      return uploadToS3(tempFile, s3Key, filename);
    })
    .then(function(downloadUrl) {
      var expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + EXPORT_EXPIRY_DAYS);

      // Get file size
      var stats = fs.statSync(tempFile);

      // Update export record with completion. `{ new: true }` stays the third
      // argument: the next handler reads the returned record's `progress` for
      // the notification mail, so it must be the post-update document.
      return (Export.model || mongoose.model('Export')).findByIdAndUpdate(exportId, {
        status: 'completed',
        downloadUrl: downloadUrl,
        s3Key: s3Key,
        expiresAt: expiresAt,
        fileSize: stats.size
      }, { new: true }).exec();
    })
    .then(function(record) {
      exportRecord = record;
      // Send notification email
      return sendCompletionEmail(user, exportRecord);
    })
    .then(function() {
      // Cleanup temp file
      fs.unlink(tempFile, function() {});
      return Promise.resolve();
    })
    .fail(function(err) {
      // Cleanup on failure
      if (tempFile) {
        fs.unlink(tempFile, function() {});
      }

      // Same single explicit execution, and the same Q() wrap for the same
      // reason as the outer head: this sub-chain is returned from a .fail
      // handler, so it stays a Q promise. The disposition this branch owes its
      // caller is exact - write the failure, mail it ONLY when a user was
      // resolved, then re-reject the ORIGINAL err. Note that the re-reject is
      // reached only when the recording itself succeeds: if the failure write or
      // the failure mail rejects, that error supersedes the original one. That
      // is baseline behaviour and is left as it is.
      return Q((Export.model || mongoose.model('Export')).findByIdAndUpdate(exportId, {
        status: 'failed',
        errorMessage: err.message
      }).exec())
      .then(function() {
        if (user) {
          return sendFailureEmail(user, err.message);
        }
      })
      .then(function() {
        return Promise.reject(err);
      });
    });
}

function createExportArchive(userId, exportId, tempFile) {
  var deferred = Q.defer();
  var archive = archiver('zip', { zlib: { level: 6 } });
  var output = fs.createWriteStream(tempFile);
  var processed = 0;
  var failed = 0;
  var manifest = {
    exportedAt: new Date().toISOString(),
    trinkets: []
  };
  var releaseRequested = false;
  var releaseApplied   = false;
  var driverClosed     = false;

  // Releases the trinket cursor exactly once, on every path out of this
  // function - the resolve path and all four reject paths.
  //
  // WHY it exists at all: the iteration below is a database cursor, and every
  // reject path here abandons it mid-iteration (a write-stream error, an
  // archiver error, a failure inside the end handler's chain, or a cursor error
  // of its own). Left open, each abandoned export would hold a server-side
  // cursor until the server times it out, and a worker processes these jobs one
  // after another. Release is therefore guaranteed on every exit, in one helper
  // rather than a line repeated five times.
  //
  // WHY it is shaped like this. mongoose 6 creates the driver cursor
  // ASYNCHRONOUSLY: QueryCursor's constructor sets `this.cursor = null` and the
  // `model.collection.find` callback later assigns it and emits 'cursor'
  // (lib/cursor/QueryCursor.js:41,80-81). That produces three distinct states
  // this helper has to survive, and one of them is a trap:
  //   1. Not yet materialized. Destroying the readable side stops the flow but
  //      does NOT close a driver cursor that has not been created yet - and the
  //      in-flight find still delivers one, which would then be left open with
  //      nobody holding it. So the release is REMEMBERED and completed from a
  //      one-shot 'cursor' listener; mongoose's own _waitForCursor
  //      (QueryCursor.js:526-536) uses this same `cursor ? now : once('cursor')`
  //      pattern for the same reason. Calling close() in this state instead
  //      would throw a TypeError, because close() dereferences that null cursor
  //      (QueryCursor.js:187).
  //   2. Materialized. close() releases the server-side cursor directly.
  //   3. Already ended, or already released. A close() after natural exhaustion
  //      settles cleanly, and `driverClosed` keeps it to one call, which is what
  //      makes calling this on the success path safe.
  // close() returns a promise, so a discarded rejection here would be the same
  // process-terminating unhandled rejection the completed handler above guards
  // against. It is logged and swallowed: cleanup must never replace the error
  // the caller is already being rejected with, nor become a failure of its own.
  function closeDriverCursor() {
    if (driverClosed || !stream || !stream.cursor) {
      return;
    }
    driverClosed = true;

    try {
      var closing = stream.close();

      if (closing && typeof closing.then === 'function') {
        closing.then(null, function(err) {
          console.log('exports archive cursor close failed:',
            (err && err.message) || err);
        });
      }
    }
    catch (err) {
      console.log('exports archive cursor close failed:',
        (err && err.message) || err);
    }
  }

  function releaseCursor() {
    releaseRequested = true;

    // The cursor is created below these handlers, so a write-stream or archiver
    // error can arrive before `stream` exists. The request is kept and applied
    // at the assignment site instead of being dropped here.
    if (releaseApplied || !stream) {
      return;
    }
    releaseApplied = true;

    try {
      stream.destroy();
    }
    catch (err) {
      console.log('exports archive cursor release failed:',
        (err && err.message) || err);
    }

    if (stream.cursor) {
      closeDriverCursor();
    }
    else {
      stream.once('cursor', closeDriverCursor);
    }
  }

  output.on('close', function() {
    releaseCursor();
    deferred.resolve({ processed: processed, failed: failed });
  });

  output.on('error', function(err) {
    releaseCursor();
    deferred.reject(err);
  });

  archive.on('error', function(err) {
    releaseCursor();
    deferred.reject(err);
  });

  archive.pipe(output);

  // Iterate the owner's trinkets one document at a time.
  //
  // WHY .cursor(): mongoose removed Query.prototype.stream in 5.x, so on the
  // 6.13.x line this file runs against, the legacy query-stream call this
  // replaced was `undefined` and threw "TypeError: ... is not a function" -
  // archive creation could not begin at all, which is the second half of the
  // same AAP R-b / 0.9.3 gate cited at the head of processBulkExport.
  // Query#cursor() is its documented successor and reproduces the pattern below
  // exactly: a QueryCursor IS a stream.Readable,
  // so pause() inside 'data', asynchronous work, resume() in .finally, 'end'
  // after the last resume and 'error' all behave as they did, yielding every
  // document once, in order, with at most one in flight. The filter and the
  // projection are unchanged, so the documents reaching the archive - and
  // therefore the stored archive layout - are identical.
  var TrinketModel = Trinket.model || mongoose.model('Snippet');
  var stream = TrinketModel.find({ _owner: userId })
    .select('shortCode name lang code assets settings created lastUpdated')
    .cursor();

  // Completes a release that was requested while `stream` was still unassigned
  // (state 1 above, in its narrowest form: the write stream or the archiver
  // failing in the same tick the handlers were registered).
  if (releaseRequested) {
    releaseCursor();
  }

  var trinketPromises = [];

  stream.on('data', function(trinket) {
    stream.pause();

    var trinketPromise = addTrinketToArchive(archive, trinket)
      .then(function(trinketInfo) {
        processed++;
        manifest.trinkets.push(trinketInfo);

        // Update progress every 10 trinkets. One explicit execution, for the
        // assimilation reason documented at the head of processBulkExport;
        // returned from a Q .then handler, so no Q() wrap is needed.
        if (processed % 10 === 0) {
          return (Export.model || mongoose.model('Export')).findByIdAndUpdate(exportId, {
            'progress.processed': processed,
            'progress.failed': failed
          }).exec();
        }
      })
      .fail(function(err) {
        failed++;
        console.log('Failed to add trinket:', trinket.shortCode, err.message);
      })
      .finally(function() {
        stream.resume();
      });

    trinketPromises.push(trinketPromise);
  });

  stream.on('end', function() {
    Q.all(trinketPromises)
      .then(function() {
        // Add manifest
        manifest.totalTrinkets = processed;
        manifest.failedTrinkets = failed;
        archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });

        // Final progress update, single explicit execution as above.
        return (Export.model || mongoose.model('Export')).findByIdAndUpdate(exportId, {
          'progress.processed': processed,
          'progress.failed': failed
        }).exec();
      })
      .then(function() {
        archive.finalize();
      })
      .fail(function(err) {
        releaseCursor();
        deferred.reject(err);
      });
  });

  stream.on('error', function(err) {
    releaseCursor();
    deferred.reject(err);
  });

  return deferred.promise;
}

function addTrinketToArchive(archive, trinket) {
  var deferred = Q.defer();
  var folderName = sanitizeFolderName(trinket.name || trinket.shortCode);
  var basePath = (trinket.lang || 'other') + '/' + folderName + '_' + trinket.shortCode + '/';

  // Add metadata file
  var metadata = {
    shortCode: trinket.shortCode,
    name: trinket.name,
    lang: trinket.lang,
    created: trinket.created,
    lastUpdated: trinket.lastUpdated,
    settings: trinket.settings,
    url: config.url + '/' + trinket.lang + '/' + trinket.shortCode
  };
  archive.append(JSON.stringify(metadata, null, 2), { name: basePath + 'metadata.json' });

  // Parse and add code files
  var codeFiles = parseCodeFiles(trinket);
  codeFiles.forEach(function(file) {
    archive.append(file.content || '', { name: basePath + file.name });
  });

  // Download and add assets
  var assetPromises = [];
  if (trinket.assets && trinket.assets.length) {
    trinket.assets.forEach(function(asset) {
      if (!asset.url) return;

      // Same DEP0169-free swap as downloadAsset; `assetFile` feeds the archive entry
      // name below, which is a preserved file-format contract.
      var assetFile = path.basename(parseLegacy(asset.url).pathname);

      var assetPromise = downloadAsset(asset.url)
        .then(function(buffer) {
          archive.append(buffer, { name: basePath + 'assets/' + (asset.name || assetFile) });
        })
        .fail(function(err) {
          // Log but don't fail entire trinket for one missing asset
          console.log('Asset download failed:', asset.name, err.message);
        });

      assetPromises.push(assetPromise);
    });
  }

  Q.allSettled(assetPromises)
    .then(function() {
      deferred.resolve({
        shortCode: trinket.shortCode,
        name: trinket.name,
        lang: trinket.lang
      });
    })
    .fail(function(err) {
      deferred.reject(err);
    });

  return deferred.promise;
}

function parseCodeFiles(trinket) {
  var code;
  try {
    code = JSON.parse(trinket.code);
    if (!Array.isArray(code)) {
      throw new Error('Not an array');
    }
  } catch(e) {
    // Single file trinket
    var extension = langExtensions[trinket.lang] || '.txt';
    var mainName = /blocks/.test(trinket.lang) ? 'main.xml' : 'main' + extension;

    code = [{
      name: mainName,
      content: trinket.code
    }];
  }
  return code;
}

function sanitizeFolderName(name) {
  return (name || 'untitled')
    .replace(/[^a-zA-Z0-9_\-\s]/g, '')
    .replace(/\s+/g, '_')
    .substring(0, 50);
}

function uploadToS3(localPath, s3Key, filename) {
  var deferred = Q.defer();
  var client = new aws.S3();
  var readStream = fs.createReadStream(localPath);

  client.putObject({
    Bucket: config.aws.buckets.exports.name,
    Key: s3Key,
    Body: readStream,
    ContentType: 'application/zip',
    ContentDisposition: 'attachment; filename="' + filename + '"'
  }, function(err, data) {
    if (err) {
      return deferred.reject(err);
    }

    // Return the S3 key - we'll generate presigned URLs on download
    deferred.resolve(config.aws.buckets.exports.host + '/' + s3Key);
  });

  return deferred.promise;
}

function sendCompletionEmail(user, exportRecord) {
  var subject = 'Your Trinket Export is Ready';

  var templateData = {
    username: user.name || user.username,
    trinketCount: exportRecord.progress ? exportRecord.progress.processed : exportRecord.trinketCount,
    fileSize: formatFileSize(exportRecord.fileSize),
    expiresAt: moment(exportRecord.expiresAt).format('MMM D, YYYY'),
    downloadUrl: config.url + '/api/exports/' + exportRecord._id + '/download'
  };

  var html = nunjucks.render('emails/export-ready', templateData);

  return mailer.send(user.email, subject, { html: html, type: 'export-ready' });
}

function sendFailureEmail(user, errorMessage) {
  var subject = 'Your Trinket Export Failed';

  var templateData = {
    username: user.name || user.username,
    errorMessage: errorMessage || 'An unexpected error occurred'
  };

  var html = nunjucks.render('emails/export-failed', templateData);

  return mailer.send(user.email, subject, { html: html, type: 'export-failed' });
}

function formatFileSize(bytes) {
  if (!bytes) return '0 B';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}
