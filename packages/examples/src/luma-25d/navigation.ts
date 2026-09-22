import type { PerspectiveTransform } from '../../../../src/domain/geo/perspective-transform';

/** DOM adapter for the opt-in luma example; the domain camera owns all coordinate math. */
export function installNavigation(
  stage: HTMLElement,
  getView: () => PerspectiveTransform,
  change: () => void,
  interacting: (active: boolean) => void,
  pick: (x: number, y: number) => void,
): () => void {
  const listeners = new AbortController();
  const options = { signal: listeners.signal };
  let drag: { id: number; x: number; y: number; distance: number; rotate: boolean } | null = null;
  let wheelTimer: ReturnType<typeof setTimeout> | undefined;
  const point = (e: PointerEvent | WheelEvent): [number, number] => {
    const b = stage.getBoundingClientRect();
    return [e.clientX - b.left, e.clientY - b.top];
  };
  const finish = () => {
    if (drag && stage.hasPointerCapture(drag.id)) stage.releasePointerCapture(drag.id);
    drag = null;
    stage.style.cursor = 'grab';
    interacting(false);
  };
  stage.addEventListener('contextmenu', (e) => e.preventDefault(), options);
  stage.addEventListener(
    'pointerdown',
    (e) => {
      if (drag || (e.button !== 0 && e.button !== 2)) return;
      const [x, y] = point(e);
      drag = { id: e.pointerId, x, y, distance: 0, rotate: e.button === 2 || e.shiftKey };
      stage.setPointerCapture(e.pointerId);
      stage.focus();
      stage.style.cursor = 'grabbing';
      interacting(true);
      e.preventDefault();
    },
    options,
  );
  stage.addEventListener(
    'pointermove',
    (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const [x, y] = point(e),
        dx = x - drag.x,
        dy = y - drag.y,
        view = getView();
      drag.distance += Math.hypot(dx, dy);
      drag.x = x;
      drag.y = y;
      if (drag.rotate)
        view.setOrientation({
          bearing: view.bearing + dx * 0.4,
          pitch: Math.max(0, Math.min(60, view.pitch - dy * 0.3)),
        });
      else view.pan(dx, dy, x, y);
      change();
    },
    options,
  );
  stage.addEventListener(
    'pointerup',
    (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const click = drag.distance < 4 && !drag.rotate,
        [x, y] = point(e);
      finish();
      if (click) pick(x, y);
    },
    options,
  );
  stage.addEventListener('pointercancel', finish, options);
  stage.addEventListener(
    'lostpointercapture',
    () => {
      if (drag) finish();
    },
    options,
  );
  stage.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const view = getView(),
        [x, y] = point(e);
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? view.height : 1;
      const k = Math.exp(-Math.max(-160, Math.min(160, e.deltaY * unit)) * 0.002);
      if (Math.abs(view.mx * k) > 1e-12 && Math.abs(view.mx * k) < 1e12) view.scale(k, x, y);
      interacting(true);
      change();
      clearTimeout(wheelTimer);
      wheelTimer = setTimeout(() => interacting(false), 100);
    },
    { ...options, passive: false },
  );
  stage.addEventListener(
    'keydown',
    (e) => {
      const view = getView();
      if (e.key === 'ArrowLeft') view.pan(48, 0);
      else if (e.key === 'ArrowRight') view.pan(-48, 0);
      else if (e.key === 'ArrowUp') view.pan(0, 48);
      else if (e.key === 'ArrowDown') view.pan(0, -48);
      else if (e.key === '+' || e.key === '=') view.scale(1.3, view.width / 2, view.height / 2);
      else if (e.key === '-') view.scale(1 / 1.3, view.width / 2, view.height / 2);
      else return;
      e.preventDefault();
      change();
    },
    options,
  );
  return () => {
    listeners.abort();
    clearTimeout(wheelTimer);
    finish();
  };
}
