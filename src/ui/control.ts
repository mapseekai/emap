import type { Emap } from '../map/map';
import type { ControlContract } from './control-contract';

export interface Control extends ControlContract<Emap> {}

export type { ControlPosition } from './control-contract';
