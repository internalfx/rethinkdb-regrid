'use strict'

const Promise = require('bluebird')
Promise.config({
  warnings: {
    wForgottenReturn: false
  }
})

const Readable = require('stream').Readable
const FlushWritable = require('flushwritable')
const crypto = require('crypto')
const toArray = require('stream-to-array')

let includes = function (list, item) {
  return list.indexOf(item) !== -1
}

const bucketOptions = {
  bucketName: 'fs',
  chunkSizeBytes: 1024 * 255,
  concurrency: 10
}

let ReGrid = function (connOpts, bucketOpts) {
  let conf = Object.assign({}, bucketOptions, bucketOpts)
  let fileTable = `${conf.bucketName}_files`
  let chunkTable = `${conf.bucketName}_chunks`
  
  let r
  if(connOpts.r) {
    r = connOpts.r
  } else {
    r = require('rethinkdbdash')(Object.assign({silent: true}, connOpts))
  }

  let initBucket = Promise.coroutine(function *() {
    var promises = []
    var tableList = yield r.tableList()

    // Create tables if they don't exist.
    if (!includes(tableList, fileTable)) {
      promises.push(r.tableCreate(fileTable))
    }
    if (!includes(tableList, chunkTable)) {
      promises.push(r.tableCreate(chunkTable))
    }

    yield Promise.all(promises)
    promises = []

    promises.push(r.table(fileTable).indexList())
    promises.push(r.table(chunkTable).indexList())

    var result = yield Promise.all(promises)
    promises = []

    var fileIndexList = result[0]
    var chunkIndexList = result[1]

    // Create indexes if they don't exist.
    if (!includes(fileIndexList, 'file_ix')) {
      promises.push(r.table(fileTable).indexCreate('file_ix', [r.row('status'), r.row('filename'), r.row('finishedAt')]))
    }

    if (!includes(chunkIndexList, 'chunk_ix')) {
      promises.push(r.table(chunkTable).indexCreate('chunk_ix', [r.row('file_id'), r.row('num')]))
    }

    yield Promise.all(promises)
    promises = []

    promises.push(r.table(fileTable).indexWait('file_ix'))
    promises.push(r.table(chunkTable).indexWait('chunk_ix'))

    yield Promise.all([
      r.table(fileTable).indexWait('file_ix'),
      r.table(chunkTable).indexWait('chunk_ix')
    ])
  })

  let upload = function (filename, options = {}) {
    let stream = new FlushWritable()
    let chunkSizeBytes = options.chunkSizeBytes || conf.chunkSizeBytes
    let num = 0
    let currentChunk = new Buffer(0)
    let queue = []
    let hash = crypto.createHash('sha256')
    let size = 0
    let file

    stream._write = Promise.coroutine(function *(chunk, encoding, cb) {
      size += chunk.length
      hash.update(chunk)

      if (file == null) {
        file = yield r.table(fileTable).insert({
          filename: filename,
          chunkSizeBytes: chunkSizeBytes,
          startedAt: new Date(),
          status: 'Incomplete',
          metadata: options.metadata
        }, {returnChanges: true}).run()
        file = file.changes[0].new_val
      }

      currentChunk = Buffer.concat([currentChunk, chunk])

      if (currentChunk.length >= chunkSizeBytes) {
        queue.push(r.table(chunkTable).insert({
          file_id: file.id,
          num: num,
          data: currentChunk.slice(0, chunkSizeBytes)
        }).run())
        currentChunk = currentChunk.slice(chunkSizeBytes)
        num += 1

        if (queue.length >= 10) {
          yield Promise.any(queue)
          queue = queue.filter((promise) => promise.isPending())
        }
      }

      cb()
    })

    stream._flush = Promise.coroutine(function *(cb) {
      if (file) {
        let chunks = []
        while (currentChunk.length > chunkSizeBytes) {
          chunks.push(currentChunk.slice(0, chunkSizeBytes))
          currentChunk = currentChunk.slice(chunkSizeBytes)
        }
        chunks.push(currentChunk)

        for (let chunk of chunks) {
          queue.push(r.table(chunkTable).insert({
            file_id: file.id,
            num: num,
            data: chunk
          }).run())
          num += 1
        }

        yield Promise.all(queue)

        yield r.table(fileTable).get(file.id).update({
          finishedAt: new Date(),
          length: size,
          status: 'Complete',
          sha256: hash.digest('hex')
        }).run()
      } else {
        // If we are here the file must be empty!
        yield r.table(fileTable).insert({
          filename: filename,
          finishedAt: new Date(),
          startedAt: new Date(),
          length: size,
          status: 'Complete',
          sha256: hash.digest('hex'),
          chunkSizeBytes: chunkSizeBytes,
          metadata: options.metadata
        }).run()
      }

      cb()
    })

    return stream
  }

  let downloadId = function (fileId, options = {}) {
    options = Object.assign({
      seekStart: null,
      seekEnd: null
    }, options)

    let stream = new Readable()
    stream.toArray = toArray
    let hash = crypto.createHash('sha256')
    let num = 0
    let startNum = 0
    let startOffset = 0
    let endNum = null
    let endOffset = null
    let chunkSize
    let cursor
    let file
    let verifyHash = (options.seekStart == null && options.seekEnd == null)

    stream._read = Promise.coroutine(function *() {
      let chunk

      if (file == null) {
        file = yield r.table(fileTable).get(fileId)
        chunkSize = file.chunkSizeBytes
        if (options.seekStart != null) {
          startNum = Math.floor(options.seekStart / chunkSize)
          startOffset = options.seekStart % chunkSize
        }
        if (options.seekEnd != null) {
          endNum = Math.floor((options.seekEnd) / chunkSize)
          endOffset = (options.seekEnd % chunkSize) + 1
        }
        num = startNum
        if (endNum != null) {
          cursor = yield r.table(chunkTable).between([file.id, startNum], [file.id, endNum], {index: 'chunk_ix', rightBound: 'closed'}).orderBy({index: 'chunk_ix'}).run({cursor: true})
        } else {
          cursor = yield r.table(chunkTable).between([file.id, startNum], [file.id, r.maxval], {index: 'chunk_ix', rightBound: 'closed'}).orderBy({index: 'chunk_ix'}).run({cursor: true})
        }
      }

      try {
        chunk = yield cursor.next()
      } catch (err) {
        if (err.message !== 'No more rows in the cursor.') {
          throw err
        }
      }

      if (chunk) {
        if (verifyHash) { hash.update(chunk.data) }
        if (num === startNum && num === endNum) {
          stream.push(chunk.data.slice(startOffset, endOffset))
        } else if (num === startNum) {
          stream.push(chunk.data.slice(startOffset))
        } else if (num === endNum) {
          stream.push(chunk.data.slice(0, endOffset))
        } else {
          stream.push(chunk.data)
        }
        num += 1
      } else {
        if (verifyHash) {
          var sha256 = hash.digest('hex')
          if (sha256 !== file.sha256) {
            throw new Error('sha256 hash mismatch: File is likely corrupted!')
          }
        }
        stream.push(null)
      }
    })

    return stream
  }

  let downloadFilename = function (filename, options = {}) {
    options = Object.assign({
      revision: -1,
      seekStart: null,
      seekEnd: null
    }, options)

    let stream = new Readable({objectMode: true})
    stream.toArray = toArray
    let hash = crypto.createHash('sha256')
    let num = 0
    let startNum = 0
    let startOffset = 0
    let endNum = null
    let endOffset = null
    let chunkSize
    let cursor
    let file
    let verifyHash = (options.seekStart == null && options.seekEnd == null)

    stream._read = Promise.coroutine(function *() {
      let chunk

      if (file == null) {
        let revSteps
        let query = r.table(fileTable).between(['Complete', filename, r.minval], ['Complete', filename, r.maxval], {index: 'file_ix'})
        if (options.revision >= 0) {
          revSteps = options.revision
          query = query.orderBy({index: r.asc('file_ix')})
        } else {
          revSteps = (options.revision * -1) - 1
          query = query.orderBy({index: r.desc('file_ix')})
        }

        let files = yield query.run()

        if (files.length === 0) { throw new Error('File not found!') }
        if (files.length < (revSteps + 1)) { throw new Error('File revision does not exist!') }

        file = files[revSteps]
        chunkSize = file.chunkSizeBytes
        if (options.seekStart != null) {
          startNum = Math.floor(options.seekStart / chunkSize)
          startOffset = options.seekStart % chunkSize
        }
        if (options.seekEnd != null) {
          endNum = Math.floor((options.seekEnd) / chunkSize)
          endOffset = (options.seekEnd % chunkSize) + 1
        }
        num = startNum
        if (endNum != null) {
          cursor = yield r.table(chunkTable).between([file.id, startNum], [file.id, endNum], {index: 'chunk_ix', rightBound: 'closed'}).orderBy({index: 'chunk_ix'}).run({cursor: true})
        } else {
          cursor = yield r.table(chunkTable).between([file.id, startNum], [file.id, r.maxval], {index: 'chunk_ix', rightBound: 'closed'}).orderBy({index: 'chunk_ix'}).run({cursor: true})
        }
      }

      try {
        chunk = yield cursor.next()
      } catch (err) {
        if (err.message !== 'No more rows in the cursor.') {
          throw err
        }
      }

      if (chunk) {
        if (chunk.num !== num) {
          throw new Error('Chunk number mismatch: File is likely corrupted!')
        }
        if (verifyHash) { hash.update(chunk.data) }
        if (num === startNum && num === endNum) {
          stream.push(chunk.data.slice(startOffset, endOffset))
        } else if (num === startNum) {
          stream.push(chunk.data.slice(startOffset))
        } else if (num === endNum) {
          stream.push(chunk.data.slice(0, endOffset))
        } else {
          stream.push(chunk.data)
        }
        num += 1
      } else {
        if (verifyHash) {
          var sha256 = hash.digest('hex')
          if (sha256 !== file.sha256) {
            throw new Error('sha256 hash mismatch: File is likely corrupted!')
          }
        }
        stream.push(null)
      }
    })

    return stream
  }

  let listRegex = function (pattern, options = {}) {
    options = Object.assign({
      sort: 'DESC',
      showAll: false
    }, options)

    let stream = new Readable({objectMode: true})
    stream.toArray = toArray
    let cursor
    let skipped = 0
    let pushed = 0
    let lastFile

    stream._read = Promise.coroutine(function *() {
      let nextPush

      if (cursor == null) {
        let query = r.table(fileTable).between(['Complete', r.minval], ['Complete', r.maxval], {index: 'file_ix'})

        if (options.sort === 'ASC') {
          query = query.orderBy({index: r.asc('file_ix')})
        } else if (options.sort === 'DESC') {
          query = query.orderBy({index: r.desc('file_ix')})
        }

        query = query.filter(r.row('filename').match(pattern))

        cursor = yield query.run({cursor: true})
      }

      while (typeof nextPush === 'undefined') {
        let file

        try {
          file = yield cursor.next()
        } catch (err) {
          if (err.message !== 'No more rows in the cursor.') {
            throw err
          }
        }

        if (file) {
          if (options.showAll) {
            nextPush = file
          } else {
            if (file.filename !== lastFile.filename) {
              if (options.sort === 'DESC') {
                nextPush = file
              } else if (options.sort === 'ASC') {
                if (typeof lastFile.filename !== 'undefined') {
                  nextPush = lastFile
                }
              }
            }
          }
          lastFile = file
        } else {
          if (options.sort === 'ASC' && lastFile && lastFile.filename) {
            nextPush = lastFile
            lastFile = null
          } else {
            nextPush = null
          }
        }

        if (typeof nextPush !== 'undefined') {
          if (isFinite(options.skip) && options.skip > skipped) {
            nextPush = undefined
            skipped += 1
          }
        }

        if (typeof nextPush !== 'undefined') {
          if (isFinite(options.limit)) {
            if (options.limit > pushed) {
              pushed += 1
            } else {
              nextPush = null
            }
          }
        }
      }

      stream.push(nextPush)
    })
  }

  let listFilename = function (filename, options = {}) {
    let stream = new Readable({objectMode: true})
    stream.toArray = toArray
    let cursor = null

    stream._read = Promise.coroutine(function *() {
      let file

      if (cursor == null) {
        let query = r.table(fileTable).between(['Complete', filename, r.minval], ['Complete', filename, r.maxval], {index: 'file_ix'})

        if (options.sort === 'ASC') {
          query = query.orderBy({index: r.asc('file_ix')})
        } else if (options.sort === 'DESC') {
          query = query.orderBy({index: r.desc('file_ix')})
        }

        if (isFinite(options.skip)) {
          query = query.skip(options.skip)
        }

        if (isFinite(options.limit)) {
          query = query.limit(options.limit)
        }

        cursor = yield query.run({cursor: true})
      }

      try {
        file = yield cursor.next()
      } catch (err) {
        if (err.message !== 'No more rows in the cursor.') {
          throw err
        }
      }

      if (file) {
        stream.push(file)
      } else {
        stream.push(null)
      }
    })

    return stream
  }

  let listMetadata = function (metadata, options = {}) {
    let stream = new Readable({objectMode: true})
    stream.toArray = toArray
    let cursor = null

    stream._read = Promise.coroutine(function *() {
      let file

      if (cursor == null) {
        let query = r.table(fileTable).filter({metadata: metadata, status: 'Complete'})

        if (isFinite(options.skip)) {
          query = query.skip(options.skip)
        }

        if (isFinite(options.limit)) {
          query = query.limit(options.limit)
        }

        cursor = yield query.run({cursor: true})
      }

      try {
        file = yield cursor.next()
      } catch (err) {
        if (err.message !== 'No more rows in the cursor.') {
          throw err
        }
      }

      if (file) {
        stream.push(file)
      } else {
        stream.push(null)
      }
    })

    return stream
  }

  let watchRegex = function (pattern) {
    return r.table(fileTable)
    .filter(r.and(r.row('status').eq('Complete'), r.row('filename').match(pattern)))
    .changes()
    .run({cursor: true})
  }

  let watchFilename = function (filename) {
    return r.table(fileTable)
    .between(['Complete', filename, r.minval], ['Complete', filename, r.maxval], {index: 'file_ix'})
    .changes()
    .run({cursor: true})
  }

  let watchMetadata = function (metadata) {
    return r.table(fileTable)
    .filter({metadata: metadata, status: 'Complete'})
    .changes()
    .run({cursor: true})
  }

  let deleteId = Promise.coroutine(function *(fileId) {
    var result = yield r.table(fileTable).get(fileId).update({status: 'Deleted', deletedAt: new Date()}).default({}).run()
    return result.replaced === 1
  })

  let renameId = Promise.coroutine(function *(fileId, filename) {
    var result = yield r.table(fileTable).get(fileId).update({filename: filename}).run()
    return result.replaced === 1 || result.unchanged === 1
  })

  let getMetadata = Promise.coroutine(function *(fileId) {
    var result = yield r.table(fileTable).get(fileId).run()
    return result
  })

  let replaceMetadata = Promise.coroutine(function *(fileId, metadata) {
    var result = yield r.table(fileTable).get(fileId).update({metadata: metadata}).run()
    return result.replaced === 1 || result.unchanged === 1
  })

  return Object.freeze({
    initBucket,
    upload,
    downloadId,
    downloadFilename,
    listRegex,
    listFilename,
    listMetadata,
    watchRegex,
    watchFilename,
    watchMetadata,
    deleteId,
    renameId,
    getMetadata,
    replaceMetadata
  })
}

module.exports = ReGrid
