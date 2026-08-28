import * as THREE from 'three';
import { GeometryBuilder } from '../../gfx/instancing.js';
import { metalMaterial, emissiveMaterial } from '../../gfx/materials.js';
import * as T from '../../gfx/textures.js';

/**
 * Street furniture, shared by every district (CityGrid.decorateSidewalk).
 *
 * Each builder returns merged geometry slots plus their materials, so a hundred
 * lamps down a street are two draw calls: the ironwork and the glow.
 */

/** Gaslight (London) or cobra-head streetlight (NYC). */
export function lamp({ style = 'gas', glowColor = '#ffb765', height = 3.4 } = {}) {
  return () => {
    const b = new GeometryBuilder();
    b.box('body', [0.34, 0.18, 0.34], [0, 0.09, 0]);          // base
    b.box('body', [0.2, 0.34, 0.2], [0, 0.3, 0]);
    b.box('body', [0.11, height - 0.7, 0.11], [0, height / 2, 0]);

    if (style === 'gas') {
      // Ladder bar and a four-pane lantern with a finial. Unmistakably Victorian.
      b.box('body', [0.62, 0.05, 0.05], [0, height - 0.72, 0]);
      b.box('body', [0.3, 0.06, 0.3], [0, height - 0.44, 0]);
      b.box('glow', [0.26, 0.42, 0.26], [0, height - 0.2, 0]);
      b.box('body', [0.34, 0.06, 0.34], [0, height + 0.03, 0]);
      b.box('body', [0.16, 0.18, 0.16], [0, height + 0.13, 0]);
      b.box('body', [0.05, 0.16, 0.05], [0, height + 0.28, 0]);
    } else {
      // Cobra head: an arm out over the road with a downward lens.
      b.box('body', [0.09, 0.09, 1.5], [0, height, 0.72]);
      b.box('body', [0.3, 0.14, 0.66], [0, height - 0.08, 1.4]);
      b.box('glow', [0.24, 0.06, 0.56], [0, height - 0.17, 1.4]);
    }

    return {
      geometry: b.build(),
      materials: {
        body: metalMaterial(style === 'gas' ? 0x14161a : 0x23262b, { roughness: 0.62, metalness: 0.5 }),
        glow: emissiveMaterial(glowColor, style === 'gas' ? 6.5 : 8.0),
      },
    };
  };
}

/** Park bench: slats and cast-iron ends. */
export function bench({ woodVariant = 1 } = {}) {
  return () => {
    const b = new GeometryBuilder();
    for (let i = 0; i < 4; i++) b.box('wood', [1.7, 0.05, 0.11], [0, 0.44, -0.18 + i * 0.13]);
    for (let i = 0; i < 4; i++) {
      b.box('wood', [1.7, 0.11, 0.05], [0, 0.56 + i * 0.13, -0.26], { rotation: [0.14, 0, 0] });
    }
    for (const sx of [-1, 1]) {
      b.box('body', [0.08, 0.44, 0.6], [sx * 0.8, 0.22, -0.06]);
      b.box('body', [0.08, 0.5, 0.08], [sx * 0.8, 0.68, -0.28]);
    }
    return {
      geometry: b.build(),
      materials: {
        wood: new THREE.MeshStandardMaterial({ map: T.wood(woodVariant), roughness: 0.78 }),
        body: metalMaterial(0x14161a, { roughness: 0.6 }),
      },
    };
  };
}

/** Fire hydrant. Six boxes; instantly says "American street". */
export function hydrant({ color = 0x8c2a20 } = {}) {
  return () => {
    const b = new GeometryBuilder();
    b.box('body', [0.4, 0.06, 0.4], [0, 0.03, 0]);
    b.box('body', [0.24, 0.56, 0.24], [0, 0.32, 0]);
    b.box('body', [0.32, 0.08, 0.32], [0, 0.62, 0]);
    b.box('body', [0.18, 0.14, 0.18], [0, 0.72, 0]);
    b.box('body', [0.34, 0.12, 0.12], [0, 0.44, 0]);
    b.box('body', [0.12, 0.12, 0.28], [0, 0.44, 0]);
    return {
      geometry: b.build(),
      materials: { body: new THREE.MeshStandardMaterial({ color, roughness: 0.62, metalness: 0.24 }) },
    };
  };
}

/** Wire bin (NYC) or iron bin (London). */
export function bin({ style = 'wire' } = {}) {
  return () => {
    const b = new GeometryBuilder();
    if (style === 'wire') {
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        b.box('body', [0.05, 0.78, 0.05], [Math.cos(a) * 0.28, 0.39, Math.sin(a) * 0.28]);
      }
      b.box('body', [0.66, 0.05, 0.66], [0, 0.78, 0]);
      b.box('body', [0.62, 0.04, 0.62], [0, 0.05, 0]);
      b.box('trash', [0.5, 0.16, 0.5], [0, 0.7, 0]);
    } else {
      b.box('body', [0.5, 0.8, 0.5], [0, 0.4, 0]);
      b.box('body', [0.58, 0.07, 0.58], [0, 0.83, 0]);
      b.box('trash', [0.42, 0.1, 0.42], [0, 0.78, 0]);
    }
    return {
      geometry: b.build(),
      materials: {
        body: metalMaterial(0x1c1e22, { roughness: 0.72, metalness: 0.42 }),
        trash: new THREE.MeshStandardMaterial({ color: 0x2a2620, roughness: 0.95 }),
      },
    };
  };
}

/** Manhole cover - the steam source (Task 5.5). */
export function manhole() {
  return () => {
    const b = new GeometryBuilder();
    b.box('body', [1.5, 0.04, 1.5], [0, 0.02, 0]);
    for (let i = 0; i < 4; i++) b.box('body', [1.2, 0.02, 0.09], [0, 0.05, -0.34 + i * 0.22]);
    return {
      geometry: b.build(),
      materials: { body: metalMaterial(0x1a1c1f, { roughness: 0.68, metalness: 0.6 }) },
    };
  };
}

/** Standard dressing tables, per district style. */
export const VICTORIAN_DRESSING = {
  lampHeight: 3.5,
  lamp: lamp({ style: 'gas', glowColor: '#ffb765', height: 3.4 }),
  bench: bench({ woodVariant: 1 }),
  bin: bin({ style: 'iron' }),
  manhole: manhole(),
};

export const MODERN_DRESSING = {
  lampHeight: 5.0,
  lamp: lamp({ style: 'cobra', glowColor: '#ffe3b0', height: 5.0 }),
  bench: bench({ woodVariant: 2 }),
  hydrant: hydrant(),
  bin: bin({ style: 'wire' }),
  manhole: manhole(),
};
