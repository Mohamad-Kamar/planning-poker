const { expect } = require("@playwright/test");
async function waitForGuestConnection(guestPage, timeoutMs) {
    try {
        await expect(guestPage.locator("#tableView.active")).toBeVisible({ timeout: timeoutMs });
        return true;
    } catch (_error) {
        return false;
    }
}

async function connectGuestToHost(hostPage, guestPage, guestName) {
    const roomCodeText = await hostPage.locator("#hostRoomCode").textContent();
    const roomCode = String(roomCodeText || "").trim();
    await guestPage.locator("#displayNameInput").fill(guestName);
    await guestPage.locator("#joinRoomBtn").click();
    await guestPage.locator("#guestRoomCodeInput").fill(roomCode);
    await guestPage.locator("#connectGuestRoomBtn").click();
    const pendingRow = hostPage.locator("#hostPendingRejoinList .row-between", { hasText: guestName }).first();
    try {
        await expect(pendingRow).toBeVisible({ timeout: 3_000 });
        await pendingRow.getByRole("button", { name: "Approve" }).click();
    } catch (_error) {
        // Auto-approved joins may skip pending state.
    }
    const connected = await waitForGuestConnection(guestPage, 8_000);
    const guestRow = hostPage.locator("#hostPlayerList .player-row", { hasText: guestName });
    if (connected) {
        await expect(guestRow).toContainText("Online", { timeout: 8_000 });
    } else {
        await expect(guestPage.locator("#guestConnectNotice")).toContainText(
            /approval|Could not connect to room|Disconnected/
        );
    }

    return { connected };
}

module.exports = {
    waitForGuestConnection,
    connectGuestToHost
};
