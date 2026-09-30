import * as THREE from 'three';
import { farWizardGeometry } from './models';
import { STORYBOOK, rimLit } from './textures';

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

  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
  // colour = own vertex colour, or the instance's robe colour (aTint 1), or its trim colour (aTint 2)
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = 'attribute float aTint;\nattribute vec3 iRobe;\n' + sh.vertexShader.replace('#include <color_vertex>', `#include <color_vertex>
      #ifdef USE_INSTANCING_COLOR
        vColor.rgb = aTint < 0.5 ? color.rgb : aTint < 1.5 ? iRobe : instanceColor.rgb;
      #endif`);
  };
  mat.customProgramCacheKey = () => 'crowd';
  rimLit(mat);
  const body = new THREE.InstancedMesh(geo, mat, max);
  body.name = 'crowd';
  body.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  body.setColorAt(0, new THREE.Color(1, 1, 1));
  body.instanceColor!.setUsage(THREE.DynamicDrawUsage);
  body.castShadow = true;
  body.receiveShadow = true;
  body.frustumCulled = false; // (the instances span the map; the vertex work is small)
  body.count = 0;
  scene.add(body);

  // the storybook ink line, as on the full models (models.ts inkMaterial): back faces pushed out along the normals
  let ink: THREE.InstancedMesh | null = null;
  if (STORYBOOK) {
    const inkMat = new THREE.MeshBasicMaterial({ color: 0x1c1018, side: THREE.BackSide });
    inkMat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        float inkD = max(0.0, -(modelViewMatrix * instanceMatrix * vec4(transformed, 1.0)).z);
        transformed += normalize(normal) * (0.014 + inkD * 0.0016);`);
    };
    inkMat.customProgramCacheKey = () => 'crowd-ink';
    ink = new THREE.InstancedMesh(geo, inkMat, max);
    ink.name = 'crowd-ink';
    ink.instanceMatrix = body.instanceMatrix; // the same instances
    ink.frustumCulled = false;
    ink.count = 0;
    scene.add(ink);
  }

  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
  let n = 0;
  return {
    body,
    begin() { n = 0; },
    /** One far wizard at (x, y, z) facing `yaw` (the model's body.rotation.y), lifted by `bob`, in these colours. */
    put(x: number, y: number, z: number, yaw: number, bob: number, robe: THREE.Color, trim: THREE.Color) {
      if (n >= max) return;
      m.compose(p.set(x, y + bob, z), q.setFromAxisAngle(up, yaw), one);
      body.setMatrixAt(n, m);
      body.setColorAt(n, trim);
      robeAttr.setXYZ(n, robe.r, robe.g, robe.b);
      n++;
    },
    end(showInk: boolean) {
      body.count = n;
      body.instanceMatrix.clearUpdateRanges();
      body.instanceMatrix.addUpdateRange(0, n * 16);
      body.instanceMatrix.needsUpdate = true;
      body.instanceColor!.clearUpdateRanges();
      body.instanceColor!.addUpdateRange(0, n * 3);
      body.instanceColor!.needsUpdate = true;
      robeAttr.clearUpdateRanges();
      robeAttr.addUpdateRange(0, n * 3);
      robeAttr.needsUpdate = true;
      body.visible = n > 0;
      if (ink) { ink.count = n; ink.visible = n > 0 && showInk; }
    },
  };
}
