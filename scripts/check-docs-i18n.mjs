#!/usr/bin/env node
import { join, resolve } from 'node:path';
import {
  buildDocReferenceSet,
  collectDocs,
  fileExists,
  hasFrontMatterField,
  normalizeDocReference,
  parseRootArg,
  readFrontMatterString,
  readFrontMatterStringList,
  readExamples,
  relativePath,
  reportViolations,
} from './docs-check-utils.mjs';

const root = parseRootArg();
const zhRoot = 'packages/docs/docs';
const enRoot = 'packages/docs/i18n/en/docusaurus-plugin-content-docs/current';
const requiredFields = ['id', 'slug', 'api', 'examples', 'stability', 'verifiedVersion'];
const listFields = ['api', 'examples'];
const scalarFields = ['id', 'slug', 'stability', 'verifiedVersion'];
const validStabilityValues = new Set(['stable', 'experimental', 'deprecated']);
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

  validateRequiredFrontMatter(zhDoc, 'Chinese');
  validateRequiredFrontMatter(enDoc, 'English');
  validateFrontMatterValues(zhDoc, 'Chinese');
  validateFrontMatterValues(enDoc, 'English');
  validateFrontMatterParity(zhDoc, enDoc);
}

for (const [rel, enDoc] of [...enDocs.entries()].sort(([a], [b]) => a.localeCompare(b))) {
  if (zhDocs.has(rel)) continue;
  violations.push({
    path: relativePath(root, enDoc.path),
    reason: `missing Chinese document for ${readFrontMatterString(enDoc.frontMatter, 'id') || rel}`,
  });
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

function validateRequiredFrontMatter(doc, localeName) {
  const id = readFrontMatterString(doc.frontMatter, 'id') || doc.rel;
  for (const field of requiredFields) {
    if (!hasFrontMatterField(doc.frontMatter, field)) {
      violations.push({
        path: relativePath(root, doc.path),
        reason: `missing ${localeName} ${field} for ${id}`,
      });
    }
  }
}

function validateFrontMatterValues(doc, localeName) {
  const id = readFrontMatterString(doc.frontMatter, 'id') || doc.rel;
  const slug = readFrontMatterString(doc.frontMatter, 'slug');
  const stability = readFrontMatterString(doc.frontMatter, 'stability');
  const verifiedVersion = readFrontMatterString(doc.frontMatter, 'verifiedVersion');
  const expectedId = expectedDocId(doc.rel);

  if (readFrontMatterString(doc.frontMatter, 'id') !== expectedId) {
    violations.push({
      path: relativePath(root, doc.path),
      reason: `${localeName} id ${readFrontMatterString(
        doc.frontMatter,
        'id',
      )} does not match ${expectedId}`,
    });
  }
  if (!slug.startsWith('/')) {
    violations.push({
      path: relativePath(root, doc.path),
      reason: `${localeName} slug ${slug} must start with / for ${id}`,
    });
  }
  if (!validStabilityValues.has(stability)) {
    violations.push({
      path: relativePath(root, doc.path),
      reason: `${localeName} stability ${stability} is not valid for ${id}`,
    });
  }
  if (verifiedVersion !== 'unreleased' && !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(verifiedVersion)) {
    violations.push({
      path: relativePath(root, doc.path),
      reason: `${localeName} verifiedVersion ${verifiedVersion} is not valid for ${id}`,
    });
  }
  for (const field of listFields) {
    const raw = doc.frontMatter[field];
    if (!Array.isArray(raw) && !/^\s*\[.*\]\s*$/.test(String(raw ?? ''))) {
      violations.push({
        path: relativePath(root, doc.path),
        reason: `${localeName} ${field} must be an array for ${id}`,
      });
    }
  }
}

function expectedDocId(rel) {
  return rel.split('/').at(-1) ?? rel;
}

function validateFrontMatterParity(zhDoc, enDoc) {
  const id = readFrontMatterString(zhDoc.frontMatter, 'id') || zhDoc.rel;

  for (const field of scalarFields) {
    const zhValue = readFrontMatterString(zhDoc.frontMatter, field);
    const enValue = readFrontMatterString(enDoc.frontMatter, field);
    if (enValue !== zhValue) {
      violations.push({
        path: relativePath(root, enDoc.path),
        reason: `English ${field} ${enValue} does not match ${zhValue} for ${id}`,
      });
    }
  }

  for (const field of listFields) {
    const zhValue = readFrontMatterStringList(zhDoc.frontMatter, field);
    const enValue = readFrontMatterStringList(enDoc.frontMatter, field);
    if (JSON.stringify(enValue) !== JSON.stringify(zhValue)) {
      violations.push({
        path: relativePath(root, enDoc.path),
        reason: `English ${field} ${JSON.stringify(enValue)} does not match ${JSON.stringify(zhValue)} for ${id}`,
      });
    }
  }
}
