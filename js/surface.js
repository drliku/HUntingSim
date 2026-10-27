// Surface detail for every vertex-coloured Lambert material (buildings, rocks, trunks, props,
// animals, people): procedural grain bumps the normals and mottles the colour, so flat-painted
// faces read as wood, stone, bark, fur and cloth. A soft rim of sky light outlines shapes
// against the background. Driven by object-space position, so it sticks to moving animals.
// Materials that patch their own shader (terrain, swaying plants) can call enhanceShader().
import * as THREE from 'three';

export const SurfaceDetail = { enabled: true };
// How much snow has settled (0..1) and how wet everything is after rain; driven by the weather.
export const SurfaceWeather = { uSnowCover: { value: 0 }, uWet: { value: 0 } };

const NOISE = /* glsl */`
varying vec3 vObjP, vSWP;
uniform float uSnowCover, uWet;
float sdH(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float sdN(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(sdH(i), sdH(i + vec3(1, 0, 0)), f.x), mix(sdH(i + vec3(0, 1, 0)), sdH(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(sdH(i + vec3(0, 0, 1)), sdH(i + vec3(1, 0, 1)), f.x), mix(sdH(i + vec3(0, 1, 1)), sdH(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
// bump with screen-space derivatives; the unnormalised form keeps the strength independent of distance
vec3 sdPerturb(vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDir) {
  vec3 sx = dFdx(surf_pos), sy = dFdy(surf_pos);
  vec3 R1 = cross(sy, surf_norm), R2 = cross(surf_norm, sx);
  float det = dot(sx, R1) * faceDir;
  if (abs(det) < 1e-14) return surf_norm;
  vec3 grad = sign(det) * (dHdxy.x * R1 + dHdxy.y * R2);
  vec3 r = abs(det) * surf_norm - grad;
  float l2 = dot(r, r);
  return l2 > 1e-30 ? r * inversesqrt(l2) : surf_norm;
}`;

// kinds: 'solid' (default: wood, stone, fur, cloth), 'foliage' (colour variation and rim only)
export function enhanceShader(shader, kind = 'solid') {
  const bump = kind === 'solid' ? 0.55 : 0.0;
  const mottle = kind === 'solid' ? 0.3 : 0.22;
  shader.uniforms.uSnowCover = SurfaceWeather.uSnowCover;
  shader.uniforms.uWet = SurfaceWeather.uWet;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vObjP, vSWP;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvObjP = position;')
    .replace('#include <project_vertex>', `#include <project_vertex>
  {
    vec4 swp = vec4(transformed, 1.0);
    #ifdef USE_INSTANCING
      swp = instanceMatrix * swp;
    #endif
    vSWP = (modelMatrix * swp).xyz;
  }`);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\n' + NOISE)
    .replace('#include <color_fragment>', `#include <color_fragment>
  {
    float m = sdN(vObjP * 1.4) * 0.6 + sdN(vObjP * 4.1 + 7.3) * 0.4;
    float g = sdN(vObjP * 13.0);
    diffuseColor.rgb *= 1.0 + (m - 0.5) * ${mottle.toFixed(2)} + (g - 0.5) * ${(mottle * 0.4).toFixed(2)};
  }`)
    .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
  ${bump > 0 ? `{
    float dist = length(vViewPosition);
    float amp = ${bump.toFixed(2)} * (1.0 - smoothstep(14.0, 38.0, dist));
    if (amp > 0.001) {
      float h = sdN(vObjP * 7.0) * 0.55 + sdN(vObjP * 19.0) * 0.3 + sdN(vObjP * 47.0) * 0.15;
      normal = sdPerturb(-vViewPosition, normal, vec2(dFdx(h), dFdy(h)) * amp * 0.06, faceDirection);
    }
  }` : ''}
  // snow settles on everything that faces up (roofs, rocks, branches, antlers); rain darkens it all
  float snowAmt = 0.0;
  if (uSnowCover > 0.001) {
    vec3 wN = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
    float sn = sdN(vSWP * 1.7) * 0.6 + sdN(vSWP * 5.3) * 0.4;
    snowAmt = smoothstep(0.3, 0.7, wN.y * 0.9 + sn * 0.35 - (1.0 - uSnowCover) * 0.9);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.89, 0.94), snowAmt);
  }
  diffuseColor.rgb *= 1.0 - uWet * 0.32 * (1.0 - snowAmt);`)
    .replace('#include <opaque_fragment>', `
  {
    // rim of sky light along silhouettes
    float fr = 1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
    #if NUM_HEMI_LIGHTS > 0
      vec3 skyC = hemisphereLights[0].skyColor;
    #else
      vec3 skyC = ambientLightColor;
    #endif
    outgoingLight += diffuseColor.rgb * skyC * pow(fr, 3.0) * ${kind === 'foliage' ? '0.45' : '0.32'};
    // wet sheen: rain-soaked surfaces mirror the sky at grazing angles
    outgoingLight += skyC * uWet * pow(fr, 5.0) * ${kind === 'foliage' ? '0.0' : '0.12'} * (1.0 - snowAmt);
  }
#include <opaque_fragment>`);
}

// Every Lambert material with vertex colours gets the detail unless it brings its own shader
// patch. Installed once, before anything compiles; toggling needs material.needsUpdate.
export function installSurfaceDetail() {
  const proto = THREE.MeshLambertMaterial.prototype;
  const base = proto.onBeforeCompile;
  proto.onBeforeCompile = function (shader, renderer) {
    base.call(this, shader, renderer);
    if (SurfaceDetail.enabled && this.vertexColors && !this.userData.noDetail) enhanceShader(shader, this.userData.detailKind || 'solid');
  };
  const baseKey = proto.customProgramCacheKey;
  proto.customProgramCacheKey = function () {
    return baseKey.call(this) + (SurfaceDetail.enabled && this.vertexColors && !this.userData.noDetail ? '|sd:' + (this.userData.detailKind || 'solid') : '');
  };
}
