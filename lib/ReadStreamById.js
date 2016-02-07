'use strict'

var util = require('util')
var Readable = require('stream').Readable
var crypto = require('crypto')
var co = require('co')
// var Promise = require('bluebird')

var noErr = function (err) { err }

var ReadStreamById = function (ctx, file_id) {
  Readable.call(this)
  this.conf = ctx.conf
  this.r = ctx.r
  this.file_id = file_id
  this.queue = []
  this.hash = crypto.createHash('sha256')
  this.size = 0
  this.num = 0
  this.concurrency = this.conf.concurrency
}

util.inherits(ReadStreamById, Readable)

ReadStreamById.prototype._read = function () {
  co(function *() {
    var chunk

    if (!this.file) {
      this.file = yield this.r.table(this.conf.fileTable).get(this.file_id)
      this.cursor = yield this.r.table(this.conf.chunkTable).between([this.file.id, this.r.minval], [this.file.id, this.r.maxval], {index: 'chunk_ix'}).orderBy({index: 'chunk_ix'}).run({cursor: true})
    }

    let queueMax = (this.concurrency - this.queue.length)

    for (let i = 0; i < queueMax; i += 1) {
      let next = this.cursor.next()
      next.catch(noErr)
      this.queue.push(next)
    }

    var item = this.queue.shift()

    if (item) {
      try {
        chunk = yield item
      } catch (err) {
        if (err.message !== 'No more rows in the cursor.') {
          throw err
        }
      }
    }

    if (chunk) {
      this.num += 1
      this.hash.update(chunk.data)
      this.push(chunk.data)
    } else {
      var sha256 = this.hash.digest('hex')
      if (sha256 !== this.file.sha256) {
        throw new Error('sha256 hash mismatch: File is likely corrupted!')
      }
      this.push(null)
    }
  }.bind(this)).catch(function (err) {
    console.log(err.stack)
    throw err
  })
}

module.exports = ReadStreamById
