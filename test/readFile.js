'use strict'

/* global describe */
/* global it */
/* global before */

var rgUtils = require('../lib/RGUtils')
var Promise = require('bluebird')
var assert = require('chai').assert

var crypto = require('crypto')
var del = require('del')
var path = require('path')
var ReGrid = require('../index')
var fs = Promise.promisifyAll(require('fs'))

var r = require('rethinkdbdash')({db: 'test', silent: true})

let checksum = function (data, algorithm, encoding) {
  return crypto
    .createHash(algorithm || 'sha256')
    .update(data, 'utf8')
    .digest(encoding || 'hex')
}

describe('readFile()', function () {
  var bucket

  before(Promise.coroutine(function *() {
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
      var stream = bucket.createWriteStream({filename: filename})
      uploads.push(rgUtils.writeStreamPromise(stream))
      fs.createReadStream(path.join(__dirname, 'files', testFile)).pipe(stream)
    })

    yield Promise.all(uploads)
  }))

  it('should read a file correctly', async function () {
    let gridData = await bucket.readFile({filename: '/images/saturnV.jpg'})
    let fileData = await fs.readFileAsync('./test/files/saturnV.jpg')

    assert.equal(checksum(gridData.buffer), checksum(fileData))

    await del('./testfile')

    return true
  })
})
