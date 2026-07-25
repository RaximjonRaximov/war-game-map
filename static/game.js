const RAW_COUNTRIES = [
  { id: 'ca', name: 'Canada', x: 300, y: 160, neighbors: ['us', 'ru'] },
  { id: 'us', name: 'United States', x: 380, y: 300, neighbors: ['ca', 'mx', 'br', 'gb', 'jp'] },
  { id: 'mx', name: 'Mexico', x: 340, y: 420, neighbors: ['us', 'br'] },
  { id: 'br', name: 'Brazil', x: 520, y: 640, neighbors: ['us', 'mx', 'ar', 'za'] },
  { id: 'ar', name: 'Argentina', x: 500, y: 780, neighbors: ['br'] },
  { id: 'gb', name: 'United Kingdom', x: 700, y: 250, neighbors: ['us', 'fr', 'de', 'ru'] },
  { id: 'fr', name: 'France', x: 720, y: 320, neighbors: ['gb', 'de', 'eg'] },
  { id: 'de', name: 'Germany', x: 780, y: 270, neighbors: ['gb', 'fr', 'ua', 'tr'] },
  { id: 'ua', name: 'Ukraine', x: 870, y: 270, neighbors: ['de', 'ru', 'tr', 'ir'] },
  { id: 'tr', name: 'Turkey', x: 900, y: 350, neighbors: ['ua', 'de', 'ir', 'eg', 'sa'] },
  { id: 'ir', name: 'Iran', x: 970, y: 380, neighbors: ['ua', 'tr', 'sa', 'pk', 'in'] },
  { id: 'sa', name: 'Saudi Arabia', x: 920, y: 450, neighbors: ['tr', 'ir', 'eg', 'pk', 'za'] },
  { id: 'pk', name: 'Pakistan', x: 1030, y: 410, neighbors: ['ir', 'sa', 'in', 'cn'] },
  { id: 'in', name: 'India', x: 1080, y: 480, neighbors: ['ir', 'pk', 'cn', 'id', 'za'] },
  { id: 'cn', name: 'China', x: 1200, y: 390, neighbors: ['ru', 'pk', 'in', 'jp', 'id', 'au'] },
  { id: 'jp', name: 'Japan', x: 1350, y: 330, neighbors: ['us', 'cn', 'id'] },
  { id: 'id', name: 'Indonesia', x: 1220, y: 600, neighbors: ['cn', 'in', 'jp', 'au'] },
  { id: 'au', name: 'Australia', x: 1320, y: 760, neighbors: ['cn', 'id', 'za'] },
  { id: 'eg', name: 'Egypt', x: 840, y: 430, neighbors: ['tr', 'sa', 'za', 'fr'] },
  { id: 'za', name: 'South Africa', x: 850, y: 740, neighbors: ['eg', 'sa', 'br', 'au', 'in'] },
  { id: 'ru', name: 'Russia', x: 1110, y: 210, neighbors: ['ca', 'us', 'gb', 'de', 'ua', 'ir', 'cn', 'jp'] },
];

const countryById = new Map(RAW_COUNTRIES.map((c) => [c.id, c]));

let canvas, ctx, statusEl, infoEl, endBtn, restartBtn;
let ws;
let state = null;
let serverById = new Map();
let myId = null;
let myColor = null;
let selected = null;

function teamColor(team) {
  if (team === 'blue') return '#1976d2';
  if (team === 'red') return '#d32f2f';
  if (team === 'green') return '#388e3c';
  if (team === 'purple') return '#7b1fa2';
  if (team === 'orange') return '#f57c00';
  return '#616161';
}

function getPos(e) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  return {
    x: (e.clientX - rect.left) * scaleX,
    y: (e.clientY - rect.top) * scaleY,
  };
}

function getCountryAt(x, y) {
  for (const c of RAW_COUNTRIES) {
    const dx = c.x - x;
    const dy = c.y - y;
    if (Math.sqrt(dx * dx + dy * dy) <= 24) return c;
  }
  return null;
}

function getCountry(id) {
  const local = countryById.get(id);
  const server = serverById.get(id);
  if (!local) return null;
  return {
    ...local,
    team: server ? server.team : 'neutral',
    armies: server ? server.armies : 0,
  };
}

function send(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function init() {
  canvas = document.getElementById('map');
  ctx = canvas.getContext('2d');
  statusEl = document.getElementById('status');
  infoEl = document.getElementById('info');
  endBtn = document.getElementById('end-turn');
  restartBtn = document.getElementById('restart');

  canvas.addEventListener('pointerdown', handlePointer);
  endBtn.addEventListener('click', () => send({ type: 'end_turn' }));
  restartBtn.addEventListener('click', () => send({ type: 'restart' }));
  window.addEventListener('beforeunload', () => { if (ws) ws.close(); });
  window.addEventListener('pagehide', () => { if (ws) ws.close(); });

  connect();
  requestAnimationFrame(draw);
}

function connect() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${location.host}/ws`);

  ws.onopen = () => {
    statusEl.textContent = 'Connected — waiting for server';
  };

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type === 'assigned') {
      myId = msg.player_id;
      myColor = msg.color;
    }
    if (msg.type === 'state') {
      state = msg.state;
      serverById = new Map(state.countries.map((c) => [c.id, c]));
      if (state.phase !== 'play') selected = null;
      updateUI();
    }
    if (msg.type === 'spectator') {
      infoEl.textContent = msg.message;
    }
  };

  ws.onclose = () => {
    statusEl.textContent = 'Disconnected — reconnecting...';
    myId = null;
    myColor = null;
    setTimeout(connect, 2000);
  };

  ws.onerror = () => {
    statusEl.textContent = 'Connection error';
  };
}

function updateUI() {
  if (!state) {
    statusEl.textContent = 'Connecting...';
    return;
  }

  if (myId === null) {
    statusEl.textContent = `Spectator — ${state.players.length}/2 players`;
    infoEl.textContent = 'You are watching the game.';
    endBtn.classList.add('hidden');
    restartBtn.classList.add('hidden');
    return;
  }

  const me = state.players.find((p) => p.id === myId);

  if (state.phase === 'select') {
    const waiting = state.players.filter((p) => !p.country_id).length;
    statusEl.textContent = `Choose your country — ${state.players.length}/2 players`;
    if (!me) {
      infoEl.textContent = 'Waiting for an available slot...';
    } else if (!me.country_id) {
      infoEl.textContent = 'Click any neutral country to play as it (for example Russia).';
    } else {
      infoEl.textContent = 'Waiting for opponent to choose a country...';
    }
    endBtn.classList.add('hidden');
    restartBtn.classList.add('hidden');
    return;
  }

  if (state.phase === 'play') {
    const turnPlayer = state.players.find((p) => p.id === state.turn);
    if (turnPlayer && turnPlayer.id === myId) {
      statusEl.textContent = 'Your turn — attack or end turn';
      infoEl.textContent = 'Select one of your countries, then click a connected enemy to attack.';
      endBtn.classList.remove('hidden');
    } else {
      statusEl.textContent = `${turnPlayer ? turnPlayer.name : 'Opponent'}'s turn`;
      infoEl.textContent = 'Waiting for opponent...';
      endBtn.classList.add('hidden');
    }
    restartBtn.classList.add('hidden');
    return;
  }

  if (state.phase === 'over') {
    const winnerName = state.players.find((p) => p.color === state.winner)?.name || state.winner;
    if (myColor === state.winner) {
      statusEl.textContent = 'You won!';
      infoEl.textContent = 'You conquered the world!';
    } else {
      statusEl.textContent = `${winnerName} won`;
      infoEl.textContent = 'Game over. Click Restart to play again.';
    }
    endBtn.classList.add('hidden');
    restartBtn.classList.remove('hidden');
  }
}

function handlePointer(e) {
  e.preventDefault();
  if (!state || !myId) return;
  const { x, y } = getPos(e);
  const c = getCountryAt(x, y);
  if (!c) {
    if (state.phase === 'play' && state.turn === myId) selected = null;
    return;
  }

  if (state.phase === 'select') {
    const me = state.players.find((p) => p.id === myId);
    if (me && !me.country_id && getCountry(c.id).team === 'neutral') {
      send({ type: 'select', country: c.id });
    }
    return;
  }

  if (state.phase !== 'play' || state.turn !== myId) return;

  const country = getCountry(c.id);

  if (selected) {
    if (c.id === selected.id) {
      selected = null;
      return;
    }

    if (country.team === myColor) {
      selected = country;
      return;
    }

    if (selected.neighbors.includes(c.id) && selected.armies > 1) {
      send({ type: 'attack', from: selected.id, to: c.id });
      return;
    }

    selected = null;
    return;
  }

  if (country.team === myColor && country.armies > 1) {
    selected = country;
  }
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (state) {
    for (const c of RAW_COUNTRIES) {
      for (const nId of c.neighbors) {
        if (c.id < nId) {
          const n = countryById.get(nId);
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(c.x, c.y);
          ctx.lineTo(n.x, n.y);
          ctx.stroke();
        }
      }
    }

    for (const c of RAW_COUNTRIES) {
      drawCountry(getCountry(c.id));
    }
  }

  if (!state || state.phase === 'select') {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.font = 'bold 40px Arial';
    const line1 = state ? 'Choose your country' : 'Connecting...';
    ctx.fillText(line1, canvas.width / 2, canvas.height / 2 - 20);
    if (state) {
      ctx.font = '20px Arial';
      ctx.fillText('Open this page in two tabs to play together', canvas.width / 2, canvas.height / 2 + 30);
    }
  }

  if (state && state.phase === 'over') {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 44px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('GAME OVER', canvas.width / 2, canvas.height / 2 - 20);
    ctx.font = '24px Arial';
    const winner = state.players.find((p) => p.color === state.winner)?.name || state.winner;
    ctx.fillText(`${winner.toUpperCase()} WINS`, canvas.width / 2, canvas.height / 2 + 30);
  }

  requestAnimationFrame(draw);
}

function drawCountry(c) {
  if (!c) return;
  const r = 18;
  const isSelected = selected && selected.id === c.id;
  const isAttackable =
    selected &&
    selected.team === myColor &&
    selected.neighbors.includes(c.id) &&
    c.team !== myColor &&
    selected.armies > 1;

  ctx.beginPath();
  ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
  ctx.fillStyle = teamColor(c.team);
  ctx.fill();

  ctx.strokeStyle = isAttackable ? '#ff1744' : isSelected ? '#ffeb3b' : '#fff';
  ctx.lineWidth = isSelected || isAttackable ? 4 : 2;
  ctx.stroke();

  ctx.fillStyle = '#fff';
  ctx.font = 'bold 12px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(c.name, c.x, c.y - r - 6);

  ctx.fillStyle = '#fff';
  ctx.font = 'bold 14px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(c.armies, c.x, c.y + 1);
  ctx.textBaseline = 'alphabetic';
}

init();
