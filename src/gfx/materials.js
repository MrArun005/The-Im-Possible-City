import * as THREE from 'three';
import * as T from './textures.js';

/**
 * Shared materials. Sharing is the point: 60 buildings drawing with 5 materials
 * is 5 programs and a handful of draw calls. Nothing here is created per object.
 */
const cache = new Map();
const memo = (key, factory) => {
  if (!cache.has(key)) cache.set(key, factory());
  return cache.get(key);
};

/** Global uniforms every patched material shares (day/night, wetness, fade). */
export const globals = {
  uNight: { value: 1 },      // 0 = noon, 1 = full night
  uWetness: { value: 0 },    // 0 = dry, 1 = soaked
  uTime: { value: 0 },
};

export function clearMaterialCache() {
  for (const m of cache.values()) m.dispose?.();
  cache.clear();
}

// ------------------------------------------------------------------ facades

export function facadeMaterial(variant = 0) {
  return memo(`facade-${variant}`, () => {
    const mat = new THREE.MeshStandardMaterial({
      map: T.brick(variant),
      normalMap: T.brickNormal(variant),
      normalScale: new THREE.Vector2(0.55, 0.55),
      roughness: 0.9,
      metalness: 0,
      color: 0xffffff,
    });
    patchWetness(mat, 0.35);
    return mat;
  });
}

export function stoneMaterial(variant = 0) {
  return memo(`stone-${variant}`, () => {
    const mat = new THREE.MeshStandardMaterial({
      map: T.stone(variant),
      roughness: 0.86,
      metalness: 0,
    });
    patchWetness(mat, 0.45);
    return mat;
  });
}

export function woodMaterial(variant = 0, { roughness = 0.72 } = {}) {
  return memo(`wood-${variant}-${roughness}`, () =>
    new THREE.MeshStandardMaterial({
      map: T.wood(variant),
      normalMap: T.woodNormal(variant),
      normalScale: new THREE.Vector2(0.5, 0.5),
      roughness,
      metalness: 0.04,
    })
  );
}

export function metalMaterial(color = 0x2a2724, { roughness = 0.42, metalness = 0.85 } = {}) {
  return memo(`metal-${color}-${roughness}`, () =>
    new THREE.MeshStandardMaterial({ color, roughness, metalness })
  );
}

export function trimMaterial(color = 0x1b1a18) {
  return memo(`trim-${color}`, () =>
    new THREE.MeshStandardMaterial({ color, roughness: 0.68, metalness: 0.05 })
  );
}

// ------------------------------------------------------------------- ground

export function cobbleMaterial() {
  return memo('cobble', () => {
    const mat = new THREE.MeshStandardMaterial({
      map: T.cobbleAlbedo(),
      normalMap: T.cobbleNormal(),
      roughnessMap: T.cobbleRough(),
      normalScale: new THREE.Vector2(0.5, 0.5),
      roughness: 1,
      metalness: 0.02,
      color: 0xffffff,
    });
    // Rain mode swaps roughness by uniform rather than by texture (Task 3.3):
    // a uniform tween is free, a texture swap is a hitch.
    patchWetness(mat, 0.78);
    return mat;
  });
}

export function asphaltMaterial() {
  return memo('asphalt', () => {
    const mat = new THREE.MeshStandardMaterial({
      map: T.asphaltAlbedo(),
      normalMap: T.asphaltNormal(),
      normalScale: new THREE.Vector2(0.55, 0.55),
      roughness: 0.55,
      // Low metalness on purpose. Metal reflects and does not diffuse, so a
      // metallic road at a grazing viewing angle mirrors the HORIZON of the
      // environment - dark buildings - and the near edge of frame goes black.
      // Asphalt is a dielectric; the sheen comes from roughness, not metal.
      metalness: 0.06,
      color: 0xffffff,
    });
    // NYC asphalt is permanently a little wet - that is the whole look. The
    // amount is moderate on purpose: pushed further, the road stops reflecting
    // neon and just goes black at the near edge of frame, where the viewing
    // angle is steepest and there is nothing above it to reflect.
    patchWetness(mat, 0.5, 0.3);
    return mat;
  });
}

export function puddleMaterial() {
  return memo('puddle', () =>
    new THREE.MeshStandardMaterial({
      color: 0x0a0f14,
      alphaMap: T.puddleDecal(),
      transparent: true,
      roughness: 0.06,
      metalness: 0.55,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    })
  );
}

/**
 * Wetness patch: darkens albedo and drops roughness as `uWetness` rises, so one
 * uniform turns any surface rain-slick. `bias` keeps a surface partly wet always.
 */
function patchWetness(mat, amount = 0.6, bias = 0) {
  mat.userData.wetAmount = amount;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uWetness = globals.uWetness;
    shader.uniforms.uWetAmount = { value: amount };
    shader.uniforms.uWetBias = { value: bias };
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         uniform float uWetness;
         uniform float uWetAmount;
         uniform float uWetBias;`
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
         float wet = clamp(uWetBias + uWetness * uWetAmount, 0.0, 1.0);
         // Never a perfect mirror: a real wet road keeps some microroughness,
         // and a roughness of 0.05 turns every surface into a black pane
         // wherever there is nothing bright to reflect.
         roughnessFactor = mix(roughnessFactor, 0.13, wet);
         // Wet darkens a surface, but not to nothing: a soaked road at night is
         // still lighter than its own reflection of an unlit skyline.
         diffuseColor.rgb *= mix(1.0, 0.8, wet);`
      );
  };
  mat.customProgramCacheKey = () => `wet-${amount}-${bias}`;
  return mat;
}

// ------------------------------------------------------------------ windows

/**
 * Living windows (Task 5.2, reused by London in Task 3.4).
 *
 * One emissive atlas + two instanced attributes:
 *   aAtlas (vec2) - which atlas cell this window uses
 *   aGlow  (float) - how hot it burns, and how much it responds to night
 *
 * The result: every window in the city is individually lit, at the cost of one
 * draw call and one texture. This is the cheapest "alive" in the whole project.
 */
export function livingWindowMaterial(atlas, { cells = 4, additive = false } = {}) {
  const key = `living-${atlas.uuid}-${cells}-${additive}`;
  return memo(key, () => {
    const mat = new THREE.MeshBasicMaterial({
      map: atlas,
      toneMapped: false,
      transparent: additive,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      depthWrite: !additive,
    });

    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uCells = { value: cells };
      shader.uniforms.uNight = globals.uNight;
      shader.uniforms.uTime = globals.uTime;

      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
           attribute vec2 aAtlas;
           attribute float aGlow;
           attribute float aFlicker;
           uniform float uCells;
           varying float vGlow;
           varying float vFlicker;`
        )
        .replace(
          '#include <uv_vertex>',
          `#include <uv_vertex>
           #ifdef USE_MAP
             vMapUv = vMapUv / uCells + aAtlas;
           #endif
           vGlow = aGlow;
           vFlicker = aFlicker;`
        );

      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
           uniform float uNight;
           uniform float uTime;
           varying float vGlow;
           varying float vFlicker;`
        )
        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>
           // Gaslight and tungsten do not sit still. A slow per-window wobble
           // plus a rare dip reads as a real filament without any CPU cost.
           float wob = 0.88 + 0.12 * sin(uTime * (1.6 + vFlicker * 5.0) + vFlicker * 40.0);
           float dip = 1.0 - 0.25 * step(0.985, fract(sin(floor(uTime * 3.0) + vFlicker * 91.0) * 43758.5));
           diffuseColor.rgb *= vGlow * uNight * wob * dip;`
        );
    };
    mat.customProgramCacheKey = () => `living-${cells}-${additive}`;
    return mat;
  });
}

/**
 * Attaches the instanced attributes the living-window material expects.
 * `pattern` decides how windows are lit: not every building is a Christmas tree.
 */
export function seedWindowAttributes(
  instanced,
  rng,
  { cells = 4, litChance = 0.55, maxGlow = 1.6, hints = null } = {}
) {
  const count = instanced.count;
  const atlas = new Float32Array(count * 2);
  const glow = new Float32Array(count);
  const flicker = new Float32Array(count);
  const step = 1 / cells;

  for (let i = 0; i < count; i++) {
    // A hint of 'always' forces a lit cell. Big panes - shopfronts, diner
    // glazing, lobby glass - must never roll the dark cell: a nine-metre black
    // rectangle at street level reads as a hole in the world, not as a shop
    // that has closed for the night.
    const hint = hints?.[i];
    const lit = hint === 'always' ? true : hint === 'never' ? false : rng.chance(litChance);
    const cell = lit ? rng.int(1, cells * cells - 1) : 0;
    atlas[i * 2] = (cell % cells) * step;
    atlas[i * 2 + 1] = Math.floor(cell / cells) * step;
    // An unlit window at night is not a black hole - it still catches the
    // street. A hard 0 reads as a missing texture, especially on big panes.
    glow[i] = lit ? rng.range(0.35, maxGlow) : rng.range(0.05, 0.11);
    flicker[i] = rng();
  }

  instanced.geometry.setAttribute('aAtlas', new THREE.InstancedBufferAttribute(atlas, 2));
  instanced.geometry.setAttribute('aGlow', new THREE.InstancedBufferAttribute(glow, 1));
  instanced.geometry.setAttribute('aFlicker', new THREE.InstancedBufferAttribute(flicker, 1));
  return { atlas, glow, flicker };
}

// ----------------------------------------------------------------- emissive

export function emissiveMaterial(color, intensity = 1, { additive = false, map = null } = {}) {
  const mat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(color).multiplyScalar(intensity),
    map,
    toneMapped: false,
    transparent: additive || !!map,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    depthWrite: !additive,
    side: THREE.DoubleSide,
  });
  return mat;
}

/**
 * The "baked" interior material (§5.3). Real lightmap bakes need Blender; this
 * fakes the same result - vertex-free ambient occlusion via a warm gradient and
 * a strong emissive floor - so interiors read as lit without costing lights.
 */
export function bakedMaterial({ map = null, color = 0xffffff, warmth = 1, roughness = 0.8 } = {}) {
  const mat = new THREE.MeshStandardMaterial({
    map,
    color,
    roughness,
    metalness: 0.02,
    emissive: new THREE.Color(0xff9a4a).multiplyScalar(0.06 * warmth),
    emissiveMap: map,
  });
  return mat;
}
