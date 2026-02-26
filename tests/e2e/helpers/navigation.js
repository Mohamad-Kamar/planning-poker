const { expect } = require("@playwright/test");

async function openHome(page) {
    await page.goto("/");
    await expect(page.locator("#homeView.active")).toBeVisible();
}

module.exports = {
    openHome
};
