import { examples, type ExampleDefinition } from '../../../docs-meta/examples';
import { categoryLabel, exampleCategories } from './example-content';
import './example-presentation.css';
import { renderExampleSource } from './example-source-viewer';
import { exampleNavigationUrl, installExampleRendererToolbar } from './renderer-choice';

const base = '/mapseekai/emap/examples/';
const installations = new WeakMap<Document, () => void>();
type Tab = 'live' | 'source';

function element<K extends keyof HTMLElementTagNameMap>(
  root: Document,
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = root.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function link(root: Document, text: string, href: string, className = ''): HTMLAnchorElement {
  const node = element(root, 'a', className, text);
  node.href = exampleNavigationUrl(href, new URL(root.defaultView?.location.href ?? root.baseURI));
  return node;
}

function currentExample(root: Document): ExampleDefinition | undefined {
  const path = root.defaultView?.location.pathname ?? '';
  if (!path.startsWith(base)) return;
  try {
    const id = decodeURIComponent(path.slice(base.length)).replace(/\/(?:index\.html)?$/, '');
    return examples.find((example) => example.id === id);
  } catch {
    return;
  }
}

/** Keeps the running map in one viewport while preserving its controls and listeners. */
export function installExamplePresentation(root: Document = document): (() => void) | undefined {
  if (installations.has(root)) return installations.get(root);
  const example = currentExample(root);
  const header = root.getElementById('header');
  if (!example || !header) return;
  const view = root.defaultView!;
  installExampleRendererToolbar(root);
  const docsLink = root.querySelector<HTMLAnchorElement>('.emap-example-docs-link');
  const original = Array.from(root.body.children).filter(
    (node) =>
      !['SCRIPT', 'STYLE', 'LINK'].includes(node.tagName) &&
      !node.classList.contains('emap-performance'),
  );
  root.body.classList.add('example-detail');
  root.body.dataset.example = example.id;
  root.title = `${example.title.zh} | Emap 示例`;
  if (!root.querySelector('meta[name="description"]')) {
    const description = root.createElement('meta');
    description.name = 'description';
    description.content = example.description.zh;
    root.head.append(description);
  }
  const siteHeader = element(root, 'header', 'example-site-header');
  const brand = link(root, '', base, 'example-site-brand');
  const logo = element(root, 'img', '');
  logo.src = `${base}emap.svg`;
  logo.alt = '';
  logo.width = logo.height = 24;
  brand.setAttribute('aria-label', 'emap 示例首页');
  brand.append(logo, 'emap');
  const siteNav = element(root, 'nav', 'example-site-links');
  siteNav.setAttribute('aria-label', '站点导航');
  siteNav.append(
    link(root, '文档', docsLink?.getAttribute('href') ?? '/mapseekai/emap/'),
    link(root, 'GitHub', 'https://github.com/mapseekai/emap'),
  );
  siteHeader.append(brand, siteNav);
  const layout = element(root, 'div', 'example-detail-layout');
  const navigation = element(root, 'aside', 'example-navigation');
  navigation.id = 'example-navigation';
  navigation.append(link(root, '全部示例', base, 'example-back-link'));
  const search = element(root, 'input', 'example-nav-search');
  search.type = 'search';
  search.placeholder = '搜索示例…';
  search.setAttribute('aria-label', '搜索示例导航');
  navigation.append(search);
  for (const [category] of exampleCategories) {
    const group = element(root, 'details', 'example-nav-group');
    group.open = category === example.category;
    const groupExamples = examples.filter((item) => item.category === category);
    const summary = element(root, 'summary', '', categoryLabel(category));
    summary.append(element(root, 'span', 'example-nav-count', String(groupExamples.length)));
    group.append(summary);
    for (const item of groupExamples) {
      const itemLink = link(root, item.title.zh, `${base}${item.id}/`, 'example-nav-link');
      itemLink.title = item.title.zh;
      itemLink.dataset.search = `${item.title.zh} ${item.title.en} ${item.id}`.toLowerCase();
      if (item.id === example.id) itemLink.setAttribute('aria-current', 'page');
      group.append(itemLink);
    }
    navigation.append(group);
  }
  search.addEventListener('input', () => {
    const query = search.value.trim().toLowerCase();
    for (const group of navigation.querySelectorAll<HTMLDetailsElement>('details')) {
      const links = Array.from(group.querySelectorAll<HTMLAnchorElement>('.example-nav-link'));
      for (const item of links) item.hidden = !item.dataset.search!.includes(query);
      group.hidden = links.every((item) => item.hidden);
      group.open = query.length > 0 || !!group.querySelector('[aria-current="page"]');
    }
  });
  const main = element(root, 'main', 'example-detail-main');
  const heading = element(root, 'header', 'example-detail-heading');
  heading.append(element(root, 'h1', '', example.title.zh));
  const toolbar = element(root, 'div', 'example-detail-tabs');
  const tabs = element(root, 'div', 'example-tab-list');
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', '示例内容');
  const panels = {
    live: element(root, 'section', 'example-live'),
    source: element(root, 'section', 'example-source'),
  };
  const buttons = new Map<Tab, HTMLButtonElement>();
  let disposeSource: (() => void) | undefined;
  const activate = (tab: Tab, focus = false) => {
    for (const [key, panel] of Object.entries(panels)) {
      panel.hidden = key !== tab;
      panel.inert = key !== tab;
      const button = buttons.get(key as Tab)!;
      button.setAttribute('aria-selected', String(key === tab));
      button.tabIndex = key === tab ? 0 : -1;
    }
    if (tab === 'source' && !disposeSource)
      disposeSource = renderExampleSource(root, panels.source, example);
    if (focus) buttons.get(tab)!.focus();
    if (tab === 'live') view.requestAnimationFrame(() => view.dispatchEvent(new Event('resize')));
    const url = new URL(view.location.href);
    if (tab === 'live') url.searchParams.delete('tab');
    else url.searchParams.set('tab', tab);
    view.history.replaceState(view.history.state, '', url);
  };
  for (const [tab, label] of [
    ['live', '地图'],
    ['source', '源码'],
  ] as const) {
    const button = element(root, 'button', 'example-tab', label);
    button.type = 'button';
    button.id = `example-tab-${tab}`;
    button.dataset.exampleTab = tab;
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-controls', `example-${tab}`);
    panels[tab].id = `example-${tab}`;
    panels[tab].setAttribute('role', 'tabpanel');
    panels[tab].setAttribute('aria-labelledby', button.id);
    button.addEventListener('click', () => activate(tab));
    button.addEventListener('keydown', (event) => {
      if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      activate(
        event.key === 'Home'
          ? 'live'
          : event.key === 'End'
            ? 'source'
            : tab === 'live'
              ? 'source'
              : 'live',
        true,
      );
    });
    buttons.set(tab, button);
    tabs.append(button);
  }
  let parameterDialog: HTMLDialogElement | undefined;
  const parameterToggle = element(root, 'button', 'example-parameters-toggle', '展开操作');
  parameterToggle.type = 'button';
  parameterToggle.setAttribute('aria-label', '展开操作');
  parameterToggle.setAttribute('aria-controls', 'example-parameters-dialog');
  parameterToggle.setAttribute('aria-expanded', 'false');
  const setParametersOpen = (open: boolean, focus = false) => {
    if (!parameterDialog) return;
    parameterDialog.open = open;
    parameterToggle.hidden = open;
    parameterToggle.setAttribute('aria-expanded', String(open));
    if (focus) {
      const target = open
        ? parameterDialog.querySelector<HTMLButtonElement>('.example-parameters-close')
        : parameterToggle;
      target?.focus({ preventScroll: true });
    }
    const url = new URL(view.location.href);
    if (open) url.searchParams.delete('parameters');
    else url.searchParams.set('parameters', 'closed');
    view.history.replaceState(view.history.state, '', url);
  };
  parameterToggle.addEventListener('click', () => setParametersOpen(true, true));
  toolbar.append(tabs);
  heading.append(toolbar);
  const previewTools = element(root, 'div', 'example-demo-toolbar');
  previewTools.append(header);
  const application = element(root, 'div', 'example-application');
  const demoArea = element(root, 'div', 'example-demo-area');
  const panel =
    root.querySelector<HTMLElement>('.emap-example-workbench') ??
    (example.id === 'luma-25d' ? root.querySelector<HTMLElement>('.layout > aside') : null);
  const map = root.getElementById('map') ?? root.getElementById('stage');
  const runtimeStatus = root.getElementById('status');
  let statusObserver: MutationObserver | undefined;
  if (runtimeStatus) {
    runtimeStatus.classList.add('example-runtime-status');
    runtimeStatus.setAttribute('role', 'status');
    runtimeStatus.remove();
    const syncStatus = () => {
      const message = runtimeStatus.textContent?.trim() ?? '';
      const state = runtimeStatus.dataset.state;
      // Older examples report plain text; native examples already expose a state.
      runtimeStatus.dataset.exampleFeedback =
        state === 'error' || state === 'loading' || state === 'rendering'
          ? state
          : /错误|失败|出错|(?:^|\s)(?:\w*Error|Failed|Unable)(?::|\s)/i.test(message)
            ? 'error'
            : /^正在(?:加载|执行|生成|导入|处理)|^(?:Loading|Rendering|Importing)\b/i.test(message)
              ? 'loading'
              : '';
    };
    syncStatus();
    statusObserver = new MutationObserver(syncStatus);
    statusObserver.observe(runtimeStatus, {
      childList: true,
      characterData: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-state'],
    });
  }
  if (map) {
    const parameters = element(root, 'dialog', 'example-parameters');
    parameterDialog = parameters;
    parameters.id = 'example-parameters-dialog';
    parameters.setAttribute('aria-label', '示例操作');
    const parameterHeader = element(root, 'div', 'example-parameter-heading');
    const closeParameters = element(root, 'button', 'example-parameters-close', '收起');
    closeParameters.type = 'button';
    closeParameters.setAttribute('aria-label', '收起操作');
    closeParameters.setAttribute('aria-controls', parameters.id);
    closeParameters.setAttribute('aria-expanded', 'true');
    closeParameters.addEventListener('click', () => setParametersOpen(false, true));
    parameterHeader.append(element(root, 'h2', '', '操作'), closeParameters);
    parameters.append(parameterHeader);
    const panelHost = panel
      ? example.id === 'luma-25d'
        ? panel.parentElement!
        : panel
      : (root.getElementById('benchmark') ?? root.getElementById('editor'));
    demoArea.append(map);
    application.append(demoArea, parameters, parameterToggle);
    application.classList.add('example-with-parameters');
    if (panelHost) {
      if (panel instanceof HTMLDetailsElement) panel.open = true;
      parameters.append(panelHost);
      if (panelHost.classList.contains('runtime-panel'))
        application.classList.add('example-wide-parameters');
    }
    for (const node of original) {
      if (node === header || application.contains(node) || node === runtimeStatus) continue;
      parameters.append(node);
    }
  } else {
    parameterToggle.hidden = true;
    for (const node of original)
      if (node !== header && node !== runtimeStatus) demoArea.append(node);
    application.append(demoArea);
  }
  panels.live.append(previewTools, application);
  if (runtimeStatus) application.append(runtimeStatus);
  const panes = element(root, 'div', 'example-panels');
  panes.append(panels.live, panels.source);
  main.append(heading, panes);
  layout.append(navigation, main);
  root.body.append(siteHeader, layout);
  view.requestAnimationFrame(() => {
    const current = navigation.querySelector<HTMLElement>('[aria-current="page"]');
    if (current)
      navigation.scrollTop = Math.max(0, current.offsetTop - navigation.clientHeight / 2);
  });
  const performance = root.querySelector<HTMLDetailsElement>('.emap-performance');
  if (performance) {
    performance.open = false;
    (parameterDialog ?? demoArea).append(performance);
  }
  activate(new URL(view.location.href).searchParams.get('tab') === 'source' ? 'source' : 'live');
  setParametersOpen(new URL(view.location.href).searchParams.get('parameters') !== 'closed');
  const escape = (event: KeyboardEvent) => {
    if (
      event.key === 'Escape' &&
      !event.defaultPrevented &&
      !panels.live.hidden &&
      parameterDialog?.open
    ) {
      event.preventDefault();
      setParametersOpen(false, true);
    }
  };
  root.addEventListener('keydown', escape);
  const dispose = () => {
    disposeSource?.();
    statusObserver?.disconnect();
    root.removeEventListener('keydown', escape);
    installations.delete(root);
  };
  installations.set(root, dispose);
  return dispose;
}
