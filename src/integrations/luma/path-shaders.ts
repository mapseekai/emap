// Adapted from deck.gl PathLayer's six-vertex segment/join envelope.
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors. emap's 2D high/low projection is retained.
// Reference: geoarrow/deck.gl-geoarrow -> @deck.gl/layers 9.3 PathLayer.
export const PATH_CORNERS = [0, 0, 0, -1, 0, 1, 1, -1, 1, 1, 1, 0];
export const PATH_INDICES = [0, 1, 2, 1, 4, 2, 1, 3, 4, 3, 5, 4];

export const pathMsaaVS = `#version 300 es
in vec2 corners;
in vec4 previousPosition;
in vec4 startPosition;
in vec4 endPosition;
in vec4 nextPosition;
in vec2 pathDistance;
in float pathFlags;
out vec2 cornerOffset;
out vec2 pathPosition;
out float pathLength;
flat out float capsuleMode;
flat out vec4 capsuleSegment;
void main() {
 bool end = corners.x > 0.0;
 float side = corners.y, joint = float(side == 0.0);
 float width = max(emap.parameters.x * 0.5, 1e-12);
 if (pathFlags >= 4.0) { gl_Position=vec4(2.0,2.0,0.0,1.0); cornerOffset=vec2(0.0); pathPosition=vec2(0.0); pathLength=0.0; capsuleMode=0.0; capsuleSegment=vec4(0.0); return; }
 vec4 prev = end ? startPosition : previousPosition;
 vec4 curr = end ? endPosition : startPosition;
 vec4 next = end ? nextPosition : endPosition;
 // Subtract hi/lo coordinates before projection; translation cancels exactly.
 vec2 da = projectDifference(curr, prev)/width;
 vec2 db = projectDifference(next, curr)/width;
 float la = length(da), lb = length(db);
 vec2 ua = la > 0.0 ? da / la : vec2(0.0);
 vec2 ub = lb > 0.0 ? db / lb : vec2(0.0);
 vec2 pa = vec2(-ua.y, ua.x), pb = vec2(-ub.y, ub.x);
 vec2 tangent = ua + ub;
 tangent = length(tangent) > 0.0 ? normalize(tangent) : pa;
 vec2 miter = vec2(-tangent.y, tangent.x);
 vec2 dir = end ? ua : ub, normal = end ? pa : pb;
 float sinHalf = abs(dot(miter, normal)), cosHalf = abs(dot(ua, miter));
 float turn = ua.x * ub.y >= ua.y * ub.x ? -1.0 : 1.0;
 float corner = side * turn;
 float size = 1.0 / max(sinHalf, 0.001);
 if (corner < 0.0) size = min(size, max(la, lb) / max(cosHalf, 0.001));
 vec2 offset = (corner > 0.5 ? normal : miter * size) * (side + joint * turn);
 int flags = int(pathFlags);
 bool startCap = la == 0.0 || (!end && ((flags & 1) != 0));
 bool endCap = lb == 0.0 || (end && ((flags & 2) != 0));
 if (startCap || endCap) offset = joint > 0.5 ? dir * 4.0 * (startCap ? -1.0 : 1.0) : normal * side;
 bool capsule = (end ? la : lb) > 0.0 &&
   (((flags & 1) == 0 && all(equal(previousPosition, endPosition))) ||
    ((flags & 2) == 0 && all(equal(startPosition, nextPosition))));
 if (capsule) offset = normal * side + dir * (end ? 4.0 : -4.0);
 capsuleMode = float(capsule);
 capsuleSegment = vec4(0.0);
 if (capsule) {
   vec2 a=projectSegmentPosition(startPosition,endPosition), b=projectSegmentPosition(endPosition,startPosition);
   vec2 delta=projectDifference(endPosition,startPosition);
   bool nearStart=dot(a,a)<=dot(b,b);
   capsuleSegment=vec4(nearStart?a:b,nearStart?delta:-delta);
 }
 cornerOffset = offset;
 vec2 fromStart = offset + (end ? da : vec2(0.0));
 pathPosition = vec2(dot(fromStart, normal), dot(fromStart, dir));
 pathLength = end ? la : lb;
 gl_Position = clipPosition(projectSegmentPosition(curr, end ? prev : next) + offset * width);
}`;
export const pathMsaaFS = `#version 300 es
precision highp float;
in vec2 cornerOffset;
in vec2 pathPosition;
in float pathLength;
flat in float capsuleMode;
flat in vec4 capsuleSegment;
out vec4 fragColor;
bool capsuleOutside() {
 // MSAA smooth inputs may be evaluated at a sample instead of the pixel center.
 // Keep binary cap rejection deterministic; the envelope still supplies body MSAA.
 vec2 center=(floor(gl_FragCoord.xy)+vec2(0.5))/emap.framebufferSize;
 vec2 p=(center*vec2(1.0,-1.0)-vec2(0.5,-0.5))*emap.viewport-capsuleSegment.xy;
 float radius=max(emap.parameters.x*0.5,1e-12);
 float span=max(abs(capsuleSegment.z),abs(capsuleSegment.w));
 if(span==0.0) return dot(p,p)>radius*radius;
 vec2 scaled=capsuleSegment.zw/span;
 float unitLength=length(scaled), len=span*unitLength;
 vec2 dir=scaled/unitLength;
 float along=dot(p,dir);
 if(along>=0.0 && along<=len) return false;
 vec2 q=vec2(dot(p,vec2(-dir.y,dir.x)),along-clamp(along,0.0,len));
 return dot(q,q)>radius*radius;
}
void main() {
 // The envelope alone supplies body-edge MSAA coverage; reject only beyond endpoints.
 bool outside = capsuleMode > 0.5 ? capsuleOutside() :
   (pathPosition.y < 0.0 || pathPosition.y > pathLength) && dot(cornerOffset, cornerOffset) > 1.0;
 if (outside) discard;
 fragColor = vec4(emap.color.rgb * emap.color.a, emap.color.a);
}`;

export const capsuleClipWGSL = `
fn capsuleOutside(segment:vec4<f32>,fragment:vec2<f32>)->bool {
 let center=(floor(fragment)+vec2<f32>(0.5))/emap.framebufferSize;
 let p=(center-vec2<f32>(0.5))*emap.viewport-segment.xy;
 let radius=max(emap.parameters.x*0.5,1e-12);
 let span=max(abs(segment.z),abs(segment.w));
 if(span==0.0){return dot(p,p)>radius*radius;}
 let scaled=segment.zw/span;let unitLength=length(scaled);
 let len=span*unitLength;let dir=scaled/unitLength;
 let along=dot(p,dir);
 if(along>=0.0 && along<=len){return false;}
 let q=vec2<f32>(dot(p,vec2<f32>(-dir.y,dir.x)),along-clamp(along,0.0,len));
 return dot(q,q)>radius*radius;
}
`;

export const pathMsaaWGSL = `
struct PathOut {
 @builtin(position) position: vec4<f32>,
 @location(0) corner: vec2<f32>, @location(1) local: vec2<f32>, @location(2) len: f32,
 @location(3) @interpolate(flat) capsule: f32,
 @location(4) @interpolate(flat) capsuleSegment: vec4<f32>,
};
@vertex fn vertexMain(@location(0) corners:vec2<f32>,
 @location(1) previousPosition:vec4<f32>, @location(2) startPosition:vec4<f32>,
 @location(3) endPosition:vec4<f32>, @location(4) nextPosition:vec4<f32>,
 @location(5) pathDistance:vec2<f32>, @location(6) pathFlags:f32)->PathOut {
 let end = corners.x > 0.0; let side = corners.y; let joint = select(0.0,1.0,side==0.0);
 let width = max(emap.parameters.x * 0.5, 1e-12);
  if(pathFlags>=4.0){return PathOut(vec4<f32>(2.0,2.0,0.0,1.0),vec2<f32>(0.0),vec2<f32>(0.0),0.0,0.0,vec4<f32>(0.0));}
 let prev=select(previousPosition,startPosition,end);
 let curr=select(startPosition,endPosition,end);
 let next=select(endPosition,nextPosition,end);
 let da=projectDifference(curr, prev)/width;
 let db=projectDifference(next, curr)/width;
 let la = length(da); let lb = length(db);
 var ua = vec2<f32>(0.0); var ub = vec2<f32>(0.0);
 if (la>0.0) { ua=da/la; } if (lb>0.0) { ub=db/lb; }
 let pa = vec2<f32>(-ua.y,ua.x); let pb = vec2<f32>(-ub.y,ub.x);
 var tangent=ua+ub; if(length(tangent)>0.0){tangent=normalize(tangent);}else{tangent=pa;}
 let miter=vec2<f32>(-tangent.y,tangent.x);
 let dir=select(ub,ua,end); let normal=select(pb,pa,end);
 let sinHalf=abs(dot(miter,normal)); let cosHalf=abs(dot(ua,miter));
 let turn=select(1.0,-1.0,ua.x*ub.y>=ua.y*ub.x); let corner=side*turn;
 var size=1.0/max(sinHalf,0.001);
 if(corner<0.0){size=min(size,max(la,lb)/max(cosHalf,0.001));}
 var offset=select(miter*size,normal,corner>0.5)*(side+joint*turn);
 let flags=u32(pathFlags);
 let startCap=la==0.0 || (!end && ((flags&1u)!=0u));
 let endCap=lb==0.0 || (end && ((flags&2u)!=0u));
 if(startCap||endCap){offset=select(normal*side,dir*4.0*select(1.0,-1.0,startCap),joint>0.5);}
 let capsule=select(lb,la,end)>0.0 &&
   (((flags&1u)==0u && all(previousPosition==endPosition)) ||
    ((flags&2u)==0u && all(startPosition==nextPosition)));
 if(capsule){offset=normal*side+dir*select(-4.0,4.0,end);}
 var capsuleSegment=vec4<f32>(0.0);
 if(capsule){
  let a=projectSegmentPosition(startPosition,endPosition);let b=projectSegmentPosition(endPosition,startPosition);
  let delta=projectDifference(endPosition,startPosition);let nearStart=dot(a,a)<=dot(b,b);
  capsuleSegment=vec4<f32>(select(b,a,nearStart),select(-delta,delta,nearStart));
 }
 let fromStart=offset+select(vec2<f32>(0.0),da,end);
 let local=vec2<f32>(dot(fromStart,normal),dot(fromStart,dir));
 let position=clipPosition(projectSegmentPosition(curr,select(next,prev,end))+offset*width);
 return PathOut(position,offset,local,select(lb,la,end),select(0.0,1.0,capsule),capsuleSegment);
}
${capsuleClipWGSL}
// Reject the same fragments through coverage, without WGSL discard's helper
// invocation cost on dense overlapping strokes. The rasterizer's MSAA coverage
// is ANDed with this mask; a rejected fragment writes neither color nor depth.
struct PathCoverage {
 @location(0) color:vec4<f32>, @builtin(sample_mask) mask:u32,
};
@fragment fn fragmentMain(p:PathOut)->PathCoverage {
  var outside=(p.local.y<0.0||p.local.y>p.len)&&dot(p.corner,p.corner)>1.0;
  if(p.capsule>0.5){outside=capsuleOutside(p.capsuleSegment,p.position.xy);}
 return PathCoverage(premultiply(1.0),select(0xffffffffu,0u,outside));
}
`;

// Solid paths share the reference join/projection math, but never read dash distances.
export const solidPathVS = pathMsaaVS.replace('in vec2 pathDistance;\n', '');
export const solidPathWGSL = pathMsaaWGSL.replace('@location(5) pathDistance:vec2<f32>, ', '');
function exactXYPath(source: string, wgsl: boolean): string {
  const names = ['previousPosition', 'startPosition', 'endPosition', 'nextPosition'];
  let declarations = '';
  for (const [i, name] of names.entries()) {
    source = source.replace(
      wgsl ? `@location(${i + 1}) ${name}:vec4<f32>` : `in vec4 ${name};`,
      wgsl ? `@location(${i + 1}) ${name}XY:vec2<f32>` : `in vec2 ${name}XY;`,
    );
    declarations += wgsl
      ? `let ${name}=vec4<f32>(${name}XY,vec2<f32>(0.0));\n`
      : `vec4 ${name}=vec4(${name}XY,0.0,0.0);\n`;
  }
  const entry = wgsl ? '->PathOut {' : 'void main() {';
  return source.replace(entry, entry + '\n' + declarations);
}
export const solidPathXYVS = exactXYPath(solidPathVS, false);
export const solidPathXYWGSL = exactXYPath(solidPathWGSL, true);
