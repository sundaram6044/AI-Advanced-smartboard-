/* ===================================================================
   drawing-events.js
   All pointer/touch handling — every finger tracked independently by
   its own touch ID (so multiple people can draw at once, and a stray
   second touch can't corrupt what another finger is mid-drawing), plus
   the lasso multi-select tool and the undo/redo/clear buttons.
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
// which is exactly the bug that caused shapes to vanish before.
function redrawAll(){
  redraw();
  activeGestures.forEach(g=>{
    if(g.type==='stroke') drawStroke(g.stroke);
    else if(g.type==='shape') drawShapePreviewFor(g.shapeKind, g.start, g.last, g.dashed);
    else if(g.type==='sketch3d') drawSketch3DPreview(g.points);
    else if(g.type==='lasso') drawLassoPreview(g.points);
  });
}

function drawShapePreviewFor(shapeKind, p1, p2, dashed){
  ctx.save(); ctx.strokeStyle=penStyles.pen.color; ctx.lineWidth=penStyles.pen.size;
  ctx.globalAlpha = 0.6;
  ctx.setLineDash(dashed ? [penStyles.pen.size*2.2, penStyles.pen.size*1.6] : []);
  drawGeoShape(shapeKind, p1.x,p1.y,p2.x,p2.y); ctx.restore();
}

function drawLassoPreview(points){
  if(points.length<2) return;
  ctx.save();
  ctx.strokeStyle = '#4C7FFF'; ctx.lineWidth = 2; ctx.setLineDash([6,4]);
  ctx.beginPath();
  points.forEach((pt,i)=> i===0?ctx.moveTo(pt.x,pt.y):ctx.lineTo(pt.x,pt.y));
  ctx.stroke();
  ctx.restore();
}

// ---------------- Hit-testing / bounding boxes (shared by Select and Lasso) ----------------
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
function selectionBBox(){
  if(!selectedObjects.length) return null;
  let x1=Infinity,y1=Infinity,x2=-Infinity,y2=-Infinity;
  selectedObjects.forEach(o=>{
    const bb=objectBBox(o);
    x1=Math.min(x1,bb.x1); y1=Math.min(y1,bb.y1); x2=Math.max(x2,bb.x2); y2=Math.max(y2,bb.y2);
  });
  return {x1,y1,x2,y2};
}
function pointInPolygon(pt, poly){
  let inside = false;
  for(let i=0, j=poly.length-1; i<poly.length; j=i++){
    const xi=poly[i].x, yi=poly[i].y, xj=poly[j].x, yj=poly[j].y;
    const intersect = ((yi>pt.y) !== (yj>pt.y)) && (pt.x < (xj-xi)*(pt.y-yi)/(yj-yi)+xi);
    if(intersect) inside = !inside;
  }
  return inside;
}
// An object counts as "lassoed" if any of its points (for strokes/polygons)
// or its bounding-box center (for everything else) falls inside the loop.
function objectsInLasso(loopPoints){
  return currentPage().objects.filter(o=>{
    if(o.points) return o.points.some(pt=>pointInPolygon(pt, loopPoints));
    const bb = objectBBox(o);
    return pointInPolygon({ x:(bb.x1+bb.x2)/2, y:(bb.y1+bb.y2)/2 }, loopPoints);
  });
}

// ---------------- Per-finger gesture lifecycle ----------------
function beginGesture(id, p){
  if(aiSelectMode){
    activeGestures.set(id, { type:'aiselect', start:p, last:p });
    updateAiSelectBox(p,p);
    return;
  }

  if(sketch3dMode){
    activeGestures.set(id, { type:'sketch3d', points:[p] });
    return;
  }

  if(currentTool==='lasso'){
    const bb = selectionBBox();
    if(bb && p.x>=bb.x1-10 && p.x<=bb.x2+10 && p.y>=bb.y1-10 && p.y<=bb.y2+10){
      // Starting a drag from inside the current selection moves the whole group.
      pushUndoSnapshot();
      activeGestures.set(id, { type:'groupmove', last:p });
      return;
    }
    // Otherwise, start a fresh lasso loop (replaces any existing selection on release).
    activeGestures.set(id, { type:'lasso', points:[p] });
    return;
  }

  if(currentTool==='select'){
    const obj = hitTestObject(p);
    if(obj){ pushUndoSnapshot(); activeGestures.set(id, { type:'select', obj, last:p }); }
    return;
  }

  if(['pen','brush','highlighter','marker'].includes(currentTool)){
    const st = activeStyle();
    activeGestures.set(id, { type:'stroke', stroke:{ type:'stroke', tool:currentTool, color:st.color, size:st.size,
      points:[p], alpha: currentTool==='highlighter' ? 0.35 : (currentTool==='marker' ? 0.85 : 1) } });
    return;
  }

  if(currentTool==='eraser'){
    activeGestures.set(id, { type:'eraser', snapshotted:false });
    eraseAt(p, activeGestures.get(id));
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

  if(g.type==='sketch3d'){ g.points.push(p); redrawAll(); return; }

  if(g.type==='lasso'){ g.points.push(p); redrawAll(); return; }

  if(g.type==='groupmove'){
    const dx = p.x-g.last.x, dy = p.y-g.last.y;
    selectedObjects.forEach(o=>translateObject(o, dx, dy));
    g.last = p;
    redrawAll();
    return;
  }

  if(g.type==='select'){
    const dx = p.x-g.last.x, dy = p.y-g.last.y;
    translateObject(g.obj, dx, dy);
    g.last = p;
    redrawAll();
    return;
  }

  if(g.type==='stroke'){ g.stroke.points.push(p); redrawAll(); return; }
  if(g.type==='eraser'){ eraseAt(p, g); return; }
  if(g.type==='shape'){ g.last = p; redrawAll(); return; }
}

function endGesture(id, p){
  const g = activeGestures.get(id); if(!g) return;
  activeGestures.delete(id);

  if(g.type==='aiselect'){ finishAiSelect(g.start, p); return; }

  if(g.type==='sketch3d'){
    g.points.push(p);
    redrawAll();
    handleSketch3DCapture(g.points);
    return;
  }

  if(g.type==='lasso'){
    g.points.push(p);
    if(g.points.length>3){
      selectedObjects = objectsInLasso(g.points);
      updateSelectionBar();
    }
    redrawAll();
    return;
  }

  if(g.type==='groupmove'){ refreshThumb(pageIndex); return; }

  if(g.type==='select'){ refreshThumb(pageIndex); return; }

  if(g.type==='stroke'){
    if(g.stroke.points.length>1){ pushUndoSnapshot(); currentPage().objects.push(g.stroke); }
    refreshThumb(pageIndex);
    return;
  }

  if(g.type==='shape'){
    const obj = { type:'shape', shape:g.shapeKind, color: penStyles.pen.color, size: penStyles.pen.size,
      dashed: g.dashed, x1:g.start.x, y1:g.start.y, x2:p.x, y2:p.y };
    if(Math.abs(obj.x2-obj.x1)>3 || Math.abs(obj.y2-obj.y1)>3){ pushUndoSnapshot(); currentPage().objects.push(obj); }
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
    pushUndoSnapshot();
    currentPage().objects.push({ type:'shape', shape:'polygon', color:penStyles.pen.color, size:penStyles.pen.size,
      dashed: shapeLineStyle==='dashed', points:[...polyPoints] });
    polyPoints=[]; redraw(); refreshThumb(pageIndex);
  }
});

// One undo snapshot per continuous erase drag (not per tiny erase step) —
// the gesture object's `snapshotted` flag tracks whether this drag has
// already taken its "before" picture.
function eraseAt(p, gesture){
  const r = 20; let changed=false;
  const objs = currentPage().objects;
  const survivors = objs.filter(o=>{
    if(o.type==='stroke'){
      const hit = o.points.some(pt=>Math.hypot(pt.x-p.x,pt.y-p.y)<r);
      if(hit) changed=true; return !hit;
    }
    return true;
  });
  if(changed){
    if(gesture && !gesture.snapshotted){ pushUndoSnapshot(); gesture.snapshotted = true; }
    currentPage().objects = survivors;
    redrawAll(); refreshThumb(pageIndex);
  }
}

// ---------------- Undo / Redo / Clear ----------------
document.getElementById('undoBtn').addEventListener('click', ()=>{
  if(!undoStack.length) return;
  redoStack.push(snapshotObjects(currentPage().objects));
  currentPage().objects = undoStack.pop();
  selectedObjects = []; updateSelectionBar();
  redraw(); refreshThumb(pageIndex);
});
document.getElementById('redoBtn').addEventListener('click', ()=>{
  if(!redoStack.length) return;
  undoStack.push(snapshotObjects(currentPage().objects));
  currentPage().objects = redoStack.pop();
  selectedObjects = []; updateSelectionBar();
  redraw(); refreshThumb(pageIndex);
});
document.getElementById('clearBtn').addEventListener('click', ()=>{
  if(!currentPage().objects.length) return;
  pushUndoSnapshot();
  currentPage().objects=[];
  selectedObjects = []; updateSelectionBar();
  redraw(); refreshThumb(pageIndex);
});
