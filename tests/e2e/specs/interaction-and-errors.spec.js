const { test, expect } = require("@playwright/test");
const { createHost, openHome, readCode, setConnectionMode, setConnectionModeForPages } = require("../helpers");

test("escape exits guest connect view back to home", async ({ page }) => {
    await openHome(page);
    await page.locator("#displayNameInput").fill("GuestEsc");
    await page.locator("#joinRoomBtn").click();
    await expect(page.locator("#guestConnectView.active")).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.locator("#homeView.active")).toBeVisible();
});

test("escape exits host lobby view back to home", async ({ page }) => {
    await openHome(page);
    await createHost(page, "HostEsc");
    await expect(page.locator("#hostLobbyView.active")).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.locator("#homeView.active")).toBeVisible();
});

test("enter submits host join code input", async ({ page }) => {
    await openHome(page);
    await setConnectionMode(page, "manualWebRtc");
    await createHost(page, "HostEnter");

    await page.locator("#hostIncomingJoinCode").fill("invalid-code");
    await page.locator("#hostIncomingJoinCode").press("Enter");
    await expect(page.locator("#hostLobbyNotice")).toContainText("Could not accept guest code");
});

test("enter submits guest response code input", async ({ page }) => {
    await openHome(page);
    await setConnectionMode(page, "manualWebRtc");
    await page.locator("#displayNameInput").fill("GuestEnter");
    await page.locator("#joinRoomBtn").click();
    await expect(page.locator("#guestConnectView.active")).toBeVisible();
    await expect(page.locator("#copyGuestJoinCodeBtn")).toBeEnabled();

    await page.locator("#guestResponseCodeInput").fill("invalid-code");
    await page.locator("#guestResponseCodeInput").press("Enter");
    await expect(page.locator("#guestConnectNotice")).toContainText("Could not apply response code");
});

test("host rejects malformed guest join code", async ({ page }) => {
    await openHome(page);
    await setConnectionMode(page, "manualWebRtc");
    await createHost(page, "HostBadJoin");

    await page.locator("#hostIncomingJoinCode").fill("not-a-valid-join-code");
    await page.locator("#acceptGuestBtn").click();
    await expect(page.locator("#hostLobbyNotice")).toContainText("Could not accept guest code");
});

test("guest rejects malformed host response code", async ({ page }) => {
    await openHome(page);
    await setConnectionMode(page, "manualWebRtc");
    await page.locator("#displayNameInput").fill("GuestBadResp");
    await page.locator("#joinRoomBtn").click();
    await expect(page.locator("#copyGuestJoinCodeBtn")).toBeEnabled();

    await page.locator("#guestResponseCodeInput").fill("still-not-a-valid-response");
    await page.locator("#connectGuestBtn").click();
    await expect(page.locator("#guestConnectNotice")).toContainText("Could not apply response code");
});

test("guest rejects response code intended for a different guest", async ({ browser }) => {
    const context = await browser.newContext();
    const host = await context.newPage();
    const guestA = await context.newPage();
    const guestB = await context.newPage();

    await openHome(host);
    await openHome(guestA);
    await openHome(guestB);
    await setConnectionModeForPages([host, guestA, guestB], "manualWebRtc");
    await createHost(host, "HostWrongTarget");

    await guestA.locator("#displayNameInput").fill("GuestA");
    await guestA.locator("#joinRoomBtn").click();
    await expect(guestA.locator("#copyGuestJoinCodeBtn")).toBeEnabled();
    const guestAJoinCode = await readCode(guestA.locator("#guestJoinCode"));

    await host.locator("#hostIncomingJoinCode").fill(guestAJoinCode);
    await host.locator("#acceptGuestBtn").click();
    await expect(host.locator("#copyHostResponseCodeBtn")).toBeEnabled();
    const guestAResponseCode = await readCode(host.locator("#hostResponseCode"));

    await guestB.locator("#displayNameInput").fill("GuestB");
    await guestB.locator("#joinRoomBtn").click();
    await expect(guestB.locator("#copyGuestJoinCodeBtn")).toBeEnabled();
    await guestB.locator("#guestResponseCodeInput").fill(guestAResponseCode);
    await guestB.locator("#connectGuestBtn").click();

    await expect(guestB.locator("#guestConnectNotice")).toContainText("different guest");
});
