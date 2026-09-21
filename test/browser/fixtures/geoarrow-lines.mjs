import { Deck, OrthographicView, COORDINATE_SYSTEM } from "line-reference/core";
import * as arrow from "line-reference/arrow";
import { GeoArrowPathLayer } from "line-reference/path";
const issued = { draws: 0, instances: 0 };
let deck, canvas, origin = [0, 0], width = 1, height = 1, points = 0;
const getState = (v) => ({ target: [(width / 2 - v.bx) / v.mx - origin[0], (height / 2 - v.by) / v.my - origin[1], 0], zoomX: Math.log2(Math.abs(v.mx)), zoomY: Math.log2(Math.abs(v.my)) });
window.lineReference = {
  async init(strokeWidth=1.2) {
    const scene=window.lumaBenchmark.scene,d=scene.dataset,v=d.arcs.getVertexData();
    const stage=document.querySelector('#stage');width=stage.clientWidth;height=stage.clientHeight;
    const ids=new Set();for(const layer of d.layers)for(const shape of layer.shapes??[])if(shape)for(const part of shape)for(const id of part)ids.add(id<0?~id:id);
    const ordered=[...ids].sort((a,b)=>a-b);origin=[v.xx[v.ii[ordered[0]]],v.yy[v.ii[ordered[0]]]];
    const positions=[[v.xx[v.ii[ordered[0]]],v.yy[v.ii[ordered[0]]]]];
    points=ordered.reduce((n,id)=>n+v.nn[id],0);let segments=0;const layers=[];
    let from=0;
    while(from<ordered.length){
      let to=from,count=0;
      while(to<ordered.length&&(count<131072||to===from)){count+=v.nn[ordered[to++]];}
      const offsets=new Int32Array(to-from+1),values=new Float64Array(count*2);let at=0;
      for(let row=from;row<to;row++){
        const id=ordered[row],first=v.ii[id],end=first+v.nn[id];offsets[row-from]=at;
        for(let j=first;j<end;j++){
          values[at*2]=v.xx[j]-origin[0];values[at*2+1]=v.yy[j]-origin[1];at++;
          if(j>first&&(v.xx[j]!==v.xx[j-1]||v.yy[j]!==v.yy[j-1]))segments++;
        }
      }
      offsets[to-from]=at;
      const coords=arrow.makeData({type:new arrow.Float64(),data:values,length:at*2});
      const xyType=new arrow.FixedSizeList(2,new arrow.Field('xy',coords.type));
      const xy=arrow.makeData({type:xyType,child:coords,length:at});
      const type=new arrow.List(new arrow.Field('vertices',xyType));
      const data=arrow.makeData({type,child:xy,valueOffsets:offsets,length:to-from});
      const batch=new arrow.Table({geometry:new arrow.Vector([data])}).batches[0];
      layers.push(new GeoArrowPathLayer({id:'line-reference-'+from,data:batch,getPath:data,
        positionFormat:'XY',coordinateSystem:COORDINATE_SYSTEM.CARTESIAN,
        _pathType:'open',getWidth:strokeWidth,widthUnits:'pixels',getColor:[15,118,110,255],
        opacity:1,capRounded:true,jointRounded:true,billboard:true,pickable:false,
        parameters:{depthWriteEnabled:false,depthCompare:'always'}}));
      from=to;
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
        deviceProps: { webgl: { antialias:true, preserveDrawingBuffer: true } }
      });
    });
    for (let i = 0; i < 10; i++) await new Promise(requestAnimationFrame);
    deck.animationLoop.stop();
    deck.layerManager.updateLayers();
    deck.redraw("validation");
    if (window.__referenceError) throw new Error(window.__referenceError);
    const p = positions[0], actual = deck.getViewports()[0].project([p[0] - origin[0], p[1] - origin[1], 0]);
    const view = window.lumaBenchmark.view, expected = [view.mx * p[0] + view.bx, view.my * p[1] + view.by];
    const gl = canvas.getContext("webgl2");
    const draw = gl.drawElementsInstanced.bind(gl);
    gl.drawElementsInstanced = (...args) => {
      issued.draws++;
      issued.instances += args[4];
      return draw(...args);
    };
    return { points,segments,arcs:ordered.length, batches: layers.length, actual, expected, width, height, dpr: devicePixelRatio, samples: gl.getParameter(gl.SAMPLES), context: gl.getContextAttributes() };
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
