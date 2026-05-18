// scene.js — 3D latent traversal viewer
// Cluster-colored point cloud with Three.js: glowing sprites,
// ground-shadow projection, animated cursor, and HTML dialog bubble.

(() => {
  const DATA = window.DATA;
  const META = window.META;
  if (!DATA) { console.error('DATA missing'); return; }

  // header text
  document.getElementById('hd-n').textContent = DATA.points.length;
  document.getElementById('hd-shape').textContent = (META.latent_shape || []).join('×') || '—';
  document.getElementById('hd-imauve').textContent =
    META.imauve == null ? '—' : Number(META.imauve).toFixed(4);

  // ----- cluster definitions -----
  // Centroids are in original (un-normalized) t-SNE x3/y3 space
  const CLUSTERS = [
    { id: 'short_compact',  name: '📜 Short & Compact',        desc: 'Brevity-first — avg 122 words, simple plots, nature settings',          hex: '#6b8cba', rgb: [107/255, 140/255, 186/255] },
    { id: 'long_outdoor',   name: '🌲 Long Outdoor Stories',   desc: 'Longer tales (avg 167 words) set in parks, forests & fields',            hex: '#1db863', rgb: [ 29/255, 184/255,  99/255] },
    { id: 'moral_tales',    name: '⚖️ Moral Tales',             desc: 'Nearly half end with an explicit lesson or moral',                       hex: '#f07d24', rgb: [240/255, 125/255,  36/255] },
    { id: 'simple_home',    name: '🏠 Simple Home Stories',    desc: 'Home & family settings — most faithfully reconstructed by the model',    hex: '#1ba8e8', rgb: [ 27/255, 168/255, 232/255] },
    { id: 'conversational', name: '💬 Conversational Stories', desc: 'Dialogue-heavy (73%), often female protagonists',                        hex: '#9b5de5', rgb: [155/255,  93/255, 229/255] },
    { id: 'long_dialogue',  name: '📖 Long Dialogue Stories',  desc: 'Longest stories (avg 176 words), rich back-and-forth exchanges',         hex: '#e8474c', rgb: [232/255,  71/255,  76/255] },
  ];
  const CENTROIDS = [
    [-28.29,  3.12],
    [ -6.34, -2.53],
    [  1.13,  5.66],
    [ -7.28, -7.18],
    [ 21.59,  4.78],
    [ 29.79, -4.57],
  ];

  // ----- arrays -----
  const N = DATA.points.length;
  const X = new Float32Array(N);
  const Y = new Float32Array(N);
  const Z = new Float32Array(N);
  const TXT = new Array(N);

  function fixMojibake(s) {
    if (!s) return s;
    return s
      .replace(/â€œ/g, '“')
      .replace(/â€/g, '”')
      .replace(/â€™/g, '’')
      .replace(/â€˜/g, '‘')
      .replace(/â€”/g, '—')
      .replace(/â€“/g, '–')
      .replace(/â€¦/g, '…')
      .replace(/â€ /g, '” ')
      .replace(/â€$/g, '”');
  }

  for (let i = 0; i < N; i++) {
    const p = DATA.points[i];
    X[i] = p.x3; Y[i] = p.y3; Z[i] = p.z3; TXT[i] = fixMojibake(p.pred);
  }

  // ----- assign each point to nearest cluster centroid (before normalization) -----
  const clusterOf = new Int8Array(N);
  for (let i = 0; i < N; i++) {
    const px = DATA.points[i].x3, py = DATA.points[i].y3;
    let best = 0, bestD = Infinity;
    for (let k = 0; k < CLUSTERS.length; k++) {
      const dx = px - CENTROIDS[k][0], dy = py - CENTROIDS[k][1];
      const d = dx*dx + dy*dy;
      if (d < bestD) { bestD = d; best = k; }
    }
    clusterOf[i] = best;
  }

  // ----- store raw 2D coords for mini-map (capture before in-place normalization) -----
  const X2 = X.slice();
  const Y2 = Y.slice();
  let x2Min=Infinity, x2Max=-Infinity, y2Min=Infinity, y2Max=-Infinity;
  for (let i=0;i<N;i++){
    if(X2[i]<x2Min)x2Min=X2[i]; if(X2[i]>x2Max)x2Max=X2[i];
    if(Y2[i]<y2Min)y2Min=Y2[i]; if(Y2[i]>y2Max)y2Max=Y2[i];
  }

  // ----- normalize -----
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

  let yMin = Infinity, yMax = -Infinity;
  for (let i = 0; i < N; i++) {
    if (Y[i] < yMin) yMin = Y[i];
    if (Y[i] > yMax) yMax = Y[i];
  }

  // ----- cluster colors per point -----
  const colors = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const [r, g, b] = CLUSTERS[clusterOf[i]].rgb;
    colors[i*3] = r; colors[i*3+1] = g; colors[i*3+2] = b;
  }

  // ----- Three.js scene -----
  const canvas = document.getElementById('canvas');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.set(155, 55, 185);
  camera.lookAt(0, -5, 0);

  const controls = new THREE.OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = false;
  controls.minDistance = 50;
  controls.maxDistance = 340;
  controls.target.set(0, -5, 0);
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.35;

  // ----- sprite textures -----
  function makeGlowSprite(size, opts) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(size/2, size/2, 0, size/2, size/2, size/2);
    grd.addColorStop(0.0, opts.inner || 'rgba(255,255,255,1)');
    grd.addColorStop(0.3, opts.mid   || 'rgba(255,255,255,0.55)');
    grd.addColorStop(1.0, opts.outer || 'rgba(255,255,255,0)');
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

  // ----- ground plane -----
  {
    const fc = document.createElement('canvas');
    fc.width = fc.height = 512;
    const fg = fc.getContext('2d');
    const grd = fg.createRadialGradient(256, 256, 20, 256, 256, 256);
    grd.addColorStop(0, 'rgba(160,150,200,0.12)');
    grd.addColorStop(0.45, 'rgba(180,175,210,0.05)');
    grd.addColorStop(1, 'rgba(200,200,220,0)');
    fg.fillStyle = grd;
    fg.fillRect(0, 0, 512, 512);
    const floorTex = new THREE.CanvasTexture(fc);
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(280, 280),
      new THREE.MeshBasicMaterial({ map: floorTex, transparent: true, depthWrite: false, blending: THREE.NormalBlending })
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
    positions[i*3] = X[i]; positions[i*3+1] = Y[i]; positions[i*3+2] = Z[i];
  }
  cloudGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  cloudGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const cloudMat = new THREE.PointsMaterial({
    size: 4.2, map: pointTex, vertexColors: true,
    transparent: true, depthWrite: false,
    blending: THREE.NormalBlending, sizeAttenuation: true,
  });
  const cloud = new THREE.Points(cloudGeo, cloudMat);
  scene.add(cloud);

  // ----- ground shadow points -----
  const shadowGeo = new THREE.BufferGeometry();
  const shadowPositions = new Float32Array(N * 3);
  const shadowColors = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    shadowPositions[i*3] = X[i]; shadowPositions[i*3+1] = groundY; shadowPositions[i*3+2] = Z[i];
    shadowColors[i*3]   = colors[i*3]   * 0.40;
    shadowColors[i*3+1] = colors[i*3+1] * 0.40;
    shadowColors[i*3+2] = colors[i*3+2] * 0.50;
  }
  shadowGeo.setAttribute('position', new THREE.BufferAttribute(shadowPositions, 3));
  shadowGeo.setAttribute('color', new THREE.BufferAttribute(shadowColors, 3));
  const shadowMat = new THREE.PointsMaterial({
    size: 4.5, map: shadowTex, vertexColors: true,
    transparent: true, depthWrite: false, opacity: 0.28,
    blending: THREE.NormalBlending, sizeAttenuation: true,
  });
  const shadowPoints = new THREE.Points(shadowGeo, shadowMat);
  scene.add(shadowPoints);

  // ----- cursor (current point glow) -----
  const cursorGeo = new THREE.BufferGeometry();
  cursorGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0,0,0]), 3));
  const cursorMat = new THREE.PointsMaterial({
    size: 14, map: pointTex, color: 0xc084fc,
    transparent: true, depthWrite: false, opacity: 0.70,
    blending: THREE.NormalBlending, sizeAttenuation: true,
  });
  const cursor = new THREE.Points(cursorGeo, cursorMat);
  scene.add(cursor);

  const cursorCoreMat = new THREE.PointsMaterial({
    size: 5, map: pointTex, color: 0x9b5de5,
    transparent: true, depthWrite: false, opacity: 0.90,
    blending: THREE.NormalBlending, sizeAttenuation: true,
  });
  const cursorCore = new THREE.Points(cursorGeo.clone(), cursorCoreMat);
  scene.add(cursorCore);

  // ring — white texture, tinted by cluster color
  const ringTexCanvas = document.createElement('canvas');
  ringTexCanvas.width = ringTexCanvas.height = 128;
  {
    const g = ringTexCanvas.getContext('2d');
    g.lineWidth = 4;
    g.strokeStyle = 'rgba(255,255,255,0.90)';
    g.beginPath(); g.arc(64, 64, 50, 0, Math.PI*2); g.stroke();
    g.lineWidth = 2;
    g.strokeStyle = 'rgba(255,255,255,0.35)';
    g.beginPath(); g.arc(64, 64, 58, 0, Math.PI*2); g.stroke();
  }
  const ringTex = new THREE.CanvasTexture(ringTexCanvas);
  const ringMat = new THREE.SpriteMaterial({
    map: ringTex, color: 0xc084fc,
    transparent: true, depthWrite: false,
    blending: THREE.NormalBlending, opacity: 0.9,
  });
  const ring = new THREE.Sprite(ringMat);
  ring.scale.set(10, 10, 1);
  scene.add(ring);

  // ----- trail line -----
  const TRAIL_LEN = 30;
  const trailIdx = [];
  const trailGeo = new THREE.BufferGeometry();
  const trailPos = new Float32Array(TRAIL_LEN * 3);
  const trailCol = new Float32Array(TRAIL_LEN * 3);
  trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPos, 3));
  trailGeo.setAttribute('color', new THREE.BufferAttribute(trailCol, 3));
  const trailMat = new THREE.LineBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0.50,
    blending: THREE.NormalBlending, depthWrite: false,
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

  // ----- 2D mini-map -----
  const mapCanvas = document.getElementById('map2d');
  const MAP_W = 200, MAP_H = 152;
  const MAP_DPR = Math.min(window.devicePixelRatio || 1, 2);
  mapCanvas.width  = MAP_W * MAP_DPR;
  mapCanvas.height = MAP_H * MAP_DPR;
  const mapCtx = mapCanvas.getContext('2d');
  mapCtx.scale(MAP_DPR, MAP_DPR);

  const MAP_PAD = 13;
  const x2Span = x2Max - x2Min || 1, y2Span = y2Max - y2Min || 1;
  function toMapX(v) { return MAP_PAD + (v - x2Min) / x2Span * (MAP_W - 2 * MAP_PAD); }
  function toMapY(v) { return (MAP_H - MAP_PAD) - (v - y2Min) / y2Span * (MAP_H - 2 * MAP_PAD); }

  // Pre-render static point cloud to offscreen canvas (drawn once)
  const bgCanvas = document.createElement('canvas');
  bgCanvas.width  = MAP_W * MAP_DPR;
  bgCanvas.height = MAP_H * MAP_DPR;
  const bgCtx = bgCanvas.getContext('2d');
  bgCtx.scale(MAP_DPR, MAP_DPR);
  for (let i = 0; i < N; i++) {
    bgCtx.fillStyle = CLUSTERS[clusterOf[i]].hex;
    bgCtx.globalAlpha = 0.60;
    bgCtx.beginPath();
    bgCtx.arc(toMapX(X2[i]), toMapY(Y2[i]), 2.2, 0, Math.PI * 2);
    bgCtx.fill();
  }
  bgCtx.globalAlpha = 1;

  let mapLastJumpMs = -Infinity;

  function drawMap2D(t) {
    mapCtx.clearRect(0, 0, MAP_W, MAP_H);
    mapCtx.drawImage(bgCanvas, 0, 0, MAP_W, MAP_H);

    // Trail — last 22 hops, fading polyline in cluster color
    const TDRAW = Math.min(trailIdx.length, 22);
    if (TDRAW > 1) {
      mapCtx.lineCap = 'round';
      mapCtx.lineJoin = 'round';
      for (let i = 1; i < TDRAW; i++) {
        const j  = trailIdx[trailIdx.length - TDRAW + i];
        const jp = trailIdx[trailIdx.length - TDRAW + i - 1];
        if (j == null || jp == null) continue;
        const [r,g,b] = CLUSTERS[clusterOf[j]].rgb;
        const fade = i / TDRAW;
        mapCtx.strokeStyle = `rgba(${Math.round(r*255)},${Math.round(g*255)},${Math.round(b*255)},${fade * 0.75})`;
        mapCtx.lineWidth = 1.5;
        mapCtx.beginPath();
        mapCtx.moveTo(toMapX(X2[jp]), toMapY(Y2[jp]));
        mapCtx.lineTo(toMapX(X2[j]),  toMapY(Y2[j]));
        mapCtx.stroke();
      }
    }

    // Cursor
    const mx = toMapX(X2[curIdx]);
    const my = toMapY(Y2[curIdx]);
    const cl = CLUSTERS[clusterOf[curIdx]];
    const [r,g,b] = cl.rgb;
    const rr = Math.round(r*255), gg = Math.round(g*255), bb = Math.round(b*255);
    const pulse = 0.5 + 0.5 * Math.sin(t * 3.2);
    const jumpAge = (performance.now() - mapLastJumpMs) / 1000;
    const pop = jumpAge < 0.6 ? Math.exp(-jumpAge * 7) : 0;

    // Outer glow
    const glowR = 18 + pop * 8;
    const grd = mapCtx.createRadialGradient(mx, my, 0, mx, my, glowR);
    grd.addColorStop(0, `rgba(${rr},${gg},${bb},${(0.65 + pop * 0.35) * pulse})`);
    grd.addColorStop(1, `rgba(${rr},${gg},${bb},0)`);
    mapCtx.fillStyle = grd;
    mapCtx.beginPath();
    mapCtx.arc(mx, my, glowR, 0, Math.PI * 2);
    mapCtx.fill();

    // Ring (dark outline ring for contrast on light bg)
    mapCtx.strokeStyle = 'rgba(0,0,0,0.18)';
    mapCtx.lineWidth = 3.5;
    mapCtx.globalAlpha = 1;
    mapCtx.beginPath();
    mapCtx.arc(mx, my, 7.5 + pulse * 1.5 + pop * 3, 0, Math.PI * 2);
    mapCtx.stroke();
    // Colored ring on top
    mapCtx.strokeStyle = cl.hex;
    mapCtx.lineWidth = 2.5;
    mapCtx.globalAlpha = 0.75 + 0.25 * pulse + pop * 0.2;
    mapCtx.beginPath();
    mapCtx.arc(mx, my, 7.5 + pulse * 1.5 + pop * 3, 0, Math.PI * 2);
    mapCtx.stroke();
    mapCtx.globalAlpha = 1;

    // Core dot — white border then colored fill
    mapCtx.fillStyle = 'white';
    mapCtx.beginPath();
    mapCtx.arc(mx, my, 6.5 + pop * 1.5, 0, Math.PI * 2);
    mapCtx.fill();
    mapCtx.fillStyle = cl.hex;
    mapCtx.beginPath();
    mapCtx.arc(mx, my, 5 + pop * 1.5, 0, Math.PI * 2);
    mapCtx.fill();
    // White center pinpoint
    mapCtx.fillStyle = 'rgba(255,255,255,0.95)';
    mapCtx.beginPath();
    mapCtx.arc(mx, my, 2, 0, Math.PI * 2);
    mapCtx.fill();
  }

  // ----- walker -----
  let curIdx = Math.floor(Math.random() * N);
  let playing = true;
  let timer = null;
  const bubble = document.getElementById('bubble');
  const textEl = document.getElementById('text');
  const curIdxEl = document.getElementById('cur-idx');
  const curIdxEl2 = document.getElementById('cur-idx-2');
  const dotEl = document.querySelector('.bubble-head .dot');
  const clusterNameEl = document.getElementById('cur-cluster');

  // legend items
  const legendItems = CLUSTERS.map((_, k) => document.getElementById('tc-' + k));

  function hexToThreeColor(hex) {
    return parseInt(hex.replace('#', ''), 16);
  }

  function updateTrail() {
    for (let i = 0; i < TRAIL_LEN; i++) {
      const j = trailIdx[i];
      if (j == null) {
        const k2 = trailIdx.length > 0 ? trailIdx[trailIdx.length-1] : 0;
        trailPos[i*3] = X[k2]; trailPos[i*3+1] = Y[k2]; trailPos[i*3+2] = Z[k2];
        trailCol[i*3] = 0; trailCol[i*3+1] = 0; trailCol[i*3+2] = 0;
      } else {
        trailPos[i*3] = X[j]; trailPos[i*3+1] = Y[j]; trailPos[i*3+2] = Z[j];
        const fade = i / (TRAIL_LEN - 1);
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

    const k = clusterOf[i];
    const cl = CLUSTERS[k];
    const hex = cl.hex;
    const threeColor = hexToThreeColor(hex);

    // accent color for bubble + dot + leader line
    dotEl.style.setProperty('--accent', hex);
    bubble.style.setProperty('--accent', hex);

    // cursor + ring tint
    cursorMat.color.set(threeColor);
    cursorCoreMat.color.set(threeColor);
    ringMat.color.set(threeColor);

    // update index
    curIdxEl.textContent = '#' + String(DATA.points[i].idx).padStart(4, '0');
    curIdxEl2.textContent = '#' + String(DATA.points[i].idx).padStart(4, '0');

    // cluster name in bubble
    if (clusterNameEl) clusterNameEl.textContent = cl.name;
    mapLastJumpMs = performance.now();

    // legend highlight
    legendItems.forEach((el, idx) => {
      if (!el) return;
      el.classList.toggle('active', idx === k);
    });

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
    if (p.behind) { bubble.style.opacity = 0; leaderSvg.innerHTML = ''; return; }
    bubble.style.opacity = 1;

    const W = window.innerWidth, H = window.innerHeight;
    const LEGEND_W = 236; // leave room for left legend
    const bw = bubble.offsetWidth || 320;
    const bh = bubble.offsetHeight || 180;
    const PAD = 26;
    const OFF = 90;

    let placeLeft = (p.x + OFF + bw + PAD > W);
    if (placeLeft && p.x - OFF - bw < PAD + LEGEND_W) placeLeft = (W - p.x) < p.x;

    let bx = placeLeft ? p.x - OFF - bw : p.x + OFF;
    let by = p.y - bh / 2;
    bx = Math.max(PAD + LEGEND_W, Math.min(W - bw - PAD, bx));
    by = Math.max(PAD + 56, Math.min(H - bh - 90, by));

    bubble.style.left = bx + 'px';
    bubble.style.top  = by + 'px';

    const ox = placeLeft ? '100%' : '0%';
    const oy = Math.max(15, Math.min(85, ((p.y - by) / bh) * 100)) + '%';
    bubble.style.setProperty('--ox', ox);
    bubble.style.setProperty('--oy', oy);

    const edgeX = placeLeft ? bx + bw : bx;
    const edgeY = by + Math.max(15, Math.min(bh - 15, p.y - by));
    const accent = window.getComputedStyle(dotEl).getPropertyValue('background-color') || '#ff8eb6';
    const dx = edgeX - p.x;
    const cx1 = p.x + dx * 0.45, cy1 = p.y;
    const cx2 = p.x + dx * 0.55, cy2 = edgeY;
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
    const recent = new Set(trailIdx.slice(-6));
    const fresh = nbrs.filter(n => !recent.has(n));
    const pool = fresh.length > 0 ? fresh : nbrs;
    jumpTo(pool[Math.floor(Math.random() * pool.length)]);
  }
  function schedule() {
    if (timer) clearTimeout(timer);
    if (!playing) return;
    const ms = Number(document.getElementById('speed').value);
    timer = setTimeout(() => { tick(); schedule(); }, ms);
  }

  // ----- controls -----
  const playBtn = document.getElementById('btn-play');
  const icPause = document.getElementById('ic-pause');
  const icPlay  = document.getElementById('ic-play');
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
      trailIdx.pop();
      jumpTo(trailIdx.pop() ?? curIdx);
    } else { tick(); }
  });
  document.getElementById('speed').addEventListener('input', schedule);

  const raycaster = new THREE.Raycaster();
  raycaster.params.Points.threshold = 1.8;
  const mouse = new THREE.Vector2();
  canvas.addEventListener('click', (e) => {
    if (e.detail === 0) return;
    mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    const hits = raycaster.intersectObject(cloud);
    if (hits.length) jumpTo(hits[0].index);
  });

  function onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h);
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
    const pulse = 0.9 + Math.sin(t * 3.2) * 0.18;
    cursorMat.size = 14 * pulse;
    ring.scale.set(9 + Math.sin(t * 2) * 1.2, 9 + Math.sin(t * 2) * 1.2, 1);
    ring.material.rotation = t * 0.4;
    ringMat.opacity = 0.55 + Math.sin(t * 2) * 0.2;
    renderer.render(scene, camera);
    positionBubble();
    drawMap2D(t);
    requestAnimationFrame(render);
  }

  // ----- boot -----
  jumpTo(curIdx);
  for (let i = 0; i < 5; i++) { trailIdx.push(KNN[curIdx][i % KNN[curIdx].length]); }
  updateTrail();
  schedule();
  render();
})();
