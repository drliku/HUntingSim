// Surface detail for every vertex-coloured Lambert material (buildings, rocks, trunks, props,
// animals, people): procedural grain bumps the normals and mottles the colour, so flat-painted
// faces read as wood, stone, bark, fur and cloth. A soft rim of sky light outlines shapes
// against the background. Driven by object-space position, so it sticks to moving animals.
// Materials that patch their own shader (terrain, swaying plants) can call enhanceShader().
import * as THREE from 'three';

export const SurfaceDetail = { enabled: true };

const NOISE = /* glsl */`
varying vec3 vObjP;
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
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vObjP;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvObjP = position;');
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
  }` : ''}`)
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
