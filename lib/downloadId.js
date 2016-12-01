'use strict'

var util = require('util')
var Readable = require('stream').Readable
var crypto = require('crypto')
var co = require('co')
// var Promise = require('bluebird')

var noErr = function (err) { err }

var _downloadId = function (ctx, file_id, options) {
  Readable.call(this)
  this.options = Object.assign({
    seekStart: null,
    seekEnd: null
  }, options)
  this.conf = ctx.conf
  this.r = ctx.r
  this.file_id = file_id
  this.hash = crypto.createHash('sha256')
  this.num = 0
}

util.inherits(_downloadId, Readable)

_downloadId.prototype._read = function () {
  co(function *() {
    let chunk
    let startNum = 0
    let startOffset = 0
    let endNum = null
    let endOffset = null
    let verifyHash = (this.options.seekStart == null && this.options.seekEnd == null)

    if (!this.file) {
      this.file = yield this.r.table(this.conf.fileTable).get(this.file_id)
      this.chunkSize = this.file.chunkSizeBytes
      if (this.options.seekStart != null) {
        startNum = Math.floor(this.options.seekStart / this.chunkSize)
        startOffset = this.options.seekStart % this.chunkSize
      }
      if (this.options.seekEnd != null) {
        endNum = Math.floor((this.options.seekEnd) / this.chunkSize)
        endOffset = (this.options.seekEnd % this.chunkSize) + 1
      }
      this.num = startNum
      if (endNum != null) {
        this.cursor = yield this.r.table(this.conf.chunkTable).between([this.file.id, startNum], [this.file.id, endNum], {index: 'chunk_ix', rightBound: 'closed'}).orderBy({index: 'chunk_ix'}).run({cursor: true})
      } else {
        this.cursor = yield this.r.table(this.conf.chunkTable).between([this.file.id, startNum], [this.file.id, this.r.maxval], {index: 'chunk_ix', rightBound: 'closed'}).orderBy({index: 'chunk_ix'}).run({cursor: true})
      }
    }

    try {
      chunk = yield this.cursor.next()
    } catch (err) {
      if (err.message !== 'No more rows in the cursor.') {
        throw err
      }
    }

    if (chunk) {
      if (verifyHash) { this.hash.update(chunk.data) }
      if (this.num === startNum && this.num === endNum) {
        this.push(chunk.data.slice(startOffset, endOffset))
      } else if (this.num === startNum) {
        this.push(chunk.data.slice(startOffset))
      } else if (this.num === endNum) {
        this.push(chunk.data.slice(0, endOffset))
      } else {
        this.push(chunk.data)
      }
      this.num += 1
    } else {
      if (verifyHash) {
        var sha256 = this.hash.digest('hex')
        if (sha256 !== this.file.sha256) {
          throw new Error('sha256 hash mismatch: File is likely corrupted!')
        }
      }
      this.push(null)
    }
  }.bind(this)).catch(function (err) {
    console.log(err.stack)
    throw err
  })
}

module.exports = _downloadId
