var sinon           = require('sinon'),
    should          = require('chai').should(),
    FeaturedCourses = require('../../../lib/models/featuredCourses');

describe('FeaturedCourses model', function() {
  var stubs = [];

  beforeEach(function() {
    return FeaturedCourses.model.deleteMany({ key : 'featured' });
  });

  afterEach(function() {
    stubs.forEach(function(stub) {
      stub.restore();
    });
    stubs = [];

    return FeaturedCourses.model.deleteMany({ key : 'featured' });
  });

  describe('getList', function() {
    it('resolves to an empty list and calls the optional callback once when no document exists', async function() {
      var callback = sinon.spy();
      var result = await FeaturedCourses.getList(callback);

      result.should.deep.equal([]);
      callback.calledOnce.should.be.true;
      callback.firstCall.args.should.deep.equal([null, []]);
    });

    it('returns the persisted list through both interfaces', async function() {
      await new FeaturedCourses({
        courses : [{ courseId : 'course-1', page : 'home' }]
      }).save();

      var callback = sinon.spy();
      var result = await FeaturedCourses.getList(callback);

      result.map(function(item) {
        return [item.courseId, item.page];
      }).should.deep.equal([['course-1', 'home']]);
      callback.calledOnce.should.be.true;
      should.equal(callback.firstCall.args[0], null);
      callback.firstCall.args[1].map(function(item) {
        return [item.courseId, item.page];
      }).should.deep.equal([['course-1', 'home']]);
    });
  });

  describe('addCourse', function() {
    it('creates the singleton document and reports its list once', async function() {
      var callback = sinon.spy();
      var result = await FeaturedCourses.addCourse('course-1', 'home', callback);

      result.map(function(item) {
        return [item.courseId, item.page];
      }).should.deep.equal([['course-1', 'home']]);
      callback.calledOnce.should.be.true;
      should.equal(callback.firstCall.args[0], null);
      callback.firstCall.args[1].map(function(item) {
        return [item.courseId, item.page];
      }).should.deep.equal([['course-1', 'home']]);
    });

    it('defaults a missing page to the empty string', async function() {
      var result = await FeaturedCourses.addCourse('course-1');

      result.map(function(item) {
        return [item.courseId, item.page];
      }).should.deep.equal([['course-1', '']]);
    });

    it('suppresses an exact duplicate course and page pair', async function() {
      await FeaturedCourses.addCourse('course-1', 'home');
      var result = await FeaturedCourses.addCourse('course-1', 'home');

      result.map(function(item) {
        return [item.courseId, item.page];
      }).should.deep.equal([['course-1', 'home']]);
    });

    it('keeps the same course on distinct pages as distinct entries', async function() {
      await FeaturedCourses.addCourse('course-1', 'home');
      var result = await FeaturedCourses.addCourse('course-1');

      result.map(function(item) {
        return [item.courseId, item.page];
      }).should.deep.equal([['course-1', 'home'], ['course-1', '']]);
    });
  });

  describe('removeCourse and moveCourse', function() {
    beforeEach(async function() {
      await FeaturedCourses.addCourse('course-1', 'home');
      await FeaturedCourses.addCourse('course-2', 'home');
    });

    it('removes only the matching course and page pair', async function() {
      var result = await FeaturedCourses.removeCourse('course-1', 'home');

      result.map(function(item) {
        return item.courseId;
      }).should.deep.equal(['course-2']);
    });

    it('moves the selected item using the supplied array indexes', async function() {
      var result = await FeaturedCourses.moveCourse('course-1', 'home', 0, 1);

      result.map(function(item) {
        return item.courseId;
      }).should.deep.equal(['course-2', 'course-1']);
    });
  });

  describe('the preserved empty-list callback contract', function() {
    it('removeCourse calls back twice and resolves undefined when the singleton is absent', async function() {
      await FeaturedCourses.model.deleteMany({ key : 'featured' });
      var callback = sinon.spy();
      var result = await FeaturedCourses.removeCourse('missing', 'home', callback);

      should.not.exist(result);
      callback.callCount.should.equal(2);
      callback.firstCall.args.should.deep.equal([null, []]);
      callback.secondCall.args.should.deep.equal([null, undefined]);
    });

    it('moveCourse calls back twice and resolves undefined when the singleton is absent', async function() {
      await FeaturedCourses.model.deleteMany({ key : 'featured' });
      var callback = sinon.spy();
      var result = await FeaturedCourses.moveCourse('missing', 'home', 0, 1, callback);

      should.not.exist(result);
      callback.callCount.should.equal(2);
      callback.firstCall.args.should.deep.equal([null, []]);
      callback.secondCall.args.should.deep.equal([null, undefined]);
    });

    it('moveCourse has the same defect when the singleton exists with an empty list', async function() {
      await new FeaturedCourses({ courses : [] }).save();
      var callback = sinon.spy();
      var result = await FeaturedCourses.moveCourse('missing', 'home', 0, 1, callback);

      should.not.exist(result);
      callback.callCount.should.equal(2);
      callback.firstCall.args.should.deep.equal([null, []]);
      callback.secondCall.args.should.deep.equal([null, undefined]);
    });
  });

  it('calls the callback with an error and rethrows the identical error through the promise', async function() {
    var expected = new Error('featured courses read failed');
    var callback = sinon.spy();
    stubs.push(sinon.stub(FeaturedCourses.model, 'findOne').rejects(expected));

    var rejected;
    try {
      await FeaturedCourses.getList(callback);
    }
    catch (err) {
      rejected = err;
    }

    rejected.should.equal(expected);
    callback.calledOnce.should.be.true;
    callback.firstCall.args.should.deep.equal([expected]);
  });
});
