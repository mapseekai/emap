// FlatGeobuf (.fgb) format plugin for the examples.
//
// Registration is explicit and dependency-injected with the page's emap
// runtime: the example bundle must not compile a second copy of emap, and
// the format registry (a Symbol.for global slot) is shared with the vendor
// emap.js that actually runs TopologySource. Mirrors how the Arrow module
// self-registers GeoParquet/GeoArrow support, kept example-local because
// flatgeobuf is an examples-only dependency.
//
// Import is whole-file: importBinary receives the full bytes from
// TopologySource.setData, so flatgeobuf's streaming/range-read API is not
// reachable here. CRS comes from the FGB header (GeoJSON itself carries
// none) and is stamped as emap's canonical EPSG crs_string.
import { geojson } from 'flatgeobuf';
import type { getDefaultMapshaperAdapter, registerFormat } from '@mapseekai/emap';

interface FlatGeobufExampleRuntime {
  registerFormat: typeof registerFormat;
  getDefaultMapshaperAdapter: typeof getDefaultMapshaperAdapter;
}

function epsgCode(crs: string | undefined): number | undefined {
  const code = /^EPSG:(\d+)$/i.exec(crs ?? '')?.[1];
  return code ? Number(code) : undefined;
}

export function installFlatGeobufFormat(emap: FlatGeobufExampleRuntime): void {
  emap.registerFormat({
    name: 'flatgeobuf',
    extensions: ['fgb'],
    importBinary: async (content) => {
      let crsCode: number | undefined;
      const features = [];
      for await (const feature of geojson.deserialize(content, undefined, (header) => {
        crsCode = header.crs?.code;
      })) {
        features.push(feature);
      }
      const json = JSON.stringify({ type: 'FeatureCollection', features });
      const dataset = await emap
        .getDefaultMapshaperAdapter()
        .runImport('-i data.geojson', { 'data.geojson': json });
      if (crsCode) {
        dataset.info ??= {};
        dataset.info.crs_string = `EPSG:${crsCode}`;
      }
      return dataset;
    },
    exportFormats: {
      flatgeobuf: async (dataset) => {
        const file = emap
          .getDefaultMapshaperAdapter()
          .exportFileContent(dataset, { format: 'geojson' })[0];
        if (!file) throw new Error('FlatGeobuf export produced no GeoJSON');
        const json =
          typeof file.content === 'string'
            ? file.content
            : new TextDecoder().decode(file.content);
        return [
          {
            filename: 'export.fgb',
            content: geojson.serialize(JSON.parse(json), epsgCode(dataset.info?.crs_string)),
          },
        ];
      },
    },
  });
}
