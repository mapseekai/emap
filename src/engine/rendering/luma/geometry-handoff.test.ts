import { expect, it } from 'vitest';
import { planGeometryHandoff } from './geometry-handoff';
import { EMPTY_COMPONENT, type GeometryJob } from './geometry-jobs';

const job = (chunk: number, ...members: number[]): GeometryJob => ({
  chunk,
  members: Int32Array.from(members),
});
it('connects splitting/merging old meshes transitively but lets independent coverage progress', async () => {
  const groups = await planGeometryHandoff(
    [job(0, 0), job(1, 1), job(2, 2), job(3, 3)],
    [job(99, 0, 1), job(7, 1, 2)],
    { membership: Uint32Array.of(0, 1, 2, 3), chunks: 4 },
    false,
    new AbortController().signal,
  );
  expect(groups).toEqual([
    { targets: [0, 1, 2], previous: [0, 1] },
    { targets: [3], previous: [] },
  ]);
});
it('uses absolute native arc IDs and the target partition batch map, ignoring invisible/degenerate members', async () => {
  const groups = await planGeometryHandoff(
    [job(8, 0, 1), job(9, 2)],
    [job(1, ~0, ~2, 3, 99)],
    {
      membership: Uint32Array.of(0, 1, 2, EMPTY_COMPONENT),
      chunks: 3,
      batchIds: Uint32Array.of(8, 8, 9),
    },
    true,
    new AbortController().signal,
  );
  expect(groups).toEqual([{ targets: [0, 1], previous: [0] }]);
});
it('handles an empty selection and respects cancellation', async () => {
  const partition = { membership: Uint32Array.of(0), chunks: 1 };
  expect(
    await planGeometryHandoff([], [job(0, 0)], partition, false, new AbortController().signal),
  ).toEqual([]);
  const controller = new AbortController();
  controller.abort();
  await expect(
    planGeometryHandoff([job(0, 0)], [], partition, false, controller.signal),
  ).rejects.toMatchObject({ name: 'AbortError' });
});
