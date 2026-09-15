import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

function files(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? files(file) : [file];
  });
}
const production = files('src').filter(file => file.endsWith('.ts') && !/\.test(?:-d)?\.ts$/.test(file) && !file.endsWith('.d.ts'));
const graph = new Map();
const violations = [];
for (const file of production) {
  const source = fs.readFileSync(file, 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  const ast = ts.createSourceFile(file, output, ts.ScriptTarget.Latest, true);
  const imports = [];
  const visit = node => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) imports.push(node.moduleSpecifier.text);
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && ts.isStringLiteral(node.arguments[0])) imports.push(node.arguments[0].text);
    ts.forEachChild(node, visit);
  };
  visit(ast);
  const edges = [];
  for (const specifier of imports) {
    if (specifier.includes('/kernel/') || specifier.endsWith('/kernel')) violations.push(`${file}: deleted custom kernel import ${specifier}`);
    if (file.startsWith('src/runtime/plugins/') && /(?:^|\/)map\/map$/.test(specifier)) violations.push(`${file}: feature depends on Emap`);
    if (!specifier.startsWith('.')) continue;
    const base = path.normalize(path.join(path.dirname(file), specifier));
    const target = [base + '.ts', path.join(base, 'index.ts')].find(candidate => fs.existsSync(candidate));
    if (target) edges.push(target);
  }
  if (file.startsWith('src/runtime/services/') && /from\s+['"][^'"]*providers\//.test(source)) violations.push(`${file}: contract imports provider implementation`);
  if (/\b(class (PluginRuntime|ServiceRegistry|EffectScope)|serviceKey\s*\(|ctx\.scope|ctx\.defer|ctx\.optional)\b/.test(output)) violations.push(`${file}: custom plugin runtime was reintroduced`);
  if (/\b(?:PluginRuntime|EffectScope|ServiceRegistry|ServiceKey|ServiceResolver|serviceKey)\b/.test(output)) violations.push(`${file}: removed custom runtime API`);
  graph.set(file, edges);
}

const visited = new Set();
const visiting = new Set();
const cycles = [];
function walk(file, stack) {
  if (visiting.has(file)) { cycles.push([...stack.slice(stack.indexOf(file)), file]); return; }
  if (visited.has(file)) return;
  visiting.add(file);
  for (const target of graph.get(file) ?? []) walk(target, [...stack, file]);
  visiting.delete(file); visited.add(file);
}
for (const file of graph.keys()) walk(file, []);
for (const cycle of cycles) violations.push(`Runtime import cycle: ${cycle.join(' -> ')}`);

const allowedTopLevel = new Set(['domain', 'engine', 'runtime', 'integrations', 'ui', 'shared']);
for (const entry of fs.readdirSync('src', { withFileTypes: true })) {
  if (entry.isDirectory() && !allowedTopLevel.has(entry.name)) {
    violations.push(`Unexpected src top-level directory: ${entry.name}`);
  }
}

if (fs.existsSync('src/kernel')) violations.push('The custom kernel directory must be removed');
const manifest = JSON.parse(fs.readFileSync('package.json', 'utf8'));
if (manifest.dependencies?.cordis !== '4.0.0-rc.10') violations.push('Cordis must remain pinned to the validated upstream version');
for (const [file] of graph) {
  if (
    !file.startsWith('src/runtime/providers/') &&
    !file.startsWith('src/engine/providers/') &&
    !file.startsWith('src/runtime/plugins/') &&
    !file.startsWith('src/integrations/')
  )
    continue;
  const source = fs.readFileSync(file, 'utf8');
  if (/\bsetup\s*\(ctx/.test(source)) violations.push(`${file}: legacy plugin entry point`);
}
const formatSource = fs.readFileSync('src/domain/source/format-registry.ts', 'utf8');
if (formatSource.includes("Symbol.for('emap.formatRegistry')")) violations.push('Format registry still has process-global mutable state');
if (/\b(setDuckDbRuntime|getDuckDbRuntime|injectedRuntime)\b/.test(fs.readFileSync('src/integrations/duckdb/runtime.ts', 'utf8'))) violations.push('DuckDB still has a global runtime');
const reachable = new Set();
function visitEntry(file) {
  if (reachable.has(file)) return;
  reachable.add(file);
  for (const dependency of graph.get(file) ?? []) visitEntry(dependency);
}
visitEntry('src/index.ts');
for (const forbidden of ['src/integrations/maplibre/plugin.ts', 'src/integrations/arrow/index.ts', 'src/integrations/duckdb/index.ts', 'src/integrations/geopackage/index.ts']) {
  if (reachable.has(forbidden)) violations.push(`Default entry eagerly imports optional provider: ${forbidden}`);
}
if (violations.length) throw new Error(violations.join('\n'));
console.log(`Architecture verified: ${production.length} production modules, no runtime cycles.`);
