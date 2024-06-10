import * as posthtml from 'posthtml'

const transformInjectTrs = async tree => {
  tree.walk(node => {
    if (node.tag === 'head') {
      node.content.unshift('\n\t\t', {
        attrs: { type: 'module' },
        content: ["\n\t\t\timport '/_trs.js';\n\t\t"],
        tag: 'script',
      })
    }

    return node
  })
}

export async function injectTrs(html) {
  const transformer = posthtml([transformInjectTrs])
  const result = await transformer.process(html)

  return result.html
}
