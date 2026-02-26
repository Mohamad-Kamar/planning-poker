# Planning Poker (Zero Server)

Static planning-poker app with no backend and no serverless functions.

It uses:
- Browser-only HTML/CSS/JS
- WebRTC DataChannels for real-time peer-to-peer communication
- Manual copy/paste signaling codes (offer/answer) for connection setup

## Files

- `index.html` - UI structure
- `styles.css` - styling and responsive layout
- `js/main.js` - app entry point and event wiring
- `js/state.js` - shared state and constants
- `js/log.js` - in-memory journey logger
- `js/ui.js` - DOM refs and UI helpers
- `js/render.js` - rendering functions
- `js/game.js` - game state logic and stats
- `js/signaling.js` - signal encode/decode utilities
- `js/sdp.js` - SDP transform helpers
- `js/webrtc.js` - peer-connection lifecycle helpers
- `js/host.js` - host-side flow
- `js/guest.js` - guest-side flow

## Run

Use any static server (modules require `http://`, not `file://`):

```bash
python3 -m http.server 8000
```

Then open `http://127.0.0.1:8000` in a modern browser (Chrome, Edge, Safari, Firefox).

No build step or package manager is required.

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
- SDP is transported as the full browser-generated SDP for better cross-browser reliability.
- Codes are shown grouped for readability; pasted codes can include whitespace/newlines.
- Each code box supports two copy modes:
  - **Copy Plain**: compact single-line string (best for reliability).
  - **Copy Formatted**: grouped string with spaces/newlines (best for readability in chat).
- A **Shareability** hint appears under each code:
  - **Easy to share**: short code, low copy risk
  - **Okay to share**: medium length
  - **Might be tricky**: long code, verify full paste before connecting

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

## Debug Logging

The app keeps an in-memory structured journey log with categories:
- `init`, `nav`, `host`, `guest`, `webrtc`, `signal`, `game`, `error`

Inspect logs in DevTools:
- `window.planningPokerLog.getEntries()` for raw entries
- `window.planningPokerLog.dump()` for table output
- `window.planningPokerLog.clear()` to reset

## Sanity References

- `serverless-webrtc` demo: manual offer/answer exchange without a signaling server (`http://cjb.github.io/serverless-webrtc/`).
- MDN guidance for non-trickle fallback: wait for ICE gathering completion when not relying on trickle exchange (`RTCPeerConnection.canTrickleIceCandidates` docs).
- Official `webrtc/samples` datachannel example: confirms standard create-offer/create-answer/datachannel flow used here.
