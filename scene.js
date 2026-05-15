// scene.js — 3D latent traversal viewer
// Renders the DATA point cloud with Three.js: glowing sprite points,
// ground-shadow projection, an animated cursor, and an HTML dialog
// bubble that pops out of the current point.

(() => {
  const DATA = window.DATA;
  const META = window.META;
  if (!DATA) { console.error('DATA missing'); return; }

  // header text
  document.getElementById('hd-n').textContent = DATA.points.length;
  document.getElementById('hd-shape').textContent = (META.latent_shape || []).join('×') || '—';
  document.getElementById('hd-imauve').textContent =
    META.imauve == null ? '—' : Number(META.imauve).toFixed(4);
  const ckptEl = document.getElementById('hd-ckpt');
  ckptEl.textContent = META.checkpoint || '';
  ckptEl.title = META.checkpoint || '';

  // ----- arrays -----
  const N = DATA.points.length;
  const X = new Float32Array(N);
  const Y = new Float32Array(N);
  const Z = new Float32Array(N);
  const TXT = new Array(N);

  // The source file double-mojibakes a few punctuation chars; fix on the fly.
  function fixMojibake(s) {
    if (!s) return s;
    return s
      .replace(/\u00e2\u20ac\u0153/g, '\u201c') // "
      .replace(/\u00e2\u20ac\u009d/g, '\u201d') // "
      .replace(/\u00e2\u20ac\u2122/g, '\u2019') // '
      .replace(/\u00e2\u20ac\u02dc/g, '\u2018') // '
      .replace(/\u00e2\u20ac\u201d/g, '\u2014') // —
      .replace(/\u00e2\u20ac\u201c/g, '\u2013') // –
      .replace(/\u00e2\u20ac\u00a6/g, '\u2026') // …
      .replace(/\u00e2\u20ac /g, '\u201d ')     // closing " with trailing space
      .replace(/\u00e2\u20ac$/g, '\u201d');
  }

  for (let i = 0; i < N; i++) {
    const p = DATA.points[i];
    X[i] = p.x3; Y[i] = p.y3; Z[i] = p.z3; TXT[i] = fixMojibake(p.pred);
  }
  // recenter + normalize scale
  let cx=0, cy=0, cz=0;
  for (let i = 0; i < N; i++) { cx += X[i]; cy += Y[i]; cz += Z[i]; }
  cx/=N; cy/=N; cz/=N;
  let maxR = 0;
  for (let i = 0; i < N; i++) {
    X[i]-=cx; Y[i]-=cy; Z[i]-=cz;
    const r = Math.hypot(X[i], Y[i], Z[i]);
    if (r > maxR) maxR = r;
  }
  const targetR = 50;
  const s = targetR / maxR;
  for (let i = 0; i < N; i++) { X[i]*=s; Y[i]*=s; Z[i]*=s; }

  // bounds for ground
  let yMin = Infinity, yMax = -Infinity, zMin=Infinity, zMax=-Infinity;
  for (let i = 0; i < N; i++) {
    if (Y[i] < yMin) yMin = Y[i];
    if (Y[i] > yMax) yMax = Y[i];
    if (Z[i] < zMin) zMin = Z[i];
    if (Z[i] > zMax) zMax = Z[i];
  }

  // ----- color palette -----
  // map t in [0,1] to a vivid rainbow-magma-ish color (inspired by the source video)
  function palette(t) {
    // piecewise-linear over keyframes
    const stops = [
      [0.00, [ 60, 30,110]], // deep indigo
      [0.16, [110, 30,160]], // violet
      [0.30, [180, 30,180]], // magenta
      [0.45, [220, 60,140]], // pink
      [0.60, [255,120, 80]], // coral
      [0.72, [255,180, 60]], // amber
      [0.85, [255,240,140]], // pale yellow
      [1.00, [240,255,220]], // near-white cyan
    ];
    t = Math.max(0, Math.min(1, t));
    for (let i = 1; i < stops.length; i++) {
      if (t <= stops[i][0]) {
        const a = stops[i-1], b = stops[i];
        const u = (t - a[0]) / (b[0] - a[0] || 1);
        return [
          (a[1][0] + (b[1][0]-a[1][0])*u) / 255,
          (a[1][1] + (b[1][1]-a[1][1])*u) / 255,
          (a[1][2] + (b[1][2]-a[1][2])*u) / 255,
        ];
      }
    }
    return [1,1,1];
  }

  // per-point color by Z (depth in original) so it visually matches the source figure
  const colors = new Float32Array(N * 3);
  const tArr = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const t = (Z[i] - zMin) / (zMax - zMin || 1);
    tArr[i] = t;
    const [r, g, b] = palette(t);
    colors[i*3] = r; colors[i*3+1] = g; colors[i*3+2] = b;
  }

  // ----- Three.js scene -----
  const canvas = document.getElementById('canvas');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.setClearColor(0x000000, 0); // body provides bg gradient

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.set(95, 35, 110);
  camera.lookAt(0, -5, 0);

  const controls = new THREE.OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = false;
  controls.minDistance = 50;
  controls.maxDistance = 220;
  controls.target.set(0, -5, 0);
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.35;

  // ----- sprite textures -----
  function makeGlowSprite(size, opts) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(size/2, size/2, 0, size/2, size/2, size/2);
    const inner = opts.inner || 'rgba(255,255,255,1)';
    const mid = opts.mid || 'rgba(255,255,255,0.55)';
    const outer = opts.outer || 'rgba(255,255,255,0)';
    grd.addColorStop(0.0, inner);
    grd.addColorStop(0.3, mid);
    grd.addColorStop(1.0, outer);
    g.fillStyle = grd;
    g.fillRect(0, 0, size, size);
    const tex = new THREE.CanvasTexture(c);
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    return tex;
  }

  const pointTex = makeGlowSprite(128, {
    inner: 'rgba(255,255,255,1)',
    mid:   'rgba(255,255,255,0.45)',
    outer: 'rgba(255,255,255,0)',
  });

  const shadowTex = makeGlowSprite(128, {
    inner: 'rgba(255,255,255,0.85)',
    mid:   'rgba(255,255,255,0.18)',
    outer: 'rgba(255,255,255,0)',
  });

  // ----- ground plane (subtle radial gradient floor) -----
  {
    const fc = document.createElement('canvas');
    fc.width = fc.height = 512;
    const fg = fc.getContext('2d');
    const grd = fg.createRadialGradient(256, 256, 20, 256, 256, 256);
    grd.addColorStop(0, 'rgba(90,75,135,0.55)');
    grd.addColorStop(0.45, 'rgba(40,35,70,0.25)');
    grd.addColorStop(1, 'rgba(10,10,20,0)');
    fg.fillStyle = grd;
    fg.fillRect(0, 0, 512, 512);
    const floorTex = new THREE.CanvasTexture(fc);
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(280, 280),
      new THREE.MeshBasicMaterial({
        map: floorTex, transparent: true, depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = yMin - 8;
    scene.add(floor);
  }

  const groundY = yMin - 6;

  // ----- main points -----
  const cloudGeo = new THREE.BufferGeometry();
  const positions = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    positions[i*3]   = X[i];
    positions[i*3+1] = Y[i];
    positions[i*3+2] = Z[i];
  }
  cloudGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  cloudGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const cloudMat = new THREE.PointsMaterial({
    size: 3.4,
    map: pointTex,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
  });
  const cloud = new THREE.Points(cloudGeo, cloudMat);
  scene.add(cloud);

  // ----- ground shadow points -----
  const shadowGeo = new THREE.BufferGeometry();
  const shadowPositions = new Float32Array(N * 3);
  const shadowColors = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    shadowPositions[i*3]   = X[i];
    shadowPositions[i*3+1] = groundY;
    shadowPositions[i*3+2] = Z[i];
    // tint the shadow with a darkened version of the point color so it still hints at hue
    shadowColors[i*3]   = colors[i*3]   * 0.35;
    shadowColors[i*3+1] = colors[i*3+1] * 0.30;
    shadowColors[i*3+2] = colors[i*3+2] * 0.45;
  }
  shadowGeo.setAttribute('position', new THREE.BufferAttribute(shadowPositions, 3));
  shadowGeo.setAttribute('color', new THREE.BufferAttribute(shadowColors, 3));
  const shadowMat = new THREE.PointsMaterial({
    size: 4.5,
    map: shadowTex,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    opacity: 0.55,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
  });
  const shadowPoints = new THREE.Points(shadowGeo, shadowMat);
  scene.add(shadowPoints);

  // ----- cursor (current point glow) -----
  const cursorGeo = new THREE.BufferGeometry();
  cursorGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0,0,0]), 3));
  const cursorMat = new THREE.PointsMaterial({
    size: 14,
    map: pointTex,
    color: 0xffffff,
    transparent: true,
    depthWrite: false,
    opacity: 0.95,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
  });
  const cursor = new THREE.Points(cursorGeo, cursorMat);
  scene.add(cursor);

  const cursorCoreMat = new THREE.PointsMaterial({
    size: 5,
    map: pointTex,
    color: 0xffffff,
    transparent: true,
    depthWrite: false,
    opacity: 1.0,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
  });
  const cursorCore = new THREE.Points(cursorGeo.clone(), cursorCoreMat);
  scene.add(cursorCore);

  // ring (camera-facing) using sprite
  const ringTexCanvas = document.createElement('canvas');
  ringTexCanvas.width = ringTexCanvas.height = 128;
  {
    const g = ringTexCanvas.getContext('2d');
    g.lineWidth = 4;
    g.strokeStyle = 'rgba(255,255,255,0.95)';
    g.beginPath(); g.arc(64, 64, 50, 0, Math.PI*2); g.stroke();
    g.lineWidth = 2;
    g.strokeStyle = 'rgba(255,255,255,0.4)';
    g.beginPath(); g.arc(64, 64, 58, 0, Math.PI*2); g.stroke();
  }
  const ringTex = new THREE.CanvasTexture(ringTexCanvas);
  const ringMat = new THREE.SpriteMaterial({
    map: ringTex,
    color: 0xffffff,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    opacity: 0.9,
  });
  const ring = new THREE.Sprite(ringMat);
  ring.scale.set(10, 10, 1);
  scene.add(ring);

  // ----- trail line -----
  const TRAIL_LEN = 30;
  const trailIdx = []; // recent indices
  const trailGeo = new THREE.BufferGeometry();
  const trailPos = new Float32Array(TRAIL_LEN * 3);
  const trailCol = new Float32Array(TRAIL_LEN * 3);
  trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPos, 3));
  trailGeo.setAttribute('color', new THREE.BufferAttribute(trailCol, 3));
  const trailMat = new THREE.LineBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0.7,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const trail = new THREE.Line(trailGeo, trailMat);
  trail.frustumCulled = false;
  scene.add(trail);

  // ----- knn -----
  function buildKnn(k) {
    const out = new Array(N);
    for (let i = 0; i < N; i++) {
      const xi = X[i], yi = Y[i], zi = Z[i];
      const dists = new Array(N);
      for (let j = 0; j < N; j++) {
        const dx = X[j]-xi, dy = Y[j]-yi, dz = Z[j]-zi;
        dists[j] = [dx*dx + dy*dy + dz*dz, j];
      }
      dists.sort((a,b) => a[0]-b[0]);
      out[i] = dists.slice(1, k+1).map(d => d[1]);
    }
    return out;
  }
  const KNN = buildKnn(8);

  // ----- walker -----
  let curIdx = Math.floor(Math.random() * N);
  let playing = true;
  let timer = null;
  const bubble = document.getElementById('bubble');
  const textEl = document.getElementById('text');
  const curIdxEl = document.getElementById('cur-idx');
  const curIdxEl2 = document.getElementById('cur-idx-2');
  const dotEl = document.querySelector('.bubble-head .dot');

  function colorHex(t) {
    const [r,g,b] = palette(t);
    const to = (v) => Math.round(v*255).toString(16).padStart(2,'0');
    return '#'+to(r)+to(g)+to(b);
  }

  function updateTrail() {
    for (let i = 0; i < TRAIL_LEN; i++) {
      const j = trailIdx[i];
      if (j == null) {
        // duplicate last to avoid line jumping
        const k = trailIdx.length > 0 ? trailIdx[trailIdx.length-1] : 0;
        trailPos[i*3]   = X[k];
        trailPos[i*3+1] = Y[k];
        trailPos[i*3+2] = Z[k];
        trailCol[i*3] = 0; trailCol[i*3+1] = 0; trailCol[i*3+2] = 0;
      } else {
        trailPos[i*3]   = X[j];
        trailPos[i*3+1] = Y[j];
        trailPos[i*3+2] = Z[j];
        const fade = i / (TRAIL_LEN - 1); // older -> 0, newer -> 1
        trailCol[i*3]   = colors[j*3]   * fade;
        trailCol[i*3+1] = colors[j*3+1] * fade;
        trailCol[i*3+2] = colors[j*3+2] * fade;
      }
    }
    trailGeo.attributes.position.needsUpdate = true;
    trailGeo.attributes.color.needsUpdate = true;
  }

  function jumpTo(i, opts = {}) {
    curIdx = i;
    trailIdx.push(i);
    while (trailIdx.length > TRAIL_LEN) trailIdx.shift();

    const t = tArr[i];
    const hex = colorHex(t);
    dotEl.style.setProperty('--accent', hex);
    bubble.style.setProperty('--accent', hex);

    curIdxEl.textContent = '#' + String(DATA.points[i].idx).padStart(4, '0');
    curIdxEl2.textContent = '#' + String(DATA.points[i].idx).padStart(4, '0');

    // text crossfade
    bubble.classList.add('entering');
    textEl.style.opacity = 0;
    setTimeout(() => {
      textEl.textContent = TXT[i] || '';
      textEl.scrollTop = 0;
      textEl.style.opacity = 1;
      bubble.classList.remove('entering');
    }, 160);

    // cursor position
    cursorGeo.attributes.position.array[0] = X[i];
    cursorGeo.attributes.position.array[1] = Y[i];
    cursorGeo.attributes.position.array[2] = Z[i];
    cursorGeo.attributes.position.needsUpdate = true;
    cursorCore.geometry.attributes.position.array[0] = X[i];
    cursorCore.geometry.attributes.position.array[1] = Y[i];
    cursorCore.geometry.attributes.position.array[2] = Z[i];
    cursorCore.geometry.attributes.position.needsUpdate = true;
    ring.position.set(X[i], Y[i], Z[i]);

    updateTrail();
  }

  // ----- bubble positioning + SVG leader line -----
  const leaderSvg = document.getElementById('leader-svg');
  function ensureLeader() {
    leaderSvg.setAttribute('width', window.innerWidth);
    leaderSvg.setAttribute('height', window.innerHeight);
    leaderSvg.setAttribute('viewBox', `0 0 ${window.innerWidth} ${window.innerHeight}`);
  }
  ensureLeader();

  // returns {x, y} in CSS pixels of the projected point
  function projectPoint(i) {
    const v = new THREE.Vector3(X[i], Y[i], Z[i]);
    v.project(camera);
    return {
      x: (v.x * 0.5 + 0.5) * window.innerWidth,
      y: (-v.y * 0.5 + 0.5) * window.innerHeight,
      behind: v.z > 1,
    };
  }

  function positionBubble() {
    const p = projectPoint(curIdx);
    if (p.behind) {
      bubble.style.opacity = 0;
      leaderSvg.innerHTML = '';
      return;
    }
    bubble.style.opacity = 1;

    const W = window.innerWidth, H = window.innerHeight;
    const bw = bubble.offsetWidth || 320;
    const bh = bubble.offsetHeight || 180;
    const PAD = 26;
    const OFF = 90; // horizontal gap between point and bubble

    // prefer right side of point unless it would clip
    let placeLeft = (p.x + OFF + bw + PAD > W);
    if (placeLeft && p.x - OFF - bw < PAD) {
      // pick side with more room
      placeLeft = (W - p.x) < p.x;
    }

    let bx, by;
    if (placeLeft) {
      bx = p.x - OFF - bw;
    } else {
      bx = p.x + OFF;
    }
    // vertically center on point but clamp
    by = p.y - bh / 2;
    bx = Math.max(PAD, Math.min(W - bw - PAD, bx));
    by = Math.max(PAD + 56 /* header */, Math.min(H - bh - 90 /* controls */, by));

    bubble.style.left = bx + 'px';
    bubble.style.top  = by + 'px';

    // transform origin = side closest to the point
    const ox = placeLeft ? '100%' : '0%';
    // origin y in % from top inside bubble = clamp((p.y - by) / bh * 100, 10, 90)
    const oy = Math.max(15, Math.min(85, ((p.y - by) / bh) * 100)) + '%';
    bubble.style.setProperty('--ox', ox);
    bubble.style.setProperty('--oy', oy);

    // SVG leader: from point to bubble's nearest edge
    const edgeX = placeLeft ? bx + bw : bx;
    const edgeY = by + Math.max(15, Math.min(bh - 15, p.y - by));

    // smooth curve: pull control toward the point but offset
    const accent = window.getComputedStyle(dotEl).getPropertyValue('background-color') || '#ff8eb6';
    const dx = edgeX - p.x;
    const cx1 = p.x + dx * 0.45;
    const cy1 = p.y;
    const cx2 = p.x + dx * 0.55;
    const cy2 = edgeY;
    const dpath = `M ${p.x} ${p.y} C ${cx1} ${cy1} ${cx2} ${cy2} ${edgeX} ${edgeY}`;

    leaderSvg.innerHTML = `
      <defs>
        <filter id="lglow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3" result="b"/>
          <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
        <radialGradient id="pdot" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="${accent}" stop-opacity="1"/>
          <stop offset="60%" stop-color="${accent}" stop-opacity="0.55"/>
          <stop offset="100%" stop-color="${accent}" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <path d="${dpath}" fill="none" stroke="${accent}" stroke-opacity="0.35" stroke-width="6" filter="url(#lglow)"/>
      <path d="${dpath}" fill="none" stroke="${accent}" stroke-opacity="0.95" stroke-width="1.6" stroke-linecap="round"/>
      <circle cx="${p.x}" cy="${p.y}" r="14" fill="url(#pdot)"/>
      <circle cx="${p.x}" cy="${p.y}" r="3.2" fill="${accent}"/>
      <circle cx="${edgeX}" cy="${edgeY}" r="3" fill="${accent}" opacity="0.95"/>
      <circle cx="${edgeX}" cy="${edgeY}" r="6" fill="none" stroke="${accent}" stroke-opacity="0.4" stroke-width="1"/>
    `;
  }

  // ----- walk -----
  function tick() {
    const nbrs = KNN[curIdx];
    let next;
    // 80% chance go to a neighbour we haven't visited recently
    const recent = new Set(trailIdx.slice(-6));
    const fresh = nbrs.filter(n => !recent.has(n));
    const pool = fresh.length > 0 ? fresh : nbrs;
    next = pool[Math.floor(Math.random() * pool.length)];
    jumpTo(next);
  }
  function schedule() {
    if (timer) clearTimeout(timer);
    if (!playing) return;
    const ms = Number(document.getElementById('speed').value);
    timer = setTimeout(() => { tick(); schedule(); }, ms);
  }

  // ----- controls wiring -----
  const playBtn = document.getElementById('btn-play');
  const icPause = document.getElementById('ic-pause');
  const icPlay = document.getElementById('ic-play');
  playBtn.addEventListener('click', () => {
    playing = !playing;
    icPause.style.display = playing ? '' : 'none';
    icPlay.style.display  = playing ? 'none' : '';
    controls.autoRotate = playing;
    schedule();
  });
  document.getElementById('btn-next').addEventListener('click', () => tick());
  document.getElementById('btn-prev').addEventListener('click', () => {
    if (trailIdx.length >= 2) {
      trailIdx.pop(); // drop current
      const prev = trailIdx.pop() ?? curIdx;
      jumpTo(prev);
    } else {
      tick();
    }
  });
  document.getElementById('speed').addEventListener('input', schedule);

  // click on canvas to pick a point
  const raycaster = new THREE.Raycaster();
  raycaster.params.Points.threshold = 1.8;
  const mouse = new THREE.Vector2();
  canvas.addEventListener('click', (e) => {
    // ignore real drags
    if (e.detail === 0) return;
    mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    const hits = raycaster.intersectObject(cloud);
    if (hits.length) jumpTo(hits[0].index);
  });

  // ----- resize -----
  function onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    ensureLeader();
  }
  window.addEventListener('resize', onResize);

  // ----- render loop -----
  const clock = new THREE.Clock();
  function render() {
    const t = clock.getElapsedTime();
    controls.update();
    // pulse cursor halo + ring
    const pulse = 0.9 + Math.sin(t * 3.2) * 0.18;
    cursorMat.size = 14 * pulse;
    ring.scale.set(9 + Math.sin(t * 2) * 1.2, 9 + Math.sin(t * 2) * 1.2, 1);
    ring.material.rotation = t * 0.4;
    ringMat.opacity = 0.55 + Math.sin(t * 2) * 0.2;

    renderer.render(scene, camera);
    positionBubble();
    requestAnimationFrame(render);
  }

  // ----- boot -----
  jumpTo(curIdx);
  // seed trail
  for (let i = 0; i < 5; i++) { const n = KNN[curIdx][i % KNN[curIdx].length]; trailIdx.push(n); }
  updateTrail();
  schedule();
  render();
})();
