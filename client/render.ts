import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { SkyMesh } from 'three/addons/objects/SkyMesh.js';
import { LensflareMesh, LensflareElement } from 'three/addons/objects/LensflareMesh.js';
import { loadEnvironments } from './assets';
import { captureCamera, captureEnv, captureFocus } from './capture';
import { COMPUTE, createGpuRenderer, gpuBackend, mirrorGuards, runFrameJobs, fallbackReason } from './gpu';
import { PERF } from './perf';
import { createPost } from './post';
import { installStorybook, story, storyFog } from './storybook';
import { STORYBOOK, glowSprite, paintedClouds, paintedMoon } from './textures';

export interface Looks { skyTint: string; sunIntensity: number; fogDensity: number; glow: number }

const T = TSL as unknown as Record<string, any>;
const { Fn, vec3, vec4, float, uniform, attribute, normalize, atan, sin, smoothstep, mix, max, min, dot, pow, texture,
  positionGeometry, positionLocal, modelViewMatrix, cameraProjectionMatrix, modelViewProjection, instancedBufferAttribute, luminance } = T;

// ------------------------------------------------------------------ the painted sky
type SkyPalette = { zenith: string; mid: string; horizon: string; ground: string; sun: string };
const PALETTE: Record<'day' | 'dusk' | 'night', SkyPalette> = {
  day: { zenith: '#3b78c2', mid: '#7cafdc', horizon: '#d6e7ea', ground: '#8a9c80', sun: '#fff1cf' },
  dusk: { zenith: '#2a3877', mid: '#b56a8c', horizon: '#ffae6c', ground: '#58474e', sun: '#ff9a4a' },
  night: { zenith: '#040920', mid: '#0b1641', horizon: '#1b2b5c', ground: '#080d1e', sun: '#000000' },
};
type SkyUniforms = { zenith: { value: THREE.Color }; mid: { value: THREE.Color }; horizon: { value: THREE.Color }; ground: { value: THREE.Color }; sunColor: { value: THREE.Color }; sunDir: { value: THREE.Vector3 }; sunDisc: { value: number } };
/** The painted gradient sky: washes of colour with wandering edges, a soft sun glow and a flat painted sun. */
function skyMaterial() {
  const c = () => uniform(new THREE.Color());
  const u = { zenith: c(), mid: c(), horizon: c(), ground: c(), sunColor: c(), sunDir: uniform(new THREE.Vector3(0, 1, 0)), sunDisc: uniform(1) };
  const m = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false, fog: false });
  m.userData.noFade = true; // (view.ts: never dithered away round the player)
  // on the far plane: drawn only where nothing else is
  m.vertexNode = Fn(() => { const p = modelViewProjection; return vec4(p.xy, p.w.mul(0.99999), p.w); })();
  m.colorNode = Fn(() => {
    const d = normalize(positionGeometry);
    const h = d.y, az = atan(d.z, d.x);
    // washes of colour whose edges wander a little, like wet brushwork
    const hw = h.add(sin(az.mul(3).add(h.mul(9))).mul(0.03)).add(sin(az.mul(7).sub(h.mul(17))).mul(0.014));
    let col = mix(u.horizon, u.mid, smoothstep(0, 0.3, hw));
    col = mix(col, u.zenith, smoothstep(0.2, 0.85, hw));
    const s = max(dot(d, u.sunDir), 0);
    col = col.add(u.sunColor.mul(pow(s, 5).mul(0.32).add(pow(s, 36).mul(0.45))).mul(float(1).sub(smoothstep(0, 0.6, h).mul(0.6))));
    col = mix(col, u.sunColor.mul(1.15).add(0.2), smoothstep(0.9974, 0.9984, s).mul(u.sunDisc)); // a flat painted sun
    col = mix(col, u.ground, smoothstep(0.02, -0.14, h));
    // the sky never blooms: only lamps, windows and spells do
    const l = dot(col, vec3(0.2126, 0.7152, 0.0722));
    return vec4(col.mul(min(1, float(0.95).div(max(l, 1e-4)))), 1);
  })();
  return { mat: m, u: u as unknown as SkyUniforms };
}
/** Set a sky's colours for day factor `day` and dusk weight `dusk`, times the Minister's tint. */
function paintSky(u: SkyUniforms, day: number, dusk: number, tint: THREE.Color, sunDir: THREE.Vector3) {
  const mix = (k: keyof SkyPalette, out: THREE.Color) => out.set(PALETTE.night[k]).lerp(tmpA.set(PALETTE.day[k]), day).lerp(tmpA.set(PALETTE.dusk[k]), dusk * 0.85).multiply(tint);
  mix('zenith', u.zenith.value);
  mix('mid', u.mid.value);
  mix('horizon', u.horizon.value);
  mix('ground', u.ground.value);
  u.sunColor.value.set(PALETTE.day.sun).lerp(tmpA.set(PALETTE.dusk.sun), Math.min(1, dusk * 1.3)).multiplyScalar(THREE.MathUtils.smoothstep(sunDir.y, -0.08, 0.04));
  u.sunDir.value.copy(sunDir);
  u.sunDisc.value = THREE.MathUtils.smoothstep(sunDir.y, -0.05, 0.02);
}
const tmpA = new THREE.Color();

/** Clouds: every painted billboard in one draw call (the vertex shader turns each quad to the camera). */
function cloudLayer() {
  const N = 150;
  const pos: number[] = [], corner: number[] = [], size: number[] = [], atlas: number[] = [], idx: number[] = [];
  for (let i = 0; i < 46; i++) {
    const cx = (Math.random() - 0.5) * 2400, cz = (Math.random() - 0.5) * 2400, cy = 190 + Math.random() * 130;
    for (let k = 0; k < 3 && pos.length / 12 < N; k++) {
      const q = Math.floor(Math.random() * 4), sc = 120 + Math.random() * 130;
      const x = cx + (Math.random() - 0.5) * 160, y = cy + (Math.random() - 0.5) * 24, z = cz + (Math.random() - 0.5) * 90;
      const base = pos.length / 3;
      for (const [u, v] of [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]) {
        pos.push(x, y, z);
        corner.push(u, v);
        size.push(sc * (1.5 + Math.random() * 0.01), sc);
        atlas.push((q % 2) * 0.5, 0.5 - Math.floor(q / 2) * 0.5);
      }
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aCorner', new THREE.Float32BufferAttribute(corner, 2));
  g.setAttribute('aSize', new THREE.Float32BufferAttribute(size, 2));
  g.setAttribute('aAtlas', new THREE.Float32BufferAttribute(atlas, 2));
  g.setIndex(idx);
  const u = { lit: uniform(new THREE.Color(1, 1, 1)), shade: uniform(new THREE.Color(0.7, 0.75, 0.85)), opacity: uniform(0.9) };
  const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, fog: false });
  mat.userData.noFade = true;
  const corner2 = attribute('aCorner', 'vec2');
  mat.vertexNode = Fn(() => {
    const mv = modelViewMatrix.mul(vec4(positionLocal, 1)).toVar();
    mv.xy.addAssign(corner2.mul(attribute('aSize', 'vec2')));
    return cameraProjectionMatrix.mul(mv);
  })();
  const t = texture(paintedClouds(), attribute('aAtlas', 'vec2').add(corner2.add(0.5).mul(0.5)));
  mat.colorNode = vec4(mix(u.shade, u.lit, smoothstep(0.3, 0.95, t.r)), 1);
  mat.opacityNode = t.a.mul(u.opacity);
  const mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1; // behind every other transparent thing (it is the farthest)
  return { mesh, u };
}

/**
 * Screen-sized dots at fixed world positions (the stars): sprites of `px` pixels, one draw call. WebGPU has
 * no point size, so each dot is an instanced camera-facing quad (PointsNodeMaterial on a Sprite).
 */
function starField(n: number, px: number, color: number) {
  const sp = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const t = Math.random() * Math.PI * 2, p = Math.acos(Math.random() * 0.95);
    sp.set([Math.sin(p) * Math.cos(t) * 1800, Math.cos(p) * 1800, Math.sin(p) * Math.sin(t) * 1800], i * 3);
  }
  const m = new THREE.PointsNodeMaterial({ color, transparent: true, depthWrite: false, fog: false, sizeAttenuation: false });
  m.positionNode = instancedBufferAttribute(new THREE.InstancedBufferAttribute(sp, 3));
  m.sizeNode = float(px);
  const s = new THREE.Sprite(m as unknown as THREE.SpriteMaterial);
  s.count = n;
  s.frustumCulled = false;
  return s;
}

/**
 * Lighting pipeline. Storybook (default): a painted gradient sky driven by the in-game hour -> a warm
 * key light (sun, or the moon at night) with a shadow frustum that follows the player, a cool fill
 * from the opposite side and a sky/ground hemisphere -> a soft toon ramp and a rim light on
 * characters (storybook.ts) -> image-based light baked from the painted sky itself -> HDR -> bloom
 * tuned to catch only real light sources -> a grade (the Minister's sky tint, cool shadows / warm
 * lights, a faint paper grain, vignette) -> neutral tone mapping, which keeps the painted colours
 * (post.ts). ?style=real keeps the older photographic pipeline: Preetham sky, Poly Haven HDRIs, lens
 * flare, ACES.
 *
 * The renderer is three.js's WebGPURenderer (gpu.ts): WebGPU where the browser has it, WebGL 2 otherwise.
 */
export async function createRenderer(canvas: HTMLCanvasElement) {
  const renderer = await createGpuRenderer(canvas, { timestamps: PERF });
  if (STORYBOOK) installStorybook(renderer);
  renderer.setPixelRatio(Math.min(2, devicePixelRatio));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap; // (three.js r18x draws PCFSoft as PCF on both backends)
  renderer.toneMapping = STORYBOOK ? THREE.NeutralToneMapping : THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 5000);
  scene.fog = new THREE.FogExp2(0x9fb8d9, 0.003);
  if (STORYBOOK) storyFog(scene);

  // Image-based light: ONE environment texture for the whole game, re-baked in place when the time of day moves
  // to another phase. (The node renderer keys every lit material's shaders on the environment texture: switching
  // scene.environment between three textures rebuilt ~120 materials' node graphs and compiled ~57 programs the
  // first time dusk or night came.)
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
  scene.environment = envRT.texture;
  type Phase = 'day' | 'dusk' | 'night';
  let envPhase: Phase | 'room' = 'room';
  let bakeEnv: (phase: Phase) => boolean = () => false;
  const setEnv = (phase: Phase) => { if (phase !== envPhase && bakeEnv(phase)) envPhase = phase; };

  // ---- sky
  let preetham: SkyMesh | null = null;
  let painted: THREE.Mesh | null = null;
  const sky = skyMaterial();
  if (STORYBOOK) {
    painted = new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), sky.mat);
    painted.frustumCulled = false;
    painted.renderOrder = 1; // after the opaque world, so it only fills what is left
    scene.add(painted);
    // image-based light baked from the painted sky at three times of day (metal, the Mirror, glamours reflect it)
    const bake = new THREE.Scene();
    const bakeSky = skyMaterial();
    bake.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), bakeSky.mat));
    const white = new THREE.Color(1, 1, 1);
    const AT: Record<Phase, [number, number, number]> = { day: [1, 0, 0.8], dusk: [0.6, 1, 0.05], night: [0, 0, -0.5] };
    bakeEnv = (phase) => {
      const [day, dusk, elev] = AT[phase];
      paintSky(bakeSky.u, day, dusk, white, new THREE.Vector3(0.8, elev, -0.35).normalize());
      pmrem.fromScene(bake, 0.02, 0.1, 100, { renderTarget: envRT });
      return true;
    };
    setEnv('day'); // (now, so the shader warm-up sees the texture the game draws with)
  } else {
    preetham = new SkyMesh();
    preetham.scale.setScalar(4000);
    preetham.cloudCoverage.value = 0;
    // The Preetham sky (and its sun disc) is far brighter than 1 around the sun; bloomed, a low sun
    // floods half the screen with haze. Cap it just below the bloom threshold: the sky never blooms,
    // only lamps, windows and spells do.
    const m = preetham.material as THREE.NodeMaterial;
    const raw = m.colorNode;
    m.colorNode = Fn(() => { const c = vec4(raw).toVar(); return vec4(c.rgb.mul(min(1, float(1.05).div(max(luminance(c.rgb), 1e-4)))), 1); })();
    scene.add(preetham);
    preetham.turbidity.value = 5;
    preetham.rayleigh.value = 1.6;
    preetham.mieCoefficient.value = 0.004;
    preetham.mieDirectionalG.value = 0.82;
    // image-based lighting: a neutral room until the Poly Haven HDRIs arrive, then day/night maps
    loadEnvironments((day, night) => {
      bakeEnv = (phase) => { pmrem.fromEquirectangular(phase === 'night' ? night : day, envRT); return true; };
      hdri = true;
    });
  }

  const hemi = new THREE.HemisphereLight(0xcfe3ff, 0x3a4a2a, 0.6);
  const sun = new THREE.DirectionalLight(0xfff1d6, 2.5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.6;
  Object.assign(sun.shadow.camera, { left: -70, right: 70, top: 70, bottom: -70, near: 1, far: 500 });
  const moon = new THREE.DirectionalLight(0x8fa8ff, 0.35);
  scene.add(hemi, sun, sun.target, moon, moon.target);
  // the lake's mirror (a second render of the scene) must not redraw the sun's shadow map for its own camera
  let shadowWas = { needs: false, auto: false };
  mirrorGuards.before.push(() => { shadowWas = { needs: sun.shadow.needsUpdate, auto: sun.shadow.autoUpdate }; sun.shadow.needsUpdate = false; sun.shadow.autoUpdate = false; });
  mirrorGuards.after.push(() => { sun.shadow.needsUpdate = shadowWas.needs; sun.shadow.autoUpdate = shadowWas.auto; });

  // stars and the moon live far away and ignore fog
  const stars = starField(2500, STORYBOOK ? 2.2 : 1.8, STORYBOOK ? 0xfff4d8 : 0xffffff);
  const starMat = stars.material as unknown as THREE.PointsNodeMaterial;
  scene.add(stars);
  const moonSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: STORYBOOK ? paintedMoon() : glowSprite('rgba(235,240,255,1)', 'rgba(150,170,255,0)'), fog: false, depthWrite: false, transparent: true }));
  moonSprite.scale.setScalar(STORYBOOK ? 300 : 160);
  scene.add(moonSprite);

  // lens flare on the sun (three.js example flare textures): photographic, so ?style=real only
  const flareHost = new THREE.PointLight(0xffffff, 0, 1);
  let flare: LensflareMesh | null = null;
  if (!STORYBOOK) {
    flare = new LensflareMesh();
    const tl = new THREE.TextureLoader();
    // kept small and dim: the bloom pass already spreads the sun, and a big flare washes out a low sun
    flare.addElement(new LensflareElement(tl.load('/textures/lensflare0.png'), 280, 0, new THREE.Color(0.6, 0.56, 0.5)));
    for (const [size, d] of [[60, 0.55], [80, 0.7], [120, 0.9], [70, 1.0]]) flare.addElement(new LensflareElement(tl.load('/textures/lensflare3.png'), size, d));
    flareHost.add(flare);
    scene.add(flareHost);
  }

  // clouds. Storybook: painted billboards in one draw call. Real: soft CC0 photo billboards (pmndrs/assets).
  const clouds = new THREE.Group();
  const cloudMats: THREE.SpriteMaterial[] = [];
  let storyClouds: ReturnType<typeof cloudLayer> | null = null;
  if (STORYBOOK) {
    storyClouds = cloudLayer();
    clouds.add(storyClouds.mesh);
  } else {
    const cloudTex = new THREE.TextureLoader().load('/textures/cloud.webp');
    cloudTex.colorSpace = THREE.SRGBColorSpace;
    for (let i = 0; i < 46; i++) {
      const cx = (Math.random() - 0.5) * 2400, cz = (Math.random() - 0.5) * 2400, cy = 180 + Math.random() * 140;
      for (let k = 0; k < 4; k++) {
        const m = new THREE.SpriteMaterial({ map: cloudTex, transparent: true, depthWrite: false, fog: false, opacity: 0.85, rotation: Math.random() * 6.28 });
        cloudMats.push(m);
        const s = new THREE.Sprite(m);
        const sc = 90 + Math.random() * 120;
        s.scale.set(sc * 1.6, sc, 1);
        s.position.set(cx + (Math.random() - 0.5) * 140, cy + (Math.random() - 0.5) * 30, cz + (Math.random() - 0.5) * 80);
        clouds.add(s);
      }
    }
  }
  scene.add(clouds);

  // post-processing (post.ts): scene into a multisampled HDR target (with a stencil: view.ts x-ray), bloom, grade,
  // tone mapping
  const post = createPost(renderer, scene, camera, STORYBOOK);
  const bloom = post.bloom, grade = post.grade;

  // a small pool of point lights handed to the spells nearest the camera
  const boltLights = Array.from({ length: 6 }, () => {
    const l = new THREE.PointLight(0xffffff, 0, 14, 1.6);
    scene.add(l);
    return l;
  });

  const sunDir = new THREE.Vector3(0, 1, 0);
  const moonDir = new THREE.Vector3();
  const skyDay = new THREE.Color(0xa9c4e6), skyDusk = new THREE.Color(0xe8a070), skyNight = new THREE.Color(0x0b1026), tmp = new THREE.Color();
  const cloudNight = new THREE.Color(0x8a9ac8);
  const tint = new THREE.Color();
  const c1 = new THREE.Color(), c2 = new THREE.Color();
  const WHITE = new THREE.Color(1, 1, 1);
  let dayFactor = 1;
  let bloomOn = true;
  let hdri = false;

  function resize() {
    renderer.setSize(innerWidth, innerHeight, false);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
  }

  /** Storybook: the painted sky, warm key / cool fill, rim, gradient fog, clouds, bloom. */
  function updateStory(weather: string, look: Looks, focus: THREE.Vector3, dusk: number) {
    const clear = weather === 'clear';
    const night = 1 - dayFactor;
    const su = sky.u;
    paintSky(su, dayFactor, dusk, tint, sunDir);
    if (!clear) for (const k of ['zenith', 'mid', 'horizon'] as const) su[k].value.lerp(tmp.set(weather === 'fog' ? 0xa7a8ae : 0x7d8594).multiplyScalar(0.3 + 0.7 * dayFactor), weather === 'fog' ? 0.75 : 0.55);
    // warm key: the sun (golden, then orange at dusk); at night the moon keys the scene in cool blue
    sun.intensity = (2.8 + 0.5 * dusk) * dayFactor * look.sunIntensity * (clear ? 1 : 0.45);
    sun.color.set(0xfff0d8).lerp(c1.set(0xff9c52), Math.min(1, dusk * 1.2));
    moon.position.copy(focus).addScaledVector(moonDir, 200);
    moon.target.position.copy(focus);
    // by day the "moon" light is the cool fill from the side away from the sun
    moon.intensity = (0.3 * dayFactor + 1.2 * night * night) * look.sunIntensity * (clear ? 1 : 0.7);
    moon.color.set(0x9db8ff).lerp(c1.set(0x8aa6ff), night);
    // sky light takes the painted sky's own colour: blue by day, rose-lavender at dusk, deep blue at night
    hemi.intensity = (0.5 + 0.2 * dayFactor + 0.3 * dusk) * (0.35 + 0.65 * dayFactor) * (clear ? 1 : 1.2);
    hemi.color.copy(su.mid.value).lerp(su.zenith.value, 0.3);
    hemi.color.multiplyScalar(1 / Math.max(1e-4, hemi.color.r, hemi.color.g, hemi.color.b)).lerp(WHITE, 0.35);
    hemi.groundColor.set(0x1a1826).lerp(c1.set(0x6b5a3a), dayFactor).lerp(c2.set(0x8a5a44), dusk * 0.5);
    setEnv(night > 0.6 ? 'night' : dusk > 0.45 ? 'dusk' : 'day');
    scene.environmentIntensity = 0.25 + 0.15 * dayFactor;
    // rim light on characters: the key light's colour, from its side
    story.keyDir.value.copy(dayFactor > 0.35 ? sunDir : moonDir);
    story.rimColor.value.copy(sun.color).multiplyScalar(0.35 + 0.45 * dusk).lerp(c2.set(0x8fb0ff).multiplyScalar(0.5), night);

    // fog: the horizon's colour, warmer toward the sun, bluer looking up
    const fog = scene.fog as THREE.FogExp2;
    fog.color.copy(su.horizon.value).lerp(su.mid.value, 0.2);
    if (weather === 'rain') fog.color.multiplyScalar(0.75);
    fog.density = 0.0019 * look.fogDensity * (weather === 'fog' ? 4 : weather === 'rain' ? 1.8 : weather === 'snow' ? 1.5 : 1);
    story.fogSunDir.value.copy(sunDir);
    story.fogSunColor.value.copy(su.sunColor.value).multiplyScalar((0.15 + 0.5 * dusk) * (clear ? 1 : 0.3));
    story.fogSkyColor.value.copy(su.mid.value).sub(fog.color).multiplyScalar(0.35);

    starMat.opacity = Math.max(0, 1 - dayFactor * 1.6) * (clear ? 1 : 0.2);
    stars.visible = starMat.opacity > 0.003;
    stars.position.copy(camera.position);
    moonSprite.position.copy(camera.position).addScaledVector(moonDir, 1500);
    moonSprite.material.opacity = Math.max(0, 1 - dayFactor * 1.4);
    if (painted) painted.position.copy(camera.position);

    renderer.toneMappingExposure = 1.1 - 0.2 * dayFactor;
    // clouds: white with lilac shade by day; peach tops and violet bellies at dusk; moonlit blue at night
    clouds.position.x = (performance.now() / 1000) * 3 % 2400;
    const cu = storyClouds!.u;
    cu.lit.value.set(0xffffff).lerp(c1.set(0xffc28a), dusk * 0.85).lerp(c2.set(0x42528a), night).multiply(tint);
    cu.shade.value.set(0xb4bdd6).lerp(c1.set(0x8a6a9a), dusk * 0.8).lerp(c2.set(0x141b38), night).multiply(tint);
    if (!clear) { cu.lit.value.multiplyScalar(0.75); cu.shade.value.multiplyScalar(0.7); }
    cu.opacity.value = clear ? 0.92 : 1;
    scene.background = null;
    // bloom: only real light sources (windows, candles, lanterns, spells), stronger in the dark
    bloom.strength.value = bloomOn ? (0.35 + 0.55 * night) * look.glow : 0;
    bloom.radius.value = 0.55;
    // the brightest a sunlit or moonlit painted surface gets (albedo <= 0.9): only things brighter bloom
    const lit = 0.9 * (sun.intensity + moon.intensity + hemi.intensity + scene.environmentIntensity);
    bloom.threshold.value = Math.min(3, Math.max(1.0, lit * 1.05)); // (capped, so spells still bloom at noon)
    grade.tint.value.copy(tint).lerp(WHITE, 0.35);
    grade.saturation.value = 0.98;
    grade.vignette.value = 0.3 + 0.1 * night;
  }

  /** ?style=real: the photographic sky and light, as before. */
  function updateReal(weather: string, look: Looks, focus: THREE.Vector3, dusk: number) {
    preetham!.sunPosition.value.copy(sunDir);
    sun.intensity = 2.8 * dayFactor * look.sunIntensity * (weather === 'clear' ? 1 : 0.45);
    sun.color.setRGB(1, 0.85 + 0.15 * (1 - dusk), 0.7 + 0.3 * (1 - dusk));
    moon.position.copy(focus).addScaledVector(sunDir, -200).setY(focus.y + 150);
    moon.target.position.copy(focus);
    moon.intensity = 0.8 * (1 - dayFactor) * look.sunIntensity;
    hemi.intensity = (0.3 + 0.45 * dayFactor) * (weather === 'clear' ? 1 : 0.8);
    hemi.color.copy(tint).multiplyScalar(0.8).lerp(c1.set(0xcfe3ff), 0.5);
    if (hdri) setEnv(dayFactor > 0.3 ? 'day' : 'night');
    scene.environmentIntensity = hdri ? (dayFactor > 0.3 ? 0.35 + 0.45 * dayFactor : 0.6) : 0.12 + 0.55 * dayFactor;
    flareHost.position.copy(camera.position).addScaledVector(sunDir, 1500);
    flare!.visible = dayFactor > 0.75 && weather === 'clear';

    tmp.copy(skyNight).lerp(skyDay, dayFactor).lerp(skyDusk, dusk * 0.6).multiply(tint);
    if (weather === 'rain') tmp.multiplyScalar(0.6);
    if (weather === 'fog') tmp.lerp(c1.set(0x9a9a9a), 0.6);
    const fog = scene.fog as THREE.FogExp2;
    fog.color.copy(tmp);
    fog.density = 0.0022 * look.fogDensity * (weather === 'fog' ? 4 : weather === 'rain' ? 1.8 : weather === 'snow' ? 1.5 : 1);
    preetham!.rayleigh.value = weather === 'clear' ? 1.6 : 0.6;
    preetham!.turbidity.value = weather === 'clear' ? 5 : 14;
    preetham!.visible = dayFactor > 0.02;

    starMat.opacity = (1 - dayFactor) * (weather === 'clear' ? 1 : 0.2);
    stars.visible = starMat.opacity > 0.003;
    stars.position.copy(camera.position);
    moonSprite.position.copy(camera.position).addScaledVector(sunDir, -1500).setY(camera.position.y + 600);
    moonSprite.material.opacity = 1 - dayFactor;

    renderer.toneMappingExposure = 0.55 + 0.35 * dayFactor;
    clouds.position.x = (performance.now() / 1000) * 3 % 2400;
    // clouds: white by day, golden at dusk, dim moonlit blue-grey at night
    const cc = c2.setRGB(1, 1, 1).lerp(skyDusk, dusk * 0.7).lerp(cloudNight, 1 - dayFactor).multiplyScalar(0.12 + 0.88 * dayFactor).multiply(tint);
    if (weather !== 'clear') cc.multiplyScalar(0.7);
    for (const m of cloudMats) { m.color.copy(cc); m.opacity = weather === 'clear' ? 0.75 : 0.95; }
    scene.background = dayFactor > 0.02 ? null : tmp;
    bloom.strength.value = bloomOn ? (0.45 + 0.5 * (1 - dayFactor)) * look.glow : 0;
    // by day, sunlit surfaces run bright too: raise the threshold so only real light sources bloom
    bloom.threshold.value = 1.1 + 1.4 * dayFactor * dayFactor;
    grade.tint.value.copy(tint).lerp(WHITE, 0.35);
  }

  return {
    renderer, scene, camera, post, sunDir,
    /** 'webgpu' or 'webgl' (the WebGPU renderer's WebGL 2 fallback). */
    backend: gpuBackend(),
    fallbackReason,
    compute: COMPUTE(),
    get day() { return dayFactor; },
    resize,
    setPixelRatio(r: number) { renderer.setPixelRatio(r); resize(); },
    /** MSAA samples of the HDR scene target (4 at 'high', 2 at 'low'). */
    setSamples(n: number) { post.setSamples(n); },
    /** Redraw the sun's shadow map this frame? (main.ts: every other frame.) */
    shadowFrame(due: boolean) { sun.shadow.autoUpdate = false; sun.shadow.needsUpdate = due; },
    /** Compile every material in `sc` for the frame's own render target (the HDR scene pass). */
    async warm(sc: THREE.Scene = scene, cam: THREE.Camera = camera) {
      const was = renderer.getRenderTarget();
      renderer.setRenderTarget(post.scenePass.renderTarget);
      // (the node renderer compiles only what the camera sees: everything, for once)
      const back = uncull(sc);
      try { await renderer.compileAsync(sc, cam); } finally { back(); renderer.setRenderTarget(was); }
    },
    /**
     * Draw one frame of `sc` now (behind the loading veil) so that what compileAsync cannot reach is compiled too:
     * the shadow map's pipelines and the post-processing passes.
     */
    warmFrame() {
      sun.shadow.autoUpdate = false;
      sun.shadow.needsUpdate = true;
      const back = uncull(scene);
      // (from above the Black Lake, so that its mirror renders too: the mirror draws the scene into a target of its
      // own, and its pipelines are compiled on the first frame it does)
      const pos = camera.position.clone(), rot = camera.quaternion.clone();
      camera.position.set(-110, 40, 110);
      camera.lookAt(-110, 0, 40);
      camera.updateMatrixWorld();
      try { runFrameJobs(renderer, camera); post.render(); } finally {
        back();
        camera.position.copy(pos);
        camera.quaternion.copy(rot);
        camera.updateMatrixWorld();
      }
    },
    /** Drive sky, lights, fog and grading from the in-game hour, weather and the Minister's aesthetics. */
    update(hour: number, weather: string, look: Looks, focus: THREE.Vector3) {
      captureCamera(camera);
      focus = captureFocus(focus);
      [hour, weather] = captureEnv(hour, weather);
      // sun travels east -> south -> west; elevation peaks at noon
      const a = ((hour - 6) / 12) * Math.PI;
      // Storybook: the sun arcs through the southern sky (Scotland), so from the grounds the castle's
      // south front catches the morning and evening light; the moon rides low in the north, over the
      // castle, and silhouettes it against the night sky. (?style=real keeps its old northern sun.)
      sunDir.set(Math.cos(a) * 0.8, Math.sin(a), STORYBOOK ? 0.35 : -0.35).normalize();
      moonDir.set(-Math.cos(a) * 0.7, 0.14 + 0.12 * Math.max(0, -Math.sin(a)), -0.8).normalize();
      const elev = sunDir.y;
      dayFactor = THREE.MathUtils.smoothstep(elev, -0.12, 0.25);
      const dusk = Math.max(0, 1 - Math.abs(elev - 0.05) * 6);
      tint.set(look.skyTint);
      sun.position.copy(focus).addScaledVector(sunDir, 200);
      sun.target.position.copy(focus);
      if (STORYBOOK) updateStory(weather, look, focus, dusk);
      else updateReal(weather, look, focus, dusk);
    },
    setBoltLights(bolts: { x: number; y?: number; z: number; color: number }[]) {
      boltLights.forEach((l, i) => {
        const b = bolts[i];
        l.intensity = b ? 18 : 0;
        if (b) { l.position.set(b.x, b.y ?? 1.5, b.z); l.color.setHex(b.color); }
      });
    },
    /** Low quality: 0.75x pixels, smaller shadow map, no bloom pass. Used on weak GPUs (auto-detected) or ?q=low. */
    setQuality(q: 'low' | 'high') {
      const low = q === 'low';
      renderer.setPixelRatio(low ? 0.75 : Math.min(2, devicePixelRatio));
      sun.shadow.mapSize.set(low ? 1024 : 2048, low ? 1024 : 2048);
      bloomOn = !low;
      post.setQuality(q);
      resize();
    },
    render() {
      if (captureCamera(camera)) return;
      runFrameJobs(renderer, camera);
      post.render();
    },
  };
}
export type Renderer = Awaited<ReturnType<typeof createRenderer>>;

/** Turn frustum culling off under `root` (returns the undo): a warm-up must reach what the camera does not see. */
function uncull(root: THREE.Object3D) {
  const off: THREE.Object3D[] = [], shown: THREE.Object3D[] = [];
  root.traverse((o) => {
    if (o.frustumCulled) { o.frustumCulled = false; off.push(o); }
    // hidden until it has something to draw (an empty grass chunk), but compiled with the rest
    if (!o.visible && o.userData.warmVisible) { o.visible = true; shown.push(o); }
  });
  return () => { for (const o of off) o.frustumCulled = true; for (const o of shown) o.visible = false; };
}
