const { test, expect } = require("@playwright/test");
const { openHome } = require("../helpers");

test("guest rejoinAck updates room and restores connected status", async ({ page }) => {
    await openHome(page);

    const result = await page.evaluate(async () => {
        const { state } = await import("/js/state.js");
        const { handleGuestInboundMessage } = await import("/js/guest.js");
        const { showView } = await import("/js/ui.js");
        const { renderTable } = await import("/js/render.js");

        state.role = "guest";
        state.displayName = "GuestAck";
        state.currentView = "table";
        state.roomId = "old-room";
        state.guestAutoRejoinEnabled = true;
        state.guestRemoteState = {
            round: 1,
            roundTitle: "",
            started: true,
            revealed: false,
            players: []
        };
        showView("table");
        renderTable();

        const fakeChannel = {
            readyState: "open",
            close() {},
            send() {}
        };
        state.guestChannel = fakeChannel;

        handleGuestInboundMessage(JSON.stringify({ t: "rejoinAck", to: state.localId, room: "new-room-id" }), fakeChannel);
        return {
            roomId: state.roomId
        };
    });

    expect(result.roomId).toBe("new-room-id");
    await expect(page.locator("#connectionStatusText")).toContainText("Connected to host");
    await expect(page.locator("#tableView.active")).toBeVisible();
});

test("guest rejoinReject shows pending approval state", async ({ page }) => {
    await openHome(page);

    const result = await page.evaluate(async () => {
        const { state } = await import("/js/state.js");
        const { handleGuestInboundMessage } = await import("/js/guest.js");
        const { showView } = await import("/js/ui.js");
        const { renderTable } = await import("/js/render.js");

        let closed = false;
        state.role = "guest";
        state.displayName = "GuestReject";
        state.currentView = "table";
        state.roomId = "reject-room";
        state.guestAutoRejoinEnabled = false;
        state.guestRemoteState = {
            round: 1,
            roundTitle: "",
            started: true,
            revealed: false,
            players: []
        };
        showView("table");
        renderTable();

        const fakeChannel = {
            readyState: "open",
            close() {
                closed = true;
            },
            send() {}
        };
        state.guestChannel = fakeChannel;

        handleGuestInboundMessage(JSON.stringify({ t: "rejoinReject", to: state.localId }), fakeChannel);
        return {
            closed
        };
    });

    expect(result.closed).toBe(true);
    await expect(page.locator("#connectionStatusText")).toContainText("Reconnect pending approval");
    await expect(page.locator("#tableNotice")).toContainText(/Host approval required|Retrying shortly/);
});

test("host auto-approves known guest rejoin without queueing pending request", async ({ page }) => {
    await openHome(page);

    const result = await page.evaluate(async () => {
        const { state } = await import("/js/state.js");
        const { onHostRecoveryRelayMessage } = await import("/js/host-peers.js");

        const roomId = "room-known-rejoin";
        const hostId = "host-known-rejoin";
        const guestId = "guest-known-rejoin";
        const sentMessages = [];
        state.role = "host";
        state.localId = hostId;
        state.roomId = roomId;
        state.hostAutoApproveKnownRejoin = true;
        state.hostRequireApprovalFirstJoin = true;
        state.hostPendingRejoinRequests = [];
        state.hostApprovedGuestIds = [guestId];
        state.hostPeers.clear();
        state.session = {
            round: 1,
            roundTitle: "",
            started: true,
            revealed: false,
            players: {
                [hostId]: {
                    id: hostId,
                    name: "Host Known",
                    connected: true,
                    vote: null,
                    isHost: true
                }
            }
        };

        const relayChannel = {
            readyState: "open",
            transportType: "mqtt-relay",
            send(data) {
                sentMessages.push(JSON.parse(String(data)));
            },
            close() {}
        };

        onHostRecoveryRelayMessage(
            JSON.stringify({ t: "rejoin", id: guestId, n: "Known Guest", pin: "" }),
            guestId,
            relayChannel
        );

        const rejoinAck = sentMessages.find((message) => message.t === "rejoinAck" && message.to === guestId) || null;
        const pendingIds = (state.hostPendingRejoinRequests || []).map((entry) => entry.id);
        const peer = state.hostPeers.get(guestId);
        return {
            ackType: rejoinAck ? rejoinAck.t : null,
            ackRoom: rejoinAck ? rejoinAck.room : null,
            pendingIds,
            peerConnected: !!(peer && peer.connected)
        };
    });

    expect(result.ackType).toBe("rejoinAck");
    expect(result.ackRoom).toBe("room-known-rejoin");
    expect(result.pendingIds).toEqual([]);
    expect(result.peerConnected).toBe(true);
});

test("host recovery relay listener reconnects after relay close", async ({ page }) => {
    await openHome(page);

    const result = await page.evaluate(async () => {
        const originalWebSocket = window.WebSocket;
        window.__PP_TEST_HOST_RECOVERY_RETRY_MS = 10;
        const OPEN = 1;
        let websocketCreates = 0;
        let forcedCloseDone = false;

        class FakeWebSocket {
            static OPEN = OPEN;

            constructor() {
                websocketCreates += 1;
                this.binaryType = "arraybuffer";
                this.readyState = 0;
                this.onopen = null;
                this.onmessage = null;
                this.onclose = null;
                setTimeout(() => {
                    this.readyState = OPEN;
                    if (typeof this.onopen === "function") this.onopen();
                }, 0);
            }

            send(data) {
                const bytes = new Uint8Array(data);
                const packetType = bytes[0] >> 4;
                if (packetType === 1 && typeof this.onmessage === "function") {
                    this.onmessage({ data: new Uint8Array([0x20, 0x02, 0x00, 0x00]).buffer });
                    return;
                }
                if (packetType === 8 && typeof this.onmessage === "function") {
                    const packetIdMsb = bytes[2] || 0x00;
                    const packetIdLsb = bytes[3] || 0x01;
                    this.onmessage({ data: new Uint8Array([0x90, 0x03, packetIdMsb, packetIdLsb, 0x00]).buffer });
                    if (!forcedCloseDone) {
                        forcedCloseDone = true;
                        setTimeout(() => this.close(), 20);
                    }
                }
            }

            close() {
                this.readyState = 3;
                if (typeof this.onclose === "function") this.onclose();
            }
        }

        window.WebSocket = FakeWebSocket;
        try {
            const { state } = await import("/js/state.js");
            const { startHostRecoveryRelayListener } = await import("/js/host-peers.js");

            state.role = "host";
            state.localId = "host-reconnect-listener";
            state.roomId = "room-reconnect-listener";
            state.session = {
                round: 1,
                roundTitle: "",
                started: true,
                revealed: false,
                players: {
                    "host-reconnect-listener": {
                        id: "host-reconnect-listener",
                        name: "Host",
                        connected: true,
                        vote: null,
                        isHost: true
                    }
                }
            };
            state.hostRecoveryRelay = null;
            startHostRecoveryRelayListener();

            await new Promise((resolve) => setTimeout(resolve, 80));
            if (state.hostRecoveryRelay && typeof state.hostRecoveryRelay.close === "function") {
                state.hostRecoveryRelay.close();
            }
            await new Promise((resolve) => setTimeout(resolve, 220));
            return { websocketCreates };
        } finally {
            delete window.__PP_TEST_HOST_RECOVERY_RETRY_MS;
            window.WebSocket = originalWebSocket;
        }
    });

    expect(result.websocketCreates).toBeGreaterThan(1);
});

test("guest auto-rejoin close-path exhaustion shows terminal reconnect notice", async ({ page }) => {
    await openHome(page);

    const result = await page.evaluate(async () => {
        const originalWebSocket = window.WebSocket;
        const originalSetTimeout = window.setTimeout;
        window.__PP_TEST_REJOIN_MAX_RETRIES = 2;
        const OPEN = 1;
        window.setTimeout = (handler, timeout, ...args) => {
            const clamped = Math.min(Number(timeout || 0), 10);
            return originalSetTimeout(handler, clamped, ...args);
        };

        class FakeWebSocket {
            static OPEN = OPEN;

            constructor() {
                this.binaryType = "arraybuffer";
                this.readyState = 0;
                this.onopen = null;
                this.onmessage = null;
                this.onclose = null;
                setTimeout(() => {
                    this.readyState = OPEN;
                    if (typeof this.onopen === "function") this.onopen();
                }, 0);
            }

            send(data) {
                const bytes = new Uint8Array(data);
                const packetType = bytes[0] >> 4;
                if (packetType === 1 && typeof this.onmessage === "function") {
                    this.onmessage({ data: new Uint8Array([0x20, 0x02, 0x00, 0x00]).buffer });
                    return;
                }
                if (packetType === 8 && typeof this.onmessage === "function") {
                    const packetIdMsb = bytes[2] || 0x00;
                    const packetIdLsb = bytes[3] || 0x01;
                    this.onmessage({ data: new Uint8Array([0x90, 0x03, packetIdMsb, packetIdLsb, 0x00]).buffer });
                    setTimeout(() => this.close(), 3);
                }
            }

            close() {
                this.readyState = 3;
                if (typeof this.onclose === "function") this.onclose();
            }
        }

        window.WebSocket = FakeWebSocket;
        try {
            const { state } = await import("/js/state.js");
            const { onHostChannelClose } = await import("/js/guest.js");
            const { showView, els } = await import("/js/ui.js");
            const { renderTable } = await import("/js/render.js");

            state.role = "guest";
            state.currentView = "table";
            state.roomId = "room-exhaust";
            state.guestAutoRejoinEnabled = true;
            state.guestRemoteState = { round: 1, roundTitle: "", started: true, revealed: false, players: [] };
            showView("table");
            renderTable();

            const fakeChannel = { readyState: "open", close() {} };
            state.guestChannel = fakeChannel;
            onHostChannelClose(fakeChannel);
            for (let index = 0; index < 4; index += 1) {
                await new Promise((resolve) => setTimeout(resolve, 40));
                if (state.guestChannel && typeof state.guestChannel.close === "function") {
                    state.guestChannel.close();
                }
            }

            await new Promise((resolve) => setTimeout(resolve, 250));
            return {
                notice: String(els.tableNotice.textContent || ""),
                status: String(els.connectionStatusText.textContent || "")
            };
        } finally {
            delete window.__PP_TEST_REJOIN_MAX_RETRIES;
            window.WebSocket = originalWebSocket;
            window.setTimeout = originalSetTimeout;
        }
    });

    expect(result.notice).toContain("Could not reconnect automatically");
    expect(result.status).not.toContain("Reconnecting to host...");
});

test("guest quick-join close while awaiting approval shows actionable retry state", async ({ page }) => {
    await openHome(page);

    const result = await page.evaluate(async () => {
        const originalWebSocket = window.WebSocket;
        const originalSetTimeout = window.setTimeout;
        window.__PP_TEST_QUICK_JOIN_RETRY_MAX = 1;
        const OPEN = 1;
        window.setTimeout = (handler, timeout, ...args) => {
            const clamped = Math.min(Number(timeout || 0), 12);
            return originalSetTimeout(handler, clamped, ...args);
        };

        class FakeWebSocket {
            static OPEN = OPEN;

            constructor() {
                this.binaryType = "arraybuffer";
                this.readyState = 0;
                this.onopen = null;
                this.onmessage = null;
                this.onclose = null;
                setTimeout(() => {
                    this.readyState = OPEN;
                    if (typeof this.onopen === "function") this.onopen();
                }, 0);
            }

            send(data) {
                const bytes = new Uint8Array(data);
                const packetType = bytes[0] >> 4;
                if (packetType === 1 && typeof this.onmessage === "function") {
                    this.onmessage({ data: new Uint8Array([0x20, 0x02, 0x00, 0x00]).buffer });
                    return;
                }
                if (packetType === 8 && typeof this.onmessage === "function") {
                    const packetIdMsb = bytes[2] || 0x00;
                    const packetIdLsb = bytes[3] || 0x01;
                    this.onmessage({ data: new Uint8Array([0x90, 0x03, packetIdMsb, packetIdLsb, 0x00]).buffer });
                    setTimeout(() => this.close(), 4);
                    return;
                }
            }

            close() {
                this.readyState = 3;
                if (typeof this.onclose === "function") this.onclose();
            }
        }

        window.WebSocket = FakeWebSocket;
        try {
            const { state } = await import("/js/state.js");
            const { connectGuestByRoomCode } = await import("/js/guest.js");
            const { showView, els } = await import("/js/ui.js");

            state.displayName = "GuestQuickClose";
            state.role = "guest";
            showView("guestConnect");
            await connectGuestByRoomCode("room-awaiting-approval", "");
            await new Promise((resolve) => setTimeout(resolve, 600));

            return {
                notice: String(els.guestConnectNotice.textContent || ""),
                status: String(els.connectionStatusText.textContent || "")
            };
        } finally {
            delete window.__PP_TEST_QUICK_JOIN_RETRY_MAX;
            window.WebSocket = originalWebSocket;
            window.setTimeout = originalSetTimeout;
        }
    });

    expect(result.notice).toContain("Click Join Room to retry");
    expect(result.status).toContain("Waiting for host approval");
});
