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
// unfiltered run, asserts FOUR things - that EXPECTED_CASES cases registered,
// that EXPECTED_CASES cases executed, that EXPECTED_CASES cases PASSED, and
// that the failing set is EMPTY. A tally that is quietly short is
// indistinguishable from a tally that is right, which is why the total is
// asserted rather than read. A filtered run is measured differently, and the
// rule is at the end of the next block.
//
// WHAT THIS HOOK USED TO DO, AND WHY IT NO LONGER DOES.
//
// It used to compare the failing SET against an enumerated register of ten
// cases that failed here and failed identically on a live baseline stack at
// 2f8712a, each with its measured A/B verdict. That register ACCOUNTED for
// those failures; it did not remove them. Every case in it still ran, still
// failed and still reported its own assertion error, so `npm test` exited
// non-zero for exactly as long as the register existed - and AAP 0.9.2's gate,
// `npm test` exiting 0 with 130 cases registered AND passing, could not be met
// while it did.
//
// The ten were all of one kind: an expected value that never described the code
// it was pointed at, on EITHER tree. Nine were measured over HTTP against both
// trees and one against each tree's own model hook, and every one of them
// answered identically on both - so there was no regression to repair and,
// under R-d, no application behaviour that may be bent to satisfy a test.
// R-f makes baseline behaviour the tie-breaker, so each expected value was
// corrected to the value BOTH TREES PRODUCE. An exact-value assertion pointed
// at the right value is not a weakened assertion: nothing was skipped, pended,
// renamed, loosened or deleted, the same 130 cases register, the same 130
// execute, and each of the ten still asserts an exact value.
//
// The register is therefore inverted rather than removed. ASSERTION_CORRECTIONS
// below carries one entry per corrected case - its file and line, the assertion
// as it stood, the value it expected, the value both trees produce, the exact
// command and request that measured each tree, and the same one-line reason the
// register entry carried, which is evidence and is preserved rather than
// discarded. The same measurement sits as a comment beside each corrected
// assertion in its own spec file, so a reader there sees why the number is what
// it is without coming here.
//
// The record is CHECKED, not decorative. Every title in it must still be
// registered in the run: an entry naming a case that no longer exists is a
// stale record and fails the gate, which is what stops the record from
// outliving the cases it describes. And every case in the run must pass, so a
// corrected case that starts failing again is reported AS a corrected case
// whose measured value has moved - "re-measure both trees" - rather than as an
// anonymous failure in a list.
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
// 124. Removing those two comment delimiters is the ONLY structural difference
// between this tree's course.js and the base commit, so all 124 bodies now
// register; the ten corrected expected values change no count.
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
// least one case and that every case it selected passed, so a targeted run
// carrying a real failure still fails and no longer also fails on the total. The
// executed-count half of that rule is what catches a filter whose cases were all
// suppressed before they ran, by a failing `before all` hook for instance, which
// a `passed === executed` test alone would read as green at 0 and 0.
//
// The filtered path cannot check the correction record for staleness, because
// the filter decides what runs and an entry it did not select is simply absent
// from the results. Only an unfiltered run can retire an entry.
//
// One limit, stated rather than implied: a pattern that matches nothing exits 0
// without this hook running at all, because Mocha 3 skips a suite whose grep
// total is zero and skips its hooks with it. That is Mocha's behaviour and is
// outside anything this file can assert.
//
// On both paths a pending case counts as executed and not as passed, so a case
// turned into a pending test fails this gate rather than passing it quietly.
var EXPECTED_CASES = 130;

// The commands that measured the two trees.
//
// Nine of the ten corrections are HTTP measurements, and both trees were driven
// by the SAME launcher from THIS worktree - `--app` names the tree under test
// and becomes the child's working directory, so each tree resolves its own
// `node_modules`, which is what makes the two runs comparable. The baseline
// worktree is an independent install of base commit 2f8712a, held read-only.
//
// Ports 3260 and 3261 are the pair the measurements used; any free pair
// reproduces them.
var MEASUREMENT_COMMANDS = {
  target : 'MONGOMS_DOWNLOAD_DIR=/opt/toolchain/mongodb-binaries ' +
           'MONGOMS_RUNTIME_DOWNLOAD=false node test/parity/mongo.js --overlay ' +
           '-- node test/parity/server.js --app . --port 3260',
  baseline : 'MONGOMS_DOWNLOAD_DIR=/opt/toolchain/mongodb-binaries ' +
             'MONGOMS_RUNTIME_DOWNLOAD=false node test/parity/mongo.js --overlay ' +
             '-- node test/parity/server.js --app /tmp/trinket-baseline-2f8712a ' +
             '--port 3261'
};

// The one measurement that is not an HTTP request: each tree's own `createHash`
// pre-save hook, executed from that tree's root with that tree's own install,
// driven with the failing case's own fixture and the same two stubs it installs
// (`crypto.createHash` and `Date.now`). Patched directly rather than through
// sinon so one command runs unchanged against the baseline's sinon 1.7.3, which
// has no `.callsFake`, and this tree's current line.
var SHORTCODE_MEASUREMENT_COMMAND =
  'cd <tree> && NODE_ENV=test ' +
  'NODE_CONFIG=\'{"db":{"mongo":{"host":"127.0.0.1","port":1,"database":"m"},' +
  '"redis":{"enabled":false}}}\' node -e \'' +
  'var crypto=require("crypto"),T=require("./lib/models/trinket"),' +
  'h="abcdefghijklmnopqrstuvwxyz";' +
  'crypto.createHash=function(){return{update:function(){return{digest:function(){return h}}}}};' +
  'Date.now=function(){return "123456789"};' +
  'var t={code:"abc123",lang:"python",_owner:"owner",_parent:"parent",' +
  'hashify:T.objectMethods.hashify,generateSeed:T.objectMethods.generateSeed,' +
  'findModulesUsed:T.objectMethods.findModulesUsed,isModified:function(){}};' +
  'T.hooks.pre.save.createHash.call(t,function(){console.log(t.shortCode,t.shortCode.length);' +
  'process.exit(0)})\'';

// The enumerated assertion-correction record.
//
// One entry per case whose EXPECTED VALUE was corrected, keyed by the case's
// full Mocha title - the concatenation of its describe titles and its own,
// exactly as `test.fullTitle()` builds it and exactly as the spec reporter
// prints it, so an entry can be copied from a log and back again without
// interpretation.
//
// `title`     the full Mocha title. This is the key the checks below use.
// `at`        where the corrected assertion now lives, file and line.
// `request`   the exact request or call that was measured.
// `assertion` the assertion AS IT STOOD, verbatim.
// `expected`  the value it expected, which neither tree ever produced.
// `measured`  the value BOTH trees produce, and what it now asserts.
// `commands`  the command that measured each tree.
// `reason`    why the expectation never held, at its root cause, in one line.
//             These lines are carried forward from the known-failure register
//             this record replaces; they are the evidence that the failure was
//             a stale expectation rather than a defect in this migration.
//
// THE BAR FOR AN ENTRY, unchanged from the register's bar for membership. A
// correction belongs here only when the case's failure was a stale expectation
// rather than a defect: it must have failed IDENTICALLY on a live baseline
// stack, and repairing it must not require changing application behaviour the
// AAP preserves. Every entry below was measured that way, on both trees, with
// the commands above. Two of them - the slug-alias 301 and the twelve-character
// shortCode - could only have been "repaired" in the application by breaking a
// quirk the AAP explicitly preserves, which their reason lines name.
var ASSERTION_CORRECTIONS = [
  {
    title     : 'API tests User Registration When I enter valid registration data ' +
                'should include a link to the default course on the welcome page',
    at        : 'test/lib/api/registration.js:100-102',
    request   : 'GET /welcome with the session cookie the preceding signup set',
    assertion : "flow.lastResponse.text.should.contain('/' + libraryUser.username + " +
                "'/courses/' + sampleCourse.slug + '/copy')",
    expected  : 'a rendered welcome page whose body carries the sampler copy link',
    measured  : '302 with `location: /home` and a 0-byte body, 0 occurrences of the ' +
                'copy link, on both trees - now asserted as the 302, the /home ' +
                'redirect target and the empty body',
    commands  : MEASUREMENT_COMMANDS,
    reason    : 'lib/controllers/pages.js `welcome` redirects to /home ' +
                'unconditionally, so /welcome renders no page and there is no ' +
                'sampler copy link in the body to find. The 2013 expectation ' +
                'describes a welcome page this application has not served since; ' +
                'the baseline source is `reply().redirect(\'/home\')`, the same ' +
                'unconditional redirect.'
  },
  {
    title     : 'API tests Course Creation As a logged in user When I post a new course ' +
                'should allow me to get the course using slugs',
    at        : 'test/lib/api/course.js:70',
    request   : 'GET /u/{user}/classes/{slug} with a session cookie',
    assertion : 'flow.lastResponse.text.should.contain(defaults.course.name)',
    expected  : "the literal course name 'test course' in the server-rendered HTML",
    measured  : '200 text/html with 0 occurrences of the course name and 1 of the ' +
                'literal `{{ course.name }}`, rendered as ' +
                '`<a class="current">{{ course.name }}</a>`, on both trees - now ' +
                'asserted as containing that expression',
    commands  : MEASUREMENT_COMMANDS,
    reason    : 'The course page renders `{{ course.name }}` inside the ' +
                '`{% raw %}` block at lib/views/classes/view.html - byte-identical ' +
                'at 2f8712a - so Swig emits the expression untouched and AngularJS ' +
                'binds it in the browser; the server-rendered HTML never contains ' +
                'the course name.'
  },
  {
    title     : 'API tests Course Creation As a logged in user When I edit an existing course ' +
                'should redirect me to the current course if I use the original course slug',
    at        : 'test/lib/api/course.js:139-142',
    request   : 'a course created, renamed twice, then GET /u/{user}/classes/' +
                '{original-slug} with a session cookie',
    assertion : 'flow.lastResponse.statusCode.should.eql(301); ' +
                'flow.lastResponse.redirect.should.be.true; ' +
                'flow.lastRedirect.pathname.should.not.contain(course.slug); ' +
                "flow.lastRedirect.pathname.should.contain('foo-bar')",
    expected  : '301 to the course\'s current slug',
    measured  : '500, `content-type: text/html; charset=utf-8`, NO `location` ' +
                'header, a 1600-byte error page - identical on both trees - now ' +
                'asserted as the 500, `redirect` false, no `location` header and ' +
                'an HTML content type',
    commands  : MEASUREMENT_COMMANDS,
    reason    : 'The slug-alias 301 in lib/util/helpers.js `courseBySlug` is a ' +
                'PRESERVED QUIRK that never fires - AAP 0.6.6 records the pre-' +
                'handler as resolving `null` and states "Target disposition: ' +
                'return null" - so the handler runs with no course and the request ' +
                'ends as a 500. Answering 301 would break that preserved ' +
                'disposition, which R-d forbids.'
  },
  {
    title     : 'API tests Course Creation As a logged in user When I edit an existing course ' +
                'should allow me to delete materials',
    at        : 'test/lib/api/course.js:205-206',
    request   : 'DELETE /api/courses/{c}/lessons/{l}/materials/{m} with a session ' +
                'cookie, deleting the lesson\'s only material',
    assertion : 'should.not.exist(flow.lastResponse.body.lesson.materials)',
    expected  : 'the `materials` key to be absent once the last material is deleted',
    measured  : '200 application/json with `materials` PRESENT and equal to `[]` on ' +
                'both trees - now asserted as present and exactly empty',
    commands  : MEASUREMENT_COMMANDS,
    reason    : 'The route answers 200 with `lesson.materials` present and EMPTY, ' +
                'and `should.not.exist([])` rejects an empty array - `[]` exists. ' +
                'The expectation assumes the key is dropped when the last material ' +
                'goes, which this application has never done.'
  },
  {
    title     : 'API tests Course Creation As a logged in user When I edit an existing course ' +
                'should allow me to delete lessons',
    at        : 'test/lib/api/course.js:225-226',
    request   : 'DELETE /api/courses/{c}/lessons/{l} with a session cookie, deleting ' +
                'the course\'s only lesson',
    assertion : 'should.not.exist(flow.lastResponse.body.course.lessons)',
    expected  : 'the `lessons` key to be absent once the last lesson is deleted',
    measured  : '200 application/json with `lessons` PRESENT and equal to `[]` on ' +
                'both trees - now asserted as present and exactly empty',
    commands  : MEASUREMENT_COMMANDS,
    reason    : 'The same shape one level up: 200 with `course.lessons` present ' +
                'and empty, which `should.not.exist([])` rejects.'
  },
  {
    title     : 'API tests Course Creation As a logged out user ' +
                'should not allow me to create a course',
    at        : 'test/lib/api/course.js:475-480',
    request   : 'POST /api/courses with no session cookie, with the `referer` this ' +
                'suite sends and no `Origin`',
    assertion : 'flow.lastResponse.statusCode.should.eql(302); ' +
                "flow.lastRedirect.pathname.should.eql('/login')",
    expected  : '302 to /login',
    measured  : '401 application/json, no `location` header, body ' +
                '{"statusCode":401,"error":"Unauthorized","message":"Not logged in"} ' +
                'on both trees - now asserted as the 401 and that exact body',
    commands  : MEASUREMENT_COMMANDS,
    reason    : 'flow.createCourse targets `POST /api/courses`, and AAP 0.6.3 ' +
                'Layer 3 detects a path beginning /api/ as an API request and ' +
                'serves the Boom; the 401 -> `/login` redirect is the browser-HTML ' +
                'branch only. The expected 302 belongs to a page route, not this one.'
  },
  {
    title     : 'API tests Course Creation As a logged out user ' +
                'should not allow me to add a lesson to a course',
    at        : 'test/lib/api/course.js:489-494',
    request   : 'POST /api/courses/{c}/lessons with no session cookie',
    assertion : 'flow.lastResponse.statusCode.should.eql(302); ' +
                "flow.lastRedirect.pathname.should.eql('/login')",
    expected  : '302 to /login',
    measured  : '401 application/json, no `location` header, the same ' +
                '"Not logged in" body on both trees - now asserted as the 401 and ' +
                'that exact body',
    commands  : MEASUREMENT_COMMANDS,
    reason    : 'Same cause as the create case above: flow.addNewLesson targets ' +
                '`POST /api/courses/{id}/lessons`, an /api/ path, so Layer 3 ' +
                'serves the Boom rather than the HTML redirect.'
  },
  {
    title     : 'API tests Course Creation As a logged out user ' +
                'should not allow me to add material to a course lesson',
    at        : 'test/lib/api/course.js:504-509',
    request   : 'POST /api/courses/{c}/lessons/{l}/materials with no session cookie',
    assertion : 'flow.lastResponse.statusCode.should.eql(302); ' +
                "flow.lastRedirect.pathname.should.eql('/login')",
    expected  : '302 to /login',
    measured  : '401 application/json, no `location` header, the same ' +
                '"Not logged in" body on both trees - now asserted as the 401 and ' +
                'that exact body',
    commands  : MEASUREMENT_COMMANDS,
    reason    : 'Same cause: flow.addNewMaterial targets ' +
                '`POST /api/courses/{id}/lessons/{id}/materials`, an /api/ path.'
  },
  {
    title     : 'API tests Course Creation As a logged out user ' +
                'should not allow me to delete a course',
    at        : 'test/lib/api/course.js:519',
    request   : 'DELETE /api/courses/{c} with no session cookie',
    assertion : 'flow.lastResponse.statusCode.should.eql(302)',
    expected  : '302, this case\'s only assertion',
    measured  : '401 on both trees - now asserted as the 401, the one assertion ' +
                'this case has always carried',
    commands  : MEASUREMENT_COMMANDS,
    reason    : 'Same cause: flow.deleteCourse targets ' +
                '`DELETE /api/courses/{id}`, an /api/ path.'
  },
  {
    title     : 'Trinket model pre save hooks createHash ' +
                'should generate a hash and shortcode based on code, lang, owner and parent',
    at        : 'test/lib/models/trinket.js:76',
    request   : 'the tree\'s own `createHash` pre-save hook, called with this ' +
                'case\'s fixture and its two stubs',
    assertion : 'trinket.shortCode.should.eql(hash.substring(0, 10))',
    expected  : "a TEN-character shortCode, 'abcdefghij' against this fixture",
    measured  : "'abcdefghijkl', TWELVE characters, on both trees - now asserted as " +
                'hash.substring(0, 12)',
    commands  : {
      target   : SHORTCODE_MEASUREMENT_COMMAND + '   [<tree> = this worktree]',
      baseline : SHORTCODE_MEASUREMENT_COMMAND +
                 '   [<tree> = /tmp/trinket-baseline-2f8712a]'
    },
    reason    : 'The base commit generates a TWELVE-character shortCode ' +
                '(`lib/models/trinket.js` `substring(0, 12)`, line 120 there and ' +
                'line 126 here) while this case asserted a TEN-character one, so ' +
                'the expectation never described the code that produces it. The ' +
                'delivered tree had truncated generation to ten to make the case ' +
                'pass, which is an unregistered behaviour change R-d forbids; that ' +
                'truncation was withdrawn, generation is twelve again and ' +
                'catalogued in docs/preserved-quirks.md 11.21, and the expectation ' +
                'is corrected to the length the application actually produces.'
  }
];

/**
 * The record as a title -> entry map, built once.
 *
 * A duplicate title in the record would make the checks below ambiguous - one
 * case could satisfy two entries - so it is rejected here, at load time, rather
 * than producing a confusing verdict at the end of the run.
 *
 * @returns {Object} Own-property map from full Mocha title to record entry.
 * @throws {Error} If two entries carry the same title.
 */
var CORRECTIONS_BY_TITLE = (function() {
  var map = Object.create(null);
  var i;

  for (i = 0; i < ASSERTION_CORRECTIONS.length; i++) {
    if (hasRecordedTitle(map, ASSERTION_CORRECTIONS[i].title)) {
      throw new Error(
        'assertion-correction record is malformed: the title "' +
        ASSERTION_CORRECTIONS[i].title + '" appears twice. Each entry must name ' +
        'a distinct case, because the checks below match entries against the ' +
        'run by title.'
      );
    }

    map[ASSERTION_CORRECTIONS[i].title] = ASSERTION_CORRECTIONS[i];
  }

  return map;
})();

/**
 * Own-property membership test for a null-prototype map.
 *
 * Written out rather than using `in`, so a case whose title happens to be
 * `constructor` or `toString` cannot be read as recorded.
 *
 * @param {Object} map
 * @param {string} title
 * @returns {boolean}
 */
function hasRecordedTitle(map, title) {
  return Object.prototype.hasOwnProperty.call(map, title);
}

/**
 * Renders one case for the log: its full title, and either its correction entry
 * indented beneath it or an explicit note that it has none.
 *
 * The unrecorded form is what an ordinary failure prints, and saying so in words
 * rather than by omission is what keeps the diagnostic readable to someone who
 * has only the log.
 *
 * @param {string} title A full Mocha title, recorded or not.
 * @returns {string} A multi-line block, already indented.
 */
function describeCorrection(title) {
  var entry = CORRECTIONS_BY_TITLE[title];

  if (!entry) {
    return '  - ' + title + '\n      (not in the assertion-correction record)';
  }

  return '  - ' + entry.title +
         '\n      at:        ' + entry.at +
         '\n      request:   ' + entry.request +
         '\n      was:       ' + entry.assertion +
         '\n      expected:  ' + entry.expected +
         '\n      measured:  ' + entry.measured +
         '\n      target:    ' + entry.commands.target +
         '\n      baseline:  ' + entry.commands.baseline +
         '\n      reason:    ' + entry.reason;
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

  // A failing case whose expectation was corrected means the value BOTH trees
  // produced when it was measured is no longer the value this tree produces.
  // That is a different diagnosis from an ordinary failure and gets a different
  // instruction: re-measure both trees before touching the assertion.
  var regressedCorrections = failedTitles.filter(function(title) {
    return hasRecordedTitle(CORRECTIONS_BY_TITLE, title);
  });

  var otherFailures = failedTitles.filter(function(title) {
    return !hasRecordedTitle(CORRECTIONS_BY_TITLE, title);
  });

  // Two cases sharing one full title would let one case stand in for two record
  // entries, so the count is compared as well as the membership.
  var duplicated = failedTitles.filter(function(title, index) {
    return failedTitles.indexOf(title) !== index;
  });

  var filter = activeCaseFilter();

  // A filtered run cannot be measured against the fixed total, because the
  // filter is what chose the subset. What remains checkable is that the pattern
  // matched something and that everything it matched passed - which is what
  // makes a targeted run usable as a green signal without letting a targeted
  // failure through.
  if (filter) {
    if (executed === 0 || failedTitles.length > 0) {
      throw new Error(
        'suite-total gate failed under an active `' + filter.flag + ' ' + filter.pattern +
        '` filter: expected every selected case to pass, but measured registered=' +
        registered + ', executed=' + executed + ', passed=' + passed +
        ', failing=' + failedTitles.length + '.\n' +
        (failedTitles.length
          ? 'Failing cases:\n' + failedTitles.map(describeCorrection).join('\n') + '\n'
          : '') +
        (regressedCorrections.length
          ? 'Of those, ' + regressedCorrections.length + ' carry an entry in the ' +
            'assertion-correction record, so the value measured on both trees has ' +
            'MOVED. Re-measure both trees with the commands in the entry before ' +
            'touching the assertion.\n'
          : '') +
        'The fixed total of ' + EXPECTED_CASES + ' is not asserted while a filter is in ' +
        'force, because a filter selects a subset by design, and the correction record ' +
        'cannot be checked for staleness either - an entry the filter did not select is ' +
        'simply absent from the results. An executed count of 0 means every selected ' +
        'case was suppressed before it ran, which a failing `before all` hook does.'
      );
    }

    return;
  }

  // Recorded but no longer registered: the record is stale. The case was
  // renamed, moved or removed, and an entry that describes a case Mocha does not
  // run is a claim nothing checks.
  var collectedTitles = cases.map(function(test) {
    return test.fullTitle();
  });
  var unmatchedRecords = ASSERTION_CORRECTIONS.map(function(entry) {
    return entry.title;
  }).filter(function(title) {
    return collectedTitles.indexOf(title) === -1;
  });

  if (registered !== EXPECTED_CASES ||
      executed !== EXPECTED_CASES ||
      passed !== EXPECTED_CASES ||
      failedTitles.length > 0 ||
      unmatchedRecords.length > 0 ||
      duplicated.length > 0) {
    throw new Error(
      'suite-total gate failed. Measured registered=' + registered +
      ', executed=' + executed + ', passed=' + passed +
      ', failing=' + failedTitles.length +
      '; expected registered=' + EXPECTED_CASES + ', executed=' + EXPECTED_CASES +
      ', passed=' + EXPECTED_CASES + ' and an empty failing set.\n' +
      (registered !== EXPECTED_CASES
        ? 'REGISTERED COUNT WRONG: a count below ' + EXPECTED_CASES + ' means a spec file or ' +
          'suite did not run at all - check that every name in the `sequence` array at the top ' +
          'of this file is required and called, and that no `describe` threw while registering.\n'
        : '') +
      (executed !== EXPECTED_CASES
        ? 'EXECUTED COUNT WRONG: cases registered but never ran, which is what a failing ' +
          '`before all` hook does to the rest of its suite, and what a pending case looks ' +
          'like. Look above for the first failing hook.\n'
        : '') +
      (otherFailures.length
        ? 'FAILURES (' + otherFailures.length + ') with no entry in the assertion-correction ' +
          'record. Each one is a regression until it is shown to fail identically on a ' +
          'baseline stack at 2f8712a, and R-d forbids changing application behaviour to ' +
          'satisfy a test:\n' +
          otherFailures.map(describeCorrection).join('\n') + '\n'
        : '') +
      (regressedCorrections.length
        ? 'CORRECTED CASES FAILING AGAIN (' + regressedCorrections.length + '). Each of these ' +
          'asserts a value measured on BOTH trees, so a failure means the measurement has ' +
          'moved. Re-measure both trees with the commands in the entry below and fix the ' +
          'cause; correct the expected value only if both trees agree on a new one:\n' +
          regressedCorrections.map(describeCorrection).join('\n') + '\n'
        : '') +
      (unmatchedRecords.length
        ? 'STALE RECORD ENTRIES (' + unmatchedRecords.length + '), named in the ' +
          'assertion-correction record but not registered in this run. The case was renamed, ' +
          'moved or removed; update or DELETE the entry, since an entry describing a case ' +
          'that does not run is checked by nothing:\n' +
          unmatchedRecords.map(function(title) { return '  - ' + title; }).join('\n') + '\n'
        : '') +
      (duplicated.length
        ? 'AMBIGUOUS TITLES (' + duplicated.length + '): two cases share one full Mocha title, so ' +
          'one case could stand in for two record entries. Rename one of them:\n' +
          duplicated.map(function(title) { return '  - ' + title; }).join('\n') + '\n'
        : '') +
      'A count alone cannot tell a new failure from a corrected one, which is why this gate ' +
      'compares the failing SET against the record rather than the number of passes.'
    );
  }

  // Every count matched and nothing failed, so this hook adds no failure of its
  // own. It still says so, and it still prints the record: a reader of a green
  // log sees which ten expected values were corrected, what each one now
  // asserts, and the command that measured both trees - which is what makes the
  // green verifiable rather than merely reported.
  console.log(
    '  suite-total gate: ' + registered + ' registered, ' + executed + ' executed, ' +
    passed + ' passing, ' + failedTitles.length + ' failing. The ' +
    ASSERTION_CORRECTIONS.length + ' cases below carry an expected value corrected to ' +
    'what BOTH this tree and a baseline stack at 2f8712a produce; each was measured on ' +
    'both trees with the command in its entry, and each remains an exact assertion:\n' +
    ASSERTION_CORRECTIONS.map(function(entry) {
      return describeCorrection(entry.title);
    }).join('\n')
  );
});
