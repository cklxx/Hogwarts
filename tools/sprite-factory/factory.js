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
  status('done');
  return out;
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
