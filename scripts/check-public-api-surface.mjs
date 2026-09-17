import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import ts from 'typescript';

const root = process.cwd();
const typedoc = JSON.parse(await readFile(resolve(root, 'typedoc.json'), 'utf8'));
const intentionallyInternal = new Set(typedoc.intentionallyNotExported ?? []);

const entryPoints = [
  { label: '@mapseekai/emap', path: 'src/index.ts' },
  { label: '@mapseekai/emap/arrow', path: 'src/integrations/arrow/index.ts' },
  { label: '@mapseekai/emap/duckdb', path: 'src/integrations/duckdb/index.ts' },
  { label: '@mapseekai/emap/geotiff', path: 'src/integrations/geotiff/index.ts' },
  { label: '@mapseekai/emap/geopackage', path: 'src/integrations/geopackage/index.ts' },
  { label: '@mapseekai/emap/context', path: 'src/runtime/context/index.ts' },
  { label: '@mapseekai/emap/services', path: 'src/runtime/services/index.ts' },
  { label: '@mapseekai/emap/providers', path: 'src/runtime/providers/index.ts' },
  { label: '@mapseekai/emap/plugins', path: 'src/runtime/plugins/index.ts' },
  { label: '@mapseekai/emap/presets', path: 'src/runtime/presets/index.ts' },
  { label: '@mapseekai/emap/ai', path: 'src/runtime/ai/index.ts' },
  { label: '@mapseekai/emap/maplibre', path: 'src/integrations/maplibre/index.ts' },
];

const failures = [];
const summaries = [];

for (const entry of entryPoints) {
  const entryPath = resolve(root, entry.path);
  const source = await readFile(entryPath, 'utf8');
  const file = ts.createSourceFile(entryPath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const exportedNames = new Set();

  for (const statement of file.statements) {
    if (ts.isExportAssignment(statement)) {
      failures.push(`${entry.label}: default/export-assignment syntax is not allowed`);
      continue;
    }
    if (!ts.isExportDeclaration(statement)) {
      if (statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
        const names = ts.isVariableStatement(statement)
          ? statement.declarationList.declarations.map(declaration => declaration.name).filter(ts.isIdentifier).map(name => name.text)
          : statement.name && ts.isIdentifier(statement.name) ? [statement.name.text] : [];
        for (const name of names) {
          if (name.startsWith('_') || exportedNames.has(name)) failures.push(`${entry.label}: invalid or duplicate declaration export ${name}`);
          exportedNames.add(name);
        }
      }
      continue;
    }
    if (!statement.exportClause) {
      failures.push(`${entry.label}: wildcard export is not allowed: ${statement.getText(file)}`);
      continue;
    }
    if (ts.isNamespaceExport(statement.exportClause)) {
      failures.push(`${entry.label}: namespace export is not allowed: ${statement.getText(file)}`);
      continue;
    }
    for (const element of statement.exportClause.elements) {
      const publicName = element.name.text;
      if (publicName.startsWith('_')) {
        failures.push(`${entry.label}: private-looking export is not allowed: ${publicName}`);
      }
      if (intentionallyInternal.has(publicName)) {
        failures.push(`${entry.label}: TypeDoc marks ${publicName} intentionally internal`);
      }
      if (exportedNames.has(publicName)) {
        failures.push(`${entry.label}: duplicate export: ${publicName}`);
      }
      exportedNames.add(publicName);
    }
  }

  if (exportedNames.size === 0) failures.push(`${entry.label}: exposes no named API`);
  summaries.push(`${entry.label}: ${exportedNames.size} explicit exports`);
}

if (failures.length > 0) {
  throw new Error(`Public API surface check failed:\n- ${failures.join('\n- ')}`);
}

console.log(`Public API surface check passed:\n- ${summaries.join('\n- ')}`);
