// The suite's bootstrap, required explicitly because `config` on the next line resolves its layers on the
// first require and `.mocharc.json` carries no `require` preload to guarantee the order. See the note at the
// head of test/helpers/db.js; requiring it here is what makes a single-file run of any model spec - all of
// which reach this module - resolve the same configuration as a full `npm test`.
require('../setup');

var _        = require('underscore'),
    config   = require('config'),
    defaults = {};

defaults.extend = function(custom, defaults) {
  if (typeof defaults === 'string') {
    defaults = this[defaults];
  }
  
  return _.extend({}, defaults, custom);
}

defaults.user = {
  fullname: 'test user',
  // name:     'test',
  username: 'testing',
  email:    'test@dummy.com',
  password: 'bacon'
};

defaults.admin = {
  fullname: 'admin user',
  // name:     'admin',
  username: 'administrator',
  email:    'admin@example.com',
  password: 'fakin',
  roles: [{
    context : "site", roles : [ "admin" ]
  }]
};

defaults.login = {
  email:    defaults.user.email,
  password: defaults.user.password
};

// An identity used ONLY by test/lib/api/route-parity.js, so that suite can drive the authenticated
// supplement live without touching `defaults.user` - whose password forgot_pass.js deliberately changes
// and whose session the earlier eight suites share. `flow.switchUser('parity', done)` creates the account
// on first use and files its cookie under its own slot, so nothing the parity suite does can disturb the
// slot any other suite reads. See the header of test/lib/api/route-parity.js.
defaults.parity = {
  fullname: 'route parity',
  username: 'routeparity',
  email:    'route-parity@example.com',
  password: 'routeParity!234'
};

// Isolated identities for the high-risk parameterized/write-route suite. They have their own cookie
// slots so its archive, folder, invitation, user and admin probes cannot disturb the original nine API
// suites, the session-transition suite or route-parity's authenticated supplement.
defaults.routeCoverage = {
  fullname: 'route coverage owner',
  username: 'routecoverage',
  email:    'route-coverage@example.com',
  password: 'routeCoverage!234'
};

defaults.routeCoverageOther = {
  fullname: 'route coverage other',
  username: 'routecoverageother',
  email:    'route-coverage-other@example.com',
  password: 'routeCoverageOther!234'
};

defaults.course = {
  name:        'test course',
  description: 'test course description'
};

defaults.lesson = {
  name: 'test lesson'
};

defaults.material = {
  name: 'test material',
  type: 'page'
};

defaults.section = {
  name: 'test section'
};

defaults.content = {
  content: 'test content'
};

// Dependency swap - `diff` moves 1.0.8 -> 9.0.0 (see docs/MIGRATION-DEPENDENCY-INVENTORY.md). MEASURED
// on the installed diff 9.0.0: the base literal's abbreviated header ('@@ -1 +1,2 @@') makes
// applyPatch return false, so the route answered 500. The literal below is the shape the browser's
// pinned jsdiff actually emits for a first edit on an empty page, and it is the form
// lib/controllers/course.js#updateMaterial normalises. The assertion in test/lib/api/course.js is
// unchanged. See docs/PRESERVED-QUIRKS.md sections 3.17 and 13.7.
defaults.patch = {
  patch: '@@ -1,0 +1,2 @@\n+test content\n+No newline at end of file\n'
}

defaults.file = {
  upload: 'test/data/transparent.gif',
  name: 'transparent.gif',
  type: 'embed'
};

defaults.ipynb = {
  upload: 'test/data/test.ipynb',
  name: 'test.ipynb',
  type: 'download'
};

defaults.trinket = {
  code: 'import turtle'
};

defaults.snapshot = {
  code: defaults.trinket.code,
  assets: [],
  lang: 'python',
  shortCode: 'abcd1234'
};

defaults.trinketRunError = {
  state: 'encountered',
  error: 'ParseError: bad token on line 1',
  session: 'abc-123',
  group: 1,
  type: 'ParseError',
  message: 'bad token',
  line: 1,
  code: 'print "missing quote',
  attempt: 0,
  lang: 'python'
};

defaults.recaptcha = {
  'g-recaptcha-response': 'testing'
};

module.exports = defaults;
