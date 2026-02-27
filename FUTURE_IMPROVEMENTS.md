# Future Improvements Backlog

This document tracks follow-up improvements discovered during the MQTT-default rollout, cleanup, and test hardening work.

## Priority 1: Reliability Hardening

- Add configurable MQTT broker settings:
  - `mqttPrimaryBrokerUrl`
  - ordered `mqttFallbackBrokerUrls`
  - strict sanitization (`wss://` by default, with explicit local-dev allowance if needed)
- Implement relay-level ordered broker failover in `js/mqtt-relay.js` while keeping the external channel API stable.
- Define a room-level broker lock contract to avoid split-room scenarios:
  - host-advertised active broker identity
  - deterministic guest behavior for room-code joins and refresh/rejoin
  - bounded fallback behavior if lock broker is unreachable
- Add degraded-mode UX states:
  - failover in progress
  - all brokers unavailable
  - clear "manual fallback available" guidance when MQTT is degraded
- Extend existing reconnect policy (do not fork it):
  - keep current retry/backoff core
  - add circuit-breaker cooldown only as an additive guard

## Priority 2: Non-Regression And Test Stability

- Keep `tests/e2e/COVERAGE_MATRIX.md` as an explicit gate when adding transport behavior.
- Add deterministic failover scenarios with mocked WebSocket transport in `tests/e2e/specs/relay.spec.js`:
  - primary down, fallback succeeds
  - all brokers down with clear degraded UX
  - reconnect/rejoin under broker transitions
- Continue reducing flaky assumptions in tests:
  - support both "pending approval" and "auto-approved" valid outcomes
  - avoid relying on a single transient notice string when server-side behavior can be asserted directly
- Consolidate duplicate spec intent over time (`journeys.*` overlaps) without reducing coverage.

## Priority 3: UX And Product QoL

- Improve room sharing UX:
  - make "copy join link" feedback richer (copied value preview)
  - optional native share-sheet support (`navigator.share`) where available
- Improve host visibility for admissions:
  - clearer pending/approved/rejected history in lobby
  - optional timestamped join/rejoin events
- Improve reconnect messaging:
  - distinguish "network issue", "approval pending", and "host offline" states more clearly
- Add optional "connection diagnostics" panel (dev mode):
  - active strategy
  - relay broker endpoint
  - retry attempt counters and last error

## Priority 4: Maintainability

- Keep transport concerns isolated from domain/game modules:
  - avoid strategy-specific branching in host authority logic (`host-session`, `game`)
  - keep strategy orchestration in strategy and relay boundaries
- Add a small "transport contract" doc:
  - message shapes used by relay join/rejoin/ack/reject
  - ownership rules for room state and approvals
- Consider splitting large transport-heavy files (notably `js/guest.js`) into focused modules:
  - session lifecycle
  - reconnect policy
  - inbound message handlers

## Priority 5: Optional Future Features

- Optional self-hosted broker profile presets in Connection Settings.
- Optional room security hardening beyond lightweight PIN (if product scope requires it).
- Optional richer host moderation controls (temporary mute/ban list for rejoins).

---

When implementing any item above, preserve existing game-operation parity and current user journeys (`kick`, `reveal`, `new round`, `round title`, reconnect, approval flow) as non-regression requirements.
