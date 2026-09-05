var winston = require('winston'),
    config  = require('config');

var transports = [];

transports.push(
  new winston.transports.Console({
    level: config.app.log.level,
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.simple()
    )
  })
);

if (config.app.log.debug && config.app.log.debug.filename) {
  transports.push(
    new winston.transports.File({
      level: 'debug',
      filename: config.app.log.debug.filename
    })
  );
}

// Winston 3 uses createLogger instead of new Logger
module.exports = winston.createLogger({
  transports: transports
});
