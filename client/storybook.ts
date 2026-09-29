import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';
import { STORYBOOK } from './textures';

/**
 * The storybook shading, in TSL (three.js's node shading language): one definition that compiles to WGSL on
 * the WebGPU backend and to GLSL on WebGL 2. It replaces the old edits to three.js's GLSL shader chunks,
 * which the node renderer does not use.
 *
 *  - a soft toon ramp on the direct diffuse light (StoryLightingModel): shade, a half-lit band and full
 *    light with soft edges, keeping a quarter of the smooth falloff so forms still read;
 *  - a rim light in the key light's colour on characters (materials marked by textures.ts rimLit);
 *  - fog whose colour warms toward the sun and cools toward the sky (storyFog).
 *
 * Every MeshStandardMaterial / MeshPhysicalMaterial the game makes is drawn as StoryStandardMaterial /
 * StoryPhysicalMaterial (installStorybook registers them with the renderer), so the look reaches the
 * world's, the wizards' and any other lit material without each one having to opt in.
 */
const T = TSL as unknown as Record<string, any>;
const { Fn, vec3, vec4, float, uniform, clamp, smoothstep, mix, saturate, normalize, pow, max, dot, reference,
  normalView, normalViewGeometry, negateOnBackSide, positionViewDirection, positionWorld, cameraPosition, cameraViewMatrix,
  densityFogFactor, fog, diffuseColor, modelViewMatrix, frontFacing, materialReference } = T;

/** Values the storybook shading reads, written once a frame by render.ts. */
export const story = {
  /** The key light's direction (world, toward the light): the sun, or the moon at night. */
  keyDir: uniform(new THREE.Vector3(0, 1, 0)),
  rimColor: uniform(new THREE.Color(0, 0, 0)),
  fogSunDir: uniform(new THREE.Vector3(0, 1, 0)),
  fogSunColor: uniform(new THREE.Color(0, 0, 0)),
  fogSkyColor: uniform(new THREE.Color(0, 0, 0)),
};

/** The toon ramp on N·L (clamped first, which also swallows a NaN from a degenerate normal). */
export const storyRamp = Fn(([x0]: any[]) => {
  const x = clamp(x0, -1, 1);
  const r = smoothstep(-0.02, 0.12, x).mul(0.55).add(smoothstep(0.3, 0.56, x).mul(0.45));
  return mix(r, saturate(x), 0.25);
});

/**
 * Light added (or changed) after a material is lit, by name (material.storyFx): the animated glamours
 * (models.ts registers starlight, flame and ghost). `light` is the lit colour; return the new one.
 */
export const storyEffects: Record<string, (light: any, material: THREE.Material) => any> = {};

type StoryMat = THREE.MeshStandardNodeMaterial & { storyRim?: number; storyFx?: string; storyLining?: number; flatShading?: boolean; bumpMap?: THREE.Texture | null; normalMap?: THREE.Texture | null };

/**
 * Cloth (storyLining = 1): the inside of the faces shows the material's `uLining` colour. Applied to the
 * diffuse colour after the map and the vertex colours, not as a colorNode (the shadow map's material reads a
 * colorNode's alpha, and has no lining to read).
 */
function lining(m: StoryMat) {
  if (m.storyLining) diffuseColor.rgb.assign(frontFacing.select(diffuseColor.rgb, materialReference('uLining', 'color')));
}

/** The normal the ramp and the rim use: the surface's own (a bump map's detail left out, as before). */
function geometryNormal(m: StoryMat, builder: any) {
  if (m.normalNode || !(m.bumpMap || m.normalMap)) return normalView;
  return builder.isFlatShading() ? normalViewGeometry : negateOnBackSide(normalViewGeometry);
}

/**
 * three.js's physical lighting with the diffuse term of every direct light run through the ramp. The
 * specular term keeps the true cosine (the GGX visibility term divides by it: ramped, it would blow up into
 * sparkles where N·L is near zero).
 */
class StoryLightingModel extends (THREE.PhysicalLightingModel as any) {
  rampNormal: any;
  rim: boolean;
  constructor(rampNormal: any, rim: boolean, ...physical: boolean[]) {
    super(...physical);
    this.rampNormal = rampNormal;
    this.rim = rim;
  }
  direct(input: any, builder: any) {
    const light = input.reflectedLight;
    const before = vec3(light.directDiffuse).toVar();
    super.direct(input, builder);
    // three.js added irradiance (N·L times the light) x Lambert x (1 - F): swap its N·L for the ramp
    const nl = max(saturate(dot(normalView, input.lightDirection)), 1e-3);
    const k = storyRamp(dot(this.rampNormal, input.lightDirection)).div(nl);
    light.directDiffuse.assign(before.add(light.directDiffuse.sub(before).mul(k)));
  }
  start(builder: any) {
    super.start(builder);
    if (!this.rim) return;
    const n = this.rampNormal;
    const rimNV = float(1).sub(saturate(dot(n, positionViewDirection)));
    const key = normalize(cameraViewMatrix.mul(vec4(story.keyDir.add(vec3(0, 1e-4, 0)), 0)).xyz);
    const side = float(0.3).add(saturate(dot(n, key).mul(0.6).add(0.4)).mul(0.7));
    builder.context.reflectedLight.directSpecular.addAssign(story.rimColor.mul(smoothstep(0.5, 0.85, rimNV)).mul(side));
  }
}

function lighting(m: StoryMat, builder: any, physical: boolean[]) {
  return new StoryLightingModel(geometryNormal(m, builder), !!m.storyRim, ...physical);
}
function afterLight(m: StoryMat, light: any) {
  const fx = m.storyFx ? storyEffects[m.storyFx] : undefined;
  return fx ? fx(light, m) : light;
}

/** MeshStandardNodeMaterial with the storybook light (a plain one in ?style=real). */
export class StoryStandardMaterial extends THREE.MeshStandardNodeMaterial {
  /** 1: a character's material (rim light). Set by textures.ts rimLit. */
  storyRim = 0;
  /** An effect from storyEffects applied after lighting ('' for none). */
  storyFx = '';
  /** 1: cloth, lined inside with `uLining`. */
  storyLining = 0;
  setupLightingModel(builder?: any): any {
    return STORYBOOK ? lighting(this as StoryMat, builder, []) : (super.setupLightingModel as () => any)();
  }
  setupDiffuseColor(builder: any): void {
    (super.setupDiffuseColor as (b: any) => void)(builder);
    lining(this as StoryMat);
  }
  setupLighting(builder: any): any {
    return afterLight(this as StoryMat, (super.setupLighting as (b: any) => any)(builder));
  }
}
/** MeshPhysicalNodeMaterial with the storybook light: sheen, clearcoat, iridescence and metal keep working. */
export class StoryPhysicalMaterial extends THREE.MeshPhysicalNodeMaterial {
  storyRim = 0;
  storyFx = '';
  storyLining = 0;
  setupDiffuseColor(builder: any): void {
    (super.setupDiffuseColor as (b: any) => void)(builder);
    lining(this as unknown as StoryMat);
  }
  setupLightingModel(builder?: any): any {
    if (!STORYBOOK) return (super.setupLightingModel as () => any)();
    const s = this as unknown as { useClearcoat: boolean; useSheen: boolean; useIridescence: boolean; useAnisotropy: boolean; useTransmission: boolean; useDispersion: boolean; useRetroreflection?: boolean };
    return lighting(this as unknown as StoryMat, builder, [s.useClearcoat, s.useSheen, s.useIridescence, s.useAnisotropy, s.useTransmission, s.useDispersion, !!s.useRetroreflection]);
  }
  setupLighting(builder: any): any {
    return afterLight(this as unknown as StoryMat, (super.setupLighting as (b: any) => any)(builder));
  }
}

/**
 * Storybook fog: the scene's FogExp2 (render.ts sets its colour and density), tinted toward the sun's colour
 * looking toward the sun and toward the sky's colour looking up. Applies to every material with fog on.
 */
export function storyFog(scene: THREE.Scene) {
  const f = scene.fog as THREE.FogExp2;
  const color = reference('color', 'color', f);
  const density = reference('density', 'float', f);
  const dir = normalize(positionWorld.sub(cameraPosition));
  const tint = color.add(story.fogSunColor.mul(pow(max(dot(dir, story.fogSunDir), 0), 5))).add(story.fogSkyColor.mul(smoothstep(0, 0.35, dir.y)));
  (scene as THREE.Scene & { fogNode: unknown }).fogNode = fog(max(tint, vec3(0)), densityFogFactor(density));
}

/** Make every MeshStandard/Physical material in the game a storybook one (before the first frame). */
export function installStorybook(renderer: THREE.WebGPURenderer) {
  // (NodeLibrary.addMaterial refuses to redefine a type the renderer already maps: replace the entries)
  const lib = (renderer as unknown as { library: { materialNodes: Map<string, unknown> } }).library;
  lib.materialNodes.set('MeshStandardMaterial', StoryStandardMaterial);
  lib.materialNodes.set('MeshPhysicalMaterial', StoryPhysicalMaterial);
}

/**
 * The storybook ink line of a character part, as a vertex offset: the surface pushed out along its normal,
 * a little more with distance so the line stays one or two pixels wide. `p` and `n` are in the space the
 * mesh is drawn in (for an instanced mesh three.js has already applied the instance's matrix).
 */
export const inkPush = Fn(([p, n]: any[]) => {
  const d = max(0, modelViewMatrix.mul(vec4(p, 1)).z.negate());
  return p.add(normalize(n).mul(float(0.014).add(d.mul(0.0016))));
});

/** The ghost glamour needs to change the alpha after lighting: exported for models.ts. */
export const storyDiffuse = diffuseColor;
