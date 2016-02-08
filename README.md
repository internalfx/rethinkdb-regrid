# ReGrid

ReGrid is a method of storing large files inside a RethinkDB database.

### Features

- **Reliable** - Files are replicated across the cluster, benefiting from RethinkDB's automatic failover.
- **Scalable** - Easily store large files in RethinkDB, distributed across the cluster.
- **Consistent** - Sha256 hashes are calculated when the file is written, and verified when read back out.

The [ReGrid spec](https://github.com/internalfx/regrid-spec) is an open specification free for anyone to implement and use.

[![npm version](https://img.shields.io/npm/v/rethinkdb-regrid.svg)](https://www.npmjs.com/package/rethinkdb-regrid) [![license](https://img.shields.io/npm/l/rethinkdb-regrid.svg)](https://github.com/internalfx/regrid/blob/master/LICENSE)

---

Special thanks to [Arthur Andrew Medical](http://www.arthurandrew.com/) for sponsoring this project.

Arthur Andrew Medical manufactures products with ingredients that have extensive clinical research for safety and efficacy. We specialize in Enzymes, Probiotics and Antioxidants.

---

## Installation

Supports node v4.0+

```
npm install --save rethinkdb-regrid
```

## TL;DR

```javascript
var ReGrid = require('rethinkdb-regrid')

var bucket = ReGrid({db: 'example'})

// initBucket creates tables and indexes if they don't exist, returns a promise.
bucket.initBucket().then(function () {
  // We are now ready to read and write files

  // create read stream from file
  var fileStream = fs.createReadStream('./bigvid.mp4')
  var dbStream = bucket.set('/videos/bigvid.mp4')

  // Pipe it to a ReGrid write stream
  fileStream.pipe(dbStream)

  dbStream.on('finish', function () {
    // File is now written to the database

    //Read the file and pipe it to a write stream to save the file back out to the file system.
    bucket.getFilename('/videos/bigvid.mp4').pipe(fs.createWriteStream('./copy-of-bigvid.mp4'))
  })

})
```

## API Documentation

There are mostly 4 types of operations that can be performed in ReGrid. Most method names start with a prefix that organizes the API.

| Prefix | Description |
| --- | --- |
| set | Writes a file to ReGrid. This function will return a binary write stream. |
| get | Reads a file from ReGrid. This function will return a binary read stream. |
| list | Lists available files in ReGrid. This function will return a read stream in `objectMode`. |
| watch | Watches files for changes in ReGrid. This function will return a changeFeed. |

### `ReGrid([connectionOptions, bucketOptions])`

##### Parameters

 - `connectionOptions`: connectionOptions is passed directly to [rethinkdbdash](https://github.com/neumino/rethinkdbdash)

 - `bucketOptions`:

| key | default | type | description |
|---|---|---|---|
| bucketName | `fs` | String | The name of the bucket. Table names are prefixed by this. |
| chunkSizeBytes | `1024 * 255` | Number | The default chunk size, in bytes. |
| concurrency | `10` | Number | When reading/writing a file, the number of concurrent queries in flight for a given stream. |

##### returns

`Bucket instance`

##### Example

```javascript
var ReGrid = require('rethinkdb-regrid')

var bucket = ReGrid({db: 'mydatabase'}, {bucketName: 'mybucket'})
```
