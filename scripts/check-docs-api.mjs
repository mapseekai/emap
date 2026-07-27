#!/usr/bin/env node
import {
  buildReflectionIndex,
  collectDocs,
  getPublicParameterNames,
  hasCommentText,
  hasExampleTag,
  hasParameterComment,
  hasParameterConstraints,
  hasParameterDefaultBehavior,
  hasParameterRunnableExample,
  parseRootArg,
  readFrontMatterStringList,
  readExamples,
  readReflections,
  reportViolations,
} from './docs-check-utils.mjs';

const root = parseRootArg();
const violations = [];
const examples = await readExamples(root);
const reflections = await readReflections(root);
const zhDocs = await collectDocs(root, 'packages/docs/docs');
const enDocs = await collectDocs(
  root,
  'packages/docs/i18n/en/docusaurus-plugin-content-docs/current',
);
const { byName, publicNodes } = buildReflectionIndex(reflections);
const catalogApiNames = new Set();
const exampleApiNames = new Set();

for (const example of examples) {
  for (const api of example.api) {
    catalogApiNames.add(api);
    exampleApiNames.add(api);
  }
}

for (const docs of [zhDocs, enDocs]) {
  for (const doc of docs.values()) {
    for (const api of readFrontMatterStringList(doc.frontMatter, 'api')) {
      catalogApiNames.add(api);
    }
  }
}

for (const api of [...catalogApiNames].sort()) {
  const nodes = byName.get(api) ?? [];
  if (nodes.length === 0) {
    violations.push({
      path: `api:${api}`,
      reason: `missing API reflection ${api}`,
    });
    continue;
  }

  if (!exampleApiNames.has(api)) continue;

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

  const parameterNames = new Set(nodes.flatMap(getPublicParameterNames));
  for (const parameterName of [...parameterNames].sort()) {
    if (!nodes.some((node) => hasParameterComment(node, parameterName))) {
      violations.push({
        path: `${api}.${parameterName}`,
        reason: 'missing parameter semantic description',
      });
    }
    if (!nodes.some((node) => hasParameterDefaultBehavior(node, parameterName))) {
      violations.push({
        path: `${api}.${parameterName}`,
        reason: 'missing parameter default/omission behavior',
      });
    }
    if (!nodes.some((node) => hasParameterConstraints(node, parameterName))) {
      violations.push({
        path: `${api}.${parameterName}`,
        reason: 'missing parameter constraints/valid values',
      });
    }
    if (!nodes.some(hasParameterRunnableExample)) {
      violations.push({
        path: `${api}.${parameterName}`,
        reason: 'missing parameter runnable example association',
      });
    }
  }
}

for (const entry of publicNodes) {
  if (entry.names.some((name) => catalogApiNames.has(name))) continue;
  violations.push({
    path: entry.names[0],
    reason: 'uncataloged public API reflection',
  });
}

reportViolations(violations);
