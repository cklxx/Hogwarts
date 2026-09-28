import * as THREE from 'three';
import { HOUSE_COLORS, type House } from '../src/shared/constants';
import { bannerTexture, glowSprite } from './textures';
import { heightAt } from './terrain';

export interface Statue { name: string; house: House; term: number; inscription: string }
export interface Look {
  skyTint: string; sunIntensity: number; fogDensity: number; glow: number;
  lanterns: boolean; fireworks: boolean; aurora: boolean;
  banner: House | null; cupHouse: House | null; statues: Statue[];
}

const hex = (n: number) => '#' + n.toString(16).padStart(6, '0');

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
  const bannerMat = new THREE.MeshStandardMaterial({ map: bannerTex(null), side: THREE.DoubleSide, roughness: 0.85 });
  const banners = spots.map((s) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 4.4, 1, 10), bannerMat);
    m.position.set(s.x, s.y - 2.2, s.z);
    m.rotation.y = s.yaw;
    m.castShadow = true;
    scene.add(m);
    return m;
  });
  const bannerBase = banners[0]?.geometry.getAttribute('position').array.slice() as Float32Array | undefined;
  let currentBanner: string | null = 'unset';

  // ---- statues of Ministers, lining the approach to the castle (everyone walks past them)
  const STATUE_SPOTS = [[-7, 4], [7, 4], [-7, 16], [7, 16], [-7, 28], [7, 28], [-7, 40], [7, 40]];
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
      g.rotation.y = x < 0 ? Math.PI / 2 : -Math.PI / 2;
      statueGroup.add(g);
    });
  }

  // ---- floating lanterns
  const LANTERNS = 260;
  const lanternGeo = new THREE.BufferGeometry();
  const lp = new Float32Array(LANTERNS * 3);
  const lseed = Array.from({ length: LANTERNS }, () => Math.random() * 100);
  for (let i = 0; i < LANTERNS; i++) { lp[i * 3] = (Math.random() - 0.5) * 260; lp[i * 3 + 1] = 12 + Math.random() * 40; lp[i * 3 + 2] = -60 + (Math.random() - 0.5) * 240; }
  lanternGeo.setAttribute('position', new THREE.BufferAttribute(lp, 3));
  const lanterns = new THREE.Points(lanternGeo, new THREE.PointsMaterial({ map: glowSprite('rgba(255,200,120,1)', 'rgba(255,140,40,0)'), size: 2.6, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: 0xffffff }));
  lanterns.visible = false;
  scene.add(lanterns);

  // ---- fireflies in the forest (night only)
  const FLIES = 500;
  const flyGeo = new THREE.BufferGeometry();
  const fp = new Float32Array(FLIES * 3);
  const fhome = new Float32Array(FLIES * 3);
  for (let i = 0; i < FLIES; i++) {
    const a = Math.random() * 6.28, d = Math.sqrt(Math.random()) * 80;
    fhome[i * 3] = 160 + Math.cos(a) * d; fhome[i * 3 + 2] = 15 + Math.sin(a) * d;
    fhome[i * 3 + 1] = heightAt(fhome[i * 3], fhome[i * 3 + 2]) + 0.6 + Math.random() * 3;
  }
  fp.set(fhome);
  flyGeo.setAttribute('position', new THREE.BufferAttribute(fp, 3));
  const flies = new THREE.Points(flyGeo, new THREE.PointsMaterial({ map: glowSprite('rgba(210,255,120,1)', 'rgba(150,255,60,0)'), size: 0.9, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  scene.add(flies);

  // ---- aurora: an animated curtain far to the north
  const auroraMat = new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 }, strength: { value: 0 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform float time; uniform float strength; varying vec2 vUv;
      void main(){
        float band = sin(vUv.x * 18.0 + time * 0.6 + sin(vUv.x * 5.0 - time * 0.3) * 2.0) * 0.5 + 0.5;
        float curtain = smoothstep(0.0, 0.25, vUv.y) * smoothstep(1.0, 0.35, vUv.y);
        float rays = pow(band, 3.0) * (0.6 + 0.4 * sin(vUv.x * 90.0 + time));
        vec3 col = mix(vec3(0.1, 1.0, 0.55), vec3(0.6, 0.3, 1.0), vUv.y);
        gl_FragColor = vec4(col * rays * curtain * strength, 1.0);
      }`,
  });
  // theta centred on PI puts the curtain due north (-z), behind the castle as seen from the grounds
  const aurora = new THREE.Mesh(new THREE.CylinderGeometry(1400, 1400, 420, 64, 1, true, Math.PI * 0.6, Math.PI * 0.8), auroraMat);
  aurora.position.y = 380;
  scene.add(aurora);

  // ---- fireworks (pooled particle bursts)
  type Burst = { pts: THREE.Points; vel: Float32Array; age: number };
  const bursts: Burst[] = [];
  const fwTex = glowSprite();
  let fwTimer = 0;
  function launch() {
    const N = 140;
    const geo = new THREE.BufferGeometry();
    const p = new Float32Array(N * 3), v = new Float32Array(N * 3);
    const cx = (Math.random() - 0.5) * 160, cy = 60 + Math.random() * 40, cz = -20 + (Math.random() - 0.5) * 120;
    for (let i = 0; i < N; i++) {
      p.set([cx, cy, cz], i * 3);
      const th = Math.random() * 6.28, ph = Math.acos(Math.random() * 2 - 1), s = 14 + Math.random() * 6;
      v.set([Math.sin(ph) * Math.cos(th) * s, Math.cos(ph) * s, Math.sin(ph) * Math.sin(th) * s], i * 3);
    }
    geo.setAttribute('position', new THREE.BufferAttribute(p, 3));
    const houses = Object.values(HOUSE_COLORS);
    const color = new THREE.Color(houses[Math.floor(Math.random() * houses.length)]).lerp(new THREE.Color(0xffffff), 0.3);
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ map: fwTex, color, size: 2.2, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    scene.add(pts);
    bursts.push({ pts, vel: v, age: 0 });
  }

  return {
    update(look: Look, day: number, t: number, dt: number) {
      const night = 1 - day;
      // banners: the last House Cup winner (or the Minister's choice)
      const key = look.banner ?? 'Hogwarts';
      if (key !== currentBanner) { bannerMat.map = bannerTex(look.banner); bannerMat.needsUpdate = true; currentBanner = key; }
      if (bannerBase) for (const b of banners) {
        const a = b.geometry.getAttribute('position') as THREE.BufferAttribute;
        for (let i = 0; i < a.count; i++) {
          const y = bannerBase[i * 3 + 1];
          a.setZ(i, Math.sin(t * 2 + y * 1.3 + b.position.x * 0.1) * 0.12 * (2.2 - y) * 0.5);
        }
        a.needsUpdate = true;
      }
      const sk = JSON.stringify(look.statues);
      if (sk !== statueKey) { statueKey = sk; buildStatues(look.statues); }

      lanterns.visible = look.lanterns;
      if (look.lanterns) {
        const a = lanternGeo.getAttribute('position') as THREE.BufferAttribute;
        for (let i = 0; i < LANTERNS; i++) {
          a.setY(i, a.getY(i) + dt * 0.8);
          a.setX(i, a.getX(i) + Math.sin(t * 0.3 + lseed[i]) * dt * 0.5);
          if (a.getY(i) > 70) a.setY(i, 10);
        }
        a.needsUpdate = true;
        (lanterns.material as THREE.PointsMaterial).opacity = 0.4 + 0.6 * night;
      }

      flies.visible = night > 0.3;
      if (flies.visible) {
        const a = flyGeo.getAttribute('position') as THREE.BufferAttribute;
        for (let i = 0; i < FLIES; i++) {
          a.setXYZ(i, fhome[i * 3] + Math.sin(t * 0.7 + i) * 1.5, fhome[i * 3 + 1] + Math.sin(t * 1.3 + i * 2) * 0.6, fhome[i * 3 + 2] + Math.cos(t * 0.5 + i) * 1.5);
        }
        a.needsUpdate = true;
        (flies.material as THREE.PointsMaterial).opacity = (night - 0.3) * (0.6 + 0.4 * Math.sin(t * 3));
      }

      auroraMat.uniforms.time.value = t;
      auroraMat.uniforms.strength.value = look.aurora ? night * 0.9 : 0;
      aurora.visible = look.aurora && night > 0.05;

      if (look.fireworks && night > 0.5) {
        fwTimer -= dt;
        if (fwTimer <= 0) { launch(); fwTimer = 0.6 + Math.random() * 1.2; }
      }
      for (let k = bursts.length - 1; k >= 0; k--) {
        const b = bursts[k];
        b.age += dt;
        const a = b.pts.geometry.getAttribute('position') as THREE.BufferAttribute;
        for (let i = 0; i < a.count; i++) {
          b.vel[i * 3 + 1] -= 9.8 * dt * 0.6;
          b.vel[i * 3] *= 0.985; b.vel[i * 3 + 1] *= 0.985; b.vel[i * 3 + 2] *= 0.985;
          a.setXYZ(i, a.getX(i) + b.vel[i * 3] * dt, a.getY(i) + b.vel[i * 3 + 1] * dt, a.getZ(i) + b.vel[i * 3 + 2] * dt);
        }
        a.needsUpdate = true;
        (b.pts.material as THREE.PointsMaterial).opacity = Math.max(0, 1 - b.age / 2.2);
        if (b.age > 2.2) { scene.remove(b.pts); b.pts.geometry.dispose(); (b.pts.material as THREE.Material).dispose(); bursts.splice(k, 1); }
      }
    },
  };
}
