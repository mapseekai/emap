// Browser stub for adm-zip. mapshaper's zip path is `qc() ? <fflate> :
// new require('adm-zip')()`; in a browser qc() is truthy so this branch is
// dead. Aliased in at build time (rollup.config.mjs) the same way iconv-lite
// is, purely to remove the unresolved `require("adm-zip")` from the bundle.
// If a future mapshaper change ever reaches it, fail loud and clear instead
// of esbuild's opaque "Dynamic require of …".
class AdmZipBrowserStub {
  constructor() {
    throw new Error(
      'adm-zip is Node-only; the browser ZIP path uses fflate — ' +
        'this code path should be unreachable in a browser build',
    );
  }
}

export default AdmZipBrowserStub;
