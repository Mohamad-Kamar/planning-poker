# Planning Poker (Zero Server)

Static planning-poker app with no backend and no serverless functions.

It uses:
- Browser-only HTML/CSS/JS
- WebRTC DataChannels for real-time peer-to-peer communication
- Manual copy/paste signaling codes (offer/answer) for connection setup

## Files

- `index.html` - UI and styles
- `poker.js` - signaling codec, WebRTC logic, game state, UI wiring

## Run

Open `index.html` in a modern browser (Chrome, Edge, Safari, Firefox).

No build step, package manager, or local server is required.

## How Connection Works

Because this app has no backend, clients exchange signaling data manually:

1. Host clicks **Create Room**.
2. Guest clicks **Join Room** and gets a **Join Code**.
3. Guest sends Join Code to host (Slack, chat, etc.).
4. Host pastes it and clicks **Accept Guest**.
5. Host gets a **Response Code** and sends it back.
6. Guest pastes Response Code and clicks **Connect**.
7. DataChannel opens and game messages flow peer-to-peer.

Signaling code details:
- JSON payloads are compressed with `CompressionStream("deflate")` when available.
- Encoded as URL-safe base64.
- SDP is compacted into essential fields (`ice-ufrag`, `ice-pwd`, fingerprint, setup, candidates), then reconstructed on decode.

## Game Flow

- Host can accept multiple guests (one code exchange per guest).
- Host clicks **Start Game** to open table view.
- Everyone selects cards (`0 1 2 3 5 8 13 21 ? coffee`).
- Host reveals votes.
- Host resets for a new round.

## Notes / Limitations

- No TURN server is used (by design). Some strict corporate/firewalled networks may fail to connect.
- If host disconnects/closes, the session ends.
- There is no persistence; state is in-memory only.
- Browser support for `CompressionStream` may vary. The app falls back to uncompressed code payloads when needed.
