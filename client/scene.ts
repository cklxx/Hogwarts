import * as THREE from 'three';
import { Water } from 'three/addons/objects/Water.js';
import { AZKABAN, OBSTACLES, mulberry32, type Obstacle } from '../src/shared/map';
import { tex as fileTex } from './assets';
import { cylUV, glowSprite, makeMaterials, waterNormals, worldUV } from './textures';

export interface WorldScene {
  /** Emissive materials that should brighten at night (windows, candles). */
  nightGlow: THREE.MeshStandardMaterial[];
  /** Points where house banners hang: position + facing yaw. */
  bannerSpots: { x: number; y: number; z: number; yaw: number }[];
  lake: Water | null;
  tick(t: number, dt: number, willowAngry: boolean, sunDir: THREE.Vector3): void;
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
  const windowMat = glowMat(0xffc46b);
  const candleMat = glowMat(0xfff1c4);
  const leaf = new THREE.MeshStandardMaterial({ color: 0x2a4a26, roughness: 1, flatShading: true });
  const trunk = new THREE.MeshStandardMaterial({ color: 0x3d2b1a, roughness: 1 });
  const gold = new THREE.MeshStandardMaterial({ color: 0xd4af37, metalness: 0.9, roughness: 0.3 });
  const rock = M.rock;
  const marble = new THREE.MeshStandardMaterial({ color: 0xf4f4f0, roughness: 0.25 });
  const add = <T extends THREE.Object3D>(o: T, shadow = true) => {
    if (shadow) o.traverse((c) => { if ((c as THREE.Mesh).isMesh) { c.castShadow = true; c.receiveShadow = true; } });
    scene.add(o);
    return o;
  };

  // ---- ground: segmented disc with low-frequency vertex colour variation (hides tiling)
  const groundGeo = new THREE.PlaneGeometry(640, 640, 160, 160);
  const colors: number[] = [];
  const pos = groundGeo.getAttribute('position');
  const n2 = (x: number, y: number) => Math.sin(x * 0.021) * Math.cos(y * 0.017) + 0.5 * Math.sin(x * 0.047 + y * 0.031) + 0.25 * Math.cos(x * 0.11 - y * 0.09);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i);
    const v = n2(x, y);
    const dry = Math.max(0, v) * 0.25;
    colors.push(0.85 + v * 0.1 + dry, 0.9 + v * 0.08, 0.8 + v * 0.05 - dry * 0.5);
    // gentle rolling hills away from the castle and paths, sinking at the shore
    const r = Math.hypot(x, y);
    if (r > 300) pos.setZ(i, -2);
  }
  groundGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const ground = new THREE.Mesh(groundGeo, M.grass);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const sea = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.MeshStandardMaterial({ color: 0x0f1f2c, roughness: 0.15, metalness: 0.3 }));
  sea.rotation.x = -Math.PI / 2;
  sea.position.y = -1.2;
  scene.add(sea);

  // ---- paths and courtyard (cobbles, world-scaled)
  const road = (x0: number, z0: number, x1: number, z1: number, w = 4) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const geo = new THREE.PlaneGeometry(w, len);
    const uv = geo.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * w) / 3, (uv.getY(i) * len) / 3);
    const m = new THREE.Mesh(geo, M.path);
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = -Math.atan2(x1 - x0, z1 - z0);
    m.position.set((x0 + x1) / 2, 0.02, (z0 + z1) / 2);
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
  let lake: Water | null = null;
  const trees: Obstacle[] = [];

  for (const o of OBSTACLES) {
    if (o.style === 'tree') { trees.push(o); continue; }
    if (o.kind === 'box') {
      const w = o.x1 - o.x0, d = o.z1 - o.z0;
      const cx = (o.x0 + o.x1) / 2, cz = (o.z0 + o.z1) / 2;
      const isHouse = o.style === 'house';
      const isGlass = o.label === 'Greenhouse Three';
      const mat = isGlass
        ? new THREE.MeshPhysicalMaterial({ color: 0xcfeede, roughness: 0.05, transmission: 0.6, transparent: true, opacity: 0.55 })
        : isHouse ? M.tudor : o.style === 'wood' ? M.wood : M.stone;
      const b = add(new THREE.Mesh(worldUV(new THREE.BoxGeometry(w, o.h, d), w, o.h, d, isHouse ? 5 : 4), mat));
      b.position.set(cx, o.h / 2, cz);
      if (isHouse || o.style === 'wood') {
        const roof = add(new THREE.Mesh(new THREE.ConeGeometry(Math.max(w, d) * 0.72, o.h * 0.7, 4), M.roof));
        roof.position.set(cx, o.h + o.h * 0.35, cz);
        roof.rotation.y = Math.PI / 4;
        roof.scale.set(w / Math.max(w, d), 1, d / Math.max(w, d));
        if (isHouse && !isGlass) {
          const chimney = add(new THREE.Mesh(worldUV(new THREE.BoxGeometry(1.2, 4, 1.2), 1.2, 4, 1.2, 2), M.darkStone));
          chimney.position.set(o.x1 - 2, o.h + 2.5, o.z0 + 2);
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
        // arched glowing windows on the south face
        const win = new THREE.PlaneGeometry(0.9, 1.8);
        for (let i = 1; i < n; i += 2)
          for (let y = 4; y < o.h - 2; y += 5) {
            const m = new THREE.Mesh(win, windowMat);
            m.position.set(o.x0 + (i * w) / n, y, o.z1 + 0.06);
            scene.add(m);
          }
        bannerSpots.push({ x: cx - w * 0.25, y: o.h - 3, z: o.z1 + 0.12, yaw: 0 }, { x: cx + w * 0.25, y: o.h - 3, z: o.z1 + 0.12, yaw: 0 });
      }
      continue;
    }
    switch (o.style) {
      case 'water': {
        const geo = new THREE.CircleGeometry(o.r, 64);
        const shore = new THREE.Mesh(new THREE.RingGeometry(o.r - 1, o.r + 7, 72, 1), M.sand);
        shore.rotation.x = -Math.PI / 2;
        shore.position.set(o.x, 0.04, o.z);
        shore.receiveShadow = true;
        scene.add(shore);
        const normals = fileTex('water_normal.webp', { srgb: false, fallback: waterNormals() });
        lake = new Water(geo, {
          textureWidth: 512, textureHeight: 512, waterNormals: normals,
          sunDirection: new THREE.Vector3(0.5, 0.8, 0.2), sunColor: 0xfff1d6, waterColor: 0x0c2a3a, distortionScale: 2.2, fog: true,
        });
        lake.rotation.x = -Math.PI / 2;
        lake.position.set(o.x, 0.08, o.z);
        scene.add(lake);
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
        const t = add(new THREE.Mesh(cylUV(new THREE.CylinderGeometry(o.r, o.r * 1.06, o.h, 24, 1, true), o.r, o.h, 4), M.stone));
        t.position.set(o.x, o.h / 2, o.z);
        const roof = add(new THREE.Mesh(new THREE.ConeGeometry(o.r * 1.3, o.r * 2.8, 24), M.roof));
        roof.position.set(o.x, o.h + o.r * 1.4, o.z);
        const spire = add(new THREE.Mesh(new THREE.ConeGeometry(0.12, 2.5, 6), gold), false);
        spire.position.set(o.x, o.h + o.r * 2.8 + 1, o.z);
        for (let y = 6; y < o.h; y += 7) {
          const m = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.8), windowMat);
          m.position.set(o.x, y, o.z + o.r + 0.06);
          scene.add(m);
        }
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
        const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(4.2, 1), leaf);
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
        const hut = add(new THREE.Mesh(cylUV(new THREE.CylinderGeometry(o.r, o.r, o.h * 0.6, 12), o.r, o.h * 0.6, 3), M.wood));
        hut.position.set(o.x, o.h * 0.3, o.z);
        const roof = add(new THREE.Mesh(new THREE.ConeGeometry(o.r * 1.35, o.h * 0.65, 12), M.roof));
        roof.position.set(o.x, o.h * 0.92, o.z);
        const lamp = new THREE.PointLight(0xffb060, 6, 14, 1.6);
        lamp.position.set(o.x, 2.5, o.z + o.r + 0.8);
        scene.add(lamp);
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
        const c = add(new THREE.Mesh(cylUV(new THREE.CylinderGeometry(o.r, o.r * 1.1, o.h, 12), o.r, o.h, 3), M.stone));
        c.position.set(o.x, o.h / 2, o.z);
        const cap = add(new THREE.Mesh(new THREE.BoxGeometry(o.r * 2.6, 0.5, o.r * 2.6), M.darkStone));
        cap.position.set(o.x, o.h + 0.25, o.z);
      }
    }
  }

  // ---- the Forbidden Forest: instanced, with per-tree colour jitter
  const trunkI = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.35, 0.5, 1, 6), trunk, trees.length);
  const crownI = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 1, 7, 2), leaf, trees.length * 2);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const col = new THREE.Color();
  const jr = mulberry32(7);
  trees.forEach((t, i) => {
    if (t.kind !== 'disc') return;
    m4.compose(new THREE.Vector3(t.x, t.h * 0.2, t.z), q, new THREE.Vector3(t.r, t.h * 0.4, t.r));
    trunkI.setMatrixAt(i, m4);
    for (let k = 0; k < 2; k++) {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), jr() * 6);
      m4.compose(new THREE.Vector3(t.x, t.h * (0.55 + k * 0.25), t.z), q, new THREE.Vector3(t.r * (3.4 - k * 1.1), t.h * (0.55 - k * 0.15), t.r * (3.4 - k * 1.1)));
      crownI.setMatrixAt(i * 2 + k, m4);
      crownI.setColorAt(i * 2 + k, col.setHSL(0.28 + jr() * 0.08, 0.45, 0.55 + jr() * 0.35));
    }
    q.identity();
  });
  trunkI.castShadow = crownI.castShadow = true;
  crownI.receiveShadow = true;
  scene.add(trunkI, crownI);

  // ---- grass tufts and wildflowers scattered on the grounds (instanced crossed quads)
  const tuftTex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    for (let i = 0; i < 26; i++) {
      g.strokeStyle = `hsl(${95 + Math.random() * 25},45%,${28 + Math.random() * 18}%)`;
      g.lineWidth = 2;
      const x = 16 + Math.random() * 32;
      g.beginPath(); g.moveTo(x, 64); g.quadraticCurveTo(x + (Math.random() - 0.5) * 10, 40, x + (Math.random() - 0.5) * 20, 10 + Math.random() * 20); g.stroke();
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  const tuftMat = new THREE.MeshStandardMaterial({ map: tuftTex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 1 });
  const tuftGeo = new THREE.PlaneGeometry(1.2, 0.8);
  tuftGeo.translate(0, 0.4, 0);
  const TUFTS = 5000;
  const tufts = new THREE.InstancedMesh(tuftGeo, tuftMat, TUFTS);
  const tr = mulberry32(11);
  for (let i = 0; i < TUFTS; i++) {
    let x = 0, z = 0;
    for (let tries = 0; tries < 6; tries++) {
      x = (tr() - 0.5) * 420; z = (tr() - 0.5) * 420;
      const inCastle = x > -70 && x < 70 && z > -125 && z < -5;
      const inLake = Math.hypot(x + 110, z - 40) < 57;
      const onRoad = Math.abs(x) < 4 && z > -40 && z < 150;
      if (!inCastle && !inLake && !onRoad) break;
    }
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), tr() * Math.PI);
    const s = 0.6 + tr() * 0.9;
    m4.compose(new THREE.Vector3(x, 0, z), q, new THREE.Vector3(s, s, s));
    tufts.setMatrixAt(i, m4);
  }
  scene.add(tufts);

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
  for (const x of [-7.5, -2.5, 2.5, 7.5]) {
    const t = add(new THREE.Mesh(worldUV(new THREE.BoxGeometry(1.4, 0.9, 22), 1.4, 0.9, 22, 2), M.wood));
    t.position.set(x, 0.45, -55);
  }

  // ---- Mirror of Erised & Barnabas the Barmy's tapestry
  const frame = add(new THREE.Mesh(new THREE.BoxGeometry(2.4, 4.2, 0.3), gold));
  frame.position.set(30, 2.1, -62.5);
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 3.4), new THREE.MeshStandardMaterial({ color: 0x9fb8d9, metalness: 1, roughness: 0.05, emissive: 0x1b2b48, emissiveIntensity: 0.8 }));
  glass.position.set(30, 2.1, -62.3);
  scene.add(glass);
  const tap = new THREE.Mesh(new THREE.PlaneGeometry(6, 4), new THREE.MeshStandardMaterial({ color: 0x7a2e5a, roughness: 1 }));
  tap.position.set(-32, 5, -63.9);
  scene.add(tap);

  // ---- torches along the main path (real lights, few of them)
  for (const z of [0, 40, 80, 120]) {
    const post = add(new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 3, 6), trunk));
    post.position.set(3.2, 1.5, z);
    const flame = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowSprite('rgba(255,190,90,1)', 'rgba(255,120,30,0)'), blending: THREE.AdditiveBlending, depthWrite: false }));
    flame.scale.setScalar(1.4);
    flame.position.set(3.2, 3.2, z);
    scene.add(flame);
    const l = new THREE.PointLight(0xff9a40, 0, 16, 1.8);
    l.position.set(3.2, 3.3, z);
    l.name = 'torch';
    scene.add(l);
  }

  const candles: THREE.Object3D[] = [];
  const torches: THREE.PointLight[] = [];
  scene.traverse((o) => { if (o.name === 'candle') candles.push(o); if (o.name === 'torch') torches.push(o as THREE.PointLight); });
  const squid = scene.getObjectByName('squid');
  const arms = scene.getObjectByName('willow')?.getObjectByName('arms');

  const lakeReflect = lake ? (lake as Water).onBeforeRender : null;
  return {
    nightGlow, bannerSpots, lake,
    setQuality(q) {
      tufts.visible = q === 'high';
      // the lake's mirror pass re-renders the whole scene; freeze it on weak GPUs
      if (lake && lakeReflect) (lake as Water).onBeforeRender = q === 'high' ? lakeReflect : () => {};
    },
    tick(t, dt, willowAngry, sunDir) {
      if (squid) { squid.rotation.y = t * 0.2; squid.position.y = Math.sin(t) * 0.4 - 0.6; }
      if (arms) arms.rotation.y += willowAngry ? 0.25 : 0.004;
      candles.forEach((c, i) => { c.position.y += Math.sin(t * 1.3 + i) * 0.003; });
      const night = sunDir.y < 0.05;
      torches.forEach((l, i) => { l.intensity = night ? 9 + Math.sin(t * 13 + i * 3) * 1.5 + Math.sin(t * 7.3 + i) : 0; });
      if (lake) {
        lake.material.uniforms.time.value += dt * 0.6;
        (lake.material.uniforms.sunDirection.value as THREE.Vector3).copy(sunDir);
      }
    },
  };
}
