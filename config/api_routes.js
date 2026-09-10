var Joi          = require('joi'),
    helpers      = require('../lib/util/helpers'),
    config       = require('config');

// Make recaptcha optional when not configured
var recaptchaValidation = (config.app.recaptcha && config.app.recaptcha.secretkey)
  ? Joi.string().required()
  : Joi.string().allow('').optional();

module.exports = [
  {
    // create a new course
    route  : 'POST /api/courses course.createCourse',
    config : {
      auth: 'session',
      validate : {
        payload : {
          name           : Joi.string().max(140).required(),
          description    : Joi.string().max(500),
          courseType     : Joi.string().valid('public', 'private', 'open').optional(),
          contentDefault : Joi.string().valid('publish', 'draft').optional()
        }
      }
    }
  },
  {
    route : 'GET /api/courses courses.getCourses',
    config : {
      auth: 'session'
    }
  },
  {
    // get a course by id
    //
    // SEAM-F167. This route declares no `auth`, so it inherits `mode: 'try'`
    // and an anonymous caller reaches it, and `populate(pre.course,query.with)`
    // is what fetches the owner's user document when the caller asks for
    // `with=_owner`. What that response may disclose is bounded in the
    // PROJECTION, not in the schema below: `tagSafeCourseProjection` in
    // lib/controllers/course.js reduces a populated `_owner` to `{name,
    // username}` unconditionally. The `with` schema is deliberately left as it
    // is, because three client call sites legitimately send `with=['_owner']`
    // (public/js/classPage/app.js:57,
    // public/js/courseEditor/controllers/root.js:147 and
    // public/js/courseEditor/controllers/materialControl.js:91) and refusing
    // the parameter here would break all three.
    route : 'GET /api/courses/{courseId} course.getCourse',
    config : {
      pre  : ['course(params.courseId)', 'populate(pre.course,query.with)'],
      validate: {
        query : {
          with                 : Joi.alternatives().try(Joi.string().allow('_owner'), Joi.array().items(Joi.string().allow('_owner'))).optional(),
          outline              : Joi.boolean().optional(),
          withDraft            : Joi.boolean().optional(),
          withContent          : Joi.boolean().optional(),
          withDraftAssignments : Joi.boolean().optional()
        }
      }
    }
  },
  {
    // update the course meta data
    route  : 'PUT /api/courses/{courseId}/metadata course.updateCourse',
    config : {
      auth: 'session',
      pre  : ['course(params.courseId)'],
      validate : {
        payload : {
          name           : Joi.string().max(140),
          description    : Joi.string().max(500),
          courseType     : Joi.string().valid('public', 'private', 'open').optional(),
          contentDefault : Joi.string().valid('publish', 'draft').optional()
        }
      }
    }
  },
  {
    // delete a course (and all lessons and materials)
    route  : 'DELETE /api/courses/{courseId} course.deleteCourse',
    config : {
      auth: 'session',
      pre  : ['course(params.courseId)']
    }
  },
  {
    route : 'POST /api/courses/{courseId}/copy course.copyCourse',
    config : {
      auth: 'session',
      pre  : ['course(params.courseId)'],
      validate : {
        payload : {
          name : Joi.string().required()
        }
      }
    }
  },
  {
    route : 'PATCH /api/courses/{courseId} course.archiveCourse',
    config : {
      auth: 'session',
      pre : ['course(params.courseId)'],
      validate : {
        payload : {
          archived : Joi.boolean().required()
        }
      }
    }
  },
  {
    // create a new lesson and add it to the course lessons list
    route : 'POST /api/courses/{courseId}/lessons course.addLesson',
    config : {
      auth: 'session',
      pre: ['course(params.courseId)'],
      validate : {
        query : {
          index : Joi.number().optional()
        },
        payload : {
          name : Joi.string().max(140).required()
        }
      }
    }
  },
  {
    // get a lesson from a course lessons list
    route : 'GET /api/courses/{courseId}/lessons/{lessonId} course.getLesson',
    config : {
      pre  : [
        'course(params.courseId)',
        'hasLesson(pre.course,params.lessonId)',
        'lesson(params.lessonId)'
      ]
    }
  },
  {
    // move a lesson in the course lessons list
    route : 'PUT /api/courses/{courseId}/lessons/{lessonId}/move course.moveLesson',
    config : {
      auth: 'session',
      pre: [
        'course(params.courseId)',
        'hasLesson(pre.course,params.lessonId)'
      ],
      validate: {
        payload : {
          index  : Joi.number().required()
        }
      }
    }
  },
  {
    // update a lesson in a course lessons list
    route : 'PUT /api/courses/{courseId}/lessons/{lessonId}/name course.updateLesson',
    config : {
      auth: 'session',
      pre: [
        'course(params.courseId)',
        'hasLesson(pre.course,params.lessonId)',
        'lesson(params.lessonId)'
      ],
      validate : {
        payload : {
          name : Joi.string().max(140)
        }
      }
    }
  },
  {
    route : 'PUT /api/courses/{courseId}/lessons/{lessonId}/draft course.updateLesson',
    config : {
      auth: 'session',
      pre: [
        'course(params.courseId)',
        'hasLesson(pre.course,params.lessonId)',
        'lesson(params.lessonId)'
      ],
      validate : {
        payload : {
          isDraft : Joi.boolean()
        }
      }
    }
  },
  {
    // delete a lesson (and its materials) and remove it from a course lessons list
    route : 'DELETE /api/courses/{courseId}/lessons/{lessonId} course.deleteLesson',
    config : {
      auth: 'session',
      pre: [
        'course(params.courseId)',
        'hasLesson(pre.course,params.lessonId)',
        'lesson(params.lessonId)'
      ]
    }
  },
  {
    // create a new material and add it to the course.lesson.materials list
    route : 'POST /api/courses/{courseId}/lessons/{lessonId}/materials course.addMaterial',
    config : {
      auth: 'session',
      pre: [
        'course(params.courseId)',
        'hasLesson(pre.course,params.lessonId)',
        'lesson(params.lessonId)'
      ],
      validate : {
        query : {
          index : Joi.number().optional()
        },
        payload : {
          name             : Joi.string().max(140).required(),
          type             : Joi.string().required(),
          content          : Joi.string().optional(),
          lang             : Joi.string().optional(),
          trinketId        : Joi.string().optional(),

          submissionsDue           : Joi.string().optional(),
          submissionsCutoff        : Joi.string().optional(),
          availableOn              : Joi.string().optional(),
          hideAfter                : Joi.string().optional(),

          submissionsDueEnabled    : Joi.boolean(),
          submissionsCutoffEnabled : Joi.boolean(),
          availableOnEnabled       : Joi.boolean(),
          hideAfterEnabled         : Joi.boolean()
        }
      }
    }
  },
  {
    // get a material from a course.lesson.materials list
    route : 'GET /api/courses/{courseId}/lessons/{lessonId}/materials/{materialId} course.getMaterial',
    config : {
      pre: [
        'course(params.courseId)',
        'hasLesson(pre.course,params.lessonId)',
        'lesson(params.lessonId)',
        'hasMaterial(pre.lesson,params.materialId)',
        'material(params.materialId)'
      ]
    }
  },
  {
    // move a material in a course.lesson.materials list and optionally transfer to another lesson
    route : 'PUT /api/courses/{courseId}/lessons/{lessonId}/materials/{materialId}/move course.moveMaterial',
    config : {
      auth: 'session',
      pre: [
        'course(params.courseId)',
        'hasLesson(pre.course,params.lessonId)',
        'lesson(params.lessonId)',
        'hasMaterial(pre.lesson,params.materialId)',
        'parent(payload.parent,pre.lesson)'
      ],
      validate : {
        payload : {
          index  : Joi.number().required(),
          parent : Joi.string().regex(/[0-9a-f]/).length(24).optional()
        }
      }
    }
  },
  {
    route : 'PUT /api/courses/{courseId}/lessons/{lessonId}/materials/{materialId}/name course.updateMaterial',
    config : {
      auth: 'session',
      pre: [
        'course(params.courseId)',
        'hasLesson(pre.course,params.lessonId)',
        'lesson(params.lessonId)',
        'hasMaterial(pre.lesson,params.materialId)',
        'material(params.materialId)'
      ],
      validate : {
        payload : {
          name : Joi.string().max(140)
        }
      }
    }
  },
  {
    route : 'PUT /api/courses/{courseId}/lessons/{lessonId}/materials/{materialId}/draft course.updateMaterial',
    config : {
      auth: 'session',
      pre: [
        'course(params.courseId)',
        'hasLesson(pre.course,params.lessonId)',
        'lesson(params.lessonId)',
        'hasMaterial(pre.lesson,params.materialId)',
        'material(params.materialId)'
      ],
      validate : {
        payload : {
          isDraft : Joi.boolean()
        }
      }
    }
  },
  {
    route : 'PUT /api/courses/{courseId}/lessons/{lessonId}/materials/{materialId}/assignment course.updateMaterial',
    config : {
      auth: 'session',
      pre: [
        'course(params.courseId)',
        'hasLesson(pre.course,params.lessonId)',
        'lesson(params.lessonId)',
        'hasMaterial(pre.lesson,params.materialId)',
        'material(params.materialId)'
      ],
      validate : {
        payload : {
          name             : Joi.string().max(140),
          content          : Joi.string(),
          lang             : Joi.string(),
          trinketId        : Joi.string(),

          submissionsDue           : Joi.string().optional(),
          submissionsCutoff        : Joi.string().optional(),
          availableOn              : Joi.string().optional(),
          hideAfter                : Joi.string().optional(),

          submissionsDueEnabled    : Joi.boolean(),
          submissionsCutoffEnabled : Joi.boolean(),
          availableOnEnabled       : Joi.boolean(),
          hideAfterEnabled         : Joi.boolean()
        }
      }
    }
  },
  {
    route : 'PUT /api/courses/{courseId}/lessons/{lessonId}/materials/{materialId}/patchContent course.updateMaterial',
    config : {
      auth: 'session',
      pre: [
        'course(params.courseId)',
        'hasLesson(pre.course,params.lessonId)',
        'lesson(params.lessonId)',
        'hasMaterial(pre.lesson,params.materialId)',
        'material(params.materialId)'
      ],
      validate : {
        payload : {
          patch : Joi.string()
        }
      }
    }
  },
  {
    // delete a material and remove it from a course.lesson.materials list
    route : 'DELETE /api/courses/{courseId}/lessons/{lessonId}/materials/{materialId} course.deleteMaterial',
    config : {
      auth: 'session',
      pre: [
        'course(params.courseId)',
        'hasLesson(pre.course,params.lessonId)',
        'lesson(params.lessonId)',
        'hasMaterial(pre.lesson,params.materialId)',
        'material(params.materialId)'
      ]
    }
  },
  {
    route : 'GET /api/courses/{courseId}/users course.listUsers',
    config : {
      auth: 'session',
      pre : ['course(params.courseId)']
    }
  },
  {
    route : 'GET /api/courses/{courseId}/invitations course.listInvitations',
    config : {
      auth: 'session',
      pre : ['course(params.courseId)']
    }
  },
  {
    route : 'DELETE /api/courses/{courseId}/invitations/{invitationId} course.removeInvitation',
    config : {
      auth: 'session',
      pre : ['course(params.courseId)']
    }
  },
  {
    route : 'PUT /api/courses/{courseId}/invitations/{invitationId}/resend course.updateInvitation',
    config : {
      auth: 'session',
      pre : ['course(params.courseId)', 'invitation(params.invitationId)'],
      validate : {
        payload : {
          status : Joi.string()
        }
      }
    }
  },
  {
    route : 'PUT /api/courses/{courseId}/invitations/{invitationId}/email course.updateInvitation',
    config : {
      auth: 'session',
      pre : ['course(params.courseId)', 'invitation(params.invitationId)'],
      validate : {
        payload : {
          email  : Joi.string().optional()
        }
      }
    }
  },
  {
    route : 'POST /api/courses/{courseId}/userLookup course.userLookup',
    config : {
      auth: 'session',
      pre : ['course(params.courseId)'],
      validate : {
        payload : {
          user : Joi.string().required()
        }
      }
    }
  },
  {
    route : 'DELETE /api/courses/{courseId}/users/{userId} course.removeUser',
    config : {
      auth: 'session',
      pre : ['course(params.courseId)']
    }
  },
  {
    route : 'POST /api/courses/{courseId}/users course.addUser',
    config : {
      auth: 'session',
      pre : ['course(params.courseId)'],
      validate : {
        payload : {
          user : Joi.string().required()
        }
      }
    }
  },
  {
    route : 'POST /api/courses/{courseId}/roles course.updateRoles',
    config : {
      auth: 'session',
      pre : ['course(params.courseId)'],
      validate : {
        payload : {
          user : Joi.string().required(),
          role : Joi.string().required()
        }
      }
    }
  },
  {
    route : 'POST /api/courses/{courseId}/views course.updateViews',
    config : {
      auth: 'session',
      pre : ['course(params.courseId)'],
      validate : {
        payload : {
          user : Joi.string().required(),
          view : Joi.string().required(),
          action : Joi.string().required() // hide or show
        }
      }
    }
  },
  {
    route : 'POST /api/courses/{courseId}/invitations course.sendInvitations',
    config : {
      auth: 'session',
      pre  : ['course(params.courseId)'],
      validate : {
        payload : {
          emailList : Joi.array().required()
        }
      }
    }
  },
  {
    route : 'GET /api/courses/{courseId}/accessCode course.getAccessCode',
    config : {
      auth: 'session',
      pre : ['course(params.courseId)']
    }
  },
  {
    route : 'POST /api/courses/{courseId}/accessCode course.generateAccessCode',
    config : {
      auth: 'session',
      pre : ['course(params.courseId)']
    }
  },
  {
    route : 'POST /api/courses/join course.join',
    config : {
      auth: 'session',
      validate : {
        payload : {
          accessCode: Joi.string().min(6).required()
        }
      }
    }
  },
  {
    route : 'POST /api/courses/{courseId}/lessons/{lessonId}/materials/{materialId}/startAssignment course.startAssignment',
    config : {
      auth: 'session',
      validate : {
        payload : {
          parent : Joi.string().required()
        }
      }
    }
  },
  {
    route : 'POST /api/courses/{courseId}/lessons/{lessonId}/materials/{materialId}/submissions course.submitAssignment',
    config : {
      auth: 'session',
      validate : {
        payload : {
          code : Joi.object().required(),
          comments : Joi.string().allow('').required(),
          parent : Joi.string().required()
        }
      }
    }
  },
  {
    route : 'POST /api/comments/{trinketId} course.autosaveComments',
    config : {
      auth: 'session',
      pre : ['trinket(params.trinketId)'],
      validate : {
        payload : {
          comments : Joi.string().allow('').required()
        }
      }
    }
  },
  {
    route : 'POST /api/feedback-comments/{trinketId} course.autosaveFeedbackComments',
    config : {
      auth: 'session',
      pre : ['trinket(params.trinketId)'],
      validate : {
        payload : {
          comments : Joi.string().allow('').required()
        }
      }
    }
  },
  {
    route : 'POST /api/submission-opt/{trinketId} course.autosaveSubmissionOpt',
    config : {
      auth: 'session',
      pre : ['trinket(params.trinketId)'],
      validate : {
        payload : {
          allowResubmit : Joi.boolean().optional(),
          includeRevision : Joi.boolean().optional()
        }
      }
    }
  },
  {
    route : 'GET /api/courses/{courseId}/lessons/{lessonId}/materials/{materialId}/submissions course.getMaterialSubmissionsForAllUsers',
    config : {
      auth: 'session',
      pre : ['course(params.courseId)']
    }
  },
  {
    route : 'GET /api/submissions/{materialId} course.getUserSubmissionsForMaterial',
    config : {
      auth: 'session'
    }
  },
  {
    route : 'GET /api/courses/{courseId}/users/{userId}/materials/{materialId}/submissions course.getUserSubmissionsForMaterial',
    config : {
      auth: 'session'
    }
  },
  {
    route : 'GET /api/featured-courses courses.featuredCourses',
    config : {
      auth: 'session'
    }
  },
  {
    route : 'POST /api/submissions/{trinketId} course.updateMySubmission',
    config : {
      auth: 'session',
      pre : ['trinket(params.trinketId)'],
      validate : {
        payload : {
          code : Joi.object().required(),
          comments : Joi.string().allow('').required()
        }
      }
    }
  },
  {
    route : 'GET /api/courses/{courseId}/dashboard course.dashboardOverview',
    config : {
      auth: 'session',
      pre : ['course(params.courseId)'],
      validate : {
        query : {
          listBy : Joi.string().optional()
        }
      }
    }
  },
  {
    route : 'POST /api/courses/{courseId}/lessons/{lessonId}/materials/{materialId}/feedback course.sendFeedback',
    config : {
      auth: 'session',
      pre : ['course(params.courseId)'],
      validate : {
        payload : {
          code            : Joi.object().required(),
          trinketId       : Joi.string().required(),
          comments        : Joi.string().allow('').optional(),
          includeRevision : Joi.boolean(),
          allowResubmit   : Joi.boolean()
        }
      }
    }
  },
  {
    route : 'POST /api/courses/{courseId}/lessons/{lessonId}/materials/{materialId}/acceptSubmission course.acceptSubmission',
    config : {
      auth: 'session',
      pre : ['course(params.courseId)', 'trinket(payload.trinketId)'],
      validate : {
        payload : {
          trinketId : Joi.string().required()
        }
      }
    }
  },
  {
    route : 'GET /api/courses/{courseId}/lessons/{lessonId}/materials/{materialId}/dashboard course.materialDashboard',
    config : {
      auth: 'session',
      pre : ['course(params.courseId)']
    }
  },
  {
    route : 'GET /api/courses/{courseId}/users/{userId}/submissions course.getUserSubmissionsForCourse',
    config : {
      auth: 'session',
      pre : ['course(params.courseId)', 'user(params.userId)']
    }
  },
  {
    route : 'GET /api/folders folders.list',
    config : {
      auth: 'session',
      validate : {
        query : {
          user : Joi.string().optional()
        }
      }
    }
  },
  {
    route : 'GET /api/folders/{folderId}/trinkets folders.trinkets',
    config : {
      auth: 'session',
      pre : ['folder(params.folderId)']
    },
    reply : {
      data : [{
        id          : 1,
        metrics     : 1,
        shortCode   : 1,
        lang        : 1,
        lastUpdated : 1,
        lastView    : 1,
        name        : 1,
        description : 1,
        snapshot    : 1,
        assets      : 1,
        settings    : 1,
        folder      : 1,
        _owner      : 1,
        published   : 1
      }]
    }
  },
  {
    // PRESERVED VALIDATION QUIRK, two of them, both on the folder-name round
    // trip and both measured A/B against baseline 2f8712a rather than inferred:
    // the target's responses below are the baseline's, byte for byte once
    // generated ids are set aside. They are QA findings F48 (whitespace-only
    // names accepted, LOW) and F15 (the rejection reason never reaches the
    // user, MEDIUM), and because each is 2013 behaviour this migration did not
    // touch, AAP rule R-d keeps them working and this comment is the record AAP
    // 0.2.2 asks for in place of a fix.
    //
    // 1. A WHITESPACE-ONLY NAME IS ACCEPTED WHERE THE EMPTY STRING IS REJECTED.
    // `min(1)` measures raw length and the schema carries no `.trim()`, so `''`
    // is refused with `"name" is not allowed to be empty`, while `'    '`,
    // `'\t\n'`, a single space and U+00A0 all pass, reach folders.create and are
    // persisted verbatim -- a folder whose name renders as nothing (its `<h3>`
    // innerText is the empty string, measured in the browser) under a random
    // 8-character slug, because the name transliterates to nothing for the
    // slug. Measured on both trees: 200 with
    // `{"success":true,"folder":{"name":"    ","slug":"<8 random>",...}}`.
    //   `Joi.string().trim().min(1)` is not available here, for three
    // independently sufficient reasons. AAP 0.2.1 confines this file's
    // authorized change to the inline pre-handler on the login declaration --
    // "its 116 declarations untouched". AAP 0.6.2's gate compares the accept and
    // reject outcome of all 102 validation targets against
    // test/parity/joi-baseline.json, whose `POST /api/folders payload` entry was
    // captured from the baseline tree and records this target's coercion case as
    // `applicable:false` on the ground that the section declares no boolean and
    // no number leaf; `.trim()` is a convert-time coercion, so it would flip
    // that field as well as the whitespace outcome, and the artifact's
    // re-capture is not this unit's to make. And the application's own UI cannot
    // send the input at all: AngularJS trims text inputs by default, so the
    // create modal posts `{}` for a whitespace-only entry and is answered
    // `"name" is required` (measured). The quirk is reachable only by a
    // non-browser client, which is how QA reproduced it.
    //
    // 2. THE REJECTION REASON NEVER REACHES THE USER. A name over 140
    // characters is refused by the hand-rolled validation block
    // (lib/util/routeParser.js:867-884), which flashes the messages and calls
    // request.fail, so the answer is HTTP **200** carrying the echoed payload
    // plus `{"flash":{"validation":{"name":"\"name\" length must be less than or
    // equal to 140 characters long"}}}` -- and no `success` key and no `message`
    // key. The client
    // (public/js/library/components/folders/new-folder-directive.js:19-47)
    // branches `response.success`, then `response.message`, then a hardcoded
    // "We had a problem creating your new folder. Please try again."; it never
    // reads `flash.validation`, so the 140-character reason is dropped. Measured
    // in the browser at 141 characters: a red NotifyJS alert carrying that
    // generic string, appearing ~18ms after the click, rendered at +500ms,
    // beginning to hide at ~+5.0s and gone by ~+5.2s, with the modal still open,
    // no folder created and no console error. That ~5.2s lifetime is why a
    // sample taken at +0ms and again at +6s sees no message at all, and it is
    // the same figure QA measured for the over-length toast. Two further
    // measured edges of the same discard: where the surrounding scope defines no
    // `folderMessage` the directive's `messageFunc` is a no-op and nothing at
    // all is shown, and a non-2xx answer lands in the client's error callback
    // where `err.message` is undefined, so even the delivered duplicate-name 409
    // is replaced by the same generic string.
    //   Consuming `flash.validation` client-side would mean editing
    // public/js/**, which AAP 0.2.2 states is not modified, against files this
    // build leaves byte-identical to 2f8712a (verified by git object hash), and
    // it would change client-visible page behaviour, which the request's
    // PRESERVE directive protects and AAP 0.9.3's corpus compares as rendered
    // text. The catalogue entry for both quirks belongs in
    // docs/preserved-quirks.md.
    route : 'POST /api/folders folders.create',
    config : {
      auth: 'session',
      validate : {
        payload : {
          name: Joi.string().min(1).max(140).required(),
        }
      }
    }
  },
  {
    // The rename half of the same round trip, and the second of the three
    // baseline limits on a folder name: none on the create modal's input, 50
    // here, 140 on the create schema above. Untrimmed for the same reason and
    // with the same consequence -- `{"name":"   "}` is accepted and renames the
    // folder to whitespace, measured 200 with `success:true` on both trees.
    //   Its over-length path is UI-unreachable rather than silent: the inline
    // editor on the folder page declares `e-maxlength="50"`, which renders a
    // native `maxlength="50"`, so a 51st character is refused in the field and
    // no request is issued (measured -- the browser sent no PUT). Were it
    // reachable, the rejection would show nothing at all, because the rename
    // handler (public/js/library/trinkets/list/folder-list-controller.js:183-210)
    // branches `if (result.success)` at :189 and `else if (result.message)` at
    // :198 with no final else, leaving a `$q` deferred that never settles.
    // Preserved under R-d for
    // the reasons recorded on the declaration above.
    route : 'PUT /api/folders/{folderId}/name folders.update',
    config : {
      auth: 'session',
      pre : [
        'folder(params.folderId)',
        'canEdit(pre.folder,user)'
      ],
      validate : {
        payload : {
          name : Joi.string().min(1).max(50)
        }
      }
    }
  },
  {
    // delete a folder
    route  : 'DELETE /api/folders/{folderId} folders.deleteFolder',
    config : {
      auth: 'session',
      pre  : ['folder(params.folderId)']
    }
  },
  {
    route : 'GET /api/trinkets/popular trinket.mostActive',
    config : {
      validate : {
        query : {
          lang  : Joi.string().required(),
          limit : Joi.number().optional().max(100).min(0)
        }
      },
      pre : [
        helpers.validLang,
        'isAdmin(user)'
      ]
    }
  },
  {
    route : 'GET /api/trinkets/active trinket.risingActive',
    config : {
      validate : {
        query : {
          lang  : Joi.string().required(),
          limit : Joi.number().optional().max(100).min(0)
        }
      },
      pre : [
        helpers.validLang,
        'isAdmin(user)'
      ]
    }
  },
  {
    route : 'GET /api/trinkets/{trinketId} trinket.getById',
    config : {
      pre : ['trinket(params.trinketId)']
    },
    reply : {
      data : {
        id          : 1,
        code        : 1,
        metrics     : 1,
        shortCode   : 1,
        lang        : 1,
        lastUpdated : 1,
        lastView    : 1,
        name        : 1,
        description : 1,
        snapshot    : 1,
        assets      : 1,
        settings    : 1,
        folder      : 1,
        _owner      : 1,
        username    : 1,
        slug        : 1,
        published   : 1
      }
    }
  },
  {
    route : 'PUT /api/trinkets/{trinketId}/code trinket.update',
    config : {
      auth: 'session',
      payload : {
        maxBytes : 10 * (1024 * 1024) // 10MB
      },
      pre : [
        'trinket(params.trinketId)',
        'canEdit(pre.trinket,user)'
      ],
      validate : {
        payload : {
          code     : Joi.string().allow(''),
          assets   : Joi.array().optional(),
          settings : Joi.object().optional()
        }
      }
    }
  },
  {
    route : 'PUT /api/trinkets/{trinketId}/name trinket.update',
    config : {
      auth: 'session',
      pre : [
        'trinket(params.trinketId)',
        'canEdit(pre.trinket,user)'
      ],
      validate : {
        payload : {
          name : Joi.string().allow('').max(50)
        }
      }
    }
  },
  {
    route : 'PUT /api/trinkets/{trinketId}/description trinket.update',
    config : {
      auth: 'session',
      pre : [
        'trinket(params.trinketId)',
        'canEdit(pre.trinket,user)'
      ],
      validate : {
        payload : {
          description : Joi.string().allow('').max(10000)
        }
      }
    }
  },
  {
    // delete a trinket
    route  : 'DELETE /api/trinkets/{trinketId} trinket.remove',
    config : {
      auth: 'session',
      pre  : [
        'trinket(params.trinketId)',
        'canEdit(pre.trinket,user)'
      ]
    }
  },
  {
    route : 'POST /api/trinkets/{trinketId}/email trinket.email',
    config : {
      pre : ['trinket(params.trinketId)', helpers.verifyEmailToken],
      validate : {
        payload : {
          email   : Joi.string().email().required(),
          name    : Joi.string().required(),
          replyTo : Joi.string().email().required(),
          width   : Joi.number().integer().min(1).max(100).optional(),
          height  : Joi.number().integer().min(1).optional(),
          start   : Joi.string().optional(),
          token   : Joi.string().allow('').optional(),
          'g-recaptcha-response' : recaptchaValidation
        }
      }
    }
  },
  {
    route : 'GET /api/trinkets trinket.list',
    config : {
      auth: 'session',
      validate : {
        query : {
          limit  : Joi.string().optional(),
          from   : Joi.string().optional(),
          sort   : Joi.string().optional(),
          offset : Joi.string().optional(),
          user   : Joi.string().optional(),
          folder : Joi.string().optional()
        }
      }
    },
    reply : {
      data : [{
        id          : 1,
        metrics     : 1,
        shortCode   : 1,
        lang        : 1,
        lastUpdated : 1,
        lastView    : 1,
        name        : 1,
        description : 1,
        snapshot    : 1,
        assets      : 1,
        settings    : 1,
        folder      : 1,
        _owner      : 1,
        username    : 1,
        slug        : 1,
        published   : 1
      }]
    }
  },
  {
    route : 'GET /api/trinkets/search trinket.search',
    config : {
      auth: 'session',
      validate : {
        query : {
          q : Joi.string().required()
        }
      }
    }
  },
  {
    route : 'POST /api/trinkets trinket.create',
    config : {
      cors : true,
      payload : {
        maxBytes : 10 * (1024 * 1024) // 10MB
      },
      validate : {
        query : {
          library : Joi.boolean()
        },
        payload : {
          code          : Joi.string().allow('').required(),
          lang          : Joi.string(),
          name          : Joi.string().allow(''),
          displayOnly   : Joi.boolean(),
          assets        : Joi.array().optional(),
          settings      : Joi.object().optional(),
          _origin_id    : Joi.string().allow(''),
          _remix        : Joi.boolean().optional(),
          shortCode     : Joi.string().optional(),
          _timestamp    : Joi.string().optional()
        }
      }
    }
  },
  {
    route : 'POST /api/trinkets/{trinketId}/forks trinket.createFork',
    config : {
      pre : ['trinket(params.trinketId)'],
      payload : {
        maxBytes : 10 * (1024 * 1024) // 10MB
      },
      // PRESERVED VALIDATION QUIRK. This payload shorthand rejects unknown keys,
      // and the embed's Copy/Remix control posts a nested `settings` object with
      // jQuery, which bracket-keys it; form-encoded bodies are parsed with
      // querystring.parse, so `settings[testsEnabled]` arrives as a literal
      // top-level key and is rejected before trinket.createFork runs, leaving no
      // fork. The rejection answers 200 with the payload echoed back through
      // request.fail, byte-identical at baseline 2f8712a, so AAP rule R-d keeps
      // the schema as-is; its accept/reject outcome is recorded in
      // test/parity/joi-baseline.json and compared by the AAP 0.6.2 joi gate.
      // POST /api/trinkets/{trinketId}/draft carries `.unknown(true)` and so
      // accepts the same body; that difference is baseline, not an oversight.
      validate : {
        query : {
          library : Joi.boolean()
        },
        payload : {
          code          : Joi.string().required(),
          name          : Joi.string().allow(''),
          description   : Joi.string().allow(''),
          assets        : Joi.array().optional(),
          settings      : Joi.object().optional(),
          _origin_id    : Joi.string().allow(''),
          _remix        : Joi.boolean().optional(),
          shortCode     : Joi.string().optional(),
          _timestamp    : Joi.string().optional()
        }
      }
    }
  },
  {
    route : 'PUT /api/trinkets/{trinketId}/metrics trinket.updateMetrics',
    config : {
      validate : {
        payload : {
          runs        : Joi.boolean(),
          linkShares  : Joi.boolean(),
          embedShares : Joi.boolean()
        }
      }
    },
    reply : {
      data : {
        metrics : 1
      }
    }
  },
  {
    route : 'POST /api/trinkets/{trinketId}/snapshot trinket.snapshot',
    config : {
      payload : {
        maxBytes : 10 * (1024 * 1024) // 10MB
      },
      pre : ['trinket(params.trinketId)']
    }
  },
  {
    route : 'POST /api/trinkets/{trinketId}/draft trinket.draft',
    config : {
      auth: 'session',
      payload : {
        maxBytes : 10 * (1024 * 1024) // 10MB
      },
      validate : {
        payload : Joi.object({
          code     : Joi.string().optional(),
          assets   : Joi.array().optional(),
          settings : Joi.object().unknown(true).optional(),
          zipCode  : Joi.string().optional()
        }).unknown(true)
      }
    }
  },
  {
    route : 'DELETE /api/drafts/{trinketId} trinket.discardDraft',
    config : {
      auth: 'session',
      pre : [
        'trinket(params.trinketId)'
      ],
    }
  },
  {
    route : 'POST /api/trinkets/{trinketId}/autosave trinket.autosave',
    config : {
      auth: 'session',
      pre : [helpers.findTrinket],
      payload : {
        maxBytes : 10 * (1024 * 1024) // 10MB
      },
      // PRESERVED VALIDATION QUIRK. This payload shorthand rejects unknown keys,
      // and the embed's autosave posts a nested `settings` object with jQuery,
      // which bracket-keys it; form-encoded bodies are parsed with
      // querystring.parse, so `settings[autofocusEnabled]` arrives as a literal
      // top-level key and is rejected before trinket.autosave runs at all, which
      // is why its ownership check never executes. The rejection answers 200 with
      // the payload, base64 `zipCode` included, echoed back through request.fail,
      // byte-identical at baseline 2f8712a, so AAP rule R-d keeps the schema
      // as-is; its accept/reject outcome is recorded in
      // test/parity/joi-baseline.json and compared by the AAP 0.6.2 joi gate.
      // POST /api/trinkets/{trinketId}/draft carries `.unknown(true)` and so
      // accepts the same body; that difference is baseline, not an oversight.
      validate : {
        payload : {
          code     : Joi.string().optional(),
          assets   : Joi.array().optional(),
          settings : Joi.object().optional(),
          zipCode  : Joi.string().optional()
        }
      }
    }
  },
  {
    route : 'GET /api/trinkets/{trinketId}/interactions trinket.interactions',
    config : {
      pre : ['trinket(params.trinketId)']
    }
  },
  {
    route : 'POST /api/trinkets/{trinketId}/grant trinket.grant',
    config : {
      auth: 'session',
      pre : ['isAdmin(user)', 'trinket(params.trinketId)', 'user(query.user)'],
      validate : {
        query : {
          user : Joi.string().required()
        }
      }
    }
  },
  {
    route : 'POST /api/trinkets/{trinketId}/folder trinket.addToFolder',
    config : {
      auth: 'session',
      pre : ['trinket(params.trinketId)', 'folder(payload.folderId)'],
      validate : {
        payload : {
          folderId : Joi.string().required()
        }
      }
    }
  },
  {
    route : 'DELETE /api/trinkets/{trinketId}/folder trinket.removeFromFolder',
    config : {
      auth: 'session',
      pre : ['trinket(params.trinketId)', 'folder(payload.folderId)'],
      validate : {
        payload : {
          folderId : Joi.string().required()
        }
      }
    }
  },
  {
    route : 'PUT /api/trinkets/{trinketId}/slug trinket.updateSlug',
    config : {
      auth: 'session',
      pre : [
        'trinket(params.trinketId)',
        'canEdit(pre.trinket,user)'
      ],
      validate : {
        payload : {
          slug : Joi.string().required()
        }
      }
    }
  },
  {
    route : 'PUT /api/trinkets/{trinketId}/published trinket.update',
    config : {
      auth: 'session',
      pre : [
        'trinket(params.trinketId)',
        'canEdit(pre.trinket,user)'
      ],
      validate : {
        payload : {
          published : Joi.boolean().required()
        }
      }
    }
  },
  {
    route : 'POST /api/interest pages.interest',
    config : {
      validate : {
        payload : {
          email : Joi.string().email().required(),
          page  : Joi.string().required()
        }
      }
    }
  },
  {
    route : 'POST /api/users/login users.login',
    cookie : true,
    config  : {
      // encryptRoles is a flag only: the true value selects users.login's projected payload
      pre : [{ method : helpers.lowerUserFields }, { method : function(request, h) { return true; }, assign : 'encryptRoles' }],
      validate : {
        payload : {
          email    : Joi.string().required(),
          password : Joi.string()
        }
      }
    }
  },
  {
    route : 'POST /api/users users.create',
    cookie: true,
    config : {
      pre : [{ method: helpers.lowerUserFields }],
      validate  : {
        payload : {
          email    : Joi.string().email().required(),
          password : Joi.string().min(3).regex(/^[\w`~!@#$%^&*+=:;'"<>,.?{}\-\/\(\)\[\]\|\\\s]*$/).required(),
          interest : Joi.string().allow('').optional()
        }
      }
    }
  },
  {
    route : 'DELETE /api/users users.remove',
    config : {
      auth: 'session',
      validate : {
        query : {
          username : Joi.string().required()
        }
      }
    }
  },
  {
    route : 'POST /api/trinkets/{shortCode}/list trinket.addToList',
    config : {
      validate : {
        query : {
          name : Joi.string().required()
        }
      },
      pre : ['isAdmin(user)', helpers.findTrinket]
    }
  },
  {
    route : 'GET /api/trinkets/{lang}/list trinket.namedList',
    config : {
      validate : {
        query : {
          name : Joi.string().required()
        }
      },
      pre : ['namedTrinketList(params.lang, query.name)']
    }
  },
  {
    route : 'DELETE /api/trinkets/{lang}/list/{shortCode} trinket.removeFromList',
    config : {
      validate : {
        query : {
          name : Joi.string().required()
        }
      },
      pre : ['isAdmin(user)', helpers.findTrinket]
    }
  },
  {
    route : 'POST /api/trinkets/codeerror trinket.logError',
    config : {
      validate : {
        payload        : {
          state        : Joi.string().required(),
          session      : Joi.string().required(),
          group        : Joi.number().integer().required(),
          error        : Joi.string().required(),
          type         : Joi.string().required(),
          message      : Joi.string().required(),
          line         : Joi.number().integer().optional(),
          code         : Joi.string().required(),
          attempt      : Joi.number().integer().required(),
          delta        : Joi.string().optional(),
          introduced   : Joi.string().optional(),
          elapsed      : Joi.number().integer().optional(),
          totalElapsed : Joi.number().integer().optional(),
          shortCode    : Joi.string().optional(),
          lang         : Joi.string().required(),
          label        : Joi.string().optional()
        }
      },
      pre : [helpers.validLang]
    }
  },
  {
    route : 'POST /api/trinkets/clientmetric trinket.logClientMetric',
    config : {
      validate : {
        payload : {
          lang       : Joi.string().required(),
          event_type : Joi.string().required(),
          duration   : Joi.number().integer().required(), // milliseconds
          trinketId  : Joi.string().optional(),
          message    : Joi.string().optional(),
          session    : Joi.string().optional()
        }
      }
    }
  },
  {
    route : 'POST /api/trinkets/download trinket.downloadPostedZip',
    config : {
      payload : {
        maxBytes : 10 * (1024 * 1024) // 10MB
      },
      validate : {
        payload : {
          files    : Joi.string().required(),
          assets   : Joi.string().optional(),
          filename : Joi.string().optional()
        }
      }
    }
  },
  {
    route : 'GET /api/users/assets users.assetList',
    config : {
      validate : {
        query : {
          type   : Joi.string().optional(),
          sortBy : Joi.string().optional()
        }
      }
    }
  },
  {
    route : 'POST /api/users/assets users.assetUpload',
    config : {
      auth: 'session',
      /*
       * The base commit's declaration, unchanged. `output : 'file'` is the
       * pre-hapi-17 spelling of `payload.multipart.output`, and
       * lib/util/routeParser.js's `migratePayloadOutput` restates it while
       * parsing -- the same translation the two upload routes in
       * config/routes.js get, which carry the full reasoning.
       *
       * In short: `payload.multipart` defaults to FALSE in hapi
       * [node_modules/@hapi/hapi/lib/config.js:144-149] and @hapi/subtext then
       * answers 415 to a `multipart/form-data` body from the payload parser
       * [node_modules/@hapi/subtext/lib/index.js:92-96], so the asset Dropzone
       * at public/js/plugins/asset-browser.js:270-271 -- whose default
       * paramName 'file' matches the key validated below -- could never upload
       * anything. Subtext reads the part output from
       * `options.multipart.output` [node_modules/@hapi/subtext/lib/index.js:290],
       * so file parts still land on disk exactly as before, while a
       * non-multipart body is parsed as data rather than spooled.
       */
      payload : {
        maxBytes  : 1048576 * 5, // 5MB
        output : 'file'
      },
      validate : {
        payload : {
          file : Joi.any().required()
        }
      }
    }
  },
  {
    route : 'POST /api/users/assets/{fileId} users.replaceAsset',
    config : {
      auth: 'session',
      pre : ['file(params.fileId)'],
      // Same declaration as `POST /api/users/assets` above, and likewise the
      // base commit's text. This is the asset-replace half of the same flow,
      // driven by the same Dropzone at
      // public/js/plugins/asset-browser.js:528-530, so it needs the same
      // `migratePayloadOutput` translation: untranslated, the replace path
      // would answer 415 while the upload path worked.
      payload : {
        maxBytes : 1048576 * 5, // 5MB
        output : 'file'
      },
      validate : {
        payload : {
          file : Joi.any().required()
        }
      }
    }
  },
  {
    route : 'DELETE /api/users/assets/{fileId} users.removeAsset',
    config : {
      auth: 'session',
      pre : ['file(params.fileId)']
    }
  },
  {
    route : 'POST /api/users/assets/restore users.restoreAsset',
    config : {
      auth: 'session',
      pre : ['file(payload.fileId)'],
      validate : {
        payload : {
          fileId : Joi.string().required()
        }
      }
    }
  },
  {
    route : 'POST /api/users/assetFromURL users.assetUploadFromURL',
    config : {
      auth: 'session',
      validate : {
        payload : {
          url : Joi.string().required()
        }
      }
    }
  },
  {
    route : 'POST /api/files/{fileId}/thumbnail files.setThumbnail',
    config : {
      pre  : ['file(params.fileId)'],
      validate : {
        payload : {
          bucket : Joi.string().required(),
          secret : Joi.string().required()
        }
      }
    }
  },
  {
    route : 'POST /api/ohnoes admin.ohnoes'
  },
  {
    route : 'POST /api/users/password users.changePassword',
    config : {
      auth: 'session',
      validate : {
        payload : {
          currentPassword : Joi.string().required(),
          newPassword : Joi.string().required(),
          confirmPassword : Joi.string().required()
        }
      }
    }
  },
  {
    route : 'POST /api/users/email users.sendEmailChange', // checks for dups, sends confirmation
    config : {
      auth: 'session',
      pre : [{ method : helpers.lowerUserFields }],
      validate : {
        payload : {
          email : Joi.string().email().required()
        }
      }
    }
  },
  {
    route : 'GET /change-email users.changeEmail', // actually change user email
    success : {
      redirect: 'account/email'
    },
    fail : {
      redirect: 'account/email'
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
    route : 'GET /api/users/resendEmailChange users.resendEmailChange',
    config : {
      auth: 'session'
    }
  },
  {
    route : 'POST /api/users/verify-email users.sendEmailVerification',
    config : {
      auth: 'session',
      validate : {
        payload : {
          'g-recaptcha-response' : recaptchaValidation
        }
      }
    }
  },
  {
    route : 'GET /verify-email users.verifyEmail', // actually verify user email
    success : {
      redirect: 'account/email'
    },
    fail : {
      redirect: 'account/email'
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
    route : 'POST /api/admin/user/{userId} admin.updateUser',
    config : {
      auth: 'session',
      pre  : ['isAdmin(user)']
    }
  },
  {
    route : 'POST /api/admin/user/{userId}/grant admin.grantRole',
    config : {
      auth: 'session',
      pre  : ['isAdmin(user)'],
      validate : {
        payload : {
          role : Joi.string().required()
        }
      }
    }
  },
  {
    route : 'POST /api/admin/featured-course admin.addFeaturedCourse',
    config : {
      auth: 'session',
      pre  : ['isAdmin(user)'],
      validate : {
        payload : {
          ownerSlug : Joi.string().required(),
          slug      : Joi.string().required(),
          page      : Joi.string().allow('')
        }
      }
    }
  },
  {
    route : 'DELETE /api/admin/featured-course/{courseId} admin.removeFeaturedCourse',
    config : {
      auth: 'session',
      pre  : ['isAdmin(user)'],
      validate : {
        params : {
          courseId : Joi.string().required()
        },
        query : {
          page : Joi.string().allow('')
        }
      }
    }
  },
  {
    route : 'POST /api/admin/featured-course/move admin.moveFeaturedCourse',
    config : {
      auth: 'session',
      pre  : ['isAdmin(user)'],
      validate : {
        payload : {
          currentIndex : Joi.number().required(),
          newIndex     : Joi.number().required(),
          courseId     : Joi.string().required(),
          page         : Joi.string().allow('')
        }
      }
    }
  },
  {
    route : 'GET /api/users/{userId}/avatar users.getAvatar',
    success : {
      redirect: '{src}'
    },
    config : {
      pre : ['user(params.userId)']
    }
  },
  {
    route : 'GET /api/users/{userId}/info users.getInfo',
    config : {
      pre : ['user(params.userId)']
    }
  },
  {
    route : 'POST /api/users/settings users.updateSettings',
    config : {
      auth: 'session',
      validate : {
        payload : {
          disableAceEditor : Joi.boolean().required()
        }
      }
    }
  },
  {
    route : 'POST /api/users/settings/lineWrapping users.updateSettings',
    config : {
      auth: 'session',
      validate : {
        payload : {
          lineWrapping : Joi.boolean().required()
        }
      }
    }
  },
  {
    route : 'POST /api/users/settings/indentation users.updateSettings',
    config : {
      auth: 'session',
      validate : {
        payload : {
          pythonTab : Joi.number().optional(),
          javaTab : Joi.number().optional(),
          htmlTab : Joi.number().optional(),
          rTab : Joi.number().optional()
        }
      }
    }
  },
  // Bulk export endpoints
  {
    route : 'POST /api/exports users.requestExport',
    config : {
      auth: 'session'
    }
  },
  {
    route : 'GET /api/exports users.listExports',
    config : {
      auth: 'session',
      validate : {
        query : {
          limit : Joi.number().optional().max(50)
        }
      }
    }
  },
  {
    route : 'GET /api/exports/{exportId} users.getExportStatus',
    config : {
      auth: 'session'
    }
  },
  {
    route : 'GET /api/exports/{exportId}/download users.downloadExport',
    config : {
      auth: 'session'
    }
  }
]
