/* ===================================================================
   drawing-events.js
   All pointer/touch handling — rewritten to track EACH finger
   independently by its touch identifier (up to however many your
   screen reports, typically 10). This is what fixes two things at
   once: multiple people can draw on the board simultaneously, and a
   stray second touch (palm, another finger) can no longer corrupt or
   erase whatever the first finger was in the middle of drawing.
   Edit THIS file for: how drawing/erasing/selecting behaves, undo/redo/clear.
   =================================================================== */

// One entry per active finger/pointer. Never a single shared "currentStroke"
// global — that was the root cause of shapes disappearing when a second
// touch landed on the board.
const activeGestures = new Map();

function localPos(clientX, clientY){
  const r = canvas.getBoundingClientRect();
  return { x: clientX - r.left, y: clientY - r.top };
}

// Redraws every committed object, THEN every still-in-progress gesture
// (every finger currently drawing/dragging). Without this second part,
// only the most-recently-moved finger's stroke would survive each redraw —
// which is exactly the bug being fixed here.
function redrawAll(){
  redraw();
  activeGestures.forEach(g=>{
    if(g.type==='stroke') drawStroke(g.stroke);
    else if(g.type==='shape') drawShapePreviewFor(g.shapeKind, g.start, g.last, g.dashed);
  });
}

function drawShapePreviewFor(shapeKind, p1, p2, dashed){
  ctx.save(); ctx.strokeStyle=penStyles.pen.color; ctx.lineWidth=penStyles.pen.size;
  ctx.globalAlpha = 0.6;
  ctx.setLineDash(dashed ? [penStyles.pen.size*2.2, penStyles.pen.size*1.6] : []);
  drawGeoShape(shapeKind, p1.x,p1.y,p2.x,p2.y); ctx.restore();
}

// ---------------- Select / drag-to-move ----------------
function objectBBox(o){
  if(o.points){
    const xs=o.points.map(p=>p.x), ys=o.points.map(p=>p.y);
    return { x1:Math.min(...xs), y1:Math.min(...ys), x2:Math.max(...xs), y2:Math.max(...ys) };
  }
  return { x1:Math.min(o.x1,o.x2), y1:Math.min(o.y1,o.y2), x2:Math.max(o.x1,o.x2), y2:Math.max(o.y1,o.y2) };
}
function hitTestObject(p){
  const objs = currentPage().objects;
  const pad = 14;
  for(let i=objs.length-1; i>=0; i--){
    const o = objs[i];
    if(o.type==='stroke'){
      if(o.points.some(pt=>Math.hypot(pt.x-p.x,pt.y-p.y) < (o.size/2+pad))) return o;
      continue;
    }
    const bb = objectBBox(o);
    if(p.x>=bb.x1-pad && p.x<=bb.x2+pad && p.y>=bb.y1-pad && p.y<=bb.y2+pad) return o;
  }
  return null;
}
function translateObject(o, dx, dy){
  if(o.points){ o.points.forEach(pt=>{ pt.x+=dx; pt.y+=dy; }); }
  if(o.x1!==undefined){ o.x1+=dx; o.x2+=dx; o.y1+=dy; o.y2+=dy; }
}

// ---------------- Per-finger gesture lifecycle ----------------
function beginGesture(id, p){
  if(aiSelectMode){
    activeGestures.set(id, { type:'aiselect', start:p, last:p });
    updateAiSelectBox(p,p);
    return;
  }

  if(currentTool==='select'){
    const obj = hitTestObject(p);
    if(obj) activeGestures.set(id, { type:'select', obj, last:p });
    return;
  }

  if(['pen','brush','highlighter','marker'].includes(currentTool)){
    const st = activeStyle();
    activeGestures.set(id, { type:'stroke', stroke:{ type:'stroke', tool:currentTool, color:st.color, size:st.size,
      points:[p], alpha: currentTool==='highlighter' ? 0.35 : (currentTool==='marker' ? 0.85 : 1) } });
    return;
  }

  if(currentTool==='eraser'){
    activeGestures.set(id, { type:'eraser' });
    eraseAt(p);
    return;
  }

  if(currentTool==='shape'){
    if(currentShape==='polygon'){
      // Polygon is a tap-sequence gesture — kept single-touch on purpose.
      polyPoints.push(p); redrawAll(); drawPolygonPreview();
      return;
    }
    activeGestures.set(id, { type:'shape', shapeKind:currentShape, dashed: shapeLineStyle==='dashed', start:p, last:p });
  }
}

function moveGesture(id, p){
  const g = activeGestures.get(id); if(!g) return;

  if(g.type==='aiselect'){ g.last = p; updateAiSelectBox(g.start, p); return; }

  if(g.type==='select'){
    const dx = p.x-g.last.x, dy = p.y-g.last.y;
    translateObject(g.obj, dx, dy);
    g.last = p;
    redrawAll();
    return;
  }

  if(g.type==='stroke'){ g.stroke.points.push(p); redrawAll(); return; }
  if(g.type==='eraser'){ eraseAt(p); return; }
  if(g.type==='shape'){ g.last = p; redrawAll(); return; }
}

function endGesture(id, p){
  const g = activeGestures.get(id); if(!g) return;
  activeGestures.delete(id);

  if(g.type==='aiselect'){ finishAiSelect(g.start, p); return; }

  if(g.type==='select'){ redoStack=[]; refreshThumb(pageIndex); return; }

  if(g.type==='stroke'){
    if(g.stroke.points.length>1){ currentPage().objects.push(g.stroke); redoStack=[]; }
    refreshThumb(pageIndex);
    return;
  }

  if(g.type==='shape'){
    const obj = { type:'shape', shape:g.shapeKind, color: penStyles.pen.color, size: penStyles.pen.size,
      dashed: g.dashed, x1:g.start.x, y1:g.start.y, x2:p.x, y2:p.y };
    if(Math.abs(obj.x2-obj.x1)>3 || Math.abs(obj.y2-obj.y1)>3){ currentPage().objects.push(obj); redoStack=[]; }
    redrawAll();
    refreshThumb(pageIndex);
    return;
  }

  refreshThumb(pageIndex);
}

// ---------------- Mouse (desktop/testing) — treated as one "finger" ----------------
const MOUSE_ID = 'mouse';
canvas.addEventListener('mousedown', e=>{
  e.preventDefault(); hideHint(); if(!aiSelectMode) closeAllFlyouts();
  beginGesture(MOUSE_ID, localPos(e.clientX, e.clientY));
});
canvas.addEventListener('mousemove', e=>{
  if(!activeGestures.has(MOUSE_ID)) return; e.preventDefault();
  moveGesture(MOUSE_ID, localPos(e.clientX, e.clientY));
});
window.addEventListener('mouseup', e=>{
  if(!activeGestures.has(MOUSE_ID)) return;
  endGesture(MOUSE_ID, localPos(e.clientX, e.clientY));
});

// ---------------- Touch — every simultaneous finger tracked by its own ID ----------------
canvas.addEventListener('touchstart', e=>{
  e.preventDefault(); hideHint(); if(!aiSelectMode) closeAllFlyouts();
  for(const t of e.changedTouches){
    beginGesture(t.identifier, localPos(t.clientX, t.clientY));
  }
}, {passive:false});

canvas.addEventListener('touchmove', e=>{
  e.preventDefault();
  for(const t of e.changedTouches){
    moveGesture(t.identifier, localPos(t.clientX, t.clientY));
  }
}, {passive:false});

function handleTouchEnd(e){
  e.preventDefault();
  for(const t of e.changedTouches){
    endGesture(t.identifier, localPos(t.clientX, t.clientY));
  }
}
canvas.addEventListener('touchend', handleTouchEnd, {passive:false});
canvas.addEventListener('touchcancel', handleTouchEnd, {passive:false});

// Double-tap/click closes an in-progress polygon
canvas.addEventListener('dblclick', ()=>{
  if(currentTool==='shape' && currentShape==='polygon' && polyPoints.length>2){
    currentPage().objects.push({ type:'shape', shape:'polygon', color:penStyles.pen.color, size:penStyles.pen.size,
      dashed: shapeLineStyle==='dashed', points:[...polyPoints] });
    polyPoints=[]; redoStack=[]; redraw(); refreshThumb(pageIndex);
  }
});

function eraseAt(p){
  const r = 20; let changed=false;
  const objs = currentPage().objects;
  currentPage().objects = objs.filter(o=>{
    if(o.type==='stroke'){
      const hit = o.points.some(pt=>Math.hypot(pt.x-p.x,pt.y-p.y)<r);
      if(hit) changed=true; return !hit;
    }
    return true;
  });
  if(changed){ redoStack=[]; redrawAll(); refreshThumb(pageIndex); }
}

// ---------------- Undo / Redo / Clear ----------------
document.getElementById('undoBtn').addEventListener('click', ()=>{
  const objs = currentPage().objects;
  if(objs.length){ redoStack.push(objs.pop()); redraw(); refreshThumb(pageIndex); }
});
document.getElementById('redoBtn').addEventListener('click', ()=>{
  if(redoStack.length){ currentPage().objects.push(redoStack.pop()); redraw(); refreshThumb(pageIndex); }
});
document.getElementById('clearBtn').addEventListener('click', ()=>{
  if(!currentPage().objects.length) return;
  redoStack=[]; currentPage().objects=[]; redraw(); refreshThumb(pageIndex);
});
