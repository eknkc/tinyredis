var Connection = require("./connection.js");

function StaticManager(client, host) {
  this.client = client;
  this.host = host;
}

StaticManager.prototype.createConnection = function(next) {
  var connection = new Connection(this.host, this.client.connectionOptions);

  function ondisconnect () {
    detach();
    next(new Error("Unable to connect to Redis server."));
  }

  function onready() {
    detach();

    if (!connection.info || (connection.info.loading && connection.info.loading !== '0'))
      return next(new Error("Redis server is still loading."));

    next(null, connection);
  }

  function detach () {
    connection.removeListener('disconnect', ondisconnect);
    connection.removeListener('ready', onready);
  }

  connection.on("disconnect", ondisconnect);
  connection.on("ready", onready);
};

function SentinelManager(client, sentinel) {
  this.client = client;
  this.name = sentinel.name;

  this.sentinels = sentinel.hosts.map(function (sentinel) {
    return client.createNew(sentinel, { });
  });

  this.client.once("end", function () {
    this.end();
  }.bind(this));
}

SentinelManager.prototype.createConnection = function (next) {
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

    var sm = new StaticManager(self.client, {
      host: host[0],
      port: host[1]
    });

    sm.createConnection(function (err, conn) {
      if (err) return next(err);
      if (!conn.info || conn.info.role != 'master') return next(new Error("Unable to obtain master connection."))
      next(null, conn);
    });
  }

  function query() {
    if (handled || !sentinels.length)
      return;

    sentinels.shift().send("SENTINEL", 'get-master-addr-by-name', self.name, handle);
    setTimeout(query, 300);
  }

  query();
}

SentinelManager.prototype.end = function() {
  this.sentinels.forEach(function (sentinel) {
    sentinel.end();
  });

  this.sentinels = [];
  this.ended = true;
};

module.exports.Static = StaticManager;
module.exports.Sentinel = SentinelManager;
