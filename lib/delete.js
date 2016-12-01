'use strict'

var co = require('co')

var _delete = function (ctx, file_id) {
  return co(function *() {
    var result = yield ctx.r.table(ctx.conf.fileTable).get(file_id).update({status: 'Deleted'}).default({}).run()
    return result.replaced === 1
  }).catch(function (err) {
    console.log(err.stack)
    throw err
  })
}

module.exports = _delete
