/**
 * sprite-factory/factory.js — 3 转 2 精灵工厂。
 *
 * 固定正交相机（俯角 52°，正南向北看）+ 全厂统一三点灯光，
 * 把 CC0 3D 模型（Kenney Fantasy Town / Nature Kit / Mini Characters）
 * 渲染成带烘焙阴影的透明底 PNG，供 client2d 按 sprites.json 的锚点绘制。
 *
 * 坐标约定：模型组原点 = 占地中心、地面 y=0；精灵锚点 = 原点投影像素。
 * 像素密度 PPM = 48 px/米，全厂统一。
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export const PPM = 48;
let ELEV = THREE.MathUtils.degToRad(40); // 俯角（可调，调试用）
const status = (t) => { document.getElementById('status').textContent = 'sprite factory: ' + t; };

let renderer;
function getRenderer() {
  if (renderer) return renderer;
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  return renderer;
}

/** 全厂统一灯光：半球光 + 主光（左上前方，带阴影）+ 补光（右后）。 */
function addLights(scene, shadowExtent) {
  scene.add(new THREE.HemisphereLight(0xcfe4ff, 0x8a7a58, 0.95));
  const key = new THREE.DirectionalLight(0xfff0d6, 2.4);
  key.position.set(-7, 11, 6);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -shadowExtent; key.shadow.camera.right = shadowExtent;
  key.shadow.camera.top = shadowExtent; key.shadow.camera.bottom = -shadowExtent;
  key.shadow.camera.near = 1; key.shadow.camera.far = 40;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xd8e6ff, 0.55);
  fill.position.set(6, 5, -7);
  scene.add(fill);
}

/** 阴影承接面：只显示阴影，本身透明。 */
function shadowCatcher(size) {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.ShadowMaterial({ opacity: 0.3 }),
  );
  m.rotation.x = -Math.PI / 2;
  m.position.y = -0.01;
  m.receiveShadow = true;
  return m;
}

const _v = new THREE.Vector3();
function projectPx(cam, w, h, p) {
  _v.copy(p).project(cam);
  return [((_v.x + 1) / 2) * w, ((1 - _v.y) / 2) * h];
}

/** 帧相机：给定世界包围盒，算出正交相机和画布尺寸（带 margin 米）。 */
function frameCamera(box, marginM, ppm = PPM) {
  const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
  const center = new THREE.Vector3(cx, 0, cz);
  const viewDir = new THREE.Vector3(0, -Math.sin(ELEV), -Math.cos(ELEV));
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
  cam.up.set(0, Math.cos(ELEV), -Math.sin(ELEV));
  cam.position.copy(center).addScaledVector(viewDir, -60);
  cam.lookAt(center);
  cam.updateMatrixWorld(true);
  // 8 个角点投影到相机空间，求紧包围（单位米）
  let l = 1e9, r = -1e9, t = -1e9, b = 1e9;
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
    _v.set(x, y, z).applyMatrix4(cam.matrixWorldInverse);
    l = Math.min(l, _v.x); r = Math.max(r, _v.x);
    t = Math.max(t, _v.y); b = Math.min(b, _v.y);
  }
  cam.left = l - marginM; cam.right = r + marginM;
  cam.bottom = b - marginM; cam.top = t + marginM;
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld(true);
  const w = Math.ceil((cam.right - cam.left) * ppm);
  const h = Math.ceil((cam.top - cam.bottom) * ppm);
  return { cam, w, h, center };
}

/** 把画布按 alpha 紧裁剪（pad px），返回 {canvas, dx, dy}。 */
function cropAlpha(src, pad = 3) {
  const g = src.getContext('2d');
  const { width: w, height: h } = src;
  const data = g.getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (data[(y * w + x) * 4 + 3] > 8) {
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return { canvas: src, dx: 0, dy: 0 };
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
  x1 = Math.min(w - 1, x1 + pad); y1 = Math.min(h - 1, y1 + pad);
  const c = document.createElement('canvas');
  c.width = x1 - x0 + 1; c.height = y1 - y0 + 1;
  c.getContext('2d').drawImage(src, x0, y0, c.width, c.height, 0, 0, c.width, c.height);
  return { canvas: c, dx: x0, dy: y0 };
}

/**
 * 渲染一个已摆好的模型组。group 原点须在占地中心地面。
 * 返回 {dataUrl, meta:{w,h,anchorX,anchorY,footW,footD,ppm}}（像素为裁剪后图）。
 */
function renderGroup(group, { marginM = 0.55, shadowPad = 2.2, frame = null, ppm = PPM } = {}) {
  const rend = getRenderer();
  const scene = new THREE.Scene();
  const box = new THREE.Box3().setFromObject(group);
  const footW = box.max.x - box.min.x, footD = box.max.z - box.min.z;
  const extent = Math.max(footW, footD, box.max.y) * shadowPad + 4;
  addLights(scene, extent);
  scene.add(shadowCatcher(extent * 2.4));
  scene.add(group);
  group.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  const { cam, w, h } = frame ?? frameCamera(box, marginM, ppm);
  rend.setSize(w, h);
  rend.render(scene, cam);
  const [ax, ay] = projectPx(cam, w, h, new THREE.Vector3(0, 0, 0));
  // WebGL canvas 不能取 2d 上下文，先拷贝一份再裁剪
  const flat = document.createElement('canvas');
  flat.width = w; flat.height = h;
  flat.getContext('2d').drawImage(rend.domElement, 0, 0);
  const { canvas, dx, dy } = cropAlpha(flat);
  return {
    dataUrl: canvas.toDataURL('image/png'),
    canvas,
    meta: {
      w: canvas.width, h: canvas.height,
      anchorX: Math.round(ax - dx), anchorY: Math.round(ay - dy),
      footW: +footW.toFixed(3), footD: +footD.toFixed(3),
      ppm,
    },
  };
}

// ------------------------------------------------------------ model loading
const FT = '/client/assets2d/models3d/fantasy-town/';
const NK = '/client/assets2d/models3d/nature-kit/';
const MC = '/client/assets2d/models3d/mini-characters/';
const loader = new GLTFLoader();
const glbCache = new Map();
function loadGLB(url) {
  if (!glbCache.has(url)) glbCache.set(url, loader.loadAsync(url));
  return glbCache.get(url);
}

/** 取一个零件的新实例，并归一化：包围盒 xz 中心移到原点、底面落在 y=0。 */
async function piece(url) {
  const gltf = await loadGLB(url);
  const obj = gltf.scene.clone(true);
  const box = new THREE.Box3().setFromObject(obj);
  obj.position.x -= (box.min.x + box.max.x) / 2;
  obj.position.z -= (box.min.z + box.max.z) / 2;
  obj.position.y -= box.min.y;
  const wrap = new THREE.Group();
  wrap.add(obj);
  const size = new THREE.Vector3();
  box.getSize(size);
  return { obj: wrap, w: size.x, h: size.y, d: size.z };
}

/** 把零件放到 (x, baseY, z)，绕自身竖轴转 rotY（弧度）。piece() 已归一化。 */
function put(p, x, y, z, rotY = 0) {
  const g = new THREE.Group();
  const inner = p.obj.clone(true);
  inner.rotation.y = rotY;
  // 旋转后占地在 xz 的半宽
  g.add(inner);
  g.position.set(x, y, z);
  return g;
}

/** 调试：量所有关键零件的真实包围盒（归一化后 w=宽x, h=高, d=深z）。 */
async function measure() {
  const names = ['wall', 'wall-doorway-square', 'wall-window-small', 'wall-window-stone', 'wall-corner',
    'wall-wood', 'wall-wood-doorway-square', 'wall-wood-window-small', 'wall-wood-window-shutters', 'wall-wood-corner',
    'roof', 'roof-left', 'roof-right', 'roof-gable-end', 'roof-gable-top',
    'roof-high', 'roof-high-left', 'roof-high-right', 'roof-high-gable-end', 'roof-high-gable-top',
    'chimney', 'lantern', 'fence'];
  const out = {};
  for (const n of names) {
    const p = await piece(FT + n + '.glb');
    out[n] = { w: +p.w.toFixed(3), h: +p.h.toFixed(3), d: +p.d.toFixed(3) };
  }
  for (const n of ['tree_pineTallA', 'tree_tall']) {
    const p = await piece(NK + n + '.glb');
    out[n] = { w: +p.w.toFixed(3), h: +p.h.toFixed(3), d: +p.d.toFixed(3) };
  }
  const gltf = await loadGLB(MC + 'character-male-a.glb');
  const box = new THREE.Box3().setFromObject(gltf.scene);
  const size = new THREE.Vector3(); box.getSize(size);
  out['character-male-a'] = { w: +size.x.toFixed(3), h: +size.y.toFixed(3), d: +size.z.toFixed(3) };
  out['character-anims'] = gltf.animations.map((a) => a.name);
  const mats = [];
  gltf.scene.traverse((o) => { if (o.isMesh) mats.push(o.material?.name ?? o.material?.type); });
  out['character-materials'] = [...new Set(mats)];
  return out;
}

/** 单个零件渲染（调试朝向用）：零件名 → 精灵。 */
async function renderPiece(name) {
  const url = name.startsWith('tree_') ? NK + name + '.glb' : FT + name + '.glb';
  const p = await piece(url);
  return renderGroup(p.obj);
}

// ------------------------------------------------------------ house assembly
// 零件事实（measure + 单件渲染确认）：墙件长 1 沿 z、厚 0.1、高 1，面朝 ±x；
// 屋顶坡面板长 1 沿 z、坡面横跨 x（run≈1.13），脊沿 z；山墙端件待拼装验证。
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';

async function buildHouse({ walls, roof, wu = 2, du = 3, stories = 1, chimneyOn = false, frontWin = null }) {
  const P = {};
  for (const [k, name] of Object.entries(walls)) P[k] = await piece(FT + name + '.glb');
  const lp = await piece(FT + roof + '-left.glb');
  // 注意：roof-left / roof-right 截面相同（高边都在 +x），不是镜像对。
  // 东坡 = left 件绕 Y 转 π（高边转到 -x 朝脊线）。
  const H = P.plain.h;
  const g = new THREE.Group();
  for (let s = 0; s < stories; s++) {
    const y = s * H;
    for (let i = 0; i < wu; i++) {
      const x = -wu / 2 + 0.5 + i;
      const front = s === 0 && i === wu - 1 ? P.door : (frontWin && s === 0 && i === 0 ? frontWin : P.win);
      g.add(put(front, x, y, du / 2, Math.PI / 2));
      g.add(put(P.win, x, y, -du / 2, Math.PI / 2));
    }
    for (let j = 0; j < du; j++) {
      const z = -du / 2 + 0.5 + j;
      g.add(put(P.plain, -wu / 2, y, z, 0));
      // +x 长边在整房旋转后朝南（临街面）：底层做成 窗-门-窗
      const east = s === 0 ? (j === 1 ? P.door : P.win) : (j === 1 ? P.win : P.plain);
      g.add(put(east, wu / 2, y, z, 0));
    }
  }
  const topY = stories * H;
  // 坡面片沿 z 间距 0.9 重叠，埋掉片与片之间的端面横缝；
  // 左右坡同用 left 件（东坡转 π），置于 ∓0.58 使两坡面在脊线交汇（轮廓实测）
  const zTiles = [];
  for (let z = -du / 2 + 0.5; z <= du / 2 - 0.4; z += 0.9) zTiles.push(z);
  for (const z of zTiles) {
    g.add(put(lp, -0.58, topY, z, 0));
    g.add(put(lp, 0.58, topY, z, Math.PI));
  }
  // 山墙端：前后各一，必要时横向拉伸盖满 wu（端板是平板，拉伸无碍）
  for (const zs of [du / 2, -du / 2]) {
    const end = await piece(FT + roof + '-gable-end.glb');
    end.obj.scale.x = (wu + 0.18) / end.w;
    g.add(put(end, 0, topY, zs, zs > 0 ? 0 : Math.PI));
  }
  if (chimneyOn) {
    const chim = await piece(FT + 'chimney.glb');
    const slopePerX = (lp.h - 0.07) / 1.2; // 轮廓实测坡度
    const surfY = lp.h - slopePerX * 0.54; // x=0.52 处坡面高度
    g.add(put(chim, 0.52, topY + surfY - 0.35, -0.5, 0));
  }
  // 整房转 -π/2：长边朝南临街（门在长边中央），脊改为沿 x，山墙朝东西
  const root = new THREE.Group();
  root.add(g);
  root.rotation.y = -Math.PI / 2;
  return root;
}

async function scaled(url, targetH) {
  const p = await piece(url);
  p.obj.scale.setScalar(targetH / p.h);
  return p.obj;
}

// ------------------------------------------------------------ character
async function renderCharacterSet() {
  const gltf = await loadGLB(MC + 'character-male-a.glb');
  const walk = gltf.animations.find((a) => a.name === 'walk');
  const idle = gltf.animations.find((a) => a.name === 'idle');
  // 探针：站姿自动帧渲染一次，量出投影高度，反推序列帧的包围盒高度
  const probeHolder = new THREE.Group();
  const probeChar = skeletonClone(gltf.scene);
  probeHolder.add(probeChar);
  const probeMixer = new THREE.AnimationMixer(probeChar);
  probeMixer.clipAction(idle).play(); probeMixer.setTime(0.1); probeChar.updateMatrixWorld(true);
  const probe = renderGroup(probeHolder, { marginM: 0.8 });
  const projH = probe.meta.h / PPM; // 投影高（米，含 cosEl 压缩）
  const boxH = Math.min(3.2, (projH / Math.cos(ELEV)) * 1.12 + 0.25);
  const frameBox = new THREE.Box3(
    new THREE.Vector3(-0.85, 0, -0.85), new THREE.Vector3(0.85, boxH, 0.85));
  const frame = frameCamera(frameBox, 0.3, 144); // 人物高密度渲染 144px/m
  const dirs = { down: 0, up: Math.PI, left: -Math.PI / 2, right: Math.PI / 2 };
  const out = {};
  for (const [dir, yaw] of Object.entries(dirs)) {
    const shots = [['stand', idle, 0.1]];
    for (let f = 0; f < 4; f++) shots.push(['w' + f, walk, (walk.duration * (f + 0.5)) / 4]);
    for (const [tag, clip, t] of shots) {
      const holder = new THREE.Group();
      const ch = skeletonClone(gltf.scene);
      const mixer = new THREE.AnimationMixer(ch);
      mixer.clipAction(clip).play(); mixer.setTime(t); ch.updateMatrixWorld(true);
      holder.add(ch);
      holder.rotation.y = yaw;
      out[`char3d-${dir}-${tag}`] = renderGroup(holder, { frame, ppm: 144 });
    }
  }
  return out;
}

// ------------------------------------------------------------ manifest
async function renderAll() {
  const out = {};
  const stoneWin = await piece(FT + 'wall-window-stone.glb');
  const jobs = {
    houseWood: () => buildHouse({
      walls: { plain: 'wall-wood', door: 'wall-wood-doorway-square', win: 'wall-wood-window-shutters' },
      roof: 'roof', wu: 2, du: 3,
    }),
    houseStone: () => buildHouse({
      walls: { plain: 'wall', door: 'wall-doorway-square', win: 'wall-window-small' },
      roof: 'roof', wu: 2, du: 3, chimneyOn: true,
    }),
    houseTavern: () => buildHouse({
      walls: { plain: 'wall', door: 'wall-doorway-square', win: 'wall-window-small' },
      roof: 'roof-high', wu: 2, du: 3, chimneyOn: true, frontWin: stoneWin,
    }),
    treePine: async () => { const g = new THREE.Group(); g.add(await scaled(NK + 'tree_pineTallA.glb', 6.9)); return g; },
    treeRound: async () => { const g = new THREE.Group(); g.add(await scaled(NK + 'tree_tall.glb', 6.3)); return g; },
    lamp: async () => { const g = new THREE.Group(); g.add(await scaled(FT + 'lantern.glb', 3.1)); return g; },
    fence: async () => {
      const p = await piece(FT + 'fence.glb');
      p.obj.rotation.y = Math.PI / 2; // 长度转到 x 轴，正面朝南
      const g = new THREE.Group(); g.add(p.obj); return g;
    },
  };
  for (const [name, build] of Object.entries(jobs)) {
    status('rendering ' + name);
    out[name] = renderGroup(await build());
    showSprite(name, out[name].canvas, 0.55);
  }
  status('rendering character');
  const chars = await renderCharacterSet();
  for (const [name, r] of Object.entries(chars)) {
    out[name] = r;
    if (name.endsWith('stand') || name.endsWith('w1')) showSprite(name, r.canvas, 1);
  }
  await renderCatalog(out);
  status('done');
  return out;
}

// ------------------------------------------------------------ Hogwarts catalog (hw-*)
// 霍格沃茨专属素材：全部基础体拼装（清单见 goals/2d/hidden_files/prerender-v2/catalog.md）。
// 形状语言优先：尖顶、长袍、环、锅炉——剪影先行，细节其次。
function std(color, o = {}) {
  return new THREE.MeshStandardMaterial({
    color, roughness: o.r ?? 0.9, metalness: o.m ?? 0,
    ...(o.e ? { emissive: o.e, emissiveIntensity: o.ei ?? 1 } : {}),
    ...(o.t ? { transparent: true, opacity: o.t } : {}),
  });
}
const M = {
  stone: std(0x8b8e96), stoneLight: std(0x9aa0a8), stoneDark: std(0x676b73),
  slate: std(0x47536b), slateDark: std(0x39445a),
  wood: std(0x7a5230), woodDark: std(0x54381f), thatch: std(0xa5854f, { r: 1 }),
  iron: std(0x2e2e33, { m: 0.6, r: 0.5 }), gold: std(0xd9a441, { m: 0.85, r: 0.32 }),
  brass: std(0x8f8578, { m: 0.5, r: 0.45 }), silver: std(0xc9ccd2, { m: 0.8, r: 0.35 }),
  winGlow: std(0x574a33, { e: 0xffb84d, ei: 1.1 }),
  skin: std(0xe8b98d), leaf: std(0x3c6134), leafDark: std(0x2e4d2a),
  glass: std(0x9fd4b8, { r: 0.15, t: 0.42 }), frameW: std(0xe8e8e6),
  terra: std(0xb56545), red: std(0x9e2b25),
};
function box(w, h, d, mat) {
  const g = new THREE.BoxGeometry(w, h, d); g.translate(0, h / 2, 0);
  return new THREE.Mesh(g, mat);
}
function cyl(rt, rb, h, mat, seg = 16) {
  const g = new THREE.CylinderGeometry(rt, rb, h, seg); g.translate(0, h / 2, 0);
  return new THREE.Mesh(g, mat);
}
function cone(r, h, mat, seg = 16) {
  const g = new THREE.ConeGeometry(r, h, seg); g.translate(0, h / 2, 0);
  return new THREE.Mesh(g, mat);
}
function sph(r, mat, sx = 1, sy = 1, sz = 1) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 18, 14), mat);
  m.scale.set(sx, sy, sz); return m;
}
function tor(r, tube, mat, arc = Math.PI * 2) {
  return new THREE.Mesh(new THREE.TorusGeometry(r, tube, 10, 24, arc), mat);
}
function at(mesh, x, y, z, ry = 0) { mesh.position.set(x, y, z); if (ry) mesh.rotation.y = ry; return mesh; }
function tube(points, radius, mat) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)));
  return new THREE.Mesh(new THREE.TubeGeometry(curve, 20, radius, 6), mat);
}
const rnd = (s) => { const x = Math.sin(s * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

/** 塔楼窗：贴在圆柱面上（a=0 朝南 +z）。 */
function towerWin(r, y, a) {
  const w = box(0.27, 0.42, 0.07, M.winGlow);
  w.position.set(Math.sin(a) * (r + 0.02), y, Math.cos(a) * (r + 0.02));
  w.rotation.y = a;
  return w;
}
function buildTower(h, r, roofH, wins, flag = false) {
  const g = new THREE.Group();
  g.add(cyl(r * 0.88, r, h, M.stone, 18));
  g.add(at(cone(r * 1.28, roofH, M.slate, 18), 0, h - 0.05, 0));
  for (const [wy, a] of wins) g.add(towerWin(r * (1 - (wy / h) * 0.12), wy, a));
  if (flag) {
    g.add(at(cyl(0.03, 0.03, 0.8, M.woodDark, 6), 0, h + roofH - 0.05, 0));
    g.add(at(box(0.55, 0.3, 0.03, M.red), 0.28, h + roofH + 0.35, 0));
  }
  return g;
}

const HW_BUILDERS = {
  'hw-tower-short': () => buildTower(4, 1.05, 2.4, [[1.6, 0], [2.9, 0.8]]),
  'hw-tower-mid': () => buildTower(6.5, 1.15, 3.2, [[1.8, 0], [3.6, -0.8], [5.2, 0.4]]),
  'hw-tower-tall': () => buildTower(9, 1.25, 4.2, [[2, 0], [4, 0.8], [6, -0.6], [7.8, 0]], true),
  'hw-castle-wall': () => {
    const g = new THREE.Group();
    g.add(box(4.4, 3, 0.8, M.stone));
    for (let i = 0; i < 6; i++) g.add(at(box(0.42, 0.34, 0.84, M.stone), -2.0 + i * 0.8, 3, 0));
    g.add(at(box(0.5, 0.7, 0.1, M.winGlow), -1.1, 1.5, 0.4));
    g.add(at(box(0.5, 0.7, 0.1, M.winGlow), 1.1, 1.5, 0.4));
    return g;
  },
  'hw-great-hall': () => {
    const g = new THREE.Group();
    g.add(box(8.4, 2.8, 4, M.stone));
    for (let i = 0; i < 5; i++) g.add(at(box(0.34, 1.7, 0.08, M.winGlow), -3.2 + i * 1.6, 0.7, 2.0));
    const slopeLen = Math.hypot(2.1, 1.9);
    for (const s of [1, -1]) {
      const roof = box(8.7, 0.14, slopeLen, M.slateDark);
      roof.geometry.translate(0, -0.07, 0);
      roof.position.set(0, 2.8 + 0.95, s * 1.02);
      roof.rotation.x = s * Math.atan2(1.9, 2.1) * -1;
      g.add(roof);
    }
    for (const e of [1, -1]) {
      g.add(at(cyl(0.16, 0.2, 1.1, M.stone, 8), e * 4.2, 3.6, 0));
      g.add(at(cone(0.3, 0.9, M.slate, 8), e * 4.2, 4.65, 0));
    }
    g.add(at(box(0.7, 1.3, 0.1, M.woodDark), 0, 0, 2.02));
    return g;
  },
  'hw-greenhouse': () => {
    const g = new THREE.Group();
    g.add(box(3.8, 0.7, 2.8, M.stoneLight));
    g.add(at(box(3.6, 1.0, 2.6, M.glass), 0, 0.7, 0));
    const domeGeo = new THREE.CylinderGeometry(1.3, 1.3, 3.6, 16, 1, true, 0, Math.PI);
    const dome = new THREE.Mesh(domeGeo, M.glass);
    dome.rotation.z = Math.PI / 2; dome.rotation.y = Math.PI / 2;
    dome.position.y = 1.7; g.add(dome);
    for (const rx of [-1.5, 0, 1.5]) {
      const rib = tor(1.32, 0.05, M.frameW, Math.PI);
      rib.rotation.y = Math.PI / 2; rib.position.set(rx, 1.7, 0); g.add(rib);
    }
    g.add(at(box(3.7, 0.09, 0.09, M.frameW), 0, 1.68, 1.31));
    g.add(at(box(3.7, 0.09, 0.09, M.frameW), 0, 1.68, -1.31));
    g.add(at(box(0.62, 1.15, 0.08, M.woodDark), 0, 0.55, 1.41));
    const plant = sph(0.5, M.leaf, 1.4, 0.8, 1); plant.position.y = 0.95; g.add(plant);
    return g;
  },
  'hw-astro-tower': () => {
    const g = new THREE.Group();
    g.add(cyl(1.05, 1.3, 7, M.stone, 18));
    g.add(towerWin(1.16, 2.2, 0)); g.add(towerWin(1.1, 4.2, 0.7)); g.add(towerWin(1.06, 5.8, -0.5));
    g.add(at(cyl(1.55, 1.55, 0.32, M.stoneDark, 18), 0, 7, 0));
    const domeGeo = new THREE.SphereGeometry(1.3, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2);
    const dome = new THREE.Mesh(domeGeo, M.brass); dome.position.y = 7.32; g.add(dome);
    g.add(at(box(0.34, 0.9, 0.06, M.iron), 0, 7.85, 1.24));
    const scope = cyl(0.13, 0.17, 1.9, M.brass, 10);
    scope.position.set(0.3, 7.6, 0.5); scope.rotation.x = -0.62; g.add(scope);
    return g;
  },
  'hw-castle-gate': () => {
    const g = new THREE.Group();
    for (const s of [1, -1]) {
      g.add(at(cyl(0.55, 0.62, 3.4, M.stone, 14), s * 1.95, 0, 0));
      g.add(at(cone(0.78, 1.1, M.slate, 14), s * 1.95, 3.35, 0));
    }
    g.add(at(box(1.5, 3.0, 0.7, M.stone), -1.32, 0, 0));
    g.add(at(box(1.5, 3.0, 0.7, M.stone), 1.32, 0, 0));
    g.add(at(box(1.9, 0.85, 0.7, M.stone), 0, 2.15, 0));
    for (const s of [1, -1]) {
      const door = new THREE.Group();
      door.add(box(0.82, 2.1, 0.06, M.iron));
      for (const bx of [-0.26, 0, 0.26]) door.add(at(box(0.07, 2.1, 0.09, M.iron), bx, 0, 0));
      door.position.set(s * 0.46, 0, 0.1); door.rotation.y = s * -0.55;
      g.add(door);
    }
    return g;
  },
  'hw-hagrid-hut': () => {
    const g = new THREE.Group();
    g.add(cyl(1.75, 1.95, 1.7, M.stoneDark, 14));
    g.add(at(cone(2.65, 2.1, M.thatch, 14), 0, 1.55, 0));
    g.add(at(cyl(0.22, 0.26, 0.9, M.stoneDark, 8), 1.15, 2.6, -0.7));
    g.add(at(box(0.72, 1.25, 0.09, M.woodDark), 0, 0, 1.9));
    const win = cyl(0.3, 0.3, 0.08, M.winGlow, 14);
    win.rotation.x = Math.PI / 2; win.position.set(-0.95, 1.0, 1.62); g.add(win);
    g.add(at(box(2.2, 0.18, 0.5, M.wood), 0, 0, 2.15));
    return g;
  },
  'hw-whomping-willow': () => {
    const g = new THREE.Group();
    const bark = std(0x4c3a28, { r: 1 });
    const seg1 = cyl(0.52, 0.78, 1.5, bark, 10); g.add(seg1);
    const seg2 = cyl(0.4, 0.52, 1.3, bark, 10);
    seg2.position.set(0.22, 1.35, 0.1); seg2.rotation.z = -0.28; g.add(seg2);
    const seg3 = cyl(0.26, 0.4, 1.2, bark, 10);
    seg3.position.set(-0.05, 2.5, 0.15); seg3.rotation.z = 0.35; g.add(seg3);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + rnd(i) * 0.7;
      const bx = Math.cos(a) * 0.3, bz = Math.sin(a) * 0.3;
      const br = cyl(0.05, 0.11, 1.9, bark, 7);
      br.position.set(bx, 2.9, bz);
      br.rotation.set(Math.sin(a) * 0.85, 0, -Math.cos(a) * 0.85);
      g.add(br);
      const blob = sph(0.55 + rnd(i + 9) * 0.3, M.leafDark, 1.15, 0.75, 1.15);
      blob.position.set(bx + Math.cos(a) * 1.35, 2.35 + rnd(i + 20) * 0.4, bz + Math.sin(a) * 1.35);
      g.add(blob);
    }
    return g;
  },
  'hw-quidditch-hoops': () => {
    const g = new THREE.Group();
    const hs = [3.1, 4.6, 3.1];
    hs.forEach((h, i) => {
      const x = (i - 1) * 1.7;
      g.add(at(cyl(0.07, 0.09, h, M.woodDark, 8), x, 0, 0));
      const ring = tor(0.58, 0.07, M.gold);
      ring.position.set(x, h + 0.55, 0); g.add(ring);
    });
    return g;
  },
  'hw-express': () => {
    const g = new THREE.Group();
    const red = std(0xa02318, { r: 0.55, m: 0.25 });
    const boiler = cyl(0.78, 0.78, 3.1, red, 18);
    boiler.rotation.x = Math.PI / 2; boiler.position.set(0, 0.85, 0.6); g.add(boiler);
    g.add(at(cyl(0.16, 0.2, 0.85, M.iron, 10), 0, 1.55, 1.75));
    const dome = sph(0.3, M.brass); dome.position.set(0, 1.68, 0.9); g.add(dome);
    g.add(box(1.7, 1.9, 1.5, red));
    g.children[g.children.length - 1].position.set(0, 0.35, -1.55);
    g.add(at(box(1.5, 0.55, 0.08, M.winGlow), 0, 1.6, -0.78));
    const plowGeo = new THREE.CylinderGeometry(0.04, 0.85, 1.15, 4);
    const plow = new THREE.Mesh(plowGeo, M.iron);
    plow.rotation.x = Math.PI / 2; plow.rotation.y = Math.PI / 4;
    plow.position.set(0, 0.45, 2.35); g.add(plow);
    const lampB = sph(0.17, M.winGlow); lampB.position.set(0, 1.15, 2.2); g.add(lampB);
    for (const s of [1, -1]) {
      const wheel = cyl(0.52, 0.52, 0.12, M.iron, 16);
      wheel.rotation.z = Math.PI / 2; wheel.position.set(s * 0.82, 0.52, 0.7); g.add(wheel);
      const wheel2 = cyl(0.4, 0.4, 0.12, M.iron, 14);
      wheel2.rotation.z = Math.PI / 2; wheel2.position.set(s * 0.82, 0.4, -1.5); g.add(wheel2);
    }
    g.add(at(box(1.9, 0.22, 4.6, M.iron), 0, 0.02, 0));
    g.rotation.y = -0.55; // 3/4 侧面：锅炉长度可见，正面看只是一根红柱
    return g;
  },
  'hw-lake-dock': () => {
    const g = new THREE.Group();
    g.add(box(3.4, 0.14, 1.6, M.wood));
    for (let i = 0; i < 5; i++) g.add(at(box(0.06, 0.16, 1.6, M.woodDark), -1.6 + i * 0.8, 0.13, 0));
    for (const [px, pz] of [[-1.5, 0.65], [1.5, 0.65], [-0.5, -0.65], [0.9, -0.65]]) {
      g.add(at(cyl(0.11, 0.11, 0.85, M.woodDark, 8), px, 0, pz));
      g.add(at(tor(0.13, 0.03, std(0x9a8a70)), px, 0.62, pz));
    }
    g.add(at(cyl(0.3, 0.34, 0.62, M.wood, 12), 1.15, 0.14, -0.35));
    return g;
  },
  // ------------------------------------------------ creatures & props
  'hw-owl-brown': () => buildOwl(std(0x8a6742), std(0xd9c39a), false),
  'hw-owl-snowy': () => buildOwl(std(0xeef0f2), std(0xf7f5ee), true),
  'hw-spider': () => {
    const g = new THREE.Group();
    const body = std(0x23232a, { r: 0.7 });
    const abd = sph(0.52, body, 1, 0.85, 1.25); abd.position.set(0, 0.55, -0.35); g.add(abd);
    const ceph = sph(0.3, body); ceph.position.set(0, 0.5, 0.35); g.add(ceph);
    for (const s of [1, -1]) for (let i = 0; i < 4; i++) {
      const z = 0.45 - i * 0.26, spread = 0.75 + i * 0.16;
      g.add(tube([[s * 0.22, 0.5, z], [s * spread, 0.95, z + (i - 1.5) * 0.22], [s * (spread + 0.35), 0.02, z + (i - 1.5) * 0.34]], 0.045, body));
    }
    const eye = sph(0.05, std(0xc22f3d, { e: 0xc22f3d, ei: 0.7 }));
    eye.position.set(0.1, 0.58, 0.62); g.add(eye);
    const eye2 = eye.clone(); eye2.position.x = -0.1; g.add(eye2);
    return g;
  },
  'hw-basilisk': () => {
    const g = new THREE.Group();
    const skin = std(0x3f6b35, { r: 0.6 });
    for (let i = 0; i <= 9; i++) {
      const t = i / 9;
      const s = sph(0.31 * (1 - t * 0.5), skin);
      s.position.set(Math.sin(t * 2.6) * 0.9, 0.24 * (1 - t * 0.5) + 0.05, 1.3 - t * 2.6);
      g.add(s);
    }
    for (let i = 1; i <= 3; i++) {
      const s = sph(0.30 - i * 0.02, skin);
      s.position.set(Math.sin(0.15 * i) * 0.2, 0.3 + i * 0.26, 1.32 + i * 0.07);
      g.add(s);
    }
    const head = sph(0.3, std(0x35592c, { r: 0.6 }), 0.88, 0.78, 1.25);
    head.position.set(0.1, 1.35, 1.62); g.add(head);
    for (let i = 0; i < 3; i++) g.add(at(cone(0.07, 0.22, M.red, 6), 0.1 + (i - 1) * 0.11, 1.55, 1.5 - Math.abs(i - 1) * 0.05));
    g.add(at(box(0.05, 0.02, 0.4, M.red), 0.1, 1.26, 1.98));
    return g;
  },
  'hw-hippogriff': () => {
    const g = new THREE.Group();
    const bodyM = std(0x8d8578);
    const body = sph(0.55, bodyM, 1.3, 0.95, 0.85); body.position.set(0, 1.0, -0.1); g.add(body);
    const neck = cyl(0.16, 0.24, 0.75, std(0xd8d5cc), 10);
    neck.position.set(0, 1.25, 0.62); neck.rotation.x = 0.55; g.add(neck);
    const head = sph(0.25, std(0xd8d5cc), 0.85, 0.9, 1.1); head.position.set(0, 1.72, 0.92); g.add(head);
    const beak = cone(0.12, 0.45, std(0x9aa0a3, { m: 0.4, r: 0.4 }), 8);
    beak.rotation.x = Math.PI * 0.62; beak.position.set(0, 1.6, 1.2); g.add(beak);
    for (const s of [1, -1]) {
      const wing = cone(0.5, 1.45, std(0xb9bcc0), 8);
      wing.scale.set(1, 1, 0.22);
      wing.position.set(s * 0.42, 1.35, -0.15); wing.rotation.z = s * -0.65; wing.rotation.x = -0.25;
      g.add(wing);
      g.add(at(cyl(0.05, 0.04, 0.95, std(0xd8d5cc), 7), s * 0.3, 0, 0.48));
      g.add(at(cyl(0.055, 0.045, 0.95, bodyM, 7), s * 0.32, 0, -0.62));
      for (let tI = 0; tI < 3; tI++) {
        const tal = cone(0.03, 0.16, M.iron, 5);
        tal.rotation.x = Math.PI; tal.position.set(s * 0.3 + (tI - 1) * 0.07, 0.02, 0.56);
        g.add(tal);
      }
    }
    const tail = cyl(0.03, 0.05, 0.8, bodyM, 6);
    tail.position.set(0, 0.85, -0.95); tail.rotation.x = 0.8; g.add(tail);
    return g;
  },
  'hw-cat': () => {
    const g = new THREE.Group();
    const fur = std(0x7d7268, { r: 1 });
    const body = sph(0.26, fur, 1.05, 0.78, 1.3); body.position.set(0, 0.34, -0.05); g.add(body);
    const head = sph(0.17, fur); head.position.set(0, 0.5, 0.32); g.add(head);
    for (const s of [1, -1]) {
      g.add(at(cone(0.06, 0.14, fur, 6), s * 0.09, 0.62, 0.32));
      g.add(at(cyl(0.035, 0.035, 0.3, fur, 6), s * 0.14, 0, 0.18));
      g.add(at(cyl(0.035, 0.035, 0.3, fur, 6), s * 0.14, 0, -0.28));
    }
    const t1 = cyl(0.03, 0.035, 0.42, fur, 6);
    t1.position.set(0, 0.42, -0.44); t1.rotation.x = -0.7; g.add(t1);
    const t2 = cyl(0.02, 0.03, 0.36, fur, 6);
    t2.position.set(0, 0.66, -0.58); t2.rotation.x = -1.5; g.add(t2);
    return g;
  },
  'hw-cauldron': () => {
    const g = new THREE.Group();
    const ironM = std(0x43434c, { m: 0.5, r: 0.55 });
    g.add(cyl(0.54, 0.38, 0.58, ironM, 18));
    const rim = tor(0.54, 0.06, ironM); rim.rotation.x = Math.PI / 2; rim.position.y = 0.58; g.add(rim);
    const brew = cyl(0.44, 0.44, 0.03, std(0x2f8f4e, { e: 0x1e5c30, ei: 0.35 }), 18);
    brew.position.y = 0.53; g.add(brew);
    const handle = tor(0.5, 0.035, ironM, Math.PI); handle.position.y = 0.6; g.add(handle);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      g.add(at(box(0.1, 0.14, 0.1, ironM), Math.cos(a) * 0.36, -0.1, Math.sin(a) * 0.36));
    }
    return g;
  },
  'hw-wand-box': () => {
    const g = new THREE.Group();
    g.add(box(1.2, 0.15, 0.32, std(0x4a2a5a)));
    g.add(at(box(1.26, 0.07, 0.37, std(0x5a3468)), 0.03, 0.15, 0));
    g.add(at(box(0.1, 0.24, 0.39, M.gold), 0, 0, 0));
    return g;
  },
  'hw-broomstick': () => {
    const g = new THREE.Group();
    const inner = new THREE.Group();
    inner.add(cyl(0.035, 0.04, 1.9, M.wood, 8));
    const brush = cone(0.17, 0.6, std(0xa67c44, { r: 1 }), 10);
    brush.scale.z = 0.55; brush.rotation.x = Math.PI; brush.position.y = -0.28; inner.add(brush);
    const band = tor(0.055, 0.02, M.iron); band.rotation.x = Math.PI / 2; band.position.y = 0.05; inner.add(band);
    inner.position.y = 0.95; inner.rotation.z = 0.5;
    inner.position.x = -0.45;
    g.add(inner);
    return g;
  },
  'hw-pumpkin': () => {
    const g = new THREE.Group();
    const sub = new THREE.Group(); sub.scale.y = 0.78;
    sub.add(sph(0.52, std(0xe07b24, { r: 0.75 })));
    for (let i = 0; i < 6; i++) {
      const rib = tor(0.52, 0.014, std(0xc4661d));
      rib.rotation.y = (i / 6) * Math.PI; sub.add(rib);
    }
    sub.position.y = 0.42; g.add(sub);
    const stem = cyl(0.05, 0.07, 0.22, std(0x5d7031), 7);
    stem.position.set(0.05, 0.78, 0); stem.rotation.z = -0.25; g.add(stem);
    return g;
  },
  'hw-potion-red': () => buildPotion(0xc22f3d),
  'hw-potion-green': () => buildPotion(0x37b34d),
  'hw-potion-blue': () => buildPotion(0x2f6fc2),
  'hw-candle': () => {
    const g = new THREE.Group();
    const c = cyl(0.09, 0.1, 0.52, std(0xf2ead8, { r: 0.6 }), 12);
    c.rotation.z = 0.1; g.add(c);
    const flame = sph(0.06, std(0xffa62b, { e: 0xff8c1a, ei: 2.2 }), 1, 1.9, 1);
    flame.position.set(-0.05, 0.62, 0); g.add(flame);
    return g;
  },
  'hw-chest': () => {
    const g = new THREE.Group();
    g.add(box(0.98, 0.46, 0.62, M.wood));
    const lidGeo = new THREE.CylinderGeometry(0.31, 0.31, 0.98, 12, 1, false, 0, Math.PI);
    const lid = new THREE.Mesh(lidGeo, M.woodDark);
    lid.rotation.z = Math.PI / 2; lid.rotation.y = Math.PI / 2;
    lid.position.y = 0.46; g.add(lid);
    for (const bx of [-0.32, 0.32]) g.add(at(box(0.09, 0.5, 0.66, M.iron), bx, 0, 0));
    g.add(at(box(0.16, 0.2, 0.05, M.gold), 0, 0.22, 0.32));
    return g;
  },
  'hw-diary': () => {
    const g = new THREE.Group();
    g.add(box(0.64, 0.05, 0.88, std(0xe8e0c8)));
    g.add(at(box(0.68, 0.05, 0.92, std(0x20302a, { r: 0.6 })), 0, 0.05, 0));
    for (const [cx, cz] of [[-0.28, -0.4], [0.28, -0.4], [-0.28, 0.4], [0.28, 0.4]]) {
      g.add(at(box(0.09, 0.02, 0.09, M.gold), cx, 0.1, cz));
    }
    g.add(at(box(0.12, 0.03, 0.2, M.gold), 0.33, 0.04, 0));
    return g;
  },
  'hw-snitch': () => {
    const g = new THREE.Group();
    const ball = sph(0.17, M.gold); ball.position.y = 0.3; g.add(ball);
    const seam = tor(0.172, 0.012, std(0xa87c2c, { m: 0.8, r: 0.4 }));
    seam.rotation.x = Math.PI / 2; seam.position.y = 0.3; g.add(seam);
    for (const s of [1, -1]) {
      const wing = cone(0.1, 0.52, M.silver, 8);
      wing.scale.z = 0.25;
      wing.position.set(s * 0.28, 0.48, 0); wing.rotation.z = s * -1.0;
      g.add(wing);
    }
    return g;
  },
  'hw-quaffle': () => {
    const g = new THREE.Group();
    const ball = sph(0.31, std(0x8a3b2a, { r: 0.7 })); ball.position.y = 0.32; g.add(ball);
    const band = tor(0.315, 0.02, std(0x6e2c1f));
    band.rotation.x = Math.PI / 2; band.position.y = 0.32; g.add(band);
    return g;
  },
  'hw-mandrake': () => {
    const g = new THREE.Group();
    g.add(cyl(0.27, 0.34, 0.42, M.terra, 12));
    g.add(at(cyl(0.35, 0.35, 0.05, M.terra, 12), 0, 0.4, 0));
    const bulb = sph(0.19, std(0xa98a68, { r: 1 }), 1, 1.1, 1); bulb.position.y = 0.55; g.add(bulb);
    for (const s of [1, -1]) {
      const arm = cyl(0.03, 0.045, 0.3, std(0xa98a68), 6);
      arm.position.set(s * 0.2, 0.42, 0); arm.rotation.z = s * 0.8; g.add(arm);
    }
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const leaf = cone(0.09, 0.42, M.leaf, 6);
      leaf.scale.z = 0.4;
      leaf.position.set(Math.cos(a) * 0.1, 0.68, Math.sin(a) * 0.1);
      leaf.rotation.set(Math.sin(a) * 0.6, 0, -Math.cos(a) * 0.6);
      g.add(leaf);
    }
    return g;
  },
  'hw-devils-snare': () => {
    const g = new THREE.Group();
    for (let i = 0; i < 7; i++) {
      const cx = (rnd(i * 3) - 0.5) * 0.9, cz = (rnd(i * 7) - 0.5) * 0.9;
      g.add(tube([
        [cx - 0.55, 0.06, cz], [cx - 0.2, 0.3 + rnd(i) * 0.25, cz + 0.25],
        [cx + 0.25, 0.12, cz - 0.2], [cx + 0.55, 0.3, cz + 0.1],
      ], 0.05, M.leafDark));
      const blob = sph(0.13, M.leaf, 1, 0.7, 1);
      blob.position.set(cx, 0.3 + rnd(i + 4) * 0.2, cz); g.add(blob);
    }
    return g;
  },
  'hw-willow-branch': () => {
    const g = new THREE.Group();
    const bark = std(0x4c3a28, { r: 1 });
    const main = cyl(0.07, 0.11, 1.9, bark, 8);
    main.rotation.z = 0.65; main.position.set(-0.4, 0.75, 0); g.add(main);
    for (let i = 0; i < 5; i++) {
      const hx = 0.05 + i * 0.22, len = 0.85 + rnd(i + 30) * 0.4;
      g.add(at(cyl(0.016, 0.024, len, bark, 5), hx, 1.62 - len, (rnd(i + 40) - 0.5) * 0.3));
      const blob = sph(0.16, M.leafDark, 1.1, 0.8, 1.1);
      blob.position.set(hx, 1.55 - len * 0.45, 0); g.add(blob);
    }
    return g;
  },
};

function buildOwl(bodyM, faceM, speckled) {
  const g = new THREE.Group();
  g.add(at(cyl(0.05, 0.06, 0.34, M.woodDark, 8), 0, 0, 0));
  const perch = cyl(0.045, 0.045, 0.85, M.wood, 8);
  perch.rotation.z = Math.PI / 2; perch.position.y = 0.36; g.add(perch);
  const body = sph(0.33, bodyM, 1, 1.12, 0.92); body.position.y = 0.78; g.add(body);
  const face = sph(0.21, faceM, 1, 1, 0.5); face.position.set(0, 0.95, 0.2); g.add(face);
  for (const s of [1, -1]) {
    const eye = sph(0.055, std(0x1c1c20, { r: 0.3 })); eye.position.set(s * 0.09, 1.0, 0.38); g.add(eye);
    g.add(at(cone(0.06, 0.16, bodyM, 6), s * 0.14, 1.14, 0.02));
    const wing = box(0.07, 0.5, 0.3, speckled ? std(0xd3d5d9) : bodyM);
    wing.position.set(s * 0.31, 0.5, -0.02); wing.rotation.z = s * 0.18; g.add(wing);
  }
  const beak = cone(0.05, 0.12, M.gold, 6);
  beak.rotation.x = Math.PI; beak.position.set(0, 0.9, 0.4); g.add(beak);
  if (speckled) for (let i = 0; i < 6; i++) {
    const sp = sph(0.045, std(0x3a3a40), 1, 0.5, 0.4);
    sp.position.set((rnd(i + 3) - 0.5) * 0.4, 0.6 + rnd(i + 8) * 0.35, 0.27);
    g.add(sp);
  }
  return g;
}
function buildPotion(color) {
  const g = new THREE.Group();
  const liquid = std(color, { r: 0.25, e: color, ei: 0.35 });
  const b = sph(0.27, liquid, 1, 0.95, 1); b.position.y = 0.26; g.add(b);
  g.add(at(cyl(0.09, 0.11, 0.3, liquid, 10), 0, 0.44, 0));
  g.add(at(cyl(0.1, 0.1, 0.13, std(0xc9a06a, { r: 1 }), 10), 0, 0.72, 0));
  return g;
}

/** 巫师基础体：锥形长袍 + 球头 + 尖顶帽。教授加胡子，海格走 hagrid 变体（×1.6+大胡子）。 */
function buildWizardFigure({ robe, trim, hatH = 0.85, beard = null, hagrid = false } = {}) {
  const g = new THREE.Group();
  const robeM = std(robe, { r: 0.95 });
  g.add(cyl(0.30, 0.62, 1.55, robeM, 14));
  const chest = sph(0.30, robeM, 1, 0.72, 1); chest.position.y = 1.52; g.add(chest);
  g.add(at(cyl(0.235, 0.25, 0.15, std(trim), 12), 0, 1.68, 0));
  const head = sph(0.21, M.skin); head.position.y = 1.98; g.add(head);
  if (beard) {
    const b = cone(0.15, 0.52, std(beard, { r: 1 }), 8);
    b.position.set(0, 1.58, 0.13); b.rotation.x = 0.2; g.add(b);
  }
  if (hagrid) {
    const hairM = std(0x4a3421, { r: 1 });
    const hair = sph(0.24, hairM, 1, 0.92, 1); hair.position.set(0, 2.05, -0.04); g.add(hair);
    const bigBeard = sph(0.21, hairM, 1.05, 1.3, 0.8); bigBeard.position.set(0, 1.76, 0.1); g.add(bigBeard);
  } else {
    const hatM = std(0x2b2b30, { r: 0.9 });
    g.add(at(cyl(0.37, 0.37, 0.045, hatM, 18), 0, 2.1, 0));
    g.add(at(cone(0.30, hatH, hatM, 14), 0, 2.12, 0));
    const tip = cone(0.12, 0.34, hatM, 10);
    tip.position.set(0.1, 2.12 + hatH - 0.08, 0); tip.rotation.z = -0.55; g.add(tip);
  }
  for (const s of [1, -1]) {
    const arm = cyl(0.065, 0.075, 0.62, robeM, 8);
    arm.position.set(s * 0.36, 1.04, 0.02); arm.rotation.z = s * 0.42; g.add(arm);
  }
  const wand = cyl(0.016, 0.02, 0.5, M.woodDark, 6);
  wand.position.set(0.5, 0.9, 0.22); wand.rotation.set(0.9, 0, -0.5); g.add(wand);
  if (hagrid) g.scale.setScalar(1.6);
  return g;
}

/** 摄魂怪：黑破袍 + 兜帽黑脸 + 前伸细臂，整体离地漂浮。 */
function buildDementor() {
  const g = new THREE.Group();
  const robeM = std(0x17171c, { r: 1 });
  const inner = new THREE.Group(); inner.position.y = 0.34;
  inner.add(cyl(0.30, 0.68, 1.9, robeM, 14));
  const chest = sph(0.31, robeM, 1, 0.7, 1); chest.position.y = 1.86; inner.add(chest);
  const hood = sph(0.27, std(0x1d1d22, { r: 1 })); hood.position.y = 2.08; inner.add(hood);
  const face = sph(0.185, std(0x050506, { r: 1 })); face.position.set(0, 2.04, 0.1); inner.add(face);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const tat = cone(0.13, 0.42, robeM, 6);
    tat.rotation.x = Math.PI;
    tat.position.set(Math.cos(a) * 0.5, 0.08, Math.sin(a) * 0.5);
    inner.add(tat);
  }
  for (const s of [1, -1]) {
    const arm = cyl(0.045, 0.05, 0.78, robeM, 7);
    arm.position.set(s * 0.33, 1.52, 0.12); arm.rotation.x = 1.85; arm.rotation.z = s * -0.15;
    inner.add(arm);
  }
  g.add(inner);
  return g;
}

const HW_DIRS = { down: 0, up: Math.PI, left: -Math.PI / 2, right: Math.PI / 2 };
function hwShowScale(name) {
  if (/tower|hall|astro|express/.test(name)) return 0.42;
  if (/wall|greenhouse|hut|willow|hoops|dock|gate/.test(name)) return 0.6;
  if (/spider|basilisk|hippogriff|owl|cat/.test(name)) return 1.1;
  return 1.7;
}
async function renderCatalog(out) {
  for (const [name, build] of Object.entries(HW_BUILDERS)) {
    status('rendering ' + name);
    out[name] = renderGroup(build());
    showSprite(name, out[name].canvas, hwShowScale(name));
  }
  const figures = {
    'hw-wizard-gryffindor': () => buildWizardFigure({ robe: 0x8e2323, trim: 0xd9a441 }),
    'hw-wizard-slytherin': () => buildWizardFigure({ robe: 0x1f5c3d, trim: 0xc9ccd2 }),
    'hw-wizard-ravenclaw': () => buildWizardFigure({ robe: 0x27436e, trim: 0xb08d57 }),
    'hw-wizard-hufflepuff': () => buildWizardFigure({ robe: 0xd9a92c, trim: 0x2b2b30 }),
    'hw-professor': () => buildWizardFigure({ robe: 0x23232a, trim: 0x23232a, hatH: 1.05, beard: 0xcfd2d6 }),
    'hw-hagrid': () => buildWizardFigure({ robe: 0x6b4a2f, trim: 0x54381f, hagrid: true }),
    'hw-dementor': () => buildDementor(),
  };
  for (const [base, build] of Object.entries(figures)) {
    const fig = build();
    for (const [dir, yaw] of Object.entries(HW_DIRS)) {
      fig.rotation.y = yaw;
      const name = `${base}-${dir}`;
      status('rendering ' + name);
      out[name] = renderGroup(fig);
      if (dir === 'down') showSprite(name, out[name].canvas, 1.4);
    }
  }
}

// ------------------------------------------------------------ page bootstrap
const grid = document.getElementById('grid');
export function showSprite(name, canvas, scale = 1) {
  const cell = document.createElement('div');
  cell.className = 'cell';
  const img = new Image();
  img.src = canvas.toDataURL('image/png');
  img.style.width = Math.round(canvas.width * scale) + 'px';
  const label = document.createElement('div');
  label.textContent = name + ` ${canvas.width}×${canvas.height}`;
  cell.append(img, label);
  grid.append(cell);
}

/** 屋顶坡面调试：低角度渲染左/右坡面单件与成对组合，看清坡向。 */
async function debugRoof() {
  const saved = ELEV;
  ELEV = THREE.MathUtils.degToRad(28);
  try {
    const lp = await piece(FT + 'roof-left.glb');
    const rp = await piece(FT + 'roof-right.glb');
    showSprite('dbg-roof-left', renderGroup(lp.obj).canvas, 2);
    showSprite('dbg-roof-right', renderGroup(rp.obj).canvas, 2);
    const pair = new THREE.Group();
    pair.add(put(lp, -0.51, 0, 0, 0));
    pair.add(put(rp, 0.51, 0, 0, 0));
    showSprite('dbg-pair-asbuilt', renderGroup(pair).canvas, 2);
    const pair2 = new THREE.Group();
    const lp2 = await piece(FT + 'roof-left.glb');
    const rp2 = await piece(FT + 'roof-right.glb');
    pair2.add(put(rp2, -0.51, 0, 0, 0));
    pair2.add(put(lp2, 0.51, 0, 0, 0));
    showSprite('dbg-pair-swapped', renderGroup(pair2).canvas, 2);
    const ge = await piece(FT + 'roof-gable-end.glb');
    showSprite('dbg-gable-end', renderGroup(ge.obj).canvas, 2);
  } finally { ELEV = saved; }
}

/** 截面轮廓：零件顶点按 x 分箱，返回每箱的最高 y（看清坡面形状）。 */
async function profile(name) {
  const p = await piece(FT + name + '.glb');
  const bins = new Map();
  const v = new THREE.Vector3();
  p.obj.updateMatrixWorld(true);
  p.obj.traverse((o) => {
    if (!o.isMesh) return;
    const pos = o.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      const k = Math.round(v.x * 10) / 10;
      bins.set(k, Math.max(bins.get(k) ?? -1e9, v.y));
    }
  });
  return [...bins.entries()].sort((a, b) => a[0] - b[0])
    .map(([x, y]) => `${x.toFixed(1)}:${y.toFixed(2)}`).join(' ');
}

window.__factory = { ready: true, measure, renderPiece, renderAll, showSprite, debugRoof, profile, PPM };
status('ready');
