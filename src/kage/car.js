import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";

// Measured from the source model (see scene bounding box / named-node probe):
// car length ~4.4m along Z, front (grille/headlights/engine) at local -Z,
// rear (exhaust/boot) at local +Z, resting height at local y ~ -0.273.
const SCALE = 5.5;
const NOSE_WORLD_Z = -15;
const FRONT_LOCAL_Z = -2.055;
const GROUND_LOCAL_Y = -0.273;
const FLOOR_WORLD_Y = -5.4;

/**
 * Where the reveal camera should point: on the centreline, at roughly grille
 * height, a little way back from the nose.
 *
 * Derived from the placement constants rather than measured from the loaded
 * scene. Box3.setFromObject is not trustworthy on this model — its skinned
 * meshes carry bounding volumes that do not match where they actually draw
 * (the same reason frustum culling has to be disabled on them), and measuring
 * returned an aim point behind the camera.
 */
export const CAR_AIM = Object.freeze({
  x: 0,
  y: FLOOR_WORLD_Y + 3.4,
  z: NOSE_WORLD_Z - 5,
});

// The single material covering the car's outer shell. Its texture atlas is a
// "prototype camo wrap" livery: the fenders sample a red region while the
// hood and roof sample a mottled grey-white one, which is why those panels
// looked like corrupted noise. We drop the atlas and paint the shell instead.
const BODY_MATERIAL_NAME = "3erg20_stitch_WHEEL.001";
const PAINT_COLOR = 0xa60d20;

/**
 * A soft dark ellipse laid on the floor under the car. Stands in for a real
 * cast shadow at one draw call and no shadow-map pass — the radial falloff is
 * generated once into a small canvas texture.
 */
function buildContactShadow() {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(0,0,0,0.72)");
  g.addColorStop(0.55, "rgba(0,0,0,0.34)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;

  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
    })
  );
  mesh.rotation.x = -Math.PI / 2;
  return mesh;
}

function makePaint() {
  return new THREE.MeshPhysicalMaterial({
    color: PAINT_COLOR,
    metalness: 0.55,
    roughness: 0.32,
    clearcoat: 1,
    clearcoatRoughness: 0.06,
    envMapIntensity: 0.65,
  });
}

function placeCar(gltf) {
  const car = gltf.scene;

  // One shared paint instance for every shell mesh — one material, one shader
  // program, instead of a clone per mesh.
  const paint = makePaint();

  car.traverse((o) => {
    if (o.isMesh || o.isSkinnedMesh) {
      // No real shadows on the car at all. A shadow-casting light re-renders
      // every caster into the shadow map, so this model alone was costing a
      // second full ~230-draw pass every frame — the single largest slice of
      // a ~700 draw-call frame. In a near-black scene the only shadow cue
      // that actually reads is the contact patch under the car, which
      // buildContactShadow() fakes for one extra draw.
      o.castShadow = false;
      o.receiveShadow = false;

      // These are skinned meshes whose bounding volumes do not match where
      // they actually draw, so three.js culls them as the camera closes in —
      // the whole car would vanish mid-reveal (measured: 231 meshes down to
      // 3 draw calls with the camera pointed straight at it). The car is only
      // on screen for one short shot and is hidden the rest of the time, so
      // skipping culling for it is cheaper than the geometry popping out.
      o.frustumCulled = false;

      if (!o.material) return;

      const swap = (m) => (m?.name === BODY_MATERIAL_NAME ? paint : m);
      o.material = Array.isArray(o.material) ? o.material.map(swap) : swap(o.material);

      // Kept modest — a stronger env map was blowing highlights out to
      // near-white, reading as the color shifting rather than as lit paint.
      [].concat(o.material).forEach((m) => {
        if (m && m !== paint) m.envMapIntensity = 0.65;
      });
    }
  });

  const group = new THREE.Group();
  group.add(car);

  // Sits just above the floor plane, in the group's local space (the group is
  // scaled by SCALE, so these are model units).
  const shadow = buildContactShadow();
  shadow.scale.set(2.6, 6.0, 1);
  shadow.position.set(0, GROUND_LOCAL_Y + 0.01, 0.15);
  group.add(shadow);

  // Front faces local -Z; rotate so the front meets the camera coming
  // from +Z, then scale/position so the nose lands at NOSE_WORLD_Z and
  // the wheels rest on the scene floor.
  car.rotation.y = Math.PI;
  group.scale.setScalar(SCALE);
  group.position.z = NOSE_WORLD_Z + FRONT_LOCAL_Z * SCALE;
  group.position.y = FLOOR_WORLD_Y - GROUND_LOCAL_Y * SCALE;

  return { group, noseZ: NOSE_WORLD_Z, tailZ: group.position.z - 2.344 * SCALE };
}

export function loadCarModel({ onProgress } = {}) {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);

  return new Promise((resolve, reject) => {
    // A self-contained build (e.g. a published artifact with no server to
    // fetch from) can stash the .glb as base64 on window before this runs.
    const embedded = typeof window !== "undefined" ? window.__KAGE_CAR_GLB_B64 : null;
    if (embedded) {
      const binary = atob(embedded);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      onProgress?.(1);
      loader.parse(bytes.buffer, "", (gltf) => resolve(placeCar(gltf)), (err) => reject(err));
      return;
    }

    loader.load(
      "/models/bmw-m3.glb",
      (gltf) => resolve(placeCar(gltf)),
      (evt) => {
        if (evt.lengthComputable) onProgress?.(evt.loaded / evt.total);
      },
      (err) => reject(err)
    );
  });
}
