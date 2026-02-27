const { test, expect } = require("@playwright/test");
const {
    connectGuestToHost,
    createHost,
    openHome,
    playerCard,
    startGameFromLobbyStrict
} = require("../helpers");

test("guest cannot operate host-only table controls", async ({ browser }) => {
    test.setTimeout(90_000);
    const context = await browser.newContext();
    const host = await context.newPage();
    const guest = await context.newPage();

    await openHome(host);
    await openHome(guest);
    await createHost(host, "HostVisibility");
    const guestConnection = await connectGuestToHost(host, guest, "GuestVisibility");
    test.skip(!guestConnection.connected, "Live data channel did not open in this environment.");

    await startGameFromLobbyStrict(host);
    await expect(guest.locator("#tableView.active")).toBeVisible();
    await expect(guest.getByTestId("btn-host-reveal")).toBeHidden();
    await expect(guest.getByTestId("btn-host-reset")).toBeHidden();
    await expect(guest.locator("#hostRoundTitleInput")).toBeHidden();
});

test("round title and vote clear updates propagate correctly", async ({ browser }) => {
    test.setTimeout(90_000);
    const context = await browser.newContext();
    const host = await context.newPage();
    const guest = await context.newPage();

    await openHome(host);
    await openHome(guest);
    await createHost(host, "HostClearVote");
    const guestConnection = await connectGuestToHost(host, guest, "GuestClearVote");
    test.skip(!guestConnection.connected, "Live data channel did not open in this environment.");

    await startGameFromLobbyStrict(host);
    await expect(guest.locator("#tableView.active")).toBeVisible();

    await host.locator("#hostRoundTitleInput").fill("Checkout API");
    await expect(host.locator("#tableSubtitle")).toContainText("Round 1 - Checkout API");
    await expect(guest.locator("#tableSubtitle")).toContainText("Round 1 - Checkout API");

    await host.locator('#votePalette .vote-card[data-vote="5"]').click();
    await guest.locator('#votePalette .vote-card[data-vote="8"]').click();
    await host.getByTestId("btn-host-reveal").click();

    await expect(host.locator("#statAverage")).toHaveText("6.50");
    await expect(host.locator("#statConsensus")).toHaveText("No");
    await expect(playerCard(host, "GuestClearVote")).toHaveClass(/revealed/);

    await guest.getByTestId("btn-clear-vote").click();
    await expect(host.locator("#statAverage")).toHaveText("5");
    await expect(host.locator("#statMin")).toHaveText("5");
    await expect(host.locator("#statMax")).toHaveText("5");
    await expect(host.locator("#statConsensus")).toHaveText("Yes");

    await host.getByTestId("btn-clear-vote").click();
    await expect(host.locator("#statAverage")).toHaveText("--");
    await expect(host.locator("#statMedian")).toHaveText("--");
    await expect(host.locator("#statMin")).toHaveText("--");
    await expect(host.locator("#statMax")).toHaveText("--");
    await expect(host.locator("#statConsensus")).toHaveText("No");
});
