/**
 * Deep dispose of a subtree. Streaming districts and interiors in and out is the
 * whole memory strategy, so this has to be thorough and boring.
 */
export function disposeSubtree(root, { keepTextures = new Set() } = {}) {
  if (!root) return;
  const materials = new Set();

  root.traverse((obj) => {
    if (obj.geometry) obj.geometry.dispose();
    const mat = obj.material;
    if (Array.isArray(mat)) mat.forEach((m) => materials.add(m));
    else if (mat) materials.add(mat);
    if (obj.isInstancedMesh) obj.dispose?.();
  });

  for (const mat of materials) {
    for (const key of Object.keys(mat)) {
      const value = mat[key];
      if (value && value.isTexture && !keepTextures.has(value)) value.dispose();
    }
    mat.dispose();
  }

  root.parent?.remove(root);
  root.clear?.();
}

/** Marks an object so `disposeSubtree` skips its shared textures. */
export function shared(texture) {
  texture.userData.shared = true;
  return texture;
}
