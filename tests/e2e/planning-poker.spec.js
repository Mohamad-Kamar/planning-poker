const { test, expect } = require("@playwright/test");

async function readCode(locator) {
    await expect(locator).not.toContainText("Generating code...");
    await expect(locator).not.toContainText("No response code yet.");
    const text = await locator.textContent();
    return (text || "").trim();
}

test("host and guest can complete signaling exchange", async ({ browser }) => {
    const context = await browser.newContext();
    const host = await context.newPage();
    const guest = await context.newPage();

    await host.goto("/");
    await guest.goto("/");

    await host.locator("#displayNameInput").fill("HostA");
    await host.locator("#createRoomBtn").click();

    await guest.locator("#displayNameInput").fill("GuestA");
    await guest.locator("#joinRoomBtn").click();

    await expect(guest.locator("#copyGuestJoinCodeBtn")).toBeEnabled();
    const joinCode = await readCode(guest.locator("#guestJoinCode"));

    await host.locator("#hostIncomingJoinCode").fill(joinCode);
    await host.locator("#acceptGuestBtn").click();
    await expect(host.locator("#copyHostResponseCodeBtn")).toBeEnabled();
    const responseCode = await readCode(host.locator("#hostResponseCode"));

    await guest.locator("#guestResponseCodeInput").fill(responseCode);
    await guest.locator("#connectGuestBtn").click();
    await expect(guest.locator("#connectGuestBtn")).toBeDisabled();
    await expect(guest.locator("#guestConnectNotice")).toContainText("Response accepted. Waiting for data channel...");

    const guestRow = host.locator("#hostPlayerList .player-row", { hasText: "GuestA" });
    await expect(guestRow).toContainText("Offline");
    await expect(host.locator("#hostResponseCodeMeta")).toContainText("chars");

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
