'use strict'

var co = require('co')
// var Promise = require('bluebird')

var Delete = function (ctx, file_id) {
  return co(function *() {
    var result = yield ctx.r.table(ctx.conf.fileTable).get(file_id).delete()
    return result.deleted === 1
  }).catch(function (err) {
    console.log(err.stack)
    throw err
  })
}

module.exports = Delete
