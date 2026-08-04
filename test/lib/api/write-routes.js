/**
 * High-risk parameterized and write-route coverage for review finding M-25.
 *
 * Every request goes through test/helpers/flow.js, so it uses the same real-HTTP transport, referer and
 * cookie policy as the original API suites. Expectations were measured against this tree before being
 * encoded. The 500s below are deliberate R-6 pins: the affected controllers reference an undeclared
 * `Boom` identifier, and changing them to 403/404 would be a forbidden behavior improvement.
 */

var mongoose         = require('mongoose'),
    sinon            = require('sinon'),
    should           = require('chai').should(),
    flow             = require('../../helpers/flow'),
    defaults         = require('../../helpers/defaults'),
    mailer           = require('../../../lib/util/mailer'),
    CourseInvitation = require('../../../lib/models/courseInvitation');

var INTERNAL_ERROR = {
  statusCode : 500,
  error      : 'Internal Server Error',
  message    : 'An internal server error occurred'
};

function switchUser(name) {
  return new Promise(function(resolve, reject) {
    flow.switchUser(name, function(err) {
      return err ? reject(err) : resolve();
    });
  });
}

function request(method, path, body) {
  return new Promise(function(resolve, reject) {
    var pending = flow[method](path);

    if (typeof body !== 'undefined') {
      pending.send(body);
    }

    pending.end(function(err, response) {
      return err ? reject(err) : resolve(response);
    });
  });
}

function expectJson(response, status) {
  response.statusCode.should.equal(status);
  response.headers['content-type'].should.contain('application/json');
}

function clearSlot(name) {
  delete flow.cookies[name];
  delete flow.cookieHistory[name];
}

module.exports = function() {
  describe('Parameterized and write routes', function() {
    var previousUser;
    var owner;
    var other;
    var course;
    var folderId;

    before(async function() {
      this.timeout(60000);
      previousUser = flow.activeUser;

      clearSlot('routeCoverage');
      clearSlot('routeCoverageOther');
      await User.model.deleteMany({
        email : { $in : [defaults.routeCoverage.email, defaults.routeCoverageOther.email] }
      });

      await switchUser('routeCoverage');
      owner = await User.findByLogin(defaults.routeCoverage.email);

      var created = await request('post', '/api/courses', {
        name        : 'route coverage course',
        description : 'route coverage description'
      });
      expectJson(created, 200);
      created.body.should.have.property('course');
      course = await Course.findById(created.body.course.id);

      await switchUser('routeCoverageOther');
      other = await User.findByLogin(defaults.routeCoverageOther.email);
      flow.switchUser('routeCoverage');
    });

    after(async function() {
      this.timeout(60000);

      await CourseInvitation.model.deleteMany({ courseId : course && course.id });
      await Folder.model.deleteMany({
        _owner : { $in : [owner && owner.id, other && other.id].filter(Boolean) }
      });
      if (course) {
        await Course.model.deleteMany({ _id : course.id });
      }
      await User.model.deleteMany({
        email : { $in : [defaults.routeCoverage.email, defaults.routeCoverageOther.email] }
      });

      clearSlot('routeCoverage');
      clearSlot('routeCoverageOther');
      flow.activeUser = previousUser;
    });

    describe('the sole PATCH route', function() {
      it('archives the owner course and persists the boolean', async function() {
        var response = await request('patch', '/api/courses/' + course.id, {
          archived : true
        });

        expectJson(response, 200);
        Object.keys(response.body).sort().should.deep.equal(['context', 'course', 'flash']);
        response.body.course.id.should.equal(course.id);
        response.body.course.archived.should.be.true;
        response.body.flash.should.deep.equal({});
        should.equal(response.body.context, null);

        var stored = await Course.findById(course.id);
        stored.archived.should.be.true;
      });

      it('returns the measured validation flash when archived is missing', async function() {
        var response = await request('patch', '/api/courses/' + course.id, {});

        expectJson(response, 200);
        response.body.should.deep.equal({
          flash : {
            validation : {
              archived : '"archived" is required'
            }
          }
        });
      });

      it('preserves the scrubbed 500 for a non-owner instead of inventing a 403', async function() {
        flow.switchUser('routeCoverageOther');
        var response;

        try {
          response = await request('patch', '/api/courses/' + course.id, {
            archived : false
          });
        }
        finally {
          flow.switchUser('routeCoverage');
        }

        expectJson(response, 500);
        response.body.should.deep.equal(INTERNAL_ERROR);
        (await Course.findById(course.id)).archived.should.be.true;
      });
    });

    describe('folder CRUD', function() {
      it('creates a folder and persists the returned shape', async function() {
        var response = await request('post', '/api/folders', {
          name : 'Route Folder'
        });

        expectJson(response, 200);
        response.body.success.should.be.true;
        response.body.folder.name.should.equal('Route Folder');
        response.body.folder.slug.should.equal('route-folder');
        response.body.folder._owner.should.equal(owner.id);
        response.body.flash.should.deep.equal({});
        should.equal(response.body.context, null);
        folderId = response.body.folder.id;

        var stored = await Folder.findById(folderId);
        stored.name.should.equal('Route Folder');
        stored.slug.should.equal('route-folder');
        String(stored._owner).should.equal(owner.id);
      });

      it('lists the owner folder with an exact zero trinket count', async function() {
        var response = await request('get', '/api/folders');

        expectJson(response, 200);
        response.body.data.should.have.length(1);
        response.body.data[0].id.should.equal(folderId);
        response.body.data[0].name.should.equal('Route Folder');
        response.body.data[0].slug.should.equal('route-folder');
        response.body.data[0].trinketCount.should.equal(0);
        response.body.flash.should.deep.equal({});
        should.equal(response.body.context, null);
      });

      it('returns an empty trinket list through the injected API route', async function() {
        var response = await request('get', '/api/folders/' + folderId + '/trinkets');

        expectJson(response, 200);
        response.body.should.deep.equal({
          data    : [],
          flash   : {},
          context : null
        });
      });

      it('renames the folder, regenerates its slug and persists both values', async function() {
        var response = await request('put', '/api/folders/' + folderId + '/name', {
          name : 'Renamed Route Folder'
        });

        expectJson(response, 200);
        response.body.success.should.be.true;
        response.body.folder.id.should.equal(folderId);
        response.body.folder.name.should.equal('Renamed Route Folder');
        response.body.folder.slug.should.equal('renamed-route-folder');

        var stored = await Folder.findById(folderId);
        stored.name.should.equal('Renamed Route Folder');
        stored.slug.should.equal('renamed-route-folder');
      });

      it('answers 403 when the canEdit pre-handler rejects a non-owner rename', async function() {
        flow.switchUser('routeCoverageOther');
        var response;

        try {
          response = await request('put', '/api/folders/' + folderId + '/name', {
            name : 'Forbidden Rename'
          });
        }
        finally {
          flow.switchUser('routeCoverage');
        }

        expectJson(response, 403);
        response.body.should.deep.equal({
          statusCode : 403,
          error      : 'Forbidden',
          message    : 'Forbidden'
        });
        (await Folder.findById(folderId)).name.should.equal('Renamed Route Folder');
      });

      it('preserves the scrubbed 500 from the controller non-owner delete branch', async function() {
        flow.switchUser('routeCoverageOther');
        var response;

        try {
          response = await request('del', '/api/folders/' + folderId);
        }
        finally {
          flow.switchUser('routeCoverage');
        }

        expectJson(response, 500);
        response.body.should.deep.equal(INTERNAL_ERROR);
        should.exist(await Folder.findById(folderId));
      });

      it('deletes the owner folder and returns the measured success envelope', async function() {
        var response = await request('del', '/api/folders/' + folderId);

        expectJson(response, 200);
        response.body.should.deep.equal({
          success : true,
          flash   : {},
          context : null
        });
        should.not.exist(await Folder.findById(folderId));
        folderId = null;
      });
    });

    describe('course access and invitation routes', function() {
      var invitationId;
      var mailerStubs = [];

      after(function() {
        mailerStubs.forEach(function(stub) {
          stub.restore();
        });
        mailerStubs = [];
      });

      it('adds a user to the course and persists the membership', async function() {
        var response = await request('post', '/api/courses/' + course.id + '/users', {
          user : other.id
        });

        expectJson(response, 200);
        response.body.should.deep.equal({
          success : true,
          flash   : {},
          context : null
        });

        var stored = await Course.findById(course.id);
        stored.users.map(function(user) {
          return String(user.userId);
        }).should.contain(other.id);
        stored.users.map(function(user) {
          return user.email;
        }).should.contain(defaults.routeCoverageOther.email);
      });

      it('preserves the scrubbed 500 when userLookup cannot find a login', async function() {
        var response = await request('post', '/api/courses/' + course.id + '/userLookup', {
          user : 'missing-route-user@example.com'
        });

        expectJson(response, 500);
        response.body.should.deep.equal(INTERNAL_ERROR);
      });

      it('lists no invitations before one has been created', async function() {
        var response = await request('get', '/api/courses/' + course.id + '/invitations');

        expectJson(response, 200);
        response.body.should.deep.equal({
          data    : [],
          flash   : {},
          context : null
        });
      });

      it('reports the shipped email-disabled outcome without persisting an invitation', async function() {
        var response = await request('post', '/api/courses/' + course.id + '/invitations', {
          emailList : ['invitee@example.com']
        });

        expectJson(response, 200);
        response.body.should.deep.equal({
          message : 'Email is not configured. Course invitations cannot be sent.',
          flash   : {}
        });
        (await CourseInvitation.model.countDocuments({ courseId : course.id })).should.equal(0);
      });

      it('lists the exact serialized invitation fields', async function() {
        var invitation = await new CourseInvitation({
          courseId : course.id,
          email    : 'pending-route@example.com',
          token    : 'route123',
          status   : 'pending'
        }).save();
        invitationId = invitation.id;

        var response = await request('get', '/api/courses/' + course.id + '/invitations');

        expectJson(response, 200);
        response.body.data.should.deep.equal([{
          id     : invitationId,
          email  : 'pending-route@example.com',
          token  : 'route123',
          status : 'pending'
        }]);
        response.body.flash.should.deep.equal({});
        should.equal(response.body.context, null);
      });

      describe('with email configured at the controller seam', function() {
        var send;

        before(function() {
          mailerStubs.push(sinon.stub(mailer, 'isConfigured').returns(true));
          send = sinon.stub(mailer, 'send').resolves({ messageId : 'route-coverage' });
          mailerStubs.push(send);
        });

        beforeEach(function() {
          send.resetHistory();
        });

        it('preserves the measured acceptance of an email already used by a course member',
          async function() {
          // The membership assertion above proves this address is persisted in course.users. The route
          // nevertheless accepts it, sends the invitation and answers success; R-6 freezes that result.
          var response = await request('put',
            '/api/courses/' + course.id + '/invitations/' + invitationId + '/email', {
              email : defaults.routeCoverageOther.email
            });

          expectJson(response, 200);
          response.body.success.should.be.true;
          response.body.invitation.should.deep.equal({
            id     : invitationId,
            email  : defaults.routeCoverageOther.email,
            token  : 'route123',
            status : 'sent'
          });
          send.calledOnce.should.be.true;
          (await CourseInvitation.findById(invitationId)).email
            .should.equal(defaults.routeCoverageOther.email);
        });

        it('updates, sends and persists an invitation email', async function() {
          var response = await request('put',
            '/api/courses/' + course.id + '/invitations/' + invitationId + '/email', {
              email : 'updated-route@example.com'
            });

          expectJson(response, 200);
          response.body.success.should.be.true;
          response.body.invitation.should.deep.equal({
            id     : invitationId,
            email  : 'updated-route@example.com',
            token  : 'route123',
            status : 'sent'
          });
          send.calledOnce.should.be.true;
          send.firstCall.args[0].should.equal('updated-route@example.com');
          send.firstCall.args[1].should.equal('Trinket Invitation to route coverage course');
          send.firstCall.args[2].replyTo.should.equal(defaults.routeCoverage.email);
          send.firstCall.args[2].type.should.equal('course-invitation');

          var stored = await CourseInvitation.findById(invitationId);
          stored.email.should.equal('updated-route@example.com');
          stored.status.should.equal('sent');
          stored.sentOn.should.be.instanceof(Date);
        });

        it('resends the invitation and returns it to the sent state', async function() {
          var response = await request('put',
            '/api/courses/' + course.id + '/invitations/' + invitationId + '/resend', {
              status : 'resend'
            });

          expectJson(response, 200);
          response.body.success.should.be.true;
          response.body.invitation.status.should.equal('sent');
          response.body.invitation.email.should.equal('updated-route@example.com');
          send.calledOnce.should.be.true;
          (await CourseInvitation.findById(invitationId)).status.should.equal('sent');
        });

        it('deletes the invitation and returns the measured success envelope', async function() {
          var response = await request('del',
            '/api/courses/' + course.id + '/invitations/' + invitationId);

          expectJson(response, 200);
          response.body.should.deep.equal({
            success : true,
            flash   : {},
            context : null
          });
          should.not.exist(await CourseInvitation.findById(invitationId));
          invitationId = null;
        });
      });

      it('removes the course user and persists the absence', async function() {
        var response = await request('del',
          '/api/courses/' + course.id + '/users/' + other.id);

        expectJson(response, 200);
        response.body.should.deep.equal({
          success : true,
          flash   : {},
          context : null
        });

        var stored = await Course.findById(course.id);
        stored.users.map(function(user) {
          return String(user.userId);
        }).should.not.contain(other.id);
      });
    });

    describe('user and admin routes', function() {
      it('returns the exact public user-info shape', async function() {
        var response = await request('get', '/api/users/' + owner.id + '/info');

        expectJson(response, 200);
        response.body.should.deep.equal({
          username    : defaults.routeCoverage.username,
          avatar      : '/img/avatar-default.svg',
          email       : defaults.routeCoverage.email,
          displayName : defaults.routeCoverage.fullname,
          flash       : {},
          context     : null
        });
      });

      it('returns a JSON 404 for a valid but absent user id', async function() {
        var response = await request('get',
          '/api/users/' + new mongoose.Types.ObjectId() + '/info');

        expectJson(response, 404);
        response.body.should.deep.equal({
          statusCode : 404,
          error      : 'Not Found',
          message    : 'Not Found'
        });
      });

      it('updates a user setting and persists it', async function() {
        var response = await request('post', '/api/users/settings', {
          disableAceEditor : true
        });

        expectJson(response, 200);
        response.body.should.deep.equal({
          success : true,
          flash   : {},
          context : null
        });
        (await User.findById(owner.id)).settings.disableAceEditor.should.be.true;
      });

      it('keeps the admin missing-user branch at HTTP 200 with its failure message', async function() {
        await switchUser('admin');
        var response;

        try {
          response = await request('post',
            '/api/admin/user/' + new mongoose.Types.ObjectId(), {
              roles : []
            });
        }
        finally {
          flow.switchUser('routeCoverage');
        }

        expectJson(response, 200);
        response.body.message.should.equal('user not found');
        response.body.should.have.property('flash');
        response.body.should.not.have.property('success');
      });
    });
  });
};