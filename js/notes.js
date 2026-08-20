/* ===================================================================
   notes.js
   The "Handwriting → Notes" tab inside the AI panel: pick one of 10
   offline-safe font styles, type your notes (or optionally scan
   handwriting with a Gemini key), and place it on the board.
   Edit THIS file for: font style choices, notes placement behavior.
   =================================================================== */

const aiTabBtns = document.querySelectorAll('.aiTabBtn');
const equationPanel = document.getElementById('equationPanel');
const notesPanel = document.getElementById('notesPanel');
const notesInput = document.getElementById('notesInput');
const fontGrid = document.getElementById('fontGrid');
const placeNoteBtn = document.getElementById('placeNoteBtn');
const aiNotesScanBtn = document.getElementById('aiNotesScanBtn');

let selectedFontId = 'serif';
let pendingNoteText = '';

// Tab switching between "Equation → Graph" and "Handwriting → Notes"
aiTabBtns.forEach(btn=>{
  btn.addEventListener('click', ()=>{
    aiTabBtns.forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    const tab = btn.dataset.aitab;
    equationPanel.classList.toggle('open', tab==='equation');
    notesPanel.classList.toggle('open', tab==='notes');
  });
});

// Build the 10 font-style chips, each previewing text in its own font
NOTE_FONTS.forEach((f,i)=>{
  const chip = document.createElement('button');
  chip.className = 'fontChip' + (f.id===selectedFontId ? ' active' : '');
  chip.style.font = f.css;
  chip.textContent = f.label;
  chip.addEventListener('click', ()=>{
    selectedFontId = f.id;
    document.querySelectorAll('.fontChip').forEach(c=>c.classList.remove('active'));
    chip.classList.add('active');
  });
  fontGrid.appendChild(chip);
});

// ---- Offline path: type notes directly, no API needed ----
placeNoteBtn.addEventListener('click', ()=>{
  const text = notesInput.value.trim();
  if(!text){ showToast('Type your notes first.'); return; }
  pendingNoteText = text;
  aiSelectPurpose = 'note';
  aiMenu.classList.remove('open');
  enterAiSelectMode();
});

// ---- Optional path: scan a photo of handwriting via Gemini (needs a free key) ----
aiNotesScanBtn.addEventListener('click', ()=>{
  if(!geminiKey){ showToast('Paste your Gemini API key below first.', 3500); return; }
  aiSelectPurpose = 'noteOcr';
  aiMenu.classList.remove('open');
  enterAiSelectMode();
});

// Creates the styled text object on the board. textOverride is used by the
// handwriting-scan path (recognized text); otherwise falls back to whatever
// was typed into the notes box.
function placeNoteObject(left, top, w, h, textOverride){
  const text = textOverride !== undefined ? textOverride : pendingNoteText;
  const obj = { type:'note', text, fontId:selectedFontId, color: penStyles.pen.color,
    x1:left, y1:top, x2:left+w, y2:top+h };
  currentPage().objects.push(obj);
  redoStack = []; redraw(); refreshThumb(pageIndex);
  if(textOverride===undefined) showToast('Notes added to board.', 2200);
}

// Calls Gemini's vision API to transcribe handwriting into plain text.
// Model name may change over time — check aistudio.google.com if this stops working.
async function recognizeHandwritingText(base64Png){
  const model = 'gemini-2.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`;
  const body = { contents: [{ parts: [
    { text: 'Transcribe the handwritten text in this image into clean plain text. Keep line breaks where they make sense. Reply with ONLY the transcribed text, no explanation, no formatting marks.' },
    { inline_data: { mime_type: 'image/png', data: base64Png } }
  ]}]};
  const res = await fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
  if(!res.ok) throw new Error('API error ' + res.status);
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if(!text) throw new Error('empty response');
  return text.trim();
}
