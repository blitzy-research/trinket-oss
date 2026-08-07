#!/usr/bin/env node
/**
 * Make a user an admin
 * Usage: node scripts/make-admin.js <email>
 *
 * This script grants the 'admin' role to an existing user.
 * The user must already have an account.
 *
 * TESTABILITY, AND WHY THE CLI LIVES BEHIND `require.main === module`
 * ------------------------------------------------------------------
 * This script grants the `admin` site role, which is the highest privilege the application has, and until
 * now nothing exercised it: runtime QA measured `scripts/make-admin.js` as the only in-scope application
 * file with NO coverage record at all under `NODE_V8_COVERAGE`, because the file could not be loaded from a
 * spec. Every side effect used to happen during module load - `process.argv` was read, a missing argument
 * called `process.exit(1)`, `require('../config/db')` opened a mongoose connection, and two connection
 * listeners were registered - and `makeAdmin` itself ended each of its five branches with `process.exit`.
 * Requiring it from a test would therefore have connected to whatever database the environment resolved and
 * then killed the Mocha process.
 *
 * The split below is structural only, and it is the same guard `test/baseline/capture.js` and
 * `test/baseline/replay.js` use for the same reason (AAP 0.7.5): requiring this module is INERT - it reads
 * no argv, opens no connection, registers no listener, loads no model and never exits - while
 * `node scripts/make-admin.js <email>` and `npm run make-admin <email>` behave exactly as before.
 *
 * NOTHING OBSERVABLE CHANGED. Every message, its argument shape, its order and its exit code are the base
 * commit's, verbatim; the only difference is that `makeAdmin` now RETURNS the code the CLI exits with
 * instead of calling `process.exit` itself, so a spec can drive it and read the outcome. The two try/catch
 * blocks stay separate for the reason recorded at their site, the models are required at the point of use so
 * the CLI still loads `../config/db` first, and the CLI still leaves an unexpected rejection unhandled -
 * which is what the base commit's bare `makeAdmin()` call did, and which Node turns into a fatal error with
 * the same non-zero exit.
 *
 * Covered by test/lib/util/make-admin.js.
 */

var mongoose = require('mongoose');
var _ = require('underscore');

/**
 * Grants the 'admin' site role to an existing user and reports the exit code the CLI should use.
 *
 * The models are required HERE rather than at module load so that requiring this file has no side effect
 * and so that the CLI path below still loads `../config/db` - which calls `mongoose.connect()` while it is
 * being required - before any model is defined, exactly as the base commit did. `require` is cached, so a
 * second call costs nothing.
 *
 * @param   {string} email   The email or username to promote, as the operator typed it. It is lower-cased
 *                           for the lookup only: the "not found" message echoes what was typed.
 * @param   {{log: function, error: function}} [io] Where the operator-visible output goes. Defaults to the
 *                           console; a spec passes a recorder so the output contract can be asserted.
 * @returns {Promise<number>} 0 when the user is (or has become) an admin, 1 for every failure the base
 *                           commit reported with `process.exit(1)`.
 */
async function makeAdmin(email, io) {
  var User = require('../lib/models/user');
  var Roles = require('../lib/models/roles');
  var user;

  io = io || console;

  // Two try/catch blocks are deliberate: the lookup failure and every later failure report
  // different message prefixes, so collapsing them into one catch would change the output.
  try {
    // findByLogin searches by email or username
    user = await User.findByLogin(email.toLowerCase());
  } catch (err) {
    io.error('Database error:', err.message);
    return 1;
  }

  if (!user) {
    io.error('User not found with email:', email);
    io.error('Make sure the user has registered first.');
    return 1;
  }

  // Check if already admin
  if (user.hasRole('admin')) {
    io.log('User', user.email, 'is already an admin.');
    return 0;
  }

  try {
    var permissions = await Roles.getPermissions('admin');
    io.log('Got admin permissions');

    // Find site context or create it
    var siteRoleIndex = _.findIndex(user.roles, function (r) {
      return r.context === 'site';
    });

    if (siteRoleIndex >= 0) {
      io.log('Found existing site role');
      if (user.roles[siteRoleIndex].roles.indexOf('admin') < 0) {
        user.roles[siteRoleIndex].roles.push('admin');
      }
      user.roles[siteRoleIndex].permissions = _.union(
        user.roles[siteRoleIndex].permissions || [],
        permissions || [],
      );
    } else {
      io.log('creating new site role entry');
      user.roles.push({
        context: 'site',
        roles: ['admin'],
        permissions: permissions || [],
        thru: {},
        limits: {},
      });
    }

    var savedUser = await user.save();
    io.log('Success! User', savedUser.email, 'is now an admin.');
    io.log('They can access /admin after logging in.');
    return 0;
  } catch (err) {
    io.error('Error:', err.message);
    return 1;
  }
}

/**
 * The command-line entry point: everything that must NOT happen on a bare require.
 *
 * The order is the base commit's, because each step depends on the one before it - the usage banner is
 * printed before any connection is attempted, `../config/db` connects while it is required, and the
 * connection listeners are registered afterwards. `makeAdmin`'s resolved value is handed straight to
 * `process.exit`, which is where the five `process.exit` calls that used to live inside it now happen.
 *
 * @param {string[]} argv `process.argv`.
 * @returns {undefined}
 */
function runCli(argv) {
  var email = argv[2];

  if (!email) {
    console.error('Usage: node scripts/make-admin.js <email>');
    console.error('Example: node scripts/make-admin.js admin@example.com');
    process.exit(1);
  }

  // Connect to database
  require('../config/db');

  function start() {
    // Deliberately unterminated, as at the base commit: `makeAdmin` handles every failure it reports on
    // itself, so a rejection here is a genuinely unexpected fault and Node's fatal unhandled-rejection
    // exit - with its stack - is the loudest available answer. Swallowing it would hide the fault behind a
    // clean exit code.
    makeAdmin(email, console).then(function (code) {
      process.exit(code);
    });
  }

  // Handle connection - may already be open or connecting
  if (mongoose.connection.readyState === 1) {
    start();
  } else {
    mongoose.connection.once('open', start);
  }

  mongoose.connection.on('error', function (err) {
    console.error('MongoDB connection error:', err.message);
    console.error('Make sure MongoDB is running.');
    process.exit(1);
  });
}

module.exports = {
  makeAdmin: makeAdmin,
};

if (require.main === module) {
  runCli(process.argv);
}
