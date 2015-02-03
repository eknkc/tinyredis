var EventEmitter = require('events').EventEmitter;
var util = require('util');
var net = require("net");
var hiredis = require("hiredis");

util.inherits(Connection, EventEmitter);

var STATE = {
  OFFLINE: "offline",
  CONNECTED: "connected",
  READY: "ready",
  ENDED: "ended"
}

function Command(cmd, handler) {
  this.cmd = cmd;
  this.handler = handler;
};

function Connection(host, options) {
  if (!(this instanceof Connection))
    return new Connection(host, options);

  EventEmitter.call(this);

  if (typeof host == 'string')
    host = parseHost(host);
  else if (host.host)
    host.port = host.port || 6379;
  else
    throw new Error("Unrecognized host information: " + host);

  this.state = STATE.OFFLINE;

  this.host            = host;
  this.socketNoDelay   = typeof options.socketNoDelay == 'undefined' ? true : !!options.socketNoDelay;
  this.socketKeepAlive = typeof options.socketKeepAlive == 'undefined' ? true : !!options.socketKeepAlive;

  this.stream = net.createConnection(this.host.port, this.host.host);

  if (this.socketNoDelay)
    this.stream.setNoDelay(true);

  this.stream.setKeepAlive(this.socketKeepAlive);
  this.stream.setTimeout(0);

  this.reader = new hiredis.Reader();

  this.commands = [];

  this._attachEvents();
}

Connection.prototype.write = function(cmd, pack, handler) {
  this.commands.push(new Command(cmd, handler));

  var cmd = "*" + (pack.length + 1) + "\r\n$" + cmd.length + "\r\n" + cmd + "\r\n";

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
};

Connection.prototype._onConnect = function() {
  this.state = STATE.CONNECTED;
  this.emit("connect");

  var self = this;

  self.write("INFO", [], function (err, data) {
    if (self.ended)
      return;

    if (err) {
      self.end();
    } else {
      self.info = parseInfo(data);
      self.emit('ready');
    }
  })
};

Connection.prototype._onDisconnect = function() {
  if (this.state == STATE.ENDED)
    return;

  this.state = STATE.ENDED;

  this.commands.forEach(function (command) {
    command.handler(new Error("Server connection lost"));
  }.bind(this));

  this.commands = [];

  this.stream.removeListener('connect', this.eventhandlers.connect);
  this.stream.removeListener('close', this.eventhandlers.disconnect);
  this.stream.removeListener('end', this.eventhandlers.disconnect);
  this.stream.removeListener('error', this.eventhandlers.disconnect);
  this.stream.removeListener('data', this.eventhandlers.data);

  this.stream.end();

  this.reader = null;
  this.emit("disconnect")
};

Connection.prototype._onData = function(data) {
  this.reader.feed(data);

  var response;
  while(true) {
    try {
      response = this.reader.get();
    } catch(e) {
      return this.stream.destroy();
    }

    if (response === undefined)
      return;

    if (this.subscriber && (response[0] == 'message' || response[0] == 'pmessage'))
      return this.emit("data", response[0], response);

    if (this.monitor)
      return this.emit("data", "data", response);

    var command = this.commands.shift()
      , cmd = command.cmd
      , handler = command.handler

    if (response && response.constructor == Error) {
      command.handler(response);
    } else {
      if (cmd === "SUBSCRIBE" || cmd === "UNSUBSCRIBE" || cmd === "PSUBSCRIBE" || cmd === "PUNSUBSCRIBE")
        this.subscriber = response[2] > 0;

      if (cmd === "MONITOR")
        this.monitor = true;

      command.handler(null, response);
    }
  }
};

Connection.prototype._attachEvents = function() {
  var self = this;

  this.eventhandlers = {
    connect: function () {
      self._onConnect();
    },
    disconnect: function(err) {
      self._onDisconnect(err);
    },
    data: function(data) {
      self._onData(data);
    }
  };

  this.stream.on('connect', this.eventhandlers.connect);
  this.stream.on('close', this.eventhandlers.disconnect);
  this.stream.on('end', this.eventhandlers.disconnect);
  this.stream.on('error', this.eventhandlers.disconnect);
  this.stream.on('data', this.eventhandlers.data);
};

Connection.prototype.end = function(err) {
  this.stream.end();
};

function parseInfo(info) {
  var data = {};
  info.split(/\r?\n/g).forEach(function (line) {
    line = line.split(":");

    if (line.length > 1) {
      data[line[0]] = line.slice(1).join(":")
    }
  })
  return data;
}

function parseHost(val) {
  val = String(val).split(':');

  return {
    host: val[0],
    port: +val[1] || 6379
  };
}

module.exports = Connection;
