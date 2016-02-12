'use strict'

var Promise = require('bluebird')
require('bluebird-co')

var util = require('util')
var Readable = require('stream').Readable
var co = require('co')
var toArray = require('stream-to-array')

var noErr = function (err) { err }

var _listRegex = function (bucket, pattern, options) {
  Readable.call(this, {objectMode: true})
  this.options = Object.assign({sort: 'ASC', showAll: false}, options)
  this.conf = bucket.conf
  this.r = bucket.r
  this.pattern = pattern
  this.queue = []
  this.toArray = toArray
  this.skipped = 0
  this.pushed = 0
  this.lastFile = {}
  this.cursorPromise = this.getCursor()
}

util.inherits(_listRegex, Readable)

_listRegex.prototype.getCursor = Promise.coroutine(function *() {
  let query = this.r.table(this.conf.fileTable).between(['Complete', this.r.minval], ['Complete', this.r.maxval], {index: 'file_ix'})

  if (this.options.sort === 'ASC') {
    query = query.orderBy({index: this.r.asc('file_ix')})
  } else if (this.options.sort === 'DESC') {
    query = query.orderBy({index: this.r.desc('file_ix')})
  }

  query = query.filter(this.r.row('filename').match(this.pattern))

  this.cursor = yield query.run({cursor: true})
})

_listRegex.prototype._read = function () {
  co(function *() {
    var nextPush

    if (!this.cursor) {
      yield this.cursorPromise
    }

    while (typeof nextPush === 'undefined') {
      let file
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
        if (this.options.showAll) {
          nextPush = file
        } else {
          if (file.filename !== this.lastFile.filename) {
            if (this.options.sort === 'DESC') {
              nextPush = file
            } else if (this.options.sort === 'ASC') {
              if (typeof this.lastFile.filename !== 'undefined') {
                nextPush = this.lastFile
              }
            }
          }
        }
        this.lastFile = file
      } else {
        if (this.options.sort === 'ASC' && this.lastFile && this.lastFile.filename) {
          nextPush = this.lastFile
          this.lastFile = null
        } else {
          nextPush = null
        }
      }

      if (typeof nextPush !== 'undefined') {
        if (isFinite(this.options.skip) && this.options.skip > this.skipped) {
          nextPush = undefined
          this.skipped += 1
        }
      }

      if (typeof nextPush !== 'undefined') {
        if (isFinite(this.options.limit)) {
          if (this.options.limit > this.pushed) {
            this.pushed += 1
          } else {
            nextPush = null
          }
        }
      }
    }

    this.push(nextPush)
  }.bind(this)).catch(function (err) {
    console.log(err.stack)
    throw err
  })
}

module.exports = _listRegex
