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
- `js/ice-config.js` - ICE server defaults + user settings persistence
- `js/mqtt-relay.js` - minimal MQTT relay transport over WebSocket
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
8. If direct ICE fails, the app triggers relay fallback shortly after a best-effort ICE restart attempt.

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

## Connection Resilience and Fallback

Direct connection remains the primary path:

- Uses multiple public STUN servers by default:
  - `stun:stun.l.google.com:19302`
  - `stun:stun1.l.google.com:19302`
  - `stun:stun.cloudflare.com:3478`
  - `stun:stun.services.mozilla.com:3478`
  - `stun:global.stun.twilio.com:3478`
- On connection failure, the app attempts `restartIce()` before giving up.
- If direct connectivity still fails, the app switches to MQTT relay over `wss://broker.hivemq.com:8884/mqtt`.
- Game message format stays the same across transports; handlers are transport-agnostic.
- If relay cannot connect, the UI shows a terminal error with next steps instead of hanging.

### Optional ICE settings

Use the **Connection Settings** button in the header to add custom ICE servers.

Input format (one server per line):

```text
urls | username | credential
```

Examples:

```text
turn:example.com:3478?transport=tcp | alice | s3cret
stun:stun.example.com:3478
```

Notes:
- `urls` can be a single URL or a comma-separated list.
- `username` and `credential` are optional (typically needed for TURN).
- Settings are stored in `localStorage` and applied to newly created peer connections.

## Notes / Limitations

- No bundled TURN credentials are shipped by default.
- MQTT relay uses a free public broker and is best-effort infrastructure.
- MQTT relay data is protected in transit via TLS to the broker, but broker operators can read plaintext payloads.
- If host disconnects/closes, the session ends.
- There is no persistence; state is in-memory only.
- Browser support for `CompressionStream` may vary. The app falls back to uncompressed code payloads when needed.

## Troubleshooting (Quick)

- If you see direct-path failure: wait a few seconds for relay fallback to activate.
- If relay also fails: regenerate join/response codes and retry.
- Try a different network (for example, mobile hotspot) if both direct and relay paths fail.
- Use **Connection Settings** to add custom STUN/TURN servers if you have your own.

## Debug Logging

The app keeps an in-memory structured journey log with categories:
- `init`, `nav`, `host`, `guest`, `webrtc`, `signal`, `game`, `error`

Inspect logs in DevTools:
- `window.planningPokerLog.getEntries()` for raw entries
- `window.planningPokerLog.dump()` for table output
- `window.planningPokerLog.clear()` to reset

## E2E Testing (Playwright CLI)

This repo uses Playwright CLI for browser E2E tests.

Install dependencies:

```bash
npm install
npx playwright install
```

Run tests:

```bash
npm run test:e2e
```

Useful variants:

```bash
npm run test:e2e:chromium
npm run test:e2e:firefox
npm run test:e2e:headed
npm run test:e2e:debug
npm run test:e2e:report
```

Notes:
- Playwright starts a local static server automatically via `playwright.config.js` `webServer`.
- The main flow test covers host + guest connection, online status, and vote reveal.

## GitHub Actions

CI workflow: `.github/workflows/playwright.yml`

- Runs on push to `main` and pull requests
- Matrix jobs for `chromium` and `firefox`
- Uses Playwright CLI (`npx playwright install --with-deps` + `npx playwright test`)
- Uploads `playwright-report` and `test-results` artifacts for debugging

## Sanity References

- `serverless-webrtc` demo: manual offer/answer exchange without a signaling server (`http://cjb.github.io/serverless-webrtc/`).
- MDN guidance for non-trickle fallback: wait for ICE gathering completion when not relying on trickle exchange (`RTCPeerConnection.canTrickleIceCandidates` docs).
- Official `webrtc/samples` datachannel example: confirms standard create-offer/create-answer/datachannel flow used here.
