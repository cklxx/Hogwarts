import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { HOUSE_COLORS, type House } from '../src/shared/constants';
import { AZKABAN, OBSTACLES, mulberry32, type Obstacle } from '../src/shared/map';
import { HALL_BUTTRESS, HALL_BUTTRESSES, HALL_DOOR, HALL_LINTEL, HALL_ROOF, HALL_TABLES, MIRROR, TORCH_POST, TORCH_POSTS, TURRETS, interiorAt } from '../src/shared/layout';
import { tex as fileTex } from './assets';
import { WIND, createGrass } from './grass';
import { setWizardDetail } from './models';
import { SEA_LEVEL, drape, heightAt, makeTerrain } from './terrain';
import { mirrorGuards } from './gpu';
import { StoryStandardMaterial } from './storybook';
import { STORYBOOK, cylUV, glowSprite, makeMaterials, waterNormals, worldUV } from './textures';

const T = TSL as unknown as Record<string, any>;
const { Fn, vec2, vec3, vec4, float, uniform, attribute, texture, reflector, all, select, sin, cos, clamp, max, pow, dot, reflect, normalize, length, mix, add, sub, div,
  positionLocal, positionGeometry, positionWorld, cameraPosition, modelViewProjection, modelWorldMatrix } = T;

/** The wind's clock (seconds), shared by everything that sways. */
const windTime = uniform(0);
const windDir = uniform(WIND);
/** Storybook forest: deep painted greens and a teal. */
const FOREST = [0x2e5a2b, 0x3a6a33, 0x255040, 0x42683a, 0x315f3e, 0x2a4e30, 0x38623a, 0x2f5436];

/** A pointed (Gothic) arch, `w` wide and `h` tall, standing on y = 0. */
function archShape(w: number, h: number, y0 = 0) {
  const s = new THREE.Shape();
  const hw = w / 2, spring = y0 + h - w * 0.85;
  s.moveTo(-hw, y0);
  s.lineTo(hw, y0);
  s.lineTo(hw, spring);
  s.quadraticCurveTo(hw * 0.98, spring + w * 0.62, 0, y0 + h);
  s.quadraticCurveTo(-hw * 0.98, spring + w * 0.62, -hw, spring);
  s.lineTo(-hw, y0);
  return s;
}
function archHole(w: number, h: number, lift = 0) {
  const p = new THREE.Path();
  const hw = w / 2, spring = h - w * 0.85;
  p.moveTo(-hw, lift);
  p.lineTo(-hw, lift + spring);
  p.quadraticCurveTo(-hw * 0.98, lift + spring + w * 0.62, 0, lift + h);
  p.quadraticCurveTo(hw * 0.98, lift + spring + w * 0.62, hw, lift + spring);
  p.lineTo(hw, lift);
  p.lineTo(-hw, lift);
  return p;
}
/** Leaded glass: amber quarries between lead cames, a mullion and a transom. Used as map and emissiveMap. */
function leadedTexture() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#16110a';
  g.fillRect(0, 0, 64, 128);
  for (let y = 0; y < 128; y += 8)
    for (let x = 0; x < 64; x += 8) {
      const k = 0.75 + Math.random() * 0.25;
      g.fillStyle = `rgb(${Math.round(255 * k)},${Math.round(205 * k)},${Math.round(120 * k)})`;
      g.beginPath(); g.moveTo(x + 4, y + 0.5); g.lineTo(x + 7.5, y + 4); g.lineTo(x + 4, y + 7.5); g.lineTo(x + 0.5, y + 4); g.fill();
    }
  g.fillStyle = '#16110a';
  g.fillRect(29, 0, 6, 128);   // mullion
  g.fillRect(0, 74, 64, 5);    // transom
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
/** A clock face: cream dial, Roman numerals, minute ticks, a gold bezel. */
function clockTexture() {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  g.fillStyle = '#b8912e'; g.beginPath(); g.arc(128, 128, 128, 0, 7); g.fill();
  g.fillStyle = '#f3ead2'; g.beginPath(); g.arc(128, 128, 116, 0, 7); g.fill();
  g.strokeStyle = '#2a2014'; g.lineWidth = 2;
  g.beginPath(); g.arc(128, 128, 104, 0, 7); g.stroke();
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * Math.PI * 2, r0 = i % 5 ? 98 : 90;
    g.lineWidth = i % 5 ? 2 : 4;
    g.beginPath(); g.moveTo(128 + Math.sin(a) * r0, 128 - Math.cos(a) * r0); g.lineTo(128 + Math.sin(a) * 104, 128 - Math.cos(a) * 104); g.stroke();
  }
  g.fillStyle = '#2a2014'; g.font = 'bold 22px Georgia'; g.textAlign = 'center'; g.textBaseline = 'middle';
  ['XII', 'I', 'II', 'III', 'IIII', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'].forEach((n, i) => {
    const a = (i / 12) * Math.PI * 2;
    g.fillText(n, 128 + Math.sin(a) * 74, 128 - Math.cos(a) * 74);
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
/** A gable roof over a rectangle (ridge along z): two slate slopes with world-scaled UVs, and the two gable triangles. */
function gableRoof(x0: number, x1: number, z0: number, z1: number, y: number, rise: number) {
  const cx = (x0 + x1) / 2, run = (x1 - x0) / 2, slope = Math.hypot(run, rise);
  const T = 3; // metres per slate texture tile
  const slopes = new THREE.BufferGeometry();
  const top = y + rise;
  slopes.setAttribute('position', new THREE.Float32BufferAttribute([
    x0, y, z1, cx, top, z1, cx, top, z0, x0, y, z1, cx, top, z0, x0, y, z0,
    x1, y, z0, cx, top, z0, cx, top, z1, x1, y, z0, cx, top, z1, x1, y, z1,
  ], 3));
  const L = (z1 - z0) / T, H = slope / T;
  slopes.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 0, H, L, H, 0, 0, L, H, L, 0, 0, 0, 0, H, L, H, 0, 0, L, H, L, 0], 2));
  slopes.computeVertexNormals();
  const gables = new THREE.BufferGeometry();
  gables.setAttribute('position', new THREE.Float32BufferAttribute([x0, y, z1, x1, y, z1, cx, top, z1, x1, y, z0, x0, y, z0, cx, top, z0], 3));
  gables.setAttribute('uv', new THREE.Float32BufferAttribute([x0 / 4, y / 4, x1 / 4, y / 4, cx / 4, top / 4, x1 / 4, y / 4, x0 / 4, y / 4, cx / 4, top / 4], 2));
  gables.computeVertexNormals();
  return { slopes, gables };
}
/** A pennant: a long tapering triangle along +x from the pole, subdivided so it can ripple. */
function pennantGeometry() {
  const g = new THREE.PlaneGeometry(1, 1, 10, 1);
  g.translate(0.5, 0, 0);
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) p.setY(i, p.getY(i) * (1 - p.getX(i) * 0.92));
  g.computeVertexNormals();
  return g;
}

/**
 * Ink for outlines: a dark plum, which the fog fades into the distance. A hull the camera is inside
 * (the camera does not collide with walls) is dropped, or its back faces would black out the view.
 */
const INK = new THREE.MeshBasicNodeMaterial({ color: 0x24161e, side: THREE.BackSide });
{
  const inside = all(cameraPosition.greaterThan(attribute('aBoxMin', 'vec3'))).and(all(cameraPosition.lessThan(attribute('aBoxMax', 'vec3'))));
  INK.vertexNode = select(inside, vec4(2, 2, 2, 1), modelViewProjection); // (outside the clip volume: dropped)
}
/**
 * A storybook ink outline for static, convex-ish buildings (boxes, towers, cones): each mesh's own
 * geometry grown by `t` metres about its centre and baked into world space, all merged into ONE mesh
 * drawn back faces only. Where a silhouette meets the sky or another wall, the rim of the hull shows
 * as a line; everywhere else the building itself hides it.
 */
function inkHull(meshes: THREE.Mesh[], t = 0.14) {
  const bb = new THREE.Box3(), size = new THREE.Vector3(), c = new THREE.Vector3(), ws = new THREE.Vector3();
  const m = new THREE.Matrix4(), tmp = new THREE.Matrix4();
  const geos = meshes.map((mesh) => {
    mesh.updateWorldMatrix(true, false);
    const g = mesh.geometry;
    if (!g.boundingBox) g.computeBoundingBox();
    bb.copy(g.boundingBox!).getSize(size);
    bb.getCenter(c);
    ws.setFromMatrixScale(mesh.matrixWorld);
    const k = (scale: number, w: number) => (w * scale > 1e-3 ? 1 + (2 * t) / (w * scale) : 1);
    m.makeTranslation(c.x, c.y, c.z)
      .multiply(tmp.makeScale(k(ws.x, size.x), k(ws.y, size.y), k(ws.z, size.z)))
      .multiply(tmp.makeTranslation(-c.x, -c.y, -c.z))
      .premultiply(mesh.matrixWorld);
    const x = new THREE.BufferGeometry();
    x.setAttribute('position', g.getAttribute('position').clone());
    if (g.index) x.setIndex(g.index.clone());
    const out = (x.index ? x.toNonIndexed() : x).applyMatrix4(m);
    out.computeBoundingBox();
    const n = out.getAttribute('position').count, lo = out.boundingBox!.min, hi = out.boundingBox!.max;
    const a = new Float32Array(n * 3), b = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { a.set([lo.x, lo.y, lo.z], i * 3); b.set([hi.x, hi.y, hi.z], i * 3); }
    out.setAttribute('aBoxMin', new THREE.BufferAttribute(a, 3));
    out.setAttribute('aBoxMax', new THREE.BufferAttribute(b, 3));
    return out;
  });
  const hull = new THREE.Mesh(mergeGeometries(geos)!, INK);
  hull.name = 'ink';
  hull.matrixAutoUpdate = false;
  return hull;
}

/**
 * The Black Lake: three.js's Water shader (examples/jsm/objects/Water.js) in TSL. Four scrolling samples of
 * a normal map ripple the surface; the sky and the shore are reflected by a mirror render of the scene
 * (three.js ReflectorNode, half the screen's resolution), distorted by the ripples; a Fresnel term mixes the
 * reflection with the water's own colour and the sun's glitter.
 */
function waterMaterial(normals: THREE.Texture, sunColorHex: number, waterColorHex: number, distortion: number) {
  normals.wrapS = normals.wrapT = THREE.RepeatWrapping;
  const time = uniform(0), sunDirection = uniform(new THREE.Vector3(0.5, 0.8, 0.2));
  const sunColor = uniform(new THREE.Color(sunColorHex)), waterColor = uniform(new THREE.Color(waterColorHex)), distortionScale = uniform(distortion);
  // (multisampled like the scene pass: the same render-target format and sample count means the mirror's render
  // reuses the scene pass's pipelines instead of compiling every material a second time on first sight of the lake)
  const mirror = reflector({ resolutionScale: 0.5, samples: 4 });
  const mirrorUV = mirror.uvNode;
  // (and with a stencil, like the scene pass: the world's materials write it for view.ts's x-ray, and a pipeline
  // with stencil state must draw into a target that has one)
  {
    const refl = mirror.reflector as { getRenderTarget(c: THREE.Camera): THREE.RenderTarget };
    const get = refl.getRenderTarget.bind(refl);
    refl.getRenderTarget = (c) => { const rt = get(c); rt.stencilBuffer = true; return rt; };
  }
  const noise = Fn(([uv]: any[]) => {
    const uv0 = div(uv, 103).add(vec2(div(time, 17), div(time, 29)));
    const uv1 = div(uv, 107).sub(vec2(div(time, -19), div(time, 31)));
    const uv2 = div(uv, vec2(8907, 9803)).add(vec2(div(time, 101), div(time, 97)));
    const uv3 = div(uv, vec2(1091, 1027)).sub(vec2(div(time, 109), div(time, -113)));
    return add(texture(normals, uv0), texture(normals, uv1), texture(normals, uv2), texture(normals, uv3)).mul(0.5).sub(1);
  });
  const material = new THREE.MeshBasicNodeMaterial({ fog: true });
  material.userData.noFade = true;
  material.colorNode = Fn(() => {
    const n = noise(positionWorld.xz);
    const surfaceNormal = normalize(n.xzy.mul(vec3(1.5, 1, 1.5)));
    const worldToEye = cameraPosition.sub(positionWorld);
    const eye = normalize(worldToEye);
    const reflection = normalize(reflect(sunDirection.negate(), surfaceNormal));
    const specular = pow(max(0, dot(eye, reflection)), 100).mul(sunColor).mul(2);
    const diffuse = max(dot(sunDirection, surfaceNormal), 0).mul(sunColor).mul(0.5);
    const d = surfaceNormal.xz.mul(float(0.001).add(float(1).div(length(worldToEye)))).mul(distortionScale);
    mirror.uvNode = mirrorUV.add(d); // (idempotent: the colour graph may be built more than once)
    const theta = max(dot(eye, surfaceNormal), 0);
    const reflectance = pow(sub(1, theta), 5).mul(0.98).add(0.02);
    const scatter = max(0, dot(surfaceNormal, eye)).mul(waterColor);
    // (the old shader also darkened the water's own colour in the sun's shadow; nothing near the lake casts one)
    return vec4(mix(sunColor.mul(diffuse).mul(0.3).add(scatter), mirror.rgb.add(specular), reflectance), 1);
  })();
  return { material, mirror, time, sunDirection };
}

export interface WorldScene {
  /** The terrain mesh, for aiming. */
  ground: THREE.Mesh;
  /** Emissive materials that should brighten at night (windows, candles). */
  nightGlow: THREE.MeshStandardMaterial[];
  /** Points where house banners hang: position + facing yaw. */
  bannerSpots: { x: number; y: number; z: number; yaw: number }[];
  /**
   * The Black Lake's mirror: `wrap` lets the caller run code around each mirror render (and skip it, by not
   * calling `render`), e.g. to leave things out of the reflection or refresh it less often.
   */
  lake: { mesh: THREE.Mesh; wrap(f: (render: () => void) => void): void } | null;
  /** The grass field (grass.ts): what it holds, for the ?perf=1 probe. */
  grass: { kind: string; budget: number };
  /** Chimney tops (Hogsmeade, Hagrid's hut) for the smoke particles. */
  chimneys: THREE.Vector3[];
  /**
   * Per-frame animation. `env.hour` drives the Clock Tower hands, `env.banner` the pennant colour,
   * `env.focus` (the player) re-centres the grass and hides the Great Hall roof from inside.
   */
  tick(t: number, dt: number, willowAngry: boolean, sunDir: THREE.Vector3, env?: { hour?: number; banner?: House | null; focus?: THREE.Vector3 }): void;
  setQuality(q: 'low' | 'high'): void;
}

/** Builds the static world from the shared map: the same data the server collides against. */
export function buildWorld(scene: THREE.Scene): WorldScene {
  const M = makeMaterials();
  const nightGlow: THREE.MeshStandardMaterial[] = [];
  const glowMat = (color: number) => {
    const m = new THREE.MeshStandardMaterial({ color: 0x221a10, emissive: color, emissiveIntensity: 1 });
    nightGlow.push(m);
    return m;
  };
  const leadTex = leadedTexture();
  const windowMat = glowMat(0xffc46b);
  windowMat.color.set(0x5a5a66);
  windowMat.map = leadTex;
  windowMat.emissiveMap = leadTex;
  windowMat.roughness = 0.2;
  windowMat.metalness = 0.3;
  const candleMat = glowMat(0xfff1c4);
  // tree crowns sway in the wind (more at the top), each tree with its own phase. The lean is worked out in
  // world space: every crown bends downwind, whatever its yaw and scale, and bigger crowns move further.
  // The forest's crowns are instanced: three.js has placed the vertex in the world by the time positionNode
  // runs, and each instance carries its tree's position and width in `aTree`; the Willow's single crown
  // (not rotated or scaled) reads them from its model matrix.
  const lean = Fn(([treeX, treeZ, width]: any[]) => {
    const lift = clamp(positionGeometry.y.add(0.5), 0, 1);
    const sw = sin(windTime.mul(1.1).add(treeX.mul(0.13)).add(treeZ.mul(0.07))).mul(0.7).add(sin(windTime.mul(2.3).add(treeZ.mul(0.21))).mul(0.3));
    return vec3(windDir.x, 0, windDir.y).mul(sw.add(0.35).mul(0.045).mul(lift.mul(lift)).mul(width));
  });
  const leafMat = (instanced: boolean) => {
    const m = new StoryStandardMaterial({ color: STORYBOOK ? 0xffffff : 0x2a4a26, roughness: 1, flatShading: true });
    if (instanced) { const t = attribute('aTree', 'vec3'); m.positionNode = positionLocal.add(lean(t.x, t.y, t.z)); }
    else { const w = modelWorldMatrix.element(3); m.positionNode = positionLocal.add(lean(w.x, w.z, float(1))); }
    return m;
  };
  const leaf = leafMat(true);
  const trunk = new THREE.MeshStandardMaterial({ color: STORYBOOK ? 0x4a3020 : 0x3d2b1a, roughness: 1 });
  const gold = new THREE.MeshStandardMaterial({ color: 0xd4af37, metalness: 0.9, roughness: 0.3 });
  const rock = M.rock;
  const marble = new THREE.MeshStandardMaterial({ color: 0xf4f4f0, roughness: 0.25 });
  const add = <T extends THREE.Object3D>(o: T, shadow = true) => {
    if (shadow) o.traverse((c) => { if ((c as THREE.Mesh).isMesh) { c.castShadow = true; c.receiveShadow = true; } });
    scene.add(o);
    return o;
  };
  /** Buildings that get an ink outline (storybook, 'high' only; see inkHull). */
  const inked: THREE.Mesh[] = [];
  const ink = <T extends THREE.Object3D>(o: T) => {
    if (STORYBOOK) o.traverse((c) => { if ((c as THREE.Mesh).isMesh) inked.push(c as THREE.Mesh); });
    return o;
  };

  // ---- terrain: rolling grounds, a lake basin, and the Highlands (flat wherever something is built)
  const terrain = makeTerrain(M.grass, M.rock);
  scene.add(terrain.group);
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), new THREE.MeshStandardMaterial(STORYBOOK ? { color: 0x1f4a63, roughness: 0.35, metalness: 0.1 } : { color: 0x0f1f2c, roughness: 0.12, metalness: 0.35 }));
  sea.rotation.x = -Math.PI / 2;
  sea.position.y = SEA_LEVEL;
  scene.add(sea);

  // ---- paths and courtyard (cobbles, world-scaled)
  const road = (x0: number, z0: number, x1: number, z1: number, w = 4) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const geo = new THREE.PlaneGeometry(w, len, 1, Math.ceil(len / 3));
    const uv = geo.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * w) / 3, (uv.getY(i) * len) / 3);
    geo.rotateX(-Math.PI / 2);
    geo.rotateY(Math.atan2(x1 - x0, z1 - z0) + Math.PI); // local -z (the strip) now points from (x0,z0) to (x1,z1)
    geo.translate((x0 + x1) / 2, 0, (z0 + z1) / 2);
    const m = new THREE.Mesh(drape(geo, 0.05), M.path);
    m.receiveShadow = true;
    scene.add(m);
  };
  road(0, -40, 0, 150, 5);
  road(0, -10, 90, 36, 3);
  road(20, -60, 40, -122, 3);
  road(-10, -5, -52, 26, 2.5);
  const courtGeo = new THREE.PlaneGeometry(50, 36);
  courtGeo.getAttribute('uv').array.forEach((_, i, a) => { (a as Float32Array)[i] *= i % 2 ? 9 : 12.5; });
  const court = new THREE.Mesh(courtGeo, M.flagstone);
  court.rotation.x = -Math.PI / 2;
  court.position.set(0, 0.03, -22);
  court.receiveShadow = true;
  scene.add(court);
  const hallFloor = new THREE.Mesh(worldUV(new THREE.BoxGeometry(24, 0.1, 31), 24, 0.1, 31, 3), M.wood);
  hallFloor.position.set(0, 0.05, -56.5);
  hallFloor.receiveShadow = true;
  scene.add(hallFloor);

  const isle = new THREE.Mesh(new THREE.CylinderGeometry(14, 18, 1.4, 9), rock);
  isle.position.set(AZKABAN.x, 0, AZKABAN.z);
  scene.add(isle);

  const bannerSpots: WorldScene['bannerSpots'] = [];
  let lakeMesh: THREE.Mesh | null = null;
  let water: ReturnType<typeof waterMaterial> | null = null;
  const trees: Obstacle[] = [];
  const chimneys: THREE.Vector3[] = [];
  /** Arch windows to instance: sill centre, outward yaw, width, height. */
  const windows: { x: number; y: number; z: number; yaw: number; w: number; h: number }[] = [];
  /** Pennants: pole top and length. */
  const pennants: { x: number; y: number; z: number; len: number }[] = [];
  const clockFaces: { x: number; y: number; z: number; r: number; yaw: number }[] = [];

  for (const o of OBSTACLES) {
    if (o.style === 'tree') { trees.push(o); continue; }
    if (o.kind === 'box') {
      const w = o.x1 - o.x0, d = o.z1 - o.z0;
      const cx = (o.x0 + o.x1) / 2, cz = (o.z0 + o.z1) / 2;
      const isHouse = o.style === 'house';
      const isGlass = o.label === 'Greenhouse Three';
      // plain alpha-blended glass: a `transmission` material makes three.js re-render every opaque object
      // (castle, grass, wizards) into a transmission target on each frame the greenhouse is on screen
      const mat = isGlass
        ? new THREE.MeshStandardMaterial({ color: 0xcfeede, roughness: 0.06, metalness: 0.15, transparent: true, opacity: 0.42 })
        : isHouse ? M.tudor : o.style === 'wood' ? M.wood : M.stone;
      const b = add(new THREE.Mesh(worldUV(new THREE.BoxGeometry(w, o.h, d), w, o.h, d, isHouse ? 5 : 4), mat));
      b.position.set(cx, o.h / 2, cz);
      if (!isGlass) ink(b);
      if (isHouse || o.style === 'wood') {
        const roof = ink(add(new THREE.Mesh(new THREE.ConeGeometry(Math.max(w, d) * 0.72, o.h * 0.7, 4), M.roof)));
        roof.position.set(cx, o.h + o.h * 0.35, cz);
        roof.rotation.y = Math.PI / 4;
        roof.scale.set(w / Math.max(w, d), 1, d / Math.max(w, d));
        if (isHouse && !isGlass) {
          const chimney = add(new THREE.Mesh(worldUV(new THREE.BoxGeometry(1.2, 4, 1.2), 1.2, 4, 1.2, 2), M.darkStone));
          chimney.position.set(o.x1 - 2, o.h + 2.5, o.z0 + 2);
          chimneys.push(new THREE.Vector3(o.x1 - 2, o.h + 4.6, o.z0 + 2));
        }
      } else if (o.h > 15) {
        // battlements
        const n = Math.floor(w / 3);
        const merlon = new THREE.BoxGeometry(1.4, 1.6, 1.4);
        const merlons = new THREE.InstancedMesh(merlon, M.darkStone, (n + 1) * 2);
        const m4 = new THREE.Matrix4();
        let k = 0;
        for (let i = 0; i <= n; i++) for (const zz of [o.z0, o.z1]) { m4.setPosition(o.x0 + (i * w) / Math.max(1, n), o.h + 0.8, zz); merlons.setMatrixAt(k++, m4); }
        merlons.castShadow = true;
        scene.add(merlons);
        // merlons on the short sides too
        const nd = Math.floor(d / 3);
        const side = new THREE.InstancedMesh(merlon, M.darkStone, (nd + 1) * 2);
        k = 0;
        for (let i = 0; i <= nd; i++) for (const xx of [o.x0, o.x1]) { m4.setPosition(xx, o.h + 0.8, o.z0 + (i * d) / Math.max(1, nd)); side.setMatrixAt(k++, m4); }
        side.castShadow = true;
        scene.add(side);
        // pointed-arch glowing windows on every face (banners hang in the top row of the south face)
        for (let i = 1; i < n; i += 2)
          for (let y = 3; y < o.h - 3; y += 5) {
            const x = o.x0 + (i * w) / n;
            const underBanner = y > o.h - 9 && (Math.abs(x - cx + w * 0.25) < 1.8 || Math.abs(x - cx - w * 0.25) < 1.8);
            if (!underBanner) windows.push({ x, y, z: o.z1, yaw: 0, w: 1.1, h: 2.4 });
            windows.push({ x, y, z: o.z0, yaw: Math.PI, w: 1.1, h: 2.4 });
          }
        const nz = Math.floor(d / 6);
        for (let i = 1; i < nz; i++)
          for (let y = 3; y < o.h - 3; y += 5) {
            const z = o.z0 + (i * d) / nz;
            windows.push({ x: o.x1, y, z, yaw: Math.PI / 2, w: 1.1, h: 2.4 }, { x: o.x0, y, z, yaw: -Math.PI / 2, w: 1.1, h: 2.4 });
          }
        bannerSpots.push({ x: cx - w * 0.25, y: o.h - 3, z: o.z1 + 0.12, yaw: 0 }, { x: cx + w * 0.25, y: o.h - 3, z: o.z1 + 0.12, yaw: 0 });
      } else if (o.h === 14 && d > 20) {
        // the Great Hall's long walls: tall lancet windows seen from outside and in
        const west = o.x0 < 0;
        const face = west ? o.x0 : o.x1, inner = west ? o.x1 : o.x0, out = west ? -1 : 1;
        for (let z = o.z0 + 4; z < o.z1 - 2; z += 4.6)
          windows.push({ x: face, y: 3.5, z, yaw: (out * Math.PI) / 2, w: 1.7, h: 7.5 }, { x: inner, y: 3.5, z, yaw: (-out * Math.PI) / 2, w: 1.7, h: 7.5 });
      }
      continue;
    }
    switch (o.style) {
      case 'water': {
        const geo = new THREE.CircleGeometry(o.r, 64);
        const shoreGeo = new THREE.RingGeometry(o.r - 3, o.r + 7, 96, 3);
        shoreGeo.rotateX(-Math.PI / 2);
        shoreGeo.translate(o.x, 0, o.z);
        const shore = new THREE.Mesh(drape(shoreGeo, 0.06), M.sand);
        shore.receiveShadow = true;
        scene.add(shore);
        const normals = STORYBOOK ? waterNormals() : fileTex('water_normal.webp', { srgb: false, fallback: waterNormals() });
        water = waterMaterial(normals, STORYBOOK ? 0xffe0b0 : 0xfff1d6, STORYBOOK ? 0x1a4f60 : 0x0c2a3a, STORYBOOK ? 1.4 : 2.2);
        lakeMesh = new THREE.Mesh(geo, water.material);
        lakeMesh.rotation.x = -Math.PI / 2;
        lakeMesh.position.set(o.x, 0.08, o.z);
        lakeMesh.add(water.mirror.target); // (the mirror plane: the lake's own, facing +z before the rotation)
        scene.add(lakeMesh);
        const squid = new THREE.Group();
        const tent = new THREE.MeshStandardMaterial({ color: 0x6b3b5a, roughness: 0.4 });
        for (let i = 0; i < 6; i++) {
          const t = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.5, 5, 6), tent);
          t.position.set(Math.cos(i) * 2, 1.5, Math.sin(i) * 2);
          t.rotation.z = 0.5 * Math.cos(i * 2);
          squid.add(t);
        }
        squid.position.set(o.x - 10, 0, o.z + 8);
        squid.name = 'squid';
        scene.add(squid);
        break;
      }
      case 'tower': {
        const t = ink(add(new THREE.Mesh(cylUV(new THREE.CylinderGeometry(o.r, o.r * 1.06, o.h, 24, 1, true), o.r, o.h, 4), M.stone)));
        t.position.set(o.x, o.h / 2, o.z);
        const roof = ink(add(new THREE.Mesh(new THREE.ConeGeometry(o.r * 1.3, o.r * 2.8, 24), M.roof)));
        roof.position.set(o.x, o.h + o.r * 1.4, o.z);
        const spire = add(new THREE.Mesh(new THREE.ConeGeometry(0.12, 2.5, 6), gold), false);
        spire.position.set(o.x, o.h + o.r * 2.8 + 1, o.z);
        pennants.push({ x: o.x, y: o.h + o.r * 2.8 + 3.2, z: o.z, len: 2.6 + o.r * 0.45 });
        // a string course of dark stone under the eaves: a crisp line in the silhouette
        const course = add(new THREE.Mesh(new THREE.TorusGeometry(o.r * 1.04, 0.32, 5, 28), M.darkStone));
        course.rotation.x = Math.PI / 2;
        course.position.set(o.x, o.h - 0.4, o.z);
        const isClock = o.label === 'Clock Tower';
        for (let y = 5; y < o.h - 3; y += 7)
          for (const a of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
            if (isClock && y > o.h - 11 && (a === 0 || a === -Math.PI / 2)) continue; // the clock faces go here
            if (o.h > 30 && a === 0 && y > o.h - 14) continue; // the banner
            windows.push({ x: o.x + Math.sin(a) * o.r, y, z: o.z + Math.cos(a) * o.r, yaw: a, w: 1, h: 2.2 });
          }
        if (isClock) for (const a of [0, -Math.PI / 2]) clockFaces.push({ x: o.x, y: o.h - 5.5, z: o.z, r: o.r, yaw: a });
        if (o.h > 30) bannerSpots.push({ x: o.x, y: o.h - 6, z: o.z + o.r + 0.2, yaw: 0 });
        break;
      }
      case 'willow': {
        const g = new THREE.Group();
        const tr = new THREE.Mesh(new THREE.CylinderGeometry(1.2, o.r, o.h * 0.6, 9), trunk);
        tr.position.y = o.h * 0.3;
        g.add(tr);
        const arms = new THREE.Group();
        arms.name = 'arms';
        for (let i = 0; i < 9; i++) {
          const b = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.4, 7.5, 5), trunk);
          b.position.set(Math.cos(i * 0.7) * 3, 0, Math.sin(i * 0.7) * 3);
          b.rotation.set(Math.sin(i) * 0.9, 0, Math.cos(i) * 0.9);
          arms.add(b);
        }
        arms.position.y = o.h * 0.6;
        g.add(arms);
        // (storybook: the forest's leaf material is white, tinted per instance; the willow has its own green)
        const willowLeaf = leafMat(false);
        if (STORYBOOK) willowLeaf.color.set(0x4f7a3a);
        const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(4.2, 1), willowLeaf);
        crown.position.y = o.h * 0.78;
        g.add(crown);
        g.position.set(o.x, 0, o.z);
        g.name = 'willow';
        add(g);
        break;
      }
      case 'tomb': {
        const t = add(new THREE.Mesh(new THREE.BoxGeometry(o.r * 2.2, o.h, o.r * 1.3), marble));
        t.position.set(o.x, o.h / 2, o.z);
        break;
      }
      case 'wood': {
        const hut = ink(add(new THREE.Mesh(cylUV(new THREE.CylinderGeometry(o.r, o.r, o.h * 0.6, 12), o.r, o.h * 0.6, 3), M.wood)));
        hut.position.set(o.x, o.h * 0.3, o.z);
        const roof = ink(add(new THREE.Mesh(new THREE.ConeGeometry(o.r * 1.35, o.h * 0.65, 12), M.roof)));
        roof.position.set(o.x, o.h * 0.92, o.z);
        const lamp = new THREE.PointLight(0xffb060, 6, 14, 1.6);
        lamp.position.set(o.x, 2.5, o.z + o.r + 0.8);
        scene.add(lamp);
        const ch = add(new THREE.Mesh(worldUV(new THREE.BoxGeometry(1.1, o.h * 0.62, 1.1), 1.1, o.h * 0.62, 1.1, 2), M.darkStone));
        ch.position.set(o.x + o.r * 0.5, o.h * 0.74, o.z - o.r * 0.25);
        chimneys.push(new THREE.Vector3(o.x + o.r * 0.5, o.h * 1.05 + 0.15, o.z - o.r * 0.25));
        break;
      }
      case 'hoop': {
        const pole = add(new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.25, o.h, 8), gold));
        pole.position.set(o.x, o.h / 2, o.z);
        const ring = add(new THREE.Mesh(new THREE.TorusGeometry(1.6, 0.18, 8, 24), gold));
        ring.position.set(o.x, o.h + 1.6, o.z);
        break;
      }
      case 'rock': {
        const r = add(new THREE.Mesh(new THREE.CylinderGeometry(o.r * 2, o.r * 4, o.h, 6), rock));
        r.position.set(o.x, o.h / 2, o.z);
        break;
      }
      default: {
        const c = ink(add(new THREE.Mesh(cylUV(new THREE.CylinderGeometry(o.r, o.r * 1.1, o.h, 12), o.r, o.h, 3), M.stone)));
        c.position.set(o.x, o.h / 2, o.z);
        const cap = ink(add(new THREE.Mesh(new THREE.BoxGeometry(o.r * 2.6, 0.5, o.r * 2.6), M.darkStone)));
        cap.position.set(o.x, o.h + 0.25, o.z);
      }
    }
  }

  // ---- castle detail: the Great Hall's roof, buttresses, turrets, pennants, clock faces, arched windows
  const Y = new THREE.Vector3(0, 1, 0);
  // the Great Hall: a steep slate roof between stone gables, a flèche on the ridge, a rose window over the door.
  // Its ceiling is bewitched to look like the sky, so the roof is hidden while you are inside.
  const hallRoof = new THREE.Group();
  {
    const { slopes, gables } = gableRoof(HALL_ROOF.x0, HALL_ROOF.x1, HALL_ROOF.z0, HALL_ROOF.z1, HALL_ROOF.y, HALL_ROOF.rise);
    const ridge = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.45, 33.2), M.darkStone);
    ridge.position.set(0, 24, -56);
    const lantern = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.3, 3, 8), M.darkStone);
    lantern.position.set(0, 25, -56);
    const fleche = new THREE.Mesh(new THREE.ConeGeometry(1.25, 8, 8), M.roof);
    fleche.position.set(0, 30.5, -56);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.1, 1.6, 6), gold);
    tip.position.set(0, 35.2, -56);
    const rose = new THREE.Mesh(new THREE.CircleGeometry(2.3, 32), windowMat);
    rose.position.set(0, 18.4, -39.32);
    const roseRim = new THREE.Mesh(new THREE.TorusGeometry(2.45, 0.28, 6, 32), M.darkStone);
    roseRim.position.copy(rose.position);
    const slopeMesh = new THREE.Mesh(slopes, M.roof);
    hallRoof.add(slopeMesh, new THREE.Mesh(gables, M.stone), ridge, lantern, fleche, tip, rose, roseRim);
    add(hallRoof);
    if (STORYBOOK) hallRoof.add(inkHull([slopeMesh, lantern, fleche]));
    pennants.push({ x: 0, y: 37, z: -56, len: 3.2 });
    // a lintel over the doors turns the full-height slot into a doorway
    const LT = HALL_LINTEL;
    const lintel = add(new THREE.Mesh(worldUV(new THREE.BoxGeometry(LT.w, LT.h, LT.d), LT.w, LT.h, LT.d, 4), M.stone));
    lintel.position.set(LT.x, LT.y, LT.z);
    const D = HALL_DOOR;
    const doorArch = add(new THREE.Mesh(new THREE.ExtrudeGeometry((() => { const sh = archShape(D.outer, D.h, -0.2); sh.holes.push(archHole(D.hole, D.holeH)); return sh; })(), { depth: D.depth, bevelEnabled: false, curveSegments: 10 }), M.darkStone));
    doorArch.position.set(D.x, 0, D.z);
    // buttresses with pinnacles along both long walls
    const B = HALL_BUTTRESS;
    const butGeo = worldUV(new THREE.BoxGeometry(B.w, B.h, B.d), B.w, B.h, B.d, 4);
    const pinGeo = new THREE.ConeGeometry(0.42, 3.4, 6);
    const butI = new THREE.InstancedMesh(butGeo, M.stone, HALL_BUTTRESSES.length);
    const pinI = new THREE.InstancedMesh(pinGeo, M.darkStone, HALL_BUTTRESSES.length);
    const mm = new THREE.Matrix4();
    HALL_BUTTRESSES.forEach(({ x, z }, i) => {
      butI.setMatrixAt(i, mm.makeTranslation(x, 6.6, z));
      pinI.setMatrixAt(i, mm.makeTranslation(x, 14.9, z));
    });
    butI.castShadow = pinI.castShadow = true;
    butI.receiveShadow = true;
    scene.add(butI, pinI);
  }
  // corner turrets on the keep and where the wings meet the Great Hall, each with a pennant
  const turret = (x: number, z: number, H: number, r = 1.9) => {
    const g = new THREE.Group();
    const corbel = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.3, 3.2, 16), M.darkStone);
    corbel.position.y = H - 4.6;
    const shaft = new THREE.Mesh(cylUV(new THREE.CylinderGeometry(r, r, 7, 16, 1, true), r, 7, 4), M.stone);
    shaft.position.y = H;
    const cap = new THREE.Mesh(new THREE.TorusGeometry(r * 1.03, 0.2, 4, 18), M.darkStone);
    cap.rotation.x = Math.PI / 2;
    cap.position.y = H + 3.5;
    const roof = new THREE.Mesh(new THREE.ConeGeometry(r * 1.32, r * 3.4, 16), M.roof);
    roof.position.y = H + 3.5 + r * 1.7;
    const fin = new THREE.Mesh(new THREE.ConeGeometry(0.08, 1.4, 6), gold);
    fin.position.y = H + 3.5 + r * 3.4 + 0.5;
    g.add(corbel, shaft, cap, roof, fin);
    g.position.set(x, 0, z);
    add(g);
    ink(shaft); ink(roof); ink(corbel);
    pennants.push({ x, y: H + 3.5 + r * 3.4 + 2, z, len: 2.4 });
    const yaw = Math.atan2(x, z + 88);
    windows.push({ x: x + Math.sin(yaw) * r, y: H - 1.2, z: z + Math.cos(yaw) * r, yaw, w: 0.7, h: 1.5 });
  };
  for (const t of TURRETS) turret(t.x, t.z, t.H, t.r);

  // Clock Tower faces: a stone stage with a cream dial whose hands show the in-game hour
  const hourHands: THREE.Object3D[] = [], minuteHands: THREE.Object3D[] = [];
  {
    const dialTex = clockTexture();
    const dial = new THREE.MeshStandardMaterial({ map: dialTex, emissiveMap: dialTex, emissive: 0x9a7a4a, roughness: 0.5 });
    nightGlow.push(dial);
    const iron = new THREE.MeshStandardMaterial({ color: 0x15110d, metalness: 0.6, roughness: 0.4 });
    const hourGeo = new THREE.BoxGeometry(0.18, 1.35, 0.06); hourGeo.translate(0, 0.5, 0);
    const minGeo = new THREE.BoxGeometry(0.11, 1.95, 0.06); minGeo.translate(0, 0.78, 0);
    for (const c of clockFaces) {
      const g = new THREE.Group();
      g.position.set(c.x, c.y, c.z);
      g.rotation.y = c.yaw;
      const stage = new THREE.Mesh(worldUV(new THREE.BoxGeometry(5.6, 5.6, 1.5), 5.6, 5.6, 1.5, 4), M.stone);
      stage.position.z = c.r - 0.35;
      const ledge = new THREE.Mesh(new THREE.BoxGeometry(6.2, 0.45, 2), M.darkStone);
      ledge.position.set(0, 3, c.r - 0.3);
      const hood = new THREE.Mesh(new THREE.ConeGeometry(4.3, 2.2, 4, 1), M.roof);
      hood.rotation.y = Math.PI / 4;
      hood.scale.set(1, 1, 0.35);
      hood.position.set(0, 4.3, c.r - 0.3);
      const face = new THREE.Mesh(new THREE.CircleGeometry(2.35, 48), dial);
      face.position.z = c.r + 0.41;
      const h = new THREE.Mesh(hourGeo, iron), m = new THREE.Mesh(minGeo, iron);
      h.position.z = c.r + 0.46;
      m.position.z = c.r + 0.52;
      hourHands.push(h);
      minuteHands.push(m);
      g.add(stage, ledge, hood, face, h, m);
      add(g);
    }
  }

  // pennants: one instanced mesh; the colour follows the House Cup banner, the cloth ripples downwind
  const penMat = new StoryStandardMaterial({ color: 0x6a36a8, side: THREE.DoubleSide, roughness: 0.8 });
  // the ripple is a displacement in the pennant's own space (z across the cloth, y along the pole), which
  // the instance has already rotated and scaled into the world by the time positionNode runs: each instance
  // carries its pole position and length (`aPen`) to carry the ripple along the same axes
  const penYaw = Math.atan2(-WIND.y, WIND.x);
  {
    const pen = attribute('aPen', 'vec4'), x = positionGeometry.x;
    const dz = sin(windTime.mul(6.5).sub(x.mul(5)).add(pen.x.mul(0.3)).add(pen.z.mul(0.2))).mul(0.14).mul(x);
    const dy = cos(windTime.mul(4.1).sub(x.mul(3)).add(pen.z)).mul(0.04).mul(x);
    penMat.positionNode = positionLocal.add(vec3(dz.mul(Math.sin(penYaw)), dy.mul(0.34), dz.mul(Math.cos(penYaw))).mul(pen.w));
  }
  const penGeo = pennantGeometry();
  const pens = new THREE.InstancedMesh(penGeo, penMat, pennants.length);
  {
    const q = new THREE.Quaternion().setFromAxisAngle(Y, penYaw);
    const mm = new THREE.Matrix4();
    const aPen = new Float32Array(pennants.length * 4);
    pennants.forEach((p, i) => {
      const at = new THREE.Vector3(p.x, p.y - p.len * 0.17, p.z);
      pens.setMatrixAt(i, mm.compose(at, q, new THREE.Vector3(p.len, p.len * 0.34, p.len)));
      aPen.set([at.x, at.y, at.z, p.len], i * 4);
    });
    penGeo.setAttribute('aPen', new THREE.InstancedBufferAttribute(aPen, 4));
    pens.castShadow = true;
    scene.add(pens);
    // thin poles
    const poleI = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.035, 0.035, 1, 5), gold, pennants.length);
    pennants.forEach((p, i) => poleI.setMatrixAt(i, mm.compose(new THREE.Vector3(p.x, p.y - p.len * 0.35, p.z), new THREE.Quaternion(), new THREE.Vector3(1, p.len * 0.8, 1))));
    scene.add(poleI);
  }

  // every window: a recessed pane of leaded glass inside a stone frame, all in two draw calls
  // (at 'low' the frames swap to a coarser arch: 216 vertices each instead of 456, over some 400 windows)
  const frameGeos: Record<'low' | 'high', THREE.BufferGeometry> = { high: null!, low: null! };
  let frames: THREE.InstancedMesh;
  {
    const paneGeo = new THREE.ShapeGeometry(archShape(1, 2), 8);
    const uv = paneGeo.getAttribute('uv'), pp = paneGeo.getAttribute('position');
    for (let i = 0; i < uv.count; i++) uv.setXY(i, pp.getX(i) + 0.5, pp.getY(i) / 2);
    paneGeo.translate(0, 0, 0.07);
    const frameShape = archShape(1.38, 2.34, -0.16);
    frameShape.holes.push(archHole(1, 2));
    frameGeos.high = new THREE.ExtrudeGeometry(frameShape, { depth: 0.24, bevelEnabled: false, curveSegments: 8 });
    frameGeos.low = new THREE.ExtrudeGeometry(frameShape, { depth: 0.24, bevelEnabled: false, curveSegments: 3 });
    const panes = new THREE.InstancedMesh(paneGeo, windowMat, windows.length);
    frames = new THREE.InstancedMesh(frameGeos.high, M.darkStone, windows.length);
    const mm = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3();
    windows.forEach((w, i) => {
      mm.compose(v.set(w.x, w.y, w.z), q.setFromAxisAngle(Y, w.yaw), sc.set(w.w, w.h / 2, 1));
      panes.setMatrixAt(i, mm);
      frames.setMatrixAt(i, mm);
    });
    frames.receiveShadow = true;
    scene.add(panes, frames);
  }

  // ink outlines round every building: one draw call, shown at 'high'
  const outline = inked.length ? inkHull(inked) : null;
  if (outline) scene.add(outline);

  // wind-blown grass (and a few wildflowers) around the player; replaces the old static tufts
  const grass = createGrass(scene);

  // ---- the Forbidden Forest: instanced, with per-tree colour jitter
  const trunkI = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.35, 0.5, 1, 6), trunk, trees.length);
  const crownGeo = new THREE.ConeGeometry(1, 1, 7, 2);
  const aTree = new Float32Array(trees.length * 2 * 3);
  const crownI = new THREE.InstancedMesh(crownGeo, leaf, trees.length * 2);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const col = new THREE.Color();
  const jr = mulberry32(7);
  trees.forEach((t, i) => {
    if (t.kind !== 'disc') return;
    const gy = heightAt(t.x, t.z);
    m4.compose(new THREE.Vector3(t.x, gy + t.h * 0.2, t.z), q, new THREE.Vector3(t.r, t.h * 0.4, t.r));
    trunkI.setMatrixAt(i, m4);
    for (let k = 0; k < 2; k++) {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), jr() * 6);
      m4.compose(new THREE.Vector3(t.x, gy + t.h * (0.55 + k * 0.25), t.z), q, new THREE.Vector3(t.r * (3.4 - k * 1.1), t.h * (0.55 - k * 0.15), t.r * (3.4 - k * 1.1)));
      crownI.setMatrixAt(i * 2 + k, m4);
      aTree.set([t.x, t.z, t.r * (3.4 - k * 1.1)], (i * 2 + k) * 3);
      crownI.setColorAt(i * 2 + k, STORYBOOK ? col.set(FOREST[Math.floor(jr() * FOREST.length)]).multiplyScalar(0.85 + jr() * 0.3) : col.setHSL(0.28 + jr() * 0.08, 0.45, 0.55 + jr() * 0.35));
    }
    q.identity();
  });
  crownGeo.setAttribute('aTree', new THREE.InstancedBufferAttribute(aTree, 3));
  trunkI.castShadow = crownI.castShadow = true;
  crownI.receiveShadow = true;
  scene.add(trunkI, crownI);

  // ---- the Great Hall: floating candles (with glow sprites) and house tables
  const candleGlow = new THREE.SpriteMaterial({ map: glowSprite('rgba(255,220,150,1)', 'rgba(255,180,80,0)'), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
  const candleGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.5, 6);
  for (let i = 0; i < 48; i++) {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(candleGeo, candleMat));
    const s = new THREE.Sprite(candleGlow);
    s.scale.setScalar(1.1);
    s.position.y = 0.35;
    g.add(s);
    g.position.set(-10 + (i % 8) * 2.9, 8 + Math.sin(i) * 0.6, -69 + Math.floor(i / 8) * 5);
    g.name = 'candle';
    scene.add(g);
  }
  const hallLight = new THREE.PointLight(0xffd59a, 30, 30, 1.5);
  hallLight.position.set(0, 7, -56);
  scene.add(hallLight);
  for (const { x, z, w, h, d } of HALL_TABLES) {
    const t = add(new THREE.Mesh(worldUV(new THREE.BoxGeometry(w, h, d), w, h, d, 2), M.wood));
    t.position.set(x, h / 2, z);
  }

  // ---- Mirror of Erised & Barnabas the Barmy's tapestry
  const frame = add(new THREE.Mesh(new THREE.BoxGeometry(MIRROR.w, MIRROR.h, MIRROR.d), gold));
  frame.position.set(MIRROR.x, MIRROR.h / 2, MIRROR.z);
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 3.4), new THREE.MeshStandardMaterial({ color: 0x9fb8d9, metalness: 1, roughness: 0.05, emissive: 0x1b2b48, emissiveIntensity: 0.8 }));
  glass.position.set(MIRROR.x, MIRROR.h / 2, MIRROR.z + 0.2);
  scene.add(glass);
  const tap = new THREE.Mesh(new THREE.PlaneGeometry(6, 4), new THREE.MeshStandardMaterial({ color: 0x7a2e5a, roughness: 1 }));
  tap.position.set(-32, 5, -63.9);
  scene.add(tap);

  // ---- torches along the main path (real lights, few of them)
  for (const { x, z } of TORCH_POSTS) {
    const post = add(new THREE.Mesh(new THREE.CylinderGeometry(0.1, TORCH_POST.r, TORCH_POST.h, 6), trunk));
    post.position.set(x, TORCH_POST.h / 2, z);
    const flame = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowSprite('rgba(255,190,90,1)', 'rgba(255,120,30,0)'), blending: THREE.AdditiveBlending, depthWrite: false }));
    flame.scale.setScalar(1.4);
    flame.position.set(x, 3.2, z);
    scene.add(flame);
    const l = new THREE.PointLight(0xff9a40, 0, 16, 1.8);
    l.position.set(x, 3.3, z);
    l.name = 'torch';
    scene.add(l);
  }

  const candles: THREE.Object3D[] = [];
  const torches: THREE.PointLight[] = [];
  scene.traverse((o) => { if (o.name === 'candle') candles.push(o); if (o.name === 'torch') torches.push(o as THREE.PointLight); });
  const squid = scene.getObjectByName('squid');
  const arms = scene.getObjectByName('willow')?.getObjectByName('arms');

  // the lake's mirror pass re-renders the scene: leave the grass out of it (it is far too small to see in a
  // reflection), keep the sun's shadow map as it is (gpu.ts mirrorGuards), freeze it at 'low'
  let mirrorOn = true;
  let mirrorWrap: ((render: () => void) => void) | null = null;
  if (water) {
    const refl = water.mirror.reflector as { updateBefore(frame: unknown): unknown };
    const base = refl.updateBefore.bind(refl);
    refl.updateBefore = (frame) => {
      if (!mirrorOn) return;
      const render = () => {
        const was = grass.group.visible;
        grass.group.visible = false;
        for (const g of mirrorGuards.before) g();
        try { base(frame); } finally {
          for (const g of mirrorGuards.after) g();
          grass.group.visible = was;
        }
      };
      if (mirrorWrap) mirrorWrap(render); else render();
    };
  }
  const lake = lakeMesh && { mesh: lakeMesh, wrap(f: (render: () => void) => void) { mirrorWrap = f; } };
  let bannerKey: House | null | undefined;
  return {
    ground: terrain.ground,
    grass,
    nightGlow, bannerSpots, lake, chimneys,
    setQuality(q) {
      grass.setQuality(q);
      frames.geometry = frameGeos[q];
      setWizardDetail(q); // the wizards in the world follow the world's quality
      if (outline) outline.visible = q === 'high';
      // the lake's mirror pass re-renders the whole scene; freeze it on weak GPUs
      mirrorOn = q === 'high';
    },
    tick(t, dt, willowAngry, sunDir, env = {}) {
      windTime.value = t;
      if (env.focus) {
        grass.update(t, env.focus);
        const f = env.focus;
        hallRoof.visible = interiorAt(f.x, f.z) !== 0; // (layout INTERIORS; view.ts treats it the same way)
      }
      if (env.hour !== undefined) {
        for (const m of hourHands) m.rotation.z = -((env.hour % 12) / 12) * Math.PI * 2;
        for (const m of minuteHands) m.rotation.z = -(env.hour % 1) * Math.PI * 2;
      }
      if (env.banner !== undefined && env.banner !== bannerKey) {
        bannerKey = env.banner;
        penMat.color.set(env.banner ? HOUSE_COLORS[env.banner] : 0x6a36a8);
      }
      if (squid) { squid.rotation.y = t * 0.2; squid.position.y = Math.sin(t) * 0.4 - 0.6; }
      if (arms) arms.rotation.y += willowAngry ? 0.25 : 0.004;
      candles.forEach((c, i) => { c.position.y += Math.sin(t * 1.3 + i) * 0.003; });
      const night = sunDir.y < 0.05;
      torches.forEach((l, i) => { l.intensity = night ? 9 + Math.sin(t * 13 + i * 3) * 1.5 + Math.sin(t * 7.3 + i) : 0; });
      if (water) {
        // the mirror keeps about the old fixed 512 x 512 texture's pixel count, whatever the window size
        const px = typeof innerWidth === 'number' ? innerWidth * innerHeight * devicePixelRatio * devicePixelRatio : 1280 * 720;
        (water.mirror.reflector as { resolutionScale: number }).resolutionScale = Math.max(0.25, Math.min(1, Math.sqrt((512 * 512) / Math.max(1, px))));
        water.time.value += dt * 0.6;
        water.sunDirection.value.copy(sunDir);
      }
    },
  };
}
