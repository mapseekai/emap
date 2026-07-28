import type { ExampleDefinition } from '../../../docs-meta/examples';

export const examplePublicHref = (id: string): string =>
  `/emap/examples/${id.replace(/^\/+|\/+$/g, '')}/`;

export function renderCatalog(root: HTMLElement, examples: readonly ExampleDefinition[]): void {
  root.replaceChildren();

  const page = document.createElement('main');
  page.className = 'catalog-page';

  const header = document.createElement('header');
  header.className = 'catalog-header';

  const eyebrow = document.createElement('p');
  eyebrow.className = 'eyebrow';
  eyebrow.textContent = 'emap examples';

  const title = document.createElement('h1');
  title.textContent = 'Runnable documentation examples';

  const intro = document.createElement('p');
  intro.textContent = 'Open an example to inspect the live map, source fixture, API touchpoint, and success condition.';

  header.append(eyebrow, title, intro);

  const list = document.createElement('section');
  list.className = 'example-grid';
  list.setAttribute('aria-label', 'Example catalog');

  for (const example of examples) {
    list.append(renderExampleCard(example));
  }

  page.append(header, list);
  root.append(page);
}

function renderExampleCard(example: ExampleDefinition): HTMLElement {
  const card = document.createElement('article');
  card.className = 'example-card';

  const category = document.createElement('p');
  category.className = 'example-category';
  category.textContent = example.category;

  const title = document.createElement('h2');
  title.textContent = example.title.en;

  const localized = document.createElement('p');
  localized.className = 'localized-title';
  localized.textContent = example.title.zh;

  const success = document.createElement('p');
  success.className = 'success-copy';
  success.textContent = example.success;

  const link = document.createElement('a');
  link.className = 'primary-link';
  link.href = examplePublicHref(example.id);
  link.textContent = 'Open example';

  card.append(category, title, localized, success, link);
  return card;
}
