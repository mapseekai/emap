/** Billboard icon offsets in CSS pixels; map anchors use the shared high/low camera. */
export const iconVS = `#version 300 es
in vec2 corners;
in vec4 instancePositions;
out vec2 iconUV;
void main() {
 vec2 local=((corners+1.0)*0.5-emap.rect.xy)*emap.parameters.xy;
 vec2 rotated=vec2(emap.parameters.z*local.x-emap.parameters.w*local.y,emap.parameters.w*local.x+emap.parameters.z*local.y);
 gl_Position=billboardPosition(instancePositions,rotated+emap.rect.zw);
 iconUV=mix(emap.uvRect.xy,emap.uvRect.zw,(corners+1.0)*0.5);
}`;
export const iconFS = `#version 300 es
precision highp float;
uniform sampler2D imageTexture;
in vec2 iconUV;
out vec4 fragColor;
void main() {
 vec2 uv=clamp(iconUV,emap.uvRect.xy+emap.vertices0.xy*0.5,emap.uvRect.zw-emap.vertices0.xy*0.5);
 vec4 sampleColor=texture(imageTexture,uv);
 float a=sampleColor.a*emap.color.a;
 if(a<=0.0) discard;
 vec3 rgb=emap.arrow.x>0.5?emap.color.rgb:sampleColor.rgb;
 fragColor=vec4(rgb*a,a);
}`;
export const iconWGSL = `
@group(0) @binding(1) var imageTexture:texture_2d<f32>;
@group(0) @binding(2) var imageSampler:sampler;
struct IconOut { @builtin(position) position:vec4<f32>, @location(0) uv:vec2<f32> };
@vertex fn vertexMain(@location(0) corners:vec2<f32>,@location(1) instancePositions:vec4<f32>)->IconOut {
 let local=((corners+1.0)*0.5-emap.rect.xy)*emap.parameters.xy;
 let rotated=vec2<f32>(emap.parameters.z*local.x-emap.parameters.w*local.y,emap.parameters.w*local.x+emap.parameters.z*local.y);
 return IconOut(billboardPosition(instancePositions,rotated+emap.rect.zw),mix(emap.uvRect.xy,emap.uvRect.zw,(corners+1.0)*0.5));
}
@fragment fn fragmentMain(p:IconOut)->@location(0) vec4<f32> {
 let uv=clamp(p.uv,emap.uvRect.xy+emap.vertices0.xy*0.5,emap.uvRect.zw-emap.vertices0.xy*0.5);
 let c=textureSample(imageTexture,imageSampler,uv); let a=c.a*emap.color.a;
 if(a<=0.0){discard;}
 let rgb=select(c.rgb,emap.color.rgb,emap.arrow.x>0.5);
 return vec4<f32>(rgb*a,a);
}`;
