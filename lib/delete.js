'use strict'

var co = require('co')

var _delete = function (ctx, fileId) {
  return co(function *() {
    var result = yield ctx.r.table(ctx.conf.fileTable).get(fileId).update({status: 'Deleted', deletedAt: new Date()}).default({}).run()
    return result.replaced === 1
  }).catch(function (err) {
    console.log(err.stack)
    throw err
  })
}

module.exports = _delete
