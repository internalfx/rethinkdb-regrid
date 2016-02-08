'use strict'

var util = require('util')
var Readable = require('stream').Readable
var crypto = require('crypto')
var co = require('co')
// var Promise = require('bluebird')

var noErr = function (err) { err }

var _getFilename = function (ctx, filename, options) {
  Readable.call(this)
  this.options = Object.assign({revision: -1}, options)
  this.conf = ctx.conf
  this.r = ctx.r
  this.filename = filename
  this.queue = []
  this.hash = crypto.createHash('sha256')
  this.num = 0
  this.concurrency = this.conf.concurrency
}

util.inherits(_getFilename, Readable)

_getFilename.prototype._read = function () {
  co(function *() {
    if (!this.file) {
      let revSteps
      let query = this.r.table(this.conf.fileTable).between(['Complete', this.filename, this.r.minval], ['Complete', this.filename, this.r.maxval], {index: 'file_ix'})
      if (this.options.revision >= 0) {
        revSteps = this.options.revision
        query = query.orderBy({index: this.r.asc('file_ix')})
      } else {
        revSteps = (this.options.revision * -1) - 1
        query = query.orderBy({index: this.r.desc('file_ix')})
      }

      let files = yield query.run()

      if (files.length === 0) { throw new Error('File not found!') }
      if (files.length < (revSteps + 1)) { throw new Error('File revision does not exist!') }

      this.file = files[revSteps]
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
        var chunk = yield item
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

module.exports = _getFilename
