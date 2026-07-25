import asyncio
import math
import random

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles

app = FastAPI()
STATIC_DIR = "static"

rooms = {}


class ArcadeGame:
    WIDTH = 1280
    HEIGHT = 697
    PLAYER_RADIUS = 10
    BULLET_RADIUS = 3
    SPEED = 220
    BULLET_SPEED = 520
    FIRE_COOLDOWN = 0.28
    SPAWN_INVULN = 2.0
    MAX_HEALTH = 100

    def __init__(self):
        self.players = {}
        self.bullets = []
        self.loop_task = None
        self.lock = asyncio.Lock()
        self.id_counter = 0
        self.running = False

    def _spawn_pos(self):
        margin = 40
        while True:
            x = random.randint(margin, self.WIDTH - margin)
            y = random.randint(margin, self.HEIGHT - margin)
            if all(math.hypot(x - p["x"], y - p["y"]) > 60 for p in self.players.values()):
                return x, y

    async def add_player(self, ws: WebSocket):
        async with self.lock:
            self.id_counter += 1
            pid = self.id_counter
            color = self._next_color()
            x, y = self._spawn_pos()
            name = f"O'yinchi {len(self.players) + 1}"
            player = {
                "id": pid,
                "ws": ws,
                "name": name,
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
            return {"type": "assigned", "player_id": pid, "color": color, "name": name}

    def _next_color(self):
        colors = ["blue", "red", "green", "purple", "orange"]
        used = {p["color"] for p in self.players.values()}
        for c in colors:
            if c not in used:
                return c
        return random.choice(colors)

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
            if p:
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
            for p in self.players.values():
                if p["health"] > 0:
                    speed = self.SPEED * dt
                    dx = p["input"]["dx"]
                    dy = p["input"]["dy"]
                    p["x"] = max(self.PLAYER_RADIUS, min(self.WIDTH - self.PLAYER_RADIUS, p["x"] + dx * speed))
                    p["y"] = max(self.PLAYER_RADIUS, min(self.HEIGHT - self.PLAYER_RADIUS, p["y"] + dy * speed))
                    p["angle"] = float(p["input"]["angle"])
                    p["cooldown"] = max(0, p["cooldown"] - dt)
                    p["invuln"] = max(0, p["invuln"] - dt)
                    if p["input"]["shoot"] and p["cooldown"] <= 0:
                        self._shoot(p)
                        p["cooldown"] = self.FIRE_COOLDOWN

            new_bullets = []
            for b in self.bullets:
                b["x"] += math.cos(b["angle"]) * self.BULLET_SPEED * dt
                b["y"] += math.sin(b["angle"]) * self.BULLET_SPEED * dt
                if -50 <= b["x"] <= self.WIDTH + 50 and -50 <= b["y"] <= self.HEIGHT + 50:
                    new_bullets.append(b)
            self.bullets = new_bullets

            self._handle_hits()
            await self._broadcast_state()

    def _shoot(self, p):
        offset = self.PLAYER_RADIUS + 6
        self.bullets.append({
            "x": p["x"] + math.cos(p["angle"]) * offset,
            "y": p["y"] + math.sin(p["angle"]) * offset,
            "angle": p["angle"],
            "owner": p["id"],
            "color": p["color"],
        })

    def _handle_hits(self):
        remaining = []
        for b in self.bullets:
            hit = False
            for p in self.players.values():
                if p["id"] == b["owner"] or p["health"] <= 0 or p["invuln"] > 0:
                    continue
                if math.hypot(b["x"] - p["x"], b["y"] - p["y"]) < self.PLAYER_RADIUS + self.BULLET_RADIUS:
                    p["health"] -= 30
                    if p["health"] <= 0:
                        p["deaths"] += 1
                        owner = next((op for op in self.players.values() if op["id"] == b["owner"]), None)
                        if owner:
                            owner["kills"] += 1
                        p["health"] = self.MAX_HEALTH
                        p["invuln"] = self.SPAWN_INVULN
                        p["x"], p["y"] = self._spawn_pos()
                    hit = True
                    break
            if not hit:
                remaining.append(b)
        self.bullets = remaining

    def _state(self):
        return {
            "players": [
                {
                    "id": p["id"],
                    "name": p["name"],
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
