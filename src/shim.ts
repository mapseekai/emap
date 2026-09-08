import * as buffer from 'buffer';
import mproj from 'mproj';
import Flatbush from 'flatbush';
import KDBush from 'kdbush';
import * as geographiclib from 'geographiclib-geodesic';
import * as togeojson from '@tmcw/togeojson';

// mapshaper's polyfill resolution is `typeof window == 'object' && window.modules`
// (mapshaper.js around line 142), and `runningInBrowser()` is
// `window !== 'undefined' && window.document !== 'undefined'`. We have to satisfy
// both: workers (which have `self` but no `window`) need a stub `window` with both
// `modules` AND `document` set, otherwise mapshaper takes the Node code path —
// `runParsedCommands` calls `printStartupMessages()` which dereferences
// `process.execArgv`, and the rollup-polyfill `process` has no `execArgv` ⇒
// "Cannot read properties of undefined (reading 'find')" on every worker command.
const g = globalThis as unknown as {
  window?: { modules?: Record<string, unknown>; document?: unknown };
};
if (typeof window === 'undefined') {
  g.window = g.window || {};
  if (!g.window!.document) g.window!.document = {};
}
const modules = (g.window!.modules = g.window!.modules || {});
modules['buffer'] = buffer;
modules['mproj'] = mproj;
modules['flatbush'] = Flatbush;
modules['kdbush'] = KDBush;
modules['geographiclib-geodesic'] = geographiclib;
// KML import (`importKML`) requires '@tmcw/togeojson' at runtime; the browser
// DOMParser is native, so '@xmldom/xmldom' is never reached.
modules['@tmcw/togeojson'] = togeojson;
