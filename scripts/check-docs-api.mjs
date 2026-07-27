#!/usr/bin/env node
import { join } from 'node:path';
import {
  buildReflectionIndex,
  hasCommentText,
  hasExampleTag,
  hasParameterComment,
  parseRootArg,
  readExamples,
  readReflections,
  reportViolations,
} from './docs-check-utils.mjs';

const root = parseRootArg();
const violations = [];
const examples = await readExamples(root);
const reflections = await readReflections(root);
const { byName, publicNodes } = buildReflectionIndex(reflections);
const catalogApiNames = new Set();

for (const example of examples) {
  for (const api of example.api) {
    catalogApiNames.add(api);
    const nodes = byName.get(api) ?? [];
    if (nodes.length === 0) {
      violations.push({
        path: join('docs-meta/examples.ts', `#${example.id}`),
        reason: `missing API reflection ${api}`,
      });
    }
  }
}

for (const api of [...catalogApiNames].sort()) {
  const nodes = byName.get(api) ?? [];
  if (nodes.length === 0) continue;

  if (!nodes.some(hasExampleTag)) {
    violations.push({
      path: api,
      reason: 'missing public API @example association',
    });
  }

  if (!nodes.some(hasCommentText)) {
    violations.push({
      path: api,
      reason: 'missing public API comment text',
    });
  }

  const parameterNames = new Set(
    nodes.flatMap((node) =>
      Array.isArray(node.parameters) ? node.parameters.map((parameter) => parameter.name) : [],
    ),
  );
  for (const parameterName of [...parameterNames].sort()) {
    if (!nodes.some((node) => hasParameterComment(node, parameterName))) {
      violations.push({
        path: `${api}.${parameterName}`,
        reason: 'missing parameter comment text',
      });
    }
  }
}

for (const { node, names } of publicNodes) {
  if (names.some((name) => catalogApiNames.has(name))) continue;

  const symbolName = names[0];
  if (!hasExampleTag(node)) {
    violations.push({
      path: symbolName,
      reason: 'missing public API @example association',
    });
  }

  if (!hasCommentText(node)) {
    violations.push({
      path: symbolName,
      reason: 'missing public API comment text',
    });
  }

  for (const parameter of Array.isArray(node.parameters) ? node.parameters : []) {
    if (!hasParameterComment(node, parameter.name)) {
      violations.push({
        path: `${symbolName}.${parameter.name}`,
        reason: 'missing parameter comment text',
      });
    }
  }
}

reportViolations(violations);
