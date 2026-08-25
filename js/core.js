/* ===================================================================
   core.js
   Shared state + canvas setup + all drawing/rendering functions.
   This file must load FIRST — every other file uses what's defined here.
   =================================================================== */

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const bgCanvas = document.getElementById('bgCanvas');
const bgCtx = bgCanvas.getContext('2d');
const wrap = document.getElementById('canvasWrap');

// ---------- Page model ----------
// Each page holds its own strokes/shapes ("objects") and its own background.
function newPage(){ return { objects: [], background: { type:'blank', color:'#FFFFFF', image:null } }; }
let pages = [ newPage() ];
let pageIndex = 0;
function currentPage(){ return pages[pageIndex]; }

// ---------- Palettes ----------
const QUICK_COLORS = ['#111318','#E63946','#2A9D8F','#4C7FFF','#F4A300','#8E44AD','#FF6B4A','#3B3B3B','#2ECC71','#F1C40F'];
const BG_COLORS = ['#FFFFFF','#F7F3E9','#E8F0FE','#111318','#0B3D2E','#1B1F3B'];

// ---------- Tool / interaction state ----------
let currentTool = 'pen';       // pen | brush | highlighter | marker | eraser | select | lasso | shape
let currentShape = null;
let polyPoints = [];           // polygon is a tap-sequence tool, kept single-touch on purpose

// Undo/redo — snapshot-based: each entry is a full copy of the page's
// objects array from just before a change. This is what makes group
// actions (moving/deleting several lassoed objects at once, or even a
// single eraser stroke that removes several strokes) undo in ONE step
// instead of needing special-case logic per action type.
let undoStack = [];
let redoStack = [];

// Multi-select (lasso tool) — objects currently selected, by reference.
let selectedObjects = [];

// AI equation-graphing state (used by ai-graph.js) — fully offline now,
// equations are typed/keypad-entered, never scanned from a photo.
let aiSelectMode = false;
let aiSelectPurpose = 'typed'; // 'typed' (equation) or 'note' (notes text)
let pendingExprFn = null, pendingExprText = '';

// Sketch → 3D capture state (see js/sketch3d.js)
let sketch3dMode = false;

// Each pen style remembers its own last color + thickness
const penStyles = {
  pen:         { color:'#111318', size:4  },
  brush:       { color:'#111318', size:14 },
  highlighter: { color:'#FFE066', size:18 },
  marker:      { color:'#E63946', size:10 }
};
function activeStyle(){ return penStyles[currentTool] || penStyles.pen; }

// Line style applied to the NEXT shape you draw — 'solid' or 'dashed'
let shapeLineStyle = 'solid';

// Font FAMILY choices for the Notes feature — each one is then combinable
// with independent Bold and Italic toggles, so e.g. "Script" + Bold + Italic
// all apply together rather than picking one fixed preset. All built-in
// system font families, so this works with zero internet connectivity.
const NOTE_FAMILIES = [
  { id:'script', label:'Script',  css:"'Brush Script MT', cursive" },
  { id:'serif',  label:'Classic', css:"Georgia, 'Times New Roman', serif" },
  { id:'sans',   label:'Modern',  css:"'Segoe UI', Arial, sans-serif" },
  { id:'rounded',label:'Friendly',css:"ui-rounded, 'Segoe UI', sans-serif" },
  { id:'mono',   label:'Typewriter', css:"'Courier New', monospace" }
];
function findNoteFamily(id){ return NOTE_FAMILIES.find(f=>f.id===id) || NOTE_FAMILIES[1]; }
// Builds a real CSS font shorthand from a family + independent bold/italic flags.
function composeNoteFontCss(familyId, bold, italic, sizePx){
  const fam = findNoteFamily(familyId);
  return `${italic?'italic':'normal'} ${bold?'700':'400'} ${sizePx}px ${fam.css}`;
}

// ---------- Undo/redo snapshots ----------
// Deep-copies an object's coordinates/points so a snapshot is fully
// independent of the live object (moving the live one later never
// changes what's stored in the snapshot). Non-serializable bits — a
// graph's compiled function, a placed image — are pure/immutable once
// created, so it's safe (and necessary) to just share those references.
function cloneObject(o){
  const copy = { ...o };
  if(o.points) copy.points = o.points.map(pt=>({ ...pt }));
  return copy;
}
function snapshotObjects(objects){ return objects.map(cloneObject); }
function pushUndoSnapshot(){
  undoStack.push(snapshotObjects(currentPage().objects));
  if(undoStack.length>50) undoStack.shift();
  redoStack = [];
}

// ---------- Canvas sizing ----------
function resize(){
  const r = wrap.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  [canvas,bgCanvas].forEach(c=>{
    c.width = r.width*dpr; c.height = r.height*dpr;
    c.style.width = r.width+'px'; c.style.height = r.height+'px';
    c.getContext('2d').setTransform(dpr,0,0,dpr,0,0);
  });
  redraw(); drawBackground();
}
window.addEventListener('resize', resize);

// ---------- Small shared helpers ----------
function closeAllFlyouts(except){
  document.querySelectorAll('.flyout, #aiMenu').forEach(f=>{ if(f.id!==except) f.classList.remove('open'); });
}
function hideHint(){
  const h = document.getElementById('hint');
  if(h){ h.style.opacity='0'; setTimeout(()=>{ if(h.parentNode) h.remove(); },400); }
}
function showToast(msg, ms){
  const t = document.getElementById('toast');
  t.textContent = msg; t.style.display='block';
  clearTimeout(t._timer);
  t._timer = setTimeout(()=>{ t.style.display='none'; }, ms||3200);
}
function getPos(e){
  const r = canvas.getBoundingClientRect();
  const t = e.touches ? e.touches[0] : e;
  return { x: t.clientX - r.left, y: t.clientY - r.top };
}

// ---------- Background rendering ----------
function drawBackground(){
  const r = wrap.getBoundingClientRect(); const w=r.width, h=r.height;
  const bg = currentPage().background;
  bgCtx.clearRect(0,0,bgCanvas.width,bgCanvas.height);
  bgCtx.fillStyle = bg.color || '#FFFFFF'; bgCtx.fillRect(0,0,w,h);
  if(bg.type==='image' && bg.image){
    const img=bg.image; const scale=Math.max(w/img.width,h/img.height);
    const iw=img.width*scale, ih=img.height*scale;
    bgCtx.drawImage(img,(w-iw)/2,(h-ih)/2,iw,ih); return;
  }
  if(bg.type==='ruled'){
    bgCtx.strokeStyle='rgba(0,0,0,0.15)'; bgCtx.lineWidth=1;
    for(let y=32;y<h;y+=32){ bgCtx.beginPath(); bgCtx.moveTo(0,y+0.5); bgCtx.lineTo(w,y+0.5); bgCtx.stroke(); }
  } else if(bg.type==='grid'){
    bgCtx.strokeStyle='rgba(0,0,0,0.12)'; bgCtx.lineWidth=1;
    for(let x=0;x<w;x+=28){ bgCtx.beginPath(); bgCtx.moveTo(x+0.5,0); bgCtx.lineTo(x+0.5,h); bgCtx.stroke(); }
    for(let y=0;y<h;y+=28){ bgCtx.beginPath(); bgCtx.moveTo(0,y+0.5); bgCtx.lineTo(w,y+0.5); bgCtx.stroke(); }
  } else if(bg.type==='dotted'){
    bgCtx.fillStyle='rgba(0,0,0,0.25)';
    for(let x=14;x<w;x+=24){ for(let y=14;y<h;y+=24){ bgCtx.beginPath(); bgCtx.arc(x,y,1.3,0,Math.PI*2); bgCtx.fill(); } }
  }
}

// ---------- Object rendering (strokes, shapes, graphs) ----------
function drawStroke(s){
  ctx.save(); ctx.globalAlpha = s.alpha ?? 1;
  ctx.strokeStyle = s.color; ctx.lineCap='round'; ctx.lineJoin='round';
  if(s.tool==='brush' && s.points.length>1){
    // Chinese-brush style: width tapers with stroke speed (approximated by point spacing)
    for(let i=1;i<s.points.length;i++){
      const a=s.points[i-1], b=s.points[i];
      const dist = Math.hypot(b.x-a.x, b.y-a.y);
      const w = Math.max(1.5, s.size * Math.max(0.35, Math.min(1.7, 1.7 - dist*0.06)));
      ctx.lineWidth = w;
      ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke();
    }
  } else {
    ctx.lineWidth = s.size;
    ctx.beginPath();
    s.points.forEach((pt,i)=> i===0?ctx.moveTo(pt.x,pt.y):ctx.lineTo(pt.x,pt.y));
    ctx.stroke();
  }
  ctx.restore();
}

function drawShapeObj(o){
  ctx.save(); ctx.strokeStyle=o.color; ctx.lineWidth=o.size; ctx.lineJoin='round';
  ctx.setLineDash(o.dashed ? [o.size*2.2, o.size*1.6] : []);
  if(o.shape==='polygon'){
    ctx.beginPath(); o.points.forEach((pt,i)=> i===0?ctx.moveTo(pt.x,pt.y):ctx.lineTo(pt.x,pt.y)); ctx.closePath(); ctx.stroke();
  } else if(o.type==='graph'){ drawGraphObj(o);
  } else if(o.type==='note'){ drawNoteObj(o);
  } else if(o.type==='model3d'){ drawModel3DObj(o);
  } else { drawGeoShape(o.shape, o.x1,o.y1,o.x2,o.y2); }
  ctx.restore();
}

function drawGeoShape(shape,x1,y1,x2,y2){
  ctx.beginPath();
  if(shape==='line'){ ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); }
  else if(shape==='rect'){ ctx.rect(Math.min(x1,x2),Math.min(y1,y2),Math.abs(x2-x1),Math.abs(y2-y1)); }
  else if(shape==='circle'){
    const rx=Math.abs(x2-x1)/2, ry=Math.abs(y2-y1)/2, cx=(x1+x2)/2, cy=(y1+y2)/2;
    ctx.ellipse(cx,cy,Math.max(rx,1),Math.max(ry,1),0,0,Math.PI*2);
  } else if(shape==='triangle'){
    ctx.moveTo((x1+x2)/2,y1); ctx.lineTo(x1,y2); ctx.lineTo(x2,y2); ctx.closePath();
  }
  ctx.stroke();
}

// Live preview while dragging out a new shape — matches the style it will
// actually be drawn in (solid or dashed, per the Shapes panel toggle),
// just slightly transparent so it visually reads as "still in progress".
function drawShapePreview(p1,p2){
  ctx.save(); ctx.strokeStyle=penStyles.pen.color; ctx.lineWidth=penStyles.pen.size;
  ctx.globalAlpha = 0.6;
  ctx.setLineDash(shapeLineStyle==='dashed' ? [penStyles.pen.size*2.2, penStyles.pen.size*1.6] : []);
  drawGeoShape(currentShape,p1.x,p1.y,p2.x,p2.y); ctx.restore();
}

// Renders a placed Notes text object, word-wrapped inside its box, in the chosen font.
function drawNoteObj(o){
  const left = Math.min(o.x1,o.x2), top = Math.min(o.y1,o.y2);
  const w = Math.abs(o.x2-o.x1), h = Math.abs(o.y2-o.y1);
  const fontPx = Math.max(14, Math.min(40, w/14));
  ctx.save();
  ctx.fillStyle = o.color || '#111318';
  ctx.font = composeNoteFontCss(o.familyId, !!o.bold, !!o.italic, fontPx);
  ctx.textBaseline = 'top';

  const words = (o.text||'').split(/\s+/);
  const lines = [];
  let line = '';
  words.forEach(word=>{
    const test = line ? line+' '+word : word;
    if(ctx.measureText(test).width > w-8 && line){ lines.push(line); line = word; }
    else { line = test; }
  });
  if(line) lines.push(line);

  const lineHeight = fontPx*1.35;
  lines.forEach((ln,i)=>{
    const y = top + 4 + i*lineHeight;
    if(y < top+h) ctx.fillText(ln, left+4, y);
  });
  ctx.restore();
}

function drawPolygonPreview(){
  if(polyPoints.length<1) return;
  ctx.save(); ctx.strokeStyle=penStyles.pen.color; ctx.lineWidth=penStyles.pen.size; ctx.setLineDash([6,4]);
  ctx.beginPath(); polyPoints.forEach((pt,i)=> i===0?ctx.moveTo(pt.x,pt.y):ctx.lineTo(pt.x,pt.y)); ctx.stroke();
  polyPoints.forEach(pt=>{ ctx.beginPath(); ctx.fillStyle=penStyles.pen.color; ctx.arc(pt.x,pt.y,3,0,Math.PI*2); ctx.fill(); });
  ctx.restore();
}

// AI-generated function graph (axes + gridlines + curve)
function drawGraphObj(o){
  const {x1,y1,x2,y2,fn} = o;
  const left = Math.min(x1,x2), top = Math.min(y1,y2);
  const w = Math.abs(x2-x1), h = Math.abs(y2-y1);
  const originX = left + w/2, originY = top + h/2;
  const scale = Math.min(w,h) / (2*o.xRange);

  ctx.save();
  ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(left, originY); ctx.lineTo(left+w, originY); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(originX, top); ctx.lineTo(originX, top+h); ctx.stroke();
  ctx.strokeStyle = 'rgba(0,0,0,0.08)';
  for(let u=-o.xRange; u<=o.xRange; u++){
    const gx = originX + u*scale;
    if(gx>=left && gx<=left+w){ ctx.beginPath(); ctx.moveTo(gx,top); ctx.lineTo(gx,top+h); ctx.stroke(); }
    const gy = originY - u*scale;
    if(gy>=top && gy<=top+h){ ctx.beginPath(); ctx.moveTo(left,gy); ctx.lineTo(left+w,gy); ctx.stroke(); }
  }
  ctx.strokeStyle = o.color; ctx.lineWidth = Math.max(2,o.size*0.6);
  ctx.beginPath();
  let started = false;
  for(let px=0; px<=w; px++){
    const xu = (px - w/2)/scale;
    let yu; try{ yu = fn(xu); }catch(err){ yu = NaN; }
    if(!isFinite(yu)){ started=false; continue; }
    const cx = left+px, cy = originY - yu*scale;
    if(!started){ ctx.moveTo(cx,cy); started=true; } else { ctx.lineTo(cx,cy); }
  }
  ctx.stroke();
  ctx.restore();
}

// Live preview while freehand-sketching a shape for the Sketch → 3D feature.
// Drawn in the AI purple so it's visually distinct from normal pen strokes.
function drawSketch3DPreview(points){
  if(points.length<2) return;
  ctx.save();
  ctx.strokeStyle = '#8E44AD'; ctx.lineWidth = 3; ctx.lineCap='round'; ctx.lineJoin='round';
  ctx.setLineDash([8,5]);
  ctx.beginPath();
  points.forEach((pt,i)=> i===0?ctx.moveTo(pt.x,pt.y):ctx.lineTo(pt.x,pt.y));
  ctx.stroke();
  ctx.restore();
}

// A placed Sketch → 3D result: a snapshot image of the rendered 3D object,
// dropped into the board at the outline's original position.
function drawModel3DObj(o){
  if(!o.image) return;
  const left = Math.min(o.x1,o.x2), top = Math.min(o.y1,o.y2);
  const w = Math.abs(o.x2-o.x1), h = Math.abs(o.y2-o.y1);
  ctx.drawImage(o.image, left, top, w, h);
}

function redraw(){
  ctx.clearRect(0,0,canvas.width,canvas.height);
  currentPage().objects.forEach(o=>{ if(o.type==='stroke') drawStroke(o); else drawShapeObj(o); });
  drawSelectionHighlights();
}

// Dashed accent-colored box around each currently lassoed object, so it's
// obvious what's selected before you move/delete/style it.
function drawSelectionHighlights(){
  if(!selectedObjects.length) return;
  ctx.save();
  ctx.strokeStyle = '#4C7FFF'; ctx.lineWidth = 1.5; ctx.setLineDash([5,4]);
  selectedObjects.forEach(o=>{
    const bb = objectBBox(o);
    ctx.strokeRect(bb.x1-6, bb.y1-6, (bb.x2-bb.x1)+12, (bb.y2-bb.y1)+12);
  });
  ctx.restore();
}
