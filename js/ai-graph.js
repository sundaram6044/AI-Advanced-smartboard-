/* ===================================================================
   ai-graph.js
   The purple AI button: typing an equation (fully offline) or
   optionally scanning handwriting with a free Gemini API key.
   Edit THIS file for: equation presets, graphing behavior, the
   offline math parser, or the optional handwriting-scan feature.
   =================================================================== */

const aiFab = document.getElementById('aiFab');
const aiMenu = document.getElementById('aiMenu');
const equationInput = document.getElementById('equationInput');
const chipRow = document.getElementById('chipRow');
const plotBtn = document.getElementById('plotBtn');
const keySectionToggle = document.getElementById('keySectionToggle');
const keySection = document.getElementById('keySection');
const geminiKeyInput = document.getElementById('geminiKeyInput');
const aiEquationScanBtn = document.getElementById('aiEquationScanBtn');
const aiSelectBox = document.getElementById('aiSelectBox');

// Quick-tap equation presets — tap one to drop it into the input box
const PRESETS = ['x','x^2','x^3','sin(x)','cos(x)','sqrt(x)','1/x','e^x','log(x)','2x+3','x^2-3'];
PRESETS.forEach(p=>{
  const c = document.createElement('button'); c.className='chip'; c.textContent=p;
  c.addEventListener('click', ()=>{ equationInput.value = p; });
  chipRow.appendChild(c);
});

geminiKeyInput.addEventListener('input', e=>{ geminiKey = e.target.value.trim(); });
keySectionToggle.addEventListener('click', ()=> keySection.classList.toggle('open'));

aiFab.addEventListener('click', ()=>{ closeAllFlyouts('aiMenu'); aiMenu.classList.toggle('open'); });

// ---- Offline path: type an equation, no API needed ----
plotBtn.addEventListener('click', ()=>{
  const text = equationInput.value.trim();
  if(!text){ showToast('Type an equation first, e.g. x^2 - 3'); return; }
  try{
    pendingExprFn = compileExpr(text);
    pendingExprFn(1); // sanity check — throws if the expression is invalid
  }catch(err){ showToast('Could not understand that equation: ' + err.message, 4000); return; }
  pendingExprText = text;
  aiSelectPurpose = 'typed';
  aiMenu.classList.remove('open');
  enterAiSelectMode();
});

// ---- Optional path: scan a photo of handwriting via Gemini (needs a free key) ----
aiEquationScanBtn.addEventListener('click', ()=>{
  if(!geminiKey){ showToast('Paste your Gemini API key above first.', 3500); return; }
  aiSelectPurpose = 'ocr';
  aiMenu.classList.remove('open');
  enterAiSelectMode();
});

function enterAiSelectMode(){
  aiSelectMode = true; aiFab.classList.add('busy');
  showToast('Drag a box on the board for the graph.', 3000);
}
function exitAiSelectMode(){
  aiSelectMode = false; aiFab.classList.remove('busy'); aiSelectBox.style.display='none';
}
function updateAiSelectBox(p1,p2){
  const left=Math.min(p1.x,p2.x), top=Math.min(p1.y,p2.y), w=Math.abs(p2.x-p1.x), h=Math.abs(p2.y-p1.y);
  aiSelectBox.style.display='block';
  aiSelectBox.style.left=left+'px'; aiSelectBox.style.top=top+'px';
  aiSelectBox.style.width=w+'px'; aiSelectBox.style.height=h+'px';
}

// Crops the current page (background + strokes) inside the given box to a
// small offscreen canvas and returns it as a base64 PNG. Shared by both the
// equation-scan and notes-scan features.
function cropBoardToBase64(left, top, w, h){
  const dpr = window.devicePixelRatio||1;
  const crop = document.createElement('canvas');
  crop.width = w*dpr; crop.height = h*dpr;
  const cctx = crop.getContext('2d');
  cctx.drawImage(bgCanvas, left*dpr, top*dpr, w*dpr, h*dpr, 0,0, w*dpr, h*dpr);
  cctx.drawImage(canvas, left*dpr, top*dpr, w*dpr, h*dpr, 0,0, w*dpr, h*dpr);
  return crop.toDataURL('image/png').split(',')[1];
}

async function finishAiSelect(p1,p2){
  exitAiSelectMode();
  const left=Math.min(p1.x,p2.x), top=Math.min(p1.y,p2.y), w=Math.abs(p2.x-p1.x), h=Math.abs(p2.y-p1.y);
  if(w<20 || h<20){ showToast('Selection too small — try again.'); return; }

  if(aiSelectPurpose==='typed'){
    const obj = { type:'graph', color:'#2A5CE6', size:4, x1:left,y1:top,x2:left+w,y2:top+h, xRange:8, fn:pendingExprFn, expr:pendingExprText };
    currentPage().objects.push(obj); redoStack=[]; redraw(); refreshThumb(pageIndex);
    showToast('Plotted: y = ' + pendingExprText, 2500);
    return;
  }

  if(aiSelectPurpose==='note'){
    placeNoteObject(left, top, w, h);
    return;
  }

  if(aiSelectPurpose==='noteOcr'){
    const base64 = cropBoardToBase64(left, top, w, h);
    showToast('Reading your handwriting…', 60000);
    try{
      const text = await recognizeHandwritingText(base64);
      placeNoteObject(left, top, w, h, text);
      showToast('Recognized text added.', 2500);
    }catch(err){
      showToast('Scan failed (' + err.message + '). Try typing your note instead.', 4500);
    }
    return;
  }

  // aiSelectPurpose === 'ocr' — equation photo scan (optional, needs key)
  const base64 = cropBoardToBase64(left, top, w, h);
  showToast('Reading your equation…', 60000);
  try{
    const expr = await recognizeEquation(base64);
    const fn = compileExpr(expr);
    const obj = { type:'graph', color:'#2A5CE6', size:4, x1:left,y1:top,x2:left+w,y2:top+h, xRange:8, fn, expr };
    currentPage().objects.push(obj); redoStack=[]; redraw(); refreshThumb(pageIndex);
    showToast('Recognized: ' + expr, 3000);
  }catch(err){
    showToast('Scan failed (' + err.message + '). Try typing the equation instead.', 4500);
  }
}

// Calls Gemini's vision API. Model name may change over time —
// check aistudio.google.com for the current free-tier model id if this stops working.
async function recognizeEquation(base64Png){
  const model = 'gemini-2.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`;
  const body = { contents: [{ parts: [
    { text: 'This image shows a handwritten math equation, function of x. Reply with ONLY the right-hand side expression in plain text using ^ for powers, * for multiplication, and function names sin, cos, tan, sqrt, abs, log, ln, exp. No LaTeX, no explanation, no equals sign.' },
    { inline_data: { mime_type: 'image/png', data: base64Png } }
  ]}]};
  const res = await fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
  if(!res.ok) throw new Error('API error ' + res.status);
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if(!text) throw new Error('empty response');
  return text.trim().replace(/^[a-zA-Z()]*=\s*/,'').replace(/`/g,'');
}

// ---------- Safe offline math expression compiler (no eval, runs 100% locally) ----------
function compileExpr(exprRaw){
  let s = exprRaw.replace(/\s+/g,'');
  s = s.replace(/(\d)(x|pi|e|\()/gi, '$1*$2');
  s = s.replace(/(\))(\d|x|\(|pi|e)/gi, '$1*$2');
  let i = 0;
  function peek(){ return s[i]; }
  function eat(ch){ if(s[i]!==ch) throw new Error('expected '+ch); i++; }
  function parseExpr(){ let v=parseTerm(); while(peek()==='+'||peek()==='-'){ const op=s[i++]; const r=parseTerm(); const vv=v; v = op==='+'? (x)=>vv(x)+r(x) : (x)=>vv(x)-r(x); } return v; }
  function parseTerm(){ let v=parseUnary(); while(peek()==='*'||peek()==='/'){ const op=s[i++]; const r=parseUnary(); const vv=v; v = op==='*'? (x)=>vv(x)*r(x) : (x)=>vv(x)/r(x); } return v; }
  function parseUnary(){ if(peek()==='-'){ i++; const v=parseUnary(); return (x)=>-v(x); } return parsePow(); }
  function parsePow(){ let v=parseAtom(); if(peek()==='^'){ i++; const r=parseUnary(); const base=v; return (x)=>Math.pow(base(x), r(x)); } return v; }
  function parseAtom(){
    if(peek()==='('){ i++; const v=parseExpr(); eat(')'); return v; }
    const funcs=['sin','cos','tan','sqrt','abs','log','ln','exp'];
    for(const f of funcs){
      if(s.substr(i,f.length)===f && s[i+f.length]==='('){
        i+=f.length+1; const arg=parseExpr(); eat(')');
        switch(f){
          case 'sin': return (x)=>Math.sin(arg(x));
          case 'cos': return (x)=>Math.cos(arg(x));
          case 'tan': return (x)=>Math.tan(arg(x));
          case 'sqrt': return (x)=>Math.sqrt(arg(x));
          case 'abs': return (x)=>Math.abs(arg(x));
          case 'log': return (x)=>Math.log10(arg(x));
          case 'ln': return (x)=>Math.log(arg(x));
          case 'exp': return (x)=>Math.exp(arg(x));
        }
      }
    }
    if(s.substr(i,2)==='pi'){ i+=2; return ()=>Math.PI; }
    if(peek()==='e' && !/[a-zA-Z]/.test(s[i+1]||'')){ i++; return ()=>Math.E; }
    if(peek()==='x'){ i++; return (x)=>x; }
    let numStr='';
    while(/[0-9.]/.test(peek()||'')){ numStr+=s[i++]; }
    if(numStr==='') throw new Error('bad expression near "'+s.slice(i,i+6)+'"');
    const n=parseFloat(numStr);
    return ()=>n;
  }
  const fn = parseExpr();
  if(i < s.length) throw new Error('unexpected "'+s.slice(i)+'"');
  return fn;
}
