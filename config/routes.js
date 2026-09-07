var Joi               = require('joi'),
    yaml              = require('js-yaml'),
    fs                = require('fs'),
    helpers           = require('../lib/util/helpers'),
    config            = require('config'),
    constants         = require('./constants'),  // Ensure constants is loaded
    // load() parses with js-yaml's safe default schema
    reservedUsernames = yaml.load(fs.readFileSync(__dirname + '/reserved.yaml', 'utf8')),
    routes;

// Make recaptcha optional when not configured
var recaptchaValidation = (config.app.recaptcha && config.app.recaptcha.secretkey)
  ? Joi.string().required()
  : Joi.string().allow('').optional();

routes = [
  {
    route  : 'GET / pages.index',
    html   : 'index.html',
    enable : true
  },
  {
    route : 'GET /signup pages.signup',
    html  : 'signup.html'
  },
  {
    route : 'GET /login pages.login',
    html  : 'login.html',
    config : {
      validate : {
        query : {
          next : Joi.string().optional()
        }
      }
    }
  },
  {
    route  : 'GET /welcome pages.welcome',
    config : { auth: 'session' }
  },
  {
    route  : 'GET /home pages.home',
    html   : 'home.html',
    config : { auth: 'session' }
  },
  {
    route   : 'POST /login users.login',
    cookie  : true,
    success : {
      redirect : '/home'
    },
    fail    : {
      redirect : '/login'
    },
    config  : {
      pre : [{ method : helpers.lowerUserFields }],
      validate : {
        payload : {
          email    : Joi.string().required(),
          password : Joi.string()
        }
      }
    }
  },
  {
    route    : 'GET /logout users.logout',
    cookie  : true,
    redirect : '/'
  },
  {
    route : 'POST /users users.create',
    cookie  : true,
    success : {
      redirect : '/welcome'
    },
    fail : {
      redirect : '/{formName}'
    },
    config : {
      pre : [{ method: helpers.lowerUserFields }],
      validate  : {
        payload : {
          formName : Joi.string().required(),
          fullname : Joi.string().max(50).optional(),
          username : Joi.string().min(3).max(20).regex(/^[a-z][a-z0-9\-\_]*$/i).optional().invalid(...reservedUsernames),
          email    : Joi.string().email().required(),
          password : Joi.string().min(3).regex(/^[\w`~!@#$%^&*+=:;'"<>,.?{}\-\/\(\)\[\]\|\\\s]*$/).required(),
          interest : Joi.string().allow('').optional(),
          next     : Joi.string().allow('').optional(),
          'g-recaptcha-response' : recaptchaValidation
        },
        language : {
          username : {
            "regular expression" : "Usernames must begin with a letter and must only contain alphanumeric characters and hyphens (-)."
          }
        }
      }
    }
  },
  {
    route : 'GET /account-deleted users.deleted'
  },
  {
    route : 'PUT /api/users/{userId} users.updateProfile',
    config : {
      auth: 'session',
      validate : {
        payload : {
          name     : Joi.string().min(1).max(140),
          avatar   : Joi.string().allow('').optional(),
          username : Joi.string().min(3).max(20).regex(/^[a-z][a-z0-9\-\_]*$/i).required().invalid(...reservedUsernames)
        },
        language : {
          username : {
            "regular expression" : "Usernames must begin with a letter and must only contain alphanumeric characters and hyphens (-)."
          }
        }
      }
    }
  },
  {
    route  : 'GET /courses/new courses.creationForm',
    html   : 'courses/create.html',
    config : {
      auth: 'session',
      pre : [helpers.coursesEnabled]
    }
  },
  {
    route : 'POST /courses courses.create',
    html  : {
      redirect : '/{user.username}/courses/{course.slug}'
    },
    fail  : {
      redirect : '/courses/new'
    },
    config : {
      auth: 'session',
      pre : [helpers.coursesEnabled],
      validate: {
        payload : {
          name: Joi.string().min(1).max(140).required(),
          description: Joi.string().max(500),
          courseType: Joi.string().valid('public', 'private', 'open').optional(),
          contentDefault: Joi.string().valid('publish', 'draft').optional()
        }
      }
    }
  },
  {
    route: 'POST /{userSlug}/courses/{courseSlug}/copy courses.copy',
    success: {
      redirect: '{classPageUrl}'
    },
    fail : {
      redirect : '/welcome'
    },
    config : {
      auth: 'session',
      pre:  [helpers.coursesEnabled, 'user(params.userSlug)', {method:helpers.courseBySlug, assign:'course'}]
    }
  },
  {
    route  : 'GET /{userSlug}/courses/{courseSlug}/download.zip courses.download',
    config : {
      auth: 'session',
      pre  : [helpers.coursesEnabled, 'user(params.userSlug)', {method:helpers.courseBySlug, assign:'course'}],
      validate : {
        query : {
          format : Joi.string().valid('md', 'html').required()
        }
      }
    }
  },
  {
    route  : 'GET /{userSlug}/courses/{courseSlug} courses.coursePage',
    html   : 'courses/view.html',
    config : {
      pre  : [helpers.coursesEnabled, 'user(params.userSlug)', {method:helpers.courseBySlug, assign:'course'}]
    }
  },
  {
    route : 'GET /api/classes/{userSlug}/{courseSlug} classes.getClass',
    config: {
      pre : [helpers.coursesEnabled, 'user(params.userSlug)', {method:helpers.courseBySlug, assign:'course'}]
    }
  },
  {
    route : 'GET /courses/accept/{token} classes.acceptInvitation',
    html  : 'classes/view.html',
    config : {
      pre : [helpers.coursesEnabled]
    }
  },
  {
    route : 'GET /courses/join/{accessCode} classes.joinFromLink',
    html : 'classes/view.html',
    config : {
      pre : [helpers.coursesEnabled]
    }
  },
  {
    route  : 'GET /api/files/{fileId}/{fileName} files.download',
    config : {
      pre : ['file(params.fileId)']
    }
  },
  {
    route  : 'GET /admin admin.index',
    html   : 'admin/index.html',
    fail   : {
      html : 'login.html'
    },
    config : {
      auth: 'session',
      pre  : [
        'isAdmin(user)'
      ]
    }
  },
  {
    route : 'GET /admin/{adminPage*} admin.index',
    html  : 'admin/index.html',
    fail  : {
      html : 'login.html'
    },
    config : {
      auth: 'session',
      pre  : [
        'isAdmin(user)'
      ]
    }
  },
  {
    route : 'POST /admin/upload admin.uploadUsers',
    html : 'admin/index.html',
    config : {
      auth: 'session',
      pre : ['isAdmin(user)']
    }
  },
  {
    route : 'GET /account users.account',
    html  : 'users/account.html',
    config : {
      auth: 'session'
    }
  },
  {
    route : 'GET /account/{accountPage} users.account',
    html  : 'users/account.html',
    config : {
      auth: 'session'
    }
  },
  {
    route : 'GET /forgot-pass pages.forgotPasswordForm',
    html  : 'users/forgotpass.html'
  },
  {
    route : 'POST /send-pass-reset users.sendPassReset',
    html  : 'users/sendpassreset.html',
    fail  : {
      redirect : '/forgot-pass'
    },
    config : {
      pre : [{ method : helpers.lowerUserFields }],
      validate : {
        payload : {
          email : Joi.string().email().required(),
          'g-recaptcha-response' : recaptchaValidation
        }
      }
    }
  },
  {
    route : 'GET /reset-pass users.resetPasswordForm',
    html  : 'users/resetpass.html',
    fail  : {
      redirect : '/forgot-pass'
    },
    config : {
      validate : {
        query : {
          key : Joi.string().required()
        }
      }
    }
  },
  {
    route : 'POST /save-pass users.savePassword',
    html  : 'users/savepass.html',
    fail  : {
      redirect : '/forgot-pass'
    },
    config : {
      validate : {
        payload : {
          key             : Joi.string().required(),
          password        : Joi.string().required(),
          password_verify : Joi.string().required()
        }
      }
    }
  },
  {
    route : 'GET /activate-account users.activateAccountForm',
    html  : 'users/activateaccount.html',
    fail  : {
      redirect : '/{redirectTo}'
    },
    config : {
      validate : {
        query : {
          key : Joi.string().allow('').optional() // optional to allow for meaningful redirects
        }
      }
    }
  },
  {
    route : 'POST /activate-account users.activateAccount',
    success : {
      redirect : '/welcome'
    },
    fail  : {
      redirect : '/{redirectTo}'
    },
    config : {
      validate : {
        payload : {
          key      : Joi.string().required(),
          password : Joi.string().required()
        }
      }
    }
  },
  {
    route  : 'POST /file files.upload',
    config : {
      auth: 'session',
      /*
       * `output : 'file'` belongs on `multipart`, not on the payload as a whole.
       *
       * hapi defaults `payload.multipart` to FALSE
       * [node_modules/@hapi/hapi/lib/config.js:144-149], and @hapi/subtext
       * answers 415 Unsupported Media Type to a `multipart/form-data` body
       * whenever it is [node_modules/@hapi/subtext/lib/index.js:92-96] -- from
       * the payload parser, before the handler exists and before this route's
       * own validation runs. Every shipped client posts multipart:
       * public/js/courseEditor/controllers/materialControl.js:157 uploads with
       * `fileFormDataName: 'upload'`, matching the `upload` key validated
       * below. Without this declaration no upload can succeed on this route, so
       * no File document and no stored object is creatable through the
       * application, and test/lib/api/files.js:48,74 cannot pass.
       *
       * Declaring it here rather than at the payload level is what keeps a
       * NON-multipart body out of the temp directory. `output : 'file'` on the
       * payload spools every body class to a temp file and hands the handler
       * `{path, bytes}` -- a shape nothing reads, since the handler consumes
       * `request.payload.upload` -- while the hand-rolled validation in
       * lib/util/routeParser.js echoes the rejected payload straight back
       * through `request.fail(request.payload, ...)`, disclosing an absolute
       * server filesystem path at status 200. On `multipart`, subtext takes the
       * part output from `options.multipart.output` and ignores the top-level
       * `output` for multipart bodies entirely
       * [node_modules/@hapi/subtext/lib/index.js:290], so file parts are still
       * written to disk exactly as before while a JSON or raw body is parsed as
       * data and never spooled.
       *
       * `maxBytes` still applies to both classes; subtext checks it against the
       * content length before any parsing [.../subtext/lib/index.js:41].
       */
      payload : {
        maxBytes  : 1048576 * 10, // 10MB
        multipart : { output : 'file' }
      },
      validate : {
        payload : {
          type   : Joi.string().valid('embed', 'download').optional(),
          upload : Joi.any().required()
        }
      }
    }
  },
  {
    route : 'POST /file/avatar files.uploadAvatar',
    config : {
      auth: 'session',
      // Same declaration, and for the same two reasons as `POST /file` above:
      // without `payload.multipart` the avatar Dropzone at
      // lib/views/users/includes/profile.html:88-94 (paramName 'upload') is
      // answered 415 by the payload parser, and with `output` at the payload
      // level any non-multipart body is spooled to a temp file whose absolute
      // path is then echoed back at status 200.
      payload : {
        maxBytes  : 1048576 * 5, // 5MB
        multipart : { output : 'file' }
      },
      validate : {
        payload : {
          upload : Joi.any().required()
        }
      }
    },
    reply : {
      host : true,
      path : true
    }
  },
  {
    route  : 'GET /u/{username}/classes classes.viewCourses',
    html   : 'classes/courses.html',
    config : {
      pre : [helpers.coursesEnabled, { method : helpers.userByUsername, assign : 'user' }]
    }
  },
  {
    route  : 'GET /u/{username}/classes/{courseSlug} classes.viewClass',
    html   : 'classes/view.html',
    config : {
      pre : [helpers.coursesEnabled, { method : helpers.userByUsername, assign : 'user' }, { method : helpers.courseBySlug, assign : 'course' }]
    }
  },
  // 'embed/beta/{type}.html' names a template directory that does not exist anywhere in
  // this repository, so view resolution fails for every {type}. The bound handler
  // trinket.beta (lib/controllers/trinket.js:343) returns successfully first, so the
  // failure occurs after the handler has returned and therefore reaches no handler-level
  // log: the route answers 500 for every {type}, measured identically at base commit
  // 2f8712a. The declaration is preserved rather than removed or backed by new templates
  // because the HTTP surface is a migration invariant and the route manifest must stay
  // identical to baseline across all 233 registered entries.
  //
  // SECURITY HAZARD, recorded here because this is the line that creates it and because
  // no remedy available at this declaration is authorized. {type} is attacker-controlled
  // and is interpolated into a filesystem template path with no validation. A
  // percent-encoded NUL (GET /embed/beta/foo%00bar, unauthenticated) makes @hapi/vision
  // stat a path containing \x00; Node raises TypeError [ERR_INVALID_ARG_VALUE], vision
  // re-throws it through Bounce.rethrow(err, 'system') at manager.js:339 because a
  // TypeError is a system error, and it escapes the response lifecycle after the handler
  // has already returned, terminating the process. Measured identically at 2f8712a on
  // hapi 20.3.0 against a byte-identical vision 7.0.3, so it is pre-existing and not a
  // migration regression. The ordinary 500 described above leaves the same vision loop
  // by the other branch: an ENOENT is not re-thrown and falls through to
  // Boom.badImplementation('View file not found'). The six {lang} routes below
  // interpolate their param the same way and survive only because their controllers
  // answer 404 before the view is resolved. The fix belongs in the interpolation layer
  // (lib/util/routeParser.js), which covers all seven routes at once; constraining the
  // param here would change either the route manifest or the validation inventory that
  // AAP 0.9.1 and 0.6.2 hold identical to baseline.
  {
    route : 'GET /embed/beta/{type} trinket.beta',
    html  : 'embed/beta/{type}.html',
    config : {
      pre : [{ method: helpers.findFeaturedTrinkets, assign: 'featuredTrinkets' }]
    }
  },
  {
    route : 'GET /embed/{lang}/{trinketId} trinket.embed',
    html  : 'embed/{lang}.html',
    config : {
      pre : [helpers.trinketTypeEnabled, helpers.validLang, helpers.findTrinket]
    }
  },
  {
    route : 'GET /assignment-embed/{lang}/{trinketId} trinket.assignment', // regular "student" view, auto save
    html : 'embed/{lang}.html',
    config : {
      auth: 'session',
      // SEAM-F171. `findAssignmentTrinket` performs the same single lookup
      // `findTrinket` does and then authorizes it: the trinket's principal
      // (`_owner` or `_creator`, which is how a submission is keyed) or a user
      // holding `view-assignment-submissions` on the trinket's course, and
      // `Boom.forbidden()` for anyone else. `auth: 'session'` is unchanged, so
      // an anonymous request is still answered 401 and redirected to `/login`.
      pre : [helpers.trinketTypeEnabled, helpers.validLang, helpers.findAssignmentTrinket]
    }
  },
  {
    route : 'GET /assignment-embed-feedback/{lang}/{trinketId} trinket.assignmentFeedback', // "teacher" feedback view, draft
    html : 'embed/{lang}.html',
    config : {
      auth: 'session',
      // SEAM-F171. The grading surface, so `findAssignmentFeedbackTrinket`
      // requires `send-submission-feedback` on the trinket's course - the same
      // permission the write side of this flow requires - or that the caller be
      // the trinket's principal, which is what a feedback revision created by
      // `course.sendFeedback` carries instead of a course id.
      pre : [helpers.trinketTypeEnabled, helpers.validLang, helpers.findAssignmentFeedbackTrinket]
    }
  },
  {
    route : 'GET /assignment-embed-viewonly/{lang}/{trinketId} trinket.viewOnly', // view-only, no auto save or draft
    html : 'embed/{lang}.html',
    config : {
      pre : [helpers.trinketTypeEnabled, helpers.validLang, helpers.findTrinket]
    }
  },
  {
    route : 'GET /embed/blocks-iframe trinket.index',
    html  : 'embed/blocks-iframe.html'
  },
  {
    route : 'GET /embed/glowscript-blocks-iframe trinket.index',
    html  : 'embed/glowscript-blocks-iframe.html'
  },
  {
    route : 'GET /embed/{lang} trinket.embed',
    html: 'embed/{lang}.html',
    config : {
      pre : [helpers.trinketTypeEnabled, helpers.validLang, { method: helpers.getDefaultTrinket, assign: 'trinket' }]
    }
  },
  {
    route : 'GET /tools/{version}/jekyll/embed/{lang} trinket.embed',
    html: 'embed/{lang}.html',
    config : {
      pre : [helpers.trinketTypeEnabled, helpers.validLang]
    }
  },
  {
    route : 'GET /skulpt trinket.index',
    success: {
      redirect: '/python'
    }
  },
  {
    route : 'GET /skulpt/{hash} trinket.index',
    success : {
      redirect: '/python/{hash}'
    }
  },
  {
    route : 'POST /python trinket.create',
    config : {
      validate : {
        payload : {
          code : Joi.string().required(),
        }
      }
    }
  },
  {
    route : 'GET /vpython trinket.index',
    success : {
      redirect : '/glowscript'
    }
  },
  {
    route : 'GET /vpython/{shortCode} trinket.index',
    success : {
      redirect : '/glowscript/{shortCode}'
    }
  },
  {
    route : 'GET /webvpython trinket.index',
    success : {
      redirect : '/glowscript'
    }
  },
  {
    route : 'GET /webvpython/{shortCode} trinket.index',
    success : {
      redirect : '/glowscript/{shortCode}'
    }
  },
  {
    route : 'GET /r trinket.index',
    success : {
      redirect : '/R'
    }
  },
  {
    route : 'GET /r/{shortCode} trinket.index',
    success : {
      redirect : '/R/{shortCode}'
    }
  },
  {
    route : 'GET /library/trinkets/{path*} trinket.library',
    config : {
      pre : [helpers.trinketTypeEnabled],
      validate : {
        query : {
          lang : Joi.string().optional(),
          user : Joi.string().optional(),
          go   : Joi.string().optional(),
          _3d  : Joi.string().optional()
        }
      }
    },
    html  : 'trinket/library.html'
  },
  {
    route : 'GET /library/folder/{slug} folders.listView',
    config : {
      auth: 'session'
    },
    html : 'trinket/library.html'
  },
  {
    route : 'GET /docs/colors pages.index',
    html  : 'docs/colors.html'
  },
  {
    // KNOWN UX DEFECT, DELIBERATELY NOT REPAIRED HERE. Because this
    // declaration carries no `html`, `success` or `fail` key, an unconfigured
    // deployment answers this route with a bare `h.response(json)` -- HTTP 200
    // whose body is the raw JSON `{"message":"Google OAuth is not configured.
    // Please set up Google OAuth credentials.","flash":{}}` with no page
    // chrome and no way back except the browser's Back button. That is what
    // `request.fail` does when neither a fail redirect nor a fail template is
    // declared [lib/util/routeParser.js:310-318].
    //
    // No `html`, `success` or `fail` key may be added to close it.
    // test/parity/manifest.js records `success: successSpec(declaration)` and
    // `fail: failSpec(declaration)` verbatim into the route manifest, where
    // this entry reads `"success": {}, "fail": {}`, and AAP 0.9.1 makes
    // entry-by-entry equality of the baseline and target manifests the primary
    // parity gate. Adding a key changes this entry and fails that gate.
    //
    // Closing it therefore needs a numbered entry in the approved-deviation
    // register, docs/preserved-quirks.md section 11 -- which declares itself
    // closed at exactly two deviations and is owned outside this file -- taken
    // together with a recapture of the corpus scenario that drives this route.
    route : 'GET /auth/google auth.google',
    config : {
      auth : false
    }
  },
  {
    route : 'GET /auth/google/callback auth.googleCallback',
    cookie  : true,
    success: {
      redirect:  '{redirectTo}'
    },
    fail: {
      redirect: '/signup'
    },
    config : {
      auth : false
    }
  },
];

// trinket language specific routes
config.constants.trinketLangs.forEach(function(lang) {
  // language landing page
  routes.push({
      route  : 'GET /' + lang + ' trinket.index'
    , html   : 'trinket/' + lang + '/' + lang + '.html'
    , config : {
        pre  : [
            helpers.trinketTypeEnabled
          , {
                method : helpers.findFeaturedTrinkets
              , assign : 'featuredTrinkets'
            }
        ]
    }
  });

  // trailing slash landing page
  routes.push({
      route   : 'GET /' + lang + '/ pages.index'
    , success : {
        redirect : '/' + lang
      }
    , config  : {
        pre : [helpers.trinketTypeEnabled, helpers.validLang]
      }
  });

  // specific trinket landing page
  routes.push({
      route  : 'GET /' + lang + '/{shortCode} trinket.getByShortCode'
    , html   : 'trinket/' + lang + '/' + lang + '.html'
    , config : {
        pre  : [
            helpers.trinketTypeEnabled
          , helpers.findTrinket
          , {
                method : helpers.findFeaturedTrinkets
              , assign : 'featuredTrinkets'
            }
        ]
      }
  });

  // download the "main" file for a trinket
  routes.push({
      route : 'GET /' + lang + '/{shortCode}/ trinket.downloadMain'
    , config : {
        pre : [helpers.trinketTypeEnabled]
      }
  });

  // download specific file for a trinket
  routes.push({
      route : 'GET /' + lang + '/{shortCode}/{path*} trinket.downloadFile'
    , config : {
        pre : [helpers.trinketTypeEnabled]
      }
  });
});

module.exports = routes;
