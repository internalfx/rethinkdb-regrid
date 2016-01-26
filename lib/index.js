'use strict'

var co = require('co')
var omit = require('mout/object/omit')

var WriteStream = require('./WriteStream')

// Get all chunks
// r.db('aamcrm_dev').table('rethinkdbfs_chunks').between(["089c5ad0-338b-464f-a45d-0c7c687041a1", r.minval], ["089c5ad0-338b-464f-a45d-0c7c687041a1", r.maxval], {index: 'file_id_num'}).orderBy({index: "file_id_num"})

var includes = function (list, item) {
  return list.indexOf(item) !== -1
}

var defaultConf = {
  fileTable: 'rethinkdbfs_files',
  chunkTable: 'rethinkdbfs_chunks',
  chunkIndex: 'chunk_lookup',
  chunkSize: 1024 * 255,
  discovery: true,
  servers: [
    {host: 'localhost', port: 28015}
  ]
}

var RethinkDBFSBase = {

  prepDB () {
    var self = this
    return co(function *() {
      var tableList = yield self.r.tableList()

      // Create tables if they don't exist.
      if (!includes(tableList, self.conf.fileTable)) {
        yield self.r.tableCreate(self.conf.fileTable)
      }
      if (!includes(tableList, self.conf.chunkTable)) {
        yield self.r.tableCreate(self.conf.chunkTable)
      }

      var chunkIndexList = yield self.r.table(self.conf.chunkTable).indexList()

      // Create indexes if they don't exist.
      if (!includes(chunkIndexList, self.conf.chunkIndex)) {
        yield self.r.table(self.conf.chunkTable).indexCreate(self.conf.chunkIndex, [self.r.row('file_id'), self.r.row('num')])
        yield self.r.table(self.conf.chunkTable).indexWait(self.conf.chunkIndex)
      }
    }).catch(function (err) {
      console.log(err)
    })
  },

  writeFile (meta) {
    return new WriteStream(this.r, this.conf, meta)
  }

}

var RethinkDBFS = function (conf) {
  var obj = Object.create(RethinkDBFSBase)

  if (!conf || !conf.db) {
    throw new Error(`Minimum RethinkDBFS configuration is {db: 'dbname'}`)
  }

  obj.conf = Object.assign({}, defaultConf, conf)

  obj.r = require('rethinkdbdash')(omit(obj.conf, 'fileTable', 'chunkTable', 'chunkIndex', 'chunkSize'))

  return obj
}

module.exports = RethinkDBFS
