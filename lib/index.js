'use strict'

var co = require('co')
var Promise = require('bluebird')
// var omit = require('mout/object/omit')

var WriteStream = require('./WriteStream')
var ReadStreamById = require('./ReadStreamById')
var ReadStreamByFilename = require('./ReadStreamByFilename')
var FindFile = require('./FindFile')

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

  createWriteStream (filename, options) {
    return new WriteStream(this, filename, options)
  },

  createReadStreamById (file_id) {
    return new ReadStreamById(this, file_id)
  },

  createReadStreamByFilename (filename, options) {
    return new ReadStreamByFilename(this, filename, options)
  },

  findFile (pattern, options) {
    return new FindFile(this, pattern, options)
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
