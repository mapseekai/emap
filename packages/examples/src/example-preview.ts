import type { ExampleDefinition } from '../../../docs-meta/examples';

const capturedExamples = new Set([
  'getting-started/point-style',
  'getting-started/lines',
  'getting-started/polygon-fill',
  'labels',
  'point-icons',
  'attribute-styling',
  'geotiff-viewer',
  'geopackage-viewer',
  'geoparquet-viewer',
  'buffer',
  'luma-25d',
]);

/** Captures of the actual starter maps, made with Hallmark's capture tool. */
export function createExamplePreview(example: ExampleDefinition): HTMLElement | null {
  if (!capturedExamples.has(example.id)) return null;
  const container = document.createElement('div');
  container.className = 'example-preview';
  container.setAttribute('aria-hidden', 'true');
  container.dataset.kind = 'product';
  const preview = document.createElement('img');
  const slug = `mapseekai-emap-examples-${example.id.replace(/\//g, '-')}`;
  preview.src = `/mapseekai/emap/examples/previews/preview-${slug}-desktop-part.png`;
  preview.alt = '';
  preview.width = 908;
  preview.height = 619;
  preview.loading = 'lazy';
  container.append(preview);
  return container;
}
