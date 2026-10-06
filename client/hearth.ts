import * as THREE from 'three';

/** One atlas for every face of the existing instanced hearth: stone sides, brass-edged rune top.
 * No extra meshes or lights. The caller owns the texture along with the material. */
export function hearthMaterial(geometry: THREE.BoxGeometry) {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size * 2;
  canvas.height = size;
  const g = canvas.getContext('2d')!;
  // Side panel. Broad dressed stone, with a fine joint rather than a noisy grain pattern.
  g.fillStyle = '#a69d89';
  g.fillRect(0, 0, size, size);
  for (let row = 0; row < 3; row++) {
    for (let col = -1; col < 3; col++) {
      const x = col * 128 + (row % 2) * 64;
      g.fillStyle = ['#b8ae98', '#afa58f', '#b4aa94'][(row + col + 3) % 3];
      g.fillRect(x + 1, row * 85 + 1, 126, 83);
    }
  }
  // Top panel: patinated brass outside a dark stone inset. All detail remains within this face.
  g.fillStyle = '#9c804b';
  g.fillRect(size, 0, size, size);
  g.strokeStyle = '#d0b780';
  g.lineWidth = 2;
  g.strokeRect(size + 3, 3, size - 6, size - 6);
  g.fillStyle = '#57594d';
  g.fillRect(size + 9, 9, size - 18, size - 18);
  const cx = size * 1.5, cy = size / 2;
  g.strokeStyle = '#b2ad83';
  g.lineWidth = 2;
  for (const radius of [78, 101]) {
    g.beginPath(); g.arc(cx, cy, radius, 0, Math.PI * 2); g.stroke();
  }
  // Geometric glyphs, not text: readable at game scale without a font or external artwork.
  for (let i = 0; i < 12; i++) {
    g.save(); g.translate(cx, cy); g.rotate(i * Math.PI / 6);
    g.beginPath(); g.moveTo(-5, -85); g.lineTo(0, -95); g.lineTo(5, -85);
    g.moveTo(-5, -89); g.lineTo(5, -89); g.stroke();
    g.restore();
  }
  g.fillStyle = '#3c5142';
  g.beginPath(); g.arc(cx, cy, 55, 0, Math.PI * 2); g.fill();
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  // Inset UVs keep adjacent atlas cells from bleeding through the filtered edge.
  const uv = geometry.getAttribute('uv') as THREE.BufferAttribute;
  for (let face = 0; face < 6; face++) {
    for (let v = 0; v < 4; v++) {
      const i = face * 4 + v, top = face === 2;
      uv.setXY(i, (Number(top) * size + 1 + uv.getX(i) * (size - 2)) / (size * 2), (1 + uv.getY(i) * (size - 2)) / size);
    }
  }
  uv.needsUpdate = true;
  return new THREE.MeshStandardMaterial({ map, roughness: 0.85, metalness: 0.1 });
}
