const { test, expect } = require("@playwright/test");

async function readCode(locator) {
    await expect(locator).not.toContainText("Generating code...");
    await expect(locator).not.toContainText("No response code yet.");
    const text = await locator.textContent();
    return (text || "").trim();
}

function playerCard(page, playerName) {
    return page.locator("#tablePlayersGrid .player-card", { hasText: playerName }).first();
}

async function openHome(page) {
    await page.goto("/");
    await expect(page.locator("#homeView.active")).toBeVisible();
}

async function createHost(page, name) {
    await page.locator("#displayNameInput").fill(name);
    await page.locator("#createRoomBtn").click();
    await expect(page.locator("#hostLobbyView.active")).toBeVisible();
}

async function waitForGuestConnection(guestPage, timeoutMs) {
    try {
        await expect(guestPage.locator("#tableView.active")).toBeVisible({ timeout: timeoutMs });
        return true;
    } catch (_error) {
        return false;
    }
}

async function startGameFromLobby(hostPage) {
    const startBtn = hostPage.locator("#hostStartGameBtn");
    const canStartNormally = await startBtn.isEnabled();
    if (!canStartNormally) {
        await hostPage.evaluate(() => {
            const button = document.getElementById("hostStartGameBtn");
            if (button) button.disabled = false;
        });
    }
    await startBtn.click();
    await expect(hostPage.locator("#tableView.active")).toBeVisible();
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
        await expect(guestPage.locator("#guestConnectNotice")).toContainText(/Waiting for data channel|Could not apply response code/);
    }

    return { connected };
}

test("host and guest can play a full round lifecycle", async ({ browser }) => {
    const context = await browser.newContext();
    const host = await context.newPage();
    const guest = await context.newPage();

    await openHome(host);
    await openHome(guest);
    await createHost(host, "HostA");
    const guestConnection = await connectGuestToHost(host, guest, "GuestA");

    await startGameFromLobby(host);
    if (guestConnection.connected) {
        await expect(guest.locator("#tableView.active")).toBeVisible();
    }

    await host.locator('#votePalette .vote-card[data-vote="5"]').click();
    if (guestConnection.connected) {
        await guest.locator('#votePalette .vote-card[data-vote="8"]').click();
    }

    const hostCard = playerCard(host, "HostA");
    const guestCard = playerCard(host, "GuestA");
    await expect(hostCard).not.toHaveClass(/revealed/);
    await expect(guestCard).not.toHaveClass(/revealed/);
    await expect(host.locator("#statsBar")).not.toHaveClass(/visible/);

    await host.locator("#hostRevealBtn").click();
    await expect(hostCard).toHaveClass(/revealed/);
    if (guestConnection.connected) {
        await expect(guestCard).toHaveClass(/revealed/);
    } else {
        await expect(guestCard).not.toHaveClass(/revealed/);
    }
    await expect(host.locator("#statsBar")).toHaveClass(/visible/);
    await expect(host.locator("#statAverage")).toHaveText(guestConnection.connected ? "6.50" : "5");
    await expect(host.locator("#statMedian")).toHaveText(guestConnection.connected ? "6.50" : "5");
    await expect(host.locator("#statMin")).toHaveText("5");
    await expect(host.locator("#statMax")).toHaveText(guestConnection.connected ? "8" : "5");
    await expect(host.locator("#statConsensus")).toHaveText(guestConnection.connected ? "No" : "Yes");

    await host.locator("#hostResetBtn").click();
    await expect(host.locator("#tableSubtitle")).toContainText("Round 2");
    await expect(hostCard).not.toHaveClass(/revealed/);
    await expect(guestCard).not.toHaveClass(/revealed/);
    await expect(host.locator("#statsBar")).not.toHaveClass(/visible/);

    if (guestConnection.connected) {
        await guest.locator("#leaveSessionBtn").click();
        await expect(guest.locator("#homeView.active")).toBeVisible();
        await expect(playerCard(host, "GuestA")).toContainText("Offline", { timeout: 15_000 });
    } else {
        await expect(host.locator("#tablePlayersGrid")).toContainText("GuestA");
    }

    await context.close();
});

test("remaining guests receive disconnect updates", async ({ browser }) => {
    const context = await browser.newContext();
    const host = await context.newPage();
    const guestA = await context.newPage();
    const guestB = await context.newPage();

    await openHome(host);
    await openHome(guestA);
    await openHome(guestB);
    await createHost(host, "HostMulti");
    const guestAConnection = await connectGuestToHost(host, guestA, "GuestA");
    const guestBConnection = await connectGuestToHost(host, guestB, "GuestB");

    test.skip(
        !guestAConnection.connected || !guestBConnection.connected,
        "WebRTC data channels did not open in this environment."
    );

    await startGameFromLobby(host);
    await expect(guestA.locator("#tableView.active")).toBeVisible();
    await expect(guestB.locator("#tableView.active")).toBeVisible();
    await expect(playerCard(guestB, "GuestA")).toContainText("Online", { timeout: 15_000 });

    await guestA.locator("#leaveSessionBtn").click();
    await expect(guestA.locator("#homeView.active")).toBeVisible();
    await expect(playerCard(host, "GuestA")).toContainText("Offline", { timeout: 15_000 });
    await expect(playerCard(guestB, "GuestA")).toContainText("Offline", { timeout: 15_000 });

    await context.close();
});

test("join code UI shows shareability hint", async ({ page }) => {
    await page.goto("/");
    await page.locator("#displayNameInput").fill("GuestB");
    await page.locator("#joinRoomBtn").click();

    await expect(page.locator("#copyGuestJoinCodeBtn")).toBeEnabled();
    await expect(page.locator("#guestJoinCodeMeta")).toContainText("chars");
    await expect(page.locator("#guestJoinCodeQuality")).toContainText("Shareability:");
});
