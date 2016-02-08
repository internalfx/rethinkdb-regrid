'use strict'

var co = require('co')

var _rename = function (ctx, file_id, filename) {
  return co(function *() {
    var result = yield ctx.r.table(ctx.conf.fileTable).get(file_id).update({filename: filename}).run()
    return result.replaced === 1 || result.unchanged === 1
  }).catch(function (err) {
    console.log(err.stack)
    throw err
  })
}

module.exports = _rename
