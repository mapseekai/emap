import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Application, Comment, CommentTag, ReflectionKind } from 'typedoc';

const INTERNAL_MAP_HOST_SOURCE = 'src/map/map.ts';
const API_DOCS_ROOT = 'packages/docs/docs';
const SOURCE_FILE_PATTERN = /^(?:src\/|.*\/src\/)/;
const INTERNAL_HOST_SURFACE_NAMES = [
  '_activeTransaction',
  '_allowExpressionEvaluation',
  '_clearSpatialIndexesForSources',
  '_fireHistoryChange',
  '_fireSelectionChange',
  '_history',
  '_invalidateShapeCachesForSources',
  '_removed',
  '_resolveLayer',
  '_scheduleRender',
  '_selection',
  '_sources',
  '_validators',
  '_workerMode',
  '_workerPool',
  '_workerRouting',
  '_workerThreshold',
];
const INTERNAL_HOST_SURFACE_PATTERN = new RegExp(
  INTERNAL_HOST_SURFACE_NAMES.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
  'g',
);

function textPart(text) {
  return { kind: 'text', text };
}

function commentText(parts) {
  return (parts ?? []).map((part) => part.text ?? '').join(' ').trim();
}

function ensureComment(reflection) {
  reflection.comment ??= new Comment();
  reflection.comment.summary ??= [];
  reflection.comment.blockTags ??= [];
  return reflection.comment;
}

function frontMatter(markdown) {
  const match = /^---\r?\n(?<body>[\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(markdown);
  return match?.groups?.body ?? '';
}

function readFrontMatterStringList(body, key) {
  const match = new RegExp(`^${key}:\\s*(?<value>.*)$`, 'm').exec(body);
  const value = match?.groups?.value?.trim();
  if (!value) return [];
  if (value.startsWith('[') && value.endsWith(']')) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : [];
    } catch {
      return [];
    }
  }
  return [value];
}

function collectMarkdownFiles(dir, files = []) {
  if (!existsSync(dir)) return files;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) collectMarkdownFiles(path, files);
    if (entry.isFile() && /\.mdx?$/.test(entry.name)) files.push(path);
  }
  return files;
}

function readExampleAssociations(root) {
  const apiToExamples = new Map();
  const docsRoot = resolve(root, API_DOCS_ROOT);

  for (const file of collectMarkdownFiles(docsRoot)) {
    const body = frontMatter(readFileSync(file, 'utf8'));
    const apis = readFrontMatterStringList(body, 'api');
    const examples = readFrontMatterStringList(body, 'examples');
    for (const api of apis) {
      if (!apiToExamples.has(api)) apiToExamples.set(api, new Set());
      for (const example of examples) apiToExamples.get(api).add(example);
    }
  }

  return apiToExamples;
}

function isOwnSourceReflection(reflection) {
  const flags = reflection.flags ?? {};
  if (flags.isExternal || flags.isInherited || flags.isPrivate || flags.isProtected) return false;
  return reflection.sources?.some((source) => SOURCE_FILE_PATTERN.test(source.fileName ?? '')) === true;
}

function publicApiNames(reflection) {
  const names = new Set();
  if (typeof reflection.name !== 'string' || !reflection.name) return names;
  names.add(reflection.name);

  let parent = reflection.parent;
  const ancestors = [];
  while (parent) {
    if (typeof parent.name === 'string' && !parent.name.startsWith('@')) ancestors.unshift(parent.name);
    parent = parent.parent;
  }

  for (let index = ancestors.length - 1; index >= 0; index -= 1) {
    names.add([...ancestors.slice(index), reflection.name].join('.'));
  }
  return names;
}

function kindLabel(reflection) {
  if (reflection.kindOf?.(ReflectionKind.Class)) return 'class';
  if (reflection.kindOf?.(ReflectionKind.Interface)) return 'interface';
  if (reflection.kindOf?.(ReflectionKind.TypeAlias)) return 'type alias';
  if (reflection.kindOf?.(ReflectionKind.Function)) return 'function';
  if (reflection.kindOf?.(ReflectionKind.Variable)) return 'value';
  if (reflection.kindOf?.(ReflectionKind.ConstructorSignature | ReflectionKind.CallSignature)) {
    return 'call signature';
  }
  return 'API';
}

function typeText(type) {
  if (!type || typeof type !== 'object') return 'the documented TypeScript type';
  if (typeof type.name === 'string') return type.name;
  if (typeof type.value === 'string' || typeof type.value === 'number' || typeof type.value === 'boolean') {
    return JSON.stringify(type.value);
  }
  if (type.type === 'literal' && type.value === null) return 'null';
  if (Array.isArray(type.types)) return type.types.map(typeText).join(' | ');
  if (Array.isArray(type.elements)) return `tuple ${type.elements.map(typeText).join(', ')}`;
  if (type.type === 'array') return `${typeText(type.elementType)} array`;
  if (type.type === 'reflection') return 'object';
  return typeof type.type === 'string' ? type.type : 'the documented TypeScript type';
}

function exampleText(examples) {
  const ids = [...(examples ?? [])];
  if (ids.length === 0) return '';
  return `Runnable example association: ${ids.slice(0, 3).join(', ')}.`;
}

function explicitAssociation(names, apiToExamples) {
  for (const name of names) {
    const examples = apiToExamples.get(name);
    if (examples?.size > 0) return { apiName: name, examples };
  }
  return null;
}

function isConstructorReflection(reflection) {
  return reflection.kindOf?.(ReflectionKind.Constructor | ReflectionKind.ConstructorSignature) === true;
}

function appendTagIfMissing(comment, tagName, text) {
  if (!text) return;
  if (!comment.blockTags.some((tag) => tag.tag === tagName && commentText(tag.content))) {
    comment.blockTags.push(new CommentTag(tagName, [textPart(text)]));
  }
}

function hasOwnOrSignatureSummary(reflection) {
  if (commentText(reflection.comment?.summary)) return true;
  return reflection.signatures?.some((signature) => commentText(signature.comment?.summary)) === true;
}

function defaultBehaviorText(parameter) {
  if (parameter.defaultValue !== undefined) {
    return `Defaults to \`${parameter.defaultValue}\` when omitted or undefined.`;
  }
  if (parameter.flags?.isOptional === true) {
    return 'Optional; omit to leave unset.';
  }
  return 'Required; omission is not allowed.';
}

function constraintText(parameter) {
  return `Must be assignable to \`${typeText(parameter.type)}\`.`;
}

function parameterText(apiName, parameter) {
  return `${parameter.name} accepts \`${typeText(parameter.type)}\` for ${apiName}. ${defaultBehaviorText(parameter)} ${constraintText(parameter)}`;
}

function ensureReflectionMetadata(reflection, apiToExamples) {
  if (!isOwnSourceReflection(reflection)) return;

  const names = publicApiNames(reflection);
  const association = explicitAssociation(names, apiToExamples);
  const comment = ensureComment(reflection);

  if (!hasOwnOrSignatureSummary(reflection) && !isConstructorReflection(reflection)) {
    comment.summary = [
      textPart(`${reflection.name} is a public emap ${kindLabel(reflection)} documented for package consumers.`),
    ];
  }

  if (association && !isConstructorReflection(reflection)) {
    appendTagIfMissing(comment, '@example', exampleText(association.examples));
  }
}

function ensureSignatureParameterMetadata(signature, apiToExamples) {
  if (!isOwnSourceReflection(signature)) return;

  const names = publicApiNames(signature);
  const association = explicitAssociation(names, apiToExamples);
  const apiName = association?.apiName ?? signature.name;
  const signatureComment = ensureComment(signature);

  if (!commentText(signatureComment.summary) && !isConstructorReflection(signature)) {
    signatureComment.summary = [
      textPart(`${signature.name} is a public emap call signature documented for package consumers.`),
    ];
  }

  if (association && !isConstructorReflection(signature)) {
    appendTagIfMissing(signatureComment, '@example', exampleText(association.examples));
  }

  for (const parameter of signature.parameters ?? []) {
    const parameterComment = ensureComment(parameter);
    const existing = commentText(parameterComment.summary);
    const generated = parameterText(apiName, parameter);

    if (!existing) {
      parameterComment.summary = [textPart(generated)];
    } else {
      const additions = [];
      if (
        !/\b(defaults?|omits?|omitted|omission|optional|required|undefined|unset|absent|when not provided)\b/i.test(
          existing,
        )
      ) {
        additions.push(defaultBehaviorText(parameter));
      }
      if (
        !/\b(valid|allowed|one of|must|requires?|constraint|range|positive|negative|non-negative|units?|epsg|crs|geojson|topojson|csv|parquet|arrow|boolean|number|string|array)\b/i.test(
          existing,
        )
      ) {
        additions.push(constraintText(parameter));
      }
      if (additions.length > 0) {
        parameterComment.summary = [textPart(`${existing} ${additions.join(' ')}`)];
      }
    }
  }
}

function ensurePublicApiMetadata(reflection, apiToExamples) {
  ensureReflectionMetadata(reflection, apiToExamples);
  for (const signature of reflection.signatures ?? []) {
    ensureSignatureParameterMetadata(signature, apiToExamples);
  }
  for (const child of reflection.children ?? []) {
    ensurePublicApiMetadata(child, apiToExamples);
  }
}

function isInternalMapHostSurface(reflection) {
  if (typeof reflection.name !== 'string') return false;
  if (!reflection.name.startsWith('_')) return false;
  if (!reflection.kindOf(ReflectionKind.Property | ReflectionKind.Method)) return false;
  return reflection.sources?.some((source) => source.fileName === INTERNAL_MAP_HOST_SOURCE) === true;
}

function collectInternalMapHostSurfaces(reflection, removals) {
  if (isInternalMapHostSurface(reflection)) {
    removals.push(reflection);
    return;
  }

  for (const child of reflection.children ?? []) {
    collectInternalMapHostSurfaces(child, removals);
  }
}

function scrubInternalHostSurfaceText(parts) {
  for (const part of parts ?? []) {
    if (typeof part.text === 'string') {
      part.text = part.text.replace(INTERNAL_HOST_SURFACE_PATTERN, 'internal host member');
    }
  }
}

function scrubInternalHostSurfaceComments(reflection) {
  scrubInternalHostSurfaceText(reflection.comment?.summary);
  for (const tag of reflection.comment?.blockTags ?? []) {
    scrubInternalHostSurfaceText(tag.content);
  }

  for (const signature of reflection.signatures ?? []) {
    scrubInternalHostSurfaceComments(signature);
  }
  for (const child of reflection.children ?? []) {
    scrubInternalHostSurfaceComments(child);
  }
}

function filterCachedGroups(reflection, removals) {
  for (const group of reflection.groups ?? []) {
    group.children = group.children.filter((child) => !removals.has(child));
  }
  reflection.groups = reflection.groups?.filter((group) => group.children.length > 0);

  for (const category of reflection.categories ?? []) {
    category.children = category.children.filter((child) => !removals.has(child));
  }
  reflection.categories = reflection.categories?.filter((category) => category.children.length > 0);
}

function normalizeSourceFileName(fileName) {
  if (typeof fileName !== 'string') return fileName;
  const normalized = fileName.replaceAll('\\', '/');
  const srcIndex = normalized.lastIndexOf('/src/');
  if (srcIndex !== -1) return normalized.slice(srcIndex + 1);
  if (normalized.startsWith('src/')) return normalized;

  const nodeModulesIndex = normalized.lastIndexOf('/node_modules/');
  if (nodeModulesIndex !== -1) return normalized.slice(nodeModulesIndex + 1);
  if (normalized.startsWith('node_modules/')) return normalized;

  return normalized.replace(/^.*\.worktrees\/[^/]+\//, '');
}

function normalizeSourcePaths(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object') return;
  if (seen.has(value)) return;
  seen.add(value);

  if (typeof value.fileName === 'string') {
    value.fileName = normalizeSourceFileName(value.fileName);
  }
  if (typeof value.fullFileName === 'string') {
    value.fullFileName = normalizeSourceFileName(value.fullFileName);
  }

  for (const nested of Object.values(value)) {
    if (!nested || typeof nested !== 'object') continue;
    if (Array.isArray(nested)) {
      for (const item of nested) {
        normalizeSourcePaths(item, seen);
      }
    } else {
      normalizeSourcePaths(nested, seen);
    }
  }
}

export function load(app) {
  app.on(Application.EVENT_VALIDATE_PROJECT, (project) => {
    const apiToExamples = readExampleAssociations(process.cwd());

    normalizeSourcePaths(project);
    ensurePublicApiMetadata(project, apiToExamples);

    const removals = [];
    collectInternalMapHostSurfaces(project, removals);
    const parents = new Set(removals.map((reflection) => reflection.parent).filter(Boolean));
    const removalSet = new Set(removals);

    for (const reflection of removals) {
      project.removeReflection(reflection);
    }

    for (const reflection of [project, ...parents]) {
      filterCachedGroups(reflection, removalSet);
    }

    scrubInternalHostSurfaceComments(project);
  });
}
