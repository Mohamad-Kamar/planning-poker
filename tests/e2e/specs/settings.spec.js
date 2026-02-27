const { test, expect } = require("@playwright/test");
const { openConnectionSettings, openHome, saveConnectionSettings, setConnectionPreferences } = require("../helpers");

test("connection settings dialog persists custom ICE servers", async ({ page }) => {
    await openHome(page);

    await openConnectionSettings(page);
    await expect(page.locator("#defaultIceServersList")).toContainText("stun:stun.l.google.com:19302");

    const customServers = [
        "turn:example.com:3478?transport=tcp | alice | s3cret",
        "stun:stun.example.com:3478"
    ].join("\n");
    await page.locator("#customIceServersInput").fill(customServers);
    await saveConnectionSettings(page);
    await expect(page.locator("#homeNotice")).toContainText("Connection settings saved");

    await openConnectionSettings(page);
    await expect(page.locator("#customIceServersInput")).toHaveValue(/turn:example\.com:3478\?transport=tcp/);
    await expect(page.locator("#customIceServersInput")).toHaveValue(/stun:stun\.example\.com:3478/);
    await page.locator("#iceSettingsCancelBtn").click();
});

test("connection settings persist strategy and MQTT admission toggles", async ({ page }) => {
    await openHome(page);
    await setConnectionPreferences(page, {
        mode: "manualWebRtc",
        hostRequireApprovalFirstJoin: false,
        hostAutoApproveKnownRejoin: false
    });
    await expect(page.locator("#homeNotice")).toContainText("Connection settings saved");

    await openConnectionSettings(page);
    await expect(page.locator("#connectionStrategySelect")).toHaveValue("manualWebRtc");
    await expect(page.locator("#hostRequireApprovalFirstJoinCheckbox")).not.toBeChecked();
    await expect(page.locator("#hostAutoApproveKnownRejoinCheckbox")).not.toBeChecked();
    await page.locator("#iceSettingsCancelBtn").click();
});
