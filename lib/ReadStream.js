
var util = require('util')
var Readable = require('stream').Readable
var co = require('co')

var ReadStream = function (r, conf, meta) {
  Readable.call(this)
  this.r = r
  this.conf = conf
  this.meta = meta
  this.num = 0
  // this.currentChunk = new Buffer(0)
}

util.inherits(ReadStream, Readable)

ReadStream.prototype._read = function () {
  co(function *() {
    if (!this.file) {
      this.file = yield this.r.table(this.conf.fileTable).filter({filename: this.meta.filename}).nth(0).default(null)
    }

    if (!this.file) {
      throw new Error('File not found')
    }

    var chunk = yield this.r.table(this.conf.chunkTable).getAll([this.file.id, this.num], {index: this.conf.chunkIndex}).nth(0).default(null)

    if (chunk) {
      this.num += 1
      this.push(chunk.data)
    } else {
      this.push(null)
    }
  }.bind(this)).catch(function (err) {
    console.log(err.stack)
  })
}

module.exports = ReadStream
