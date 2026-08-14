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

export function loadCarModel({ onProgress } = {}) {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);

  return new Promise((resolve, reject) => {
    loader.load(
      "/models/bmw-m3.glb",
      (gltf) => {
        const car = gltf.scene;

        car.traverse((o) => {
          if (o.isMesh) {
            o.castShadow = true;
            o.receiveShadow = true;
            if (o.material) {
              o.material.envMapIntensity = 1.1;
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

        resolve({ group, noseZ: NOSE_WORLD_Z, tailZ: group.position.z - 2.344 * SCALE });
      },
      (evt) => {
        if (evt.lengthComputable) onProgress?.(evt.loaded / evt.total);
      },
      (err) => reject(err)
    );
  });
}
