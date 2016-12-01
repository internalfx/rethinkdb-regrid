'use strict'

var co = require('co')
var Promise = require('bluebird')
Promise.config({
  warnings: {
    wForgottenReturn: false
  }
})

// var omit = require('mout/object/omit')

var _upload = require('./upload')
var _downloadId = require('./downloadId')
var _downloadFilename = require('./downloadFilename')
var _listRegex = require('./listRegex')
var _listFilename = require('./listFilename')
var _listMetadata = require('./listMetadata')
var _watchRegex = require('./watchRegex')
var _watchFilename = require('./watchFilename')
var _watchMetadata = require('./watchMetadata')
var _delete = require('./delete')
var _rename = require('./rename')
var _replaceMetadata = require('./replaceMetadata')

var includes = function (list, item) {
  return list.indexOf(item) !== -1
}

var bucketOptions = {
  bucketName: 'fs',
  chunkSizeBytes: 1024 * 255,
  concurrency: 10
}

var ReGridBucket = {

  initBucket () {
    return co(function *() {
      var promises = []
      var tableList = yield this.r.tableList()

      // Create tables if they don't exist.
      if (!includes(tableList, this.conf.fileTable)) {
        promises.push(this.r.tableCreate(this.conf.fileTable))
      }
      if (!includes(tableList, this.conf.chunkTable)) {
        promises.push(this.r.tableCreate(this.conf.chunkTable))
      }

      yield Promise.all(promises)
      promises = []

      promises.push(this.r.table(this.conf.fileTable).indexList())
      promises.push(this.r.table(this.conf.chunkTable).indexList())

      var result = yield Promise.all(promises)
      promises = []

      var fileIndexList = result[0]
      var chunkIndexList = result[1]

      // Create indexes if they don't exist.
      if (!includes(fileIndexList, 'file_ix')) {
        promises.push(this.r.table(this.conf.fileTable).indexCreate('file_ix', [this.r.row('status'), this.r.row('filename'), this.r.row('finishedAt')]))
      }

      if (!includes(chunkIndexList, 'chunk_ix')) {
        promises.push(this.r.table(this.conf.chunkTable).indexCreate('chunk_ix', [this.r.row('file_id'), this.r.row('num')]))
      }

      yield Promise.all(promises)
      promises = []

      promises.push(this.r.table(this.conf.fileTable).indexWait('file_ix'))
      promises.push(this.r.table(this.conf.chunkTable).indexWait('chunk_ix'))

      yield Promise.all(promises)
    }.bind(this)).catch(function (err) {
      throw err
    })
  },

  upload (filename, options) {
    return new _upload(this, filename, options)
  },

  downloadId (file_id, options) {
    return new _downloadId(this, file_id, options)
  },

  downloadFilename (filename, options) {
    return new _downloadFilename(this, filename, options)
  },

  listRegex (pattern, options) {
    return new _listRegex(this, pattern, options)
  },

  listFilename (filename, options) {
    return new _listFilename(this, filename, options)
  },

  listMetadata (meta, options) {
    return new _listMetadata(this, meta, options)
  },

  watchRegex (pattern) {
    return new _watchRegex(this, pattern)
  },

  watchFilename (filename) {
    return new _watchFilename(this, filename)
  },

  watchMetadata (metadata) {
    return new _watchMetadata(this, metadata)
  },

  delete (file_id) {
    return _delete(this, file_id)
  },

  rename (file_id, filename) {
    return _rename(this, file_id, filename)
  },

  replaceMetadata (file_id, metadata) {
    return _replaceMetadata(this, file_id, metadata)
  }

}

var ReGrid = function (connOpts, bucketOpts) {
  var obj = Object.create(ReGridBucket)

  obj.conf = Object.assign({}, bucketOptions, bucketOpts)
  obj.conf.fileTable = `${obj.conf.bucketName}_files`
  obj.conf.chunkTable = `${obj.conf.bucketName}_chunks`

  obj.r = require('rethinkdbdash')(Object.assign({silent: true}, connOpts))

  return obj
}

module.exports = ReGrid
