// Holds the resolved hapi server for the test run: test/lib/00-ready.js assigns
// `server` from a root `before` hook (app.js exports a promise, not a server),
// and test/helpers/flow.js reads it lazily in createRequest.
// Keep this a mutable single-property object -- flow.js requires this module at
// load time and reads the property later, so reassigning module.exports would
// not propagate to the copy it already holds.
module.exports = { server: null };
