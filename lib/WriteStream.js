
var util = require('util')
var FlushWritable = require('flushwritable')
var crypto = require('crypto')
var co = require('co')
var Promise = require('bluebird')

var WriteStream = function (ctx, filename, options) {
  FlushWritable.call(this)
  this.options = options || {}
  this.conf = ctx.conf
  this.r = ctx.r
  this.filename = filename
  this.chunkSizeBytes = this.options.chunkSizeBytes || this.conf.chunkSizeBytes
  this.num = 0
  this.currentChunk = new Buffer(0)
  this.queue = []
  this.hash = crypto.createHash('sha256')
  this.size = 0
}

util.inherits(WriteStream, FlushWritable)

WriteStream.prototype._write = function (chunk, encoding, cb) {
  co(function *() {
    this.size += chunk.length
    this.hash.update(chunk)

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

    if (this.currentChunk.length >= this.chunkSizeBytes) {
      this.queue.push(this.r.table(this.conf.chunkTable).insert({
        files_id: this.file.id,
        num: this.num,
        data: this.currentChunk.slice(0, this.chunkSizeBytes)
      }).run())
      this.currentChunk = this.currentChunk.slice(this.chunkSizeBytes)
      this.num += 1

      if (this.queue.length >= 10) {
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
    if (this.file) {
      this.queue.push(this.r.table(this.conf.chunkTable).insert({
        files_id: this.file.id,
        num: this.num,
        data: this.currentChunk
      }).run())

      this.queue.push(this.r.table(this.conf.fileTable).get(this.file.id).update({
        finishedAt: new Date(),
        length: this.size,
        status: 'Complete',
        sha256: this.hash.digest('hex')
      }).run())

      yield Promise.all(this.queue)
    } else {
      // If we are here the file must be empty!
      yield this.r.table(this.conf.fileTable).insert({
        filename: this.filename,
        finishedAt: new Date(),
        startedAt: new Date(),
        length: this.size,
        status: 'Complete',
        sha256: this.hash.digest('hex'),
        chunkSizeBytes: this.chunkSizeBytes,
        metadata: this.options.metadata
      }).run()
    }

    cb()
  }.bind(this)).catch(function (err) {
    console.log(err.stack)
    cb(err)
  })
}

module.exports = WriteStream
