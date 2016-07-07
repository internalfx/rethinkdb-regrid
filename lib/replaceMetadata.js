'use strict'

var co = require('co')

var _replaceMetadata = function (ctx, file_id, metadata) {
  return co(function *() {
    var result = yield ctx.r.table(ctx.conf.fileTable).get(file_id).update({metadata: metadata}).run()
    return result.replaced === 1 || result.unchanged === 1
  }).catch(function (err) {
    console.log(err.stack)
    throw err
  })
}

module.exports = _replaceMetadata
