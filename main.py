import asyncio
import math
import random

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles

app = FastAPI()
STATIC_DIR = "static"

TILE = 40
WORLD_W = 40 * TILE
WORLD_H = 24 * TILE
MAX_SCORE = 30
ROUND_TIME = 180

MAP_TILES = [
    "########################################",
    "#......................................#",
    "#.AA................#..................#",
    "#.AA..#.............#............#.....#",
    "#.....#.............#............#.....#",
    "#.....#.............#............#.....#",
    "#.....#..........................#.....#",
    "#.....#..........................#.....#",
    "#...................#..................#",
    "#...................#..................#",
    "#..#####.#####.###..#.####.#####.####..#",
    "#...................#..................#",
    "#...................#..................#",
    "#..#####.#####.###..#.####.#####.####..#",
    "#...................#..................#",
    "#.....#.............#............#.....#",
    "#.....#..........................#.....#",
    "#.....#..........................#.....#",
    "#.....#.............#............#.....#",
    "#.....#.............#............#.....#",
    "#.....#.............#............#..BB.#",
    "#...................#...............BB.#",
    "#......................................#",
    "########################################",
]

MAP_COLS = 40
MAP_ROWS = len(MAP_TILES)

rooms = {}


def is_wall(x, y, radius=0):
    cx = int(x // TILE)
    cy = int(y // TILE)
    r = int(math.ceil((radius + 1) / TILE)) + 1
    for dy in range(-r, r + 1):
        for dx in range(-r, r + 1):
            tx = cx + dx
            ty = cy + dy
            if 0 <= ty < MAP_ROWS and 0 <= tx < MAP_COLS:
                if MAP_TILES[ty][tx] == "#":
                    wx = tx * TILE
                    wy = ty * TILE
                    closest_x = max(wx, min(x, wx + TILE))
                    closest_y = max(wy, min(y, wy + TILE))
                    dist = math.hypot(x - closest_x, y - closest_y)
                    if dist <= radius:
                        return True
    return False


def spawn_positions(team):
    positions = []
    for y, row in enumerate(MAP_TILES):
        for x, ch in enumerate(row):
            if ch == "A" and team == "ct":
                positions.append((x * TILE + TILE / 2, y * TILE + TILE / 2))
            if ch == "B" and team == "t":
                positions.append((x * TILE + TILE / 2, y * TILE + TILE / 2))
    return positions


def clamp(value, lo, hi):
    return max(lo, min(value, hi))


class ArcadeGame:
    PLAYER_RADIUS = 10
    BULLET_RADIUS = 3
    SPEED = 200
    BULLET_SPEED = 600
    FIRE_COOLDOWN = 0.18
    SPAWN_INVULN = 2.0
    MAX_HEALTH = 100

    def __init__(self):
        self.players = {}
        self.bullets = []
        self.scores = {"ct": 0, "t": 0}
        self.phase = "play"
        self.winner = None
        self.time_left = ROUND_TIME
        self.round_restart_in = 0
        self.loop_task = None
        self.lock = asyncio.Lock()
        self.id_counter = 0
        self.running = False

    async def add_player(self, ws: WebSocket):
        async with self.lock:
            self.id_counter += 1
            pid = self.id_counter
            team = self._pick_team()
            color = "blue" if team == "ct" else "red"
            name = f"{'CT' if team == 'ct' else 'T'} {len([p for p in self.players.values() if p['team'] == team]) + 1}"
            x, y = random.choice(spawn_positions(team))
            player = {
                "id": pid,
                "ws": ws,
                "name": name,
                "team": team,
                "color": color,
                "x": x,
                "y": y,
                "angle": 0.0,
                "health": self.MAX_HEALTH,
                "kills": 0,
                "deaths": 0,
                "cooldown": 0.0,
                "invuln": self.SPAWN_INVULN,
                "input": {"dx": 0, "dy": 0, "angle": 0, "shoot": False},
            }
            self.players[ws] = player
            if not self.running:
                self.running = True
                self.loop_task = asyncio.create_task(self._game_loop())
            return {"type": "assigned", "player_id": pid, "color": color, "name": name, "team": team}

    def _pick_team(self):
        ct = sum(1 for p in self.players.values() if p["team"] == "ct")
        t = sum(1 for p in self.players.values() if p["team"] == "t")
        if ct < 5 and (ct <= t or t >= 5):
            return "ct"
        if t < 5:
            return "t"
        return "ct" if ct <= t else "t"

    async def remove_player(self, ws: WebSocket):
        async with self.lock:
            if ws in self.players:
                del self.players[ws]
            if not self.players and self.loop_task:
                self.loop_task.cancel()
                self.running = False

    async def set_input(self, ws: WebSocket, data: dict):
        async with self.lock:
            p = self.players.get(ws)
            if p and self.phase == "play":
                p["input"] = {
                    "dx": max(-1, min(1, data.get("dx", 0))),
                    "dy": max(-1, min(1, data.get("dy", 0))),
                    "angle": float(data.get("angle", p["angle"])),
                    "shoot": bool(data.get("shoot", False)),
                }

    async def _game_loop(self):
        last = asyncio.get_event_loop().time()
        try:
            while True:
                await asyncio.sleep(1 / 30)
                now = asyncio.get_event_loop().time()
                dt = min(now - last, 0.1)
                last = now
                await self._tick(dt)
        except asyncio.CancelledError:
            pass

    async def _tick(self, dt: float):
        async with self.lock:
            if self.phase == "play":
                self.time_left -= dt
                if self.time_left <= 0:
                    self._end_round_by_time()
                for p in self.players.values():
                    if p["health"] > 0:
                        self._move_player(p, dt)
                        p["angle"] = float(p["input"]["angle"])
                        p["cooldown"] = max(0, p["cooldown"] - dt)
                        p["invuln"] = max(0, p["invuln"] - dt)
                        if p["input"]["shoot"] and p["cooldown"] <= 0:
                            self._shoot(p)
                            p["cooldown"] = self.FIRE_COOLDOWN

                self._move_bullets(dt)
                self._handle_hits()

                if self.phase == "over":
                    self.round_restart_in -= dt
                    if self.round_restart_in <= 0:
                        self._restart_round()
            await self._broadcast_state()

    def _move_player(self, p, dt):
        speed = self.SPEED * dt
        dx = p["input"]["dx"]
        dy = p["input"]["dy"]
        if dx != 0 and dy != 0:
            speed *= 0.7071
        new_x = clamp(p["x"] + dx * speed, self.PLAYER_RADIUS, WORLD_W - self.PLAYER_RADIUS)
        if not is_wall(new_x, p["y"], self.PLAYER_RADIUS):
            p["x"] = new_x
        new_y = clamp(p["y"] + dy * speed, self.PLAYER_RADIUS, WORLD_H - self.PLAYER_RADIUS)
        if not is_wall(p["x"], new_y, self.PLAYER_RADIUS):
            p["y"] = new_y

    def _shoot(self, p):
        offset = self.PLAYER_RADIUS + 6
        self.bullets.append({
            "x": p["x"] + math.cos(p["angle"]) * offset,
            "y": p["y"] + math.sin(p["angle"]) * offset,
            "angle": p["angle"],
            "owner": p["id"],
            "team": p["team"],
            "color": p["color"],
            "life": 1.2,
        })

    def _move_bullets(self, dt):
        new_bullets = []
        for b in self.bullets:
            b["life"] -= dt
            if b["life"] <= 0:
                continue
            nx = b["x"] + math.cos(b["angle"]) * self.BULLET_SPEED * dt
            ny = b["y"] + math.sin(b["angle"]) * self.BULLET_SPEED * dt
            if is_wall(nx, ny, self.BULLET_RADIUS):
                continue
            b["x"] = nx
            b["y"] = ny
            new_bullets.append(b)
        self.bullets = new_bullets

    def _handle_hits(self):
        remaining = []
        for b in list(self.bullets):
            hit = False
            for p in self.players.values():
                if p["id"] == b["owner"] or p["health"] <= 0 or p["invuln"] > 0 or p["team"] == b["team"]:
                    continue
                if math.hypot(b["x"] - p["x"], b["y"] - p["y"]) < self.PLAYER_RADIUS + self.BULLET_RADIUS:
                    p["health"] -= 34
                    if p["health"] <= 0:
                        p["deaths"] += 1
                        owner = next((op for op in self.players.values() if op["id"] == b["owner"]), None)
                        if owner:
                            owner["kills"] += 1
                            self.scores[owner["team"]] += 1
                            if self.scores[owner["team"]] >= MAX_SCORE and self.phase == "play":
                                self.phase = "over"
                                self.winner = owner["team"]
                                self.round_restart_in = 8.0
                        p["health"] = self.MAX_HEALTH
                        p["invuln"] = self.SPAWN_INVULN
                        pos = random.choice(spawn_positions(p["team"]))
                        p["x"], p["y"] = pos
                    hit = True
                    break
            if not hit:
                remaining.append(b)
        self.bullets = remaining

    def _end_round_by_time(self):
        if self.phase != "play":
            return
        self.phase = "over"
        if self.scores["ct"] > self.scores["t"]:
            self.winner = "ct"
        elif self.scores["t"] > self.scores["ct"]:
            self.winner = "t"
        else:
            self.winner = "draw"
        self.round_restart_in = 8.0

    def _restart_round(self):
        self.phase = "play"
        self.winner = None
        self.time_left = ROUND_TIME
        self.scores = {"ct": 0, "t": 0}
        for p in self.players.values():
            p["kills"] = 0
            p["deaths"] = 0
            p["health"] = self.MAX_HEALTH
            p["invuln"] = self.SPAWN_INVULN
            pos = random.choice(spawn_positions(p["team"]))
            p["x"], p["y"] = pos

    def _state(self):
        return {
            "players": [
                {
                    "id": p["id"],
                    "name": p["name"],
                    "team": p["team"],
                    "color": p["color"],
                    "x": p["x"],
                    "y": p["y"],
                    "angle": p["angle"],
                    "health": p["health"],
                    "kills": p["kills"],
                    "deaths": p["deaths"],
                    "invuln": p["invuln"],
                }
                for p in self.players.values()
            ],
            "bullets": [
                {"x": b["x"], "y": b["y"], "angle": b["angle"], "color": b["color"]}
                for b in self.bullets
            ],
            "scores": self.scores,
            "phase": self.phase,
            "winner": self.winner,
            "time_left": int(self.time_left),
        }

    async def _broadcast_state(self):
        msg = {"type": "state", "state": self._state()}
        dead = []
        for p in list(self.players.values()):
            try:
                await p["ws"].send_json(msg)
            except Exception:
                dead.append(p["ws"])
        for ws in dead:
            if ws in self.players:
                del self.players[ws]


def get_or_create_game(room: str):
    if room not in rooms:
        rooms[room] = ArcadeGame()
    return rooms[room]


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    room = websocket.query_params.get("room", "default")
    game = get_or_create_game(room)
    await websocket.accept()
    msg = await game.add_player(websocket)
    await websocket.send_json(msg)
    await websocket.send_json({"type": "map", "tiles": MAP_TILES, "tile": TILE, "cols": MAP_COLS, "rows": MAP_ROWS})
    try:
        while True:
            data = await websocket.receive_json()
            if data.get("type") == "input":
                await game.set_input(websocket, data)
    except WebSocketDisconnect:
        await game.remove_player(websocket)
    except Exception:
        await game.remove_player(websocket)


app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
