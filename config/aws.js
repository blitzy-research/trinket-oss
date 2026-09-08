var AWS           = require('aws-sdk')
    , config      = require('config')
    , parseLegacy = require('../lib/util/url').parseLegacy;

// Suppress the SDK v2 end-of-support NOTE. The flag is read from a `setTimeout(..., 0)`
// the SDK schedules as it loads, so it takes effect only while set synchronously here.
require('aws-sdk/lib/maintenance_mode_message').suppress = true;

// Substitute this repository's own legacy URL parser for the SDK's, so the SDK
// stops emitting `[DEP0169] url.parse()` on the request path.
//
// WHAT IS REPLACED, AND WHY HERE. `AWS.util.urlParse`
// [node_modules/aws-sdk/lib/util.js:59-61] is one function whose whole body is
// `return util.url.parse(url)`, and it is the SDK's only URL-parsing seam: its
// three callers are `new AWS.Endpoint` [lib/http.js:58], which the `Service`
// constructor reaches through `setEndpoint` [lib/service.js:669] so EVERY
// `new AWS.S3()` parses its endpoint; `getSignedUrl`'s query signer
// [lib/signers/presign.js:45], live in this application on the avatar/asset
// signing path; and the ECS full-URI credential provider
// [lib/credentials/remote_credentials.js:79]. Under
// `--pending-deprecation --trace-deprecation` the first of those prints
// DEP0169 with the stack `node:url` <- `aws-sdk/lib/util.js:60` <-
// `new Endpoint` <- `setEndpoint` <- `Service`. Because this module is the
// repository's sole `require('aws-sdk')` and hands the same object to all
// seven client-construction sites, replacing the seam once here covers all of
// them, including the presign seam, and no call site changes.
//
// This is a parse-IMPLEMENTATION substitution, not a behaviour change.
// `parseLegacy` [lib/util/url.js] transcribes the runtime's own
// `Url.prototype.parse`, returns a real `Url` instance carrying the identical
// legacy field set (protocol, slashes, auth, host, port, hostname, hash,
// search, query, pathname, path, href) and throws what `url.parse()` throws,
// so the same endpoint string in yields the same fields out: measured under a
// frozen clock, the built `getObject` request - client endpoint, request
// endpoint, `path`, every header including `Host` and the SigV4
// `Authorization` - and the presigned URLs are byte-identical with and without
// this line, while the DEP0169 count goes 1 -> 0. It suppresses nothing: no
// process warning state is touched, so a genuine `url.parse()` anywhere else
// in the process still reports normally and the parity warning gate still sees
// whatever the process emits.
//
// TWO ALTERNATIVES WERE REJECTED, recorded so the choice is legible.
// (1) Configuring an explicit endpoint STRING here: for `region: us-east-1`
// the SDK resolves `s3.amazonaws.com` and not `s3.us-east-1.amazonaws.com`
// (measured), so a hand-written string would change the request host, and
// restating the SDK's region rules in application configuration is a worse
// liability than the warning. (2) The SDK's own non-string escape hatch
// [lib/http.js:45-49 returns `AWS.util.copy(endpoint)` for a non-string]:
// workable, but it needs that same region resolution and it covers only the
// `Endpoint` seam, leaving `getSignedUrl` still warning.
//
// This line becomes unnecessary when the deferred SDK v2 -> v3 migration lands
// (v3 does not use the legacy parser); until then it is what keeps a retained
// dependency warning-free, which is the condition on which it is retained.
if (typeof AWS.util.urlParse !== 'function') {
  throw new Error('config/aws.js: aws-sdk no longer exposes "AWS.util.urlParse", so the DEP0169 seam this file closes has moved; re-establish it against the installed SDK before deploying');
}
AWS.util.urlParse = parseLegacy;

AWS.config.update({
  accessKeyId       : config.aws.keyId
  , secretAccessKey : config.aws.key
  , region          : config.aws.region
});

module.exports = AWS;
