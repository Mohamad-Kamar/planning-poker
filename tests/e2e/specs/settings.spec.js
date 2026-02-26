const { test, expect } = require("@playwright/test");
const { openHome } = require("../helpers");

test("connection settings dialog persists custom ICE servers", async ({ page }) => {
    await openHome(page);

    await page.locator("#iceSettingsBtn").click();
    await expect(page.locator("#iceSettingsDialog")).toBeVisible();
    await expect(page.locator("#defaultIceServersList")).toContainText("stun:stun.l.google.com:19302");

    const customServers = [
        "turn:example.com:3478?transport=tcp | alice | s3cret",
        "stun:stun.example.com:3478"
    ].join("\n");
    await page.locator("#customIceServersInput").fill(customServers);
    await page.locator("#iceSettingsSaveBtn").click();
    await expect(page.locator("#homeNotice")).toContainText("Connection settings saved");

    await page.locator("#iceSettingsBtn").click();
    await expect(page.locator("#customIceServersInput")).toHaveValue(/turn:example\.com:3478\?transport=tcp/);
    await expect(page.locator("#customIceServersInput")).toHaveValue(/stun:stun\.example\.com:3478/);
    await page.locator("#iceSettingsCancelBtn").click();
});
