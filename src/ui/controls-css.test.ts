// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const css = readFileSync(resolve('src/ui/controls.css'), 'utf8');

function mountControls(themeClass?: string) {
  const stylesheet = document.createElement('style');
  stylesheet.textContent = css;
  document.head.append(stylesheet);

  const host = document.createElement('div');
  host.className = themeClass ?? '';
  const group = document.createElement('div');
  group.className = 'emap-ctrl-group';
  const button = document.createElement('button');
  button.className = 'active';
  group.append(button);
  host.append(group);
  document.body.append(host);
  return { host, group, button };
}

afterEach(() => {
  document.head.replaceChildren();
  document.body.replaceChildren();
});

describe('controls.css Mapseek behavior', () => {
  it('exposes the 32px geometry and flat-surface values consumed by controls', () => {
    const { host } = mountControls();
    const icon = document.createElement('span');
    icon.className = 'emap-ctrl-icon';
    const status = document.createElement('div');
    status.className = 'emap-status-ctrl';
    host.append(icon, status);

    const tokenStyle = getComputedStyle(document.documentElement);
    const iconStyle = getComputedStyle(icon);
    const statusStyle = getComputedStyle(status);

    expect(tokenStyle.getPropertyValue('--emap-control-size')).toBe('32px');
    expect(tokenStyle.getPropertyValue('--emap-radius')).toBe('0');
    expect(tokenStyle.getPropertyValue('--emap-surface-shadow')).toBe('none');
    expect(iconStyle.fontSize).toBe('18px');
    expect(statusStyle.padding).toBe('4px 8px');
  });

  it('cascades documented host override points into a control', () => {
    const { host, button } = mountControls();
    const overrides = {
      '--emap-accent': 'rgb(10, 20, 30)',
      '--emap-surface-bg': 'rgb(40, 50, 60)',
      '--emap-surface-border': 'rgb(70, 80, 90)',
      '--emap-hover-bg': 'rgb(100, 110, 120)',
      '--emap-danger': 'rgb(130, 140, 150)',
      '--emap-radius': '7px',
      '--emap-surface-shadow': '0 0 1px black',
      '--emap-font': '12px serif',
    };
    for (const [name, value] of Object.entries(overrides)) host.style.setProperty(name, value);

    const controlStyle = getComputedStyle(button);
    for (const [name, value] of Object.entries(overrides)) {
      expect(controlStyle.getPropertyValue(name)).toBe(value);
    }
  });

  it('switches the inherited theme bridge when its host becomes dark', () => {
    const { host: lightHost } = mountControls();
    const { host: darkHost } = mountControls('dark');

    expect(getComputedStyle(darkHost).getPropertyValue('--emap-accent'))
      .not.toBe(getComputedStyle(lightHost).getPropertyValue('--emap-accent'));
    expect(getComputedStyle(darkHost).getPropertyValue('--emap-selection-bg'))
      .not.toBe(getComputedStyle(lightHost).getPropertyValue('--emap-selection-bg'));
  });

  it('renders the fixed control details that jsdom can compute', () => {
    const { group, button } = mountControls();
    const groupStyle = getComputedStyle(group);
    const buttonStyle = getComputedStyle(button);

    expect(groupStyle.display).toBe('flex');
    expect(buttonStyle.cursor).toBe('pointer');
  });
});
