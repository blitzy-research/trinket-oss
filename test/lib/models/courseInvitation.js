var crypto           = require('crypto'),
    mongoose         = require('mongoose'),
    sinon            = require('sinon'),
    should           = require('chai').should(),
    nunjucks         = require('../../../lib/util/nunjucks'),
    mailer           = require('../../../lib/util/mailer'),
    CourseInvitation = require('../../../lib/models/courseInvitation');

describe('CourseInvitation model', function() {
  var courseId;
  var stubs = [];

  beforeEach(function() {
    courseId = new mongoose.Types.ObjectId();
  });

  afterEach(function() {
    stubs.forEach(function(stub) {
      stub.restore();
    });
    stubs = [];

    return CourseInvitation.model.deleteMany({ courseId : courseId });
  });

  function invitation(data) {
    return new CourseInvitation(Object.assign({
      courseId : courseId,
      email    : 'invitee@example.com',
      token    : 'token123',
      status   : 'pending'
    }, data));
  }

  function course(data) {
    return Object.assign({
      id          : courseId,
      name        : 'Measured Course',
      description : 'Measured description',
      users       : []
    }, data);
  }

  function inviter() {
    return {
      fullname : 'Inviting User',
      email    : 'inviter@example.com'
    };
  }

  describe('addList', function() {
    it('lowercases, deduplicates and excludes existing course users before upserting', async function() {
      var result = await CourseInvitation.addList([
        'New@Example.com',
        'new@example.com',
        'bad-address',
        'existing@example.com'
      ], course({
        users : [{ email : 'Existing@Example.com' }]
      }));

      result.map(function(item) {
        return [item.email, item.status, item.token.length];
      }).sort().should.deep.equal([
        ['bad-address', 'invalid', 8],
        ['new@example.com', 'pending', 8]
      ]);

      (await CourseInvitation.model.countDocuments({ courseId : courseId })).should.equal(2);
    });

    it('derives the persisted token from md5(email + course.id), truncated to eight hex characters',
      async function() {
        var result = await CourseInvitation.addList(['Token@Example.com'], course());
        var email = 'token@example.com';
        var expected = crypto.createHash('md5')
          .update(email + String(courseId))
          .digest('hex')
          .substring(0, 8);

        result[0].email.should.equal(email);
        result[0].token.should.equal(expected);
        result[0].token.should.match(/^[0-9a-f]{8}$/);
      });

    it('upserts the same course and email instead of creating a duplicate', async function() {
      await CourseInvitation.addList(['same@example.com'], course());
      await CourseInvitation.addList(['SAME@example.com'], course());

      var stored = await CourseInvitation.model.find({ courseId : courseId }).lean();
      stored.should.have.length(1);
      stored[0].email.should.equal('same@example.com');
    });

    it('propagates the identical database error from the upsert', async function() {
      var expected = new Error('invitation upsert failed');
      stubs.push(sinon.stub(CourseInvitation.model, 'findOneAndUpdate').returns({
        exec : function() {
          return Promise.reject(expected);
        }
      }));

      var rejected;
      try {
        await CourseInvitation.addList(['new@example.com'], course());
      }
      catch (err) {
        rejected = err;
      }

      rejected.should.equal(expected);
    });
  });

  describe('the validator 5 email contract', function() {
    it('keeps exact-domain Gmail dot normalisation when updating an address', function() {
      var model = invitation();

      model.updateEmail('a..b@GMail.com');

      model.email.should.equal('a..b@gmail.com');
      model.status.should.equal('resend');
    });

    it('keeps exact-domain Googlemail dot normalisation when adding an address', async function() {
      var result = await CourseInvitation.addList(['.a.b@GoogleMail.com'], course());

      result[0].email.should.equal('.a.b@googlemail.com');
      result[0].status.should.equal('pending');
    });

    it('does not apply the Gmail compatibility rule to a subdomain', function() {
      var model = invitation();

      model.updateEmail('a..b@sub.gmail.com');

      model.email.should.equal('a..b@sub.gmail.com');
      model.status.should.equal('invalid');
    });

    it('lowercases ordinary valid and invalid addresses and assigns resend or invalid', function() {
      var model = invitation();

      model.updateEmail('Good@Example.com');
      model.email.should.equal('good@example.com');
      model.status.should.equal('resend');

      model.updateEmail('NOPE');
      model.email.should.equal('nope');
      model.status.should.equal('invalid');
    });
  });

  describe('lookup methods', function() {
    it('finds an invitation by token and excludes accepted invitations from a course query', async function() {
      var pending = await invitation({
        email  : 'pending@example.com',
        token  : 'pending1',
        status : 'pending'
      }).save();
      await invitation({
        email  : 'accepted@example.com',
        token  : 'accepted',
        status : 'accepted'
      }).save();
      var invalid = await invitation({
        email  : 'invalid@example.com',
        token  : 'invalid1',
        status : 'invalid'
      }).save();

      var byToken = await CourseInvitation.findByToken(pending.token);
      var unaccepted = await CourseInvitation.findUnacceptedByCourse(course());

      byToken.id.should.equal(pending.id);
      unaccepted.map(function(item) {
        return item.id;
      }).sort().should.deep.equal([invalid.id, pending.id].sort());
    });
  });

  describe('sendEmails', function() {
    it('sends pending invitations, persists the sent state and skips invalid invitations', async function() {
      var pending = invitation({
        email  : 'pending@example.com',
        token  : 'pending1',
        status : 'pending'
      });
      var invalid = invitation({
        email  : 'invalid-address',
        token  : 'invalid1',
        status : 'invalid'
      });
      var render = sinon.stub(nunjucks, 'render').resolves('<p>invitation</p>');
      var send = sinon.stub(mailer, 'send').resolves();
      stubs.push(render, send);

      var result = await CourseInvitation.sendEmails([pending, invalid], course(), inviter());

      result.should.have.length(2);
      result[0].status.should.equal('sent');
      should.not.exist(result[1]);
      pending.status.should.equal('sent');
      pending.sentOn.should.be.instanceof(Date);
      invalid.status.should.equal('invalid');

      render.calledOnce.should.be.true;
      render.firstCall.args.should.deep.equal([
        'emails/course-invitation',
        {
          inviterName       : 'Inviting User',
          courseName        : 'Measured Course',
          courseDescription : 'Measured description',
          acceptUrl         : 'http://localhost/courses/accept/pending1'
        }
      ]);
      send.calledOnce.should.be.true;
      send.firstCall.args.should.deep.equal([
        'pending@example.com',
        'Trinket Invitation to Measured Course',
        {
          html    : '<p>invitation</p>',
          replyTo : 'inviter@example.com',
          type    : 'course-invitation'
        }
      ]);

      var stored = await CourseInvitation.findById(pending.id);
      stored.status.should.equal('sent');
      stored.sentOn.should.be.instanceof(Date);
    });

    ['sent', 'invalid', 'accepted'].forEach(function(status) {
      it('skips an invitation whose status is ' + status, async function() {
        var render = sinon.stub(nunjucks, 'render').resolves('<p>unused</p>');
        var send = sinon.stub(mailer, 'send').resolves();
        stubs.push(render, send);

        var result = await CourseInvitation.sendEmails([
          invitation({ status : status })
        ], course(), inviter());

        result.should.deep.equal([undefined]);
        render.called.should.be.false;
        send.called.should.be.false;
      });
    });

    it('swallows a render failure, logs it and leaves the status unchanged', async function() {
      var expected = new Error('template failed');
      var render = sinon.stub(nunjucks, 'render').rejects(expected);
      var send = sinon.stub(mailer, 'send').resolves();
      var errorLog = sinon.stub(console, 'error');
      stubs.push(render, send, errorLog);
      var model = invitation({ status : 'pending' });

      var result = await CourseInvitation.sendEmails([model], course(), inviter());

      result.should.deep.equal([undefined]);
      model.status.should.equal('pending');
      send.called.should.be.false;
      errorLog.calledOnce.should.be.true;
      errorLog.firstCall.args.should.deep.equal([
        'Failed to send course invitation email:',
        'template failed'
      ]);
    });

    it('swallows a mail failure, logs it and leaves the resend status unchanged', async function() {
      var render = sinon.stub(nunjucks, 'render').resolves('<p>invitation</p>');
      var send = sinon.stub(mailer, 'send').rejects(new Error('smtp failed'));
      var errorLog = sinon.stub(console, 'error');
      stubs.push(render, send, errorLog);
      var model = invitation({ status : 'resend' });

      var result = await CourseInvitation.sendEmails([model], course(), inviter());

      result.should.deep.equal([undefined]);
      model.status.should.equal('resend');
      errorLog.calledOnce.should.be.true;
      errorLog.firstCall.args.should.deep.equal([
        'Failed to send course invitation email:',
        'smtp failed'
      ]);
    });

    it('also swallows a save failure after changing the in-memory state to sent', async function() {
      var render = sinon.stub(nunjucks, 'render').resolves('<p>invitation</p>');
      var send = sinon.stub(mailer, 'send').resolves();
      var errorLog = sinon.stub(console, 'error');
      stubs.push(render, send, errorLog);
      var model = invitation({ status : 'pending' });
      var save = sinon.stub(model, 'save').rejects(new Error('save failed'));
      stubs.push(save);

      var result = await CourseInvitation.sendEmails([model], course(), inviter());

      result.should.deep.equal([undefined]);
      model.status.should.equal('sent');
      model.sentOn.should.be.instanceof(Date);
      errorLog.calledOnce.should.be.true;
      errorLog.firstCall.args.should.deep.equal([
        'Failed to send course invitation email:',
        'save failed'
      ]);
    });
  });

  it('serializes the nonexistent sent field rather than the stored sentOn field', function() {
    var model = invitation({
      sentOn : new Date('2020-01-02T03:04:05.000Z')
    });
    var serialized = model.serialize();

    Object.keys(serialized).sort().should.deep.equal(['email', 'id', 'sent', 'status', 'token']);
    should.not.exist(serialized.sent);
    should.not.exist(serialized.sentOn);
  });
});