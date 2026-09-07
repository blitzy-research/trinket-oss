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
// This hook closes that gap: it walks the root suite after the run and, on an
// unfiltered run, requires the number of cases registered, the number executed
// and the number that passed all to equal EXPECTED_CASES, failing with the
// three counts otherwise. A tally that is quietly short is indistinguishable
// from a tally that is right, which is why the total is asserted rather than
// read. A filtered run is measured differently, and the rule is at the end of
// the next block.
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
// The total is the AAP's figure and is not this file's to move: a shortfall is
// reported with all three counts and left as a failure, never reconciled by
// lowering the expectation.
//
// FILTERED RUNS. The fixed total describes a full run, so it is not asserted
// while a `-g`, `--grep`, `-f` or `--fgrep` filter is in force: a filter selects
// a subset by design, and asserting 130 against a subset made a fully green
// targeted run exit non-zero (measured on this tree: `--grep "paginate"` passed
// 21 of 21 and still exited 1), which left targeted runs unusable as a green
// signal. Under a filter the hook instead requires that the filter selected at
// least one case and that every case it selected passed, so a targeted run
// carrying a real failure still fails - `--grep "Trinket model"` fails on its
// own failing cases and no longer also on the total. The executed-count half of
// that rule is what catches a filter whose cases were all suppressed before they
// ran, by a failing `before all` hook for instance, which a `passed === executed`
// test alone would read as green at 0 and 0.
//
// One limit, stated rather than implied: a pattern that matches nothing exits 0
// without this hook running at all, because Mocha 3 skips a suite whose grep
// total is zero and skips its hooks with it. That is Mocha's behaviour and is
// outside anything this file can assert.
//
// On both paths a pending case counts as executed and not as passed, since
// neither the fixed total nor the filtered rule accepts a case that never ran as
// a case that passed.
var EXPECTED_CASES = 130;

// Report the `--grep`/`--fgrep` filter in force, or null when the run is
// unfiltered.
//
// The filter is read from argv because argv is where both of its sources land:
// Mocha 3's bin/options.js splices the contents of test/mocha.opts into
// `process.argv`, and bin/mocha then forwards `process.argv.slice(2)` to the
// `_mocha` child this file runs in. A filter written into mocha.opts and one
// passed on the command line are therefore both visible here.
//
// Every spelling Mocha 3 accepts is handled: the short forms `-g` and `-f`, the
// long forms `--grep` and `--fgrep`, and the `--flag=<pattern>` form of either,
// which carries the pattern in the same argv token rather than the next one.
function activeCaseFilter() {
  var argv  = process.argv.slice(2),
      flags = ['-g', '--grep', '-f', '--fgrep'],
      i, arg, flag, split, pattern;

  for (i = 0; i < argv.length; i++) {
    arg   = String(argv[i]);
    split = arg.indexOf('=');
    flag  = split === -1 ? arg : arg.slice(0, split);

    if (flags.indexOf(flag) === -1) {
      continue;
    }

    pattern = split === -1 ? argv[i + 1] : arg.slice(split + 1);

    return {
      flag    : flag,
      pattern : typeof pattern === 'undefined' ? '' : String(pattern)
    };
  }

  return null;
}

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

  var filter = activeCaseFilter();

  // A filtered run cannot be measured against the fixed total, because the
  // filter is what chose the subset. What remains checkable is that the pattern
  // matched something and that everything it matched passed - which is what
  // makes a targeted run usable as a green signal without letting a targeted
  // failure through.
  if (filter) {
    if (executed === 0 || passed !== executed) {
      throw new Error(
        'suite-total gate failed under an active `' + filter.flag + ' ' + filter.pattern +
        '` filter: expected every selected case to run and pass, but measured registered=' +
        registered + ', executed=' + executed + ', passed=' + passed + '. ' +
        'The fixed total of ' + EXPECTED_CASES + ' is not asserted while a filter is in force, ' +
        'because a filter selects a subset by design; ' +
        'an executed count of 0 means every selected case was suppressed before it ran, ' +
        'which a failing `before all` hook does; ' +
        'a passed count below the executed count means selected cases failed.'
      );
    }

    return;
  }

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
