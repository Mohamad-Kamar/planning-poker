const { test, expect } = require("@playwright/test");
const {
    createHost,
    decodeSignalCodeInPage,
    openHome,
    readCode,
    setConnectionMode
} = require("../helpers");

test("join code UI shows shareability hint", async ({ page }) => {
    await openHome(page);
    await setConnectionMode(page, "manualWebRtc");
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
    await setConnectionMode(host, "manualWebRtc");
    await setConnectionMode(guest, "manualWebRtc");
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

test("guest accepts response code with extra whitespace/newlines", async ({ browser }) => {
    const context = await browser.newContext();
    const host = await context.newPage();
    const guest = await context.newPage();

    await openHome(host);
    await openHome(guest);
    await setConnectionMode(host, "manualWebRtc");
    await setConnectionMode(guest, "manualWebRtc");
    await createHost(host, "HostWhitespace");
    await guest.locator("#displayNameInput").fill("GuestWhitespace");
    await guest.locator("#joinRoomBtn").click();
    await expect(guest.locator("#copyGuestJoinCodeBtn")).toBeEnabled();
    const joinCode = await readCode(guest.locator("#guestJoinCode"));

    await host.locator("#hostIncomingJoinCode").fill(joinCode);
    await host.locator("#acceptGuestBtn").click();
    await expect(host.locator("#copyHostResponseCodeBtn")).toBeEnabled();
    const rawResponse = await readCode(host.locator("#hostResponseCode"));
    const compact = rawResponse.replace(/\s+/g, "");
    const expanded = compact.replace(/(.{12})/g, "$1 \n");

    await guest.locator("#guestResponseCodeInput").fill(expanded);
    await guest.locator("#connectGuestBtn").click();
    await expect(guest.locator("#guestConnectNotice")).not.toContainText("Could not apply response code");
});

test("guest shows precise error for unknown response code prefix", async ({ page }) => {
    await openHome(page);
    await setConnectionMode(page, "manualWebRtc");
    await page.locator("#displayNameInput").fill("GuestPrefix");
    await page.locator("#joinRoomBtn").click();
    await expect(page.locator("#copyGuestJoinCodeBtn")).toBeEnabled();

    await page.locator("#guestResponseCodeInput").fill("X1.invalidpayload");
    await page.locator("#connectGuestBtn").click();
    await expect(page.locator("#guestConnectNotice")).toContainText("Unknown signal code prefix");
});

test("mqtt quick join connects guest with room code and host approval", async ({ browser }) => {
    const context = await browser.newContext();
    const host = await context.newPage();
    const guest = await context.newPage();

    await openHome(host);
    await openHome(guest);
    await createHost(host, "HostQuickJoin");
    const roomCode = String(await host.locator("#hostRoomCode").textContent() || "").trim();

    await guest.locator("#displayNameInput").fill("GuestQuickJoin");
    await guest.locator("#joinRoomBtn").click();
    await guest.locator("#guestRoomCodeInput").fill(roomCode);
    await guest.locator("#connectGuestRoomBtn").click();

    const pendingRow = host.locator("#hostPendingRejoinList .row-between", { hasText: "GuestQuickJoin" }).first();
    await expect(pendingRow).toBeVisible({ timeout: 8_000 });
    await pendingRow.getByRole("button", { name: "Approve" }).click();
    await expect(guest.locator("#tableView.active")).toBeVisible({ timeout: 12_000 });
});

test("mqtt quick join enforces room pin", async ({ browser }) => {
    const context = await browser.newContext();
    const host = await context.newPage();
    const guest = await context.newPage();

    await openHome(host);
    await openHome(guest);
    await createHost(host, "HostPin");
    const roomCode = String(await host.locator("#hostRoomCode").textContent() || "").trim();
    await host.locator("#hostRoomPinInput").fill("1234");

    await guest.locator("#displayNameInput").fill("GuestPin");
    await guest.locator("#joinRoomBtn").click();
    await guest.locator("#guestRoomCodeInput").fill(roomCode);
    await guest.locator("#guestRoomPinInput").fill("9999");
    await guest.locator("#connectGuestRoomBtn").click();
    await expect(guest.locator("#guestConnectNotice")).toContainText("Invalid room PIN", { timeout: 10_000 });

    await guest.locator("#guestRoomPinInput").fill("1234");
    await guest.locator("#connectGuestRoomBtn").click();
    const pendingRow = host.locator("#hostPendingRejoinList .row-between", { hasText: "GuestPin" }).first();
    await expect(pendingRow).toBeVisible({ timeout: 8_000 });
});

test("join link pre-fills room and auto-requests join", async ({ browser }) => {
    const context = await browser.newContext();
    const host = await context.newPage();
    const guest = await context.newPage();

    await openHome(host);
    await createHost(host, "HostLink");
    const roomCode = String(await host.locator("#hostRoomCode").textContent() || "").trim();
    await guest.goto("/?room=" + encodeURIComponent(roomCode));
    await guest.locator("#displayNameInput").fill("GuestLink");
    await guest.locator("#joinRoomBtn").click();

    await expect(guest.locator("#guestRoomCodeInput")).toHaveValue(roomCode);
    const pendingRow = host.locator("#hostPendingRejoinList .row-between", { hasText: "GuestLink" }).first();
    try {
        await expect(pendingRow).toBeVisible({ timeout: 8_000 });
    } catch (_error) {
        await expect(guest.locator("#tableView.active")).toBeVisible({ timeout: 8_000 });
    }
});
