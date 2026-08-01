var sinon  = require('sinon'),
    mailer = require('../../lib/util/mailer');

module.exports = {
  mailer : mailer,
  stub   : function() {
    before(function() {
      sinon.stub(mailer, 'send').returns(Promise.resolve());
    });

    after(function() {
      mailer.send.restore();
    });
  }
};
