import * as THREE from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';

/**
 * Open-source texture sets (CC0 ambientCG / Poly Haven, MIT three.js examples — see
 * client/public/textures/CREDITS.md). Every loader returns immediately with a texture that fills in
 * when the image arrives, and falls back to the procedural canvas texture if the file is missing.
 */
const loader = new THREE.TextureLoader();

export function tex(path: string, opts: { srgb?: boolean; repeat?: number; fallback?: THREE.Texture } = {}): THREE.Texture {
  const t = loader.load(`/textures/${path}`, undefined, undefined, () => {
    if (opts.fallback) { t.image = opts.fallback.image as HTMLImageElement; t.needsUpdate = true; }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  if (opts.srgb !== false) t.colorSpace = THREE.SRGBColorSpace;
  if (opts.repeat) t.repeat.set(opts.repeat, opts.repeat);
  return t;
}

/**
 * Two Poly Haven HDRIs for image-based lighting: a bright quarry by day, a moonless golf course by night. Handed
 * over as they are (equirectangular); render.ts pre-filters the one it needs into its environment texture.
 */
export function loadEnvironments(onReady: (day: THREE.Texture, night: THREE.Texture) => void) {
  const hdr = new HDRLoader();
  const out: Record<string, THREE.Texture> = {};
  const done = (k: string, t: THREE.Texture) => {
    t.mapping = THREE.EquirectangularReflectionMapping;
    out[k] = t;
    if (out.day && out.night) onReady(out.day, out.night);
  };
  hdr.load('/hdri/quarry_01_1k.hdr', (t) => done('day', t), undefined, () => {});
  hdr.load('/hdri/moonless_golf_1k.hdr', (t) => done('night', t), undefined, () => {});
}
