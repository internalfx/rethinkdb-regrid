'use strict'

var _watchMetadata = function (bucket, metadata, callback) {
  this.conf = bucket.conf
  this.r = bucket.r
  this.metadata = metadata

  this.r.table(this.conf.fileTable)
  .filter({metadata: this.metadata, status: 'Complete'})
  .changes()
  .run({cursor: true}, function (err, cursor) {
    if (err) { throw err }
    cursor.each(callback)
  })
}

module.exports = _watchMetadata
