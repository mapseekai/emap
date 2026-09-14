import type { CreateLayerOptions } from '../../domain/source/create-layer';
import type {
  TopologySource,
  TopologySourceInput,
  TopologySourceOptions,
} from '../../domain/source/topology-source';
import type { MapshaperDataset } from '../../shared/types/mapshaper-types';

/** Topology source construction belongs to its provider, not the facade or snapshot service. */
export interface SourceFactoryContract {
  create(id: string, options: CreateLayerOptions): Promise<TopologySource>;
  fromInput(
    id: string,
    input: TopologySourceInput,
    options?: Omit<TopologySourceOptions, 'data' | 'formats'>,
  ): Promise<TopologySource>;
  fromDataset(id: string, dataset: MapshaperDataset): TopologySource;
}
