var sinon  = require('sinon'),
    Q      = require('q'),
    mailer = require('../../lib/util/mailer');

module.exports = {
  mailer : mailer,
  stub   : function() {
    before(function() {
      sinon.stub(mailer, 'send').returns(Q.resolve());
    });

    after(function() {
      mailer.send.restore();
    });
  }
};
