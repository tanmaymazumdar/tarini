import { ansi256, bold, cyan, dim, lightYellow } from 'kolorist'
import { inspect } from 'node:util'

// Taken from https://github.com/visionmedia/debug/blob/e47f96de3de5921584364b4ac91e2769d22a3b1f/src/node.js#L35
// prettier-ignore
const colors = [
	20, 21, 26, 27, 32, 33, 38, 39, 40, 41, 42, 43, 44, 45, 56, 57, 62, 63, 68,
	69, 74, 75, 76, 77, 78, 79, 80, 81, 92, 93, 98, 99, 112, 113, 128, 129, 134,
	135, 148, 149, 160, 161, 162, 163, 164, 165, 166, 167, 168, 169, 170, 171,
	172, 173, 178, 179, 184, 185, 196, 197, 198, 199, 200, 201, 202, 203, 204,
	205, 206, 207, 208, 209, 214, 215, 220, 221
]

// Taken from: https://github.com/visionmedia/debug/blob/e47f96de3de5921584364b4ac91e2769d22a3b1f/src/common.js#L41-L50
function selectColor(namespace) {
  let hash = 0

  for (let i = 0; i < namespace.length; i++) {
    // eslint-disable-next-line no-bitwise
    hash = (hash << 5) - hash + namespace.codePointAt(i)
    hash = Math.trunc(hash) // Convert to 32bit integer
  }

  return colors[Math.abs(hash) % colors.length]
}

let debugCliArg = false

/**
 * @param {boolean} enabled
 */
export function setDebugCliArg(enabled) {
  debugCliArg = enabled
}

export function hasDebugFlag() {
  return process.env.DEBUG === 'true' || process.env.DEBUG === '1' || debugCliArg
}

/**
 * Print namespaced log messages when the DEBUG environment
 * variable is set.
 * @param {string} namespace
 * @param {number} [color]
 * @returns {(...args: any[]) => void}
 */
export function debug(namespace, color = selectColor(namespace)) {
  const ns = ansi256(color)(`  ${namespace}  `)

  return (...args) => {
    if (hasDebugFlag()) {
      const str = args.map(arg => {
        const value = arg === null || typeof arg !== 'object' ? arg : inspect(arg, false, null, true)

        return value
          .split('\n')
          .map(line => ns + line)
          .join('\n')
      })

      // eslint-disable-next-line no-console
      console.log(...str)
    }
  }
}

/**
 * @param {string} addr
 */
function formatAddr(addr) {
  return cyan(addr.replace(/:\d+$/u, m => ':' + bold(m.slice(1))))
}

/**
 * @param {string} message
 * @param {string[]} addresses
 * @returns {string}
 */
export function formatBootMessage(message, addresses) {
  const intro = `\n  👩‍🚀 ${lightYellow('TRS')} ${message}\n\n`
  const local = `  ${dim('Local:')}   ${formatAddr(addresses[0])}\n`

  let network = dim(`  Network: (disabled, see --host)\n`)
  if (addresses.length > 1) {
    network =
      addresses
        .slice(1)
        .map(addr => `  ${dim('Network:')} ${formatAddr(addr)}`)
        .join('\n') + '\n'
  }

  return `${intro}${local}${network}\n`
}
