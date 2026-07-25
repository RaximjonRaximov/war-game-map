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

class Country {
  constructor(data) {
    this.id = data.id;
    this.name = data.name;
    this.x = data.x;
    this.y = data.y;
    this.neighbors = data.neighbors || [];
    this.team = 'neutral';
    this.armies = 0;
  }
}

let canvas, ctx, statusEl, infoEl, endBtn, restartBtn;
let bg = new Image();
bg.src = 'assets/world-map.jpg';
let countries = [];
let phase = 'select';
let turn = 'blue';
let selected = null;
let gameOver = false;

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
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
  endBtn.addEventListener('click', endTurn);
  restartBtn.addEventListener('click', newGame);

  initCountries();

  if (bg.complete) {
    startLoop();
  } else {
    bg.onload = startLoop;
  }
}

function startLoop() {
  newGame();
  requestAnimationFrame(draw);
}

function initCountries() {
  countries = RAW_COUNTRIES.map((c) => new Country(c));
  const byId = new Map(countries.map((c) => [c.id, c]));
  for (const c of countries) {
    c.neighbors = c.neighbors.map((id) => byId.get(id)).filter(Boolean);
  }
}

function newGame() {
  phase = 'select';
  turn = 'blue';
  selected = null;
  gameOver = false;
  for (const c of countries) {
    c.team = 'neutral';
    c.armies = 0;
  }
  endBtn.classList.add('hidden');
  restartBtn.classList.add('hidden');
  updateStatus('Choose your country');
  infoEl.textContent = 'Click any country on the map to start as it (for example Russia).';
}

function startGame(playerCountry) {
  playerCountry.team = 'blue';
  playerCountry.armies = 12;

  const others = countries.filter((c) => c !== playerCountry);
  shuffle(others);
  for (let i = 0; i < 3; i++) {
    others[i].team = 'red';
    others[i].armies = 8;
  }

  for (const c of countries) {
    if (c.team === 'neutral') c.armies = randInt(2, 4);
  }

  phase = 'play';
  startTurn('blue');
  selected = playerCountry;
  infoEl.textContent = `${playerCountry.name} selected. Click a connected red or gray country to attack.`;
}

function startTurn(team) {
  if (phase !== 'play') return;
  turn = team;
  selected = null;

  const owned = countries.filter((c) => c.team === team);
  const reinforce = Math.max(3, Math.floor(owned.length / 2));
  for (let i = 0; i < reinforce; i++) {
    const c = owned[Math.floor(Math.random() * owned.length)];
    if (c) c.armies++;
  }

  updateStatus(`${team === 'blue' ? 'Blue' : 'Red'} turn — reinforcements added`);
  infoEl.textContent =
    team === 'blue'
      ? 'Select one of your countries, then click a connected enemy to attack.'
      : 'Enemy is thinking...';
  endBtn.classList.toggle('hidden', team !== 'blue' || gameOver);
  restartBtn.classList.add('hidden');

  if (team === 'red') {
    setTimeout(aiTurn, 800);
  }
}

function endTurn() {
  if (phase !== 'play' || turn !== 'blue' || gameOver) return;
  selected = null;
  startTurn('red');
}

function aiTurn() {
  if (gameOver) return;

  for (let safety = 0; safety < 40; safety++) {
    let acted = false;
    for (const c of countries) {
      if (c.team !== 'red' || c.armies <= 1) continue;
      const targets = c.neighbors
        .filter((n) => n.team !== 'red' && n.armies < c.armies)
        .sort((a, b) => a.armies - b.armies);
      if (targets.length) {
        battle(c, targets[0]);
        acted = true;
        if (gameOver) return;
      }
    }
    if (!acted) break;
  }

  if (!gameOver) startTurn('blue');
}

function rollDice(n) {
  const rolls = [];
  for (let i = 0; i < n; i++) rolls.push(randInt(1, 6));
  return rolls.sort((a, b) => b - a);
}

function battle(attacker, defender) {
  if (attacker.armies <= 1 || gameOver) return false;

  while (attacker.armies > 1 && defender.armies > 0) {
    const aDice = Math.min(3, attacker.armies - 1);
    const dDice = Math.min(2, defender.armies);
    const aRolls = rollDice(aDice);
    const dRolls = rollDice(dDice);

    for (let i = 0; i < Math.min(aRolls.length, dRolls.length); i++) {
      if (aRolls[i] > dRolls[i]) {
        defender.armies--;
      } else {
        attacker.armies--;
      }
    }
  }

  if (defender.armies <= 0) {
    defender.team = attacker.team;
    defender.armies = attacker.armies - 1;
    attacker.armies = 1;
    infoEl.textContent = `${attacker.name} conquered ${defender.name}!`;
  } else {
    infoEl.textContent = `${defender.name} defended against ${attacker.name}.`;
  }

  checkWin();
  return defender.team === attacker.team;
}

function checkWin() {
  const teams = new Set(countries.map((c) => c.team).filter((t) => t !== 'neutral'));
  if (teams.size === 1) {
    const winner = [...teams][0];
    gameOver = true;
    phase = 'over';
    updateStatus(`${winner.toUpperCase()} CONQUERS THE WORLD!`);
    infoEl.textContent = winner === 'blue' ? 'You won! Click Restart to play again.' : 'Enemy won. Click Restart to try again.';
    endBtn.classList.add('hidden');
    restartBtn.classList.remove('hidden');
  }
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
  for (const c of countries) {
    const dx = c.x - x;
    const dy = c.y - y;
    if (Math.sqrt(dx * dx + dy * dy) <= 24) return c;
  }
  return null;
}

function handlePointer(e) {
  e.preventDefault();
  const { x, y } = getPos(e);

  if (phase === 'over') return;

  if (phase === 'select') {
    const c = getCountryAt(x, y);
    if (c) startGame(c);
    return;
  }

  if (turn !== 'blue' || gameOver) return;

  const c = getCountryAt(x, y);
  if (!c) {
    selected = null;
    return;
  }

  if (selected) {
    if (c === selected) {
      selected = null;
      return;
    }

    if (c.team === 'blue') {
      selected = c;
      return;
    }

    if (selected.neighbors.includes(c) && selected.armies > 1) {
      battle(selected, c);
      if (!selected || selected.armies <= 1) selected = null;
      return;
    }

    selected = null;
    return;
  }

  if (c.team === 'blue' && c.armies > 1) {
    selected = c;
  }
}

function teamColor(team) {
  if (team === 'blue') return '#1976d2';
  if (team === 'red') return '#d32f2f';
  return '#616161';
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (bg.complete && bg.naturalWidth) {
    ctx.drawImage(bg, 0, 0, canvas.width, canvas.height);
  }

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
  ctx.lineWidth = 2;
  for (const c of countries) {
    for (const n of c.neighbors) {
      if (c.id < n.id) {
        ctx.beginPath();
        ctx.moveTo(c.x, c.y);
        ctx.lineTo(n.x, n.y);
        ctx.stroke();
      }
    }
  }

  for (const c of countries) {
    drawCountry(c);
  }

  if (phase === 'select') {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.font = 'bold 40px Arial';
    ctx.fillText('Choose your country', canvas.width / 2, canvas.height / 2 - 30);
    ctx.font = '20px Arial';
    ctx.fillText('(for example, click Russia)', canvas.width / 2, canvas.height / 2 + 20);
  }

  if (gameOver) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 44px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('GAME OVER', canvas.width / 2, canvas.height / 2 - 20);
    ctx.font = '22px Arial';
    ctx.fillText(statusEl.textContent, canvas.width / 2, canvas.height / 2 + 30);
  }

  requestAnimationFrame(draw);
}

function drawCountry(c) {
  const r = 18;
  const isSelected = selected === c;
  const isAttackable = selected && selected.team === 'blue' && selected.neighbors.includes(c) && c.team !== 'blue' && selected.armies > 1;

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

function updateStatus(msg) {
  statusEl.textContent = msg;
}

init();
