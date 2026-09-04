// Inert: this file requires nothing, and nothing requires or collects it. It is
// kept because `test/setup.js` is the conventional name for a Mocha bootstrap
// and so the first place a maintainer looks, where a signpost is worth more
// than an absence.
//
// Environment setup is test/env.js, reached through `--require ./test/env.js`
// in test/mocha.opts. The root readiness hooks are test/lib/00-ready.js.
//
// Anything added below would never run: the spec glob in test/mocha.opts does
// not collect this file, and no module requires it.
module.exports = {};
