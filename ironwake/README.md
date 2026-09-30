# IRONWAKE (アイアンウェイク)

A heavy-mech action game that runs in the browser. You play a single stage with a fixed loadout.

## How to play / 遊び方

- **To play:** double-click `dist/ironwake.html` to open it in Chrome or Edge.
  - If the file is missing, a developer runs `npm run build` to create it.
- **遊び方:** `dist/ironwake.html` をダブルクリックして Chrome / Edge で開いてください。

## Controls / 操作

| Key | 操作 | Action |
|---|---|---|
| WASD | 移動 | Move |
| Mouse | 照準 | Aim (click the screen to capture the mouse) |
| Left click | 右腕ライフル | Rifle |
| Right click | 左腕パルスブレード | Pulse blade |
| Q | 左背ミサイル | Missiles |
| E | 右背キャノン | Cannon |
| Shift | クイックブースト | Quick boost |
| Space | ジャンプ / ホバー (長押し) | Jump / hover (hold) |
| F | アサルトブースト | Assault boost |
| C | ブースト切替 | Boost on/off |
| Tab / middle click | ロック対象切替 | Switch lock target |
| R | 修復キット | Repair kit |
| Esc | ポーズ | Pause |

A gamepad is also supported.

## Developers

See `docs/ARCHITECTURE.md` for the architecture and contracts, and `docs/AC6_BENCHMARK.md` for the quality bar.

Quick checks:

```
npm run check && npm run smoke && npm run shoot -- --all
```
