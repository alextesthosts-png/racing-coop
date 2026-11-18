# 🏎️ Kart Krew — co-op kart racing in the browser

A Mario Kart–inspired, original 3D kart racer with online multiplayer. Create a room, share the link, and race together against the CPU **Rival Crew**.

## Features
- 3D track built with Three.js: curbs, tyre walls, trees, grandstand, start gantry, minimap
- Online rooms (up to 8 racers) over WebSockets — share `/?room=CODE`
- **Co-op vs Rivals** mode: humans form one team, items only hit rivals, slipstream boost behind teammates, team points decide the winner
- **Free-for-all** mode
- CPU racers with rubber-banding that pick up and use items
- Drifting with two-stage mini-turbo, item boxes: ⚡ turbo, 🛢️ oil slick, 🚀 homing missile, 🛡️ shield
- 3 laps, live standings, results with points
- Keyboard + touch controls, synthesized sound effects

## Controls
| Key | Action |
|---|---|
| W / ↑ | Accelerate |
| S / ↓ | Brake / reverse |
| A D / ← → | Steer |
| Shift (hold while turning) | Drift → release for mini-turbo |
| Space | Use item |
| R | Respawn on track |
| C (hold) | Look back |
| M | Mute |

## Run locally
```bash
npm install
npm start      # http://localhost:3000
```

## Deploy
Any Node 18+ host works. On Railway, connect the repo — it runs `npm start` and uses the `PORT` env var. WebSockets are served on `/ws`.
