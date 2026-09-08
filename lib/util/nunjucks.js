var config      = require('config'),
    path        = require('path'),
    _           = require('underscore'),
    lodash      = require('lodash'),
    moment      = require('moment'),
    numeral     = require('numeral'),
    nunjucks    = require('nunjucks'),
    env         = nunjucks.configure(config.app.templates, {watch:config.isDev || config.isTest ? true : false, autoescape: true}),
    StringUtils = require('./stringUtils'),
    cachify     = require('./cachify'),
    translate   = require('./translate'),
    roles       = require('./roles'),
    component   = require('./component'),
    constants   = require('../../config/constants');

env.addFilter('cachePrefix', function(src, key) {
  return StringUtils.addPrefix(src, config.app.prefixes, key);
});
env.addFilter('json', function(str, opt) {
  if (opt === 'pretty') {
    return JSON.stringify(str, null, 2);
  } else {
    return JSON.stringify(str);
  }
});
env.addFilter('translate', function(str, locale) {
  return translate(str, locale);
});
env.addFilter('userAvatar', function(str) {
  if (!str) {
    return '/img/avatar-default.svg';
  }
  // Already a full URL
  if (/^http/.test(str)) {
    return str;
  }
  // Already a local path
  if (/^\//.test(str)) {
    return str;
  }
  // Relative path - prepend cloud host if configured
  var cloudHost = config.aws.buckets.useravatars.host || '';
  if (cloudHost.length > 0 && !cloudHost.includes('example.com')) {
    return cloudHost + '/' + str;
  }
  // Default to local img path
  return '/img/' + str;
});
env.addFilter('encrypt', function(obj) {
  return roles.encrypt(obj);
});
function escapeJSON(data) {
  if (typeof data === 'undefined' || data === null) {
    return null;
  }

  if (data instanceof Array) {
    for (var i = 0; i < data.length; i++) {
      data[i] = escapeJSON(data[i]);
    }
  }
  else if (typeof data === 'object') {
    for (var i in data) {
      if (data.hasOwnProperty(i)) {
        data[i] = escapeJSON(data[i]);
      }
    }
  }
  else if (typeof data === 'string') {
    // lodash and underscore can produce different results
    // lodash is used on the client-side so we'll use it here too
    data = lodash.escape(data);
  }

  return data;
}
env.addFilter('escapeJSON', function(obj) {
  var e = escapeJSON(obj);
  return e;
});

// ---------------------------------------------------------------------------
// HTML-safe JSON serialisation
// ---------------------------------------------------------------------------
// The `json` filter above hands Nunjucks a plain string, so autoescaping
// escapes it and an ordinary `{{ x | json }}` is already inert. What this
// filter exists for is the one place autoescaping CANNOT be used: JSON embedded
// in a `<script>` element. The HTML parser does not entity-decode script data,
// so an autoescaped `&quot;` reaches the client's `JSON.parse` verbatim and the
// parse fails. That is why `lib/views/admin/includes/users.html` marked its
// `#rolesData` block `| safe`, and marking it safe is what let a persisted role
// name containing `</script>` close the element and inject markup into an
// administrator's session (QA findings W001-F06-ADMIN-USERS-STORED-XSS and
// W002-I2-ADMIN-JSON-TAB-XSS).
//
// The five characters below are replaced with their `\uXXXX` JSON escapes.
// That transformation is LOSSLESS: `JSON.parse` decodes those escapes back to
// the original code points, so a value serialised here and parsed on the client
// is byte-identical to what was stored. The distinction matters at this sink,
// because `lib/views/admin/index.html` reads `#rolesData`, loads it into the
// Change Roles textarea and POSTs it back to `/api/admin/user/{userId}` --
// escaping the VALUES instead (as the neighbouring `escapeJSON` filter does)
// would persist the escaped form on the next role update.
//
//   `<` and `>`    no `</script`, `<script` or `<!--` can appear in the output,
//                  so no script element or HTML comment can be terminated or
//                  opened by the data
//   `&`            the output is inert in HTML *text* nodes as well, so one
//                  filter is correct both inside and outside a script element
//   U+2028/U+2029  valid inside a JSON string but line terminators in
//                  JavaScript source, so escaping them keeps the output safe if
//                  it is ever inlined as JS rather than parsed as JSON
//
// NOT SAFE INSIDE A QUOTED ATTRIBUTE VALUE. `"` and `'` are deliberately left
// alone, because escaping either would stop the output being JSON. Use this
// filter for element text and `<script>` bodies only.
var HTML_SAFE_JSON_ESCAPES = {
    '<'      : '\\u003c'
  , '>'      : '\\u003e'
  , '&'      : '\\u0026'
  , '\u2028' : '\\u2028'
  , '\u2029' : '\\u2029'
};

env.addFilter('jsonSafe', function(obj, opt) {
  var serialized = opt === 'pretty'
    ? JSON.stringify(obj, null, 2)
    : JSON.stringify(obj);

  // `JSON.stringify` answers `undefined` -- not a string -- for `undefined`, a
  // function or a symbol. The `json` filter above returns that value as-is and
  // Nunjucks renders it as the empty string; returning it unchanged here keeps
  // the two filters interchangeable at those inputs rather than introducing a
  // second behaviour for a template author to discover.
  if (typeof serialized !== 'string') {
    return serialized;
  }

  // Marked safe by the filter rather than by a `| safe` at the call site,
  // because the escaping above is what makes the string safe and the guarantee
  // belongs with the code that produces it. A template that still needed
  // `| safe` here would be textually indistinguishable from the sink this
  // filter replaces, which is exactly the review signal worth keeping.
  return nunjucks.runtime.markSafe(
    serialized.replace(/[<>&\u2028\u2029]/g, function(character) {
      return HTML_SAFE_JSON_ESCAPES[character];
    })
  );
});

module.exports = {
  render: function(template, context) {
    if (config.isDev || config.isTest) {
      env.cache = {};
    }
    return new Promise(function(resolve, reject) {
      nunjucks.render(template, context, function(err, result) {
        if (err) return reject(err);
        resolve(result);
      });
    });
  },
  compile: function(src, info) {
    // Vision passes src (template source string) and info.filename (absolute path)
    // Extract template name relative to templates directory for nunjucks.render()
    // We need to convert absolute path to relative path from templates directory
    var templatesDir = path.resolve(config.app.templates);
    var templateName = info.filename.replace(templatesDir, '');
    // Remove leading slash if present
    if (templateName.charAt(0) === '/' || templateName.charAt(0) === '\\') {
      templateName = templateName.substring(1);
    }

    var subdomain = function(instructor, course) {
      if (config.app.usersubdomains) {
        return '/' + course.slug;
      }
      else {
        return ['', 'u', instructor.slug, 'classes', course.slug].join('/');
      }
    };
    var host = function(instructor) {
      var url = config.app.url.protocol + '://';
      if (config.app.usersubdomains && instructor) {
        url += instructor.slug + '.'
      }
      url += config.app.url.hostname;
      return url;
    };

    return function(context) {
      // kill the nunjucks cache when in dev mode
      if (config.isDev || config.isTest) {
        env.cache = {};
      }

      _.extend(context, {
        config     : config,
        moment     : moment,
        numeral    : numeral,
        subdomain  : subdomain,
        host       : host,
        cachify_js : cachify.js,
        translate  : translate,
        component  : component,
        constants  : constants
      });

      // Use nunjucks.render with template name (like old Hapi 4.x approach)
      // This allows duplicate block names in conditionals to work
      try {
        return nunjucks.render(templateName, context);
      } catch (err) {
        console.error('Nunjucks render error for template:', templateName);
        console.error('Error:', err.message);
        console.error('Stack:', err.stack);
        throw err;
      }
    };
  },
  env : env
}
