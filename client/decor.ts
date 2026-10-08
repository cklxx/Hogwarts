import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { HOUSE_COLORS, type House } from '../src/shared/constants';
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
  // Banners merged into 1 mesh (8→1 draw call); wave animation in vertex shader
  const bannerUniforms = { uTime: { value: 0 } };
  bannerMat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = bannerUniforms.uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float bWaveY = (uv.y - 0.5) * 4.4;
        float bWave = sin(uTime * 2.0 + bWaveY * 1.3 + position.x * 0.1) * 0.12 * (2.2 - bWaveY) * 0.5;
        transformed.z += bWave;`);
  };
  const bannerGeos = spots.map((s) => {
    const g = new THREE.PlaneGeometry(2.2, 4.4, 1, 10);
    g.rotateY(s.yaw);
    g.translate(s.x, s.y - 2.2, s.z);
    return g;
  });
  const bannersMesh = new THREE.Mesh(mergeGeometries(bannerGeos)!, bannerMat);
  bannersMesh.castShadow = true;
  scene.add(bannersMesh);
  let currentBanner: string | null = 'unset';

  // ---- statues of Ministers, lining the approach to the castle (everyone walks past them)
  // (STATUE_SPOTS: src/shared/layout.ts, where the kernel reads them too: the statues are solid)
  const statueGroup = new THREE.Group();
  scene.add(statueGroup);
  const marble = new THREE.MeshStandardMaterial({ color: 0xe8e4dc, roughness: 0.35 });
  const bronze = new THREE.MeshStandardMaterial({ color: 0x8c6a3f, metalness: 0.85, roughness: 0.35 });
  // Merged bronze geometry (robe+head+hat+arm with baked transforms) for instancing
  const bronzeGeo = (() => {
    const robe = new THREE.ConeGeometry(0.75, 2.4, 12); robe.translate(0, 2.8, 0);
    const head = new THREE.SphereGeometry(0.32, 12, 10); head.translate(0, 4.2, 0);
    const hat = new THREE.ConeGeometry(0.42, 1, 12); hat.translate(0, 4.85, 0);
    const arm = new THREE.CylinderGeometry(0.05, 0.05, 1.2, 6);
    arm.rotateX(-0.9); arm.translate(0.45, 4, -0.4);
    return mergeGeometries([robe, head, hat, arm])!;
  })();
  const baseGeo = new THREE.BoxGeometry(2, 1.6, 2);
  const trimGeo = new THREE.BoxGeometry(2.1, 0.2, 2.1);
  let statueKey = '';
  // fast path: look.statues is a fresh array only when the server resends the head; same reference => same content
  // (buildStatues never mutates its input), so the JSON.stringify comparison runs only on a new reference
  let statueRef: readonly unknown[] | undefined;
  // Instanced meshes for statues (reused across rebuilds)
  const MAX_STATUES = 8;
  const bronzeIM = new THREE.InstancedMesh(bronzeGeo, bronze, MAX_STATUES);
  const baseIM = new THREE.InstancedMesh(baseGeo, marble, MAX_STATUES);
  const trimIMs = new Map<House, THREE.InstancedMesh>();
  const _m4 = new THREE.Matrix4();
  const _q = new THREE.Quaternion();
  const _e = new THREE.Euler();
  const _v = new THREE.Vector3();
  const _s = new THREE.Vector3(1, 1, 1);
  function buildStatues(list: Statue[]) {
    statueGroup.clear();
    // Clear and re-add instanced meshes
    statueGroup.add(bronzeIM, baseIM);
    trimIMs.forEach(im => statueGroup.add(im));
    // Group statues by house for trim instancing
    const byHouse = new Map<House, number[]>();
    list.forEach((s, i) => {
      if (!byHouse.has(s.house)) byHouse.set(s.house, []);
      byHouse.get(s.house)!.push(i);
    });
    // Ensure trim IMs exist for each house
    byHouse.forEach((indices, house) => {
      if (!trimIMs.has(house)) {
        const im = new THREE.InstancedMesh(trimGeo, new THREE.MeshStandardMaterial({ color: HOUSE_COLORS[house], roughness: 0.5 }), MAX_STATUES);
        im.castShadow = true; im.receiveShadow = true;
        trimIMs.set(house, im);
        statueGroup.add(im);
      }
    });
    list.forEach((s, i) => {
      const [x, z] = STATUE_SPOTS[i % STATUE_SPOTS.length];
      const yaw = statueYaw(x);
      _e.set(0, yaw, 0); _q.setFromEuler(_e); _v.set(x, 0, z);
      // Bronze (merged): identity relative to statue origin
      _m4.compose(_v, _q, _s);
      bronzeIM.setMatrixAt(i, _m4);
      // Base: offset y=0.8
      _v.set(x, 0.8, z);
      _m4.compose(_v, _q, _s);
      baseIM.setMatrixAt(i, _m4);
      // Trim: offset y=1.55, per-house IM
      const trimIM = trimIMs.get(s.house)!;
      const houseIdx = byHouse.get(s.house)!.indexOf(i);
      _v.set(x, 1.55, z);
      _m4.compose(_v, _q, _s);
      trimIM.setMatrixAt(houseIdx, _m4);
      // Plaque (unique texture, stays individual)
      const g = new THREE.Group();
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
      plaque.castShadow = true;
      g.add(plaque);
      // a warm uplight so the Minister is visible at night
      const up = new THREE.SpotLight(0xffd9a0, 40, 12, 0.6, 0.5, 1.5);
      up.position.set(0, 0.2, 2.2);
      up.target.position.set(0, 3.5, 0);
      g.add(up, up.target);
      g.position.set(x, 0, z);
      g.rotation.y = yaw;
      statueGroup.add(g);
    });
    bronzeIM.count = list.length;
    baseIM.count = list.length;
    bronzeIM.instanceMatrix.needsUpdate = true;
    baseIM.instanceMatrix.needsUpdate = true;
    trimIMs.forEach((im, house) => {
      const n = byHouse.get(house)?.length ?? 0;
      im.count = n;
      im.instanceMatrix.needsUpdate = true;
    });
    bronzeIM.castShadow = true; bronzeIM.receiveShadow = true;
    baseIM.castShadow = true; baseIM.receiveShadow = true;
  }

  // ---- floating lanterns
  const LANTERNS = 260;
  const lanternGeo = new THREE.BufferGeometry();
  const lp = new Float32Array(LANTERNS * 3);
  for (let i = 0; i < LANTERNS; i++) { lp[i * 3] = (Math.random() - 0.5) * 260; lp[i * 3 + 1] = 12 + Math.random() * 40; lp[i * 3 + 2] = -60 + (Math.random() - 0.5) * 240; }
  lanternGeo.setAttribute('position', new THREE.BufferAttribute(lp, 3));
  // the bob is integrated in the vertex shader: the CPU never touches a live lantern
  const lantUniforms = { uTime: { value: 0 }, uScale: { value: 500 }, uLook: { value: 1 }, uMap: { value: glowSprite('rgba(255,200,120,1)', 'rgba(255,140,40,0)') } };
  const lantMat = new THREE.ShaderMaterial({
    uniforms: lantUniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `uniform float uTime; uniform float uScale;
      void main() {
        float ph = fract(sin(dot(position.xz, vec2(12.9898, 78.233))) * 43758.5453) * 6.2831;
        vec3 p = position;
        p.y += sin(uTime * 0.5 + ph) * 1.5;
        p.x += sin(uTime * 0.3 + ph * 1.7) * 2.0;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = min(128.0, 2.6 * uScale / max(0.2, -mv.z));
      }`,
    fragmentShader: `uniform sampler2D uMap; uniform float uLook;
      void main() {
        vec4 tex = texture2D(uMap, gl_PointCoord);
        gl_FragColor = vec4(tex.rgb, tex.a * uLook);
      }`,
  });
  const lanterns = new THREE.Points(lanternGeo, lantMat);
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
  // the drift is integrated in the vertex shader (each mote orbits its seed): the CPU never touches a live mote
  const flyUniforms = { uTime: { value: 0 }, uScale: { value: 500 }, uLook: { value: 0 }, uMap: { value: glowSprite('rgba(210,255,120,1)', 'rgba(150,255,60,0)') } };
  const flyMat = new THREE.ShaderMaterial({
    uniforms: flyUniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `uniform float uTime; uniform float uScale;
      void main() {
        float ph = fract(sin(dot(position.xz, vec2(12.9898, 78.233))) * 43758.5453) * 6.2831;
        float sp = 0.5 + fract(ph * 7.13) * 0.8;
        float r = 1.5 + fract(ph * 3.7) * 2.0;
        vec3 p = position;
        p.x += cos(uTime * sp + ph) * r;
        p.z += sin(uTime * sp * 1.3 + ph) * r;
        p.y += sin(uTime * 0.9 + ph) * 0.5;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = min(64.0, 0.9 * uScale / max(0.2, -mv.z));
      }`,
    fragmentShader: `uniform sampler2D uMap; uniform float uLook;
      void main() {
        vec4 tex = texture2D(uMap, gl_PointCoord);
        gl_FragColor = vec4(tex.rgb, tex.a * uLook);
      }`,
  });
  const flies = new THREE.Points(flyGeo, flyMat);
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
      bannerUniforms.uTime.value = t;
      const st = look.statues;
      if (st !== statueRef) {
        statueRef = st;
        const sk = JSON.stringify(st);
        if (sk !== statueKey) { statueKey = sk; buildStatues(st); }
      }

      lanterns.visible = look.lanterns;
      if (look.lanterns) {
        lantUniforms.uTime.value = t;
        lantUniforms.uLook.value = 0.4 + 0.6 * night;
      }

      flies.visible = night > 0.3;
      if (flies.visible) {
        flyUniforms.uTime.value = t;
        flyUniforms.uLook.value = (night - 0.3) * (0.6 + 0.4 * Math.sin(t * 3));
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
    /** The point-size scale (height / 2·tan(fov/2)): call when the camera or the canvas changes. */
    pointScale(scale: number) { lantUniforms.uScale.value = scale; flyUniforms.uScale.value = scale; },
  };
}
