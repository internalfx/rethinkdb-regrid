'use strict'

var util = require('util')
var Readable = require('stream').Readable
var co = require('co')
var toArray = require('stream-to-array')

var noErr = function (err) { err }

var _listMetadata = function (bucket, metadata, options) {
  Readable.call(this, {objectMode: true})
  this.options = Object.assign({}, options)
  this.conf = bucket.conf
  this.r = bucket.r
  this.metadata = metadata
  this.queue = []
  this.toArray = toArray
}

util.inherits(_listMetadata, Readable)

_listMetadata.prototype._read = function () {
  co(function *() {
    var file

    if (!this.cursor) {
      let query = this.r.table(this.conf.fileTable).filter({metadata: this.metadata, status: 'Complete'})

      if (isFinite(this.options.skip)) {
        query = query.skip(this.options.skip)
      }

      if (isFinite(this.options.limit)) {
        query = query.limit(this.options.limit)
      }

      this.cursor = yield query.run({cursor: true})
    }

    let queueMax = (this.conf.concurrency - this.queue.length)

    for (let i = 0; i < queueMax; i += 1) {
      let next = this.cursor.next()
      next.catch(noErr)
      this.queue.push(next)
    }

    var item = this.queue.shift()

    if (item) {
      try {
        file = yield item
      } catch (err) {
        if (err.message !== 'No more rows in the cursor.') {
          throw err
        }
      }
    }

    if (file) {
      this.push(file)
    } else {
      this.push(null)
    }
  }.bind(this)).catch(function (err) {
    console.log(err.stack)
    throw err
  })
}

module.exports = _listMetadata
