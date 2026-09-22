/** Integer textures keep UInt8/UInt16 source values exact. Bilinear interpolation
 * excludes NoData taps and normalizes the remaining weights, matching Canvas. */
const glslUniforms = `layout(std140) uniform rasterUniforms {
 vec4 rect; vec4 coords; vec4 size; vec4 low; vec4 high; vec4 bands; vec4 options; vec4 frame; vec4 camera; vec4 screenRect;
} raster;`;
export const rasterVS = `#version 300 es
precision highp float;
layout(location=0) in vec2 corners;
${glslUniforms}
void main(){vec2 xy=mix(raster.screenRect.xy,raster.screenRect.zw,corners);
 gl_Position=vec4(xy/raster.size.xy*vec2(2.0,-2.0)+vec2(-1.0,1.0),0.0,1.0);}`;
export const rasterFS = `#version 300 es
precision highp float;
precision highp usampler2D;
${glslUniforms}
uniform usampler2D dataTexture;
out vec4 fragColor;
vec4 sampleAt(ivec2 p){return vec4(texelFetch(dataTexture,clamp(p,ivec2(0),ivec2(raster.size.zw)-1),0));}
vec3 rgb(vec4 v){return vec3(v[int(raster.bands.x)],v[int(raster.bands.y)],v[int(raster.bands.z)]);}
bool valid(vec3 v){return raster.options.y<0.0 || all(notEqual(v,vec3(raster.options.y)));}
float stretch(float v,float lo,float hi){if(lo==hi)return 128.0/255.0;return floor(clamp((v-lo)/(hi-lo),0.0,1.0)*255.0+0.5)/255.0;}
void main(){
 vec2 css=vec2(gl_FragCoord.x,raster.frame.y-gl_FragCoord.y)*raster.frame.zw;
 if(raster.camera.x!=1.0 || raster.camera.y!=0.0 || raster.camera.z!=1.0){
  vec2 screen=css-raster.size.xy*0.5;
  float denominator=raster.camera.z+screen.y*raster.camera.w;
  if(denominator<=0.0)discard;
  float ry=screen.y/denominator,rx=screen.x*(1.0-raster.camera.w*ry);
  css=vec2(raster.camera.x*rx-raster.camera.y*ry,raster.camera.y*rx+raster.camera.x*ry)+raster.size.xy*0.5;
  if(any(lessThan(css,raster.rect.xy)) || any(greaterThanEqual(css,raster.rect.zw)))discard;
 }
 vec2 pixel=mix(raster.coords.xy,raster.coords.zw,(css-raster.rect.xy)/(raster.rect.zw-raster.rect.xy));
 vec4 nearest=sampleAt(ivec2(floor(pixel)));vec3 value=rgb(nearest);
 if(raster.options.x<0.5){if(!valid(value))discard;}
 else {vec2 f=pixel-0.5;ivec2 p=ivec2(floor(f));vec2 uv=fract(f);vec3 sum=vec3(0.0);float weight=0.0;
  for(int j=0;j<4;j++){int x=j&1,y=j>>1;vec3 v=rgb(sampleAt(p+ivec2(x,y)));float w=(x==0?1.0-uv.x:uv.x)*(y==0?1.0-uv.y:uv.y);if(valid(v)){sum+=v*w;weight+=w;}}
  if(weight<=0.0)discard;value=sum/weight;
 }
 vec3 color=vec3(stretch(value.x,raster.low.x,raster.high.x),stretch(value.y,raster.low.y,raster.high.y),stretch(value.z,raster.low.z,raster.high.z));
 if(raster.options.w>0.5)color=1.0-color;
 float alpha=raster.options.z;if(raster.bands.w>=0.0)alpha*=nearest[int(raster.bands.w)]/raster.low.w;
 fragColor=vec4(color*alpha,alpha);
}`;
export const rasterWGSL = `
struct Uniforms {rect:vec4<f32>,coords:vec4<f32>,size:vec4<f32>,low:vec4<f32>,high:vec4<f32>,bands:vec4<f32>,options:vec4<f32>,frame:vec4<f32>,camera:vec4<f32>,screenRect:vec4<f32>};
@group(0) @binding(0) var<uniform> raster:Uniforms;
@group(0) @binding(1) var dataTexture:texture_2d<u32>;
struct Out{@builtin(position) position:vec4<f32>};
@vertex fn vertexMain(@location(0) corners:vec2<f32>)->Out{
 let xy=mix(raster.screenRect.xy,raster.screenRect.zw,corners);
 return Out(vec4<f32>(xy/raster.size.xy*vec2<f32>(2.0,-2.0)+vec2<f32>(-1.0,1.0),0.0,1.0));
}
fn sampleAt(p:vec2<i32>)->vec4<f32>{return vec4<f32>(textureLoad(dataTexture,clamp(p,vec2<i32>(0),vec2<i32>(raster.size.zw)-1),0));}
fn rgb(v:vec4<f32>)->vec3<f32>{return vec3<f32>(v[u32(raster.bands.x)],v[u32(raster.bands.y)],v[u32(raster.bands.z)]);}
fn valid(v:vec3<f32>)->bool{return raster.options.y<0.0||all(v!=vec3<f32>(raster.options.y));}
fn stretch(v:f32,lo:f32,hi:f32)->f32{if(lo==hi){return 128.0/255.0;}return floor(clamp((v-lo)/(hi-lo),0.0,1.0)*255.0+0.5)/255.0;}
@fragment fn fragmentMain(input:Out)->@location(0) vec4<f32>{
 var css=input.position.xy*raster.frame.zw;
 if(raster.camera.x!=1.0 || raster.camera.y!=0.0 || raster.camera.z!=1.0){
  let screen=css-raster.size.xy*0.5;let denominator=raster.camera.z+screen.y*raster.camera.w;
  if(denominator<=0.0){discard;}
  let ry=screen.y/denominator;let rx=screen.x*(1.0-raster.camera.w*ry);
  css=vec2<f32>(raster.camera.x*rx-raster.camera.y*ry,raster.camera.y*rx+raster.camera.x*ry)+raster.size.xy*0.5;
  if(any(css<raster.rect.xy) || any(css>=raster.rect.zw)){discard;}
 }
 let pixel=mix(raster.coords.xy,raster.coords.zw,(css-raster.rect.xy)/(raster.rect.zw-raster.rect.xy));let nearest=sampleAt(vec2<i32>(floor(pixel)));var value=rgb(nearest);
 if(raster.options.x<0.5){if(!valid(value)){discard;}}
 else{let f=pixel-0.5;let p=vec2<i32>(floor(f));let uv=fract(f);var sum=vec3<f32>(0.0);var weight=0.0;
  for(var j=0;j<4;j++){let x=j&1;let y=j>>1;let v=rgb(sampleAt(p+vec2<i32>(x,y)));let w=select(1.0-uv.x,uv.x,x==1)*select(1.0-uv.y,uv.y,y==1);if(valid(v)){sum+=v*w;weight+=w;}}
  if(weight<=0.0){discard;}value=sum/weight;
 }
 var color=vec3<f32>(stretch(value.x,raster.low.x,raster.high.x),stretch(value.y,raster.low.y,raster.high.y),stretch(value.z,raster.low.z,raster.high.z));
 if(raster.options.w>0.5){color=1.0-color;}var alpha=raster.options.z;
 if(raster.bands.w>=0.0){alpha*=nearest[u32(raster.bands.w)]/raster.low.w;}
 return vec4<f32>(color*alpha,alpha);
}`;
