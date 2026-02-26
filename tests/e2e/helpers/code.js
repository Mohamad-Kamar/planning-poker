const { expect } = require("@playwright/test");

async function readCode(locator) {
    await expect(locator).not.toContainText("Generating code...");
    await expect(locator).not.toContainText("No response code yet.");
    const text = await locator.textContent();
    return (text || "").trim();
}

async function decodeSignalCodeInPage(page, code) {
    return page.evaluate(async ({ codeValue }) => {
        const { decodeSignalCode } = await import("/js/signaling.js");
        return decodeSignalCode(codeValue);
    }, { codeValue: code });
}

module.exports = {
    readCode,
    decodeSignalCodeInPage
};
