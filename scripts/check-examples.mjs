#!/usr/bin/env node
import { join, resolve } from 'node:path';
import {
  buildDocReferenceSet,
  buildReflectionIndex,
  collectDocs,
  collectFiles,
  fileExists,
  normalizeDocReference,
  parseRootArg,
  readExamples,
  readFrontMatterStringList,
  readReflections,
  relativePath,
  reportViolations,
} from './docs-check-utils.mjs';

const root = parseRootArg();
const examples = await readExamples(root);
const docs = await collectDocs(root, 'packages/docs/docs');
const englishDocs = await collectDocs(
  root,
  'packages/docs/i18n/en/docusaurus-plugin-content-docs/current',
);
const reflections = await readReflections(root);
const { byName } = buildReflectionIndex(reflections);
const docReferences = buildDocReferenceSet(docs);
const violations = [];

const exampleIds = new Set(examples.map((example) => example.id));
const authoredRoutes = await collectFiles(
  resolve(root, 'packages/examples/examples'),
  ['index.html'],
);
for (const routePath of authoredRoutes) {
  const routeId = relativePath(resolve(root, 'packages/examples/examples'), routePath).replace(
    /\/index\.html$/,
    '',
  );
  if (exampleIds.has(routeId)) continue;
  violations.push({
    path: relativePath(root, routePath),
    reason: `missing example catalog entry ${routeId}`,
  });
}

for (const authoredDocs of [docs, englishDocs]) {
  for (const doc of authoredDocs.values()) {
    for (const exampleId of readFrontMatterStringList(doc.frontMatter, 'examples')) {
      if (exampleIds.has(exampleId)) continue;
      violations.push({
        path: relativePath(root, doc.path),
        reason: `missing example catalog entry ${exampleId}`,
      });
    }
  }
}

for (const example of examples) {
  const previewPath = join('packages/examples/public/previews', `${example.id}.jpg`);
  if (!(await fileExists(resolve(root, previewPath)))) {
    violations.push({ path: previewPath, reason: `missing preview capture for ${example.id}` });
  }
  const routePath = await resolveRoutePath(example.id);
  if (!routePath) {
    violations.push({
      path: join('packages/examples/examples', example.id, 'index.html'),
      reason: `missing route module for ${example.id}`,
    });
  }

  for (const fixture of example.fixtures) {
    if (fixture.startsWith('inline:')) continue;
    if (!(await fixtureExists(fixture))) {
      violations.push({
        path: join('docs-meta/examples.ts', `#${example.id}`),
        reason: `missing fixture ${fixture}`,
      });
    }
  }

  for (const reference of example.docs) {
    if (!docReferences.has(normalizeDocReference(reference))) {
      violations.push({
        path: join('docs-meta/examples.ts', `#${example.id}`),
        reason: `missing docs ID ${reference}`,
      });
    }
  }

  for (const api of example.api) {
    if (!byName.has(api)) {
      violations.push({
        path: join('docs-meta/examples.ts', `#${example.id}`),
        reason: `missing API reflection ${api}`,
      });
    }
  }
}

reportViolations(violations);

async function resolveRoutePath(id) {
  const candidates = [
    resolve(root, 'packages/examples/examples', id, 'index.html'),
    resolve(root, 'packages/examples/src/examples', `${id}.ts`),
    resolve(root, 'packages/examples/src/examples', `${id}.tsx`),
    resolve(root, 'packages/examples/src/examples', id, 'index.ts'),
    resolve(root, 'packages/examples/src/examples', id, 'index.tsx'),
  ];

  for (const candidate of candidates) {
    if (await fileExists(candidate)) return candidate;
  }
  return null;
}

async function fixtureExists(fixture) {
  const normalizedFixture = fixture.replace(/^fixtures\//, '');
  const candidates = [
    resolve(root, 'packages/examples/public/fixtures', fixture),
    resolve(root, 'packages/examples/public/fixtures', normalizedFixture),
    resolve(root, 'packages/examples/fixtures', fixture),
    resolve(root, 'packages/examples/fixtures', normalizedFixture),
    resolve(root, 'test/fixtures', fixture),
    resolve(root, 'test/fixtures', normalizedFixture),
  ];

  for (const candidate of candidates) {
    if (await fileExists(candidate)) return true;
  }
  return false;
}
