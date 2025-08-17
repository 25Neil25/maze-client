// online/web/main.js

// ====== 配置你的后端地址 ======
// 部署后改成你的 Render/VPS 域名：比如 wss://maze-xxx.onrender.com
function wsURL() {
  const prod = 'wss://REPLACE_WITH_YOUR_SERVER_DOMAIN';
  if (location.protocol === 'https:') return prod;
  return 'ws://127.0.0.1:8765'; // 本地联调
}
const PROTO_VER = 1;

// ====== 画布尺寸（与你的 pygame 一致） ======
const GRID_N = 18, TILE = 48;
const MAP_SIZE = GRID_N * TILE;         // 864
const HUD_H = 96;
const A_W = MAP_SIZE, A_H = MAP_SIZE + HUD_H;
const B_W = MAP_SIZE + 320, B_H = MAP_SIZE + HUD_H;

const W = A_W + B_W + 24;               // 中间给一点空隙
const H = Math.max(A_H, B_H);

const BG = '#121216', FLOOR = '#1c1c24', WALL = '#3c3c50';
const START_C = '#b478c8', EXIT_LOCK = '#783c3c', EXIT_OPEN = '#5ac878';
const PLAYER_C = '#f0f078', KEY_C = '#78dcff', TRAP_IDLE = '#c86e1e', TRAP_ACTIVE = '#eb3c3c';
const GRID_C = '#282836', UI = '#eaeaea', UI_MUTED = '#a8a8b0';
const BTN = '#373b48', BTN_H = '#454b62';

// ====== 全局状态 ======
let ws = null, state = null, role='A', room='default';
let canvas = document.getElementById('cv');
let ctx = canvas.getContext('2d');
canvas.width = W; canvas.height = H;

let bShape = 0, bRot = 0;           // B：当前形状/旋转
let draggingSrc = null, draggingGhost = null;  // 对战时拖墙
let lastAInputSent = 0;
let timeAcc = 0;                    // A 被监视时红边呼吸
let mouse = {x:0,y:0, down:false, button:0};   // 全局鼠标
let pingTimer = null, reconnectTimer = null;

function startClient(r){
  role = r;
  room = document.getElementById('room').value || 'default';
  document.getElementById('join').style.display='none';
  connectWS();
}
window.startClient = startClient;

// ====== WebSocket 连接 ======
function connectWS(){
  ws = new WebSocket(wsURL());
  ws.onopen = ()=>{
    ws.send(JSON.stringify({t:'join', room, role, ver:PROTO_VER}));
    pingTimer = setInterval(()=> ws.send(JSON.stringify({t:'ping'})), 8000);
  };
  ws.onmessage = ev=>{
    const msg = JSON.parse(ev.data);
    if (msg.t==='state') state = msg.s;
    else if (msg.t==='ack' && !msg.ok) console.warn('[ACK FAIL]', msg.cmd, msg.reason);
    else if (msg.t==='err') alert('版本不匹配，请刷新页面。');
  };
  ws.onclose = ()=>{
    clearInterval(pingTimer); pingTimer=null;
    if (!reconnectTimer){
      reconnectTimer = setTimeout(()=>{ reconnectTimer=null; connectWS(); }, 1500);
    }
  };
}

// ====== 输入 ======
window.addEventListener('mousemove', (e)=>{
  const rect = canvas.getBoundingClientRect();
  mouse.x = e.clientX - rect.left;
  mouse.y = e.clientY - rect.top;
});
window.addEventListener('mousedown', (e)=>{
  mouse.down = true; mouse.button = e.button;
  handleMouseDown();
  e.preventDefault();
});
window.addEventListener('mouseup', (e)=>{
  mouse.down = false;
  handleMouseUp();
});
window.addEventListener('contextmenu', e=> e.preventDefault());
window.addEventListener('wheel', (e)=>{
  // B 建造时滚轮旋转
  if (!state || role!=='B' || state.phase!=='BUILD') return;
  if (e.deltaY < 0) bRot = (bRot + 1) % 4;
  else bRot = (bRot + 3) % 4;
  e.preventDefault();
}, {passive:false});

const keysDown = {};
window.addEventListener('keydown', (e)=>{
  keysDown[e.key.toLowerCase()] = true;
  if (role==='B' && state){
    if (state.phase==='BUILD'){
      if (e.key==='q' || e.key==='Q') bRot = (bRot + 3) % 4;
      if (e.key==='e' || e.key==='E') bRot = (bRot + 1) % 4;
      if (e.key>='1' && e.key<='8') bShape = (e.key.charCodeAt(0) - '1'.charCodeAt(0)) % 8;
    }
  }
});
window.addEventListener('keyup', (e)=>{ keysDown[e.key.toLowerCase()] = false; });

// ====== 坐标辅助 ======
function inRect(x,y, r){ return x>=r.x && y>=r.y && x<r.x+r.w && y<r.y+r.h; }
function rect(x,y,w,h){ return {x,y,w,h}; }
function px_to_grid(local_x, local_y){ return [Math.floor(local_x/TILE), Math.floor(local_y/TILE)]; }

// ====== 区域：A 画面位于左侧 | B 画面位于右侧 ======
function ARect(){ return rect(0,0, A_W, A_H); }
function BRect(){ return rect(A_W+24,0, B_W, B_H); }
function BMapRect(){ const r=BRect(); return rect(r.x, r.y, MAP_SIZE, MAP_SIZE); }
function BConfirmBtn(){
  const r=BRect(); const w=200, h=56;
  return rect(r.x + B_W - w - 12, r.y + MAP_SIZE + HUD_H - h - 36, w, h);
}

// ====== 鼠标处理 ======
function handleMouseDown(){
  if (!state || role!=='B') return;
  const rB = BRect();
  const onB = inRect(mouse.x, mouse.y, rB);
  if (!onB) return;

  const mapR = BMapRect();
  const onMap = inRect(mouse.x, mouse.y, mapR);
  const mx = mouse.x - mapR.x, my = mouse.y - mapR.y;

  if (state.win) return; // 结算不操作

  if (state.phase==='BUILD'){
    // 点确认开始
    if (inRect(mouse.x, mouse.y, BConfirmBtn())){
      ws.send(JSON.stringify({t:'confirm'})); return;
    }
    if (mouse.button===0 && onMap){
      const [gx,gy] = px_to_grid(mx, my);
      ws.send(JSON.stringify({t:'place', shape:bShape, rot:bRot, gx, gy}));
    }
    if (mouse.button===2 && onMap){
      const [gx,gy] = px_to_grid(mx, my);
      ws.send(JSON.stringify({t:'trap', cell:[gx,gy]}));
    }
  }else if (state.phase==='PLAY'){
    if (mouse.button===2){ // 右键按住 = 监视
      if (state.monitorLeft>0){
        ws.send(JSON.stringify({t:'monitor', on:true}));
      }
    }
    if (mouse.button===0){ // 左键 = 触发陷阱 或 开始拖墙
      const [gx,gy] = px_to_grid(mx, my);
      // 先试图触发陷阱
      ws.send(JSON.stringify({t:'trap', cell:[gx,gy]}));
      // 再判断是否可拖墙（需要客户端知道是否墙；这里仅开启拖拽，真正判定在服务器）
      if (isWall(gx,gy)) {
        draggingSrc = [gx,gy];
        draggingGhost = [gx,gy];
      }
    }
  }
}
function handleMouseUp(){
  if (!state || role!=='B') return;
  if (state.phase==='PLAY'){
    if (mouse.button===2){
      ws.send(JSON.stringify({t:'monitor', on:false}));
    }
    if (mouse.button===0 && draggingSrc){
      const mapR = BMapRect(); const mx = mouse.x - mapR.x, my = mouse.y - mapR.y;
      if (mx>=0 && my>=0 && mx<MAP_SIZE && my<MAP_SIZE){
        const [gx,gy] = px_to_grid(mx, my);
        ws.send(JSON.stringify({t:'drag', src: draggingSrc, dst:[gx,gy]}));
      }
      draggingSrc = null; draggingGhost = null;
    }
  }
}

// ====== 工具：是否墙/陷阱/键 ======
function isWall(gx,gy){
  if (!state) return false;
  for (const [x,y] of state.walls) if (x===gx && y===gy) return true;
  return false;
}
function isTrap(gx,gy){
  if (!state) return false;
  for (const t of state.traps){
    if (t.cell[0]===gx && t.cell[1]===gy) return true;
  }
  return false;
}

// ====== 主循环 ======
let last = performance.now();
function tick(){
  const now = performance.now();
  const dt = (now - last)/1000; last = now;
  timeAcc += dt;

  // A 输入节流 ~30Hz
  if (role==='A' && state && state.phase==='PLAY' && ws && ws.readyState===1){
    const tnow = performance.now();
    if (tnow - lastAInputSent > 33){
      const keys = { w: !!keysDown['w'], a: !!keysDown['a'], s: !!keysDown['s'], d: !!keysDown['d'] };
      ws.send(JSON.stringify({t:'input', keys}));
      lastAInputSent = tnow;
    }
  }

  render();
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

// ====== 渲染 ======
function render(){
  ctx.fillStyle = BG; ctx.fillRect(0,0,canvas.width,canvas.height);

  if (!state){
    ctx.fillStyle = '#ddd';
    ctx.font = '20px monospace';
    ctx.fillText('连接服务器中…', 20, 30);
    return;
  }

  drawAView(); // 左
  drawBView(); // 右
}

// --- A 视角 ---
function drawAView(){
  const r = ARect();
  // 地图
  drawMap(r.x, r.y, true, false);

  // HUD
  const y0 = r.y + MAP_SIZE + 8;
  ctx.fillStyle = UI; ctx.font = '16px system-ui, sans-serif';
  ctx.fillText(`钥匙：${state.A.keys}/3`, r.x + 12, y0 + 18);
  ctx.fillText(`时间：${Math.max(0, Math.ceil(state.timeLeft||0))}s`, r.x + 12, y0 + 18 + 26);

  if (!(state.exitOpen)){
    ctx.fillStyle = UI_MUTED;
    ctx.fillText(`出口已锁定`, r.x + MAP_SIZE - 120, y0 + 18 + 26);
  } else {
    ctx.fillStyle = '#b6e6b6';
    ctx.fillText(`出口已开启！`, r.x + MAP_SIZE - 120, y0 + 18 + 26);
  }

  // A 被监视的红色边缘泛光
  if (state.monitorActive){
    drawEdgeGlow(r.x, r.y, A_W, MAP_SIZE, timeAcc);
    ctx.fillStyle = '#ff8080';
    ctx.font = '20px system-ui, sans-serif';
    ctx.fillText('你正在被监视！', r.x + MAP_SIZE/2 - 90, r.y + 24);
  }
}

// --- B 视角 ---
function drawBView(){
  const r = BRect();
  // 地图
  const reveal = state.monitorActive && (state.monitorLeft>0);
  drawMap(r.x, r.y, false, reveal);

  const y0 = r.y + MAP_SIZE + 8;
  ctx.fillStyle = UI; ctx.font = '18px system-ui, sans-serif';
  if (state.phase==='BUILD'){
    ctx.fillText('阶段①：B 布置迷宫', r.x + 12, y0 + 18);
    ctx.fillStyle = UI_MUTED; ctx.font = '14px system-ui, sans-serif';
    ctx.fillText('左键拼块 / 右键陷阱 / Q,E 或滚轮旋转 / 1-8选择 / 右下确认', r.x + 12, y0 + 18 + 26);
    ctx.fillStyle = UI; ctx.font = '16px system-ui, sans-serif';
    ctx.fillText(`建造倒计时：${Math.max(0, (state.buildTime|0))}s`, r.x + 12, y0 + 18 + 26 + 26);
    ctx.fillText(`陷阱：x${TRAP_STOCK_INIT - (state.traps?.length||0)}`, r.x + B_W - 140, y0 + 18 + 26 + 26);
    // 形状面板
    drawPalette(r.x + MAP_SIZE + 16, r.y + 12);
    // 确认开始按钮
    const btn = BConfirmBtn();
    ctx.fillStyle = BTN; roundRect(ctx, btn.x, btn.y, btn.w, btn.h, 10, true);
    ctx.fillStyle = UI; ctx.font = '20px system-ui, sans-serif';
    ctx.fillText('确认开始', btn.x + 24, btn.y + 36);
  }else{
    ctx.fillStyle = UI; ctx.font = '18px system-ui, sans-serif';
    ctx.fillText('阶段②：分屏对战（右键监视；左键触发陷阱或拖墙）', r.x + 12, y0 + 18);
    // 监视条 + 冷却条
    const bar_w=220, bar_h=14, x = r.x + 12, y = y0 + 56;
    ctx.fillStyle = '#464a5a'; ctx.fillRect(x,y,bar_w,bar_h);
    const p = Math.max(0, Math.min(1, (state.monitorLeft||0) / 5.0));
    ctx.fillStyle = '#78c8ee'; ctx.fillRect(x,y, bar_w*p, bar_h);
    ctx.fillStyle = UI; ctx.font = '14px system-ui, sans-serif';
    ctx.fillText('监视剩余', x, y-6);

    const cx = x + 240, cy = y;
    ctx.fillStyle = '#464a5a'; ctx.fillRect(cx, cy, bar_w, bar_h);
    const cp = 1.0 - Math.min(1.0, (state.bMoveCooldown||0) / 2.0);
    ctx.fillStyle = '#b6e6a6'; ctx.fillRect(cx, cy, bar_w*cp, bar_h);
    ctx.fillStyle = UI; ctx.fillText('拖墙冷却', cx, cy-6);

    // 拖动中的幽灵格
    if (draggingSrc){
      const [gx,gy] = draggingGhost || draggingSrc;
      ctx.strokeStyle = '#ddd'; ctx.lineWidth=3;
      ctx.strokeRect(r.x + gx*TILE+0.5, r.y + gy*TILE+0.5, TILE-1, TILE-1);
    }
  }

  // 结算横幅
  if (state.win){
    const ww=B_W, hh=90, ox=r.x, oy=r.y + MAP_SIZE/2 - hh/2;
    ctx.fillStyle='rgba(0,0,0,.7)'; ctx.fillRect(ox, oy, ww, hh);
    ctx.fillStyle=UI; ctx.font='22px system-ui';
    const msg = state.win==='A' ? 'A 胜利！逃脱成功' : 'B 胜利！围杀/陷阱或超时';
    ctx.fillText(msg, ox + ww/2 - 140, oy + 58);
  }
}

// --- 画地图（两侧公用） ---
function drawMap(ox, oy, showPlayer, revealPlayer){
  // 地板
  ctx.fillStyle = FLOOR; ctx.fillRect(ox, oy, MAP_SIZE, MAP_SIZE);

  // 起点/终点
  ctx.fillStyle = START_C;
  ctx.fillRect(ox + state.start[0]*TILE, oy + state.start[1]*TILE, TILE, TILE);
  ctx.fillStyle = state.exitOpen ? EXIT_OPEN : EXIT_LOCK;
  ctx.fillRect(ox + state.end[0]*TILE,   oy + state.end[1]*TILE,   TILE, TILE);

  // 墙
  ctx.fillStyle = WALL;
  for (const [x,y] of state.walls){
    ctx.fillRect(ox + x*TILE, oy + y*TILE, TILE, TILE);
  }

  // 陷阱
  for (const t of state.traps){
    const [x,y]=t.cell;
    ctx.fillStyle = t.active ? TRAP_ACTIVE : TRAP_IDLE;
    ctx.fillRect(ox + x*TILE, oy + y*TILE, TILE, TILE);
  }

  // 钥匙
  ctx.fillStyle = KEY_C;
  for (const [x,y] of state.keys){
    ctx.beginPath();
    ctx.arc(ox + x*TILE+TILE/2, oy + y*TILE+TILE/2, TILE*0.25, 0, Math.PI*2);
    ctx.fill();
  }

  // 网格
  ctx.strokeStyle = '#2a2a38'; ctx.lineWidth=1;
  for (let i=0;i<=GRID_N;i++){
    ctx.beginPath(); ctx.moveTo(ox + i*TILE + 0.5, oy + 0.5); ctx.lineTo(ox + i*TILE + 0.5, oy + MAP_SIZE - 0.5); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(ox + 0.5, oy + i*TILE + 0.5); ctx.lineTo(ox + MAP_SIZE - 0.5, oy + i*TILE + 0.5); ctx.stroke();
  }

  // 玩家（压在网格上方）
  if (showPlayer || revealPlayer){
    ctx.fillStyle = PLAYER_C;
    ctx.beginPath();
    ctx.arc(ox + state.A.x*TILE, oy + state.A.y*TILE, TILE*0.35, 0, Math.PI*2);
    ctx.fill();
  }

  // 建造时的“放置预览”
  if (role==='B' && state.phase==='BUILD'){
    const mapR = BMapRect();
    const mx = mouse.x - mapR.x, my = mouse.y - mapR.y;
    if (mx>=0 && my>=0 && mx<MAP_SIZE && my<MAP_SIZE){
      const [gx,gy] = px_to_grid(mx,my);
      // 只做视觉预览，颜色按可能性提示（无法100%一致，因为最终判定在服务端）
      const cells = previewShapeCells(bShape, bRot, gx, gy);
      const ok = previewLikelyOK(cells);
      const border = ok ? '#6ad69c' : '#d26a6a';
      ctx.globalAlpha = 0.35; ctx.fillStyle = border;
      for (const [cx,cy] of cells){
        if (0<=cx && cx<GRID_N && 0<=cy && cy<GRID_N){
          ctx.fillRect(ox + cx*TILE, oy + cy*TILE, TILE, TILE);
        }
      }
      ctx.globalAlpha = 1; ctx.strokeStyle = border; ctx.lineWidth=3;
      for (const [cx,cy] of cells){
        if (0<=cx && cx<GRID_N && 0<=cy && cy<GRID_N){
          ctx.strokeRect(ox + cx*TILE+0.5, oy + cy*TILE+0.5, TILE-1, TILE-1);
        }
      }
    }
  }

  // PLAY 拖动时的幽灵
  if (role==='B' && state.phase==='PLAY' && draggingSrc){
    const mapR = BMapRect();
    const mx = mouse.x - mapR.x, my = mouse.y - mapR.y;
    if (mx>=0 && my>=0 && mx<MAP_SIZE && my<MAP_SIZE){
      const [gx,gy] = px_to_grid(mx,my);
      draggingGhost = [gx,gy];
    }
  }
}

// 形状预览（与服务器同逻辑）
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
  let out = cells.map(([x,y])=>[x,y]);
  for (let i=0;i<(k%4+4)%4;i++){
    out = out.map(([x,y])=>[y,-x]);
    let minx = Math.min(...out.map(p=>p[0]));
    let miny = Math.min(...out.map(p=>p[1]));
    out = out.map(([x,y])=>[x-minx,y-miny]);
  }
  return out;
}
function previewShapeCells(idx, rotk, gx, gy){
  return rot(SHAPES[idx], rotk).map(([x,y])=>[gx+x, gy+y]);
}
function previewLikelyOK(cells){
  // 近似判断：不越界、不占墙/钥匙/起点终点/陷阱
  for (const [x,y] of cells){
    if (x<0||y<0||x>=GRID_N||y>=GRID_N) return false;
    if (isWall(x,y)) return false;
    if (isTrap(x,y)) return false;
    if ((x===state.start[0] && y===state.start[1]) || (x===state.end[0] && y===state.end[1])) return false;
    for (const [kx,ky] of state.keys){ if (kx===x && ky===y) return false; }
  }
  return true;
}

// 形状面板（右侧）
function drawPalette(px, py){
  const col_w=140, row_h=92, pad=12;
  ctx.font='14px system-ui, sans-serif';
  for (let i=0;i<8;i++){
    const r = {x:px + (i%2)*(col_w+pad), y:py + Math.floor(i/2)*(row_h+pad), w:col_w, h:row_h};
    const stock = state.shapeStock ? state.shapeStock[i] : 0;
    let base = (stock<=0) ? '#9a3c3c' : (i===bShape ? BTN_H : BTN);
    ctx.fillStyle = base; roundRect(ctx, r.x, r.y, r.w, r.h, 8, true);

    // 小格预览（基形）
    const cell=20, shape = rot(SHAPES[i], 0);
    const minx = Math.min(...shape.map(p=>p[0])), miny = Math.min(...shape.map(p=>p[1]));
    const norm = shape.map(([x,y])=>[x-minx,y-miny]);
    for (const [sx,sy] of norm){
      ctx.fillStyle = WALL;
      if (stock<=0) ctx.fillStyle='#5a5a68';
      ctx.fillRect(r.x+10 + sx*(cell+2), r.y+10 + sy*(cell+2), cell, cell);
    }

    ctx.fillStyle = UI_MUTED;
    ctx.fillText(String(i+1), r.x+6, r.y+16);
    ctx.fillText('x'+stock, r.x+r.w-42, r.y+r.h-10);

    // 点击选择
    if (mouse.down && mouse.button===0 && inRect(mouse.x, mouse.y, {x:r.x, y:r.y, w:r.w, h:r.h})){
      if (stock>0) bShape = i;
    }
  }
}

// 圆角矩形
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

// A 侧红色边缘发光（无四角圆斑，只有描边+轻微内辉）
function drawEdgeGlow(x,y,w,h,t){
  const pulse = 0.6 + 0.4 * (0.5 + 0.5 * Math.sin(t * 6.5));
  const layers = 8, max_th=36;
  for (let i=0;i<layers;i++){
    const k = i/(layers-1);
    const alpha = Math.floor(150 * pulse * (1-k));
    const inset = i*3;
    ctx.strokeStyle = `rgba(210,50,50,${alpha/255})`;
    ctx.lineWidth = Math.max(2, Math.floor(max_th*(1-k)));
    ctx.strokeRect(x+inset+0.5, y+inset+0.5, w-inset*2-1, h-inset*2-1);
    // 轻内填充
    const fillA = Math.max(20, Math.floor(alpha/6));
    ctx.fillStyle = `rgba(210,50,50,${fillA/255})`;
    ctx.fillRect(x+inset+3, y+inset+3, w-(inset+3)*2, h-(inset+3)*2);
  }
}