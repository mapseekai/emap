import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

interface TypeDocOutputConfig {
  name?: unknown;
  path?: unknown;
}

interface TypeDocConfig {
  entryPoints?: unknown;
  outputs?: unknown;
}

interface ReflectionNode {
  name?: unknown;
  comment?: unknown;
  sources?: unknown;
  children?: unknown;
  signatures?: unknown;
  parameters?: unknown;
}

const INTERNAL_HOST_SURFACES = [
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

function isReflectionNode(value: unknown): value is ReflectionNode {
  return typeof value === 'object' && value !== null;
}

function collectReflectionNames(value: unknown, names = new Set<string>()): Set<string> {
  if (!isReflectionNode(value)) return names;

  if (typeof value.name === 'string') names.add(value.name);

  for (const child of Array.isArray(value.children) ? value.children : []) {
    collectReflectionNames(child, names);
  }
  for (const signature of Array.isArray(value.signatures) ? value.signatures : []) {
    collectReflectionNames(signature, names);
  }

  return names;
}

function collectSourceFileNames(value: unknown, names = new Set<string>()): Set<string> {
  if (!isReflectionNode(value)) return names;

  if (Array.isArray(value.sources)) {
    for (const source of value.sources) {
      if (typeof source === 'object' && source !== null && 'fileName' in source) {
        const fileName = source.fileName;
        if (typeof fileName === 'string') names.add(fileName);
      }
    }
  }

  for (const child of Array.isArray(value.children) ? value.children : []) {
    collectSourceFileNames(child, names);
  }
  for (const signature of Array.isArray(value.signatures) ? value.signatures : []) {
    collectSourceFileNames(signature, names);
  }

  return names;
}

function collectReflectionNodes(value: unknown, nodes: ReflectionNode[] = []): ReflectionNode[] {
  if (!isReflectionNode(value)) return nodes;

  nodes.push(value);
  for (const child of Array.isArray(value.children) ? value.children : []) {
    collectReflectionNodes(child, nodes);
  }
  for (const signature of Array.isArray(value.signatures) ? value.signatures : []) {
    collectReflectionNodes(signature, nodes);
  }

  return nodes;
}

function readCommentText(value: unknown): string {
  if (!isReflectionNode(value) || !isReflectionNode(value.comment)) return '';
  const comment = value.comment as { summary?: unknown; blockTags?: unknown };
  const chunks: string[] = [];

  if (Array.isArray(comment.summary)) {
    chunks.push(...comment.summary.map(readCommentPartText));
  }
  if (Array.isArray(comment.blockTags)) {
    for (const tag of comment.blockTags) {
      if (!isReflectionNode(tag)) continue;
      const content = (tag as { content?: unknown }).content;
      if (Array.isArray(content)) chunks.push(...content.map(readCommentPartText));
    }
  }

  return chunks.join(' ');
}

function readCommentPartText(value: unknown): string {
  if (!isReflectionNode(value)) return '';
  const text = (value as { text?: unknown }).text;
  return typeof text === 'string' ? text : '';
}

describe('TypeDoc public API config', () => {
  it('documents only public package entry points and emits html plus json', async () => {
    const config = JSON.parse(
      await readFile(resolve(process.cwd(), 'typedoc.json'), 'utf8'),
    ) as TypeDocConfig;

    expect(config.entryPoints).toEqual([
      'src/index.ts',
      'src/formats/index.ts',
      'src/duckdb/index.ts',
    ]);

    expect(config.outputs).toEqual([
      { name: 'html', path: 'packages/docs/static/api' },
      { name: 'json', path: 'packages/docs/static/api/reflections.json' },
    ] satisfies TypeDocOutputConfig[]);
  });

  it('omits internal host surfaces from generated reflections', async () => {
    const reflections = JSON.parse(
      await readFile(resolve(process.cwd(), 'packages/docs/static/api/reflections.json'), 'utf8'),
    ) as unknown;

    const names = collectReflectionNames(reflections);

    for (const internalName of INTERNAL_HOST_SURFACES) {
      expect(names.has(internalName)).toBe(false);
    }
  });

  it('omits internal host surfaces from generated Emap HTML', async () => {
    const html = await readFile(
      resolve(process.cwd(), 'packages/docs/static/api/classes/index.Emap.html'),
      'utf8',
    );

    for (const internalName of INTERNAL_HOST_SURFACES) {
      expect(html).not.toContain(internalName);
    }
  });

  it('emits stable source paths in generated reflections', async () => {
    const reflections = JSON.parse(
      await readFile(resolve(process.cwd(), 'packages/docs/static/api/reflections.json'), 'utf8'),
    ) as unknown;

    const sourceFileNames = collectSourceFileNames(reflections);
    expect([...sourceFileNames].some((fileName) => fileName.startsWith('src/'))).toBe(true);

    for (const fileName of sourceFileNames) {
      expect(fileName).not.toContain('.worktrees/');
      if (fileName.includes('src/')) {
        expect(fileName.startsWith('src/')).toBe(true);
      }
    }
  });

  it('does not leak linked worktree paths in generated HTML', async () => {
    const html = await readFile(
      resolve(process.cwd(), 'packages/docs/static/api/classes/index.Emap.html'),
      'utf8',
    );

    expect(html).not.toContain('.worktrees/');
    expect(html).toContain('Defined in src/map/map.ts');
  });

  it('emits checker-compatible public API example and parameter metadata', async () => {
    const reflections = JSON.parse(
      await readFile(resolve(process.cwd(), 'packages/docs/static/api/reflections.json'), 'utf8'),
    ) as unknown;
    const nodes = collectReflectionNodes(reflections);
    const boundsSignature = nodes.find(
      (node) => node.name === 'Bounds' && Array.isArray(node.parameters),
    );

    expect(readCommentText(boundsSignature)).toContain('Runnable example association');

    const xmin = (boundsSignature?.parameters as ReflectionNode[] | undefined)?.find(
      (parameter) => parameter.name === 'xmin',
    );
    const xminComment = readCommentText(xmin);

    expect(xminComment).toContain('Optional');
    expect(xminComment).toContain('Valid value');
    expect(xminComment).toContain('number');
  });
});
