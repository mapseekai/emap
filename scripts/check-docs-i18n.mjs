#!/usr/bin/env node
import { join, resolve } from 'node:path';
import {
  buildDocReferenceSet,
  collectDocs,
  fileExists,
  normalizeDocReference,
  parseRootArg,
  readExamples,
  relativePath,
  reportViolations,
} from './docs-check-utils.mjs';

const root = parseRootArg();
const zhRoot = 'packages/docs/docs';
const enRoot = 'packages/docs/i18n/en/docusaurus-plugin-content-docs/current';
const violations = [];

const zhDocs = await collectDocs(root, zhRoot);
const enDocs = await collectDocs(root, enRoot);

for (const [rel, zhDoc] of [...zhDocs.entries()].sort(([a], [b]) => a.localeCompare(b))) {
  const enPath = resolve(root, enRoot, `${rel}.md`);
  const enDoc = enDocs.get(rel);
  const zhId = zhDoc.frontMatter.id || rel;

  if (!enDoc && !(await fileExists(enPath))) {
    violations.push({
      path: relativePath(root, enPath),
      reason: `missing English document for ${zhId}`,
    });
    continue;
  }

  if (!enDoc) continue;

  const enId = enDoc.frontMatter.id;
  if (!enId) {
    violations.push({
      path: relativePath(root, enDoc.path),
      reason: `missing English id for ${zhId}`,
    });
  } else if (enId !== zhId) {
    violations.push({
      path: relativePath(root, enDoc.path),
      reason: `English id ${enId} does not match ${zhId}`,
    });
  }

  if (!enDoc.frontMatter.slug) {
    violations.push({
      path: relativePath(root, enDoc.path),
      reason: `missing English slug for ${zhId}`,
    });
  } else if (enDoc.frontMatter.slug !== zhDoc.frontMatter.slug) {
    violations.push({
      path: relativePath(root, enDoc.path),
      reason: `English slug ${enDoc.frontMatter.slug} does not match ${zhDoc.frontMatter.slug}`,
    });
  }
}

const docReferences = buildDocReferenceSet(zhDocs);
const examples = await readExamples(root);

for (const example of examples) {
  for (const reference of example.docs) {
    if (!docReferences.has(normalizeDocReference(reference))) {
      violations.push({
        path: join('docs-meta/examples.ts', `#${example.id}`),
        reason: `missing catalog docs reference ${reference}`,
      });
    }
  }
}

reportViolations(violations);
