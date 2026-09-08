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
    // The token is the ONLY credential `GET /courses/accept/{token}` asks for -
    // `findByToken` below is the whole of that lookup - so it has to be
    // unguessable on its own. It was `md5(email + course.id).substring(0, 8)`,
    // which is neither: 8 hex characters is a 32-bit space, and both inputs are
    // public (the invited address is known to whoever asks for it, and the
    // course id appears in course URLs), so the value was derivable without any
    // search at all. `randomBytes` is the CSPRNG, 32 bytes is 256 bits, and hex
    // makes that the 64-character string the schema's `String` field stores and
    // the accept path compares.
    token = crypto.randomBytes(32).toString("hex");

    query = {
        courseId : course.id
      , email    : email
    };

    // Split across two operators, and the split is the point.
    //
    // This is an upsert keyed on `{courseId, email}` - the pair the unique index
    // below covers - and the invitation controller calls `addList` again for
    // every resend and for every re-submission of an address already invited.
    // A token in `$set` would therefore be re-minted on each of those calls,
    // silently invalidating the link that has already been mailed: the
    // recipient's URL carries the old value, `findByToken` would no longer
    // resolve it, and the accept route would answer the not-found branch. That
    // applies equally to every row written before this change, whose 8-character
    // md5 token stays valid until the invitation is deleted.
    //
    // `$setOnInsert` applies only when the upsert actually inserts, so a NEW
    // invitation is minted a token and an EXISTING one keeps whatever token it
    // was created with. `token` appears in exactly one of the two operators
    // because MongoDB rejects an update document that names the same path in
    // both. Everything else stays in `$set`, which is what the previous bare
    // update document cast to.
    update = {
        $set : {
            courseId    : course.id
          , email       : email
          , status      : "pending"
          , lastUpdated : Date.now()
        }
      , $setOnInsert : {
            token : token
        }
    };

    if (!validator.isEmail(email)) {
      update.$set.status = "invalid";
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
  this.status = validator.isEmail(this.email) ? "resend" : "invalid";
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
