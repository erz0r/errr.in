// her scene, shared by the live model (model.js) and the loop baked for phones (dev/bake-model.js)
export const FOV = 24, DISTANCE = 3.1, HER_ASPECT = 150 / 160;
const HEAD_SHARE = 0.35;
const BLINK = [0.07, 0.05, 0.11];
const TWITCH = [0.06, 0.16];

export async function createScene(THREE, src, canvas, { light = 1.3, fill = 0.5 } = {}) {
  const gl = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
  gl.outputColorSpace = THREE.SRGBColorSpace;
  gl.setClearColor(0x000000, 0);
  gl.shadowMap.enabled = true;
  gl.shadowMap.type = THREE.PCFShadowMap;
  gl.shadowMap.autoUpdate = false;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 20);
  const placeCamera = () => {
    const pan = -Math.tan((FOV / 2) * Math.PI / 180) * DISTANCE * Math.max(0, camera.aspect - HER_ASPECT);
    camera.position.set(pan, 0.85, DISTANCE);
    camera.lookAt(pan, 0.42, 0);
  };
  placeCamera();
  const key = new THREE.DirectionalLight(0xffffff, light);
  key.position.set(1.2, 2.2, 2.4);
  const fillLight = new THREE.HemisphereLight(0xffffff, 0x404040, fill);
  scene.add(key, fillLight);
  const sun = new THREE.DirectionalLight(0xffffff, 0);
  sun.position.set(2.2, 2.3, 1.8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -1.6, right: 1.6, top: 1.6, bottom: -1.6, near: 0.5, far: 8 });
  scene.add(sun, sun.target);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), new THREE.ShadowMaterial({ opacity: 1 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  const gltf = await new THREE.GLTFLoader().setMeshoptDecoder(THREE.MeshoptDecoder).loadAsync(src);
  gltf.scene.rotation.y = -0.6;
  scene.add(gltf.scene);
  const mixer = new THREE.AnimationMixer(gltf.scene);
  const clip = gltf.animations.find((a) => a.name === 'SitIdle') ?? gltf.animations[0];
  if (clip) mixer.clipAction(clip).setLoop(THREE.LoopRepeat).play();
  const materials = new Set();
  let lowest = Infinity;
  mixer.update(0);
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = false;
    [o.material].flat().forEach((m) => materials.add(m));
    o.computeBoundingBox?.();
    const box = (o.boundingBox ?? o.geometry.boundingBox)?.clone().applyMatrix4(o.matrixWorld);
    if (box) lowest = Math.min(lowest, box.min.y);
  });
  floor.position.y = Number.isFinite(lowest) ? lowest : 0;
  const paint = (on) => materials.forEach((m) => { m.colorWrite = on; });

  const eyes = ['Left Eye', 'Right Eye'].map((name) => gltf.scene.getObjectByName(name)).filter(Boolean);
  const rest = eyes.map((eye) => eye.quaternion.clone());
  const head = gltf.scene.getObjectByName('Head');
  const up = new THREE.Vector3(0, 1, 0), side = new THREE.Vector3(1, 0, 0);
  const yaw = new THREE.Quaternion(), pitch = new THREE.Quaternion(), parent = new THREE.Quaternion();
  const turn = (bone, base, y, x) => {
    bone.parent.getWorldQuaternion(parent);
    yaw.setFromAxisAngle(up, y).multiply(pitch.setFromAxisAngle(side, x));
    bone.quaternion.copy(parent).invert().multiply(yaw).multiply(parent).multiply(base);
    bone.updateMatrixWorld(true);
  };

  const lids = [];
  gltf.scene.traverse((o) => {
    const i = o.morphTargetDictionary?.Blink;
    if (i !== undefined) lids.push([o, i]);
  });
  const blinkAmount = (t) => {
    const [close, hold, open] = BLINK;
    if (t < 0) return 0;
    if (t < close) return t / close;
    if (t < close + hold) return 1;
    if (t < close + hold + open) return 1 - (t - close - hold) / open;
    return 0;
  };
  const ears = ['Ear_1_L', 'Ear_1_R'].map((name) => gltf.scene.getObjectByName(name)).filter(Boolean);
  const twitch = new THREE.Quaternion(), earAxis = new THREE.Vector3(1, 0, 0);
  const twitchAmount = (t) => (t < 0 ? 0 : t < TWITCH[0] ? t / TWITCH[0] : t < TWITCH[0] + TWITCH[1] ? 1 - (t - TWITCH[0]) / TWITCH[1] : 0);

  return {
    camera,
    head,
    duration: clip?.duration ?? 0,
    setLight(k, f) { key.intensity = k; fillLight.intensity = f; },
    resize(w, h) {
      if (canvas.width === w && canvas.height === h) return;
      gl.setSize(w, h, false);
      camera.aspect = w / h;
      placeCamera();
      camera.updateProjectionMatrix();
    },
    // poses her at animation time `time`; blink and twitch say when the last ones started (seconds, same clock as t)
    pose({ time, t, look = { yaw: 0, pitch: 0 }, blink = { at: -1e9, twice: false }, twitch: tw = { at: -1e9, who: 0, twice: false } }) {
      mixer.setTime(time);
      const lid = Math.max(blinkAmount(t - blink.at), blink.twice ? blinkAmount(t - blink.at - 0.32) : 0);
      lids.forEach(([mesh, i]) => { mesh.morphTargetInfluences[i] = lid; });
      const flick = Math.max(twitchAmount(t - tw.at), tw.twice ? twitchAmount(t - tw.at - 0.28) : 0);
      ears.forEach((ear, i) => {
        if (tw.who === 2 || tw.who === i) ear.quaternion.multiply(twitch.setFromAxisAngle(earAxis, -0.35 * flick));
      });
      gltf.scene.updateMatrixWorld(true);
      if (head) turn(head, head.quaternion.clone(), 0.5 + look.yaw * HEAD_SHARE, look.pitch * HEAD_SHARE);
      eyes.forEach((eye, i) => turn(eye, rest[i], look.yaw * (1 - HEAD_SHARE), look.pitch * (1 - HEAD_SHARE)));
    },
    // draws the shadow alone, then her alone, calling back after each so the canvas can be copied
    draw(onLayer) {
      gl.shadowMap.needsUpdate = true;
      floor.visible = true;
      paint(false);
      gl.render(scene, camera);
      onLayer('shadow');
      floor.visible = false;
      paint(true);
      gl.render(scene, camera);
      onLayer('model');
    },
  };
}
