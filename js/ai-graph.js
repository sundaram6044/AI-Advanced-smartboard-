/* ===================================================================
   ai-graph.js
   The purple AI button's "Equation → Graph" tab: type or tap-build an
   equation using the on-screen math keypad, drag a box on the board,
   done. 100% offline — no API key, no network call, ever.
   Edit THIS file for: equation presets, the keypad, graphing behavior,
   or the offline math parser itself.
   =================================================================== */

const aiFab = document.getElementById('aiFab');
const aiMenu = document.getElementById('aiMenu');
const equationInput = document.getElementById('equationInput');
const chipRow = document.getElementById('chipRow');
const keypadGrid = document.getElementById('keypadGrid');
const plotBtn = document.getElementById('plotBtn');
const aiSelectBox = document.getElementById('aiSelectBox');

// Quick-tap equation presets — tap one to drop it straight into the input box
const PRESETS = ['x','x^2','x^3','sin(x)','cos(x)','sqrt(x)','1/x','e^x','log(x)','2x+3','x^2-3'];
PRESETS.forEach(p=>{
  const c = document.createElement('button'); c.className='chip'; c.textContent=p;
  c.addEventListener('click', ()=>{ equationInput.value = p; });
  chipRow.appendChild(c);
});

// On-screen math keypad — inserts at the cursor position rather than always
// appending at the end, so you can build up an expression naturally without
// fighting your phone's regular keyboard for symbols like ^ or √.
const KEYPAD_KEYS = [
  '7','8','9','/','(',
  '4','5','6','*',')',
  '1','2','3','-','x',
  '0','.','^','+','π',
  'sin(','cos(','tan(','√(','⌫'
];
KEYPAD_KEYS.forEach(k=>{
  const b = document.createElement('button');
  b.className = 'keypadKey';
  b.textContent = k;
  b.addEventListener('click', ()=>{
    if(k==='⌫'){ backspaceEquation(); return; }
    insertAtCursor(equationInput, k==='π' ? 'pi' : (k==='√(' ? 'sqrt(' : k));
  });
  keypadGrid.appendChild(b);
});

function insertAtCursor(input, text){
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? input.value.length;
  input.value = input.value.slice(0,start) + text + input.value.slice(end);
  const newPos = start + text.length;
  input.focus();
  input.setSelectionRange(newPos, newPos);
}
function backspaceEquation(){
  const start = equationInput.selectionStart ?? equationInput.value.length;
  const end = equationInput.selectionEnd ?? equationInput.value.length;
  if(start===end && start>0){
    equationInput.value = equationInput.value.slice(0,start-1) + equationInput.value.slice(start);
    equationInput.focus(); equationInput.setSelectionRange(start-1, start-1);
  } else if(start!==end){
    equationInput.value = equationInput.value.slice(0,start) + equationInput.value.slice(end);
    equationInput.focus(); equationInput.setSelectionRange(start, start);
  }
}

aiFab.addEventListener('click', ()=>{ closeAllFlyouts('aiMenu'); aiMenu.classList.toggle('open'); });

plotBtn.addEventListener('click', ()=>{
  const text = equationInput.value.trim();
  if(!text){ showToast('Type or tap out an equation first, e.g. x^2 - 3'); return; }
  try{
    pendingExprFn = compileExpr(text);
    pendingExprFn(1); // sanity check — throws if the expression is invalid
  }catch(err){ showToast('Could not understand that equation: ' + err.message, 4000); return; }
  pendingExprText = text;
  aiSelectPurpose = 'typed';
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

function finishAiSelect(p1,p2){
  exitAiSelectMode();
  const left=Math.min(p1.x,p2.x), top=Math.min(p1.y,p2.y), w=Math.abs(p2.x-p1.x), h=Math.abs(p2.y-p1.y);
  if(w<20 || h<20){ showToast('Selection too small — try again.'); return; }

  if(aiSelectPurpose==='note'){
    placeNoteObject(left, top, w, h);
    return;
  }

  // aiSelectPurpose === 'typed' — the only equation path, fully offline
  const obj = { type:'graph', color:'#2A5CE6', size:4, x1:left,y1:top,x2:left+w,y2:top+h, xRange:8, fn:pendingExprFn, expr:pendingExprText };
  pushUndoSnapshot();
  currentPage().objects.push(obj);
  redraw(); refreshThumb(pageIndex);
  showToast('Plotted: y = ' + pendingExprText, 2500);
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
