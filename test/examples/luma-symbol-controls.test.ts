// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { installLabelControls } from '../../packages/examples/src/luma-benchmark/label-controls';
import { installIconControls } from '../../packages/examples/src/luma-benchmark/icon-controls';

describe('symbol controls refresh by settings revision, not every map frame', () => {
  for (const install of [installLabelControls, installIconControls])
    it(install.name, () => {
      const layers: any[] = [
        {
          id: 'p',
          type: 'circle',
          source: 's',
          label: { field: 'name', fontSize: 14 },
          symbol: { layout: { 'text-field': ['get', 'name'], 'text-size': 14 } },
        },
      ];
      const renderer: any = {
        getLayers: vi.fn(() => layers),
        getLabelFields: () => ['name'],
        labelControlRevision: '0',
        labelStats: {},
        iconStats: { errors: [], images: 0, imageBytes: 0, instances: 0 },
      };
      const host = document.createElement('div');
      document.body.append(host);
      const control = install(host, renderer, vi.fn()),
        reads = renderer.getLayers.mock.calls.length;
      for (let i = 0; i < 20; i++) control.refresh();
      expect(renderer.getLayers.mock.calls.length).toBe(reads);
      renderer.labelControlRevision = '1';
      control.refresh();
      expect(renderer.getLayers.mock.calls.length).toBeGreaterThan(reads);
      control.dispose();
      expect(host.children).toHaveLength(0);
      host.remove();
    });
});
