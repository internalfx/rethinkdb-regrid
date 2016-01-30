'use strict'

var co = require('co')
// var omit = require('mout/object/omit')

var WriteStream = require('./WriteStream')
var ReadStream = require('./ReadStream')
var Promise = require('bluebird')

var includes = function (list, item) {
  return list.indexOf(item) !== -1
}

var bucketOptions = {
  bucketName: 'fs',
  chunkSizeBytes: 1024 * 255
}

var RethinkDBFSBucket = {

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
      if (!includes(fileIndexList, 'status_filename_finishedat')) {
        promises.push(this.r.table(this.conf.fileTable).indexCreate('status_filename_finishedat', [this.r.row('status'), this.r.row('filename'), this.r.row('finishedAt')]))
      }

      if (!includes(chunkIndexList, 'filesid_n')) {
        promises.push(this.r.table(this.conf.chunkTable).indexCreate('filesid_n', [this.r.row('files_id'), this.r.row('n')]))
      }

      yield Promise.all(promises)
      promises = []

      promises.push(this.r.table(this.conf.fileTable).indexWait('status_filename_finishedat'))
      promises.push(this.r.table(this.conf.chunkTable).indexWait('filesid_n'))

      yield Promise.all(promises)
    }.bind(this)).catch(function (err) {
      console.log(err.stack)
    })
  },

  createWriteStream (meta) {
    return new WriteStream(this.r, this.conf, meta)
  },

  createReadStream (meta) {
    return new ReadStream(this.r, this.conf, meta)
  }

}

var RethinkDBFS = function (connOpts, bucketOpts) {
  var obj = Object.create(RethinkDBFSBucket)

  obj.conf = Object.assign({}, bucketOptions, bucketOpts)
  obj.conf.fileTable = `${obj.conf.bucketName}_files`
  obj.conf.chunkTable = `${obj.conf.bucketName}_chunks`

  obj.r = require('rethinkdbdash')(connOpts)

  return obj
}

module.exports = RethinkDBFS
