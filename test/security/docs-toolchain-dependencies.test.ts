// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';

function dependency(...chain: string[]) {
  let require = createRequire(resolve('packages/docs/package.json'));
  let entry = '';
  for (const name of ['@docusaurus/core/package.json', ...chain]) {
    entry = require.resolve(name);
    require = createRequire(entry);
  }
  return entry;
}

it('removes namespace and control-character executable links in the docs SVG optimizer', () => {
  const require = createRequire(import.meta.url);
  const { optimize } = require(
    dependency(
      '@docusaurus/bundler/package.json',
      'cssnano/package.json',
      'cssnano-preset-default/package.json',
      'postcss-svgo/package.json',
      'svgo',
    ),
  );
  const optimizeLinks = (content: string) =>
    optimize(
      `<svg xmlns="http://www.w3.org/2000/svg" xmlns:svg="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">${content}</svg>`,
      { plugins: ['removeScriptElement'] },
    ).data;
  for (const tag of ['a', 'svg:a']) {
    for (const attribute of ['href', 'xlink:href']) {
      for (const scheme of [
        'javascript:',
        'java&#9;script:',
        'java&#10;script:',
        'java&#13;script:',
      ]) {
        const output = optimizeLinks(
          `<${tag} ${attribute}="${scheme}alert(1)"><text>label</text></${tag}>`,
        );
        expect(output).not.toContain('href=');
        expect(output).toContain('<text>label</text>');
      }
    }
  }
  const ordinary = optimizeLinks('<a href="https://example.com/guide"><text>guide</text></a>');
  expect(ordinary).toContain('href="https://example.com/guide"');
  expect(ordinary).toContain('<text>guide</text>');
});

it('bounds brace and parenthesis nesting, including direct AST callers, while preserving ordinary globs', () => {
  const entry = dependency('chokidar', 'braces');
  // Fresh processes prevent JIT-dependent stack sizes from hiding the old overflow.
  for (const method of ['parse', 'compile', 'expand', 'stringify']) {
    execFileSync(
      process.execPath,
      [
        '-e',
        `
        const assert = require('node:assert/strict');
        const braces = require(process.argv[1]);
        const method = process.argv[2];
        for (const [open, close] of [['{','}'], ['(',')'], ['({','})']]) {
          const input = open.repeat(2000) + 'x' + close.repeat(2000);
          const run = () => method === 'stringify'
            ? braces.stringify(braces.parse(input)) : braces[method](input);
          assert.throws(run, /nesting depth exceeds limit/);
        }
        if (method !== 'parse') {
          const ast = {type:'root', nodes:[]};
          let node = ast;
          for (let i = 0; i < 2000; i++) {
            const child = {type:'paren', nodes:[], parent:node};
            node.nodes.push(child);
            node = child;
          }
          assert.throws(() => braces[method](ast), /nesting depth exceeds limit/);
        }
        assert.deepEqual(braces.expand('docs/{guide,api}/{a,b}.md'),
          ['docs/guide/a.md','docs/guide/b.md','docs/api/a.md','docs/api/b.md']);
        assert.deepEqual(braces.expand('{1..3}'), ['1','2','3']);
        assert.equal(braces.compile('a/{b,c}.md'), 'a/(b|c).md');
        for (const input of ['"' + '{'.repeat(2000) + '"', '[' + '{'.repeat(2000) + ']', '\\\\{'.repeat(2000)])
          braces.compile(input);
        assert.equal(braces.stringify(braces.parse('a/{b,c}.md')), 'a/{b,c}.md');
      `,
        entry,
        method,
      ],
      { timeout: 5000, encoding: 'utf8' },
    );
  }
});

it('never lets stale directives bypass cache isolation or mandatory revalidation', () => {
  const require = createRequire(import.meta.url);
  const CachePolicy = require(
    dependency(
      'update-notifier',
      'latest-version',
      'package-json',
      'got',
      'cacheable-request',
      'http-cache-semantics',
    ),
  );
  const request: { url: string; method: string; headers: Record<string, string> } = {
    url: 'https://example.com/',
    method: 'GET',
    headers: { host: 'example.com' },
  };
  const staleRequest = {
    ...request,
    headers: { ...request.headers, 'cache-control': 'max-stale=600' },
  };
  const stale = ', stale-if-error=600, stale-while-revalidate=600';
  const policy = (headers: Record<string, string>, shared = true, req = request) => {
    const value = new CachePolicy(req, { status: 200, headers }, { shared });
    value._responseTime -= 1000;
    return value;
  };
  const cases: Record<string, string>[] = [
    { 'cache-control': `max-age=0${stale}`, 'set-cookie': 'session=alice' },
    ...[
      'no-cache',
      'private',
      'no-store',
      'must-revalidate',
      'proxy-revalidate',
      's-maxage=0',
      'No-Cache',
      'Private',
      'No-Store',
      'Must-Revalidate',
      'Proxy-Revalidate',
      'S-Maxage=0',
    ].map((directive) => ({ 'cache-control': `max-age=0, ${directive}${stale}` })),
    { 'cache-control': `max-age=0${stale}`, vary: '*' },
  ];
  for (const headers of cases) {
    const original = policy(headers);
    const legacy = original.toObject();
    legacy.rescc = Object.fromEntries(
      Object.entries(legacy.rescc).map(([key, value]) => [key.toUpperCase(), value]),
    );
    const clockRollback = policy(headers);
    clockRollback._responseTime += 100000;
    for (const value of [
      original,
      CachePolicy.fromObject(original.toObject()),
      CachePolicy.fromObject(legacy),
      policy({ ...headers, age: '-100' }),
      clockRollback,
    ]) {
      for (const maxStale of ['max-stale', 'max-stale=600']) {
        const req = { ...request, headers: { ...request.headers, 'cache-control': maxStale } };
        expect(value.evaluateRequest(req).response, JSON.stringify(headers)).toBeUndefined();
        expect(value.satisfiesWithoutRevalidation(req)).toBe(false);
      }
      expect(value.useStaleWhileRevalidate()).toBe(false);
      expect(value.revalidatedPolicy(request, { status: 500, headers: {} }).matches).toBe(false);
      expect(value.timeToLive()).toBe(0);
    }
  }
  for (const value of [
    policy({ 'cache-control': 'public, max-age=0' }),
    policy({ 'cache-control': 'max-age=0' }),
    policy({ 'cache-control': 'public, max-age=0', 'set-cookie': 'opt-in=yes' }),
    policy({ 'cache-control': 'private, max-age=0', 'set-cookie': 'session=alice' }, false),
    policy({ 'cache-control': 'max-age=600' }),
  ])
    expect(value.satisfiesWithoutRevalidation(staleRequest)).toBe(true);
  const allowed = policy({ 'cache-control': `public, max-age=0${stale}` });
  expect(allowed.useStaleWhileRevalidate()).toBe(true);
  expect(allowed.revalidatedPolicy(request, { status: 500, headers: {} }).matches).toBe(true);
  expect(allowed.timeToLive()).toBeGreaterThan(0);
  const varying = policy({ 'cache-control': `public, max-age=0${stale}`, vary: 'cookie' }, true, {
    ...request,
    headers: { ...request.headers, cookie: 'session=alice' },
  });
  for (const req of [
    { ...request, headers: { ...request.headers, cookie: 'session=bob' } },
    {
      ...request,
      headers: { ...request.headers, cookie: 'session=alice', 'cache-control': 'No-Cache' },
    },
    { ...request, headers: { ...request.headers, cookie: 'session=alice', pragma: 'No-Cache' } },
  ])
    expect(varying.revalidatedPolicy(req, { status: 503, headers: {} }).matches).toBe(false);
  expect(
    allowed.satisfiesWithoutRevalidation({ ...staleRequest, url: 'https://example.com/other' }),
  ).toBe(false);
});
