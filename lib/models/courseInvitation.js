var mongoose  = require('mongoose')
  , model     = require('./model')
  , _         = require('underscore')
  , validator = require('validator')
  , crypto    = require('crypto')
  , config    = require('config')
  , nunjucks  = require('../util/nunjucks')
  , mailer    = require('../util/mailer')
  , schema   = {
        courseId : { type : mongoose.SchemaTypes.ObjectId, ref : 'Course' }
      , email    : { type : String, required: true }
      , sentOn   : { type : Date }
      , token    : { type : String, required: true, index: true }
      , status   : { type : String, required: true, default: 'pending' } // pending, sent, invalid, resend, accepted
    };

var url = config.app.url.protocol + '://' + config.app.url.hostname;

// Behaviour-parity shim for the validator 5.7.0 -> 13.15.35 bump (TR6 / R-4 / R-6).
//
// The two isEmail call sites in this file do not merely gate a response - they decide the
// value PERSISTED in the `status` field ('invalid' versus 'pending'/'resend'), and neither
// route validates the address first: `POST /api/courses/{courseId}/invitations` declares
// only `emailList : Joi.array().required()` and `PUT .../invitations/{invitationId}/email`
// only `email : Joi.string().optional()`. This function is therefore the sole gate, and a
// stricter validator would silently rewrite stored documents.
//
// validator 5.7.0's isEmail special-cased Google's dot-insensitive addressing: when the
// domain was exactly `gmail.com` or `googlemail.com` it stripped EVERY dot from the local
// part before validating, so `a..b@gmail.com`, `.a.b@gmail.com` and `a.b.@gmail.com` were
// all accepted. validator 13 removed that normalisation from isEmail and rejects them.
// Measured across the reachable input space, that is the ONLY verdict that changed: a
// 51-case probe found 1 difference and a systematic matrix isolated all 21 hits to the
// gmail.com / googlemail.com domains (exact match, not suffix - `sub.gmail.com` is
// unaffected). No isEmail option restores it: allow_utf8_local_part, ignore_max_length,
// blacklisted_chars and allow_display_name were all tried and all still reject.
//
// Reapplying 5.7.0's normalisation before delegating to validator 13 reproduces the old
// verdict exactly. Verified over 2,764 generated cases - every local-part shape crossed
// with every domain shape, in raw and lower-cased form, plus the pathological forms - with
// ZERO differences against validator 5.7.0. See docs/PRESERVED-QUIRKS.md section 3.25.
function isEmailLegacy(email) {
  var at = email.lastIndexOf('@');

  if (at > 0) {
    var domain = email.slice(at + 1).toLowerCase();

    if (domain === 'gmail.com' || domain === 'googlemail.com') {
      email = email.slice(0, at).replace(/\./g, '').toLowerCase() + '@' + domain;
    }
  }

  return validator.isEmail(email);
}

function addList(emailList, course) {
  var self = this
    , currentEmails
    , token, query, update, updateOptions;

  currentEmails = course.users.map(function(user) {
    return user.email.toLowerCase();
  });

  emailList = _.uniq(
    _.map(emailList, function(email) {
      return email.toLowerCase();
    })
  );

  emailList = _.difference(emailList, currentEmails);

  return Promise.all(emailList.map(function(email) {
    token = crypto.createHash("md5").update(email + course.id).digest("hex").substring(0, 8);

    query = {
        courseId : course.id
      , email    : email
    };

    update = {
        courseId    : course.id
      , email       : email
      , token       : token
      , status      : "pending"
      , lastUpdated : Date.now()
    };

    if (!isEmailLegacy(email)) {
      update.status = "invalid";
    }

    updateOptions = {
        new    : true
      , upsert : true
    };

    return self.model.findOneAndUpdate(query, update, updateOptions).exec();
  }));
}

function sendInvitationEmail(invitation, course, user) {
  if (invitation.status !== "pending" && invitation.status !== "resend") {
    return Promise.resolve();
  }

  var acceptUrl = url + "/courses/accept/" + invitation.token;
  var subject   = "Trinket Invitation to " + course.name;

  var emailTemplateData = {
      inviterName       : user.fullname
    , courseName        : course.name
    , courseDescription : course.description
    , acceptUrl         : acceptUrl
  };

  return nunjucks.render("emails/course-invitation", emailTemplateData)
    .then(function(emailMessage) {
      return mailer.send(invitation.email, subject, { html : emailMessage, replyTo : user.email, type : 'course-invitation' });
    })
    .then(function() {
      invitation.status = "sent";
      invitation.sentOn = Date.now();
      return invitation.save();
    })
    .catch(function(err) {
      console.error('Failed to send course invitation email:', err.message);
      // Don't fail the whole operation if email fails
      return Promise.resolve();
    });
}

function sendEmails(invitations, course, user) {
  return Promise.all(invitations.map(function(invitation) {
    return sendInvitationEmail(invitation, course, user);
  }));
}

function findUnacceptedByCourse(course) {
  var query = {
      courseId : course.id
    , status   : { "$ne" : "accepted" }
  };

  return this.model.find(query).exec();
}

function findByToken(token) {
  return this.model.findOne({ token : token }).exec();
}

function updateEmail(email) {
  this.email  = email.toLowerCase();
  this.status = isEmailLegacy(this.email) ? "resend" : "invalid";
}

var CourseInvitation = model.create("CourseInvitation", {
    schema       : schema
  , classMethods : {
        addList                : addList
      , sendEmails             : sendEmails
      , findUnacceptedByCourse : findUnacceptedByCourse
      , findByToken            : findByToken
    }
  , objectMethods : {
        updateEmail : updateEmail
    }
  , index: [
      [{ courseId : 1, email : 1 }, { unique : true }]
    ]
  , publicSpec   : {
        id     : true
      , email  : true
      , sent   : true
      , token  : true
      , status : true
    }
});

module.exports = CourseInvitation.publicModel;
