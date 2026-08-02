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

// Three entries above are deliberately retained even though nothing reads them, because they were
// already unused at the base commit: `db` is required for its side effect only (it opens the mongoose
// connection at load), `FileUtil` is never called, and `env` is assigned once in processBulkExport and
// never read. Removing them would be opportunistic cleanup rather than part of this migration.
// See docs/PRESERVED-QUIRKS.md.
//
// `q` and `url` are gone from the chain because the async conversion below and the move to the WHATWG
// URL parser removed their last consumers; both packages are also absent from package.json now.

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

// Last path segment of an asset URL, replacing the deprecated legacy parser's pathname read.
//
// The static URL.parse() is used rather than the URL constructor: it returns null instead of throwing
// ERR_INVALID_URL on the protocol-less, relative and bare-filename forms the legacy parser tolerated.
// That null must be neutralised. Both call sites sit in synchronous code reached from a stream 'data'
// handler, so an unguarded read of pathname on a null would be a process-level uncaught exception
// rather than a caught rejection. Falling back to the raw string reproduces the legacy result exactly,
// because for a non-absolute input the legacy parser set pathname to the input itself; verified to give
// identical basenames for absolute, query-bearing, protocol-relative, root-relative and bare inputs.
function assetPathBasename(assetUrl) {
  var parsedAssetUrl = URL.parse(assetUrl);
  return path.basename(parsedAssetUrl ? parsedAssetUrl.pathname : assetUrl);
}

// Download asset from S3
async function downloadAsset(assetUrl) {
  var filename = assetPathBasename(assetUrl);

  var client = aws.createS3Client();
  var response = await client.send(new aws.GetObjectCommand({
    Bucket: config.aws.buckets.userassets.name,
    Key: filename
  }));

  // aws-sdk v2 handed back data.Body as a Buffer; under v3 response.Body is a one-shot Readable, so the
  // bytes are collected here to keep the Buffer this function has always returned. Its caller passes the
  // result straight to archive.append(), which needs a Buffer. A rejected send() propagates the SDK's
  // own error object unchanged, exactly as the callback's reject did.
  return Buffer.from(await response.Body.transformToByteArray());
}

exportsQueue.on('error', function(err) {
  console.log('exports queue error:', err);
});

exportsQueue.on('failed', function(job, err) {
  console.log('exports failed job:', job.jobId, job.data);
  console.log('exports failed err:', err);

  // Left exactly as it was, empty callback included. This is intentional fire-and-forget: the update is
  // started and never awaited, and the callback swallows any failure. It also deliberately calls the
  // PUBLIC Export wrapper in its three-argument form, which is what exercises the argument shifting in
  // lib/models/model.js (a function in the options position becomes the callback). Awaiting it would
  // mean making this listener async and changing the queue's 'failed' event semantics.
  // See docs/PRESERVED-QUIRKS.md.
  if (job.data.exportId) {
    Export.findByIdAndUpdate(job.data.exportId, {
      status: 'failed',
      errorMessage: err.message || 'Unknown error'
    }, function() {});
  }
});

exportsQueue.on('completed', function(job, result) {
  job.remove();
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

  // Everything above runs synchronously before the first await, exactly as it did before the chain
  // became a try block. The assignment below is kept even though `env` is never read: configure() is
  // what points the nunjucks module at the template root, and the two email helpers call
  // nunjucks.render() on the module. See docs/PRESERVED-QUIRKS.md.
  if (!config.isTest) {
    env = nunjucks.configure(config.app.templates);
  }

  // The two-branch model fallbacks below are written out at every call site rather than hoisted, because
  // the left branch is only defined under NODE_ENV=test or =migration and the right branch must stay
  // lazily evaluated per call - resolving it once at module load could run before the schema is
  // registered. See docs/PRESERVED-QUIRKS.md.
  try {
    exportRecord = await (Export.model || mongoose.model('Export'))
      .findByIdAndUpdate(exportId, { status: 'processing' });

    user = await (User.model || mongoose.model('User')).findById(userId);
    if (!user) {
      throw new Error('User not found');
    }

    // Count total trinkets
    // The method invoked here is deprecated in mongoose 6 and removed in 7, which is one reason mongoose
    // is held inside the 6.x line. Its modern replacement is available on the model but is deliberately
    // not used, because switching would be a latent-bug repair rather than part of this migration.
    // See docs/PRESERVED-QUIRKS.md.
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
    // The empty catch reproduces the empty callback this used to pass to fs.unlink: a cleanup failure
    // has always been swallowed here. See docs/PRESERVED-QUIRKS.md.
    await fs.promises.unlink(tempFile).catch(function() {});
  }
  catch (err) {
    // Cleanup on failure
    // The guard is kept even though tempFile is assigned unconditionally above, and the swallow is
    // load-bearing rather than cosmetic: were the unlink allowed to reject, err.message below would
    // never be persisted and the failure text this worker reports would change.
    // See docs/PRESERVED-QUIRKS.md.
    if (tempFile) {
      await fs.promises.unlink(tempFile).catch(function() {});
    }

    await (Export.model || mongoose.model('Export')).findByIdAndUpdate(exportId, {
      status: 'failed',
      errorMessage: err.message
    });

    if (user) {
      await sendFailureEmail(user, err.message);
    }

    // Rethrown unchanged - same object, same message, same name - so the queue's 'failed' listener and
    // the persisted errorMessage stay identical. Note there is deliberately no inner try/catch: if
    // either step above throws, that error surfaces instead of this one, which is what the original
    // handler's own untrapped chain did.
    throw err;
  }
}

// A deferred rather than an async function, because the result is settled from five different event
// handlers ('close', two 'error' paths on output and archive, the stream's own 'error', and the tail of
// the 'end' chain) and an async function body cannot express that. Wrapping the body in a Promise
// executor also keeps the synchronous throw described below behaving exactly as it did: a throw inside
// the executor is captured and becomes a rejection of this promise.
function createExportArchive(userId, exportId, tempFile) {
  return new Promise(function(resolve, reject) {
    var archive = archiver('zip', { zlib: { level: 6 } });
    var output = fs.createWriteStream(tempFile);
    var processed = 0;
    var failed = 0;
    var manifest = {
      exportedAt: new Date().toISOString(),
      trinkets: []
    };

    output.on('close', function() {
      resolve({ processed: processed, failed: failed });
    });

    output.on('error', function(err) {
      reject(err);
    });

    archive.on('error', function(err) {
      reject(err);
    });

    archive.pipe(output);

    // Use stream to iterate trinkets (older mongoose API)
    //
    // Query#stream() was removed in mongoose 5 and this repository runs 6.x, so this call throws
    // `TypeError: ... .stream is not a function` and has done since the driver was last upgraded. That
    // throw is the behaviour at the base commit: it is caught by the promise machinery here, surfaces in
    // processBulkExport's catch, and its message is what gets persisted as the export's errorMessage.
    // Rewriting it to .cursor() would repair a latent bug and change that recorded message, so it is
    // preserved verbatim. See docs/PRESERVED-QUIRKS.md.
    var TrinketModel = Trinket.model || mongoose.model('Snippet');
    var stream = TrinketModel.find({ _owner: userId })
      .select('shortCode name lang code assets settings created lastUpdated')
      .stream();

    var trinketPromises = [];

    // Deliberately a plain function, not async: it pauses the stream, builds the per-trinket chain and
    // relies on the finally() below to resume. Making it async would move the resume onto a later
    // microtask and change the backpressure timing.
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
          archive.finalize();
        })
        .catch(function(err) {
          reject(err);
        });
    });

    stream.on('error', function(err) {
      reject(err);
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
  // settled set here preserves that ordering; a sequential `for ... await` loop would quietly reorder
  // the entries and change the produced archive. See docs/PRESERVED-QUIRKS.md.
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
  var client = aws.createS3Client();
  var readStream = fs.createReadStream(localPath);

  // Every parameter name below is unchanged from v2, so the stored object keeps the same key, content
  // type and Content-Disposition header - including the quotes around the filename, which reach the
  // browser on download. No ContentLength is supplied: the body is an fs.ReadStream, whose length the
  // SDK derives itself, and config/aws.js records that adding one was measured to produce byte-identical
  // request headers. The resolved response is discarded here exactly as the callback's `data` was.
  await client.send(new aws.PutObjectCommand({
    Bucket: config.aws.buckets.exports.name,
    Key: s3Key,
    Body: readStream,
    ContentType: 'application/zip',
    ContentDisposition: 'attachment; filename="' + filename + '"'
  }));

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
