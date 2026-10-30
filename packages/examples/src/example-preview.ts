import type { ExampleDefinition } from '../../../docs-meta/examples';

/** Actual example maps captured by scripts/capture-example-previews.mjs. */
export function createExamplePreview(example: ExampleDefinition): HTMLElement {
  const container = document.createElement('div');
  container.className = 'example-preview';
  container.setAttribute('aria-hidden', 'true');
  container.dataset.kind = 'product';
  const preview = document.createElement('img');
  preview.src = `/mapseekai/emap/examples/previews/${example.id}.jpg`;
  preview.alt = '';
  preview.width = 1030;
  preview.height = 429;
  preview.loading = 'lazy';
  preview.decoding = 'async';
  container.append(preview);
  return container;
}
