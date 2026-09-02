// Historical test bootstrap, now inert: this file requires nothing, and nothing
// requires or collects it. It is kept rather than deleted because `test/setup.js`
// is the conventional name for a Mocha bootstrap, so it is where a maintainer
// looks first, and a signpost there is more useful than an absence.
//
// Its content was never wrong -- its LOAD POSITION was. Mocha collected 25 files
// in sorted order and this one sorted LAST, so the environment assignments it
// opened with ran only after all 24 other files had already been required under
// the `development` configuration. The `config` package snapshots NODE_ENV on
// its first require, so config/test.yaml never applied. Nothing placed here
// could take effect from here.
//
// The substance was relocated rather than rewritten, into two files that each
// document what they took over and why:
//
//   test/env.js          - the environment variables, the Chai `should`
//                          interface the existing assertions read through, and
//                          the stub that keeps the suite off a live Redis.
//                          Reached through `--require ./test/env.js` in
//                          test/mocha.opts, so it runs before any module can
//                          read the wrong NODE_ENV.
//
//   test/lib/00-ready.js - application and database loading, plus the root
//                          `before` that awaits the promise app.js exports and
//                          the root `after` that stops the server. It is the
//                          first file the narrowed `test/lib/**/*.js` glob
//                          collects, which is what makes those hooks run first.
//
// Everything else went away with the two dev dependencies and the one local
// helper it referenced. Those removals changed no assertion: the plugins were
// registered but unused, and spy values are read as plain booleans through Chai.
// See the commit that reduced this file for the per-line reasons.
//
// Do not add requires or hooks here. The narrowed spec glob means Mocha does not
// collect this file and nothing requires it, so anything added below would
// silently never run -- which is precisely the defect described above.
module.exports = {};
