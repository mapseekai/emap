import { Deck, OrthographicView, COORDINATE_SYSTEM } from "point-reference/core";
import * as arrow from "point-reference/arrow";
import { GeoArrowScatterplotLayer } from "point-reference/scatterplot";
const issued = { draws: 0, instances: 0 };
let deck, canvas, origin = [0, 0], width = 1, height = 1, points = 0;
const getState = (v) => ({ target: [(width / 2 - v.bx) / v.mx - origin[0], (height / 2 - v.by) / v.my - origin[1], 0], zoomX: Math.log2(Math.abs(v.mx)), zoomY: Math.log2(Math.abs(v.my)) });
window.pointReference = {
  async init(radius = 3, alpha = 1, antialias = true) {
    const scene = window.lumaBenchmark.scene;
    const source = scene.dataset.layers[0].shapes;
    const stage = document.querySelector("#stage");
    width = stage.clientWidth;
    height = stage.clientHeight;
    const positions = [];
    for (const shape of source) if (shape) {
      if (typeof shape[0] === "number") positions.push(shape);
      else for (const p2 of shape) positions.push(p2);
    }
    origin = positions[0].slice(0, 2);
    points = positions.length;
    const layers = [];
    for (let first = 0; first < points; first += 8192) {
      const count = Math.min(8192, points - first), values = new Float64Array(count * 2);
      for (let i = 0; i < count; i++) {
        values[i * 2] = positions[first + i][0] - origin[0];
        values[i * 2 + 1] = positions[first + i][1] - origin[1];
      }
      const coords = arrow.makeData({ type: new arrow.Float64(), data: values, length: count * 2 });
      const type = new arrow.FixedSizeList(2, new arrow.Field("xy", coords.type));
      const data = arrow.makeData({ type, child: coords, length: count });
      const batch = new arrow.Table({ geometry: new arrow.Vector([data]) }).batches[0];
      layers.push(new GeoArrowScatterplotLayer({
        id: "reference-" + first,
        data: batch,
        getPosition: data,
        positionFormat: "XY",
        coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
        getRadius: radius,
        radiusUnits: "pixels",
        getFillColor: [37, 99, 235, 255],
        opacity: alpha,
        stroked: false,
        filled: true,
        antialiasing: true,
        pickable: false,
        billboard: true,
        parameters: { depthWriteEnabled: false, depthCompare: "always" }
      }));
    }
    document.querySelector("#webgl").hidden = true;
    document.querySelector("#canvas2d").hidden = true;
    canvas = document.createElement("canvas");
    canvas.id = "reference-canvas";
    canvas.style.cssText = "position:absolute;inset:0;z-index:2;pointer-events:none";
    stage.append(canvas);
    await new Promise((resolve, reject) => {
      deck = new Deck({
        canvas,
        width,
        height,
        useDevicePixels: devicePixelRatio,
        controller: false,
        views: new OrthographicView({ id: "ortho", flipY: false }),
        viewState: getState(window.lumaBenchmark.view),
        layers,
        onLoad: () => resolve(),
        onError: (e) => {
          window.__referenceError = String(e);
          console.error("Reference", e);
          reject(e);
        },
        deviceProps: { webgl: { antialias, preserveDrawingBuffer: true } }
      });
    });
    for (let i = 0; i < 10; i++) await new Promise(requestAnimationFrame);
    deck.animationLoop.stop();
    deck.layerManager.updateLayers();
    deck.redraw("validation");
    if (window.__referenceError) throw new Error(window.__referenceError);
    const p = positions[Math.floor(points / 2)], actual = deck.getViewports()[0].project([p[0] - origin[0], p[1] - origin[1], 0]);
    const v = window.lumaBenchmark.view, expected = [v.mx * p[0] + v.bx, v.my * p[1] + v.by];
    const gl = canvas.getContext("webgl2");
    const draw = gl.drawArraysInstanced.bind(gl);
    gl.drawArraysInstanced = (...args) => {
      issued.draws++;
      issued.instances += args[3];
      return draw(...args);
    };
    return { points, batches: layers.length, actual, expected, width, height, dpr: devicePixelRatio, samples: gl.getParameter(gl.SAMPLES), context: gl.getContextAttributes() };
  },
  draw(v) {
    deck.setProps({ viewState: getState(v) });
    deck.layerManager.updateLayers();
    deck.redraw("benchmark");
  },
  show(show) {
    canvas.hidden = !show;
    if (show) {
      document.querySelector("#webgl").hidden = true;
      document.querySelector("#canvas2d").hidden = true;
    }
  },
  getStats() {
    return { ...issued };
  },
  pixels() {
    deck.redraw("pixels");
    const gl = canvas.getContext("webgl2");
    const bytes = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
    let painted = 0;
    for (let i = 3; i < bytes.length; i += 4) if (bytes[i]) painted++;
    return { painted, error: gl.getError() };
  },
  dispose() {
    deck?.finalize();
    canvas?.remove();
    deck = null;
  }
};
