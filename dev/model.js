import { writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, prune } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const src = process.argv[2];
if (!src?.endsWith('.glb')) {
  console.error('usage: npm run model -- path/to/export.glb');
  process.exit(1);
}
const out = `site/media/${basename(src)}`;

await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(src);
// the materials have no textures, so texture coordinates do nothing, and three.js never reads COLOR_1
for (const mesh of doc.getRoot().listMeshes()) {
  for (const prim of mesh.listPrimitives()) for (const name of ['TEXCOORD_0', 'TEXCOORD_1', 'COLOR_1']) prim.setAttribute(name, null);
}
await doc.transform(prune(), dedup(), meshopt({ encoder: MeshoptEncoder, level: 'medium', quantizationVolume: 'scene' }));
const bytes = await io.writeBinary(doc);
await writeFile(out, bytes);
console.log(`wrote ${out} (${Math.round(bytes.length / 1024)} KB)`);
