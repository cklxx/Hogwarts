import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { Lensflare, LensflareElement } from 'three/addons/objects/Lensflare.js';
import { loadEnvironments } from './assets';
import { captureCamera, captureFocus } from './capture';
import { OVERLAY } from './layers';
import { gradedOutputPass } from './post';
import { STORYBOOK, glowSprite, paintedClouds, paintedMoon } from './textures';

/** The camera's vertical field of view; a portrait screen widens it for at least PORTRAIT_H_FOV across (up to PORTRAIT_V_MAX). */
const BASE_FOV = 55, PORTRAIT_H_FOV = 60, PORTRAIT_V_MAX = 88;
/** The vertical field of view for a screen of this width ÷ height (pure, for tests). */
export function fovFor(aspect: number, base = BASE_FOV, hMin = PORTRAIT_H_FOV): number {
  if (aspect >= 1) return base;
  const need = (2 * Math.atan(Math.tan((hMin * Math.PI) / 360) / aspect) * 180) / Math.PI;
  return Math.min(PORTRAIT_V_MAX, Math.max(base, need));
}
/**
 * The 2.5D lens (controls.ts setView): a long one from far up, as Diablo's and Hades' cameras are — 30° tall on a
 * wide screen, at least 32° across on a portrait one — so the ground keeps its proportions (things far up the screen
 * are not shrunk, the near ones not blown up) and the view reads like a board, not a fisheye.
 */
export const FLAT_FOV = 30, FLAT_H_FOV = 32;

export interface Looks { skyTint: string; sunIntensity: number; fogDensity: number; glow: number }

// ------------------------------------------------------------------ storybook shading (shared shader patches)
/**
 * Values the storybook shader patches read. They are plain {x, y, z} objects on purpose: three.js
 * clones Color/Vector uniforms per material but shares anything else by reference, so every material
 * compiled after installStorybookShading() reads these very objects, and one write per frame reaches all.
 */
const vec = () => ({ x: 0, y: 0, z: 0 });
const shared = { fogSunDir: vec(), fogSunColor: vec(), fogSkyColor: vec(), storyKeyDir: vec(), storyRimColor: vec() };
const setVec = (v: { x: number; y: number; z: number }, c: THREE.Color | THREE.Vector3) => {
  if ((c as THREE.Color).isColor) { const k = c as THREE.Color; v.x = k.r; v.y = k.g; v.z = k.b; } else { const k = c as THREE.Vector3; v.x = k.x; v.y = k.y; v.z = k.z; }
};
let installed = false;
/**
 * The storybook look is three small edits to three.js's own shader chunks (so every lit material in
 * the game gets them — the world's, the wizards', even ones main.ts makes — without touching each
 * material's own onBeforeCompile):
 *  - a soft toon ramp on direct diffuse light: shade, a half-lit band and full light with soft edges,
 *    keeping a quarter of the smooth falloff so forms still read (MeshStandard/Physical, Lambert, Phong);
 *  - a rim light (key-light coloured) on materials that define STORY_RIM (textures.ts rimLit: the
 *    wizards and creatures);
 *  - fog whose colour warms toward the sun and cools toward the sky instead of one flat colour.
 * Must run before the first material compiles.
 */
function installStorybookShading() {
  if (installed) return;
  installed = true;
  const C = THREE.ShaderChunk as unknown as Record<string, string>;
  const must = (chunk: string, from: string, to: string) => {
    if (!C[chunk].includes(from)) { console.warn(`storybook: ${chunk} changed, patch skipped`); return; }
    C[chunk] = C[chunk].replace(from, to);
  };
  C.lights_pars_begin = `uniform vec3 storyKeyDir;
uniform vec3 storyRimColor;
float storyRamp( in float x ) {
	x = clamp( x, -1.0, 1.0 ); // (like the saturate() it replaces, this also swallows a NaN from a degenerate normal)
	float r = smoothstep( -0.02, 0.12, x ) * 0.55 + smoothstep( 0.3, 0.56, x ) * 0.45;
	return mix( r, saturate( x ), 0.25 );
}
` + C.lights_pars_begin;
  // (physical: only the diffuse term is ramped. The specular term keeps the true cosine, which the
  // GGX visibility term divides by: ramped, it blows up into sparkles where N.L is near zero.)
  must('lights_physical_pars_fragment', 'reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseContribution ) * ( 1.0 - F );',
    'reflectedLight.directDiffuse += irradiance * ( storyRamp( dot( geometryNormal, directLight.direction ) ) / max( dotNL, 1e-3 ) ) * BRDF_Lambert( material.diffuseContribution ) * ( 1.0 - F );');
  for (const ch of ['lights_lambert_pars_fragment', 'lights_phong_pars_fragment'])
    must(ch, 'float dotNL = saturate( dot( geometryNormal, directLight.direction ) );', 'float dotNL = storyRamp( dot( geometryNormal, directLight.direction ) );');
  C.lights_fragment_end += `
#ifdef STORY_RIM
{
	float rimNV = 1.0 - saturate( dot( geometryNormal, geometryViewDir ) );
	vec3 rimKey = normalize( ( viewMatrix * vec4( storyKeyDir + vec3( 0.0, 1e-4, 0.0 ), 0.0 ) ).xyz );
	float rimSide = 0.3 + 0.7 * saturate( dot( geometryNormal, rimKey ) * 0.6 + 0.4 );
	reflectedLight.directSpecular += storyRimColor * smoothstep( 0.5, 0.85, rimNV ) * rimSide;
}
#endif
`;
  must('fog_pars_vertex', 'varying float vFogDepth;', 'varying float vFogDepth;\n\tvarying vec3 vFogView;');
  must('fog_vertex', 'vFogDepth = - mvPosition.z;', 'vFogDepth = - mvPosition.z;\n\tvFogView = mvPosition.xyz;');
  must('fog_pars_fragment', 'varying float vFogDepth;', 'varying float vFogDepth;\n\tvarying vec3 vFogView;\n\tuniform vec3 fogSunDir;\n\tuniform vec3 fogSunColor;\n\tuniform vec3 fogSkyColor;');
  must('fog_fragment', 'gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );', `vec3 fogDirW = normalize( ( vec4( vFogView, 0.0 ) * viewMatrix ).xyz );
	vec3 fogTint = fogColor + fogSunColor * pow( max( dot( fogDirW, fogSunDir ), 0.0 ), 5.0 ) + fogSkyColor * smoothstep( 0.0, 0.35, fogDirW.y );
	gl_FragColor.rgb = mix( gl_FragColor.rgb, max( fogTint, vec3( 0.0 ) ), fogFactor );`);
  const fogU = { fogSunDir: shared.fogSunDir, fogSunColor: shared.fogSunColor, fogSkyColor: shared.fogSkyColor };
  const rimU = { storyKeyDir: shared.storyKeyDir, storyRimColor: shared.storyRimColor };
  for (const lib of Object.values(THREE.ShaderLib)) {
    if (lib.uniforms.fogColor) for (const [k, v] of Object.entries(fogU)) lib.uniforms[k] = { value: v };
    if (lib.uniforms.directionalLights) for (const [k, v] of Object.entries(rimU)) lib.uniforms[k] = { value: v };
  }
  // ShaderMaterials that merge UniformsLib.fog later (particles, the lake) pick them up from here
  for (const [k, v] of Object.entries(fogU)) (THREE.UniformsLib.fog as Record<string, THREE.IUniform>)[k] = { value: v };
}

// ------------------------------------------------------------------ the painted sky
type SkyPalette = { zenith: string; mid: string; horizon: string; ground: string; sun: string };
const PALETTE: Record<'day' | 'dusk' | 'night', SkyPalette> = {
  day: { zenith: '#3b78c2', mid: '#7cafdc', horizon: '#d6e7ea', ground: '#8a9c80', sun: '#fff1cf' },
  dusk: { zenith: '#2a3877', mid: '#b56a8c', horizon: '#ffae6c', ground: '#58474e', sun: '#ff9a4a' },
  night: { zenith: '#040920', mid: '#0b1641', horizon: '#1b2b5c', ground: '#080d1e', sun: '#000000' },
};
function skyMaterial() {
  const c = () => ({ value: new THREE.Color() });
  return new THREE.ShaderMaterial({
    uniforms: { uZenith: c(), uMid: c(), uHorizon: c(), uGround: c(), uSunColor: c(), uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunDisc: { value: 1 } },
    side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: `varying vec3 vDir;
      void main() {
        vDir = position;
        vec4 p = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
        gl_Position = vec4( p.xy, p.w * 0.99999, p.w ); // on the far plane, drawn only where nothing else is
      }`,
    fragmentShader: `uniform vec3 uZenith; uniform vec3 uMid; uniform vec3 uHorizon; uniform vec3 uGround; uniform vec3 uSunColor; uniform vec3 uSunDir; uniform float uSunDisc;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize( vDir );
        float h = d.y, az = atan( d.z, d.x );
        // washes of colour whose edges wander a little, like wet brushwork
        float hw = h + 0.03 * sin( az * 3.0 + h * 9.0 ) + 0.014 * sin( az * 7.0 - h * 17.0 );
        vec3 col = mix( uHorizon, uMid, smoothstep( 0.0, 0.3, hw ) );
        col = mix( col, uZenith, smoothstep( 0.2, 0.85, hw ) );
        float s = max( dot( d, uSunDir ), 0.0 );
        col += uSunColor * ( 0.32 * pow( s, 5.0 ) + 0.45 * pow( s, 36.0 ) ) * ( 1.0 - 0.6 * smoothstep( 0.0, 0.6, h ) );
        col = mix( col, uSunColor * 1.15 + 0.2, smoothstep( 0.9974, 0.9984, s ) * uSunDisc ); // a flat painted sun
        col = mix( col, uGround, smoothstep( 0.02, -0.14, h ) );
        // the sky never blooms: only lamps, windows and spells do
        float l = dot( col, vec3( 0.2126, 0.7152, 0.0722 ) );
        gl_FragColor = vec4( col * min( 1.0, 0.95 / max( l, 1e-4 ) ), 1.0 );
      }`,
  });
}
/** Set a sky material's colours for day factor `day` and dusk weight `dusk`, times the Minister's tint. */
function paintSky(m: THREE.ShaderMaterial, day: number, dusk: number, tint: THREE.Color, sunDir: THREE.Vector3) {
  const u = m.uniforms;
  const mix = (k: keyof SkyPalette, out: THREE.Color) => out.set(PALETTE.night[k]).lerp(tmpA.set(PALETTE.day[k]), day).lerp(tmpA.set(PALETTE.dusk[k]), dusk * 0.85).multiply(tint);
  mix('zenith', u.uZenith.value);
  mix('mid', u.uMid.value);
  mix('horizon', u.uHorizon.value);
  mix('ground', u.uGround.value);
  (u.uSunColor.value as THREE.Color).set(PALETTE.day.sun).lerp(tmpA.set(PALETTE.dusk.sun), Math.min(1, dusk * 1.3)).multiplyScalar(THREE.MathUtils.smoothstep(sunDir.y, -0.08, 0.04));
  u.uSunDir.value.copy(sunDir);
  u.uSunDisc.value = THREE.MathUtils.smoothstep(sunDir.y, -0.05, 0.02);
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
  const mat = new THREE.ShaderMaterial({
    uniforms: { map: { value: paintedClouds() }, uLit: { value: new THREE.Color(1, 1, 1) }, uShade: { value: new THREE.Color(0.7, 0.75, 0.85) }, uOpacity: { value: 0.9 } },
    transparent: true, depthWrite: false, fog: false,
    vertexShader: `attribute vec2 aCorner; attribute vec2 aSize; attribute vec2 aAtlas; varying vec2 vUv;
      void main() {
        vec4 mv = modelViewMatrix * vec4( position, 1.0 );
        mv.xy += aCorner * aSize;
        vUv = aAtlas + ( aCorner + 0.5 ) * 0.5;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `uniform sampler2D map; uniform vec3 uLit; uniform vec3 uShade; uniform float uOpacity; varying vec2 vUv;
      void main() {
        vec4 t = texture2D( map, vUv );
        gl_FragColor = vec4( mix( uShade, uLit, smoothstep( 0.3, 0.95, t.r ) ), t.a * uOpacity );
      }`,
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1; // behind every other transparent thing (it is the farthest)
  return { mesh, mat };
}

/**
 * Lighting pipeline. Storybook (default): a painted gradient sky driven by the in-game hour -> a warm
 * key light (sun, or the moon at night) with a shadow frustum that follows the player, a cool fill
 * from the opposite side and a sky/ground hemisphere -> a soft toon ramp and a rim light on
 * characters (installStorybookShading) -> image-based light baked from the painted sky itself ->
 * HDR -> bloom tuned to catch only real light sources -> a grade (the Minister's sky tint, cool
 * shadows / warm lights, a faint paper grain, vignette) -> neutral tone mapping, which keeps the
 * painted colours. ?style=real keeps the older photographic pipeline: Preetham sky, Poly Haven HDRIs,
 * lens flare, ACES.
 */
export function createRenderer(canvas: HTMLCanvasElement) {
  if (STORYBOOK) installStorybookShading();
  // no multisampling on the canvas: the scene is multisampled in the composer's target, and the canvas only takes the
  // output pass and the overlay (a second MSAA buffer there was memory and bandwidth for nothing)
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  /** The canvas: the screen's pixels (up to 2x). The scene renders at `scale` (setScale) and is upscaled into it. */
  const outRatio = Math.min(2, devicePixelRatio);
  let scale = outRatio;
  renderer.setPixelRatio(outRatio);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap; // (three r18x dropped PCFSoft: it fell back to this with a warning)
  renderer.toneMapping = STORYBOOK ? THREE.NeutralToneMapping : THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(BASE_FOV, 1, 0.1, 5000);
  scene.fog = new THREE.FogExp2(0x9fb8d9, 0.003);

  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  const env: { day: THREE.Texture | null; dusk: THREE.Texture | null; night: THREE.Texture | null } = { day: null, dusk: null, night: null };

  // ---- sky
  let preetham: Sky | null = null;
  let painted: THREE.Mesh | null = null;
  const skyMat = skyMaterial();
  if (STORYBOOK) {
    painted = new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), skyMat);
    painted.frustumCulled = false;
    painted.renderOrder = 1; // after the opaque world, so it only fills what is left
    scene.add(painted);
    // image-based light baked from the painted sky at three times of day (metal, the Mirror, glamours reflect it)
    const bake = new THREE.Scene();
    const bakeMat = skyMaterial();
    bake.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), bakeMat));
    const white = new THREE.Color(1, 1, 1);
    const at = (day: number, dusk: number, elev: number) => {
      paintSky(bakeMat, day, dusk, white, new THREE.Vector3(0.8, elev, -0.35).normalize());
      return pmrem.fromScene(bake, 0.02, 0.1, 100).texture;
    };
    env.day = at(1, 0, 0.8);
    env.dusk = at(0.6, 1, 0.05);
    env.night = at(0, 0, -0.5);
    bakeMat.dispose();
  } else {
    preetham = new Sky();
    preetham.scale.setScalar(4000);
    scene.add(preetham);
    // The Preetham sky (and its sun disc) is far brighter than 1 around the sun; bloomed, a low sun
    // floods half the screen with haze. Cap it just below the bloom threshold: the sky never blooms,
    // only lamps, windows and spells do.
    preetham.material.fragmentShader = preetham.material.fragmentShader.replace('gl_FragColor = vec4( texColor, 1.0 );', 'gl_FragColor = vec4( texColor * min( 1.0, 1.05 / max( dot( texColor, vec3( 0.2126, 0.7152, 0.0722 ) ), 1e-4 ) ), 1.0 );');
    const su = preetham.material.uniforms;
    su.turbidity.value = 5;
    su.rayleigh.value = 1.6;
    su.mieCoefficient.value = 0.004;
    su.mieDirectionalG.value = 0.82;
    // image-based lighting: a neutral room until the Poly Haven HDRIs arrive, then day/night maps
    loadEnvironments(renderer, (day, night) => { env.day = day; env.night = night; });
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

  // stars and the moon live far away and ignore fog
  const starGeo = new THREE.BufferGeometry();
  const sp: number[] = [];
  for (let i = 0; i < 2500; i++) {
    const t = Math.random() * Math.PI * 2, p = Math.acos(Math.random() * 0.95);
    sp.push(Math.sin(p) * Math.cos(t) * 1800, Math.cos(p) * 1800, Math.sin(p) * Math.sin(t) * 1800);
  }
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: STORYBOOK ? 0xfff4d8 : 0xffffff, size: STORYBOOK ? 2.2 : 1.8, sizeAttenuation: false, transparent: true, fog: false, depthWrite: false }));
  scene.add(stars);
  const moonSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: STORYBOOK ? paintedMoon() : glowSprite('rgba(235,240,255,1)', 'rgba(150,170,255,0)'), fog: false, depthWrite: false, transparent: true }));
  moonSprite.scale.setScalar(STORYBOOK ? 300 : 160);
  scene.add(moonSprite);

  // lens flare on the sun (three.js example flare textures): photographic, so ?style=real only
  const flareHost = new THREE.PointLight(0xffffff, 0, 1);
  let flare: Lensflare | null = null;
  if (!STORYBOOK) {
    flare = new Lensflare();
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

  // post-processing, rendered into a multisampled HDR target (MSAA survives the composer); stencil: view.ts x-ray
  const rt = new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: THREE.HalfFloatType, samples: 4, stencilBuffer: true });
  const composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.6, 0.45, 1.1);
  composer.addPass(bloom);
  const grade = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, uTexel: { value: new THREE.Vector2(1, 1) }, uSharp: { value: 0 }, tint: { value: new THREE.Color(1, 1, 1) }, saturation: { value: 1.08 }, vignette: { value: 0.32 }, uStory: { value: STORYBOOK ? 1 : 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform sampler2D tDiffuse; uniform vec2 uTexel; uniform float uSharp; uniform vec3 tint; uniform float saturation; uniform float vignette; uniform float uStory; varying vec2 vUv;
      float h21( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
      void main(){
        vec4 c = texture2D(tDiffuse, vUv);
        // upscaling from a lower render scale: sharpen, held to the neighbourhood's own range so it cannot ring
        // (the idea of FSR 1's RCAS; four taps of the source)
        if (uSharp > 0.0) {
          vec3 n = texture2D(tDiffuse, vUv + vec2(0.0, uTexel.y)).rgb, s = texture2D(tDiffuse, vUv - vec2(0.0, uTexel.y)).rgb;
          vec3 e = texture2D(tDiffuse, vUv + vec2(uTexel.x, 0.0)).rgb, w = texture2D(tDiffuse, vUv - vec2(uTexel.x, 0.0)).rgb;
          vec3 lo = min(c.rgb, min(min(n, s), min(e, w))), hi = max(c.rgb, max(max(n, s), max(e, w)));
          c.rgb = clamp(c.rgb + (c.rgb - 0.25 * (n + s + e + w)) * uSharp, lo, hi);
        }
        float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
        c.rgb = mix(vec3(l), c.rgb, saturation) * tint;
        if (uStory > 0.5) {
          // illustrated light: cool violet-blue shadows, warm lights, and a faint paper grain
          float lt = l / (1.0 + l);
          c.rgb *= mix(vec3(0.9, 0.95, 1.12), vec3(1.05, 1.0, 0.93), smoothstep(0.04, 0.55, lt));
          float n = h21(floor(gl_FragCoord.xy / 2.0)) * 0.6 + h21(floor(gl_FragCoord.xy / 7.0) + 17.0) * 0.4;
          c.rgb *= 1.0 + (n - 0.5) * 0.05;
        }
        float d = distance(vUv, vec2(0.5));
        c.rgb *= 1.0 - vignette * smoothstep(0.35, 0.85, d);
        gl_FragColor = c;
      }`,
  });
  // the grade runs inside the output pass (post.ts): one full-screen pass fewer
  const output = gradedOutputPass(grade);
  if (!(output as { graded?: boolean }).graded) composer.addPass(grade);
  composer.addPass(output);

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
  /** The 2.5D lens is on (setLens). */
  let flat = false;

  function resize() {
    renderer.setSize(innerWidth, innerHeight, false);
    composer.setSize(innerWidth, innerHeight);
    grade.uniforms.uTexel.value.set(1 / Math.max(1, Math.floor(innerWidth * scale)), 1 / Math.max(1, Math.floor(innerHeight * scale)));
    // the lower the scene's scale against the screen's, the more it is sharpened (none at 1:1)
    grade.uniforms.uSharp.value = Math.min(0.8, Math.max(0, outRatio / scale - 1) * 0.8);
    bloom.resolution.set(innerWidth / 2, innerHeight / 2);
    camera.aspect = innerWidth / innerHeight;
    // a portrait phone: the vertical field of view widens so the horizontal one stays near PORTRAIT_H_FOV (at 55° a
    // 390×844 screen saw 27° across — "I can't see anyone"), up to PORTRAIT_V_MAX
    camera.fov = flat ? fovFor(camera.aspect, FLAT_FOV, FLAT_H_FOV) : fovFor(camera.aspect);
    camera.updateProjectionMatrix();
  }

  /** Storybook: the painted sky, warm key / cool fill, rim, gradient fog, clouds, bloom. */
  function updateStory(weather: string, look: Looks, focus: THREE.Vector3, dusk: number) {
    const clear = weather === 'clear';
    const night = 1 - dayFactor;
    paintSky(skyMat, dayFactor, dusk, tint, sunDir);
    const su = skyMat.uniforms;
    if (!clear) for (const k of ['uZenith', 'uMid', 'uHorizon'] as const) (su[k].value as THREE.Color).lerp(tmp.set(weather === 'fog' ? 0xa7a8ae : 0x7d8594).multiplyScalar(0.3 + 0.7 * dayFactor), weather === 'fog' ? 0.75 : 0.55);
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
    hemi.color.copy(su.uMid.value).lerp(su.uZenith.value, 0.3);
    hemi.color.multiplyScalar(1 / Math.max(1e-4, hemi.color.r, hemi.color.g, hemi.color.b)).lerp(WHITE, 0.35);
    hemi.groundColor.set(0x1a1826).lerp(c1.set(0x6b5a3a), dayFactor).lerp(c2.set(0x8a5a44), dusk * 0.5);
    scene.environment = night > 0.6 ? env.night : dusk > 0.45 ? env.dusk : env.day;
    scene.environmentIntensity = 0.25 + 0.15 * dayFactor;
    // rim light on characters: the key light's colour, from its side
    setVec(shared.storyKeyDir, dayFactor > 0.35 ? sunDir : moonDir);
    c1.copy(sun.color).multiplyScalar(0.35 + 0.45 * dusk).lerp(c2.set(0x8fb0ff).multiplyScalar(0.5), night);
    setVec(shared.storyRimColor, c1);

    // fog: the horizon's colour, warmer toward the sun, bluer looking up
    const fog = scene.fog as THREE.FogExp2;
    fog.color.copy(su.uHorizon.value).lerp(su.uMid.value, 0.2);
    if (weather === 'rain') fog.color.multiplyScalar(0.75);
    fog.density = 0.0019 * look.fogDensity * (weather === 'fog' ? 4 : weather === 'rain' ? 1.8 : weather === 'snow' ? 1.5 : 1);
    setVec(shared.fogSunDir, sunDir);
    setVec(shared.fogSunColor, c1.copy(su.uSunColor.value).multiplyScalar((0.15 + 0.5 * dusk) * (clear ? 1 : 0.3)));
    setVec(shared.fogSkyColor, c1.copy(su.uMid.value).sub(fog.color).multiplyScalar(0.35));

    (stars.material as THREE.PointsMaterial).opacity = Math.max(0, 1 - dayFactor * 1.6) * (clear ? 1 : 0.2);
    stars.position.copy(camera.position);
    moonSprite.position.copy(camera.position).addScaledVector(moonDir, 1500);
    moonSprite.material.opacity = Math.max(0, 1 - dayFactor * 1.4);
    if (painted) painted.position.copy(camera.position);

    renderer.toneMappingExposure = 1.1 - 0.2 * dayFactor;
    // clouds: white with lilac shade by day; peach tops and violet bellies at dusk; moonlit blue at night
    clouds.position.x = (performance.now() / 1000) * 3 % 2400;
    const cu = storyClouds!.mat.uniforms;
    (cu.uLit.value as THREE.Color).set(0xffffff).lerp(c1.set(0xffc28a), dusk * 0.85).lerp(c2.set(0x42528a), night).multiply(tint);
    (cu.uShade.value as THREE.Color).set(0xb4bdd6).lerp(c1.set(0x8a6a9a), dusk * 0.8).lerp(c2.set(0x141b38), night).multiply(tint);
    if (!clear) { (cu.uLit.value as THREE.Color).multiplyScalar(0.75); (cu.uShade.value as THREE.Color).multiplyScalar(0.7); }
    cu.uOpacity.value = clear ? 0.92 : 1;
    scene.background = null;
    // bloom: only real light sources (windows, candles, lanterns, spells), stronger in the dark
    bloom.strength = (0.35 + 0.55 * night) * look.glow;
    bloom.radius = 0.55;
    // the brightest a sunlit or moonlit painted surface gets (albedo <= 0.9): only things brighter bloom
    const lit = 0.9 * (sun.intensity + moon.intensity + hemi.intensity + scene.environmentIntensity);
    bloom.threshold = Math.min(3, Math.max(1.0, lit * 1.05)); // (capped, so spells still bloom at noon)
    (grade.uniforms.tint.value as THREE.Color).copy(tint).lerp(WHITE, 0.35);
    grade.uniforms.saturation.value = 0.98;
    grade.uniforms.vignette.value = 0.3 + 0.1 * night;
  }

  /** ?style=real: the photographic sky and light, as before. */
  function updateReal(weather: string, look: Looks, focus: THREE.Vector3, dusk: number) {
    const su = preetham!.material.uniforms;
    su.sunPosition.value.copy(sunDir);
    sun.intensity = 2.8 * dayFactor * look.sunIntensity * (weather === 'clear' ? 1 : 0.45);
    sun.color.setRGB(1, 0.85 + 0.15 * (1 - dusk), 0.7 + 0.3 * (1 - dusk));
    moon.position.copy(focus).addScaledVector(sunDir, -200).setY(focus.y + 150);
    moon.target.position.copy(focus);
    moon.intensity = 0.8 * (1 - dayFactor) * look.sunIntensity;
    hemi.intensity = (0.3 + 0.45 * dayFactor) * (weather === 'clear' ? 1 : 0.8);
    hemi.color.copy(tint).multiplyScalar(0.8).lerp(new THREE.Color(0xcfe3ff), 0.5);
    if (env.day && env.night) scene.environment = dayFactor > 0.3 ? env.day : env.night;
    scene.environmentIntensity = env.day ? (dayFactor > 0.3 ? 0.35 + 0.45 * dayFactor : 0.6) : 0.12 + 0.55 * dayFactor;
    flareHost.position.copy(camera.position).addScaledVector(sunDir, 1500);
    flare!.visible = dayFactor > 0.75 && weather === 'clear';

    tmp.copy(skyNight).lerp(skyDay, dayFactor).lerp(skyDusk, dusk * 0.6).multiply(tint);
    if (weather === 'rain') tmp.multiplyScalar(0.6);
    if (weather === 'fog') tmp.lerp(new THREE.Color(0x9a9a9a), 0.6);
    const fog = scene.fog as THREE.FogExp2;
    fog.color.copy(tmp);
    fog.density = 0.0022 * look.fogDensity * (weather === 'fog' ? 4 : weather === 'rain' ? 1.8 : weather === 'snow' ? 1.5 : 1);
    su.rayleigh.value = weather === 'clear' ? 1.6 : 0.6;
    su.turbidity.value = weather === 'clear' ? 5 : 14;
    preetham!.visible = dayFactor > 0.02;

    (stars.material as THREE.PointsMaterial).opacity = (1 - dayFactor) * (weather === 'clear' ? 1 : 0.2);
    stars.position.copy(camera.position);
    moonSprite.position.copy(camera.position).addScaledVector(sunDir, -1500).setY(camera.position.y + 600);
    moonSprite.material.opacity = 1 - dayFactor;

    renderer.toneMappingExposure = 0.55 + 0.35 * dayFactor;
    clouds.position.x = (performance.now() / 1000) * 3 % 2400;
    // clouds: white by day, golden at dusk, dim moonlit blue-grey at night
    const cc = new THREE.Color(1, 1, 1).lerp(skyDusk, dusk * 0.7).lerp(cloudNight, 1 - dayFactor).multiplyScalar(0.12 + 0.88 * dayFactor).multiply(tint);
    if (weather !== 'clear') cc.multiplyScalar(0.7);
    for (const m of cloudMats) { m.color.copy(cc); m.opacity = weather === 'clear' ? 0.75 : 0.95; }
    scene.background = dayFactor > 0.02 ? null : tmp;
    bloom.strength = (0.45 + 0.5 * (1 - dayFactor)) * look.glow;
    // by day, sunlit surfaces run bright too: raise the threshold so only real light sources bloom
    bloom.threshold = 1.1 + 1.4 * dayFactor * dayFactor;
    (grade.uniforms.tint.value as THREE.Color).copy(tint).lerp(WHITE, 0.35);
  }

  return {
    renderer, scene, camera, composer, sunDir,
    get day() { return dayFactor; },
    resize,
    /** Drive sky, lights, fog and grading from the in-game hour, weather and the Minister's aesthetics. */
    update(hour: number, weather: string, look: Looks, focus: THREE.Vector3) {
      captureCamera(camera);
      focus = captureFocus(focus);
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
    /** The scene's render scale (pixels per CSS pixel; the canvas keeps the screen's, up to 2x): dynres.ts drives it. */
    setScale(r: number) {
      scale = Math.min(outRatio, r);
      composer.setPixelRatio(scale); // the HDR target is what is really rendered
      resize();
    },
    get scale() { return scale; },
    /** 2.5D's long lens, or the follow camera's (FLAT_FOV). */
    setLens(on: boolean) { if (flat !== on) { flat = on; resize(); } },
    outRatio,
    /** Low quality: smaller shadow map, no bloom pass (the render scale is dynres.ts's). Weak GPUs (auto-detected) or ?q=low. */
    setQuality(q: 'low' | 'high') {
      const low = q === 'low';
      sun.shadow.mapSize.set(low ? 1024 : 2048, low ? 1024 : 2048);
      sun.shadow.map?.dispose();
      sun.shadow.map = null as unknown as THREE.WebGLRenderTarget;
      bloom.enabled = !low;
      resize();
    },
    render() {
      if (captureCamera(camera)) return;
      composer.render();
      // the overlay (layers.ts): sharp text at the canvas's own resolution, over the finished frame
      const bg = scene.background, clear = renderer.autoClear;
      scene.background = null; renderer.autoClear = false;
      camera.layers.set(OVERLAY);
      renderer.setRenderTarget(null);
      renderer.render(scene, camera);
      camera.layers.set(0);
      scene.background = bg; renderer.autoClear = clear;
    },
  };
}
