import { mkdir, readFile, copyFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
const require = createRequire(import.meta.url);
const { build } = await import(pathToFileURL(createRequire(require.resolve('vite')).resolve('esbuild')).href);
const root = resolve(dirname(fileURLToPath(import.meta.url)),'..');
const output = join(root,'dist/msdf');
await mkdir(join(output,'fonts'),{ recursive:true });
await build({ entryPoints:[join(root,'src/integrations/msdf/worker-entry.ts')], outfile:join(root,'dist/emap-msdf-worker.js'), bundle:true, format:'iife', platform:'browser', target:'es2022', minify:true,
  define:{process:'undefined'}, plugins:[{ name:'unused-node-branch', setup(b){b.onResolve({filter:/^(fs|path|node:fs|node:path)$/},a=>({path:a.path,namespace:'unused-node'}));b.onLoad({filter:/.*/,namespace:'unused-node'},()=>({contents:'export default {};',loader:'js'}));} }] });
await copyFile(join(root,'node_modules/msdfgen-wasm/wasm/msdfgen.wasm'),join(output,'msdfgen.wasm'));
await copyFile(join(root,'node_modules/harfbuzzjs/hb.wasm'),join(output,'hb.wasm'));
for (const [from,to] of [['msdfgen-wasm/LICENCE','msdfgen-LICENSE.txt'],['harfbuzzjs/LICENSE','harfbuzzjs-LICENSE.txt'],['bidi-js/LICENSE.txt','bidi-LICENSE.txt']]) await copyFile(join(root,'node_modules',from),join(output,to));
const manifest = {};
for (const [group,name] of [['sans-serif','noto-sans-sc'],['serif','noto-serif-sc'],['monospace','noto-sans-mono']]) {
  const source = join(root,'node_modules/@fontsource',name);
  await copyFile(join(source,'LICENSE'),join(output,'fonts',`${name}-LICENSE.txt`));
  for (const weight of [400,700]) {
    const css = await readFile(join(source,`${weight}.css`),'utf8'), entries = [];
    for (const match of css.matchAll(/@font-face\s*\{([^}]+)\}/g)) {
      const file = match[1].match(/url\(\.\/files\/([^)]+\.woff)\)/)?.[1];
      const range = match[1].match(/unicode-range:\s*([^;]+)/)?.[1];
      if (!file || !range) throw new Error(`Invalid Fontsource font declaration in ${name}`);
      const ranges = range.split(',').map(r=>{const [a,b]=r.trim().replace(/^U\+/i,'').split('-');return [parseInt(a,16),parseInt(b??a,16)];});
      await copyFile(join(source,'files',file),join(output,'fonts',file));
      entries.unshift({url:`fonts/${file}`,ranges});
    }
    manifest[`${group}:${weight}`] = entries;
  }
}
await writeFile(join(output,'fonts.json'),JSON.stringify(manifest));
console.log('Built local MSDF worker, HarfBuzz/msdfgen WASM and lazy OFL font subsets.');
