var EventEmitter = require('events').EventEmitter;
var util = require('util');
var net = require("net");
var hiredis = require("hiredis");

util.inherits(Base, EventEmitter);

function Base(options) {
  if (!(this instanceof Base))
    return new Base(host, options);

  options = options || {};

  this.socketNoDelay   = typeof options.socketNoDelay == 'undefined' ? true : !!options.socketNoDelay;
  this.socketKeepAlive = typeof options.socketKeepAlive == 'undefined' ? true : !!options.socketKeepAlive;
  this.retryDelay      = typeof options.retryDelay == 'undefined' ? 2000 : options.retryDelay;

  EventEmitter.call(this);

  setImmediate(function () {
    this._connect();
  }.bind(this));
}

Base.prototype.write = function(pack) {
  if (!this.stream)
    return false;

  var cmd = "*" + pack.length + "\r\n";

  for (var i = 0; i < pack.length; i++) {
    var item = pack[i];

    if (Buffer.isBuffer(item)) {
      if (cmd) {
        this.stream.write(cmd);
        cmd = "";
      }

      this.stream.write("$" + item.length + "\r\n");
      this.stream.write(item);
      this.stream.write("\r\n");
    } else {
      item = String(item);
      cmd += "$" + Buffer.byteLength(item) + "\r\n" + item + "\r\n";
    }
  };

  if (cmd)
    this.stream.write(cmd);

  return true;
};

Base.prototype.end = function(err) {
  if (self.ended)
    return;

  self.ended = true;

  if (self.stream) {
    self.stream.destroy();
    self.stream = null;
  }

  if (err)
    self.emit("error", err);

  self.emit("end");
};

Base.prototype._connect = function() {
  var self = this;

  if (self.ended)
    return;

  function fail (err) {
    if (self.retryDelay >= 0)
      return self.retryTimer = setTimeout(self._connect.bind(self), self.retryDelay);

    self.end(err);
  }

  self._getHost(function (err, host) {
    if (err) return fail(err);

    host = self._parseHost(host);

    var reader = new hiredis.Reader();
    var stream = net.createConnection(host.port, host.host);

    var onConnect = function() {
      self.stream = stream;
      self.emit("connect");
    }

    var onDisconnect = function() {
      self.emit("disconnect");

      stream.removeListener("connect", onConnect);
      stream.removeListener("error", onDisconnect);
      stream.removeListener("close", onDisconnect);
      stream.removeListener("end", onDisconnect);
      stream.removeListener("data", onData);
      stream.on("error", function() {});
      stream.destroy();

      self.stream = null;
      fail();
    };

    var onData = function(data) {
      reader.feed(data);

      var response;
      while(true) {
        try {
          response = reader.get();
        } catch(e) {
          return onDisconnect();
        }

        if (response === undefined)
          return;

        if (response && response.constructor == Error)
          self.emit("data", response);
        else
          self.emit("data", null, response);
      }
    };

    if (self.socketNoDelay)
      stream.setNoDelay(true);

    stream.setKeepAlive(self.socketKeepAlive);
    stream.setTimeout(0);

    stream
    .on("connect", onConnect)
    .on("error", onDisconnect)
    .on("close", onDisconnect)
    .on("end", onDisconnect)
    .on("data", onData);
  });
};

Base.prototype._getHost = function(next) {
  return next(new Error("Not implemented."));
};

Base.prototype._parseInfo = function(info) {
  var data = {};
  info.split(/\r?\n/g).forEach(function (line) {
    line = line.split(":");

    if (line.length > 1) {
      data[line[0]] = line.slice(1).join(":")
    }
  })
  return data;
};

Base.prototype._parseHost = function(val) {
  if (typeof val === 'string') {
    val = String(val).split(':');
    val = {
      host: val[0],
      port: +val[1] || 6379
    }
  }

  if (!val.port)
    val.port = 6379;

  return val;
}

module.exports = Base;
