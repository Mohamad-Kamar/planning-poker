const { expect } = require("@playwright/test");
const { readCode } = require("./code");

async function waitForGuestConnection(guestPage, timeoutMs) {
    try {
        await expect(guestPage.locator("#tableView.active")).toBeVisible({ timeout: timeoutMs });
        return true;
    } catch (_error) {
        return false;
    }
}

async function connectGuestToHost(hostPage, guestPage, guestName) {
    await guestPage.locator("#displayNameInput").fill(guestName);
    await guestPage.locator("#joinRoomBtn").click();
    await expect(guestPage.locator("#copyGuestJoinCodeBtn")).toBeEnabled();
    const joinCode = await readCode(guestPage.locator("#guestJoinCode"));

    await hostPage.locator("#hostIncomingJoinCode").fill(joinCode);
    await hostPage.locator("#acceptGuestBtn").click();
    await expect(hostPage.locator("#copyHostResponseCodeBtn")).toBeEnabled();
    const responseCode = await readCode(hostPage.locator("#hostResponseCode"));

    await guestPage.locator("#guestResponseCodeInput").fill(responseCode);
    await guestPage.locator("#connectGuestBtn").click();
    const connected = await waitForGuestConnection(guestPage, 8_000);
    const guestRow = hostPage.locator("#hostPlayerList .player-row", { hasText: guestName });
    if (connected) {
        await expect(guestRow).toContainText("Online", { timeout: 8_000 });
    } else {
        await expect(guestPage.locator("#guestConnectNotice")).toContainText(
            /Waiting for data channel|Could not apply response code|Connection failed/
        );
    }

    return { connected };
}

module.exports = {
    waitForGuestConnection,
    connectGuestToHost
};
