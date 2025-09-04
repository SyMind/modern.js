import { Rspack as rspack } from '@rsbuild/core';
import { ClientReferencesMap, ImportManifestEntry, sharedData } from '../common';

type ModuleId = string | number

interface ClientReferenceManifest {
  [moduleExport: string]: {
    /**
     * Webpack module id
     */
    id: ModuleId
    /**
     * Export name
     */
    name: string
    /**
     * Chunks for the module. JS and CSS.
     */
    chunks: string[]
  }
}

const PLUGIN_NAME = 'ClientReferenceManifestPlugin'

export default class ClientReferenceManifestPlugin {
    private clientReferencesMap: ClientReferencesMap = new Map();

  apply(compiler: rspack.Compiler) {
    const { Compilation, NormalModule, sources: { RawSource } } = compiler.webpack;

    compiler.hooks.compilation.tap(PLUGIN_NAME, (compilation) => {
        this.clientReferencesMap = sharedData.get(
            'clientReferencesMap',
        ) as ClientReferencesMap;

      compilation.hooks.processAssets.tap(
        {
          name: PLUGIN_NAME,
          // Have to be in the optimize stage to run after updating the CSS
          // asset hash via extract mini css plugin.
          stage: Compilation.PROCESS_ASSETS_STAGE_ANALYSE,
        },
        () => {
            const manifest: ClientReferenceManifest = {}

            for (const [entryName, entrypoint] of compilation.entrypoints) {
                for (const child of entrypoint.childrenIterable) {
                    child.chunks.forEach((chunk: rspack.Chunk) => {
                        const mods = compilation.chunkGraph.getChunkModulesIterable(chunk)
                        for (const mod of mods) {
                            if (mod instanceof NormalModule && mod.resourceResolveData?.query === '?client-reference') {
                                const resourcePath = mod.nameForCondition();

                                const clientReferences = resourcePath
                                    ? this.clientReferencesMap.get(resourcePath)
                                    : undefined;
                                if (clientReferences) {
                                    const moduleId = compilation.chunkGraph.getModuleId(mod);

                                    const ssrModuleMetaData: Record<string, ImportManifestEntry> = {};

                                    for (const { id, exportName, ssrId } of clientReferences) {
                                    const clientExportName = exportName;
                                    const ssrExportName = exportName;

                                    const chunksSet = new Set<rspack.Chunk>();

                                    for (const chunk of compilation.chunkGraph.getModuleChunksIterable(
                                        mod,
                                    )) {
                                        chunksSet.add(chunk);
                                    }

                                    for (const connection of compilation.moduleGraph.getOutgoingConnections(
                                        mod,
                                    )) {
                                        if (connection.module) {
                                            for (const chunk of compilation.chunkGraph.getModuleChunksIterable(connection.module)) {
                                                chunksSet.add(chunk);
                                            }
                                        }
                                    }

                                    const chunks: string[] = [];

                                    for (const chunk of chunksSet) {
                                        if (chunk.id) {
                                        for (const file of chunk.files) {
                                            if (file.endsWith('.js')) {
                                                chunks.push(chunk.id, file);
                                            }
                                        }
                                        }
                                    }

                                    manifest[id] = {
                                        id: moduleId!,
                                        name: clientExportName,
                                        chunks,
                                    };
                                }
                            }
                        }
                    }})
                }
            }

            compilation.emitAsset(
                'react-client-manifest.json',
                new RawSource(JSON.stringify(manifest, null, 2), false),
            );

            // IGNORE: 暂时不想处理 ssr module，这里先写死仅用于测试
            const ssrManifest = {
                "moduleMap": {
                    "./src/client-component-root/App.tsx?client-reference": {
                    "default": {
                        "id": "./src/client-component-root/App.tsx",
                        "name": "default",
                        "chunks": []
                    }
                    },
                    "./src/server-component-root/components/Counter.tsx?client-reference": {
                    "Counter": {
                        "id": "./src/server-component-root/components/Counter.tsx",
                        "name": "Counter",
                        "chunks": []
                    }
                    }
                },
                "moduleLoading": {
                    "prefix": "/"
                },
                "styles": [
                    "static/css/client-component-root.css"
                ]
            }

            compilation.emitAsset(
                'react-ssr-manifest.json',
                new RawSource(JSON.stringify(ssrManifest, null, 2), false),
            );
        }
      )
    })
  }
}
