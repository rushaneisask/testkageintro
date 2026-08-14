import * as THREE from "three";
import { SVGLoader } from "three/examples/jsm/loaders/SVGLoader.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import emblemSvg from "../assets/kage-emblem.svg?raw";

// Builds a centered, unit-scaled 3D extrusion of the Kage blade emblem
// traced from the brand's raw hoodie-emblem artwork.
export function buildEmblemGeometry({ depth = 10 } = {}) {
  const { paths } = new SVGLoader().parse(emblemSvg);

  const geometries = [];
  for (const path of paths) {
    const shapes = SVGLoader.createShapes(path);
    for (const shape of shapes) {
      const geometry = new THREE.ExtrudeGeometry(shape, {
        depth,
        bevelEnabled: true,
        bevelThickness: 3.2,
        bevelSize: 2.2,
        bevelSegments: 3,
        curveSegments: 8,
      });
      geometries.push(geometry);
    }
  }

  const merged = mergeGeometries(geometries, false);
  merged.computeBoundingBox();
  merged.computeVertexNormals();

  const box = merged.boundingBox;
  const center = new THREE.Vector3();
  box.getCenter(center);
  merged.translate(-center.x, -center.y, -center.z);

  // SVG y-axis points down; flip so the mark reads right-side-up in 3D,
  // and normalize scale so the emblem is ~6 units wide regardless of source resolution.
  const size = new THREE.Vector3();
  box.getSize(size);
  const scale = 6 / Math.max(size.x, size.y);
  merged.scale(scale, -scale, scale);
  merged.rotateY(Math.PI); // face the mark toward +Z (camera)

  return merged;
}
