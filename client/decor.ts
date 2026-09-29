import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';
import { HOUSE_COLORS, type House } from '../src/shared/constants';
import { Pool } from './fx';
import { StoryStandardMaterial } from './storybook';
import { bannerTexture, glowSprite } from './textures';
import { heightAt } from './terrain';
import { STATUE_SPOTS, statueYaw } from '../src/shared/layout';

export interface Statue { name: string; house: House; term: number; inscription: string }
export interface Look {
  skyTint: string; sunIntensity: number; fogDensity: number; glow: number;
  lanterns: boolean; fireworks: boolean; aurora: boolean;
  banner: House | null; cupHouse: House | null; statues: Statue[];
}

const hex = (n: number) => '#' + n.toString(16).padStart(6, '0');

const T = TSL as unknown as Record<string, any>;
const { Fn, vec3, vec4, float, uniform, sin, cos, mod, pow, smoothstep, mix, uv, positionGeometry, modelWorldMatrix, instancedBufferAttribute, instanceIndex } = T;

/**
 * Glowing dots that drift by a formula of time (lanterns, fireflies): screen-facing sprites, one draw call,
 * placed by the vertex shader from each one's home position (`home`, per instance) and `time`, so the CPU
 * does not move them one by one every frame (it did: 760 points a frame).
 */
function driftingLights(home: Float32Array, map: THREE.Texture, size: number, where: (home: any, i: any, time: any) => any) {
  const time = uniform(0);
  const m = new THREE.PointsNodeMaterial({ map, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: 0xffffff, sizeAttenuation: true });
  m.positionNode = where(instancedBufferAttribute(new THREE.InstancedBufferAttribute(home, 3)), T.float(instanceIndex), time);
  m.sizeNode = float(size);
  const sprite = new THREE.Sprite(m as unknown as THREE.SpriteMaterial);
  sprite.count = home.length / 3;
  sprite.frustumCulled = false;
  return { sprite, material: m, time };
}

/**
 * The part of the world that winners change: House Cup banners, Ministers' statues, and the
 * festivities a decree can switch on (lanterns, fireworks, aurora). Plus ambient fireflies.
 */
export function createDecor(scene: THREE.Scene, spots: { x: number; y: number; z: number; yaw: number }[]) {
  // ---- banners (cloth that ripples)
  const texCache = new Map<string, THREE.Texture>();
  const bannerTex = (h: House | null) => {
    const key = h ?? 'Hogwarts';
    if (!texCache.has(key)) texCache.set(key, h ? bannerTexture(hex(HOUSE_COLORS[h]), h[0]) : bannerTexture('#3b1f5c', 'H'));
    return texCache.get(key)!;
  };
  const bannerMat = new StoryStandardMaterial({ map: bannerTex(null), side: THREE.DoubleSide, roughness: 0.85 });
  // the cloth ripples in the vertex shader (it was rewritten on the CPU every frame): more toward the hem
  const bannerTime = uniform(0);
  {
    const p = positionGeometry;
    bannerMat.positionNode = vec3(p.x, p.y, sin(bannerTime.mul(2).add(p.y.mul(1.3)).add(modelWorldMatrix.element(3).x.mul(0.1))).mul(0.12).mul(float(2.2).sub(p.y)).mul(0.5));
  }
  spots.forEach((s) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 4.4, 1, 10), bannerMat);
    m.position.set(s.x, s.y - 2.2, s.z);
    m.rotation.y = s.yaw;
    m.castShadow = true;
    scene.add(m);
    return m;
  });
  let currentBanner: string | null = 'unset';

  // ---- statues of Ministers, lining the approach to the castle (everyone walks past them)
  // (STATUE_SPOTS: src/shared/layout.ts, where the kernel reads them too: the statues are solid)
  const statueGroup = new THREE.Group();
  scene.add(statueGroup);
  const marble = new THREE.MeshStandardMaterial({ color: 0xe8e4dc, roughness: 0.35 });
  const bronze = new THREE.MeshStandardMaterial({ color: 0x8c6a3f, metalness: 0.85, roughness: 0.35 });
  let statueKey = '';
  function buildStatues(list: Statue[]) {
    statueGroup.clear();
    list.forEach((s, i) => {
      const [x, z] = STATUE_SPOTS[i % STATUE_SPOTS.length];
      const g = new THREE.Group();
      const base = new THREE.Mesh(new THREE.BoxGeometry(2, 1.6, 2), marble);
      base.position.y = 0.8;
      const trim = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.2, 2.1), new THREE.MeshStandardMaterial({ color: HOUSE_COLORS[s.house], roughness: 0.5 }));
      trim.position.y = 1.55;
      const robe = new THREE.Mesh(new THREE.ConeGeometry(0.75, 2.4, 12), bronze);
      robe.position.y = 2.8;
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.32, 12, 10), bronze);
      head.position.y = 4.2;
      const hat = new THREE.Mesh(new THREE.ConeGeometry(0.42, 1, 12), bronze);
      hat.position.y = 4.85;
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.2, 6), bronze);
      arm.position.set(0.45, 4, -0.4);
      arm.rotation.x = -0.9;
      g.add(base, trim, robe, head, hat, arm);
      g.traverse((o) => { o.castShadow = true; o.receiveShadow = true; });
      // plaque
      const c = document.createElement('canvas');
      c.width = 512; c.height = 160;
      const p = c.getContext('2d')!;
      p.fillStyle = '#d4af37'; p.fillRect(0, 0, 512, 160);
      p.fillStyle = '#2b1d0e'; p.textAlign = 'center';
      p.font = 'bold 44px Georgia'; p.fillText(s.name, 256, 58);
      p.font = 'italic 24px Georgia'; p.fillText(`Minister for Magic · term ${s.term}`, 256, 96);
      p.font = '20px Georgia'; p.fillText(`"${s.inscription.slice(0, 48)}"`, 256, 132);
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      const plaque = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.56), new THREE.MeshStandardMaterial({ map: t, metalness: 0.6, roughness: 0.4 }));
      plaque.position.set(0, 0.9, 1.01);
      g.add(plaque);
      // a warm uplight so the Minister is visible at night
      const up = new THREE.SpotLight(0xffd9a0, 40, 12, 0.6, 0.5, 1.5);
      up.position.set(0, 0.2, 2.2);
      up.target.position.set(0, 3.5, 0);
      g.add(up, up.target);
      g.position.set(x, 0, z);
      g.rotation.y = statueYaw(x);
      statueGroup.add(g);
    });
  }

  // ---- floating lanterns
  const LANTERNS = 260;
  const lp = new Float32Array(LANTERNS * 3);
  for (let i = 0; i < LANTERNS; i++) { lp[i * 3] = (Math.random() - 0.5) * 260; lp[i * 3 + 1] = 12 + Math.random() * 40; lp[i * 3 + 2] = -60 + (Math.random() - 0.5) * 240; }
  // they rise at 0.8 m/s from 10 m to 70 m and start again, swaying sideways, each on its own phase
  const lantern = driftingLights(lp, glowSprite('rgba(255,200,120,1)', 'rgba(255,140,40,0)'), 2.6, (h, i, t) => {
    const seed = sin(i.mul(12.9898)).mul(43758.5453).fract().mul(100);
    return vec3(h.x.sub(cos(t.mul(0.3).add(seed)).mul(0.5 / 0.3)), mod(h.y.sub(10).add(t.mul(0.8)), 60).add(10), h.z);
  });
  const lanterns = lantern.sprite;
  lanterns.visible = false;
  scene.add(lanterns);

  // ---- fireflies in the forest (night only)
  const FLIES = 500;
  const fhome = new Float32Array(FLIES * 3);
  for (let i = 0; i < FLIES; i++) {
    const a = Math.random() * 6.28, d = Math.sqrt(Math.random()) * 80;
    fhome[i * 3] = 160 + Math.cos(a) * d; fhome[i * 3 + 2] = 15 + Math.sin(a) * d;
    fhome[i * 3 + 1] = heightAt(fhome[i * 3], fhome[i * 3 + 2]) + 0.6 + Math.random() * 3;
  }
  const fly = driftingLights(fhome, glowSprite('rgba(210,255,120,1)', 'rgba(150,255,60,0)'), 0.9, (h, i, t) =>
    vec3(h.x.add(sin(t.mul(0.7).add(i)).mul(1.5)), h.y.add(sin(t.mul(1.3).add(i.mul(2))).mul(0.6)), h.z.add(cos(t.mul(0.5).add(i)).mul(1.5))));
  const flies = fly.sprite;
  scene.add(flies);

  // ---- aurora: an animated curtain far to the north
  const auroraMat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
  auroraMat.userData.noFade = true;
  const aurora_ = { time: uniform(0), strength: uniform(0) };
  auroraMat.colorNode = Fn(() => {
    const v = uv(), time = aurora_.time;
    const band = sin(v.x.mul(18).add(time.mul(0.6)).add(sin(v.x.mul(5).sub(time.mul(0.3))).mul(2))).mul(0.5).add(0.5);
    const curtain = smoothstep(0, 0.25, v.y).mul(smoothstep(1, 0.35, v.y));
    const rays = pow(band, 3).mul(sin(v.x.mul(90).add(time)).mul(0.4).add(0.6));
    const col = mix(vec3(0.1, 1, 0.55), vec3(0.6, 0.3, 1), v.y);
    return vec4(col.mul(rays).mul(curtain).mul(aurora_.strength), 1);
  })();
  // theta centred on PI puts the curtain due north (-z), behind the castle as seen from the grounds
  const aurora = new THREE.Mesh(new THREE.CylinderGeometry(1400, 1400, 420, 64, 1, true, Math.PI * 0.6, Math.PI * 0.8), auroraMat);
  aurora.position.y = 380;
  scene.add(aurora);

  // ---- fireworks: bursts in a GPU particle pool of their own (fx.ts), the motion worked out on the GPU
  // (the old bursts were a Points object each, integrated on the CPU every frame): the same speeds, a drag
  // of 1.5 % a frame at 60 Hz, gravity at 0.6 g, 2.2 s of life
  const fw = new Pool(scene, 4096, true);
  fw.mesh.name = 'fireworks';
  let fwTimer = 0;
  const fwColor = new THREE.Color();
  function launch() {
    const N = 140;
    const cx = (Math.random() - 0.5) * 160, cy = 60 + Math.random() * 40, cz = -20 + (Math.random() - 0.5) * 120;
    const houses = Object.values(HOUSE_COLORS);
    fwColor.set(houses[Math.floor(Math.random() * houses.length)]).lerp(new THREE.Color(0xffffff), 0.3).multiplyScalar(1.6);
    for (let i = 0; i < N; i++) {
      const th = Math.random() * 6.28, ph = Math.acos(Math.random() * 2 - 1), s = 14 + Math.random() * 6;
      fw.put(cx, cy, cz, Math.sin(ph) * Math.cos(th) * s, Math.cos(ph) * s, Math.sin(ph) * Math.sin(th) * s, fwColor, 2.2, 1.3, 0.8, 9.8 * 0.6, 0.9);
    }
  }

  return {
    update(look: Look, day: number, t: number, dt: number) {
      const night = 1 - day;
      // banners: the last House Cup winner (or the Minister's choice)
      const key = look.banner ?? 'Hogwarts';
      if (key !== currentBanner) { bannerMat.map = bannerTex(look.banner); bannerMat.needsUpdate = true; currentBanner = key; }
      bannerTime.value = t;
      const sk = JSON.stringify(look.statues);
      if (sk !== statueKey) { statueKey = sk; buildStatues(look.statues); }

      lanterns.visible = look.lanterns;
      if (look.lanterns) {
        lantern.time.value = t;
        lantern.material.opacity = 0.4 + 0.6 * night;
      }

      flies.visible = night > 0.3;
      if (flies.visible) {
        fly.time.value = t;
        fly.material.opacity = (night - 0.3) * (0.6 + 0.4 * Math.sin(t * 3));
      }

      aurora_.time.value = t;
      aurora_.strength.value = look.aurora ? night * 0.9 : 0;
      aurora.visible = look.aurora && night > 0.05;

      if (look.fireworks && night > 0.5) {
        fwTimer -= dt;
        if (fwTimer <= 0) { launch(); fwTimer = 0.6 + Math.random() * 1.2; }
      }
      fw.flush(dt, 1, 1);
    },
  };
}
