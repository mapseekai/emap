import '@zwishing/emap/style.css';
import { examples } from '../../../docs-meta/examples';
import { renderCatalog } from './catalog';
import { renderExamplePage, renderMissingExample, resolveExampleId } from './example-page';
import './styles.css';

const root = document.getElementById('app');
if (!(root instanceof HTMLElement)) {
  throw new Error('Examples app root #app was not found');
}
const appRoot = root;

function render(): void {
  const id = resolveExampleId(window.location);
  if (!id) {
    renderCatalog(appRoot, examples);
    return;
  }

  const example = examples.find((item) => item.id === id);
  if (!example) {
    renderMissingExample(appRoot, id);
    return;
  }

  renderExamplePage(appRoot, example);
}

window.addEventListener('hashchange', render);
render();
