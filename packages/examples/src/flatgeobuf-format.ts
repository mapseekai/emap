// FlatGeobuf (.fgb) format plugin for the examples.
//
// Registration targets a supplied workspace registry and returns its disposer.
// No global registry and no module import side effect are used.
//
// Import is whole-file: importBinary receives the full bytes from
// TopologySource.setData, so flatgeobuf's streaming/range-read API is not
// reachable here. CRS comes from the FGB header (GeoJSON itself carries
// none) and is stamped as emap's canonical EPSG crs_string.
import { geojson } from 'flatgeobuf';
import type { getDefaultMapshaperAdapter, FormatRegistryContract } from '@mapseekai/emap';

interface FlatGeobufExampleRuntime {
  getDefaultMapshaperAdapter: typeof getDefaultMapshaperAdapter;
}

function epsgCode(crs: string | undefined): number | undefined {
  const code = /^EPSG:(\d+)$/i.exec(crs ?? '')?.[1];
  return code ? Number(code) : undefined;
}

export function installFlatGeobufFormat(
  emap: FlatGeobufExampleRuntime,
  formats: FormatRegistryContract,
): () => void {
  return formats.register({
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
          typeof file.content === 'string' ? file.content : new TextDecoder().decode(file.content);
        // The adapter produced this FeatureCollection through its GeoJSON export contract.
        const collection = JSON.parse(json) as GeoJSON.FeatureCollection;
        return [
          {
            filename: 'export.fgb',
            content: geojson.serialize(collection, epsgCode(dataset.info?.crs_string)),
          },
        ];
      },
    },
  });
}
