import { access, readFile, readdir } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import ts from 'typescript';

export function parseRootArg(argv = process.argv.slice(2)) {
  const rootIndex = argv.indexOf('--root');
  if (rootIndex === -1) return process.cwd();
  const root = argv[rootIndex + 1];
  if (!root) throw new Error('--root requires a path');
  return resolve(root);
}

function toPosixPath(path) {
  return path.replaceAll('\\', '/');
}

export function relativePath(root, path) {
  return toPosixPath(relative(root, path));
}

export async function fileExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function collectFiles(dir, extensions) {
  if (!(await fileExists(dir))) return [];

  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return collectFiles(path, extensions);
      if (entry.isFile() && extensions.some((extension) => entry.name.endsWith(extension))) {
        return [path];
      }
      return [];
    }),
  );
  return nested.flat().sort();
}

function parseFrontMatter(markdown) {
  const match = /^---\r?\n(?<body>[\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(markdown);
  if (!match?.groups?.body) return {};

  return Object.fromEntries(
    match.groups.body
      .split(/\r?\n/)
      .map((line) => line.match(/^(?<key>[\w-]+):\s*(?<value>.*)$/))
      .filter((lineMatch) => Boolean(lineMatch?.groups))
      .map((lineMatch) => [lineMatch.groups.key, lineMatch.groups.value.trim()]),
  );
}

export function hasFrontMatterField(frontMatter, key) {
  return Object.prototype.hasOwnProperty.call(frontMatter, key);
}

export function readFrontMatterString(frontMatter, key) {
  const value = frontMatter[key];
  return typeof value === 'string' ? value.trim() : '';
}

export function readFrontMatterStringList(frontMatter, key) {
  const value = frontMatter[key];
  if (Array.isArray(value)) return value.filter((item) => typeof item === 'string');
  if (typeof value !== 'string') return [];

  const trimmed = value.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    try {
      const parsed = JSON.parse(trimmed);
      return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : [];
    } catch {
      return [];
    }
  }

  return [trimmed];
}

export async function collectDocs(root, docsRoot) {
  const absoluteRoot = resolve(root, docsRoot);
  const files = await collectFiles(absoluteRoot, ['.md', '.mdx']);
  const docs = new Map();

  for (const file of files) {
    const markdown = await readFile(file, 'utf8');
    const rel = toPosixPath(relative(absoluteRoot, file)).replace(/\.mdx?$/, '');
    docs.set(rel, {
      path: file,
      rel,
      frontMatter: parseFrontMatter(markdown),
    });
  }

  return docs;
}

export function normalizeDocReference(reference) {
  let value = reference.trim();
  if (value.startsWith('/docs')) value = value.slice('/docs'.length);
  if (value.endsWith('/index.html')) value = value.slice(0, -'/index.html'.length);
  value = value.replace(/\.mdx?$/, '');
  value = value.replace(/\/$/, '');
  return value === '' ? '/' : value.replace(/^\//, '');
}

export function buildDocReferenceSet(docs) {
  const references = new Set();
  for (const doc of docs.values()) {
    references.add(doc.rel);
    const id = readFrontMatterString(doc.frontMatter, 'id');
    const slug = readFrontMatterString(doc.frontMatter, 'slug');
    if (id) references.add(normalizeDocReference(id));
    if (slug) references.add(normalizeDocReference(slug));
  }
  return references;
}

export async function readExamples(root) {
  const catalogPath = resolve(root, 'docs-meta/examples.ts');
  const source = await readFile(catalogPath, 'utf8');
  return parseExamples(source);
}

function parseExamples(source) {
  const file = ts.createSourceFile('examples.ts', source, ts.ScriptTarget.Latest, true);
  const constants = new Map();
  const arrays = new Map();

  for (const statement of file.statements) {
    if (!ts.isVariableStatement(statement)) continue;

    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;

      if (ts.isStringLiteralLike(declaration.initializer)) {
        constants.set(declaration.name.text, declaration.initializer.text);
      }
      if (ts.isArrayLiteralExpression(declaration.initializer)) {
        arrays.set(declaration.name.text, declaration.initializer);
      }
    }
  }

  const examples = [];
  const literalArray = arrays.get('seeds') ?? arrays.get('examples');

  if (literalArray) {
    examples.push(
      ...literalArray.elements
        .map((node) => parseCatalogEntry(node, constants))
        .filter((example) => example.id),
    );
  }

  const recipes = arrays.get('recipes');
  if (recipes) {
    examples.push(
      ...recipes.elements
        .map((node) => parseCatalogEntry(node, constants))
        .filter((example) => example.id),
    );
  }

  return examples;
}

function parseExample(node, constants) {
  return {
    id: readStringProperty(node, 'id', constants),
    docs: readStringArrayProperty(node, 'docs', constants),
    api: readStringArrayProperty(node, 'api', constants),
    fixtures: readStringArrayProperty(node, 'fixtures', constants),
  };
}

function readStringProperty(node, key, constants) {
  const property = findProperty(node, key);
  if (!property || !ts.isPropertyAssignment(property)) return '';
  return readStringExpression(property.initializer, constants);
}

function readStringArrayProperty(node, key, constants) {
  const property = findProperty(node, key);
  if (!property || !ts.isPropertyAssignment(property)) return [];
  const value = property.initializer;
  if (!ts.isArrayLiteralExpression(value)) return [];
  return value.elements.map((element) => readStringExpression(element, constants)).filter(Boolean);
}

function parseCatalogEntry(node, constants) {
  if (ts.isObjectLiteralExpression(node)) return parseExample(node, constants);
  if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression)) {
    return { id: '', docs: [], api: [], fixtures: [] };
  }

  const args = node.arguments;
  if (node.expression.text === 'seed') {
    return {
      id: readStringExpression(args[0], constants),
      docs: readStringArrayExpression(args[4], constants),
      api: [readStringExpression(args[5], constants)].filter(Boolean),
      fixtures: [readStringExpression(args[6], constants)].filter(Boolean),
    };
  }
  if (node.expression.text === 'recipe') {
    return {
      id: readStringExpression(args[0], constants),
      docs: readStringArrayExpression(args[4], constants),
      api: [readStringExpression(args[5], constants)].filter(Boolean),
      fixtures: readStringArrayExpression(args[7], constants),
    };
  }
  return { id: '', docs: [], api: [], fixtures: [] };
}

function readStringArrayExpression(node, constants) {
  if (!node) return [];
  if (ts.isArrayLiteralExpression(node)) {
    return node.elements.map((element) => readStringExpression(element, constants)).filter(Boolean);
  }
  if (ts.isIdentifier(node)) {
    return constants.has(node.text) ? [constants.get(node.text)] : [];
  }
  return [];
}

function findProperty(node, key) {
  return node.properties.find((property) => {
    if (!ts.isPropertyAssignment(property)) return false;
    const name = property.name;
    return (
      (ts.isIdentifier(name) && name.text === key) ||
      (ts.isStringLiteralLike(name) && name.text === key)
    );
  });
}

function readStringExpression(node, constants) {
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isIdentifier(node)) return constants.get(node.text) ?? '';
  if (ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return '';
}

export async function readReflections(root) {
  const reflectionPath = resolve(root, 'packages/docs/static/api/reflections.json');
  return JSON.parse(await readFile(reflectionPath, 'utf8'));
}

export function buildReflectionIndex(reflections) {
  const byName = new Map();
  const publicNodes = [];
  const publicIds = new Set();

  function add(name, node) {
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name).push(node);
  }

  function visit(node, ancestors) {
    if (!node || typeof node !== 'object') return;

    const name = typeof node.name === 'string' ? node.name : '';
    const publicNode = isOwnPublicReflection(node);
    if (name && publicNode) {
      const names = reflectionNames(name, ancestors);
      if (isModuleLevelPublicReflection(node, ancestors)) {
        const id = typeof node.id === 'number' ? node.id : undefined;
        if (id === undefined || !publicIds.has(id)) {
          if (id !== undefined) publicIds.add(id);
          publicNodes.push({ node, names });
        }
      }
      for (const reflectionName of names) {
        add(reflectionName, node);
      }
    }

    const nextAncestors = name ? [...ancestors, name] : ancestors;
    for (const child of Array.isArray(node.children) ? node.children : []) {
      visit(child, nextAncestors);
    }
    for (const signature of Array.isArray(node.signatures) ? node.signatures : []) {
      visit(signature, ancestors);
    }
  }

  visit(reflections, []);
  return { byName, publicNodes };
}

function reflectionNames(name, ancestors) {
  const names = new Set([name]);
  const meaningfulAncestors = ancestors.filter((ancestor) => !ancestor.startsWith('@'));

  for (let index = meaningfulAncestors.length - 1; index >= 0; index -= 1) {
    names.add([...meaningfulAncestors.slice(index), name].join('.'));
  }

  return [...names];
}

function isOwnPublicReflection(node) {
  const flags = node.flags ?? {};
  if (flags.isExternal || flags.isInherited || flags.isPrivate || flags.isProtected) return false;
  return Array.isArray(node.sources) && node.sources.some((source) => isSourceFile(source.fileName));
}

function isModuleLevelPublicReflection(node, ancestors) {
  if (node.kind === 4096) return false;
  if (node.kind === 1024) return false;
  const meaningfulAncestors = ancestors.filter((ancestor) => !ancestor.startsWith('@'));
  if (meaningfulAncestors.length > 1) return false;
  return node.kind !== 2;
}

function isSourceFile(fileName) {
  return typeof fileName === 'string' && (fileName.startsWith('src/') || fileName.includes('/src/'));
}

export function hasExampleTag(node) {
  return (
    Array.isArray(node.comment?.blockTags) &&
    node.comment.blockTags.some((tag) => tag.tag === '@example' && commentSummaryContentText(tag).trim())
  ) || (
    Array.isArray(node.signatures) &&
    node.signatures.some((signature) => hasExampleTag(signature))
  );
}

function commentSummaryContentText(comment) {
  if (!comment || typeof comment !== 'object') return '';

  const chunks = [];
  if (Array.isArray(comment.summary)) {
    chunks.push(...comment.summary.map((part) => part.text ?? ''));
  }
  if (Array.isArray(comment.content)) {
    chunks.push(...comment.content.map((part) => part.text ?? ''));
  }
  return chunks.join(' ');
}

export function reportViolations(violations) {
  const sorted = [...violations].sort((a, b) => {
    const pathOrder = a.path.localeCompare(b.path);
    return pathOrder === 0 ? a.reason.localeCompare(b.reason) : pathOrder;
  });

  for (const violation of sorted) {
    console.error(`${violation.path}: ${violation.reason}`);
  }

  if (sorted.length > 0) {
    process.exitCode = 1;
  }
}
