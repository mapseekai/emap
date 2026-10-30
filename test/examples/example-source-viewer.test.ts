// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { examples } from '../../docs-meta/examples';
import type { ExampleSourceFile } from '../../packages/examples/src/example-source-types';
import { renderExampleSource } from '../../packages/examples/src/example-source-viewer';

const example = examples.find((item) => item.id === 'getting-started/lines')!;
const files: ExampleSourceFile[] = ['main.ts', 'style.css'].map((name, index) => ({
  id: name,
  name,
  path: `src/${name}`,
  origin: `packages/examples/src/${name}`,
  language: index === 0 ? 'typescript' : 'css',
  lineCount: 1,
  url: `/sources/${name}.json`,
}));
const response = (value: unknown) => ({ ok: true, json: async () => value });
let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  dispose = undefined;
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});
function mount() {
  const pane = document.createElement('section');
  document.body.append(pane);
  dispose = renderExampleSource(document, pane, example);
  return pane;
}

describe('example source viewer', () => {
  it('keeps the selected file when an older request finishes and copies only its formatted source', async () => {
    let finishFirst!: (value: unknown) => void;
    const first = new Promise((resolve) => {
      finishFirst = resolve;
    });
    const css = 'body { color: red; }\n';
    const writeText = vi.fn(async () => {});
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/manifest.json')) return response({ files, defaultFile: files[0].id });
        if (url === files[0].url) return first;
        return response({
          text: css,
          html: '<pre><code><span aria-hidden="true">1</span>body { color: red; }</code></pre>',
        });
      }),
    );
    const pane = mount();
    await vi.waitFor(() => expect(pane.querySelectorAll('[role="tab"]')).toHaveLength(2));
    pane.querySelector<HTMLButtonElement>('[data-filename="style.css"]')!.click();
    await vi.waitFor(() => expect(pane.querySelector('code')?.textContent).toContain('body {'));
    finishFirst(
      response({ text: 'const old = true;\n', html: '<pre><code>const old = true;</code></pre>' }),
    );
    await first;
    await Promise.resolve();
    expect(pane.querySelector('code')?.textContent).toContain('body {');
    expect(pane.querySelector('a')?.href).toContain('/src/style.css');
    pane.querySelector<HTMLButtonElement>('.example-copy-code')!.click();
    expect(writeText).toHaveBeenCalledWith(css);
    await vi.waitFor(() =>
      expect(pane.querySelector('[role="status"]')?.textContent).toBe('已复制'),
    );
  });

  it('aborts loading on disposal and ignores a late manifest response', async () => {
    let finish!: (value: unknown) => void;
    const pending = new Promise((resolve) => {
      finish = resolve;
    });
    let signal: AbortSignal | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, options: RequestInit) => {
        signal = options.signal as AbortSignal;
        return pending;
      }),
    );
    const pane = mount();
    dispose!();
    expect(signal?.aborted).toBe(true);
    finish(response({ files, defaultFile: files[0].id }));
    await pending;
    await Promise.resolve();
    expect(pane.querySelectorAll('[role="tab"]')).toHaveLength(0);
  });

  it('falls back to safe original HTML when generated source is unavailable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline');
      }),
    );
    const embedded = document.createElement('script');
    embedded.id = 'emap-example-source';
    embedded.type = 'application/json';
    embedded.textContent = JSON.stringify('<img src="example.jpg" onerror="alert(1)">');
    document.body.append(embedded);
    const pane = mount();
    await vi.waitFor(() => expect(pane.querySelector('pre')?.textContent).toContain('<img'));
    expect(pane.querySelector('img')).toBeNull();
    expect(pane.querySelector<HTMLButtonElement>('.example-copy-code')!.disabled).toBe(false);
    expect(pane.querySelector('[role="status"]')?.textContent).toBe('已显示原始 HTML');
  });
});
