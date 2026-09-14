import type { ExportedFormatFile, FormatRegistryContract } from '../../runtime/services/formats';
import type { MapshaperDataset } from '../../shared/types/mapshaper-types';
import { exportGeoArrow, importGeoArrow } from './geoarrow-io';
import { exportGeoParquet, importGeoParquet } from './geoparquet-io';

/** Explicitly register optional codecs and return an owner-safe disposer. */
export function registerArrowFormats(formats: FormatRegistryContract): () => void {
  return formats.register({
    name: 'geoarrow-formats',
    extensions: ['parquet', 'geoparquet', 'arrow', 'arrows', 'feather'],
    importBinary: async (content, filename): Promise<MapshaperDataset> => {
      const layerName = (filename.split('/').pop() || filename).replace(/\.[a-z0-9]+$/i, '');
      return /\.(parquet|geoparquet)$/i.test(filename)
        ? importGeoParquet(content, { layerName })
        : importGeoArrow(content, { layerName });
    },
    exportFormats: {
      geoparquet: async (dataset, options): Promise<ExportedFormatFile[]> => [
        { filename: 'export.parquet', content: await exportGeoParquet(dataset, options ?? {}) },
      ],
      geoarrow: async (dataset, options): Promise<ExportedFormatFile[]> => [
        { filename: 'export.arrow', content: exportGeoArrow(dataset, options ?? {}) },
      ],
    },
    mimeTypes: {
      geoparquet: 'application/vnd.apache.parquet',
      geoarrow: 'application/vnd.apache.arrow.file',
    },
  });
}
