import { ReshapeFeatureHandler } from './reshape-feature';
import type { EditMode } from '../../map/edit-state-store';
import type { OpResult } from '../../map/op-result';

/** Sketch new polygon boundaries with the same snapping and gestures as reshape. */
export class AutoCompletePolygonHandler extends ReshapeFeatureHandler {
  override readonly name = 'autoCompletePolygon';
  protected override readonly _editMode: EditMode = 'auto-complete';

  protected override _execute(vertices: [number, number][]): Promise<OpResult<unknown>> {
    return this._map.ops.autoCompletePolygon({ line: vertices });
  }
}
