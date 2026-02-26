const { test, expect } = require("@playwright/test");
const {
    createHost,
    decodeSignalCodeInPage,
    openHome,
    readCode
} = require("../helpers");

test("join code UI shows shareability hint", async ({ page }) => {
    await openHome(page);
    await page.locator("#displayNameInput").fill("GuestB");
    await page.locator("#joinRoomBtn").click();

    await expect(page.locator("#copyGuestJoinCodeBtn")).toBeEnabled();
    await expect(page.locator("#guestJoinCodeMeta")).toContainText("chars");
    await expect(page.locator("#guestJoinCodeQuality")).toContainText("Shareability:");
});

test("response code includes room identifier", async ({ browser }) => {
    const context = await browser.newContext();
    const host = await context.newPage();
    const guest = await context.newPage();

    await openHome(host);
    await openHome(guest);
    await createHost(host, "HostRoom");
    await guest.locator("#displayNameInput").fill("GuestRoom");
    await guest.locator("#joinRoomBtn").click();
    await expect(guest.locator("#copyGuestJoinCodeBtn")).toBeEnabled();

    const joinCode = await readCode(guest.locator("#guestJoinCode"));
    await host.locator("#hostIncomingJoinCode").fill(joinCode);
    await host.locator("#acceptGuestBtn").click();
    await expect(host.locator("#copyHostResponseCodeBtn")).toBeEnabled();

    const responseCode = await readCode(host.locator("#hostResponseCode"));
    const payload = await decodeSignalCodeInPage(host, responseCode);

    expect(payload.v).toBe(1);
    expect(typeof payload.room).toBe("string");
    expect(payload.room.length).toBeGreaterThan(0);
    expect(payload.room).toBe(payload.f);

});
