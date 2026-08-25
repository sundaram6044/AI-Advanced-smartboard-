/* ===================================================================
   selection.js
   The floating action bar that appears when the Lasso tool has
   something selected: Bold/Italic (applies to any selected notes),
   Delete (removes the whole group in one undo step), and Deselect.
   Edit THIS file for: what group actions are available on a selection.
   =================================================================== */

const selectionBar = document.getElementById('selectionBar');
const selectionCount = document.getElementById('selectionCount');
const selBoldBtn = document.getElementById('selBoldBtn');
const selItalicBtn = document.getElementById('selItalicBtn');
const selDeleteBtn = document.getElementById('selDeleteBtn');
const selDeselectBtn = document.getElementById('selDeselectBtn');

// Called after every lasso selection change (including "now empty") so the
// action bar and its Bold/Italic pressed-state stay in sync with reality.
function updateSelectionBar(){
  if(!selectedObjects.length){
    selectionBar.classList.remove('open');
    return;
  }
  selectionBar.classList.add('open');
  selectionCount.textContent = selectedObjects.length + (selectedObjects.length===1 ? ' item' : ' items');

  const notesInSelection = selectedObjects.filter(o=>o.type==='note');
  selBoldBtn.disabled = notesInSelection.length===0;
  selItalicBtn.disabled = notesInSelection.length===0;
  selBoldBtn.classList.toggle('active', notesInSelection.length>0 && notesInSelection.every(o=>o.bold));
  selItalicBtn.classList.toggle('active', notesInSelection.length>0 && notesInSelection.every(o=>o.italic));
}

function clearSelection(){
  selectedObjects = [];
  updateSelectionBar();
  redraw();
}

selBoldBtn.addEventListener('click', ()=>{
  const notesInSelection = selectedObjects.filter(o=>o.type==='note');
  if(!notesInSelection.length) return;
  pushUndoSnapshot();
  const makeBold = !notesInSelection.every(o=>o.bold);
  notesInSelection.forEach(o=> o.bold = makeBold);
  redraw(); refreshThumb(pageIndex); updateSelectionBar();
});

selItalicBtn.addEventListener('click', ()=>{
  const notesInSelection = selectedObjects.filter(o=>o.type==='note');
  if(!notesInSelection.length) return;
  pushUndoSnapshot();
  const makeItalic = !notesInSelection.every(o=>o.italic);
  notesInSelection.forEach(o=> o.italic = makeItalic);
  redraw(); refreshThumb(pageIndex); updateSelectionBar();
});

selDeleteBtn.addEventListener('click', ()=>{
  if(!selectedObjects.length) return;
  pushUndoSnapshot();
  const toRemove = new Set(selectedObjects);
  currentPage().objects = currentPage().objects.filter(o=>!toRemove.has(o));
  selectedObjects = [];
  updateSelectionBar();
  redraw(); refreshThumb(pageIndex);
});

selDeselectBtn.addEventListener('click', clearSelection);
