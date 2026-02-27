const { expect } = require("@playwright/test");

async function openHome(page) {
    await page.goto("/");
    await expect(page.locator("#homeView.active")).toBeVisible();
}

async function openConnectionSettings(page) {
    await page.locator("#iceSettingsBtn").click();
    await expect(page.locator("#iceSettingsDialog")).toBeVisible();
}

async function saveConnectionSettings(page) {
    await page.locator("#iceSettingsSaveBtn").click();
}

async function setConnectionPreferences(page, preferences = {}) {
    await openConnectionSettings(page);

    if (typeof preferences.mode === "string") {
        await page.locator("#connectionStrategySelect").selectOption(preferences.mode);
    }
    if (typeof preferences.hostRequireApprovalFirstJoin === "boolean") {
        await page.locator("#hostRequireApprovalFirstJoinCheckbox").setChecked(preferences.hostRequireApprovalFirstJoin);
    }
    if (typeof preferences.hostAutoApproveKnownRejoin === "boolean") {
        await page.locator("#hostAutoApproveKnownRejoinCheckbox").setChecked(preferences.hostAutoApproveKnownRejoin);
    }

    await saveConnectionSettings(page);
}

async function setConnectionMode(page, mode) {
    await setConnectionPreferences(page, { mode });
}

async function setConnectionModeForPages(pages, mode) {
    for (const page of pages) {
        await setConnectionMode(page, mode);
    }
}

module.exports = {
    openHome,
    openConnectionSettings,
    saveConnectionSettings,
    setConnectionMode,
    setConnectionModeForPages,
    setConnectionPreferences
};
