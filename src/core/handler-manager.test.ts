import { describe, it, expect } from 'vitest';
import { HandlerManager } from './handler-manager';
import type { Handler } from './handler';

function fake(name: string): Handler & { _on: boolean } {
  let on = true;
  return {
    name, _on: on,
    enable() { (this as any)._on = true; }, disable() { (this as any)._on = false; },
    isEnabled() { return (this as any)._on; },
    setOptions() {}, getOptions: () => ({}),
    handlePointer: () => 'passthrough' as const,
  };
}

describe('HandlerManager', () => {
  it('register + get by name', () => {
    const m = new HandlerManager();
    const h = fake('dragPan');
    m.register(h);
    expect(m.get('dragPan')).toBe(h);
    expect(m.get('nope')).toBeUndefined();
  });

  it('rejects a non-Handler', () => {
    const m = new HandlerManager();
    expect(() => m.register({ name: 'x' } as any)).toThrow(/not a valid Handler/);
  });

  it('applyInteractive(false) disables dragPan + scrollZoom; true re-enables', () => {
    const m = new HandlerManager();
    const pan = fake('dragPan');
    const zoom = fake('scrollZoom');
    m.register(pan); m.register(zoom);
    m.applyInteractive(false);
    expect(pan.isEnabled()).toBe(false);
    expect(zoom.isEnabled()).toBe(false);
    m.applyInteractive(true);
    expect(pan.isEnabled()).toBe(true);
    expect(zoom.isEnabled()).toBe(true);
  });

  it('applyInteractive is a no-op for unregistered handlers', () => {
    const m = new HandlerManager();
    m.register(fake('dragPan')); // scrollZoom absent
    expect(() => m.applyInteractive(false)).not.toThrow();
  });
});
