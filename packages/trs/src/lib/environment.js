import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const NEWLINE_ALL = /\n|\r/u

/**
 * Parse env file format.
 * Example
 *   FOO="bar"
 *   Bob=
 *   BOOF='baz'
 *   BAR=123
 *   BOING="bar\\nboof\\n"
 * @param {string} str
 */
export function parseEnvFile(str) {
  const lines = str.split(NEWLINE_ALL)
  const env = {}

  for (const line of lines) {
    const ln = line.trim()

    if (!ln) break

    if (ln.startsWith('#')) continue

    // Split the line into key and value
    const [key, ...values] = ln.split('=')

    if (key && values.length > 0) {
      // Join the rest of the values in case the value contains '='
      let value = values.join('=').trim()

      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1)
        // eslint-disable-next-line sonarjs/no-duplicated-branches
      } else if (value.startsWith("'") && value.endsWith("'")) {
        value = value.slice(1, -1)
      }

      // Assign to env object
      env[key.trim()] = value
    }
  }

  return env
}

/**
 * Load additional environment variables from .env files.
 * @param {string} cwd
 * @param {string[]} envFiles
 * @param {string[]} [configWatchFiles]
 * @returns {Promise<Record<string, string>>}
 */
export async function readEnvFiles(cwd, envFiles, configWatchFiles) {
  const envs = await Promise.all(
    envFiles.map(async file => {
      const fileName = join(cwd, file)

      try {
        // eslint-disable-next-line unicorn/text-encoding-identifier-case
        const content = await readFile(fileName, 'utf-8')

        if (configWatchFiles) {
          configWatchFiles.push(fileName)
        }

        return parseEnvFile(content)
      } catch {
        // It's ok if you don't have env file :)
        return {}
      }
    }),
  )

  return envs.reduce((acc, obj) => Object.assign(acc, obj), {})
}
