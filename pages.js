/* ===================================================================
   pages.js
   The page/slide strip at the bottom: add, delete, switch pages,
   and paint the little thumbnail preview for each one.
   Edit THIS file for: multi-page behavior, thumbnails.
   =================================================================== */

const pageStrip = document.getElementById('pageStrip');
const addPageBtn = document.getElementById('addPageBtn');

function renderPageStrip(){
  pageStrip.querySelectorAll('.pageThumb').forEach(el=>el.remove());
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
    pageStrip.insertBefore(thumb, addPageBtn);
    paintThumb(i);
  });
}

function paintThumb(i){
  const thumb = pageStrip.querySelectorAll('.pageThumb')[i]; if(!thumb) return;
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
  pageIndex=i; redoStack=[]; redraw(); drawBackground(); renderPageStrip();
}

function deletePage(i){
  if(pages.length<=1) return;
  pages.splice(i,1);
  if(pageIndex>=pages.length) pageIndex=pages.length-1; else if(i<pageIndex) pageIndex--;
  redoStack=[]; redraw(); drawBackground(); renderPageStrip();
}

addPageBtn.addEventListener('click', ()=>{
  pages.push(newPage()); pageIndex=pages.length-1;
  redoStack=[]; redraw(); drawBackground(); renderPageStrip();
});
