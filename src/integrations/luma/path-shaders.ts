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
void main() {
 bool end = corners.x > 0.0;
 float side = corners.y, joint = float(side == 0.0);
 float width = max(emap.parameters.x * 0.5, 1e-12);
 if (pathFlags >= 4.0) { gl_Position=vec4(2.0,2.0,0.0,1.0); cornerOffset=vec2(0.0); pathPosition=vec2(0.0); pathLength=0.0; return; }
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
 cornerOffset = offset;
 vec2 fromStart = offset + (end ? da : vec2(0.0));
 pathPosition = vec2(dot(fromStart, normal), dot(fromStart, dir));
 pathLength = end ? la : lb;
 gl_Position = clipPosition(projectPosition(curr) + offset * width);
}`;
export const pathMsaaFS = `#version 300 es
precision highp float;
in vec2 cornerOffset;
in vec2 pathPosition;
in float pathLength;
out vec4 fragColor;
void main() {
 if ((pathPosition.y < 0.0 || pathPosition.y > pathLength) && dot(cornerOffset, cornerOffset) > 1.0) discard;
 fragColor = vec4(emap.color.rgb * emap.color.a, emap.color.a);
}`;

export const pathMsaaWGSL = `
struct PathOut {
 @builtin(position) position: vec4<f32>,
 @location(0) corner: vec2<f32>, @location(1) local: vec2<f32>, @location(2) len: f32,
};
@vertex fn vertexMain(@location(0) corners:vec2<f32>,
 @location(1) previousPosition:vec4<f32>, @location(2) startPosition:vec4<f32>,
 @location(3) endPosition:vec4<f32>, @location(4) nextPosition:vec4<f32>,
 @location(5) pathDistance:vec2<f32>, @location(6) pathFlags:f32)->PathOut {
 let end = corners.x > 0.0; let side = corners.y; let joint = select(0.0,1.0,side==0.0);
 let width = max(emap.parameters.x * 0.5, 1e-12);
 if(pathFlags>=4.0){return PathOut(vec4<f32>(2.0,2.0,0.0,1.0),vec2<f32>(0.0),vec2<f32>(0.0),0.0);}
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
 let fromStart=offset+select(vec2<f32>(0.0),da,end);
 let local=vec2<f32>(dot(fromStart,normal),dot(fromStart,dir));
 let position=clipPosition(projectPosition(curr)+offset*width);
 return PathOut(position,offset,local,select(lb,la,end));
}
@fragment fn fragmentMain(p:PathOut)->@location(0) vec4<f32> {
 if((p.local.y<0.0||p.local.y>p.len)&&dot(p.corner,p.corner)>1.0){discard;}
 return premultiply(1.0);
}
`;
