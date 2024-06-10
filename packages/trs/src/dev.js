import compression from './lib/compression.js'
import { getServerAddresses, supportsSearchParams } from './lib/net-utils.js'
import { normalizeOptions } from './lib/normalize-options.js'
import { formatBootMessage } from './lib/output-utils.js'
import { injectTrs } from './lib/transform-html.js'
import * as devcert from 'devcert'
import { dim, yellow } from 'kolorist'
import { access, readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createSecureServer } from 'node:http2'
import { posix, resolve } from 'node:path'
import * as polka from 'polka'
import sirv from 'sirv'

/**
 * @type {<T>(obj: T) => T}
 */
const deepCloneJSON = obj => JSON.parse(JSON.stringify(obj))

/**
 * @param {Parameters<typeof server>[0] & OtherOptions} options
 */
export default async function dev(options = {}) {
  const cloned = deepCloneJSON(options)

  /** @type {string[]} */
  const configWatchFiles = []

  // Reload server on config changes
  const instance = await bootServer(cloned, configWatchFiles)

  // Get the actual port we used and use that from here on
  // to prevent us from picking another port on restart
  // eslint-disable-next-line require-atomic-updates
  options.port = await instance.resolvePort

  // eslint-disable-next-line no-negated-condition
  if (!supportsSearchParams) {
    // eslint-disable-next-line no-console
    console.log(yellow(`TRS: Automatic config reloading is not supported on Node <= 12.18.4`))
  } else {
    // eslint-disable-next-line no-console
    console.log('TODO: configWatchFiles => ', JSON.stringify(configWatchFiles))
  }
}

const injectTrsMiddleware = ({ root }) => {
  // eslint-disable-next-line consistent-return
  return async (req, res, next) => {
    // If we haven't intercepted the request it's safe to assume we need to inject trs.
    const path = posix.normalize(req.path)

    if (/\.[a-z]+$/iu.test(path) || path.startsWith('/@npm')) {
      return next()
    }

    try {
      const start = Date.now()
      const index = resolve(root, 'index.html')
      // eslint-disable-next-line unicorn/text-encoding-identifier-case
      const html = await readFile(index, 'utf-8')
      const result = await injectTrs(html)
      const time = Date.now() - start
      res.writeHead(200, {
        // eslint-disable-next-line unicorn/text-encoding-identifier-case
        'Content-Length': Buffer.byteLength(result, 'utf-8'),
        'Content-Type': 'text/html;charset=utf-8',
        'Server-Timing': `index.html;dur=${time}`,
      })
      res.end(result)
    } catch {
      next()
    }
  }
}

/**
 *
 * @param {Parameters<server>[0] & OtherOptions} options
 * @param {string[]} configWatchFiles
 * @returns {Promise<{ close: () => Promise<void>, resolvePort: Promise<number>}>}
 */
async function bootServer(options, configWatchFiles) {
  // eslint-disable-next-line require-atomic-updates, no-param-reassign
  options = await normalizeOptions(options, 'dev', configWatchFiles)

  options.middleware = [
    ...options.middleware,
    // trsMiddleware({
    //   ...options,
    //   onError: (err) => {},
    //   onChange: ({ changes, reload }) => {},
    // }),
    injectTrsMiddleware(options),
  ]

  const app = await server(options)

  let resolveActualPort
  const actualPort = new Promise(r => {
    resolveActualPort = r
  })

  const closeServer = makeCloseable(app.server)

  app.listen(options.port, options.host, () => {
    const addresses = getServerAddresses(app.server.address(), {
      host: options.host,
      https: app.http2,
    })

    const message = 'dev server running at:'
    process.stdout.write(formatBootMessage(message, addresses))

    // If the port was `0` than the OS picks a random
    // free port. Get the actual port here so that we
    // can reconnect to the same server from the client.
    const port = Number(app.server.address().port)
    resolveActualPort(port)
  })

  return {
    async close() {
      app.ws.broadcast({
        kind: 'restart',
        message: 'Server restarting...',
        type: 'info',
      })
      app.ws.close()
      await closeServer()
    },
    resolvePort: actualPort,
  }
}

/**
 * @param {object} options
 * @param {string} [options.cwd] Directory to serve
 * @param {string} [options.root] Virtual process.cwd
 * @param {string} [options.publicDir] A directory containing public files, relative to cwd
 * @param {string} [options.overlayDir] A directory of generated files to serve if present, relative to cwd
 * @param {polka.Middleware[]} [options.middleware] Additional Polka middlewares to inject
 * @param {boolean} [options.http2] Use HTTP/2
 * @param {boolean|number} [options.compress] Compress responses? Pass a `number` to set the size threshold.
 * @param {boolean} [options.optimize] Enable lazy dependency compression and optimization
 * @param {Record<string, string>} [options.alias] module or path alias mappings
 */
async function server({
  // eslint-disable-next-line no-unused-vars
  alias,
  compress = true,
  // eslint-disable-next-line no-unused-vars
  cwd,
  http2,
  middleware,
  // eslint-disable-next-line no-unused-vars
  optimize,
  overlayDir,
  root,
}) {
  try {
    await access(resolve(root, 'index.html'))
  } catch (error) {
    // eslint-disable-next-line sonarjs/no-nested-template-literals
    process.stderr.write(yellow(`Warning: missing "index.html" file ${dim(`(in ${root})`)}\n${error}`))
  }

  /** @type {CustomServer} */
  const app = polka({
    onError() {},
  })

  if (http2) {
    try {
      app.server = await createSecureHttpServer()
      app.https = true
    } catch (error) {
      // eslint-disable-next-line no-console
      console.log(`Unable to create HTTP2 server, falling back to HTTP1:\n${error}`)
    }
  }

  if (!app.server) {
    app.server = createServer()
    app.server.keepAliveTimeout = 60 * 1_000
    app.http2 = false
  }

  // app.ws = new WebSocketServer(app.server, '/_hmr')

  if (compress) {
    const threshold = compress === true ? 1_024 : compress
    app.use(compression({ brotli: true, level: 4, threshold }))
  }

  // Custom middlewares should always come first, similar to plugins
  if (middleware) {
    app.use(...middleware)
  }

  // app.use('/@npm', npmMiddleware({ alias, cwd, optimize }))

  // Chrome devtools often adds `?%20[sm]` to the url
  // to differentiate between sourcemaps
  app.use((req, res, next) => {
    if (req.url.endsWith('?%20[sm]')) {
      res.writeHead(302, {
        Location: req.url.replace('?%20[sm]', '.map'),
      })
      res.end()

      return
    }

    next()
  })

  if (overlayDir) {
    app.use(sirv(resolve(root || '', overlayDir), { dev: true }))
  }

  // SPA nav fallback
  app.use(
    sirv(root || '', {
      dev: true,
      etag: true,
      ignores: ['@npm'],
      single: true,
    }),
  )

  return app
}

async function createSecureHttpServer(options = {}) {
  const host = process.env.HOST || 'localhost'
  const { cert, key } = await devcert.certificateFor(host)

  return createSecureServer({
    allowHTTP1: true,
    cert,
    key,
    ...options,
  })
}

/**
 * Close all open connections to a server. Adapted from
 * https://github.com/vitejs/vite/blob/352cd397d8c9d2849690e3af0e84b00c6016b987/packages/vite/src/node/server/index.ts#L628
 * @param {import("http").Server | import("http2").Http2SecureServer} secureServer
 * @returns
 */
function makeCloseable(secureServer) {
  /** @type {Set<import('net').Socket>} */
  const sockets = new Set()
  let listened = false

  secureServer.on('connection', s => {
    sockets.add(s)
    s.on('close', () => sockets.delete(s))
  })

  secureServer.once('listening', () => (listened = true))

  return async () => {
    for (const s of sockets) s.destroy()
    if (!listened) return

    await new Promise((done, reject) => {
      secureServer.close(err => (err ? reject(err) : done()))
    })
  }
}
