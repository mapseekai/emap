/**
 * Filled-circle specialization following deck.gl ScatterplotLayer:
 * four shared strip vertices, a tight radius + 0.5 CSS px envelope and an
 * analytic one-CSS-pixel smooth edge. No derivative or generic marker loop.
 * Positions retain emap's XY high/low layout. Blending remains source-over.
 * Reference: visgl/deck.gl scatterplot-layer (MIT), installed version 9.3.0.
 */
export const circleVS = `#version 300 es
in vec2 corners;
in vec4 instancePositions;
out vec2 localPosition;
void main() {
  localPosition = corners * (emap.parameters.x + 0.5);
  gl_Position = clipPosition(projectPosition(instancePositions) + localPosition);
}
`;
export const circleFS = `#version 300 es
precision highp float;
in vec2 localPosition;
out vec4 fragColor;
void main() {
  float distance = length(localPosition);
  float coverage = smoothstep(distance - 0.5, distance + 0.5, emap.parameters.x);
  if (coverage <= 0.0) discard;
  float alpha = emap.color.a * coverage;
  fragColor = vec4(emap.color.rgb * alpha, alpha);
}
`;
export const circleWGSL = `
struct CircleOut {
  @builtin(position) position: vec4<f32>,
  @location(0) local: vec2<f32>
};
@vertex fn vertexMain(@location(0) corners: vec2<f32>, @location(1) instancePositions: vec4<f32>) -> CircleOut {
  let local = corners * (emap.parameters.x + 0.5);
  return CircleOut(clipPosition(projectPosition(instancePositions) + local), local);
}
@fragment fn fragmentMain(p: CircleOut) -> @location(0) vec4<f32> {
  let distance = length(p.local);
  let coverage = smoothstep(distance - 0.5, distance + 0.5, emap.parameters.x);
  if (coverage <= 0.0) { discard; }
  return premultiply(coverage);
}
`;

/** Classify only analytically fully-covered samples as opaque. Fractional
 * coverage is never rounded up, quantized, sampled or used to remove points.
 */
export const circleCoreVS = circleVS;
export const circleCoreFS = circleFS.replace(
  'if (coverage <= 0.0) discard;',
  'if (coverage < 1.0) discard;',
);
export const circleCoreWGSL = circleWGSL.replace(
  'if (coverage <= 0.0) { discard; }',
  'if (coverage < 1.0) { discard; }',
);
export const pointDepthResetVS = `#version 300 es
in vec2 corners;
void main() { gl_Position = vec4(corners, 1.0, 1.0); }
`;
export const pointDepthResetFS = `#version 300 es
precision highp float;
out vec4 fragColor;
void main() { fragColor = vec4(0.0); }
`;
export const pointDepthResetWGSL = `
@vertex fn vertexMain(@location(0) corners: vec2<f32>) -> @builtin(position) vec4<f32> {
  return vec4<f32>(corners, 1.0, 1.0);
}
@fragment fn fragmentMain() -> @location(0) vec4<f32> { return vec4<f32>(0.0); }
`;
