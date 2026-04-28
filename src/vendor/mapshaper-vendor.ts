/**
 * Vendor entry — bundles `mapshaper` (and the shim that registers
 * polyfill modules for it) into a single file that exposes
 * `globalThis.mapshaper` as a side effect of loading.
 *
 * Why a separate vendor bundle:
 *   The main `dist/emap.js` and `dist/emap-worker.js` were each inlining
 *   their own ~2.3 MB copy of mapshaper. Sharing one vendor file cuts
 *   the deployed payload roughly in half.
 *
 * Order matters: `import '../shim'` registers `window.modules` /
 * `self.modules` polyfill entries (flatbush / kdbush / mproj). mapshaper's
 * IIFE executes during the next `import 'mapshaper'` and may resolve those
 * polyfills via `require()` fall-through — they MUST be registered first.
 *
 * The final assignment to `globalThis.mapshaper` is the public contract:
 * the main and worker bundles both expect that global at runtime.
 */
import '../shim';
import 'mapshaper';
import mapshaper from 'mapshaper';

(globalThis as unknown as { mapshaper: unknown }).mapshaper = mapshaper;
