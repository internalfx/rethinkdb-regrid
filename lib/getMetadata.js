'use strict'

var co = require('co')

var _getMetadata = function (ctx, file_id) {
  return co(function *() {
    var result = yield ctx.r.table(ctx.conf.fileTable).get(file_id).run()
    return result
  }).catch(function (err) {
    console.log(err.stack)
    throw err
  })
}

module.exports = _getMetadata
