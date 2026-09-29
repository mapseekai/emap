// @vitest-environment node
import { fileURLToPath } from 'node:url';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import { rollup } from 'rollup';
import { expect, it } from 'vitest';

it('bundles the installed WebGL adapter without circular dependencies', async () => {
  const cycles: string[] = [];
  // Inspect the actual dependency graph, independent of emap's warning filter.
  const bundle = await rollup({
    input: fileURLToPath(import.meta.resolve('@luma.gl/webgl')),
    plugins: [nodeResolve({ browser: true })],
    onwarn(warning, warn) {
      if (warning.code === 'CIRCULAR_DEPENDENCY') cycles.push(warning.message);
      else warn(warning);
    },
  });
  try {
    await bundle.generate({ format: 'es' });
    expect(cycles).toEqual([]);
  } finally {
    await bundle.close();
  }
});

it('forwards GL state changes after creating a replacement device on the same context', async () => {
  const { WebGLStateTracker } = await import(
    new URL('./context/state-tracker/webgl-state-tracker.js', import.meta.resolve('@luma.gl/webgl'))
      .href
  );
  let calls = 0;
  const gl = {
    enable: (_cap: number) => {
      calls++;
    },
    useProgram: () => {},
    getParameter: () => false,
    isEnabled: () => false,
  };
  new WebGLStateTracker(gl).trackState(gl, { copyState: false });
  gl.enable(3042); // BLEND
  expect(calls).toBe(1);
  // Browser context restoration resets native GL state; the wrapper object survives.
  new WebGLStateTracker(gl).trackState(gl, { copyState: false });
  gl.enable(3042);
  expect(calls).toBe(2);
});
