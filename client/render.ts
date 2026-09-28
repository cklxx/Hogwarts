import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { Lensflare, LensflareElement } from 'three/addons/objects/Lensflare.js';
import { loadEnvironments } from './assets';
import { glowSprite } from './textures';

export interface Looks { skyTint: string; sunIntensity: number; fogDensity: number; glow: number }

/**
 * Lighting pipeline:
 *  physical Sky (Preetham) driven by the in-game hour -> sun + moon directional lights with a
 *  shadow frustum that follows the player -> PMREM room environment for PBR ambient ->
 *  HDR render -> UnrealBloom (windows, candles, spells glow) -> colour grade (Minister's sky tint,
 *  saturation, vignette) -> ACES tone mapping.
 */
export function createRenderer(canvas: HTMLCanvasElement) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(2, devicePixelRatio));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 5000);
  scene.fog = new THREE.FogExp2(0x9fb8d9, 0.003);

  // image-based lighting: a neutral room until the Poly Haven HDRIs arrive, then day/night maps
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  const env: { day: THREE.Texture | null; night: THREE.Texture | null } = { day: null, night: null };
  loadEnvironments(renderer, (day, night) => { env.day = day; env.night = night; });

  const sky = new Sky();
  sky.scale.setScalar(4000);
  scene.add(sky);
  const su = sky.material.uniforms;
  // The Preetham sky (and its sun disc) is far brighter than 1 around the sun; bloomed, a low sun
  // floods half the screen with haze. Cap it just below the bloom threshold: the sky never blooms,
  // only lamps, windows and spells do.
  sky.material.fragmentShader = sky.material.fragmentShader.replace('gl_FragColor = vec4( texColor, 1.0 );', 'gl_FragColor = vec4( texColor * min( 1.0, 1.05 / max( dot( texColor, vec3( 0.2126, 0.7152, 0.0722 ) ), 1e-4 ) ), 1.0 );');
  su.turbidity.value = 5;
  su.rayleigh.value = 1.6;
  su.mieCoefficient.value = 0.004;
  su.mieDirectionalG.value = 0.82;

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
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 1.8, sizeAttenuation: false, transparent: true, fog: false, depthWrite: false }));
  scene.add(stars);
  const moonSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowSprite('rgba(235,240,255,1)', 'rgba(150,170,255,0)'), fog: false, depthWrite: false, transparent: true }));
  moonSprite.scale.setScalar(160);
  scene.add(moonSprite);

  // lens flare on the sun (three.js example flare textures)
  const flareHost = new THREE.PointLight(0xffffff, 0, 1);
  const flare = new Lensflare();
  const tl = new THREE.TextureLoader();
  // kept small and dim: the bloom pass already spreads the sun, and a big flare washes out a low sun
  flare.addElement(new LensflareElement(tl.load('/textures/lensflare0.png'), 280, 0, new THREE.Color(0.6, 0.56, 0.5)));
  for (const [size, d] of [[60, 0.55], [80, 0.7], [120, 0.9], [70, 1.0]]) flare.addElement(new LensflareElement(tl.load('/textures/lensflare3.png'), size, d));
  flareHost.add(flare);
  scene.add(flareHost);

  // clouds: soft billboards (CC0 cloud texture from pmndrs/assets) drifting over the Highlands
  const cloudTex = new THREE.TextureLoader().load('/textures/cloud.webp');
  cloudTex.colorSpace = THREE.SRGBColorSpace;
  const clouds = new THREE.Group();
  const cloudMats: THREE.SpriteMaterial[] = [];
  for (let i = 0; i < 46; i++) {
    const cx = (Math.random() - 0.5) * 2400, cz = (Math.random() - 0.5) * 2400, cy = 180 + Math.random() * 140;
    for (let k = 0; k < 4; k++) {
      const m = new THREE.SpriteMaterial({ map: cloudTex, transparent: true, depthWrite: false, fog: false, opacity: 0.85, rotation: Math.random() * 6.28 });
      cloudMats.push(m);
      const sp = new THREE.Sprite(m);
      const sc = 90 + Math.random() * 120;
      sp.scale.set(sc * 1.6, sc, 1);
      sp.position.set(cx + (Math.random() - 0.5) * 140, cy + (Math.random() - 0.5) * 30, cz + (Math.random() - 0.5) * 80);
      clouds.add(sp);
    }
  }
  scene.add(clouds);

  // post-processing, rendered into a multisampled HDR target (MSAA survives the composer)
  const rt = new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.6, 0.45, 1.1);
  composer.addPass(bloom);
  const grade = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, tint: { value: new THREE.Color(1, 1, 1) }, saturation: { value: 1.08 }, vignette: { value: 0.32 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform sampler2D tDiffuse; uniform vec3 tint; uniform float saturation; uniform float vignette; varying vec2 vUv;
      void main(){
        vec4 c = texture2D(tDiffuse, vUv);
        float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
        c.rgb = mix(vec3(l), c.rgb, saturation) * tint;
        float d = distance(vUv, vec2(0.5));
        c.rgb *= 1.0 - vignette * smoothstep(0.35, 0.85, d);
        gl_FragColor = c;
      }`,
  });
  composer.addPass(grade);
  composer.addPass(new OutputPass());

  // a small pool of point lights handed to the spells nearest the camera
  const boltLights = Array.from({ length: 6 }, () => {
    const l = new THREE.PointLight(0xffffff, 0, 14, 1.6);
    scene.add(l);
    return l;
  });

  const sunDir = new THREE.Vector3(0, 1, 0);
  const skyDay = new THREE.Color(0xa9c4e6), skyDusk = new THREE.Color(0xe8a070), skyNight = new THREE.Color(0x0b1026), tmp = new THREE.Color();
  const cloudNight = new THREE.Color(0x8a9ac8);
  const tint = new THREE.Color();
  let dayFactor = 1;

  function resize() {
    renderer.setSize(innerWidth, innerHeight, false);
    composer.setSize(innerWidth, innerHeight);
    bloom.resolution.set(innerWidth / 2, innerHeight / 2);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
  }

  return {
    renderer, scene, camera, composer, sunDir,
    get day() { return dayFactor; },
    resize,
    /** Drive sky, lights, fog and grading from the in-game hour, weather and the Minister's aesthetics. */
    update(hour: number, weather: string, look: Looks, focus: THREE.Vector3) {
      // sun travels east -> south -> west; elevation peaks at noon
      const a = ((hour - 6) / 12) * Math.PI;
      sunDir.set(Math.cos(a) * 0.8, Math.sin(a), -0.35).normalize();
      su.sunPosition.value.copy(sunDir);
      const elev = sunDir.y;
      dayFactor = THREE.MathUtils.smoothstep(elev, -0.12, 0.25);
      const dusk = Math.max(0, 1 - Math.abs(elev - 0.05) * 6);
      tint.set(look.skyTint);

      sun.position.copy(focus).addScaledVector(sunDir, 200);
      sun.target.position.copy(focus);
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
      flare.visible = dayFactor > 0.75 && weather === 'clear';

      tmp.copy(skyNight).lerp(skyDay, dayFactor).lerp(skyDusk, dusk * 0.6).multiply(tint);
      if (weather === 'rain') tmp.multiplyScalar(0.6);
      if (weather === 'fog') tmp.lerp(new THREE.Color(0x9a9a9a), 0.6);
      const fog = scene.fog as THREE.FogExp2;
      fog.color.copy(tmp);
      fog.density = 0.0022 * look.fogDensity * (weather === 'fog' ? 4 : weather === 'rain' ? 1.8 : weather === 'snow' ? 1.5 : 1);
      su.rayleigh.value = weather === 'clear' ? 1.6 : 0.6;
      su.turbidity.value = weather === 'clear' ? 5 : 14;
      sky.visible = dayFactor > 0.02;

      (stars.material as THREE.PointsMaterial).opacity = (1 - dayFactor) * (weather === 'clear' ? 1 : 0.2);
      stars.position.copy(camera.position);
      moonSprite.position.copy(camera.position).addScaledVector(sunDir, -1500).setY(camera.position.y + 600);
      moonSprite.material.opacity = 1 - dayFactor;

      renderer.toneMappingExposure = 0.55 + 0.35 * dayFactor;
      // clouds drift with the wind and take the colour of the sky (golden at dusk, dark at night)
      clouds.position.x = (performance.now() / 1000) * 3 % 2400;
      // clouds: white by day, golden at dusk, dim moonlit blue-grey at night
      const cc = new THREE.Color(1, 1, 1).lerp(skyDusk, dusk * 0.7).lerp(cloudNight, 1 - dayFactor).multiplyScalar(0.12 + 0.88 * dayFactor).multiply(tint);
      if (weather !== 'clear') cc.multiplyScalar(0.7);
      for (const m of cloudMats) { m.color.copy(cc); m.opacity = weather === 'clear' ? 0.75 : 0.95; }
      scene.background = dayFactor > 0.02 ? null : tmp;
      bloom.strength = (0.45 + 0.5 * (1 - dayFactor)) * look.glow;
      // by day, sunlit surfaces run bright too: raise the threshold so only real light sources bloom
      bloom.threshold = 1.1 + 1.4 * dayFactor * dayFactor;
      (grade.uniforms.tint.value as THREE.Color).copy(tint).lerp(new THREE.Color(1, 1, 1), 0.35);
    },
    setBoltLights(bolts: { x: number; y?: number; z: number; color: number }[]) {
      boltLights.forEach((l, i) => {
        const b = bolts[i];
        l.intensity = b ? 18 : 0;
        if (b) { l.position.set(b.x, b.y ?? 1.5, b.z); l.color.setHex(b.color); }
      });
    },
    /** Low quality: 1x pixels, smaller shadow map, no bloom pass. Used on weak GPUs (auto-detected) or ?q=low. */
    setQuality(q: 'low' | 'high') {
      const low = q === 'low';
      const ratio = low ? 0.75 : Math.min(2, devicePixelRatio);
      renderer.setPixelRatio(ratio);
      composer.setPixelRatio(ratio); // the HDR target is what is really rendered; scale it too
      sun.shadow.mapSize.set(low ? 1024 : 2048, low ? 1024 : 2048);
      sun.shadow.map?.dispose();
      sun.shadow.map = null as unknown as THREE.WebGLRenderTarget;
      bloom.enabled = !low;
      resize();
    },
    render() { composer.render(); },
  };
}
