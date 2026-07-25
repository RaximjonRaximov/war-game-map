const RAW_COUNTRIES = [
  { id: 'ca', name: 'Canada', lat: 56.0, lon: -106.0, neighbors: ['us', 'ru'] },
  { id: 'us', name: 'United States', lat: 37.0, lon: -95.0, neighbors: ['ca', 'mx', 'br', 'gb', 'jp'] },
  { id: 'mx', name: 'Mexico', lat: 23.0, lon: -102.0, neighbors: ['us', 'br'] },
  { id: 'br', name: 'Brazil', lat: -14.0, lon: -51.0, neighbors: ['us', 'mx', 'ar', 'za'] },
  { id: 'ar', name: 'Argentina', lat: -38.0, lon: -63.0, neighbors: ['br'] },
  { id: 'gb', name: 'United Kingdom', lat: 54.0, lon: -2.0, neighbors: ['us', 'fr', 'de', 'ru'] },
  { id: 'fr', name: 'France', lat: 46.0, lon: 2.0, neighbors: ['gb', 'de', 'eg'] },
  { id: 'de', name: 'Germany', lat: 51.0, lon: 10.0, neighbors: ['gb', 'fr', 'ua', 'tr'] },
  { id: 'ua', name: 'Ukraine', lat: 49.0, lon: 31.0, neighbors: ['de', 'ru', 'tr', 'ir'] },
  { id: 'tr', name: 'Turkey', lat: 39.0, lon: 35.0, neighbors: ['ua', 'de', 'ir', 'eg', 'sa'] },
  { id: 'ir', name: 'Iran', lat: 32.0, lon: 53.0, neighbors: ['ua', 'tr', 'sa', 'pk', 'in'] },
  { id: 'sa', name: 'Saudi Arabia', lat: 24.0, lon: 45.0, neighbors: ['tr', 'ir', 'eg', 'pk', 'za'] },
  { id: 'pk', name: 'Pakistan', lat: 30.0, lon: 69.0, neighbors: ['ir', 'sa', 'in', 'cn'] },
  { id: 'in', name: 'India', lat: 20.0, lon: 78.0, neighbors: ['ir', 'pk', 'cn', 'id', 'za'] },
  { id: 'cn', name: 'China', lat: 35.0, lon: 104.0, neighbors: ['ru', 'pk', 'in', 'jp', 'id', 'au'] },
  { id: 'jp', name: 'Japan', lat: 36.0, lon: 138.0, neighbors: ['us', 'cn', 'id'] },
  { id: 'id', name: 'Indonesia', lat: -2.0, lon: 118.0, neighbors: ['cn', 'in', 'jp', 'au'] },
  { id: 'au', name: 'Australia', lat: -25.0, lon: 133.0, neighbors: ['cn', 'id', 'za'] },
  { id: 'eg', name: 'Egypt', lat: 26.0, lon: 30.0, neighbors: ['tr', 'sa', 'za', 'fr'] },
  { id: 'za', name: 'South Africa', lat: -29.0, lon: 24.0, neighbors: ['eg', 'sa', 'br', 'au', 'in'] },
  { id: 'ru', name: 'Russia', lat: 61.0, lon: 105.0, neighbors: ['ca', 'us', 'gb', 'de', 'ua', 'ir', 'cn', 'jp'] },
];

const countryById = new Map(RAW_COUNTRIES.map((c) => [c.id, c]));

let statusEl, infoEl, logEl, endBtn, soloBtn, restartBtn, roomInput, joinRoomBtn;
let ws;
let state = null;
let serverById = new Map();
let myId = null;
let myColor = null;
let selectedId = null;
let lastPhase = null;
let currentRoom = 'default';

let map;
let markers = {};
let labels = {};
let connectionLines = [];

function teamColor(team) {
  if (team === 'blue') return '#1976d2';
  if (team === 'red') return '#d32f2f';
  if (team === 'green') return '#388e3c';
  if (team === 'purple') return '#7b1fa2';
  if (team === 'orange') return '#f57c00';
  return '#616161';
}

function colorName(team) {
  if (team === 'blue') return 'ko\'k';
  if (team === 'red') return 'qizil';
  if (team === 'green') return 'yashil';
  if (team === 'purple') return 'siyohrang';
  if (team === 'orange') return 'to\'q sariq';
  return 'kulrang';
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

function addLog(text) {
  if (!logEl) return;
  const entry = document.createElement('div');
  entry.className = 'log-entry';
  entry.textContent = text;
  logEl.prepend(entry);
  while (logEl.children.length > 30) {
    logEl.removeChild(logEl.lastChild);
  }
}

function init() {
  statusEl = document.getElementById('status');
  infoEl = document.getElementById('info');
  logEl = document.getElementById('log');
  endBtn = document.getElementById('end-turn');
  soloBtn = document.getElementById('solo');
  restartBtn = document.getElementById('restart');
  roomInput = document.getElementById('room-code');
  joinRoomBtn = document.getElementById('join-room');

  const params = new URLSearchParams(location.search);
  currentRoom = params.get('room') || 'default';
  roomInput.value = currentRoom;

  endBtn.addEventListener('click', () => send({ type: 'end_turn' }));
  soloBtn.addEventListener('click', () => send({ type: 'start_solo' }));
  restartBtn.addEventListener('click', () => send({ type: 'restart' }));
  joinRoomBtn.addEventListener('click', () => {
    const room = roomInput.value.trim() || 'default';
    location.search = `?room=${encodeURIComponent(room)}`;
  });
  window.addEventListener('beforeunload', () => { if (ws) ws.close(); });
  window.addEventListener('pagehide', () => { if (ws) ws.close(); });

  initMap();
  connect();
}

function initMap() {
  map = L.map('map', { minZoom: 2, maxZoom: 8, worldCopyJump: true }).setView([20, 0], 2);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
    noWrap: false,
  }).addTo(map);

  for (const c of RAW_COUNTRIES) {
    const marker = L.circleMarker([c.lat, c.lon], {
      radius: 10,
      fillColor: '#616161',
      color: '#fff',
      weight: 1,
      opacity: 0.8,
      fillOpacity: 0.9,
    }).addTo(map);

    marker.bindTooltip('', { permanent: true, direction: 'top', className: 'country-label', offset: [0, -8] });
    marker.on('click', () => handleCountryClick(c.id));

    markers[c.id] = marker;
  }
}

function updateMap() {
  for (const c of RAW_COUNTRIES) {
    const country = getCountry(c.id);
    const marker = markers[c.id];
    if (!marker || !country) continue;

    const isMine = country.team === myColor;
    const isSelected = selectedId === c.id;
    const color = teamColor(country.team);
    const radius = Math.max(8, Math.min(20, 8 + country.armies / 2));

    marker.setStyle({
      fillColor: color,
      color: isSelected ? '#fff' : '#222',
      weight: isSelected ? 3 : 1,
      radius,
    });
    marker.setTooltipContent(`${country.name}<br>Qo'shin: ${country.armies}`);
  }
  drawConnections();
}

function drawConnections() {
  for (const line of connectionLines) map.removeLayer(line);
  connectionLines = [];

  if (!state || state.phase !== 'play' || !selectedId) return;
  const selected = getCountry(selectedId);
  if (!selected || selected.team !== myColor) return;

  for (const nid of selected.neighbors) {
    const neighbor = getCountry(nid);
    if (!neighbor) continue;
    const isEnemy = neighbor.team !== myColor;
    const line = L.polyline([[selected.lat, selected.lon], [neighbor.lat, neighbor.lon]], {
      color: isEnemy ? '#ffeb3b' : '#555',
      weight: isEnemy ? 2 : 1,
      dashArray: isEnemy ? '5, 8' : null,
      opacity: isEnemy ? 0.9 : 0.4,
    }).addTo(map);
    connectionLines.push(line);
  }
}

function handleCountryClick(id) {
  if (!state || myId === null) return;
  const me = state.players.find((p) => p.id === myId);
  if (!me) return;

  const country = getCountry(id);
  if (!country) return;

  if (state.phase === 'select') {
    if (!me.country_id && country.team === 'neutral') {
      send({ type: 'select', country: id });
    }
    return;
  }

  if (state.phase !== 'play' || state.turn !== myId) return;

  if (!selectedId) {
    if (country.team === myColor && country.armies > 1) {
      selectedId = id;
    }
  } else {
    const selected = getCountry(selectedId);
    if (id === selectedId) {
      selectedId = null;
    } else if (country.team === myColor) {
      selectedId = id;
    } else if (selected && selected.neighbors.includes(id)) {
      send({ type: 'attack', from: selectedId, to: id });
      selectedId = null;
    }
  }
  updateUI();
  updateMap();
}

function connect() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${location.host}/ws?room=${encodeURIComponent(currentRoom)}`;
  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    statusEl.textContent = 'Serverga ulanmoqda...';
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
      if (state.phase !== 'play') selectedId = null;
      if (state.phase === 'select' && lastPhase && lastPhase !== 'select') {
        logEl.innerHTML = '';
      }
      lastPhase = state.phase;
      updateUI();
      updateMap();
    }
    if (msg.type === 'spectator') {
      infoEl.textContent = msg.message;
    }
    if (msg.type === 'event') {
      addLog(msg.text);
    }
  };

  ws.onclose = () => {
    statusEl.textContent = 'Ulanish uzildi — qayta ulanmoqda...';
    myId = null;
    myColor = null;
    selectedId = null;
    setTimeout(connect, 2000);
  };

  ws.onerror = () => {
    statusEl.textContent = 'Ulanish xatosi';
  };
}

function updateUI() {
  if (!state) {
    statusEl.textContent = 'Ulanmoqda...';
    return;
  }

  if (myId === null) {
    statusEl.textContent = `Tomoshabin — ${state.players.length}/2 o'yinchilar`;
    infoEl.textContent = 'Siz o\'yinni tomosha qilyapsiz.';
    endBtn.classList.add('hidden');
    soloBtn.classList.add('hidden');
    restartBtn.classList.add('hidden');
    return;
  }

  const me = state.players.find((p) => p.id === myId);

  if (state.phase === 'select') {
    statusEl.textContent = `Mamlakat tanlang — ${state.players.length}/2 o'yinchilar`;
    endBtn.classList.add('hidden');
    restartBtn.classList.add('hidden');
    soloBtn.classList.add('hidden');
    if (!me) {
      infoEl.textContent = 'Bo\'sh joy kutilmoqda...';
    } else if (!me.country_id) {
      infoEl.textContent = 'Xaritada neutral davlatga bosing, uning sifatida o\'ynang (masalan Rossiya). Neutral davlatlar kulrang.';
    } else if (state.players.length === 1) {
      infoEl.textContent = '"AI ga qarshi o\'ynash" ni bosing yoki ikkinchi o\'yinchini kuting.';
      soloBtn.classList.remove('hidden');
    } else {
      infoEl.textContent = 'Raqib mamlakat tanlashini kutilmoqda...';
    }
    return;
  }

  if (state.phase === 'play') {
    const turnPlayer = state.players.find((p) => p.id === state.turn);
    if (turnPlayer && turnPlayer.id === myId) {
      statusEl.textContent = 'Sizning navbatingiz';
      const attacker = selectedId ? getCountry(selectedId) : null;
      if (attacker && attacker.team === myColor) {
        infoEl.textContent = `${attacker.name} dan hujum qilinyapti. Ulangan dushman davlatga bosing yoki "Navbatni yakunlash" ni bosing.`;
      } else {
        infoEl.textContent = `O'z mamlakatingizdan (rang ${colorName(myColor)}) 1 dan ko'p qo'shini bo'lganini tanlang, so'ngra ulangan dushmanga bosing.`;
      }
      endBtn.classList.remove('hidden');
    } else {
      statusEl.textContent = `${turnPlayer ? turnPlayer.name : 'Raqib'} navbati`;
      infoEl.textContent = 'Raqib kutilmoqda...';
      endBtn.classList.add('hidden');
    }
    soloBtn.classList.add('hidden');
    restartBtn.classList.add('hidden');
    return;
  }

  if (state.phase === 'over') {
    const winnerName = state.players.find((p) => p.color === state.winner)?.name || state.winner;
    if (myColor === state.winner) {
      statusEl.textContent = 'Siz yutdingiz!';
      infoEl.textContent = 'Dunyoni zabt etdingiz! Qayta o\'ynash uchun Qayta boshlash ni bosing.';
    } else {
      statusEl.textContent = `${winnerName} yutdi`;
      infoEl.textContent = 'O\'yin tugadi. Qayta o\'ynash uchun Qayta boshlash ni bosing.';
    }
    endBtn.classList.add('hidden');
    soloBtn.classList.add('hidden');
    restartBtn.classList.remove('hidden');
  }
}

init();
