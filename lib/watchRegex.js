'use strict'

var _watchRegex = function (bucket, pattern) {
  return bucket.r.table(bucket.conf.fileTable)
  .filter(bucket.r.and(bucket.r.row('status').eq('Complete'), bucket.r.row('filename').match(pattern)))
  .changes()
  .run({cursor: true})
}

module.exports = _watchRegex
