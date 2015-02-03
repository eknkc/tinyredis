function OfflineQueue(limit) {
  this.queue = [];

  if (limit)
    this.limit = limit;
};

function Command(cmd, args, handler) {
  this.cmd = cmd;
  this.args = args;
  this.handler = handler;
};

Command.prototype.toArray = function() {
  return [this.cmd].concat(this.args).concat([this.handler]);
};

OfflineQueue.prototype.push = function(cmd, args, next) {
  if (this.limit && this.queue.length >= this.limit)
    return false;

  this.queue.push(new Command(cmd, args, next));
  return true;
};

OfflineQueue.prototype.drain = function(fn) {
  var data = this.queue;
  this.queue = [];
  data.forEach(fn);
};

OfflineQueue.prototype.flush = function(err) {
  this.drain(function (entry) {
    entry.handler(err);
  });
};

module.exports = OfflineQueue;
