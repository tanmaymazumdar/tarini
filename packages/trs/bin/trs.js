#!/usr/bin/env node

import dev from '../src/dev.js'
import sade from 'sade'

// Makes the script crash on unhandled rejections instead of silently
// ignoring them. In the future, promise rejections that are not handled will
// terminate the Node.js process with a non-zero exit code.
process.on('unhandledRejection', err => {
  throw err
})

const prog = sade('trs')

prog.version('0.1.0')

const bool = val => val !== false && !/false|0/u.test(val)

/**
 * @param {Error} err
 */
function catchException(err) {
  // eslint-disable-next-line no-console
  console.log(err)
  process.exit(1)
}

function run(prom) {
  prom.catch(catchException)
}

prog
  .command('dev', 'Start a development server', { default: true })
  .option('--public', 'Your web app root directory (default: ./public)')
  .option('--port, -p', 'HTTP port to listen on (default: $PORT or 8080)')
  .option('--host', 'HTTP host to listen on (default: localhost)')
  .option('--http2', 'Use HTTP/2 (default: false)')
  .option('--compress', 'Enable compression (default: enabled)')
  .action(opts => {
    opts.optimize = !/false|0/u.test(opts.compress)
    opts.compress = bool(opts.compress)

    run(dev(opts))
  })

prog.parse(process.argv)

process.setUncaughtExceptionCaptureCallback(catchException)
