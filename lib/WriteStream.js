
var util = require('util')
var FlushWritable = require('flushwritable')
var co = require('co')
var Promise = require('bluebird')

var WriteStream = function (ctx, filename, options) {
  FlushWritable.call(this)
  this.conf = ctx.conf
  this.r = ctx.r
  this.filename = filename
  this.options = options || {}
  this.chunkSizeBytes = this.options.chunkSizeBytes || this.conf.chunkSizeBytes
  this.n = 0
  this.currentChunk = new Buffer(0)
  this.queue = []
}

util.inherits(WriteStream, FlushWritable)

WriteStream.prototype._write = function (chunk, encoding, cb) {
  co(function *() {
    if (!this.file) {
      this.file = yield this.r.table(this.conf.fileTable).insert({
        filename: this.filename,
        chunkSizeBytes: this.chunkSizeBytes,
        startedAt: new Date(),
        status: 'Incomplete',
        metadata: this.options.metadata
      }, {returnChanges: true})
      this.file = this.file.changes[0].new_val
    }

    this.currentChunk = Buffer.concat([this.currentChunk, chunk])

    if (this.currentChunk.length >= this.conf.chunkSizeBytes) {
      this.queue.push(this.r.table(this.conf.chunkTable).insert({
        files_id: this.file.id,
        n: this.n,
        data: this.currentChunk.slice(0, this.conf.chunkSizeBytes)
      }).run())
      this.currentChunk = this.currentChunk.slice(this.conf.chunkSizeBytes)
      this.n += 1

      if (this.queue.length >= 50) {
        yield Promise.any(this.queue)

        this.queue = this.queue.filter((promise, idx, arr) => {
          promise.isPending()
        })
      }
    }

    cb()
  }.bind(this)).catch(function (err) {
    console.log(err.stack)
    cb(err)
  })
}

WriteStream.prototype._flush = function (cb) {
  co(function *() {
    this.queue.push(this.r.table(this.conf.chunkTable).insert({
      files_id: this.file.id,
      n: this.n,
      data: this.currentChunk
    }).run())

    yield Promise.all(this.queue)

    cb()
  }.bind(this)).catch(function (err) {
    console.log(err.stack)
    cb(err)
  })
}

module.exports = WriteStream
