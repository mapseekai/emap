import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import ts from 'typescript';

const root = process.cwd();
const entryPath = resolve(root, 'src/index.ts');
const source = await readFile(entryPath, 'utf8');
const file = ts.createSourceFile(entryPath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const typedoc = JSON.parse(await readFile(resolve(root, 'typedoc.json'), 'utf8'));
const intentionallyInternal = new Set(typedoc.intentionallyNotExported ?? []);
const exportedNames = new Set();
const failures = [];

for (const statement of file.statements) {
  if (ts.isExportAssignment(statement)) {
    failures.push('default/export-assignment syntax is not allowed in the root entry point');
    continue;
  }
  if (!ts.isExportDeclaration(statement)) continue;
  if (!statement.exportClause) {
    failures.push(`wildcard export is not allowed: ${statement.getText(file)}`);
    continue;
  }
  if (ts.isNamespaceExport(statement.exportClause)) {
    failures.push(`namespace export is not allowed: ${statement.getText(file)}`);
    continue;
  }
  for (const element of statement.exportClause.elements) {
    const publicName = element.name.text;
    if (publicName.startsWith('_')) {
      failures.push(`private-looking root export is not allowed: ${publicName}`);
    }
    if (intentionallyInternal.has(publicName)) {
      failures.push(`TypeDoc marks ${publicName} intentionally internal, but src/index.ts exports it`);
    }
    if (exportedNames.has(publicName)) {
      failures.push(`duplicate root export: ${publicName}`);
    }
    exportedNames.add(publicName);
  }
}

if (exportedNames.size === 0) failures.push('src/index.ts exposes no named API');
if (failures.length > 0) {
  throw new Error(`Public API surface check failed:\n- ${failures.join('\n- ')}`);
}

console.log(`Public API surface check passed: ${exportedNames.size} explicit root exports.`);
