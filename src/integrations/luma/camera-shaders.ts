/** Same ground-plane camera as PerspectiveTransform; input is centered CSS pixels.
 * Keep the identity high/low subtraction path for the existing deep-zoom renderer. */
export const cameraGLSL = `
vec2 rawDifference(vec4 a, vec4 b) {
  return (a.xy-b.xy)*emap.scale + (a.zw-b.zw)*emap.lowScale;
}
bool cameraActive() { return emap.camera.y!=0.0 || emap.camera.x!=1.0 || emap.camera.z!=1.0; }
vec4 groundClipPosition(vec2 p) {
  vec2 r=vec2(emap.camera.x*p.x+emap.camera.y*p.y,-emap.camera.y*p.x+emap.camera.x*p.y);
  return vec4(vec2(r.x,r.y*emap.camera.z)*vec2(2.0,-2.0)/emap.viewport,0.0,1.0-emap.camera.w*r.y);
}
vec2 cameraPixels(vec2 p) {
  vec4 c=groundClipPosition(p);
  return c.xy/max(c.w,0.001)*emap.viewport*vec2(0.5,-0.5);
}
// Clip each segment before perspective division, including camera-plane crossings.
vec2 projectSegmentPosition(vec4 a,vec4 b) {
  vec2 p=rawDifference(a,emap.origin);
  if(!cameraActive()) return p;
  vec4 ca=groundClipPosition(p),cb=groundClipPosition(rawDifference(b,emap.origin));
  if(ca.w<0.001 && cb.w<0.001) return vec2(1e10);
  if(ca.w<0.001) ca=mix(ca,cb,(0.001-ca.w)/(cb.w-ca.w));
  return ca.xy/max(ca.w,0.001)*emap.viewport*vec2(0.5,-0.5);
}
vec2 projectDifference(vec4 a,vec4 b) {
  if(!cameraActive()) return rawDifference(a,b);
  return projectSegmentPosition(a,b)-projectSegmentPosition(b,a);
}
vec2 projectPosition(vec4 p) {
  vec2 pixels=rawDifference(p,emap.origin);
  return cameraActive()?cameraPixels(pixels):pixels;
}
vec4 clipPosition(vec2 pixels) { return vec4(pixels*vec2(2.0,-2.0)/emap.viewport,0.0,1.0); }
vec4 billboardPosition(vec4 p,vec2 offset) {
  if(groundClipPosition(rawDifference(p,emap.origin)).w<=0.0) return vec4(2.0,2.0,0.0,1.0);
  return clipPosition(projectPosition(p)+offset);
}
`;
export const cameraWGSL = `
fn rawDifference(a:vec4<f32>,b:vec4<f32>)->vec2<f32>{return (a.xy-b.xy)*emap.scale+(a.zw-b.zw)*emap.lowScale;}
fn cameraActive()->bool{return emap.camera.y!=0.0 || emap.camera.x!=1.0 || emap.camera.z!=1.0;}
fn groundClipPosition(p:vec2<f32>)->vec4<f32>{
 let r=vec2<f32>(emap.camera.x*p.x+emap.camera.y*p.y,-emap.camera.y*p.x+emap.camera.x*p.y);
 return vec4<f32>(vec2<f32>(r.x,r.y*emap.camera.z)*vec2<f32>(2.0,-2.0)/emap.viewport,0.0,1.0-emap.camera.w*r.y);
}
fn cameraPixels(p:vec2<f32>)->vec2<f32>{let c=groundClipPosition(p);return c.xy/max(c.w,0.001)*emap.viewport*vec2<f32>(0.5,-0.5);}
fn projectSegmentPosition(a:vec4<f32>,b:vec4<f32>)->vec2<f32>{
 let p=rawDifference(a,emap.origin);if(!cameraActive()){return p;}
 var ca=groundClipPosition(p);let cb=groundClipPosition(rawDifference(b,emap.origin));
 if(ca.w<0.001 && cb.w<0.001){return vec2<f32>(1e10);}
 if(ca.w<0.001){ca=mix(ca,cb,(0.001-ca.w)/(cb.w-ca.w));}
 return ca.xy/max(ca.w,0.001)*emap.viewport*vec2<f32>(0.5,-0.5);
}
fn projectDifference(a:vec4<f32>,b:vec4<f32>)->vec2<f32>{
 if(!cameraActive()){return rawDifference(a,b);}
 return projectSegmentPosition(a,b)-projectSegmentPosition(b,a);
}
fn projectPosition(p:vec4<f32>)->vec2<f32>{let pixels=rawDifference(p,emap.origin);if(!cameraActive()){return pixels;}return cameraPixels(pixels);}
fn clipPosition(p:vec2<f32>)->vec4<f32>{return vec4<f32>(p*vec2<f32>(2.0,-2.0)/emap.viewport,0.0,1.0);}
fn billboardPosition(p:vec4<f32>,offset:vec2<f32>)->vec4<f32>{
 if(groundClipPosition(rawDifference(p,emap.origin)).w<=0.0){return vec4<f32>(2.0,2.0,0.0,1.0);}
 return clipPosition(projectPosition(p)+offset);
}
`;
