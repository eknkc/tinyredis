var EventEmitter = require('events').EventEmitter;
var Connection = require("./connection/connection.js");
var Sentinel = require("./connection/sentinel.js")
var util = require('util');
var commands = require("../commands.json");

util.inherits(Client, EventEmitter);

function Command(cmd, handler) {
  this.cmd = cmd;
  this.handler = handler;
};

function Queued(args, handler) {
  this.args = args;
  this.handler = handler;
}

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
    socketKeepAlive      : options.socketKeepAlive,
    retryDelay           : options.retryDelay
  }

  this.handlers = [];
  this.queue = [];

  if (host.sentinel)
    this.connection = new Sentinel(host.sentinel, this.connectionOptions);
  else
    this.connection = new Connection(host, this.connectionOptions);

  var self = this;

  self.connection.on("disconnect", function () {
    self.handlers.forEach(function (command) {
      command.handler(new Error("Server connection lost"));
    });

    self.handlers = [];
  });

  self.connection.on("connect", function () {
    var queue = self.queue.slice();

    self.queue = [];

    queue.forEach(function (queued) {
      self._send(queued.args, queued.handler);
    });
  });

  self.connection.on("data", function (err, response) {
    var command = self.handlers.shift()
    command.handler(err, response);
  });
}

Client.prototype.createNew = function(host, options) {
  return new Client(host || this.host, options || this.options);
};

Client.prototype._send = function(args, next) {
  if (this.connection.ended)
    return next(new Error("Client has been ended."));

  if (this.connection.write(args))
    this.handlers.push(new Command(args[0], next));
  else
    this.queue.push(new Queued(args, next));
}

Client.prototype.send = function() {
  var args = [].slice.call(arguments, 0)
    , next

  if (typeof args[args.length - 1] == 'function')
    next = args.pop();
  else
    next = function() {};

  if (!args.length)
    return next(new Error("No command provided."));

  args[0] = args[0].toUpperCase();
  this._send(args, next);
};

commands.forEach(function (cmd) {
  cmd = cmd.split(' ')[0];

  Client.prototype[cmd] = Client.prototype[cmd.toLowerCase()] = function() {
    var args = [cmd].concat(Array.prototype.slice.call(arguments, 0))
      , next

    if (typeof args[args.length - 1] == 'function')
      next = args.pop();
    else
      next = function() {};

    this._send(args, next);
  };
});

Client.prototype.end = function(err) {
  this.connection.end();
};

Client.prototype.quit = function(next) {
  this.connection.retryDelay = -1;
  this._send(["QUIT"], next);
}

module.exports = Client;
