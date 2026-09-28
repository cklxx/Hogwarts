import * as THREE from 'three';
import { AZKABAN, OBSTACLES, type Obstacle } from '../src/shared/map';

/** Builds the static world from the shared map: the same data the server collides against. */
export function buildWorld(scene: THREE.Scene) {
  const mat = {
    grass: new THREE.MeshLambertMaterial({ color: 0x4d7a3a }),
    stone: new THREE.MeshLambertMaterial({ color: 0x8d8a82 }),
    darkStone: new THREE.MeshLambertMaterial({ color: 0x6f6b64 }),
    roof: new THREE.MeshLambertMaterial({ color: 0x2c3548 }),
    wood: new THREE.MeshLambertMaterial({ color: 0x6b4a2b }),
    house: new THREE.MeshLambertMaterial({ color: 0xc9b99a }),
    houseRoof: new THREE.MeshLambertMaterial({ color: 0x5b3a2a }),
    water: new THREE.MeshPhongMaterial({ color: 0x1d3f5c, shininess: 90, transparent: true, opacity: 0.92 }),
    sea: new THREE.MeshPhongMaterial({ color: 0x14222e, shininess: 60 }),
    tomb: new THREE.MeshLambertMaterial({ color: 0xf4f4f0 }),
    leaf: new THREE.MeshLambertMaterial({ color: 0x1f3d22 }),
    trunk: new THREE.MeshLambertMaterial({ color: 0x3d2b1a }),
    gold: new THREE.MeshPhongMaterial({ color: 0xd4af37, shininess: 80 }),
    rock: new THREE.MeshLambertMaterial({ color: 0x2b2b30 }),
    path: new THREE.MeshLambertMaterial({ color: 0x9c8b6a }),
    glass: new THREE.MeshPhongMaterial({ color: 0xbfe6c8, transparent: true, opacity: 0.45 }),
  };

  const sea = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000), mat.sea);
  sea.rotation.x = -Math.PI / 2;
  sea.position.y = -0.6;
  scene.add(sea);
  const ground = new THREE.Mesh(new THREE.CircleGeometry(300, 64), mat.grass);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  // Paths: castle -> Hogsmeade, castle -> Hagrid, castle -> pitch
  const road = (x0: number, z0: number, x1: number, z1: number, w = 4) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, len), mat.path);
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = -Math.atan2(x1 - x0, z1 - z0);
    m.position.set((x0 + x1) / 2, 0.02, (z0 + z1) / 2);
    scene.add(m);
  };
  road(0, -40, 0, 150, 5);
  road(0, -10, 90, 36, 3);
  road(20, -60, 40, -122, 3);
  const court = new THREE.Mesh(new THREE.PlaneGeometry(50, 36), mat.path);
  court.rotation.x = -Math.PI / 2;
  court.position.set(0, 0.03, -22);
  scene.add(court);
  const hallFloor = new THREE.Mesh(new THREE.PlaneGeometry(24, 31), new THREE.MeshLambertMaterial({ color: 0x5a4632 }));
  hallFloor.rotation.x = -Math.PI / 2;
  hallFloor.position.set(0, 0.04, -56.5);
  scene.add(hallFloor);

  // Azkaban island
  const isle = new THREE.Mesh(new THREE.CylinderGeometry(14, 18, 1.2, 9), mat.rock);
  isle.position.set(AZKABAN.x, 0, AZKABAN.z);
  scene.add(isle);

  const trees: Obstacle[] = [];
  for (const o of OBSTACLES) {
    if (o.style === 'tree') { trees.push(o); continue; }
    if (o.kind === 'box') {
      const w = o.x1 - o.x0, d = o.z1 - o.z0;
      const cx = (o.x0 + o.x1) / 2, cz = (o.z0 + o.z1) / 2;
      const m = o.style === 'house' ? (o.label === 'Greenhouse Three' ? mat.glass : mat.house) : o.style === 'wood' ? mat.wood : mat.stone;
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, o.h, d), m);
      b.position.set(cx, o.h / 2, cz);
      b.castShadow = b.receiveShadow = true;
      scene.add(b);
      if (o.style === 'house' || o.style === 'wood') {
        const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.max(w, d) * 0.72, o.h * 0.6, 4), mat.houseRoof);
        roof.position.set(cx, o.h + o.h * 0.3, cz);
        roof.rotation.y = Math.PI / 4;
        roof.scale.set(w / Math.max(w, d), 1, d / Math.max(w, d));
        scene.add(roof);
      } else if (o.h > 15) {
        // battlements
        const n = Math.floor(w / 3);
        for (let i = 0; i <= n; i++) for (const zz of [o.z0, o.z1]) {
          const c = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.4, 1.2), mat.darkStone);
          c.position.set(o.x0 + (i * w) / Math.max(1, n), o.h + 0.7, zz);
          scene.add(c);
        }
        // lit windows
        const winMat = new THREE.MeshBasicMaterial({ color: 0xffd27a });
        for (let i = 1; i < n; i += 2) for (let y = 4; y < o.h - 2; y += 5) {
          const win = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 1.6), winMat);
          win.position.set(o.x0 + (i * w) / n, y, o.z1 + 0.05);
          scene.add(win);
        }
      }
      continue;
    }
    // discs
    switch (o.style) {
      case 'water': {
        const lake = new THREE.Mesh(new THREE.CircleGeometry(o.r, 48), mat.water);
        lake.rotation.x = -Math.PI / 2;
        lake.position.set(o.x, 0.05, o.z);
        scene.add(lake);
        // the giant squid, obviously
        const squid = new THREE.Group();
        for (let i = 0; i < 5; i++) {
          const t = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.5, 5, 6), new THREE.MeshLambertMaterial({ color: 0x6b3b5a }));
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
        const t = new THREE.Mesh(new THREE.CylinderGeometry(o.r, o.r * 1.05, o.h, 16), mat.stone);
        t.position.set(o.x, o.h / 2, o.z);
        t.castShadow = true;
        scene.add(t);
        const roof = new THREE.Mesh(new THREE.ConeGeometry(o.r * 1.25, o.r * 2.6, 16), mat.roof);
        roof.position.set(o.x, o.h + o.r * 1.3, o.z);
        scene.add(roof);
        const winMat = new THREE.MeshBasicMaterial({ color: 0xffd27a });
        for (let y = 6; y < o.h; y += 7) {
          const win = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 1.6), winMat);
          win.position.set(o.x, y, o.z + o.r + 0.05);
          scene.add(win);
        }
        break;
      }
      case 'willow': {
        const g = new THREE.Group();
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(1.2, o.r, o.h * 0.6, 8), mat.trunk);
        trunk.position.y = o.h * 0.3;
        g.add(trunk);
        const arms = new THREE.Group();
        arms.name = 'arms';
        for (let i = 0; i < 7; i++) {
          const b = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.4, 7, 5), mat.trunk);
          b.position.set(Math.cos(i) * 3, 0, Math.sin(i) * 3);
          b.rotation.set(Math.sin(i) * 0.9, 0, Math.cos(i) * 0.9);
          arms.add(b);
        }
        arms.position.y = o.h * 0.6;
        g.add(arms);
        const crown = new THREE.Mesh(new THREE.SphereGeometry(4, 10, 8), mat.leaf);
        crown.position.y = o.h * 0.75;
        g.add(crown);
        g.position.set(o.x, 0, o.z);
        g.name = 'willow';
        scene.add(g);
        break;
      }
      case 'tomb': {
        const t = new THREE.Mesh(new THREE.BoxGeometry(o.r * 2.2, o.h, o.r * 1.3), mat.tomb);
        t.position.set(o.x, o.h / 2, o.z);
        scene.add(t);
        break;
      }
      case 'wood': {
        const hut = new THREE.Mesh(new THREE.CylinderGeometry(o.r, o.r, o.h * 0.6, 10), mat.wood);
        hut.position.set(o.x, o.h * 0.3, o.z);
        scene.add(hut);
        const roof = new THREE.Mesh(new THREE.ConeGeometry(o.r * 1.3, o.h * 0.6, 10), mat.houseRoof);
        roof.position.set(o.x, o.h * 0.9, o.z);
        scene.add(roof);
        break;
      }
      case 'hoop': {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.25, o.h, 6), mat.gold);
        pole.position.set(o.x, o.h / 2, o.z);
        scene.add(pole);
        const ring = new THREE.Mesh(new THREE.TorusGeometry(1.6, 0.18, 6, 20), mat.gold);
        ring.position.set(o.x, o.h + 1.6, o.z);
        scene.add(ring);
        break;
      }
      case 'rock': {
        const r = new THREE.Mesh(new THREE.CylinderGeometry(o.r * 2, o.r * 4, o.h, 5), mat.rock);
        r.position.set(o.x, o.h / 2, o.z);
        scene.add(r);
        break;
      }
      default: {
        const c = new THREE.Mesh(new THREE.CylinderGeometry(o.r, o.r, o.h, 10), mat.stone);
        c.position.set(o.x, o.h / 2, o.z);
        scene.add(c);
      }
    }
  }

  // The Forbidden Forest (instanced)
  const trunkGeo = new THREE.CylinderGeometry(0.35, 0.5, 1, 6);
  const crownGeo = new THREE.ConeGeometry(1, 1, 7);
  const trunkI = new THREE.InstancedMesh(trunkGeo, mat.trunk, trees.length);
  const crownI = new THREE.InstancedMesh(crownGeo, mat.leaf, trees.length);
  const m4 = new THREE.Matrix4();
  trees.forEach((t, i) => {
    if (t.kind !== 'disc') return;
    m4.compose(new THREE.Vector3(t.x, t.h * 0.2, t.z), new THREE.Quaternion(), new THREE.Vector3(t.r, t.h * 0.4, t.r));
    trunkI.setMatrixAt(i, m4);
    m4.compose(new THREE.Vector3(t.x, t.h * 0.65, t.z), new THREE.Quaternion(), new THREE.Vector3(t.r * 3.2, t.h * 0.75, t.r * 3.2));
    crownI.setMatrixAt(i, m4);
  });
  scene.add(trunkI, crownI);

  // Great Hall: floating candles and house tables
  const candleMat = new THREE.MeshBasicMaterial({ color: 0xfff1c4 });
  for (let i = 0; i < 40; i++) {
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.5, 5), candleMat);
    c.position.set(-10 + (i % 8) * 2.9, 8 + Math.sin(i) * 0.6, -69 + Math.floor(i / 8) * 6);
    c.name = 'candle';
    scene.add(c);
  }
  const tableMat = new THREE.MeshLambertMaterial({ color: 0x4a3322 });
  for (const x of [-7.5, -2.5, 2.5, 7.5]) {
    const t = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.9, 22), tableMat);
    t.position.set(x, 0.45, -55);
    scene.add(t);
  }

  // Mirror of Erised
  const frame = new THREE.Mesh(new THREE.BoxGeometry(2.4, 4.2, 0.3), mat.gold);
  frame.position.set(30, 2.1, -62.5);
  scene.add(frame);
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 3.4), new THREE.MeshPhongMaterial({ color: 0x9fb8d9, shininess: 200, emissive: 0x16233a }));
  glass.position.set(30, 2.1, -62.3);
  scene.add(glass);
  // Barnabas the Barmy's tapestry
  const tap = new THREE.Mesh(new THREE.PlaneGeometry(6, 4), new THREE.MeshLambertMaterial({ color: 0x7a2e5a }));
  tap.position.set(-32, 5, -63.9);
  scene.add(tap);

  return {
    tick(t: number, willowAngry: boolean) {
      const squid = scene.getObjectByName('squid');
      if (squid) { squid.rotation.y = t * 0.2; squid.position.y = Math.sin(t) * 0.4 - 0.6; }
      const willow = scene.getObjectByName('willow')?.getObjectByName('arms');
      if (willow) willow.rotation.y += willowAngry ? 0.25 : 0.004;
    },
  };
}
