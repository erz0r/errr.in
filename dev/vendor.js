import { build } from 'esbuild';

await build({
  stdin: {
    contents: `export { AnimationMixer, Box3, DirectionalLight, HemisphereLight, LoopRepeat, Mesh, PCFShadowMap, PerspectiveCamera, PlaneGeometry, Quaternion, Scene, ShadowMaterial, SRGBColorSpace, Vector3, WebGLRenderer } from 'three';
export { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
export { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';`,
    resolveDir: '.',
    loader: 'js',
  },
  bundle: true,
  format: 'esm',
  minify: true,
  legalComments: 'eof',
  outfile: 'site/js/vendor/three.js',
});
console.log('wrote site/js/vendor/three.js');
