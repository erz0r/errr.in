const spot = document.querySelector('.model[data-src]');
const win = spot?.closest('.win');

if (spot && win) {
  const root = document.documentElement;
  const css = (name, fallback) => parseFloat(getComputedStyle(root).getPropertyValue(name)) || fallback;
  const shown = () => !win.hidden && document.visibilityState === 'visible';
  let started = false;

  async function start() {
    started = true;
    const THREE = await import('./vendor/three.js');
    const canvas = document.createElement('canvas');
    const gl = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
    gl.outputColorSpace = THREE.SRGBColorSpace;
    gl.setClearColor(0x000000, 0);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(24, 1, 0.1, 20);
    camera.position.set(0, 0.5, 3.1);
    camera.lookAt(0, 0.44, 0);
    const key = new THREE.DirectionalLight(0xffffff, 1);
    key.position.set(1.2, 2.2, 2.4);
    const fill = new THREE.HemisphereLight(0xffffff, 0x404040, 1);
    scene.add(key, fill);
    const light = () => {
      key.intensity = css('--model-light', 1.3);
      fill.intensity = css('--model-fill', 0.5);
    };
    light();
    addEventListener('tune:apply', light);

    const gltf = await new THREE.GLTFLoader().loadAsync(spot.dataset.src);
    gltf.scene.rotation.y = -0.6;
    scene.add(gltf.scene);
    const mixer = new THREE.AnimationMixer(gltf.scene);
    const clip = gltf.animations.find((a) => a.name === 'SitIdle') ?? gltf.animations[0];
    if (clip) mixer.clipAction(clip).setLoop(THREE.LoopRepeat).play();

    const eyes = ['Left Eye', 'Right Eye'].map((name) => gltf.scene.getObjectByName(name)).filter(Boolean);
    const rest = eyes.map((eye) => eye.quaternion.clone());
    const head = gltf.scene.getObjectByName('Head');
    const look = { yaw: 0, pitch: 0 }, aim = { yaw: 0, pitch: 0 };
    addEventListener('pointermove', (e) => {
      if (!head) return;
      const p = head.getWorldPosition(new THREE.Vector3()).project(camera);
      const r = spot.getBoundingClientRect();
      const x = r.left + (p.x + 1) / 2 * r.width, y = r.top + (1 - p.y) / 2 * r.height;
      const clamp = (v, m) => Math.max(-m, Math.min(m, v));
      aim.yaw = clamp(Math.atan2(e.clientX - x, 500), 0.6);
      aim.pitch = clamp(Math.atan2(e.clientY - y, 500), 0.4);
    });

    const up = new THREE.Vector3(0, 1, 0), side = new THREE.Vector3(1, 0, 0);
    const yaw = new THREE.Quaternion(), pitch = new THREE.Quaternion(), parent = new THREE.Quaternion();
    const turn = (bone, base, y, x) => {
      bone.parent.getWorldQuaternion(parent);
      yaw.setFromAxisAngle(up, y).multiply(pitch.setFromAxisAngle(side, x));
      bone.quaternion.copy(parent).invert().multiply(yaw).multiply(parent).multiply(base);
      bone.updateMatrixWorld(true);
    };
    const HEAD_SHARE = 0.35;

    let last = performance.now();
    const frame = (now) => {
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      if (!shown()) return void setTimeout(() => requestAnimationFrame(frame), 250);
      const r = spot.getBoundingClientRect();
      const scale = Math.min(devicePixelRatio, 2);
      const w = Math.max(1, Math.round(r.width * scale)), h = Math.max(1, Math.round(r.height * scale));
      if (canvas.width !== w || canvas.height !== h) {
        gl.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      }
      mixer.update(dt);
      look.yaw += (aim.yaw - look.yaw) * Math.min(1, dt * 8);
      look.pitch += (aim.pitch - look.pitch) * Math.min(1, dt * 8);
      gltf.scene.updateMatrixWorld(true);
      if (head) turn(head, head.quaternion.clone(), 0.5 + look.yaw * HEAD_SHARE, look.pitch * HEAD_SHARE);
      eyes.forEach((eye, i) => turn(eye, rest[i], look.yaw * (1 - HEAD_SHARE), look.pitch * (1 - HEAD_SHARE)));
      gl.render(scene, camera);
      dispatchEvent(new CustomEvent('model:frame', { detail: { canvas, spot } }));
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  const check = () => { if (!started && !win.hidden) start(); };
  new MutationObserver(check).observe(win, { attributes: true, attributeFilter: ['hidden'] });
  check();
}
