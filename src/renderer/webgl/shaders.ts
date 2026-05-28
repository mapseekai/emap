export const POSITION_VS = `#version 300 es
in vec2 positions;
uniform mat3 u_matrix;
uniform float u_pointSize;
void main() {
  vec3 p = u_matrix * vec3(positions, 1.0);
  gl_Position = vec4(p.xy, 0.0, 1.0);
  gl_PointSize = u_pointSize;
}`;

export const COLOR_FS = `#version 300 es
precision highp float;
uniform vec4 u_color;
out vec4 fragColor;
void main() {
  fragColor = u_color;
}`;

export const POINT_INSTANCE_VS = `#version 300 es
in vec2 positions;
in vec2 instancePositions;
uniform mat3 u_matrix;
uniform float u_radius;
uniform vec2 u_viewportSize;
out vec2 v_unitPosition;
void main() {
  vec3 center = u_matrix * vec3(instancePositions, 1.0);
  vec2 pixelOffset = positions * u_radius;
  vec2 clipOffset = pixelOffset * vec2(2.0 / u_viewportSize.x, -2.0 / u_viewportSize.y);
  gl_Position = vec4(center.xy + clipOffset, 0.0, 1.0);
  v_unitPosition = positions;
}`;

export const POINT_INSTANCE_FS = `#version 300 es
precision highp float;
uniform vec4 u_color;
in vec2 v_unitPosition;
out vec4 fragColor;
void main() {
  float dist = length(v_unitPosition);
  if (dist > 1.0) {
    discard;
  }
  float edge = fwidth(dist);
  float alpha = u_color.a * (1.0 - smoothstep(1.0 - edge, 1.0, dist));
  fragColor = vec4(u_color.rgb, alpha);
}`;

export const LINE_SEGMENT_VS = `#version 300 es
in vec2 positions;
in vec2 instanceLeftPositions;
in vec2 instanceStartPositions;
in vec2 instanceEndPositions;
in vec2 instanceRightPositions;
in float instanceSegmentTypes;
uniform mat3 u_matrix;
uniform float u_width;
uniform vec2 u_viewportSize;
void main() {
  vec3 startClip3 = u_matrix * vec3(instanceStartPositions, 1.0);
  vec3 endClip3 = u_matrix * vec3(instanceEndPositions, 1.0);
  vec2 startClip = startClip3.xy;
  vec2 endClip = endClip3.xy;
  vec2 startPx = (startClip * 0.5 + 0.5) * u_viewportSize;
  vec2 endPx = (endClip * 0.5 + 0.5) * u_viewportSize;
  vec2 dir = normalize(endPx - startPx);
  if (length(endPx - startPx) == 0.0) {
    dir = vec2(1.0, 0.0);
  }
  vec2 normal = vec2(-dir.y, dir.x);
  vec2 clipOffset = normal * positions.y * u_width * vec2(2.0 / u_viewportSize.x, 2.0 / u_viewportSize.y);
  vec2 base = mix(startClip, endClip, positions.x);
  float keepAttributesLive = dot(instanceLeftPositions + instanceRightPositions, vec2(0.0)) + instanceSegmentTypes * 0.0;
  gl_Position = vec4(base + clipOffset + keepAttributesLive, 0.0, 1.0);
}`;
