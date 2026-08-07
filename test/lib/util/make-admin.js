/**
 * The administrator-provisioning script: `scripts/make-admin.js`.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `scripts/make-admin.js` grants the `admin` site role - the highest privilege this application has, gating
 * every `/admin/*` route through `lib/util/helpers.js` and `lib/controllers/admin.js` - and it was rewritten
 * from callbacks to `async`/`await` by this modernization. Runtime QA then measured it as the ONLY in-scope
 * application file with no coverage record at all: of the 74 files instrumented under `NODE_V8_COVERAGE`
 * during a full `npm test`, this one was never loaded, because nothing could load it. Its argv read, its
 * usage banner, its `require('../config/db')` connection and its five `process.exit` calls all happened
 * during module load, so a spec that required it would have connected to whatever database the environment
 * resolved and then killed the Mocha process.
 *
 * `scripts/make-admin.js` therefore now carries the same `require.main === module` guard
 * `test/baseline/capture.js` and `test/baseline/replay.js` carry (AAP 0.7.5), and exports `makeAdmin`, which
 * RETURNS the exit code the CLI exits with instead of exiting itself. Nothing observable changed: every
 * message, its argument shape, its order and its exit code are the base commit's. This file is what proves
 * that - and what pins the privilege grant itself, whose shape is only ever seen by an operator running the
 * script by hand.
 *
 * WHAT IS ASSERTED, AND WHY EACH ARM MATTERS
 * ------------------------------------------
 *   1. ALREADY AN ADMIN     -> code 0, one message, and the document is byte-for-byte untouched. The
 *                              assertion is on the permission array specifically: the early return happens
 *                              BEFORE `Roles.getPermissions`, so a document that came back carrying the
 *                              sixteen admin permissions would prove the guard had been lost.
 *   2. EXISTING SITE ROLE   -> `admin` is APPENDED to the roles the user already had, and the permissions
 *                              are UNIONED - the pre-existing ones survive, the admin set is added, and an
 *                              overlap is not duplicated. This is the merge branch (`_.union`), and a
 *                              regression here silently strips whatever role the user already held.
 *   3. NO SITE ROLE         -> a new `{context:'site', roles:['admin'], permissions, thru:{}, limits:{}}`
 *                              entry is created and every other context is left alone.
 *   4. IDEMPOTENCE          -> a second run reports "already an admin" and changes nothing, which is the
 *                              behaviour an operator relies on when they cannot remember whether it ran.
 *   5. THE TWO FAILURE ARMS -> the lookup rejection and the grant-path rejection report DIFFERENT prefixes
 *                              ("Database error:" and "Error:") and both answer 1. The script's own comment
 *                              records that its two try/catch blocks are separate for exactly this reason,
 *                              so both are pinned rather than the split being taken on trust.
 *   6. THE CLI ITSELF       -> three real child processes run `node scripts/make-admin.js`, because the
 *                              guard is only worth anything if the guarded path still works. One asserts the
 *                              usage banner and exit 1, one the unknown-email refusal and exit 1, and one
 *                              promotes a real fixture user and then reads the document back, which proves
 *                              the whole chain - argv, connection, lookup, grant, save, exit 0 - end to end.
 *   7. INERTNESS            -> a fourth child requires the module with `mongoose.connect` and `process.exit`
 *                              instrumented and asserts that neither is called, that no connection listener
 *                              is registered and that `config/db.js` and the models are never loaded. That is
 *                              the property which makes this spec safe to run at all, and it is asserted
 *                              rather than assumed.
 *
 * HOW THE FIXTURES ARE CHOSEN
 * ---------------------------
 * Every fixture identity is unique to this file, so nothing here can disturb `defaults.user`, `defaults.admin`
 * or the cookie slots the API suites share; each is removed by email in `before` and again in `after`, so a
 * crashed run cannot poison the next one through the unique index on `email`. They are declared here rather
 * than in test/helpers/defaults.js because no other suite has any use for them.
 *
 * Arm 3's fixture carries a NON-site role rather than no roles at all. That is not cosmetic: `lib/models/user.js`'s
 * `checkPermissions` pre-save hook calls `setRoles('user', 'site')` whenever `roles.length === 0`, so a user
 * saved with an empty roles array arrives with a site role already in place and would exercise the merge
 * branch instead of the create branch.
 *
 * The expected permission set is read from `Roles.getPermissions('admin')` rather than written out as a
 * literal, so this spec pins the SCRIPT's behaviour - grant exactly the admin permission set - and does not
 * become a second, drifting copy of `lib/models/roles.js`.
 *
 * WHAT IS DELIBERATELY NOT TESTED, AND WHY
 * ----------------------------------------
 * Measured with `NODE_V8_COVERAGE` over a full `npm test`, the file goes from NO coverage record at all to
 * every function executed - `makeAdmin`, `runCli` and the connection continuation - with three residues, all
 * of them either unreachable by construction or genuinely unmanufacturable here:
 *
 *   - `mongoose.connection.readyState === 1` in the CLI path. A freshly started CLI process is always still
 *     connecting when that line runs, so the `once('open', ...)` arm is the one every child takes. The other
 *     arm exists for a caller that has already connected, which no entry point in this tree is.
 *   - The mongoose connection-error handler (`console.error('MongoDB connection error:', ...)` then
 *     `process.exit(1)`). Reaching it needs a mongod that accepts a connection and then fails it, which this
 *     suite cannot manufacture without a proxy. The two failure arms above cover the reporting shape, and the
 *     handler is the base commit's own three lines, unchanged.
 *   - `user.roles[siteRoleIndex].permissions || []` in the merge branch. A mongoose document array is never
 *     falsy, so that half of the guard cannot be taken; the other `permissions || []` guard IS exercised, by
 *     the "role table yields no permissions" test.
 */

// The bootstrap, reached the way every model-touching spec reaches it and BEFORE `config` is read below:
// this helper requires `../setup` as its first statement, which is what makes a single-file run of this file
// resolve the same configuration - and the same disposable database - as a full `npm test`. Required for the
// side effect only, exactly as test/helpers/defaults.js requires it.
require('../../helpers/db');

var path      = require('path'),
    spawnSync = require('child_process').spawnSync,
    _         = require('underscore'),
    sinon     = require('sinon'),
    should    = require('chai').should(),
    config    = require('config'),
    User      = require('../../../lib/models/user'),
    Roles     = require('../../../lib/models/roles'),
    script    = require('../../../scripts/make-admin');

describe('make-admin script', function() {
  // test/lib/util/make-admin.js -> the repository root.
  var REPO_ROOT   = path.resolve(__dirname, '..', '..', '..'),
      SCRIPT_PATH = path.join(REPO_ROOT, 'scripts', 'make-admin.js'),
      // Generous and one-sided: it pays for a Node start, a node-config load and a mongoose connection, and
      // every assertion reads the child's output, so a slow machine cannot turn a pass into a failure.
      CHILD_TIMEOUT_MS = 60000;

  var FIXTURES = {
    // Arm 1. Already carries `admin` in its site context, with a single permission that is NOT part of the
    // admin set, so an unwanted save is visible as a permission list that grew.
    already : {
      fullname : 'make admin already',
      username : 'makeadminalready',
      email    : 'make-admin-already@example.com',
      password : 'makeAdminAlready!234',
      roles    : [{ context : 'site', roles : ['admin'], permissions : ['blitzy-untouched-permission'],
                    thru : {}, limits : {} }]
    },
    // Arm 2. An existing site role WITHOUT admin, whose permissions deliberately overlap the admin set by
    // exactly one entry so the union can be checked for duplicates.
    merge : {
      fullname : 'make admin merge',
      username : 'makeadminmerge',
      email    : 'make-admin-merge@example.com',
      password : 'makeAdminMerge!234',
      roles    : [{ context : 'site', roles : ['user'],
                    permissions : ['create-python-trinket', 'blitzy-existing-permission'],
                    thru : {}, limits : {} }]
    },
    // Arm 3. A non-site context only, for the reason recorded in the header.
    create : {
      fullname : 'make admin create',
      username : 'makeadmincreate',
      email    : 'make-admin-create@example.com',
      password : 'makeAdminCreate!234',
      roles    : [{ context : 'course:make-admin', roles : ['course-owner'],
                    permissions : ['view-course-content'], thru : {}, limits : {} }]
    },
    // Arm 6c, promoted by a real child process rather than in-process.
    cli : {
      fullname : 'make admin cli',
      username : 'makeadmincli',
      email    : 'make-admin-cli@example.com',
      password : 'makeAdminCli!234',
      roles    : [{ context : 'course:make-admin-cli', roles : ['course-owner'],
                    permissions : ['view-course-content'], thru : {}, limits : {} }]
    },
    // Arm 5 and the mixed-case lookup. Plain, so the failure arms are not confused by role shape.
    failure : {
      fullname : 'make admin failure',
      username : 'makeadminfailure',
      email    : 'make-admin-failure@example.com',
      password : 'makeAdminFailure!234',
      roles    : [{ context : 'site', roles : ['user'], permissions : ['create-python-trinket'],
                    thru : {}, limits : {} }]
    },
    // For the `permissions || []` defaults, which need a role table that yields nothing. Two fixtures,
    // because the default appears once in each branch: this one has no site role...
    fallback : {
      fullname : 'make admin fallback',
      username : 'makeadminfallback',
      email    : 'make-admin-fallback@example.com',
      password : 'makeAdminFallback!234',
      roles    : [{ context : 'course:make-admin-fallback', roles : ['course-owner'],
                    permissions : ['view-course-content'], thru : {}, limits : {} }]
    },
    // ...and this one does, so the union runs with nothing to add.
    fallbackMerge : {
      fullname : 'make admin fallback merge',
      username : 'makeadminfallbackmerge',
      email    : 'make-admin-fallback-merge@example.com',
      password : 'makeAdminFallbackMerge!234',
      roles    : [{ context : 'site', roles : ['user'], permissions : ['create-python-trinket'],
                    thru : {}, limits : {} }]
    }
  };

  var FIXTURE_EMAILS = _.map(FIXTURES, function(fixture) { return fixture.email; }),
      UNKNOWN_EMAIL  = 'make-admin-nobody@example.com',
      adminPermissions;

  /**
   * The operator's console, recorded rather than printed.
   *
   * `console.log('User', user.email, 'is already an admin.')` formats its arguments with a single space
   * between them, so joining with a space reproduces the line an operator reads while keeping the argument
   * boundaries assertable. Recording it also keeps the reporter output clean.
   *
   * @returns {{out: string[], err: string[], log: function, error: function}} The recorder.
   */
  function recordIo() {
    var io = {
      out   : [],
      err   : [],
      log   : function() { io.out.push(Array.prototype.slice.call(arguments).join(' ')); },
      error : function() { io.err.push(Array.prototype.slice.call(arguments).join(' ')); }
    };

    return io;
  }

  /**
   * Creates one fixture user, through the real model so every hook and index applies.
   *
   * @param   {string} key A key of FIXTURES.
   * @returns {Promise<object>} The saved document.
   */
  function seed(key) {
    return new User(FIXTURES[key]).save();
  }

  /**
   * Reads a user back from the database as a plain object, so assertions compare plain arrays rather than
   * mongoose array wrappers.
   *
   * @param   {string} email The email to look up.
   * @returns {Promise<object|null>} The plain document, or null.
   */
  function reload(email) {
    return User.findByLogin(email).then(function(doc) {
      return doc ? doc.toObject() : null;
    });
  }

  /**
   * The roles entry for one context, from a plain document.
   *
   * @param   {object} doc     A document from reload().
   * @param   {string} context The context to select.
   * @returns {object|undefined} The entry.
   */
  function roleFor(doc, context) {
    return _.find(doc.roles, function(role) { return role.context === context; });
  }

  /**
   * Runs `node scripts/make-admin.js [args...]` in a child process.
   *
   * The child is given the mongo endpoint this run already resolved - host, port and the disposable database
   * name, which for a parallel clone is its own `test_<CLONE_INDEX>` - so it acts on the same data this spec
   * seeded and can reach nothing else. `NODE_ENV` and `NODE_CONFIG_PERSIST_ON_CHANGE` are set explicitly
   * because node-config resolves its layers on its first require inside the child, where test/setup.js does
   * not run.
   *
   * @param   {string[]} args Arguments after the script path.
   * @returns {{status: number, stdout: string, stderr: string}} The child's outcome.
   */
  function runCli(args) {
    var child = spawnSync(process.execPath, [SCRIPT_PATH].concat(args), {
      cwd      : REPO_ROOT,
      encoding : 'utf8',
      timeout  : CHILD_TIMEOUT_MS,
      env      : Object.assign({}, process.env, {
        NODE_ENV    : 'test',
        NODE_CONFIG_PERSIST_ON_CHANGE : 'N',
        NODE_CONFIG : JSON.stringify({
          db : {
            mongo : {
              host     : config.db.mongo.host,
              port     : config.db.mongo.port,
              database : config.db.mongo.database
            }
          }
        })
      })
    });

    // A child that never ran - a spawn failure, a signal, a timeout - must fail the test rather than be
    // read as agreement with whatever the assertions expect.
    should.not.exist(child.error);
    should.not.exist(child.signal);

    return { status : child.status, stdout : child.stdout || '', stderr : child.stderr || '' };
  }

  before(async function() {
    this.timeout(CHILD_TIMEOUT_MS);

    // Read from the same source the script reads, so this spec cannot drift from lib/models/roles.js.
    adminPermissions = await Roles.getPermissions('admin');

    // Leftovers from an interrupted run would collide with the unique index on `email`.
    await User.model.deleteMany({ email : { $in : FIXTURE_EMAILS } });
  });

  after(async function() {
    this.timeout(CHILD_TIMEOUT_MS);

    await User.model.deleteMany({ email : { $in : FIXTURE_EMAILS } });
  });

  describe('module surface', function() {
    it('exports makeAdmin and nothing else', function() {
      Object.keys(script).should.eql(['makeAdmin']);
      script.makeAdmin.should.be.a('function');
      script.makeAdmin.length.should.eql(2);
    });

    it('is still the file `npm run make-admin` invokes', function() {
      // The guard is only correct if the operator entry point still reaches it.
      require('../../../package.json').scripts['make-admin'].should.eql('node scripts/make-admin.js');
    });

    it('writes to the real console when no recorder is supplied', async function() {
      this.timeout(CHILD_TIMEOUT_MS);

      // The `io` parameter defaults to `console`, and this is the only test that takes that default - so it
      // is also where the ARGUMENT SHAPE the base commit put on the console is pinned. `console.error` was
      // called with two arguments, not with one interpolated string, and `console.error(...)` is what the CLI
      // still reaches through `io`.
      var error = sinon.stub(console, 'error'),
          log   = sinon.stub(console, 'log');

      try {
        var code = await script.makeAdmin(UNKNOWN_EMAIL);

        code.should.eql(1);
        error.calledTwice.should.be.true;
        error.firstCall.calledWithExactly('User not found with email:', UNKNOWN_EMAIL).should.be.true;
        error.secondCall.calledWithExactly('Make sure the user has registered first.').should.be.true;
        log.called.should.be.false;
      }
      finally {
        error.restore();
        log.restore();
      }
    });
  });

  describe('when the user is already an admin', function() {
    var io, code;

    before(async function() {
      this.timeout(CHILD_TIMEOUT_MS);

      await seed('already');
      io   = recordIo();
      code = await script.makeAdmin(FIXTURES.already.email, io);
    });

    it('reports success', function() {
      code.should.eql(0);
    });

    it('says so, once, and reports no error', function() {
      io.out.should.eql(['User ' + FIXTURES.already.email + ' is already an admin.']);
      io.err.should.eql([]);
    });

    it('leaves the document exactly as it was, without reaching the permission grant', function() {
      return reload(FIXTURES.already.email).then(function(doc) {
        var site = roleFor(doc, 'site');

        should.exist(site);
        site.roles.should.eql(['admin']);
        // Untouched: had `Roles.getPermissions` run and the document been saved, this would carry the
        // sixteen admin permissions as well.
        site.permissions.should.eql(['blitzy-untouched-permission']);
        doc.roles.should.have.lengthOf(1);
      });
    });
  });

  describe('when the user already has a site role', function() {
    var io, code;

    before(async function() {
      this.timeout(CHILD_TIMEOUT_MS);

      await seed('merge');
      io   = recordIo();
      code = await script.makeAdmin(FIXTURES.merge.email, io);
    });

    it('reports success', function() {
      code.should.eql(0);
    });

    it('narrates the merge branch, in order, and reports no error', function() {
      io.out.should.eql([
        'Got admin permissions',
        'Found existing site role',
        'Success! User ' + FIXTURES.merge.email + ' is now an admin.',
        'They can access /admin after logging in.'
      ]);
      io.err.should.eql([]);
    });

    it('appends admin to the roles the user already had', function() {
      return reload(FIXTURES.merge.email).then(function(doc) {
        roleFor(doc, 'site').roles.should.eql(['user', 'admin']);
      });
    });

    it('unions the permissions without dropping or duplicating any', function() {
      return reload(FIXTURES.merge.email).then(function(doc) {
        var permissions = roleFor(doc, 'site').permissions;

        // The pre-existing permission survives...
        permissions.should.contain('blitzy-existing-permission');
        // ...every admin permission is present...
        adminPermissions.forEach(function(permission) {
          permissions.should.contain(permission);
        });
        // ...the overlapping one appears exactly once...
        _.filter(permissions, function(permission) {
          return permission === 'create-python-trinket';
        }).should.have.lengthOf(1);
        // ...and nothing at all is duplicated.
        permissions.should.have.lengthOf(_.uniq(permissions).length);
        permissions.should.have.lengthOf(_.union(FIXTURES.merge.roles[0].permissions,
          adminPermissions).length);
      });
    });

    it('grants the admin role as the application reads it', function() {
      return User.findByLogin(FIXTURES.merge.email).then(function(doc) {
        doc.hasRole('admin').should.be.true;
        // The role it already held is still readable too.
        doc.hasRole('user').should.be.true;
      });
    });
  });

  describe('when the user has no site role', function() {
    var io, code;

    before(async function() {
      this.timeout(CHILD_TIMEOUT_MS);

      await seed('create');
      io   = recordIo();
      code = await script.makeAdmin(FIXTURES.create.email, io);
    });

    it('reports success', function() {
      code.should.eql(0);
    });

    it('narrates the create branch, in order, and reports no error', function() {
      io.out.should.eql([
        'Got admin permissions',
        'creating new site role entry',
        'Success! User ' + FIXTURES.create.email + ' is now an admin.',
        'They can access /admin after logging in.'
      ]);
      io.err.should.eql([]);
    });

    it('creates a site entry carrying exactly the admin role and the admin permission set', function() {
      return reload(FIXTURES.create.email).then(function(doc) {
        var site = roleFor(doc, 'site');

        should.exist(site);
        site.context.should.eql('site');
        site.roles.should.eql(['admin']);
        site.permissions.should.eql(adminPermissions);
        // The script also writes `thru : {}` and `limits : {}`, and NEITHER reaches the database: mongoose's
        // default `minimize` strips empty objects on save, measured on the installed mongoose 6.13.10 both in
        // the raw collection document and through `toObject()`. That is why the persisted entry carries
        // exactly three fields, and why `lib/models/plugins/roles.js#has` is written to tolerate an absent
        // `thru`/`limits` - which the `hasRole`/`hasPermission` assertions below exercise.
        Object.keys(site).sort().should.eql(['context', 'permissions', 'roles']);
      });
    });

    it('leaves the contexts the user already had alone', function() {
      return reload(FIXTURES.create.email).then(function(doc) {
        var course = roleFor(doc, 'course:make-admin');

        doc.roles.should.have.lengthOf(2);
        should.exist(course);
        course.roles.should.eql(['course-owner']);
        course.permissions.should.eql(['view-course-content']);
      });
    });

    it('grants the admin role and its permissions as the application reads them', function() {
      return User.findByLogin(FIXTURES.create.email).then(function(doc) {
        doc.hasRole('admin').should.be.true;
        doc.hasPermission('create-python-trinket').should.be.true;
        // The course context is unaffected by a site grant.
        doc.hasRole('course-owner', 'course:make-admin').should.be.true;
      });
    });

    it('changes nothing when it runs a second time', async function() {
      this.timeout(CHILD_TIMEOUT_MS);

      var before = await reload(FIXTURES.create.email),
          io2    = recordIo(),
          code2  = await script.makeAdmin(FIXTURES.create.email, io2),
          after  = await reload(FIXTURES.create.email);

      code2.should.eql(0);
      io2.out.should.eql(['User ' + FIXTURES.create.email + ' is already an admin.']);
      io2.err.should.eql([]);
      roleFor(after, 'site').roles.should.eql(['admin']);
      roleFor(after, 'site').permissions.should.eql(roleFor(before, 'site').permissions);
      after.roles.should.have.lengthOf(before.roles.length);
    });
  });

  describe('when the user cannot be found', function() {
    var io, code;

    before(async function() {
      this.timeout(CHILD_TIMEOUT_MS);

      io   = recordIo();
      code = await script.makeAdmin(UNKNOWN_EMAIL, io);
    });

    it('reports failure', function() {
      code.should.eql(1);
    });

    it('says which address it looked for, and how to fix it', function() {
      io.err.should.eql([
        'User not found with email: ' + UNKNOWN_EMAIL,
        'Make sure the user has registered first.'
      ]);
      io.out.should.eql([]);
    });

    it('creates nothing', function() {
      return User.findByLogin(UNKNOWN_EMAIL).then(function(doc) {
        should.not.exist(doc);
      });
    });

    it('echoes the address as it was typed while still looking it up in lower case', async function() {
      this.timeout(CHILD_TIMEOUT_MS);

      await seed('failure');

      var mixedIo   = recordIo(),
          mixedCode = await script.makeAdmin(FIXTURES.failure.email.toUpperCase(), mixedIo);

      // The upper-cased address found the lower-cased user, so the lookup lower-cases...
      mixedCode.should.eql(0);
      mixedIo.err.should.eql([]);
      (await reload(FIXTURES.failure.email)).roles[0].roles.should.eql(['user', 'admin']);

      // ...while the not-found message echoes what the operator typed, unchanged.
      var missingIo = recordIo();

      (await script.makeAdmin('MAKE-ADMIN-Nobody@Example.COM', missingIo)).should.eql(1);
      missingIo.err[0].should.eql('User not found with email: MAKE-ADMIN-Nobody@Example.COM');
    });
  });

  describe('when the database fails', function() {
    afterEach(function() {
      if (User.findByLogin.restore) User.findByLogin.restore();
      if (Roles.getPermissions.restore) Roles.getPermissions.restore();
    });

    it('reports a lookup failure under its own prefix, and stops there', async function() {
      this.timeout(CHILD_TIMEOUT_MS);

      sinon.stub(User, 'findByLogin').callsFake(function() {
        return Promise.reject(new Error('connection reset by peer'));
      });

      var io   = recordIo(),
          code = await script.makeAdmin(FIXTURES.merge.email, io);

      code.should.eql(1);
      io.err.should.eql(['Database error: connection reset by peer']);
      io.out.should.eql([]);
    });

    it('reports a failure inside the grant under the other prefix, and saves nothing', async function() {
      this.timeout(CHILD_TIMEOUT_MS);

      await seed('cli');

      sinon.stub(Roles, 'getPermissions').callsFake(function() {
        return Promise.reject(new Error('permissions unavailable'));
      });

      var io   = recordIo(),
          code = await script.makeAdmin(FIXTURES.cli.email, io);

      code.should.eql(1);
      io.err.should.eql(['Error: permissions unavailable']);
      // The rejection happens before the first log line of the grant branch.
      io.out.should.eql([]);

      var doc = await reload(FIXTURES.cli.email);

      doc.roles.should.have.lengthOf(1);
      should.not.exist(roleFor(doc, 'site'));
    });

    it('still grants the role when the role table yields no permissions', async function() {
      this.timeout(CHILD_TIMEOUT_MS);

      await seed('fallback');
      await seed('fallbackMerge');

      // `Roles.getPermissions` answers `[]` for an unknown role today, so the script's `permissions || []`
      // defaults are defensive rather than reachable through configuration. This is what exercises them - once
      // per branch: an undefined answer must still produce a valid site entry rather than a validation
      // failure, because the grant, not the permission list, is what gates `/admin`.
      sinon.stub(Roles, 'getPermissions').callsFake(function() {
        return Promise.resolve(undefined);
      });

      // The create branch: a site entry appears carrying no permissions at all.
      var io   = recordIo(),
          code = await script.makeAdmin(FIXTURES.fallback.email, io);

      code.should.eql(0);
      io.out.should.contain('creating new site role entry');
      io.err.should.eql([]);

      var site = roleFor(await reload(FIXTURES.fallback.email), 'site');

      should.exist(site);
      site.roles.should.eql(['admin']);
      site.permissions.should.eql([]);
      (await User.findByLogin(FIXTURES.fallback.email)).hasRole('admin').should.be.true;

      // The merge branch: the union runs with nothing to add, so the permissions the user already had must
      // survive untouched rather than being replaced by an empty list.
      var mergeIo   = recordIo(),
          mergeCode = await script.makeAdmin(FIXTURES.fallbackMerge.email, mergeIo);

      mergeCode.should.eql(0);
      mergeIo.out.should.contain('Found existing site role');
      mergeIo.err.should.eql([]);

      var mergedSite = roleFor(await reload(FIXTURES.fallbackMerge.email), 'site');

      mergedSite.roles.should.eql(['user', 'admin']);
      mergedSite.permissions.should.eql(['create-python-trinket']);
    });
  });

  describe('the command-line entry point', function() {
    it('prints usage and fails when no address is given', function() {
      this.timeout(CHILD_TIMEOUT_MS);

      var child = runCli([]);

      child.status.should.eql(1);
      child.stderr.should.contain('Usage: node scripts/make-admin.js <email>');
      child.stderr.should.contain('Example: node scripts/make-admin.js admin@example.com');
      child.stdout.should.eql('');
    });

    it('fails when the address is not registered', function() {
      this.timeout(CHILD_TIMEOUT_MS);

      var child = runCli([UNKNOWN_EMAIL]);

      child.status.should.eql(1);
      child.stderr.should.contain('User not found with email: ' + UNKNOWN_EMAIL);
      child.stderr.should.contain('Make sure the user has registered first.');
    });

    it('promotes a real user end to end and exits 0', async function() {
      this.timeout(CHILD_TIMEOUT_MS * 2);

      // Seeded by the grant-failure test above, which deliberately left it unpromoted.
      var seeded = await reload(FIXTURES.cli.email);

      if (!seeded) await seed('cli');

      var child = runCli([FIXTURES.cli.email]);

      child.status.should.eql(0);
      child.stdout.should.contain('Got admin permissions');
      child.stdout.should.contain('creating new site role entry');
      child.stdout.should.contain('Success! User ' + FIXTURES.cli.email + ' is now an admin.');
      child.stdout.should.contain('They can access /admin after logging in.');
      child.stderr.should.eql('');

      // The write is what matters: the child really reached the database this spec is connected to.
      var doc  = await reload(FIXTURES.cli.email),
          site = roleFor(doc, 'site');

      should.exist(site);
      site.roles.should.eql(['admin']);
      site.permissions.should.eql(adminPermissions);
      (await User.findByLogin(FIXTURES.cli.email)).hasRole('admin').should.be.true;
    });

    it('does nothing at all when the module is merely required', function() {
      this.timeout(CHILD_TIMEOUT_MS);

      // The property that makes this spec - and Mocha's recursive spec glob - safe. Instrumented in a child
      // because `mongoose.connect` and `process.exit` cannot be replaced inside a running suite, and because
      // "was config/db.js loaded" is only answerable in a process that had not already loaded it.
      var probe = [
        'var repoRoot = process.env.MAKE_ADMIN_REPO_ROOT;',
        'var mongoose = require(repoRoot + "/node_modules/mongoose");',
        'var violations = [];',
        'var realConnect = mongoose.connect;',
        'mongoose.connect = function() { violations.push("mongoose.connect"); return undefined; };',
        'var realExit = process.exit;',
        'process.exit = function(code) { violations.push("process.exit(" + code + ")"); };',
        'var listenersBefore = mongoose.connection.listenerCount("open") +',
        '  mongoose.connection.listenerCount("error");',
        'var loaded = require(repoRoot + "/scripts/make-admin.js");',
        'var listenersAfter = mongoose.connection.listenerCount("open") +',
        '  mongoose.connection.listenerCount("error");',
        'process.exit = realExit;',
        'mongoose.connect = realConnect;',
        'function cached(pattern) {',
        '  return Object.keys(require.cache).some(function(key) { return pattern.test(key); });',
        '}',
        'process.stdout.write("PROBE:" + JSON.stringify({',
        '  violations      : violations,',
        '  listenersAdded  : listenersAfter - listenersBefore,',
        '  connectionState : mongoose.connection.readyState,',
        '  configDbLoaded  : cached(/config\\/db\\.js$/),',
        '  userModelLoaded : cached(/lib\\/models\\/user\\.js$/),',
        '  exportKeys      : Object.keys(loaded)',
        '}) + ":ENDPROBE");'
      ].join('\n');

      var child = spawnSync(process.execPath, ['-e', probe], {
        cwd      : REPO_ROOT,
        encoding : 'utf8',
        timeout  : CHILD_TIMEOUT_MS,
        env      : Object.assign({}, process.env, { MAKE_ADMIN_REPO_ROOT : REPO_ROOT })
      });

      should.not.exist(child.error);
      should.not.exist(child.signal);

      var output    = (child.stdout || '') + (child.stderr || ''),
          delimited = /PROBE:([\s\S]*?):ENDPROBE/.exec(output);

      should.exist(delimited, 'probe produced no verdict; raw output was ' + JSON.stringify(output));

      var verdict = JSON.parse(delimited[1]);

      child.status.should.eql(0, 'probe exited ' + child.status + '; raw output was ' +
        JSON.stringify(output));
      verdict.violations.should.eql([]);
      verdict.listenersAdded.should.eql(0);
      // 0 is mongoose's `disconnected`.
      verdict.connectionState.should.eql(0);
      verdict.configDbLoaded.should.be.false;
      verdict.userModelLoaded.should.be.false;
      verdict.exportKeys.should.eql(['makeAdmin']);
    });
  });
});
