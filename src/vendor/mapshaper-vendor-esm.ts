// src/vendor/mapshaper-vendor-esm.ts
// ESM sibling of mapshaper-vendor.ts. The IIFE vendor registers
// globalThis.mapshaper for script-tag/worker consumers; this one is a real
// ES module with a default export, imported by dist/emap.mjs (mapshaper is
// marked external there). `import '../shim'` first: idempotent, guarded; it
// also runs via src/index.ts before this module evaluates, kept here so the
// vendor is self-sufficient if imported standalone.
import '../shim';
import mapshaper from 'mapshaper';

export default mapshaper;
