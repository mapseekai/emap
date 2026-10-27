import { test,expect } from '@playwright/test';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {join,resolve} from 'node:path';
import {mkdir} from 'node:fs/promises';
const directory=process.env.EMAP_BENCHMARK_DATA_DIR,bundle=resolve('test-results/.line-fixtures/visual.js');
test.beforeAll(async()=>{
 const require=createRequire(import.meta.url);const esbuild=await import(pathToFileURL(createRequire(require.resolve('vite')).resolve('esbuild')).href);
 await mkdir(resolve('test-results/.line-fixtures'),{recursive:true});
 await esbuild.build({entryPoints:[resolve('test/browser/fixtures/luma-lines.ts')],bundle:true,format:'iife',platform:'browser',target:'es2022',outfile:bundle,define:{'process.env.NODE_ENV':'"production"'}});
});
for(const backend of ['webgl','webgpu'])test(`${backend}: full real paths preserve multisample coverage and compositing order`,async({page},info)=>{
 test.skip(!directory,'Provide the authorized real data folder.');test.setTimeout(180000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/mapseekai/emap/examples/luma-benchmark/?parameters=open&gpu='+backend);
 await page.waitForFunction(()=>window.lumaBenchmark?.state==='idle',null,{timeout:60000});
 await page.locator('#file-input').setInputFiles(join(directory,'lucc.geojson'));await page.locator('#load-file').click();
 await page.waitForFunction(()=>['ready','error'].includes(window.lumaBenchmark.state),null,{timeout:120000});
 expect(await page.evaluate(()=>window.lumaBenchmark.state),await page.locator('#status').textContent()).toBe('ready');
 await page.addScriptTag({path:bundle});const result=await page.evaluate(b=>window.verifyLinePixels(b),backend);
 await info.attach('real-path-pixels',{body:JSON.stringify(result,null,2),contentType:'application/json'});
 console.log('LINE_PIXELS',JSON.stringify(result));
 expect(result.errors).toEqual([]);expect(result.rows).toHaveLength(45);expect(result.rangeRejected).toBeGreaterThan(0);
 for(const r of result.rows){expect(r.painted,JSON.stringify(r)).toBeGreaterThan(0);expect(r.max,JSON.stringify(r)).toBe(0);}
 expect(result.resources.liveBufferBytes).toBe(0);
 await page.evaluate(()=>window.lumaBenchmark.dispose());await expect.poll(()=>page.workers().length).toBe(0);expect(errors).toEqual([]);
});
