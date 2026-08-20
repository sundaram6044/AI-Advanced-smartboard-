/* ===================================================================
   drawing-events.js
   All pointer/touch handling: drawing strokes, shapes, erasing,
   polygon closing, and the undo/redo/clear buttons.
   Edit THIS file for: how drawing/erasing behaves, undo/redo/clear.
   =================================================================== */

function pointerDown(e){
  e.preventDefault(); hideHint();
  if(!aiSelectMode) closeAllFlyouts();
  const p = getPos(e);

  if(aiSelectMode){ drawing = true; startPt = p; updateAiSelectBox(p,p); return; }

  if(['pen','brush','highlighter','marker'].includes(currentTool)){
    const st = activeStyle();
    drawing = true;
    currentStroke = { type:'stroke', tool:currentTool, color:st.color, size:st.size, points:[p],
      alpha: currentTool==='highlighter' ? 0.35 : (currentTool==='marker' ? 0.85 : 1) };
  } else if(currentTool==='eraser'){
    drawing = true; eraseAt(p);
  } else if(currentTool==='shape'){
    if(currentShape==='polygon'){ polyPoints.push(p); redraw(); drawPolygonPreview(); return; }
    drawing = true; startPt = p;
  }
}

function pointerMove(e){
  if(!drawing) return; e.preventDefault();
  const p = getPos(e);
  if(aiSelectMode){ updateAiSelectBox(startPt, p); return; }
  if(['pen','brush','highlighter','marker'].includes(currentTool)){
    currentStroke.points.push(p); redraw(); drawStroke(currentStroke);
  } else if(currentTool==='eraser'){ eraseAt(p);
  } else if(currentTool==='shape'){ redraw(); drawShapePreview(startPt,p); }
}

function pointerUp(e){
  if(!drawing) return; drawing = false;

  if(aiSelectMode){ const p = getPos(e); finishAiSelect(startPt, p); return; }

  if(['pen','brush','highlighter','marker'].includes(currentTool)){
    if(currentStroke.points.length>1){ currentPage().objects.push(currentStroke); redoStack=[]; }
    currentStroke = null;
  } else if(currentTool==='shape'){
    const p = getPos(e);
    const obj = { type:'shape', shape:currentShape, color: penStyles.pen.color, size: penStyles.pen.size, x1:startPt.x, y1:startPt.y, x2:p.x, y2:p.y };
    if(Math.abs(obj.x2-obj.x1)>3 || Math.abs(obj.y2-obj.y1)>3){ currentPage().objects.push(obj); redoStack=[]; }
    startPt = null; redraw();
  }
  refreshThumb(pageIndex);
}

canvas.addEventListener('mousedown', pointerDown);
canvas.addEventListener('mousemove', pointerMove);
window.addEventListener('mouseup', pointerUp);
canvas.addEventListener('touchstart', pointerDown, {passive:false});
canvas.addEventListener('touchmove', pointerMove, {passive:false});
canvas.addEventListener('touchend', pointerUp, {passive:false});

// Double-tap/click closes an in-progress polygon
canvas.addEventListener('dblclick', ()=>{
  if(currentTool==='shape' && currentShape==='polygon' && polyPoints.length>2){
    currentPage().objects.push({ type:'shape', shape:'polygon', color:penStyles.pen.color, size:penStyles.pen.size, points:[...polyPoints] });
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
  if(changed){ redoStack=[]; redraw(); refreshThumb(pageIndex); }
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
