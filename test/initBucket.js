'use strict'

/* global describe */
/* global it */
/* global before */
/* global beforeEach */
/* global after */
/* global afterEach */

var assert = require('chai').assert

var ReGrid = require('../index')
var fs = require('fs')
var co = require('co')
var Promise = require('bluebird')

var r = require('rethinkdbdash')({db: 'test', silent: true})

describe('initBucket', function () {
  before(function () {
    return co(function *() {
      var tables = yield r.tableList()
      var queries = tables.map(function (table) {
        return r.tableDrop(table).run()
      })
      yield Promise.all(queries)
    })
  })

  describe('using defaults', function () {
    var dbfs

    before(function () {
      dbfs = ReGrid({db: 'test'})
      return dbfs.initBucket()
    })

    it('should create correct tables', function () {
      return co(function *() {
        var tables = yield r.tableList()
        assert.includeMembers(tables, ['fs_chunks', 'fs_files'])
      })
    })

    it('should create correct files indexes', function () {
      return co(function *() {
        var indexes = yield r.table('fs_files').indexStatus()
        var file_ix = indexes.filter((idx) => idx.index === 'file_ix')
        assert.equal(file_ix[0].query, `indexCreate('file_ix', function(var1) { return r.expr([r.row("status"), r.row("filename"), r.row("finishedAt")]); })`)
      })
    })

    it('should create correct chunks indexes', function () {
      return co(function *() {
        var indexes = yield r.table('fs_chunks').indexStatus()
        var chunk_ix = indexes.filter((idx) => idx.index === 'chunk_ix')
        assert.equal(chunk_ix[0].query, `indexCreate('chunk_ix', function(var2) { return r.expr([r.row("file_id"), r.row("num")]); })`)
      })
    })
  })

  describe('using custom bucket name', function () {
    var dbfs
    var bucketName = Math.random().toString(36).substring(7)

    before(function () {
      dbfs = ReGrid({db: 'test'}, {bucketName: bucketName})
      return dbfs.initBucket()
    })

    it('should create correct tables', function () {
      return co(function *() {
        var tables = yield r.tableList()
        assert.includeMembers(tables, ['fs_chunks', 'fs_files'])
      })
    })

    it('should create correct files indexes', function () {
      return co(function *() {
        var indexes = yield r.table('fs_files').indexStatus()
        var file_ix = indexes.filter((idx) => idx.index === 'file_ix')
        assert.equal(file_ix[0].query, `indexCreate('file_ix', function(var1) { return r.expr([r.row("status"), r.row("filename"), r.row("finishedAt")]); })`)
      })
    })

    it('should create correct chunks indexes', function () {
      return co(function *() {
        var indexes = yield r.table('fs_chunks').indexStatus()
        var chunk_ix = indexes.filter((idx) => idx.index === 'chunk_ix')
        assert.equal(chunk_ix[0].query, `indexCreate('chunk_ix', function(var2) { return r.expr([r.row("file_id"), r.row("num")]); })`)
      })
    })
  })
})
