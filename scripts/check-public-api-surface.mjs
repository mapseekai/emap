import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import ts from 'typescript';

const root = process.cwd();
const typedoc = JSON.parse(await readFile(resolve(root, 'typedoc.json'), 'utf8'));
const intentionallyInternal = new Set(typedoc.intentionallyNotExported ?? []);

const entryPoints = [
  { label: '@mapseekai/emap', path: 'src/index.ts' },
  { label: '@mapseekai/emap/arrow', path: 'src/arrow/index.ts' },
  { label: '@mapseekai/emap/duckdb', path: 'src/duckdb/index.ts' },
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
    if (!ts.isExportDeclaration(statement)) continue;
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
