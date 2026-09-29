import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';
import { farWizardGeometry } from './models';
import { StoryStandardMaterial, inkPush } from './storybook';
import { STORYBOOK, rimLit } from './textures';

const T = TSL as unknown as Record<string, any>;
const { vec4, select, attribute, vertexColor, positionLocal, normalLocal } = T;


/**
 * Every wizard beyond the level-of-detail distance, drawn as one instanced mesh (models.ts
 * farWizardGeometry) plus, in the storybook style at 'high', one instanced ink outline: two draw calls
 * (and one in the shadow map) for the whole far crowd, where each full model costs ~17 (and 5).
 * Fill it every frame between begin() and end().
 */
export function createCrowd(scene: THREE.Scene, max = 1024) {
  const geo = farWizardGeometry().clone();
  const robeAttr = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
  robeAttr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('iRobe', robeAttr);
  const trimAttr = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
  trimAttr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('iTrim', trimAttr);

  const mat = new StoryStandardMaterial({ roughness: 0.85 });
  // colour = own vertex colour, or the instance's robe colour (aTint 1), or its trim colour (aTint 2)
  const tint = attribute('aTint', 'float');
  mat.colorNode = vec4(select(tint.lessThan(0.5), vertexColor().rgb, select(tint.lessThan(1.5), attribute('iRobe', 'vec3'), attribute('iTrim', 'vec3'))), 1);
  rimLit(mat);
  const body = new THREE.InstancedMesh(geo, mat, max);
  body.name = 'crowd';
  body.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  body.castShadow = true;
  body.receiveShadow = true;
  body.frustumCulled = false; // (the instances span the map; the vertex work is small)
  body.count = 0;
  scene.add(body);

  // the storybook ink line, as on the full models (models.ts inkMaterial): back faces pushed out along the normals
  let ink: THREE.InstancedMesh | null = null;
  if (STORYBOOK) {
    const inkMat = new THREE.MeshBasicNodeMaterial({ color: 0x1c1018, side: THREE.BackSide });
    inkMat.positionNode = inkPush(positionLocal, normalLocal);
    ink = new THREE.InstancedMesh(geo, inkMat, max);
    ink.name = 'crowd-ink';
    ink.instanceMatrix = body.instanceMatrix; // the same instances
    ink.frustumCulled = false;
    ink.count = 0;
    scene.add(ink);
  }

  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
  const c = new THREE.Color();
  let n = 0;
  return {
    body,
    begin() { n = 0; },
    /** One far wizard at (x, y, z) facing `yaw` (the model's body.rotation.y), lifted by `bob`. */
    put(x: number, y: number, z: number, yaw: number, bob: number, robe: number, trim: number) {
      if (n >= max) return;
      m.compose(p.set(x, y + bob, z), q.setFromAxisAngle(up, yaw), one);
      body.setMatrixAt(n, m);
      c.set(trim);
      trimAttr.setXYZ(n, c.r, c.g, c.b);
      c.set(robe);
      robeAttr.setXYZ(n, c.r, c.g, c.b);
      n++;
    },
    end(showInk: boolean) {
      body.count = n;
      body.instanceMatrix.clearUpdateRanges();
      body.instanceMatrix.addUpdateRange(0, n * 16);
      body.instanceMatrix.needsUpdate = true;
      for (const a of [robeAttr, trimAttr]) { a.clearUpdateRanges(); a.addUpdateRange(0, n * 3); a.needsUpdate = true; }
      body.visible = n > 0;
      if (ink) { ink.count = n; ink.visible = n > 0 && showInk; }
    },
  };
}
export type Crowd = ReturnType<typeof createCrowd>;
