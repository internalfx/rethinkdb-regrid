'use strict'

/* global describe */
/* global it */
/* global before */

var streamPromise = require('../lib/RGUtils').streamPromise
var Promise = require('bluebird')
var assert = require('chai').assert

var crypto = require('crypto')
var del = require('del')
var path = require('path')
var ReGrid = require('../index')
var fs = Promise.promisifyAll(require('fs'))
var co = require('co')

var r = require('rethinkdbdash')({db: 'test', silent: true})

describe('getFilename()', function () {
  var bucket

  before(function () {
    return co(function *() {
      var tables = yield r.tableList()
      var queries = tables.map(function (table) {
        return r.tableDrop(table).run()
      })
      yield Promise.all(queries)

      bucket = ReGrid({db: 'test'})
      yield bucket.initBucket()

      var testFiles = yield fs.readdirAsync(path.join(__dirname, 'files'))

      var uploads = []

      testFiles.forEach(function (testFile) {
        var filename = testFile.match(/\.jpg/) ? `/images/${testFile}` : `/docs/${testFile}`
        var stream = bucket.set(filename)
        uploads.push(streamPromise(stream))
        fs.createReadStream(path.join(__dirname, 'files', testFile)).pipe(stream)
      })

      yield Promise.all(uploads)
    })
  })

  it('should read a file correctly', function () {
    return co(function *() {
      var gridStream = bucket.getFilename('/images/saturnV.jpg')
      var fileStream = fs.createReadStream('./test/files/saturnV.jpg')

      var tasks = [streamPromise(gridStream), streamPromise(fileStream)]
      var gridHash = crypto.createHash('sha256')
      var fileHash = crypto.createHash('sha256')

      gridStream.on('data', function (data) {
        gridHash.update(data)
      })

      fileStream.on('data', function (data) {
        fileHash.update(data)
      })

      yield Promise.all(tasks)

      assert.equal(fileHash.digest('hex'), gridHash.digest('hex'))

      yield del('./testfile')
    })
  })
})
