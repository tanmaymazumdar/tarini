import resolve from '@rollup/plugin-node-resolve'

export default {
  input: 'bin/trs.js',
  output: {
    file: 'trs.cjs',
    format: 'cjs',
  },
  plugins: [resolve()],
}
