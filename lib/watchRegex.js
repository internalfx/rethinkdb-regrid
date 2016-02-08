'use strict'

var _watchRegex = function (bucket, pattern, callback) {
  this.conf = bucket.conf
  this.r = bucket.r
  this.pattern = pattern

  this.r.table(this.conf.fileTable)
  .filter(this.r.and(this.r.row('status').eq('Complete'), this.r.row('filename').match(this.pattern)))
  .changes()
  .run({cursor: true}, function (err, cursor) {
    if (err) { throw err }
    cursor.each(callback)
  })
}

module.exports = _watchRegex
