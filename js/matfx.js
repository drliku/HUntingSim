// Surface detail for characters and wildlife: a fine grain painted over the vertex colours (cloth
// weave, fur, skin pores) and a soft sheen around the silhouette, so clothes and fur stop looking
// like smooth plastic. Works on the Lambert materials (plain and skinned meshes).
const NOISE = /* glsl */`
varying vec3 vObjP;
float mfH(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float mfN(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(mfH(i), mfH(i + vec3(1, 0, 0)), f.x), mix(mfH(i + vec3(0, 1, 0)), mfH(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(mfH(i + vec3(0, 0, 1)), mfH(i + vec3(1, 0, 1)), f.x), mix(mfH(i + vec3(0, 1, 1)), mfH(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
`;

export function enhanceMaterial(mat, { grain = 0.1, freq = 60, rim = 0.3 } = {}) {
  const g = grain.toFixed(3), fq = freq.toFixed(1), rm = rim.toFixed(3);
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = 'varying vec3 vObjP;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vObjP = position;');
    sh.fragmentShader = NOISE + sh.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>
  {
    vec3 q = vObjP * ${fq};
    // fade the grain out where it would shimmer (far away, a pixel covers many grains)
    float fw = clamp(length(fwidth(q)) * 0.5, 0.0, 1.0);
    float gn = (mfN(q) - 0.5) * 0.65 + (mfN(q * 2.9 + 7.0) - 0.5) * 0.35;
    diffuseColor.rgb *= 1.0 + gn * ${g} * 2.0 * (1.0 - fw);
  }`)
      .replace('#include <opaque_fragment>', `{
    float nv = abs(dot(normalize(normal), normalize(vViewPosition)));
    outgoingLight += outgoingLight * pow(1.0 - nv, 3.0) * ${rm};
  }
  #include <opaque_fragment>`);
  };
  mat.customProgramCacheKey = () => `mfx|${g}|${fq}|${rm}`;
  return mat;
}
