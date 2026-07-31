import type { ExampleDefinition } from '../../../docs-meta/examples';

type ExampleLocale = 'zh' | 'en';

const catalogCopy = {
  zh: {
    title: 'Emap 文档示例',
    eyebrow: 'Emap 示例',
    intro: '打开示例，查看实时地图、源码、数据夹具和 API 入口。',
    catalogLabel: '示例目录',
    languageLabel: '语言',
    openExample: '打开示例',
  },
  en: {
    title: 'Emap Documentation Example',
    eyebrow: 'Emap examples',
    intro: 'Open an example to inspect the live map, source code, fixture, and API touchpoint.',
    catalogLabel: 'Example catalog',
    languageLabel: 'Language',
    openExample: 'Open example',
  },
} as const;

const categoryLabels: Record<ExampleLocale, Readonly<Record<string, string>>> = {
  zh: {
    'getting-started': '快速开始',
    data: '数据',
    layers: '图层',
    interaction: '交互',
    editing: '编辑',
    spatial: '空间分析',
    validation: '验证',
    crs: '坐标系',
    platform: '平台',
    duckdb: 'DuckDB',
  },
  en: {
    'getting-started': 'Getting started',
    data: 'Data',
    layers: 'Layers',
    interaction: 'Interaction',
    editing: 'Editing',
    spatial: 'Spatial',
    validation: 'Validation',
    crs: 'CRS',
    platform: 'Platform',
    duckdb: 'DuckDB',
  },
};

export const examplePublicHref = (id: string): string =>
  `/mapseekai/emap/examples/${id.replace(/^\/+|\/+$/g, '')}/`;

export function renderCatalog(root: HTMLElement, examples: readonly ExampleDefinition[]): void {
  renderCatalogLocale(root, examples, 'zh');
}

function renderCatalogLocale(
  root: HTMLElement,
  examples: readonly ExampleDefinition[],
  locale: ExampleLocale,
): void {
  const copy = catalogCopy[locale];
  document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en';
  document.title = copy.title;
  root.replaceChildren();

  const page = document.createElement('main');
  page.className = 'catalog-page';

  const header = document.createElement('header');
  header.className = 'catalog-header';

  const headerTop = document.createElement('div');
  headerTop.className = 'catalog-header-top';

  const eyebrow = document.createElement('p');
  eyebrow.className = 'eyebrow';
  eyebrow.textContent = copy.eyebrow;

  const languageField = document.createElement('label');
  languageField.className = 'catalog-language';
  const languageText = document.createElement('span');
  languageText.textContent = copy.languageLabel;
  const languageSelect = document.createElement('select');
  languageSelect.setAttribute('aria-label', copy.languageLabel);
  languageSelect.append(new Option('简体中文', 'zh'), new Option('English', 'en'));
  languageSelect.value = locale;
  languageField.append(languageText, languageSelect);
  headerTop.append(eyebrow, languageField);

  const title = document.createElement('h1');
  title.textContent = copy.title;

  const intro = document.createElement('p');
  intro.textContent = copy.intro;

  header.append(headerTop, title, intro);

  const list = document.createElement('section');
  list.className = 'example-grid';
  list.setAttribute('aria-label', copy.catalogLabel);

  for (const example of examples) {
    list.append(renderExampleCard(example, locale));
  }

  page.append(header, list);
  root.append(page);

  languageSelect.addEventListener('change', () => {
    renderCatalogLocale(root, examples, languageSelect.value === 'en' ? 'en' : 'zh');
  });
}

function renderExampleCard(example: ExampleDefinition, locale: ExampleLocale): HTMLElement {
  const card = document.createElement('article');
  card.className = 'example-card';

  const category = document.createElement('p');
  category.className = 'example-category';
  category.textContent = categoryLabels[locale][example.category] ?? example.category;

  const title = document.createElement('h2');
  title.textContent = example.title[locale];

  const description = document.createElement('p');
  description.className = 'example-description';
  description.textContent = example.description[locale];

  const link = document.createElement('a');
  link.className = 'primary-link';
  link.href = examplePublicHref(example.id);
  link.textContent = catalogCopy[locale].openExample;

  card.append(category, title, description, link);
  return card;
}
