const WORLD_W = 1280;
const WORLD_H = 697;

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const statusEl = document.getElementById('status');
const roomInput = document.getElementById('room-code');
const joinBtn = document.getElementById('join-room');
const hudEl = document.getElementById('hud');
const healthBar = document.getElementById('health-bar');
const statsEl = document.getElementById('stats');
const leaderboardEl = document.getElementById('leaderboard');

const bg = new Image();
bg.src = 'world_map.png';

const keys = {};
let mouse = { x: 0, y: 0 };
let shooting = false;
let currentRoom = 'default';
let ws = null;
let state = null;
let myId = null;
let myColor = null;
let connected = false;
let lastInput = { dx: 0, dy: 0, angle: 0, shoot: false };

function colorHex(color) {
  if (color === 'blue') return '#1976d2';
  if (color === 'red') return '#d32f2f';
  if (color === 'green') return '#388e3c';
  if (color === 'purple') return '#7b1fa2';
  if (color === 'orange') return '#f57c00';
  return '#616161';
}

function getScale() {
  const scaleX = canvas.width / WORLD_W;
  const scaleY = canvas.height / WORLD_H;
  return Math.min(scaleX, scaleY);
}

function getOffset() {
  const s = getScale();
  return {
    x: (canvas.width - WORLD_W * s) / 2,
    y: (canvas.height - WORLD_H * s) / 2,
  };
}

function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}

function worldPos(clientX, clientY) {
  const s = getScale();
  const off = getOffset();
  return {
    x: (clientX - off.x) / s,
    y: (clientY - off.y) / s,
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
    connected = true;
  };

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type === 'assigned') {
      myId = msg.player_id;
      myColor = msg.color;
      hudEl.classList.remove('hidden');
    }
    if (msg.type === 'state') {
      state = msg.state;
    }
  };

  ws.onclose = () => {
    statusEl.textContent = 'Ulanish uzildi — qayta ulanmoqda...';
    connected = false;
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
  if (me) {
    const pos = worldPos(mouse.x, mouse.y);
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

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const s = getScale();
  const off = getOffset();

  if (bg.complete && bg.naturalWidth) {
    ctx.drawImage(bg, off.x, off.y, WORLD_W * s, WORLD_H * s);
  } else {
    ctx.fillStyle = '#0b1020';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  ctx.save();
  ctx.translate(off.x, off.y);
  ctx.scale(s, s);

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
      ctx.fillRect(p.x - 16, p.y - 22, 32, 5);
      ctx.fillStyle = p.health > 50 ? '#4caf50' : p.health > 25 ? '#ff9800' : '#f44336';
      ctx.fillRect(p.x - 16, p.y - 22, (p.health / 100) * 32, 5);

      ctx.fillStyle = '#fff';
      ctx.font = '12px Arial';
      ctx.textAlign = 'center';
      ctx.fillText(p.name, p.x, p.y - 26);

      ctx.globalAlpha = 1;
    }
  }

  ctx.restore();
}

function updateHUD() {
  if (!state || myId === null) return;
  const me = state.players.find((p) => p.id === myId);
  if (!me) return;
  healthBar.style.width = `${me.health}%`;
  statsEl.textContent = `${me.kills} ta o'ldirish / ${me.deaths} ta o'lim`;

  const sorted = [...state.players].sort((a, b) => b.kills - a.kills);
  let html = '<h3>Tablo</h3>';
  for (const p of sorted) {
    const mark = p.id === myId ? '▸ ' : '';
    html += `<div class="row"><span>${mark}${p.name}</span><span>${p.kills}</span></div>`;
  }
  leaderboardEl.innerHTML = html;
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

  bg.onload = () => {
    draw();
  };

  connect();
  requestAnimationFrame(loop);
}

init();
