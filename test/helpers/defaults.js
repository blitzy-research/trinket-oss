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

// dependency swap - `diff` moves 1.0.8 -> 9.0.0 (see the delivered dependency inventory).
// R-6 ADJUDICATION. flow.addNewMaterial posts defaults.material, which carries no `content`, so
// lib/controllers/course.js#updateMaterial applies this patch to an EMPTY base. The previous
// literal used an abbreviated hunk header ('@@ -1 +1,2 @@') whose context line does not exist in
// an empty base; diff 1.0.8's header regex could not parse that form at all, so it skipped context
// verification entirely and spliced the added lines in at index 0, which is the only reason the
// stale patch ever applied. No client emits that shape. The literal below is byte-for-byte what
// the browser's pinned jsdiff 1.0.8 - see config/default.yaml and
// public/js/courseEditor/controllers/materialControl.js:L321 - emits for the real first edit on an
// empty page, createPatch(id, '', 'test content\nNo newline at end of file\n'). Measured against
// BOTH diff 1.0.8 and diff 9.0.0, applyPatch('', patch) returns exactly
// 'test content\nNo newline at end of file\n', so the existing assertion in test/lib/api/course.js
// is unchanged and unweakened and the fixture now pins the real production patch shape.
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
