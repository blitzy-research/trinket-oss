var exportsQueue = require('../util/queues').exports()
  , db           = require('../../config/db')
  , config       = require('../../config/app.config')
  , nunjucks     = require('nunjucks')
  , moment       = require('moment')
  , fs           = require('fs')
  , path         = require('path')
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

// `db`, `FileUtil` and `env` are deliberately retained even though nothing reads them: `db` is required
// for its side effect only - it opens the mongoose connection at load - while `FileUtil` is never
// called and `env` is assigned once in processBulkExport and never read.

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

// Last path segment of an asset URL. URL.parse() returns null rather than throwing on the protocol-less,
// relative and bare-filename forms the legacy parser tolerated, and that null must be neutralised: both
// call sites are reached synchronously from a stream 'data' handler, so an unguarded pathname read would
// be an uncaught exception rather than a caught rejection. Falling back to the raw string reproduces the
// legacy result, which for a non-absolute input was the input itself.
// See docs/PRESERVED-QUIRKS.md section 3.13.
function assetPathBasename(assetUrl) {
  var parsed = URL.parse(assetUrl);

  return path.basename(parsed ? parsed.pathname : assetUrl);
}

// Download asset from S3
async function downloadAsset(assetUrl) {
  var filename = assetPathBasename(assetUrl);

  // The ONE client this process owns, not a new one per asset. config/aws.js records the measurement:
  // aws-sdk v2's clients shared a process-global agent singleton and had no destroy method, so the
  // `new aws.S3()` this replaced never owned a pool to leak, whereas every v3 client owns its own. An
  // export can download hundreds of assets, so a client per asset was hundreds of pools. Teardown
  // belongs to the application - app.js releases it on the hapi server's 'stop' event - and NOT to this
  // function, which must not destroy a client the rest of the process is still using.
  var client = aws.getS3Client();
  var response = await client.send(new aws.GetObjectCommand({
    Bucket: config.aws.buckets.userassets.name,
    Key: filename
  }));

  // response.Body is a one-shot Readable, so the bytes are collected here to keep the Buffer this function
  // returns; its caller passes the result straight to archive.append(), which needs a Buffer. A rejected
  // send() propagates the SDK's own error object unchanged.
  return Buffer.from(await response.Body.transformToByteArray());
}

exportsQueue.on('error', function(err) {
  console.log('exports queue error:', err);
});

exportsQueue.on('failed', function(job, err) {
  // The identifier is `job.id`: bull exposes no `jobId` property on the instance, so reading one here
  // would log `undefined`. `job.data` is logged alongside it.
  // See docs/PRESERVED-QUIRKS.md section 3.27.
  console.log('exports failed job:', job.id, job.data);
  console.log('exports failed err:', err);

  // Intentional fire-and-forget: the update is started and never awaited, and the empty callback swallows
  // any failure. It also calls the public Export wrapper in its three-argument form, which is what
  // exercises the argument shifting in lib/models/model.js - a function in the options position becomes
  // the callback. Awaiting it would mean making this listener async and changing the 'failed' semantics.
  if (job.data.exportId) {
    Export.findByIdAndUpdate(job.data.exportId, {
      status: 'failed',
      errorMessage: err.message || 'Unknown error'
    }, function() {});
  }
});

exportsQueue.on('completed', function(job, result) {
  // Fire-and-forget, and it must stay that way: awaiting the removal would put the 'completed' listener's
  // return value behind a Redis round trip and make this listener async, changing the completion timing the
  // queue reports. The terminal catch is OWNERSHIP only - remove() returns a promise, and a dropped Redis
  // connection is enough to reject it - and it is empty because a removal failure is invisible here.
  job.remove().catch(function(removeError) {
    return removeError;
  });
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

async function processBulkExport(job) {
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

  // `env` is assigned but never read: configure() is what points the nunjucks module at the template root,
  // and the two email helpers call nunjucks.render() on the module.
  if (!config.isTest) {
    env = nunjucks.configure(config.app.templates);
  }

  // The two-branch model fallbacks below are written out at every call site rather than hoisted: the left
  // branch is only defined under NODE_ENV=test or =migration, and the right branch must stay lazily
  // evaluated per call because resolving it once at module load could run before the schema is registered.
  try {
    exportRecord = await (Export.model || mongoose.model('Export'))
      .findByIdAndUpdate(exportId, { status: 'processing' });

    user = await (User.model || mongoose.model('User')).findById(userId);
    if (!user) {
      throw new Error('User not found');
    }

    // Count total trinkets
    // count() is deprecated in mongoose 6 and removed in 7, which is one reason mongoose is held inside the
    // 6.x line. countDocuments() is available on the model and is deliberately not used here, because it
    // takes a different driver path. See docs/PRESERVED-QUIRKS.md section 3.24.
    var count = await (Trinket.model || mongoose.model('Snippet')).count({ _owner: userId });

    // Update total count
    await (Export.model || mongoose.model('Export')).findByIdAndUpdate(exportId, {
      'progress.total': count,
      trinketCount: count
    });

    // Create the archive
    await createExportArchive(userId, exportId, tempFile);

    // Upload to S3
    var downloadUrl = await uploadToS3(tempFile, s3Key, filename);

    var expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + EXPORT_EXPIRY_DAYS);

    // Get file size
    var stats = fs.statSync(tempFile);

    // Update export record with completion
    exportRecord = await (Export.model || mongoose.model('Export')).findByIdAndUpdate(exportId, {
      status: 'completed',
      downloadUrl: downloadUrl,
      s3Key: s3Key,
      expiresAt: expiresAt,
      fileSize: stats.size
    }, { new: true });

    // Send notification email
    await sendCompletionEmail(user, exportRecord);

    // Cleanup temp file
    //
    // DELIBERATELY NOT AWAITED: the export job completes the instant the notification email resolves,
    // with the deletion still in flight, and awaiting it would move the queue's own completion signal
    // behind a filesystem operation. The catch is empty because a cleanup failure is swallowed here, and
    // it must stay swallowed rather than becoming an unowned rejection. See docs/PRESERVED-QUIRKS.md.
    fs.promises.unlink(tempFile).catch(function() {});
  }
  catch (err) {
    // Cleanup on failure
    //
    // DELIBERATELY NOT AWAITED, for a sharper reason than in the success tail: the failed-status write
    // and the failure email follow IMMEDIATELY, so awaiting the deletion would put both behind a slow or
    // hanging filesystem. The swallow is load-bearing rather than cosmetic - were the unlink allowed to
    // reject, `err.message` below would never be persisted and the failure text this worker reports would
    // change. The guard is kept even though tempFile is assigned unconditionally above.
    // See docs/PRESERVED-QUIRKS.md.
    if (tempFile) {
      fs.promises.unlink(tempFile).catch(function() {});
    }

    await (Export.model || mongoose.model('Export')).findByIdAndUpdate(exportId, {
      status: 'failed',
      errorMessage: err.message
    });

    if (user) {
      await sendFailureEmail(user, err.message);
    }

    // Rethrown unchanged - same object, same message, same name - so the queue's 'failed' listener and the
    // persisted errorMessage stay identical. There is deliberately no inner try/catch: if either step above
    // throws, that error surfaces instead of this one.
    throw err;
  }
}

// A Promise executor rather than an async function, because the result is settled from five different
// event handlers - 'close', the two 'error' paths on output and archive, the stream's own 'error', and
// the tail of the 'end' chain - which an async function body cannot express. A synchronous throw inside
// the executor is captured and becomes a rejection of this promise.
function createExportArchive(userId, exportId, tempFile) {
  return new Promise(function(resolve, reject) {
    var archive = archiver('zip', { zlib: { level: 6 } });
    var output = fs.createWriteStream(tempFile);
    var processed = 0;
    var failed = 0;
    var released = false;
    var stream;
    var manifest = {
      exportedAt: new Date().toISOString(),
      trinkets: []
    };

    // RESOURCE OWNERSHIP. Every rejection below routes through here rather than calling reject()
    // directly, because by the time any of them can fire the executor has allocated an archiver and an
    // OPEN file descriptor for `tempFile` and piped one into the other. The `Query#stream()` TypeError
    // below throws on EVERY job, so this is not an edge case: without it each bulk export would leave a
    // write stream open and an archiver alive with no consumer for the life of the process.
    //
    // The error is propagated UNCHANGED - same object, same message, same name - because
    // processBulkExport persists `err.message` as the export's errorMessage and emails it to the user.
    // Cleanup happens BEFORE the reject so the descriptor is gone by the time the caller runs, and it is
    // ONCE-ONLY: `archive.abort()` makes archiver emit 'error' and `output.destroy()` makes the write
    // stream emit 'close', both of which re-enter this function, and a second entry must neither
    // re-clean nor change the settled reason. Promise settle-once protects the reason; `released`
    // protects the cleanup and keeps the FIRST error the winner.
    //
    // Nothing here resolves, and the normal path is untouched: `output.on('close')` remains the sole
    // completion signal, so a successful archive resolves with the processed/failed counts only after the
    // file is fully written.
    function releaseAndReject(err) {
      if (released) {
        return;
      }

      released = true;

      // The query stream exists only once `.stream()` has returned, which on this mongoose line it never
      // does; the guard is what makes the same path usable for the output and archive error listeners.
      if (stream && typeof stream.destroy === 'function') {
        stream.destroy();
      }

      // abort() rather than finalize(): finalize would write a valid ZIP central directory for an archive
      // this job is abandoning. abort() releases archiver's queue and its pending source streams.
      try {
        archive.abort();
      }
      catch (abortError) {
        // Swallowed deliberately. archiver 7 raises from abort() when the archive was never finalized or is
        // already aborted, and neither says anything about WHY the job failed. Letting it out would replace
        // the error this function was called with, which is the one persisted and emailed.
      }

      if (!output.destroyed) {
        output.destroy();
      }

      reject(err);
    }

    output.on('close', function() {
      resolve({ processed: processed, failed: failed });
    });

    output.on('error', function(err) {
      releaseAndReject(err);
    });

    archive.on('error', function(err) {
      releaseAndReject(err);
    });

    archive.pipe(output);

    // Use stream to iterate trinkets (older mongoose API)
    //
    // PRESERVED QUIRK: `Query#stream()` does not exist on this mongoose line, so this call throws
    // `TypeError: <query>.stream is not a function` on every job. The throw surfaces in
    // processBulkExport's catch, and its message is what gets persisted as the export's errorMessage and
    // emailed to the user, so the call and the resulting failure are both preserved and the query is
    // unchanged, field selection included. See docs/PRESERVED-QUIRKS.md section 3.24.
    //
    // The try is resource ownership, not error handling: a synchronous throw inside a Promise executor
    // rejects DIRECTLY without running any of the listeners wired above, so the archiver and the open
    // `tempFile` descriptor would be abandoned on the one path this worker takes every time. Routing the
    // identical error through releaseAndReject closes them first and rejects with the same object.
    try {
      var TrinketModel = Trinket.model || mongoose.model('Snippet');
      stream = TrinketModel.find({ _owner: userId })
        .select('shortCode name lang code assets settings created lastUpdated')
        .stream();
    }
    catch (queryStreamError) {
      releaseAndReject(queryStreamError);
      return;
    }

    var trinketPromises = [];

    // Deliberately a plain function, not async: it pauses the stream, builds the per-trinket chain and
    // relies on the finally() below to resume. Making it async would change the backpressure timing.
    stream.on('data', function(trinket) {
      stream.pause();

      var trinketPromise = addTrinketToArchive(archive, trinket)
        .then(function(trinketInfo) {
          processed++;
          manifest.trinkets.push(trinketInfo);

          // Update progress every 10 trinkets
          if (processed % 10 === 0) {
            return (Export.model || mongoose.model('Export')).findByIdAndUpdate(exportId, {
              'progress.processed': processed,
              'progress.failed': failed
            });
          }
        })
        .catch(function(err) {
          // Counts and logs but does not rethrow, so this promise RESOLVES. That is what stops one bad
          // trinket from rejecting the Promise.all below and failing the whole export.
          failed++;
          console.log('Failed to add trinket:', trinket.shortCode, err.message);
        })
        .finally(function() {
          stream.resume();
        });

      trinketPromises.push(trinketPromise);
    });

    stream.on('end', function() {
      Promise.all(trinketPromises)
        .then(function() {
          // Add manifest
          manifest.totalTrinkets = processed;
          manifest.failedTrinkets = failed;
          archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });

          // Final progress update
          return (Export.model || mongoose.model('Export')).findByIdAndUpdate(exportId, {
            'progress.processed': processed,
            'progress.failed': failed
          });
        })
        .then(function() {
          // RETURNED, not called and dropped: finalize() returns a promise, and leaving the call bare
          // would leave a rejection nobody owns. Returning it chains that rejection into the .catch()
          // immediately below, which is the SAME rejection path the `archive.on('error', ...)` listener
          // above takes, so no outcome changes.
          //
          // Output-stream close stays the completion signal - `output.on('close', ...)` resolves with the
          // processed/failed counts, and nothing here resolves. This is the same ownership decision taken
          // at trinket.js's downloadPostedZip, and deliberately NOT the one taken at its downloadZip,
          // whose misspelled `'err'` listener means its rejection must be consumed without settling
          // anything. See docs/PRESERVED-QUIRKS.md section 3.20.
          return archive.finalize();
        })
        .catch(function(err) {
          releaseAndReject(err);
        });
    });

    stream.on('error', function(err) {
      releaseAndReject(err);
    });
  });
}

async function addTrinketToArchive(archive, trinket) {
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

      var assetFile = assetPathBasename(asset.url);

      var assetPromise = downloadAsset(asset.url)
        .then(function(buffer) {
          archive.append(buffer, { name: basePath + 'assets/' + (asset.name || assetFile) });
        })
        .catch(function(err) {
          // Log but don't fail entire trinket for one missing asset
          console.log('Asset download failed:', asset.name, err.message);
        });

      assetPromises.push(assetPromise);
    });
  }

  // The forEach above already started every download, so each asset is appended as its own download
  // resolves and the archive records them in completion order, not declaration order. Awaiting the
  // settled set preserves that ordering; a sequential `for ... await` loop would reorder the entries.
  await Promise.allSettled(assetPromises);

  return {
    shortCode: trinket.shortCode,
    name: trinket.name,
    lang: trinket.lang
  };
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

async function uploadToS3(localPath, s3Key, filename) {
  // The one shared client, released by app.js on server stop - see the note in downloadAsset above.
  // A per-call client would leave its own socket pool behind on every upload.
  var client = aws.getS3Client();

  // The archive MUST declare its own byte length: PutObjectCommand cannot compute one from an arbitrary
  // Node stream. The stat is taken from this function's own `localPath` because the fs.statSync in
  // processBulkExport runs AFTER this call and cannot be reused. A stat failure rejects into the same
  // catch - and so the same persisted-failure branch - that a rejected putObject reaches, differing only
  // in naming `stat` rather than `open`.
  //
  // It is taken BEFORE the read stream is opened, because a ReadStream holds an open descriptor from
  // construction, so opening first would let a stat rejection abandon one.
  var stats = await fs.promises.stat(localPath);

  var readStream = fs.createReadStream(localPath);

  // Every parameter name below is unchanged from v2, so the stored object keeps the same key, content
  // type and Content-Disposition header - including the quotes around the filename, which reach the
  // browser on download. The resolved response is discarded here exactly as the callback's `data` was.
  //
  // A rejected send may leave the stream unconsumed, and processBulkExport unlinks `localPath`
  // immediately afterwards, so the descriptor is released here before the rejection is re-thrown
  // UNCHANGED - same object, same message - to the persisted-failure branch that reports it.
  try {
    await client.send(new aws.PutObjectCommand({
      Bucket: config.aws.buckets.exports.name,
      Key: s3Key,
      Body: readStream,
      ContentLength: stats.size,
      ContentType: 'application/zip',
      ContentDisposition: 'attachment; filename="' + filename + '"'
    }));
  }
  catch (uploadError) {
    if (!readStream.destroyed && !readStream.closed) {
      readStream.destroy();
    }

    throw uploadError;
  }

  // Return the S3 key - we'll generate presigned URLs on download
  return config.aws.buckets.exports.host + '/' + s3Key;
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
