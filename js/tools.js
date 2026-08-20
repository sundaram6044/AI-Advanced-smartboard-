/* ===================================================================
   tools.js
   Everything about picking a tool: Pen Studio (styles/thickness/colors),
   shape tool buttons, and the background flyout.
   Edit THIS file for: pen colors, brush thickness, background options.
   =================================================================== */

// ---------------- Pen Studio ----------------
const penStudioBtn = document.getElementById('penStudioBtn');
const penPreviewDot = document.getElementById('penPreviewDot');
const penFlyout = document.getElementById('penFlyout');
const styleRow = document.getElementById('styleRow');
const penSizeSlider = document.getElementById('penSizeSlider');
const thicknessPreviewDot = document.getElementById('thicknessPreviewDot');
const penSwatchRow = document.getElementById('penSwatchRow');
const fullColorBtn = document.getElementById('fullColorBtn');
const fullColorPicker = document.getElementById('fullColorPicker');

function refreshPenUI(){
  const st = activeStyle();
  penPreviewDot.style.background = st.color;
  const d = Math.max(6, Math.min(26, st.size));
  penPreviewDot.style.width = d+'px'; penPreviewDot.style.height = d+'px';

  thicknessPreviewDot.style.background = st.color;
  const pd = Math.max(4, Math.min(30, st.size));
  thicknessPreviewDot.style.width = pd+'px'; thicknessPreviewDot.style.height = pd+'px';
  penSizeSlider.value = st.size;

  document.querySelectorAll('#penSwatchRow .swatch').forEach(s=> s.classList.toggle('active', s.dataset.color.toLowerCase()===st.color.toLowerCase()));
}

// Build the 10 quick-tap color swatches
QUICK_COLORS.forEach(c=>{
  const b = document.createElement('button');
  b.className = 'swatch'; b.style.background = c; b.dataset.color = c;
  b.addEventListener('click', ()=>{ activeStyle().color = c; refreshPenUI(); });
  penSwatchRow.appendChild(b);
});

// Rainbow "+" button opens the native OS color picker (every color available)
fullColorBtn.addEventListener('click', ()=> fullColorPicker.click());
fullColorPicker.addEventListener('input', e=>{ activeStyle().color = e.target.value; refreshPenUI(); });

// Switch between Pen / Brush / Highlighter / Marker
styleRow.addEventListener('click', e=>{
  const btn = e.target.closest('.styleBtn'); if(!btn) return;
  currentTool = btn.dataset.style; currentShape = null;
  document.querySelectorAll('.styleBtn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  shapesBtn.classList.remove('active');
  penStudioBtn.classList.add('active');
  refreshPenUI();
  hideHint();
});

penSizeSlider.addEventListener('input', e=>{
  activeStyle().size = parseInt(e.target.value,10); refreshPenUI();
});

penStudioBtn.addEventListener('click', ()=>{
  exitAiSelectMode();
  if(!['pen','brush','highlighter','marker'].includes(currentTool)){ currentTool = 'pen'; }
  shapesBtn.classList.remove('active');
  penStudioBtn.classList.add('active');
  document.querySelectorAll('.styleBtn').forEach(b=> b.classList.toggle('active', b.dataset.style===currentTool));
  refreshPenUI();
  closeAllFlyouts('penFlyout');
  penFlyout.classList.toggle('open');
  hideHint();
});

// Eraser / Select buttons (they live in the same toolbar group as Pen Studio)
document.getElementById('drawTools').addEventListener('click', e=>{
  const btn = e.target.closest('[data-tool]'); if(!btn) return;
  exitAiSelectMode();
  currentTool = btn.dataset.tool; currentShape = null;
  document.querySelectorAll('#drawTools .tool[data-tool]').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  penStudioBtn.classList.remove('active');
  shapesBtn.classList.remove('active');
  hideHint();
});

// ---------------- Shapes (consolidated single panel) ----------------
const shapesBtn = document.getElementById('shapesBtn');
const shapesFlyout = document.getElementById('shapesFlyout');
const shapeGrid = document.getElementById('shapeGrid');
const lineStyleRow = document.getElementById('lineStyleRow');

shapesBtn.addEventListener('click', ()=>{
  exitAiSelectMode();
  closeAllFlyouts('shapesFlyout');
  shapesFlyout.classList.toggle('open');
  hideHint();
});

shapeGrid.addEventListener('click', e=>{
  const btn = e.target.closest('[data-shape]'); if(!btn) return;
  currentTool = 'shape'; currentShape = btn.dataset.shape;
  document.querySelectorAll('#shapeGrid .styleBtn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  shapesBtn.classList.add('active');
  penStudioBtn.classList.remove('active');
  document.querySelectorAll('#drawTools .tool[data-tool]').forEach(b=>b.classList.remove('active'));
  hideHint();
});

// Solid vs Dashed — applies to the next shape you draw
lineStyleRow.addEventListener('click', e=>{
  const btn = e.target.closest('[data-linestyle]'); if(!btn) return;
  shapeLineStyle = btn.dataset.linestyle;
  document.querySelectorAll('#lineStyleRow .styleBtn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
});

// ---------------- Background flyout ----------------
const bgSwatchGrid = document.getElementById('bgSwatchGrid');
BG_COLORS.forEach(c=>{
  const b = document.createElement('button'); b.className='bgSwatch'; b.style.background=c;
  b.addEventListener('click', ()=>{
    currentPage().background.color = c;
    if(currentPage().background.type==='image') currentPage().background.type='blank';
    drawBackground(); refreshThumb(pageIndex);
  });
  bgSwatchGrid.appendChild(b);
});
document.getElementById('bgBtn').addEventListener('click', ()=>{ closeAllFlyouts('bgFlyout'); document.getElementById('bgFlyout').classList.toggle('open'); });
document.querySelectorAll('.bgOption[data-bgtype]').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    currentPage().background.type = btn.dataset.bgtype; currentPage().background.image = null;
    drawBackground(); refreshThumb(pageIndex);
  });
});
const bgFileInput = document.getElementById('bgFileInput');
document.getElementById('uploadBgBtn').addEventListener('click', ()=> bgFileInput.click());
bgFileInput.addEventListener('change', e=>{
  const file = e.target.files[0]; if(!file) return;
  const reader = new FileReader();
  reader.onload = ev=>{
    const img = new Image();
    img.onload = ()=>{
      currentPage().background.type='image'; currentPage().background.image=img;
      drawBackground(); refreshThumb(pageIndex);
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file); bgFileInput.value='';
});

