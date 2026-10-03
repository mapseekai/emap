// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';

it('rejects malformed ZIP64 imports without hanging and still imports ordinary archives', () => {
  // A child bounds the regression: the old embedded fflate loop blocks the JS thread.
  const result = execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
    import assert from 'node:assert/strict';
    import { getDefaultMapshaperAdapter } from './dist/emap.mjs';
    import { zipSync, strToU8 } from 'fflate';
    const adapter = getDefaultMapshaperAdapter();
    for (const extraLength of [0, 8]) {
      const bytes = new Uint8Array(144), view = new DataView(bytes.buffer);
      for (const [offset, value] of [[0,0x02014b50],[20,0xffffffff],[24,0xffffffff],
        [46,0x06064b50],[50,44],[70,1],[78,1],[94,0],[102,0x07064b50],
        [110,46],[118,1],[122,0x06054b50],[138,0xffffffff]])
        view.setUint32(offset,value,true);
      view.setUint16(130,65535,true);
      view.setUint16(132,65535,true);
      view.setUint16(30,extraLength,true);
      for (const name of ['bad.zip','bad.kmz'])
        await assert.rejects(adapter.runImport('-i '+name, {[name]: bytes}), /invalid zip data/i);
    }
    const json = JSON.stringify({type:'FeatureCollection', features:[
      {type:'Feature', properties:{name:'ok'}, geometry:{type:'Point',coordinates:[1,2]}}
    ]});
    const bytes = zipSync({'point.geojson':strToU8(json)});
    const dataset = await adapter.runImport('-i good.zip', {'good.zip':bytes});
    assert.deepEqual(dataset.layers[0].shapes, [[[1,2]]]);
    console.log('ZIP64 rejected; normal archive imported');
  `,
    ],
    { cwd: resolve('.'), encoding: 'utf8', timeout: 5000 },
  );
  expect(result).toContain('ZIP64 rejected; normal archive imported');
}, 10000);
