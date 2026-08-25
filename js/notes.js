/* ===================================================================
   notes.js
   The "Notes" tab inside the AI panel: type your notes, pick a font
   family, and independently toggle Bold/Italic — every combination is
   available, not a fixed preset list. Fully offline, no API of any kind.
   Edit THIS file for: font choices, notes placement behavior.
   =================================================================== */

const aiTabBtns = document.querySelectorAll('.aiTabBtn');
const notesInput = document.getElementById('notesInput');
const familyRow = document.getElementById('familyRow');
const noteBoldBtn = document.getElementById('noteBoldBtn');
const noteItalicBtn = document.getElementById('noteItalicBtn');
const notePreview = document.getElementById('notePreview');
const placeNoteBtn = document.getElementById('placeNoteBtn');

let selectedFamilyId = 'serif';
let noteBold = false;
let noteItalic = false;
let pendingNoteText = '';

// Tab switching across all AI panels (Equation / Notes / Sketch → 3D).
// Generic by design — each tab's data-aitab value maps to "<value>Panel".
aiTabBtns.forEach(btn=>{
  btn.addEventListener('click', ()=>{
    aiTabBtns.forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    const tab = btn.dataset.aitab;
    document.querySelectorAll('.aiTabPanel').forEach(panel=>{
      panel.classList.toggle('open', panel.id === tab+'Panel');
    });
  });
});

function refreshNotePreview(){
  const fam = findNoteFamily(selectedFamilyId);
  notePreview.style.font = `${noteItalic?'italic':'normal'} ${noteBold?'700':'400'} 15px ${fam.css}`;
}

// Build the 5 font-family swatches
NOTE_FAMILIES.forEach(f=>{
  const chip = document.createElement('button');
  chip.className = 'swatch familySwatch' + (f.id===selectedFamilyId ? ' active' : '');
  chip.style.font = `16px ${f.css}`;
  chip.textContent = 'Aa';
  chip.title = f.label;
  chip.addEventListener('click', ()=>{
    selectedFamilyId = f.id;
    document.querySelectorAll('.familySwatch').forEach(c=>c.classList.remove('active'));
    chip.classList.add('active');
    refreshNotePreview();
  });
  familyRow.appendChild(chip);
});

// Bold and Italic are independent toggles — combine with any family
noteBoldBtn.addEventListener('click', ()=>{
  noteBold = !noteBold;
  noteBoldBtn.classList.toggle('active', noteBold);
  refreshNotePreview();
});
noteItalicBtn.addEventListener('click', ()=>{
  noteItalic = !noteItalic;
  noteItalicBtn.classList.toggle('active', noteItalic);
  refreshNotePreview();
});

refreshNotePreview();

// Type notes, drag a box on the board to place them — fully offline.
placeNoteBtn.addEventListener('click', ()=>{
  const text = notesInput.value.trim();
  if(!text){ showToast('Type your notes first.'); return; }
  pendingNoteText = text;
  aiSelectPurpose = 'note';
  aiMenu.classList.remove('open');
  enterAiSelectMode();
});

function placeNoteObject(left, top, w, h){
  const obj = { type:'note', text:pendingNoteText, familyId:selectedFamilyId, bold:noteBold, italic:noteItalic,
    color: penStyles.pen.color, x1:left, y1:top, x2:left+w, y2:top+h };
  pushUndoSnapshot();
  currentPage().objects.push(obj);
  redraw(); refreshThumb(pageIndex);
  showToast('Notes added to board.', 2200);
}
