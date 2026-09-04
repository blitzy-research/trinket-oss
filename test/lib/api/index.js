var db       = require('../../helpers/db'),
    sequence = [
    'registration',
    'files',
    'login',
    'pages',
    'admin',
    'course',
    'profile',
    'logout',
    'forgot_pass',
    'trinket'
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

// The suite-total gate.
//
// A green reporter line is not on its own evidence that the suite ran: a spec
// file that is never invoked, a `describe` that throws while registering, or a
// `before all` hook that fails and suppresses the rest of its suite each reduce
// the number of cases Mocha reports without reporting a failure of their own.
// This hook closes that gap: it walks the root suite after the run and requires
// the number of cases registered, the number executed and the number that
// passed all to equal EXPECTED_CASES, failing with the three counts otherwise.
// A tally that is quietly short is indistinguishable from a tally that is right,
// which is why the total is asserted rather than read.
//
// It sits at the top level of a collected spec file, so `after` attaches to the
// root suite and runs once, after every suite in the run - including the model
// and utility suites, which are collected from outside this directory. Being a
// hook rather than a case, it does not change the total it asserts.

// 130 = 124 + 6, the figure AAP 0.9.2 freezes for this suite.
//
// 124 is the number of `it()` bodies present at base commit 2f8712a, measured
// per file rather than summed from intent:
//
//    69  test/lib/api/ - admin 3, course 27, files 5, forgot_pass 7, login 5,
//        logout 2, profile 1, registration 9, trinket 10
//    55  the model and utility suites - plugins/paginate 21, plugins/roles 12,
//        User 10 (7 in models/user.js and 3 in util/user.js), models/trinket 9,
//        models/course 2, models/lesson 1
//
// 123 of those 124 are active at that commit. The 124th is
// `it('should respond with a zip file', ...)`, which sits inside the /* ... */
// block at 2f8712a:test/lib/api/course.js:254-280, and is the reason a
// comment-stripped count of that tree returns 123 where the AAP's count returns
// 124. Removing those two comment delimiters is the ONLY difference between this
// tree's course.js and the base commit, so all 124 bodies now register.
//
// 6 is test/lib/api/pages.js, created by this migration. `'pages'` in the
// sequence array above is what invokes it: this file requires and calls only the
// names in that array, so without the entry the spec would load and register
// nothing at all - which is the failure mode this gate exists to catch.
//
// REGISTERED and EXECUTED both measure 130 under the canonical `npm test`, so
// the composition half of the contract holds exactly. PASSED measures fewer, and
// the shortfall belongs to the baseline rather than to this migration: 27 of the
// 124 bodies assert expectations that production code `git diff 2f8712a` reports
// byte-identical has never satisfied. Four examples, each checkable:
//
//   test/lib/models/trinket.js:55 expects a short code cut to 10 characters
//   where lib/models/trinket.js:120 cuts 12;
//   plugins/roles.js expects hasRole('trinket-code') where lib/models/user.js:68
//   grants only the `user` role on first save, and lib/models/roles.js:85 makes
//   'trinket-code' a separate role name carrying the same permission list;
//   course.js expects a 302 to /login on unauthenticated /api/ paths where
//   app.js classifies a path beginning /api/ as an API request and answers its
//   401 as JSON;
//   course.js asserts `should.not.exist` of an emptied collection where
//   lib/models/model.js serialize() has always written `[]`.
//
// AAP 0.6.5 records that this suite died during file collection at 2f8712a, so
// its "124 passing" was inferred from the registration count and never measured.
//
// Those bodies are preserved exactly as written, which is why the gate fails
// rather than passing. Correcting an expectation would change an assertion the
// AAP 0.9.2 gate bars changing, and making one pass would need the production
// behaviour change R-d prohibits. The gate therefore reports all three counts on
// every run: it is unmet today, by 27, and it becomes satisfiable only when those
// baseline bodies are addressed under their own approval.
var EXPECTED_CASES = 130;

after(function() {
  var suite = this.test.parent;

  // Climb to the root suite. In practice a top-level `after` is already attached
  // to it; the loop makes that independent of how Mocha nests hooks.
  while (suite && !suite.root && suite.parent) {
    suite = suite.parent;
  }

  var cases = [];

  (function collect(node) {
    node.tests.forEach(function(test) {
      cases.push(test);
    });
    node.suites.forEach(collect);
  })(suite);

  var registered = cases.length;
  var executed   = cases.filter(function(test) {
    return test.pending || typeof test.state !== 'undefined';
  }).length;
  var passed     = cases.filter(function(test) {
    return test.state === 'passed';
  }).length;

  if (registered !== EXPECTED_CASES || executed !== EXPECTED_CASES || passed !== EXPECTED_CASES) {
    throw new Error(
      'suite-total gate failed: expected ' + EXPECTED_CASES +
      ' cases registered, executed and passing, but measured registered=' + registered +
      ', executed=' + executed + ', passed=' + passed + '. ' +
      'A registered count below the expected total means a spec file or suite did not run; ' +
      'an executed count below the registered count means a hook suppressed cases; ' +
      'a passed count below the executed count means cases failed.'
    );
  }
});
