import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const records = JSON.parse(readFileSync(resolve(root, 'node_modules/epsg-index/all.json'), 'utf8'));

const rows = [];
const codesWithoutProj4 = [];
for (const [code, record] of Object.entries(records).sort(([a], [b]) => Number(a) - Number(b))) {
  const proj4 = typeof record.proj4 === 'string' ? record.proj4.trim() : '';
  if (proj4) {
    rows.push(`${code}\t${proj4}`);
  } else {
    codesWithoutProj4.push(code);
  }
}

const output = `// Generated from epsg-index/all.json by scripts/generate-epsg-proj4-data.mjs.
// Keep this as a compact string table so browser bundles do not initialize the
// full EPSG JSON object with WKT, bbox, area, and accuracy metadata.

export const EPSG_PROJ4_TABLE = ${JSON.stringify(rows.join('\n'))};
export const EPSG_CODES_WITHOUT_PROJ4 = ${JSON.stringify(`|${codesWithoutProj4.join('|')}|`)};
`;

writeFileSync(resolve(root, 'src/geo/epsg-proj4-data.ts'), output);
