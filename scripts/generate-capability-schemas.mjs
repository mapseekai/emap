import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import ts from 'typescript';

const config = ts.readConfigFile('tsconfig.json', ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, process.cwd());
const program = ts.createProgram(parsed.fileNames, parsed.options);
const checker = program.getTypeChecker();
const blocked = new Set(['Uint8Array', 'ArrayBuffer', 'Blob', 'File', 'Function']);

function schema(type, seen = new Set()) {
  if (seen.has(type)) return { anyOf: [] };
  const next = new Set(seen).add(type);
  if (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) return {};
  if (type.flags & (ts.TypeFlags.Never | ts.TypeFlags.Undefined)) return { anyOf: [] };
  if (type.flags & ts.TypeFlags.Null) return { type: 'null' };
  if (type.isStringLiteral()) return { type: 'string', enum: [type.value] };
  if (type.isNumberLiteral()) return { type: 'number', enum: [type.value] };
  if (type.flags & ts.TypeFlags.BooleanLiteral) return { type: 'boolean', enum: [type.intrinsicName === 'true'] };
  if (type.isUnion()) {
    const branches = type.types.filter(t => !(t.flags & ts.TypeFlags.Undefined)).map(t => schema(t, next));
    return branches.length === 1 ? branches[0] : { anyOf: branches };
  }
  if (type.flags & ts.TypeFlags.StringLike) return { type: 'string' };
  if (type.flags & ts.TypeFlags.NumberLike) return { type: 'number' };
  if (type.flags & ts.TypeFlags.BooleanLike) return { type: 'boolean' };
  if (blocked.has(type.symbol?.name)) return { anyOf: [] };
  if (checker.isTupleType(type)) {
    const parts = checker.getTypeArguments(type).map(t => schema(t, next));
    const minimum = type.target.minLength ?? parts.length;
    return { type: 'array', prefixItems: parts, minItems: minimum, maxItems: parts.length };
  }
  if (checker.isArrayType(type)) return { type: 'array', items: schema(checker.getTypeArguments(type)[0], next) };
  if (type.getCallSignatures().length) return { anyOf: [] };
  if (type.flags & ts.TypeFlags.Object || type.isIntersection()) {
    const properties = {};
    const required = [];
    for (const property of checker.getPropertiesOfType(type)) {
      const declaration = property.valueDeclaration ?? property.declarations?.[0];
      if (!declaration) continue;
      const entry = schema(checker.getTypeOfSymbolAtLocation(property, declaration), next);
      const description = ts.displayPartsToString(property.getDocumentationComment(checker));
      if (description) entry.description = description.replace(/\{@link ([^}]+)\}/g, '$1');
      properties[property.name] = entry;
      if (!(property.flags & ts.SymbolFlags.Optional)) required.push(property.name);
    }
    const index = checker.getIndexTypeOfType(type, ts.IndexKind.String);
    return { type: 'object', properties, ...(required.length ? { required } : {}), additionalProperties: index ? schema(index, next) : false };
  }
  return { anyOf: [] };
}

const catalogs = {};
for (const [file, name] of [['src/map/mapshaper-ops.ts', 'MapshaperOps'], ['src/map/attribute-ops.ts', 'AttributeOps'], ['src/map/edit-sessions.ts', 'EditSessions'], ['src/providers/workspace/layers.ts', 'LayerServiceImpl'], ['src/providers/workspace/source.ts', 'SourceServiceImpl'], ['src/providers/workspace/projection.ts', 'ProjectionServiceImpl'], ['src/providers/workspace/view.ts', 'ViewServiceImpl'], ['src/providers/workspace/selection.ts', 'SelectionServiceImpl'], ['src/providers/workspace/history.ts', 'HistoryServiceImpl'], ['src/providers/workspace/query.ts', 'QueryServiceImpl']]) {
  const source = program.getSourceFile(file);
  const cls = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === name);
  const catalog = {};
  for (const method of cls.members) {
    if (!ts.isMethodDeclaration(method) || !ts.isIdentifier(method.name)) continue;
    const id = method.name.text;
    if (['dispose', 'initialize', 'setPointLodProvider', 'preflightSource', 'confirmSource', 'addSource', 'pushCommand', 'beginTransaction', 'setExtent', 'fitBounds'].includes(id)) continue;
    if (id.startsWith('_') || id.startsWith('begin') || id === 'withSignal' || method.modifiers?.some(mod => mod.kind === ts.SyntaxKind.PrivateKeyword)) continue;
    const parameters = method.parameters.map(parameter => ({
      name: parameter.name.getText(source), optional: !!parameter.questionToken || !!parameter.initializer,
      schema: schema(checker.getTypeAtLocation(parameter)),
    }));
    const flatten = parameters.length === 1 && ['opts', 'options'].includes(parameters[0].name);
    catalog[id] = {
      parameters: parameters.map(parameter => parameter.name), flatten,
      inputSchema: flatten ? parameters[0].schema : {
        type: 'object', properties: Object.fromEntries(parameters.map(p => [p.name, p.schema])),
        required: parameters.filter(p => !p.optional).map(p => p.name), additionalProperties: false,
      },
    };
  }
  catalogs[name] = catalog;
}
const target = 'src/plugins/capabilities/generated-schemas.ts';
const output = '// Generated from the public operation signatures by scripts/generate-capability-schemas.mjs.\n// Do not edit manually; run pnpm capabilities:generate.\nimport type { InputSchema } from \'../../services/capabilities\';\n\nexport const operationSchemas = ' + JSON.stringify(catalogs, null, 2) + ' as const satisfies Record<string, Record<string, { parameters: readonly string[]; flatten: boolean; inputSchema: InputSchema }>>;\n';
const formatted = execFileSync('node_modules/.bin/biome', ['format', '--stdin-file-path=' + target], { input: output, encoding: 'utf8' });
if (process.argv.includes('--check')) {
  if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== formatted) throw new Error('Capability schemas are stale; run pnpm capabilities:generate');
} else fs.writeFileSync(target, formatted);
console.log(Object.fromEntries(Object.entries(catalogs).map(([name, tools]) => [name, Object.keys(tools).length])));
