# E2E Coverage Matrix

This matrix tracks user-visible actions across roles/views and maps each action to Playwright coverage.

Legend:
- `Covered`: action has deterministic assertion-backed test coverage
- `Partial`: action is covered, but with loose/flaky assertions or helper bypasses
- `Missing`: no direct assertion-backed E2E coverage yet

## Home View

| Action | Role | Status | Spec |
| --- | --- | --- | --- |
| Enter display name | idle | Covered | `journeys.navigation.spec.js` |
| Create room | idle -> host | Covered | `game-lifecycle.spec.js`, `journeys.navigation.spec.js` |
| Join room | idle -> guest | Covered | `join-flow.spec.js`, `journeys.navigation.spec.js` |
| Require non-empty display name | idle | Covered | `journeys.navigation.spec.js` |
| Open connection settings | idle | Covered | `settings.spec.js` |

## Host Lobby

| Action | Role | Status | Spec |
| --- | --- | --- | --- |
| Paste guest join code + accept | host | Covered | `join-flow.spec.js`, `game-lifecycle.spec.js` |
| Clear join code textarea | host | Covered | `journeys.codes.spec.js` |
| Copy response code plain | host | Covered | `journeys.codes.spec.js` |
| Copy response code formatted | host | Covered | `journeys.codes.spec.js` |
| Start game disabled until guest online | host | Covered | `game-lifecycle.spec.js` |
| Start game with real gating | host | Covered | `game-lifecycle.spec.js` |
| Kick guest from lobby | host | Covered | `game-lifecycle.spec.js` |
| Back to home | host | Covered | `journeys.navigation.spec.js` |
| Escape to home | host | Covered | `interaction-and-errors.spec.js` |
| Approve/reject pending rejoin | host | Covered | `persistence.spec.js`, `resilience.rejoin.spec.js` |

## Guest Connect

| Action | Role | Status | Spec |
| --- | --- | --- | --- |
| Generate join code on entry | guest | Covered | `join-flow.spec.js`, `journeys.navigation.spec.js` |
| Regenerate join code | guest | Covered | `journeys.codes.spec.js` |
| Copy join code plain | guest | Covered | `journeys.codes.spec.js` |
| Copy join code formatted | guest | Covered | `journeys.codes.spec.js` |
| Paste response and connect | guest | Covered | `game-lifecycle.spec.js` |
| Reject malformed response code | guest | Covered | `interaction-and-errors.spec.js` |
| Reject wrong-target response code | guest | Covered | `interaction-and-errors.spec.js` |
| Enter submits response input | guest | Covered | `interaction-and-errors.spec.js` |
| Escape/back to home | guest | Covered | `interaction-and-errors.spec.js`, `journeys.navigation.spec.js` |
| Whitespace-tolerant response paste | guest | Covered | `join-flow.spec.js` |

## Table View

| Action | Role | Status | Spec |
| --- | --- | --- | --- |
| Vote select | host/guest | Covered | `game-lifecycle.spec.js` |
| Clear vote | host/guest | Covered | `journeys.core.spec.js` |
| Reveal votes (host) | host | Covered | `game-lifecycle.spec.js` |
| New round (host) | host | Covered | `game-lifecycle.spec.js` |
| Round title sync host -> guest | host/guest | Covered | `game-lifecycle.spec.js`, `journeys.core.spec.js` |
| Host-only controls hidden for guest | guest | Covered | `journeys.core.spec.js` |
| Leave (guest) | guest | Covered | `game-lifecycle.spec.js` |
| Back to lobby (host) | host | Covered | `persistence.spec.js`, `journeys.navigation.spec.js` |
| Reconnect path from disconnected table | guest | Covered | `journeys.navigation.spec.js` |

## Persistence / Recovery

| Action | Role | Status | Spec |
| --- | --- | --- | --- |
| Host refresh restores table context | host | Covered | `persistence.spec.js` |
| Guest refresh restores reconnect flow | guest | Covered | `persistence.spec.js` |
| Explicit leave clears snapshot | host/guest | Covered | `persistence.spec.js` |
| Stale snapshot ignored | host/guest | Covered | `persistence.spec.js`, `persistence.contract.spec.js` |
| Corrupt snapshot cleared | host/guest | Covered | `persistence.spec.js`, `persistence.contract.spec.js` |
| Snapshot role/view normalization | host/guest | Covered | `persistence.contract.spec.js` |
| Display name localStorage restore/sanitize | idle | Covered | `journeys.navigation.spec.js` |

## Relay / Rejoin / Transport

| Action | Role | Status | Spec |
| --- | --- | --- | --- |
| Guest fallback after first failed state | guest | Covered | `relay.spec.js` |
| Relay timeout error path | guest | Covered | `relay.spec.js` |
| MQTT transport packet handshake | host/guest | Covered | `relay.spec.js` |
| Host broadcasts are recipient-targeted | host | Covered | `relay.spec.js` |
| Guest auto-rejoin loop starts on close | guest | Covered | `persistence.spec.js` |
| Rejoin ack/reject message handling | host/guest | Covered | `resilience.rejoin.spec.js` |
