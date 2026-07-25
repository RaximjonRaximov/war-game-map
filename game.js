const COLS = 20;
const ROWS = 15;
const TILE = 40;

const TERRAIN = {
  grass: { color: '#4caf50', move: 1 },
  forest: { color: '#2e7d32', move: 2 },
  mountain: { color: '#757575', move: Infinity },
  water: { color: '#2196f3', move: Infinity },
};

const DIRS = [
  { x: 0, y: -1 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
  { x: 1, y: 0 },
];

class Base {
  constructor(team, x, y) {
    this.team = team;
    this.x = x;
    this.y = y;
    this.hp = 20;
    this.maxHp = 20;
  }
}

class Unit {
  constructor(team, x, y, type = 'infantry') {
    this.team = team;
    this.x = x;
    this.y = y;
    this.type = type;
    this.maxHp = type === 'tank' ? 14 : 8;
    this.hp = this.maxHp;
    this.attack = type === 'tank' ? 5 : 3;
    this.move = type === 'tank' ? 3 : 2;
    this.moved = false;
    this.attacked = false;
  }
}

let canvas, ctx, statusEl, infoEl, endBtn, restartBtn;
let map = [];
let units = [];
let bases = [];
let turn = 'blue';
let selected = null;
let reachable = new Map();
let gameOver = false;

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function inBounds(x, y) {
  return x >= 0 && x < COLS && y >= 0 && y < ROWS;
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
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

  newGame();
  requestAnimationFrame(draw);
}

function generateMap() {
  map = [];
  for (let y = 0; y < ROWS; y++) {
    map[y] = [];
    for (let x = 0; x < COLS; x++) {
      map[y][x] = { terrain: 'grass', unit: null, base: null };
    }
  }

  for (let i = 0; i < 50; i++) addCluster('forest', 3);
  for (let i = 0; i < 12; i++) addCluster('mountain', 2);
  for (let i = 0; i < 8; i++) addCluster('water', 3);
}

function addCluster(type, size) {
  const startX = randInt(0, COLS - 1);
  const startY = randInt(0, ROWS - 1);
  for (let i = 0; i < size; i++) {
    const x = Math.min(Math.max(startX + randInt(-2, 2), 0), COLS - 1);
    const y = Math.min(Math.max(startY + randInt(-2, 2), 0), ROWS - 1);
    map[y][x].terrain = type;
  }
}

function setTerrainZone(sx, sy, w, h, type) {
  for (let y = sy; y < sy + h; y++) {
    for (let x = sx; x < sx + w; x++) {
      if (inBounds(x, y) && !map[y][x].base) {
        map[y][x].terrain = type;
      }
    }
  }
}

function newGame() {
  generateMap();
  units = [];
  bases = [];
  gameOver = false;
  turn = 'blue';
  selected = null;
  reachable.clear();

  endBtn.classList.remove('hidden');
  restartBtn.classList.add('hidden');

  addBase('blue', 1, 1);
  addBase('red', COLS - 2, ROWS - 2);

  setTerrainZone(0, 0, 3, 3, 'grass');
  setTerrainZone(COLS - 3, ROWS - 3, 3, 3, 'grass');

  addUnit('blue', 1, 2, 'tank');
  addUnit('blue', 2, 1, 'infantry');
  addUnit('blue', 2, 2, 'infantry');

  addUnit('red', COLS - 2, ROWS - 3, 'tank');
  addUnit('red', COLS - 3, ROWS - 2, 'infantry');
  addUnit('red', COLS - 3, ROWS - 3, 'infantry');

  updateStatus();
  infoEl.textContent = 'Select a blue unit to begin.';
}

function addBase(team, x, y) {
  const b = new Base(team, x, y);
  bases.push(b);
  map[y][x].base = b;
  map[y][x].terrain = 'grass';
}

function addUnit(team, x, y, type) {
  const u = new Unit(team, x, y, type);
  units.push(u);
  map[y][x].unit = u;
}

function updateStatus(msg) {
  if (msg) {
    statusEl.textContent = msg;
    return;
  }
  statusEl.textContent = turn === 'blue' ? 'Blue turn — select a unit' : 'Red turn';
}

function getReachable(u) {
  const reach = new Map();
  if (u.moved) {
    reach.set(`${u.x},${u.y}`, 0);
    return reach;
  }
  const q = [{ x: u.x, y: u.y, cost: 0 }];
  reach.set(`${u.x},${u.y}`, 0);
  let head = 0;

  while (head < q.length) {
    const { x, y, cost } = q[head++];
    for (const d of DIRS) {
      const nx = x + d.x;
      const ny = y + d.y;
      if (!inBounds(nx, ny)) continue;
      const cell = map[ny][nx];
      const moveCost = TERRAIN[cell.terrain].move;
      if (moveCost === Infinity) continue;
      if (cell.unit) continue;
      const nc = cost + moveCost;
      const key = `${nx},${ny}`;
      if (nc <= u.move && (!reach.has(key) || nc < reach.get(key))) {
        reach.set(key, nc);
        q.push({ x: nx, y: ny, cost: nc });
      }
    }
  }
  return reach;
}

function getAttackable(u) {
  if (u.attacked) return [];
  const targets = [];
  for (const d of DIRS) {
    const nx = u.x + d.x;
    const ny = u.y + d.y;
    if (!inBounds(nx, ny)) continue;
    const cell = map[ny][nx];
    if (cell.unit && cell.unit.team !== u.team) targets.push(cell.unit);
    if (cell.base && cell.base.team !== u.team) targets.push(cell.base);
  }
  return targets;
}

function isAdjacent(a, b) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1;
}

function selectUnit(u) {
  if (u.attacked) {
    infoEl.textContent = 'This unit has already acted this turn.';
    return;
  }
  selected = u;
  reachable = getReachable(u);
  infoEl.textContent = `${capitalize(u.type)} selected — HP ${u.hp}/${u.maxHp}, ATK ${u.attack}, MOVE ${u.move}`;
}

function getTile(e) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const x = Math.floor(((e.clientX - rect.left) * scaleX) / TILE);
  const y = Math.floor(((e.clientY - rect.top) * scaleY) / TILE);
  return { x, y };
}

function handlePointer(e) {
  e.preventDefault();
  if (gameOver || turn !== 'blue') return;
  const t = getTile(e);
  if (!inBounds(t.x, t.y)) return;
  const cell = map[t.y][t.x];

  if (selected) {
    const target = cell.unit || cell.base;
    if (target && target.team !== 'blue' && !selected.attacked && isAdjacent(selected, target)) {
      attackTarget(selected, target);
      selected = null;
      reachable.clear();
      return;
    }

    if (!selected.moved && reachable.has(`${t.x},${t.y}`) && !cell.unit) {
      moveUnit(selected, t.x, t.y);
      const canAttack = getAttackable(selected).length > 0;
      if (canAttack) {
        reachable = getReachable(selected);
        infoEl.textContent = 'Unit moved. Click an adjacent enemy to attack.';
      } else {
        selected = null;
        reachable.clear();
      }
      return;
    }

    if (cell.unit && cell.unit.team === 'blue' && cell.unit !== selected && !cell.unit.attacked) {
      selectUnit(cell.unit);
      return;
    }

    selected = null;
    reachable.clear();
    return;
  }

  if (cell.unit && cell.unit.team === 'blue' && !cell.unit.attacked) {
    selectUnit(cell.unit);
  }
}

function moveUnit(u, x, y) {
  map[u.y][u.x].unit = null;
  u.x = x;
  u.y = y;
  map[y][x].unit = u;
  u.moved = true;
  infoEl.textContent = 'Unit moved.';
}

function attackTarget(attacker, defender) {
  defender.hp -= attacker.attack;
  attacker.attacked = true;
  infoEl.textContent = `${capitalize(attacker.type)} hit for ${attacker.attack} damage!`;

  if (defender.hp <= 0) {
    if (defender instanceof Base) {
      gameOver = attacker.team === 'blue' ? 'BLUE WINS!' : 'RED WINS!';
      updateStatus(gameOver);
      infoEl.textContent = gameOver;
      endBtn.classList.add('hidden');
      restartBtn.classList.remove('hidden');
    } else {
      removeUnit(defender);
      infoEl.textContent = 'Unit destroyed!';
    }
  }
}

function removeUnit(u) {
  if (selected === u) {
    selected = null;
    reachable.clear();
  }
  map[u.y][u.x].unit = null;
  units = units.filter((unit) => unit !== u);
  checkForces();
}

function checkForces() {
  const blueAlive = units.some((u) => u.team === 'blue');
  const redAlive = units.some((u) => u.team === 'red');
  if (!blueAlive || !redAlive) {
    gameOver = blueAlive ? 'BLUE WINS!' : 'RED WINS!';
    updateStatus(gameOver);
    infoEl.textContent = gameOver;
    endBtn.classList.add('hidden');
    restartBtn.classList.remove('hidden');
  }
}

function endTurn() {
  if (gameOver) return;
  selected = null;
  reachable.clear();
  turn = 'red';
  updateStatus('Enemy turn...');
  infoEl.textContent = 'Enemy is thinking...';
  setTimeout(enemyTurn, 500);
}

function enemyTurn() {
  const enemies = units.filter((u) => u.team === 'red');
  let idx = 0;

  function step() {
    if (gameOver) return;
    if (idx >= enemies.length) {
      endRedTurn();
      return;
    }
    const u = enemies[idx++];
    if (!units.includes(u) || (u.moved && u.attacked)) {
      step();
      return;
    }

    const target = findNearestTarget(u);
    if (!target) {
      markDone(u);
      step();
      return;
    }

    if (isAdjacent(u, target)) {
      attackTarget(u, target);
      setTimeout(step, 500);
      return;
    }

    const dest = findBestMove(u, target);
    if (dest && (dest.x !== u.x || dest.y !== u.y)) {
      moveUnit(u, dest.x, dest.y);
      if (isAdjacent(u, target) && !u.attacked) {
        attackTarget(u, target);
      }
    } else {
      markDone(u);
    }
    setTimeout(step, 500);
  }

  step();
}

function markDone(u) {
  u.moved = true;
  u.attacked = true;
}

function endRedTurn() {
  for (const u of units) {
    u.moved = false;
    u.attacked = false;
  }
  turn = 'blue';
  updateStatus();
  infoEl.textContent = 'Your turn. Select a unit.';
}

function findNearestTarget(u) {
  let best = null;
  let bestDist = Infinity;
  for (const b of bases) {
    if (b.team !== u.team) {
      const d = Math.abs(b.x - u.x) + Math.abs(b.y - u.y);
      if (d < bestDist) {
        bestDist = d;
        best = b;
      }
    }
  }
  for (const other of units) {
    if (other.team !== u.team) {
      const d = Math.abs(other.x - u.x) + Math.abs(other.y - u.y);
      if (d < bestDist) {
        bestDist = d;
        best = other;
      }
    }
  }
  return best;
}

function findBestMove(u, target) {
  const reach = getReachable(u);
  const currentDist = Math.abs(target.x - u.x) + Math.abs(target.y - u.y);
  let best = null;
  let bestDist = Infinity;

  for (const [key] of reach) {
    const [x, y] = key.split(',').map(Number);
    const d = Math.abs(target.x - x) + Math.abs(target.y - y);
    if (d < bestDist) {
      bestDist = d;
      best = { x, y };
    }
  }

  if (best && bestDist < currentDist) return best;
  return null;
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const cell = map[y][x];
      ctx.fillStyle = TERRAIN[cell.terrain].color;
      ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
      ctx.strokeStyle = '#2e7d32';
      ctx.lineWidth = 0.5;
      ctx.strokeRect(x * TILE, y * TILE, TILE, TILE);
      if (cell.base) drawBase(cell.base);
    }
  }

  if (selected) {
    for (const [key] of reachable) {
      const [x, y] = key.split(',').map(Number);
      ctx.fillStyle = 'rgba(255, 255, 0, 0.25)';
      ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
    }

    const attackable = getAttackable(selected);
    ctx.strokeStyle = '#ff1744';
    ctx.lineWidth = 3;
    for (const t of attackable) {
      ctx.strokeRect(t.x * TILE, t.y * TILE, TILE, TILE);
    }
    ctx.lineWidth = 1;

    ctx.strokeStyle = '#ffeb3b';
    ctx.lineWidth = 3;
    ctx.strokeRect(selected.x * TILE, selected.y * TILE, TILE, TILE);
    ctx.lineWidth = 1;
  }

  for (const u of units) {
    drawUnit(u);
  }

  if (gameOver) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 44px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(gameOver, canvas.width / 2, canvas.height / 2);
  }

  requestAnimationFrame(draw);
}

function drawBase(b) {
  const x = b.x * TILE;
  const y = b.y * TILE;
  ctx.fillStyle = b.team === 'blue' ? '#0d47a1' : '#b71c1c';
  ctx.fillRect(x + 6, y + 6, TILE - 12, TILE - 12);
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;
  ctx.strokeRect(x + 6, y + 6, TILE - 12, TILE - 12);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 16px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(b.team === 'blue' ? 'B' : 'R', x + TILE / 2, y + TILE / 2);
  ctx.textBaseline = 'alphabetic';
  drawHpBar(b.hp, b.maxHp, x + 2, y + 2, TILE - 4, 5);
}

function drawUnit(u) {
  const x = u.x * TILE;
  const y = u.y * TILE;
  const cx = x + TILE / 2;
  const cy = y + TILE / 2;

  ctx.fillStyle = u.team === 'blue' ? '#1976d2' : '#d32f2f';
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;

  if (u.type === 'tank') {
    ctx.fillRect(x + 6, y + 6, TILE - 12, TILE - 12);
    ctx.strokeRect(x + 6, y + 6, TILE - 12, TILE - 12);
  } else {
    ctx.beginPath();
    ctx.arc(cx, cy, TILE / 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  if (u.moved && u.attacked) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.fillRect(x, y, TILE, TILE);
  }

  drawHpBar(u.hp, u.maxHp, x + 2, y + 2, TILE - 4, 5);
}

function drawHpBar(hp, max, x, y, w, h) {
  const ratio = Math.max(0, hp / max);
  ctx.fillStyle = '#000';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = ratio > 0.5 ? '#4caf50' : ratio > 0.25 ? '#ff9800' : '#f44336';
  ctx.fillRect(x, y, w * ratio, h);
}

init();
