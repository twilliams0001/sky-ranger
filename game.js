/**
 * Sky Ranger — cinematic browser flight combat
 * Free online · no download
 */
(function () {
  "use strict";

  const BEST_KEY = "skyranger.bestScore";
  const $ = (id) => document.getElementById(id);

  const canvas = $("game-canvas");
  const startOverlay = $("start-overlay");
  const deadOverlay = $("dead-overlay");
  const waveOverlay = $("wave-overlay");
  const startBtn = $("start-btn");
  const againBtn = $("again-btn");
  const waveBtn = $("wave-btn");
  const scoreEl = $("hud-score");
  const bestEl = $("hud-best");
  const waveEl = $("hud-wave");
  const speedEl = $("hud-speed");
  const altEl = $("hud-alt");
  const msgEl = $("hud-msg");
  const hpFill = $("hp-fill");
  const abFill = $("ab-fill");
  const stickEl = $("stick");
  const fireBtn = $("fire-btn");
  const missileBtn = $("missile-btn");
  const radar = $("radar");
  const radarCtx = radar ? radar.getContext("2d") : null;

  if (!canvas || typeof THREE === "undefined") {
    console.error("Three.js or canvas missing");
    return;
  }

  // ——— Audio (procedural) ———
  const AudioFX = {
    ctx: null,
    master: null,
    engine: null,
    engGain: null,
    ensure() {
      if (this.ctx) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.22;
      this.master.connect(this.ctx.destination);
    },
    resume() {
      this.ensure();
      if (this.ctx && this.ctx.state !== "running") this.ctx.resume();
    },
    beep(freq, dur, type, vol) {
      this.ensure();
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = type || "square";
      o.frequency.value = freq;
      g.gain.setValueAtTime(vol || 0.08, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g); g.connect(this.master);
      o.start(t); o.stop(t + dur);
    },
    gun() { this.beep(880 + Math.random() * 200, 0.05, "square", 0.05); },
    missile() { this.beep(180, 0.18, "sawtooth", 0.07); this.beep(420, 0.12, "triangle", 0.04); },
    hit() { this.beep(120, 0.1, "sawtooth", 0.09); },
    boom() {
      this.ensure();
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = "sawtooth";
      o.frequency.setValueAtTime(90, t);
      o.frequency.exponentialRampToValueAtTime(30, t + 0.4);
      g.gain.setValueAtTime(0.14, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
      o.connect(g); g.connect(this.master);
      o.start(t); o.stop(t + 0.45);
    },
    startEngine() {
      this.ensure();
      if (!this.ctx || this.engine) return;
      const t = this.ctx.currentTime;
      this.engine = this.ctx.createOscillator();
      this.engGain = this.ctx.createGain();
      this.engine.type = "sawtooth";
      this.engine.frequency.value = 55;
      this.engGain.gain.value = 0.02;
      this.engine.connect(this.engGain);
      this.engGain.connect(this.master);
      this.engine.start(t);
    },
    setEngine(speed, ab) {
      if (!this.engine || !this.engGain) return;
      this.engine.frequency.value = 45 + speed * 0.7 + (ab ? 30 : 0);
      this.engGain.gain.value = 0.015 + Math.min(0.05, speed / 2000) + (ab ? 0.02 : 0);
    },
    stopEngine() {
      if (this.engine) {
        try { this.engine.stop(); } catch (e) {}
        this.engine = null;
        this.engGain = null;
      }
    }
  };

  // ——— Renderer / world ———
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.setSize(innerWidth, innerHeight, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x6ea3c8);
  scene.fog = new THREE.FogExp2(0x6ea3c8, 0.00135);

  const camera = new THREE.PerspectiveCamera(68, innerWidth / innerHeight, 0.25, 2800);
  const camShake = new THREE.Vector3();

  const sun = new THREE.DirectionalLight(0xfff1d6, 2.4);
  sun.position.set(120, 160, 60);
  scene.add(sun);
  scene.add(new THREE.AmbientLight(0x9ec4de, 0.45));
  scene.add(new THREE.HemisphereLight(0xc7e2f5, 0x163040, 0.7));

  function box(w, h, d, mat, x, y, z) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    return m;
  }

  // Animated ocean
  const oceanGeo = new THREE.PlaneGeometry(5000, 5000, 96, 96);
  const oceanMat = new THREE.MeshStandardMaterial({
    color: 0x0a3b55,
    roughness: 0.22,
    metalness: 0.25,
    flatShading: true
  });
  const ocean = new THREE.Mesh(oceanGeo, oceanMat);
  ocean.rotation.x = -Math.PI / 2;
  scene.add(ocean);
  const oceanBase = oceanGeo.attributes.position.array.slice();

  // Carrier
  const carrier = new THREE.Group();
  const hullMat = new THREE.MeshStandardMaterial({ color: 0x505860, metalness: 0.45, roughness: 0.5 });
  const deckMat = new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.88, metalness: 0.08 });
  const markMat = new THREE.MeshStandardMaterial({ color: 0xe8d27a, roughness: 0.7, metalness: 0.05 });
  const islandMat = new THREE.MeshStandardMaterial({ color: 0x6b7279, metalness: 0.35, roughness: 0.48 });
  carrier.add(box(180, 16, 36, hullMat, 0, 4, 0));
  carrier.add(box(190, 2.4, 46, deckMat, 6, 12.4, 0));
  carrier.add(box(70, 0.2, 1.2, markMat, 40, 13.7, 0));
  carrier.add(box(70, 0.2, 1.2, markMat, -20, 13.7, 8));
  carrier.add(box(32, 26, 16, islandMat, 12, 26, 18));
  carrier.add(box(10, 8, 10, islandMat, 18, 42, 18));
  scene.add(carrier);

  // Coast + harbor
  const landMat = new THREE.MeshStandardMaterial({ color: 0x3a5a32, roughness: 0.95 });
  const sandMat = new THREE.MeshStandardMaterial({ color: 0xc2b07a, roughness: 0.92 });
  const quayMat = new THREE.MeshStandardMaterial({ color: 0x6e7270, roughness: 0.75, metalness: 0.15 });
  scene.add(box(520, 20, 320, landMat, 40, 5, -560));
  scene.add(box(260, 4, 70, sandMat, 20, 1.5, -380));
  scene.add(box(180, 8, 22, quayMat, 10, 3, -340));
  scene.add(box(16, 8, 120, quayMat, -90, 3, -300));
  scene.add(box(16, 8, 100, quayMat, 110, 3, -290));

  // Cloud puffs
  const cloudMat = new THREE.MeshStandardMaterial({ color: 0xf2f6fa, roughness: 1, transparent: true, opacity: 0.55 });
  for (let i = 0; i < 18; i++) {
    const c = box(40 + Math.random() * 50, 10, 28 + Math.random() * 30, cloudMat,
      (Math.random() - 0.5) * 1200, 90 + Math.random() * 80, (Math.random() - 0.5) * 1200);
    scene.add(c);
  }

  // Player jet + afterburner
  const jet = new THREE.Group();
  const jetMat = new THREE.MeshStandardMaterial({ color: 0x9aa3ab, metalness: 0.6, roughness: 0.32 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x1d2228, metalness: 0.45, roughness: 0.4 });
  jet.add(box(7.2, 1.25, 1.6, jetMat, 0, 0, 0));
  jet.add(box(1.8, 0.28, 9.2, jetMat, -0.15, 0.18, 0));
  jet.add(box(1.3, 0.22, 3.1, jetMat, -3.0, 0.22, 0));
  jet.add(box(0.8, 1.7, 0.4, darkMat, -1.2, 1.05, 0));
  const canopy = box(1.4, 0.7, 1.1, new THREE.MeshStandardMaterial({ color: 0x4f7f98, metalness: 0.8, roughness: 0.15 }), 1.6, 0.7, 0);
  jet.add(canopy);
  const flame = box(2.2, 0.7, 0.7, new THREE.MeshBasicMaterial({ color: 0xff7a2a }), -4.2, 0, 0);
  flame.visible = false;
  jet.add(flame);
  jet.position.set(-40, 14.5, -3);
  scene.add(jet);

  const trailGeo = new THREE.BufferGeometry();
  const trailMax = 80;
  const trailPos = new Float32Array(trailMax * 3);
  trailGeo.setAttribute("position", new THREE.BufferAttribute(trailPos, 3));
  const trail = new THREE.Line(
    trailGeo,
    new THREE.LineBasicMaterial({ color: 0xffc27a, transparent: true, opacity: 0.55 })
  );
  scene.add(trail);
  let trailCount = 0;

  const explosions = [];
  const bullets = [];
  const missiles = [];
  const foeShots = [];
  const foes = [];

  const WAVES = [
    { name: "FIRST CONTACT", blurb: "Clear the patrol. Stay above the waves.", count: 5, hp: 2, speed: 26, shoot: 0.35 },
    { name: "WOLFPACK", blurb: "They hunt in packs now.", count: 8, hp: 3, speed: 32, shoot: 0.55 },
    { name: "IRON SKY", blurb: "Heavy fighters inbound.", count: 10, hp: 4, speed: 36, shoot: 0.7 },
    { name: "STORM FRONT", blurb: "Survive the swarm.", count: 14, hp: 3, speed: 40, shoot: 0.85 },
    { name: "ACE LEAD", blurb: "Final wave. No second chances.", count: 16, hp: 5, speed: 44, shoot: 1.0 }
  ];

  const state = {
    playing: false,
    dead: false,
    pausedWave: false,
    yaw: 0,
    pitch: 0.05,
    roll: 0,
    speed: 38,
    throttle: 0.55,
    ab: 0,
    hp: 100,
    score: 0,
    best: Number(localStorage.getItem(BEST_KEY) || 0),
    combo: 0,
    comboTimer: 0,
    wave: 0,
    fireCool: 0,
    mslCool: 0,
    mslAmmo: 6,
    stickX: 0,
    stickY: 0,
    keys: Object.create(null),
    time: 0,
    msgTimer: 0
  };

  function setMsg(text, hold) {
    msgEl.textContent = text;
    state.msgTimer = hold || 2.2;
  }

  function updateHud() {
    scoreEl.textContent = "SCORE " + state.score;
    bestEl.textContent = "BEST " + state.best;
    waveEl.textContent = "WAVE " + (state.wave + 1);
    speedEl.textContent = Math.round(state.speed) + " kn";
    altEl.textContent = Math.max(0, Math.round(jet.position.y * 3.2)) + " ft";
    hpFill.style.transform = "scaleX(" + Math.max(0, state.hp / 100) + ")";
    abFill.style.transform = "scaleX(" + Math.max(0, Math.min(1, state.ab)) + ")";
    abFill.style.background = state.ab > 0.15
      ? "linear-gradient(90deg, #e37d2e, #ffd27a)"
      : "linear-gradient(90deg, #4a6d82, #8eb0c4)";
  }

  function explode(pos, scale) {
    AudioFX.boom();
    camShake.set((Math.random() - 0.5) * 1.2, (Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 1.2);
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(1.2 * (scale || 1), 10, 10),
      new THREE.MeshBasicMaterial({ color: 0xff9a3c, transparent: true, opacity: 0.95 })
    );
    mesh.position.copy(pos);
    scene.add(mesh);
    explosions.push({ mesh, life: 0.45, scale: scale || 1 });
  }

  function clearGroup(list) {
    list.forEach((o) => scene.remove(o.mesh || o));
    list.length = 0;
  }

  function spawnWave() {
    clearGroup(foes);
    clearGroup(bullets);
    clearGroup(missiles);
    clearGroup(foeShots);
    const w = WAVES[Math.min(state.wave, WAVES.length - 1)];
    for (let i = 0; i < w.count; i++) {
      const mesh = new THREE.Group();
      const col = new THREE.MeshStandardMaterial({ color: 0x7a2f2f, metalness: 0.4, roughness: 0.42 });
      mesh.add(box(5.4, 1.05, 1.35, col, 0, 0, 0));
      mesh.add(box(1.5, 0.22, 7.0, col, -0.2, 0.12, 0));
      const ang = (i / w.count) * Math.PI * 2;
      const r = 160 + (i % 4) * 55;
      mesh.position.set(Math.cos(ang) * r + carrier.position.x, 35 + (i % 5) * 14, Math.sin(ang) * r);
      scene.add(mesh);
      foes.push({
        mesh,
        hp: w.hp,
        maxHp: w.hp,
        yaw: ang + Math.PI,
        speed: w.speed + (i % 3) * 3,
        shoot: w.shoot,
        cool: 1 + Math.random()
      });
    }
  }

  function resetPlayer() {
    jet.position.set(carrier.position.x - 45, 14.5, -3);
    state.yaw = 0;
    state.pitch = 0.06;
    state.roll = 0;
    state.speed = 40;
    state.throttle = 0.6;
    state.ab = 1;
    state.hp = 100;
    state.dead = false;
    state.fireCool = 0;
    state.mslCool = 0;
    state.mslAmmo = 6;
    state.combo = 0;
    trailCount = 0;
    updateHud();
  }

  function beginWaveScreen() {
    state.pausedWave = true;
    state.playing = false;
    const w = WAVES[Math.min(state.wave, WAVES.length - 1)];
    $("wave-title").textContent = "WAVE " + (state.wave + 1);
    $("wave-name").textContent = w.name;
    $("wave-blurb").textContent = w.blurb;
    waveOverlay.classList.remove("hidden");
  }

  function engageWave() {
    waveOverlay.classList.add("hidden");
    state.pausedWave = false;
    state.playing = true;
    spawnWave();
    setMsg(WAVES[Math.min(state.wave, WAVES.length - 1)].name, 2.5);
    updateHud();
  }

  function startGame() {
    AudioFX.resume();
    AudioFX.startEngine();
    state.score = 0;
    state.wave = 0;
    state.combo = 0;
    startOverlay.classList.add("hidden");
    deadOverlay.classList.add("hidden");
    resetPlayer();
    beginWaveScreen();
  }

  function killPlayer(reason) {
    if (state.dead) return;
    state.dead = true;
    state.playing = false;
    AudioFX.stopEngine();
    AudioFX.boom();
    explode(jet.position.clone(), 2.2);
    if (state.score > state.best) {
      state.best = state.score;
      localStorage.setItem(BEST_KEY, String(state.best));
    }
    $("dead-reason").textContent = reason;
    $("dead-score").textContent = String(state.score);
    $("dead-best").textContent = String(state.best);
    deadOverlay.classList.remove("hidden");
    updateHud();
  }

  function damagePlayer(amount, reason) {
    state.hp -= amount;
    AudioFX.hit();
    camShake.set((Math.random() - 0.5) * 2, Math.random() * 1.2, (Math.random() - 0.5) * 2);
    updateHud();
    if (state.hp <= 0) killPlayer(reason || "Airframe destroyed.");
  }

  function addScore(base) {
    state.combo += 1;
    state.comboTimer = 2.5;
    const gained = Math.round(base * (1 + Math.min(2, state.combo * 0.15)));
    state.score += gained;
    if (state.combo > 1) setMsg("COMBO x" + state.combo + "  +" + gained, 1.2);
    updateHud();
  }

  function forwardVec() {
    return new THREE.Vector3(
      Math.cos(state.pitch) * Math.cos(state.yaw),
      Math.sin(state.pitch),
      Math.cos(state.pitch) * Math.sin(state.yaw)
    );
  }

  function fireGuns() {
    if (!state.playing || state.dead || state.fireCool > 0) return;
    state.fireCool = 0.07;
    AudioFX.gun();
    const dir = forwardVec();
    for (let i = -1; i <= 1; i += 2) {
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.28, 6, 6),
        new THREE.MeshBasicMaterial({ color: 0xffe08a })
      );
      const right = new THREE.Vector3(0, 1, 0).cross(dir).normalize();
      mesh.position.copy(jet.position).addScaledVector(dir, 5).addScaledVector(right, i * 1.1);
      scene.add(mesh);
      bullets.push({ mesh, vel: dir.clone().multiplyScalar(260), life: 1.15 });
    }
  }

  function fireMissile() {
    if (!state.playing || state.dead || state.mslCool > 0 || state.mslAmmo <= 0) return;
    state.mslCool = 0.85;
    state.mslAmmo -= 1;
    AudioFX.missile();
    setMsg("MISSILE  " + state.mslAmmo + " left", 1.2);
    const dir = forwardVec();
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.28, 2.4, 6),
      new THREE.MeshStandardMaterial({ color: 0xd0d5da, metalness: 0.6, roughness: 0.35 })
    );
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    mesh.position.copy(jet.position).addScaledVector(dir, 4);
    scene.add(mesh);
    // Prefer nearest foe
    let target = null;
    let best = 1e9;
    foes.forEach((f) => {
      const d = f.mesh.position.distanceTo(jet.position);
      if (d < best) { best = d; target = f; }
    });
    missiles.push({ mesh, vel: dir.multiplyScalar(90), life: 4, target });
  }

  // Input
  addEventListener("keydown", (e) => {
    state.keys[e.code] = true;
    if (e.code === "Space") { e.preventDefault(); fireGuns(); }
    if (e.code === "KeyF") fireMissile();
  });
  addEventListener("keyup", (e) => { state.keys[e.code] = false; });
  addEventListener("mousedown", () => { if (state.playing) fireGuns(); });

  function bindStick(el) {
    if (!el) return;
    let active = false;
    const setFrom = (x, y) => {
      const r = el.getBoundingClientRect();
      state.stickX = Math.max(-1, Math.min(1, ((x - r.left) / r.width) * 2 - 1));
      state.stickY = Math.max(-1, Math.min(1, ((y - r.top) / r.height) * 2 - 1));
    };
    const clear = () => { active = false; state.stickX = 0; state.stickY = 0; };
    el.addEventListener("pointerdown", (e) => {
      active = true; el.setPointerCapture(e.pointerId); setFrom(e.clientX, e.clientY);
    });
    el.addEventListener("pointermove", (e) => { if (active) setFrom(e.clientX, e.clientY); });
    el.addEventListener("pointerup", clear);
    el.addEventListener("pointercancel", clear);
  }
  bindStick(stickEl);
  if (fireBtn) fireBtn.addEventListener("pointerdown", (e) => { e.preventDefault(); fireGuns(); });
  if (missileBtn) missileBtn.addEventListener("pointerdown", (e) => { e.preventDefault(); fireMissile(); });

  startBtn.addEventListener("click", startGame);
  againBtn.addEventListener("click", startGame);
  waveBtn.addEventListener("click", engageWave);

  addEventListener("resize", () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight, false);
  });

  function drawRadar() {
    if (!radarCtx || !radar) return;
    const w = radar.width;
    const h = radar.height;
    const cx = w / 2;
    const cy = h / 2;
    radarCtx.clearRect(0, 0, w, h);
    radarCtx.fillStyle = "rgba(6,18,28,0.55)";
    radarCtx.beginPath(); radarCtx.arc(cx, cy, w * 0.48, 0, Math.PI * 2); radarCtx.fill();
    radarCtx.strokeStyle = "rgba(227,125,46,0.35)";
    radarCtx.beginPath(); radarCtx.arc(cx, cy, w * 0.48, 0, Math.PI * 2); radarCtx.stroke();
    radarCtx.beginPath(); radarCtx.arc(cx, cy, w * 0.25, 0, Math.PI * 2); radarCtx.stroke();
    // player
    radarCtx.fillStyle = "#e37d2e";
    radarCtx.fillRect(cx - 2, cy - 2, 4, 4);
    const range = 320;
    foes.forEach((f) => {
      const dx = f.mesh.position.x - jet.position.x;
      const dz = f.mesh.position.z - jet.position.z;
      // rotate into jet yaw frame
      const rx = dx * Math.cos(-state.yaw) - dz * Math.sin(-state.yaw);
      const rz = dx * Math.sin(-state.yaw) + dz * Math.cos(-state.yaw);
      const px = cx + (rx / range) * (w * 0.45);
      const py = cy + (rz / range) * (h * 0.45);
      if (px < 4 || px > w - 4 || py < 4 || py > h - 4) return;
      radarCtx.fillStyle = "#d96464";
      radarCtx.fillRect(px - 2, py - 2, 4, 4);
    });
  }

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    state.time += dt;

    // Ocean waves
    const pos = oceanGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const ix = i * 3;
      const x = oceanBase[ix];
      const z = oceanBase[ix + 2];
      pos.array[ix + 1] =
        Math.sin(x * 0.02 + state.time * 1.4) * 1.1 +
        Math.cos(z * 0.017 - state.time * 1.1) * 0.9;
    }
    pos.needsUpdate = true;
    oceanGeo.computeVertexNormals();
    ocean.position.x = jet.position.x;
    ocean.position.z = jet.position.z;
    carrier.position.x += 5.5 * dt;

    camShake.multiplyScalar(Math.max(0, 1 - dt * 6));

    if (state.msgTimer > 0) state.msgTimer -= dt;

    if (state.playing && !state.dead) {
      let pitchIn = state.stickY;
      let yawIn = state.stickX;
      let thr = 0;
      let abHeld = false;
      if (state.keys.KeyW || state.keys.ArrowUp) pitchIn -= 1;
      if (state.keys.KeyS || state.keys.ArrowDown) pitchIn += 1;
      if (state.keys.KeyA || state.keys.ArrowLeft) yawIn -= 1;
      if (state.keys.KeyD || state.keys.ArrowRight) yawIn += 1;
      if (state.keys.ShiftLeft || state.keys.ShiftRight) { thr += 1; abHeld = true; }
      if (state.keys.ControlLeft || state.keys.KeyC) thr -= 1;

      pitchIn = Math.max(-1, Math.min(1, pitchIn));
      yawIn = Math.max(-1, Math.min(1, yawIn));

      if (abHeld) state.ab = Math.max(0, state.ab - dt * 0.22);
      else state.ab = Math.min(1, state.ab + dt * 0.12);
      const usingAB = abHeld && state.ab > 0.02;
      flame.visible = usingAB;
      flame.scale.set(1, 1, 0.8 + Math.random() * 0.6);

      state.throttle = Math.max(0.2, Math.min(1, state.throttle + thr * dt * 0.5));
      const targetSpeed = 20 + state.throttle * 88 + (usingAB ? 55 : 0);
      state.speed += (targetSpeed - state.speed) * Math.min(1, dt * 1.6);

      state.yaw -= yawIn * dt * (1.15 + state.speed * 0.004);
      state.pitch += (-pitchIn) * dt * 1.05;
      state.pitch = Math.max(-0.85, Math.min(0.8, state.pitch));
      state.roll = THREE.MathUtils.lerp(state.roll, yawIn * 0.7, Math.min(1, dt * 5));

      const forward = forwardVec();
      jet.position.addScaledVector(forward, state.speed * dt);
      jet.rotation.set(0, -state.yaw, state.pitch);
      jet.rotateX(state.roll);

      // Trail
      if (trailCount < trailMax) trailCount++;
      for (let i = trailCount - 1; i > 0; i--) {
        trailPos[i * 3] = trailPos[(i - 1) * 3];
        trailPos[i * 3 + 1] = trailPos[(i - 1) * 3 + 1];
        trailPos[i * 3 + 2] = trailPos[(i - 1) * 3 + 2];
      }
      trailPos[0] = jet.position.x - forward.x * 4;
      trailPos[1] = jet.position.y;
      trailPos[2] = jet.position.z - forward.z * 4;
      trail.geometry.setDrawRange(0, trailCount);
      trail.geometry.attributes.position.needsUpdate = true;

      AudioFX.setEngine(state.speed, usingAB);

      if (jet.position.y < 2.4) damagePlayer(80, "Ditched in the drink.");
      else if (state.speed < 15) setMsg("STALL — punch afterburner (Shift)", 0.5);
      else if (state.msgTimer <= 0) setMsg(foes.length ? (foes.length + " HOSTILES") : "AIRSPACE CLEAR", 0.2);

      // Deck whisper
      const local = jet.position.clone().sub(carrier.position);
      if (Math.abs(local.x) < 80 && Math.abs(local.z) < 18 && jet.position.y < 15 && state.speed < 38) {
        setMsg("ON DECK — beautiful flying", 0.4);
      }

      state.fireCool = Math.max(0, state.fireCool - dt);
      state.mslCool = Math.max(0, state.mslCool - dt);
      if (state.comboTimer > 0) {
        state.comboTimer -= dt;
        if (state.comboTimer <= 0) state.combo = 0;
      }

      // Bullets
      for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i];
        b.mesh.position.addScaledVector(b.vel, dt);
        b.life -= dt;
        let hit = false;
        for (let f = foes.length - 1; f >= 0; f--) {
          if (b.mesh.position.distanceTo(foes[f].mesh.position) < 4.2) {
            foes[f].hp -= 1;
            hit = true;
            AudioFX.hit();
            if (foes[f].hp <= 0) {
              explode(foes[f].mesh.position.clone(), 1.4);
              scene.remove(foes[f].mesh);
              foes.splice(f, 1);
              addScore(120);
            } else addScore(15);
            break;
          }
        }
        if (hit || b.life <= 0) {
          scene.remove(b.mesh);
          bullets.splice(i, 1);
        }
      }

      // Missiles
      for (let i = missiles.length - 1; i >= 0; i--) {
        const m = missiles[i];
        if (m.target && m.target.mesh.parent) {
          const to = m.target.mesh.position.clone().sub(m.mesh.position).normalize();
          m.vel.lerp(to.multiplyScalar(160), Math.min(1, dt * 2.5));
          m.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), m.vel.clone().normalize());
        }
        m.mesh.position.addScaledVector(m.vel, dt);
        m.life -= dt;
        let hit = false;
        for (let f = foes.length - 1; f >= 0; f--) {
          if (m.mesh.position.distanceTo(foes[f].mesh.position) < 5.5) {
            explode(foes[f].mesh.position.clone(), 1.8);
            scene.remove(foes[f].mesh);
            foes.splice(f, 1);
            addScore(220);
            hit = true;
            break;
          }
        }
        if (hit || m.life <= 0) {
          scene.remove(m.mesh);
          missiles.splice(i, 1);
        }
      }

      // Foes
      foes.forEach((f) => {
        const toPlayer = jet.position.clone().sub(f.mesh.position);
        const dist = toPlayer.length();
        const desired = Math.atan2(toPlayer.z, toPlayer.x);
        let dy = desired - f.yaw;
        while (dy > Math.PI) dy -= Math.PI * 2;
        while (dy < -Math.PI) dy += Math.PI * 2;
        f.yaw += Math.max(-1.6, Math.min(1.6, dy)) * dt * 1.4;
        const dir = new THREE.Vector3(Math.cos(f.yaw), Math.sin(Math.atan2(toPlayer.y, dist) * 0.35), Math.sin(f.yaw));
        f.mesh.position.addScaledVector(dir, f.speed * dt);
        f.mesh.lookAt(f.mesh.position.clone().add(dir));
        f.cool -= dt;
        if (f.cool <= 0 && dist < 220) {
          f.cool = 1.1 / f.shoot;
          const shot = new THREE.Mesh(
            new THREE.SphereGeometry(0.32, 6, 6),
            new THREE.MeshBasicMaterial({ color: 0xff5a4a })
          );
          shot.position.copy(f.mesh.position);
          scene.add(shot);
          foeShots.push({
            mesh: shot,
            vel: jet.position.clone().sub(f.mesh.position).normalize().multiplyScalar(120),
            life: 2.2
          });
        }
        if (dist < 5.5) damagePlayer(35, "Mid-air collision.");
      });

      for (let i = foeShots.length - 1; i >= 0; i--) {
        const s = foeShots[i];
        s.mesh.position.addScaledVector(s.vel, dt);
        s.life -= dt;
        if (s.mesh.position.distanceTo(jet.position) < 3.2) {
          damagePlayer(12, "Taken heavy fire.");
          scene.remove(s.mesh);
          foeShots.splice(i, 1);
          continue;
        }
        if (s.life <= 0) {
          scene.remove(s.mesh);
          foeShots.splice(i, 1);
        }
      }

      // Wave clear
      if (foes.length === 0 && !state.pausedWave) {
        state.wave += 1;
        state.mslAmmo = Math.min(8, state.mslAmmo + 3);
        state.hp = Math.min(100, state.hp + 25);
        addScore(500);
        if (state.wave >= WAVES.length) {
          setMsg("CAMPAIGN CLEAR — endless threat", 3);
        }
        beginWaveScreen();
      }

      updateHud();
      drawRadar();
    }

    // Explosions
    for (let i = explosions.length - 1; i >= 0; i--) {
      const e = explosions[i];
      e.life -= dt;
      const t = Math.max(0, e.life / 0.45);
      e.mesh.scale.setScalar((1.2 + (1 - t) * 3) * e.scale);
      e.mesh.material.opacity = t;
      if (e.life <= 0) {
        scene.remove(e.mesh);
        explosions.splice(i, 1);
      }
    }

    // Camera
    if (state.playing || state.pausedWave || state.dead) {
      const back = new THREE.Vector3(
        -Math.cos(state.yaw) * 20,
        7 + Math.max(0, -state.pitch) * 5,
        -Math.sin(state.yaw) * 20
      );
      const desired = jet.position.clone().add(back).add(camShake);
      camera.position.lerp(desired, 0.14);
      const look = jet.position.clone().add(new THREE.Vector3(
        Math.cos(state.yaw) * 24,
        1.5 + state.pitch * 8,
        Math.sin(state.yaw) * 24
      ));
      camera.lookAt(look);
    } else {
      const t = state.time * 0.12;
      camera.position.set(carrier.position.x + Math.cos(t) * 140, 60, Math.sin(t) * 140);
      camera.lookAt(carrier.position.x + 20, 16, 0);
    }

    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }

  bestEl.textContent = "BEST " + state.best;
  updateHud();
  requestAnimationFrame(frame);
})();
