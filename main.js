// main.js
function wsURL() {
  const prod = 'https://maze-server-dtar.onrender.com'; // 上线时替换
  if (location.protocol === 'https:') return prod;
  return 'ws://127.0.0.1:8765'; // 本地调试
}
const PROTO_VER = 1;

// —— 画布尺寸（单画面）——
const GRID_N = 18, TILE = 48;
const MAP_SIZE = GRID_N * TILE;      // 864
const HUD_H = 96;
const CANVAS_H = MAP_SIZE + HUD_H;

const BG = '#121216', FLOOR = '#1c1c24', WALL = '#3c3c50';
const START_C = '#b478c8', EXIT_LOCK = '#783c3c', EXIT_OPEN = '#5ac878';
const PLAYER_C = '#f0f078', KEY_C = '#78dcff', TRAP_IDLE = '#c86e1e', TRAP_ACTIVE = '#eb3c3c';
const GRID_C = '#2a2a38', UI = '#eaeaea', UI_MUTED = '#a8a8b0';
const BTN = '#373b48', BTN_H = '#454b62';

let ws=null, state=null, role='A', room='default';
let canvas=document.getElementById('cv'), ctx=canvas.getContext('2d');
let pingTimer=null, reconnectTimer=null;
let timeAcc=0, lastAInputSent=0;

let bShape=0, bRot=0;
let draggingSrc=null, draggingGhost=null;

const keysDown={};
window.addEventListener('keydown', e=>{
  keysDown[e.key.toLowerCase()]=true;
  if (role==='B' && state && state.phase==='BUILD'){
    if (e.key==='q'||e.key==='Q') bRot = (bRot+3)%4;
    if (e.key==='e'||e.key==='E') bRot = (bRot+1)%4;
    if (e.key>='1' && e.key<='8') bShape = (e.key.charCodeAt(0)-'1'.charCodeAt(0))%8;
  }
});
window.addEventListener('keyup', e=>{ keysDown[e.key.toLowerCase()]=false; });

let mouse={x:0,y:0,down:false,button:0};
window.addEventListener('mousemove', e=>{
  const r=canvas.getBoundingClientRect(); mouse.x=e.clientX-r.left; mouse.y=e.clientY-r.top;
});
window.addEventListener('mousedown', e=>{ mouse.down=true; mouse.button=e.button; handleMouseDown(); e.preventDefault(); });
window.addEventListener('mouseup', ()=>{ mouse.down=false; handleMouseUp(); });
window.addEventListener('contextmenu', e=>e.preventDefault());
window.addEventListener('wheel', e=>{
  if (!state || role!=='B' || state.phase!=='BUILD') return;
  if (e.deltaY<0) bRot=(bRot+1)%4; else bRot=(bRot+3)%4;
  e.preventDefault();
},{passive:false});

// —— 加入/准备 —— 
function startClient(r){
  role=r;
  room=document.getElementById('room').value||'default';
  document.getElementById('join').style.display='none';
  resizeCanvas();    // 根据角色设定宽度
  showReady(true);   // 先进入准备界面
  connectWS();
}
window.startClient=startClient;

function showReady(on){
  document.getElementById('ready').style.display = on?'flex':'none';
  const title=document.getElementById('readyTitle');
  title.textContent = role==='A' ? 'A：等待 B 准备' : 'B：等待 A 准备';
}
function toggleReady(on){
  if (ws && ws.readyState===1) ws.send(JSON.stringify({t:'ready', on}));
}
window.toggleReady=toggleReady;

// —— WebSocket ——
function connectWS(){
  ws = new WebSocket(wsURL());
  ws.onopen=()=>{
    ws.send(JSON.stringify({t:'join', room, role, ver:PROTO_VER}));
    pingTimer=setInterval(()=>ws.send(JSON.stringify({t:'ping'})),8000);
  };
  ws.onmessage=ev=>{
    const msg=JSON.parse(ev.data);
    if (msg.t==='state'){
      state=msg.s;
      // 进入/退出准备界面
      if (state.phase==='LOBBY') showReady(true);
      else showReady(false);
    }else if (msg.t==='ack' && !msg.ok){
      console.warn('[ACK FAIL]', msg.cmd, msg.reason);
    }else if (msg.t==='err'){
      alert('版本不匹配，请刷新页面'); location.reload();
    }
  };
  ws.onclose=()=>{
    clearInterval(pingTimer); pingTimer=null;
    if (!reconnectTimer) reconnectTimer=setTimeout(()=>{ reconnectTimer=null; connectWS(); }, 1500);
  };
}

// —— 单画面尺寸：A 只需要地图+HUD；B 需要地图+右侧形状面板（+320） ——
function resizeCanvas(){
  const width = (role==='B') ? (MAP_SIZE + 320) : MAP_SIZE;
  canvas.width = width;
  canvas.height = CANVAS_H;
}

// —— 矩形工具 —— 
function rect(x,y,w,h){ return {x,y,w,h}; }
function inRect(x,y,r){ return x>=r.x && y>=r.y && x<r.x+r.w && y<r.y+r.h; }

// —— B 的区域（地图+右侧面板） —— 
function BMapRect(){ return rect(0,0, MAP_SIZE, MAP_SIZE); }
function BConfirmBtn(){
  const w=200,h=56;
  return rect(canvas.width - w - 12, MAP_SIZE + HUD_H - h - 36, w, h);
}

// —— 鼠标交互 —— 
function handleMouseDown(){
  if (!state || role!=='B' || state.win) return;
  const onMap = inRect(mouse.x, mouse.y, BMapRect());
  if (state.phase==='BUILD'){
    if (inRect(mouse.x, mouse.y, BConfirmBtn())){
      ws.send(JSON.stringify({t:'confirm'})); return;
    }
    if (mouse.button===0 && onMap){
      const gx=Math.floor(mouse.x/TILE), gy=Math.floor(mouse.y/TILE);
      ws.send(JSON.stringify({t:'place', shape:bShape, rot:bRot, gx, gy}));
    }
    if (mouse.button===2 && onMap){
      const gx=Math.floor(mouse.x/TILE), gy=Math.floor(mouse.y/TILE);
      ws.send(JSON.stringify({t:'trap', cell:[gx,gy]}));
    }
  }else if (state.phase==='PLAY'){
    if (mouse.button===2){ // 右键监视
      if (state.monitorLeft>0) ws.send(JSON.stringify({t:'monitor', on:true}));
    }
    if (mouse.button===0){
      const gx=Math.floor(mouse.x/TILE), gy=Math.floor(mouse.y/TILE);
      // 先触发陷阱
      ws.send(JSON.stringify({t:'trap', cell:[gx,gy]}));
      // 再尝试拖墙（客户端只负责开始拖，真正校验在服务端）
      if (isWall(gx,gy)) { draggingSrc=[gx,gy]; draggingGhost=[gx,gy]; }
    }
  }
}
function handleMouseUp(){
  if (!state || role!=='B') return;
  if (state.phase==='PLAY'){
    if (mouse.button===2) ws.send(JSON.stringify({t:'monitor', on:false}));
    if (mouse.button===0 && draggingSrc){
      const gx=Math.floor(mouse.x/TILE), gy=Math.floor(mouse.y/TILE);
      ws.send(JSON.stringify({t:'drag', src:draggingSrc, dst:[gx,gy]}));
      draggingSrc=null; draggingGhost=null;
    }
  }
}

// —— 工具：是否墙/陷阱 —— 
function isWall(gx,gy){
  if (!state||!state.walls) return false;
  for (const [x,y] of state.walls) if (x===gx && y===gy) return true;
  return false;
}
function isTrap(gx,gy){
  if (!state||!state.traps) return false;
  for (const t of state.traps) if (t.cell[0]===gx && t.cell[1]===gy) return true;
  return false;
}

// —— 渲染主循环 —— 
let last=performance.now();
function tick(){
  const now=performance.now(), dt=(now-last)/1000; last=now; timeAcc+=dt;

  // A 输入（仅 PLAY）
  if (role==='A' && state && state.phase==='PLAY' && ws && ws.readyState===1){
    const tnow=performance.now();
    if (tnow - lastAInputSent > 33){
      const keys={ w:!!keysDown['w'], a:!!keysDown['a'], s:!!keysDown['s'], d:!!keysDown['d'] };
      ws.send(JSON.stringify({t:'input', keys}));
      lastAInputSent=tnow;
    }
  }

  render();
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

// —— 渲染 —— 
function render(){
  ctx.fillStyle=BG; ctx.fillRect(0,0,canvas.width,canvas.height);
  if (!state){ drawCenterText('连接服务器中…'); return; }

  // LOBBY：双方准备
  if (state.phase==='LOBBY'){
    drawCenterText(`等待双方准备中…  (A:${state.ready?.A?'✓':'…'}  B:${state.ready?.B?'✓':'…'})`);
    return;
  }

  if (role==='A'){
    // A：BUILD 阶段不显示地图（按你要求“什么都看不到”）
    if (state.phase==='BUILD'){
      drawCenterText('B 正在布置迷宫…');
    }else{
      drawMap(0,0,true,false);
      drawHudA();
    }
  }else{
    // B：始终单画面（地图 + 右侧面板）
    const reveal = state.monitorActive && (state.monitorLeft>0);
    drawMap(0,0,false,reveal);
    if (state.phase==='BUILD') drawHudBBuild();
    else drawHudBPlay();
  }

  // 结算横幅
  if (state.win){
    const ww=canvas.width, hh=90, ox=0, oy=MAP_SIZE/2 - hh/2;
    ctx.fillStyle='rgba(0,0,0,.7)'; ctx.fillRect(ox, oy, ww, hh);
    ctx.fillStyle=UI; ctx.font='22px system-ui';
    const msg = state.win==='A' ? 'A 胜利！逃脱成功' : 'B 胜利！围杀/陷阱或超时';
    ctx.fillText(msg, ox + ww/2 - 140, oy + 58);
  }
}

function drawCenterText(t){
  ctx.fillStyle='#ddd'; ctx.font='20px system-ui, sans-serif';
  const m=ctx.measureText(t);
  ctx.fillText(t, (canvas.width - m.width)/2, MAP_SIZE/2);
}

// —— 地图绘制（单画面） —— 
function drawMap(ox,oy, showPlayer, revealPlayer){
  // 地板
  ctx.fillStyle=FLOOR; ctx.fillRect(ox,oy,MAP_SIZE,MAP_SIZE);
  // 起点终点
  ctx.fillStyle=START_C;
  ctx.fillRect(ox+state.start[0]*TILE, oy+state.start[1]*TILE, TILE, TILE);
  ctx.fillStyle = state.exitOpen ? EXIT_OPEN : EXIT_LOCK;
  ctx.fillRect(ox+state.end[0]*TILE,   oy+state.end[1]*TILE,   TILE, TILE);
  // 墙
  ctx.fillStyle=WALL;
  for (const [x,y] of state.walls) ctx.fillRect(ox+x*TILE, oy+y*TILE, TILE, TILE);
  // 陷阱
  for (const t of state.traps){
    const [x,y]=t.cell; ctx.fillStyle = t.active?TRAP_ACTIVE:TRAP_IDLE;
    ctx.fillRect(ox+x*TILE, oy+y*TILE, TILE, TILE);
  }
  // 钥匙
  ctx.fillStyle=KEY_C;
  for (const [x,y] of state.keys){
    ctx.beginPath(); ctx.arc(ox+x*TILE+TILE/2, oy+y*TILE+TILE/2, TILE*0.25, 0, Math.PI*2); ctx.fill();
  }
  // 网格
  ctx.strokeStyle=GRID_C; ctx.lineWidth=1;
  for (let i=0;i<=GRID_N;i++){
    ctx.beginPath(); ctx.moveTo(ox+i*TILE+0.5, oy+0.5); ctx.lineTo(ox+i*TILE+0.5, oy+MAP_SIZE-0.5); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(ox+0.5, oy+i*TILE+0.5); ctx.lineTo(ox+MAP_SIZE-0.5, oy+i*TILE+0.5); ctx.stroke();
  }
  // 玩家（压在网格上面）
  if (showPlayer || revealPlayer){
    ctx.fillStyle=PLAYER_C;
    ctx.beginPath(); ctx.arc(ox+state.A.x*TILE, oy+state.A.y*TILE, TILE*0.35, 0, Math.PI*2); ctx.fill();
  }

  // 建造预览（仅 B & BUILD）
  if (role==='B' && state.phase==='BUILD'){
    const mx=mouse.x, my=mouse.y;
    if (mx>=0 && my>=0 && mx<MAP_SIZE && my<MAP_SIZE){
      const gx=Math.floor(mx/TILE), gy=Math.floor(my/TILE);
      const cells = previewShapeCells(bShape, bRot, gx, gy);
      const ok = previewLikelyOK(cells);
      const border = ok ? '#6ad69c' : '#d26a6a';
      ctx.globalAlpha=0.35; ctx.fillStyle=border;
      for (const [cx,cy] of cells){
        if (0<=cx && cx<GRID_N && 0<=cy && cy<GRID_N) ctx.fillRect(ox+cx*TILE, oy+cy*TILE, TILE, TILE);
      }
      ctx.globalAlpha=1; ctx.strokeStyle=border; ctx.lineWidth=3;
      for (const [cx,cy] of cells){
        if (0<=cx && cx<GRID_N && 0<=cy && cy<GRID_N) ctx.strokeRect(ox+cx*TILE+0.5, oy+cy*TILE+0.5, TILE-1, TILE-1);
      }
    }
  }
  // 拖墙幽灵（B & PLAY）
  if (role==='B' && state.phase==='PLAY' && draggingSrc){
    const mx=mouse.x, my=mouse.y;
    if (mx>=0 && my>=0 && mx<MAP_SIZE && my<MAP_SIZE){
      const gx=Math.floor(mx/TILE), gy=Math.floor(my/TILE);
      draggingGhost=[gx,gy];
      ctx.strokeStyle='#ddd'; ctx.lineWidth=3;
      ctx.strokeRect(ox+gx*TILE+0.5, oy+gy*TILE+0.5, TILE-1, TILE-1);
    }
  }
}

function drawHudA(){
  const y0 = MAP_SIZE + 8;
  // 被监视的红边（只在 A PLAY 且 monitorActive 时）
  if (state.monitorActive){
    drawEdgeGlow(0,0,MAP_SIZE,MAP_SIZE);
    ctx.fillStyle='#ff8080'; ctx.font='20px system-ui';
    ctx.fillText('你正在被监视！', MAP_SIZE/2 - 90, 24);
  }
  ctx.fillStyle=UI; ctx.font='16px system-ui';
  ctx.fillText(`钥匙：${state.A.keys}/3`, 12, y0+18);
  ctx.fillText(`时间：${Math.max(0,Math.ceil(state.timeLeft||0))}s`, 12, y0+18+26);
  if (!state.exitOpen){ ctx.fillStyle=UI_MUTED; ctx.fillText('出口已锁定', MAP_SIZE-120, y0+18+26); }
  else { ctx.fillStyle='#b6e6b6'; ctx.fillText('出口已开启！', MAP_SIZE-120, y0+18+26); }
}

function drawHudBBuild(){
  const y0=MAP_SIZE+8;
  ctx.fillStyle=UI; ctx.font='18px system-ui';
  ctx.fillText('阶段①：B 布置迷宫', 12, y0+18);
  ctx.fillStyle=UI_MUTED; ctx.font='14px system-ui';
  ctx.fillText('左键拼块 / 右键陷阱 / Q,E 或滚轮旋转 / 1-8选择 / 右下确认', 12, y0+18+26);
  ctx.fillStyle=UI; ctx.font='16px system-ui';
  ctx.fillText(`建造倒计时：${Math.max(0,(state.buildTime|0))}s`, 12, y0+18+26+26);
  ctx.fillText(`陷阱：x${TRAP_STOCK_INIT - (state.traps?.length||0)}`, canvas.width-140, y0+18+26+26);

  drawPalette(MAP_SIZE + 16, 12);
  const btn=BConfirmBtn();
  ctx.fillStyle=BTN; roundRect(ctx, btn.x, btn.y, btn.w, btn.h, 10, true);
  ctx.fillStyle=UI; ctx.font='20px system-ui'; ctx.fillText('确认开始', btn.x+24, btn.y+36);
}

function drawHudBPlay(){
  const y0=MAP_SIZE+8;
  ctx.fillStyle=UI; ctx.font='18px system-ui';
  ctx.fillText('阶段②：分屏对战（右键监视；左键陷阱或拖墙）', 12, y0+18);
  // 监视条
  const bar_w=220, bar_h=14, x=12, y=y0+56;
  ctx.fillStyle='#464a5a'; ctx.fillRect(x,y,bar_w,bar_h);
  const p=Math.max(0, Math.min(1,(state.monitorLeft||0)/5.0));
  ctx.fillStyle='#78c8ee'; ctx.fillRect(x,y,bar_w*p,bar_h);
  ctx.fillStyle=UI; ctx.font='14px system-ui'; ctx.fillText('监视剩余', x, y-6);
  // 冷却
  const cx=x+240, cy=y;
  ctx.fillStyle='#464a5a'; ctx.fillRect(cx,cy,bar_w,bar_h);
  const cp=1.0 - Math.min(1.0,(state.bMoveCooldown||0)/2.0);
  ctx.fillStyle='#b6e6a6'; ctx.fillRect(cx,cy,bar_w*cp,bar_h);
  ctx.fillStyle=UI; ctx.fillText('拖墙冷却', cx, cy-6);
}

// —— 形状面板 —— 
const SHAPES = [
  [[0,0],[1,0],[2,0],[3,0]],
  [[0,0],[1,0],[0,1],[1,1]],
  [[0,0],[1,0],[2,0],[1,1]],
  [[0,0],[0,1],[0,2],[1,2]],
  [[1,0],[1,1],[1,2],[0,2]],
  [[1,0],[2,0],[0,1],[1,1]],
  [[0,0],[1,0],[1,1],[2,1]],
  [[0,1],[1,0],[1,1],[1,2],[2,1]],
];
function rot(cells,k){
  let out=cells.map(([x,y])=>[x,y]);
  for (let i=0;i<((k%4)+4)%4;i++){
    out = out.map(([x,y])=>[y,-x]);
    const minx=Math.min(...out.map(p=>p[0])), miny=Math.min(...out.map(p=>p[1]));
    out = out.map(([x,y])=>[x-minx,y-miny]);
  }
  return out;
}
function previewShapeCells(idx, rotk, gx, gy){
  return rot(SHAPES[idx], rotk).map(([x,y])=>[gx+x, gy+y]);
}
function previewLikelyOK(cells){
  for (const [x,y] of cells){
    if (x<0||y<0||x>=GRID_N||y>=GRID_N) return false;
    if (isWall(x,y)) return false;
    if (isTrap(x,y)) return false;
    if ((x===state.start[0]&&y===state.start[1])||(x===state.end[0]&&y===state.end[1])) return false;
    for (const [kx,ky] of state.keys){ if (kx===x && ky===y) return false; }
  }
  return true;
}
function drawPalette(px,py){
  const col_w=140,row_h=92,pad=12;
  ctx.font='14px system-ui';
  for (let i=0;i<8;i++){
    const r={x:px+(i%2)*(col_w+pad), y:py+Math.floor(i/2)*(row_h+pad), w:col_w, h:row_h};
    const stock=state.shapeStock?state.shapeStock[i]:0;
    let base=(stock<=0)?'#9a3c3c':(i===bShape?BTN_H:BTN);
    ctx.fillStyle=base; roundRect(ctx,r.x,r.y,r.w,r.h,8,true);
    const cell=20, shape=rot(SHAPES[i],0);
    const minx=Math.min(...shape.map(p=>p[0])), miny=Math.min(...shape.map(p=>p[1]));
    const norm = shape.map(([x,y])=>[x-minx,y-miny]);
    for (const [sx,sy] of norm){
      ctx.fillStyle = (stock<=0)?'#5a5a68':WALL;
      ctx.fillRect(r.x+10+sx*(cell+2), r.y+10+sy*(cell+2), cell, cell);
    }
    ctx.fillStyle=UI_MUTED;
    ctx.fillText(String(i+1), r.x+6, r.y+16);
    ctx.fillText('x'+stock, r.x+r.w-42, r.y+r.h-10);
    if (mouse.down && mouse.button===0 && inRect(mouse.x,mouse.y,r) && stock>0) bShape=i;
  }
}
function roundRect(ctx,x,y,w,h,r,fill=true,stroke=false){
  ctx.beginPath();
  ctx.moveTo(x+r,y);
  ctx.arcTo(x+w,y, x+w,y+h, r);
  ctx.arcTo(x+w,y+h, x,y+h, r);
  ctx.arcTo(x,y+h, x,y, r);
  ctx.arcTo(x,y, x+w,y, r);
  if (fill) ctx.fill();
  if (stroke) ctx.stroke();
}

// —— A 被监视时的红色描边（无四角圆斑，仅描边+轻内光） —— 
function drawEdgeGlow(x,y,w,h){
  const pulse = 0.6 + 0.4*(0.5+0.5*Math.sin(timeAcc*6.5));
  const layers=8, max_th=36;
  for (let i=0;i<layers;i++){
    const k=i/(layers-1);
    const alpha = Math.floor(150*pulse*(1-k));
    const inset=i*3;
    ctx.strokeStyle=`rgba(210,50,50,${alpha/255})`;
    ctx.lineWidth=Math.max(2, Math.floor(max_th*(1-k)));
    ctx.strokeRect(x+inset+0.5, y+inset+0.5, w-inset*2-1, h-inset*2-1);
    const fillA=Math.max(20, Math.floor(alpha/6));
    ctx.fillStyle=`rgba(210,50,50,${fillA/255})`;
    ctx.fillRect(x+inset+3, y+inset+3, w-(inset+3)*2, h-(inset+3)*2);
  }
}
