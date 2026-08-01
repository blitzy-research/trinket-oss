/**
 * AWS S3 access for the application - AWS SDK v3, configured per client.
 *
 * WHY THIS MODULE CHANGED SHAPE
 * aws-sdk v2 exposed a process-global singleton that this module mutated once at
 * require time through the SDK's global config updater, and every `new aws.S3()`
 * inherited the result. v3 has no such singleton: region and credentials belong
 * to each client instance. So rather than exporting the SDK namespace, it exports a
 * configured client factory plus the command classes the application uses.
 * aws-sdk v2 itself is gone because requiring it on Node 22 raises a real
 * process 'warning' event named "NOTE" (its end-of-support notice), which the
 * zero-deprecation-warning boot gate forbids.
 *
 * PUBLIC CONTRACT - require('../../config/aws')
 *   createS3Client()                        A NEW configured S3Client. Replaces
 *                                           `new aws.S3()` one for one.
 *   GetObjectCommand                        replaces client.getObject(...)
 *   PutObjectCommand                        replaces client.putObject(...)
 *   DeleteObjectCommand                     replaces client.deleteObject(...)
 *   getSignedDownloadUrl(params, expiresIn) Promise<string>. Replaces the
 *                                           synchronous
 *                                           client.getSignedUrl('getObject', ...)
 *
 * Commands are issued as `await client.send(new XCommand(params))`; v3 has no
 * callback form, so every callback-style S3 call becomes an awaited call.
 * Command parameter names are UNCHANGED from v2 - Bucket, Key, Body,
 * ContentType, ContentDisposition - so no bucket name, object key or content
 * header has to be reconstructed anywhere.
 *
 *   var aws    = require('../../config/aws'),
 *       client = aws.createS3Client();
 *
 *   // write; Body may be an fs.ReadStream or a Buffer
 *   await client.send(new aws.PutObjectCommand({
 *     Bucket : container.name, Key         : fileinfo.name,
 *     Body   : stream,         ContentType : fileinfo.contentType
 *   }));
 *
 *   // read as a pipeable stream
 *   var response = await client.send(new aws.GetObjectCommand({ Bucket : b, Key : k }));
 *   response.Body.pipe(destination);
 *
 *   // read as a Buffer
 *   var response = await client.send(new aws.GetObjectCommand({ Bucket : b, Key : k }));
 *   var buffer   = Buffer.from(await response.Body.transformToByteArray());
 *
 *   // delete
 *   await client.send(new aws.DeleteObjectCommand({ Bucket : b, Key : filename }));
 *
 *   // presigned download URL - asynchronous under v3
 *   var downloadUrl = await aws.getSignedDownloadUrl({ Bucket : b, Key : k }, 3600);
 *
 * MIGRATION HAZARDS - each one silently turns a working response into a 500
 *
 * 1. .createReadStream() NO LONGER EXISTS. v2 allowed
 *    client.getObject(params).createReadStream().pipe(dest). Under v3 send()
 *    returns a Promise and the resolved response.Body is ALREADY a Node
 *    Readable, so pipe it directly: response.Body.pipe(dest).
 *
 * 2. Body IS A STREAM, NOT A BUFFER. v2's data.Body was a Buffer. Callers that
 *    need bytes must convert with
 *    Buffer.from(await response.Body.transformToByteArray()) -
 *    transformToByteArray() resolves a Uint8Array, so the Buffer.from() wrapper
 *    is what keeps the existing Buffer contract intact. Body can be consumed
 *    only ONCE; a second read throws 'The stream has already been transformed.'
 *
 * 3. STREAM UPLOADS NEED NO ContentLength HERE - measured, do not add one.
 *    Every body this application uploads is either an fs.ReadStream or a Buffer,
 *    and the SDK derives the length of both (via lstatSync/fstatSync for file
 *    streams). A file-stream PutObject was measured to emit
 *    'content-encoding: aws-chunked' with x-amz-decoded-content-length already
 *    correct, and adding an explicit ContentLength produced byte-identical
 *    request headers. Only a body of genuinely unknown length, such as a bare
 *    PassThrough, would need one, and no such upload exists here.
 *
 * 4. PRESIGNING IS ASYNCHRONOUS AND LIVES IN ANOTHER PACKAGE. v3 ships no
 *    synchronous presigner, so getSignedDownloadUrl returns a Promise and its
 *    caller - the export download redirect in lib/controllers/users.js - MUST
 *    await it; using the Promise as a string yields a broken URL. v2's
 *    `Expires: 3600` in seconds is carried through as `{ expiresIn: 3600 }`, and
 *    the result is the same virtual-hosted-style SigV4 URL v2 produced, carrying
 *    X-Amz-Expires=3600.
 *
 * Errors change shape too: v3 throws structured errors carrying
 * $metadata.httpStatusCode and name, where v2 supplied err.code / err.statusCode.
 * A caller that branches on an error must still return the status it returns
 * today.
 */

var awsS3          = require('@aws-sdk/client-s3')
    , awsPresigner = require('@aws-sdk/s3-request-presigner')
    , config       = require('config');

// Resolved once at require time, exactly as the v2 global config update was, so
// every client built below shares a single snapshot of the configuration.
var s3ClientConfig = {
  region : config.aws.region
};

// aws-sdk v2 installed static credentials only when BOTH values were truthy
// (Config.extractCredentials); otherwise it left its credentials unset and fell
// through to the default provider chain - environment, shared profile, instance
// role. config.aws.keyId and config.aws.key ship empty, so that fall-through is
// the normal path and is preserved here: handing v3 an explicitly empty
// credentials object would instead DISABLE the provider chain and change how an
// unconfigured deployment behaves. region is passed unconditionally for the
// mirror-image reason - v2 stored it verbatim, so omitting it would let the
// chain resolve a region where v2 had none.
if (config.aws.keyId && config.aws.key) {
  s3ClientConfig.credentials = {
    accessKeyId       : config.aws.keyId
    , secretAccessKey : config.aws.key
  };
}

// A new client per call, matching the one-client-per-call-site pattern the
// callers already use. Nothing is cached.
function createS3Client() {
  return new awsS3.S3Client(s3ClientConfig);
}

// Presigned GET URL for an object. params takes the same { Bucket, Key } shape
// v2 accepted; expiresIn is the lifetime in seconds that v2 spelled Expires.
function getSignedDownloadUrl(params, expiresIn) {
  return awsPresigner.getSignedUrl(createS3Client(), new awsS3.GetObjectCommand(params), {
    expiresIn : expiresIn
  });
}

module.exports = {
  createS3Client         : createS3Client
  , getSignedDownloadUrl : getSignedDownloadUrl
  , GetObjectCommand     : awsS3.GetObjectCommand
  , PutObjectCommand     : awsS3.PutObjectCommand
  , DeleteObjectCommand  : awsS3.DeleteObjectCommand
};
