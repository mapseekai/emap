import { examples } from '../../../docs-meta/examples';
import { renderCatalog } from './catalog';
import './styles.css';

const root = document.getElementById('app');
if (!(root instanceof HTMLElement)) {
  throw new Error('Examples app root #app was not found');
}
renderCatalog(root, examples);
