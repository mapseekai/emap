#!/usr/bin/env node
import { join, resolve } from 'node:path';
import {
  buildReflectionIndex,
  collectFiles,
  fileExists,
  parseRootArg,
  readExamples,
  readReflections,
  relativePath,
  reportViolations,
} from './api-example-utils.mjs';

const root = parseRootArg();
const examples = await readExamples(root);
const reflections = await readReflections(root);
const { byName } = buildReflectionIndex(reflections);
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
