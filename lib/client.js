var EventEmitter = require('events').EventEmitter;
var Connection = require("./connection.js");
var OfflineQueue = require("./offline-queue.js")
var manager = require("./manager.js")
var util = require('util');
var crypto = require("crypto");
var commands = require("../commands.json");

util.inherits(Client, EventEmitter);

var STATE = {
  OFFLINE: 'offline',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  ENDING: 'ending',
  ENDED: 'ended'
};

function Client(host, options) {
  if (!(this instanceof Client))
    return new Client(host, options);

  EventEmitter.call(this);

  options = options || {};
  host = host || 'localhost';

  this.host = host;
  this.options = options;

  this.connectionOptions = {
    socketNoDelay        : options.socketNoDelay,
    socketKeepAlive      : options.socketKeepAlive
  }

  this.state = STATE.OFFLINE;
  this.retryDelay = options.retryDelay || 2500;
  this.maxQueue = options.maxQueue || 0;

  this.offlineQueue = new OfflineQueue(this.maxQueue);

  if (host.sentinel)
    this.manager = new manager.Sentinel(this, host.sentinel);
  else
    this.manager = new manager.Static(this, host);

  this._connect();
}

Client.prototype.createNew = function(host, options) {
  return new Client(host || this.host, options || this.options);
};

Client.prototype._send = function(cmd, args, next) {
  if (this.state === STATE.ENDED)
    return next(new Error("Client has been ended."));

  if (this.state !== STATE.CONNECTED && this.state != STATE.ENDING) {
    if (!this.offlineQueue.push(cmd, args, next))
      next(new Error("Offline queue is full."));

    return;
  }

  this.connection.write(cmd, args, next);
}

Client.prototype.send = function(cmd) {
  var args = [].slice.call(arguments, 1)
    , next

  if (typeof args[args.length - 1] == 'function')
    next = args.pop();
  else
    next = function() {};

  this._send(cmd.toUpperCase(), args, next);
};

commands.forEach(function (cmd) {
  cmd = cmd.split(' ')[0];

  Client.prototype[cmd] = Client.prototype[cmd.toLowerCase()] = function() {
    var args = [].slice.call(arguments, 0)
      , next

    if (typeof args[args.length - 1] == 'function')
      next = args.pop();
    else
      next = function() {};

    Client.prototype._send.call(this, cmd, args, next);
  };
});

Client.prototype.end = function(err) {
  this.state = STATE.ENDED;

  if (this.reconnectTimer) {
    clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null;
  }

  if (this.connection) {
    this.connection.end();
    this.connection = null;
  }

  if (err)
    this.emit('error', err);

  this.emit('end');
};

Client.prototype.quit = function(next) {
  this.state = STATE.ENDING;
  this._send("QUIT", [], next);
}

Client.prototype._connect = function() {
  if (this.state !== STATE.OFFLINE)
    return;

  this.state = STATE.CONNECTING;

  var self = this;
  tryconnect();

  function fail(err) {
    if (self.state == STATE.ENDED) return;
    if (self.state == STATE.ENDING) return self.state = STATE.ENDED;

    self.emit("connection error", err);
    self.connection = null;
    self.reconnectTimer = setTimeout(tryconnect, self.retryDelay);
  }

  function tryconnect() {
    self.manager.createConnection(function (err, connection) {
      if (err) return fail(err);
      if (self.state == STATE.ENDED) return connection.end();

      self.connection = connection;
      self.state = STATE.CONNECTED;
      self.reconnectTimer = null;

      self.offlineQueue.drain(function (entry) {
        self.connection.write(entry.cmd, entry.args, entry.handler);
      });

      function ondata(type, message) {
        self.emit(type, message);
      }

      self.connection.on("data", ondata);

      self.connection.once("disconnect", function () {
        self.connection.removeListener("data", ondata);
        fail(new Error("Connection lost."));
      });
    });
  }
};

module.exports = Client;
