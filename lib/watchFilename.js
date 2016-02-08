'use strict'

var _watchFilename = function (bucket, filename, callback) {
  this.conf = bucket.conf
  this.r = bucket.r
  this.filename = filename

  this.r.table(this.conf.fileTable)
  .between(['Complete', this.filename, this.r.minval], ['Complete', this.filename, this.r.maxval], {index: 'file_ix'})
  .changes()
  .run({cursor: true}, function (err, cursor) {
    if (err) { throw err }
    cursor.each(callback)
  })
}

module.exports = _watchFilename
