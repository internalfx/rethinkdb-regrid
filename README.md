# ReGrid

[![npm version](https://img.shields.io/npm/v/rethinkdb-regrid.svg)](https://www.npmjs.com/package/rethinkdb-regrid) [![license](https://img.shields.io/npm/l/rethinkdb-regrid.svg)](https://github.com/internalfx/regrid/blob/master/LICENSE) [![Build Status](https://travis-ci.org/internalfx/regrid.svg?branch=master)](https://travis-ci.org/internalfx/regrid)

ReGrid is a method of storing large files inside a RethinkDB database.

### Features

- **Reliable** - Files are replicated across the cluster, benefiting from RethinkDB's automatic failover.
- **Scalable** - Easily store large files in RethinkDB, distributed across the cluster.
- **Consistent** - Sha256 hashes are calculated when the file is written, and verified when read back out.
- **Realtime** - Watch the filesystem for changes and be notified immediately.

The [ReGrid spec](https://github.com/internalfx/regrid-spec) is an open specification free for anyone to implement and use.

#### Need help?

Join Slack [here](http://slack.rethinkdb.com/), then meet us on the [#regrid](https://rethinkdb.slack.com/messages/regrid/) channel.

[![Join Slack](http://slack.rethinkdb.com/badge.svg)](http://slack.rethinkdb.com/)

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

  // Watch a filename for changes
  bucket.watchFilename('/videos/myVid.mp4').then(function (cursor) {
    cursor.each((err, changes) => {
      console.log(changes)
    })
  })

  // Open a write stream to ReGrid
  var dbStream = bucket.upload('/videos/bigvid.mp4')

  // Create read stream from file and pipe it to a ReGrid write stream
  fs.createReadStream('./bigvid.mp4').pipe(dbStream)

  dbStream.on('finish', function () {
    // File is now written to the database

    //Read the file and pipe it to a write stream to save the file back out to the file system.
    bucket.downloadFilename('/videos/bigvid.mp4').pipe(fs.createWriteStream('./copy-of-bigvid.mp4'))
  })

})
```

## API Documentation

There are mostly 4 types of operations that can be performed in ReGrid. Most method names start with a prefix that organizes the API.

| Prefix | Description |
| --- | --- |
| upload | Writes a file to ReGrid. This function will return a binary write stream. |
| download | Reads a file from ReGrid. This function will return a binary read stream. |
| list | Lists available files in ReGrid. This function will return a read stream in `objectMode`. |
| watch | Watches files for changes in ReGrid. This function will return a [changeFeed](https://www.rethinkdb.com/api/javascript/changes/). |

---

### `ReGrid([connectionOptions, options])`

##### Parameters

| key | default | type | description |
| --- | --- | --- | --- |
| connectionOptions | {}| Object | `connectionOptions` is passed directly to [rethinkdbdash](https://github.com/neumino/rethinkdbdash) |
| options | {} | Object |  Optional parameters listed below |

###### Options

| key | default | type | description |
|---|---|---|---|
| bucketName | `fs` | String | The name of the bucket. Table names are prefixed by this. |
| chunkSizeBytes | `1024 * 255` | Number | The default chunk size, in bytes. |
| concurrency | `10` | Number | When reading/writing a file, the number of concurrent queries in flight for a given stream. |

##### returns

`Bucket instance`

##### Description

Creates a new ReGrid bucket instance.

##### Example

```javascript
var ReGrid = require('rethinkdb-regrid')

var bucket = ReGrid({db: 'mydatabase'}, {bucketName: 'mybucket'})
```

---

### `initBucket()`

##### Parameters

none

##### returns

Promise

##### Description

Verifies required tables and indexes exist and will create them if missing.

##### Example

```javascript
bucket.initBucket().then(function () {
  // bucket is ready for use.....
})
```

---

### `upload(filename[, options])`

##### Parameters

| key | default | type | description |
| --- | --- | --- | --- |
| filename | *required* | String | The name of the file. |
| options | {} | Object |  Optional parameters listed below |

###### Options

| key | default | type | description |
| --- | --- | --- | --- |
| chunkSizeBytes | The `chunkSizeBytes` setting for the bucket. | Number | Size of each chunk in bytes. |
| metadata | undefined | Object | Metadata object allowing you to store custom keys on files. |

##### returns

WriteStream

##### Description

Returns a write stream for storing a file in ReGrid.

##### Example

```javascript
var writeStream = bucket.upload('/videos/myVid.mp4', {
  chunkSizeBytes: 1024 * 255,
  metadata: {topic: 'cats'}
})

writeStream.on('finish', function () {
  // File is now stored in ReGrid
})

fs.createReadStream('./myVid.mp4').pipe(writeStream)
```

---

### `downloadId(fileId)`

##### Parameters

| key | default | type | description |
| --- | --- | --- | --- |
| fileId | *required* | String | The `id` of the file to retrieve |

##### returns

ReadStream

##### Description

Returns a read stream for reading a file from ReGrid.

##### Example

```javascript
var readStream = bucket.downloadId('ca608825-15c0-44b5-9bef-3ccabf061bab')

readStream.pipe(fs.createWriteStream('./mySavedVideo.mp4'))
```

---

### `downloadFilename(filename[, options])`

##### Parameters

| key | default | type | description |
| --- | --- | --- | --- |
| filename | *required* | String | The name of the file. |
| options | {} | Object |  Optional parameters listed below |

###### Options

| key | default | type | description |
| --- | --- | --- | --- |
| revision | `-1` | Number | The revision of the file to retrieve. If multiple files are uploaded under the same `filename` they are considered revisions. This may be a positive or negative number. (see chart below) |

###### How revision numbers work

If there are five versions of a file, the below chart would be the revision numbers

| Number | Description |
| --- | --- |
| `0` or `-5` | The original file |
| `1` or `-4` | The first revision |
| `2` or `-3` | The second revision |
| `3` or `-2` | The second most recent revision |
| `4` or `-1` | The most recent revision |

##### returns

ReadStream

##### Description

Returns a read stream for reading a file from ReGrid.

##### Example

```javascript
var newestVersion = bucket.downloadFilename('/videos/myVid.mp4')

var originalVersion = bucket.downloadFilename('/videos/myVid.mp4', {revision: 0})

newestVersion.pipe(fs.createWriteStream('./latest.mp4'))

originalVersion.pipe(fs.createWriteStream('./original.mp4'))
```

---

### `listRegex(pattern[, options])`

##### Parameters

| key | default | type | description |
| --- | --- | --- | --- |
| pattern | *required* | String | A regular expression matched against `filename` |
| options | {} | Object |  Optional parameters listed below |

###### Options

| key | default | type | description |
| --- | --- | --- | --- |
| sort | undefined | String | Sort results by `filename`. Valid values are `ASC` and `DESC`. |
| skip | undefined | Number | Skip results, useful for pagination. |
| limit | undefined | Number | Limit results. |
| showAll | false | Boolean | Show all revisions of matched files. Normally duplicate filenames are hidden and only the latest revision of each filename is returned. |

##### returns

ReadStream in `objectMode`. The stream emits objects, not buffers.

##### Description

Returns a read stream for finding files via regular expression. The stream emits objects as they are found, and can be a long running operation.

You may call `toArray()` on the returned stream to coerce it to an array. This may fail if the result set is very large. You may optionally call with limit to prevent this.

##### Example

```javascript
var videoStream = bucket.listRegex('^/videos/', {limit: 100})

videoStream.on('data', function (video) {
  console.log(video)
})

// OR
bucket.listRegex('^/videos/', {limit: 100}).toArray().then(function (videos) {
  // list the first 100 videos in the `/videos` directory
  console.log(videos)
})
```

---

### `listFilename(filename[, options])`

##### Parameters

| key | default | type | description |
| --- | --- | --- | --- |
| filename | *required* | String | The name of the file. |
| options | {} | Object |  Optional parameters listed below |

###### Options

| key | default | type | description |
| --- | --- | --- | --- |
| sort | undefined | String | Sort results by `finishedAt` (The date the file was uploaded). Valid values are `ASC` and `DESC`. |
| skip | undefined | Number | Skip results, useful for pagination. |
| limit | undefined | Number | Limit results. |

##### returns

ReadStream in `objectMode`. The stream emits objects, not buffers.

##### Description

Returns a read stream for finding files by filename. The stream emits objects as they are found, and can be a long running operation. However, this method uses an index and is very efficient.

You may call `toArray()` on the returned stream to coerce it to an array. This may fail if the result set is very large. You may optionally call with limit to prevent this.

##### Example

```javascript
var revisionStream = bucket.listFilename('/videos/editedVideo.mp4')

revisionStream.on('data', function (revision) {
  console.log(revision)
})

// OR
bucket.listFilename('/videos/editedVideo.mp4').toArray().then(function (revisions) {
  // list all revisions of '/videos/editedVideo.mp4'
  console.log(revisions)
})
```

---

### `listMetadata(metadata[, options])`

##### Parameters

| key | default | type | description |
| --- | --- | --- | --- |
| metadata | *required* | Object | An object to match against the `metadata` field of ReGrid files. |
| options | {} | Object |  Optional parameters listed below |

###### Options

| key | default | type | description |
| --- | --- | --- | --- |
| skip | undefined | Number | Skip results, useful for pagination. |
| limit | undefined | Number | Limit results. |

##### returns

ReadStream in `objectMode`. The stream emits objects, not buffers.

##### Description

Returns a read stream for finding files by metadata. The stream emits objects as they are found, and can be a long running operation.

You may call `toArray()` on the returned stream to coerce it to an array. This may fail if the result set is very large. You may optionally call with limit to prevent this.

##### Example

```javascript
var catStream = bucket.listMetadata({topic: 'cats'})

catStream.on('data', function (catVideo) {
  console.log(catVideo)
})

// OR
bucket.listMetadata({topic: 'cats'}).toArray().then(function (catVideos) {
  // list all videos under the 'cat' topic.
  console.log(catVideos)
})
```

---

### `watchRegex(pattern)`

##### Parameters

| key | default | type | description |
| --- | --- | --- | --- |
| pattern | *required* | String | A regular expression matched against filename. |

##### returns

A RethinkDB [changeFeed](https://www.rethinkdb.com/api/javascript/changes/) cursor

##### Description

Allows you to be notified of changes to a file if the `filename` property matches your regular expression.

##### Example

```javascript
bucket.watchRegex('^/videos').then(function (cursor) {
  cursor.each((err, video) => {
    console.log(video)
  })
})
```

---

### `watchFilename(filename)`

##### Parameters

| key | default | type | description |
| --- | --- | --- | --- |
| filename | *required* | String | The `filename` to watch for changes. |

##### returns

A RethinkDB [changeFeed](https://www.rethinkdb.com/api/javascript/changes/) cursor

##### Description

Allows you to be notified of changes to a file if the `filename` property `===` your string.

##### Example

```javascript
bucket.watchFilename('/videos/myVid.mp4').then(function (cursor) {
  cursor.each((err, changes) => {
    console.log(changes)
  })
})
```

---

### `watchMetadata(metadata)`

##### Parameters

| key | default | type | description |
| --- | --- | --- | --- |
| metadata | *required* | Object | The `metadata` to watch for changes. |

##### returns

A RethinkDB [changeFeed](https://www.rethinkdb.com/api/javascript/changes/) cursor

##### Description

Allows you to be notified of changes to a file if the `metadata` property matches your object.

##### Example

```javascript
bucket.watchMetadata({topic: 'cats'}).then(function (cursor) {
  cursor.each((err, catVideoChanges) => {
    console.log(catVideoChanges)
  })
})
```

---

### `delete(fileId)`

##### Parameters

| key | default | type | description |
| --- | --- | --- | --- |
| fileId | *required* | String | The `id` of the file to delete |

##### returns

Returns a promise that resolves to a boolean, depending on whether the operation was successful.

##### Description

Marks a file as deleted in ReGrid

##### Example

```javascript
bucket.delete('ca608825-15c0-44b5-9bef-3ccabf061bab')
```

---

### `rename(fileId, filename)`

##### Parameters

| key | default | type | description |
| --- | --- | --- | --- |
| fileId | *required* | String | The `id` of the file to rename. |
| filename | *required* | String | The new filename for the selected file. |

##### returns

Returns a promise that resolves to a boolean, depending on whether the operation was successful.

##### Description

Renames a file in ReGrid

##### Example

```javascript
bucket.rename('ca608825-15c0-44b5-9bef-3ccabf061bab', 'newName.mp4')
```

---

### `replaceMetadata(fileId, metadata)`

##### Parameters

| key | default | type | description |
| --- | --- | --- | --- |
| fileId | *required* | String | The `id` of the file to rename. |
| metadata | *required* | Object | The new metadata for the selected file. |

##### returns

Returns a promise that resolves to a boolean, depending on whether the operation was successful.

##### Description

Replaces a file's metadata in ReGrid

##### Example

```javascript
bucket.replaceMetadata('ca608825-15c0-44b5-9bef-3ccabf061bab', {topic: 'other cat stuff'})
```
