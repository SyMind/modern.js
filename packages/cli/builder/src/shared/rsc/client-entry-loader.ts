import { Rspack as rspack } from '@rsbuild/core';

export type lientEntryLoaderOptions = {
  modules: string[] | string
}

export default function transformSource(
  this: rspack.LoaderContext<lientEntryLoaderOptions>
) {
    let { modules } = this.getOptions()

    if (!Array.isArray(modules)) {
        modules = modules ? [modules] : []
    }

    const code = modules
        .map(request => {
            const importPath = JSON.stringify(`${request}?client-reference`)
            return `import(${importPath})`
        })
        .join(';\n')
    return code
}
