// Simplified roles for open-source version
// All users get full access to all trinket types

// role : [ permissions ]

var permissions = {
    // Default role for all users - full access to all trinket types
    'user' : [
        'create-python-trinket'
      , 'create-python3-trinket'
      , 'create-blocks-trinket'
      , 'create-html-trinket'
      , 'create-glowscript-trinket'
      , 'create-glowscript-blocks-trinket'
      , 'create-music-trinket'
      , 'create-java-trinket'
      , 'create-pygame-trinket'
      , 'create-R-trinket'
      , 'create-public-course'
      , 'create-private-course'
      , 'hide-trinket-files'
      , 'enable-trinket-tests'
      , 'add-trinket-inline-comments'
      , 'course-assignments'
    ]
    // Admin role - same as user plus admin capabilities
  , 'admin' : [
        'create-python-trinket'
      , 'create-python3-trinket'
      , 'create-blocks-trinket'
      , 'create-html-trinket'
      , 'create-glowscript-trinket'
      , 'create-glowscript-blocks-trinket'
      , 'create-music-trinket'
      , 'create-java-trinket'
      , 'create-pygame-trinket'
      , 'create-R-trinket'
      , 'create-public-course'
      , 'create-private-course'
      , 'hide-trinket-files'
      , 'enable-trinket-tests'
      , 'add-trinket-inline-comments'
      , 'course-assignments'
    ]
    // Course roles
  , 'course-owner' : [
        'update-course-details'
      , 'manage-course-access'
      , 'change-course-owner'
      , 'manage-course-content'
      , 'view-course-content'
      , 'delete-course'
      , 'manage-course-assignments'
      , 'view-assignment-submissions'
      , 'send-submission-feedback'
    ]
  , 'course-collaborator' : [
        'manage-course-content'
      , 'view-course-content'
    ]
  , 'course-admin' : [
        'update-course-details'
      , 'manage-course-access'
      , 'manage-course-content'
      , 'view-course-content'
      , 'manage-course-assignments'
      , 'view-assignment-submissions'
      , 'send-submission-feedback'
    ]
  , 'course-student' : [
        'view-course-content'
    ]
  , 'course-associate' : [
        'make-course-copy'
      , 'view-course-content'
    ]
    // Folder roles
  , 'folder-owner' : [
        'add-trinket'
      , 'update-folder-details'
    ]
};

// Legacy role aliases for backwards compatibility with existing user data
permissions['trinket-code'] = permissions['user'];
permissions['trinket-connect'] = permissions['user'];
permissions['trinket-connect-trial'] = permissions['user'];
permissions['trinket-codeplus'] = permissions['user'];
permissions['trinket-teacher'] = permissions['user'];

// legacy role : [ roles that satisfy it ]
//
// The membership-side counterpart of the permission aliases above. The alias
// block gives a legacy role name the 'user' permission set, but role
// membership is a separate question: hasRole tests the names actually present
// in a user's roles[].roles array, and the only names ever written there are
// the ones that were explicitly granted ('user' and 'site' on first save).
// A legacy name therefore resolved the full permission set while reporting no
// role at all, which is the half-finished alias this table completes.
//
// Only 'trinket-code' is declared, and the omission of the other four is
// deliberate. In this edition every account gets the full trinket-type
// feature set, so holding 'user' is exactly what the base 'trinket-code' tier
// meant, and no code branches on 'trinket-code'. The other four still gate
// live product behaviour that an ordinary account was never granted:
// 'trinket-connect' and 'trinket-codeplus' select the serverside execution
// API (lib/controllers/trinket.js), and 'trinket-connect' /
// 'trinket-connect-trial' guard the 'trinket-teacher' auto-grant
// (lib/controllers/admin.js). Implying those from 'user' would hand every
// account a tier it never had, so they resolve permissions only.
//
// This is a read-side equivalence: nothing here is written to a user
// document, so no persisted role data changes.
// Declared with a null prototype so a role NAME that collides with a member of
// `Object.prototype` cannot resolve through inheritance. With a plain object
// literal, `legacyRoleEquivalents['toString']` finds the inherited function,
// which is truthy, and the lookup below then calls `.slice()` on a function.
// `hasRole` is a synchronous predicate whose contract is a strict boolean for
// every input, and before this equivalence existed it answered `false` for
// those names; a throw there would be a behaviour change (R-d) on the one code
// path route guards and templates call with a bare string.
var legacyRoleEquivalents = Object.create(null);
legacyRoleEquivalents['trinket-code'] = [ 'user' ];

module.exports = {
    getPermissions : function(role) {
      return Promise.resolve(permissions[role] || []);
    }
    // Returns the roles that satisfy `role` by equivalence, or [] when there
    // is none. Synchronous on purpose: hasRole is a synchronous predicate used
    // in route guards and templates, so it cannot await a promise the way
    // getPermissions' callers do. A copy is returned so a caller iterating the
    // result cannot mutate the declaration above.
  , getEquivalentRoles : function(role) {
      // Own-property and array checks in addition to the null prototype above:
      // the guard then holds even if a caller supplies a non-string `role`
      // (which coerces to a key) or a future edit restores an object literal.
      var equivalents = Object.prototype.hasOwnProperty.call(legacyRoleEquivalents, role)
        ? legacyRoleEquivalents[role]
        : undefined;

      return Array.isArray(equivalents) ? equivalents.slice() : [];
    }
  , getLimits : function(role) {
      // No limits in open-source version
      return Promise.resolve(undefined);
    }
  , getCheck : function(permission) {
      return undefined;
    }
};
