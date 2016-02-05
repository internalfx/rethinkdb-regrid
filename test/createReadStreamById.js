'use strict'

/* global describe */
/* global it */
/* global before */
/* global beforeEach */
/* global after */
/* global afterEach */

var streamPromise = function (stream) {
  return new Promise(function (resolve, reject) {
    stream.on('finish', resolve)
    stream.on('error', reject)
  })
}

var Promise = require('bluebird')
var assert = require('chai').assert

var path = require('path')
var ReGrid = require('../index')
var fs = Promise.promisifyAll(require('fs'))
var co = require('co')

var r = require('rethinkdbdash')({db: 'test', silent: true})

describe('createReadStreamById', function () {
  var dbfs

  before(function () {
    return co(function *() {
      var tables = yield r.tableList()
      var queries = tables.map(function (table) {
        return r.tableDrop(table).run()
      })
      yield Promise.all(queries)

      dbfs = ReGrid({db: 'test'})
      yield dbfs.initBucket()

      var testFiles = yield fs.readdirAsync(path.join(__dirname, 'files'))

      var uploads = []

      testFiles.forEach(function (testFile) {
        var filename = testFile.match(/\.jpg/) ? `/images/${testFile}` : `/docs/${testFile}`
        var stream = dbfs.createWriteStream(filename)
        uploads.push(streamPromise(stream))
        fs.createReadStream(path.join(__dirname, 'files', testFile)).pipe(stream)
      })

      yield Promise.all(uploads)
    })
  })

  it('should read a file correctly', function (done) {
    var writeStream = dbfs.createWriteStream('/docs/lipsum.txt')

    fs.createReadStream(path.join(__dirname, 'files', 'lipsum.txt')).pipe(writeStream)

    writeStream.on('finish', function () {
      r.table('fs_files').filter({filename: '/docs/lipsum.txt'}).nth(0).without('finishedAt', 'startedAt', 'id').default(null).run().then(function (file) {
        file = JSON.stringify(file)
        assert.equal(file, `{"chunkSizeBytes":261120,"filename":"/docs/lipsum.txt","length":1417,"sha256":"1748f5745c3ef44ba4e1f212069f6e90e29d61bdd320a48c0b06e1255864ed4f","status":"Complete"}`)
        done()
      })
    })
  })

})
