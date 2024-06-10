import { readEnvFiles } from './environment.js'
import { isDirectory, isFile } from './fs-utils.js'
import { getPort, supportsSearchParams } from './net-utils.js'
import { debug, setDebugCliArg } from './output-utils.js'
import { mkdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * @param {any} x
 * @returns {x is import('react-script').Plugin}
 */
const isPlugin = x => Object.keys(x).some(key => typeof x[key] === 'function')

/**
 * @param {Partial<Options>} options
 * @param {Mode} mode
 * @param {string[]} [configWatchFiles]
 * @returns {Promise<Options>}
 */
export async function normalizeOptions(options, mode, configWatchFiles = []) {
  const cwd = process.cwd()

  const NODE_ENV =
    // eslint-disable-next-line no-negated-condition
    process.env.NODE_ENV || (mode !== 'dev' ? 'production' : 'development')
  const env = await readEnvFiles(
    cwd,
    ['.env', '.env.local', `.env.${NODE_ENV}`, `.env.${NODE_ENV}.local`],
    configWatchFiles,
  )

  const publicDir = options.public || 'public'
  const prevPublicFolder = publicDir

  const aliasFromPkg = await getAliasesFromPackageJson(options, cwd, configWatchFiles)
  // eslint-disable-next-line no-param-reassign
  configWatchFiles = aliasFromPkg.configWatchFiles

  let opts = {
    alias: aliasFromPkg.alias,
    cwd,
    env,
    features: { react: true },
    host: process.env.HOST || options.host || 'localhost',
    middleware: [],
    mode,
    out: resolve(cwd, options.out || '.cache'),
    output: [],
    overlayDir: resolve(cwd, options.out || '.cache'),
    plugins: [],
    prod: mode !== 'dev',
    public: publicDir,
    publicPath: options.publicPath || '/',
    root: cwd,
    // eslint-disable-next-line no-negated-condition
    ...(mode !== 'build' ? { port: await getPort(options) } : {}),
    // FIXME: We cannot support eagerly passing `options.public` into config AND
    // allowing plugins to lazily change them at the same time. Otherwise they'll
    // get out of sync. This is design issue of our current plugin system, not a
    // mere bug. The following snippet is a hotfix to get our docs site working
    // again.
    //
    // If the CWD has a public/ directory, all files are assumed to be within it.
    // From here, everything except node_modules and `out` are relative to public:
    ...(options.public !== '.' && (await isDirectory(join(cwd, publicDir))) ? { root: join(cwd, publicDir) } : {}),
  }

  const configFile = await getConfigsFromFile(cwd, configWatchFiles)
  // eslint-disable-next-line no-param-reassign
  configWatchFiles = configFile.configWatchFiles

  /**
   * @param {keyof import('react-script').Plugin} name
   * @param {import('react-script').Plugin[]} plugins
   */
  const runConfigHook = async (name, plugins) => {
    for (const plugin of plugins) {
      if (!plugin[name]) continue

      const res = await plugin[name](opts)

      if (res) {
        if (res.plugins) {
          throw new Error(`In plugin ${plugin.name}: Plugin method "${name}()" must not return a "plugins" property.`)
        }

        opts = mergeConfig(opts, res)
      }
    }
  }

  /**
   * @param {Options | import('react-script').Plugin | import('react-script').Plugin []} res
   */
  const applyConfigResult = res => {
    if (res) {
      if (Array.isArray(res) || isPlugin(res)) {
        opts.plugins = opts.plugins.concat(res)
      } else {
        opts = mergeConfig(opts, res)
      }
    }
  }

  if (configFile.custom) {
    if (configFile.custom.default) {
      const res =
        typeof configFile.custom.default === 'function'
          ? await configFile.custom.default(opts)
          : configFile.custom.default
      applyConfigResult(res)
    }

    if (configFile.custom[mode]) {
      const res = await configFile.custom[mode](opts)
      applyConfigResult(res)
    }
  }

  // Ensure the output directory exists so that writeFile() doesn't have to create it
  await mkdir(opts.out, { recursive: true }).catch(error => {
    // eslint-disable-next-line no-console
    console.warn(`Warning: Failed to create output directory: ${error.message}`)
  })

  // Sort plugins by "enforce" phase. Default is "normal".
  // The execution order is: "pre" -> "normal" -> "post"
  if (opts.plugins) {
    opts.plugins = opts.plugins
      .flat()
      // Filter out falsy values caused by conditionals
      .filter(Boolean)
      .sort((a, b) => {
        const aScore = a.enforce === 'post' ? 1 : a.enforce === 'pre' ? -1 : 0
        const bScore = b.enforce === 'post' ? 1 : b.enforce === 'pre' ? -1 : 0
        return aScore - bScore
      })
  }

  await runConfigHook('config', opts.plugins)
  await runConfigHook('configResolved', opts.plugins)

  // Filter out falsy values caused by conditionals
  opts.middleware = opts.middleware.filter(Boolean)

  // If the CWD has a public/ directory, all files are assumed to be within it.
  // From here, everything except node_modules and `out` are relative to public:
  if (prevPublicFolder !== opts.public && opts.public !== '.' && (await isDirectory(join(cwd, opts.public)))) {
    opts.root = join(cwd, opts.public)
  }

  // Add src as a default alias if such a folder is present
  if (!('src/*' in opts.alias)) {
    const maybeSrc = resolve(cwd, 'src')

    if (
      // Don't add src alias if we are serving from that folder already
      maybeSrc !== opts.root &&
      (await isDirectory(maybeSrc))
    ) {
      // eslint-disable-next-line require-atomic-updates
      opts.alias['src/*'] = maybeSrc
    }
  }

  // Resolve path-like alias mapping to absolute paths
  for (const name in opts.alias) {
    if (name.endsWith('/*')) {
      const value = opts.alias[name]
      opts.alias[name] = resolve(cwd, value)
    }
  }

  if (opts.debug) setDebugCliArg(true)

  debug('trs:config')(opts)

  return opts
}

async function getAliasesFromPackageJson(options, cwd, configWatchFiles) {
  const alias = options.alias || options.aliases || {}

  const pkgFile = resolve(cwd, 'package.json')
  let pkg
  try {
    // eslint-disable-next-line unicorn/text-encoding-identifier-case
    pkg = JSON.parse(await readFile(pkgFile, 'utf-8'))
    Object.assign(alias, pkg.alias || {})
    configWatchFiles.push(pkgFile)
  } catch {
    // ignore error, reading aliases from package.json is an optional feature
  }

  return {
    alias,
    configWatchFiles,
  }
}

async function getConfigsFromFile(cwd, configWatchFiles) {
  const EXTENSIONS = ['.js', '.mjs']

  let custom
  let initialError

  for (const ext of EXTENSIONS) {
    const file = resolve(cwd, `trs.config${ext}`)

    if (await isFile(file)) {
      const configFile = file
      configWatchFiles.push(configFile)

      const fileUrl = pathToFileURL(configFile)

      try {
        const importSource = supportsSearchParams ? `(x => import(x + '?t=${Date.now()}'))` : `(x => import(x))`
        // eslint-disable-next-line no-eval
        custom = await eval(importSource)(fileUrl.toString())

        break
      } catch (error) {
        // eslint-disable-next-line no-console
        console.log(error)
        initialError = error

        try {
          // eslint-disable-next-line no-eval
          custom = eval('(x => require(x))')(fileUrl)
        } catch (error_) {
          if (ext === '.mjs' || !/import statement/u.test(error_)) {
            throw new Error(`Failed to load trs.config${ext}\n${initialError}\n${error_}`)
          }
        }
      }
    }
  }

  return { configWatchFiles, custom }
}

/**
 * Deeply merge two config objects
 * @template {Record<string, any>} T
 * @template {Record<string, any>} U
 * @param {T} a
 * @param {U} b
 * @returns {T & U}
 */
function mergeConfig(a, b) {
  /** @type {any} */
  const merged = { ...a }

  // eslint-disable-next-line guard-for-in
  for (const key in b) {
    const value = b[key]
    if (value === null) continue

    const existing = merged[key]
    if (Array.isArray(existing) && Array.isArray(value)) {
      merged[key] = [...existing, ...value]
    } else if (existing !== null && typeof existing === 'object' && typeof value === 'object') {
      merged[key] = mergeConfig(existing, value)
    } else {
      merged[key] = value
    }
  }

  return merged
}
