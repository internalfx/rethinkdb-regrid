'use strict'

var co = require('co')
// var omit = require('mout/object/omit')

var WriteStream = require('./WriteStream')
var ReadStream = require('./ReadStream')

var includes = function (list, item) {
  return list.indexOf(item) !== -1
}

var bucketOptions = {
  bucketName: 'fs',
  chunkSizeBytes: 1024 * 255
}

var RethinkDBFSBucket = {

  prepDB () {
    return co(function *() {
      var tableList = yield this.r.tableList()

      // Create tables if they don't exist.
      if (!includes(tableList, this.conf.fileTable)) {
        yield this.r.tableCreate(this.conf.fileTable)
      }
      if (!includes(tableList, this.conf.chunkTable)) {
        yield this.r.tableCreate(this.conf.chunkTable)
      }

      var fileIndexList = yield this.r.table(this.conf.fileTable).indexList()

      // Create indexes if they don't exist.
      if (!includes(fileIndexList, 'filename')) {
        yield this.r.table(this.conf.fileTable).indexCreate('filename')
        yield this.r.table(this.conf.fileTable).indexWait('filename')
      }

      var chunkIndexList = yield this.r.table(this.conf.chunkTable).indexList()

      if (!includes(chunkIndexList, this.conf.chunkIndex)) {
        yield this.r.table(this.conf.chunkTable).indexCreate(this.conf.chunkIndex, [this.r.row('files_id'), this.r.row('n')])
        yield this.r.table(this.conf.chunkTable).indexWait(this.conf.chunkIndex)
      }
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

  obj.r = require('rethinkdbdash')(connOpts)

  return obj
}

module.exports = RethinkDBFS
