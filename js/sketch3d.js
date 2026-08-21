/* ===================================================================
   sketch3d.js
   The "Sketch → 3D" tab: draw any closed freeform outline on the
   board and it gets extruded into a real, lit 3D object (via
   Three.js — vendored locally in js/vendor/, no CDN dependency) that
   you can drag to rotate, then snapshot back onto the board.
   Edit THIS file for: extrusion behavior, lighting, the 3D viewer.
   =================================================================== */

// Three.js is loaded on demand (it's ~360KB) via dynamic import — this
// keeps it out of the way until someone actually opens this feature.
// Dynamic import() in a classic (non-module) script resolves relative to
// the PAGE's URL, not this file's folder — hence the './js/...' path.
let THREE = null;
let threeLoadPromise = null;
function ensureThreeLoaded(){
  if(!threeLoadPromise){
    threeLoadPromise = import('./js/vendor/three.module.min.js').then(mod=>{ THREE = mod; return mod; });
  }
  return threeLoadPromise;
}

const startSketch3DBtn = document.getElementById('startSketch3DBtn');
const sketch3dStatus = document.getElementById('sketch3dStatus');
const sketch3dModal = document.getElementById('sketch3dModal');
const sketch3dCanvasEl = document.getElementById('sketch3dCanvas');
const sketch3dViewportWrap = document.getElementById('sketch3dViewportWrap');
const sketch3dLoading = document.getElementById('sketch3dLoading');
const extrudeDepthSlider = document.getElementById('extrudeDepthSlider');
const model3dSwatchRow = document.getElementById('model3dSwatchRow');
const cancelSketch3DBtn = document.getElementById('cancelSketch3DBtn');
const placeModel3DBtn = document.getElementById('placeModel3DBtn');

// Build the color swatch row (reuses the same palette as Pen Studio)
let model3dColor = QUICK_COLORS[3];
QUICK_COLORS.forEach(c=>{
  const b = document.createElement('button');
  b.className = 'swatch' + (c===model3dColor ? ' active' : '');
  b.style.background = c; b.dataset.color = c;
  b.addEventListener('click', ()=>{
    model3dColor = c;
    document.querySelectorAll('#model3dSwatchRow .swatch').forEach(s=>s.classList.remove('active'));
    b.classList.add('active');
    if(mesh){ mesh.material.color.set(c); renderScene(); }
  });
  model3dSwatchRow.appendChild(b);
});

startSketch3DBtn.addEventListener('click', ()=>{
  closeAllFlyouts();
  aiMenu.classList.remove('open');
  sketch3dMode = true;
  showToast('Draw a closed outline, then lift your finger.', 4000);
});

// ---------------- Douglas-Peucker simplification ----------------
// Cleans up jittery touch input before it becomes a 3D outline — fewer,
// straighter segments make for a cleaner extrusion.
function simplifyPoints(points, tolerance){
  if(points.length<3) return points;
  function perpDist(p, a, b){
    const dx=b.x-a.x, dy=b.y-a.y;
    const len = Math.hypot(dx,dy);
    if(len===0) return Math.hypot(p.x-a.x, p.y-a.y);
    const t = ((p.x-a.x)*dx + (p.y-a.y)*dy)/(len*len);
    const cx = a.x+t*dx, cy = a.y+t*dy;
    return Math.hypot(p.x-cx, p.y-cy);
  }
  function dp(pts){
    if(pts.length<3) return pts;
    let maxD=0, idx=0;
    for(let i=1;i<pts.length-1;i++){
      const d = perpDist(pts[i], pts[0], pts[pts.length-1]);
      if(d>maxD){ maxD=d; idx=i; }
    }
    if(maxD>tolerance){
      const left = dp(pts.slice(0,idx+1));
      const right = dp(pts.slice(idx));
      return left.slice(0,-1).concat(right);
    }
    return [pts[0], pts[pts.length-1]];
  }
  return dp(points);
}

// ---------------- Three.js scene state (recreated each time the modal opens) ----------------
let renderer=null, scene=null, camera=null, mesh=null;
let capturedBBox = null;
let lastPoints2D = null; // kept so the depth slider can rebuild geometry without re-sketching

function renderScene(){ if(renderer && scene && camera) renderer.render(scene, camera); }

function buildGeometry(points2D, depthUnits){
  lastPoints2D = points2D;
  const shape = new THREE.Shape(points2D);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: depthUnits, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 2, steps: 1
  });
  geo.center();
  return geo;
}

async function handleSketch3DCapture(rawPoints){
  sketch3dMode = false;

  const simplified = simplifyPoints(rawPoints, 3);
  const xs = rawPoints.map(p=>p.x), ys = rawPoints.map(p=>p.y);
  const bbW = Math.max(...xs)-Math.min(...xs), bbH = Math.max(...ys)-Math.min(...ys);

  if(simplified.length<3 || bbW<15 || bbH<15){
    showToast('That outline was too small or too simple — try drawing a bigger closed shape.', 3500);
    redraw();
    return;
  }

  capturedBBox = { x1:Math.min(...xs), y1:Math.min(...ys), x2:Math.max(...xs), y2:Math.max(...ys) };
  redraw(); // clears the purple dashed preview from the board

  sketch3dModal.classList.add('open');
  sketch3dLoading.style.display = 'flex';

  await ensureThreeLoaded();
  sketch3dLoading.style.display = 'none';

  const scale = 4 / Math.max(bbW, bbH);
  const cx = (Math.min(...xs)+Math.max(...xs))/2, cy = (Math.min(...ys)+Math.max(...ys))/2;
  const points2D = simplified.map(p => new THREE.Vector2((p.x-cx)*scale, -(p.y-cy)*scale));

  setupScene();
  const depth = parseInt(extrudeDepthSlider.value,10)/30;
  const geo = buildGeometry(points2D, depth);
  const mat = new THREE.MeshStandardMaterial({ color: model3dColor, roughness:0.45, metalness:0.08 });
  mesh = new THREE.Mesh(geo, mat);
  scene.add(mesh);
  renderScene();
}

function setupScene(){
  const w = sketch3dViewportWrap.clientWidth, h = sketch3dViewportWrap.clientHeight;
  renderer = new THREE.WebGLRenderer({ canvas: sketch3dCanvasEl, antialias:true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio||1, 2));
  renderer.setSize(w, h, false);
  renderer.setClearColor(0x0b0c0f, 1);

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(45, w/h, 0.1, 100);
  camera.position.set(0, 2.4, 6.5);
  camera.lookAt(0,0,0);

  const hemi = new THREE.HemisphereLight(0xffffff, 0x2a2a33, 1.1);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xffffff, 1.4);
  key.position.set(4, 6, 5);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0x88aaff, 0.4);
  fill.position.set(-5, -2, -4);
  scene.add(fill);
}

function teardownScene(){
  if(mesh){ mesh.geometry.dispose(); mesh.material.dispose(); }
  if(renderer){ renderer.dispose(); }
  renderer=null; scene=null; camera=null; mesh=null;
}

// ---------------- Drag to rotate ----------------
let dragging=false, lastX=0, lastY=0;
sketch3dCanvasEl.addEventListener('pointerdown', e=>{
  dragging=true; lastX=e.clientX; lastY=e.clientY;
  sketch3dCanvasEl.setPointerCapture(e.pointerId);
});
sketch3dCanvasEl.addEventListener('pointermove', e=>{
  if(!dragging || !mesh) return;
  const dx = e.clientX-lastX, dy = e.clientY-lastY;
  lastX=e.clientX; lastY=e.clientY;
  mesh.rotation.y += dx*0.008;
  mesh.rotation.x = Math.max(-1.2, Math.min(1.2, mesh.rotation.x + dy*0.008));
  renderScene();
});
sketch3dCanvasEl.addEventListener('pointerup', ()=>{ dragging=false; });
sketch3dCanvasEl.addEventListener('pointercancel', ()=>{ dragging=false; });

extrudeDepthSlider.addEventListener('input', ()=>{
  if(!mesh || !THREE || !lastPoints2D) return;
  mesh.geometry.dispose();
  const depth = parseInt(extrudeDepthSlider.value,10)/30;
  mesh.geometry = buildGeometry(lastPoints2D, depth);
  renderScene();
});

// ---------------- Cancel / Place on board ----------------
function closeSketch3DModal(){
  sketch3dModal.classList.remove('open');
  teardownScene();
  capturedBBox = null;
}

cancelSketch3DBtn.addEventListener('click', closeSketch3DModal);

placeModel3DBtn.addEventListener('click', ()=>{
  if(!renderer || !capturedBBox) return;
  renderScene();
  const dataUrl = sketch3dCanvasEl.toDataURL('image/png');
  const img = new Image();
  img.onload = ()=>{
    const obj = { type:'model3d', image:img, x1:capturedBBox.x1, y1:capturedBBox.y1, x2:capturedBBox.x2, y2:capturedBBox.y2 };
    currentPage().objects.push(obj);
    redoStack = [];
    redraw(); refreshThumb(pageIndex);
    closeSketch3DModal();
    showToast('3D object placed on the board.', 2200);
  };
  img.src = dataUrl;
});
