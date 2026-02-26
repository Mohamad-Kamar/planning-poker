# Planning Poker (Zero Server)

Browser-only planning poker app with no backend.

## Features

- Host/guest flow with manual join and response codes.
- Real-time updates over WebRTC DataChannels.
- Multiple guests per host session.
- Host can remove a guest from the session.
- Automatic fallback to MQTT relay when direct peer connection fails.
- Session snapshot restore after refresh in the same tab.
- Built-in Playwright E2E tests.

## Quick Start

Serve the project over HTTP (ES modules do not run from `file://`):

```bash
python3 -m http.server 8000
```

Open `http://127.0.0.1:8000` in a modern browser.

## How To Connect

1. Host clicks **Create Room**.
2. Guest clicks **Join Room** and gets a join code.
3. Guest shares that code with host.
4. Host pastes it and clicks **Accept Guest**.
5. Host sends the generated response code back.
6. Guest pastes response code and clicks **Connect**.

Codes support both plain and formatted copy modes; pasted input can include spaces/newlines.

## Connection And Recovery Behavior

- Direct WebRTC is attempted first using default STUN servers.
- On direct-path failure, the app attempts ICE restart, then falls back to MQTT relay (`wss://broker.hivemq.com:8884/mqtt`).
- A sanitized session snapshot is saved in `sessionStorage` (up to ~12 hours) and can restore room/table context on refresh in the same tab.
- Host refresh restores host state and starts a relay recovery listener so guests can rejoin.
- Guest reconnect attempts can happen automatically over relay; manual join/response exchange remains available as fallback.
- If the host leaves and does not return, guests cannot continue that live session and need a new host session.

## Optional ICE Settings

Use **Connection Settings** to add custom ICE servers.

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

- If direct connection fails, wait a few seconds for relay fallback.
- If relay fails, regenerate codes and retry.
- Try another network if both direct and relay fail.
- Add your own STUN/TURN servers in **Connection Settings** if available.

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

- No bundled TURN credentials are provided.
- Relay uses a public broker and is best effort.
- Relay traffic is TLS-protected in transit, but broker operators can read plaintext payloads.
- `CompressionStream` support varies by browser; signaling falls back to uncompressed payloads.

## License

ISC
