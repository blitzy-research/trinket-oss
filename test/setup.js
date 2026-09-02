process.env.NODE_ENV = 'test';
process.env.NODE_CONFIG_PERSIST_ON_CHANGE = 'N';

var chai           = require('chai'),
    chaiAsPromised = require('chai-as-promised'),
    sinonChai      = require('sinon-chai');

chai.should();
chai.use(chaiAsPromised);
chai.use(sinonChai);

var sinon      = require('sinon'),
    config     = require('config'),
    redis      = require('redis'),
    redismock  = require('redis-mock');

sinon.stub(redis, 'createClient', redismock.createClient);

var app = require('../app.js'),
    db  = require('./helpers/db');

module.exports = {};
