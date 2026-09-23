import { describe, expect, it } from 'vitest';
import { resolveRenderer } from './renderer';
describe('map renderer selection', () => {
  it('defaults to real WebGL2 and accepts only explicit backend names', () => {
    expect(resolveRenderer()).toBe('webgl2');
    for (const backend of ['canvas2d', 'webgl2', 'webgpu'] as const)
      expect(resolveRenderer(backend)).toBe(backend);
    for (const invalid of ['canvas', 'webgl', 'auto', '', null, 4])
      expect(() => resolveRenderer(invalid as never)).toThrow('renderer');
  });
});
