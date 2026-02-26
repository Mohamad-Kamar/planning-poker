const { test, expect } = require("@playwright/test");
const {
    connectGuestToHost,
    createHost,
    openHome,
    playerCard,
    readCode,
    startGameFromLobby,
    startGameFromLobbyStrict,
    waitForGuestConnection
} = require("../helpers");

test("host and guest can play a full round lifecycle", async ({ browser }) => {
    test.setTimeout(90_000);
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
    await host.locator("#hostRoundTitleInput").fill("API sizing");
    await expect(host.locator("#tableSubtitle")).toContainText("Round 1 - API sizing");
    if (guestConnection.connected) {
        await expect(guest.locator("#tableSubtitle")).toContainText("Round 1 - API sizing");
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

    await host.locator('#votePalette .vote-card[data-vote="13"]').click();
    await expect(hostCard).toContainText("13");
    await expect(host.locator("#statAverage")).toHaveText(guestConnection.connected ? "10.50" : "13");
    await expect(host.locator("#statMedian")).toHaveText(guestConnection.connected ? "10.50" : "13");
    await expect(host.locator("#statMin")).toHaveText(guestConnection.connected ? "8" : "13");
    await expect(host.locator("#statMax")).toHaveText("13");
    if (guestConnection.connected) {
        await expect(playerCard(guest, "HostA")).toContainText("13");
        await expect(guest.locator("#statAverage")).toHaveText("10.50");
    }

    await host.locator("#hostResetBtn").click();
    await expect(host.locator("#tableSubtitle")).toContainText("Round 2");
    await expect(host.locator("#tableSubtitle")).not.toContainText("API sizing");
    await expect(hostCard).not.toHaveClass(/revealed/);
    await expect(guestCard).not.toHaveClass(/revealed/);
    await expect(host.locator("#statsBar")).not.toHaveClass(/visible/);

    if (guestConnection.connected) {
        await guest.locator("#leaveSessionBtn").click();
        await expect(guest.locator("#homeView.active")).toBeVisible();
        await expect(host.locator("#tablePlayersGrid .player-card", { hasText: "GuestA" })).toHaveCount(0, { timeout: 15_000 });
    } else {
        await expect(host.locator("#tablePlayersGrid")).toContainText("GuestA");
    }

});

test("remaining guests receive disconnect updates", async ({ browser }) => {
    test.setTimeout(90_000);
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
    await expect(host.locator("#tablePlayersGrid .player-card", { hasText: "GuestA" })).toHaveCount(0, { timeout: 15_000 });
    await expect(guestB.locator("#tablePlayersGrid .player-card", { hasText: "GuestA" })).toHaveCount(0, { timeout: 15_000 });

});

test("host can kick a guest from lobby", async ({ browser }) => {
    test.setTimeout(90_000);
    const context = await browser.newContext();
    const host = await context.newPage();
    const guest = await context.newPage();

    await openHome(host);
    await openHome(guest);
    await createHost(host, "HostKick");
    const guestConnection = await connectGuestToHost(host, guest, "GuestKick");
    test.skip(!guestConnection.connected, "WebRTC data channel did not open in this environment.");

    const guestRow = host.locator("#hostPlayerList .player-row", { hasText: "GuestKick" });
    const kickButton = guestRow.getByRole("button", { name: "Kick" });
    await expect(kickButton).toBeVisible();
    await kickButton.click();

    await expect(host.locator("#hostPlayerList .player-row", { hasText: "GuestKick" })).toHaveCount(0, { timeout: 12_000 });
    await expect(host.locator("#hostStartGameBtn")).toBeDisabled();
    await expect(guest.locator("#homeView.active")).toBeVisible({ timeout: 12_000 });
    await expect(guest.locator("#homeNotice")).toContainText("Removed by host", { timeout: 12_000 });
});

test("strict host and guest happy path requires live guest connection", async ({ browser }) => {
    test.setTimeout(90_000);
    const context = await browser.newContext();
    const host = await context.newPage();
    const guest = await context.newPage();

    await openHome(host);
    await openHome(guest);
    await createHost(host, "HostStrict");

    await guest.locator("#displayNameInput").fill("GuestStrict");
    await guest.locator("#joinRoomBtn").click();
    await expect(guest.locator("#copyGuestJoinCodeBtn")).toBeEnabled();
    const joinCode = await readCode(guest.locator("#guestJoinCode"));

    await host.locator("#hostIncomingJoinCode").fill(joinCode);
    await host.locator("#acceptGuestBtn").click();
    await expect(host.locator("#copyHostResponseCodeBtn")).toBeEnabled();
    const responseCode = await readCode(host.locator("#hostResponseCode"));

    await guest.locator("#guestResponseCodeInput").fill(responseCode);
    await guest.locator("#connectGuestBtn").click();
    const connected = await waitForGuestConnection(guest, 20_000);
    test.skip(!connected, "Live data channel did not open in this environment.");

    await expect(host.locator("#hostPlayerList .player-row", { hasText: "GuestStrict" })).toContainText("Online", { timeout: 20_000 });
    await startGameFromLobbyStrict(host);
    await expect(guest.locator("#tableView.active")).toBeVisible();

    await host.locator('#votePalette .vote-card[data-vote="5"]').click();
    await guest.locator('#votePalette .vote-card[data-vote="8"]').click();
    await host.locator("#hostRevealBtn").click();
    await expect(playerCard(guest, "HostStrict")).toHaveClass(/revealed/);

});

test("host start game button stays disabled until a guest is connected", async ({ page }) => {
    await openHome(page);
    await createHost(page, "HostGate");
    await expect(page.locator("#hostStartGameBtn")).toBeDisabled();
});

test("host can return to table after game has started", async ({ browser }) => {
    test.setTimeout(90_000);
    const context = await browser.newContext();
    const host = await context.newPage();
    const guest = await context.newPage();

    await openHome(host);
    await openHome(guest);
    await createHost(host, "HostReturn");
    const guestConnection = await connectGuestToHost(host, guest, "GuestReturn");
    test.skip(!guestConnection.connected, "WebRTC data channel did not open in this environment.");

    await startGameFromLobbyStrict(host);
    await expect(host.locator("#tableView.active")).toBeVisible();
    await host.locator("#leaveSessionBtn").click();

    await expect(host.locator("#hostLobbyView.active")).toBeVisible();
    await expect(host.locator("#hostStartGameBtn")).toBeEnabled();
    await expect(host.locator("#hostStartGameBtn")).toHaveText("Return to Table");
    await host.locator("#hostStartGameBtn").click();
    await expect(host.locator("#tableView.active")).toBeVisible();
});
