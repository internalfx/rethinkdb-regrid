'use strict'

/* global describe */
/* global it */
/* global before */

var assert = require('chai').assert

var path = require('path')
var ReGrid = require('../index')
var Promise = require('bluebird')
var fs = Promise.promisifyAll(require('fs'))

var r = require('rethinkdbdash')({db: 'test', silent: true})

describe('writeFile()', function () {
  var bucket

  before(Promise.coroutine(function *() {
    var tables = yield r.tableList()
    var queries = tables.map(function (table) {
      return r.tableDrop(table).run()
    })
    yield Promise.all(queries)

    bucket = ReGrid({db: 'test'})
    yield bucket.initBucket()
  }))

  it('should write a file correctly', async function () {
    let data = await fs.readFileAsync(path.join(__dirname, 'files', 'lipsum.txt'))
    await bucket.writeFile({filename: '/docs/lipsum.txt', buffer: data})

    let file = await r.table('fs_files').filter({filename: '/docs/lipsum.txt'}).nth(0).without('finishedAt', 'startedAt', 'id').default(null).run()
    file = JSON.stringify(file)
    assert.equal(file, `{"chunkSizeBytes":261120,"filename":"/docs/lipsum.txt","length":1417,"metadata":{},"sha256":"1748f5745c3ef44ba4e1f212069f6e90e29d61bdd320a48c0b06e1255864ed4f","status":"Complete"}`)

    return true
  })
})
