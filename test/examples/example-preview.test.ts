// @vitest-environment jsdom
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { examples } from '../../docs-meta/examples';
import { createExamplePreview } from '../../packages/examples/src/example-preview';

describe('example previews', () => {
  it('provides a separate preview image for every catalog entry', () => {
    const urls = examples.map((example) => {
      const preview = createExamplePreview(example);
      expect(preview, example.id).not.toBeNull();
      const image = preview!.querySelector('img')!;
      expect(image, example.id).toBeTruthy();
      expect(image.loading).toBe('lazy');
      expect(image.alt).toBe('');
      return image.getAttribute('src');
    });
    expect(new Set(urls).size).toBe(examples.length);
  });

  it('ships the capture referenced by each card', async () => {
    for (const example of examples) {
      const preview = createExamplePreview(example);
      expect(preview, example.id).not.toBeNull();
      const src = preview!.querySelector('img')!.getAttribute('src')!;
      const path = src.replace('/mapseekai/emap/examples/', '');
      const image = await readFile(resolve('packages/examples/public', path));
      expect(image.byteLength, example.id).toBeGreaterThan(1000);
      expect([...image.subarray(0, 2)], example.id).toEqual([0xff, 0xd8]);
    }
  });

  it('records a verified capture from every example route', async () => {
    const report: {
      captures: Record<
        string,
        {
          file: string;
          route: string;
          renderer: string;
          painted: number;
          colors: number;
          sha256: string;
          kind?: string;
        }
      >;
    } = JSON.parse(
      await readFile(resolve('packages/examples/public/previews/captures.json'), 'utf8'),
    );
    expect(Object.keys(report.captures).sort()).toEqual(
      examples.map((example) => example.id).sort(),
    );
    for (const example of examples) {
      const capture = report.captures[example.id]!;
      expect(capture.route).toBe(`/mapseekai/emap/examples/${example.id}/`);
      expect(capture.renderer).toBe('webgl2');
      const bytes = await readFile(resolve('packages/examples/public/previews', capture.file));
      expect(createHash('sha256').update(bytes).digest('hex'), example.id).toBe(capture.sha256);
      if (capture.kind === 'runtime-inspector') expect(example.id).toBe('plugin-install');
      else {
        expect(capture.painted, example.id).toBeGreaterThan(8);
        expect(capture.colors, example.id).toBeGreaterThan(1);
      }
    }
  });
});
