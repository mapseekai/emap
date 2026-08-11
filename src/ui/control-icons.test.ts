// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createControlIcon } from './control-icons';

const iconNames = [
  'zoom-in',
  'zoom-out',
  'home',
  'simplify',
  'polyline',
  'polygon',
  'point',
  'edit',
  'undo',
  'redo',
] as const;

describe('control icons', () => {
  it('creates a fresh, currentColor SVG for every supported control icon', () => {
    const icons = iconNames.map((name) => createControlIcon(name));

    expect(icons.every((icon) => icon.namespaceURI === 'http://www.w3.org/2000/svg')).toBe(true);
    expect(icons.every((icon) => icon.hasAttribute('viewBox'))).toBe(true);
    expect(icons.every((icon) => icon.getAttribute('aria-hidden') === 'true')).toBe(true);
    expect(icons.every((icon) => icon.getAttribute('focusable') === 'false')).toBe(true);
    expect(icons.every((icon) => icon.querySelector('path'))).toBe(true);
    expect(
      icons.every((icon) =>
        [...icon.querySelectorAll('path')].every(
          (path) => path.getAttribute('fill') === 'currentColor',
        ),
      ),
    ).toBe(true);
    expect(
      icons.every((icon) =>
        [...icon.querySelectorAll('path')].every(
          (path) => path.style.getPropertyValue('color') === '',
        ),
      ),
    ).toBe(true);
    expect(createControlIcon('zoom-in')).not.toBe(createControlIcon('zoom-in'));
  });

  it('preserves the authored coordinate system of the edit icon', () => {
    expect(createControlIcon('edit').getAttribute('viewBox')).toBe('0 0 1024 1024');
  });
});
