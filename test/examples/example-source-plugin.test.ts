// @vitest-environment node
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { examples } from '../../docs-meta/examples';
import { createExampleSourceBuilder } from '../../packages/examples/build/example-source-plugin';

describe('example source generation', () => {
  it('formats compact HTML, scripts and styles and includes real implementation dependencies', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'emap-source-'));
    const root = resolve(directory, 'packages/examples');
    await mkdir(resolve(root, 'examples/demo'), { recursive: true });
    await mkdir(resolve(root, 'src/demo'), { recursive: true });
    const origin = 'packages/examples/examples/demo/index.html';
    const html =
      '<!doctype html><html><head><style>body{margin:0;color:red}</style></head><body><div id="map"></div><script type="module">import {start} from "/src/demo/main.ts";const options={enabled:true};start(options);</script></body></html>';
    await writeFile(resolve(directory, origin), html);
    await writeFile(
      resolve(root, 'src/demo/main.ts'),
      "import {value} from './value';export function start(options:{enabled:boolean}){return options.enabled?value:0;}",
    );
    await writeFile(resolve(root, 'src/demo/value.ts'), 'export const value=1;');
    const builder = createExampleSourceBuilder(root);
    try {
      const manifest = await builder.build({ id: 'demo', source: { html: origin } });
      expect(manifest.files.map((file) => file.language)).toEqual([
        'javascript',
        'typescript',
        'typescript',
        'css',
        'html',
      ]);
      expect(manifest.defaultFile).toBe('examples/demo/index.html.script.js');
      const css = manifest.files.find((file) => file.language === 'css')!;
      expect(builder.assets.get(css.id)?.text).toContain('body {\n  margin: 0;\n  color: red;\n}');
      const complete = builder.assets.get('examples/demo/index.html')!;
      expect(complete.lineCount).toBeGreaterThan(10);
      expect(complete.html).toContain('class="shiki github-light"');
      expect(complete.html).toContain('example-source-line-number');
      expect(complete.html).toContain('aria-hidden="true"');
      expect(await readFile(resolve(directory, origin), 'utf8')).toBe(html);
    } finally {
      await builder.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('generates formatted and highlighted source for every example without injecting executable markup', async () => {
    const builder = createExampleSourceBuilder(resolve('packages/examples'));
    try {
      for (const example of examples) {
        const manifest = await builder.build(example);
        expect(
          manifest.files.some((file) => file.id === manifest.defaultFile),
          example.id,
        ).toBe(true);
        expect(
          manifest.files.some((file) => file.language === 'html'),
          example.id,
        ).toBe(true);
        for (const file of manifest.files) {
          const content = builder.assets.get(file.id)!;
          expect(content.text.endsWith('\n'), file.id).toBe(true);
          expect(content.lineCount, file.id).toBeGreaterThan(0);
          expect(content.html, file.id).not.toMatch(/<(?:script|iframe|img)\b/i);
        }
      }
      const main = builder.assets.get('src/symbol-controls/main.ts')!;
      expect(main.language).toBe('typescript');
      expect(main.text).toContain('mountSymbolStyleExample');
    } finally {
      await builder.dispose();
    }
  }, 60000);
});
