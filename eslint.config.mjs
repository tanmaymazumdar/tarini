/* eslint-disable prettier/prettier */
import { fixupConfigRules } from '@eslint/compat'
import pluginJs from '@eslint/js'
import airbnb from 'eslint-config-airbnb'
import canonicalRecommended from 'eslint-config-canonical/configurations/canonical.js'
import canonicalJSDoc from 'eslint-config-canonical/configurations/jsdoc.js'
import canonicalJson from 'eslint-config-canonical/configurations/json.js'
import canonicalPrettier from 'eslint-config-canonical/configurations/prettier.js'
import canonicalReact from 'eslint-config-canonical/configurations/react.js'
import canonicalRegexp from 'eslint-config-canonical/configurations/regexp.js'
import prettier from 'eslint-config-prettier'
import pluginReactConfig from 'eslint-plugin-react/configs/recommended.js'
import sonarjs from 'eslint-plugin-sonarjs'
import globals from 'globals'

const OFF = 0
const WARN = 1
const ERROR = 2

export default [
  { languageOptions: { globals: { ...globals.browser, ...globals.node } } },
  pluginJs.configs.recommended,
  ...fixupConfigRules(pluginReactConfig),
  sonarjs.configs.recommended,
  airbnb.rules,
  canonicalJSDoc.recommended,
  canonicalRecommended.recommended,
  canonicalRegexp.recommended,
  canonicalReact.recommended,
  canonicalPrettier.recommended,
  canonicalJson.recommended,
  prettier,
  {
    ignores: ['.prettierrc.js', 'buid', 'dist', 'eslint.config.mjs', 'node_modules', 'packages/trs/trs.cjs'],
    rules: {
      'func-style': OFF,
      'id-length': OFF,
      'import/extensions': OFF,
      'jsdoc/check-param-names': OFF,
      'jsdoc/no-undefined-types': OFF,
      'jsdoc/valid-types': OFF,
      'no-console': ERROR,
      'no-underscore-dangle': WARN,
      'prefer-destructuring': OFF,
      'prefer-rest-params': OFF,
      'prettier/prettier': OFF,
      'promise/param-names': OFF,
      'react/destructuring-assignment': OFF,
      'react/forbid-component-props': OFF,
      'react/jsx-max-depth': [ERROR, { max: 5 }],
      'react/jsx-props-no-spreading': OFF,
      'react/require-default-props': OFF,
      'react-hooks/exhaustive-deps': OFF,
      semi: OFF,
      'unicorn/new-for-builtins': OFF,
      'unicorn/no-array-reduce': OFF,
      'unicorn/no-new-array': OFF,
      'unicorn/prevent-abbreviations': OFF,
    },
    settings: {
      react: {
        version: 'detect',
      },
    },
  },
]
