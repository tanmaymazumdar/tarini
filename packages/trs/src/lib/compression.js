import zlib from 'node:zlib'

const MIMES = /text|javascript|\/json|xml/iu

const noop = () => {}

const getChunkSize = (chunk, enc) => (chunk ? Buffer.byteLength(chunk, enc) : 0)

/**
 * @param {object} [options]
 * @param {number} [options.threshold] Don't compress responses below this size (in bytes)
 * @param {number} [options.level] Gzip/Brotli compression effort (1-11, or -1 for default)
 * @param {boolean} [options.brotli] Generate and serve Brotli-compressed responses
 * @param {boolean} [options.gzip] Generate and serve Gzip-compressed responses
 * @param {RegExp} [options.mimes] Regular expression of response MIME types to compress (default: text|javascript|json|xml)
 * @returns {(req: Pick<import('http').IncomingMessage, 'method'|'headers'>, res: import('http').ServerResponse, next?:Function) => void}
 * @returns {import('polka').Middleware}
 */
export default function compression({
  threshold = 1_024,
  level = -1,
  brotli = false,
  gzip = true,
  mimes = MIMES,
} = {}) {
  const brotliOpts = (typeof brotli === 'object' && brotli) || {}
  const gzipOpts = (typeof gzip === 'object' && gzip) || {}

  // eslint-disable-next-line consistent-return
  return (req, res, next = noop) => {
    const accept = `String(req.headers['accept-encoding'])`
    const encoding = ((brotli && accept.match(/\bbr\b/u)) || (gzip && accept.match(/\bgzip\b/u)) || [])[0]

    // skip if no response body or no supported encoding
    if (req.method === 'HEAD' || !encoding) return next()

    /** @type {zlib.Gzip | zlib.BrtoliCompress} */
    let compress
    let pendingStatus
    /** @type {[string, Function][]?} */
    let pendingListeners = []
    let started = false
    let size = 0

    const { end, write, on, writeHead } = res

    function start() {
      started = true
      size = Math.trunc(res.getHeader('Content-Length')) || size
      const compressible = mimes.test(String(res.getHeader('Content-Type') || 'text/plain'))
      const cleartext = !res.getHeader('Content-Encoding')
      const listeners = pendingListeners || []

      if (compressible && cleartext && size >= threshold) {
        res.setHeader('Content-Encoding', encoding)
        res.removeHeader('Content-Length')

        if (encoding === 'br') {
          const params = {
            [zlib.constants.BROTLI_PARAM_QUALITY]: level,
            [zlib.constants.BROTLI_PARAM_SIZE_HINT]: size,
          }
          compress = zlib.createBrotliCompress({
            params: Object.assign(params, brotliOpts),
          })
        } else {
          compress = zlib.createGzip({ level, ...gzipOpts })
        }

        // backpressure
        compress.on('data', chunk => write.call(res, chunk) === false && compress.pause())
        on.call(res, 'drain', () => compress.resume())
        compress.on('end', () => end.call(res))
        for (const p of listeners) compress.on(...p)
      } else {
        pendingListeners = null
        for (const p of listeners) on.apply(res, p)
      }

      writeHead.call(res, pendingStatus || res.statusCode)
    }

    res.writeHead = function (status, reason, headers) {
      // eslint-disable-next-line no-param-reassign
      if (typeof reason !== 'string') [headers, reason] = [reason, headers]
      // eslint-disable-next-line guard-for-in
      if (headers) for (const i in headers) res.setHeader(i, headers[i])
      pendingStatus = status

      return this
    }

    // eslint-disable-next-line no-unused-vars
    res.write = function (chunk, enc, cb) {
      size += getChunkSize(chunk, enc)
      if (!started) start()
      if (!compress) return Reflect.apply(write, this, arguments)

      return compress.write(...arguments)
    }

    // eslint-disable-next-line no-unused-vars
    res.end = function (chunk, enc, cb) {
      if (arguments.length > 0 && typeof chunk !== 'function') {
        size += getChunkSize(chunk, enc)
      }

      if (!started) start()
      if (!compress) return Reflect.apply(end, this, arguments)

      return compress.end(...arguments)
    }

    res.on = function (type, listener) {
      if (!pendingListeners || type !== 'drain') on.call(this, type, listener)
      else if (compress) compress.on(type, listener)
      else pendingListeners.push([type, listener])

      return this
    }

    next()
  }
}
