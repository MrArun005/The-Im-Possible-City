import * as THREE from 'three';
import * as T from '../gfx/textures.js';

/**
 * Shared uniform for point-sprite sizing.
 *
 * `gl_PointSize` is in PIXELS, not world units, so converting a world radius to
 * a pixel radius needs the projection: pixels = worldSize * (viewportHeight /
 * (2 * tan(fov/2))) / distance. Guessing that factor instead of computing it is
 * how 3cm dust motes end up rendering as 270-pixel additive blobs that white
 * out the entire city. main.js keeps this in sync on resize.
 */
export const particleGlobals = {
  uPixelScale: { value: 600 },
};

export function setParticlePixelScale(viewportHeight, fovDegrees) {
  const fov = (fovDegrees * Math.PI) / 180;
  particleGlobals.uPixelScale.value = viewportHeight / (2 * Math.tan(fov / 2));
}

/**
 * GPU particles (Tasks 3.1 / 3.3 / 5.5).
 *
 * All three systems share one idea: the CPU uploads static per-particle seeds
 * once, and the vertex shader derives position from `uTime`. Nothing is written
 * per frame, so 3000 raindrops cost one draw call and no JavaScript.
 */

// --------------------------------------------------------------------- dust

const DUST_VERT = /* glsl */ `
  attribute vec4 aSeed;          // xyz = jitter, w = speed scale
  uniform float uTime;
  uniform float uSize;         // world-space radius, in metres
  uniform float uPixelScale;   // viewportHeight / (2 * tan(fov/2))
  uniform vec3  uMin;
  uniform vec3  uSpan;
  uniform vec3  uDrift;
  varying float vFade;

  void main() {
    // Drift, then wrap inside the box. Motes never leave the shaft.
    vec3 p = position + uDrift * uTime * (0.5 + aSeed.w);
    p += 0.12 * vec3(
      sin(uTime * 0.6 + aSeed.x * 30.0),
      sin(uTime * 0.45 + aSeed.y * 30.0),
      sin(uTime * 0.5 + aSeed.z * 30.0)
    );
    p = uMin + mod(p - uMin, uSpan);

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    float dist = max(-mv.z, 0.05);
    gl_PointSize = clamp(uSize * uPixelScale / dist, 1.0, 24.0);
    // Motes are only visible when lit from the side, so fade with distance and
    // give each one its own brightness.
    vFade = (0.35 + 0.65 * aSeed.x) * clamp(1.0 - dist / 26.0, 0.0, 1.0);
  }
`;

const DUST_FRAG = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vFade;

  void main() {
    vec4 tex = texture2D(uMap, gl_PointCoord);
    gl_FragColor = vec4(uColor, tex.a * vFade * uOpacity);
    if (gl_FragColor.a < 0.005) discard;
  }
`;

export class Dust {
  constructor({ count = 400, bounds, color = '#ffd9a8', size = 0.03, drift, opacity = 0.85 }) {
    const min = bounds.min.clone();
    const span = bounds.max.clone().sub(min);

    const positions = new Float32Array(count * 3);
    const seeds = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = min.x + Math.random() * span.x;
      positions[i * 3 + 1] = min.y + Math.random() * span.y;
      positions[i * 3 + 2] = min.z + Math.random() * span.z;
      seeds[i * 4] = Math.random();
      seeds[i * 4 + 1] = Math.random();
      seeds[i * 4 + 2] = Math.random();
      seeds[i * 4 + 3] = Math.random();
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
    geo.boundingSphere = new THREE.Sphere(
      bounds.getCenter(new THREE.Vector3()),
      span.length()
    );

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uSize: { value: size },
        uPixelScale: particleGlobals.uPixelScale,
        uMin: { value: min },
        uSpan: { value: span },
        uDrift: { value: drift ?? new THREE.Vector3(0.02, 0.03, 0.01) },
        uMap: { value: T.softDot() },
        uColor: { value: new THREE.Color(color) },
        uOpacity: { value: opacity },
      },
      vertexShader: DUST_VERT,
      fragmentShader: DUST_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = true;
    this.points.name = 'dust';
  }

  update(dt, elapsed) { this.material.uniforms.uTime.value = elapsed; }

  dispose() {
    this.points.geometry.dispose();
    this.material.dispose();
    this.points.parent?.remove(this.points);
  }
}

// --------------------------------------------------------------------- rain

/** An instanced quad sheet: `count` camera-facing billboards, one draw call. */
function instancedQuad(w, h, count) {
  const base = new THREE.PlaneGeometry(w, h);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index;
  geo.setAttribute('position', base.attributes.position);
  geo.setAttribute('uv', base.attributes.uv);
  geo.instanceCount = count;
  base.dispose?.();
  return geo;
}

const RAIN_VERT = /* glsl */ `
  attribute vec3 aOrigin;
  attribute vec3 aSeed;     // x = speed, y = phase, z = length
  uniform float uTime;
  uniform float uHeight;
  uniform float uWind;
  varying float vSeed;
  varying vec2 vRainUv;

  void main() {
    float speed = 14.0 + aSeed.x * 12.0;
    float fall = mod(uTime * speed + aSeed.y * uHeight, uHeight);
    vec3 p = aOrigin;
    p.y = uHeight - fall;
    p.x += uWind * fall * 0.06;

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    // Stretch in view space; a streak is just a long billboard.
    mv.x += position.x * (0.6 + aSeed.x * 0.5) + uWind * 0.04 * position.y;
    mv.y += position.y * (0.7 + aSeed.z * 0.9);
    gl_Position = projectionMatrix * mv;
    vSeed = aSeed.z;
    vRainUv = uv;
  }
`;

const RAIN_FRAG = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vSeed;
  varying vec2 vRainUv;
  void main() {
    vec4 tex = texture2D(uMap, vRainUv);
    float a = tex.a * uOpacity * (0.4 + vSeed * 0.6);
    if (a < 0.01) discard;
    gl_FragColor = vec4(uColor, a);
  }
`;

export class Rain {
  constructor({ count = 2500, radius = 26, height = 18, color = '#cfe0f2' }) {
    const geo = instancedQuad(0.03, 0.55, count);
    const origins = new Float32Array(count * 3);
    const seeds = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      // Sqrt keeps the density even instead of clustering at the centre.
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * radius;
      origins[i * 3] = Math.cos(a) * r;
      origins[i * 3 + 1] = 0;
      origins[i * 3 + 2] = Math.sin(a) * r;
      seeds[i * 3] = Math.random();
      seeds[i * 3 + 1] = Math.random();
      seeds[i * 3 + 2] = Math.random();
    }
    geo.setAttribute('aOrigin', new THREE.InstancedBufferAttribute(origins, 3));
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 3));

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uHeight: { value: height },
        uWind: { value: 1.2 },
        uMap: { value: T.rainStreak() },
        uColor: { value: new THREE.Color(color) },
        uOpacity: { value: 0 },
      },
      vertexShader: RAIN_VERT,
      fragmentShader: RAIN_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false; // it follows the camera; culling it is wrong
    this.mesh.name = 'rain';
  }

  /** The rain volume rides with the player so it is never "over there". */
  update(dt, elapsed, cameraPos) {
    this.material.uniforms.uTime.value = elapsed;
    if (cameraPos) {
      this.mesh.position.set(cameraPos.x, 0, cameraPos.z);
    }
  }

  setIntensity(v) { this.material.uniforms.uOpacity.value = v; }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.mesh.parent?.remove(this.mesh);
  }
}

// -------------------------------------------------------------------- steam

const STEAM_VERT = /* glsl */ `
  attribute vec3 aOrigin;
  attribute vec4 aSeed;   // x=phase, y=speed, z=scale, w=drift
  uniform float uTime;
  uniform float uHeight;
  uniform float uSize;
  varying float vLife;
  varying vec2 vSteamUv;

  void main() {
    float life = fract(uTime * (0.06 + aSeed.y * 0.12) + aSeed.x);
    vec3 p = aOrigin;
    p.y += life * uHeight;
    p.x += sin(life * 3.0 + aSeed.x * 12.0) * aSeed.w * 1.4;
    p.z += cos(life * 2.4 + aSeed.x * 9.0) * aSeed.w * 1.1;

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    // Puffs grow as they rise, and billboard in view space.
    float grow = uSize * aSeed.z * (0.35 + life * 2.4);
    mv.xy += position.xy * grow;
    gl_Position = projectionMatrix * mv;
    // Fade in fast, out slow: steam appears suddenly and dissolves.
    vLife = smoothstep(0.0, 0.12, life) * (1.0 - smoothstep(0.35, 1.0, life));
    vSteamUv = uv;
  }
`;

const STEAM_FRAG = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vLife;
  varying vec2 vSteamUv;
  void main() {
    vec4 tex = texture2D(uMap, vSteamUv);
    float a = tex.a * vLife * uOpacity;
    if (a < 0.004) discard;
    gl_FragColor = vec4(uColor, a);
  }
`;

export class Steam {
  /** `sources` is a list of world positions - manholes, vents, chimney pots. */
  constructor({ sources, perSource = 20, height = 5.5, color = '#c9d4dc', size = 0.8, opacity = 0.42 }) {
    const count = sources.length * perSource;
    const geo = instancedQuad(1, 1, count);
    const origins = new Float32Array(count * 3);
    const seeds = new Float32Array(count * 4);
    let i = 0;
    for (const src of sources) {
      for (let k = 0; k < perSource; k++, i++) {
        origins[i * 3] = src[0] + (Math.random() - 0.5) * 0.5;
        origins[i * 3 + 1] = src[1];
        origins[i * 3 + 2] = src[2] + (Math.random() - 0.5) * 0.5;
        seeds[i * 4] = Math.random();
        seeds[i * 4 + 1] = Math.random();
        seeds[i * 4 + 2] = 0.6 + Math.random() * 0.9;
        seeds[i * 4 + 3] = Math.random();
      }
    }
    geo.setAttribute('aOrigin', new THREE.InstancedBufferAttribute(origins, 3));
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uHeight: { value: height },
        uSize: { value: size },
        uMap: { value: T.puff() },
        uColor: { value: new THREE.Color(color) },
        uOpacity: { value: opacity },
      },
      vertexShader: STEAM_VERT,
      fragmentShader: STEAM_FRAG,
      transparent: true,
      depthWrite: false,
    });

    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.name = 'steam';
  }

  update(dt, elapsed) { this.material.uniforms.uTime.value = elapsed; }
  setOpacity(v) { this.material.uniforms.uOpacity.value = v; }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.mesh.parent?.remove(this.mesh);
  }
}
