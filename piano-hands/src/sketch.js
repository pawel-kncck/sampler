// "Pencil drawing" look: grayscale lighting converted into screen-space
// cross-hatching on paper, plus ink outlines.
import * as THREE from 'three';

export const PAPER = [0.955, 0.950, 0.935];
export const INK = [0.16, 0.16, 0.17];

const sketchUniforms = {
  uPaper: { value: new THREE.Vector3(...PAPER) },
  uInk: { value: new THREE.Vector3(...INK) },
  uPixelRatio: { value: 1 },
  uHatch: { value: 1 },
};

export function setSketchPixelRatio(pr) {
  sketchUniforms.uPixelRatio.value = pr;
}

const SKETCH_GLSL = /* glsl */ `
uniform vec3 uPaper;
uniform vec3 uInk;
uniform float uPixelRatio;
uniform float uHatch;
uniform float uHatchDensity;

float skHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float skNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(skHash(i), skHash(i + vec2(1.0, 0.0)), f.x),
             mix(skHash(i + vec2(0.0, 1.0)), skHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
// One family of parallel, slightly wobbly pencil strokes.
float skHatch(vec2 p, float ang, float spacing, float width) {
  float c = cos(ang), s = sin(ang);
  float across = p.x * c + p.y * s;
  float along = -p.x * s + p.y * c;
  float row = floor(across / spacing);
  across += (skNoise(vec2(along * 0.035, row * 1.7)) - 0.5) * 1.6;
  float d = abs(fract(across / spacing) - 0.5) * spacing;
  // strokes fade in and out along their length
  float stroke = smoothstep(0.15, 0.55, skNoise(vec2(along * 0.012 + row * 3.1, row * 0.37)));
  return (1.0 - smoothstep(width * 0.5, width * 0.5 + 0.9, d)) * mix(0.45, 1.0, stroke);
}
vec3 skShade(float lum) {
  vec2 p = gl_FragCoord.xy / uPixelRatio;
  float t = clamp(lum, 0.0, 1.0);
  float sp = 6.5 / uHatchDensity;
  float ink = 0.0;
  ink = max(ink, skHatch(p, 0.80, sp, 0.9) * smoothstep(0.86, 0.66, t));
  ink = max(ink, skHatch(p, -0.75, sp, 0.9) * smoothstep(0.58, 0.40, t));
  ink = max(ink, skHatch(p, 0.12, sp * 0.7, 0.8) * smoothstep(0.34, 0.16, t));
  ink *= uHatch * (0.55 + 0.4 * skNoise(p * 0.45));
  // soft graphite wash under the strokes
  float wash = mix(0.80, 1.0, smoothstep(0.05, 0.92, t));
  return mix(uPaper * wash, uInk, clamp(ink, 0.0, 1.0));
}
`;

/**
 * Lambert material whose final colour is replaced by hatching, so it gets
 * three.js lighting and shadows for free.
 */
export function sketchMaterial(albedo = 1, { density = 1, side = THREE.FrontSide, fade = null } = {}) {
  const m = new THREE.MeshLambertMaterial({ color: new THREE.Color(albedo, albedo, albedo), side });
  if (fade) m.transparent = true;
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, sketchUniforms, { uHatchDensity: { value: density } });
    if (fade) {
      // fade out along local +z (used for the forearms: an "unfinished" sketch)
      shader.uniforms.uFade = { value: new THREE.Vector2(...fade) };
      shader.vertexShader = shader.vertexShader
        .replace('void main() {', 'varying float vFadeZ;\nvoid main() {\nvFadeZ = position.z;');
    }
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', SKETCH_GLSL + (fade ? '\nvarying float vFadeZ;\nuniform vec2 uFade;' : '') + '\nvoid main() {')
      .replace(
        '#include <dithering_fragment>',
        `#include <dithering_fragment>
         float skLum = dot(gl_FragColor.rgb, vec3(0.299, 0.587, 0.114));
         gl_FragColor.rgb = skShade(skLum);
         ${fade ? 'gl_FragColor.a = 1.0 - smoothstep(uFade.x, uFade.y, vFadeZ);' : ''}`
      );
  };
  m.customProgramCacheKey = () => 'sketch' + density + (fade ? 'f' : '');
  return m;
}

/**
 * Inverted-hull outline with (roughly) constant screen-space width.
 */
export function outlineMaterial(width = 0.0028, color = INK, fade = null) {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    transparent: !!fade,
    uniforms: {
      uWidth: { value: width },
      uColor: { value: new THREE.Vector3(...color) },
      uFade: { value: new THREE.Vector2(...(fade || [1e9, 1e9 + 1])) },
    },
    vertexShader: /* glsl */ `
      uniform float uWidth;
      varying float vFadeZ;
      void main() {
        vFadeZ = position.z;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vec3 n = normalize(normalMatrix * normal);
        mv.xyz += n * uWidth * clamp(-mv.z, 0.15, 3.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform vec2 uFade;
      varying float vFadeZ;
      void main() { gl_FragColor = vec4(uColor, 1.0 - smoothstep(uFade.x, uFade.y, vFadeZ)); }`,
  });
}

export function lineMaterial(opacity = 0.85) {
  return new THREE.LineBasicMaterial({
    color: new THREE.Color().setRGB(INK[0], INK[1], INK[2], THREE.SRGBColorSpace),
    transparent: true,
    opacity,
  });
}
