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
