// The nine entries below are APPEND-ONLY and must never be reordered. Serial order is a correctness
// requirement, not a style choice: database state is shared across the suites and reset only at the
// outer boundaries of this describe block (`before(db.reset)` and the `after` below), so `login` depends
// on the accounts `registration` created, `course`/`profile`/`logout` depend on the session `login`
// established, and so on. AAP 0.7.6 records the same constraint.
//
// 'route-parity' is appended LAST for two reasons. It is the only suite that asserts against the R-6
// baseline corpus rather than against fixtures it created itself, so running it last proves the parity
// gates still hold after the other eight suites have written to the database; and it drives every request
// through a fresh unauthenticated supertest agent, so it neither consumes nor disturbs the session state
// the earlier suites share.
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
    'route-parity'
  ];

describe('API tests', function() {
  before(db.reset);

  beforeEach(db.ensureConnection);

  sequence.forEach(function(file) {
    var suite = require('./' + file);
    suite();
  });

  after(function(done) {
    db.reset(done);
  });
});
