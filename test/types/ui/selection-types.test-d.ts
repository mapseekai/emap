// Type-path regression for P2c consolidation. Checked by `tsc --noEmit`.
import type { SelectMode } from '../../../src/engine/map/selection';
import type { SelectMode as SelectModeHandler } from '../../../src/engine/core/handlers/select-mode';
import type { BoxSelectStyle } from '../../../src/ui/box-select-control';
import type { BoxSelectStyle as BoxSelectStyleHandler } from '../../../src/engine/core/handlers/box-select';
import type { LassoSelectStyle } from '../../../src/ui/lasso-select-control';
import type { LassoSelectStyle as LassoSelectStyleHandler } from '../../../src/engine/core/handlers/lasso-select';

const a: SelectMode = 'replace' as SelectModeHandler;
const b: SelectModeHandler = a;
const c: BoxSelectStyle = {} as BoxSelectStyleHandler;
const d: BoxSelectStyleHandler = c;
const e: LassoSelectStyleHandler = {
  stroke: '#000',
  strokeWidth: 2,
  fill: 'red',
  strokeDasharray: '4 3',
};
const f: LassoSelectStyle = e;
const g: LassoSelectStyleHandler = f;
void a;
void b;
void c;
void d;
void e;
void f;
void g;
