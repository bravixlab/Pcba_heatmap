// ════════════════════════════════════════════
// STATE
// ════════════════════════════════════════════
let boards     = [{ id:1, name:'Board 1', comps:[], pcbImg:null, zoom:1, panX:0, panY:0 }];
let activeId   = 1;
let nextId     = 2;
function getB(){ return boards.find(b=>b.id===activeId); }

let selComp  = null;
let curTool  = 'rect';
let curColor = '#ff0000';
let showHeat = true;
let popSev   = 'H';
let filterRemark = ''; // '' = show all; any string = show only matching remarks
let editingId   = null; // null = creating new, number = editing existing comp

// View state
let zoom=1, panX=0, panY=0;

// Draw state — set when user holds left button + drags
let drawing    = false;
let drawSX=0, drawSY=0;   // screen coords where drag started
let drawCX=0, drawCY=0;   // screen coords current mouse

// Pan state (right mouse)
let panning    = false;
let panDX=0, panDY=0;

// Move state (move tool + left drag)
let moving     = false;
let moveComp   = null;
let moveSBX=0, moveSBY=0; // board coords at drag start
let moveOrigBX=0, moveOrigBY=0;

// Pending shape before popup
let pending = null;

// Mouse pos
let mX=0, mY=0;

// ════════════════════════════════════════════
// CANVAS SETUP
// ════════════════════════════════════════════
const mc    = document.getElementById('mc');
const ctx   = mc.getContext('2d');
const ov    = document.getElementById('ov');
const ovCtx = ov.getContext('2d');
const cwrap = document.getElementById('cwrap');

function resize(){
  mc.width  = ov.width  = cwrap.clientWidth;
  mc.height = ov.height = cwrap.clientHeight;
  redraw();
  drawCH();
}
window.addEventListener('resize', ()=>setTimeout(resize,50));
setTimeout(resize, 80);

// ════════════════════════════════════════════
// COORD TRANSFORMS
// Board space = image pixel coords
// screen = board * zoom + pan
// ════════════════════════════════════════════
function b2s(bx,by){ return { x:bx*zoom+panX, y:by*zoom+panY }; }
function s2b(sx,sy){ return { x:(sx-panX)/zoom, y:(sy-panY)/zoom }; }

// ════════════════════════════════════════════
// SHAPE PATH (in current ctx transform)
// ════════════════════════════════════════════
function mkPath(c2, x,y,w,h, shape){
  c2.beginPath();
  if(shape==='rect'||shape==='square'){
    c2.rect(x,y,w,h);
  } else if(shape==='circle'){
    const cx=x+w/2, cy=y+h/2;
    const rx=Math.abs(w)/2||2, ry=Math.abs(h)/2||2;
    c2.ellipse(cx,cy,rx,ry,0,0,Math.PI*2);
  } else if(shape==='diamond'){
    const cx=x+w/2, cy=y+h/2;
    c2.moveTo(cx,y); c2.lineTo(x+w,cy); c2.lineTo(cx,y+h); c2.lineTo(x,cy); c2.closePath();
  } else if(shape==='triangle'){
    c2.moveTo(x+w/2,y); c2.lineTo(x+w,y+h); c2.lineTo(x,y+h); c2.closePath();
  }
}

// ════════════════════════════════════════════
// FAIL → COLOR
// ════════════════════════════════════════════
function failColor(f, a){
  const t = Math.min(1, f/15);
  let r,g,b;
  if(t<.33){r=0;g=Math.round(t*3*180);b=220;}
  else if(t<.66){r=Math.round((t-.33)*3*255);g=200;b=0;}
  else{r=255;g=Math.round((1-(t-.66)*3)*160);b=0;}
  return a!==undefined?`rgba(${r},${g},${b},${a})`:`rgb(${r},${g},${b})`;
}

// hex or rgb color → rgba string
function hexToRgba(color, alpha){
  if(color.startsWith('#')){
    const r=parseInt(color.slice(1,3),16);
    const g=parseInt(color.slice(3,5),16);
    const b=parseInt(color.slice(5,7),16);
    return `rgba(${r},${g},${b},${alpha})`;
  }
  // already rgb/rgba — just return with alpha
  return color.replace(/[\d.]+\)$/,alpha+')');
}

// ════════════════════════════════════════════
// MAIN REDRAW
// ════════════════════════════════════════════
function redraw(){
  const W=mc.width, H=mc.height;
  ctx.clearRect(0,0,W,H);

  // background
  ctx.fillStyle='#9ea4ae';
  ctx.fillRect(0,0,W,H);

  const b = getB();

  // ── Enter board transform ──
  ctx.save();
  ctx.translate(panX, panY);
  ctx.scale(zoom, zoom);

  const BW = b.pcbImg ? b.pcbImg.naturalWidth  : W/zoom;
  const BH = b.pcbImg ? b.pcbImg.naturalHeight : H/zoom;

  // Board background
  if(b.pcbImg){
    ctx.drawImage(b.pcbImg,0,0,BW,BH);
  } else {
    ctx.fillStyle='#1a2535';
    ctx.fillRect(0,0,BW,BH);
    ctx.strokeStyle='rgba(255,255,255,.07)'; ctx.lineWidth=1;
    for(let x=0;x<BW;x+=40){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,BH);ctx.stroke();}
    for(let y=0;y<BH;y+=40){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(BW,y);ctx.stroke();}
    ctx.strokeStyle='rgba(255,255,255,.15)'; ctx.lineWidth=2; ctx.strokeRect(4,4,BW-8,BH-8);
  }

  // ── Heatmap blobs — radius grows with fails, semi-transparent to keep PCB visible ──
  if(showHeat){
    b.comps.forEach(c=>{
      // Hide if filter active and this comp doesn't match
      if(filterRemark && (c.remarks||'').toLowerCase() !== filterRemark.toLowerCase()) return;
      if(c.fails<=0) return;
      const cx=c.bx+c.bw/2, cy=c.by+c.bh/2;
      const base=Math.max(Math.abs(c.bw),Math.abs(c.bh))/2;
      const r = base + 30 + c.fails * 12;
      const g2=ctx.createRadialGradient(cx,cy,0,cx,cy,r);
      g2.addColorStop(0,   failColor(c.fails,.50));
      g2.addColorStop(.35, failColor(c.fails,.26));
      g2.addColorStop(.70, failColor(c.fails,.09));
      g2.addColorStop(1,   failColor(c.fails,0));
      ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2);
      ctx.fillStyle=g2; ctx.fill();
    });
  }

  // ── Component shapes ──
  b.comps.forEach(c=>{
    // Apply filter: hidden comps drawn ghost (very transparent) so you know they exist
    const isFiltered = filterRemark && (c.remarks||'').toLowerCase() !== filterRemark.toLowerCase();
    const isSel = selComp && selComp.id===c.id;

    ctx.save();
    if(isFiltered){
      ctx.globalAlpha = 0.12; // ghost — barely visible
    } else if(isSel){
      ctx.shadowColor='rgba(26,115,232,.8)'; ctx.shadowBlur=10/zoom;
    }

    // Fill
    const fa = c.fails===0 ? .07 : Math.min(.1+c.fails*.025,.45);
    ctx.fillStyle = failColor(c.fails, fa);
    mkPath(ctx,c.bx,c.by,c.bw,c.bh,c.shape); ctx.fill();

    // Stroke
    ctx.strokeStyle = isSel ? '#1a73e8' : (c.color||'#ff0000');
    ctx.lineWidth   = (isSel ? 2.8 : 2.2) / zoom;
    if(isSel) ctx.setLineDash([5/zoom,2.5/zoom]);
    mkPath(ctx,c.bx,c.by,c.bw,c.bh,c.shape); ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    // ── Label: REF + remarks ──
    const cx=c.bx+c.bw/2, cy=c.by+c.bh/2;
    const fs = Math.max(8, Math.min(14, Math.abs(c.bw)*0.20)) / zoom;
    ctx.textAlign='center'; ctx.textBaseline='middle';

    // REF
    ctx.font='bold '+fs+'px Share Tech Mono';
    ctx.strokeStyle='rgba(255,255,255,.95)'; ctx.lineWidth=3/zoom;
    ctx.strokeText(c.ref,cx,cy);
    ctx.fillStyle='#080808';
    ctx.fillText(c.ref,cx,cy);

    // REMARKS below ref (not fails count)
    if(c.remarks){
      const fsR = Math.max(6, fs*0.70);
      const txt = c.remarks.length>18 ? c.remarks.slice(0,17)+'…' : c.remarks;
      ctx.font = fsR+'px Share Tech Mono';
      ctx.strokeStyle='rgba(255,255,255,.9)'; ctx.lineWidth=2.5/zoom;
      ctx.strokeText(txt, cx, cy + fs*1.25);
      ctx.fillStyle='rgba(15,15,15,.88)';
      ctx.fillText(txt, cx, cy + fs*1.25);
    }

    // ── Fail badge — FIXED screen size, hidden when filtered ──
    if(c.fails>0 && !isFiltered){
      const BADGE_PX = 16;           // constant screen pixels
      const fr = BADGE_PX / zoom;    // convert to board units
      const fx = c.bx + c.bw + fr*0.3;
      const fy = c.by - fr*0.3;
      ctx.beginPath(); ctx.arc(fx,fy,fr,0,Math.PI*2);
      ctx.fillStyle='#d93025'; ctx.fill();
      ctx.strokeStyle='#fff'; ctx.lineWidth=1.5/zoom; ctx.stroke();
      ctx.font='bold '+(10/zoom)+'px Share Tech Mono';
      ctx.fillStyle='#fff'; ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillText(c.fails>99?'99+':String(c.fails), fx, fy);
    }
  });

  // ── Drawing preview ──
  if(drawing){
    const bs=s2b(drawSX,drawSY), bc=s2b(drawCX,drawCY);
    const bw=bc.x-bs.x, bh=bc.y-bs.y;
    const shape=(curTool==='move')?'rect':curTool;
    ctx.save();
    // Use the selected color — no dashed blue, just the real border color
    ctx.strokeStyle = curColor;
    ctx.lineWidth = 2.2 / zoom;
    ctx.fillStyle = curColor.replace(')', ',0.08)').replace('rgb','rgba').replace('#',
      'rgba('+parseInt(curColor.slice(1,3),16)+','+parseInt(curColor.slice(3,5),16)+','+parseInt(curColor.slice(5,7),16)+',0.08)').slice(0,999);
    // Simple fill with low alpha
    ctx.globalAlpha = 1;
    mkPath(ctx,bs.x,bs.y,bw,bh,shape);
    ctx.fillStyle = hexToRgba(curColor, 0.10);
    ctx.fill();
    mkPath(ctx,bs.x,bs.y,bw,bh,shape);
    ctx.stroke();
    ctx.restore();
  }

  ctx.restore(); // end board transform
}

// ════════════════════════════════════════════
// CROSSHAIR + ARROW OVERLAY
// ════════════════════════════════════════════
function drawCH(){
  ovCtx.clearRect(0,0,ov.width,ov.height);

  // ── Arrow from selected component → photo panel ──
  if(selComp){
    // Component center in screen coords
    const cp = b2s(selComp.bx + selComp.bw/2, selComp.by + selComp.bh/2);
    // Right edge of cwrap canvas
    const arrowEndX = ov.width - 4;
    const photoBox  = document.getElementById('photoBox');
    const cwrapRect = cwrap.getBoundingClientRect();
    const pbRect    = photoBox.getBoundingClientRect();
    // Arrow target Y = center of photoBox relative to cwrap top
    const arrowEndY = (pbRect.top + pbRect.height/2) - cwrapRect.top;

    // Clamp source point to within canvas
    const srcX = Math.max(10, Math.min(ov.width-10, cp.x));
    const srcY = Math.max(10, Math.min(ov.height-10, cp.y));

    // Draw bezier arrow — YELLOW
    ovCtx.save();
    ovCtx.setLineDash([6,3]);
    ovCtx.strokeStyle='rgba(255,210,0,.90)';
    ovCtx.lineWidth=2.5;
    const cpX=(srcX+arrowEndX)/2, cpY1=srcY, cpY2=arrowEndY;
    ovCtx.beginPath();
    ovCtx.moveTo(srcX, srcY);
    ovCtx.bezierCurveTo(cpX, cpY1, cpX, cpY2, arrowEndX, arrowEndY);
    ovCtx.stroke();
    ovCtx.setLineDash([]);

    // Arrowhead at end — yellow
    const angle = Math.atan2(arrowEndY - cpY2, arrowEndX - cpX);
    const aLen=11;
    ovCtx.beginPath();
    ovCtx.moveTo(arrowEndX, arrowEndY);
    ovCtx.lineTo(arrowEndX - aLen*Math.cos(angle-0.4), arrowEndY - aLen*Math.sin(angle-0.4));
    ovCtx.lineTo(arrowEndX - aLen*Math.cos(angle+0.4), arrowEndY - aLen*Math.sin(angle+0.4));
    ovCtx.closePath();
    ovCtx.fillStyle='rgba(255,210,0,.95)';
    ovCtx.fill();

    // Dot at component center — yellow
    ovCtx.beginPath(); ovCtx.arc(srcX, srcY, 5, 0, Math.PI*2);
    ovCtx.fillStyle='rgba(255,200,0,.8)'; ovCtx.fill();
    ovCtx.strokeStyle='rgba(0,0,0,.4)'; ovCtx.lineWidth=1.5; ovCtx.stroke();
    ovCtx.restore();
  }

  // ── Crosshair ──
  const x=mX, y=mY, g=8;
  ovCtx.save();
  ovCtx.strokeStyle='rgba(40,52,68,.5)'; ovCtx.lineWidth=1; ovCtx.setLineDash([5,4]);
  [[0,y,x-g,y],[x+g,y,ov.width,y],[x,0,x,y-g],[x,y+g,x,ov.height]].forEach(([x1,y1,x2,y2])=>{
    ovCtx.beginPath(); ovCtx.moveTo(x1,y1); ovCtx.lineTo(x2,y2); ovCtx.stroke();
  });
  ovCtx.setLineDash([]);
  ovCtx.beginPath(); ovCtx.arc(x,y,3.5,0,Math.PI*2);
  ovCtx.strokeStyle='rgba(217,48,37,.85)'; ovCtx.lineWidth=1.5; ovCtx.stroke();
  ovCtx.restore();
}

// ════════════════════════════════════════════
// HIT TEST (screen coords)
// ════════════════════════════════════════════
function hitTest(sx,sy){
  return getB().comps.slice().reverse().find(c=>{
    const p1=b2s(c.bx,c.by), p2=b2s(c.bx+c.bw,c.by+c.bh);
    const mnX=Math.min(p1.x,p2.x)-6, mxX=Math.max(p1.x,p2.x)+6;
    const mnY=Math.min(p1.y,p2.y)-6, mxY=Math.max(p1.y,p2.y)+6;
    return sx>=mnX&&sx<=mxX&&sy>=mnY&&sy<=mxY;
  });
}

// ════════════════════════════════════════════
// MOUSE EVENTS
// ════════════════════════════════════════════
function getXY(e){ const r=cwrap.getBoundingClientRect(); return [e.clientX-r.left, e.clientY-r.top]; }

cwrap.addEventListener('mousemove', e=>{
  const [sx,sy]=getXY(e);
  mX=sx; mY=sy;
  const bp=s2b(sx,sy);
  document.getElementById('xyhint').textContent='X:'+Math.round(bp.x)+' Y:'+Math.round(bp.y);
  drawCH();

  if(drawing){
    drawCX=sx; drawCY=sy;
    redraw();
  }
  if(moving && moveComp){
    const cur=s2b(sx,sy);
    moveComp.bx = moveOrigBX + (cur.x - moveSBX);
    moveComp.by = moveOrigBY + (cur.y - moveSBY);
    redraw();
  }
  if(panning){
    panX=e.clientX-panDX;
    panY=e.clientY-panDY;
    getB().panX=panX; getB().panY=panY;
    redraw();
  }
});

cwrap.addEventListener('mouseleave',()=>{ ovCtx.clearRect(0,0,ov.width,ov.height); });

// ── LEFT MOUSE DOWN ──
cwrap.addEventListener('mousedown', e=>{
  if(e.button!==0 && e.button!==2) return;

  const [sx,sy]=getXY(e);

  if(e.button===0){
    if(curTool==='move'){
      const hit=hitTest(sx,sy);
      if(hit){
        selComp=hit;
        moving=true; moveComp=hit;
        const bp=s2b(sx,sy);
        moveSBX=bp.x; moveSBY=bp.y;
        moveOrigBX=hit.bx; moveOrigBY=hit.by;
        cwrap.style.cursor='move';
        updateAll(); redraw();
      }
      return;
    }
    // DRAW START
    drawing=true;
    drawSX=drawCX=sx;
    drawSY=drawCY=sy;
    redraw();
  }

  if(e.button===2){
    e.preventDefault();
    panning=true;
    panDX=e.clientX-panX;
    panDY=e.clientY-panY;
    cwrap.style.cursor='grabbing';
  }
});

// ── LEFT MOUSE UP ──
cwrap.addEventListener('mouseup', e=>{
  if(e.button===0){
    if(moving){
      moving=false; moveComp=null;
      cwrap.style.cursor='default';
      redraw(); return;
    }
    if(drawing){
      drawing=false;
      const [sx,sy]=getXY(e);
      const bs=s2b(drawSX,drawSY), bc=s2b(sx,sy);
      const bw=bc.x-bs.x, bh=bc.y-bs.y;

      // Tiny click → try to select
      if(Math.abs(bw)<5 && Math.abs(bh)<5){
        const hit=hitTest(sx,sy);
        if(hit){ selComp=hit; updateAll(); redraw(); }
        redraw(); return;
      }

      // Valid shape → open popup
      pending={bx:bs.x, by:bs.y, bw, bh, shape:curTool, color:curColor};
      redraw();
      openPopup();
    }
  }
  if(e.button===2){
    panning=false;
    cwrap.style.cursor = curTool==='move'?'default':'crosshair';
  }
});

// WHEEL ZOOM
cwrap.addEventListener('wheel', e=>{
  e.preventDefault();
  const [sx,sy]=getXY(e);
  const f=e.deltaY<0?1.13:0.89;
  const nz=Math.max(0.05,Math.min(20,zoom*f));
  panX=sx-(sx-panX)*(nz/zoom);
  panY=sy-(sy-panY)*(nz/zoom);
  zoom=nz;
  getB().zoom=zoom; getB().panX=panX; getB().panY=panY;
  redraw();
},{passive:false});

cwrap.addEventListener('contextmenu', e=>e.preventDefault());

document.addEventListener('keydown', e=>{
  if(e.key==='Escape'){
    drawing=false; cancelPopup(); redraw();
  }
  if((e.key==='Delete'||e.key==='Backspace') && selComp && !['INPUT','TEXTAREA'].includes(document.activeElement.tagName)){
    delComp(selComp.id);
  }
});

// ════════════════════════════════════════════
// POPUP
// ════════════════════════════════════════════
function openPopup(){
  popSev='H';
  document.querySelectorAll('.sev-btn').forEach(el=>el.classList.remove('active'));
  document.querySelector('.sev-btn.H').classList.add('active');
  document.getElementById('pRef').value='';
  document.getElementById('pFails').value='0';
  document.getElementById('pTemp').value='';
  document.getElementById('pRemarks').value='';
  document.getElementById('pov').classList.add('show');
  setTimeout(()=>document.getElementById('pRef').focus(),60);
}
function closePopup(){ document.getElementById('pov').classList.remove('show'); }
function cancelPopup(){
  editingId=null;
  document.getElementById('confirmBtn').textContent='✔ CONFIRMAR';
  closePopup(); pending=null; redraw();
}

function confirmPopup(){
  const ref=document.getElementById('pRef').value.trim();
  if(!ref){ document.getElementById('pRef').focus(); toast('⚠ Informe o Reference Designator!'); return; }
  const fails=Math.max(0,parseInt(document.getElementById('pFails').value)||0);
  const rawT=document.getElementById('pTemp').value;
  const temp = rawT!=='' ? parseFloat(rawT) : Math.round(25 + fails*5.5);
  const rem=document.getElementById('pRemarks').value.trim();

  if(editingId!==null){
    const c=getB().comps.find(c=>c.id===editingId);
    if(c){ c.ref=ref; c.fails=fails; c.temp=temp; c.sev=popSev; c.remarks=rem; selComp=c; }
    editingId=null;
    document.getElementById('confirmBtn').textContent='✔ CONFIRMAR';
    closePopup(); pending=null;
    updateAll(); redraw();
    toast('✔ '+ref+' — atualizado!');
    return;
  }

  const c={
    id:Date.now(), ref, fails, temp, sev:popSev, remarks:rem,
    bx:pending.bx, by:pending.by, bw:pending.bw, bh:pending.bh,
    shape:pending.shape, color:pending.color, photo:null
  };
  getB().comps.push(c);
  selComp=c;
  closePopup();
  pending=null;
  updateAll(); redraw();
  toast('✔ '+ref+' — '+fails+' falha(s) registrada(s)');
}

function selSev(s){
  popSev=s;
  document.querySelectorAll('.sev-btn').forEach(el=>el.classList.remove('active'));
  document.querySelector('.sev-btn.'+s).classList.add('active');
}

// Enter key in popup
document.addEventListener('keydown',e=>{
  if(e.key==='Enter' && document.getElementById('pov').classList.contains('show')){
    confirmPopup();
  }
});

// ════════════════════════════════════════════
// ZOOM BUTTONS
// ════════════════════════════════════════════
function applyZoom(f){
  const cx=mc.width/2, cy=mc.height/2;
  const nz=Math.max(0.05,Math.min(20,zoom*f));
  panX=cx-(cx-panX)*(nz/zoom); panY=cy-(cy-panY)*(nz/zoom);
  zoom=nz; getB().zoom=zoom;getB().panX=panX;getB().panY=panY; redraw();
}
function zIn(){ applyZoom(1.25); }
function zOut(){ applyZoom(0.8); }
function resetV(){ zoom=1;panX=0;panY=0; getB().zoom=1;getB().panX=0;getB().panY=0; redraw(); }
function toggleHeat(){ showHeat=!showHeat; document.getElementById('tbHeat').classList.toggle('on',showHeat); redraw(); }

// ════════════════════════════════════════════
// COMPARE MODE
// ════════════════════════════════════════════
let cmpMode = false;
// Each slot holds: { img, comps, totalFails, label }
const cmpData = { A: null, B: null };

function toggleCompare(){
  cmpMode = !cmpMode;
  document.getElementById('cwrap').style.display    = cmpMode ? 'none' : '';
  document.getElementById('cmpWrap').classList.toggle('show', cmpMode);
  document.getElementById('tbCmp').classList.toggle('on', cmpMode);
  if(cmpMode){
    sizeCmpCanvases();
    renderCmpSide('A');
    renderCmpSide('B');
    updateCmpDelta();
  }
}

function sizeCmpCanvases(){
  ['A','B'].forEach(s=>{
    const side = document.getElementById('cmp'+(s==='A'?'Left':'Right'));
    const canvas = document.getElementById('cmpMc'+s);
    canvas.width  = side.clientWidth;
    canvas.height = side.clientHeight - 32; // minus label height
    canvas.style.top = '32px';
  });
}

// Capture the current board as a snapshot
function snapFromCurrent(slot){
  const b = getB();
  if(!b.pcbImg){ toast('Carregue uma imagem PCB primeiro'); return; }

  // Draw current board to an offscreen canvas → capture as dataURL
  const tmp = document.createElement('canvas');
  const side = document.getElementById('cmp'+(slot==='A'?'Left':'Right'));
  tmp.width  = side.clientWidth;
  tmp.height = side.clientHeight - 32;
  const tc = tmp.getContext('2d');

  // Draw PCB image scaled to fill
  const img = new Image();
  img.onload = ()=>{
    const scale = Math.min(tmp.width/img.width, tmp.height/img.height);
    const ox = (tmp.width  - img.width*scale)/2;
    const oy = (tmp.height - img.height*scale)/2;
    tc.drawImage(img, ox, oy, img.width*scale, img.height*scale);

    const totalFails = b.comps.reduce((a,c)=>a+c.fails,0);
    cmpData[slot] = {
      imageData: tmp.toDataURL(),
      comps: JSON.parse(JSON.stringify(b.comps)),   // deep copy
      totalFails,
      boardName: b.name,
      capturedAt: new Date().toLocaleString('pt-BR'),
      imgW: img.width, imgH: img.height,
      scale, ox, oy
    };

    document.getElementById('cmpHint'+slot).classList.add('hide');
    renderCmpSide(slot);
    updateCmpDelta();
    toast('Snapshot '+(slot==='A'?'ANTES':'DEPOIS')+' capturado!');
  };
  img.src = b.pcbImg;
}

// Load a standalone image file into a slot
function loadCmpImg(e, slot){
  const f = e.target.files[0]; if(!f) return;
  const r = new FileReader();
  r.onload = ()=>{
    const img = new Image();
    img.onload = ()=>{
      const side = document.getElementById('cmp'+(slot==='A'?'Left':'Right'));
      const w = side.clientWidth, h = side.clientHeight - 32;
      const scale = Math.min(w/img.width, h/img.height);
      const ox = (w - img.width*scale)/2;
      const oy = (h - img.height*scale)/2;
      cmpData[slot] = {
        imageData: r.result,
        comps: [],
        totalFails: 0,
        boardName: f.name,
        capturedAt: new Date().toLocaleString('pt-BR'),
        imgW: img.width, imgH: img.height,
        scale, ox, oy
      };
      document.getElementById('cmpHint'+slot).classList.add('hide');
      renderCmpSide(slot);
      updateCmpDelta();
    };
    img.src = r.result;
  };
  r.readAsDataURL(f);
  e.target.value='';
}

function renderCmpSide(slot){
  const d = cmpData[slot];
  const canvas = document.getElementById('cmpMc'+slot);
  const ctx2 = canvas.getContext('2d');
  ctx2.clearRect(0,0,canvas.width,canvas.height);
  ctx2.fillStyle='#9ea4ae';
  ctx2.fillRect(0,0,canvas.width,canvas.height);

  if(!d){ return; }

  // Draw PCB image
  const img = new Image();
  img.onload = ()=>{
    ctx2.drawImage(img, d.ox, d.oy, d.imgW*d.scale, d.imgH*d.scale);

    // Draw heatmap blobs
    if(d.comps && d.comps.length){
      d.comps.forEach(c=>{
        if(c.fails<=0) return;
        // Convert board coords → canvas coords using scale+offset
        const cx = d.ox + (c.bx + c.bw/2)*d.scale;
        const cy = d.oy + (c.by + c.bh/2)*d.scale;
        const base = Math.max(Math.abs(c.bw), Math.abs(c.bh))/2 * d.scale;
        const r = base + 20 + c.fails * 8;
        const g2 = ctx2.createRadialGradient(cx,cy,0,cx,cy,r);
        g2.addColorStop(0,   failColor(c.fails,.50));
        g2.addColorStop(.35, failColor(c.fails,.26));
        g2.addColorStop(.70, failColor(c.fails,.09));
        g2.addColorStop(1,   failColor(c.fails,0));
        ctx2.beginPath(); ctx2.arc(cx,cy,r,0,Math.PI*2);
        ctx2.fillStyle=g2; ctx2.fill();
      });

      // Draw component labels + badges
      d.comps.forEach(c=>{
        const cx = d.ox + (c.bx + c.bw/2)*d.scale;
        const cy = d.oy + (c.by + c.bh/2)*d.scale;
        const bw = Math.abs(c.bw)*d.scale;

        // Stroke shape
        ctx2.strokeStyle = c.color||'#ff0000';
        ctx2.lineWidth = 1.5;
        const bxS = d.ox + c.bx*d.scale;
        const byS = d.oy + c.by*d.scale;
        const bwS = c.bw*d.scale, bhS = c.bh*d.scale;
        ctx2.beginPath();
        ctx2.rect(bxS, byS, bwS, bhS);
        ctx2.stroke();

        // REF label
        const fs = Math.max(8, Math.min(13, bw*0.20));
        ctx2.font = 'bold '+fs+'px Share Tech Mono';
        ctx2.textAlign='center'; ctx2.textBaseline='middle';
        ctx2.strokeStyle='rgba(255,255,255,.9)'; ctx2.lineWidth=2.5;
        ctx2.strokeText(c.ref, cx, cy);
        ctx2.fillStyle='#080808';
        ctx2.fillText(c.ref, cx, cy);

        // Fail badge
        if(c.fails>0){
          const fr = 12;
          const fx = d.ox+(c.bx+c.bw)*d.scale+fr*0.3;
          const fy = d.oy+c.by*d.scale-fr*0.3;
          ctx2.beginPath(); ctx2.arc(fx,fy,fr,0,Math.PI*2);
          ctx2.fillStyle='#d93025'; ctx2.fill();
          ctx2.strokeStyle='#fff'; ctx2.lineWidth=1; ctx2.stroke();
          ctx2.font='bold 8px Share Tech Mono';
          ctx2.fillStyle='#fff';
          ctx2.fillText(c.fails>99?'99+':String(c.fails), fx, fy);
        }
      });
    }

    // Stats bar
    const statsEl = document.getElementById('cmpStats'+slot);
    const badgeEl = document.getElementById('cmpBadge'+slot);
    if(d.totalFails !== undefined){
      statsEl.style.display='flex';
      statsEl.innerHTML=`<span style="color:rgba(255,255,255,.5)">${d.boardName}</span><span>·</span><span style="color:#ff6b5b">${d.totalFails} FALHAS</span><span>·</span><span style="color:rgba(255,255,255,.5)">${d.comps.length} COMP</span>`;
      badgeEl.textContent = '📅 '+d.capturedAt;
    }
  };
  img.src = d.imageData;
}

function clearCmpSlot(slot){
  cmpData[slot] = null;
  // Clear canvas
  const canvas = document.getElementById('cmpMc'+slot);
  const ctx2 = canvas.getContext('2d');
  ctx2.clearRect(0,0,canvas.width,canvas.height);
  ctx2.fillStyle='#9ea4ae';
  ctx2.fillRect(0,0,canvas.width,canvas.height);
  // Show hint again
  document.getElementById('cmpHint'+slot).classList.remove('hide');
  // Clear badge + stats
  document.getElementById('cmpBadge'+slot).textContent='';
  const statsEl = document.getElementById('cmpStats'+slot);
  statsEl.style.display='none';
  statsEl.innerHTML='';
  // Reset file input so same file can be reloaded
  document.getElementById('fCmp'+slot).value='';
  updateCmpDelta();
  toast('Painel '+(slot==='A'?'ANTES':'DEPOIS')+' limpo!');
}

function updateCmpDelta(){
  // Compare fails between A and B — shown in both stats bars
  const a = cmpData['A'], b2 = cmpData['B'];
  if(!a || !b2) return;
  const delta = b2.totalFails - a.totalFails;
  const pct = a.totalFails > 0 ? Math.round(Math.abs(delta)/a.totalFails*100) : 0;
  const sign = delta < 0 ? '▼' : delta > 0 ? '▲' : '═';
  const cls  = delta < 0 ? 'cmp-delta-pos' : delta > 0 ? 'cmp-delta-neg' : '';
  const txt  = `<span class="${cls}">${sign} ${Math.abs(delta)} FALHAS (${pct}%)</span>`;
  ['A','B'].forEach(s=>{
    const el = document.getElementById('cmpStats'+s);
    if(el && el.style.display!=='none'){
      // Add delta after existing content
      const existing = el.innerHTML.replace(/<span class="cmp-delta.*<\/span>/g,'').replace(/·\s*$/,'');
      el.innerHTML = existing + ' · '+txt;
    }
  });
}

// Resize compare canvases on window resize
window.addEventListener('resize', ()=>{
  if(cmpMode){ setTimeout(()=>{ sizeCmpCanvases(); renderCmpSide('A'); renderCmpSide('B'); },60); }
});

// ════════════════════════════════════════════
// FILTER BY REMARKS
// ════════════════════════════════════════════
function toggleFilterDropdown(){
  const dd=document.getElementById('filterDropdown');
  const arr=document.getElementById('filterArrow');
  const isOpen=dd.classList.contains('show');
  dd.classList.toggle('show',!isOpen);
  arr.classList.toggle('open',!isOpen);
  if(!isOpen) updateFilterDropdown();
}

// Close dropdown when clicking outside
document.addEventListener('click', e=>{
  const wrap=document.getElementById('filterWrap');
  if(wrap && !wrap.contains(e.target)){
    document.getElementById('filterDropdown').classList.remove('show');
    document.getElementById('filterArrow').classList.remove('open');
  }
});

function setFilter(val){
  filterRemark = val;

  // Update button appearance
  const box=document.getElementById('filterBox');
  const lbl=document.getElementById('filterLabel');
  const badge=document.getElementById('filterBadge');
  if(val===''){
    lbl.textContent='FILTRO: TODOS';
    box.classList.remove('active-filter');
    badge.classList.remove('show');
  } else {
    lbl.textContent='⚡ '+val.toUpperCase();
    box.classList.add('active-filter');
    badge.textContent='⚡ FILTRO: '+val.toUpperCase();
    badge.classList.add('show');
  }

  // Mark active item
  document.querySelectorAll('.fdd-item').forEach(el=>{
    el.classList.toggle('active', el.dataset.val===val);
  });

  // Close dropdown
  document.getElementById('filterDropdown').classList.remove('show');
  document.getElementById('filterArrow').classList.remove('open');

  redraw(); updateList();
}

function updateFilterDropdown(){
  const comps=getB().comps;
  // Collect unique remarks (non-empty)
  const remarksMap={};
  comps.forEach(c=>{
    const r=(c.remarks||'').trim();
    if(!r) return;
    const key=r.toLowerCase();
    if(!remarksMap[key]){ remarksMap[key]={label:r, count:0, fails:0}; }
    remarksMap[key].count++;
    remarksMap[key].fails+=c.fails;
  });

  // Update "All" count
  document.getElementById('fddCountAll').textContent=comps.length+' comp';

  const container=document.getElementById('fddItems');
  const keys=Object.keys(remarksMap);
  if(!keys.length){
    container.innerHTML='<div style="padding:8px 12px;font-size:.62rem;color:var(--dim);font-family:Share Tech Mono,monospace;">Sem remarks cadastrados</div>';
    return;
  }

  // Sort by fail count desc
  keys.sort((a,b)=>remarksMap[b].fails-remarksMap[a].fails);

  container.innerHTML = keys.map(k=>{
    const rm=remarksMap[k];
    const isActive=filterRemark.toLowerCase()===k;
    // Color dot based on average fails
    const avgF=rm.fails/rm.count;
    const dotColor=failColor(avgF,1);
    return `<div class="fdd-item${isActive?' active':''}" data-val="${rm.label}" onclick="setFilter('${rm.label.replace(/'/g,"\\'")}')">
      <div class="fdd-dot" style="background:${dotColor}"></div>
      <span>${rm.label}</span>
      <span class="fdd-count">${rm.count} comp · ${rm.fails}F</span>
    </div>`;
  }).join('');
}

// ════════════════════════════════════════════
// TOOL / COLOR
// ════════════════════════════════════════════
function setTool(t){
  curTool=t;
  document.querySelectorAll('.ri').forEach(el=>{
    el.classList.toggle('active',el.dataset.tool===t);
    el.querySelector('input').checked=(el.dataset.tool===t);
  });
  const nm={rect:'RETÂNGULO',square:'QUADRADO',circle:'CÍRCULO',diamond:'LOSANGO',triangle:'TRIÂNGULO',move:'MOVER'};
  document.getElementById('mPill').textContent='MODO: '+(nm[t]||t.toUpperCase());
  cwrap.style.cursor=t==='move'?'default':'crosshair';
}
function setColor(c){
  curColor=c;
  document.querySelectorAll('.csw').forEach(el=>el.classList.toggle('active',el.dataset.c===c));
  document.getElementById('customColor').value=c.length===7?c:'#ff0000';
}

// ════════════════════════════════════════════
// PCB IMAGE
// ════════════════════════════════════════════
let _newBoard=false;
function loadPCB(e){
  const f=e.target.files[0]; if(!f) return;
  const reader=new FileReader();
  reader.onload=ri=>{
    const dataUrl=ri.target.result;
    const img=new Image();
    img.onload=()=>{
      if(_newBoard){
        _newBoard=false;
        const nb={id:nextId,name:'Board '+nextId,comps:[],pcbImg:img,pcbImgData:dataUrl,zoom:1,panX:0,panY:0};
        nextId++; boards.push(nb); activeId=nb.id;
      } else {
        getB().pcbImg=img;
        getB().pcbImgData=dataUrl;
      }
      zoom=1; panX=0; panY=0;
      document.getElementById('ohint').classList.add('hide');
      renderTabs(); redraw(); updateAll();
      toast('✔ PCB carregada!');
    };
    img.src=dataUrl;
  };
  reader.readAsDataURL(f);
  e.target.value='';
}

// ════════════════════════════════════════════
// BOARDS / TABS
// ════════════════════════════════════════════
function renderTabs(){
  const row=document.getElementById('tabRow');
  row.querySelectorAll('.tab').forEach(t=>t.remove());
  const add=row.querySelector('.tab-add');
  boards.forEach(b=>{
    const t=document.createElement('div');
    t.className='tab'+(b.id===activeId?' active':'');
    t.innerHTML='<span style="cursor:pointer" onclick="switchBoard('+b.id+')">'+b.name+'</span>'
      +(boards.length>1?'<button class="tab-close" onclick="event.stopPropagation();closeBoard('+b.id+')">✕</button>':'');
    row.insertBefore(t,add);
  });
  document.getElementById('hbBoards').textContent=boards.length+' BOARD'+(boards.length>1?'S':'');
}
function addBoardTab(){ _newBoard=true; document.getElementById('fPCB').click(); }
function switchBoard(id){
  activeId=id; const b=getB();
  zoom=b.zoom; panX=b.panX; panY=b.panY;
  selComp=null; renderTabs(); redraw(); updateAll();
}
function closeBoard(id){
  if(boards.length<=1){toast('Deve haver pelo menos 1 board');return;}
  boards=boards.filter(b=>b.id!==id);
  if(activeId===id) activeId=boards[0].id;
  const b=getB(); zoom=b.zoom;panX=b.panX;panY=b.panY;
  renderTabs(); redraw(); updateAll();
}
function clearBoard(){
  getB().comps=[]; selComp=null; updateAll(); redraw(); toast('Board limpo!');
}

// ════════════════════════════════════════════
// LIST / SELECT / DELETE
// ════════════════════════════════════════════
function updateList(){
  const el=document.getElementById('cList');
  const comps=getB().comps;
  if(!comps.length){
    el.innerHTML='<div style="color:var(--dim);font-size:.62rem;text-align:center;padding:6px;">Nenhum componente</div>';
    document.getElementById('hbFails').textContent='0 FALHAS'; return;
  }
  el.innerHTML=comps.map(c=>{
    const sel=selComp&&selComp.id===c.id;
    const filtered=filterRemark && (c.remarks||'').toLowerCase()!==filterRemark.toLowerCase();
    return `<div class="ci${sel?' sel':''}${filtered?' ci-filtered':''}" onclick="selById(${c.id})" style="${filtered?'opacity:.35':''}">
      <div class="cdot" style="background:${failColor(c.fails,1)}"></div>
      <span class="cref">${c.ref}</span>
      <span class="ctmp" style="color:${c.fails>0?'var(--red)':'var(--dim)'}">${c.fails}F</span>
      <button class="cdel" onclick="event.stopPropagation();delComp(${c.id})">✕</button>
    </div>`;
  }).join('');
  const tot=comps.reduce((a,c)=>a+c.fails,0);
  document.getElementById('hbFails').textContent=tot+' FALHA'+(tot!==1?'S':'');
}
function selById(id){ selComp=getB().comps.find(c=>c.id===id); updateAll(); redraw(); }
function delComp(id){
  getB().comps=getB().comps.filter(c=>c.id!==id);
  if(selComp&&selComp.id===id) selComp=null;
  updateAll(); redraw();
}
function clearAll(){ getB().comps=[]; selComp=null; setFilter(''); updateAll(); redraw(); toast('Tudo limpo'); }

// ════════════════════════════════════════════
// MATRIX
// ════════════════════════════════════════════
function updateMatrix(){
  const el=document.getElementById('matrixDiv');
  const comps=getB().comps;
  if(!comps.length){el.innerHTML='<div class="nosel">Sem componentes</div>';return;}
  const sorted=[...comps].sort((a,b)=>b.fails-a.fails);
  const maxF=Math.max(...sorted.map(c=>c.fails),1);
  el.innerHTML='<table class="mtbl"><thead><tr><th>COMP</th><th>FALHAS</th><th>#</th></tr></thead><tbody>'
    +sorted.map(c=>{
      const pct=c.fails/maxF*100;
      const col=failColor(c.fails,1);
      return `<tr style="cursor:pointer" onclick="selById(${c.id})">
        <td style="color:var(--accent);font-weight:700">${c.ref}</td>
        <td><div style="display:flex;align-items:center;gap:3px;"><div class="mbar"><div class="mbar-fill" style="width:${pct}%;background:${col}"></div></div></div></td>
        <td style="text-align:right;color:${col};font-weight:700">${c.fails}×</td>
      </tr>`;
    }).join('')+'</tbody></table>';
}

// ════════════════════════════════════════════
// DETAIL
// ════════════════════════════════════════════
function updateDetail(){
  const el=document.getElementById('detailDiv');
  if(!selComp){el.innerHTML='<div class="nosel">← Selecione um componente</div>';return;}
  const c=selComp;
  const sl={L:'LOW',M:'MEDIUM',H:'HIGH'}[c.sev];
  const sc={L:'var(--green)',M:'var(--yellow)',H:'var(--red)'}[c.sev];
  el.innerHTML=`<table class="dtbl"><thead><tr><th>PARÂMETRO</th><th>VALOR</th></tr></thead><tbody>
    <tr><td>Reference</td><td>${c.ref}</td></tr>
    <tr><td>Forma</td><td>${c.shape}</td></tr>
    <tr><td>Temperatura</td><td>${c.temp} °C</td></tr>
    <tr><td>Falhas</td><td style="color:${c.fails>0?'var(--red)':'var(--green)'}">${c.fails}</td></tr>
    <tr><td>Severidade</td><td style="color:${sc}">${sl}</td></tr>
    <tr><td>Remarks</td><td style="color:var(--text)">${c.remarks||'—'}</td></tr>
  </tbody></table>
  <button class="abtn abtn-blue" onclick="editComp(${c.id})" style="margin-top:6px">✏ Editar Componente</button>`;
}

// ════════════════════════════════════════════
// PHOTO
// ════════════════════════════════════════════
function updatePhoto(){
  const img    = document.getElementById('photoImg');
  const phe    = document.getElementById('phe');
  const txt    = document.getElementById('pheTxt');
  const btn    = document.getElementById('phchange');
  const info   = document.getElementById('photoInfo');
  const infoRef= document.getElementById('photoInfoRef');
  const infoRem= document.getElementById('photoInfoRem');
  const infoStats= document.getElementById('photoInfoStats');
  const sevDot = document.getElementById('photoSevDot');

  if(!selComp){
    img.style.display='none'; phe.style.display='flex'; btn.style.display='none';
    txt.innerHTML='Selecione um componente<br>para adicionar foto';
    info.classList.remove('show');
    document.getElementById('photoBox').style.borderRadius='7px';
    drawCH(); // clear arrow
    return;
  }

  // ── Fill info header ──
  const sevColors={L:'#1e9952',M:'#d4900a',H:'#d93025'};
  const sevNames ={L:'LOW',M:'MED',H:'HIGH'};
  const sc = sevColors[selComp.sev]||'#d93025';
  sevDot.style.background = sc;
  infoRef.textContent = selComp.ref;
  infoRef.style.color = '#fff';
  infoRem.textContent = selComp.remarks || '— sem descrição —';

  infoStats.innerHTML =
    `<span class="photo-stat photo-stat-red">${selComp.fails} FALHA${selComp.fails!==1?'S':''}</span>`+
    `<span class="photo-stat photo-stat-blue">${selComp.temp}°C</span>`+
    `<span class="photo-stat" style="color:${sc};border-color:${sc}44;background:${sc}22;">${sevNames[selComp.sev]||'?'}</span>`;

  info.classList.add('show');
  document.getElementById('photoBox').style.borderRadius='0 0 7px 7px';

  txt.innerHTML='Clique ou arraste foto aqui<br><small>ou Ctrl+V para colar</small>';

  if(selComp.photo){
    img.src=selComp.photo; img.style.display='block'; phe.style.display='none'; btn.style.display='block';
  } else {
    img.style.display='none'; phe.style.display='flex'; btn.style.display='none';
  }

  // Redraw overlay so arrow updates immediately when selection changes
  drawCH();
}
function clickPhoto(){ if(!selComp){toast('Selecione um componente');return;} document.getElementById('fPhoto').click(); }
function loadPhotoFile(e){
  const f=e.target.files[0]; if(!f||!selComp) return;
  const r=new FileReader();
  r.onload=()=>{selComp.photo=r.result; updatePhoto(); toast('Foto de '+selComp.ref+' salva!');};
  r.readAsDataURL(f); e.target.value='';
}
document.addEventListener('paste',e=>{
  if(document.getElementById('pov').classList.contains('show')) return;
  if(!selComp){toast('Selecione um componente para colar');return;}
  for(let i=0;i<e.clipboardData.items.length;i++){
    if(e.clipboardData.items[i].type.startsWith('image/')){
      const blob=e.clipboardData.items[i].getAsFile();
      const r=new FileReader();
      r.onload=()=>{selComp.photo=r.result; updatePhoto(); toast('Foto colada!');};
      r.readAsDataURL(blob); break;
    }
  }
});

// ════════════════════════════════════════════
// SAVE / LOAD
// ════════════════════════════════════════════
function saveProject(){
  const data={v:7,boards:boards.map(b=>({id:b.id,name:b.name,comps:b.comps,zoom:b.zoom,panX:b.panX,panY:b.panY}))};
  const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='pcba_project.json'; a.click();
  toast('Projeto salvo!');
}
function loadProject(){ document.getElementById('fProj').click(); }
function loadProjectFile(e){
  const f=e.target.files[0]; if(!f) return;
  const r=new FileReader();
  r.onload=()=>{
    try{
      const d=JSON.parse(r.result);
      if(d.boards){
        boards=d.boards.map(b=>({...b,pcbImg:null}));
        activeId=boards[0].id;
        const b=getB(); zoom=b.zoom;panX=b.panX;panY=b.panY;
      }
      renderTabs(); redraw(); updateAll(); toast('Projeto carregado!');
    }catch(ex){toast('Erro ao carregar');}
  };
  r.readAsText(f); e.target.value='';
}

// ════════════════════════════════════════════
// EXPORT
// ════════════════════════════════════════════
function exportCSV(){
  const cs=getB().comps;
  if(!cs.length){toast('Sem componentes');return;}
  const h='Reference,Forma,Temp,Falhas,Sev,Remarks';
  const rows=cs.map(c=>[c.ref,c.shape,c.temp,c.fails,c.sev,'"'+(c.remarks||'')+'"'].join(','));
  const blob=new Blob([[h,...rows].join('\n')],{type:'text/csv'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='pcba.csv'; a.click();
  toast('CSV exportado!');
}
function exportPNG(){
  const a=document.createElement('a'); a.href=mc.toDataURL('image/png'); a.download='pcba_heatmap.png'; a.click();
  toast('PNG exportado!');
}

// ════════════════════════════════════════════
// UTILS
// ════════════════════════════════════════════
function toast(msg){ const t=document.getElementById('toast'); t.textContent=msg; t.classList.add('show'); setTimeout(()=>t.classList.remove('show'),2800); }
function updateAll(){ updateList(); updateMatrix(); updateDetail(); updatePhoto(); updateFilterDropdown(); }

// ════════════════════════════════════════════
// EDIT EXISTING COMPONENT
// ════════════════════════════════════════════
function editComp(id){
  const c=getB().comps.find(c=>c.id===id);
  if(!c) return;
  editingId=id;
  popSev=c.sev;
  document.querySelectorAll('.sev-btn').forEach(el=>el.classList.remove('active'));
  document.querySelector('.sev-btn.'+popSev).classList.add('active');
  document.getElementById('pRef').value=c.ref;
  document.getElementById('pFails').value=c.fails;
  document.getElementById('pTemp').value=c.temp;
  document.getElementById('pRemarks').value=c.remarks||'';
  document.getElementById('confirmBtn').textContent='✔ ATUALIZAR';
  document.getElementById('pov').classList.add('show');
  setTimeout(()=>document.getElementById('pRef').focus(),60);
}

// ════════════════════════════════════════════
// CSV IMPORT
// ════════════════════════════════════════════
function parseCSVLine(line){
  const res=[]; let cur='', inQ=false;
  for(const ch of line){
    if(ch==='"'){ inQ=!inQ; }
    else if(ch===','&&!inQ){ res.push(cur); cur=''; }
    else{ cur+=ch; }
  }
  res.push(cur); return res;
}

function importCSV(e){
  const f=e.target.files[0]; if(!f) return;
  const r=new FileReader();
  r.onload=()=>{
    const lines=r.result.trim().split(/\r?\n/);
    if(!lines.length){ toast('CSV vazio'); return; }
    let startRow=0;
    const h=lines[0].toLowerCase();
    if(h.includes('ref')||h.includes('falha')||h.includes('remark')){ startRow=1; }
    let count=0;
    const b=getB();
    const colorMap={L:'#00cc44',M:'#ffff00',H:'#ff0000'};
    for(let i=startRow;i<lines.length;i++){
      const line=lines[i].trim(); if(!line) continue;
      const cols=parseCSVLine(line);
      const ref=(cols[0]||'').trim().replace(/^"|"$/g,''); if(!ref) continue;
      const fails=Math.max(0,parseInt(cols[1])||0);
      const remarks=(cols[2]||'').trim().replace(/^"|"$/g,'');
      const temp=cols[3]?parseFloat(cols[3]):Math.round(25+fails*5.5);
      const rawSev=(cols[4]||'H').trim().toUpperCase();
      const sev=['L','M','H'].includes(rawSev)?rawSev:'H';
      b.comps.push({
        id:Date.now()+count, ref, fails, temp, sev, remarks,
        bx:30, by:30+count*70, bw:90, bh:38,
        shape:'rect', color:colorMap[sev]||'#ff0000', photo:null
      });
      count++;
    }
    if(!count){ toast('Nenhum componente válido encontrado no CSV'); return; }
    selComp=null; updateAll(); redraw(); setTool('move');
    toast('✔ '+count+' componentes importados! Use Mover para posicionar.');
  };
  r.readAsText(f,'UTF-8');
  e.target.value='';
}

// ════════════════════════════════════════════
// PUBLISH — publica no GitHub Pages via API
// ════════════════════════════════════════════
function publishProject(){
  const b=getB();
  if(!b.pcbImgData){ toast('⚠ Carregue uma imagem PCB antes de publicar'); return; }
  if(!b.comps.length){ toast('⚠ Adicione ao menos um componente'); return; }
  const saved=localStorage.getItem('gh_pub_token')||'';
  if(saved){
    // Token já salvo → publica direto sem modal
    doPublishWithToken(saved);
  } else {
    // Primeira vez → pede o token
    document.getElementById('pubToken').value='';
    document.getElementById('pubModal').classList.add('show');
  }
}

async function doPublishWithToken(token){
  toast('⏳ Publicando relatório...');
  const b=getB();
  const data={
    boardName:b.name,
    exportedAt:new Date().toLocaleString('pt-BR'),
    comps:JSON.parse(JSON.stringify(b.comps)),
    pcbImg:b.pcbImgData
  };
  const html=generateViewerHTML(data);
  try{
    await pushReportToGitHub(html,token);
  }catch(err){
    toast('❌ '+err.message);
    // Token inválido → remove e pede novo
    localStorage.removeItem('gh_pub_token');
    document.getElementById('pubToken').value='';
    document.getElementById('pubModal').classList.add('show');
  }
}

function closePubModal(){
  document.getElementById('pubModal').classList.remove('show');
  document.getElementById('confirmPubBtn').textContent='📤 PUBLICAR';
  document.getElementById('confirmPubBtn').disabled=false;
}

async function doPublish(){
  const token=document.getElementById('pubToken').value.trim();
  if(!token){ toast('⚠ Informe o GitHub Token'); return; }
  localStorage.setItem('gh_pub_token',token);

  const btn=document.getElementById('confirmPubBtn');
  btn.textContent='⏳ Publicando...'; btn.disabled=true;

  const b=getB();
  const data={
    boardName:b.name,
    exportedAt:new Date().toLocaleString('pt-BR'),
    comps:JSON.parse(JSON.stringify(b.comps)),
    pcbImg:b.pcbImgData
  };
  const html=generateViewerHTML(data);

  try{
    await pushReportToGitHub(html,token);
  }catch(err){
    toast('❌ '+err.message);
    btn.textContent='📤 PUBLICAR'; btn.disabled=false;
  }
}

function encodeToBase64(str){
  const bytes=new TextEncoder().encode(str);
  const chunks=[];
  for(let i=0;i<bytes.length;i+=8192){
    chunks.push(String.fromCharCode(...bytes.subarray(i,Math.min(i+8192,bytes.length))));
  }
  return btoa(chunks.join(''));
}

async function pushReportToGitHub(html,token){
  const repo='bravixlab/Pcba_heatmap';
  const filename='report.html';
  const apiUrl='https://api.github.com/repos/'+repo+'/contents/'+filename;
  const headers={'Authorization':'token '+token,'Content-Type':'application/json'};

  // Get current SHA if file exists (needed for update)
  let sha=null;
  try{
    const r=await fetch(apiUrl,{headers});
    if(r.ok){ const d=await r.json(); sha=d.sha; }
  }catch(e){}

  const body={
    message:'Relatório PCBA publicado em '+new Date().toLocaleString('pt-BR'),
    content:encodeToBase64(html),
    branch:'main'
  };
  if(sha) body.sha=sha;

  const res=await fetch(apiUrl,{method:'PUT',headers,body:JSON.stringify(body)});
  const result=await res.json();

  if(!res.ok){
    if((result.message||'').includes('Bad credentials')){
      localStorage.removeItem('gh_pub_token');
      throw new Error('Token inválido. Gere um novo e tente novamente.');
    }
    throw new Error(result.message||'Falha ao publicar. Tente novamente.');
  }

  closePubModal();
  const url='https://bravixlab.github.io/Pcba_heatmap/'+filename;
  showPublishSuccess(url);
}

function showPublishSuccess(url){
  document.getElementById('successUrl').textContent=url;
  document.getElementById('successModal').classList.add('show');
}

function closeSuccessModal(){
  document.getElementById('successModal').classList.remove('show');
}

function copyReportUrl(){
  const url=document.getElementById('successUrl').textContent;
  navigator.clipboard.writeText(url).then(()=>toast('✅ Link copiado!'));
}

function generateViewerHTML(data){
  const dj=JSON.stringify(data);
  const tot=data.comps.reduce(function(a,c){return a+c.fails;},0);
  const nc=data.comps.length;
  return '<!DOCTYPE html>\n<html lang="pt-BR">\n<head>\n<meta charset="UTF-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n<title>PCBA Report — '+data.boardName+'</title>\n<link href="https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Rajdhani:wght@400;600;700&display=swap" rel="stylesheet">\n<style>\n:root{--bg:#0d1117;--panel:#141c26;--border:rgba(255,255,255,.09);--text:#d0d8e4;--dim:#5a6a7e;--red:#d93025;--green:#1e9952;--yellow:#d4900a;--accent:#4ea6ff;--hdr:#070c14}\n*{box-sizing:border-box;margin:0;padding:0}\nbody{background:var(--bg);color:var(--text);font-family:\'Rajdhani\',sans-serif;height:100vh;overflow:hidden;display:flex;flex-direction:column}\nheader{background:var(--hdr);border-bottom:1px solid var(--border);padding:7px 14px;display:flex;align-items:center;gap:10px;flex-shrink:0;flex-wrap:wrap}\nheader h1{font-size:.82rem;font-weight:700;letter-spacing:1.4px;color:#fff}\n.badge{font-family:\'Share Tech Mono\',monospace;font-size:.58rem;padding:2px 8px;border-radius:3px;border:1px solid}\n.b-blue{background:rgba(78,166,255,.1);border-color:rgba(78,166,255,.35);color:#4ea6ff}\n.b-red{background:rgba(217,48,37,.12);border-color:rgba(217,48,37,.4);color:#ff6b5b}\n.b-ro{background:rgba(212,144,10,.1);border-color:rgba(212,144,10,.35);color:#d4900a}\n.fwrap{position:relative;margin-left:auto}\n.fbox{display:flex;align-items:center;gap:6px;padding:4px 11px;background:rgba(78,166,255,.08);border:1px solid rgba(78,166,255,.3);border-radius:5px;cursor:pointer;font-family:\'Share Tech Mono\',monospace;font-size:.63rem;color:#4ea6ff;user-select:none;min-width:150px}\n.fbox:hover{background:rgba(78,166,255,.14)}\n.fdrop{position:absolute;top:calc(100% + 5px);right:0;background:#1a2535;border:1px solid var(--border);border-radius:7px;min-width:230px;z-index:100;display:none;box-shadow:0 8px 24px rgba(0,0,0,.5)}\n.fdrop.open{display:block}\n.fdi{display:flex;align-items:center;gap:8px;padding:7px 12px;cursor:pointer;font-size:.65rem;font-family:\'Share Tech Mono\',monospace;color:var(--dim)}\n.fdi:hover,.fdi.act{background:rgba(78,166,255,.1);color:var(--text)}\n.fdot{width:8px;height:8px;border-radius:50%;flex-shrink:0}\n.fcount{margin-left:auto;font-size:.58rem;color:var(--dim)}\n.main{flex:1;display:flex;overflow:hidden}\n.bwrap{flex:1;position:relative;background:#9ea4ae;overflow:hidden;cursor:default}\n#mc,#ov{position:absolute;top:0;left:0;display:block}\n#ov{pointer-events:none}\n.rpanel{width:310px;flex-shrink:0;background:var(--panel);border-left:1px solid var(--border);display:flex;flex-direction:column;overflow:hidden}\n.rh{font-family:\'Share Tech Mono\',monospace;font-size:.58rem;font-weight:700;color:var(--dim);padding:6px 10px;border-bottom:1px solid var(--border);letter-spacing:.5px;flex-shrink:0}\n.iarea{padding:10px;border-bottom:1px solid var(--border);flex-shrink:0;min-height:72px}\n.iref{font-size:1rem;font-weight:700;color:#fff;font-family:\'Share Tech Mono\',monospace;letter-spacing:1px}\n.irem{font-size:.68rem;color:var(--dim);margin:3px 0 7px}\n.srow{display:flex;gap:5px;flex-wrap:wrap}\n.st{font-family:\'Share Tech Mono\',monospace;font-size:.58rem;padding:2px 6px;border-radius:3px;border:1px solid}\n.parea{flex:1;position:relative;display:flex;align-items:center;justify-content:center;background:#050a10;overflow:hidden;min-height:160px;cursor:pointer}\n.parea img{max-width:100%;max-height:100%;object-fit:contain;display:block}\n.pempty{text-align:center;color:var(--dim);font-size:.68rem;line-height:2}\n.pgrid{overflow-y:auto;max-height:220px;border-top:1px solid var(--border)}\n.gi{display:flex;align-items:center;gap:7px;padding:5px 9px;cursor:pointer;border-bottom:1px solid var(--border);transition:.12s}\n.gi:hover{background:rgba(255,255,255,.05)}\n.gi.sel{background:rgba(78,166,255,.1)}\n.gi.ghost{opacity:.3;pointer-events:none}\n.gdot{width:8px;height:8px;border-radius:50%;flex-shrink:0}\n.gref{font-family:\'Share Tech Mono\',monospace;font-size:.66rem;font-weight:700;color:#4ea6ff;min-width:50px}\n.grem{font-size:.62rem;color:var(--dim);flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}\n.gf{font-family:\'Share Tech Mono\',monospace;font-size:.63rem;font-weight:700}\n.nosel{color:var(--dim);font-size:.65rem;text-align:center;padding:18px;font-family:\'Share Tech Mono\',monospace}\n.xy{position:absolute;bottom:6px;right:8px;font-family:\'Share Tech Mono\',monospace;font-size:.54rem;color:rgba(255,255,255,.3);pointer-events:none}\n/* lightbox */\n.lbox{position:fixed;inset:0;background:rgba(0,0,0,.88);z-index:999;display:none;align-items:center;justify-content:center;cursor:zoom-out}\n.lbox.open{display:flex}\n.lbox img{max-width:92vw;max-height:92vh;object-fit:contain;border-radius:4px;box-shadow:0 0 40px rgba(0,0,0,.6)}\n::-webkit-scrollbar{width:4px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:rgba(255,255,255,.15);border-radius:2px}\n</style>\n</head>\n<body>\n<header>\n  <div style="font-size:1.4rem">&#128293;</div>\n  <div><h1>PCBA HEATMAP REPORT</h1><div style="font-family:\'Share Tech Mono\',monospace;font-size:.48rem;color:var(--dim)">THERMAL FAILURE ANALYSIS</div></div>\n  <span class="badge b-blue">'+data.boardName+'</span>\n  <span class="badge b-red">'+tot+' FALHAS</span>\n  <span class="badge b-blue">'+nc+' COMPONENTES</span>\n  <span class="badge b-ro">&#128065; SOMENTE LEITURA</span>\n  <span style="font-family:\'Share Tech Mono\',monospace;font-size:.52rem;color:var(--dim)">&#128197; '+data.exportedAt+'</span>\n  <div class="fwrap">\n    <div class="fbox" onclick="toggleFdrop()">\n      <span>&#9889;</span><span id="flbl" style="flex:1">FILTRO: TODOS</span><span id="farr">&#9660;</span>\n    </div>\n    <div class="fdrop" id="fdrop"></div>\n  </div>\n</header>\n<div class="main">\n  <div class="bwrap" id="bwrap">\n    <canvas id="mc"></canvas>\n    <canvas id="ov"></canvas>\n    <div class="xy" id="xy"></div>\n  </div>\n  <div class="rpanel">\n    <div class="rh">&#128247; FOTO DO COMPONENTE</div>\n    <div class="iarea" id="iarea"><div class="nosel">&#8592; Selecione um componente</div></div>\n    <div class="parea" id="parea" onclick="openLbox()" title="Clique para ampliar">\n      <div class="pempty" id="pempty">&#128247;<br>Nenhum componente<br>selecionado</div>\n      <img id="pimg" style="display:none" alt="">\n    </div>\n    <div class="rh">&#8801; COMPONENTES</div>\n    <div class="pgrid" id="pgrid"></div>\n  </div>\n</div>\n<div class="lbox" id="lbox" onclick="closeLbox()"><img id="limg" alt=""></div>\n<script>\nconst DATA='+dj+';\nlet selId=null,filterVal=\'\',zoom=1,panX=0,panY=0,panning=false,panDX=0,panDY=0,pcbImg=null;\nconst mc=document.getElementById(\'mc\'),ov=document.getElementById(\'ov\'),ctx=mc.getContext(\'2d\'),ovCtx=ov.getContext(\'2d\'),bwrap=document.getElementById(\'bwrap\');\nfunction fc(f,a){var t=Math.min(1,f/15),r,g,b;if(t<.33){r=0;g=Math.round(t*3*180);b=220;}else if(t<.66){r=Math.round((t-.33)*3*255);g=200;b=0;}else{r=255;g=Math.round((1-(t-.66)*3)*160);b=0;}return a!==undefined?\'rgba(\'+r+\',\'+g+\',\'+b+\',\'+a+\')\':\'rgb(\'+r+\',\'+g+\',\'+b+\')\';}\nfunction mkp(c2,x,y,w,h,sh){c2.beginPath();if(sh===\'rect\'||sh===\'square\'){c2.rect(x,y,w,h);}else if(sh===\'circle\'){var cx=x+w/2,cy=y+h/2,rx=Math.abs(w)/2||2,ry=Math.abs(h)/2||2;c2.ellipse(cx,cy,rx,ry,0,0,Math.PI*2);}else if(sh===\'diamond\'){var cx=x+w/2,cy=y+h/2;c2.moveTo(cx,y);c2.lineTo(x+w,cy);c2.lineTo(cx,y+h);c2.lineTo(x,cy);c2.closePath();}else if(sh===\'triangle\'){c2.moveTo(x+w/2,y);c2.lineTo(x+w,y+h);c2.lineTo(x,y+h);c2.closePath();}}\nfunction b2s(bx,by){return{x:bx*zoom+panX,y:by*zoom+panY};}\nfunction s2b(sx,sy){return{x:(sx-panX)/zoom,y:(sy-panY)/zoom};}\nfunction fit(){if(!pcbImg)return;var s=Math.min(mc.width/pcbImg.width,mc.height/pcbImg.height)*0.96;zoom=s;panX=(mc.width-pcbImg.width*s)/2;panY=(mc.height-pcbImg.height*s)/2;}\nfunction resize(){mc.width=ov.width=bwrap.clientWidth;mc.height=ov.height=bwrap.clientHeight;fit();draw();drawOv();}\nfunction draw(){\n  ctx.clearRect(0,0,mc.width,mc.height);ctx.fillStyle=\'#9ea4ae\';ctx.fillRect(0,0,mc.width,mc.height);\n  ctx.save();ctx.translate(panX,panY);ctx.scale(zoom,zoom);\n  var BW=pcbImg?pcbImg.naturalWidth:mc.width/zoom,BH=pcbImg?pcbImg.naturalHeight:mc.height/zoom;\n  if(pcbImg){ctx.drawImage(pcbImg,0,0,BW,BH);}else{ctx.fillStyle=\'#1a2535\';ctx.fillRect(0,0,BW,BH);}\n  DATA.comps.forEach(function(c){\n    if(filterVal&&(c.remarks||\'\').toLowerCase()!==filterVal.toLowerCase())return;\n    if(c.fails<=0)return;\n    var cx=c.bx+c.bw/2,cy=c.by+c.bh/2,base=Math.max(Math.abs(c.bw),Math.abs(c.bh))/2,r=base+30+c.fails*12;\n    var g2=ctx.createRadialGradient(cx,cy,0,cx,cy,r);\n    g2.addColorStop(0,fc(c.fails,.50));g2.addColorStop(.35,fc(c.fails,.26));g2.addColorStop(.70,fc(c.fails,.09));g2.addColorStop(1,fc(c.fails,0));\n    ctx.beginPath();ctx.arc(cx,cy,r,0,Math.PI*2);ctx.fillStyle=g2;ctx.fill();\n  });\n  DATA.comps.forEach(function(c){\n    var isF=filterVal&&(c.remarks||\'\').toLowerCase()!==filterVal.toLowerCase();\n    var isSel=selId===c.id;\n    ctx.save();\n    if(isF){ctx.globalAlpha=0.12;}else if(isSel){ctx.shadowColor=\'rgba(26,115,232,.8)\';ctx.shadowBlur=10/zoom;}\n    var fa=c.fails===0?.07:Math.min(.1+c.fails*.025,.45);\n    ctx.fillStyle=fc(c.fails,fa);mkp(ctx,c.bx,c.by,c.bw,c.bh,c.shape);ctx.fill();\n    ctx.strokeStyle=isSel?\'#1a73e8\':(c.color||\'#ff0000\');ctx.lineWidth=(isSel?2.8:2.2)/zoom;\n    if(isSel)ctx.setLineDash([5/zoom,2.5/zoom]);\n    mkp(ctx,c.bx,c.by,c.bw,c.bh,c.shape);ctx.stroke();ctx.setLineDash([]);ctx.restore();\n    var cx=c.bx+c.bw/2,cy=c.by+c.bh/2,fs=Math.max(8,Math.min(14,Math.abs(c.bw)*0.20))/zoom;\n    ctx.textAlign=\'center\';ctx.textBaseline=\'middle\';\n    ctx.font=\'bold \'+fs+\'px Share Tech Mono\';\n    ctx.strokeStyle=\'rgba(255,255,255,.95)\';ctx.lineWidth=3/zoom;ctx.strokeText(c.ref,cx,cy);\n    ctx.fillStyle=\'#080808\';ctx.fillText(c.ref,cx,cy);\n    if(c.remarks&&!isF){var fsR=Math.max(6,fs*.70),txt=c.remarks.length>18?c.remarks.slice(0,17)+\'\\u2026\':c.remarks;ctx.font=fsR+\'px Share Tech Mono\';ctx.strokeStyle=\'rgba(255,255,255,.9)\';ctx.lineWidth=2.5/zoom;ctx.strokeText(txt,cx,cy+fs*1.25);ctx.fillStyle=\'rgba(15,15,15,.88)\';ctx.fillText(txt,cx,cy+fs*1.25);}\n    if(c.fails>0&&!isF){var fr=16/zoom,fx=c.bx+c.bw+fr*.3,fy=c.by-fr*.3;ctx.beginPath();ctx.arc(fx,fy,fr,0,Math.PI*2);ctx.fillStyle=\'#d93025\';ctx.fill();ctx.strokeStyle=\'#fff\';ctx.lineWidth=1.5/zoom;ctx.stroke();ctx.font=\'bold \'+(10/zoom)+\'px Share Tech Mono\';ctx.fillStyle=\'#fff\';ctx.textAlign=\'center\';ctx.textBaseline=\'middle\';ctx.fillText(c.fails>99?\'99+\':String(c.fails),fx,fy);}\n  });\n  ctx.restore();\n}\nfunction drawOv(){\n  ovCtx.clearRect(0,0,ov.width,ov.height);\n  if(!selId)return;\n  var c=DATA.comps.find(function(x){return x.id===selId;});if(!c)return;\n  var cp=b2s(c.bx+c.bw/2,c.by+c.bh/2);\n  var sx=Math.max(10,Math.min(ov.width-10,cp.x)),sy=Math.max(10,Math.min(ov.height-10,cp.y));\n  var ex=ov.width-4;\n  var parea=document.getElementById(\'parea\'),wr=bwrap.getBoundingClientRect(),pr=parea.getBoundingClientRect();\n  var ey=(pr.top+pr.height/2)-wr.top;\n  ovCtx.save();\n  ovCtx.setLineDash([6,3]);ovCtx.strokeStyle=\'rgba(255,210,0,.90)\';ovCtx.lineWidth=2.5;\n  var mx=(sx+ex)/2;\n  ovCtx.beginPath();ovCtx.moveTo(sx,sy);ovCtx.bezierCurveTo(mx,sy,mx,ey,ex,ey);ovCtx.stroke();\n  ovCtx.setLineDash([]);\n  var ang=Math.atan2(ey-sy,ex-mx),al=11;\n  ovCtx.beginPath();ovCtx.moveTo(ex,ey);ovCtx.lineTo(ex-al*Math.cos(ang-.4),ey-al*Math.sin(ang-.4));ovCtx.lineTo(ex-al*Math.cos(ang+.4),ey-al*Math.sin(ang+.4));ovCtx.closePath();\n  ovCtx.fillStyle=\'rgba(255,210,0,.95)\';ovCtx.fill();\n  ovCtx.beginPath();ovCtx.arc(sx,sy,5,0,Math.PI*2);ovCtx.fillStyle=\'rgba(255,200,0,.8)\';ovCtx.fill();\n  ovCtx.strokeStyle=\'rgba(0,0,0,.4)\';ovCtx.lineWidth=1.5;ovCtx.stroke();\n  ovCtx.restore();\n}\nfunction ht(sx,sy){\n  return DATA.comps.slice().reverse().find(function(c){\n    var p1=b2s(c.bx,c.by),p2=b2s(c.bx+c.bw,c.by+c.bh);\n    var mnX=Math.min(p1.x,p2.x)-6,mxX=Math.max(p1.x,p2.x)+6,mnY=Math.min(p1.y,p2.y)-6,mxY=Math.max(p1.y,p2.y)+6;\n    return sx>=mnX&&sx<=mxX&&sy>=mnY&&sy<=mxY;\n  });\n}\nfunction sel(id){selId=id;updInfo();draw();drawOv();buildGrid();}\nfunction updInfo(){\n  var ia=document.getElementById(\'iarea\'),pm=document.getElementById(\'pempty\'),pi=document.getElementById(\'pimg\');\n  if(!selId){ia.innerHTML=\'<div class="nosel">&#8592; Selecione um componente</div>\';pm.style.display=\'block\';pi.style.display=\'none\';return;}\n  var c=DATA.comps.find(function(x){return x.id===selId;});if(!c)return;\n  var sC={L:\'#1e9952\',M:\'#d4900a\',H:\'#d93025\'}[c.sev]||\'#d93025\';\n  var sN={L:\'LOW\',M:\'MED\',H:\'HIGH\'}[c.sev]||\'?\';\n  ia.innerHTML=\'<div class="iref">\'+c.ref+\'</div><div class="irem">\'+(c.remarks||\'— sem descrição —\')+\'</div>\'\n    +\'<div class="srow">\'\n    +\'<span class="st" style="color:#ff6b5b;border-color:rgba(217,48,37,.4);background:rgba(217,48,37,.12)">\'+c.fails+\' FALHA\'+(c.fails!==1?\'S\':\'\')+\'</span>\'\n    +\'<span class="st" style="color:#4ea6ff;border-color:rgba(78,166,255,.35);background:rgba(78,166,255,.1)">\'+c.temp+\'&#176;C</span>\'\n    +\'<span class="st" style="color:\'+sC+\';border-color:\'+sC+\'44;background:\'+sC+\'22">\'+sN+\'</span>\'\n    +\'</div>\';\n  if(c.photo){pi.src=c.photo;pi.style.display=\'block\';pm.style.display=\'none\';}else{pi.style.display=\'none\';pm.style.display=\'block\';}\n}\nfunction buildGrid(){\n  var el=document.getElementById(\'pgrid\');\n  var comps=[...DATA.comps].sort(function(a,b){return b.fails-a.fails;});\n  el.innerHTML=comps.map(function(c){\n    var isF=filterVal&&(c.remarks||\'\').toLowerCase()!==filterVal.toLowerCase();\n    var isSel=c.id===selId;\n    var col=fc(c.fails,1);\n    return \'<div class="gi\'+(isSel?\' sel\':\'\')+\' \'+(isF?\' ghost\':\'\')+\'" onclick="sel(\'+ c.id +\')">\'\n      +\'<div class="gdot" style="background:\'+col+\'"></div>\'\n      +\'<span class="gref">\'+c.ref+\'</span>\'\n      +\'<span class="grem">\'+(c.remarks||\'—\')+\'</span>\'\n      +\'<span class="gf" style="color:\'+col+\'">\'+c.fails+\'F</span>\'\n      +\'</div>\';\n  }).join(\'\');\n}\nfunction buildFilter(){\n  var rm={};DATA.comps.forEach(function(c){var r=(c.remarks||\'\').trim();if(!r)return;var k=r.toLowerCase();if(!rm[k])rm[k]={label:r,cnt:0,f:0};rm[k].cnt++;rm[k].f+=c.fails;});\n  var keys=Object.keys(rm).sort(function(a,b){return rm[b].f-rm[a].f;});\n  var dd=document.getElementById(\'fdrop\');\n  dd.innerHTML=\'<div class="fdi act" data-v="" onclick="setF(\\\'\\\')"><div class="fdot" style="background:#7a8a9e"></div><span>Todos</span><span class="fcount">\'+DATA.comps.length+\' comp</span></div>\'\n    +keys.map(function(k){var r=rm[k],dc=fc(r.f/r.cnt,1);return \'<div class="fdi" data-v="\'+r.label+\'" onclick="setF(\\\'\'+r.label.replace(/\'/g,\"\\\\\'\")+\'\\\')"><div class="fdot" style="background:\'+dc+\'"></div><span>\'+r.label+\'</span><span class="fcount">\'+r.cnt+\' · \'+r.f+\'F</span></div>\';}).join(\'\');\n}\nfunction setF(v){\n  filterVal=v;document.getElementById(\'flbl\').textContent=v?\'\\u26a1 \'+v.toUpperCase():\'FILTRO: TODOS\';\n  document.querySelectorAll(\'.fdi\').forEach(function(el){el.classList.toggle(\'act\',el.dataset.v===v);});\n  document.getElementById(\'fdrop\').classList.remove(\'open\');draw();buildGrid();\n}\nfunction toggleFdrop(){document.getElementById(\'fdrop\').classList.toggle(\'open\');}\ndocument.addEventListener(\'click\',function(e){var fw=document.querySelector(\'.fwrap\');if(fw&&!fw.contains(e.target))document.getElementById(\'fdrop\').classList.remove(\'open\');});\nbwrap.addEventListener(\'click\',function(e){var r=bwrap.getBoundingClientRect();var hit=ht(e.clientX-r.left,e.clientY-r.top);if(hit)sel(hit.id);else{selId=null;updInfo();draw();drawOv();buildGrid();}});\nbwrap.addEventListener(\'mousemove\',function(e){\n  var r=bwrap.getBoundingClientRect();var bp=s2b(e.clientX-r.left,e.clientY-r.top);\n  document.getElementById(\'xy\').textContent=\'X:\'+Math.round(bp.x)+\' Y:\'+Math.round(bp.y);\n  if(panning){panX=e.clientX-panDX;panY=e.clientY-panDY;draw();drawOv();}\n});\nbwrap.addEventListener(\'mousedown\',function(e){if(e.button===1||e.button===2){e.preventDefault();panning=true;panDX=e.clientX-panX;panDY=e.clientY-panY;bwrap.style.cursor=\'grabbing\';}});\nbwrap.addEventListener(\'mouseup\',function(e){if(panning){panning=false;bwrap.style.cursor=\'default\';}});\nbwrap.addEventListener(\'wheel\',function(e){e.preventDefault();var r=bwrap.getBoundingClientRect(),sx=e.clientX-r.left,sy=e.clientY-r.top,f=e.deltaY<0?1.13:.89,nz=Math.max(.05,Math.min(20,zoom*f));panX=sx-(sx-panX)*(nz/zoom);panY=sy-(sy-panY)*(nz/zoom);zoom=nz;draw();drawOv();},{passive:false});\nbwrap.addEventListener(\'contextmenu\',function(e){e.preventDefault();});\nfunction openLbox(){var c=DATA.comps.find(function(x){return x.id===selId;});if(!c||!c.photo)return;document.getElementById(\'limg\').src=c.photo;document.getElementById(\'lbox\').classList.add(\'open\');}\nfunction closeLbox(){document.getElementById(\'lbox\').classList.remove(\'open\');}\nwindow.addEventListener(\'resize\',function(){setTimeout(resize,50);});\n(function(){var img=new Image();img.onload=function(){pcbImg=img;resize();buildGrid();buildFilter();};img.src=DATA.pcbImg;})();\n<\/script>\n</body>\n</html>';
}

// ════════════════════════════════════════════
// INIT
// ════════════════════════════════════════════
renderTabs();
redraw();