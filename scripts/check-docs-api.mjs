#!/usr/bin/env node
import {
  buildReflectionIndex,
  collectFiles,
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
import { readFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';

const root = parseRootArg();
const violations = [];
const GENERATED_MODULE_FILLER = 'public emap API documented for package consumers';
const examples = await readExamples(root);
const reflections = await readReflections(root);
const zhDocs = await collectDocs(root, 'packages/docs/docs');
const enDocs = await collectDocs(
  root,
  'packages/docs/i18n/en/docusaurus-plugin-content-docs/current',
);
const { byName, publicNodes } = buildReflectionIndex(reflections);
const catalogApiNames = new Set();

for (const example of examples) {
  for (const api of example.api) {
    catalogApiNames.add(api);
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

for (const violation of collectModuleFillerViolations(reflections)) {
  violations.push(violation);
}

for (const violation of await collectModulePageFillerViolations(root)) {
  violations.push(violation);
}

reportViolations(violations);

function collectModuleFillerViolations(reflections) {
  const violations = [];

  function visit(node) {
    if (!node || typeof node !== 'object') return;
    if (node.kind === 2 && commentText(node.comment).includes(GENERATED_MODULE_FILLER)) {
      violations.push({
        path: `module:${node.name}`,
        reason: 'generated module filler prose',
      });
    }
    for (const child of Array.isArray(node.children) ? node.children : []) {
      visit(child);
    }
  }

  visit(reflections);
  return violations;
}

async function collectModulePageFillerViolations(root) {
  const moduleRoot = resolve(root, 'packages/docs/static/api/modules');
  const files = await collectFiles(moduleRoot, ['.html']);
  const violations = [];

  for (const file of files) {
    const html = await readFile(file, 'utf8');
    if (html.includes(GENERATED_MODULE_FILLER)) {
      violations.push({
        path: relative(root, file).replaceAll('\\', '/'),
        reason: 'generated module filler prose',
      });
    }
  }

  return violations;
}

function commentText(comment) {
  if (!comment || typeof comment !== 'object') return '';
  const parts = [];
  if (Array.isArray(comment.summary)) parts.push(...comment.summary);
  if (Array.isArray(comment.content)) parts.push(...comment.content);
  return parts.map((part) => part.text ?? '').join(' ');
}
