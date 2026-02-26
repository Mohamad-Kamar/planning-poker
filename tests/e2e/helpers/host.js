const { expect } = require("@playwright/test");

async function createHost(page, name) {
    await page.locator("#displayNameInput").fill(name);
    await page.locator("#createRoomBtn").click();
    await expect(page.locator("#hostLobbyView.active")).toBeVisible();
}

async function startGameFromLobby(hostPage) {
    const startBtn = hostPage.locator("#hostStartGameBtn");
    await expect(startBtn).toBeEnabled();
    await startBtn.click();
    await expect(hostPage.locator("#tableView.active")).toBeVisible();
}

async function startGameFromLobbyStrict(hostPage) {
    const startBtn = hostPage.locator("#hostStartGameBtn");
    await expect(startBtn).toBeEnabled();
    await startBtn.click();
    await expect(hostPage.locator("#tableView.active")).toBeVisible();
}

module.exports = {
    createHost,
    startGameFromLobby,
    startGameFromLobbyStrict
};
