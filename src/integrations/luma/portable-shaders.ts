import { cameraWGSL } from './camera-shaders';
import { pathMsaaVS, pathMsaaFS, pathMsaaWGSL } from './path-shaders';
import type { BufferLayout, ShaderLayout } from '@luma.gl/core';
import {
  emapModule,
  fillVS,
  fillFS,
  pointVS,
  pointFS,
  lineVS,
  lineFS,
  imageVS,
  imageFS,
} from './shaders';
import {
  circleVS,
  circleFS,
  circleWGSL,
  circleCoreVS,
  circleCoreFS,
  circleCoreWGSL,
  pointDepthResetVS,
  pointDepthResetFS,
  pointDepthResetWGSL,
} from './circle-shaders';
import type { GeometryBuffer } from './types';
export type PipelineKind =
  | GeometryBuffer['kind']
  | 'image'
  | 'circle'
  | 'circle-core'
  | 'circle-edge'
  | 'point-depth-reset'
  | 'path-msaa'
  | 'path-msaa-reference';

// Continuous path joins: do not enlarge every internal subpixel segment into a round capsule.
const pathVS = `#version 300 es
in vec2 corners;
in vec4 previousPosition;
in vec4 startPosition;
in vec4 endPosition;
in vec4 nextPosition;
in vec2 pathDistance;
in float pathFlags;
out vec2 localPosition;
flat out float segmentLength;
flat out float startDistance;
vec2 joinOffset(vec2 a, vec2 b, float side, float width) {
 float la=length(a), lb=length(b);
 vec2 da=la>0.0?a/la:vec2(1.0,0.0), db=lb>0.0?b/lb:da;
 vec2 tangent=da+db;
 tangent=length(tangent)>1e-5?normalize(tangent):da;
 vec2 normal=vec2(-tangent.y,tangent.x), n=vec2(-db.y,db.x);
 float size=min(1.0/max(abs(dot(normal,n)),0.001),4.0);
 if(side*(da.x*db.y-da.y*db.x)>0.0) size=min(size,max(la,lb)/max(width,1e-8));
 return normal*(side*width*size);
}
void main(){
 vec2 a=projectPosition(previousPosition), b=projectSegmentPosition(startPosition,endPosition);
 vec2 c=projectSegmentPosition(endPosition,startPosition), d=projectPosition(nextPosition);
 vec2 delta=projectDifference(endPosition,startPosition);float len=length(delta);segmentLength=len;
 vec2 dir=len>0.0?delta/len:vec2(1.0,0.0);
 float w=emap.parameters.x*0.5+0.5/emap.pixelRatio;
 bool end=corners.x>0.0;int flags=int(pathFlags);
 bool cap=end?((flags&2)!=0):((flags&1)!=0);
 vec2 offset=joinOffset(end?delta:projectDifference(startPosition,previousPosition),end?projectDifference(nextPosition,endPosition):delta,corners.y,w);
 float extra=cap?w:0.0;
 if(cap) offset=vec2(-dir.y,dir.x)*corners.y*w+dir*extra*(end?1.0:-1.0);
 localPosition=vec2(corners.y*w,end?len+extra:-extra);
 startDistance=(pathDistance.x+pathDistance.y)*abs(emap.scale.x);
 gl_Position=clipPosition((end?c:b)+offset);
 if(flags>=4 || len==0.0) gl_Position=vec4(2.0,2.0,0.0,1.0);
}`;
const pathFS = `#version 300 es
precision highp float;
in vec2 localPosition;
flat in float segmentLength;
flat in float startDistance;
uniform sampler2D dashTexture;
out vec4 fragColor;
void main(){
 float outside=max(max(-localPosition.y,localPosition.y-segmentLength),0.0);
 float distance=length(vec2(localPosition.x,outside))-emap.parameters.x*0.5;
 float aa=max(fwidth(distance),0.5/emap.pixelRatio);
 float coverage=1.0-smoothstep(-aa*0.5,aa*0.5,distance);
 if(emap.parameters.z>0.0 && emap.parameters.y>0.0){
  float phase=mod(startDistance+localPosition.y,emap.parameters.y), prev=0.0;bool on=false;
  for(int i=0;i<int(emap.parameters.z);i++){
   float edge=texelFetch(dashTexture,ivec2(i,0),0).r;
   if(i%2==0 && phase>=prev && phase<=edge) on=true;prev=edge;
  }
  if(!on) discard;
 }
 if(coverage<=0.0) discard;
 float alpha=emap.color.a*coverage;fragColor=vec4(emap.color.rgb*alpha,alpha);
}`;
const uniformWGSL = `
struct EmapUniforms {
 origin:vec4<f32>,scale:vec2<f32>,viewport:vec2<f32>,color:vec4<f32>,parameters:vec4<f32>,rect:vec4<f32>,
 vertices0:vec4<f32>,vertices1:vec4<f32>,vertices2:vec4<f32>,vertices3:vec4<f32>,vertices4:vec4<f32>,vertices5:vec4<f32>,
 arrow:vec2<f32>,pixelRatio:f32,lowScale:vec2<f32>,camera:vec4<f32>,uvRect:vec4<f32>,
};
@group(0) @binding(0) var<uniform> emap:EmapUniforms;
${cameraWGSL}
fn premultiply(coverage:f32)->vec4<f32>{let a=emap.color.a*coverage;return vec4<f32>(emap.color.rgb*a,a);}
`;
const fillWGSL = `
@vertex fn vertexMain(@location(0) positions:vec4<f32>)->@builtin(position) vec4<f32>{return groundClipPosition(rawDifference(positions,emap.origin));}
@fragment fn fragmentMain()->@location(0) vec4<f32>{return premultiply(1.0);}
`;
const pointWGSL = `
struct PointOut{@builtin(position) position:vec4<f32>,@location(0) local:vec2<f32>};
@vertex fn vertexMain(@location(0) corners:vec2<f32>,@location(1) instancePositions:vec4<f32>)->PointOut{
 let extent=emap.parameters.x+emap.parameters.y+1.0/emap.pixelRatio;let local=corners*extent;
 return PointOut(billboardPosition(instancePositions,local),local);
}
fn markerVertex(index:i32)->vec2<f32>{
 switch(index){
  case 0:{return emap.vertices0.xy;}case 1:{return emap.vertices0.zw;}
  case 2:{return emap.vertices1.xy;}case 3:{return emap.vertices1.zw;}
  case 4:{return emap.vertices2.xy;}case 5:{return emap.vertices2.zw;}
  case 6:{return emap.vertices3.xy;}case 7:{return emap.vertices3.zw;}
  case 8:{return emap.vertices4.xy;}case 9:{return emap.vertices4.zw;}
  case 10:{return emap.vertices5.xy;}default:{return emap.vertices5.zw;}
 }
}
fn markerDistance(point:vec2<f32>)->f32{
 let radius=emap.parameters.x;let count=i32(emap.parameters.z);if(count==0){return length(point)-radius;}
 let p=point/radius;var squaredDistance=1e20;var inside=false;var a=markerVertex(count-1);
 for(var i=0;i<12;i++){
  if(i>=count){break;}let b=markerVertex(i);let edge=b-a;let delta=p-a;
  let closest=delta-edge*clamp(dot(delta,edge)/max(dot(edge,edge),1e-20),0.0,1.0);
  squaredDistance=min(squaredDistance,dot(closest,closest));
  if((a.y>p.y)!=(b.y>p.y)){if(p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x){inside=!inside;}}a=b;
 }
 return sqrt(squaredDistance)*radius*select(1.0,-1.0,inside);
}
@fragment fn fragmentMain(p:PointOut)->@location(0) vec4<f32>{
 var d=markerDistance(p.local);if(emap.parameters.w<0.5){d=abs(d)-emap.parameters.y*0.5;}
 let aa=max(fwidth(d),0.5/emap.pixelRatio);let coverage=1.0-smoothstep(-aa*0.5,aa*0.5,d);
 if(coverage<=0.0){discard;}return premultiply(coverage);
}
`;
const lineCommonWGSL = `
@group(0) @binding(1) var dashTexture:texture_2d<f32>;
struct LineOut{@builtin(position) position:vec4<f32>,@location(0) local:vec2<f32>,@location(1) @interpolate(flat) len:f32,@location(2) @interpolate(flat) start:f32};
fn segmentDistance(p:vec2<f32>,a:vec2<f32>,b:vec2<f32>)->f32{
 let ab=b-a;return length(p-a-ab*clamp(dot(p-a,ab)/max(dot(ab,ab),1e-20),0.0,1.0));
}
`;
const lineWGSL =
  lineCommonWGSL +
  `
@vertex fn vertexMain(@location(0) corners:vec2<f32>,@location(1) instanceStart:vec4<f32>,@location(2) instanceEnd:vec4<f32>,@location(3) instanceDistance:vec2<f32>)->LineOut{
 let a=projectSegmentPosition(instanceStart,instanceEnd);let b=projectSegmentPosition(instanceEnd,instanceStart);let delta=projectDifference(instanceEnd,instanceStart);let len=length(delta);
 var dir=vec2<f32>(1.0,0.0);if(len>1e-8){dir=delta/len;}
 var extent=emap.parameters.x*0.5+1.0/emap.pixelRatio;if(emap.parameters.w>0.5){extent+=emap.arrow.y*0.45;}
 let local=vec2<f32>(mix(-extent,len+extent,(corners.x+1.0)*0.5),corners.y*extent);
 let anchor=select(a,b,corners.x>0.0);let cap=select(-extent,extent,corners.x>0.0);
 return LineOut(clipPosition(anchor+dir*cap+vec2<f32>(-dir.y,dir.x)*local.y),local,len,(instanceDistance.x+instanceDistance.y)*abs(emap.scale.x));
}
@fragment fn fragmentMain(p:LineOut)->@location(0) vec4<f32>{
 let halfWidth=emap.parameters.x*0.5;let longitudinal=max(max(-p.local.x,p.local.x-p.len),0.0);
 var d=length(vec2<f32>(longitudinal,p.local.y))-halfWidth;
 if(emap.parameters.w>0.5){
  let spacing=emap.arrow.x;let size=emap.arrow.y;let position=p.start+p.local.x;let phase=position-floor(position/spacing)*spacing;
  let dashLength=min(spacing*0.55,max(spacing*0.35,size*1.5));let dashGap=min(max(phase-dashLength,0.0),spacing-phase);
  let dashDistance=length(vec2<f32>(dashGap,p.local.y))-halfWidth;
  let tip=vec2<f32>(spacing*0.78,0.0);let ah=size*0.45;let back=sqrt(size*size-ah*ah);let q=vec2<f32>(phase,p.local.y);
  let ad=min(segmentDistance(q,tip,tip+vec2<f32>(-back,ah)),segmentDistance(q,tip,tip+vec2<f32>(-back,-ah)))-halfWidth;
  d=max(min(dashDistance,ad),longitudinal-halfWidth);
 }else if(emap.parameters.z>0.5 && emap.parameters.y>0.0){
  let period=emap.parameters.y;let t=p.start+p.local.x;let phase=t-floor(t/period)*period;var prev=0.0;var gap=period;
  for(var i=0;i<i32(emap.parameters.z);i++){
   let boundary=textureLoad(dashTexture,vec2<i32>(i,0),0).r;
   if(i%2==0){gap=min(gap,max(max(prev-phase,phase-boundary),0.0));gap=min(gap,max(max(prev-phase-period,phase+period-boundary),0.0));gap=min(gap,max(max(prev-phase+period,phase-period-boundary),0.0));}prev=boundary;
  }
  d=max(d,length(vec2<f32>(gap,p.local.y))-halfWidth);
 }
 let aa=max(fwidth(d),0.5/emap.pixelRatio);let coverage=1.0-smoothstep(-aa*0.5,aa*0.5,d);
 if(coverage<=0.0){discard;}return premultiply(coverage);
}
`;
const pathWGSL =
  lineCommonWGSL +
  `
fn joinOffset(a:vec2<f32>,b:vec2<f32>,side:f32,width:f32)->vec2<f32>{
 let la=length(a);let lb=length(b);var da=vec2<f32>(1.0,0.0);if(la>0.0){da=a/la;}
 var db=da;if(lb>0.0){db=b/lb;}var tangent=da+db;
 if(length(tangent)>1e-5){tangent=normalize(tangent);}else{tangent=da;}
 let normal=vec2<f32>(-tangent.y,tangent.x);let n=vec2<f32>(-db.y,db.x);
 var size=min(1.0/max(abs(dot(normal,n)),0.001),4.0);
 if(side*(da.x*db.y-da.y*db.x)>0.0){size=min(size,max(la,lb)/max(width,1e-8));}
 return normal*(side*width*size);
}
@vertex fn vertexMain(@location(0) corners:vec2<f32>,@location(1) previousPosition:vec4<f32>,@location(2) startPosition:vec4<f32>,@location(3) endPosition:vec4<f32>,@location(4) nextPosition:vec4<f32>,@location(5) pathDistance:vec2<f32>,@location(6) pathFlags:f32)->LineOut{
 let a=projectPosition(previousPosition);let b=projectSegmentPosition(startPosition,endPosition);let c=projectSegmentPosition(endPosition,startPosition);let d=projectPosition(nextPosition);
 let delta=projectDifference(endPosition,startPosition);let len=length(delta);var dir=vec2<f32>(1.0,0.0);if(len>0.0){dir=delta/len;}
 let w=emap.parameters.x*0.5+0.5/emap.pixelRatio;let end=corners.x>0.0;let flags=u32(pathFlags);
 let cap=select((flags&1u)!=0u,(flags&2u)!=0u,end);
 var offset=joinOffset(select(projectDifference(startPosition,previousPosition),delta,end),select(delta,projectDifference(nextPosition,endPosition),end),corners.y,w);let extra=select(0.0,w,cap);
 if(cap){offset=vec2<f32>(-dir.y,dir.x)*corners.y*w+dir*extra*select(-1.0,1.0,end);}
 var pos=clipPosition(select(b,c,end)+offset);if(flags>=4u || len==0.0){pos=vec4<f32>(2.0,2.0,0.0,1.0);}
 return LineOut(pos,vec2<f32>(corners.y*w,select(-extra,len+extra,end)),len,(pathDistance.x+pathDistance.y)*abs(emap.scale.x));
}
@fragment fn fragmentMain(p:LineOut)->@location(0) vec4<f32>{
 let outside=max(max(-p.local.y,p.local.y-p.len),0.0);let d=length(vec2<f32>(p.local.x,outside))-emap.parameters.x*0.5;
 let aa=max(fwidth(d),0.5/emap.pixelRatio);let coverage=1.0-smoothstep(-aa*0.5,aa*0.5,d);
 if(emap.parameters.z>0.0 && emap.parameters.y>0.0){
  let t=p.start+p.local.y;let phase=t-floor(t/emap.parameters.y)*emap.parameters.y;var prev=0.0;var on=false;
  for(var i=0;i<i32(emap.parameters.z);i++){let edge=textureLoad(dashTexture,vec2<i32>(i,0),0).r;if(i%2==0 && phase>=prev && phase<=edge){on=true;}prev=edge;}
  if(!on){discard;}
 }
 if(coverage<=0.0){discard;}return premultiply(coverage);
}
`;
const imageWGSL = `
@group(0) @binding(1) var imageTexture:texture_2d<f32>;
@group(0) @binding(2) var imageSampler:sampler;
struct ImageOut{@builtin(position) position:vec4<f32>,@location(0) uv:vec2<f32>};
@vertex fn vertexMain(@location(0) corners:vec2<f32>)->ImageOut{
 let local=(corners+vec2<f32>(1.0))*0.5;let pixels=mix(emap.rect.xy,emap.rect.zw,local);
 return ImageOut(groundClipPosition(pixels-emap.viewport*0.5),mix(emap.uvRect.xy,emap.uvRect.zw,local));
}
@fragment fn fragmentMain(p:ImageOut)->@location(0) vec4<f32>{let c=textureSample(imageTexture,imageSampler,p.uv);let a=c.a*emap.parameters.x;return vec4<f32>(c.rgb*a,a);}
`;
const glsl = {
  'path-msaa': [pathMsaaVS, pathMsaaFS],
  'path-msaa-reference': [pathMsaaVS, pathMsaaFS],
  'circle-core': [circleCoreVS, circleCoreFS],
  'circle-edge': [circleVS, circleFS],
  'point-depth-reset': [pointDepthResetVS, pointDepthResetFS],
  circle: [circleVS, circleFS],
  fill: [fillVS, fillFS],
  point: [pointVS, pointFS],
  line: [lineVS, lineFS],
  path: [pathVS, pathFS],
  image: [imageVS, imageFS],
};
const wgsl = {
  'path-msaa': pathMsaaWGSL,
  'path-msaa-reference': pathMsaaWGSL,
  'circle-core': circleCoreWGSL,
  'circle-edge': circleWGSL,
  'point-depth-reset': pointDepthResetWGSL,
  circle: circleWGSL,
  fill: fillWGSL,
  point: pointWGSL,
  line: lineWGSL,
  path: pathWGSL,
  image: imageWGSL,
};
export function shaderSource(kind: PipelineKind) {
  const [vs, fs] = glsl[kind];
  const prefix = '#version 300 es\nprecision highp float;\n';
  return {
    source: uniformWGSL + wgsl[kind],
    vs: prefix + emapModule.vs + vs.replace('#version 300 es', ''),
    fs: prefix + emapModule.fs + fs.replace('#version 300 es', ''),
  };
}
export function shaderLayouts(
  kind: PipelineKind,
  webgpu: boolean,
): { shaderLayout: ShaderLayout; bufferLayout: BufferLayout[] } {
  const shaderLayout: ShaderLayout = {
    attributes: [],
    bindings: [
      { name: 'emapUniforms', type: 'uniform', group: 0, location: 0, minBindingSize: 240 },
    ],
  };
  const bufferLayout: BufferLayout[] = [];
  const attribute = (
    name: string,
    location: number,
    type: 'vec2<f32>' | 'vec4<f32>' | 'f32',
    stepMode: 'vertex' | 'instance',
  ) => shaderLayout.attributes.push({ name, location, type, stepMode });
  if (kind === 'fill') {
    attribute('positions', 0, 'vec4<f32>', 'vertex');
    bufferLayout.push({ name: 'positions', format: 'float32x4', stepMode: 'vertex' });
  } else {
    attribute('corners', 0, 'vec2<f32>', 'vertex');
    bufferLayout.push({ name: 'corners', format: 'float32x2', stepMode: 'vertex' });
    if (kind === 'point' || kind === 'circle' || kind === 'circle-core' || kind === 'circle-edge') {
      attribute('instancePositions', 1, 'vec4<f32>', 'instance');
      bufferLayout.push({ name: 'instancePositions', format: 'float32x4', stepMode: 'instance' });
    } else if (kind === 'line') {
      attribute('instanceStart', 1, 'vec4<f32>', 'instance');
      attribute('instanceEnd', 2, 'vec4<f32>', 'instance');
      attribute('instanceDistance', 3, 'vec2<f32>', 'instance');
      bufferLayout.push({
        name: 'segments',
        stepMode: 'instance',
        byteStride: 40,
        attributes: [
          { attribute: 'instanceStart', format: 'float32x4', byteOffset: 0 },
          { attribute: 'instanceEnd', format: 'float32x4', byteOffset: 16 },
          { attribute: 'instanceDistance', format: 'float32x2', byteOffset: 32 },
        ],
      });
    } else if (kind === 'path' || kind === 'path-msaa' || kind === 'path-msaa-reference') {
      ['previousPosition', 'startPosition', 'endPosition', 'nextPosition'].forEach((name, i) =>
        attribute(name, i + 1, 'vec4<f32>', 'instance'),
      );
      attribute('pathDistance', 5, 'vec2<f32>', 'instance');
      attribute('pathFlags', 6, 'f32', 'instance');
      bufferLayout.push({
        name: 'path',
        stepMode: 'instance',
        byteStride: 28,
        attributes: [
          ...['previousPosition', 'startPosition', 'endPosition', 'nextPosition'].map(
            (name, i) => ({ attribute: name, format: 'float32x4' as const, byteOffset: i * 28 }),
          ),
          { attribute: 'pathDistance', format: 'float32x2', byteOffset: 44 },
          { attribute: 'pathFlags', format: 'float32', byteOffset: 52 },
        ],
      });
    }
  }
  if (kind === 'line' || kind === 'path')
    shaderLayout.bindings.push({
      name: 'dashTexture',
      type: 'texture',
      group: 0,
      location: 1,
      sampleType: 'unfilterable-float',
    });
  if (kind === 'image') {
    shaderLayout.bindings.push({ name: 'imageTexture', type: 'texture', group: 0, location: 1 });
    if (webgpu)
      shaderLayout.bindings.push({ name: 'imageSampler', type: 'sampler', group: 0, location: 2 });
  }
  return { shaderLayout, bufferLayout };
}
