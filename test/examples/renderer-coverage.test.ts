import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { examples } from '../../docs-meta/examples';

const src = resolve('packages/examples/src');
function modulesFor(html: string): Map<string, string> {
  const modules = new Map<string, string>();
  function add(name: string, text: string): void {
    if (modules.has(name)) return;
    modules.set(name, text);
    const ast = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true);
    for (const node of ast.statements)
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        const specifier = node.moduleSpecifier.text;
        if (!specifier.startsWith('.') && !specifier.startsWith('/src/')) continue;
        const file = specifier.startsWith('/src/')
          ? resolve(src, specifier.slice(5))
          : resolve(dirname(name), specifier);
        if (!file.startsWith(src + '/')) continue;
        const target = [file, file + '.ts'].find((f) => f.endsWith('.ts') && existsSync(f));
        if (target) add(target, readFileSync(target, 'utf8'));
      }
  }
  let index = 0;
  for (const [, attrs, body] of html.matchAll(
    /<script([^>]*type=["']module["'][^>]*)>([\s\S]*?)<\/script>/g,
  )) {
    const external = /src=["']([^"']+)["']/.exec(attrs)?.[1];
    if (external?.startsWith('/src/')) {
      const file = resolve(src, external.slice(5));
      add(file, readFileSync(file, 'utf8'));
    } else add(resolve(src, 'inline-' + index++ + '.ts'), body);
  }
  return modules;
}
describe('renderer controls cover the complete example manifest', () => {
  for (const example of examples)
    it(example.id, () => {
      const modules = modulesFor(readFileSync(example.source.html, 'utf8'));
      expect([...modules.keys()].some((f) => f.endsWith('/renderer-choice.ts'))).toBe(true);
      const creationSites: string[] = [];
      for (const [file, text] of modules) {
        const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
        function visit(node: ts.Node): void {
          if (
            ts.isCallExpression(node) &&
            /^(?:emap\.)?Emap\.create$/.test(node.expression.getText(ast))
          ) {
            creationSites.push(file);
            const options = node.arguments[0];
            expect(options && ts.isObjectLiteralExpression(options)).toBe(true);
            if (options && ts.isObjectLiteralExpression(options)) {
              const renderer = options.properties.find((p) => p.name?.getText(ast) === 'renderer');
              expect(renderer && ts.isPropertyAssignment(renderer)).toBe(true);
              if (renderer && ts.isPropertyAssignment(renderer)) {
                const value = renderer.initializer.getText(ast);
                // Native raster experiment uses Canvas2D for its interaction host, with its own selected numeric renderer.
                expect(value).toBe(
                  file.endsWith('/luma-raster/main.ts') ? "'canvas2d'" : 'getExampleRenderer()',
                );
              }
            }
          }
          ts.forEachChild(node, visit);
        }
        visit(ast);
      }
      if (!['luma-25d', 'luma-benchmark', 'luma-vertex-editing'].includes(example.id))
        expect(creationSites.length).toBeGreaterThan(0);
    });
});
