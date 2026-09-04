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

// ---------------------------------------------------------------------------
// The suite-total gate.
//
// A green reporter line is not on its own evidence that the suite ran: a spec
// file that is never invoked, a `describe` that throws while registering, or a
// `before all` hook that fails and suppresses the rest of its suite all reduce
// the number of cases Mocha reports without reporting a failure of their own.
// The 90-passing/39-failing state this checkpoint started from was reported as
// 129 cases for exactly that reason - the failing `before all` in
// test/lib/api/course.js suppressed the copy-course case, and nothing said so.
//
// This hook closes that gap mechanically: it walks the root suite after the run
// and requires that the number of cases REGISTERED, the number EXECUTED and the
// number that PASSED are all equal to EXPECTED_CASES. Any divergence fails the
// run with the three counts in the message.
//
// It lives at the top level of a collected spec file, so `after` attaches to the
// ROOT suite and therefore runs once, after every suite in the run - including
// the model and utility suites, which are collected from outside this directory.
// It is a hook and not a case, so it does not change the total it asserts.
// ---------------------------------------------------------------------------

// 234 = 130 + 21 + 83.
//
// 130 = 124 + 6 is the figure AAP 0.9.2 states for the route-level suite, and it
// is derived immediately below. The other two terms are the coverage this
// checkpoint added outside test/lib/api/, which this gate counts because it
// walks the ROOT suite:
//
//   +21  test/lib/api/trinket.js, `Legacy URL, MIME and inline-image contracts`
//        - the lib/util/url.js parseLegacy oracle matrix, the frozen contract as
//        values, real invocation of users.assetUploadFromURL, source pinning of
//        all six parseLegacy call sites, the 13 explicit mime mappings and the
//        mismatched-metadata classifier outcomes.
//   +83  test/lib/util/email-compat.js (59) and test/lib/util/diff-compat.js
//        (24) - the two behaviour ports that keep `validator` 5.7.0 isEmail and
//        `diff` 1.0.8 applyPatch semantics while both packages move for HIGH
//        advisories (AAP 0.5.1.2).
//
// Measured per file rather than summed from intent: 75 in test/lib/api/ outside
// the Legacy URL describe, 21 inside it, 59 Email, 24 Diff, and 66 across the
// model and utility suites (paginate 21, roles 12, User 10, Trinket 9, Course 2,
// Lesson 1) = 234.
//
// 124 is the number of `it()` bodies present at base commit 2f8712a: 123 of them
// active, plus `it('should respond with a zip file', ...)`, which sits inside the
// /* ... */ block at 2f8712a:test/lib/api/course.js:254-280 and is the reason a
// comment-stripped count of that tree returns 123 while the AAP's count returns
// 124. 6 is test/lib/api/pages.js, created by this migration.
//
// That 124th body is now ACTIVE and passing. Only its request was ever wrong:
// the application declares `GET /{userSlug}/courses/{courseSlug}/download.zip`
// with a required `format` query of 'md' or 'html' (config/routes.js:163-173),
// while the URL its `before` hook built carried neither the `.zip` suffix nor the
// query, so it matched no route. Its five assertions are byte-identical to the
// ones written at base commit; what the hook needed in addition was its own data
// precondition, which is established at the case and explained there.
//
// No pre-existing case was added, removed or renumbered: 124 baseline bodies, all
// active, plus the 6 new page cases, plus the 104 cases the two sections above
// describe.
var EXPECTED_CASES = 234;

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
