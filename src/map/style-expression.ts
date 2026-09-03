// style-expression — MapLibre 静态表达式子集求值器（纯函数、无 eval）。
// 支持原子：get / match / step / interpolate(linear) / == != < <= > >= / ! / all / any。
// 编译期结构校验（非法即抛 StyleExpressionError），运行期零分配闭包。

export type StyleExpression = readonly unknown[];
export type CompiledExpression = (record: Record<string, unknown> | null | undefined) => unknown;

export class StyleExpressionError extends Error {
  override readonly name = 'StyleExpressionError';
}

/** 颜色插值 t 的量化级数（spec §4.2 桶基数策略，默认 256）。 */
const INTERPOLATE_LEVELS = 256;

export function isStyleExpression(value: unknown): value is StyleExpression {
  return Array.isArray(value) && value.length > 0 && typeof value[0] === 'string';
}

export function compileStyleExpression(
  expr: StyleExpression | string | number | boolean | null,
): CompiledExpression {
  return compileNode(expr, '$');
}

function fail(path: string, msg: string, value?: unknown): never {
  if (arguments.length === 3) {
    try {
      msg += ` ${JSON.stringify(value)}`;
    } catch {
      try {
        msg += ` ${String(value)}`;
      } catch {
        msg += ' [unserializable]';
      }
    }
  }
  throw new StyleExpressionError(`${path}: ${msg}`);
}

type Node = (rec: Record<string, unknown> | null | undefined) => unknown;

function compileNode(node: unknown, path: string): Node {
  if (!isStyleExpression(node)) {
    if (
      node === null ||
      typeof node === 'string' ||
      typeof node === 'number' ||
      typeof node === 'boolean'
    ) {
      const c = node;
      return () => c;
    }
    fail(path, 'unsupported value', node);
  }
  const [op, ...args] = node;
  const at = (i: number) => `${path}[${i + 1}]`;
  switch (op) {
    case 'get': {
      if (args.length !== 1 || typeof args[0] !== 'string')
        fail(path, 'get expects 1 string field');
      const field = args[0];
      return (rec) => rec?.[field] ?? null;
    }
    case '==':
    case '!=': {
      const [a, b] = binary(node, path);
      const fa = compileNode(a, at(0)),
        fb = compileNode(b, at(1));
      return op === '==' ? (r) => fa(r) === fb(r) : (r) => fa(r) !== fb(r);
    }
    case '<':
    case '<=':
    case '>':
    case '>=': {
      const [a, b] = binary(node, path);
      const fa = compileNode(a, at(0)),
        fb = compileNode(b, at(1));
      return (r) => {
        const x = Number(fa(r)),
          y = Number(fb(r));
        if (Number.isNaN(x) || Number.isNaN(y)) return false;
        return op === '<' ? x < y : op === '<=' ? x <= y : op === '>' ? x > y : x >= y;
      };
    }
    case '!': {
      if (args.length !== 1) fail(path, '! expects 1 arg');
      const f = compileNode(args[0], at(0));
      return (r) => !f(r);
    }
    case 'all':
    case 'any': {
      if (args.length === 0) fail(path, `${op} expects >=1 args`);
      const fs = args.map((a, i) => compileNode(a, at(i)));
      return op === 'all' ? (r) => fs.every((f) => !!f(r)) : (r) => fs.some((f) => !!f(r));
    }
    case 'match': {
      if (args.length < 3) fail(path, 'match expects input, pairs…, fallback');
      const input = compileNode(args[0], at(0));
      const pairCount = args.length - 2;
      if (pairCount % 2 !== 0) fail(path, 'match pairs must be even');
      const cases: Array<[unknown, Node]> = [];
      for (let i = 1; i < args.length - 1; i += 2) {
        cases.push([args[i], compileNode(args[i + 1], at(i + 1))]);
      }
      const fallback = compileNode(args[args.length - 1], at(args.length - 1));
      return (r) => {
        const v = input(r);
        for (const [k, out] of cases) {
          if (Array.isArray(k)) {
            if (k.some((x) => x === v)) return out(r);
          } else if (k === v) return out(r);
        }
        return fallback(r);
      };
    }
    case 'step': {
      // step args = [input, out0, (stop, out)…] → 偶数且 ≥ 4
      if (args.length < 4 || args.length % 2 !== 0)
        fail(path, 'step expects input, out0, (stop, out)…');
      const input = compileNode(args[0], at(0));
      const outs: Node[] = [compileNode(args[1], at(1))];
      const stops: number[] = [];
      for (let i = 2; i < args.length; i += 2) {
        const s = args[i];
        if (typeof s !== 'number' || !Number.isFinite(s)) fail(at(i), 'step stop must be number');
        if (stops.length > 0 && s <= stops[stops.length - 1]) fail(at(i), 'step stops must ascend');
        stops.push(s);
        outs.push(compileNode(args[i + 1], at(i + 1)));
      }
      return (r) => {
        const v = input(r);
        if (typeof v !== 'number' || Number.isNaN(v)) return outs[0](r);
        let idx = 0;
        while (idx < stops.length && v >= stops[idx]) idx++;
        return outs[idx](r);
      };
    }
    case 'interpolate': {
      // interpolate args = ['linear', input, (stop, out)…] → 偶数且 ≥ 6（至少两对 stop/out）
      if (args.length < 6 || args[0] !== 'linear' || args.length % 2 !== 0)
        fail(path, "interpolate expects 'linear', input, (stop, out)…");
      const input = compileNode(args[1], at(1));
      const stops: number[] = [];
      const outs: Node[] = [];
      // 颜色输出对的连续插值会产出 K≈N 种颜色；量化输入到全域 256 级以约束桶基数
      //（spec §4.2）。数值输出不量化（精确语义留给 radius 等场景）。
      // ≤257 保证仅适用于全静态输出：动态输出（如 ['get','color']）不受此帽约束，
      // 其基数由 resolver 的 K>256 warn 兜底（spec §4.2 双机制）。
      let quantize = false;
      for (let i = 2; i < args.length; i += 2) {
        const s = args[i];
        if (typeof s !== 'number' || !Number.isFinite(s))
          fail(at(i), 'interpolate stop must be number');
        if (stops.length > 0 && s <= stops[stops.length - 1]) fail(at(i), 'stops must ascend');
        stops.push(s);
        const output = args[i + 1];
        const color = typeof output === 'string' ? parseColor(output) : null;
        if (color) {
          const canonical = `rgb(${color[0]},${color[1]},${color[2]})`;
          outs.push(() => canonical);
          quantize = true;
        } else {
          outs.push(compileNode(output, at(i + 1)));
        }
      }
      const scale = Math.max(Math.abs(stops[0]), Math.abs(stops[stops.length - 1])) || 1;
      const normalizedStart = stops[0] / scale;
      const normalizedRange = stops[stops.length - 1] / scale - normalizedStart;
      const normalizedStops =
        normalizedRange === 0
          ? []
          : stops.map((stop) => (stop / scale - normalizedStart) / normalizedRange);
      return (r) => {
        const raw = input(r);
        if (typeof raw !== 'number' || Number.isNaN(raw)) return outs[0](r);
        if (raw <= stops[0]) return outs[0](r);
        if (raw >= stops[stops.length - 1]) return outs[outs.length - 1](r);
        let i = 0;
        let t: number;
        if (quantize && normalizedRange !== 0) {
          const u =
            Math.round(((raw / scale - normalizedStart) / normalizedRange) * INTERPOLATE_LEVELS) /
            INTERPOLATE_LEVELS;
          while (i < normalizedStops.length - 2 && u >= normalizedStops[i + 1]) i++;
          const denominator = normalizedStops[i + 1] - normalizedStops[i];
          t = denominator === 0 ? 0 : (u - normalizedStops[i]) / denominator;
        } else {
          while (i < stops.length - 2 && raw >= stops[i + 1]) i++;
          const denominator = stops[i + 1] - stops[i];
          if (Number.isFinite(denominator)) {
            t = (raw - stops[i]) / denominator;
          } else {
            const segmentScale = Math.max(Math.abs(stops[i]), Math.abs(stops[i + 1]));
            t =
              (raw / segmentScale - stops[i] / segmentScale) /
              (stops[i + 1] / segmentScale - stops[i] / segmentScale);
          }
        }
        const a = outs[i](r),
          b = outs[i + 1](r);
        if (typeof a === 'number' && typeof b === 'number') return a + (b - a) * t;
        const ca = parseColor(a),
          cb = parseColor(b);
        if (ca && cb) {
          return `rgb(${Math.round(ca[0] + (cb[0] - ca[0]) * t)},${Math.round(ca[1] + (cb[1] - ca[1]) * t)},${Math.round(ca[2] + (cb[2] - ca[2]) * t)})`;
        }
        return t < 0.5 ? a : b;
      };
    }
    default:
      fail(path, `unknown expression op "${String(op)}"`);
  }
}

function binary(node: StyleExpression, path: string): [unknown, unknown] {
  if (node.length !== 3) fail(path, `${String(node[0])} expects 2 args`);
  return [node[1], node[2]];
}

function parseColor(v: unknown): [number, number, number] | null {
  if (typeof v !== 'string') return null;
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v);
  if (hex) {
    let h = hex[1];
    if (h.length === 3)
      h = h
        .split('')
        .map((c) => c + c)
        .join('');
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  const rgb = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i.exec(v);
  if (rgb) return [+rgb[1], +rgb[2], +rgb[3]];
  return null;
}
