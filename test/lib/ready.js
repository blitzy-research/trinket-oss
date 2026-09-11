// Holds the resolved hapi server for the test run: test/lib/00-ready.js assigns
// `server` from a root `before` hook (app.js exports a promise, not a server),
// and test/helpers/flow.js reads it lazily in createRequest.
// Keep this one mutable object and mutate its properties in place -- flow.js
// requires this module at load time and reads `server` later, so reassigning
// module.exports would not propagate to the copy it already holds.
//
// `initialized` records whether the root `before` in test/lib/00-ready.js took
// this server through `server.initialize()` itself. It exists because hapi
// publishes no public phase accessor and `info.started` cannot answer the
// question: `initialize()` starts every provisioned catbox client and leaves
// `info.started` at 0 (@hapi/hapi 21.4.10 core.js:345-379), so a teardown that
// read `info.started` would conclude there was nothing to stop while the
// session cache was running. The root `after` hook owns the teardown and this
// flag is what makes the harness's own responsibility explicit rather than
// inferred. Only 00-ready.js writes it; flow.js reads `server` alone.
module.exports = { server: null, initialized: false };
