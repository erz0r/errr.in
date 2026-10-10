const spot = document.querySelector('.model[data-src]');
const win = spot?.closest('.win');

if (spot && win) {
  const root = document.documentElement;
  const css = (name, fallback) => parseFloat(getComputedStyle(root).getPropertyValue(name)) || fallback;
  const shown = () => !win.hidden && document.visibilityState === 'visible';
  let started = false;

  async function start() {
    started = true;
    const THREE = await import(spot.dataset.engine);
    const canvas = document.createElement('canvas');
    const gl = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
    gl.outputColorSpace = THREE.SRGBColorSpace;
    gl.setClearColor(0x000000, 0);
    gl.shadowMap.enabled = true;
    gl.shadowMap.type = THREE.PCFShadowMap;
    gl.shadowMap.autoUpdate = false;

    const scene = new THREE.Scene();
    const FOV = 24, DISTANCE = 3.1, HER_ASPECT = 150 / 160;
    const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 20);
    const placeCamera = () => {
      const pan = -Math.tan((FOV / 2) * Math.PI / 180) * DISTANCE * Math.max(0, camera.aspect - HER_ASPECT);
      camera.position.set(pan, 0.85, DISTANCE);
      camera.lookAt(pan, 0.42, 0);
    };
    placeCamera();
    const key = new THREE.DirectionalLight(0xffffff, 1);
    key.position.set(1.2, 2.2, 2.4);
    const fill = new THREE.HemisphereLight(0xffffff, 0x404040, 1);
    scene.add(key, fill);
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

    const lids = [];
    gltf.scene.traverse((o) => {
      const i = o.morphTargetDictionary?.Blink;
      if (i !== undefined) lids.push([o, i]);
    });
    const between = (lo, hi) => lo + Math.random() * (hi - lo);
    let blinkAt = performance.now() / 1000 + between(1.5, 4), blinks = 1;
    const BLINK = [0.07, 0.05, 0.11];
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
    let twitchAt = performance.now() / 1000 + between(2, 5), twitchWho = 0, twitchTwice = false;
    const TWITCH = [0.06, 0.16];
    const twitchAmount = (t) => (t < 0 ? 0 : t < TWITCH[0] ? t / TWITCH[0] : t < TWITCH[0] + TWITCH[1] ? 1 - (t - TWITCH[0]) / TWITCH[1] : 0);

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
        placeCamera();
        camera.updateProjectionMatrix();
      }
      mixer.update(dt);
      look.yaw += (aim.yaw - look.yaw) * Math.min(1, dt * 8);
      look.pitch += (aim.pitch - look.pitch) * Math.min(1, dt * 8);
      const t = now / 1000;
      const lid = Math.max(blinkAmount(t - blinkAt), blinks > 1 ? blinkAmount(t - blinkAt - 0.32) : 0);
      lids.forEach(([mesh, i]) => { mesh.morphTargetInfluences[i] = lid; });
      if (t > blinkAt + 0.8) {
        blinkAt = t + between(2.5, 6);
        blinks = Math.random() < 0.15 ? 2 : 1;
      }
      const flick = Math.max(twitchAmount(t - twitchAt), twitchTwice ? twitchAmount(t - twitchAt - 0.28) : 0);
      ears.forEach((ear, i) => {
        if (twitchWho === 2 || twitchWho === i) ear.quaternion.multiply(twitch.setFromAxisAngle(earAxis, -0.35 * flick));
      });
      if (t > twitchAt + 0.8) {
        twitchAt = t + between(3, 9);
        twitchWho = Math.random() < 0.25 ? 2 : Math.floor(Math.random() * 2);
        twitchTwice = Math.random() < 0.3;
      }
      gltf.scene.updateMatrixWorld(true);
      if (head) turn(head, head.quaternion.clone(), 0.5 + look.yaw * HEAD_SHARE, look.pitch * HEAD_SHARE);
      eyes.forEach((eye, i) => turn(eye, rest[i], look.yaw * (1 - HEAD_SHARE), look.pitch * (1 - HEAD_SHARE)));
      gl.shadowMap.needsUpdate = true;
      floor.visible = true;
      paint(false);
      gl.render(scene, camera);
      dispatchEvent(new CustomEvent('model:frame', { detail: { canvas, spot, layer: 'shadow' } }));
      floor.visible = false;
      paint(true);
      gl.render(scene, camera);
      dispatchEvent(new CustomEvent('model:frame', { detail: { canvas, spot, layer: 'model' } }));
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  const check = () => { if (!started && !win.hidden) start(); };
  new MutationObserver(check).observe(win, { attributes: true, attributeFilter: ['hidden'] });
  check();
}
