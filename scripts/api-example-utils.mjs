import { access, readFile, readdir } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

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

export async function readExamples(root) {
  const catalogPath = resolve(root, 'docs-meta/examples.ts');
  const moduleUrl = `${pathToFileURL(catalogPath).href}?check=${Date.now()}`;
  const catalog = await import(moduleUrl);
  if (!Array.isArray(catalog.examples)) {
    throw new Error(`${catalogPath} must export an examples array`);
  }
  return catalog.examples;
}

export async function readReflections(root) {
  const reflectionPath = resolve(root, 'dist/api/reflections.json');
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
