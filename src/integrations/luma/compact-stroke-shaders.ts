// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors. Adapted from the envelope in path-shaders.ts.
// The same MSAA segment/join envelope as path-shaders.ts, with immutable affine
// joins computed once in the geometry Worker. Padding instances are not submitted.
export const compactStrokeVS = `#version 300 es
in vec2 corners;
in vec4 startPosition;
in vec4 endPosition;
in vec4 startJoin;
in vec4 endJoin;
out vec2 cornerOffset;
out vec2 pathPosition;
out float pathLength;
void main() {
 bool end = corners.x > 0.0;
 float side = corners.y, joint = float(side == 0.0);
 float width = max(emap.parameters.x * 0.5, 1e-12);
 vec2 delta = projectDifference(endPosition, startPosition) / width;
 float len = length(delta);
 vec2 dir = len > 0.0 ? delta / len : vec2(0.0);
 vec2 normal = vec2(-dir.y, dir.x);
 vec4 join = end ? endJoin : startJoin;
 vec2 offset;
 if(join.w == 0.0) {
   offset = joint > 0.5 ? dir * 4.0 * (end ? 1.0 : -1.0) : normal * side;
 } else {
   float corner = side * join.w;
   float limit = corner < 0.0 ? min(1.0, join.z * abs(emap.scale.x) / width) : 1.0;
   offset = (corner > 0.5 ? normal : join.xy * limit) * (side + joint * join.w);
 }
 cornerOffset = offset;
 vec2 fromStart = offset + (end ? delta : vec2(0.0));
 pathPosition = vec2(dot(fromStart, normal), dot(fromStart, dir));
 pathLength = len;
 vec4 curr = end ? endPosition : startPosition;
 vec4 other = end ? startPosition : endPosition;
 gl_Position = clipPosition(projectSegmentPosition(curr, other) + offset * width);
}
`;
export const compactStrokeWGSL = `
struct CompactOut {
 @builtin(position) position:vec4<f32>,
 @location(0) corner:vec2<f32>, @location(1) local:vec2<f32>, @location(2) len:f32,
};
@vertex fn vertexMain(@location(0) corners:vec2<f32>, @location(1) startPosition:vec4<f32>,
 @location(2) endPosition:vec4<f32>, @location(3) startJoin:vec4<f32>, @location(4) endJoin:vec4<f32>)->CompactOut {
 let end=corners.x>0.0; let side=corners.y; let joint=select(0.0,1.0,side==0.0);
 let width=max(emap.parameters.x*0.5,1e-12);
 let delta=projectDifference(endPosition,startPosition)/width;let len=length(delta);
 var dir=vec2<f32>(0.0);if(len>0.0){dir=delta/len;}
 let normal=vec2<f32>(-dir.y,dir.x);let join=select(startJoin,endJoin,end);
 var offset:vec2<f32>;
 if(join.w==0.0){offset=select(normal*side,dir*4.0*select(-1.0,1.0,end),joint>0.5);}
 else {
   let corner=side*join.w;var limit=1.0;
   if(corner<0.0){limit=min(1.0,join.z*abs(emap.scale.x)/width);}
   offset=select(join.xy*limit,normal,corner>0.5)*(side+joint*join.w);
 }
 let fromStart=offset+select(vec2<f32>(0.0),delta,end);
 let local=vec2<f32>(dot(fromStart,normal),dot(fromStart,dir));
 let curr=select(startPosition,endPosition,end);let other=select(endPosition,startPosition,end);
 return CompactOut(clipPosition(projectSegmentPosition(curr,other)+offset*width),offset,local,len);
}
@fragment fn fragmentMain(p:CompactOut)->@location(0) vec4<f32> {
 if((p.local.y<0.0 || p.local.y>p.len) && dot(p.corner,p.corner)>1.0){discard;}
 return vec4<f32>(emap.color.rgb*emap.color.a,emap.color.a);
}
`;

// Preserve the exact original arithmetic by reconstructing only known-zero low
// components. Selection of this ABI is lossless and made in the Worker.
export const compactStrokeXYVS = compactStrokeVS
  .replace('in vec4 startPosition;', 'in vec2 startXY;')
  .replace('in vec4 endPosition;', 'in vec2 endXY;')
  .replace(
    'void main() {',
    'void main() {\n vec4 startPosition=vec4(startXY,0.0,0.0);\n vec4 endPosition=vec4(endXY,0.0,0.0);',
  );
export const compactStrokeXYWGSL = compactStrokeWGSL
  .replace('@location(1) startPosition:vec4<f32>', '@location(1) startXY:vec2<f32>')
  .replace('@location(2) endPosition:vec4<f32>', '@location(2) endXY:vec2<f32>')
  .replace(
    '->CompactOut {',
    '->CompactOut {\n let startPosition=vec4<f32>(startXY,0.0,0.0);\n let endPosition=vec4<f32>(endXY,0.0,0.0);',
  );
