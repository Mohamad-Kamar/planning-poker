# Planning Poker (Zero Server)

Browser-only planning poker app with no backend.

## Features

- MQTT Quick Join as the default flow (room code or share link).
- Optional manual WebRTC signaling flow kept as fallback in Connection Settings.
- Multiple guests per host session.
- Host can remove a guest from the session.
- Host-controlled reveal/new round/round title with state sync.
- Optional room PIN and host approval controls for joins.
- Session snapshot restore after refresh in the same tab.
- Built-in Playwright E2E tests.

## Quick Start

Serve the project over HTTP (ES modules do not run from `file://`):

```bash
python3 -m http.server 8000
```

Open `http://127.0.0.1:8000` in a modern browser.

## How To Connect

### Default flow (MQTT Quick Join)

1. Host clicks **Create Room**.
2. Host shares **Room Code** or **Join Link**.
3. Guest clicks **Join Room**, enters room code, then clicks **Join Room**.
4. Host approves the pending join request.
5. Guest enters table and all game operations sync in real time.

### Manual fallback (optional)

Use **Connection Settings** -> set mode to **Manual WebRTC Signaling**, then use the old join/response code copy-paste flow.

## Connection And Recovery Behavior

- Default transport uses MQTT relay (`wss://broker.hivemq.com:8884/mqtt`).
- Host keeps a relay recovery listener for reconnect and join requests.
- Guest reconnect attempts happen automatically over relay with exponential backoff.
- A sanitized session snapshot is saved in `sessionStorage` (up to ~12 hours) and can restore room/table context on refresh in the same tab.
- If the host leaves and does not return, guests cannot continue that live session and need a new host session.

## Connection Settings

Connection Settings now include:

- Default connection mode (MQTT Quick Join or Manual WebRTC signaling).
- MQTT admission controls:
  - Require host approval for first join.
  - Auto-approve known rejoins.
- Optional custom ICE servers (used by manual WebRTC mode).

Input format (one server per line):

```text
urls | username | credential
```

Example:

```text
turn:example.com:3478?transport=tcp | alice | s3cret
stun:stun.example.com:3478
```

## Troubleshooting

- If room join fails, verify room code and optional PIN.
- If host approval is required, wait for host to approve in the lobby.
- If relay fails, retry join and/or try another network.
- For manual mode issues, regenerate codes and confirm full copy/paste.
- Add your own STUN/TURN servers in **Connection Settings** for manual WebRTC mode.

## Development And Testing

Install dependencies:

```bash
npm install
npx playwright install
```

Run E2E tests:

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

Playwright starts a local static server automatically via `playwright.config.js`.

## Debug Logging

In DevTools:

- `window.planningPokerLog.getEntries()` returns raw entries.
- `window.planningPokerLog.dump()` prints table output.
- `window.planningPokerLog.clear()` resets logs.

## Limitations

- MQTT relay uses a public broker and is best effort.
- Relay traffic is TLS-protected in transit, but broker operators can read plaintext payloads.
- Room PIN is lightweight access control, not enterprise-grade auth.
- No bundled TURN credentials are provided for manual WebRTC mode.
- Public broker usage expectations are documented in `PUBLIC_BROKER_DEPENDENCY_POLICY.md`.

## License

ISC
