import type { Module } from 'webpack';

const MODERN_RSC_INFO = 'modernRscInfo';

const BUILD_INFO_WEAK_MAP = new WeakMap();

export function setBuildInfo(
  mod: Module,
  property: Record<string, any>,
) {
  const buildInfo = BUILD_INFO_WEAK_MAP.get(mod) || {};
  BUILD_INFO_WEAK_MAP.set(mod, Object.assign(buildInfo, property));
}

const MODERN_RSC_INFO_WEAK_MAP = new WeakMap();

export function setRscBuildInfo(
  mod: Module,
  property: Record<string, any>,
) {
  const rscBuildInfo = MODERN_RSC_INFO_WEAK_MAP.get(mod) || {};
  MODERN_RSC_INFO_WEAK_MAP.set(mod, Object.assign(rscBuildInfo, property));
}

export function getRscBuildInfo(mod: Module) {
  return MODERN_RSC_INFO_WEAK_MAP.get(mod);
}

export function isCssModule(mod: Module) {
  return getRscBuildInfo(mod).isCssModule;
}
