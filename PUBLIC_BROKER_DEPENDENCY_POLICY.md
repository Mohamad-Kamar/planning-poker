# Public Broker Dependency Policy

This app uses a public MQTT broker by default for room connectivity.

## What this means

- The app is free and zero-backend on your side.
- MQTT relay is provided by a third-party public service.
- Service is best effort and may be slow, overloaded, or temporarily unavailable.
- This is acceptable for low-stake collaboration use.

## Can I use this app safely?

Yes, for normal planning poker usage where data is not sensitive.

- Transport uses TLS (`wss`) so traffic is encrypted in transit.
- Public broker operators can still see plaintext payloads.
- Do not use this app for secrets, personal sensitive data, or regulated workflows.

## Availability expectations

- No guaranteed uptime, SLA, or permanent availability is assumed.
- The public broker provider may throttle, change limits, or discontinue free access.
- Users may occasionally see connection failures or delays.

## How to use the app effectively

- Keep room usage lightweight and short-lived.
- If join fails, retry once and wait for host approval.
- If relay is unstable, try another network.
- If needed, switch to **Manual WebRTC Signaling** in Connection Settings.

## Product behavior

- Host remains authoritative for room actions (approve, reject, kick, reveal, reset).
- Guests can reconnect after refresh when relay is available.
- If the host leaves permanently, participants must start a new room.

## Maintainer guidance

- Treat public relay as a convenience, not guaranteed infrastructure.
- Keep broker endpoints configurable for future migration.
- Prefer graceful failure messaging over silent failure.

## Scope of this policy

This policy is informational and operational. It is not legal advice and does not modify third-party broker terms.
