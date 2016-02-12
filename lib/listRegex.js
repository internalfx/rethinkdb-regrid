'use strict'

var util = require('util')
var Readable = require('stream').Readable
var co = require('co')
var toArray = require('stream-to-array')

var noErr = function (err) { err }

var _listRegex = function (bucket, pattern, options) {
  Readable.call(this, {objectMode: true})
  this.options = Object.assign({sort: 'DESC'}, options)
  this.conf = bucket.conf
  this.r = bucket.r
  this.pattern = pattern
  this.queue = []
  this.toArray = toArray
  this.count = 0
  this.pushed = 0
  this.lastFile = {}
}

util.inherits(_listRegex, Readable)

_listRegex.prototype._read = function () {
  co(function *() {
    var file

    if (!this.cursor) {
      let query = this.r.table(this.conf.fileTable).between(['Complete', this.r.minval], ['Complete', this.r.maxval])

      if (this.options.sort === 'ASC') {
        query = query.orderBy({index: this.r.asc('file_ix')})
      } else if (this.options.sort === 'DESC') {
        query = query.orderBy({index: this.r.desc('file_ix')})
      }

      query = query.filter(this.r.row('filename').match(this.pattern))

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
      if (file.filename !== this.lastFile.filename) {
        if (!isFinite(this.options.skip) || this.options.skip <= this.count) {
          if (!isFinite(this.options.limit) || this.options.limit > this.pushed) {
            if (this.options.sort === 'DESC') {
              this.push(file)
            } else if (this.options.sort === 'ASC') {
              if (typeof this.lastFile.filename !== 'undefined') { this.push(this.lastFile) }
            }
            this.pushed += 1
          }
        }
        this.count += 1
      }
      this.lastFile = file
    } else {
      if (this.options.sort === 'ASC') {
        this.push(this.lastFile)
      }
      this.push(null)
    }
  }.bind(this)).catch(function (err) {
    console.log(err.stack)
    throw err
  })
}

module.exports = _listRegex
