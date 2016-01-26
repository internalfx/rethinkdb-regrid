
var util = require('util')
var FlushWritable = require('flushwritable')
var co = require('co')

var WriteStream = function (r, conf, meta) {
  FlushWritable.call(this)
  this.r = r
  this.conf = conf
  this.meta = meta
  this.num = 0
  this.currentChunk = new Buffer(0)
}

util.inherits(WriteStream, FlushWritable)

WriteStream.prototype._write = function (chunk, encoding, cb) {
  co(function *() {
    if (!this.file) {
      this.file = yield this.r.table(this.conf.fileTable).insert(this.meta, {returnChanges: true})
      this.file = this.file.changes[0].new_val
    }

    this.currentChunk = Buffer.concat([this.currentChunk, chunk])

    if (this.currentChunk.length >= this.conf.chunkSize) {
      yield this.r.table(this.conf.chunkTable).insert({
        file_id: this.file.id,
        num: this.num,
        data: this.currentChunk.slice(0, this.conf.chunkSize)
      }).run({durability: 'soft'})

      this.currentChunk = this.currentChunk.slice(this.conf.chunkSize)

      this.num += 1
    }

    cb()
  }.bind(this)).catch(function (err) {
    this.currentChunk = null
    console.log(err.stack)
    cb(err)
  })
}

WriteStream.prototype._flush = function (cb) {
  co(function *() {
    yield this.r.table(this.conf.chunkTable).insert({
      file_id: this.file.id,
      num: this.num,
      data: this.currentChunk
    }).run({durability: 'soft'})

    yield this.r.table(this.conf.chunkTable).sync()

    cb()
  }.bind(this)).catch(function (err) {
    console.log(err.stack)
    cb(err)
  })
}

module.exports = WriteStream
