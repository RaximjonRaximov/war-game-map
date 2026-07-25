# war-game-map

Real-time multiplayer world domination game.

## Play

Visit the deployed URL, or run locally:

```bash
pip install -r requirements.txt  # or uvicorn/fastapi manually
uvicorn main:app --host 0.0.0.0 --port 8000
```

Open `http://localhost:8000/` in two browser tabs to play together.

## How to play

1. Wait for two players to connect.
2. Each player clicks a neutral country to play as it (for example Russia).
3. On your turn, receive reinforcements, then select one of your countries and attack a connected enemy/neutral country.
4. Battles use Risk-style dice rolls.
5. Conquer all countries to win.
