import { build } from 'esbuild';

await build({
  stdin: {
    contents: `export { AnimationMixer, Box3, DirectionalLight, HemisphereLight, LoopRepeat, PerspectiveCamera, Quaternion, Scene, SRGBColorSpace, Vector3, WebGLRenderer } from 'three';
export { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';`,
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
