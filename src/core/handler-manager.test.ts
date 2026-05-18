// @vitest-environment jsdom
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

describe('HandlerManager pointer arbitration', () => {
  function recordingHandler(name: string, result: 'passthrough' | 'consumed' | 'exclusive') {
    const calls: any[] = [];
    return {
      h: {
        name,
        enable() {}, disable() {}, isEnabled: () => true,
        setOptions() {}, getOptions: () => ({}),
        handlePointer: (ev: any) => { calls.push(ev); return result; },
      } as Handler,
      calls,
    };
  }

  it('attach() normalizes pointerdown and dispatches a NormalizedPointerEvent', () => {
    const el = document.createElement('div');
    el.getBoundingClientRect = () => ({ left: 10, top: 20, width: 0, height: 0, right: 0, bottom: 0, x: 10, y: 20, toJSON() {} });
    const m = new HandlerManager();
    const { h, calls } = recordingHandler('dragPan', 'passthrough');
    m.register(h);
    m.attach(el);
    el.dispatchEvent(new PointerEvent('pointerdown', { clientX: 40, clientY: 50, shiftKey: true, button: 0 }));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      kind: 'down', point: { x: 30, y: 30 },
      modifiers: { shift: true, ctrl: false, alt: false, meta: false }, button: 0,
    });
    m.detach();
  });

  it('detach() removes listeners', () => {
    const el = document.createElement('div');
    el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON() {} });
    const m = new HandlerManager();
    const { h, calls } = recordingHandler('dragPan', 'passthrough');
    m.register(h); m.attach(el); m.detach();
    el.dispatchEvent(new PointerEvent('pointerdown', { clientX: 1, clientY: 1 }));
    expect(calls).toHaveLength(0);
  });

  it('exclusive gesture: down→exclusive owner gets all move/up until non-exclusive', () => {
    const el = document.createElement('div');
    el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON() {} });
    const m = new HandlerManager();
    let phase = 'exclusive';
    const calls: string[] = [];
    const owner = { name: 'dragPan', enable(){}, disable(){}, isEnabled:()=>true, setOptions(){}, getOptions:()=>({}),
      handlePointer:(ev:any)=>{ calls.push(ev.kind); return ev.kind === 'up' ? 'passthrough' : phase; } } as Handler;
    const lower = recordingHandler('clickSelect', 'passthrough');
    // priority puts clickSelect ahead of dragPan, but owner takes exclusive on down
    m.register(lower.h); m.register(owner); m.attach(el);
    el.dispatchEvent(new PointerEvent('pointerdown', { clientX: 0, clientY: 0, button: 0 }));
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 5, clientY: 0 }));
    window.dispatchEvent(new PointerEvent('pointerup', { clientX: 5, clientY: 0 }));
    expect(calls).toEqual(['down', 'move', 'up']);
    // lower priority must NOT have seen move/up (owner had the exclusive lock)
    expect(lower.calls.map((c:any)=>c.kind)).not.toContain('move');
    m.detach();
  });
});

describe('HandlerManager pointer sink', () => {
  function passHandler(name = 'dragPan') {
    return { name, enable() {}, disable() {}, isEnabled: () => true,
      setOptions() {}, getOptions: () => ({}), handlePointer: () => 'passthrough' as const };
  }
  function exclHandler(name = 'dragPan') {
    let on = false;
    return { name, enable() {}, disable() {}, isEnabled: () => true,
      setOptions() {}, getOptions: () => ({}),
      handlePointer: (e: any) => { if (e.kind === 'down') { on = true; return 'exclusive' as const; }
        if (e.kind === 'up') { on = false; return 'passthrough' as const; }
        return on ? 'exclusive' as const : 'passthrough' as const; } };
  }
  function norm(kind: any) {
    return { kind, point: { x: 1, y: 2 }, modifiers: { shift: false, ctrl: false, alt: false, meta: false },
      button: 0, originalEvent: new Event(kind) };
  }
  function mgrWith(h: any) {
    const el = document.createElement('div');
    el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON() {} }) as any;
    const m = new HandlerManager();
    m.register(h);
    m.attach(el);
    return { m, el };
  }

  it('sink receives click and move (no exclusive); not down/up', () => {
    const seen: string[] = [];
    const { m } = mgrWith(passHandler());
    m.setPointerSink((e) => seen.push(e.kind));
    (m as any)._dispatch(norm('down'));
    (m as any)._dispatch(norm('move'));
    (m as any)._dispatch(norm('up'));
    (m as any)._dispatch(norm('click'));
    expect(seen).toEqual(['move', 'click']);
    m.detach();
  });

  it('sink does NOT get move while an exclusive gesture is active; still gets click', () => {
    const seen: string[] = [];
    const { m } = mgrWith(exclHandler());
    m.setPointerSink((e) => seen.push(e.kind));
    (m as any)._dispatch(norm('down'));
    (m as any)._dispatch(norm('move'));
    (m as any)._dispatch(norm('up'));
    (m as any)._dispatch(norm('move'));
    (m as any)._dispatch(norm('click'));
    expect(seen).toEqual(['move', 'click']);
    m.detach();
  });

  it('setPointerSink(null) removes the sink', () => {
    const seen: string[] = [];
    const { m } = mgrWith(passHandler());
    m.setPointerSink((e) => seen.push(e.kind));
    m.setPointerSink(null);
    (m as any)._dispatch(norm('click'));
    expect(seen).toEqual([]);
    m.detach();
  });
});

describe('HandlerManager contextmenu kind', () => {
  function recordHandler() {
    const calls: any[] = [];
    return { calls, h: { name: 'dragPan', enable() {}, disable() {}, isEnabled: () => true,
      setOptions() {}, getOptions: () => ({}),
      handlePointer: (e: any) => { calls.push(e.kind); return 'passthrough' as const; } } };
  }
  function el() {
    const e = document.createElement('div');
    e.getBoundingClientRect = () => ({ left: 5, top: 7, width: 0, height: 0, right: 0, bottom: 0, x: 5, y: 7, toJSON() {} }) as any;
    return e;
  }

  it('normalizes a contextmenu DOM event and dispatches it through the priority loop', () => {
    const { h, calls } = recordHandler();
    const m = new HandlerManager();
    m.register(h);
    const element = el();
    m.attach(element);
    element.dispatchEvent(new MouseEvent('contextmenu', { clientX: 25, clientY: 27, button: 2, cancelable: true }));
    expect(calls).toEqual(['contextmenu']);
    m.detach();
  });

  it('contextmenu is NOT fed to the P3 pointer sink', () => {
    const { h } = recordHandler();
    const m = new HandlerManager();
    m.register(h);
    const sink: string[] = [];
    m.setPointerSink((e) => sink.push(e.kind));
    const element = el();
    m.attach(element);
    element.dispatchEvent(new MouseEvent('contextmenu', { clientX: 1, clientY: 1, button: 2 }));
    expect(sink).toEqual([]);
    m.detach();
  });

  it('detach() removes the contextmenu listener', () => {
    const { h, calls } = recordHandler();
    const m = new HandlerManager();
    m.register(h);
    const element = el();
    m.attach(element);
    m.detach();
    element.dispatchEvent(new MouseEvent('contextmenu', { clientX: 1, clientY: 1, button: 2 }));
    expect(calls).toEqual([]);
  });
});

describe('HandlerManager dblclick kind', () => {
  function recordHandler() {
    const calls: any[] = [];
    return { calls, h: { name: 'dragPan', enable() {}, disable() {}, isEnabled: () => true,
      setOptions() {}, getOptions: () => ({}),
      handlePointer: (e: any) => { calls.push(e.kind); return 'passthrough' as const; } } };
  }
  function el() {
    const e = document.createElement('div');
    e.getBoundingClientRect = () => ({ left: 4, top: 6, width: 0, height: 0, right: 0, bottom: 0, x: 4, y: 6, toJSON() {} }) as any;
    return e;
  }

  it('normalizes a dblclick DOM event and dispatches via the priority loop', () => {
    const { h, calls } = recordHandler();
    const m = new HandlerManager();
    m.register(h);
    const element = el();
    m.attach(element);
    element.dispatchEvent(new MouseEvent('dblclick', { clientX: 24, clientY: 26, button: 0 }));
    expect(calls).toEqual(['dblclick']);
    m.detach();
  });

  it('dblclick is NOT fed to the P3 pointer sink', () => {
    const { h } = recordHandler();
    const m = new HandlerManager();
    m.register(h);
    const sink: string[] = [];
    m.setPointerSink((e) => sink.push(e.kind));
    const element = el();
    m.attach(element);
    element.dispatchEvent(new MouseEvent('dblclick', { clientX: 1, clientY: 1, button: 0 }));
    expect(sink).toEqual([]);
    m.detach();
  });

  it('detach() removes the dblclick listener', () => {
    const { h, calls } = recordHandler();
    const m = new HandlerManager();
    m.register(h);
    const element = el();
    m.attach(element);
    m.detach();
    element.dispatchEvent(new MouseEvent('dblclick', { clientX: 1, clientY: 1, button: 0 }));
    expect(calls).toEqual([]);
  });
});

describe('HandlerManager cursor arbitration (DX P11)', () => {
  function stub(name: string, cursor: string | null, enabled = true) {
    return {
      name,
      _enabled: enabled,
      enable() { this._enabled = true; },
      disable() { this._enabled = false; },
      isEnabled() { return this._enabled; },
      setOptions() {},
      getOptions() { return {}; },
      handlePointer() { return 'passthrough' as const; },
      getCursor() { return this._enabled ? cursor : null; },
    };
  }
  function el(): HTMLElement {
    return document.createElement('div');
  }

  it('writes the highest-priority enabled non-null cursor to the element', () => {
    const m = new HandlerManager();
    const e = el();
    m.register(stub('dragPan', 'grab') as any);
    m.register(stub('drawFeature', 'crosshair') as any);
    m.attach(e);
    m.refreshCursor();
    expect(e.style.cursor).toBe('crosshair');
  });

  it('falls through null cursors to a lower-priority handler', () => {
    const m = new HandlerManager();
    const e = el();
    m.register(stub('drawFeature', null) as any);
    m.register(stub('dragPan', 'grab') as any);
    m.attach(e);
    m.refreshCursor();
    expect(e.style.cursor).toBe('grab');
  });

  it('clears the cursor when no enabled handler has an opinion', () => {
    const m = new HandlerManager();
    const e = el();
    e.style.cursor = 'grab';
    m.register(stub('dragPan', null) as any);
    m.attach(e);
    m.refreshCursor();
    expect(e.style.cursor).toBe('');
  });

  it('refreshCursor recomputes after an out-of-band disable', () => {
    const m = new HandlerManager();
    const e = el();
    const dp = stub('dragPan', 'grab');
    m.register(dp as any);
    m.attach(e);
    m.refreshCursor();
    expect(e.style.cursor).toBe('grab');
    dp.disable();
    m.refreshCursor();
    expect(e.style.cursor).toBe('');
  });

  it('detach() resets the element cursor and is safe with no element', () => {
    const m = new HandlerManager();
    const e = el();
    e.style.cursor = 'crosshair';
    m.register(stub('dragPan', 'grab') as any);
    m.attach(e);
    m.detach();
    expect(e.style.cursor).toBe('');
    expect(() => m.detach()).not.toThrow();
  });

  it('exclusive handler cursor overrides higher-priority handlers', () => {
    const m = new HandlerManager();
    const e = el();
    // drawFeature has higher PRIORITY than dragPan
    m.register(stub('drawFeature', 'crosshair') as any);
    m.register(stub('dragPan', 'grab') as any);
    m.attach(e);
    // Simulate dragPan having won the gesture (exclusive lock)
    (m as unknown as { _exclusive: unknown })._exclusive = m.get('dragPan');
    m.refreshCursor();
    expect(e.style.cursor).toBe('grab'); // exclusive wins despite lower PRIORITY
  });
});
