// Type-path regression for P2c consolidation. Checked by `tsc --noEmit`.
import type { SelectMode } from '../map/selection';
import type { SelectMode as SelectModeHandler } from '../core/handlers/select-mode';
import type { BoxSelectStyle } from './box-select-control';
import type { BoxSelectStyle as BoxSelectStyleHandler } from '../core/handlers/box-select';
import type { LassoSelectStyle } from './lasso-select-control';
import type { LassoStyle } from '../core/handlers/lasso-select';
import type { LassoSelectStyle as LassoSelectStyleHandler } from '../core/handlers/lasso-select';

const a: SelectMode = 'replace' as SelectModeHandler;
const b: SelectModeHandler = a;
const c: BoxSelectStyle = {} as BoxSelectStyleHandler;
const d: BoxSelectStyleHandler = c;
const e: LassoStyle = { stroke: '#000', strokeWidth: 2, fill: 'red', strokeDasharray: '4 3' };
const f: LassoSelectStyle = e;
const g: LassoSelectStyleHandler = f;
void a;
void b;
void c;
void d;
void e;
void f;
void g;
