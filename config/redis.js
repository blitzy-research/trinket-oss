var config = require('config');

// Check if Redis is enabled
var redisEnabled = config.db && config.db.redis && config.db.redis.enabled !== false;

var client = null;
var clientPromise = null;

// Create Redis client with v4 API
async function createClientAsync() {
  if (!redisEnabled) {
    console.log('Redis is disabled, skipping connection');
    return null;
  }

  if (client && client.isOpen) {
    return client;
  }

  var redisConfig = config.db.redis.app;
  if (!redisConfig) {
    console.log('Redis app config not found, skipping connection');
    return null;
  }

  var redis = require('redis');
  var options = {
    socket: {
      host: redisConfig.host,
      port: redisConfig.port
    }
  };

  if (redisConfig.pass) {
    options.password = redisConfig.pass;
  }

  client = redis.createClient(options);

  client.on('error', function(err) {
    console.log(new Date().toString(), 'redis client error event:', err.message);
  });

  await client.connect();
  console.log('Redis client connected to', redisConfig.host + ':' + redisConfig.port);
  return client;
}

// Only initialize if Redis is enabled
if (redisEnabled) {
  clientPromise = createClientAsync().catch(function(err) {
    console.log('Failed to initialize redis client:', err.message);
  });
} else {
  clientPromise = Promise.resolve(null);
}

// Synchronous getter for backwards compatibility
function createClient() {
  if (!redisEnabled) {
    return null;
  }
  if (!client || !client.isOpen) {
    throw new Error('Redis client not connected. Use getClient() or await clientPromise first.');
  }
  return client;
}

// Async getter - waits for connection
async function getClient() {
  await clientPromise;
  return client;
}

module.exports = {
  createClient: createClient,
  getClient: getClient,
  clientPromise: clientPromise,
  isEnabled: function() { return redisEnabled; }
};
