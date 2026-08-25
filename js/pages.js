/* ===================================================================
   pages.js
   The page/slide strip at the bottom: add, delete, duplicate, export,
   and step through pages, plus painting each thumbnail preview.
   Edit THIS file for: multi-page behavior, thumbnails, page controls.
   =================================================================== */

const pageStrip = document.getElementById('pageStrip');
const pageThumbTrack = document.getElementById('pageThumbTrack');
const addPageBtn = document.getElementById('addPageBtn');
const prevPageBtn = document.getElementById('prevPageBtn');
const nextPageBtn = document.getElementById('nextPageBtn');
const duplicatePageBtn = document.getElementById('duplicatePageBtn');
const exportPageBtn = document.getElementById('exportPageBtn');

function renderPageStrip(){
  pageThumbTrack.querySelectorAll('.pageThumb').forEach(el=>el.remove());
  pages.forEach((pg,i)=>{
    const thumb = document.createElement('div');
    thumb.className = 'pageThumb'+(i===pageIndex?' active':'');
    const tCanvas = document.createElement('canvas'); tCanvas.width=144; tCanvas.height=96;
    thumb.appendChild(tCanvas);
    const num = document.createElement('span'); num.className='num'; num.textContent=i+1; thumb.appendChild(num);
    if(pages.length>1){
      const del = document.createElement('button'); del.className='delThumb'; del.textContent='×'; del.title='Delete page';
      del.addEventListener('click', ev=>{ ev.stopPropagation(); deletePage(i); });
      thumb.appendChild(del);
    }
    thumb.addEventListener('click', ()=> switchPage(i));
    pageThumbTrack.appendChild(thumb);
    paintThumb(i);
  });
  // keep the active thumbnail scrolled into view
  const activeThumb = pageThumbTrack.querySelectorAll('.pageThumb')[pageIndex];
  if(activeThumb && activeThumb.scrollIntoView) activeThumb.scrollIntoView({inline:'nearest', block:'nearest'});
}

function paintThumb(i){
  const thumb = pageThumbTrack.querySelectorAll('.pageThumb')[i]; if(!thumb) return;
  const tCanvas = thumb.querySelector('canvas'); const tctx = tCanvas.getContext('2d');
  const pg = pages[i]; const w=tCanvas.width, h=tCanvas.height;
  tctx.clearRect(0,0,w,h); tctx.fillStyle = pg.background.color||'#FFFFFF'; tctx.fillRect(0,0,w,h);
  if(pg.background.type==='image' && pg.background.image){
    const img=pg.background.image; const scale=Math.max(w/img.width,h/img.height);
    const iw=img.width*scale, ih=img.height*scale;
    tctx.drawImage(img,(w-iw)/2,(h-ih)/2,iw,ih);
  }
  const rw = wrap.getBoundingClientRect();
  const sx = w/(rw.width||w), sy = h/(rw.height||h);
  pg.objects.forEach(o=>{
    tctx.save(); tctx.strokeStyle=o.color; tctx.lineWidth=Math.max(1,(o.size||2)*Math.min(sx,sy)); tctx.globalAlpha=o.alpha??1;
    if(o.type==='stroke'){
      tctx.beginPath(); o.points.forEach((pt,idx)=> idx===0?tctx.moveTo(pt.x*sx,pt.y*sy):tctx.lineTo(pt.x*sx,pt.y*sy)); tctx.stroke();
    } else if(o.type==='graph'){
      tctx.beginPath(); tctx.moveTo(o.x1*sx,(o.y1+o.y2)/2*sy); tctx.lineTo(o.x2*sx,(o.y1+o.y2)/2*sy); tctx.stroke();
    } else if(o.type==='note'){
      tctx.fillStyle = o.color; tctx.font = (10*sy)+'px sans-serif';
      tctx.fillText((o.text||'').slice(0,14), o.x1*sx+2, (o.y1)*sy+10*sy);
    } else if(o.type==='model3d'){
      if(o.image) tctx.drawImage(o.image, Math.min(o.x1,o.x2)*sx, Math.min(o.y1,o.y2)*sy, Math.abs(o.x2-o.x1)*sx, Math.abs(o.y2-o.y1)*sy);
    } else if(o.shape==='polygon'){
      tctx.beginPath(); o.points.forEach((pt,idx)=> idx===0?tctx.moveTo(pt.x*sx,pt.y*sy):tctx.lineTo(pt.x*sx,pt.y*sy)); tctx.closePath(); tctx.stroke();
    } else {
      tctx.beginPath();
      const x1=o.x1*sx,y1=o.y1*sy,x2=o.x2*sx,y2=o.y2*sy;
      if(o.shape==='line'){ tctx.moveTo(x1,y1); tctx.lineTo(x2,y2); }
      else if(o.shape==='rect'){ tctx.rect(Math.min(x1,x2),Math.min(y1,y2),Math.abs(x2-x1),Math.abs(y2-y1)); }
      else if(o.shape==='circle'){ tctx.ellipse((x1+x2)/2,(y1+y2)/2,Math.abs(x2-x1)/2,Math.abs(y2-y1)/2,0,0,Math.PI*2); }
      else if(o.shape==='triangle'){ tctx.moveTo((x1+x2)/2,y1); tctx.lineTo(x1,y2); tctx.lineTo(x2,y2); tctx.closePath(); }
      tctx.stroke();
    }
    tctx.restore();
  });
}

function refreshThumb(i){ paintThumb(i); }

function switchPage(i){
  if(i===pageIndex) return;
  pageIndex=i; undoStack=[]; redoStack=[]; selectedObjects=[]; updateSelectionBar(); redraw(); drawBackground(); renderPageStrip();
}

function deletePage(i){
  if(pages.length<=1) return;
  pages.splice(i,1);
  if(pageIndex>=pages.length) pageIndex=pages.length-1; else if(i<pageIndex) pageIndex--;
  undoStack=[]; redoStack=[]; selectedObjects=[]; updateSelectionBar(); redraw(); drawBackground(); renderPageStrip();
}

addPageBtn.addEventListener('click', ()=>{
  pages.push(newPage()); pageIndex=pages.length-1;
  undoStack=[]; redoStack=[]; selectedObjects=[]; updateSelectionBar(); redraw(); drawBackground(); renderPageStrip();
});

// ---------------- Prev / Next quick navigation ----------------
prevPageBtn.addEventListener('click', ()=>{
  if(pageIndex>0) switchPage(pageIndex-1);
});
nextPageBtn.addEventListener('click', ()=>{
  if(pageIndex<pages.length-1) switchPage(pageIndex+1);
});

// ---------------- Duplicate current page ----------------
duplicatePageBtn.addEventListener('click', ()=>{
  const src = currentPage();
  const copy = {
    objects: snapshotObjects(src.objects),
    background: { ...src.background }
  };
  pages.splice(pageIndex+1, 0, copy);
  pageIndex = pageIndex+1;
  undoStack=[]; redoStack=[]; selectedObjects=[]; updateSelectionBar(); redraw(); drawBackground(); renderPageStrip();
  showToast('Page duplicated.', 2000);
});

// ---------------- Export current page as a PNG image ----------------
exportPageBtn.addEventListener('click', ()=>{
  const w = bgCanvas.width, h = bgCanvas.height;
  const out = document.createElement('canvas');
  out.width = w; out.height = h;
  const octx = out.getContext('2d');
  octx.drawImage(bgCanvas, 0, 0);
  octx.drawImage(canvas, 0, 0);
  const link = document.createElement('a');
  link.download = 'smartboard-page-' + (pageIndex+1) + '.png';
  link.href = out.toDataURL('image/png');
  link.click();
  showToast('Page saved as an image.', 2000);
});

