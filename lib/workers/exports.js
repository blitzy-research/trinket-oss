// The order of the two requires below is load-bearing: config/app.config must
// load before config/db. config/db pulls in mongoose-schema-extend, whose
// transitive Proxy polyfill replaces the global Object.getPrototypeOf, and once
// that has happened the schema libraries app.config reaches (joi, and
// @hapi/validate under @hapi/hapi) throw "Schema can only contain plain
// objects" and this module cannot be required at all. app.config requires
// ./db itself, so loading it first fixes the relative order and the `db`
// require below is served from the module cache.
//
// `db` is intentionally unused as an identifier: config/db.js connects at module
// scope, so this require is what opens the worker's Mongo connection. Removing
// it as an "unused variable" would leave the worker with no database.
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

// How long a completed export stays downloadable. The date this yields is
// written onto the Export record as `expiresAt`, the download route refuses a
// record past it, and the mail tells the owner that date - so changing this
// number changes all three.
var EXPORT_EXPIRY_DAYS = 3;

// The file extension an exported single-file trinket is given, per trinket
// language. A language absent from this table falls back to `.txt`, so a new
// language exports as plain text until it is listed here.
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

// Fetches one stored asset's bytes for inclusion in an export archive.
function downloadAsset(assetUrl) {
  var deferred = Q.defer();
  // An asset URL's basename IS its S3 Key: the upload stores the object under
  // `<sha1>-<fileId>.<ext>` and publishes the bucket host in front of it. So
  // anything that changed how `pathname` is derived here would request a key
  // that does not exist, and since the caller logs and swallows a failed asset,
  // the archive would quietly lose its assets instead of failing. A malformed
  // URL throws synchronously, before `deferred.promise` is returned, so the
  // caller sees a throw rather than a rejection.
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

// A queue-level error - the backing connection, not a job - is logged and
// nothing more. The listener itself matters: an 'error' event with no listener
// is thrown, so without this a connection blip would end the worker.
exportsQueue.on('error', function(err) {
  console.log('exports queue error:', err);
});

exportsQueue.on('failed', function(job, err) {
  // This is the local 'failed' event, which carries the Job object, so the
  // identifier is `job.id` and the payload `job.data`; the 'global:failed' event
  // would deliver a raw id string and neither field. The in-memory queue in
  // lib/util/queues emits the same {id, data, opts, attempts} shape, so this
  // handler reads the same fields with or without Redis.
  console.log('exports failed job:', job.id, job.data);
  console.log('exports failed err:', err);

  // The empty callback is what executes this query - the model passes it
  // straight to mongoose - and it deliberately swallows the write's own error:
  // this is an event listener with nobody to reject to, and a failed status
  // write must not take the worker down on top of a failed job.
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

// The queue's processor. It returns the job's promise rather than taking a done
// callback, so the queue completes the job when that promise resolves and fails
// it when the promise rejects - which is what routes every error below into the
// 'failed' handler above.
exportsQueue.process(function(job) {
  var action = job.data.action;

  if (action === 'bulk-export') {
    return processBulkExport(job);
  }
  else {
    return Promise.reject(new Error('Unknown action: ' + action));
  }
});

// Runs one bulk export end to end: mark the record processing, count the owner's
// trinkets, build the archive, upload it, record completion and mail the owner.
// Each stage's promise is returned into the next, so the job settles only when
// the whole sequence has, and any stage's failure reaches the `.fail` branch at
// the bottom, which records it and re-rejects.
function processBulkExport(job) {
  var exportId = job.data.exportId
    , userId   = job.data.userId
    , exportRecord
    , user
    , tempFile
    , s3Key
    , filename;

  // The archive is stored under the Key `exports/<userId>/<filename>`, where
  // filename is `trinket-export-<12 hex chars>.zip` derived from the owner and
  // the current millisecond. The completed Export record persists that key and
  // the download route signs a URL from it, so the format is a stored-data
  // contract: an existing export can only be found under the key it was written
  // with. The local copy is built at the same name under /tmp, and its removal
  // is ATTEMPTED on both the success and the failure path with the unlink's own
  // error swallowed, so a file that cannot be removed simply stays there.
  var timestamp = Date.now();
  var hash = crypto.createHash('sha1')
    .update(userId + timestamp.toString())
    .digest('hex')
    .substring(0, 12);

  filename = 'trinket-export-' + hash + '.zip';
  tempFile = '/tmp/' + filename;
  s3Key = 'exports/' + userId + '/' + filename;

  // configure() installs the default nunjucks environment that the mail
  // templates are rendered through further down; the returned `env` itself is
  // never read.
  if (!config.isTest) {
    env = nunjucks.configure(config.app.templates);
  }

  return Q.nsend(Export.model || mongoose.model('Export'), 'findByIdAndUpdate', exportId, { status: 'processing' })
    .then(function(record) {
      exportRecord = record;
      return Q.nsend(User.model || mongoose.model('User'), 'findById', userId);
    })
    .then(function(foundUser) {
      user = foundUser;
      if (!user) {
        throw new Error('User not found');
      }

      // Count total trinkets
      return Q.nsend(Trinket.model || mongoose.model('Snippet'), 'count', { _owner: userId });
    })
    .then(function(count) {
      // Update total count
      return Q.nsend(Export.model || mongoose.model('Export'), 'findByIdAndUpdate', exportId, {
        'progress.total': count,
        trinketCount: count
      });
    })
    .then(function() {
      return createExportArchive(userId, exportId, tempFile);
    })
    .then(function(result) {
      return uploadToS3(tempFile, s3Key, filename);
    })
    .then(function(downloadUrl) {
      var expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + EXPORT_EXPIRY_DAYS);

      // The size stored on the record and quoted in the mail is read from the
      // local copy, which is why it is taken here and the file is not removed
      // until the mail has been sent.
      var stats = fs.statSync(tempFile);

      // Update export record with completion
      return Q.nsend(Export.model || mongoose.model('Export'), 'findByIdAndUpdate', exportId, {
        status: 'completed',
        downloadUrl: downloadUrl,
        s3Key: s3Key,
        expiresAt: expiresAt,
        fileSize: stats.size
      }, { new: true });
    })
    .then(function(record) {
      // `record` is the post-update document, which is why the mail can report
      // the final progress and file size.
      exportRecord = record;
      return sendCompletionEmail(user, exportRecord);
    })
    .then(function() {
      // The archive has been uploaded, so the local copy is dropped without
      // waiting for it: the empty callback deliberately swallows the unlink's
      // error, since a temp file that cannot be removed is not a failed export.
      fs.unlink(tempFile, function() {});
      return Promise.resolve();
    })
    .fail(function(err) {
      // A part-written archive is dropped on the way out, with the same
      // swallowed error as the success path.
      if (tempFile) {
        fs.unlink(tempFile, function() {});
      }

      return Q.nsend(Export.model || mongoose.model('Export'), 'findByIdAndUpdate', exportId, {
        status: 'failed',
        errorMessage: err.message
      })
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

// Builds the zip at `tempFile` from every trinket the user owns and resolves
// `{processed, failed}` once the file is closed. Compression level 6 is the
// trade the archive is written with: a smaller file than the fast levels without
// the CPU the maximum costs, on a worker that also holds a cursor open.
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

  // Resolution hangs off the write stream's 'close', not off `archive.finalize()`
  // - only 'close' means every byte has reached the file. The caller stats and
  // uploads `tempFile` as soon as this resolves, so resolving any earlier would
  // upload a truncated archive.
  output.on('close', function() {
    deferred.resolve({ processed: processed, failed: failed });
  });

  output.on('error', function(err) {
    deferred.reject(err);
  });

  archive.on('error', function(err) {
    deferred.reject(err);
  });

  // Piping before the iteration starts means every appended entry has somewhere
  // to go; the archive is written as it is read rather than assembled in memory.
  archive.pipe(output);

  // Use stream to iterate trinkets (older mongoose API)
  var TrinketModel = Trinket.model || mongoose.model('Snippet');
  var stream = TrinketModel.find({ _owner: userId })
    .select('shortCode name lang code assets settings created lastUpdated')
    .stream();

  var trinketPromises = [];

  stream.on('data', function(trinket) {
    stream.pause();

    var trinketPromise = addTrinketToArchive(archive, trinket)
      .then(function(trinketInfo) {
        processed++;
        manifest.trinkets.push(trinketInfo);

        // Progress is written every tenth trinket rather than on every one, so
        // a large export costs a bounded number of writes while still moving
        // the progress the UI polls. `.exec()` keeps this query to a single
        // execution.
        if (processed % 10 === 0) {
          return Q.nsend(Export.model || mongoose.model('Export'), 'findByIdAndUpdate', exportId, {
            'progress.processed': processed,
            'progress.failed': failed
          });
        }
      })
      // One trinket that cannot be archived is counted and reported in the
      // manifest, not fatal: the export completes with `failedTrinkets` set.
      .fail(function(err) {
        failed++;
        console.log('Failed to add trinket:', trinket.shortCode, err.message);
      })
      // Resuming from `.finally` is what advances the cursor, on both the
      // success and the failure path. Without it the iteration stops at the
      // first trinket and 'end' never fires.
      .finally(function() {
        stream.resume();
      });

    trinketPromises.push(trinketPromise);
  });

  stream.on('end', function() {
    Q.all(trinketPromises)
      .then(function() {
        // Waiting on every trinket's promise before appending means the manifest
        // carries the final counts, and `manifest.json` is the archive's index
        // of what it contains.
        manifest.totalTrinkets = processed;
        manifest.failedTrinkets = failed;
        archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });

        // Final progress update
        return Q.nsend(Export.model || mongoose.model('Export'), 'findByIdAndUpdate', exportId, {
          'progress.processed': processed,
          'progress.failed': failed
        });
      })
      // Finalizing closes the zip, which is what makes the write stream emit
      // 'close' and resolve this function's promise.
      .then(function() {
        archive.finalize();
      })
      .fail(function(err) {
        deferred.reject(err);
      });
  });

  stream.on('error', function(err) {
    deferred.reject(err);
  });

  return deferred.promise;
}

// Writes one trinket into the archive: its metadata, its code files and its
// assets, all under `<lang>/<sanitized name>_<shortCode>/`. That layout is what
// a downloaded export contains, so it is a file-format contract - the shortCode
// suffix is what keeps two trinkets with the same name in separate folders.
function addTrinketToArchive(archive, trinket) {
  var deferred = Q.defer();
  var folderName = sanitizeFolderName(trinket.name || trinket.shortCode);
  var basePath = (trinket.lang || 'other') + '/' + folderName + '_' + trinket.shortCode + '/';

  // metadata.json carries the trinket's identity and its URL on the site, so a
  // downloaded export can be traced back to what it came from.
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

  // A trinket's code is either a JSON array of files or a single file's source;
  // parseCodeFiles resolves both to the same list.
  var codeFiles = parseCodeFiles(trinket);
  codeFiles.forEach(function(file) {
    archive.append(file.content || '', { name: basePath + file.name });
  });

  // Each asset is fetched from storage and filed under `assets/` in this
  // trinket's folder. The entry name is the asset's own name when it has one,
  // and the stored object's basename otherwise, which is what the trinket's
  // code refers to.
  var assetPromises = [];
  if (trinket.assets && trinket.assets.length) {
    trinket.assets.forEach(function(asset) {
      if (!asset.url) return;

      var assetFile = path.basename(parseLegacy(asset.url).pathname);

      var assetPromise = downloadAsset(asset.url)
        .then(function(buffer) {
          archive.append(buffer, { name: basePath + 'assets/' + (asset.name || assetFile) });
        })
        // One asset that cannot be fetched is logged and skipped; the trinket
        // is still archived with everything else it has.
        .fail(function(err) {
          console.log('Asset download failed:', asset.name, err.message);
        });

      assetPromises.push(assetPromise);
    });
  }

  // allSettled, not all: this resolves once every asset has finished either
  // way, so a rejected asset cannot cut the trinket's own entry short.
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
    // Anything that is not a JSON array of files is a single-file trinket, and
    // its one file is named for its language - `main.xml` for the block
    // languages, `main` plus the language's extension otherwise, falling back to
    // `.txt` for a language langExtensions does not list.
    var extension = langExtensions[trinket.lang] || '.txt';
    var mainName = /blocks/.test(trinket.lang) ? 'main.xml' : 'main' + extension;

    code = [{
      name: mainName,
      content: trinket.code
    }];
  }
  return code;
}

// Reduces a trinket name to a folder name: everything outside letters, digits,
// underscore, hyphen and whitespace is dropped, runs of whitespace become single
// underscores, and the result is capped at 50 characters so a long name cannot
// push an archive entry past what a filesystem will accept on extraction.
function sanitizeFolderName(name) {
  return (name || 'untitled')
    .replace(/[^a-zA-Z0-9_\-\s]/g, '')
    .replace(/\s+/g, '_')
    .substring(0, 50);
}

// Uploads the finished archive under `s3Key` and resolves the bucket-host URL of
// the stored object. The ContentDisposition is stored with the object, so the
// download arrives as an attachment named `filename` rather than rendering.
function uploadToS3(localPath, s3Key, filename) {
  var deferred = Q.defer();
  var client = new aws.S3();
  // A read stream, so an archive of any size uploads without being held in
  // memory.
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

    // Resolves the object's bucket-host URL, which the caller persists as the
    // Export record's `downloadUrl`. The download route does not serve that URL:
    // it signs a fresh presigned URL from the record's `s3Key`, so the key is
    // what has to survive, not this string.
    deferred.resolve(config.aws.buckets.exports.host + '/' + s3Key);
  });

  return deferred.promise;
}

// Mails the owner that the export is ready. The link points at the application's
// own download route rather than at storage, so the request is authorized and
// the expiry checked before any presigned URL is issued.
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

// Renders a byte count for the notification mail in the largest unit that keeps
// it above 1, to one decimal place.
function formatFileSize(bytes) {
  if (!bytes) return '0 B';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}
