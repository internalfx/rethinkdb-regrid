'use strict'

/* global describe */
/* global it */

var assert = require('chai').assert

var RethinkDBFS = require('../index')
var fs = require('fs')
var co = require('co')
var Promise = require('bluebird')

var r = require('rethinkdbdash')({db: 'test'})
var dbfs = RethinkDBFS({db: 'test'})

describe('initBucket', function () {
  it('should create tables and indexes when run', function () {

  })
})
