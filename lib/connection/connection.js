var Base = require("./base.js");
var util = require('util');

util.inherits(Connection, Base);

function Connection(host, options) {
  if (!(this instanceof Connection))
    return new Connection(host, options);

  this.host = host;

  Base.call(this);
}

Connection.prototype._getHost = function(next) {
  next(null, this.host);
};

module.exports = Connection;
