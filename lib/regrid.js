'use strict'

const Promise = require('bluebird')
Promise.config({
  warnings: {
    wForgottenReturn: false
  }
})

const rgUtils = require('./RGUtils')
const Readable = require('stream').Readable
const Writable = require('stream').Writable
const crypto = require('crypto')
const toArray = require('stream-to-array')
const lruCache = require('lru-cache')

const defaultBucketOptions = {
  bucketName: 'fs',
  chunkSizeBytes: 1024 * 255,
  concurrency: 10,
  cacheSize: 400
}

let ReGrid = function (connOpts, bucketOptions) {
  let conf = Object.assign({}, defaultBucketOptions, bucketOptions)
  let fileTable = `${conf.bucketName}_files`
  let chunkTable = `${conf.bucketName}_chunks`
  let r = require('rethinkdbdash')(Object.assign({silent: true}, connOpts))
  let isCaching = conf.cacheSize > 0
  let cache

  let getFileKey = function (filename) {
    return `file-${filename}`
  }

  let fetchFileById = async function (id) {
    let fileKey = `file-${id}`
    let file

    if (isCaching) {
      file = cache.get(fileKey)
    }

    if (file == null) {
      file = await r.table(fileTable).get(id).default(null).run()
      if (file != null && isCaching) {
        cache.set(fileKey, file)
      }
    }

    return file
  }

  let fetchFileByName = async function (filename, revision = -1) {
    let fileKey = getFileKey(filename)
    let file

    if (revision === -1 && isCaching) {
      file = cache.get(fileKey)
    }

    if (file == null) {
      let revSteps
      let query = r.table(fileTable).between(['Complete', filename, r.minval], ['Complete', filename, r.maxval], {index: 'file_ix'})
      if (revision >= 0) {
        revSteps = revision
        query = query.orderBy({index: r.asc('file_ix')})
      } else {
        revSteps = (revision * -1) - 1
        query = query.orderBy({index: r.desc('file_ix')})
      }

      let files = await query.run()

      file = files[revSteps] || null

      if (file != null && revision === -1 && isCaching) {
        cache.set(fileKey, file)
      }
    }

    return file
  }

  let createChunkLoader = function (file, startNum, endNum) {
    let num = startNum
    let queueNum = startNum
    let queue = []

    let next = async function () {
      if (num > endNum) { return }

      while (queue.length < conf.concurrency && queueNum <= endNum) {
        let chunkKey = `chunk-${file.id}-${queueNum}`
        let chunk

        if (isCaching) {
          chunk = cache.get(chunkKey)
        }

        if (chunk != null) {
          queue.push({key: chunkKey, chunk: Promise.resolve(chunk), cached: true})
        } else {
          queue.push({key: chunkKey, chunk: r.table(chunkTable).getAll([file.id, queueNum], {index: 'chunk_ix'}).nth(0).default(null).run(), cached: false})
        }
        queueNum += 1
      }

      let chunkData = queue.shift()
      let chunk = await chunkData.chunk
      if (chunkData.cached === false && isCaching) {
        cache.set(chunkData.key, chunk)
      }

      num += 1
      return chunk
    }

    return {
      next
    }
  }

  let initBucket = async function () {
    var promises = []
    var tableList = await r.tableList()

    // Create tables if they don't exist.
    if (!tableList.includes(fileTable)) {
      promises.push(r.tableCreate(fileTable))
    }
    if (!tableList.includes(chunkTable)) {
      promises.push(r.tableCreate(chunkTable))
    }

    await Promise.all(promises)

    var result = await Promise.all([
      r.table(fileTable).indexList(),
      r.table(chunkTable).indexList()
    ])

    promises = []

    var fileIndexList = result[0]
    var chunkIndexList = result[1]

    // Create indexes if they don't exist.
    if (!fileIndexList.includes('file_ix')) {
      promises.push(r.table(fileTable).indexCreate('file_ix', [r.row('status'), r.row('filename'), r.row('finishedAt')]))
    }

    if (!chunkIndexList.includes('chunk_ix')) {
      promises.push(r.table(chunkTable).indexCreate('chunk_ix', [r.row('file_id'), r.row('num')]))
    }

    await Promise.all(promises)

    await Promise.all([
      r.table(fileTable).indexWait('file_ix'),
      r.table(chunkTable).indexWait('chunk_ix')
    ])

    if (isCaching) {
      cache = lruCache({
        max: conf.cacheSize
      })

      r.table(fileTable).changes().run(function (err, cursor) {
        if (err) { console.log(err) }
        cursor.each(function (err, row) {
          if (err) {
            // console.log(err)
          } else {
            let newVal = row.new_val

            if (newVal) {
              if (newVal.status === 'Complete') {
                cache.del(getFileKey(newVal.filename))
              } else if (newVal.status === 'Deleted') {
                let fileKey = `file-${newVal.filename}`
                cache.del(fileKey)
              }
            }
          }
        })
      })
    }
  }

  let writeFile = async function (spec = {}) {
    spec = Object.assign({
      filename: null,
      buffer: null,
      chunkSizeBytes: conf.chunkSizeBytes,
      metadata: {}
    }, spec)

    if (spec.buffer == null) { throw new Error('buffer must not be null') }

    let wstream = createWriteStream(spec)
    let uploadPromise = rgUtils.writeStreamPromise(wstream)
    wstream.write(spec.buffer)
    wstream.end()
    await uploadPromise

    let file = await fetchFileByName(spec.filename)
    return file
  }

  let createWriteStream = function (spec = {}) {
    spec = Object.assign({
      filename: null,
      chunkSizeBytes: conf.chunkSizeBytes,
      metadata: {}
    }, spec)

    if (spec.filename == null) { throw new Error('filename must not be null') }

    let stream = new Writable()
    let chunkSizeBytes = spec.chunkSizeBytes
    let num = 0
    let currentChunk = Buffer.from([])
    let queue = []
    let hash = crypto.createHash('sha256')
    let size = 0
    let file

    stream._write = async function (chunk, encoding, cb) {
      size += chunk.length
      hash.update(chunk)

      if (file == null) {
        file = await r.table(fileTable).insert({
          filename: spec.filename,
          chunkSizeBytes: chunkSizeBytes,
          startedAt: new Date(),
          status: 'Incomplete',
          metadata: spec.metadata
        }, {returnChanges: 'always'}).run()
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
          await Promise.any(queue)
          queue = queue.filter((promise) => promise.isPending())
        }
      }

      cb()
    }

    stream._final = async function (cb) {
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

        await Promise.all(queue)

        file = await r.table(fileTable).get(file.id).update({
          finishedAt: new Date(),
          length: size,
          status: 'Complete',
          sha256: hash.digest('hex')
        }, {returnChanges: 'always'}).run()
        file = file.changes[0].new_val
      } else {
        // If we are here the file must be empty!
        file = await r.table(fileTable).insert({
          filename: spec.filename,
          finishedAt: new Date(),
          startedAt: new Date(),
          length: size,
          status: 'Complete',
          sha256: hash.digest('hex'),
          chunkSizeBytes: chunkSizeBytes,
          metadata: spec.metadata
        }, {returnChanges: 'always'}).run()
        file = file.changes[0].new_val
      }

      if (isCaching) {
        cache.set(getFileKey(spec.filename), file)
      }

      cb()
    }

    return stream
  }

  let getFile = async function (spec = {}) {
    spec = Object.assign({
      filename: null,
      revision: -1,
      id: null
    }, spec)

    if (spec.id == null && spec.filename == null) { throw new Error('filename or id required') }

    let file

    if (spec.id != null) {
      file = await fetchFileById(spec.id)
    } else {
      file = await fetchFileByName(spec.filename, spec.revision)
    }

    return file
  }

  let readFile = async function (spec = {}) {
    spec = Object.assign({
      seekStart: null,
      seekEnd: null
    }, spec)

    let file = await getFile(spec)

    if (file != null) {
      let stream = createReadStream({id: file.id, seekStart: spec.seekStart, seekEnd: spec.seekEnd})
      file.buffer = await rgUtils.readStreamPromise(stream)
    }

    return file
  }

  let createReadStream = function (spec = {}) {
    spec = Object.assign({
      id: null,
      seekStart: null,
      seekEnd: null
    }, spec)

    if (spec.id == null) { throw new Error('id must not be null') }

    let stream = new Readable()
    stream.toArray = toArray
    let hash = crypto.createHash('sha256')
    let num = 0
    let startNum = 0
    let startOffset = 0
    let endNum = null
    let endOffset = null
    let chunkSize
    let chunkLoader
    let file
    let verifyHash = (spec.seekStart == null && spec.seekEnd == null)
    let isDestroyed = false

    stream._destroy = function () {
      isDestroyed = true
    }

    stream._read = async function () {
      let chunk

      if (file == null) {
        file = await fetchFileById(spec.id)
        chunkSize = file.chunkSizeBytes
        if (spec.seekStart != null) {
          startNum = Math.floor(spec.seekStart / chunkSize)
          startOffset = spec.seekStart % chunkSize
        }

        spec.seekEnd = spec.seekEnd || file.length + 1
        endNum = Math.floor((spec.seekEnd) / chunkSize)
        endOffset = (spec.seekEnd % chunkSize) + 1

        num = startNum
        chunkLoader = createChunkLoader(file, startNum, endNum)
      }

      chunk = await chunkLoader.next()

      if (isDestroyed) { return }

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
            process.nextTick(function () {
              stream.emit('error', new Error('sha256 hash mismatch: File is likely corrupted!'))
            })
            return
          }
        }
        stream.push(null)
      }
    }

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
    let lastFile = {}

    stream._read = async function () {
      let nextPush

      if (cursor == null) {
        let query = r.table(fileTable).between(['Complete', r.minval], ['Complete', r.maxval], {index: 'file_ix'})

        if (options.sort === 'ASC') {
          query = query.orderBy({index: r.asc('file_ix')})
        } else if (options.sort === 'DESC') {
          query = query.orderBy({index: r.desc('file_ix')})
        }

        query = query.filter(r.row('filename').match(pattern))

        cursor = await query.run({cursor: true})
      }

      while (typeof nextPush === 'undefined') {
        let file

        try {
          file = await cursor.next()
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
    }

    return stream
  }

  let listFilename = function (filename, options = {}) {
    let stream = new Readable({objectMode: true})
    stream.toArray = toArray
    let cursor = null

    stream._read = async function () {
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

        cursor = await query.run({cursor: true})
      }

      try {
        file = await cursor.next()
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
    }

    return stream
  }

  let listMetadata = function (metadata, options = {}) {
    let stream = new Readable({objectMode: true})
    stream.toArray = toArray
    let cursor = null

    stream._read = async function () {
      let file

      if (cursor == null) {
        let query = r.table(fileTable).filter({metadata: metadata, status: 'Complete'})

        if (isFinite(options.skip)) {
          query = query.skip(options.skip)
        }

        if (isFinite(options.limit)) {
          query = query.limit(options.limit)
        }

        cursor = await query.run({cursor: true})
      }

      try {
        file = await cursor.next()
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
    }

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

  let deleteId = async function (fileId, options) {
    options = Object.assign({
      hard: false
    }, options)

    var result = await r.table(fileTable).get(fileId).update({status: 'Deleted', deletedAt: new Date()}).default({}).run()
    if (options.hard === true) {
      await r.table(chunkTable).between([fileId, r.minval], [fileId, r.maxval], {index: 'chunk_ix'}).delete()
      await r.table(fileTable).get(fileId).delete()
    }
    return result.replaced === 1
  }

  let renameId = async function (fileId, filename) {
    var result = await r.table(fileTable).get(fileId).update({filename: filename}).run()
    return result.replaced === 1 || result.unchanged === 1
  }

  let getMetadata = async function (fileId) {
    var result = await r.table(fileTable).get(fileId).run()
    return result
  }

  let replaceMetadata = async function (fileId, metadata) {
    var result = await r.table(fileTable).get(fileId).update({metadata: metadata}).run()
    return result.replaced === 1 || result.unchanged === 1
  }

  return Object.freeze({
    initBucket,
    writeFile,
    createWriteStream,
    getFile,
    readFile,
    createReadStream,
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
