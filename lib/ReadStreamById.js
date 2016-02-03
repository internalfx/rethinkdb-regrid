'use strict'

var util = require('util')
var Readable = require('stream').Readable
var crypto = require('crypto')
var co = require('co')
// var Promise = require('bluebird')

var noErr = function (err) { err }

var ReadStreamById = function (ctx, file_id, options) {
  options = options || {}
  Readable.call(this)
  this.conf = ctx.conf
  this.r = ctx.r
  this.file_id = file_id
  this.options = options || {}
  this.queue = []
  this.hash = crypto.createHash('sha256')
  this.size = 0
  this.n = 0
  this.concurrency = this.conf.concurrency
}

util.inherits(ReadStreamById, Readable)

ReadStreamById.prototype._read = function () {
  co(function *() {
    if (!this.file) {
      this.file = yield this.r.table(this.conf.fileTable).get(this.file_id)
      this.cursor = yield this.r.table(this.conf.chunkTable).between([this.file.id, this.r.minval], [this.file.id, this.r.maxval], {index: 'filesid_n'}).orderBy({index: 'filesid_n'}).run({cursor: true})
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
        var chunk = yield item
      } catch (err) {
        if (err.message !== 'No more rows in the cursor.') {
          throw err
        }
      }
    }

    if (chunk) {
      this.n += 1
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
