// The TWELVE entries below are APPEND-ONLY and must never be reordered. Serial order is a correctness
// requirement, not a style choice: database state is shared across the suites and reset only at the outer
// boundaries of this describe block — `before(db.reset)` and the `after` below — so `login` depends on the
// accounts `registration` created, `course`/`profile`/`logout` depend on the session `login` established,
// and so on.
//
// Three of the entries carry a position constraint of their own:
//   - 'write-routes' owns two isolated accounts and exercises the sole PATCH route, folder CRUD, course
//     invitations, user settings/info and a missing-user admin path over flow-backed real HTTP. It runs
//     before 'session' so the transition suite still starts from a clean cookie slot.
//   - 'session' proves session-id rotation on login and session invalidation on logout by replaying
//     pre-transition cookies, so it logs in and out repeatedly. It creates and removes its own account
//     rather than reusing `defaults.user` — whose password forgot_pass.js deliberately changes — drives
//     every request through a cookie slot no other suite touches, and restores `flow.activeUser` when it
//     finishes. Those three isolation properties are what make its position independent of what follows.
//   - 'route-parity' is LAST, exactly once. It is the only suite that asserts against the recorded baseline
//     rather than against fixtures it created itself, so running it after every other suite has written to
//     the database proves the parity gates hold on a used datastore rather than only on a pristine one. It
//     is safe there because it owns its own cookie slots throughout — the empty slot for the 58
//     unauthenticated routes and `defaults.parity`-backed slots for everything authenticated — creates and
//     removes its own accounts, and restores `flow.activeUser` when it finishes.
var db       = require('../../helpers/db'),
    sequence = [
    'registration',
    'files',
    'login',
    'admin',
    'course',
    'profile',
    'logout',
    'forgot_pass',
    'trinket',
    'write-routes',
    'session',
    'route-parity'
  ];

// Every suite in this tree talks to one shared mongod, and Mocha's 2000 ms default is shorter than that
// round trip's tail when the host is under load from sibling checkouts. The ceiling below is raised for the
// whole tree, once, here — the tree's only entry point — rather than being sprinkled across the spec files.
//
// What it removes is a FALSE RED that also hides real failures: each spec builds its own fixtures in its own
// `before`, and when one of those waits crosses the limit Mocha marks the hook failed and ABANDONS the rest
// of that suite, so whole groups of assertions silently do not run and the abandoned fixtures produce
// follow-on failures in `after` that have nothing to do with the code.
//
// It is a SUITE-level ceiling rather than per-hook, because the wait that overruns is inside a spec's own
// fixture `before`, which this file cannot reach one hook at a time. 20 s sits just above the 15 s
// per-request budget test/baseline/capture.js applies to the same application, so an initialisation that is
// genuinely stuck still fails inside one run instead of hanging it. And it lives here rather than as a fifth
// key in `.mocharc.json`, which keeps exactly its four options.
//
// It weakens nothing: no assertion is changed, removed or relaxed, no latency is asserted anywhere in this
// tree, and a hook that genuinely never completes still fails the run. The only thing this ceiling decides
// is how long Mocha waits before calling a database round trip hung. The two destructive hooks below raise
// their own budget further still, for the reason recorded there.
var DATABASE_TIMEOUT = 20000;

describe('API tests', function() {
  // Set before the nested suites are constructed below, so they inherit it along with their hooks.
  this.timeout(DATABASE_TIMEOUT);

  // The two destructive hooks carry an explicit timeout of their own. `db.reset()` issues `dropDatabase()`,
  // which takes a database-level lock on a mongod this host SHARES with every parallel clone of this
  // repository, so its duration is not a property of this suite — under load it can stall past Mocha's
  // default and fail this outer `before all`, skipping every API test for a reason that has nothing to do
  // with them. Nothing is weakened: a hook that genuinely never completes still fails the run, and every
  // test's own timeout is untouched. `beforeEach(db.ensureConnection)` keeps its bare-reference form,
  // because it only polls and cannot stall on a lock.
  before(function(done) {
    this.timeout(30000);
    db.reset(done);
  });

  beforeEach(db.ensureConnection);

  sequence.forEach(function(file) {
    var suite = require('./' + file);
    suite();
  });

  after(function(done) {
    this.timeout(30000);
    db.reset(done);
  });
});
