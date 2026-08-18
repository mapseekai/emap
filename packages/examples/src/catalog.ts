import { exampleTopics, type ExampleDefinition } from '../../../docs-meta/examples';

type ExampleLocale = 'zh' | 'en';

const catalogCopy = {
  zh: {
    title: 'Emap 文档示例',
    eyebrow: 'Emap 示例',
    intro: '打开示例，查看实时地图、源码、数据夹具和 API 入口。',
    catalogLabel: '示例目录',
    allCategories: '全部',
    languageLabel: '语言',
    openExample: '打开示例',
    searchLabel: '搜索示例',
    searchPlaceholder: '搜索标题、API、标签或 ID',
    clearSearch: '清除',
    emptyTitle: '未找到匹配示例',
    emptyDescription: '调整分类或清除搜索后重试。',
    resultCount: (count: number) => `${count} 个示例`,
  },
  en: {
    title: 'Emap Documentation Example',
    eyebrow: 'Emap examples',
    intro: 'Open an example to inspect the live map, source code, fixture, and API touchpoint.',
    catalogLabel: 'Example catalog',
    allCategories: 'All',
    languageLabel: 'Language',
    openExample: 'Open example',
    searchLabel: 'Search examples',
    searchPlaceholder: 'Search titles, APIs, tags, or IDs',
    clearSearch: 'Clear',
    emptyTitle: 'No matching examples',
    emptyDescription: 'Change the category or clear the search and try again.',
    resultCount: (count: number) => `${count} examples`,
  },
} as const;

interface CatalogState {
  locale: ExampleLocale;
  category: string;
  query: string;
}

const categoryLabels: Record<ExampleLocale, Readonly<Record<string, string>>> = {
  zh: {
    'map-data': '地图与数据',
    'style-interaction': '样式与交互',
    'data-editing': '数据编辑',
    'data-analysis': '数据分析',
  },
  en: {
    'map-data': 'Map & Data',
    'style-interaction': 'Styling & Interaction',
    'data-editing': 'Data Editing',
    'data-analysis': 'Data Analysis',
  },
};

export const examplePublicHref = (id: string): string =>
  `/mapseekai/emap/examples/${id.replace(/^\/+|\/+$/g, '')}/`;

export function renderCatalog(root: HTMLElement, examples: readonly ExampleDefinition[]): void {
  const state: CatalogState = { locale: 'zh', category: 'all', query: '' };
  renderCatalogLocale(root, examples, state);
}

function renderCatalogLocale(
  root: HTMLElement,
  examples: readonly ExampleDefinition[],
  state: CatalogState,
): void {
  const { locale } = state;
  const copy = catalogCopy[locale];
  document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en';
  document.title = copy.title;
  document.body.classList.add('catalog-root');
  root.replaceChildren();

  const page = document.createElement('main');
  page.className = 'catalog-page';

  const utility = document.createElement('header');
  utility.className = 'catalog-utility';

  const brand = document.createElement('a');
  brand.className = 'catalog-brand';
  brand.href = '/mapseekai/emap/examples/';

  const brandMark = document.createElement('img');
  brandMark.src = '/mapseekai/emap/examples/emap.svg';
  brandMark.alt = '';

  const brandText = document.createElement('span');
  brandText.textContent = 'Emap / Examples';
  brand.append(brandMark, brandText);

  const utilityMeta = document.createElement('div');
  utilityMeta.className = 'catalog-utility-meta';

  const totalCount = document.createElement('span');
  totalCount.className = 'catalog-total-count';
  totalCount.textContent = copy.resultCount(examples.length);


  const languageField = document.createElement('label');
  languageField.className = 'catalog-language';
  const languageText = document.createElement('span');
  languageText.textContent = copy.languageLabel;
  const languageSelect = document.createElement('select');
  languageSelect.setAttribute('aria-label', copy.languageLabel);
  languageSelect.append(new Option('简体中文', 'zh'), new Option('English', 'en'));
  languageSelect.value = locale;
  languageField.append(languageText, languageSelect);
  utilityMeta.append(totalCount, languageField);
  utility.append(brand, utilityMeta);

  const header = document.createElement('header');
  header.className = 'catalog-header';

  const eyebrow = document.createElement('p');
  eyebrow.className = 'eyebrow';
  eyebrow.textContent = copy.eyebrow;

  const title = document.createElement('h1');
  title.textContent = copy.title;

  const intro = document.createElement('p');
  intro.textContent = copy.intro;

  const searchField = document.createElement('div');
  searchField.className = 'catalog-search';

  const searchLabel = document.createElement('label');
  searchLabel.className = 'catalog-search-label';
  searchLabel.htmlFor = 'catalog-search-input';
  searchLabel.textContent = copy.searchLabel;

  const searchControl = document.createElement('div');
  searchControl.className = 'catalog-search-control';

  const searchInput = document.createElement('input');
  searchInput.id = 'catalog-search-input';
  searchInput.className = 'catalog-search-input';
  searchInput.type = 'search';
  searchInput.placeholder = copy.searchPlaceholder;
  searchInput.value = state.query;

  const clearSearch = document.createElement('button');
  clearSearch.type = 'button';
  clearSearch.className = 'catalog-search-clear';
  clearSearch.textContent = copy.clearSearch;
  clearSearch.hidden = state.query.trim().length === 0;

  searchControl.append(searchInput, clearSearch);
  searchField.append(searchLabel, searchControl);
  header.append(eyebrow, title, intro, searchField);

  const categories = new Map<string, number>();
  for (const example of examples) {
    categories.set(example.category, (categories.get(example.category) ?? 0) + 1);
  }

  const shell = document.createElement('div');
  shell.className = 'catalog-shell';

  const sidebar = document.createElement('aside');
  sidebar.className = 'catalog-sidebar';

  const categoryNavigation = document.createElement('nav');
  categoryNavigation.className = 'catalog-category-navigation';
  categoryNavigation.setAttribute('aria-label', copy.catalogLabel);

  for (const [category, count] of [['all', examples.length] as const, ...categories]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'catalog-category-button';
    button.dataset.category = category;
    button.setAttribute('aria-pressed', String(state.category === category));

    const label = document.createElement('span');
    label.textContent =
      category === 'all' ? copy.allCategories : (categoryLabels[locale][category] ?? category);
    const categoryCount = document.createElement('span');
    categoryCount.className = 'catalog-category-count';
    categoryCount.textContent = String(count);
    button.append(label, categoryCount);

    button.addEventListener('click', () => {
      selectCategory(category);
    });
    categoryNavigation.append(button);
  }

  sidebar.append(categoryNavigation);

  const content = document.createElement('div');
  content.className = 'catalog-content';

  const mobileCategory = document.createElement('label');
  mobileCategory.className = 'catalog-mobile-category';

  const mobileCategoryLabel = document.createElement('span');
  mobileCategoryLabel.textContent = copy.catalogLabel;

  const mobileCategorySelect = document.createElement('select');
  mobileCategorySelect.setAttribute('aria-label', copy.catalogLabel);
  for (const category of ['all', ...categories.keys()]) {
    const label =
      category === 'all' ? copy.allCategories : (categoryLabels[locale][category] ?? category);
    mobileCategorySelect.append(new Option(label, category));
  }
  mobileCategorySelect.value = state.category;
  mobileCategorySelect.addEventListener('change', () => {
    selectCategory(mobileCategorySelect.value);
  });
  mobileCategory.append(mobileCategoryLabel, mobileCategorySelect);

  const results = document.createElement('section');
  results.className = 'catalog-results';
  results.setAttribute('aria-label', copy.catalogLabel);

  const resultSummary = document.createElement('p');
  resultSummary.className = 'catalog-results-summary';
  resultSummary.setAttribute('role', 'status');
  resultSummary.setAttribute('aria-live', 'polite');

  const resultGroups = document.createElement('div');
  resultGroups.className = 'catalog-result-groups';
  results.append(resultSummary, resultGroups);

  function updateResults(): void {
    const resultCount = renderCatalogResults(
      resultGroups,
      examples,
      categories,
      state,
      clearQuery,
    );
    resultSummary.textContent = copy.resultCount(resultCount);
    clearSearch.hidden = state.query.trim().length === 0;
  }

  function clearQuery(): void {
    state.query = '';
    searchInput.value = '';
    updateResults();
    searchInput.focus();
  }

  function selectCategory(category: string): void {
    state.category = category;
    for (const button of categoryNavigation.querySelectorAll<HTMLButtonElement>(
      '.catalog-category-button',
    )) {
      button.setAttribute('aria-pressed', String(button.dataset.category === category));
    }
    mobileCategorySelect.value = category;
    updateResults();
  }

  searchInput.addEventListener('input', () => {
    state.query = searchInput.value;
    updateResults();
  });

  clearSearch.addEventListener('click', clearQuery);

  updateResults();

  content.append(mobileCategory, results);
  shell.append(sidebar, content);
  page.append(utility, header, shell);
  root.append(page);

  languageSelect.addEventListener('change', () => {
    state.locale = languageSelect.value === 'en' ? 'en' : 'zh';
    renderCatalogLocale(root, examples, state);
    root.querySelector<HTMLSelectElement>('.catalog-language select')?.focus();
  });
}

function renderCatalogResults(
  resultGroups: HTMLElement,
  examples: readonly ExampleDefinition[],
  categories: ReadonlyMap<string, number>,
  state: CatalogState,
  onClearSearch: () => void,
): number {
  const copy = catalogCopy[state.locale];
  const visibleExamples = examples.filter(
    (example) =>
      (state.category === 'all' || example.category === state.category) &&
      matchesCatalogQuery(example, state),
  );

  resultGroups.replaceChildren();

  if (visibleExamples.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'catalog-empty';

    const emptyTitle = document.createElement('h2');
    emptyTitle.textContent = copy.emptyTitle;

    const emptyDescription = document.createElement('p');
    emptyDescription.textContent = copy.emptyDescription;

    const emptyClear = document.createElement('button');
    emptyClear.type = 'button';
    emptyClear.className = 'catalog-empty-clear';
    emptyClear.textContent = copy.clearSearch;
    emptyClear.addEventListener('click', onClearSearch);

    empty.append(emptyTitle, emptyDescription, emptyClear);
    resultGroups.append(empty);
    return 0;
  }

  for (const category of categories.keys()) {
    if (state.category !== 'all' && category !== state.category) continue;

    const groupExamples = visibleExamples.filter((example) => example.category === category);
    if (groupExamples.length === 0) continue;

    const group = document.createElement('section');
    group.className = 'catalog-group';

    const groupHeader = document.createElement('header');
    groupHeader.className = 'catalog-group-header';

    const groupTitle = document.createElement('h2');
    groupTitle.className = 'catalog-group-title';
    groupTitle.textContent = categoryLabels[state.locale][category] ?? category;

    const groupCount = document.createElement('span');
    groupCount.className = 'catalog-group-count';
    groupCount.textContent = String(groupExamples.length);
    groupHeader.append(groupTitle, groupCount);
    group.append(groupHeader);

    const directExamples = groupExamples.filter((example) => example.topic === undefined);
    if (directExamples.length > 0) {
      group.append(renderExampleGrid(directExamples, state.locale, 'catalog-direct-examples'));
    }

    for (const [topicId, topic] of Object.entries(exampleTopics)) {
      if (topic.category !== category) continue;

      const topicElement = renderCatalogTopic(
        topicId,
        topic,
        groupExamples,
        state.locale,
      );
      if (topicElement) group.append(topicElement);
    }

    resultGroups.append(group);
  }

  return visibleExamples.length;
}

function renderExampleGrid(
  examples: readonly ExampleDefinition[],
  locale: ExampleLocale,
  className = '',
): HTMLDivElement {
  const list = document.createElement('div');
  list.className = ['example-grid', className].filter(Boolean).join(' ');
  for (const example of examples) {
    list.append(renderExampleCard(example, locale));
  }
  return list;
}

function renderCatalogTopic(
  topicId: string,
  topic: (typeof exampleTopics)[keyof typeof exampleTopics],
  examples: readonly ExampleDefinition[],
  locale: ExampleLocale,
): HTMLElement | undefined {
  const topicExamples = examples.filter((example) => example.topic?.id === topicId);
  if (topicExamples.length === 0) return undefined;

  const element = document.createElement('section');
  element.className = 'catalog-topic';

  const header = document.createElement('header');
  header.className = 'catalog-topic-header';
  const title = document.createElement('h3');
  title.className = 'catalog-topic-title';
  title.textContent = topic.title[locale];
  const count = document.createElement('span');
  count.className = 'catalog-topic-count';
  count.textContent = String(topicExamples.length);
  header.append(title, count);
  element.append(header);

  for (const section of topic.sections) {
    const sectionExamples = topicExamples.filter((example) => example.topic?.section === section.id);
    if (sectionExamples.length === 0) continue;

    const sectionElement = document.createElement('section');
    sectionElement.className = 'catalog-topic-section';
    const sectionHeader = document.createElement('header');
    sectionHeader.className = 'catalog-topic-section-header';
    const sectionTitle = document.createElement('h4');
    sectionTitle.className = 'catalog-topic-section-title';
    sectionTitle.textContent = section.title[locale];
    const sectionCount = document.createElement('span');
    sectionCount.className = 'catalog-topic-section-count';
    sectionCount.textContent = String(sectionExamples.length);
    sectionHeader.append(sectionTitle, sectionCount);
    sectionElement.append(sectionHeader, renderExampleGrid(sectionExamples, locale));
    element.append(sectionElement);
  }

  return element;
}


function matchesCatalogQuery(example: ExampleDefinition, state: CatalogState): boolean {
  const query = state.query.trim().toLocaleLowerCase();
  if (!query) return true;

  return [
    example.title[state.locale],
    example.description[state.locale],
    example.id,
    ...example.tags,
    ...example.api,
  ]
    .join(' ')
    .toLocaleLowerCase()
    .includes(query);
}

function renderExampleCard(example: ExampleDefinition, locale: ExampleLocale): HTMLElement {
  const card = document.createElement('a');
  card.className = 'example-card';
  card.href = examplePublicHref(example.id);
  card.setAttribute(
    'aria-label',
    `${catalogCopy[locale].openExample}${locale === 'zh' ? '：' : ': '}${example.title[locale]}`,
  );

  const heading = document.createElement('div');
  heading.className = 'example-card-heading';

  const title = document.createElement('h3');
  title.className = 'example-card-title';
  title.textContent = example.title[locale];

  const arrow = document.createElement('span');
  arrow.className = 'example-card-arrow';
  arrow.setAttribute('aria-hidden', 'true');
  arrow.textContent = '↗';
  heading.append(title, arrow);

  const description = document.createElement('p');
  description.className = 'example-description';
  description.textContent = example.description[locale];

  const apiList = document.createElement('div');
  apiList.className = 'example-api-list';
  for (const api of example.api.slice(0, 2)) {
    const chip = document.createElement('span');
    chip.className = 'example-api-chip';
    chip.textContent = api;
    apiList.append(chip);
  }
  if (example.api.length > 2) {
    const overflow = document.createElement('span');
    overflow.className = 'example-api-chip';
    overflow.textContent = `+${example.api.length - 2}`;
    apiList.append(overflow);
  }

  card.append(heading, description, apiList);
  return card;
}
