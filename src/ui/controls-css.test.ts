// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveThemeColor } from '../theme/colors';

const css = readFileSync(resolve('src/ui/controls.css'), 'utf8');

function mountControls(themeClass?: string, stylesheetText = css) {
  const stylesheet = document.createElement('style');
  stylesheet.textContent = stylesheetText;
  document.head.append(stylesheet);

  const host = document.createElement('div');
  host.className = themeClass ?? '';
  const group = document.createElement('div');
  group.className = 'emap-ctrl emap-ctrl-group';
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
    const { host, group, button } = mountControls();
    button.classList.remove('active');
    const icon = document.createElement('span');
    icon.className = 'emap-ctrl-icon';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.append(svg);
    button.append(icon);
    const status = document.createElement('div');
    status.className = 'emap-status-ctrl';
    host.append(status);

    const tokenStyle = getComputedStyle(document.documentElement);
    const buttonStyle = getComputedStyle(button);
    const iconStyle = getComputedStyle(icon);
    const svgStyle = getComputedStyle(svg);
    const statusStyle = getComputedStyle(status);

    expect(tokenStyle.getPropertyValue('--emap-control-size')).toBe('32px');
    expect(tokenStyle.getPropertyValue('--emap-radius')).toBe('0');
    expect(tokenStyle.getPropertyValue('--emap-surface-shadow')).toBe('none');
    expect(buttonStyle.display).toBe('flex');
    expect(buttonStyle.alignItems).toBe('center');
    expect(buttonStyle.justifyContent).toBe('center');
    expect(buttonStyle.color).toBe(getComputedStyle(group).color);
    expect(iconStyle.fontSize).toBe('18px');
    expect(iconStyle.display).toBe('inline-flex');
    expect(iconStyle.width).toBe('100%');
    expect(iconStyle.height).toBe('100%');
    expect(svgStyle.display).toBe('block');
    expect(svgStyle.width).toBe('1em');
    expect(svgStyle.height).toBe('1em');
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

  it('resolves local host and legacy colors at the actual control boundary', () => {
    const { host, group } = mountControls();
    const readVariable = (name: string) => getComputedStyle(group).getPropertyValue(name);
    host.style.setProperty('--primary', 'rgb(10, 20, 30)');
    host.style.setProperty('--foreground', 'rgb(40, 50, 60)');

    expect(resolveThemeColor('var(--emap-current-primary)', 'transparent', readVariable)).toBe(
      'rgb(10, 20, 30)',
    );
    expect(resolveThemeColor('var(--emap-current-foreground)', 'transparent', readVariable)).toBe(
      'rgb(40, 50, 60)',
    );

    host.style.removeProperty('--primary');
    host.style.setProperty('--emap-accent', 'rgb(70, 80, 90)');
    expect(resolveThemeColor('var(--emap-current-primary)', 'transparent', readVariable)).toBe(
      'rgb(70, 80, 90)',
    );

    host.style.setProperty('--accent', 'rgb(100, 0, 0)');
    expect(readVariable('--emap-current-hover-bg')).toContain('transparent 50%');

    host.style.removeProperty('--accent');
    host.style.setProperty('--emap-hover-bg', 'rgb(100, 110, 120)');
    expect(resolveThemeColor('var(--emap-current-hover-bg)', 'transparent', readVariable)).toBe(
      'rgb(100, 110, 120)',
    );
  });

  it('switches the inherited theme bridge when its host becomes dark', () => {
    const { host: lightHost } = mountControls();
    const { host: darkHost } = mountControls('dark');

    expect(getComputedStyle(darkHost).getPropertyValue('--emap-accent')).not.toBe(
      getComputedStyle(lightHost).getPropertyValue('--emap-accent'),
    );
    expect(getComputedStyle(darkHost).getPropertyValue('--emap-selection-bg')).not.toBe(
      getComputedStyle(lightHost).getPropertyValue('--emap-selection-bg'),
    );
  });

  it('resolves primary and destructive colors through dark fallbacks without host overrides', () => {
    const { group } = mountControls();
    group.style.setProperty('--emap-accent', 'oklch(0.6800 0.1940 149)');
    group.style.setProperty('--emap-danger', 'oklch(0.7000 0.1800 25)');
    const readVariable = (name: string) => getComputedStyle(group).getPropertyValue(name);

    expect(resolveThemeColor('var(--emap-current-primary)', 'transparent', readVariable)).toBe(
      'oklch(0.6800 0.1940 149)',
    );
    expect(resolveThemeColor('var(--emap-current-destructive)', 'transparent', readVariable)).toBe(
      'oklch(0.7000 0.1800 25)',
    );
  });

  it('renders the fixed control details that jsdom can compute', () => {
    const { group, button } = mountControls();
    const groupStyle = getComputedStyle(group);
    const buttonStyle = getComputedStyle(button);

    expect(groupStyle.display).toBe('flex');
    expect(buttonStyle.cursor).toBe('pointer');
  });

  it('keeps dividers out of the icon button box geometry', () => {
    const { group, button } = mountControls();
    const lastButton = document.createElement('button');
    group.append(lastButton);

    const buttonStyle = getComputedStyle(button);
    const lastButtonStyle = getComputedStyle(lastButton);

    expect(buttonStyle.borderBottomWidth).toBe('0px');
    expect(buttonStyle.boxShadow).toContain('inset 0 -1px');
    expect(lastButtonStyle.boxShadow).toBe('none');
  });

  it('lays out semantic simplify fields with themed form controls', () => {
    const { host, group } = mountControls();
    host.style.setProperty('--emap-input', 'rgb(1, 2, 3)');
    const popup = document.createElement('div');
    popup.className = 'emap-simplify-popup';
    const field = document.createElement('div');
    field.className = 'emap-simplify-field';
    const label = document.createElement('label');
    label.className = 'emap-simplify-label';
    const input = document.createElement('input');
    input.className = 'emap-simplify-range';
    const select = document.createElement('select');
    select.className = 'emap-simplify-select';
    const apply = document.createElement('button');
    apply.className = 'emap-simplify-apply';
    field.append(label, input, select, apply);
    popup.append(field);
    group.append(popup);

    expect(getComputedStyle(field).marginBottom).toBe('8px');
    expect(getComputedStyle(label).gap).toBe('6px');
    expect(getComputedStyle(input).borderTopWidth).toBe('1px');
    expect(getComputedStyle(select).height).toBe('var(--emap-control-size)');
    const applyStyle = getComputedStyle(apply);
    expect(applyStyle.height).toBe('var(--emap-control-size)');
    expect(applyStyle.paddingInline).toBe('10px');
    expect(applyStyle.borderTopWidth).toBe('1px');
    expect(applyStyle.width).not.toBe('var(--emap-control-size)');

    apply.disabled = true;
    const disabledStyle = getComputedStyle(apply);
    expect(disabledStyle.opacity).toBe('0.5');
    expect(disabledStyle.cursor).toBe('not-allowed');
  });

  it('allows the simplify popup to extend beyond its control group', () => {
    const { group } = mountControls();
    group.classList.add('emap-ctrl-simplify-wrap');
    const popup = document.createElement('div');
    popup.className = 'emap-simplify-popup';
    group.append(popup);

    expect(getComputedStyle(group).overflow).toBe('visible');
  });

  it.each([
    [undefined, {
      foreground: 'oklch(0.2500 0.0100 149)',
      card: 'oklch(1 0 0)',
      border: 'oklch(0.9200 0.0050 149)',
    }],
    ['dark', {
      foreground: 'oklch(0.9500 0.0050 149)',
      card: 'oklch(0.2000 0.0100 149)',
      border: 'oklch(1 0 0 / 12%)',
    }],
  ] as const)('themes scale controls on %s hosts', (themeClass, expected) => {
    // jsdom does not resolve CSS custom properties for computed border colors.
    // Render the same stylesheet with its scale-control theme variables resolved.
    const stylesheetText = css
      .replaceAll('var(--emap-current-card-foreground)', expected.foreground)
      .replaceAll('var(--emap-current-card)', expected.card)
      .replaceAll('var(--emap-current-border)', expected.border);
    const { host } = mountControls(themeClass, stylesheetText);
    const scale = document.createElement('div');
    scale.className = 'emap-ctrl emap-scale-ctrl';
    const bar = document.createElement('div');
    bar.className = 'emap-scale-bar';
    for (let index = 0; index < 4; index += 1) {
      const segment = document.createElement('span');
      segment.className = 'emap-scale-segment';
      bar.append(segment);
    }
    scale.append(bar);
    host.append(scale);

    const expectedControl = document.createElement('div');
    expectedControl.style.color = expected.foreground;
    expectedControl.style.background = expected.card;
    expectedControl.style.border = `1px solid ${expected.border}`;
    host.append(expectedControl);

    const scaleStyle = getComputedStyle(scale);
    const expectedStyle = getComputedStyle(expectedControl);
    expect(scaleStyle.color).toBe(expectedStyle.color);
    expect(scaleStyle.backgroundColor).toBe(expectedStyle.backgroundColor);
    expect(scaleStyle.borderTopColor).toBe(expectedStyle.borderTopColor);
  });
});
