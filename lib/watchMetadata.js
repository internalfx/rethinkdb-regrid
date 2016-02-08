'use strict'

var _watchMetadata = function (bucket, metadata) {
  return bucket.r.table(bucket.conf.fileTable)
  .filter({metadata: metadata, status: 'Complete'})
  .changes()
  .run({cursor: true})
}

module.exports = _watchMetadata
