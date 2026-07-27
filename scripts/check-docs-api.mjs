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

for (const example of examples) {
  for (const api of example.api) {
    if (!byName.has(api)) {
      violations.push({
        path: join('docs-meta/examples.ts', `#${example.id}`),
        reason: `missing API reflection ${api}`,
      });
    }
  }
}

for (const { node, names } of publicNodes) {
  if (!hasExampleTag(node)) continue;

  const symbolName = names[0];
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
