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

function placeCar(gltf) {
  const car = gltf.scene;

  car.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
      if (o.material) {
        // Kept modest — a stronger env map was blowing the paint's specular
        // highlights out to near-white, reading as the color shifting rather
        // than as a lit, glossy red.
        o.material.envMapIntensity = 0.65;
      }
    }
  });

  const group = new THREE.Group();
  group.add(car);
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
