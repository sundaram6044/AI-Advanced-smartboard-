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
let redoStack = [];
let currentTool = 'pen';       // pen | brush | highlighter | marker | eraser | select | shape
let currentShape = null;
let drawing = false;
let currentStroke = null;
let polyPoints = [];
let startPt = null;

// AI equation-graphing state (used by ai-graph.js)
let aiSelectMode = false;
let aiSelectPurpose = 'typed'; // 'typed' or 'ocr'
let pendingExprFn = null, pendingExprText = '';
let geminiKey = '';

// Each pen style remembers its own last color + thickness
const penStyles = {
  pen:         { color:'#111318', size:4  },
  brush:       { color:'#111318', size:14 },
  highlighter: { color:'#FFE066', size:18 },
  marker:      { color:'#E63946', size:10 }
};
function activeStyle(){ return penStyles[currentTool] || penStyles.pen; }

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
  if(o.shape==='polygon'){
    ctx.beginPath(); o.points.forEach((pt,i)=> i===0?ctx.moveTo(pt.x,pt.y):ctx.lineTo(pt.x,pt.y)); ctx.closePath(); ctx.stroke();
  } else if(o.type==='graph'){ drawGraphObj(o);
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

function drawShapePreview(p1,p2){
  ctx.save(); ctx.strokeStyle=penStyles.pen.color; ctx.lineWidth=penStyles.pen.size; ctx.setLineDash([6,4]);
  drawGeoShape(currentShape,p1.x,p1.y,p2.x,p2.y); ctx.restore();
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

function redraw(){
  ctx.clearRect(0,0,canvas.width,canvas.height);
  currentPage().objects.forEach(o=>{ if(o.type==='stroke') drawStroke(o); else drawShapeObj(o); });
}
