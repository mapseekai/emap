import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, relative, resolve, sep } from 'node:path';
import { parse, type DefaultTreeAdapterTypes } from 'parse5';
import { format } from 'prettier';
import { createHighlighter } from 'shiki';
import ts from 'typescript';
import type { Plugin } from 'vite';
import type { ExampleDefinition } from '../../../docs-meta/examples';
import type {
  ExampleSourceFile,
  ExampleSourceManifest,
  HighlightedExampleSource,
  SourceLanguage,
} from '../src/example-source-types';

const base = '/mapseekai/emap/examples/';
const languages: Record<string, SourceLanguage> = {
  '.html': 'html',
  '.js': 'javascript',
  '.ts': 'typescript',
  '.css': 'css',
  '.json': 'json',
};
const parsers = {
  html: 'html',
  javascript: 'babel',
  typescript: 'typescript',
  css: 'css',
  json: 'json',
};
const sharedHostFiles = new Set(['src/example-runtime.ts', 'src/renderer-choice.ts']);
const slash = (path: string) => path.split(sep).join('/');

/** Build-only formatting and highlighting. No parser or highlighter ships to the map. */
export function createExampleSourceBuilder(root: string) {
  let highlighter: ReturnType<typeof createHighlighter> | undefined;
  let disposed = false;
  const getHighlighter = () =>
    (highlighter ??= createHighlighter({
      themes: ['github-light'],
      langs: Object.values(languages),
    }));
  const assets = new Map<string, HighlightedExampleSource>();
  const formatted = new Map<string, Promise<HighlightedExampleSource>>();

  async function highlight(key: string, text: string, language: SourceLanguage) {
    let pending = formatted.get(key);
    if (!pending) {
      pending = (async () => {
        const code = await format(text, {
          parser: parsers[language],
          printWidth: 100,
          tabWidth: 2,
          singleQuote: true,
          trailingComma: 'all',
          endOfLine: 'lf',
        });
        const display = code.replace(/\n$/, '');
        const result: HighlightedExampleSource = {
          text: code,
          language,
          lineCount: display.split('\n').length,
          html: (await getHighlighter()).codeToHtml(display, {
            lang: language,
            theme: 'github-light',
            tabindex: false,
            transformers: [
              {
                line(node, number) {
                  node.children.unshift({
                    type: 'element',
                    tagName: 'span',
                    properties: {
                      className: ['example-source-line-number'],
                      'aria-hidden': 'true',
                    },
                    children: [{ type: 'text', value: String(number) }],
                  });
                },
              },
            ],
          }),
        };
        assets.set(key, result);
        return result;
      })();
      formatted.set(key, pending);
    }
    return pending;
  }

  async function build(example: Pick<ExampleDefinition, 'id' | 'source'>) {
    const path = resolve(root, '../..', example.source.html);
    const html = await readFile(path, 'utf8');
    const files: ExampleSourceFile[] = [];
    const visited = new Set<string>();
    const entries: string[] = [];
    const inlineScripts: string[] = [];
    const inlineStyles: string[] = [];
    const htmlTree = parse(html);
    const walk = (node: DefaultTreeAdapterTypes.Node) => {
      if ('tagName' in node) {
        const attribute = (name: string) => node.attrs.find((item) => item.name === name)?.value;
        const text = node.childNodes
          .filter((child) => child.nodeName === '#text')
          .map((child) => (child as DefaultTreeAdapterTypes.TextNode).value)
          .join('');
        if (node.tagName === 'script' && attribute('type') === 'module') {
          if (attribute('src')) entries.push(attribute('src')!);
          else if (text.trim()) inlineScripts.push(text);
        }
        if (node.tagName === 'style' && text.trim()) inlineStyles.push(text);
        if (node.tagName === 'link' && attribute('rel') === 'stylesheet' && attribute('href'))
          entries.push(attribute('href')!);
      }
      if ('childNodes' in node) for (const child of node.childNodes) walk(child);
    };
    walk(htmlTree);

    async function add(
      key: string,
      text: string,
      language: SourceLanguage,
      name: string,
      origin: string,
      displayPath: string,
    ) {
      const content = await highlight(key, text, language);
      const url = `${base}sources/files/${key}.json`;
      const file = {
        id: key,
        name,
        path: displayPath,
        origin,
        language,
        url,
        lineCount: content.lineCount,
      };
      files.push(file);
      return file;
    }

    async function dependency(specifier: string, importer: string): Promise<string | undefined> {
      const clean = specifier.split('?')[0];
      if (!clean.startsWith('/src/') && !clean.startsWith('.')) return;
      const candidate = clean.startsWith('/src/')
        ? resolve(root, clean.slice(1))
        : resolve(dirname(importer), clean);
      const local = slash(relative(root, candidate));
      if (!/^(src|examples)\//.test(local) || local.split('/').includes('..')) return;
      for (const filename of [
        candidate,
        `${candidate}.ts`,
        `${candidate}.js`,
        resolve(candidate, 'index.ts'),
      ]) {
        if (!languages[extname(filename)]) continue;
        try {
          if ((await stat(filename)).isFile()) return filename;
        } catch (error) {
          if (
            (error as NodeJS.ErrnoException).code !== 'ENOENT' &&
            (error as NodeJS.ErrnoException).code !== 'ENOTDIR'
          )
            throw error;
        }
      }
    }

    async function collect(filename: string) {
      if (visited.has(filename)) return;
      visited.add(filename);
      const local = slash(relative(root, filename));
      if (sharedHostFiles.has(local)) return;
      const text = await readFile(filename, 'utf8');
      const language = languages[extname(filename)];
      await add(
        local,
        text,
        language,
        local.replace(/^src\//, ''),
        `packages/examples/${local}`,
        local,
      );
      if (language === 'javascript' || language === 'typescript') {
        for (const item of ts.preProcessFile(text, true, true).importedFiles) {
          const child = await dependency(item.fileName, filename);
          if (child) await collect(child);
        }
      }
    }

    const localHtml = slash(relative(root, path));
    const inline = inlineScripts.join('\n\n');
    if (inline)
      await add(
        `${localHtml}.script.js`,
        inline,
        'javascript',
        'JavaScript',
        example.source.html,
        `${localHtml} › <script type="module">`,
      );
    for (const entry of [
      ...entries,
      ...ts.preProcessFile(inline, true, true).importedFiles.map((item) => item.fileName),
    ]) {
      const filename = await dependency(entry, path);
      if (filename) await collect(filename);
    }
    const firstImplementation = files.find(
      (file) => file.id.startsWith('src/') && file.language !== 'css',
    );
    if (inlineStyles.length)
      await add(
        `${localHtml}.style.css`,
        inlineStyles.join('\n\n'),
        'css',
        'CSS',
        example.source.html,
        `${localHtml} › <style>`,
      );
    await add(localHtml, html, 'html', '完整 HTML', example.source.html, localHtml);
    const manifest: ExampleSourceManifest = {
      files,
      defaultFile: inline ? files[0].id : (firstImplementation?.id ?? files[0].id),
    };
    return manifest;
  }

  return {
    build,
    assets,
    clear() {
      formatted.clear();
      assets.clear();
    },
    async dispose() {
      if (!disposed) {
        disposed = true;
        if (highlighter) (await highlighter).dispose();
      }
    },
  };
}

export function exampleSourcePlugin(root: string, examples: readonly ExampleDefinition[]): Plugin {
  const builder = createExampleSourceBuilder(root);
  const routes = new Map(examples.map((example) => [example.id, example]));
  let building = false;
  return {
    name: 'emap-example-sources',
    configResolved(config) {
      building = config.command === 'build';
    },
    async buildStart() {
      if (!building) return;
      for (const example of examples) {
        const manifest = await builder.build(example);
        this.emitFile({
          type: 'asset',
          fileName: `sources/${example.id}/manifest.json`,
          source: JSON.stringify(manifest),
        });
      }
      for (const [key, source] of builder.assets)
        this.emitFile({
          type: 'asset',
          fileName: `sources/files/${key}.json`,
          source: JSON.stringify(source),
        });
    },
    configureServer(server) {
      server.watcher.on('change', () => builder.clear());
      server.middlewares.use((request, response, next) => {
        const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
        const prefix = `${base}sources/`;
        if (!pathname.startsWith(prefix)) return next();
        void (async () => {
          const path = decodeURIComponent(pathname.slice(prefix.length));
          let value: ExampleSourceManifest | HighlightedExampleSource | undefined;
          if (path.endsWith('/manifest.json')) {
            const example = routes.get(path.slice(0, -'/manifest.json'.length));
            if (example) value = await builder.build(example);
          } else if (path.startsWith('files/') && path.endsWith('.json'))
            value = builder.assets.get(path.slice(6, -5));
          response.statusCode = value ? 200 : 404;
          response.setHeader('Content-Type', 'application/json; charset=utf-8');
          response.end(JSON.stringify(value ?? { error: 'Source file not found' }));
        })().catch((error) => {
          response.statusCode = 500;
          response.end(JSON.stringify({ error: String(error) }));
        });
      });
      server.httpServer?.once('close', () => {
        void builder.dispose();
      });
    },
    async closeBundle() {
      await builder.dispose();
    },
  };
}
