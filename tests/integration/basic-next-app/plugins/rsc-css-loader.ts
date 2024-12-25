import type { LoaderContext } from 'webpack';
import { setRscBuildInfo } from './utils';

export default function rscCssLoader(this: LoaderContext<any>, source: string) {
  console.log('rscCssLoader');
  this._module &&
    setRscBuildInfo(this._module, {
      isCssModule: true,
    });
  return source;
}
