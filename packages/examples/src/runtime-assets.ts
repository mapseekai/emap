export type RuntimeAssetMode = 'local' | 'cdn';

export type RuntimeAssetIntegrity = Partial<Record<'vendor' | 'core' | 'css', string>>;

export interface RuntimeAssetSet {
  vendor: string;
  core: string;
  css: string;
  worker: string;
  fallbackVendor?: string;
  fallbackCore?: string;
  fallbackCss?: string;
  integrity: RuntimeAssetIntegrity;
}

export interface RuntimeAssetOptions {
  mode?: RuntimeAssetMode;
  baseUrl?: string;
  version?: string;
  integrity?: RuntimeAssetIntegrity;
}

declare const __EMAP_VERSION__: string;
declare const __EMAP_ASSET_MODE__: RuntimeAssetMode;
declare const __EMAP_ASSET_INTEGRITY__: RuntimeAssetIntegrity;

const exactVersionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function configuredVersion(): string | undefined {
  return typeof __EMAP_VERSION__ === 'string' ? __EMAP_VERSION__ : undefined;
}

function configuredMode(): RuntimeAssetMode {
  return typeof __EMAP_ASSET_MODE__ === 'string' ? __EMAP_ASSET_MODE__ : 'local';
}

function configuredIntegrity(): RuntimeAssetIntegrity {
  return typeof __EMAP_ASSET_INTEGRITY__ === 'object' && __EMAP_ASSET_INTEGRITY__ !== null
    ? __EMAP_ASSET_INTEGRITY__
    : {};
}

function withTrailingSlash(baseUrl: string): string {
  return baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
}

function requireCdnIntegrity(integrity: RuntimeAssetIntegrity): RuntimeAssetIntegrity {
  for (const name of ['vendor', 'core', 'css'] as const) {
    if (!integrity[name]?.trim()) {
      throw new Error(`CDN runtime asset integrity is missing for ${name}`);
    }
  }
  return { ...integrity };
}

export function resolveRuntimeAssets(options: RuntimeAssetOptions = {}): RuntimeAssetSet {
  const mode = options.mode ?? configuredMode();
  const baseUrl = withTrailingSlash(options.baseUrl ?? import.meta.env.BASE_URL);
  const local = {
    vendor: `${baseUrl}vendor/mapshaper-vendor.js`,
    core: `${baseUrl}vendor/emap.js`,
    css: `${baseUrl}vendor/emap.css`,
    worker: `${baseUrl}emap-worker.js`,
  };

  if (mode === 'local') {
    return { ...local, integrity: {} };
  }

  if (mode !== 'cdn') {
    throw new Error(`Unsupported runtime asset mode: ${String(mode)}`);
  }

  const version = options.version ?? configuredVersion();
  if (!version || !exactVersionPattern.test(version)) {
    throw new Error('CDN runtime assets require an exact package version');
  }

  const integrity = requireCdnIntegrity(options.integrity ?? configuredIntegrity());
  const cdnBase = `https://cdn.jsdelivr.net/npm/@mapseekai/emap@${version}/dist/`;

  return {
    vendor: `${cdnBase}mapshaper-vendor.js`,
    core: `${cdnBase}emap.js`,
    css: `${cdnBase}emap.css`,
    worker: local.worker,
    fallbackVendor: local.vendor,
    fallbackCore: local.core,
    fallbackCss: local.css,
    integrity,
  };
}
