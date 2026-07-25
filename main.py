import asyncio
import random
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles

app = FastAPI()

STATIC_DIR = Path(__file__).parent / "static"

COUNTRY_DATA = [
    {"id": "ca", "name": "Canada", "x": 300, "y": 160, "neighbors": ["us", "ru"]},
    {"id": "us", "name": "United States", "x": 380, "y": 300, "neighbors": ["ca", "mx", "br", "gb", "jp"]},
    {"id": "mx", "name": "Mexico", "x": 340, "y": 420, "neighbors": ["us", "br"]},
    {"id": "br", "name": "Brazil", "x": 520, "y": 640, "neighbors": ["us", "mx", "ar", "za"]},
    {"id": "ar", "name": "Argentina", "x": 500, "y": 780, "neighbors": ["br"]},
    {"id": "gb", "name": "United Kingdom", "x": 700, "y": 250, "neighbors": ["us", "fr", "de", "ru"]},
    {"id": "fr", "name": "France", "x": 720, "y": 320, "neighbors": ["gb", "de", "eg"]},
    {"id": "de", "name": "Germany", "x": 780, "y": 270, "neighbors": ["gb", "fr", "ua", "tr"]},
    {"id": "ua", "name": "Ukraine", "x": 870, "y": 270, "neighbors": ["de", "ru", "tr", "ir"]},
    {"id": "tr", "name": "Turkey", "x": 900, "y": 350, "neighbors": ["ua", "de", "ir", "eg", "sa"]},
    {"id": "ir", "name": "Iran", "x": 970, "y": 380, "neighbors": ["ua", "tr", "sa", "pk", "in"]},
    {"id": "sa", "name": "Saudi Arabia", "x": 920, "y": 450, "neighbors": ["tr", "ir", "eg", "pk", "za"]},
    {"id": "pk", "name": "Pakistan", "x": 1030, "y": 410, "neighbors": ["ir", "sa", "in", "cn"]},
    {"id": "in", "name": "India", "x": 1080, "y": 480, "neighbors": ["ir", "pk", "cn", "id", "za"]},
    {"id": "cn", "name": "China", "x": 1200, "y": 390, "neighbors": ["ru", "pk", "in", "jp", "id", "au"]},
    {"id": "jp", "name": "Japan", "x": 1350, "y": 330, "neighbors": ["us", "cn", "id"]},
    {"id": "id", "name": "Indonesia", "x": 1220, "y": 600, "neighbors": ["cn", "in", "jp", "au"]},
    {"id": "au", "name": "Australia", "x": 1320, "y": 760, "neighbors": ["cn", "id", "za"]},
    {"id": "eg", "name": "Egypt", "x": 840, "y": 430, "neighbors": ["tr", "sa", "za", "fr"]},
    {"id": "za", "name": "South Africa", "x": 850, "y": 740, "neighbors": ["eg", "sa", "br", "au", "in"]},
    {"id": "ru", "name": "Russia", "x": 1110, "y": 210, "neighbors": ["ca", "us", "gb", "de", "ua", "ir", "cn", "jp"]},
]

COLORS = ["blue", "red", "green", "purple", "orange"]
MAX_HUMANS = 2


class Game:
    def __init__(self):
        self.countries = [{**c, "team": "neutral", "armies": 0} for c in COUNTRY_DATA]
        self.country_by_id = {c["id"]: c for c in self.countries}
        self.players = []
        self.spectators = []
        self.phase = "select"
        self.turn_index = 0
        self.winner = None
        self.id_counter = 0
        self.lock = asyncio.Lock()

    def _human_players(self):
        return [p for p in self.players if not p.get("is_ai")]

    def _next_color(self):
        used = {p["color"] for p in self.players}
        for c in COLORS:
            if c not in used:
                return c
        return COLORS[0]

    async def add_connection(self, ws: WebSocket):
        async with self.lock:
            self.id_counter += 1
            if self.phase != "select" or len(self._human_players()) >= MAX_HUMANS:
                self.spectators.append(ws)
                return {"type": "spectator", "message": "Game is full or already in progress; you are spectating."}
            color = self._next_color()
            slot = COLORS.index(color)
            player = {
                "id": self.id_counter,
                "name": f"Player {slot + 1}",
                "color": color,
                "country_id": None,
                "ws": ws,
            }
            self.players.append(player)
            return {
                "type": "assigned",
                "player_id": player["id"],
                "color": player["color"],
                "name": player["name"],
            }

    async def remove_connection(self, ws: WebSocket):
        async with self.lock:
            for p in list(self.players):
                if p.get("ws") is ws:
                    self.players.remove(p)
                    await self._reset()
                    return
            if ws in self.spectators:
                self.spectators.remove(ws)
            if not self.players:
                await self._reset()

    async def _reset(self):
        self.phase = "select"
        self.turn_index = 0
        self.winner = None
        for c in self.countries:
            c["team"] = "neutral"
            c["armies"] = 0
        # remove AI and reset humans for a fresh lobby
        self.players = [p for p in self.players if not p.get("is_ai")]
        for p in self.players:
            p["country_id"] = None
        await self.broadcast_state()

    def get_state(self):
        return {
            "phase": self.phase,
            "turn": self.players[self.turn_index]["id"] if self.phase == "play" and self.players and 0 <= self.turn_index < len(self.players) else None,
            "winner": self.winner,
            "countries": [{"id": c["id"], "team": c["team"], "armies": c["armies"]} for c in self.countries],
            "players": [{"id": p["id"], "name": p["name"], "color": p["color"], "country_id": p["country_id"]} for p in self.players],
        }

    async def broadcast_state(self):
        state = self.get_state()
        for p in list(self.players):
            try:
                await p["ws"].send_json({"type": "state", "state": state, "you": p["id"]})
            except Exception:
                pass
        for s in list(self.spectators):
            try:
                await s.send_json({"type": "state", "state": state, "you": None})
            except Exception:
                pass

    async def send_event(self, text: str):
        for p in list(self.players):
            try:
                await p["ws"].send_json({"type": "event", "text": text})
            except Exception:
                pass
        for s in list(self.spectators):
            try:
                await s.send_json({"type": "event", "text": text})
            except Exception:
                pass

    async def handle_action(self, ws: WebSocket, data):
        if not any(p.get("ws") is ws for p in self.players):
            return
        async with self.lock:
            action = data.get("type")
            if action == "select":
                await self._handle_select(ws, data)
            elif action == "start_solo":
                await self._handle_start_solo(ws)
            elif action == "attack":
                await self._handle_attack(ws, data)
            elif action == "end_turn":
                await self._handle_end_turn(ws)
            elif action == "restart":
                await self._reset()
            await self.broadcast_state()

    async def _handle_select(self, ws: WebSocket, data):
        if self.phase != "select":
            return
        player = next((p for p in self.players if p.get("ws") is ws), None)
        if not player or player["country_id"]:
            return
        country = self.country_by_id.get(data.get("country"))
        if not country or country["team"] != "neutral":
            return
        await self._do_select(player, country)

    async def _do_select(self, player, country):
        country["team"] = player["color"]
        country["armies"] = 12
        player["country_id"] = country["id"]
        await self.send_event(f"{player['name']} chose {country['name']}")
        if all(p["country_id"] for p in self.players):
            await self._start_game()

    async def _handle_start_solo(self, ws: WebSocket):
        if self.phase != "select" or any(p.get("is_ai") for p in self.players):
            return
        human = next((p for p in self.players if p.get("ws") is ws), None)
        if not human or not human["country_id"]:
            return
        self.id_counter += 1
        ai = {
            "id": self.id_counter,
            "name": "AI",
            "color": self._next_color(),
            "country_id": None,
            "ws": None,
            "is_ai": True,
        }
        self.players.append(ai)
        neutral = [c for c in self.countries if c["team"] == "neutral"]
        if neutral:
            country = random.choice(neutral)
            await self._do_select(ai, country)

    async def _start_game(self):
        self.phase = "play"
        for c in self.countries:
            if c["team"] == "neutral":
                c["armies"] = random.randint(2, 4)
        self.turn_index = 0
        await self.send_event("Game started! Conquer all countries to win.")
        await self._start_turn(0)

    async def _start_turn(self, idx):
        if not self.players:
            return
        self.turn_index = idx % len(self.players)
        player = self.players[self.turn_index]
        owned = [c for c in self.countries if c["team"] == player["color"]]
        if owned:
            reinforce = max(3, len(owned) // 2)
            for _ in range(reinforce):
                random.choice(owned)["armies"] += 1
        await self.send_event(f"{player['name']}'s turn — received {max(3, len(owned) // 2)} reinforcements")
        if player.get("is_ai"):
            asyncio.create_task(self._ai_loop())

    async def _handle_attack(self, ws: WebSocket, data):
        if self.phase != "play":
            return
        if not self.players or self.players[self.turn_index].get("ws") is not ws:
            return
        await self._do_attack(self.players[self.turn_index], data.get("from"), data.get("to"))

    async def _do_attack(self, player, from_id, to_id):
        from_c = self.country_by_id.get(from_id)
        to_c = self.country_by_id.get(to_id)
        if not from_c or not to_c:
            return
        if from_c["team"] != player["color"]:
            return
        if to_c["team"] == player["color"]:
            return
        if to_c["id"] not in from_c["neighbors"]:
            return
        if from_c["armies"] <= 1:
            return
        before = to_c["team"]
        self._battle(from_c, to_c)
        if to_c["team"] != before:
            await self.send_event(f"{player['name']} captured {to_c['name']} from {from_c['name']}")
        else:
            await self.send_event(f"{player['name']} attacked {to_c['name']} from {from_c['name']} — {to_c['name']} holds with {to_c['armies']} armies")
        self._check_win()

    def _battle(self, attacker, defender):
        while attacker["armies"] > 1 and defender["armies"] > 0:
            a_dice = sorted([random.randint(1, 6) for _ in range(min(3, attacker["armies"] - 1))], reverse=True)
            d_dice = sorted([random.randint(1, 6) for _ in range(min(2, defender["armies"]))], reverse=True)
            for i in range(min(len(a_dice), len(d_dice))):
                if a_dice[i] > d_dice[i]:
                    defender["armies"] -= 1
                else:
                    attacker["armies"] -= 1
        if defender["armies"] <= 0:
            defender["team"] = attacker["team"]
            defender["armies"] = attacker["armies"] - 1
            attacker["armies"] = 1

    def _check_win(self):
        teams = {c["team"] for c in self.countries if c["team"] != "neutral"}
        if len(teams) == 1:
            self.phase = "over"
            self.winner = next(iter(teams))
            winner_name = next((p["name"] for p in self.players if p["color"] == self.winner), self.winner)
            asyncio.create_task(self.send_event(f"{winner_name} conquered the world!"))

    async def _handle_end_turn(self, ws: WebSocket):
        if self.phase != "play" or not self.players:
            return
        if self.players[self.turn_index].get("ws") is not ws:
            return
        await self._do_end_turn()

    async def _do_end_turn(self):
        if self.phase != "play" or not self.players:
            return
        next_idx = (self.turn_index + 1) % len(self.players)
        await self._start_turn(next_idx)

    async def _ai_loop(self):
        await asyncio.sleep(1.2)
        async with self.lock:
            if self.phase != "play" or self.turn_index >= len(self.players):
                return
            player = self.players[self.turn_index]
            if not player.get("is_ai"):
                return
            owned = [c for c in self.countries if c["team"] == player["color"] and c["armies"] > 1]
            if not owned:
                await self._do_end_turn()
                return
            random.shuffle(owned)
            for from_c in owned:
                targets = [c for c in self.countries if c["id"] in from_c["neighbors"] and c["team"] != player["color"]]
                if targets and from_c["armies"] > 1:
                    to_c = random.choice(targets)
                    await self._do_attack(player, from_c["id"], to_c["id"])
                    await self.broadcast_state()
                    if self.phase == "play":
                        asyncio.create_task(self._ai_loop())
                    return
            await self._do_end_turn()


game = Game()


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    msg = await game.add_connection(websocket)
    await websocket.send_json(msg)
    await game.broadcast_state()
    try:
        while True:
            data = await websocket.receive_json()
            await game.handle_action(websocket, data)
    except WebSocketDisconnect:
        await game.remove_connection(websocket)
    except Exception:
        await game.remove_connection(websocket)


app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
