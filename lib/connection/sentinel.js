var Base = require("./base.js");
var util = require('util');

util.inherits(Sentinel, Base);

function Sentinel(sentinel, options) {
  if (!(this instanceof Sentinel))
    return new Sentinel(host, options);

  Base.call(this);

  var Client = require("../client.js");

  this.name = sentinel.name;
  this.sentinels = sentinel.hosts.map(function (sentinel) {
    return new Client(sentinel);
  });
}

Sentinel.prototype._getHost = function(next) {
  var sentinels = this.sentinels.slice()
    , handled = false
    , max = sentinels.length
    , count = 0
    , self = this

  if (!max)
    return next(new Error("No sentinels configured."));

  function handle(err, host) {
    if (handled)
      return;

    count++;

    if (err || !host) {
      if (count == max) {
        handled = true;
        next(new Error("Unable to determine master from sentinels."));
      }
      return;
    }

    handled = true;

    next(null, {
      host: host[0],
      port: host[1]
    });
  }

  function query() {
    if (handled || !sentinels.length)
      return;

    sentinels.shift().send("SENTINEL", 'get-master-addr-by-name', self.name, handle);
    setTimeout(query, 300);
  }

  query();
};

Sentinel.prototype.end = function() {
  this.sentinels.forEach(function (sentinel) {
    sentinel.end();
  });

  this.sentinels = [];

  Base.prototype.end.call(this);
};

module.exports = Sentinel;
