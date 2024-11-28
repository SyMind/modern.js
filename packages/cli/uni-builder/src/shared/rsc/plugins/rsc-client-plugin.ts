import type Webpack from 'webpack';
import {
  type ClientManifest,
  type ClientReferencesMap,
  type ImportManifestEntry,
  type SSRManifest,
  getRscBuildInfo,
  sharedData,
} from '../common';
import { EntryPlugin } from 'webpack';

export interface RscClientPluginOptions {
  readonly clientManifestFilename?: string;
  readonly ssrManifestFilename?: string;
  readonly styles?: Set<string>;
}

export class RscClientPlugin {
  private clientReferencesMap: ClientReferencesMap = new Map();
  private clientManifestFilename: string;
  private ssrManifestFilename: string;
  private styles?: Set<string>;

  private dependencies: any[] = [];

  constructor(options: RscClientPluginOptions) {
    this.clientManifestFilename =
      options.clientManifestFilename || `react-client-manifest.json`;

    this.ssrManifestFilename =
      options?.ssrManifestFilename || `react-ssr-manifest.json`;

    this.styles = options.styles;
  }

  apply(compiler: Webpack.Compiler): void {
    const {
      // AsyncDependenciesBlock,
      RuntimeGlobals,
      WebpackError,
      // dependencies: { ModuleDependency, NullDependency },
      sources: { RawSource },
    } = compiler.webpack;

    const ssrManifest: SSRManifest = {
      moduleMap: {},
      moduleLoading: null,
      styles: [],
    };

    const getEntryModule = (compilation: Webpack.Compilation) => {
      const [entryTuple, ...otherEntries] = compilation.entries.entries();
      if (!entryTuple) {
        compilation.errors.push(
          new WebpackError(`Could not find an entry in the compilation.`),
        );

        return;
      }

      if (otherEntries.length > 0) {
        compilation.warnings.push(
          new WebpackError(
            `Found multiple entries in the compilation, adding client reference chunks only to the first entry.`,
          ),
        );
      }

      const [, entryValue] = entryTuple;

      const entryDependency = entryValue.dependencies.find(
        dependency => dependency.constructor.name === `EntryDependency`,
      );

      if (!entryDependency) {
        compilation.errors.push(
          new WebpackError(`Could not find an entry dependency.`),
        );

        return;
      }

      return compilation.moduleGraph.getResolvedModule(entryDependency);
    };

    const addClientReferencesChunks = (compilation: Webpack.Compilation, entryModule: Webpack.Module, callback: (err: any | null) => void) => {
      const promises = [];
      [...this.clientReferencesMap.keys()].forEach((resourcePath, index) => {
        const dependency = EntryPlugin.createDependency(resourcePath, {
          name: resourcePath,
        });
        promises.push(new Promise((resolve, reject) => {
          compilation.addInclude(
            compiler.context,
            dependency,
            { name: `client${index}` },
            (error, module) => {
              if (error) {
                reject(error);
              } else {
                this.dependencies.push(dependency);
                resolve(undefined);
              }
            }
          );
        }))
      });

      if (this.styles && this.styles.size > 0) {
        for (const style of this.styles) {
          const dependency = EntryPlugin.createDependency(style, {
            name: style,
          });
          promises.push(new Promise((resolve, reject) => {
            compilation.addInclude(
              compiler.context,
              dependency,
              { name: undefined },
              (error, module) => {
                if (error) {
                  reject(error);
                } else {
                  this.dependencies.push(dependency);
                  resolve(undefined);
                }
              }
            );
          }))
        }
      }

      Promise.all(promises)
        .then(() => callback(null))
        .catch(error => callback(error))
    };

    compiler.hooks.finishMake.tapAsync(RscClientPlugin.name, (compilation, callback) => {
      const entryModule = getEntryModule(compilation);

      if (entryModule) {
        addClientReferencesChunks(compilation, entryModule, callback);
      }
    });

    compiler.hooks.thisCompilation.tap(
      RscClientPlugin.name,
      (compilation, { normalModuleFactory }) => {
        this.clientReferencesMap = sharedData.get(
          'clientReferencesMap',
        ) as ClientReferencesMap;

        compilation.hooks.finishModules.tap(RscClientPlugin.name, () => {
          for (const dependency of this.dependencies) {
            const module = compilation.moduleGraph.getModule(dependency);
            if (module) {
              compilation.moduleGraph
                .getExportsInfo(module)
                .setUsedInUnknownWay('main');
            }
          }
        });

        compilation.hooks.additionalTreeRuntimeRequirements.tap(
          RscClientPlugin.name,
          (_chunk, runtimeRequirements) => {
            runtimeRequirements.add(RuntimeGlobals.ensureChunk);
            runtimeRequirements.add(RuntimeGlobals.compatGetDefaultExport);
          },
        );

        compilation.hooks.processAssets.tap(RscClientPlugin.name, () => {
          const clientManifest: ClientManifest = {};
          const { chunkGraph, moduleGraph, modules } = compilation;

          for (const module of modules) {
            const resourcePath = module.nameForCondition();

            const clientReferences = resourcePath
              ? this.clientReferencesMap.get(resourcePath)
              : undefined;

            if (clientReferences) {
              const moduleId = chunkGraph.getModuleId(module);

              const ssrModuleMetaData: Record<string, ImportManifestEntry> = {};

              for (const { id, exportName, ssrId } of clientReferences) {
                // Theoretically the used client and SSR export names should
                // be used here. These might differ from the original export
                // names that the loader has recorded. But with the current
                // setup (i.e. how the client entries are added on both
                // sides), the original export names are preserved.
                const clientExportName = exportName;
                const ssrExportName = exportName;

                const chunksSet = new Set<Webpack.Chunk>();

                for (const chunk of chunkGraph.getModuleChunksIterable(
                  module,
                )) {
                  chunksSet.add(chunk);
                }

                for (const connection of moduleGraph.getOutgoingConnections(
                  module,
                )) {
                  for (const chunk of chunkGraph.getModuleChunksIterable(
                    connection.module,
                  )) {
                    chunksSet.add(chunk);
                  }
                }

                // chunks is a double indexed array of chunkId / chunkFilename pairs
                const chunks: (string | number)[] = [];
                const styles: string[] = [];

                for (const chunk of chunksSet) {
                  if (chunk.id && !chunk.isOnlyInitial()) {
                    for (const file of chunk.files) {
                      if (file.endsWith('.js')) {
                        chunks.push(chunk.id, file);
                      }
                    }
                  }
                }

                clientManifest[id] = {
                  id: ssrId!,
                  name: clientExportName,
                  chunks,
                  styles,
                };

                if (ssrId) {
                  ssrModuleMetaData[clientExportName] = {
                    id: ssrId,
                    name: ssrExportName,
                    chunks: [],
                  };
                }
              }

              ssrManifest.moduleMap[moduleId!] = ssrModuleMetaData;
            }
          }

          compilation.emitAsset(
            this.clientManifestFilename,
            new RawSource(JSON.stringify(clientManifest, null, 2), false),
          );

          const { crossOriginLoading, publicPath = `` } =
            compilation.outputOptions;

          ssrManifest.moduleLoading = {
            // https://github.com/webpack/webpack/blob/87660921808566ef3b8796f8df61bd79fc026108/lib/runtime/PublicPathRuntimeModule.js#L30-L32
            prefix: compilation.getPath(publicPath, {
              hash: compilation.hash ?? `XXXX`,
            }),
            crossOrigin: crossOriginLoading
              ? crossOriginLoading === `use-credentials`
                ? crossOriginLoading
                : ``
              : undefined,
          };

          if (this.styles && this.styles.size > 0) {
            const assets = compilation.getAssets();
            const cssAsset = assets.find(asset => {
              return asset.name.endsWith('.css');
            });
            if (cssAsset) {
              ssrManifest.styles.push(cssAsset.name);
            }
          }

          compilation.emitAsset(
            this.ssrManifestFilename,
            new RawSource(JSON.stringify(ssrManifest, null, 2), false),
          );
        });
      },
    );
  }
}
