import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Comment, CommentTag, Converter, ReflectionKind } from 'typedoc';

const DOCS_ROOT = 'packages/docs/docs';
const INTERNAL_MAP_HOST_SOURCE = 'src/map/map.ts';
const INTERNAL_HOST_MEMBER = /\b_[A-Za-z][A-Za-z0-9]*\b/g;

function textPart(text) {
  return { kind: 'text', text };
}

function frontMatter(markdown) {
  return /^---\r?\n(?<body>[\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(markdown)?.groups?.body ?? '';
}

function frontMatterList(body, key) {
  const value = new RegExp(`^${key}:\\s*(?<value>.*)$`, 'm').exec(body)?.groups?.value?.trim();
  if (!value) return [];
  if (!value.startsWith('[')) return [value];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function markdownFiles(root) {
  if (!existsSync(root)) return [];
  return readdirSync(root, { recursive: true })
    .filter((path) => typeof path === 'string' && /\.mdx?$/.test(path))
    .map((path) => join(root, path));
}

function exampleAssociations(root) {
  const associations = new Map();
  for (const file of markdownFiles(resolve(root, DOCS_ROOT))) {
    const metadata = frontMatter(readFileSync(file, 'utf8'));
    const examples = frontMatterList(metadata, 'examples');
    for (const api of frontMatterList(metadata, 'api')) {
      const current = associations.get(api) ?? new Set();
      for (const example of examples) current.add(example);
      associations.set(api, current);
    }
  }
  return associations;
}

function normalizedSourceName(reflection) {
  for (const source of reflection.sources ?? []) {
    const name = (source.fileName ?? '').replaceAll('\\', '/');
    const index = name.lastIndexOf('/src/');
    if (index >= 0) return name.slice(index + 1);
    if (name.startsWith('src/')) return name;
  }
  return '';
}

function publicNames(reflection) {
  if (!reflection.name || reflection.name.startsWith('@')) return [];
  const ancestors = [];
  for (let parent = reflection.parent; parent; parent = parent.parent) {
    if (parent.name && !parent.name.startsWith('@')) ancestors.unshift(parent.name);
  }
  const names = [reflection.name];
  for (let index = ancestors.length - 1; index >= 0; index -= 1) {
    names.push([...ancestors.slice(index), reflection.name].join('.'));
  }
  return names;
}

function addExampleTag(reflection, associations) {
  const examples = publicNames(reflection)
    .map((name) => associations.get(name))
    .find((items) => items?.size);
  if (!examples) return;

  reflection.comment ??= new Comment();
  reflection.comment.blockTags ??= [];
  if (reflection.comment.blockTags.some((tag) => tag.tag === '@example')) return;
  reflection.comment.blockTags.push(
    new CommentTag('@example', [
      textPart(`Runnable examples: ${[...examples].slice(0, 3).join(', ')}.`),
    ]),
  );
}

function visit(reflection, associations, removals) {
  const isInternalMapMember =
    reflection.name?.startsWith('_') &&
    reflection.kindOf?.(ReflectionKind.Property | ReflectionKind.Method) &&
    normalizedSourceName(reflection) === INTERNAL_MAP_HOST_SOURCE;

  if (isInternalMapMember) {
    removals.push(reflection);
    return;
  }

  addExampleTag(reflection, associations);
  for (const part of reflection.comment?.summary ?? []) {
    if (typeof part.text === 'string') {
      part.text = part.text.replace(INTERNAL_HOST_MEMBER, 'internal host member');
    }
  }
  for (const child of reflection.children ?? []) visit(child, associations, removals);
  for (const signature of reflection.signatures ?? []) visit(signature, associations, removals);
}

export function load(app) {
  const associations = exampleAssociations(process.cwd());
  app.converter.on(Converter.EVENT_RESOLVE_END, (context) => {
    const removals = [];
    visit(context.project, associations, removals);
    for (const reflection of removals) context.project.removeReflection(reflection);
  });
}
