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
// unfiltered run, asserts THREE things - that EXPECTED_CASES cases registered,
// that EXPECTED_CASES cases executed, and that the SET of failing case titles is
// exactly the register in KNOWN_FAILURES below. A tally that is quietly short is
// indistinguishable from a tally that is right, which is why the total is
// asserted rather than read. A filtered run is measured differently, and the
// rule is at the end of the next block.
//
// WHY A NAMED SET RATHER THAN A PASSING COUNT. This clause used to require
// `passed === EXPECTED_CASES` and reported one bare number when it did not hold,
// which is weaker than it looks in three distinct ways: it says nothing about
// WHICH cases failed, it cannot tell a newly broken case from a long-standing
// one, and - worst - a substitution passes it silently, because a case that
// starts failing while one of the known-failing cases is repaired leaves the
// count untouched. Comparing the set closes all three. It fails on a new failure
// (a title absent from the register), on a register entry that starts passing (a
// register title absent from the failures, which is a signal to DELETE that
// entry), and on a substitution, which presents as both at once.
//
// The register is an inventory of cases that fail HERE and fail IDENTICALLY on a
// live baseline stack at 2f8712a, each with its measured A/B verdict, so the gate
// carries the reason a failure is expected rather than a permission to ignore it.
// It is deliberately NOT a way of making the run green: every case in it still
// runs, still fails and still reports its own assertion error, so `npm test`
// exits non-zero exactly as it did before, and this hook adds no failure of its
// own while the set matches. Repairing a case means deleting its register entry;
// nothing here skips, pends or loosens anything.
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
// reported with every count measured - registered, executed, passing and failing
// - and left as a failure, never reconciled by lowering the expectation.
//
// FILTERED RUNS. The fixed total describes a full run, so it is not asserted
// while a `-g`, `--grep`, `-f` or `--fgrep` filter is in force: a filter selects
// a subset by design, and asserting 130 against a subset made a fully green
// targeted run exit non-zero (measured on this tree: `--grep "paginate"` passed
// 21 of 21 and still exited 1), which left targeted runs unusable as a green
// signal. Under a filter the hook instead requires that the filter selected at
// least one case and that every case it selected either passed or is named in
// the register, so a targeted run carrying a real failure still fails -
// `--grep "Trinket model"` fails on its own failing cases and no longer also on
// the total. The executed-count half of that rule is what catches a filter whose
// cases were all suppressed before they ran, by a failing `before all` hook for
// instance, which a `passed === executed` test alone would read as green at 0
// and 0.
//
// The filtered path is deliberately one-sided: it cannot check that a register
// entry is STILL failing, because the filter decides what runs and an entry it
// did not select is simply absent from the results. Only an unfiltered run
// retires a register entry.
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

// The enumerated known-failure register.
//
// One entry per case that is EXPECTED to fail, keyed by the case's full Mocha
// title - the concatenation of its describe titles and its own, exactly as
// `test.fullTitle()` builds it and exactly as the spec reporter prints it in the
// failure list, so an entry can be copied from the log and back again without
// interpretation.
//
// `title`  the full Mocha title. This is the key the set comparison uses.
// `reason` why the case fails, at its root cause, in one line.
// `ab`     the LIVE A/B verdict: the request that was issued, what the target
//          answered and what a baseline stack at 2f8712a answered. This is the
//          field that makes an entry evidence rather than an opinion, and it is
//          what a reviewer checks before accepting one.
//
// THE BAR FOR MEMBERSHIP. A case belongs here only when its failure is a stale
// expectation rather than a defect in this migration: it must fail identically
// on a live baseline stack, and repairing it must not require changing
// application behaviour the AAP preserves. Every entry below was measured that
// way - target `127.0.0.1:3280` against an independently installed baseline
// worktree at 2f8712a on `127.0.0.1:3282`, both seeded and both driven with the
// same request. Three of the nine could only be "repaired" by breaking a quirk
// the AAP explicitly preserves, which is named in their reason lines.
//
// Nothing about this register weakens an assertion. Every case it names still
// executes and still fails with its own message; the register only says which
// failures are already accounted for, so that a TENTH failure is impossible to
// miss in a log that already carries nine.
var KNOWN_FAILURES = [
  {
    title  : 'Trinket model pre save hooks createHash ' +
             'should generate a hash and shortcode based on code, lang, owner and parent',
    reason : 'The base commit generates a TWELVE-character shortCode ' +
             '(`lib/models/trinket.js` `substring(0, 12)`) while this case ' +
             'asserts a TEN-character one, so the expectation has never ' +
             'described the code that produces it. The delivered tree had ' +
             'truncated generation to ten to make the case pass, which is an ' +
             'unregistered behaviour change R-d forbids; that truncation was ' +
             'withdrawn and generation is twelve again, catalogued in ' +
             'docs/preserved-quirks.md 11.21. AAP 0.9.2 bars changing an ' +
             "assertion's expected value, so the case is registered here " +
             'rather than repaired by editing line 55.',
    ab     : 'Baseline stack at 2f8712a, its own `createHash` pre-save hook ' +
             'driven with this case\'s own fixture and stubs: produced ' +
             'shortCode `b7da60aa308f` (12 chars) against an asserted ' +
             '`9f96615fa5` (10 chars) - FAIL. Merged tree: produced ' +
             '`abcdefghijkl` against an asserted `abcdefghij` - FAIL, same ' +
             'assertion, same mechanism, same 12-vs-10 length difference. ' +
             'IDENTICAL.'
  },
  {
    title  : 'API tests User Registration When I enter valid registration data ' +
             'should include a link to the default course on the welcome page',
    reason : 'lib/controllers/pages.js `welcome` redirects to /home ' +
             'unconditionally, so /welcome renders no page and there is no ' +
             'sampler copy link in the body to find. The 2013 expectation ' +
             'describes a welcome page this application has not served since.',
    ab     : 'GET /welcome, authenticated: target 302 Location:/home with a ' +
             '0-byte body; baseline 302 Location:/home with a 0-byte body. ' +
             'Baseline source is `reply().redirect(\'/home\')`, the same ' +
             'unconditional redirect. IDENTICAL.'
  },
  {
    title  : 'API tests Course Creation As a logged in user When I post a new course ' +
             'should allow me to get the course using slugs',
    reason : 'The course page is an AngularJS template that renders ' +
             '`{{ course.name }}` in the browser, so the server-rendered HTML ' +
             'never contains the course name the case searches it for.',
    ab     : 'GET /u/{user}/classes/{slug}: target 200 text/html with 0 ' +
             'occurrences of the literal course name and 1 of the ' +
             '`{{ course.name }}` expression; baseline 200 text/html with the ' +
             'same 0 and 1. IDENTICAL.'
  },
  {
    title  : 'API tests Course Creation As a logged in user When I edit an existing course ' +
             'should redirect me to the current course if I use the original course slug',
    reason : 'The slug-alias 301 in lib/util/helpers.js `courseBySlug` is a ' +
             'PRESERVED QUIRK that never fires - AAP 0.6.6 records the pre-' +
             'handler as resolving `null` and states "Target disposition: ' +
             'return null" - so the handler runs with no course and the request ' +
             'ends as a 500. Answering 301 here would break that preserved ' +
             'disposition.',
    ab     : 'Course created, renamed twice, then GET /u/{user}/classes/' +
             '{original-slug}: target 500 text/html; baseline 500 text/html. ' +
             'Same status on both; the bodies differ only in the 50x.html ' +
             'template. IDENTICAL.'
  },
  {
    title  : 'API tests Course Creation As a logged in user When I edit an existing course ' +
             'should allow me to delete materials',
    reason : 'The route answers 200 with `lesson.materials` present and EMPTY, ' +
             'and `should.not.exist([])` rejects an empty array - `[]` exists. ' +
             'The expectation assumes the key is dropped when the last material ' +
             'goes, which this application has never done.',
    ab     : 'DELETE /api/courses/{c}/lessons/{l}/materials/{m}: target 200 ' +
             '{"lesson":{...,"materials":[]},...}; baseline 200 ' +
             '{"lesson":{...,"materials":[]},...}. IDENTICAL.'
  },
  {
    title  : 'API tests Course Creation As a logged in user When I edit an existing course ' +
             'should allow me to delete lessons',
    reason : 'The same shape one level up: 200 with `course.lessons` present ' +
             'and empty, which `should.not.exist([])` rejects.',
    ab     : 'DELETE /api/courses/{c}/lessons/{l}: target 200 ' +
             '{"course":{...,"lessons":[]},...}; baseline 200 ' +
             '{"course":{...,"lessons":[]},...}. IDENTICAL.'
  },
  {
    title  : 'API tests Course Creation As a logged out user ' +
             'should not allow me to create a course',
    reason : 'flow.createCourse targets `POST /api/courses`, and AAP 0.6.3 ' +
             'Layer 3 detects a path beginning /api/ as an API request and ' +
             'serves the Boom; the 401 -> `/login` redirect is the browser-HTML ' +
             'branch only. The expected 302 belongs to a page route, not this one.',
    ab     : 'POST /api/courses with no session: target 401 ' +
             '{"statusCode":401,"error":"Unauthorized","message":"Not logged ' +
             'in"}; baseline the same 401 and the same body. Re-measured with ' +
             'the `referer` header the suite sends: still 401 on both. IDENTICAL.'
  },
  {
    title  : 'API tests Course Creation As a logged out user ' +
             'should not allow me to add a lesson to a course',
    reason : 'Same cause as the create case above: flow.addNewLesson targets ' +
             '`POST /api/courses/{id}/lessons`, an /api/ path, so Layer 3 ' +
             'serves the Boom rather than the HTML redirect.',
    ab     : 'POST /api/courses/{c}/lessons with no session: target 401 ' +
             '"Not logged in"; baseline 401 "Not logged in". IDENTICAL.'
  },
  {
    title  : 'API tests Course Creation As a logged out user ' +
             'should not allow me to add material to a course lesson',
    reason : 'Same cause: flow.addNewMaterial targets ' +
             '`POST /api/courses/{id}/lessons/{id}/materials`, an /api/ path.',
    ab     : 'POST /api/courses/{c}/lessons/{l}/materials with no session: ' +
             'target 401 "Not logged in"; baseline 401 "Not logged in". IDENTICAL.'
  },
  {
    title  : 'API tests Course Creation As a logged out user ' +
             'should not allow me to delete a course',
    reason : 'Same cause: flow.deleteCourse targets ' +
             '`DELETE /api/courses/{id}`, an /api/ path.',
    ab     : 'DELETE /api/courses/{c} with no session: target 401 "Not logged ' +
             'in"; baseline 401 "Not logged in". IDENTICAL.'
  }
];

/**
 * The register as a title -> entry map, built once.
 *
 * A duplicate title in the register would make the set comparison ambiguous -
 * one failing case could satisfy two entries - so it is rejected here, at load
 * time, rather than producing a confusing verdict at the end of the run.
 *
 * @returns {Object} Own-property map from full Mocha title to register entry.
 * @throws {Error} If two entries carry the same title.
 */
var KNOWN_FAILURES_BY_TITLE = (function() {
  var map = Object.create(null);
  var i;

  for (i = 0; i < KNOWN_FAILURES.length; i++) {
    if (hasRegisteredTitle(map, KNOWN_FAILURES[i].title)) {
      throw new Error(
        'known-failure register is malformed: the title "' +
        KNOWN_FAILURES[i].title + '" appears twice. Each entry must name a ' +
        'distinct case, because the gate compares the register against the ' +
        'failing set by title.'
      );
    }

    map[KNOWN_FAILURES[i].title] = KNOWN_FAILURES[i];
  }

  return map;
})();

/**
 * Own-property membership test for a null-prototype map.
 *
 * Written out rather than using `in`, so a case whose title happens to be
 * `constructor` or `toString` cannot be read as registered.
 *
 * @param {Object} map
 * @param {string} title
 * @returns {boolean}
 */
function hasRegisteredTitle(map, title) {
  return Object.prototype.hasOwnProperty.call(map, title);
}

/**
 * Renders one case for the log: its full title, and either its register entry
 * indented beneath it or an explicit note that it has none.
 *
 * The unregistered form is what an unexpected failure prints, and saying so in
 * words rather than by omission is what keeps the diagnostic readable to someone
 * who has only the log.
 *
 * @param {string} title A full Mocha title, registered or not.
 * @returns {string} A multi-line block, already indented.
 */
function describeKnownFailure(title) {
  var entry = KNOWN_FAILURES_BY_TITLE[title];

  if (!entry) {
    return '  - ' + title + '\n      (not in the register)';
  }

  return '  - ' + entry.title +
         '\n      reason: ' + entry.reason +
         '\n      live A/B: ' + entry.ab;
}

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

  // The failing SET, by full title. A case that never ran has no `state` and is
  // deliberately not counted as failing here - the executed count above is what
  // catches suppression, and conflating the two would report a suite killed by a
  // `before all` hook as a hundred unexpected failures.
  var failedTitles = cases.filter(function(test) {
    return test.state === 'failed';
  }).map(function(test) {
    return test.fullTitle();
  });

  // Failing but not registered: a NEW failure, and the outcome this gate exists
  // to make impossible to overlook.
  var unexpected = failedTitles.filter(function(title) {
    return !hasRegisteredTitle(KNOWN_FAILURES_BY_TITLE, title);
  });

  // Registered but not failing: the register is stale. Either the case was
  // repaired - in which case its entry is to be DELETED - or something else now
  // prevents it from running and reaching its assertion, which the executed
  // count above reports separately.
  var recovered = KNOWN_FAILURES.map(function(entry) {
    return entry.title;
  }).filter(function(title) {
    return failedTitles.indexOf(title) === -1;
  });

  // Two cases sharing one full title would let a single failure stand in for
  // two register entries, so the count is compared as well as the membership.
  var duplicated = failedTitles.filter(function(title, index) {
    return failedTitles.indexOf(title) !== index;
  });

  var filter = activeCaseFilter();

  // A filtered run cannot be measured against the fixed total, because the
  // filter is what chose the subset. What remains checkable is that the pattern
  // matched something and that everything it matched either passed or is already
  // named in the register - which is what makes a targeted run usable as a green
  // signal without letting a targeted failure through.
  if (filter) {
    if (executed === 0 || unexpected.length > 0 || duplicated.length > 0) {
      throw new Error(
        'suite-total gate failed under an active `' + filter.flag + ' ' + filter.pattern +
        '` filter: expected every selected case either to pass or to be named in the ' +
        'known-failure register, but measured registered=' + registered +
        ', executed=' + executed + ', passed=' + passed +
        ', failing=' + failedTitles.length +
        ', of which ' + unexpected.length + ' are NOT in the register.\n' +
        (unexpected.length
          ? 'Unexpected failures:\n' + unexpected.map(describeKnownFailure).join('\n') + '\n'
          : '') +
        (duplicated.length
          ? 'Cases sharing one full title, which makes the register ambiguous:\n' +
            duplicated.map(function(title) { return '  - ' + title; }).join('\n') + '\n'
          : '') +
        'The fixed total of ' + EXPECTED_CASES + ' is not asserted while a filter is in force, ' +
        'because a filter selects a subset by design, and a register entry the filter did not ' +
        'select cannot be checked either - only an unfiltered run retires an entry. ' +
        'An executed count of 0 means every selected case was suppressed before it ran, ' +
        'which a failing `before all` hook does.'
      );
    }

    return;
  }

  if (registered !== EXPECTED_CASES ||
      executed !== EXPECTED_CASES ||
      unexpected.length > 0 ||
      recovered.length > 0 ||
      duplicated.length > 0) {
    throw new Error(
      'suite-total gate failed. Measured registered=' + registered +
      ', executed=' + executed + ', passed=' + passed +
      ', failing=' + failedTitles.length +
      '; expected registered=' + EXPECTED_CASES + ', executed=' + EXPECTED_CASES +
      ' and a failing set equal to the ' + KNOWN_FAILURES.length +
      '-entry known-failure register in test/lib/api/index.js.\n' +
      (registered !== EXPECTED_CASES
        ? 'REGISTERED COUNT WRONG: a count below ' + EXPECTED_CASES + ' means a spec file or ' +
          'suite did not run at all - check that every name in the `sequence` array at the top ' +
          'of this file is required and called, and that no `describe` threw while registering.\n'
        : '') +
      (executed !== EXPECTED_CASES
        ? 'EXECUTED COUNT WRONG: cases registered but never ran, which is what a failing ' +
          '`before all` hook does to the rest of its suite. Look above for the first failing hook.\n'
        : '') +
      (unexpected.length
        ? 'NEW FAILURES (' + unexpected.length + '), failing and not in the register. Each one is ' +
          'a regression until it is shown to fail identically on a baseline stack at 2f8712a:\n' +
          unexpected.map(describeKnownFailure).join('\n') + '\n'
        : '') +
      (recovered.length
        ? 'STALE REGISTER ENTRIES (' + recovered.length + '), named in the register but not ' +
          'failing. If the case was repaired, DELETE its entry from KNOWN_FAILURES; if it simply ' +
          'did not run, the executed count above says so:\n' +
          recovered.map(describeKnownFailure).join('\n') + '\n'
        : '') +
      (duplicated.length
        ? 'AMBIGUOUS TITLES (' + duplicated.length + '): two cases share one full Mocha title, so ' +
          'one failure could stand in for two register entries. Rename one of them:\n' +
          duplicated.map(function(title) { return '  - ' + title; }).join('\n') + '\n'
        : '') +
      'A count alone cannot tell a new failure from a repaired one, which is why this gate ' +
      'compares the failing SET against the register rather than the number of passes.'
    );
  }

  // The set matched, so this hook adds no failure of its own. It still says so:
  // a reader of the log sees a non-zero exit and N failing cases, and this line
  // is what tells them those N are the registered ones rather than N new ones.
  // The individual cases still failed, so the run still exits non-zero - the
  // register accounts for failures, it does not absolve them.
  console.log(
    '  suite-total gate: ' + registered + ' registered, ' + executed + ' executed, ' +
    passed + ' passing, ' + failedTitles.length + ' failing - and the failing set is ' +
    'exactly the ' + KNOWN_FAILURES.length + '-entry known-failure register in ' +
    'test/lib/api/index.js, each entry measured to fail identically on a baseline stack ' +
    'at 2f8712a:\n' + KNOWN_FAILURES.map(function(entry) {
      return describeKnownFailure(entry.title);
    }).join('\n')
  );
});
