import type { ExampleDefinition } from '../../../docs-meta/examples';

const sourceFileUrl = 'https://github.com/zwishing/emap/blob/main/docs-meta/examples.ts';
const docsBaseUrl = '/emap/';

export function resolveExampleId(location: Location): string | null {
  const hashId = matchExamplePath(location.hash.replace(/^#/, ''));
  if (hashId) return hashId;
  return matchExamplePath(location.pathname);
}

export function renderExamplePage(root: HTMLElement, example: ExampleDefinition): void {
  root.replaceChildren();

  const page = document.createElement('main');
  page.className = 'example-page';

  const topBar = document.createElement('nav');
  topBar.className = 'top-bar';
  topBar.setAttribute('aria-label', 'Example navigation');

  const catalogLink = document.createElement('a');
  catalogLink.href = '#/';
  catalogLink.textContent = 'Example catalog';

  const docsLink = document.createElement('a');
  docsLink.href = docsReferenceToPublicHref(example.docs[0]);
  docsLink.textContent = 'Return to docs';

  topBar.append(catalogLink, docsLink);

  const layout = document.createElement('section');
  layout.className = 'example-layout';

  const mapRegion = document.createElement('section');
  mapRegion.className = 'map-region';
  mapRegion.setAttribute('aria-label', `${example.title.en} map`);

  const map = document.createElement('div');
  map.id = 'example-map';
  map.className = 'example-map';

  const status = document.createElement('p');
  status.className = 'load-status';
  status.textContent = 'Loading example...';

  mapRegion.append(map, status);
  layout.append(mapRegion, renderDetailsPanel(example));
  page.append(topBar, layout);
  root.append(page);

  void example
    .load()
    .then(() => {
      status.textContent = example.success;
      status.dataset.state = 'ready';
    })
    .catch((error: unknown) => {
      status.textContent = error instanceof Error ? error.message : 'Example failed to load.';
      status.dataset.state = 'error';
    });
}

export function renderMissingExample(root: HTMLElement, id: string): void {
  root.replaceChildren();

  const page = document.createElement('main');
  page.className = 'catalog-page missing-page';

  const title = document.createElement('h1');
  title.textContent = 'Example not found';

  const copy = document.createElement('p');
  copy.textContent = id;

  const link = document.createElement('a');
  link.className = 'primary-link';
  link.href = '#/';
  link.textContent = 'Return to catalog';

  page.append(title, copy, link);
  root.append(page);
}

function renderDetailsPanel(example: ExampleDefinition): HTMLElement {
  const panel = document.createElement('aside');
  panel.className = 'details-panel';

  const category = document.createElement('p');
  category.className = 'example-category';
  category.textContent = example.category;

  const title = document.createElement('h1');
  title.textContent = example.title.en;

  const localized = document.createElement('p');
  localized.className = 'localized-title';
  localized.textContent = example.title.zh;

  const stepsTitle = document.createElement('h2');
  stepsTitle.textContent = 'Steps';

  const steps = document.createElement('ol');
  steps.append(
    stepItem(`Load fixture: ${example.fixtures.join(', ')}`),
    stepItem(`Use API: ${example.api[0]}`),
    stepItem(`Confirm: ${example.success}`),
  );

  const linksTitle = document.createElement('h2');
  linksTitle.textContent = 'Links';

  const links = document.createElement('ul');
  links.className = 'link-list';
  links.append(
    linkItem('Source file', sourceFileUrl),
    linkItem('Documentation', docsReferenceToPublicHref(example.docs[0])),
    linkItem(`API symbol: ${example.api[0]}`, docsReferenceToPublicHref(example.docs[0])),
  );

  panel.append(category, title, localized, stepsTitle, steps, linksTitle, links);
  return panel;
}

function docsReferenceToPublicHref(reference: string): string {
  let slug = reference.trim();
  if (slug.startsWith('/docs/')) slug = slug.slice('/docs/'.length);
  else slug = slug.replace(/^\/+/, '');
  slug = slug.replace(/\/index\.html$/, '').replace(/\.mdx?$/, '').replace(/\/+$/, '');
  return `${docsBaseUrl}${slug ? `${slug}/` : ''}`;
}

function matchExamplePath(path: string): string | null {
  const match = /(?:^|\/)examples\/([^?#]+)/.exec(path);
  return match ? decodeURIComponent(match[1]).replace(/(?:\/index\.html|\/)$/, '') : null;
}

function stepItem(text: string): HTMLLIElement {
  const item = document.createElement('li');
  item.textContent = text;
  return item;
}

function linkItem(label: string, href: string): HTMLLIElement {
  const item = document.createElement('li');
  const link = document.createElement('a');
  link.href = href;
  link.textContent = label;
  item.append(link);
  return item;
}
