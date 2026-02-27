const { expect } = require("@playwright/test");

async function openHome(page) {
    await page.goto("/");
    await expect(page.locator("#homeView.active")).toBeVisible();
}

async function setConnectionMode(page, mode) {
    await page.locator("#iceSettingsBtn").click();
    await expect(page.locator("#iceSettingsDialog")).toBeVisible();
    await page.locator("#connectionStrategySelect").selectOption(mode);
    await page.locator("#iceSettingsSaveBtn").click();
}

module.exports = {
    openHome,
    setConnectionMode
};
