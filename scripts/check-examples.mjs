#!/usr/bin/env node
import { join, resolve } from 'node:path';
import {
  buildDocReferenceSet,
  buildReflectionIndex,
  collectDocs,
  fileExists,
  normalizeDocReference,
  parseRootArg,
  readExamples,
  readReflections,
  reportViolations,
} from './docs-check-utils.mjs';

const root = parseRootArg();
const examples = await readExamples(root);
const docs = await collectDocs(root, 'packages/docs/docs');
const reflections = await readReflections(root);
const { byName } = buildReflectionIndex(reflections);
const docReferences = buildDocReferenceSet(docs);
const violations = [];

for (const example of examples) {
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
  const candidates = [
    resolve(root, 'packages/examples/public/fixtures', fixture),
    resolve(root, 'packages/examples/fixtures', fixture),
    resolve(root, 'test/fixtures', fixture),
  ];

  for (const candidate of candidates) {
    if (await fileExists(candidate)) return true;
  }
  return false;
}
