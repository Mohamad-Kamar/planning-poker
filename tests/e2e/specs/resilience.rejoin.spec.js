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
    await expect(page.locator("#tableNotice")).toContainText("Host has not approved reconnect yet");
});
