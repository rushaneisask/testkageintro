/**
 * Cleans the Sketchfab BMW M3 export for web delivery.
 *
 * Deliberately hand-rolled instead of the `gltf-transform optimize` CLI:
 *
 *  - optimize runs palette(), which merges materials into a shared swatch
 *    atlas and rewrites UVs to point at individual texels. Those UVs do not
 *    survive this model's compression (quantize logs "TEXCOORD out of [0,1]
 *    range" on dozens of primitives), so the body panels end up sampling
 *    across swatch boundaries — that is the mottled "camo" garbage that was
 *    showing up on the hood and roof.
 *  - optimize also runs simplify(), which detaches body panels on this
 *    export's skinned meshes (doors and the steering wheel float off the car).
 *
 * So: no palette, no simplify. We only drop geometry the intro never shows
 * (a mirrored duplicate body, LOD stand-ins, neon underglow, slipstream
 * planes, dummies) and recompress.
 *
 * Run once to produce public/models/bmw-m3.glb; not part of the app build, so
 * its dependencies are installed ad hoc rather than kept in package.json:
 *
 *   npm i --no-save @gltf-transform/core @gltf-transform/extensions \
 *                   @gltf-transform/functions meshoptimizer sharp
 *   node tools/clean-car.mjs <input.gltf> <output.glb>
 */
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import {
  dedup,
  prune,
  textureCompress,
  meshopt,
} from "@gltf-transform/functions";
import { MeshoptEncoder, MeshoptDecoder } from "meshoptimizer";
import sharp from "sharp";

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error("usage: node tools/clean-car.mjs <input.gltf> <output.glb>");
  process.exit(1);
}

// The mirrored duplicate body. Self-contained (its own skin + skeleton), so
// dropping the whole subtree is safe.
//
// Note: the other junk (neon_*, slipstream_*, chassis_lowlod, ...) is NOT
// removed here. Those names belong to skeleton joints, not standalone meshes —
// their geometry is skinned to the shared skeleton, and disposing the joints
// leaves the skinned meshes pointing at missing bones, which throws in
// three.js (applyBoneTransform on undefined). Not worth the risk for a few
// hidden meshes.
const DROP_SUBTREES = [/^pbbmwm3\.001_/];

await MeshoptEncoder.ready;
await MeshoptDecoder.ready;

const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({
    "meshopt.encoder": MeshoptEncoder,
    "meshopt.decoder": MeshoptDecoder,
  });
const doc = await io.read(input);
const root = doc.getRoot();

function countMeshNodes(node) {
  let n = 0;
  node.traverse((c) => { if (c.getMesh()) n++; });
  return n;
}

let droppedSubtrees = 0, droppedMeshNodes = 0;

for (const scene of root.listScenes()) {
  for (const node of scene.listChildren()) {
    node.traverse((child) => {
      const name = child.getName() || "";
      if (DROP_SUBTREES.some((re) => re.test(name))) {
        droppedSubtrees++;
        droppedMeshNodes += countMeshNodes(child);
        child.dispose();
      }
    });
  }
}


await doc.transform(
  dedup(),
  prune({ keepAttributes: false, keepLeaves: false }),
  textureCompress({ encoder: sharp, targetFormat: "webp", resize: [1024, 1024] }),
  // level:"medium" keeps UVs at full precision; the aggressive default is
  // what pushed this model's texture coords out of range.
  meshopt({ encoder: MeshoptEncoder, level: "medium" }),
);

await io.write(output, doc);
console.log("wrote", output);
