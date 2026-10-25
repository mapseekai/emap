import { cameraGLSL } from './camera-shaders';

const uniforms = `
layout(std140) uniform emapUniforms {
  vec4 origin;
  vec2 scale;
  vec2 viewport;
  vec4 color;
  vec4 parameters;
  vec4 rect;
  vec4 vertices0;
  vec4 vertices1;
  vec4 vertices2;
  vec4 vertices3;
  vec4 vertices4;
  vec4 vertices5;
  vec2 arrow;
  float pixelRatio;
  vec2 lowScale;
  vec2 framebufferSize;
  vec4 camera;
  vec4 uvRect;
} emap;
`;
export const emapModule = {
  name: 'emap',
  vs: uniforms + cameraGLSL,
  fs: uniforms,
};
const fragment = `#version 300 es
precision highp float;
out vec4 fragColor;
vec4 premultiply(float coverage) {
  float alpha = emap.color.a * coverage;
  return vec4(emap.color.rgb * alpha, alpha);
}
`;
export const fillVS = `#version 300 es
in vec4 positions;
void main() { gl_Position = groundClipPosition(rawDifference(positions, emap.origin)); }
`;
export const fillFS = `${fragment}
void main() { fragColor = premultiply(1.0); }
`;
export const pointVS = `#version 300 es
in vec2 corners;
in vec4 instancePositions;
out vec2 localPosition;
void main() {
  float extent = emap.parameters.x + emap.parameters.y + 1.0 / emap.pixelRatio;
  localPosition = corners * extent;
  gl_Position = billboardPosition(instancePositions, localPosition);
}
`;
export const pointFS = `${fragment}
in vec2 localPosition;
float markerDistance(vec2 point) {
  float radius = emap.parameters.x;
  int count = int(emap.parameters.z);
  if (count == 0) return length(point) - radius;
  vec2 vertices[12] = vec2[12](
    emap.vertices0.xy, emap.vertices0.zw, emap.vertices1.xy, emap.vertices1.zw,
    emap.vertices2.xy, emap.vertices2.zw, emap.vertices3.xy, emap.vertices3.zw,
    emap.vertices4.xy, emap.vertices4.zw, emap.vertices5.xy, emap.vertices5.zw);
  vec2 p = point / radius;
  float distanceSquared = 1e20;
  bool inside = false;
  vec2 a = vertices[count - 1];
  for (int i = 0; i < 12; i++) {
    if (i >= count) break;
    vec2 b = vertices[i];
    vec2 edge = b - a;
    vec2 delta = p - a;
    vec2 closest = delta - edge * clamp(dot(delta, edge) / max(dot(edge, edge), 1e-20), 0.0, 1.0);
    distanceSquared = min(distanceSquared, dot(closest, closest));
    if ((a.y > p.y) != (b.y > p.y)) {
      if (p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
    }
    a = b;
  }
  return sqrt(distanceSquared) * radius * (inside ? -1.0 : 1.0);
}
void main() {
  float distance = markerDistance(localPosition);
  if (emap.parameters.w < 0.5) distance = abs(distance) - emap.parameters.y * 0.5;
  float aa = max(fwidth(distance), 0.5 / emap.pixelRatio);
  float coverage = 1.0 - smoothstep(-aa * 0.5, aa * 0.5, distance);
  if (coverage <= 0.0) discard;
  fragColor = premultiply(coverage);
}
`;
export const lineVS = `#version 300 es
in vec2 corners;
in vec4 instanceStart;
in vec4 instanceEnd;
in vec2 instanceDistance;
out vec2 localPosition;
flat out float segmentLength;
flat out float startDistance;
void main() {
  vec2 start = projectSegmentPosition(instanceStart, instanceEnd);
  vec2 end = projectSegmentPosition(instanceEnd, instanceStart);
  vec2 delta = projectDifference(instanceEnd, instanceStart);
  segmentLength = length(delta);
  vec2 direction = segmentLength > 1e-8 ? delta / segmentLength : vec2(1.0, 0.0);
  vec2 normal = vec2(-direction.y, direction.x);
  float extent = emap.parameters.x * 0.5 + 1.0 / emap.pixelRatio;
  if (emap.parameters.w > 0.5) extent += emap.arrow.y * 0.45;
  localPosition = vec2(mix(-extent, segmentLength + extent, (corners.x + 1.0) * 0.5), corners.y * extent);
  startDistance = (instanceDistance.x + instanceDistance.y) * abs(emap.scale.x);
  // Do not reconstruct the end as start + direction * length: start may be
  // millions of pixels off screen at deep zoom, destroying the endpoint residual.
  bool atEnd = corners.x > 0.0;
  vec2 anchor = atEnd ? end : start;
  vec2 offset = direction * (atEnd ? extent : -extent) + normal * localPosition.y;
  gl_Position = clipPosition(anchor + offset);
}
`;
export const lineFS = `${fragment}
uniform sampler2D dashTexture;
in vec2 localPosition;
flat in float segmentLength;
flat in float startDistance;
float distanceToSegment(vec2 p, vec2 a, vec2 b) {
  vec2 ab = b - a;
  return length(p - a - ab * clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-20), 0.0, 1.0));
}
void main() {
  float halfWidth = emap.parameters.x * 0.5;
  float longitudinalGap = max(max(-localPosition.x, localPosition.x - segmentLength), 0.0);
  float distance = length(vec2(longitudinalGap, localPosition.y)) - halfWidth;
  if (emap.parameters.w > 0.5) {
    float spacing = emap.arrow.x;
    float size = emap.arrow.y;
    float phase = mod(startDistance + localPosition.x, spacing);
    float dashLength = min(spacing * 0.55, max(spacing * 0.35, size * 1.5));
    float dashGap = min(max(phase - dashLength, 0.0), spacing - phase);
    float dashDistance = length(vec2(dashGap, localPosition.y)) - halfWidth;
    vec2 tip = vec2(spacing * 0.78, 0.0);
    float arrowHalf = size * 0.45;
    float back = sqrt(size * size - arrowHalf * arrowHalf);
    vec2 p = vec2(phase, localPosition.y);
    float arrowDistance = min(
      distanceToSegment(p, tip, tip + vec2(-back, arrowHalf)),
      distanceToSegment(p, tip, tip + vec2(-back, -arrowHalf))) - halfWidth;
    distance = max(min(dashDistance, arrowDistance), longitudinalGap - halfWidth);
  } else if (emap.parameters.z > 0.5 && emap.parameters.y > 0.0) {
    float period = emap.parameters.y;
    float phase = mod(startDistance + localPosition.x, period);
    float previous = 0.0;
    float gap = period;
    int count = int(emap.parameters.z);
    for (int i = 0; i < count; i++) {
      float boundary = texelFetch(dashTexture, ivec2(i, 0), 0).r;
      if (i % 2 == 0) {
        gap = min(gap, max(max(previous - phase, phase - boundary), 0.0));
        gap = min(gap, max(max(previous - phase - period, phase + period - boundary), 0.0));
        gap = min(gap, max(max(previous - phase + period, phase - period - boundary), 0.0));
      }
      previous = boundary;
    }
    distance = max(distance, length(vec2(gap, localPosition.y)) - halfWidth);
  }
  float aa = max(fwidth(distance), 0.5 / emap.pixelRatio);
  float coverage = 1.0 - smoothstep(-aa * 0.5, aa * 0.5, distance);
  if (coverage <= 0.0) discard;
  fragColor = premultiply(coverage);
}
`;
export const imageVS = `#version 300 es
in vec2 corners;
out vec2 uv;
void main() {
  vec2 local = (corners + 1.0) * 0.5;
  uv = mix(emap.uvRect.xy, emap.uvRect.zw, local);
  vec2 pixels = mix(emap.rect.xy, emap.rect.zw, local);
  gl_Position = groundClipPosition(pixels - emap.viewport * 0.5);
}
`;
export const imageFS = `${fragment}
uniform sampler2D imageTexture;
in vec2 uv;
void main() {
  vec4 color = texture(imageTexture, uv);
  float alpha = color.a * emap.parameters.x;
  fragColor = vec4(color.rgb * alpha, alpha);
}
`;
