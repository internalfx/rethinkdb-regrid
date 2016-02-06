'use strict'

/* global describe */
/* global it */
/* global before */
/* global beforeEach */
/* global after */
/* global afterEach */

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

  it('should read a file correctly', function () {
    return co(function *() {
      var regridFile = yield r.table('fs_files').filter({filename: '/images/saturnV.jpg'}).nth(0).run()

      var gridStream = dbfs.createReadStreamById(regridFile.id)
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
