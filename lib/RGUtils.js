module.exports = {

  writeStreamPromise (stream) {
    return new Promise(function (resolve, reject) {
      stream.on('finish', resolve)
      stream.on('error', reject)
    })
  },

  readStreamPromise (stream) {
    return new Promise(function (resolve, reject) {
      let buffers = []

      let done = function () {
        resolve(Buffer.concat(buffers))
      }

      stream.on('close', done)
      stream.on('end', done)
      stream.on('error', function (err) {
        reject(err)
      })
      stream.on('data', function (data) {
        buffers.push(data)
      })
    })
  }

}
