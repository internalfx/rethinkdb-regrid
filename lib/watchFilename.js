'use strict'

var _watchFilename = function (bucket, filename) {
  return bucket.r.table(bucket.conf.fileTable)
  .between(['Complete', filename, bucket.r.minval], ['Complete', filename, bucket.r.maxval], {index: 'file_ix'})
  .changes()
  .run({cursor: true})
}

module.exports = _watchFilename
