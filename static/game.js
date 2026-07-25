const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const statusEl = document.getElementById('status');
const roomInput = document.getElementById('room-code');
const joinBtn = document.getElementById('join-room');
const hudEl = document.getElementById('hud');
const healthBar = document.getElementById('health-bar');
const statsEl = document.getElementById('stats');
const timerEl = document.getElementById('timer');
const scoreEl = document.getElementById('score');
const leaderboardEl = document.getElementById('leaderboard');
const winnerEl = document.getElementById('winner');

const keys = {};
let mouse = { x: 0, y: 0 };
let shooting = false;
let currentRoom = 'default';
let ws = null;
let state = null;
let mapData = null;
let myId = null;
let myColor = null;
let lastInput = { dx: 0, dy: 0, angle: 0, shoot: false };

const CAM_SCALE = 1.5;

function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}

function colorHex(color) {
  if (color === 'blue') return '#2196f3';
  if (color === 'red') return '#f44336';
  return '#616161';
}

function getCamera(me) {
  if (!mapData || !me) return { x: 0, y: 0 };
  const w = mapData.cols * mapData.tile;
  const h = mapData.rows * mapData.tile;
  const halfW = (canvas.width / 2) / CAM_SCALE;
  const halfH = (canvas.height / 2) / CAM_SCALE;
  return {
    x: Math.max(halfW, Math.min(me.x, w - halfW)),
    y: Math.max(halfH, Math.min(me.y, h - halfH)),
  };
}

function screenToWorld(sx, sy, cam) {
  return {
    x: (sx - (canvas.width / 2 - cam.x * CAM_SCALE)) / CAM_SCALE,
    y: (sy - (canvas.height / 2 - cam.y * CAM_SCALE)) / CAM_SCALE,
  };
}

function send(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function connect() {
  const params = new URLSearchParams(location.search);
  currentRoom = params.get('room') || 'default';
  roomInput.value = currentRoom;

  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${location.host}/ws?room=${encodeURIComponent(currentRoom)}`);

  ws.onopen = () => {
    statusEl.textContent = 'Ulandi — xona: ' + currentRoom;
  };

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type === 'assigned') {
      myId = msg.player_id;
      myColor = msg.color;
      hudEl.classList.remove('hidden');
    }
    if (msg.type === 'map') {
      mapData = msg;
    }
    if (msg.type === 'state') {
      state = msg.state;
    }
  };

  ws.onclose = () => {
    statusEl.textContent = 'Ulanish uzildi — qayta ulanmoqda...';
    myId = null;
    myColor = null;
    hudEl.classList.add('hidden');
    setTimeout(connect, 2000);
  };

  ws.onerror = () => {
    statusEl.textContent = 'Ulanish xatosi';
  };
}

function updateInput() {
  let dx = 0;
  let dy = 0;
  if (keys['KeyW'] || keys['ArrowUp']) dy -= 1;
  if (keys['KeyS'] || keys['ArrowDown']) dy += 1;
  if (keys['KeyA'] || keys['ArrowLeft']) dx -= 1;
  if (keys['KeyD'] || keys['ArrowRight']) dx += 1;

  const me = state ? state.players.find((p) => p.id === myId) : null;
  let angle = lastInput.angle;
  if (me && mapData) {
    const cam = getCamera(me);
    const pos = screenToWorld(mouse.x, mouse.y, cam);
    angle = Math.atan2(pos.y - me.y, pos.x - me.x);
  }

  const input = { dx, dy, angle, shoot: shooting };
  if (
    input.dx !== lastInput.dx ||
    input.dy !== lastInput.dy ||
    Math.abs(input.angle - lastInput.angle) > 0.02 ||
    input.shoot !== lastInput.shoot
  ) {
    send({ type: 'input', ...input });
    lastInput = input;
  }
}

function drawMap(cam) {
  if (!mapData) return;
  const tile = mapData.tile;
  const cols = mapData.cols;
  const rows = mapData.rows;

  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(0, 0, cols * tile, rows * tile);

  for (let y = 0; y < rows; y++) {
    const row = mapData.tiles[y];
    for (let x = 0; x < cols; x++) {
      const ch = row[x];
      const px = x * tile;
      const py = y * tile;
      if (ch === '#') {
        ctx.fillStyle = '#444';
        ctx.fillRect(px, py, tile, tile);
        ctx.strokeStyle = '#555';
        ctx.strokeRect(px, py, tile, tile);
      } else {
        ctx.fillStyle = '#222';
        ctx.fillRect(px, py, tile, tile);
        if (ch === 'A' || ch === 'B') {
          ctx.fillStyle = ch === 'A' ? 'rgba(33,150,243,0.15)' : 'rgba(244,67,54,0.15)';
          ctx.fillRect(px, py, tile, tile);
        }
      }
    }
  }
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const me = state ? state.players.find((p) => p.id === myId) : null;
  const cam = getCamera(me);

  ctx.save();
  ctx.setTransform(CAM_SCALE, 0, 0, CAM_SCALE, canvas.width / 2 - cam.x * CAM_SCALE, canvas.height / 2 - cam.y * CAM_SCALE);
  drawMap(cam);

  if (state) {
    for (const b of state.bullets) {
      ctx.beginPath();
      ctx.arc(b.x, b.y, 3, 0, Math.PI * 2);
      ctx.fillStyle = '#ffeb3b';
      ctx.fill();
    }

    for (const p of state.players) {
      const c = colorHex(p.color);
      const blink = p.invuln > 0 && Math.floor(Date.now() / 100) % 2 === 0;
      ctx.globalAlpha = blink ? 0.4 : 1;

      ctx.beginPath();
      ctx.arc(p.x, p.y, 10, 0, Math.PI * 2);
      ctx.fillStyle = c;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#fff';
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x + Math.cos(p.angle) * 18, p.y + Math.sin(p.angle) * 18);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 3;
      ctx.stroke();

      ctx.fillStyle = '#000';
      ctx.fillRect(p.x - 16, p.y - 24, 32, 5);
      ctx.fillStyle = p.health > 50 ? '#4caf50' : p.health > 25 ? '#ff9800' : '#f44336';
      ctx.fillRect(p.x - 16, p.y - 24, (p.health / 100) * 32, 5);

      ctx.fillStyle = '#fff';
      ctx.font = '12px Arial';
      ctx.textAlign = 'center';
      ctx.fillText(p.name, p.x, p.y - 28);

      ctx.globalAlpha = 1;
    }
  }

  ctx.restore();

  // crosshair
  ctx.strokeStyle = '#ffeb3b';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(mouse.x - 8, mouse.y);
  ctx.lineTo(mouse.x + 8, mouse.y);
  ctx.moveTo(mouse.x, mouse.y - 8);
  ctx.lineTo(mouse.x, mouse.y + 8);
  ctx.stroke();
}

function updateHUD() {
  if (!state) return;
  const me = state.players.find((p) => p.id === myId);
  if (me) {
    healthBar.style.width = `${me.health}%`;
    statsEl.textContent = `${me.kills} / ${me.deaths}`;
  }

  const minutes = Math.floor(state.time_left / 60).toString().padStart(2, '0');
  const seconds = (state.time_left % 60).toString().padStart(2, '0');
  timerEl.textContent = `${minutes}:${seconds}`;
  scoreEl.innerHTML = `<span class="ct">CT ${state.scores.ct}</span> : <span class="t">${state.scores.t} T</span>`;

  const sorted = [...state.players].sort((a, b) => b.kills - a.kills);
  let html = '<h3>Tablo</h3>';
  for (const p of sorted) {
    const mark = p.id === myId ? '▸ ' : '';
    html += `<div class="row"><span style="color:${colorHex(p.color)}">${mark}${p.name}</span><span>${p.kills}</span></div>`;
  }
  leaderboardEl.innerHTML = html;

  if (state.phase === 'over') {
    winnerEl.classList.remove('hidden');
    const teamName = state.winner === 'ct' ? 'CT jamoasi' : state.winner === 't' ? 'T jamoasi' : "Durang";
    winnerEl.textContent = `${teamName} g'olib!`;
    if (state.winner === 'draw') winnerEl.textContent = 'Durang!';
  } else {
    winnerEl.classList.add('hidden');
  }
}

function loop() {
  updateInput();
  draw();
  updateHUD();
  requestAnimationFrame(loop);
}

function init() {
  resize();
  window.addEventListener('resize', resize);

  window.addEventListener('keydown', (e) => {
    keys[e.code] = true;
    if (e.code === 'Space') {
      shooting = true;
    }
  });

  window.addEventListener('keyup', (e) => {
    keys[e.code] = false;
    if (e.code === 'Space') {
      shooting = false;
    }
  });

  window.addEventListener('mousemove', (e) => {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
  });

  window.addEventListener('mousedown', () => {
    shooting = true;
  });

  window.addEventListener('mouseup', () => {
    shooting = false;
  });

  joinBtn.addEventListener('click', () => {
    const room = roomInput.value.trim() || 'default';
    location.search = `?room=${encodeURIComponent(room)}`;
  });

  connect();
  requestAnimationFrame(loop);
}

init();
