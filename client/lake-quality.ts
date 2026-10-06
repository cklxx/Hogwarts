import * as THREE from 'three';
import type { Water } from 'three/addons/objects/Water.js';

/** Low quality keeps moving water and view uniforms without rendering a mirror pass. */
export function createLakeQuality(lake: Water, mirror: Water['onBeforeRender']) {
  const uniforms = lake.material.uniforms;
  const mirrorTexture = uniforms.mirrorSampler.value as THREE.Texture;
  // Three's Color already contains linear RGB; Water samples this texture directly in linear light.
  const color = uniforms.waterColor.value as THREE.Color;
  const byte = (v: number) => Math.round(THREE.MathUtils.clamp(v, 0, 1) * 255);
  const flat = new THREE.DataTexture(new Uint8Array([byte(color.r), byte(color.g), byte(color.b), 255]), 1, 1, THREE.RGBAFormat);
  flat.colorSpace = THREE.NoColorSpace;
  flat.generateMipmaps = false;
  flat.needsUpdate = true;
  const dispose = () => { flat.dispose(); lake.material.removeEventListener('dispose', dispose); };
  lake.material.addEventListener('dispose', dispose);
  const low: Water['onBeforeRender'] & { lighter?: boolean } = (_renderer, _scene, camera) => {
    (uniforms.eye.value as THREE.Vector3).setFromMatrixPosition(camera.matrixWorld);
  };
  // main.ts's lighterLake must not throttle the cheap camera uniform update.
  low.lighter = true;
  return (q: 'low' | 'high') => {
    uniforms.mirrorSampler.value = q === 'high' ? mirrorTexture : flat;
    // A constant sample needs no projected UVs. Identity guarantees mirrorCoord.w = 1 in low quality,
    // including after a high-quality frame; the original mirror hook restores its projection on high.
    if (q === 'low') (uniforms.textureMatrix.value as THREE.Matrix4).identity();
    lake.onBeforeRender = q === 'high' ? mirror : low;
  };
}
